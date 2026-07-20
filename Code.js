/**
 * ============================================================================
 * SCE - Sistema de Controle de Equipamentos
 * Code.gs — núcleo do servidor: roteamento, autenticação e acesso a dados
 * ----------------------------------------------------------------------------
 * ARQUITETURA (v2 - Sheets API v4 + 3 planilhas):
 *
 *   Este projeto NÃO é mais "bound" a uma única planilha via SpreadsheetApp.
 *   Todo acesso a dados passa pelo serviço avançado "Sheets API" (Sheets.*),
 *   e as abas estão distribuídas em 3 planilhas separadas:
 *
 *     SCE_Core            -> Equipamentos, Listas, Filiais
 *     SCE_Movimentacao    -> Historico_Itens, Emprestimos, Auditoria, Registros_Manutencao
 *     SCE_Autenticacao    -> Usuarios, Sessoes, Otp_Codes
 *
 *   Por quê: Core é lido o tempo todo (dashboards); Movimentacao cresce
 *   rápido e não deveria "pesar" a leitura de Core; Autenticacao guarda
 *   dado sensível (sessão, e-mail, OTP) separado do resto.
 *
 *   IMPORTANTE — ATIVAÇÃO OBRIGATÓRIA ANTES DE RODAR:
 *   1. No editor do Apps Script: Serviços (ícone "+") > adicionar
 *      "Google Sheets API" (serviço avançado). Isso expõe o objeto global
 *      `Sheets` usado neste arquivo.
 *   2. No Google Cloud Console do projeto associado ao script (Configurações
 *      do projeto > Projeto do Google Cloud), ative a API "Google Sheets API"
 *      em "APIs e serviços > Biblioteca".
 *   3. Preencha CONFIG.SPREADSHEETS.CORE / MOVIMENTACAO / AUTENTICACAO com
 *      os IDs reais das 3 planilhas (retire da URL de cada uma).
 *   4. Compartilhe as 3 planilhas com a conta que executa o script (se não
 *      forem do mesmo dono) e garanta que cada uma tenha as abas com os
 *      cabeçalhos exatos esperados (ver getAllEquipamentos_, Usuarios, etc).
 *
 *   IMPORTANTE — COLUNAS NOVAS NECESSÁRIAS NA ABA "Equipamentos" (SCE_Core):
 *     - statusManutencao       (texto: Pendente / Em andamento / Concluído)
 *     - vinculadoBlueMonitor   (texto: Sim / Não — usado por Matriz e Técnico)
 *     - ultimaAlteracaoPor     (texto: e-mail de quem fez a última edição)
 *   Sem essas colunas no cabeçalho, os valores relacionados simplesmente não
 *   são persistidos (o código verifica a existência da coluna antes de
 *   escrever, então não quebra — só não salva nada).
 *
 *   IMPORTANTE — ABA "Listas" (SCE_Core) precisa ter as colunas:
 *     - categoria | marca | modelo
 *   (cada coluna pode ter quantidade de linhas diferente, o código lê cada
 *   uma independentemente e ignora células vazias.)
 *
 *   REGRA DE ROTEAMENTO (inalterada):
 *   Toda decisão de "qual dashboard mostrar" acontece SOMENTE no doGet.
 *   DashboardFilial.html, DashboardMatriz.html e DashboardTecnico.html não
 *   têm lógica de role.
 *
 *   COMPATIBILIDADE COM O FRONTEND:
 *   Nenhuma função chamada via google.script.run mudou de nome ou de
 *   assinatura anterior. Novas funções foram adicionadas; funções existentes
 *   ganharam parâmetros opcionais (ex: registrarManutencao agora aceita um
 *   4º parâmetro "status", mas continua funcionando se ele não for enviado).
 * ============================================================================
 */

// ============================================================================
// CONFIGURAÇÃO GLOBAL
// ============================================================================

const CONFIG = {
  // Cada planilha é um arquivo do Google Sheets diferente agora.
  // Preencha com o ID real (parte da URL entre /d/ e /edit).
  SPREADSHEETS: {
    CORE: '12_mPXKeEZJMpj2ZEpzI3HOYwqShJWDjD7787elXVxXk',
    MOVIMENTACAO: '1BhGd2zUMkD1u1NfgzPO3xJx8s_8oLt22X3VX9jvwA6A',
    AUTENTICACAO: '1Put-0wIVN-60oP5EaunbSCwbDhzCo2yLxJ_FV26auy0'
  },
  SHEETS: {
    EQUIPAMENTOS: 'Equipamentos',
    LISTAS: 'Listas',
    FILIAIS: 'Filiais',
    HISTORICO: 'Historico_Itens',
    EMPRESTIMOS: 'Emprestimos',
    AUDITORIA: 'Auditoria',
    REGISTROS_MANUTENCAO: 'Registros_Manutencao',
    USUARIOS: 'Usuarios',
    SESSOES: 'Sessoes',
    OTP: 'Otp_Codes'
  },
  PDF_FOLDER_ID: '1P03gJm7JJ3ZIJnhBvRyhwghZEOI_pce_',
  BO_FOLDER_ID: '1wuBUvgsfP7GorZ9-7J_6la-U0BPpj8SY',
  SESSION_DURATION_MS: 24 * 60 * 60 * 1000,   // 24h
  OTP_EXPIRATION_MS: 10 * 60 * 1000,          // 10min
  NIVEIS: {
    MATRIZ: 'Matriz',
    FILIAL: 'Filial',
    TECNICO: 'Tecnico'
  },
  STATUS_USUARIO: {
    ATIVO: 'Ativo',
    REMOVIDO: 'Removido'
  },
  STATUS_MANUTENCAO: {
    PENDENTE: 'Pendente',
    EM_ANDAMENTO: 'Em andamento',
    CONCLUIDO: 'Concluído'
  }
};

const STATUS_MANUTENCAO_VALIDOS_ = [
  CONFIG.STATUS_MANUTENCAO.PENDENTE,
  CONFIG.STATUS_MANUTENCAO.EM_ANDAMENTO,
  CONFIG.STATUS_MANUTENCAO.CONCLUIDO
];

// Mapeia cada nome de aba para a planilha (spreadsheetId) onde ela vive.
// Isso é o que permite que o resto do código continue falando "a aba
// Equipamentos" sem se importar em qual arquivo físico ela está.
function getSpreadsheetIdFor_(sheetName) {
  const mapa = {};
  mapa[CONFIG.SHEETS.EQUIPAMENTOS] = CONFIG.SPREADSHEETS.CORE;
  mapa[CONFIG.SHEETS.LISTAS] = CONFIG.SPREADSHEETS.CORE;
  mapa[CONFIG.SHEETS.FILIAIS] = CONFIG.SPREADSHEETS.CORE;
  mapa[CONFIG.SHEETS.HISTORICO] = CONFIG.SPREADSHEETS.MOVIMENTACAO;
  mapa[CONFIG.SHEETS.EMPRESTIMOS] = CONFIG.SPREADSHEETS.MOVIMENTACAO;
  mapa[CONFIG.SHEETS.AUDITORIA] = CONFIG.SPREADSHEETS.MOVIMENTACAO;
  mapa[CONFIG.SHEETS.REGISTROS_MANUTENCAO] = CONFIG.SPREADSHEETS.MOVIMENTACAO;
  mapa[CONFIG.SHEETS.USUARIOS] = CONFIG.SPREADSHEETS.AUTENTICACAO;
  mapa[CONFIG.SHEETS.SESSOES] = CONFIG.SPREADSHEETS.AUTENTICACAO;
  mapa[CONFIG.SHEETS.OTP] = CONFIG.SPREADSHEETS.AUTENTICACAO;

  const id = mapa[sheetName];
  if (!id) {
    throw new Error('Nenhuma planilha mapeada para a aba "' + sheetName + '". Verifique getSpreadsheetIdFor_.');
  }
  if (id.indexOf('COLOQUE_AQUI') === 0) {
    throw new Error('CONFIG.SPREADSHEETS não foi preenchido com IDs reais ainda (aba "' + sheetName + '").');
  }
  return id;
}

// Atalhos usados em código legado / clareza de leitura.
function getCoreSheetId_() { return CONFIG.SPREADSHEETS.CORE; }
function getMovimentacaoSheetId_() { return CONFIG.SPREADSHEETS.MOVIMENTACAO; }
function getAutenticacaoSheetId_() { return CONFIG.SPREADSHEETS.AUTENTICACAO; }

// ============================================================================
// CAMADA DE ACESSO — Sheets API v4 (substitui SpreadsheetApp em todo o projeto)
// ============================================================================

/**
 * Lê todos os valores de uma aba inteira (equivalente a getDataRange().getValues()).
 * Usa Values.get, que é uma única chamada de API.
 * @return {Array<Array>} matriz de valores, ou [] se a aba estiver vazia.
 */
function sheetsApiGetValues_(sheetName) {
  const spreadsheetId = getSpreadsheetIdFor_(sheetName);
  try {
    const resp = Sheets.Spreadsheets.Values.get(spreadsheetId, sheetName);
    return resp.values || [];
  } catch (e) {
    throw new Error('Erro ao ler aba "' + sheetName + '" via Sheets API: ' + e.message);
  }
}

/**
 * Lê múltiplas abas de uma vez (mesma planilha ou não) minimizando chamadas.
 * Abas da mesma planilha são agrupadas num único batchGet.
 * @param {Array<string>} sheetNames
 * @return {Object} map sheetName -> Array<Array>
 */
function sheetsApiBatchGetValues_(sheetNames) {
  const porPlanilha = {}; // spreadsheetId -> [sheetName,...]
  sheetNames.forEach(function (nome) {
    const id = getSpreadsheetIdFor_(nome);
    if (!porPlanilha[id]) porPlanilha[id] = [];
    porPlanilha[id].push(nome);
  });

  const resultado = {};
  Object.keys(porPlanilha).forEach(function (spreadsheetId) {
    const ranges = porPlanilha[spreadsheetId];
    const resp = Sheets.Spreadsheets.Values.batchGet(spreadsheetId, { ranges: ranges });
    (resp.valueRanges || []).forEach(function (vr, idx) {
      resultado[ranges[idx]] = vr.values || [];
    });
  });
  return resultado;
}

/**
 * Adiciona uma linha ao final de uma aba (equivalente a sheet.appendRow(...)).
 */
function sheetsApiAppendRow_(sheetName, rowValues) {
  const spreadsheetId = getSpreadsheetIdFor_(sheetName);
  const resource = { values: [rowValues] };
  Sheets.Spreadsheets.Values.append(
    resource, spreadsheetId, sheetName,
    { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' }
  );
}

/** Converte índice de coluna 1-based em letra (1 -> A, 27 -> AA). */
function columnToLetter_(col) {
  let letra = '';
  while (col > 0) {
    const resto = (col - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    col = Math.floor((col - 1) / 26);
  }
  return letra;
}

/**
 * Atualiza uma única célula (equivalente a sheet.getRange(row, col).setValue(v)).
 */
function sheetsApiUpdateCell_(sheetName, row, col, value) {
  sheetsApiBatchUpdateCells_(sheetName, [{ row: row, col: col, value: value }]);
}

/**
 * Atualiza várias células de uma aba EM UMA ÚNICA chamada de API
 * (Values.batchUpdate), mesmo que sejam linhas/colunas diferentes.
 * Isso é o que evita "1 chamada por campo alterado" no updateEquipamento.
 * @param {Array<{row:number, col:number, value:*}>} cellUpdates
 */
function sheetsApiBatchUpdateCells_(sheetName, cellUpdates) {
  if (!cellUpdates || cellUpdates.length === 0) return;
  const spreadsheetId = getSpreadsheetIdFor_(sheetName);
  const data = cellUpdates.map(function (u) {
    return {
      range: sheetName + '!' + columnToLetter_(u.col) + u.row,
      values: [[u.value === undefined || u.value === null ? '' : u.value]]
    };
  });
  Sheets.Spreadsheets.Values.batchUpdate(
    { valueInputOption: 'USER_ENTERED', data: data },
    spreadsheetId
  );
}

/**
 * Salva o anexo do Boletim de Ocorrência no Drive (pasta CONFIG.BO_FOLDER_ID)
 * e devolve a URL. Chamado só quando status = 'Extraviado' e um arquivo foi enviado.
 * @param {string} base64 conteúdo do arquivo em base64 (sem o prefixo data:...)
 * @param {string} mimeType
 * @param {string} fileName
 */
function salvarAnexoBoletim_(base64, mimeType, fileName) {
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, fileName);
  const pasta = CONFIG.BO_FOLDER_ID ? DriveApp.getFolderById(CONFIG.BO_FOLDER_ID) : null;
  const file = pasta ? pasta.createFile(blob) : DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

/** Cache simples em memória (por execução) do sheetId numérico de cada aba. */
const _sheetIdCache_ = {};

function getNumericSheetId_(sheetName) {
  if (_sheetIdCache_[sheetName] !== undefined) return _sheetIdCache_[sheetName];
  const spreadsheetId = getSpreadsheetIdFor_(sheetName);
  const meta = Sheets.Spreadsheets.get(spreadsheetId, { fields: 'sheets(properties(sheetId,title))' });
  const encontrada = (meta.sheets || []).filter(function (s) { return s.properties.title === sheetName; })[0];
  if (!encontrada) throw new Error('Aba "' + sheetName + '" não encontrada na planilha.');
  _sheetIdCache_[sheetName] = encontrada.properties.sheetId;
  return encontrada.properties.sheetId;
}

/**
 * Remove fisicamente uma linha (equivalente a sheet.deleteRow(n)).
 * Usado apenas onde já era usado antes (ex: Otp_Codes) — o restante do
 * sistema usa soft-delete (marcar status) e não precisa disso.
 */
function sheetsApiDeleteRow_(sheetName, rowIndex1Based) {
  const spreadsheetId = getSpreadsheetIdFor_(sheetName);
  const sheetId = getNumericSheetId_(sheetName);
  Sheets.Spreadsheets.batchUpdate({
    requests: [{
      deleteDimension: {
        range: { sheetId: sheetId, dimension: 'ROWS', startIndex: rowIndex1Based - 1, endIndex: rowIndex1Based }
      }
    }]
  }, spreadsheetId);
}

/**
 * Garante que uma aba existe numa planilha, criando com cabeçalho se não
 * existir ainda (equivalente ao antigo getEmprestimosSheet_ "create if missing").
 */
function ensureSheetExists_(sheetName, headers) {
  const spreadsheetId = getSpreadsheetIdFor_(sheetName);
  const meta = Sheets.Spreadsheets.get(spreadsheetId, { fields: 'sheets(properties(title))' });
  const existe = (meta.sheets || []).some(function (s) { return s.properties.title === sheetName; });
  if (!existe) {
    Sheets.Spreadsheets.batchUpdate({ requests: [{ addSheet: { properties: { title: sheetName } } }] }, spreadsheetId);
    sheetsApiAppendRow_(sheetName, headers);
    delete _sheetIdCache_[sheetName];
  }
}

// ============================================================================
// AUDITORIA / CABEÇALHOS DE ABAS AUXILIARES
// ============================================================================

const EMPRESTIMOS_HEADERS_ = [
  'id', 'equipamentoId', 'patrimonio', 'unidade', 'responsavel', 'cpf',
  'emailResponsavel', 'dataEmprestimo', 'dataPrevistaDevolucao',
  'dataDevolucao', 'status', 'termoPdfUrl', 'criadoPor', 'devolvidoPor',
  'observacoes'
];

const AUDITORIA_HEADERS_ = ['data', 'usuario', 'acao', 'detalhes'];

// Inclui "status" (Pendente/Em andamento/Concluído) por entrada do diário,
// além de campo/descrição livre.
const REGISTROS_MANUTENCAO_HEADERS_ = ['id', 'equipamentoId', 'autor', 'data', 'descricao', 'status'];

// ============================================================================
// SUPORTE A MULTI-UNIDADE (perfil Técnico)
// ----------------------------------------------------------------------------
// Filial tem 1 unidade (session.filial, string). Técnico pode ter várias,
// guardadas na MESMA coluna "filial" da aba Usuarios, separadas por vírgula
// (ex: "Unidade A, Unidade B"). Isso evita criar uma aba nova só para isso.
// ============================================================================

/** Transforma "Unidade A, Unidade B" em ['Unidade A', 'Unidade B']. */
function parseFiliais_(filialRaw) {
  return String(filialRaw || '')
    .split(',')
    .map(function (f) { return f.trim(); })
    .filter(function (f) { return f.length > 0; });
}

/**
 * Verifica se a sessão (Matriz/Filial/Técnico) tem permissão sobre uma
 * determinada unidade. Ponto único de checagem — usado em todo lugar que
 * antes comparava "session.filial !== linha.unidade" diretamente.
 */
function sessaoTemAcessoAUnidade_(session, unidade) {
  if (session.nivel === CONFIG.NIVEIS.MATRIZ) return true;

  const unidadeNormalizada = String(unidade || '').trim().toUpperCase();
  const unidadesDaSessao = parseFiliais_(session.filial).map(function (f) { return f.toUpperCase(); });
  return unidadesDaSessao.indexOf(unidadeNormalizada) !== -1;
}

/**
 * Decide qual unidade gravar num equipamento novo:
 *   - Matriz: usa a unidade informada no payload (ou a própria, se não vier).
 *   - Filial: sempre a própria unidade (nunca confia no payload do client).
 *   - Técnico: exige que a unidade informada no payload esteja entre as
 *     unidades vinculadas a ele. Se ele só atende 1 unidade, usa por padrão.
 */
function resolverUnidadeParaEscrita_(session, unidadeInformada) {
  if (session.nivel === CONFIG.NIVEIS.MATRIZ) {
    return unidadeInformada || session.filial;
  }

  if (session.nivel === CONFIG.NIVEIS.TECNICO) {
    const unidadesTecnico = parseFiliais_(session.filial);
    if (unidadeInformada) {
      if (!sessaoTemAcessoAUnidade_(session, unidadeInformada)) {
        throw new Error('Você não atende a unidade "' + unidadeInformada + '".');
      }
      return unidadeInformada;
    }
    if (unidadesTecnico.length === 1) return unidadesTecnico[0];
    throw new Error('Informe para qual unidade este equipamento deve ser cadastrado.');
  }

  // Filial
  return session.filial;
}

/**
 * Registra uma linha de auditoria para QUALQUER operação de escrita
 * (create/update/clone/remover equipamento, empréstimo/devolução, usuários).
 * Não lança erro se falhar — auditoria não pode derrubar a operação principal.
 */
function registrarAuditoria_(acao, usuarioEmail, detalhes) {
  try {
    ensureSheetExists_(CONFIG.SHEETS.AUDITORIA, AUDITORIA_HEADERS_);
    const detalhesStr = typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes || {});
    sheetsApiAppendRow_(CONFIG.SHEETS.AUDITORIA, [new Date(), usuarioEmail || '', acao, detalhesStr]);
  } catch (e) {
    Logger.log('Falha ao registrar auditoria (' + acao + '): ' + e.message);
  }
}

// ============================================================================
// FUNÇÕES DE DIAGNÓSTICO (mantidas, adaptadas para a nova camada de acesso)
// ============================================================================

function testarEmail() {
  try {
    MailApp.sendEmail('es.pablo.sousa@servidor.educacao.sp.gov.br', 'Teste', 'Funcionou!');
    console.log('E-mail enviado com sucesso.');
  } catch (err) {
    console.error('Erro no teste de e-mail:', err.message);
  }
}

function testarPlanilhaUI() {
  Logger.log('[testarPlanilhaUI] INÍCIO');
  let resultado;
  try {
    const data = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    Logger.log('[testarPlanilhaUI] total linhas: ' + data.length);
    resultado = {
      ok: true,
      totalLinhas: data.length,
      cabecalho: data[0] || [],
      primeiraLinha: data[1] || null
    };
  } catch (err) {
    Logger.log('[testarPlanilhaUI] ERRO: ' + err.message);
    resultado = { ok: false, motivo: 'Erro ao ler planilha: ' + err.message };
  }
  Logger.log('[testarPlanilhaUI] retornando: ' + JSON.stringify(resultado));
  return resultado;
}

function testarLeituraEquipamentos() {
  try {
    const todos = getAllEquipamentos_();
    return {
      total: todos.length,
      primeiros: todos.slice(0, 3),
      colunas: todos.length > 0 ? Object.keys(todos[0]) : []
    };
  } catch (e) {
    return { erro: e.message };
  }
}

function testarRetorno() {
  return [
    { id: 'teste1', categoria: 'Notebook', marca: 'Lenovo', modelo: 'Ultra', patrimonio: '123', status: 'Disponível', unidade: 'PABLO FILIAL' },
    { id: 'teste2', categoria: 'Desktop', marca: 'Dell', modelo: 'OptiPlex', patrimonio: '456', status: 'Disponível', unidade: 'PABLO FILIAL' }
  ];
}

// Função temporária para testar a sessão (mantida por compatibilidade com
// chamadas manuais de diagnóstico já usadas anteriormente).
function getSessionByToken_(token) {
  try {
    const data = sheetsApiGetValues_(CONFIG.SHEETS.SESSOES);
    const rows = data.slice(1);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row[0] === token) {
        const sessionObj = {
          token: row[0], email: row[1], nivel: row[2], filial: row[3],
          criadoEm: row[4], expiraEm: row[5]
        };
        if (sessionObj.expiraEm && sessionObj.expiraEm < Date.now()) {
          Logger.log('Token expirado: ' + token);
          return null;
        }
        return sessionObj;
      }
    }
    Logger.log('Token não encontrado: ' + token);
    return null;
  } catch (e) {
    Logger.log('Erro em getSessionByToken_: ' + e.message);
    return null;
  }
}

// ============================================================================
// doGet — PONTO ÚNICO DE ROTEAMENTO (inalterado)
// ============================================================================

function doGet(e) {
  try {
    const token = e && e.parameter ? e.parameter.token : null;
    const session = token ? validateSession_(token) : null;

    // LOG PARA DIAGNÓSTICO
    console.log('SESSION:', session);
    console.log('NIVEL:', session ? session.nivel : 'null');

    if (!session) {
      return renderTemplate_('Login');
    }

    if (session.nivel === CONFIG.NIVEIS.MATRIZ) {
      console.log('Servindo DashboardMatriz');
      return renderTemplate_('DashboardMatriz', { session: session });
    }

    if (session.nivel === CONFIG.NIVEIS.TECNICO) {
      console.log('Servindo DashboardTecnico');
      return renderTemplate_('DashboardTecnico', { session: session });
    }

    console.log('Servindo DashboardFilial (fallback)');
    return renderTemplate_('DashboardFilial', { session: session });
  } catch (err) {
    console.error('ERRO em doGet:', err.message);
    return HtmlService.createHtmlOutput(
      '<h2 style="color:red;">ERRO NO SERVIDOR</h2>' +
      '<p><strong>Mensagem:</strong> ' + err.message + '</p>' +
      '<p><strong>Stack:</strong> <pre>' + err.stack + '</pre></p>' +
      '<p><em>Verifique os IDs das 3 planilhas em CONFIG.SPREADSHEETS e se a Sheets API está ativada.</em></p>'
    );
  }
}

function renderTemplate_(fileName, vars) {
  const template = HtmlService.createTemplateFromFile(fileName);
  if (vars) {
    Object.keys(vars).forEach(function (key) { template[key] = vars[key]; });
  }
  return template.evaluate()
    .setTitle('SCE - Sistema de Controle de Equipamentos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(fileName) {
  try {
    return HtmlService.createHtmlOutputFromFile(fileName).getContent();
  } catch (e) {
    return '<!-- Arquivo "' + fileName + '" não encontrado -->';
  }
}

// ============================================================================
// AUTENTICAÇÃO — OTP (One-Time Password) — dados agora em SCE_Autenticacao
// ============================================================================

function requestOtp(email) {
  console.log('requestOtp chamada com email:', email);
  try {
    email = String(email || '').trim().toLowerCase();
    if (!email) {
      console.warn('E-mail vazio');
      return { ok: false, message: 'E-mail não informado.' };
    }

    const usuario = findUsuarioByEmail_(email);
    console.log('Usuário encontrado?', usuario ? 'Sim' : 'Não');

    if (!usuario) {
      console.warn('Usuário não cadastrado:', email);
      return { ok: false, message: 'Se este e-mail estiver cadastrado, um código será enviado.' };
    }
    if (usuario.status === CONFIG.STATUS_USUARIO.REMOVIDO) {
      console.warn('Usuário removido:', email);
      return { ok: false, message: 'Acesso não autorizado para este e-mail.' };
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const now = Date.now();

    try {
      upsertOtpRow_(email, code, now, now + CONFIG.OTP_EXPIRATION_MS);
      console.log('OTP salvo via Sheets API com sucesso.');
    } catch (sheetError) {
      console.error('Erro ao salvar OTP:', sheetError.message);
      return { ok: false, message: 'Erro ao salvar código: ' + sheetError.message };
    }

    try {
      MailApp.sendEmail({
        to: email,
        subject: 'SCE - Código de acesso',
        body: 'Seu código de acesso ao SCE é: ' + code + '\n\nEle expira em 10 minutos. Se você não solicitou este código, ignore este e-mail.'
      });
      console.log('E-mail enviado para:', email);
    } catch (mailError) {
      console.error('Erro ao enviar e-mail:', mailError.message);
      return { ok: false, message: 'Erro ao enviar e-mail: ' + mailError.message };
    }

    return { ok: true, message: 'Código enviado para ' + email + '.' };
  } catch (err) {
    console.error('Erro geral em requestOtp:', err.message);
    return { ok: false, message: 'Erro interno: ' + err.message };
  }
}

function validateOtp(email, code) {
  email = String(email || '').trim().toLowerCase();
  code = String(code || '').trim();

  const usuario = findUsuarioByEmail_(email);
  if (!usuario || usuario.status === CONFIG.STATUS_USUARIO.REMOVIDO) {
    return { ok: false, message: 'Acesso não autorizado para este e-mail.' };
  }

  const otpRow = findOtpRow_(email);
  if (!otpRow) {
    return { ok: false, message: 'Nenhum código pendente para este e-mail.' };
  }
  if (Date.now() > otpRow.expiraEm) {
    return { ok: false, message: 'Código expirado. Solicite um novo.' };
  }
  if (String(otpRow.code) !== code) {
    return { ok: false, message: 'Código incorreto.' };
  }

  deleteOtpRow_(otpRow.rowIndex);

  const session = createSession_(usuario);
  const url = ScriptApp.getService().getUrl() + '?token=' + encodeURIComponent(session.token);
  registrarAuditoria_('login', email, { via: 'otp' });
  return { ok: true, message: 'Login realizado com sucesso.', redirectUrl: url };
}

// ============================================================================
// SESSÃO (aba Sessoes, em SCE_Autenticacao)
// ============================================================================

function createSession_(usuario) {
  const token = Utilities.getUuid();
  const now = Date.now();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    sheetsApiAppendRow_(CONFIG.SHEETS.SESSOES, [
      token, usuario.email, usuario.nivel, usuario.filial, now, now + CONFIG.SESSION_DURATION_MS
    ]);
  } finally {
    lock.releaseLock();
  }

  return { token: token, email: usuario.email, nivel: usuario.nivel, filial: usuario.filial };
}

function validateSession_(token) {
  if (!token) return null;

  const data = sheetsApiGetValues_(CONFIG.SHEETS.SESSOES);
  // Colunas: token(0) | email(1) | nivel(2) | filial(3) | criadoEm(4) | expiraEm(5)
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === token) {
      const expiraEm = data[i][5];
      if (Date.now() > expiraEm) return null;

      const usuario = findUsuarioByEmail_(data[i][1]);
      if (!usuario || usuario.status === CONFIG.STATUS_USUARIO.REMOVIDO) return null;

      return { token: token, email: data[i][1], nivel: data[i][2], filial: data[i][3] };
    }
  }
  return null;
}

function requireSession_(token, nivelExigido) {
  const session = validateSession_(token);
  if (!session) {
    throw new Error('Sessão inválida ou expirada. Faça login novamente.');
  }
  if (nivelExigido && session.nivel !== nivelExigido) {
    throw new Error('Você não tem permissão para executar esta ação.');
  }
  return session;
}

// ============================================================================
// ACESSO A DADOS — USUÁRIOS (aba Usuarios, em SCE_Autenticacao)
// Estrutura: email(0) | nome(1) | nivel(2) | filial(3) | status(4) | dataRemocao(5)
// ============================================================================

function findUsuarioByEmail_(email) {
  const data = sheetsApiGetValues_(CONFIG.SHEETS.USUARIOS);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === email) {
      return {
        rowIndex: i + 1,
        email: data[i][0], nome: data[i][1], nivel: data[i][2],
        filial: data[i][3], status: data[i][4], dataRemocao: data[i][5]
      };
    }
  }
  return null;
}

// ============================================================================
// ACESSO A DADOS — OTP (aba Otp_Codes, em SCE_Autenticacao)
// Estrutura: email(0) | code(1) | criadoEm(2) | expiraEm(3)
// ============================================================================

function upsertOtpRow_(email, code, criadoEm, expiraEm) {
  const data = sheetsApiGetValues_(CONFIG.SHEETS.OTP);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === email) {
      sheetsApiBatchUpdateCells_(CONFIG.SHEETS.OTP, [
        { row: i + 1, col: 1, value: email },
        { row: i + 1, col: 2, value: code },
        { row: i + 1, col: 3, value: criadoEm },
        { row: i + 1, col: 4, value: expiraEm }
      ]);
      return;
    }
  }
  sheetsApiAppendRow_(CONFIG.SHEETS.OTP, [email, code, criadoEm, expiraEm]);
}

function findOtpRow_(email) {
  const data = sheetsApiGetValues_(CONFIG.SHEETS.OTP);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === email) {
      return { rowIndex: i + 1, email: data[i][0], code: data[i][1], criadoEm: data[i][2], expiraEm: data[i][3] };
    }
  }
  return null;
}

function deleteOtpRow_(rowIndex) {
  sheetsApiDeleteRow_(CONFIG.SHEETS.OTP, rowIndex);
}

// ============================================================================
// ACESSO A DADOS — EQUIPAMENTOS (aba Equipamentos, em SCE_Core)
// ============================================================================

function getAllEquipamentos_() {
  const data = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
  if (!data || data.length === 0) return [];
  const headers = data[0];
  const rows = data.slice(1);

  return rows.map(function (row, idx) {
    const obj = { _rowIndex: idx + 2 }; // linha real na planilha (1-based + cabeçalho)
    headers.forEach(function (header, colIdx) {
      obj[header] = row[colIdx] !== undefined ? row[colIdx] : '';
    });
    return obj;
  });
}

/**
 * Verifica se já existe outro equipamento ATIVO (não removido) com o mesmo
 * Número de Série ou Patrimônio. Comparação case-insensitive e com trim.
 * @param {string} numeroSerie
 * @param {string} patrimonio
 * @param {string} [ignorarId] id do próprio equipamento, usado na edição
 *   para não comparar o item consigo mesmo.
 * @return {boolean}
 */
function equipamentoDuplicado_(numeroSerie, patrimonio, ignorarId) {
  const serie = String(numeroSerie || '').trim().toUpperCase();
  const patr = String(patrimonio || '').trim().toUpperCase();
  if (!serie && !patr) return false;

  const todos = getAllEquipamentos_();
  return todos.some(function (e) {
    if (ignorarId && e.id === ignorarId) return false;
    if (e.status === 'Removido') return false;
    const serieIgual = !!serie && String(e.numeroSerie || '').trim().toUpperCase() === serie;
    const patrimonioIgual = !!patr && String(e.patrimonio || '').trim().toUpperCase() === patr;
    return serieIgual || patrimonioIgual;
  });
}

/**
 * Retorna os equipamentos visíveis para a sessão atual:
 *   - Matriz: todos.
 *   - Filial: só da própria unidade.
 *   - Técnico: de todas as unidades vinculadas a ele (session.filial pode
 *     conter várias, separadas por vírgula — ver sessaoTemAcessoAUnidade_).
 * Mantido com o nome antigo (getEquipamentosDaFilial) por compatibilidade
 * com o frontend já publicado (Filial e Matriz continuam chamando esta
 * função sem nenhuma mudança). O dashboard do Técnico chama a mesma função.
 */
function getEquipamentosDaFilial(token) {
  try {
    const session = requireSession_(token);
    if (!session) {
      Logger.log('Sessão não encontrada');
      return [];
    }

    Logger.log('Sessão: ' + session.email + ' (' + session.nivel + ') unidades: ' + session.filial);

    const todos = getAllEquipamentos_();
    if (!todos) {
      Logger.log('Nenhum equipamento encontrado');
      return [];
    }
    Logger.log('Total bruto: ' + todos.length);

    const filtrados = todos.filter(function (item) {
      const naoRemovido = item['status'] !== 'Removido';
      const temAcesso = sessaoTemAcessoAUnidade_(session, item['unidade']);
      return naoRemovido && temAcesso;
    });

    Logger.log('Filtrados: ' + filtrados.length);

    const jsonString = JSON.stringify(filtrados);
    return JSON.parse(jsonString);
  } catch (e) {
    Logger.log('ERRO CRÍTICO: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    return [];
  }
}

function getEquipamentosGlobal(token, incluirRemovidos) {
  try {
    const session = requireSession_(token);
    if (!session) {
      Logger.log('Sessão inválida para token: ' + token);
      return [];
    }

    const nivel = session.nivel || '';
    const isMatriz = nivel.trim().toUpperCase() === (CONFIG.NIVEIS.MATRIZ || 'MATRIZ').trim().toUpperCase();
    if (!isMatriz) {
      Logger.log('Usuário não é Matriz. Nível: ' + nivel);
      return [];
    }

    Logger.log('Usuário Matriz autenticado: ' + session.email);

    const todos = getAllEquipamentos_();
    if (!todos || !Array.isArray(todos)) {
      Logger.log('Falha ao ler equipamentos');
      return [];
    }
    Logger.log('Total bruto: ' + todos.length);

    const filtrados = todos.filter(function (item) {
      return incluirRemovidos ? true : item['status'] !== 'Removido';
    });
    Logger.log('Filtrados (Removidos ' + (incluirRemovidos ? 'incluídos' : 'excluídos') + '): ' + filtrados.length);

    const jsonString = JSON.stringify(filtrados);
    return JSON.parse(jsonString);
  } catch (e) {
    Logger.log('ERRO CRÍTICO em getEquipamentosGlobal: ' + e.message);
    return [];
  }
}

function createEquipamento(token, dadosEquipamento) {
  const session = requireSession_(token);
  const unidade = resolverUnidadeParaEscrita_(session, dadosEquipamento.unidade);

  // Verificação de duplicidade (Série/Patrimônio) ANTES de gastar o lock
  // com leitura/escrita — evita cadastro de item já existente.
  if (equipamentoDuplicado_(dadosEquipamento.numeroSerie, dadosEquipamento.patrimonio)) {
    throw new Error('Já existe um equipamento cadastrado com este Número de Série ou Patrimônio.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    const headers = data[0];

    const id = Utilities.getUuid();
    const now = new Date();
    const linha = headers.map(function (header) {
      if (header === 'id') return id;
      if (header === 'unidade') return unidade;
      if (header === 'status') return dadosEquipamento.status || 'Disponível';
      if (header === 'dataCadastro') return now;
      if (header === 'dataUltimaAtualizacao') return now;
      if (header === 'cadastradoPor') return session.email;
      if (header === 'ultimaAlteracaoPor') return session.email;
      if (header in dadosEquipamento) return dadosEquipamento[header];
      return '';
    });

    sheetsApiAppendRow_(CONFIG.SHEETS.EQUIPAMENTOS, linha);
    registrarHistorico_(id, 'criação', '', 'Equipamento cadastrado', session.email);
    registrarAuditoria_('createEquipamento', session.email, { id: id, unidade: unidade });

    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function updateEquipamento(token, id, camposAlterados) {
  const session = requireSession_(token);

  // Trata o anexo do B.O. separadamente (não é uma célula "simples")
  let anexoUrl = null;
  if (camposAlterados.status === 'Extraviado' && camposAlterados._anexoBoletim) {
    const anexo = camposAlterados._anexoBoletim; // { base64, mimeType, fileName }
    anexoUrl = salvarAnexoBoletim_(anexo.base64, anexo.mimeType, anexo.fileName);
    camposAlterados.boletimOcorrenciaAnexoUrl = anexoUrl;
    delete camposAlterados._anexoBoletim; // não é uma coluna, não deixa ir pro loop de células
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const unidadeCol = headers.indexOf('unidade');

    const rowIndex = findRowIndexById_(data, idCol, id);
    if (rowIndex === -1) throw new Error('Equipamento não encontrado.');

    const linhaAtual = data[rowIndex - 1];
    if (!sessaoTemAcessoAUnidade_(session, linhaAtual[unidadeCol])) {
      throw new Error('Você não tem permissão para editar este equipamento.');
    }

    // Verificação de duplicidade — só reavalia se Série ou Patrimônio
    // estão sendo alterados nesta edição.
    if (camposAlterados.numeroSerie !== undefined || camposAlterados.patrimonio !== undefined) {
      const serieNovaIdx = headers.indexOf('numeroSerie');
      const patrimonioNovoIdx = headers.indexOf('patrimonio');
      const serieNova = camposAlterados.numeroSerie !== undefined
        ? camposAlterados.numeroSerie
        : (serieNovaIdx !== -1 ? linhaAtual[serieNovaIdx] : '');
      const patrimonioNovo = camposAlterados.patrimonio !== undefined
        ? camposAlterados.patrimonio
        : (patrimonioNovoIdx !== -1 ? linhaAtual[patrimonioNovoIdx] : '');

      if (equipamentoDuplicado_(serieNova, patrimonioNovo, id)) {
        throw new Error('Já existe outro equipamento com este Número de Série ou Patrimônio.');
      }
    }

    validarStatusEspecial_(camposAlterados, linhaAtual, headers);

    // Monta TODAS as alterações de célula e manda numa única chamada
    // Values.batchUpdate, em vez de uma chamada por campo.
    const cellUpdates = [];
    const historicoParaRegistrar = [];

    Object.keys(camposAlterados).forEach(function (campo) {
      if (campo === 'id' || campo === 'dataCadastro' || campo === 'cadastradoPor') return;
      const colIndex = headers.indexOf(campo);
      if (colIndex === -1) return;

      const valorAntigo = linhaAtual[colIndex];
      const valorNovo = camposAlterados[campo];
      if (String(valorAntigo) === String(valorNovo)) return;

      cellUpdates.push({ row: rowIndex, col: colIndex + 1, value: valorNovo });
      historicoParaRegistrar.push({ campo: campo, antigo: valorAntigo, novo: valorNovo });
    });

    const atualizadoCol = headers.indexOf('dataUltimaAtualizacao');
    if (atualizadoCol !== -1 && cellUpdates.length > 0) {
      cellUpdates.push({ row: rowIndex, col: atualizadoCol + 1, value: new Date() });
    }

    // Registro de quem fez a última alteração — só aparece pro perfil
    // Matriz no front, mas é sempre gravado independente de quem edita.
    const ultimaAlteracaoCol = headers.indexOf('ultimaAlteracaoPor');
    if (ultimaAlteracaoCol !== -1 && cellUpdates.length > 0) {
      cellUpdates.push({ row: rowIndex, col: ultimaAlteracaoCol + 1, value: session.email });
    }

    if (cellUpdates.length > 0) {
      sheetsApiBatchUpdateCells_(CONFIG.SHEETS.EQUIPAMENTOS, cellUpdates);
    }

    historicoParaRegistrar.forEach(function (h) {
      registrarHistorico_(id, h.campo, h.antigo, h.novo, session.email);
    });
    if (historicoParaRegistrar.length > 0) {
      registrarAuditoria_('updateEquipamento', session.email, { id: id, campos: historicoParaRegistrar.map(function (h) { return h.campo; }) });
    }

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function cloneEquipamento(token, idOrigem) {
  const session = requireSession_(token);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const unidadeCol = headers.indexOf('unidade');
    const statusCol = headers.indexOf('status');

    const rowIndex = findRowIndexById_(data, idCol, idOrigem);
    if (rowIndex === -1) throw new Error('Equipamento não encontrado.');

    const linhaOrigem = data[rowIndex - 1];
    if (!sessaoTemAcessoAUnidade_(session, linhaOrigem[unidadeCol])) {
      throw new Error('Você não tem permissão para clonar este equipamento.');
    }

    const novoId = Utilities.getUuid();
    const novaLinha = linhaOrigem.slice();
    novaLinha[idCol] = novoId;
    novaLinha[statusCol] = 'Disponível';

    // Clone nunca deve herdar número de série/patrimônio do original —
    // isso causaria duplicidade instantânea. Zera esses campos e deixa
    // quem clonou preencher manualmente depois via edição.
    setIfHeaderExists_(novaLinha, headers, 'numeroSerie', '');
    setIfHeaderExists_(novaLinha, headers, 'patrimonio', '');
    setIfHeaderExists_(novaLinha, headers, 'dataCadastro', new Date());
    setIfHeaderExists_(novaLinha, headers, 'dataUltimaAtualizacao', new Date());
    setIfHeaderExists_(novaLinha, headers, 'cadastradoPor', session.email);
    setIfHeaderExists_(novaLinha, headers, 'ultimaAlteracaoPor', session.email);

    sheetsApiAppendRow_(CONFIG.SHEETS.EQUIPAMENTOS, novaLinha);
    registrarHistorico_(novoId, 'criação', '', 'Clonado a partir de ' + idOrigem, session.email);
    registrarAuditoria_('cloneEquipamento', session.email, { idOrigem: idOrigem, novoId: novoId });

    return { ok: true, id: novoId };
  } finally {
    lock.releaseLock();
  }
}

function removerEquipamento(token, id) {
  const session = requireSession_(token);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const unidadeCol = headers.indexOf('unidade');
    const statusCol = headers.indexOf('status');

    const rowIndex = findRowIndexById_(data, idCol, id);
    if (rowIndex === -1) throw new Error('Equipamento não encontrado.');

    const linhaAtual = data[rowIndex - 1];
    if (!sessaoTemAcessoAUnidade_(session, linhaAtual[unidadeCol])) {
      throw new Error('Você não tem permissão para remover este equipamento.');
    }

    const statusAntigo = linhaAtual[statusCol];
    sheetsApiUpdateCell_(CONFIG.SHEETS.EQUIPAMENTOS, rowIndex, statusCol + 1, 'Removido');
    registrarHistorico_(id, 'status', statusAntigo, 'Removido', session.email);
    registrarAuditoria_('removerEquipamento', session.email, { id: id });

    return { ok: true, message: 'Equipamento removido (soft-delete).' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Atualiza somente o status de manutenção (Pendente/Em andamento/Concluído)
 * de um equipamento, sem passar pelo fluxo completo de updateEquipamento.
 * Usado pelo modal de manutenção nos dashboards de Matriz e Técnico.
 * Também é chamada internamente por registrarManutencao() para manter a
 * coluna do equipamento sincronizada com a última entrada do diário.
 */
function atualizarStatusManutencao(token, equipamentoId, novoStatus) {
  const session = requireSession_(token);
  if (STATUS_MANUTENCAO_VALIDOS_.indexOf(novoStatus) === -1) {
    throw new Error('Status de manutenção inválido.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const unidadeCol = headers.indexOf('unidade');
    const statusManutCol = headers.indexOf('statusManutencao');
    const ultimaAlteracaoCol = headers.indexOf('ultimaAlteracaoPor');

    if (statusManutCol === -1) {
      throw new Error('Coluna "statusManutencao" não existe na aba Equipamentos. Adicione-a no cabeçalho.');
    }

    const rowIndex = findRowIndexById_(data, idCol, equipamentoId);
    if (rowIndex === -1) throw new Error('Equipamento não encontrado.');

    const linhaAtual = data[rowIndex - 1];
    if (!sessaoTemAcessoAUnidade_(session, linhaAtual[unidadeCol])) {
      throw new Error('Você não tem permissão para alterar este equipamento.');
    }

    const statusAntigo = linhaAtual[statusManutCol];
    if (String(statusAntigo) === String(novoStatus)) {
      return { ok: true }; // nada a fazer, evita histórico ruidoso
    }

    const cellUpdates = [{ row: rowIndex, col: statusManutCol + 1, value: novoStatus }];
    if (ultimaAlteracaoCol !== -1) {
      cellUpdates.push({ row: rowIndex, col: ultimaAlteracaoCol + 1, value: session.email });
    }
    sheetsApiBatchUpdateCells_(CONFIG.SHEETS.EQUIPAMENTOS, cellUpdates);

    registrarHistorico_(equipamentoId, 'statusManutencao', statusAntigo, novoStatus, session.email);
    registrarAuditoria_('atualizarStatusManutencao', session.email, { id: equipamentoId, novoStatus: novoStatus });

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function validarStatusEspecial_(camposAlterados, linhaAtual, headers) {
  if (!('status' in camposAlterados)) return;

  if (camposAlterados.status === 'Extraviado') {
    const anexoNoPayload = camposAlterados._anexoBoletim;
    const anexoColIdx = headers.indexOf('boletimOcorrenciaAnexoUrl');
    const anexoExistente = anexoColIdx !== -1 ? linhaAtual[anexoColIdx] : '';
    if (!anexoNoPayload && !anexoExistente) {
      throw new Error('Para o status "Extraviado", anexe o Boletim de Ocorrência.');
    }
  }

  const REGRAS_STATUS_ESPECIAL = {
    'Manutenção': 'numeroChamadoManutencao',
    'Extraviado': 'boletimOcorrencia',
    'Em verificação': 'justificativaVerificacao'
  };

  const novoStatus = camposAlterados['status'];
  const campoObrigatorio = REGRAS_STATUS_ESPECIAL[novoStatus];
  if (!campoObrigatorio) return;

  const valorNoPayload = camposAlterados[campoObrigatorio];
  const colIndex = headers.indexOf(campoObrigatorio);
  const valorExistente = colIndex !== -1 ? linhaAtual[colIndex] : '';
  const valorFinal = valorNoPayload !== undefined ? valorNoPayload : valorExistente;

  if (!valorFinal) {
    throw new Error('Para alterar o status para "' + novoStatus + '", o campo "' + campoObrigatorio + '" é obrigatório.');
  }
}

function findRowIndexById_(data, idCol, id) {
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) return i + 1;
  }
  return -1;
}

// ============================================================================
// LISTAS AUXILIARES (aba Listas, em SCE_Core) — categoria / marca / modelo
// ----------------------------------------------------------------------------
// Usado para popular os <select> de cadastro/edição de equipamento nos
// dashboards de Matriz e Técnico (e pode ser usado na Filial também, se
// quiser padronizar por lá futuramente).
// Estrutura esperada da aba: colunas "categoria" | "marca" | "modelo",
// cada uma podendo ter uma quantidade diferente de linhas preenchidas.
// ============================================================================

function getListasCadastro(token) {
  requireSession_(token);

  const data = sheetsApiGetValues_(CONFIG.SHEETS.LISTAS);
  if (!data || data.length < 2) return { categorias: [], marcas: [], modelos: [] };

  const headers = data[0];
  const colCategoria = headers.indexOf('categoria');
  const colMarca = headers.indexOf('marca');
  const colModelo = headers.indexOf('modelo');

  const categorias = [], marcas = [], modelos = [];
  data.slice(1).forEach(function (row) {
    if (colCategoria !== -1 && row[colCategoria]) categorias.push(row[colCategoria]);
    if (colMarca !== -1 && row[colMarca]) marcas.push(row[colMarca]);
    if (colModelo !== -1 && row[colModelo]) modelos.push(row[colModelo]);
  });

  function uniqOrdenado(arr) {
    return arr.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
  }

  return {
    categorias: uniqOrdenado(categorias),
    marcas: uniqOrdenado(marcas),
    modelos: uniqOrdenado(modelos)
  };
}

// ============================================================================
// HISTÓRICO (aba Historico_Itens, em SCE_Movimentacao)
// ============================================================================

function registrarHistorico_(equipamentoId, campo, valorAntigo, valorNovo, autor) {
  try {
    sheetsApiAppendRow_(CONFIG.SHEETS.HISTORICO, [equipamentoId, campo, valorAntigo, valorNovo, autor, new Date()]);
  } catch (e) {
    Logger.log('Erro ao registrar histórico: ' + e.message);
  }
}

function getHistoricoEquipamento(token, equipamentoId) {
  const session = requireSession_(token);

  if (session.nivel !== CONFIG.NIVEIS.MATRIZ) {
    const equipamentos = getAllEquipamentos_();
    const item = equipamentos.filter(function (e) { return e.id === equipamentoId; })[0];
    if (!item || !sessaoTemAcessoAUnidade_(session, item.unidade)) {
      throw new Error('Você não tem permissão para ver este histórico.');
    }
  }

  const data = sheetsApiGetValues_(CONFIG.SHEETS.HISTORICO);
  return data.slice(1)
    .filter(function (row) { return row[0] === equipamentoId; })
    .map(function (row) {
      return { equipamentoId: row[0], campo: row[1], valorAntigo: row[2], valorNovo: row[3], autor: row[4], data: row[5] };
    })
    .reverse();
}

// ============================================================================
// REGISTRO DE MANUTENÇÃO (aba Registros_Manutencao, em SCE_Movimentacao)
// ----------------------------------------------------------------------------
// Diferente do Historico_Itens (que registra "campo X mudou de Y para Z"
// automaticamente a cada edição), isto é um diário técnico em texto livre:
// o técnico (ou Filial/Matriz, se quiserem) registra o que foi feito numa
// visita/manutenção específica. Fica atrelado ao equipamento, mais recente
// primeiro, e não é editável depois de criado (só inserção).
//
// Cada entrada carrega também um "status" (Pendente/Em andamento/Concluído)
// que, ao ser registrado, sincroniza automaticamente a coluna
// "statusManutencao" do equipamento (ver atualizarStatusManutencao).
// ============================================================================

/**
 * Registra uma entrada de manutenção para um equipamento. Qualquer perfil
 * com acesso à unidade do equipamento pode registrar (Matriz, Filial da
 * própria unidade, Técnico vinculado à unidade).
 *
 * @param {string} token
 * @param {string} equipamentoId
 * @param {string} descricao texto livre (o que foi feito/observado)
 * @param {string} [status] Pendente | Em andamento | Concluído (default: Pendente)
 * @return {{ok:boolean, id:string}}
 */
function registrarManutencao(token, equipamentoId, descricao, status) {
  const session = requireSession_(token);

  descricao = String(descricao || '').trim();
  if (!descricao) throw new Error('Descreva o que foi feito antes de registrar.');
  status = STATUS_MANUTENCAO_VALIDOS_.indexOf(status) !== -1 ? status : CONFIG.STATUS_MANUTENCAO.PENDENTE;

  const equipamentos = getAllEquipamentos_();
  const item = equipamentos.filter(function (e) { return e.id === equipamentoId; })[0];
  if (!item) throw new Error('Equipamento não encontrado.');
  if (!sessaoTemAcessoAUnidade_(session, item.unidade)) {
    throw new Error('Você não tem permissão para registrar manutenção neste equipamento.');
  }

  ensureSheetExists_(CONFIG.SHEETS.REGISTROS_MANUTENCAO, REGISTROS_MANUTENCAO_HEADERS_);

  const id = Utilities.getUuid();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    sheetsApiAppendRow_(CONFIG.SHEETS.REGISTROS_MANUTENCAO, [id, equipamentoId, session.email, new Date(), descricao, status]);
  } finally {
    lock.releaseLock();
  }

  // Mantém a coluna statusManutencao do equipamento sincronizada com a
  // última entrada do diário. Não deve derrubar o registro principal se
  // a coluna ainda não existir na planilha — só loga o aviso.
  try {
    atualizarStatusManutencao(token, equipamentoId, status);
  } catch (e) {
    Logger.log('Aviso ao sincronizar statusManutencao: ' + e.message);
  }

  registrarAuditoria_('registrarManutencao', session.email, { equipamentoId: equipamentoId, registroId: id, status: status });

  return { ok: true, id: id };
}

/**
 * Retorna o diário de manutenção de um equipamento, mais recente primeiro.
 * Mesma regra de acesso de registrarManutencao.
 *
 * @param {string} token
 * @param {string} equipamentoId
 * @return {Array<Object>}
 */
function getRegistrosManutencao(token, equipamentoId) {
  try {
    const session = requireSession_(token);

    const equipamentos = getAllEquipamentos_();
    const item = equipamentos.filter(function (e) { return e.id === equipamentoId; })[0];
    if (!item || !sessaoTemAcessoAUnidade_(session, item.unidade)) {
      throw new Error('Você não tem permissão para ver os registros deste equipamento.');
    }

    ensureSheetExists_(CONFIG.SHEETS.REGISTROS_MANUTENCAO, REGISTROS_MANUTENCAO_HEADERS_);
    const data = sheetsApiGetValues_(CONFIG.SHEETS.REGISTROS_MANUTENCAO);
    if (!data || data.length === 0) return [];

    return data.slice(1)
      .filter(function (row) { return row[1] === equipamentoId; })
      .map(function (row) {
        return { id: row[0], equipamentoId: row[1], autor: row[2], data: row[3], descricao: row[4], status: row[5] };
      })
      .reverse();
  } catch (e) {
    Logger.log('Erro em getRegistrosManutencao: ' + e.message);
    return [];
  }
}

// ============================================================================
// EMPRÉSTIMOS / DEVOLUÇÕES (aba Emprestimos, em SCE_Movimentacao)
// ============================================================================

function registrarEmprestimo(token, equipamentoIds, dadosEmprestimo) {
  const session = requireSession_(token);
  equipamentoIds = Array.isArray(equipamentoIds) ? equipamentoIds : [equipamentoIds];
  equipamentoIds = equipamentoIds.filter(function (id) { return !!id; });
  if (equipamentoIds.length === 0) throw new Error('Nenhum equipamento informado.');

  dadosEmprestimo = dadosEmprestimo || {};
  if (!dadosEmprestimo.responsavel) throw new Error('Responsavel e obrigatorio.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureSheetExists_(CONFIG.SHEETS.EMPRESTIMOS, EMPRESTIMOS_HEADERS_);

    const eqData = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    const headers = eqData[0];
    const idCol = headers.indexOf('id');
    const unidadeCol = headers.indexOf('unidade');
    const statusCol = headers.indexOf('status');
    const responsavelCol = headers.indexOf('responsavelAtual');
    const dataAtribCol = headers.indexOf('dataAtribuicao');
    const atualizadoCol = headers.indexOf('dataUltimaAtualizacao');

    const itens = equipamentoIds.map(function (id) {
      const rowIndex = findRowIndexById_(eqData, idCol, id);
      if (rowIndex === -1) throw new Error('Equipamento nao encontrado: ' + id);
      const row = eqData[rowIndex - 1];
      if (!sessaoTemAcessoAUnidade_(session, row[unidadeCol])) {
        throw new Error('Voce nao tem permissao para emprestar o equipamento ' + id + '.');
      }
      if (row[statusCol] === 'Removido') throw new Error('Equipamento removido nao pode ser emprestado.');
      if (row[statusCol] === 'Emprestado') throw new Error('Equipamento ja esta emprestado.');
      return { rowIndex: rowIndex, row: row, id: id };
    });

    const emprestimoId = Utilities.getUuid();
    const now = new Date();
    const termo = gerarTermoEmprestimoPdf_(emprestimoId, itens, headers, dadosEmprestimo);

    // Uma chamada de batchUpdate por item (status/responsavel/dataAtribuicao/
    // dataUltimaAtualizacao), em vez de 4 chamadas separadas por item.
    itens.forEach(function (item) {
      sheetsApiAppendRow_(CONFIG.SHEETS.EMPRESTIMOS, [
        emprestimoId, item.id, valueByHeader_(item.row, headers, 'patrimonio'),
        valueByHeader_(item.row, headers, 'unidade'), dadosEmprestimo.responsavel || '',
        dadosEmprestimo.cpf || '', dadosEmprestimo.emailResponsavel || '', now,
        dadosEmprestimo.dataPrevistaDevolucao || '', '', 'Aberto', termo.url || '',
        session.email, '', dadosEmprestimo.observacoes || ''
      ]);

      const cellUpdates = [];
      if (statusCol !== -1) cellUpdates.push({ row: item.rowIndex, col: statusCol + 1, value: 'Emprestado' });
      if (responsavelCol !== -1) cellUpdates.push({ row: item.rowIndex, col: responsavelCol + 1, value: dadosEmprestimo.responsavel || '' });
      if (dataAtribCol !== -1) cellUpdates.push({ row: item.rowIndex, col: dataAtribCol + 1, value: now });
      if (atualizadoCol !== -1) cellUpdates.push({ row: item.rowIndex, col: atualizadoCol + 1, value: now });
      sheetsApiBatchUpdateCells_(CONFIG.SHEETS.EQUIPAMENTOS, cellUpdates);

      registrarHistorico_(item.id, 'status', valueByHeader_(item.row, headers, 'status'), 'Emprestado', session.email);
    });

    registrarAuditoria_('registrarEmprestimo', session.email, { emprestimoId: emprestimoId, itens: equipamentoIds });

    if (dadosEmprestimo.emailResponsavel && termo.blob) {
      MailApp.sendEmail({
        to: dadosEmprestimo.emailResponsavel,
        subject: 'SCE - Termo de emprestimo',
        body: 'Segue em anexo o termo de emprestimo dos equipamentos.',
        attachments: [termo.blob]
      });
    }

    return { ok: true, id: emprestimoId, termoUrl: termo.url, message: 'Emprestimo registrado.' };
  } finally {
    lock.releaseLock();
  }
}

function registrarDevolucao(token, equipamentoIds, observacoes) {
  const session = requireSession_(token);
  equipamentoIds = Array.isArray(equipamentoIds) ? equipamentoIds : [equipamentoIds];
  equipamentoIds = equipamentoIds.filter(function (id) { return !!id; });
  if (equipamentoIds.length === 0) throw new Error('Nenhum equipamento informado.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureSheetExists_(CONFIG.SHEETS.EMPRESTIMOS, EMPRESTIMOS_HEADERS_);

    const eqData = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    const headers = eqData[0];
    const idCol = headers.indexOf('id');
    const unidadeCol = headers.indexOf('unidade');
    const statusCol = headers.indexOf('status');
    const responsavelCol = headers.indexOf('responsavelAtual');
    const dataAtribCol = headers.indexOf('dataAtribuicao');
    const atualizadoCol = headers.indexOf('dataUltimaAtualizacao');
    const now = new Date();

    equipamentoIds.forEach(function (id) {
      const rowIndex = findRowIndexById_(eqData, idCol, id);
      if (rowIndex === -1) throw new Error('Equipamento nao encontrado: ' + id);
      const row = eqData[rowIndex - 1];
      if (!sessaoTemAcessoAUnidade_(session, row[unidadeCol])) {
        throw new Error('Voce nao tem permissao para devolver o equipamento ' + id + '.');
      }

      const cellUpdates = [];
      if (statusCol !== -1) cellUpdates.push({ row: rowIndex, col: statusCol + 1, value: 'Disponivel' });
      if (responsavelCol !== -1) cellUpdates.push({ row: rowIndex, col: responsavelCol + 1, value: '' });
      if (dataAtribCol !== -1) cellUpdates.push({ row: rowIndex, col: dataAtribCol + 1, value: '' });
      if (atualizadoCol !== -1) cellUpdates.push({ row: rowIndex, col: atualizadoCol + 1, value: now });
      sheetsApiBatchUpdateCells_(CONFIG.SHEETS.EQUIPAMENTOS, cellUpdates);

      registrarHistorico_(id, 'status', valueByHeader_(row, headers, 'status'), 'Disponivel', session.email);
      fecharEmprestimoAberto_(id, session.email, now, observacoes || '');
    });

    registrarAuditoria_('registrarDevolucao', session.email, { itens: equipamentoIds });

    return { ok: true, message: 'Devolucao registrada.' };
  } finally {
    lock.releaseLock();
  }
}

function fecharEmprestimoAberto_(equipamentoId, devolvidoPor, dataDevolucao, observacoes) {
  ensureSheetExists_(CONFIG.SHEETS.EMPRESTIMOS, EMPRESTIMOS_HEADERS_);
  const data = sheetsApiGetValues_(CONFIG.SHEETS.EMPRESTIMOS);
  const headers = data[0];
  const equipamentoCol = headers.indexOf('equipamentoId');
  const statusCol = headers.indexOf('status');
  const dataDevCol = headers.indexOf('dataDevolucao');
  const devolvidoPorCol = headers.indexOf('devolvidoPor');
  const obsCol = headers.indexOf('observacoes');

  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][equipamentoCol] === equipamentoId && data[i][statusCol] === 'Aberto') {
      const rowIndex = i + 1;
      const cellUpdates = [{ row: rowIndex, col: statusCol + 1, value: 'Devolvido' }];
      if (dataDevCol !== -1) cellUpdates.push({ row: rowIndex, col: dataDevCol + 1, value: dataDevolucao });
      if (devolvidoPorCol !== -1) cellUpdates.push({ row: rowIndex, col: devolvidoPorCol + 1, value: devolvidoPor });
      if (obsCol !== -1 && observacoes) cellUpdates.push({ row: rowIndex, col: obsCol + 1, value: observacoes });
      sheetsApiBatchUpdateCells_(CONFIG.SHEETS.EMPRESTIMOS, cellUpdates);
      return;
    }
  }
}

// ============================================================================
// EXPORTAÇÃO (CSV / PDF) — usa getEquipamentosGlobal, já migrado
// ============================================================================

function exportarCSV(token) {
  const session = requireSession_(token, CONFIG.NIVEIS.MATRIZ);
  const equipamentos = getEquipamentosGlobal(token, false);
  if (!equipamentos || equipamentos.length === 0) {
    return { ok: false, message: 'Nenhum equipamento para exportar.' };
  }

  const headers = Object.keys(equipamentos[0]).filter(function (h) { return h !== '_rowIndex'; });
  const linhas = [headers.join(',')];
  equipamentos.forEach(function (item) {
    linhas.push(headers.map(function (h) {
      const v = item[h] === undefined || item[h] === null ? '' : String(item[h]);
      return '"' + v.replace(/"/g, '""') + '"';
    }).join(','));
  });

  const bom = '\uFEFF'; // BOM UTF-8 para compatibilidade com Excel
  const csvContent = bom + linhas.join('\r\n');
  const blob = Utilities.newBlob(csvContent, 'text/csv', 'sce-equipamentos.csv');
  registrarAuditoria_('exportarCSV', session.email, { total: equipamentos.length });
  return { ok: true, base64: Utilities.base64Encode(blob.getBytes()), fileName: 'sce-equipamentos.csv' };
}

function getResumoEquipamentos(token) {
  const equipamentos = getEquipamentosDaFilial(token);
  const resumo = { total: equipamentos.length, porStatus: {} };
  equipamentos.forEach(function (item) {
    const status = item.status || 'Sem status';
    resumo.porStatus[status] = (resumo.porStatus[status] || 0) + 1;
  });
  return resumo;
}

function exportarEquipamentosPDF(token, filtros) {
  const session = requireSession_(token, CONFIG.NIVEIS.MATRIZ);
  const equipamentos = filtrarEquipamentosParaExport_(getEquipamentosGlobal(token, false), filtros || {});
  const html = '<h2>SCE - Relatorio de equipamentos</h2>' +
    '<p>Gerado por ' + escapeHtml_(session.email) + ' em ' + new Date().toLocaleString() + '</p>' +
    montarTabelaHtmlEquipamentos_(equipamentos);
  const blob = HtmlService.createHtmlOutput(html).getBlob().setName('sce-equipamentos.pdf').getAs(MimeType.PDF);
  const file = salvarBlobPdf_(blob, 'sce-equipamentos-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') + '.pdf');
  registrarAuditoria_('exportarEquipamentosPDF', session.email, { total: equipamentos.length });
  return { ok: true, url: file.getUrl(), name: file.getName() };
}

function gerarTermoEmprestimoPdf_(emprestimoId, itens, headers, dados) {
  const rows = itens.map(function (item) {
    return '<tr><td>' + escapeHtml_(valueByHeader_(item.row, headers, 'patrimonio')) + '</td>' +
      '<td>' + escapeHtml_(valueByHeader_(item.row, headers, 'categoria')) + '</td>' +
      '<td>' + escapeHtml_(valueByHeader_(item.row, headers, 'marca')) + '</td>' +
      '<td>' + escapeHtml_(valueByHeader_(item.row, headers, 'modelo')) + '</td>' +
      '<td>' + escapeHtml_(valueByHeader_(item.row, headers, 'numeroSerie')) + '</td></tr>';
  }).join('');
  const html =
    '<h2>Termo de emprestimo de equipamentos</h2>' +
    '<p><strong>ID:</strong> ' + escapeHtml_(emprestimoId) + '</p>' +
    '<p><strong>Responsavel:</strong> ' + escapeHtml_(dados.responsavel || '') + '</p>' +
    '<p><strong>CPF:</strong> ' + escapeHtml_(dados.cpf || '') + '</p>' +
    '<p><strong>E-mail:</strong> ' + escapeHtml_(dados.emailResponsavel || '') + '</p>' +
    '<p><strong>Data:</strong> ' + new Date().toLocaleString() + '</p>' +
    '<table border="1" cellspacing="0" cellpadding="6"><thead><tr><th>Patrimonio</th><th>Categoria</th><th>Marca</th><th>Modelo</th><th>Serie</th></tr></thead><tbody>' +
    rows + '</tbody></table>' +
    '<p style="margin-top:32px;">Declaro ter recebido os equipamentos acima e me responsabilizo por sua guarda e devolucao.</p>' +
    '<p style="margin-top:64px;">____________________________________<br>Assinatura do responsavel</p>';
  const blob = HtmlService.createHtmlOutput(html).getBlob().setName('termo-emprestimo.pdf').getAs(MimeType.PDF);
  const file = salvarBlobPdf_(blob, 'termo-emprestimo-' + emprestimoId + '.pdf');
  return { blob: blob, url: file.getUrl() };
}

function filtrarEquipamentosParaExport_(equipamentos, filtros) {
  const busca = String(filtros.busca || '').toLowerCase();
  return equipamentos.filter(function (item) {
    if (filtros.status && item.status !== filtros.status) return false;
    if (filtros.categoria && item.categoria !== filtros.categoria) return false;
    if (filtros.marca && item.marca !== filtros.marca) return false;
    if (filtros.unidade && item.unidade !== filtros.unidade) return false;
    if (!busca) return true;
    return [item.patrimonio, item.numeroSerie, item.modelo].join(' ').toLowerCase().indexOf(busca) !== -1;
  });
}

function montarTabelaHtmlEquipamentos_(equipamentos) {
  const rows = equipamentos.map(function (item) {
    return '<tr><td>' + escapeHtml_(item.unidade) + '</td><td>' + escapeHtml_(item.categoria) +
      '</td><td>' + escapeHtml_(item.marca) + '</td><td>' + escapeHtml_(item.modelo) +
      '</td><td>' + escapeHtml_(item.patrimonio) + '</td><td>' + escapeHtml_(item.status) +
      '</td><td>' + escapeHtml_(item.statusManutencao) + '</td><td>' + escapeHtml_(item.ultimaAlteracaoPor) + '</td></tr>';
  }).join('');
  return '<table border="1" cellspacing="0" cellpadding="5"><thead><tr><th>Unidade</th><th>Categoria</th><th>Marca</th><th>Modelo</th><th>Patrimonio</th><th>Status</th><th>Status manutenção</th><th>Última alteração por</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

// ============================================================================
// GESTÃO DE USUÁRIOS (aba Usuarios, em SCE_Autenticacao — restrito à Matriz)
// ============================================================================

function listarUsuarios(token) {
  requireSession_(token, CONFIG.NIVEIS.MATRIZ);
  const data = sheetsApiGetValues_(CONFIG.SHEETS.USUARIOS);
  if (!data || data.length === 0) return [];
  const headers = data[0];
  return data.slice(1).map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function adicionarUsuario(token, novoUsuario) {
  const session = requireSession_(token, CONFIG.NIVEIS.MATRIZ);

  const email = String(novoUsuario.email || '').trim().toLowerCase();
  if (!email) throw new Error('E-mail é obrigatório.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (findUsuarioByEmail_(email)) {
      throw new Error('Já existe um usuário com este e-mail.');
    }
    sheetsApiAppendRow_(CONFIG.SHEETS.USUARIOS, [
      email, novoUsuario.nome || '', novoUsuario.nivel || CONFIG.NIVEIS.FILIAL,
      novoUsuario.filial || '', CONFIG.STATUS_USUARIO.ATIVO, ''
    ]);
  } finally {
    lock.releaseLock();
  }

  registrarAuditoria_('adicionarUsuario', session.email, { email: email });
  return { ok: true, message: 'Usuário adicionado.' };
}

/**
 * Atualiza dados de um usuário existente. Restrito à Matriz. Faz checagem
 * de colisão de e-mail se o e-mail estiver sendo alterado.
 */
function atualizarUsuario(token, emailAtual, dadosAtualizados) {
  const session = requireSession_(token, CONFIG.NIVEIS.MATRIZ);
  emailAtual = String(emailAtual || '').trim().toLowerCase();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const usuario = findUsuarioByEmail_(emailAtual);
    if (!usuario) throw new Error('Usuário não encontrado.');

    const novoEmail = dadosAtualizados.email
      ? String(dadosAtualizados.email).trim().toLowerCase()
      : emailAtual;

    if (novoEmail !== emailAtual) {
      const colisao = findUsuarioByEmail_(novoEmail);
      if (colisao) throw new Error('Já existe outro usuário com este e-mail.');
    }

    const cellUpdates = [
      { row: usuario.rowIndex, col: 1, value: novoEmail },
      { row: usuario.rowIndex, col: 2, value: dadosAtualizados.nome !== undefined ? dadosAtualizados.nome : usuario.nome },
      { row: usuario.rowIndex, col: 3, value: dadosAtualizados.nivel !== undefined ? dadosAtualizados.nivel : usuario.nivel },
      { row: usuario.rowIndex, col: 4, value: dadosAtualizados.filial !== undefined ? dadosAtualizados.filial : usuario.filial }
    ];
    sheetsApiBatchUpdateCells_(CONFIG.SHEETS.USUARIOS, cellUpdates);
  } finally {
    lock.releaseLock();
  }

  registrarAuditoria_('atualizarUsuario', session.email, { emailAtual: emailAtual, dados: dadosAtualizados });
  return { ok: true, message: 'Usuário atualizado.' };
}

function removerUsuario(token, emailParaRemover) {
  const session = requireSession_(token, CONFIG.NIVEIS.MATRIZ);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const usuario = findUsuarioByEmail_(String(emailParaRemover).trim().toLowerCase());
    if (!usuario) throw new Error('Usuário não encontrado.');

    sheetsApiBatchUpdateCells_(CONFIG.SHEETS.USUARIOS, [
      { row: usuario.rowIndex, col: 5, value: CONFIG.STATUS_USUARIO.REMOVIDO },
      { row: usuario.rowIndex, col: 6, value: new Date() }
    ]);
  } finally {
    lock.releaseLock();
  }

  registrarAuditoria_('removerUsuario', session.email, { email: emailParaRemover });
  return { ok: true, message: 'Usuário removido (soft-delete).' };
}

// ============================================================================
// UTILITÁRIOS GERAIS
// ============================================================================

function salvarBlobPdf_(blob, name) {
  blob = blob.setName(name);
  if (CONFIG.PDF_FOLDER_ID) {
    return DriveApp.getFolderById(CONFIG.PDF_FOLDER_ID).createFile(blob);
  }
  return DriveApp.createFile(blob);
}

function valueByHeader_(row, headers, header) {
  const idx = headers.indexOf(header);
  return idx === -1 ? '' : row[idx];
}

function setIfHeaderExists_(row, headers, header, value) {
  const idx = headers.indexOf(header);
  if (idx !== -1) row[idx] = value;
}

function escapeHtml_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}