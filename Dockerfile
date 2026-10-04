FROM node:22-alpine
LABEL io.modelcontextprotocol.server.name="io.github.aiballfooty/aiball-mcp"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
USER node
ENTRYPOINT ["node", "src/index.js"]
