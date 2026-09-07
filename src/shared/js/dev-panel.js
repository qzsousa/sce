// ============================================================================
// DEV PANEL — Profile Test Switcher (Development Only)
// ============================================================================

export function initDevPanel() {
  const isDevMode = new URLSearchParams(window.location.search).has('dev') 
    || localStorage.getItem('sce_dev') === '1';
  const panel = document.getElementById('sce-dev-panel');
  if (!panel) return;

  if (isDevMode) {
    panel.classList.add('visible');
    loadSavedDevProfile();
  }

  // Expor funções globais para onclick no HTML
  window.sceDevPanelHide = () => panel.classList.remove('visible');
  window.sceDevProfileChange = handleProfileChange;
  window.sceDevFilialChange = (value) => localStorage.setItem('sce_dev_filial', value);
  window.sceDevEmailChange = (value) => localStorage.setItem('sce_dev_email', value);
  window.sceDevApplyProfile = applyDevProfile;
  window.sceDevClearProfile = clearDevProfile;
}

function loadSavedDevProfile() {
  const savedProfile = localStorage.getItem('sce_dev_profile');
  const savedFilial = localStorage.getItem('sce_dev_filial');
  const savedEmail = localStorage.getItem('sce_dev_email');
  
  const profileSelect = document.getElementById('sce-dev-profile-select');
  const filialInput = document.getElementById('sce-dev-filial-input');
  const emailInput = document.getElementById('sce-dev-email-input');
  
  if (savedProfile && profileSelect) profileSelect.value = savedProfile;
  if (savedFilial && filialInput) filialInput.value = savedFilial;
  if (savedEmail && emailInput) emailInput.value = savedEmail;
  
  // Mostra/oculta campo filial baseado no perfil
  handleProfileChange(savedProfile || '');
}

function handleProfileChange(value) {
  const filialInput = document.getElementById('sce-dev-filial-input');
  if (filialInput) {
    filialInput.style.display = (value === 'AdminFilial' || value === 'Tecnico') ? 'block' : 'none';
  }
}

function applyDevProfile() {
  const profile = document.getElementById('sce-dev-profile-select')?.value;
  const filial = document.getElementById('sce-dev-filial-input')?.value;
  const email = document.getElementById('sce-dev-email-input')?.value;

  if (!profile) { alert('Selecione um perfil'); return; }
  if ((profile === 'AdminFilial' || profile === 'Tecnico') && !filial) { 
    alert('Informe a unidade/filial'); 
    return; 
  }

  localStorage.setItem('sce_dev_profile', profile);
  localStorage.setItem('sce_dev_filial', filial);
  localStorage.setItem('sce_dev_email', email);

  // Cria sessão mock via servidor
  const baseUrl = window.location.href.split('?')[0];
  const params = new URLSearchParams({ dev: '1', profile });
  if (filial) params.set('filial', filial);
  if (email) params.set('email', email);
  window.location.href = baseUrl + '?' + params.toString();
}

function clearDevProfile() {
  localStorage.removeItem('sce_dev_profile');
  localStorage.removeItem('sce_dev_filial');
  localStorage.removeItem('sce_dev_email');
  
  const profileSelect = document.getElementById('sce-dev-profile-select');
  const filialInput = document.getElementById('sce-dev-filial-input');
  const emailInput = document.getElementById('sce-dev-email-input');
  
  if (profileSelect) profileSelect.value = '';
  if (filialInput) { filialInput.value = ''; filialInput.style.display = 'none'; }
  if (emailInput) emailInput.value = '';
  
  if (window.M && M.toast) M.toast({ html: 'Simulação limpa. Recarregue para voltar ao normal.' });
}

// Inicializa automaticamente quando DOM pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDevPanel);
} else {
  initDevPanel();
}

export { initDevPanel };