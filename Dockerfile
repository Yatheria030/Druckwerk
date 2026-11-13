# Ein Container: Der Server liefert API und gebaute Oberfläche auf demselben Port und läuft per tsx direkt aus TypeScript.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
# ffmpeg nur für die Kamera von X1, H2 und P2S (RTSPS); A1 und P1 brauchen es nicht: --build-arg FFMPEG=1
ARG FFMPEG=0
RUN if [ "$FFMPEG" = 1 ]; then apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*; fi
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8795 DATA_DIR=/data
COPY --from=build /app /app
USER node
EXPOSE 8795
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8795/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "server/index.ts"]
