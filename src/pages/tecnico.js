// ============================================================================
// DASHBOARD TÉCNICO — Múltiplas unidades, acesso filtrado
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
  ITENS_POR_PAGINA,
  CAMPOS_EDITAVEIS,
  CAMPOS_CADASTRO,
  getApiBaseUrl,
  editarEquipamento,
  abrirManutencao,
  abrirHistorico,
  abrirModalRemocao,
  confirmarRemocao,
} from './dashboard-base.js';
import { getCombinacoesDoCatalogo, preencherEspecificacoesModelo } from '../shared/js/catalogo-modelos.js';

// Expor funções globais para onclick no HTML
window.editarEquipamento = editarEquipamento;
window.abrirManutencao = abrirManutencao;

// ============================================================================
// ESTADO ESPECÍFICO TÉCNICO
// ============================================================================

const UNIDADES_TECNICO = (() => {
  return [];
})();

let equipamentosCache = [];
let equipamentosFiltrados = [];
let paginaAtual = 1;
let chartStatus = null;
let modalEdicaoInstance = null;
let modalCadastroInstance = null;
let modalManutencaoInstance = null;
let itemEmEdicaoOriginal = null;
let equipamentoIdManutencaoAtual = null;
let listasCache = null;
let campoOrdenacao = null;
let ordemAtual = 'asc';

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🟢 Inicializando dashboard Técnico...');
  showLoading();
  
  if (window.M) M.FormSelect.init(document.querySelectorAll('select'));
  
  await initDashboardBase({ perfil: 'Tecnico', loadEquipamentos: false });
  
  // Captura unidades do técnico (injetado via template ou API)
  window.UNIDADES_TECNICO = [];
  try {
    const res = await fetch(`${getApiBaseUrl()}/tecnico-unidades`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (data.success) window.UNIDADES_TECNICO = data.data || [];
  } catch {}
  
  await initDashboardBase({ perfil: 'Tecnico', loadEquipamentos: false });
  inicializarFiltrosRapidos();
  inicializarSeletorUnidade();
  obterNomeTecnico();
  carregarListasCadastro();
  await carregarEquipamentos();

  document.getElementById('btn-abrir-cadastro').addEventListener('click', abrirCadastroEquipamento);
  document.getElementById('btn-atualizar-lista').addEventListener('click', carregarEquipamentos);
  document.getElementById('btn-salvar-cadastro').addEventListener('click', salvarCadastro);
  document.getElementById('btn-salvar-edicao').addEventListener('click', salvarEdicao);
  document.getElementById('btn-registrar-manutencao').addEventListener('click', registrarManutencaoUI);
  document.getElementById('btn-confirmar-remocao').addEventListener('click', confirmarRemocao);
  document.getElementById('btn-exportar-csv').addEventListener('click', exportarCSVUI);
  document.getElementById('btn-exportar-pdf').addEventListener('click', exportarPDF);

  document.getElementById('filtro-busca').addEventListener('input', aplicarFiltros);
  document.getElementById('filtro-status').addEventListener('change', aplicarFiltros);

  document.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', function() {
      const campo = this.dataset.sort;
      if (campo) ordenarTabela(campo);
    });
  });

  document.getElementById('btn-pagina-anterior').addEventListener('click', function() {
    if (paginaAtual > 1) { paginaAtual--; renderTabelaEquipamentos(equipamentosFiltrados); }
  });
  document.getElementById('btn-proxima-pagina').addEventListener('click', function() {
    if (paginaAtual < Math.ceil(equipamentosFiltrados.length / ITENS_POR_PAGINA)) {
      paginaAtual++;
      renderTabelaEquipamentos(equipamentosFiltrados);
    }
  });

  hideLoading();
  console.log('✅ Dashboard técnico inicializado!');
});

// ============================================================================
// TOKEN E AUTENTICAÇÃO
// ============================================================================
// OBTER NOME DO TÉCNICO
// ============================================================================

async function obterNomeTecnico() {
  try {
    const res = await fetch(`${getApiBaseUrl()}/get-nome-usuario`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success) document.getElementById('nome-tecnico').innerText = data.data || 'Técnico';
  } catch { document.getElementById('nome-tecnico').innerText = 'Técnico'; }
}

// ============================================================================
// INICIALIZAR SELETOR DE UNIDADE
// ============================================================================

function inicializarSeletorUnidade() {
  const select = document.getElementById('seletor-unidade');
  if (!select) return;
  select.innerHTML = '<option value="">Todas as unidades</option>' +
    UNIDADES_TECNICO.map(u => `<option value="${u}">${u}</option>`).join('');
  if (UNIDADES_TECNICO.length === 1) { select.value = UNIDADES_TECNICO[0]; }
  document.getElementById('unidades-atendidas').innerText = UNIDADES_TECNICO.join(', ') || 'Nenhuma';
  select.addEventListener('change', aplicarFiltros);
}

// ============================================================================
// LISTAS (CASCATA + "OUTRO")
// ============================================================================

function carregarListasCadastro() {
  console.log('🟢 carregarListasCadastro() iniciado...');
  fetch(`${getApiBaseUrl()}/listas-cadastro`, { headers: getAuthHeaders() })
    .then(r => r.json()).then(data => {
      if (data.success) {
        console.log('✅ Listas recebidas:', data.data);
        processarListas(data.data);
        preencherSelectCategoria('new');
        preencherSelectCategoria('edit');
      }
    }).catch(err => { console.error('❌ Erro ao carregar listas:', err); toastError('Erro ao carregar listas. Recarregue a página.'); });
}

function processarListas(combinacoes) {
  const categorias = new Set();
  const marcasPorCategoria = {};
  const modelosPorCategoriaMarca = {};
  const combinadas = (combinacoes || []).concat(getCombinacoesDoCatalogo());
  combinadas.forEach(item => {
    const cat = item.categoria, marca = item.marca, modelo = item.modelo;
    if (!cat || !marca || !modelo) return;
    categorias.add(cat);
    if (!marcasPorCategoria[cat]) marcasPorCategoria[cat] = new Set();
    marcasPorCategoria[cat].add(marca);
    if (!modelosPorCategoriaMarca[cat]) modelosPorCategoriaMarca[cat] = {};
    if (!modelosPorCategoriaMarca[cat][marca]) modelosPorCategoriaMarca[cat][marca] = new Set();
    modelosPorCategoriaMarca[cat][marca].add(modelo);
  });
  listasCache = { combinacoes: combinadas, categorias: Array.from(categorias).sort(), marcasPorCategoria, modelosPorCategoriaMarca };
}

function preencherSelectCategoria(prefixo) {
  const select = document.getElementById(prefixo + '-categoria');
  if (!select || !listasCache) return;
  const valorAtual = select.value;
  select.innerHTML = '<option value="" disabled selected>Selecione</option>' +
    listasCache.categorias.map(c => `<option value="${c}">${c}</option>`).join('') +
    '<option value="__outro__">Outro (digitar)</option>';
  if (valorAtual && listasCache.categorias.includes(valorAtual)) select.value = valorAtual;
  else if (valorAtual && valorAtual !== '__outro__') { select.value = '__outro__'; const input = document.getElementById(prefixo + '-outro-categoria'); if (input) input.value = valorAtual; toggleOutroCampo(prefixo, 'categoria'); }
  else { select.value = valorAtual; toggleOutroCampo(prefixo, 'categoria'); }
  if (window.M && M.FormSelect) M.FormSelect.init(select);
  if (select.value && select.value !== '__outro__') { popularMarcas(prefixo, select.value); limparModelo(prefixo); }
  else { limparMarcaModelo(prefixo); }
}

function popularMarcas(prefixo, categoria) {
  const selectMarca = document.getElementById(prefixo + '-marca');
  if (!selectMarca || !listasCache) return;
  const marcasSet = listasCache.marcasPorCategoria[categoria] || new Set();
  const marcas = Array.from(marcasSet).sort();
  const valorAtual = selectMarca.value;
  selectMarca.innerHTML = '<option value="" disabled selected>Selecione uma marca</option>' + marcas.map(m => `<option value="${m}">${m}</option>`).join('') + '<option value="__outro__">Outro (digitar)</option>';
  if (valorAtual && marcas.includes(valorAtual)) selectMarca.value = valorAtual;
  else if (valorAtual && valorAtual !== '__outro__') { selectMarca.value = '__outro__'; const input = document.getElementById(prefixo + '-outro-marca'); if (input) input.value = valorAtual; toggleOutroCampo(prefixo, 'marca'); }
  else { selectMarca.value = valorAtual; toggleOutroCampo(prefixo, 'marca'); }
  if (window.M && M.FormSelect) M.FormSelect.init(selectMarca);
  if (selectMarca.value && selectMarca.value !== '__outro__') popularModelos(prefixo, categoria, selectMarca.value);
  else limparModelo(prefixo);
}

function popularModelos(prefixo, categoria, marca) {
  const selectModelo = document.getElementById(prefixo + '-modelo');
  if (!selectModelo || !listasCache) return;
  const modelosSet = listasCache.modelosPorCategoriaMarca[categoria]?.[marca] || new Set();
  const modelos = Array.from(modelosSet).sort();
  const valorAtual = selectModelo.value;
  selectModelo.innerHTML = '<option value="" disabled selected>Selecione um modelo</option>' + modelos.map(m => `<option value="${m}">${m}</option>`).join('') + '<option value="__outro__">Outro (digitar)</option>';
  if (valorAtual && modelos.includes(valorAtual)) selectModelo.value = valorAtual;
  else if (valorAtual && valorAtual !== '__outro__') { selectModelo.value = '__outro__'; const input = document.getElementById(prefixo + '-outro-modelo'); if (input) input.value = valorAtual; toggleOutroCampo(prefixo, 'modelo'); }
  else { selectModelo.value = valorAtual; toggleOutroCampo(prefixo, 'modelo'); }
  if (window.M && M.FormSelect) M.FormSelect.init(selectModelo);
}

function limparMarcaModelo(prefixo) {
  const selectMarca = document.getElementById(prefixo + '-marca');
  if (selectMarca) { selectMarca.innerHTML = '<option value="" disabled selected>Selecione a categoria</option>'; if (window.M && M.FormSelect) M.FormSelect.init(selectMarca); }
  limparModelo(prefixo);
}

function limparModelo(prefixo) {
  const selectModelo = document.getElementById(prefixo + '-modelo');
  if (selectModelo) { selectModelo.innerHTML = '<option value="" disabled selected>Selecione a marca</option>'; if (window.M && M.FormSelect) M.FormSelect.init(selectModelo); }
}

function toggleOutroCampo(prefixo, tipo) {
  const select = document.getElementById(prefixo + '-' + tipo);
  const container = document.getElementById(prefixo + '-outro-' + tipo + '-container');
  const input = document.getElementById(prefixo + '-outro-' + tipo);
  if (!select || !container || !input) return;
  if (select.value === '__outro__') { container.style.display = 'block'; input.focus(); }
  else { container.style.display = 'none'; input.value = ''; }
}

function onCategoriaChange(prefixo) {
  const select = document.getElementById(prefixo + '-categoria');
  toggleOutroCampo(prefixo, 'categoria');
  if (select && select.value && select.value !== '__outro__') { popularMarcas(prefixo, select.value); limparModelo(prefixo); }
  else { limparMarcaModelo(prefixo); }
}

function onMarcaChange(prefixo) {
  const selectMarca = document.getElementById(prefixo + '-marca');
  const selectCategoria = document.getElementById(prefixo + '-categoria');
  toggleOutroCampo(prefixo, 'marca');
  if (selectMarca && selectCategoria && selectMarca.value && selectMarca.value !== '__outro__' && selectCategoria.value && selectCategoria.value !== '__outro__') popularModelos(prefixo, selectCategoria.value, selectMarca.value);
  else limparModelo(prefixo);
}

function onModeloChange(prefixo) {
  const selectModelo = document.getElementById(prefixo + '-modelo');
  if (selectModelo && selectModelo.value && selectModelo.value !== '__outro__') {
    preencherEspecificacoesModelo(prefixo, selectModelo.value);
  }
}

// Expor para onclick no HTML
window.onCategoriaChange = onCategoriaChange;
window.onMarcaChange = onMarcaChange;
window.onModeloChange = onModeloChange;

// ============================================================================
// JUSTIFICATIVAS
// ============================================================================

function configurarJustificativas(prefixo) {
  const campoPat = document.getElementById(prefixo + '-patrimonio');
  const campoSerie = document.getElementById(prefixo + '-numeroSerie');
  const justPatContainer = document.getElementById('campo-justificativa-patrimonio' + (prefixo === 'edit' ? '-edit' : ''));
  const justSerieContainer = document.getElementById('campo-justificativa-serie' + (prefixo === 'edit' ? '-edit' : ''));
  const justPatInput = document.getElementById(prefixo + '-justificativaPatrimonio');
  const justSerieInput = document.getElementById(prefixo + '-justificativaNumeroSerie');
  if (!campoPat || !campoSerie || !justPatContainer || !justSerieContainer) return;
  function verificarPatrimonio() { if (campoPat.value.trim() === '') { justPatContainer.style.display = 'block'; if (justPatInput) justPatInput.required = true; } else { justPatContainer.style.display = 'none'; if (justPatInput) { justPatInput.value = ''; justPatInput.required = false; } } }
  function verificarSerie() { if (campoSerie.value.trim() === '') { justSerieContainer.style.display = 'block'; if (justSerieInput) justSerieInput.required = true; } else { justSerieContainer.style.display = 'none'; if (justSerieInput) { justSerieInput.value = ''; justSerieInput.required = false; } } }
  campoPat.addEventListener('input', verificarPatrimonio);
  campoSerie.addEventListener('input', verificarSerie);
  verificarPatrimonio(); verificarSerie();
}

// ============================================================================
// KPIs E GRÁFICO
// ============================================================================

function kpiCard_(icone, valor, label, extraClass) {
  return '<div class="col s12 m3"><div class="sce-kpi ' + (extraClass || '') + '"><div class="sce-kpi-icon"><i class="material-icons">' + icone + '</i></div><div><div class="sce-kpi-value">' + valor + '</div><div class="sce-kpi-label">' + label + '</div></div></div></div>';
}

function atualizarKpis(equipamentos) {
  const porStatus = {};
  equipamentos.forEach(item => { const s = item.status || 'Não definido'; porStatus[s] = (porStatus[s] || 0) + 1; });
  const total = equipamentos.length;
  const disponiveis = porStatus['Disponível'] || 0;
  const manutencao = porStatus['Manutenção'] || 0;
  const quebrados = porStatus['Quebrado'] || 0;
  const inserviveis = porStatus['Inservível'] || 0;
  const extraviado = porStatus['Extraviado'] || 0;
  const emVerificacao = porStatus['Em verificação'] || 0;
  document.getElementById('kpis').innerHTML = kpiCard_('devices', total, 'Total', 'kpi-total') + kpiCard_('check_circle', disponiveis, 'Disponíveis', 'kpi-disponiveis') + kpiCard_('build', manutencao, 'Manutenção', 'kpi-manutencao') + kpiCard_('report', quebrados, 'Quebrados', 'kpi-quebrados') + kpiCard_('close', inserviveis, 'Inservíveis', 'kpi-inserviveis') + kpiCard_('assignment_late', extraviado, 'Extraviado', 'kpi-extraviado') + kpiCard_('search', emVerificacao, 'Em verificação', 'kpi-emVerificacao');
}

function renderGraficoStatus(equipamentos) {
  const porStatus = {};
  equipamentos.forEach(item => { const s = item.status || 'Não definido'; porStatus[s] = (porStatus[s] || 0) + 1; });
  const canvas = document.getElementById('canvas-chart-status');
  const labels = Object.keys(porStatus);
  const valores = labels.map(l => porStatus[l]);
  const cores = ['#1565c0', '#43a047', '#ef6c00', '#d32f2f', '#8e24aa', '#00838f', '#795548', '#607d8b'];
  if (chartStatus) chartStatus.destroy();
  chartStatus = new Chart(canvas.getContext('2d'), { type: 'pie', data: { labels, datasets: [{ data: valores, backgroundColor: cores }] }, options: { responsive: true, maintainAspectRatio: false } });
}

// ============================================================================
// CARREGAR EQUIPAMENTOS
// ============================================================================

async function carregarEquipamentos() {
  console.log('🟢 carregarEquipamentos() INICIADA');
  if (!getToken()) { toastError('Token não disponível. Recarregue a página.'); return; }
  showLoading();
  try {
    const res = await fetch(`${getApiBaseUrl()}/equipamentos-da-filial`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    equipamentosCache = data.data || [];
    equipamentosCache.forEach(item => {
      if (item.status === 'Emprestado' && item.dataPrevistaDevolucao) {
        const hoje = new Date(); const prevista = new Date(item.dataPrevistaDevolucao);
        item.emAtraso = prevista < hoje;
      } else { item.emAtraso = false; }
    });
    aplicarFiltros();
    hideLoading();
  } catch (err) { hideLoading(); toastError('Erro ao carregar: ' + err.message); }
}

// ============================================================================
// FILTROS
// ============================================================================

function inicializarFiltrosRapidos() {
  const botoes = document.querySelectorAll('.btn-filtro');
  botoes.forEach(btn => { btn.addEventListener('click', function() { botoes.forEach(b => b.classList.remove('ativo')); this.classList.add('ativo'); const filtro = this.dataset.filtro; const selectStatus = document.getElementById('filtro-status'); selectStatus.value = filtro === 'todos' ? '' : filtro; if (window.M && M.FormSelect) M.FormSelect.init(selectStatus); aplicarFiltros(); }); });
}

function ordenarTabela(campo) {
  if (campoOrdenacao === campo) ordemAtual = ordemAtual === 'asc' ? 'desc' : 'asc';
  else { campoOrdenacao = campo; ordemAtual = 'asc'; }
  equipamentosFiltrados.sort((a, b) => { const valA = (a[campo] || '').toString().toLowerCase(); const valB = (b[campo] || '').toString().toLowerCase(); if (valA < valB) return ordemAtual === 'asc' ? -1 : 1; if (valA > valB) return ordemAtual === 'asc' ? 1 : -1; return 0; });
  document.querySelectorAll('.sortable').forEach(th => { const icon = th.querySelector('.material-icons'); if (icon) icon.textContent = 'unfold_more'; });
  const thAtual = document.querySelector('[data-sort="' + campo + '"]');
  if (thAtual) { const icon = thAtual.querySelector('.material-icons'); if (icon) icon.textContent = ordemAtual === 'asc' ? 'arrow_upward' : 'arrow_downward'; }
  paginaAtual = 1;
  renderTabelaEquipamentos(equipamentosFiltrados);
}

function aplicarFiltros() {
  const busca = document.getElementById('filtro-busca')?.value?.trim()?.toLowerCase() || '';
  const status = document.getElementById('filtro-status')?.value || '';
  const unidadeSelecionada = document.getElementById('seletor-unidade')?.value || '';
  equipamentosFiltrados = equipamentosCache.filter(item => {
    if (status && item.status !== status) return false;
    if (unidadeSelecionada && item.unidade !== unidadeSelecionada) return false;
    if (!busca) return true;
    return [item.patrimonio, item.numeroSerie, item.modelo].join(' ').toLowerCase().indexOf(busca) !== -1;
  });
  paginaAtual = 1;
  renderTabelaEquipamentos(equipamentosFiltrados);
  atualizarKpis(equipamentosFiltrados);
  renderGraficoStatus(equipamentosFiltrados);
  document.getElementById('contador-equipamentos').innerText = equipamentosFiltrados.length;
}

// ============================================================================
// TABELA
// ============================================================================

function renderTabelaEquipamentos(equipamentos) {
  const tbody = document.querySelector('#tabela-equipamentos tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!equipamentos || equipamentos.length === 0) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--sce-muted);">🔍 Nenhum equipamento encontrado com os filtros aplicados.</td></tr>'; document.getElementById('pagina-info').innerText = 'Página 0 de 0 - 0 itens'; return; }
  const inicio = (paginaAtual - 1) * ITENS_POR_PAGINA;
  const pagina = equipamentos.slice(inicio, inicio + ITENS_POR_PAGINA);
  pagina.forEach(item => {
    const tr = document.createElement('tr');
    const statusClass = 'status-' + (item.status || '').toLowerCase().replace(/ /g, '-');
    tr.className = statusClass;
    tr.innerHTML = '<td class="cell-2lin"><span class="cell-main">' + (item.modelo || '') + '</span><span class="cell-sub">' + (item.categoria || '') + ' · ' + (item.marca || '') + '</span></td>' + '<td>' + (item.patrimonio || '') + (item.justificativaPatrimonio ? ' *' : '') + '</td>' + '<td>' + (item.numeroSerie || '') + '</td>' + '<td><strong>' + (item.status || '') + '</strong></td>' + '<td class="no-print">' + '<div class="kebab-wrap"><button class="kebab-btn" onclick="toggleKebab(this)"><i class="material-icons">more_vert</i></button><div class="kebab-menu"><a onclick="editarEquipamento(\'' + item.id + '\')"><i class="material-icons">edit</i> Editar</a><a onclick="abrirHistorico(\'' + item.id + '\')"><i class="material-icons">history</i> Histórico</a><a class="danger" onclick="abrirModalRemocao(\'' + item.id + '\')"><i class="material-icons">delete</i> Remover</a></div></div>' + '</td>';
    tbody.appendChild(tr);
  });
  const totalPaginas = Math.max(1, Math.ceil(equipamentos.length / ITENS_POR_PAGINA));
  const info = document.getElementById('pagina-info');
  if (info) info.innerText = 'Página ' + paginaAtual + ' de ' + totalPaginas + ' - ' + equipamentos.length + ' itens';
}

// ============================================================================
// CADASTRO / EDIÇÃO / MANUTENÇÃO (usam dashboard-base.js)
// ============================================================================

function atualizarCamposCondicionaisCadastro() {
  const status = document.getElementById('new-status').value;
  document.getElementById('campo-bo-cadastro').style.display = status === 'Extraviado' ? 'block' : 'none';
  if (status !== 'Extraviado') document.getElementById('new-anexoBoletim').value = '';
  document.getElementById('campo-quebrado-cadastro').style.display = status === 'Quebrado' ? 'block' : 'none';
  if (status !== 'Quebrado') document.getElementById('new-descricaoQuebrado').value = '';
}

function atualizarCamposCondicionais() {
  const status = document.getElementById('edit-status').value;
  document.getElementById('campo-chamado').style.display = status === 'Manutenção' ? 'block' : 'none';
  document.getElementById('campo-bo').style.display = status === 'Extraviado' ? 'block' : 'none';
  document.getElementById('campo-justificativa').style.display = status === 'Em verificação' ? 'block' : 'none';
  document.getElementById('campo-quebrado').style.display = status === 'Quebrado' ? 'block' : 'none';
  const fileInput = document.getElementById('edit-anexoBoletim');
  if (fileInput && status !== 'Extraviado') fileInput.value = '';
  if (status !== 'Quebrado') document.getElementById('edit-descricaoQuebrado').value = '';
}

// Expor para onclick
window.atualizarCamposCondicionaisCadastro = () => atualizarCamposCondicionaisCadastro();
window.atualizarCamposCondicionais = () => atualizarCamposCondicionais();
window.editarEquipamento = editarEquipamento;
window.abrirManutencao = abrirManutencao;
window.abrirHistorico = abrirHistorico;
window.abrirModalRemocao = abrirModalRemocao;

console.log('✅ Dashboard Técnico loaded');