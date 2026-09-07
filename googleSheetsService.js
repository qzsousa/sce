import { google } from 'googleapis';
import 'dotenv/config';

class GoogleSheetsService {
  constructor() {
    this.auth = null;
    this.sheets = null;
    this.spreadsheetIds = {
      CORE: process.env.SPREADSHEET_CORE_ID,
      MOVIMENTACAO: process.env.SPREADSHEET_MOVIMENTACAO_ID,
      AUTENTICACAO: process.env.SPREADSHEET_AUTENTICACAO_ID,
    };
    this.sheetNames = {
      EQUIPAMENTOS: 'Equipamentos',
      LISTAS: 'Listas',
      FILIAIS: 'Filiais',
      HISTORICO: 'Historico_Itens',
      EMPRESTIMOS: 'Emprestimos',
      AUDITORIA: 'Auditoria',
      REGISTROS_MANUTENCAO: 'Registros_Manutencao',
      USUARIOS: 'Usuarios',
      SESSOES: 'Sessoes',
      OTP: 'Otp_Codes',
    };
    this.sheetToSpreadsheet = {
      Equipamentos: 'CORE',
      Listas: 'CORE',
      Filiais: 'CORE',
      Historico_Itens: 'MOVIMENTACAO',
      Emprestimos: 'MOVIMENTACAO',
      Auditoria: 'MOVIMENTACAO',
      Registros_Manutencao: 'MOVIMENTACAO',
      Usuarios: 'AUTENTICACAO',
      Sessoes: 'AUTENTICACAO',
      Otp_Codes: 'AUTENTICACAO',
    };
  }

  async initialize() {
    if (this.auth) return;

    const credentials = {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      project_id: process.env.GOOGLE_PROJECT_ID,
    };

    if (!credentials.client_email || !credentials.private_key) {
      throw new Error('Credenciais do Google Service Account não configuradas nas variáveis de ambiente');
    }

    this.auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  getSpreadsheetId(sheetName) {
    const spreadsheetKey = this.sheetToSpreadsheet[sheetName];
    if (!spreadsheetKey) {
      throw new Error(`Nenhuma planilha mapeada para a aba "${sheetName}"`);
    }
    const id = this.spreadsheetIds[spreadsheetKey];
    if (!id) {
      throw new Error(`ID da planilha ${spreadsheetKey} não configurado`);
    }
    return id;
  }

  async getValues(sheetName) {
    await this.initialize();
    const spreadsheetId = this.getSpreadsheetId(sheetName);
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetName,
    });
    return response.data.values || [];
  }

  async getBatchValues(sheetNames) {
    await this.initialize();
    const bySpreadsheet = {};
    for (const name of sheetNames) {
      const id = this.getSpreadsheetId(name);
      if (!bySpreadsheet[id]) bySpreadsheet[id] = [];
      bySpreadsheet[id].push(name);
    }

    const result = {};
    for (const [spreadsheetId, ranges] of Object.entries(bySpreadsheet)) {
      const response = await this.sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
      });
      (response.data.valueRanges || []).forEach((vr, idx) => {
        result[ranges[idx]] = vr.values || [];
      });
    }
    return result;
  }

  async appendRow(sheetName, rowValues) {
    await this.initialize();
    const spreadsheetId = this.getSpreadsheetId(sheetName);
    await this.sheets.spreadsheets.values.append({
      spreadsheetId,
      range: sheetName,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [rowValues] },
    });
  }

  async updateCell(sheetName, row, col, value) {
    await this.initialize();
    const spreadsheetId = this.getSpreadsheetId(sheetName);
    const columnLetter = this.columnToLetter(col);
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!${columnLetter}${row}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[value]] },
    });
  }

  async batchUpdateCells(sheetName, cellUpdates) {
    await this.initialize();
    if (!cellUpdates || cellUpdates.length === 0) return;

    const spreadsheetId = this.getSpreadsheetId(sheetName);
    const data = cellUpdates.map(u => ({
      range: `${sheetName}!${this.columnToLetter(u.col)}${u.row}`,
      values: [[u.value === undefined || u.value === null ? '' : u.value]],
    }));

    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      resource: { valueInputOption: 'USER_ENTERED', data },
    });
  }

  columnToLetter(col) {
    let letter = '';
    while (col > 0) {
      const remainder = (col - 1) % 26;
      letter = String.fromCharCode(65 + remainder) + letter;
      col = Math.floor((col - 1) / 26);
    }
    return letter;
  }

  async deleteRow(sheetName, rowIndex1Based) {
    await this.initialize();
    const spreadsheetId = this.getSpreadsheetId(sheetName);
    const sheetId = await this.getSheetId(sheetName);
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex1Based - 1,
              endIndex: rowIndex1Based,
            },
          },
        }],
      },
    });
  }

  async getSheetId(sheetName) {
    const spreadsheetId = this.getSpreadsheetId(sheetName);
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(sheetId,title))',
    });
    const sheet = response.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) throw new Error(`Aba "${sheetName}" não encontrada`);
    return sheet.properties.sheetId;
  }

  async ensureSheetExists(sheetName, headers) {
    await this.initialize();
    const spreadsheetId = this.getSpreadsheetId(sheetName);
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets(properties(title))',
    });
    const exists = response.data.sheets.some(s => s.properties.title === sheetName);
    if (!exists) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
      });
      await this.appendRow(sheetName, headers);
    }
  }

  findRowIndex(data, idCol, id) {
    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === id) return i + 1;
    }
    return -1;
  }

  parseFiliais(filialRaw) {
    return String(filialRaw || '')
      .split(',')
      .map(f => f.trim())
      .filter(f => f.length > 0);
  }

  sessaoTemAcessoAUnidade(session, unidade) {
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
      const unidadesDaSessao = this.parseFiliais(session.filial).map(f => f.toUpperCase());
      return unidadesDaSessao.includes(unidadeNormalizada);
    }
    return String(unidade).trim().toUpperCase() === String(session.filial).trim().toUpperCase();
  }

  resolverUnidadeParaEscrita(session, unidadeInformada) {
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
      const unidadesTecnico = this.parseFiliais(session.filial);
      if (unidadeInformada) {
        if (!this.sessaoTemAcessoAUnidade(session, unidadeInformada)) {
          throw new Error(`Você não atende a unidade "${unidadeInformada}".`);
        }
        return unidadeInformada;
      }
      if (unidadesTecnico.length === 1) return unidadesTecnico[0];
      throw new Error('Informe para qual unidade este equipamento deve ser cadastrado.');
    }
    return session.filial;
  }
}

export default new GoogleSheetsService();