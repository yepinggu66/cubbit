/**
 * 窗口管理：桌宠透明窗 + 三个面板窗（设置 / 商店 / 引导）。
 *
 * 桌宠窗要点：
 *  - 透明、无边框、置顶、不占任务栏、不可聚焦（不抢用户焦点）
 *  - 用主进程 30ms 轮询鼠标位置 + 渲染层上报的命中矩形来实现「像素级点击穿透」
 *  - 拖动时主进程跟随鼠标移动窗口，避免 `-webkit-app-region: drag` 吃掉点击事件
 */
const path = require('node:path');
const { BrowserWindow, screen, shell, app } = require('electron');
const { PetBrain } = require('./pet-brain');

const PET_W = 380;
const PET_H = 470;
const PET_MARGIN_RIGHT = 36;
const PET_MARGIN_BOTTOM = 4;
// 贴边：松手时方块仔可见身体离屏幕边缘小于这个距离就吸附过去
const SNAP_PX = 28;
// 半隐藏：贴在左/右边时只露出身体的这个比例，鼠标移上去滑出来
const PEEK_RATIO = 0.36;
const PEEK_HIDE_DELAY = 1200;
const OPAQUE_PET = process.argv.includes('--opaque-pet');
const DEBUG_INTERACTIONS = process.argv.includes('--debug-interactions');
function dlog(...args) { if (DEBUG_INTERACTIONS) console.log('[interaction]', ...args); }

const PANEL_SIZES = {
  settings: { width: 900, height: 720, minWidth: 780, minHeight: 600, title: '方块仔 设置' },
  paywall: { width: 920, height: 780, minWidth: 760, minHeight: 620, title: '方块仔 · 购买 / 激活' },
  store: { width: 1040, height: 760, minWidth: 880, minHeight: 640, title: '方块仔 商店' },
  onboarding: { width: 860, height: 600, minWidth: 760, minHeight: 540, title: '欢迎来到 方块仔' },
  coupleRoom: { dir: 'couple-room', width: 1000, height: 700, minWidth: 860, minHeight: 620, title: '方块仔 情侣空间' },
  couple: { width: 900, height: 720, minWidth: 800, minHeight: 620, title: '方块仔 情侣模式' },
  chat: { width: 900, height: 680, minWidth: 760, minHeight: 560, title: '方块仔 聊天' },
  wardrobe: { dir: 'wardrobe', width: 980, height: 720, minWidth: 720, minHeight: 560, title: '方块仔 · 形象馆' },
  ledger: { dir: 'ledger', width: 960, height: 780, minWidth: 780, minHeight: 620, title: '方块仔 · 人生账本' },
  photo: { dir: 'photo', width: 940, height: 780, minWidth: 760, minHeight: 620, title: '方块仔 · 拍一只' },
  mate: { dir: 'mate', width: 1040, height: 800, minWidth: 820, minHeight: 640, title: '方块仔 · 相亲角' },
};

class WindowManager {
  constructor(runtime, opts = {}) {
    this.rt = runtime;
    this.petWindow = null;
    this.panels = new Map();
    this.petVisible = true;
    this.dragging = null;
    this.brain = opts.brain || new PetBrain({
      file: opts.brainFile || path.join(app.getPath('userData'), 'pet-brain.json'),
    });
  }

  // ---------------------------------------------------------------- 桌宠窗口
  petScale() {
    const v = Number(this.rt.settings.get('sizeScale')) || 1;
    return Math.max(0.75, Math.min(1.4, v));
  }

  /** 宠物窗口高度随大小设置变化（否则放大后会被裁掉） */
  petHeight() {
    return Math.round(PET_H * this.petScale());
  }

  petWidth() {
    const count = Math.max(1, Math.min(3, this.rt.settings.get('multiPetCount') || 1));
    // 情侣模式会在旁边多渲染一只「TA 的方块仔」，窗口留出位置，气泡才不会被挤窄
    const partner = this.rt && this.rt.hasPartnerPet && this.rt.hasPartnerPet() ? 165 : 0;
    return Math.round((PET_W + (count - 1) * 175 + partner) * this.petScale());
  }

  /** 绕桌面走一圈：沿屏幕四条边走一圈再回到原位（2026-11-05） */
  roam() {
    const win = this.petWindow;
    if (!win || win.isDestroyed()) return { ok: false };
    if (this._roam) return { ok: false, busy: true };
    if (this.dragging) return { ok: false, busy: true };
    const [w, h] = [this.petWidth(), this.petHeight()];
    const disp = screen.getDisplayMatching(win.getBounds()).workArea;
    const m = 4;
    const left = Math.round(disp.x + m);
    const right = Math.round(disp.x + disp.width - w - m);
    const top = Math.round(disp.y + m);
    const bottom = Math.round(disp.y + disp.height - h - m);
    const start = win.getPosition();
    const sx = Math.max(left, Math.min(right, start[0]));
    const sy = Math.max(top, Math.min(bottom, start[1]));

    // 路径：先贴到底边 → 右 → 上 → 左 → 下 → 回原位
    const pts = [
      [sx, bottom],
      [right, bottom],
      [right, top],
      [left, top],
      [left, bottom],
      [sx, bottom],
      [sx, sy],
    ];
    this.edge = null;
    this.peek = null;
    this._roam = { timer: null, cancelled: false };
    this.rt.sendToPet('pet:event', { kind: 'walk-start', payload: { dir: 1 } });

    let seg = 0;
    let lastDir = 1;
    let cur = [sx, sy];
    const speed = 190; // px/s
    const tick = 16;
    this._roam.timer = setInterval(() => {
      if (!this._roam || this._roam.cancelled) return;
      if (!win || win.isDestroyed()) { this.stopRoam(); return; }
      const target = pts[seg];
      const dx = target[0] - cur[0];
      const dy = target[1] - cur[1];
      const dist = Math.hypot(dx, dy);
      const step = (speed * tick) / 1000;
      if (dist <= step) {
        cur = [target[0], target[1]];
        seg += 1;
        if (seg >= pts.length) {
          this._place(win, start[0], start[1]);
          this.stopRoam();
          this.rt.sendToPet('pet:event', { kind: 'walk-end', payload: {} });
          return;
        }
      } else {
        cur = [cur[0] + (dx / dist) * step, cur[1] + (dy / dist) * step];
      }
      const dir = dx > 1 ? 1 : dx < -1 ? -1 : lastDir;
      if (dir !== lastDir) {
        lastDir = dir;
        this.rt.sendToPet('pet:event', { kind: 'walk-dir', payload: { dir } });
      }
      this._place(win, Math.round(cur[0]), Math.round(cur[1]));
    }, tick);
    return { ok: true };
  }

  stopRoam() {
    if (this._roam) {
      if (this._roam.timer) clearInterval(this._roam.timer);
      this._roam = null;
      try { this.rt.sendToPet('pet:event', { kind: 'walk-end', payload: {} }); } catch { /* ignore */ }
    }
  }

  /** 低频自动小步巡游：只在桌面空闲时走一小段，不绕完整圈。 */
  scheduleAutoRoam(delayMs) {
    clearTimeout(this._autoRoamTimer);
    this._autoRoamTimer = null;
    if (!this.petWindow || this.petWindow.isDestroyed()) return false;
    if (this.rt.settings.get('petRoamEnabled') === false) return false;
    const qa = process.argv.includes('--qa-auto-roam');
    const wait = Number.isFinite(delayMs)
      ? Math.max(250, delayMs)
      : qa
        ? 900
        : this._autoRoamFirst !== false
          ? 8000 + Math.random() * 6000
          : 18000 + Math.random() * 12000;
    this._autoRoamFirst = false;
    this._autoRoamTimer = setTimeout(() => {
      this._autoRoamTimer = null;
      if (!this._canAutoRoam()) {
        this.scheduleAutoRoam(qa ? 900 : undefined);
        return;
      }
      const presence = this.rt.presence && this.rt.presence.snapshot ? this.rt.presence.snapshot() : {};
      const decision = qa
        ? { action: 'walk', scene: 'curious_sniff', reason: 'qa', energy: 50, curiosity: 50, social: 50 }
        : this.brain.observe({
            visible: true,
            busy: false,
            pointerNear: false,
            enabled: this.rt.settings.get('petRoamEnabled') !== false,
            paired: !!(this.rt.hasPartnerPet && this.rt.hasPartnerPet()),
            presenceKind: presence.kind || 'working',
            lastInteractionAt: this.rt.lastPetInteractionAt || 0,
          });
      if (!decision) {
        this.scheduleAutoRoam(qa ? 900 : 8000 + Math.random() * 6000);
        return;
      }
      try { if (this.rt.beta) this.rt.beta.log('autonomy_action', decision); } catch { /* ignore */ }
      this.performAutonomy(decision, {
        qa,
        onDone: () => this.scheduleAutoRoam(qa ? 900 : 18000 + Math.random() * 12000),
      });
    }, wait);
    if (this._autoRoamTimer.unref) this._autoRoamTimer.unref();
    return true;
  }

  stopAutoRoam() {
    clearTimeout(this._autoRoamTimer);
    this._autoRoamTimer = null;
    this.cancelAutoStroll();
  }

  _canAutoRoam() {
    const win = this.petWindow;
    if (!win || win.isDestroyed() || !win.isVisible() || !this.petVisible) return false;
    if (this.dragging || this.peek || this._roam || this._anim || this._autoStroll) return false;
    if (this.rt.settings.get('petRoamEnabled') === false) return false;
    if (this.rt.lastPetInteractionAt && Date.now() - this.rt.lastPetInteractionAt < 12000) return false;
    if (this.rt._cinema) return false;
    const presence = this.rt.presence && this.rt.presence.snapshot ? this.rt.presence.snapshot() : null;
    if (presence && ['meeting', 'game', 'video', 'cinema'].includes(presence.kind)) return false;
    const cursor = screen.getCursorScreenPoint();
    const b = win.getBounds();
    if (
      cursor.x >= b.x - 100 &&
      cursor.x <= b.x + b.width + 100 &&
      cursor.y >= b.y - 100 &&
      cursor.y <= b.y + b.height + 100
    ) return false;
    return true;
  }

  stroll({ automatic = false, qa = false, onDone, decision = {} } = {}) {
    const win = this.petWindow;
    if (!win || win.isDestroyed() || this.dragging || this._roam || this._autoStroll) return false;
    const [x, y] = win.getPosition();
    const [w, h] = [this.petWidth(), this.petHeight()];
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const left = wa.x;
    const right = wa.x + wa.width - w;
    const minStep = 140;
    const maxStep = 360;
    let dir = Math.random() < 0.5 ? -1 : 1;
    const available = dir < 0 ? x - left : right - x;
    if (available < minStep) dir *= -1;
    const maxDistance = dir < 0 ? x - left : right - x;
    if (maxDistance < 40) return false;
    const distance = Math.min(maxDistance, minStep + Math.random() * (maxStep - minStep));
    const targetX = Math.round(x + dir * distance);
    const targetY = Math.round(wa.y + wa.height - h);
    const duration = Math.max(1200, Math.min(4200, Math.round((distance / 110) * 1000)));
    const startedAt = Date.now();
    this.edge = null;
    this.peek = null;
    this.rt.sendToPet('pet:event', { kind: 'walk-start', payload: { dir, scene: decision.scene || '' } });
    this.rt.sendToPet('pet:event', { kind: 'walk-dir', payload: { dir, scene: decision.scene || '' } });
    if (qa) console.log('[auto-roam] start', x, y, '->', targetX, targetY);

    const finish = (completed) => {
      if (!this._autoStroll) return;
      clearInterval(this._autoStroll.timer);
      this._autoStroll = null;
      try {
        this.rt.sendToPet('pet:event', {
          kind: 'walk-end',
          payload: { completed, scene: decision.scene || '' },
        });
      } catch { /* ignore */ }
      let px = x;
      let py = y;
      try { [px, py] = win.getPosition(); } catch { /* destroyed */ }
      this.rt.settings.patch({ petPosition: { x: px, y: py, edge: null } });
      if (qa) console.log('[auto-roam]', completed ? 'end' : 'cancelled', px, py);
      if (onDone) onDone();
    };

    this._autoStroll = {
      kind: 'walk',
      timer: setInterval(() => {
        if (!this._autoStroll || win.isDestroyed() || !win.isVisible()) {
          finish(false);
          return;
        }
        if (this.rt.lastPetInteractionAt && this.rt.lastPetInteractionAt > startedAt) {
          finish(false);
          return;
        }
        const elapsed = Date.now() - startedAt;
        const t = Math.min(1, elapsed / duration);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this._place(
          win,
          Math.round(x + (targetX - x) * ease),
          Math.round(y + (targetY - y) * ease)
        );
        if (t >= 1) finish(true);
      }, 16),
    };
    if (this._autoStroll.timer.unref) this._autoStroll.timer.unref();
    return true;
  }

  performAutonomy(decision, { qa = false, onDone } = {}) {
    const done = onDone || (() => {});
    if (!decision || !decision.action) {
      done();
      return false;
    }
    if (decision.action === 'walk') {
      const started = this.stroll({ automatic: true, qa, onDone: done, decision });
      if (!started) done();
      return started;
    }
    if (decision.action === 'crawl') return this.crawlAutonomously({ qa, onDone: done, decision });
    if (decision.action === 'jump') return this.hopAutonomously({ qa, onDone: done, decision });
    if (decision.action === 'climb') return this.climbAutonomously({ qa, onDone: done, decision });
    if (decision.action === 'rest') {
      this.rt.sendToPet('pet:event', { kind: 'autonomy-rest', payload: decision });
      setTimeout(done, qa ? 800 : 6500);
      return true;
    }
    if (decision.action === 'seek_attention') {
      this.rt.sendToPet('pet:event', { kind: 'autonomy-seek', payload: decision });
      setTimeout(done, qa ? 800 : 5000);
      return true;
    }
    this.rt.sendToPet('pet:event', { kind: 'autonomy-think', payload: decision });
    setTimeout(done, qa ? 800 : 5200);
    return true;
  }

  crawlAutonomously({ qa = false, onDone, decision = {} } = {}) {
    const win = this.petWindow;
    if (!win || win.isDestroyed() || this.dragging || this._autoStroll) return false;
    const [x] = win.getPosition();
    const [w, h] = [this.petWidth(), this.petHeight()];
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const left = wa.x;
    const right = wa.x + wa.width - w;
    const groundY = wa.y + wa.height - h;
    const minStep = 90;
    const maxStep = 280;
    let dir = Math.random() < 0.5 ? -1 : 1;
    const available = dir < 0 ? x - left : right - x;
    if (available < minStep) dir *= -1;
    const maxDistance = dir < 0 ? x - left : right - x;
    if (maxDistance < 40) return false;
    const distance = Math.min(maxDistance, minStep + Math.random() * (maxStep - minStep));
    const targetX = Math.round(x + dir * distance);
    const duration = Math.max(1900, Math.min(4600, Math.round((distance / 58) * 1000)));
    const startedAt = Date.now();
    this.edge = null;
    this.peek = null;
    this._place(win, x, groundY);
    this.rt.sendToPet('pet:event', {
      kind: 'crawl-start',
      payload: { dir, scene: decision.scene || 'belly_crawl' },
    });
    if (qa) console.log('[ground-crawl] start', x, groundY, '->', targetX, groundY);

    const finish = (completed) => {
      if (!this._autoStroll) return;
      clearInterval(this._autoStroll.timer);
      this._autoStroll = null;
      let px = targetX;
      let py = groundY;
      try { [px, py] = win.getPosition(); } catch { /* destroyed */ }
      this.rt.settings.patch({ petPosition: { x: px, y: py, edge: null } });
      this.rt.sendToPet('pet:event', {
        kind: 'crawl-end',
        payload: { completed, scene: decision.scene || 'belly_crawl' },
      });
      if (qa) console.log('[ground-crawl]', completed ? 'end' : 'cancelled', px, py);
      if (onDone) onDone();
    };

    this._autoStroll = {
      kind: 'crawl',
      timer: setInterval(() => {
        if (!this._autoStroll || win.isDestroyed() || !win.isVisible()) {
          finish(false);
          return;
        }
        if (this.rt.lastPetInteractionAt && this.rt.lastPetInteractionAt > startedAt) {
          finish(false);
          return;
        }
        const t = Math.min(1, (Date.now() - startedAt) / duration);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this._place(win, Math.round(x + (targetX - x) * ease), groundY);
        if (t >= 1) finish(true);
      }, 16),
    };
    if (this._autoStroll.timer.unref) this._autoStroll.timer.unref();
    return true;
  }

  hopAutonomously({ qa = false, onDone, decision = {} } = {}) {
    const win = this.petWindow;
    if (!win || win.isDestroyed() || this.dragging || this._autoStroll) return false;
    const [x, y] = win.getPosition();
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const lift = Math.min(42, Math.max(18, Math.round(this.petHeight() * 0.07)));
    const top = Math.max(wa.y, y - lift);
    const startedAt = Date.now();
    const duration = 850;
    this.rt.sendToPet('pet:event', {
      kind: 'jump-start',
      payload: { dir: 1, scene: decision.scene || '' },
    });
    const finish = (completed) => {
      if (!this._autoStroll) return;
      clearInterval(this._autoStroll.timer);
      this._autoStroll = null;
      let px = x;
      let py = y;
      try { [px, py] = win.getPosition(); } catch { /* destroyed */ }
      this.rt.settings.patch({ petPosition: { x: px, y: py, edge: null } });
      this.rt.sendToPet('pet:event', {
        kind: 'jump-end',
        payload: { completed, scene: decision.scene || '' },
      });
      if (qa) console.log('[autonomy]', completed ? 'jump-end' : 'jump-cancelled', px, py);
      if (onDone) onDone();
    };
    this._autoStroll = {
      kind: 'jump',
      timer: setInterval(() => {
        if (!this._autoStroll || win.isDestroyed()) {
          finish(false);
          return;
        }
        const t = Math.min(1, (Date.now() - startedAt) / duration);
        const arc = Math.sin(Math.PI * t);
        this._place(win, x, Math.round(y + (top - y) * arc));
        if (t >= 1) finish(true);
      }, 16),
    };
    if (this._autoStroll.timer.unref) this._autoStroll.timer.unref();
    return true;
  }

  climbAutonomously({ qa = false, onDone, decision = {} } = {}) {
    const win = this.petWindow;
    if (!win || win.isDestroyed() || this.dragging || this._autoStroll) return false;
    const [x0, y0] = win.getPosition();
    const [w, h] = [this.petWidth(), this.petHeight()];
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const left = wa.x;
    const right = wa.x + wa.width - w;
    const edge = x0 - left <= right - x0 ? 'left' : 'right';
    const targetX = edge === 'left' ? left : right;
    const targetY = Math.max(wa.y, y0 - 72);
    const duration = 1700;
    const startedAt = Date.now();
    this.rt.sendToPet('pet:event', {
      kind: 'walk-start',
      payload: { dir: targetX < x0 ? -1 : 1, scene: decision.scene || '' },
    });
    const finish = (completed) => {
      if (!this._autoStroll) return;
      clearInterval(this._autoStroll.timer);
      this._autoStroll = null;
      let px = targetX;
      let py = targetY;
      try { [px, py] = win.getPosition(); } catch { /* destroyed */ }
      this.rt.settings.patch({ petPosition: { x: px, y: py, edge } });
      this.rt.sendToPet('pet:event', {
        kind: 'climb-end',
        payload: { edge, completed, scene: decision.scene || '' },
      });
      this.rt.sendToPet('pet:event', {
        kind: 'walk-end',
        payload: { completed, scene: decision.scene || '' },
      });
      if (qa) console.log('[autonomy]', completed ? 'climb-end' : 'climb-cancelled', px, py);
      if (onDone) onDone();
    };
    this._autoStroll = {
      kind: 'climb',
      timer: setInterval(() => {
        if (!this._autoStroll || win.isDestroyed()) {
          finish(false);
          return;
        }
        const t = Math.min(1, (Date.now() - startedAt) / duration);
        const horizontal = Math.min(1, t / 0.45);
        const vertical = Math.max(0, (t - 0.45) / 0.55);
        if (t <= 0.45) {
          const ease = 1 - Math.pow(1 - horizontal, 3);
          this._place(win, Math.round(x0 + (targetX - x0) * ease), y0);
        } else {
          if (!this._autoStroll.climbing) {
            this._autoStroll.climbing = true;
            this.rt.sendToPet('pet:event', {
              kind: 'climb',
              payload: { edge, scene: decision.scene || '' },
            });
          }
          const ease = 1 - Math.pow(1 - vertical, 3);
          this._place(win, targetX, Math.round(y0 + (targetY - y0) * ease));
        }
        if (t >= 1) finish(true);
      }, 16),
    };
    if (this._autoStroll.timer.unref) this._autoStroll.timer.unref();
    return true;
  }

  cancelAutoStroll() {
    if (!this._autoStroll) return;
    const kind = this._autoStroll.kind || 'walk';
    clearInterval(this._autoStroll.timer);
    this._autoStroll = null;
    try {
      if (kind === 'jump') this.rt.sendToPet('pet:event', { kind: 'jump-end', payload: { completed: false } });
      else if (kind === 'climb') {
        this.rt.sendToPet('pet:event', { kind: 'climb-end', payload: { completed: false } });
        this.rt.sendToPet('pet:event', { kind: 'walk-end', payload: {} });
      } else if (kind === 'crawl') {
        this.rt.sendToPet('pet:event', { kind: 'crawl-end', payload: { completed: false } });
      } else this.rt.sendToPet('pet:event', { kind: 'walk-end', payload: {} });
    } catch { /* ignore */ }
  }

  /** 大小设置变化时，重设宠物窗口尺寸并夹回屏幕内 */
  resizePet() {
    const win = this.petWindow;
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    const w = this.petWidth();
    const h = this.petHeight();
    const c = this._clampToDisplay(x, y, w, h);
    try {
      win.setBounds({ x: c.x, y: c.y, width: w, height: h });
    } catch {
      /* ignore */
    }
  }

  createPet() {
    if (this.petWindow && !this.petWindow.isDestroyed()) return this.petWindow;
    const wa = screen.getPrimaryDisplay().workArea;
    const width = this.petWidth();
    const pos = this.rt.settings.get('petPosition');
    const x = pos && Number.isFinite(pos.x) ? pos.x : Math.round(wa.x + wa.width - width - PET_MARGIN_RIGHT);
    const y = pos && Number.isFinite(pos.y) ? pos.y : Math.round(wa.y + wa.height - this.petHeight() - PET_MARGIN_BOTTOM);

    const start = this._clampToDisplay(x, y, width, this.petHeight());
    this.edge = pos && (pos.edge === 'left' || pos.edge === 'right') ? pos.edge : null;
    this.peek = null;
    const win = new BrowserWindow({
      width,
      height: this.petHeight(),
      x: start.x,
      y: start.y,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false, // 拖动由主进程接管
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      focusable: false,
      show: false,
      backgroundColor: OPAQUE_PET ? '#223344' : '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'pet.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        spellcheck: false,
        devTools: true,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.on('console-message', (_e, level, message, line, source) => {
      console.log('[pet-console]', level, message, source + ':' + line);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.log('[pet-fail-load]', code, desc, url);
    });
    win.webContents.on('preload-error', (_e, p, err) => {
      console.log('[pet-preload-error]', p, err && err.message);
    });
    win.webContents.once('dom-ready', () => console.log('[pet] dom-ready'));
    win.loadFile(path.join(__dirname, '..', 'renderer', 'pet', 'index.html')).then(() => {
      // 透明窗口在 Windows 上 ready-to-show 有时不触发，确保页面加载完成后直接显示
      if (!win.isDestroyed() && !win.isVisible()) win.showInactive();
      // 等渲染层报上真实身体位置后再校正一次（换了显示器 / 分辨率也不会跑到屏幕外）
      setTimeout(() => this.ensureOnScreen(), 900);
    });
    win.once('ready-to-show', () => {
      win.showInactive();
      this.petVisible = true;
      if (this.rt.power) this.rt.power.update();
      this.rt.broadcastState();
    });
    win.on('closed', () => {
      this.petWindow = null;
    });
    win.on('show', () => {
      this.petVisible = true;
      if (this.rt.power) this.rt.power.update();
      this.rt.broadcastState();
    });
    win.on('hide', () => {
      this.petVisible = false;
      if (this.rt.power) this.rt.power.update();
      this.rt.broadcastState();
    });
    this.petWindow = win;

    this.startHitTestLoop();
    this.scheduleAutoRoam();
    return win;
  }

  _clampX(x, width) {
    const wa = screen.getPrimaryDisplay().workArea;
    // 至少保证窗口有 80px 在屏幕内，避免保存的位置在换显示器后完全消失
    const minX = Math.round(wa.x - width + 80);
    const maxX = Math.round(wa.x + wa.width - 80);
    return Math.min(Math.max(minX, Math.round(x)), Math.max(minX, maxX));
  }

  _clampY(y) {
    const wa = screen.getPrimaryDisplay().workArea;
    // 宠物默认贴底：窗口底部不得超出工作区，否则会出现「启动了但看不到宠物」
    const minY = Math.round(wa.y - 40);
    const maxY = Math.round(wa.y + wa.height - this.petHeight());
    return Math.min(Math.max(minY, Math.round(y)), Math.max(minY, maxY));
  }

  /**
   * 方块仔「看得见的身体」在窗口里的矩形（窗口是透明的，四周有给气泡 / 粒子留的空白）。
   * 由渲染层随命中框一起上报；还没上报时按默认布局估算（身体在窗口底部居中）。
   */
  _bodyRect(width, height) {
    const b = this.rt.petBody;
    if (b && b.w > 8 && b.h > 8 && b.x + b.w <= width + 4 && b.y + b.h <= height + 4) return b;
    const bw = Math.min(width, 190);
    return { x: Math.round((width - bw) / 2), y: height - 200, w: bw, h: 190 };
  }

  /**
   * 移动桌宠窗：用 setBounds 固定宽高。Windows 缩放 125%/150% 时反复 setPosition
   * 会让透明窗口每次被取整放大一点（Electron 已知问题），拖久了窗口会变得巨大。
   */
  _place(win, x, y) {
    if (!win || win.isDestroyed()) return;
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: this.petWidth(), height: this.petHeight() });
  }

  _workAreaFor(pt) {
    return screen.getDisplayNearestPoint({ x: Math.round(pt.x), y: Math.round(pt.y) }).workArea;
  }

  /**
   * 以可见身体为准夹到工作区内：身体可以贴到任意边 / 角（含任务栏那一侧），
   * 但永远不会整只跑出屏幕。refPoint（拖动时为鼠标位置）决定用哪块显示器。
   */
  _clampToDisplay(x, y, width, height, refPoint, opts = {}) {
    const b = this._bodyRect(width, height);
    const ref = refPoint || { x: x + b.x + b.w / 2, y: y + b.y + b.h / 2 };
    const wa = this._workAreaFor(ref);
    const peekOut = opts.peek ? Math.round(b.w * (1 - PEEK_RATIO)) : 0;
    const minX = wa.x - b.x - (opts.peek === 'left' ? peekOut : 0);
    const maxX = wa.x + wa.width - (b.x + b.w) + (opts.peek === 'right' ? peekOut : 0);
    const minY = wa.y - b.y;
    const maxY = wa.y + wa.height - (b.y + b.h);
    return {
      x: Math.round(Math.min(Math.max(minX, x), Math.max(minX, maxX))),
      y: Math.round(Math.min(Math.max(minY, y), Math.max(minY, maxY))),
      wa,
      body: b,
    };
  }

  /** 松手吸附：身体离某条边 < SNAP_PX 就贴过去；返回新位置和贴住的左右边 */
  _snap(x, y, width, height) {
    const c = this._clampToDisplay(x, y, width, height);
    const { wa, body: b } = c;
    let nx = c.x;
    let ny = c.y;
    let edge = null;
    const left = nx + b.x - wa.x;
    const right = wa.x + wa.width - (nx + b.x + b.w);
    const top = ny + b.y - wa.y;
    const bottom = wa.y + wa.height - (ny + b.y + b.h);
    if (left <= SNAP_PX && left <= right) { nx = wa.x - b.x; edge = 'left'; }
    else if (right <= SNAP_PX) { nx = wa.x + wa.width - (b.x + b.w); edge = 'right'; }
    if (bottom <= SNAP_PX) ny = wa.y + wa.height - (b.y + b.h);
    else if (top <= SNAP_PX) ny = wa.y - b.y;
    return { x: Math.round(nx), y: Math.round(ny), edge, wa };
  }

  /** 半隐藏位置：贴左 / 右边时只露出 PEEK_RATIO 的身体 */
  _peekPos(x, y, width, height, edge) {
    const b = this._bodyRect(width, height);
    const wa = this._workAreaFor({ x: x + b.x + b.w / 2, y: y + b.y + b.h / 2 });
    const hide = Math.round(b.w * (1 - PEEK_RATIO));
    if (edge === 'left') return { x: wa.x - b.x - hide, y };
    return { x: wa.x + wa.width - (b.x + b.w) + hide, y };
  }

  _animateTo(tx, ty, ms = 180) {
    const win = this.petWindow;
    if (!win || win.isDestroyed()) return;
    if (this._anim) clearInterval(this._anim);
    const [sx, sy] = win.getPosition();
    const t0 = Date.now();
    this._anim = setInterval(() => {
      if (!win || win.isDestroyed()) { clearInterval(this._anim); this._anim = null; return; }
      const k = Math.min(1, (Date.now() - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      this._place(win, Math.round(sx + (tx - sx) * e), Math.round(sy + (ty - sy) * e));
      if (k >= 1) { clearInterval(this._anim); this._anim = null; }
    }, 15);
  }

  edgeHideEnabled() {
    return !!this.rt.settings.get('petEdgeHide');
  }

  /** 进入半隐藏（只在贴着左 / 右边、且设置开启时） */
  tuckIn() {
    const win = this.petWindow;
    if (!win || win.isDestroyed() || this.dragging || !this.edge || !this.edgeHideEnabled()) return false;
    const [x, y] = win.getPosition();
    const [w, h] = [this.petWidth(), this.petHeight()];
    const home = this.peek ? this.peek.home : { x, y };
    const p = this._peekPos(home.x, home.y, w, h, this.edge);
    this.peek = { home, out: false, leaveAt: 0 };
    this._animateTo(p.x, p.y, 220);
    this.rt.sendToPet('pet:event', { kind: 'edge-peek', payload: { edge: this.edge, out: false } });
    return true;
  }

  slideOut() {
    if (!this.peek || this.peek.out) return;
    this.peek.out = true;
    this.peek.leaveAt = 0;
    this._animateTo(this.peek.home.x, this.peek.home.y, 160);
    this.rt.sendToPet('pet:event', { kind: 'edge-peek', payload: { edge: this.edge, out: true } });
  }

  /** 设置里开关半隐藏时调用 */
  applyEdgeHide() {
    if (this.edgeHideEnabled()) return this.tuckIn();
    if (this.peek) {
      const home = this.peek.home;
      this.peek = null;
      this._animateTo(home.x, home.y, 160);
    }
    return true;
  }

  /** 校正到屏幕内（启动、显示器变化时）；不会改变「贴边」状态 */
  ensureOnScreen() {
    const win = this.petWindow;
    if (!win || win.isDestroyed() || this.dragging) return;
    const [x, y] = win.getPosition();
    const [w, h] = [this.petWidth(), this.petHeight()];
    if (this.peek) {
      const c = this._clampToDisplay(this.peek.home.x, this.peek.home.y, w, h);
      this.peek.home = { x: c.x, y: c.y };
      if (!this.peek.out) { const p = this._peekPos(c.x, c.y, w, h, this.edge); this._place(win, p.x, p.y); }
      return;
    }
    let c = this._clampToDisplay(x, y, w, h);
    if (this.edge) c = this._snap(c.x, c.y, w, h);
    if (c.x !== x || c.y !== y) this._place(win, c.x, c.y);
    if (this.edge && this.edgeHideEnabled()) this.tuckIn();
  }

  showPet() {
    if (!this.petWindow) this.createPet();
    this.petWindow.showInactive();
    this.petVisible = true;
    if (this.rt.power) this.rt.power.update();
    this.rt.broadcastState();
  }

  hidePet() {
    if (this.petWindow) this.petWindow.hide();
    this.petVisible = false;
    if (this.rt.power) this.rt.power.update();
    this.rt.broadcastState();
  }

  togglePet() {
    if (this.petVisible) this.hidePet();
    else this.showPet();
    return this.petVisible;
  }

  applyPetSettings() {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    const width = this.petWidth();
    const [x, y] = this.petWindow.getPosition();
    this.petWindow.setBounds({ x, y, width, height: this.petHeight() });
    this.petWindow.setAlwaysOnTop(!!this.rt.settings.get('alwaysOnTop'), 'screen-saver');
    this.rt.sendToPet('pet:event', { kind: 'settings', payload: this.rt.stateSnapshot() });
  }

  resetPetPosition() {
    if (!this.petWindow) return;
    this.edge = null;
    this.peek = null;
    const wa = screen.getPrimaryDisplay().workArea;
    const w = this.petWidth();
    const x = Math.round(wa.x + wa.width - w - PET_MARGIN_RIGHT);
    const y = Math.round(wa.y + wa.height - this.petHeight() - PET_MARGIN_BOTTOM);
    this._place(this.petWindow, x, y);
    this.rt.settings.patch({ petPosition: { x, y } });
  }

  // ------------------------------------------------ 像素级点击穿透（主进程轮询）
  startHitTestLoop() {
    if (this._hitTimer) return;
    this._lastIgnore = null;
    const power = this.rt.power;
    const { PERIODS } = require('./power-governor');
    // v2.2：鼠标离桌宠窗口较远时 120ms 一次，靠近/拖动/半隐藏时 30ms；空闲/睡眠再降频
    let far = false;
    const loop = () => {
      const win = this.petWindow;
      if (!win || win.isDestroyed() || !this.petVisible || this.dragging) return;
      const cursor = screen.getCursorScreenPoint();
      const [wx, wy] = win.getPosition();
      const hit = (this.rt.petHitboxes || []).some(
        (r) =>
          cursor.x >= wx + r.x &&
          cursor.x <= wx + r.x + r.w &&
          cursor.y >= wy + r.y &&
          cursor.y <= wy + r.y + r.h,
      );
      // 半隐藏：鼠标碰到露出的部分就滑出来，离开一会儿再缩回去
      if (this.peek) {
        if (hit) {
          this.peek.leaveAt = 0;
          if (!this.peek.out) this.slideOut();
        } else if (this.peek.out) {
          if (!this.peek.leaveAt) this.peek.leaveAt = Date.now();
          else if (Date.now() - this.peek.leaveAt > PEEK_HIDE_DELAY) this.tuckIn();
        }
      }
      const ignore = !hit;
      if (this._lastIgnore !== ignore) {
        this._lastIgnore = ignore;
        win.setIgnoreMouseEvents(ignore, { forward: true });
      }
      const b = win.getBounds();
      const M = 160;
      far = !hit && !this.peek && (cursor.x < b.x - M || cursor.x > b.x + b.width + M || cursor.y < b.y - M || cursor.y > b.y + b.height + M);
    };
    if (power) {
      power.every('hitTest', loop, { ...PERIODS.hitTest, active: () => (far ? 120 : PERIODS.hitTest.active) });
      this._hitTimer = { power: true };
    } else {
      this._hitTimer = setInterval(loop, 30);
    }
  }

  stopHitTestLoop() {
    if (this._hitTimer && this._hitTimer.power) this.rt.power.cancel('hitTest');
    else if (this._hitTimer) clearInterval(this._hitTimer);
    this._hitTimer = null;
  }

  // ---------------------------------------------------------------- 拖动
  beginDrag({ offsetX = 0, offsetY = 0 } = {}) {
    if (this._roam) this.stopRoam(); // 用户一拖就打断散步
    this.cancelAutoStroll();
    dlog('beginDrag called', offsetX, offsetY);
    const win = this.petWindow;
    if (!win || win.isDestroyed()) return { ok: false };
    const cursor = screen.getCursorScreenPoint();
    if (this._anim) { clearInterval(this._anim); this._anim = null; }
    this.peek = null;
    this.dragging = {
      offsetX,
      offsetY,
      lastCursor: cursor,
      lastTime: Date.now(),
      vx: 0,
      vy: 0,
      samples: 0,
      startPos: win.getPosition(),
      timer: null,
    };
    this._lastIgnore = false;
    win.setIgnoreMouseEvents(false);
    this.dragging.timer = setInterval(() => {
      if (!this.dragging) return;
      const c = screen.getCursorScreenPoint();
      const now = Date.now();
      const dt = Math.max(1, now - this.dragging.lastTime);
      const [w, h] = [this.petWidth(), this.petHeight()];
      // 用鼠标所在的显示器做边界：可以跨屏拖动，身体能贴到每一条边 / 角
      const pos = this._clampToDisplay(c.x - this.dragging.offsetX, c.y - this.dragging.offsetY, w, h, c);
      this._place(win, pos.x, pos.y);
      if (this.dragging.samples < 6) {
        this.dragging.samples++;
      } else {
        this.dragging.vx = (c.x - this.dragging.lastCursor.x) / dt * 1000;
        this.dragging.vy = (c.y - this.dragging.lastCursor.y) / dt * 1000;
      }
      this.dragging.lastCursor = c;
      this.dragging.lastTime = now;
    }, 16);
    dlog('beginDrag', JSON.stringify({ offsetX, offsetY, cursor, startPos: this.dragging && this.dragging.startPos }));
    this.rt.sendToPet('pet:event', { kind: 'drag-start', payload: {} });
    return { ok: true };
  }

  endDrag() {
    const win = this.petWindow;
    const drag = this.dragging;
    this.dragging = null;
    if (drag && drag.timer) clearInterval(drag.timer);
    if (!win || win.isDestroyed()) return { ok: false };
    const [x0, y0] = win.getPosition();
    const [w, h] = [this.petWidth(), this.petHeight()];
    // 松手吸附：可见身体靠近任意一条边（含任务栏一侧）就贴过去
    const snapOn = this.rt.settings.get('petEdgeSnap') !== false;
    const s = snapOn ? this._snap(x0, y0, w, h) : { ...this._clampToDisplay(x0, y0, w, h), edge: null };
    const snapped = s.x !== x0 || s.y !== y0 || !!s.edge;
    if (s.x !== x0 || s.y !== y0) this._place(win, s.x, s.y);
    this.edge = s.edge;
    this.rt.settings.patch({ petPosition: { x: s.x, y: s.y, edge: s.edge } });
    const x = s.x;
    const finalY = s.y;
    // 甩出去的惯性动画会自己移动窗口；只有慢慢放下时才立刻半隐藏
    const slow = !drag || Math.hypot(drag.vx, drag.vy) < 600;
    // 丢到屏幕最下方：中间 = 丢垃圾桶，两侧 = 拖地（2026-11-04 晚）
    const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const nearBottom = s.y + h >= disp.y + disp.height - 110 || s.edge === 'bottom';
    const centered = Math.abs(s.x + w / 2 - (disp.x + disp.width / 2)) < disp.width * 0.25;
    if (nearBottom && slow) {
      if (centered) {
        this.rt.sendToPet('pet:event', { kind: 'trash', payload: {} });
        const home = drag && drag.startPos ? drag.startPos : [s.x, s.y];
        setTimeout(() => {
          try {
            win.hide();
            setTimeout(() => {
              try {
                this._place(win, home[0], home[1]);
                win.show();
                this.rt.sendToPet('pet:event', { kind: 'trash-return', payload: {} });
              } catch {
                /* ignore */
              }
            }, 1500);
          } catch {
            /* ignore */
          }
        }, 800);
      } else {
        this.rt.sendToPet('pet:event', { kind: 'dragged', payload: {} });
      }
    }
    // 贴到左右两边、慢慢放下 → 顺着墙往上爬一小段（2026-11-04）
    const wallEdge = s.edge === 'left' || s.edge === 'right';
    if (wallEdge && slow) setTimeout(() => this._climbWall(s.edge), 120);
    else if (!nearBottom && this.edge && slow && this.edgeHideEnabled()) setTimeout(() => this.tuckIn(), 600);
    const result = { ok: true, x, y: finalY, vx: drag ? Math.round(drag.vx) : 0, vy: drag ? Math.round(drag.vy) : 0, snapped, edge: s.edge };
    dlog('endDrag', JSON.stringify(result), 'startPos=', JSON.stringify(drag && drag.startPos));
    this.rt.sendToPet('pet:event', { kind: 'drag-end', payload: result });
    this.scheduleAutoRoam(15000);
    return result;
  }

  /** 贴墙小爬：顺着左边/右边往上挪一小段，配合渲染层的攀爬动作 */
  _climbWall(edge) {
    const win = this.petWindow;
    if (!win || win.isDestroyed()) return;
    const [x, y0] = win.getPosition();
    const up = 58;
    const target = Math.max(0, y0 - up);
    if (target === y0) return;
    this.rt.sendToPet('pet:event', { kind: 'climb', payload: { edge } });
    const steps = 9;
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      const t = i / steps;
      const ease = 1 - Math.pow(1 - t, 3);
      const y = Math.round(y0 + (target - y0) * ease);
      this._place(win, x, y);
      if (i >= steps) {
        clearInterval(timer);
        this.rt.settings.patch({ petPosition: { x, y: target, edge } });
        setTimeout(() => this.tuckIn(), 500);
      }
    }, 55);
  }

  movePet({ x, y }) {
    const win = this.petWindow;
    if (!win || win.isDestroyed()) return { ok: false };
    const [w, h] = [this.petWidth(), this.petHeight()];
    const c = this._clampToDisplay(Number(x) || 0, Number(y) || 0, w, h);
    this.peek = null;
    this._place(win, c.x, c.y);
    const saved = { x: c.x, y: c.y, edge: this.edge || null };
    // 惯性移动结束后若停在边上，记住贴边
    const s = this._snap(c.x, c.y, w, h);
    if (s.x === c.x && s.y === c.y && s.edge) saved.edge = s.edge;
    else if (!s.edge) saved.edge = null;
    this.edge = saved.edge;
    this.rt.settings.patch({ petPosition: saved });
    return { ok: true, x: c.x, y: c.y, edge: saved.edge };
  }

  // ---------------------------------------------------------------- 面板窗口
  openPanel(name) {
    const spec = PANEL_SIZES[name];
    if (!spec) return null;
    const existing = this.panels.get(name);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return existing;
    }
    const win = new BrowserWindow({
      width: spec.width,
      height: spec.height,
      minWidth: spec.minWidth,
      minHeight: spec.minHeight,
      title: spec.title,
      frame: false,
      backgroundColor: '#0c0e14',
      show: false,
      center: true,
      resizable: true,
      maximizable: name !== 'settings',
      fullscreenable: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'panel.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', spec.dir || name, 'index.html')).then(() => {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    });
    win.on('closed', () => this.panels.delete(name));
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    this.panels.set(name, win);
    return win;
  }

  panelWindowAction(win, action) {
    if (!win || win.isDestroyed()) return false;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === 'close') win.close();
    return true;
  }

  closeAll() {
    this.stopHitTestLoop();
    this.stopAutoRoam();
    if (this.dragging && this.dragging.timer) clearInterval(this.dragging.timer);
    this.dragging = null;
    this.closeAllPanels();
  }

  closeAllPanels() {
    for (const win of this.panels.values()) {
      if (!win.isDestroyed()) win.destroy();
    }
    this.panels.clear();
  }
}

module.exports = { WindowManager, PET_W, PET_H, PANEL_SIZES, SNAP_PX, PEEK_RATIO };
