# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app/frontend-react
COPY frontend-react/package*.json ./
RUN npm ci
COPY frontend-react ./
RUN npm run build

FROM node:20-bookworm-slim AS server-deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates mariadb-client \
  && rm -rf /var/lib/apt/lists/*

COPY server ./server
COPY public ./public
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY --from=frontend-build /app/frontend-react/dist ./frontend-react/dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh \
  && mkdir -p /app/user_assets

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
