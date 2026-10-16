import * as THREE from 'three';
import { FlightPhysics } from '../systems/FlightPhysics';
import { World } from './World';

export interface RingData {
  index: number;
  position: THREE.Vector3;
  forward: THREE.Vector3;
  rotation: THREE.Euler;
  radius: number;
  isBoost: boolean;
  meshGroup: THREE.Group;
  pulseMesh: THREE.Mesh;
  torusMesh: THREE.Mesh;
  safe: boolean;
}

/**
 * Endless 360° Waypoint Manager:
 * Procedural infinite ring generation supporting free flight in any direction (360°).
 * Dynamically orients rings to face flight trajectories, maintains magnetic slipstream assistance,
 * adapts courses if player explores elsewhere, and provides dynamic boost rings & combo multipliers.
 */
export class WaypointManager {
  public scene: THREE.Scene;
  public rings: RingData[] = [];
  public totalScore = 0;
  public combo = 1;
  public collectedCount = 0;

  private ringsSpawned = 0;
  private lastRingPos = new THREE.Vector3(0, 24, 10);
  private courseHeading = 0; // heading angle in radians (0 = towards -Z)
  private readonly visibleRings = 8;
  private readonly ringRadius = 8.5; // Welcoming 8.5m radius for motion play

  // Particle burst for ring collection
  private burstParticles: THREE.Points;
  private burstVelocities: THREE.Vector3[] = [];
  private burstLifetimes: number[] = [];
  private burstCount = 80;

  // Shared look for every ring
  private static torusGeo = new THREE.TorusGeometry(8.5, 0.6, 12, 40);
  private static discGeo = new THREE.RingGeometry(8.5 * 0.2, 8.5 * 0.92, 32);
  private static ringMat = new THREE.MeshLambertMaterial({ color: 0xffb21f, emissive: 0xff8a00, emissiveIntensity: 0.75 });
  private static boostMat = new THREE.MeshLambertMaterial({ color: 0x3ff0ff, emissive: 0x00b8e6, emissiveIntensity: 0.85 });
  private static discMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  private static boostDiscMat = new THREE.MeshBasicMaterial({ color: 0x9ff8ff, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false });

  /** Set by the game: moves a ring out of obstacles; returns false if terrain there isn't built yet. */
  public clearSpot: ((pos: THREE.Vector3, radius: number) => boolean) | null = null;

  // Upright light pillar over the current target ring (always world-vertical)
  private beacon: THREE.Mesh;
  private beaconMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Soft light pillar: bright at the ring, fading out toward the sky
    const beaconGeo = new THREE.CylinderGeometry(0.7, 0.7, 220, 10, 8, true);
    beaconGeo.translate(0, 110 + 9, 0);
    const fade = new Float32Array(beaconGeo.attributes.position.count);
    for (let i = 0; i < fade.length; i++) fade[i] = 1 - beaconGeo.attributes.position.getY(i) / 230;
    beaconGeo.setAttribute('fade', new THREE.BufferAttribute(fade, 1));
    this.beaconMat = new THREE.MeshBasicMaterial({
      color: 0xffd34d,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false
    });
    this.beaconMat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float fade;\nvarying float vFade;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = fade;');
      sh.fragmentShader = 'varying float vFade;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vFade * vFade;');
    };
    this.beacon = new THREE.Mesh(beaconGeo, this.beaconMat);
    this.beacon.frustumCulled = false;
    this.scene.add(this.beacon);

    this.burstParticles = this.createBurstParticles();

    // Spawn initial set of 8 rings starting ahead of the runway
    for (let i = 0; i < this.visibleRings; i++) {
      this.spawnNextRing();
    }
    this.updateActiveRingVisuals();
  }

  private createBurstParticles(): THREE.Points {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(this.burstCount * 3);

    for (let i = 0; i < this.burstCount; i++) {
      pos[i * 3] = 0;
      pos[i * 3 + 1] = -500;
      pos[i * 3 + 2] = 0;
      this.burstVelocities.push(new THREE.Vector3());
      this.burstLifetimes.push(0);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    // Soft round particle texture
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.4, 'rgba(255, 220, 100, 0.8)');
    grad.addColorStop(1, 'rgba(255, 150, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const mat = new THREE.PointsMaterial({
      color: 0xffe853,
      size: 1.8,
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    return pts;
  }

  /**
   * Spawns the next procedural ring ahead along a smooth scenic sky curve
   */
  public spawnNextRing(desiredHeading?: number): void {
    const t = this.ringsSpawned;
    this.ringsSpawned++;

    if (desiredHeading !== undefined) {
      let diff = desiredHeading - this.courseHeading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.courseHeading += diff * 0.45;
    } else {
      // Gentle scenic sweeping curves
      this.courseHeading += Math.sin(t * 0.45) * 0.22;
    }

    const stepDist = 80 + Math.sin(t * 0.3) * 12;
    const nextX = this.lastRingPos.x - Math.sin(this.courseHeading) * stepDist;
    const nextZ = this.lastRingPos.z - Math.cos(this.courseHeading) * stepDist;
    const groundY = World.getGroundHeight(nextX, nextZ);
    const nextY = Math.max(groundY + 18, 22 + Math.sin(t * 0.5) * 12);
    const pos = new THREE.Vector3(nextX, nextY, nextZ);

    const forward = new THREE.Vector3().subVectors(pos, this.lastRingPos).normalize();
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);

    const isBoost = t > 0 && t % 5 === 0; // Every 5th ring is a Turbo Boost ring

    const ringGroup = new THREE.Group();
    ringGroup.position.copy(pos);
    ringGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward);

    // Shared geometry/materials: only the torus spins, so the group orientation stays put
    const torusMesh = new THREE.Mesh(WaypointManager.torusGeo, isBoost ? WaypointManager.boostMat : WaypointManager.ringMat);
    ringGroup.add(torusMesh);

    const pulseMesh = new THREE.Mesh(WaypointManager.discGeo, isBoost ? WaypointManager.boostDiscMat : WaypointManager.discMat);
    ringGroup.add(pulseMesh);

    this.scene.add(ringGroup);

    this.rings.push({
      index: t,
      position: pos,
      forward,
      rotation: ringGroup.rotation,
      radius: this.ringRadius,
      isBoost,
      meshGroup: ringGroup,
      pulseMesh,
      torusMesh,
      safe: false
    });

    this.lastRingPos.copy(pos);
  }

  /**
   * Gracefully re-routes the flight course ahead of the player if they fly off-track
   */
  public reorientCourse(birdPos: THREE.Vector3, birdHeading: number): void {
    for (const r of this.rings) {
      this.scene.remove(r.meshGroup);
    }
    this.rings = [];
    this.combo = 1;

    this.courseHeading = birdHeading;
    this.lastRingPos.set(
      birdPos.x + Math.sin(birdHeading) * 15,
      birdPos.y,
      birdPos.z + Math.cos(birdHeading) * 15
    );

    for (let i = 0; i < this.visibleRings; i++) {
      this.spawnNextRing(birdHeading);
    }
    this.updateActiveRingVisuals();
  }

  public updateActiveRingVisuals(): void {
    if (this.rings.length > 0) {
      const active = this.rings[0];
      this.beacon.position.copy(active.position);
      this.beaconMat.color.set(active.isBoost ? 0x5ff4ff : 0xffd34d);

      this.rings.forEach((r, idx) => {
        // Current target is big & bright; upcoming rings shrink so the path reads front-to-back
        const s = idx === 0 ? 1.15 : idx === 1 ? 0.95 : 0.85;
        r.meshGroup.scale.set(s, s, s);
        r.pulseMesh.visible = idx < 2;
      });
    }
  }

  /**
   * Check ring pass-through with magnetic slipstream assist in 360 degrees
   */
  public checkPassThrough(
    prevPos: THREE.Vector3,
    currPos: THREE.Vector3,
    physics?: FlightPhysics,
    dt: number = 0.016
  ): { hit: boolean; isBoost: boolean } {
    if (this.rings.length === 0) {
      return { hit: false, isBoost: false };
    }

    const activeRing = this.rings[0];
    const ringPos = activeRing.position;
    const ringFwd = activeRing.forward;

    // Apply Magnetic Slipstream Assist towards active ring
    if (physics) {
      physics.applySlipstream(ringPos, dt);
    }

    const distToCenter = currPos.distanceTo(ringPos);

    // Plane crossing check in 3D
    const toPrev = new THREE.Vector3().subVectors(prevPos, ringPos);
    const toCurr = new THREE.Vector3().subVectors(currPos, ringPos);
    const dotPrev = toPrev.dot(ringFwd);
    const dotCurr = toCurr.dot(ringFwd);
    const passedPlane = (dotPrev <= 0 && dotCurr >= 0) || (dotPrev >= 0 && dotCurr <= 0);
    const closeEnough = distToCenter < activeRing.radius * 1.5;

    // 1. RING COLLECTED
    if (distToCenter < activeRing.radius || (passedPlane && closeEnough)) {
      this.triggerCollectionBurst(ringPos, activeRing.isBoost);

      this.totalScore += 250 * this.combo;
      this.combo = Math.min(10, this.combo + 1);
      this.collectedCount++;

      const wasBoost = activeRing.isBoost;

      // Remove collected ring from scene
      this.removeRing(0);

      // Spawn new ring ahead to keep sequence endless
      this.spawnNextRing();
      this.updateActiveRingVisuals();

      return { hit: true, isBoost: wasBoost };
    }

    // 2. MISSED RING (Bird flew > 28m past the ring along its heading, or wandered > 180m away)
    if (dotCurr > 28 || distToCenter > 180) {
      this.combo = 1; // Reset combo multiplier
      this.removeRing(0);
      this.spawnNextRing();
      this.updateActiveRingVisuals();
    }

    return { hit: false, isBoost: false };
  }

  private removeRing(index: number): void {
    if (index >= 0 && index < this.rings.length) {
      const ring = this.rings.splice(index, 1)[0];
      this.scene.remove(ring.meshGroup);
    }
  }

  private triggerCollectionBurst(pos: THREE.Vector3, isBoost: boolean): void {
    const posAttr = this.burstParticles.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let i = 0; i < this.burstCount; i++) {
      arr[i * 3] = pos.x;
      arr[i * 3 + 1] = pos.y;
      arr[i * 3 + 2] = pos.z;

      const speed = 14 + Math.random() * 26;
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI;

      this.burstVelocities[i].set(
        Math.sin(theta) * Math.cos(phi) * speed,
        Math.sin(theta) * Math.sin(phi) * speed,
        Math.cos(theta) * speed
      );
      this.burstLifetimes[i] = 1.2;
    }
    posAttr.needsUpdate = true;

    const mat = this.burstParticles.material as THREE.PointsMaterial;
    mat.color.set(isBoost ? 0x00f0ff : 0xffdf22);
  }

  public getCurrentTarget(): THREE.Vector3 | null {
    if (this.rings.length > 0) {
      return this.rings[0].position;
    }
    return null;
  }

  public update(delta: number, birdPos?: THREE.Vector3, birdHeading?: number): void {
    // Pulse and rotate rings
    const time = performance.now() * 0.003;
    this.rings.forEach((r, idx) => {
      r.torusMesh.rotation.z += delta * (idx === 0 ? 1.6 : 0.6);
      const scale = 0.9 + Math.sin(time + idx) * 0.12;
      r.pulseMesh.scale.set(scale, scale, 1);
    });

    // Keep rings out of islands, spires and trees once the terrain under them exists
    if (this.clearSpot) {
      let movedActive = false;
      for (let i = 0; i < this.rings.length; i++) {
        const r = this.rings[i];
        if (r.safe) continue;
        const before = r.position.clone();
        if (this.clearSpot(r.position, r.radius * 1.15)) {
          r.safe = true;
          if (!before.equals(r.position)) {
            r.meshGroup.position.copy(r.position);
            if (i === 0) movedActive = true;
          }
        }
      }
      if (movedActive) this.updateActiveRingVisuals();
    }

    // Check if player has completely wandered off the ring track (> 220m away)
    if (birdPos && this.rings.length > 0) {
      const distToActive = birdPos.distanceTo(this.rings[0].position);
      if (distToActive > 220) {
        this.reorientCourse(birdPos, birdHeading ?? this.courseHeading);
      }
    }

    // Update burst particles
    const posAttr = this.burstParticles.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    let anyActive = false;

    for (let i = 0; i < this.burstCount; i++) {
      if (this.burstLifetimes[i] > 0) {
        this.burstLifetimes[i] -= delta * 1.8;
        arr[i * 3] += this.burstVelocities[i].x * delta;
        arr[i * 3 + 1] += this.burstVelocities[i].y * delta;
        arr[i * 3 + 2] += this.burstVelocities[i].z * delta;

        this.burstVelocities[i].multiplyScalar(0.93);
        anyActive = true;
      }
    }
    if (anyActive) {
      posAttr.needsUpdate = true;
    }
  }

  /**
   * Reset rings and waypoint course to start
   */
  public reset(): void {
    for (const r of this.rings) {
      this.scene.remove(r.meshGroup);
    }
    this.rings = [];
    this.collectedCount = 0;
    this.ringsSpawned = 0;
    this.lastRingPos.set(0, 24, 10);
    this.courseHeading = 0;
    this.combo = 1;
    this.totalScore = 0;

    // Reset burst particles
    const posAttr = this.burstParticles.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < this.burstCount; i++) {
      arr[i * 3 + 1] = -500;
      this.burstLifetimes[i] = 0;
    }
    posAttr.needsUpdate = true;

    // Respawn initial rings ahead
    for (let i = 0; i < this.visibleRings; i++) {
      this.spawnNextRing();
    }
    this.updateActiveRingVisuals();
  }
}
