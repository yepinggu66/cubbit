/**
 * 主人状态感知（Presence）
 *
 * Windows 下拿不到「前台窗口标题」的 Electron 原生 API，所以用一个常驻 PowerShell 探针：
 *   - 探针由主进程以「无管道」方式启动（stdout 直接丢弃），把结果写入 userData/presence.json
 *   - 主进程每秒读取一次文件，做分类：工作 / 写代码 / 看视频 / 游戏 / 开会 / 离开 / 深夜
 *   - 检测到「全屏视频/电影」时切换观影模式（只保留发光的眼睛）
 *
 * 设计约束：探针不可用时（无 PowerShell、权限受限）自动降级为「时间 + 系统闲置」推断，绝不阻塞桌宠。
 */
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
let powerMonitor = null;
let app = null;
try {
  ({ powerMonitor, app } = require('electron'));
} catch {
  /* 纯 Node 单测环境：只用到纯函数 */
}

const VIDEO_APPS = [
  'potplayer', 'potplayermini64', 'potplayermini', 'vlc', 'mpv', 'mpc-hc', 'mpc-hc64', 'mpc-be',
  'wmplayer', 'qqplayer', 'kodi', 'bilibili', '哔哩哔哩', 'netflix', 'disneyplus', 'disney',
  'iqiyi', '爱奇艺', 'youku', '优酷', 'tencentvideo', '腾讯视频', 'qqlive', 'mgtv', '芒果tv',
  'mxplayer', 'infuse', 'jellyfin', 'plex', 'emby', 'stremio', 'baiduyun', '迅雷影音', 'xmp',
  'mpcbe', 'smplayer', 'kmplayer', 'gomplayer', 'realplayer', 'vlc.exe',
];

const VIDEO_TITLE_HINTS = [
  '哔哩哔哩', 'bilibili', 'youtube', 'netflix', '爱奇艺', 'iqiyi', '优酷', 'youku', '腾讯视频',
  'v.qq.com', 'movie', '电影', '视频', '播放', '第', '集', 'tv.', 'disney', 'hbo', 'hulu',
];

const MEETING_APPS = [
  'zoom', 'teams', 'ms-teams', 'webex', 'dingtalk', 'dingtalk', 'feishu', 'lark', 'wemeet',
  'tencentmeeting', 'voov', 'discord', 'skype', 'slack', 'wechat', 'weixin', 'qq', 'telegram',
];

const CODING_APPS = [
  'code', 'cursor', 'windsurf', 'idea64', 'pycharm64', 'webstorm64', 'goland64', 'clion64',
  'devenv', 'rider64', 'androidstudio64', 'sublime_text', 'notepad++', 'vim', 'nvim', 'emacs',
  'windowsterminal', 'powershell', 'pwsh', 'cmd', 'mobaxterm', 'xshell', 'securecrt', 'putty',
  'matlab', 'solidworks', 'tiaportal', 'eplan', 'autocad', 'gxworks3', 'wplsoft', 'kicad', 'keil',
];

const BROWSERS = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'iexplore', '360se', 'qqbrowser', 'sogouexplorer'];

// 探针只上报「原始事实」（物理像素的窗口矩形 + 所在显示器矩形 + 窗口类名 / 样式 / 是否最大化），
// 是否「全屏」由下面的 isFullscreenRaw() 在 JS 里判定，便于单测。
// v2.9.5 修复：旧版拿 GetWindowRect（物理像素，进程已 DPI aware）去比 WinForms VirtualScreen（逻辑像素，
// 125% 缩放下是 1536x864），导致任何最大化窗口、甚至点一下桌面都被当成「全屏游戏」而自动隐身。
const PROBE_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$out = $env:CUBBIT_PRESENCE_OUT
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class CbFg295 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
}
"@
# 每显示器 DPI 感知（V2 = -4），失败再退回系统 DPI 感知；这样窗口矩形和显示器矩形都是物理像素
$dpiOk = $false
try { $dpiOk = [CbFg295]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { $dpiOk = $false }
if (-not $dpiOk) { [void][CbFg295]::SetProcessDPIAware() }
while ($true) {
  $h = [CbFg295]::GetForegroundWindow()
  $t = New-Object System.Text.StringBuilder 512
  [void][CbFg295]::GetWindowText($h, $t, 512)
  $c = New-Object System.Text.StringBuilder 256
  [void][CbFg295]::GetClassName($h, $c, 256)
  $r = New-Object CbFg295+RECT
  [void][CbFg295]::GetWindowRect($h, [ref]$r)
  $mi = New-Object CbFg295+MONITORINFO
  $mi.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][CbFg295+MONITORINFO])
  $hm = [CbFg295]::MonitorFromWindow($h, 2)
  $monOk = [CbFg295]::GetMonitorInfo($hm, [ref]$mi)
  $wpid = 0
  [void][CbFg295]::GetWindowThreadProcessId($h, [ref]$wpid)
  $proc = Get-Process -Id $wpid -ErrorAction SilentlyContinue
  $pname = ''
  if ($proc) { $pname = $proc.ProcessName }
  $style = [CbFg295]::GetWindowLong($h, -16)
  $o = [ordered]@{
    v = 2;
    title = $t.ToString();
    className = $c.ToString();
    process = $pname;
    pid = $wpid;
    zoomed = [bool][CbFg295]::IsZoomed($h);
    style = ([int64]$style) -band 0xFFFFFFFFL;
    rect = @([int]$r.Left, [int]$r.Top, [int]$r.Right, [int]$r.Bottom);
    monitor = @([int]$mi.rcMonitor.Left, [int]$mi.rcMonitor.Top, [int]$mi.rcMonitor.Right, [int]$mi.rcMonitor.Bottom);
    work = @([int]$mi.rcWork.Left, [int]$mi.rcWork.Top, [int]$mi.rcWork.Right, [int]$mi.rcWork.Bottom);
    monOk = [bool]$monOk;
    width = [int]($r.Right - $r.Left);
    height = [int]($r.Bottom - $r.Top);
  }
  $json = $o | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($out, $json)
  Start-Sleep -Milliseconds 1200
}
`;

// 桌面 / 任务栏 / 开始菜单 / 任务视图 / 锁屏等系统外壳窗口：铺满屏幕也绝不算「全屏」
const SHELL_CLASSES = [
  'progman', 'workerw', 'shell_traywnd', 'shell_secondarytraywnd', 'notifyiconoverflowwindow',
  'multitaskingviewframe', 'xamlexplorerhostislandwindow', 'foregroundstaging', 'windows.ui.core.corewindow',
  'lockscreenbackstopframe',
];
const SHELL_PROCESSES = [
  'startmenuexperiencehost', 'searchhost', 'searchapp', 'searchui', 'shellexperiencehost', 'lockapp',
  'textinputhost', 'logonui',
];
const WS_CAPTION = 0x00c00000;

function rectOf(a) {
  if (!Array.isArray(a) || a.length < 4) return null;
  const [l, t, r, b] = a.map((n) => Number(n));
  if (![l, t, r, b].every(Number.isFinite) || r <= l || b <= t) return null;
  return { l, t, r, b };
}

/** 是不是桌面 / 任务栏 / 开始菜单这类系统外壳窗口 */
function isShellWindow(raw) {
  const cls = String((raw && raw.className) || '').toLowerCase();
  const proc = String((raw && raw.process) || '').toLowerCase();
  if (SHELL_CLASSES.includes(cls)) return true;
  if (SHELL_PROCESSES.includes(proc)) return true;
  // 资源管理器里没有标题的前台窗口基本就是桌面 / 任务栏
  if (proc === 'explorer' && !String((raw && raw.title) || '').trim()) return true;
  return false;
}

/**
 * 判断前台窗口是否「真正全屏」（全屏游戏 / 全屏视频 / 全屏演示）。
 * 规则：
 *   1) 窗口矩形与它所在显示器矩形用同一单位（物理像素）比较，必须盖住整块显示器（含任务栏），容差 2px；
 *   2) 最大化的普通窗口不算（IsZoomed，或带标题栏且没盖住任务栏）；
 *   3) 桌面 / 任务栏 / 开始菜单等系统外壳窗口不算；
 *   4) 旧探针（没有 monitor 字段）一律不算，宁可不隐身也不要乱隐身。
 */
function isFullscreenRaw(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') return false;
  if (opts.selfPid && Number(raw.pid) === Number(opts.selfPid)) return false;
  if (isShellWindow(raw)) return false;
  const win = rectOf(raw.rect);
  const mon = rectOf(raw.monitor);
  if (!win || !mon) return false;
  if (raw.zoomed) return false;
  const tol = 2;
  const covers = win.l <= mon.l + tol && win.t <= mon.t + tol && win.r >= mon.r - tol && win.b >= mon.b - tol;
  if (!covers) return false;
  // 带标题栏的窗口哪怕被拉到盖满屏幕，也只是一个很大的普通窗口
  const style = Number(raw.style) || 0;
  if (style && (style & WS_CAPTION) === WS_CAPTION) return false;
  return true;
}

/** 纯函数：探针原始数据 → 状态分类（便于单测） */
function classifyPresence(raw, ctx = {}) {
  raw = raw || {};
  const idle = Number(ctx.idle) || 0;
  const hour = Number.isFinite(ctx.hour) ? ctx.hour : new Date().getHours();
  const proc = String(raw.process || '').toLowerCase();
  const title = String(raw.title || '');
  const titleLower = title.toLowerCase();
  const full = isFullscreenRaw(raw, { selfPid: ctx.selfPid });

  if (idle >= 300) {
    return { kind: 'away', app: proc, title, fullscreen: full };
  }
  if (proc && MEETING_APPS.includes(proc)) {
    return { kind: 'meeting', app: proc, title, fullscreen: full };
  }
  if (proc && VIDEO_APPS.includes(proc)) {
    return { kind: 'video', app: proc, title, fullscreen: full };
  }
  if (full && proc && BROWSERS.includes(proc)) {
    // 浏览器全屏基本只有两种情况：看视频/电影、全屏演示。都按「需要安静」处理。
    return { kind: 'video', app: proc, title, fullscreen: full };
  }
  if (full && proc && !BROWSERS.includes(proc) && !CODING_APPS.includes(proc)) {
    return { kind: 'game', app: proc, title, fullscreen: full };
  }
  if (VIDEO_TITLE_HINTS.some((k) => titleLower.includes(k)) && !VIDEO_APPS.includes(proc)) {
    return { kind: 'video', app: proc, title, fullscreen: full };
  }
  if (proc && CODING_APPS.includes(proc)) {
    return { kind: 'coding', app: proc, title, fullscreen: full };
  }
  if (hour >= 23 || hour < 6) {
    return { kind: 'night', app: proc, title, fullscreen: full };
  }
  return { kind: 'working', app: proc, title, fullscreen: full };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

class PresenceWatcher extends EventEmitter {
  constructor(settingsStore) {
    super();
    this.settings = settingsStore;
    this.dir = app.getPath('userData');
    this.probePath = path.join(this.dir, 'presence.json');
    this.scriptPath = path.join(this.dir, 'presence-probe.ps1');
    this.child = null;
    this.timer = null;
    this.retries = 0;
    this.raw = null;
    this.lastKind = '';
    this.lastCinema = null;
    this.presence = {
      kind: 'working',
      app: '',
      title: '',
      fullscreen: false,
      since: Date.now(),
      cinemaMode: false,
      probeOk: false,
    };
  }

  start() {
    this._startProbe();
    this.timer = setInterval(() => this._tick(), 1000);
    return this.snapshot();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* ignore */
      }
      this.child = null;
    }
    try {
      fs.rmSync(this.probePath, { force: true });
    } catch {
      /* ignore */
    }
  }

  _startProbe() {
    if (this.child) return;
    try {
      fs.writeFileSync(this.scriptPath, PROBE_SCRIPT, 'utf8');
      const { spawn } = require('node:child_process');
      this.child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', this.scriptPath],
        {
          windowsHide: true,
          stdio: 'ignore',
          env: { ...process.env, CUBBIT_PRESENCE_OUT: this.probePath },
        },
      );
      this.child.on('exit', () => {
        this.child = null;
        if (this.retries < 3 && this.timer) {
          this.retries += 1;
          setTimeout(() => this._startProbe(), 5000);
        }
      });
      this.child.on('error', () => {
        this.child = null;
      });
    } catch {
      this.child = null;
    }
  }

  _tick() {
    // 1) 读探针结果
    try {
      const stat = fs.statSync(this.probePath);
      if (Date.now() - stat.mtimeMs < 6000) {
        const raw = JSON.parse(fs.readFileSync(this.probePath, 'utf8'));
        this.raw = raw;
        this.presence.probeOk = true;
      } else {
        this.presence.probeOk = false;
      }
    } catch {
      this.presence.probeOk = false;
    }

    const next = this._classify();
    const cinema = this._cinemaFor(next.kind);
    const changed =
      next.kind !== this.lastKind ||
      cinema !== this.lastCinema ||
      next.app !== this.presence.app ||
      next.title !== this.presence.title;
    if (changed) {
      if (next.kind !== this.lastKind) next.since = Date.now();
      this.presence = { ...next, cinemaMode: cinema, probeOk: this.presence.probeOk };
      this.lastKind = next.kind;
      this.lastCinema = cinema;
      this.emit('changed', this.snapshot());
    } else {
      this.presence.cinemaMode = cinema;
      if (!this.presence.since) this.presence.since = Date.now();
    }
  }

  _cinemaFor(kind) {
    const s = this.settings ? this.settings.settings : {};
    if (s.cinemaManual) return true;
    return !!(s.cinemaAuto !== false && kind === 'video');
  }

  _classify() {
    return classifyPresence(this.raw || {}, { idle: this._idleSeconds(), hour: new Date().getHours(), selfPid: process.pid });
  }

  _idleSeconds() {
    try {
      return powerMonitor.getSystemIdleTime();
    } catch {
      return 0;
    }
  }

  snapshot() {
    return { ...this.presence, clock: `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}` };
  }
}

module.exports = { PresenceWatcher, isFullscreenRaw, isShellWindow, classifyPresence };
