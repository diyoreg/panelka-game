// Assets from the Blender glb (data/blender/build_panelka.py): meshes with their colliders and metadata,
// plus the axis helpers the generator uses to place them.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { namedMaterial } from './materials.js';

export class Assets {
  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.items = new Map();
    this.character = null;
    for (const obj of [...gltf.scene.children]) {
      const ud = obj.userData || {};
      if (ud.kind === 'char' || obj.name === 'character') {
        this.character = obj;
        this.prepareCharacter(obj);
        continue;
      }
      obj.updateMatrixWorld(true);
      const inv = obj.matrixWorld.clone().invert();
      const parts = [];
      obj.traverse((m) => {
        if (!m.isMesh) return;
        const g = m.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        // only position, normal and uv are needed
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        parts.push({ geometry: g, material: namedMaterial(m.material.name, m.material.color) });
      });
      const cols = [];
      if (ud.col) {
        for (const [x0, y0, z0, x1, y1, z1] of JSON.parse(ud.col)) {
          cols.push(new THREE.Box3(new THREE.Vector3(x0, z0, -y1), new THREE.Vector3(x1, z1, -y0)));
        }
      }
      const bounds = new THREE.Box3();
      cols.forEach((b) => bounds.union(b));
      if (bounds.isEmpty()) for (const p of parts) { p.geometry.computeBoundingBox(); bounds.union(p.geometry.boundingBox); }
      const item = {
        name: obj.name, kind: ud.kind, parts, cols, bounds,
        h: ud.h || bounds.max.y,
        light: ud.light ? JSON.parse(ud.light) : null,
        lights: ud.lights ? JSON.parse(ud.lights) : null,
        interior: ud.interior ? JSON.parse(ud.interior) : null,
        doors: ud.doors ? JSON.parse(ud.doors) : null,
        steam: ud.steam ? JSON.parse(ud.steam) : null,
        crown: ud.crown ? JSON.parse(ud.crown) : null,
      };
      this.items.set(obj.name, item);
    }
  }

  prepareCharacter(root) {
    root.traverse((m) => {
      if (m.isMesh) {
        m.material = namedMaterial(m.material.name, m.material.color);
        m.frustumCulled = false;
      }
    });
  }

  get(name) {
    const it = this.items.get(name);
    if (!it) throw new Error('Missing asset ' + name);
    return it;
  }
}

export function blenderToThree([x, y, z]) {
  return [x, z, -y];
}

// Rectangle bounds after a rotation by a multiple of 90 degrees
export function rotBounds(b, rot) {
  const c = Math.round(Math.cos(rot)), s = Math.round(Math.sin(rot));
  const pts = [[b.min.x, b.min.z], [b.max.x, b.min.z], [b.min.x, b.max.z], [b.max.x, b.max.z]].map(([x, z]) => [x * c + z * s, -x * s + z * c]);
  return {
    minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])),
    minZ: Math.min(...pts.map((p) => p[1])), maxZ: Math.max(...pts.map((p) => p[1])),
  };
}
