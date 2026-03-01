FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Seoul

COPY .next/standalone ./
COPY .next/static ./apps/web/.next/static
COPY public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
