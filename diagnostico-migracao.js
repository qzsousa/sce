import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import 'dotenv/config';

const UNIDADE_ALVO = 'SUMIE'; // ajuste se o nome exato for diferente

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    project_id: process.env.GOOGLE_PROJECT_ID,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

const statusValidos = ['Disponível', 'Manutenção', 'Emprestado', 'Extraviado', 'Inservível', 'Em verificação', 'Quebrado', 'Removido'];
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));

async function main() {
  // 1. Lê a planilha
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_CORE_ID, range: 'Equipamentos' });
  const data = resp.data.values || [];
  const headers = data[0];
  const rows = data.slice(1);
  const idx = (n) => headers.indexOf(n);
  const iUnid = idx('unidade'), iId = idx('id'), iPat = idx('patrimonio'), iSerie = idx('numeroSerie'),
        iStatus = idx('status'), iModelo = idx('modelo');

  console.log(`Planilha: ${rows.length} linhas totais`);

  // Linhas da unidade (busca flexível)
  const alvoUpper = UNIDADE_ALVO.toUpperCase();
  const linhasUnidade = rows.filter(r => String(r[iUnid] || '').toUpperCase().includes(alvoUpper));

  console.log(`Linhas com "${UNIDADE_ALVO}" na unidade: ${linhasUnidade.length}`);

  // Mostra nomes de unidades que contêm SUMIE para conferir nome exato
  const nomesUnicos = [...new Set(rows.map(r => String(r[iUnid] || '')).filter(Boolean))];
  console.log('\nUnidades da planilha que contêm "SUMIE":', nomesUnicos.filter(u => u.toUpperCase().includes(alvoUpper)));

  // 2. Análise de problemas nas linhas da unidade
  const problemas = { idDuplicado: [], idInvalido: 0, patDuplicado: [], serieDuplicada: [], statusInvalido: [] };
  const seenIds = new Map(), seenPat = new Map(), seenSerie = new Map();

  linhasUnidade.forEach((r, i) => {
    const linha = `${i + 2}`; // linha real na planilha (header = linha 1)
    const id = String(r[iId] || '');
    const pat = String(r[iPat] || '').trim();
    const serie = String(r[iSerie] || '').trim();

    if (id && isUuid(id)) {
      if (seenIds.has(id)) problemas.idDuplicado.push(`linha ${linha} duplica id da linha ${seenIds.get(id)}`);
      seenIds.set(id, linha);
    } else if (id) {
      problemas.idInvalido++;
    }
    if (pat) {
      if (seenPat.has(pat)) problemas.patDuplicado.push(`"${pat}" (linhas ${seenPat.get(pat)} e ${linha})`);
      seenPat.set(pat, linha);
    }
    if (serie) {
      if (seenSerie.has(serie)) problemas.serieDuplicada.push(`"${serie}" (linhas ${seenSerie.get(serie)} e ${linha})`);
      seenSerie.set(serie, linha);
    }
    if (!statusValidos.includes(r[iStatus])) problemas.statusInvalido.push(`linha ${linha}: status "${r[iStatus]}"`);
  });

  // 3. Compara com o Supabase
  const { data: noBanco, error } = await supabase
    .from('equipamentos')
    .select('id, patrimonio, numero_serie, modelo, unidade')
    .ilike('unidade', `%${UNIDADE_ALVO}%`);
  if (error) { console.error('Erro Supabase:', error.message); return; }

  console.log(`\nNo Supabase com "${UNIDADE_ALVO}": ${noBanco.length}`);
  console.log(`DIFERENÇA: ${linhasUnidade.length - noBanco.length}`);

  console.log('\n--- PROBLEMAS ENCONTRADOS NA PLANILHA ---');
  console.log('IDs duplicados:', problemas.idDuplicado.length, problemas.idDuplicado.slice(0, 10));
  console.log('IDs não-UUID (receberiam novo id):', problemas.idInvalido);
  console.log('Patrimônios duplicados na planilha:', problemas.patDuplicado.length, problemas.patDuplicado.slice(0, 10));
  console.log('Séries duplicadas na planilha:', problemas.serieDuplicada.length, problemas.serieDuplicada.slice(0, 10));
  console.log('Status inválidos:', problemas.statusInvalido.length, problemas.statusInvalido.slice(0, 10));

  // 4. Patrimônios da planilha que conflitam com OUTRAS unidades já no banco
  const patsPlanilha = [...seenPat.keys()];
  if (patsPlanilha.length) {
    const { data: conflitoPat } = await supabase.from('equipamentos').select('patrimonio, unidade, modelo').in('patrimonio', patsPlanilha);
    const crossPat = (conflitoPat || []).filter(e => !String(e.unidade || '').toUpperCase().includes(alvoUpper));
    if (crossPat.length) {
      console.log('\nPatrimônios da planilha que já existem em OUTRA unidade no banco:');
      crossPat.forEach(e => console.log(`  "${e.patrimonio}" → ${e.unidade} (${e.modelo})`));
    }
  }
  const seriesPlanilha = [...seenSerie.keys()];
  if (seriesPlanilha.length) {
    const { data: conflitoSerie } = await supabase.from('equipamentos').select('numero_serie, unidade, modelo').in('numero_serie', seriesPlanilha);
    const crossSerie = (conflitoSerie || []).filter(e => !String(e.unidade || '').toUpperCase().includes(alvoUpper));
    if (crossSerie.length) {
      console.log('\nNúmeros de série da planilha que já existem em OUTRA unidade no banco:');
      crossSerie.forEach(e => console.log(`  "${e.numero_serie}" → ${e.unidade} (${e.modelo})`));
    }
  }
}

main().catch(e => { console.error('Erro:', e.message); process.exit(1); });
