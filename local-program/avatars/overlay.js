(() => {
  'use strict';

  const RENDERER_VERSION = 3;
  const PROTOCOL_VERSION = 3;
  const RECENT_MS = 10000;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finite = (value, fallback) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const assetName = (value) =>
    /^[a-f0-9]{64}\.(png|gif|webp|jpg)$/.test(value || '') ? value : '';

  function normalizeClip(clip = {}) {
    const columns = clamp(Math.round(finite(clip.columns, 1)), 1, 32);
    const rows = clamp(Math.round(finite(clip.rows, 1)), 1, 32);
    const frames = clamp(Math.round(finite(clip.frames, 1)), 1, columns * rows);
    const startFrame = clamp(
      Math.round(finite(clip.startFrame, 0)),
      0,
      frames - 1,
    );
    return {
      ...clip,
      asset: assetName(clip.asset),
      columns,
      rows,
      frames,
      startFrame,
      endFrame: clamp(
        Math.round(finite(clip.endFrame, frames - 1)),
        startFrame,
        frames - 1,
      ),
      fps: clamp(finite(clip.fps, 12), 1, 60),
      playback: ['once', 'hold'].includes(clip.playback)
        ? clip.playback
        : 'loop',
      anchorX: clamp(finite(clip.anchorX, 0.5), 0, 1),
      anchorY: clamp(finite(clip.anchorY, 1), 0, 1),
      offsetX: finite(clip.offsetX, 0),
      offsetY: finite(clip.offsetY, 0),
      scale: clamp(finite(clip.scale, 1), 0.01, 10),
      direction: clip.direction === 'left' ? 'left' : 'right',
      preserveAspect: clip.preserveAspect !== false,
    };
  }

  function resolveClip(avatar, state, failed = () => false) {
    const states = avatar?.states || {};
    const selected = states[state]
      ? state
      : state === 'run' && states.walk
        ? 'walk'
        : 'idle';
    const fallback = failed(states[selected]?.asset) ? 'idle' : selected;
    if (!states[fallback] || failed(states[fallback].asset)) return null;
    const clip = normalizeClip(states[fallback]);
    return clip.asset ? { state: fallback, clip } : null;
  }

  function clipGeometry(clip, actor, image = {}) {
    const c = normalizeClip(clip);
    const frameWidth =
      finite(c.frameWidth, 0) > 0
        ? c.frameWidth
        : finite(image.naturalWidth, 0) / c.columns;
    const frameHeight =
      finite(c.frameHeight, 0) > 0
        ? c.frameHeight
        : finite(image.naturalHeight, 0) / c.rows;
    const ratio =
      c.preserveAspect && frameWidth > 0 && frameHeight > 0
        ? frameWidth / frameHeight
        : 1;
    // The engine's size already includes the active temporary scale.
    const height = Math.max(1, finite(actor.size, 76)) * c.scale;
    const width = height * ratio;
    const flip =
      (actor.direction === -1 ? -1 : 1) * (c.direction === 'left' ? -1 : 1);
    return {
      width,
      height,
      flip,
      left: c.offsetX * flip - width * (flip === 1 ? c.anchorX : 1 - c.anchorX),
      top: c.offsetY - height * c.anchorY,
    };
  }

  function frameAt(clip, actor, simulationTime, stride = 50) {
    const c = normalizeClip(clip);
    const count = c.endFrame - c.startFrame + 1;
    const elapsed = Math.max(
      0,
      finite(simulationTime, 0) - finite(actor.animationStartedAt, 0),
    );
    const moving =
      ['walk', 'run'].includes(actor.state) &&
      Number.isFinite(actor.travelDistance);
    // Non-looping clips use engine time so arrival cannot prevent completion.
    const steps =
      moving && c.playback === 'loop'
        ? Math.floor(
            (Math.max(0, actor.travelDistance) /
              clamp(finite(stride, 50), 10, 200)) *
              count,
          )
        : Math.floor((elapsed * c.fps) / 1000);
    const finished = c.frames > 1 && c.playback !== 'loop' && steps >= count;
    return {
      frame:
        c.startFrame +
        (c.playback === 'loop' ? steps % count : Math.min(steps, count - 1)),
      returnToIdle: finished && c.playback === 'once',
      finished,
    };
  }

  function framePosition(clip, frame) {
    return `${clip.columns === 1 ? 0 : ((frame % clip.columns) / (clip.columns - 1)) * 100}% ${clip.rows === 1 ? 0 : (Math.floor(frame / clip.columns) / (clip.rows - 1)) * 100}%`;
  }

  function sceneLayout(data = {}, viewport = {}, options = {}) {
    const width = Math.max(1, finite(data.width, 1920));
    const height = Math.max(1, finite(data.height, 1080));
    const vw = Math.max(1, finite(viewport.width, width));
    const vh = Math.max(1, finite(viewport.height, height));
    const monitor = options.monitor === true;
    const full = monitor && options.view === 'full';
    const viewHeight = full
      ? height
      : clamp(finite(data.previewHeight, 420), 1, height);
    const scale = monitor ? Math.min(vw / width, vh / viewHeight) : vw / width;
    let left = (vw - width * scale) / 2;
    let bottom = full ? (vh - height * scale) / 2 : 0;
    if (monitor && !full && options.follow) {
      const maxTop = Math.max(0, height - vh / scale);
      const top = clamp(options.follow.y - (vh / scale) * 0.6, 0, maxTop);
      bottom = vh - (height - top) * scale;
      const visibleWidth = vw / scale;
      const x = clamp(
        options.follow.x - visibleWidth / 2,
        0,
        Math.max(0, width - visibleWidth),
      );
      left = visibleWidth < width ? -x * scale : left;
    }
    const visibleTop = Math.max(0, height - (vh - bottom) / scale);
    const visibleBottom = Math.min(height, height + bottom / scale);
    const safeLeft = clamp(finite(data.safeLeft, 0), 0, width - 1);
    const safeRight = clamp(
      width - finite(data.safeRight, 0),
      safeLeft + 1,
      width,
    );
    const safeTop = clamp(
      Math.max(finite(data.safeTop, 0), visibleTop),
      0,
      visibleBottom - 1,
    );
    const safeBottom = clamp(
      Math.min(finite(data.ground, height), visibleBottom),
      safeTop + 1,
      height,
    );
    return {
      width,
      height,
      scale,
      left,
      bottom,
      safe: {
        left: safeLeft,
        right: safeRight,
        top: safeTop,
        bottom: safeBottom,
      },
    };
  }

  function fitActor(actor, bounds, safe) {
    const scale = Math.min(
      1,
      (safe.right - safe.left) / Math.max(1, bounds.right - bounds.left),
      (safe.bottom - safe.top) / Math.max(1, bounds.bottom - bounds.top),
    );
    return {
      x: clamp(
        actor.x,
        safe.left - bounds.left * scale,
        safe.right - bounds.right * scale,
      ),
      y: clamp(
        actor.y,
        safe.top - bounds.top * scale,
        safe.bottom - bounds.bottom * scale,
      ),
      scale,
    };
  }

  function labelVisibility(actors, data, activity) {
    const time = finite(data.simulationTime, finite(data.at, 0));
    const ordered = [...actors].sort(
      (a, b) =>
        (activity.get(b.id) ?? 0) - (activity.get(a.id) ?? 0) ||
        finite(a.number, 0) - finite(b.number, 0) ||
        String(a.id).localeCompare(String(b.id)),
    );
    const nameLimit = clamp(Math.floor(finite(data.nameLimit, 150)), 0, 150);
    const bubbleLimit = clamp(Math.floor(finite(data.bubbleLimit, 10)), 0, 150);
    return {
      names: new Set(
        (data.showNames === false ? [] : ordered)
          .filter(
            (a) =>
              data.namesMode !== 'recent' ||
              time - (activity.get(a.id) ?? -Infinity) <= RECENT_MS,
          )
          .slice(0, nameLimit)
          .map((a) => a.id),
      ),
      bubbles: new Set(
        ordered
          .filter((a) => a.bubble)
          .slice(0, bubbleLimit)
          .map((a) => a.id),
      ),
    };
  }

  function createFrameGate() {
    let session = null,
      sequence = -1,
      revision = -1,
      time = -Infinity,
      legacyTime = -Infinity;
    const retired = new Set();
    return (data) => {
      if (!data || typeof data !== 'object')
        return { accepted: false, code: 'INVALID_FRAME' };
      if (
        data.protocolVersion != null &&
        data.protocolVersion !== PROTOCOL_VERSION
      )
        return { accepted: false, code: 'PROTOCOL_MISMATCH' };
      if (
        data.rendererVersion != null &&
        data.rendererVersion !== RENDERER_VERSION
      )
        return { accepted: false, code: 'VERSION_MISMATCH' };
      if (!Array.isArray(data.actors) || !Array.isArray(data.avatars))
        return { accepted: false, code: 'BOOTSTRAP_MISSING' };
      if (
        data.actors.length > 150 ||
        data.avatars.length > 64 ||
        data.actors.some(
          (a) =>
            !a ||
            typeof a.id !== 'string' ||
            !Number.isFinite(a.x) ||
            !Number.isFinite(a.y),
        ) ||
        data.avatars.some(
          (a) =>
            !a ||
            typeof a.id !== 'string' ||
            !a.states ||
            typeof a.states !== 'object',
        )
      )
        return { accepted: false, code: 'INVALID_FRAME' };
      const modern =
        data.sessionId != null ||
        data.sequence != null ||
        data.simulationTime != null ||
        data.protocolVersion != null;
      if (!modern) {
        if (
          session !== null ||
          !Number.isFinite(data.at) ||
          data.at < legacyTime
        )
          return { accepted: false, code: 'STALE_FRAME' };
        legacyTime = data.at;
        return { accepted: true, reset: false, legacy: true };
      }
      if (
        typeof data.sessionId !== 'string' ||
        !data.sessionId ||
        data.sessionId.length > 128 ||
        !Number.isSafeInteger(data.sequence) ||
        data.sequence < 0 ||
        !Number.isSafeInteger(data.configRevision) ||
        data.configRevision < 0 ||
        !Number.isFinite(data.simulationTime) ||
        data.simulationTime < 0
      )
        return { accepted: false, code: 'INVALID_FRAME' };
      if (
        retired.has(data.sessionId) ||
        (session === data.sessionId &&
          (data.sequence <= sequence ||
            data.configRevision < revision ||
            data.simulationTime < time))
      )
        return { accepted: false, code: 'STALE_FRAME' };
      const reset = session !== data.sessionId;
      if (reset && session !== null) {
        retired.add(session);
        if (retired.size > 32) retired.delete(retired.values().next().value);
      }
      session = data.sessionId;
      sequence = data.sequence;
      revision = data.configRevision;
      time = data.simulationTime;
      return { accepted: true, reset, legacy: false };
    };
  }

  function reloadBudget(previous, now) {
    const attempts = clamp(Math.floor(finite(previous?.attempts, 0)), 0, 3);
    if (
      attempts >= 3 ||
      (attempts > 0 && now - finite(previous.at, now) < 30000)
    )
      return null;
    return { attempts: attempts + 1, at: now };
  }

  function createAssetCache(load, report) {
    const entries = new Map();
    let generation = 0;
    return {
      get(asset) {
        if (!assetName(asset)) return { status: 'failed' };
        if (!entries.has(asset)) {
          const entry = { status: 'loading', image: null };
          const current = generation;
          entries.set(asset, entry);
          entry.promise = Promise.resolve()
            .then(() => load(asset))
            .then((image) => {
              if (generation !== current || entries.get(asset) !== entry)
                return;
              entry.status = 'ready';
              entry.image = image;
            })
            .catch(() => {
              if (generation !== current || entries.get(asset) !== entry)
                return;
              entry.status = 'failed';
              report('ASSET_LOAD_FAILED', { asset });
            });
        }
        return entries.get(asset);
      },
      failed: (asset) => entries.get(asset)?.status === 'failed',
      prune(assets) {
        for (const asset of entries.keys())
          if (!assets.has(asset)) entries.delete(asset);
      },
      reset() {
        generation++;
        entries.clear();
      },
    };
  }

  const helpers = {
    normalizeClip,
    resolveClip,
    clipGeometry,
    frameAt,
    framePosition,
    sceneLayout,
    fitActor,
    labelVisibility,
    createFrameGate,
    reloadBudget,
    createAssetCache,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (typeof document === 'undefined') return;

  const parameters = new URLSearchParams(location.search);
  const monitor = parameters.get('monitor') === '1';
  const options = {
    monitor,
    view: parameters.get('view') === 'full' ? 'full' : 'zoom',
  };
  const stage = document.getElementById('stage');
  const game = document.getElementById('game');
  const guide = document.getElementById('safe-guide');
  const status = document.getElementById('connection-status');
  const diagnostics = document.getElementById('overlay-diagnostics');
  const nodes = new Map(),
    activity = new Map(),
    reports = [];
  const gate = createFrameGate();
  let snapshot = null,
    socket,
    retry = 0,
    reconnectTimer,
    reloadTimer,
    reloadReason;
  let receivedAt = 0,
    lastFrameAt = 0,
    connectedAt = 0,
    stableSince = 0;
  let layout,
    lastRender = performance.now();
  const storageKey = `arubot-overlay-reloads:${location.pathname}:${parameters.get('preview') === '1'}:${parameters.get('rehearsal') === '1'}`;
  const url = (path) =>
    `${path}?key=${encodeURIComponent(parameters.get('key') || '')}${parameters.get('preview') === '1' ? '&preview=1' : ''}${parameters.get('rehearsal') === '1' ? '&rehearsal=1' : ''}${monitor ? '&monitor=1' : ''}`;

  function report(code, detail = {}) {
    // DOM-only diagnostics are observable by the local inspector, never engine commands.
    const entry = { code, at: Date.now() };
    if (assetName(detail.asset)) entry.asset = detail.asset;
    if (
      reports.some(
        (r) =>
          r.code === entry.code &&
          r.asset === entry.asset &&
          entry.at - r.at < 30000,
      )
    )
      return;
    reports.push(entry);
    if (reports.length > 200) reports.shift();
    if (diagnostics) diagnostics.textContent = JSON.stringify(reports);
    document.dispatchEvent(
      new CustomEvent('arubot:overlay-diagnostic', { detail: entry }),
    );
    if (monitor && window.parent !== window)
      window.parent.postMessage(
        { type: 'arubot:avatar-overlay-diagnostic', code },
        '*',
      );
  }

  function connectionState(code) {
    document.documentElement.dataset.connection = code;
    if (!status) return;
    status.hidden = !monitor || code === 'connected';
    status.textContent =
      {
        connecting: '서버 연결 중',
        waiting: '서버 대기',
        stale: '프레임 지연',
        mismatch: '출력 버전 불일치',
        bootstrap: '초기 화면 수신 대기',
        invalid: '출력 데이터 오류',
      }[code] || '';
  }

  function requestReload(code) {
    report(code);
    if (code === 'RENDER_FAILED') {
      stableSince = 0;
      reloadReason = code;
    }
    if (reloadTimer) return;
    reloadReason = code;
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      try {
        const budget = reloadBudget(
          JSON.parse(sessionStorage.getItem(storageKey) || 'null'),
          Date.now(),
        );
        if (!budget) {
          report('RELOAD_LIMIT');
          return;
        }
        sessionStorage.setItem(storageKey, JSON.stringify(budget));
        location.reload();
      } catch {
        report('RELOAD_UNAVAILABLE');
      }
    }, 30000);
  }

  if (
    !stage ||
    !game ||
    document.documentElement.dataset.overlayVersion !== String(RENDERER_VERSION)
  ) {
    requestReload('BOOTSTRAP_MISSING');
    return;
  }
  document.documentElement.classList.toggle('monitor', monitor);
  document.documentElement.dataset.view = monitor ? options.view : 'output';
  const cache = createAssetCache(
    (asset) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        const timeout = setTimeout(() => finish(false), 10000);
        function finish(ok) {
          clearTimeout(timeout);
          image.onload = null;
          image.onerror = null;
          if (ok && image.naturalWidth > 0 && image.naturalHeight > 0)
            resolve(image);
          else reject(new Error('ASSET_LOAD_FAILED'));
        }
        image.onload = () => finish(true);
        image.onerror = () => finish(false);
        image.src = url(`/assets/${asset}`);
      }),
    report,
  );

  function resize() {
    const follow = monitor && parameters.get('follow');
    options.follow = follow
      ? snapshot?.actors.find(
          (a) => a.id === follow || String(a.number) === follow,
        )
      : null;
    layout = sceneLayout(
      snapshot || {},
      { width: innerWidth, height: innerHeight },
      options,
    );
    stage.style.width = `${layout.width}px`;
    stage.style.height = `${layout.height}px`;
    stage.style.transform = `scale(${layout.scale})`;
    stage.style.left = `${layout.left}px`;
    stage.style.bottom = `${layout.bottom}px`;
    const safe = layout.safe;
    if (guide) {
      guide.hidden = !monitor || parameters.get('guides') === '0';
      Object.assign(guide.style, {
        left: `${safe.left}px`,
        top: `${safe.top}px`,
        width: `${safe.right - safe.left}px`,
        height: `${safe.bottom - safe.top}px`,
      });
    }
    game.style.left = `${(safe.left + safe.right) / 2}px`;
    game.style.maxWidth = `${Math.min(1300, safe.right - safe.left)}px`;
    game.style.maxHeight = `${safe.bottom - safe.top}px`;
    const bottom = clamp(
      finite(snapshot?.gameBottom, 245),
      layout.height - safe.bottom,
      layout.height - safe.top,
    );
    game.style.bottom = `${bottom}px`;
  }

  function reset() {
    for (const node of nodes.values()) node.root.remove();
    nodes.clear();
    activity.clear();
    cache.reset();
    snapshot = null;
  }

  function createNode(actor) {
    const root = document.createElement('div');
    root.className = 'actor';
    const appearance = document.createElement('div');
    appearance.className = 'appearance';
    const sprite = document.createElement('div');
    sprite.className = 'sprite';
    appearance.append(sprite);
    const name = document.createElement('div');
    name.className = 'name';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const effect = document.createElement('div');
    effect.className = 'effect';
    root.append(appearance, name, bubble, effect);
    stage.append(root);
    return {
      root,
      appearance,
      sprite,
      name,
      bubble,
      effect,
      x: actor.x,
      y: actor.y,
      signature: '',
    };
  }

  function update(data) {
    const time = finite(data.simulationTime, data.at);
    const live = new Set(data.actors.map((a) => a.id));
    const avatars = new Map(data.avatars.map((a) => [a.id, a]));
    for (const [id, node] of nodes)
      if (!live.has(id)) {
        node.root.remove();
        nodes.delete(id);
        activity.delete(id);
      }
    for (const actor of data.actors) {
      let node = nodes.get(actor.id);
      if (!node) {
        node = createNode(actor);
        nodes.set(actor.id, node);
      }
      const before = node.target;
      if (Number.isFinite(actor.lastChat))
        activity.set(actor.id, actor.lastChat);
      else if (
        !before ||
        actor.bubble !== before.bubble ||
        actor.effect !== before.effect ||
        actor.animationStartedAt !== before.animationStartedAt ||
        actor.state !== before.state
      )
        activity.set(actor.id, time);
      if (!before || actor.state !== before.state) node.legacyStartedAt = time;
      node.target = actor;
      node.avatar = avatars.get(actor.avatar) || data.avatars[0];
      node.name.textContent = actor.name || '';
      node.name.style.color = actor.color || '#ffffff';
      node.bubble.textContent = actor.bubble || '';
      node.effect.textContent =
        actor.effect === 'highfive'
          ? '짝!'
          : actor.effect === 'push'
            ? '퐁!'
            : '';
      node.root.dataset.number = String(actor.number ?? '');
    }
    snapshot = data;
    receivedAt = performance.now();
    stage.hidden = data.outputHidden === true;
    stage.classList.toggle('paused', data.paused === true);
    cache.prune(
      new Set(
        data.avatars.flatMap((a) =>
          Object.values(a.states).map((c) => c?.asset),
        ),
      ),
    );
    resize();
    updateGame();
  }

  function updateGame() {
    const g = snapshot?.game;
    game.hidden = !g;
    if (!g) return;
    const now = finite(snapshot.simulationTime, snapshot.at);
    const remaining = Math.max(
      0,
      Math.ceil((finite(g.phaseEndsAt, finite(g.endsAt, now)) - now) / 1000),
    );
    const phase = {
      recruiting: '참가 모집',
      recruit: '참가 모집',
      countdown: '시작 대기',
      result: '결과',
    }[g.phase];
    game.textContent =
      g.result ||
      `${g.type === 'race' ? '달리기' : `공동 응원 ${finite(g.score, 0)} / ${finite(g.goal, 0)} · !응원`}${phase ? ` · ${phase}` : ''} · ${remaining}초`;
    const maxHeight = layout.safe.bottom - layout.safe.top;
    const bottom = Math.min(
      parseFloat(game.style.bottom),
      layout.height - layout.safe.top - Math.min(game.offsetHeight, maxHeight),
    );
    game.style.bottom = `${Math.max(layout.height - layout.safe.bottom, bottom)}px`;
  }

  function prepareActor(node, time, visibility) {
    const actor = node.target;
    const animationActor = {
      ...actor,
      animationStartedAt: finite(
        actor.animationStartedAt,
        node.legacyStartedAt,
      ),
    };
    let selected = resolveClip(node.avatar, actor.state, cache.failed);
    const idle = resolveClip(node.avatar, 'idle', cache.failed);
    if (idle) cache.get(idle.clip.asset);
    if (selected && cache.get(selected.clip.asset).status !== 'ready')
      selected = idle;
    if (!selected || cache.get(selected.clip.asset).status !== 'ready') {
      node.root.hidden = true;
      return;
    }
    let phase = frameAt(
      selected.clip,
      animationActor,
      time,
      node.avatar?.stride,
    );
    const completed = phase.returnToIdle && selected.state !== 'idle';
    if (completed && idle && cache.get(idle.clip.asset).status === 'ready') {
      selected = idle;
      phase = frameAt(
        idle.clip,
        { ...animationActor, state: 'idle' },
        time,
        node.avatar?.stride,
      );
    }
    node.root.hidden = false;
    const clip = selected.clip;
    const geometry = clipGeometry(clip, actor, cache.get(clip.asset).image);
    const native =
      selected.state === actor.state ||
      (actor.state === 'run' && selected.state === 'walk');
    const sheet = clip.columns > 1 || clip.rows > 1;
    node.root.dataset.clipState = selected.state;
    node.root.className = `actor${native ? ' native-clip' : ''}`;
    const signature = JSON.stringify(clip);
    if (signature !== node.signature) {
      node.signature = signature;
      node.sprite.style.backgroundImage = `url("${url(`/assets/${clip.asset}`)}")`;
      node.sprite.style.backgroundSize = sheet
        ? `${clip.columns * 100}% ${clip.rows * 100}%`
        : '100% 100%';
    }
    node.sprite.style.backgroundPosition = sheet
      ? framePosition(clip, phase.frame)
      : 'center';
    node.sprite.style.imageRendering = node.avatar?.pixelated
      ? 'pixelated'
      : 'auto';
    Object.assign(node.appearance.style, {
      width: `${geometry.width}px`,
      height: `${geometry.height}px`,
      left: `${geometry.left}px`,
      top: `${geometry.top}px`,
      transform: `scaleX(${geometry.flip})`,
    });
    node.sprite.style.transformOrigin = `${clip.anchorX * 100}% ${clip.anchorY * 100}%`;
    const elapsed = Math.max(0, time - animationActor.animationStartedAt);
    const wave = Math.sin((elapsed / 450) * Math.PI);
    let transform = '';
    if (!native && !completed) {
      if (actor.state === 'dance')
        transform = `rotate(${wave * 12}deg) translateY(${-Math.abs(wave) * 14}px)`;
      else if (actor.state === 'wave') transform = `rotate(${wave * 7}deg)`;
      else if (['walk', 'run'].includes(actor.state)) {
        const cycle = Number.isFinite(actor.travelDistance)
          ? actor.travelDistance /
            clamp(finite(node.avatar?.stride, 50), 10, 200)
          : elapsed / 600;
        transform = `translateY(${-Math.abs(Math.sin(cycle * Math.PI * 2)) * 4}px)`;
      } else if (actor.state === 'sit') transform = 'scaleY(0.7)';
    }
    node.sprite.style.transform = transform;
    const nativeAnimation = !sheet && /\.(gif|webp)$/.test(clip.asset);
    node.root.dataset.nativeAnimation = String(nativeAnimation);
    if (nativeAnimation && snapshot.paused)
      report('NATIVE_ANIMATION_UNCONTROLLED', { asset: clip.asset });

    node.name.hidden = !visibility.names.has(actor.id);
    node.bubble.hidden = !visibility.bubbles.has(actor.id);
    node.effect.hidden = !node.effect.textContent;
    const safe = layout.safe;
    node.name.style.fontSize = `${clamp(finite(snapshot.nameSize, 20), 8, 72)}px`;
    node.name.style.maxWidth = `${Math.min(240, safe.right - safe.left)}px`;
    node.bubble.style.maxWidth = `${Math.min(230, safe.right - safe.left)}px`;
    node.bubble.style.maxHeight = `${Math.max(20, safe.bottom - safe.top)}px`;
    const padding = transform
      ? Math.max(16, geometry.width * 0.25, geometry.height * 0.25)
      : 0;
    const bounds = {
      left: geometry.left - padding,
      right: geometry.left + geometry.width + padding,
      top: geometry.top - padding,
      bottom: geometry.top + geometry.height + padding,
    };
    return { node, bounds };
  }

  function measureActor({ node, bounds }) {
    let top = Math.min(0, bounds.top) - 2;
    const labels = [];
    for (const label of [node.name, node.effect, node.bubble]) {
      if (label.hidden) continue;
      labels.push({ label, bottom: -top });
      bounds.left = Math.min(bounds.left, -label.offsetWidth / 2);
      bounds.right = Math.max(bounds.right, label.offsetWidth / 2);
      top -= label.offsetHeight + 4;
    }
    bounds.top = Math.min(bounds.top, top);
    return {
      node,
      labels,
      fitted: fitActor({ x: node.x, y: node.y }, bounds, layout.safe),
    };
  }

  function render(now) {
    const delta = Math.min(100, Math.max(0, now - lastRender));
    lastRender = now;
    try {
      if (snapshot && !stage.hidden) {
        // Extrapolate at most one snapshot interval; stalled sockets cannot advance indefinitely.
        const time =
          finite(snapshot.simulationTime, snapshot.at) +
          (snapshot.paused ? 0 : clamp(now - receivedAt, 0, 100));
        const visibility = labelVisibility(snapshot.actors, snapshot, activity);
        const prepared = [];
        for (const node of nodes.values()) {
          const blend = snapshot.paused ? 1 : 1 - Math.exp(-delta / 38);
          node.x += (node.target.x - node.x) * blend;
          node.y += (node.target.y - node.y) * blend;
          const result = prepareActor(node, time, visibility);
          if (result) prepared.push(result);
        }
        // Batch reads between writes instead of forcing layout once per actor/label.
        const measured = prepared.map(measureActor);
        for (const { node, labels, fitted } of measured) {
          for (const { label, bottom } of labels)
            label.style.bottom = `${bottom}px`;
          node.root.style.transform = `translate(${fitted.x}px,${fitted.y}px) scale(${fitted.scale})`;
        }
      }
    } catch {
      requestReload('RENDER_FAILED');
    }
    requestAnimationFrame(render);
  }

  function reconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(
      connect,
      Math.min(10000, 1000 * 2 ** Math.min(retry++, 4)) + Math.random() * 300,
    );
  }

  function connect() {
    clearTimeout(reconnectTimer);
    connectionState('connecting');
    let current;
    try {
      current = new WebSocket(
        `${location.origin.replace(/^http/, 'ws')}${url('/ws')}`,
      );
    } catch {
      connectionState('waiting');
      reconnect();
      return;
    }
    socket = current;
    connectedAt = Date.now();
    lastFrameAt = 0;
    current.onopen = () => {
      if (socket !== current) return;
      connectedAt = Date.now();
      connectionState('bootstrap');
    };
    current.onmessage = (event) => {
      if (socket !== current) return;
      try {
        const data = JSON.parse(event.data);
        const result = gate(data);
        if (!result.accepted) {
          report(result.code);
          if (
            [
              'PROTOCOL_MISMATCH',
              'VERSION_MISMATCH',
              'BOOTSTRAP_MISSING',
            ].includes(result.code)
          ) {
            connectionState(
              result.code === 'BOOTSTRAP_MISSING' ? 'bootstrap' : 'mismatch',
            );
            requestReload(result.code);
          }
          return;
        }
        if (result.reset) reset();
        update(data);
        retry = 0;
        lastFrameAt = Date.now();
        stableSince ||= lastFrameAt;
        if (lastFrameAt - stableSince > 60000) {
          try {
            sessionStorage.removeItem(storageKey);
          } catch {}
        }
        if (reloadReason !== 'RENDER_FAILED') {
          clearTimeout(reloadTimer);
          reloadTimer = null;
        }
        connectionState('connected');
      } catch {
        report('INVALID_FRAME');
        connectionState('invalid');
      }
    };
    current.onerror = () => {
      if (socket === current) current.close();
    };
    current.onclose = () => {
      if (socket !== current) return;
      stableSince = 0;
      connectionState('waiting');
      reconnect();
    };
  }

  setInterval(() => {
    const now = Date.now();
    if (
      socket &&
      [0, 1].includes(socket.readyState) &&
      now - (lastFrameAt || connectedAt) > 12000
    ) {
      report(lastFrameAt ? 'FRAME_STALE' : 'BOOTSTRAP_MISSING');
      if (!lastFrameAt && socket.readyState === 1)
        requestReload('BOOTSTRAP_MISSING');
      connectionState('stale');
      socket.close();
    }
  }, 3000);
  addEventListener('resize', () => {
    resize();
    updateGame();
  });
  addEventListener('error', (event) => {
    if (event.target === window) requestReload('RENDER_FAILED');
  });
  addEventListener('unhandledrejection', () => requestReload('RENDER_FAILED'));
  resize();
  requestAnimationFrame(render);
  connect();
})();
