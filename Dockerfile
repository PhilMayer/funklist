# Node 22: better-sqlite3 ships prebuilt Linux binaries for it (none for Node 20).
ARG NODE_VERSION=22

# ---- Build the React client ----
FROM node:${NODE_VERSION}-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Install server dependencies ----
# Compilers are only a fallback in case better-sqlite3 has no prebuilt binary for this
# platform; they stay in this stage and never reach the final image.
FROM node:${NODE_VERSION}-slim AS server-deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# ---- Runtime ----
FROM node:${NODE_VERSION}-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=server-deps /app/server/node_modules server/node_modules
COPY server/ server/
COPY --from=client /app/client/dist client/dist

# The SQLite database lives on a mounted volume so it survives deploys.
ENV DB_PATH=/data/funklist.db
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
