# ---- Build the React client ----
FROM node:20-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Server with production dependencies only ----
FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
COPY server/package*.json server/
RUN npm --prefix server ci --omit=dev
COPY server/ server/
COPY --from=client /app/client/dist client/dist

# The SQLite database lives on a mounted volume so it survives deploys.
ENV DB_PATH=/data/funklist.db
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
