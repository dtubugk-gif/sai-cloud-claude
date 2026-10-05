# SAI cloud Claude (Render free web service): Claude Code + a tiny server (server.mjs)
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
# run as the image's unprivileged "node" user
USER node
ENV HOME=/home/node PATH=/home/node/.local/bin:$PATH DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
WORKDIR /home/node/app
RUN (curl -fsSL https://claude.ai/install.sh | bash) || (mkdir -p /home/node/.local && npm install -g --prefix /home/node/.local @anthropic-ai/claude-code)
RUN claude --version
COPY --chown=node server.mjs .
EXPOSE 10000
CMD ["node", "server.mjs"]
