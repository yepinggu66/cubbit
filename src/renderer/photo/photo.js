/**
 * 拍一只 —— 把照片做成桌宠。
 *
 * 三条原则写在这里，是因为它们决定了很多取舍：
 *  1. 不上传。照片只在本机转成像素，抠完就丢，落盘的只有 512×512 的成品。
 *  2. 不假装。抠得不干净、没找到眼睛，都要如实说，而不是给一张糊图让人失望。
 *  3. 不发明比例。成品必须和 12 只内置形象同一套构图（高度 86%、脚底 96%），
 *     否则换形象那一刻会突然变大变小，一眼假。
 *
 * 依赖：shared/diy.js（性格选项 + 写入形状）
 * IPC：pet:photo:list / pet:photo:forge / pet:photo:remove / app:settings:set
 */
(function () {
  'use strict';

  const DIY = window.CUBBIT_DIY;
  const api = (window.cubbit && window.cubbit.panel) || null;

  const CH = {
    list: 'pet:photo:list',
    forge: 'pet:photo:forge',
    remove: 'pet:photo:remove',
    settings: 'app:settings:set',
    panelWindow: 'app:panel:window',
  };

  const R = {
    preview: document.getElementById('preview'),
    stageEmpty: document.getElementById('stageEmpty'),
    fileInput: document.getElementById('fileInput'),
    cameraBtn: document.getElementById('cameraBtn'),
    zoom: document.getElementById('zoom'),
    name: document.getElementById('name'),
    tempChips: document.getElementById('tempChips'),
    forgeBtn: document.getElementById('forgeBtn'),
    forgeTip: document.getElementById('forgeTip'),
    result: document.getElementById('result'),
    resultName: document.getElementById('resultName'),
    resultMeta: document.getElementById('resultMeta'),
    frameIdle: document.getElementById('frameIdle'),
    frameBlink: document.getElementById('frameBlink'),
    blinkCap: document.getElementById('blinkCap'),
    resultWarn: document.getElementById('resultWarn'),
    useBtn: document.getElementById('useBtn'),
    againBtn: document.getElementById('againBtn'),
    gallery: document.getElementById('gallery'),
    countNote: document.getElementById('countNote'),
    footNote: document.getElementById('footNote'),
    closeBtn: document.getElementById('closeBtn'),
    video: document.getElementById('video'),
    srcHint: document.getElementById('srcHint'),
  };

  const S = {
    img: null,
    zoom: 1,
    cx: 0,
    cy: 0,
    drag: null,
    temperament: 'curious',
    result: null,
    busy: false,
    stream: null,
  };

  const CANVAS = 420;
  const OUT = 1024;

  function invoke(channel, payload) {
    if (!api) return Promise.resolve(null);
    return api.invoke(channel, payload).catch((err) => {
      console.warn('[photo] invoke failed', channel, err);
      return null;
    });
  }

  function note(text, kind) {
    R.footNote.textContent = text;
    R.footNote.style.color = kind === 'warn' ? '#ffcf9b' : kind === 'ok' ? '#a9f0e0' : '';
  }

  // ------------------------------------------------------------------ 取景

  function cropSide() {
    if (!S.img) return 0;
    return Math.min(S.img.width, S.img.height) / S.zoom;
  }

  function clampCenter() {
    const side = cropSide();
    if (!S.img) return;
    const half = side / 2;
    S.cx = Math.min(Math.max(S.cx, half), S.img.width - half);
    S.cy = Math.min(Math.max(S.cy, half), S.img.height - half);
  }

  function draw() {
    const ctx = R.preview.getContext('2d');
    ctx.clearRect(0, 0, CANVAS, CANVAS);
    if (!S.img) return;
    const side = cropSide();
    ctx.drawImage(S.img, S.cx - side / 2, S.cy - side / 2, side, side, 0, 0, CANVAS, CANVAS);
    // 圆形取景辅助线：主体尽量落在圈里，抠完的构图会更像内置形象
    ctx.save();
    ctx.strokeStyle = 'rgba(255,176,110,.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(CANVAS / 2, CANVAS / 2, CANVAS * 0.38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function loadImage(src, label) {
    const img = new Image();
    img.onload = () => {
      S.img = img;
      S.zoom = 1;
      S.cx = img.width / 2;
      S.cy = img.height / 2;
      clampCenter();
      draw();
      R.stageEmpty.hidden = true;
      R.forgeBtn.disabled = false;
      R.srcHint.textContent = `${label || '照片'} · ${img.width}×${img.height}`;
      note('拖动调整位置，滚轮缩放。主体尽量放进圈里。');
    };
    img.onerror = () => note('这张图读不出来，换一张试试。', 'warn');
    img.src = src;
  }

  function readFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      note('只支持图片文件。', 'warn');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      note('这张图太大了（超过 12MB），先压缩一下。', 'warn');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => loadImage(String(reader.result), file.name);
    reader.readAsDataURL(file);
  }

  // ------------------------------------------------------------------ 交互

  R.preview.addEventListener('pointerdown', (e) => {
    if (!S.img) return;
    S.drag = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy };
    R.preview.setPointerCapture(e.pointerId);
  });

  R.preview.addEventListener('pointermove', (e) => {
    if (!S.drag || !S.img) return;
    const perPx = cropSide() / CANVAS;
    S.cx = S.drag.cx - (e.clientX - S.drag.x) * perPx;
    S.cy = S.drag.cy - (e.clientY - S.drag.y) * perPx;
    clampCenter();
    draw();
  });

  const endDrag = () => {
    S.drag = null;
  };
  R.preview.addEventListener('pointerup', endDrag);
  R.preview.addEventListener('pointercancel', endDrag);

  R.preview.addEventListener(
    'wheel',
    (e) => {
      if (!S.img) return;
      e.preventDefault();
      const next = Math.max(1, Math.min(3.2, S.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
      S.zoom = next;
      R.zoom.value = String(Math.round(next * 100));
      clampCenter();
      draw();
    },
    { passive: false },
  );

  R.zoom.addEventListener('input', () => {
    if (!S.img) return;
    S.zoom = Math.max(1, Math.min(3.2, Number(R.zoom.value) / 100));
    clampCenter();
    draw();
  });

  R.fileInput.addEventListener('change', () => {
    readFile(R.fileInput.files && R.fileInput.files[0]);
    R.fileInput.value = '';
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    readFile(file);
  });

  // 拍照：桌面端不一定有摄像头，没有就老老实实把按钮藏起来
  async function startCamera() {
    if (S.stream) {
      stopCamera();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      note('这台机器没有可用的摄像头，用「选照片」吧。', 'warn');
      return;
    }
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      R.video.srcObject = S.stream;
      await R.video.play();
      R.cameraBtn.textContent = '📸 按一下拍';
      R.cameraBtn.dataset.mode = 'shoot';
      S.img = null;
      R.stageEmpty.hidden = true;
      const ctx = R.preview.getContext('2d');
      const loop = () => {
        if (!S.stream) return;
        const vw = R.video.videoWidth || 640;
        const vh = R.video.videoHeight || 480;
        const side = Math.min(vw, vh);
        ctx.drawImage(R.video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, CANVAS, CANVAS);
        requestAnimationFrame(loop);
      };
      loop();
      note('对准它，按一下「按一下拍」。');
    } catch (err) {
      note('打不开摄像头（可能没授权），用「选照片」吧。', 'warn');
      S.stream = null;
    }
  }

  function shoot() {
    const vw = R.video.videoWidth;
    const vh = R.video.videoHeight;
    if (!vw || !vh) return;
    const side = Math.min(vw, vh);
    const c = document.createElement('canvas');
    c.width = Math.min(1280, side);
    c.height = c.width;
    c.getContext('2d').drawImage(R.video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, c.width, c.height);
    stopCamera();
    loadImage(c.toDataURL('image/png'), '刚拍的');
  }

  function stopCamera() {
    if (S.stream) {
      for (const track of S.stream.getTracks()) track.stop();
      S.stream = null;
    }
    R.video.srcObject = null;
    R.cameraBtn.textContent = '📸 拍一张';
    R.cameraBtn.dataset.mode = '';
  }

  R.cameraBtn.addEventListener('click', () => {
    if (R.cameraBtn.dataset.mode === 'shoot') shoot();
    else startCamera();
  });

  // 性格：和内置形象共用同一份选项，别让用户学两套词
  function renderChips() {
    R.tempChips.textContent = '';
    for (const t of DIY.TEMPERAMENTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (S.temperament === t.id ? ' is-on' : '');
      b.textContent = `${t.emoji} ${t.label}`;
      b.title = t.desc;
      b.addEventListener('click', () => {
        S.temperament = t.id;
        renderChips();
      });
      R.tempChips.appendChild(b);
    }
  }

  // ------------------------------------------------------------------ 生成

  function cropDataUrl() {
    const side = cropSide();
    const c = document.createElement('canvas');
    c.width = OUT;
    c.height = OUT;
    c.getContext('2d').drawImage(S.img, S.cx - side / 2, S.cy - side / 2, side, side, 0, 0, OUT, OUT);
    return c.toDataURL('image/png');
  }

  async function forge() {
    if (S.busy || !S.img) return;
    S.busy = true;
    R.forgeBtn.disabled = true;
    R.forgeBtn.textContent = '正在抠图……';
    note('在本机处理，大概一两秒。');
    const res = await invoke(CH.forge, {
      dataUrl: cropDataUrl(),
      name: R.name.value.trim(),
      temperament: S.temperament,
    });
    S.busy = false;
    R.forgeBtn.textContent = '生成桌宠';
    R.forgeBtn.disabled = false;

    if (!res || !res.ok) {
      const msg = (res && res.message) || '这次没成功，换一张试试。';
      note(msg, 'warn');
      R.result.hidden = true;
      return;
    }
    S.result = res.pet;
    showResult(res.pet, res.meta);
    await refreshGallery();
    note('好了。如果边缘有点毛，换一张背景更干净的照片会更像。', 'ok');
  }

  function showResult(pet, meta) {
    R.result.hidden = false;
    R.resultName.textContent = pet.name;
    const confident = meta && meta.confident;
    const eyes = meta ? meta.eyes : 0;
    R.resultMeta.textContent = `${pet.name ? '已生成' : '已生成'} · ${meta ? meta.size : 512}px`;
    R.resultMeta.className = 'badge ' + (confident ? 'badge--ok' : 'badge--warn');

    R.frameIdle.src = pet.idle;
    R.frameBlink.src = pet.blink || pet.idle;
    R.blinkCap.textContent = pet.blink ? '闭眼' : '没有闭眼帧';

    const warns = [];
    if (!confident) warns.push('背景和主体颜色太接近，边缘可能有残留——换一张背景更简单的会更干净。');
    if (!eyes) warns.push('没找到成对的眼睛，所以这次没做闭眼帧；不影响使用，只是眨眼时会用整体动作代替。');
    R.resultWarn.hidden = warns.length === 0;
    R.resultWarn.textContent = warns.join(' ');
  }

  R.forgeBtn.addEventListener('click', forge);
  R.againBtn.addEventListener('click', () => {
    R.result.hidden = true;
    S.img = null;
    R.stageEmpty.hidden = false;
    R.preview.getContext('2d').clearRect(0, 0, CANVAS, CANVAS);
    R.forgeBtn.disabled = true;
    R.srcHint.textContent = '目标居中、背景干净，抠得最干净。';
    note('换一张吧。');
  });

  R.useBtn.addEventListener('click', async () => {
    if (!S.result) return;
    const cfg = DIY.normalize({
      enabled: true,
      animalId: S.result.id,
      temperament: S.result.temperament || S.temperament,
    });
    const res = await invoke(CH.settings, { diyPet: cfg });
    if (res && res.ok === false) {
      note((res && res.message) || '换上没成功。', 'warn');
      return;
    }
    note(`换上「${S.result.name}」了。回去看桌面右下角。`, 'ok');
  });

  // ------------------------------------------------------------------ 相册

  async function refreshGallery() {
    const res = await invoke(CH.list);
    const items = (res && res.ok && res.items) || [];
    R.gallery.textContent = '';
    if (!items.length) {
      R.countNote.textContent = '还没有照片宠物';
      return;
    }
    R.countNote.textContent = `已经拍了 ${items.length} 只`;
    for (const it of items.slice().reverse()) {
      const box = document.createElement('div');
      box.className = 'gallery__item';
      const img = document.createElement('img');
      img.src = it.idle;
      img.alt = it.name;
      const label = document.createElement('span');
      label.textContent = it.name;
      label.title = it.name;
      const acts = document.createElement('div');
      acts.className = 'gallery__acts';
      const use = document.createElement('button');
      use.type = 'button';
      use.textContent = '用';
      use.addEventListener('click', async () => {
        const cfg = DIY.normalize({ enabled: true, animalId: it.id, temperament: it.temperament });
        await invoke(CH.settings, { diyPet: cfg });
        note(`换上「${it.name}」了。`, 'ok');
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '删';
      del.addEventListener('click', async () => {
        await invoke(CH.remove, { id: it.id });
        await refreshGallery();
        note('删掉了。');
      });
      acts.append(use, del);
      box.append(img, label, acts);
      R.gallery.appendChild(box);
    }
  }

  // ------------------------------------------------------------------ 启动

  // 关闭本面板：优先走 preload 的 close()/window('close')，失败或不可用时退回 window.close()（修复“关不掉”）
  function closePanel() {
    const fallback = () => { try { window.close(); } catch (_) { /* ignore */ } };
    try {
      const p = api && (api.close ? api.close() : api.window ? api.window('close') : api.invoke('app:panel:window', { action: 'close' }));
      if (!p || typeof p.then !== 'function') return fallback();
      p.then((r) => { if (r === false || (r && r.ok === false)) fallback(); }, fallback);
    } catch (_) { fallback(); }
  }
  R.closeBtn.addEventListener('click', () => {
    if (S.stream) stopCamera();
    closePanel();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (S.stream) stopCamera();
      else closePanel();
    }
  });
  window.addEventListener('beforeunload', stopCamera);

  renderChips();
  refreshGallery();

  // 视觉验收 / 冒烟测试用：?demo=1 合成一张"路边拍的"照片（浅背景 + 主体），
  // 然后真的走一遍完整管线。它测的正是主进程的抠图与归一化，不是假的界面态。
  //
  // 不依赖任何外部素材：早先这里 drawImage 了一张 webp，机器一忙 decode 就卡住，
  // 结果是"没有报错、界面空着"——这种沉默失败最难查。改成纯 canvas 合成，确定性。
  const demoParam = new URLSearchParams(location.search).get('demo');
  if (demoParam) {
    (async () => {
      try {
        const c = document.createElement('canvas');
        c.width = 900;
        c.height = 900;
        const ctx = c.getContext('2d');
        const bg = ctx.createLinearGradient(0, 0, 900, 900);
        bg.addColorStop(0, '#dfe6ef');
        bg.addColorStop(1, '#c8d2c4');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 900, 900);

        // 地面阴影
        ctx.fillStyle = 'rgba(120, 132, 110, 0.16)';
        ctx.beginPath();
        ctx.ellipse(450, 700, 260, 60, 0, 0, Math.PI * 2);
        ctx.fill();

        // 身体
        ctx.fillStyle = '#d69660';
        ctx.beginPath();
        ctx.ellipse(450, 470, 200, 215, 0, 0, Math.PI * 2);
        ctx.fill();

        // 两只耳朵
        ctx.fillStyle = '#e8ac76';
        for (const ex of [310, 590]) {
          ctx.beginPath();
          ctx.ellipse(ex, 245, 52, 76, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        // 两只眼睛（深色圆点，用来验证成对眼睛检测 → 闭眼帧）
        ctx.fillStyle = '#2a211c';
        for (const ex of [372, 528]) {
          ctx.beginPath();
          ctx.arc(ex, 428, 18, 0, Math.PI * 2);
          ctx.fill();
        }

        loadImage(c.toDataURL('image/png'), '演示照片');
        await new Promise((r) => setTimeout(r, 120));
        R.name.value = '豆沙';
        await forge();
      } catch (err) {
        // 别沉默：demo 失败要能在控制台里看见，否则只会表现成"界面空着"
        console.error('[photo] demo failed:', err && err.message);
      }
    })();
  }
})();
