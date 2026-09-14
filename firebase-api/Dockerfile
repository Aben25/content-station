# Build with repository root as the Docker context.
FROM node:22-bookworm-slim AS build
WORKDIR /app/firebase-api
COPY firebase-api/package*.json ./
RUN npm ci
COPY firebase-api/tsconfig.json ./
COPY firebase-api/src ./src
COPY product.json /app/product.json
RUN npm run build && npm prune --omit=dev
FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app/firebase-api
COPY --from=build /app/firebase-api/package.json ./
COPY --from=build /app/firebase-api/node_modules ./node_modules
COPY --from=build /app/firebase-api/dist ./dist
COPY product.json /app/product.json
USER node
CMD ["node", "dist/server.js"]
