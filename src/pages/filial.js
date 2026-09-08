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
} from './dashboard-base.js';

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
let itemEmEdicaoOriginal = null;

let emprestimoIdsSelecionados = [];

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🟢 Inicializando Dashboard Filial...');
  
  if (window.M) M.FormSelect.init(document.querySelectorAll('select'));
  
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
// CARREGAMENTO DE EQUIPAMENTOS (FILIAL - APENAS SUA UNIDADE)
// ============================================================================

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

// emprestimoIdsSelecionados já declarado no topo

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
      fetch(`${getApiBaseUrl()}/filiais-para-emprestimo?token=` + encodeURIComponent(getToken()), { headers: getAuthHeaders() })
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
    const token = getToken();
    const res = await fetch(`${getApiBaseUrl()}/registrar-emprestimo?token=` + encodeURIComponent(token), {
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
    const token = getToken();
    const res = await fetch(`${getApiBaseUrl()}/registrar-devolucao?token=` + encodeURIComponent(token), {
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
    const token = getToken();
    const res = await fetch(`${getApiBaseUrl()}/listar-usuarios?token=` + encodeURIComponent(token), { headers: getAuthHeaders() });
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
      '<td>' + (isSelf ? '' : '<button class="btn-acao" onclick="editarUsuarioUI(\'' + u.email + '\')" title="Editar"><i class="material-icons">edit</i></button> <button class="btn-acao danger" onclick="removerUsuarioUI(\'' + u.email + '\')" title="Remover"><i class="material-icons">delete</i></button>') +
      '</td>';
    tbody.appendChild(tr);
  });
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
  if (!filial) { toastError('Filial é obrigatória.'); return; }
  
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
    const res = await fetch(`${getApiBaseUrl()}/remover-usuario?token=` + encodeURIComponent(getToken()), {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    toastSuccess('Usuário removido.');
    await carregarUsuariosUI();
  } catch (err) { toastError('Erro ao remover: ' + err.message); }
  finally { hideLoading(); }
}

// Expor para onclick
window.selecionarTipoEmprestimo = selecionarTipoEmprestimo;
window.editarUsuarioUI = editarUsuarioUI;
window.removerUsuarioUI = removerUsuarioUI;

console.log('✅ Dashboard Filial loaded');