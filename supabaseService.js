import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem estar configurados no .env');
}

// Cliente com service_role (bypass RLS para operações de backend)
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ============================================================
// MAPEAMENTO DE TABELAS (igual ao googleSheetsService)
// ============================================================
const TABLES = {
  EQUIPAMENTOS: 'equipamentos',
  LISTAS: 'listas',
  FILIAIS: 'filiais',
  HISTORICO: 'historico_itens',
  EMPRESTIMOS: 'emprestimos',
  AUDITORIA: 'auditoria',
  REGISTROS_MANUTENCAO: 'registros_manutencao',
  USUARIOS: 'usuarios',
  SESSOES: 'sessoes',
};

// ============================================================
// HELPERS
// ============================================================
function toCamelCase(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

function toSnakeCase(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    result[snakeKey] = value;
  }
  return result;
}

// ============================================================
// API COMPATÍVEL COM googleSheetsService
// ============================================================

export async function getValues(tableName) {
  const { data, error } = await supabase
    .from(TABLES[tableName] || tableName.toLowerCase())
    .select('*')
    .order('criado_em', { ascending: false });

  if (error) throw new Error(`Erro ao ler ${tableName}: ${error.message}`);
  return data || [];
}

export async function getBatchValues(tableNames) {
  const result = {};
  for (const name of tableNames) {
    result[name] = await getValues(name);
  }
  return result;
}

export async function appendRow(tableName, rowValues) {
  // rowValues vem como array na ordem dos headers - precisamos mapear
  const headers = getHeadersForTable(tableName);
  const obj = {};
  headers.forEach((h, i) => obj[h] = rowValues[i]);
  const snakeObj = toSnakeCase(obj);
  
  const { data, error } = await supabase
    .from(TABLES[tableName] || tableName.toLowerCase())
    .insert(snakeObj)
    .select()
    .single();

  if (error) throw new Error(`Erro ao inserir em ${tableName}: ${error.message}`);
  return data;
}

export async function updateCell(tableName, row, col, value) {
  // No Supabase, atualizamos por ID (row é o ID UUID)
  const headers = getHeadersForTable(tableName);
  const field = headers[col - 1];
  if (!field) throw new Error(`Coluna ${col} não encontrada em ${tableName}`);
  
  const { error } = await supabase
    .from(TABLES[tableName] || tableName.toLowerCase())
    .update({ [field]: value })
    .eq('id', row);

  if (error) throw new Error(`Erro ao atualizar ${tableName}: ${error.message}`);
}

export async function batchUpdateCells(tableName, cellUpdates) {
  // cellUpdates: [{ row: id, col: n, value: v }]
  // Agrupa por row (id)
  const byRow = {};
  const headers = getHeadersForTable(tableName);
  
  for (const u of cellUpdates) {
    const field = headers[u.col - 1];
    if (!field) continue;
    if (!byRow[u.row]) byRow[u.row] = {};
    byRow[u.row][field] = u.value;
  }

  for (const [id, updates] of Object.entries(byRow)) {
    const { error } = await supabase
      .from(TABLES[tableName] || tableName.toLowerCase())
      .update(updates)
      .eq('id', id);
    if (error) throw new Error(`Erro ao atualizar ${tableName} (${id}): ${error.message}`);
  }
}

export async function deleteRow(tableName, rowIndex1Based) {
  // No Supabase, rowIndex1Based é o ID UUID
  const { error } = await supabase
    .from(TABLES[tableName] || tableName.toLowerCase())
    .delete()
    .eq('id', rowIndex1Based);
  
  if (error) throw new Error(`Erro ao deletar ${tableName}: ${error.message}`);
}

export async function ensureSheetExists(tableName, headers) {
  // No Supabase, tabelas já existem (criadas via SQL). Apenas verifica.
  const { error } = await supabase
    .from(TABLES[tableName] || tableName.toLowerCase())
    .select('id')
    .limit(1);
  
  if (error && error.code === '42P01') {
    throw new Error(`Tabela ${tableName} não existe. Execute o schema SQL no Supabase.`);
  }
}

// ============================================================
// MÉTODOS ESPECÍFICOS (replicam googleSheetsService)
// ============================================================

export function findRowIndex(data, idCol, id) {
  // data já vem como array de objetos com camelCase
  for (let i = 0; i < data.length; i++) {
    if (data[i][idCol] === id) return i; // retorna índice 0-based
  }
  return -1;
}

export function parseFiliais(filialRaw) {
  return String(filialRaw || '')
    .split(',')
    .map(f => f.trim())
    .filter(f => f.length > 0);
}

export function sessaoTemAcessoAUnidade(session, unidade) {
  const niveis = {
    MATRIZ: 'Matriz',
    ADMIN_FILIAL: 'AdminFilial',
    FILIAL: 'Filial',
    TECNICO: 'Tecnico',
  };
  if (session.nivel === niveis.MATRIZ) return true;
  if (session.nivel === niveis.ADMIN_FILIAL) {
    return String(unidade).trim().toUpperCase() === String(session.filial).trim().toUpperCase();
  }
  if (session.nivel === niveis.TECNICO) {
    const unidadeNormalizada = String(unidade || '').trim().toUpperCase();
    const unidadesDaSessao = parseFiliais(session.filial).map(f => f.toUpperCase());
    return unidadesDaSessao.includes(unidadeNormalizada);
  }
  return String(unidade).trim().toUpperCase() === String(session.filial).trim().toUpperCase();
}

export function resolverUnidadeParaEscrita(session, unidadeInformada) {
  const niveis = {
    MATRIZ: 'Matriz',
    ADMIN_FILIAL: 'AdminFilial',
    FILIAL: 'Filial',
    TECNICO: 'Tecnico',
  };
  if (session.nivel === niveis.MATRIZ) {
    return unidadeInformada || session.filial;
  }
  if (session.nivel === niveis.ADMIN_FILIAL) {
    if (unidadeInformada && unidadeInformada.trim().toUpperCase() !== session.filial.trim().toUpperCase()) {
      throw new Error('Você só pode cadastrar equipamentos na sua própria unidade.');
    }
    return session.filial;
  }
  if (session.nivel === niveis.TECNICO) {
    const unidadesTecnico = parseFiliais(session.filial);
    if (unidadeInformada) {
      if (!sessaoTemAcessoAUnidade(session, unidadeInformada)) {
        throw new Error(`Você não atende a unidade "${unidadeInformada}".`);
      }
      return unidadeInformada;
    }
    if (unidadesTecnico.length === 1) return unidadesTecnico[0];
    throw new Error('Informe para qual unidade este equipamento deve ser cadastrado.');
  }
  return session.filial;
}

// ============================================================
// HEADERS POR TABELA (para mapear array -> objeto)
// ============================================================
function getHeadersForTable(tableName) {
  const map = {
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
    HISTORICO_ITENS: ['id', 'equipamentoId', 'campo', 'valorAntigo', 'valorNovo', 'autor', 'data'],
    EMPRESTIMOS: ['id', 'equipamentoId', 'patrimonio', 'unidade', 'responsavel', 'cpf', 'emailResponsavel',
      'dataEmprestimo', 'dataPrevistaDevolucao', 'dataDevolucao', 'status', 'termoPdfUrl',
      'criadoPor', 'devolvidoPor', 'observacoes', 'tipoEmprestimo', 'escolaDestino'],
    AUDITORIA: ['data', 'usuario', 'acao', 'detalhes'],
    REGISTROS_MANUTENCAO: ['id', 'equipamentoId', 'autor', 'data', 'descricao', 'status'],
    USUARIOS: ['email', 'nome', 'nivel', 'filial', 'status', 'dataRemocao', 'senhaDefinida'],
    SESSOES: ['token', 'email', 'nivel', 'filial', 'criadoEm', 'expiraEm'],
  };
  return map[tableName.toUpperCase()] || [];
}

// ============================================================
// MÉTODOS ADICIONAIS PARA AUTENTICAÇÃO (OTP/SESSÕES)
// ============================================================

export async function findUsuarioByEmail(email) {
  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') return null; // não encontrado
    throw new Error(`Erro ao buscar usuário: ${error.message}`);
  }
  return toCamelCase(data);
}

export async function createSession(usuario) {
  const token = randomUUID();
  const now = new Date();
  const expiraEm = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  
  const { error } = await supabase.from('sessoes').insert({
    token,
    email: usuario.email,
    nivel: usuario.nivel,
    filial: usuario.filial,
    criado_em: now.toISOString(),
    expira_em: expiraEm.toISOString(),
  });
  
  if (error) throw new Error(`Erro ao criar sessão: ${error.message}`);
  
  return { token, email: usuario.email, nivel: usuario.nivel, filial: usuario.filial };
}

export async function validateSession(token) {
  if (!token) return null;
  
  const { data, error } = await supabase
    .from('sessoes')
    .select('*')
    .eq('token', token.trim())
    .single();
  
  if (error || !data) return null;
  
  const now = new Date();
  const expiraEm = new Date(data.expira_em);
  if (now > expiraEm) return null;
  
  const usuario = await findUsuarioByEmail(data.email);
  if (!usuario || usuario.status === 'Removido') return null;
  
  return { token: data.token, email: data.email, nivel: data.nivel, filial: data.filial };
}

export async function cleanupExpiredSessions() {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('sessoes')
    .delete()
    .lt('expira_em', now);
  
  if (error) console.warn('Erro ao limpar sessões expiradas:', error.message);
}

// ============================================================
// AUDITORIA / HISTÓRICO (helpers)
// ============================================================

export async function registrarHistorico(equipamentoId, campo, valorAntigo, valorNovo, autor) {
  const { error } = await supabase
    .from('historico_itens')
    .insert({
      id: randomUUID(),
      equipamento_id: equipamentoId,
      campo,
      valor_antigo: String(valorAntigo || ''),
      valor_novo: String(valorNovo || ''),
      autor,
      data: new Date().toISOString(),
    });
  
  if (error) console.warn('Falha ao registrar histórico:', error.message);
}

export async function registrarAuditoria(acao, usuarioEmail, detalhes) {
  try {
    const { error } = await supabase
      .from('auditoria')
      .insert({
        data: new Date().toISOString(),
        usuario: usuarioEmail || '',
        acao,
        detalhes: typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes || {}),
      });
    if (error) console.warn('Falha ao registrar auditoria:', error.message);
  } catch (e) {
    console.warn('Falha ao registrar auditoria:', e.message);
  }
}

// ============================================================
// EXPORT DEFAULT (compatibilidade)
// ============================================================
export default {
  getValues,
  getBatchValues,
  appendRow,
  updateCell,
  batchUpdateCells,
  deleteRow,
  ensureSheetExists,
  findRowIndex,
  parseFiliais,
  sessaoTemAcessoAUnidade,
  resolverUnidadeParaEscrita,
  findUsuarioByEmail,
  createSession,
  validateSession,
  cleanupExpiredSessions,
  registrarHistorico,
  registrarAuditoria,
  supabase,
  TABLES,
};