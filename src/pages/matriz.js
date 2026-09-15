// ============================================================================
// DASHBOARD MATRIZ — Acesso global a todos os equipamentos
// ============================================================================

import {
  initDashboardBase,
  getToken,
  getAuthHeaders,
  showLoading,
  hideLoading,
  toastSuccess,
  toastError,
  setButtonLoading,
  isButtonLoading,
  downloadCsv,
  getApiBaseUrl,
  abrirCadastroEquipamento,
  exportarCSVUI,
  exportarPDFUI,
  editarEquipamento,
  abrirHistorico,
  abrirModalRemocao,
  salvarCadastro,
  salvarEdicao,
  confirmarRemocao,
  atualizarKpis,
  registrarManutencaoUI,
  setCarregarEquipamentos,
  setEquipamentosCache,
} from './dashboard-base.js';
import { setupSelectCascata, getListasCache } from '../shared/js/lists.js';
import { redefinirSenha } from '../shared/js/api.js';

// Expor funções globais para onclick no HTML (executar imediatamente no load do módulo)
window.editarEquipamento = editarEquipamento;
window.abrirHistorico = abrirHistorico;
window.abrirModalRemocao = abrirModalRemocao;
window.editarUsuarioUI = editarUsuarioUI;
window.removerUsuarioUI = removerUsuarioUI;
window.redefinirSenhaUI = redefinirSenhaUI;
window.abrirCadastroEquipamento = abrirCadastroEquipamento;
window.carregarEquipamentosGlobal = carregarEquipamentosGlobal;
window.exportarCSVUI = exportarCSVUI;
window.exportarPDFUI = exportarPDFUI;
window.excluirSelecionados = excluirSelecionados;
window.abrirAlterarStatusLote = abrirAlterarStatusLote;
window.confirmarAlterarStatusLote = confirmarAlterarStatusLote;
window.abrirGestaoUsuarios = abrirGestaoUsuarios;
window.adicionarUsuarioUI = adicionarUsuarioUI;
window.registrarManutencaoUI = registrarManutencaoUI;
window.salvarCadastro = salvarCadastro;
window.salvarEdicao = salvarEdicao;
window.confirmarRemocao = confirmarRemocao;

// ============================================================================
// ESTADO ESPECÍFICO MATRIZ
// ============================================================================

let SESSION_EMAIL = ''; // Preenchido via get-nome-usuario

let idPendenteRemocao = null;
let modalRemocaoInstance = null;
let modalEdicaoInstance = null;
let modalCadastroInstance = null;
let modalUsuariosInstance = null;
let modalManutencaoInstance = null;
let modalStatusLoteInstance = null;
let modalHistoricoInstance = null;
let modalRedefinirSenhaInstance = null;
let itemEmEdicaoOriginal = null;
let equipamentoIdManutencaoAtual = null;
let usuariosCache = [];

let chartStatus = null;
let chartUnidade = null;
let chartCategoria = null;

let equipamentosCache = [];
let totalEquipamentos = 0;
let cacheStats = { porStatus: {}, porUnidade: {}, porCategoria: {} };
let dropdownsInicializados = false;
let campoOrdenacao = '';
let ordemAtual = 'asc';
let paginaAtual = 1;
let limiteExibicao = 100;

async function carregarInfoCabecalho() {
  try {
    const res = await fetch(`${getApiBaseUrl()}/get-nome-usuario`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success && data.data) {
      SESSION_EMAIL = data.data.email || '';
    }
  } catch (e) { /* opcional */ }
}

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🟢 Inicializando Dashboard Matriz...');
  showLoading();
  
  if (window.M) {
    M.FormSelect.init(document.querySelectorAll('select'));
  }
  
  // Inicializa listeners de cascata para categoria/marca/modelo
  setupSelectCascata('new');
  setupSelectCascata('edit');
  
  // Injeta a função de recarga global para o dashboard-base usar após salvar/remover
  // (volta para a página 1 para o item recém-cadastrado aparecer na tela)
  setCarregarEquipamentos(() => { paginaAtual = 1; return carregarEquipamentosGlobal(); });
  
  await initDashboardBase({ perfil: 'Matriz', loadEquipamentos: false });
  inicializarFiltrosRapidos();
  popularFiltroCategoria();
  carregarInfoCabecalho();
  
  // Carrega equipamentos globais (Matriz vê tudo)
  await carregarEquipamentosGlobal();

  // Atualização automática a cada 5 minutos
  setInterval(() => { carregarEquipamentosGlobal(); }, 5 * 60 * 1000);
  
  // Event listeners
  document.getElementById('btn-abrir-gestao-usuarios').addEventListener('click', abrirGestaoUsuarios);
  document.getElementById('btn-abrir-cadastro').addEventListener('click', abrirCadastroEquipamento);
  document.getElementById('btn-atualizar-lista').addEventListener('click', carregarEquipamentosGlobal);
  document.getElementById('btn-salvar-cadastro').addEventListener('click', salvarCadastro);
  document.getElementById('btn-adicionar-usuario').addEventListener('click', adicionarUsuarioUI);
  document.getElementById('btn-salvar-edicao-usuario')?.addEventListener('click', salvarEdicaoUsuario);
  document.getElementById('btn-confirmar-remocao').addEventListener('click', confirmarRemocao);
  document.getElementById('btn-confirmar-redefinir-senha').addEventListener('click', confirmarRedefinirSenha);
  document.getElementById('btn-salvar-edicao').addEventListener('click', salvarEdicao);
  document.getElementById('btn-registrar-manutencao').addEventListener('click', registrarManutencaoUI);
  document.getElementById('btn-exportar-csv').addEventListener('click', exportarCSVUI);
  document.getElementById('btn-exportar-pdf').addEventListener('click', exportarPDFUI);
  document.getElementById('btn-excluir-selecionados').addEventListener('click', excluirSelecionados);
  document.getElementById('btn-alterar-status-lote').addEventListener('click', abrirAlterarStatusLote);
  document.getElementById('btn-confirmar-alterar-status-lote').addEventListener('click', confirmarAlterarStatusLote);

  let buscaDebounceTimer = null;
  document.getElementById('filtro-busca').addEventListener('input', function() {
    clearTimeout(buscaDebounceTimer);
    buscaDebounceTimer = setTimeout(aplicarFiltros, 400);
  });
  document.getElementById('filtro-status').addEventListener('change', aplicarFiltros);
  document.getElementById('seletor-unidade').addEventListener('change', aplicarFiltros);
  document.getElementById('filtro-categoria').addEventListener('change', function() {
    const categoria = this.value;
    popularFiltroMarca(categoria);
    popularFiltroModelo(categoria, document.getElementById('filtro-marca').value);
    aplicarFiltros();
  });
  document.getElementById('filtro-marca').addEventListener('change', function() {
    popularFiltroModelo(document.getElementById('filtro-categoria').value, this.value);
    aplicarFiltros();
  });
  document.getElementById('filtro-modelo').addEventListener('change', aplicarFiltros);
  document.getElementById('limite-exibicao').addEventListener('change', function() {
    limiteExibicao = parseInt(this.value, 10) || 100;
    paginaAtual = 1;
    carregarEquipamentosGlobal();
  });
  
  document.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', function() {
      const campo = this.dataset.sort;
      if (campo) ordenarTabela(campo);
    });
  });
  
  document.getElementById('check-todos').addEventListener('change', function() {
    const checked = this.checked;
    document.querySelectorAll('.check-equipamento').forEach(el => el.checked = checked);
  });

  document.getElementById('btn-pagina-anterior').addEventListener('click', () => mudarPagina(-1));
  document.getElementById('btn-proxima-pagina').addEventListener('click', () => mudarPagina(1));

  hideLoading();
  console.log('✅ Dashboard Matriz inicializado!');
});

// ============================================================================
// CARREGAMENTO DE EQUIPAMENTOS (GLOBAL - MATRIZ, SERVER-SIDE PAGINADO)
// ============================================================================

function montarQueryParams() {
  const params = new URLSearchParams();
  params.set('limite', limiteExibicao);
  params.set('offset', (paginaAtual - 1) * limiteExibicao);
  const busca = (document.getElementById('filtro-busca')?.value || '').trim();
  const status = document.getElementById('filtro-status')?.value || '';
  const unidade = document.getElementById('seletor-unidade')?.value || '';
  const categoria = document.getElementById('filtro-categoria')?.value || '';
  const marca = document.getElementById('filtro-marca')?.value || '';
  const modelo = document.getElementById('filtro-modelo')?.value || '';
  if (busca) params.set('busca', busca);
  if (status) params.set('status', status);
  if (unidade) params.set('unidade', unidade);
  if (categoria) params.set('categoria', categoria);
  if (marca) params.set('marca', marca);
  if (modelo) params.set('modelo', modelo);
  if (campoOrdenacao) {
    params.set('ordem', campoOrdenacao);
    params.set('direcao', ordemAtual);
  }
  return params.toString();
}

async function carregarEquipamentosGlobal() {
  showLoading();
  try {
    const res = await fetch(`${getApiBaseUrl()}/equipamentos-global?${montarQueryParams()}`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const payload = data.data || {};
    equipamentosCache = payload.data || [];
    totalEquipamentos = payload.total || 0;
    cacheStats = payload.stats || { porStatus: {}, porUnidade: {}, porCategoria: {} };
    setEquipamentosCache(equipamentosCache);

    if (!dropdownsInicializados) {
      popularSeletorUnidade(cacheStats.porUnidade);
      popularFiltroStatus(cacheStats.porStatus);
      dropdownsInicializados = true;
    }

    renderTabelaGlobal(equipamentosCache);
    atualizarKpisDeStats(totalEquipamentos, cacheStats.porStatus);
    renderGraficosDeStats(cacheStats);
    atualizarPaginacao();
  } catch (err) {
    console.error('Erro ao carregar:', err);
    toastError('Erro ao carregar: ' + err.message);
  } finally {
    hideLoading();
  }
}

function atualizarPaginacao() {
  const totalPaginas = Math.max(1, Math.ceil(totalEquipamentos / limiteExibicao));
  const info = document.getElementById('pagina-info');
  if (info) info.innerText = `Página ${paginaAtual} de ${totalPaginas} - ${totalEquipamentos} itens`;
  const btnAnt = document.getElementById('btn-pagina-anterior');
  const btnProx = document.getElementById('btn-proxima-pagina');
  if (btnAnt) btnAnt.disabled = paginaAtual <= 1;
  if (btnProx) btnProx.disabled = paginaAtual >= totalPaginas;
  const contador = document.getElementById('contador-equipamentos');
  if (contador) contador.innerText = totalEquipamentos;
}

function mudarPagina(delta) {
  const totalPaginas = Math.max(1, Math.ceil(totalEquipamentos / limiteExibicao));
  const nova = paginaAtual + delta;
  if (nova < 1 || nova > totalPaginas) return;
  paginaAtual = nova;
  carregarEquipamentosGlobal();
}

// ============================================================================
// FILTROS E SELETOR DE UNIDADE
// ============================================================================

function popularSeletorUnidade(porUnidade) {
  const select = document.getElementById('seletor-unidade');
  if (!select) return;
  const unidades = Object.keys(porUnidade || {})
    .filter(u => u && u !== 'Sem unidade')
    .sort();
  select.innerHTML = '<option value="">Todas as unidades</option>' +
    unidades.map(u => `<option value="${u}">${u}</option>`).join('');
  const totalUnidades = document.getElementById('total-unidades');
  if (totalUnidades) totalUnidades.innerText = unidades.length;
}

function popularFiltroStatus(porStatus) {
  const select = document.getElementById('filtro-status');
  if (!select) return;
  const statuses = Object.keys(porStatus || {})
    .filter(s => s && s !== 'Removido')
    .sort();
  select.innerHTML = '<option value="">Todos os status</option>' +
    statuses.map(s => `<option value="${s}">${s}</option>`).join('');
  if (window.M && M.FormSelect) M.FormSelect.init(select);
}

function inicializarFiltrosRapidos() {
  const botoes = document.querySelectorAll('.btn-filtro');
  botoes.forEach(btn => {
    btn.addEventListener('click', function() {
      botoes.forEach(b => b.classList.remove('ativo'));
      this.classList.add('ativo');
      const filtro = this.dataset.filtro;
      const selectStatus = document.getElementById('filtro-status');
      selectStatus.value = filtro === 'todos' ? '' : filtro;
      if (window.M && M.FormSelect) M.FormSelect.init(selectStatus);
      aplicarFiltros();
    });
  });
}

function getIdsSelecionados() {
  return Array.from(document.querySelectorAll('.check-equipamento:checked')).map(el => el.value);
}

// ============================================================================
// FILTROS E ORDENAÇÃO
// ============================================================================

function ordenarTabela(campo) {
  if (campoOrdenacao === campo) {
    ordemAtual = ordemAtual === 'asc' ? 'desc' : 'asc';
  } else {
    campoOrdenacao = campo;
    ordemAtual = 'asc';
  }
  document.querySelectorAll('.sortable').forEach(th => {
    const icon = th.querySelector('.material-icons');
    if (icon) icon.textContent = 'unfold_more';
  });
  const thAtual = document.querySelector('[data-sort="' + campo + '"]');
  if (thAtual) {
    const icon = thAtual.querySelector('.material-icons');
    if (icon) icon.textContent = ordemAtual === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }
  paginaAtual = 1;
  carregarEquipamentosGlobal();
}

function aplicarFiltros() {
  paginaAtual = 1;
  carregarEquipamentosGlobal();
}

// ============================================================================
// FILTROS DE CATEGORIA/MARCA/MODELO (usam listasCache)
// ============================================================================

function popularFiltroCategoria() {
  const select = document.getElementById('filtro-categoria');
  const listasCache = getListasCache();
  if (!select || !listasCache) return;
  const valorAtual = select.value;
  select.innerHTML = '<option value="">Todas</option>' + listasCache.categorias.map(c => `<option value="${c}">${c}</option>`).join('');
  select.value = (valorAtual && listasCache.categorias.indexOf(valorAtual) !== -1) ? valorAtual : '';
}

function popularFiltroMarca(categoria) {
  const select = document.getElementById('filtro-marca');
  const listasCache = getListasCache();
  if (!select || !listasCache) return;
  const valorAtual = select.value;
  let marcas;
  if (categoria) { marcas = Array.from(listasCache.marcasPorCategoria[categoria] || new Set()).sort(); }
  else { const todas = new Set(); Object.keys(listasCache.marcasPorCategoria).forEach(cat => listasCache.marcasPorCategoria[cat].forEach(m => todas.add(m))); marcas = Array.from(todas).sort(); }
  select.innerHTML = '<option value="">Todas</option>' + marcas.map(m => `<option value="${m}">${m}</option>`).join('');
  select.value = (valorAtual && marcas.indexOf(valorAtual) !== -1) ? valorAtual : '';
}

function popularFiltroModelo(categoria, marca) {
  const select = document.getElementById('filtro-modelo');
  const listasCache = getListasCache();
  if (!select || !listasCache) return;
  const valorAtual = select.value;
  let modelos = [];
  const mapa = listasCache.modelosPorCategoriaMarca;
  if (categoria && marca) modelos = Array.from((mapa[categoria] && mapa[categoria][marca]) || new Set()).sort();
  else if (!categoria && marca) { const todos = new Set(); Object.keys(mapa).forEach(cat => { if (mapa[cat][marca]) mapa[cat][marca].forEach(m => todos.add(m)); }); modelos = Array.from(todos).sort(); }
  else if (categoria && !marca) { const todos2 = new Set(); if (mapa[categoria]) { Object.keys(mapa[categoria]).forEach(mk => mapa[categoria][mk].forEach(m => todos2.add(m))); } modelos = Array.from(todos2).sort(); }
  else { const todos3 = new Set(); Object.keys(mapa).forEach(cat => { Object.keys(mapa[cat]).forEach(mk => mapa[cat][mk].forEach(m => todos3.add(m))); }); modelos = Array.from(todos3).sort(); }
  select.innerHTML = '<option value="">Todos</option>' + modelos.map(m => `<option value="${m}">${m}</option>`).join('');
  select.value = (valorAtual && modelos.indexOf(valorAtual) !== -1) ? valorAtual : '';
}

// ============================================================================
// RENDERIZAÇÃO TABELA GLOBAL
// ============================================================================

function renderTabelaGlobal(equipamentos) {
  const tbody = document.querySelector('#tabela-equipamentos-global tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const lista = (limiteExibicao > 0 && equipamentos && equipamentos.length > limiteExibicao)
    ? equipamentos.slice(0, limiteExibicao)
    : (equipamentos || []);

  if (!lista || lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--sce-muted);">🔍 Nenhum equipamento encontrado com os filtros aplicados.</td></tr>';
    return;
  }

  lista.forEach(item => {
    const tr = document.createElement('tr');
    const statusClass = 'status-' + (item.status || '').toLowerCase().replace(/ /g, '-');
    tr.className = statusClass;
    
    tr.innerHTML =
      '<td class="no-print"><label><input type="checkbox" class="check-equipamento" value="' + item.id + '"><span></span></label></td>' +
      '<td class="cell-2lin"><span class="cell-main">' + (item.modelo || '') + '</span><span class="cell-sub">' + (item.categoria || '') + ' · ' + (item.marca || '') + '</span></td>' +
      '<td>' + (item.patrimonio || '') + (item.justificativaPatrimonio ? ' *' : '') + '</td>' +
      '<td>' + (item.numeroSerie || '') + '</td>' +
      '<td>' + (item.unidade || '') + '</td>' +
      '<td><strong>' + (item.status || '') + '</strong></td>' +
      '<td class="no-print">' +
        '<div class="kebab-wrap"><button class="kebab-btn" onclick="toggleKebab(this)"><i class="material-icons">more_vert</i></button><div class="kebab-menu"><a onclick="editarEquipamento(\'' + item.id + '\')"><i class="material-icons">edit</i> Editar</a><a onclick="abrirHistorico(\'' + item.id + '\')"><i class="material-icons">history</i> Histórico</a><a class="danger" onclick="abrirModalRemocao(\'' + item.id + '\')"><i class="material-icons">delete</i> Remover</a></div></div>' +
      '</td>';
    tbody.appendChild(tr);
  });
}

// ============================================================================
// GRÁFICOS E KPIs (MATRIZ)
// ============================================================================

function kpiCard(icone, valor, label, extraClass) {
  return '<div class="col s12 m3">' +
    '<div class="sce-kpi ' + (extraClass || '') + '">' +
      '<div class="sce-kpi-icon"><i class="material-icons">' + icone + '</i></div>' +
      '<div><div class="sce-kpi-value">' + valor + '</div><div class="sce-kpi-label">' + label + '</div></div>' +
    '</div></div>';
}

function atualizarKpisDeStats(total, porStatus) {
  const kpisEl = document.getElementById('kpis');
  if (!kpisEl) return;
  const disponiveis = porStatus['Disponível'] || 0;
  const manutencao = porStatus['Manutenção'] || 0;
  const quebrados = porStatus['Quebrado'] || 0;
  const extraviado = porStatus['Extraviado'] || 0;
  kpisEl.innerHTML =
    kpiCard('devices', total, 'Total', 'kpi-total') +
    kpiCard('check_circle', disponiveis, 'Disponíveis', 'kpi-disponiveis') +
    kpiCard('build', manutencao, 'Manutenção', 'kpi-manutencao') +
    kpiCard('report', quebrados, 'Quebrados', 'kpi-quebrados') +
    kpiCard('assignment_late', extraviado, 'Extraviado', 'kpi-extraviado');
}

function renderGraficosDeStats(stats) {
  const porStatus = stats.porStatus || {};
  const porUnidade = stats.porUnidade || {};
  const porCategoria = stats.porCategoria || {};

  const labelsStatus = Object.keys(porStatus);
  const dataStatus = labelsStatus.map(l => porStatus[l]);
  const coresStatus = ['#1565c0', '#43a047', '#ef6c00', '#d32f2f', '#8e24aa', '#00838f', '#795548', '#607d8b'];
  if (chartStatus) chartStatus.destroy();
  chartStatus = new Chart(document.getElementById('canvas-chart-status').getContext('2d'), {
    type: 'pie', data: { labels: labelsStatus, datasets: [{ data: dataStatus, backgroundColor: coresStatus }] },
    options: { responsive: true, maintainAspectRatio: false }
  });

  const labelsUnidade = Object.keys(porUnidade);
  const dataUnidade = labelsUnidade.map(l => porUnidade[l]);
  const coresUnidade = ['#1b5e20', '#2e7d32', '#388e3c', '#43a047', '#4caf50', '#66bb6a', '#81c784', '#a5d6a7'];
  if (chartUnidade) chartUnidade.destroy();
  chartUnidade = new Chart(document.getElementById('canvas-chart-unidade').getContext('2d'), {
    type: 'pie', data: { labels: labelsUnidade, datasets: [{ data: dataUnidade, backgroundColor: coresUnidade }] },
    options: { responsive: true, maintainAspectRatio: false }
  });

  const labelsCategoria = Object.keys(porCategoria);
  const dataCategoria = labelsCategoria.map(l => porCategoria[l]);
  const coresCategoria = ['#4a148c', '#6a1b9a', '#7b1fa2', '#8e24aa', '#9c27b0', '#ab47bc', '#ba68c8', '#ce93d8'];
  if (chartCategoria) chartCategoria.destroy();
  chartCategoria = new Chart(document.getElementById('canvas-chart-categoria').getContext('2d'), {
    type: 'pie', data: { labels: labelsCategoria, datasets: [{ data: dataCategoria, backgroundColor: coresCategoria }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// ============================================================================
// AÇÕES EM LOTE
// ============================================================================

function excluirSelecionados() {
  const ids = getIdsSelecionados();
  if (ids.length === 0) { toastError('Selecione pelo menos um equipamento.'); return; }
  if (!confirm('Tem certeza que deseja excluir os ' + ids.length + ' equipamento(s)?')) return;
  
  const btn = document.getElementById('btn-excluir-selecionados');
  setButtonLoading(btn, true);
  let concluidos = 0;
  
  ids.forEach(id => {
    fetch(`${getApiBaseUrl()}/remover-equipamento`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ id })
    }).then(() => {
      concluidos++;
      if (concluidos === ids.length) {
        setButtonLoading(document.getElementById('btn-excluir-selecionados'), false);
        toastSuccess('Equipamentos excluídos.');
        carregarEquipamentosGlobal();
      }
    }).catch(err => {
      setButtonLoading(document.getElementById('btn-excluir-selecionados'), false);
      toastError('Erro ao excluir: ' + err.message);
    });
  });
}

function abrirAlterarStatusLote() {
  const ids = getIdsSelecionados();
  if (ids.length === 0) { toastError('Selecione pelo menos um equipamento.'); return; }
  document.getElementById('lote-contagem').innerText = ids.length;
  if (!window.modalStatusLoteInstance && window.M && M.Modal) {
    window.modalStatusLoteInstance = M.Modal.init(document.getElementById('modal-alterar-status-lote'));
  }
  window.modalStatusLoteInstance.open();
}

function confirmarAlterarStatusLote() {
  const btn = document.getElementById('btn-confirmar-alterar-status-lote');
  if (isButtonLoading(btn)) return;
  
  const ids = getIdsSelecionados();
  if (ids.length === 0) { toastError('Nenhum equipamento selecionado.'); return; }
  
  const novoStatus = document.getElementById('lote-novo-status').value;
  setButtonLoading(btn, true);
  let concluidos = 0;
  
  ids.forEach(id => {
    const campos = { status: novoStatus };
    fetch(`${getApiBaseUrl()}/update-equipamento`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ id, ...campos })
    }).then(() => {
      concluidos++;
      if (concluidos === ids.length) {
        setButtonLoading(btn, false);
        toastSuccess('Status atualizado para ' + ids.length + ' equipamento(s).');
        if (window.modalStatusLoteInstance) window.modalStatusLoteInstance.close();
        carregarEquipamentosGlobal();
      }
    }).catch(err => {
      setButtonLoading(btn, false);
      toastError('Erro ao atualizar status: ' + err.message);
      if (window.modalStatusLoteInstance) window.modalStatusLoteInstance.close();
    });
  });
}

// ============================================================================
// USUÁRIOS (MATRIZ)
// ============================================================================

async function abrirGestaoUsuarios() {
  if (!window.modalUsuariosInstance && window.M && M.Modal) {
    window.modalUsuariosInstance = M.Modal.init(document.getElementById('modal-usuarios'));
  }
  window.modalUsuariosInstance.open();
  await carregarUsuarios();
}

async function carregarUsuarios() {
  try {
    const res = await fetch(`${getApiBaseUrl()}/listar-usuarios`, { headers: getAuthHeaders() });
    const data = await res.json();
    usuariosCache = data.data || [];
    filtrarUsuarios();
  } catch (err) { toastError('Erro ao carregar usuários: ' + err.message); }
}

function filtrarUsuarios() {
  const busca = (document.getElementById('busca-usuarios')?.value || '').trim().toLowerCase();
  const filtrados = usuariosCache.filter(u => {
    if (!busca) return true;
    return [u.email, u.nome, u.filial].some(v => (v || '').toLowerCase().includes(busca));
  });
  renderTabelaUsuarios(filtrados);
}
document.getElementById('busca-usuarios')?.addEventListener('input', filtrarUsuarios);

function renderTabelaUsuarios(usuarios) {
  const tbody = document.querySelector('#tabela-usuarios tbody');
  tbody.innerHTML = '';
  if (!usuarios || usuarios.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">Nenhum usuário cadastrado.</td></tr>';
    return;
  }
  usuarios.forEach(u => {
    const isSelf = String(u.email || '').toLowerCase() === SESSION_EMAIL.toLowerCase();
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (u.email || '') + '</td>' +
      '<td>' + (u.nome || '') + '</td>' +
      '<td>' + (u.nivel || '') + '</td>' +
      '<td>' + (u.filial || '') + '</td>' +
      '<td>' + (u.status || '') + '</td>' +
      '<td>' + (u.senhaDefinida === false
        ? '<span style="color:#2e7d32;font-weight:600;">Sim</span>'
        : '<span style="color:var(--sce-muted);">Não</span>') + '</td>' +
      '<td>' + (isSelf ? '' :
        '<a class="btn-small waves-effect" onclick="editarUsuarioUI(\'' + u.email + '\')" title="Editar"><i class="material-icons">edit</i></a> ' +
        '<a class="btn-small waves-effect" onclick="redefinirSenhaUI(\'' + u.email + '\')" title="Redefinir senha"><i class="material-icons">vpn_key</i></a> ' +
        '<a class="btn-small red waves-effect" onclick="removerUsuarioUI(\'' + u.email + '\', this)" title="Remover"><i class="material-icons">delete</i></a>') +
      '</td>';
    tbody.appendChild(tr);
  });
}

function redefinirSenhaUI(email) {
  document.getElementById('rd-email').innerText = email;
  document.getElementById('rd-senha').value = '';
  document.getElementById('rd-senha-confirm').value = '';
  if (!window.modalRedefinirSenhaInstance && window.M && M.Modal) {
    window.modalRedefinirSenhaInstance = M.Modal.init(document.getElementById('modal-redefinir-senha'));
  }
  window.modalRedefinirSenhaInstance.open();
  if (window.M) M.updateTextFields();
}

async function confirmarRedefinirSenha() {
  const btn = document.getElementById('btn-confirmar-redefinir-senha');
  if (isButtonLoading(btn)) return;

  const email = document.getElementById('rd-email').innerText;
  const senha = document.getElementById('rd-senha').value;
  const confirmacao = document.getElementById('rd-senha-confirm').value;

  if (!senha || senha !== confirmacao) { toastError('As senhas não coincidem.'); return; }
  if (senha.length < 6) { toastError('A senha deve ter pelo menos 6 caracteres.'); return; }

  setButtonLoading(btn, true);
  try {
    await redefinirSenha(getToken(), email, senha);
    toastSuccess('Senha redefinida com sucesso.');
    if (window.modalRedefinirSenhaInstance) window.modalRedefinirSenhaInstance.close();
  } catch (err) {
    toastError('Erro ao redefinir senha: ' + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

function adicionarUsuarioUI() {
  const btn = document.getElementById('btn-adicionar-usuario');
  if (isButtonLoading(btn)) return;
  
  const novoUsuario = {
    email: document.getElementById('user-email').value.trim(),
    nome: document.getElementById('user-nome').value.trim(),
    nivel: document.getElementById('user-nivel').value,
    filial: document.getElementById('user-filial').value.trim()
  };
  if (!novoUsuario.email || !novoUsuario.nome) { toastError('Informe e-mail e nome.'); return; }
  
  setButtonLoading(btn, true);
  fetch(`${getApiBaseUrl()}/adicionar-usuario`, {
    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(novoUsuario)
  }).then(res => res.json()).then(data => {
    setButtonLoading(btn, false);
    toastSuccess(data.message || 'Usuário adicionado.');
    document.getElementById('user-email').value = '';
    document.getElementById('user-nome').value = '';
    document.getElementById('user-filial').value = '';
    if (window.M) M.updateTextFields();
    carregarUsuarios();
  }).catch(err => { setButtonLoading(btn, false); toastError('Erro ao adicionar: ' + err.message); });
}

function editarUsuarioUI(email) {
  const usuario = usuariosCache.find(u => String(u.email || '').toLowerCase() === String(email).toLowerCase());
  if (!usuario) { toastError('Usuário não encontrado.'); return; }

  document.getElementById('edit-user-email-original').value = usuario.email;
  document.getElementById('edit-user-email').value = usuario.email;
  document.getElementById('edit-user-nome').value = usuario.nome || '';
  document.getElementById('edit-user-filial').value = usuario.filial || '';

  const nivelEl = document.getElementById('edit-user-nivel');
  if (nivelEl) {
    nivelEl.value = usuario.nivel || 'Filial';
    if (window.M && M.FormSelect) M.FormSelect.init(nivelEl);
  }

  if (!window.modalEditarUsuarioInstance && window.M && M.Modal) {
    window.modalEditarUsuarioInstance = M.Modal.init(document.getElementById('modal-editar-usuario'));
  }
  window.modalEditarUsuarioInstance.open();
  if (window.M) M.updateTextFields();
}

async function salvarEdicaoUsuario() {
  const btn = document.getElementById('btn-salvar-edicao-usuario');
  if (isButtonLoading(btn)) return;

  const emailOriginal = document.getElementById('edit-user-email-original').value;
  const nome = document.getElementById('edit-user-nome').value.trim();
  const nivel = document.getElementById('edit-user-nivel').value;
  const filial = document.getElementById('edit-user-filial').value.trim();

  if (!emailOriginal) { toastError('Usuário inválido.'); return; }
  if (!nome) { toastError('Informe o nome.'); return; }

  setButtonLoading(btn, true);
  try {
    const res = await fetch(`${getApiBaseUrl()}/atualizar-usuario`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ emailOriginal, nome, nivel, filial })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    toastSuccess(data.message || 'Usuário atualizado.');
    if (window.modalEditarUsuarioInstance) window.modalEditarUsuarioInstance.close();
    carregarUsuarios();
  } catch (err) {
    toastError('Erro ao atualizar: ' + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

function removerUsuarioUI(email, el) {
  if (el && isButtonLoading(el)) return;
  if (!confirm('Remover o usuário ' + email + '?')) return;
  if (el) { setButtonLoading(el, true); }
  
  fetch(`${getApiBaseUrl()}/remover-usuario`, {
    method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ email })
  }).then(res => res.json()).then(data => {
    if (el) setButtonLoading(el, false);
    toastSuccess(data.message || 'Usuário removido.');
    carregarUsuarios();
  }).catch(err => { if (el) setButtonLoading(el, false); toastError('Erro ao remover: ' + err.message); });
}

// Funções para mostrar/ocultar campos condicionais (chamadas via onchange no HTML)
window.atualizarCamposCondicionaisCadastro = function() {
  const status = document.getElementById('new-status')?.value;
  const campoBo = document.getElementById('campo-bo-cadastro');
  if (campoBo) campoBo.style.display = status === 'Extraviado' ? 'block' : 'none';
  if (status !== 'Extraviado') document.getElementById('new-anexoBoletim').value = '';

  const campoQuebrado = document.getElementById('campo-quebrado-cadastro');
  if (campoQuebrado) campoQuebrado.style.display = status === 'Quebrado' ? 'block' : 'none';
  if (status !== 'Quebrado') {
    const descInput = document.getElementById('new-descricaoQuebrado');
    if (descInput) descInput.value = '';
  }
};

window.atualizarCamposCondicionais = function() {
  const status = document.getElementById('edit-status')?.value;
  document.getElementById('campo-chamado').style.display = status === 'Manutenção' ? 'block' : 'none';
  document.getElementById('campo-bo').style.display = status === 'Extraviado' ? 'block' : 'none';
  document.getElementById('campo-justificativa').style.display = status === 'Em verificação' ? 'block' : 'none';
  document.getElementById('campo-quebrado').style.display = status === 'Quebrado' ? 'block' : 'none';
  const fileInput = document.getElementById('edit-anexoBoletim');
  if (fileInput && status !== 'Extraviado') fileInput.value = '';
  if (status !== 'Quebrado') {
    const el = document.getElementById('edit-descricaoQuebrado');
    if (el) el.value = '';
  }
};

// Funções de cascata categoria/marca/modelo (chamadas via onchange no HTML)
window.onCategoriaChange = function(prefixo) {
  const select = document.getElementById(prefixo + '-categoria');
  const container = document.getElementById(prefixo + '-outro-categoria-container');
  const input = document.getElementById(prefixo + '-outro-categoria');
  if (!select || !container || !input) return;
  if (select.value === '__outro__') {
    container.style.display = 'block';
    input.focus();
  } else {
    container.style.display = 'none';
    input.value = '';
  }
};

window.onMarcaChange = function(prefixo) {
  const selectMarca = document.getElementById(prefixo + '-marca');
  const container = document.getElementById(prefixo + '-outro-marca-container');
  const input = document.getElementById(prefixo + '-outro-marca');
  if (!selectMarca || !container || !input) return;
  if (selectMarca.value === '__outro__') {
    container.style.display = 'block';
    input.focus();
  } else {
    container.style.display = 'none';
    input.value = '';
  }
};

// Expor funções globais para onclick no HTML (feitas no topo do módulo)

console.log('✅ Dashboard Matriz loaded');