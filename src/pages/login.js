// ============================================================================
// LOGIN PAGE — Email / Senha
// ============================================================================

import { loginWithPassword } from '../shared/js/api.js';
import { toastError, toastSuccess, toastInfo, setButtonLoading, isButtonLoading } from '../shared/js/ui.js';
import { getToken, setToken, initAuthFromUrl, getScriptUrlBase } from '../shared/js/auth.js';

console.log('🔄 Login module loading...');

initAuthFromUrl();

if (getToken()) {
  console.log('🔄 Token encontrado, redirecionando...');
  window.location.href = getScriptUrlBase();
}

const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const feedbackEl = document.getElementById('feedback');
const btnEntrar = document.getElementById('btn-entrar');

console.log('🔍 Elements found:', { emailInput, passwordInput, feedbackEl, btnEntrar });

let isLoggingIn = false;

function setFeedback(msg, tipo) {
  feedbackEl.innerText = msg || '';
  feedbackEl.className = tipo ? 'is-' + tipo : '';
}

function setButtonsDisabled(disabled) {
  if (btnEntrar) btnEntrar.disabled = disabled;
  emailInput.disabled = disabled;
  passwordInput.disabled = disabled;
}

async function fazerLogin() {
  if (isLoggingIn || isButtonLoading(btnEntrar)) return;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    setFeedback('Preencha e-mail e senha.', 'error');
    return;
  }

  isLoggingIn = true;
  setButtonsDisabled(true);
  setFeedback('Entrando...', 'info');

  try {
    console.log('🔄 Iniciando login:', { email });
    const res = await loginWithPassword(email, password);
    console.log('📥 Resposta login:', res);
    isLoggingIn = false;

    // A API retorna { message, redirectUrl } - não tem res.ok
    if (res && res.redirectUrl) {
      const token = res.redirectUrl.split('token=')[1];
      console.log('🔑 Token extraído:', token);
      setToken(token);
      console.log('✅ Token salvo, redirecionando para dashboard...');
      console.log('redirectUrl from backend:', res.redirectUrl);
      console.log('Current location:', window.location.href);
      console.log('Hostname:', window.location.hostname, 'Port:', window.location.port);

      // Busca perfil do usuário para saber qual dashboard abrir
      try {
        const apiBase = window.ENV?.API_BASE_URL || 'http://localhost:3000/api';
        console.log('Fetching user from:', `${apiBase}/get-nome-usuario?token=${encodeURIComponent(token)}`);
        const userRes = await fetch(`${apiBase}/get-nome-usuario?token=${encodeURIComponent(token)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('User response status:', userRes.status);
        const userData = await userRes.json();
        console.log('User data:', userData);
        const nivel = userData.data?.nivel || 'Matriz';
        console.log('Nivel:', nivel);
        
        const dashboardMap = {
          'Matriz': 'matriz.html',
          'AdminFilial': 'filial.html',
          'Filial': 'filial.html',
          'Tecnico': 'tecnico.html'
        };
        const page = dashboardMap[nivel] || 'matriz.html';
        console.log('Page:', page);
        
        // Em dev Vite serve em /pages/, em prod na raiz
        const isDev = window.location.hostname === 'localhost' && window.location.port === '5173';
        const basePath = isDev ? '/pages/' : '/';
        const finalUrl = `${basePath}${page}?token=${encodeURIComponent(token)}`;
        console.log('Final redirect URL:', finalUrl);
        window.location.href = finalUrl;
      } catch (e) {
        console.warn('⚠️ Erro ao buscar perfil, usando matriz.html:', e);
        const isDev = window.location.hostname === 'localhost' && window.location.port === '5173';
        const basePath = isDev ? '/pages/' : '/';
        const finalUrl = `${basePath}matriz.html?token=${encodeURIComponent(token)}`;
        console.log('Fallback redirect URL:', finalUrl);
        window.location.href = finalUrl;
      }
    } else {
      console.error('❌ Login falhou - resposta inesperada:', res);
      setButtonsDisabled(false);
      setFeedback(res?.message || 'Erro no login', 'error');
    }
  } catch (err) {
    console.error('❌ Erro no login:', err);
    isLoggingIn = false;
    setButtonsDisabled(false);
    setFeedback('Erro: ' + err.message, 'error');
  }
}

btnEntrar.addEventListener('click', fazerLogin);

[emailInput, passwordInput].forEach(el => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); fazerLogin(); }
  });
});

document.addEventListener('DOMContentLoaded', () => {
  if (window.M && M.updateTextFields) M.updateTextFields();
  emailInput.focus();
});

console.log('✅ Login page loaded (email/senha)');