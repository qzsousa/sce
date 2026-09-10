// ============================================================================
// CATÁLOGO DE MODELOS — Especificações padronizadas por categoria/marca/modelo
// Usado para a cascata de categoria → marca → modelo e autopreenchimento de
// sistema operacional, processador, memória RAM e armazenamento.
// ============================================================================

export const CATALOGO_MODELOS = [
  { categoria: 'Notebook', marca: 'Lenovo', modelo: 'ThinkPad L14 Gen 2', sistemaOperacional: 'Windows 10 / Windows 11', processador: 'i5-1135G7', memoriaRAM: '16 GB DDR4', armazenamento: 'SSD M.2 256 GB' },
  { categoria: 'Notebook', marca: 'Positivo', modelo: 'Master N1110', sistemaOperacional: 'Windows 10', processador: 'Intel Celeron ou Pentium', memoriaRAM: '4 GB DDR4', armazenamento: 'SSD eMMC 32 GB' },
  { categoria: 'Notebook', marca: 'Positivo', modelo: 'Master N1210', sistemaOperacional: 'Windows 10', processador: 'QuadCore', memoriaRAM: '8 GB', armazenamento: '128 GB' },
  { categoria: 'Notebook', marca: 'Multilaser', modelo: 'PC114', sistemaOperacional: 'Windows 10', processador: 'Intel N4020', memoriaRAM: '4 GB', armazenamento: 'eMMC 64 GB' },
  { categoria: 'Notebook', marca: 'Multilaser', modelo: 'Ultra UL150', sistemaOperacional: 'Windows 11 / Windows 10', processador: 'i3-1005g1', memoriaRAM: '8 GB DDR4', armazenamento: 'SSD 256 GB' },
  { categoria: 'Notebook', marca: 'Samsung', modelo: 'Chromebook', sistemaOperacional: 'ChromeOS', processador: 'Intel® Celeron® Processor N4020', memoriaRAM: '4 GB LPDDR4', armazenamento: 'eMMC 32 GB' },
  { categoria: 'Desktop', marca: 'Diebold', modelo: 'TW9850', sistemaOperacional: '', processador: '', memoriaRAM: '', armazenamento: '' },
  { categoria: 'Desktop', marca: 'Lenovo', modelo: 'ThinkCentre M75S-2', sistemaOperacional: 'Windows 11 / Windows 10', processador: 'AMD Ryzen 5 PRO 4650G', memoriaRAM: '8 GB DDR4', armazenamento: 'SSD M.2 256 GB' },
  { categoria: 'Desktop', marca: 'Lenovo', modelo: 'ThinkCentre', sistemaOperacional: 'Windows 11 / Windows 10', processador: 'AMD Ryzen 5 PRO 3400 G', memoriaRAM: '8 GB DDR4', armazenamento: 'SSD M.2 256 GB' },
  { categoria: 'Plataforma de Carregamento', marca: 'TES', modelo: 'K2X - 40V', sistemaOperacional: '', processador: '', memoriaRAM: '', armazenamento: '' },
  { categoria: 'Plataforma de Carregamento', marca: 'TES', modelo: 'K4CG - 40V', sistemaOperacional: '', processador: '', memoriaRAM: '', armazenamento: '' },
  { categoria: 'Celular', marca: 'Redmi', modelo: '12', sistemaOperacional: 'Android 13, MIUI 14', processador: 'MediaTek Helio G88', memoriaRAM: '4GB ou 8GB', armazenamento: '128GB ou 256GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: '12C', sistemaOperacional: 'Android 12, MIUI 13', processador: 'MediaTek Helio G85', memoriaRAM: '3GB, 4GB ou 6GB', armazenamento: '32GB, 64GB ou 128GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: '13C', sistemaOperacional: 'Android 13, MIUI 14', processador: 'MediaTek Helio G85', memoriaRAM: '4GB, 6GB ou 8GB', armazenamento: '128GB ou 256GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: '9C', sistemaOperacional: 'Android 10', processador: 'MediaTek Helio G35', memoriaRAM: '2GB ou 3GB', armazenamento: '32GB ou 64GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: 'A1', sistemaOperacional: 'Android 12 Go Edition', processador: 'MediaTek Helio A22', memoriaRAM: '2GB ou 3GB', armazenamento: '32GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: 'A1 +', sistemaOperacional: 'Android 12 Go Edition', processador: 'MediaTek Helio A22', memoriaRAM: '2GB ou 3GB', armazenamento: '32GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: 'A3', sistemaOperacional: 'Android 13', processador: 'MediaTek Helio G36', memoriaRAM: '3GB, 4GB ou 6GB', armazenamento: '64GB ou 128GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: 'Note 11S', sistemaOperacional: 'Android 11', processador: 'MediaTek Helio G96', memoriaRAM: '6GB ou 8GB', armazenamento: '64GB ou 128GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: 'Note 11', sistemaOperacional: 'Android 11', processador: 'Qualcomm Snapdragon 680', memoriaRAM: '4GB ou 6GB', armazenamento: '64GB ou 128GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: 'Note 11 Pro', sistemaOperacional: 'Android 11, MIUI 13', processador: 'MediaTek Helio G96 ou Snapdragon 695 5G', memoriaRAM: '6GB ou 8GB', armazenamento: '64GB ou 128GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: 'Note 12', sistemaOperacional: 'Android 12', processador: 'Snapdragon 685', memoriaRAM: '4GB, 6GB ou 8GB', armazenamento: '128GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: 'Note 12 Pro', sistemaOperacional: 'Android 12', processador: 'MediaTek Dimensity 1080', memoriaRAM: '6GB ou 8GB', armazenamento: '128GB ou 256GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: 'Note 12S', sistemaOperacional: 'Android 13', processador: 'MediaTek Helio G96', memoriaRAM: '6GB ou 8GB', armazenamento: '128GB ou 256GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: 'Note 13', sistemaOperacional: 'Android 13', processador: 'MediaTek Dimensity 6080', memoriaRAM: '6GB ou 8GB', armazenamento: '128GB ou 256GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: 'Note 13 PRO', sistemaOperacional: 'Android 13', processador: 'MediaTek Helio G99-Ultra ou Snapdragon 7s Gen 2', memoriaRAM: '8GB ou 12GB', armazenamento: '256GB ou 512GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: 'Note 14', sistemaOperacional: 'Android 14 com HyperOS', processador: 'MediaTek Helio G99-Ultra', memoriaRAM: '6GB ou 8GB', armazenamento: '128GB ou 256GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: 'Note 9', sistemaOperacional: 'Android 10, MIUI 11', processador: 'MediaTek Helio G85', memoriaRAM: '3GB ou 4GB', armazenamento: '64GB ou 128GB' },
  { categoria: 'Celular', marca: 'Redmi', modelo: 'Note 8', sistemaOperacional: 'Android 9 Pie', processador: 'Qualcomm Snapdragon 665', memoriaRAM: '4GB', armazenamento: '128GB' },
  { categoria: 'Celular', marca: 'Motorola', modelo: 'G13', sistemaOperacional: 'Android 13', processador: 'MediaTek Helio G85', memoriaRAM: '4GB', armazenamento: '128GB' },
  { categoria: 'Celular', marca: 'Xiaomi', modelo: 'Poco C65', sistemaOperacional: 'Android 13', processador: 'MediaTek Helio G85', memoriaRAM: '6GB ou 8GB', armazenamento: '128GB ou 256GB' },
  { categoria: 'Celular', marca: 'Xiaomi', modelo: 'Poco M3 PRO', sistemaOperacional: 'Android 11, MIUI 12', processador: 'MediaTek Dimensity 700', memoriaRAM: '4GB ou 6GB', armazenamento: '64GB ou 128GB' },
  { categoria: 'Celular', marca: 'Xiaomi', modelo: 'Poco M5', sistemaOperacional: 'Android 12', processador: 'MediaTek Helio G99', memoriaRAM: '4GB ou 6GB', armazenamento: '64GB ou 128GB' },
  { categoria: 'Celular', marca: 'Xiaomi', modelo: 'Poco M6 PRO', sistemaOperacional: 'Android 13', processador: 'MediaTek Helio G99-Ultra', memoriaRAM: '8GB ou 12GB', armazenamento: '256GB ou 512GB' },
  { categoria: 'Celular', marca: 'Xiaomi', modelo: 'Poco X5', sistemaOperacional: 'Android 12', processador: 'Qualcomm Snapdragon 695 5G', memoriaRAM: '6GB ou 8GB', armazenamento: '128GB ou 256GB' },
  { categoria: 'Celular', marca: 'Realme', modelo: 'C51', sistemaOperacional: 'Android 13, Realme UI T', processador: 'Unisoc Tiger T612', memoriaRAM: '4GB ou 8GB', armazenamento: '64GB ou 128GB' },
  { categoria: 'Celular', marca: 'Realme', modelo: 'C61', sistemaOperacional: 'Android 14, Realme UI 5.0', processador: 'Unisoc Tiger T612', memoriaRAM: '6GB', armazenamento: '128GB' },
  { categoria: 'Celular', marca: 'Realme', modelo: 'Note 50', sistemaOperacional: 'Android 13', processador: 'Unisoc T612', memoriaRAM: '4GB', armazenamento: '64GB ou 128GB' },
  { categoria: 'Celular', marca: 'Multilaser', modelo: 'G2', sistemaOperacional: 'Android', processador: 'Quad Core', memoriaRAM: '2 GB', armazenamento: '32 GB' },
  { categoria: 'Tablet', marca: 'Positivo', modelo: 'T2040', sistemaOperacional: 'Android', processador: 'OCTA-CORE', memoriaRAM: '2 GB', armazenamento: '32 GB' },
  { categoria: 'Tablet', marca: 'Positivo', modelo: 'T2070', sistemaOperacional: 'Android', processador: 'OCTA-CORE', memoriaRAM: '4 GB', armazenamento: '64 GB' },
];

// Retorna as especificações de um modelo (ou null se não encontrado)
export function getEspecificacoesPorModelo(modelo) {
  if (!modelo) return null;
  const item = CATALOGO_MODELOS.find(i => i.modelo === modelo);
  if (!item) return null;
  return {
    sistemaOperacional: item.sistemaOperacional || '',
    processador: item.processador || '',
    memoriaRAM: item.memoriaRAM || '',
    armazenamento: item.armazenamento || '',
  };
}

// Preenche os campos de especificação no DOM com base no modelo selecionado
export function preencherEspecificacoesModelo(prefixo, modelo) {
  const specs = getEspecificacoesPorModelo(modelo);
  if (!specs) return false;
  const campos = {
    sistemaOperacional: specs.sistemaOperacional,
    processador: specs.processador,
    memoriaRAM: specs.memoriaRAM,
    armazenamento: specs.armazenamento,
  };
  Object.entries(campos).forEach(([campo, valor]) => {
    const el = document.getElementById(`${prefixo}-${campo}`);
    if (el && valor) el.value = valor;
  });
  if (window.M && typeof M.updateTextFields === 'function') M.updateTextFields();
  return true;
}

// Retorna as combinações de categoria/marca/modelo no formato esperado por setListasCache
export function getCombinacoesDoCatalogo() {
  return CATALOGO_MODELOS.map(({ categoria, marca, modelo }) => ({ categoria, marca, modelo }));
}