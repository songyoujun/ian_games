// 键盘 / 鼠标输入 + 指针锁定（并支持 iPad 触屏）
export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.justPressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.fire = false;   // 左键按住
    this.aim = false;    // 右键按住
    this.firePressed = false; // 这一帧刚按下左键（半自动用）
    this.locked = false;
    this.onLockChange = null;
    // 触屏检测
    this.isTouch = (matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const c = e.code;
      this.keys.add(c);
      this.justPressed.add(c);
      // 阻止空格滚动等
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));

    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });

    addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.fire = true; this.firePressed = true; }
      if (e.button === 2) this.aim = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.aim = false;
    });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += e.deltaY; }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) { this.fire = false; this.aim = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });

    if (this.isTouch) this._setupTouch();
  }

  requestLock() {
    // 触屏没有指针锁定，直接视为已锁定，让开火/视角逻辑生效
    if (this.isTouch) { this.locked = true; return; }
    if (document.pointerLockElement !== this.dom) this.dom.requestPointerLock?.();
  }
  exitLock() {
    if (this.isTouch) { return; } // 保持 locked，游戏靠 state 冻结
    if (document.pointerLockElement === this.dom) document.exitPointerLock?.();
  }

  // ---------- iPad 触屏控制 ----------
  _setupTouch() {
    const css = `
      #tc{position:fixed; inset:0; z-index:15; pointer-events:none; touch-action:none;
        font-family:"PingFang SC","Microsoft YaHei",sans-serif;}
      #tc .zone{position:absolute; top:0; bottom:0; pointer-events:auto; touch-action:none;}
      #tc-move{left:0; width:42%;}
      #tc-look{right:0; width:58%;}
      #tc-base{position:absolute; width:120px; height:120px; margin:-60px 0 0 -60px;
        border-radius:50%; border:3px solid #ffffff55; background:#ffffff14; display:none;}
      #tc-knob{position:absolute; left:50%; top:50%; width:54px; height:54px; margin:-27px 0 0 -27px;
        border-radius:50%; background:#ffd23fcc; border:2px solid #fff; box-shadow:0 2px 8px #0008;}
      #tc .btn-t{position:absolute; pointer-events:auto; touch-action:none; user-select:none;
        display:flex; align-items:center; justify-content:center; flex-direction:column;
        border-radius:50%; color:#fff; font-weight:bold; text-shadow:0 1px 3px #000;
        background:rgba(20,26,45,.55); border:2px solid #ffffff40; line-height:1.05;}
      #tc .btn-t:active, #tc .btn-t.on{background:#ffd23f; color:#241a00; border-color:#fff;}
      #tc .btn-t .ic{font-size:24px;} #tc .btn-t .lb{font-size:11px;}
      #tc-fire{right:26px; bottom:120px; width:96px; height:96px; font-size:16px;
        background:rgba(224,67,43,.6); border-color:#ffb0a0;}
      #tc-aim{right:135px; bottom:150px; width:62px; height:62px;}
      #tc-jump{right:135px; bottom:64px; width:62px; height:62px;}
      #tc-switch{right:34px; bottom:236px; width:62px; height:62px;}
      #tc-reload{right:118px; bottom:236px; width:62px; height:62px;}
      #tc-tank{left:24px; bottom:200px; width:66px; height:66px;
        background:rgba(40,160,90,.6); border-color:#9effc0;}
      #tc-pause{right:16px; top:14px; width:46px; height:46px; font-size:20px;}
      @media (pointer:fine){ #tc{display:none;} }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const tc = document.createElement('div');
    tc.id = 'tc';
    tc.innerHTML = `
      <div id="tc-move" class="zone"><div id="tc-base"><div id="tc-knob"></div></div></div>
      <div id="tc-look" class="zone"></div>
      <div id="tc-fire" class="btn-t"><span class="ic">🔥</span><span class="lb">开火</span></div>
      <div id="tc-aim" class="btn-t"><span class="ic">🎯</span><span class="lb">瞄准</span></div>
      <div id="tc-jump" class="btn-t"><span class="ic">⬆️</span><span class="lb">跳</span></div>
      <div id="tc-switch" class="btn-t"><span class="ic">🔁</span><span class="lb">换枪</span></div>
      <div id="tc-reload" class="btn-t"><span class="ic">🔄</span><span class="lb">装弹</span></div>
      <div id="tc-tank" class="btn-t"><span class="ic">🛡️</span><span class="lb">坦克</span></div>
      <div id="tc-pause" class="btn-t"><span class="ic">⏸️</span></div>
    `;
    document.body.appendChild(tc);

    const $ = (id) => document.getElementById(id);

    // 左摇杆（浮动）：方向映射到 WASD
    const moveZone = $('tc-move'), base = $('tc-base'), knob = $('tc-knob');
    let moveId = null, baseX = 0, baseY = 0;
    const clearMoveKeys = () => { for (const k of ['KeyW','KeyA','KeyS','KeyD','ShiftLeft']) this.keys.delete(k); };
    const setMove = (dx, dy, mag) => {
      clearMoveKeys();
      const t = 0.32;
      if (dy < -t) this.keys.add('KeyW');
      if (dy > t) this.keys.add('KeyS');
      if (dx < -t) this.keys.add('KeyA');
      if (dx > t) this.keys.add('KeyD');
      if (mag > 0.85) this.keys.add('ShiftLeft'); // 推到底=冲刺
    };
    moveZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (moveId !== null) return;
      const t = e.changedTouches[0];
      moveId = t.identifier; baseX = t.clientX; baseY = t.clientY;
      base.style.display = 'block';
      base.style.left = baseX + 'px'; base.style.top = baseY + 'px';
      knob.style.left = '50%'; knob.style.top = '50%';
    }, { passive: false });
    moveZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== moveId) continue;
        const R = 60;
        let dx = t.clientX - baseX, dy = t.clientY - baseY;
        const len = Math.hypot(dx, dy) || 1;
        const cl = Math.min(len, R);
        const nx = dx / len, ny = dy / len;
        knob.style.left = (50 + (nx * cl / R) * 50) + '%';
        knob.style.top = (50 + (ny * cl / R) * 50) + '%';
        setMove(dx / R, dy / R, len / R);
      }
    }, { passive: false });
    const endMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== moveId) continue;
        moveId = null; base.style.display = 'none'; clearMoveKeys();
      }
    };
    moveZone.addEventListener('touchend', endMove);
    moveZone.addEventListener('touchcancel', endMove);

    // 右半屏拖动 = 转视角
    const lookZone = $('tc-look');
    let lookId = null, lastX = 0, lastY = 0;
    const SCALE = 1.4;
    lookZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (lookId !== null) return;
      const t = e.changedTouches[0];
      lookId = t.identifier; lastX = t.clientX; lastY = t.clientY;
    }, { passive: false });
    lookZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== lookId) continue;
        this.mouseDX += (t.clientX - lastX) * SCALE;
        this.mouseDY += (t.clientY - lastY) * SCALE;
        lastX = t.clientX; lastY = t.clientY;
      }
    }, { passive: false });
    const endLook = (e) => {
      for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
    };
    lookZone.addEventListener('touchend', endLook);
    lookZone.addEventListener('touchcancel', endLook);

    // 按钮辅助
    const hold = (id, onDown, onUp) => {
      const el = $(id);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('on'); onDown && onDown(); }, { passive: false });
      const up = (e) => { e.preventDefault(); el.classList.remove('on'); onUp && onUp(); };
      el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
    };
    const tap = (id, fn) => hold(id, fn, null);

    hold('tc-fire', () => { this.fire = true; this.firePressed = true; }, () => { this.fire = false; });
    hold('tc-aim', () => { this.aim = true; }, () => { this.aim = false; });
    tap('tc-jump', () => this.justPressed.add('Space'));
    tap('tc-switch', () => { this.wheel = 100; });
    tap('tc-reload', () => this.justPressed.add('KeyR'));
    tap('tc-tank', () => this.justPressed.add('KeyE'));
    tap('tc-pause', () => this.justPressed.add('KeyP'));

    // 开始菜单：给 iPad 玩家替换成触屏说明
    const menu = document.getElementById('menu');
    if (menu) {
      const ctrls = menu.querySelector('.controls');
      if (ctrls) {
        ctrls.style.gridTemplateColumns = 'auto auto';
        ctrls.innerHTML =
          '<span>👈 左边拖动</span><span>移动（推到底＝冲刺）</span>' +
          '<span>👉 右边拖动</span><span>转身 / 瞄准</span>' +
          '<span>🔥 开火</span><span>按住射击</span>' +
          '<span>🎯 瞄准</span><span>按住更准</span>' +
          '<span>⬆️ 跳 · 🔁 换枪</span><span>🔄 装弹 · 🛡️ 上下坦克</span>';
      }
      // 隐藏“鼠标将被锁定”的提示
      menu.querySelectorAll('p').forEach((p) => {
        if (p.textContent.includes('鼠标') || p.textContent.includes('锁定')) p.style.display = 'none';
      });
    }
  }

  pressed(code) { return this.justPressed.has(code); }
  down(code) { return this.keys.has(code); }

  // 每帧消费完后调用
  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.firePressed = false;
    this.justPressed.clear();
  }
}
