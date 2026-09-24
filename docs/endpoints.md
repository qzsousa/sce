# Referência de endpoints — API SCE (`server.js`)

Formato de resposta padrão: `{ success: boolean, data: any, error: string|null }`.
Erros de negócio voltam com HTTP 200 e `success:false`; erros de sessão/permissão e exceções caem no error handler → HTTP 500.

Autenticação: token de sessão (uuid em `sessoes`, 24h) ou JWT do portal (SSO). Aceito via **header `Authorization: Bearer <token>`** ou **query `?token=`** (ambos; o código dá preferência ao que encontrar primeiro).

Perfis: `Matriz` (global), `AdminFilial`/`Filial` (escopo da unidade), `Tecnico` (lista de unidades).

## Auth / usuários

| Método | Rota | Acesso | Descrição / notas |
|---|---|---|---|
| POST | `/api/login-password` | público | `{email, password}` → Supabase Auth; cria sessão; retorna `{token, redirectUrl}` |
| POST | `/api/verificar-usuario` | público | `{email}` → `{existe, senhaDefinida, nome, nivel}` ⚠️ enumeração |
| POST | `/api/definir-senha` | público | `{email, password}` (mín. 6); só se `senha_definida=false`; faz upsert no Auth e loga ⚠️ sem fator adicional |
| POST | `/api/redefinir-senha` | Matriz, AdminFilial | `{email, novaSenha}`; AdminFilial só na própria filial |
| POST | `/api/internal/sync-usuario` | chave `x-sync-key` | Upsert vindo do portal; mapa ADMIN/GESTOR/TECNICO/VISUALIZADOR |
| GET | `/api/get-nome-usuario` | autenticado | `{nome, nivel, filial, email}` da sessão |
| GET | `/api/listar-usuarios` | Matriz, AdminFilial | AdminFilial vê só a própria filial |
| POST | `/api/adicionar-usuario` | Matriz, AdminFilial | AdminFilial cria apenas `Filial` na própria unidade (máx. 2 além do admin); aceita `senhaTemporaria` |
| POST | `/api/atualizar-usuario` | Matriz, AdminFilial | `{emailOriginal, ...}`; só Matriz altera nivel/filial/status |
| POST | `/api/remover-usuario` | Matriz, AdminFilial | Soft-delete (`status='Removido'`, `data_remocao`) |

## Listas / catálogo / auditoria

| Método | Rota | Acesso | Descrição / notas |
|---|---|---|---|
| GET | `/api/listas-cadastro` | autenticado | Combinações categoria/marca/modelo |
| POST | `/api/listas-adicionar` | Matriz | Com dedup manual ⚠️ duplicado com `/api/listas/adicionar` |
| POST | `/api/listas-remover` | Matriz | Por `id` ou combinação ⚠️ duplicado com `/api/listas/remover` |
| POST | `/api/listas/adicionar` | Matriz | Upsert com `onConflict` |
| POST | `/api/listas/remover` | Matriz | Por `id` ou combinação exata |
| GET | `/api/catalogo-equipamentos` | autenticado | União do catálogo (`listas`) + o que existe no parque |
| GET | `/api/auditoria` | Matriz | `?limite` (1–200, default 50) |

## Equipamentos

| Método | Rota | Acesso | Descrição / notas |
|---|---|---|---|
| GET | `/api/equipamentos-da-filial` | autenticado | Todos do escopo (filtragem em memória) |
| GET | `/api/unidades-resumo` | autenticado | KPIs por unidade ⚠️ **registrada 2× (linhas 771 e 886)**; a 2ª nunca executa |
| GET | `/api/equipamentos-global` | Matriz | `limite` (1–500, default 100), `offset`, `busca`, `status`, `unidade`, `categoria`, `marca`, `modelo`, `ordem`, `direcao` + `stats` |
| POST | `/api/create-equipamento` | autenticado (escopo) | Série ou justificativa obrigatória; dedup patrimônio/série; `Extraviado` exige `_anexoBoletim` |
| POST | `/api/update-equipamento` | autenticado (escopo) | `{id, ...campos}`; histórico por campo ⚠️ bug camel×snake (ver `riscos-e-melhorias.md`) |
| POST | `/api/clone-equipamento` | autenticado (escopo) | ⚠️ **quebrado** (lógica de array de planilha sobre resultado de objetos) |
| POST | `/api/remover-equipamento` | Matriz, AdminFilial | Soft-delete |
| POST | `/api/atualizar-status-manutencao` | autenticado (escopo) | `{equipamentoId, novoStatus}` ∈ Pendente/Em andamento/Concluído |
| GET | `/api/anexo-url` | autenticado | `?path=` → URL assinada (1h) ⚠️ sem checar unidade do dono |
| GET | `/api/especificacoes-modelo` | autenticado | `?modelo=` → últimas specs cadastradas daquele modelo |

## Manutenção / histórico / empréstimos

| Método | Rota | Acesso | Descrição / notas |
|---|---|---|---|
| GET | `/api/registros-manutencao` | autenticado | `?equipamentoId=` ⚠️ sem checagem de unidade (IDOR) |
| POST | `/api/registrar-manutencao` | autenticado | `{equipamentoId, descricao, status}`; espelha status no equipamento ⚠️ sem checagem de unidade |
| GET | `/api/historico-equipamento` | autenticado | `?equipamentoId=` ⚠️ sem checagem de unidade (IDOR) |
| GET | `/api/filiais-para-emprestimo` | autenticado | Filiais ativas (dropdown) |
| POST | `/api/registrar-emprestimo` | autenticado | `{ids[], responsavel, cpf?, emailResponsavel?, dataPrevistaDevolucao?, tipoEmprestimo, escolaDestino?, observacoes?}` ⚠️ sem checagem de unidade; falhas por item são silenciosas |
| POST | `/api/registrar-devolucao` | autenticado | `{ids[], observacao?}` ⚠️ idem |

## Export / diagnóstico / infra

| Método | Rota | Acesso | Descrição / notas |
|---|---|---|---|
| GET | `/api/exportar-csv` | autenticado (escopo) | Retorna JSON `{csv, fileName}` |
| POST | `/api/exportar-pdf` | autenticado (escopo) | Stream PDF (pdfkit) ⚠️ `req.body` (filtros) é ignorado |
| GET | `/api/testar-planilha` | **público** | Diagnóstico ⚠️ expõe cabeçalho e 1ª linha de `equipamentos` |
| GET | `/api/testar-leitura-equipamentos` | **público** | Diagnóstico ⚠️ expõe 3 registros completos |
| GET | `/api/tecnico-unidades` | Tecnico | Lista de unidades da sessão |
| GET | `/health` | público | `{status:'ok', timestamp}` |
| GET | `*` | — | Estáticos de `dist/` + fallback SPA (`index.html`) |

## Endpoints citados no passado, mas inexistentes

`POST /api/request-otp` e `POST /api/validate-otp` — referenciados pelo cliente legado `api.js` (raiz) e pela collection do `MANUAL_DEPLOY.md`, mas **não existem** no `server.js` (o login atual é por senha). Não há endpoint de **logout** (o front apenas limpa o `localStorage`).
