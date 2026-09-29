FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate

EXPOSE 3000

# Execução via tsx (sem etapa de compilação): o tsconfig usa noEmit e o `tsc` serve
# apenas como typecheck (`npm run typecheck`). Mantém dev e produção rodando o mesmo código-fonte.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx server.ts"]
