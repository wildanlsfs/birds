import * as THREE from 'three';

/**
 * Flying obstacles that get in the way of the bird.
 *  - gagak: dark crow that crosses the flight path quickly
 *  - balon: big slow hot-air balloon drifting at ring height
 * A hit is never fatal (kids play this): it costs speed and the combo.
 */
export type HazardKind = 'gagak' | 'balon';

interface Hazard {
  kind: HazardKind;
  mesh: THREE.Group;
  wings?: [THREE.Object3D, THREE.Object3D];
  vel: THREE.Vector3;
  radius: number;
  phase: number;
  nearMissed: boolean;
}

export interface HazardEvents {
  hit: HazardKind | null;
  nearMiss: boolean;
  awayX: number;
  awayZ: number;
}

const INK = new THREE.MeshBasicMaterial({ color: 0x2a2140, side: THREE.BackSide });
const outline = (geo: THREE.BufferGeometry, thick: number): THREE.Mesh => {
  const m = INK.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.thick = { value: thick };
    sh.vertexShader = 'uniform float thick;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * thick;');
  };
  m.customProgramCacheKey = () => 'hz-ink-' + thick;
  const o = new THREE.Mesh(geo, m);
  o.raycast = () => {};
  return o;
};
const solid = (geo: THREE.BufferGeometry, color: number, thick: number, parent: THREE.Object3D): THREE.Mesh => {
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.65 }));
  mesh.add(outline(geo, thick));
  parent.add(mesh);
  return mesh;
};

function buildCrow(): { g: THREE.Group; wings: [THREE.Object3D, THREE.Object3D] } {
  const g = new THREE.Group();
  const body = new THREE.SphereGeometry(0.7, 12, 10);
  body.scale(0.8, 0.75, 1.5);
  solid(body, 0x2b2a3a, 0.05, g);
  const head = solid(new THREE.SphereGeometry(0.4, 10, 8), 0x2b2a3a, 0.045, g);
  head.position.set(0, 0.2, -1.1);
  const beak = solid(new THREE.ConeGeometry(0.14, 0.5, 8).rotateX(-Math.PI / 2), 0xe8a53a, 0.03, g);
  beak.position.set(0, 0.15, -1.55);
  const tail = solid(new THREE.ConeGeometry(0.3, 1.0, 6).rotateX(Math.PI / 2), 0x23222f, 0.04, g);
  tail.position.set(0, 0, 1.4);
  const wingGeo = new THREE.BoxGeometry(1.9, 0.07, 0.9);
  wingGeo.translate(0.95, 0, 0);
  const wl = new THREE.Group();
  const wr = new THREE.Group();
  solid(wingGeo, 0x33324a, 0.04, wl);
  solid(wingGeo.clone().scale(-1, 1, 1), 0x33324a, 0.04, wr);
  wl.position.set(0.3, 0.1, -0.2);
  wr.position.set(-0.3, 0.1, -0.2);
  g.add(wl, wr);
  g.scale.setScalar(2.2);
  return { g, wings: [wl, wr] };
}

function buildBalloon(): THREE.Group {
  const g = new THREE.Group();
  const env = solid(new THREE.SphereGeometry(7, 16, 12), 0xe5483f, 0.18, g);
  env.scale.y = 1.15;
  const stripe = solid(new THREE.TorusGeometry(7.05, 0.5, 6, 18).rotateX(Math.PI / 2), 0xffd24a, 0.1, g);
  stripe.position.y = 0.6;
  const basket = solid(new THREE.BoxGeometry(2.2, 1.6, 2.2), 0x8a5a2b, 0.08, g);
  basket.position.y = -10.2;
  for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6.5), new THREE.MeshBasicMaterial({ color: 0x2a2140 }));
    rope.position.set(x * 0.9, -6.8, z * 0.9);
    g.add(rope);
  }
  return g;
}

export class HazardManager {
  private hazards: Hazard[] = [];
  private spawnTimer = 6;
  private cooldown = 0;
  private time = 0;
  private maxAlive = 4;

  constructor(private scene: THREE.Scene) {}

  public reset(): void {
    for (const h of this.hazards) this.scene.remove(h.mesh);
    this.hazards = [];
    this.spawnTimer = 6;
    this.cooldown = 0;
    this.time = 0;
  }

  public get count(): number {
    return this.hazards.length;
  }

  /** Test hook: put a hazard on a given spot. */
  public spawnAt(kind: HazardKind, pos: THREE.Vector3, vel = new THREE.Vector3()): void {
    this.make(kind, pos, vel);
  }

  private make(kind: HazardKind, pos: THREE.Vector3, vel: THREE.Vector3): void {
    let mesh: THREE.Group;
    let wings: [THREE.Object3D, THREE.Object3D] | undefined;
    let radius: number;
    if (kind === 'gagak') {
      const c = buildCrow();
      mesh = c.g;
      wings = c.wings;
      radius = 3.2;
    } else {
      mesh = buildBalloon();
      radius = 8.5;
    }
    mesh.position.copy(pos);
    if (vel.lengthSq() > 0.01) mesh.rotation.y = Math.atan2(-vel.x, -vel.z);
    this.scene.add(mesh);
    this.hazards.push({ kind, mesh, wings, vel, radius, phase: Math.random() * 6, nearMissed: false });
  }

  private spawn(birdPos: THREE.Vector3, yaw: number, distance: number): void {
    // Wait until the player has found their wings; more traffic the farther they go.
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const ahead = 170 + Math.random() * 90;
    const base = birdPos.clone().addScaledVector(forward, ahead);
    const kind: HazardKind = Math.random() < 0.7 ? 'gagak' : 'balon';
    if (kind === 'gagak') {
      // Crosses the flight line from one side to the other, roughly at the bird's altitude
      const side = Math.random() < 0.5 ? -1 : 1;
      const lateral = 70 + Math.random() * 30;
      const pos = base.clone().addScaledVector(right, side * lateral);
      pos.y = Math.max(18, birdPos.y + (Math.random() - 0.5) * 22);
      const speed = 17 + Math.min(10, distance / 400);
      const vel = right.clone().multiplyScalar(-side * speed).addScaledVector(forward, -4);
      this.make('gagak', pos, vel);
    } else {
      const pos = base.clone().addScaledVector(right, (Math.random() - 0.5) * 60);
      pos.y = THREE.MathUtils.clamp(birdPos.y + (Math.random() - 0.5) * 16, 40, 110);
      this.make('balon', pos, right.clone().multiplyScalar((Math.random() - 0.5) * 3));
    }
  }

  public update(delta: number, birdPos: THREE.Vector3, yaw: number, distance: number, birdRadius: number, active: boolean): HazardEvents {
    const ev: HazardEvents = { hit: null, nearMiss: false, awayX: 0, awayZ: 0 };
    this.time += delta;
    this.cooldown = Math.max(0, this.cooldown - delta);

    if (active && distance > 250) {
      this.spawnTimer -= delta;
      if (this.spawnTimer <= 0 && this.hazards.length < this.maxAlive) {
        this.spawn(birdPos, yaw, distance);
        this.spawnTimer = Math.max(4, 9 - distance / 500) + Math.random() * 3;
      }
    }

    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.mesh.position.addScaledVector(h.vel, delta);
      h.phase += delta;
      if (h.kind === 'gagak' && h.wings) {
        const f = Math.sin(h.phase * 12) * 0.7;
        h.wings[0].rotation.z = f;
        h.wings[1].rotation.z = -f;
      } else {
        h.mesh.position.y += Math.sin(h.phase * 0.8) * 0.04;
      }
      const d = h.mesh.position.distanceTo(birdPos);
      if (d > 380) {
        this.scene.remove(h.mesh);
        this.hazards.splice(i, 1);
        continue;
      }
      if (!active) continue;
      const hitDist = h.radius + birdRadius;
      if (d < hitDist && this.cooldown <= 0) {
        ev.hit = h.kind;
        const away = birdPos.clone().sub(h.mesh.position).setY(0);
        if (away.lengthSq() < 0.01) away.set(1, 0, 0);
        away.normalize();
        ev.awayX = away.x;
        ev.awayZ = away.z;
        this.cooldown = 1.6;
        h.nearMissed = true;
        // Knock the hazard away so one bump is one hit
        h.vel.add(birdPos.clone().sub(h.mesh.position).setY(0).normalize().multiplyScalar(-6));
      } else if (!h.nearMissed && d < hitDist + 9 && d > hitDist) {
        h.nearMissed = true;
        ev.nearMiss = true;
      }
    }
    return ev;
  }
}
