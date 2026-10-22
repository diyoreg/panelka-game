// Panelka shaders. Everything is computed in display color space, no tone mapping:
// a stylized image with hand-tuned colors.
//
// Lamps are free-standing: the world sends the nearest PK_LIGHTS of them to every shader
// in uPL / uPC (panelka.js).

import * as THREE from 'three';

export const PK_LIGHTS = 24;
// insides of the khrushchyovka (interiors.js): sections drawn with their rooms, switched lights, rooms of the plan
export const SEC_MAX = 6;
export const OV_MAX = 32;
export const ROOM_BOXES = 24;
export const ROOM_N = 16;

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
  uSecN: { value: 0 },
  uSecInv: { value: Array.from({ length: SEC_MAX }, () => new THREE.Matrix4()) },
  uSecData: { value: Array.from({ length: SEC_MAX }, () => new THREE.Vector4()) },
  uSecBox: { value: Array.from({ length: SEC_MAX }, () => new THREE.Vector4()) },
  uOv: { value: Array.from({ length: OV_MAX }, () => new THREE.Vector4(0, 0, 0, -1)) },
  uRoomBox: { value: Array.from({ length: ROOM_BOXES }, () => new THREE.Vector4(0, 0, -1, -1)) },
  uRoomBoxId: { value: new Array(ROOM_BOXES).fill(-1) },
  uRoomLamp: { value: Array.from({ length: ROOM_N }, () => new THREE.Vector4(0, 0, 2, 4)) },
  uRoomInfo: { value: Array.from({ length: ROOM_N }, () => new THREE.Vector4()) },
  uPlan: { value: new THREE.Vector4(16, 11.4, 1.1, 2.7) },
  uPlanTop: { value: new THREE.Vector2(14.6, 0.3) },
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

// ---- inside the khrushchyovka. Sections near the camera have their rooms drawn (interiors.js). A point inside
// one of them is lit only by the lamp of its own room, so light never leaks through walls and floors.
// Whether a room is lit comes from an integer hash of building, section, floor and room, the same one
// interiors.js computes, plus the switches people flipped (uOv). The facade windows use it too.
uniform float uSecN;
uniform mat4 uSecInv[${SEC_MAX}];   // world -> plan of the section: x along it, y up, z from the entrance facade
uniform vec4 uSecData[${SEC_MAX}];  // building id x, z, section index
uniform vec4 uSecBox[${SEC_MAX}];   // its world xz bounds
uniform vec4 uOv[${OV_MAX}];        // switched lights: building id x, z, section * 100 + floor * 16 + room, on (w < 0 ends)
uniform vec4 uRoomBox[${ROOM_BOXES}];
uniform float uRoomBoxId[${ROOM_BOXES}];
uniform vec4 uRoomLamp[${ROOM_N}];   // x, plan y, height above the floor, range
uniform vec4 uRoomInfo[${ROOM_N}];   // apartment, kind (0 stairwell, 1 kitchen, 2 bath, 3 hall, 4 room)
uniform vec4 uPlan;                 // section width, depth, first floor level, floor height
uniform vec2 uPlanTop;              // roof level, entrance hall floor

uint hmix(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return x;
}
uint hkey(ivec2 b, int sec, int fl, int salt) {
  uint h = hmix(uint(b.x) * 0x9e3779b1u ^ hmix(uint(b.y) + 0x632be5abu));
  return hmix(h ^ uint(sec * 131 + fl * 17 + salt * 7919 + 1));
}
float hfrac(ivec2 b, int sec, int fl, int salt) { return float(hkey(b, sec, fl, salt) % 1000u) / 1000.0; }

int roomAt(vec2 q) {
  for (int i = 0; i < ${ROOM_BOXES}; i++) {
    vec4 r = uRoomBox[i];
    if (q.x > r.x && q.x < r.z && q.y > r.y && q.y < r.w) return int(uRoomBoxId[i]);
  }
  return -1;
}

bool roomLit(ivec2 b, int sec, int fl, int room) {
  float code = float(sec * 100 + fl * 16 + room);
  for (int i = 0; i < ${OV_MAX}; i++) {
    vec4 o = uOv[i];
    if (o.w < -0.5) break;
    if (o.x == float(b.x) && o.y == float(b.y) && o.z == code) return o.w > 0.5;
  }
  if (room == 0) return hkey(b, sec, fl, 1) % 100u < 85u;
  int apt = int(uRoomInfo[room].x);
  int kind = int(uRoomInfo[room].y);
  if (hkey(b, sec, fl, 10 + apt) % 100u >= 62u) return false;
  uint p = kind == 1 ? 70u : kind == 3 ? 45u : kind == 2 ? 22u : 58u;
  return hkey(b, sec, fl, 30 + room) % 100u < p;
}
// 0: Soviet furniture and finishes, 1: the 2000s
float aptStyle(ivec2 b, int sec, int fl, int apt) { return hkey(b, sec, fl, 50 + apt) % 100u < 58u ? 0.0 : 1.0; }
vec3 lampColor(ivec2 b, int sec, int fl, int apt, int kind, float style) {
  float h = hfrac(b, sec, fl, 40 + apt * 4 + kind);
  if (kind == 0) return vec3(1.0, 0.86, 0.64);
  if (kind == 1 && h < 0.35) return vec3(0.86, 0.95, 1.0);
  if (style > 0.5) return h < 0.5 ? vec3(1.0, 0.9, 0.76) : vec3(0.96, 0.94, 0.88);
  return vec3(1.0, 0.82, 0.6) * (0.92 + 0.16 * h);
}

// Loaded section at a world point and the plan coordinates there, or -1.
// inner: only the inside, between the inner faces of the facades and under the roof.
int sectionAt(vec3 wp, bool inner, out vec3 lp) {
  lp = vec3(0.0);
  for (int i = 0; i < ${SEC_MAX}; i++) {
    if (float(i) >= uSecN) break;
    vec4 bx = uSecBox[i];
    if (wp.x < bx.x || wp.x > bx.z || wp.z < bx.y || wp.z > bx.w) continue;
    lp = (uSecInv[i] * vec4(wp, 1.0)).xyz;
    if (inner) {
      if (lp.x >= 0.0 && lp.x <= uPlan.x && lp.z > 0.17 && lp.z < uPlan.y - 0.17 && lp.y > 0.05 && lp.y < uPlanTop.x - 0.17) return i;
    } else if (lp.x >= -0.3 && lp.x <= uPlan.x + 0.3 && lp.z > -0.3 && lp.z < uPlan.y + 0.3 && lp.y > -0.5 && lp.y < uPlanTop.x + 0.6) {
      return i;
    }
  }
  return -1;
}
bool insideLoaded(vec3 wp) {
  vec3 lp;
  return uSecN > 0.5 && sectionAt(wp, true, lp) >= 0;
}
bool sectionLoaded(vec3 wp) {
  vec3 lp;
  return uSecN > 0.5 && sectionAt(wp, false, lp) >= 0;
}

// filled by probeInterior() at the start of a fragment shader
float gIn = 0.0;
int gRoom = -1;
int gKind = -1;
int gApt = 0;
int gFl = 0;
int gSec = 0;
ivec2 gB = ivec2(0);
float gLit = 0.0;
float gStyle = 0.0;
vec3 gLP = vec3(0.0);
vec3 gLN = vec3(0.0, 1.0, 0.0);
vec3 gLampCol = vec3(1.0);
vec3 gInLight = vec3(0.0);

void probeInterior(vec3 wp, vec3 n) {
  if (uSecN < 0.5) return;
  vec3 lp;
  int i = sectionAt(wp, true, lp);
  if (i < 0) return;
  gIn = 1.0;
  vec3 ln = normalize(mat3(uSecInv[i]) * n);
  gLP = lp;
  gLN = ln;
  gB = ivec2(uSecData[i].xy);
  gSec = int(uSecData[i].z);
  gFl = int(clamp(floor((lp.y - uPlan.z + 0.15) / uPlan.w), 0.0, 4.0));
  // the room in front of the surface: a wall face belongs to the room it looks into
  int room = roomAt(lp.xz + ln.xz * 0.25);
  if (room < 0) room = roomAt(lp.xz + ln.xz * 0.6);
  if (room < 0) room = roomAt(lp.xz);
  gRoom = room;
  // the street glow through the windows: enough to find your way in a dark flat
  vec3 amb = vec3(0.085, 0.085, 0.1);
  if (room < 0) { gInLight = amb; return; }
  gApt = int(uRoomInfo[room].x);
  gKind = int(uRoomInfo[room].y);
  gStyle = gApt > 0 ? aptStyle(gB, gSec, gFl, gApt) : 0.0;
  bool on = roomLit(gB, gSec, gFl, room);
  gLit = on ? 1.0 : 0.0;
  gLampCol = lampColor(gB, gSec, gFl, gApt, gKind, gStyle);
  vec4 L = uRoomLamp[room];
  vec3 lpos = vec3(L.x, uPlan.z + float(gFl) * uPlan.w + L.z, L.y);
  // the entrance hall has its own bulb under the first half landing
  if (room == 0 && lp.y < uPlan.z + 0.9 && lp.z < 2.75) lpos = vec3(8.0, uPlan.z + 1.35 - 0.38, 1.2);
  vec3 d = lpos - lp;
  float d2 = dot(d, d);
  float dist = sqrt(d2);
  float att = 1.0 / (1.0 + d2 * 2.5 / (L.w * L.w)) * (1.0 - smoothstep(L.w * 0.55, L.w, dist));
  float ndl = 0.3 + 0.7 * max(dot(ln, d / max(dist, 1e-3)), 0.0);
  // direct light plus the light bounced around a small room
  gInLight = amb + (on ? gLampCol * (att * ndl * 0.78 + 0.12) : vec3(0.0));
}

vec3 lightAt(vec3 p, vec3 n) { return gIn > 0.5 ? gInLight : ambient(n) + lampLight(p, n); }

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
uniform float uVar;
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

vec3 pick4(float h, vec3 a, vec3 b, vec3 c, vec3 d) { return h < 0.25 ? a : h < 0.5 ? b : h < 0.75 ? c : d; }

// 1 on the grout between square tiles of this size
float grout(vec2 p, float size, float w) {
  vec2 g = abs(fract(p / size + 0.5) - 0.5) * size;
  return 1.0 - aastep(w, min(g.x, g.y));
}

// ---- finishes inside the khrushchyovka, picked per room from the hash (gRoom, gStyle from probeInterior)

// Height of the steps or landing under a point of the stairwell (plan x, height, plan y)
float stairFloor(vec3 lp) {
  float pl = uPlan.z, fh = uPlan.w;
  if (lp.y < pl - 0.1 && lp.z < 2.7) return uPlanTop.y;
  float slope, base;
  if (lp.z >= 3.81) { slope = 0.0; base = 0.0; }
  else if (lp.z <= 1.85) { slope = 0.0; base = fh * 0.5; }
  else if (lp.x < 8.0) { slope = 1.0; base = (3.81 - lp.z) / 1.96 * fh * 0.5; }
  else { slope = 1.0; base = fh * 0.5 + (lp.z - 1.85) / 1.96 * fh * 0.5; }
  float f = floor((lp.y - pl - base + 0.2) / fh);
  return pl + f * fh + base;
}

vec3 wallFinish() {
  float along = abs(gLN.x) > 0.5 ? gLP.z : gLP.x;
  float hr = gLP.y - (uPlan.z + float(gFl) * uPlan.w);
  vec2 p = vec2(along, gLP.y);
  float n1 = vnoiseAA(p * 3.0), n2 = vnoiseAA(p * 0.7);
  if (gRoom <= 0) {
    // stairwell: oil paint up to 1.5 m above the steps, running up along the flights, whitewash above,
    // a dark line between, scuffs on the paint
    vec3 paint = pick4(hfrac(gB, gSec, 0, 90), vec3(0.3, 0.46, 0.37), vec3(0.3, 0.4, 0.56), vec3(0.44, 0.43, 0.3), vec3(0.47, 0.27, 0.22));
    float lvl = gLP.y - stairFloor(gLP);
    float lower = 1.0 - aastep(1.5, lvl);
    vec3 c = mix(vec3(0.76, 0.75, 0.7) * (0.9 + 0.1 * n2), paint * (0.88 + 0.12 * n1), lower);
    return mix(c, paint * 0.5, 1.0 - aastep(0.02, abs(lvl - 1.5)));
  }
  uint vh = hkey(gB, gSec, gFl, 70 + gRoom);
  float v1 = float(vh % 97u) / 97.0, v2 = float((vh / 97u) % 89u) / 89.0;
  float xp = gStyle;
  if (gKind == 2) {
    // bath: tiles up to 1.6 m and paint above in the Soviet flat, tiles all the way up in the 2000s
    vec3 tile = xp > 0.5 ? pick4(v1, vec3(0.45, 0.6, 0.75), vec3(0.55, 0.72, 0.6), vec3(0.85, 0.78, 0.65), vec3(0.8, 0.62, 0.66))
                         : pick4(v1, vec3(0.86, 0.87, 0.85), vec3(0.74, 0.84, 0.88), vec3(0.78, 0.86, 0.78), vec3(0.86, 0.86, 0.84));
    float size = xp > 0.5 ? 0.2 : 0.15;
    vec2 t = vec2(along, hr);
    vec3 c = mix(tile * (0.95 + 0.07 * hash12(floor(t / size))), tile * 0.6, grout(t, size, 0.006));
    if (xp > 0.5) c = mix(c, tile * 0.55, 1.0 - aastep(0.04, abs(hr - 1.05)));
    else c = mix(c, vec3(0.72, 0.78, 0.8) * (0.9 + 0.1 * n2), aastep(1.6, hr));
    return c;
  }
  if (gKind == 1 && xp < 0.5) {
    // Soviet kitchen: oil paint up to 1.5 m, whitewash above
    vec3 paint = pick4(v1, vec3(0.62, 0.74, 0.66), vec3(0.62, 0.7, 0.78), vec3(0.8, 0.74, 0.58), vec3(0.74, 0.78, 0.6));
    vec3 c = mix(paint * (0.92 + 0.08 * n1), vec3(0.8, 0.79, 0.74) * (0.92 + 0.08 * n2), aastep(1.5, hr));
    return mix(c, paint * 0.55, 1.0 - aastep(0.015, abs(hr - 1.5)));
  }
  vec3 bg, fg;
  if (xp > 0.5) {
    bg = pick4(v1, vec3(0.88, 0.8, 0.68), vec3(0.84, 0.84, 0.8), vec3(0.88, 0.84, 0.66), vec3(0.78, 0.84, 0.72));
    fg = bg * 0.88;
  } else {
    bg = pick4(v1, vec3(0.78, 0.7, 0.54), vec3(0.6, 0.68, 0.54), vec3(0.74, 0.6, 0.55), vec3(0.62, 0.66, 0.7));
    if (gKind == 3) bg *= 0.82;
    fg = pick4(v2, bg * 0.6, vec3(0.55, 0.42, 0.25), bg * 1.15, vec3(0.45, 0.25, 0.22));
  }
  float pat;
  float kind = xp > 0.5 ? (v2 < 0.5 ? 4.0 : 5.0) : floor(v2 * 3.999);
  if (kind < 0.5) {
    // stripes with a little flower in every second one
    float col3 = floor(along * 3.0);
    pat = 1.0 - aastep(0.06, abs(fract(along * 3.0) - 0.5));
    vec2 q = vec2(fract(along * 3.0) - 0.5, fract(hr * 3.0 + col3 * 0.5) - 0.5);
    pat = max(pat, (1.0 - aastep(0.12, length(q * vec2(1.0, 1.4)))) * step(0.5, mod(col3, 2.0)));
  } else if (kind < 1.5) {
    // damask diamonds
    vec2 q = vec2(along * 4.0, hr * 3.0);
    q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5;
    vec2 c = abs(fract(q) - 0.5);
    pat = (1.0 - aastep(0.22, c.x + c.y * 0.8)) * (0.6 + 0.4 * (1.0 - aastep(0.12, c.x + c.y * 0.8)));
  } else if (kind < 2.5) {
    // little four-petal flowers on a grid
    vec2 q = fract(vec2(along * 5.0, hr * 5.0 + floor(along * 5.0) * 0.5)) - 0.5;
    pat = 1.0 - aastep(0.12 + 0.08 * cos(atan(q.y, q.x) * 4.0), length(q));
  } else if (kind < 3.5) {
    // wide vertical bands with a thin line between
    float sx = fract(along * 1.6);
    pat = step(0.5, sx) * 0.5 + (1.0 - aastep(0.02, abs(sx - 0.5))) * 0.5;
  } else if (kind < 4.5) {
    pat = vnoiseAA(vec2(along * 40.0, hr * 2.0)) * 0.4;
  } else {
    pat = vnoiseAA(vec2(along, hr) * 18.0) * 0.35;
  }
  vec3 c = mix(bg, fg, clamp(pat, 0.0, 1.0)) * (0.9 + 0.1 * n2);
  // tiles behind the stove and the sink in the 2000s kitchen
  if (gKind == 1) c = mix(c, mix(vec3(0.92, 0.9, 0.86), vec3(0.6), grout(vec2(along, hr), 0.1, 0.004)), aastep(0.9, hr) - aastep(1.5, hr));
  return c;
}

vec3 floorFinish() {
  vec2 q = gLP.xz;
  float n1 = vnoiseAA(q * 2.0);
  if (gRoom < 0) return vec3(0.45, 0.32, 0.2) * (0.9 + 0.1 * n1);
  if (gRoom == 0) {
    // stairwell: little Metlakh tiles, brown and beige, dirtier where people walk
    vec2 c = floor(q / 0.1);
    vec3 t = mix(vec3(0.5, 0.3, 0.2), vec3(0.72, 0.62, 0.48), mod(c.x + c.y, 2.0)) * (0.9 + 0.1 * hash12(c));
    return mix(t, t * 0.6, grout(q, 0.1, 0.004)) * (0.8 + 0.2 * vnoiseAA(q * 0.7));
  }
  uint vh = hkey(gB, gSec, gFl, 80 + gRoom);
  float v1 = float(vh % 97u) / 97.0, v2 = float((vh / 97u) % 89u) / 89.0;
  float xp = gStyle;
  if (gKind == 2) {
    float size = xp > 0.5 ? 0.3 : 0.1;
    vec3 t = xp > 0.5 ? vec3(0.62, 0.6, 0.58) : pick4(v1, vec3(0.6, 0.45, 0.35), vec3(0.72, 0.68, 0.6), vec3(0.55, 0.55, 0.52), vec3(0.65, 0.5, 0.4));
    vec2 c = floor(q / size);
    if (xp < 0.5) t = mix(t, t * 0.75, mod(c.x + c.y, 2.0) * step(0.5, v2));
    return mix(t * (0.94 + 0.08 * hash12(c)), t * 0.55, grout(q, size, 0.005));
  }
  if (gKind == 1 || gKind == 3) {
    if (xp > 0.5) {
      vec3 t = pick4(v1, vec3(0.78, 0.72, 0.62), vec3(0.62, 0.58, 0.54), vec3(0.8, 0.78, 0.74), vec3(0.6, 0.48, 0.36));
      return mix(t * (0.95 + 0.06 * hash12(floor(q / 0.3))), t * 0.6, grout(q, 0.3, 0.004));
    }
    // linoleum with a printed pattern
    vec3 base = pick4(v1, vec3(0.5, 0.36, 0.24), vec3(0.45, 0.48, 0.42), vec3(0.62, 0.55, 0.42), vec3(0.55, 0.28, 0.2));
    float pat;
    if (v2 < 0.33) {
      vec2 g = abs(fract(q / 0.25) - 0.5);
      pat = 1.0 - aastep(0.04, min(g.x, g.y));
    } else if (v2 < 0.66) {
      vec2 g = abs(fract(q / 0.3) - 0.5);
      pat = 1.0 - aastep(0.12, g.x + g.y);
    } else {
      pat = step(0.55, vnoiseAA(q * 6.0)) * 0.6;
    }
    return mix(base, base * 0.7, pat) * (0.88 + 0.12 * n1);
  }
  if (xp > 0.5) {
    // laminate: 19 cm planks with staggered joints
    float row = floor(q.x / 0.19);
    float y = q.y + hash12(vec2(row, 3.0)) * 1.2;
    vec3 t = vec3(0.68, 0.52, 0.34) * (0.88 + 0.16 * hash12(vec2(row, floor(y / 1.2))));
    t *= 0.92 + 0.08 * vnoiseAA(vec2(q.x * 60.0, y * 4.0));
    float seam = max(1.0 - aastep(0.004, abs(fract(q.x / 0.19 + 0.5) - 0.5) * 0.19), 1.0 - aastep(0.004, abs(fract(y / 1.2 + 0.5) - 0.5) * 1.2));
    return mix(t, t * 0.6, seam);
  }
  if (v1 < 0.35) {
    // painted floorboards
    float row = floor(q.y / 0.13);
    vec3 t = vec3(0.42, 0.19, 0.12) * (0.92 + 0.12 * hash12(vec2(row, 1.0))) * (0.85 + 0.15 * vnoiseAA(vec2(q.x * 2.0, q.y * 20.0)));
    return mix(t, t * 0.5, 1.0 - aastep(0.005, abs(fract(q.y / 0.13 + 0.5) - 0.5) * 0.13));
  }
  // parquet in square blocks, the planks turning in every other block
  vec2 cb = floor(q / 0.42);
  vec2 l = fract(q / 0.42);
  float dir = mod(cb.x + cb.y, 2.0);
  float s = dir > 0.5 ? l.x : l.y;
  float al = dir > 0.5 ? l.y : l.x;
  vec3 t = vec3(0.55, 0.36, 0.19) * (0.85 + 0.2 * hash12(cb * 7.0 + floor(s * 6.0)));
  t *= 0.9 + 0.1 * vnoiseAA(vec2(al * 30.0, s * 4.0 + cb.x * 3.0));
  float seam = max(1.0 - aastep(0.006, abs(fract(s * 6.0 + 0.5) - 0.5) / 6.0 * 0.42),
                   1.0 - aastep(0.006, min(min(l.x, 1.0 - l.x), min(l.y, 1.0 - l.y)) * 0.42));
  return mix(t, t * 0.55, seam) * (0.9 + 0.1 * n1);
}

vec3 ceilFinish() {
  float n = vnoiseAA(gLP.xz * 1.5);
  if (gRoom == 0) return vec3(0.6, 0.6, 0.58) * (0.85 + 0.15 * n);
  return (gStyle > 0.5 ? vec3(0.86, 0.86, 0.84) : vec3(0.8, 0.8, 0.76)) * (0.94 + 0.06 * n);
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
  #ifdef HIDE_LOADED
  // stand-ins on the facade (window glass, the entrance door, the hatch) give way to the real ones
  if (sectionLoaded(vWP)) discard;
  #endif
  probeInterior(vWP, n);
  vec3 col;
  float fogK = 1.0;
  float alpha = 1.0;

#if defined(MODE_TEX) || defined(MODE_FLAT)
  vec3 light = lightAt(vWP, n);
  col = baseColor() * light;
  // contact shadow near the ground, outdoors only
  col *= mix(mix(0.55, 1.0, smoothstep(0.0, 1.6, vWP.y - 0.1)), 1.0, gIn);
  #ifdef SNOWCAP
  col = mix(col, uSnowCol * light, snowAmount(n, vWP) * (1.0 - gIn));
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
  float stair, apt, k, ah, wh, home, lit, plastic;
  float stairOn = -1.0;
  vec3 lc;
  if (cell.x > 9999.5) {
    // the khrushchyovka with interiors: room, section and floor from the cell, lit like the room behind it
    ivec2 b = ivec2(round(vOrigin.x * 2.0), round(vOrigin.z * 2.0));
    float cy = cell.y;
    k = step(499.5, cy) * 3.0;
    cy -= k > 0.5 ? 500.0 : 0.0;
    int sec = int(floor(cy / 10.0 + 0.01));
    int fl = int(cy + 0.01) - sec * 10;
    int room = int(cell.x + 0.01) - 10000;
    int ra = int(uRoomInfo[room].x);
    int rk = int(uRoomInfo[room].y);
    if (k < 0.5) k = rk == 1 ? 0.0 : 1.0;
    stair = room == 0 ? 1.0 : 0.0;
    apt = float(ra * 7 + sec * 31 + fl * 3);
    ah = hfrac(b, sec, fl, 60 + ra);
    wh = hfrac(b, sec, fl, 64 + room);
    home = hkey(b, sec, fl, 10 + ra) % 100u < 62u ? 1.0 : 0.0;
    lit = roomLit(b, sec, fl, room) ? 1.0 : 0.0;
    if (room == 0) stairOn = lit;
    float st = aptStyle(b, sec, fl, ra);
    lc = lampColor(b, sec, fl, ra, rk, st);
    plastic = st;
  } else {
    stair = step(3999.5, cell.x);
    apt = floor(cell.x / 4.0);
    k = cell.x - apt * 4.0;
    ah = hash12(vec2(apt * 1.37 + cell.y * 17.31, bseed * 91.7));
    wh = hash12(cell * vec2(0.731, 1.913) + bseed * 13.1);
    // who is at home and which rooms are lit stays the same all night
    float epoch = floor(ah * 17.0);
    home = step(hash12(vec2(ah * 31.7, epoch)), uLitAmount * 0.56);
    lit = home * step(hash12(vec2(wh * 7.3, epoch * 0.37)), k < 0.5 ? 0.8 : 0.62);
    float lk = hash12(vec2(ah, 5.3));
    lc = lk < 0.6 ? vec3(1.0, 0.64, 0.28) : (lk < 0.86 ? vec3(1.0, 0.8, 0.52) : vec3(0.88, 0.93, 1.0));
    if (k < 0.5 && hash12(vec2(ah, 9.1)) < 0.3) lc = vec3(0.82, 0.96, 1.0);
    lc *= 0.8 + 0.45 * hash12(vec2(wh, 3.3));
    plastic = step(0.7, hash12(vec2(apt, bseed * 3.1)));
  }
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
    on = stairOn >= 0.0 ? stairOn : step(hash12(vec2(cell.x * 1.7 + cell.y, bseed)), 0.72);
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

#ifdef MODE_WALLINT
  col = wallFinish() * lightAt(vWP, n);
#endif

#ifdef MODE_FLOORINT
  col = floorFinish() * lightAt(vWP, n);
  // varnish and linoleum catch a little of the lamp
  col += gLampCol * gLit * (gKind == 4 ? 0.04 : 0.025);
#endif

#ifdef MODE_CEILINT
  col = ceilFinish() * lightAt(vWP, n);
#endif

#ifdef MODE_CARPET
  {
    vec2 c = abs(vUv - 0.5) * 2.0;
    float v1 = hfrac(gB, gSec, gFl, 100 + max(gRoom, 0) + int(uVar) * 7);
    vec3 cc;
    if (uVar > 0.5) {
      // a plain modern rug with a border
      vec3 base = pick4(v1, vec3(0.5, 0.46, 0.42), vec3(0.35, 0.38, 0.42), vec3(0.55, 0.48, 0.36), vec3(0.42, 0.3, 0.28));
      cc = mix(base, base * 0.65, step(0.88, max(c.x, c.y)));
    } else {
      // the carpet: dark and light borders, an ornament band, a medallion, little motifs in the field
      vec3 base = pick4(v1, vec3(0.5, 0.08, 0.09), vec3(0.42, 0.12, 0.08), vec3(0.18, 0.2, 0.38), vec3(0.45, 0.25, 0.1));
      vec3 b2 = vec3(0.85, 0.75, 0.55), b3 = vec3(0.08, 0.08, 0.12);
      float m = max(c.x, c.y);
      cc = mix(base, b3, step(0.92, m));
      cc = mix(cc, b2, step(0.86, m) * (1.0 - step(0.92, m)));
      vec2 o = fract(vUv * vec2(14.0, 10.0)) - 0.5;
      cc = mix(cc, b2 * 0.8, step(0.74, m) * (1.0 - step(0.86, m)) * (1.0 - aastep(0.25, abs(o.x) + abs(o.y))));
      float md = c.x * 0.8 + c.y;
      float field = 1.0 - step(0.74, m);
      cc = mix(cc, b3, (1.0 - aastep(0.35, md)) * 0.9 * field);
      cc = mix(cc, b2, (1.0 - aastep(0.2, md)) * field);
      cc = mix(cc, base * 1.3, (1.0 - aastep(0.1, md)) * field);
      vec2 f2 = fract(vUv * vec2(6.0, 4.0)) - 0.5;
      cc = mix(cc, b2 * 0.7, (1.0 - aastep(0.18, abs(f2.x) + abs(f2.y))) * field * aastep(0.35, md) * 0.8);
    }
    col = cc * (0.88 + 0.12 * vnoiseAA(vUv * 60.0)) * lightAt(vWP, n);
  }
#endif

#ifdef MODE_FABRIC
  {
    float v1 = hfrac(gB, gSec, gFl, 120 + gApt * 9 + int(uVar));
    float v2 = hfrac(gB, gSec, gFl, 130 + gApt * 9 + int(uVar));
    vec3 c;
    if (uVar < 0.5) c = gStyle > 0.5 ? pick4(v1, vec3(0.45, 0.42, 0.38), vec3(0.3, 0.32, 0.36), vec3(0.55, 0.5, 0.42), vec3(0.4, 0.22, 0.18))
                                     : pick4(v1, vec3(0.42, 0.26, 0.16), vec3(0.28, 0.36, 0.24), vec3(0.5, 0.16, 0.14), vec3(0.55, 0.42, 0.18));
    else if (uVar < 1.5) c = pick4(v1, vec3(0.5, 0.32, 0.18), vec3(0.3, 0.38, 0.26), vec3(0.6, 0.42, 0.2), vec3(0.45, 0.2, 0.22)) * (gStyle > 0.5 ? 1.15 : 1.0);
    else if (uVar < 2.5) c = pick4(v1, vec3(0.7, 0.55, 0.55), vec3(0.55, 0.62, 0.72), vec3(0.75, 0.7, 0.5), vec3(0.6, 0.7, 0.6));
    else if (uVar < 3.5) c = pick4(v1, vec3(0.4, 0.5, 0.65), vec3(0.65, 0.4, 0.35), vec3(0.45, 0.6, 0.45), vec3(0.6, 0.55, 0.4));
    else if (uVar < 4.5) c = gStyle > 0.5 ? pick4(v1, vec3(0.82, 0.78, 0.65), vec3(0.62, 0.72, 0.6), vec3(0.6, 0.2, 0.18), vec3(0.6, 0.65, 0.72)) : vec3(0.85, 0.84, 0.8);
    else c = vec3(0.36, 0.2, 0.14);
    vec3 pp = vWP * 18.0;
    c *= 0.9 + 0.1 * vnoiseAA(pp.xz + pp.y);
    // a print on curtains and bed covers
    if (uVar > 0.5 && uVar < 3.5 && v2 < 0.6) {
      vec2 q = fract(vec2(dot(vWP.xz, vec2(0.7)) * 6.0, vWP.y * 6.0)) - 0.5;
      c = mix(c, c * 1.35, 1.0 - aastep(0.15, length(q)));
    }
    col = c * lightAt(vWP, n);
  }
#endif

#ifdef MODE_TULLE
  {
    // a fine net with small flowers, more see-through than not
    float flower = 1.0 - aastep(0.14, length(fract(vUv * vec2(18.0, 22.0)) - 0.5));
    float border = 1.0 - aastep(0.06, vUv.y);
    col = vec3(0.93, 0.93, 0.9) * lightAt(vWP, n);
    alpha = 0.2 + 0.1 * flower + 0.15 * border;
  }
#endif

#ifdef MODE_GLASSINT
  col = skyColor(reflect(normalize(vWP - uCamPos), n)) * 0.3 + gInLight * 0.2;
  alpha = 0.16;
#endif

#ifdef MODE_MIRROR
  {
    vec3 vdir = normalize(vWP - uCamPos);
    float sheen = 0.5 + 0.5 * sin(dot(vWP, vec3(3.1, 1.7, 2.3)) + dot(vdir, vec3(4.0)));
    col = vec3(0.62, 0.67, 0.72) * (lightAt(vWP, n) * 1.05 + 0.06) * (0.85 + 0.25 * sheen);
  }
#endif

#ifdef MODE_LAMPSHADE
  if (gLit > 0.5) {
    col = gLampCol * uTint * 1.7;
    fogK = 0.9;
  } else {
    col = uTint * 0.6 * lightAt(vWP, n) + vec3(0.02);
  }
#endif

#ifdef MODE_SCREENTV
  {
    // the TV is on in most lit rooms and in a few dark ones
    float on = gLit > 0.5 ? step(hfrac(gB, gSec, gFl, 95 + gRoom), 0.75) : step(hfrac(gB, gSec, gFl, 97 + gRoom), 0.1);
    float t = floor(uTime * 0.4 + hfrac(gB, gSec, gFl, 99) * 10.0);
    vec2 blk = floor(vUv * vec2(6.0, 5.0));
    vec3 img = vec3(hash12(blk + t), hash12(blk + t + 3.1), hash12(blk + t + 7.7));
    img = mix(vec3(0.35, 0.45, 0.6), img, 0.45) * (0.75 + 0.25 * hash12(vec2(t, 1.0)));
    img *= 0.85 + 0.15 * step(0.5, fract(vUv.y * 60.0));
    vec2 cc = vUv - 0.5;
    img *= 1.0 - dot(cc, cc) * 1.4;
    vec3 off = vec3(0.05, 0.065, 0.06) * (lightAt(vWP, n) * 2.0 + 0.2) + skyColor(reflect(normalize(vWP - uCamPos), n)) * 0.04;
    col = mix(off, img * 1.1, on);
    fogK = 0.92;
  }
#endif

#ifdef MODE_SCREENXP
  {
    float on = gLit > 0.5 ? step(hfrac(gB, gSec, gFl, 96 + gRoom), 0.8) : step(hfrac(gB, gSec, gFl, 98 + gRoom), 0.08);
    vec2 uv = vUv;
    // a green hill under a blue sky with clouds
    vec3 sky = mix(vec3(0.35, 0.55, 0.92), vec3(0.12, 0.32, 0.85), uv.y);
    sky = mix(sky, vec3(0.95), smoothstep(0.55, 0.8, vnoise(uv * vec2(6.0, 9.0) + 2.0)) * 0.7 * step(0.45, uv.y));
    float hill = 0.42 + 0.12 * sin(uv.x * 2.6 + 0.6) - 0.06 * uv.x;
    vec3 c = mix(vec3(0.25, 0.6, 0.18), vec3(0.42, 0.75, 0.25), clamp(uv.y / max(hill, 0.01), 0.0, 1.0));
    c = mix(c, sky, aastep(hill, uv.y));
    // taskbar: the green start button on the left, the tray on the right
    float bar = 1.0 - aastep(0.075, uv.y);
    c = mix(c, mix(vec3(0.12, 0.32, 0.85), vec3(0.2, 0.45, 0.95), uv.y / 0.075), bar);
    c = mix(c, vec3(0.2, 0.62, 0.22), bar * (1.0 - aastep(0.17, uv.x)) * aastep(0.008, uv.y));
    c = mix(c, vec3(0.08, 0.6, 0.88), bar * aastep(0.8, uv.x));
    // a column of desktop icons
    vec2 ic = vec2(uv.x / 0.07, (1.0 - uv.y) / 0.09);
    float icon = step(ic.x, 1.0) * step(ic.y, 4.0) * (1.0 - aastep(0.28, max(abs(fract(ic.x) - 0.5), abs(fract(ic.y) - 0.45))));
    c = mix(c, vec3(0.95, 0.9, 0.5), icon * 0.9);
    c *= 0.95 + 0.05 * step(0.5, fract(uv.y * 80.0));
    vec3 off = vec3(0.04, 0.045, 0.05) * (lightAt(vWP, n) * 2.0 + 0.2);
    col = mix(off, c * 1.05, on);
    fogK = 0.92;
  }
#endif

#ifdef MODE_BOOKS
  {
    float al = abs(n.x) > abs(n.z) ? vWP.z : vWP.x;
    float id = floor(al * 26.0);
    vec3 bc = pick4(hash12(vec2(id, 1.0)), vec3(0.5, 0.12, 0.1), vec3(0.15, 0.25, 0.4), vec3(0.2, 0.35, 0.2), vec3(0.6, 0.5, 0.3));
    bc *= 0.7 + 0.5 * hash12(vec2(id, 2.0));
    bc = mix(bc, vec3(0.75, 0.6, 0.3), (1.0 - aastep(0.04, abs(fract(vWP.y * 4.0) - 0.7))) * 0.6);
    col = bc * lightAt(vWP, n);
  }
#endif

#ifdef MODE_OILCLOTH
  {
    vec3 a = pick4(hfrac(gB, gSec, gFl, 140 + gApt), vec3(0.75, 0.15, 0.12), vec3(0.2, 0.35, 0.7), vec3(0.2, 0.5, 0.25), vec3(0.85, 0.6, 0.15));
    vec2 q = vWP.xz * 12.0 + vWP.y * 12.0;
    col = mix(vec3(0.92, 0.9, 0.86), a, mod(floor(q.x) + floor(q.y), 2.0) * 0.85) * lightAt(vWP, n) + gLampCol * gLit * 0.05;
  }
#endif

#ifdef MODE_PLANT
  {
    float w = 0.5 * (1.0 - vUv.y) * (0.6 + 0.4 * sin(vUv.y * 3.14));
    if (abs(vUv.x - 0.5) > w + 0.05 * sin(vUv.y * 20.0)) discard;
    col = vec3(0.16, 0.36, 0.14) * (0.8 + 0.4 * vUv.y) * lightAt(vWP, n);
  }
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
    // the khrushchyovka with interiors (data/blender/k5i.py). On the facade: stand-ins that give way to the
    // real windows, door and hatch when the section's insides are drawn
    pk_win_i: { mode: 'pwin', hideLoaded: true },
    pk_door_i: { mode: 'tex', tex: 'metal_white', scale: 1.5, tint: C(0.42, 0.28, 0.2), hideLoaded: true },
    pk_hatch_i: { mode: 'tex', tex: 'metal', scale: 1, tint: C(0.55, 0.57, 0.6), snowcap: snow, hideLoaded: true },
    // finishes chosen per room in the shader
    pk_wall_int: { mode: 'wallint' },
    pk_stair_side: { mode: 'wallint' },
    pk_floor_int: { mode: 'floorint' },
    pk_ceil_int: { mode: 'ceilint' },
    pk_casing: { mode: 'flat', tint: C(0.84, 0.82, 0.78) },
    pk_frame_int: { mode: 'flat', tint: C(0.86, 0.86, 0.83) },
    pk_glass_int: { mode: 'glassint', blend: true, double: true },
    pk_glass_door: { mode: 'flat', tint: C(0.66, 0.7, 0.7) },
    pk_door_int: { mode: 'flat', tint: C(0.86, 0.86, 0.82) },
    pk_dermantin: { mode: 'flat', tint: C(0.3, 0.15, 0.08) },
    pk_baseboard: { mode: 'tex', tex: 'wood_dark', scale: 0.8, tint: C(0.8, 0.6, 0.48) },
    pk_radiator: { mode: 'flat', tint: C(0.82, 0.8, 0.72) },
    pk_switch: { mode: 'flat', tint: C(0.86, 0.85, 0.8) },
    pk_switch_key: { mode: 'flat', tint: C(0.93, 0.92, 0.88) },
    pk_stair: { mode: 'tex', tex: 'panel_b', scale: 1.5, tint: C(0.66, 0.64, 0.6) },
    pk_handrail: { mode: 'tex', tex: 'wood_dark', scale: 0.6, tint: C(0.7, 0.45, 0.32) },
    pk_metal_green: { mode: 'tex', tex: 'metal_green', scale: 1, tint: C(0.75, 0.85, 0.8) },
    pk_mailbox: { mode: 'tex', tex: 'metal_white', scale: 1, tint: C(0.42, 0.55, 0.75) },
    pk_door_base: { mode: 'tex', tex: 'rust', scale: 1, tint: C(0.75, 0.62, 0.55) },
    pk_mat: { mode: 'fabric', variant: 5 },
    pk_lampshade: { mode: 'lampshade', tint: C(0.95, 0.92, 0.85) },
    pk_lampshade_f: { mode: 'lampshade', tint: C(0.95, 0.72, 0.42) },
    // furniture
    pk_veneer: { mode: 'tex', tex: 'wood_dark', scale: 0.6, tint: C(0.85, 0.6, 0.45) },
    pk_veneer_door: { mode: 'tex', tex: 'wood_dark', scale: 0.6, tint: C(0.95, 0.68, 0.5) },
    pk_veneer_light: { mode: 'tex', tex: 'planks', scale: 0.8, tint: C(1.0, 0.9, 0.75) },
    pk_fabric: { mode: 'fabric', variant: 0 },
    pk_drape: { mode: 'fabric', variant: 1 },
    pk_bedding: { mode: 'fabric', variant: 2 },
    pk_bedding_b: { mode: 'fabric', variant: 3 },
    pk_kitchen: { mode: 'fabric', variant: 4 },
    pk_kitchen_door: { mode: 'fabric', variant: 4 },
    pk_fabric_dark: { mode: 'flat', tint: C(0.12, 0.12, 0.14) },
    pk_leather: { mode: 'flat', tint: C(0.24, 0.13, 0.08) },
    pk_linen: { mode: 'flat', tint: C(0.9, 0.9, 0.86) },
    pk_tulle: { mode: 'tulle', blend: true, double: true },
    pk_carpet: { mode: 'carpet', variant: 0 },
    pk_rug: { mode: 'carpet', variant: 1 },
    pk_carpet_edge: { mode: 'flat', tint: C(0.36, 0.08, 0.07) },
    pk_screen_tv: { mode: 'screentv' },
    pk_screen_xp: { mode: 'screenxp' },
    pk_books: { mode: 'books' },
    pk_mirror: { mode: 'mirror' },
    pk_oilcloth: { mode: 'oilcloth' },
    pk_plant: { mode: 'plant', double: true },
    pk_crystal: { mode: 'flat', tint: C(0.88, 0.92, 0.96) },
    pk_dishes: { mode: 'flat', tint: C(0.92, 0.92, 0.9) },
    pk_brass: { mode: 'flat', tint: C(0.78, 0.6, 0.3) },
    pk_plastic_beige: { mode: 'flat', tint: C(0.82, 0.78, 0.68) },
    pk_plastic_black: { mode: 'flat', tint: C(0.07, 0.07, 0.08) },
    pk_plastic_grey: { mode: 'flat', tint: C(0.7, 0.7, 0.72) },
    pk_plastic_brown: { mode: 'flat', tint: C(0.36, 0.2, 0.12) },
    pk_plastic_red: { mode: 'flat', tint: C(0.66, 0.1, 0.08) },
    pk_keys: { mode: 'flat', tint: C(0.74, 0.71, 0.64) },
    pk_glow_green: { mode: 'glow', tint: C(0.3, 1.0, 0.35), glow: 1.0 },
    pk_glow_flame: { mode: 'glow', tint: C(0.35, 0.55, 1.0), glow: 1.2 },
    pk_enamel: { mode: 'flat', tint: C(0.88, 0.88, 0.86) },
    pk_enamel_pot: { mode: 'flat', tint: C(0.8, 0.85, 0.88) },
    pk_stove_top: { mode: 'flat', tint: C(0.08, 0.08, 0.08) },
    pk_kettle: { mode: 'flat', tint: C(0.75, 0.25, 0.12) },
    pk_sink_well: { mode: 'flat', tint: C(0.36, 0.38, 0.4) },
    pk_counter: { mode: 'flat', tint: C(0.42, 0.4, 0.37) },
    pk_tub_inside: { mode: 'flat', tint: C(0.9, 0.9, 0.88) },
    pk_towel: { mode: 'flat', tint: C(0.78, 0.4, 0.48) },
    pk_coat_a: { mode: 'flat', tint: C(0.24, 0.21, 0.19) },
    pk_coat_b: { mode: 'flat', tint: C(0.15, 0.18, 0.25) },
    pk_coat_c: { mode: 'flat', tint: C(0.4, 0.3, 0.25) },
    pk_fur: { mode: 'flat', tint: C(0.3, 0.25, 0.2) },
    pk_clock: { mode: 'flat', tint: C(0.9, 0.88, 0.82) },
    pk_grille: { mode: 'flat', tint: C(0.2, 0.15, 0.1) },
    pk_globe: { mode: 'flat', tint: C(0.3, 0.5, 0.7) },
    pk_terracotta: { mode: 'flat', tint: C(0.6, 0.3, 0.18) },
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
  if (def.hideLoaded) defines.HIDE_LOADED = '';
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
    uVar: { value: def.variant || 0 },
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
        probeInterior(vWP, n);
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
