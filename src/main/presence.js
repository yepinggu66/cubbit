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
const { powerMonitor, app } = require('electron');

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

const PROBE_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$out = $env:CUBBIT_PRESENCE_OUT
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class CbFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[void][CbFg]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms
$mon = [System.Windows.Forms.SystemInformation]::VirtualScreen
while ($true) {
  $h = [CbFg]::GetForegroundWindow()
  $t = New-Object System.Text.StringBuilder 512
  [void][CbFg]::GetWindowText($h, $t, 512)
  $r = New-Object CbFg+RECT
  [void][CbFg]::GetWindowRect($h, [ref]$r)
  $wpid = 0
  [void][CbFg]::GetWindowThreadProcessId($h, [ref]$wpid)
  $proc = Get-Process -Id $wpid -ErrorAction SilentlyContinue
  $pname = ''
  if ($proc) { $pname = $proc.ProcessName }
  $full = (($r.Left -le ($mon.Left + 2)) -and ($r.Top -le ($mon.Top + 2)) -and ($r.Right -ge ($mon.Right - 2)) -and ($r.Bottom -ge ($mon.Bottom - 2)))
  $o = [ordered]@{
    title = $t.ToString();
    process = $pname;
    pid = $wpid;
    fullscreen = [bool]$full;
    width = [int]($r.Right - $r.Left);
    height = [int]($r.Bottom - $r.Top);
  }
  $json = $o | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($out, $json)
  Start-Sleep -Milliseconds 1200
}
`;

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
    const idle = this._idleSeconds();
    const hour = new Date().getHours();
    const raw = this.raw || {};
    const proc = String(raw.process || '').toLowerCase();
    const title = String(raw.title || '');
    const titleLower = title.toLowerCase();
    const full = !!raw.fullscreen;

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

module.exports = { PresenceWatcher };
