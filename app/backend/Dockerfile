# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app

# Dependencias completas; el postinstall ejecuta `prisma generate`.
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# Desarrollo: lo usa docker-compose.override.yml con `npm run dev`.
FROM deps AS dev
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
CMD ["npm", "run", "dev"]

FROM dev AS build
RUN npm run build

# Solo dependencias de producción (sin scripts: la CLI de Prisma es devDependency
# y el cliente ya viene compilado en dist/generated).
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
