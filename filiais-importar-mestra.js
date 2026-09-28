/**
 * Importa a lista-mestra de escolas do backend de chamados para `filiais`.
 *
 * A lista-mestra e a fonte da verdade do dominio: o SCE nao tem acesso a ela
 * (o backend de chamados roda em outro projeto Supabase), entao este script le
 * a lista direto do fonte dele. Rode de novo sempre que a lista mudar la.
 *
 * O que ele faz, nesta ordem:
 *   1. le a lista-mestra (NOMES_PADRONIZADOS em services/normalization.ts);
 *   2. aplica CORRECOES (mapa-unidades.js) para as grafias encurtadas que o
 *      casamento tolerante nao atravessa;
 *   3. RENOMEIA as filiais que casam com um oficial de outro nome;
 *   4. INSERE os predios que o SCE ainda nao tem;
 *   5. aponta qualquer escola com equipamento que ficou sem par.
 *
 * O passo 3 e o que muda a semantique: nomes como "Cesar Donato Calabrez" viram
 * "E.E. CESAR DONATO CALABREZ / LEILA DINIZ", ou seja, a unidade passa a ser o
 * predio inteiro, e a equipmentacao da irma conta junto. E o mesmo agrupamento
 * que o painel de unidades do portal ja faz.
 *
 * USO
 *   node filiais-importar-mestra.js                     # relatorio
 *   node filiais-importar-mestra.js --aplicar           # grava
 *   node filiais-importar-mestra.js --lista <arquivo>   # outra fonte da lista
 *   node filiais-importar-mestra.js --nao-inserir       # so renomeia
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { criarIndiceUnidades } from './supabaseService.js';
import { CORRECOES } from './mapa-unidades.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const APLICAR = process.argv.includes('--aplicar');
const INSERIR = !process.argv.includes('--nao-inserir');
const argLista = process.argv.indexOf('--lista');
const LISTA_PATH =
  argLista >= 0
    ? process.argv[argLista + 1]
    : '../chamados/backend/src/services/normalization.ts';

/** Extrai NOMES_PADRONIZADOS do fonte, aplicando o mesmo canonizarEspacos de la. */
function lerListaMestra(caminho) {
  const fonte = readFileSync(caminho, 'utf8');
  const marca = 'export const NOMES_PADRONIZADOS';
  const inicio = fonte.indexOf(marca);
  if (inicio < 0) throw new Error(`NOMES_PADRONIZADOS nao encontrado em ${caminho}`);
  const abre = fonte.indexOf('[', inicio);
  let fecha = -1;
  let nivel = 0;
  for (let i = abre; i < fonte.length; i++) {
    if (fonte[i] === '[') nivel++;
    else if (fonte[i] === ']') {
      nivel--;
      if (nivel === 0) {
        fecha = i;
        break;
      }
    }
  }
  const nomes = [...fonte.slice(abre, fecha).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return nomes.map((n) => n.replace(/\s+/g, ' ').replace(/\s*\/\s*/g, ' / ').trim());
}

async function contarEquipamentos() {
  const contagem = new Map();
  const BLOCO = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('equipamentos')
      .select('unidade')
      .range(offset, offset + BLOCO - 1);
    if (error) throw new Error(`Erro ao ler equipamentos: ${error.message}`);
    for (const linha of data || []) {
      const g = String(linha.unidade || '').trim();
      if (g) contagem.set(g, (contagem.get(g) || 0) + 1);
    }
    if (!data || data.length < BLOCO) break;
    offset += BLOCO;
  }
  return contagem;
}

async function main() {
  console.log('\n📥 Importando a lista-mestra de escolas para filiais');
  console.log(`   Fonte: ${LISTA_PATH}`);
  console.log(`   Modo: ${APLICAR ? 'APLICAR' : 'relatório (nada será gravado)'}\n`);

  const mestras = lerListaMestra(LISTA_PATH);
  const idxMestra = criarIndiceUnidades(mestras);
  console.log(`ℹ️  lista-mestra: ${mestras.length} prédios`);

  const { data: filiais, error: errFil } = await supabase.from('filiais').select('id, nome').order('nome');
  if (errFil) throw new Error(`Erro ao ler filiais: ${errFil.message}`);
  const equip = await contarEquipamentos();
  console.log(`ℹ️  filiais: ${filiais.length} | equipamentos: ${[...equip.values()].reduce((a, b) => a + b, 0)}`);

  // Destino de cada filial: CORRECOES tem prioridade; depois o casamento automatico.
  const destinoDe = (nome) => {
    if (Object.prototype.hasOwnProperty.call(CORRECOES, nome)) return CORRECOES[nome];
    return idxMestra.canonico(nome);
  };

  const renomear = [];
  const semPar = [];
  for (const f of filiais) {
    const destino = destinoDe(f.nome);
    if (!destino) {
      if ((equip.get(f.nome) || 0) > 0) semPar.push(f.nome);
      continue;
    }
    if (destino !== f.nome) renomear.push({ id: f.id, de: f.nome, para: destino, q: equip.get(f.nome) || 0 });
  }

  const nomesDepois = new Set(filiais.map((f) => f.nome));
  for (const r of renomear) nomesDepois.add(r.para);
  // O que precisa existir em filiais e: os predios da lista-mestra E os destinos
  // que vem so do mapa de correcoes (a URE, por exemplo, que nao e escola e
  // portanto nunca aparece na lista-mestra). Inserir so `mestras` deixaria esses
  // destinos resolvendo para um nome que nao esta em filiais.
  const desejados = new Set(mestras);
  for (const destino of Object.values(CORRECOES)) if (destino) desejados.add(destino);
  const inserir = INSERIR ? [...desejados].filter((n) => !nomesDepois.has(n)).sort() : [];

  // Um nome da master que bate em duas filiais diferentes = bug no mapa.
  const destinos = new Map();
  for (const r of renomear) {
    if (!destinos.has(r.para)) destinos.set(r.para, []);
    destinos.get(r.para).push(r.de);
  }
  const colisoes = [...destinos.entries()].filter(([, l]) => l.length > 1);

  const movem = renomear.reduce((s, r) => s + r.q, 0);
  console.log(`\n=== plano ===`);
  console.log(`  renomear filiais:   ${renomear.length}`);
  console.log(`  inserir prédios:   ${inserir.length}`);
  // Renomear e UPDATE: a linha continua existindo, so muda de nome. A conta e
  // filiais + inseridos, nao filiais - renomes + inseridos.
  console.log(`  filiais depois:    ${filiais.length + inserir.length}`);
  console.log(`  equipamentos que mudam de nome: ${movem}`);
  console.log(`  escolas sem par na lista-mestra: ${semPar.length}`);
  if (semPar.length) console.log('    (ficam como estão; revise CORRECOES em mapa-unidades.js se quiser padronizar)');

  if (renomear.length) {
    console.log(`\n--- renomes (${renomear.length}) ---`);
    for (const r of renomear.sort((a, b) => b.q - a.q)) {
      console.log(`  ${String(r.q).padStart(4)}  "${r.de}"`);
      console.log(`        → "${r.para}"`);
    }
  }
  if (semPar.length) {
    console.log(`\n--- SEM PAR na lista-mestra: continuam como estão ---`);
    for (const n of semPar) console.log(`  ${String(equip.get(n) || 0).padStart(4)}  ${n}`);
  }
  if (inserir.length) {
    console.log(`\n--- nomes novos em filiais (${inserir.length}) — entram no select e na lista de empréstimo com contagem 0 ---`);
    for (const n of inserir) console.log(`     0  ${n}`);
  }
  if (colisoes.length) {
    console.log(`\n❌ COLISÕES — o mapa manda dois nomes para o mesmo destino:`);
    for (const [d, l] of colisoes) console.log(`   "${d}" ← ${l.join(' + ')}`);
  }

  if (!APLICAR) {
    console.log(`\n💡 Confira e rode com --aplicar.`);
    if (INSERIR) console.log(`   (use --nao-inserir se quiser só renomear, sem trazer os ${inserir.length} prédios novos)`);
    console.log('');
    return;
  }
  if (colisoes.length) {
    console.error('\n❌ Nada foi gravado: corrija o mapa antes.\n');
    process.exit(1);
  }

  for (const r of renomear) {
    const { error } = await supabase.from('filiais').update({ nome: r.para }).eq('id', r.id);
    if (error) {
      console.error(`\n❌ Falhou ao renomear ${r.id} ("${r.de}"): ${error.message}`);
      console.error('   As demais renomeações já foram gravadas — este comando é reexecutável.\n');
      process.exit(1);
    }
  }
  console.log(`\n✅ ${renomear.length} filial(is) renomeada(s).`);

  if (inserir.length) {
    const { error } = await supabase
      .from('filiais')
      .upsert(inserir.map((nome) => ({ nome, ativo: true })), { onConflict: 'nome', ignoreDuplicates: true });
    if (error) throw new Error(`Erro ao inserir filiais: ${error.message}`);
    console.log(`✅ ${inserir.length} prédio(s) inserido(s).`);
  }

  console.log('\n➡️  Próximo passo: node unidades-unificar.js --aplicar');
  console.log('   (o equipamento só recebe o nome novo depois disso)\n');
}

main().catch((e) => {
  console.error('\n❌ Erro:', e.message);
  process.exit(1);
});
