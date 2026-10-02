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
export function toCamelCase(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

export function toSnakeCase(obj) {
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

// ============================================================
// CASAMENTO TOLERANTE DE UNIDADES
// O nome da escola varia entre sistemas e épocas: "E.E. CESAR DONATO
// CALABREZ" (chamados, padronizado), "Cesar Donato Calabrez" (legado SCE) e
// a linha composta de escolas irmãs "E.E. A / E.E. B" precisam casar entre
// si — escolas irmãs compartilham o mesmo painel de equipamentos.
// Normalização: sem prefixo "E.E.", sem acentos/pontuação, sem honoríficos
// no final; casa quando um lado contém o outro em palavras completas.
// ============================================================
/**
 * Honoríficos que aparecem no FIM do nome da escola. Sem esta lista,
 * "Haydee Hidalgo Professora" (legado) não se reconhecia como a mesma escola
 * de "E.E. HAYDEE HIDALGO" (oficial) — a forma completa precisa estar aqui,
 * porque abreviação tipo "PROF"/"PROFA" não cobre "PROFESSORA".
 */
const HONORIFICOS = new Set([
  'PROF', 'PROFA', 'PROFESSOR', 'PROFESSORA', 'PROFESSORES',
  'DR', 'DRA', 'DOUTOR', 'DOUTORA',
  'DEP', 'DEPUTADO', 'DEPUTADA',
  'PRESIDENTE', 'PRESIDENTA',
  'MAESTRO', 'MAESTRA',
  'GOVERNADOR', 'GOVERNADORA',
  'VEREADOR', 'VEREADORA',
  'DIRETOR', 'DIRETORA',
  'COORDENADOR', 'COORDENADORA',
  'BIBLIOTECA', 'BIBLIOTECARIA',
]);

export function chaveUnidade(nome) {
  return String(nome || '')
    .trim()
    .toUpperCase()
    // remove o prefixo "E.E." em qualquer posição (início ou após a barra do composto)
    .replace(/\bE\.?E\.?\s*/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tira honoríficos do fim do nome ("... PROFESSORA" → "..."), sem esvaziar a chave. */
function semHonorificos(chave) {
  let atual = chave;
  while (atual) {
    const partes = atual.split(' ');
    // nunca esvazia: a chave cheia já foi registrada por quem chama
    if (partes.length < 2) break;
    if (!HONORIFICOS.has(partes[partes.length - 1])) break;
    atual = partes.slice(0, -1).join(' ');
  }
  return atual;
}

/** Conjunto de chaves de um nome: inteiro, sem honoríficos e cada parte de composto ("A / B"). */
export function chavesUnidade(nome) {
  const chaves = new Set();
  const add = (valor) => {
    const k = chaveUnidade(valor);
    if (!k) return;
    chaves.add(k);
    const s = semHonorificos(k);
    if (s) chaves.add(s);
  };
  add(nome);
  for (const parte of String(nome || '').split('/')) add(parte);
  return [...chaves];
}

/**
 * Duas unidades casam quando alguma chave de um lado é igual OU uma contém a
 * outra em palavras completas ("E.E. A" dentro de "E.E. A SOBRINHO").
 *
 * Usado só para CONTROLE DE ACESSO, onde errar para mais é o lado seguro: a
 * filial enxerga um pouco mais do que devia, mas nunca perde o próprio parque.
 * NÃO usar para canonicalizar nome — ver `mesmaEscola`.
 */
export function unidadesCasam(a, b) {
  const ka = chavesUnidade(a);
  const kb = chavesUnidade(b);
  for (const x of ka) {
    for (const y of kb) {
      if (x === y) return true;
      if (x.length > 3 && y.startsWith(x + ' ')) return true;
      if (y.length > 3 && x.startsWith(y + ' ')) return true;
    }
  }
  return false;
}

/**
 * Matcher ESTREITO: as duas grafias são a mesma escola quando compartilham
 * alguma chave normalizada (o conjunto inclui a variante sem honoríficos, o
 * que faz "Haydee Hidalgo Professora" casar com "E.E. HAYDEE HIDALGO").
 *
 * Diferente de `unidadesCasam` de propósito: aqui errar para o lado oposto
 * seria grave. "E.E. JOAO SILVA" e "E.E. JOAO SILVA SOBRINHO" compartilham
 * prefixo, mas são escolas distintas — se casassem, a canonicalização
 * trocaria o equipamento de uma escola para o nome da outra, corrompendo o
 * dado. Por isso a interseção precisa ser exata, não por contenção.
 */
export function mesmaEscola(a, b) {
  const chavesA = new Set(chavesUnidade(a));
  return chavesUnidade(b).some((k) => chavesA.has(k));
}

// ============================================================
// NOME OFICIAL DA UNIDADE
// A coluna `equipamentos.unidade` é TEXT livre (não é FK para
// `filiais.nome`), então a mesma escola pode estar gravada com
// grafias diferentes — "E.E. HAYDEE HIDALGO" (oficial) e
// "Haydee Hidalgo Professora" (legado do Google Sheets). Como o
// filtro e os agregados agrupavam pela string exata, a escola
// aparecia duplicada na lista de unidades.
//
// O índice abaixo resolve qualquer grafia para o nome oficial de
// `filiais`, usando o matcher estrito. Sem correspondência, o texto
// de origem é preservado (uma escola fora de `filiais` não pode
// quebrar o cadastro).
// ============================================================
export function criarIndiceUnidades(nomesOficiais = []) {
  const oficiais = [...new Set(nomesOficiais.map((n) => String(n || '').trim()).filter(Boolean))];
  const memo = new Map();

  const canonico = (nome) => {
    const alvo = String(nome || '').trim();
    if (!alvo) return null;
    if (memo.has(alvo)) return memo.get(alvo);
    const achado =
      oficiais.find((o) => o === alvo) || oficiais.find((o) => mesmaEscola(o, alvo)) || null;
    memo.set(alvo, achado);
    return achado;
  };

  return {
    oficiais,
    /** Nome oficial da unidade, ou null quando ela não está em `filiais`. */
    canonico,
    /** Grafia a persistir/exibir: o oficial quando conhecido, senão a de origem. */
    resolver(nome) {
      const limpo = String(nome || '').trim();
      if (!limpo) return '';
      return canonico(limpo) || limpo;
    },
    /** Chave de agrupamento (agregados/gráficos): 'Sem unidade' quando vazio. */
    agrupar(nome) {
      return this.resolver(nome) || 'Sem unidade';
    },
    /**
     * Todas as grafias conhecidas que representam a mesma unidade que `nome`.
     * Serve para o filtro no banco (`in`) e para o relatório de migração.
     * Sem correspondência em `filiais`, devolve o próprio nome.
     */
    grafiasIguais(nome, grafiasConhecidas = oficiais) {
      const alvo = String(nome || '').trim();
      if (!alvo) return [];
      const oficial = canonico(alvo);
      if (!oficial) return [alvo];
      const grupo = new Set([oficial]);
      for (const g of grafiasConhecidas || []) {
        const limpo = String(g || '').trim();
        if (limpo && mesmaEscola(limpo, oficial)) grupo.add(limpo);
      }
      return [...grupo];
    },
  };
}

/**
 * Junta grafias que representam a MESMA escola, por transitividade: se duas
 * compartilham alguma chave normalizada, caem no mesmo grupo. O composto
 * "E.E. A / E.E. B" traz as partes, então uma grafia simples casa com ele.
 *
 * Devolve `[{ chaves, grafias }]` — `chaves` é o acumulado do grupo, para a
 * comparação seguinte. É a MESMA regra que `criarIndiceUnidades` usa: quem
 * precisa agrupar (script de migração, conferência) tem de chamar isto, nunca
 * reimplementar a comparação.
 */
export function agruparGrafiasUnidade(grafias) {
  const grupos = [];
  for (const g of grafias) {
    const nome = String(g || '').trim();
    if (!nome) continue;
    const chaves = new Set(chavesUnidade(nome));
    const alvo = grupos.find((grp) => [...chaves].some((k) => grp.chaves.has(k)));
    if (alvo) {
      alvo.grafias.push(nome);
      for (const k of chaves) alvo.chaves.add(k);
    } else {
      grupos.push({ chaves, grafias: [nome] });
    }
  }
  return grupos;
}

/** Prefixos de ensino: marcam o nome que vem do cadastro de chamados. */
const PREFIXO_ENSINO = /^(E\.[EFMAPI]|C\.[EFM])\b/;

/**
 * Escolhe o nome oficial entre as grafias de uma mesma escola, por:
 * 1) a que tem prefixo de ensino (E.E., E.M., C.E.…) — o nome "de sistema";
 * 2) em empate, a de maior volume de equipamentos;
 * 3) em empate, a primeira em ordem alfabética (determinístico).
 *
 * `volumes` é um Map { grafia: nº de equipamentos }.
 */
export function escolherNomeOficial(grafias, volumes = new Map()) {
  return [...grafias].sort((a, b) => {
    const pa = PREFIXO_ENSINO.test(String(a).trim().toUpperCase()) ? 1 : 0;
    const pb = PREFIXO_ENSINO.test(String(b).trim().toUpperCase()) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const qa = volumes.get(a) || 0;
    const qb = volumes.get(b) || 0;
    if (qa !== qb) return qb - qa;
    return a.localeCompare(b, 'pt-BR');
  })[0];
}

export function sessaoTemAcessoAUnidade(session, unidade) {
  const niveis = {
    MATRIZ: 'Matriz',
    ADMIN_FILIAL: 'AdminFilial',
    FILIAL: 'Filial',
    TECNICO: 'Tecnico',
  };
  if (session.nivel === niveis.MATRIZ) return true;
  if (session.nivel === niveis.TECNICO) {
    return parseFiliais(session.filial).some((f) => unidadesCasam(f, unidade));
  }
  // AdminFilial/Filial: casamento tolerante (cobre legado, "E.E." e compostos)
  return unidadesCasam(session.filial, unidade);
}

/**
 * Erro de permissão/permissão de escrita.
 *
 * `status` para que o handler do servidor responda 403 em vez de 500 (antes
 * estas viravam "erro interno"). Não importa `security.js` para não criar
 * ciclo de imports.
 */
function erroPermissao(mensagem) {
  const err = new Error(mensagem);
  err.status = 403;
  err.expose = true;
  return err;
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
    if (unidadeInformada && !unidadesCasam(unidadeInformada, session.filial)) {
      throw erroPermissao('Você só pode cadastrar equipamentos na sua própria unidade.');
    }
    return session.filial;
  }
  if (session.nivel === niveis.TECNICO) {
    const unidadesTecnico = parseFiliais(session.filial);
    if (unidadeInformada) {
      if (!sessaoTemAcessoAUnidade(session, unidadeInformada)) {
        throw erroPermissao(`Você não atende a unidade "${unidadeInformada}".`);
      }
      return unidadeInformada;
    }
    if (unidadesTecnico.length === 1) return unidadesTecnico[0];
    throw erroPermissao('Informe para qual unidade este equipamento deve ser cadastrado.');
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
  criarIndiceUnidades,
  unidadesCasam,
  mesmaEscola,
  chavesUnidade,
  agruparGrafiasUnidade,
  escolherNomeOficial,
  findUsuarioByEmail,
  createSession,
  validateSession,
  cleanupExpiredSessions,
  registrarHistorico,
  registrarAuditoria,
  supabase,
  TABLES,
};