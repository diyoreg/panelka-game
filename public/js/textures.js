// Textures drawn in the browser: the shop signs.

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
