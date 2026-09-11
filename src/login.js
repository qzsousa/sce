// ============================================================================
// LOGIN PAGE — Email / Senha (com verificação automática + primeiro acesso)
// ============================================================================

import { loginWithPassword, verificarUsuario, definirSenha } from './shared/js/api.js';
import { toastError, toastSuccess, toastInfo, setButtonLoading, isButtonLoading } from './shared/js/ui.js';
import { setToken, initAuthFromUrl } from './shared/js/auth.js';

console.log('🔄 Login module loading...');

initAuthFromUrl();

const CHAMADO_URL = 'https://chamados-lac-delta.vercel.app/chamado/novo';

const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirm-password');
const campoConfirmar = document.getElementById('campo-confirmar');
const tituloCard = document.getElementById('titulo-card');
const subtitulo = document.getElementById('subtitulo');
const btnEntrarTexto = document.getElementById('btn-entrar-texto');
const feedbackEl = document.getElementById('feedback');
const emailStatusEl = document.getElementById('email-status');
const faMensagemEl = document.getElementById('fa-mensagem');
const btnEntrar = document.getElementById('btn-entrar');
const btnPrimeiroAcesso = document.getElementById('btn-primeiro-acesso');

let isLoggingIn = false;
let modoPrimeiroAcesso = false;
let emailDebounceTimer = null;

function setFeedback(msg, tipo) {
  feedbackEl.innerText = msg || '';
  feedbackEl.className = tipo ? 'is-' + tipo : '';
}

function setEmailStatus(msg, tipo) {
  emailStatusEl.innerText = msg || '';
  emailStatusEl.className = tipo ? 'is-' + tipo : '';
}

function setFaMensagem(html) {
  faMensagemEl.innerHTML = html || '';
}

function setButtonsDisabled(disabled) {
  if (btnEntrar) btnEntrar.disabled = disabled;
  if (btnPrimeiroAcesso) btnPrimeiroAcesso.disabled = disabled;
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
  const step1 = document.getElementById('step-1');
  const step2 = document.getElementById('step-2');
  const step2Label = document.getElementById('step-2-label');
  if (step1) { step1.classList.remove('active'); step1.classList.add('done'); }
  if (step2) step2.classList.add('active');
  if (step2Label) step2Label.innerText = 'Criar senha';
  setFeedback('Crie sua senha abaixo.', 'info');
  setFaMensagem('');
  if (passwordInput) setTimeout(() => passwordInput.focus(), 150);
}

function sairModoPrimeiroAcesso() {
  modoPrimeiroAcesso = false;
  if (campoConfirmar) campoConfirmar.style.display = 'none';
  if (tituloCard) tituloCard.innerHTML = '<i class="material-icons left" style="vertical-align:middle;color:var(--sce-primary);">login</i>Entrar';
  if (subtitulo) subtitulo.innerText = 'Use seu e-mail institucional e senha.';
  if (btnEntrarTexto) btnEntrarTexto.innerText = 'Entrar';
  passwordInput.autocomplete = 'current-password';
  const step1 = document.getElementById('step-1');
  const step2 = document.getElementById('step-2');
  const step2Label = document.getElementById('step-2-label');
  if (step1) { step1.classList.add('active'); step1.classList.remove('done'); }
  if (step2) step2.classList.remove('active');
  if (step2Label) step2Label.innerText = 'Senha';
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

// Verifica o e-mail no backend e retorna o objeto do usuário (ou null)
async function verificarAcesso(email) {
  try {
    return await verificarUsuario(email);
  } catch (err) {
    console.error('Erro ao verificar usuário:', err);
    return null;
  }
}

// Verificação automática enquanto digita o e-mail (com debounce)
function agendarVerificacaoEmail() {
  if (emailDebounceTimer) clearTimeout(emailDebounceTimer);
  const email = emailInput.value.trim();
  if (!email) {
    setEmailStatus('', '');
    return;
  }
  emailDebounceTimer = setTimeout(async () => {
    const usuario = await verificarAcesso(email);
    if (!usuario) {
      setEmailStatus('Não foi possível verificar o e-mail agora.', 'info');
      return;
    }
    if (usuario.existe === false) {
      setEmailStatus('E-mail não encontrado no sistema.', 'error');
    } else if (usuario.senhaDefinida === false) {
      setEmailStatus('Primeiro acesso: este e-mail ainda não tem senha.', 'success');
    } else {
      setEmailStatus('Este e-mail já possui uma senha.', 'info');
    }
  }, 600);
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
    const usuario = await verificarUsuario(email);

    if (!usuario || usuario.existe === false) {
      isLoggingIn = false;
      setButtonsDisabled(false);
      setFeedback('E-mail não cadastrado. Contate a Matriz.', 'error');
      return;
    }

    if (usuario.senhaDefinida === false) {
      if (!modoPrimeiroAcesso) {
        entrarModoPrimeiroAcesso();
      } else {
        const confirm = confirmPasswordInput.value;
        if (!confirm || confirm !== password) {
          setFeedback('As senhas não coincidem. Confira e tente novamente.', 'error');
          return;
        }
        if (password.length < 6) {
          setFeedback('A senha deve ter pelo menos 6 caracteres.', 'error');
          return;
        }
        setFeedback('Criando senha...', 'info');
        const res = await definirSenha(email, password);
        const token = res?.token ?? res?.data?.token;
        if (token) {
          setToken(token);
          redirecionarParaDashboard(res);
          return;
        }
        setButtonsDisabled(false);
        setFeedback(res?.message || 'Erro ao criar senha', 'error');
      }
      isLoggingIn = false;
      setButtonsDisabled(false);
      return;
    }

    setFeedback('Entrando...', 'info');
    const res = await loginWithPassword(email, password);
    isLoggingIn = false;

    const token = res?.token ?? res?.data?.token;
    if (token) {
      setToken(token);
      redirecionarParaDashboard(res);
    } else {
      setButtonsDisabled(false);
      setFeedback(res?.message || 'Credenciais inválidas.', 'error');
    }
  } catch (err) {
    console.error('❌ Erro no login:', err);
    isLoggingIn = false;
    setButtonsDisabled(false);
    setFeedback('Erro: ' + err.message, 'error');
  }
}

// Botão "Primeiro acesso": verifica se há cadastro/senha e reage
async function verificarPrimeiroAcesso() {
  if (isLoggingIn) return;

  const email = emailInput.value.trim();
  if (!email) {
    setFeedback('Digite o seu e-mail institucional.', 'error');
    emailInput.focus();
    return;
  }

  setFeedback('Verificando e-mail...', 'info');
  const usuario = await verificarAcesso(email);

  if (!usuario) {
    setFeedback('Não foi possível verificar o e-mail agora. Tente novamente.', 'error');
    return;
  }

  if (usuario.existe === false) {
    setFeedback('Este e-mail não está cadastrado no sistema. Contate a Matriz.', 'error');
    setFaMensagem('');
    return;
  }

  if (usuario.senhaDefinida !== false) {
    // Já possui senha: orienta a pedir redefinição via diretor/chamado
    setFeedback('', '');
    setFaMensagem(
      '<div style="padding:12px 14px;background:var(--sce-primary-light);border-radius:10px;border:1px solid var(--sce-primary);">' +
        '<strong style="color:var(--sce-primary-dark);">Esse e-mail já possui uma senha.</strong><br>' +
        'Peça para o diretor da sua escola alterar a senha ou abra um chamado por ' +
        '<a href="' + CHAMADO_URL + '" target="_blank" rel="noopener">este link</a>.' +
      '</div>'
    );
    return;
  }

  // Sem senha definida: primeiro acesso
  entrarModoPrimeiroAcesso();
  setFaMensagem('');
}

// Ao editar o e-mail, volta ao modo normal (caso troque de usuário)
if (emailInput) {
  emailInput.addEventListener('input', () => {
    setFaMensagem('');
    if (modoPrimeiroAcesso) sairModoPrimeiroAcesso();
    agendarVerificacaoEmail();
  });
}

btnEntrar.addEventListener('click', fazerLogin);
btnPrimeiroAcesso.addEventListener('click', verificarPrimeiroAcesso);

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

// Mostrar/ocultar senha
document.querySelectorAll('.pwd-toggle').forEach(icon => {
  icon.addEventListener('click', function () {
    const input = document.getElementById(this.dataset.target);
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      this.innerText = 'visibility_off';
    } else {
      input.type = 'password';
      this.innerText = 'visibility';
    }
  });
});

console.log('✅ Login page loaded (email/senha)');