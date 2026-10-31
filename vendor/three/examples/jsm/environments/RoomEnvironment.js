// 最小 RoomEnvironment 实现（替代 three/addons 的版本）
//
// 为什么自己写：项目要离线可用，官方 addon 需要单独下载。
// 官方版用一个"房间"（若干面片 + 发光板）给 PMREMGenerator 生成环境贴图，
// 让 MeshPhysicalMaterial 的镜面/清漆高光有东西可反射，看起来像"湿的果冻"。
//
// 这里用同样的思路，但内置几何简化到足够的程度：
//   一个盒子内壁 + 顶部一块亮面 + 两侧冷暖光板
// 输出对象，用法与官方一致：new RoomEnvironment() 后交给 pmrem.fromScene()。

import * as THREE from 'three';

export class RoomEnvironment extends THREE.Scene {
  constructor() {
    super();

    const geometry = new THREE.BoxGeometry();
    geometry.deleteAttribute('uv'); // 不需要 uv，省一点

    // 材质工厂：发光的 Standard 材质（与官方实现一致的做法）
    const createAreaLightMaterial = (intensity) => {
      const material = new THREE.MeshBasicMaterial();
      material.color.setScalar(intensity);
      return material;
    };

    const createMaterial = (color, intensity) => {
      const mat = new THREE.MeshStandardMaterial();
      mat.color.setHex(color);
      mat.emissive = new THREE.Color(color);
      mat.emissiveIntensity = intensity;
      mat.roughness = 1;
      mat.side = THREE.BackSide; // 盒子内壁
      return mat;
    };

    // 房间外壳（从内部看）
    const room = new THREE.Mesh(geometry, createMaterial(0x888888, 0.2));
    room.scale.set(20, 12, 20);
    this.add(room);

    // 顶部主光板（最亮，决定高光形状）
    const topLight = new THREE.Mesh(geometry, createAreaLightMaterial(8));
    topLight.position.set(0, 5.9, 0);
    topLight.scale.set(8, 0.1, 8);
    this.add(topLight);

    // 侧面冷光板（让高光有方向性）
    const sideLight1 = new THREE.Mesh(geometry, createAreaLightMaterial(4));
    sideLight1.position.set(-9.9, 2, 0);
    sideLight1.scale.set(0.1, 6, 6);
    this.add(sideLight1);

    const sideLight2 = new THREE.Mesh(geometry, createAreaLightMaterial(4));
    sideLight2.position.set(9.9, 2, 0);
    sideLight2.scale.set(0.1, 6, 6);
    this.add(sideLight2);

    // 背后暖光板（轮廓光）
    const backLight = new THREE.Mesh(geometry, createAreaLightMaterial(5));
    backLight.position.set(0, 2, -9.9);
    backLight.scale.set(6, 4, 0.1);
    this.add(backLight);

    this._disposeList = [geometry];
  }

  dispose() {
    for (const g of this._disposeList || []) g.dispose();
    this.traverse((obj) => {
      if (obj.material) obj.material.dispose();
    });
  }
}
