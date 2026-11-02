// Textures drawn in the browser: the shop signs, the button panel of the lift and the floor numbers on the landings.

import { canvasTexture } from './materials.js';

// Shop signs of the microdistrict: plain lit boxes with red, blue or green letters
const SIGNS = [
  ['ПРОДУКТЫ', '#ff5a3c'], ['24 ЧАСА', '#ffd040'], ['АПТЕКА', '#5cff8a'], ['ХЛЕБ', '#ffb050'],
  ['ГАСТРОНОМ', '#ff5a3c'], ['ОВОЩИ', '#9cff5a'], ['ЦВЕТЫ', '#ff70c0'], ['МОЛОКО', '#80c8ff'],
  ['ПРОДУКТЫ', '#80c8ff'], ['УНИВЕРСАМ', '#ff5a3c'], ['ОПТИКА', '#80c8ff'], ['РЕМОНТ ОБУВИ', '#ffd040'],
  ['КУЛИНАРИЯ', '#ffb050'], ['ПРОДУКТЫ 24', '#ff5a3c'], ['ПАРИКМАХЕРСКАЯ', '#c0a0ff'], ['ХОЗТОВАРЫ', '#ffd040'],
];

export function makeSignAtlas() { return drawSigns(SIGNS, '#1a1612'); }

// Atlas of 16 rows: dark plate, lit frame, label. Pixels are thresholded to stay crisp.
function drawSigns(list, plate) {
  const W = 192, H = 24;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H * list.length;
  const g = c.getContext('2d');
  list.forEach(([text, color], i) => {
    const y = i * H;
    g.fillStyle = plate;
    g.fillRect(0, y, W, H);
    g.strokeStyle = color;
    g.globalAlpha = 0.55;
    g.lineWidth = 1;
    g.strokeRect(2.5, y + 2.5, W - 5, H - 5);
    g.globalAlpha = 1;
    g.font = '16px PressStart, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // squeeze long words to fit
    const m = g.measureText(text).width;
    const sx = Math.min(1, (W - 16) / m);
    g.save();
    g.translate(W / 2, y + H / 2 + 1);
    g.scale(sx, 1);
    g.fillStyle = color;
    g.fillText(text, 0, 0);
    g.restore();
  });
  // threshold by brightness
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = Math.max(d[i], d[i + 1], d[i + 2]);
    if (lum < 60) { d[i] = 7; d[i + 1] = 4; d[i + 2] = 12; }
  }
  g.putImageData(img, 0, 0);
  // CanvasTexture flips Y, so shader row `row` is canvas row 15 - row.
  // The row is random anyway, and the labels stay upright.
  return canvasTexture(c);
}

// The panel in the lift cab, on the right wall by the door (k9i.py): a column of round buttons, the floor numbers
// to the left of them, STOP in red and the dispatcher's bell at the bottom. The texture spans 0.82..1.56 m over the
// cab floor; the buttons sit where lift.js expects them (bell 0.88, stop 0.95, floors from 1.02 every 0.06).
export function makeLiftPanel(floors = 9) {
  const W = 64, H = 296;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2520';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#6a5c4c';
  g.lineWidth = 2;
  g.strokeRect(2, 2, W - 4, H - 4);
  const row = (h) => (1.56 - h) / 0.74 * H;
  const ring = (y, color) => {
    g.fillStyle = '#8a8478';
    g.beginPath(); g.arc(32, y, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = color;
    g.beginPath(); g.arc(32, y, 6, 0, Math.PI * 2); g.fill();
  };
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let f = 0; f < floors; f++) {
    const y = row(1.02 + f * 0.06);
    ring(y, '#111');
    g.fillStyle = '#e8e2d4';
    g.font = 'bold 14px monospace';
    g.fillText(String(f + 1), 13, y + 1);
  }
  const ys = row(0.95), yb = row(0.88);
  ring(ys, '#a01810');
  ring(yb, '#c09018');
  g.fillStyle = '#e04030';
  g.font = 'bold 8px monospace';
  g.fillText('СТОП', 13, ys + 1);
  // a bell
  g.fillStyle = '#e0b040';
  g.beginPath(); g.arc(13, yb, 5, Math.PI, 0); g.lineTo(18, yb + 3); g.lineTo(8, yb + 3); g.fill();
  g.fillRect(12, yb + 3, 2, 2);
  // a scratched "ПЁТР" and the plate of the maker
  g.fillStyle = '#9a8e7a';
  g.font = '7px monospace';
  g.fillText('КМЗ', 32, row(1.53));
  return canvasTexture(c);
}

// Enamel plates with the floor number, ten in a row (0..9); a landing picks its own (k9i.py)
export function makeFloorNumbers() {
  const S = 32;
  const c = document.createElement('canvas');
  c.width = S * 10;
  c.height = S;
  const g = c.getContext('2d');
  for (let i = 0; i < 10; i++) {
    const x = i * S;
    g.fillStyle = '#1d3a72';
    g.fillRect(x, 0, S, S);
    g.fillStyle = '#e9e6dc';
    g.fillRect(x + 3, 3, S - 6, S - 6);
    g.fillStyle = '#1d3a72';
    g.font = 'bold 22px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i), x + S / 2, S / 2 + 1);
  }
  return canvasTexture(c);
}
