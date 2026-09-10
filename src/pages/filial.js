// ============================================================================
// DASHBOARD FILIAL — Acesso à unidade do usuário (Filial/AdminFilial)
// ============================================================================

import {
  initDashboardBase,
  getToken,
  getAuthHeaders,
  showLoading,
  hideLoading,
  toastSuccess,
  toastError,
  toastInfo,
  setButtonLoading,
  isButtonLoading,
  downloadCsv,
  fileToBase64,
  validateFile,
  formatDate,
  formatDateShort,
  ITENS_POR_PAGINA,
  CAMPOS_EDITAVEIS,
  CAMPOS_CADASTRO,
  getApiBaseUrl,
  abrirCadastroEquipamento,
  salvarCadastro,
  salvarEdicao,
  exportarCSVUI,
  editarEquipamento,
  abrirHistorico,
  abrirModalRemocao,
  confirmarRemocao,
  atualizarKpis,
  setCarregarEquipamentos,
  setEquipamentosCache,
} from './dashboard-base.js';
import { preencherEspecificacoesModelo } from '../shared/js/catalogo-modelos.js';

// Expor funções globais para onclick no HTML
window.selecionarTipoEmprestimo = selecionarTipoEmprestimo;
window.editarUsuarioUI = editarUsuarioUI;
window.removerUsuarioUI = removerUsuarioUI;
window.editarEquipamento = editarEquipamento;
window.abrirHistorico = abrirHistorico;
window.abrirModalRemocao = abrirModalRemocao;
window.redefinirSenhaUI = redefinirSenhaUI;

// ============================================================================
// ESTADO ESPECÍFICO FILIAL
// ============================================================================

let equipamentosCache = [];
let equipamentosFiltrados = [];
let paginaAtual = 1;
let chartStatus = null;
let chartCategoria = null;
let ordemAtual = 'asc';
let campoOrdenacao = null;
let listasCache = null;

let modalEdicaoInstance = null;
let modalCadastroInstance = null;
let modalTipoEmprestimoInstance = null;
let modalEmprestimoInstance = null;
let modalUsuariosInstance = null;
let modalEditarUsuarioInstance = null;
let modalHistoricoInstance = null;
let modalRedefinirSenhaInstance = null;
let itemEmEdicaoOriginal = null;

let emprestimoIdsSelecionados = [];

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🟢 Inicializando Dashboard Filial...');
  
  if (window.M) M.FormSelect.init(document.querySelectorAll('select'));
  
  // Injeta a função de recarga para o dashboard-base usar após salvar/remover
  setCarregarEquipamentos(carregarEquipamentos);
  
  await initDashboardBase({ perfil: 'Filial', loadEquipamentos: false });
  
  // Mostra/esconde botões baseados no nível
  const nivel = document.getElementById('perfil-usuario')?.textContent || '';
  const btnExcluir = document.getElementById('btn-excluir-selecionados');
  const btnUsuarios = document.getElementById('btn-gerenciar-usuarios');
  const modalUsuarios = document.getElementById('modal-gerenciar-usuarios');
  const modalEditarUsuario = document.getElementById('modal-editar-usuario');
  
  if (nivel === 'AdminFilial') {
    if (btnExcluir) btnExcluir.style.display = 'inline-block';
    if (btnUsuarios) btnUsuarios.style.display = 'inline-block';
    if (modalUsuarios) modalUsuarios.style.display = 'block';
    if (modalEditarUsuario) modalEditarUsuario.style.display = 'block';
  }
  
  await initDashboardBase({ perfil: 'Filial', loadEquipamentos: false });
  await carregarEquipamentos();
  
  // Carregar listas (categoria/marca/modelo) - mescla com catálogo
  await carregarListasCadastro();
  
  // Popula cabeçalho (unidade + perfil)
  carregarInfoCabecalho();
  
  // Event listeners
  document.getElementById('btn-abrir-cadastro').addEventListener('click', abrirCadastroEquipamento);
  document.getElementById('btn-abrir-emprestimo').addEventListener('click', abrirEmprestimoSelecionados);
  document.getElementById('btn-devolver-selecionados').addEventListener('click', devolverSelecionados);
  document.getElementById('btn-atualizar-lista').addEventListener('click', carregarEquipamentos);
  document.getElementById('btn-exportar-csv').addEventListener('click', exportarCSVUI);
  document.getElementById('btn-exportar-pdf').addEventListener('click', () => toastInfo('Função de PDF em desenvolvimento...'));
  document.getElementById('btn-salvar-cadastro').addEventListener('click', salvarCadastro);
  document.getElementById('btn-salvar-edicao').addEventListener('click', salvarEdicao);
  document.getElementById('btn-confirmar-emprestimo').addEventListener('click', confirmarEmprestimo);
  
  if (btnExcluir) btnExcluir.addEventListener('click', excluirSelecionados);
  document.getElementById('btn-confirmar-remocao').addEventListener('click', confirmarRemocao);
  
  if (btnUsuarios) btnUsuarios.addEventListener('click', abrirGerenciarUsuarios);
  document.getElementById('btn-novo-usuario')?.addEventListener('click', abrirNovoUsuario);
  document.getElementById('btn-atualizar-usuarios')?.addEventListener('click', carregarUsuariosUI);
  document.getElementById('btn-salvar-usuario')?.addEventListener('click', salvarUsuario);
  document.getElementById('btn-confirmar-redefinir-senha')?.addEventListener('click', confirmarRedefinirSenha);

  document.getElementById('filtro-busca').addEventListener('input', aplicarFiltros);
  document.getElementById('filtro-status').addEventListener('change', aplicarFiltros);
  
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

  document.getElementById('btn-pagina-anterior').addEventListener('click', function() {
    if (paginaAtual > 1) { paginaAtual--; renderTabelaEquipamentos(equipamentosFiltrados); }
  });
  document.getElementById('btn-proxima-pagina').addEventListener('click', function() {
    if (paginaAtual < Math.ceil(equipamentosFiltrados.length / ITENS_POR_PAGINA)) {
      paginaAtual++;
      renderTabelaEquipamentos(equipamentosFiltrados);
    }
  });

  console.log('✅ Dashboard Filial inicializado!');
});

// ============================================================================
// CARREGAMENTO DE LISTAS (CASCATA + "OUTRO" + TV/PROJETOR)
// ============================================================================

async function carregarListasCadastro() {
  console.log('🟢 carregarListasCadastro() iniciado...');
  try {
    const res = await fetch(`${getApiBaseUrl()}/listas-cadastro`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success) {
      console.log('✅ Listas recebidas:', data.data);
      processarListas(data.data);
      preencherSelectCategoria('new');
      preencherSelectCategoria('edit');
      // Popular os filtros de categoria/marca/modelo da tabela com a mesma fonte
      popularFiltroCategoria();
      popularFiltroMarca('');
      popularFiltroModelo('', '');
    }
  } catch (err) {
    console.error('❌ Erro ao carregar listas:', err);
    toastError('Erro ao carregar listas. Recarregue a página.');
  }
}

function processarListas(combinacoes) {
  const categorias = new Set();
  const marcasPorCategoria = {};
  const modelosPorCategoriaMarca = {};

  // Mescla os dados da API com o catálogo padrão
  const catalogoItens = CATALOGO_PARA_LISTAS();
  const combinadas = (combinacoes || []).concat(catalogoItens);

  combinadas.forEach(item => {
    const cat = item.categoria, marca = item.marca, modelo = item.modelo;
    if (!cat || !marca || !modelo) return;
    if (cat === 'Monitor') return; // Exclui Monitor da cascata (conforme original)
    categorias.add(cat);
    if (!marcasPorCategoria[cat]) marcasPorCategoria[cat] = new Set();
    marcasPorCategoria[cat].add(marca);
    if (!modelosPorCategoriaMarca[cat]) modelosPorCategoriaMarca[cat] = {};
    if (!modelosPorCategoriaMarca[cat][marca]) modelosPorCategoriaMarca[cat][marca] = new Set();
    modelosPorCategoriaMarca[cat][marca].add(modelo);
  });

  // Garante TV e Projetor nas categorias (caso especial sem marca/modelo)
  if (!categorias.has('TV')) categorias.add('TV');
  if (!categorias.has('Projetor')) categorias.add('Projetor');

  listasCache = {
    combinacoes: combinadas,
    categorias: Array.from(categorias).sort(),
    marcasPorCategoria,
    modelosPorCategoriaMarca
  };
}

// Retorna itens do catálogo no formato esperado por setListasCache
function CATALOGO_PARA_LISTAS() {
  // Importa do módulo catalogo-modelos (dados estáticos)
  return window.CATALOGO_LISTAS_CACHE || [];
}

// Carrega o catálogo estático no window para uso em processarListas
import('../shared/js/catalogo-modelos.js').then(mod => {
  window.CATALOGO_LISTAS_CACHE = mod.getCombinacoesDoCatalogo?.() || [];
});

function preencherSelectCategoria(prefixo) {
  const select = document.getElementById(prefixo + '-categoria');
  if (!select || !listasCache) return;
  const valorAtual = select.value;
  select.innerHTML = '<option value="" disabled selected>Selecione</option>' +
    listasCache.categorias.map(c => `<option value="${c}">${c}</option>`).join('');
  if (valorAtual && listasCache.categorias.indexOf(valorAtual) !== -1) {
    select.value = valorAtual;
  } else {
    select.value = '';
  }
  if (window.M && M.FormSelect) M.FormSelect.init(select);
  
  // Dispara onCategoriaChange para configurar marca/modelo
  if (typeof window.onCategoriaChange === 'function') {
    window.onCategoriaChange(prefixo);
  }
}

function popularMarcas(prefixo, categoria) {
  const selectMarca = document.getElementById(prefixo + '-marca');
  const marcaContainer = document.getElementById(prefixo + '-marca-container');
  const marcaTextContainer = document.getElementById(prefixo + '-marca-text-container');
  const outroMarcaContainer = document.getElementById(prefixo + '-outro-marca-container');
  
  if (!selectMarca || !listasCache) return;
  const valorAtual = selectMarca.value;
  
  const isEspecial = (categoria === 'TV' || categoria === 'Projetor');
  
  if (isEspecial) {
    // Para TV/Projetor: esconde selects de marca/modelo, mostra input de texto para marca
    if (marcaContainer) marcaContainer.style.display = 'none';
    if (marcaTextContainer) marcaTextContainer.style.display = 'block';
    limparModelo(prefixo);
    limparCamposEspecificacao(prefixo);
    return;
  }
  
  if (marcaContainer) marcaContainer.style.display = 'block';
  if (marcaTextContainer) marcaTextContainer.style.display = 'none';
  
  const marcasSet = listasCache.marcasPorCategoria[categoria] || new Set();
  const marcas = Array.from(marcasSet).sort();
  
  selectMarca.innerHTML = '<option value="" disabled selected>Selecione uma marca</option>' +
    marcas.map(m => `<option value="${m}">${m}</option>`).join('') +
    '<option value="__outro__">Outro (digitar)</option>';
  
  if (valorAtual && marcas.includes(valorAtual)) {
    selectMarca.value = valorAtual;
  } else if (valorAtual && valorAtual !== '__outro__') {
    selectMarca.value = '__outro__';
    const input = document.getElementById(prefixo + '-outro-marca');
    if (input) input.value = valorAtual;
    if (outroMarcaContainer) outroMarcaContainer.style.display = 'block';
  } else {
    selectMarca.value = '';
    if (outroMarcaContainer) outroMarcaContainer.style.display = 'none';
  }
  
  if (window.M && M.FormSelect) M.FormSelect.init(selectMarca);
  
  if (selectMarca.value && selectMarca.value !== '__outro__') {
    popularModelos(prefixo, categoria, selectMarca.value);
  } else {
    limparModelo(prefixo);
  }
}

function popularModelos(prefixo, categoria, marca) {
  const selectModelo = document.getElementById(prefixo + '-modelo');
  const modeloContainer = document.getElementById(prefixo + '-modelo-container');
  const modeloTextContainer = document.getElementById(prefixo + '-modelo-text-container');
  const outroModeloContainer = document.getElementById(prefixo + '-outro-modelo-container');
  
  if (!selectModelo || !listasCache) return;
  const valorAtual = selectModelo.value;
  
  const isEspecial = (categoria === 'TV' || categoria === 'Projetor');
  
  if (isEspecial) {
    if (modeloContainer) modeloContainer.style.display = 'none';
    if (modeloTextContainer) modeloTextContainer.style.display = 'block';
    limparCamposEspecificacao(prefixo);
    return;
  }
  
  if (modeloContainer) modeloContainer.style.display = 'block';
  if (modeloTextContainer) modeloTextContainer.style.display = 'none';
  
  const modelosSet = listasCache.modelosPorCategoriaMarca[categoria]?.[marca] || new Set();
  const modelos = Array.from(modelosSet).sort();
  
  selectModelo.innerHTML = '<option value="" disabled selected>Selecione um modelo</option>' +
    modelos.map(m => `<option value="${m}">${m}</option>`).join('') +
    '<option value="__outro__">Outro (digitar)</option>';
  
  if (valorAtual && modelos.includes(valorAtual)) {
    selectModelo.value = valorAtual;
  } else if (valorAtual && valorAtual !== '__outro__') {
    selectModelo.value = '__outro__';
    const input = document.getElementById(prefixo + '-outro-modelo');
    if (input) input.value = valorAtual;
    if (outroModeloContainer) outroModeloContainer.style.display = 'block';
  } else {
    selectModelo.value = '';
    if (outroModeloContainer) outroModeloContainer.style.display = 'none';
  }
  
  if (window.M && M.FormSelect) M.FormSelect.init(selectModelo);
  
  // Se modelo já selecionado, preenche specs
  if (selectModelo.value && selectModelo.value !== '__outro__') {
    preencherEspecificacoesModelo(prefixo, selectModelo.value);
  } else {
    limparCamposEspecificacao(prefixo);
  }
}

function limparMarcaModelo(prefixo) {
  const selectMarca = document.getElementById(prefixo + '-marca');
  if (selectMarca) {
    selectMarca.innerHTML = '<option value="" disabled selected>Selecione a categoria</option>';
    if (window.M && M.FormSelect) M.FormSelect.init(selectMarca);
  }
  limparModelo(prefixo);
  const outroMarcaContainer = document.getElementById(prefixo + '-outro-marca-container');
  if (outroMarcaContainer) outroMarcaContainer.style.display = 'none';
}

function limparModelo(prefixo) {
  const selectModelo = document.getElementById(prefixo + '-modelo');
  if (selectModelo) {
    selectModelo.innerHTML = '<option value="" disabled selected>Selecione a marca</option>';
    if (window.M && M.FormSelect) M.FormSelect.init(selectModelo);
  }
  const outroModeloContainer = document.getElementById(prefixo + '-outro-modelo-container');
  if (outroModeloContainer) outroModeloContainer.style.display = 'none';
  limparCamposEspecificacao(prefixo);
}

function toggleOutroCampo(prefixo, tipo) {
  const select = document.getElementById(prefixo + '-' + tipo);
  const container = document.getElementById(prefixo + '-outro-' + tipo + '-container');
  const input = document.getElementById(prefixo + '-outro-' + tipo);
  if (!select || !container || !input) return;
  if (select.value === '__outro__') {
    container.style.display = 'block';
    input.focus();
  } else {
    container.style.display = 'none';
    input.value = '';
  }
}

// ============================================================================
// FUNÇÕES GLOBAIS PARA ONCHANGE NO HTML (CASCATA)
// ============================================================================

window.onCategoriaChange = function(prefixo) {
  const select = document.getElementById(prefixo + '-categoria');
  const categoria = select.value;
  const isEspecial = (categoria === 'TV' || categoria === 'Projetor');
  
  // Mostra/esconde containers de marca/modelo
  const marcaContainer = document.getElementById(prefixo + '-marca-container');
  const marcaTextContainer = document.getElementById(prefixo + '-marca-text-container');
  const modeloContainer = document.getElementById(prefixo + '-modelo-container');
  const modeloTextContainer = document.getElementById(prefixo + '-modelo-text-container');
  const outroMarcaContainer = document.getElementById(prefixo + '-outro-marca-container');
  const outroModeloContainer = document.getElementById(prefixo + '-outro-modelo-container');
  
  if (isEspecial) {
    if (marcaContainer) marcaContainer.style.display = 'none';
    if (marcaTextContainer) marcaTextContainer.style.display = 'block';
    if (modeloContainer) modeloContainer.style.display = 'none';
    if (modeloTextContainer) modeloTextContainer.style.display = 'block';
    if (outroMarcaContainer) outroMarcaContainer.style.display = 'none';
    if (outroModeloContainer) outroModeloContainer.style.display = 'none';
    limparModelo(prefixo);
    limparCamposEspecificacao(prefixo);
  } else {
    if (marcaContainer) marcaContainer.style.display = 'block';
    if (marcaTextContainer) marcaTextContainer.style.display = 'none';
    if (modeloContainer) modeloContainer.style.display = 'block';
    if (modeloTextContainer) modeloTextContainer.style.display = 'none';
    if (outroMarcaContainer) outroMarcaContainer.style.display = 'none';
    if (outroModeloContainer) outroModeloContainer.style.display = 'none';
    if (categoria) {
      popularMarcas(prefixo, categoria);
    } else {
      limparMarcaModelo(prefixo);
    }
  }
};

window.onMarcaChange = function(prefixo) {
  const selectMarca = document.getElementById(prefixo + '-marca');
  const selectCategoria = document.getElementById(prefixo + '-categoria');
  const categoria = selectCategoria?.value;
  const isEspecial = (categoria === 'TV' || categoria === 'Projetor');
  
  const outroMarcaContainer = document.getElementById(prefixo + '-outro-marca-container');
  if (outroMarcaContainer) toggleOutroCampo(prefixo, 'marca');
  
  if (selectMarca && selectCategoria && selectMarca.value && selectMarca.value !== '__outro__' && categoria && !isEspecial) {
    popularModelos(prefixo, categoria, selectMarca.value);
  } else {
    limparModelo(prefixo);
    limparCamposEspecificacao(prefixo);
  }
};

window.onModeloChange = function(prefixo) {
  const selectModelo = document.getElementById(prefixo + '-modelo');
  const valor = selectModelo.value;
  if (valor && valor !== '__outro__') {
    preencherEspecificacoesModelo(prefixo, valor);
  } else {
    limparCamposEspecificacao(prefixo);
  }
  const outroModeloContainer = document.getElementById(prefixo + '-outro-modelo-container');
  if (outroModeloContainer) toggleOutroCampo(prefixo, 'modelo');
};

window.onModeloTextChange = function(prefixo) {
  const input = document.getElementById(prefixo + '-modelo-text');
  const valor = input.value.trim();
  if (valor) {
    preencherEspecificacoesModelo(prefixo, valor);
  } else {
    limparCamposEspecificacao(prefixo);
  }
};

function limparCamposEspecificacao(prefixo) {
  const campos = ['sistemaOperacional', 'processador', 'memoriaRAM', 'armazenamento', 'tamanhoTela'];
  campos.forEach(campo => {
    const el = document.getElementById(prefixo + '-' + campo);
    if (el) el.value = '';
  });
  if (window.M && typeof M.updateTextFields === 'function') M.updateTextFields();
}

// ============================================================================
// CAMPOS CONDICIONAIS (STATUS)
// ============================================================================

window.atualizarCamposCondicionaisCadastro = function() {
  const status = document.getElementById('new-status')?.value;
  const campoQuebrado = document.getElementById('campo-quebrado-cadastro');
  if (campoQuebrado) campoQuebrado.style.display = status === 'Quebrado' ? 'block' : 'none';
  if (status !== 'Quebrado') {
    const descInput = document.getElementById('new-descricaoQuebrado');
    if (descInput) descInput.value = '';
  }
  const campoBo = document.getElementById('campo-bo-cadastro');
  if (campoBo) campoBo.style.display = status === 'Extraviado' ? 'block' : 'none';
  if (status !== 'Extraviado') {
    const anexoInput = document.getElementById('new-anexoBoletim');
    if (anexoInput) anexoInput.value = '';
  }
};

window.atualizarCamposCondicionais = function() {
  const status = document.getElementById('edit-status')?.value;
  const campoChamado = document.getElementById('campo-chamado');
  if (campoChamado) campoChamado.style.display = status === 'Manutenção' ? 'block' : 'none';
  const campoBo = document.getElementById('campo-bo');
  if (campoBo) campoBo.style.display = status === 'Extraviado' ? 'block' : 'none';
  const campoQuebrado = document.getElementById('campo-quebrado');
  if (campoQuebrado) campoQuebrado.style.display = status === 'Quebrado' ? 'block' : 'none';
  if (status !== 'Quebrado') {
    const descInput = document.getElementById('edit-descricaoQuebrado');
    if (descInput) descInput.value = '';
  }
  if (status !== 'Extraviado') {
    const anexoInput = document.getElementById('edit-anexoBoletim');
    if (anexoInput) anexoInput.value = '';
  }
};

// ============================================================================
// CARREGAMENTO DE EQUIPAMENTOS (FILIAL - APENAS SUA UNIDADE)
// ============================================================================

async function carregarEquipamentos() {
  console.log('🟢 carregarEquipamentos() INICIADA');
  showLoading();
  try {
    const res = await fetch(`${getApiBaseUrl()}/equipamentos-da-filial`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    equipamentosCache = data.data || [];
    setEquipamentosCache(equipamentosCache);
    equipamentosCache.forEach(item => {
      if (item.status === 'Emprestado' && item.dataPrevistaDevolucao) {
        const hoje = new Date(); const prevista = new Date(item.dataPrevistaDevolucao);
        item.emAtraso = prevista < hoje;
      } else { item.emAtraso = false; }
    });
    aplicarFiltros();
  } catch (err) { toastError('Erro ao carregar: ' + err.message); }
  finally { hideLoading(); }
}

async function carregarInfoCabecalho() {
  try {
    const res = await fetch(`${getApiBaseUrl()}/get-nome-usuario`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success) {
      const inf = data.data || {};
      const elUnidade = document.getElementById('nome-unidade');
      const elPerfil = document.getElementById('perfil-usuario');
      if (elUnidade) elUnidade.innerText = inf.filial || '—';
      if (elPerfil) elPerfil.innerText = inf.nivel || '—';
    }
  } catch (e) { /* cabeçalho opcional */ }
}

// ============================================================================
// FILTROS E TABELA
// ============================================================================

function aplicarFiltros() {
  const busca = document.getElementById('filtro-busca')?.value?.trim()?.toLowerCase() || '';
  const status = document.getElementById('filtro-status')?.value || '';
  const categoria = document.getElementById('filtro-categoria')?.value || '';
  const marca = document.getElementById('filtro-marca')?.value || '';
  const modelo = document.getElementById('filtro-modelo')?.value || '';
  
  equipamentosFiltrados = equipamentosCache.filter(item => {
    let match = true;
    if (status && item.status !== status) match = false;
    if (categoria && item.categoria !== categoria) match = false;
    if (marca && item.marca !== marca) match = false;
    if (modelo && item.modelo !== modelo) match = false;
    if (busca) {
      const searchable = [item.patrimonio, item.numeroSerie, item.modelo, item.unidade].join(' ').toLowerCase();
      if (searchable.indexOf(busca) === -1) match = false;
    }
    return match;
  });
  
  paginaAtual = 1;
  renderTabelaEquipamentos(equipamentosFiltrados);
  atualizarKpis(equipamentosFiltrados);
  atualizarGraficos(equipamentosFiltrados);
}

// ============================================================================
// GRÁFICOS
// ============================================================================

function atualizarGraficos(equipamentos) {
  const porStatus = {};
  equipamentos.forEach(item => { const s = item.status || 'Não definido'; porStatus[s] = (porStatus[s] || 0) + 1; });
  renderGraficoStatus(porStatus);
  
  const porCategoria = {};
  equipamentos.forEach(item => { const c = item.categoria || 'Sem categoria'; if (c === 'Monitor') return; porCategoria[c] = (porCategoria[c] || 0) + 1; });
  renderGraficoCategoria(porCategoria);
}

function renderGraficoStatus(porStatus) {
  const canvas = document.getElementById('canvas-chart-status');
  if (!canvas) return;
  const labels = Object.keys(porStatus);
  const valores = labels.map(l => porStatus[l]);
  const cores = ['#1565c0', '#43a047', '#ef6c00', '#d32f2f', '#8e24aa', '#00838f', '#795548', '#607d8b'];
  if (chartStatus) chartStatus.destroy();
  chartStatus = new Chart(canvas.getContext('2d'), {
    type: 'pie',
    data: { labels, datasets: [{ data: valores, backgroundColor: cores.slice(0, labels.length) }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } } } }
  });
}

function renderGraficoCategoria(porCategoria) {
  const canvas = document.getElementById('canvas-chart-categoria');
  if (!canvas) return;
  const labels = Object.keys(porCategoria);
  const dados = labels.map(l => porCategoria[l]);
  const cores = ['#4a148c', '#6a1b9a', '#7b1fa2', '#8e24aa', '#9c27b0', '#ab47bc', '#ba68c8', '#ce93d8', '#e1bee7', '#f3e5f5'];
  if (chartCategoria) chartCategoria.destroy();
  if (labels.length === 0) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#999';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Nenhuma categoria disponível', canvas.width / 2, canvas.height / 2);
    return;
  }
  chartCategoria = new Chart(canvas.getContext('2d'), {
    type: 'pie',
    data: { labels, datasets: [{ data: dados, backgroundColor: cores.slice(0, labels.length) }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } } } }
  });
}

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
  paginaAtual = 1;
  renderTabelaEquipamentos(equipamentosFiltrados);
}

function renderTabelaEquipamentos(equipamentos) {
  const tbody = document.querySelector('#tabela-equipamentos tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!equipamentos || equipamentos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--sce-muted);">🔍 Nenhum equipamento encontrado com os filtros aplicados.</td></tr>';
    const info = document.getElementById('pagina-info');
    if (info) info.innerText = 'Página 0 de 0 - 0 itens';
    return;
  }
  const inicio = (paginaAtual - 1) * ITENS_POR_PAGINA;
  const pagina = equipamentos.slice(inicio, inicio + ITENS_POR_PAGINA);
  pagina.forEach(item => {
    const tr = document.createElement('tr');
    const statusClass = 'status-' + (item.status || '').toLowerCase().replace(/ /g, '-');
    tr.className = statusClass;
    let badgeManutencao = '-';
    if (item.statusManutencao) {
      const statusManut = item.statusManutencao.toLowerCase().replace(/ /g, '-');
      let badgeClass = 'badge-manutencao ';
      if (statusManut === 'pendente') badgeClass += 'badge-pendente';
      else if (statusManut === 'em-andamento') badgeClass += 'badge-em-andamento';
      else if (statusManut === 'concluído') badgeClass += 'badge-concluído';
      badgeManutencao = '<span class="' + badgeClass + '">' + item.statusManutencao + '</span>';
    }
    let indicadorAtraso = '-';
    if (item.status === 'Emprestado' && item.dataPrevistaDevolucao) {
      const hoje = new Date();
      const prevista = new Date(item.dataPrevistaDevolucao);
      const atrasado = prevista < hoje;
      const label = atrasado ? 'Atrasado' : 'Em dia';
      const cls = atrasado ? 'badge-atrasado' : 'badge-em-dia';
      indicadorAtraso = '<span class="badge-atraso ' + cls + '">' + label + '</span>';
    }
    tr.innerHTML =
      '<td class="no-print"><label><input type="checkbox" class="check-equipamento" value="' + item.id + '"><span></span></label></td>' +
      '<td>' + (item.categoria || '') + '</td>' +
      '<td>' + (item.marca || '') + '</td>' +
      '<td>' + (item.modelo || '') + '</td>' +
      '<td>' + (item.patrimonio || '') + (item.justificativaPatrimonio ? ' *' : '') + '</td>' +
      '<td><strong>' + (item.status || '') + '</strong></td>' +
      '<td>' + badgeManutencao + '</td>' +
      '<td>' + indicadorAtraso + '</td>' +
      '<td class="no-print" style="text-align:center;">' +
      '<button class="btn-acao" onclick="editarEquipamento(\'' + item.id + '\')" title="Editar"><i class="material-icons">edit</i></button> ' +
      '<button class="btn-acao" onclick="abrirHistorico(\'' + item.id + '\')" title="Histórico"><i class="material-icons">history</i></button> ' +
      '<button class="btn-acao-excluir" onclick="abrirModalRemocao(\'' + item.id + '\')" title="Excluir"><i class="material-icons">delete</i></button>' +
      '</td>';
    tbody.appendChild(tr);
  });
  const totalPaginas = Math.max(1, Math.ceil(equipamentos.length / ITENS_POR_PAGINA));
  const info = document.getElementById('pagina-info');
  if (info) info.innerText = 'Página ' + paginaAtual + ' de ' + totalPaginas + ' - ' + equipamentos.length + ' itens';
}

async function excluirSelecionados() {
  const ids = getIdsSelecionados();
  if (ids.length === 0) { toastError('Selecione pelo menos um equipamento.'); return; }
  if (!confirm('Tem certeza que deseja excluir os ' + ids.length + ' equipamento(s) selecionado(s)? Esta ação não pode ser desfeita.')) return;

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
        setButtonLoading(btn, false);
        toastSuccess('Equipamentos excluídos com sucesso.');
        carregarEquipamentos();
      }
    }).catch(err => {
      setButtonLoading(btn, false);
      toastError('Erro ao excluir: ' + err.message);
    });
  });
}

// ============================================================================
// FILTROS DE CATEGORIA/MARCA/MODELO (usam listasCache)
// ============================================================================

function popularFiltroCategoria() {
  const select = document.getElementById('filtro-categoria');
  if (!select || !listasCache) return;
  const valorAtual = select.value;
  select.innerHTML = '<option value="">Todas</option>' + listasCache.categorias.map(c => `<option value="${c}">${c}</option>`).join('');
  select.value = (valorAtual && listasCache.categorias.indexOf(valorAtual) !== -1) ? valorAtual : '';
}

function popularFiltroMarca(categoria) {
  const select = document.getElementById('filtro-marca');
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
// EMPRÉSTIMO / DEVOLUÇÃO
// ============================================================================

function getIdsSelecionados() {
  return Array.from(document.querySelectorAll('.check-equipamento:checked')).map(el => el.value);
}

function abrirEmprestimoSelecionados() {
  const ids = getIdsSelecionados();
  if (ids.length === 0) { toastError('Selecione pelo menos um equipamento.'); return; }
  emprestimoIdsSelecionados = ids;
  
  if (!modalTipoEmprestimoInstance && window.M && M.Modal) {
    modalTipoEmprestimoInstance = M.Modal.init(document.getElementById('modal-tipo-emprestimo'));
  }
  modalTipoEmprestimoInstance.open();
}

function selecionarTipoEmprestimo(tipo) {
  if (modalTipoEmprestimoInstance) modalTipoEmprestimoInstance.close();
  const campoEscola = document.getElementById('emp-campo-escola');
  const selectEscola = document.getElementById('emp-escola-destino');
  document.getElementById('emp-tipo').value = tipo;
  
  if (tipo === 'interestadual') {
    campoEscola.style.display = 'block';
    if (selectEscola.options.length <= 1) {
      fetch(`${getApiBaseUrl()}/filiais-para-emprestimo`, { headers: getAuthHeaders() })
        .then(r => r.json()).then(data => {
          if (data.success) {
            selectEscola.innerHTML = '<option value="" disabled selected>Selecione a escola de destino</option>' +
              data.data.map(f => `<option value="${f}">${f}</option>`).join('');
            if (window.M && M.FormSelect) M.FormSelect.init(selectEscola);
          }
        });
    }
  } else {
    campoEscola.style.display = 'none';
    selectEscola.value = '';
  }
  
  if (!modalEmprestimoInstance && window.M && M.Modal) {
    modalEmprestimoInstance = M.Modal.init(document.getElementById('modal-emprestimo'));
  }
  modalEmprestimoInstance.open();
}

async function confirmarEmprestimo() {
  const btn = document.getElementById('btn-confirmar-emprestimo');
  if (isButtonLoading(btn)) return;
  
  const ids = emprestimoIdsSelecionados;
  const tipo = document.getElementById('emp-tipo').value;
  const dados = {
    responsavel: document.getElementById('emp-responsavel').value.trim(),
    cpf: document.getElementById('emp-cpf').value.trim(),
    emailResponsavel: document.getElementById('emp-email').value.trim(),
    dataPrevistaDevolucao: document.getElementById('emp-prevista').value,
    observacoes: document.getElementById('emp-observacoes').value.trim(),
    tipoEmprestimo: tipo
  };
  
  if (!dados.responsavel) { toastError('Informe o responsável.'); return; }
  if (tipo === 'interestadual') {
    const escolaDestino = document.getElementById('emp-escola-destino').value;
    if (!escolaDestino) { toastError('Selecione a escola de destino.'); return; }
    dados.escolaDestino = escolaDestino;
  }
  
  setButtonLoading(btn, true);
  try {
    const res = await fetch(`${getApiBaseUrl()}/registrar-emprestimo`, {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ ids, ...dados })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    
    setButtonLoading(btn, false);
    toastSuccess(data.message || 'Empréstimo(s) registrado(s).');
    if (modalEmprestimoInstance) modalEmprestimoInstance.close();
    await carregarEquipamentos();
  } catch (err) {
    setButtonLoading(btn, false);
    toastError('Erro no empréstimo: ' + err.message);
  }
}

async function devolverSelecionados() {
  const btn = document.getElementById('btn-devolver-selecionados');
  if (isButtonLoading(btn)) return;
  
  const ids = getIdsSelecionados();
  if (ids.length === 0) { toastError('Selecione pelo menos um equipamento.'); return; }
  
  setButtonLoading(btn, true);
  try {
    const res = await fetch(`${getApiBaseUrl()}/registrar-devolucao`, {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ ids, observacao: '' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    
    setButtonLoading(btn, false);
    toastSuccess(data.message || 'Devolução(s) registrada(s).');
    await carregarEquipamentos();
  } catch (err) {
    setButtonLoading(btn, false);
    toastError('Erro na devolução: ' + err.message);
  }
}

// ============================================================================
// GERENCIAMENTO DE USUÁRIOS (AdminFilial)
// ============================================================================

let usuariosCache = [];

function abrirGerenciarUsuarios() {
  if (!modalUsuariosInstance && window.M && M.Modal) {
    modalUsuariosInstance = M.Modal.init(document.getElementById('modal-gerenciar-usuarios'));
  }
  modalUsuariosInstance.open();
  carregarUsuariosUI();
}

async function carregarUsuariosUI() {
  showLoading();
  try {
    const res = await fetch(`${getApiBaseUrl()}/listar-usuarios`, { headers: getAuthHeaders() });
    const data = await res.json();
    usuariosCache = data.data || [];
    renderTabelaUsuarios(usuariosCache);
  } catch (err) { toastError('Erro ao carregar usuários: ' + err.message); }
  finally { hideLoading(); }
}

function renderTabelaUsuarios(usuarios) {
  const tbody = document.querySelector('#tabela-usuarios tbody');
  tbody.innerHTML = '';
  if (!usuarios || usuarios.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">Nenhum usuário cadastrado.</td></tr>';
    return;
  }
  usuarios.forEach(u => {
    const isSelf = u.email === getToken().split('.')[0];
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (u.email || '') + '</td>' +
      '<td>' + (u.nome || '') + '</td>' +
      '<td>' + (u.nivel || '') + '</td>' +
      '<td>' + (u.filial || '') + '</td>' +
      '<td>' + (u.status || '') + '</td>' +
      '<td>' + (isSelf ? '' : '<button class="btn-acao" onclick="editarUsuarioUI(\'' + u.email + '\')" title="Editar"><i class="material-icons">edit</i></button> <button class="btn-acao" onclick="redefinirSenhaUI(\'' + u.email + '\')" title="Redefinir senha"><i class="material-icons">vpn_key</i></button> <button class="btn-acao danger" onclick="removerUsuarioUI(\'' + u.email + '\')" title="Remover"><i class="material-icons">delete</i></button>') +
      '</td>';
    tbody.appendChild(tr);
  });
}

function redefinirSenhaUI(email) {
  document.getElementById('rd-email').innerText = email;
  document.getElementById('rd-senha').value = '';
  document.getElementById('rd-senha-confirm').value = '';
  if (!modalRedefinirSenhaInstance && window.M && M.Modal) {
    modalRedefinirSenhaInstance = M.Modal.init(document.getElementById('modal-redefinir-senha'));
  }
  modalRedefinirSenhaInstance.open();
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
    const res = await fetch(`${getApiBaseUrl()}/redefinir-senha`, {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ email, novaSenha: senha })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    toastSuccess('Senha redefinida com sucesso.');
    if (modalRedefinirSenhaInstance) modalRedefinirSenhaInstance.close();
  } catch (err) {
    toastError('Erro ao redefinir senha: ' + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

function abrirNovoUsuario() {
  document.getElementById('titulo-modal-usuario').innerText = 'Adicionar usuário';
  document.getElementById('usuario-email-original').value = '';
  document.getElementById('usuario-email').value = '';
  document.getElementById('usuario-email').disabled = false;
  document.getElementById('usuario-nome').value = '';
  
  const nivelEl = document.getElementById('usuario-nivel');
  const filialEl = document.getElementById('usuario-filial');
  if (nivelEl && filialEl) {
    nivelEl.value = 'Filial';
    filialEl.value = '';
    if (window.M) { M.updateTextFields(); M.FormSelect.init(nivelEl); }
  }
  
  if (!modalEditarUsuarioInstance && window.M && M.Modal) {
    modalEditarUsuarioInstance = M.Modal.init(document.getElementById('modal-editar-usuario'));
  }
  modalEditarUsuarioInstance.open();
}

function editarUsuarioUI(email) {
  const usuario = usuariosCache.find(u => u.email === email);
  if (!usuario) { toastError('Usuário não encontrado.'); return; }
  document.getElementById('titulo-modal-usuario').innerText = 'Editar usuário';
  document.getElementById('usuario-email-original').value = email;
  document.getElementById('usuario-email').value = email;
  document.getElementById('usuario-email').disabled = true;
  document.getElementById('usuario-nome').value = usuario.nome || '';
  
  const nivelEl = document.getElementById('usuario-nivel');
  const filialEl = document.getElementById('usuario-filial');
  if (nivelEl && filialEl) {
    nivelEl.value = usuario.nivel || 'Filial';
    filialEl.value = usuario.filial || '';
    if (window.M) { M.updateTextFields(); M.FormSelect.init(nivelEl); }
  }
  
  if (!modalEditarUsuarioInstance && window.M && M.Modal) {
    modalEditarUsuarioInstance = M.Modal.init(document.getElementById('modal-editar-usuario'));
  }
  modalEditarUsuarioInstance.open();
}

async function salvarUsuario() {
  const btn = document.getElementById('btn-salvar-usuario');
  if (isButtonLoading(btn)) return;
  
  const email = document.getElementById('usuario-email').value.trim();
  const nome = document.getElementById('usuario-nome').value.trim();
  const nivel = document.getElementById('usuario-nivel').value;
  const filial = document.getElementById('usuario-filial').value.trim();
  
  if (!email) { toastError('E-mail é obrigatório.'); return; }
  if (!nome) { toastError('Nome é obrigatório.'); return; }
  
  const dados = { email, nome, nivel, filial };
  const emailOriginal = document.getElementById('usuario-email-original').value;
  
  setButtonLoading(btn, true);
  try {
    const action = emailOriginal ? 'atualizar-usuario' : 'adicionar-usuario';
    const url = '/api/' + action + '?token=' + encodeURIComponent(getToken());
    const body = emailOriginal ? JSON.stringify({ emailOriginal, ...dados }) : JSON.stringify(dados);
    const res = await fetch(url, { method: 'POST', headers: getAuthHeaders(), body });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    
    setButtonLoading(btn, false);
    toastSuccess(emailOriginal ? 'Usuário atualizado.' : 'Usuário adicionado.');
    if (modalEditarUsuarioInstance) modalEditarUsuarioInstance.close();
    await carregarUsuariosUI();
  } catch (err) {
    setButtonLoading(btn, false);
    toastError('Erro: ' + err.message);
  }
}

async function removerUsuarioUI(email) {
  if (!confirm('Tem certeza que deseja remover o usuário ' + email + '?')) return;
  showLoading();
  try {
    const res = await fetch(`${getApiBaseUrl()}/remover-usuario`, {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    toastSuccess('Usuário removido.');
    await carregarUsuariosUI();
  } catch (err) { toastError('Erro ao remover: ' + err.message); }
  finally { hideLoading(); }
}

console.log('✅ Dashboard Filial loaded');