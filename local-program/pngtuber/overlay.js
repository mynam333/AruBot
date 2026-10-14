(() => {
  'use strict';
  const stage = document.getElementById('stage');
  const query = new URLSearchParams(location.search);
  const token = query.get('key') || '';
  const preview = query.get('preview') === '1';
  const images = new Map();
  let snapshot = null, receivedAt = 0, reactionUntil = 0;
  let ws = null, retry = null, retryMs = 250, stopped = false;
  let shown = '', lastFrame = 0, requestPending = false;
  let lastPollAt = -Infinity;
  const route = (name) => `/${name}?key=${encodeURIComponent(token)}${preview ? '&preview=1' : ''}`;
  function render() {
    if (!snapshot) return;
    const { config, runtime } = snapshot;
    const now = Date.now();
    const fresh = ws?.readyState === 1 && now - receivedAt < 1500;
    let asset = runtime.asset;
    if (runtime.mode === 'reaction' && now < reactionUntil) asset = runtime.asset;
    else if (!fresh || runtime.mode === 'reaction') {
      asset = config.enabled || preview ? config.closedAsset : '';
      if (fresh && runtime.connected && runtime.sourceAvailable && runtime.muted)
        asset = config.mutedAsset || config.closedAsset;
    }
    const next = images.get(asset);
    const target = next?.complete && next.naturalWidth > 0 ? asset : '';
    if (target !== shown) {
      images.get(shown)?.classList.remove('visible');
      images.get(target)?.classList.add('visible');
      shown = target;
    }
  }
  function receive(value) {
    if (!value?.config || !value.runtime || !Array.isArray(value.assets)) return;
    snapshot = value;
    receivedAt = Date.now();
    lastFrame++;
    reactionUntil = receivedAt + Math.max(0, Math.min(300000, Number(value.runtime.remainingMs) || 0));
    const keep = new Set(value.assets.map((asset) => asset.id));
    for (const [id, image] of images) {
      if (!keep.has(id)) { image.remove(); images.delete(id); if (shown === id) shown = ''; }
    }
    for (const asset of value.assets) {
      if (!/^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(asset.id)) continue;
      let image = images.get(asset.id);
      if (!image) {
        image = new Image();
        image.alt = '';
        image.draggable = false;
        image.onload = render;
        image.onerror = render;
        images.set(asset.id, image);
        stage.append(image);
        image.src = route(`assets/${asset.id}`);
      }
      image.style.objectFit = ['contain', 'cover', 'fill'].includes(value.config.fit) ? value.config.fit : 'contain';
      image.style.transform = value.config.flipX ? 'scaleX(-1)' : '';
    }
    render();
  }
  async function poll() {
    if (requestPending || stopped || Date.now() - lastPollAt < 2000) return;
    lastPollAt = Date.now();
    requestPending = true;
    const version = lastFrame;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(route('state'), { cache: 'no-store', signal: controller.signal });
      if (response.ok) {
        const data = await response.json();
        if (version === lastFrame && !stopped) receive(data);
      }
    } catch { /* The app may be restarting; the reconnect loop never gives up. */ }
    finally { clearTimeout(timeout); requestPending = false; }
  }
  function connect() {
    if (stopped || ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    clearTimeout(retry);
    const socket = ws = new WebSocket(`ws://${location.host}${route('ws')}`);
    const timeout = setTimeout(() => socket.close(), 5000);
    socket.onopen = () => { clearTimeout(timeout); retryMs = 250; };
    socket.onmessage = (event) => {
      if (socket !== ws || event.data.length > 128 * 1024) return;
      try { receive(JSON.parse(event.data)); } catch { /* Ignore an invalid snapshot. */ }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      clearTimeout(timeout);
      if (socket !== ws || stopped) return;
      ws = null;
      render();
      void poll();
      retry = setTimeout(connect, retryMs);
      retryMs = Math.min(5000, retryMs * 2);
    };
  }
  const watchdog = setInterval(() => {
    render();
    if (ws?.readyState === 1 && Date.now() - receivedAt > 5000) ws.close();
    if (!ws || ws.readyState > 1) { void poll(); if (!retry) connect(); }
  }, 100);
  window.addEventListener('pagehide', () => {
    stopped = true;
    clearTimeout(retry);
    clearInterval(watchdog);
    ws?.close();
  });
  void poll();
  connect();
})();
