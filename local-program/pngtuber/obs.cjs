const { text } = require('./schema.cjs');

function closeSocket(ws) {
  if (!ws) return;
  ws.on('error', () => {});
  try { if (ws.terminate) ws.terminate(); else ws.close(); } catch { /* Already closed. */ }
}
async function deadline(operation, ms = 12000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('OBS request timed out')), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}
function matches(input, selected) {
  if (selected.uuid && input.inputUuid) return input.inputUuid === selected.uuid;
  return !!selected.name && input.inputName === selected.name;
}
class ObsMonitor {
  constructor(engine, options, changed, renamed) {
    this.engine = engine;
    this.options = options;
    this.changed = changed;
    this.renamed = renamed;
    this.inputs = [];
    this.generation = 0;
    this.revision = 0;
    this.muteRevision = 0;
    this.active = false;
    this.retryMs = 500;
    this.collectionChanging = false;
    this.selected = null;
    this.discovery = null;
    this.temporary = new Set();
  }
  report(message) {
    if (this.engine.error !== message) {
      this.engine.error = message;
      if (message) { try { this.options.onError?.(new Error(message)); } catch { /* Error reporting is best effort. */ } }
    }
    this.changed();
  }
  stop() {
    this.active = false;
    this.generation++;
    this.revision++;
    clearTimeout(this.retryTimer);
    clearTimeout(this.refreshTimer);
    this.retryTimer = this.refreshTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.connecting = null;
    this.selected = null;
    this.collectionChanging = false;
    this.engine.setConnected(false);
    closeSocket(ws);
    for (const socket of this.temporary) closeSocket(socket);
    this.temporary.clear();
    this.changed();
  }
  start() {
    this.active = true;
    return this.connect();
  }
  restart() {
    this.stop();
    if (this.engine.config.enabled) return this.start();
    return Promise.resolve();
  }
  scheduleReconnect() {
    if (!this.active || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, this.retryMs);
    this.retryTimer.unref?.();
    this.retryMs = Math.min(10000, this.retryMs * 2);
  }
  async open(generation) {
    let expired = false;
    try {
      return await deadline(async () => {
        if (typeof this.options.openObs !== 'function') throw new Error('OBS is not configured');
        const opened = await this.options.openObs();
        if (expired || generation !== this.generation) {
          closeSocket(opened?.ws);
          throw new Error('OBS connection superseded');
        }
        if (!opened?.ws || opened.ws.readyState !== 1) throw new Error('OBS socket is not open');
        return opened.ws;
      });
    } finally { expired = true; }
  }
  async request(ws, type, data = {}) {
    if (ws.readyState !== 1 || (ws === this.ws && this.collectionChanging)) throw new Error('OBS is unavailable');
    return deadline(() => this.options.requestObs(ws, type, data));
  }
  async mute(ws, input) {
    const data = input.uuid ? { inputUuid: input.uuid } : { inputName: input.name };
    return this.request(ws, 'GetInputMute', data);
  }
  connect() {
    if (!this.active) return Promise.resolve();
    if (this.ws?.readyState === 1) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const generation = this.generation;
    const task = (async () => {
      try {
        const ws = await this.open(generation);
        if (!this.active || generation !== this.generation) { closeSocket(ws); return; }
        this.ws = ws;
        this.engine.setConnected(true);
        this.retryMs = 500;
        const lost = () => {
          if (this.ws !== ws) return;
          this.ws = null;
          this.generation++;
          this.connecting = null;
          this.revision++;
          this.selected = null;
          this.engine.setConnected(false);
          closeSocket(ws);
          this.report('OBS disconnected; retrying');
          this.scheduleReconnect();
        };
        ws.on('error', lost);
        ws.on('close', lost);
        ws.on('message', (raw) => {
          if (this.ws !== ws || generation !== this.generation) return;
          try {
            if (Buffer.byteLength(raw) > 1024 * 1024) return;
            const message = JSON.parse(String(raw));
            if (message.op === 5) this.event(message.d?.eventType, message.d?.eventData || {});
          } catch { /* Ignore malformed or unrelated OBS messages. */ }
        });
        await this.refreshSource();
      } catch {
        if (generation !== this.generation || !this.active) return;
        this.engine.setConnected(false);
        this.report('Could not connect to OBS; check OBS connection settings');
        this.scheduleReconnect();
      } finally {
        if (this.connecting === task) this.connecting = null;
      }
    })();
    this.connecting = task;
    return task;
  }
  scheduleRefresh(delay = 150) {
    if (!this.active || this.collectionChanging || this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshSource();
    }, delay);
    this.refreshTimer.unref?.();
  }
  async refreshSource() {
    const ws = this.ws, generation = this.generation, revision = ++this.revision;
    if (!ws || this.collectionChanging) return;
    const current = () => ws === this.ws && generation === this.generation && revision === this.revision && !this.collectionChanging;
    const config = this.engine.config;
    if (!config.inputName && !config.inputUuid) {
      this.engine.setSource(false);
      this.report('Select an OBS audio input');
      return;
    }
    try {
      const response = await this.request(ws, 'GetInputList');
      if (!current()) return;
      const list = Array.isArray(response?.inputs) ? response.inputs.slice(0, 512) : [];
      const item = (config.inputUuid && list.find((i) => i.inputUuid === config.inputUuid)) ||
        list.find((i) => (!config.inputUuid || !i.inputUuid) && i.inputName === config.inputName);
      if (!item) throw new Error('Selected source unavailable');
      this.selected = { name: text(item.inputName, 256), uuid: text(item.inputUuid, 128) };
      const muteRevision = this.muteRevision;
      const result = await this.mute(ws, this.selected);
      if (!current()) return;
      if (typeof result?.inputMuted !== 'boolean') throw new Error('Not an audio source');
      const muted = muteRevision === this.muteRevision ? result.inputMuted : this.engine.muted;
      this.engine.setSource(true, muted);
      this.report('');
      if (this.selected.name !== config.inputName || this.selected.uuid !== config.inputUuid)
        this.renamed(this.selected, { name: config.inputName, uuid: config.inputUuid });
    } catch {
      if (!current()) return;
      this.selected = null;
      this.engine.setSource(false);
      this.report('Selected OBS audio input is unavailable');
      this.scheduleRefresh(2000);
    }
  }
  event(type, data) {
    if (type === 'CurrentSceneCollectionChanging' || type === 'CurrentProfileChanging') {
      this.collectionChanging = true;
      this.revision++;
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
      this.selected = null;
      this.inputs = [];
      this.engine.setSource(false);
    } else if (type === 'CurrentSceneCollectionChanged' || type === 'CurrentProfileChanged') {
      this.collectionChanging = false;
      this.scheduleRefresh();
    } else if (this.collectionChanging) return;
    else if (type === 'InputVolumeMeters') {
      if (!this.selected) return;
      const input = Array.isArray(data.inputs) && data.inputs.slice(0, 512).find((item) => matches(item, this.selected));
      if (input) this.engine.meter(input.inputLevelsMul);
      return;
    } else if (type === 'InputMuteStateChanged' && this.selected && matches(data, this.selected)) {
      if (typeof data.inputMuted === 'boolean') {
        this.muteRevision++;
        this.engine.setMuted(data.inputMuted);
      }
    } else if (type === 'InputNameChanged') {
      const old = { ...data, inputName: data.oldInputName };
      this.inputs = this.inputs.map((i) => matches(old, i) ? { ...i, name: text(data.inputName, 256) } : i);
      if (this.selected && matches(old, this.selected)) {
        const previous = { ...this.selected };
        this.selected.name = text(data.inputName, 256);
        this.revision++;
        this.renamed({ ...this.selected }, previous);
        this.engine.resetMeter();
        this.scheduleRefresh();
      }
    } else if (type === 'InputRemoved') {
      this.inputs = this.inputs.filter((i) => !matches(data, i));
      if (this.selected && matches(data, this.selected)) {
        this.revision++;
        this.selected = null;
        this.engine.setSource(false);
        this.scheduleRefresh(500);
      }
    } else if (type === 'InputCreated' || type === 'InputSettingsChanged' || type === 'SceneCollectionListChanged') {
      this.scheduleRefresh();
    }
    this.changed();
  }
  discover() {
    if (this.discovery) return this.discovery;
    const generation = this.generation;
    const task = (async () => {
      let ws, temporary = false, changing = false;
      const watch = (raw) => {
        try {
          const message = JSON.parse(String(raw));
          if (message.op === 5 && /^(CurrentSceneCollection|CurrentProfile)Changing$/.test(message.d?.eventType)) changing = true;
        } catch { /* Not an event. */ }
      };
      try {
        if (this.active) await this.connect();
        ws = this.ws;
        if (!ws) { ws = await this.open(generation); temporary = true; this.temporary.add(ws); }
        if (this.collectionChanging) throw new Error('Scene collection is changing');
        ws.on('message', watch);
        ws.on('error', () => {});
        const response = await this.request(ws, 'GetInputList');
        const inputs = [];
        for (const item of (Array.isArray(response?.inputs) ? response.inputs : []).slice(0, 512)) {
          if (generation !== this.generation || changing || this.collectionChanging) throw new Error('Discovery superseded');
          const input = { name: text(item.inputName, 256), uuid: text(item.inputUuid, 128) };
          if (!input.name) continue;
          try {
            const result = await this.mute(ws, input);
            if (typeof result?.inputMuted === 'boolean') inputs.push(input);
          } catch { if (ws.readyState !== 1) throw new Error('OBS disconnected'); }
        }
        if (generation === this.generation && !changing && !this.collectionChanging) this.inputs = inputs;
        return inputs;
      } finally {
        ws?.off('message', watch);
        if (temporary) { this.temporary.delete(ws); closeSocket(ws); }
        if (this.discovery === task) this.discovery = null;
      }
    })();
    this.discovery = task;
    return task;
  }
}
module.exports = { ObsMonitor, matches };
