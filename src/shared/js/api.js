// ============================================================================
// API CLIENT — Cliente HTTP para comunicação com o backend
// ============================================================================

const API_BASE_URL = (typeof process !== 'undefined' && process.env?.API_BASE_URL)
  ? process.env.API_BASE_URL
  : (window.ENV?.API_BASE_URL || 'http://localhost:3000/api');

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

export async function loginWithPassword(email, password) {
  try {
    const response = await fetch(`${API_BASE_URL}/login-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em loginWithPassword:', error);
    throw error;
  }
}

export async function getNomeUsuario(token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/get-nome-usuario?token=${encodeURIComponent(t)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getNomeUsuario:', error);
    throw error;
  }
}

export async function getListasCadastro(token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/listas-cadastro?token=${encodeURIComponent(t)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getListasCadastro:', error);
    throw error;
  }
}

export async function getEquipamentosDaFilial(token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/equipamentos-da-filial?token=${encodeURIComponent(t)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getEquipamentosDaFilial:', error);
    throw error;
  }
}

export async function getEquipamentosGlobal(token, incluirRemovidos = false) {
  try {
    const t = token || getToken();
    const params = new URLSearchParams({ token: t });
    if (incluirRemovidos) params.append('incluirRemovidos', 'true');
    const response = await fetch(`${API_BASE_URL}/equipamentos-global?${params}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getEquipamentosGlobal:', error);
    throw error;
  }
}

export async function createEquipamento(token, dadosEquipamento) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/create-equipamento?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
      body: JSON.stringify(dadosEquipamento),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em createEquipamento:', error);
    throw error;
  }
}

export async function updateEquipamento(token, id, camposAlterados) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/update-equipamento?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
      body: JSON.stringify({ id, ...camposAlterados }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em updateEquipamento:', error);
    throw error;
  }
}

export async function cloneEquipamento(token, idOrigem) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/clone-equipamento?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
      body: JSON.stringify({ idOrigem }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em cloneEquipamento:', error);
    throw error;
  }
}

export async function removerEquipamento(token, id) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/remover-equipamento?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
      body: JSON.stringify({ id }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em removerEquipamento:', error);
    throw error;
  }
}

export async function atualizarStatusManutencao(token, equipamentoId, novoStatus) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/atualizar-status-manutencao?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
      body: JSON.stringify({ equipamentoId, novoStatus }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em atualizarStatusManutencao:', error);
    throw error;
  }
}

export async function registrarManutencao(token, equipamentoId, descricao, status) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/registrar-manutencao?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
      body: JSON.stringify({ equipamentoId, descricao, status }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em registrarManutencao:', error);
    throw error;
  }
}

export async function getRegistrosManutencao(token, equipamentoId) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/registros-manutencao?token=${encodeURIComponent(t)}&equipamentoId=${encodeURIComponent(equipamentoId)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getRegistrosManutencao:', error);
    throw error;
  }
}

export async function getHistoricoEquipamento(token, equipamentoId) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/historico-equipamento?token=${encodeURIComponent(t)}&equipamentoId=${encodeURIComponent(equipamentoId)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getHistoricoEquipamento:', error);
    throw error;
  }
}

export async function getEspecificacoesModelo(modelo, token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/especificacoes-modelo?token=${encodeURIComponent(t)}&modelo=${encodeURIComponent(modelo)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getEspecificacoesModelo:', error);
    throw error;
  }
}

export async function listarUsuarios(token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/listar-usuarios?token=${encodeURIComponent(t)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em listarUsuarios:', error);
    throw error;
  }
}

export async function adicionarUsuario(token, usuario) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/adicionar-usuario?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
      body: JSON.stringify(usuario),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em adicionarUsuario:', error);
    throw error;
  }
}

export async function atualizarUsuario(token, emailOriginal, dados) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/atualizar-usuario?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
      body: JSON.stringify({ emailOriginal, ...dados }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em atualizarUsuario:', error);
    throw error;
  }
}

export async function removerUsuario(token, email) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/remover-usuario?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
      body: JSON.stringify({ email }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em removerUsuario:', error);
    throw error;
  }
}

export async function getFiliaisParaEmprestimo(token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/filiais-para-emprestimo?token=${encodeURIComponent(t)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getFiliaisParaEmprestimo:', error);
    throw error;
  }
}

export async function registrarEmprestimo(token, ids, dados) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/registrar-emprestimo?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
      body: JSON.stringify({ ids, ...dados }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em registrarEmprestimo:', error);
    throw error;
  }
}

export async function registrarDevolucao(token, ids, observacao) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/registrar-devolucao?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
      body: JSON.stringify({ ids, observacao }),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em registrarDevolucao:', error);
    throw error;
  }
}

export async function exportarCSV(token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/exportar-csv?token=${encodeURIComponent(t)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em exportarCSV:', error);
    throw error;
  }
}

export async function exportarEquipamentosPDF(token, filtros = {}) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/exportar-pdf?token=${encodeURIComponent(t)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
      body: JSON.stringify(filtros),
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em exportarEquipamentosPDF:', error);
    throw error;
  }
}

export async function getTecnicoUnidades(token) {
  try {
    const t = token || getToken();
    const response = await fetch(`${API_BASE_URL}/tecnico-unidades?token=${encodeURIComponent(t)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
    });
    return await handleResponse(response);
  } catch (error) {
    console.error('Erro em getTecnicoUnidades:', error);
    throw error;
  }
}