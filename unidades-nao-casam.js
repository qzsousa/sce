/**
 * Lista os equipamentos cujo nome de unidade (SCE) NÃO casa com o catálogo
 * oficial do chamados — são os que a tela /unidades mostra como
 * "não atribuídos a nenhuma unidade".
 *
 * Reusa:
 *  - SCE:   supabaseService.criarIndiceUnidades (mesmo agrupamento da API)
 *  - catálogo: NOMES_PADRONIZADOS do chamados (extraído do .ts)
 *  - matcher: cópia literal de chaveEscola/casarNomeEscola do portal
 *
 * USO:  node unidades-nao-casam.js
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { readFileSync } from 'fs';
import { criarIndiceUnidades } from './supabaseService.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------- catálogo do chamados (mesmo NOMES_PADRONIZADOS da API /painel) ----------
const src = readFileSync(
  'C:/Users/Pablo/Desktop/chamados/backend/src/services/normalization.ts',
  'utf8',
);
const m = src.match(/export const NOMES_PADRONIZADOS[^=]*= \[([\s\S]*?)\n\]/);
if (!m) throw new Error('NOMES_PADRONIZADOS não encontrado');
const NOMES_PADRONIZADOS = eval(`[${m[1]}]`);

const canonEspacos = (s) => s.replace(/\s+/g, ' ').replace(/\s*\/\s*/g, ' / ').trim();
const chavesCatalogo = []; // chaves do painel: nome da mãe + grupo de cada entrada
for (const entrada of NOMES_PADRONIZADOS) {
  const partes = canonEspacos(entrada).split(' / ').filter(Boolean);
  if (partes.length < 2) {
    chavesCatalogo.push(canonEspacos(entrada));
  } else {
    const a = partes[0];
    const bNome = partes.slice(1).join(' / ');
    const grupo = `${a} / ${bNome.replace(/^E\.?E\.?\s+/i, '')}`;
    chavesCatalogo.push(a, grupo);
  }
}

// ---------- matcher do portal (cópia literal de src/utils/escola.ts) ----------
function chaveEscola(nome) {
  return (nome || '')
    .toUpperCase()
    .replace(/^E\.?E\.?\s*/i, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function semHonorificos(chave) {
  return chave.replace(/\s+(PROF(A)?|DR(A)?|DEPUTAD[OA]|PRESIDENTE|MAESTRO)$/, '').trim();
}
function casarNomeEscola(nomeSce, padronizados) {
  const k = chaveEscola(nomeSce);
  if (!k) return null;
  const kSem = semHonorificos(k);
  for (const p of padronizados) if (chaveEscola(p) === k) return p;
  for (const p of padronizados)
    if (chaveEscola(p) === kSem || semHonorificos(chaveEscola(p)) === kSem) return p;
  for (const p of padronizados) {
    const pk = chaveEscola(p);
    if (k.startsWith(pk) || pk.startsWith(kSem) || pk.startsWith(k)) return p;
  }
  return null;
}

// ---------- agrega equipamentos por unidade oficial (igual /unidades-resumo) ----------
const { data: filiais, error: errFiliais } = await supabase.from('filiais').select('nome');
if (errFiliais) throw new Error(errFiliais.message);
const indice = criarIndiceUnidades((filiais || []).map((f) => f.nome));

const porUnidade = new Map();
let offset = 0;
for (;;) {
  const { data, error } = await supabase
    .from('equipamentos')
    .select('unidade, status')
    .neq('status', 'Removido')
    .range(offset, offset + 999);
  if (error) throw new Error(error.message);
  for (const eq of data || []) {
    const chave = indice.agrupar(eq.unidade);
    const u = porUnidade.get(chave) || { nome: chave, total: 0 };
    u.total += 1;
    porUnidade.set(chave, u);
  }
  if (!data || data.length < 1000) break;
  offset += 1000;
}

// ---------- quem não casa com o catálogo ----------
const semCasa = [...porUnidade.values()]
  .filter((u) => !casarNomeEscola(u.nome, chavesCatalogo))
  .sort((a, b) => b.total - a.total);

console.log(`\nUnidades do SCE sem correspondência no catálogo do chamados: ${semCasa.length}\n`);
let total = 0;
for (const u of semCasa) {
  total += u.total;
  // sugestão: entrada do catálogo mais próxima por tokens compartilhados
  const k = chaveEscola(u.nome);
  const tokens = new Set(k.split(' ').filter((t) => t.length > 2));
  let melhor = null;
  let melhorScore = 0;
  for (const c of NOMES_PADRONIZADOS) {
    const kc = chaveEscola(c);
    const score = kc.split(' ').filter((t) => tokens.has(t)).length;
    if (score > melhorScore) {
      melhorScore = score;
      melhor = c;
    }
  }
  console.log(`  ${String(u.total).padStart(4)} eq — "${u.nome}"`);
  if (melhor && melhorScore > 0) console.log(`       sugestão: "${melhor}"`);
}
console.log(`\nTotal: ${total} equipamento(s) não atribuídos\n`);
