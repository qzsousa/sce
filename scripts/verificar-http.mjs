const BASE = 'http://localhost:3000';

async function probe(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const texto = await res.text();
  return { status: res.status, corpo: texto.slice(0, 120) };
}

function post(path, body) {
  return probe(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

console.log('== Rate limit em /api/login-password (antes: ilimitado) ==');
const codes = [];
for (let i = 1; i <= 14; i++) {
  const r = await post('/api/login-password', { email: 'bruteforce@teste.com', password: 'errada123' });
  codes.push(r.status);
}
console.log('  respostas:', codes.join(', '));
const primeira429 = codes.indexOf(429);
console.log(`  bloqueado a partir da tentativa: ${primeira429 + 1} (limite = 10/15min)`);
console.log(`  ${primeira429 > 0 ? 'OK  rate limit ativo' : 'FALHA sem limite'}`);

console.log('\n== Enumeracao de usuarios em /api/verificar-usuario ==');
for (const email of ['nao-existe@teste.com', 'admin@ure.leste3.sp.gov.br']) {
  const r = await post('/api/verificar-usuario', { email });
  console.log(`  ${email.padEnd(34)} HTTP ${r.status}  ${r.corpo}`);
}
console.log('  (antes o 2o devolvia nome e nivel — perfil de acesso de cada usuario)');

console.log('\n== Politica de senha em /api/definir-senha ==');
for (const senha of ['abc123', 'Senha@2026']) {
  const r = await post('/api/definir-senha', { email: 'novo@teste.com', password: senha });
  console.log(`  "${senha}".padEnd(14) HTTP ${r.status}  ${r.corpo}`);
}
console.log('  (antes: 6 caracteres era suficiente)');
