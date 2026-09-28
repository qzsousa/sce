/**
 * Dedup da lista oficial de escolas: popula a tabela `filiais`.
 *
 * POR QUE ISSO EXISTE
 * `equipamentos.unidade` é TEXT livre e nasceu com o parcelamento real: 55
 * grafias distintas para 51 escolas. `filiais` — a única lista de nomes oficiais
 * do SCE — ficou só com as 6 linhas de exemplo do seed, então não havia nome
 * oficial contra o qual resolver "Haydee Hidalgo Profa" para "E.E. HAYDEÉ
 * HIDALGO". Consequências:
 *   - a mesma escola aparece várias vezes no filtro de unidades;
 *   - `/filiais-para-emprestimo` (empréstimo entre escolas) oferece 6 nomes.
 *
 * A ordem importa: este script descobre e grava os oficiais; o
 * `unidades-unificar.js` reescreve a coluna `equipamentos.unidade`.
 *
 * COMO ESCOLHE O NOME OFICIAL
 * 1. O que JÁ está em `filiais` sempre vence — é o cadastro oficial, e é o que
 *    a API usa para canonicalizar (irmãs, por exemplo).
 * 2. Para o que ainda não tem, a grafia "de sistema" (com prefixo de ensino
 *    E.E./E.M./C.E.…, vinda do cadastro de chamados) é a oficial.
 * 3. Sem prefixo em nenhuma, vale a de maior volume.
 * 4. Empate: ordem alfabética (determinístico).
 *
 * A heurística propõe, não decide sozinha: o relatório sai para conferência e
 * cadastrar o nome certo em `filiais` antes de aplicar faz ele vencer no passo 1.
 *
 * USO
 *   node filiais-sincronizar.js                    # relatório
 *   node filiais-sincronizar.js --aplicar          # grava os oficiais em filiais
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
// Reusa a normalização do servidor de propósito: uma segunda implementação da
// regra aqui agruparia diferente do que a API agrupa, e o script mentiria.
import {
  agruparGrafiasUnidade,
  criarIndiceUnidades,
  escolherNomeOficial,
} from './supabaseService.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const APLICAR = process.argv.includes('--aplicar');

/** Equipamentos por grafia (só o que está visível no parque). */
async function contarPorGrafia() {
  const BLOCO = 1000;
  const contagem = new Map();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('equipamentos')
      .select('unidade')
      .neq('status', 'Removido')
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
  console.log('\n🏫 Sincronizando a lista oficial de escolas (tabela filiais)');
  console.log(`   Modo: ${APLICAR ? 'APLICAR' : 'relatório (nada será gravado)'}\n`);

  const contagem = await contarPorGrafia();
  const grafias = [...contagem.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const { data: existentes, error: errFiliais } = await supabase.from('filiais').select('nome');
  if (errFiliais) throw new Error(`Erro ao ler filiais: ${errFiliais.message}`);

  console.log(`ℹ️  ${contagem.size} grafia(s) em equipamentos.unidade (${[...contagem.values()].reduce((a, b) => a + b, 0)} equipamentos).`);
  console.log(`ℹ️  ${existentes.length} nome(s) já em filiais.`);

  // Passo 1: o que a API JÁ resolve hoje (oficial já cadastrado) fica como está.
  const indiceExistente = criarIndiceUnidades(existentes.map((f) => f.nome));
  const porOficial = new Map(); // oficial -> grafias
  const pendentes = [];
  for (const g of grafias) {
    const oficial = indiceExistente.canonico(g);
    if (oficial) {
      if (!porOficial.has(oficial)) porOficial.set(oficial, new Set());
      porOficial.get(oficial).add(g);
    } else {
      pendentes.push(g);
    }
  }

  // Passo 2: entre o que não tem cadastro, agrupa e escolhe um oficial.
  for (const grp of agruparGrafiasUnidade(pendentes)) {
    const oficial = escolherNomeOficial(grp.grafias, contagem);
    if (!porOficial.has(oficial)) porOficial.set(oficial, new Set());
    for (const g of grp.grafias) porOficial.get(oficial).add(g);
  }

  const jaCadastrado = new Set(existentes.map((f) => f.nome));
  const oficiais = [...porOficial.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const duplicados = oficiais.filter((o) => porOficial.get(o).size > 1);
  const aInserir = oficiais.filter((o) => !jaCadastrado.has(o));

  console.log(`\n=== ${oficiais.length} escola(s) no parque | ${duplicados.length} com nome duplicado ===\n`);
  for (const oficial of duplicados) {
    const lista = [...porOficial.get(oficial)].sort(
      (a, b) => (contagem.get(b) || 0) - (contagem.get(a) || 0),
    );
    const origem = jaCadastrado.has(oficial) ? 'já em filiais' : 'inferido';
    console.log(`  ${oficial}   [${origem}]`);
    for (const g of lista) {
      console.log(`    ${g === oficial ? '→' : ' '} ${String(contagem.get(g) || 0).padStart(5)}  ${g}`);
    }
  }
  if (!duplicados.length) console.log('  Nenhuma escola com nome duplicado.');

  console.log(`\n  Novos nomes oficiais a inserir em filiais: ${aInserir.length}`);
  const semEquipamento = existentes.filter((f) => !porOficial.has(f.nome));
  console.log(`  Escolas em filiais sem equipamento hoje: ${semEquipamento.length}${semEquipamento.length ? ` (${semEquipamento.map((f) => f.nome).join(' | ')})` : ''}`);
  console.log(`    (informativo — escola recém-cadastrada entra no select de unidade com contagem zerada)`);

  if (!APLICAR) {
    console.log('\n💡 Confira o relatório. Para corrigir um oficial, cadastre o nome certo em filiais');
    console.log('   antes de aplicar: o que já existe tem prioridade. Depois rode com --aplicar.\n');
    return;
  }

  if (!aInserir.length) {
    console.log('\n✅ filiais já está em dia — nada a gravar.\n');
    return;
  }
  const { error } = await supabase
    .from('filiais')
    .upsert(aInserir.map((nome) => ({ nome, ativo: true })), { onConflict: 'nome', ignoreDuplicates: true });
  if (error) throw new Error(`Erro ao gravar filiais: ${error.message}`);

  console.log(`\n✅ ${aInserir.length} nome(s) oficial(is) gravado(s) em filiais.`);
  console.log('   O filtro de unidades e o select de cadastro já passam a agrupar certo.');
  console.log('\n➡️  Próximo passo: node unidades-unificar.js --aplicar\n');
}

main().catch((e) => {
  console.error('\n❌ Erro:', e.message);
  process.exit(1);
});
