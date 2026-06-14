import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { resolveCollision, WORLD_SIZE } from './world.js';

export class PickupManager {
  constructor(game) {
    this.game = game;
    this.items = [];
  }

  reset() {
    for (const p of this.items) this.game.scene.remove(p.group);
    this.items.length = 0;
  }

  // 开局在地图上散布各种武器，方便玩家去捡
  spawnInitial() {
    const types = ['rifle', 'shotgun', 'sniper', 'rocket', 'rifle', 'shotgun'];
    for (const t of types) {
      const a = Math.random() * Math.PI * 2;
      const r = 14 + Math.random() * (WORLD_SIZE / 2 - 24);
      const pos = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      resolveCollision(pos, 1.5, this.game.obstacles);
      this.spawnWeapon(t, pos);
    }
  }

  spawnWeapon(weaponId, pos, ammo = null) {
    const w = WEAPONS[weaponId];
    if (!w) return;
    this.items.push(new Pickup(this.game, 'weapon', weaponId, pos, ammo));
  }

  spawnHealth(pos) {
    this.items.push(new Pickup(this.game, 'health', null, pos));
  }

  update(dt) {
    const p = this.game.player;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.update(dt);
      // 玩家步行经过即拾取（驾驶坦克时不捡枪）
      const d = Math.hypot(p.position.x - it.position.x, p.position.z - it.position.z);
      if (!p.inTank && d < 1.9 && it.life > 0.4) {
        this._collect(it);
        this.game.scene.remove(it.group);
        this.items.splice(i, 1);
      } else if (it.expired) {
        this.game.scene.remove(it.group);
        this.items.splice(i, 1);
      }
    }
  }

  _collect(it) {
    if (it.kind === 'health') {
      this.game.player.heal(40);
      this.game.ui?.toast('🩹 +40 生命值');
      this.game.audio?.pickup();
      return;
    }
    const w = WEAPONS[it.weaponId];
    const had = this.game.weapons.owns(it.weaponId);
    this.game.weapons.give(it.weaponId, { switch: false });
    this.game.audio?.pickup();
    if (had) this.game.ui?.toast(`🔁 补充 <b>${w.name}</b> 弹药`);
    else this.game.ui?.toast(`✓ 捡到 <b>${w.name}</b> ${w.icon}（按数字键 ${w.slot} 切换）`);
    this.game.ui?.setWeapon(this.game.weapons);
  }
}

class Pickup {
  constructor(game, kind, weaponId, pos, ammo = null) {
    this.game = game;
    this.kind = kind;
    this.weaponId = weaponId;
    this.ammo = ammo;
    this.life = 0;
    this.expired = false;
    this.maxLife = kind === 'health' ? 25 : 45; // 掉落物存在时长

    const w = weaponId ? WEAPONS[weaponId] : null;
    const color = kind === 'health' ? 0x33dd66 : (w ? w.color : 0xffffff);
    const icon = kind === 'health' ? '➕' : w.icon;

    const g = new THREE.Group();
    g.position.copy(pos);
    this.group = g;
    this.position = g.position;

    // 地面光环
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.95, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
    g.add(ring);

    // 光柱
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 3, 12, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    beam.position.y = 1.5;
    g.add(beam);

    // 漂浮的图标
    const spr = makeIconSprite(icon);
    spr.position.y = 1.5; spr.scale.set(1.5, 1.5, 1);
    g.add(spr);
    this.icon = spr;

    game.scene.add(g);
  }

  update(dt) {
    this.life += dt;
    this.icon.position.y = 1.5 + Math.sin(this.life * 3) * 0.18;
    this.group.rotation.y += dt * 1.5;
    // 即将消失时闪烁
    const left = this.maxLife - this.life;
    if (left < 5) this.group.visible = Math.sin(left * 12) > -0.3;
    if (this.life > this.maxLife) this.expired = true;
  }
}

const _spriteCache = {};
function makeIconSprite(icon) {
  if (!_spriteCache[icon]) {
    const cvs = document.createElement('canvas');
    cvs.width = cvs.height = 128;
    const ctx = cvs.getContext('2d');
    ctx.font = '92px "Apple Color Emoji","Segoe UI Emoji",serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(icon, 64, 72);
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    _spriteCache[icon] = tex;
  }
  const mat = new THREE.SpriteMaterial({ map: _spriteCache[icon], transparent: true, depthWrite: false });
  return new THREE.Sprite(mat);
}
