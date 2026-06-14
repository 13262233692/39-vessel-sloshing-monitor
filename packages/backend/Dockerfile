FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/

RUN npm install --no-audit --no-fund

COPY packages/shared packages/shared
COPY packages/backend packages/backend

RUN npm run build --workspace=@vessel/shared
RUN npm run build --workspace=@vessel/backend

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/

RUN npm install --no-audit --no-fund --omit=dev

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/backend/dist packages/backend/dist

EXPOSE 3000

CMD ["npm", "run", "start:backend"]
