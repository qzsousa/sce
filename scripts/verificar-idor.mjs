/**
 * Prova ao vivo da correção de IDOR no SCE, usando SSO real.
 *
 * 1. Lê um usuário de nível Filial/AdminFilial direto do Supabase (service role)
 * 2. Emite um JWT de acesso com o SSO_SECRET (o mesmo caminho que o portal usa)
 * 3. Lista os equipamentos que a sessão enxerga
 * 4. Tenta ler histórico/manutenção de um equipamento de OUTRA escola
 *
 * Antes da correção, o passo 4 devolvia 200 com os dados.
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.SCE_URL || 'http://localhost:3000';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

if (!process.env.SSO_SECRET) {
  console.error('SSO_SECRET ausente — não dá para testar o SSO.');
  process.exit(1);
}

const hoje = new Date(Date.now() + 15 * 60 * 1000);

function tokenPara(u) {
  return jwt.sign(
    {
      sub: u.email,
      email: u.email,
      nome: u.nome,
      nivel: 'ADMIN',        // o nível no payload não importa: o SCE resolve na tabela própria
      filial: u.filial,
      type: 'access',
      iss: 'sci-chamados',
      aud: 'portal',
    },
    process.env.SSO_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' },
  );
}

async function get(path, token) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const texto = await res.text();
  let corpo;
  try { corpo = JSON.parse(texto); } catch { corpo = texto; }
  return { status: res.status, corpo };
}

const { data: usuarios, error: errU } = await admin
  .from('usuarios')
  .select('email, nome, nivel, filial, status')
  .eq('status', 'Ativo')
  .neq('nivel', 'Matriz')
  .limit(5);

if (errU || !usuarios?.length) {
  console.error('Não foi possível ler usuários:', errU?.message);
  process.exit(1);
}

const u = usuarios[0];
console.log(`\nSessão SSO simulada: ${u.email}  (nível=${u.nivel}, filial=${u.filial})\n`);

const token = tokenPara(u);

// --- 1. o SSO autentica? ---
const listas = await get('/api/listas-cadastro', token);
console.log(`1. SSO autentica ...................... HTTP ${listas.status}`);

// --- 2. a listagem respeita a filial? ---
const meus = await get('/api/equipamentos-da-filial', token);
const meusEquip = meus.corpo?.data ?? [];
console.log(`2. /equipamentos-da-filial ............. HTTP ${meus.status}  ${meusEquip.length} equipamento(s)`);

const minhasUnidades = new Set(meusEquip.map((e) => e.unidade));
console.log(`   unidades visiveis: ${[...minhasUnidades].join(' | ') || '(nenhuma)'}`);

// --- 3. IDOR: histórico de equipamento de outra escola ---
const { data: alheio } = await admin
  .from('equipamentos')
  .select('id, unidade, patrimonio')
  .neq('status', 'Removido')
  .limit(500);

const foraDoEscopo = (alheio || []).find((e) => !minhasUnidades.has(e.unidade));

if (!foraDoEscopo) {
  console.log('\n3. IDOR ................................. sem equipamento de outra escola para testar');
} else {
  console.log(`\n3. IDOR — equipamento de "${foraDoEscopo.unidade}" (fora do escopo da sessão)`);

  // O SCE responde HTTP 200 com `success:false` para erro de negócio
  // (contrato que o frontend consome via `unwrap()`), então o bloqueio se
  // prova por `success === false`, não pelo status.
  for (const [rota, rotulo] of [
    [`/api/historico-equipamento?equipamentoId=${encodeURIComponent(foraDoEscopo.id)}`, 'historico-equipamento '],
    [`/api/registros-manutencao?equipamentoId=${encodeURIComponent(foraDoEscopo.id)}`, 'registros-manutencao '],
  ]) {
    const r = await get(rota, token);
    const dados = r.corpo?.data;
    const vazou = Array.isArray(dados) && dados.length > 0;
    const veredito = r.corpo?.success === false || !vazou ? 'BLOQUEADO' : '*** VAZOU ***';
    console.log(`   ${rotulo} -> ${veredito.padEnd(14)} ${r.corpo?.error ?? `${dados?.length ?? 0} registro(s) expostos`}`);
  }

  const emp = await fetch(`${BASE}/api/registrar-emprestimo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ids: [foraDoEscopo.id], responsavel: 'Teste IDOR', cpf: '00000000000' }),
  });
  const empCorpo = await emp.json();
  console.log(`   registrar-emprestimo    -> ${(empCorpo.success === false ? 'BLOQUEADO' : '*** PERMITIDO ***').padEnd(14)} ${empCorpo.error || 'ok'}`);

  for (const [path, rotulo] of [
    ['equipamentos/qualquer-coisa.pdf', 'fora do prefixo boletins/'],
    ['boletins/../../../etc/passwd', 'path traversal'],
    ['boletins/lixo.pdf', 'formato invalido'],
  ]) {
    const anexo = await get(`/api/anexo-url?path=${encodeURIComponent(path)}`, token);
    const v = anexo.corpo?.success === false ? 'BLOQUEADO' : '*** PERMITIDO ***';
    console.log(`   anexo-url ${rotulo.padEnd(24)} -> ${v}`);
  }

  const mv = await fetch(`${BASE}/api/update-equipamento`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: foraDoEscopo.id, unidade: 'ESCOLA INVENTADA', patrimonio: 'HACK-1' }),
  });
  const mvCorpo = await mv.json();
  console.log(`   update-equipamento (mover p/ outra escola) -> ${(mvCorpo.success === false ? 'BLOQUEADO' : '*** PERMITIDO ***').padEnd(14)} ${mvCorpo.error || 'ok'}`);
}

console.log();
