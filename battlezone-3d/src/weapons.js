import * as THREE from 'three';

// ---------- 武器目录 ----------
// dmg=单发伤害, rate=每秒射速, auto=是否全自动, mag=弹匣容量, reserve=备弹,
// spread=散布(弧度), pellets=每次发射弹丸数, reload=装填秒, recoil=后坐力, type=hitscan|rocket
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: '手枪', icon: '🔫', slot: 1, color: 0x9aa0b5,
    dmg: 26, rate: 6, auto: false, mag: 12, reserveMax: Infinity, reserve: Infinity,
    spread: 0.012, pellets: 1, reload: 1.0, recoil: 0.012, range: 120, type: 'hitscan',
  },
  rifle: {
    id: 'rifle', name: '突击步枪', icon: '🪖', slot: 2, color: 0x4a5160,
    dmg: 20, rate: 10, auto: true, mag: 30, reserveMax: 240, reserve: 120,
    spread: 0.022, pellets: 1, reload: 1.7, recoil: 0.01, range: 150, type: 'hitscan',
  },
  shotgun: {
    id: 'shotgun', name: '霰弹枪', icon: '💥', slot: 3, color: 0x7a4a2a,
    dmg: 13, rate: 1.3, auto: false, mag: 6, reserveMax: 48, reserve: 24,
    spread: 0.10, pellets: 9, reload: 2.4, recoil: 0.04, range: 45, type: 'hitscan',
  },
  sniper: {
    id: 'sniper', name: '狙击枪', icon: '🎯', slot: 4, color: 0x2f3a2a,
    dmg: 140, rate: 1.0, auto: false, mag: 5, reserveMax: 30, reserve: 15,
    spread: 0.002, pellets: 1, reload: 2.2, recoil: 0.05, range: 220, type: 'hitscan', zoom: 3.2,
  },
  rocket: {
    id: 'rocket', name: '火箭筒', icon: '🚀', slot: 5, color: 0x3a5c2a,
    dmg: 240, splash: 9, rate: 0.8, auto: false, mag: 1, reserveMax: 8, reserve: 4,
    spread: 0.004, pellets: 1, reload: 2.8, recoil: 0.06, range: 200, type: 'rocket',
  },
};

export const WEAPON_ORDER = ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket'];

export class WeaponSystem {
  constructor(game) {
    this.game = game;
    this.inv = {}; // id -> { mag, reserve, owned }
    this.currentId = 'pistol';
    this.cooldown = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.rockets = [];

    // 视图模型（挂在相机上）
    this.viewRoot = new THREE.Group();
    game.camera.add(this.viewRoot);
    this.viewModels = {};
    this.recoilOffset = 0;   // 后坐力位移
    this.recoilRot = 0;
    this.adsBlend = 0;       // 0=腰射 1=瞄准

    // 默认拥有手枪
    this.give('pistol', { switch: true });

    this._ray = new THREE.Raycaster();
    this._tmpDir = new THREE.Vector3();
    this._tmpPos = new THREE.Vector3();
  }

  def(id) { return WEAPONS[id]; }
  current() { return WEAPONS[this.currentId]; }
  state() { return this.inv[this.currentId]; }

  owns(id) { return !!this.inv[id]?.owned; }

  // 获得 / 补充武器
  give(id, { switch: doSwitch = false, ammo = null } = {}) {
    const w = WEAPONS[id];
    if (!w) return false;
    let already = this.owns(id);
    if (!this.inv[id]) {
      this.inv[id] = { mag: w.mag, reserve: w.reserve === Infinity ? Infinity : (ammo ?? w.reserve), owned: true };
      this._buildViewModel(id);
    } else {
      // 已有则补弹
      const add = ammo ?? w.mag;
      if (this.inv[id].reserve !== Infinity) {
        this.inv[id].reserve = Math.min(w.reserveMax, this.inv[id].reserve + add);
      }
    }
    if (doSwitch || !already && this._autoSwitchBetter(id)) this.switchTo(id);
    return !already;
  }

  _autoSwitchBetter(id) {
    // 第一次捡到比当前更高级的武器时自动切换
    return WEAPONS[id].slot > this.current().slot;
  }

  switchTo(id) {
    if (!this.owns(id) || this.currentId === id || this.reloading && false) {}
    if (!this.owns(id)) return;
    this.currentId = id;
    this.reloading = false;
    this.reloadTimer = 0;
    this.cooldown = 0.15;
    for (const k in this.viewModels) this.viewModels[k].visible = (k === id);
    this.game.ui?.setWeapon(this);
  }

  switchBySlot(slot) {
    const id = WEAPON_ORDER.find((k) => WEAPONS[k].slot === slot);
    if (id && this.owns(id)) this.switchTo(id);
  }

  cycle(dir) {
    const owned = WEAPON_ORDER.filter((k) => this.owns(k));
    let i = owned.indexOf(this.currentId);
    i = (i + dir + owned.length) % owned.length;
    this.switchTo(owned[i]);
  }

  reload() {
    const w = this.current(), st = this.state();
    if (this.reloading || st.mag >= w.mag) return;
    if (st.reserve !== Infinity && st.reserve <= 0) return;
    this.reloading = true;
    this.reloadTimer = w.reload;
    this.game.ui?.setReloading(true);
  }

  _finishReload() {
    const w = this.current(), st = this.state();
    const need = w.mag - st.mag;
    if (st.reserve === Infinity) {
      st.mag = w.mag;
    } else {
      const take = Math.min(need, st.reserve);
      st.mag += take;
      st.reserve -= take;
    }
    this.reloading = false;
    this.game.ui?.setReloading(false);
  }

  canFire() { return this.cooldown <= 0 && !this.reloading; }

  // 由 player/main 每帧调用：firing=左键状态, justPressed=刚按下
  tryFire(firing, justPressed) {
    const w = this.current();
    if (!this.canFire()) return;
    if (w.auto ? firing : justPressed) {
      this.fire();
    }
  }

  fire() {
    const w = this.current(), st = this.state();
    if (st.mag <= 0) {
      this.reload();
      return;
    }
    st.mag--;
    this.cooldown = 1 / w.rate;

    // 后坐力（视图 + 镜头）
    this.recoilOffset = Math.min(0.18, this.recoilOffset + 0.06 + w.recoil);
    this.recoilRot = Math.min(0.25, this.recoilRot + w.recoil * 3);
    this.game.player?.addRecoil(w.recoil * (this.adsBlend > 0.5 ? 0.4 : 1));

    this._muzzleFlash();
    this.game.audio?.shot(w.id);

    const cam = this.game.camera;
    const origin = cam.getWorldPosition(this._tmpPos.clone());
    const baseDir = cam.getWorldDirection(this._tmpDir.clone()).normalize();

    if (w.type === 'rocket') {
      this._spawnRocket(origin, baseDir);
    } else {
      const spread = w.spread * (this.adsBlend > 0.5 ? 0.25 : 1);
      for (let p = 0; p < w.pellets; p++) {
        const dir = baseDir.clone();
        dir.x += (Math.random() - 0.5) * spread * 2;
        dir.y += (Math.random() - 0.5) * spread * 2;
        dir.z += (Math.random() - 0.5) * spread * 2;
        dir.normalize();
        this._hitscan(origin, dir, w);
      }
    }
  }

  _hitscan(origin, dir, w) {
    this._ray.set(origin, dir);
    this._ray.far = w.range;
    const targets = this.game.enemyManager.getHitMeshes().concat(this.game.colliders);
    const hits = this._ray.intersectObjects(targets, false);
    let end;
    if (hits.length) {
      const h = hits[0];
      end = h.point;
      const owner = h.object.userData.owner;
      if (owner && owner.alive) {
        const headish = h.point.y > owner.position.y + (owner.headY || 1.4);
        const dmg = w.dmg * (headish ? 2 : 1);
        owner.takeDamage(dmg, h.point, dir);
        this.game.effects.blood(h.point);
        this.game.ui?.hitMarker(headish);
      } else {
        this.game.effects.impact(h.point, h.face ? h.face.normal : new THREE.Vector3(0, 1, 0));
      }
    } else {
      end = origin.clone().addScaledVector(dir, w.range);
    }
    // 曳光从枪口飞出
    const muzzle = this._muzzleWorld();
    this.game.effects.tracer(muzzle, end, w.id === 'sniper' ? 0x9fe0ff : 0xffe27a);
  }

  _spawnRocket(origin, dir) {
    const body = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0x551100 });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 8), mat);
    m.rotation.x = Math.PI / 2;
    body.add(m);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 8),
      new THREE.MeshStandardMaterial({ color: 0xb83020 }));
    tip.rotation.x = Math.PI / 2; tip.position.z = -0.6;
    body.add(tip);
    const start = this._muzzleWorld();
    body.position.copy(start);
    body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    this.game.scene.add(body);
    // 尾焰光
    const light = new THREE.PointLight(0xff7733, 3, 8, 2);
    body.add(light);
    this.rockets.push({ mesh: body, dir: dir.clone(), speed: 55, dist: 0, max: this.current().range });
    this.game.audio?.rocket();
  }

  _updateRockets(dt) {
    const w = WEAPONS.rocket;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      const step = r.speed * dt;
      // 检测前方碰撞
      this._ray.set(r.mesh.position, r.dir);
      this._ray.far = step + 0.5;
      const targets = this.game.enemyManager.getHitMeshes().concat(this.game.colliders);
      const hits = this._ray.intersectObjects(targets, false);
      let exploded = false;
      if (hits.length && hits[0].distance <= step + 0.4) {
        this._explode(hits[0].point, w);
        exploded = true;
      } else {
        r.mesh.position.addScaledVector(r.dir, step);
        r.dist += step;
        // 烟迹
        if (Math.random() < 0.6) this.game.effects.smoke(r.mesh.position.clone(), 0.5);
        if (r.dist >= r.max || r.mesh.position.y < 0.2) {
          this._explode(r.mesh.position.clone(), w);
          exploded = true;
        }
      }
      if (exploded) {
        this.game.scene.remove(r.mesh);
        this.rockets.splice(i, 1);
      }
    }
  }

  _explode(pos, w) {
    this.game.effects.explosion(pos, w.splash);
    this.game.audio?.explosion();
    // 范围伤害（敌人）
    for (const e of this.game.enemyManager.enemies) {
      if (!e.alive) continue;
      const d = e.position.distanceTo(pos);
      if (d < w.splash) {
        const dmg = w.dmg * (1 - d / w.splash);
        e.takeDamage(dmg, e.position.clone(), new THREE.Vector3(0, 1, 0));
      }
    }
    // 玩家自伤（离太近）
    const p = this.game.player;
    if (p && !p.inTank) {
      const d = p.position.distanceTo(pos);
      if (d < w.splash) p.takeDamage(40 * (1 - d / w.splash), 'explosion');
    }
  }

  update(dt) {
    // 驾驶坦克时（第三人称）隐藏第一人称武器模型
    this.viewRoot.visible = !this.game.player?.inTank;

    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this._finishReload();
    }
    this._updateRockets(dt);

    // 后坐力恢复
    this.recoilOffset = Math.max(0, this.recoilOffset - dt * 1.4);
    this.recoilRot = Math.max(0, this.recoilRot - dt * 2.2);

    // 瞄准过渡
    const aiming = this.game.input.aim && !this.game.player?.inTank;
    this.adsBlend += ((aiming ? 1 : 0) - this.adsBlend) * Math.min(1, dt * 12);

    // 视图模型位置：腰射 vs 瞄准
    const vm = this.viewModels[this.currentId];
    if (vm) {
      const hip = vm.userData.hip, ads = vm.userData.ads;
      vm.position.lerpVectors(hip, ads, this.adsBlend);
      vm.position.z += this.recoilOffset;       // 后坐后移
      vm.rotation.x = -this.recoilRot;
      // 装填时下沉
      if (this.reloading) {
        const w = this.current();
        const ph = 1 - Math.abs(0.5 - (1 - this.reloadTimer / w.reload)) * 2;
        vm.position.y -= ph * 0.18;
        vm.rotation.x += ph * 0.5;
      }
      // 走动晃动
      const p = this.game.player;
      if (p) {
        vm.position.x += Math.sin(p.bob * 2) * 0.006;
        vm.position.y += Math.sin(p.bob * 4) * 0.006;
      }
    }
    // 闪光淡出
    if (this._flash) {
      this._flashT -= dt;
      this._flash.material.opacity = Math.max(0, this._flashT / 0.05) * 0.9;
      this._flash.visible = this._flashT > 0;
      const s = 0.4 + Math.random() * 0.3;
      this._flash.scale.setScalar(s);
    }
  }

  // ---------- 视图模型 ----------
  _buildViewModel(id) {
    const w = WEAPONS[id];
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: w.color, roughness: 0.6, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.5, metalness: 0.5 });

    const make = (geo, m, x, y, z, rx = 0) => {
      const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.rotation.x = rx;
      g.add(mesh); return mesh;
    };
    // 通用握把
    make(new THREE.BoxGeometry(0.12, 0.22, 0.14), dark, 0, -0.12, 0.18, 0.3);

    let muzzleZ = -0.5;
    if (id === 'pistol') {
      make(new THREE.BoxGeometry(0.13, 0.16, 0.45), mat, 0, 0.02, -0.05);
      make(new THREE.BoxGeometry(0.08, 0.08, 0.3), dark, 0, 0.05, -0.3);
      muzzleZ = -0.45;
    } else if (id === 'rifle') {
      make(new THREE.BoxGeometry(0.12, 0.16, 0.8), mat, 0, 0.02, -0.15);
      make(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), dark, 0, 0.04, -0.6).rotation.x = Math.PI / 2;
      make(new THREE.BoxGeometry(0.1, 0.18, 0.18), dark, 0, -0.06, 0.05); // 弹匣
      muzzleZ = -0.85;
    } else if (id === 'shotgun') {
      make(new THREE.BoxGeometry(0.16, 0.18, 0.9), mat, 0, 0.02, -0.18);
      make(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8), dark, 0, 0.05, -0.5).rotation.x = Math.PI / 2;
      make(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), dark, 0, -0.04, -0.4).rotation.x = Math.PI / 2;
      muzzleZ = -0.85;
    } else if (id === 'sniper') {
      make(new THREE.BoxGeometry(0.12, 0.16, 1.0), mat, 0, 0.02, -0.25);
      make(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), dark, 0, 0.05, -0.8).rotation.x = Math.PI / 2;
      // 瞄准镜
      make(new THREE.CylinderGeometry(0.06, 0.06, 0.28, 10), dark, 0, 0.14, -0.1).rotation.x = Math.PI / 2;
      muzzleZ = -1.15;
    } else if (id === 'rocket') {
      make(new THREE.CylinderGeometry(0.13, 0.13, 1.1, 10), mat, 0, 0.04, -0.25).rotation.x = Math.PI / 2;
      make(new THREE.CylinderGeometry(0.17, 0.17, 0.2, 10), dark, 0, 0.04, 0.3).rotation.x = Math.PI / 2;
      make(new THREE.BoxGeometry(0.04, 0.12, 0.2), dark, 0.1, 0.12, -0.1);
      muzzleZ = -0.8;
    }

    // 枪口闪光（共享一个）
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd277, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), flashMat);
    flash.position.set(0, 0.04, muzzleZ - 0.05);
    flash.visible = false;
    g.add(flash);
    g.userData.flash = flash;
    g.userData.muzzleZ = muzzleZ;

    // 腰射 / 瞄准 位置
    g.userData.hip = new THREE.Vector3(0.3, -0.28, -0.55);
    g.userData.ads = new THREE.Vector3(0, (id === 'sniper' ? -0.16 : -0.2), -0.32);

    g.position.copy(g.userData.hip);
    g.visible = (id === this.currentId);
    this.viewRoot.add(g);
    this.viewModels[id] = g;
  }

  _muzzleFlash() {
    const vm = this.viewModels[this.currentId];
    if (!vm) return;
    this._flash = vm.userData.flash;
    this._flash.visible = true;
    this._flashT = 0.05;
    this._flash.material.opacity = 0.9;
  }

  _muzzleWorld() {
    const vm = this.viewModels[this.currentId];
    if (!vm || !vm.userData.flash) return this.game.camera.getWorldPosition(new THREE.Vector3());
    return vm.userData.flash.getWorldPosition(new THREE.Vector3());
  }
}
