// Deterministic randomness: the same seed gives the same yards.

export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Hash of several integers into a uint32
export function hashInts(...xs) {
  let h = 0x9e3779b9;
  for (const x of xs) {
    h ^= Math.imul((x | 0) ^ (x >> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  return r;
}

// Smoothed value noise on the integer lattice
export function valueNoise2(seed, x, z) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const v = (i, j) => hashInts(seed, i, j) / 4294967296;
  const a = v(x0, z0), b = v(x0 + 1, z0), c = v(x0, z0 + 1), d = v(x0 + 1, z0 + 1);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sz;
}
