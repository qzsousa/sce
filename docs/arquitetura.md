# Arquitetura — SCE

## 1. Visão geral

O repositório contém **três sistemas convivendo**:

| # | Sistema | Stack | Status |
|---|---------|-------|--------|
| A | Backend legado | Google Apps Script (`Code.js` + `appsscript.json`), banco = 3 Google Sheets, OTP por e-mail (`MailApp`), anexos no Drive | Legado (migrado; ver `legado-apps-script.md`) |
| B | Frontend legado | `Login.html`, `DashboardMatriz/Filial/Tecnico.html`, `Shared.html` via `google.script.run` | Legado, pareado com A |
| C | Stack atual | Frontend Vite multi-page (`src/` → `dist/`) na Vercel → API Express (`server.js`) na Render → Supabase (Postgres + Auth + Storage) | **Ativa** |

## 2. Diagrama da arquitetura atual

```
                        ┌─────────────────────────────────────────────┐
                        │  Portal de Chamados (sistema externo)       │
                        │  - emite access token JWT (SSO_SECRET)      │
                        │  - sincroniza usuários (SCE_SYNC_KEY)       │
                        └───────┬───────────────────────┬─────────────┘
                                │ JWT                   │ x-sync-key
┌──────────┐  HTTPS  ┌──────────▼───────────────────────▼────────────┐
│ Browser  │ ──────► │  Vercel — front estático (build Vite: dist/)  │
│          │         │  rewrite /api/* → sce-nyjc.onrender.com       │
└────┬─────┘         └──────────┬────────────────────────────────────┘
     │  token (query + Bearer)  │
     └──────────────────────────▼───────────────────────────────────┐
                    API Express (server.js, na Render)               │
                    ├─ supabaseAdmin (service_role → bypass RLS)     │
                    ├─ supabaseAuth  (anon → signInWithPassword)     │
                    ├─ Storage bucket 'anexos' (B.O., signed URL 1h) │
                    └─ sessões próprias na tabela `sessoes` (uuid)   │
                                 │
                    ┌────────────▼─────────────┐
                    │  Supabase (PostgreSQL)   │
                    │  equipamentos, usuarios, │
                    │  sessoes, listas,        │
                    │  filiais, emprestimos,   │
                    │  historico_itens,        │
                    │  registros_manutencao,   │
                    │  auditoria, otp_codes*   │
                    └──────────────────────────┘

* otp_codes existe no schema, mas a API atual usa email/senha (não OTP).
```

Deploy: a Vercel hospeda o front e faz rewrite de `/api/*` para a Render. O `server.js` **também** serve `dist/` estaticamente com fallback SPA, ou seja, a Render poderia servir o sistema inteiro sozinha.

## 3. Responsabilidade por arquivo/pasta

### Backend atual (raiz)

| Arquivo | Responsabilidade |
|---|---|
| `server.js` (~1.600 linhas) | Toda a API Express: auth (senha + SSO), sessões, usuários, equipamentos, listas, empréstimos, manutenção, histórico, export CSV/PDF, anexos, sync com portal, arquivos estáticos |
| `supabaseService.js` | Camada de dados Supabase com API "compatível" com o antigo serviço de planilhas (mapa aba⇄tabela, `toCamelCase`/`toSnakeCase`, helpers de escopo por unidade). Exporta além do que o `server.js` usa (há exports mortos: `createSession`, `validateSession`, `cleanupExpiredSessions`, `findUsuarioByEmail`… o server define versões próprias) |
| `googleSheetsService.js` | **Código morto** — nada importa este arquivo |
| `api.js` (raiz) | Cliente HTTP legado pré-Vite (`window.*` + `module.exports`). Chama `/request-otp` e `/validate-otp`, que **não existem** no `server.js` → obsoleto |
| `migrate.js` | One-shot Google Sheets → Supabase (já executado) |
| `diagnostico-migracao.js`, `find-duplicados.js` | Scripts de conferência da migração |
| `package.json` | Deps misturam backend, build (vite) e migração (googleapis) |

### Frontend atual (`src/`, build → `dist/`)

| Arquivo | Responsabilidade |
|---|---|
| `src/index.html`, `public/index.html` | Redirect para `/login` |
| `src/login.html` + `src/login.js` | Login email/senha + primeiro acesso (definir senha) + fundo animado |
| `src/pages/matriz.{html,js}` | Dashboard Matriz: visão global, KPIs/gráficos, gestão de usuários, catálogo, auditoria, ações em lote |
| `src/pages/filial.{html,js}` | Dashboard Filial/AdminFilial: equipamentos da unidade, empréstimos, gestão de usuários da escola |
| `src/pages/tecnico.{html,js}` | Dashboard Técnico: múltiplas unidades |
| `src/pages/dashboard-base.js` (~800 linhas) | CRUD de equipamentos, modais, histórico, manutenção, export — compartilhado pelas 3 páginas |
| `src/shared/js/api.js` | Cliente HTTP (todas as chamadas `/api/*`) |
| `src/shared/js/auth.js` | Token em `localStorage` (`sce_token` = JSON `{token, expiresAt}`, 24h) |
| `src/shared/js/lists.js` | Cascata categoria→marca→modelo (fonte: tabela `listas`) |
| `src/shared/js/catalogo-modelos.js` | Catálogo embutido só para autopreencher especificações |
| `src/shared/js/ui.js` / `utils.js` | Toasts/loading/CSV/modais; formatação/validators |
| `src/shared/js/dev-panel.js` | Painel de simulação de perfil (dev) |
| `src/shared/css/*` | Estilos (Materialize via CDN + CSS próprio) |

### Legado Apps Script

| Arquivo | Responsabilidade |
|---|---|
| `Code.js` (~2.700 linhas) | Backend GAS completo: `doGet` (roteia Login/Dashboards), OTP por e-mail, sessões na aba `Sessoes`, CRUD equivalente ao novo, termo de empréstimo em PDF no Drive |
| `Login.html`, `Dashboard*.html`, `Shared.html` | Templates GAS (~373 KB juntos) |
| `.clasp.json` / `.claspignore` / `appsscript.json` | Deploy clasp. Atenção: `.claspignore` libera `**/*.js` → `server.js`, `api.js` etc. são empurrados ao projeto GAS |

### Demais

- `supabase_schema.sql` — schema de referência (enums, RLS, triggers, seeds).
- `database/*.xlsx` — backups locais das planilhas.
- `MANUAL_DEPLOY.md` — manual (parcialmente desatualizado: cita OTP e `googleSheetsService.js`; embute um SQL mais antigo que `supabase_schema.sql`).
- `test.json` — credencial de teste local (gitignored).

## 4. Fluxos principais

### 4.1 Login email/senha
1. Front (`login.js`): ao digitar o e-mail, chama `POST /api/verificar-usuario` (debounce) para saber se existe e se já tem senha.
2. `POST /api/login-password` → `supabaseAuth.auth.signInWithPassword` → valida usuário ativo em `usuarios` → cria sessão (uuid, 24h) na tabela `sessoes` → devolve `{ token, redirectUrl }`.
3. Front guarda o token em `localStorage` e redireciona ao dashboard do nível.

### 4.2 Primeiro acesso / senha
- Usuário com `senha_definida = false` → `POST /api/definir-senha` → cria/atualiza o usuário no **Supabase Auth via admin** → marca `senha_definida=true` → já devolve sessão.
- Redefinição: `POST /api/redefinir-senha` (Matriz ou AdminFilial da mesma filial).

### 4.3 SSO vindo do Portal de Chamados
- O front envia o access token JWT do portal no lugar do token de sessão.
- `validateSession` não acha na tabela `sessoes` → tenta `trySsoSession`: valida a assinatura (`SSO_SECRET`), exige `type=access` e `email`, resolve nível/filial na tabela local `usuarios`.

### 4.4 Sync de usuários (portal → SCE)
- `POST /api/internal/sync-usuario` com header `x-sync-key` → upsert em `usuarios`.
- Mapa de níveis: `ADMIN→Matriz`, `GESTOR→AdminFilial`, `TECNICO→Tecnico`, `VISUALIZADOR→Filial`.

### 4.5 CRUD de equipamentos
- **Create**: resolve unidade por escopo (`resolverUnidadeParaEscrita`), exige série ou justificativa, checa duplicidade de patrimônio/série (scan em memória), `Extraviado` exige anexo B.O., grava + histórico + auditoria.
- **Update**: busca equipamento, checa escopo por unidade, valida regras por status (`Manutenção`→`numeroChamadoManutencao`, `Extraviado`→`boletimOcorrencia`, `Em verificação`→`justificativaVerificacao`, `Quebrado`→`descricaoQuebrado`), grava diff + histórico por campo.
- **Delete**: soft-delete (`status='Removido'`), restrito a Matriz/AdminFilial.

### 4.6 Anexo de Boletim de Ocorrência
- Upload: base64 no payload (máx. 8 MB) → Storage bucket `anexos` (`boletins/<uuid>-<nome>.<ext>`) → path salvo em `boletim_ocorrencia_anexo_url`.
- Leitura: `GET /api/anexo-url?path=...` → URL assinada válida por 1h.

### 4.7 Empréstimo / devolução
- `POST /api/registrar-emprestimo`: para cada `id`, insere em `emprestimos` (status `Emprestado`) e seta `equipamentos.status='Emprestado'`. Tipos: `interno` ou `interestadual` (exige `escolaDestino`).
- `POST /api/registrar-devolucao`: localiza empréstimo aberto, fecha (status `Devolvido`), equipamento volta a `Disponível`.

### 4.8 Manutenção
- `registros_manutencao` por equipamento + espelho do status em `equipamentos.status_manutencao` (`Pendente`/`Em andamento`/`Concluído`).

### 4.9 Listagens e export
- Filial/Técnico: `GET /api/equipamentos-da-filial` (varredura paginada em blocos de 1000, filtragem por escopo em memória).
- Matriz: `GET /api/equipamentos-global` (paginação/filtros/ordenação no Postgres + agregados por status/unidade/categoria/**modelo** em blocos). O agregado por modelo é o que o PORTAL abre no clique do gráfico de categorias: sem ele o portal teria de baixar a lista inteira (MB) só para contar, e contar requisição a requisição não fecharia — a ordenação é por `modelo`, coluna que se repete milhares de vezes, então o mesmo equipamento volta em duas páginas e outros nunca aparecem.
- Export: `GET /api/exportar-csv` (JSON com CSV) e `POST /api/exportar-pdf` (stream pdfkit, A4 paisagem).

### 4.10 Catálogo (listas)
- Cascata categoria→marca→modelo vem da tabela `listas` (gerenciada pela Matriz). `GET /api/catalogo-equipamentos` une o catálogo com o que existe de fato no parque.
