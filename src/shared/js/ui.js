// ============================================================================
// UI — Loading, Toasts, CSV, PDF, Helpers de interface
// ============================================================================

/* ============================================================================
   LOADING OVERLAY
   ============================================================================ */

export function showLoading() {
  const el = document.getElementById('sce-loading-overlay');
  if (el) el.classList.add('active');
}

export function hideLoading() {
  const el = document.getElementById('sce-loading-overlay');
  if (el) el.classList.remove('active');
}

/* ============================================================================
   TOASTS (Materialize wrapper)
   ============================================================================ */

export function toast(message, type = 'info', duration = 4000) {
  if (!window.M || !M.toast) {
    console.warn('Materialize não carregado, fallback para console:', message);
    return;
  }
  
  const classes = [];
  if (type === 'error') classes.push('red', 'darken-1', 'white-text');
  else if (type === 'success') classes.push('green', 'darken-1', 'white-text');
  else if (type === 'warning') classes.push('orange', 'darken-1', 'white-text');
  else classes.push('blue', 'darken-1', 'white-text');
  
  M.toast({
    html: message,
    classes: classes.join(' '),
    displayLength: duration,
    completeCallback: () => {},
  });
}

export const toastSuccess = (msg, dur) => toast(msg, 'success', dur);
export const toastError = (msg, dur) => toast(msg, 'error', dur);
export const toastInfo = (msg, dur) => toast(msg, 'info', dur);
export const toastWarning = (msg, dur) => toast(msg, 'warning', dur);

/* ============================================================================
   CSV EXPORT
   ============================================================================ */

export function downloadCsv(csvContent, filename = 'export.csv') {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function arrayToCsv(data, headers) {
  if (!data || !data.length) return headers.join(',');
  const rows = data.map(row => 
    headers.map(h => {
      const val = row[h] ?? '';
      const escaped = String(val).replace(/"/g, '""');
      return `"${escaped}"`;
    }).join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

/* ============================================================================
   PDF EXPORT (via window.print)
   ============================================================================ */

export function exportPdf(printDataSelector = null) {
  const el = document.getElementById('sce-print-data');
  if (el) el.innerText = 'Gerado em ' + new Date().toLocaleString('pt-BR');
  window.print();
}

/* ============================================================================
   MODAL HELPERS
   ============================================================================ */

export function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return null;
  if (window.M && M.Modal) {
    const instance = M.Modal.getInstance(el) || M.Modal.init(el);
    instance.open();
    return instance;
  }
  el.style.display = 'block';
  return { close: () => el.style.display = 'none' };
}

export function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;
  if (window.M && M.Modal) {
    const instance = M.Modal.getInstance(el);
    if (instance) instance.close();
  }
  el.style.display = 'none';
}

export function initModals() {
  if (!window.M || !M.Modal) return;
  document.querySelectorAll('.modal').forEach(el => {
    if (!M.Modal.getInstance(el)) M.Modal.init(el);
  });
}

/* ============================================================================
   SELECT / FORM INIT (Materialize)
   ============================================================================ */

export function initSelects(selector = 'select') {
  if (!window.M || !M.FormSelect) return;
  document.querySelectorAll(selector).forEach(el => {
    if (!M.FormSelect.getInstance(el)) M.FormSelect.init(el);
  });
}

export function updateTextFields() {
  if (window.M && M.updateTextFields) M.updateTextFields();
}

/* ============================================================================
   BUTTON LOADING STATE
   ============================================================================ */

export function setButtonLoading(button, loading) {
  if (!button) return;
  if (loading) {
    button.dataset.loading = '1';
    button.classList.add('disabled');
    button.disabled = true;
  } else {
    button.dataset.loading = '0';
    button.classList.remove('disabled');
    button.disabled = false;
  }
}

export function isButtonLoading(button) {
  return button?.dataset?.loading === '1';
}

/* ============================================================================
   CONFIRM DIALOG (wrapper)
   ============================================================================ */

export function confirmAction(message, onConfirm, onCancel = () => {}) {
  if (confirm(message)) {
    onConfirm();
  } else {
    onCancel();
  }
}

/* ============================================================================
   FILE UPLOAD HELPER (base64)
   ============================================================================ */

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function validateFile(file, maxSizeMB = 8, allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png']) {
  if (!file) return { valid: false, error: 'Nenhum arquivo selecionado' };
  
  if (file.size > maxSizeMB * 1024 * 1024) {
    return { valid: false, error: `Arquivo muito grande. Máximo de ${maxSizeMB}MB.` };
  }
  
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowedTypes.includes(ext)) {
    return { valid: false, error: `Tipo de arquivo não permitido. Permitidos: ${allowedTypes.join(', ')}` };
  }
  
  return { valid: true };
}

/* ============================================================================
   NUMBER FORMATTING
   ============================================================================ */

export function formatNumber(value, decimals = 0) {
  if (value === null || value === undefined || value === '') return '-';
  return Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined) return '-';
  return (Number(value) * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }) + '%';
}