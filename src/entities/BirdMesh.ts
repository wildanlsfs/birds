import * as THREE from 'three';

export interface BirdProfile {
  id: 'small' | 'medium' | 'large';
  name: string;
  sizeLabel: string;
  subtitle: string;
  desc: string;
  icon: string;
  scale: number;
  bodyColor: number;
  bellyColor: number;
  wingColor: number;
  tipColor: number;
  accentColor: number;
  emissiveColor: number;
  emissiveIntensity: number;
  tail: 'fork' | 'fan' | 'plume';
  crest: boolean;
  stats: {
    speed: number;   // 0-100
    agility: number; // 0-100
    lift: number;    // 0-100
    glide: number;   // 0-100
  };
  physics: {
    cruiseSpeed: number;
    minSpeed: number;
    maxSpeed: number;
    turnRateMult: number;
    flapLift: number;
    glideEfficiency: number;
  };
}

export const BIRD_PROFILES: Record<'small' | 'medium' | 'large', BirdProfile> = {
  small: {
    id: 'small',
    name: 'Walet Kilat (Swift Colibri)',
    sizeLabel: 'Kecil / Super Lincah',
    subtitle: 'Manuver Ekstrem di Celah Rapat',
    desc: 'Bulu zamrud cerah. Berbelok sangat tajam di sela kanopi pohon hutan dan celah bukit sempit.',
    icon: '🪽',
    scale: 0.72,
    bodyColor: 0x1fb08c,
    bellyColor: 0xe4fbef,
    wingColor: 0x17a383,
    tipColor: 0x0b5d58,
    accentColor: 0xffc93c,
    emissiveColor: 0x003322,
    emissiveIntensity: 0.15,
    tail: 'fork',
    crest: false,
    stats: { speed: 82, agility: 98, lift: 82, glide: 72 },
    physics: {
      cruiseSpeed: 17.0,
      minSpeed: 4.5,
      maxSpeed: 45.0,
      turnRateMult: 1.45,
      flapLift: 18.0,
      glideEfficiency: 0.85
    }
  },
  medium: {
    id: 'medium',
    name: 'Elang Langit (Golden Falcon)',
    sizeLabel: 'Sedang / Seimbang',
    subtitle: 'Juara Serba Bisa & Kendali Nyaman',
    desc: 'Bulu biru laut kerajaan dengan paruh emas. Keseimbangan sempurna kecepatan, manuver, dan kestabilan.',
    icon: '🦅',
    scale: 1.0,
    bodyColor: 0x3568b4,
    bellyColor: 0xf7e8c8,
    wingColor: 0x2d5da6,
    tipColor: 0x172f5c,
    accentColor: 0xffb627,
    emissiveColor: 0x0a1a33,
    emissiveIntensity: 0.15,
    tail: 'fan',
    crest: false,
    stats: { speed: 88, agility: 85, lift: 88, glide: 86 },
    physics: {
      cruiseSpeed: 16.0,
      minSpeed: 5.0,
      maxSpeed: 50.0,
      turnRateMult: 1.0,
      flapLift: 16.0,
      glideEfficiency: 1.0
    }
  },
  large: {
    id: 'large',
    name: 'Garuda Phoenix (Mythic Phoenix)',
    sizeLabel: 'Besar / Soaring Glider',
    subtitle: 'Kecepatan Menukik Tertinggi & Sayap Raksasa',
    desc: 'Bulu kirmizi api menyala. Bentang sayap raksasa, meluncur sangat awet dan menukik super kencang.',
    icon: '🔥',
    scale: 1.4,
    bodyColor: 0xe2452c,
    bellyColor: 0xffc96e,
    wingColor: 0xec5b2c,
    tipColor: 0xffd23f,
    accentColor: 0xffd23f,
    emissiveColor: 0x7a1600,
    emissiveIntensity: 0.35,
    tail: 'plume',
    crest: true,
    stats: { speed: 98, agility: 68, lift: 94, glide: 98 },
    physics: {
      cruiseSpeed: 19.5,
      minSpeed: 6.0,
      maxSpeed: 62.0,
      turnRateMult: 0.72,
      flapLift: 14.5,
      glideEfficiency: 1.35
    }
  }
};

const INK = 0x2a2140;

/** Outline material: back faces pushed out along the normal (cartoon ink line). */
function makeInkMaterial(thick: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.thick = { value: thick };
    shader.vertexShader =
      'uniform float thick;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * thick;');
  };
  m.customProgramCacheKey = () => 'bird-ink-' + thick;
  return m;
}

/** Paint every vertex of a geometry with one color, or with a per-vertex function. */
function paint(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => THREE.Color): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i));
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Flat feather/wing panel from a 2D outline given as (x = span, y = chord toward the tail). */
function panel(points: [number, number][], thickness = 0.07): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.03,
    bevelSegments: 1,
    curveSegments: 6
  });
  geo.translate(0, 0, -thickness / 2);
  geo.rotateX(Math.PI / 2); // shape Y -> world +Z (toward the tail), extrusion -> vertical thickness
  geo.computeVertexNormals();
  return geo;
}

/**
 * Procedural stylized bird: rounded two-tone body, tapered wings with
 * fingered primaries, species-specific tails (forked / fan / phoenix plumes) and an ink outline
 * so it reads clearly against a bright sky.
 */
export class BirdMesh {
  public group: THREE.Group;
  public currentProfile: BirdProfile;

  private rig = new THREE.Group();
  private leftWingRoot = new THREE.Group();
  private rightWingRoot = new THREE.Group();
  private leftOuterWing = new THREE.Group();
  private rightOuterWing = new THREE.Group();
  private tailFeathers = new THREE.Group();

  private bodyMaterial: THREE.MeshStandardMaterial;
  private plainMaterial: THREE.MeshStandardMaterial;
  private inkThin = makeInkMaterial(0.035);
  private inkThick = makeInkMaterial(0.05);

  // Contrail trails
  private leftTrailPoints: THREE.Vector3[] = [];
  private rightTrailPoints: THREE.Vector3[] = [];
  private trailLineLeft: THREE.Line;
  private trailLineRight: THREE.Line;
  private trailMaxPoints = 40;

  // Animation state
  private flapPhase = 0;
  private diveAmt = 0;
  private flapIntensity = 1.0;
  private glidePhase = 0;
  private bob = 0;

  constructor(profileType: 'small' | 'medium' | 'large' = 'medium') {
    this.group = new THREE.Group();
    this.group.add(this.rig);
    this.currentProfile = BIRD_PROFILES[profileType];

    this.bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.0 });
    this.plainMaterial = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 });

    const trails = this.buildContrails();
    this.trailLineLeft = trails.left;
    this.trailLineRight = trails.right;

    this.applyProfile(this.currentProfile);
  }

  public setProfile(profile: BirdProfile): void {
    this.currentProfile = profile;
    this.applyProfile(profile);
  }

  private applyProfile(profile: BirdProfile): void {
    // Rebuild the model for the species (shapes differ, not just colors)
    for (const child of [...this.rig.children]) {
      this.rig.remove(child);
      child.traverse((o) => {
        const g = (o as THREE.Mesh).geometry;
        if (g) g.dispose();
      });
    }
    this.leftWingRoot = new THREE.Group();
    this.rightWingRoot = new THREE.Group();
    this.leftOuterWing = new THREE.Group();
    this.rightOuterWing = new THREE.Group();
    this.tailFeathers = new THREE.Group();

    this.bodyMaterial.emissive.setHex(profile.emissiveColor);
    this.bodyMaterial.emissiveIntensity = profile.emissiveIntensity;
    this.plainMaterial.color.setHex(profile.accentColor);
    this.plainMaterial.emissive.setHex(profile.emissiveColor);
    this.plainMaterial.emissiveIntensity = profile.emissiveIntensity;

    this.buildBody(profile);
    this.buildWing(profile, 1);
    this.buildWing(profile, -1);
    this.buildTail(profile);

    this.group.scale.setScalar(profile.scale);

    const trailColor = new THREE.Color(profile.accentColor).lerp(new THREE.Color(0xffffff), 0.5);
    (this.trailLineLeft.material as THREE.LineBasicMaterial).color.copy(trailColor);
    (this.trailLineRight.material as THREE.LineBasicMaterial).color.copy(trailColor);
  }

  private add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, ink: THREE.Material | null, cast = true): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = cast;
    if (ink) {
      const outline = new THREE.Mesh(geo, ink);
      outline.raycast = () => {};
      mesh.add(outline);
    }
    parent.add(mesh);
    return mesh;
  }

  private buildBody(p: BirdProfile): void {
    const body = new THREE.Color(p.bodyColor);
    const belly = new THREE.Color(p.bellyColor);
    const tmp = new THREE.Color();

    // Teardrop body: lathe profile along Y, then pointed so +Y becomes forward (-Z)
    const prof = [
      [0.0, -1.55], [0.16, -1.4], [0.36, -1.0], [0.52, -0.45], [0.58, 0.05],
      [0.54, 0.5], [0.42, 0.85], [0.22, 1.05], [0.0, 1.12]
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const bodyGeo = new THREE.LatheGeometry(prof, 18);
    bodyGeo.rotateX(-Math.PI / 2);
    bodyGeo.scale(1.0, 0.82, 1.0);
    paint(bodyGeo, (_x, y, _z, _nx, ny) => tmp.copy(body).lerp(belly, THREE.MathUtils.smoothstep(-ny - y * 0.4, 0.05, 0.55)));
    this.add(this.rig, bodyGeo, this.bodyMaterial, this.inkThick);

    // Head
    const headGeo = new THREE.SphereGeometry(0.5, 18, 14);
    headGeo.scale(0.95, 0.9, 1.0);
    paint(headGeo, (_x, y, z) => tmp.copy(body).lerp(belly, THREE.MathUtils.smoothstep(-y - z * 0.6, 0.15, 0.45)));
    const head = this.add(this.rig, headGeo, this.bodyMaterial, this.inkThick);
    head.position.set(0, 0.32, -1.08);

    // Beak: short cone with a slight downward hook
    const beakGeo = new THREE.ConeGeometry(0.17, 0.55, 10);
    beakGeo.rotateX(-Math.PI / 2 - 0.18);
    const beak = this.add(this.rig, beakGeo, this.plainMaterial, this.inkThin, false);
    beak.position.set(0, 0.24, -1.66);

    // Phoenix crest: three swept plumes on the head
    if (p.crest) {
      const crestColor = new THREE.Color(p.tipColor);
      for (let i = 0; i < 3; i++) {
        const g = panel([[0, 0], [0.09, 0.2], [0.05, 0.7 - Math.abs(i - 1) * 0.15], [-0.05, 0.7 - Math.abs(i - 1) * 0.15], [-0.09, 0.2]], 0.04);
        paint(g, () => crestColor);
        g.rotateZ(Math.PI / 2); // stand the plume up (shape lies in XZ, so roll it onto its edge)
        g.rotateX(-0.5);
        g.rotateY((i - 1) * 0.45);
        this.add(this.rig, g, this.bodyMaterial, this.inkThin, false).position.set(0, 0.7, -1.02);
      }
    }

    // Little tucked feet
    for (const side of [1, -1]) {
      const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.28, 3, 6), this.plainMaterial);
      foot.rotation.x = Math.PI / 2;
      foot.position.set(side * 0.2, -0.38, 0.55);
      this.rig.add(foot);
    }
  }

  /** One wing: broad inner panel on the shoulder, tapered outer panel with fingered primaries. */
  private buildWing(p: BirdProfile, side: 1 | -1): void {
    const wingC = new THREE.Color(p.wingColor);
    const tipC = new THREE.Color(p.tipColor);
    const bellyC = new THREE.Color(p.bellyColor);
    const tmp = new THREE.Color();
    const s = side;
    const pointed = p.tail === 'fork'; // swifts get long sickle wings

    const root = side === 1 ? this.leftWingRoot : this.rightWingRoot;
    const outer = side === 1 ? this.leftOuterWing : this.rightOuterWing;
    root.position.set(s * 0.42, 0.14, -0.28);

    // Inner wing (shoulder -> elbow), with covert-feather band on the leading edge
    const inner = panel([[0, -0.5], [s * 0.7, -0.53], [s * 1.36, -0.46], [s * 1.36, 0.6], [s * 0.7, 0.78], [0, 0.82]], 0.09);
    paint(inner, (_x, y, z) => (y < -0.02 ? tmp.copy(bellyC).lerp(wingC, 0.55) : z < -0.15 ? tmp.copy(wingC).offsetHSL(0, 0, 0.08) : wingC));
    this.add(root, inner, this.bodyMaterial, this.inkThin);

    outer.position.set(s * 1.33, 0, 0);
    root.add(outer);

    // Outer wing (hand) panel
    const len = BirdMesh.handLength(p);
    const hand = panel([[0, -0.46], [s * len * 0.5, -0.43], [s * len, -0.2], [s * len * 0.95, 0.16], [s * len * 0.55, 0.5], [0, 0.6]], 0.07);
    paint(hand, (x, y) => (y < -0.02 ? tmp.copy(bellyC).lerp(wingC, 0.55) : tmp.copy(wingC).lerp(tipC, THREE.MathUtils.smoothstep(Math.abs(x), len * 0.45, len))));
    this.add(outer, hand, this.bodyMaterial, this.inkThin);

    // Primary "finger" feathers fanning off the hand
    const fingers = pointed ? 3 : 5;
    for (let i = 0; i < fingers; i++) {
      const t = i / (fingers - 1);
      const fl = (pointed ? 0.95 : 0.85) + (1 - t) * 0.25;
      const f = panel([[0, -0.12], [s * fl * 0.7, -0.13], [s * fl, 0], [s * fl * 0.7, 0.13], [0, 0.12]], 0.04);
      paint(f, (_x, y) => (y < -0.01 ? tmp.copy(tipC).lerp(bellyC, 0.3) : tipC));
      f.rotateY(s * (0.1 - t * 0.7));
      const mesh = this.add(outer, f, this.bodyMaterial, this.inkThin, false);
      mesh.position.set(s * (len * (0.9 - t * 0.4)), 0, -0.12 + t * 0.5);
    }

    this.rig.add(root);
  }

  private static handLength(p: BirdProfile): number {
    return p.tail === 'fork' ? 1.8 : 1.35;
  }

  private buildTail(p: BirdProfile): void {
    const wingC = new THREE.Color(p.wingColor);
    const tipC = new THREE.Color(p.tipColor);
    const tmp = new THREE.Color();
    this.tailFeathers.position.set(0, 0.12, 1.25);

    const feather = (w: number, l: number, angle: number, color: (yy: number) => THREE.Color, curl = 0): void => {
      const g = panel([[0, 0], [w * 0.5, l * 0.25], [w * 0.55, l * 0.85], [0, l], [-w * 0.55, l * 0.85], [-w * 0.5, l * 0.25]], 0.05);
      paint(g, (_x, _y, z) => color(z / l));
      g.rotateX(curl);
      g.rotateY(angle);
      this.add(this.tailFeathers, g, this.bodyMaterial, this.inkThin, false);
    };

    if (p.tail === 'fork') {
      feather(0.32, 1.5, 0.28, (yy) => tmp.copy(wingC).lerp(tipC, yy));
      feather(0.32, 1.5, -0.28, (yy) => tmp.copy(wingC).lerp(tipC, yy));
      feather(0.4, 0.7, 0, () => wingC);
    } else if (p.tail === 'fan') {
      for (let i = 0; i < 5; i++) {
        const a = (i - 2) * 0.2;
        feather(0.42, 1.05 - Math.abs(i - 2) * 0.08, a, (yy) => tmp.copy(wingC).lerp(tipC, THREE.MathUtils.smoothstep(yy, 0.55, 1)));
      }
    } else {
      // Phoenix: long flowing plumes with golden tips
      for (let i = 0; i < 3; i++) {
        const a = (i - 1) * 0.22;
        feather(0.34, 2.4 - Math.abs(i - 1) * 0.4, a, (yy) => tmp.copy(wingC).lerp(tipC, THREE.MathUtils.smoothstep(yy, 0.5, 0.95)), 0.12);
      }
      for (let i = 0; i < 2; i++) feather(0.36, 0.9, (i - 0.5) * 0.7, () => wingC);
    }
    this.rig.add(this.tailFeathers);
  }

  private buildContrails(): { left: THREE.Line; right: THREE.Line } {
    const make = () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.trailMaxPoints * 3), 3));
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false })
      );
      line.frustumCulled = false;
      return line;
    };
    return { left: make(), right: make() };
  }

  /** Asymmetric wingbeat in [-1, 1]: +1 wings up, -1 wings down. Downstroke takes 40% of the cycle. */
  private static wingbeat(phase: number): number {
    const u = (((phase / (Math.PI * 2)) % 1) + 1) % 1;
    return u < 0.4 ? Math.cos((Math.PI * u) / 0.4) : -Math.cos((Math.PI * (u - 0.4)) / 0.6);
  }

  public triggerFlapBurst(): void {
    this.flapIntensity = 1.3;
  }

  public triggerClapBurst(): void {
    this.flapIntensity = 1.6;
  }

  /**
   * Update kinematics: flap strokes, arm-tracking kinematic angles, and contrails
   */
  public update(
    delta: number,
    forwardSpeed: number,
    pitch: number,
    roll: number,
    isFlapping: boolean,
    cameraMotion?: {
      leftAngleRad: number;
      rightAngleRad: number;
      flapAngleRad: number;
      isCameraMode: boolean;
    }
  ): void {
    const dt = Math.min(delta, 0.1);
    const damp = THREE.MathUtils.damp;
    this.flapIntensity = damp(this.flapIntensity, 1, 3, dt);

    // Dive folds the wings back like a falcon stoop; climbing/braking spreads them up
    const diveTarget = THREE.MathUtils.clamp((-pitch - 0.05) * 2.2, 0, 1);
    this.diveAmt = damp(this.diveAmt, diveTarget, 7, dt);
    const dive = this.diveAmt;
    const flare = THREE.MathUtils.clamp((pitch - 0.15) * 1.2, 0, 0.4);

    let shoulderL: number;
    let elbowL: number;
    let twist = 0;

    if (cameraMotion && cameraMotion.isCameraMode) {
      // Direct arm tracking (mirrored webcam): +X wing follows the player's right arm, -X the left.
      this.leftWingRoot.rotation.z = damp(this.leftWingRoot.rotation.z, -cameraMotion.rightAngleRad, 14, dt);
      this.rightWingRoot.rotation.z = damp(this.rightWingRoot.rotation.z, cameraMotion.leftAngleRad, 14, dt);
      this.leftOuterWing.rotation.z = this.leftWingRoot.rotation.z * 0.45;
      this.rightOuterWing.rotation.z = this.rightWingRoot.rotation.z * 0.45;
      this.flapPhase += dt * 3.5;
    } else {
      if (isFlapping) {
        // Asymmetric wingbeat: quick powerful downstroke (40% of the cycle), slower recovering upstroke
        this.flapPhase += dt * 10.5;
        const amp = 0.8 * this.flapIntensity;
        const stroke = BirdMesh.wingbeat(this.flapPhase);
        const lagged = BirdMesh.wingbeat(this.flapPhase - 0.9);
        shoulderL = stroke * amp + 0.1;
        // Hand trails the arm: bends down on the downstroke, lifts and folds in on the upstroke
        elbowL = lagged * amp * 0.75 - 0.15;
        // Leading edge dips on the downstroke so the wing bites the air
        twist = (BirdMesh.wingbeat(this.flapPhase + 0.35) - stroke) * 0.5;
        this.bob = Math.cos(this.flapPhase) * 0.1;
      } else {
        // Soaring: wings held in a gentle dihedral with a slow breathing sway
        this.glidePhase += dt * 1.6;
        shoulderL = 0.1 + Math.sin(this.glidePhase) * 0.035 + flare;
        elbowL = -0.06 + Math.sin(this.glidePhase - 0.6) * 0.03;
        this.bob = damp(this.bob, 0, 4, dt);
      }
      // A stooping bird tucks its wings: less flapping, arms lowered slightly, hands folded down
      shoulderL = shoulderL * (1 - dive * 0.75) - dive * 0.2;
      elbowL = elbowL * (1 - dive * 0.6) - dive * 0.35;
      // Positive = wingtips up. The +X wing lifts with +rotation.z, the -X wing with -rotation.z.
      const rate = isFlapping ? 30 : 6;
      this.leftWingRoot.rotation.z = damp(this.leftWingRoot.rotation.z, shoulderL, rate, dt);
      this.rightWingRoot.rotation.z = damp(this.rightWingRoot.rotation.z, -shoulderL, rate, dt);
      this.leftOuterWing.rotation.z = damp(this.leftOuterWing.rotation.z, elbowL, rate, dt);
      this.rightOuterWing.rotation.z = damp(this.rightOuterWing.rotation.z, -elbowL, rate, dt);
    }

    // Wing twist (flap) and swept-back pose (dive): the +X wing sweeps back with negative rotation.y
    const sweepRoot = dive * 1.1;
    const sweepHand = dive * 0.75;
    this.leftWingRoot.rotation.x = damp(this.leftWingRoot.rotation.x, twist, 20, dt);
    this.rightWingRoot.rotation.x = damp(this.rightWingRoot.rotation.x, twist, 20, dt);
    this.leftWingRoot.rotation.y = damp(this.leftWingRoot.rotation.y, -sweepRoot, 9, dt);
    this.rightWingRoot.rotation.y = damp(this.rightWingRoot.rotation.y, sweepRoot, 9, dt);
    this.leftOuterWing.rotation.y = damp(this.leftOuterWing.rotation.y, -sweepHand, 9, dt);
    this.rightOuterWing.rotation.y = damp(this.rightOuterWing.rotation.y, sweepHand, 9, dt);

    this.rig.position.y = this.bob;

    // Tail steers with attitude and spreads when slow
    this.tailFeathers.rotation.x = damp(this.tailFeathers.rotation.x, -pitch * 0.5 + Math.sin(this.flapPhase * 0.5) * 0.04, 6, dt);
    this.tailFeathers.rotation.z = damp(this.tailFeathers.rotation.z, roll * 0.4, 6, dt);
    this.tailFeathers.rotation.y = damp(this.tailFeathers.rotation.y, -roll * 0.25, 6, dt);

    this.updateContrails(forwardSpeed);
  }

  private updateContrails(speed: number): void {
    const shouldShow = speed > 24;
    const matL = this.trailLineLeft.material as THREE.LineBasicMaterial;
    const matR = this.trailLineRight.material as THREE.LineBasicMaterial;
    matL.opacity = matR.opacity = shouldShow ? 0.6 : 0.0;

    if (!shouldShow) {
      this.leftTrailPoints.length = 0;
      this.rightTrailPoints.length = 0;
      return;
    }

    const tip = BirdMesh.handLength(this.currentProfile) + 0.7;
    const leftTip = this.leftOuterWing.localToWorld(new THREE.Vector3(tip, 0, 0.1));
    const rightTip = this.rightOuterWing.localToWorld(new THREE.Vector3(-tip, 0, 0.1));

    this.leftTrailPoints.unshift(leftTip);
    this.rightTrailPoints.unshift(rightTip);
    if (this.leftTrailPoints.length > this.trailMaxPoints) {
      this.leftTrailPoints.pop();
      this.rightTrailPoints.pop();
    }

    const arrL = (this.trailLineLeft.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const arrR = (this.trailLineRight.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < this.leftTrailPoints.length; i++) {
      this.leftTrailPoints[i].toArray(arrL, i * 3);
      this.rightTrailPoints[i].toArray(arrR, i * 3);
    }
    this.trailLineLeft.geometry.attributes.position.needsUpdate = true;
    this.trailLineRight.geometry.attributes.position.needsUpdate = true;
    this.trailLineLeft.geometry.setDrawRange(0, this.leftTrailPoints.length);
    this.trailLineRight.geometry.setDrawRange(0, this.rightTrailPoints.length);
  }

  public getTrails(): { left: THREE.Line; right: THREE.Line } {
    return { left: this.trailLineLeft, right: this.trailLineRight };
  }
}
