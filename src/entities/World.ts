import * as THREE from 'three';
import { GeoBatch } from './merge';

export interface UpdraftZone {
  center: THREE.Vector3;
  radius: number;
  height: number;
  strength: number;
}

export interface TerrainCollider {
  x: number;
  z: number;
  topY: number;
  bottomY: number;
  radius: number;
  name: string;
}

export interface GoldenFeather {
  position: THREE.Vector3;
  collected: boolean;
}

interface ChunkData {
  key: string;
  cx: number;
  cz: number;
  objects: THREE.Object3D[];
  updrafts: UpdraftZone[];
  updraftPoints: THREE.Points[];
  colliders: TerrainCollider[];
  feathers: GoldenFeather[];
}

/**
 * Deterministic Pseudo-Random Number Generator (Knuth LCG)
 * Ensures repeatable, diverse procedural generation per chunk coordinate.
 */
class ChunkRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed ? seed >>> 0 : 123456789;
  }

  public next(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  public range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  public intRange(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
}

// Cheerful storybook palette
const PAL = {
  grassLow: new THREE.Color(0x7fcf52),
  grassHigh: new THREE.Color(0x4f9d3c),
  sand: new THREE.Color(0xead79c),
  cliff: new THREE.Color(0xa59577),
  trunk: 0x7a4b2a,
  pine: [0x2f7d3b, 0x3a8f46, 0x2a6e3a],
  oak: [0x6cbb45, 0x7dc955, 0x5aa83c],
  autumn: [0xf2a93b, 0xec7d3a, 0xf5c242],
  rock: [0x8f877a, 0x9d9383, 0x7f786c],
  canyon: [0xd08756, 0xbf7247, 0xe0a070],
  marble: 0xf4f1ea,
  islandGrass: 0x86d35c,
  islandRock: 0x8f7a64,
  crystal: [0x6ff3ff, 0x9fb8ff, 0xd59bff]
};

/**
 * Procedural Natural Sky & Valley World:
 * Infinite chunked terrain in all directions with forests, rivers, floating sanctuaries,
 * updraft thermals and golden feathers. Each chunk's static props are merged into a handful of
 * vertex-colored meshes so the whole 5x5 grid renders in ~150 draw calls instead of ~700.
 */
export class World {
  public scene: THREE.Scene;
  private chunkRoot = new THREE.Group();

  // Active updraft zones and particle systems
  public updrafts: UpdraftZone[] = [];
  private updraftParticles: THREE.Points[] = [];

  // Active collectible feathers (rendered as one instanced mesh + one glow point cloud)
  public activeFeathers: GoldenFeather[] = [];
  private featherMesh: THREE.InstancedMesh;
  private featherGlow: THREE.Points;
  private readonly maxFeathers = 96;
  private tmpMatrix = new THREE.Matrix4();
  private tmpQuat = new THREE.Quaternion();
  private tmpEuler = new THREE.Euler();
  private tmpPos = new THREE.Vector3();
  private tmpScale = new THREE.Vector3(1, 1, 1);

  // 2D Infinite Chunk Grid Management
  private activeChunks: Map<string, ChunkData> = new Map();
  public readonly chunkSize = 220;
  private readonly loadRadius = 2; // 5x5 active chunk grid
  private readonly unloadRadius = 3;

  // Shared materials
  private matGround: THREE.MeshLambertMaterial;
  private matProps: THREE.MeshLambertMaterial;
  private matGlow: THREE.MeshLambertMaterial;
  private matCloud: THREE.MeshLambertMaterial;
  private matWater: THREE.MeshPhongMaterial;
  private matWaterfall: THREE.MeshBasicMaterial;
  private matUpdraft: THREE.PointsMaterial;

  // Sky & Lighting elements tracked with player
  private dirLight!: THREE.DirectionalLight;
  private sky!: THREE.Mesh;

  // Distance-driven weather / progressive difficulty state
  private baseFogDensity = 0.0012;
  private baseDirLightIntensity = 2.1;
  public stormIntensity = 0;
  private windAngle = 0;
  private readonly maxWindPush = 4.0;
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.matGround = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.matProps = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.matGlow = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      emissive: 0x3aa8c8,
      emissiveIntensity: 0.9
    });
    this.matCloud = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0xb8c8dc,
      emissiveIntensity: 0.55
    });
    this.matWater = new THREE.MeshPhongMaterial({
      color: 0x3fa6d8,
      specular: 0xcfefff,
      shininess: 60,
      transparent: true,
      opacity: 0.9,
      flatShading: true
    });
    this.matWaterfall = new THREE.MeshBasicMaterial({
      color: 0xbdf2ff,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.matUpdraft = new THREE.PointsMaterial({
      color: 0xc8fff0,
      size: 1.6,
      map: World.softDot('rgba(220,255,245,1)', 'rgba(120,230,255,0.5)'),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.setupLighting();
    this.setupSkyAndFog();
    this.scene.add(this.chunkRoot);

    // Golden feathers: one instanced mesh for all of them
    const featherGeo = World.featherGeometry();
    const featherMat = new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0xff9a1f, emissiveIntensity: 0.65 });
    this.featherMesh = new THREE.InstancedMesh(featherGeo, featherMat, this.maxFeathers);
    this.featherMesh.count = 0;
    this.featherMesh.frustumCulled = false;
    this.scene.add(this.featherMesh);

    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxFeathers * 3), 3));
    glowGeo.setDrawRange(0, 0);
    this.featherGlow = new THREE.Points(
      glowGeo,
      new THREE.PointsMaterial({
        size: 9,
        map: World.softDot('rgba(255,240,170,0.9)', 'rgba(255,190,60,0.35)'),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    this.featherGlow.frustumCulled = false;
    this.scene.add(this.featherGlow);

    this.fillGrid(0, 0);
  }

  private static softDot(inner: string, mid: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.45, mid);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Stylized quill feather: curved vane built from a lathe-like fan + thin shaft. */
  private static featherGeometry(): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(0, -1.9);
    shape.bezierCurveTo(1.2, -1.0, 1.15, 1.0, 0.1, 2.1);
    shape.bezierCurveTo(-0.9, 1.2, -1.0, -0.8, 0, -1.9);
    const vane = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.06, bevelSegments: 1, curveSegments: 10 });
    vane.translate(0, 0, -0.06);
    const shaft = new THREE.CylinderGeometry(0.07, 0.1, 4.6, 5);
    shaft.translate(0, -0.5, 0.1);
    const b = new GeoBatch();
    b.add(vane, 0xffffff).add(shaft, 0xffffff);
    const m = b.mesh(new THREE.MeshBasicMaterial())!;
    const geo = m.geometry;
    geo.deleteAttribute('color');
    geo.scale(1.25, 1.25, 1.25);
    return geo;
  }

  private setupLighting(): void {
    const hemiLight = new THREE.HemisphereLight(0xd6ecff, 0x5d8a3c, 1.15);
    this.scene.add(hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff1d6, this.baseDirLightIntensity);
    this.dirLight.position.set(160, 260, -120);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 700;
    const d = 130;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.0008;
    this.dirLight.shadow.normalBias = 0.6;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    const ambient = new THREE.AmbientLight(0xe6f1ff, 0.35);
    this.scene.add(ambient);
  }

  private setupSkyAndFog(): void {
    this.scene.fog = new THREE.FogExp2(0xd2e8fa, this.baseFogDensity);
    this.scene.background = new THREE.Color(0xb5dcff);

    const vertexShader = `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    const fragmentShader = `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 sunDir;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        vec3 dir = normalize(vWorldPosition - cameraPosition);
        float h = normalize(vWorldPosition + offset).y;
        vec3 col = mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0));
        float s = max(dot(dir, sunDir), 0.0);
        col += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 1.4 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const uniforms = {
      topColor: { value: new THREE.Color(0x3b7fd4) },
      bottomColor: { value: new THREE.Color(0xfff0dc) },
      sunDir: { value: new THREE.Vector3(160, 260, -120).normalize() },
      offset: { value: 60 },
      exponent: { value: 0.55 }
    };

    const skyGeo = new THREE.SphereGeometry(2200, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });

    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  /**
   * Pure continuous mathematical 2D function calculating ground elevation y at any (x, z).
   */
  public static getGroundHeight(x: number, z: number): number {
    const macro1 = Math.sin(x * 0.0032 + z * 0.0021) * 16.0;
    const macro2 = Math.cos(x * 0.0018 - z * 0.0035) * 13.0;
    const macro3 = Math.sin(x * 0.0049 + 1.2) * Math.cos(z * 0.0043 + 0.7) * 11.0;

    const hill1 = Math.sin(x * 0.012 + z * 0.009) * 6.0;
    const hill2 = Math.cos(x * 0.009 - z * 0.016) * 4.8;

    const micro1 = Math.sin(x * 0.027 + z * 0.023) * 2.0;
    const micro2 = Math.cos(x * 0.043 - z * 0.039) * 1.4;

    let height = macro1 + macro2 + macro3 + hill1 + hill2 + micro1 + micro2;

    // Peaceful takeoff runway near origin (x ~ 0, z ~ 20)
    const distFromStart = Math.hypot(x, z - 20);
    if (distFromStart < 160) {
      const t = distFromStart / 160;
      const smoothT = t * t * (3 - 2 * t);
      height = THREE.MathUtils.lerp(-4.0, height, smoothT);
    }

    return height;
  }

  private fillGrid(cx: number, cz: number): void {
    for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
      for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
        this.spawnChunk(cx + dx, cz + dz);
      }
    }
  }

  /**
   * Spawns a procedural 2D chunk at chunk coordinates (cx, cz)
   */
  private spawnChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    if (this.activeChunks.has(key)) return;

    const objects: THREE.Object3D[] = [];
    const updrafts: UpdraftZone[] = [];
    const updraftPoints: THREE.Points[] = [];
    const colliders: TerrainCollider[] = [];
    const feathers: GoldenFeather[] = [];

    const startX = cx * this.chunkSize;
    const startZ = cz * this.chunkSize;
    const centerX = startX + this.chunkSize * 0.5;
    const centerZ = startZ + this.chunkSize * 0.5;

    const seed = ((cx * 73856093) ^ (cz * 19349663) ^ 0x9e3779b9) >>> 0;
    const rng = new ChunkRNG(seed);

    const props = new GeoBatch();
    const glow = new GeoBatch();
    const falls = new GeoBatch();
    const clouds = new GeoBatch();

    // 1. Ground
    const { mesh: groundMesh, minHeight } = this.createChunkGroundMesh(startX, startZ, this.chunkSize);
    objects.push(groundMesh);

    // 2. Water in low depressions
    if (minHeight < -2.2) {
      const geo = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, 1, 1);
      geo.rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(geo, this.matWater);
      water.position.set(centerX, -2.5, centerZ);
      water.receiveShadow = true;
      water.matrixAutoUpdate = false;
      water.updateMatrix();
      objects.push(water);
    }

    // 3. Trees
    const treeCount = rng.intRange(9, 16);
    for (let t = 0; t < treeCount; t++) {
      const tx = startX + rng.range(8, this.chunkSize - 8);
      const tz = startZ + rng.range(8, this.chunkSize - 8);
      const groundY = World.getGroundHeight(tx, tz);
      if (groundY < -1.8 || groundY > 52) continue;

      const treeType = rng.next();
      let treeHeight: number;
      let crownRadius: number;
      if (treeType < 0.55) {
        treeHeight = rng.range(11, 18);
        crownRadius = rng.range(3.6, 5.1);
        this.addPineTree(props, rng, tx, groundY, tz, treeHeight, crownRadius);
      } else {
        treeHeight = rng.range(9, 14);
        crownRadius = rng.range(4.5, 6.3);
        this.addOakTree(props, rng, tx, groundY, tz, treeHeight, crownRadius, treeType > 0.85);
      }

      colliders.push({
        x: tx,
        z: tz,
        topY: groundY + treeHeight,
        bottomY: groundY,
        radius: crownRadius * 0.85,
        name: 'Menabrak pepohonan hutan'
      });
    }

    // 4. Boulders
    const boulderCount = rng.intRange(3, 6);
    for (let b = 0; b < boulderCount; b++) {
      const bx = startX + rng.range(6, this.chunkSize - 6);
      const bz = startZ + rng.range(6, this.chunkSize - 6);
      const by = World.getGroundHeight(bx, bz);
      const bRadius = rng.range(2.2, 4.8);
      this.addBoulder(props, rng, bx, by + bRadius * 0.35, bz, bRadius);
      colliders.push({
        x: bx,
        z: bz,
        topY: by + bRadius * 1.2,
        bottomY: by,
        radius: bRadius,
        name: 'Menabrak bongkahan batu'
      });
    }

    // 5. High-altitude features (keep the takeoff chunk clear)
    const skyRoll = rng.next();
    const isStart = (cx === 0 || cx === -1) && (cz === 0 || cz === -1);
    if (skyRoll < 0.36 && !isStart) {
      const skyType = rng.intRange(0, 3);
      if (skyType === 0 || skyType === 3) {
        const iX = centerX + rng.range(-this.chunkSize * 0.27, this.chunkSize * 0.27);
        const iZ = centerZ + rng.range(-this.chunkSize * 0.27, this.chunkSize * 0.27);
        const groundUnder = World.getGroundHeight(iX, iZ);
        // Float high above the ring course so the path runs underneath (a fun sight, never a trap)
        const iY = Math.max(groundUnder, 0) + rng.range(95, 120);
        const radius = this.addSanctuaryIsland(props, falls, rng, iX, iY, iZ, skyType === 3);
        colliders.push({
          x: iX,
          z: iZ,
          topY: iY + (skyType === 3 ? 22 : 16),
          bottomY: iY - 46,
          radius: radius * 0.95,
          name: skyType === 3 ? 'Menabrak kuil pulau melayang' : 'Menabrak pulau melayang'
        });
      } else if (skyType === 1) {
        const spireX = centerX + rng.range(-this.chunkSize * 0.3, this.chunkSize * 0.3);
        const spireZ = centerZ + rng.range(-this.chunkSize * 0.3, this.chunkSize * 0.3);
        const groundUnder = World.getGroundHeight(spireX, spireZ);
        const spireBase = groundUnder - 4;
        const { radius, height } = this.addCanyonSpire(props, rng, spireX, spireBase, spireZ);
        colliders.push({
          x: spireX,
          z: spireZ,
          topY: spireBase + height,
          bottomY: spireBase - 10,
          radius: radius * 0.8,
          name: 'Menabrak pilar tebing raksasa'
        });

        const archX = spireX + rng.range(-50, 50);
        const archZ = spireZ + rng.range(-50, 50);
        const archY = World.getGroundHeight(archX, archZ) - 3;
        const rotY = rng.range(0, Math.PI);
        const { span, height: archH } = this.addRockArch(props, rng, archX, archY, archZ, rotY);
        // Pillars and the bridge deck are solid; the gap underneath is the fun part
        for (const t of [-0.5, -0.25, 0, 0.25, 0.5]) {
          const pillar = Math.abs(t) === 0.5;
          colliders.push({
            x: archX + Math.cos(rotY) * span * t,
            z: archZ - Math.sin(rotY) * span * t,
            topY: archY + archH + 7,
            bottomY: pillar ? archY - 5 : archY + archH - 2,
            radius: pillar ? 9 : 7.5,
            name: 'Menabrak lengkungan batu'
          });
        }
      } else {
        const cX = centerX + rng.range(-this.chunkSize * 0.28, this.chunkSize * 0.28);
        const cZ = centerZ + rng.range(-this.chunkSize * 0.28, this.chunkSize * 0.28);
        const groundUnder = World.getGroundHeight(cX, cZ);
        const cY = Math.max(groundUnder, 0) + rng.range(85, 110);
        const radius = this.addCrystalIsland(props, glow, rng, cX, cY, cZ);
        colliders.push({
          x: cX,
          z: cZ,
          topY: cY + 18,
          bottomY: cY - 40,
          radius: radius * 0.95,
          name: 'Menabrak tebing kristal'
        });
      }
    }

    // 6. Golden feathers
    const featherCount = rng.intRange(1, 2);
    for (let f = 0; f < featherCount; f++) {
      const fX = startX + rng.range(15, this.chunkSize - 15);
      const fZ = startZ + rng.range(15, this.chunkSize - 15);
      const groundAtPos = World.getGroundHeight(fX, fZ);
      const fY = Math.max(groundAtPos + 8, rng.range(16, 40));
      const feather: GoldenFeather = { position: new THREE.Vector3(fX, fY, fZ), collected: false };
      feathers.push(feather);
      this.activeFeathers.push(feather);
    }

    // 7. Updraft thermal (~30% of chunks, never right on the takeoff path)
    if (rng.next() < 0.3 && !isStart) {
      const updraftX = centerX + rng.range(-this.chunkSize * 0.35, this.chunkSize * 0.35);
      const updraftZ = centerZ + rng.range(-this.chunkSize * 0.35, this.chunkSize * 0.35);
      const groundUnder = World.getGroundHeight(updraftX, updraftZ);
      const baseY = Math.max(groundUnder + 4, 0);
      const updraft: UpdraftZone = {
        center: new THREE.Vector3(updraftX, baseY + 40, updraftZ),
        radius: 20,
        height: 80,
        strength: 16
      };
      const pts = this.createUpdraftParticles(updraft);
      objects.push(pts);
      updrafts.push(updraft);
      updraftPoints.push(pts);
      this.updrafts.push(updraft);
      this.updraftParticles.push(pts);
    }

    // 8. Clouds
    const cloudCount = rng.intRange(1, 3);
    for (let c = 0; c < cloudCount; c++) {
      this.addCloud(clouds, rng, startX + rng.range(0, this.chunkSize), rng.range(55, 110), startZ + rng.range(0, this.chunkSize));
    }

    const propMesh = props.mesh(this.matProps, true, true);
    if (propMesh) objects.push(propMesh);
    const glowMesh = glow.mesh(this.matGlow, false, false);
    if (glowMesh) objects.push(glowMesh);
    const fallMesh = falls.mesh(this.matWaterfall, false, false);
    if (fallMesh) objects.push(fallMesh);
    const cloudMesh = clouds.mesh(this.matCloud, false, false);
    if (cloudMesh) {
      cloudMesh.matrixAutoUpdate = true;
      cloudMesh.userData.cloud = true;
      objects.push(cloudMesh);
    }

    for (const o of objects) this.chunkRoot.add(o);

    this.activeChunks.set(key, { key, cx, cz, objects, updrafts, updraftPoints, colliders, feathers });
  }

  /**
   * Safely unloads a distant chunk, releasing all meshes and geometries
   */
  private unloadChunk(key: string): void {
    const chunk = this.activeChunks.get(key);
    if (!chunk) return;
    this.activeChunks.delete(key);

    for (const obj of chunk.objects) {
      this.chunkRoot.remove(obj);
      const g = (obj as THREE.Mesh).geometry;
      if (g) g.dispose();
    }

    for (const u of chunk.updrafts) {
      const idx = this.updrafts.indexOf(u);
      if (idx !== -1) this.updrafts.splice(idx, 1);
    }
    for (const pts of chunk.updraftPoints) {
      const idx = this.updraftParticles.indexOf(pts);
      if (idx !== -1) this.updraftParticles.splice(idx, 1);
    }
    for (const f of chunk.feathers) {
      const idx = this.activeFeathers.indexOf(f);
      if (idx !== -1) this.activeFeathers.splice(idx, 1);
    }
  }

  // --- GROUND ---

  private createChunkGroundMesh(startX: number, startZ: number, size: number): { mesh: THREE.Mesh; minHeight: number } {
    const segments = 22;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const colors = new Float32Array(arr.length);
    const c = new THREE.Color();
    let minHeight = Infinity;

    const centerX = startX + size * 0.5;
    const centerZ = startZ + size * 0.5;

    for (let i = 0; i < arr.length / 3; i++) {
      const worldX = centerX + arr[i * 3];
      const worldZ = centerZ + arr[i * 3 + 2];
      const h = World.getGroundHeight(worldX, worldZ);
      arr[i * 3 + 1] = h;
      if (h < minHeight) minHeight = h;

      // Height-banded coloring: sandy shore -> meadow -> darker highland -> rocky crest
      const n = Math.sin(worldX * 0.11) * Math.cos(worldZ * 0.13) * 0.5 + 0.5;
      if (h < -1.2) {
        c.copy(PAL.sand);
      } else if (h < 0.4) {
        c.copy(PAL.sand).lerp(PAL.grassLow, (h + 1.2) / 1.6);
      } else if (h < 30) {
        c.copy(PAL.grassLow).lerp(PAL.grassHigh, THREE.MathUtils.clamp(h / 30 + (n - 0.5) * 0.35, 0, 1));
      } else {
        c.copy(PAL.grassHigh).lerp(PAL.cliff, THREE.MathUtils.clamp((h - 30) / 14, 0, 1));
      }
      c.offsetHSL(0, 0, (n - 0.5) * 0.05);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.matGround);
    mesh.position.set(centerX, 0, centerZ);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return { mesh, minHeight };
  }

  // --- VEGETATION & PROPS (added straight into a chunk batch) ---

  private pick<T>(rng: ChunkRNG, arr: T[]): T {
    return arr[Math.floor(rng.next() * arr.length) % arr.length];
  }

  private addPineTree(b: GeoBatch, rng: ChunkRNG, x: number, y: number, z: number, height: number, radius: number): void {
    const trunkH = height * 0.3;
    b.add(new THREE.CylinderGeometry(radius * 0.16, radius * 0.24, trunkH, 6), PAL.trunk, [x, y + trunkH * 0.5, z]);
    const color = this.pick(rng, PAL.pine);
    const tiers = 3;
    const tierH = ((height - trunkH) / tiers) * 1.45;
    for (let i = 0; i < tiers; i++) {
      const r = radius * (1.0 - i * 0.26);
      b.add(new THREE.ConeGeometry(r, tierH, 8), color, [x, y + trunkH + i * tierH * 0.6 + tierH * 0.5, z], [0, rng.range(0, 3), 0]);
    }
  }

  private addOakTree(b: GeoBatch, rng: ChunkRNG, x: number, y: number, z: number, height: number, radius: number, autumn: boolean): void {
    const trunkH = height * 0.45;
    b.add(new THREE.CylinderGeometry(radius * 0.2, radius * 0.32, trunkH, 6), PAL.trunk, [x, y + trunkH * 0.5, z]);
    const palette = autumn ? PAL.autumn : PAL.oak;
    const canopyCount = 4;
    for (let i = 0; i < canopyCount; i++) {
      const cRadius = radius * rng.range(0.62, 0.95);
      const angle = (i / canopyCount) * Math.PI * 2 + rng.range(0, 1);
      const dist = i === 0 ? 0 : radius * 0.45;
      b.add(
        new THREE.IcosahedronGeometry(cRadius, 1),
        this.pick(rng, palette),
        [x + Math.cos(angle) * dist, y + trunkH + radius * 0.55 + (i === 0 ? radius * 0.35 : rng.range(-0.6, 0.6)), z + Math.sin(angle) * dist]
      );
    }
  }

  private addBoulder(b: GeoBatch, rng: ChunkRNG, x: number, y: number, z: number, radius: number): void {
    const geo = new THREE.DodecahedronGeometry(radius, 0);
    const arr = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < arr.length / 3; i++) {
      arr[i * 3] *= 0.85 + Math.sin(i * 1.7) * 0.2;
      arr[i * 3 + 1] *= 0.7 + Math.cos(i * 2.3) * 0.2;
      arr[i * 3 + 2] *= 0.85 + Math.sin(i * 3.1) * 0.2;
    }
    b.add(geo, this.pick(rng, PAL.rock), [x, y, z], [rng.range(0, 3), rng.range(0, 3), 0]);
  }

  /** Floating island with grass cap, rocky stalactite, trees, waterfall and optional temple. Returns radius. */
  private addSanctuaryIsland(b: GeoBatch, falls: GeoBatch, rng: ChunkRNG, x: number, y: number, z: number, temple: boolean): number {
    const radius = rng.range(20, 30);
    const depth = rng.range(28, 40);

    b.add(new THREE.CylinderGeometry(radius, radius * 0.92, 5, 10), PAL.islandGrass, [x, y, z]);
    b.add(new THREE.CylinderGeometry(radius * 0.95, radius * 0.95, 2, 10), 0x6b5a46, [x, y - 3, z]);
    b.add(new THREE.ConeGeometry(radius * 0.9, depth, 9), PAL.islandRock, [x, y - depth / 2 - 3.5, z], [Math.PI, 0, 0]);
    b.add(new THREE.ConeGeometry(radius * 0.35, depth * 0.5, 7), 0x7d6a55, [x + radius * 0.35, y - depth * 0.45, z - radius * 0.2], [Math.PI, 0, 0]);

    const treeCount = 4 + Math.floor(rng.next() * 4);
    for (let t = 0; t < treeCount; t++) {
      const ang = rng.range(0, Math.PI * 2);
      const dist = rng.range(0, radius * 0.7);
      this.addPineTree(b, rng, x + Math.cos(ang) * dist, y + 2.5, z + Math.sin(ang) * dist, rng.range(8, 13), 3.0);
    }

    // Waterfall streaming off the ledge
    falls.add(new THREE.PlaneGeometry(5, depth * 1.6), 0xffffff, [x + radius * 0.9, y - depth * 0.7, z], [0, Math.PI / 2, 0]);

    if (temple) {
      const tz = z - radius * 0.2;
      b.add(new THREE.CylinderGeometry(1.2, 1.4, 16, 8), PAL.marble, [x - 7, y + 10.5, tz]);
      b.add(new THREE.CylinderGeometry(1.2, 1.4, 16, 8), PAL.marble, [x + 7, y + 10.5, tz]);
      b.add(new THREE.BoxGeometry(18, 2.2, 3.4), PAL.marble, [x, y + 19.5, tz]);
      b.add(new THREE.BoxGeometry(20, 1, 4.4), 0xe2d9c6, [x, y + 2.9, tz]);
    }
    return radius;
  }

  /** Layered sandstone mesa rising from the ground. */
  private addCanyonSpire(b: GeoBatch, rng: ChunkRNG, x: number, y: number, z: number): { radius: number; height: number } {
    const radius = rng.range(18, 28);
    const height = rng.range(80, 130);
    const layers = 5;
    let r = radius;
    let cy = y;
    for (let i = 0; i < layers; i++) {
      const h = height / layers;
      const top = r * rng.range(0.78, 0.9);
      b.add(new THREE.CylinderGeometry(top, r, h, 8), PAL.canyon[i % PAL.canyon.length], [x, cy + h / 2, z], [0, rng.range(0, 1), 0]);
      cy += h;
      r = top;
    }
    b.add(new THREE.CylinderGeometry(r * 0.95, r, 2, 8), PAL.islandGrass, [x, cy + 1, z]);
    return { radius, height: height + 2 };
  }

  private addRockArch(b: GeoBatch, rng: ChunkRNG, x: number, y: number, z: number, rotY: number): { span: number; height: number } {
    const span = rng.range(55, 75);
    const height = rng.range(35, 48);
    const local = new GeoBatch();
    local.add(new THREE.CylinderGeometry(7, 12, height, 8), PAL.canyon[0], [-span / 2, height / 2, 0]);
    local.add(new THREE.CylinderGeometry(7, 12, height, 8), PAL.canyon[1], [span / 2, height / 2, 0]);
    local.add(new THREE.BoxGeometry(span + 12, 7, 14), PAL.canyon[2], [0, height + 2, 0]);
    local.add(new THREE.BoxGeometry(span + 8, 1.5, 12), PAL.islandGrass, [0, height + 6.2, 0]);
    b.addBatch(local, [x, y, z], rotY);
    return { span, height };
  }

  private addCrystalIsland(b: GeoBatch, glow: GeoBatch, rng: ChunkRNG, x: number, y: number, z: number): number {
    const radius = rng.range(18, 26);
    const depth = rng.range(25, 35);
    b.add(new THREE.CylinderGeometry(radius, radius * 0.9, 3, 8), 0x9a8cb0, [x, y - 1.5, z]);
    b.add(new THREE.ConeGeometry(radius * 0.9, depth, 8), 0x6f6488, [x, y - depth / 2 - 3, z], [Math.PI, 0, 0]);

    const crystalCount = 4 + Math.floor(rng.next() * 4);
    for (let c = 0; c < crystalCount; c++) {
      const h = rng.range(7, 18);
      const r = rng.range(1.4, 2.8);
      const px = x + rng.range(-radius * 0.55, radius * 0.55);
      const pz = z + rng.range(-radius * 0.55, radius * 0.55);
      glow.add(new THREE.OctahedronGeometry(1, 0), this.pick(rng, PAL.crystal), [px, y + h * 0.45, pz], [rng.range(-0.25, 0.25), rng.range(0, 3), rng.range(-0.25, 0.25)], [r, h * 0.55, r]);
    }
    return radius;
  }

  /** Soft cotton cloud: smooth puffs with flattened bellies. */
  private addCloud(b: GeoBatch, rng: ChunkRNG, x: number, y: number, z: number): void {
    const puffCount = 5 + Math.floor(rng.next() * 4);
    const len = rng.range(30, 50);
    for (let i = 0; i < puffCount; i++) {
      const t = puffCount === 1 ? 0.5 : i / (puffCount - 1);
      const middle = 1 - Math.abs(t - 0.5) * 1.4;
      const radius = rng.range(7, 10) + middle * 7;
      const geo = new THREE.IcosahedronGeometry(radius, 2);
      const arr = geo.attributes.position.array as Float32Array;
      const nrm = geo.attributes.normal.array as Float32Array;
      for (let k = 0; k < arr.length; k += 3) {
        // Smooth sphere normals (the icosahedron is non-indexed, so computeVertexNormals would facet it)
        const l = Math.hypot(arr[k], arr[k + 1], arr[k + 2]);
        nrm[k] = arr[k] / l;
        nrm[k + 1] = arr[k + 1] / l;
        nrm[k + 2] = arr[k + 2] / l;
        if (arr[k + 1] < 0) arr[k + 1] *= 0.35; // flat belly
      }
      b.add(geo, 0xffffff, [x + (t - 0.5) * len, y + middle * 4 + rng.range(-1, 1), z + rng.range(-7, 7)]);
    }
  }

  private createUpdraftParticles(updraft: UpdraftZone): THREE.Points {
    const count = 70;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const meta = new Float32Array(count * 2); // angle, radius

    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * updraft.radius;
      meta[i * 2] = ang;
      meta[i * 2 + 1] = r;
      pos[i * 3] = updraft.center.x + Math.cos(ang) * r;
      pos[i * 3 + 1] = updraft.center.y - updraft.height / 2 + Math.random() * updraft.height;
      pos[i * 3 + 2] = updraft.center.z + Math.sin(ang) * r;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.userData.meta = meta;
    const pts = new THREE.Points(geo, this.matUpdraft);
    pts.frustumCulled = false;
    return pts;
  }

  /**
   * Check if bird is inside an updraft thermal column
   */
  public checkUpdraft(birdPos: THREE.Vector3): UpdraftZone | null {
    for (const u of this.updrafts) {
      const dx = birdPos.x - u.center.x;
      const dz = birdPos.z - u.center.z;
      if (dx * dx + dz * dz < u.radius * u.radius) {
        const minY = u.center.y - u.height / 2;
        const maxY = u.center.y + u.height / 2;
        if (birdPos.y >= minY && birdPos.y <= maxY) {
          return u;
        }
      }
    }
    return null;
  }

  /**
   * Query current lateral storm wind push at a position (pure, no side effects)
   */
  public getWindVector(birdPos: THREE.Vector3): THREE.Vector3 {
    if (this.stormIntensity <= 0.001) return new THREE.Vector3(0, 0, 0);
    const magnitude = this.maxWindPush * this.stormIntensity;
    const gustX = Math.sin(birdPos.x * 0.01 + this.windAngle) * 0.25;
    const gustZ = Math.cos(birdPos.z * 0.01 + this.windAngle) * 0.25;
    return new THREE.Vector3(
      (Math.cos(this.windAngle) + gustX) * magnitude,
      0,
      (Math.sin(this.windAngle) + gustZ) * magnitude
    );
  }

  /**
   * Check collection of golden feathers
   */
  public checkFeatherCollection(birdPos: THREE.Vector3, collectionRadius: number = 5.5): boolean {
    for (const feather of this.activeFeathers) {
      if (feather.collected) continue;
      if (birdPos.distanceToSquared(feather.position) < collectionRadius * collectionRadius) {
        feather.collected = true;
        return true;
      }
    }
    return false;
  }

  /**
   * Make sure a ring placed at `pos` has open air around it. Returns false when the chunk under it
   * isn't generated yet (try again later); otherwise nudges `pos` clear of islands, spires and trees.
   */
  public clearRingSpot(pos: THREE.Vector3, ringRadius: number): boolean {
    const cx = Math.floor(pos.x / this.chunkSize);
    const cz = Math.floor(pos.z / this.chunkSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!this.activeChunks.has(`${cx + dx},${cz + dz}`)) return false;
      }
    }
    const margin = ringRadius + 4;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const chunk = this.activeChunks.get(`${cx + dx},${cz + dz}`)!;
          for (const col of chunk.colliders) {
            const hx = pos.x - col.x;
            const hz = pos.z - col.z;
            const reach = col.radius + margin;
            if (hx * hx + hz * hz > reach * reach) continue;
            if (pos.y < col.bottomY - margin || pos.y > col.topY + margin) continue;
            const ground = World.getGroundHeight(pos.x, pos.z);
            const above = col.topY + margin;
            const below = col.bottomY - margin;
            if (above < 95) pos.y = above;
            else if (below > Math.max(ground, -2.5) + ringRadius + 6) pos.y = below;
            else {
              // Tall spire: slide the ring sideways out of it
              const d = Math.hypot(hx, hz) || 1;
              pos.x = col.x + (hx / d) * (reach + 2);
              pos.z = col.z + (hz / d) * (reach + 2);
            }
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    pos.y = Math.max(pos.y, Math.max(World.getGroundHeight(pos.x, pos.z), -2.5) + ringRadius + 6);
    return true;
  }

  /**
   * Check physical collision with ground terrain, trees, boulders, and cliffs.
   */
  public checkTerrainCollision(
    birdPos: THREE.Vector3,
    birdRadius: number = 1.0
  ): { hasCollision: boolean; isFatal: boolean; reason: string; safeY: number } {
    const groundElevation = World.getGroundHeight(birdPos.x, birdPos.z);
    const surface = Math.max(groundElevation, -2.5);
    if (birdPos.y <= surface + 0.8) {
      return {
        hasCollision: true,
        isFatal: true,
        reason: groundElevation < -2.5 ? 'Tercebur ke danau' : 'Menabrak permukaan tanah',
        safeY: surface + 1.2
      };
    }

    const cx = Math.floor(birdPos.x / this.chunkSize);
    const cz = Math.floor(birdPos.z / this.chunkSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const chunk = this.activeChunks.get(`${cx + dx},${cz + dz}`);
        if (!chunk) continue;

        for (const col of chunk.colliders) {
          const cdx = birdPos.x - col.x;
          const cdz = birdPos.z - col.z;
          const hitRadius = col.radius + birdRadius;
          if (cdx * cdx + cdz * cdz < hitRadius * hitRadius && birdPos.y >= col.bottomY && birdPos.y <= col.topY) {
            return { hasCollision: true, isFatal: true, reason: col.name, safeY: col.topY + 1.2 };
          }
        }
      }
    }

    return { hasCollision: false, isFatal: false, reason: '', safeY: birdPos.y };
  }

  /**
   * Update world: chunk streaming, sky follow, cloud drift, updraft spiral and feather bobbing.
   */
  public update(delta: number, birdPos?: THREE.Vector3, distanceTraveled: number = 0): void {
    this.time += delta;

    const rampProgress = THREE.MathUtils.clamp(distanceTraveled / 5000, 0, 1);
    const stormWave = Math.sin(distanceTraveled * 0.00035) * 0.5 + 0.5;
    const stormWindow = THREE.MathUtils.clamp((stormWave - 0.55) / 0.45, 0, 1);
    this.stormIntensity = stormWindow * rampProgress;
    this.windAngle = distanceTraveled * 0.0006;

    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) {
      const targetDensity = THREE.MathUtils.lerp(this.baseFogDensity, this.baseFogDensity * 2.5, this.stormIntensity);
      fog.density = THREE.MathUtils.damp(fog.density, targetDensity, 1.2, delta);
    }
    if (this.dirLight) {
      const targetIntensity = THREE.MathUtils.lerp(this.baseDirLightIntensity, this.baseDirLightIntensity * 0.45, this.stormIntensity);
      this.dirLight.intensity = THREE.MathUtils.damp(this.dirLight.intensity, targetIntensity, 1.2, delta);
    }

    if (birdPos) {
      const cx = Math.floor(birdPos.x / this.chunkSize);
      const cz = Math.floor(birdPos.z / this.chunkSize);

      // Spawn at most one new chunk per frame to avoid hitches when crossing a chunk border
      let spawned = false;
      for (let dx = -this.loadRadius; dx <= this.loadRadius && !spawned; dx++) {
        for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
          if (!this.activeChunks.has(`${cx + dx},${cz + dz}`)) {
            this.spawnChunk(cx + dx, cz + dz);
            spawned = true;
            break;
          }
        }
      }

      const toRemove: string[] = [];
      for (const [key, chunk] of this.activeChunks) {
        if (Math.abs(chunk.cx - cx) > this.unloadRadius || Math.abs(chunk.cz - cz) > this.unloadRadius) {
          toRemove.push(key);
        }
      }
      for (const key of toRemove) this.unloadChunk(key);

      this.sky.position.set(birdPos.x, birdPos.y * 0.4, birdPos.z);
      this.dirLight.position.set(birdPos.x + 160, birdPos.y + 260, birdPos.z - 120);
      this.dirLight.target.position.copy(birdPos);
      this.dirLight.target.updateMatrixWorld();
    }

    // Drifting clouds (whole chunk cloud mesh drifts slowly)
    for (const o of this.chunkRoot.children) {
      if (o.userData.cloud) {
        o.position.x += delta * 1.5;
        o.position.z += delta * 0.4;
      }
    }

    // Rising spiral particles in updraft thermals
    for (let p = 0; p < this.updraftParticles.length; p++) {
      const pts = this.updraftParticles[p];
      const updraft = this.updrafts[p];
      if (!updraft) continue;
      const attr = pts.geometry.attributes.position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const meta = pts.geometry.userData.meta as Float32Array;
      const bottom = updraft.center.y - updraft.height / 2;
      const top = updraft.center.y + updraft.height / 2;
      for (let i = 0; i < arr.length / 3; i++) {
        let y = arr[i * 3 + 1] + delta * 16;
        if (y > top) y = bottom;
        const ang = (meta[i * 2] += delta * 1.6);
        const r = meta[i * 2 + 1];
        arr[i * 3] = updraft.center.x + Math.cos(ang) * r;
        arr[i * 3 + 1] = y;
        arr[i * 3 + 2] = updraft.center.z + Math.sin(ang) * r;
      }
      attr.needsUpdate = true;
    }

    // Golden feathers: spin, bob, and glow (instanced)
    const glowAttr = this.featherGlow.geometry.attributes.position as THREE.BufferAttribute;
    const glowArr = glowAttr.array as Float32Array;
    let n = 0;
    for (const f of this.activeFeathers) {
      if (f.collected || n >= this.maxFeathers) continue;
      const bob = Math.sin(this.time * 2.2 + f.position.z * 0.1) * 0.7;
      this.tmpPos.set(f.position.x, f.position.y + bob, f.position.z);
      this.tmpQuat.setFromEuler(this.tmpEuler.set(0, this.time * 2.4 + f.position.x, 0.35));
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.featherMesh.setMatrixAt(n, this.tmpMatrix);
      glowArr[n * 3] = this.tmpPos.x;
      glowArr[n * 3 + 1] = this.tmpPos.y;
      glowArr[n * 3 + 2] = this.tmpPos.z;
      n++;
    }
    this.featherMesh.count = n;
    this.featherMesh.instanceMatrix.needsUpdate = true;
    this.featherGlow.geometry.setDrawRange(0, n);
    glowAttr.needsUpdate = true;
  }

  /**
   * Reset world chunks back to initial 5x5 grid around origin
   */
  public reset(): void {
    for (const key of Array.from(this.activeChunks.keys())) this.unloadChunk(key);
    this.activeChunks.clear();
    this.updrafts = [];
    this.updraftParticles = [];
    this.activeFeathers = [];

    this.stormIntensity = 0;
    this.windAngle = 0;
    (this.scene.fog as THREE.FogExp2).density = this.baseFogDensity;
    this.dirLight.intensity = this.baseDirLightIntensity;

    this.fillGrid(0, 0);
  }
}
