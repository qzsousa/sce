# Legado — Google Apps Script

Estado e plano de desligamento da primeira versão do SCE.

## O que era

Stack original do SCE, inteira no Google Workspace:

- **`Code.js`** (~2.700 linhas): backend Apps Script.
  - `doGet` como roteador: sem token → template `Login`; com sessão válida → `DashboardMatriz` / `DashboardTecnico` / `DashboardFilial` conforme o nível.
  - **Login por OTP**: `requestOtp`/`validateOtp` — código de 6 dígitos por e-mail (`MailApp`), validade 10 min, códigos na aba `Otp_Codes`.
  - **Banco de dados**: 3 planilhas Google — `CORE` (Equipamentos, Listas, Filiais), `MOVIMENTACAO` (Historico_Itens, Emprestimos, Auditoria, Registros_Manutencao), `AUTENTICACAO` (Usuarios, Sessoes, Otp_Codes) — acessadas via Sheets Advanced Service com retry.
  - Sessões de 24h na aba `Sessoes` (uuid), com `LockService` para concorrência.
  - Anexos de B.O. e termos de empréstimo em PDF gravados no **Drive** (pastas `PDF_FOLDER_ID` / `BO_FOLDER_ID`).
  - Recursos de depuração: `?paginaTeste=Perfil`, `?dev=1&profile=...` (sessões mock), `?debugValidate=...`, `testarEmail`, `testDriveAccess`.
- **Frontend legado**: `Login.html`, `DashboardMatriz.html`, `DashboardFilial.html`, `DashboardTecnico.html`, `Shared.html` — templates GAS chamando o backend via `google.script.run.*`.
- **Deploy**: `clasp` (`.clasp.json` aponta o `scriptId`; webapp `ANYONE_ANONYMOUS`, `executeAs: USER_DEPLOYING`).

## Para onde foi

| Peça legada | Substituto atual |
|---|---|
| Sheets (3 planilhas) | Supabase Postgres (`supabase_schema.sql`), migrado por `migrate.js` |
| OTP por e-mail | Senha no Supabase Auth (+ primeiro acesso) |
| Anexos no Drive | Supabase Storage, bucket `anexos` |
| `google.script.run` | API REST Express (`server.js`) |
| Templates GAS | Front Vite (`src/` → `dist/`) na Vercel |

Scripts de apoio já executados: `migrate.js` (dados), `diagnostico-migracao.js` e `find-duplicados.js` (conferência da base da unidade SUMIE e duplicidades). `database/*.xlsx` são backups das planilhas. `googleSheetsService.js` (camada Node sobre Sheets) **não é mais importado por nada**.

## Riscos de manter o legado no repo

- `.claspignore` libera `**/*.js` → qualquer `clasp push` envia `server.js`, `api.js`, `migrate.js`, `diagnostico-migracao.js`, `find-duplicados.js` ao projeto Apps Script (poluição; IDs e código expostos no editor do script).
- IDs de planilhas e pastas do Drive ficam hardcoded em `Code.js` e `.env.example`.
- Endpoints de debug do GAS (`paginaTeste`, `dev=1`, `debugValidate`) criam sessões sem credencial — **se o webapp ainda estiver publicado, é uma porta aberta**.
- Confusão de manutenção: duas implementações das mesmas regras (GAS e Node) divergindo (ex.: patrimônio obrigatório no GAS × opcional no Node).

## Critérios para desligar

1. Confirmar que a URL do webapp GAS não recebe mais tráfego (logs de execução do Apps Script) e que ninguém usa os links antigos.
2. Garantir que os dados migrados estão íntegros no Supabase (já há backups em `database/*.xlsx`).
3. Suspender a publicação do webapp no Apps Script (Deploy → Manage deployments → Archive).
4. Remover do repositório: `Code.js`, `Login.html`, `Dashboard*.html`, `Shared.html`, `.clasp.json`, `.claspignore`, `appsscript.json`, `googleSheetsService.js`, `api.js`, `migrate.js`, `diagnostico-migracao.js`, `find-duplicados.js`, `database/`.
5. Remover variáveis `GOOGLE_*` e `SPREADSHEET_*` do `.env` local e da Render.
6. Atualizar `README.md` e `MANUAL_DEPLOY.md` (remover seções de Sheets/OTP).

Sugestão de trilha: executar como **Etapa 9** do [plano de refatoração](./plano-refatoracao.md), depois das etapas de segurança.
