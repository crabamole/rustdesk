// Checks yuv.wasm the way yuv.js calls it: a red 2x2 BT.601 frame must come out red RGBA.
import { readFileSync } from 'node:fs';

const { instance } = await WebAssembly.instantiate(readFileSync(process.argv[2]));
const { memory, malloc, yuv420_rgb24_std, _initialize } = instance.exports;
_initialize?.();

const [w, h] = [2, 2];
const y = malloc(w * h), u = malloc(1), v = malloc(1), out = malloc(w * h * 4);
const heap = new Uint8Array(memory.buffer);
heap.fill(81, y, y + w * h); // BT.601 red: Y=81, U=90, V=240
heap[u] = 90;
heap[v] = 240;
heap.fill(255, out, out + w * h * 4);
yuv420_rgb24_std(w, h, y, u, v, w, 1, out, w * 4, 1);

const px = Array.from(new Uint8Array(memory.buffer, out, w * h * 4));
for (let i = 0; i < px.length; i += 4) {
  const [r, g, b, a] = px.slice(i, i + 4);
  if (!(r > 230 && g < 25 && b < 25 && a === 255)) {
    console.error(`pixel ${i / 4} is ${[r, g, b, a]}, want red RGBA`);
    process.exit(1);
  }
}
console.log('yuv.wasm: RGBA ok');
