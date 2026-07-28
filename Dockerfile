# ---------------------------------------------------------------------------
# COMUNICA+ — imagem de produção (multi-stage).
# Stage 1 compila (TypeScript + bundle do cliente); stage 2 é o runtime enxuto.
# Inclui as dependências nativas: better-sqlite3 e mediasoup.
# ---------------------------------------------------------------------------

FROM node:20-bookworm-slim AS build
WORKDIR /app

# Toolchain para compilar módulos nativos (better-sqlite3 / mediasoup worker).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Instala dependências (com devDeps para compilar).
COPY package.json package-lock.json ./
RUN npm ci

# Compila: tsc (dist/) + esbuild (public/vendor/mediasoup-client.bundle.js).
COPY . .
RUN npm run build

# Remove devDependencies, preservando os módulos nativos já compilados.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
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
