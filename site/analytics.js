(function () {
  'use strict';

  const ENDPOINT = '/cubbit/t.gif';
  const ALLOWED = new Set([
    'landing_view',
    'download_click',
    'download_start',
    'tour_click',
    'install_guide_click',
    'mobile_click',
    'android_download_click',
  ]);

  function sessionId() {
    try {
      let id = sessionStorage.getItem('cubbit_sid');
      if (!id) {
        id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem('cubbit_sid', id);
      }
      return id;
    } catch {
      return 'no-storage';
    }
  }

  const sid = sessionId();

  function track(event, props = {}) {
    if (!ALLOWED.has(event)) return;
    const query = new URLSearchParams({
      event,
      sid,
      path: location.pathname,
      position: String(props.position || '').slice(0, 40),
      target: String(props.target || '').slice(0, 80),
      ts: String(Date.now()),
    });
    const url = `${ENDPOINT}?${query.toString()}`;
    try {
      if (typeof fetch === 'function') {
        fetch(url, { method: 'GET', keepalive: true, credentials: 'omit', mode: 'no-cors' }).catch(() => {
          const image = new Image(1, 1);
          image.src = url;
        });
      } else {
        const image = new Image(1, 1);
        image.src = url;
      }
    } catch {
      /* analytics must never block navigation */
    }
  }

  window.CubbitTrack = { track };

  function boot() {
    track('landing_view');
    document.addEventListener('click', (event) => {
      const node = event.target && event.target.closest ? event.target.closest('[data-track]') : null;
      if (!node) return;
      const name = node.getAttribute('data-track');
      const position = node.getAttribute('data-track-position') || '';
      track(name, { position, target: node.getAttribute('href') || '' });
      if (node.hasAttribute('data-track-download')) {
        track('download_start', { position, target: node.getAttribute('href') || '' });
      }
    }, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
