// ============================================================================
// DASHBOARD BASE — Funcionalidades comuns a todos os dashboards
// ============================================================================

import { getEquipamentosDaFilial, getEquipamentosGlobal, createEquipamento, updateEquipamento, cloneEquipamento, removerEquipamento, atualizarStatusManutencao, registrarManutencao, getRegistrosManutencao, getHistoricoEquipamento, getEspecificacoesModelo, listarUsuarios, adicionarUsuario, atualizarUsuario, removerUsuario, getFiliaisParaEmprestimo, registrarEmprestimo, registrarDevolucao, exportarCSV, exportarEquipamentosPDF, getNomeUsuario, getApiBaseUrl } from '../shared/js/api.js';
import { showLoading, hideLoading, toastSuccess, toastError, toastInfo, setButtonLoading, isButtonLoading, downloadCsv, openModal, closeModal, initModals, initSelects, updateTextFields, fileToBase64, validateFile } from '../shared/js/ui.js';
import { preencherSelectCategoria, popularMarcas, popularModelos, limparMarcaModelo, limparModelo, toggleOutro, getValorFinal, setupSelectCascata, getCategorias, getMarcas, getModelos, setListasCache } from '../shared/js/lists.js';
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
  'responsavelAtual', 'observacoes', 'justificativaPatrimonio', 'justificativaNumeroSerie'
];

export const CAMPOS_CADASTRO = [
  'unidade', 'categoria', 'marca', 'modelo', 'patrimonio', 'numeroSerie', 'status',
  'vinculadoBlueMonitor', 'sistemaOperacional', 'processador', 'memoriaRAM',
  'armazenamento', 'tamanhoTela', 'responsavelAtual', 'observacoes',
  'justificativaPatrimonio', 'justificativaNumeroSerie', 'descricaoQuebrado'
];

// Cada página deve declarar seu próprio estado (não exportamos estado compartilhado)

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

  console.log(`✅ Dashboard ${perfil} inicializado`);
}

/* ============================================================================
   AUTENTICAÇÃO / NOME USUÁRIO
   ============================================================================ */

async function carregarNomeUsuario() {
  try {
    const nome = await getNomeUsuario(getToken());
    const el = document.getElementById('nome-usuario') || document.getElementById('nome-tecnico');
    if (el) el.innerText = nome || 'Usuário';
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
  const campoPat = document.getElementById(`${prefixo}-patrimonio`);
  const campoSerie = document.getElementById(`${prefixo}-numeroSerie`);
  const justPatContainer = document.getElementById(`campo-justificativa-patrimonio${prefixo === 'edit' ? '-edit' : ''}`);
  const justSerieContainer = document.getElementById(`campo-justificativa-serie${prefixo === 'edit' ? '-edit' : ''}`);
  const justPatInput = document.getElementById(`${prefixo}-justificativaPatrimonio`);
  const justSerieInput = document.getElementById(`${prefixo}-justificativaNumeroSerie`);

  if (!campoPat || !campoSerie || !justPatContainer || !justSerieContainer) return;

  function verificarPatrimonio() {
    const vazio = campoPat.value.trim() === '';
    justPatContainer.style.display = vazio ? 'block' : 'none';
    if (justPatInput) { justPatInput.required = vazio; if (!vazio) justPatInput.value = ''; }
  }

  function verificarSerie() {
    const vazio = campoSerie.value.trim() === '';
    justSerieContainer.style.display = vazio ? 'block' : 'none';
    if (justSerieInput) { justSerieInput.required = vazio; if (!vazio) justSerieInput.value = ''; }
  }

  campoPat.addEventListener('input', verificarPatrimonio);
  campoSerie.addEventListener('input', verificarSerie);
  verificarPatrimonio();
  verificarSerie();
}

/* ============================================================================
   CARREGAMENTO DE EQUIPAMENTOS (abstrato - implementar no dashboard específico)
   ============================================================================ */

export async function carregarEquipamentos() {
  // Deve ser implementado no dashboard específico
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
  const inserviveis = porStatus['Inservível'] || 0;
  const extraviado = porStatus['Extraviado'] || 0;
  const emVerificacao = porStatus['Em verificação'] || 0;

  const kpisEl = document.getElementById('kpis');
  if (kpisEl) {
    kpisEl.innerHTML =
      kpiCard_('devices', total, 'Total', 'kpi-total') +
      kpiCard_('check_circle', disponiveis, 'Disponíveis', 'kpi-disponiveis') +
      kpiCard_('build', manutencao, 'Manutenção', 'kpi-manutencao') +
      kpiCard_('report', quebrados, 'Quebrados', 'kpi-quebrados') +
      kpiCard_('close', inserviveis, 'Inservíveis', 'kpi-inserviveis') +
      kpiCard_('assignment_late', extraviado, 'Extraviado', 'kpi-extraviado') +
      kpiCard_('search', emVerificacao, 'Em verificação', 'kpi-emVerificacao');
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
  document.getElementById('campo-justificativa-patrimonio').style.display = 'none';
  document.getElementById('campo-justificativa-serie').style.display = 'none';
  configurarJustificativas('new');

  if (listasCache) preencherSelectCategoria('new');
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
  if (status !== 'Extraviado') document.getElementById('new-anexoBoletim').value = '';

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

  if (!dados.unidade || !dados.categoria || !dados.marca || !dados.modelo) {
    toastError('Preencha Unidade, Categoria, Marca e Modelo.'); return;
  }
  if (!dados.status) { toastError('Selecione um status.'); return; }

  const patrimonio = dados.patrimonio || '';
  const justifPat = dados.justificativaPatrimonio || '';
  if (!patrimonio && !justifPat) { toastError('Preencha o Patrimônio ou justifique sua ausência.'); return; }

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
  if (anexoExistente) anexoExistente.innerText = item.boletimOcorrenciaAnexoUrl ? '📎 Anexo atual: ' + item.boletimOcorrenciaAnexoUrl : '';

  if (listasCache) {
    const selectCat = document.getElementById('edit-categoria');
    selectCat.innerHTML = '<option value="" disabled selected>Selecione</option>' +
      listasCache.categorias.map(c => `<option value="${c}">${c}</option>`).join('') +
      '<option value="__outro__">Outro (digitar)</option>';
    if (item.categoria && listasCache.categorias.includes(item.categoria)) selectCat.value = item.categoria;
    else if (item.categoria) { selectCat.value = '__outro__'; document.getElementById('edit-outro-categoria').value = item.categoria; document.getElementById('edit-outro-categoria-container').style.display = 'block'; }
    if (window.M && M.FormSelect) M.FormSelect.init(selectCat);

    if (selectCat.value && selectCat.value !== '__outro__') {
      await popularMarcas('edit', selectCat.value);
      const selectMarca = document.getElementById('edit-marca');
      if (selectMarca) {
        const marcasSet = listasCache.marcasPorCategoria[selectCat.value] || new Set();
        if (item.marca && marcasSet.has(item.marca)) selectMarca.value = item.marca;
        else if (item.marca) { selectMarca.value = '__outro__'; document.getElementById('edit-outro-marca').value = item.marca; document.getElementById('edit-outro-marca-container').style.display = 'block'; }
        if (window.M && M.FormSelect) M.FormSelect.init(selectMarca);

        if (selectMarca.value && selectMarca.value !== '__outro__') {
          await popularModelos('edit', selectCat.value, selectMarca.value);
          const selectModelo = document.getElementById('edit-modelo');
          if (selectModelo) {
            const modelosSet = listasCache.modelosPorCategoriaMarca[selectCat.value]?.[selectMarca.value] || new Set();
            if (item.modelo && modelosSet.has(item.modelo)) selectModelo.value = item.modelo;
            else if (item.modelo) { selectModelo.value = '__outro__'; document.getElementById('edit-outro-modelo').value = item.modelo; document.getElementById('edit-outro-modelo-container').style.display = 'block'; }
            if (window.M && M.FormSelect) M.FormSelect.init(selectModelo);
          }
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
}

function atualizarCamposCondicionais() {
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
}

async function salvarEdicao() {
  const btn = document.getElementById('btn-salvar-edicao');
  if (isButtonLoading(btn)) return;

  const id = document.getElementById('edit-id').value;
  const status = document.getElementById('edit-status')?.value;
  const camposAlterados = {};

  const patrimonio = document.getElementById('edit-patrimonio').value.trim();
  const justifPat = document.getElementById('edit-justificativaPatrimonio').value.trim();
  if (!patrimonio && !justifPat) { toastError('Preencha o Patrimônio ou justifique sua ausência.'); return; }

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
    if (!registros?.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--sce-muted);">Nenhuma alteração registrada.</td></tr>'; return; }
    registros.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${formatDate(r.data)}</td><td>${r.autor || ''}</td><td><strong>${r.campo || ''}</strong></td><td>${r.valorAntigo || '-'}</td><td>${r.valorNovo || '-'}</td>`;
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
let modalRemocaoInstance = null;

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
    const res = await exportarEquipamentosPDF(getToken(), {});
    if (res.url) window.open(res.url, '_blank');
    toastSuccess('PDF gerado.');
  } catch (err) {
    toastError('Erro ao exportar PDF: ' + err.message);
  } finally {
    setButtonLoading(btn, false);
  }
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
};