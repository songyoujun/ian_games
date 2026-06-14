import * as THREE from 'three';
import { resolveCollision, WORLD_SIZE } from './world.js';

// 士兵兵种（决定属性 + 掉落的武器）。对 8-9 岁孩子友好：敌人血量/伤害都偏低，打起来轻松。
const SOLDIER_TYPES = {
  grunt:   { hp: 35, color: 0xb14a4a, dmg: 5,  rate: 1.4, range: 40,  accuracy: 0.40, drop: 'pistol',  speed: 4.0, score: 80 },
  rifleman:{ hp: 50, color: 0xc25a3a, dmg: 7,  rate: 2.2, range: 60,  accuracy: 0.38, drop: 'rifle',   speed: 4.4, score: 120 },
  shotgun: { hp: 70, color: 0xa23a6a, dmg: 16, rate: 1.0, range: 22,  accuracy: 0.55, drop: 'shotgun', speed: 5.0, score: 150 },
  sniper:  { hp: 40, color: 0x6a4ab1, dmg: 22, rate: 0.5, range: 110, accuracy: 0.60, drop: 'sniper',  speed: 3.2, score: 180 },
};

const ALLY_COLOR = 0x3f78c8;   // 友军：蓝色
const ALLY_HELMET = 0x24304a;

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.enemies = [];   // 敌方单位（士兵 + 坦克 + 中立可驾驶坦克）
    this.allies = [];    // 我方部队（队友士兵 + 队友坦克）
    this.shells = [];    // 坦克炮弹
    this._ray = new THREE.Raycaster();
    this._hitCache = [];
  }

  reset() {
    for (const e of this.enemies) e.removeFromScene();
    for (const a of this.allies) a.removeFromScene();
    for (const s of this.shells) this.game.scene.remove(s.mesh);
    this.enemies.length = 0;
    this.allies.length = 0;
    this.shells.length = 0;
  }

  aliveCount() { return this.enemies.filter((e) => e.alive && e.faction === 'enemy').length; }
  allyCount() { return this.allies.filter((a) => a.alive).length; }

  // 玩家子弹能命中的网格：只有敌方单位（不会误伤队友）
  getHitMeshes() {
    this._hitCache.length = 0;
    for (const e of this.enemies) {
      if (e.alive && e.faction === 'enemy') {
        for (const m of e.hitMeshes) this._hitCache.push(m);
      }
    }
    return this._hitCache;
  }

  // 离 pos 最近的存活敌人（给友军找目标用）
  nearestEnemy(pos) {
    let best = null, bd = Infinity;
    for (const e of this.enemies) {
      if (e.alive && e.faction === 'enemy') {
        const d = e.position.distanceTo(pos);
        if (d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }

  // 敌人攻击目标：玩家 + 所有友军 中最近的
  pickEnemyTarget(pos) {
    const player = this.game.player;
    const ppos = player.inTank ? player.inTank.position : player.position;
    let best = { pos: ppos, kind: 'player', ref: player, aimY: player.inTank ? 1.5 : 1.6 };
    let bd = pos.distanceTo(ppos);
    for (const a of this.allies) {
      if (!a.alive) continue;
      const d = pos.distanceTo(a.position);
      if (d < bd) { bd = d; best = { pos: a.position, kind: 'ally', ref: a, aimY: a.aimY || 1.4 }; }
    }
    return best;
  }

  // 随机出生点（远离玩家、不在障碍里）
  _spawnPoint(minDist = 45) {
    const a = Math.random() * Math.PI * 2;
    const r = minDist + Math.random() * 25;
    const p = new THREE.Vector3(
      this.game.player.position.x + Math.cos(a) * r, 0,
      this.game.player.position.z + Math.sin(a) * r,
    );
    const lim = WORLD_SIZE / 2 - 6;
    p.x = Math.max(-lim, Math.min(lim, p.x));
    p.z = Math.max(-lim, Math.min(lim, p.z));
    resolveCollision(p, 1.5, this.game.obstacles);
    return p;
  }

  // 队友出生点：在玩家附近（像增援赶到）
  _allySpawnPoint() {
    const a = Math.random() * Math.PI * 2;
    const r = 5 + Math.random() * 9;
    const p = new THREE.Vector3(
      this.game.player.position.x + Math.cos(a) * r, 0,
      this.game.player.position.z + Math.sin(a) * r,
    );
    const lim = WORLD_SIZE / 2 - 6;
    p.x = Math.max(-lim, Math.min(lim, p.x));
    p.z = Math.max(-lim, Math.min(lim, p.z));
    resolveCollision(p, 1.2, this.game.obstacles);
    return p;
  }

  spawnWave(wave) {
    const count = Math.min(26, 5 + Math.floor(wave * 1.8));
    const pool = [];
    for (let i = 0; i < count; i++) {
      let t;
      const r = Math.random();
      if (wave >= 4 && r < 0.16) t = 'sniper';
      else if (wave >= 2 && r < 0.42) t = 'shotgun';
      else if (r < 0.75) t = 'rifleman';
      else t = 'grunt';
      pool.push(t);
    }
    for (const t of pool) this.enemies.push(new Enemy(this.game, t, this._spawnPoint()));
    const tanks = wave < 2 ? 0 : Math.min(4, Math.floor(wave / 2));
    for (let i = 0; i < tanks; i++) this.enemies.push(new Tank(this.game, 'enemy', this._spawnPoint(55)));
    return count + tanks;
  }

  // 供玩家驾驶的中立坦克
  spawnNeutralTank(pos) {
    const tk = new Tank(this.game, 'neutral', pos || new THREE.Vector3(10, 0, 6));
    this.enemies.push(tk);
    return tk;
  }

  // 生成一个队友（kind: 'tank' 或 士兵兵种名）
  spawnAlly(kind) {
    const pos = this._allySpawnPoint();
    let a;
    if (kind === 'tank') a = new Tank(this.game, 'ally', pos);
    else a = new Ally(this.game, kind, pos);
    this.allies.push(a);
    this.game.effects.smoke(pos.clone(), 1.0); // 增援登场的烟雾
    return a;
  }

  update(dt) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt);
      if (e.removeMe) { e.removeFromScene(); this.enemies.splice(i, 1); }
    }
    for (let i = this.allies.length - 1; i >= 0; i--) {
      const a = this.allies[i];
      a.update(dt);
      if (a.removeMe) { a.removeFromScene(); this.allies.splice(i, 1); }
    }
    this._updateShells(dt);
  }

  spawnShell(origin, dir, faction) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x331100, metalness: 0.6 }),
    );
    g.add(m);
    g.add(new THREE.PointLight(0xffaa44, 1.5, 6, 2));
    g.position.copy(origin);
    this.game.scene.add(g);
    this.shells.push({ mesh: g, dir: dir.clone().normalize(), speed: 70, dist: 0, max: 200, faction });
  }

  _updateShells(dt) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      const step = s.speed * dt;
      // 近炸引信：软目标没有可被射线命中的网格，靠距离触发
      if (s.faction === 'enemy') {
        let soft = null;
        if (!this.game.player.inTank) soft = this.game.player.position;
        // 也会近炸到友军
        let nd = soft ? s.mesh.position.distanceTo(soft.clone().setY(1.0)) : Infinity;
        for (const a of this.allies) {
          if (!a.alive) continue;
          const d = s.mesh.position.distanceTo(a.position);
          if (d < nd) nd = d;
        }
        if (nd < 2.6) { this._shellExplode(s.mesh.position.clone(), s.faction); this.game.scene.remove(s.mesh); this.shells.splice(i, 1); continue; }
      } else if (s.faction === 'player') {
        let hit = false;
        for (const e of this.enemies) {
          if (e.alive && e.faction === 'enemy' && s.mesh.position.distanceTo(e.position) < 2.6) { hit = true; break; }
        }
        if (hit) { this._shellExplode(s.mesh.position.clone(), s.faction); this.game.scene.remove(s.mesh); this.shells.splice(i, 1); continue; }
      }
      this._ray.set(s.mesh.position, s.dir);
      this._ray.far = step + 0.5;
      let targets = this.game.colliders;
      if (s.faction === 'player') targets = targets.concat(this.getHitMeshes());
      else if (this.game.player.inTank) targets = targets.concat(this.game.player.inTank.hitMeshes);
      const hits = this._ray.intersectObjects(targets, false);
      let boom = false;
      if (hits.length && hits[0].distance <= step + 0.4) {
        this._shellExplode(hits[0].point, s.faction); boom = true;
      } else {
        s.mesh.position.addScaledVector(s.dir, step);
        s.dist += step;
        if (Math.random() < 0.5) this.game.effects.smoke(s.mesh.position.clone(), 0.35);
        if (s.dist >= s.max || s.mesh.position.y < 0.25) { this._shellExplode(s.mesh.position.clone(), s.faction); boom = true; }
      }
      if (boom) { this.game.scene.remove(s.mesh); this.shells.splice(i, 1); }
    }
  }

  _shellExplode(pos, faction) {
    const radius = 8;
    this.game.effects.explosion(pos, radius, 0xff8a2a);
    this.game.audio?.explosion();
    if (faction === 'player') {
      // 玩家 / 友军坦克炮 -> 只伤敌人
      for (const e of this.enemies) {
        if (!e.alive || e.faction !== 'enemy') continue;
        const d = e.position.distanceTo(pos);
        if (d < radius) e.takeDamage(220 * (1 - d / radius), e.position.clone(), new THREE.Vector3(0, 1, 0));
      }
    } else {
      // 敌人坦克炮 -> 伤玩家 + 友军
      const p = this.game.player;
      const d = p.position.distanceTo(pos);
      if (d < radius && !p.inTank) p.takeDamage(40 * (1 - d / radius), 'shell');
      else if (d < radius && p.inTank) p.takeDamage(70 * (1 - d / radius), 'shell');
      for (const a of this.allies) {
        if (!a.alive) continue;
        const da = a.position.distanceTo(pos);
        if (da < radius) a.takeDamage(80 * (1 - da / radius));
      }
    }
  }

  // 两点间是否有视线（仅检测掩体）
  hasLOS(from, to) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    this._ray.set(from, dir.normalize());
    this._ray.far = dist - 1;
    return this._ray.intersectObjects(this.game.colliders, false).length === 0;
  }
}

// 公用：搭一个低多边形小人，返回各部件引用
function buildSoldierMesh(bodyColor, helmetColor = 0x2a2d3a) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: helmetColor, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a47a, roughness: 0.9 });

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.26), dark); legL.position.set(-0.16, 0.35, 0);
  const legR = legL.clone(); legR.position.x = 0.16;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.34), body); torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skin); head.position.y = 1.6;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  helmet.position.y = 1.74;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), body); armL.position.set(-0.4, 1.05, 0.05);
  const armR = armL.clone(); armR.position.set(0.34, 1.0, 0.28); armR.rotation.x = -1.1;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.6), dark); gun.position.set(0.34, 0.95, 0.45);

  for (const m of [legL, legR, torso, head, helmet, armL, armR, gun]) { m.castShadow = true; g.add(m); }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.34, 0.95, 0.78); g.add(muzzle);
  return { group: g, legL, legR, gun, torso, head, muzzle };
}

function buildUnitBar(width, y, fillColor) {
  const bar = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.14),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthTest: false }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.95, width * 0.1),
    new THREE.MeshBasicMaterial({ color: fillColor, depthTest: false }));
  fill.position.z = 0.01;
  bar.add(bg); bar.add(fill);
  bar.position.y = y; bar.renderOrder = 999;
  return { bar, fill, halfW: width * 0.475 };
}

// ========================= 敌方士兵 =========================
class Enemy {
  constructor(game, type, pos) {
    this.game = game;
    this.faction = 'enemy';
    this.type = type;
    this.T = SOLDIER_TYPES[type];
    this.hp = this.T.hp; this.maxHp = this.T.hp;
    this.alive = true; this.removeMe = false;
    this.headY = 1.45;
    this.fireTimer = 0.5 + Math.random() * 1.5;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 0; this.deathT = 0;

    const sm = buildSoldierMesh(this.T.color);
    this.group = sm.group; this.group.position.copy(pos);
    this.position = this.group.position;
    this.legL = sm.legL; this.legR = sm.legR; this.muzzle = sm.muzzle;
    sm.torso.userData.owner = this; sm.head.userData.owner = this;
    this.hitMeshes = [sm.torso, sm.head];

    const hb = buildUnitBar(1.1, 2.15, 0x4ade80);
    this.healthBar = hb.bar; this.healthFill = hb.fill; this._hbHalf = hb.halfW;
    this.healthBar.visible = false; this.group.add(this.healthBar);

    game.scene.add(this.group);
  }

  removeFromScene() { this.game.scene.remove(this.group); }

  takeDamage(dmg) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.healthBar.visible = true; this._hbTimer = 3;
    for (const m of this.hitMeshes) m.material.emissive?.setHex(0x884444);
    this._flashT = 0.08;
    if (this.hp <= 0) this._die();
  }

  _die() {
    this.alive = false; this.deathT = 0;
    this.game.onEnemyKilled(this);
    this.healthBar.visible = false;
    if (this.T.drop) this.game.pickups.spawnWeapon(this.T.drop, this.position.clone());
  }

  update(dt) {
    if (this._flashT > 0) {
      this._flashT -= dt;
      if (this._flashT <= 0) for (const m of this.hitMeshes) m.material.emissive?.setHex(0x000000);
    }
    if (!this.alive) { this._updateDeath(dt); return; }

    const info = this.game.enemyManager.pickEnemyTarget(this.position);
    const target = info.pos;
    const to = new THREE.Vector3().subVectors(target, this.position); to.y = 0;
    const dist = to.length(); to.normalize();
    this.group.rotation.y = Math.atan2(to.x, to.z);

    const T = this.T;
    const move = new THREE.Vector3();
    if (dist > T.range * 0.85) move.add(to);
    else if (dist < T.range * 0.45) move.addScaledVector(to, -1);
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = 1 + Math.random() * 2; }
    move.addScaledVector(new THREE.Vector3(to.z, 0, -to.x), this.strafeDir * 0.5);
    if (move.lengthSq() > 0) {
      move.normalize();
      this.position.x += move.x * T.speed * dt;
      this.position.z += move.z * T.speed * dt;
      resolveCollision(this.position, 0.6, this.game.obstacles);
      this._walk = (this._walk || 0) + dt * 8;
      this.legL.rotation.x = Math.sin(this._walk) * 0.6;
      this.legR.rotation.x = -Math.sin(this._walk) * 0.6;
    }

    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && dist < T.range) {
      const eye = this.position.clone(); eye.y = 1.5;
      const tgt = target.clone(); tgt.y = info.aimY;
      if (this.game.enemyManager.hasLOS(eye, tgt)) {
        this._shoot(tgt, info);
        this.fireTimer = 1 / T.rate * (0.8 + Math.random() * 0.4);
      } else this.fireTimer = 0.3;
    }

    this._updateBar(dt);
  }

  _shoot(targetPoint, info) {
    const muzzle = this.muzzle.getWorldPosition(new THREE.Vector3());
    this.game.effects.tracer(muzzle, targetPoint, 0xff6a4a);
    this.game.effects.impact(muzzle, new THREE.Vector3(0, 0, 1), 0xffaa55, 3);
    if (Math.random() < this.T.accuracy) {
      if (info.kind === 'player') this.game.player.takeDamage(this.T.dmg, 'enemy');
      else if (info.ref && info.ref.alive) info.ref.takeDamage(this.T.dmg);
    }
  }

  _updateBar(dt) {
    if (!this.healthBar.visible) return;
    this._hbTimer -= dt;
    if (this._hbTimer <= 0) { this.healthBar.visible = false; return; }
    const r = Math.max(0.01, this.hp / this.maxHp);
    this.healthFill.scale.x = r;
    this.healthFill.position.x = -(1 - r) * this._hbHalf;
    this.healthFill.material.color.setHex(r > 0.5 ? 0x4ade80 : 0xff5a3a);
    this.healthBar.quaternion.copy(this.game.camera.quaternion);
  }

  _updateDeath(dt) {
    this.deathT += dt;
    const k = Math.min(1, this.deathT * 2.5);
    this.group.rotation.z = k * Math.PI / 2 * 0.9;
    this.group.position.y = -k * 0.3;
    if (this.deathT > 4) {
      this.group.position.y = -k * 0.3 - (this.deathT - 4) * 0.5;
      if (this.deathT > 5.5) this.removeMe = true;
    }
  }
}

// ========================= 友军士兵 =========================
class Ally {
  constructor(game, type, pos) {
    this.game = game;
    this.faction = 'ally';
    this.type = type;
    const base = SOLDIER_TYPES[type] || SOLDIER_TYPES.rifleman;
    // 队友稍微强一点、更耐打，帮玩家分担压力
    this.T = { ...base, hp: base.hp + 25, accuracy: Math.min(0.9, base.accuracy + 0.2) };
    this.hp = this.T.hp; this.maxHp = this.T.hp;
    this.alive = true; this.removeMe = false;
    this.headY = 1.45; this.aimY = 1.4;
    this.fireTimer = Math.random();
    this.strafeDir = Math.random() < 0.5 ? 1 : -1; this.strafeTimer = 0; this.deathT = 0;

    const sm = buildSoldierMesh(ALLY_COLOR, ALLY_HELMET);
    this.group = sm.group; this.group.position.copy(pos);
    this.position = this.group.position;
    this.legL = sm.legL; this.legR = sm.legR; this.muzzle = sm.muzzle;
    this.hitMeshes = [sm.torso, sm.head]; // 不加入 getHitMeshes，玩家打不到队友

    const hb = buildUnitBar(1.1, 2.15, 0x4a9eff);
    this.healthBar = hb.bar; this.healthFill = hb.fill; this._hbHalf = hb.halfW;
    this.healthBar.visible = false; this.group.add(this.healthBar);

    // 头顶友军三角标记
    const mark = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 4),
      new THREE.MeshBasicMaterial({ color: 0x66c2ff }));
    mark.position.y = 2.45; mark.rotation.x = Math.PI;
    this.group.add(mark); this.mark = mark;

    game.scene.add(this.group);
  }

  removeFromScene() { this.game.scene.remove(this.group); }

  takeDamage(dmg) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.healthBar.visible = true; this._hbTimer = 3;
    for (const m of this.hitMeshes) m.material.emissive?.setHex(0x335588);
    this._flashT = 0.08;
    if (this.hp <= 0) this._die();
  }

  _die() {
    this.alive = false; this.deathT = 0;
    this.healthBar.visible = false;
    if (this.mark) this.mark.visible = false;
  }

  update(dt) {
    if (this._flashT > 0) {
      this._flashT -= dt;
      if (this._flashT <= 0) for (const m of this.hitMeshes) m.material.emissive?.setHex(0x000000);
    }
    if (!this.alive) { this._updateDeath(dt); return; }
    if (this.mark) this.mark.position.y = 2.45 + Math.sin((this._t = (this._t || 0) + dt) * 4) * 0.08;

    const mgr = this.game.enemyManager;
    const enemy = mgr.nearestEnemy(this.position);
    const moveTarget = enemy ? enemy.position : this.game.player.position;
    const stopRange = enemy ? this.T.range * 0.7 : 6;

    const to = new THREE.Vector3().subVectors(moveTarget, this.position); to.y = 0;
    const dist = to.length(); to.normalize();
    this.group.rotation.y = Math.atan2(to.x, to.z);

    const move = new THREE.Vector3();
    if (dist > stopRange) move.add(to);
    else if (enemy && dist < stopRange * 0.5) move.addScaledVector(to, -1);
    if (enemy) {
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = 1 + Math.random() * 2; }
      move.addScaledVector(new THREE.Vector3(to.z, 0, -to.x), this.strafeDir * 0.4);
    }
    if (move.lengthSq() > 0) {
      move.normalize();
      this.position.x += move.x * this.T.speed * dt;
      this.position.z += move.z * this.T.speed * dt;
      resolveCollision(this.position, 0.6, this.game.obstacles);
      this._walk = (this._walk || 0) + dt * 8;
      this.legL.rotation.x = Math.sin(this._walk) * 0.6;
      this.legR.rotation.x = -Math.sin(this._walk) * 0.6;
    }

    if (enemy) {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && dist < this.T.range) {
        const eye = this.position.clone(); eye.y = 1.5;
        const tgt = enemy.position.clone(); tgt.y = 1.3;
        if (mgr.hasLOS(eye, tgt)) {
          this._shoot(enemy, tgt);
          this.fireTimer = 1 / this.T.rate * (0.8 + Math.random() * 0.4);
        } else this.fireTimer = 0.3;
      }
    }

    if (this.healthBar.visible) {
      this._hbTimer -= dt;
      if (this._hbTimer <= 0) { this.healthBar.visible = false; }
      else {
        const r = Math.max(0.01, this.hp / this.maxHp);
        this.healthFill.scale.x = r;
        this.healthFill.position.x = -(1 - r) * this._hbHalf;
        this.healthBar.quaternion.copy(this.game.camera.quaternion);
      }
    }
  }

  _shoot(enemy, targetPoint) {
    const muzzle = this.muzzle.getWorldPosition(new THREE.Vector3());
    this.game.effects.tracer(muzzle, targetPoint, 0x66ddff);
    this.game.effects.impact(muzzle, new THREE.Vector3(0, 0, 1), 0xaad4ff, 3);
    if (Math.random() < this.T.accuracy) enemy.takeDamage(this.T.dmg, targetPoint);
  }

  _updateDeath(dt) {
    this.deathT += dt;
    const k = Math.min(1, this.deathT * 2.5);
    this.group.rotation.z = k * Math.PI / 2 * 0.9;
    this.group.position.y = -k * 0.3;
    if (this.deathT > 3) {
      this.group.position.y = -k * 0.3 - (this.deathT - 3) * 0.5;
      if (this.deathT > 4.5) this.removeMe = true;
    }
  }
}

// ========================= 坦克（敌方 / 中立 / 玩家 / 友军） =========================
class Tank {
  constructor(game, faction, pos) {
    this.game = game;
    this.faction = faction; // 'enemy' | 'neutral' | 'player' | 'ally'
    this.isTank = true;
    this.hp = faction === 'enemy' ? 420 : faction === 'ally' ? 600 : 800;
    this.maxHp = this.hp;
    this.alive = true; this.removeMe = false;
    this.headY = 99; this.aimY = 1.8;
    this.yaw = Math.random() * Math.PI * 2;
    this.turretYaw = this.yaw; this.barrelPitch = 0;
    this.fireCooldown = 0; this.driver = null; this.speedNow = 0;
    this.aimTarget = null;

    const g = new THREE.Group();
    g.position.copy(pos);
    this.group = g; this.position = g.position;

    const hullColor = faction === 'enemy' ? 0x7a3535 : faction === 'ally' ? 0x35557a : 0x4a6a3a;
    const hullMat = new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.7, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.6, metalness: 0.5 });
    const treadMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.9 });

    const treadL = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 4.6), treadMat); treadL.position.set(-1.5, 0.45, 0);
    const treadR = treadL.clone(); treadR.position.x = 1.5;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 4.2), hullMat); hull.position.y = 1.1;
    const hullTop = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.5, 3.2), hullMat); hullTop.position.y = 1.7;
    for (const m of [treadL, treadR, hull, hullTop]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }

    const turret = new THREE.Group(); turret.position.y = 2.0;
    const turretBody = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.9, 12), hullMat);
    turret.add(turretBody);
    const barrel = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 3.4, 10), dark);
    tube.rotation.x = Math.PI / 2; tube.position.z = -1.7;
    barrel.add(tube); barrel.position.set(0, 0.1, 0);
    turret.add(barrel);
    this.barrelTip = new THREE.Object3D(); this.barrelTip.position.set(0, 0.1, -3.4); turret.add(this.barrelTip);
    turretBody.castShadow = true; tube.castShadow = true;
    g.add(turret);
    this.turret = turret; this.barrel = barrel;

    hull.userData.owner = this; turretBody.userData.owner = this; hullTop.userData.owner = this;
    this.hitMeshes = [hull, hullTop, turretBody];

    if (faction === 'neutral') {
      const beacon = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 4),
        new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.8 }));
      beacon.position.y = 4.2; beacon.rotation.x = Math.PI;
      g.add(beacon); this.beacon = beacon;
    }
    if (faction === 'ally') {
      const mark = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.0, 4),
        new THREE.MeshBasicMaterial({ color: 0x66c2ff }));
      mark.position.y = 4.4; mark.rotation.x = Math.PI;
      g.add(mark); this.mark = mark;
    }

    const showBar = (faction === 'enemy' || faction === 'ally');
    const hb = buildUnitBar(3.4, 4.8, faction === 'ally' ? 0x4a9eff : 0xff5a3a);
    this.healthBar = hb.bar; this.healthFill = hb.fill; this._hbHalf = hb.halfW;
    this.healthBar.visible = showBar; this.group.add(this.healthBar);

    g.rotation.y = this.yaw;
    game.scene.add(g);
  }

  removeFromScene() { this.game.scene.remove(this.group); }

  takeDamage(dmg) {
    if (!this.alive) return;
    if (this.faction === 'neutral') this.faction = 'player'; // 误伤中立坦克不算
    this.hp -= dmg;
    if (this.faction === 'enemy' || this.faction === 'ally') { this.healthBar.visible = true; this._hbT = 4; }
    if (this.hp <= 0) this._die();
  }

  _die() {
    this.alive = false;
    this.game.effects.explosion(this.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 11, 0xffaa33);
    this.game.audio?.explosion();
    if (this.faction === 'enemy') {
      this.game.onEnemyKilled(this);
      this.game.pickups.spawnWeapon('rocket', this.position.clone());
    } else if (this.driver) {
      const d = this.driver;
      d.exitTank();
      d.takeDamage(45, 'tank-destroyed');
    }
    this.removeMe = true;
  }

  // ---- 驾驶 / 通用接口 ----
  canFire() { return this.fireCooldown <= 0; }

  drive(driveInput, turnInput, dt) {
    this.yaw += turnInput * 1.5 * dt;
    const target = driveInput * 13;
    this.speedNow += (target - this.speedNow) * Math.min(1, dt * 3);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.position.addScaledVector(fwd, this.speedNow * dt);
    resolveCollision(this.position, 2.6, this.game.obstacles);
    this.group.rotation.y = this.yaw;
  }

  aimTurret(worldYaw, pitch) {
    this.turretYaw = worldYaw;
    this.turret.rotation.y = worldYaw - this.yaw;
    this.barrel.rotation.x = Math.max(-0.3, Math.min(0.2, -pitch));
    this.barrelPitch = pitch;
  }

  fireShell(dirOverride) {
    if (this.fireCooldown > 0) return;
    this.fireCooldown = 1.4;
    const origin = this.barrelTip.getWorldPosition(new THREE.Vector3());
    let dir;
    if (dirOverride) dir = dirOverride.clone();
    else if (this.driver) dir = this.game.camera.getWorldDirection(new THREE.Vector3());
    else {
      const tp = (this.aimTarget || this.game.player.position).clone().setY(1.4);
      dir = new THREE.Vector3().subVectors(tp, origin).normalize();
    }
    this.game.enemyManager.spawnShell(origin, dir, this.faction === 'enemy' ? 'enemy' : 'player');
    this.game.effects.impact(origin, dir, 0xffcc66, 8);
    this.game.effects.smoke(origin, 1.2);
    this.game.audio?.tankFire();
    this._recoil = 0.4;
  }

  update(dt) {
    if (!this.alive) return;
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this._recoil > 0) { this._recoil = Math.max(0, this._recoil - dt * 2); this.barrel.position.z = this._recoil; }
    if (this.beacon) this.beacon.position.y = 4.2 + Math.sin((this._t = (this._t || 0) + dt) * 3) * 0.25;
    if (this.mark) this.mark.position.y = 4.4 + Math.sin((this._t = (this._t || 0) + dt) * 3) * 0.15;

    if (this.faction === 'enemy' || this.faction === 'ally') this._combatAI(dt);

    if (this.healthBar.visible && (this.faction === 'enemy' || this.faction === 'ally')) {
      this._hbT -= dt;
      if (this._hbT <= 0) this.healthBar.visible = false;
      const r = Math.max(0.01, this.hp / this.maxHp);
      this.healthFill.scale.x = r;
      this.healthFill.position.x = -(1 - r) * this._hbHalf;
      this.healthBar.quaternion.copy(this.game.camera.quaternion);
    }
  }

  _combatAI(dt) {
    const mgr = this.game.enemyManager;
    let targetPos, hasTarget;
    if (this.faction === 'enemy') {
      targetPos = mgr.pickEnemyTarget(this.position).pos; hasTarget = true;
    } else {
      const e = mgr.nearestEnemy(this.position);
      hasTarget = !!e;
      targetPos = e ? e.position : this.game.player.position;
    }
    this.aimTarget = targetPos;

    const to = new THREE.Vector3().subVectors(targetPos, this.position); to.y = 0;
    const dist = to.length(); to.normalize();

    // 朝目标开（保持中距）
    const desiredYaw = Math.atan2(-to.x, -to.z);
    let dy = desiredYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const turn = Math.max(-1, Math.min(1, dy * 2));
    let drive = 0;
    const keep = this.faction === 'ally' && !hasTarget ? 10 : 32;
    if (dist > keep + 3) drive = 0.6;
    else if (dist < keep - 12) drive = -0.4;
    this.drive(drive, turn, dt);

    // 炮塔瞄准
    const aimWorld = Math.atan2(targetPos.x - this.position.x, targetPos.z - this.position.z);
    let cur = this.turret.rotation.y + this.yaw;
    let d2 = aimWorld - cur;
    while (d2 > Math.PI) d2 -= Math.PI * 2;
    while (d2 < -Math.PI) d2 += Math.PI * 2;
    this.turret.rotation.y += Math.max(-1.2 * dt, Math.min(1.2 * dt, d2));

    // 开火
    this.fireTimer = (this.fireTimer || 2) - dt;
    if (hasTarget && this.fireTimer <= 0 && dist < 90) {
      const origin = this.barrelTip.getWorldPosition(new THREE.Vector3());
      if (mgr.hasLOS(origin, targetPos.clone().setY(1.2))) {
        this.fireShell();
        this.fireTimer = 2.6 + Math.random() * 1.5;
      } else this.fireTimer = 0.5;
    }
  }
}

export { Enemy, Ally, Tank };
