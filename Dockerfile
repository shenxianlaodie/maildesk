FROM node:24-bookworm-slim
ENV NODE_ENV=production MAILDESK_HOST=0.0.0.0 MAILDESK_DATA_DIR=/data NODE_OPTIONS=--max-old-space-size=256
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install --global pnpm@10.34.7 && pnpm install --prod --frozen-lockfile --ignore-scripts && pnpm store prune
COPY backend ./backend
COPY scripts ./scripts
COPY dist ./dist
USER node
EXPOSE 4182
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:4175/api/bootstrap').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-server.cjs"]
