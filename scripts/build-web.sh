#!/bin/bash
set -e

cd /app/flutter/web/js
npm install
npm run build

cd /app/flutter/web
if [ ! -f "libopus.js" ] || [ ! -f "yuv.wasm" ]; then
    echo "Missing browser codecs; build them on the host first:" >&2
    echo "  docker build -f docker/web-client/Dockerfile --target web-deps-files --output flutter/web ." >&2
    exit 1
fi

cd /app/flutter
flutter pub get
flutter build web --profile --dart2js-optimization O1 --source-maps

echo "Build complete. Output in flutter/build/web/"
