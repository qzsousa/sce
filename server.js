import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

import sheets, { supabase as supabaseAdmin } from './supabaseService.js';

const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const standardResponse = (success, data = null, error = null) => ({
  success,
  data,
  error,
});

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

app.use((err, req, res, next) => {
  console.error('Erro:', err);
  res.status(500).json(standardResponse(false, null, err.message || 'Erro interno do servidor'));
});

const HEADER_MAP = {
  EQUIPAMENTOS: [
    'id', 'unidade', 'categoria', 'marca', 'modelo', 'patrimonio', 'numeroSerie',
    'status', 'statusManutencao', 'vinculadoBlueMonitor', 'numeroChamadoManutencao',
    'boletimOcorrencia', 'justificativaVerificacao', 'descricaoQuebrado',
    'sistemaOperacional', 'processador', 'memoriaRAM', 'armazenamento',
    'tamanhoTela', 'responsavelAtual', 'observacoes',
    'dataCadastro', 'dataUltimaAtualizacao', 'cadastradoPor', 'ultimaAlteracaoPor',
    'justificativaPatrimonio', 'justificativaNumeroSerie', 'boletimOcorrenciaAnexoUrl',
    'tipoEmprestimo', 'escolaDestino'
  ],
  LISTAS: ['categoria', 'marca', 'modelo'],
  FILIAIS: ['nome'],
  HISTORICO: ['id', 'equipamentoId', 'campo', 'valorAntigo', 'valorNovo', 'autor', 'data'],
  EMPRESTIMOS: ['id', 'equipamentoId', 'patrimonio', 'unidade', 'responsavel', 'cpf', 'emailResponsavel',
    'dataEmprestimo', 'dataPrevistaDevolucao', 'dataDevolucao', 'status', 'termoPdfUrl',
    'criadoPor', 'devolvidoPor', 'observacoes', 'tipoEmprestimo', 'escolaDestino'],
  AUDITORIA: ['data', 'usuario', 'acao', 'detalhes'],
  REGISTROS_MANUTENCAO: ['id', 'equipamentoId', 'autor', 'data', 'descricao', 'status'],
  USUARIOS: ['email', 'nome', 'nivel', 'filial', 'status', 'dataRemocao', 'senhaDefinida'],
  SESSOES: ['token', 'email', 'nivel', 'filial', 'criadoEm', 'expiraEm'],
};

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

const niveis = {
  MATRIZ: 'Matriz',
  ADMIN_FILIAL: 'AdminFilial',
  FILIAL: 'Filial',
  TECNICO: 'Tecnico',
};

const statusUsuario = {
  ATIVO: 'Ativo',
  REMOVIDO: 'Removido',
};

const statusManutencaoValidos = ['Pendente', 'Em andamento', 'Concluído'];

async function validateSession(token) {
  if (!token) return null;
  const data = await sheets.getValues('Sessoes');
  const now = Date.now();
  for (const row of data) {
    const sheetToken = String(row.token || '').trim();
    const sheetEmail = String(row.email || '').trim().toLowerCase();
    const expiraEm = new Date(row.expira_em).getTime();
    if (sheetToken === token.trim()) {
      if (isNaN(expiraEm) || now > expiraEm) return null;
      const usuario = await findUsuarioByEmail(sheetEmail);
      if (!usuario || usuario.status === statusUsuario.REMOVIDO) return null;
      return { token: sheetToken, email: sheetEmail, nivel: row.nivel, filial: row.filial };
    }
  }
  return null;
}

async function requireSession(token, niveisPermitidos = null) {
  const session = await validateSession(token);
  if (!session) throw new Error('Sessão inválida ou expirada. Faça login novamente.');
  if (niveisPermitidos) {
    const allowed = Array.isArray(niveisPermitidos) ? niveisPermitidos : [niveisPermitidos];
    if (!allowed.includes(session.nivel)) throw new Error('Você não tem permissão para executar esta ação.');
  }
  return session;
}

async function findUsuarioByEmail(email) {
  const data = await sheets.getValues('Usuarios');
  for (const row of data) {
    if (String(row.email).trim().toLowerCase() === email.trim().toLowerCase()) {
      return {
        email: row.email,
        nome: row.nome,
        nivel: row.nivel,
        filial: row.filial,
        status: row.status,
        dataRemocao: row.data_remocao,
        senhaDefinida: row.senha_definida !== false,
      };
    }
  }
  return null;
}

// Busca um usuário no Supabase Auth pelo e-mail (admin API)
async function findAuthUserByEmail(email) {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return null;
    const users = data?.users || [];
    return users.find(u => (u.email || '').toLowerCase() === String(email).toLowerCase()) || null;
  } catch {
    return null;
  }
}

// Cria ou atualiza o usuário no Supabase Auth com a senha informada
async function upsertAuthUser(email, password, usuario) {
  const existing = await findAuthUserByEmail(email);
  if (existing) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome: usuario.nome, nivel: usuario.nivel, filial: usuario.filial },
    });
    if (error) throw new Error(error.message);
  }
}

// Marca/desmarca a flag senha_definida no usuário
async function setSenhaDefinida(email, valor) {
  await supabaseAdmin
    .from('usuarios')
    .update({ senha_definida: valor })
    .eq('email', String(email).toLowerCase().trim());
}

// Gera token de sessão e retorna o redirect do dashboard conforme o nível
async function criarSessaoLogin(usuario) {
  const token = uuidv4();
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + SESSION_DURATION_MS);
  await sheets.ensureSheetExists('Sessoes', HEADER_MAP.SESSOES);
  await sheets.appendRow('Sessoes', [token, usuario.email, usuario.nivel, usuario.filial, agora.toISOString(), expiraEm.toISOString()]);

  const frontendUrl = process.env.FRONTEND_URL || 'https://sce-ebon.vercel.app';
  const dashboardMap = {
    [niveis.MATRIZ]: 'pages/matriz.html',
    [niveis.ADMIN_FILIAL]: 'pages/filial.html',
    [niveis.FILIAL]: 'pages/filial.html',
    [niveis.TECNICO]: 'pages/tecnico.html',
  };
  const dashboardPage = dashboardMap[usuario.nivel] || 'pages/matriz.html';
  const redirectUrl = `${frontendUrl}/${dashboardPage}`;
  return { token, redirectUrl };
}

async function getAllEquipamentos() {
  const { data, error } = await sheets.supabase
    .from('equipamentos')
    .select('*')
    .order('data_cadastro', { ascending: false });

  if (error) throw new Error(`Erro ao buscar equipamentos: ${error.message}`);
  return data || [];
}

async function registrarHistorico(equipamentoId, campo, valorAntigo, valorNovo, autor) {
  await sheets.ensureSheetExists('Historico_Itens', HEADER_MAP.HISTORICO);
  const id = uuidv4();
  await sheets.appendRow('Historico_Itens', [id, equipamentoId, campo, String(valorAntigo || ''), String(valorNovo || ''), autor, new Date()]);
}

async function registrarAuditoria(acao, usuarioEmail, detalhes) {
  try {
    await sheets.ensureSheetExists('Auditoria', HEADER_MAP.AUDITORIA);
    await sheets.appendRow('Auditoria', [new Date(), usuarioEmail || '', acao, typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes || {})]);
  } catch (e) {
    console.warn('Falha ao registrar auditoria:', e.message);
  }
}

async function cleanupExpiredSessions() {
  const data = await sheets.getValues('Sessoes');
  if (data.length <= 1) return;
  const now = Date.now();
  const rowsToDelete = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const expiraEm = Number(data[i][5]);
    if (isNaN(expiraEm) || now > expiraEm) rowsToDelete.push(i + 1);
  }
  for (const rowIndex of rowsToDelete.reverse()) {
    await sheets.deleteRow('Sessoes', rowIndex);
  }
}

// ============================================================
// LOGIN COM EMAIL/SENHA
// ============================================================

app.post('/api/login-password', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json(standardResponse(false, null, 'E-mail e senha são obrigatórios.'));

  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (error) return res.json(standardResponse(false, null, 'Credenciais inválidas.'));

  const usuario = await findUsuarioByEmail(email);
  if (!usuario || usuario.status === 'REMOVIDO' || usuario.status === 'Removido') {
    await supabaseAuth.auth.signOut();
    return res.json(standardResponse(false, null, 'Acesso não autorizado para este usuário.'));
  }

  const { token, redirectUrl } = await criarSessaoLogin(usuario);
  await registrarAuditoria('login', email, { via: 'password' });

  res.json(standardResponse(true, { message: 'Login realizado com sucesso.', token, redirectUrl }));
}));

// ============================================================
// PRIMEIRO ACESSO / DEFINIÇÃO DE SENHA
// ============================================================

app.post('/api/verificar-usuario', asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json(standardResponse(false, null, 'E-mail é obrigatório.'));

  const usuario = await findUsuarioByEmail(email);
  if (!usuario || usuario.status === 'REMOVIDO' || usuario.status === 'Removido') {
    return res.json(standardResponse(true, { existe: false }));
  }

  res.json(standardResponse(true, {
    existe: true,
    senhaDefinida: usuario.senhaDefinida !== false,
    nome: usuario.nome,
    nivel: usuario.nivel,
  }));
}));

app.post('/api/definir-senha', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json(standardResponse(false, null, 'E-mail e senha são obrigatórios.'));
  if (String(password).length < 6) return res.json(standardResponse(false, null, 'A senha deve ter pelo menos 6 caracteres.'));

  const usuario = await findUsuarioByEmail(email);
  if (!usuario || usuario.status === 'REMOVIDO' || usuario.status === 'Removido') {
    return res.json(standardResponse(false, null, 'Usuário não encontrado ou sem acesso.'));
  }
  if (usuario.senhaDefinida !== false) {
    return res.json(standardResponse(false, null, 'Este usuário já possui senha. Faça login normalmente.'));
  }

  await upsertAuthUser(email, password, usuario);
  await setSenhaDefinida(email, true);

  const { token, redirectUrl } = await criarSessaoLogin(usuario);
  await registrarAuditoria('definirSenha', email, { via: 'primeiro_acesso' });

  res.json(standardResponse(true, { message: 'Senha criada com sucesso.', token, redirectUrl }));
}));

app.post('/api/redefinir-senha', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token, [niveis.MATRIZ]);
  const { email, novaSenha } = req.body;
  if (!email || !novaSenha) return res.json(standardResponse(false, null, 'E-mail e nova senha são obrigatórios.'));
  if (String(novaSenha).length < 6) return res.json(standardResponse(false, null, 'A senha deve ter pelo menos 6 caracteres.'));

  const usuario = await findUsuarioByEmail(email);
  if (!usuario) return res.json(standardResponse(false, null, 'Usuário não encontrado.'));

  await upsertAuthUser(email, novaSenha, usuario);
  await setSenhaDefinida(email, true);
  await registrarAuditoria('redefinirSenha', session.email, { email });

  res.json(standardResponse(true, { message: 'Senha redefinida com sucesso.' }));
}));

// ============================================================
// ROTAS DE USUÁRIO
// ============================================================

app.get('/api/get-nome-usuario', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token);
  const usuario = await findUsuarioByEmail(session.email);
  res.json(standardResponse(true, { nome: usuario?.nome, nivel: session.nivel }));
}));

app.get('/api/listar-usuarios', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  await requireSession(token, [niveis.MATRIZ, niveis.ADMIN_FILIAL]);
  const data = await sheets.getValues('Usuarios');
  const usuarios = data.map(row => ({
    email: row.email,
    nome: row.nome,
    nivel: row.nivel,
    filial: row.filial,
    status: row.status,
    dataRemocao: row.data_remocao,
    senhaDefinida: row.senha_definida !== false,
  }));
  res.json(standardResponse(true, usuarios));
}));

app.post('/api/adicionar-usuario', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token, [niveis.MATRIZ, niveis.ADMIN_FILIAL]);
  const { email, nome, nivel, filial } = req.body;

  if (!email || !nome || !filial) return res.json(standardResponse(false, null, 'E-mail, nome e filial são obrigatórios.'));

  const existing = await findUsuarioByEmail(email);
  if (existing) return res.json(standardResponse(false, null, 'Usuário já existe com este e-mail.'));

  await sheets.ensureSheetExists('Usuarios', HEADER_MAP.USUARIOS);
  await sheets.appendRow('Usuarios', [email, nome, nivel || niveis.FILIAL, filial, statusUsuario.ATIVO, null, false]);
  await registrarAuditoria('adicionarUsuario', session.email, { email, nome, nivel, filial });

  res.json(standardResponse(true, { message: 'Usuário adicionado com sucesso.' }));
}));

app.post('/api/atualizar-usuario', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token, [niveis.MATRIZ]);
  const { emailOriginal, ...dados } = req.body;

  const usuario = await findUsuarioByEmail(emailOriginal);
  if (!usuario) return res.json(standardResponse(false, null, 'Usuário não encontrado.'));

  const updates = [];
  if (dados.nome !== undefined) updates.push({ row: usuario.rowIndex, col: 2, value: dados.nome });
  if (dados.nivel !== undefined) updates.push({ row: usuario.rowIndex, col: 3, value: dados.nivel });
  if (dados.filial !== undefined) updates.push({ row: usuario.rowIndex, col: 4, value: dados.filial });
  if (dados.status !== undefined) updates.push({ row: usuario.rowIndex, col: 5, value: dados.status });

  if (updates.length > 0) {
    await sheets.batchUpdateCells('Usuarios', updates);
    await registrarAuditoria('atualizarUsuario', session.email, { emailOriginal, dados });
  }

  res.json(standardResponse(true, { message: 'Usuário atualizado.' }));
}));

app.post('/api/remover-usuario', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token, [niveis.MATRIZ, niveis.ADMIN_FILIAL]);
  const { email } = req.body;

  const usuario = await findUsuarioByEmail(email);
  if (!usuario) return res.json(standardResponse(false, null, 'Usuário não encontrado.'));

  await sheets.batchUpdateCells('Usuarios', [{ row: usuario.rowIndex, col: 5, value: statusUsuario.REMOVIDO }, { row: usuario.rowIndex, col: 6, value: new Date() }]);
  await registrarAuditoria('removerUsuario', session.email, { email });

  res.json(standardResponse(true, { message: 'Usuário removido.' }));
}));

// ============================================================
// ROTAS DE LISTAS (CATEGORIA, MARCA, MODELO)
// ============================================================

app.get('/api/listas-cadastro', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  await requireSession(token);
  const data = await sheets.getValues('Listas');
  if (!data || data.length === 0) return res.json(standardResponse(true, []));

  const result = [];
  for (const row of data) {
    const cat = row.categoria ? String(row.categoria).trim() : '';
    const marca = row.marca ? String(row.marca).trim() : '';
    const modelo = row.modelo ? String(row.modelo).trim() : '';
    if (cat && marca && modelo) result.push({ categoria: cat, marca, modelo });
  }
  res.json(standardResponse(true, result));
}));

// ============================================================
// ROTAS DE EQUIPAMENTOS
// ============================================================

app.get('/api/equipamentos-da-filial', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token);
  const todos = await getAllEquipamentos();
  const filtrados = todos.filter(item => item.status !== 'Removido' && sheets.sessaoTemAcessoAUnidade(session, item.unidade));
  res.json(standardResponse(true, filtrados));
}));

app.get('/api/equipamentos-global', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const incluirRemovidos = req.query.incluirRemovidos === 'true';
  const session = await requireSession(token, niveis.MATRIZ);
  const todos = await getAllEquipamentos();
  const filtrados = todos.filter(item => incluirRemovidos || item.status !== 'Removido');
  res.json(standardResponse(true, filtrados));
}));

app.post('/api/create-equipamento', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token);
  const dados = req.body;

  const unidade = sheets.resolverUnidadeParaEscrita(session, dados.unidade);

  const patrimonio = (dados.patrimonio || '').trim();
  const justifPat = (dados.justificativaPatrimonio || '').trim();
  const serie = (dados.numeroSerie || '').trim();
  const justifSerie = (dados.justificativaNumeroSerie || '').trim();

  if (!patrimonio && !justifPat) return res.json(standardResponse(false, null, 'Informe o Patrimônio ou uma justificativa para a sua ausência.'));
  if (!serie && !justifSerie) return res.json(standardResponse(false, null, 'Informe o Número de Série ou uma justificativa para a sua ausência.'));

  const todos = await getAllEquipamentos();
  const duplicado = todos.some(e => e.status !== 'Removido' &&
    ((serie && String(e.numeroSerie || '').trim().toUpperCase() === serie.toUpperCase()) ||
     (patrimonio && String(e.patrimonio || '').trim().toUpperCase() === patrimonio.toUpperCase())));
  if (duplicado) return res.json(standardResponse(false, null, 'Já existe um equipamento com este Número de Série ou Patrimônio.'));

  if (dados.status === 'Extraviado') {
    if (!dados._anexoBoletim) return res.json(standardResponse(false, null, 'Para o status "Extraviado", o anexo do Boletim de Ocorrência é obrigatório.'));
  }

  const id = uuidv4();
  const now = new Date();
  const headers = HEADER_MAP.EQUIPAMENTOS;
  const linha = headers.map(h => {
    if (h === 'id') return id;
    if (h === 'unidade') return unidade;
    if (h === 'status') return dados.status || 'Disponível';
    if (h === 'vinculadoBlueMonitor') return dados.vinculadoBlueMonitor || 'Não';
    if (h === 'dataCadastro') return now;
    if (h === 'dataUltimaAtualizacao') return now;
    if (h === 'cadastradoPor') return session.email;
    if (h === 'ultimaAlteracaoPor') return session.email;
    if (h in dados) return dados[h];
    return null;
  });

  await sheets.appendRow('Equipamentos', linha);
  await registrarHistorico(id, 'criação', '', 'Equipamento cadastrado', session.email);
  await registrarAuditoria('createEquipamento', session.email, { id, unidade });

  res.json(standardResponse(true, { id }));
}));

app.post('/api/update-equipamento', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token);
  const { id, ...camposAlterados } = req.body;

  // Buscar equipamento atual
  const { data: equipAtual, error: errEquip } = await sheets.supabase
    .from('equipamentos')
    .select('*')
    .eq('id', id)
    .single();

  if (errEquip || !equipAtual) return res.json(standardResponse(false, null, 'Equipamento não encontrado.'));

  // Verificar permissão
  if (!sheets.sessaoTemAcessoAUnidade(session, equipAtual.unidade)) {
    return res.json(standardResponse(false, null, 'Você não tem permissão para editar este equipamento.'));
  }

  // Validação de duplicidade se alterou serie/patrimonio
  if (camposAlterados.numeroSerie !== undefined || camposAlterados.patrimonio !== undefined) {
    const serieNova = camposAlterados.numeroSerie !== undefined ? camposAlterados.numeroSerie : equipAtual.numeroSerie;
    const patNovo = camposAlterados.patrimonio !== undefined ? camposAlterados.patrimonio : equipAtual.patrimonio;
    const todos = await getAllEquipamentos();
    const duplicado = todos.some(e => e.id !== id && e.status !== 'Removido' &&
      ((serieNova && String(e.numeroSerie || '').trim().toUpperCase() === String(serieNova).trim().toUpperCase()) ||
       (patNovo && String(e.patrimonio || '').trim().toUpperCase() === String(patNovo).trim().toUpperCase())));
    if (duplicado) return res.json(standardResponse(false, null, 'Já existe outro equipamento com este Número de Série ou Patrimônio.'));
  }

  // Validações de status especial
  if (camposAlterados.status === 'Extraviado') {
    const anexoExistente = equipAtual.boletimOcorrenciaAnexoUrl;
    if (!camposAlterados._anexoBoletim && !anexoExistente && !camposAlterados.boletimOcorrenciaAnexoUrl) {
      return res.json(standardResponse(false, null, 'Para o status "Extraviado", anexe o Boletim de Ocorrência.'));
    }
  }

  const regrasStatus = {
    'Manutenção': 'numeroChamadoManutencao',
    'Extraviado': 'boletimOcorrencia',
    'Em verificação': 'justificativaVerificacao',
    'Quebrado': 'descricaoQuebrado',
  };
  const novoStatus = camposAlterados.status;
  if (novoStatus && regrasStatus[novoStatus]) {
    const campoObrig = regrasStatus[novoStatus];
    const valorFinal = camposAlterados[campoObrig] !== undefined ? camposAlterados[campoObrig] : equipAtual[campoObrig];
    if (!valorFinal) return res.json(standardResponse(false, null, `Para o status "${novoStatus}", o campo "${campoObrig}" é obrigatório.`));
  }

  // Preparar atualização (camelCase -> snake_case)
  const updates = {};
  const historico = [];

  Object.keys(camposAlterados).forEach(campo => {
    if (['id', 'dataCadastro', 'cadastradoPor'].includes(campo)) return;
    const valorAntigo = equipAtual[campo];
    const valorNovo = camposAlterados[campo];
    if (String(valorAntigo) === String(valorNovo)) return;
    updates[campo] = valorNovo;
    historico.push({ campo, antigo: valorAntigo, novo: valorNovo });
  });

  // Campos automáticos
  if (Object.keys(updates).length > 0) {
    updates.dataUltimaAtualizacao = new Date();
    updates.ultimaAlteracaoPor = session.email;
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await sheets.supabase
      .from('equipamentos')
      .update(updates)
      .eq('id', id);
    if (error) throw new Error(`Erro ao atualizar equipamento: ${error.message}`);
  }

  for (const h of historico) {
    await registrarHistorico(id, h.campo, h.antigo, h.novo, session.email);
  }
  if (historico.length > 0) {
    await registrarAuditoria('updateEquipamento', session.email, { id, campos: historico.map(h => h.campo) });
  }

  res.json(standardResponse(true));
}));

app.post('/api/clone-equipamento', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token);
  const { idOrigem } = req.body;

  const data = await sheets.getValues('Equipamentos');
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const unidadeCol = headers.indexOf('unidade');
  const statusCol = headers.indexOf('status');
  const rowIndex = sheets.findRowIndex(data, idCol, idOrigem);
  if (rowIndex === -1) return res.json(standardResponse(false, null, 'Equipamento não encontrado.'));

  const linhaOrigem = data[rowIndex - 1];
  if (!sheets.sessaoTemAcessoAUnidade(session, linhaOrigem[unidadeCol])) {
    return res.json(standardResponse(false, null, 'Você não tem permissão para clonar este equipamento.'));
  }

  const novoId = uuidv4();
  const novaLinha = [...linhaOrigem];
  novaLinha[idCol] = novoId;
  novaLinha[statusCol] = 'Disponível';
  const setIf = (arr, header, value) => { const i = headers.indexOf(header); if (i !== -1) arr[i] = value; };
  setIf(novaLinha, 'numeroSerie', '');
  setIf(novaLinha, 'patrimonio', '');
  setIf(novaLinha, 'dataCadastro', new Date());
  setIf(novaLinha, 'dataUltimaAtualizacao', new Date());
  setIf(novaLinha, 'cadastradoPor', session.email);
  setIf(novaLinha, 'ultimaAlteracaoPor', session.email);

  await sheets.appendRow('Equipamentos', novaLinha);
  await registrarHistorico(novoId, 'criação', '', `Clonado a partir de ${idOrigem}`, session.email);
  await registrarAuditoria('cloneEquipamento', session.email, { idOrigem, novoId });

  res.json(standardResponse(true, { id: novoId }));
}));

app.post('/api/remover-equipamento', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token, [niveis.MATRIZ, niveis.ADMIN_FILIAL]);
  const { id } = req.body;

  const { data: equipAtual, error } = await sheets.supabase
    .from('equipamentos')
    .select('unidade, status')
    .eq('id', id)
    .single();

  if (error || !equipAtual) return res.json(standardResponse(false, null, 'Equipamento não encontrado.'));

  if (!sheets.sessaoTemAcessoAUnidade(session, equipAtual.unidade)) {
    return res.json(standardResponse(false, null, 'Você não tem permissão para remover este equipamento.'));
  }

  const statusAntigo = equipAtual.status;
  const { error: updError } = await sheets.supabase
    .from('equipamentos')
    .update({ status: 'Removido' })
    .eq('id', id);

  if (updError) throw new Error(`Erro ao remover equipamento: ${updError.message}`);

  await registrarHistorico(id, 'status', statusAntigo, 'Removido', session.email);
  await registrarAuditoria('removerEquipamento', session.email, { id });

  res.json(standardResponse(true, { message: 'Equipamento removido (soft-delete).' }));
}));

app.post('/api/atualizar-status-manutencao', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token);
  const { equipamentoId, novoStatus } = req.body;

  if (!statusManutencaoValidos.includes(novoStatus)) {
    return res.json(standardResponse(false, null, 'Status de manutenção inválido.'));
  }

  const { data: equipAtual, error } = await sheets.supabase
    .from('equipamentos')
    .select('unidade, statusManutencao')
    .eq('id', equipamentoId)
    .single();

  if (error || !equipAtual) return res.json(standardResponse(false, null, 'Equipamento não encontrado.'));

  if (!sheets.sessaoTemAcessoAUnidade(session, equipAtual.unidade)) {
    return res.json(standardResponse(false, null, 'Você não tem permissão para alterar este equipamento.'));
  }

  const statusAntigo = equipAtual.statusManutencao;
  if (String(statusAntigo) === String(novoStatus)) return res.json(standardResponse(true));

  const { error: updError } = await sheets.supabase
    .from('equipamentos')
    .update({ statusManutencao: novoStatus, ultimaAlteracaoPor: session.email, dataUltimaAtualizacao: new Date() })
    .eq('id', equipamentoId);

  if (updError) throw new Error(`Erro ao atualizar status: ${updError.message}`);

  await registrarHistorico(equipamentoId, 'statusManutencao', statusAntigo, novoStatus, session.email);
  await registrarAuditoria('atualizarStatusManutencao', session.email, { id: equipamentoId, novoStatus });

  res.json(standardResponse(true));
}));

// ============================================================
// ROTAS DE MANUTENÇÃO
// ============================================================

app.get('/api/registros-manutencao', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  await requireSession(token);
  const { equipamentoId } = req.query;

  const { data, error } = await sheets.supabase
    .from('registros_manutencao')
    .select('*')
    .eq('equipamento_id', equipamentoId)
    .order('data', { ascending: false });

  if (error) throw new Error(`Erro ao buscar manutenções: ${error.message}`);
  res.json(standardResponse(true, data || []));
}));

app.post('/api/registrar-manutencao', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token);
  const { equipamentoId, descricao, status } = req.body;

  if (!descricao?.trim()) return res.json(standardResponse(false, null, 'Descrição é obrigatória.'));

  const id = uuidv4();
  const { error } = await sheets.supabase
    .from('registros_manutencao')
    .insert({
      id,
      equipamento_id: equipamentoId,
      autor: session.email,
      data: new Date().toISOString(),
      descricao,
      status: status || 'Pendente',
    });

  if (error) throw new Error(`Erro ao registrar manutenção: ${error.message}`);

  // Atualiza statusManutencao no equipamento também
  await sheets.supabase
    .from('equipamentos')
    .update({ statusManutencao: status || 'Pendente' })
    .eq('id', equipamentoId);

  res.json(standardResponse(true));
}));

// ============================================================
// ROTAS DE HISTÓRICO
// ============================================================

app.get('/api/historico-equipamento', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  await requireSession(token);
  const { equipamentoId } = req.query;

  const { data, error } = await sheets.supabase
    .from('historico_itens')
    .select('*')
    .eq('equipamento_id', equipamentoId)
    .order('data', { ascending: false });

  if (error) throw new Error(`Erro ao buscar histórico: ${error.message}`);
  res.json(standardResponse(true, data || []));
}));

// ============================================================
// ROTAS DE EMPRÉSTIMOS
// ============================================================

app.get('/api/filiais-para-emprestimo', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  await requireSession(token);
  const { data, error } = await sheets.supabase
    .from('filiais')
    .select('nome')
    .eq('ativo', true)
    .order('nome');

  if (error) throw new Error(`Erro ao buscar filiais: ${error.message}`);
  res.json(standardResponse(true, (data || []).map(r => r.nome)));
}));

app.post('/api/registrar-emprestimo', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token);
  const { ids, ...dados } = req.body;

  if (!ids?.length) return res.json(standardResponse(false, null, 'Nenhum equipamento selecionado.'));
  if (!dados.responsavel) return res.json(standardResponse(false, null, 'Responsável é obrigatório.'));
  if (dados.tipoEmprestimo === 'interestadual' && !dados.escolaDestino) {
    return res.json(standardResponse(false, null, 'Escola de destino é obrigatória para empréstimo inter-escolar.'));
  }

  const now = new Date();

  for (const id of ids) {
    const { data: equip, error: equipError } = await sheets.supabase
      .from('equipamentos')
      .select('patrimonio, unidade')
      .eq('id', id)
      .single();

    if (equipError || !equip) continue;

    const empId = uuidv4();
    const { error: empError } = await sheets.supabase
      .from('emprestimos')
      .insert({
        id: empId,
        equipamento_id: id,
        patrimonio: equip.patrimonio || '',
        unidade: equip.unidade || '',
        responsavel: dados.responsavel,
        cpf: dados.cpf || '',
        email_responsavel: dados.emailResponsavel || '',
        data_emprestimo: now.toISOString(),
        data_prevista_devolucao: dados.dataPrevistaDevolucao,
        data_devolucao: null,
        status: 'Emprestado',
        termo_pdf_url: '',
        criado_por: session.email,
        devolvido_por: null,
        observacoes: dados.observacoes || '',
        tipo_emprestimo: dados.tipoEmprestimo,
        escola_destino: dados.escolaDestino || '',
      });

    if (empError) console.error(`Erro ao criar empréstimo para ${id}:`, empError.message);

    // Atualiza status do equipamento
    await sheets.supabase
      .from('equipamentos')
      .update({ status: 'Emprestado' })
      .eq('id', id);

    await registrarHistorico(id, 'status', 'Disponível', 'Emprestado', session.email);
  }

  await registrarAuditoria('registrarEmprestimo', session.email, { ids, ...dados });
  res.json(standardResponse(true, { message: 'Empréstimo(s) registrado(s).' }));
}));

app.post('/api/registrar-devolucao', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token);
  const { ids, observacao } = req.body;

  if (!ids?.length) return res.json(standardResponse(false, null, 'Nenhum equipamento selecionado.'));

  const now = new Date();

  for (const id of ids) {
    // Encontra empréstimo ativo
    const { data: empAtivo, error: empError } = await sheets.supabase
      .from('emprestimos')
      .select('id')
      .eq('equipamento_id', id)
      .eq('status', 'Emprestado')
      .single();

    if (empError || !empAtivo) continue;

    // Atualiza empréstimo
    await sheets.supabase
      .from('emprestimos')
      .update({
        status: 'Devolvido',
        devolvido_por: session.email,
        data_devolucao: now.toISOString(),
        observacoes: observacao || '',
      })
      .eq('id', empAtivo.id);

    // Atualiza equipamento
    const { data: equipAtual } = await sheets.supabase
      .from('equipamentos')
      .select('status')
      .eq('id', id)
      .single();

    const statusAntigo = equipAtual?.status || 'Emprestado';
    await sheets.supabase
      .from('equipamentos')
      .update({ status: 'Disponível' })
      .eq('id', id);

    await registrarHistorico(id, 'status', statusAntigo, 'Disponível', session.email);
  }

  await registrarAuditoria('registrarDevolucao', session.email, { ids, observacao });
  res.json(standardResponse(true, { message: 'Devolução(s) registrada(s).' }));
}));

// ============================================================
// ROTAS DE ESPECIFICAÇÕES
// ============================================================

app.get('/api/especificacoes-modelo', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  await requireSession(token);
  const { modelo } = req.query;

  if (!modelo) return res.json(standardResponse(false, null, 'Modelo não informado.'));

  // Busca o último equipamento com esse modelo
  const { data, error } = await sheets.supabase
    .from('equipamentos')
    .select('sistema_operacional, processador, memoria_ram, armazenamento, tamanho_tela')
    .eq('modelo', modelo)
    .order('data_cadastro', { ascending: false })
    .limit(1);

  if (error) throw new Error(`Erro ao buscar especificações: ${error.message}`);
  if (!data || data.length === 0) return res.json(standardResponse(true, null));

  res.json(standardResponse(true, data[0]));
}));

// ============================================================
// ROTAS DE EXPORTAÇÃO
// ============================================================

app.get('/api/exportar-csv', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  await requireSession(token);

  const equipamentos = await getAllEquipamentos();
  const headers = HEADER_MAP.EQUIPAMENTOS;
  const csv = [headers.join(',')];
  for (const eq of equipamentos) {
    csv.push(headers.map(h => `"${String(eq[h] || '').replace(/"/g, '""')}"`).join(','));
  }
  res.json(standardResponse(true, { csv: csv.join('\n'), fileName: `sce-equipamentos-${Date.now()}.csv` }));
}));

app.post('/api/exportar-pdf', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  await requireSession(token);
  // Em produção, gerar PDF com pdfkit ou puppeteer
  const url = `${process.env.APP_URL || 'http://localhost:3000'}/relatorio.pdf`;
  res.json(standardResponse(true, { url, message: 'PDF gerado.' }));
}));

// ============================================================
// ROTAS DE DIAGNÓSTICO
// ============================================================

app.get('/api/testar-planilha', asyncHandler(async (req, res) => {
  try {
    const { data, error } = await sheets.supabase
      .from('equipamentos')
      .select('*')
      .limit(1);
    if (error) throw error;
    res.json(standardResponse(true, {
      totalLinhas: data?.length || 0,
      cabecalho: HEADER_MAP.EQUIPAMENTOS,
      primeiraLinha: data?.[0] || null,
    }));
  } catch (err) {
    res.json(standardResponse(false, null, `Erro ao ler equipamentos: ${err.message}`));
  }
}));

app.get('/api/testar-leitura-equipamentos', asyncHandler(async (req, res) => {
  try {
    const todos = await getAllEquipamentos();
    res.json(standardResponse(true, {
      total: todos.length,
      primeiros: todos.slice(0, 3),
      colunas: todos.length > 0 ? Object.keys(todos[0]) : [],
    }));
  } catch (e) {
    res.json(standardResponse(false, null, e.message));
  }
}));

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => res.json(standardResponse(true, { status: 'ok', timestamp: new Date().toISOString() })));

// ============================================================
// ROTAS ADICIONAIS PARA FRONT-END
// ============================================================

// Unidades do técnico
app.get('/api/tecnico-unidades', asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const session = await requireSession(token, [niveis.TECNICO]);
  const unidades = session.filial ? session.filial.split(',').map(u => u.trim()).filter(u => u.length > 0) : [];
  res.json(standardResponse(true, unidades));
}));

// ============================================================
// SERVE STATIC FILES (Vite build output)
// ============================================================
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, 'dist');

// Serve static files from dist
app.use(express.static(distPath));

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/health')) {
    return next();
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});

export default app;