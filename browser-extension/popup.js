const api = typeof browser !== 'undefined' ? browser : chrome;
const services = [
  ['chzzk', 'CHZZK'],
  ['cime', 'CIME'],
  ['toonation', 'Toonation'],
  ['arubot', 'AruBot']
];

let latestState = null;

function send(message) {
  return api.runtime.sendMessage(message);
}

function format(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function render(state) {
  latestState = state;
  const remaining = Math.max(0, Math.ceil((state.pauseUntil - Date.now()) / 1000));
  document.querySelector('#monitoring').checked = Boolean(state.settings.monitoring);
  document.querySelector('#remaining').textContent = format(remaining);
  document.querySelector('#summary').textContent = state.settings.monitoring ? 'Monitoring' : 'Monitoring paused';
  document.querySelector('#meterFill').style.width = remaining > 0 ? '100%' : '0%';

  const root = document.querySelector('#services');
  root.textContent = '';
  for (const [id, label] of services) {
    const service = state.services[id] || {};
    const serviceRemaining = Math.max(0, Math.ceil(((service.endAt || 0) - Date.now()) / 1000));
    const row = document.createElement('div');
    row.className = 'service';

    const meta = document.createElement('div');
    meta.className = 'service-meta';

    const dot = document.createElement('span');
    dot.className = `dot ${getSafeStatusClass(service.status)}`;

    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = label;

    const message = document.createElement('span');
    message.className = 'message';
    message.textContent = service.message || service.status || 'Idle';

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = format(serviceRemaining);

    text.append(name, message);
    meta.append(dot, text);
    row.append(meta, time);
    root.appendChild(row);
  }
}

function getSafeStatusClass(status) {
  const value = String(status || 'idle');
  return /^(idle|connected|connecting|reconnecting|error|disabled)$/u.test(value) ? value : 'idle';
}

async function refresh() {
  const state = await send({ type: 'get-state' });
  render(state);
}

document.querySelector('#monitoring').addEventListener('change', async (event) => {
  const monitoring = event.currentTarget.checked;
  const response = await send({ type: 'toggle-monitoring', monitoring });
  if (response?.state) render(response.state);
});

document.querySelector('#testPause').addEventListener('click', async () => {
  const response = await send({ type: 'test-pause', durationSec: 10 });
  if (response?.state) render(response.state);
});

document.querySelector('#clearPause').addEventListener('click', async () => {
  const response = await send({ type: 'clear-pause' });
  if (response?.state) render(response.state);
});

document.querySelector('#openOptions').addEventListener('click', () => {
  api.runtime.openOptionsPage();
});

api.runtime.onMessage.addListener((message) => {
  if (message?.type === 'state') render(message.state);
});

setInterval(() => {
  if (latestState) render(latestState);
}, 1000);

refresh();
