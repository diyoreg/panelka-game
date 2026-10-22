// Panelka shaders. Everything is computed in display color space, no tone mapping:
// a stylized image with hand-tuned colors.
//
// Lamps are free-standing: the world sends the nearest PK_LIGHTS of them to every shader
// in uPL / uPC (panelka.js).

import * as THREE from 'three';

export const PK_LIGHTS = 24;

// Shared uniforms: the same objects in every material
export const U = {
  uTime: { value: 0 },
  uCamPos: { value: new THREE.Vector3() },
  uFogDensity: { value: 0.0105 },
  uFogStart: { value: 70 },     // the volumetric pass (fog.js) covers the first meters
  // a warm overcast winter night: the clouds glow with the city lights below them
  uSkyTop: { value: new THREE.Color(0.17, 0.105, 0.075) },
  uSkyHor: { value: new THREE.Color(0.47, 0.31, 0.21) },
  uSkyGlow: { value: new THREE.Color(0.12, 0.06, 0.02) },
  uMist: { value: new THREE.Color(0.52, 0.4, 0.32) },
  uGlowDir: { value: new THREE.Vector3(0.6, 0, -0.8).normalize() },
  uAmbSky: { value: new THREE.Color(0.5, 0.41, 0.36) },
  uAmbGround: { value: new THREE.Color(0.4, 0.34, 0.31) },
  uMoonDir: { value: new THREE.Vector3(0.5, 0.6, -0.62).normalize() },
  uMoonCol: { value: new THREE.Color(0, 0, 0) },
  uSeedOff: { value: 0 },
  uLitAmount: { value: 0.8 },
  uPL: { value: Array.from({ length: PK_LIGHTS }, () => new THREE.Vector4(0, -1000, 0, 0)) },  // position, range
  uPC: { value: Array.from({ length: PK_LIGHTS }, () => new THREE.Vector4()) },               // color, kind
  uSnow: { value: 0 },         // snowfall intensity
  uSnowCol: { value: new THREE.Color(0.86, 0.87, 0.9) },
  uCloud: { value: new THREE.Vector2(45, 170) },   // heights where the low cloud deck starts and closes
  // rain and snow are drawn after the fog pass (post.js): scene depth to hide them behind walls,
  // and how fast the volumetric fog swallows them with distance
  tSceneDepth: { value: null },
  uViewRes: { value: new THREE.Vector2(1, 1) },
  uPartFog: { value: 0.02 },
};

// The layer of rain and snow particles, rendered on top of the fogged scene
export const WEATHER_LAYER = 1;

export const WEATHER_GLSL = /* glsl */`
uniform sampler2D tSceneDepth;
uniform vec2 uViewRes;
uniform float uPartFog;
// true when a wall, a car or the ground is in front of this fragment
bool hiddenByScene() {
  return texture2D(tSceneDepth, gl_FragCoord.xy / uViewRes).r < gl_FragCoord.z;
}
// share of the particle left after the fog between it and the camera
float fogKeep(vec3 wp) {
  return exp(-length(wp - uCamPos) * uPartFog);
}`;

export const COMMON = /* glsl */`
uniform float uTime;
uniform vec3 uCamPos;
uniform float uFogDensity, uFogStart;
uniform vec3 uSkyTop, uSkyHor, uSkyGlow, uMist, uGlowDir;
uniform vec3 uAmbSky, uAmbGround, uMoonDir, uMoonCol;
uniform float uSeedOff, uLitAmount;
uniform float uSnow;
uniform vec4 uPL[${PK_LIGHTS}];
uniform vec4 uPC[${PK_LIGHTS}];
uniform vec3 uSnowCol;
uniform vec2 uCloud;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

vec3 skyColor(vec3 dir) {
  float y = dir.y;
  vec3 c = mix(uSkyHor, uSkyTop, smoothstep(-0.02, 0.6, y));
  vec2 hd = normalize(dir.xz + vec2(1e-5));
  float g = pow(max(dot(hd, normalize(uGlowDir.xz)), 0.0), 3.0) * (1.0 - smoothstep(-0.05, 0.45, y));
  c += uSkyGlow * g;
  c = mix(c, uMist, (1.0 - smoothstep(-0.12, 0.16, y)) * 0.5);
  return c;
}

vec3 applyFog(vec3 col, vec3 wp, float k) {
  vec3 d = wp - uCamPos;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-4);
  // far haze beyond the ray-marched volume
  float f = 1.0 - exp(-max(dist - uFogStart, 0.0) * uFogDensity);
  // low cloud deck: the tops of the tower blocks dissolve into it, in uneven patches
  float patchy = 0.75 + 0.25 * vnoise(wp.xz * 0.015 + vec2(uTime * 0.01, 0.0)) + 0.15 * vnoise(vec2(wp.y * 0.05, uTime * 0.02));
  float cloud = smoothstep(uCloud.x, uCloud.y, wp.y * patchy) * smoothstep(10.0, 60.0, dist);
  f = max(f, cloud * 0.96);
  vec3 fc = skyColor(dir);
  fc = mix(fc, uMist, exp(-max(wp.y, 0.0) / 22.0) * 0.7 * smoothstep(3.0, 45.0, dist));
  return mix(col, fc, clamp(f * k, 0.0, 1.0));
}

vec3 ambient(vec3 n) {
  return mix(uAmbGround, uAmbSky, 0.5 + 0.5 * n.y) + uMoonCol * max(dot(n, uMoonDir), 0.0);
}

// broken entrance bulbs all stutter to the same beat (panelka.js knows the same function)
float flicker() {
  return fract(floor(uTime * 9.0) * 0.618034 + 0.3) > 0.32 ? 1.0 : 0.08;
}

// The nearest lamps, bulbs and shop windows. kind 1 = street lamp, its light falls down in a wide cone.
vec3 lampLight(vec3 p, vec3 n) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${PK_LIGHTS}; i++) {
    vec4 L = uPL[i];
    vec3 d = L.xyz - p;
    float d2 = dot(d, d);
    if (d2 > L.w * L.w) continue;
    float dist = sqrt(d2);
    vec3 l = d / max(dist, 1e-4);
    vec4 C = uPC[i];
    float att = 1.0 / (1.0 + d2 * 18.0 / (L.w * L.w)) * (1.0 - smoothstep(L.w * 0.45, L.w, dist));
    float kind = mod(C.w, 2.0);
    float cone = mix(1.0, smoothstep(-0.15, 0.6, l.y), kind);
    float ndl = 0.25 + 0.75 * max(dot(n, l), 0.0);
    acc += C.rgb * att * cone * ndl * (C.w >= 2.0 ? flicker() : 1.0);
  }
  return acc;
}

vec3 lightAt(vec3 p, vec3 n) { return ambient(n) + lampLight(p, n); }

// Fresh snow lying on everything that faces up
float snowAmount(vec3 n, vec3 wp) {
  return smoothstep(0.45, 0.8, n.y) * (0.75 + 0.25 * vnoise(wp.xz * 3.0 + wp.y));
}

// Snow: soft blue in the shade, glitter that catches the lamps. The glints stay put in the world and
// twinkle slowly; they show only close up, where a glint is bigger than a pixel (farther away they
// would flicker as the camera moves).
vec3 snowShade(vec3 alb, vec3 wp, vec3 n, vec3 light) {
  vec3 c = alb * light;
  float near = 1.0 - smoothstep(3.0, 7.0, length(wp - uCamPos));
  float g = hash12(floor(wp.xz * 44.0));
  float twinkle = 0.5 + 0.5 * sin(uTime * 1.3 + g * 6283.0);
  c += step(0.999, g) * near * twinkle * (lampLight(wp, n) * 1.2 + 0.1);
  return c;
}
`;

const VERT = /* glsl */`
${COMMON}
varying vec3 vWP;
varying vec3 vN;
varying vec2 vUv;
flat varying vec3 vOrigin;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = m * instanceMatrix;
  #endif
  vec4 wp = m * vec4(position, 1.0);
  vOrigin = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #ifdef SWAY
  float hgt = max(wp.y - vOrigin.y - 1.2, 0.0);
  float ph = vOrigin.x * 0.31 + vOrigin.z * 0.17;
  wp.x += sin(uTime * 1.3 + ph + wp.y * 0.45) * 0.035 * hgt;
  wp.z += cos(uTime * 1.07 + ph + wp.x * 0.3) * 0.03 * hgt;
  #endif
  vWP = wp.xyz;
  vN = normalize(mat3(m) * normal);
  vUv = vec2(uv.x, 1.0 - uv.y);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */`
${COMMON}
uniform sampler2D map;
uniform vec3 uTint;
uniform float uScale;
uniform vec4 uWin;       // horizontal step, floor height, window width and height (fractions)
uniform float uGlow;
uniform vec3 uPal[8];
uniform float uPalN;
varying vec3 vWP;
varying vec3 vN;
varying vec2 vUv;
flat varying vec3 vOrigin;

// Value noise that fades to its average once its detail gets smaller than about two game pixels.
// Unfiltered fine noise is sampled at a different spot of the pattern every time the camera moves
// a little, so it crawls and flickers; textures have mipmaps for this, procedural patterns need it
// done by hand. Uses screen derivatives, so it lives in the fragment shader only.
float vnoiseAA(vec2 p) {
  vec2 w = fwidth(p);
  return mix(vnoise(p), 0.5, smoothstep(0.25, 0.6, max(w.x, w.y)));
}

// step(edge, x) with its edge spread over one pixel: a frame or a seam thinner than a pixel covers
// it partly instead of popping in and out as the camera moves
float aastep(float edge, float x) {
  float w = fwidth(x) * 0.5;
  return smoothstep(edge - w, edge + w, x);
}

vec3 baseColor() {
  #ifdef HAS_MAP
  return texture2D(map, vUv / uScale).rgb * uTint;
  #else
  return uTint;
  #endif
}

void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 col;
  float fogK = 1.0;
  float alpha = 1.0;

#if defined(MODE_TEX) || defined(MODE_FLAT)
  vec3 light = lightAt(vWP, n);
  col = baseColor() * light;
  // contact shadow near the ground
  col *= mix(0.55, 1.0, smoothstep(0.0, 1.6, vWP.y - 0.1));
  #ifdef SNOWCAP
  col = mix(col, uSnowCol * light, snowAmount(n, vWP));
  #endif
#endif

#ifdef MODE_PANEL
  // concrete or tiled panels: dark sealed seams, every panel a slightly different tone, soot streaks
  vec3 base = baseColor();
  vec3 light = lightAt(vWP, n);
  if (abs(n.y) < 0.5) {
    vec2 pc = vec2(vUv.x / uWin.x, (vUv.y - uWin.z) / uWin.y);
    float su = abs(fract(pc.x + 0.5) - 0.5) * uWin.x;
    float sv = abs(fract(pc.y + 0.5) - 0.5) * uWin.y;
    float w = max(fwidth(vUv.x), fwidth(vUv.y));
    float seam = (1.0 - smoothstep(0.025, 0.025 + w * 1.2, min(su, sv))) * (1.0 - smoothstep(0.12, 0.3, w));
    base *= 1.0 - seam * 0.6;
    base *= 0.92 + 0.14 * hash12(floor(pc) + floor(vOrigin.xz));
    float streak = vnoise(vec2(vUv.x * 2.7 + vOrigin.x, vUv.y * 0.22));
    base *= 0.84 + 0.24 * streak;
    base *= 0.9 + 0.1 * smoothstep(0.0, 0.25, fract(pc.y));
    base *= mix(0.7, 1.0, smoothstep(0.0, 2.5, vWP.y));
  }
  col = base * light;
  col = mix(col, uSnowCol * light, snowAmount(n, vWP));
#endif

#ifdef MODE_PWIN
  // Soviet windows: wooden or plastic frames, a vent pane, curtains, a lamp under the ceiling.
  // The integer part of the UV says which apartment, floor and kind of window this is (build_panelka.py).
  vec2 cell = floor(vUv);
  vec2 f = fract(vUv);
  vec3 light = lightAt(vWP, n);
  float bseed = hash12(floor(vOrigin.xz * 0.37) + uSeedOff);
  float stair = step(3999.5, cell.x);
  float apt = floor(cell.x / 4.0);
  float k = cell.x - apt * 4.0;
  float ah = hash12(vec2(apt * 1.37 + cell.y * 17.31, bseed * 91.7));
  float wh = hash12(cell * vec2(0.731, 1.913) + bseed * 13.1);
  // people come home and go to bed: apartments switch their lights now and then
  float epoch = floor(uTime / 70.0 + ah * 17.0);
  float home = step(hash12(vec2(ah * 31.7, epoch)), uLitAmount * 0.56);
  float lit = home * step(hash12(vec2(wh * 7.3, epoch * 0.37)), k < 0.5 ? 0.8 : 0.62);
  float lk = hash12(vec2(ah, 5.3));
  vec3 lc = lk < 0.6 ? vec3(1.0, 0.64, 0.28) : (lk < 0.86 ? vec3(1.0, 0.8, 0.52) : vec3(0.88, 0.93, 1.0));
  if (k < 0.5 && hash12(vec2(ah, 9.1)) < 0.3) lc = vec3(0.82, 0.96, 1.0);
  lc *= 0.8 + 0.45 * hash12(vec2(wh, 3.3));
  float plastic = step(0.7, hash12(vec2(apt, bseed * 3.1)));
  float fw = plastic > 0.5 ? 0.075 : 0.055;
  // distance to the nearest edge of the window: the outer frame is everything closer than fw
  float edgeD = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float frame = 1.0 - aastep(fw, edgeD);
  float panel = 0.0;
  if (stair > 0.5) {
    frame = max(frame, 1.0 - aastep(fw * 0.5, abs(f.x - 0.5)));
    frame = max(frame, 1.0 - aastep(fw * 0.5, abs(f.y - 0.5)));
  } else if (k > 2.5) {
    // balcony door: glass on top, a painted panel below
    panel = 1.0 - aastep(0.36, f.y);
    frame = max(frame, 1.0 - aastep(fw * 0.4, abs(f.y - 0.36)));
  } else {
    float mx = hash12(vec2(apt * 3.1, bseed)) < 0.5 ? 0.5 : 0.36;
    frame = max(frame, 1.0 - aastep(fw * 0.5, abs(f.x - mx)));
    if (plastic < 0.5) frame = max(frame, (1.0 - aastep(fw * 0.5, abs(f.y - 0.73))) * (1.0 - aastep(mx, f.x)));
  }
  float pxw = max(fwidth(vUv.x), fwidth(vUv.y));
  vec3 vdir = normalize(vWP - uCamPos);
  vec3 refl = skyColor(reflect(vdir, n)) * 0.2;
  vec3 inside;
  float on = lit;
  if (stair > 0.5) {
    // stairwell: a dim bulb on every landing, a few burnt out, lower half painted over
    on = step(hash12(vec2(cell.x * 1.7 + cell.y, bseed)), 0.72);
    inside = vec3(0.95, 0.88, 0.55) * 0.6 * (0.55 + 0.45 * f.y);
    inside *= mix(0.45, 1.0, step(0.5, f.y));
  } else {
    float glow = 0.5 + 0.65 * exp(-dot(f - vec2(0.5, 1.0), f - vec2(0.5, 1.0)) * 3.0);
    inside = lc * glow;
    float ct = hash12(vec2(wh, 1.7));
    // folds fade out before they get thinner than a pixel
    float fold = 0.82 + 0.18 * sin(f.x * 46.0 + wh * 20.0) * (1.0 - smoothstep(0.03, 0.08, pxw));
    vec3 drape = vec3(hash12(vec2(ah, 11.0)), hash12(vec2(ah, 12.0)), hash12(vec2(ah, 13.0))) * 0.55 + 0.25;
    if (ct < 0.3) {
      // curtains drawn: the room glows through the fabric
      inside *= mix(drape, vec3(1.0), 0.3) * fold;
    } else {
      // net curtain in the middle, heavy curtains at the sides
      float side = 1.0 - smoothstep(0.14, 0.19, min(f.x, 1.0 - f.x));
      inside *= mix(vec3(0.95, 0.92, 0.86) * (0.86 + 0.14 * fold), drape * 0.5 * fold, side);
      // a pot plant on the sill
      float px0 = 0.25 + 0.5 * hash12(vec2(wh, 6.0));
      float pot = step(0.78, hash12(vec2(wh, 4.4))) * (1.0 - smoothstep(0.12, 0.2, f.y + abs(f.x - px0) * 1.5));
      inside *= 1.0 - pot * 0.85;
    }
    // somebody watching TV in the dark
    if (lit < 0.5 && hash12(vec2(ah, 2.2)) > 0.94 && home > 0.5) {
      inside = vec3(0.35, 0.5, 1.0) * (0.22 + 0.2 * hash12(vec2(floor(uTime * 4.0), ah)));
      on = 1.0;
    }
  }
  vec3 darkRoom = vec3(0.016, 0.014, 0.016) + light * 0.025 + refl;
  vec3 glass = mix(darkRoom, inside + refl * 0.25, on);
  // frost in the lower corners of the pane
  float frost = smoothstep(0.8, 1.0, 1.0 - min(f.y * 3.0, 1.0) * min(min(f.x, 1.0 - f.x) * 3.0, 1.0));
  glass = mix(glass, uSnowCol * light * 0.8 + glass * 0.3, frost * 0.5 * (1.0 - panel));
  vec3 frameCol = (plastic > 0.5 ? vec3(0.82, 0.82, 0.8) : vec3(0.72, 0.68, 0.6)) * light;
  frameCol = mix(frameCol, vec3(0.5, 0.48, 0.44) * light, panel);
  col = mix(glass, frameCol, max(frame, panel));
  // far away the details melt into the average color, so nothing shimmers
  vec3 avg = mix(darkRoom, stair > 0.5 ? vec3(0.42, 0.38, 0.24) : lc * 0.62, on) * 0.8 + frameCol * 0.2;
  col = mix(col, avg, smoothstep(0.3, 0.7, pxw));
#endif

#ifdef MODE_BGLASS
  // glazed balcony: skis, jars and boxes behind dusty glass, now and then a lamp left on
  vec3 light = lightAt(vWP, n);
  vec3 vdir = normalize(vWP - uCamPos);
  vec3 refl = skyColor(reflect(vdir, n)) * 0.26 + light * 0.03;
  vec2 bc = floor(vec2(dot(vWP.xz, vec2(0.33)), vWP.y / 2.8));
  float bh = hash12(bc + floor(vOrigin.xz * 0.3) + uSeedOff);
  vec2 q = vec2(dot(vWP.xz, vec2(1.0)), vWP.y);
  float junk = step(0.5, vnoise(q * vec2(3.5, 2.5) + bh * 50.0)) * step(fract(vWP.y / 2.8 + 0.2), 0.55);
  vec3 inside = mix(vec3(0.025, 0.022, 0.022), vec3(1.0, 0.7, 0.38) * 0.55, step(0.84, bh));
  inside *= 1.0 - junk * 0.7;
  col = inside + refl;
#endif

#ifdef MODE_SNOW
  #ifdef WORLDUV
  vec2 sp = vWP.xz;
  #else
  vec2 sp = vUv;
  #endif
  vec3 light = lightAt(vWP, n);
  vec3 alb = texture2D(map, sp / uScale).rgb * uTint;
  // drifts: soft waves in the snow
  alb *= 0.9 + 0.12 * vnoise(sp * 0.18 + 4.0) + 0.06 * vnoise(sp * 1.3);
  col = snowShade(alb, vWP, n, light);
#endif

#ifdef MODE_PAD
  // packed snow on driveways and footpaths. uScale = half width.
  // vUv.x = across (-1..1) + 4 * length of the strip in meters, vUv.y = 1 - meters along (panelka.js)
  vec2 p = vWP.xz;
  float padL = floor((vUv.x + 2.0) / 4.0);
  float ux = vUv.x - padL * 4.0;
  float along = 1.0 - vUv.y;
  float ax = ux * uScale;
  vec3 light = lightAt(vWP, vec3(0.0, 1.0, 0.0));
  vec3 snowG = texture2D(map, p / 2.5).rgb * vec3(0.86, 0.87, 0.9);
  snowG *= 0.9 + 0.12 * vnoise(p * 0.18 + 4.0) + 0.06 * vnoise(p * 1.3);
  vec3 packed = texture2D(map, p / 2.0).rgb * uTint * (0.85 + 0.25 * vnoise(p * 0.6));
  float edge = smoothstep(0.62, 1.0, abs(ux) + 0.12 * vnoise(p * 1.7));
  #ifdef STEPS
  // footpaths fade out at their ends instead of stopping in a straight line
  edge = max(edge, 1.0 - smoothstep(0.0, 1.8, min(along, padL - along) + 0.4 * vnoise(p * 2.1)));
  #endif
  vec3 alb = packed;
  #ifdef RUTS
  // two lanes of wheel ruts, darker where the slush shows the asphalt
  float rut = 0.0;
  for (int i = 0; i < 4; i++) {
    float c = (float(i) - 1.5) * 1.55 + (float(i) < 1.5 ? -0.25 : 0.25);
    rut = max(rut, 1.0 - smoothstep(0.12, 0.32, abs(ax - c + 0.12 * sin(along * 0.08))));
  }
  float slush = rut * smoothstep(0.35, 0.75, vnoise(vec2(ax * 2.0, along * 0.15)));
  alb *= 1.0 - rut * 0.25;
  alb = mix(alb, vec3(0.16, 0.15, 0.15) * (0.8 + 0.4 * vnoiseAA(p * 3.0)), slush * 0.75);
  #endif
  #ifdef STEPS
  // trampled path: small footprints, left and right, along the middle
  vec2 fp = vec2(ax * 5.0, along * 2.6);
  vec2 fc = floor(fp);
  vec2 fq = fract(fp) - 0.5;
  float prt = step(0.45, hash12(fc + 3.0)) * step(abs(ax), 0.75) * (1.0 - smoothstep(0.18, 0.3, length(fq * vec2(1.6, 0.8))));
  alb *= 1.0 - prt * 0.14;
  #endif
  // the edges are see-through: strips that cross or join blend into each other and into the snow
  alpha = 1.0 - edge;
  col = snowShade(alb, vWP, vec3(0.0, 1.0, 0.0), light);
  // ice shine under the lamps on the driveway
  #ifdef RUTS
  vec3 vdir = normalize(vWP - uCamPos);
  vec3 refl = lampLight(vWP + vec3(0.0, 0.6, 0.0), reflect(vdir, vec3(0.0, 1.0, 0.0)));
  col += refl * 0.18 * (1.0 - edge) * (0.4 + 0.6 * vnoise(p * 0.5));
  #endif
#endif

#ifdef MODE_ICE
  vec3 light = lightAt(vWP, n);
  vec3 vdir = normalize(vWP - uCamPos);
  vec3 alb = texture2D(map, vWP.xz / 3.0).rgb * uTint;
  float scr = vnoiseAA(vWP.xz * vec2(8.0, 0.8)) * vnoiseAA(vWP.xz * vec2(0.9, 7.0));
  col = alb * light * (0.8 + 0.4 * scr) + skyColor(reflect(vdir, n)) * 0.18 + lampLight(vWP + vec3(0.0, 0.5, 0.0), reflect(vdir, n)) * 0.25;
#endif

#ifdef MODE_KIOSK
  // shelves of a shop that is open all night
  float row = floor(vWP.y * 2.4);
  float shelf = step(0.82, fract(vWP.y * 2.4));
  float goods = hash12(vec2(floor(vUv.x * 4.0), row) + floor(vOrigin.xz));
  vec3 c = vec3(1.0, 0.86, 0.62) * (0.75 + 0.3 * goods);
  c = mix(c, vec3(0.9, 0.35, 0.25), step(0.8, goods) * 0.6);
  c = mix(c, vec3(0.35, 0.6, 0.9), step(goods, 0.12) * 0.5);
  col = c * uGlow * (1.0 - shelf * 0.55);
  fogK = 0.95;
#endif

#ifdef MODE_PRINT
  // a boot print pressed into the snow: a shaded dent with a brighter rim
  vec2 q = vUv - 0.5;
  // sole and heel
  float d = q.y > 0.18 ? length((q - vec2(0.0, 0.3)) * vec2(1.0, 2.4)) * 2.4 : length(q * vec2(1.0, 0.75));
  if (d > 0.5) discard;
  vec3 light = lightAt(vWP, vec3(0.0, 1.0, 0.0));
  col = uSnowCol * light * mix(vec3(0.42, 0.44, 0.52), vec3(1.0), smoothstep(0.3, 0.5, d)) * uTint;
#endif

#ifdef MODE_CARPAINT
  // every parked car has its own factory color from the palette of its model
  float pick = floor(hash12(floor(vOrigin.xz * 3.7) + 0.5) * uPalN);
  vec3 paint = uPal[0];
  for (int i = 1; i < 8; i++) if (float(i) == pick) paint = uPal[i];
  vec3 light = lightAt(vWP, n);
  vec3 vdir = normalize(vWP - uCamPos);
  vec3 rdir = reflect(vdir, n);
  col = paint * light;
  // a little gloss left under the dust: the sky and the lamps
  col += (skyColor(rdir) * 0.07 + lampLight(vWP, rdir) * 0.12) * (0.5 + 0.5 * max(n.y, 0.0));
  // road dirt and salt low on the body
  float hgt = vWP.y - vOrigin.y;
  col = mix(col, vec3(0.36, 0.33, 0.3) * light * 0.6, (1.0 - smoothstep(0.25, 0.6, hgt)) * 0.55);
  // snow stuck to the sides in patches, more of it higher up
  // snow stuck along the upper edges of the doors and under the windows, in soft clumps
  float stick = smoothstep(0.55, 0.75, vnoiseAA(vWP.xz * 11.0 + vWP.y * 3.0) * 0.7 + vnoiseAA(vWP.xz * 31.0) * 0.3);
  float band = smoothstep(0.62, 0.8, hgt) * (1.0 - smoothstep(0.9, 1.0, hgt));
  stick *= band * (1.0 - abs(n.y)) * 0.85;
  col = mix(col, uSnowCol * light, clamp(stick, 0.0, 1.0) * 0.8);
  col = mix(col, uSnowCol * light, snowAmount(n, vWP));
#endif

#ifdef MODE_CARGLASS
  // frosted glass: ice crystals over the dark cabin
  vec3 light = lightAt(vWP, n);
  vec3 vdir = normalize(vWP - uCamPos);
  vec2 fp = vWP.xz * 1.3 + vec2(vWP.y * 1.7, -vWP.y);
  // a thin haze of frost all over, patches of crystals on top of it: big enough to read as a texture
  // close up, and they melt into an even haze farther away instead of crawling
  float fr = vnoiseAA(fp * 7.0) * 0.55 + vnoiseAA(fp * 18.0) * 0.45;
  float frost = 0.3 + 0.45 * smoothstep(0.45, 0.75, fr);
  vec3 dark = vec3(0.03, 0.035, 0.045) + skyColor(reflect(vdir, n)) * 0.18;
  col = mix(dark, uSnowCol * light * 0.8, frost * 0.75);
  col = mix(col, uSnowCol * light, snowAmount(n, vWP));
#endif

#ifdef MODE_FLICK
  col = uTint * uGlow * flicker();
  fogK = 0.9;
#endif

#ifdef MODE_TWIGS
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.5) discard;
  vec3 light = ambient(vec3(0.0, 1.0, 0.0)) * 1.1 + lampLight(vWP, vec3(0.0, 1.0, 0.0)) * 0.6;
  col = t.rgb * uTint * light;
#endif

#ifdef MODE_SPRUCE
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.5) discard;
  vec3 light = ambient(n) * 1.1 + lampLight(vWP, n) * 0.7;
  col = t.rgb * uTint * light;
  float sn = step(0.55, vnoiseAA(vWP.xz * 5.0 + vWP.y * 3.0)) * smoothstep(0.3, 0.7, n.y);
  col = mix(col, uSnowCol * light, sn * 0.85);
#endif

#ifdef MODE_GLOW
  col = uTint * uGlow;
  fogK = 0.95;
#endif

#ifdef MODE_SIGN
  float sh = hash12(floor(vOrigin.xz * 3.0) * 0.37 + n.xz * 5.0 + floor(vWP.y) * 0.11 + uSeedOff);
  vec2 suv = vUv;
  float row = floor(sh * 16.0);
  vec3 s = texture2D(map, vec2(suv.x, (row + suv.y) / 16.0)).rgb;
  float on = 1.0;
  float sh2 = fract(sh * 7.13);
  if (sh2 < 0.12) on = 0.08;
  else if (sh2 < 0.22) on = hash12(vec2(floor(uTime * 8.0), sh * 50.0)) > 0.3 ? 1.0 : 0.1;
  col = s * uGlow * on + vec3(0.02);
  fogK = 0.95;
#endif

  col = applyFog(col, vWP, fogK);
  gl_FragColor = vec4(col, alpha);
}
`;

// ------------------------------------------------------------------ textures

const loader = new THREE.TextureLoader();
const TEX = {};
export function tex(name) {
  if (!TEX[name]) {
    const t = loader.load(`tex/${name}.png`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
    t.colorSpace = THREE.NoColorSpace;
    TEX[name] = t;
  }
  return TEX[name];
}

export function canvasTexture(canvas, repeat = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.colorSpace = THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ material table

const C = (r, g, b) => [r, g, b];

// Materials by name (names from data/blender/build_panelka.py): mode, texture, scale (meters per repeat),
// tint; win = module width, floor height, plinth height for the panel seams.
// Almost everything that faces up gets a cap of snow.
const DEFS = (() => {
  const snow = true;
  const panel = (tex, tint, M, fh, pl, scale = 3) => ({ mode: 'panel', tex, scale, tint, win: [M, fh, pl, 0] });
  const flat = (r, g, b) => ({ mode: 'flat', tint: C(r, g, b), snowcap: snow });
  const tx = (tex, scale, tint) => ({ mode: 'tex', tex, scale, tint, snowcap: snow });
  return {
    pk_panel9: panel('panel', C(0.66, 0.65, 0.62), 3.0, 2.8, 1.0),
    pk_panel9b: panel('panel_b', C(0.66, 0.64, 0.6), 3.0, 2.8, 1.0),
    pk_tile9: panel('tiles', C(0.8, 0.74, 0.64), 3.0, 2.8, 1.0, 0.9),
    pk_panel12: panel('tiles', C(0.82, 0.82, 0.8), 3.0, 2.8, 1.0, 0.9),
    pk_panel16: panel('panel', C(0.72, 0.72, 0.7), 3.0, 2.8, 1.2),
    pk_panel5: panel('panel', C(0.76, 0.72, 0.64), 3.2, 2.7, 0.8),
    pk_brick5: panel('brick_white', C(0.8, 0.8, 0.78), 1000, 1000, 0, 2.2),
    pk_accent: panel('tiles', C(0.34, 0.48, 0.66), 1000, 1000, 0, 0.9),
    pk_plinth: { mode: 'tex', tex: 'panel_b', scale: 2, tint: C(0.42, 0.41, 0.4), snowcap: snow },
    pk_reveal: { mode: 'tex', tex: 'panel', scale: 2, tint: C(0.6, 0.6, 0.58) },
    pk_win: { mode: 'pwin' },
    pk_shopwin: { mode: 'kiosk', glow: 1.15 },
    pk_door: { mode: 'tex', tex: 'metal_white', scale: 1.5, tint: C(0.42, 0.28, 0.2) },
    pk_sill: tx('metal', 1, C(0.62, 0.64, 0.66)),
    // snow blankets on cars and mounds are open sheets: drawn from both sides, or the triangles seen
    // almost edge-on flip away from the camera, vanish and open holes that jump with every step
    pk_snow: { mode: 'snow', tex: 'snow', scale: 2.5, tint: C(0.86, 0.87, 0.9), double: true },
    pk_ground: { mode: 'snow', tex: 'snow', scale: 2.5, tint: C(0.86, 0.87, 0.9), worldUv: true },
    pk_road: { mode: 'pad', tex: 'snow_packed', scale: 4.5, tint: C(0.62, 0.6, 0.58), ruts: true, blend: true },
    pk_drive: { mode: 'pad', tex: 'snow_packed', scale: 3.0, tint: C(0.7, 0.69, 0.68), ruts: true, blend: true },
    pk_path: { mode: 'pad', tex: 'snow_packed', scale: 1.0, tint: C(0.78, 0.78, 0.8), steps: true, blend: true },
    pk_conc: tx('panel', 3, C(0.6, 0.6, 0.58)),
    pk_conc_ns: { mode: 'tex', tex: 'panel', scale: 3, tint: C(0.5, 0.5, 0.48) },
    pk_bal_white: tx('metal_white', 1.5, C(0.88, 0.88, 0.86)),
    pk_bal_green: tx('metal_green', 1.5, C(0.85, 0.95, 0.9)),
    pk_bal_blue: tx('metal_white', 1.5, C(0.42, 0.56, 0.86)),
    pk_bal_brown: tx('metal_white', 1.5, C(0.58, 0.42, 0.32)),
    pk_bal_conc: tx('panel', 2, C(0.68, 0.68, 0.66)),
    pk_siding: tx('metal_white', 0.8, C(0.92, 0.88, 0.76)),
    pk_frame_white: flat(0.8, 0.8, 0.78),
    pk_frame_wood: tx('wood_dark', 1, C(0.95, 0.85, 0.78)),
    pk_bglass: { mode: 'bglass' },
    pk_rail: flat(0.08, 0.08, 0.09),
    pk_paint_green: flat(0.12, 0.34, 0.22),
    pk_paint_blue: flat(0.12, 0.26, 0.58),
    pk_paint_red: flat(0.62, 0.1, 0.08),
    pk_paint_yellow: flat(0.82, 0.64, 0.1),
    pk_paint_white: flat(0.82, 0.82, 0.8),
    pk_paint_orange: flat(0.86, 0.4, 0.08),
    pk_metal: tx('metal', 1.5, C(0.62, 0.64, 0.68)),
    pk_rust: tx('rust', 1.5, C(0.9, 0.78, 0.72)),
    pk_garage_green: tx('metal_green', 2, C(0.9, 0.95, 0.92)),
    pk_garage_white: tx('metal_white', 2, C(0.86, 0.86, 0.84)),
    pk_brick_red: tx('brick_red', 2.4, C(0.92, 0.85, 0.82)),
    pk_wood: tx('planks', 1.2, C(0.85, 0.78, 0.7)),
    pk_wood_dark: tx('wood_dark', 1.2, C(0.9, 0.85, 0.8)),
    pk_roof_tin: tx('metal', 2, C(0.52, 0.54, 0.58)),
    pk_dark: { mode: 'flat', tint: C(0.015, 0.015, 0.02) },
    pk_paper: flat(0.82, 0.8, 0.76),
    pk_ac: flat(0.8, 0.81, 0.82),
    pk_ice: { mode: 'ice', tex: 'snow_packed', tint: C(0.42, 0.46, 0.52) },
    pk_birch: tx('birch', 1, C(0.95, 0.95, 0.95)),
    pk_bark: tx('bark_poplar', 1.2, C(0.8, 0.78, 0.76)),
    pk_twigs: { mode: 'twigs', tex: 'twigs', tint: C(0.9, 0.88, 0.88), sway: true, double: true },
    pk_spruce: { mode: 'spruce', tex: 'spruce', tint: C(0.9, 1.0, 0.95), double: true },
    pk_rubber: flat(0.03, 0.03, 0.03),
    pk_chrome: flat(0.6, 0.62, 0.66),
    pk_headlight: flat(0.62, 0.64, 0.6),
    pk_glow_w: { mode: 'glow', tint: C(0.86, 0.93, 1.0), glow: 1.8 },
    pk_glow_o: { mode: 'glow', tint: C(1.0, 0.62, 0.3), glow: 1.8 },
    pk_glow_bulb: { mode: 'glow', tint: C(1.0, 0.86, 0.6), glow: 1.7 },
    pk_glow_flk: { mode: 'flick', tint: C(1.0, 0.86, 0.6), glow: 1.7 },
    pk_glow_red: { mode: 'glow', tint: C(1.0, 0.12, 0.08), glow: 1.6 },
    pk_glow_off: { mode: 'flat', tint: C(0.1, 0.1, 0.1) },
    pk_glow_win: { mode: 'glow', tint: C(1.0, 0.78, 0.5), glow: 1.2 },
    pk_sign: { mode: 'sign', glow: 1.35 },
    pk_print: { mode: 'print', tint: C(1, 1, 1) },
    // factory colors of each model (kolesa.ru, "Primula, Snezhnaya koroleva i Arakhis"), a little darker for the night
    pk_cp_2101: { mode: 'carpaint', palette: [C(0.78, 0.77, 0.72), C(0.36, 0.06, 0.08), C(0.16, 0.32, 0.2), C(0.12, 0.2, 0.42), C(0.78, 0.68, 0.48), C(0.55, 0.68, 0.78), C(0.82, 0.66, 0.12)] },
    pk_cp_2107: { mode: 'carpaint', palette: [C(0.8, 0.8, 0.78), C(0.72, 0.62, 0.44), C(0.45, 0.06, 0.07), C(0.3, 0.48, 0.62), C(0.1, 0.24, 0.24), C(0.6, 0.62, 0.64), C(0.8, 0.8, 0.78)] },
    pk_cp_2109: { mode: 'carpaint', palette: [C(0.22, 0.23, 0.25), C(0.32, 0.04, 0.08), C(0.45, 0.06, 0.07), C(0.55, 0.66, 0.32), C(0.42, 0.5, 0.58), C(0.6, 0.28, 0.1), C(0.8, 0.8, 0.78)] },
    pk_cp_niva: { mode: 'carpaint', palette: [C(0.82, 0.64, 0.1), C(0.32, 0.36, 0.22), C(0.8, 0.8, 0.78), C(0.72, 0.62, 0.44), C(0.14, 0.28, 0.18)] },
    pk_cp_2141: { mode: 'carpaint', palette: [C(0.6, 0.62, 0.64), C(0.42, 0.3, 0.18), C(0.7, 0.62, 0.48), C(0.15, 0.35, 0.4), C(0.8, 0.8, 0.78), C(0.24, 0.25, 0.27)] },
    pk_carglass: { mode: 'carglass' },
    pk_rim: flat(0.42, 0.43, 0.45),
    pk_turn: flat(0.95, 0.45, 0.08),
    pk_tail: flat(0.55, 0.05, 0.04),
  };
})();

const cache = new Map();
let signAtlas = null;
export function setSignAtlas(t) { signAtlas = t; }

export function namedMaterial(name, fallbackColor) {
  if (cache.has(name)) return cache.get(name);
  const def = DEFS[name] || { mode: 'flat', tint: fallbackColor ? [fallbackColor.r, fallbackColor.g, fallbackColor.b] : C(0.5, 0.5, 0.5) };
  const mat = makeMaterial(def);
  mat.name = name;
  cache.set(name, mat);
  return mat;
}

export function makeMaterial(def) {
  const defines = { ['MODE_' + def.mode.toUpperCase()]: '' };
  let map = null;
  if (def.tex) { map = typeof def.tex === 'string' ? tex(def.tex) : def.tex; defines.HAS_MAP = ''; }
  if (def.mode === 'sign') map = signAtlas;
  if (def.sway) defines.SWAY = '';
  if (def.snowcap) defines.SNOWCAP = '';
  if (def.worldUv) defines.WORLDUV = '';
  if (def.ruts) defines.RUTS = '';
  if (def.steps) defines.STEPS = '';
  const w = def.win || [2, 3.5, 0.5, 0.5];
  const uniforms = {
    ...U,
    map: { value: map },
    uTint: { value: new THREE.Color(...(def.tint || [1, 1, 1])) },
    uScale: { value: def.scale || 1 },
    uWin: { value: new THREE.Vector4(...w) },
    uGlow: { value: def.glow || 1 },
    uPal: { value: Array.from({ length: 8 }, (_, i) => new THREE.Color(...((def.palette || [[0.5, 0.5, 0.5]])[i] || [0.5, 0.5, 0.5]))) },
    uPalN: { value: (def.palette || [0]).length },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines,
    side: def.double ? THREE.DoubleSide : THREE.FrontSide,
    transparent: !!def.blend,
    depthWrite: !def.blend,
  });
}

// ------------------------------------------------------------------ skinned character

// Same fog and lamp light as the world, for the animated player model
export function makeSkinnedMaterial(map) {
  if (map) {
    map.colorSpace = THREE.NoColorSpace;
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestMipmapLinearFilter;
    map.needsUpdate = true;
  }
  return new THREE.ShaderMaterial({
    uniforms: { ...U, map: { value: map } },
    vertexShader: /* glsl */`
      ${COMMON}
      #include <skinning_pars_vertex>
      varying vec3 vWP;
      varying vec3 vN;
      varying vec2 vUv;
      void main() {
        #include <skinbase_vertex>
        #include <beginnormal_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        vWP = wp.xyz;
        vN = normalize(mat3(modelMatrix) * objectNormal);
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      ${COMMON}
      uniform sampler2D map;
      varying vec3 vWP;
      varying vec3 vN;
      varying vec2 vUv;
      void main() {
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        vec3 alb = texture2D(map, vUv).rgb;
        // a touch of cold rim light so the silhouette reads against the dark street
        vec3 v = normalize(uCamPos - vWP);
        float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 col = alb * (lightAt(vWP, n) * 1.3 + 0.04) + uMist * rim * 0.12;
        col = applyFog(col, vWP, 1.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ------------------------------------------------------------------ sky

export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      ${COMMON}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        // layered clouds
        vec2 cp = d.xz / max(d.y + 0.08, 0.05) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
        float cl = vnoise(cp) * 0.6 + vnoise(cp * 2.3) * 0.4;
        c = mix(c, uMist * 0.85, smoothstep(0.5, 0.85, cl) * 0.35 * smoothstep(0.02, 0.3, d.y));
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
