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
    this._state = STATE.ROTATE;
    this._pointerStart.set(event.clientX, event.clientY);
    this._syncFromCamera();
  }

  _onPointerMove(event) {
    if (!this.enabled || this._state !== STATE.ROTATE) return;

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

  _onPointerUp() {
    this._state = STATE.NONE;
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
