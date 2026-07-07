/**
 * ============================================================================
 * SCE - Sistema de Controle de Equipamentos
 * Code.gs — núcleo do servidor: roteamento, autenticação e acesso a dados
 * ============================================================================
 *
 * REGRA DE ROTEAMENTO:
 *   Toda decisão de "qual dashboard mostrar" acontece SOMENTE aqui, no doGet.
 *   DashboardFilial.html e DashboardMatriz.html não devem ter lógica de role;
 *   eles assumem que, se foram renderizados, o usuário já é do perfil certo.
 *
 * ARQUITETURA DE SESSÃO:
 *   CacheService tem TTL máximo de 6h, então sessão de 24h fica em uma aba
 *   "Sessoes" na própria planilha (token, email, nivel, filial, criadoEm,
 *   expiraEm). Isso também permite invalidar sessão de um usuário removido
 *   mesmo com token ainda "válido" no localStorage do client.
 */

// ============================================================================
// CONFIGURAÇÃO GLOBAL
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
  var resultado;
  try {
    Logger.log('[testarPlanilhaUI] SPREADSHEET_ID = ' + CONFIG.SPREADSHEET_ID);
    var sheet = getSheet_(CONFIG.SHEETS.EQUIPAMENTOS);
    Logger.log('[testarPlanilhaUI] aba encontrada: ' + sheet.getName());
    var data = sheet.getDataRange().getValues();
    Logger.log('[testarPlanilhaUI] total linhas: ' + data.length);
    resultado = {
      ok: true,
      totalLinhas: data.length,
      cabecalho: data[0],
      primeiraLinha: data[1] || null
    };
  } catch (err) {
    Logger.log('[testarPlanilhaUI] ERRO: ' + err.message);
    resultado = { ok: false, motivo: 'Erro ao ler planilha: ' + err.message };
  }
  Logger.log('[testarPlanilhaUI] retornando: ' + JSON.stringify(resultado));
  return resultado;
}

// Função temporária para testar a sessão
function getSessionByToken_(token) {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEETS.SESSOES);
    if (!sheet) {
      Logger.log("Aba 'Sessoes' não encontrada");
      return null;
    }
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const rows = data.slice(1);
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row[0] === token) {
        // Pega os valores pelas colunas
        const sessionObj = {
          token: row[0],
          email: row[1],
          nivel: row[2],
          filial: row[3],
          criadoEm: row[4],
          expiraEm: row[5]
        };
        // Verifica se expirou
        const agora = Date.now();
        if (sessionObj.expiraEm && sessionObj.expiraEm < agora) {
          Logger.log("Token expirado: " + token);
          return null;
        }
        return sessionObj;
      }
    }
    Logger.log("Token não encontrado: " + token);
    return null;
  } catch (e) {
    Logger.log("Erro em getSessionByToken_: " + e.message);
    return null;
  }
}

// Função temporária para testar a leitura da planilha (pode ser chamada do frontend)
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


const CONFIG = {
  SPREADSHEET_ID: '14JQS8QiogznfTYXTzvlhNfKIaq0bv3aDPGVAZrcCEaM', // SpreadsheetApp.getActiveSpreadsheet() se bound
  SHEETS: {
    EQUIPAMENTOS: 'Equipamentos',
    HISTORICO: 'Historico_Itens',
    USUARIOS: 'Usuarios',
    SESSOES: 'Sessoes',
    OTP: 'Otp_Codes',
    EMPRESTIMOS: 'Emprestimos'
  },
  PDF_FOLDER_ID: '',
  SESSION_DURATION_MS: 24 * 60 * 60 * 1000,   // 24h
  OTP_EXPIRATION_MS: 10 * 60 * 1000,          // 10min
  NIVEIS: {
    MATRIZ: 'Matriz',
    FILIAL: 'Filial'
  },
  STATUS_USUARIO: {
    ATIVO: 'Ativo',
    REMOVIDO: 'Removido'
  }
};

// ============================================================================
// doGet — PONTO ÚNICO DE ROTEAMENTO
// ============================================================================

function doGet(e) {
  try {
    const token = e && e.parameter ? e.parameter.token : null;
    const session = token ? validateSession_(token) : null;

    if (!session) {
      return renderTemplate_('Login');
    }

    if (session.nivel === CONFIG.NIVEIS.MATRIZ) {
      return renderTemplate_('DashboardMatriz', { session: session });
    }

    return renderTemplate_('DashboardFilial', { session: session });
  } catch (err) {
    // Isso vai mostrar o erro VERDADEIRO no navegador
    return HtmlService.createHtmlOutput(
      '<h2 style="color:red;">ERRO NO SERVIDOR</h2>' +
      '<p><strong>Mensagem:</strong> ' + err.message + '</p>' +
      '<p><strong>Stack:</strong> <pre>' + err.stack + '</pre></p>' +
      '<p><em>Verifique o ID da planilha e as permissões.</em></p>'
    );
  }
}

/**
 * Renderiza um template HTML, injetando variáveis via template.<chave>.
 * Usa createTemplateFromFile para permitir <?!= include(...) ?> dentro do HTML.
 */
function renderTemplate_(fileName, vars) {
  const template = HtmlService.createTemplateFromFile(fileName);
  if (vars) {
    Object.keys(vars).forEach(function (key) {
      template[key] = vars[key];
    });
  }
  return template.evaluate()
    .setTitle('SCE - Sistema de Controle de Equipamentos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Permite <?!= include('Shared') ?> dentro de qualquer template HTML.
 */
function include(fileName) {
  try {
    return HtmlService.createHtmlOutputFromFile(fileName).getContent();
  } catch (e) {
    // Se o arquivo não existir, retorna uma string vazia (sem erro)
    return '<!-- Arquivo "' + fileName + '" não encontrado -->';
  }
}

// ============================================================================
// AUTENTICAÇÃO — OTP (One-Time Password)
// ============================================================================

/**
 * Gera um código de 6 dígitos, salva na aba Otp_Codes com expiração,
 * e envia por e-mail. Chamado pelo Login.html via google.script.run.
 *
 * @param {string} email
 * @return {{ok: boolean, message: string}}
 */
function requestOtp(email) {
  // Log inicial: se aparecer no console do Apps Script, sabemos que a função foi chamada.
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
    console.log('Código gerado:', code);

    // Tenta salvar o OTP
    try {
      const sheet = getSheet_(CONFIG.SHEETS.OTP);
      upsertOtpRow_(sheet, email, code, now, now + CONFIG.OTP_EXPIRATION_MS);
      console.log('OTP salvo na planilha com sucesso.');
    } catch (sheetError) {
      console.error('Erro ao salvar OTP na planilha:', sheetError.message);
      return { ok: false, message: 'Erro ao salvar código: ' + sheetError.message };
    }

    // Tenta enviar e-mail
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

/**
 * Valida o código informado. Se correto e não expirado, cria sessão de 24h
 * e retorna a URL (com token) para o client redirecionar via top.location.href.
 *
 * @param {string} email
 * @param {string} code
 * @return {{ok: boolean, message: string, redirectUrl: string}}
 */
function validateOtp(email, code) {
  email = String(email || '').trim().toLowerCase();
  code = String(code || '').trim();

  const usuario = findUsuarioByEmail_(email);
  // Checagem obrigatória aqui também, mesmo que já tenha sido checada no
  // requestOtp — usuário pode ter sido removido entre o pedido e a validação.
  if (!usuario || usuario.status === CONFIG.STATUS_USUARIO.REMOVIDO) {
    return { ok: false, message: 'Acesso não autorizado para este e-mail.' };
  }

  const otpSheet = getSheet_(CONFIG.SHEETS.OTP);
  const otpRow = findOtpRow_(otpSheet, email);
  if (!otpRow) {
    return { ok: false, message: 'Nenhum código pendente para este e-mail.' };
  }
  if (Date.now() > otpRow.expiraEm) {
    return { ok: false, message: 'Código expirado. Solicite um novo.' };
  }
  if (String(otpRow.code) !== code) {
    return { ok: false, message: 'Código incorreto.' };
  }

  deleteOtpRow_(otpSheet, otpRow.rowIndex);

  const session = createSession_(usuario);
  const url = ScriptApp.getService().getUrl() + '?token=' + encodeURIComponent(session.token);
  return { ok: true, message: 'Login realizado com sucesso.', redirectUrl: url };
}

function sendOtpEmail_(email, code) {
  MailApp.sendEmail({
    to: email,
    subject: 'SCE - Código de acesso',
    body:
      'Seu código de acesso ao SCE é: ' + code + '\n\n' +
      'Ele expira em 10 minutos. Se você não solicitou este código, ignore este e-mail.'
  });
}

// ============================================================================
// SESSÃO (aba Sessoes)
// ============================================================================

/**
 * Cria uma sessão de 24h para o usuário autenticado e grava na aba Sessoes.
 * @return {{token:string, email:string, nivel:string, filial:string}}
 */
function createSession_(usuario) {
  const token = Utilities.getUuid();
  const now = Date.now();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_(CONFIG.SHEETS.SESSOES);
    sheet.appendRow([
      token,
      usuario.email,
      usuario.nivel,
      usuario.filial,
      now,
      now + CONFIG.SESSION_DURATION_MS
    ]);
  } finally {
    lock.releaseLock();
  }

  return {
    token: token,
    email: usuario.email,
    nivel: usuario.nivel,
    filial: usuario.filial
  };
}

/**
 * Valida token de sessão: existe, não expirou, e o usuário associado ainda
 * está Ativo (checagem obrigatória — sessão salva localmente não basta).
 *
 * @return {Object|null} sessão válida ou null
 */
function validateSession_(token) {
  if (!token) return null;

  const sheet = getSheet_(CONFIG.SHEETS.SESSOES);
  const data = sheet.getDataRange().getValues();
  // Colunas: token(0) | email(1) | nivel(2) | filial(3) | criadoEm(4) | expiraEm(5)
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i][0] === token) {
      const expiraEm = data[i][5];
      if (Date.now() > expiraEm) return null;

      const usuario = findUsuarioByEmail_(data[i][1]);
      if (!usuario || usuario.status === CONFIG.STATUS_USUARIO.REMOVIDO) {
        return null;
      }

      return {
        token: token,
        email: data[i][1],
        nivel: data[i][2],
        filial: data[i][3]
      };
    }
  }
  return null;
}

/**
 * Ponto único de validação server-side para qualquer função sensível.
 * Toda função chamada via google.script.run que faz escrita ou leitura
 * privilegiada deve chamar isto ANTES de qualquer outra coisa — nunca
 * confiar apenas em validação feita no client.
 *
 * @param {string} token
 * @param {string} [nivelExigido] Se informado, exige esse nível exato.
 * @return {Object} sessão válida
 * @throws {Error} se sessão inválida ou nível insuficiente
 */
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
// ACESSO A DADOS — USUÁRIOS
// ============================================================================

/**
 * Estrutura esperada da aba Usuarios:
 * email(0) | nome(1) | nivel(2) | filial(3) | status(4) | dataRemocao(5)
 */
function findUsuarioByEmail_(email) {
  const sheet = getSheet_(CONFIG.SHEETS.USUARIOS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) { // i=1 pula cabeçalho
    if (String(data[i][0]).trim().toLowerCase() === email) {
      return {
        rowIndex: i + 1, // 1-based, para uso com getRange
        email: data[i][0],
        nome: data[i][1],
        nivel: data[i][2],
        filial: data[i][3],
        status: data[i][4],
        dataRemocao: data[i][5]
      };
    }
  }
  return null;
}

// ============================================================================
// ACESSO A DADOS — OTP (aba auxiliar Otp_Codes)
// ============================================================================

/**
 * Estrutura esperada da aba Otp_Codes: email(0) | code(1) | criadoEm(2) | expiraEm(3)
 * Uma linha por e-mail — upsert substitui código anterior se já existir um pendente.
 */
function upsertOtpRow_(sheet, email, code, criadoEm, expiraEm) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === email) {
      sheet.getRange(i + 1, 1, 1, 4).setValues([[email, code, criadoEm, expiraEm]]);
      return;
    }
  }
  sheet.appendRow([email, code, criadoEm, expiraEm]);
}

function findOtpRow_(sheet, email) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === email) {
      return {
        rowIndex: i + 1,
        email: data[i][0],
        code: data[i][1],
        criadoEm: data[i][2],
        expiraEm: data[i][3]
      };
    }
  }
  return null;
}

function deleteOtpRow_(sheet, rowIndex) {
  sheet.deleteRow(rowIndex);
}

// ============================================================================
// ACESSO A DADOS — EQUIPAMENTOS (base para as próximas etapas)
// ============================================================================

/**
 * Lê toda a aba Equipamentos em lote (1 chamada de leitura) e converte para
 * array de objetos usando o cabeçalho. NUNCA iterar célula a célula.
 *
 * @return {Array<Object>}
 */
function getAllEquipamentos_() {
  const sheet = getSheet_(CONFIG.SHEETS.EQUIPAMENTOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  return rows.map(function (row, idx) {
    const obj = { _rowIndex: idx + 2 }; // linha real na planilha (1-based + cabeçalho)
    headers.forEach(function (header, colIdx) {
      obj[header] = row[colIdx];
    });
    return obj;
  });
}

/**
 * Retorna equipamentos filtrados por unidade (perfil Filial) já validando
 * sessão. Exclui itens com status "Removido" (soft-delete).
 *
 * @param {string} token
 * @return {Array<Object>}
 */
function getEquipamentosDaFilial(token) {
  try {
    // 1. Obtém a sessão
    const session = requireSession_(token);
    if (!session) {
      Logger.log("Sessão não encontrada");
      return [];
    }

    const filial = session.nivel === CONFIG.NIVEIS.MATRIZ ? null : session.filial;
    Logger.log("Filial: " + filial);

    // 2. Obtém todos os equipamentos
    const todos = getAllEquipamentos_();
    if (!todos) {
      Logger.log("Nenhum equipamento encontrado");
      return [];
    }
    Logger.log("Total bruto: " + todos.length);

    // 3. Aplica o filtro
    const filtrados = todos.filter(function (item) {
      const naoRemovido = item['status'] !== 'Removido';
      let pertenceAFilial = true;
      if (filial) {
        const unidadeItem = (item['unidade'] || '').trim().toUpperCase();
        const filialNormalizada = filial.trim().toUpperCase();
        pertenceAFilial = unidadeItem === filialNormalizada;
      }
      return naoRemovido && pertenceAFilial;
    });

    Logger.log("Filtrados: " + filtrados.length);

    // Converte para JSON e volta para objeto
    // Isso remove qualquer data (Date), função ou referência circular
    // que possa estar causando o erro de serialização.
    const jsonString = JSON.stringify(filtrados);
    return JSON.parse(jsonString);

  } catch (e) {
    Logger.log("ERRO CRÍTICO: " + e.message);
    Logger.log("Stack: " + e.stack);
    return [];
  }
}
/**
 * Retorna TODOS os equipamentos de TODAS as unidades — restrito à Matriz.
 * Exclui soft-deleted por padrão; passar incluirRemovidos=true para auditoria.
 *
 * @param {string} token
 * @param {boolean} [incluirRemovidos]
 * @return {Array<Object>}
 */
function getEquipamentosGlobal(token, incluirRemovidos) {
  try {
    // 1. Obtém a sessão (sem validação de nível aqui)
    const session = requireSession_(token);
    if (!session) {
      Logger.log("Sessão inválida para token: " + token);
      return [];
    }

    // 2. Verifica se o nível é Matriz
    const nivel = session.nivel || '';
    const isMatriz = nivel.trim().toUpperCase() === (CONFIG.NIVEIS.MATRIZ || 'MATRIZ').trim().toUpperCase();

    if (!isMatriz) {
      Logger.log("Usuário não é Matriz. Nível: " + nivel);
      return []; // Retorna array vazio, não null
    }

    Logger.log("Usuário Matriz autenticado: " + session.email);

    // 3. Obtém todos os equipamentos
    const todos = getAllEquipamentos_();
    if (!todos || !Array.isArray(todos)) {
      Logger.log("Falha ao ler equipamentos");
      return [];
    }

    Logger.log("Total bruto: " + todos.length);

    // 4. Filtra removidos, se necessário
    const filtrados = todos.filter(function (item) {
      return incluirRemovidos ? true : item['status'] !== 'Removido';
    });

    Logger.log("Filtrados (Removidos " + (incluirRemovidos ? 'incluídos' : 'excluídos') + "): " + filtrados.length);

    // 5. Serialização forçada (evita problemas com Date)
    const jsonString = JSON.stringify(filtrados);
    return JSON.parse(jsonString);

  } catch (e) {
    Logger.log("ERRO CRÍTICO em getEquipamentosGlobal: " + e.message);
    return [];
  }
}

/**
 * Cria um novo equipamento. Filial só pode criar para a própria unidade
 * (o campo "unidade" é sempre sobrescrito pela sessão, nunca confiado
 * no payload do client — evita que uma filial cadastre em nome de outra).
 * Matriz pode informar a unidade explicitamente.
 *
 * @param {string} token
 * @param {Object} dadosEquipamento objeto com as ~22 colunas (parcial é ok;
 *   colunas ausentes ficam vazias)
 * @return {{ok:boolean, id:string}}
 */
function createEquipamento(token, dadosEquipamento) {
  const session = requireSession_(token);
  const unidade = session.nivel === CONFIG.NIVEIS.MATRIZ
    ? (dadosEquipamento.unidade || session.filial)
    : session.filial;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_(CONFIG.SHEETS.EQUIPAMENTOS);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    const id = Utilities.getUuid();
    const now = new Date();
    const linha = headers.map(function (header) {
      if (header === 'id') return id;
      if (header === 'unidade') return unidade;
      if (header === 'status') return dadosEquipamento.status || 'Disponível';
      if (header === 'dataCadastro') return now;
      if (header === 'dataUltimaAtualizacao') return now;
      if (header === 'cadastradoPor') return session.email;
      if (header in dadosEquipamento) return dadosEquipamento[header];
      return '';
    });

    sheet.appendRow(linha);
    registrarHistorico_(id, 'criação', '', 'Equipamento cadastrado', session.email);

    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Atualiza campos de um equipamento existente. Grava um item de histórico
 * por campo alterado (não um log genérico), o que facilita auditoria fina.
 *
 * Filial só pode editar equipamento da própria unidade — checagem feita
 * server-side, nunca confiando que o client só mostrou os itens certos.
 *
 * @param {string} token
 * @param {string} id
 * @param {Object} camposAlterados apenas os campos que mudaram
 */
function updateEquipamento(token, id, camposAlterados) {
  const session = requireSession_(token);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_(CONFIG.SHEETS.EQUIPAMENTOS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const unidadeCol = headers.indexOf('unidade');

    const rowIndex = findRowIndexById_(data, idCol, id);
    if (rowIndex === -1) throw new Error('Equipamento não encontrado.');

    const linhaAtual = data[rowIndex - 1];
    if (session.nivel !== CONFIG.NIVEIS.MATRIZ && linhaAtual[unidadeCol] !== session.filial) {
      throw new Error('Você não tem permissão para editar este equipamento.');
    }

    // Status especiais exigem um campo de justificativa preenchido — ou já
    // presente na linha, ou vindo junto no mesmo payload de alteração.
    validarStatusEspecial_(camposAlterados, linhaAtual, headers);

    Object.keys(camposAlterados).forEach(function (campo) {
      const colIndex = headers.indexOf(campo);
      if (campo === 'id' || campo === 'dataCadastro' || campo === 'cadastradoPor') return;
      if (colIndex === -1) return; // ignora campos desconhecidos, não quebra a escrita

      const valorAntigo = linhaAtual[colIndex];
      const valorNovo = camposAlterados[campo];
      if (String(valorAntigo) === String(valorNovo)) return; // sem mudança real, sem log

      sheet.getRange(rowIndex, colIndex + 1).setValue(valorNovo);
      registrarHistorico_(id, campo, valorAntigo, valorNovo, session.email);
    });

    const atualizadoCol = headers.indexOf('dataUltimaAtualizacao');
    if (atualizadoCol !== -1) {
      sheet.getRange(rowIndex, atualizadoCol + 1).setValue(new Date());
    }

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Clona um equipamento existente (mesmos dados, novo id, status resetado
 * para "Disponível", histórico próprio começando do zero). Útil para
 * cadastro em lote de itens idênticos (ex: 20 notebooks do mesmo modelo).
 *
 * @param {string} token
 * @param {string} idOrigem
 * @return {{ok:boolean, id:string}}
 */
function cloneEquipamento(token, idOrigem) {
  const session = requireSession_(token);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_(CONFIG.SHEETS.EQUIPAMENTOS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const unidadeCol = headers.indexOf('unidade');
    const statusCol = headers.indexOf('status');

    const rowIndex = findRowIndexById_(data, idCol, idOrigem);
    if (rowIndex === -1) throw new Error('Equipamento não encontrado.');

    const linhaOrigem = data[rowIndex - 1];
    if (session.nivel !== CONFIG.NIVEIS.MATRIZ && linhaOrigem[unidadeCol] !== session.filial) {
      throw new Error('Você não tem permissão para clonar este equipamento.');
    }

    const novoId = Utilities.getUuid();
    const novaLinha = linhaOrigem.slice();
    novaLinha[idCol] = novoId;
    novaLinha[statusCol] = 'Disponível';

    setIfHeaderExists_(novaLinha, headers, 'dataCadastro', new Date());
    setIfHeaderExists_(novaLinha, headers, 'dataUltimaAtualizacao', new Date());
    setIfHeaderExists_(novaLinha, headers, 'cadastradoPor', session.email);
    sheet.appendRow(novaLinha);
    registrarHistorico_(novoId, 'criação', '', 'Clonado a partir de ' + idOrigem, session.email);

    return { ok: true, id: novoId };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Soft-delete de equipamento: nunca apaga a linha, apenas marca status
 * como "Removido". Mesmo padrão usado em removerUsuario. Restrito por
 * unidade para Filial; Matriz pode remover qualquer item.
 *
 * @param {string} token
 * @param {string} id
 */
function removerEquipamento(token, id) {
  const session = requireSession_(token);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_(CONFIG.SHEETS.EQUIPAMENTOS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const unidadeCol = headers.indexOf('unidade');
    const statusCol = headers.indexOf('status');

    const rowIndex = findRowIndexById_(data, idCol, id);
    if (rowIndex === -1) throw new Error('Equipamento não encontrado.');

    const linhaAtual = data[rowIndex - 1];
    if (session.nivel !== CONFIG.NIVEIS.MATRIZ && linhaAtual[unidadeCol] !== session.filial) {
      throw new Error('Você não tem permissão para remover este equipamento.');
    }

    const statusAntigo = linhaAtual[statusCol];
    sheet.getRange(rowIndex, statusCol + 1).setValue('Removido');
    registrarHistorico_(id, 'status', statusAntigo, 'Removido', session.email);

    return { ok: true, message: 'Equipamento removido (soft-delete).' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Regras de aprovação por status especial (do MVP original):
 *   Manutenção     -> exige numeroChamadoManutencao
 *   Extraviado     -> exige boletimOcorrencia
 *   Em verificação -> exige justificativaVerificacao
 *
 * Aceita o valor tanto se já existir na linha atual quanto se estiver
 * chegando junto no mesmo payload (permite setar status + justificativa
 * numa única chamada de updateEquipamento).
 *
 * @throws {Error} se o status exigir um campo que está ausente/vazio
 */
function validarStatusEspecial_(camposAlterados, linhaAtual, headers) {
  if (!('status' in camposAlterados)) return;

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
    throw new Error(
      'Para alterar o status para "' + novoStatus + '", o campo "' +
      campoObrigatorio + '" é obrigatório.'
    );
  }
}

/**
 * Localiza o índice de linha (1-based, considerando cabeçalho) de um
 * equipamento pelo id, a partir de uma matriz de dados já carregada.
 * Evita releitura da planilha quando quem chama já tem `data` em mãos.
 */
function findRowIndexById_(data, idCol, id) {
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) return i + 1;
  }
  return -1;
}

// ============================================================================
// HISTÓRICO (aba Historico_Itens)
// ============================================================================

/**
 * Registra uma linha de histórico por alteração. Estrutura esperada da
 * aba Historico_Itens: equipamentoId | campo | valorAntigo | valorNovo |
 * autor | data
 *
 * Chamada internamente por create/update/clone/remover — não expor
 * diretamente via google.script.run, pois não deve ser gravável pelo client.
 */
function registrarHistorico_(equipamentoId, campo, valorAntigo, valorNovo, autor) {
  const sheet = getSheet_(CONFIG.SHEETS.HISTORICO);
  sheet.appendRow([equipamentoId, campo, valorAntigo, valorNovo, autor, new Date()]);
}

/**
 * Retorna o histórico completo de um equipamento (mais recente primeiro).
 * Filial só pode consultar histórico de item da própria unidade.
 *
 * @param {string} token
 * @param {string} equipamentoId
 * @return {Array<Object>}
 */
function getHistoricoEquipamento(token, equipamentoId) {
  const session = requireSession_(token);

  // Confirma que o equipamento pertence à unidade do solicitante (Filial)
  if (session.nivel !== CONFIG.NIVEIS.MATRIZ) {
    const equipamentos = getAllEquipamentos_();
    const item = equipamentos.filter(function (e) { return e.id === equipamentoId; })[0];
    if (!item || item.unidade !== session.filial) {
      throw new Error('Você não tem permissão para ver este histórico.');
    }
  }

  const sheet = getSheet_(CONFIG.SHEETS.HISTORICO);
  const data = sheet.getDataRange().getValues();
  return data.slice(1)
    .filter(function (row) { return row[0] === equipamentoId; })
    .map(function (row) {
      return {
        equipamentoId: row[0],
        campo: row[1],
        valorAntigo: row[2],
        valorNovo: row[3],
        autor: row[4],
        data: row[5]
      };
    })
    .reverse();
}

// TODO (próxima etapa): fluxo de empréstimo/devolução + geração de PDF via Docs template
// TODO (próxima etapa): exportarEquipamentosCSV(token), exportarEquipamentosPDF(token)

// ============================================================================
// ACESSO A DADOS — GESTÃO DE USUÁRIOS (restrito à Matriz)
// ============================================================================

/**
 * Lista usuários (visão administrativa). Restrito à Matriz.
 * @param {string} token
 * @return {Array<Object>}
 */
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
    const eqSheet = getSheet_(CONFIG.SHEETS.EQUIPAMENTOS);
    const eqData = eqSheet.getDataRange().getValues();
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
      if (session.nivel !== CONFIG.NIVEIS.MATRIZ && row[unidadeCol] !== session.filial) {
        throw new Error('Voce nao tem permissao para emprestar o equipamento ' + id + '.');
      }
      if (row[statusCol] === 'Removido') throw new Error('Equipamento removido nao pode ser emprestado.');
      if (row[statusCol] === 'Emprestado') throw new Error('Equipamento ja esta emprestado.');
      return { rowIndex: rowIndex, row: row, id: id };
    });

    const emprestimoId = Utilities.getUuid();
    const now = new Date();
    const termo = gerarTermoEmprestimoPdf_(emprestimoId, itens, headers, dadosEmprestimo);
    const empSheet = getEmprestimosSheet_();

    itens.forEach(function (item) {
      empSheet.appendRow([
        emprestimoId,
        item.id,
        valueByHeader_(item.row, headers, 'patrimonio'),
        valueByHeader_(item.row, headers, 'unidade'),
        dadosEmprestimo.responsavel || '',
        dadosEmprestimo.cpf || '',
        dadosEmprestimo.emailResponsavel || '',
        now,
        dadosEmprestimo.dataPrevistaDevolucao || '',
        '',
        'Aberto',
        termo.url || '',
        session.email,
        '',
        dadosEmprestimo.observacoes || ''
      ]);

      if (statusCol !== -1) eqSheet.getRange(item.rowIndex, statusCol + 1).setValue('Emprestado');
      if (responsavelCol !== -1) eqSheet.getRange(item.rowIndex, responsavelCol + 1).setValue(dadosEmprestimo.responsavel || '');
      if (dataAtribCol !== -1) eqSheet.getRange(item.rowIndex, dataAtribCol + 1).setValue(now);
      if (atualizadoCol !== -1) eqSheet.getRange(item.rowIndex, atualizadoCol + 1).setValue(now);
      registrarHistorico_(item.id, 'status', valueByHeader_(item.row, headers, 'status'), 'Emprestado', session.email);
    });

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
    const eqSheet = getSheet_(CONFIG.SHEETS.EQUIPAMENTOS);
    const eqData = eqSheet.getDataRange().getValues();
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
      if (session.nivel !== CONFIG.NIVEIS.MATRIZ && row[unidadeCol] !== session.filial) {
        throw new Error('Voce nao tem permissao para devolver o equipamento ' + id + '.');
      }
      if (statusCol !== -1) eqSheet.getRange(rowIndex, statusCol + 1).setValue('Disponivel');
      if (responsavelCol !== -1) eqSheet.getRange(rowIndex, responsavelCol + 1).setValue('');
      if (dataAtribCol !== -1) eqSheet.getRange(rowIndex, dataAtribCol + 1).setValue('');
      if (atualizadoCol !== -1) eqSheet.getRange(rowIndex, atualizadoCol + 1).setValue(now);
      registrarHistorico_(id, 'status', valueByHeader_(row, headers, 'status'), 'Disponivel', session.email);
      fecharEmprestimoAberto_(id, session.email, now, observacoes || '');
    });

    return { ok: true, message: 'Devolucao registrada.' };
  } finally {
    lock.releaseLock();
  }
}

function exportarEquipamentosPDF(token, filtros) {
  const session = requireSession_(token, CONFIG.NIVEIS.MATRIZ);
  const equipamentos = filtrarEquipamentosParaExport_(getEquipamentosGlobal(token, false), filtros || {});
  const html = '<h2>SCE - Relatorio de equipamentos</h2>' +
    '<p>Gerado por ' + escapeHtml_(session.email) + ' em ' + new Date().toLocaleString() + '</p>' +
    montarTabelaHtmlEquipamentos_(equipamentos);
  const blob = HtmlService.createHtmlOutput(html).getBlob().setName('sce-equipamentos.pdf').getAs(MimeType.PDF);
  const file = salvarBlobPdf_(blob, 'sce-equipamentos-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') + '.pdf');
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
      '</td><td>' + escapeHtml_(item.patrimonio) + '</td><td>' + escapeHtml_(item.status) + '</td></tr>';
  }).join('');
  return '<table border="1" cellspacing="0" cellpadding="5"><thead><tr><th>Unidade</th><th>Categoria</th><th>Marca</th><th>Modelo</th><th>Patrimonio</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function listarUsuarios(token) {
  requireSession_(token, CONFIG.NIVEIS.MATRIZ);

  const sheet = getSheet_(CONFIG.SHEETS.USUARIOS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

/**
 * Adiciona um novo usuário. Restrito à Matriz. Usa LockService pois múltiplas
 * unidades/admins podem estar cadastrando usuários ao mesmo tempo.
 *
 * @param {string} token
 * @param {{email:string, nome:string, nivel:string, filial:string}} novoUsuario
 */
function adicionarUsuario(token, novoUsuario) {
  requireSession_(token, CONFIG.NIVEIS.MATRIZ);

  const email = String(novoUsuario.email || '').trim().toLowerCase();
  if (!email) throw new Error('E-mail é obrigatório.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (findUsuarioByEmail_(email)) {
      throw new Error('Já existe um usuário com este e-mail.');
    }
    const sheet = getSheet_(CONFIG.SHEETS.USUARIOS);
    sheet.appendRow([
      email,
      novoUsuario.nome || '',
      novoUsuario.nivel || CONFIG.NIVEIS.FILIAL,
      novoUsuario.filial || '',
      CONFIG.STATUS_USUARIO.ATIVO,
      ''
    ]);
  } finally {
    lock.releaseLock();
  }

  return { ok: true, message: 'Usuário adicionado.' };
}

/**
 * Soft-delete de usuário: nunca apaga a linha, apenas marca status +
 * dataRemocao. Restrito à Matriz. Protegido por LockService.
 *
 * @param {string} token
 * @param {string} emailParaRemover
 */
function removerUsuario(token, emailParaRemover) {
  requireSession_(token, CONFIG.NIVEIS.MATRIZ);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const usuario = findUsuarioByEmail_(String(emailParaRemover).trim().toLowerCase());
    if (!usuario) throw new Error('Usuário não encontrado.');

    const sheet = getSheet_(CONFIG.SHEETS.USUARIOS);
    sheet.getRange(usuario.rowIndex, 5, 1, 2).setValues([
      [CONFIG.STATUS_USUARIO.REMOVIDO, new Date()]
    ]);
  } finally {
    lock.releaseLock();
  }

  return { ok: true, message: 'Usuário removido (soft-delete).' };
}

// ============================================================================
// UTILITÁRIOS DE PLANILHA
// ============================================================================

function getSpreadsheet_() {
  return CONFIG.SPREADSHEET_ID && CONFIG.SPREADSHEET_ID !== 'COLOQUE_O_ID_DA_PLANILHA_AQUI'
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(sheetName) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Aba "' + sheetName + '" não encontrada na planilha.');
  }
  return sheet;
}

function getEmprestimosSheet_() {
  const headers = [
    'id', 'equipamentoId', 'patrimonio', 'unidade', 'responsavel', 'cpf',
    'emailResponsavel', 'dataEmprestimo', 'dataPrevistaDevolucao',
    'dataDevolucao', 'status', 'termoPdfUrl', 'criadoPor', 'devolvidoPor',
    'observacoes'
  ];
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(CONFIG.SHEETS.EMPRESTIMOS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.EMPRESTIMOS);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function fecharEmprestimoAberto_(equipamentoId, devolvidoPor, dataDevolucao, observacoes) {
  const sheet = getEmprestimosSheet_();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const equipamentoCol = headers.indexOf('equipamentoId');
  const statusCol = headers.indexOf('status');
  const dataDevCol = headers.indexOf('dataDevolucao');
  const devolvidoPorCol = headers.indexOf('devolvidoPor');
  const obsCol = headers.indexOf('observacoes');

  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][equipamentoCol] === equipamentoId && data[i][statusCol] === 'Aberto') {
      sheet.getRange(i + 1, statusCol + 1).setValue('Devolvido');
      if (dataDevCol !== -1) sheet.getRange(i + 1, dataDevCol + 1).setValue(dataDevolucao);
      if (devolvidoPorCol !== -1) sheet.getRange(i + 1, devolvidoPorCol + 1).setValue(devolvidoPor);
      if (obsCol !== -1 && observacoes) sheet.getRange(i + 1, obsCol + 1).setValue(observacoes);
      return;
    }
  }
}

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
