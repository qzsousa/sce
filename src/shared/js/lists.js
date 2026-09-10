// ============================================================================
// LISTS — Categoria / Marca / Modelo cascata com suporte a "Outro"
// ============================================================================

import { getCombinacoesDoCatalogo, preencherEspecificacoesModelo } from './catalogo-modelos.js';

let listasCache = null;

export function setListasCache(data) {
  const categorias = new Set();
  const marcasPorCategoria = {};
  const modelosPorCategoriaMarca = {};

  // Mescla os dados fornecidos com o catálogo padrão (planilha de modelos)
  const combinacoes = (data || []).concat(getCombinacoesDoCatalogo());

  combinacoes.forEach(item => {
    const cat = item.categoria?.trim();
    const marca = item.marca?.trim();
    const modelo = item.modelo?.trim();
    if (!cat || !marca || !modelo) return;
    categorias.add(cat);
    if (!marcasPorCategoria[cat]) marcasPorCategoria[cat] = new Set();
    marcasPorCategoria[cat].add(marca);
    if (!modelosPorCategoriaMarca[cat]) modelosPorCategoriaMarca[cat] = {};
    if (!modelosPorCategoriaMarca[cat][marca]) modelosPorCategoriaMarca[cat][marca] = new Set();
    modelosPorCategoriaMarca[cat][marca].add(modelo);
  });

  listasCache = {
    combinacoes,
    categorias: Array.from(categorias).sort(),
    marcasPorCategoria,
    modelosPorCategoriaMarca,
  };

  return listasCache;
}

export function getListasCache() {
  return listasCache;
}

export function getCategorias() {
  return listasCache?.categorias || [];
}

export function getMarcas(categoria) {
  if (!categoria || !listasCache) return [];
  return Array.from(listasCache.marcasPorCategoria[categoria] || []).sort();
}

export function getModelos(categoria, marca) {
  if (!categoria || !marca || !listasCache) return [];
  return Array.from(listasCache.modelosPorCategoriaMarca[categoria]?.[marca] || []).sort();
}

/* ============================================================================
   SELECT POPULATION
   ============================================================================ */

const OUTRO_VALUE = '__outro__';

function getSelect(prefixo, tipo) {
  return document.getElementById(`${prefixo}-${tipo}`);
}

function getOutroContainer(prefixo, tipo) {
  return document.getElementById(`${prefixo}-outro-${tipo}-container`);
}

function getOutroInput(prefixo, tipo) {
  return document.getElementById(`${prefixo}-outro-${tipo}`);
}

function initSelect(select, options, currentValue, includeOutro = true) {
  if (!select) return;
  const hasOutro = currentValue && !options.includes(currentValue);
  select.innerHTML = '<option value="" disabled selected>Selecione</option>' +
    options.map(o => `<option value="${o}">${o}</option>`).join('') +
    (includeOutro ? `<option value="${OUTRO_VALUE}">Outro (digitar)</option>` : '');
  
  if (hasOutro) {
    select.value = OUTRO_VALUE;
    showOutro(select.id.replace(`-${select.id.split('-').pop()}`, ''), select.id.split('-').pop());
    const input = getOutroInput(...select.id.split('-').slice(0, -1), select.id.split('-').pop());
    if (input) input.value = currentValue;
  } else if (options.includes(currentValue)) {
    select.value = currentValue;
    hideOutro(...select.id.split('-').slice(0, -1), select.id.split('-').pop());
  } else {
    select.value = '';
    hideOutro(...select.id.split('-').slice(0, -1), select.id.split('-').pop());
  }
  
  if (window.M && M.FormSelect) M.FormSelect.init(select);
}

export function preencherSelectCategoria(prefixo, currentValue = '') {
  if (!listasCache) return;
  const select = getSelect(prefixo, 'categoria');
  if (!select) return;
  initSelect(select, listasCache.categorias, currentValue);
  
  // Auto-popula marcas se houver valor válido
  if (select.value && select.value !== OUTRO_VALUE) {
    popularMarcas(prefixo, select.value);
  } else {
    limparMarcaModelo(prefixo);
  }
}

export function popularMarcas(prefixo, categoria) {
  const selectMarca = getSelect(prefixo, 'marca');
  if (!selectMarca || !listasCache) return;

  const marcas = getMarcas(categoria);
  const currentValue = selectMarca.value;
  
  initSelect(selectMarca, marcas, currentValue);
  
  if (selectMarca.value && selectMarca.value !== OUTRO_VALUE) {
    popularModelos(prefixo, categoria, selectMarca.value);
  } else {
    limparModelo(prefixo);
  }
}

export function popularModelos(prefixo, categoria, marca) {
  const selectModelo = getSelect(prefixo, 'modelo');
  if (!selectModelo || !listasCache) return;

  const modelos = getModelos(categoria, marca);
  const currentValue = selectModelo.value;
  
  initSelect(selectModelo, modelos, currentValue);
}

export function limparMarcaModelo(prefixo) {
  const selectMarca = getSelect(prefixo, 'marca');
  if (selectMarca) {
    selectMarca.innerHTML = '<option value="" disabled selected>Selecione a categoria</option>';
    if (window.M && M.FormSelect) M.FormSelect.init(selectMarca);
  }
  limparModelo(prefixo);
  hideOutro(prefixo, 'marca');
  hideOutro(prefixo, 'modelo');
}

export function limparModelo(prefixo) {
  const selectModelo = getSelect(prefixo, 'modelo');
  if (selectModelo) {
    selectModelo.innerHTML = '<option value="" disabled selected>Selecione a marca</option>';
    if (window.M && M.FormSelect) M.FormSelect.init(selectModelo);
  }
  hideOutro(prefixo, 'modelo');
}

/* ============================================================================
   OUTRO FIELD HANDLING
   ============================================================================ */

function getPrefixoFromSelectId(selectId) {
  // selectId = "new-categoria" -> prefixo = "new"
  return selectId.split('-')[0];
}

function getTipoFromSelectId(selectId) {
  // selectId = "new-categoria" -> tipo = "categoria"
  return selectId.split('-')[1];
}

export function showOutro(prefixo, tipo) {
  const container = getOutroContainer(prefixo, tipo);
  if (container) container.style.display = 'block';
  const input = getOutroInput(prefixo, tipo);
  if (input) input.focus();
}

export function hideOutro(prefixo, tipo) {
  const container = getOutroContainer(prefixo, tipo);
  if (container) container.style.display = 'none';
  const input = getOutroInput(prefixo, tipo);
  if (input) input.value = '';
}

export function toggleOutro(prefixo, tipo) {
  const select = getSelect(prefixo, tipo);
  if (!select) return;
  if (select.value === OUTRO_VALUE) {
    showOutro(prefixo, tipo);
  } else {
    hideOutro(prefixo, tipo);
  }
}

export function getValorFinal(prefixo, tipo) {
  const select = getSelect(prefixo, tipo);
  if (!select) return '';
  if (select.value === OUTRO_VALUE) {
    const input = getOutroInput(prefixo, tipo);
    return input ? input.value.trim() : '';
  }
  return select.value;
}

/* ============================================================================
   SETUP EVENT LISTENERS (chamar uma vez por prefixo)
   ============================================================================ */

export function setupSelectCascata(prefixo, onModeloChange) {
  const selectCat = getSelect(prefixo, 'categoria');
  const selectMarca = getSelect(prefixo, 'marca');
  const selectModelo = getSelect(prefixo, 'modelo');

  if (selectCat) {
    selectCat.addEventListener('change', () => {
      toggleOutro(prefixo, 'categoria');
      if (selectCat.value && selectCat.value !== OUTRO_VALUE) {
        popularMarcas(prefixo, selectCat.value);
      } else {
        limparMarcaModelo(prefixo);
      }
    });
  }

  if (selectMarca) {
    selectMarca.addEventListener('change', () => {
      toggleOutro(prefixo, 'marca');
      const selectCat = getSelect(prefixo, 'categoria');
      if (selectMarca.value && selectMarca.value !== OUTRO_VALUE && selectCat?.value && selectCat.value !== OUTRO_VALUE) {
        popularModelos(prefixo, selectCat.value, selectMarca.value);
      } else {
        limparModelo(prefixo);
      }
    });
  }

  if (selectModelo) {
    selectModelo.addEventListener('change', () => {
      toggleOutro(prefixo, 'modelo');
      if (selectModelo.value && selectModelo.value !== OUTRO_VALUE) {
        preencherEspecificacoesModelo(prefixo, selectModelo.value);
        if (onModeloChange) onModeloChange(selectModelo.value);
      }
    });
  }
}