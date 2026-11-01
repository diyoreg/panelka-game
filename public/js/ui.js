// Pixel UI: menus, modal windows, settings. All hints and descriptions live here, never in the game view.

const $ = (s) => document.querySelector(s);

export function fitPixels() {
  const s = Math.min(innerWidth / 320, innerHeight / 180);
  const px = s >= 2 ? Math.floor(s) : s;
  document.documentElement.style.setProperty('--px', `${Math.max(1.5, px * 0.85)}px`);
}

// Vertical menu with keyboard focus
export class Menu {
  constructor(el, onAct) {
    this.el = el;
    this.onAct = onAct;
    this.i = 0;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && !b.classList.contains('disabled')) this.onAct(b.dataset.act);
    });
    el.addEventListener('mousemove', (e) => {
      const b = e.target.closest('button');
      if (b) this.focus(this.buttons().indexOf(b));
    });
  }
  buttons() { return [...this.el.querySelectorAll('button')].filter((b) => !b.classList.contains('hidden')); }
  focus(i) {
    const bs = this.buttons();
    if (!bs.length) return;
    this.i = (i + bs.length) % bs.length;
    bs.forEach((b, k) => b.classList.toggle('focus', k === this.i));
  }
  key(e) {
    const bs = this.buttons();
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { let k = this.i; do { k = (k + 1) % bs.length; } while (bs[k].classList.contains('disabled')); this.focus(k); return true; }
    if (e.code === 'ArrowUp' || e.code === 'KeyW') { let k = this.i; do { k = (k - 1 + bs.length) % bs.length; } while (bs[k].classList.contains('disabled')); this.focus(k); return true; }
    if (e.code === 'Enter' || e.code === 'Space') { const b = bs[this.i]; if (b && !b.classList.contains('disabled')) this.onAct(b.dataset.act); return true; }
    return false;
  }
}

// ------------------------------------------------------------------ modal

export class Modal {
  constructor() {
    this.el = $('#modal');
    this.title = $('#modal-title');
    this.body = $('#modal-body');
    this.onClose = null;
    this.keyHandler = null;
    $('#modal-close').addEventListener('click', () => this.close());
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.close(); });
  }
  get open() { return !this.el.classList.contains('hidden'); }
  show(title, html, { onClose, keyHandler } = {}) {
    this.title.textContent = title;
    this.body.innerHTML = html;
    this.body.scrollTop = 0;
    this.el.classList.remove('hidden');
    this.onClose = onClose || null;
    this.keyHandler = keyHandler || null;
  }
  close() {
    if (!this.open) return;
    this.el.classList.add('hidden');
    const f = this.onClose;
    this.onClose = null;
    this.keyHandler = null;
    if (f) f();
  }
  key(e) {
    if (e.code === 'Escape') { this.close(); return true; }
    if (this.keyHandler && this.keyHandler(e)) return true;
    if (e.code === 'ArrowDown') { this.body.scrollTop += 40; return true; }
    if (e.code === 'ArrowUp') { this.body.scrollTop -= 40; return true; }
    return true;
  }
}

// ------------------------------------------------------------------ texts

const K = (k) => `<span class="key">${k}</span>`;

export const CONTROLS_HTML = `
<h3>MOVING AROUND</h3>
<div class="keys">
  <div>${K('W')}${K('A')}${K('S')}${K('D')}</div><div>Walk. Arrow keys work too.</div>
  <div>${K('MOUSE')}</div><div>Look around. Click the screen if the mouse is not captured.</div>
  <div>${K('SHIFT')}</div><div>Hold to run.</div>
  <div>${K('W')}${K('W')}</div><div>Double tap W to run, keep holding W to keep running.</div>
  <div>${K('SPACE')}</div><div>Jump. You can hop onto benches, steps, boxes and dumpsters.</div>
  <div>${K('SPACE')}</div><div>In front of a ledge up to three meters high: climb onto it. A balcony, an entrance canopy, a car, a garage roof. On a balcony, look up or out and press it again to climb to the next floor.</div>
  <div>${K('C')}</div><div>Crouch. Toggle or hold, see Settings.</div>
</div>
<h3>INDOORS</h3>
<div class="keys">
  <div>${K('E')}</div><div>Open or close the door you look at, flip a light switch, open the roof hatch. Most of the panel five-storeys let you in: the entrance door, the stairs, the flats are not locked.</div>
  <div>${K('SPACE')}</div><div>Under the open hatch on the top landing: climb out onto the roof.</div>
  <div>${K('F')}</div><div>Flashlight on and off. Works outside too.</div>
</div>
<h3>FLYING</h3>
<div class="keys">
  <div>${K('SPACE')}${K('SPACE')}</div><div>Double tap Space to take off or to stop flying.</div>
  <div>${K('SPACE')}</div><div>Fly up.</div>
  <div>${K('C')}</div><div>Fly down. Touch the ground to land.</div>
  <div>${K('SHIFT')}</div><div>Fly fast. Double tap W works too.</div>
</div>
<h3>VIEW AND MUSIC</h3>
<div class="keys">
  <div>${K('V')}</div><div>Switch between third and first person.</div>
  <div>${K('N')}</div><div>Skip to the next piece of music.</div>
  <div>${K('F11')}</div><div>Fullscreen on and off.</div>
  <div>${K('ESC')}</div><div>Pause menu. Your walk is saved automatically.</div>
</div>
<h3>IN MENUS</h3>
<div class="keys">
  <div>${K('LEFT')}${K('RIGHT')}</div><div>Change the snowfall or a setting.</div>
  <div>${K('UP')}${K('DOWN')}</div><div>Move between the menu items.</div>
  <div>${K('ENTER')}</div><div>Go: start or continue the walk.</div>
</div>`;

export const ABOUT_HTML = `
<p><em>Lost in Panelka</em> is a quiet walk with no goal through an endless Soviet microdistrict on a winter night. Pick the snowfall on the main screen before you go.</p>
<p>There is no goal, no score and nobody else in the yards. Just panel blocks fading into the snowy haze, lit kitchens, the bulbs over the entrances and music. Come here after work, put on headphones and wander.</p>
<h3>THE MICRODISTRICT</h3>
<p>The district is generated from a seed, block by block, as you walk. The same seed always gives the same yards, so you can come back to a place you liked. Your position is remembered between launches. The seed lives in Settings.</p>
<p>Five-storey khrushchyovkas with pitched tin roofs, nine-, twelve- and sixteen-storey panel blocks around closed courtyards. Windows are lit behind net curtains and heavy drapes, a kitchen strip light here, a TV glowing blue there, and the bulbs on the stair landings. Every balcony is different: open with painted sheets or a lattice rail, glazed with old wooden frames or white plastic, with skis, boxes and frozen laundry. You can climb them.</p>
<p>In the yards: cars buried in snow, swings, slides and a sandbox under a mushroom roof, a hockey box, carpet beaters, rubbish containers, garages and a transformer hut, birches, pollarded poplars and blue spruces. Snow lies on every sill, rail and canopy, icicles hang from the edges, a bulb flickers over some entrance.</p>
<h3>INSIDE</h3>
<p>The panel five-storeys are open. Push the steel door of the entrance, walk past the mailboxes and up the stairs: oil paint up to the shoulder, a bulb on every landing, padded doors with brass trim. Every landing has three flats, one, two and three rooms, none of them locked. Some are still as they were in the eighties: a wall unit full of crystal, a carpet on the wall, a gas heater over the kitchen sink. Others had their makeover in the 2000s: laminate, a leather sofa and a beige computer running Windows XP. Lights work on the switches by the doors. Step out onto the balcony, or climb the iron ladder on the top landing and push open the hatch to the roof.</p>
<h3>THINGS TO NOTICE</h3>
<p>Apartments switch their lights on and off over time. Snow glitters near the lamps, and you leave footprints. Auto snowfall changes on its own from a light dusting to a blizzard; or fix it to Snow, Blizzard or Clear on the main screen. Every now and then a siren sounds somewhere far away.</p>
<h3>PERFORMANCE</h3>
<p>The haze is not just mood, it also keeps the frame rate steady. On a slow machine raise <em>Pixel size</em> or set <em>View distance</em> to Near. On a fast one try Far. <em>Frame rate limit</em> keeps a laptop cool and quiet.</p>
<h3>CREDITS</h3>
<p>Engine: Three.js (MIT).<br>
Models: generated in Blender by a script in the project.<br>
Character: "GTA npc 2 San Andreas" by Dudueyidk on Sketchfab (CC BY 4.0).<br>
Character animations: GTA San Andreas (Rockstar Games), from the player's own copy of the game, read with the IFP reader of INU Tools (GPL-3.0).<br>
Textures: ambientCG (CC0), downscaled to pixels.<br>
Font: Press Start 2P by CodeMan38 (SIL Open Font License).<br>
Music: the ambience recording supplied with the project, cut into pieces that play in random order.</p>`;

// ------------------------------------------------------------------ settings

export const SETTINGS_DEF = [
  { key: 'music', label: 'Music volume', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
  { key: 'sfx', label: 'Sound volume', note: 'Footsteps, wind, distant sirens', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
  { key: 'sens', label: 'Mouse sensitivity', type: 'range', min: 0.2, max: 3, step: 0.1, fmt: (v) => v.toFixed(1) },
  { key: 'invertY', label: 'Invert mouse Y', type: 'choice', options: [[false, 'OFF'], [true, 'ON']] },
  { key: 'fov', label: 'Field of view', type: 'range', min: 50, max: 100, step: 1, fmt: (v) => v + '°' },
  { key: 'pixel', label: 'Pixel size', note: 'Bigger pixels look chunkier and run faster', type: 'range', min: 2, max: 8, step: 1, fmt: (v) => v + 'x' },
  { key: 'view', label: 'View distance', note: 'How many blocks are built around you', type: 'choice', options: [['near', 'NEAR'], ['normal', 'NORMAL'], ['far', 'FAR']] },
  { key: 'camera', label: 'Camera', type: 'choice', options: [['third', 'BEHIND'], ['first', 'EYES']] },
  { key: 'crouchToggle', label: 'Crouch key', type: 'choice', options: [[true, 'TOGGLE'], [false, 'HOLD']] },
  { key: 'headBob', label: 'Head bob', note: 'Only in first person', type: 'choice', options: [[true, 'ON'], [false, 'OFF']] },
  { key: 'crt', label: 'Scanlines', type: 'choice', options: [[false, 'OFF'], [true, 'ON']] },
  { key: 'grain', label: 'Film grain', type: 'choice', options: [[false, 'OFF'], [true, 'ON']] },
  { key: 'fpsCap', label: 'Frame rate limit', note: 'Lower it to keep a laptop cool and quiet', type: 'choice', options: [[30, '30'], [60, '60'], [120, '120'], [0, 'NONE']] },
  { key: 'fps', label: 'Frame counter', type: 'choice', options: [[false, 'OFF'], [true, 'ON']] },
];

// extra: { html, mount(body) } for a custom block under the buttons (the seed)
export function settingsPanel(modal, settings, onChange, extraButtons = [], extra = null) {
  const rows = SETTINGS_DEF.map((d, i) => {
    let ctl;
    if (d.type === 'range') {
      const f = (settings[d.key] - d.min) / (d.max - d.min) * 100;
      ctl = `<div class="slider" data-i="${i}"><div class="fill" style="width:${f}%"></div><div class="val">${d.fmt(settings[d.key])}</div></div>`;
    } else {
      ctl = `<div class="choice">${d.options.map(([v, l], k) => `<button data-i="${i}" data-k="${k}" class="${settings[d.key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    }
    return `<div class="setting" data-row="${i}"><div class="label">${d.label}${d.note ? `<span class="note">${d.note}</span>` : ''}</div>${ctl}</div>`;
  }).join('');
  const btns = extraButtons.map((b, k) => `<button class="btn" data-extra="${k}">${b.label}</button>`).join('');
  let focus = 0;
  const render = () => {
    modal.body.querySelectorAll('.setting').forEach((el, k) => el.classList.toggle('focus', k === focus));
  };
  const refreshRow = (i) => {
    const d = SETTINGS_DEF[i];
    const row = modal.body.querySelector(`.setting[data-row="${i}"]`);
    if (d.type === 'range') {
      row.querySelector('.fill').style.width = ((settings[d.key] - d.min) / (d.max - d.min) * 100) + '%';
      row.querySelector('.val').textContent = d.fmt(settings[d.key]);
    } else {
      row.querySelectorAll('.choice button').forEach((b, k) => b.classList.toggle('on', d.options[k][0] === settings[d.key]));
    }
  };
  const set = (i, v) => {
    const d = SETTINGS_DEF[i];
    if (d.type === 'range') v = Math.round(Math.max(d.min, Math.min(d.max, v)) / d.step) * d.step;
    if (d.type === 'range') v = Number(v.toFixed(3));
    settings[d.key] = v;
    refreshRow(i);
    onChange(d.key, v);
  };
  const nudge = (i, dir) => {
    const d = SETTINGS_DEF[i];
    if (d.type === 'range') set(i, settings[d.key] + dir * d.step);
    else {
      const k = d.options.findIndex(([v]) => v === settings[d.key]);
      set(i, d.options[(k + dir + d.options.length) % d.options.length][0]);
    }
  };
  modal.show('SETTINGS', rows + `<div class="btn-row">${btns}</div>` + (extra?.html || ''), {
    keyHandler: (e) => {
      if (e.code === 'ArrowDown') { focus = Math.min(SETTINGS_DEF.length - 1, focus + 1); render(); scrollTo(); return true; }
      if (e.code === 'ArrowUp') { focus = Math.max(0, focus - 1); render(); scrollTo(); return true; }
      if (e.code === 'ArrowLeft') { nudge(focus, -1); return true; }
      if (e.code === 'ArrowRight' || e.code === 'Enter') { nudge(focus, 1); return true; }
      return false;
    },
  });
  const scrollTo = () => modal.body.querySelector(`.setting[data-row="${focus}"]`)?.scrollIntoView({ block: 'nearest' });
  render();
  // mouse
  modal.body.querySelectorAll('.choice button').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.i);
    set(i, SETTINGS_DEF[i].options[Number(b.dataset.k)][0]);
  }));
  modal.body.querySelectorAll('.slider').forEach((s) => {
    const i = Number(s.dataset.i);
    const d = SETTINGS_DEF[i];
    const from = (e) => {
      const r = s.getBoundingClientRect();
      set(i, d.min + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (d.max - d.min));
    };
    s.addEventListener('mousedown', (e) => {
      from(e);
      const mv = (ev) => from(ev);
      const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
      addEventListener('mousemove', mv);
      addEventListener('mouseup', up);
    });
  });
  modal.body.querySelectorAll('.setting').forEach((el, k) => el.addEventListener('mouseenter', () => { focus = k; render(); }));
  modal.body.querySelectorAll('[data-extra]').forEach((b) => b.addEventListener('click', () => extraButtons[Number(b.dataset.extra)].run()));
  extra?.mount?.(modal.body);
}
