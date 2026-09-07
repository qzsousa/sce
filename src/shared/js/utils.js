// ============================================================================
// UTILS — Helpers compartilhados
// ============================================================================

export function formatDate(date, options = {}) {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  const opts = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  };
  return d.toLocaleString('pt-BR', opts);
}

export function formatDateShort(date) {
  return formatDate(date, { hour: undefined, minute: undefined });
}

export function formatCurrency(value) {
  if (!value) return '-';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function truncate(text, maxLength = 50) {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

export function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

export function throttle(fn, limit) {
  let inThrottle;
  return (...args) => {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

export function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

export function getNested(obj, path, defaultValue = null) {
  return path.split('.').reduce((o, k) => (o || {})[k], obj) ?? defaultValue;
}

export function parseQueryString(queryString) {
  const params = new URLSearchParams(queryString);
  const result = {};
  for (const [key, value] of params) result[key] = value;
  return result;
}

export function buildQueryString(params) {
  return new URLSearchParams(params).toString();
}

/* ============================================================================
   FORM HELPERS
   ============================================================================ */

export function getFormData(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    if (data[key]) {
      if (!Array.isArray(data[key])) data[key] = [data[key]];
      data[key].push(value);
    } else {
      data[key] = value;
    }
  });
  return data;
}

export function setFormData(form, data) {
  Object.entries(data).forEach(([key, value]) => {
    const field = form.elements[key];
    if (!field) return;
    if (field.type === 'checkbox') {
      field.checked = !!value;
    } else if (field.type === 'radio') {
      const radio = form.querySelector(`[name="${key}"][value="${value}"]`);
      if (radio) radio.checked = true;
    } else if (field.tagName === 'SELECT' && field.multiple) {
      Array.from(field.options).forEach(opt => opt.selected = Array.isArray(value) && value.includes(opt.value));
    } else {
      field.value = value ?? '';
    }
    // Trigger Materialize label update
    if (window.M && M.updateTextFields) M.updateTextFields();
  });
}

export function clearForm(form) {
  form.reset();
  if (window.M && M.updateTextFields) M.updateTextFields();
}

/* ============================================================================
   VALIDATION HELPERS
   ============================================================================ */

export const validators = {
  required: (value) => !isEmpty(value) || 'Campo obrigatório',
  email: (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || 'E-mail inválido',
  minLength: (min) => (value) => !value || value.length >= min || `Mínimo ${min} caracteres`,
  maxLength: (max) => (value) => !value || value.length <= max || `Máximo ${max} caracteres`,
  numeric: (value) => !value || /^\d+$/.test(value) || 'Apenas números',
  cpf: (value) => !value || /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(value) || 'CPF inválido',
};

export function validateField(value, rules) {
  for (const rule of rules) {
    const result = typeof rule === 'function' ? rule(value) : rule;
    if (result !== true) return result;
  }
  return true;
}

export function validateForm(form, rules) {
  const errors = {};
  let isValid = true;
  Object.entries(rules).forEach(([field, fieldRules]) => {
    const input = form.elements[field];
    const value = input ? input.value : '';
    const error = validateField(value, fieldRules);
    if (error !== true) {
      errors[field] = error;
      isValid = false;
      if (input) input.classList.add('invalid');
    } else if (input) {
      input.classList.remove('invalid');
    }
  });
  return { isValid, errors };
}

/* ============================================================================
   ARRAY/ OBJECT HELPERS
   ============================================================================ */

export function uniqueBy(arr, key) {
  const seen = new Set();
  return arr.filter(item => {
    const val = key ? item[key] : item;
    if (seen.has(val)) return false;
    seen.add(val);
    return true;
  });
}

export function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const group = item[key];
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {});
}

export function sortBy(arr, key, order = 'asc') {
  return [...arr].sort((a, b) => {
    const valA = a[key];
    const valB = b[key];
    if (valA < valB) return order === 'asc' ? -1 : 1;
    if (valA > valB) return order === 'asc' ? 1 : -1;
    return 0;
  });
}

export function sumBy(arr, key) {
  return arr.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
}