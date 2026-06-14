// 键盘 / 鼠标输入 + 指针锁定
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
  }

  requestLock() {
    if (document.pointerLockElement !== this.dom) this.dom.requestPointerLock?.();
  }
  exitLock() {
    if (document.pointerLockElement === this.dom) document.exitPointerLock?.();
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
