import * as THREE from 'three';

// 各种瞬时视觉特效：弹道曳光、命中火花、爆炸、血点、烟雾
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = []; // { update(dt) -> bool(存活), dispose() }
    this._tracerGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 5);
    this._sparkGeo = new THREE.SphereGeometry(0.06, 4, 4);
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (!this.items[i].update(dt)) {
        this.items[i].dispose();
        this.items.splice(i, 1);
      }
    }
  }

  _add(obj, life, fn) {
    let t = 0;
    this.items.push({
      update: (dt) => { t += dt; const alive = t < life; fn(t / life, dt, t); return alive; },
      dispose: () => obj && this.scene.remove(obj),
    });
  }

  // 曳光：从 from 到 to 的细线，快速淡出
  tracer(from, to, color = 0xffe27a) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.01) return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(this._tracerGeo, mat);
    mesh.scale.set(1, len, 1);
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.scene.add(mesh);
    this._add(mesh, 0.08, (p) => { mat.opacity = 0.9 * (1 - p); });
  }

  // 命中火花
  impact(pos, normal = new THREE.Vector3(0, 1, 0), color = 0xffcf6b, count = 7) {
    const group = new THREE.Group();
    const parts = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(this._sparkGeo, mat);
      m.position.copy(pos);
      const v = normal.clone().multiplyScalar(2 + Math.random() * 3);
      v.x += (Math.random() - 0.5) * 5; v.y += Math.random() * 3; v.z += (Math.random() - 0.5) * 5;
      parts.push({ m, v, mat });
      group.add(m);
    }
    this.scene.add(group);
    this._add(group, 0.4, (p, dt) => {
      for (const pt of parts) {
        pt.v.y -= 12 * dt;
        pt.m.position.addScaledVector(pt.v, dt);
        pt.mat.opacity = 1 - p;
      }
    });
  }

  // 击中敌人的卡通特效（黄色星花，不血腥，适合小朋友）
  blood(pos) {
    this.impact(pos, new THREE.Vector3(0, 0.6, 0), 0xffe14a, 10);
  }

  // 爆炸：光球扩张 + 碎片 + 闪光灯
  explosion(pos, radius = 6, color = 0xff7a2a) {
    // 核心闪光球
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false });
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), coreMat);
    core.position.copy(pos);
    this.scene.add(core);
    this._add(core, 0.35, (p) => {
      const sc = 0.5 + p * radius * 0.9;
      core.scale.setScalar(sc);
      coreMat.opacity = 1 - p;
    });

    // 火球外壳
    const ballMat = new THREE.MeshBasicMaterial({ color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), ballMat);
    ball.position.copy(pos);
    this.scene.add(ball);
    this._add(ball, 0.5, (p) => {
      ball.scale.setScalar(0.5 + p * radius);
      ballMat.opacity = 0.8 * (1 - p);
    });

    // 闪光灯
    const light = new THREE.PointLight(0xffaa55, 8, radius * 4, 2);
    light.position.copy(pos).add(new THREE.Vector3(0, 1, 0));
    this.scene.add(light);
    this._add(light, 0.3, (p) => { light.intensity = 8 * (1 - p); });

    // 碎片
    const debris = new THREE.Group();
    const parts = [];
    const dgeo = new THREE.SphereGeometry(0.12, 4, 4);
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: i % 2 ? color : 0x553322 });
      const m = new THREE.Mesh(dgeo, mat);
      m.position.copy(pos);
      const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.8 + 0.4, (Math.random() - 0.5))
        .normalize().multiplyScalar(6 + Math.random() * 8);
      parts.push({ m, v });
      debris.add(m);
    }
    this.scene.add(debris);
    this._add(debris, 0.8, (p, dt) => {
      for (const pt of parts) { pt.v.y -= 18 * dt; pt.m.position.addScaledVector(pt.v, dt); }
      debris.scale.setScalar(1);
    });

    // 烟
    this.smoke(pos, radius * 0.4);
  }

  smoke(pos, size = 2) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.5, depthWrite: false });
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), mat);
    m.position.copy(pos).add(new THREE.Vector3(0, 1, 0));
    this.scene.add(m);
    this._add(m, 1.4, (p, dt) => {
      m.scale.setScalar(size * (0.5 + p * 1.5));
      m.position.y += dt * 1.5;
      mat.opacity = 0.5 * (1 - p);
    });
  }
}
