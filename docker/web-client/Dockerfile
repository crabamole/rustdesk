FROM --platform=linux/amd64 ghcr.io/crabamole/rustdesk/web-deps:20260925-1 AS web-deps

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
COPY --from=web-deps /web_deps.tar.gz /tmp/web_deps.tar.gz
RUN flutter pub get && flutter build web --release \
    && tar xzf /tmp/web_deps.tar.gz -C build/web \
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
