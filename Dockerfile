# Ein Container: Der Server liefert API und gebaute Oberfläche auf demselben Port und läuft per tsx direkt aus TypeScript.
FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-trixie-slim
# ffmpeg nur für die Kamera von X1, H2 und P2S (RTSPS); A1 und P1 brauchen es nicht: --build-arg FFMPEG=1
ARG FFMPEG=0
RUN if [ "$FFMPEG" = 1 ]; then apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*; fi
# Slicen in der App (Printables, STL, 3MF, STEP): --build-arg SLICER=1. Auf amd64 die Kommandozeile von Bambu Studio (Open Source, AGPL)
# mit den aktuellen Profilen von Bambu Lab, auf arm64 OrcaSlicer (Bambu Studio gibt es für Linux nur für amd64; Orca liefert die Profile nur als
# Cache .opc, die JSON-Profile kommen aus dem Quellarchiv derselben Version). Die AppImage wird mit unsquashfs entpackt (kein FUSE, läuft auch
# beim Cross-Build); GTK und WebKit braucht das Programm zum Laden, auch ohne Fenster. Liegt die AppImage schon in vendor/, wird sie nicht geladen.
ARG SLICER=0
ARG BAMBU_VERSION=02.09.01.70
ARG BAMBU_ASSET=BambuStudio_ubu24-v02.09.01.70-20261103183404.AppImage
ARG ORCA_VERSION=2.5.1
RUN --mount=type=bind,source=vendor,target=/vendor if [ "$SLICER" = 1 ]; then set -e; \
    arch=$(dpkg --print-architecture); \
    case "$arch" in amd64|arm64) ;; *) echo "SLICER=1 übersprungen"; exit 0;; esac; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl squashfs-tools libgtk-3-0t64 libwebkit2gtk-4.1-0 libgl1 libegl1 \
      libglu1-mesa libgl1-mesa-dri libgstreamer1.0-0 libgstreamer-plugins-base1.0-0 libsecret-1-0 libmspack0t64 libavformat61 \
      libavcodec61 libswscale8 libavutil59 libosmesa6 xvfb xauth; \
    unpack() { off=$(node -e 'const b=require("fs").readFileSync(process.argv[1]).subarray(0,64);console.log(Number(b.readBigUInt64LE(40))+b.readUInt16LE(58)*b.readUInt16LE(60))' "$1"); \
      unsquashfs -q -o "$off" -d "$2" "$1" >/dev/null; rm -f "$1"; chmod -R a+rX "$2"; }; \
    if [ "$arch" = amd64 ]; then \
      if [ -f "/vendor/$BAMBU_ASSET" ]; then cp "/vendor/$BAMBU_ASSET" /tmp/slicer.AppImage; \
      else curl -fsSL -o /tmp/slicer.AppImage "https://github.com/bambulab/BambuStudio/releases/download/v${BAMBU_VERSION}/${BAMBU_ASSET}"; fi; \
      unpack /tmp/slicer.AppImage /opt/bambu-studio; \
      test -x /opt/bambu-studio/AppRun; test -f "/opt/bambu-studio/resources/profiles/BBL/machine/Bambu Lab P2S 0.4 nozzle.json"; \
    else \
      curl -fsSL -o /tmp/slicer.AppImage "https://github.com/OrcaSlicer/OrcaSlicer/releases/download/v${ORCA_VERSION}/OrcaSlicer_Linux_AppImage_Ubuntu2404_aarch64_V${ORCA_VERSION}.AppImage"; \
      unpack /tmp/slicer.AppImage /opt/orca; \
      curl -fsSL "https://codeload.github.com/OrcaSlicer/OrcaSlicer/tar.gz/refs/tags/v${ORCA_VERSION}" \
        | tar -xz -C /tmp --wildcards "*/resources/profiles/BBL/*" "*/resources/profiles/BBL.json"; \
      cp -r /tmp/OrcaSlicer-*/resources/profiles/. /opt/orca/resources/profiles/; rm -rf /tmp/OrcaSlicer-*; chmod -R a+rX /opt/orca; \
      test -x /opt/orca/AppRun; test -f "/opt/orca/resources/profiles/BBL/machine/Bambu Lab P2S 0.4 nozzle.json"; \
    fi; \
    apt-get purge -y curl squashfs-tools && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*; \
  fi
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8795 DATA_DIR=/data
COPY --from=build /app /app
USER node
EXPOSE 8795
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8795/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "server/index.ts"]
