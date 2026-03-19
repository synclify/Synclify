FROM node:24-trixie-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable
WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec tsc

FROM base AS prod-deps

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-trixie-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

EXPOSE 3000

CMD ["node", "dist/app.js"]
