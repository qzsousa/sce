/**
 * Padroniza `usuarios.filial` para o nome OFICIAL da unidade.
 *
 * Por que isso trava o painel de equipamentos
 * -------------------------------------------
 * `equipamentos.unidade` e `filiais` (fonte do nome oficial) JÁ usam o nome
 * padronizado. A tabela `usuarios` ficou com a grafia antiga do cadastro do
 * Google Sheets. O SSO do portal resolve a sessão por e-mail e monta
 * `session.filial` a partir daqui (server.js -> trySsoSession), e o filtro de
 * `/api/equipamentos-da-filial` compara esse texto com `equipamentos.unidade`
 * por `sessaoTemAcessoAUnidade` -> `unidadesCasam`. Grafia diferente = zero
 * equipamentos devolvidos, mesmo com o parque inteiro cadastrado.
 *
 *     "Francisco De Assis Pires Correa Prof" -> FRANCISCO DE ASSIS PIRES CORREA PROF
 *     "E.E. FRANCISCO DE ASSIS P. CORRÊA"   -> FRANCISCO DE ASSIS P CORREA
 *
 * Cada par foi conferido: a escola existe em `filiais`, tem equipamentos, e a
 * grafia antiga NÃO casa com a oficial. O destino é validado contra `filiais`
 * antes de qualquer escrita.
 *
 * Este script corrige direto a tabela do SCE — inclusive usuários que só
 * existem aqui (órfãos do portal, que o sync portal->SCE nunca alcança).
 * Para a fonte da verdade (`Usuario.filial` do portal), ver
 * chamados/backend/padronizar-filial.ts.
 *
 * Uso:  node usuarios-padronizar-filial.js [--aplicar]
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const APLICAR = process.argv.includes('--aplicar');

/** Grafia antiga (em `usuarios.filial`) -> nome oficial (em `filiais`). */
const CORRECOES = [
  { de: 'Francisco De Assis Pires Correa Prof', para: 'E.E. FRANCISCO DE ASSIS P. CORRÊA' },
  { de: 'Sebastiao Faria Zimbres Prof', para: 'E.E. SEBASTIÃO FARIAS ZIMBRES' },
  { de: 'Fernando Mauro Pires Da Rocha Deputado', para: 'E.E. FERNANDO MAURO P. ROCHA, DEPUTADO' },
  { de: 'Zipora Rubinstein Profa', para: 'E.E. ZÍPORA RUBISTEIN' },
  { de: 'Conjunto Habitacional Itaquera IV', para: 'E.E. COHAB ITAQUERA IV' },
  { de: 'Escritor Juan Onetti', para: 'E.E. JUAN CARLOS ONETTI' },
  { de: 'Candido Procopio Ferreira De Camargo Prof', para: 'E.E. CÂNDIDO PROCÓPIO F. CAMARGO' },
  { de: 'Maria De Lourdes Aranha De Assis Pacheco Profa', para: 'E.E. MARIA DE LOURDES A. A. PACHECO / CHIQUINHA GONZAGA' },
  { de: 'Ernestina Del Buono Trama Profa', para: 'E.E. ERNESTINA DEL B. TRAMA' },
  { de: 'Sergio Estanislau Camargo', para: 'E.E. SERGIO ESTANISTLAU DE CAMARGO' },

  // Grafias que hoje funcionam por acaso (a coluna de equipamentos ainda está
  // na grafia antiga). Normalizar é cosmético: o EquipmentCount não muda.
  { de: 'Luiz Vaz De Camoes', para: 'E.E. LUIZ VAZ DE CAMÕES' },
  { de: 'Isaac Schraiber Prof', para: 'E.E. ISAAC SCHRAIBER' },
  { de: 'Mozart Tavares De Lima Prof', para: 'E.E. MOZART TAVARES DE LIMA' },
  { de: 'Ruy De Mello Junqueira', para: 'E.E. RUY DE MELLO JUNQUEIRA' },
  { de: 'Joaquim Silverio Gomes Dos Reis Prof', para: 'E.E. JOAQUIM SILVÉRIO G. DOS REIS' },
  { de: 'Brenno Rossi Maestro', para: 'E.E. BRENO ROSSI, MAESTRO' },
  { de: 'Conjunto Habitacional Carraozinho', para: 'E.E. COHAB CARRÃOZINHO' },
  { de: 'Recanto Verde Sol', para: 'E.E. RECANTO VERDE SOL / DJANIRA' },
  { de: 'Fadlo Haidar', para: 'E.E. FADLO HAIDAR' },
];

/** Mesma normalização de `supabaseService.criarIndiceUnidades`, para conferir o acesso. */
function chaveUnidade(nome) {
  return String(nome || '').trim().toUpperCase()
    .replace(/\bE\.?E\.?\s*/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function unidadesCasam(a, b) {
  const chave = (n) => [chaveUnidade(n), chaveUnidade(String(n || '').split('/')[0])].filter(Boolean);
  const ka = chave(a), kb = chave(b);
  for (const x of ka) for (const y of kb) {
    if (x === y) return true;
    if (x.length > 3 && y.startsWith(x + ' ')) return true;
    if (y.length > 3 && x.startsWith(y + ' ')) return true;
  }
  return false;
}

/** Volume de equipamentos por grafia de unidade (paginação completa). */
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

/** Quantos equipamentos o usuário enxerga — mesmo cálculo de `sessaoTemAcessoAUnidade`. */
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

  console.log(APLICAR ? '🔴 MODO APLICAÇÃO — vai gravar no banco.\n' : '🟡 DRY-RUN — nada será gravado. Use --aplicar para gravar.\n');

  const { data: filiais, error: errF } = await db.from('filiais').select('nome');
  if (errF) throw errF;
  const oficiais = new Set(filiais.map((f) => f.nome));

  // Trava de segurança: todo destino precisa existir em `filiais`.
  const invalidos = CORRECOES.filter((c) => !oficiais.has(c.para));
  if (invalidos.length) {
    console.error('❌ Destino ausente de `filiais` — nada será gravado:');
    for (const c of invalidos) console.error(`   "${c.de}" -> "${c.para}"`);
    process.exitCode = 1;
    return;
  }
  console.log(`✔ ${CORRECOES.length} pares, todos os destinos existem em \`filiais\`\n`);

  // Aviso (não erro): alguns pares JÁ casam — são as grafias que funcionam por
  // acaso porque a coluna de equipamentos ainda está na grafia antiga. Trocar
  // é cosmético. A garantia real é a de equipamento (medida antes/depois).
  const jaCasam = CORRECOES.filter((c) => unidadesCasam(c.de, c.para));
  if (jaCasam.length) {
    console.log(`ℹ  ${jaCasam.length} par(es) já casam hoje (a coluna de equipamento ainda usa a grafia antiga).`);
    console.log('   Trocar é cosmético — o acesso não muda. Serão normalizados assim mesmo.\n');
  } else {
    console.log('✔ Todos os pares estão realmente quebrados (não casam hoje)\n');
  }

  const { data: usuarios, error: errU } = await db.from('usuarios').select('email,nome,nivel,filial,status');
  if (errU) throw errU;

  const plano = [];
  for (const c of CORRECOES) {
    for (const u of usuarios.filter((x) => x.filial === c.de)) {
      plano.push({ ...c, u });
    }
  }

  console.log('── O QUE VAI MUDAR ──────────────────────────────────────────\n');
  let atual = '';
  for (const p of plano) {
    if (p.de !== atual) {
      atual = p.de;
      console.log(`  "${p.de}"\n     -> "${p.para}"`);
    }
    console.log(`       ${p.u.email}  [${p.u.nivel}/${p.u.status}]`);
  }

  const vazios = CORRECOES.filter((c) => !plano.some((p) => p.de === c.de));
  if (vazios.length) {
    console.log('\n── SEM USUÁRIO COM ESSA GRAFIA (já corrigido ou inexistente) ──');
    for (const c of vazios) console.log(`  "${c.de}"`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Total: ${plano.length} usuário(s) em ${new Set(plano.map((p) => p.para)).size} unidade(s).`);

  if (!APLICAR) {
    console.log('\n── SIMULAÇÃO DE ACESSO (nenhum usuário pode enxergar MENOS) ──\n');
    const vol = await volumePorUnidade(db);
    let perder = 0;
    for (const p of plano) {
      const antes = visiveis(vol, p.u.filial, p.u.nivel);
      const depois = visiveis(vol, p.para, p.u.nivel);
      const bom = depois >= antes;
      if (!bom) perder++;
      console.log(`  ${bom ? '✔' : '❌'} ${p.u.email.padEnd(46)} ${String(antes).padStart(4)} -> ${String(depois).padStart(4)}`);
    }
    console.log(perder ? `\n❌ ${perder} perderiam acesso — NÃO aplique.` : '\n✔ Nenhum perde acesso.');
    console.log('\n🟡 Nada gravado. Rode com --aplicar para gravar.\n');
    return;
  }

  console.log('\n── GRAVANDO ─────────────────────────────────────────────────\n');

  // Mede ANTES (o mesmo cálculo do servidor) para garantir que a troca só pode
  // manter ou aumentar o acesso — nunca diminuir.
  const volAntes = await volumePorUnidade(db);
  const antes = plano.map((p) => ({ p, n: visiveis(volAntes, p.u.filial, p.u.nivel) }));

  let ok = 0, falhas = 0;
  const feitos = [];
  for (const { p } of antes) {
    const { error } = await db
      .from('usuarios')
      .update({ filial: p.para, atualizado_em: new Date().toISOString() })
      .eq('email', p.u.email);
    if (error) { falhas++; console.error(`  ❌ ${p.u.email}: ${error.message}`); continue; }
    feitos.push(p);
    ok++;
    console.log(`  ✔ ${p.u.email}`);
  }

  // ---- MEDIÇÃO DEPOIS ----
  const volDepois = await volumePorUnidade(db);
  console.log('\n── ANTES -> DEPOIS ──────────────────────────────────────────\n');
  let perdeu = 0;
  for (const { p, n } of antes) {
    const depois = visiveis(volDepois, p.para, p.u.nivel);
    const bom = depois >= n;
    if (!bom) perdeu++;
    console.log(`  ${bom ? '✔' : '❌'} ${p.u.email.padEnd(46)} ${String(n).padStart(4)} -> ${String(depois).padStart(4)}`);
  }

  if (perdeu) {
    console.error(`\n❌ ${perdeu} usuário(s) perderiam acesso. Revertendo...`);
    for (const p of feitos) {
      await db.from('usuarios').update({ filial: p.de }).eq('email', p.u.email);
    }
    console.error('✅ Revertido.');
    process.exitCode = 1;
    return;
  }

  console.log(`\n${ok} usuário(s) padronizado(s).`);
  if (falhas) {
    console.log(`❌ ${falhas} falha(s). Rode de novo — o script é idempotente.`);
    process.exitCode = 1;
  } else {
    console.log('✅ Concluído!');
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });