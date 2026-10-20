# Documentação técnica — SCE

| Documento | Conteúdo |
|---|---|
| [arquitetura.md](./arquitetura.md) | Mapa da arquitetura (stack atual × legado), responsabilidade de cada arquivo/pasta, fluxos principais |
| [endpoints.md](./endpoints.md) | Referência completa da API: método, rota, nível exigido, payload e alertas por endpoint |
| [variaveis-ambiente.md](./variaveis-ambiente.md) | Variáveis de ambiente por contexto (atual, migração, mortas) e resolução da URL da API no front |
| [riscos-e-melhorias.md](./riscos-e-melhorias.md) | Riscos de segurança, bugs funcionais e code smells, com localização no código |
| [plano-refatoracao.md](./plano-refatoracao.md) | Plano em etapas pequenas (Etapa 0–10), cada uma com testes |
| [legado-apps-script.md](./legado-apps-script.md) | O que era o sistema antigo, para onde foi cada peça e critérios de desligamento |
| [chaves-primarias.md](./chaves-primarias.md) | `sessoes`, `usuarios` e `otp_codes` **não têm `id`** — como escrever SQL sem cair em `column sessoes.id does not exist` |

Documentos relacionados: [README.md](../README.md) (visão geral) e [MANUAL_DEPLOY.md](../MANUAL_DEPLOY.md) (deploy operacional).
