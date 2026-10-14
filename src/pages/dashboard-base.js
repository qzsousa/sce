// ============================================================================
// DASHBOARD BASE — Funcionalidades comuns a todos os dashboards
// ============================================================================

import { getEquipamentosDaFilial, getEquipamentosGlobal, createEquipamento, updateEquipamento, cloneEquipamento, removerEquipamento, atualizarStatusManutencao, registrarManutencao, getRegistrosManutencao, getHistoricoEquipamento, getEspecificacoesModelo, listarUsuarios, adicionarUsuario, atualizarUsuario, removerUsuario, getFiliaisParaEmprestimo, registrarEmprestimo, registrarDevolucao, exportarCSV, exportarEquipamentosPDF, getNomeUsuario, getApiBaseUrl, getAnexoUrl } from '../shared/js/api.js';
import { showLoading, hideLoading, toastSuccess, toastError, toastInfo, setButtonLoading, isButtonLoading, downloadCsv, openModal, closeModal, initModals, initSelects, updateTextFields, fileToBase64, validateFile } from '../shared/js/ui.js';
import { preencherSelectCategoria, popularMarcas, popularModelos, limparMarcaModelo, limparModelo, toggleOutro, getValorFinal, setupSelectCascata, getCategorias, getMarcas, getModelos, setListasCache, getListasCache, habilitarOutroModelo } from '../shared/js/lists.js';
import { formatDate, formatDateShort, getFormData, clearForm, getNested } from '../shared/js/utils.js';
import { getToken, initAuthFromUrl, logout, getAuthHeaders, isAuthenticated } from '../shared/js/auth.js';

// ============================================================================
// CONSTANTES COMPARTILHADAS (exportadas para uso nas páginas)
// ============================================================================

export const ITENS_POR_PAGINA = 25;
export const CAMPOS_EDITAVEIS = [
  'categoria', 'marca', 'modelo', 'patrimonio', 'numeroSerie', 'status',
  'vinculadoBlueMonitor', 'numeroChamadoManutencao', 'boletimOcorrencia',
  'justificativaVerificacao', 'descricaoQuebrado', 'sistemaOperacional',
  'processador', 'memoriaRAM', 'armazenamento', 'tamanhoTela',
  'responsavelAtual', 'observacoes', 'justificativaPatrimonio', 'justificativaNumeroSerie',
  'numeroEtiqueta'
];

export const CAMPOS_CADASTRO = [
  'unidade', 'categoria', 'marca', 'modelo', 'patrimonio', 'numeroSerie', 'status',
  'vinculadoBlueMonitor', 'sistemaOperacional', 'processador', 'memoriaRAM',
  'armazenamento', 'tamanhoTela', 'responsavelAtual', 'observacoes',
  'justificativaPatrimonio', 'justificativaNumeroSerie', 'descricaoQuebrado',
  'numeroEtiqueta'
];

// Cada página deve declarar seu próprio estado (não exportamos estado compartilhado)

let modalCadastroInstance = null;
let modalEdicaoInstance = null;
let modalManutencaoInstance = null;
let modalHistoricoInstance = null;
let modalRemocaoInstance = null;
let equipamentosCache = [];
let itemEmEdicaoOriginal = null;
let equipamentoIdManutencaoAtual = null;

export function setEquipamentosCache(arr) {
  equipamentosCache = arr || [];
}

window.abrirAnexoBoletim = async function (path) {
  try {
    const res = await getAnexoUrl(path, getToken());
    if (res && res.url) {
      window.open(res.url, '_blank');
    } else {
      toastError('Não foi possível gerar o link do anexo.');
    }
  } catch (e) {
    toastError('Erro ao abrir anexo: ' + e.message);
  }
};

window.sceLogout = function () {
  localStorage.removeItem('sce_token');
  window.location.href = '/login';
};

window.toggleKebab = function (btn) {
  const menu = btn && btn.parentElement ? btn.parentElement.querySelector('.kebab-menu') : null;
  document.querySelectorAll('.kebab-menu.open').forEach(m => { if (m !== menu) m.classList.remove('open'); });
  if (menu) menu.classList.toggle('open');
};

document.addEventListener('click', function (e) {
  if (!e.target.closest('.kebab-wrap')) {
    document.querySelectorAll('.kebab-menu.open').forEach(m => m.classList.remove('open'));
  }
});

/* ============================================================================
   INICIALIZAÇÃO BASE
   ============================================================================ */

export async function initDashboardBase(options = {}) {
  const { perfil, loadEquipamentos = true } = options;
  
  // Verifica autenticação
  const token = getToken();
  if (!token || !isAuthenticated()) {
    window.location.href = '/login';
    return;
  }

  // Inicializa Materialize
  if (window.M) {
    initModals();
    initSelects();
    updateTextFields();
  }

  // Carrega listas (categoria/marca/modelo)
  await carregarListas();

  // Configura justificativas
  configurarJustificativas('new');
  configurarJustificativas('edit');

  // Carrega nome do usuário
  carregarNomeUsuario();

  // Carrega equipamentos se necessário
  if (loadEquipamentos) {
    await carregarEquipamentos();
  }

  mostrarPopupNovidadeEtiqueta();

  console.log(`✅ Dashboard ${perfil} inicializado`);
}

/* ============================================================================
   AUTENTICAÇÃO / NOME USUÁRIO
   ============================================================================ */

async function carregarNomeUsuario() {
  try {
    const dados = await getNomeUsuario(getToken());
    // O endpoint retorna um objeto { nome, nivel, filial, email }; extraímos só o nome
    const nome = (dados && typeof dados === 'object') ? (dados.nome || 'Usuário') : (dados || 'Usuário');
    const el = document.getElementById('nome-usuario') || document.getElementById('nome-tecnico');
    if (el) el.innerText = nome;
  } catch {
    const el = document.getElementById('nome-usuario') || document.getElementById('nome-tecnico');
    if (el) el.innerText = 'Usuário';
  }
}

function getScriptUrlBase() {
  return window.location.href.split('?')[0];
}

/* ============================================================================
   LISTAS (CATEGORIA/MARCA/MODELO)
   ============================================================================ */

async function carregarListas() {
  try {
    showLoading();
    const dados = await (window.sceLists?.getListasCache ? window.sceLists.getListasCache() : null) 
      || await window.sceApi?.getListasCache?.() 
      || await fetch(`${getApiBaseUrl()}/listas-cadastro`, { headers: getAuthHeaders() }).then(r => r.json()).then(r => r.data);
    
    if (dados) {
      setListasCache(dados);
      preencherSelectCategoria('new');
      preencherSelectCategoria('edit');
    }
  } catch (err) {
    console.error('Erro ao carregar listas:', err);
    toastError('Erro ao carregar listas. Recarregue a página.');
  } finally {
    hideLoading();
  }
}

function configurarJustificativas(prefixo) {
  // Patrimônio é opcional: não exigimos nem patrimônio nem justificativa.
  const justPatContainer = document.getElementById(`campo-justificativa-patrimonio${prefixo === 'edit' ? '-edit' : ''}`);
  if (justPatContainer) justPatContainer.style.display = 'none';

  const campoSerie = document.getElementById(`${prefixo}-numeroSerie`);
  const justSerieContainer = document.getElementById(`campo-justificativa-serie${prefixo === 'edit' ? '-edit' : ''}`);
  const justSerieInput = document.getElementById(`${prefixo}-justificativaNumeroSerie`);

  if (!campoSerie || !justSerieContainer) return;

  function verificarSerie() {
    const vazio = campoSerie.value.trim() === '';
    justSerieContainer.style.display = vazio ? 'block' : 'none';
    if (justSerieInput) { justSerieInput.required = vazio; if (!vazio) justSerieInput.value = ''; }
  }

  campoSerie.addEventListener('input', verificarSerie);
  verificarSerie();
}

/* ============================================================================
   NÚMERO DE SÉRIE ALEATÓRIO (equipamentos sem número de série físico)
   ============================================================================
   numero_serie é único no banco; valores genéricos como "01", "1" ou "02"
   digitados por uma unidade impedem o cadastro nas demais. Este gerador cria
   um número praticamente único (timestamp + sufixo aleatório) para esses casos. */
function gerarNumeroSerieAleatorio(prefixo) {
  const input = document.getElementById(`${prefixo}-numeroSerie`);
  if (!input) return;
  const base = Date.now().toString().slice(-9);
  const sufixo = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  input.value = base + sufixo;
  // Notifica listeners (verificarSerie oculta a justificativa) e atualiza o
  // label flutuante do Materialize.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (window.M && M.updateTextFields) M.updateTextFields();
  toastInfo(`Número de série gerado: ${input.value}`);
}
window.gerarNumeroSerieAleatorio = gerarNumeroSerieAleatorio;

/* ============================================================================
   CARREGAMENTO DE EQUIPAMENTOS (abstrato - o dashboard específico injeta a imp)
   ============================================================================ */

let carregarEquipamentosImpl = null;

export function setCarregarEquipamentos(fn) {
  carregarEquipamentosImpl = fn;
}

export async function carregarEquipamentos() {
  if (carregarEquipamentosImpl) {
    return await carregarEquipamentosImpl();
  }
  throw new Error('carregarEquipamentos deve ser implementado no dashboard específico');
}

function aplicarFiltros() {
  // Deve ser implementado no dashboard específico
  throw new Error('aplicarFiltros deve ser implementado no dashboard específico');
}

function renderTabelaEquipamentos(equipamentos) {
  // Deve ser implementado no dashboard específico
  throw new Error('renderTabelaEquipamentos deve ser implementado no dashboard específico');
}

/* ============================================================================
   KPIs E GRÁFICOS (base)
   ============================================================================ */

function kpiCard_(icone, valor, label, extraClass) {
  return `<div class="col s12 m3">
    <div class="sce-kpi ${extraClass || ''}">
      <div class="sce-kpi-icon"><i class="material-icons">${icone}</i></div>
      <div><div class="sce-kpi-value">${valor}</div><div class="sce-kpi-label">${label}</div></div>
    </div></div>`;
}

function atualizarKpis(equipamentos) {
  const porStatus = {};
  equipamentos.forEach(item => {
    const s = item.status || 'Não definido';
    porStatus[s] = (porStatus[s] || 0) + 1;
  });

  const total = equipamentos.length;
  const disponiveis = porStatus['Disponível'] || 0;
  const manutencao = porStatus['Manutenção'] || 0;
  const quebrados = porStatus['Quebrado'] || 0;
  const extraviado = porStatus['Extraviado'] || 0;

  const kpisEl = document.getElementById('kpis');
  if (kpisEl) {
    kpisEl.innerHTML =
      kpiCard_('devices', total, 'Total', 'kpi-total') +
      kpiCard_('check_circle', disponiveis, 'Disponíveis', 'kpi-disponiveis') +
      kpiCard_('build', manutencao, 'Manutenção', 'kpi-manutencao') +
      kpiCard_('report', quebrados, 'Quebrados', 'kpi-quebrados') +
      kpiCard_('assignment_late', extraviado, 'Extraviado', 'kpi-extraviado');
  }
}

function renderGraficoStatus(equipamentos) {
  const canvas = document.getElementById('canvas-chart-status');
  if (!canvas) return;
  
  const porStatus = {};
  equipamentos.forEach(item => {
    const s = item.status || 'Não definido';
    porStatus[s] = (porStatus[s] || 0) + 1;
  });
  
  const labels = Object.keys(porStatus);
  const valores = labels.map(l => porStatus[l]);
  const cores = ['#1565c0', '#43a047', '#ef6c00', '#d32f2f', '#8e24aa', '#00838f', '#795548', '#607d8b'];

  if (chartStatus) chartStatus.destroy();
  
  if (window.Chart) {
    chartStatus = new Chart(canvas.getContext('2d'), {
      type: 'pie',
      data: { labels, datasets: [{ data: valores, backgroundColor: cores }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }
}

/* ============================================================================
   CADASTRO DE EQUIPAMENTO
   ============================================================================ */

export function abrirCadastroEquipamento() {
  CAMPOS_CADASTRO.forEach(campo => {
    const el = document.getElementById('new-' + campo);
    if (el && campo !== 'unidade') {
      if (campo === 'status') { el.value = 'Disponível'; return; }
      if (campo === 'vinculadoBlueMonitor') { el.value = 'Não'; return; }
      el.value = '';
    }
  });

  ['categoria', 'marca', 'modelo'].forEach(tipo => {
    const input = document.getElementById('new-outro-' + tipo);
    if (input) input.value = '';
    const container = document.getElementById('new-outro-' + tipo + '-container');
    if (container) container.style.display = 'none';
  });

  const selectUnidade = document.getElementById('new-unidade');
  if (selectUnidade && window.UNIDADES_TECNICO) {
    selectUnidade.innerHTML = window.UNIDADES_TECNICO.map(u => `<option value="${u}">${u}</option>`).join('');
    if (window.UNIDADES_TECNICO.length === 1) {
      selectUnidade.value = window.UNIDADES_TECNICO[0];
      selectUnidade.disabled = true;
    }
    if (window.M && M.FormSelect) M.FormSelect.init(selectUnidade);
  }

  const anexoInput = document.getElementById('new-anexoBoletim');
  if (anexoInput) anexoInput.value = '';
  configurarJustificativas('new');
  const justPatContainer = document.getElementById('campo-justificativa-patrimonio');
  const justSerieContainer = document.getElementById('campo-justificativa-serie');
  if (justPatContainer) justPatContainer.style.display = 'none';
  if (justSerieContainer) justSerieContainer.style.display = 'none';

  if (getListasCache()) preencherSelectCategoria('new');
  else { carregarListas(); setTimeout(() => preencherSelectCategoria('new'), 500); }

  atualizarCamposCondicionaisCadastro();
  if (window.M) { initSelects('#modal-cadastrar-equipamento select'); updateTextFields(); }

  if (!modalCadastroInstance && window.M && M.Modal) {
    modalCadastroInstance = M.Modal.init(document.getElementById('modal-cadastrar-equipamento'));
  }
  modalCadastroInstance?.open();
}

function atualizarCamposCondicionaisCadastro() {
  const status = document.getElementById('new-status')?.value;
  const campoBo = document.getElementById('campo-bo-cadastro');
  if (campoBo) campoBo.style.display = status === 'Extraviado' ? 'block' : 'none';
  const anexoBoletim = document.getElementById('new-anexoBoletim');
  if (status !== 'Extraviado' && anexoBoletim) anexoBoletim.value = '';

  const campoQuebrado = document.getElementById('campo-quebrado-cadastro');
  if (campoQuebrado) campoQuebrado.style.display = status === 'Quebrado' ? 'block' : 'none';
  if (status !== 'Quebrado') {
    const descInput = document.getElementById('new-descricaoQuebrado');
    if (descInput) descInput.value = '';
  }
}

async function salvarCadastro() {
  const btn = document.getElementById('btn-salvar-cadastro');
  if (isButtonLoading(btn)) return;

  const dados = {};
  CAMPOS_CADASTRO.forEach(campo => {
    if (['categoria', 'marca', 'modelo'].includes(campo)) {
      const valor = getValorFinal('new', campo);
      if (valor) dados[campo] = valor;
      return;
    }
    const el = document.getElementById('new-' + campo);
    if (el && el.value) dados[campo] = el.value;
  });

  if (document.getElementById('new-unidade') && !dados.unidade) {
    toastError('Preencha a Unidade.'); return;
  }
  if (!dados.categoria || !dados.marca || !dados.modelo) {
    toastError('Preencha Categoria, Marca e Modelo.'); return;
  }
  if (!dados.status) { toastError('Selecione um status.'); return; }

  const patrimonio = dados.patrimonio || '';

  const serie = dados.numeroSerie || '';
  const justifSerie = dados.justificativaNumeroSerie || '';
  if (!serie && !justifSerie) { toastError('Preencha o Número de Série ou justifique sua ausência.'); return; }

  const status = dados.status;
  const fileInput = document.getElementById('new-anexoBoletim');

  if (status === 'Manutenção') {
    const chamado = document.getElementById('new-numeroChamadoManutencao');
    if (chamado && !chamado.value.trim()) { toastError('Preencha o Nº do chamado de manutenção.'); return; }
  }
  if (status === 'Extraviado') {
    if (!fileInput || fileInput.files.length === 0) { toastError('Para o status "Extraviado", anexe o Boletim de Ocorrência.'); return; }
  }
  if (status === 'Quebrado') {
    const desc = document.getElementById('new-descricaoQuebrado');
    if (desc && !desc.value.trim()) { toastError('Para o status "Quebrado", descreva a avaria.'); return; }
  }

  if (patrimonio) delete dados.justificativaPatrimonio;
  if (serie) delete dados.justificativaNumeroSerie;

  let anexoBase64 = null;
  if (status === 'Extraviado' && fileInput?.files?.length) {
    const file = fileInput.files[0];
    const validation = validateFile(file);
    if (!validation.valid) { toastError(validation.error); return; }
    try { anexoBase64 = await fileToBase64(file); }
    catch { toastError('Erro ao ler o arquivo.'); return; }
  }

  if (anexoBase64) {
    dados._anexoBoletim = { base64: anexoBase64, mimeType: fileInput.files[0].type, fileName: fileInput.files[0].name };
  }

  setButtonLoading(document.getElementById('btn-salvar-cadastro'), true);
  try {
    await createEquipamento(getToken(), dados);
    toastSuccess('Equipamento cadastrado.');
    closeModal('modal-cadastrar-equipamento');
    await carregarEquipamentos();
  } catch (err) {
    toastError('Erro ao cadastrar: ' + err.message);
  } finally {
    setButtonLoading(document.getElementById('btn-salvar-cadastro'), false);
  }
}

/* ============================================================================
   EDIÇÃO DE EQUIPAMENTO
   ============================================================================ */

export async function editarEquipamento(id) {
  const item = equipamentosCache.find(e => e.id === id);
  if (!item) { toastError('Item não encontrado.'); return; }

  itemEmEdicaoOriginal = item;
  document.getElementById('edit-id').value = item.id;

  CAMPOS_EDITAVEIS.forEach(campo => {
    const el = document.getElementById('edit-' + campo);
    if (el) el.value = item[campo] || (campo === 'vinculadoBlueMonitor' ? 'Não' : '');
  });

  ['categoria', 'marca', 'modelo'].forEach(tipo => {
    const input = document.getElementById('edit-outro-' + tipo);
    if (input) input.value = '';
    const container = document.getElementById('edit-outro-' + tipo + '-container');
    if (container) container.style.display = 'none';
  });

  configurarJustificativas('edit');
  if (!item.patrimonio) document.getElementById('campo-justificativa-patrimonio-edit').style.display = 'block';
  if (!item.numeroSerie) document.getElementById('campo-justificativa-serie-edit').style.display = 'block';

  const anexoExistente = document.getElementById('anexo-bo-existente');
  if (anexoExistente) {
    if (item.boletimOcorrenciaAnexoUrl) {
      anexoExistente.innerHTML = '<a href="#" onclick="abrirAnexoBoletim(\'' + String(item.boletimOcorrenciaAnexoUrl).replace(/"/g, '') + '\'); return false;">📎 Baixar B.O. anexo</a>';
    } else {
      anexoExistente.innerHTML = '';
    }
  }

  const cache = getListasCache();
  if (cache) {
    const selectCat = document.getElementById('edit-categoria');
    selectCat.innerHTML = '<option value="" disabled selected>Selecione</option>' +
      cache.categorias.map(c => `<option value="${c}">${c}</option>`).join('') +
      '<option value="__outro__">Outro (digitar)</option>';
    if (item.categoria && cache.categorias.includes(item.categoria)) selectCat.value = item.categoria;
    else if (item.categoria) { selectCat.value = '__outro__'; document.getElementById('edit-outro-categoria').value = item.categoria; document.getElementById('edit-outro-categoria-container').style.display = 'block'; }
    if (window.M && M.FormSelect) M.FormSelect.init(selectCat);

    if (selectCat.value && selectCat.value !== '__outro__') {
      await popularMarcas('edit', selectCat.value);
      const selectMarca = document.getElementById('edit-marca');
      if (selectMarca) {
        const marcasSet = cache.marcasPorCategoria[selectCat.value] || new Set();
        if (item.marca && marcasSet.has(item.marca)) selectMarca.value = item.marca;
        else if (item.marca) { selectMarca.value = '__outro__'; document.getElementById('edit-outro-marca').value = item.marca; document.getElementById('edit-outro-marca-container').style.display = 'block'; }
        if (window.M && M.FormSelect) M.FormSelect.init(selectMarca);

        if (selectMarca.value && selectMarca.value !== '__outro__') {
          await popularModelos('edit', selectCat.value, selectMarca.value);
          const selectModelo = document.getElementById('edit-modelo');
          if (selectModelo) {
            const modelosSet = cache.modelosPorCategoriaMarca[selectCat.value]?.[selectMarca.value] || new Set();
            if (item.modelo && modelosSet.has(item.modelo)) selectModelo.value = item.modelo;
            else if (item.modelo) { selectModelo.value = '__outro__'; document.getElementById('edit-outro-modelo').value = item.modelo; document.getElementById('edit-outro-modelo-container').style.display = 'block'; }
            if (window.M && M.FormSelect) M.FormSelect.init(selectModelo);
          }
        } else if (selectMarca.value === '__outro__') {
          // Marca digitada manualmente: modelo também é "Outro (digitar)"
          habilitarOutroModelo('edit');
          const outroModeloInput = document.getElementById('edit-outro-modelo');
          if (outroModeloInput && item.modelo) outroModeloInput.value = item.modelo;
        } else {
          limparMarcaModelo('edit');
        }
      }
    } else {
      carregarListas();
      setTimeout(() => editarEquipamento(id), 500);
      return;
    }
  }

  atualizarCamposCondicionais();
  if (window.M) { initSelects('#modal-editar-equipamento select'); updateTextFields(); }

  if (!modalEdicaoInstance && window.M && M.Modal) {
    modalEdicaoInstance = M.Modal.init(document.getElementById('modal-editar-equipamento'));
  }
  modalEdicaoInstance?.open();

  // Notificação/tutorial sobre o novo campo "Número da etiqueta" (exibido uma única vez).
  try {
    const chave = 'sce_tour_numero_etiqueta_edit_v2';
    const campoEtiqueta = document.getElementById('edit-numeroEtiqueta');
    if (!campoEtiqueta) return;
    if (!localStorage.getItem(chave)) {
      localStorage.setItem(chave, '1');
      setTimeout(() => {
        try { toastInfo('Novidade: agora você pode informar o "Número da etiqueta" na edição de equipamentos.'); } catch (e) {}
        iniciarTutorialNumeroEtiqueta();
      }, 500);
    }
  } catch (e) {}
}

function iniciarTutorialNumeroEtiqueta() {
  const campo = document.getElementById('edit-numeroEtiqueta');
  if (!campo) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'tour-backdrop';
  document.body.appendChild(backdrop);
  campo.classList.add('tour-highlight');
  try { campo.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
  const tooltip = document.createElement('div');
  tooltip.className = 'tour-tooltip';
  tooltip.innerHTML = '<strong>Novo campo disponível</strong>' +
    '<p>Agora você pode informar o <b>Número da etiqueta</b> (identificação interna da escola) ' +
    'diretamente na edição do equipamento. Basta preencher e salvar.</p>' +
    '<button type="button" id="tour-numero-etiqueta-ok">Entendi</button>';
  document.body.appendChild(tooltip);
  const posicionar = () => {
    const r = campo.getBoundingClientRect();
    let top = r.bottom + 10;
    let left = r.left;
    if (top + 160 > window.innerHeight) top = Math.max(8, r.top - 170);
    if (left + 330 > window.innerWidth) left = Math.max(8, window.innerWidth - 340);
    if (left < 8) left = 8;
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  };
  posicionar();
  window.addEventListener('resize', posicionar);
  const fechar = () => {
    campo.classList.remove('tour-highlight');
    window.removeEventListener('resize', posicionar);
    if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  };
  tooltip.querySelector('#tour-numero-etiqueta-ok').addEventListener('click', fechar);
  backdrop.addEventListener('click', fechar);
}

function atualizarCamposCondicionais() {
  const status = document.getElementById('edit-status')?.value;
  const setDisplay = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? 'block' : 'none'; };
  setDisplay('campo-chamado', status === 'Manutenção');
  setDisplay('campo-bo', status === 'Extraviado');
  setDisplay('campo-justificativa', status === 'Em verificação');
  setDisplay('campo-quebrado', status === 'Quebrado');
  const fileInput = document.getElementById('edit-anexoBoletim');
  if (fileInput && status !== 'Extraviado') fileInput.value = '';
  if (status !== 'Quebrado') {
    const el = document.getElementById('edit-descricaoQuebrado');
    if (el) el.value = '';
  }
}

async function salvarEdicao() {
  const btn = document.getElementById('btn-salvar-edicao');
  if (isButtonLoading(btn)) return;

  const id = document.getElementById('edit-id').value;
  const status = document.getElementById('edit-status')?.value;
  const camposAlterados = {};

  const patrimonio = document.getElementById('edit-patrimonio').value.trim();
  // Patrimônio é opcional — sem exigência de valor ou justificativa.

  const serie = document.getElementById('edit-numeroSerie').value.trim();
  const justifSerie = document.getElementById('edit-justificativaNumeroSerie').value.trim();
  if (!serie && !justifSerie) { toastError('Preencha o Número de Série ou justifique sua ausência.'); return; }

  CAMPOS_EDITAVEIS.forEach(campo => {
    if (['categoria', 'marca', 'modelo'].includes(campo)) {
      const valor = getValorFinal('edit', campo);
      const valorAntigo = itemEmEdicaoOriginal?.[campo] || '';
      if (String(valor) !== String(valorAntigo)) camposAlterados[campo] = valor;
      return;
    }
    const el = document.getElementById('edit-' + campo);
    if (!el) return;
    const valorNovo = el.value;
    const valorAntigo = itemEmEdicaoOriginal?.[campo] || '';
    if (String(valorNovo) !== String(valorAntigo)) camposAlterados[campo] = valorNovo;
  });

  const catFinal = camposAlterados.categoria ?? itemEmEdicaoOriginal?.categoria;
  const marcaFinal = camposAlterados.marca ?? itemEmEdicaoOriginal?.marca;
  const modeloFinal = camposAlterados.modelo ?? itemEmEdicaoOriginal?.modelo;
  if (!catFinal || !marcaFinal || !modeloFinal) { toastError('Preencha Categoria, Marca e Modelo.'); return; }

  if (patrimonio) delete camposAlterados.justificativaPatrimonio;
  if (serie) delete camposAlterados.justificativaNumeroSerie;

  const regrasStatus = { 'Manutenção': 'numeroChamadoManutencao', 'Extraviado': 'boletimOcorrencia', 'Em verificação': 'justificativaVerificacao', 'Quebrado': 'descricaoQuebrado' };
  const campoObrig = regrasStatus[status];
  if (campoObrig) {
    const valorFinal = camposAlterados[campoObrig] ?? itemEmEdicaoOriginal?.[campoObrig];
    if (!valorFinal) { toastError(`Preencha o campo obrigatório para o status "${status}".`); return; }
  }

  const fileInput = document.getElementById('edit-anexoBoletim');
  const jaTemAnexo = itemEmEdicaoOriginal?.boletimOcorrenciaAnexoUrl;
  if (status === 'Extraviado' && (!fileInput || fileInput.files.length === 0) && !jaTemAnexo) { toastError('Anexe o Boletim de Ocorrência antes de salvar.'); return; }

  if (Object.keys(camposAlterados).length === 0 && !(fileInput?.files?.length)) { toastError('Nada foi alterado.'); closeModal('modal-editar-equipamento'); return; }

  let anexoBase64 = null;
  if (status === 'Extraviado' && fileInput?.files?.length) {
    const file = fileInput.files[0];
    const validation = validateFile(file);
    if (!validation.valid) { toastError(validation.error); return; }
    try { anexoBase64 = await fileToBase64(file); }
    catch { toastError('Erro ao ler o arquivo.'); return; }
  }
  if (anexoBase64) camposAlterados._anexoBoletim = { base64: anexoBase64, mimeType: fileInput.files[0].type, fileName: fileInput.files[0].name };

  setButtonLoading(document.getElementById('btn-salvar-edicao'), true);
  try {
    await updateEquipamento(getToken(), id, camposAlterados);
    toastSuccess('Equipamento atualizado.');
    closeModal('modal-editar-equipamento');
    await carregarEquipamentos();
  } catch (err) {
    toastError('Erro ao salvar: ' + err.message);
  } finally {
    setButtonLoading(document.getElementById('btn-salvar-edicao'), false);
  }
}

/* ============================================================================
   MANUTENÇÃO
   ============================================================================ */

export async function abrirManutencao(id) {
  equipamentoIdManutencaoAtual = id;
  document.getElementById('manut-equipamento-id').value = id;
  document.getElementById('manut-descricao').value = '';
  if (window.M && M.FormSelect) M.FormSelect.init(document.getElementById('manut-status'));
  updateTextFields();
  await carregarLogManutencao(id);

  if (!modalManutencaoInstance && window.M && M.Modal) {
    modalManutencaoInstance = M.Modal.init(document.getElementById('modal-manutencao'));
  }
  modalManutencaoInstance?.open();
}

async function carregarLogManutencao(id) {
  const tbody = document.getElementById('tabela-manutencao-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Carregando...</td></tr>';

  try {
    const registros = await getRegistrosManutencao(getToken(), id);
    tbody.innerHTML = '';
    if (!registros?.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--sce-muted);">Nenhum registro ainda.</td></tr>'; return; }
    registros.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${formatDate(r.data)}</td><td>${r.autor || ''}</td><td>${r.status || ''}</td><td>${r.descricao || ''}</td>`;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:#d32f2f;">Erro: ${err.message}</td></tr>`;
  }
}

export async function registrarManutencaoUI() {
  const btn = document.getElementById('btn-registrar-manutencao');
  if (isButtonLoading(btn)) return;

  const descricao = document.getElementById('manut-descricao')?.value?.trim();
  const status = document.getElementById('manut-status')?.value;
  if (!descricao) { toastError('Descreva o que foi feito.'); return; }

  setButtonLoading(btn, true);
  try {
    await registrarManutencao(getToken(), equipamentoIdManutencaoAtual, descricao, status);
    btn.disabled = false; btn.classList.remove('disabled');
    document.getElementById('manut-descricao').value = '';
    toastSuccess('Manutenção registrada.');
    await carregarLogManutencao(equipamentoIdManutencaoAtual);
    await carregarEquipamentos();
  } catch (err) {
    toastError('Erro: ' + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

/* ============================================================================
   HISTÓRICO
   ============================================================================ */

export async function abrirHistorico(equipamentoId) {
  const item = equipamentosCache.find(e => e.id === equipamentoId);
  if (!item) { toastError('Equipamento não encontrado.'); return; }

  document.getElementById('historico-patrimonio').innerText = item.patrimonio || 'Sem patrimônio';
  document.getElementById('historico-modelo').innerText = item.modelo || 'Sem modelo';

  const tbody = document.querySelector('#tabela-historico tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Carregando...</td></tr>';

  if (!modalHistoricoInstance && window.M && M.Modal) {
    modalHistoricoInstance = M.Modal.init(document.getElementById('modal-historico'));
  }
  modalHistoricoInstance?.open();

  try {
    const registros = await getHistoricoEquipamento(getToken(), equipamentoId);
    tbody.innerHTML = '';

    // Linha de criação (cadastro do equipamento)
    const trCriacao = document.createElement('tr');
    trCriacao.innerHTML =
      `<td>${formatDate(item.dataCadastro)}</td>` +
      `<td>${item.cadastradoPor || ''}</td>` +
      `<td><strong>Criação</strong></td>` +
      `<td>-</td>` +
      `<td>Equipamento cadastrado</td>`;
    tbody.appendChild(trCriacao);

    const mudancas = (registros || []).filter(r => String(r.campo || '').toLowerCase() !== 'criação');
    if (!mudancas.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5" style="text-align:center;color:var(--sce-muted);">Nenhuma alteração adicional registrada.</td></tr>';
      tbody.appendChild(tr);
      return;
    }
    mudancas.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${formatDate(r.data)}</td><td>${r.autor || ''}</td><td><strong>${r.campo || ''}</strong></td><td>${r.valor_antigo || '-'}</td><td>${r.valor_novo || '-'}</td>`;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:#d32f2f;">Erro: ${err.message}</td></tr>`;
  }
}

/* ============================================================================
   REMOÇÃO
   ============================================================================ */

let idPendenteRemocao = null;

export function abrirModalRemocao(id) {
  idPendenteRemocao = id;
  if (!modalRemocaoInstance && window.M && M.Modal) {
    modalRemocaoInstance = M.Modal.init(document.getElementById('modal-confirmar-remocao'));
  }
  modalRemocaoInstance?.open();
}

export async function confirmarRemocao() {
  if (!idPendenteRemocao) return;
  const btn = document.getElementById('btn-confirmar-remocao');
  if (isButtonLoading(btn)) return;

  setButtonLoading(btn, true);
  try {
    await removerEquipamento(getToken(), idPendenteRemocao);
    toastSuccess('Equipamento removido.');
    closeModal('modal-confirmar-remocao');
    idPendenteRemocao = null;
    await carregarEquipamentos();
  } catch (err) {
    toastError('Erro ao remover: ' + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

/* ============================================================================
   EXPORTAÇÃO
   ============================================================================ */

export async function exportarCSVUI() {
  const btn = document.getElementById('btn-exportar-csv');
  if (isButtonLoading(btn)) return;

  setButtonLoading(btn, true);
  try {
    const res = await exportarCSV(getToken());
    if (res.csv) downloadCsv(res.csv, res.fileName || `sce-equipamentos-${Date.now()}.csv`);
    else toastError('Erro ao exportar: ' + (res.error || 'Erro desconhecido'));
  } catch (err) {
    toastError('Erro ao exportar: ' + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

export async function exportarPDFUI() {
  const btn = document.getElementById('btn-exportar-pdf');
  if (isButtonLoading(btn)) return;

  setButtonLoading(btn, true);
  try {
    const blob = await exportarEquipamentosPDF(getToken(), {});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sce-equipamentos-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toastSuccess('PDF gerado.');
  } catch (err) {
    toastError('Erro ao exportar PDF: ' + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

/* ============================================================================
   POPUP DE NOVIDADE - NUMERO DA ETIQUETA
   ============================================================================ */

function mostrarPopupNovidadeEtiqueta() {
  try {
    const chave = 'sce_popup_numero_etiqueta_site_v3';
    if (localStorage.getItem(chave)) return;

    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;inset:0;background:radial-gradient(circle at 50% 30%,rgba(25,118,210,.18),rgba(10,20,40,.62));z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;';

    const card = document.createElement('div');
    card.style.cssText = 'position:relative;max-width:470px;width:100%;padding:28px 28px 24px;border-radius:14px;background:#fff;color:#1e293b;border:1px solid #dbeafe;border-left:5px solid #1976d2;box-shadow:0 24px 70px rgba(15,23,42,.26);';
    card.innerHTML =
      '<button type="button" id="popup-etiqueta-fechar-x" aria-label="Fechar" style="position:absolute;top:10px;right:14px;background:transparent;border:none;font-size:1.9rem;line-height:1;cursor:pointer;color:#1976d2;font-weight:900;">✕</button>' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">' +
        '<img src="https://lh3.googleusercontent.com/u/0/d/1R-7mJ0Eb6Kxfi_NucEOZ9AzW4xz0PnaP" alt="Logotipo URE Leste 3" style="width:46px;height:auto;flex:0 0 46px;">' +
        '<div>' +
          '<div style="font-size:.75rem;color:#64748b;margin-bottom:2px;">Sistema de Controle de Equipamentos</div>' +
          '<h5 style="margin:0;color:#0f172a;font-size:1.25rem;font-weight:800;">Novidade disponível</h5>' +
        '</div>' +
      '</div>' +
      '<p style="margin:0 0 14px 0;line-height:1.6;font-size:.95rem;">Campo “<strong style="color:#1976d2;">Número da etiqueta</strong>” disponível na edição de equipamentos. Clique em Editar (ícone do lápis) em um equipamento ou <a href="#" id="popup-etiqueta-agora" style="color:#1976d2;font-weight:700;text-decoration:underline;text-underline-offset:2px;">clique aqui para conhecer o novo campo agora</a>.</p>' +
      '<div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;padding:12px 14px;margin-bottom:2px;">' +
        '<p style="margin:0 0 10px 0;font-size:.88rem;color:#334155;">Sua escola ainda não colocou etiquetas? Abra o gerador de etiquetas da sua escola e imprima as identificações.</p>' +
        '<a href="https://script.google.com/macros/s/AKfycbwh3hRIK8Qpv_GIbAAUpCXNOEgDZturRcM1CtiFUBBK383gnfKQcv7f3uzOpK9nqLBUTA/exec" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;background:#1976d2;color:#fff;text-decoration:none;border-radius:7px;padding:8px 14px;font-weight:700;font-size:.88rem;">🏷️ Gerar etiquetas da escola</a>' +
      '</div>';

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    const fechar = () => {
      try { localStorage.setItem(chave, '1'); } catch (e) {}
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    };

    card.querySelector('#popup-etiqueta-fechar-x').addEventListener('click', fechar);

    const irAgora = (ev) => {
      ev.preventDefault();
      fechar();
      const primeiro = Array.isArray(equipamentosCache) ? equipamentosCache[0] : null;
      if (primeiro && (primeiro.id || primeiro._id)) {
        const id = primeiro.id || primeiro._id;
        setTimeout(() => {
          try { editarEquipamento(id); } catch (e) {}
          setTimeout(() => { try { iniciarTutorialNumeroEtiqueta(); } catch (e) {} }, 700);
        }, 250);
      } else {
        try { toastInfo('Abra um equipamento e clique em Editar (ícone do lápis) para conhecer o novo campo.'); } catch (e) {}
      }
    };
    card.querySelector('#popup-etiqueta-agora').addEventListener('click', irAgora);
  } catch (e) {}
}

/* ============================================================================
   EXPORTS (apenas funções e constantes, sem estado)
   ============================================================================ */

export {
  showLoading,
  hideLoading,
  toastSuccess,
  toastError,
  toastInfo,
  setButtonLoading,
  isButtonLoading,
  downloadCsv,
  openModal,
  closeModal,
  initModals,
  initSelects,
  updateTextFields,
  fileToBase64,
  validateFile,
  formatDate,
  formatDateShort,
  getFormData,
  clearForm,
  getToken,
  getAuthHeaders,
  initAuthFromUrl,
  logout,
  getScriptUrlBase,
  getApiBaseUrl,
  salvarCadastro,
  salvarEdicao,
  atualizarKpis,
};