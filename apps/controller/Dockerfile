FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/controller/package.json apps/controller/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install

COPY apps/controller apps/controller
COPY packages/shared packages/shared

ARG VITE_API_BASE_URL
ARG VITE_WS_URL

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_WS_URL=$VITE_WS_URL

RUN npm --workspace @assistant/controller run build

FROM nginx:1.27-alpine

COPY apps/controller/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/controller/dist /usr/share/nginx/html

EXPOSE 80

