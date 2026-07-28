# ---------------------------------------------------------------------------
# COMUNICA+ — imagem de produção (multi-stage).
# Stage 1 compila (TypeScript + bundle do cliente); stage 2 é o runtime enxuto.
# Inclui as dependências nativas: better-sqlite3 e mediasoup.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS build
WORKDIR /app

# WITH_SFU=1 constrói com o SFU (mediasoup) — compila o worker nativo (pesado;
# requer python3-pip). Padrão 0: build enxuto para hosts sem UDP (ex.: Render),
# omitindo a dependência OPCIONAL mediasoup — a voz ao vivo usa malha P2P.
ARG WITH_SFU=0

# Toolchain nativo. better-sqlite3 usa node-gyp (python3/make/g++) como fallback
# ao prebuilt. Com WITH_SFU=1, adiciona python3-pip/pkg-config para o mediasoup.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && if [ "$WITH_SFU" = "1" ]; then apt-get install -y --no-install-recommends python3-pip pkg-config; fi \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Padrão: --omit=optional pula o mediasoup → build rápido, sem compilar o worker
# nativo. WITH_SFU=1 instala tudo (mediasoup incluso) para SFU real (Fly.io/VPS).
RUN if [ "$WITH_SFU" = "1" ]; then npm ci; else npm ci --omit=optional; fi

# Compila: tsc (dist/) + esbuild (public/vendor/mediasoup-client.bundle.js).
COPY . .
RUN npm run build

# Remove devDependencies, preservando os módulos nativos já compilados.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Artefatos de runtime.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json

# Diretório de dados (SQLite + áudios). Efêmero por padrão; monte um volume
# em /app/data para persistir.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

# A porta real vem de $PORT (Render injeta automaticamente).
EXPOSE 3000

# Popula usuários/canais demo e sobe o servidor.
CMD ["npm", "run", "start:prod"]
