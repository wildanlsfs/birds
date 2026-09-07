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
  zStart: number;
  zEnd: number;
  objects: THREE.Object3D[];
  updrafts: UpdraftZone[];
  updraftPoints: THREE.Points[];
  colliders: TerrainCollider[];
  feathers: GoldenFeather[];
}

/**
 * Procedural Natural Sky & Valley World:
 * Features continuous undulating green ground hills, forest of pine and oak trees,
 * meandering azure river, high-altitude floating sanctuaries, updraft thermals,
 * and collectible glowing golden feathers.
 */
export class World {
  public scene: THREE.Scene;
  private islandsGroup: THREE.Group;
  private groundGroup: THREE.Group;
  private cloudsGroup: THREE.Group;
  private riverGroup: THREE.Group;
  private feathersGroup: THREE.Group;

  // Active updraft zones and rising particle systems
  public updrafts: UpdraftZone[] = [];
  private updraftParticles: THREE.Points[] = [];

  // Active collectible feathers
  public activeFeathers: GoldenFeather[] = [];

  // Endless Chunk Management
  private activeChunks: ChunkData[] = [];
  private furthestZ = 0;
  private chunkIndex = 0;
  private readonly chunkSize = 320; // 320 meters per chunk

  // Shared Materials (Cached for silky 60 FPS and zero memory leaks)
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

    // Pre-generate initial chunks ahead (from Z = +50 to Z = -1280)
    for (let i = 0; i < 4; i++) {
      this.spawnChunk(this.furthestZ);
      this.furthestZ -= this.chunkSize;
    }
  }

  private setupLighting(): void {
    const hemiLight = new THREE.HemisphereLight(0xcde6ff, 0x3d6b2c, 0.9);
    this.scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfff3d1, 1.45);
    dirLight.position.set(160, 260, -120);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 512;
    dirLight.shadow.mapSize.height = 512;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 900;
    const d = 180;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    this.scene.add(dirLight);

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

  /**
   * Pure mathematical function that calculates ground surface elevation y at any (x, z).
   * Generates a central natural valley with hills and mountain slopes on both flanks.
   */
  public static getGroundHeight(x: number, z: number): number {
    const absX = Math.abs(x);
    // Valley center (x ~ -30 to +30), rising hills outwards
    const hillElev = Math.max(0, (absX - 25) * 0.26);

    // Natural undulating terrain waves
    const wave1 = Math.sin(x * 0.032 + z * 0.018) * 5.0;
    const wave2 = Math.cos(x * 0.016 - z * 0.035) * 3.5;
    const wave3 = Math.sin(z * 0.007) * 2.5;

    // Meandering river groove in valley center
    const riverMeander = Math.sin(z * 0.018) * 18.0;
    const distToRiver = Math.abs(x - riverMeander);
    let riverDip = 0;
    if (distToRiver < 24) {
      riverDip = (1.0 - distToRiver / 24.0) * 4.5;
    }

    return -4.0 + hillElev + wave1 + wave2 + wave3 - riverDip;
  }

  /**
   * Spawns a procedural chunk along the flight path
   */
  private spawnChunk(startZ: number): void {
    const chunkObjList: THREE.Object3D[] = [];
    const chunkUpdrafts: UpdraftZone[] = [];
    const chunkUpdraftPts: THREE.Points[] = [];
    const chunkColliders: TerrainCollider[] = [];
    const chunkFeathers: GoldenFeather[] = [];

    const biome = this.chunkIndex % 4;
    this.chunkIndex++;
    const centerZ = startZ - this.chunkSize * 0.5;

    // 1. GENERATE CONTINUOUS UNDULATING GROUND TERRAIN
    const groundMesh = this.createValleyGroundMesh(startZ, this.chunkSize);
    this.groundGroup.add(groundMesh);
    chunkObjList.push(groundMesh);

    // 2. GENERATE MEANDERING RIVER
    const riverMesh = this.createRiverMesh(startZ, this.chunkSize);
    this.riverGroup.add(riverMesh);
    chunkObjList.push(riverMesh);

    // 3. POPULATE NATURAL TREES & BOULDERS ON THE GROUND
    const treeCount = 18 + Math.floor(Math.random() * 8);
    for (let t = 0; t < treeCount; t++) {
      // Scatter trees on slopes and valley banks
      const side = Math.random() > 0.5 ? 1 : -1;
      const treeX = side * (18 + Math.random() * 110);
      const treeZ = startZ - Math.random() * this.chunkSize;
      const groundY = World.getGroundHeight(treeX, treeZ);

      // Choose tree species (pine, oak, autumn)
      const treeType = Math.random();
      let treeGroup: THREE.Group;
      let treeHeight = 10;
      let crownRadius = 4;

      if (treeType < 0.55) {
        // Conifer Pine Tree
        treeHeight = 11 + Math.random() * 7;
        crownRadius = 3.6 + Math.random() * 1.5;
        treeGroup = this.createPineTree(treeHeight, crownRadius);
      } else if (treeType < 0.85) {
        // Broadleaf Oak Tree
        treeHeight = 9 + Math.random() * 5;
        crownRadius = 4.5 + Math.random() * 1.8;
        treeGroup = this.createOakTree(treeHeight, crownRadius, false);
      } else {
        // Autumn Birch / Maple
        treeHeight = 10 + Math.random() * 5;
        crownRadius = 4.2 + Math.random() * 1.6;
        treeGroup = this.createOakTree(treeHeight, crownRadius, true);
      }

      treeGroup.position.set(treeX, groundY, treeZ);
      this.groundGroup.add(treeGroup);
      chunkObjList.push(treeGroup);

      // Tree collider (trunk + foliage canopy)
      chunkColliders.push({
        x: treeX,
        z: treeZ,
        topY: groundY + treeHeight,
        bottomY: groundY,
        radius: crownRadius * 0.9,
        name: 'Pepohonan Hutan Lembah'
      });
    }

    // 4. SCATTER BOULDERS ALONG RIVERBANKS
    const boulderCount = 6 + Math.floor(Math.random() * 4);
    for (let b = 0; b < boulderCount; b++) {
      const bX = (Math.random() - 0.5) * 160;
      const bZ = startZ - Math.random() * this.chunkSize;
      const bY = World.getGroundHeight(bX, bZ);
      const bRadius = 2.5 + Math.random() * 3.5;

      const boulder = this.createBoulder(bRadius);
      boulder.position.set(bX, bY + bRadius * 0.4, bZ);
      this.groundGroup.add(boulder);
      chunkObjList.push(boulder);

      chunkColliders.push({
        x: bX,
        z: bZ,
        topY: bY + bRadius * 1.2,
        bottomY: bY,
        radius: bRadius,
        name: 'Bongkahan Batu Lembah'
      });
    }

    // 5. BIOME SPECIFIC HIGH-ALTITUDE FEATURES (Floating Islands & Rock Spires)
    if (biome === 0) {
      // Sanctuary of the Sky (Floating islands with waterfalls)
      const island = this.createSanctuaryIsland();
      const offsetX = (Math.random() - 0.5) * 120;
      const offsetY = 32 + Math.random() * 20;
      island.position.set(offsetX, offsetY, centerZ);
      this.islandsGroup.add(island);
      chunkObjList.push(island);
      chunkColliders.push({
        x: offsetX,
        z: centerZ,
        topY: offsetY + 3.0,
        bottomY: offsetY - 30,
        radius: 26,
        name: 'Pulau Tebing Melayang'
      });
    } else if (biome === 1) {
      // Titan Rock Spires & Natural Bridge Arch
      const spire = this.createCanyonSpire();
      const spireX = (Math.random() > 0.5 ? 1 : -1) * (60 + Math.random() * 40);
      const spireY = 10 + Math.random() * 25;
      spire.position.set(spireX, spireY, centerZ);
      this.islandsGroup.add(spire);
      chunkObjList.push(spire);
      chunkColliders.push({
        x: spireX,
        z: centerZ,
        topY: spireY + 55,
        bottomY: spireY - 50,
        radius: 18,
        name: 'Pilar Tebing Raksasa'
      });

      // Fly-through Natural Stone Bridge Arch
      const arch = this.createRockBridgeArch();
      arch.position.set((Math.random() - 0.5) * 35, 26, centerZ - 60);
      this.islandsGroup.add(arch);
      chunkObjList.push(arch);
    } else if (biome === 2) {
      // Luminescent Crystal Spire
      const crystalIsland = this.createCrystalIsland();
      const cX = (Math.random() - 0.5) * 110;
      const cY = 34 + Math.random() * 22;
      crystalIsland.position.set(cX, cY, centerZ);
      this.islandsGroup.add(crystalIsland);
      chunkObjList.push(crystalIsland);
      chunkColliders.push({
        x: cX,
        z: centerZ,
        topY: cY + 3.0,
        bottomY: cY - 25,
        radius: 22,
        name: 'Tebing Kristal Langit'
      });
    } else {
      // Cloud Haven Arch
      const island = this.createSanctuaryIsland();
      const iX = (Math.random() - 0.5) * 90;
      const iY = 42 + Math.random() * 24;
      island.position.set(iX, iY, centerZ);
      this.islandsGroup.add(island);
      chunkObjList.push(island);
      chunkColliders.push({
        x: iX,
        z: centerZ,
        topY: iY + 3.0,
        bottomY: iY - 32,
        radius: 25,
        name: 'Kuil Pulau Melayang'
      });
    }

    // 6. SCATTER COLLECTIBLE GOLDEN FEATHERS (3 per chunk)
    for (let f = 0; f < 3; f++) {
      const fX = (Math.random() - 0.5) * 80;
      const fZ = startZ - (f + 0.5) * (this.chunkSize / 3) + (Math.random() - 0.5) * 30;
      const groundAtPos = World.getGroundHeight(fX, fZ);
      const fY = Math.max(groundAtPos + 4.5, 14 + Math.random() * 25);

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

    // 7. SCENIC CLOUDS
    for (let c = 0; c < 5; c++) {
      const cloud = this.createCloudCluster();
      cloud.position.set(
        (Math.random() - 0.5) * 380,
        35 + Math.random() * 75,
        startZ - Math.random() * this.chunkSize
      );
      this.cloudsGroup.add(cloud);
      chunkObjList.push(cloud);
    }

    // 8. UPDRAFT THERMAL VORTEX
    const updraftX = (Math.random() - 0.5) * 90;
    const updraftY = 24 + Math.random() * 18;
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
      colliders: chunkColliders,
      feathers: chunkFeathers
    });
  }

  // --- PROCEDURAL VALLEY GROUND GENERATOR ---

  private createValleyGroundMesh(startZ: number, length: number): THREE.Mesh {
    const segmentsX = 36;
    const segmentsZ = 28;
    const width = 420;
    const geo = new THREE.PlaneGeometry(width, length, segmentsX, segmentsZ);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;

    for (let i = 0; i < arr.length / 3; i++) {
      const vx = arr[i * 3];
      // PlaneGeometry is centered at 0, map to world Z
      const vz = startZ - length * 0.5 + arr[i * 3 + 2];
      arr[i * 3 + 1] = World.getGroundHeight(vx, vz);
    }

    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.matGrass);
    mesh.position.set(0, 0, startZ - length * 0.5);
    mesh.receiveShadow = true;
    return mesh;
  }

  private createRiverMesh(startZ: number, length: number): THREE.Mesh {
    const segmentsZ = 30;
    const geo = new THREE.PlaneGeometry(36, length, 4, segmentsZ);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;

    for (let i = 0; i < arr.length / 3; i++) {
      const vz = startZ - length * 0.5 + arr[i * 3 + 2];
      const riverMeander = Math.sin(vz * 0.018) * 18.0;
      arr[i * 3] += riverMeander; // Follow meander
      arr[i * 3 + 1] = -3.2 + Math.sin(vz * 0.05) * 0.25; // Gentle water level
    }

    geo.computeVertexNormals();

    const river = new THREE.Mesh(geo, this.matRiver);
    river.position.set(0, 0, startZ - length * 0.5);
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
    // Deform vertices slightly for organic natural rock shape
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
   * Check physical collision with ground terrain, forest trees, boulders, and cliffs.
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

    // 2. Solid Props & Obstacles (Trees, Boulders, Islands, Spires)
    for (const chunk of this.activeChunks) {
      if (birdPos.z > chunk.zStart + 35 || birdPos.z < chunk.zEnd - 35) continue;

      for (const col of chunk.colliders) {
        const dx = birdPos.x - col.x;
        const dz = birdPos.z - col.z;
        const distSq = dx * dx + dz * dz;
        const hitRadius = col.radius + birdRadius;

        if (distSq < hitRadius * hitRadius) {
          // Check if bird Y is within vertical height bounds of collider
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

    return { hasCollision: false, isFatal: false, reason: '', safeY: birdPos.y };
  }

  /**
   * Update world: cloud drift, updraft spiral animation, feather bobbing, and procedural chunk streaming
   */
  public update(delta: number, birdPos?: THREE.Vector3): void {
    // 1. Drifting clouds
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

    // 3. Animate Golden Feathers (slow rotation & gentle bobbing)
    const now = performance.now() * 0.003;
    for (const f of this.activeFeathers) {
      if (!f.collected && f.mesh.visible) {
        f.mesh.rotation.y += delta * 2.5;
        f.mesh.position.y = f.position.y + Math.sin(now + f.position.z * 0.1) * 0.6;
      }
    }

    // 4. ENDLESS PROCEDURAL CHUNK STREAMING
    if (birdPos) {
      // When bird approaches within 750m of furthest generated chunk, spawn next chunk
      if (birdPos.z - this.furthestZ < 750) {
        this.spawnChunk(this.furthestZ);
        this.furthestZ -= this.chunkSize;
      }

      // Recycle chunks that are > 450m behind the bird
      while (this.activeChunks.length > 0 && this.activeChunks[0].zEnd > birdPos.z + 450) {
        const oldChunk = this.activeChunks.shift()!;
        oldChunk.objects.forEach((obj) => {
          this.groundGroup.remove(obj);
          this.riverGroup.remove(obj);
          this.islandsGroup.remove(obj);
          this.cloudsGroup.remove(obj);
          this.feathersGroup.remove(obj);
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

        // Clean up feathers
        oldChunk.feathers.forEach((f) => {
          const fIdx = this.activeFeathers.indexOf(f);
          if (fIdx !== -1) this.activeFeathers.splice(fIdx, 1);
        });
      }
    }
  }

  /**
   * Reset world chunks back to starting course
   */
  public reset(): void {
    for (const chunk of this.activeChunks) {
      chunk.objects.forEach((obj) => {
        this.groundGroup.remove(obj);
        this.riverGroup.remove(obj);
        this.islandsGroup.remove(obj);
        this.cloudsGroup.remove(obj);
        this.feathersGroup.remove(obj);
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
    this.activeFeathers = [];
    this.chunkIndex = 0;
    this.furthestZ = 0;

    for (let i = 0; i < 4; i++) {
      this.spawnChunk(this.furthestZ);
      this.furthestZ -= this.chunkSize;
    }
  }
}
