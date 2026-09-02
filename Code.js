/**
 * ============================================================================
 * SCE - Sistema de Controle de Equipamentos
 * Code.gs — núcleo do servidor: roteamento, autenticação e acesso a dados
 * ============================================================================
 */

// ============================================================================
// CONFIGURAÇÃO GLOBAL
// ============================================================================

const CONFIG = {
  SPREADSHEETS: {
    CORE: "12_mPXKeEZJMpj2ZEpzI3HOYwqShJWDjD7787elXVxXk",
    MOVIMENTACAO: "1BhGd2zUMkD1u1NfgzPO3xJx8s_8oLt22X3VX9jvwA6A",
    AUTENTICACAO: "1Put-0wIVN-60oP5EaunbSCwbDhzCo2yLxJ_FV26auy0",
  },
  SHEETS: {
    EQUIPAMENTOS: "Equipamentos",
    LISTAS: "Listas",
    FILIAIS: "Filiais",
    HISTORICO: "Historico_Itens",
    EMPRESTIMOS: "Emprestimos",
    AUDITORIA: "Auditoria",
    REGISTROS_MANUTENCAO: "Registros_Manutencao",
    USUARIOS: "Usuarios",
    SESSOES: "Sessoes",
    OTP: "Otp_Codes",
  },
  PDF_FOLDER_ID: "1P03gJm7JJ3ZIJnhBvRyhwghZEOI_pce_",
  BO_FOLDER_ID: "1wuBUvgsfP7GorZ9-7J_6la-U0BPpj8SY",
  SESSION_DURATION_MS: 24 * 60 * 60 * 1000,
  OTP_EXPIRATION_MS: 10 * 60 * 1000,
  NIVEIS: {
    MATRIZ: "Matriz",
    ADMIN_FILIAL: "AdminFilial",
    FILIAL: "Filial",
    TECNICO: "Tecnico",
  },
  STATUS_USUARIO: {
    ATIVO: "Ativo",
    REMOVIDO: "Removido",
  },
  STATUS_MANUTENCAO: {
    PENDENTE: "Pendente",
    EM_ANDAMENTO: "Em andamento",
    CONCLUIDO: "Concluído",
  },
};

const STATUS_MANUTENCAO_VALIDOS_ = [
  CONFIG.STATUS_MANUTENCAO.PENDENTE,
  CONFIG.STATUS_MANUTENCAO.EM_ANDAMENTO,
  CONFIG.STATUS_MANUTENCAO.CONCLUIDO,
];

// ============================================================================
// MAPEAMENTO DE ABAS PARA PLANILHAS
// ============================================================================

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
  if (!id)
    throw new Error('Nenhuma planilha mapeada para a aba "' + sheetName + '".');
  if (id.indexOf("COLOQUE_AQUI") === 0)
    throw new Error(
      "CONFIG.SPREADSHEETS não foi preenchido com IDs reais ainda.",
    );
  return id;
}

function getCoreSheetId_() {
  return CONFIG.SPREADSHEETS.CORE;
}
function getMovimentacaoSheetId_() {
  return CONFIG.SPREADSHEETS.MOVIMENTACAO;
}
function getAutenticacaoSheetId_() {
  return CONFIG.SPREADSHEETS.AUTENTICACAO;
}

// ============================================================================
// CAMADA DE ACESSO — SHEETS API
// ============================================================================

function sheetsApiGetValues_(sheetName) {
  const spreadsheetId = getSpreadsheetIdFor_(sheetName);
  try {
    const resp = Sheets.Spreadsheets.Values.get(spreadsheetId, sheetName);
    return resp.values || [];
  } catch (e) {
    throw new Error(
      'Erro ao ler aba "' + sheetName + '" via Sheets API: ' + e.message,
    );
  }
}

function sheetsApiBatchGetValues_(sheetNames) {
  const porPlanilha = {};
  sheetNames.forEach(function (nome) {
    const id = getSpreadsheetIdFor_(nome);
    if (!porPlanilha[id]) porPlanilha[id] = [];
    porPlanilha[id].push(nome);
  });
  const resultado = {};
  Object.keys(porPlanilha).forEach(function (spreadsheetId) {
    const ranges = porPlanilha[spreadsheetId];
    const resp = Sheets.Spreadsheets.Values.batchGet(spreadsheetId, {
      ranges: ranges,
    });
    (resp.valueRanges || []).forEach(function (vr, idx) {
      resultado[ranges[idx]] = vr.values || [];
    });
  });
  return resultado;
}

function sheetsApiAppendRow_(sheetName, rowValues) {
  const spreadsheetId = getSpreadsheetIdFor_(sheetName);
  const resource = { values: [rowValues] };
  Sheets.Spreadsheets.Values.append(resource, spreadsheetId, sheetName, {
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
  });
}

function columnToLetter_(col) {
  let letra = "";
  while (col > 0) {
    const resto = (col - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    col = Math.floor((col - 1) / 26);
  }
  return letra;
}

function sheetsApiUpdateCell_(sheetName, row, col, value) {
  sheetsApiBatchUpdateCells_(sheetName, [{ row: row, col: col, value: value }]);
}

function sheetsApiBatchUpdateCells_(sheetName, cellUpdates) {
  if (!cellUpdates || cellUpdates.length === 0) return;
  const spreadsheetId = getSpreadsheetIdFor_(sheetName);
  const data = cellUpdates.map(function (u) {
    return {
      range: sheetName + "!" + columnToLetter_(u.col) + u.row,
      values: [[u.value === undefined || u.value === null ? "" : u.value]],
    };
  });
  Sheets.Spreadsheets.Values.batchUpdate(
    { valueInputOption: "USER_ENTERED", data: data },
    spreadsheetId,
  );
}

const _sheetIdCache_ = {};

function getNumericSheetId_(sheetName) {
  if (_sheetIdCache_[sheetName] !== undefined) return _sheetIdCache_[sheetName];
  const spreadsheetId = getSpreadsheetIdFor_(sheetName);
  const meta = Sheets.Spreadsheets.get(spreadsheetId, {
    fields: "sheets(properties(sheetId,title))",
  });
  const encontrada = (meta.sheets || []).filter(function (s) {
    return s.properties.title === sheetName;
  })[0];
  if (!encontrada)
    throw new Error('Aba "' + sheetName + '" não encontrada na planilha.');
  _sheetIdCache_[sheetName] = encontrada.properties.sheetId;
  return encontrada.properties.sheetId;
}

function sheetsApiDeleteRow_(sheetName, rowIndex1Based) {
  const spreadsheetId = getSpreadsheetIdFor_(sheetName);
  const sheetId = getNumericSheetId_(sheetName);
  Sheets.Spreadsheets.batchUpdate(
    {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: "ROWS",
              startIndex: rowIndex1Based - 1,
              endIndex: rowIndex1Based,
            },
          },
        },
      ],
    },
    spreadsheetId,
  );
}

function ensureSheetExists_(sheetName, headers) {
  const spreadsheetId = getSpreadsheetIdFor_(sheetName);
  const meta = Sheets.Spreadsheets.get(spreadsheetId, {
    fields: "sheets(properties(title))",
  });
  const existe = (meta.sheets || []).some(function (s) {
    return s.properties.title === sheetName;
  });
  if (!existe) {
    Sheets.Spreadsheets.batchUpdate(
      { requests: [{ addSheet: { properties: { title: sheetName } } }] },
      spreadsheetId,
    );
    sheetsApiAppendRow_(sheetName, headers);
    delete _sheetIdCache_[sheetName];
  }
}

// ============================================================================
// AUDITORIA / CABEÇALHOS
// ============================================================================

const EMPRESTIMOS_HEADERS_ = [
  "id",
  "equipamentoId",
  "patrimonio",
  "unidade",
  "responsavel",
  "cpf",
  "emailResponsavel",
  "dataEmprestimo",
  "dataPrevistaDevolucao",
  "dataDevolucao",
  "status",
  "termoPdfUrl",
  "criadoPor",
  "devolvidoPor",
  "observacoes",
  "tipoEmprestimo",
  "escolaDestino",
];

const AUDITORIA_HEADERS_ = ["data", "usuario", "acao", "detalhes"];
const REGISTROS_MANUTENCAO_HEADERS_ = [
  "id",
  "equipamentoId",
  "autor",
  "data",
  "descricao",
  "status",
];

// ============================================================================
// SUPORTE A MULTI-UNIDADE (Técnico)
// ============================================================================

function parseFiliais_(filialRaw) {
  return String(filialRaw || "")
    .split(",")
    .map(function (f) {
      return f.trim();
    })
    .filter(function (f) {
      return f.length > 0;
    });
}

function sessaoTemAcessoAUnidade_(session, unidade) {
  if (session.nivel === CONFIG.NIVEIS.MATRIZ) return true;
  if (session.nivel === CONFIG.NIVEIS.ADMIN_FILIAL) {
    return (
      String(unidade).trim().toUpperCase() ===
      String(session.filial).trim().toUpperCase()
    );
  }
  if (session.nivel === CONFIG.NIVEIS.TECNICO) {
    const unidadeNormalizada = String(unidade || "")
      .trim()
      .toUpperCase();
    const unidadesDaSessao = parseFiliais_(session.filial).map(function (f) {
      return f.toUpperCase();
    });
    return unidadesDaSessao.indexOf(unidadeNormalizada) !== -1;
  }
  return (
    String(unidade).trim().toUpperCase() ===
    String(session.filial).trim().toUpperCase()
  );
}

function resolverUnidadeParaEscrita_(session, unidadeInformada) {
  if (session.nivel === CONFIG.NIVEIS.MATRIZ) {
    return unidadeInformada || session.filial;
  }
  if (session.nivel === CONFIG.NIVEIS.ADMIN_FILIAL) {
    if (
      unidadeInformada &&
      unidadeInformada.trim().toUpperCase() !==
        session.filial.trim().toUpperCase()
    ) {
      throw new Error(
        "Você só pode cadastrar equipamentos na sua própria unidade.",
      );
    }
    return session.filial;
  }
  if (session.nivel === CONFIG.NIVEIS.TECNICO) {
    const unidadesTecnico = parseFiliais_(session.filial);
    if (unidadeInformada) {
      if (!sessaoTemAcessoAUnidade_(session, unidadeInformada)) {
        throw new Error(
          'Você não atende a unidade "' + unidadeInformada + '".',
        );
      }
      return unidadeInformada;
    }
    if (unidadesTecnico.length === 1) return unidadesTecnico[0];
    throw new Error(
      "Informe para qual unidade este equipamento deve ser cadastrado.",
    );
  }
  return session.filial;
}

function registrarAuditoria_(acao, usuarioEmail, detalhes) {
  try {
    ensureSheetExists_(CONFIG.SHEETS.AUDITORIA, AUDITORIA_HEADERS_);
    const detalhesStr =
      typeof detalhes === "string" ? detalhes : JSON.stringify(detalhes || {});
    sheetsApiAppendRow_(CONFIG.SHEETS.AUDITORIA, [
      new Date(),
      usuarioEmail || "",
      acao,
      detalhesStr,
    ]);
  } catch (e) {
    Logger.log("Falha ao registrar auditoria (" + acao + "): " + e.message);
  }
}

// ============================================================================
// FUNÇÕES DE DIAGNÓSTICO
// ============================================================================

function testarEmail() {
  try {
    MailApp.sendEmail(
      "es.pablo.sousa@servidor.educacao.sp.gov.br",
      "Teste",
      "Funcionou!",
    );
    console.log("E-mail enviado com sucesso.");
  } catch (err) {
    console.error("Erro no teste de e-mail:", err.message);
  }
}

function testarPlanilhaUI() {
  try {
    const data = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    return {
      ok: true,
      totalLinhas: data.length,
      cabecalho: data[0] || [],
      primeiraLinha: data[1] || null,
    };
  } catch (err) {
    return { ok: false, motivo: "Erro ao ler planilha: " + err.message };
  }
}

function testarLeituraEquipamentos() {
  try {
    const todos = getAllEquipamentos_();
    return {
      total: todos.length,
      primeiros: todos.slice(0, 3),
      colunas: todos.length > 0 ? Object.keys(todos[0]) : [],
    };
  } catch (e) {
    return { erro: e.message };
  }
}

function testDriveAccess() {
  try {
    var folder = DriveApp.getFolderById(CONFIG.BO_FOLDER_ID);
    Logger.log("Pasta BO encontrada: " + folder.getName());
  } catch (e) {
    Logger.log("Erro ao acessar BO_FOLDER_ID: " + e.message);
  }
  try {
    var folder2 = DriveApp.getFolderById(CONFIG.PDF_FOLDER_ID);
    Logger.log("Pasta PDF encontrada: " + folder2.getName());
  } catch (e) {
    Logger.log("Erro ao acessar PDF_FOLDER_ID: " + e.message);
  }
}

// ============================================================================
// doGet — PONTO ÚNICO DE ROTEAMENTO
// ============================================================================

function doGet(e) {
  try {
    cleanupExpiredSessions_();

    const params = e && e.parameter ? e.parameter : {};

    // TEST PAGE: ?paginaTeste=Matriz|AdminFilial|Filial|Tecnico
    const paginaTeste = params.paginaTeste;
    if (paginaTeste) {
      return handleTestPage_(paginaTeste, params);
    }

    // DEV MODE: Create mock session from URL params (?dev=1&profile=Matriz&filial=X&email=Y)
    const isDev = params.dev === '1';

    let session = null;
    if (isDev && params.profile) {
      session = createDevSession_(params);
      // Store token for subsequent requests
      const token = session.token;
      const baseUrl = ScriptApp.getService().getUrl();
      const redirectUrl = baseUrl + '?token=' + encodeURIComponent(token);
      return HtmlService.createHtmlOutput(
        '<script>top.location.href = "' + redirectUrl + '";</script>'
      ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    const token = params.token || null;
    session = token ? validateSession_(token) : null;

    if (!session) {
      return renderTemplate_("Login");
    }

    if (session.nivel === CONFIG.NIVEIS.MATRIZ) {
      return renderTemplate_("DashboardMatriz", { session: session });
    }

    if (session.nivel === CONFIG.NIVEIS.TECNICO) {
      return renderTemplate_("DashboardTecnico", { session: session });
    }

    return renderTemplate_("DashboardFilial", { session: session });
  } catch (err) {
    console.error("ERRO em doGet:", err);
    return HtmlService.createHtmlOutput(
      '<h2 style="color:red;">ERRO NO SERVIDOR</h2>' +
        "<p><strong>Mensagem:</strong> " +
        escapeHtml_(err.message) +
        "</p>" +
        "<p><strong>Stack:</strong></p><pre>" +
        escapeHtml_(err.stack || "") +
        "</pre>",
    );
  }
}

function handleTestPage_(perfil, params) {
  try {
    const perfisValidos = {
      'Matriz': CONFIG.NIVEIS.MATRIZ,
      'AdminFilial': CONFIG.NIVEIS.ADMIN_FILIAL,
      'Filial': CONFIG.NIVEIS.FILIAL,
      'Tecnico': CONFIG.NIVEIS.TECNICO
    };

    const nivel = perfisValidos[perfil];
    if (!nivel) {
      return HtmlService.createHtmlOutput(
        '<h2 style="color:red;">PERFIL INVÁLIDO</h2>' +
        '<p>Perfis válidos: Matriz, AdminFilial, Filial, Tecnico</p>' +
        '<p>Exemplo: <code>?paginaTeste=Matriz</code></p>'
      ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    const filial = params.filial || 'UNIDADE TESTE';
    const email = params.email || 'teste@' + perfil.toLowerCase() + '.local';

    const testSession = createTestSession_(nivel, filial, email, perfil);

    // Redirect to the same URL with the token parameter so dashboards can authenticate
    const baseUrl = ScriptApp.getService().getUrl();
    const redirectUrl = baseUrl + '?token=' + encodeURIComponent(testSession.token);
    return HtmlService.createHtmlOutput(
      '<script>top.location.href = "' + redirectUrl + '";</script>'
    ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    console.error("ERRO em handleTestPage_:", err);
    return HtmlService.createHtmlOutput(
      '<h2 style="color:red;">ERRO NA PÁGINA DE TESTE</h2>' +
        "<p><strong>Mensagem:</strong> " +
        escapeHtml_(err.message) +
        "</p>" +
        "<p><strong>Stack:</strong></p><pre>" +
        escapeHtml_(err.stack || "") +
        "</pre>",
    ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
}

function createTestSession_(nivel, filial, email, perfilLabel) {
  const token = 'TEST_' + Utilities.getUuid();
  const now = Date.now();

  // Ensure Sessoes sheet exists with headers
  ensureSheetExists_(CONFIG.SHEETS.SESSOES, ["token", "email", "nivel", "filial", "criadoEm", "expiraEm"]);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    sheetsApiAppendRow_(CONFIG.SHEETS.SESSOES, [
      token,
      email,
      nivel,
      filial,
      now,
      now + CONFIG.SESSION_DURATION_MS,
    ]);
    invalidateSessionCache_();
  } finally {
    lock.releaseLock();
  }

  return {
    token: token,
    email: email,
    nivel: nivel,
    filial: filial,
    isTest: true,
    perfilLabel: perfilLabel
  };
}

function createDevSession_(params) {
  const profile = params.profile;
  const filial = params.filial || 'UNIDADE TESTE';
  const email = params.email || 'dev@teste.local';

  const nivelMap = {
    'Matriz': CONFIG.NIVEIS.MATRIZ,
    'AdminFilial': CONFIG.NIVEIS.ADMIN_FILIAL,
    'Filial': CONFIG.NIVEIS.FILIAL,
    'Tecnico': CONFIG.NIVEIS.TECNICO
  };

  const token = Utilities.getUuid();
  const now = Date.now();

  // Ensure Sessoes sheet exists with headers
  ensureSheetExists_(CONFIG.SHEETS.SESSOES, ["token", "email", "nivel", "filial", "criadoEm", "expiraEm"]);

  // Create a session row in the Sessoes sheet
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    sheetsApiAppendRow_(CONFIG.SHEETS.SESSOES, [
      token,
      email,
      nivelMap[profile] || CONFIG.NIVEIS.FILIAL,
      filial,
      now,
      now + CONFIG.SESSION_DURATION_MS,
    ]);
    invalidateSessionCache_();
  } finally {
    lock.releaseLock();
  }

  return {
    token: token,
    email: email,
    nivel: nivelMap[profile] || CONFIG.NIVEIS.FILIAL,
    filial: filial,
  };
}

function renderTemplate_(fileName, vars) {
  try {
    const template = HtmlService.createTemplateFromFile(fileName);

    if (vars) {
      Object.keys(vars).forEach(function (key) {
        template[key] = vars[key];
      });
    }

    return template
      .evaluate()
      .setTitle("SCE - Sistema de Controle de Equipamentos")
      .addMetaTag("viewport", "width=device-width, initial-scale=1")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    throw new Error(
      'Erro ao renderizar o arquivo HTML "' +
        fileName +
        '": ' +
        err.message +
        "\n\nStack original:\n" +
        (err.stack || ""),
    );
  }
}

function include(fileName) {
  try {
    return HtmlService.createHtmlOutputFromFile(fileName).getContent();
  } catch (e) {
    return '<!-- Arquivo "' + fileName + '" não encontrado -->';
  }
}

// ============================================================================
// AUTENTICAÇÃO — OTP
// ============================================================================

function requestOtp(email) {
  try {
    email = String(email || "")
      .trim()
      .toLowerCase();
    if (!email) return { ok: false, message: "E-mail não informado." };

    const usuario = findUsuarioByEmail_(email);
    if (!usuario || usuario.status === CONFIG.STATUS_USUARIO.REMOVIDO) {
      return {
        ok: false,
        message: "Se este e-mail estiver cadastrado, um código será enviado.",
      };
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const now = Date.now();
    upsertOtpRow_(email, code, now, now + CONFIG.OTP_EXPIRATION_MS);

    const logoUrl = "https://i.ibb.co/3yBdJq67/IMG-9095.png";
    const htmlBody = `
      <div style="font-family: Arial, Helvetica, sans-serif; background-color:#f4f4f7; padding:24px;">
        <div style="max-width:480px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <div style="background-color:#0b3d91; padding:20px; text-align:center;">
            <img src="${logoUrl}" alt="URE Leste 3" style="max-height:60px;">
          </div>
          <div style="padding:32px 24px; text-align:center;">
            <h2 style="margin:0 0 8px; color:#222;">Código de acesso</h2>
            <p style="margin:0 0 24px; color:#555; font-size:14px;">Use o código abaixo para acessar o SCE (Sistema de Controle de Equipamentos):</p>
            <div style="display:inline-block; background:#f0f2f5; border-radius:6px; padding:16px 32px; margin-bottom:24px;">
              <span style="font-size:32px; font-weight:bold; letter-spacing:8px; color:#0b3d91;">${code}</span>
            </div>
            <p style="margin:0; color:#888; font-size:13px;">Este código expira em 10 minutos.</p>
            <p style="margin:16px 0 0; color:#aaa; font-size:12px;">Se você não solicitou este código, ignore este e-mail.</p>
          </div>
          <div style="background:#f4f4f7; padding:16px; text-align:center; font-size:11px; color:#999;">
            URE Leste 3 &middot; Diretoria de Ensino Região Leste 3
          </div>
        </div>
      </div>
    `;
    const plainBody =
      "Seu código de acesso ao SCE é: " +
      code +
      "\n\nEle expira em 10 minutos. Se você não solicitou este código, ignore este e-mail.";

    MailApp.sendEmail({
      to: email,
      subject: "URE Leste 3 - SCE - Código de acesso: " + code,
      body: plainBody,
      htmlBody: htmlBody,
    });
    return { ok: true, message: "Código enviado para " + email + "." };
  } catch (err) {
    console.error("Erro em requestOtp:", err.message);
    return { ok: false, message: "Erro interno: " + err.message };
  }
}

function validateOtp(email, code) {
  email = String(email || "")
    .trim()
    .toLowerCase();
  code = String(code || "").trim();

  const usuario = findUsuarioByEmail_(email);
  if (!usuario || usuario.status === CONFIG.STATUS_USUARIO.REMOVIDO) {
    return { ok: false, message: "Acesso não autorizado para este e-mail." };
  }

  const otpRow = findOtpRow_(email);
  if (!otpRow)
    return { ok: false, message: "Nenhum código pendente para este e-mail." };
  if (Date.now() > otpRow.expiraEm)
    return { ok: false, message: "Código expirado. Solicite um novo." };
  if (String(otpRow.code) !== code)
    return { ok: false, message: "Código incorreto." };

  deleteOtpRow_(otpRow.rowIndex);
  cleanupExpiredOtps_();
  const session = createSession_(usuario);
  const url =
    ScriptApp.getService().getUrl() +
    "?token=" +
    encodeURIComponent(session.token);
  registrarAuditoria_("login", email, { via: "otp" });
  return {
    ok: true,
    message: "Login realizado com sucesso.",
    redirectUrl: url,
  };
}

function cleanupExpiredOtps_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = sheetsApiGetValues_(CONFIG.SHEETS.OTP);
    if (data.length <= 1) return;
    const now = Date.now();
    const rowsToDelete = [];
    for (let i = data.length - 1; i >= 1; i--) {
      const expiraEm = Number(data[i][3]);
      if (isNaN(expiraEm) || now > expiraEm) {
        rowsToDelete.push(i + 1);
      }
    }
    for (const rowIndex of rowsToDelete.reverse()) {
      sheetsApiDeleteRow_(CONFIG.SHEETS.OTP, rowIndex);
    }
  } finally {
    lock.releaseLock();
  }
}

function upsertOtpRow_(email, code, criadoEm, expiraEm) {
  const data = sheetsApiGetValues_(CONFIG.SHEETS.OTP);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === email) {
      sheetsApiBatchUpdateCells_(CONFIG.SHEETS.OTP, [
        { row: i + 1, col: 1, value: email },
        { row: i + 1, col: 2, value: code },
        { row: i + 1, col: 3, value: criadoEm },
        { row: i + 1, col: 4, value: expiraEm },
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
      return {
        rowIndex: i + 1,
        email: data[i][0],
        code: data[i][1],
        criadoEm: data[i][2],
        expiraEm: data[i][3],
      };
    }
  }
  return null;
}

function deleteOtpRow_(rowIndex) {
  sheetsApiDeleteRow_(CONFIG.SHEETS.OTP, rowIndex);
}

// ============================================================================
// SESSÃO
// ============================================================================

const _sessionCache_ = { data: null, timestamp: 0 };
const SESSION_CACHE_TTL_MS = 30 * 1000;

function getSessoesData_() {
  const now = Date.now();
  if (_sessionCache_.data && (now - _sessionCache_.timestamp) < SESSION_CACHE_TTL_MS) {
    return _sessionCache_.data;
  }
  const data = sheetsApiGetValues_(CONFIG.SHEETS.SESSOES);
  _sessionCache_.data = data;
  _sessionCache_.timestamp = now;
  return data;
}

function invalidateSessionCache_() {
  _sessionCache_.data = null;
  _sessionCache_.timestamp = 0;
}

function createSession_(usuario) {
  const token = Utilities.getUuid();
  const now = Date.now();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    sheetsApiAppendRow_(CONFIG.SHEETS.SESSOES, [
      token,
      usuario.email,
      usuario.nivel,
      usuario.filial,
      now,
      now + CONFIG.SESSION_DURATION_MS,
    ]);
  } finally {
    lock.releaseLock();
  }
  invalidateSessionCache_();
  return {
    token: token,
    email: usuario.email,
    nivel: usuario.nivel,
    filial: usuario.filial,
  };
}

function validateSession_(token) {
  if (!token) return null;
  const data = getSessoesData_();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === token) {
      const expiraEm = Number(data[i][5]);
      if (isNaN(expiraEm) || Date.now() > expiraEm) {
        return null;
      }
      const usuario = findUsuarioByEmail_(data[i][1]);
      if (!usuario || usuario.status === CONFIG.STATUS_USUARIO.REMOVIDO)
        return null;
      return {
        token: token,
        email: data[i][1],
        nivel: data[i][2],
        filial: data[i][3],
      };
    }
  }
  return null;
}

function cleanupExpiredSessions_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = sheetsApiGetValues_(CONFIG.SHEETS.SESSOES);
    if (data.length <= 1) return;
    const now = Date.now();
    const rowsToDelete = [];
    for (let i = data.length - 1; i >= 1; i--) {
      const expiraEm = Number(data[i][5]);
      if (isNaN(expiraEm) || now > expiraEm) {
        rowsToDelete.push(i + 1);
      }
    }
    for (const rowIndex of rowsToDelete.reverse()) {
      sheetsApiDeleteRow_(CONFIG.SHEETS.SESSOES, rowIndex);
    }
    if (rowsToDelete.length > 0) {
      invalidateSessionCache_();
    }
  } finally {
    lock.releaseLock();
  }
}

function requireSession_(token, niveisPermitidos) {
  const session = validateSession_(token);
  if (!session) {
    throw new Error("Sessão inválida ou expirada. Faça login novamente.");
  }
  if (niveisPermitidos) {
    const niveis = Array.isArray(niveisPermitidos)
      ? niveisPermitidos
      : [niveisPermitidos];
    if (niveis.indexOf(session.nivel) === -1) {
      throw new Error("Você não tem permissão para executar esta ação.");
    }
  }
  return session;
}

// ============================================================================
// ACESSO A DADOS — USUÁRIOS
// ============================================================================

function findUsuarioByEmail_(email) {
  const data = sheetsApiGetValues_(CONFIG.SHEETS.USUARIOS);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === email) {
      return {
        rowIndex: i + 1,
        email: data[i][0],
        nome: data[i][1],
        nivel: data[i][2],
        filial: data[i][3],
        status: data[i][4],
        dataRemocao: data[i][5],
      };
    }
  }
  return null;
}

// ============================================================================
// ACESSO A DADOS — EQUIPAMENTOS
// ============================================================================

function getAllEquipamentos_() {
  const data = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
  if (!data || data.length === 0) return [];
  const headers = data[0];
  const rows = data.slice(1);
  return rows.map(function (row, idx) {
    const obj = { _rowIndex: idx + 2 };
    headers.forEach(function (header, colIdx) {
      obj[header] = row[colIdx] !== undefined ? row[colIdx] : "";
    });
    return obj;
  });
}

function equipamentoDuplicado_(numeroSerie, patrimonio, ignorarId) {
  const serie = String(numeroSerie || "")
    .trim()
    .toUpperCase();
  const patr = String(patrimonio || "")
    .trim()
    .toUpperCase();
  if (!serie && !patr) return false;
  const todos = getAllEquipamentos_();
  return todos.some(function (e) {
    if (ignorarId && e.id === ignorarId) return false;
    if (e.status === "Removido") return false;
    const serieIgual =
      !!serie &&
      String(e.numeroSerie || "")
        .trim()
        .toUpperCase() === serie;
    const patrimonioIgual =
      !!patr &&
      String(e.patrimonio || "")
        .trim()
        .toUpperCase() === patr;
    return serieIgual || patrimonioIgual;
  });
}

function getEquipamentosDaFilial(token) {
  try {
    const session = requireSession_(token);
    const todos = getAllEquipamentos_();
    if (!todos) return [];
    const filtrados = todos.filter(function (item) {
      const naoRemovido = item["status"] !== "Removido";
      const temAcesso = sessaoTemAcessoAUnidade_(session, item["unidade"]);
      return naoRemovido && temAcesso;
    });
    return JSON.parse(JSON.stringify(filtrados));
  } catch (e) {
    Logger.log("ERRO em getEquipamentosDaFilial: " + e.message);
    return [];
  }
}

function getEquipamentosGlobal(token, incluirRemovidos) {
  try {
    const session = requireSession_(token, CONFIG.NIVEIS.MATRIZ);
    const todos = getAllEquipamentos_();
    if (!todos || !Array.isArray(todos)) return [];
    const filtrados = todos.filter(function (item) {
      return incluirRemovidos ? true : item["status"] !== "Removido";
    });
    return JSON.parse(JSON.stringify(filtrados));
  } catch (e) {
    Logger.log("ERRO em getEquipamentosGlobal: " + e.message);
    return [];
  }
}

function createEquipamento(token, dadosEquipamento) {
  const session = requireSession_(token);
  const unidade = resolverUnidadeParaEscrita_(
    session,
    dadosEquipamento.unidade,
  );

  // --- VALIDAÇÃO DE PATRIMÔNIO E SÉRIE COM JUSTIFICATIVA ---
  const patrimonio = (dadosEquipamento.patrimonio || "").trim();
  const justifPat = (dadosEquipamento.justificativaPatrimonio || "").trim();
  const serie = (dadosEquipamento.numeroSerie || "").trim();
  const justifSerie = (dadosEquipamento.justificativaNumeroSerie || "").trim();

  if (!patrimonio && !justifPat) {
    throw new Error(
      "Informe o Patrimônio ou uma justificativa para a sua ausência.",
    );
  }
  if (!serie && !justifSerie) {
    throw new Error(
      "Informe o Número de Série ou uma justificativa para a sua ausência.",
    );
  }
  // Se patrimônio foi preenchido, limpa a justificativa (para não guardar lixo)
  if (patrimonio) dadosEquipamento.justificativaPatrimonio = "";
  if (serie) dadosEquipamento.justificativaNumeroSerie = "";
  // --- FIM VALIDAÇÃO ---

  if (
    equipamentoDuplicado_(
      dadosEquipamento.numeroSerie,
      dadosEquipamento.patrimonio,
    )
  ) {
    throw new Error(
      "Já existe um equipamento cadastrado com este Número de Série ou Patrimônio.",
    );
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    const headers = data[0];
    const id = Utilities.getUuid();
    const now = new Date();

    let anexoUrl = null;
    if (dadosEquipamento.status === "Extraviado") {
      if (!dadosEquipamento._anexoBoletim) {
        throw new Error(
          'Para o status "Extraviado", o anexo do Boletim de Ocorrência é obrigatório.',
        );
      }
      const anexo = dadosEquipamento._anexoBoletim;
      anexoUrl = salvarAnexoBoletim_(
        anexo.base64,
        anexo.mimeType,
        anexo.fileName,
        unidade,
      );
      delete dadosEquipamento._anexoBoletim;
      dadosEquipamento.boletimOcorrenciaAnexoUrl = anexoUrl;
    }

    const linha = headers.map(function (header) {
      if (header === "id") return id;
      if (header === "unidade") return unidade;
      if (header === "status") return dadosEquipamento.status || "Disponível";
      if (header === "dataCadastro") return now;
      if (header === "dataUltimaAtualizacao") return now;
      if (header === "cadastradoPor") return session.email;
      if (header === "ultimaAlteracaoPor") return session.email;
      if (header in dadosEquipamento) return dadosEquipamento[header];
      return "";
    });

    sheetsApiAppendRow_(CONFIG.SHEETS.EQUIPAMENTOS, linha);
    registrarHistorico_(
      id,
      "criação",
      "",
      "Equipamento cadastrado",
      session.email,
    );
    registrarAuditoria_("createEquipamento", session.email, {
      id: id,
      unidade: unidade,
    });
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function updateEquipamento(token, id, camposAlterados) {
  const session = requireSession_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    const headers = data[0];
    const idCol = headers.indexOf("id");
    const unidadeCol = headers.indexOf("unidade");

    const rowIndex = findRowIndexById_(data, idCol, id);
    if (rowIndex === -1) throw new Error("Equipamento não encontrado.");
    const linhaAtual = data[rowIndex - 1];
    if (!sessaoTemAcessoAUnidade_(session, linhaAtual[unidadeCol])) {
      throw new Error("Você não tem permissão para editar este equipamento.");
    }

    // --- VALIDAÇÃO DE PATRIMÔNIO E SÉRIE COM JUSTIFICATIVA (na edição) ---
    // Verifica se os campos estão sendo alterados
    const novoPatrimonio =
      camposAlterados.patrimonio !== undefined
        ? camposAlterados.patrimonio
        : linhaAtual[headers.indexOf("patrimonio")];
    const novaSerie =
      camposAlterados.numeroSerie !== undefined
        ? camposAlterados.numeroSerie
        : linhaAtual[headers.indexOf("numeroSerie")];
    const justifPat =
      camposAlterados.justificativaPatrimonio !== undefined
        ? camposAlterados.justificativaPatrimonio
        : linhaAtual[headers.indexOf("justificativaPatrimonio")] || "";
    const justifSerie =
      camposAlterados.justificativaNumeroSerie !== undefined
        ? camposAlterados.justificativaNumeroSerie
        : linhaAtual[headers.indexOf("justificativaNumeroSerie")] || "";

    const patrimonioVazio = !novoPatrimonio || novoPatrimonio.trim() === "";
    const serieVazia = !novaSerie || novaSerie.trim() === "";

    if (patrimonioVazio && !justifPat) {
      throw new Error(
        "Informe o Patrimônio ou uma justificativa para a sua ausência.",
      );
    }
    if (serieVazia && !justifSerie) {
      throw new Error(
        "Informe o Número de Série ou uma justificativa para a sua ausência.",
      );
    }
    // Se foi preenchido, limpa a justificativa
    if (
      !patrimonioVazio &&
      camposAlterados.justificativaPatrimonio !== undefined
    ) {
      camposAlterados.justificativaPatrimonio = "";
    }
    if (!serieVazia && camposAlterados.justificativaNumeroSerie !== undefined) {
      camposAlterados.justificativaNumeroSerie = "";
    }
    // --- FIM VALIDAÇÃO ---

    if (
      camposAlterados.numeroSerie !== undefined ||
      camposAlterados.patrimonio !== undefined
    ) {
      const serieNovaIdx = headers.indexOf("numeroSerie");
      const patrimonioNovoIdx = headers.indexOf("patrimonio");
      const serieNova =
        camposAlterados.numeroSerie !== undefined
          ? camposAlterados.numeroSerie
          : serieNovaIdx !== -1
            ? linhaAtual[serieNovaIdx]
            : "";
      const patrimonioNovo =
        camposAlterados.patrimonio !== undefined
          ? camposAlterados.patrimonio
          : patrimonioNovoIdx !== -1
            ? linhaAtual[patrimonioNovoIdx]
            : "";
      if (equipamentoDuplicado_(serieNova, patrimonioNovo, id)) {
        throw new Error(
          "Já existe outro equipamento com este Número de Série ou Patrimônio.",
        );
      }
    }

    validarStatusEspecial_(camposAlterados, linhaAtual, headers);

    let anexoUrl = null;
    if (
      camposAlterados.status === "Extraviado" &&
      camposAlterados._anexoBoletim
    ) {
      const anexo = camposAlterados._anexoBoletim;
      anexoUrl = salvarAnexoBoletim_(
        anexo.base64,
        anexo.mimeType,
        anexo.fileName,
        session.filial,
      );
      camposAlterados.boletimOcorrenciaAnexoUrl = anexoUrl;
      delete camposAlterados._anexoBoletim;
    }

    const cellUpdates = [];
    const historicoParaRegistrar = [];

    Object.keys(camposAlterados).forEach(function (campo) {
      if (
        campo === "id" ||
        campo === "dataCadastro" ||
        campo === "cadastradoPor"
      )
        return;
      const colIndex = headers.indexOf(campo);
      if (colIndex === -1) return;
      const valorAntigo = linhaAtual[colIndex];
      const valorNovo = camposAlterados[campo];
      if (String(valorAntigo) === String(valorNovo)) return;
      cellUpdates.push({ row: rowIndex, col: colIndex + 1, value: valorNovo });
      historicoParaRegistrar.push({
        campo: campo,
        antigo: valorAntigo,
        novo: valorNovo,
      });
    });

    const atualizadoCol = headers.indexOf("dataUltimaAtualizacao");
    if (atualizadoCol !== -1 && cellUpdates.length > 0) {
      cellUpdates.push({
        row: rowIndex,
        col: atualizadoCol + 1,
        value: new Date(),
      });
    }
    const ultimaAlteracaoCol = headers.indexOf("ultimaAlteracaoPor");
    if (ultimaAlteracaoCol !== -1 && cellUpdates.length > 0) {
      cellUpdates.push({
        row: rowIndex,
        col: ultimaAlteracaoCol + 1,
        value: session.email,
      });
    }

    if (cellUpdates.length > 0) {
      sheetsApiBatchUpdateCells_(CONFIG.SHEETS.EQUIPAMENTOS, cellUpdates);
    }

    historicoParaRegistrar.forEach(function (h) {
      registrarHistorico_(id, h.campo, h.antigo, h.novo, session.email);
    });
    if (historicoParaRegistrar.length > 0) {
      registrarAuditoria_("updateEquipamento", session.email, {
        id: id,
        campos: historicoParaRegistrar.map(function (h) {
          return h.campo;
        }),
      });
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
    const idCol = headers.indexOf("id");
    const unidadeCol = headers.indexOf("unidade");
    const statusCol = headers.indexOf("status");

    const rowIndex = findRowIndexById_(data, idCol, idOrigem);
    if (rowIndex === -1) throw new Error("Equipamento não encontrado.");
    const linhaOrigem = data[rowIndex - 1];
    if (!sessaoTemAcessoAUnidade_(session, linhaOrigem[unidadeCol])) {
      throw new Error("Você não tem permissão para clonar este equipamento.");
    }

    const novoId = Utilities.getUuid();
    const novaLinha = linhaOrigem.slice();
    novaLinha[idCol] = novoId;
    novaLinha[statusCol] = "Disponível";
    setIfHeaderExists_(novaLinha, headers, "numeroSerie", "");
    setIfHeaderExists_(novaLinha, headers, "patrimonio", "");
    setIfHeaderExists_(novaLinha, headers, "dataCadastro", new Date());
    setIfHeaderExists_(novaLinha, headers, "dataUltimaAtualizacao", new Date());
    setIfHeaderExists_(novaLinha, headers, "cadastradoPor", session.email);
    setIfHeaderExists_(novaLinha, headers, "ultimaAlteracaoPor", session.email);

    sheetsApiAppendRow_(CONFIG.SHEETS.EQUIPAMENTOS, novaLinha);
    registrarHistorico_(
      novoId,
      "criação",
      "",
      "Clonado a partir de " + idOrigem,
      session.email,
    );
    registrarAuditoria_("cloneEquipamento", session.email, {
      idOrigem: idOrigem,
      novoId: novoId,
    });
    return { ok: true, id: novoId };
  } finally {
    lock.releaseLock();
  }
}

function removerEquipamento(token, id) {
  const session = requireSession_(token, [
    CONFIG.NIVEIS.MATRIZ,
    CONFIG.NIVEIS.ADMIN_FILIAL,
  ]);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    const headers = data[0];
    const idCol = headers.indexOf("id");
    const unidadeCol = headers.indexOf("unidade");
    const statusCol = headers.indexOf("status");

    const rowIndex = findRowIndexById_(data, idCol, id);
    if (rowIndex === -1) throw new Error("Equipamento não encontrado.");
    const linhaAtual = data[rowIndex - 1];
    if (!sessaoTemAcessoAUnidade_(session, linhaAtual[unidadeCol])) {
      throw new Error("Você não tem permissão para remover este equipamento.");
    }

    const statusAntigo = linhaAtual[statusCol];
    sheetsApiUpdateCell_(
      CONFIG.SHEETS.EQUIPAMENTOS,
      rowIndex,
      statusCol + 1,
      "Removido",
    );
    registrarHistorico_(id, "status", statusAntigo, "Removido", session.email);
    registrarAuditoria_("removerEquipamento", session.email, { id: id });
    return { ok: true, message: "Equipamento removido (soft-delete)." };
  } finally {
    lock.releaseLock();
  }
}

function atualizarStatusManutencao(token, equipamentoId, novoStatus) {
  const session = requireSession_(token);
  if (STATUS_MANUTENCAO_VALIDOS_.indexOf(novoStatus) === -1) {
    throw new Error("Status de manutenção inválido.");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    const headers = data[0];
    const idCol = headers.indexOf("id");
    const unidadeCol = headers.indexOf("unidade");
    const statusManutCol = headers.indexOf("statusManutencao");
    const ultimaAlteracaoCol = headers.indexOf("ultimaAlteracaoPor");

    if (statusManutCol === -1) {
      throw new Error(
        'Coluna "statusManutencao" não existe na aba Equipamentos. Adicione-a no cabeçalho.',
      );
    }

    const rowIndex = findRowIndexById_(data, idCol, equipamentoId);
    if (rowIndex === -1) throw new Error("Equipamento não encontrado.");
    const linhaAtual = data[rowIndex - 1];
    if (!sessaoTemAcessoAUnidade_(session, linhaAtual[unidadeCol])) {
      throw new Error("Você não tem permissão para alterar este equipamento.");
    }

    const statusAntigo = linhaAtual[statusManutCol];
    if (String(statusAntigo) === String(novoStatus)) return { ok: true };

    const cellUpdates = [
      { row: rowIndex, col: statusManutCol + 1, value: novoStatus },
    ];
    if (ultimaAlteracaoCol !== -1) {
      cellUpdates.push({
        row: rowIndex,
        col: ultimaAlteracaoCol + 1,
        value: session.email,
      });
    }
    sheetsApiBatchUpdateCells_(CONFIG.SHEETS.EQUIPAMENTOS, cellUpdates);

    registrarHistorico_(
      equipamentoId,
      "statusManutencao",
      statusAntigo,
      novoStatus,
      session.email,
    );
    registrarAuditoria_("atualizarStatusManutencao", session.email, {
      id: equipamentoId,
      novoStatus: novoStatus,
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function validarStatusEspecial_(camposAlterados, linhaAtual, headers) {
  if (!("status" in camposAlterados)) return;

  if (camposAlterados.status === "Extraviado") {
    const anexoNoPayload = camposAlterados.boletimOcorrenciaAnexoUrl;
    const anexoColIdx = headers.indexOf("boletimOcorrenciaAnexoUrl");
    const anexoExistente = anexoColIdx !== -1 ? linhaAtual[anexoColIdx] : "";
    if (!anexoNoPayload && !anexoExistente) {
      throw new Error(
        'Para o status "Extraviado", anexe o Boletim de Ocorrência.',
      );
    }
  }

  const REGRAS_STATUS_ESPECIAL = {
    Manutenção: "numeroChamadoManutencao",
    Extraviado: "boletimOcorrencia",
    "Em verificação": "justificativaVerificacao",
    Quebrado: "descricaoQuebrado",
  };

  const novoStatus = camposAlterados["status"];
  const campoObrigatorio = REGRAS_STATUS_ESPECIAL[novoStatus];
  if (!campoObrigatorio) return;

  const valorNoPayload = camposAlterados[campoObrigatorio];
  const colIndex = headers.indexOf(campoObrigatorio);
  const valorExistente = colIndex !== -1 ? linhaAtual[colIndex] : "";
  const valorFinal =
    valorNoPayload !== undefined ? valorNoPayload : valorExistente;

  if (!valorFinal) {
    throw new Error(
      'Para alterar o status para "' +
        novoStatus +
        '", o campo "' +
        campoObrigatorio +
        '" é obrigatório.',
    );
  }
}

function findRowIndexById_(data, idCol, id) {
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) return i + 1;
  }
  return -1;
}

/// ============================================================================
// LISTAS AUXILIARES (com cache e estrutura hierárquica)
// ============================================================================

function getListasCadastro(token) {
  // Valida a sessão (opcional, mas garante que o usuário está autenticado)
  try {
    requireSession_(token); // apenas para verificar token válido
  } catch (e) {
    throw new Error("Token inválido ou sessão expirada.");
  }

  // Lê a aba "Listas" usando o mesmo método do restante do sistema
  const data = sheetsApiGetValues_(CONFIG.SHEETS.LISTAS);
  if (!data || data.length < 2) {
    return [];
  }

  const headers = data[0];
  let idxCategoria = headers.indexOf("categoria");
  let idxMarca = headers.indexOf("marca");
  let idxModelo = headers.indexOf("modelo");

  // Fallback para posições fixas caso os cabeçalhos não sejam encontrados
  if (idxCategoria === -1) idxCategoria = 0;
  if (idxMarca === -1) idxMarca = 1;
  if (idxModelo === -1) idxModelo = 2;

  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const cat = row[idxCategoria] ? String(row[idxCategoria]).trim() : "";
    const marca = row[idxMarca] ? String(row[idxMarca]).trim() : "";
    const modelo = row[idxModelo] ? String(row[idxModelo]).trim() : "";
    if (cat && marca && modelo) {
      result.push({ categoria: cat, marca: marca, modelo: modelo });
    }
  }
  return result;
}

function getFiliaisParaEmprestimo(token) {
  try {
    requireSession_(token);
  } catch (e) {
    throw new Error("Token inválido ou sessão expirada.");
  }

  const data = sheetsApiGetValues_(CONFIG.SHEETS.FILIAIS);
  if (!data || data.length < 2) {
    return [];
  }

  const headers = data[0];
  let idxNome = headers.indexOf("nome");
  let idxSigla = headers.indexOf("sigla");

  if (idxNome === -1) idxNome = 0;
  if (idxSigla === -1) idxSigla = 1;

  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const nome = row[idxNome] ? String(row[idxNome]).trim() : "";
    const sigla = row[idxSigla] ? String(row[idxSigla]).trim() : "";
    const valor = nome || sigla;
    if (valor) {
      result.push(valor);
    }
  }
  return result.sort();
}
function lerListasDaPlanilha_() {
  const data = sheetsApiGetValues_(CONFIG.SHEETS.LISTAS);
  if (!data || data.length < 2) {
    // Fallback com dados de exemplo (opcional)
    return {
      categorias: ["Notebook", "Desktop", "Monitor", "Cellular", "Tablet"],
      marcasPorCategoria: {
        Notebook: ["Lenovo", "Positivo", "Multilaser", "Samsung"],
        Desktop: ["Dell", "Lenovo", "HP"],
        Monitor: ["LG", "Samsung", "AOC", "ITAUTEC"],
        Cellular: ["Redmi", "Motorola", "Xiaomi", "Realme", "Multilaser"],
        Tablet: ["Positivo"],
      },
      modelosPorMarca: {
        Lenovo: ["ThinkPad L14", "ThinkCentre", "ThinkVision"],
        Positivo: ["Master N1110", "Master N1210", "T2040"],
        Multilaser: ["PC114", "Ultra", "G2"],
        Samsung: ["Chromebook", "Odyssey G5"],
        Dell: ["OptiPlex 3080", "Inspiron 15"],
        HP: ["ProDesk 400"],
        LG: ["FLATRON 19EB13PW", "UltraGear 27"],
        AOC: ["22P1E"],
        ITAUTEC: ["E2011PX"],
        Redmi: [
          "12C",
          "13C",
          "9C",
          "A1",
          "A1 +",
          "A3",
          "Note 11S",
          "Note 11",
          "Note 11 Pro",
          "Note 12",
          "Note 12 Pro",
          "Note 12S",
          "Note 13",
          "Note 13 PRO",
          "Note 14",
          "Note 9",
          "Note 8",
        ],
        Motorola: ["G13"],
        Xiaomi: [
          "Poco C85",
          "Poco M3 PRO",
          "Poco M5",
          "Poco M6 PRO",
          "Poco X5",
        ],
        Realme: ["C51", "C61", "Note 50"],
      },
    };
  }

  const headers = data[0];
  const colCategoria = headers.indexOf("categoria");
  const colMarca = headers.indexOf("marca");
  const colModelo = headers.indexOf("modelo");

  if (colCategoria === -1 || colMarca === -1 || colModelo === -1) {
    return { categorias: [], marcasPorCategoria: {}, modelosPorMarca: {} };
  }

  const dados = data
    .slice(1)
    .filter((row) => row[colCategoria] && row[colMarca] && row[colModelo]);

  const marcasPorCategoria = {};
  const modelosPorMarca = {};
  const categoriasSet = new Set();

  dados.forEach((row) => {
    const cat = row[colCategoria].trim();
    const marca = row[colMarca].trim();
    const modelo = row[colModelo].trim();

    categoriasSet.add(cat);

    if (!marcasPorCategoria[cat]) marcasPorCategoria[cat] = [];
    if (!marcasPorCategoria[cat].includes(marca))
      marcasPorCategoria[cat].push(marca);

    if (!modelosPorMarca[marca]) modelosPorMarca[marca] = [];
    if (!modelosPorMarca[marca].includes(modelo))
      modelosPorMarca[marca].push(modelo);
  });

  const categorias = Array.from(categoriasSet).sort();
  Object.keys(marcasPorCategoria).forEach((cat) =>
    marcasPorCategoria[cat].sort(),
  );
  Object.keys(modelosPorMarca).forEach((marca) =>
    modelosPorMarca[marca].sort(),
  );

  return {
    categorias: categorias,
    marcasPorCategoria: marcasPorCategoria,
    modelosPorMarca: modelosPorMarca,
  };
}

// ============================================================================
// HISTÓRICO
// ============================================================================

function registrarHistorico_(
  equipamentoId,
  campo,
  valorAntigo,
  valorNovo,
  autor,
) {
  try {
    sheetsApiAppendRow_(CONFIG.SHEETS.HISTORICO, [
      equipamentoId,
      campo,
      valorAntigo,
      valorNovo,
      autor,
      new Date(),
    ]);
  } catch (e) {
    Logger.log("Erro ao registrar histórico: " + e.message);
  }
}

function getHistoricoEquipamento(token, equipamentoId) {
  const session = requireSession_(token);
  if (
    session.nivel !== CONFIG.NIVEIS.MATRIZ &&
    session.nivel !== CONFIG.NIVEIS.ADMIN_FILIAL
  ) {
    const equipamentos = getAllEquipamentos_();
    const item = equipamentos.filter(function (e) {
      return e.id === equipamentoId;
    })[0];
    if (!item || !sessaoTemAcessoAUnidade_(session, item.unidade)) {
      throw new Error("Você não tem permissão para ver este histórico.");
    }
  }

  const data = sheetsApiGetValues_(CONFIG.SHEETS.HISTORICO);
  return data
    .slice(1)
    .filter(function (row) {
      return row[0] === equipamentoId;
    })
    .map(function (row) {
      return {
        equipamentoId: row[0],
        campo: row[1],
        valorAntigo: row[2],
        valorNovo: row[3],
        autor: row[4],
        data: row[5],
      };
    })
    .reverse();
}

// ============================================================================
// REGISTRO DE MANUTENÇÃO
// ============================================================================

function registrarManutencao(token, equipamentoId, descricao, status) {
  const session = requireSession_(token);
  descricao = String(descricao || "").trim();
  if (!descricao)
    throw new Error("Descreva o que foi feito antes de registrar.");
  status =
    STATUS_MANUTENCAO_VALIDOS_.indexOf(status) !== -1
      ? status
      : CONFIG.STATUS_MANUTENCAO.PENDENTE;

  const equipamentos = getAllEquipamentos_();
  const item = equipamentos.filter(function (e) {
    return e.id === equipamentoId;
  })[0];
  if (!item) throw new Error("Equipamento não encontrado.");
  if (!sessaoTemAcessoAUnidade_(session, item.unidade)) {
    throw new Error(
      "Você não tem permissão para registrar manutenção neste equipamento.",
    );
  }

  ensureSheetExists_(
    CONFIG.SHEETS.REGISTROS_MANUTENCAO,
    REGISTROS_MANUTENCAO_HEADERS_,
  );

  const id = Utilities.getUuid();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    sheetsApiAppendRow_(CONFIG.SHEETS.REGISTROS_MANUTENCAO, [
      id,
      equipamentoId,
      session.email,
      new Date(),
      descricao,
      status,
    ]);
  } finally {
    lock.releaseLock();
  }

  try {
    atualizarStatusManutencao(token, equipamentoId, status);
  } catch (e) {
    Logger.log("Aviso ao sincronizar statusManutencao: " + e.message);
  }

  registrarAuditoria_("registrarManutencao", session.email, {
    equipamentoId: equipamentoId,
    registroId: id,
    status: status,
  });
  return { ok: true, id: id };
}

function getRegistrosManutencao(token, equipamentoId) {
  try {
    const session = requireSession_(token);
    const equipamentos = getAllEquipamentos_();
    const item = equipamentos.filter(function (e) {
      return e.id === equipamentoId;
    })[0];
    if (!item || !sessaoTemAcessoAUnidade_(session, item.unidade)) {
      throw new Error(
        "Você não tem permissão para ver os registros deste equipamento.",
      );
    }

    ensureSheetExists_(
      CONFIG.SHEETS.REGISTROS_MANUTENCAO,
      REGISTROS_MANUTENCAO_HEADERS_,
    );
    const data = sheetsApiGetValues_(CONFIG.SHEETS.REGISTROS_MANUTENCAO);
    if (!data || data.length === 0) return [];

    return data
      .slice(1)
      .filter(function (row) {
        return row[1] === equipamentoId;
      })
      .map(function (row) {
        return {
          id: row[0],
          equipamentoId: row[1],
          autor: row[2],
          data: row[3],
          descricao: row[4],
          status: row[5],
        };
      })
      .reverse();
  } catch (e) {
    Logger.log("Erro em getRegistrosManutencao: " + e.message);
    return [];
  }
}

// ============================================================================
// EMPRÉSTIMOS / DEVOLUÇÕES
// ============================================================================

function registrarEmprestimo(token, equipamentoIds, dadosEmprestimo) {
  const session = requireSession_(token);
  equipamentoIds = Array.isArray(equipamentoIds)
    ? equipamentoIds
    : [equipamentoIds];
  equipamentoIds = equipamentoIds.filter(function (id) {
    return !!id;
  });
  if (equipamentoIds.length === 0)
    throw new Error("Nenhum equipamento informado.");

  dadosEmprestimo = dadosEmprestimo || {};
  if (!dadosEmprestimo.responsavel)
    throw new Error("Responsavel e obrigatorio.");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureSheetExists_(CONFIG.SHEETS.EMPRESTIMOS, EMPRESTIMOS_HEADERS_);

    const eqData = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    const headers = eqData[0];
    const idCol = headers.indexOf("id");
    const unidadeCol = headers.indexOf("unidade");
    const statusCol = headers.indexOf("status");
    const responsavelCol = headers.indexOf("responsavelAtual");
    const dataAtribCol = headers.indexOf("dataAtribuicao");
    const atualizadoCol = headers.indexOf("dataUltimaAtualizacao");

    const itens = equipamentoIds.map(function (id) {
      const rowIndex = findRowIndexById_(eqData, idCol, id);
      if (rowIndex === -1) throw new Error("Equipamento nao encontrado: " + id);
      const row = eqData[rowIndex - 1];
      if (!sessaoTemAcessoAUnidade_(session, row[unidadeCol])) {
        throw new Error(
          "Voce nao tem permissao para emprestar o equipamento " + id + ".",
        );
      }
      if (row[statusCol] === "Removido")
        throw new Error("Equipamento removido nao pode ser emprestado.");
      if (row[statusCol] === "Emprestado")
        throw new Error("Equipamento ja esta emprestado.");
      return { rowIndex: rowIndex, row: row, id: id };
    });

    const emprestimoId = Utilities.getUuid();
    const now = new Date();
    const unidade =
      itens.length > 0 ? valueByHeader_(itens[0].row, headers, "unidade") : "";
    const termo = gerarTermoEmprestimoPdf_(
      emprestimoId,
      itens,
      headers,
      dadosEmprestimo,
      unidade,
    );

    itens.forEach(function (item) {
      sheetsApiAppendRow_(CONFIG.SHEETS.EMPRESTIMOS, [
        emprestimoId,
        item.id,
        valueByHeader_(item.row, headers, "patrimonio"),
        valueByHeader_(item.row, headers, "unidade"),
        dadosEmprestimo.responsavel || "",
        dadosEmprestimo.cpf || "",
        dadosEmprestimo.emailResponsavel || "",
        now,
        dadosEmprestimo.dataPrevistaDevolucao || "",
        "",
        "Aberto",
        termo.url || "",
        session.email,
        "",
        dadosEmprestimo.observacoes || "",
        dadosEmprestimo.tipoEmprestimo || "interno",
        dadosEmprestimo.escolaDestino || "",
      ]);

      const cellUpdates = [];
      if (statusCol !== -1)
        cellUpdates.push({
          row: item.rowIndex,
          col: statusCol + 1,
          value: "Emprestado",
        });
      if (responsavelCol !== -1)
        cellUpdates.push({
          row: item.rowIndex,
          col: responsavelCol + 1,
          value: dadosEmprestimo.responsavel || "",
        });
      if (dataAtribCol !== -1)
        cellUpdates.push({
          row: item.rowIndex,
          col: dataAtribCol + 1,
          value: now,
        });
      if (atualizadoCol !== -1)
        cellUpdates.push({
          row: item.rowIndex,
          col: atualizadoCol + 1,
          value: now,
        });
      sheetsApiBatchUpdateCells_(CONFIG.SHEETS.EQUIPAMENTOS, cellUpdates);

      registrarHistorico_(
        item.id,
        "status",
        valueByHeader_(item.row, headers, "status"),
        "Emprestado",
        session.email,
      );
    });

    registrarAuditoria_("registrarEmprestimo", session.email, {
      emprestimoId: emprestimoId,
      itens: equipamentoIds,
    });

    if (dadosEmprestimo.emailResponsavel && termo.blob) {
      MailApp.sendEmail({
        to: dadosEmprestimo.emailResponsavel,
        subject: "SCE - Termo de emprestimo",
        body: "Segue em anexo o termo de emprestimo dos equipamentos.",
        attachments: [termo.blob],
      });
    }

    return {
      ok: true,
      id: emprestimoId,
      termoUrl: termo.url,
      message: "Emprestimo registrado.",
    };
  } finally {
    lock.releaseLock();
  }
}

function registrarDevolucao(token, equipamentoIds, observacoes) {
  const session = requireSession_(token);
  equipamentoIds = Array.isArray(equipamentoIds)
    ? equipamentoIds
    : [equipamentoIds];
  equipamentoIds = equipamentoIds.filter(function (id) {
    return !!id;
  });
  if (equipamentoIds.length === 0)
    throw new Error("Nenhum equipamento informado.");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureSheetExists_(CONFIG.SHEETS.EMPRESTIMOS, EMPRESTIMOS_HEADERS_);

    const eqData = sheetsApiGetValues_(CONFIG.SHEETS.EQUIPAMENTOS);
    const headers = eqData[0];
    const idCol = headers.indexOf("id");
    const unidadeCol = headers.indexOf("unidade");
    const statusCol = headers.indexOf("status");
    const responsavelCol = headers.indexOf("responsavelAtual");
    const dataAtribCol = headers.indexOf("dataAtribuicao");
    const atualizadoCol = headers.indexOf("dataUltimaAtualizacao");
    const now = new Date();

    equipamentoIds.forEach(function (id) {
      const rowIndex = findRowIndexById_(eqData, idCol, id);
      if (rowIndex === -1) throw new Error("Equipamento nao encontrado: " + id);
      const row = eqData[rowIndex - 1];
      if (!sessaoTemAcessoAUnidade_(session, row[unidadeCol])) {
        throw new Error(
          "Voce nao tem permissao para devolver o equipamento " + id + ".",
        );
      }

      const cellUpdates = [];
      if (statusCol !== -1)
        cellUpdates.push({
          row: rowIndex,
          col: statusCol + 1,
          value: "Disponível",
        });
      if (responsavelCol !== -1)
        cellUpdates.push({ row: rowIndex, col: responsavelCol + 1, value: "" });
      if (dataAtribCol !== -1)
        cellUpdates.push({ row: rowIndex, col: dataAtribCol + 1, value: "" });
      if (atualizadoCol !== -1)
        cellUpdates.push({ row: rowIndex, col: atualizadoCol + 1, value: now });
      sheetsApiBatchUpdateCells_(CONFIG.SHEETS.EQUIPAMENTOS, cellUpdates);

      registrarHistorico_(
        id,
        "status",
        valueByHeader_(row, headers, "status"),
        "Disponível",
        session.email,
      );
      fecharEmprestimoAberto_(id, session.email, now, observacoes || "");
    });

    registrarAuditoria_("registrarDevolucao", session.email, {
      itens: equipamentoIds,
    });
    return { ok: true, message: "Devolucao registrada." };
  } finally {
    lock.releaseLock();
  }
}

function fecharEmprestimoAberto_(
  equipamentoId,
  devolvidoPor,
  dataDevolucao,
  observacoes,
) {
  ensureSheetExists_(CONFIG.SHEETS.EMPRESTIMOS, EMPRESTIMOS_HEADERS_);
  const data = sheetsApiGetValues_(CONFIG.SHEETS.EMPRESTIMOS);
  const headers = data[0];
  const equipamentoCol = headers.indexOf("equipamentoId");
  const statusCol = headers.indexOf("status");
  const dataDevCol = headers.indexOf("dataDevolucao");
  const devolvidoPorCol = headers.indexOf("devolvidoPor");
  const obsCol = headers.indexOf("observacoes");

  for (let i = data.length - 1; i >= 1; i--) {
    if (
      data[i][equipamentoCol] === equipamentoId &&
      data[i][statusCol] === "Aberto"
    ) {
      const rowIndex = i + 1;
      const cellUpdates = [
        { row: rowIndex, col: statusCol + 1, value: "Devolvido" },
      ];
      if (dataDevCol !== -1)
        cellUpdates.push({
          row: rowIndex,
          col: dataDevCol + 1,
          value: dataDevolucao,
        });
      if (devolvidoPorCol !== -1)
        cellUpdates.push({
          row: rowIndex,
          col: devolvidoPorCol + 1,
          value: devolvidoPor,
        });
      if (obsCol !== -1 && observacoes)
        cellUpdates.push({
          row: rowIndex,
          col: obsCol + 1,
          value: observacoes,
        });
      sheetsApiBatchUpdateCells_(CONFIG.SHEETS.EMPRESTIMOS, cellUpdates);
      return;
    }
  }
}

// ============================================================================
// EXPORTAÇÃO
// ============================================================================

function exportarCSV(token) {
  const session = requireSession_(token, CONFIG.NIVEIS.MATRIZ);
  const equipamentos = getEquipamentosGlobal(token, false);
  if (!equipamentos || equipamentos.length === 0) {
    return { ok: false, message: "Nenhum equipamento para exportar." };
  }

  const headers = Object.keys(equipamentos[0]).filter(function (h) {
    return h !== "_rowIndex";
  });
  const linhas = [headers.join(",")];
  equipamentos.forEach(function (item) {
    linhas.push(
      headers
        .map(function (h) {
          const v =
            item[h] === undefined || item[h] === null ? "" : String(item[h]);
          return '"' + v.replace(/"/g, '""') + '"';
        })
        .join(","),
    );
  });

  const bom = "\uFEFF";
  const csvContent = bom + linhas.join("\r\n");
  const blob = Utilities.newBlob(
    csvContent,
    "text/csv",
    "sce-equipamentos.csv",
  );
  registrarAuditoria_("exportarCSV", session.email, {
    total: equipamentos.length,
  });
  return {
    ok: true,
    base64: Utilities.base64Encode(blob.getBytes()),
    fileName: "sce-equipamentos.csv",
  };
}

function getResumoEquipamentos(token) {
  const equipamentos = getEquipamentosDaFilial(token);
  const resumo = { total: equipamentos.length, porStatus: {} };
  equipamentos.forEach(function (item) {
    const status = item.status || "Sem status";
    resumo.porStatus[status] = (resumo.porStatus[status] || 0) + 1;
  });
  return resumo;
}

function exportarEquipamentosPDF(token, filtros) {
  const session = requireSession_(token, CONFIG.NIVEIS.MATRIZ);
  const equipamentos = filtrarEquipamentosParaExport_(
    getEquipamentosGlobal(token, false),
    filtros || {},
  );
  const html =
    "<h2>SCE - Relatorio de equipamentos</h2>" +
    "<p>Gerado por " +
    escapeHtml_(session.email) +
    " em " +
    new Date().toLocaleString() +
    "</p>" +
    montarTabelaHtmlEquipamentos_(equipamentos);
  const blob = HtmlService.createHtmlOutput(html)
    .getBlob()
    .setName("sce-equipamentos.pdf")
    .getAs(MimeType.PDF);
  const file = salvarBlobPdf_(
    blob,
    "sce-equipamentos-" +
      Utilities.formatDate(
        new Date(),
        Session.getScriptTimeZone(),
        "yyyyMMdd-HHmmss",
      ) +
      ".pdf",
  );
  registrarAuditoria_("exportarEquipamentosPDF", session.email, {
    total: equipamentos.length,
  });
  return { ok: true, url: file.getUrl(), name: file.getName() };
}

function filtrarEquipamentosParaExport_(equipamentos, filtros) {
  const busca = String(filtros.busca || "").toLowerCase();
  return equipamentos.filter(function (item) {
    if (filtros.status && item.status !== filtros.status) return false;
    if (filtros.categoria && item.categoria !== filtros.categoria) return false;
    if (filtros.marca && item.marca !== filtros.marca) return false;
    if (filtros.unidade && item.unidade !== filtros.unidade) return false;
    if (!busca) return true;
    return (
      [item.patrimonio, item.numeroSerie, item.modelo]
        .join(" ")
        .toLowerCase()
        .indexOf(busca) !== -1
    );
  });
}

function montarTabelaHtmlEquipamentos_(equipamentos) {
  const rows = equipamentos
    .map(function (item) {
      return (
        "<tr><td>" +
        escapeHtml_(item.unidade) +
        "</td><td>" +
        escapeHtml_(item.categoria) +
        "</td><td>" +
        escapeHtml_(item.marca) +
        "</td><td>" +
        escapeHtml_(item.modelo) +
        "</td><td>" +
        escapeHtml_(item.patrimonio) +
        "</td><td>" +
        escapeHtml_(item.status) +
        "</td><td>" +
        escapeHtml_(item.statusManutencao) +
        "</td><td>" +
        escapeHtml_(item.ultimaAlteracaoPor) +
        "</td></tr>"
      );
    })
    .join("");
  return (
    '<table border="1" cellspacing="0" cellpadding="5"><thead><tr><th>Unidade</th><th>Categoria</th><th>Marca</th><th>Modelo</th><th>Patrimonio</th><th>Status</th><th>Status manutenção</th><th>Última alteração por</th></tr></thead><tbody>' +
    rows +
    "</tbody></table>"
  );
}

// ============================================================================
// GESTÃO DE USUÁRIOS (CORRIGIDO: FILTRAR REMOVIDOS + LIMITE 2 PARA ADMINFILIAL)
// ============================================================================

function getNomeUsuario(token) {
  try {
    const session = requireSession_(token);
    const usuario = findUsuarioByEmail_(session.email);
    return usuario ? usuario.nome : "";
  } catch (e) {
    Logger.log("Erro ao buscar nome do usuário: " + e.message);
    return "";
  }
}

function listarUsuarios(token) {
  const session = requireSession_(token, [
    CONFIG.NIVEIS.MATRIZ,
    CONFIG.NIVEIS.ADMIN_FILIAL,
  ]);

  const data = sheetsApiGetValues_(CONFIG.SHEETS.USUARIOS);
  if (!data || data.length === 0) return [];
  const headers = data[0];
  let usuarios = data.slice(1).map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) {
      obj[h] = row[i];
    });
    return obj;
  });

  // Filtrar usuários removidos (soft delete)
  usuarios = usuarios.filter(function (u) {
    return u.status !== CONFIG.STATUS_USUARIO.REMOVIDO;
  });

  if (session.nivel === CONFIG.NIVEIS.ADMIN_FILIAL) {
    const filial = session.filial;
    return usuarios.filter(function (u) {
      return (
        u.filial === filial &&
        (u.nivel === CONFIG.NIVEIS.FILIAL ||
          u.nivel === CONFIG.NIVEIS.ADMIN_FILIAL)
      );
    });
  }
  return usuarios;
}

function adicionarUsuario(token, novoUsuario) {
  const session = requireSession_(token, [
    CONFIG.NIVEIS.MATRIZ,
    CONFIG.NIVEIS.ADMIN_FILIAL,
  ]);

  const email = String(novoUsuario.email || "")
    .trim()
    .toLowerCase();
  if (!email) throw new Error("E-mail é obrigatório.");

  const nivel = novoUsuario.nivel || CONFIG.NIVEIS.FILIAL;
  const filial = novoUsuario.filial || "";

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // AdminFilial: validar filial, perfil permitido e limite de 2 usuários
    if (session.nivel === CONFIG.NIVEIS.ADMIN_FILIAL) {
      if (filial !== session.filial) {
        throw new Error(
          "Você só pode criar usuários para sua própria unidade.",
        );
      }
      if (
        nivel !== CONFIG.NIVEIS.FILIAL &&
        nivel !== CONFIG.NIVEIS.ADMIN_FILIAL
      ) {
        throw new Error("Você só pode criar perfis Filial ou AdminFilial.");
      }

      // Contar usuários ativos (não removidos) daquela filial com perfis permitidos
      const data = sheetsApiGetValues_(CONFIG.SHEETS.USUARIOS);
      let count = 0;
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row[4] === CONFIG.STATUS_USUARIO.REMOVIDO) continue; // removido
        if (row[3] !== filial) continue; // outra filial
        if (
          row[2] === CONFIG.NIVEIS.FILIAL ||
          row[2] === CONFIG.NIVEIS.ADMIN_FILIAL
        ) {
          count++;
        }
      }
      if (count >= 2) {
        throw new Error(
          "Limite máximo de 2 usuários por unidade para AdminFilial.",
        );
      }
    }

    if (findUsuarioByEmail_(email)) {
      throw new Error("Já existe um usuário com este e-mail.");
    }
    sheetsApiAppendRow_(CONFIG.SHEETS.USUARIOS, [
      email,
      novoUsuario.nome || "",
      nivel,
      filial,
      CONFIG.STATUS_USUARIO.ATIVO,
      "",
    ]);
  } finally {
    lock.releaseLock();
  }

  registrarAuditoria_("adicionarUsuario", session.email, { email: email });
  return { ok: true, message: "Usuário adicionado." };
}

function atualizarUsuario(token, emailAtual, dadosAtualizados) {
  const session = requireSession_(token, [
    CONFIG.NIVEIS.MATRIZ,
    CONFIG.NIVEIS.ADMIN_FILIAL,
  ]);
  emailAtual = String(emailAtual || "")
    .trim()
    .toLowerCase();

  if (emailAtual === session.email) {
    throw new Error("Você não pode editar seu próprio usuário.");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const usuario = findUsuarioByEmail_(emailAtual);
    if (!usuario) throw new Error("Usuário não encontrado.");

    // AdminFilial: validações específicas
    if (session.nivel === CONFIG.NIVEIS.ADMIN_FILIAL) {
      if (usuario.filial !== session.filial) {
        throw new Error("Você só pode editar usuários da sua unidade.");
      }
      const novaFilial = dadosAtualizados.filial || usuario.filial;
      if (novaFilial !== session.filial) {
        throw new Error("Não é permitido alterar a filial do usuário.");
      }
      const novoNivel = dadosAtualizados.nivel || usuario.nivel;
      if (
        novoNivel !== CONFIG.NIVEIS.FILIAL &&
        novoNivel !== CONFIG.NIVEIS.ADMIN_FILIAL
      ) {
        throw new Error("Você só pode atribuir perfis Filial ou AdminFilial.");
      }
    }

    const novoEmail = dadosAtualizados.email
      ? String(dadosAtualizados.email).trim().toLowerCase()
      : emailAtual;
    if (novoEmail !== emailAtual) {
      const colisao = findUsuarioByEmail_(novoEmail);
      if (colisao) throw new Error("Já existe outro usuário com este e-mail.");
    }

    const cellUpdates = [
      { row: usuario.rowIndex, col: 1, value: novoEmail },
      {
        row: usuario.rowIndex,
        col: 2,
        value:
          dadosAtualizados.nome !== undefined
            ? dadosAtualizados.nome
            : usuario.nome,
      },
      {
        row: usuario.rowIndex,
        col: 3,
        value:
          dadosAtualizados.nivel !== undefined
            ? dadosAtualizados.nivel
            : usuario.nivel,
      },
      {
        row: usuario.rowIndex,
        col: 4,
        value:
          dadosAtualizados.filial !== undefined
            ? dadosAtualizados.filial
            : usuario.filial,
      },
    ];
    sheetsApiBatchUpdateCells_(CONFIG.SHEETS.USUARIOS, cellUpdates);
  } finally {
    lock.releaseLock();
  }

  registrarAuditoria_("atualizarUsuario", session.email, {
    emailAtual: emailAtual,
    dados: dadosAtualizados,
  });
  return { ok: true, message: "Usuário atualizado." };
}

function removerUsuario(token, emailParaRemover) {
  const session = requireSession_(token, [
    CONFIG.NIVEIS.MATRIZ,
    CONFIG.NIVEIS.ADMIN_FILIAL,
  ]);

  if (String(emailParaRemover).trim().toLowerCase() === session.email) {
    throw new Error("Você não pode remover seu próprio usuário.");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const usuario = findUsuarioByEmail_(
      String(emailParaRemover).trim().toLowerCase(),
    );
    if (!usuario) throw new Error("Usuário não encontrado.");

    // AdminFilial: validações específicas
    if (session.nivel === CONFIG.NIVEIS.ADMIN_FILIAL) {
      if (usuario.filial !== session.filial) {
        throw new Error("Você só pode remover usuários da sua unidade.");
      }
      if (
        usuario.nivel !== CONFIG.NIVEIS.FILIAL &&
        usuario.nivel !== CONFIG.NIVEIS.ADMIN_FILIAL
      ) {
        throw new Error("Você não pode remover este perfil.");
      }
    }

    sheetsApiBatchUpdateCells_(CONFIG.SHEETS.USUARIOS, [
      { row: usuario.rowIndex, col: 5, value: CONFIG.STATUS_USUARIO.REMOVIDO },
      { row: usuario.rowIndex, col: 6, value: new Date() },
    ]);
  } finally {
    lock.releaseLock();
  }

  registrarAuditoria_("removerUsuario", session.email, {
    email: emailParaRemover,
  });
  return { ok: true, message: "Usuário removido (soft-delete)." };
}

// ============================================================================
// UTILITÁRIOS — DRIVE, PDF, TERMO, BO
// ============================================================================

function formatarDataHoraArquivo() {
  const agora = new Date();
  const dia = String(agora.getDate()).padStart(2, "0");
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const ano = agora.getFullYear();
  const hora = String(agora.getHours()).padStart(2, "0");
  const minuto = String(agora.getMinutes()).padStart(2, "0");
  const segundo = String(agora.getSeconds()).padStart(2, "0");
  return `${dia}-${mes}-${ano} ${hora}-${minuto}-${segundo}`;
}

function salvarBlobPdf_(blob, name) {
  try {
    blob = blob.setName(name);
    let folder;
    try {
      folder = DriveApp.getFolderById(CONFIG.PDF_FOLDER_ID);
    } catch (e) {
      Logger.log('PDF_FOLDER_ID não encontrada. Criando "SCE_TERMOS" na raiz.');
      folder = DriveApp.createFolder("SCE_TERMOS");
    }
    return folder.createFile(blob);
  } catch (e) {
    Logger.log("Erro ao salvar PDF: " + e.message);
    throw new Error(
      "Não foi possível salvar o termo. Verifique a pasta no Drive.",
    );
  }
}

function salvarAnexoBoletim_(base64, mimeType, fileNameOriginal, unidade) {
  try {
    const extensao = fileNameOriginal.includes(".")
      ? fileNameOriginal.split(".").pop()
      : "";
    const extensaoFormatada = extensao ? "." + extensao : "";

    const nomeUnidade = unidade && unidade.trim() ? unidade.trim() : "Unidade";
    const dataHora = formatarDataHoraArquivo();
    const novoNome = `${nomeUnidade} - Boletim de ocorrência - ${dataHora}${extensaoFormatada}`;

    const blob = Utilities.newBlob(
      Utilities.base64Decode(base64),
      mimeType,
      novoNome,
    );

    let folder;
    try {
      folder = DriveApp.getFolderById(CONFIG.BO_FOLDER_ID);
    } catch (e) {
      Logger.log('Pasta BO não encontrada. Criando "SCE_BO" na raiz.');
      folder = DriveApp.createFolder("SCE_BO");
    }
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (e) {
    Logger.log("Erro ao salvar anexo do B.O.: " + e.message);
    throw new Error(
      "Não foi possível salvar o anexo. Verifique a pasta no Drive.",
    );
  }
}

function gerarTermoEmprestimoPdf_(
  emprestimoId,
  itens,
  headers,
  dados,
  unidade,
) {
  const rows = itens
    .map(function (item) {
      return (
        "<tr><td>" +
        escapeHtml_(valueByHeader_(item.row, headers, "patrimonio")) +
        "</td>" +
        "<td>" +
        escapeHtml_(valueByHeader_(item.row, headers, "categoria")) +
        "</td>" +
        "<td>" +
        escapeHtml_(valueByHeader_(item.row, headers, "marca")) +
        "</td>" +
        "<td>" +
        escapeHtml_(valueByHeader_(item.row, headers, "modelo")) +
        "</td>" +
        "<td>" +
        escapeHtml_(valueByHeader_(item.row, headers, "numeroSerie")) +
        "</td></tr>"
      );
    })
    .join("");

  const html =
    "<h2>Termo de empréstimo de equipamentos</h2>" +
    "<p><strong>ID:</strong> " +
    escapeHtml_(emprestimoId) +
    "</p>" +
    "<p><strong>Responsável:</strong> " +
    escapeHtml_(dados.responsavel || "") +
    "</p>" +
    "<p><strong>CPF:</strong> " +
    escapeHtml_(dados.cpf || "") +
    "</p>" +
    "<p><strong>E-mail:</strong> " +
    escapeHtml_(dados.emailResponsavel || "") +
    "</p>" +
    "<p><strong>Data:</strong> " +
    new Date().toLocaleString() +
    "</p>" +
    '<table border="1" cellspacing="0" cellpadding="6"><thead><tr><th>Patrimônio</th><th>Categoria</th><th>Marca</th><th>Modelo</th><th>Série</th></tr></thead><tbody>' +
    rows +
    "</tbody></table>" +
    '<p style="margin-top:32px;">Declaro ter recebido os equipamentos acima e me responsabilizo por sua guarda e devolução.</p>' +
    '<p style="margin-top:64px;">____________________________________<br>Assinatura do responsável</p>';

  const blob = HtmlService.createHtmlOutput(html)
    .getBlob()
    .setName("termo-temp.pdf")
    .getAs(MimeType.PDF);

  const nomeUnidade = unidade && unidade.trim() ? unidade.trim() : "Unidade";
  const dataHora = formatarDataHoraArquivo();
  const idAbreviado = emprestimoId.substring(0, 8);
  const nomeArquivo = `${nomeUnidade} - Termo de Empréstimo - ${dataHora} - ${idAbreviado}.pdf`;

  const file = salvarBlobPdf_(blob, nomeArquivo);
  return { blob: blob, url: file.getUrl() };
}

// ============================================================================
// UTILITÁRIOS GERAIS
// ============================================================================

function valueByHeader_(row, headers, header) {
  const idx = headers.indexOf(header);
  return idx === -1 ? "" : row[idx];
}

function setIfHeaderExists_(row, headers, header, value) {
  const idx = headers.indexOf(header);
  if (idx !== -1) row[idx] = value;
}

function escapeHtml_(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function debugSessoes() {
  const data = sheetsApiGetValues_("Sessoes");
  Logger.log(JSON.stringify(data.slice(0, 3)));
}

function testarToken(token) {
  var user = validarToken(token);
  if (!user) {
    throw new Error("Token inválido ou sessão expirada.");
  }
  return { ok: true, email: user.email };
}
function getEspecificacoesModelo(modelo, token) {
  // 1. Valida o token (obrigatório)
  var session = requireSession_(token);

  // 2. Tenta buscar na aba "Listas" primeiro
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEETS.CORE);
    var sheet = ss.getSheetByName(CONFIG.SHEETS.LISTAS);
    if (sheet) {
      var dados = sheet.getDataRange().getValues();
      if (dados.length > 1) {
        var cabecalho = dados[0];
        var idxModelo = -1,
          idxSO = -1,
          idxProc = -1,
          idxMem = -1,
          idxArm = -1,
          idxTela = -1;
        cabecalho.forEach(function (nome, i) {
          var lower = String(nome).trim().toLowerCase();
          if (lower === "modelo") idxModelo = i;
          else if (lower === "sistemaoperacional") idxSO = i;
          else if (lower === "processador") idxProc = i;
          else if (lower === "memoriaram") idxMem = i;
          else if (lower === "armazenamento") idxArm = i;
          else if (lower === "tamanhotela") idxTela = i;
        });

        if (idxModelo !== -1) {
          var modeloBusca = String(modelo).trim();
          for (var i = 1; i < dados.length; i++) {
            var linha = dados[i];
            var modeloNaLinha = linha[idxModelo]
              ? String(linha[idxModelo]).trim()
              : "";
            if (modeloNaLinha === modeloBusca) {
              Logger.log(
                '✅ Modelo "' + modeloBusca + '" encontrado na aba Listas.',
              );
              return {
                sistemaOperacional:
                  idxSO !== -1 ? String(linha[idxSO] || "").trim() : "",
                processador:
                  idxProc !== -1 ? String(linha[idxProc] || "").trim() : "",
                memoriaRAM:
                  idxMem !== -1 ? String(linha[idxMem] || "").trim() : "",
                armazenamento:
                  idxArm !== -1 ? String(linha[idxArm] || "").trim() : "",
                tamanhoTela:
                  idxTela !== -1 ? String(linha[idxTela] || "").trim() : "",
              };
            }
          }
        }
      }
    }
  } catch (e) {
    Logger.log(
      "⚠️ Erro ao ler aba Listas: " + e.message + ". Usando fallback.",
    );
  }

  // 3. FALLBACK: buscar de equipamentos já cadastrados
  Logger.log(
    '🔍 Buscando modelo "' + modelo + '" nos equipamentos existentes...',
  );
  try {
    var todosEquipamentos = getAllEquipamentos_();
    for (var i = 0; i < todosEquipamentos.length; i++) {
      var eq = todosEquipamentos[i];
      if (eq.modelo && String(eq.modelo).trim() === modelo) {
        Logger.log('✅ Modelo "' + modelo + '" encontrado nos equipamentos.');
        return {
          sistemaOperacional: eq.sistemaOperacional || "",
          processador: eq.processador || "",
          memoriaRAM: eq.memoriaRAM || "",
          armazenamento: eq.armazenamento || "",
          tamanhoTela: eq.tamanhoTela || "",
        };
      }
    }
  } catch (e) {
    Logger.log("❌ Erro no fallback: " + e.message);
  }

  Logger.log('⚠️ Modelo "' + modelo + '" não encontrado em lugar nenhum.');
  return null;
}
