(() => {
  const stage = document.getElementById('stage'),
    game = document.getElementById('game');
  const parameters = new URLSearchParams(location.search);
  const key = parameters.get('key') || '';
  const nodes = new Map();
  let snapshot = null,
    socket,
    retry = 0,
    timer,
    lastFrame = 0;
  const url = (path) =>
    `${path}?key=${encodeURIComponent(key)}${parameters.get('preview') === '1' ? '&preview=1' : ''}${parameters.get('monitor') === '1' ? '&monitor=1' : ''}`;
  function resize() {
    const scale =
      parameters.get('monitor') === '1'
        ? Math.min(
            innerWidth / 1920,
            innerHeight / (snapshot?.previewHeight || 420),
          )
        : innerWidth / 1920;
    stage.style.transform = `scale(${scale})`;
    stage.style.left = `${(innerWidth - 1920 * scale) / 2}px`;
  }
  addEventListener('resize', resize);
  resize();
  function update(data) {
    snapshot = data;
    resize();
    const live = new Set(data.actors.map((a) => a.id));
    stage.classList.toggle('paused', data.paused);
    for (const [id, node] of nodes)
      if (!live.has(id)) {
        node.root.remove();
        nodes.delete(id);
      }
    for (const a of data.actors) {
      let node = nodes.get(a.id);
      if (!node) {
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
        node = {
          root,
          appearance,
          sprite,
          name,
          bubble,
          effect,
          x: a.x,
          y: a.y,
          signature: '',
        };
        nodes.set(a.id, node);
      }
      node.target = a;
      node.name.textContent = a.name;
      node.name.style.color = a.color;
      node.name.hidden = !data.showNames;
      node.bubble.textContent = a.bubble;
      node.bubble.hidden = !a.bubble;
      node.effect.textContent =
        a.effect === 'highfive' ? '짝!' : a.effect === 'push' ? '퐁!' : '';
      node.root.style.setProperty('--size', `${a.size}px`);
      node.appearance.style.width = `${a.size}px`;
      node.appearance.style.height = `${a.size}px`;
      node.appearance.style.left = `${-a.size / 2}px`;
      node.appearance.style.transform = `scaleX(${a.direction})`;
      const avatar =
        data.avatars.find((v) => v.id === a.avatar) || data.avatars[0];
      const clip =
        avatar.states[a.state] ||
        (a.state === 'run' ? avatar.states.walk : null) ||
        avatar.states.idle;
      const src = url(`/assets/${clip.asset}`);
      const signature = `${a.state}:${src}:${JSON.stringify(clip)}`;
      node.clip = clip;
      node.root.className = `actor ${a.state}${avatar.states[a.state] ? ' native-clip' : ''}`;
      node.sprite.style.imageRendering = avatar.pixelated
        ? 'pixelated'
        : 'auto';
      if (signature !== node.signature) {
        node.animationTime = 0;
        node.signature = signature;
        node.sprite.style.backgroundImage = `url("${src}")`;
        node.sprite.style.backgroundSize =
          clip.columns > 1 || clip.rows > 1
            ? `${clip.columns * 100}% ${clip.rows * 100}%`
            : 'contain';
        node.sprite.style.backgroundPosition =
          clip.columns > 1 || clip.rows > 1 ? '0% 0%' : 'center bottom';
      }
    }
  }
  let lastRender = performance.now();
  function render(now) {
    const delta = snapshot?.paused ? 0 : Math.min(100, now - lastRender);
    lastRender = now;
    for (const node of nodes.values()) {
      const a = node.target;
      const blend = snapshot?.paused ? 1 : 1 - Math.exp(-delta / 38);
      node.x += (a.x - node.x) * blend;
      node.y += (a.y - node.y) * blend;
      node.animationTime += delta * (a.animationRate || 1);
      node.root.style.transform = `translate(${node.x}px,${node.y}px)`;
      if (node.clip?.frames > 1) {
        const c = node.clip,
          frame = Math.floor((node.animationTime * c.fps) / 1000) % c.frames;
        node.sprite.style.backgroundPosition = `${c.columns === 1 ? 0 : ((frame % c.columns) / (c.columns - 1)) * 100}% ${c.rows === 1 ? 0 : (Math.floor(frame / c.columns) / (c.rows - 1)) * 100}%`;
      }
    }
    game.hidden = !snapshot?.game;
    if (snapshot?.game) {
      const g = snapshot.game;
      game.textContent =
        g.result ||
        `${g.type === 'race' ? '달리기' : `공동 응원 ${g.score} / ${g.goal} · !응원`} · ${Math.max(0, Math.ceil((g.endsAt - snapshot.at) / 1000))}초`;
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
  function connect() {
    clearTimeout(timer);
    socket = new WebSocket(
      `${location.origin.replace('http:', 'ws:')}${url('/ws')}`,
    );
    socket.onopen = () => {
      retry = 0;
      lastFrame = Date.now();
    };
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (Array.isArray(data.actors)) {
          update(data);
          lastFrame = Date.now();
        }
      } catch {}
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      timer = setTimeout(
        connect,
        Math.min(10000, 1000 * 2 ** retry++) + Math.random() * 300,
      );
    };
  }
  setInterval(() => {
    if (socket?.readyState === 1 && Date.now() - lastFrame > 12000)
      socket.close();
  }, 5000);
  addEventListener('error', () => setTimeout(() => location.reload(), 30000), {
    once: true,
  });
  connect();
})();
