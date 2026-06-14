import * as THREE from 'three';
import { resolveCollision } from './world.js';

const EYE = 1.7;
const BASE_FOV = 78;

export class Player {
  constructor(game) {
    this.game = game;
    this.camera = game.camera;
    this.position = new THREE.Vector3(0, 0, 0); // 脚下
    this.velY = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.radius = 0.5;
    this.onGround = true;

    this.maxHealth = 120;
    this.health = 120;
    this.sinceDamage = 99;
    this.dead = false;

    this.bob = 0;
    this.recoilPitch = 0;

    this.inTank = null;
    this.nearPickup = null;
    this.nearTank = null;

    this.sensitivity = 0.0022;
  }

  reset() {
    this.position.set(0, 0, 0);
    this.velY = 0; this.yaw = 0; this.pitch = 0;
    this.health = this.maxHealth; this.dead = false; this.sinceDamage = 99;
    this.inTank = null;
    this.camera.fov = BASE_FOV;
    this.camera.updateProjectionMatrix();
  }

  addRecoil(amt) { this.recoilPitch += amt; }

  takeDamage(amt, source) {
    if (this.dead) return;
    if (this.inTank) { this.inTank.takeDamage(amt); return; }
    this.health -= amt;
    this.sinceDamage = 0;
    this.game.ui?.damageFlash(Math.min(1, amt / 30));
    this.game.audio?.hurt();
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.game.onPlayerDead();
    }
  }

  heal(amt) {
    this.health = Math.min(this.maxHealth, this.health + amt);
  }

  update(dt) {
    if (this.inTank) { this._updateInTank(dt); return; }
    this._look(dt);
    this._move(dt);
    this._cameraFromState(dt);
    this._regen(dt);
  }

  _look(dt) {
    const input = this.game.input;
    const sens = this.sensitivity * (input.aim ? 0.45 : 1);
    this.yaw -= input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens;
    const lim = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    // 后坐力恢复
    this.recoilPitch = Math.max(0, this.recoilPitch - dt * 1.5);
  }

  _move(dt) {
    const input = this.game.input;
    let fwd = 0, str = 0;
    if (input.down('KeyW') || input.down('ArrowUp')) fwd += 1;
    if (input.down('KeyS') || input.down('ArrowDown')) fwd -= 1;
    if (input.down('KeyD') || input.down('ArrowRight')) str += 1;
    if (input.down('KeyA') || input.down('ArrowLeft')) str -= 1;

    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const speed = (input.aim ? 3.4 : (sprint ? 9.5 : 6)) ;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // 前进方向(yaw=0 朝 -Z)
    let dx = (-sin * fwd + cos * str);
    let dz = (-cos * fwd - sin * str);
    const len = Math.hypot(dx, dz);
    if (len > 0) { dx /= len; dz /= len; }

    this.position.x += dx * speed * dt;
    this.position.z += dz * speed * dt;

    // 跳跃 + 重力
    if (this.onGround && input.pressed('Space')) { this.velY = 7.2; this.onGround = false; }
    this.velY -= 22 * dt;
    this.position.y += this.velY * dt;
    if (this.position.y <= 0) { this.position.y = 0; this.velY = 0; this.onGround = true; }

    resolveCollision(this.position, this.radius, this.game.obstacles);

    // 视图晃动
    if (len > 0 && this.onGround) this.bob += speed * dt * 1.1;
  }

  _cameraFromState(dt) {
    const moving = (this.game.input.down('KeyW') || this.game.input.down('KeyS') ||
      this.game.input.down('KeyA') || this.game.input.down('KeyD')) && this.onGround;
    const bobY = moving ? Math.sin(this.bob * 2) * 0.05 : 0;
    this.camera.position.set(this.position.x, this.position.y + EYE + bobY, this.position.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch + this.recoilPitch;
    this.camera.rotation.z = 0;

    // FOV：瞄准时缩放
    const ws = this.game.weapons;
    const zoom = (this.game.input.aim) ? (ws.current().zoom || 1.18) : 1;
    const targetFov = BASE_FOV / zoom;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
    this.camera.updateProjectionMatrix();
  }

  _regen(dt) {
    this.sinceDamage += dt;
    if (this.sinceDamage > 3.5 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + 14 * dt);
    }
  }

  // ---------- 坦克驾驶 ----------
  enterTank(tank) {
    this.inTank = tank;
    tank.driver = this;
    tank.faction = 'player';
    if (tank.beacon) tank.beacon.visible = false;
    this.game.ui?.toast('已进入坦克 — 火力全开！按住左键开炮');
    this.game.audio?.engine();
  }

  exitTank() {
    const tank = this.inTank;
    if (!tank) return;
    // 在坦克侧面落地
    const off = new THREE.Vector3(Math.cos(tank.yaw) * 4, 0, -Math.sin(tank.yaw) * 4);
    this.position.copy(tank.position).add(off);
    this.position.y = 0;
    resolveCollision(this.position, this.radius, this.game.obstacles);
    tank.driver = null;
    this.inTank = null;
    if (tank.beacon) tank.beacon.visible = true; // 方便再次找到
    this.camera.fov = BASE_FOV; this.camera.updateProjectionMatrix();
    this.game.ui?.setWeapon(this.game.weapons); // 恢复武器 HUD
    this.game.ui?.toast('已离开坦克');
  }

  _updateInTank(dt) {
    const input = this.game.input;
    const tank = this.inTank;

    // 鼠标控制炮塔/镜头朝向
    this.yaw -= input.mouseDX * this.sensitivity;
    this.pitch -= input.mouseDY * this.sensitivity;
    this.pitch = Math.max(-0.5, Math.min(0.35, this.pitch));

    // 驾驶
    let drive = 0, turn = 0;
    if (input.down('KeyW') || input.down('ArrowUp')) drive += 1;
    if (input.down('KeyS') || input.down('ArrowDown')) drive -= 1;
    if (input.down('KeyA') || input.down('ArrowLeft')) turn += 1;
    if (input.down('KeyD') || input.down('ArrowRight')) turn -= 1;
    tank.drive(drive, turn, dt);

    // 炮塔朝向相机
    tank.aimTurret(this.yaw, this.pitch);

    // 开火
    if (input.fire && tank.canFire()) tank.fireShell();

    // 第三人称镜头
    const camDist = 11, camHeight = 6;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const back = new THREE.Vector3(sin, 0, cos); // 朝向后方
    const camPos = tank.position.clone()
      .add(back.multiplyScalar(camDist))
      .add(new THREE.Vector3(0, camHeight, 0));
    this.camera.position.lerp(camPos, Math.min(1, dt * 8));
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch - 0.18;
    this.camera.rotation.z = 0;

    const targetFov = BASE_FOV + 6;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
    this.camera.updateProjectionMatrix();
  }
}
