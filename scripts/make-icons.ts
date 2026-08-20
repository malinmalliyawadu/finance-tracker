/*
 * Draws the home-screen icons into `public/icons`.
 *
 * The icons are committed, so this only needs running when the mark or the
 * palette changes — the same arrangement as `src/fonts`, and for the same
 * reason: a production build should not depend on anything it has to generate.
 *
 *   node scripts/make-icons.ts
 *
 * Everything here is stdlib. An icon this simple is a few filled shapes, and a
 * PNG is a header plus one deflate stream, so a rasteriser and an image library
 * would both be dependencies bought for one afternoon's work. Shapes are drawn
 * with signed-distance functions and sampled at 4x, which is what keeps the
 * curves smooth at 180px and the bars crisp at 48.
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

type RGB = [number, number, number]

/** --ink, from globals.css. */
const INK: RGB = [0x17, 0x21, 0x1c]

/**
 * The sieve, which is the app's whole argument: money arrives as one wide bar,
 * loses the parts that only look like spending, and what survives is the pale
 * stub at the bottom. Widths are fractions of the mark, which is itself a
 * fraction of the canvas — so the same code draws the padded maskable variant.
 */
const BARS: { width: number; colour: RGB }[] = [
  { width: 1, colour: [0x2e, 0x7d, 0x5b] }, // --living: the gross figure
  { width: 0.68, colour: [0x4f, 0xb0, 0x83] }, // dark mode's --living, a step lighter
  { width: 0.36, colour: [0xf7, 0xf9, 0xf5] }, // --paper: what is left, and the only pale thing
]

function icon(size: number, markScale: number): Buffer {
  const px = new Uint8Array(size * size * 4)
  const ss = 4 // 4x4 samples per pixel
  const mark = size * markScale
  const x0 = (size - mark) / 2

  // Three bars and the gaps between them, as fractions of the mark's height.
  const barH = mark * 0.2
  const gap = mark * 0.1
  const totalH = barH * 3 + gap * 2
  const y0 = (size - totalH) / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Ground is opaque everywhere: iOS masks the apple-touch-icon itself and
      // the maskable variant is cropped by the launcher, so a transparent
      // corner would only ever show as a hole.
      let [r, g, b] = INK

      for (const [i, bar] of BARS.entries()) {
        const w = mark * bar.width
        const bx = x0 + (mark - w) / 2
        const by = y0 + i * (barH + gap)
        const cov = coverage(x, y, bx, by, w, barH, barH / 2, ss)
        if (cov > 0) {
          const [br, bg, bb] = bar.colour
          r = Math.round(r + (br - r) * cov)
          g = Math.round(g + (bg - g) * cov)
          b = Math.round(b + (bb - b) * cov)
        }
      }

      const o = (y * size + x) * 4
      px[o] = r
      px[o + 1] = g
      px[o + 2] = b
      px[o + 3] = 255
    }
  }

  return png(size, size, px)
}

/** How much of pixel (x, y) falls inside the rounded rect, by supersampling. */
function coverage(
  x: number,
  y: number,
  rx: number,
  ry: number,
  w: number,
  h: number,
  radius: number,
  ss: number,
): number {
  let hits = 0
  for (let sy = 0; sy < ss; sy++) {
    for (let sx = 0; sx < ss; sx++) {
      const px = x + (sx + 0.5) / ss
      const py = y + (sy + 0.5) / ss
      if (inRoundedRect(px, py, rx, ry, w, h, radius)) hits++
    }
  }
  return hits / (ss * ss)
}

function inRoundedRect(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): boolean {
  const r = Math.min(radius, w / 2, h / 2)
  // The usual rounded-box distance field. Fold the point into one quadrant and
  // measure against the rect shrunk by the corner radius: `outside` is the
  // distance out from that inner rect, the `min` term is how far in a point
  // sits when it is inside it, and subtracting r inflates the whole thing back
  // out to the real edge. Negative is inside.
  const dx = Math.abs(px - (x + w / 2)) - (w / 2 - r)
  const dy = Math.abs(py - (y + h / 2)) - (h / 2 - r)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - r <= 0
}

/* ------------------------------------------------------------------ png -- */

function png(width: number, height: number, rgba: Uint8Array): Buffer {
  // One filter byte per scanline. Filter 0 (none) costs a few kilobytes over a
  // proper adaptive filter and saves implementing four of them.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, row + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length + 12)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/* ----------------------------------------------------------------- main -- */

mkdirSync(OUT, { recursive: true })

// `any` icons fill the tile; `maskable` ones keep the mark inside the safe
// circle, because Android crops the corners off to whatever shape the launcher
// uses and a full-bleed mark loses its ends.
const FILES = [
  { name: 'icon-192.png', size: 192, scale: 0.62 },
  { name: 'icon-512.png', size: 512, scale: 0.62 },
  { name: 'icon-maskable-512.png', size: 512, scale: 0.42 },
  { name: 'apple-touch-icon.png', size: 180, scale: 0.62 },
]

for (const { name, size, scale } of FILES) {
  writeFileSync(join(OUT, name), icon(size, scale))
  console.log(`${name}  ${size}x${size}`)
}
