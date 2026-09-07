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

    // ---------- 5. HISTORICO ----------
    console.log('📥 Migrando histórico...');
    const histData = await getSheetValues('MOVIMENTACAO', 'Historico_Itens');
    if (histData.length > 1) {
      const headers = histData[0];
      const rows = histData.slice(1);
      for (const row of rows) {
        const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
        const { error } = await supabase.from('historico_itens').upsert({
          id: obj.id || randomUUID(),
          equipamento_id: obj.equipamentoId,
          campo: obj.campo,
          valor_antigo: obj.valorAntigo,
          valor_novo: obj.valorNovo,
          autor: obj.autor,
          data: obj.data ? new Date(obj.data).toISOString() : new Date().toISOString(),
        }, { onConflict: 'id' });
        if (error) console.error(`  ⚠️ Histórico:`, error.message);
      }
      console.log(`  ✅ ${rows.length} registros de histórico processados`);
    }

    // ---------- 6. EMPRESTIMOS ----------
    console.log('📥 Migrando empréstimos...');
    const empData = await getSheetValues('MOVIMENTACAO', 'Emprestimos');
    if (empData.length > 1) {
      const headers = empData[0];
      const rows = empData.slice(1);
      for (const row of rows) {
        const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
        const { error } = await supabase.from('emprestimos').upsert({
          id: obj.id || randomUUID(),
          equipamento_id: obj.equipamentoId,
          patrimonio: obj.patrimonio,
          unidade: obj.unidade,
          responsavel: obj.responsavel,
          cpf: obj.cpf,
          email_responsavel: obj.emailResponsavel,
          data_emprestimo: obj.dataEmprestimo ? new Date(obj.dataEmprestimo).toISOString() : new Date().toISOString(),
          data_prevista_devolucao: obj.dataPrevistaDevolucao ? new Date(obj.dataPrevistaDevolucao).toISOString().split('T')[0] : null,
          data_devolucao: obj.dataDevolucao ? new Date(obj.dataDevolucao).toISOString() : null,
          status: obj.status || 'Emprestado',
          termo_pdf_url: obj.termoPdfUrl,
          criado_por: obj.criadoPor,
          devolvido_por: obj.devolvidoPor,
          observacoes: obj.observacoes,
          tipo_emprestimo: obj.tipoEmprestimo || 'interno',
          escola_destino: obj.escolaDestino,
        }, { onConflict: 'id' });
        if (error) console.error(`  ⚠️ Empréstimo:`, error.message);
      }
      console.log(`  ✅ ${rows.length} empréstimos processados`);
    }

    // ---------- 7. REGISTROS_MANUTENCAO ----------
    console.log('📥 Migrando manutenções...');
    const manData = await getSheetValues('MOVIMENTACAO', 'Registros_Manutencao');
    if (manData.length > 1) {
      const headers = manData[0];
      const rows = manData.slice(1);
      for (const row of rows) {
        const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
        const { error } = await supabase.from('registros_manutencao').upsert({
          id: obj.id || randomUUID(),
          equipamento_id: obj.equipamentoId,
          autor: obj.autor,
          data: obj.data ? new Date(obj.data).toISOString() : new Date().toISOString(),
          descricao: obj.descricao,
          status: obj.status || 'Pendente',
        }, { onConflict: 'id' });
        if (error) console.error(`  ⚠️ Manutenção:`, error.message);
      }
      console.log(`  ✅ ${rows.length} manutenções processadas`);
    }

    // ---------- 8. AUDITORIA ----------
    console.log('📥 Migrando auditoria...');
    const audData = await getSheetValues('MOVIMENTACAO', 'Auditoria');
    if (audData.length > 1) {
      const headers = audData[0];
      const rows = audData.slice(1);
      for (const row of rows) {
        const obj = {}; headers.forEach((h,i)=>obj[h]=row[i]);
        const { error } = await supabase.from('auditoria').insert({
          data: obj.data ? new Date(obj.data).toISOString() : new Date().toISOString(),
          usuario: obj.usuario,
          acao: obj.acao,
          detalhes: obj.detalhes,
        });
        if (error) console.error(`  ⚠️ Auditoria:`, error.message);
      }
      console.log(`  ✅ ${rows.length} auditorias processadas`);
    }

    console.log('\n🎉 Migração concluída com sucesso!');
    console.log('🔍 Verifique no Supabase Dashboard → Table Editor');

  } catch (err) {
    console.error('\n❌ Erro fatal na migração:', err);
    process.exit(1);
  }
}

migrate();