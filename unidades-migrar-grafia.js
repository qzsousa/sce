/**
 * MIGRAÇÃO DE GRAFIA DE UNIDADE: equipamento + usuário + sessão na MESMA passagem
 *
 * POR QUE ISTO EXISTE (e por que `unidades-unificar.js` não serve)
 * -----------------------------------------------------------
 * `equipamentos.unidade` é TEXT livre. A mesma escola aparece com grafias
 * diferentes, e cada uma carrega o seu próprio grupo de usuários em
 * `usuarios.filial`. O acesso é calculado por `sessaoTemAcessoAUnidade`, que
 * compara a grafia do usuário com a do equipamento — então, se você move o
 * equipamento e deixa o usuário para trás, o usuário cai para ZERO
 * equipamentos. Não é teórico: já aconteceu no Indiana
 * (ver `unidades-migrar-oficial.js`).
 *
 * `unidades-unificar.js` resolve o problema da TELA (a escola volta a contar),
 * mas mexe só em `equipamentos`/`emprestimos`. Para grafia que tem usuário
 * junto, ele entrega acesso quebrado. Este script é o que fecha as duas pontas.
 *
 * DIFERENÇAS EM RELAÇÃO AO SCRIPT DA INDIANA
 * ------------------------------------------
 * 1) Genérico: recebe `--de`/`--para` em vez de estar preso a um par fixo.
 * 2) ROLLBACK POR ID. A Indiana reverte com `.eq('unidade', PARA)` — isso
 *    desfaz TODAS as linhas que já estavam no nome oficial, inclusive as que
 *    estavam corretas antes da migração. Aqui cada id tocado é registrado e
 *    só ele volta.
 * 3) Mexe também em `sessoes`. Uma sessão aberta carrega uma cópia de
 *    `filial`; sem atualizar, quem está logado no momento da migração passa a
 *    ver zero sem precisar fazer nada de errado. (Hoje todas as sessões do
 *    banco estão expiradas, então isso não bite — mas o script não deve depender
 *    disso.)
 *
 * USO
 *   node unidades-migrar-grafia.js --de "<grafia antiga>" --para "<nome oficial>"
 *   node unidades-migrar-grafia.js --de "..." --para "..." --aplicar
 *
 * Sem `--aplicar` é relatório: nada é gravado.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { unidadesCasam, mesmaEscola } from './supabaseService.js';

const arg = (nome) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : null;
};
const DE = arg('--de');
const PARA = arg('--para');
const APLICAR = process.argv.includes('--aplicar');

if (!DE || !PARA) {
  console.error('❌ Informe --de "<grafia antiga>" e --para "<nome oficial>".');
  process.exit(1);
}
if (DE.trim() === PARA.trim()) {
  console.error('❌ --de e --para são a mesma grafia.');
  process.exit(1);
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/** Volume de equipamentos por grafia, ignorando "Removido" (mesmo recorte da tela). */
async function volumePorUnidade() {
  const vol = new Map();
  let off = 0;
  for (;;) {
    const { data, error } = await db.from('equipamentos').select('unidade,status').range(off, off + 999);
    if (error) throw error;
    for (const r of data || []) {
      if (r.status === 'Removido') continue;
      const g = String(r.unidade || '').trim();
      if (g) vol.set(g, (vol.get(g) || 0) + 1);
    }
    if (!data || data.length < 999) break;
    off += 1000;
  }
  return vol;
}

/** Quantos equipamentos um usuário enxerga — o MESMO cálculo do servidor. */
function visiveis(vol, filial, nivel) {
  const escopo = String(filial || '').split(',').map((s) => s.trim()).filter(Boolean);
  let n = 0;
  for (const [g, q] of vol) {
    const ok = String(nivel).toUpperCase() === 'TECNICO'
      ? escopo.some((f) => unidadesCasam(f, g))
      : unidadesCasam(filial, g);
    if (ok) n += q;
  }
  return n;
}

/** Volume depois da migração, sem gravar: troca as grafias no mapa. */
function volumeProjetado(vol, de, para, qtdEquip) {
  const novo = new Map(vol);
  const jaLa = novo.get(para) || 0;
  novo.delete(de);
  novo.set(para, jaLa + qtdEquip);
  return novo;
}

async function main() {
  console.log(APLICAR ? '🔴 MODO APLICAÇÃO\n' : '🟡 DRY-RUN — nada gravado. Use --aplicar.\n');
  console.log(`  de: "${DE}"`);
  console.log(`  para: "${PARA}"\n`);

  // ---- Travas de segurança ----
  const { data: filiais } = await db.from('filiais').select('nome');
  const nomes = (filiais || []).map((f) => f.nome);
  if (!nomes.includes(PARA)) {
    throw new Error(`Destino ausente de \`filiais\`: "${PARA}".\n   Sem essa linha o nome oficial não existe para o servidor.`);
  }
  if (unidadesCasam(DE, PARA)) {
    throw new Error('A grafia de origem já casa com a oficial — nada a fazer.');
  }
  if (mesmaEscola(DE, PARA)) {
    throw new Error('`mesmaEscola` diz que já é a mesma escola — nada a fazer.');
  }

  const volAntes = await volumePorUnidade();
  const qtdEquip = volAntes.get(DE) || 0;

  const { data: usuarios, error: errUsuarios } = await db.from('usuarios').select('email,nivel,filial,status');
  if (errUsuarios) throw errUsuarios;
  const alvos = usuarios.filter((u) => u.filial === DE);

  const { data: sessoes, error: errSessoes } = await db.from('sessoes').select('token,email,filial,expira_em');
  if (errSessoes) throw errSessoes;
  const sessoesAfetadas = sessoes.filter((s) => s.filial === DE);

  const { data: emprestimos } = await db.from('emprestimos').select('id,unidade').eq('unidade', DE);

  if (!qtdEquip && !alvos.length && !emprestimos?.length) {
    throw new Error(`Nada gravado com a grafia "${DE}" em equipamentos, usuários ou empréstimos.`);
  }

  // ---- MEDIÇÃO ANTES ----
  const volDepois = volumeProjetado(volAntes, DE, PARA, qtdEquip);
  const antes = alvos.map((u) => ({ u, n: visiveis(volAntes, u.filial, u.nivel) }));
  const depois = alvos.map((u) => ({ u, n: visiveis(volDepois, PARA, u.nivel) }));

  console.log('── ANTES ───────────────────────────────────────────────────────');
  console.log(`  equipamento "${DE}": ${qtdEquip}`);
  console.log(`  equipamento "${PARA}": ${volAntes.get(PARA) || 0}`);
  console.log(`  usuários na grafia antiga: ${alvos.length}`);
  console.log(`  sessões na grafia antiga: ${sessoesAfetadas.length}`);
  if (emprestimos?.length) console.log(`  empréstimos na grafia antiga: ${emprestimos.length}`);

  // ---- MEDIÇÃO DEPOIS (o que vai acontecer se der certo) ----
  console.log('\n── O QUE VAI ACONTECER ─────────────────────────────────────────');
  let perdeu = false;
  for (let i = 0; i < alvos.length; i += 1) {
    const { u } = antes[i];
    const bom = depois[i].n >= antes[i].n;
    if (!bom) perdeu = true;
    console.log(
      `  ${bom ? '✔' : '❌'} ${u.email.padEnd(46)} [${u.nivel}] ${antes[i].n} -> ${depois[i].n}`,
    );
  }
  if (!alvos.length) console.log('  (nenhum usuário afetado)');
  if (perdeu) {
    throw new Error('Algum usuário perderia equipamentos. NÃO aplicando — corrija o par --de/--para.');
  }

  if (!APLICAR) {
    console.log('\n🟡 Nada gravado. Rode com --aplicar.\n');
    return;
  }

  // ---- GRAVANDO ----
  // Registra o que foi tocado ANTES de gravar: sem isso o rollback não sabe
  // o que desfazer (e desfazer "tudo que está no nome oficial" estraga o que
  // já estava certo).
  const touched = { equipamentos: [], emprestimos: [], usuarios: [], sessoes: [] };

  const revert = async () => {
    for (const id of touched.equipamentos) {
      await db.from('equipamentos').update({ unidade: DE }).eq('id', id);
    }
    for (const id of touched.emprestimos) {
      await db.from('emprestimos').update({ unidade: DE }).eq('id', id);
    }
    for (const email of touched.usuarios) {
      await db.from('usuarios').update({ filial: DE, atualizado_em: new Date().toISOString() }).eq('email', email);
    }
    for (const token of touched.sessoes) {
      await db.from('sessoes').update({ filial: DE }).eq('token', token);
    }
  };

  try {
    // 1) tudo que está na grafia antiga, por id — `unidadesCasam` não serve
    //    aqui: o objetivo é mover a grafia EXATA, não o que "se parece" com ela.
    for (const tabela of ['equipamentos', 'emprestimos']) {
      const { data, error } = await db
        .from(tabela)
        .update({ unidade: PARA })
        .eq('unidade', DE)
        .select('id');
      if (error) throw new Error(`${tabela}: ${error.message}`);
      touched[tabela].push(...data.map((r) => r.id));
      console.log(`  ✔ ${tabela}: ${data.length} registro(s) -> "${PARA}"`);
    }

    // 2) usuários e sessões IMEDIATAMENTE depois: é o que fecha a janela em
    //    que o equipamento já mudou mas o usuário ainda não.
    for (const { u } of antes) {
      const { error } = await db
        .from('usuarios')
        .update({ filial: PARA, atualizado_em: new Date().toISOString() })
        .eq('email', u.email);
      if (error) throw new Error(`usuarios/${u.email}: ${error.message}`);
      touched.usuarios.push(u.email);
      console.log(`  ✔ usuarios: ${u.email}`);
    }

    for (const s of sessoesAfetadas) {
      const { error } = await db.from('sessoes').update({ filial: PARA }).eq('token', s.token);
      if (error) throw new Error(`sessoes/${s.email}: ${error.message}`);
      touched.sessoes.push(s.token);
    }
    console.log(`  ✔ sessoes: ${sessoesAfetadas.length}`);
  } catch (e) {
    console.error(`\n❌ FALHOU: ${e.message}\n↩️  revertendo...`);
    await revert();
    console.error('✅ Revertido ao estado anterior.');
    process.exitCode = 1;
    return;
  }

  // ---- MEDIÇÃO DEPOIS (no banco, não projetado) ----
  const volReal = await volumePorUnidade();
  const { data: usuariosDepois } = await db.from('usuarios').select('email,nivel,filial');
  console.log('\n── DEPOIS ──────────────────────────────────────────────────────');
  let ok = true;
  for (const { u } of antes) {
    const atual = usuariosDepois.find((x) => x.email === u.email);
    if (!atual) { ok = false; console.log(`  ❌ ${u.email} sumiu de usuarios`); continue; }
    const n = visiveis(volReal, atual.filial, atual.nivel);
    const esperado = depois.find((d) => d.u.email === u.email).n;
    const bom = n === esperado && n >= antes.find((a) => a.u.email === u.email).n;
    if (!bom) ok = false;
    console.log(`  ${bom ? '✔' : '❌'} ${u.email.padEnd(46)} filial="${atual.filial}" vê ${n}`);
  }
  console.log(`\n  equipamento "${DE}": ${volReal.get(DE) || 0}`);
  console.log(`  equipamento "${PARA}": ${volReal.get(PARA) || 0}`);

  if (!ok) {
    console.error('\n❌ Alguém perdeu acesso. Revertendo...');
    await revert();
    console.error('✅ Revertido.');
    process.exitCode = 1;
    return;
  }

  console.log('\n✅ Migrado. Todo mundo mantém (ou ganha) o acesso.');
  console.log('   O histórico de alterações (historico_itens) não é reescrito — é o registro do que houve.');
  console.log('   A entrada em mapa-unidades.js impede a grafia antiga de voltar por cadastro antigo.\n');
}

main().catch((e) => {
  console.error('\n❌ Erro:', e.message);
  process.exit(1);
});