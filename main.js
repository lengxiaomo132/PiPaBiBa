import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';


const AUDIO = {
  enabled: true,
  volume: 0.35,

  eat:    { from: 880,  to: 1320, dur: 0.08, type: 'sine',     vol: 1.0 },
  eatEnd: { from: 1320, to: 1760, dur: 0.12, type: 'sine',     vol: 0.7 },
  jump:   { from: 320,  to: 620,  dur: 0.12, type: 'triangle', vol: 0.8 },
  land:   { from: 180,  to: 90,   dur: 0.14, type: 'sine',     vol: 0.9 },
  tick:   { from: 1200, to: 1200, dur: 0.05, type: 'square',   vol: 0.35 },
  start:  { from: 440,  to: 880,  dur: 0.18, type: 'triangle', vol: 0.8 },
  end:    { from: 660,  to: 220,  dur: 0.35, type: 'triangle', vol: 0.8 },
};

let audioCtx = null;
let audioMaster = null;


function initAudio() {
  if (audioCtx) return true;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return false;
  audioCtx = new Ctx();
  audioMaster = audioCtx.createGain();
  audioMaster.gain.value = AUDIO.volume;
  audioMaster.connect(audioCtx.destination);
  return true;
}


function playSound(name, pitchScale) {
  if (!AUDIO.enabled) return;
  if (!initAudio()) return;

  if (audioCtx.state === 'suspended') audioCtx.resume();

  const spec = AUDIO[name];
  if (!spec) return;

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = spec.type;
  const f0 = spec.from * (pitchScale || 1);
  const f1 = spec.to * (pitchScale || 1);
  osc.frequency.setValueAtTime(f0, now);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), now + spec.dur);


  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(spec.vol, 0.0001), now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.dur);

  osc.connect(gain);
  gain.connect(audioMaster);
  osc.start(now);
  osc.stop(now + spec.dur + 0.02);
}


const CONFIG = {
  levelSize: 30,
  pickupCount: 25,
  roundSeconds: 20,
  moveSpeed: 9,
  jumpSpeed: 7.5,
  gravity: -22,
  playerRadius: 0.5,


  comboWindow: 2.5,
  comboMaxMult: 8,
  comboPerTier: 2,
};


const JUICE = {

  squashStiffness: 90,
  squashDamping: 7,

  jumpStretch: 1.65,
  landSquashMax: 0.42,
  landSquashMin: 0.10,
  landImpactRef: 16,

  accelRate: 14,

  popDistance: 1.1,
  popScale: 1.25,
  popSeconds: 0.22,
  eatPulse: 0.92,

  jumpCrouchTime: 0.09,
  jumpCrouchSquash: 0.78,

  squashTintAmount: 0.35,
  squashTintMin: 0.35,

  coreSquashFollow: 0.65,
};


const LIGHT = {

  sunColor: 0xfff4e6,
  sunIntensity: 2.6,
  sunPosition: [16, 26, 10],


  fillColor: 0x5b8dd6,
  fillIntensity: 0.8,
  fillPosition: [-18, 6, 8],


  rimColor: 0xffffff,
  rimIntensity: 2.2,
  rimPosition: [-18, 2, -18],


  hemiSky: 0x8fc7ff,
  hemiGround: 0x1a2430,
  hemiIntensity: 1.0,

  envIntensity: 0.8,


  exposure: 1.15,


  shadowMapSize: 4096,
  shadowRadius: 5,
  shadowBias: -0.0002,
  shadowNormalBias: 0.02,
  shadowExtent: CONFIG.levelSize * 0.8,


  glowCount: 4,
  glowIntensity: 2.5,
  glowDistance: 6.0,
  glowColor: 0xffb347,
};


const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: true });
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = LIGHT.exposure;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.fog = new THREE.Fog(0x0b0f14, 40, 90);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(14, 18, 20);


const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.15;
controls.minDistance = 8;
controls.maxDistance = 45;


const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = LIGHT.envIntensity;
pmrem.dispose();


const sun = new THREE.DirectionalLight(LIGHT.sunColor, LIGHT.sunIntensity);
sun.position.set(...LIGHT.sunPosition);
sun.castShadow = true;
sun.shadow.mapSize.set(LIGHT.shadowMapSize, LIGHT.shadowMapSize);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 100;
sun.shadow.camera.left = -LIGHT.shadowExtent;
sun.shadow.camera.right = LIGHT.shadowExtent;
sun.shadow.camera.top = LIGHT.shadowExtent;
sun.shadow.camera.bottom = -LIGHT.shadowExtent;
sun.shadow.bias = LIGHT.shadowBias;
sun.shadow.normalBias = LIGHT.shadowNormalBias;
sun.shadow.radius = LIGHT.shadowRadius;
scene.add(sun);


const fillLight = new THREE.DirectionalLight(LIGHT.fillColor, LIGHT.fillIntensity);
fillLight.position.set(...LIGHT.fillPosition);
scene.add(fillLight);


const rimLight = new THREE.DirectionalLight(LIGHT.rimColor, LIGHT.rimIntensity);
rimLight.position.set(...LIGHT.rimPosition);
scene.add(rimLight);


const hemi = new THREE.HemisphereLight(LIGHT.hemiSky, LIGHT.hemiGround, LIGHT.hemiIntensity);
scene.add(hemi);


function makeGroundTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');


  ctx.fillStyle = '#223141';
  ctx.fillRect(0, 0, size, size);


  const half = size / 2;
  ctx.fillStyle = '#26374a';
  ctx.fillRect(0, 0, half, half);
  ctx.fillRect(half, half, half, half);


  ctx.strokeStyle = 'rgba(90, 130, 170, 0.22)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = (i / 4) * size;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }


  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = Math.random() * 0.05;
    ctx.fillStyle = `rgba(150, 200, 255, ${a})`;
    ctx.fillRect(x, y, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(CONFIG.levelSize / 5, CONFIG.levelSize / 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(CONFIG.levelSize, CONFIG.levelSize),
  new THREE.MeshStandardMaterial({
    map: makeGroundTexture(),
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.0,
  })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(CONFIG.levelSize, CONFIG.levelSize, 0x3d556d, 0x2a3a4b);
grid.position.y = 0.01;
scene.add(grid);


function makeEdgeGlow() {
  const half = CONFIG.levelSize * 0.5;
  const thickness = 0.35;
  const geo = [];
  const mk = (w, d, x, z) => {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0, z);
    geo.push(g);
  };

  mk(CONFIG.levelSize, thickness, 0, -half + thickness * 0.5);
  mk(CONFIG.levelSize, thickness, 0, half - thickness * 0.5);
  mk(thickness, CONFIG.levelSize, -half + thickness * 0.5, 0);
  mk(thickness, CONFIG.levelSize, half - thickness * 0.5, 0);

  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x4fd4ff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  for (const g of geo) {
    const m = new THREE.Mesh(g, mat);
    m.position.y = 0.02;
    m.renderOrder = -1;
    group.add(m);
  }
  return group;
}
const edgeGlow = makeEdgeGlow();
scene.add(edgeGlow);


for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
  const pillar = new THREE.Mesh(
    new THREE.BoxGeometry(1, 3, 1),
    new THREE.MeshStandardMaterial({ color: 0x4b6b8a, roughness: 0.7 })
  );
  pillar.position.set(x * CONFIG.levelSize * 0.47, 1.5, z * CONFIG.levelSize * 0.47);
  pillar.castShadow = true;
  pillar.receiveShadow = true;
  scene.add(pillar);
}


const SLIME = {
  radius: 0.42,
  widthSegments: 28,
  heightSegments: 20,
  baseFlatten: 0.82,
  bulgeBottom: 0.30,
  bulgeTop: 0.22,
  lagRate: 7,


  color: 0x5ee7a0,
  opacity: 0.55,
  emissive: 0x0f3d28,
  emissiveIntensity: 0.9,
  roughness: 0.1,
  clearcoat: 1.0,
  clearcoatRoughness: 0.08,


  heatCount: 22,
  heatHueGreen: 140,
  heatHueRed: 0,
  heatSatStart: 65,
  heatSatEnd: 85,
  heatLightStart: 65,
  heatLightEnd: 55,
  heatLerpRate: 3.0,


  coreRadius: 0.17,
  coreColor: 0xc9ffe4,
  coreEmissive: 0x4dffb0,
  coreIntensity: 3.0,
  coreOpacity: 0.9,

  coreLagStiffness: 55,
  coreLagDamping: 6,
  corePulseDecay: 1.8,


  castColor: 0x35e08a,
  castRadius: 1.1,
  castOpacity: 0.55,
  castY: 0.015,


  leanMax: 0.58,
  backLean: 0.24,
  stretchMax: 0.40,
  leanLag: 6,


  wobbleStiffness: 110,
  wobbleDamping: 6,
  wobbleAmount: 0.10,
  wobbleCouple: 0.55,
  wobbleImpulse: 6,


  rippleAmplitude: 0.10,
  rippleFrequency: 7.5,
  rippleWaves: 3,
  rippleDecay: 4.5,


  waveLagPerHeight: 0.18,
  waveGain: 0.45,
  waveHistoryLen: 24,


  rimStrength: 0.0,
  rimPower: 2.6,
  rimColor: 0xd8fff0,


  outlinePixels: 2,
  outlineColor: 0x0e5c3a,
  outlineOpacity: 0.95,


  eyeRadius: 0.07,
  eyeOffsetX: 0.16,
  eyeOffsetY: 0.06,
  eyeColor: 0xd9dde2,
};


const player = new THREE.Group();


const PLAYER_GROUND_Y = CONFIG.playerRadius;


const slimeGeo = new THREE.SphereGeometry(
  SLIME.radius, SLIME.widthSegments, SLIME.heightSegments
);

const slimeBasePositions = slimeGeo.attributes.position.array.slice();


const slimeMat = new THREE.MeshPhysicalMaterial({
  color: SLIME.color,
  emissive: SLIME.emissive,
  emissiveIntensity: SLIME.emissiveIntensity,
  roughness: SLIME.roughness,
  metalness: 0.0,
  clearcoat: SLIME.clearcoat,
  clearcoatRoughness: SLIME.clearcoatRoughness,
  transparent: true,
  opacity: SLIME.opacity,
  depthWrite: false,

  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc,
  stencilZPass: THREE.ReplaceStencilOp,
  stencilFail: THREE.ReplaceStencilOp,
  stencilZFail: THREE.ReplaceStencilOp,
});


const rimUniforms = {
  uRimColor: { value: new THREE.Color(SLIME.rimColor) },
  uRimStrength: { value: SLIME.rimStrength },
  uRimPower: { value: SLIME.rimPower },
};

slimeMat.onBeforeCompile = (shader) => {
  shader.uniforms.uRimColor = rimUniforms.uRimColor;
  shader.uniforms.uRimStrength = rimUniforms.uRimStrength;
  shader.uniforms.uRimPower = rimUniforms.uRimPower;

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      uniform vec3 uRimColor;
      uniform float uRimStrength;
      uniform float uRimPower;`
    )
    .replace(
      '#include <opaque_fragment>',
      `
      // Fresnel: brighter where the view grazes the surface (smaller dotNV)
      {
        float fres = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
        fres = pow( fres, uRimPower );
        outgoingLight += uRimColor * ( fres * uRimStrength );
      }
      #include <opaque_fragment>`
    );
};

slimeMat.customProgramCacheKey = () => `slime-rim-${SLIME.rimPower}-${SLIME.rimStrength}`;
const slimeBody = new THREE.Mesh(slimeGeo, slimeMat);

slimeBody.castShadow = false;

slimeBody.position.y = -PLAYER_GROUND_Y;
player.add(slimeBody);


const outlineUniforms = {

  uOutlinePixels: { value: SLIME.outlinePixels },
  uResolutionY: { value: window.innerHeight },
};

const slimeOutlineMat = new THREE.MeshBasicMaterial({
  color: SLIME.outlineColor,

  side: THREE.FrontSide,
  transparent: true,
  opacity: SLIME.outlineOpacity,

  depthTest: true,
  depthWrite: false,

  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.NotEqualStencilFunc,
  stencilFail: THREE.KeepStencilOp,
  stencilZFail: THREE.KeepStencilOp,
  stencilZPass: THREE.KeepStencilOp,
  fog: false,
});

slimeOutlineMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, outlineUniforms);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
      uniform float uOutlinePixels;
      uniform float uResolutionY;`
    )
    .replace(
      '#include <project_vertex>',
      `// ---- Screen-space constant-width outline ----
      // The old approach pushed vertices along the world-space normal. That made
      // the width depend on facing: when the body turns left vs right, the side
      // normals mirror around the view axis, so the projected offset differs a
      // lot and the outline looked thick on one side and thin on the other.
      //
      // Now the offset is computed in screen space:
      //   1) project both the vertex and (vertex + normal) to clip space
      //   2) derive the normal direction in NDC
      //   3) convert the pixel width to an NDC offset and add it
      // The outline is therefore the same width at any orientation or distance.
      // Note: this must replace project_vertex rather than be injected into
      // begin_vertex, otherwise project_vertex recomputes and overwrites gl_Position.
      vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
      gl_Position = projectionMatrix * mvPosition;

      {
        vec3 nrmView = normalize( normalMatrix * normal );
        // Vertex offset along the view-space normal
        vec4 clipA = gl_Position;
        vec4 clipB = projectionMatrix * ( mvPosition + vec4( nrmView, 0.0 ) * 0.01 );

        vec2 ndcA = clipA.xy / max( clipA.w, 1e-5 );
        vec2 ndcB = clipB.xy / max( clipB.w, 1e-5 );
        vec2 dir = ndcB - ndcA;
        float dl = length( dir );
        dir = dl > 1e-6 ? dir / dl : vec2( 0.0 );

        // Pixels to NDC (NDC height 2 spans the full viewport)
        float ndcPerPixel = 2.0 / uResolutionY;
        gl_Position.xy += dir * uOutlinePixels * ndcPerPixel * gl_Position.w;
      }
      `
    );
};

slimeOutlineMat.customProgramCacheKey = () => `slime-outline-stencil-${SLIME.outlinePixels}`;

const slimeOutline = new THREE.Mesh(slimeGeo, slimeOutlineMat);
slimeOutline.castShadow = false;
slimeOutline.receiveShadow = false;

slimeOutline.renderOrder = 4;
slimeOutline.position.y = -PLAYER_GROUND_Y;
player.add(slimeOutline);


const slimeCoreMat = new THREE.MeshStandardMaterial({
  color: SLIME.coreColor,
  emissive: SLIME.coreEmissive,
  emissiveIntensity: SLIME.coreIntensity,
  transparent: true,
  opacity: SLIME.coreOpacity,
  depthWrite: false,
});
const slimeCore = new THREE.Mesh(
  new THREE.SphereGeometry(SLIME.coreRadius, 18, 14),
  slimeCoreMat
);
slimeCore.renderOrder = 1;
slimeBody.renderOrder = 2;
slimeBody.add(slimeCore);


const coreLag = { x: 0, y: 0, z: 0, velX: 0, velY: 0, velZ: 0 };

let corePulse = 0;

let starEyes = 0;

let heat = 0;

const _heatColor = new THREE.Color();
const _heatCore = new THREE.Color();
const _heatCast = new THREE.Color();
const _heatOutline = new THREE.Color();


function makeRadialTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.2)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const castLightMat = new THREE.MeshBasicMaterial({
  map: makeRadialTexture(),
  color: SLIME.castColor,
  transparent: true,
  opacity: SLIME.castOpacity,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  fog: false,
});
const castLight = new THREE.Mesh(
  new THREE.PlaneGeometry(SLIME.castRadius * 2, SLIME.castRadius * 2),
  castLightMat
);
castLight.rotation.x = -Math.PI / 2;
castLight.position.y = SLIME.castY;
castLight.renderOrder = -1;
scene.add(castLight);

const eyeGeo = new THREE.SphereGeometry(SLIME.eyeRadius, 12, 10);

const eyeMat = new THREE.MeshStandardMaterial({
  color: SLIME.eyeColor,
  roughness: 0.25,
  metalness: 0.0,
});


function makeStarTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2, cy = size / 2;
  const outer = size * 0.46, inner = outer * 0.42;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = '#fff6b8';
  ctx.fill();
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 4;
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const starTex = makeStarTexture();
const starMat = new THREE.MeshBasicMaterial({
  map: starTex,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  depthTest: false,
  side: THREE.DoubleSide,
  fog: false,
});


const eyes = [];
for (const side of [-1, 1]) {
  const eye = new THREE.Mesh(eyeGeo, eyeMat);
  eye.castShadow = false;
  eye.renderOrder = 3;
  eye.userData.side = side;


  const star = new THREE.Mesh(
    new THREE.PlaneGeometry(SLIME.eyeRadius * 2.6, SLIME.eyeRadius * 2.6),
    starMat
  );
  star.position.z = -SLIME.eyeRadius * 0.85;
  star.renderOrder = 4;
  star.visible = false;
  eye.add(star);
  eye.userData.star = star;

  slimeBody.add(eye);
  eyes.push(eye);
}

const eyeAnchorY = SLIME.eyeOffsetY;
const eyeAnchorZ = -Math.sqrt(
  Math.max(SLIME.radius ** 2 - SLIME.eyeOffsetX ** 2 - SLIME.eyeOffsetY ** 2, 0)
);

player.position.set(0, PLAYER_GROUND_Y, 0);


player.rotation.y = Math.atan2(-camera.position.x, -camera.position.z);

scene.add(player);


window.__SCENE__ = scene;
window.__CAMERA__ = camera;
window.__PLAYER__ = player;
window.__THREE__ = THREE;


const squash = {
  scale: 1,
  velocity: 0,
};


function squashImpulse(scale) {
  squash.scale = scale;
  squash.velocity = 0;

  const coupling = (scale - 1) * SLIME.wobbleCouple * SLIME.wobbleImpulse;
  wobbleLeft.velocity += coupling;
  wobbleRight.velocity += coupling;
}


const SQUASH_STEP = 1 / 120;


const crouch = { armed: true, timer: 0, scale: 1 };

let squashTint = 1;

const coreSquash = { x: 1, y: 1, z: 1 };


const slimeShape = {
  syLag: 1,
  lean: 0,
  leanVel: 0,
  stretch: 0,
  stretchLag: 0,
};


const wobbleLeft = { value: 0, velocity: 0 };
const wobbleRight = { value: 0, velocity: 0 };


let rippleStrength = 0;
let ripplePhase = 0;


const waveHistory = new Float32Array(SLIME.waveHistoryLen);
waveHistory.fill(1);
let waveWriteIndex = 0;


function delayedSy(syNow, h) {
  const lag = Math.min(h * SLIME.waveLagPerHeight, 0.4);
  const framesBack = Math.round(lag * 60);
  if (framesBack <= 0) return syNow;
  const idx = (waveWriteIndex - framesBack + SLIME.waveHistoryLen * 2) % SLIME.waveHistoryLen;
  return syNow + (waveHistory[idx] - syNow) * SLIME.waveGain;
}


function deformPoint(x0, y0, z0, sy, lean, stretch, opts) {
  const syClamped = sy;
  const sxz = 1 / Math.sqrt(syClamped);
  const h = THREE.MathUtils.clamp(y0 / SLIME.radius * 0.5 + 0.5, 0, 1);


  const syAtH = (opts && opts.noWave) ? syClamped : delayedSy(syClamped, h);
  const sxzAtH = 1 / Math.sqrt(Math.max(syAtH, 0.2));


  const wobX = 1 + wobbleLeft.value * SLIME.wobbleAmount;
  const wobZ = 1 + wobbleRight.value * SLIME.wobbleAmount;

  const spread = SLIME.bulgeBottom * Math.pow(1 - h, 3) + SLIME.bulgeTop * Math.pow(h, 3);
  const widen = sxzAtH * (1 + spread);
  let s = 1 + stretch * h * h;


  let ripple = 0;
  if (rippleStrength > 0.001) {
    const ang = (Math.atan2(x0, z0) * 0.5 + h * Math.PI * SLIME.rippleWaves + ripplePhase * Math.PI * 2);
    ripple = Math.sin(ang) * rippleStrength * SLIME.rippleAmplitude * h;
    s += ripple;
  }

  const x1 = x0 * widen * wobX;
  const y1 = y0 * syAtH * SLIME.baseFlatten * (1 + ripple * 0.5);
  const z1 = z0 * widen * s * wobZ;

  const tilt = lean * h;
  const c = Math.cos(tilt);
  const sn = Math.sin(tilt);

  const footY = -SLIME.radius * syClamped * SLIME.baseFlatten;
  const ry = y1 - footY;
  return {
    x: x1,
    y: footY + (ry * c - z1 * sn),
    z: ry * sn + z1 * c,
  };
}


function applySlimeShape(sy, lean, stretch) {

  const syWithCrouch = THREE.MathUtils.clamp(
    sy * THREE.MathUtils.clamp(crouch.scale, 0.6, 1),
    0.35, 1.8
  );
  sy = syWithCrouch;

  const syClamped = THREE.MathUtils.clamp(sy, 0.35, 1.8);
  const stretchClamped = THREE.MathUtils.clamp(stretch, 0, 1.5);


  const leanClamped = THREE.MathUtils.clamp(lean, -0.8, 0.8) * syClamped;


  slimeBody.position.y = -PLAYER_GROUND_Y + SLIME.radius * SLIME.baseFlatten * syClamped;

  slimeOutline.position.y = slimeBody.position.y;

  const pos = slimeGeo.attributes.position;
  const arr = pos.array;

  for (let i = 0; i < pos.count; i++) {
    const i3 = i * 3;
    const p = deformPoint(
      slimeBasePositions[i3],
      slimeBasePositions[i3 + 1],
      slimeBasePositions[i3 + 2],
      syClamped,
      leanClamped,
      stretchClamped
    );


    const footY = -SLIME.radius * syClamped * SLIME.baseFlatten;
    arr[i3] = p.x;
    arr[i3 + 1] = Math.max(p.y, footY);
    arr[i3 + 2] = p.z;
  }


  for (const eye of eyes) {
    const side = eye.userData.side;
    const p = deformPoint(
      side * SLIME.eyeOffsetX,
      eyeAnchorY,
      eyeAnchorZ,
      syClamped,
      leanClamped,
      stretchClamped,
      { noWave: true }
    );
    eye.position.set(p.x, p.y, p.z);
  }

  pos.needsUpdate = true;
  slimeGeo.computeVertexNormals();
  slimeGeo.computeBoundingBox();
  slimeGeo.computeBoundingSphere();
}


function updateStarEyes(dt) {
  if (starEyes > 0) {
    starEyes = Math.max(0, starEyes - dt * 1.4);
  }
  const opacity = starEyes;
  starMat.opacity = opacity;
  const visible = opacity > 0.01;
  for (const eye of eyes) {
    const star = eye.userData.star;
    if (star) {
      star.visible = visible;

      star.scale.setScalar(0.7 + opacity * 0.5);
    }
  }
}


function updateHeatColor(dt) {

  const eaten = Math.floor(state.score / 10);
  const target = THREE.MathUtils.clamp(eaten / SLIME.heatCount, 0, 1);

  heat += (target - heat) * (1 - Math.exp(-SLIME.heatLerpRate * dt));


  const h = THREE.MathUtils.lerp(SLIME.heatHueGreen, SLIME.heatHueRed, heat);
  const s = THREE.MathUtils.lerp(SLIME.heatSatStart, SLIME.heatSatEnd, heat) / 100;
  const l = THREE.MathUtils.lerp(SLIME.heatLightStart, SLIME.heatLightEnd, heat) / 100;


  _heatColor.setHSL(h / 360, s, l);
  slimeMat.color.copy(_heatColor);


  _heatCore.setHSL(h / 360, Math.max(s - 0.15, 0.3), Math.min(l + 0.25, 0.92));
  slimeCoreMat.color.copy(_heatCore);

  _heatCore.setHSL(h / 360, 0.9, 0.55);
  slimeCoreMat.emissive.copy(_heatCore);


  _heatCast.setHSL(h / 360, Math.min(s + 0.1, 0.95), Math.min(l + 0.12, 0.85));
  castLightMat.color.copy(_heatCast);


  _heatOutline.setHSL(h / 360, Math.min(s + 0.05, 0.9), Math.max(l - 0.42, 0.06));
  slimeOutlineMat.color.copy(_heatOutline);
}

function updateCore(dt, sy, lean, stretch) {
  let coreRemaining = Math.min(dt, 0.1);
  while (coreRemaining > 0) {
    const ch = Math.min(SQUASH_STEP, coreRemaining);
    coreRemaining -= ch;

    coreLag.velX += (-SLIME.coreLagStiffness * coreLag.x - SLIME.coreLagDamping * coreLag.velX) * ch;
    coreLag.velY += (-SLIME.coreLagStiffness * coreLag.y - SLIME.coreLagDamping * coreLag.velY) * ch;
    coreLag.velZ += (-SLIME.coreLagStiffness * coreLag.z - SLIME.coreLagDamping * coreLag.velZ) * ch;
    coreLag.x += coreLag.velX * ch;
    coreLag.y += coreLag.velY * ch;
    coreLag.z += coreLag.velZ * ch;
  }


  coreLag.x = THREE.MathUtils.clamp(coreLag.x, -0.35, 0.35);
  coreLag.y = THREE.MathUtils.clamp(coreLag.y, -0.35, 0.35);
  coreLag.z = THREE.MathUtils.clamp(coreLag.z, -0.35, 0.35);
  if (Math.abs(coreLag.x) < 0.0005 && Math.abs(coreLag.velX) < 0.01) { coreLag.x = 0; coreLag.velX = 0; }
  if (Math.abs(coreLag.y) < 0.0005 && Math.abs(coreLag.velY) < 0.01) { coreLag.y = 0; coreLag.velY = 0; }
  if (Math.abs(coreLag.z) < 0.0005 && Math.abs(coreLag.velZ) < 0.01) { coreLag.z = 0; coreLag.velZ = 0; }


  const coreHome = deformPoint(0, 0, 0, sy, lean, stretch, { noWave: true });
  slimeCore.position.set(
    coreHome.x + coreLag.x,
    coreHome.y + coreLag.y,
    coreHome.z + coreLag.z
  );


  corePulse = Math.max(0, corePulse - SLIME.corePulseDecay * dt);
  const pulse = THREE.MathUtils.clamp(corePulse, 0, 1);

  slimeCore.scale.set(
    coreSquash.x * (1 + pulse * 0.35),
    coreSquash.y * (1 + pulse * 0.35),
    coreSquash.z * (1 + pulse * 0.35)
  );
  slimeCoreMat.emissiveIntensity = SLIME.coreIntensity * (1 + pulse * 1.2);
}


function updateSquash(dt, speed01, isForward) {
  const k = JUICE.squashStiffness;
  const c = JUICE.squashDamping;


  let remaining = Math.min(dt, 0.1);
  while (remaining > 0) {
    const h = Math.min(SQUASH_STEP, remaining);
    remaining -= h;
    squash.velocity += (-k * (squash.scale - 1) - c * squash.velocity) * h;
    squash.scale += squash.velocity * h;
  }


  if (Math.abs(squash.scale - 1) < 0.0008 && Math.abs(squash.velocity) < 0.01) {
    squash.scale = 1;
    squash.velocity = 0;
  }


  const sy = THREE.MathUtils.clamp(squash.scale, 0.35, 1.8);


  const lagT = 1 - Math.exp(-SLIME.lagRate * dt);
  slimeShape.syLag += (sy - slimeShape.syLag) * lagT;


  const leanTarget = isForward
    ? SLIME.leanMax * speed01
    : -SLIME.backLean * speed01;
  const leanT = 1 - Math.exp(-SLIME.leanLag * dt);
  slimeShape.lean += (leanTarget - slimeShape.lean) * leanT;

  const stretchTarget = SLIME.stretchMax * speed01;
  slimeShape.stretchLag += (stretchTarget - slimeShape.stretchLag) * lagT;


  const lean = THREE.MathUtils.clamp(slimeShape.lean, -0.8, 0.8);
  const stretch = THREE.MathUtils.clamp(slimeShape.stretchLag, 0, 1.5);


  const syFinal = sy * 0.7 + slimeShape.syLag * 0.3;


  let wobRemaining = Math.min(dt, 0.1);
  while (wobRemaining > 0) {
    const wh = Math.min(SQUASH_STEP, wobRemaining);
    wobRemaining -= wh;
    wobbleLeft.velocity += (-SLIME.wobbleStiffness * wobbleLeft.value - SLIME.wobbleDamping * wobbleLeft.velocity) * wh;
    wobbleRight.velocity += (-SLIME.wobbleStiffness * wobbleRight.value - SLIME.wobbleDamping * wobbleRight.velocity) * wh;
    wobbleLeft.value += wobbleLeft.velocity * wh;
    wobbleRight.value += wobbleRight.velocity * wh;
  }

  wobbleLeft.value = THREE.MathUtils.clamp(wobbleLeft.value, -1.2, 1.2);
  wobbleRight.value = THREE.MathUtils.clamp(wobbleRight.value, -1.2, 1.2);
  if (Math.abs(wobbleLeft.value) < 0.0008 && Math.abs(wobbleLeft.velocity) < 0.01) { wobbleLeft.value = 0; wobbleLeft.velocity = 0; }
  if (Math.abs(wobbleRight.value) < 0.0008 && Math.abs(wobbleRight.velocity) < 0.01) { wobbleRight.value = 0; wobbleRight.velocity = 0; }


  const deviation = Math.abs(syFinal - 1);
  const rippleTarget = THREE.MathUtils.clamp(deviation * 2.2, 0, 1);

  rippleStrength = Math.max(rippleStrength, rippleTarget);
  rippleStrength = Math.max(0, rippleStrength - SLIME.rippleDecay * dt);
  ripplePhase = (ripplePhase + dt * SLIME.rippleFrequency) % 1000;


  waveWriteIndex = (waveWriteIndex + 1) % SLIME.waveHistoryLen;
  waveHistory[waveWriteIndex] = syFinal;

  applySlimeShape(syFinal, lean, stretch);


  updateHeatColor(dt);


  const squash01 = THREE.MathUtils.clamp(Math.abs(syFinal - 1) * 2, 0, 1);
  const tintTarget = 1 - squash01 * JUICE.squashTintAmount;
  squashTint += (tintTarget - squashTint) * (1 - Math.exp(-10 * dt));
  slimeMat.emissiveIntensity = SLIME.emissiveIntensity * (1 + squash01 * JUICE.squashTintAmount * 1.6);
  slimeMat.opacity = THREE.MathUtils.clamp(
    SLIME.opacity * (0.85 + squashTint * 0.15), 0.3, 1
  );


  const followY = THREE.MathUtils.lerp(1, syFinal, JUICE.coreSquashFollow);
  const followXZ = 1 / Math.sqrt(Math.max(followY, 0.3));
  const cs = 1 - Math.exp(-14 * dt);
  coreSquash.y += (followY - coreSquash.y) * cs;
  coreSquash.x += (followXZ - coreSquash.x) * cs;
  coreSquash.z += (followXZ - coreSquash.z) * cs;


  updateCore(dt, syFinal, lean, stretch);
}


function registerComboHit() {
  state.combo += 1;
  state.comboTimer = CONFIG.comboWindow;
  if (state.combo > state.maxCombo) state.maxCombo = state.combo;
}

function getComboMultiplier() {
  if (state.combo <= 1) return 1;
  const tier = Math.floor((state.combo - 1) / CONFIG.comboPerTier);
  return Math.min(1 + tier, CONFIG.comboMaxMult);
}


function updateCombo(dt) {
  if (state.combo <= 0) return;
  state.comboTimer -= dt;
  if (state.comboTimer <= 0) {
    state.combo = 0;
    state.comboTimer = 0;
    updateComboHud();
  }
}


const state = {
  running: false,
  score: 0,
  timeLeft: CONFIG.roundSeconds,
  best: 0,

  combo: 0,
  comboTimer: 0,
  maxCombo: 0,
};

const pickups = [];
const pickupGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
const pickupMat = new THREE.MeshStandardMaterial({
  color: 0xffcf5c,
  emissive: 0xff9f1c,
  emissiveIntensity: 0.6,
  roughness: 0.3,
});


const PARTICLE = {
  poolSize: 48,
  perBurst: 8,
  life: 0.55,
  speed: 3.4,
  gravity: -9,
  size: 0.16,
  color: 0xffd76a,
};
const particles = [];
const particleGeo = new THREE.BoxGeometry(PARTICLE.size, PARTICLE.size, PARTICLE.size);
{
  const mat = new THREE.MeshBasicMaterial({
    color: PARTICLE.color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  for (let i = 0; i < PARTICLE.poolSize; i++) {
    const m = new THREE.Mesh(particleGeo, mat.clone());
    m.visible = false;
    m.userData.life = 0;
    m.userData.vx = 0; m.userData.vy = 0; m.userData.vz = 0;
    m.userData.spin = 0;
    scene.add(m);
    particles.push(m);
  }
}


function spawnParticles(x, y, z, count) {
  let spawned = 0;
  for (const p of particles) {
    if (p.visible) continue;

    const ang = (spawned / (count || PARTICLE.perBurst)) * Math.PI * 2 + Math.random() * 0.5;
    const up = 0.5 + Math.random() * 0.6;
    const horiz = 0.7 + Math.random() * 0.5;
    p.userData.vx = Math.cos(ang) * PARTICLE.speed * horiz;
    p.userData.vz = Math.sin(ang) * PARTICLE.speed * horiz;
    p.userData.vy = PARTICLE.speed * up;
    p.userData.spin = (Math.random() - 0.5) * 12;
    p.userData.life = PARTICLE.life;
    p.position.set(x, y, z);
    p.scale.setScalar(1);
    p.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    p.material.opacity = 1;
    p.visible = true;
    spawned++;
    if (spawned >= (count || PARTICLE.perBurst)) break;
  }
}


function updateParticles(dt) {
  for (const p of particles) {
    if (!p.visible) continue;
    p.userData.life -= dt;
    if (p.userData.life <= 0) { p.visible = false; continue; }

    p.userData.vy += PARTICLE.gravity * dt;
    p.position.x += p.userData.vx * dt;
    p.position.y += p.userData.vy * dt;
    p.position.z += p.userData.vz * dt;


    if (p.position.y < 0.08) {
      p.position.y = 0.08;
      p.userData.vy = Math.abs(p.userData.vy) * 0.35;
      p.userData.vx *= 0.7;
      p.userData.vz *= 0.7;
    }

    p.rotation.x += p.userData.spin * dt;
    p.rotation.z += p.userData.spin * dt * 0.7;

    const k = p.userData.life / PARTICLE.life;
    p.material.opacity = k;
    p.scale.setScalar(0.4 + k * 0.8);
  }
}


const pickupGlows = [];
for (let i = 0; i < LIGHT.glowCount; i++) {
  const light = new THREE.PointLight(LIGHT.glowColor, 0, LIGHT.glowDistance, 2);
  light.position.set(0, -100, 0);
  scene.add(light);
  pickupGlows.push(light);
}


const glowTargets = new Array(LIGHT.glowCount).fill(null);

function updatePickupGlows() {

  const alive = [];
  for (const m of pickups) {
    if (!m.userData.alive) continue;
    const dx = m.position.x - player.position.x;
    const dz = m.position.z - player.position.z;
    alive.push({ mesh: m, d: Math.sqrt(dx * dx + dz * dz) });
  }
  alive.sort((a, b) => a.d - b.d);

  for (let i = 0; i < pickupGlows.length; i++) {
    const light = pickupGlows[i];
    const item = alive[i];
    if (!item) {
      light.intensity = 0;
      glowTargets[i] = null;
      continue;
    }

    const near = THREE.MathUtils.clamp(1 - item.d / 12, 0.35, 1);
    light.position.copy(item.mesh.position);

    light.position.y += 0.35;
    light.intensity = LIGHT.glowIntensity * near;
    glowTargets[i] = item.mesh;
  }
}

function spawnPickups() {
  for (const p of pickups) scene.remove(p);
  pickups.length = 0;

  const half = CONFIG.levelSize * 0.5 - 2;
  for (let i = 0; i < CONFIG.pickupCount; i++) {

    const mat = pickupMat.clone();
    mat.transparent = true;

    const m = new THREE.Mesh(pickupGeo, mat);
    m.position.set(
      THREE.MathUtils.randFloat(-half, half),
      0.5,
      THREE.MathUtils.randFloat(-half, half)
    );
    m.castShadow = true;
    m.userData.phase = Math.random() * Math.PI * 2;
    m.userData.alive = true;
    m.userData.popT = null;
    m.userData.popDirX = 0;
    m.userData.popDirZ = 0;
    m.userData.popX0 = 0;
    m.userData.popZ0 = 0;
    m.userData.popY0 = 0;
    m.renderOrder = 1;
    scene.add(m);
    pickups.push(m);
  }
}
spawnPickups();


const keys = new Set();
const keyMap = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
};

let debugOn = true;
const upAxis = new THREE.Vector3(0, 1, 0);

addEventListener('keydown', (e) => {
  initAudio();
  const k = keyMap[e.code];
  if (k) {
    keys.add(k);
    e.preventDefault();
  }
  if (e.code === 'KeyF') {
    debugOn = !debugOn;
    ui.hint.style.opacity = debugOn ? '0.5' : '0';
  }
});

addEventListener('keyup', (e) => {
  const k = keyMap[e.code];
  if (k) keys.delete(k);
});


const joystick = {
  active: false,
  pointerId: null,
  originX: 0, originY: 0,
  x: 0, y: 0,
  maxRadius: 60,
};

let touchMove = null;


const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

function updateJoystickVisual() {
  const base = document.getElementById('joystick');
  const knob = document.getElementById('joystick-knob');
  if (!base || !knob) return;
  if (!joystick.active) {
    base.style.opacity = '0';
    return;
  }
  base.style.opacity = '0.55';
  base.style.left = joystick.originX + 'px';
  base.style.top = joystick.originY + 'px';
  knob.style.transform =
    `translate(-50%, -50%) translate(${joystick.x * joystick.maxRadius}px, ${joystick.y * joystick.maxRadius}px)`;
}

const canvasEl = renderer.domElement;

canvasEl.addEventListener('pointerdown', (e) => {
  initAudio();
  if (e.pointerType === 'mouse') return;

  if (e.clientX < window.innerWidth * 0.5 && !joystick.active) {
    joystick.active = true;
    joystick.pointerId = e.pointerId;
    joystick.originX = e.clientX;
    joystick.originY = e.clientY;
    joystick.x = 0; joystick.y = 0;
    touchMove = { x: 0, y: 0 };
    canvasEl.setPointerCapture?.(e.pointerId);
    updateJoystickVisual();
  }

}, { passive: true });

canvasEl.addEventListener('pointermove', (e) => {
  if (!joystick.active || e.pointerId !== joystick.pointerId) return;
  const dx = e.clientX - joystick.originX;
  const dy = e.clientY - joystick.originY;
  const len = Math.hypot(dx, dy);

  const clamped = len > joystick.maxRadius ? joystick.maxRadius / len : 1;
  joystick.x = (dx * clamped) / joystick.maxRadius;
  joystick.y = (dy * clamped) / joystick.maxRadius;
  touchMove = { x: joystick.x, y: joystick.y };
  updateJoystickVisual();
}, { passive: true });

function endJoystick(e) {
  if (!joystick.active) return;
  if (e && e.pointerId !== undefined && e.pointerId !== joystick.pointerId) return;
  joystick.active = false;
  joystick.pointerId = null;
  joystick.x = 0; joystick.y = 0;
  touchMove = null;
  updateJoystickVisual();
}
canvasEl.addEventListener('pointerup', endJoystick, { passive: true });
canvasEl.addEventListener('pointercancel', endJoystick, { passive: true });


function bindJumpButton() {
  const btn = document.getElementById('btn-jump');
  if (!btn) return;
  const press = (e) => {
    e.preventDefault();
    initAudio();
    keys.add('jump');
    btn.classList.add('pressed');
  };
  const release = (e) => {
    e.preventDefault();
    keys.delete('jump');
    btn.classList.remove('pressed');
  };
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
}
bindJumpButton();


if (isTouch) {
  document.body.classList.add('is-touch');
}


const ui = {
  score: document.getElementById('score'),
  time: document.getElementById('time'),
  comboRow: document.getElementById('combo-row'),
  combo: document.getElementById('combo'),
  overlay: document.getElementById('overlay'),
  hint: document.getElementById('hint'),
  loading: document.getElementById('loading'),
};


function updateComboHud() {
  if (!ui.comboRow || !ui.combo) return;
  if (state.combo >= 2) {
    ui.comboRow.style.display = '';
    ui.combo.textContent = `x${getComboMultiplier()} (${state.combo})`;

    const m = getComboMultiplier();
    const hue = Math.max(0, 50 - (m - 1) * 8);
    ui.combo.style.color = `hsl(${hue}, 100%, 65%)`;
  } else {
    ui.comboRow.style.display = 'none';
  }
}

function showOverlay(title, lines) {
  ui.overlay.innerHTML = `
    <h1>${title}</h1>
    ${lines.map((l) => `<p>${l}</p>`).join('')}
    <p class="small">Click to start</p>
  `;
  ui.overlay.classList.remove('hidden');
}

function hideOverlay() {
  ui.overlay.classList.add('hidden');
}


const velocity = new THREE.Vector3();
let onGround = true;
const clock = new THREE.Clock();

const tmpDir = new THREE.Vector3();
const camForward = new THREE.Vector3();
const camRight = new THREE.Vector3();


function getMoveDirection() {

  camForward.subVectors(player.position, camera.position);
  camForward.y = 0;
  camForward.normalize();


  camRight.crossVectors(camForward, upAxis).normalize();

  tmpDir.set(0, 0, 0);


  if (touchMove && (Math.abs(touchMove.x) > 0.12 || Math.abs(touchMove.y) > 0.12)) {
    tmpDir.addScaledVector(camRight, touchMove.x);
    tmpDir.addScaledVector(camForward, -touchMove.y);
    tmpDir.normalize();
    return tmpDir;
  }

  if (keys.has('up') || keys.has('down')) {
    tmpDir.addScaledVector(camForward, keys.has('up') ? 1 : -1);
  }
  if (keys.has('left') || keys.has('right')) {
    tmpDir.addScaledVector(camRight, keys.has('right') ? 1 : -1);
  }
  if (tmpDir.lengthSq() > 0) tmpDir.normalize();
  return tmpDir;
}

function update(dt) {
  if (!state.running) return;


  state.timeLeft = Math.max(0, state.timeLeft - dt);
  updateCombo(dt);


  const sec = Math.ceil(state.timeLeft);
  if (sec !== state.lastTickSecond) {
    state.lastTickSecond = sec;
    if (sec > 0 && sec <= 5) playSound('tick', 1 + (5 - sec) * 0.08);
  }

  if (state.timeLeft <= 0) endRound();


  const dir = getMoveDirection();
  const targetVX = dir.x * CONFIG.moveSpeed;
  const targetVZ = dir.z * CONFIG.moveSpeed;
  const approach = 1 - Math.exp(-JUICE.accelRate * dt);
  velocity.x += (targetVX - velocity.x) * approach;
  velocity.z += (targetVZ - velocity.z) * approach;


  const speed01 = THREE.MathUtils.clamp(
    Math.hypot(velocity.x, velocity.z) / CONFIG.moveSpeed, 0, 1
  );
  let isForward = true;
  if (speed01 > 0.01) {

    const faceX = -Math.sin(player.rotation.y);
    const faceZ = -Math.cos(player.rotation.y);
    const dot = (velocity.x * faceX + velocity.z * faceZ) / Math.hypot(velocity.x, velocity.z);
    isForward = dot >= 0;
  }


  const jumpDown = keys.has('jump') && onGround;
  if (jumpDown) {
    if (crouch.armed) {

      crouch.armed = false;
      crouch.timer = JUICE.jumpCrouchTime;
    }
    crouch.timer -= dt;
    if (crouch.timer <= 0) {

      velocity.y = CONFIG.jumpSpeed;
      onGround = false;
      squashImpulse(JUICE.jumpStretch);
      playSound('jump');
      crouch.armed = true;
      crouch.timer = 0;
      crouch.scale = 1;
    } else {

      const progress = 1 - crouch.timer / JUICE.jumpCrouchTime;
      const eased = progress * progress * (3 - 2 * progress);
      crouch.scale = THREE.MathUtils.lerp(1, JUICE.jumpCrouchSquash, eased);
    }
  } else {

    crouch.armed = true;
    crouch.timer = 0;
    crouch.scale = 1;
  }

  velocity.y += CONFIG.gravity * dt;

  const wasGrounded = onGround;


  player.position.addScaledVector(velocity, dt);


  if (player.position.y <= PLAYER_GROUND_Y) {
    const impact = Math.abs(velocity.y);
    player.position.y = PLAYER_GROUND_Y;
    velocity.y = 0;
    onGround = true;

    if (!wasGrounded) {
      const amount = Math.min(impact / JUICE.landImpactRef, 1);
      squashImpulse(1 - (JUICE.landSquashMin + (JUICE.landSquashMax - JUICE.landSquashMin) * amount));

      playSound('land', 0.8 + (1 - amount) * 0.5);
    }
  }


  const lim = CONFIG.levelSize * 0.5 - 1;
  player.position.x = THREE.MathUtils.clamp(player.position.x, -lim, lim);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -lim, lim);


  castLight.position.x = player.position.x;
  castLight.position.z = player.position.z;

  const jumpH = Math.max(0, player.position.y - PLAYER_GROUND_Y);
  const castSpread = 1 + jumpH * 0.4;
  const castFade = THREE.MathUtils.clamp(1 - jumpH * 0.5, 0.2, 1);
  castLightMat.opacity = SLIME.castOpacity * castFade;
  castLight.scale.set(castSpread, castSpread, 1);


  if (dir.lengthSq() > 0.001) {
    const targetAngle = Math.atan2(dir.x, dir.z);
    player.rotation.y = lerpAngle(player.rotation.y, targetAngle + Math.PI, 1 - Math.exp(-15 * dt));
  }


  updateSquash(dt, speed01, isForward);


  const t = clock.elapsedTime;
  for (const m of pickups) {
    if (m.userData.alive) {
      const ph = m.userData.phase;
      m.position.y = 0.7 + Math.sin(t * 2.5 + ph) * 0.15;
      m.rotation.y += dt * 1.5;

      const dx = m.position.x - player.position.x;
      const dz = m.position.z - player.position.z;
      const dy = m.position.y - player.position.y;
      const r = CONFIG.playerRadius + 0.5;
      if (dx * dx + dz * dz < r * r && Math.abs(dy) < 1.2) {

        m.userData.alive = false;
        m.userData.popT = 0;

        const len = Math.hypot(dx, dz);
        if (len > 0.0001) {
          m.userData.popDirX = dx / len;
          m.userData.popDirZ = dz / len;
        } else {
          m.userData.popDirX = 0;
          m.userData.popDirZ = 1;
        }
        m.userData.popY0 = m.position.y;
        m.userData.popX0 = m.position.x;
        m.userData.popZ0 = m.position.z;


        registerComboHit();
        const mult = getComboMultiplier();
        const gained = 10 * mult;
        state.score += gained;
        ui.score.textContent = state.score;
        updateComboHud();

        playSound('eat', 1 + (mult - 1) * 0.12);
        spawnParticles(m.position.x, m.position.y, m.position.z, PARTICLE.perBurst);
        squashImpulse(JUICE.eatPulse);
        corePulse = 1;
        starEyes = 1;

        coreLag.velX = (dx / (len || 1)) * 1.2;
        coreLag.velZ = (dz / (len || 1)) * 1.2;
      }
      continue;
    }


    if (m.userData.popT === null) continue;
    m.userData.popT += dt;
    const k = Math.min(m.userData.popT / JUICE.popSeconds, 1);
    const ease = 1 - (1 - k) * (1 - k);

    m.position.x = m.userData.popX0 + m.userData.popDirX * JUICE.popDistance * ease;
    m.position.z = m.userData.popZ0 + m.userData.popDirZ * JUICE.popDistance * ease;
    m.position.y = m.userData.popY0 + 0.35 * ease;
    m.scale.setScalar(JUICE.popScale * (1 - k * k));
    m.material.opacity = 1 - k;
    m.rotation.y += dt * 8;

    if (k >= 1) {
      m.userData.popT = null;
      m.visible = false;
      m.scale.setScalar(1);
      m.material.opacity = 1;
    }
  }


  if (pickups.every((m) => !m.userData.alive && m.userData.popT === null)) spawnPickups();
}


function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function startRound() {
  state.running = true;
  state.score = 0;
  state.timeLeft = CONFIG.roundSeconds;
  state.lastTickSecond = Math.ceil(CONFIG.roundSeconds);
  state.combo = 0;
  state.comboTimer = 0;
  state.maxCombo = 0;
  ui.score.textContent = '0';
  updateComboHud();
  playSound('start');
  player.position.set(0, PLAYER_GROUND_Y, 0);
  velocity.set(0, 0, 0);
  squash.scale = 1;
  squash.velocity = 0;
  slimeShape.syLag = 1;
  slimeShape.lean = 0;
  slimeShape.leanVel = 0;
  slimeShape.stretch = 0;
  slimeShape.stretchLag = 0;
  coreLag.x = coreLag.y = coreLag.z = 0;
  coreLag.velX = coreLag.velY = coreLag.velZ = 0;
  corePulse = 0;
  starEyes = 0;
  starMat.opacity = 0;
  for (const eye of eyes) { if (eye.userData.star) eye.userData.star.visible = false; }
  heat = 0;
  updateHeatColor(1);

  wobbleLeft.value = 0; wobbleLeft.velocity = 0;
  wobbleRight.value = 0; wobbleRight.velocity = 0;
  rippleStrength = 0;
  ripplePhase = 0;
  waveHistory.fill(1);
  waveWriteIndex = 0;

  crouch.armed = true; crouch.timer = 0; crouch.scale = 1;
  squashTint = 1;
  coreSquash.x = 1; coreSquash.y = 1; coreSquash.z = 1;
  slimeMat.emissiveIntensity = SLIME.emissiveIntensity;
  slimeMat.opacity = SLIME.opacity;
  onGround = true;
  spawnPickups();
  hideOverlay();
}

function endRound() {
  state.running = false;
  state.best = Math.max(state.best, state.score);
  playSound('end');
  const comboLine = state.maxCombo >= 2
    ? `Max combo <b>${state.maxCombo}</b>`
    : null;
  showOverlay("Time's Up!", [
    `Score <b>${state.score}</b>`,
    comboLine,
    `Best ${state.best}`,
  ].filter(Boolean));
}

ui.overlay.addEventListener('click', () => {
  initAudio();
  if (!state.running) startRound();
});


function animate() {
  const dt = Math.min(clock.getDelta(), 1 / 30);

  update(dt);
  if (!state.running) updateSquash(dt, 0, true);
  updatePickupGlows();
  updateParticles(dt);
  updateStarEyes(dt);


  outlineUniforms.uResolutionY.value = window.innerHeight * renderer.getPixelRatio();


  controls.target.lerp(player.position, 1 - Math.exp(-8 * dt));

  if (state.running) {
    ui.time.textContent = state.timeLeft.toFixed(1);
  }

  controls.update();

  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);


addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});


ui.loading.classList.add('hidden');
showOverlay('PiPaBiBa', [
  `Eat as many cubes as you can in ${CONFIG.roundSeconds} seconds.`,
]);
