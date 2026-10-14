# SCE — Sistema de Controle de Equipamentos

Backend Node/Express + módulos frontend servidos pelo próprio server, sobre
Supabase. Repositório de produto.

## Comandos

```bash
npm run dev               # concurrently: node --watch server.js + vite
npm run build             # vite build
npm run preview
npm run test:seguranca    # scripts/verificar-seguranca.mjs
node server.js            # produção (porta 3000)
```

Subir para os gates do orq:
```bash
dev-restart -Port 3000 -Dir "C:\Users\Pablo\Desktop\sce" -Script "server.js"
```

## Semântica crítica

- O SCE responde HTTP 200 com `success: false` em erro. **HTTP 200 no SCE não
  significa sucesso.** Sempre confira `success`.
- shared/types é consumido por outros sistemas: não mude contratos sem impacto.

## Regras

- Não faça push sem autorização explícita.
- Termine com a árvore limpa (tudo commitado).
- Só edite arquivos do escopo da tarefa.
- Mudanças de contrato afetam chamados/portal: descreva o impacto no relatório.

## Skills a carregar (OpenCode)

Use a tool `skill` antes de trabalhar, conforme o escopo:
- Java/Spring referência se aplicável: `java-coding-standards`, `springboot-patterns`
- Backend Node/Express: `backend-patterns`, `security-review`
- Banco: `postgres-patterns`
- Qualidade/gates: `verification-loop`, `eval-harness`, `strategic-compact`
- Padrões/código: `coding-standards`, `tdd-workflow`
- Aprendizado/contexto: `continuous-learning`, `continuous-learning-v2`,
  `iterative-retrieval`

Se mais de uma se aplica, carregue em paralelo.