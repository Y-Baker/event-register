# Stage 1: Build & Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Stage 2: Production Runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5050

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Create uploads directory with ownership for non-root node user
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node

EXPOSE 5050

HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5050/api/v1/health || exit 1

CMD ["node", "src/index.js"]
