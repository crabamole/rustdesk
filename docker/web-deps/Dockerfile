FROM --platform=linux/amd64 emscripten/emsdk:3.1.61 AS libopus-build

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
COPY docker/web-deps/opus-worker-glue.js /tmp/opus-worker-glue.js
RUN cat /tmp/opus-worker-glue.js >> api.js

# Build libopus.js + libopus.wasm. api.js calls Module._malloc, which current
# Emscripten only exports when listed (build.sh lists just _free).
RUN ./build.sh -O2 -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -fno-exceptions -s DISABLE_EXCEPTION_CATCHING=1 \
    -s 'EXPORTED_FUNCTIONS=["_free","_malloc"]'

# ---

FROM --platform=linux/amd64 node:18-slim AS yuv-canvas-build

WORKDIR /build
RUN npm pack yuv-canvas@1.2.6 \
    && tar xzf yuv-canvas-1.2.6.tgz \
    && cd package \
    && npm install \
    && npx grunt replace browserify \
    && npx browserify src/yuv-canvas.js --standalone YUVCanvas -o /build/yuv-canvas-1.2.6.js

# ---

FROM --platform=linux/amd64 alpine:3.20 AS package

RUN apk add --no-cache curl unzip

WORKDIR /out

# ogvjs 1.8.6 from GitHub release (includes SIMD builds not in npm)
RUN curl -fsSL -o /tmp/ogvjs.zip \
      https://github.com/brion/ogv.js/releases/download/1.8.6/ogvjs-1.8.6.zip \
    && unzip /tmp/ogvjs.zip -d /out

COPY --from=libopus-build /build/libopus.js /out/
COPY --from=libopus-build /build/libopus.wasm /out/
COPY --from=yuv-canvas-build /build/yuv-canvas-1.2.6.js /out/

RUN tar czf /web_deps.tar.gz -C /out .

FROM scratch
COPY --from=package /web_deps.tar.gz /
