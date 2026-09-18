FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-impress libreoffice-calc fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV HOST=0.0.0.0 PORT=3001
USER node
EXPOSE 3001
CMD ["node", "server/index.mjs"]
