import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import 'dotenv/config';

import sheets, { supabase as supabaseAdmin, toCamelCase, toSnakeCase, chaveUnidade } from './supabaseService.js';
import {
  securityHeaders, corsOptions, limiteGeral, limiteAuth, limiteEscrita,
  extrairToken, verificarTokenPortal, politicaSenha,
  exigirAcessoAEquipamento, registrarLeitorEquipamento,
  validarAnexoBoletim, normalizarCaminhoAnexo, escaparFiltroPostgrest,
  HttpError, naoAutorizado, negado,
} from './security.js';

const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const app = express();

// Atrás de proxy (Render/Vercel/Cloud Run) o `req.ip` viria do proxy e o
// rate limiter contaria o proxy inteiro como um único cliente.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet(securityHeaders));
app.use(cors(corsOptions()));
// 10MB: o maior payload é o anexo do B.O. em base64 (~8MB binário).
app.use(express.json({ limit: '10mb' }));
app.use(limiteGeral);

const standardResponse = (success, data = null, error = null) => ({
  success,
  data,
  error,
});

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Leitor de equipamento injetado em `security.js` (evita import circular com
 * `supabaseService.js`, que é importado por `server.js`).
 */
registrarLeitorEquipamento(async (id) => {
  const { data, error } = await sheets.supabase
    .from('equipamentos')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return { data: data ? toCamelCase(data) : null, error };
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
  USUARIOS: ['email', 'nome', 'nivel', 'filial', 'status', 'dataRemocao', 'senhaDefinida', 'papelUnidade'],
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

// ============================================================
// SSO — access token JWT emitido pelo PORTAL (backend de chamados)
// O SCE valida a assinatura com o segredo compartilhado (SSO_SECRET)
// e resolve usuário/nível/filial na PRÓPRIA tabela usuarios.
// ============================================================
const SSO_SECRET = process.env.SSO_SECRET || null;

async function trySsoSession(token) {
  if (!SSO_SECRET) return null;
  // Algoritmo fixado: sem `algorithms`, o `jsonwebtoken` aceita qualquer alg
  // da família HMAC e o payload deixa de ser confiável.
  const payload = verificarTokenPortal(token);
  if (!payload || payload.type !== 'access' || !payload.email) return null;
  const usuario = await findUsuarioByEmail(payload.email);
  if (!usuario || usuario.status !== statusUsuario.ATIVO) return null;
  return {
    token: `sso:${payload.sub || usuario.email}`,
    email: usuario.email,
    nivel: usuario.nivel,
    filial: usuario.filial,
    papelUnidade: usuario.papelUnidade,
    sso: true,
  };
}

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
      return { token: sheetToken, email: sheetEmail, nivel: row.nivel, filial: row.filial, papelUnidade: usuario.papelUnidade };
    }
  }
  // Não achou sessão local: aceita JWT do portal (SSO)
  return await trySsoSession(token);
}

async function requireSession(token, niveisPermitidos = null) {
  const session = await validateSession(token);
  if (!session) throw naoAutorizado();
  if (niveisPermitidos) {
    const allowed = Array.isArray(niveisPermitidos) ? niveisPermitidos : [niveisPermitidos];
    if (!allowed.includes(session.nivel)) throw negado();
  }
  return session;
}

// ============================================================
// ESCOLA FILHA — SOMENTE LEITURA EM EQUIPAMENTOS
// Escolas irmãs (mesmo prédio) compartilham o painel de
// equipamentos do grupo, mas a FILHA não administra esse painel:
// ela apenas visualiza. A distinção vem do portal (que conhece a
// lista-mestra MÃE/FILHA) e chega aqui por `usuarios.papel_unidade`
// (sync interno). NULL = não sincronizado ainda → comportamento
// antigo, sem risco de travar a MÃE.
// ============================================================
const PAPEL_FILHA = 'FILHA';
const SOMENTE_LEITURA_MSG =
  'Sua unidade divide o prédio com outra escola e tem acesso somente de visualização aos equipamentos. ' +
  'Para alterar, cadastrar ou remover equipamentos, solicite à escola principal do grupo.';

function sessaoSomenteLeitura(session) {
  return String(session?.papelUnidade || '').toUpperCase() === PAPEL_FILHA;
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
        papelUnidade: row.papel_unidade || null,
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
  const usuario = await findUsuarioByEmail(email);
  if (!usuario) return;
  const { error } = await supabaseAdmin
    .from('usuarios')
    .update({ senha_definida: valor })
    .eq('email', usuario.email);
  if (error) throw new Error(error.message);
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
  // PostgREST limita a 1000 linhas por requisição; paginamos em blocos para ler tudo.
  const BLOCO = 1000;
  const todos = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sheets.supabase
      .from('equipamentos')
      .select('*')
      .order('data_cadastro', { ascending: false })
      .range(offset, offset + BLOCO - 1);
    if (error) throw new Error(`Erro ao buscar equipamentos: ${error.message}`);
    todos.push(...(data || []));
    if (!data || data.length < BLOCO) break;
    offset += BLOCO;
  }
  return todos.map(item => toCamelCase(item));
}

// ============================================================
// NOME OFICIAL DAS UNIDADES
// `equipamentos.unidade` é TEXT livre: a mesma escola pode estar
// gravada como "E.E. HAYDEE HIDALGO" (oficial, de `filiais`) ou
// "Haydee Hidalgo Professora" (legado). Agrupar pela string exata
// fazia a escola aparecer duplicada no filtro de unidades. O índice
// resolve as duas para o nome oficial.
// ============================================================
const TTL_INDICE_UNIDADES_MS = 5 * 60 * 1000;
let cacheIndiceUnidades = { em: 0, indice: null };

/** Índice oficial (nomes de `filiais`) com cache curto — a lista muda pouco. */
async function indiceUnidades(forcar = false) {
  const agora = Date.now();
  if (!forcar && cacheIndiceUnidades.indice && agora - cacheIndiceUnidades.em < TTL_INDICE_UNIDADES_MS) {
    return cacheIndiceUnidades.indice;
  }
  const { data, error } = await sheets.supabase.from('filiais').select('nome');
  if (error) throw new Error(`Erro ao ler filiais: ${error.message}`);
  const indice = sheets.criarIndiceUnidades((data || []).map((f) => f.nome));
  cacheIndiceUnidades = { em: agora, indice };
  return indice;
}

/**
 * Resolve o nome oficial de uma unidade para gravação/exibição. Ao não achar,
 * recarrega o índice uma vez — cobre a filial recém-cadastrada que ainda não
 * entrou no cache — e só então mantém o texto de origem.
 */
async function resolverNomeOficial(nome) {
  const alvo = String(nome || '').trim();
  if (!alvo) return { nome: '', oficial: null };
  let oficial = (await indiceUnidades()).canonico(alvo);
  if (!oficial) oficial = (await indiceUnidades(true)).canonico(alvo);
  return { nome: oficial || alvo, oficial };
}

/**
 * Grafias de `unidade` que existem de fato na coluna (as legadas inclusas).
 * O filtro de unidade precisa delas para responder pela escola inteira,
 * mesmo antes de a migração de dados rodar.
 */
async function listarGrafiasUnidade() {
  const BLOCO = 1000;
  const grafias = new Set();
  let offset = 0;
  while (true) {
    const { data, error } = await sheets.supabase
      .from('equipamentos')
      .select('unidade')
      .range(offset, offset + BLOCO - 1);
    if (error) throw new Error(`Erro ao ler unidades: ${error.message}`);
    for (const linha of data || []) {
      const g = String(linha.unidade || '').trim();
      if (g) grafias.add(g);
    }
    if (!data || data.length < BLOCO) break;
    offset += BLOCO;
  }
  return [...grafias];
}

// ============================================================
// STORAGE (ANEXOS) - Supabase Storage (bucket privado)
// ============================================================
const STORAGE_BUCKET = 'anexos';

/**
 * Upload do anexo do Boletim de Ocorrência.
 *
 * Antes aceitava qualquer `mimeType` declarado pelo cliente e usava a
 * extensão do NOME do arquivo. Um HTML/SVG com script ficava armazenado e
 * era servido por URL assinada — XSS armazenado para quem abrisse o anexo.
 * Agora o tipo é derivado dos magic bytes e a extensão vem dessa verificação.
 */
async function uploadAnexoBoletim(base64) {
  if (!base64) return null;

  const check = validarAnexoBoletim(base64);
  if (!check.ok) throw new Error(check.erro);

  const nomeBase = `anexo.${check.extensao}`;
  const path = `boletins/${uuidv4()}-${nomeBase}`;
  const { error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(path, check.buffer, { contentType: check.mimeType, upsert: false });
  if (error) throw new Error('Erro ao salvar anexo.');
  return path;
}

async function gerarUrlAnexo(path) {
  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error) throw new Error(`Erro ao gerar link do anexo: ${error.message}`);
  return data?.signedUrl || null;
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

app.post('/api/login-password', limiteAuth, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json(standardResponse(false, null, 'E-mail e senha são obrigatórios.'));

  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (error || !data?.user) return res.json(standardResponse(false, null, 'Credenciais inválidas.'));

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

/**
 * Existence check do primeiro acesso.
 *
 * Antes devolvia também `nome` e `nivel` sem autenticação — qualquer pessoa
 * podia listar nome e PERFIL DE ACESSO de cada professor/dirigente da rede
 * (enumeration). Agora responde só o necessário para o fluxo de senha.
 */
app.post('/api/verificar-usuario', limiteAuth, asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json(standardResponse(false, null, 'E-mail é obrigatório.'));

  const usuario = await findUsuarioByEmail(email);
  if (!usuario || usuario.status === 'REMOVIDO' || usuario.status === 'Removido') {
    return res.json(standardResponse(true, { existe: false }));
  }

  res.json(standardResponse(true, {
    existe: true,
    senhaDefinida: usuario.senhaDefinida !== false,
  }));
}));

app.post('/api/definir-senha', limiteAuth, asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json(standardResponse(false, null, 'E-mail e senha são obrigatórios.'));

  const usuario = await findUsuarioByEmail(email);
  if (!usuario || usuario.status === 'REMOVIDO' || usuario.status === 'Removido') {
    return res.json(standardResponse(false, null, 'Usuário não encontrado ou sem acesso.'));
  }
  if (usuario.senhaDefinida !== false) {
    return res.json(standardResponse(false, null, 'Este usuário já possui senha. Faça login normalmente.'));
  }

  const politica = politicaSenha.validar(password);
  if (!politica.valida) {
    return res.json(standardResponse(false, null, politica.erros.join(' ')));
  }

  await upsertAuthUser(email, password, usuario);
  await setSenhaDefinida(email, true);

  const { token, redirectUrl } = await criarSessaoLogin(usuario);
  await registrarAuditoria('definirSenha', email, { via: 'primeiro_acesso' });

  res.json(standardResponse(true, { message: 'Senha criada com sucesso.', token, redirectUrl }));
}));

app.post('/api/redefinir-senha', limiteAuth, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token, [niveis.MATRIZ, niveis.ADMIN_FILIAL]);
  const { email, novaSenha } = req.body;
  if (!email || !novaSenha) return res.json(standardResponse(false, null, 'E-mail e nova senha são obrigatórios.'));

  const politica = politicaSenha.validar(novaSenha);
  if (!politica.valida) {
    return res.json(standardResponse(false, null, politica.erros.join(' ')));
  }

  const usuario = await findUsuarioByEmail(email);
  if (!usuario) return res.json(standardResponse(false, null, 'Usuário não encontrado.'));

  if (session.nivel === niveis.ADMIN_FILIAL && usuario.filial !== session.filial) {
    return res.json(standardResponse(false, null, 'Você só pode redefinir senha de usuários da sua própria filial.'));
  }

  await upsertAuthUser(email, novaSenha, usuario);
  await setSenhaDefinida(email, true);
  await registrarAuditoria('redefinirSenha', session.email, { email });

  res.json(standardResponse(true, { message: 'Senha redefinida com sucesso.' }));
}));

/**
 * Logout.
 *
 * Não existia: a sessão (24h) continuava válida na tabela `sessoes` mesmo
 * depois de o usuário sair pela interface.
 */
app.post('/api/logout', asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  if (token && !token.startsWith('sso:')) {
    await sheets.supabase.from('sessoes').delete().eq('token', token);
  }
  await registrarAuditoria('logout', '', { via: token?.startsWith('sso:') ? 'sso' : 'sessao' });
  res.json(standardResponse(true, { message: 'Sessão encerrada.' }));
}));

// ============================================================
// SYNC DE USUÁRIOS (chamados → SCE)
// Endpoint interno chamado pelo backend de chamados sempre que um
// usuário é criado/editado/desativado no portal. Protegido por chave
// compartilhada (SCE_SYNC_KEY) — NUNCA expor ao frontend.
// ============================================================
const SYNC_KEY = process.env.SCE_SYNC_KEY || null;

/**
 * Comparação em tempo constante.
 *
 * `req.headers['x-sync-key'] !== SYNC_KEY` retornava assim que um byte
 * divergia, o que permitia descobrir a chave um caractere por tentativa.
 */
function chaveConfere(informada) {
  if (!SYNC_KEY || typeof informada !== 'string' || informada.length !== SYNC_KEY.length) return false;
  return crypto.timingSafeEqual(Buffer.from(informada), Buffer.from(SYNC_KEY));
}

const MAPA_NIVEL_PORTAL_PARA_SCE = {
  ADMIN: niveis.MATRIZ,
  GESTOR: niveis.ADMIN_FILIAL,
  TECNICO: niveis.TECNICO,
  VISUALIZADOR: niveis.FILIAL,
};

app.post('/api/internal/sync-usuario', asyncHandler(async (req, res) => {
  if (!SYNC_KEY) return res.status(503).json(standardResponse(false, null, 'Sync não configurado.'));
  if (!chaveConfere(req.headers['x-sync-key'])) {
    return res.status(401).json(standardResponse(false, null, 'Não autorizado.'));
  }

  const { email, nome, nivel, filial, status, papelUnidade } = req.body || {};
  if (!email || !nome || !nivel) {
    return res.json(standardResponse(false, null, 'email, nome e nivel são obrigatórios.'));
  }
  const nivelSce = MAPA_NIVEL_PORTAL_PARA_SCE[String(nivel).toUpperCase()];
  if (!nivelSce) {
    return res.json(standardResponse(false, null, `Nível desconhecido: ${nivel}`));
  }

  // Papel no grupo de escolas irmãs: 'MAE' administra o painel compartilhado,
  // 'FILHA' só visualiza. Ausente/desconhecido => null (sem restrição).
  const papel = String(papelUnidade || '').trim().toUpperCase();
  const papelUnidadeSce = papel === 'MAE' || papel === 'FILHA' ? papel : null;

  const emailNorm = String(email).trim().toLowerCase();
  const inativo = String(status || 'ATIVO').toUpperCase() !== 'ATIVO';
  const agora = new Date().toISOString();

  const existente = await findUsuarioByEmail(emailNorm);
  if (existente) {
    const { error } = await supabaseAdmin
      .from('usuarios')
      .update({
        nome: String(nome).trim(),
        nivel: nivelSce,
        filial: String(filial || '').trim(),
        papel_unidade: papelUnidadeSce,
        status: inativo ? statusUsuario.REMOVIDO : statusUsuario.ATIVO,
        data_remocao: inativo ? agora : null,
        atualizado_em: agora,
      })
      .eq('email', existente.email);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseAdmin
      .from('usuarios')
      .insert({
        email: emailNorm,
        nome: String(nome).trim(),
        nivel: nivelSce,
        filial: String(filial || '').trim(),
        papel_unidade: papelUnidadeSce,
        status: inativo ? statusUsuario.REMOVIDO : statusUsuario.ATIVO,
        data_remocao: inativo ? agora : null,
        senha_definida: false,
        criado_em: agora,
        atualizado_em: agora,
      });
    if (error) throw new Error(error.message);
  }

  await registrarAuditoria('syncUsuario', 'portal-sync', { email: emailNorm, nivel: nivelSce, papelUnidade: papelUnidadeSce, inativo });
  res.json(standardResponse(true, { email: emailNorm, nivel: nivelSce, papelUnidade: papelUnidadeSce }));
}));

// ============================================================
// ROTAS DE USUÁRIO
// ============================================================

app.get('/api/get-nome-usuario', asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token);
  const usuario = await findUsuarioByEmail(session.email);
  res.json(standardResponse(true, { nome: usuario?.nome, nivel: session.nivel, filial: session.filial, email: session.email }));
}));

app.get('/api/listar-usuarios', asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token, [niveis.MATRIZ, niveis.ADMIN_FILIAL]);
  const data = await sheets.getValues('Usuarios');
  let usuarios = data.map(row => ({
    email: row.email,
    nome: row.nome,
    nivel: row.nivel,
    filial: row.filial,
    status: row.status,
    dataRemocao: row.data_remocao,
    senhaDefinida: row.senha_definida !== false,
  }));
  if (session.nivel === niveis.ADMIN_FILIAL) {
    usuarios = usuarios.filter(u => u.filial === session.filial);
  }
  res.json(standardResponse(true, usuarios));
}));

app.post('/api/adicionar-usuario', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token, [niveis.MATRIZ, niveis.ADMIN_FILIAL]);
  let { email, nome, nivel, filial, senhaTemporaria } = req.body;

  if (session.nivel === niveis.ADMIN_FILIAL) {
    // AdminFilial cria apenas usuários "Filial" na própria unidade
    nivel = niveis.FILIAL;
    filial = session.filial;
    const data = await sheets.getValues('Usuarios');
    const outrosAtivos = data.filter(row =>
      row.filial === session.filial &&
      row.status !== 'Removido' &&
      String(row.email).trim().toLowerCase() !== String(session.email).trim().toLowerCase()
    ).length;
    if (outrosAtivos >= 2) {
      return res.json(standardResponse(false, null, 'Limite atingido: uma filial pode ter no máximo 2 usuários além do administrador.'));
    }
  }

  if (!email || !nome || !filial) return res.json(standardResponse(false, null, 'E-mail, nome e filial são obrigatórios.'));

  const existing = await findUsuarioByEmail(email);
  if (existing) return res.json(standardResponse(false, null, 'Usuário já existe com este e-mail.'));

  await sheets.ensureSheetExists('Usuarios', HEADER_MAP.USUARIOS);
  await sheets.appendRow('Usuarios', [email, nome, nivel || niveis.FILIAL, filial, statusUsuario.ATIVO, null, false]);

  // Se informada, cria o usuário no Supabase Auth com a senha temporária
  // (senha_definida permanece false, forçando redefinição no primeiro acesso)
  if (senhaTemporaria && String(senhaTemporaria).length >= 6) {
    try {
      await upsertAuthUser(email, senhaTemporaria, { nome, nivel: nivel || niveis.FILIAL, filial });
    } catch (e) {
      console.warn('Falha ao criar usuário no Auth (senha temporária):', e.message);
    }
  }

  await registrarAuditoria('adicionarUsuario', session.email, { email, nome, nivel, filial });

  res.json(standardResponse(true, { message: 'Usuário adicionado com sucesso.' }));
}));

app.post('/api/atualizar-usuario', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token, [niveis.MATRIZ, niveis.ADMIN_FILIAL]);
  const { emailOriginal, ...dados } = req.body;

  const usuario = await findUsuarioByEmail(emailOriginal);
  if (!usuario) return res.json(standardResponse(false, null, 'Usuário não encontrado.'));

  if (session.nivel === niveis.ADMIN_FILIAL && usuario.filial !== session.filial) {
    return res.json(standardResponse(false, null, 'Você só pode editar usuários da sua própria filial.'));
  }

  const updates = {};
  if (dados.nome !== undefined) updates.nome = dados.nome;
  if (session.nivel === niveis.MATRIZ) {
    if (dados.nivel !== undefined) updates.nivel = dados.nivel;
    if (dados.filial !== undefined) updates.filial = dados.filial;
    if (dados.status !== undefined) updates.status = dados.status;
  }

  if (Object.keys(updates).length > 0) {
    await supabaseAdmin.from('usuarios').update(updates).eq('email', usuario.email);
    await registrarAuditoria('atualizarUsuario', session.email, { emailOriginal, updates });
  }

  res.json(standardResponse(true, { message: 'Usuário atualizado.' }));
}));

app.post('/api/remover-usuario', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token, [niveis.MATRIZ, niveis.ADMIN_FILIAL]);
  const { email } = req.body;

  const usuario = await findUsuarioByEmail(email);
  if (!usuario) return res.json(standardResponse(false, null, 'Usuário não encontrado.'));

  if (session.nivel === niveis.ADMIN_FILIAL && usuario.filial !== session.filial) {
    return res.json(standardResponse(false, null, 'Você só pode remover usuários da sua própria filial.'));
  }

  await supabaseAdmin.from('usuarios')
    .update({ status: statusUsuario.REMOVIDO, data_remocao: new Date().toISOString() })
    .eq('email', usuario.email);
  await registrarAuditoria('removerUsuario', session.email, { email });

  res.json(standardResponse(true, { message: 'Usuário removido.' }));
}));

// ============================================================
// ROTAS DE LISTAS (CATEGORIA, MARCA, MODELO)
// ============================================================

app.get('/api/listas-cadastro', asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  await requireSession(token);
  const data = await sheets.getValues('Listas');
  if (!data || data.length === 0) return res.json(standardResponse(true, []));

  const result = [];
  for (const row of data) {
    const cat = row.categoria ? String(row.categoria).trim() : '';
    const marca = row.marca ? String(row.marca).trim() : '';
    const modelo = row.modelo ? String(row.modelo).trim() : '';
    if (cat) result.push({ id: row.id, categoria: cat, marca, modelo });
  }
  res.json(standardResponse(true, result));
}));

// Gerenciamento do catálogo (somente Matriz)
app.post('/api/listas-adicionar', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token, niveis.MATRIZ);
  const { categoria, marca, modelo } = req.body || {};
  const c = String(categoria || '').trim();
  const m = String(marca || '').trim();
  const mo = String(modelo || '').trim();
  if (!c) return res.json(standardResponse(false, null, 'Categoria é obrigatória.'));

  // dedup (case-insensitive) — marca/modelo vazios comparam como vazios
  const existentes = await sheets.getValues('Listas');
  const dup = existentes.find(r =>
    String(r.categoria || '').trim().toLowerCase() === c.toLowerCase() &&
    String(r.marca || '').trim().toLowerCase() === m.toLowerCase() &&
    String(r.modelo || '').trim().toLowerCase() === mo.toLowerCase());
  if (dup) return res.json(standardResponse(false, null, 'Esta combinação já existe no catálogo.'));

  const { data, error } = await sheets.supabase
    .from('listas')
    .insert({ categoria: c, marca: m || null, modelo: mo || null })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  await registrarAuditoria('catalogoAdicionar', session.email, { categoria: c, marca: m, modelo: mo });
  res.json(standardResponse(true, { id: data.id, categoria: c, marca: m, modelo: mo }));
}));

app.post('/api/listas-remover', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token, niveis.MATRIZ);
  const { id, categoria, marca, modelo } = req.body || {};

  let q = sheets.supabase.from('listas').delete();
  if (id) q = q.eq('id', id);
  else if (categoria && marca && modelo) q = q.eq('categoria', categoria).eq('marca', marca).eq('modelo', modelo);
  else return res.json(standardResponse(false, null, 'Informe o id (ou categoria+marca+modelo) a remover.'));

  const { error } = await q;
  if (error) throw new Error(error.message);

  await registrarAuditoria('catalogoRemover', session.email, { id, categoria, marca, modelo });
  res.json(standardResponse(true));
}));

// Últimas ações do sistema (auditoria) — somente Matriz
app.get('/api/auditoria', asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  await requireSession(token, niveis.MATRIZ);
  const limite = Math.max(1, Math.min(parseInt(req.query.limite, 10) || 50, 200));

  const { data, error } = await sheets.supabase
    .from('auditoria')
    .select('*')
    .order('data', { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);

  res.json(standardResponse(true, (data || []).map(toCamelCase)));
}));

// Adiciona item às listas: categoria obrigatória; marca e modelo opcionais (somente Matriz)
app.post('/api/listas/adicionar', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token, niveis.MATRIZ);

  const categoria = String(req.body?.categoria || '').trim();
  const marca = String(req.body?.marca || '').trim();
  const modelo = String(req.body?.modelo || '').trim();
  if (!categoria) {
    return res.json(standardResponse(false, null, 'Informe ao menos a categoria.'));
  }
  if (modelo && !marca) {
    return res.json(standardResponse(false, null, 'Informe a marca para cadastrar um modelo.'));
  }

  const { error } = await supabaseAdmin
    .from('listas')
    .upsert({ categoria, marca, modelo }, { onConflict: 'categoria,marca,modelo', ignoreDuplicates: true });
  if (error) throw new Error(error.message);

  await registrarAuditoria('adicionarLista', session.email, { categoria, marca, modelo });
  res.json(standardResponse(true, { categoria, marca, modelo }));
}));

// Remove item das listas por id ou pela combinação exata categoria/marca/modelo (somente Matriz)
app.post('/api/listas/remover', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token, niveis.MATRIZ);

  const id = req.body?.id;
  if (id) {
    const { error } = await supabaseAdmin.from('listas').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await registrarAuditoria('removerLista', session.email, { id });
    return res.json(standardResponse(true, { id }));
  }

  const categoria = String(req.body?.categoria || '').trim();
  const marca = String(req.body?.marca || '').trim();
  const modelo = String(req.body?.modelo || '').trim();
  if (!categoria) {
    return res.json(standardResponse(false, null, 'Informe ao menos a categoria.'));
  }

  // Localiza a(s) linha(s) pela combinação exata (marca/modelo vazios também casam)
  let consulta = supabaseAdmin
    .from('listas')
    .select('id, categoria, marca, modelo')
    .eq('categoria', categoria);
  if (marca) consulta = consulta.eq('marca', marca);
  if (modelo) consulta = consulta.eq('modelo', modelo);
  const { data: linhas, error: errBusca } = await consulta;
  if (errBusca) throw new Error(errBusca.message);

  const alvos = (linhas || []).filter(r =>
    String(r.marca || '').trim() === marca && String(r.modelo || '').trim() === modelo);
  if (alvos.length === 0) {
    return res.json(standardResponse(false, null, 'Item não encontrado nas listas.'));
  }

  const { error } = await supabaseAdmin.from('listas').delete().in('id', alvos.map(a => a.id));
  if (error) throw new Error(error.message);

  await registrarAuditoria('removerLista', session.email, { categoria, marca, modelo });
  res.json(standardResponse(true, { categoria, marca, modelo }));
}));

// ============================================================
// ROTAS DE EQUIPAMENTOS
// ============================================================

app.get('/api/catalogo-equipamentos', asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  await requireSession(token);

  const BLOCO = 1000;
  const vistos = new Map(); // chave: cat|marca|modelo
  const add = (categoria, marca, modelo) => {
    const c = String(categoria || '').trim();
    const m1 = String(marca || '').trim();
    const m2 = String(modelo || '').trim();
    if (!c) return; // categoria é o mínimo; marca/modelo podem ser vazios
    vistos.set(`${c}||${m1}||${m2}`, { categoria: c, marca: m1, modelo: m2 });
  };

  // União: catálogo gerenciado (Listas) + o que de fato existe nos equipamentos
  const listas = await sheets.getValues('Listas');
  for (const row of listas) add(row.categoria, row.marca, row.modelo);

  let offset = 0;
  while (true) {
    const { data, error } = await sheets.supabase
      .from('equipamentos')
      .select('categoria, marca, modelo')
      .neq('status', 'Removido')
      .range(offset, offset + BLOCO - 1);
    if (error) throw new Error(error.message);
    for (const r of data || []) add(r.categoria, r.marca, r.modelo);
    if (!data || data.length < BLOCO) break;
    offset += BLOCO;
  }

  const resultado = [...vistos.values()].sort((a, b) =>
    a.categoria.localeCompare(b.categoria, 'pt-BR') || a.marca.localeCompare(b.marca, 'pt-BR') || a.modelo.localeCompare(b.modelo, 'pt-BR'),
  );
  res.json(standardResponse(true, resultado));
}));

app.get('/api/equipamentos-da-filial', asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token);
  const [todos, indice] = await Promise.all([getAllEquipamentos(), indiceUnidades()]);
  const filtrados = todos
    .filter(item => item.status !== 'Removido' && sheets.sessaoTemAcessoAUnidade(session, item.unidade))
    // Sai no nome oficial: o agrupamento do filtro acontece no cliente (a filial
    // carrega tudo e filtra localmente), então normalizar aqui evita a duplicata.
    .map((item) => ({ ...item, unidade: indice.resolver(item.unidade) }));
  res.json(standardResponse(true, filtrados));
}));

app.get('/api/unidades-resumo', asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token);

  // Esta rota alimenta o select de "Unidade escolar" do cadastro de equipamento.
  // Agrupar pela string exata fazia a mesma escola aparecer duas vezes no select
  // (uma pela grafia oficial, outra pela legada) — e escolher a errada criava
  // mais uma variante no banco. A chave é sempre o nome oficial de `filiais`.
  const [todos, indice, { data: filiais, error: errFiliais }] = await Promise.all([
    getAllEquipamentos(),
    indiceUnidades(),
    sheets.supabase.from('filiais').select('nome').eq('ativo', true),
  ]);
  if (errFiliais) throw new Error(errFiliais.message);
  const mapa = new Map();

  const ensure = (nome) => {
    const chave = indice.agrupar(nome);
    if (!mapa.has(chave)) mapa.set(chave, { nome: chave, total: 0, disponiveis: 0, manutencao: 0, quebrados: 0, extraviados: 0 });
    return mapa.get(chave);
  };

  for (const eq of todos) {
    if (eq.status === 'Removido') continue;
    if (!sheets.sessaoTemAcessoAUnidade(session, eq.unidade)) continue;
    const u = ensure(eq.unidade);
    u.total += 1;
    if (eq.status === 'Disponível') u.disponiveis += 1;
    else if (eq.status === 'Manutenção') u.manutencao += 1;
    else if (eq.status === 'Quebrado') u.quebrados += 1;
    else if (eq.status === 'Extraviado') u.extraviados += 1;
  }

  // Inclui filiais ativas do escopo mesmo sem equipamentos (contagens zeradas)
  for (const f of filiais || []) {
    if (sheets.sessaoTemAcessoAUnidade(session, f.nome)) ensure(f.nome);
  }

  const lista = [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  res.json(standardResponse(true, lista));
}));

app.get('/api/equipamentos-global', asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  await requireSession(token, niveis.MATRIZ);

  const limite = Math.max(1, Math.min(parseInt(req.query.limite, 10) || 100, 500));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const busca = String(req.query.busca || '').trim();
  const status = String(req.query.status || '').trim();
  const unidade = String(req.query.unidade || '').trim();
  const categoria = String(req.query.categoria || '').trim();
  const marca = String(req.query.marca || '').trim();
  const modelo = String(req.query.modelo || '').trim();

  const colunasOrdem = {
    modelo: 'modelo',
    patrimonio: 'patrimonio',
    numeroSerie: 'numero_serie',
    unidade: 'unidade',
    status: 'status',
  };
  const ordem = colunasOrdem[req.query.ordem] || 'data_cadastro';
  const ascendente = req.query.direcao !== 'desc';

  // Filtro de unidade tolerante: em vez de `eq('unidade', X)` (que ignoraria as
  // grafias legadas da mesma escola), resolve TODAS as grafias que representam
  // a unidade pedida. Sem isso, filtrar por "E.E. HAYDEE HIDALGO" esconderia os
  // equipamentos gravados como "Haydee Hidalgo Professora".
  const indice = await indiceUnidades();
  const grafiasUnidade = unidade ? indice.grafiasIguais(unidade, await listarGrafiasUnidade()) : [];

  const aplicarFiltros = (q) => {
    let query = q.neq('status', 'Removido');
    if (status) query = query.eq('status', status);
    if (unidade) query = query.in('unidade', grafiasUnidade.length ? grafiasUnidade : [unidade]);
    if (categoria) query = query.eq('categoria', categoria);
    if (marca) query = query.eq('marca', marca);
    if (modelo) query = query.eq('modelo', modelo);
    if (busca) {
      // Valor interpolado num filtro PostgREST: precisa ser escapado. Com a
      // busca crua, `busca = "x,unidade.eq.EscolaSecreta"` injetava um filtro
      // novo e trazia equipamentos de outra escola.
      const b = escaparFiltroPostgrest(busca);
      query = query.or(`patrimonio.ilike.%${b}%,numero_serie.ilike.%${b}%,modelo.ilike.%${b}%,unidade.ilike.%${b}%`);
    }
    return query;
  };

  // Página de resultados
  const pageQuery = aplicarFiltros(
    sheets.supabase.from('equipamentos').select('*', { count: 'exact' })
  ).order(ordem, { ascending: ascendente }).range(offset, offset + limite - 1);

  const { data, count, error } = await pageQuery;
  if (error) throw new Error(error.message);

  // Agregados (KPIs + gráficos) apenas com as colunas necessárias, respeitando filtros.
  // IMPORTANTE: o PostgREST limita a 1000 linhas por requisição — paginamos em blocos
  // até o fim para que os KPIs/gráficos considerem TODOS os equipamentos.
  const BLOCO = 1000;
  const statsRows = [];
  let offsetStats = 0;
  while (true) {
    const { data: bloco, error: statsError } = await aplicarFiltros(
      // `marca`/`modelo` alimentam o drilldown de modelos do gráfico de categorias
      // do portal. Sem eles o cliente teria de baixar a lista inteira (MB) só para
      // contar, e contar requisição a requisição não fecha: a ordenação é por
      // `modelo`, que se repete milhares de vezes, então o mesmo equipamento volta
      // em duas páginas e outros nunca aparecem.
      sheets.supabase.from('equipamentos').select('status, unidade, categoria, marca, modelo')
    ).range(offsetStats, offsetStats + BLOCO - 1);
    if (statsError) throw new Error(statsError.message);
    statsRows.push(...(bloco || []));
    if (!bloco || bloco.length < BLOCO) break;
    offsetStats += BLOCO;
  }

  // `porUnidade` é a origem do filtro de escolas no portal: agrupar pela string
  // exata era o que produzia a escola duplicada. A chave é o nome oficial.
  const porStatus = {}, porUnidade = {}, porCategoria = {};
  // `porModelo` é uma LISTA, não um mapa: a chave é texto livre (pode conter
  // qualquer caractere) e ~155 itens saem em ~12 KB, contra os MB que custaria
  // ao portal baixar a lista inteira só para contar os modelos por categoria.
  const porModelo = new Map();
  for (const linha of statsRows) {
    const s = linha.status || 'Não definido';
    porStatus[s] = (porStatus[s] || 0) + 1;
    const u = indice.agrupar(linha.unidade);
    porUnidade[u] = (porUnidade[u] || 0) + 1;
    const c = linha.categoria || 'Sem categoria';
    porCategoria[c] = (porCategoria[c] || 0) + 1;
    const marca = linha.marca || '';
    const modelo = linha.modelo || '';
    const chave = `${c}||${marca}||${modelo}`;
    const jaContado = porModelo.get(chave);
    if (jaContado) jaContado.qtd += 1;
    else porModelo.set(chave, { categoria: c, marca, modelo, qtd: 1 });
  }

  res.json(standardResponse(true, {
    // A coluna "Unidade Escolar" da tabela também sai no nome oficial, para bater
    // com o filtro mesmo antes de a migração de dados rodar.
    data: (data || []).map((linha) => {
      const item = toCamelCase(linha);
      item.unidade = indice.resolver(item.unidade);
      return item;
    }),
    total: count || 0,
    stats: {
      porStatus,
      porUnidade,
      porCategoria,
      // Ordenado no servidor para o portal não precisar reorganizar.
      porModelo: [...porModelo.values()].sort((a, b) =>
        a.categoria.localeCompare(b.categoria, 'pt-BR') || b.qtd - a.qtd ||
        a.marca.localeCompare(b.marca, 'pt-BR') || a.modelo.localeCompare(b.modelo, 'pt-BR')),
    },
  }));
}));

/**
 * SEGUNDA definição de `/api/unidades-resumo` — REMOVIDA.
 *
 * O Express casa rotas na ordem de declaração, então esta versão era a que
 * respondia e a primeira (mais acima, com normalização do nome oficial da
 * unidade) nunca rodava. A segunda agrupava por `equipamentos.unidade` cru,
 * o que fazia a mesma escola aparecer duplicada no filtro de unidades do
 * portal e — por usar `sheets.getValues('Filiais')` cru — sem o mesmo
 * tratamento de nome oficial. A primeira versão é a correta.
 */

/**
 * Escola fora de `filiais` quando o equipamento é criado/movido.
 *
 * O nome gravado não casa com o catálogo, então o item some das telas sem
 * nenhum aviso visível — foi assim que 439 equipamentos de Isaac e Luiz Vaz
 * de Camões desapareceram do painel /unidades do portal. O `console.warn`
 * anterior morria no restart e não deixava rastro.
 *
 * Não bloqueia o cadastro (escola nova precisa poder entrar), mas deixa
 * registro em `auditoria` e devolve as grafias mais parecidas, para a correção
 * ser óbvia em vez de adivinhada.
 */
async function alertarUnidadeNaoCatalogada(unidade, quem) {
  const { oficiais } = await indiceUnidades();
  const palavras = (n) => new Set(chaveUnidade(n).split(' ').filter((p) => p.length > 2));
  const doAlvo = palavras(unidade);
  const parecidos = oficiais
    .map((o) => {
      const po = palavras(o);
      let inter = 0;
      for (const p of doAlvo) if (po.has(p)) inter++;
      return { o, s: doAlvo.size ? inter / doAlvo.size : 0 };
    })
    .filter((x) => x.s >= 0.6 && x.o !== unidade)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.o);
  try {
    await registrarAuditoria('unidadeNaoCatalogada', quem, { unidade, parecidos });
  } catch (e) {
    console.warn(`[unidades] falha ao registrar auditoria de "${unidade}":`, e.message);
  }
  console.warn(
    `[unidades] "${unidade}" não está em filiais — gravada como está.` +
    (parecidos.length ? ` Parecidas: ${parecidos.join(', ')}` : '')
  );
  return parecidos;
}

app.post('/api/create-equipamento', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token);
  if (sessaoSomenteLeitura(session)) return res.json(standardResponse(false, null, SOMENTE_LEITURA_MSG));
  const dados = req.body;

  const unidadeInformada = sheets.resolverUnidadeParaEscrita(session, dados.unidade);
  if (!unidadeInformada) return res.json(standardResponse(false, null, 'Não foi possível determinar a unidade deste usuário. Verifique o cadastro da filial.'));

  // Grava sempre no nome oficial da escola. Sem isso, a Matriz podia cadastrar
  // "Haydee Hidalgo Professora" ao lado de "E.E. HAYDEE HIDALGO" e a escola
  // passava a duplicar no filtro de unidades. Escola fora de `filiais` mantém o
  // texto informado (não quebra o cadastro), mas o nome gravado não casa com o
  // catálogo do portal e o equipamento some das telas — por isso o desvio é
  // registrado em auditoria e devolvido como aviso, em vez de só ir para o log.
  const { nome: unidade, oficial } = await resolverNomeOficial(unidadeInformada);
  let avisos = [];
  if (unidade !== String(unidadeInformada).trim()) {
    console.log(`[unidades] "${unidadeInformada}" gravado como "${unidade}" (nome oficial)`);
  } else if (!oficial) {
    const parecidos = await alertarUnidadeNaoCatalogada(unidade, session.email);
    avisos = [`"${unidade}" não está no catálogo de filiais. O equipamento foi gravado assim mesmo, mas não vai aparecer nas telas até a escola ser cadastrada.`];
    if (parecidos.length) avisos.push(`Você quis dizer: ${parecidos.join(' | ')}?`);
  }

  const patrimonio = (dados.patrimonio || '').trim();
  const justifPat = (dados.justificativaPatrimonio || '').trim();
  const serie = (dados.numeroSerie || '').trim();
  const justifSerie = (dados.justificativaNumeroSerie || '').trim();

  // Patrimônio é opcional; número de série ainda exige valor ou justificativa.
  if (!serie && !justifSerie) return res.json(standardResponse(false, null, 'Informe o Número de Série ou uma justificativa para a sua ausência.'));

  // Verificação de duplicados (ignora itens removidos; ignora vazios)
  const todos = await getAllEquipamentos();
  const duplicadoPat = patrimonio ? todos.find(e => e.status !== 'Removido' && String(e.patrimonio || '').trim() !== '' && String(e.patrimonio || '').trim().toUpperCase() === patrimonio.toUpperCase()) : null;
  const duplicadoSerie = serie ? todos.find(e => e.status !== 'Removido' && String(e.numeroSerie || '').trim() !== '' && String(e.numeroSerie || '').trim().toUpperCase() === serie.toUpperCase()) : null;
  if (duplicadoPat) return res.json(standardResponse(false, null, `Já existe um equipamento com o patrimônio "${patrimonio}" (modelo: ${duplicadoPat.modelo || 'N/A'}, unidade: ${duplicadoPat.unidade || 'N/A'}).`));
  if (duplicadoSerie) return res.json(standardResponse(false, null, `Já existe um equipamento com o número de série "${serie}" (modelo: ${duplicadoSerie.modelo || 'N/A'}, unidade: ${duplicadoSerie.unidade || 'N/A'}).`));

  if (dados.status === 'Extraviado') {
    if (!dados._anexoBoletim) return res.json(standardResponse(false, null, 'Para o status "Extraviado", o anexo do Boletim de Ocorrência é obrigatório.'));
    // Faz upload do anexo e guarda o caminho no storage
    dados.boletimOcorrenciaAnexoUrl = await uploadAnexoBoletim(dados._anexoBoletim.base64);
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
    if (h === 'numeroSerie' || h === 'patrimonio') {
      // campos-chave: vazio vira NULL para não colidir com o índice único
      const v = String(dados[h] || '').trim();
      return v === '' ? null : v;
    }
    if (h in dados) return dados[h];
    return null;
  });

  await sheets.appendRow('Equipamentos', linha);
  await registrarHistorico(id, 'criação', '', 'Equipamento cadastrado', session.email);
  await registrarAuditoria('createEquipamento', session.email, { id, unidade });

  res.json(standardResponse(true, { id, avisos }));
}));

/**
 * Campos que o cliente pode alterar via `POST /api/update-equipamento`.
 *
 * Sem allowlist, `Object.keys(camposAlterados)` virava o `update` do Prisma:
 * o usuário de uma filial podia **transferir o equipamento para outra
 * escola** (o check de unidade olhava só a unidade ATUAL) e mexer em
 * qualquer coluna, incluindo as de auditoria.
 */
const CAMPOS_EDITAVEIS = new Set([
  'categoria', 'marca', 'modelo', 'patrimonio', 'numeroSerie',
  'status', 'statusManutencao', 'vinculadoBlueMonitor', 'numeroChamadoManutencao',
  'boletimOcorrencia', 'justificativaVerificacao', 'descricaoQuebrado',
  'sistemaOperacional', 'processador', 'memoriaRAM', 'armazenamento',
  'tamanhoTela', 'responsavelAtual', 'observacoes',
  'justificativaPatrimonio', 'justificativaNumeroSerie',
  'tipoEmprestimo', 'escolaDestino',
  // Fora da lista de colunas: o anexo é consumido logo abaixo do filtro e
  // vira um upload no storage. Sem estar aqui ele era descartado, e um
  // equipamento não conseguia virar "Extraviado" já mandando o B.O. junto.
  '_anexoBoletim',
]);

app.post('/api/update-equipamento', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token);
  if (sessaoSomenteLeitura(session)) return res.json(standardResponse(false, null, SOMENTE_LEITURA_MSG));
  const { id, ...resto } = req.body;
  if (!id) return res.json(standardResponse(false, null, 'Informe o id do equipamento.'));

  // Descarta tudo que não está na allowlist (`unidade` é tratada à parte).
  const camposAlterados = {};
  for (const [chave, valor] of Object.entries(resto)) {
    if (CAMPOS_EDITAVEIS.has(chave)) camposAlterados[chave] = valor;
  }
  if (Object.keys(camposAlterados).length === 0 && resto.unidade === undefined) {
    return res.json(standardResponse(false, null, 'Nenhum campo válido para atualização.'));
  }

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

  // Transferência de unidade: só a Matriz pode mudar a escola dona, e o
  // destino precisa existir. Sem isso, uma filial "doava" o equipamento para
  // outra escola passando pelo endpoint de edição.
  if (resto.unidade !== undefined && String(resto.unidade).trim() !== String(equipAtual.unidade).trim()) {
    if (session.nivel !== niveis.MATRIZ) {
      return res.json(standardResponse(false, null, 'Somente a Matriz pode transferir um equipamento de unidade.'));
    }
    const destino = (await resolverNomeOficial(resto.unidade)).nome;
    if (!destino) return res.json(standardResponse(false, null, 'Unidade de destino inválida.'));
    camposAlterados.unidade = destino;
  } else if (camposAlterados.unidade !== undefined) {
    camposAlterados.unidade = (await resolverNomeOficial(camposAlterados.unidade)).nome;
  }

  // Validação de duplicidade se alterou serie/patrimonio
  if (camposAlterados.numeroSerie !== undefined || camposAlterados.patrimonio !== undefined) {
    const serieNova = camposAlterados.numeroSerie !== undefined ? camposAlterados.numeroSerie : equipAtual.numeroSerie;
    const patNovo = camposAlterados.patrimonio !== undefined ? camposAlterados.patrimonio : equipAtual.patrimonio;
    const todos = await getAllEquipamentos();
    const dupPat = (patNovo && String(patNovo).trim() !== '') ? todos.find(e => e.id !== id && e.status !== 'Removido' && String(e.patrimonio || '').trim() !== '' && String(e.patrimonio || '').trim().toUpperCase() === String(patNovo).trim().toUpperCase()) : null;
    const dupSerie = (serieNova && String(serieNova).trim() !== '') ? todos.find(e => e.id !== id && e.status !== 'Removido' && String(e.numeroSerie || '').trim() !== '' && String(e.numeroSerie || '').trim().toUpperCase() === String(serieNova).trim().toUpperCase()) : null;
    if (dupPat) return res.json(standardResponse(false, null, `Já existe outro equipamento com o patrimônio "${patNovo}" (modelo: ${dupPat.modelo || 'N/A'}, unidade: ${dupPat.unidade || 'N/A'}).`));
    if (dupSerie) return res.json(standardResponse(false, null, `Já existe outro equipamento com o número de série "${serieNova}" (modelo: ${dupSerie.modelo || 'N/A'}, unidade: ${dupSerie.unidade || 'N/A'}).`));
  }

  // Validações de status especial
  if (camposAlterados.status === 'Extraviado') {
    const anexoExistente = equipAtual.boletim_ocorrencia_anexo_url || equipAtual.boletimOcorrenciaAnexoUrl;
    if (!camposAlterados._anexoBoletim && !anexoExistente) {
      return res.json(standardResponse(false, null, 'Para o status "Extraviado", anexe o Boletim de Ocorrência.'));
    }
  }

  // Upload do anexo do B.O. (se enviado)
  let novoAnexoPath = null;
  if (camposAlterados._anexoBoletim) {
    novoAnexoPath = await uploadAnexoBoletim(camposAlterados._anexoBoletim.base64);
    delete camposAlterados._anexoBoletim;
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

  for (const [campo, valorNovo] of Object.entries(camposAlterados)) {
    const valorAntigo = equipAtual[campo];
    if (String(valorAntigo) === String(valorNovo)) continue;
    updates[campo] = valorNovo;
    historico.push({ campo, antigo: valorAntigo, novo: valorNovo });
  }

  // Campos automáticos
  if (Object.keys(updates).length > 0) {
    updates.dataUltimaAtualizacao = new Date();
    updates.ultimaAlteracaoPor = session.email;
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await sheets.supabase
      .from('equipamentos')
      .update(toSnakeCase(updates))
      .eq('id', id);
    if (error) throw new Error(`Erro ao atualizar equipamento: ${error.message}`);
  }

  // Salva o caminho do anexo (coluna snake_case separada)
  if (novoAnexoPath) {
    // Guarda o anterior ANTES de sobrescrever: trocar o boletim deixava o
    // arquivo velho órfão no bucket para sempre, ocupando espaço sem referência.
    const anexoAnterior = normalizarCaminhoAnexo(
      equipAtual.boletim_ocorrencia_anexo_url || equipAtual.boletimOcorrenciaAnexoUrl
    );

    const { error: errAnexo } = await sheets.supabase
      .from('equipamentos')
      .update({ boletim_ocorrencia_anexo_url: novoAnexoPath })
      .eq('id', id);
    if (errAnexo) throw new Error(`Erro ao salvar anexo: ${errAnexo.message}`);

    if (anexoAnterior && anexoAnterior !== novoAnexoPath) {
      try {
        await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([anexoAnterior]);
      } catch (e) {
        console.warn(`[anexo] falha ao apagar ${anexoAnterior} substituído: ${e.message}`);
      }
    }
  }

  for (const h of historico) {
    await registrarHistorico(id, h.campo, h.antigo, h.novo, session.email);
  }
  if (historico.length > 0) {
    await registrarAuditoria('updateEquipamento', session.email, { id, campos: historico.map(h => h.campo) });
  }

  res.json(standardResponse(true));
}));

/**
 * URL assinada para o anexo do B.O.
 *
 * O `path` vinha direto do cliente e era usado como está: qualquer usuário
 * autenticado gerava link de QUALQUER objeto do bucket `anexos`, inclusive o
 * boletim de outra escola. O caminho é normalizado e precisa estar no
 * prefixo `boletins/` no formato gerado pelo upload.
 */
app.get('/api/anexo-url', asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  await requireSession(token);
  const { path } = req.query;

  const caminho = normalizarCaminhoAnexo(path);
  if (!caminho) {
    return res.json(standardResponse(false, null, 'Caminho do anexo inválido.'));
  }

  const url = await gerarUrlAnexo(caminho);
  res.json(standardResponse(true, { url }));
}));

/**
 * Remove o anexo do Boletim de Ocorrência de um equipamento.
 *
 * O `path` NÃO vem do cliente (mesmo bug que o `/api/anexo-url` já teve):
 * quem apaga é o `id` do equipamento, e o caminho é lido do próprio banco.
 * Sem isso, qualquer usuário autenticado apagaria o boletim de outra escola
 * bastando mandar o `path` dela.
 *
 * A ordem é invertida de propósito: limpa a coluna PRIMEIRO e só então apaga
 * o arquivo. Se a limpeza falhar, sobra um órfão no storage — inofensivo. Ao
 * contrário, apagar o arquivo antes deixaria o equipamento "Extraviado"
 * apontando para um anexo inexistente, que é o estado que a validação de
 * cima existe justamente para impedir.
 */
app.post('/api/remover-anexo-boletim', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token);
  if (sessaoSomenteLeitura(session)) return res.json(standardResponse(false, null, SOMENTE_LEITURA_MSG));
  const { id, caminhoEsperado } = req.body;
  if (!id) return res.json(standardResponse(false, null, 'Informe o id do equipamento.'));

  const { data: equipAtual, error } = await sheets.supabase
    .from('equipamentos')
    .select('unidade, status, boletim_ocorrencia_anexo_url')
    .eq('id', id)
    .single();

  if (error || !equipAtual) return res.json(standardResponse(false, null, 'Equipamento não encontrado.'));

  if (!sheets.sessaoTemAcessoAUnidade(session, equipAtual.unidade)) {
    return res.json(standardResponse(false, null, 'Você não tem permissão para alterar este equipamento.'));
  }

  const caminho = normalizarCaminhoAnexo(equipAtual.boletim_ocorrencia_anexo_url);
  // Sem anexo, ou já substituído por outro upload enquanto o modal estava
  // aberto: nada a fazer (e nada de arriscar apagar o arquivo novo).
  if (!caminho || (caminhoEsperado && caminho !== String(caminhoEsperado))) {
    return res.json(standardResponse(true, { removido: false }));
  }

  // Extraviado exige anexo por regra do sistema — trocar o status e salvar
  // antes de remover, senão o registro fica num estado que a API proíbe.
  if (equipAtual.status === 'Extraviado') {
    return res.json(standardResponse(false, null,
      'Para o status "Extraviado", o anexo do Boletim de Ocorrência é obrigatório. ' +
      'Altere o status ou anexe outro boletim.'));
  }

  const { error: updError } = await sheets.supabase
    .from('equipamentos')
    .update({ boletim_ocorrencia_anexo_url: null })
    .eq('id', id)
    // Só limpa se a coluna ainda for a que li — evita apagar duas vezes em
    // uploads concorrentes.
    .eq('boletim_ocorrencia_anexo_url', caminho);

  if (updError) return res.json(standardResponse(false, null, `Erro ao remover o anexo: ${updError.message}`));

  try {
    await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([caminho]);
  } catch (e) {
    // O registro já está limpo: o arquivo vira órfão, que a garbage
    // collection do bucket resolve. Não vale reprovar o salvamento.
    console.warn(`[anexo] falha ao apagar ${caminho} do storage: ${e.message}`);
  }

  await registrarAuditoria('removerAnexoBoletim', session.email, { id });
  res.json(standardResponse(true, { removido: true }));
}));

app.post('/api/clone-equipamento', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token);
  if (sessaoSomenteLeitura(session)) return res.json(standardResponse(false, null, SOMENTE_LEITURA_MSG));
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

app.post('/api/remover-equipamento', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token, [niveis.MATRIZ, niveis.ADMIN_FILIAL]);
  if (sessaoSomenteLeitura(session)) return res.json(standardResponse(false, null, SOMENTE_LEITURA_MSG));
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

app.post('/api/atualizar-status-manutencao', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token);
  if (sessaoSomenteLeitura(session)) return res.json(standardResponse(false, null, SOMENTE_LEITURA_MSG));
  const { equipamentoId, novoStatus } = req.body;

  if (!statusManutencaoValidos.includes(novoStatus)) {
    return res.json(standardResponse(false, null, 'Status de manutenção inválido.'));
  }

  const { data: equipAtual, error } = await sheets.supabase
    .from('equipamentos')
    .select('unidade, status_manutencao')
    .eq('id', equipamentoId)
    .single();

  if (error || !equipAtual) return res.json(standardResponse(false, null, 'Equipamento não encontrado.'));

  if (!sheets.sessaoTemAcessoAUnidade(session, equipAtual.unidade)) {
    return res.json(standardResponse(false, null, 'Você não tem permissão para alterar este equipamento.'));
  }

  const statusAntigo = equipAtual.status_manutencao;
  if (String(statusAntigo) === String(novoStatus)) return res.json(standardResponse(true));

  const { error: updError } = await sheets.supabase
    .from('equipamentos')
    .update(toSnakeCase({ statusManutencao: novoStatus, ultimaAlteracaoPor: session.email, dataUltimaAtualizacao: new Date() }))
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
  const token = extrairToken(req);
  const session = await requireSession(token);
  const { equipamentoId } = req.query;
  if (!equipamentoId) return res.json(standardResponse(false, null, 'Informe o equipamento.'));

  // Sem esta checagem, qualquer usuário autenticado lia o histórico de
  // manutenção de equipamento de qualquer escola.
  const acesso = await exigirAcessoAEquipamento(session, equipamentoId);
  if (!acesso.ok) return res.json(standardResponse(false, null, acesso.motivo));

  const { data, error } = await sheets.supabase
    .from('registros_manutencao')
    .select('*')
    .eq('equipamento_id', equipamentoId)
    .order('data', { ascending: false });

  if (error) throw new Error('Erro ao buscar manutenções.');
  res.json(standardResponse(true, data || []));
}));

app.post('/api/registrar-manutencao', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token);
  if (sessaoSomenteLeitura(session)) return res.json(standardResponse(false, null, SOMENTE_LEITURA_MSG));
  const { equipamentoId, descricao, status } = req.body;

  if (!descricao?.trim()) return res.json(standardResponse(false, null, 'Descrição é obrigatória.'));
  if (statusManutencaoValidos && !statusManutencaoValidos.includes(status || 'Pendente')) {
    return res.json(standardResponse(false, null, 'Status de manutenção inválido.'));
  }

  // Sem esta checagem, dava para registrar manutenção em equipamento alheio.
  const acesso = await exigirAcessoAEquipamento(session, equipamentoId);
  if (!acesso.ok) return res.json(standardResponse(false, null, acesso.motivo));

  const id = uuidv4();
  const { error } = await sheets.supabase
    .from('registros_manutencao')
    .insert({
      id,
      equipamento_id: equipamentoId,
      autor: session.email,
      data: new Date().toISOString(),
      descricao: String(descricao).slice(0, 2000),
      status: status || 'Pendente',
    });

  if (error) throw new Error('Erro ao registrar manutenção.');

  // Atualiza statusManutencao no equipamento também
  await sheets.supabase
    .from('equipamentos')
    .update(toSnakeCase({ statusManutencao: status || 'Pendente' }))
    .eq('id', equipamentoId);

  await registrarAuditoria('registrarManutencao', session.email, { id: equipamentoId, status });

  res.json(standardResponse(true));
}));

// ============================================================
// ROTAS DE HISTÓRICO
// ============================================================

app.get('/api/historico-equipamento', asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token);
  const { equipamentoId } = req.query;
  if (!equipamentoId) return res.json(standardResponse(false, null, 'Informe o equipamento.'));

  // O histórico traz campo/valorAntigo/valorNovo de todas as alterações —
  // inclusive patrimônio e responsável. Precisa do mesmo escopo do equipamento.
  const acesso = await exigirAcessoAEquipamento(session, equipamentoId);
  if (!acesso.ok) return res.json(standardResponse(false, null, acesso.motivo));

  const { data, error } = await sheets.supabase
    .from('historico_itens')
    .select('*')
    .eq('equipamento_id', equipamentoId)
    .order('data', { ascending: false });

  if (error) throw new Error('Erro ao buscar histórico.');
  res.json(standardResponse(true, data || []));
}));

// ============================================================
// ROTAS DE EMPRÉSTIMOS
// ============================================================

app.get('/api/filiais-para-emprestimo', asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  await requireSession(token);
  const { data, error } = await sheets.supabase
    .from('filiais')
    .select('nome')
    .eq('ativo', true)
    .order('nome');

  if (error) throw new Error(`Erro ao buscar filiais: ${error.message}`);
  res.json(standardResponse(true, (data || []).map(r => r.nome)));
}));

app.post('/api/registrar-emprestimo', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token);
  if (sessaoSomenteLeitura(session)) return res.json(standardResponse(false, null, SOMENTE_LEITURA_MSG));
  const { ids, ...dados } = req.body;

  if (!ids?.length) return res.json(standardResponse(false, null, 'Nenhum equipamento selecionado.'));
  if (!dados.responsavel) return res.json(standardResponse(false, null, 'Responsável é obrigatório.'));
  if (dados.tipoEmprestimo === 'interestadual' && !dados.escolaDestino) {
    return res.json(standardResponse(false, null, 'Escola de destino é obrigatória para empréstimo inter-escolar.'));
  }

  const now = new Date();

  // Valida o escopo de TODOS os ids antes de gravar qualquer um. Sem isso,
  // dava para registrar empréstimo (guardando CPF e e-mail de uma pessoa) em
  // equipamento de qualquer escola.
  const alvos = [];
  for (const id of ids) {
    const acesso = await exigirAcessoAEquipamento(session, id);
    if (!acesso.ok) {
      return res.json(standardResponse(false, null, acesso.motivo));
    }
    if (acesso.equipamento.status === 'Removido') continue;
    alvos.push({ id, patrimonio: acesso.equipamento.patrimonio, unidade: acesso.equipamento.unidade });
  }

  if (alvos.length === 0) {
    return res.json(standardResponse(false, null, 'Nenhum equipamento válido para empréstimo.'));
  }

  for (const alvo of alvos) {
    const empId = uuidv4();
    const { error: empError } = await sheets.supabase
      .from('emprestimos')
      .insert({
        id: empId,
        equipamento_id: alvo.id,
        patrimonio: alvo.patrimonio || '',
        unidade: alvo.unidade || '',
        responsavel: String(dados.responsavel).slice(0, 200),
        cpf: String(dados.cpf || '').slice(0, 20),
        email_responsavel: String(dados.emailResponsavel || '').slice(0, 320),
        data_emprestimo: now.toISOString(),
        data_prevista_devolucao: dados.dataPrevistaDevolucao || null,
        data_devolucao: null,
        status: 'Emprestado',
        termo_pdf_url: '',
        criado_por: session.email,
        devolvido_por: null,
        observacoes: String(dados.observacoes || '').slice(0, 2000),
        tipo_emprestimo: dados.tipoEmprestimo || null,
        escola_destino: String(dados.escolaDestino || '').slice(0, 200),
      });

    if (empError) console.error(`Erro ao criar empréstimo para ${alvo.id}:`, empError.message);

    // Atualiza status do equipamento
    await sheets.supabase
      .from('equipamentos')
      .update({ status: 'Emprestado' })
      .eq('id', alvo.id);

    await registrarHistorico(alvo.id, 'status', 'Disponível', 'Emprestado', session.email);
  }

  await registrarAuditoria('registrarEmprestimo', session.email, { ids: alvos.map(a => a.id) });
  res.json(standardResponse(true, { message: 'Empréstimo(s) registrado(s).' }));
}));

app.post('/api/registrar-devolucao', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token);
  if (sessaoSomenteLeitura(session)) return res.json(standardResponse(false, null, SOMENTE_LEITURA_MSG));
  const { ids, observacao } = req.body;

  if (!ids?.length) return res.json(standardResponse(false, null, 'Nenhum equipamento selecionado.'));

  const now = new Date();

  for (const id of ids) {
    // Devolver equipamento de outra filial também altera o estoque alheio.
    const acesso = await exigirAcessoAEquipamento(session, id);
    if (!acesso.ok) return res.json(standardResponse(false, null, acesso.motivo));

    // Encontra empréstimo ativo
    const { data: empAtivo, error: empError } = await sheets.supabase
      .from('emprestimos')
      .select('id')
      .eq('equipamento_id', id)
      .eq('status', 'Emprestado')
      .maybeSingle();

    if (empError || !empAtivo) continue;

    // Atualiza empréstimo
    await sheets.supabase
      .from('emprestimos')
      .update({
        status: 'Devolvido',
        devolvido_por: session.email,
        data_devolucao: now.toISOString(),
        observacoes: String(observacao || '').slice(0, 2000),
      })
      .eq('id', empAtivo.id);

    const statusAntigo = acesso.equipamento.status || 'Emprestado';
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
  const token = extrairToken(req);
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
  const token = extrairToken(req);
  const session = await requireSession(token);

  const todos = await getAllEquipamentos();
  const equipamentos = todos.filter(item => item.status !== 'Removido' && sheets.sessaoTemAcessoAUnidade(session, item.unidade));
  const headers = HEADER_MAP.EQUIPAMENTOS;
  const csv = [headers.join(',')];
  for (const eq of equipamentos) {
    csv.push(headers.map(h => `"${String(eq[h] || '').replace(/"/g, '""')}"`).join(','));
  }
  res.json(standardResponse(true, { csv: csv.join('\n'), fileName: `sce-equipamentos-${Date.now()}.csv` }));
}));

app.post('/api/exportar-pdf', limiteEscrita, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  const session = await requireSession(token);

  const todos = await getAllEquipamentos();
  const equipamentos = todos.filter(item => item.status !== 'Removido' && sheets.sessaoTemAcessoAUnidade(session, item.unidade));

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="sce-equipamentos.pdf"');
  doc.pipe(res);

  // Cabeçalho do relatório
  doc.fontSize(18).fillColor('#0B1E36').text('SCE - Leste 3');
  doc.fontSize(12).fillColor('#64748b').text('Relatório de equipamentos');
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#64748b')
    .text('Gerado em ' + new Date().toLocaleString('pt-BR') + '  •  ' + equipamentos.length + ' equipamento(s)');
  doc.moveDown();

  const cols = [
    { key: 'unidade', label: 'Unidade', w: 110 },
    { key: 'categoria', label: 'Categoria', w: 90 },
    { key: 'marca', label: 'Marca', w: 80 },
    { key: 'modelo', label: 'Modelo', w: 150 },
    { key: 'patrimonio', label: 'Patrimônio', w: 85 },
    { key: 'numeroSerie', label: 'Nº Série', w: 110 },
    { key: 'status', label: 'Status', w: 95 },
  ];
  const tableWidth = cols.reduce((s, c) => s + c.w, 0);

  const rowHeight = 16;
  let y = doc.y;

  // Linha de cabeçalho da tabela
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0B1E36');
  let hx = 40;
  for (const c of cols) {
    doc.text(c.label, hx, y, { width: c.w, height: rowHeight });
    hx += c.w;
  }
  y += rowHeight;
  doc.moveTo(40, y).lineTo(40 + tableWidth, y).lineWidth(1).strokeColor('#c9c9c9').stroke();

  y += 4;

  // Linhas da tabela
  doc.font('Helvetica').fontSize(8).fillColor('#1c2733');
  for (const eq of equipamentos) {
    if (y > 520) { doc.addPage(); y = 60; }
    let rx = 40;
    for (const c of cols) {
      doc.text(String(eq[c.key] || ''), rx, y, { width: c.w - 4, height: rowHeight });
      rx += c.w;
    }
    y += rowHeight;
  }

  doc.end();
}));

// ============================================================
// ROTAS DE DIAGNÓSTICO
// ============================================================
//
// Estas duas rotas NÃO tinham autenticação: qualquer visitante recebia a
// primeira linha da tabela `equipamentos` (com `boletim_ocorrencia_anexo_url`,
// `responsavelAtual`, observações e especificações) e o total de linhas.
// Agora exigem Matriz e ficam desabilitadas fora de desenvolvimento.

const diagnosticLiberado = process.env.NODE_ENV !== 'production' || process.env.ENABLE_DIAGNOSTICO === 'true';

function exigirDiagnostico(req, res, next) {
  if (!diagnosticLiberado) {
    return res.status(404).json(standardResponse(false, null, 'Rota não encontrada.'));
  }
  return next();
}

app.get('/api/testar-planilha', exigirDiagnostico, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  await requireSession(token, niveis.MATRIZ);
  try {
    const { data, error } = await sheets.supabase
      .from('equipamentos')
      .select('*')
      .limit(1);
    if (error) throw error;
    res.json(standardResponse(true, {
      totalLinhas: data?.length || 0,
      cabecalho: HEADER_MAP.EQUIPAMENTOS,
      // Só a lista de COLUNAS: devolver a linha inteira expunha dados de
      // equipamentos de todas as escolas.
      colunas: data?.[0] ? Object.keys(toCamelCase(data[0])) : [],
    }));
  } catch {
    res.json(standardResponse(false, null, 'Erro ao ler equipamentos.'));
  }
}));

app.get('/api/testar-leitura-equipamentos', exigirDiagnostico, asyncHandler(async (req, res) => {
  const token = extrairToken(req);
  await requireSession(token, niveis.MATRIZ);
  try {
    const todos = await getAllEquipamentos();
    res.json(standardResponse(true, {
      total: todos.length,
      colunas: todos.length > 0 ? Object.keys(todos[0]) : [],
    }));
  } catch {
    res.json(standardResponse(false, null, 'Erro ao ler equipamentos.'));
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
  const token = extrairToken(req);
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

const PORT = process.env.PORT || 3000;

/**
 * Limpeza de sessões expiradas.
 *
 * A função existia mas NUNCA era chamada: a tabela `sessoes` crescia sem
 * parar, guardando tokens válidos por forever. Rodar periodicamente também
 * limita o material disponível para um ataque de força bruta sobre o token.
 */
const INTERVALO_LIMPEZA_MS = 15 * 60 * 1000;

async function iniciarLimpezaDeSessoes() {
  const rodar = async () => {
    try {
      await cleanupExpiredSessions();
    } catch (e) {
      console.warn('Falha na limpeza de sessões:', e.message);
    }
  };
  await rodar();
  const timer = setInterval(rodar, INTERVALO_LIMPEZA_MS);
  // `unref` para o timer não segurar o processo aberto.
  timer.unref?.();
  return timer;
}

const server = app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  if (!process.env.SSO_SECRET) {
    console.warn('⚠️  SSO_SECRET ausente — o SSO do PORTAL está desabilitado.');
  }
  if (!process.env.SCE_SYNC_KEY) {
    console.warn('⚠️  SCE_SYNC_KEY ausente — o sync de usuários do portal está desabilitado.');
  }
  void iniciarLimpezaDeSessoes();
});

/**
 * Rejeição de promise não tratada derrubava o processo (Node >= 15).
 * Loga e mantém o servidor no ar.
 */
process.on('unhandledRejection', (reason) => {
  console.error('Promise rejeitada sem tratamento:', reason);
});

/**
 * Handler de erro.
 *
 * `HttpError` (sessão inválida, permissão negada) sai com o status e a
 * mensagem originais. Para o resto, em produção só sai uma mensagem genérica:
 * o `err.message` do Supabase carrega nome de tabela, coluna, constraint e
 * às vezes o SQL. O detalhe vai para o log.
 */
app.use((err, req, res, next) => {
  // Duck typing em `status` (e não só `instanceof`) para também cobrir os
  // erros de permissão lançados por `supabaseService.js`, que não pode
  // importar `security.js` sem criar ciclo.
  const status = Number(err?.status) || (err instanceof HttpError ? err.status : 500);
  const ehHttp = status >= 400 && status < 500;

  if (status >= 500) {
    console.error(`[erro] ${req.method} ${req.path}:`, err?.message || err);
  } else {
    console.warn(`[${status}] ${req.method} ${req.path}: ${err?.message}`);
  }

  if (res.headersSent) return res.end();

  const mensagem = ehHttp
    ? err.message
    : (process.env.NODE_ENV === 'production'
      ? 'Erro interno do servidor. Tente novamente ou contate o suporte.'
      : (err?.message || 'Erro interno do servidor'));

  res.status(status).json(standardResponse(false, null, mensagem));
});

export default app;