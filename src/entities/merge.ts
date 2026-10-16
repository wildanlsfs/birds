import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Geometry batcher: collects transformed, vertex-colored pieces and merges them into a single
 * BufferGeometry, so a whole chunk of trees/rocks/islands costs one draw call instead of hundreds.
 */
export class GeoBatch {
  private parts: THREE.BufferGeometry[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  /** Add a geometry with a flat color. `p` position, `r` euler rotation, `s` scale (number or xyz). */
  add(
    geo: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    p: [number, number, number] = [0, 0, 0],
    r: [number, number, number] = [0, 0, 0],
    s: number | [number, number, number] = 1
  ): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const sc = typeof s === 'number' ? this.s.set(s, s, s) : this.s.set(s[0], s[1], s[2]);
    this.m4.compose(this.v.set(p[0], p[1], p[2]), this.q.setFromEuler(this.e.set(r[0], r[1], r[2])), sc);
    g.applyMatrix4(this.m4);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts.push(g);
    geo.dispose();
    return this;
  }

  /** Append another batch's pieces, offset by a transform (used to place prebuilt props). */
  addBatch(other: GeoBatch, p: [number, number, number], rotY = 0, scale = 1): this {
    this.m4.compose(this.v.set(p[0], p[1], p[2]), this.q.setFromEuler(this.e.set(0, rotY, 0)), this.s.set(scale, scale, scale));
    for (const g of other.parts) this.parts.push(g.applyMatrix4(this.m4));
    other.parts = [];
    return this;
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  /** Merge into one mesh (or null when nothing was added). */
  mesh(material: THREE.Material, cast = true, receive = false): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const geo = mergeGeometries(this.parts);
    for (const g of this.parts) g.dispose();
    this.parts = [];
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}
