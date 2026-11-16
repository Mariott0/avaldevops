FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S -g 10001 appgroup \
    && adduser -S -D -H -u 10001 -G appgroup appuser \
    && mkdir -p /app/data \
    && chown appuser:appgroup /app/data

# O codigo permanece propriedade de root; somente os dados pertencem ao appuser.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src

# UID/GID de appuser:appgroup; whoami continua retornando appuser.
USER 10001:10001
EXPOSE 3000
CMD ["node", "src/server.js"]
