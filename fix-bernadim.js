import { supabase } from './supabaseService.js';

const APLICAR = process.argv.includes('--aplicar');
const DE = 'E.E. BERNADIM RIBEIRO';
const PARA = 'E.E. BERNARDIM RIBEIRO';

const fil = await supabase.from('filiais').select('*').ilike('nome', '%BERNADIM%');
const eq = await supabase.from('equipamentos').select('id, unidade').or('unidade.ilike.%BERNADIM%,unidade.ilike.%Bernardim Ribeiro%');
const usu = await supabase.from('usuarios').select('email, filial').or('filial.ilike.%BERNADIM%,filial.ilike.%Bernardim Ribeiro%');

console.log('filiais:', fil.data?.map((f) => f.nome));
console.log('equipamentos:', eq.data?.length, [...new Set(eq.data?.map((e) => e.unidade))]);
console.log('usuarios:', usu.data?.length, [...new Set(usu.data?.map((u) => u.filial))]);

if (!APLICAR) { console.log('Dry-run. Rode com --aplicar para gravar.'); process.exit(0); }

const r1 = await supabase.from('filiais').update({ nome: PARA }).ilike('nome', '%BERNADIM%');
const r2 = await supabase.from('equipamentos').update({ unidade: PARA }).or('unidade.ilike.%BERNADIM%,unidade.ilike.Bernardim Ribeiro');
const r3 = await supabase.from('usuarios').update({ filial: PARA }).or('filial.ilike.%BERNADIM%,filial.ilike.Bernardim Ribeiro');
console.log('erros:', r1.error?.message, r2.error?.message, r3.error?.message);

const fil2 = await supabase.from('filiais').select('nome').ilike('nome', '%BERNARDIM%');
const eq2 = await supabase.from('equipamentos').select('unidade').ilike('unidade', '%BERNARDIM%');
console.log('depois filiais:', fil2.data?.map((f) => f.nome), 'equipamentos na escola:', eq2.data?.length);
