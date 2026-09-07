// ============================================================================
   // AUTH — Gerenciamento de token e sessão
   // ============================================================================

const TOKEN_KEY = 'sce_token';

export function getToken() {
  return window.SCE_TOKEN || localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  window.SCE_TOKEN = token;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  window.SCE_TOKEN = null;
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated() {
  return !!getToken();
}

export function getAuthHeaders(token = null) {
  const t = token || getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (t) headers['Authorization'] = `Bearer ${t}`;
  return headers;
}

export function getScriptUrlBase() {
  return window.location.href.split('?')[0];
}

export function logout() {
  clearToken();
  const baseUrl = getScriptUrlBase();
  if (window.top !== window.self) {
    window.top.location.href = baseUrl;
  } else {
    window.location.href = baseUrl;
  }
}

// Auto-restore token from URL on page load
export function initAuthFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const tokenFromUrl = urlParams.get('token');
  if (tokenFromUrl) {
    setToken(tokenFromUrl);
    // Limpa URL sem recarregar
    window.history.replaceState({}, document.title, getScriptUrlBase());
  }
}

// Chama ao carregar
initAuthFromUrl();