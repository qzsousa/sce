// ============================================================================
// SHARED MAIN — Entry point para módulos compartilhados
// ============================================================================

import '../css/main.css';
import './auth.js';
import './utils.js';
import './lists.js';
import './ui.js';
import './dev-panel.js';

// Exporta tudo para uso global (compatibilidade com código existente)
import * as auth from './auth.js';
import * as utils from './utils.js';
import * as lists from './lists.js';
import * as ui from './ui.js';

// Disponibiliza no window para compatibilidade com código inline nos HTMLs
window.sceAuth = auth;
window.sceUtils = utils;
window.sceLists = lists;
window.sceUi = ui;

// Inicializações globais
document.addEventListener('DOMContentLoaded', () => {
  // Inicializa selects Materialize
  if (window.M && M.FormSelect) {
    document.querySelectorAll('select').forEach(el => {
      if (!M.FormSelect.getInstance(el)) M.FormSelect.init(el);
    });
  }
  
  // Atualiza text fields
  if (window.M && M.updateTextFields) M.updateTextFields();
  
  // Inicializa modais
  if (window.M && M.Modal) {
    document.querySelectorAll('.modal').forEach(el => {
      if (!M.Modal.getInstance(el)) M.Modal.init(el);
    });
  }
});

console.log('✅ SCE Shared modules loaded');