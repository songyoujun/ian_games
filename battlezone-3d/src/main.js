import * as THREE from 'three';
import { Input } from './input.js';
import { buildWorld, WORLD_SIZE, resolveCollision } from './world.js';
import { Effects } from './effects.js';
import { Player } from './player.js';
import { WeaponSystem } from './weapons.js';
import { EnemyManager } from './enemy.js';
import { PickupManager } from './pickups.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';

class Game {
  constructor() {
    // 渲染器
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    document.getElementById('game').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, 600);
    this.scene.add(this.camera);

    // 世界
    const w = buildWorld(this.scene);
    this.obstacles = w.obstacles;
    this.colliders = w.colliders;

    // 子系统
    this.input = new Input(this.renderer.domElement);
    this.audio = new Audio();
    this.ui = new UI();
    this.effects = new Effects(this.scene);
    this.player = new Player(this);
    this.weapons = new WeaponSystem(this);
    this.enemyManager = new EnemyManager(this);
    this.pickups = new PickupManager(this);

    // 状态
    this.state = 'menu'; // menu | playing | paused | gameover
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    this.betweenWaves = true;
    this.waveClearTimer = 0;
    this.menuAngle = 0;
    this.allyTimer = 0; // 每秒生成一个队友

    this.clock = new THREE.Clock();

    this.ui.setWeapon(this.weapons);
    this.ui.hideLoading();

    // 绑定按钮
    this.ui.bind({
      onPlay: () => this.start(),
      onResume: () => this.resume(),
      onRestart: () => { this.ui.hideGameOver(); this.start(); },
    });

    // 指针解锁 -> 暂停
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
    };

    addEventListener('resize', () => this._onResize());
    this._onResize();

    // 主循环
    this.renderer.setAnimationLoop(() => this._loop());
  }

  _onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  start() {
    // 清场
    this.enemyManager.reset();
    this.pickups.reset();
    this.player.reset();
    // 重置武器：只留手枪
    this.weapons.inv = {};
    for (const k in this.weapons.viewModels) this.weapons.viewRoot.remove(this.weapons.viewModels[k]);
    this.weapons.viewModels = {};
    this.weapons.currentId = 'pistol';
    this.weapons.give('pistol', { switch: true });

    this.score = 0; this.kills = 0; this.wave = 0;
    this.ui.setScore(0);
    this.ui.setHealth(this.player.health, this.player.maxHealth);
    this.ui.setWeapon(this.weapons);

    this.pickups.spawnInitial();
    this.enemyManager.spawnNeutralTank(this._openSpotNearPlayer(12));
    // 开局先给几个队友陪着你
    this.allyTimer = 0;
    for (let i = 0; i < 3; i++) this.enemyManager.spawnAlly(i === 0 ? 'tank' : 'rifleman');

    this.audio.init();
    this.ui.showMenu(false);
    this.ui.showPause(false);
    this.ui.hideGameOver();
    this.ui.showHUD(true);
    this.state = 'playing';
    this.betweenWaves = true;
    this.startWave(1);
    this.input.requestLock();
  }

  startWave(n) {
    this.wave = n;
    this.betweenWaves = false;
    const total = this.enemyManager.spawnWave(n);
    this.ui.setWave(n);
    this.ui.setEnemiesLeft(total);
    this.ui.toast(`⚠️ 第 <b>${n}</b> 波来袭！敌军 ${total} 个`);
    // 每隔几波补充一辆可驾驶坦克
    if (n > 1 && n % 3 === 0) {
      this.enemyManager.spawnNeutralTank(this._openSpotNearPlayer(16));
      this.ui.toast('🛠️ 战场上出现一辆可驾驶坦克（绿色光标）');
    }
  }

  _openSpotNearPlayer(dist) {
    const a = Math.random() * Math.PI * 2;
    const pos = new THREE.Vector3(
      this.player.position.x + Math.cos(a) * dist,
      0,
      this.player.position.z + Math.sin(a) * dist,
    );
    const lim = WORLD_SIZE / 2 - 8;
    pos.x = Math.max(-lim, Math.min(lim, pos.x));
    pos.z = Math.max(-lim, Math.min(lim, pos.z));
    resolveCollision(pos, 3, this.obstacles);
    return pos;
  }

  _spawnAllyTick() {
    const mgr = this.enemyManager;
    const tanks = mgr.allies.filter((a) => a.alive && a.isTank).length;
    const soldiers = mgr.allies.filter((a) => a.alive && !a.isTank).length;
    if (tanks < 3 && Math.random() < 0.18) {
      mgr.spawnAlly('tank');
      this.ui.toast('🤝 友军<b>坦克</b>增援到了！');
    } else if (soldiers < 12) {
      const types = ['rifleman', 'rifleman', 'shotgun', 'grunt', 'sniper'];
      mgr.spawnAlly(types[(Math.random() * types.length) | 0]);
    }
  }

  onEnemyKilled(e) {
    this.kills++;
    this.score += e.T ? e.T.score : 800;
    this.ui.setScore(this.score);
    // 偶尔掉落补给
    if (Math.random() < 0.14) this.pickups.spawnHealth(e.position.clone());
  }

  onPlayerDead() {
    this.state = 'gameover';
    this.input.exitLock();
    this.ui.showHUD(false);
    this.ui.showGameOver(this.wave, this.score, this.kills);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitLock();
    this.ui.showPause(true);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.ui.showPause(false);
    this.state = 'playing';
    this.audio.init();
    this.input.requestLock();
  }

  togglePause() {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  _loop() {
    const dt = Math.min(0.05, this.clock.getDelta());

    if (this.state === 'menu') {
      this._menuCamera(dt);
    } else if (this.state === 'playing') {
      this._update(dt);
    }
    // paused / gameover：冻结，但仍渲染

    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  _menuCamera(dt) {
    this.menuAngle += dt * 0.12;
    const r = 34;
    this.camera.position.set(Math.cos(this.menuAngle) * r, 14, Math.sin(this.menuAngle) * r);
    this.camera.lookAt(0, 3, 0);
  }

  _update(dt) {
    const input = this.input;

    if (input.pressed('KeyP')) { this.togglePause(); return; }

    // 武器切换 / 装填（步行时）
    if (!this.player.inTank) {
      for (let i = 1; i <= 5; i++) if (input.pressed('Digit' + i)) this.weapons.switchBySlot(i);
      if (input.wheel !== 0) this.weapons.cycle(input.wheel > 0 ? 1 : -1);
      if (input.pressed('KeyR')) this.weapons.reload();
    }

    // 上 / 下坦克
    this._handleTankInteract();

    // 玩家 + 武器
    this.player.update(dt);
    if (!this.player.inTank && this.input.locked) {
      this.weapons.tryFire(input.fire, input.firePressed);
    }
    this.weapons.update(dt);

    // 每秒来一个队友
    this.allyTimer -= dt;
    if (this.allyTimer <= 0) { this.allyTimer = 1; this._spawnAllyTick(); }

    // 敌人 + 特效 + 拾取
    this.enemyManager.update(dt);
    this.pickups.update(dt);
    this.effects.update(dt);

    // 波次
    this._checkWave(dt);

    // HUD
    this.ui.setHealth(this.player.health, this.player.maxHealth);
    this.ui.setEnemiesLeft(this.enemyManager.aliveCount());
    this.ui.setAllies(this.enemyManager.allyCount());
    if (this.player.inTank) this.ui.showTankHUD(this.player.inTank);
    else this.ui.setAmmo(this.weapons);
  }

  _handleTankInteract() {
    const input = this.input;
    if (this.player.inTank) {
      this.ui.showPrompt('按 <span class="key">E</span> 离开坦克');
      if (input.pressed('KeyE')) { this.player.exitTank(); this.ui.hidePrompt(); }
      return;
    }
    // 找最近可驾驶坦克
    let near = null, best = 6;
    for (const e of this.enemyManager.enemies) {
      if (!e.alive || !(e.faction === 'neutral' || e.faction === 'player') || e.driver) continue;
      const d = Math.hypot(this.player.position.x - e.position.x, this.player.position.z - e.position.z);
      if (d < best) { best = d; near = e; }
    }
    if (near) {
      this.ui.showPrompt('按 <span class="key">E</span> 驾驶坦克 🛡️');
      if (input.pressed('KeyE')) { this.player.enterTank(near); this.ui.hidePrompt(); }
    } else {
      this.ui.hidePrompt();
    }
  }

  _checkWave(dt) {
    if (!this.betweenWaves && this.enemyManager.aliveCount() === 0) {
      this.betweenWaves = true;
      this.waveClearTimer = 3.5;
      this.ui.showWaveClear(this.wave, this.score, `准备迎接第 ${this.wave + 1} 波…`);
      this.ui.toast(`🎖️ 第 ${this.wave} 波清剿完毕！`);
    }
    if (this.betweenWaves && this.waveClearTimer > 0) {
      this.waveClearTimer -= dt;
      if (this.waveClearTimer <= 0) {
        this.ui.hideWaveClear();
        this.startWave(this.wave + 1);
      }
    }
  }
}

// 启动
window.addEventListener('DOMContentLoaded', () => {
  try { window.BZGAME = new Game(); }
  catch (e) { window.__bzerr = String((e && e.stack) || e); console.error('Game init failed:', e); }
});
