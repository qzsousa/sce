# Chaves primárias não-padrão — escrevendo SQL no SCE

> Origem: warning `column sessoes.id does not exist` ao pedir queries ao chat/IA
> do Supabase. O **banco está correto** — o que falha é a query, que assume o
> padrão `id` das outras tabelas. **Não é bug da aplicação.**

---

## O problema

Das 11 tabelas do schema `public`, **8 usam `id UUID`**. As outras 3 usam chave
natural e **não possuem coluna `id`**:

| tabela | chave primária | como referenciar |
|---|---|---|
| `sessoes` | `token` (UUID) | `sessoes.token` |
| `usuarios` | `email` (TEXT) | `usuarios.email` |
| `otp_codes` | `email` (TEXT) | `otp_codes.email` |

Consultar `id` em qualquer uma delas retorna:

```
ERROR: column sessoes.id does not exist
```

## Por que a IA erra

O `supabase-js` e a maioria dos exemplos de Supabase assumem `id`. Em `sessoes`,
`usuarios` e `otp_codes` o identificador natural já é a PK — e em `usuarios`
**o próprio e-mail é o "id" do usuário**, então `SELECT ... FROM usuarios` não
tem nenhum campo identificador além de `email`.

---

## Tabelas com `id` (comportamento padrão)

`auditoria`, `emprestimos`, `equipamentos`, `filiais`, `historico_itens`,
`listas`, `registros_manutencao`.

---

## Como escrever a query certa

```sql
-- ERRADO (3 tabelas)
SELECT * FROM sessoes  WHERE id    = '...';
SELECT * FROM usuarios WHERE id    = '...';
SELECT * FROM otp_codes WHERE id   = '...';

-- CERTO
SELECT * FROM sessoes   WHERE token = '...';
SELECT * FROM usuarios  WHERE email = 'alguem@edu.sp.gov.br';
SELECT * FROM otp_codes WHERE email = 'alguem@edu.sp.gov.br';
```

### Sessões ativas por filial

```sql
SELECT token, email, nivel, filial, expira_em
FROM   sessoes
WHERE  expira_em > now()
ORDER  BY criado_em DESC;
```

###JOIN de sessão com usuário

```sql
SELECT s.token, s.nivel, s.expira_em, u.nome, u.filial AS filial_usuario
FROM   sessoes s
JOIN   usuarios u ON u.email = s.email   -- join por email, não por id
WHERE  s.expira_em > now();
```

###JOIN de equipamento com histórico

Aqui `id` **existe** (é o padrão):

```sql
SELECT e.id, e.patrimonio, e.unidade, h.campo, h.valor_antigo, h.valor_novo, h.data
FROM   equipamentos e
JOIN   historico_itens h ON h.equipamento_id = e.id
ORDER  BY h.data DESC;
```

### Sessões de um usuário específico

```sql
SELECT * FROM sessoes WHERE email = 'alguem@edu.sp.gov.br';
```

---

## Contexto para colar no chat do Supabase

Cole isso no início de uma conversa nova com o chat/IA do Supabase para evitar o
erro:

> Este projeto (SCE) tem 11 tabelas. Oito usam `id UUID` como chave primária:
> `auditoria`, `emprestimos`, `equipamentos`, `filiais`, `historico_itens`,
> `listas`, `registros_manutencao`.
>
> Três tabelas **não têm coluna `id`** — a PK é uma chave natural:
> `sessoes.token` (UUID), `usuarios.email` (TEXT) e `otp_codes.email` (TEXT).
> Ao escrever qualquer query, JOIN ou ORDER BY nessas três, use `token`/`email`.
> Nunca gere `sessoes.id`, `usuarios.id` nem `otp_codes.id`.

---

## Impacto no código da aplicação

Nenhum. Todo o código já usa as colunas corretas — o warning vem só de queries
escritas à mão / geradas:

| arquivo | linha | uso |
|---|---|---|
| `supabaseService.js` | 500 | `insert` com `token` |
| `supabaseService.js` | 518 | `.eq('token', ...)` em `validateSession` |
| `supabaseService.js` | 538 | delete por `expira_em` |
| `server.js` | 508 | `.eq('token', token)` no logout |
| `sessoes-atualizar-filial.js` | 55 | update por `token` |

---

## Ver o schema real

```bash
# via API do Supabase (service role) — retorna colunas de fato
curl -s "$SUPABASE_URL/rest/v1/" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  | jq '.definitions | keys'

# confirmar que a coluna existe
curl -s "$SUPABASE_URL/rest/v1/sessoes?select=id&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"
# => {"code":"42703","message":"column sessoes.id does not exist"}
```