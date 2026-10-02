/**
 * Verificação dos primitivos de segurança do SCE (sem banco de dados).
 *
 *   node scripts/verificar-seguranca.mjs
 */
import assert from 'node:assert/strict';
import {
  escaparFiltroPostgrest,
  normalizarCaminhoAnexo,
  politicaSenha,
  extrairToken,
  corsOptions,
  validarAnexoBoletim,
} from '../security.js';

let passou = 0;
const falhas = [];

function teste(nome, fn) {
  try {
    fn();
    passou++;
    console.log(`  ok   ${nome}`);
  } catch (e) {
    falhas.push({ nome, erro: e.message });
    console.log(`  FALHA ${nome}\n       ${e.message}`);
  }
}

console.log('\n== Filtro PostgREST (injeção via busca) ==');

/** O PostgREST separa valores de `or=` por vírgula não escapada. */
teste('vírgula do termo de busca não injeta filtro novo', () => {
  const b = escaparFiltroPostgrest('x,unidade.eq.EscolaSecreta');
  // A vírgula precisa chegar ao PostgREST escapada com `\`.
  assert.ok(b.includes('\\,'), `vírgula deveria estar escapada, veio: ${b}`);
  assert.ok(b.includes('\\.'), `ponto deveria estar escapado, veio: ${b}`);
  // Nenhum separador de filtro em branco (que abriria um novo `col.op.valor`).
  assert.equal(/[^\\],/.test(b), false, `vírgula sem escape em: ${b}`);
});

teste('abreviação/wildcard é removido', () => {
  assert.equal(escaparFiltroPostgrest('*'), '');
  assert.equal(escaparFiltroPostgrest('a*b'), 'ab');
});

teste('aspas são removidas e parênteses escapadas', () => {
  const b = escaparFiltroPostgrest(`a"b(c)d`);
  assert.ok(!b.includes('"'), `aspas deveriam sair, veio: ${b}`);
  assert.ok(b.includes('\\(') && b.includes('\\)'), `parênteses deveriam estar escapados, veio: ${b}`);
  assert.equal(/\(/.test(b.replace(/\\\(/g, '')), false);
});

teste('busca normal continua intacta', () => {
  assert.equal(escaparFiltroPostgrest('Notebook Dell 15'), 'Notebook Dell 15');
});

console.log('\n== Caminho de anexo (bucket privado) ==');

teste('caminho de B.O. válido passa', () => {
  const p = 'boletins/2b1f0c7a-1111-2222-3333-444455556666-anexo.pdf';
  assert.equal(normalizarCaminhoAnexo(p), p);
});

teste('arquivo fora do prefixo boletins/ é recusado', () => {
  assert.equal(normalizarCaminhoAnexo('outros/algo.pdf'), null);
});

teste('traversal é recusado', () => {
  assert.equal(normalizarCaminhoAnexo('boletins/../../usuarios.pdf'), null);
  assert.equal(normalizarCaminhoAnexo('boletins/%2e%2e/x.pdf'), null);
});

teste('caminho malformado é recusado', () => {
  assert.equal(normalizarCaminhoAnexo('boletins/x.pdf'), null);
  assert.equal(normalizarCaminhoAnexo(''), null);
  assert.equal(normalizarCaminhoAnexo(null), null);
});

console.log('\n== Política de senha ==');

teste('senha curta demais é recusada', () => {
  assert.equal(politicaSenha.validar('Ab1').valida, false);
});

teste('senha sem maiúscula é recusada', () => {
  const r = politicaSenha.validar('senha1234');
  assert.equal(r.valida, false);
  assert.ok(r.erros.some((e) => e.includes('maiúscula')));
});

teste('senha simples de 6 caracteres era aceita antes e agora não é', () => {
  // Antes: `length >= 6` era o único requisito.
  assert.equal('abc123'.length >= 6, true);
  assert.equal(politicaSenha.validar('abc123').valida, false);
});

teste('senha forte passa', () => {
  assert.equal(politicaSenha.validar('Chamado@2026').valida, true);
});

console.log('\n== Transporte do token ==');

teste('header Authorization é a via preferida', () => {
  const req = { headers: { authorization: 'Bearer abc.def.ghi' }, query: {} };
  assert.equal(extrairToken(req), 'abc.def.ghi');
});

teste('query string é aceita fora de produção (legado)', () => {
  const anterior = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const req = { headers: {}, query: { token: 'legado' } };
  assert.equal(extrairToken(req), 'legado');
  process.env.NODE_ENV = anterior;
});

teste('query string é REJEITADA em produção', () => {
  const anterior = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const req = { headers: {}, query: { token: 'vaza-em-log' } };
  assert.equal(extrairToken(req), null);
  process.env.NODE_ENV = anterior;
});

teste('sem token retorna null', () => {
  assert.equal(extrairToken({ headers: {}, query: {} }), null);
});

console.log('\n== CORS ==');

teste('origem desconhecida é negada', () => {
  const opts = corsOptions();
  let permitido = null;
  opts.origin('https://site-malicioso.example', (_e, v) => { permitido = v; });
  assert.equal(permitido, false);
});

teste('origem configurada é liberada', () => {
  const opts = corsOptions();
  let permitido = null;
  opts.origin(process.env.FRONTEND_URL || 'http://localhost:5173', (_e, v) => { permitido = v; });
  assert.equal(permitido, true);
});

teste('requisição sem Origin (curl) é liberada', () => {
  const opts = corsOptions();
  let permitido = null;
  opts.origin(undefined, (_e, v) => { permitido = v; });
  assert.equal(permitido, true);
});

console.log('\n== Anexo do B.O. (XSS armazenado) ==');

teste('HTML disfarçado de PDF é recusado', () => {
  const html = Buffer.from('<script>alert(1)</script>').toString('base64');
  const r = validarAnexoBoletim(html);
  assert.equal(r.ok, false);
});

teste('PDF real é aceito', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(64)]).toString('base64');
  const r = validarAnexoBoletim(pdf);
  assert.equal(r.ok, true);
  assert.equal(r.extensao, 'pdf');
});

teste('PNG real é aceito', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
  ]).toString('base64');
  const r = validarAnexoBoletim(png);
  assert.equal(r.ok, true);
  assert.equal(r.mimeType, 'image/png');
});

console.log(`\n${'='.repeat(52)}`);
console.log(`${passou} passaram, ${falhas.length} falharam`);
if (falhas.length) {
  process.exitCode = 1;
}
