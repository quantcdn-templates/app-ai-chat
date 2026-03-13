ARG NODE_VERSION=22

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM ghcr.io/quantcdn-templates/app-node:${NODE_VERSION}
WORKDIR /app
COPY --from=builder --chown=node:node /build/dist ./dist
COPY --from=builder --chown=node:node /build/node_modules ./node_modules
COPY --from=builder --chown=node:node /build/src/public ./public
COPY --from=builder --chown=node:node /build/package*.json ./

ENV PORT=3001
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/server.js"]
