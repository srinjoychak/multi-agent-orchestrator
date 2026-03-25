FROM node:22-slim

# Install git (needed for git worktree operations)
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY src/ src/
COPY agents.json .

# MCP server listens on stdio
ENTRYPOINT ["node", "src/mcp-server/index.js"]
