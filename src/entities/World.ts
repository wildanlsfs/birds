import * as THREE from 'three';

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
  mesh: THREE.Group;
  collected: boolean;
}

interface ChunkData {
  key: string;
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;
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

/**
 * Procedural Natural Sky & Valley World:
 * Full 2D infinite procedural terrain generation in all directions (X and Z).
 * Wherever the player flies—forward, left, right, or backwards—new terrain chunks,
 * undulating green hills, forests, rivers, high-altitude sanctuaries, updrafts,
 * and glowing golden feathers are generated dynamically with zero void gaps.
 */
export class World {
  public scene: THREE.Scene;
  private islandsGroup: THREE.Group;
  private groundGroup: THREE.Group;
  private cloudsGroup: THREE.Group;
  private riverGroup: THREE.Group;
  private feathersGroup: THREE.Group;

  // Active updraft zones and particle systems
  public updrafts: UpdraftZone[] = [];
  private updraftParticles: THREE.Points[] = [];

  // Active collectible feathers
  public activeFeathers: GoldenFeather[] = [];

  // 2D Infinite Chunk Grid Management
  private activeChunks: Map<string, ChunkData> = new Map();
  public readonly chunkSize = 220; // 220 meters per chunk
  private readonly loadRadius = 2; // 5x5 active chunk grid centered around player (1100m x 1100m)
  private readonly unloadRadius = 3; // Unload margin beyond active radius

  // Shared Materials (Cached for maximum performance and zero memory leaks)
  private matGrass: THREE.MeshStandardMaterial;
  private matGroundSlope: THREE.MeshStandardMaterial;
  private matRock: THREE.MeshStandardMaterial;
  private matWood: THREE.MeshStandardMaterial;
  private matLeavesPine: THREE.MeshStandardMaterial;
  private matLeavesOak: THREE.MeshStandardMaterial;
  private matLeavesAutumn: THREE.MeshStandardMaterial;
  private matMarble: THREE.MeshStandardMaterial;
  private matCanyon: THREE.MeshStandardMaterial;
  private matCrystal: THREE.MeshStandardMaterial;
  private matWaterfall: THREE.MeshBasicMaterial;
  private matCloud: THREE.MeshStandardMaterial;
  private matRiver: THREE.MeshStandardMaterial;
  private matFeatherGold: THREE.MeshStandardMaterial;

  // Sky & Lighting elements tracked with player
  private dirLight!: THREE.DirectionalLight;
  private sky!: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.islandsGroup = new THREE.Group();
    this.groundGroup = new THREE.Group();
    this.cloudsGroup = new THREE.Group();
    this.riverGroup = new THREE.Group();
    this.feathersGroup = new THREE.Group();

    // 1. Initialize Realistic Natural Materials
    this.matGrass = new THREE.MeshStandardMaterial({
      color: 0x3d7e26, // Lush alpine green
      roughness: 0.85,
      metalness: 0.05,
      flatShading: true
    });
    this.matGroundSlope = new THREE.MeshStandardMaterial({
      color: 0x5a4d38, // Earthy rocky cliff soil
      roughness: 0.95,
      flatShading: true
    });
    this.matRock = new THREE.MeshStandardMaterial({
      color: 0x595349,
      roughness: 0.9,
      flatShading: true
    });
    this.matWood = new THREE.MeshStandardMaterial({
      color: 0x422a18,
      roughness: 0.92
    });
    this.matLeavesPine = new THREE.MeshStandardMaterial({
      color: 0x1e5422, // Deep spruce/pine green
      roughness: 0.75,
      flatShading: true
    });
    this.matLeavesOak = new THREE.MeshStandardMaterial({
      color: 0x3d8b28, // Bright oak foliage
      roughness: 0.7,
      flatShading: true
    });
    this.matLeavesAutumn = new THREE.MeshStandardMaterial({
      color: 0xd98218, // Golden autumnal orange
      roughness: 0.72,
      flatShading: true
    });
    this.matMarble = new THREE.MeshStandardMaterial({
      color: 0xe8e4de,
      roughness: 0.45,
      metalness: 0.1
    });
    this.matCanyon = new THREE.MeshStandardMaterial({
      color: 0x824b33,
      roughness: 0.9,
      flatShading: true
    });
    this.matCrystal = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x0088cc,
      emissiveIntensity: 0.85,
      roughness: 0.2,
      metalness: 0.85,
      flatShading: true
    });
    this.matWaterfall = new THREE.MeshBasicMaterial({
      color: 0x7ae8ff,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide
    });
    this.matCloud = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.25,
      metalness: 0.05,
      transparent: true,
      opacity: 0.88,
      flatShading: true
    });
    this.matRiver = new THREE.MeshStandardMaterial({
      color: 0x1e6f9f, // Sparkling azure river
      roughness: 0.15,
      metalness: 0.75,
      transparent: true,
      opacity: 0.88,
      flatShading: true
    });
    this.matFeatherGold = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      emissive: 0xff9900,
      emissiveIntensity: 0.75,
      roughness: 0.2,
      metalness: 0.6
    });

    this.setupLighting();
    this.setupSkyAndFog();

    this.scene.add(this.groundGroup);
    this.scene.add(this.riverGroup);
    this.scene.add(this.islandsGroup);
    this.scene.add(this.cloudsGroup);
    this.scene.add(this.feathersGroup);

    // Pre-generate 5x5 chunk grid centered at origin (0, 0)
    for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
      for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
        this.spawnChunk(dx, dz);
      }
    }
  }

  private setupLighting(): void {
    const hemiLight = new THREE.HemisphereLight(0xcde6ff, 0x3d6b2c, 0.9);
    this.scene.add(hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff3d1, 1.45);
    this.dirLight.position.set(160, 260, -120);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 900;
    const d = 220;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    const ambient = new THREE.AmbientLight(0xd9ebff, 0.45);
    this.scene.add(ambient);
  }

  private setupSkyAndFog(): void {
    this.scene.fog = new THREE.FogExp2(0xcde6fa, 0.0013);
    this.scene.background = new THREE.Color(0xb5dcff);

    // Atmospheric Sky Dome
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
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `;

    const uniforms = {
      topColor: { value: new THREE.Color(0x2d6ec2) },    // Deep azure blue
      bottomColor: { value: new THREE.Color(0xffeedb) }, // Golden peach horizon
      offset: { value: 60 },
      exponent: { value: 0.55 }
    };

    const skyGeo = new THREE.SphereGeometry(2200, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      side: THREE.BackSide,
      depthWrite: false
    });

    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.sky);
  }

  /**
   * Pure continuous mathematical 2D function calculating ground elevation y at any (x, z).
   * Creates an isotropic, seamless world with sweeping valleys, rolling hills,
   * mountain ridges, and river basins extending infinitely in all directions.
   */
  public static getGroundHeight(x: number, z: number): number {
    // 1. Broad continental rolling valleys & ridges (-8m to +30m)
    const macro1 = Math.sin(x * 0.0032 + z * 0.0021) * 16.0;
    const macro2 = Math.cos(x * 0.0018 - z * 0.0035) * 13.0;
    const macro3 = Math.sin(x * 0.0049 + 1.2) * Math.cos(z * 0.0043 + 0.7) * 11.0;

    // 2. Rolling hills (-6m to +8m)
    const hill1 = Math.sin(x * 0.012 + z * 0.009) * 6.0;
    const hill2 = Math.cos(x * 0.009 - z * 0.016) * 4.8;

    // 3. Fine terrain undulations (-2.5m to +2.5m)
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

  /**
   * Spawns a procedural 2D chunk at chunk coordinates (cx, cz)
   */
  private spawnChunk(cx: number, cz: number): void {
    const key = `${cx},${cz}`;
    if (this.activeChunks.has(key)) return;

    const chunkObjList: THREE.Object3D[] = [];
    const chunkUpdrafts: UpdraftZone[] = [];
    const chunkUpdraftPts: THREE.Points[] = [];
    const chunkColliders: TerrainCollider[] = [];
    const chunkFeathers: GoldenFeather[] = [];

    const startX = cx * this.chunkSize;
    const startZ = cz * this.chunkSize;
    const centerX = startX + this.chunkSize * 0.5;
    const centerZ = startZ + this.chunkSize * 0.5;

    // Deterministic RNG seeded by chunk coordinates
    const seed = ((cx * 73856093) ^ (cz * 19349663) ^ 0x9e3779b9) >>> 0;
    const rng = new ChunkRNG(seed);

    // 1. GENERATE CONTINUOUS UNDULATING GROUND TERRAIN MESH
    const { mesh: groundMesh, minHeight } = this.createChunkGroundMesh(startX, startZ, this.chunkSize);
    this.groundGroup.add(groundMesh);
    chunkObjList.push(groundMesh);

    // 2. GENERATE RIVER / LAKE WATER SURFACE IN LOW DEPRESSIONS
    if (minHeight < -2.2) {
      const waterMesh = this.createWaterMesh(centerX, centerZ, this.chunkSize);
      this.riverGroup.add(waterMesh);
      chunkObjList.push(waterMesh);
    }

    // 3. POPULATE NATURAL TREES ON GROUND TERRAIN
    const treeCount = rng.intRange(9, 16);
    for (let t = 0; t < treeCount; t++) {
      const tx = startX + rng.range(8, this.chunkSize - 8);
      const tz = startZ + rng.range(8, this.chunkSize - 8);
      const groundY = World.getGroundHeight(tx, tz);

      // Do not plant trees deep in water or on extreme high mountain crests
      if (groundY < -1.8 || groundY > 52) continue;

      const treeType = rng.next();
      let treeGroup: THREE.Group;
      let treeHeight = 10;
      let crownRadius = 4;

      if (treeType < 0.55) {
        treeHeight = rng.range(11, 18);
        crownRadius = rng.range(3.6, 5.1);
        treeGroup = this.createPineTree(treeHeight, crownRadius);
      } else if (treeType < 0.85) {
        treeHeight = rng.range(9, 14);
        crownRadius = rng.range(4.5, 6.3);
        treeGroup = this.createOakTree(treeHeight, crownRadius, false);
      } else {
        treeHeight = rng.range(10, 15);
        crownRadius = rng.range(4.2, 5.8);
        treeGroup = this.createOakTree(treeHeight, crownRadius, true);
      }

      treeGroup.position.set(tx, groundY, tz);
      this.groundGroup.add(treeGroup);
      chunkObjList.push(treeGroup);

      chunkColliders.push({
        x: tx,
        z: tz,
        topY: groundY + treeHeight,
        bottomY: groundY,
        radius: crownRadius * 0.85,
        name: 'Pepohonan Hutan Lembah'
      });
    }

    // 4. SCATTER BOULDERS ACROSS VALLEY & SLOPES
    const boulderCount = rng.intRange(3, 6);
    for (let b = 0; b < boulderCount; b++) {
      const bx = startX + rng.range(6, this.chunkSize - 6);
      const bz = startZ + rng.range(6, this.chunkSize - 6);
      const by = World.getGroundHeight(bx, bz);
      const bRadius = rng.range(2.2, 4.8);

      const boulder = this.createBoulder(bRadius);
      boulder.position.set(bx, by + bRadius * 0.35, bz);
      this.groundGroup.add(boulder);
      chunkObjList.push(boulder);

      chunkColliders.push({
        x: bx,
        z: bz,
        topY: by + bRadius * 1.2,
        bottomY: by,
        radius: bRadius,
        name: 'Bongkahan Batu Lembah'
      });
    }

    // 5. HIGH-ALTITUDE FEATURES (Floating Islands, Spires, Arches, Crystals)
    const skyRoll = rng.next();
    if (skyRoll < 0.36) {
      const skyType = rng.intRange(0, 3);
      if (skyType === 0) {
        // Sanctuary of the Sky (Floating island with streaming waterfall)
        const island = this.createSanctuaryIsland();
        const offsetX = centerX + rng.range(-this.chunkSize * 0.28, this.chunkSize * 0.28);
        const offsetZ = centerZ + rng.range(-this.chunkSize * 0.28, this.chunkSize * 0.28);
        const groundUnder = World.getGroundHeight(offsetX, offsetZ);
        const offsetY = Math.max(groundUnder + 32, rng.range(38, 58));
        island.position.set(offsetX, offsetY, offsetZ);
        this.islandsGroup.add(island);
        chunkObjList.push(island);

        chunkColliders.push({
          x: offsetX,
          z: offsetZ,
          topY: offsetY + 3.0,
          bottomY: offsetY - 30,
          radius: 26,
          name: 'Pulau Tebing Melayang'
        });
      } else if (skyType === 1) {
        // Titan Rock Spire & Fly-through Bridge Arch
        const spire = this.createCanyonSpire();
        const spireX = centerX + rng.range(-this.chunkSize * 0.3, this.chunkSize * 0.3);
        const spireZ = centerZ + rng.range(-this.chunkSize * 0.3, this.chunkSize * 0.3);
        const groundUnder = World.getGroundHeight(spireX, spireZ);
        const spireY = Math.max(groundUnder + 12, rng.range(18, 35));
        spire.position.set(spireX, spireY, spireZ);
        this.islandsGroup.add(spire);
        chunkObjList.push(spire);

        chunkColliders.push({
          x: spireX,
          z: spireZ,
          topY: spireY + 55,
          bottomY: spireY - 50,
          radius: 18,
          name: 'Pilar Tebing Raksasa'
        });

        // Natural Stone Arch nearby
        const arch = this.createRockBridgeArch();
        const archX = spireX + rng.range(-45, 45);
        const archZ = spireZ + rng.range(-45, 45);
        arch.position.set(archX, spireY + 6, archZ);
        arch.rotation.y = rng.range(0, Math.PI);
        this.islandsGroup.add(arch);
        chunkObjList.push(arch);
      } else if (skyType === 2) {
        // Luminescent Crystal Spire Island
        const crystalIsland = this.createCrystalIsland();
        const cX = centerX + rng.range(-this.chunkSize * 0.28, this.chunkSize * 0.28);
        const cZ = centerZ + rng.range(-this.chunkSize * 0.28, this.chunkSize * 0.28);
        const groundUnder = World.getGroundHeight(cX, cZ);
        const cY = Math.max(groundUnder + 30, rng.range(36, 56));
        crystalIsland.position.set(cX, cY, cZ);
        this.islandsGroup.add(crystalIsland);
        chunkObjList.push(crystalIsland);

        chunkColliders.push({
          x: cX,
          z: cZ,
          topY: cY + 3.0,
          bottomY: cY - 25,
          radius: 22,
          name: 'Tebing Kristal Langit'
        });
      } else {
        // Cloud Haven Sanctuary Arch
        const island = this.createSanctuaryIsland();
        const iX = centerX + rng.range(-this.chunkSize * 0.25, this.chunkSize * 0.25);
        const iZ = centerZ + rng.range(-this.chunkSize * 0.25, this.chunkSize * 0.25);
        const groundUnder = World.getGroundHeight(iX, iZ);
        const iY = Math.max(groundUnder + 36, rng.range(42, 64));
        island.position.set(iX, iY, iZ);
        this.islandsGroup.add(island);
        chunkObjList.push(island);

        chunkColliders.push({
          x: iX,
          z: iZ,
          topY: iY + 3.0,
          bottomY: iY - 32,
          radius: 25,
          name: 'Kuil Pulau Melayang'
        });
      }
    }

    // 6. SCATTER COLLECTIBLE GOLDEN FEATHERS (1 to 2 per chunk)
    const featherCount = rng.intRange(1, 2);
    for (let f = 0; f < featherCount; f++) {
      const fX = startX + rng.range(15, this.chunkSize - 15);
      const fZ = startZ + rng.range(15, this.chunkSize - 15);
      const groundAtPos = World.getGroundHeight(fX, fZ);
      const fY = Math.max(groundAtPos + 5.5, rng.range(16, 42));

      const featherMesh = this.createGoldenFeatherMesh();
      featherMesh.position.set(fX, fY, fZ);
      this.feathersGroup.add(featherMesh);
      chunkObjList.push(featherMesh);

      const featherItem: GoldenFeather = {
        position: new THREE.Vector3(fX, fY, fZ),
        mesh: featherMesh,
        collected: false
      };
      chunkFeathers.push(featherItem);
      this.activeFeathers.push(featherItem);
    }

    // 7. UPDRAFT THERMAL VORTEX (Spawn in ~45% of chunks)
    if (rng.next() < 0.45) {
      const updraftX = centerX + rng.range(-this.chunkSize * 0.35, this.chunkSize * 0.35);
      const updraftZ = centerZ + rng.range(-this.chunkSize * 0.35, this.chunkSize * 0.35);
      const groundUnder = World.getGroundHeight(updraftX, updraftZ);
      const updraftY = Math.max(groundUnder + 18, rng.range(24, 42));

      const updraft: UpdraftZone = {
        center: new THREE.Vector3(updraftX, updraftY, updraftZ),
        radius: 25,
        height: 140,
        strength: 24
      };
      const pts = this.createUpdraftParticles(updraft);
      this.scene.add(pts);

      chunkUpdrafts.push(updraft);
      chunkUpdraftPts.push(pts);
      this.updrafts.push(updraft);
      this.updraftParticles.push(pts);
    }

    // 8. SCENIC CLOUDS
    const cloudCount = rng.intRange(1, 3);
    for (let c = 0; c < cloudCount; c++) {
      const cloud = this.createCloudCluster();
      cloud.position.set(
        startX + rng.range(0, this.chunkSize),
        rng.range(42, 105),
        startZ + rng.range(0, this.chunkSize)
      );
      this.cloudsGroup.add(cloud);
      chunkObjList.push(cloud);
    }

    // Register active chunk record
    this.activeChunks.set(key, {
      key,
      cx,
      cz,
      centerX,
      centerZ,
      objects: chunkObjList,
      updrafts: chunkUpdrafts,
      updraftPoints: chunkUpdraftPts,
      colliders: chunkColliders,
      feathers: chunkFeathers
    });
  }

  /**
   * Safely unloads a distant chunk, releasing all meshes, particle systems, and geometries
   */
  private unloadChunk(key: string): void {
    const chunk = this.activeChunks.get(key);
    if (!chunk) return;
    this.activeChunks.delete(key);

    // Remove all chunk objects and dispose geometries
    for (const obj of chunk.objects) {
      this.groundGroup.remove(obj);
      this.riverGroup.remove(obj);
      this.islandsGroup.remove(obj);
      this.cloudsGroup.remove(obj);
      this.feathersGroup.remove(obj);
      this.scene.remove(obj);

      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (mesh.geometry) {
            mesh.geometry.dispose();
          }
        }
      });
    }

    // Clean up updrafts
    for (const u of chunk.updrafts) {
      const idx = this.updrafts.indexOf(u);
      if (idx !== -1) this.updrafts.splice(idx, 1);
    }
    for (const pts of chunk.updraftPoints) {
      const idx = this.updraftParticles.indexOf(pts);
      if (idx !== -1) this.updraftParticles.splice(idx, 1);
      this.scene.remove(pts);
      pts.geometry.dispose();
      if (pts.material && (pts.material as THREE.Material).dispose) {
        (pts.material as THREE.Material).dispose();
      }
    }

    // Clean up feathers
    for (const f of chunk.feathers) {
      const idx = this.activeFeathers.indexOf(f);
      if (idx !== -1) this.activeFeathers.splice(idx, 1);
    }
  }

  // --- PROCEDURAL 2D CHUNK GROUND GENERATOR ---

  private createChunkGroundMesh(
    startX: number,
    startZ: number,
    size: number
  ): { mesh: THREE.Mesh; minHeight: number } {
    const segments = 22;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    let minHeight = Infinity;

    const centerX = startX + size * 0.5;
    const centerZ = startZ + size * 0.5;

    for (let i = 0; i < arr.length / 3; i++) {
      // Local X and Z on plane centered at 0
      const localX = arr[i * 3];
      const localZ = arr[i * 3 + 2];
      const worldX = centerX + localX;
      const worldZ = centerZ + localZ;
      const h = World.getGroundHeight(worldX, worldZ);
      arr[i * 3 + 1] = h;
      if (h < minHeight) minHeight = h;
    }

    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.matGrass);
    mesh.position.set(centerX, 0, centerZ);
    mesh.receiveShadow = true;
    return { mesh, minHeight };
  }

  private createWaterMesh(centerX: number, centerZ: number, size: number): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(size, size, 2, 2);
    geo.rotateX(-Math.PI / 2);
    const river = new THREE.Mesh(geo, this.matRiver);
    river.position.set(centerX, -2.5, centerZ);
    river.receiveShadow = true;
    return river;
  }

  // --- NATURAL VEGETATION & PROPS ---

  private createPineTree(height: number, radius: number): THREE.Group {
    const tree = new THREE.Group();

    // Trunk
    const trunkH = height * 0.35;
    const trunkGeo = new THREE.CylinderGeometry(radius * 0.18, radius * 0.28, trunkH, 6);
    trunkGeo.translate(0, trunkH * 0.5, 0);
    const trunk = new THREE.Mesh(trunkGeo, this.matWood);
    trunk.castShadow = true;
    tree.add(trunk);

    // 3-tiered conical needle foliage
    const tiers = 3;
    const coneTotalH = height - trunkH;
    const tierH = (coneTotalH / tiers) * 1.4;

    for (let i = 0; i < tiers; i++) {
      const tierRadius = radius * (1.0 - i * 0.24);
      const coneGeo = new THREE.ConeGeometry(tierRadius, tierH, 7);
      coneGeo.translate(0, trunkH + (i * tierH * 0.65) + tierH * 0.5, 0);
      const foliage = new THREE.Mesh(coneGeo, this.matLeavesPine);
      foliage.castShadow = true;
      tree.add(foliage);
    }

    return tree;
  }

  private createOakTree(height: number, radius: number, isAutumn: boolean): THREE.Group {
    const tree = new THREE.Group();

    // Trunk
    const trunkH = height * 0.45;
    const trunkGeo = new THREE.CylinderGeometry(radius * 0.22, radius * 0.35, trunkH, 6);
    trunkGeo.translate(0, trunkH * 0.5, 0);
    const trunk = new THREE.Mesh(trunkGeo, this.matWood);
    trunk.castShadow = true;
    tree.add(trunk);

    // Rounded leafy foliage canopy
    const mat = isAutumn ? this.matLeavesAutumn : this.matLeavesOak;
    const canopyCount = 4;
    for (let i = 0; i < canopyCount; i++) {
      const cRadius = radius * (0.65 + Math.random() * 0.35);
      const cGeo = new THREE.DodecahedronGeometry(cRadius, 1);
      const angle = (i / canopyCount) * Math.PI * 2;
      const dist = (i === 0) ? 0 : radius * 0.4;
      const canopy = new THREE.Mesh(cGeo, mat);
      canopy.position.set(
        Math.cos(angle) * dist,
        trunkH + radius * 0.6 + (i === 0 ? radius * 0.3 : (Math.random() - 0.5) * 1.5),
        Math.sin(angle) * dist
      );
      canopy.castShadow = true;
      tree.add(canopy);
    }

    return tree;
  }

  private createBoulder(radius: number): THREE.Mesh {
    const geo = new THREE.DodecahedronGeometry(radius, 1);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length / 3; i++) {
      arr[i * 3] *= 0.85 + Math.sin(i * 1.7) * 0.25;
      arr[i * 3 + 1] *= 0.75 + Math.cos(i * 2.3) * 0.25;
      arr[i * 3 + 2] *= 0.85 + Math.sin(i * 3.1) * 0.25;
    }
    geo.computeVertexNormals();

    const boulder = new THREE.Mesh(geo, this.matRock);
    boulder.castShadow = true;
    boulder.receiveShadow = true;
    return boulder;
  }

  private createGoldenFeatherMesh(): THREE.Group {
    const group = new THREE.Group();

    // Stylized Glowing Feather
    const stemGeo = new THREE.CylinderGeometry(0.08, 0.12, 3.2, 5);
    const stem = new THREE.Mesh(stemGeo, this.matFeatherGold);
    group.add(stem);

    // Feather vanes
    const vaneGeo = new THREE.ConeGeometry(0.8, 2.6, 5);
    vaneGeo.scale(1, 1, 0.15);
    vaneGeo.translate(0, 0.4, 0);
    const vane = new THREE.Mesh(vaneGeo, this.matFeatherGold);
    group.add(vane);

    // Glowing aura particle / halo
    const haloGeo = new THREE.SphereGeometry(1.6, 8, 8);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0.25,
      wireframe: true
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    group.add(halo);

    return group;
  }

  // --- FLOATING HIGH SANCTUARIES & SPIRES ---

  private createSanctuaryIsland(): THREE.Group {
    const island = new THREE.Group();
    const radius = 22 + Math.random() * 12;
    const depth = 30 + Math.random() * 15;

    // Top grass plateau
    const topGeo = new THREE.CylinderGeometry(radius, radius * 0.9, 5, 8);
    const topMesh = new THREE.Mesh(topGeo, this.matGrass);
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    island.add(topMesh);

    // Rocky bottom stalactite cone
    const coneGeo = new THREE.ConeGeometry(radius * 0.9, depth, 8);
    coneGeo.rotateX(Math.PI);
    coneGeo.translate(0, -depth / 2 - 2.5, 0);
    const coneMesh = new THREE.Mesh(coneGeo, this.matRock);
    coneMesh.castShadow = true;
    coneMesh.receiveShadow = true;
    island.add(coneMesh);

    // Trees on island
    const treeCount = 4 + Math.floor(Math.random() * 4);
    for (let t = 0; t < treeCount; t++) {
      const tree = this.createPineTree(9 + Math.random() * 5, 3.2);
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.random() * (radius * 0.7);
      tree.position.set(Math.cos(ang) * dist, 2.5, Math.sin(ang) * dist);
      island.add(tree);
    }

    // Sky Waterfall streaming off the island ledge
    const waterfall = new THREE.Mesh(new THREE.PlaneGeometry(5, depth * 1.5), this.matWaterfall);
    waterfall.position.set(radius * 0.85, -depth * 0.6, 0);
    waterfall.rotation.y = Math.PI / 2;
    island.add(waterfall);

    // Ancient marble temple pillars on select islands
    if (Math.random() > 0.4) {
      const arch = new THREE.Group();
      const p1 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 16, 6), this.matMarble);
      p1.position.set(-7, 8, 0);
      const p2 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 16, 6), this.matMarble);
      p2.position.set(7, 8, 0);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(18, 2.2, 3), this.matMarble);
      lintel.position.set(0, 16.5, 0);
      arch.add(p1, p2, lintel);
      arch.position.set(0, 2.5, 0);
      island.add(arch);
    }

    return island;
  }

  private createCanyonSpire(): THREE.Group {
    const spire = new THREE.Group();
    const radius = 24 + Math.random() * 16;
    const height = 90 + Math.random() * 60;

    const geo = new THREE.CylinderGeometry(radius * 0.4, radius, height, 7);
    const mesh = new THREE.Mesh(geo, this.matCanyon);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.y = height / 2;
    spire.add(mesh);

    return spire;
  }

  private createRockBridgeArch(): THREE.Group {
    const archGroup = new THREE.Group();
    const span = 60 + Math.random() * 25;
    const height = 35 + Math.random() * 15;

    const p1 = new THREE.Mesh(new THREE.CylinderGeometry(8, 14, height, 7), this.matCanyon);
    p1.position.set(-span / 2, height / 2, 0);
    const p2 = new THREE.Mesh(new THREE.CylinderGeometry(8, 14, height, 7), this.matCanyon);
    p2.position.set(span / 2, height / 2, 0);

    const bridge = new THREE.Mesh(new THREE.BoxGeometry(span + 10, 8, 16), this.matCanyon);
    bridge.position.set(0, height, 0);

    archGroup.add(p1, p2, bridge);
    return archGroup;
  }

  private createCrystalIsland(): THREE.Group {
    const group = new THREE.Group();
    const radius = 18 + Math.random() * 10;
    const depth = 25 + Math.random() * 10;

    const coneGeo = new THREE.ConeGeometry(radius, depth, 7);
    coneGeo.rotateX(Math.PI);
    const base = new THREE.Mesh(coneGeo, this.matRock);
    base.position.y = -depth / 2;
    group.add(base);

    const crystalCount = 3 + Math.floor(Math.random() * 3);
    for (let c = 0; c < crystalCount; c++) {
      const cHeight = 8 + Math.random() * 12;
      const cRadius = 1.6 + Math.random() * 1.5;
      const cGeo = new THREE.ConeGeometry(cRadius, cHeight, 5);
      const crystal = new THREE.Mesh(cGeo, this.matCrystal);
      crystal.position.set((Math.random() - 0.5) * 12, cHeight / 2, (Math.random() - 0.5) * 12);
      group.add(crystal);
    }

    return group;
  }

  private createCloudCluster(): THREE.Group {
    const cloud = new THREE.Group();
    const puffCount = 4 + Math.floor(Math.random() * 4);

    for (let i = 0; i < puffCount; i++) {
      const radius = 10 + Math.random() * 14;
      const puffGeo = new THREE.DodecahedronGeometry(radius, 1);
      const puff = new THREE.Mesh(puffGeo, this.matCloud);

      puff.position.set(
        (Math.random() - 0.5) * 32,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 32
      );
      cloud.add(puff);
    }

    return cloud;
  }

  private createUpdraftParticles(updraft: UpdraftZone): THREE.Points {
    const count = 180;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * updraft.radius;
      pos[i * 3] = updraft.center.x + Math.cos(ang) * r;
      pos[i * 3 + 1] = updraft.center.y - updraft.height / 2 + Math.random() * updraft.height;
      pos[i * 3 + 2] = updraft.center.z + Math.sin(ang) * r;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    // Particle texture
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(0, 255, 200, 1)');
    grad.addColorStop(0.5, 'rgba(0, 200, 255, 0.7)');
    grad.addColorStop(1, 'rgba(0, 150, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const mat = new THREE.PointsMaterial({
      color: 0x00ffcc,
      size: 2.4,
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    return new THREE.Points(geo, mat);
  }

  /**
   * Check if bird is inside an updraft thermal column
   */
  public checkUpdraft(birdPos: THREE.Vector3): UpdraftZone | null {
    for (const u of this.updrafts) {
      const dx = birdPos.x - u.center.x;
      const dz = birdPos.z - u.center.z;
      const distXZ = Math.sqrt(dx * dx + dz * dz);

      if (distXZ < u.radius) {
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
   * Check collection of golden feathers
   */
  public checkFeatherCollection(birdPos: THREE.Vector3, collectionRadius: number = 4.5): boolean {
    for (const feather of this.activeFeathers) {
      if (feather.collected) continue;

      const dx = birdPos.x - feather.position.x;
      const dy = birdPos.y - feather.position.y;
      const dz = birdPos.z - feather.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < collectionRadius * collectionRadius) {
        feather.collected = true;
        feather.mesh.visible = false;
        return true;
      }
    }
    return false;
  }

  /**
   * Check physical collision with ground terrain, forest trees, boulders, and cliffs in 360 degrees.
   * Returns whether a fatal collision occurred and the descriptive reason.
   */
  public checkTerrainCollision(
    birdPos: THREE.Vector3,
    birdRadius: number = 1.0
  ): { hasCollision: boolean; isFatal: boolean; reason: string; safeY: number } {
    // 1. Precise Natural Ground Collision (Using continuous mathematical heightmap)
    const groundElevation = World.getGroundHeight(birdPos.x, birdPos.z);
    if (birdPos.y <= groundElevation + 0.8) {
      return {
        hasCollision: true,
        isFatal: true,
        reason: 'Menabrak Permukaan Lembah / Tanah',
        safeY: groundElevation + 1.2
      };
    }

    // 2. Solid Props & Obstacles (Check immediate chunk and surrounding 8 neighboring chunks)
    const cx = Math.floor(birdPos.x / this.chunkSize);
    const cz = Math.floor(birdPos.z / this.chunkSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const chunk = this.activeChunks.get(`${cx + dx},${cz + dz}`);
        if (!chunk) continue;

        for (const col of chunk.colliders) {
          const cdx = birdPos.x - col.x;
          const cdz = birdPos.z - col.z;
          const distSq = cdx * cdx + cdz * cdz;
          const hitRadius = col.radius + birdRadius;

          if (distSq < hitRadius * hitRadius) {
            if (birdPos.y >= col.bottomY && birdPos.y <= col.topY) {
              return {
                hasCollision: true,
                isFatal: true,
                reason: col.name,
                safeY: col.topY + 1.2
              };
            }
          }
        }
      }
    }

    return { hasCollision: false, isFatal: false, reason: '', safeY: birdPos.y };
  }

  /**
   * Update world: dynamic 2D chunk streaming in all directions, sky follow,
   * cloud drift, updraft spiral animation, and feather bobbing.
   */
  public update(delta: number, birdPos?: THREE.Vector3): void {
    // 1. DYNAMIC 2D PROCEDURAL CHUNK STREAMING
    if (birdPos) {
      const cx = Math.floor(birdPos.x / this.chunkSize);
      const cz = Math.floor(birdPos.z / this.chunkSize);

      // Ensure all chunks within loadRadius are spawned
      for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
        for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
          const nx = cx + dx;
          const nz = cz + dz;
          const key = `${nx},${nz}`;
          if (!this.activeChunks.has(key)) {
            this.spawnChunk(nx, nz);
          }
        }
      }

      // Unload distant chunks outside unload radius
      const toRemove: string[] = [];
      for (const [key, chunk] of this.activeChunks) {
        if (
          Math.abs(chunk.cx - cx) > this.unloadRadius ||
          Math.abs(chunk.cz - cz) > this.unloadRadius
        ) {
          toRemove.push(key);
        }
      }
      for (const key of toRemove) {
        this.unloadChunk(key);
      }

      // Sky dome & directional sunlight follow player smoothly
      if (this.sky) {
        this.sky.position.set(birdPos.x, birdPos.y * 0.4, birdPos.z);
      }
      if (this.dirLight) {
        this.dirLight.position.set(birdPos.x + 160, birdPos.y + 260, birdPos.z - 120);
        this.dirLight.target.position.copy(birdPos);
        this.dirLight.target.updateMatrixWorld();
      }
    }

    // 2. Drifting scenic clouds
    this.cloudsGroup.children.forEach((c) => {
      c.position.x += delta * 1.5;
      c.position.z += delta * 0.4;
      if (birdPos) {
        if (c.position.x - birdPos.x > 650) c.position.x -= 1300;
        else if (c.position.x - birdPos.x < -650) c.position.x += 1300;
        if (c.position.z - birdPos.z > 650) c.position.z -= 1300;
        else if (c.position.z - birdPos.z < -650) c.position.z += 1300;
      }
    });

    // 3. Animate rising spiral particles in active updraft thermals
    this.updraftParticles.forEach((pts, idx) => {
      const updraft = this.updrafts[idx];
      if (!updraft) return;
      const pos = pts.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;

      for (let i = 0; i < arr.length / 3; i++) {
        arr[i * 3 + 1] += delta * 28; // Rise upward
        const dx = arr[i * 3] - updraft.center.x;
        const dz = arr[i * 3 + 2] - updraft.center.z;
        const ang = Math.atan2(dz, dx) + delta * 2.4;
        const r = Math.sqrt(dx * dx + dz * dz);
        arr[i * 3] = updraft.center.x + Math.cos(ang) * r;
        arr[i * 3 + 2] = updraft.center.z + Math.sin(ang) * r;

        if (arr[i * 3 + 1] > updraft.center.y + updraft.height / 2) {
          arr[i * 3 + 1] = updraft.center.y - updraft.height / 2;
        }
      }
      pos.needsUpdate = true;
    });

    // 4. Animate Golden Feathers (slow rotation & gentle bobbing)
    const now = performance.now() * 0.003;
    for (const f of this.activeFeathers) {
      if (!f.collected && f.mesh.visible) {
        f.mesh.rotation.y += delta * 2.5;
        f.mesh.position.y = f.position.y + Math.sin(now + f.position.z * 0.1) * 0.6;
      }
    }
  }

  /**
   * Reset world chunks back to initial 5x5 grid around origin
   */
  public reset(): void {
    const allKeys = Array.from(this.activeChunks.keys());
    for (const key of allKeys) {
      this.unloadChunk(key);
    }
    this.activeChunks.clear();
    this.updrafts = [];
    this.updraftParticles = [];
    this.activeFeathers = [];

    // Pre-generate 5x5 grid around origin
    for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
      for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
        this.spawnChunk(dx, dz);
      }
    }
  }
}
