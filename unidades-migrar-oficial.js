/**
 * MIGRAÇÃO SEGURA DA UNIDADE INDIANA + LIMPEZA DE `filiais`
 *
 * O PROBLEMA
 * ----------
 * `filiais` tem o nome oficial "E.E. INDIANA ZUYCHER S. DE JESUS", mas os 19
 * equipamentos estão gravados na grafia legada "Indiana Zuycher Simoes De
 * Jesus Profa". O matcher oficial (`unidadesCasam`) NÃO casa as duas.
 *
 * Hoje os 3 usuários veem os 19 pq o `usuarios.filial` é IDÊNTICO à grafia do
 * equipamento. Se só o equipamento for migrado, eles caem para ZERO — a
 * grafia nova do usuário não casa com a grafia velha do equipamento.
 *
 * POR ISSO EQUIPAMENTO E USUÁRIO VÃO NO MESMO SCRIPT, com medição antes/depois
 * e ROLLBACK automático se alguém enxergar menos do que enxergava.
 *
 * TAMBÉM APAGA DE `filiais` AS DUAS GRAFIAS ÓRFÃS (typo que não casa com
 * nenhum equipamento e não tem usuário):
 *   "E.E. ISAAC SCHIRAIBER" -> duplicata de "E.E. ISAAC SCHRAIBER" (239 eq)
 *   "E.E. LUIS VAZ DE CAMÕES" -> duplicata de "E.E. LUIZ VAZ DE CAMÕES" (200 eq)
 * Essas duas é que o portal oferece no select de unidade e, escolhidas, quebram
 * o acesso da escola.
 *
 * Uso:  node unidades-migrar-oficial.js [--aplicar]
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { unidadesCasam } from './supabaseService.js';

const APLICAR = process.argv.includes('--aplicar');

/** Grafia legada do equipamento -> nome oficial. */
const EQUIPAMENTO = { de: 'Indiana Zuycher Simoes De Jesus Profa', para: 'E.E. INDIANA ZUYCHER S. DE JESUS' };

/** Grafias órfãs de `filiais` a remover (typo sem equipamento e sem usuário). */
const ORFAS_FILIAIS = [
  { nome: 'E.E. ISAAC SCHIRAIBER', real: 'E.E. ISAAC SCHRAIBER' },
  { nome: 'E.E. LUIS VAZ DE CAMÕES', real: 'E.E. LUIZ VAZ DE CAMÕES' },
];

/** Volume de equipamentos por grafia (paginação completa). */
async function volumePorUnidade(db) {
  const vol = new Map();
  let off = 0;
  while (true) {
    const { data, error } = await db.from('equipamentos').select('unidade,status').range(off, off + 999);
    if (error) throw error;
    for (const r of data) {
      if (r.status === 'Removido') continue;
      const g = String(r.unidade || '').trim();
      if (g) vol.set(g, (vol.get(g) || 0) + 1);
    }
    if (data.length < 1000) break;
    off += 1000;
  }
  return vol;
}

/** Quantos equipamentos um usuário enxerga com um dado filial — o MESMO cálculo do servidor. */
function visiveis(vol, filial, nivel) {
  const escopo = String(filial || '').split(',').map((s) => s.trim()).filter(Boolean);
  let n = 0;
  for (const [g, q] of vol) {
    const ok = String(nivel).toUpperCase() === 'TECNICO' ? escopo.some((f) => unidadesCasam(f, g)) : unidadesCasam(filial, g);
    if (ok) n += q;
  }
  return n;
}

async function main() {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log(APLICAR ? '🔴 MODO APLICAÇÃO\n' : '🟡 DRY-RUN — nada gravado. Use --aplicar.\n');

  const { data: filiais } = await db.from('filiais').select('nome');
  const nomes = filiais.map((f) => f.nome);

  // ---- Travas de segurança ----
  if (!nomes.includes(EQUIPAMENTO.para)) throw new Error(`Destino ausente de \`filiais\`: "${EQUIPAMENTO.para}"`);
  if (unidadesCasam(EQUIPAMENTO.de, EQUIPAMENTO.para)) throw new Error('A grafia legada já casa com a oficial — nada a fazer.');
  for (const o of ORFAS_FILIAIS) {
    if (!nomes.includes(o.nome)) throw new Error(`Órfã não encontrada em \`filiais\`: "${o.nome}"`);
    if (!nomes.includes(o.real)) throw new Error(`Grafia real não encontrada: "${o.real}"`);
    if (unidadesCasam(o.nome, o.real)) throw new Error(`"${o.nome}" casa com "${o.real}" — não é órfã, não remover.`);
  }
  const { data: usuarios } = await db.from('usuarios').select('email,nivel,filial,status');
  for (const o of ORFAS_FILIAIS) {
    const usa = usuarios.filter((u) => u.filial === o.nome);
    if (usa.length) throw new Error(`"${o.nome}" está em uso por ${usa.length} usuário(s) — não remover.`);
  }
  const alvos = usuarios.filter((u) => u.filial === EQUIPAMENTO.de);
  if (!alvos.length) throw new Error(`Nenhum usuário com a grafia "${EQUIPAMENTO.de}" — nada a fazer.`);
  console.log('✔ Travas de segurança passaram\n');

  // ---- MEDIÇÃO ANTES ----
  const volAntes = await volumePorUnidade(db);
  const qtdEquip = volAntes.get(EQUIPAMENTO.de) || 0;
  const antes = alvos.map((u) => ({ u, n: visiveis(volAntes, u.filial, u.nivel) }));
  console.log('── ANTES ────────────────────────────────────────────────────\n');
  console.log(`  equipamento "${EQUIPAMENTO.de}": ${qtdEquip}`);
  for (const a of antes) console.log(`  ${a.u.email.padEnd(46)} [${a.u.nivel}] vê ${a.n}`);
  if (antes.some((a) => a.n === 0)) throw new Error('Algum usuário já não enxerga nada — situação inesperada, abortando.');
  console.log(`\n  Órfãs em \`filiais\` a remover:`);
  for (const o of ORFAS_FILIAIS) console.log(`     "${o.nome}"  (a correta é "${o.real}")`);

  if (!APLICAR) {
    console.log('\n🟡 Nada gravado. Rode com --aplicar.\n');
    return;
  }

  console.log('\n── GRAVANDO (equipamento + usuário na mesma passagem) ─────────\n');
  const rollback = { equip: 0, usuarios: [], filiais: [] };
  try {
    // 1) equipamento
    const { data: eqRows, error: eqErr } = await db
      .from('equipamentos').update({ unidade: EQUIPAMENTO.para })
      .eq('unidade', EQUIPAMENTO.de).select('id');
    if (eqErr) throw eqErr;
    rollback.equip = eqRows.length;
    console.log(`  ✔ ${eqRows.length} equipamento(s) -> "${EQUIPAMENTO.para}"`);

    // 2) usuários (imediatamente depois: é o que fecha a janela)
    for (const a of antes) {
      const { error } = await db.from('usuarios')
        .update({ filial: EQUIPAMENTO.para, atualizado_em: new Date().toISOString() })
        .eq('email', a.u.email);
      if (error) throw error;
      rollback.usuarios.push(a.u.email);
      console.log(`  ✔ ${a.u.email}`);
    }

    // 3) órfãs de filiais
    for (const o of ORFAS_FILIAIS) {
      const { error } = await db.from('filiais').delete().eq('nome', o.nome);
      if (error) throw error;
      rollback.filiais.push(o.nome);
      console.log(`  ✔ filiais: removida "${o.nome}"`);
    }
  } catch (e) {
    console.error(`\n❌ FALHOU: ${e.message}\n↩️  revertendo...`);
    await db.from('equipamentos').update({ unidade: EQUIPAMENTO.de }).eq('unidade', EQUIPAMENTO.para);
    for (const email of rollback.usuarios) {
      await db.from('usuarios').update({ filial: EQUIPAMENTO.de }).eq('email', email);
    }
    for (const nome of rollback.filiais) {
      await db.from('filiais').insert({ nome, ativo: true });
    }
    console.error('✅ Revertido ao estado anterior.');
    process.exitCode = 1;
    return;
  }

  // ---- MEDIÇÃO DEPOIS ----
  const volDepois = await volumePorUnidade(db);
  const { data: usuariosDepois } = await db.from('usuarios').select('email,nivel,filial,status');
  console.log('\n── DEPOIS ───────────────────────────────────────────────────\n');
  let ok = true;
  for (const a of antes) {
    const u = usuariosDepois.find((x) => x.email === a.u.email);
    if (!u) { ok = false; console.log(`  ❌ ${a.u.email.padEnd(46)} sumiu da tabela usuarios`); continue; }
    const n = visiveis(volDepois, u.filial, u.nivel);
    const bom = n >= a.n;
    if (!bom) ok = false;
    console.log(`  ${bom ? '✔' : '❌'} ${a.u.email.padEnd(46)} ${a.n} -> ${n}`);
  }
  const equipDepois = volDepois.get(EQUIPAMENTO.para) || 0;
  console.log(`\n  equipamento "${EQUIPAMENTO.para}": ${equipDepois} (antes eram ${qtdEquip} na grafia legada)`);

  if (!ok) {
    console.error('\n❌ Alguém perdeu acesso. Revertendo...');
    await db.from('equipamentos').update({ unidade: EQUIPAMENTO.de }).eq('unidade', EQUIPAMENTO.para);
    for (const a of antes) await db.from('usuarios').update({ filial: EQUIPAMENTO.de }).eq('email', a.u.email);
    for (const nome of rollback.filiais) await db.from('filiais').insert({ nome, ativo: true });
    console.error('✅ Revertido.');
    process.exitCode = 1;
    return;
  }
  console.log('\n✅ Migrado. Todo mundo mantém (ou ganha) o acesso. Agora atualize o portal (Usuario.filial) e as sessões velhas.');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });