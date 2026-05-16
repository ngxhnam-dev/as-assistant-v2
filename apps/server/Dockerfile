FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install

COPY apps/server apps/server
COPY packages/shared packages/shared
COPY .env .env

EXPOSE 8787

CMD ["npm", "--workspace", "@assistant/server", "run", "start"]

