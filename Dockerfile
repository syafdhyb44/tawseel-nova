FROM node:20-bookworm-slim
WORKDIR /app
COPY server/package.json ./server/package.json
RUN cd server && npm install
COPY server ./server
COPY web ./web
EXPOSE 3000
CMD ["node","server/server.js"]
