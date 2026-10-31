// ============================================================
//  Game Jam 模板 —— Three.js 单文件游戏
//  结构：初始化 → 输入 → 更新(update) → 渲染(render)
//  改玩法基本只需要动 createPickups / update / 碰撞判定这几块
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ---------------- 音效（Web Audio 程序化合成，不依赖任何音频文件） ----------------
// 为什么要合成而不是加载 mp3：单文件 jam 项目不想带资源文件，
// 而且合成音效没有加载延迟、不会因为路径问题 404。
// 浏览器要求"用户交互后才能播放音频"，所以 AudioContext 在第一次按键/点击时才创建。
const AUDIO = {
  enabled: true,
  volume: 0.35,
  // 音效参数：频率起点/终点、时长、波形、音量
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

// 第一次用户交互时创建 AudioContext（浏览器策略要求）
function initAudio() {
  if (audioCtx) return true;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return false;                 // 不支持就静默跳过，不影响游戏
  audioCtx = new Ctx();
  audioMaster = audioCtx.createGain();
  audioMaster.gain.value = AUDIO.volume;
  audioMaster.connect(audioCtx.destination);
  return true;
}

// 播放一个音效。参数缺失时静默返回，绝不影响游戏逻辑。
function playSound(name, pitchScale) {
  if (!AUDIO.enabled) return;
  if (!initAudio()) return;
  // 从后台切回来时 AudioContext 可能是 suspended
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

  // 简单的攻击-衰减包络，避免爆音
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(spec.vol, 0.0001), now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.dur);

  osc.connect(gain);
  gain.connect(audioMaster);
  osc.start(now);
  osc.stop(now + spec.dur + 0.02);
}


const CONFIG = {
  levelSize: 30,      // 场地边长
  pickupCount: 25,    // 收集物数量
  roundSeconds: 20,   // 单局时长
  moveSpeed: 9,       // 移动速度（单位/秒）
  jumpSpeed: 7.5,     // 起跳速度
  gravity: -22,       // 重力加速度
  playerRadius: 0.5,  // 玩家半径（碰撞用）

  // ---- 连击 ----
  // 连续吃到方块给倍率：3 连击内 x1，之后每 2 连击 +1 倍率，最高 x8。
  // 断连时间 2.5 秒：捡得不那么密集也能接上，但贪多就得跑快点。
  comboWindow: 2.5,     // 多久内吃到下一个才算连击（秒）
  comboMaxMult: 8,      // 最高倍率
  comboPerTier: 2,      // 每多少个连击升一级倍率
};

// ---------------- 动效参数（"Q 弹"的所有旋钮；调手感只改这里） ----------------
const JUICE = {
  // 挤压拉伸：一个欠阻尼弹簧，刚度越大回弹越快，阻尼越小晃得越厉害
  // 90/7 比原来的 220/15 慢得多（收敛 1.37s vs 0.48s），能看清"压扁→弹起→回正"的过程
  squashStiffness: 90,    // 弹簧刚度（越小回弹越慢）
  squashDamping: 7,       // 阻尼（临界值约 2*sqrt(90) ≈ 19，远小于它 → 会明显过冲几下）
  // 跳跃形变（越夸张越"Q"）
  jumpStretch: 1.65,      // 起跳瞬间拉长到 165%
  landSquashMax: 0.42,    // 最重的落地压到 42%（更扁）
  landSquashMin: 0.10,    // 最轻的落地也压 10%，保证每次落地都有反馈
  landImpactRef: 16,      // 下落速度达到这个值就算"满格"冲击
  // 移动惯性
  accelRate: 14,          // 速度趋近目标的速率（1/s），越大越跟手、越小越飘
  // 拾取爆开：改为"向外炸开"，不再原地涨大，避免挡住玩家
  popDistance: 1.1,       // 炸开时往外飞出的距离
  popScale: 1.25,         // 炸开起始时略大一点点（>1 才有"爆"的感觉，但远离玩家）
  popSeconds: 0.22,       // 爆开总时长（秒），放慢一点看得清
  eatPulse: 0.92,         // 吃掉方块时玩家自己被"压一下"再弹回来
  // B2 起跳预压：按下跳跃先蹲一下，蹲够时间才真正起跳（蓄力感）
  jumpCrouchTime: 0.09,   // 预压时长（秒）
  jumpCrouchSquash: 0.78, // 蹲到底时压到多扁
  // C1 压缩变色：身体被压得越扁，颜色越浅（像果冻被挤压变透）
  squashTintAmount: 0.35, // 颜色变化强度（0 = 不变色）
  squashTintMin: 0.35,    // 压到最扁时的亮度系数下限（1 = 不变）
  // C2 内核跟随挤压：身体被压扁时，内核也变成椭球
  coreSquashFollow: 0.65, // 内核跟随身体形变的比例（0 = 永远正圆，1 = 完全跟随）

  // ---- 平滑跟随速率（1/s，越大跟得越快）----
  // 这些原本是散落在代码里的硬编码数字，收进配置方便统一调手感。
  squashTintRate: 10,      // 压缩变色的跟随速度
  coreSquashRate: 14,      // 内核形变的跟随速度
  turnRate: 15,            // 转身速度（脸转向移动方向）
  cameraFollowRate: 8,     // 相机 target 跟随玩家的速度
};

// ---------------- 灯光参数（阶段 3：三点光 + 接触阴影 + 方块光晕） ----------------
// 想改氛围只动这里。三段式：主光定方向、补光托暗部、背光透出半透明身体。
// 要点：三盏灯的方向必须彼此错开（方向光只看方向，位置远近无关），
//       背光大致与主光相反，才能把身体边缘勾出来。
const LIGHT = {
  // 主光（太阳）：负责投影和整体明暗，唯一投射阴影的灯
  sunColor: 0xfff4e6,     // 略暖的白
  sunIntensity: 2.6,      // 比原来 2.2 更亮，靠色调映射压住高光
  sunPosition: [16, 26, 10],

  // 补光：从相机这一侧偏右下打过来，把暗部提起来（和主光、背光都错开）
  fillColor: 0x5b8dd6,    // 更冷的蓝，与暖主光形成冷暖对比
  fillIntensity: 0.8,
  fillPosition: [-18, 6, 8],

  // 背光（轮廓光）：放在主光和相机的对面，勾出身体边缘。
  // 方向夹角实测：主↔背 120°，相机↔背 138°（背光在相机对面才会亮边）
  rimColor: 0xffffff,     // 白色更通用，不会把身体染绿
  rimIntensity: 2.2,
  rimPosition: [-18, 2, -18],

  // 环境底光
  hemiSky: 0x8fc7ff,
  hemiGround: 0x1a2430,
  hemiIntensity: 1.0,

  envIntensity: 0.8,      // 环境贴图强度

  // 整体曝光（色调映射）：觉得整体偏暗/偏亮先调这个
  exposure: 1.15,

  // 接触阴影：图更大 + 边缘更软 + 消除条纹
  shadowMapSize: 4096,
  shadowRadius: 5,        // PCFSoftShadowMap 下控制柔化程度
  shadowBias: -0.0002,
  shadowNormalBias: 0.02,
  shadowExtent: CONFIG.levelSize * 0.8, // 阴影相机覆盖范围

  // 拾取物光晕：只给最近的 N 个方块挂点光源，固定数量轮换，避免动态增删灯
  glowCount: 4,
  glowIntensity: 2.5,
  glowDistance: 6.0,
  glowColor: 0xffb347,    // 跟方块自发光接近
};

// ---------------- 基础三件套 ----------------
// stencil: true —— 描边用模板缓冲实现（见下面的描边部分），必须在创建上下文时就开启
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: true });
renderer.toneMapping = THREE.NeutralToneMapping; // 物理材质 + 环境光下，用中性色调映射才不会过曝发灰
renderer.toneMappingExposure = LIGHT.exposure; // 曝光统一在 LIGHT 里调
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 手机上限制像素比，否则很卡
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.fog = new THREE.Fog(0x0b0f14, 40, 90);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(14, 18, 20);

// 鼠标/触屏拖动旋转视角（只能绕原点转）
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.15; // 别让相机钻到地面下面
controls.minDistance = 8;
controls.maxDistance = 45;

// ---------------- 环境反射 ----------------
// 没有环境贴图，MeshPhysicalMaterial 的 transmission/清晰高光会像塑料。
// RoomEnvironment 是 three 自带的程序化房间，不用下载任何贴图，生成一次即可。
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = LIGHT.envIntensity;
pmrem.dispose();

// ---------------- 灯光（三点式：主光 / 补光 / 背光） ----------------
// 主光：唯一投射阴影的灯，定整体明暗和阴影方向
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

// 补光：不投影，只负责把暗部提起来，让透明身体有层次
const fillLight = new THREE.DirectionalLight(LIGHT.fillColor, LIGHT.fillIntensity);
fillLight.position.set(...LIGHT.fillPosition);
scene.add(fillLight);

// 背光（轮廓光）：从身后打过来，光穿过半透明的身体，正面能看到内部结构
const rimLight = new THREE.DirectionalLight(LIGHT.rimColor, LIGHT.rimIntensity);
rimLight.position.set(...LIGHT.rimPosition);
scene.add(rimLight);

// 环境底光：提供最基础的天空/地面色，强度不能太高否则整体发灰
const hemi = new THREE.HemisphereLight(LIGHT.hemiSky, LIGHT.hemiGround, LIGHT.hemiIntensity);
scene.add(hemi);

// ---------------- 场景内容 ----------------
// 地面纹理：用 canvas 程序化画一张砖块/棋盘格，不引入任何图片资源。
// 为什么不用纯色：纯色地面在等距视角下看不出远近和移动速度，加纹理能明显提升"立体感"。
// ---------------- 程序化贴图工具 ----------------
// 项目里所有贴图都是 canvas 现画的（不加载图片资源）。
// 三个绘制函数共用这套"建 canvas → 交给 draw 回调 → 包成 Texture"的流程，
// 这里统一封装，省掉每个函数里重复的 6 行样板。
function makeCanvasTexture(size, draw, opts) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (opts) {
    if (opts.repeat) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(opts.repeat, opts.repeat);
    }
    if (opts.anisotropy) tex.anisotropy = opts.anisotropy;
  }
  return tex;
}

function makeGroundTexture() {
  return makeCanvasTexture(512, (ctx, size) => {
    // 底色
    ctx.fillStyle = '#223141';
    ctx.fillRect(0, 0, size, size);

    // 2x2 的暗色块，形成棋盘感（同色相邻会显得单调）
    const half = size / 2;
    ctx.fillStyle = '#26374a';
    ctx.fillRect(0, 0, half, half);
    ctx.fillRect(half, half, half, half);

    // 砖缝：细线，让地面有"板"的感觉
    ctx.strokeStyle = 'rgba(90, 130, 170, 0.22)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      const p = (i / 4) * size;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
    }

    // 一点噪点，避免大色块看起来太"平"
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const a = Math.random() * 0.05;
      ctx.fillStyle = `rgba(150, 200, 255, ${a})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }, { repeat: CONFIG.levelSize / 5, anisotropy: 4 });   // 每 5 个世界单位重复一次
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(CONFIG.levelSize, CONFIG.levelSize),
  new THREE.MeshStandardMaterial({
    map: makeGroundTexture(),
    color: 0xffffff,      // 让贴图原色显示
    roughness: 0.95,
    metalness: 0.0,
  })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
// 网格线（纯装饰，很便宜）
const grid = new THREE.GridHelper(CONFIG.levelSize, CONFIG.levelSize, 0x3d556d, 0x2a3a4b);
grid.position.y = 0.01;
scene.add(grid);

// ---------------- 边界高光 ----------------
// 场地边缘围一圈发光带：既是视觉边界提示，也让画面不至于"飘"在空中。
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
  // 四条边
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
    m.position.y = 0.02;   // 略高于地面和网格线，避免 z-fighting
    m.renderOrder = -1;
    group.add(m);
  }
  return group;
}
const edgeGlow = makeEdgeGlow();
scene.add(edgeGlow);

// 四个角柱，方便感知方位
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

// ---------------- 史莱姆配置（阶段 2：粘液半透明质感 + 前倾拉伸） ----------------
const SLIME = {
  radius: 0.42,        // 球的原始半径（直径 0.84，略小于 1 格，视觉上更"软"）
  widthSegments: 28,   // 经度分段
  heightSegments: 20,  // 纬度分段（顶点数 = (28+1)*(20+1) ≈ 609，很轻）
  baseFlatten: 0.82,   // 基础压扁：史莱姆天生是"趴着"的
  bulgeBottom: 0.30,   // 底部摊开的强度（越大约像一滩）
  bulgeTop: 0.22,      // 头顶鼓起的强度
  lagRate: 7,          // 形变跟随速率（1/s），调慢一点让形变更"肉"

  // ---- 材质：真透明果冻（方案 C）----
  // 不再用 transmission：它是"先渲染场景快照再画外皮"的透射通道，
  // 身体内部的内核只会被一层不透明绿皮挡住（实测隔着 0.097 厚的皮，几乎看不见）。
  // 改成普通的 alpha 透明 + 关闭深度写入，内核就能真正透出来。
  color: 0x5ee7a0,
  opacity: 0.55,       // 外皮整体透明度（越低越透）
  emissive: 0x0f3d28,  // 自发光：模拟"被光透进去"的果冻感
  emissiveIntensity: 0.9,
  roughness: 0.1,      // 表面越光滑越"湿"
  clearcoat: 1.0,      // 湿润的清漆层
  clearcoatRoughness: 0.08,

  // ---- 吃越多越红：颜色随本局吃到的方块数从绿渐变到红 ----
  // 用"已吃个数 / heatCount"作为 0..1 的热度，再在 HSL 里把色相从绿转到红。
  // 为什么用色相旋转而不是两色插值：色相在绿(140)->红(0) 之间过渡最自然，
  // 直接 lerp RGB 会经过脏黄色甚至灰色。
  heatCount: 22,       // 吃到这么多个后达到"最红"（约等于场内方块数的大半）
  heatHueGreen: 140,   // 初始色相（绿）
  heatHueRed: 0,       // 最热时的色相（红）
  heatSatStart: 65,    // 初始饱和度（%）
  heatSatEnd: 85,      // 最热时饱和度（%），越红越浓
  heatLightStart: 65,  // 初始亮度（%）
  heatLightEnd: 55,    // 最热时亮度（%），红得深邃一点
  heatLerpRate: 3.0,   // 颜色跟随速率（1/s），太大会突变、太小跟不上

  // ---- 内核：透过半透明外皮能看到的发光小球，"果冻感"的关键 ----
  // 位置不写死：每帧放到"身体几何中心 + 滞后偏移"，靠亮度穿过身体被看到。
  coreRadius: 0.17,
  coreColor: 0xc9ffe4,
  coreEmissive: 0x4dffb0,
  coreIntensity: 3.0,   // 居中后要穿过更厚的身体，所以提亮一些
  coreOpacity: 0.9,
  // 滞后弹簧：内核"慢半拍"跟随身体中心，起跳/落地/急停时会被甩动
  coreLagStiffness: 55,  // 刚度（越小跟随越慢，甩动幅度越大）
  coreLagDamping: 6,     // 阻尼（临界值约 2*sqrt(55) ≈ 15）
  corePulseDecay: 1.8,   // 吃到方块时脉动的衰减速率（1/s），放慢更明显

  // ---- 透光地面光斑（简单方案）----
  // 光穿过半透明的身体，在地上留一块被染色的亮斑。
  // 用一张贴地的圆形贴图实现：稳定、零 shader，不会因为渲染管线出问题。
  castColor: 0x35e08a,     // 光斑颜色（比身体主色更亮，像被光染色）
  castRadius: 1.1,         // 光斑半径
  castOpacity: 0.55,       // 光斑浓度
  castY: 0.015,            // 贴地高度（高于网格线，避免 z-fighting）

  // ---- 前倾拉伸（移动方式）----
  leanMax: 0.58,       // 全速时前倾多少弧度（≈33°）
  backLean: 0.24,      // 后退时身体后仰的程度（按速度自动判定）
  stretchMax: 0.40,    // 全速时沿运动方向拉伸多少
  leanLag: 6,          // 前倾跟随速率（1/s），越小越"软"

  // ---- A1：横向挤压（X/Z 两个方向独立晃动，做出"水袋"感）----
  wobbleStiffness: 110,   // 横向弹簧刚度
  wobbleDamping: 6,       // 阻尼（临界值约 21，远小于它才会晃）
  wobbleAmount: 0.10,     // 最大横向挤压比例（0.1 = 10%）
  wobbleCouple: 0.55,     // 纵向形变传导给横向的比例（压扁时向两侧鼓）
  wobbleImpulse: 6,       // 冲量换算系数：纵向速度变化 -> 横向初速度

  // ---- A2：顶点颤动（低频波动，像被砸了一下的果冻）----
  rippleAmplitude: 0.10,  // 波动强度（大幅下调：0.35 时表面会出现明显褶皱）
  rippleFrequency: 7.5,   // 波动频率（Hz）
  rippleWaves: 3,         // 沿高度方向的波数
  rippleDecay: 4.5,       // 波动衰减速率（1/s）

  // ---- A3：波浪传播（底部先动，再往上传）----
  // 注意：延迟太大会让不同高度层的半径差很多，看起来像"盘状折痕"。
  // 0.55s 太猛，收到 0.18s；同时 waveGain 控制"延迟值参与多少"，留一点实时响应。
  waveLagPerHeight: 0.18, // 顶部相对底部的延迟（秒），h 越高越晚
  waveGain: 0.45,         // 延迟值占比重（0 = 完全实时，1 = 完全延迟）
  waveHistoryLen: 24,     // 保存多少帧的形变历史（60fps 下约 0.4 秒）

  // ---- 边缘光（菲涅尔）：默认关闭，改用下面更"二次元"的描边 ----
  // 保留开关：想回到柔和的透光轮廓，把 rimStrength 调回 0.9 即可
  rimStrength: 0.0,       // 边缘亮度（0 = 关闭）
  rimPower: 2.6,          // 越大边缘越窄越锐（2~4 之间比较自然）
  rimColor: 0xd8fff0,     // 边缘光的颜色（偏白绿，和身体同色系但更亮）

  // ---- 描边（背面扩边）：二次元角色描边，颜色取主题色的暗版 ----
  // 用"屏幕空间像素宽度"，近处远处看都一样粗（固定世界单位会导致远处看不见）
  outlinePixels: 2,       // 描边粗细（屏幕像素）
  outlineColor: 0x0e5c3a, // 深墨绿：史莱姆主色 5ee7a0 的暗部，比纯黑更贴合主题
  outlineOpacity: 0.95,

  // ---- 眼睛：朝向指示 ----
  // 只需要给出水平/垂直偏移，z 由球面自动求出（见 eyeAnchorZ），保证眼睛踩在身体表面上
  eyeRadius: 0.07,
  eyeOffsetX: 0.16,
  eyeOffsetY: 0.06,
  eyeColor: 0xd9dde2,  // 浅灰：半透明身体里不会像黑贴片
};

// 玩家：一只会弹的史莱姆
// 结构：player(Group，只管位置/朝向) → slimeBody(顶点形变) → [内核, 眼睛]
const player = new THREE.Group();

// 玩家站立时的 player.y（= 碰撞半径），地面在 y=0。改碰撞半径时这里会跟着变。
// 视觉脚底贴地的换算都基于这个常量，避免在多个地方写死 0.5。
const PLAYER_GROUND_Y = CONFIG.playerRadius;

// UV 球：uv.y = 0 是底部极点，uv.y = 1 是顶部极点，形变按这个比例算
const slimeGeo = new THREE.SphereGeometry(
  SLIME.radius, SLIME.widthSegments, SLIME.heightSegments
);
// 把原始顶点拷一份备用——每帧都从原始几何体重新算，不做累积，避免漂移
const slimeBasePositions = slimeGeo.attributes.position.array.slice();

// 外皮：物理材质，真透明（alpha）+ 清漆（湿润高光）+ 自发光（果冻透光感）
// transparent + depthWrite:false：不写深度，后面的内核才能透出来；
// renderOrder 保证 内核(1) → 外皮(2) → 眼睛(3) 的绘制顺序固定。
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
  depthWrite: false,   // 不写深度 → 身体内部的内核不会被外皮"挡死"
  // ---- 模板标记：描边靠它判断"哪些像素属于身体" ----
  // 外皮覆盖到的像素写入 1，描边只在 stencil != 1 的地方画，所以永远不会盖住身体。
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc,
  stencilZPass: THREE.ReplaceStencilOp,
  stencilFail: THREE.ReplaceStencilOp,
  stencilZFail: THREE.ReplaceStencilOp,
});

// 边缘光（菲涅尔）：往材质 shader 的最终颜色里注入一段"视角掠射时变亮"的项。
// 不依赖灯光方向，所以无论光源在哪，身体轮廓都有一圈亮边——
// 这是让半透明物体看起来像果冻/水晶最可靠的做法。
// 注入点选 opaque_fragment 之前（此时 outgoingLight 已算好、还没做色调映射）。
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
// 让 three 知道这是"自定义"材质版本，避免和缓存中的旧 shader 混用
slimeMat.customProgramCacheKey = () => `slime-rim-${SLIME.rimPower}-${SLIME.rimStrength}`;
const slimeBody = new THREE.Mesh(slimeGeo, slimeMat);
// 不投射黑色阴影：地表已经有"透光光斑"表现被染色的光，
// 再叠一层灰色投影会让脚下显得脏（两套阴影的观感也冲突）。
slimeBody.castShadow = false;
// 关键：player.position.y 是"身体中心"（碰撞和相机都按它算，不动），
// 但视觉上脚底要贴在地面 y=0。地面高度常量 PLAYER_GROUND_Y 就是玩家站立时的 player.y。
// 每帧在 applySlimeShape() 里按当前 sy 重新对齐（见那里的推导），
// 这样站立贴地、跳跃抬起、压扁拉长都正确。
slimeBody.position.y = -PLAYER_GROUND_Y;
player.add(slimeBody);

// ---------------- 描边（背面扩边）----------------
// 原理：再套一层"只画背面、且沿法线外扩"的网格。
// 正面被身体挡住，只有轮廓外扩出来的那一圈可见，就是二次元角色那种描边。
// 关键：直接复用 slimeGeo（同一个几何体），用顶点着色器外推。
// 这样描边永远和身体同步形变，零额外 CPU 开销，也不用在 applySlimeShape 里多写一份顶点。
const outlineUniforms = {
  // 屏幕空间描边宽度（像素）。在屏幕空间里沿法线外推，所以无论物体转向哪边都等宽。
  uOutlinePixels: { value: SLIME.outlinePixels },
  uResolutionY: { value: window.innerHeight },
};

const slimeOutlineMat = new THREE.MeshBasicMaterial({
  color: SLIME.outlineColor,
  // 用 FrontSide（不是 BackSide）：模板测试会剔除掉身体覆盖的像素，
  // 剩下能画到的只有"外扩出来的一圈"，所以画正面就够了，而且是实心的一圈。
  side: THREE.FrontSide,
  transparent: true,
  opacity: SLIME.outlineOpacity,
  // ---- 深度 ----
  // depthTest 必须开启：这样描边会被前方物体（其他史莱姆、地形、柱子）正常遮挡。
  // 身体本身不写深度，所以不会挡住描边；描边自己不写深度，也不会影响别的物体。
  depthTest: true,
  depthWrite: false,
  // ---- 模板测试：只在"身体没有覆盖"的像素上绘制 ----
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
// 模板测试用到的 uniform（three 自动处理），这里只需要缓存键区分
slimeOutlineMat.customProgramCacheKey = () => `slime-outline-stencil-${SLIME.outlinePixels}`;

const slimeOutline = new THREE.Mesh(slimeGeo, slimeOutlineMat);
slimeOutline.castShadow = false;        // 不能让描边把影子撑大一圈
slimeOutline.receiveShadow = false;
// 必须在外皮(2)之后绘制：外皮先写模板值 1，描边才能靠模板测试剔掉身体内部。
// 描边不写深度也不做深度测试，所以永远不会挡住内核。
slimeOutline.renderOrder = 4;
slimeOutline.position.y = -PLAYER_GROUND_Y;  // 初始值；每帧在 applySlimeShape() 里跟身体同步
player.add(slimeOutline);

// 内核：外皮半透明时能隐约看到，这是"果冻感"的来源。
// 位置不写死：每帧由 applySlimeShape() 放到"身体几何中心 + 滞后偏移"，
// 这样起跳/落地/急停时它会慢半拍地甩动。
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
slimeCore.renderOrder = 1; // 先画内核
slimeBody.renderOrder = 2; // 再画外皮，保证半透明排序稳定
slimeBody.add(slimeCore);

// 内核的滞后弹簧状态（相对身体中心的偏移 + 速度）
const coreLag = { x: 0, y: 0, z: 0, velX: 0, velY: 0, velZ: 0 };
// 吃到方块时的脉动 0..1，随时间衰减
let corePulse = 0;
// 星星眼状态：0 = 正常眼，1 = 完全星星眼。吃到时置 1，之后衰减。
let starEyes = 0;
// 热度（0 = 绿，1 = 红）：由本局吃到的方块数决定，用平滑值避免突变
let heat = 0;
// 复用的颜色对象（不在每帧 new）
const _heatColor = new THREE.Color();
const _heatCore = new THREE.Color();
const _heatCast = new THREE.Color();
const _heatOutline = new THREE.Color();

// ---------------- 透光地面光斑（简单稳定方案）----------------
// 一张贴地的椭圆贴图：中间亮、边缘透明，颜色取身体主色系。
// 加法混合 → 像"多出来的光"而不是贴纸；始终挂在场景里、跟随玩家水平位置。
// 不用任何自定义 shader 或渲染目标，所以不会出现"代码对但看不见"的问题。
function makeRadialTexture() {
  return makeCanvasTexture(128, (ctx, size) => {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0.0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.65)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.2)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  });
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
castLight.renderOrder = -1;   // 最先画，垫在被照亮的区域下面
scene.add(castLight);

const eyeGeo = new THREE.SphereGeometry(SLIME.eyeRadius, 12, 10);
// 眼睛用浅灰：身体是透明的，深色球在身体里会像"贴片"，浅灰更像卡通史莱姆的眼睛。
const eyeMat = new THREE.MeshStandardMaterial({
  color: SLIME.eyeColor,
  roughness: 0.25,
  metalness: 0.0,
});

// ---------------- 星星眼（吃到方块时切换）----------------
// 做法：在眼睛前面盖一层"星形贴图"的平面，吃到时淡入、之后淡出。
// 不用替换眼睛几何体（那要重建 mesh），只用透明度切换，最稳也不会掉帧。
function makeStarTexture() {
  return makeCanvasTexture(128, (ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    // 五角星：10 个顶点交替取外半径/内半径
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
  });
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

// 眼睛不再写死坐标：每帧由 applySlimeShape() 按同一套形变公式摆放，
// 这样压扁/拉长/前倾时眼睛会跟着身体一起动。
const eyes = [];
for (const side of [-1, 1]) {
  const eye = new THREE.Mesh(eyeGeo, eyeMat);
  eye.castShadow = false;
  eye.renderOrder = 3; // 眼睛最后画，避免被半透明外皮盖住
  eye.userData.side = side;

  // 星星盖在眼睛正前方（局部 -Z 是脸朝向）
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
// 眼睛锚点：用"球面上同一高度的正面点"作为参考位置。
// 只写死水平和垂直偏移是不够的——眼睛必须踩在球面上，压扁/拉伸时才不会陷进身体或浮出来。
const eyeAnchorY = SLIME.eyeOffsetY;
const eyeAnchorZ = -Math.sqrt(
  Math.max(SLIME.radius ** 2 - SLIME.eyeOffsetX ** 2 - SLIME.eyeOffsetY ** 2, 0)
); // 球面在 (±eyeOffsetX, eyeOffsetY) 处的 z，负值 = 正面

player.position.set(0, PLAYER_GROUND_Y, 0);

// 出生朝向：让脸（-Z）对着默认相机，第一次打开就能看到眼睛和内核。
// 脸的方向 = (-sin(ry), 0, -cos(ry))，要指向相机方向 (camX, camZ)，
// 所以 rotation.y = atan2(-camX, -camZ)。
// 只设初始值，之后由玩家输入接管（update() 里的朝向插值会覆盖它）。
player.rotation.y = Math.atan2(-camera.position.x, -camera.position.z);

scene.add(player);

// 调试钩子：供 debug-inspect.js 在控制台体检用（不影响游戏逻辑）
window.__SCENE__ = scene;
window.__CAMERA__ = camera;
window.__PLAYER__ = player;
window.__THREE__ = THREE;

// ---------------- 形变状态与形变公式 ----------------
// squash.scale 只表示"竖直缩放比例"，最终由 applySlimeShape() 换算成顶点位移。
// 碰撞半径用的是 CONFIG.playerRadius，与这里完全无关，换模型不会改变手感。
const squash = {
  scale: 1,     // 当前纵向缩放
  velocity: 0,  // 弹簧速度
};

// 给弹簧一个瞬时位移：起跳拉长 / 落地压扁 / 吃到方块弹一下
function squashImpulse(scale) {
  squash.scale = scale;
  squash.velocity = 0;
  // 纵向被砸一下，横向也跟着"鼓"出去（A1）
  const coupling = (scale - 1) * SLIME.wobbleCouple * SLIME.wobbleImpulse;
  wobbleLeft.velocity += coupling;
  wobbleRight.velocity += coupling;
}

// 弹簧固定子步长：显式欧拉在 dt 过大时会发散，这里无论外部给多大 dt，
// 内部都按 1/120 秒切成小步积分，保证数值永远稳定、结果可复现。
const SQUASH_STEP = 1 / 120;

// B2 起跳预压状态：armed = 可以开始新的一次预压（松手后重新武装）
const crouch = { armed: true, timer: 0, scale: 1 };
// C1 压缩变色的当前亮度系数（1 = 原色），由 updateSquash 更新
let squashTint = 1;
// C2 内核挤压量（跟随身体 sy）
const coreSquash = { x: 1, y: 1, z: 1 };

// 形变的两个"关节"：当前值和目标值（只用来做一点点滞后，让身体软塌塌的）
const slimeShape = {
  syLag: 1,        // 滞后的竖直缩放，比弹簧本身慢一点，是"软"的来源
  lean: 0,         // 当前前倾角度（弧度，正 = 朝鼻子方向前倾）
  leanVel: 0,      // 前倾的弹簧速度
  stretch: 0,      // 当前拉伸量（沿前倾方向）
  stretchLag: 0,   // 滞后的拉伸量
};

// ---- A1：横向挤压（两个独立弹簧，x 左 / z 右）----
// 两轴相位不同，落地时会左右晃而不是完美对称，像一袋水
const wobbleLeft = { value: 0, velocity: 0 };   // 影响 x 轴
const wobbleRight = { value: 0, velocity: 0 };  // 影响 z 轴

// ---- A2：顶点颤动 ----
// ripple 是当前波动强度（0~1），由形变偏移量驱动，随时间自然衰减
let rippleStrength = 0;
let ripplePhase = 0;   // 相位累计（秒），避免用绝对时间导致暂停后跳变

// ---- A3：波浪传播 ----
// 环形缓冲保存最近若干帧的 sy，顶部取更早的值 → 形变从脚底往上传
const waveHistory = new Float32Array(SLIME.waveHistoryLen);
waveHistory.fill(1);
let waveWriteIndex = 0;

// 按 h 取"延迟后的 sy"：h=0 用当前值，h=1 用更早的值。
// 延迟量用 waveGain 软化：完全用延迟值会让各高度层的半径差太多、出现盘状折痕。
function delayedSy(syNow, h) {
  const lag = Math.min(h * SLIME.waveLagPerHeight, 0.4); // 最多延迟 0.4 秒
  const framesBack = Math.round(lag * 60);
  if (framesBack <= 0) return syNow;
  const idx = (waveWriteIndex - framesBack + SLIME.waveHistoryLen * 2) % SLIME.waveHistoryLen;
  return syNow + (waveHistory[idx] - syNow) * SLIME.waveGain;
}

// 每一帧把原始球面上的一个点，按当前形变参数换算成形变后的坐标。
// 与 applySlimeShape() 里对顶点做的运算完全一致——只有一份公式，
// 眼睛等挂件才不会和身体脱节。参数都是球心坐标系。
function deformPoint(x0, y0, z0, sy, lean, stretch, opts) {
  const syClamped = sy;
  const sxz = 1 / Math.sqrt(syClamped);
  const h = THREE.MathUtils.clamp(y0 / SLIME.radius * 0.5 + 0.5, 0, 1);

  // ---- A3：波浪传播：用该高度对应的"延迟 sy" ----
  // opts.noWave 为真时跳过（眼睛/内核用实时值，避免它们跟着抖）
  const syAtH = (opts && opts.noWave) ? syClamped : delayedSy(syClamped, h);
  const sxzAtH = 1 / Math.sqrt(Math.max(syAtH, 0.2));

  // ---- A1：横向挤压（两轴独立）----
  const wobX = 1 + wobbleLeft.value * SLIME.wobbleAmount;
  const wobZ = 1 + wobbleRight.value * SLIME.wobbleAmount;

  const spread = SLIME.bulgeBottom * Math.pow(1 - h, 3) + SLIME.bulgeTop * Math.pow(h, 3);
  const widen = sxzAtH * (1 + spread);
  let s = 1 + stretch * h * h;

  // ---- A2：顶点颤动 ----
  // 沿高度方向的正弦波，h 越高相位越靠后，看起来像波浪往上跑
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

// 把一次顶点形变应用到几何体上。
// 只用"从原始顶点出发 + 按 uv 高度做缩放"这一种最笨的算法：
//   横向 = (1/√sy) * (1 + 摊开量)，纵向 = sy，最后沿鼻子方向拉伸、再整体前倾。
// 每个顶点只算一次，不做跨帧累积，所以永远不会漂移。
function applySlimeShape(sy, lean, stretch) {
  // B2：预压期间额外压扁（只在站地上有效，离地后 crouch.scale 一定是 1）
  const syWithCrouch = THREE.MathUtils.clamp(
    sy * THREE.MathUtils.clamp(crouch.scale, 0.6, 1),
    0.35, 1.8
  );
  sy = syWithCrouch;

  const syClamped = THREE.MathUtils.clamp(sy, 0.35, 1.8);
  const stretchClamped = THREE.MathUtils.clamp(stretch, 0, 1.5);

  // 前倾刚度跟着竖直压扁一起缩，避免压扁时转身把身体转到地面以下（穿地）。
  const leanClamped = THREE.MathUtils.clamp(lean, -0.8, 0.8) * syClamped;

  // 视觉脚底贴地：
  //   世界脚底 = player.y + body.y + 几何最低点
  //            = player.y + body.y - radius*baseFlatten*sy
  //   希望它等于 (player.y - PLAYER_GROUND_Y)，即"站立时贴地、跳跃时随 player 抬起"
  //   → body.y = -PLAYER_GROUND_Y + radius*baseFlatten*sy
  // 不能写 -player.y（那样跳起来会被抵消），也不能用几何体自身平移（会被几何体包围盒与
  // Box3 检测、视锥剔除一起影响，查起来极难）。
  slimeBody.position.y = -PLAYER_GROUND_Y + SLIME.radius * SLIME.baseFlatten * syClamped;
  // 描边网格必须跟身体同步这个偏移！它和身体共用几何体，位置一旦不同步，
  // 就会看起来"外皮陷进地里"（描边停在更低的位置，把外皮往下拉/遮住）。
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

    // 兜底：以脚底为界，再极端也不许穿到地面以下
    const footY = -SLIME.radius * syClamped * SLIME.baseFlatten;
    arr[i3] = p.x;
    arr[i3 + 1] = Math.max(p.y, footY);
    arr[i3 + 2] = p.z;
  }

  // 眼睛：用同一套公式算出锚点，但跳过波浪（noWave），否则眼睛会跟着抖，看起来很怪
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
  slimeGeo.computeVertexNormals(); // 形变后法线会变，不重算光照会"假"
  slimeGeo.computeBoundingBox();   // 视锥剔除和 Box3 检测都要用最新的包围盒
  slimeGeo.computeBoundingSphere();
}

// 内核的滞后弹簧 + 脉动更新（需要 dt，所以放在这里而不是 applySlimeShape 里）
// 星星眼淡入淡出（每帧调用，需要 dt）
// 衰减用固定速率：吃到后约 0.7 秒回正常眼，视觉上"闪一下"但不糊。
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
      // 星星随出现放大一点，有"蹦出来"的感觉
      star.scale.setScalar(0.7 + opacity * 0.5);
    }
  }
}

// ---------------- 吃越多越红 ----------------
// 热度 = 本局已吃个数 / heatCount，钳到 0..1。
// 在 HSL 空间插值色相（绿 140 -> 红 0），比直接 lerp RGB 干净得多。
// 同时联动：内核、地面光斑、描边也一起变暖，整个角色"越吃越烫"。
function updateHeatColor(dt) {
  // 目标热度由"本局吃到的个数"决定（score / 10 = 吃到个数）
  const eaten = Math.floor(state.score / 10);
  const target = THREE.MathUtils.clamp(eaten / SLIME.heatCount, 0, 1);
  // 平滑跟随，避免吃到瞬间跳色
  heat += (target - heat) * smooth(SLIME.heatLerpRate, dt);

  // 色相：绿 -> 红（走短路径，140 -> 0 直接下降即可）
  const h = THREE.MathUtils.lerp(SLIME.heatHueGreen, SLIME.heatHueRed, heat);
  const s = THREE.MathUtils.lerp(SLIME.heatSatStart, SLIME.heatSatEnd, heat) / 100;
  const l = THREE.MathUtils.lerp(SLIME.heatLightStart, SLIME.heatLightEnd, heat) / 100;

  // 外皮主色
  _heatColor.setHSL(h / 360, s, l);
  slimeMat.color.copy(_heatColor);

  // 内核：同色相但更亮更白（保持"发光核心"的观感）
  _heatCore.setHSL(h / 360, Math.max(s - 0.15, 0.3), Math.min(l + 0.25, 0.92));
  slimeCoreMat.color.copy(_heatCore);
  // 内核自发光也跟着变（绿光 -> 红光）
  _heatCore.setHSL(h / 360, 0.9, 0.55);
  slimeCoreMat.emissive.copy(_heatCore);

  // 地面透光光斑：比身体更亮一点
  _heatCast.setHSL(h / 360, Math.min(s + 0.1, 0.95), Math.min(l + 0.12, 0.85));
  castLightMat.color.copy(_heatCast);

  // 描边：暗色版本，保持"深色勾边"的观感
  _heatOutline.setHSL(h / 360, Math.min(s + 0.05, 0.9), Math.max(l - 0.42, 0.06));
  slimeOutlineMat.color.copy(_heatOutline);
}

function updateCore(dt, sy, lean, stretch) {
  let coreRemaining = Math.min(dt, 0.1);
  while (coreRemaining > 0) {
    const ch = Math.min(SQUASH_STEP, coreRemaining);
    coreRemaining -= ch;
    // 弹簧拉向 0（身体中心）
    coreLag.velX += (-SLIME.coreLagStiffness * coreLag.x - SLIME.coreLagDamping * coreLag.velX) * ch;
    coreLag.velY += (-SLIME.coreLagStiffness * coreLag.y - SLIME.coreLagDamping * coreLag.velY) * ch;
    coreLag.velZ += (-SLIME.coreLagStiffness * coreLag.z - SLIME.coreLagDamping * coreLag.velZ) * ch;
    coreLag.x += coreLag.velX * ch;
    coreLag.y += coreLag.velY * ch;
    coreLag.z += coreLag.velZ * ch;
  }

  // 夹紧 + 静止归位：不允许飘出身体，也不会永远微抖
  coreLag.x = THREE.MathUtils.clamp(coreLag.x, -0.35, 0.35);
  coreLag.y = THREE.MathUtils.clamp(coreLag.y, -0.35, 0.35);
  coreLag.z = THREE.MathUtils.clamp(coreLag.z, -0.35, 0.35);
  if (Math.abs(coreLag.x) < 0.0005 && Math.abs(coreLag.velX) < 0.01) { coreLag.x = 0; coreLag.velX = 0; }
  if (Math.abs(coreLag.y) < 0.0005 && Math.abs(coreLag.velY) < 0.01) { coreLag.y = 0; coreLag.velY = 0; }
  if (Math.abs(coreLag.z) < 0.0005 && Math.abs(coreLag.velZ) < 0.01) { coreLag.z = 0; coreLag.velZ = 0; }

  // 身体中心在形变后的位置（用 deformPoint 算，和外皮完全一致）
  // 内核跳过波浪：它自己已经有滞后弹簧，再叠波会抖得不像话
  const coreHome = deformPoint(0, 0, 0, sy, lean, stretch, { noWave: true });
  slimeCore.position.set(
    coreHome.x + coreLag.x,
    coreHome.y + coreLag.y,
    coreHome.z + coreLag.z
  );

  // 吃到方块时给内核一点脉动（亮一下、胀一下），随时间衰减
  corePulse = Math.max(0, corePulse - SLIME.corePulseDecay * dt);
  const pulse = THREE.MathUtils.clamp(corePulse, 0, 1);
  // C2：内核跟随身体挤压（coreSquash 由 updateSquash 更新），再叠加吃到方块时的脉动
  slimeCore.scale.set(
    coreSquash.x * (1 + pulse * 0.35),
    coreSquash.y * (1 + pulse * 0.35),
    coreSquash.z * (1 + pulse * 0.35)
  );
  slimeCoreMat.emissiveIntensity = SLIME.coreIntensity * (1 + pulse * 1.2);
}

// 每帧：弹簧 → 平滑后的竖直缩放 → 前倾弹簧 → 应用到顶点。
// speed01 由 update() 传入（0 = 静止，1 = 全速），不在外面硬编码。
function updateSquash(dt, speed01, isForward) {
  const k = JUICE.squashStiffness;
  const c = JUICE.squashDamping;

  // 防御：异常大的 dt（切后台、断点调试）最多积分 0.1 秒
  let remaining = Math.min(dt, 0.1);
  while (remaining > 0) {
    const h = Math.min(SQUASH_STEP, remaining);
    remaining -= h;
    squash.velocity += (-k * (squash.scale - 1) - c * squash.velocity) * h;
    squash.scale += squash.velocity * h;
  }

  // 足够接近静止就归位，避免永远微抖
  if (Math.abs(squash.scale - 1) < 0.0008 && Math.abs(squash.velocity) < 0.01) {
    squash.scale = 1;
    squash.velocity = 0;
  }

  // 夹紧，兜底：即使前面全错了也不会出现负缩放或爆炸
  const sy = THREE.MathUtils.clamp(squash.scale, 0.35, 1.8);

  // 视觉层的滞后：身体比弹簧慢一点点跟上，产生"软"的感觉
  const lagT = smooth(SLIME.lagRate, dt);
  slimeShape.syLag += (sy - slimeShape.syLag) * lagT;

  // ---- 前倾拉伸 ----
  // 目标前倾角：全速前进时最大；后退时只是轻轻后仰。
  const leanTarget = isForward
    ? SLIME.leanMax * speed01
    : -SLIME.backLean * speed01;
  const leanT = smooth(SLIME.leanLag, dt);
  slimeShape.lean += (leanTarget - slimeShape.lean) * leanT;

  const stretchTarget = SLIME.stretchMax * speed01;
  slimeShape.stretchLag += (stretchTarget - slimeShape.stretchLag) * lagT;

  // 统一钳位，防止未来参数调错导致几何体翻掉
  const lean = THREE.MathUtils.clamp(slimeShape.lean, -0.8, 0.8);
  const stretch = THREE.MathUtils.clamp(slimeShape.stretchLag, 0, 1.5);

  // 两者混合：70% 实时 + 30% 滞后
  const syFinal = sy * 0.7 + slimeShape.syLag * 0.3;

  // ---- A1：横向弹簧积分（x / z 两个方向独立）----
  let wobRemaining = Math.min(dt, 0.1);
  while (wobRemaining > 0) {
    const wh = Math.min(SQUASH_STEP, wobRemaining);
    wobRemaining -= wh;
    wobbleLeft.velocity += (-SLIME.wobbleStiffness * wobbleLeft.value - SLIME.wobbleDamping * wobbleLeft.velocity) * wh;
    wobbleRight.velocity += (-SLIME.wobbleStiffness * wobbleRight.value - SLIME.wobbleDamping * wobbleRight.velocity) * wh;
    wobbleLeft.value += wobbleLeft.velocity * wh;
    wobbleRight.value += wobbleRight.velocity * wh;
  }
  // 夹紧 + 静止归位，避免无限微抖或把身体撑爆
  wobbleLeft.value = THREE.MathUtils.clamp(wobbleLeft.value, -1.2, 1.2);
  wobbleRight.value = THREE.MathUtils.clamp(wobbleRight.value, -1.2, 1.2);
  if (Math.abs(wobbleLeft.value) < 0.0008 && Math.abs(wobbleLeft.velocity) < 0.01) { wobbleLeft.value = 0; wobbleLeft.velocity = 0; }
  if (Math.abs(wobbleRight.value) < 0.0008 && Math.abs(wobbleRight.velocity) < 0.01) { wobbleRight.value = 0; wobbleRight.velocity = 0; }

  // ---- A2：颤动强度由"形变偏离静止的程度"驱动，自然衰减 ----
  // sy 离 1 越远，波动越强：落地瞬间最强，然后衰减
  const deviation = Math.abs(syFinal - 1);
  const rippleTarget = THREE.MathUtils.clamp(deviation * 2.2, 0, 1);
  // 取较大值：形变发生时立刻起振，之后按衰减速率回落
  rippleStrength = Math.max(rippleStrength, rippleTarget);
  rippleStrength = Math.max(0, rippleStrength - SLIME.rippleDecay * dt);
  ripplePhase = (ripplePhase + dt * SLIME.rippleFrequency) % 1000; // 累计相位，避免时间跳变

  // ---- A3：把当前 sy 写入环形缓冲，供各高度取"延迟值" ----
  waveWriteIndex = (waveWriteIndex + 1) % SLIME.waveHistoryLen;
  waveHistory[waveWriteIndex] = syFinal;

  applySlimeShape(syFinal, lean, stretch);

  // ---- 吃越多越红（独立于 C1 的压缩变色）----
  // 每帧在这里更新一次外皮颜色；C1 只改 emissiveIntensity/opacity，不会覆盖这里的 color。
  updateHeatColor(dt);

  // ---- C1：压缩变色 ----
  // 身体越扁，颜色越浅（emissive 提亮、清漆更亮），像果冻被挤压透光。
  // sy=1 时保持原色，偏离越大变化越明显。
  const squash01 = THREE.MathUtils.clamp(Math.abs(syFinal - 1) * 2, 0, 1);
  const tintTarget = 1 - squash01 * JUICE.squashTintAmount;
  squashTint += (tintTarget - squashTint) * smooth(JUICE.squashTintRate, dt);
  slimeMat.emissiveIntensity = SLIME.emissiveIntensity * (1 + squash01 * JUICE.squashTintAmount * 1.6);
  slimeMat.opacity = THREE.MathUtils.clamp(
    SLIME.opacity * (0.85 + squashTint * 0.15), 0.3, 1
  );

  // ---- C2：内核跟随挤压 ----
  // 身体压扁时内核变扁（横向变宽），拉长时变高，和身体同步。
  // 只跟随一部分（coreSquashFollow），否则内核会像被压扁的橡皮泥一样失去"里子"感。
  const followY = THREE.MathUtils.lerp(1, syFinal, JUICE.coreSquashFollow);
  const followXZ = 1 / Math.sqrt(Math.max(followY, 0.3));
  const cs = smooth(JUICE.coreSquashRate, dt);
  coreSquash.y += (followY - coreSquash.y) * cs;
  coreSquash.x += (followXZ - coreSquash.x) * cs;
  coreSquash.z += (followXZ - coreSquash.z) * cs;

  // 内核的滞后跟随与脉动（需要 dt，所以放在这里；内部会重新算形变后的身体中心）
  updateCore(dt, syFinal, lean, stretch);
}

// ---------------- 连击 ----------------
// 规则（最笨最好懂）：
//   在 comboWindow 秒内吃到下一个方块 -> 连击 +1，计时重置
//   超时 -> 连击归零
//   倍率 = min(1 + floor((combo - 1) / comboPerTier), comboMaxMult)
//      combo 1     -> x1
//      combo 3-4   -> x2
//      combo 5-6   -> x3 ...
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

// 每帧推进连击计时（放在 update 里调用）
function updateCombo(dt) {
  if (state.combo <= 0) return;
  state.comboTimer -= dt;
  if (state.comboTimer <= 0) {
    state.combo = 0;
    state.comboTimer = 0;
    updateComboHud();   // 断连后隐藏 HUD
  }
}


const state = {
  running: false,
  score: 0,
  timeLeft: CONFIG.roundSeconds,
  best: 0,
  // ---- 连击 ----
  combo: 0,           // 当前连击数（连续吃到方块的个数）
  comboTimer: 0,      // 连击剩余时间（秒），归零就断连
  maxCombo: 0,        // 本局最高连击（结算展示）
};

const pickups = [];
const pickupGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
const pickupMat = new THREE.MeshStandardMaterial({
  color: 0xffcf5c,
  emissive: 0xff9f1c,
  emissiveIntensity: 0.6,
  roughness: 0.3,
});

// ---------------- 粒子（吃到方块时炸开的小碎片）----------------
// 用一个固定大小的对象池：预创建 N 个网格，用完隐藏，不在运行时 new。
// 这样没有 GC 抖动，也不会因为粒子爆炸式增长拖慢帧率。
const PARTICLE = {
  poolSize: 48,          // 池子大小（同时存在的上限）
  perBurst: 8,           // 每次炸开几个
  life: 0.55,            // 存活时间（秒）
  speed: 3.4,            // 初速度
  gravity: -9,           // 粒子重力
  size: 0.16,            // 初始大小
  color: 0xffd76a,       // 粒子颜色（与方块同色系）
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
    const m = new THREE.Mesh(particleGeo, mat.clone()); // 每个独立材质，才能单独淡出
    m.visible = false;
    m.userData.life = 0;
    m.userData.vx = 0; m.userData.vy = 0; m.userData.vz = 0;
    m.userData.spin = 0;
    scene.add(m);
    particles.push(m);
  }
}

// 在指定位置炸开一簇粒子
function spawnParticles(x, y, z, count) {
  let spawned = 0;
  for (const p of particles) {
    if (p.visible) continue;          // 池子里的这个还在用
    // 均匀分布在一圈上（加一点随机抖动，避免太规整）
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

// 每帧推进所有粒子
function updateParticles(dt) {
  for (const p of particles) {
    if (!p.visible) continue;
    p.userData.life -= dt;
    if (p.userData.life <= 0) { p.visible = false; continue; }

    p.userData.vy += PARTICLE.gravity * dt;
    p.position.x += p.userData.vx * dt;
    p.position.y += p.userData.vy * dt;
    p.position.z += p.userData.vz * dt;

    // 地面反弹一下（只弹一次，速度衰减）
    if (p.position.y < 0.08) {
      p.position.y = 0.08;
      p.userData.vy = Math.abs(p.userData.vy) * 0.35;
      p.userData.vx *= 0.7;
      p.userData.vz *= 0.7;
    }

    p.rotation.x += p.userData.spin * dt;
    p.rotation.z += p.userData.spin * dt * 0.7;

    const k = p.userData.life / PARTICLE.life;   // 1 -> 0
    p.material.opacity = k;
    p.scale.setScalar(0.4 + k * 0.8);
  }
}

// ---------------- 拾取物光晕：固定数量的点光源池 ----------------
// 动态增删光源会让 shader 重新编译、卡顿，所以固定创建几盏，
// 每帧把最近的几个方块的位置/颜色同步到灯上，其余的灯亮度设为 0。
const pickupGlows = [];
for (let i = 0; i < LIGHT.glowCount; i++) {
  const light = new THREE.PointLight(LIGHT.glowColor, 0, LIGHT.glowDistance, 2);
  light.position.set(0, -100, 0); // 先藏在场景外
  scene.add(light);
  pickupGlows.push(light);
}

// 每个灯当前跟随的方块（用于检测换目标，避免每帧重算）
const glowTargets = new Array(LIGHT.glowCount).fill(null);

function updatePickupGlows() {
  // 收集还活着的方块，按到玩家的距离排序，取最近的前 N 个
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
    // 越近越亮：12 单位内从满强度渐变到 35%，再远的也被最近几个替掉了
    const near = THREE.MathUtils.clamp(1 - item.d / 12, 0.35, 1);
    light.position.copy(item.mesh.position);
    // 略高于方块，光从上方散下来，地面上的光斑更好看
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
    // 每个方块一份独立材质：爆开时要单独改 opacity，不能共用同一份
    const mat = pickupMat.clone();
    mat.transparent = true;

    const m = new THREE.Mesh(pickupGeo, mat);
    m.position.set(
      THREE.MathUtils.randFloat(-half, half),
      0.5,
      THREE.MathUtils.randFloat(-half, half)
    );
    m.castShadow = true;
    m.userData.phase = Math.random() * Math.PI * 2; // 让每个方块上下浮动错开
    m.userData.alive = true;
    m.userData.popT = null;   // 爆开计时：null 表示没在爆开
    m.userData.popDirX = 0;   // 爆开方向（单位向量，水平）
    m.userData.popDirZ = 0;
    m.userData.popX0 = 0;     // 爆开起点
    m.userData.popZ0 = 0;
    m.userData.popY0 = 0;
    m.renderOrder = 1;        // 爆开的半透明方块画在主角之后，不会盖住史莱姆
    scene.add(m);
    pickups.push(m);
  }
}
spawnPickups();

// ---------------- 输入 ----------------
const keys = new Set();
const keyMap = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
};

let debugOn = true;
const upAxis = new THREE.Vector3(0, 1, 0); // 复用，避免每帧 new
const tmpOffset = new THREE.Vector3();     // 捏合缩放用的临时向量

// 与帧率无关的平滑系数：rate 越大跟得越快。
// 全项目有 8 处用 `1 - Math.exp(-rate * dt)`，统一成一个函数避免写错符号。
function smooth(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

addEventListener('keydown', (e) => {
  initAudio();   // 浏览器要求用户交互后才能出声，第一次按键时创建 AudioContext
  const k = keyMap[e.code];
  if (k) {
    keys.add(k);
    e.preventDefault(); // 防止空格滚动页面
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

// ---------------- 触屏虚拟摇杆 ----------------
// 设计（解决手机上的三个实际问题）：
//   1. 摇杆固定在左下角，不再"点哪算哪"——之前左半屏既转视角又走路，完全没法玩
//   2. 摇杆区是独立的 DOM 层，pointerdown 里 stopPropagation，
//      OrbitControls 收不到事件，视角就不会跟着转
//   3. 双指捏合缩放镜头（手机没有滚轮）
// 输出到 touchMove = { x, y }（-1..1，屏幕空间），由 getMoveDirection 读取。
const joystick = {
  active: false,
  pointerId: null,
  originX: 0, originY: 0,   // 摇杆中心（固定位置，不是按下点）
  x: 0, y: 0,               // 当前偏移归一化 -1..1
  maxRadius: 56,            // 摇杆最大半径（像素）
};

// 触屏移动方向（屏幕空间），null = 没在摇杆上
let touchMove = null;

// 是否触屏设备（用于显示虚拟控件）
const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

const canvasEl = renderer.domElement;

// 摇杆的固定中心：左下角留出边距
function joystickCenter() {
  return { x: 110, y: window.innerHeight - 110 };
}

function updateJoystickVisual() {
  const base = document.getElementById('joystick');
  const knob = document.getElementById('joystick-knob');
  if (!base || !knob) return;
  const c = joystickCenter();
  base.style.left = c.x + 'px';
  base.style.top = c.y + 'px';
  base.style.opacity = joystick.active ? '0.6' : '0.32';
  knob.style.transform =
    `translate(-50%, -50%) translate(${joystick.x * joystick.maxRadius}px, ${joystick.y * joystick.maxRadius}px)`;
}

// ---- 摇杆层：独立 DOM，事件不冒泡到 canvas ----
const joystickEl = document.getElementById('joystick');
if (joystickEl) {
  joystickEl.addEventListener('pointerdown', (e) => {
    initAudio();
    // 关键：阻止冒泡，否则 OrbitControls 会同时开始旋转视角
    e.preventDefault();
    e.stopPropagation();
    const c = joystickCenter();
    joystick.active = true;
    joystick.pointerId = e.pointerId;
    joystick.originX = c.x;
    joystick.originY = c.y;
    joystick.x = 0; joystick.y = 0;
    touchMove = { x: 0, y: 0 };
    try { joystickEl.setPointerCapture(e.pointerId); } catch (_) { /* 某些浏览器不支持 */ }
    updateJoystickVisual();
  }, { passive: false });

  joystickEl.addEventListener('pointermove', (e) => {
    if (!joystick.active || e.pointerId !== joystick.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - joystick.originX;
    const dy = e.clientY - joystick.originY;
    const len = Math.hypot(dx, dy);
    // 超出半径时钳到圆上（摇杆不会"越拉越远"）
    const clamped = len > joystick.maxRadius ? joystick.maxRadius / len : 1;
    joystick.x = (dx * clamped) / joystick.maxRadius;
    joystick.y = (dy * clamped) / joystick.maxRadius;
    touchMove = { x: joystick.x, y: joystick.y };
    updateJoystickVisual();
  }, { passive: false });

  const endJoystick = (e) => {
    if (!joystick.active) return;
    if (e && e.pointerId !== undefined && e.pointerId !== joystick.pointerId) return;
    joystick.active = false;
    joystick.pointerId = null;
    joystick.x = 0; joystick.y = 0;
    touchMove = null;
    updateJoystickVisual();
  };
  joystickEl.addEventListener('pointerup', endJoystick);
  joystickEl.addEventListener('pointercancel', endJoystick);
  joystickEl.addEventListener('lostpointercapture', endJoystick);

  if (isTouch) {
    document.body.classList.add('is-touch');
    updateJoystickVisual();
    addEventListener('resize', updateJoystickVisual);
  }
}

// ---- 双指捏合缩放 ----
// 手机没有滚轮，OrbitControls 的 wheel 处理用不上，这里单独实现。
// 直接改相机到 target 的距离，效果等价于缩放。
const pinch = { active: false, lastDist: 0 };

function touchDist(t1, t2) {
  return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

canvasEl.addEventListener('touchstart', (e) => {
  initAudio();
  if (e.touches.length === 2) {
    pinch.active = true;
    pinch.lastDist = touchDist(e.touches[0], e.touches[1]);
    // 捏合期间关掉 OrbitControls，双保险：
    // 即使它的指针状态管理有遗漏，也不可能在缩放时转动视角。
    controls.enabled = false;
    e.preventDefault();
  }
}, { passive: false });

canvasEl.addEventListener('touchmove', (e) => {
  if (!pinch.active || e.touches.length !== 2) return;
  e.preventDefault();
  e.stopPropagation();
  const d = touchDist(e.touches[0], e.touches[1]);
  if (pinch.lastDist > 0 && d > 0) {
    const ratio = pinch.lastDist / d;   // 手指张开 → ratio < 1 → 拉近
    const offset = tmpOffset.subVectors(camera.position, controls.target);
    let len = offset.length() * ratio;
    len = THREE.MathUtils.clamp(len, controls.minDistance, controls.maxDistance);
    offset.setLength(len);
    camera.position.copy(controls.target).add(offset);
  }
  pinch.lastDist = d;
}, { passive: false });

canvasEl.addEventListener('touchend', (e) => {
  if (e.touches.length < 2 && pinch.active) {
    pinch.active = false;
    // 手指抬到只剩一根（或零根）时恢复相机控制
    controls.enabled = true;
  }
}, { passive: true });


// 跳跃按钮
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

// 触屏设备上隐藏键盘提示、显示虚拟控件
if (isTouch) {
  document.body.classList.add('is-touch');
}

// ---------------- UI ----------------
const ui = {
  score: document.getElementById('score'),
  time: document.getElementById('time'),
  comboRow: document.getElementById('combo-row'),
  combo: document.getElementById('combo'),
  overlay: document.getElementById('overlay'),
  hint: document.getElementById('hint'),
  loading: document.getElementById('loading'),
};

// 更新连击 HUD：没连击时整行隐藏，有连击时显示"x倍率 (连击数)"
function updateComboHud() {
  if (!ui.comboRow || !ui.combo) return;
  if (state.combo >= 2) {
    ui.comboRow.style.display = '';
    ui.combo.textContent = `x${getComboMultiplier()} (${state.combo})`;
    // 倍率越高颜色越暖
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

// ---------------- 玩法逻辑 ----------------
const velocity = new THREE.Vector3();
let onGround = true;
const clock = new THREE.Clock();

const tmpDir = new THREE.Vector3();
const camForward = new THREE.Vector3();
const camRight = new THREE.Vector3();

// 相机相对移动：W 永远是"往屏幕里走"
function getMoveDirection() {
  // 注意方向：玩家 → 相机 是"屏幕外"，取反才是"往屏幕里"。
  // 之前写反了，导致 W/S、A/D 同时镜像颠倒。
  camForward.subVectors(player.position, camera.position);
  camForward.y = 0;
  camForward.normalize();

  // 右手系 Y 朝上时，forward × up 正好是屏幕右方，所以 D 用 +camRight
  camRight.crossVectors(camForward, upAxis).normalize();

  tmpDir.set(0, 0, 0);

  // 触屏摇杆优先：它是连续方向，可以斜着走
  if (touchMove && (Math.abs(touchMove.x) > 0.12 || Math.abs(touchMove.y) > 0.12)) {
    tmpDir.addScaledVector(camRight, touchMove.x);      // 摇杆向右 = 屏幕右
    tmpDir.addScaledVector(camForward, -touchMove.y);   // 摇杆向上（y为负）= 往屏幕里
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

// ---------------- 每帧更新 ----------------
// 拆成职责单一的小函数，update() 只负责按顺序调度。
// 这样每个子系统（计时/移动/跳跃/碰撞/拾取/视觉）都能单独读懂、单独改。

// 计时 + 最后一秒的滴答声
function updateTimer(dt) {
  state.timeLeft = Math.max(0, state.timeLeft - dt);
  updateCombo(dt);   // 连击计时：超时断连

  // 最后 5 秒每秒滴答一声（用"整秒变化"判断，避免每帧都响）
  const sec = Math.ceil(state.timeLeft);
  if (sec !== state.lastTickSecond) {
    state.lastTickSecond = sec;
    if (sec > 0 && sec <= 5) playSound('tick', 1 + (5 - sec) * 0.08); // 越接近越急促
  }

  if (state.timeLeft <= 0) endRound();
}

// 水平移动：指数趋近目标速度，起步有推力、松键有惯性
function updateHorizontalMove(dt, dir) {
  const targetVX = dir.x * CONFIG.moveSpeed;
  const targetVZ = dir.z * CONFIG.moveSpeed;
  const approach = smooth(JUICE.accelRate, dt);
  velocity.x += (targetVX - velocity.x) * approach;
  velocity.z += (targetVZ - velocity.z) * approach;
}

// 前进/后退判定：给"前倾拉伸"用
function computeSpeedRatio() {
  const speed01 = THREE.MathUtils.clamp(
    Math.hypot(velocity.x, velocity.z) / CONFIG.moveSpeed, 0, 1
  );
  let isForward = true;
  if (speed01 > 0.01) {
    // 脸的朝向是 -Z 经过 rotation.y 旋转后的方向
    const faceX = -Math.sin(player.rotation.y);
    const faceZ = -Math.cos(player.rotation.y);
    const dot = (velocity.x * faceX + velocity.z * faceZ) / Math.hypot(velocity.x, velocity.z);
    isForward = dot >= 0;
  }
  return { speed01, isForward };
}

// 跳跃 + 重力。
// B2 起跳预压：按下跳跃先蹲一下，蹲到底才真正起跳（蓄力感）。
// crouch.armed=true 表示"可以开始新的一次预压"（松手后重新武装）。
function updateJumpAndGravity(dt) {
  const jumpDown = keys.has('jump') && onGround;
  if (jumpDown) {
    if (crouch.armed) {
      crouch.armed = false;             // 刚按下：进入下蹲
      crouch.timer = JUICE.jumpCrouchTime;
    }
    crouch.timer -= dt;
    if (crouch.timer <= 0) {
      // 蹲够了，真正起跳
      velocity.y = CONFIG.jumpSpeed;
      onGround = false;
      squashImpulse(JUICE.jumpStretch);
      playSound('jump');
      crouch.armed = true;
      crouch.timer = 0;
      crouch.scale = 1;
    } else {
      // 预压期间的蹲下量：smoothstep 从 1 压到 jumpCrouchSquash
      const progress = 1 - crouch.timer / JUICE.jumpCrouchTime;
      const eased = progress * progress * (3 - 2 * progress);
      crouch.scale = THREE.MathUtils.lerp(1, JUICE.jumpCrouchSquash, eased);
    }
  } else {
    // 松开或离地：取消未完成的预压，重新武装
    crouch.armed = true;
    crouch.timer = 0;
    crouch.scale = 1;
  }

  velocity.y += CONFIG.gravity * dt;
}

// 积分 + 地面碰撞 + 场地边界
function updateCollision(dt, wasGrounded) {
  player.position.addScaledVector(velocity, dt);

  if (player.position.y <= PLAYER_GROUND_Y) {
    const impact = Math.abs(velocity.y); // 落地瞬间的向下速度
    player.position.y = PLAYER_GROUND_Y;
    velocity.y = 0;
    onGround = true;
    // 只在"从空中落下"这一帧触发，站着不动不会反复挤压
    if (!wasGrounded) {
      const amount = Math.min(impact / JUICE.landImpactRef, 1);
      squashImpulse(1 - (JUICE.landSquashMin + (JUICE.landSquashMax - JUICE.landSquashMin) * amount));
      // 落得越重，音越低越响
      playSound('land', 0.8 + (1 - amount) * 0.5);
    }
  }

  const lim = CONFIG.levelSize * 0.5 - 1;
  player.position.x = THREE.MathUtils.clamp(player.position.x, -lim, lim);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -lim, lim);
}

// 吃掉一个方块的全部结算：分数、连击、音效、粒子、各种视觉反馈
function onPickupEaten(m, dx, dz, len) {
  m.userData.alive = false;
  m.userData.popT = 0;
  // 炸开方向：从玩家指向方块的水平方向（远离玩家），这样永远不会盖住主角
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
  state.score += 10 * mult;
  ui.score.textContent = state.score;
  updateComboHud();
  // 音高随倍率升高，连击越猛声音越亮
  playSound('eat', 1 + (mult - 1) * 0.12);
  spawnParticles(m.position.x, m.position.y, m.position.z, PARTICLE.perBurst);
  squashImpulse(JUICE.eatPulse); // 吃到时自己也弹一下
  corePulse = 1;                 // 内核亮一下
  starEyes = 1;                  // 眼睛变星星
  // 内核被"吸"向方块：给滞后弹簧一个朝方块的初始速度
  coreLag.velX = (dx / (len || 1)) * 1.2;
  coreLag.velZ = (dz / (len || 1)) * 1.2;
}

// 收集物：浮动 + 碰撞 + 爆开动画
function updatePickups(dt) {
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
        onPickupEaten(m, dx, dz, Math.hypot(dx, dz));
      }
      continue;
    }

    // 炸开：沿 popDir 越飞越远，同时缩小 + 淡出（线性，最笨也最稳）
    if (m.userData.popT === null) continue;
    m.userData.popT += dt;
    const k = Math.min(m.userData.popT / JUICE.popSeconds, 1);
    const ease = 1 - (1 - k) * (1 - k); // easeOutQuad：先快后慢

    m.position.x = m.userData.popX0 + m.userData.popDirX * JUICE.popDistance * ease;
    m.position.z = m.userData.popZ0 + m.userData.popDirZ * JUICE.popDistance * ease;
    m.position.y = m.userData.popY0 + 0.35 * ease; // 往上飘一点
    m.scale.setScalar(JUICE.popScale * (1 - k * k));
    m.material.opacity = 1 - k;
    m.rotation.y += dt * 8;

    if (k >= 1) {
      m.userData.popT = null;
      m.visible = false;
      m.scale.setScalar(1);      // 复位，下次重铺还能直接用
      m.material.opacity = 1;
    }
  }

  // 全吃光就重新铺一局（要等爆开动画播完，不能打断）
  if (pickups.every((m) => !m.userData.alive && m.userData.popT === null)) spawnPickups();
}

// 视觉层：地面光斑、朝向、身体形变
function updateVisuals(dt, dir, speed01, isForward) {
  // 透光地面光斑：跟随玩家，保持圆形
  castLight.position.x = player.position.x;
  castLight.position.z = player.position.z;
  // 跳得越高越散越淡
  const jumpH = Math.max(0, player.position.y - PLAYER_GROUND_Y);
  const castSpread = 1 + jumpH * 0.4;
  const castFade = THREE.MathUtils.clamp(1 - jumpH * 0.5, 0.2, 1);
  castLightMat.opacity = SLIME.castOpacity * castFade;
  castLight.scale.set(castSpread, castSpread, 1);

  // 朝向：让脸指向移动方向
  if (dir.lengthSq() > 0.001) {
    const targetAngle = Math.atan2(dir.x, dir.z); // 注意：模型朝向 -Z
    player.rotation.y = lerpAngle(player.rotation.y, targetAngle + Math.PI, smooth(JUICE.turnRate, dt));
  }

  // 把这一帧的运动状态交给视觉层（前倾拉伸用）
  updateSquash(dt, speed01, isForward);
}

function update(dt) {
  if (!state.running) return;

  updateTimer(dt);

  const dir = getMoveDirection();
  updateHorizontalMove(dt, dir);
  const { speed01, isForward } = computeSpeedRatio();

  updateJumpAndGravity(dt);

  const wasGrounded = onGround;
  updateCollision(dt, wasGrounded);

  updateVisuals(dt, dir, speed01, isForward);
  updatePickups(dt);
}

// 角度插值（处理 -π/π 跨越）
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
  state.lastTickSecond = Math.ceil(CONFIG.roundSeconds);  // 滴答声用的"上一秒"
  state.combo = 0;           // 连击复位
  state.comboTimer = 0;
  state.maxCombo = 0;
  ui.score.textContent = '0';
  updateComboHud();
  playSound('start');
  player.position.set(0, PLAYER_GROUND_Y, 0);
  velocity.set(0, 0, 0);
  squash.scale = 1;          // 复位动效状态，避免上一局残留
  squash.velocity = 0;
  slimeShape.syLag = 1;
  slimeShape.lean = 0;
  slimeShape.leanVel = 0;
  slimeShape.stretch = 0;
  slimeShape.stretchLag = 0;
  coreLag.x = coreLag.y = coreLag.z = 0;      // 内核滞后弹簧也复位
  coreLag.velX = coreLag.velY = coreLag.velZ = 0;
  corePulse = 0;
  starEyes = 0;                              // 星星眼复位
  starMat.opacity = 0;
  for (const eye of eyes) { if (eye.userData.star) eye.userData.star.visible = false; }
  heat = 0;                                  // 热度复位（立刻变回绿色，不等平滑）
  updateHeatColor(1);                        // 传 dt=1 让平滑一步到位
  // A1/A2/A3 的动效状态也复位，避免上一局的晃动/颤动带入新一局
  wobbleLeft.value = 0; wobbleLeft.velocity = 0;
  wobbleRight.value = 0; wobbleRight.velocity = 0;
  rippleStrength = 0;
  ripplePhase = 0;
  waveHistory.fill(1);
  waveWriteIndex = 0;
  // B2/C1/C2 状态复位
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

// ---------------- 横屏适配 ----------------
// 目标：手机上尽量横屏玩。
//   1. 点开始时尝试 全屏 + screen.orientation.lock('landscape')
//      —— 成功的话手机直接转横屏且无状态栏；失败（iOS Safari 不支持）就忽略，不影响游戏
//   2. 竖屏时显示半透明提示层，但【不完全挡住】游戏，玩家仍可继续玩
const rotateHint = document.getElementById('rotate-hint');

function isPortrait() {
  return window.innerHeight > window.innerWidth;
}

function updateRotateHint() {
  if (!rotateHint) return;
  // 只在触屏设备 + 竖屏时提示；桌面上窗口变窄不该弹这个
  const show = isTouch && isPortrait();
  rotateHint.style.display = show ? 'flex' : 'none';
}

// 尝试锁定横屏。必须在用户手势（点击）里调用，否则浏览器会拒绝。
async function tryLockLandscape() {
  if (!isTouch) return;
  try {
    const el = document.documentElement;
    // 先全屏（部分浏览器要求全屏才能锁方向）
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
    }
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch (e) {
    // 不支持或被拒绝：完全忽略，靠竖屏提示兜底
  }
}

addEventListener('orientationchange', () => {
  // 方向变化后布局尺寸要过一小会儿才更新，延迟再算
  setTimeout(updateRotateHint, 120);
});
addEventListener('resize', updateRotateHint);
updateRotateHint();

ui.overlay.addEventListener('click', () => {
  initAudio();
  // 先尝试横屏（必须在这个用户手势的调用栈里）
  tryLockLandscape();
  if (!state.running) startRound();
});
// 触屏设备上，摇杆第一次按下也补一次尝试（万一玩家跳过了开始遮罩）
if (joystickEl) {
  joystickEl.addEventListener('pointerdown', () => { tryLockLandscape(); }, { once: true });
}

// ---------------- 主循环 ----------------
function animate() {
  const dt = Math.min(clock.getDelta(), 1 / 30); // 掉帧时限制单帧步长，防止穿模

  update(dt);
  if (!state.running) updateSquash(dt, 0, true); // 非进行中也让弹簧/前倾自然回位
  updatePickupGlows(); // 方块光晕：固定灯数轮换最近的方块，不触发 shader 重编译
  updateParticles(dt); // 吃到方块炸开的碎片
  updateStarEyes(dt);  // 星星眼淡出

  // 描边：屏幕空间方案只需要屏幕高度（像素）。窗口尺寸变化时这里会跟着更新。
  outlineUniforms.uResolutionY.value = window.innerHeight * renderer.getPixelRatio();

  // 相机始终看向玩家
  controls.target.lerp(player.position, smooth(JUICE.cameraFollowRate, dt));

  if (state.running) {
    ui.time.textContent = state.timeLeft.toFixed(1);
  }

  controls.update();

  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

// ---------------- 窗口自适应 ----------------
addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------- 开场 ----------------
ui.loading.classList.add('hidden');
showOverlay('PiPaBiBa', [
  `Eat as many cubes as you can in ${CONFIG.roundSeconds} seconds.`,
]);
