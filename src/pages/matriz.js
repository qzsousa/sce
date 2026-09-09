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
} from './dashboard-base.js';
import { setupSelectCascata } from '../shared/js/lists.js';

// Expor funções globais para onclick no HTML (executar imediatamente no load do módulo)
window.editarEquipamento = editarEquipamento;
window.abrirHistorico = abrirHistorico;
window.abrirModalRemocao = abrirModalRemocao;
window.editarUsuarioUI = editarUsuarioUI;
window.removerUsuarioUI = removerUsuarioUI;
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

const SESSION_EMAIL = 'matriz@usuario'; // Será preenchido via getNomeUsuario

let idPendenteRemocao = null;
let modalRemocaoInstance = null;
let modalEdicaoInstance = null;
let modalCadastroInstance = null;
let modalUsuariosInstance = null;
let modalManutencaoInstance = null;
let modalStatusLoteInstance = null;
let modalHistoricoInstance = null;
let itemEmEdicaoOriginal = null;
let equipamentoIdManutencaoAtual = null;
let usuariosCache = [];

let chartStatus = null;
let chartUnidade = null;
let chartCategoria = null;

let equipamentosCache = [];
let equipamentosFiltrados = [];
let campoOrdenacao = 'patrimonio';
let ordemAtual = 'asc';
let paginaAtual = 1;

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🟢 Inicializando Dashboard Matriz...');
  
  if (window.M) {
    M.FormSelect.init(document.querySelectorAll('select'));
  }
  
  // Inicializa listeners de cascata para categoria/marca/modelo
  setupSelectCascata('new');
  setupSelectCascata('edit');
  
  await initDashboardBase({ perfil: 'Matriz', loadEquipamentos: false });
  inicializarFiltrosRapidos();
  inicializarSeletorUnidade();
  
  // Carrega equipamentos globais (Matriz vê tudo)
  await carregarEquipamentosGlobal();
  
  // Event listeners
  document.getElementById('btn-abrir-gestao-usuarios').addEventListener('click', abrirGestaoUsuarios);
  document.getElementById('btn-abrir-cadastro').addEventListener('click', abrirCadastroEquipamento);
  document.getElementById('btn-atualizar-lista').addEventListener('click', carregarEquipamentosGlobal);
  document.getElementById('btn-salvar-cadastro').addEventListener('click', salvarCadastro);
  document.getElementById('btn-adicionar-usuario').addEventListener('click', adicionarUsuarioUI);
  document.getElementById('btn-confirmar-remocao').addEventListener('click', confirmarRemocao);
  document.getElementById('btn-salvar-edicao').addEventListener('click', salvarEdicao);
  document.getElementById('btn-registrar-manutencao').addEventListener('click', registrarManutencaoUI);
  document.getElementById('btn-exportar-csv').addEventListener('click', exportarCSVUI);
  document.getElementById('btn-exportar-pdf').addEventListener('click', exportarPDFUI);
  document.getElementById('btn-excluir-selecionados').addEventListener('click', excluirSelecionados);
  document.getElementById('btn-alterar-status-lote').addEventListener('click', abrirAlterarStatusLote);
  document.getElementById('btn-confirmar-alterar-status-lote').addEventListener('click', confirmarAlterarStatusLote);

  document.getElementById('filtro-busca').addEventListener('input', aplicarFiltros);
  document.getElementById('filtro-status').addEventListener('change', aplicarFiltros);
  
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

  console.log('✅ Dashboard Matriz inicializado!');
});

// ============================================================================
// CARREGAMENTO DE EQUIPAMENTOS (GLOBAL - MATRIZ VÊ TUDO)
// ============================================================================

async function carregarEquipamentosGlobal() {
  showLoading();
  try {
    const res = await fetch(`${getApiBaseUrl()}/equipamentos-global`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    
    equipamentosCache = data.data || [];
    equipamentosCache.forEach(item => {
      if (item.status === 'Emprestado' && item.dataPrevistaDevolucao) {
        const hoje = new Date();
        const prevista = new Date(item.dataPrevistaDevolucao);
        item.emAtraso = prevista < hoje;
      } else { item.emAtraso = false; }
    });
    
    inicializarSeletorUnidade();
    atualizarFiltrosOpcoes(equipamentosCache);
    aplicarFiltros();
  } catch (err) {
    console.error('Erro ao carregar:', err);
    toastError('Erro ao carregar: ' + err.message);
  } finally {
    hideLoading();
  }
}

// ============================================================================
// FILTROS E SELETOR DE UNIDADE
// ============================================================================

function inicializarSeletorUnidade() {
  const select = document.getElementById('seletor-unidade');
  if (!select) return;
  const unidades = equipamentosCache
    .map(e => e.unidade)
    .filter(u => u && u.trim())
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .sort();
  select.innerHTML = '<option value="">Todas as unidades</option>' +
    unidades.map(u => `<option value="${u}">${u}</option>`).join('');
  document.getElementById('total-unidades').innerText = unidades.length;
  select.addEventListener('change', aplicarFiltros);
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

function atualizarFiltrosOpcoes(equipamentos) {
  preencherSelectFiltro('filtro-status', equipamentos.map(e => e.status), 'Todos os status');
}

function preencherSelectFiltro(id, valores, label) {
  const select = document.getElementById(id);
  if (!select) return;
  const atual = select.value;
  const unicos = valores.filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).sort();
  select.innerHTML = '<option value="">' + label + '</option>' + unicos.map(v => `<option value="${v}">${v}</option>`).join('');
  select.value = atual;
  if (window.M && M.FormSelect) M.FormSelect.init(select);
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
  equipamentosFiltrados.sort((a, b) => {
    const valA = (a[campo] || '').toString().toLowerCase();
    const valB = (b[campo] || '').toString().toLowerCase();
    if (valA < valB) return ordemAtual === 'asc' ? -1 : 1;
    if (valA > valB) return ordemAtual === 'asc' ? 1 : -1;
    return 0;
  });
  document.querySelectorAll('.sortable').forEach(th => {
    const icon = th.querySelector('.material-icons');
    if (icon) icon.textContent = 'unfold_more';
  });
  const thAtual = document.querySelector('[data-sort="' + campo + '"]');
  if (thAtual) {
    const icon = thAtual.querySelector('.material-icons');
    if (icon) icon.textContent = ordemAtual === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }
  renderTabelaGlobal(equipamentosFiltrados);
}

function aplicarFiltros() {
  const busca = document.getElementById('filtro-busca')?.value?.trim()?.toLowerCase() || '';
  const status = document.getElementById('filtro-status')?.value || '';
  const unidadeSelecionada = document.getElementById('seletor-unidade')?.value || '';
  
  equipamentosFiltrados = equipamentosCache.filter(item => {
    if (status && item.status !== status) return false;
    if (unidadeSelecionada && item.unidade !== unidadeSelecionada) return false;
    if (!busca) return true;
    return [item.patrimonio, item.numeroSerie, item.modelo, item.unidade].join(' ').toLowerCase().includes(busca);
  });
  
  paginaAtual = 1;
  renderTabelaGlobal(equipamentosFiltrados);
  atualizarKpis(equipamentosFiltrados);
  renderGraficos(equipamentosFiltrados);
  document.getElementById('contador-equipamentos').innerText = equipamentosFiltrados.length;
}

// ============================================================================
// RENDERIZAÇÃO TABELA GLOBAL
// ============================================================================

function renderTabelaGlobal(equipamentos) {
  const tbody = document.querySelector('#tabela-equipamentos-global tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (!equipamentos || equipamentos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--sce-muted);">🔍 Nenhum equipamento encontrado com os filtros aplicados.</td></tr>';
    return;
  }
  
  equipamentos.forEach(item => {
    const tr = document.createElement('tr');
    const statusClass = 'status-' + (item.status || '').toLowerCase().replace(/ /g, '-');
    tr.className = statusClass;
    
    let badgeManutencao = '-';
    if (item.statusManutencao) {
      const sm = item.statusManutencao.toLowerCase().replace(/ /g, '-');
      let cls = 'badge-manutencao ';
      if (sm === 'pendente') cls += 'badge-pendente';
      else if (sm === 'em-andamento') cls += 'badge-em-andamento';
      else if (sm === 'concluído') cls += 'badge-concluído';
      badgeManutencao = `<span class="${cls}">${item.statusManutencao}</span>`;
    }
    
    let indicadorAtraso = '-';
    if (item.status === 'Emprestado' && item.dataPrevistaDevolucao) {
      const hoje = new Date();
      const prevista = new Date(item.dataPrevistaDevolucao);
      const atrasado = prevista < hoje;
      const label = atrasado ? 'Atrasado' : 'Em dia';
      const cls = atrasado ? 'badge-atrasado' : 'badge-em-dia';
      indicadorAtraso = `<span class="badge-atraso ${cls}">${label}</span>`;
    }
    
    const blueBadge = item.vinculadoBlueMonitor === 'Sim' ? '<span class="badge-blue sim">Sim</span>' : '<span class="badge-blue nao">Não</span>';
    
    tr.innerHTML =
      '<td class="no-print"><label><input type="checkbox" class="check-equipamento" value="' + item.id + '"><span></span></label></td>' +
      '<td>' + (item.unidade || '') + '</td>' +
      '<td>' + (item.categoria || '') + '</td>' +
      '<td>' + (item.marca || '') + '</td>' +
      '<td>' + (item.patrimonio || '') + (item.justificativaPatrimonio ? ' *' : '') + '</td>' +
      '<td><strong>' + (item.status || '') + '</strong></td>' +
      '<td>' + badgeManutencao + '</td>' +
      '<td>' + indicadorAtraso + '</td>' +
      '<td>' + blueBadge + '</td>' +
      '<td class="no-print">' +
        '<a class="btn-small waves-effect" onclick="editarEquipamento(\'' + item.id + '\')" title="Editar"><i class="material-icons">edit</i></a> ' +
        '<a class="btn-small waves-effect" onclick="abrirHistorico(\'' + item.id + '\')" title="Histórico"><i class="material-icons">history</i></a> ' +
        '<a class="btn-small red waves-effect" onclick="abrirModalRemocao(\'' + item.id + '\')" title="Remover"><i class="material-icons">delete</i></a>' +
      '</td>';
    tbody.appendChild(tr);
  });
}

// ============================================================================
// GRÁFICOS (MATRIZ TEM 3)
// ============================================================================

function renderGraficos(equipamentos) {
  // Status
  const porStatus = {};
  equipamentos.forEach(item => { const s = item.status || 'Não definido'; porStatus[s] = (porStatus[s] || 0) + 1; });
  const labelsStatus = Object.keys(porStatus);
  const dataStatus = labelsStatus.map(l => porStatus[l]);
  const coresStatus = ['#1565c0', '#43a047', '#ef6c00', '#d32f2f', '#8e24aa', '#00838f', '#795548', '#607d8b'];
  if (chartStatus) chartStatus.destroy();
  chartStatus = new Chart(document.getElementById('canvas-chart-status').getContext('2d'), {
    type: 'pie', data: { labels: labelsStatus, datasets: [{ data: dataStatus, backgroundColor: coresStatus }] },
    options: { responsive: true, maintainAspectRatio: false }
  });

  // Unidade
  const porUnidade = {};
  equipamentos.forEach(item => { const u = item.unidade || 'Sem unidade'; porUnidade[u] = (porUnidade[u] || 0) + 1; });
  const labelsUnidade = Object.keys(porUnidade);
  const dataUnidade = labelsUnidade.map(l => porUnidade[l]);
  const coresUnidade = ['#1b5e20', '#2e7d32', '#388e3c', '#43a047', '#4caf50', '#66bb6a', '#81c784', '#a5d6a7'];
  if (chartUnidade) chartUnidade.destroy();
  chartUnidade = new Chart(document.getElementById('canvas-chart-unidade').getContext('2d'), {
    type: 'pie', data: { labels: labelsUnidade, datasets: [{ data: dataUnidade, backgroundColor: coresUnidade }] },
    options: { responsive: true, maintainAspectRatio: false }
  });

  // Categoria
  const porCategoria = {};
  equipamentos.forEach(item => { const c = item.categoria || 'Sem categoria'; porCategoria[c] = (porCategoria[c] || 0) + 1; });
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
    renderTabelaUsuarios(usuariosCache);
  } catch (err) { toastError('Erro ao carregar usuários: ' + err.message); }
}

function renderTabelaUsuarios(usuarios) {
  const tbody = document.querySelector('#tabela-usuarios tbody');
  tbody.innerHTML = '';
  if (!usuarios || usuarios.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">Nenhum usuário cadastrado.</td></tr>';
    return;
  }
  usuarios.forEach(u => {
    const isSelf = u.email === SESSION_EMAIL;
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (u.email || '') + '</td>' +
      '<td>' + (u.nome || '') + '</td>' +
      '<td>' + (u.nivel || '') + '</td>' +
      '<td>' + (u.filial || '') + '</td>' +
      '<td>' + (u.status || '') + '</td>' +
      '<td>' + (isSelf ? '' : '<a class="btn-small waves-effect" onclick="editarUsuarioUI(\'' + u.email + '\')" title="Editar"><i class="material-icons">edit</i></a> <a class="btn-small red waves-effect" onclick="removerUsuarioUI(\'' + u.email + '\', this)" title="Remover"><i class="material-icons">delete</i></a>') +
      '</td>';
    tbody.appendChild(tr);
  });
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

function editarUsuarioUI(email) { toastError('Edição de usuário não implementada na interface atual.'); }

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