const API_BASE_URL = (typeof process !== 'undefined' && process.env?.API_BASE_URL)
  ? process.env.API_BASE_URL
  : (window.ENV?.API_BASE_URL || 'http://localhost:3001/api');

function getAuthHeaders(token) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function handleResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Erro HTTP: ${response.status}`);
  }
  if (data.success === false) {
    throw new Error(data.error || 'Erro na requisição');
  }
  return data.data;
}

function getToken() {
  return window.SCE_TOKEN || localStorage.getItem('sce_token') || '';
}

async function requestOtp(email) {
  try {
    const response = await fetch(`${API_BASE_URL}/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em requestOtp:', error);
    throw error;
  }
}

async function validateOtp(email, code) {
  try {
    const response = await fetch(`${API_BASE_URL}/validate-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em validateOtp:', error);
    throw error;
  }
}

async function getNomeUsuario(token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/get-nome-usuario?token=${encodeURIComponent(t)}`, {
      method: 'GET',
      headers: getAuthHeaders(t),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getNomeUsuario:', error);
    throw error;
  }
}

async function getListasCadastro(token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/listas-cadastro?token=${encodeURIComponent(t)}`, {
      method: 'GET',
      headers: getAuthHeaders(t),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getListasCadastro:', error);
    throw error;
  }
}

async function getEquipamentosDaFilial(token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/equipamentos-da-filial?token=${encodeURIComponent(t)}`, {
      method: 'GET',
      headers: getAuthHeaders(t),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getEquipamentosDaFilial:', error);
    throw error;
  }
}

async function getEquipamentosGlobal(token, incluirRemovidos = false) {
  try {
    const t = token || getToken();
    const params = new URLSearchParams({ token: t });
    if (incluirRemovidos) params.append('incluirRemovidos', 'true');
    const response = await fetch(`${API_BASE_URL}/equipamentos-global?${params}`, {
      method: 'GET',
      headers: getAuthHeaders(t),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getEquipamentosGlobal:', error);
    throw error;
  }
}

async function createEquipamento(token, dadosEquipamento) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/create-equipamento?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: getAuthHeaders(t),
      body: JSON.stringify(dadosEquipamento),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em createEquipamento:', error);
    throw error;
  }
}

async function updateEquipamento(token, id, camposAlterados) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/update-equipamento?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: getAuthHeaders(t),
      body: JSON.stringify({ id, ...camposAlterados }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em updateEquipamento:', error);
    throw error;
  }
}

async function cloneEquipamento(token, idOrigem) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/clone-equipamento?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: getAuthHeaders(t),
      body: JSON.stringify({ idOrigem }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em cloneEquipamento:', error);
    throw error;
  }
}

async function removerEquipamento(token, id) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/remover-equipamento?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: getAuthHeaders(t),
      body: JSON.stringify({ id }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em removerEquipamento:', error);
    throw error;
  }
}

async function atualizarStatusManutencao(token, equipamentoId, novoStatus) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/atualizar-status-manutencao?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: getAuthHeaders(t),
      body: JSON.stringify({ equipamentoId, novoStatus }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em atualizarStatusManutencao:', error);
    throw error;
  }
}

async function registrarManutencao(token, equipamentoId, descricao, status) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/registrar-manutencao?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: getAuthHeaders(t),
      body: JSON.stringify({ equipamentoId, descricao, status }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em registrarManutencao:', error);
    throw error;
  }
}

async function getRegistrosManutencao(token, equipamentoId) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/registros-manutencao?token=${encodeURIComponent(t)}&equipamentoId=${encodeURIComponent(equipamentoId)}`, {
      method: 'GET',
      headers: getAuthHeaders(t),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getRegistrosManutencao:', error);
    throw error;
  }
}

async function getHistoricoEquipamento(token, equipamentoId) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/historico-equipamento?token=${encodeURIComponent(t)}&equipamentoId=${encodeURIComponent(equipamentoId)}`, {
      method: 'GET',
      headers: getAuthHeaders(t),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getHistoricoEquipamento:', error);
    throw error;
  }
}

async function getEspecificacoesModelo(modelo, token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/especificacoes-modelo?token=${encodeURIComponent(t)}&modelo=${encodeURIComponent(modelo)}`, {
      method: 'GET',
      headers: getAuthHeaders(t),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getEspecificacoesModelo:', error);
    throw error;
  }
}

async function listarUsuarios(token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/listar-usuarios?token=${encodeURIComponent(t)}`, {
      method: 'GET',
      headers: getAuthHeaders(t),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em listarUsuarios:', error);
    throw error;
  }
}

async function adicionarUsuario(token, usuario) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/adicionar-usuario?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: getAuthHeaders(t),
      body: JSON.stringify(usuario),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em adicionarUsuario:', error);
    throw error;
  }
}

async function atualizarUsuario(token, emailOriginal, dados) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/atualizar-usuario?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: getAuthHeaders(t),
      body: JSON.stringify({ emailOriginal, ...dados }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em atualizarUsuario:', error);
    throw error;
  }
}

async function removerUsuario(token, email) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/remover-usuario?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: getAuthHeaders(t),
      body: JSON.stringify({ email }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em removerUsuario:', error);
    throw error;
  }
}

async function getFiliaisParaEmprestimo(token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/filiais-para-emprestimo?token=${encodeURIComponent(t)}`, {
      method: 'GET',
      headers: getAuthHeaders(t),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getFiliaisParaEmprestimo:', error);
    throw error;
  }
}

async function registrarEmprestimo(token, ids, dados) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/registrar-emprestimo?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: getAuthHeaders(t),
      body: JSON.stringify({ ids, ...dados }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em registrarEmprestimo:', error);
    throw error;
  }
}

async function registrarDevolucao(token, ids, observacao) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/registrar-devolucao?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: getAuthHeaders(t),
      body: JSON.stringify({ ids, observacao }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em registrarDevolucao:', error);
    throw error;
  }
}

async function exportarCSV(token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/exportar-csv?token=${encodeURIComponent(t)}`, {
      method: 'GET',
      headers: getAuthHeaders(t),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em exportarCSV:', error);
    throw error;
  }
}

async function exportarEquipamentosPDF(token, filtros = {}) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/exportar-pdf?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: getAuthHeaders(t),
      body: JSON.stringify(filtros),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em exportarEquipamentosPDF:', error);
    throw error;
  }
}

async function testarPlanilhaUI() {
  try {
    const response = await fetch(`${API_BASE_URL}/testar-planilha`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em testarPlanilhaUI:', error);
    throw error;
  }
}

async function testarLeituraEquipamentos() {
  try {
    const response = await fetch(`${API_BASE_URL}/testar-leitura-equipamentos`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em testarLeituraEquipamentos:', error);
    throw error;
  }
}

if (typeof window !== 'undefined') {
  window.requestOtp = requestOtp;
  window.validateOtp = validateOtp;
  window.getNomeUsuario = getNomeUsuario;
  window.getListasCadastro = getListasCadastro;
  window.getEquipamentosDaFilial = getEquipamentosDaFilial;
  window.getEquipamentosGlobal = getEquipamentosGlobal;
  window.createEquipamento = createEquipamento;
  window.updateEquipamento = updateEquipamento;
  window.cloneEquipamento = cloneEquipamento;
  window.removerEquipamento = removerEquipamento;
  window.atualizarStatusManutencao = atualizarStatusManutencao;
  window.registrarManutencao = registrarManutencao;
  window.getRegistrosManutencao = getRegistrosManutencao;
  window.getHistoricoEquipamento = getHistoricoEquipamento;
  window.getEspecificacoesModelo = getEspecificacoesModelo;
  window.listarUsuarios = listarUsuarios;
  window.adicionarUsuario = adicionarUsuario;
  window.atualizarUsuario = atualizarUsuario;
  window.removerUsuario = removerUsuario;
  window.getFiliaisParaEmprestimo = getFiliaisParaEmprestimo;
  window.registrarEmprestimo = registrarEmprestimo;
  window.registrarDevolucao = registrarDevolucao;
  window.exportarCSV = exportarCSV;
  window.exportarEquipamentosPDF = exportarEquipamentosPDF;
  window.testarPlanilhaUI = testarPlanilhaUI;
  window.testarLeituraEquipamentos = testarLeituraEquipamentos;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    requestOtp,
    validateOtp,
    getNomeUsuario,
    getListasCadastro,
    getEquipamentosDaFilial,
    getEquipamentosGlobal,
    createEquipamento,
    updateEquipamento,
    cloneEquipamento,
    removerEquipamento,
    atualizarStatusManutencao,
    registrarManutencao,
    getRegistrosManutencao,
    getHistoricoEquipamento,
    getEspecificacoesModelo,
    listarUsuarios,
    adicionarUsuario,
    atualizarUsuario,
    removerUsuario,
    getFiliaisParaEmprestimo,
    registrarEmprestimo,
    registrarDevolucao,
    exportarCSV,
    exportarEquipamentosPDF,
    testarPlanilhaUI,
    testarLeituraEquipamentos,
    API_BASE_URL,
  };
}