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
  wingColor: number;
  accentColor: number;
  eyeColor: number;
  emissiveColor: number;
  emissiveIntensity: number;
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
    scale: 0.68,
    bodyColor: 0x07574b,
    wingColor: 0x00b894,
    accentColor: 0x00f0ff,
    eyeColor: 0xffe600,
    emissiveColor: 0x008080,
    emissiveIntensity: 0.28,
    stats: {
      speed: 82,
      agility: 98,
      lift: 82,
      glide: 72
    },
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
    bodyColor: 0x1a2e40,
    wingColor: 0x22425f,
    accentColor: 0xf5a623,
    eyeColor: 0xffd700,
    emissiveColor: 0x553300,
    emissiveIntensity: 0.2,
    stats: {
      speed: 88,
      agility: 85,
      lift: 88,
      glide: 86
    },
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
    scale: 1.45,
    bodyColor: 0x7c1111,
    wingColor: 0xa8201a,
    accentColor: 0xffaa00,
    eyeColor: 0xff3b30,
    emissiveColor: 0xff3300,
    emissiveIntensity: 0.45,
    stats: {
      speed: 98,
      agility: 68,
      lift: 94,
      glide: 98
    },
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

/**
 * Procedural Stylized 3D Bird Model
 * Supports multi-type profiles (Small, Medium, Large), articulated wings,
 * dynamic plumage materials, wingtip contrails, and feather particles.
 */
export class BirdMesh {
  public group: THREE.Group;
  public currentProfile: BirdProfile;

  // Wing articulation nodes
  private leftWingRoot: THREE.Group;
  private rightWingRoot: THREE.Group;
  private leftOuterWing: THREE.Group;
  private rightOuterWing: THREE.Group;
  private tailFeathers: THREE.Group;

  // Visual materials
  private bodyMaterial: THREE.MeshStandardMaterial;
  private wingMaterial: THREE.MeshStandardMaterial;
  private accentMaterial: THREE.MeshStandardMaterial;
  private eyeMaterial: THREE.MeshBasicMaterial;

  // Contrail trails
  private leftTrailPoints: THREE.Vector3[] = [];
  private rightTrailPoints: THREE.Vector3[] = [];
  private trailLineLeft: THREE.Line;
  private trailLineRight: THREE.Line;
  private trailMaxPoints = 40;

  // Animation & Kinematic state
  private flapPhase = 0;
  private flapIntensity = 1.0;
  private currentFlapAngle = 0;
  private prevFlapAngle = 0;
  private currentDifferential = 0;

  constructor(profileType: 'small' | 'medium' | 'large' = 'medium') {
    this.group = new THREE.Group();
    this.currentProfile = BIRD_PROFILES[profileType];

    // Visual materials
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: this.currentProfile.bodyColor,
      roughness: 0.35,
      metalness: 0.15,
      flatShading: false
    });

    this.wingMaterial = new THREE.MeshStandardMaterial({
      color: this.currentProfile.wingColor,
      roughness: 0.4,
      metalness: 0.1
    });

    this.accentMaterial = new THREE.MeshStandardMaterial({
      color: this.currentProfile.accentColor,
      roughness: 0.25,
      metalness: 0.5,
      emissive: this.currentProfile.emissiveColor,
      emissiveIntensity: this.currentProfile.emissiveIntensity
    });

    this.eyeMaterial = new THREE.MeshBasicMaterial({
      color: this.currentProfile.eyeColor
    });

    // Build parts
    this.buildFuselage();
    const wings = this.buildWings();
    this.leftWingRoot = wings.leftRoot;
    this.rightWingRoot = wings.rightRoot;
    this.leftOuterWing = wings.leftOuter;
    this.rightOuterWing = wings.rightOuter;

    this.tailFeathers = this.buildTail();

    // Contrails
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
    this.bodyMaterial.color.setHex(profile.bodyColor);
    this.wingMaterial.color.setHex(profile.wingColor);
    this.accentMaterial.color.setHex(profile.accentColor);
    this.accentMaterial.emissive.setHex(profile.emissiveColor);
    this.accentMaterial.emissiveIntensity = profile.emissiveIntensity;
    this.eyeMaterial.color.setHex(profile.eyeColor);

    this.group.scale.setScalar(profile.scale);

    // Update contrail color
    (this.trailLineLeft.material as THREE.LineBasicMaterial).color.setHex(profile.accentColor);
    (this.trailLineRight.material as THREE.LineBasicMaterial).color.setHex(profile.accentColor);
  }

  private buildFuselage(): void {
    // Aerodynamic streamlined fuselage
    const bodyGeo = new THREE.ConeGeometry(0.55, 2.6, 12);
    bodyGeo.rotateX(Math.PI / 2); // Point forward along -Z
    bodyGeo.scale(1, 0.7, 1);
    const body = new THREE.Mesh(bodyGeo, this.bodyMaterial);
    body.castShadow = true;
    this.group.add(body);

    // Head
    const headGeo = new THREE.SphereGeometry(0.42, 12, 10);
    headGeo.scale(0.85, 0.9, 1.2);
    const head = new THREE.Mesh(headGeo, this.bodyMaterial);
    head.position.set(0, 0.2, -1.3);
    head.castShadow = true;
    this.group.add(head);

    // Beak
    const beakGeo = new THREE.ConeGeometry(0.18, 0.65, 8);
    beakGeo.rotateX(-Math.PI / 2);
    const beak = new THREE.Mesh(beakGeo, this.accentMaterial);
    beak.position.set(0, 0.15, -2.05);
    this.group.add(beak);

    // Eyes (Left & Right)
    const eyeGeo = new THREE.SphereGeometry(0.09, 8, 8);
    const leftEye = new THREE.Mesh(eyeGeo, this.eyeMaterial);
    leftEye.position.set(0.3, 0.32, -1.45);
    const rightEye = new THREE.Mesh(eyeGeo, this.eyeMaterial);
    rightEye.position.set(-0.3, 0.32, -1.45);
    this.group.add(leftEye);
    this.group.add(rightEye);

    // Breast plume accent
    const chestGeo = new THREE.ConeGeometry(0.38, 1.4, 8);
    chestGeo.rotateX(Math.PI / 2);
    const chest = new THREE.Mesh(chestGeo, this.accentMaterial);
    chest.position.set(0, -0.15, -0.4);
    chest.scale.set(0.9, 0.4, 0.9);
    this.group.add(chest);
  }

  private buildWings(): {
    leftRoot: THREE.Group;
    rightRoot: THREE.Group;
    leftOuter: THREE.Group;
    rightOuter: THREE.Group;
  } {
    // Left Wing Root
    const leftRoot = new THREE.Group();
    leftRoot.position.set(0.4, 0.05, -0.3);

    // Inner wing bone/mesh
    const innerGeo = new THREE.BoxGeometry(1.6, 0.08, 0.75);
    innerGeo.translate(0.8, 0, 0); // Pivot at shoulder
    const leftInnerMesh = new THREE.Mesh(innerGeo, this.wingMaterial);
    leftInnerMesh.castShadow = true;
    leftRoot.add(leftInnerMesh);

    // Left Outer Wing Root (Elbow pivot)
    const leftOuter = new THREE.Group();
    leftOuter.position.set(1.6, 0, 0);

    const outerGeo = new THREE.BoxGeometry(1.8, 0.06, 0.6);
    outerGeo.translate(0.9, 0, 0.05);
    const leftOuterMesh = new THREE.Mesh(outerGeo, this.wingMaterial);
    leftOuterMesh.castShadow = true;
    leftOuter.add(leftOuterMesh);

    // Wingtip feather trim
    const tipGeo = new THREE.ConeGeometry(0.28, 1.0, 4);
    tipGeo.rotateZ(-Math.PI / 2);
    tipGeo.translate(1.9, 0, 0.1);
    const leftTipMesh = new THREE.Mesh(tipGeo, this.accentMaterial);
    leftOuter.add(leftTipMesh);

    leftRoot.add(leftOuter);
    this.group.add(leftRoot);

    // Right Wing Root (Mirrored)
    const rightRoot = new THREE.Group();
    rightRoot.position.set(-0.4, 0.05, -0.3);

    const rInnerGeo = new THREE.BoxGeometry(1.6, 0.08, 0.75);
    rInnerGeo.translate(-0.8, 0, 0);
    const rightInnerMesh = new THREE.Mesh(rInnerGeo, this.wingMaterial);
    rightInnerMesh.castShadow = true;
    rightRoot.add(rightInnerMesh);

    const rightOuter = new THREE.Group();
    rightOuter.position.set(-1.6, 0, 0);

    const rOuterGeo = new THREE.BoxGeometry(1.8, 0.06, 0.6);
    rOuterGeo.translate(-0.9, 0, 0.05);
    const rightOuterMesh = new THREE.Mesh(rOuterGeo, this.wingMaterial);
    rightOuterMesh.castShadow = true;
    rightOuter.add(rightOuterMesh);

    const rTipGeo = new THREE.ConeGeometry(0.28, 1.0, 4);
    rTipGeo.rotateZ(Math.PI / 2);
    rTipGeo.translate(-1.9, 0, 0.1);
    const rightTipMesh = new THREE.Mesh(rTipGeo, this.accentMaterial);
    rightOuter.add(rightTipMesh);

    rightRoot.add(rightOuter);
    this.group.add(rightRoot);

    return { leftRoot, rightRoot, leftOuter, rightOuter };
  }

  private buildTail(): THREE.Group {
    const tailGroup = new THREE.Group();
    tailGroup.position.set(0, 0.1, 1.3);

    // Multi-feather fan tail
    const numFeathers = 5;
    for (let i = 0; i < numFeathers; i++) {
      const angle = (i - (numFeathers - 1) / 2) * 0.18;
      const featherGeo = new THREE.BoxGeometry(0.25, 0.04, 1.1);
      featherGeo.translate(0, 0, 0.55);

      const mat = (i === 0 || i === numFeathers - 1) ? this.accentMaterial : this.wingMaterial;
      const feather = new THREE.Mesh(featherGeo, mat);
      feather.rotation.y = angle;
      feather.castShadow = true;
      tailGroup.add(feather);
    }

    this.group.add(tailGroup);
    return tailGroup;
  }

  private buildContrails(): { left: THREE.Line; right: THREE.Line } {
    const maxPts = this.trailMaxPoints;

    const geoL = new THREE.BufferGeometry();
    const posL = new Float32Array(maxPts * 3);
    geoL.setAttribute('position', new THREE.BufferAttribute(posL, 3));

    const geoR = new THREE.BufferGeometry();
    const posR = new Float32Array(maxPts * 3);
    geoR.setAttribute('position', new THREE.BufferAttribute(posR, 3));

    const mat = new THREE.LineBasicMaterial({
      color: this.currentProfile.accentColor,
      transparent: true,
      opacity: 0.65,
      linewidth: 2
    });

    const left = new THREE.Line(geoL, mat);
    const right = new THREE.Line(geoR, mat.clone());
    left.frustumCulled = false;
    right.frustumCulled = false;

    return { left, right };
  }

  public triggerFlapBurst(): void {
    this.flapIntensity = 1.4;
  }

  public triggerClapBurst(): void {
    this.flapIntensity = 2.0;
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

    if (cameraMotion && cameraMotion.isCameraMode) {
      // 1. Direct Arm-Tracking Kinematics
      const targetLeftWingAngle = cameraMotion.leftAngleRad;
      const targetRightWingAngle = cameraMotion.rightAngleRad;

      this.leftWingRoot.rotation.z = THREE.MathUtils.damp(
        this.leftWingRoot.rotation.z,
        targetLeftWingAngle,
        14.0,
        dt
      );
      this.rightWingRoot.rotation.z = THREE.MathUtils.damp(
        this.rightWingRoot.rotation.z,
        targetRightWingAngle,
        14.0,
        dt
      );

      // Outer wing flexibility
      const elbowFactor = 0.45;
      this.leftOuterWing.rotation.z = this.leftWingRoot.rotation.z * elbowFactor;
      this.rightOuterWing.rotation.z = this.rightWingRoot.rotation.z * elbowFactor;

      // 3. Dive Sweep: Sweep wings backward on dive
      if (pitch < -0.10) {
        const diveSweep = THREE.MathUtils.clamp((-pitch - 0.10) * 1.2, 0, 0.75);
        this.leftWingRoot.rotation.y = -diveSweep;
        this.rightWingRoot.rotation.y = diveSweep;
      } else {
        this.leftWingRoot.rotation.y = THREE.MathUtils.lerp(this.leftWingRoot.rotation.y, 0, dt * 10);
        this.rightWingRoot.rotation.y = THREE.MathUtils.lerp(this.rightWingRoot.rotation.y, 0, dt * 10);
      }

      // 4. Subtle breathing
      this.flapPhase += dt * 3.5;
      const breathing = Math.sin(this.flapPhase) * 0.025;
      this.leftWingRoot.rotation.x = breathing;
      this.rightWingRoot.rotation.x = breathing;
    } else {
      // Procedural Wing Animation (Keyboard / Touch Mode)
      const flapFreq = isFlapping ? 18.0 : 4.5 + Math.min(6, forwardSpeed * 0.2);
      this.flapPhase += dt * flapFreq;

      const flapCycle = Math.sin(this.flapPhase);

      const shoulderAngle = flapCycle * (isFlapping ? 0.65 : 0.28);
      this.leftWingRoot.rotation.z = -shoulderAngle;
      this.rightWingRoot.rotation.z = shoulderAngle;

      const elbowFlex = Math.sin(this.flapPhase - 0.5) * (isFlapping ? 0.45 : 0.18);
      this.leftOuterWing.rotation.z = -elbowFlex;
      this.rightOuterWing.rotation.z = elbowFlex;

      this.leftWingRoot.rotation.x = Math.sin(this.flapPhase) * 0.08;
      this.rightWingRoot.rotation.x = Math.sin(this.flapPhase) * 0.08;
      this.leftWingRoot.rotation.y = 0;
      this.rightWingRoot.rotation.y = 0;
    }

    // Tail responds to flight attitude
    this.tailFeathers.rotation.x = -pitch * 0.42 + Math.sin(this.flapPhase * 0.5) * 0.04;
    this.tailFeathers.rotation.z = roll * 0.38;

    // Update Contrails
    this.updateContrails(forwardSpeed);
  }

  private updateContrails(speed: number): void {
    const shouldShow = speed > 24;
    (this.trailLineLeft.material as THREE.LineBasicMaterial).opacity = shouldShow ? 0.7 : 0.0;
    (this.trailLineRight.material as THREE.LineBasicMaterial).opacity = shouldShow ? 0.7 : 0.0;

    if (!shouldShow) return;

    const span = 3.4 * this.currentProfile.scale;
    const leftTip = new THREE.Vector3(span, 0, 0);
    const rightTip = new THREE.Vector3(-span, 0, 0);

    this.group.localToWorld(leftTip);
    this.group.localToWorld(rightTip);

    this.leftTrailPoints.unshift(leftTip);
    this.rightTrailPoints.unshift(rightTip);

    if (this.leftTrailPoints.length > this.trailMaxPoints) {
      this.leftTrailPoints.pop();
      this.rightTrailPoints.pop();
    }

    const posL = this.trailLineLeft.geometry.attributes.position as THREE.BufferAttribute;
    const posR = this.trailLineRight.geometry.attributes.position as THREE.BufferAttribute;
    const arrL = posL.array as Float32Array;
    const arrR = posR.array as Float32Array;

    for (let i = 0; i < this.leftTrailPoints.length; i++) {
      arrL[i * 3] = this.leftTrailPoints[i].x;
      arrL[i * 3 + 1] = this.leftTrailPoints[i].y;
      arrL[i * 3 + 2] = this.leftTrailPoints[i].z;

      arrR[i * 3] = this.rightTrailPoints[i].x;
      arrR[i * 3 + 1] = this.rightTrailPoints[i].y;
      arrR[i * 3 + 2] = this.rightTrailPoints[i].z;
    }

    posL.needsUpdate = true;
    posR.needsUpdate = true;
    this.trailLineLeft.geometry.setDrawRange(0, this.leftTrailPoints.length);
    this.trailLineRight.geometry.setDrawRange(0, this.rightTrailPoints.length);
  }

  public getTrails(): { left: THREE.Line; right: THREE.Line } {
    return { left: this.trailLineLeft, right: this.trailLineRight };
  }
}
