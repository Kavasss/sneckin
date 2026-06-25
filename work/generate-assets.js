const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "..", "public", "assets");
fs.mkdirSync(OUT, { recursive: true });

const COLORS = {
  ink: [31, 39, 36, 255],
  paper: [251, 252, 248, 255],
  mint: [201, 242, 222, 255],
  lime: [143, 209, 79, 255],
  tomato: [255, 100, 72, 255],
  gold: [255, 200, 87, 255],
  aqua: [110, 214, 211, 255],
  cream: [255, 245, 211, 255],
  white: [255, 255, 255, 255],
  shadow: [35, 39, 37, 42]
};

writePng("hero-snacks.png", 1200, 680, (ctx) => {
  bg(ctx, [228, 250, 238, 255], [255, 247, 218, 255]);
  dots(ctx, 44, [255, 255, 255, 105]);
  rect(ctx, 0, 508, 1200, 172, [50, 61, 56, 255]);
  rect(ctx, 0, 526, 1200, 28, COLORS.aqua);
  shelfPack(ctx, 120, 235, 170, 290, COLORS.tomato, COLORS.gold);
  shelfPack(ctx, 315, 180, 190, 345, COLORS.gold, COLORS.lime);
  shelfPack(ctx, 530, 245, 165, 280, COLORS.aqua, COLORS.tomato);
  shelfPack(ctx, 720, 205, 190, 320, COLORS.lime, COLORS.ink);
  bowl(ctx, 920, 420, 190, 90, COLORS.white, COLORS.gold);
  chips(ctx, 950, 330, 14, COLORS.gold);
  chips(ctx, 1015, 315, 13, COLORS.tomato);
  chips(ctx, 1068, 350, 11, COLORS.lime);
});

writePng("product-crunch-mix.png", 760, 560, (ctx) => {
  bg(ctx, [235, 251, 243, 255], [255, 247, 218, 255]);
  dots(ctx, 36, [255, 255, 255, 115]);
  bowl(ctx, 380, 390, 250, 116, COLORS.white, COLORS.aqua);
  chips(ctx, 278, 255, 18, COLORS.gold);
  chips(ctx, 358, 220, 16, COLORS.tomato);
  chips(ctx, 445, 240, 17, COLORS.lime);
  chips(ctx, 505, 300, 15, COLORS.gold);
  chips(ctx, 332, 315, 15, COLORS.aqua);
});

writePng("product-cheese-crackers.png", 760, 560, (ctx) => {
  bg(ctx, [255, 247, 218, 255], [238, 251, 244, 255]);
  dots(ctx, 42, [255, 255, 255, 120]);
  shelfPack(ctx, 245, 86, 270, 380, COLORS.gold, COLORS.tomato);
  for (let i = 0; i < 12; i += 1) {
    cracker(ctx, 178 + i * 38, 432 + Math.sin(i) * 12, 28, COLORS.gold);
  }
});

writePng("product-fruit-chips.png", 760, 560, (ctx) => {
  bg(ctx, [255, 237, 232, 255], [232, 249, 249, 255]);
  dots(ctx, 48, [255, 255, 255, 120]);
  shelfPack(ctx, 270, 100, 220, 350, COLORS.tomato, COLORS.aqua);
  for (let i = 0; i < 9; i += 1) {
    fruitSlice(ctx, 185 + i * 48, 424 + Math.cos(i) * 16, 28, i % 2 ? COLORS.tomato : COLORS.gold);
  }
});

writePng("product-nut-box.png", 760, 560, (ctx) => {
  bg(ctx, [236, 249, 239, 255], [255, 244, 210, 255]);
  dots(ctx, 38, [255, 255, 255, 112]);
  roundedRect(ctx, 205, 170, 350, 250, 38, COLORS.ink);
  roundedRect(ctx, 221, 154, 318, 238, 32, COLORS.mint);
  roundedRect(ctx, 245, 184, 270, 170, 24, COLORS.white);
  for (let i = 0; i < 24; i += 1) {
    const x = 285 + (i % 6) * 38 + Math.sin(i) * 9;
    const y = 226 + Math.floor(i / 6) * 31 + Math.cos(i) * 7;
    nut(ctx, x, y, 15, i % 3 === 0 ? COLORS.gold : i % 3 === 1 ? COLORS.tomato : COLORS.lime);
  }
});

function writePng(name, width, height, draw) {
  const ctx = createContext(width, height);
  draw(ctx);
  fs.writeFileSync(path.join(OUT, name), encodePng(ctx));
}

function createContext(width, height) {
  return { width, height, pixels: Buffer.alloc(width * height * 4, 255) };
}

function setPixel(ctx, x, y, color) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= ctx.width || py >= ctx.height) return;

  const offset = (py * ctx.width + px) * 4;
  const alpha = color[3] / 255;
  const inv = 1 - alpha;
  ctx.pixels[offset] = Math.round(color[0] * alpha + ctx.pixels[offset] * inv);
  ctx.pixels[offset + 1] = Math.round(color[1] * alpha + ctx.pixels[offset + 1] * inv);
  ctx.pixels[offset + 2] = Math.round(color[2] * alpha + ctx.pixels[offset + 2] * inv);
  ctx.pixels[offset + 3] = 255;
}

function bg(ctx, top, bottom) {
  for (let y = 0; y < ctx.height; y += 1) {
    const t = y / (ctx.height - 1);
    const color = mix(top, bottom, t);
    for (let x = 0; x < ctx.width; x += 1) setPixel(ctx, x, y, color);
  }
}

function dots(ctx, step, color) {
  for (let y = step / 2; y < ctx.height; y += step) {
    for (let x = step / 2; x < ctx.width; x += step) {
      ellipse(ctx, x, y, 3, 3, color);
    }
  }
}

function rect(ctx, x, y, width, height, color) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) setPixel(ctx, px, py, color);
  }
}

function roundedRect(ctx, x, y, width, height, radius, color) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const dx = px < x + radius ? x + radius - px : px > x + width - radius ? px - (x + width - radius) : 0;
      const dy = py < y + radius ? y + radius - py : py > y + height - radius ? py - (y + height - radius) : 0;
      if (dx * dx + dy * dy <= radius * radius) setPixel(ctx, px, py, color);
    }
  }
}

function ellipse(ctx, cx, cy, rx, ry, color) {
  for (let y = cy - ry; y <= cy + ry; y += 1) {
    for (let x = cx - rx; x <= cx + rx; x += 1) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPixel(ctx, x, y, color);
    }
  }
}

function shelfPack(ctx, x, y, width, height, base, accent) {
  roundedRect(ctx, x + 16, y + 18, width, height, 22, COLORS.shadow);
  roundedRect(ctx, x, y, width, height, 28, COLORS.ink);
  roundedRect(ctx, x + 10, y + 10, width - 20, height - 20, 22, base);
  rect(ctx, x + 10, y + height * 0.62, width - 20, height * 0.18, accent);
  roundedRect(ctx, x + width * 0.22, y + height * 0.16, width * 0.56, height * 0.16, 18, COLORS.white);
  ellipse(ctx, x + width * 0.52, y + height * 0.47, width * 0.24, height * 0.12, [255, 255, 255, 170]);
  rect(ctx, x + 24, y + height - 54, width - 48, 10, COLORS.ink);
}

function bowl(ctx, cx, cy, rx, ry, color, accent) {
  ellipse(ctx, cx + 12, cy + 22, rx, ry, COLORS.shadow);
  ellipse(ctx, cx, cy, rx, ry, COLORS.ink);
  ellipse(ctx, cx, cy - 10, rx * 0.92, ry * 0.62, color);
  rect(ctx, cx - rx * 0.72, cy - 8, rx * 1.44, ry * 0.72, color);
  ellipse(ctx, cx, cy + ry * 0.52, rx * 0.72, ry * 0.28, accent);
  ellipse(ctx, cx, cy - 12, rx * 0.78, ry * 0.4, [247, 252, 246, 255]);
}

function chips(ctx, cx, cy, size, color) {
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI * 2 * i) / 8;
    const x = cx + Math.cos(angle) * size * 1.8;
    const y = cy + Math.sin(angle) * size * 0.9;
    ellipse(ctx, x + 5, y + 5, size * 1.2, size * 0.72, COLORS.shadow);
    ellipse(ctx, x, y, size * 1.2, size * 0.72, color);
    ellipse(ctx, x - size * 0.25, y - size * 0.18, size * 0.38, size * 0.18, [255, 255, 255, 110]);
  }
}

function cracker(ctx, cx, cy, size, color) {
  roundedRect(ctx, cx - size, cy - size * 0.7, size * 2, size * 1.4, 8, COLORS.ink);
  roundedRect(ctx, cx - size + 4, cy - size * 0.7 + 4, size * 2 - 8, size * 1.4 - 8, 6, color);
  for (let i = -1; i <= 1; i += 1) ellipse(ctx, cx + i * 9, cy, 2, 2, [166, 118, 37, 255]);
}

function fruitSlice(ctx, cx, cy, size, color) {
  ellipse(ctx, cx + 4, cy + 5, size, size * 0.72, COLORS.shadow);
  ellipse(ctx, cx, cy, size, size * 0.72, color);
  ellipse(ctx, cx, cy, size * 0.72, size * 0.5, COLORS.cream);
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI * 2 * i) / 6;
    ellipse(ctx, cx + Math.cos(angle) * size * 0.34, cy + Math.sin(angle) * size * 0.24, 3, 3, color);
  }
}

function nut(ctx, cx, cy, size, color) {
  ellipse(ctx, cx + 4, cy + 4, size * 1.12, size * 0.82, COLORS.shadow);
  ellipse(ctx, cx, cy, size * 1.12, size * 0.82, color);
  ellipse(ctx, cx - 4, cy - 3, size * 0.35, size * 0.22, [255, 255, 255, 120]);
}

function mix(a, b, t) {
  return [
    Math.round(a[0] * (1 - t) + b[0] * t),
    Math.round(a[1] * (1 - t) + b[1] * t),
    Math.round(a[2] * (1 - t) + b[2] * t),
    255
  ];
}

function encodePng(ctx) {
  const stride = ctx.width * 4 + 1;
  const raw = Buffer.alloc(stride * ctx.height);

  for (let y = 0; y < ctx.height; y += 1) {
    raw[y * stride] = 0;
    ctx.pixels.copy(raw, y * stride + 1, y * ctx.width * 4, (y + 1) * ctx.width * 4);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr(ctx.width, ctx.height)),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function ihdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getCrcTable() {
  if (getCrcTable.table) return getCrcTable.table;

  getCrcTable.table = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });

  return getCrcTable.table;
}
