export function registerEmoteOverlayRoutes(app, { runtime, getOwner, writeLimiter, promoteStream = () => true, logger = console }) {
  const owner = async req => {
    const id = await getOwner(req);
    if (!id) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 });
    return id;
  };
  const headers = res => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
  };
  const errorResponse = (res, error) => {
    if (!error.status) logger.error('[emote-overlay] API failed:', error?.message);
    return res.status(error.status || 503).json({ error: error.status ? error.message : '오버레이에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  };
  const wrap = fn => async (req, res) => {
    headers(res);
    try { return res.json(await fn(req)); } catch (error) { return errorResponse(res, error); }
  };
  app.get('/api/emote-overlay', wrap(async req => runtime.get(await owner(req))));
  app.put('/api/emote-overlay/settings', writeLimiter, wrap(async req => runtime.save(await owner(req), req.body?.settings, req.body?.revision)));
  app.post('/api/emote-overlay/clear', writeLimiter, wrap(async req => runtime.clear(await owner(req))));
  app.post('/api/emote-overlay/rotate', writeLimiter, wrap(async req => runtime.rotate(await owner(req))));
  app.post('/api/emote-overlay/test', writeLimiter, wrap(async req => runtime.test(await owner(req))));
  app.get('/api/emote-overlay/state', wrap(req => runtime.snapshot(req.query.token, req.query.after)));
  app.get('/api/emote-overlay/stream', async (req, res) => {
    headers(res);
    let cursor = req.query.after;
    let closed = false, loading = false, lastSent = 0, fingerprint = '';
    let unsubscribe, timer;
    const release = () => { const off = unsubscribe; unsubscribe = undefined; off?.(); };
    const close = () => { if (closed) return; closed = true; clearInterval(timer); release(); if (!res.writableEnded && !res.destroyed) res.end(); };
    const send = (event, value) => {
      if (closed || res.destroyed) return close();
      if (!res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)) close();
      lastSent = Date.now();
    };
    const deliver = snapshot => {
      const next = `${snapshot.epoch}:${snapshot.revision}:${snapshot.cursor}`;
      cursor = snapshot.cursor;
      if (next !== fingerprint || snapshot.events.length) { fingerprint = next; send('state', snapshot); }
      else if (Date.now() - lastSent > 15000) send('heartbeat', { at: Date.now() });
    };
    const poll = async () => {
      if (closed || loading) return;
      loading = true;
      try { const snapshot = await runtime.snapshot(req.query.token, cursor); if (!closed) deliver(snapshot); }
      catch (error) { if (!closed) { send('unavailable', { status: error.status || 503 }); close(); } }
      finally { loading = false; }
    };
    res.on('close', close); res.on('error', close);
    try {
      const initial = await runtime.snapshot(req.query.token, cursor);
      if (closed || res.destroyed) return close();
      unsubscribe = runtime.subscribe(req.query.token, notification => {
        if (notification?.closed) {
          // Streaming headers are already committed; end the keep-alive socket after flushing.
          const socket = res.socket;
          res.once('finish', () => socket?.end());
          close();
        }
        else void poll();
      });
      if (!unsubscribe) throw Object.assign(new Error('연결 수가 너무 많습니다.'), { status: 429 });
      if (!promoteStream(req, res)) { release(); return; }
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setTimeout(0); res.flushHeaders();
      deliver(initial);
      if (closed) return;
      timer = setInterval(() => void poll(), 1500); timer.unref?.();
    } catch (error) { release(); if (!res.headersSent && !closed && !res.destroyed) errorResponse(res, error); else close(); }
  });
}
