# syntax=docker/dockerfile:1
#
# Imagem de producao do backend do SCE (Sistema de Controle de Equipamentos).
#
# Contexto de build: a RAIZ deste repositorio.
#
#   docker build -f Dockerfile -t IMG .
#
# Diferente do sci-chamados, aqui nao ha build step: o server.js ja e JS puro
# (ESM, "type": "module") e roda direto com node. O frontend do SCE continua
# hospedado no Vercel (ver vercel.json), entao o stage de build do vite nao e
# necessario para a imagem da API.

FROM node:22-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    NODE_OPTIONS=--dns-result-order=ipv4first

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && npm cache clean --force

# O server.js importa apenas ./supabaseService.js - nenhum outro modulo local.
COPY server.js supabaseService.js ./

# O server.js faz `res.sendFile(dist/index.html)` como fallback de SPA. A API so
# e acessada via /api/* (proxy do vercel.json) e /health, mas este stub evita
# erro 500 caso alguem erre o caminho direto.
RUN mkdir -p dist && printf '<!doctype html><meta charset="utf-8"><title>SCE API</title>' > dist/index.html

EXPOSE 8080
USER node

CMD ["node", "server.js"]
