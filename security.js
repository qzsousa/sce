import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { sessaoTemAcessoAUnidade } from './supabaseService.js';

// ============================================================
// CABEÇALHOS DE SEGURANÇA (helmet em modo API)
// ============================================================

/**
 * `helmet` em modo API.
 *
 * A configuração padrão do helmet pressupõe servir HTML e envia
 * `Content-Security-Policy` com `default-src 'self'`, que quebra o
 * frontend. Aqui a CSP é `default-src 'none'` (a API só devolve JSON) e o
 * resto dos cabeçalhos (HSTS, nosniff, referrer policy, frame options)
 * fica no padrão.
 */
export const securityHeaders = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginResourcePolicy: { policy: 'same-site' },
};

// ============================================================
// CORS
// ============================================================

/**
 * Origens liberadas para o SCE.
 *
 * `app.use(cors())` sem argumento liberava QUALQUER origem. Como as rotas
 * aceitavam o token por `?token=`, qualquer página da internet conseguia
 * chamar a API com a sessão de um usuário e ler a resposta.
 *
 * Três fontes, deliberadamente:
 *  - `FRONTEND_URL`       → o front-end do SCE já em produção
 *  - `EXTRA_CORS_ORIGINS` → origens adicionais (o PORTAL, por exemplo),
 *                           separadas por vírgula
 *  - hosts fixos          → front-ends conhecidos do SCE
 *
 * A transição exige as duas coisas ao mesmo tempo, então trocar
 * `FRONTEND_URL` não é opção — daí a variável separada em vez de sobrescrever
 * a principal. `FRONTEND_URL` continua a ser usada — e só ela — no redirect
 * de pós-login (`criarSessaoLogin`), que deve apontar para o painel do SCE,
 * não para o portal.
 */
export function corsOptions() {
  const normalizar = (o) => String(o || '').trim().replace(/\/+$/, '').toLowerCase();

  const permitidas = new Set(
    [
      process.env.FRONTEND_URL,
      // Origens extras (o portal, previews de deploy, etc.).
      ...String(process.env.EXTRA_CORS_ORIGINS || '').split(','),
      'https://sce-ebon.vercel.app',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5173',
    ]
      .map(normalizar)
      .filter(Boolean),
  );

  return {
    origin(origin, callback) {
      // Sem `Origin` = curl / app nativo / mesma origem. Permitido.
      if (!origin) return callback(null, true);
      if (permitidas.has(normalizar(origin))) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    maxAge: 600,
  };
}

// ============================================================
// RATE LIMIT
// ============================================================

const ehTeste = process.env.NODE_ENV === 'test';

function limiter({ windowMs, max, mensagem }) {
  if (ehTeste) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, data: null, error: mensagem },
  });
}

/** Teto geral da API. */
export const limiteGeral = limiter({
  windowMs: 60 * 1000,
  max: 300,
  mensagem: 'Muitas requisições. Aguarde um instante.',
});

/**
 * Teto das rotas de credencial.
 *
 * O SCE não tinha rate limiting nenhum: `/api/login-password`,
 * `/api/definir-senha` e `/api/redefinir-senha` davam brute force ilimitado
 * contra o Supabase Auth.
 */
export const limiteAuth = limiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  mensagem: 'Muitas tentativas. Aguarde 15 minutos.',
});

/** Teto das escritas (criar/editar/remover equipamento, empréstimo). */
export const limiteEscrita = limiter({
  windowMs: 60 * 1000,
  max: 60,
  mensagem: 'Muitas alterações em pouco tempo. Aguarde um minuto.',
});

// ============================================================
// ERROS HTTP
// ============================================================

/**
 * Erro com status HTTP.
 *
 * `requireSession` lançava `new Error(...)`, que caía no handler final como
 * 500 — toda sessão inválida ou permissão negada virava "erro do servidor".
 * Isso quebra o cliente (que não distingue "faça login de novo" de "a API
 * caiu"), polui o monitoramento e, com a mensagem genérica de produção,
 * escondia o motivo real.
 */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.expose = true;
  }
}

export const naoAutorizado = (msg = 'Sessão inválida ou expirada. Faça login novamente.') =>
  new HttpError(401, msg);

export const negado = (msg = 'Você não tem permissão para executar esta ação.') =>
  new HttpError(403, msg);

// ============================================================
// TOKEN
// ============================================================

/**
 * Extrai o token da requisição.
 *
 * O header `Authorization: Bearer` é a via oficial. O `?token=` na query era
 * o fallback legado e vazava o token em log de acesso, cabeçalho `Referer`,
 * histórico do navegador e cache de proxy — por isso só é aceito fora de
 * produção.
 */
export function extrairToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }

  const viaQuery = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (viaQuery) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[seguranca] token via query string rejeitado — use o header Authorization');
      return null;
    }
    console.warn('[seguranca] token via query string (legado, somente dev) — migre para o header');
    return viaQuery;
  }

  return null;
}

/**
 * Valida o JWT do portal fixando o algoritmo.
 *
 * Sem `algorithms`, o `jsonwebtoken` aceita qualquer alg da família HMAC.
 */
export function verificarTokenPortal(token) {
  const segredo = process.env.SSO_SECRET;
  if (!segredo) return null;
  try {
    return jwt.verify(token, segredo, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

// ============================================================
// SENHA
// ============================================================

/**
 * Política de senha.
 *
 * O SCE aceitava 6 caracteres sem nenhuma exigência de classe, e
 * `/api/definir-senha` não exigia prova de posse do e-mail.
 */
export const politicaSenha = {
  minLength: 8,
  maxLength: 72, // bcrypt trunca em 72 bytes
  validar(senha) {
    const erros = [];
    const s = String(senha || '');

    if (s.length < this.minLength) erros.push(`A senha deve ter pelo menos ${this.minLength} caracteres.`);
    if (s.length > this.maxLength) erros.push('A senha é longa demais.');
    if (!/[a-z]/.test(s)) erros.push('Inclua ao menos uma letra minúscula.');
    if (!/[A-Z]/.test(s)) erros.push('Inclua ao menos uma letra maiúscula.');
    if (!/[0-9]/.test(s)) erros.push('Inclua ao menos um número.');

    return { valida: erros.length === 0, erros };
  },
};

// ============================================================
// AUTORIZAÇÃO POR UNIDADE
// ============================================================

/**
 * Garante que a sessão pode operar no equipamento informado.
 *
 * Várias rotas do SCE aceitavam um `equipamentoId`/`ids` do cliente e nunca
 * conferiam a unidade do equipamento — qualquer usuário autenticado lia o
 * histórico de qualquer escola e criavastrapOS de empréstimo (com CPF e
 * e-mail) em equipamento alheio.
 */
export async function exigirAcessoAEquipamento(session, equipamentoId) {
  const { data, error } = await supabaseEquipamento(equipamentoId);
  if (error || !data) return { ok: false, motivo: 'Equipamento não encontrado.' };
  if (!sessaoTemAcessoAUnidade(session, data.unidade)) {
    return { ok: false, motivo: 'Você não tem permissão para acessar este equipamento.' };
  }
  return { ok: true, equipamento: data };
}

// Wrapper injetável: evita import circular com supabaseService.
let _selectEquipamento = null;
export function registrarLeitorEquipamento(fn) {
  _selectEquipamento = fn;
}
async function supabaseEquipamento(id) {
  if (!_selectEquipamento) return { data: null, error: { message: 'leitor não registrado' } };
  return _selectEquipamento(id);
}

// ============================================================
// UPLOAD DE ANEXO
// ============================================================

/** Tipos aceitos para o Boletim de Ocorrência. */
export const TIPOS_ANEXO_BOE = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Magic bytes — o `Content-Type` do cliente é declarado, não confiável. */
const ASSINATURAS = [
  { bytes: [0x25, 0x50, 0x44, 0x46], tipo: 'application/pdf' },        // %PDF
  { bytes: [0xff, 0xd8, 0xff], tipo: 'image/jpeg' },                     // JPEG
  { bytes: [0x89, 0x50, 0x4e, 0x47], tipo: 'image/png' },                // PNG
];

function assinaturaDe(buf) {
  for (const { bytes, tipo } of ASSINATURAS) {
    if (buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b)) return tipo;
  }
  return null;
}

/**
 * Valida o anexo do Boletim de Ocorrência.
 *
 * Antes o upload aceitava qualquer `mimeType` e qualquer extensão do nome do
 * arquivo. Um HTML/SVG com script armazenado e servido por URL assinada
 * virava XSS armazenado quando alguém abria o anexo.
 */
export function validarAnexoBoletim(base64) {
  let buf;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    return { ok: false, erro: 'Anexo inválido.' };
  }

  if (!buf.length) return { ok: false, erro: 'Anexo vazio.' };
  if (buf.length > 8 * 1024 * 1024) {
    return { ok: false, erro: 'Arquivo muito grande. O tamanho máximo é de 8MB.' };
  }

  const tipoReal = assinaturaDe(buf);
  if (!tipoReal || !TIPOS_ANEXO_BOE[tipoReal]) {
    return {
      ok: false,
      erro: 'Formato não aceito. Envie PDF, JPG, PNG ou WEBP.',
    };
  }

  return { ok: true, buffer: buf, extensao: TIPOS_ANEXO_BOE[tipoReal], mimeType: tipoReal };
}

/** Prefixo único do bucket. Só anexos de B.O. podem ter URL assinada. */
export const PREFIXO_ANEXOS_BOE = 'boletins/';

/**
 * Normaliza e valida o caminho de um anexo do B.O.
 *
 * `/api/anexo-url` recebia o `path` direto do cliente e gerava uma URL
 * assinada de QUALQUER objeto do bucket `anexos` — inclusive o boletim de
 * outra escola. Exigir o prefixo e recusar traversal fecha o acesso.
 */
export function normalizarCaminhoAnexo(path) {
  const bruto = String(path || '').trim();
  if (!bruto) return null;

  const normalizado = bruto.replace(/\\/g, '/').replace(/^\/+/, '');

  if (normalizado.includes('..') || normalizado.includes('\0')) return null;
  if (!normalizado.startsWith(PREFIXO_ANEXOS_BOE)) return null;
  if (normalizado.length > 400) return null;
  // Só o formato gerado por `uploadAnexoBoletim`: boletins/<uuid>-<nome>.<ext>
  if (!/^boletins\/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}\.(pdf|jpg|png|webp)$/.test(normalizado)) return null;

  return normalizado;
}

// ============================================================
// FILTRO POSTGREST
// ============================================================

/**
 * Escapa um valor para uso dentro de um filtro PostgREST (`.or(...)`).
 *
 * A busca era interpolada crua: `busca = "x,unidade.eq.EscolaSecreta"`
 * injetava um filtro novo e trazia equipamentos de outra escola.
 */
export function escaparFiltroPostgrest(valor) {
  return String(valor)
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/\./g, '\\.')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[*"']/g, '');
}

/** Token aleatório opaco (não é usado como segredo). */
export function tokenOpaque() {
  return crypto.randomBytes(32).toString('hex');
}
