FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock* package-lock.json* .npmrc ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.2-debian
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim antiword ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json /app/bun.lock* /app/.npmrc ./
RUN bun install --production --frozen-lockfile
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p data file logs && chown -R bun:bun /app
USER bun
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 CONTAINER_LOCAL_ONLY=1
EXPOSE 3001
CMD ["bun", "server/index.ts"]
