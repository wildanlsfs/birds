# 🦅 AeroWing 3D - Motion-Controlled Bird Flight Game

An immersive, browser-based 3D bird flight simulation where you control a stylized soaring raptor using real-time webcam motion tracking powered by **MediaPipe Pose** and **Three.js**.

Fly through an infinite floating sky archipelago, collect waypoint rings, ride spiraling thermal updrafts, fold your wings to dive, and bank gracefully through natural rock arches.

---

## ✨ Features

- **💪 Real-Time Arm Pose Tracking (MediaPipe Tasks-Vision)**:
  - **Flap to Rise**: Flap your arms downward like a bird to generate vertical lift proportional to swing velocity.
  - **Airplane Wing Banking**: Tilt your arms like airplane wings to bank and carve smooth, progressive turns with physical inertia.
  - **Falcon Dive**: Lower your arms to fold your wings back into a sleek aerodynamic sweep and dive toward lower rings.
  - **Airbrake / Flare**: Raise both arms up to flare your wings, slow down forward airspeed, and float gently into rings.
- **🏝️ Procedural Endless Sky Archipelago 2.0**:
  - Infinitely generated 300m biomes: *Sanctuary of the Sky*, *Titan Canyon*, *Luminescent Crystal Spire*, and *Stratosphere Cloud Haven*.
  - Smooth chunk streaming with automatic behind-the-bird garbage recycling for a rock-solid 60 FPS.
  - 3D terrain collision detection with soft aerodynamic ground effect cushion and bouncing.
- **⭕ Endless Waypoint Course with Slipstream Magnetism**:
  - Procedural rings with 8.5m friendly radius and subtle magnetic slipstream assist.
  - Dynamic turbo boost rings and combo multipliers up to 10x.
- **🎵 Procedural Dynamic Web Audio**:
  - Real-time synthesized airspeed wind rushing, wing flap swooshes, sonic boom claps, ring chimes, and altitude thermal humming.
- **⚡ Ultra-Lightweight & Optimized**:
  - Code-split dynamic imports: initial bundle size under 60 kB.
  - Self-hosted MediaPipe WASM and lite float16 model with persistent browser `CacheStorage` for 0ms subsequent loads.
  - Camera resolution capped at 480p and inference throttled to 20 FPS for silky smooth 60 FPS Three.js rendering on laptops.
- **⌨️ Keyboard & Mouse Fallback**:
  - Full support for keyboard controls (<kbd>Space</kbd> to flap, <kbd>A</kbd>/<kbd>D</kbd> or <kbd>←</kbd>/<kbd>→</kbd> to bank, <kbd>W</kbd>/<kbd>S</kbd> to pitch, <kbd>B</kbd> or <kbd>Shift</kbd> to airbrake, <kbd>R</kbd> to restart).

---

## 🕹️ Controls Guide

| Action | Webcam Motion Gesture | Keyboard Control |
|---|---|---|
| **Flap Wings (Lift Up)** | Ayunkan kedua tangan ke bawah dengan cepat | <kbd>Space</kbd> |
| **Bank / Roll Turn** | Miringkan kedua lengan seperti sayap pesawat | <kbd>A</kbd> / <kbd>D</kbd> atau <kbd>←</kbd> / <kbd>→</kbd> |
| **Dive / Menukik** | Turunkan kedua tangan di samping badan | <kbd>W</kbd> atau <kbd>↑</kbd> |
| **Climb / Mendaki** | Angkat kedua tangan sedikit ke atas | <kbd>S</kbd> atau <kbd>↓</kbd> |
| **Airbrake / Mengerem** | Angkat kedua tangan tinggi ke atas | <kbd>B</kbd> atau <kbd>Shift</kbd> |
| **Quick Restart** | Klik tombol Restart di layar | <kbd>R</kbd> |

---

## 🛠️ Tech Stack

- **Graphics**: [Three.js](https://threejs.org/) (WebGL, PCF Shadows, ACES Filmic Tone Mapping)
- **Computer Vision**: [MediaPipe Tasks-Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) (Pose Landmarker Lite CPU SIMD)
- **Audio**: Web Audio API (Fully procedural sound synthesis)
- **Build Tool**: [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/)

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ installed on your machine.
- A modern browser (Chrome, Edge, Safari, Firefox) with webcam access enabled.

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/your-username/aerowing-3d.git
   cd aerowing-3d
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start development server:
   ```bash
   npm run dev
   ```
   Open your browser at `http://localhost:5173/`.

4. Build for production:
   ```bash
   npm run build
   ```

---

## 🌐 Deployment

You can deploy this project to any static hosting service in minutes:

- **Vercel**: Run `npx vercel` or connect your GitHub repository.
- **Netlify**: Connect your GitHub repository with build command `npm run build` and publish directory `dist`.
- **GitHub Pages**: Build the project and deploy the `dist/` directory via `gh-pages`.

---

## 📄 License

MIT License. Free for personal and educational use.
