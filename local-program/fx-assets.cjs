const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { fileURLToPath } = require('url');
const { WebSocketServer, WebSocket } = require('ws');

const MEDIA_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4', '.flac': 'audio/flac',
};

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) return false;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return false;
  return { start, end };
}

function createFxAssetServer({ getFolder, getAllowedOrigins = () => [], onError = () => {},
  viewerDirectory, getViewerKey, getViewerConfig, getPort = () => 0, onListening = () => {} }) {
  const secret = crypto.randomBytes(32);
  let server = null;
  let starting = null;
  const viewers = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });

  function validViewerRequest(req, url) {
    const key = url.searchParams.get('k') || '';
    const expected = String(getViewerKey?.() || '');
    return /^[a-f0-9]{64}$/.test(key) && key.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected))
      && (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`);
  }

  function publish(type, payload) {
    const event = JSON.stringify({ type, payload });
    let sent = 0;
    for (const socket of viewers.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      // Do not accumulate obsolete effects for a stalled renderer.
      if (socket.bufferedAmount > 1024 * 1024) { socket.terminate(); continue; }
      try { socket.send(event); sent += 1; } catch { socket.terminate(); }
    }
    return sent;
  }

  async function preloadAssets() {
    const entries = await fs.promises.readdir(String(getFolder() || '')).catch(() => []);
    const assets = [];
    let bytes = 0;
    for (const name of entries) {
      const mime = MEDIA_TYPES[path.extname(name).toLowerCase()];
      if (!mime || mime.startsWith('video/')) continue;
      const fullPath = getAssetPath(name);
      if (!fullPath) continue;
      const stat = await fs.promises.stat(fullPath).catch(() => null);
      if (!stat || stat.size > 8 * 1024 * 1024 || bytes + stat.size > 32 * 1024 * 1024) continue;
      bytes += stat.size;
      assets.push({ kind: mime.startsWith('audio/') ? 'sound' : 'image', assetUrl: await getAssetUrl(name) });
      if (assets.length >= 32) break;
    }
    return assets;
  }

  function getAssetPath(assetId) {
    const name = String(assetId || '');
    if (!name || /[\\/:\0]/.test(name) || !MEDIA_TYPES[path.extname(name).toLowerCase()]) return '';
    const folder = String(getFolder() || '').trim();
    if (!folder) return '';
    try {
      const root = fs.realpathSync(folder);
      const fullPath = fs.realpathSync(path.join(root, name));
      // Resolve symlinks/junctions before checking the configured folder boundary.
      if (path.dirname(fullPath) !== root || !MEDIA_TYPES[path.extname(fullPath).toLowerCase()] || !fs.statSync(fullPath).isFile()) return '';
      return fullPath;
    } catch { return ''; }
  }

  function sign(fullPath) {
    return crypto.createHmac('sha256', secret).update(fullPath).digest('hex');
  }

  function handleRequest(req, res) {
    try {
      const listener = server?.address();
      if (!listener || req.headers.host !== `127.0.0.1:${listener.port}`) {
        res.writeHead(403).end();
        return;
      }
      const url = new URL(req.url, 'http://127.0.0.1');
      if (viewerDirectory && url.pathname.startsWith('/fx-viewer')) {
        const key = url.searchParams.get('k') || '';
        if (!validViewerRequest(req, url)) {
          res.writeHead(403).end();
          return;
        }
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (url.pathname === '/fx-viewer/config') {
          res.setHeader('Content-Type', 'application/json');
          void Promise.resolve().then(getViewerConfig).then((value) => {
            res.end(req.method === 'HEAD' ? undefined : JSON.stringify(value));
          }).catch((error) => { onError(error); res.writeHead(503).end('{}'); });
          return;
        }
        if (url.pathname === '/fx-viewer') {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(req.method === 'HEAD' ? undefined : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AruBot Local FX</title><link rel="stylesheet" href="/fx-viewer/style?k=${encodeURIComponent(key)}"></head><body style="margin:0;background:transparent"><div id="root"></div><script src="/fx-viewer/script?k=${encodeURIComponent(key)}"></script></body></html>`);
          return;
        }
        const file = { '/fx-viewer/script': 'viewer.js', '/fx-viewer/style': 'viewer.css' }[url.pathname];
        if (!file) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/css');
        const content = fs.readFileSync(path.join(viewerDirectory, file));
        res.end(req.method === 'HEAD' ? undefined : content);
        return;
      }
      const fullPath = url.pathname === '/fx-asset' ? getAssetPath(url.searchParams.get('id')) : '';
      const key = url.searchParams.get('k') || '';
      if (!fullPath || !/^[a-f0-9]{64}$/.test(key) || !crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(sign(fullPath), 'hex'))) {
        res.writeHead(404).end();
        return;
      }
      const origin = req.headers.origin;
      const origins = getAllowedOrigins().flatMap((value) => {
        try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? [url.origin] : []; }
        catch { return []; }
      });
      if (origin && origin !== `http://${req.headers.host}` && !origins.includes(origin)) {
        res.writeHead(403).end();
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Vary', 'Origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        if (req.headers['access-control-request-private-network'] === 'true') {
          res.setHeader('Access-Control-Allow-Private-Network', 'true');
        }
        res.writeHead(204).end();
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD, OPTIONS');
        res.writeHead(405).end();
        return;
      }
      const { size, mtimeMs } = fs.statSync(fullPath);
      if (url.searchParams.get('v') === `${size}-${mtimeMs}`) res.setHeader('Cache-Control', 'private, max-age=3600');
      const range = parseRange(req.headers.range, size);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', MEDIA_TYPES[path.extname(fullPath).toLowerCase()]);
      if (range === false) {
        res.setHeader('Content-Range', `bytes */${size}`);
        res.writeHead(416).end();
        return;
      }
      res.statusCode = range ? 206 : 200;
      res.setHeader('Content-Length', range ? range.end - range.start + 1 : size);
      if (range) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      if (req.method === 'HEAD' || size === 0) { res.end(); return; }
      const stream = fs.createReadStream(fullPath, range || undefined);
      res.on('close', () => stream.destroy());
      stream.on('error', (error) => {
        onError(error);
        if (res.headersSent) res.destroy();
        else { res.removeHeader('Content-Length'); res.removeHeader('Content-Range'); res.writeHead(404).end(); }
      });
      stream.pipe(res);
    } catch (error) {
      onError(error);
      if (res.headersSent) res.destroy();
      else { res.removeHeader('Content-Length'); res.writeHead(500).end(); }
    }
  }

  async function start() {
    if (server?.listening) return server.address().port;
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      const listener = http.createServer(handleRequest);
      server = listener;
      listener.on('upgrade', (req, socket, head) => {
        let url;
        try { url = new URL(req.url, 'http://127.0.0.1'); } catch { socket.destroy(); return; }
        if (req.headers.host !== `127.0.0.1:${listener.address()?.port}`
          || url.pathname !== '/fx-viewer/ws' || !validViewerRequest(req, url)) {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
        }
        viewers.handleUpgrade(req, socket, head, (client) => {
          client.on('error', () => client.terminate());
          client.on('message', (raw) => {
            try { if (JSON.parse(String(raw)).type === 'ping') client.send('{"type":"pong"}'); } catch { /* Ignore invalid heartbeats. */ }
          });
          client.send('{"type":"hello"}');
          void preloadAssets().then((assets) => {
            if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'fx:preload', assets }));
          }).catch(onError);
        });
      });
      listener.on('error', onError);
      listener.once('error', reject);
      listener.listen(getPort(), '127.0.0.1', () => {
        listener.removeListener('error', reject);
        const port = listener.address().port;
        try { onListening(port); resolve(port); } catch (error) { reject(error); }
      });
    });
    try { return await starting; }
    catch (error) { server?.close(); server = null; throw error; }
    finally { starting = null; }
  }

  async function getAssetUrl(assetId) {
    const fullPath = getAssetPath(assetId);
    if (!fullPath) throw new Error('FX 파일을 찾을 수 없습니다. 로컬 프로그램의 FX 폴더와 파일 이름을 확인해 주세요.');
    const port = await start();
    const url = new URL(`http://127.0.0.1:${port}/fx-asset`);
    url.searchParams.set('id', String(assetId));
    url.searchParams.set('k', sign(fullPath));
    const { size, mtimeMs } = fs.statSync(fullPath);
    url.searchParams.set('v', `${size}-${mtimeMs}`);
    return url.href;
  }

  async function close() {
    if (starting) await starting.catch(() => {});
    const listener = server;
    if (!listener) return;
    for (const socket of viewers.clients) socket.terminate();
    await new Promise((resolve) => {
      listener.close(resolve);
      listener.closeAllConnections();
    });
    if (server === listener) server = null;
  }

  async function getViewerUrl() {
    if (!viewerDirectory || !fs.existsSync(path.join(viewerDirectory, 'viewer.js'))) {
      throw new Error('로컬 FX 오버레이 파일이 없습니다. 로컬 프로그램을 업데이트해 주세요.');
    }
    const port = await start();
    const url = new URL(`http://127.0.0.1:${port}/fx-viewer`);
    url.searchParams.set('k', getViewerKey());
    return url.href;
  }

  return { getAssetPath, getAssetUrl, getViewerUrl, publish, start, close };
}

async function resolveFxAssetUrl(payload, getAssetUrl) {
  if (payload.youtubeUrl) return '';
  const raw = String(payload.assetUrl || '').trim();
  let assetId = String(payload.assetId || payload.fileId || payload.name || '');
  if (raw) {
    let url;
    try { url = new URL(raw); } catch { throw new Error('FX 파일 주소가 올바르지 않습니다. 에셋 목록에서 파일을 다시 선택해 주세요.'); }
    if (url.protocol === 'file:') {
      if (!assetId) assetId = path.win32.basename(fileURLToPath(url));
    } else if (['http:', 'https:'].includes(url.protocol)) {
      if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/fx-asset') return url.href;
      // Refresh old loopback ports/keys after restarting the local program.
      if (!assetId) assetId = url.searchParams.get('id') || '';
    } else {
      throw new Error('FX 파일은 등록된 로컬 에셋 또는 HTTP/HTTPS 주소만 사용할 수 있습니다.');
    }
  }
  return getAssetUrl(assetId);
}

module.exports = { createFxAssetServer, resolveFxAssetUrl, parseRange };
