function emManutencao() {
  const agora = new Date();
  const inicio = new Date(agora);
  inicio.setHours(17, 0, 0, 0);
  const fim = new Date(agora);
  fim.setHours(20, 0, 0, 0);
  return agora >= inicio && agora <= fim;
}

if (emManutencao() && !window.location.pathname.endsWith('maintenance.html')) {
  window.location.replace('/maintenance.html');
}
