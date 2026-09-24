# Riscos, bugs e code smells — SCE

Levantamento a partir da leitura do código (set/2026). Ordenado por severidade.

## 1. Segurança

### 1.1 IDOR — falta de checagem de unidade em vários endpoints
`requireSession` autentica, mas não verifica se o equipamento pertence ao escopo da sessão:

| Endpoint | Risco |
|---|---|
| `GET /api/registros-manutencao` | Qualquer autenticado lê manutenções de **qualquer** equipamento |
| `GET /api/historico-equipamento` | Idem para histórico |
| `POST /api/registrar-manutencao` | Idem para **escrever** manutenção |
| `POST /api/registrar-emprestimo` / `registrar-devolucao` | Idem para movimentar equipamentos de outras unidades |
| `GET /api/anexo-url` | Gera URL assinada de **qualquer** path do bucket (B.O. é documento sensível) |

Contraste: `update-equipamento`, `remover-equipamento`, `clone-equipamento` checam `sessaoTemAcessoAUnidade` — a proteção é inconsistente.

### 1.2 Possível account takeover no primeiro acesso
`POST /api/definir-senha` é público e só exige `senha_definida=false`. Usuários criados por sync (`/api/internal/sync-usuario`) ou por `adicionar-usuario` nascem assim e ficam **abertos à tomada de conta** por quem souber o e-mail. Não há OTP nem token de convite.

### 1.3 Enumeração de usuários
`POST /api/verificar-usuario` (público) revela existência da conta, **nome e nível** — facilita phishing/engenharia social e mapeamento de alvos para o item 1.2.

### 1.4 Endpoints de diagnóstico abertos
`GET /api/testar-planilha` e `GET /api/testar-leitura-equipamentos` não exigem sessão e devolvem dados reais (cabeçalho + até 3 registros de equipamentos).

### 1.5 Token em query string
Toda a API aceita `?token=...` além do header. Tokens em URL vazam em logs de proxy/servidor, histórico do navegador e referrers. (O front já envia o header `Authorization`; a query é redundante.)

### 1.6 Outros
- `cors()` sem whitelist de origem.
- Sem rate limiting em `login-password`/`definir-senha` (força bruta).
- Sem endpoint de logout — sessão de 24h nunca é revogada no servidor.
- Error handler devolve `err.message` ao cliente (pode vazar detalhes de banco/infra); exceções de sessão saem como HTTP 500 em vez de 401/403.
- **RLS é decorativa na arquitetura atual**: a API usa `service_role` (bypass). As policies de `supabase_schema.sql` (funções `current_user_*`) não são exercidas — a segurança real depende 100% dos `if`s do `server.js` (ver 1.1).
- Credenciais Google (service account com acesso às planilhas antigas) ainda presentes no `.env`.
- `.claspignore` libera `**/*.js` → `server.js`, `api.js`, `migrate.js` etc. são enviados ao projeto Apps Script (poluição; não vaza secrets porque estão no `.env`, mas expõe código e IDs).

## 2. Bugs funcionais

| # | Local | Problema |
|---|---|---|
| 2.1 | `server.js` linhas 771 e 886 | `GET /api/unidades-resumo` **registrada duas vezes** — a segunda versão (com `Promise.all` e checagem `isMatriz`) é dead code |
| 2.2 | `POST /api/clone-equipamento` | **Quebrado**: trata `sheets.getValues('Equipamentos')` como matriz de planilha (`data[0]` = headers, `headers.indexOf`), mas o serviço retorna array de objetos → `TypeError` → 500. Agravante: `getValues` ordena por `criado_em`, coluna que **não existe** em `equipamentos` |
| 2.3 | `POST /api/update-equipamento` | Mistura camel×snake: `equipAtual` vem snake_case do banco, mas as comparações usam camelCase (`equipAtual.numeroSerie`) → valor antigo `undefined` no histórico e validação de campos obrigatórios por status com **falso negativo** quando o campo já existe no banco (ex.: mudar para `Manutenção` sem reenviar `numeroChamadoManutencao` falha mesmo com o campo preenchido) |
| 2.4 | `supabaseService.getValues()` | Ordena por `criado_em` para **qualquer** tabela; `equipamentos`, `historico_itens`, `auditoria`, `registros_manutencao`, `emprestimos` não têm essa coluna → erro "column does not exist" se usados |
| 2.5 | `server.js` `cleanupExpiredSessions` | Nunca chamada **e** bugada (trata objetos como arrays; deletaria por índice numérico em coluna UUID) |
| 2.6 | `POST /api/exportar-pdf` | Ignora `req.body` — os filtros enviados pelo front são perdidos; exporta sempre todo o escopo |
| 2.7 | `registrar-emprestimo` / `registrar-devolucao` | Loop com `continue` silencioso por item + updates não transacionais → resposta `success:true` mesmo com falhas parciais e possível estado inconsistente |
| 2.8 | Front — dois `getToken` | `auth.js` parseia o JSON do `localStorage`; `src/shared/js/api.js` retorna a **string crua** (`{"token":"..."}`) quando `window.SCE_TOKEN` está vazio (após reload) → chamadas sem token explícito quebram a auth |
| 2.9 | `api.js` (raiz) | Chama `/api/request-otp` e `/api/validate-otp`, inexistentes — cliente inteiro obsoleto |

## 3. Code smells / manutenção

- `server.js` com ~1.600 linhas concentrando rotas, regras de negócio, storage, PDF e estáticos; sem camadas, sem testes (repo não tem nenhum teste), sem lint/CI à vista.
- Código morto acumulado: `googleSheetsService.js`, `api.js` (raiz), exports de sessão/OTP de `supabaseService.js`, metade de `Code.js` + HTMLs legados.
- Rotas duplicadas de listas: `/api/listas-adicionar|remover` × `/api/listas/adicionar|remover` (semânticas diferentes).
- Funções duplicadas entre `server.js` e `supabaseService.js` (ex.: `findUsuarioByEmail` local faz **full scan**; a do service faz query pontual).
- Full-table scans frequentes: `validateSession` lê **toda** `sessoes` e `findUsuarioByEmail` **toda** `usuarios` a cada request; `findAuthUserByEmail` lista até 1000 usuários do Auth por chamada; `equipamentos-da-filial`/exports paginam a tabela inteira e filtram em memória.
- Semântica HTTP inexistente: erros de negócio voltam 200 com `success:false`; auth/perm voltam 500.
- Histórico: um `INSERT` por campo alterado, em série (lento em edições grandes).
- `PORT` default 3001 × proxy Vite 3000 × `.env` 3000 — confuso.
- Front: dashboards com ~1.000 linhas e dezenas de `window.*` globais; estado em caches locais divergentes.
- `MANUAL_DEPLOY.md` desatualizado (ensina OTP que não existe mais; SQL embutido diverge de `supabase_schema.sql`).
- IDs de planilhas/pastas Drive hardcoded em `Code.js` e `.env.example`.
