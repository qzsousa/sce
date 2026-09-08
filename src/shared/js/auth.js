// ============================================================================
// AUTH — Gerenciamento de token e sessão (localStorage-only, 24h expiry)
// ============================================================================

// Initialize API base URL from meta tag
(function initApiBaseUrl() {
  const meta = document.querySelector('meta[name="api-base-url"]');
  if (meta && meta.content) {
    window.ENV = window.ENV || {};
    window.ENV.API_BASE_URL = meta.content;
  }
})();

const TOKEN_KEY = 'sce_token';

export function getToken() {
  const stored = localStorage.getItem('sce_token');
  if (!stored) return '';
  
  try {
    const { token, expiresAt } = JSON.parse(stored);
    if (Date.now() > expiresAt) {
      clearToken();
      return '';
    }
    return token;
  } catch {
    // Legacy format or corrupted - clear and return empty
    clearToken();
    return '';
  }
}

export function setToken(token) {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  window.SCE_TOKEN = token;
  localStorage.setItem('sce_token', JSON.stringify({ token, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }));
}

export function clearToken() {
  window.SCE_TOKEN = null;
  localStorage.removeItem('sce_token');
}

export function isAuthenticated() {
  return !!getToken();
}

export function isTokenExpired() {
  const stored = localStorage.getItem('sce_token');
  if (!stored) return true;
  try {
    const { expiresAt } = JSON.parse(stored);
    return Date.now() > expiresAt;
  } catch {
    return true;
  }
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

// Auto-restore token from URL on page load (for backward compatibility during transition)
export function initAuthFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const tokenFromUrl = urlParams.get('token');
  if (tokenFromUrl) {
    const stored = localStorage.getItem('sce_token');
    if (!stored) {
      // Only set from URL if no token already in localStorage
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem('sce_token', JSON.stringify({ token: tokenFromUrl, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }));
    }
    // Clear URL without reload
    window.history.replaceState({}, document.title, getScriptUrlBase());
  }
}

// Call on load for backward compatibility during transition
initAuthFromUrl();