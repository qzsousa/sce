# SCE — Sistema de Controle de Equipamentos

Sistema web de **inventário e controle de equipamentos de TI** das escolas da **URE Leste 3** (Diretoria de Ensino – Região Leste 3, São Paulo/SP). O SCE registra o parque de equipamentos de cada unidade escolar (notebooks, desktops, celulares, tablets, impressoras, projetores etc.) e gerencia o ciclo de vida de cada item: cadastro, movimentação entre status, manutenção, empréstimo a responsáveis, extravio (com Boletim de Ocorrência anexado) e baixa lógica.

Cada equipamento guarda patrimônio, número de série, categoria/marca/modelo, especificações técnicas (SO, processador, memória, armazenamento, tela), unidade (escola), responsável, histórico de alterações campo a campo e trilha de auditoria das ações dos usuários.

---

## Perfis de acesso

| Perfil | Escopo | O que faz |
|---|---|---|
| **Matriz** | Global | Visão de todas as unidades, dashboard com KPIs/gráficos, gestão de usuários, gestão do catálogo (categoria/marca/modelo), auditoria, remoção de equipamentos |
| **AdminFilial** | Sua escola | Tudo do perfil Filial + gerencia até 2 usuários da própria escola, redefine senhas da escola, remove equipamentos |
| **Filial** | Sua escola | CRUD de equipamentos da unidade, manutenção, empréstimos e devoluções, exportações |
| **Tecnico** | Várias escolas (lista em `filial`, separada por vírgula) | Mesmas operações de inventário, restritas às unidades que atende |

---

## Principais funcionalidades

- **Login por e-mail e senha** (Supabase Auth), com fluxo de **primeiro acesso** (criação de senha) e **redefinição** pela Matriz/AdminFilial.
- **SSO com o Portal de Chamados**: tokens JWT emitidos pelo portal são aceitos (segredo compartilhado `SSO_SECRET`); usuários são sincronizados via endpoint interno protegido por `SCE_SYNC_KEY`.
- **Cadastro de equipamentos** com verificação de duplicidade de patrimônio/número de série, campos obrigatórios por status e cascata categoria → marca → modelo gerenciada no banco (com preenchimento automático de especificações).
- **Status do equipamento**: `Disponível`, `Manutenção`, `Emprestado`, `Extraviado`, `Inservível`, `Em verificação`, `Quebrado`, `Removido` (soft-delete).
- **Status de manutenção** (trilha própria): `Pendente`, `Em andamento`, `Concluído`, com registros de ocorrências por equipamento.
- **Anexo de Boletim de Ocorrência** (obrigatório para `Extraviado`): upload em base64 (máx. 8 MB) para bucket privado do Supabase Storage; visualização por URL assinada temporária (1h).
- **Empréstimos**: interno ou inter-escolar (`tipoEmprestimo`, `escolaDestino`), com responsável, CPF, datas prevista/efetiva e devolução.
- **Histórico por campo** de cada equipamento + **auditoria** de ações (login, CRUD, sync).
- **Exportação** em CSV (JSON) e PDF (relatório A4 paisagem, gerado no servidor).
- **Dashboards** por perfil com KPIs, filtros, busca, paginação e gráficos (Matriz).

---

## Arquitetura atual

```
Navegador (front estático, build Vite)
   │  Vercel: sce-ebon.vercel.app
   │  rewrite /api/* ──────────────────────────┐
   ▼                                            ▼
                                       API Express (server.js)
                                       Render: sce-nyjc.onrender.com
                                       │ usa Supabase com service_role
                                       ▼
                              Supabase (PostgreSQL)
                              ├─ tabelas: equipamentos, usuarios, sessoes,
                              │   listas, filiais, emprestimos,
                              │   historico_itens, registros_manutencao,
                              │   auditoria (otp_codes: legado)
                              ├─ Supabase Auth (senhas dos usuários)
                              └─ Storage bucket "anexos" (B.O.s, privado)

Portal de Chamados (sistema externo)
   ├─ emite JWT de acesso ──► aceito pela API (SSO_SECRET)
   └─ chama POST /api/internal/sync-usuario (header x-sync-key)
```

Em produção, o próprio `server.js` também serve o conteúdo de `dist/` (deploy monolito possível na Render); a Vercel é a porta de entrada principal via rewrites.

---

## Estrutura do repositório

```
sce/
├── server.js               # API Express completa (backend atual)
├── supabaseService.js      # Camada de dados Supabase + helpers de permissão/escopo
├── supabase_schema.sql     # Schema de referência (tabelas, enums, RLS, seeds)
├── vite.config.js          # Build multi-página do front (dev proxy /api → :3000)
├── vercel.json             # Deploy do front (rewrite /api → Render)
├── package.json            # Dependências e scripts (back + front + migração)
│
├── src/                    # FRONTEND ATUAL (Vite, multi-page)
│   ├── index.html          # Redirect para /login
│   ├── login.html / login.js
│   ├── pages/              # matriz, filial, tecnico (.html + .js) + dashboard-base.js
│   └── shared/             # js/ (api, auth, lists, ui, utils, dev-panel, catalogo) e css/
├── public/                 # Estáticos copiados para dist
├── dist/                   # Build do front (gerado; gitignored)
│
├── docs/                   # Documentação detalhada (ver docs/README.md)
├── MANUAL_DEPLOY.md        # Manual de configuração/deploy (Supabase + Render)
├── database/               # Backups .xlsx das planilhas antigas
│
│   ── Scripts de migração (one-shot, já executados) ──
├── migrate.js              # Google Sheets → Supabase
├── diagnostico-migracao.js / find-duplicados.js
│
│   ── LEGADO: Google Apps Script (em desativação) ──
├── Code.js                 # Backend GAS antigo (planilhas + OTP por e-mail)
├── Login.html, Dashboard*.html, Shared.html  # Front antigo (google.script.run)
├── googleSheetsService.js  # Serviço Sheets em Node (não é mais importado)
├── api.js                  # Cliente HTTP antigo (endpoints de OTP já removidos)
├── .clasp.json / .claspignore / appsscript.json
│
├── .env / .env.example     # Variáveis de ambiente (ver seção abaixo)
└── test.json               # Credencial de teste local (gitignored)
```

---

## Como rodar localmente

Pré-requisito: Node.js 18+.

```bash
npm install
cp .env.example .env   # e preencha as variáveis (ver tabela abaixo)
npm run dev            # sobe API (watch) + Vite em paralelo
```

- Front-end (Vite): <http://localhost:5173> — `/api` é proxado para a API.
- API (Express): <http://localhost:3000> (conforme `PORT` no `.env`; o default do código é `3001`).
- Health check: `GET /health`.

```bash
npm run build          # gera dist/ (front)
npm start              # sobe a API servindo dist/ (modo produção local)
```

---

## Variáveis de ambiente

| Variável | Obrigatória | Uso |
|---|---|---|
| `SUPABASE_URL` | sim | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | Backend (bypass RLS — **nunca expor no front**) |
| `SUPABASE_ANON_KEY` | sim | Login por senha (`signInWithPassword`) |
| `SSO_SECRET` | para SSO | Mesmo `JWT_SECRET` do backend do Portal de Chamados |
| `SCE_SYNC_KEY` | para sync | Chave do endpoint `/api/internal/sync-usuario` |
| `FRONTEND_URL` | não | Base de redirect pós-login (default embutido no código) |
| `PORT` | não | Porta da API (`.env` local usa `3000`; default do código `3001`) |
| `NODE_ENV` | não | `development`/`production` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_PROJECT_ID` | só migração/legado | Acesso às planilhas antigas |
| `SPREADSHEET_CORE_ID`, `SPREADSHEET_MOVIMENTACAO_ID`, `SPREADSHEET_AUTENTICACAO_ID` | só migração/legado | IDs das 3 planilhas antigas |

O front não usa variáveis em build-time: a URL da API é resolvida por meta tag `api-base-url` (com fallback para `/api`).

---

## Banco de dados

O schema completo (enums, tabelas, índices únicos parciais de patrimônio/série, triggers e seeds de filiais/listas) está em [`supabase_schema.sql`](./supabase_schema.sql). As policies de RLS descritas no SQL existem como referência/defesa em profundidade, mas hoje a API usa `service_role` (bypass RLS) — o controle de escopo por unidade é aplicado no código do `server.js`.

---

## Deploy

- **Front-end**: Vercel (`vercel.json`: build `npx vite build`, saída `dist/`, rewrite `/api/*` → API na Render).
- **Back-end**: Render (Web Service, `npm install` + `npm start`).
- Passo a passo completo (Supabase, Render, keep-alive, migração, checklist): [MANUAL_DEPLOY.md](./MANUAL_DEPLOY.md).

---

## Legado (Google Apps Script)

A primeira versão do SCE rodava inteira no Google Apps Script: `Code.js` (backend com OTP por e-mail e Google Sheets como banco, em 3 planilhas: Core, Movimentação, Autenticação) + `Login.html`/`Dashboard*.html`/`Shared.html` (front via `google.script.run`). Os dados foram migrados para o Supabase com `migrate.js`, e os scripts `diagnostico-migracao.js`/`find-duplicados.js` serviram para conferência. Esses arquivos são mantidos no repositório apenas como referência histórica até a desativação definitiva.

---

## Documentação adicional

- [docs/](./docs/README.md) — documentação técnica detalhada (arquitetura, endpoints, análise de riscos, plano de refatoração).
- [MANUAL_DEPLOY.md](./MANUAL_DEPLOY.md) — manual operacional de configuração e deploy.
