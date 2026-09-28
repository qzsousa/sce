/**
 * Une as grafias duplicadas de `unidades` ao nome oficial de `filiais`.
 *
 * `equipamentos.unidade` é TEXT livre: a mesma escola pode estar gravada como
 * "E.E. HAYDEE HIDALGO" (oficial, de `filiais`) e "Haydee Hidalgo Professora"
 * (legado do Google Sheets). Isso fazia a escola aparecer duplicada no filtro
 * de unidades e dividia as contagens do parque.
 *
 * O servidor já normaliza na leitura e na escrita (ver `criarIndiceUnidades` em
 * supabaseService.js). Este script limpa o que já está gravado, para o banco e
 * os relatórios (CSV/PDF) ficarem coerentes.
 *
 * USO
 *   node unidades-unificar.js              # relatório, não altera nada
 *   node unidades-unificar.js --aplicar    # aplica as correções
 *   node unidades-unificar.js --aplicar --tabela emprestimos
 *
 * Só toca em linhas cuja grafia casa com algum nome de `filiais` pelo mesmo
 * casamento tolerante do servidor (sem "E.E.", acentos, pontuação, honoríficos
 * e partes do composto "A / B"). Escola fora de `filiais` fica intacta.
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { criarIndiceUnidades } from './supabaseService.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const APLICAR = process.argv.includes('--aplicar');
const argTabela = process.argv.indexOf('--tabela');
const TABELA = argTabela >= 0 ? process.argv[argTabela + 1] : 'equipamentos';
const TABELAS_VALIDAS = ['equipamentos', 'emprestimos'];

if (!TABELAS_VALIDAS.includes(TABELA)) {
  console.error(`❌ Tabela inválida: ${TABELA}. Use: ${TABELAS_VALIDAS.join(' ou ')}.`);
  process.exit(1);
}

const BLOCO = 1000;

/** Lê a coluna `unidade` inteira (o PostgREST limita a 1000 linhas por requisição). */
async function lerUnidades(tabela, colunas) {
  const linhas = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from(tabela)
      .select(colunas)
      .range(offset, offset + BLOCO - 1);
    if (error) throw new Error(`Erro ao ler ${tabela}: ${error.message}`);
    linhas.push(...(data || []));
    if (!data || data.length < BLOCO) break;
    offset += BLOCO;
  }
  return linhas;
}

async function main() {
  console.log(`\n🔎 Unificando nomes de unidade em "${TABELA}"`);
  console.log(`   Modo: ${APLICAR ? 'APLICAR' : 'relatório (nada será alterado)'}\n`);

  const { data: filiais, error: errFiliais } = await supabase.from('filiais').select('nome');
  if (errFiliais) throw new Error(`Erro ao ler filiais: ${errFiliais.message}`);

  const indice = criarIndiceUnidades((filiais || []).map((f) => f.nome));
  if (indice.oficiais.length === 0) {
    console.error('❌ A tabela filiais está vazia: sem nomes oficiais não há o que unificar.');
    process.exit(1);
  }
  console.log(`ℹ️  ${indice.oficiais.length} nome(s) oficial(is) em filiais.`);

  const colunas = TABELA === 'emprestimos' ? 'id, unidade' : 'id, unidade, modelo, status';
  const linhas = await lerUnidades(TABELA, colunas);

  // Grafia de origem → nome oficial, só quando mudaria de fato.
  const plano = new Map();
  for (const linha of linhas) {
    const atual = String(linha.unidade || '').trim();
    if (!atual) continue;
    const oficial = indice.canonico(atual);
    if (!oficial || oficial === atual) continue;
    if (!plano.has(atual)) plano.set(atual, { oficial, ids: [] });
    plano.get(atual).ids.push(linha.id);
  }

  if (plano.size === 0) {
    console.log('\n✅ Nenhuma grafia duplicada encontrada. Banco já está unificado.\n');
    return;
  }

  // Consolida por oficial: mostra a escola una e as grafias que Collapse nela.
  const porOficial = new Map();
  for (const [grafia, { oficial, ids }] of plano) {
    if (!porOficial.has(oficial)) porOficial.set(oficial, { grafias: new Map(), total: 0 });
    const grupo = porOficial.get(oficial);
    grupo.grafias.set(grafia, ids.length);
    grupo.total += ids.length;
  }

  console.log(`\n=== ${porOficial.size} escola(s) com nome duplicado ===\n`);
  for (const [oficial, grupo] of porOficial) {
    console.log(`  ${oficial}`);
    for (const [grafia, qtd] of grupo.grafias) {
      console.log(`    ↳ "${grafia}" (${qtd} registro${qtd > 1 ? 's' : ''}) → "${oficial}"`);
    }
  }
  const totalRegistros = [...plano.values()].reduce((s, v) => s + v.ids.length, 0);
  console.log(`\n  Total: ${plano.size} grafia(s) divergente(s) em ${totalRegistros} registro(s).`);

  if (!APLICAR) {
    console.log('\n💡 Rode com --aplicar para corrigir o banco.\n');
    return;
  }

  console.log('\n✍️  Aplicando...');
  let ok = 0;
  let falhas = 0;
  for (const [grafia, { oficial, ids }] of plano) {
    for (const id of ids) {
      const { error } = await supabase.from(TABELA).update({ unidade: oficial }).eq('id', id);
      if (error) {
        console.error(`  ⚠️  ${TABELA}/${id} ("${grafia}"): ${error.message}`);
        falhas += 1;
      } else {
        ok += 1;
      }
    }
  }

  console.log(`\n🎉 ${ok} registro(s) unificado(s), ${falhas} falha(s).`);
  console.log('   O histórico de alterações (historico_itens) não é reescrito — ele é um registro do que houve.\n');
}

main().catch((e) => {
  console.error('\n❌ Erro:', e.message);
  process.exit(1);
});
