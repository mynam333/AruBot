const api = typeof browser !== 'undefined' ? browser : chrome;

const serviceMeta = {
  chzzk: {
    name: 'CHZZK',
    help: 'https://chzzk.naver.com/video-donation/video@...'
  },
  cime: {
    name: 'CIME',
    help: 'https://ci.me/overlay/video-donation/video/{channelId}/{alertKey}'
  },
  toonation: {
    name: 'Toonation',
    help: 'https://toon.at/widget/alertbox/{key}'
  },
  arubot: {
    name: 'AruBot',
    help: 'https://arubot.yuaru.com/pvd/{viewerToken} 또는 토큰만 입력'
  }
};

let settings = null;
const controls = {};

function send(message) {
  return api.runtime.sendMessage(message);
}

function render(nextSettings) {
  settings = nextSettings;
  document.querySelector('#monitoring').checked = Boolean(settings.monitoring);
  document.querySelector('#extraDelaySec').value = String(settings.extraDelaySec ?? 1);
  document.querySelector('#arubotApiBaseUrl').value = settings.arubotApiBaseUrl || '';

  const root = document.querySelector('#services');
  root.textContent = '';
  const template = document.querySelector('#serviceTemplate');
  for (const [id, meta] of Object.entries(serviceMeta)) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector('[data-name]').textContent = meta.name;
    node.querySelector('[data-help]').textContent = meta.help;
    const enabled = node.querySelector('[data-enabled]');
    const url = node.querySelector('[data-url]');
    enabled.checked = settings.services[id]?.enabled !== false;
    url.value = settings.services[id]?.overlayUrl || '';
    url.placeholder = meta.help;
    controls[id] = { enabled, url };
    root.appendChild(node);
  }
}

function collect() {
  const next = {
    ...settings,
    monitoring: document.querySelector('#monitoring').checked,
    extraDelaySec: Math.max(0, Math.min(30, Number(document.querySelector('#extraDelaySec').value || 0))),
    arubotApiBaseUrl: document.querySelector('#arubotApiBaseUrl').value.trim().replace(/\/+$/, ''),
    services: {}
  };
  for (const id of Object.keys(serviceMeta)) {
    next.services[id] = {
      enabled: controls[id].enabled.checked,
      overlayUrl: controls[id].url.value.trim()
    };
  }
  return next;
}

async function load() {
  const state = await send({ type: 'get-state' });
  render(state.settings);
}

document.querySelector('#save').addEventListener('click', async () => {
  const status = document.querySelector('#status');
  status.textContent = 'Saving...';
  const response = await send({ type: 'save-settings', settings: collect() });
  if (response?.ok) {
    render(response.state.settings);
    status.textContent = 'Saved.';
  } else {
    status.textContent = response?.error || 'Save failed.';
  }
});

load();
