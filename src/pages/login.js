// ============================================================================
// LOGIN PAGE — Email / Senha (com primeiro acesso: definir senha)
// ============================================================================

import { loginWithPassword, verificarUsuario, definirSenha } from '../shared/js/api.js';
import { toastError, toastSuccess, toastInfo, setButtonLoading, isButtonLoading } from '../shared/js/ui.js';
import { setToken, initAuthFromUrl } from '../shared/js/auth.js';

console.log('🔄 Login module loading...');

initAuthFromUrl();

const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirm-password');
const campoConfirmar = document.getElementById('campo-confirmar');
const tituloCard = document.getElementById('titulo-card');
const subtitulo = document.getElementById('subtitulo');
const btnEntrarTexto = document.getElementById('btn-entrar-texto');
const feedbackEl = document.getElementById('feedback');
const btnEntrar = document.getElementById('btn-entrar');

console.log('🔍 Elements found:', { emailInput, passwordInput, feedbackEl, btnEntrar });

let isLoggingIn = false;
let modoPrimeiroAcesso = false;

function setFeedback(msg, tipo) {
  feedbackEl.innerText = msg || '';
  feedbackEl.className = tipo ? 'is-' + tipo : '';
}

function setButtonsDisabled(disabled) {
  if (btnEntrar) btnEntrar.disabled = disabled;
  emailInput.disabled = disabled;
  passwordInput.disabled = disabled;
  if (confirmPasswordInput) confirmPasswordInput.disabled = disabled;
}

function entrarModoPrimeiroAcesso() {
  modoPrimeiroAcesso = true;
  if (campoConfirmar) campoConfirmar.style.display = 'block';
  if (tituloCard) tituloCard.innerHTML = '<i class="material-icons left" style="vertical-align:middle;color:var(--sce-primary);">vpn_key</i>Primeiro acesso';
  if (subtitulo) subtitulo.innerText = 'Crie uma senha para o seu e-mail institucional.';
  if (btnEntrarTexto) btnEntrarTexto.innerText = 'Criar senha e entrar';
  passwordInput.value = '';
  if (confirmPasswordInput) confirmPasswordInput.value = '';
  passwordInput.autocomplete = 'new-password';
}

function sairModoPrimeiroAcesso() {
  modoPrimeiroAcesso = false;
  if (campoConfirmar) campoConfirmar.style.display = 'none';
  if (tituloCard) tituloCard.innerHTML = '<i class="material-icons left" style="vertical-align:middle;color:var(--sce-primary);">login</i>Entrar';
  if (subtitulo) subtitulo.innerText = 'Use seu e-mail institucional e senha.';
  if (btnEntrarTexto) btnEntrarTexto.innerText = 'Entrar';
  passwordInput.autocomplete = 'current-password';
}

function redirecionarParaDashboard(res) {
  let dest = '/pages/matriz';
  const redirectUrl = res?.redirectUrl ?? res?.data?.redirectUrl;
  if (redirectUrl) {
    try {
      const u = new URL(redirectUrl, window.location.origin);
      dest = u.pathname.replace(/\.html$/, '');
    } catch {
      dest = '/pages/matriz';
    }
  }
  window.location.href = dest;
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
  setFeedback('Verificando...', 'info');

  try {
    // Verifica se é usuário cadastrado e se já tem senha
    const usuario = await verificarUsuario(email);

    if (!usuario || usuario.existe === false) {
      isLoggingIn = false;
      setButtonsDisabled(false);
      setFeedback('E-mail não cadastrado. Contate a Matriz.', 'error');
      return;
    }

    if (usuario.senhaDefinida === false) {
      // Primeiro acesso: definir senha
      if (!modoPrimeiroAcesso) {
        entrarModoPrimeiroAcesso();
        isLoggingIn = false;
        setButtonsDisabled(false);
        setFeedback('Primeiro acesso detectado. Crie sua senha abaixo.', 'info');
        return;
      }
      // Valida confirmação
      const confirm = confirmPasswordInput.value;
      if (!confirm || confirm !== password) {
        isLoggingIn = false;
        setButtonsDisabled(false);
        setFeedback('As senhas não coincidem. Confira e tente novamente.', 'error');
        return;
      }
      if (password.length < 6) {
        isLoggingIn = false;
        setButtonsDisabled(false);
        setFeedback('A senha deve ter pelo menos 6 caracteres.', 'error');
        return;
      }
      setFeedback('Criando senha...', 'info');
      const res = await definirSenha(email, password);
      isLoggingIn = false;
      const token = res?.token ?? res?.data?.token;
      if (token) {
        setToken(token);
        redirecionarParaDashboard(res);
      } else {
        setButtonsDisabled(false);
        setFeedback(res?.message || 'Erro ao criar senha', 'error');
      }
      return;
    }

    // Login normal
    setFeedback('Entrando...', 'info');
    const res = await loginWithPassword(email, password);
    isLoggingIn = false;

    const token = res?.token ?? res?.data?.token;
    if (token) {
      setToken(token);
      redirecionarParaDashboard(res);
    } else {
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

// Ao editar o e-mail, volta ao modo normal (caso troque de usuário)
if (emailInput) {
  emailInput.addEventListener('input', () => {
    if (modoPrimeiroAcesso) sairModoPrimeiroAcesso();
  });
}

btnEntrar.addEventListener('click', fazerLogin);

[emailInput, passwordInput, confirmPasswordInput].forEach(el => {
  if (!el) return;
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); fazerLogin(); }
  });
});

document.addEventListener('DOMContentLoaded', () => {
  if (window.M && M.updateTextFields) M.updateTextFields();
  emailInput.focus();
});

console.log('✅ Login page loaded (email/senha)');