# Variáveis de ambiente — SCE

Arquivos: `.env` (local, gitignored) e `.env.example` (template). Em produção, as variáveis ficam no painel do serviço na **Render**.

## Em uso pela stack atual

| Variável | Onde é lida | Obrigatória | Função |
|---|---|---|---|
| `SUPABASE_URL` | `server.js`, `supabaseService.js`, scripts de migração | sim | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabaseService.js`, migração | sim | Cliente admin (bypass RLS). **Nunca expor no front** |
| `SUPABASE_ANON_KEY` | `server.js` (`supabaseAuth`) | sim | Login por senha (`signInWithPassword`) |
| `SSO_SECRET` | `server.js` | para SSO | Segredo compartilhado com o Portal de Chamados (= `JWT_SECRET` de lá). Valida access tokens JWT (claim `type=access`, `email`) |
| `SCE_SYNC_KEY` | `server.js` | para sync | Chave do header `x-sync-key` em `POST /api/internal/sync-usuario` |
| `FRONTEND_URL` | `server.js` (`criarSessaoLogin`) | não | Base do redirect pós-login. ⚠️ Ausente no `.env` local — cai no default hardcoded `https://sce-ebon.vercel.app` |
| `PORT` | `server.js` | não | Porta da API. `.env` local: `3000`; default no código: `3001`; proxy do Vite mira `3000` (inconsistência conhecida) |
| `NODE_ENV` | `server.js` (log) | não | `development` / `production` |

## Só migração/legado (candidatas a remoção)

| Variável | Onde é lida |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `googleSheetsService.js` (morto), `migrate.js`, `diagnostico-migracao.js`, `find-duplicados.js` |
| `GOOGLE_PRIVATE_KEY` | idem |
| `GOOGLE_PROJECT_ID` | idem |
| `SPREADSHEET_CORE_ID` | idem (também hardcoded em `Code.js`) |
| `SPREADSHEET_MOVIMENTACAO_ID` | idem |
| `SPREADSHEET_AUTENTICACAO_ID` | idem |

## Definida mas não utilizada

| Variável | Observação |
|---|---|
| `APP_URL` | Só aparece em `.env.example`/`MANUAL_DEPLOY.md`; nenhum código lê |

## Front-end

O front **não** usa variáveis em build-time. A URL da API é resolvida em runtime por `getApiBaseUrl()` (`src/shared/js/api.js`), nesta ordem:

1. `process.env.API_BASE_URL` (só existe no cliente legado morto `api.js`);
2. `window.ENV.API_BASE_URL`;
3. meta tag `<meta name="api-base-url" content="...">` (presente nos HTMLs com `/api`);
4. fallback `/api`.

Em produção, `/api` é reescrito pela Vercel para a Render (`vercel.json`). Em dev, o Vite proxifica `/api` → `http://localhost:3000` (`vite.config.js`).

## Boas práticas pendentes

- Validar presença das variáveis críticas no boot (fail fast) — hoje só `supabaseService.js` valida as suas; `server.js` aceita subir sem `SSO_SECRET`/`SCE_SYNC_KEY` (silenciosamente desativa recursos).
- `.env` real contém secrets — nunca commitar (já coberto pelo `.gitignore`).
