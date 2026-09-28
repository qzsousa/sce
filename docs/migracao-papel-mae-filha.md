# Migração: papel MÃE/FILHA no SCE (usuarios.papel_unidade)

Escolas irmãs (mesmo prédio, ex.: `E.E. A / E.E. B`) compartilham o mesmo painel
de equipamentos no SCE. A partir desta migração, a **escola FILHA** (a segunda do
grupo) tem acesso **somente de visualização**: não cadastra, não edita, não altera
status e não remove equipamentos. A escola **MÃE**, os técnicos e a matriz seguem
sem alteração.

O papel é determinado pelo portal (backend de chamados, que detém a lista-mestra
MÃE/FILHA) e gravado no SCE pelo sync de usuário
(`POST /api/internal/sync-usuario`) em `usuarios.papel_unidade`.

## 1. Banco (Supabase → SQL Editor)

```sql
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS papel_unidade TEXT;
```

`NULL` = unidade sem par ou usuário ainda não sincronizado → comportamento atual
(fail-open: nenhum risco de travar a MÃE por engano).

## 2. Deploy do SCE

`server.js` passa a ler `papel_unidade` ao montar a sessão e a recusar as
operações de escrita de equipamentos quando o valor é `FILHA` (resposta
`{ success: false, error }` com a mensagem de somente leitura).

## 3. Reconciliação dos usuários já existentes

O papel só chega ao SCE na próxima edição do usuário; por isso rode a
reconciliação em lote uma vez, no backend de chamados:

```bash
cd chamados/backend
npm run sce:reconcile
```

Requer `SCE_API_URL` e `SCE_SYNC_KEY` no `.env`. A saída mostra o papel de cada
usuário (`🔒 somente leitura` / `🔓 administra`) e um resumo no final.

## 4. Conferência

- `GET /api/listar-usuarios` (Matriz) mostra `papelUnidade` por usuário.
- Usuário da FILHA: no portal, `Equipamentos` mostra o aviso de compartilhamento e
  não exibe Adicionar/Editar/Remover; uma chamada direta a
  `POST /api/update-equipamento` volta `success: false` com a mensagem de somente
  leitura.
- Usuário da MÃE: segue editando normalmente.
