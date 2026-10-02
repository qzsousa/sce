/**
 * Atualiza `sessoes.filial` — a CÓPIA do filial guardada no login.
 *
 * POR QUE ISSO EXISTE
 * `validateSession` (server.js) monta a sessão a partir da linha de `sessoes`,
 * usando `filial: row.filial` — a cópia gravada no momento do login — e NÃO
 * o `usuarios.filial` atual. Então corrigir `usuarios` não alcança uma sessão
 * já aberta: ela continua com o nome velho e o usuário continua sem acesso.
 *
 * Correção definitiva é no código (resolver `filial` a partir de `usuarios`,
 * como já é feito com `papelUnidade`). Este script alivia o sintoma sem
 * derrubar ninguém: mantém a sessão válida e só troca o texto.
 *
 * Uso: node sessoes-atualizar-filial.js [--aplicar]
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const APLICAR = process.argv.includes('--aplicar');

async function main() {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log(APLICAR ? '🔴 MODO APLICAÇÃO\n' : '🟡 DRY-RUN\n');

  const { data: usuarios } = await db.from('usuarios').select('email,filial,status');
  const porEmail = new Map(usuarios.map((u) => [String(u.email).toLowerCase(), u]));

  const { data: sessoes } = await db.from('sessoes').select('token,email,filial,expira_em');
  const agora = Date.now();

  const divergentes = [];
  for (const s of sessoes) {
    const exp = new Date(s.expira_em).getTime();
    if (isNaN(exp) || agora > exp) continue; // expirada: irrelevante
    const u = porEmail.get(String(s.email || '').toLowerCase());
    if (!u) continue;
    if (String(s.filial || '') === String(u.filial || '')) continue;
    divergentes.push({ s, atual: u.filial });
  }

  console.log('── SESSÕES VÁLIDAS COM FILIAL DIVERGENTE DE `usuarios` ────────\n');
  if (!divergentes.length) { console.log('  (nenhuma)'); return; }
  for (const d of divergentes) {
    console.log(`  ${String(d.s.email).padEnd(46)} expira ${d.s.expira_em}`);
    console.log(`      sessão: "${d.s.filial}"`);
    console.log(`      usuário: "${d.atual}"`);
  }
  console.log(`\nTotal: ${divergentes.length} sessão(ões).`);

  if (!APLICAR) { console.log('\n🟡 Nada gravado. Use --aplicar.\n'); return; }

  console.log('\n── GRAVANDO ──────────────────────────────────────────────────\n');
  let ok = 0, falhas = 0;
  for (const d of divergentes) {
    const { error } = await db.from('sessoes').update({ filial: d.atual }).eq('token', d.s.token);
    if (error) { falhas++; console.error(`  ❌ ${d.s.email}: ${error.message}`); continue; }
    ok++;
    console.log(`  ✔ ${d.s.email} -> "${d.atual}"`);
  }
  console.log(`\n${ok} sessão(ões) atualizada(s).`);
  if (falhas) { console.log(`❌ ${falhas} falha(s).`); process.exitCode = 1; }
  else console.log('✅ Concluído — ninguém precisa deslogar.');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });