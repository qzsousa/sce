import { google } from 'googleapis';
import 'dotenv/config';

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    project_id: process.env.GOOGLE_PROJECT_ID,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

const CORE_ID = process.env.SPREADSHEET_CORE_ID;

async function main() {
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: CORE_ID, range: 'Equipamentos' });
  const data = resp.data.values || [];
  if (data.length <= 1) { console.log('Sem dados'); return; }
  const headers = data[0];
  const rows = data.slice(1);

  const idx = (name) => { const i = headers.indexOf(name); return i >= 0 ? i : null; };
  const iId = idx('id'), iPat = idx('patrimonio'), iSerie = idx('numeroSerie');
  const iUnid = idx('unidade'), iCat = idx('categoria'), iMarca = idx('marca'), iModelo = idx('modelo');

  const porPat = new Map(), porSerie = new Map();
  for (const row of rows) {
    const pat = (row[iPat] || '').trim();
    const serie = (row[iSerie] || '').trim();
    if (pat) {
      if (!porPat.has(pat)) porPat.set(pat, []);
      porPat.get(pat).push(row);
    }
    if (serie) {
      if (!porSerie.has(serie)) porSerie.set(serie, []);
      porSerie.get(serie).push(row);
    }
  }

  const info = (r) => `id=${r[iId]} unidade=${r[iUnid] || ''} cat=${r[iCat] || ''} marca=${r[iMarca] || ''} modelo=${r[iModelo] || ''}`;

  console.log('\n=== PATRIMÔNIO duplicado ===');
  for (const [pat, rs] of porPat) {
    if (rs.length > 1) {
      console.log(`\nPatrimônio "${pat}" aparece ${rs.length}x:`);
      rs.forEach(r => console.log('  - ' + info(r)));
    }
  }

  console.log('\n=== NÚMERO DE SÉRIE duplicado ===');
  for (const [s, rs] of porSerie) {
    if (rs.length > 1) {
      console.log(`\nSérie "${s}" aparece ${rs.length}x:`);
      rs.forEach(r => console.log('  - ' + info(r)));
    }
  }
}

main().catch(e => { console.error('Erro:', e.message); process.exit(1); });