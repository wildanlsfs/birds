import * as THREE from 'three';
import { FlightPhysics } from '../systems/FlightPhysics';

export interface RingData {
  index: number;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  radius: number;
  isBoost: boolean;
  meshGroup: THREE.Group;
  pulseMesh: THREE.Mesh;
}

/**
 * Endless Waypoint Manager:
 * Procedural infinite ring generation with magnetic slipstream assistance,
 * smooth sweeping roller-coaster paths, dynamic boost rings, and combo multipliers.
 */
export class WaypointManager {
  public scene: THREE.Scene;
  public rings: RingData[] = [];
  public totalScore = 0;
  public combo = 1;
  public collectedCount = 0;

  private ringsSpawned = 0;
  private lastSpawnZ = -30;
  private readonly visibleRings = 8;
  private readonly ringRadius = 8.5; // Welcoming 8.5m radius for motion play

  // Particle burst for ring collection
  private burstParticles: THREE.Points;
  private burstVelocities: THREE.Vector3[] = [];
  private burstLifetimes: number[] = [];
  private burstCount = 80;

  // Beacon guide light on current target ring
  public activeBeaconLight: THREE.PointLight;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.activeBeaconLight = new THREE.PointLight(0xffdf00, 3.5, 60);
    this.scene.add(this.activeBeaconLight);

    this.burstParticles = this.createBurstParticles();

    // Spawn initial set of 8 rings
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
  public spawnNextRing(): void {
    const t = this.ringsSpawned;
    this.ringsSpawned++;

    // Procedural wave flight trajectory
    const deltaZ = 85 + Math.sin(t * 0.4) * 15;
    this.lastSpawnZ -= deltaZ;

    const posX = Math.sin(t * 0.45) * 45 + Math.cos(t * 0.22) * 20;
    const posY = 26 + Math.sin(t * 0.6) * 16;
    const pos = new THREE.Vector3(posX, posY, this.lastSpawnZ);

    const isBoost = t > 0 && t % 5 === 0; // Every 5th ring is a Turbo Boost ring

    const ringGroup = new THREE.Group();
    ringGroup.position.copy(pos);

    // Torus geometry
    const torusGeo = new THREE.TorusGeometry(this.ringRadius, 0.55, 12, 32);
    const ringMat = new THREE.MeshStandardMaterial({
      color: isBoost ? 0x00f0ff : 0xffaa00,
      emissive: isBoost ? 0x00c4e6 : 0xd47500,
      emissiveIntensity: 0.9,
      roughness: 0.2,
      metalness: 0.6
    });
    const torusMesh = new THREE.Mesh(torusGeo, ringMat);
    ringGroup.add(torusMesh);

    // Inner pulsating energy disc
    const pulseGeo = new THREE.RingGeometry(this.ringRadius * 0.15, this.ringRadius * 0.95, 24);
    const pulseMat = new THREE.MeshBasicMaterial({
      color: isBoost ? 0x66f6ff : 0xffea88,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide
    });
    const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
    ringGroup.add(pulseMesh);

    // Vertical sky beacon pillar
    const beaconGeo = new THREE.CylinderGeometry(0.35, 0.35, 180, 8);
    beaconGeo.translate(0, 90, 0);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: isBoost ? 0x33e7ff : 0xffbe33,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide
    });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    ringGroup.add(beacon);

    this.scene.add(ringGroup);

    this.rings.push({
      index: t,
      position: pos,
      rotation: new THREE.Euler(),
      radius: this.ringRadius,
      isBoost,
      meshGroup: ringGroup,
      pulseMesh
    });
  }

  public updateActiveRingVisuals(): void {
    if (this.rings.length > 0) {
      const active = this.rings[0];
      this.activeBeaconLight.position.copy(active.position);
      this.activeBeaconLight.color.set(active.isBoost ? 0x00f0ff : 0xffc400);

      this.rings.forEach((r, idx) => {
        if (idx === 0) {
          r.meshGroup.scale.set(1.18, 1.18, 1.18);
        } else {
          r.meshGroup.scale.set(1.0, 1.0, 1.0);
        }
      });
    }
  }

  /**
   * Check ring pass-through with magnetic slipstream assist
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

    // Apply Magnetic Slipstream Assist towards active ring
    if (physics) {
      physics.applySlipstream(ringPos, dt);
    }

    const distToCenter = currPos.distanceTo(ringPos);
    const passedZ = (prevPos.z > ringPos.z && currPos.z <= ringPos.z) || (prevPos.z < ringPos.z && currPos.z >= ringPos.z);
    const closeEnough = distToCenter < activeRing.radius * 1.5;

    // 1. RING COLLECTED
    if (distToCenter < activeRing.radius || (passedZ && closeEnough)) {
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

    // 2. MISSED RING (Bird flew > 28m past the ring without collecting)
    if (currPos.z < ringPos.z - 28) {
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

  public update(delta: number): void {
    // Pulse and rotate rings
    const time = performance.now() * 0.003;
    this.rings.forEach((r, idx) => {
      r.meshGroup.rotation.z += delta * (idx === 0 ? 1.6 : 0.6);
      const scale = 0.9 + Math.sin(time + idx) * 0.15;
      r.pulseMesh.scale.set(scale, scale, 1);
    });

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
    this.lastSpawnZ = -30;
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
    for (let i = 0; i < 12; i++) {
      this.spawnNextRing();
    }
    this.updateActiveRingVisuals();
  }
}
