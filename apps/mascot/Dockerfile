FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/mascot/package.json apps/mascot/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install

COPY apps/mascot apps/mascot
COPY packages/shared packages/shared

ARG VITE_API_BASE_URL
ARG VITE_WS_URL
ARG VITE_IDLE_VIDEO_URL=/video/idle.mp4
ARG VITE_THINKING_VIDEO_URL=/video/thinking.mp4
ARG VITE_SPEAKING_VIDEO_URL=/video/speaking.mp4

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_IDLE_VIDEO_URL=$VITE_IDLE_VIDEO_URL
ENV VITE_THINKING_VIDEO_URL=$VITE_THINKING_VIDEO_URL
ENV VITE_SPEAKING_VIDEO_URL=$VITE_SPEAKING_VIDEO_URL

RUN npm --workspace @assistant/mascot run build

FROM nginx:1.27-alpine

COPY apps/mascot/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/mascot/dist /usr/share/nginx/html

EXPOSE 80

