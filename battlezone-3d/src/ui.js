import { WEAPONS, WEAPON_ORDER } from './weapons.js';

export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.hud = $('hud');
    this.vignette = $('vignette');
    this.flash = $('flash');
    this.hitmark = $('hitmark');
    this.waveNum = $('wave-num');
    this.enemiesNum = $('enemies-num');
    this.alliesNum = $('allies-num');
    this.scoreNum = $('score-num');
    this.controlsHint = $('controls-hint-body');
    this.hpFill = $('hp-fill');
    this.hpNum = $('hp-num');
    this.weaponIcon = $('weapon-icon');
    this.weaponText = $('weapon-text');
    this.mag = $('mag');
    this.reserve = $('reserve');
    this.reloading = $('reloading');
    this.slots = $('slots');
    this.toasts = $('toasts');
    this.prompt = $('prompt');

    this.menu = $('menu');
    this.pause = $('pause');
    this.waveclear = $('waveclear');
    this.gameover = $('gameover');
    this.loading = $('loading');

    this._buildSlots();
    this._hitT = 0;
  }

  _buildSlots() {
    this.slots.innerHTML = '';
    this.slotEls = {};
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<span class="name">${w.name}</span><span class="ico">${w.icon}</span><span class="num">${w.slot}</span>`;
      this.slots.appendChild(el);
      this.slotEls[id] = el;
    }
  }

  bind({ onPlay, onResume, onRestart }) {
    document.getElementById('play-btn').addEventListener('click', onPlay);
    document.getElementById('resume-btn').addEventListener('click', onResume);
    document.getElementById('restart-btn').addEventListener('click', onRestart);
  }

  hideLoading() { this.loading.classList.add('hidden'); }

  showHUD(v) { this.hud.classList.toggle('hidden', !v); }
  showMenu(v) { this.menu.classList.toggle('hidden', !v); }
  showPause(v) { this.pause.classList.toggle('hidden', !v); }

  showWaveClear(wave, score, nextText) {
    document.getElementById('cleared-wave').textContent = wave;
    document.getElementById('wc-score').textContent = score;
    document.getElementById('wc-next').textContent = nextText;
    this.waveclear.classList.remove('hidden');
  }
  hideWaveClear() { this.waveclear.classList.add('hidden'); }

  showGameOver(wave, score, kills) {
    document.getElementById('go-wave').textContent = wave;
    document.getElementById('go-score').textContent = score;
    document.getElementById('go-kills').textContent = kills;
    this.gameover.classList.remove('hidden');
  }
  hideGameOver() { this.gameover.classList.add('hidden'); }

  setAllies(n) { if (this.alliesNum) this.alliesNum.textContent = n; }

  _footHint() {
    if (this.controlsHint) this.controlsHint.innerHTML =
      '<span class="k">🖱️左键</span> 开火　<span class="k">🖱️右键</span> 瞄准<br>' +
      '<span class="k">R</span> 换子弹　<span class="k">1</span>~<span class="k">5</span> 换武器<br>' +
      '走到绿光坦克旁按 <span class="k">E</span> 开坦克';
  }
  _tankHint() {
    if (this.controlsHint) this.controlsHint.innerHTML =
      '<span class="k">🖱️左键</span> 开炮（大威力！）<br>' +
      '<span class="k">W</span><span class="k">A</span><span class="k">S</span><span class="k">D</span> 开坦克<br>' +
      '按 <span class="k">E</span> 下坦克';
  }

  showTankHUD(tank) {
    this.slots.style.opacity = '0';
    this.weaponIcon.textContent = '🛡️';
    this.weaponText.textContent = '坦克炮';
    this.mag.textContent = Math.max(0, Math.ceil(tank.hp));
    this.reserve.textContent = '❤';
    this.reloading.style.opacity = tank.fireCooldown > 0 ? '1' : '0';
    this.reloading.textContent = '装填炮弹…';
    this._tankHint();
  }

  setWeapon(ws) {
    this.slots.style.opacity = '';       // 退出坦克时恢复武器栏
    this.reloading.textContent = '装填中…';
    this._footHint();
    const w = ws.current();
    this.weaponIcon.textContent = w.icon;
    this.weaponText.textContent = w.name;
    this.setAmmo(ws);
    for (const id of WEAPON_ORDER) {
      const el = this.slotEls[id];
      el.classList.toggle('has', ws.owns(id));
      el.classList.toggle('active', ws.currentId === id);
    }
  }

  setAmmo(ws) {
    const st = ws.state();
    if (!st) return;
    this.mag.textContent = st.mag;
    this.reserve.textContent = st.reserve === Infinity ? '∞' : st.reserve;
  }

  setReloading(v) { this.reloading.style.opacity = v ? '1' : '0'; }

  setHealth(hp, max) {
    const r = Math.max(0, hp / max);
    this.hpFill.style.width = (r * 100) + '%';
    this.hpFill.style.background = r > 0.5
      ? 'linear-gradient(90deg,#22c55e,#4ade80)'
      : r > 0.25 ? 'linear-gradient(90deg,#d97706,#fbbf24)'
      : 'linear-gradient(90deg,#b91c1c,#ef4444)';
    this.hpNum.textContent = Math.ceil(hp);
    // 低血量红边
    this.vignette.style.opacity = r < 0.4 ? String((0.4 - r) / 0.4 * 0.9) : '0';
  }

  setWave(n) { this.waveNum.textContent = n; }
  setEnemiesLeft(n) { this.enemiesNum.textContent = n; }
  setScore(n) { this.scoreNum.textContent = n; }

  hitMarker(headshot) {
    this.hitmark.style.opacity = '1';
    this.hitmark.style.filter = headshot ? 'drop-shadow(0 0 4px #ff0)' : 'none';
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => { this.hitmark.style.opacity = '0'; }, 110);
  }

  damageFlash(intensity = 0.5) {
    this.flash.style.transition = 'none';
    this.flash.style.opacity = String(Math.min(0.6, intensity));
    requestAnimationFrame(() => {
      this.flash.style.transition = 'opacity .4s';
      this.flash.style.opacity = '0';
    });
  }

  toast(html) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html;
    this.toasts.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .4s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 400);
    }, 2000);
  }

  showPrompt(html) { this.prompt.innerHTML = html; this.prompt.style.opacity = '1'; }
  hidePrompt() { this.prompt.style.opacity = '0'; }
}
