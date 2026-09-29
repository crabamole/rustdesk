# Browser-side codecs, built from source.
FROM --platform=linux/amd64 emscripten/emsdk:3.1.61 AS libopus

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    autoconf automake libtool && rm -rf /var/lib/apt/lists/*

# Clone libopusjs wrapper
RUN git clone --depth 1 https://github.com/ImagicTheCat/libopusjs.git .

# Build libopus v1.3.1 from xiph/opus with Emscripten
RUN rm -rf /build/opus \
    && git clone --depth 1 --branch v1.3.1 https://github.com/xiph/opus.git /build/opus
WORKDIR /build/opus
RUN ./autogen.sh \
    && emconfigure ./configure --disable-rtcd --disable-intrinsics --disable-shared \
       --enable-static --disable-stack-protector --disable-hardening \
    && emmake make -j$(nproc)

# Append RustDesk worker glue to api.js
WORKDIR /build
COPY docker/web-client/opus-worker-glue.js /tmp/opus-worker-glue.js
RUN cat /tmp/opus-worker-glue.js >> api.js

# Build libopus.js + libopus.wasm. api.js calls Module._malloc, which current
# Emscripten only exports when listed (build.sh lists just _free).
RUN ./build.sh -O2 -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -fno-exceptions -s DISABLE_EXCEPTION_CATCHING=1 \
    -s 'EXPORTED_FUNCTIONS=["_free","_malloc"]'

# yuv.wasm for yuv.js, which renders video when the browser has no WebGL.
FROM --platform=linux/amd64 emscripten/emsdk:3.1.61 AS yuv-wasm
COPY flutter/web/js/yuv2rgb /src
RUN mkdir -p /out \
    && emcc -O2 -msimd128 /src/yuv_rgb.c --no-entry -s STANDALONE_WASM \
      -s EXPORTED_FUNCTIONS=_yuv420_rgb24_std,_malloc,_free -o /out/yuv.wasm \
    && node /src/test.mjs /out/yuv.wasm \
    && cp /src/LICENSE /out/yuv.wasm.LICENSE

FROM --platform=linux/amd64 node:18-slim AS yuv-canvas

WORKDIR /build
RUN npm pack yuv-canvas@1.2.6 \
    && tar xzf yuv-canvas-1.2.6.tgz \
    && cd package \
    && npm install \
    && npx grunt replace browserify \
    && npx browserify src/yuv-canvas.js --standalone YUVCanvas -o /build/yuv-canvas-1.2.6.js

# Everything copied into the web root next to the Flutter build.
FROM --platform=linux/amd64 alpine:3.20 AS web-deps

RUN apk add --no-cache curl unzip

WORKDIR /out

# ogvjs 1.8.6 from GitHub release (includes SIMD builds not in npm)
RUN curl -fsSL -o /tmp/ogvjs.zip \
      https://github.com/brion/ogv.js/releases/download/1.8.6/ogvjs-1.8.6.zip \
    && unzip /tmp/ogvjs.zip -d /out

COPY --from=libopus /build/libopus.js /build/libopus.wasm /out/
COPY --from=yuv-canvas /build/yuv-canvas-1.2.6.js /out/
COPY --from=yuv-wasm /out/ /out/

# Just the files, for local builds: docker build --target web-deps-files --output flutter/web
FROM scratch AS web-deps-files
COPY --from=web-deps /out /

# Fonts the web client would otherwise download from Google at runtime.
FROM --platform=linux/amd64 alpine:3.22 AS fonts
COPY docker/web-client/fetch-fonts.sh docker/web-client/fonts.sha256 /fonts-src/
RUN /fonts-src/fetch-fonts.sh /fonts

FROM --platform=linux/amd64 ubuntu:22.04 AS build

ARG FLUTTER_VERSION=3.24.5
ARG NODE_MAJOR=22

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl git unzip xz-utils ca-certificates python3 gnupg \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN wget -q https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz \
    && tar xf flutter_linux_${FLUTTER_VERSION}-stable.tar.xz -C /opt \
    && rm flutter_linux_${FLUTTER_VERSION}-stable.tar.xz

ENV PATH="/opt/flutter/bin:${PATH}"

RUN npm install -g yarn typescript protoc

COPY .github/patches/flutter_3.24.4_dropdown_menu_enableFilter.diff /tmp/flutter.diff
RUN cd /opt/flutter && git apply /tmp/flutter.diff && rm /tmp/flutter.diff

RUN flutter config --no-analytics && flutter precache --web

RUN git config --global --add safe.directory /opt/flutter \
    && git config --global --add safe.directory /build

WORKDIR /build
COPY . .

WORKDIR /build/flutter/web/js
RUN yarn install && yarn build

WORKDIR /build/flutter
COPY --from=web-deps /out /tmp/web-deps
# Flutter copies web/ into the build; of web/js only the built bundle is served.
RUN find web/js -mindepth 1 -maxdepth 1 ! -name dist -exec rm -rf {} + \
    && flutter pub get && flutter build web --release \
    && cp -r /tmp/web-deps/. build/web/ \
    && sh /build/docker/web-client/check-fonts.sh build/web/main.dart.js \
    && sh /build/docker/web-client/cache-bust.sh

# --- Production stage ---
FROM nginx:alpine

COPY --from=build /build/flutter/build/web /usr/share/nginx/html
COPY --from=fonts /fonts /usr/share/nginx/html/fonts

# Prevent CDN/browser from caching mutable assets; let the Flutter service worker handle caching
COPY <<'NGINX' /etc/nginx/conf.d/cache-control.conf
server {
    listen 80;
    location / {
        root /usr/share/nginx/html;
        index index.html;
        add_header Cache-Control "no-cache, must-revalidate";
    }
}
NGINX
RUN rm /etc/nginx/conf.d/default.conf

COPY <<'EOF' /docker-entrypoint.d/90-rustdesk-config.sh
#!/bin/sh
set -e
CONFIG=/usr/share/nginx/html/config.json
# A key read from a file may end with a newline, which would break the JSON.
KEY=$(printf '%s' "${RUSTDESK_KEY:?RUSTDESK_KEY is required}" | tr -d '[:space:]')
API_LINE=""
if [ -n "${RUSTDESK_API:-}" ]; then
  API_LINE="$(printf '\n  "api": "%s",' "$RUSTDESK_API")"
fi
cat > "$CONFIG" <<CONF
{${API_LINE}
  "host": "${RUSTDESK_HOST:-/ws/id}",
  "relay": "${RUSTDESK_RELAY:-/ws/relay}",
  "key": "${KEY}"
}
CONF
echo "config.json written"
EOF
# config.json is owned by nginx so the script can rewrite it when running as that user.
RUN chmod +x /docker-entrypoint.d/90-rustdesk-config.sh \
    && touch /usr/share/nginx/html/config.json \
    && chown nginx:nginx /usr/share/nginx/html/config.json
