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
| POST | `/api/internal/sync-usuario` | chave `x-sync-key` | Upsert vindo do portal; mapa ADMIN/GESTOR/TECNICO/VISUALIZADOR; recebe `papelUnidade` (MAE/FILHA) — ver `migracao-papel-mae-filha.md` |
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

Escola **FILHA** (`papelUnidade='FILHA'` — a irmã que divide o prédio) é somente
leitura: todas as rotas POST de escrita abaixo recusam com
`{success:false, error}` quando a sessão é de FILHA. Mãe/técnico/matriz seguem
normais — ver `migracao-papel-mae-filha.md`.

| Método | Rota | Acesso | Descrição / notas |
|---|---|---|---|
| GET | `/api/equipamentos-da-filial` | autenticado | Todos do escopo (filtragem em memória); `unidade` sai no nome oficial |
| GET | `/api/unidades-resumo` | autenticado | KPIs por unidade, chaveado pelo nome oficial; ⚠️ **registrada 2× (linhas 771 e 886)**; a 2ª nunca executa |
| GET | `/api/equipamentos-global` | Matriz | `limite` (1–500, default 100), `offset`, `busca`, `status`, `unidade`, `categoria`, `marca`, `modelo`, `ordem`, `direcao` + `stats`. `unidade` e os agregados usam o nome oficial (ver *Nomes de unidade*) |
| POST | `/api/create-equipamento` | autenticado (escopo) | Série ou justificativa obrigatória; dedup patrimônio/série; `unidade` gravada no nome oficial; `Extraviado` exige `_anexoBoletim` |
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
| GET | `/api/filiais-para-emprestimo` | autenticado | Nomes oficiais de `filiais` (dropdown de empréstimo entre escolas) |
| GET | `/health` | público | `{status:'ok', timestamp}` |
| GET | `*` | — | Estáticos de `dist/` + fallback SPA (`index.html`) |

## Nomes de unidade (o filtro de escolas)

`equipamentos.unidade` é **TEXT livre**, não FK para `filiais(nome)`. A mesma
escola nasceu com grafias diferentes — "E.E. HAYDEÉ HIDALGO" (do cadastro de
chamados) e "Haydee Hidalgo Profa" (legado) — e como o filtro e os agregados
agrupavam pela string exata, a escola aparecia duplicada na lista de unidades.

`filiais.nome` é a lista oficial. `criarIndiceUnidades` (em `supabaseService.js`)
resolve qualquer grafia para ela, com normalização que ignora acentos,
pontuação, o prefixo "E.E.", honoríficos do fim ("… Professora") e as partes do
composto de irmãs "E.E. A / E.E. B".

O servidor usa isso em três lugares:

- **Leitura**: `/equipamentos-global` e `/equipamentos-da-filial` devolvem
  `unidade` já no nome oficial, e `stats.porUnidade` agrupa pela chave oficial —
  é daí que o portal tira a lista do filtro.
- **Filtro**: `?unidade=` resolve para **todas** as grafias da escola e consulta
  com `in(...)`, então filtrar pela escola traz o parque inteiro (e o `total`
  confere), mesmo antes de a migração rodar.
- **Escrita**: `create-equipamento` e `update-equipamento` gravam o oficial.

Dois matchers, de propósito:

| Função | Regra | Uso |
|---|---|---|
| `unidadesCasam` | containment por palavra | **só** controle de acesso — errar para mais é seguro |
| `mesmaEscola` | interseção exata de chaves | canonicalização — "E.E. JOAO SILVA" ≠ "E.E. JOAO SILVA SOBRINHO" |

A lista oficial é gerenciada com dois scripts na raiz (o primeiro **precisa**
rodar antes do segundo):

```bash
node filiais-sincronizar.js    # relatório: quais escolas têm nome duplicado
node filiais-sincronizar.js --aplicar   # grava os oficiais em filiais
node unidades-unificar.js      # relatório do que será reescrito
node unidades-unificar.js --aplicar     # reescreve equipamentos.unidade
```

Ambos são **relatório por padrão** e só gravam com `--aplicar`. Nome já
cadastrado em `filiais` sempre tem prioridade — para corrigir um oficial
inferido, cadastre o nome certo em `filiais` antes de aplicar.

## Endpoints citados no passado, mas inexistentes

`POST /api/request-otp` e `POST /api/validate-otp` — referenciados pelo cliente legado `api.js` (raiz) e pela collection do `MANUAL_DEPLOY.md`, mas **não existem** no `server.js` (o login atual é por senha). Não há endpoint de **logout** (o front apenas limpa o `localStorage`).
