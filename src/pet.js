import * as THREE from '../node_modules/three/build/three.module.js';
import { loadKuromiRig } from './model-loader.js';
import { evaluateRigPose } from './rig-pose.js';

const WIDTH = 192, HEIGHT = 208;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const behavior = (duration, label) => Object.freeze({ duration, label });
export const ANIMATIONS = Object.freeze({
  idle: behavior(Infinity, 'Feeling mischievous'), wave: behavior(2000, 'A little hello'),
  jump: behavior(1450, 'Up to something'), happy: behavior(2400, 'Secretly delighted'),
  dance: behavior(6000, 'My victory dance'), thinking: behavior(6000, 'Lost in my diary'),
  review: behavior(4000, 'Checking the details'), sulk: behavior(3500, 'Just a little sulky'),
  waiting: behavior(4000, 'I am listening'), sleep: behavior(14000, 'A tiny daydream'),
  'walk-right': behavior(2400, 'Making an entrance'), 'walk-left': behavior(2400, 'On a little adventure'),
  shy: behavior(3000, 'Do not make me blush'), 'head-tilt': behavior(3400, 'You have my attention'),
  'look-around': behavior(6500, 'Keeping an eye on things'), stretch: behavior(3200, 'A little stretch'),
  bounce: behavior(3200, 'A spring in my step'), giggle: behavior(3000, 'Trying not to giggle'),
  pout: behavior(3800, 'Hmph. I have opinions'), talk: behavior(6500, 'Let me tell you something'),
  listen: behavior(6500, 'Tell me everything'), startled: behavior(2200, 'You surprised me'),
  excited: behavior(4200, 'I cannot hide it'), doze: behavior(18000, 'Dreaming up a little mischief'),
  'ear-twitch': behavior(2400, 'Did I hear something?'),
  nod: behavior(2400, 'Fine. You have a point'), 'head-shake': behavior(2600, 'Oh, absolutely not'),
  smug: behavior(3600, 'Naturally, I knew that'), beckon: behavior(3200, 'Come on. Chop chop'),
  tiptoe: behavior(4200, 'Plotting a tiny escape'), curtsy: behavior(3200, 'You may applaud now'),
  yawn: behavior(4800, 'Mischief is exhausting'), 'fist-pump': behavior(2800, 'I knew you could do it'),
});

export function applyRigPose(rig, pose) {
  rig.root.position.set(pose.rootX, pose.rootY, pose.rootZ);
  rig.root.rotation.set(0, pose.bodyYaw, pose.bodyRoll);
  rig.head.rotation.set(pose.headPitch, pose.headYaw, pose.headRoll, 'YXZ');
  rig.arms.left.rotation.set(pose.leftArmX, 0, pose.leftArmZ);
  rig.arms.right.rotation.set(pose.rightArmX, 0, pose.rightArmZ);
  rig.legs.left.rotation.x = pose.leftLegX;
  rig.legs.right.rotation.x = pose.rightLegX;
  rig.ears.left.rotation.z = pose.leftEar;
  rig.ears.right.rotation.z = pose.rightEar;
  rig.book.visible = pose.book > 0.5;
  // Only facial features change shape; the anatomical meshes remain identical.
  rig.setExpression?.(pose.blink, pose.mouth);
}

export class PetAnimator {
  constructor(canvas, { onStateChange } = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('PetAnimator needs a canvas element.');
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    if (!this.context) throw new Error('Canvas rendering is unavailable.');
    this.onStateChange = onStateChange;
    this.currentState = this.state = 'idle';
    this.scale = 1;
    this.talking = this.dragging = this.destroyed = this.reducedMotion = false;
    this.frameIntervals = [];
    this.startedAt = this.previousTime = performance.now();
    this.endsAt = Infinity;
    this.pose = evaluateRigPose('idle', 0, { reducedMotion: true });
    this.ready = this.initialize();
    this.handleResize = () => this.resize();
    window.addEventListener('resize', this.handleResize);
    this.handleVisibilityChange = () => {
      cancelAnimationFrame(this.frameRequest);
      if (!document.hidden && this.loaded && !this.destroyed) {
        this.previousTime = performance.now(); this.tick(this.previousTime);
      }
    };
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  async initialize() {
    try {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.18;
      this.scene = new THREE.Scene();
      // Frame the source model's wide ears without changing its proportions.
      const viewHeight = 4.875, viewWidth = viewHeight * WIDTH / HEIGHT;
      const cameraY = (195 / HEIGHT - 0.5) * viewHeight;
      this.camera = new THREE.OrthographicCamera(-viewWidth / 2, viewWidth / 2, viewHeight / 2, -viewHeight / 2, 0.1, 30);
      this.camera.position.set(0, cameraY, 9);
      this.camera.lookAt(0, cameraY, 0);
      this.scene.add(new THREE.HemisphereLight(0xfff6fd, 0x6c567e, 2.5));
      const key = new THREE.DirectionalLight(0xfff5ef, 3.2);
      key.position.set(-3, 6, 5); this.scene.add(key);
      const rim = new THREE.DirectionalLight(0xd4c4ff, 2.3);
      rim.position.set(3, 4, -3); this.scene.add(rim);
      this.rig = await loadKuromiRig();
      this.scene.add(this.rig.root);
      this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost = (event) => {
        event.preventDefault(); this.contextLost = true; this.loadFallback().catch(() => {});
      });
      this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored = () => { this.contextLost = false; });
    } catch (error) {
      this.loadWarning = error.message;
      this.renderer?.dispose(); this.renderer = null;
      await this.loadFallback();
    }
    if (this.destroyed) { this.rig?.dispose(); this.renderer?.dispose(); return this; }
    this.loaded = true;
    this.resize();
    this.tick(performance.now());
    return this;
  }

  loadFallback() {
    if (this.fallbackReady) return this.fallbackReady;
    this.fallback = new Image();
    this.fallbackReady = new Promise((resolve, reject) => {
      this.fallback.onload = resolve;
      this.fallback.onerror = () => reject(new Error('Kuromi’s artwork could not be loaded.'));
    });
    this.fallback.src = new URL('../assets/kuromi-original.png', import.meta.url).href;
    return this.fallbackReady;
  }

  resize() {
    if (this.destroyed) return;
    this.pixelRatio = clamp(window.devicePixelRatio || 1, 1, 2);
    this.canvas.width = Math.round(WIDTH * this.scale * this.pixelRatio);
    this.canvas.height = Math.round(HEIGHT * this.scale * this.pixelRatio);
    this.canvas.style.width = `${WIDTH * this.scale}px`;
    this.canvas.style.height = `${HEIGHT * this.scale}px`;
    this.renderer?.setPixelRatio(this.pixelRatio);
    this.renderer?.setSize(WIDTH * this.scale, HEIGHT * this.scale, false);
    this.context.imageSmoothingEnabled = true;
    this.context.imageSmoothingQuality = 'high';
  }

  play(name, { duration, loop = false } = {}) {
    if (this.destroyed) return;
    if (!Object.hasOwn(ANIMATIONS, name)) throw new RangeError(`Unknown pet animation: ${name}`);
    if (duration !== undefined && (!Number.isFinite(duration) || duration < 0)) throw new RangeError('Animation duration must be a positive number of milliseconds.');
    const changed = this.currentState !== name;
    this.currentState = this.state = name;
    this.startedAt = performance.now();
    this.endsAt = loop || name === 'idle' ? Infinity : this.startedAt + (duration ?? ANIMATIONS[name].duration);
    if (changed) this.onStateChange?.(name, ANIMATIONS[name].label);
  }

  setReducedMotion(value) { this.reducedMotion = Boolean(value); this.cursor = null; }

  setScale(value) {
    if (!Number.isFinite(value)) throw new TypeError('Pet size must be a number.');
    this.scale = clamp(value, 0.65, 1.5); this.resize();
  }

  hitTest(clientX, clientY, refresh = false) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left) / rect.width * this.canvas.width);
    const y = Math.floor((clientY - rect.top) / rect.height * this.canvas.height);
    if (!this.loaded || x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return false;
    const now = performance.now();
    if (refresh || !this.hitPixels || now - this.hitPixelsAt > 50 || this.hitPixels.length !== this.canvas.width * this.canvas.height * 4) {
      this.hitPixels = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
      this.hitPixelsAt = now;
    }
    // Exclude transparent padding, the soft ground shadow and faint edge pixels.
    return this.hitPixels[(y * this.canvas.width + x) * 4 + 3] >= 96;
  }

  lookAt(clientX, clientY) {
    if (this.reducedMotion || this.dragging || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    const rect = this.canvas.getBoundingClientRect();
    this.cursor = {
      x: clamp((clientX - rect.left - rect.width / 2) / (rect.width * 0.8), -1, 1),
      y: clamp((clientY - rect.top - rect.height * 0.45) / (rect.height * 0.8), -1, 1),
      until: performance.now() + 2200,
    };
  }

  setTalking(value) {
    this.talking = Boolean(value);
    if (this.talking && ['idle', 'listen', 'waiting'].includes(this.currentState)) this.play('talk', { loop: true });
    else if (!this.talking && this.currentState === 'talk') this.play('idle');
  }

  setDragging(value, direction = 'right') {
    const dragging = Boolean(value);
    if (dragging) {
      const animation = direction === 'left' || direction < 0 ? 'walk-left' : 'walk-right';
      if (!this.dragging || this.currentState !== animation) this.play(animation, { loop: true });
    } else if (this.dragging) this.play('wave', { duration: 1000 });
    this.dragging = dragging;
  }

  renderPose(pose) {
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.renderer && !this.contextLost) {
      const resolution = this.scale * this.pixelRatio;
      ctx.save();
      ctx.scale(resolution, resolution);
      ctx.translate(WIDTH / 2 + pose.rootX * 44, 195);
      ctx.scale(1, 0.18);
      const shadow = ctx.createRadialGradient(0, 0, 4, 0, 0, 34);
      shadow.addColorStop(0, `rgba(49,32,60,${0.14 * Math.max(0.25, 1 - pose.rootY * 1.7)})`);
      shadow.addColorStop(1, 'rgba(49,32,60,0)');
      ctx.fillStyle = shadow;
      ctx.fillRect(-34, -34, 68, 68);
      ctx.restore();
      applyRigPose(this.rig, pose);
      this.renderer.render(this.scene, this.camera);
      ctx.drawImage(this.renderer.domElement, 0, 0, this.canvas.width, this.canvas.height);
    } else if (this.fallback?.complete && this.fallback.naturalWidth) {
      // One standing drawing only: unsupported GPUs never swap inconsistent bodies.
      const resolution = this.scale * this.pixelRatio;
      ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
      ctx.translate(WIDTH / 2 + pose.rootX * 35, 194 - pose.rootY * 35);
      ctx.rotate(-pose.bodyRoll);
      ctx.drawImage(this.fallback, 0, 0, WIDTH, HEIGHT, -WIDTH / 2, -194, WIDTH, HEIGHT);
    }
  }

  tick = (now) => {
    this.frameRequest = null;
    if (this.destroyed || document.hidden || !this.loaded) return;
    if (now >= this.endsAt && !this.dragging) this.play('idle');
    const delta = clamp((now - this.previousTime) / 1000, 0, 0.1);
    if (delta > 0 && delta < 0.1) {
      this.frameIntervals.push(delta * 1000);
      if (this.frameIntervals.length > 120) this.frameIntervals.shift();
    }
    this.previousTime = now;
    const cursor = this.cursor?.until > now ? this.cursor : null;
    const target = evaluateRigPose(this.currentState, (now - this.startedAt) / 1000, {
      time: now / 1000, lookX: cursor?.x || 0, lookY: cursor?.y || 0,
      talking: this.talking, reducedMotion: this.reducedMotion,
    });
    const ease = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 12);
    for (const key of Object.keys(target)) this.pose[key] += (target[key] - this.pose[key]) * ease;
    this.renderPose(this.pose);
    this.frameRequest = requestAnimationFrame(this.tick);
  };

  getStats() {
    const average = this.frameIntervals.length ? this.frameIntervals.reduce((a, b) => a + b, 0) / this.frameIntervals.length : 0;
    return { renderer: this.renderer && !this.contextLost ? 'rigged 3D WebGL' : 'fixed-proportion illustration fallback',
      fps: average ? Math.round(1000 / average) : 0, frameTimeMs: Math.round(average * 100) / 100,
      animations: Object.keys(ANIMATIONS).length, continuousHeadTracking: Boolean(this.renderer && !this.contextLost),
      model: this.rig?.source || 'illustration', warning: this.loadWarning || null,
      triangles: this.renderer?.info.render.triangles || 0 };
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.frameRequest);
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.renderer) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
      this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);
      this.rig?.dispose();
      this.renderer.dispose();
    }
  }
}
