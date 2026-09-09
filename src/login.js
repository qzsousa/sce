// ============================================================================
// LOGIN PAGE — Email / Senha
// ============================================================================

import { loginWithPassword } from './shared/js/api.js';
import { toastError, toastSuccess, toastInfo, setButtonLoading, isButtonLoading } from './shared/js/ui.js';
import { getToken, setToken, initAuthFromUrl, getScriptUrlBase } from './shared/js/auth.js';

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

    // A API retorna { token, redirectUrl } - não tem res.ok
    // Handle both {token} and {data: {token}} response formats
    const token = res?.token ?? res?.data?.token;
    if (token) {
      console.log('🔑 Token recebido:', token);
      setToken(token);
      console.log('✅ Token salvo, redirecionando para dashboard...');

      // Vercel cleanUrls=true removes .html extension
      // Use relative path without .html
      const finalUrl = '/pages/matriz';
      console.log('Final redirect URL:', finalUrl);
      window.location.href = finalUrl;
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