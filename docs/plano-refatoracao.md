# Plano de refatoração — SCE

Princípios: etapas pequenas, cada uma com testes, sem mudar contratos visíveis ao usuário. Critério de corte de cada etapa: testes novos + suite verde + deploy sem regressão.

Referência dos problemas: [riscos-e-melhorias.md](./riscos-e-melhorias.md).

## Etapa 0 — Harness de testes (pré-requisito)

- Adicionar `vitest` + `supertest` (dev deps) e scripts `npm test` / `npm run test:watch`.
- Mockar `@supabase/supabase-js` (módulo fake em `tests/mocks`) para testar rotas sem banco real.
- **Testes de caracterização** das rotas atuais: auth, escopo por unidade, CRUD de equipamentos, empréstimos — congelam o comportamento antes de mexer.
- CI simples (GitHub Actions) rodando a suite.

## Etapa 1 — Correções isoladas com teste de regressão

Um PR por item (ou um PR com um commit por item):

1. `clone-equipamento` (bug 2.2): reescrever com query por `id` + insert. *Teste:* clona zera patrimônio/série e seta status `Disponível`.
2. `update-equipamento` (bug 2.3): normalizar `equipAtual` com `toCamelCase` uma única vez. *Testes:* histórico guarda valor antigo real; mudança para `Manutenção` não dá falso erro quando `numero_chamado_manutencao` já existe.
3. Remover `unidades-resumo` duplicada (bug 2.1), mantendo a versão completa. *Teste:* shape do resumo por unidade.
4. `getValues` (bug 2.4): ordenar por `criado_em` só quando a coluna existir (mapa por tabela). *Teste* por tabela.
5. Remover ou proteger `testar-*` (risco 1.4) — exigir Matriz ou apagar. *Teste:* 401 sem token.
6. `exportar-pdf` honrando filtros (bug 2.6) ou documentar a limitação. 
7. Unificar `getToken` do front (bug 2.8): `api.js` passa a importar de `auth.js`. *Teste:* reload de página mantém chamadas autenticadas.

## Etapa 2 — Autorização centralizada

- Helper `assertAcessoEquipamento(session, equipamentoId)` (busca unidade do equipamento + `sessaoTemAcessoAUnidade`).
- Aplicar em: `registros-manutencao` (GET), `historico-equipamento` (GET), `registrar-manutencao` (POST), `registrar-emprestimo`, `registrar-devolucao`, `anexo-url` (risco 1.1).
- *Testes:* Filial A não lê/escreve nada da Filial B (403) em todos os seis; Matriz acessa tudo.

## Etapa 3 — Sessões

- `validateSession` com query pontual `eq('token')` (o índice já existe) em vez de full scan; idem `findUsuarioByEmail` (usar a versão pontual do service).
- Novo `POST /api/logout` revogando a sessão; front chama no logout.
- Deprecar token em query string (aceitar só header), com janela de tolerância para links antigos.
- *Testes:* sessão expirada → 401; logout revoga; SSO aceita JWT válido e rejeita inválido/expirado.

## Etapa 4 — Fechar o primeiro acesso

- `definir-senha` passa a exigir **token de convite assinado** (ou OTP por e-mail via Supabase SMTP/Resend) — elimina o takeover do risco 1.2.
- `verificar-usuario` deixa de revelar nome/nível (retorna só o necessário ao fluxo) — risco 1.3.
- *Testes:* fluxo feliz de convite; tentativa sem convite → 403; enumeração não diferencia existente/inexistente.

## Etapa 5 — Split por domínio (sem mudar comportamento)

- `src` do backend: `routes/{auth,usuarios,equipamentos,listas,emprestimos,manutencao,export,diagnostico}.js`, `app.js` (middlewares) e `server.js` (bootstrap) finos.
- Apagar duplicatas: par `listas-*` × `listas/*` (manter um), funções locais × service.
- *Testes:* contrato verde entre etapas (suíte de caracterização da Etapa 0 é a rede de segurança).

## Etapa 6 — Regras em service layer + transações

- Extrair regras: dedup patrimônio/série, regras por status, resolução de unidade.
- Empréstimo/devolução via **função RPC no Postgres** (transacional): tudo ou nada; resposta detalha falhas por item — bug 2.7.
- *Testes:* concorrência básica (dois empréstimos do mesmo item); histórico em lote (1 insert) — item de performance.

## Etapa 7 — Semântica e borda

- Códigos corretos: 400/401/403/404/409; manter envelope `{success,data,error}` por compatibilidade.
- `cors({ origin: FRONTEND_URL })`, `helmet`, rate limit em auth (ex.: `express-rate-limit`), error handler sem vazar stack.
- *Testes:* status codes por cenário.

## Etapa 8 — Performance

- `equipamentos-da-filial` e exports com filtro/paginação **no SQL** (em vez de varrer em memória).
- Histórico com `insert` em lote.
- *Testes:* paginação estável (ordem, limites, totais).

## Etapa 9 — Desligamento do legado

Pré-condição: confirmar que o Apps Script não recebe mais tráfego.

- Remover: `Code.js`, `Login.html`, `Dashboard*.html`, `Shared.html`, `.clasp.json/.claspignore`, `appsscript.json`, `googleSheetsService.js`, `api.js` (raiz), `migrate.js`, `diagnostico-migracao.js`, `find-duplicados.js`, `database/*.xlsx`.
- Remover do `.env`/Render as variáveis `GOOGLE_*` e `SPREADSHEET_*`.
- Atualizar `MANUAL_DEPLOY.md` (sai OTP/Sheets) e o `README.md`.
- Ver detalhes em [legado-apps-script.md](./legado-apps-script.md).

## Etapa 10 — Front (opcional, depois)

- Extrair estado compartilhado dos dashboards; reduzir `window.*`.
- Testes de componente (Vitest + jsdom) e E2E de fluxos críticos (Playwright): login, cadastrar, editar, emprestar, devolver, exportar.

## Dependências entre etapas

```
0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10
 \________ segurança (1–4, 7) é prioritária sobre estrutura (5–6) ________/
```

Sugestão de ordem prática: **0, 1, 2, 4, 3, 7** primeiro (risco de segurança), depois 5–6 (estrutura), 8 (performance conforme volume), 9 (higiene), 10 (front).
