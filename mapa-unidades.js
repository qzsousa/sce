/**
 * Mapa de correcao: nome que o SCE gravou -> nome oficial da lista-mestra.
 *
 * POR QUE ISTO EXISTE
 * A lista-mestra do backend de chamados (NOMES_PADRONIZADOS) e a fonte da
 * verdade, mas o SCE gravou nomes encurtados que o casamento tolerante nao
 * atravessa, porque ele exige chave igual, e nao contencao:
 *
 *   SCE:     "Francisco De Assis Pires Correa Prof"   (344 equipamentos)
 *   mestras: "E.E. FRANCISCO DE ASSIS P. CORRÊA"
 *
 * "PIRES CORREA" != "P CORREA", entao ficam separadas. Sem este mapa, importar
 * a lista-mestra criaria DUAS linhas para a mesma escola — o problema que o
 * trabalho anterior acabou de eliminar.
 *
 * O matcher estrito foi mantido de proposito: foi ele que impediu
 * "E.E. JOAO SILVA" de absorver "E.E. JOAO SILVA SOBRINHO". Abreviatura e
 * nome proprio sao caso de negocio, nao de regra, por isso ficam aqui, com nome
 * e numero, revisaveis.
 *
 * `null` = deliberately NAO padronizar (ver comentario na linha).
 */
export const CORRECOES = {
  // --- abreviacao / truncamento: mesma escola, outra escrita ---
  'Candido Procopio Ferreira De Camargo Prof': 'E.E. CÂNDIDO PROCÓPIO F. CAMARGO',
  'Conjunto Habitacional Itaquera IV': 'E.E. COHAB ITAQUERA IV',
  'Ernestina Del Buono Trama Profa': 'E.E. ERNESTINA DEL B. TRAMA',
  'Escritor Juan Onetti': 'E.E. JUAN CARLOS ONETTI',
  'Fernando Mauro Pires Da Rocha Deputado': 'E.E. FERNANDO MAURO P. ROCHA, DEPUTADO',
  'Francisco De Assis Pires Correa Prof': 'E.E. FRANCISCO DE ASSIS P. CORRÊA',
  'Maria Antonieta Ferraz Bibliot': 'E.E. MARIA ANTONIETA FERRAZ BIBLIOTECARIA',
  'Sebastiao Faria Zimbres Prof': 'E.E. SEBASTIÃO FARIAS ZIMBRES',
  'Sergio Estanislau Camargo': 'E.E. SERGIO ESTANISTLAU DE CAMARGO',
  'Zipora Rubinstein Profa': 'E.E. ZÍPORA RUBISTEIN',

  // --- vira o PREDIO inteiro: a escola-irma entra na mesma unidade ---
  'Claudia Dutra Viana': 'E.E. CLAUDIA DUTRA VIANA / ROSA PARKS',
  'Decio Ferraz Alvim Prof Dr': 'E.E. DÉCIO FERRAZ ALVIM / FLORIANO PEIXOTO',
  'Geraldino Dos Santos Deputado': 'E.E. GERALDINO DOS SANTOS, DEPUTADO / JOSUÉ DE CASTRO',
  'Marcos Antonio Costa Prof': 'E.E. MARCOS ANTONIO COSTA / HERBERT JOSÉ DE SOUZA - BETINHO',
  'Maria De Lourdes Aranha De Assis Pacheco Profa': 'E.E. MARIA DE LOURDES A. A. PACHECO / CHIQUINHA GONZAGA',

  // --- divergencia que precisa de decisao humana ---
  // A lista-mestra escreve "SCHIRAIBER"; o SCE grava "Schraiber". A master
  // parece ter erro de digitacao, mas NAO presumimos: mantemos o nome do
  // chamado, que e onde a pessoa se cadastrou. Se a lista-mestra for corrigida
  // la, este override passa a ser a entrada que evita a duplicata.
  'Isaac Schraiber Prof': 'E.E. ISAAC SCHRAIBER',
  // "LUIS" na master x "LUIZ" no SCE: o nome correto do escritor e Luiz.
  'Luiz Vaz De Camoes': 'E.E. LUIZ VAZ DE CAMÕES',

  // --- nao e escola: e a sede regional ---
  // 2 equipamentos (Notebook Acer, TV LG), sem serie e sem patrimonio, com
  // unidade "LESTE 3" / "LESTE 3 " (uma das grafias tem espaco sobrando). A
  // lista-mestra so tem escolas, entao a URE nao entra no plano automatico.
  // Adotamos "URE Leste 3", que e o nome que os usuarios dessa unidade ja
  // carregam em usuarios.filial — assim o acesso continua valendo e o
  // equipamento para de ser orfao no filtro.
  'LESTE 3': 'URE Leste 3',
};
