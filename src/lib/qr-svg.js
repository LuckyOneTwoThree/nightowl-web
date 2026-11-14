/**
 * 零外部依赖标准 QR 码 SVG 生成器（ISO/IEC 18004 · Byte Mode · EC Level L · V2–V6）
 * 覆盖 0–134 字节局域网配对 URI（nightowl://pair?...），供桌面端渲染微信/系统相机可扫二维码。
 */

const VERSIONS = [
  { version: 2, size: 25, align: [6, 18], blocks: [{ data: 34, ec: 10 }], capBytes: 32 },
  { version: 3, size: 29, align: [6, 22], blocks: [{ data: 55, ec: 15 }], capBytes: 53 },
  { version: 4, size: 33, align: [6, 26], blocks: [{ data: 80, ec: 20 }], capBytes: 78 },
  { version: 5, size: 37, align: [6, 30], blocks: [{ data: 108, ec: 26 }], capBytes: 106 },
  {
    version: 6,
    size: 41,
    align: [6, 34],
    blocks: [
      { data: 68, ec: 18 },
      { data: 68, ec: 18 }
    ],
    capBytes: 134
  }
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(deg) {
  let poly = [1];
  for (let i = 0; i < deg; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEc(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const res = new Uint8Array(data.length + ecCount);
  res.set(data);
  for (let i = 0; i < data.length; i += 1) {
    const coef = res[i];
    if (coef === 0) continue;
    for (let j = 1; j < gen.length; j += 1) {
      res[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return Array.from(res.slice(data.length));
}

function encodeCodewords(bytes, spec) {
  const totalData = spec.blocks.reduce((s, b) => s + b.data, 0);
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i -= 1) bits.push((val >>> i) & 1);
  };

  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);

  const maxBits = totalData * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  for (let i = 0; i < termLen; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  let padToggle = 0;
  while (codewords.length < totalData) {
    codewords.push(padToggle === 0 ? 0xec : 0x11);
    padToggle ^= 1;
  }

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const blk of spec.blocks) {
    const slice = codewords.slice(offset, offset + blk.data);
    offset += blk.data;
    dataBlocks.push(slice);
    ecBlocks.push(rsComputeEc(slice, blk.ec));
  }

  const interleaved = [];
  const maxData = Math.max(...dataBlocks.map(b => b.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const blk of dataBlocks) if (i < blk.length) interleaved.push(blk[i]);
  }
  const maxEc = Math.max(...ecBlocks.map(b => b.length));
  for (let i = 0; i < maxEc; i += 1) {
    for (const blk of ecBlocks) if (i < blk.length) interleaved.push(blk[i]);
  }

  const bitStream = [];
  for (const cw of interleaved) {
    for (let b = 7; b >= 0; b -= 1) bitStream.push((cw >>> b) & 1);
  }
  for (let r = 0; r < 7; r += 1) bitStream.push(0); // V2-V6 remainder = 7 bits
  return bitStream;
}

function drawFinder(grid, isFunc, row, col) {
  for (let dr = -1; dr <= 7; dr += 1) {
    for (let dc = -1; dc <= 7; dc += 1) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= grid.length || c < 0 || c >= grid.length) continue;
      const inBox = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      grid[r][c] = inBox && (onBorder || inCore) ? 1 : 0;
      isFunc[r][c] = true;
    }
  }
}

function drawAlignment(grid, isFunc, cr, cc) {
  for (let dr = -2; dr <= 2; dr += 1) {
    for (let dc = -2; dc <= 2; dc += 1) {
      const r = cr + dr;
      const c = cc + dc;
      const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
      grid[r][c] = dark ? 1 : 0;
      isFunc[r][c] = true;
    }
  }
}

function formatBitsForMask(maskId) {
  const data = (0b01 << 3) | maskId; // EC level L (01)
  let rem = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function applyFormat(grid, isFunc, size, maskId) {
  const bits = formatBitsForMask(maskId);
  const bitAt = idx => (bits >>> idx) & 1;

  for (let i = 0; i <= 5; i += 1) {
    grid[8][i] = bitAt(14 - i);
    isFunc[8][i] = true;
  }
  grid[8][7] = bitAt(8);
  isFunc[8][7] = true;
  grid[8][8] = bitAt(7);
  isFunc[8][8] = true;
  grid[7][8] = bitAt(6);
  isFunc[7][8] = true;
  for (let i = 9; i <= 14; i += 1) {
    grid[14 - i][8] = bitAt(14 - i);
    isFunc[14 - i][8] = true;
  }

  for (let i = 0; i <= 6; i += 1) {
    grid[size - 1 - i][8] = bitAt(14 - i);
    isFunc[size - 1 - i][8] = true;
  }
  for (let i = 7; i <= 14; i += 1) {
    grid[8][size - 15 + i] = bitAt(14 - i);
    isFunc[8][size - 15 + i] = true;
  }
}

const MASK_FNS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function penaltyScore(grid) {
  const n = grid.length;
  let score = 0;
  for (let r = 0; r < n; r += 1) {
    let run = 1;
    for (let c = 1; c < n; c += 1) {
      if (grid[r][c] === grid[r][c - 1]) {
        run += 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
  }
  for (let c = 0; c < n; c += 1) {
    let run = 1;
    for (let r = 1; r < n; r += 1) {
      if (grid[r][c] === grid[r - 1][c]) {
        run += 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
  }
  for (let r = 0; r < n - 1; r += 1) {
    for (let c = 0; c < n - 1; c += 1) {
      const sum = grid[r][c] + grid[r][c + 1] + grid[r + 1][c] + grid[r + 1][c + 1];
      if (sum === 0 || sum === 4) score += 3;
    }
  }
  return score;
}

/**
 * 生成标准二维码模块矩阵 { version, size, modules: number[][] }
 */
export function generateQrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const spec = VERSIONS.find(v => bytes.length <= v.capBytes);
  if (!spec) {
    throw new Error(`QR payload exceeds max 134 bytes (${bytes.length})`);
  }

  const n = spec.size;
  const base = Array.from({ length: n }, () => new Array(n).fill(0));
  const isFunc = Array.from({ length: n }, () => new Array(n).fill(false));

  drawFinder(base, isFunc, 0, 0);
  drawFinder(base, isFunc, 0, n - 7);
  drawFinder(base, isFunc, n - 7, 0);

  for (const r of spec.align) {
    for (const c of spec.align) {
      if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) continue;
      drawAlignment(base, isFunc, r, c);
    }
  }

  for (let i = 8; i < n - 8; i += 1) {
    base[6][i] = i % 2 === 0 ? 1 : 0;
    isFunc[6][i] = true;
    base[i][6] = i % 2 === 0 ? 1 : 0;
    isFunc[i][6] = true;
  }

  base[n - 8][8] = 1; // dark module
  isFunc[n - 8][8] = true;
  applyFormat(base, isFunc, n, 0); // reserve format cells

  const bits = encodeCodewords(bytes, spec);
  let bitIdx = 0;
  let upward = true;
  for (let col = n - 1; col >= 1; col -= 2) {
    if (col === 6) col -= 1;
    for (let i = 0; i < n; i += 1) {
      const r = upward ? n - 1 - i : i;
      for (let dc = 0; dc < 2; dc += 1) {
        const c = col - dc;
        if (!isFunc[r][c]) {
          base[r][c] = bitIdx < bits.length ? bits[bitIdx] : 0;
          bitIdx += 1;
        }
      }
    }
    upward = !upward;
  }

  let bestMask = 0;
  let bestScore = Infinity;
  let bestGrid = base;

  for (let m = 0; m < 8; m += 1) {
    const candidate = base.map((row, r) =>
      row.map((val, c) => (isFunc[r][c] ? val : MASK_FNS[m](r, c) ? val ^ 1 : val))
    );
    applyFormat(candidate, isFunc, n, m);
    const sc = penaltyScore(candidate);
    if (sc < bestScore) {
      bestScore = sc;
      bestMask = m;
      bestGrid = candidate;
    }
  }

  void bestMask;
  return { version: spec.version, size: n, modules: bestGrid };
}
