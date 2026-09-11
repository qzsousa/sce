import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import 'dotenv/config';
import { randomUUID } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Config Google Sheets
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    project_id: process.env.GOOGLE_PROJECT_ID,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

const SPREADSHEETS = {
  CORE: process.env.SPREADSHEET_CORE_ID,
  MOVIMENTACAO: process.env.SPREADSHEET_MOVIMENTACAO_ID,
  AUTENTICACAO: process.env.SPREADSHEET_AUTENTICACAO_ID,
};

async function getSheetValues(spreadsheetKey, range) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEETS[spreadsheetKey],
    range,
  });
  return response.data.values || [];
}

async function migrate() {
  console.log('🚀 Iniciando migração Google Sheets → Supabase...\n');

  try {
    // ---------- 1. USUARIOS ----------
    console.log('📥 Migrando usuários...');
    const usuariosData = await getSheetValues('AUTENTICACAO', 'Usuarios');
    if (usuariosData.length > 1) {
      const headers = usuariosData[0];
      const rows = usuariosData.slice(1);
      for (const row of rows) {
        const [email, nome, nivel, filial, status, dataRemocao] = row;
        if (!email) continue;
        const { error } = await supabase.from('usuarios').upsert({
          email: email.trim().toLowerCase(),
          nome: nome?.trim() || '',
          nivel: nivel?.trim() || 'Filial',
          filial: filial?.trim() || '',
          status: status?.trim() || 'Ativo',
          data_remocao: dataRemocao ? new Date(dataRemocao).toISOString() : null,
          senha_definida: false,
        }, { onConflict: 'email' });
        if (error) console.error(`  ⚠️ ${email}:`, error.message);
      }
      console.log(`  ✅ ${rows.length} usuários processados`);
    }

    // ---------- 2. FILIAIS ----------
    console.log('📥 Migrando filiais...');
    const filiaisData = await getSheetValues('CORE', 'Filiais');
    if (filiaisData.length > 1) {
      const rows = filiaisData.slice(1);
      for (const row of rows) {
        const nome = row[0]?.trim();
        if (!nome) continue;
        const { error } = await supabase.from('filiais').upsert({ nome }, { onConflict: 'nome' });
        if (error) console.error(`  ⚠️ ${nome}:`, error.message);
      }
      console.log(`  ✅ ${rows.length} filiais processadas`);
    }

    // ---------- 3. LISTAS (categoria, marca, modelo) ----------
    console.log('📥 Migrando listas (categoria/marca/modelo)...');
    const listasData = await getSheetValues('CORE', 'Listas');
    if (listasData.length > 1) {
      const headers = listasData[0];
      const idxCat = headers.indexOf('categoria') >= 0 ? headers.indexOf('categoria') : 0;
      const idxMarca = headers.indexOf('marca') >= 0 ? headers.indexOf('marca') : 1;
      const idxModelo = headers.indexOf('modelo') >= 0 ? headers.indexOf('modelo') : 2;
      const rows = listasData.slice(1);
      let count = 0;
      for (const row of rows) {
        const categoria = row[idxCat]?.trim();
        const marca = row[idxMarca]?.trim();
        const modelo = row[idxModelo]?.trim();
        if (!categoria || !marca || !modelo) continue;
        const { error } = await supabase.from('listas').upsert({
          categoria, marca, modelo
        }, { onConflict: 'categoria,marca,modelo' });
        if (error) console.error(`  ⚠️ ${categoria}/${marca}/${modelo}:`, error.message);
        count++;
      }
      console.log(`  ✅ ${count} combinações processadas`);
    }

    // ---------- 4. EQUIPAMENTOS ----------
    console.log('📥 Migrando equipamentos (pode demorar)...');
    const equipData = await getSheetValues('CORE', 'Equipamentos');
    if (equipData.length > 1) {
      const headers = equipData[0];
      const rows = equipData.slice(1);
      let success = 0, errors = 0;
      for (const row of rows) {
        const obj = {};
        headers.forEach((h, i) => obj[h] = row[i] || '');
        if (!obj.id) obj.id = randomUUID();

        const equip = {
          id: obj.id,
          unidade: obj.unidade,
          categoria: obj.categoria,
          marca: obj.marca,
          modelo: obj.modelo,
          patrimonio: obj.patrimonio || null,
          numero_serie: obj.numeroSerie || null,
          status: obj.status || 'Disponível',
          status_manutencao: obj.statusManutencao || null,
          vinculado_blue_monitor: obj.vinculadoBlueMonitor || 'Não',
          numero_chamado_manutencao: obj.numeroChamadoManutencao || null,
          boletim_ocorrencia: obj.boletimOcorrencia || null,
          justificativa_verificacao: obj.justificativaVerificacao || null,
          descricao_quebrado: obj.descricaoQuebrado || null,
          sistema_operacional: obj.sistemaOperacional || null,
          processador: obj.processador || null,
          memoria_ram: obj.memoriaRAM || null,
          armazenamento: obj.armazenamento || null,
          tamanho_tela: obj.tamanhoTela || null,
          responsavel_atual: obj.responsavelAtual || null,
          observacoes: obj.observacoes || null,
          data_cadastro: obj.dataCadastro ? new Date(obj.dataCadastro).toISOString() : new Date().toISOString(),
          data_ultima_atualizacao: obj.dataUltimaAtualizacao ? new Date(obj.dataUltimaAtualizacao).toISOString() : new Date().toISOString(),
          cadastrado_por: obj.cadastradoPor || 'migracao',
          ultima_alteracao_por: obj.ultimaAlteracaoPor || 'migracao',
          justificativa_patrimonio: obj.justificativaPatrimonio || null,
          justificativa_numero_serie: obj.justificativaNumeroSerie || null,
          boletim_ocorrencia_anexo_url: obj.boletimOcorrenciaAnexoUrl || null,
          tipo_emprestimo: obj.tipoEmprestimo || null,
          escola_destino: obj.escolaDestino || null,
        };

        const { error } = await supabase.from('equipamentos').upsert(equip, { onConflict: 'id' });
        if (error) { console.error(`  ⚠️ ${obj.id}:`, error.message); errors++; }
        else success++;
      }
      console.log(`  ✅ ${success} equipamentos migrados, ${errors} erros`);
    }

    // Movimentação (histórico, empréstimos, manutenções, auditoria) NÃO será migrada.

    console.log('\n🎉 Migração concluída com sucesso!');
    console.log('🔍 Verifique no Supabase Dashboard → Table Editor');

  } catch (err) {
    console.error('\n❌ Erro fatal na migração:', err);
    process.exit(1);
  }
}

migrate();