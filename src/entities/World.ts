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
}

interface ChunkData {
  zStart: number;
  zEnd: number;
  objects: THREE.Object3D[];
  updrafts: UpdraftZone[];
  updraftPoints: THREE.Points[];
  colliders: TerrainCollider[];
}

/**
 * Procedural Endless Sky Archipelago World 2.0:
 * Infinitely generated sky archipelago with 4 distinct biomes:
 * 1. Sanctuary of the Sky (Floating islands with lush trees, ancient marble ruins & sky waterfalls)
 * 2. Titan Canyon (Massive towering stone spires & fly-through natural rock arches)
 * 3. Luminescent Crystal Spire (Floating clusters of glowing turquoise crystals & mystic monoliths)
 * 4. Stratosphere Cloud Haven (Thick cloud banks & soaring updraft thermal vortices)
 *
 * Includes automatic chunk generation ahead of the bird and efficient recycling
 * behind the bird to maintain a flat memory footprint and silky smooth 60 FPS.
 */
export class World {
  public scene: THREE.Scene;
  private islandsGroup: THREE.Group;
  private cloudsGroup: THREE.Group;
  private seaPlane!: THREE.Mesh;

  // Active updraft zones and rising particle systems
  public updrafts: UpdraftZone[] = [];
  private updraftParticles: THREE.Points[] = [];

  // Endless Chunk Management
  private activeChunks: ChunkData[] = [];
  private furthestZ = 0;
  private chunkIndex = 0;
  private readonly chunkSize = 300; // 300 meters per chunk

  // Shared Materials (Cached to avoid memory leaks)
  private matGrass: THREE.MeshStandardMaterial;
  private matRock: THREE.MeshStandardMaterial;
  private matWood: THREE.MeshStandardMaterial;
  private matLeaves: THREE.MeshStandardMaterial;
  private matMarble: THREE.MeshStandardMaterial;
  private matCanyon: THREE.MeshStandardMaterial;
  private matCrystal: THREE.MeshStandardMaterial;
  private matWaterfall: THREE.MeshBasicMaterial;
  private matCloud: THREE.MeshStandardMaterial;
  private matSea: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.islandsGroup = new THREE.Group();
    this.cloudsGroup = new THREE.Group();

    // 1. Initialize Materials
    this.matGrass = new THREE.MeshStandardMaterial({ color: 0x4d9628, roughness: 0.8, flatShading: true });
    this.matRock = new THREE.MeshStandardMaterial({ color: 0x61584e, roughness: 0.9, flatShading: true });
    this.matWood = new THREE.MeshStandardMaterial({ color: 0x462d1c, roughness: 0.9 });
    this.matLeaves = new THREE.MeshStandardMaterial({ color: 0x2e6f1a, roughness: 0.7, flatShading: true });
    this.matMarble = new THREE.MeshStandardMaterial({ color: 0xe8e4de, roughness: 0.45, metalness: 0.1 });
    this.matCanyon = new THREE.MeshStandardMaterial({ color: 0x824b33, roughness: 0.9, flatShading: true });
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
      opacity: 0.86,
      flatShading: true
    });
    this.matSea = new THREE.MeshStandardMaterial({
      color: 0x18426b,
      roughness: 0.2,
      metalness: 0.6,
      transparent: true,
      opacity: 0.85,
      flatShading: true
    });

    this.setupLighting();
    this.setupSkyAndFog();
    this.setupSeaOfClouds();

    this.scene.add(this.islandsGroup);
    this.scene.add(this.cloudsGroup);

    // Pre-generate initial chunks ahead (from Z = +50 to Z = -1200)
    for (let i = 0; i < 4; i++) {
      this.spawnChunk(this.furthestZ);
      this.furthestZ -= this.chunkSize;
    }
  }

  private setupLighting(): void {
    // Soft skylight
    const hemiLight = new THREE.HemisphereLight(0xb1e1ff, 0x385723, 0.85);
    this.scene.add(hemiLight);

    // Warm directional sun (optimized 512x512 shadow map for smooth 60 FPS on laptops)
    const dirLight = new THREE.DirectionalLight(0xfff3d1, 1.4);
    dirLight.position.set(140, 240, -100);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 512;
    dirLight.shadow.mapSize.height = 512;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 800;
    const d = 160;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    this.scene.add(dirLight);

    const ambient = new THREE.AmbientLight(0xd9ebff, 0.45);
    this.scene.add(ambient);
  }

  private setupSkyAndFog(): void {
    this.scene.fog = new THREE.FogExp2(0xcde6fa, 0.0014);
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
      bottomColor: { value: new THREE.Color(0xffedd2) }, // Golden peach horizon
      offset: { value: 60 },
      exponent: { value: 0.55 }
    };

    const skyGeo = new THREE.SphereGeometry(1800, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      side: THREE.BackSide,
      depthWrite: false
    });

    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);
  }

  private setupSeaOfClouds(): void {
    // Vast shimmering low-poly cloud sea / ocean plane far below
    const seaGeo = new THREE.PlaneGeometry(3500, 3500, 32, 32);
    seaGeo.rotateX(-Math.PI / 2);

    this.seaPlane = new THREE.Mesh(seaGeo, this.matSea);
    this.seaPlane.position.set(0, -95, -800);
    this.scene.add(this.seaPlane);
  }

  /**
   * Spawns a procedural chunk along the flight path
   */
  private spawnChunk(startZ: number): void {
    const chunkObjList: THREE.Object3D[] = [];
    const chunkUpdrafts: UpdraftZone[] = [];
    const chunkUpdraftPts: THREE.Points[] = [];
    const chunkColliders: TerrainCollider[] = [];

    const biome = this.chunkIndex % 4;
    this.chunkIndex++;

    const centerZ = startZ - this.chunkSize * 0.5;

    // 1. BIOME SPECIFIC LANDSCAPES
    if (biome === 0) {
      // --- BIOME 1: SANCTUARY OF THE SKY (Lush islands, trees, marble temple arches, waterfalls) ---
      const numIslands = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < numIslands; i++) {
        const island = this.createSanctuaryIsland();
        const offsetX = (Math.random() - 0.5) * 160;
        const offsetY = 5 + Math.random() * 35;
        const offsetZ = startZ - (i + 0.5) * (this.chunkSize / numIslands);
        island.position.set(offsetX, offsetY, offsetZ);

        this.islandsGroup.add(island);
        chunkObjList.push(island);
        chunkColliders.push({
          x: offsetX,
          z: offsetZ,
          topY: offsetY + 3.0,
          bottomY: offsetY - 35,
          radius: 28
        });
      }
    } else if (biome === 1) {
      // --- BIOME 2: TITAN CANYON (Towering red rock spires & fly-through natural rock arches) ---
      const numSpires = 3 + Math.floor(Math.random() * 2);
      for (let i = 0; i < numSpires; i++) {
        const spire = this.createCanyonSpire();
        const side = i % 2 === 0 ? 1 : -1;
        const offsetX = side * (55 + Math.random() * 70);
        const offsetY = -20 + Math.random() * 30;
        const offsetZ = startZ - (i + 0.4) * (this.chunkSize / numSpires);
        spire.position.set(offsetX, offsetY, offsetZ);

        this.islandsGroup.add(spire);
        chunkObjList.push(spire);
        chunkColliders.push({
          x: offsetX,
          z: offsetZ,
          topY: offsetY + 60,
          bottomY: offsetY - 60,
          radius: 20
        });
      }

      // Fly-through Natural Stone Bridge Arch
      const arch = this.createRockBridgeArch();
      arch.position.set((Math.random() - 0.5) * 40, 25, centerZ);
      this.islandsGroup.add(arch);
      chunkObjList.push(arch);

    } else if (biome === 2) {
      // --- BIOME 3: LUMINESCENT CRYSTAL SPIRE (Floating glowing cyan crystals & obelisks) ---
      const numCrystals = 3;
      for (let i = 0; i < numCrystals; i++) {
        const crystalIsland = this.createCrystalIsland();
        const offsetX = (Math.random() - 0.5) * 140;
        const offsetY = 10 + Math.random() * 40;
        const offsetZ = startZ - (i + 0.5) * (this.chunkSize / numCrystals);
        crystalIsland.position.set(offsetX, offsetY, offsetZ);

        this.islandsGroup.add(crystalIsland);
        chunkObjList.push(crystalIsland);
        chunkColliders.push({
          x: offsetX,
          z: offsetZ,
          topY: offsetY + 3.0,
          bottomY: offsetY - 25,
          radius: 22
        });
      }
    } else {
      // --- BIOME 4: STRATOSPHERE CLOUD HAVEN (High altitude islands, arches & thick cloudbanks) ---
      const island = this.createSanctuaryIsland();
      const islandX = (Math.random() - 0.5) * 110;
      const islandY = 45 + Math.random() * 25;
      island.position.set(islandX, islandY, centerZ);
      this.islandsGroup.add(island);
      chunkObjList.push(island);
      chunkColliders.push({
        x: islandX,
        z: centerZ,
        topY: islandY + 3.0,
        bottomY: islandY - 35,
        radius: 28
      });
    }

    // 2. SCENIC CLOUDS (4-6 clouds per chunk)
    const cloudCount = 5;
    for (let c = 0; c < cloudCount; c++) {
      const cloud = this.createCloudCluster();
      cloud.position.set(
        (Math.random() - 0.5) * 380,
        10 + Math.random() * 85,
        startZ - Math.random() * this.chunkSize
      );
      this.cloudsGroup.add(cloud);
      chunkObjList.push(cloud);
    }

    // 3. UPDRAFT THERMAL VORTEX (1 per chunk)
    const updraftX = (Math.random() - 0.5) * 100;
    const updraftY = 22 + Math.random() * 20;
    const updraft = {
      center: new THREE.Vector3(updraftX, updraftY, centerZ),
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

    // Save Chunk Record
    this.activeChunks.push({
      zStart: startZ,
      zEnd: startZ - this.chunkSize,
      objects: chunkObjList,
      updrafts: chunkUpdrafts,
      updraftPoints: chunkUpdraftPts,
      colliders: chunkColliders
    });
  }

  // --- PROCEDURAL ASSET GENERATORS ---

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

    // Pine & Sakura trees
    const treeCount = 4 + Math.floor(Math.random() * 4);
    for (let t = 0; t < treeCount; t++) {
      const tree = this.createTree();
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

    // Rock base
    const coneGeo = new THREE.ConeGeometry(radius, depth, 7);
    coneGeo.rotateX(Math.PI);
    const base = new THREE.Mesh(coneGeo, this.matRock);
    base.position.y = -depth / 2;
    group.add(base);

    // Glowing Crystal Cluster on top
    const crystalCount = 3 + Math.floor(Math.random() * 3);
    for (let c = 0; c < crystalCount; c++) {
      const cHeight = 8 + Math.random() * 12;
      const cRadius = 1.6 + Math.random() * 1.5;
      const cGeo = new THREE.ConeGeometry(cRadius, cHeight, 5);
      const crystal = new THREE.Mesh(cGeo, this.matCrystal);
      crystal.position.set((Math.random() - 0.5) * 12, cHeight / 2, (Math.random() - 0.5) * 12);
      crystal.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4);
      group.add(crystal);
    }

    return group;
  }

  private createTree(): THREE.Group {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 3, 5), this.matWood);
    trunk.position.y = 1.5;
    tree.add(trunk);

    for (let l = 0; l < 3; l++) {
      const foliage = new THREE.Mesh(new THREE.ConeGeometry(2.0 - l * 0.45, 2.4, 6), this.matLeaves);
      foliage.position.y = 3 + l * 1.4;
      tree.add(foliage);
    }
    tree.scale.setScalar(0.75 + Math.random() * 0.5);
    return tree;
  }

  private createCloudCluster(): THREE.Group {
    const cluster = new THREE.Group();
    const puffCount = 3 + Math.floor(Math.random() * 2);

    for (let p = 0; p < puffCount; p++) {
      const radius = 14 + Math.random() * 12;
      const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 1), this.matCloud);
      puff.position.set(
        (Math.random() - 0.5) * 35,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 35
      );
      puff.scale.set(1.3, 0.6 + Math.random() * 0.3, 1.3);
      cluster.add(puff);
    }
    return cluster;
  }

  private createUpdraftParticles(updraft: UpdraftZone): THREE.Points {
    const particleCount = 140;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * updraft.radius;
      pos[i * 3] = updraft.center.x + Math.cos(ang) * r;
      pos[i * 3 + 1] = updraft.center.y + (Math.random() - 0.5) * updraft.height;
      pos[i * 3 + 2] = updraft.center.z + Math.sin(ang) * r;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x6be0ff,
      size: 1.1,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending
    });

    const pts = new THREE.Points(geo, mat);

    // Visual glowing thermal helix cylinder
    const cylGeo = new THREE.CylinderGeometry(updraft.radius * 1.1, updraft.radius * 0.75, updraft.height, 16, 1, true);
    const cylMat = new THREE.MeshBasicMaterial({
      color: 0x3ac2ff,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      wireframe: true
    });
    const cyl = new THREE.Mesh(cylGeo, cylMat);
    cyl.position.copy(updraft.center);
    this.scene.add(cyl);

    return pts;
  }

  /**
   * Checks if bird is inside any active updraft thermal column
   */
  public checkUpdraft(birdPos: THREE.Vector3): UpdraftZone | null {
    for (const u of this.updrafts) {
      const dx = birdPos.x - u.center.x;
      const dz = birdPos.z - u.center.z;
      const horizDistSq = dx * dx + dz * dz;

      if (horizDistSq < u.radius * u.radius) {
        const dy = birdPos.y - u.center.y;
        if (Math.abs(dy) < u.height / 2) {
          return u;
        }
      }
    }
    return null;
  }

  /**
   * Update world: cloud drift, updraft spiral animation, and procedural endless chunk generation
   */
  public update(delta: number, birdPos?: THREE.Vector3): void {
    // 1. Drifting clouds slowly along X
    this.cloudsGroup.children.forEach((c) => {
      c.position.x += delta * 1.5;
      if (c.position.x > 450) {
        c.position.x = -450;
      }
    });

    // 2. Animate rising spiral particles in updraft thermals
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

    // 3. ENDLESS PROCEDURAL CHUNK STREAMING
    if (birdPos) {
      // Keep sea of clouds positioned beneath the bird
      this.seaPlane.position.z = birdPos.z - 400;

      // When bird approaches within 750m of furthest generated chunk, spawn next chunk
      if (birdPos.z - this.furthestZ < 750) {
        this.spawnChunk(this.furthestZ);
        this.furthestZ -= this.chunkSize;
      }

      // Recycle chunks that are > 450m behind the bird
      while (this.activeChunks.length > 0 && this.activeChunks[0].zEnd > birdPos.z + 450) {
        const oldChunk = this.activeChunks.shift()!;
        oldChunk.objects.forEach((obj) => {
          this.islandsGroup.remove(obj);
          this.cloudsGroup.remove(obj);
          this.scene.remove(obj);
        });

        // Clean up updrafts
        oldChunk.updrafts.forEach((u) => {
          const uIdx = this.updrafts.indexOf(u);
          if (uIdx !== -1) this.updrafts.splice(uIdx, 1);
        });
        oldChunk.updraftPoints.forEach((pts) => {
          const pIdx = this.updraftParticles.indexOf(pts);
          if (pIdx !== -1) this.updraftParticles.splice(pIdx, 1);
          this.scene.remove(pts);
          pts.geometry.dispose();
        });
      }
    }
  }

  /**
   * Check physical collision with islands, spires, and ground floor
   */
  public checkTerrainCollision(birdPos: THREE.Vector3, birdRadius: number = 1.0): { hasCollision: boolean; safeY: number } {
    // 1. Sea of clouds flight floor limit (plane is at -95, safe floor at +3.0)
    if (birdPos.y < 3.0) {
      return { hasCollision: true, safeY: 3.5 };
    }

    // 2. Solid Islands & Spires
    for (const chunk of this.activeChunks) {
      if (birdPos.z > chunk.zStart + 35 || birdPos.z < chunk.zEnd - 35) continue;

      for (const col of chunk.colliders) {
        const dx = birdPos.x - col.x;
        const dz = birdPos.z - col.z;
        const distSq = dx * dx + dz * dz;

        // Check horizontal radius
        if (distSq < (col.radius + birdRadius) * (col.radius + birdRadius)) {
          // Island top plateau collision (within 2.5m of the surface)
          if (birdPos.y <= col.topY + 0.8 && birdPos.y >= col.topY - 3.5) {
            return { hasCollision: true, safeY: col.topY + 1.2 };
          }

          // Mountain / spire cone body collision (tapers downward)
          if (birdPos.y < col.topY - 3.5 && birdPos.y > col.bottomY) {
            const hRatio = THREE.MathUtils.clamp((birdPos.y - col.bottomY) / (col.topY - col.bottomY), 0.1, 1.0);
            const coneR = col.radius * hRatio;
            if (distSq < (coneR + birdRadius) * (coneR + birdRadius)) {
              return { hasCollision: true, safeY: birdPos.y + 1.8 };
            }
          }
        }
      }
    }

    return { hasCollision: false, safeY: birdPos.y };
  }

  /**
   * Reset world chunks back to starting course
   */
  public reset(): void {
    for (const chunk of this.activeChunks) {
      chunk.objects.forEach((obj) => {
        this.islandsGroup.remove(obj);
        this.cloudsGroup.remove(obj);
        this.scene.remove(obj);
      });
      chunk.updraftPoints.forEach((pts) => {
        this.scene.remove(pts);
        pts.geometry.dispose();
      });
    }
    this.activeChunks = [];
    this.updrafts = [];
    this.updraftParticles = [];
    this.chunkIndex = 0;
    this.furthestZ = 0;

    for (let i = 0; i < 4; i++) {
      this.spawnChunk(this.furthestZ);
      this.furthestZ -= this.chunkSize;
    }
  }
}
