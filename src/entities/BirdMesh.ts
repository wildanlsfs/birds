import * as THREE from 'three';

/**
 * Procedural Stylized 3D Bird Model
 * Features articulated wings (inner + outer wing bones),
 * dynamic tail feathers, beak, eyes, wingtip contrails, and feather burst particles.
 */
export class BirdMesh {
  public group: THREE.Group;

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

  constructor() {
    this.group = new THREE.Group();

    // Palettes: Regal Falcon (Aerodynamic Navy Blue, Celestial Gold & Cream)
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a2e40, // Deep sleek navy
      roughness: 0.35,
      metalness: 0.15,
      flatShading: false
    });

    this.wingMaterial = new THREE.MeshStandardMaterial({
      color: 0x22425f,
      roughness: 0.4,
      metalness: 0.1
    });

    this.accentMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5a623, // Golden amber beak and feather tips
      roughness: 0.25,
      metalness: 0.5,
      emissive: 0x553300,
      emissiveIntensity: 0.2
    });

    this.eyeMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd700
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

    // Primary Feathers on wingtip
    for (let i = 0; i < 4; i++) {
      const featherGeo = new THREE.BoxGeometry(0.2, 0.04, 0.7 + i * 0.1);
      featherGeo.translate(0, 0, 0.35 + i * 0.05);
      const feather = new THREE.Mesh(featherGeo, this.accentMaterial);
      feather.position.set(1.2 + i * 0.2, 0, 0.1);
      feather.rotation.y = -0.15 * (i + 1);
      leftOuter.add(feather);
    }

    leftRoot.add(leftOuter);
    this.group.add(leftRoot);

    // Right Wing Root (Mirrored)
    const rightRoot = new THREE.Group();
    rightRoot.position.set(-0.4, 0.05, -0.3);

    const rightInnerGeo = new THREE.BoxGeometry(1.6, 0.08, 0.75);
    rightInnerGeo.translate(-0.8, 0, 0);
    const rightInnerMesh = new THREE.Mesh(rightInnerGeo, this.wingMaterial);
    rightInnerMesh.castShadow = true;
    rightRoot.add(rightInnerMesh);

    const rightOuter = new THREE.Group();
    rightOuter.position.set(-1.6, 0, 0);

    const rightOuterGeo = new THREE.BoxGeometry(1.8, 0.06, 0.6);
    rightOuterGeo.translate(-0.9, 0, 0.05);
    const rightOuterMesh = new THREE.Mesh(rightOuterGeo, this.wingMaterial);
    rightOuterMesh.castShadow = true;
    rightOuter.add(rightOuterMesh);

    for (let i = 0; i < 4; i++) {
      const featherGeo = new THREE.BoxGeometry(0.2, 0.04, 0.7 + i * 0.1);
      featherGeo.translate(0, 0, 0.35 + i * 0.05);
      const feather = new THREE.Mesh(featherGeo, this.accentMaterial);
      feather.position.set(-1.2 - i * 0.2, 0, 0.1);
      feather.rotation.y = 0.15 * (i + 1);
      rightOuter.add(feather);
    }

    rightRoot.add(rightOuter);
    this.group.add(rightRoot);

    return { leftRoot, rightRoot, leftOuter, rightOuter };
  }

  private buildTail(): THREE.Group {
    const tail = new THREE.Group();
    tail.position.set(0, 0.05, 1.25);

    // Fan of 5 tail feathers
    for (let i = -2; i <= 2; i++) {
      const tailFeatherGeo = new THREE.BoxGeometry(0.26, 0.04, 1.2);
      tailFeatherGeo.translate(0, 0, 0.6);
      const fMesh = new THREE.Mesh(tailFeatherGeo, i === 0 ? this.accentMaterial : this.wingMaterial);
      fMesh.rotation.y = i * 0.14;
      tail.add(fMesh);
    }

    this.group.add(tail);
    return tail;
  }

  private buildContrails(): { left: THREE.Line; right: THREE.Line } {
    const geoLeft = new THREE.BufferGeometry();
    const geoRight = new THREE.BufferGeometry();

    const positionsL = new Float32Array(this.trailMaxPoints * 3);
    const positionsR = new Float32Array(this.trailMaxPoints * 3);

    geoLeft.setAttribute('position', new THREE.BufferAttribute(positionsL, 3));
    geoRight.setAttribute('position', new THREE.BufferAttribute(positionsR, 3));

    const mat = new THREE.LineBasicMaterial({
      color: 0x9be2ff,
      transparent: true,
      opacity: 0.6,
      linewidth: 2
    });

    const left = new THREE.Line(geoLeft, mat);
    const right = new THREE.Line(geoRight, mat);

    // Add trails to world scene (will be managed in world coordinates)
    return { left, right };
  }

  /**
   * Flap burst trigger (particle system removed per user preference)
   */
  public triggerFlapBurst(): void {}

  public triggerClapBurst(): void {}

  /**
   * Update wing kinematics (1:1 Arm Tracking with organic flex or procedural glide)
   */
  public update(
    delta: number,
    forwardSpeed: number,
    pitch: number,
    roll: number,
    isFlapping: boolean,
    armKinematics?: {
      leftAngleRad: number;
      rightAngleRad: number;
      flapAngleRad?: number;
      isCameraMode: boolean;
    }
  ): void {
    const dt = Math.min(delta, 0.1);

    if (armKinematics && armKinematics.isCameraMode) {
      // --- 1:1 AERONAUTIC WING & BODY HARMONIZATION ---
      // The bird's fuselage / body already rolls 1:1 with the player's arm tilt (roll = -targetRoll).
      // Wings articulate relative to the banked fuselage for downward flapping and fine aerodynamic balance.
      const targetFlap = armKinematics.flapAngleRad !== undefined
        ? armKinematics.flapAngleRad
        : (armKinematics.rightAngleRad + armKinematics.leftAngleRad) * 0.5;

      // Subtle differential trim so user can feel fine aero control without dislocating wings
      const targetDiff = (armKinematics.rightAngleRad - armKinematics.leftAngleRad) * 0.12;

      this.currentFlapAngle = THREE.MathUtils.damp(this.currentFlapAngle, targetFlap, 18.0, dt);
      this.currentDifferential = THREE.MathUtils.damp(this.currentDifferential, targetDiff, 14.0, dt);

      // Angular velocity of flap for feather aero flex
      const flapAngVel = (this.currentFlapAngle - this.prevFlapAngle) / Math.max(0.001, dt);
      this.prevFlapAngle = this.currentFlapAngle;

      // 1. Inner Wing Root (Flapping down/up relative to banked fuselage):
      // In a dive (pitch < -0.10), tuck wings back along the body rather than pointing down to the ground
      let effectiveFlap = this.currentFlapAngle;
      if (pitch < -0.10) {
        const diveFactor = THREE.MathUtils.clamp((-pitch - 0.10) / 0.30, 0, 1);
        effectiveFlap = THREE.MathUtils.lerp(this.currentFlapAngle, 0.12, diveFactor);
      }

      this.leftWingRoot.rotation.z = -effectiveFlap - this.currentDifferential;
      this.rightWingRoot.rotation.z = effectiveFlap - this.currentDifferential;

      // 2. Organic Trailing Flex (outer feathers flex slightly against airflow during fast strokes)
      const trailingFlex = THREE.MathUtils.clamp(-flapAngVel * 0.06, -0.35, 0.35);
      this.leftOuterWing.rotation.z = -effectiveFlap * 0.45 + trailingFlex;
      this.rightOuterWing.rotation.z = effectiveFlap * 0.45 - trailingFlex;

      // 3. Falcon Dive Wing Sweep (wings fold back aerodynamically when pitching down)
      if (pitch < -0.10) {
        const diveSweep = THREE.MathUtils.clamp((-pitch - 0.10) * 1.2, 0, 0.75);
        this.leftWingRoot.rotation.y = -diveSweep;
        this.rightWingRoot.rotation.y = diveSweep;
      } else {
        this.leftWingRoot.rotation.y = THREE.MathUtils.lerp(this.leftWingRoot.rotation.y, 0, dt * 10);
        this.rightWingRoot.rotation.y = THREE.MathUtils.lerp(this.rightWingRoot.rotation.y, 0, dt * 10);
      }

      // 4. Dihedral subtle breathing
      this.flapPhase += dt * 3.5;
      const breathing = Math.sin(this.flapPhase) * 0.025;
      this.leftWingRoot.rotation.x = breathing;
      this.rightWingRoot.rotation.x = breathing;
    } else {
      // --- PROCEDURAL WING ANIMATION (Keyboard Mode / Fallback) ---
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

    // Tail responds to flight attitude (pitch and roll)
    this.tailFeathers.rotation.x = -pitch * 0.42 + Math.sin(this.flapPhase * 0.5) * 0.04;
    this.tailFeathers.rotation.z = roll * 0.38;

    // Update Contrails
    this.updateContrails(forwardSpeed);
  }

  private updateContrails(speed: number): void {
    // Only emit contrails at high speed or steep turns
    const shouldShow = speed > 24;
    (this.trailLineLeft.material as THREE.LineBasicMaterial).opacity = shouldShow ? 0.7 : 0.0;
    (this.trailLineRight.material as THREE.LineBasicMaterial).opacity = shouldShow ? 0.7 : 0.0;

    if (!shouldShow) return;

    // Calculate global wingtip positions
    const leftTip = new THREE.Vector3(3.4, 0, 0);
    const rightTip = new THREE.Vector3(-3.4, 0, 0);

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
