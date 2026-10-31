// 最小 OrbitControls 实现（替代 three/addons 的版本）
//
// 为什么自己写：项目需要离线可用，而 three 官方 addon 需要单独下载。
// 这里只实现本项目实际用到的功能，行为与官方版保持一致：
//   - 左键拖动 = 绕 target 旋转（球坐标）
//   - 滚轮 = 缩放距离
//   - 阻尼（enableDamping + dampingFactor）
//   - maxPolarAngle / minDistance / maxDistance 限制
//   - target 跟随
//
// 不支持：平移、触摸手势、键盘控制（本项目没用到，需要时再补）。
// 官方版约 1500 行，这里约 150 行——因为只覆盖用到的部分，而不是全部。

import * as THREE from 'three';

const STATE = { NONE: -1, ROTATE: 0 };

export class OrbitControls {
  constructor(object, domElement) {
    this.object = object;
    this.domElement = domElement;

    // target：相机环绕的中心
    this.target = new THREE.Vector3();

    // 阻尼
    this.enableDamping = false;
    this.dampingFactor = 0.05;

    // 限制
    this.minDistance = 1;
    this.maxDistance = Infinity;
    this.minPolarAngle = 0;
    this.maxPolarAngle = Math.PI;
    this.enableZoom = true;
    this.zoomSpeed = 1.0;
    this.rotateSpeed = 1.0;

    this.enabled = true;

    // 内部球坐标（相对 target）
    this._spherical = new THREE.Spherical();
    this._sphericalDelta = new THREE.Spherical(0, 0, 0);
    this._scale = 1;
    this._state = STATE.NONE;

    // 指针追踪：区分单指拖动与多指捏合。
    // 触摸设备上每根手指都有独立的 pointerId，必须记录集合才能判断当前是几指操作。
    this._activePointers = new Set();
    this._pointerId = null;

    // 单指按下后的"观察期"（毫秒）：这期间先不旋转，等着看会不会有第二根手指。
    // 双指手势两指几乎同时落下，80ms 足够识别；单指拖动则只延迟一帧左右，感觉不到。
    this.multiTouchDelay = 80;
    this._awaitMultiTouch = false;
    this._pendingPointerId = null;
    this._pendingSince = 0;

    // 鼠标位置
    this._pointerStart = new THREE.Vector2();

    // 复用的临时对象
    this._offset = new THREE.Vector3();
    this._panTmp = new THREE.Vector3();

    // 绑定事件
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onContextMenu = (e) => e.preventDefault();

    const el = this.domElement;
    if (el) {
      el.addEventListener('pointerdown', this._onPointerDown);
      // 移动/抬起挂到 window：鼠标拖出画布也能继续旋转
      window.addEventListener('pointermove', this._onPointerMove);
      window.addEventListener('pointerup', this._onPointerUp);
      el.addEventListener('wheel', this._onWheel, { passive: false });
      el.addEventListener('contextmenu', this._onContextMenu);
      // 触摸时避免页面滚动
      el.style.touchAction = 'none';
    }
  }

  // 从当前相机位置反推球坐标（target 可能被外部改过）
  _syncFromCamera() {
    this._offset.copy(this.object.position).sub(this.target);
    this._spherical.setFromVector3(this._offset);
  }

  _onPointerDown(event) {
    if (!this.enabled) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return; // 只响应左键（触摸没有 button）

    this._activePointers.add(event.pointerId);

    if (this._activePointers.size > 1) {
      // 多指（捏合缩放）：退出拖动并清掉指针记录。
      //
      // 关键：仅靠这里拦截是不够的。真实手机上第二根手指按下之前，
      // 第一根手指已经移动过若干次，视角早就被转走了一段。
      // 所以下面 _onPointerMove 里还有一个"等待期"（见 _awaitMultiTouch）。
      this._state = STATE.NONE;
      this._pointerId = null;
      this._awaitMultiTouch = false;
      return;
    }

    // 单指按下：先不立刻进入 ROTATE，而是记下时间并等待一小段时间。
    // 若这期间第二根手指也按下了，就当捏合处理，完全不转视角。
    // 若是真单指，第一帧移动后即可正常拖动（用户感知不到延迟）。
    this._pendingPointerId = event.pointerId;
    this._pendingSince = performance.now();
    this._pointerStart.set(event.clientX, event.clientY);
    this._syncFromCamera();
    this._state = STATE.NONE;
    this._awaitMultiTouch = event.pointerType !== 'mouse';
    if (!this._awaitMultiTouch) {
      // 鼠标没有多指场景，直接开始拖动
      this._state = STATE.ROTATE;
      this._pointerId = event.pointerId;
    }
  }

  _onPointerMove(event) {
    if (!this.enabled) return;

    // 等待期：触摸单指按下后的很短时间内，先不旋转。
    // 真实的双指手势两指几乎同时落下（通常 < 80ms），这段等待足以吃掉
    // "第一根手指先动了一下"造成的那一点点视角跳动。
    if (this._awaitMultiTouch && this._state !== STATE.ROTATE) {
      if (event.pointerId !== this._pendingPointerId) return;
      const elapsed = performance.now() - this._pendingSince;
      if (elapsed < this.multiTouchDelay) return;   // 还在等待，不转
      // 等够了仍只有一根手指：确认是单指拖动，正式进入 ROTATE。
      // 注意不要把这一帧的位移丢掉——否则第一次拖动的手感会"顿一下"。
      this._state = STATE.ROTATE;
      this._pointerId = this._pendingPointerId;
      this._pointerStart.set(event.clientX, event.clientY);
      // 继续往下走，用当前帧的位置差正常计算旋转
    } else if (this._state !== STATE.ROTATE) {
      return;
    }

    // 只处理发起拖动的那根手指；第二根手指的移动一律忽略
    if (event.pointerId !== this._pointerId) return;

    const dx = event.clientX - this._pointerStart.x;
    const dy = event.clientY - this._pointerStart.y;
    this._pointerStart.set(event.clientX, event.clientY);

    // 灵敏度：以画布尺寸归一化，保证不同分辨率手感一致
    const el = this.domElement || {};
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;

    // 水平拖动 -> 方位角；垂直拖动 -> 极角
    this._sphericalDelta.theta -= (2 * Math.PI * dx / w) * this.rotateSpeed;
    this._sphericalDelta.phi -= (2 * Math.PI * dy / h) * this.rotateSpeed;
  }

  _onPointerUp(event) {
    if (event && event.pointerId !== undefined) {
      this._activePointers.delete(event.pointerId);
      if (event.pointerId === this._pendingPointerId) this._pendingPointerId = null;
      // 只有抬起"发起拖动的那根手指"才结束旋转。
      if (event.pointerId === this._pointerId) {
        this._pointerId = null;
        this._state = STATE.NONE;
      }
      if (this._activePointers.size === 0) this._awaitMultiTouch = false;
      return;
    }
    this._activePointers.clear();
    this._pendingPointerId = null;
    this._pointerId = null;
    this._state = STATE.NONE;
    this._awaitMultiTouch = false;
  }

  _onWheel(event) {
    if (!this.enabled || !this.enableZoom) return;
    event.preventDefault();
    // 向上滚 = 拉近
    const factor = Math.pow(0.95, this.zoomSpeed * (event.deltaY > 0 ? -1 : 1));
    this._scale *= factor;
  }

  update() {
    if (!this.enabled) return false;

    // 从相机当前位置重新算球坐标（target 可能动了）
    this._syncFromCamera();

    // 应用拖动增量
    this._spherical.theta += this._sphericalDelta.theta;
    this._spherical.phi += this._sphericalDelta.phi;

    // 钳制极角，避免翻到地面下
    this._spherical.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this._spherical.phi));

    // 应用缩放
    this._spherical.radius *= this._scale;
    this._spherical.radius = Math.max(this.minDistance, Math.min(this.maxDistance, this._spherical.radius));

    // 阻尼：按比例把增量衰减，未启用阻尼时直接清零
    if (this.enableDamping) {
      this._sphericalDelta.theta *= (1 - this.dampingFactor);
      this._sphericalDelta.phi *= (1 - this.dampingFactor);
      this._scale = 1 + (this._scale - 1) * (1 - this.dampingFactor);
      // 极小值时归零，避免永久微抖
      if (Math.abs(this._sphericalDelta.theta) < 1e-5) this._sphericalDelta.theta = 0;
      if (Math.abs(this._sphericalDelta.phi) < 1e-5) this._sphericalDelta.phi = 0;
      if (Math.abs(this._scale - 1) < 1e-4) this._scale = 1;
    } else {
      this._sphericalDelta.set(0, 0, 0);
      this._scale = 1;
    }

    // 球坐标 -> 笛卡尔，写回相机
    this._offset.setFromSpherical(this._spherical);
    this.object.position.copy(this.target).add(this._offset);
    this.object.lookAt(this.target);

    return true;
  }

  dispose() {
    const el = this.domElement;
    if (el) {
      el.removeEventListener('pointerdown', this._onPointerDown);
      el.removeEventListener('wheel', this._onWheel);
      el.removeEventListener('contextmenu', this._onContextMenu);
    }
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
  }
}
