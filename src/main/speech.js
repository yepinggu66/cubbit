/**
 * 语音（TTS）
 *
 * Electron/Chromium 在本机拿不到 web speech 语音（voices=0），所以走 Windows SAPI：
 *   - 常驻一个隐藏的 PowerShell 语音 worker（System.Speech），启动时加载一次中文语音
 *   - 主进程把要说的句子写进 speech-queue.json，worker 发现变化就朗读
 *   - 无 PowerShell / 无语音包 / 正在观影或开会时自动静默，绝不影响桌宠
 */
const fs = require('node:fs');
const I18N = require('../shared/i18n');
const path = require('node:path');
const { app } = require('electron');

const WORKER = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Speech
$queue = $env:CUBBIT_SPEECH_QUEUE
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $zh = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh-*' })
  if ($zh.Count -gt 0) { $synth.SelectVoice($zh[0].VoiceInfo.Name) }
} catch { }
$vl = New-Object System.Collections.ArrayList
try { $synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { [void]$vl.Add(@{ name = $_.VoiceInfo.Name; culture = $_.VoiceInfo.Culture.Name; gender = [string]$_.VoiceInfo.Gender; engine = 'sapi' }) } } catch { }
# OneCore（Windows 10/11 更自然的语音：晓晓/瑶瑶/康康/慧慧），走 WinRT Windows.Media.SpeechSynthesis
$oc = $null; $ocVoices = @(); $asTask = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
  $tick = [char]96
  $m = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + $tick + '1') } | Select-Object -First 1
  $asTask = $m.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $oc = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  $ocVoices = @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices)
  foreach ($v in $ocVoices) { [void]$vl.Add(@{ name = 'OneCore:' + $v.DisplayName; culture = $v.Language; gender = [string]$v.Gender; engine = 'onecore' }) }
} catch { $oc = $null }
try { [System.IO.File]::WriteAllText($env:CUBBIT_SPEECH_VOICES, (ConvertTo-Json -InputObject @($vl) -Compress)) } catch { }
try { $rc = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object { $_.Culture.Name }); [System.IO.File]::WriteAllText($env:CUBBIT_SPEECH_RECS, (ConvertTo-Json -InputObject @($rc) -Compress)) } catch { }
function Say-OneCore([string]$name, [string]$text, $vol, $rate, $pitch) {
  $v = $ocVoices | Where-Object { $_.DisplayName -eq $name } | Select-Object -First 1
  if (-not $v) { return $false }
  try {
    $oc.Voice = $v
    try { $oc.Options.AudioVolume = [double]$vol / 100 } catch { }
    try { $oc.Options.SpeakingRate = [double]$rate } catch { }
    if ($pitch) { try { $oc.Options.AudioPitch = [double]$pitch } catch { } }
    $t = $asTask.Invoke($null, @($oc.SynthesizeTextToStreamAsync($text)))
    [void]$t.Wait(15000)
    $ns = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($t.Result)
    $ms = New-Object System.IO.MemoryStream
    $ns.CopyTo($ms); $ms.Position = 0
    (New-Object System.Media.SoundPlayer($ms)).PlaySync()
    return $true
  } catch { return $false }
}
function Auto-OneCore {
  foreach ($n in @('Microsoft Xiaoxiao', 'Microsoft Yaoyao', 'Microsoft Huihui', 'Microsoft Kangkang')) { if ($ocVoices | Where-Object { $_.DisplayName -eq $n }) { return $n } }
  $z = $ocVoices | Where-Object { $_.Language -like 'zh-*' } | Select-Object -First 1
  if ($z) { return $z.DisplayName }
  return ''
}
$last = ''
while ($true) {
  if (Test-Path $queue) {
    $raw = [System.IO.File]::ReadAllText($queue)
    if ($raw -and $raw -ne $last) {
      $last = $raw
      try {
        $obj = $raw | ConvertFrom-Json
        if ($obj.text) {
          $voice = [string]$obj.voice
          $engine = 'sapi'; $used = ''
          $done = $false
          if ($oc) {
            $want = ''
            if ($voice -like 'OneCore:*') { $want = $voice.Substring(8) } elseif (-not $voice) { $want = Auto-OneCore }
            if ($want) { $done = Say-OneCore $want ([string]$obj.text) $obj.volume $obj.rateF $obj.pitch; if ($done) { $engine = 'onecore'; $used = $want } }
          }
          if (-not $done) {
            if ($voice -and $voice -notlike 'OneCore:*') { try { if ($synth.Voice.Name -ne $voice) { $synth.SelectVoice($voice) } } catch { } }
            $synth.Volume = [int]$obj.volume
            $synth.Rate = [int]$obj.rate
            $used = $synth.Voice.Name
            $synth.Speak([string]$obj.text)
          }
          try { [System.IO.File]::WriteAllText($env:CUBBIT_SPEECH_LAST, (ConvertTo-Json -Compress @{ engine = $engine; voice = $used; text = [string]$obj.text; n = $obj.n })) } catch { }
        }
      } catch { }
    }
  }
  Start-Sleep -Milliseconds 250
}
`;

/** 语音输入：一次性离线识别（System.Speech 中文听写），输出 JSON 到 stdout */
const LISTEN = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Speech
  $all = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  $want = [string]$env:CUBBIT_LISTEN_CULTURE
  if (-not $want) { $want = 'zh-CN' }
  $fb = $false
  $rs = $all | Where-Object { $_.Culture.Name -eq $want } | Select-Object -First 1
  if (-not $rs) { $pre = $want.Split('-')[0]; $rs = $all | Where-Object { $_.Culture.Name -like ($pre + '-*') } | Select-Object -First 1 }
  if (-not $rs) { $fb = $true; $rs = $all | Where-Object { $_.Culture.Name -like 'zh-*' } | Select-Object -First 1 }
  if (-not $rs) { $rs = $all | Select-Object -First 1 }
  if (-not $rs) { Write-Output '{"ok":false,"code":"NO_RECOGNIZER"}'; exit }
  $e = New-Object System.Speech.Recognition.SpeechRecognitionEngine($rs)
  $e.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  if ($env:CUBBIT_LISTEN_WAV) { $e.SetInputToWaveFile($env:CUBBIT_LISTEN_WAV) } else { $e.SetInputToDefaultAudioDevice() }
  $e.InitialSilenceTimeout = [TimeSpan]::FromSeconds(5)
  $e.BabbleTimeout = [TimeSpan]::FromSeconds(10)
  $e.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(800)
  $r = $e.Recognize([TimeSpan]::FromSeconds([int]$env:CUBBIT_LISTEN_SECS))
  if ($r) { Write-Output (ConvertTo-Json -Compress @{ ok = $true; text = $r.Text; confidence = $r.Confidence; culture = $rs.Culture.Name; fallback = $fb }) }
  else { Write-Output '{"ok":true,"text":""}' }
} catch { Write-Output (ConvertTo-Json -Compress @{ ok = $false; code = 'MIC'; message = $_.Exception.Message }) }
`;

class SpeechService {
  constructor(settingsStore, presence) {
    this.settings = settingsStore;
    this.presence = presence;
    this.dir = app.getPath('userData');
    this.queuePath = path.join(this.dir, 'speech-queue.json');
    this.voicesPath = path.join(this.dir, 'speech-voices.json');
    this.recsPath = path.join(this.dir, 'speech-recognizers.json');
    this.scriptPath = path.join(this.dir, 'speech-worker.ps1');
    this.listenPath = path.join(this.dir, 'listen-worker.ps1');
    this.lastPath = path.join(this.dir, 'speech-last.json');
    this.listening = null;
    this.child = null;
    this.lastAt = 0;
    this.lastText = '';
    this.enabled = true;
  }

  start() {
    try {
      fs.writeFileSync(this.scriptPath, WORKER, 'utf8');
      const { spawn } = require('node:child_process');
      this.child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', this.scriptPath],
        {
          windowsHide: true,
          stdio: 'ignore',
          env: { ...process.env, CUBBIT_SPEECH_QUEUE: this.queuePath, CUBBIT_SPEECH_VOICES: this.voicesPath, CUBBIT_SPEECH_LAST: this.lastPath, CUBBIT_SPEECH_RECS: this.recsPath },
        },
      );
      this.child.on('exit', () => {
        this.child = null;
        this.enabled = false;
      });
      this.child.on('error', () => {
        this.child = null;
        this.enabled = false;
      });
    } catch {
      this.enabled = false;
    }
  }

  stop() {
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* ignore */
      }
      this.child = null;
    }
    try {
      fs.rmSync(this.queuePath, { force: true });
    } catch {
      /* ignore */
    }
  }

  /** 系统已安装的语音（worker 启动时写出） */
  listVoices() {
    try {
      const raw = fs.readFileSync(this.voicesPath, 'utf8').replace(/^\uFEFF/, '');
      const list = JSON.parse(raw);
      return (Array.isArray(list) ? list : [list]).filter((v) => v && v.name);
    } catch {
      return [];
    }
  }

  /** 最近一次真正朗读的内容（engine/voice/text），用于自检 */
  lastSpoken() {
    try {
      return JSON.parse(fs.readFileSync(this.lastPath, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      return null;
    }
  }

  /** 听一句话（离线中文听写）。返回 { ok, text, confidence } */
  listen({ seconds = 10, culture = '' } = {}) {
    if (this.listening) return this.listening;
    this.listening = new Promise((resolve) => {
      try {
        fs.writeFileSync(this.listenPath, LISTEN, 'utf8');
        const { spawn } = require('node:child_process');
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', this.listenPath],
          { windowsHide: true, env: { ...process.env, CUBBIT_LISTEN_SECS: String(Math.max(3, Math.min(20, seconds))), CUBBIT_LISTEN_CULTURE: culture || I18N.info(this.settings.settings.language).culture } },
        );
        let out = '';
        child.stdout.on('data', (d) => { out += d.toString('utf8'); });
        const killer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, (seconds + 12) * 1000);
        const finish = (res) => { clearTimeout(killer); this.listening = null; resolve(res); };
        child.on('error', () => finish({ ok: false, code: 'NO_POWERSHELL' }));
        child.on('exit', () => {
          try {
            const line = out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).pop() || '';
            const res = JSON.parse(line.replace(/^\uFEFF/, ''));
            if (res.ok && res.text && Number(res.confidence) < 0.12) res.text = '';
            finish(res);
          } catch {
            finish({ ok: false, code: 'PARSE', message: out.slice(0, 200) });
          }
        });
      } catch (err) {
        this.listening = null;
        resolve({ ok: false, code: 'SPAWN', message: err && err.message });
      }
    });
    return this.listening;
  }

  _blocked() {
    const s = this.settings.settings;
    if (!s.voiceEnabled) return true;
    if (this.presence) {
      const p = this.presence.snapshot();
      if (p.cinemaMode && !s.cinemaManual) return true;
      if (['meeting', 'game', 'video'].includes(p.kind)) return true;
    }
    return false;
  }

  /** @param {string} text @param {{force?:boolean}} [opts] */
  /** 已安装的离线识别器文化（由朗读 worker 启动时写出） */
  listRecognizers() {
    try {
      const raw = fs.readFileSync(this.recsPath, 'utf8').replace(/^\uFEFF/, '');
      const list = JSON.parse(raw);
      return (Array.isArray(list) ? list : [list]).map(String).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** 为某语言挑一个 Windows 语音：用户指定且语言匹配 > OneCore > SAPI；没有则返回 null */
  voiceFor(lang) {
    const inf = I18N.info(lang);
    const pre = inf.short;
    const voices = this.listVoices();
    const match = (v) => String(v.culture || '').toLowerCase().startsWith(pre === 'zh' ? 'zh' : pre);
    const chosen = String(this.settings.settings.voiceName || '');
    if (chosen) {
      const v = voices.find((x) => x.name === chosen);
      if (v && match(v)) return v;
    }
    return voices.find((v) => v.engine === 'onecore' && match(v)) || voices.find((v) => match(v)) || null;
  }

  /** 某语言的语音 / 语音输入支持情况，供设置页提示安装语言包 */
  support(lang) {
    const inf = I18N.info(lang);
    const voices = this.listVoices();
    const v = this.voiceFor(lang);
    const recs = this.listRecognizers();
    const rec = recs.find((c) => c.toLowerCase() === inf.culture.toLowerCase()) || recs.find((c) => c.toLowerCase().startsWith(inf.short));
    return {
      ok: true,
      lang: inf.id,
      langName: inf.name,
      culture: inf.culture,
      tts: !!v,
      ttsVoice: v ? String(v.name).replace(/^OneCore:/, '') : '',
      voicesKnown: voices.length > 0,
      stt: !!rec,
      sttCulture: rec || '',
      sttFallback: recs.find((c) => c.startsWith('zh')) ? '中文' : recs[0] || '',
      recognizers: recs,
    };
  }

  speak(text, opts = {}) {
    if (!this.enabled || !this.child) return false;
    const lang = I18N.normLang(this.settings.settings.language);
    const isZh = lang === 'zh-CN';
    const shown = isZh ? String(text || '') : I18N.tr(lang, String(text || ''));
    const clean = shown
      .replace(/（[^）]*）/g, ' ')
      .replace(/[~～…]/g, ' ')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, isZh ? 80 : 220)
      // 「方块仔」读作 fāng kuài zǎi：只改送给 TTS 的文字，屏幕上仍显示「仔」
      .replace(/仔/g, '崽');
    let voiceName = String(this.settings.settings.voiceName || '');
    // 词典里没有的句子仍是中文：用中文语音念，避免外语语音念不出汉字
    const untranslated = !isZh && lang !== 'ja' && /[\u4e00-\u9fff]/.test(clean);
    if (!isZh && !untranslated) {
      const v = this.voiceFor(lang);
      if (!v) {
        this.missingVoice = { lang, at: Date.now() };
        return false;
      }
      voiceName = v.name;
    }
    if (!clean) return false;
    if (!opts.force && this._blocked()) return false;
    const now = Date.now();
    if (!opts.force && now - this.lastAt < 1800) return false;
    if (clean === this.lastText && now - this.lastAt < 8000) return false;
    this.lastAt = now;
    this.lastText = clean;
    // 神经语音：不走 SAPI，交给服务端合成后由宠物窗口播放（更接近真人）
    if (this.onNeural && this.settings.settings.ttsEngine !== 'system') {
      try {
        const voice = String(this.settings.settings.ttsVoice || 'zh-CN-XiaoxiaoNeural');
        const url = 'https://pingguye.cn/cubbit/tts?voice=' + encodeURIComponent(voice) + '&text=' + encodeURIComponent(clean);
        this.onNeural({ url, text: clean, voice, volume: Math.max(0, Math.min(1, Number(this.settings.settings.voiceVolume) || 0.7)) });
        return true;
      } catch (err) {
        // 失败就继续走下面的 SAPI 兜底
      }
    }
    const s = this.settings.settings;
    const payload = {
      text: clean,
      voice: voiceName,
      lang,
      n: now,
      volume: Math.round(Math.max(0, Math.min(1, Number(s.voiceVolume) || 0.7)) * 100),
      rate: Math.round((Math.max(0.7, Math.min(1.5, Number(s.voiceRate) || 1.05)) - 1) * 8),
      rateF: Math.max(0.7, Math.min(1.5, Number(s.voiceRate) || 1.05)),
      pitch: Number(s.voicePitch) ? Math.max(0.5, Math.min(2, Number(s.voicePitch))) : 0,
    };
    try {
      fs.writeFileSync(this.queuePath, JSON.stringify(payload), 'utf8');
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { SpeechService };
