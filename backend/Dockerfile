FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Reutiliza a camada de dependências enquanto o lockfile não muda.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node src ./src
USER node

EXPOSE 3000
CMD ["node", "src/server.js"]
