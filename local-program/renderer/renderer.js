const $ = (selector) => document.querySelector(selector);

const fields = {
  backendUrl: $('#backendUrl'),
  updateManifestUrl: $('#updateManifestUrl'),
  token: $('#token'),
  pollIntervalMs: $('#pollIntervalMs'),
  autoStart: $('#autoStart'),
  titsEndpoint: $('#titsEndpoint'),
  toonationAlertboxKey: $('#toonationAlertboxKey'),
  remoteCommandSelect: $('#remoteCommandSelect'),
  remoteCommandName: $('#remoteCommandName'),
  remoteCommandKeyword: $('#remoteCommandKeyword'),
  remoteCommandPoints: $('#remoteCommandPoints'),
  remoteCommandCooldown: $('#remoteCommandCooldown'),
  remoteCommandResponse: $('#remoteCommandResponse'),
  remoteCommandEnabled: $('#remoteCommandEnabled'),
  remoteRouletteSelect: $('#remoteRouletteSelect'),
};

const pageMeta = {
  connect: {
    title: '방송 도구를 안전하게 연결하세요.',
    description: '아루봇 백엔드의 큐를 받아 방송 PC의 T.I.T.S., Toonation, TTS, 사운드 폴더와 로컬 자동화 작업을 실행합니다.',
  },
  remote: {
    title: '방송 중 필요한 기능을 로컬에서 바로 제어하세요.',
    description: '명령어 수정, 룰렛 테스트, 포인트 영상후원 제어를 웹 콘솔을 열지 않고 간단히 실행합니다.',
  },
  tits: {
    title: 'T.I.T.S. 아이템과 트리거를 동기화하세요.',
    description: '방송 PC의 T.I.T.S. WebSocket API에서 아이템과 트리거 목록을 불러와 자동화 액션에서 바로 선택할 수 있게 합니다.',
  },
  toonation: {
    title: 'Toonation 후원 알림을 로컬에서 안전하게 연결하세요.',
    description: 'Alertbox 키는 이 컴퓨터에만 저장하고, 후원 알림 기반 자동화는 로컬 프로그램이 필요한 작업만 실행합니다.',
  },
  sound: {
    title: '사운드 파일은 방송 PC에서 빠르게 재생하세요.',
    description: '서버 저장소 제한을 넘는 파일은 로컬 폴더에서 직접 호스팅하고, 자동화 액션의 지연을 줄입니다.',
  },
  updates: {
    title: '로컬 프로그램을 최신 상태로 유지하세요.',
    description: 'GitHub Releases의 최신 manifest를 확인하고, 가능한 환경에서는 프로그램 안에서 업데이트를 내려받아 설치합니다.',
  },
  logs: {
    title: '최근 실행 기록을 확인하세요.',
    description: '자동화 큐 처리, TTS, 사운드 재생, 업데이트 확인 등 로컬 프로그램에서 발생한 주요 작업을 보여줍니다.',
  },
};

let latestState = null;
let latestUpdate = null;
let remoteState = { rules: [], rouletteDefs: [], videoQueue: [] };
const localTaskLogs = [];

function setActivePage(page) {
  const nextPage = pageMeta[page] ? page : 'connect';
  document.querySelectorAll('.page').forEach((element) => {
    element.classList.toggle('active', element.dataset.page === nextPage);
  });
  document.querySelectorAll('.nav-item').forEach((element) => {
    element.classList.toggle('active', element.dataset.page === nextPage);
  });
  $('#pageTitle').textContent = pageMeta[nextPage].title;
  $('#pageDescription').textContent = pageMeta[nextPage].description;
  window.localStorage.setItem('arubot.local.activePage', nextPage);
  if (window.location.hash !== `#${nextPage}`) {
    window.history.replaceState(null, '', `#${nextPage}`);
  }
  if (nextPage === 'remote' && !(remoteState.rules.length || remoteState.rouletteDefs.length || remoteState.videoQueue.length)) {
    loadRemote().catch((error) => pushLocalLog('error', error?.message || '리모컨 정보를 불러오지 못했습니다.'));
  }
}

function fmtTime(value) {
  if (!value) return '아직 연결되지 않음';
  try {
    return new Date(value).toLocaleString('ko-KR');
  } catch {
    return String(value);
  }
}

function renderLogs(logs) {
  const list = $('#logList');
  const rows = [...localTaskLogs, ...(Array.isArray(logs) ? logs : [])].slice(0, 120);
  if (!rows.length) {
    list.innerHTML = '<div class="folder-path">아직 실행 기록이 없습니다.</div>';
    return;
  }
  list.innerHTML = rows.map((log) => `
    <div class="log-row">
      <span>${fmtTime(log.at).replace(/\s?오.+/, '')}</span>
      <span class="log-level ${log.level}">${log.level}</span>
      <span>${escapeHtml(log.message || '')}</span>
    </div>
  `).join('');
}

function pushLocalLog(level, message) {
  localTaskLogs.unshift({
    id: `local_${Date.now()}`,
    at: new Date().toISOString(),
    level,
    message,
  });
  localTaskLogs.splice(20);
  renderLogs(latestState?.logs || []);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderState(state) {
  latestState = state;
  const cfg = state.config || {};
  const update = state.update || {};
  $('#statusCard').classList.toggle('online', !!state.running);
  $('#statusText').textContent = state.running ? '실행 중' : '대기 중';
  $('#heartbeatText').textContent = state.stats?.lastHeartbeatAt ? `마지막 연결 ${fmtTime(state.stats.lastHeartbeatAt)}` : '아직 연결되지 않음';
  $('#completedCount').textContent = String(state.stats?.completed || 0);
  $('#failedCount').textContent = String(state.stats?.failed || 0);
  $('#currentVersionText').textContent = state.version || '확인 중';
  if (update.latestVersion) $('#latestVersionText').textContent = update.latestVersion;
  if (typeof update.updateAvailable === 'boolean') $('#installUpdateButton').disabled = !update.updateAvailable;
  if (update.status === 'downloading' && update.progress?.percent != null) {
    $('#updateStatusText').textContent = `업데이트를 다운로드하고 있습니다. ${Math.round(Number(update.progress.percent || 0))}%`;
    $('#installUpdateButton').disabled = true;
  } else if (update.status === 'installing') {
    $('#updateStatusText').textContent = '업데이트를 설치하기 위해 프로그램을 재시작합니다.';
    $('#installUpdateButton').disabled = true;
  } else if (update.status === 'error' && update.error) {
    $('#updateStatusText').textContent = `업데이트 확인에 실패했습니다. ${update.error}`;
  }
  $('#encryptionState').textContent = state.encryptionAvailable ? 'OS 보호' : '기본 보호';
  $('#toonationState').textContent = cfg.hasToonationKey ? '저장됨' : '미설정';
  $('#soundFolderText').textContent = cfg.soundFolder || '선택된 폴더 없음';

  fields.backendUrl.value = cfg.backendUrl || '';
  fields.updateManifestUrl.value = cfg.updateManifestUrl || '';
  if (!fields.token.dataset.dirty) fields.token.placeholder = cfg.hasToken ? cfg.token : '웹 대시보드에서 발급한 토큰';
  fields.pollIntervalMs.value = String(cfg.pollIntervalMs || 1800);
  fields.autoStart.checked = !!cfg.autoStart;
  fields.titsEndpoint.value = cfg.titsEndpoint || 'ws://localhost:42069';
  if (!fields.toonationAlertboxKey.dataset.dirty) fields.toonationAlertboxKey.placeholder = cfg.hasToonationKey ? cfg.toonationAlertboxKey : 'toon.at/widget/alertbox/ 뒤의 키';

  renderLogs(state.logs);
}

function selectedCommand() {
  const id = fields.remoteCommandSelect.value;
  return (remoteState.rules || []).find((rule) => String(rule.id || '') === id) || null;
}

function fillCommandForm(rule) {
  const current = rule || selectedCommand() || {};
  fields.remoteCommandName.value = current.name || '';
  fields.remoteCommandKeyword.value = Array.isArray(current.keywords) ? current.keywords[0] || '!' : '!';
  fields.remoteCommandPoints.value = String(current.pointsCost || 0);
  fields.remoteCommandCooldown.value = String(Math.max(1, Math.round(Number(current.cooldown || 3000) / 1000)));
  fields.remoteCommandResponse.value = Array.isArray(current.responses) ? current.responses.join('\n') : '';
  fields.remoteCommandEnabled.checked = current.enabled !== false;
}

function renderRemote(data) {
  remoteState = {
    rules: Array.isArray(data?.rules) ? data.rules : [],
    rouletteDefs: Array.isArray(data?.rouletteDefs) ? data.rouletteDefs : [],
    videoQueue: Array.isArray(data?.videoQueue) ? data.videoQueue : [],
  };
  $('#remoteCommandCount').textContent = String(remoteState.rules.length);
  $('#remoteRouletteCount').textContent = String(remoteState.rouletteDefs.length);
  fields.remoteCommandSelect.innerHTML = remoteState.rules.length
    ? remoteState.rules.map((rule) => `<option value="${escapeHtml(rule.id || '')}">${escapeHtml(rule.name || rule.keywords?.[0] || '명령어')}</option>`).join('')
    : '<option value="">명령어 없음</option>';
  fields.remoteRouletteSelect.innerHTML = remoteState.rouletteDefs.length
    ? remoteState.rouletteDefs.map((roulette) => `<option value="${escapeHtml(roulette.id || roulette.name || '')}">${escapeHtml(roulette.name || '룰렛')}</option>`).join('')
    : '<option value="">룰렛 없음</option>';
  fillCommandForm(remoteState.rules[0] || null);
  const current = remoteState.videoQueue[0];
  $('#remotePvdNow').textContent = current ? `${current.title || current.videoId || '영상'} · ${current.username || '시청자'}` : '현재 재생 항목 없음';
}

async function loadRemote() {
  const data = await window.aruLocal.remoteOverview();
  renderRemote(data);
  return data;
}

function collectConfig() {
  return {
    backendUrl: fields.backendUrl.value,
    updateManifestUrl: fields.updateManifestUrl.value,
    token: fields.token.value || undefined,
    pollIntervalMs: Number(fields.pollIntervalMs.value || 1800),
    autoStart: fields.autoStart.checked,
    titsEndpoint: fields.titsEndpoint.value,
    toonationAlertboxKey: fields.toonationAlertboxKey.value || undefined,
  };
}

async function run(action) {
  try {
    await action();
  } catch (error) {
    window.alert(error?.message || String(error));
  }
}

fields.token.addEventListener('input', () => {
  fields.token.dataset.dirty = '1';
});

fields.toonationAlertboxKey.addEventListener('input', () => {
  fields.toonationAlertboxKey.dataset.dirty = '1';
});

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    setActivePage(button.dataset.page);
  });
});

window.addEventListener('hashchange', () => {
  setActivePage(window.location.hash.replace('#', ''));
});

$('#saveConfigButton').addEventListener('click', () => run(async () => {
  const next = await window.aruLocal.saveConfig(collectConfig());
  fields.token.value = '';
  fields.token.dataset.dirty = '';
  fields.toonationAlertboxKey.value = '';
  fields.toonationAlertboxKey.dataset.dirty = '';
  renderState(next);
}));

$('#startButton').addEventListener('click', () => run(async () => {
  await window.aruLocal.saveConfig(collectConfig());
  renderState(await window.aruLocal.start());
}));

$('#stopButton').addEventListener('click', () => run(async () => {
  renderState(await window.aruLocal.stop());
}));

$('#discoverTitsButton').addEventListener('click', () => run(async () => {
  await window.aruLocal.saveConfig(collectConfig());
  const discovery = await window.aruLocal.discoverTits();
  $('#titsItemCount').textContent = String(discovery.items?.length || 0);
  $('#titsTriggerCount').textContent = String(discovery.triggers?.length || 0);
}));

$('#chooseSoundFolderButton').addEventListener('click', () => run(async () => {
  const folder = await window.aruLocal.chooseSoundFolder();
  if (folder) $('#soundFolderText').textContent = folder;
}));

$('#openSoundFolderButton').addEventListener('click', () => run(async () => {
  await window.aruLocal.openSoundFolder();
}));

$('#openDashboardButton').addEventListener('click', () => run(async () => {
  const base = fields.backendUrl.value || latestState?.config?.backendUrl || '';
  await window.aruLocal.openExternal(base.replace(/\/$/, '') || 'http://127.0.0.1:3001');
}));

$('#checkUpdateButton').addEventListener('click', () => run(async () => {
  await window.aruLocal.saveConfig(collectConfig());
  $('#checkUpdateButton').disabled = true;
  $('#updateStatusText').textContent = '업데이트 정보를 확인하고 있습니다.';
  try {
    latestUpdate = await window.aruLocal.checkUpdate();
    $('#latestVersionText').textContent = latestUpdate.latestVersion || '확인 실패';
    $('#installUpdateButton').disabled = !latestUpdate.updateAvailable;
    $('#updateStatusText').textContent = latestUpdate.updateAvailable
      ? `새 버전 ${latestUpdate.latestVersion}을 사용할 수 있습니다. 버튼을 누르면 프로그램 안에서 다운로드하고 설치합니다.`
      : '최신 버전을 사용 중입니다.';
  } finally {
    $('#checkUpdateButton').disabled = false;
  }
}));

$('#installUpdateButton').addEventListener('click', () => run(async () => {
  await window.aruLocal.saveConfig(collectConfig());
  $('#installUpdateButton').disabled = true;
  $('#updateStatusText').textContent = '업데이트 설치 파일을 다운로드하고 있습니다.';
  try {
    latestUpdate = await window.aruLocal.installUpdate();
    $('#latestVersionText').textContent = latestUpdate.latestVersion || '확인 완료';
    $('#updateStatusText').textContent = latestUpdate.installing
      ? '다운로드가 끝났습니다. 프로그램을 재시작하며 업데이트를 설치합니다.'
      : latestUpdate.opened
      ? '설치 파일을 실행했습니다. 설치가 끝나면 프로그램을 다시 열어주세요.'
      : '이미 최신 버전을 사용 중입니다.';
  } finally {
    $('#installUpdateButton').disabled = !latestUpdate?.updateAvailable;
  }
}));

$('#remoteRefreshButton').addEventListener('click', () => run(async () => {
  await loadRemote();
  pushLocalLog('success', '리모컨 정보를 새로고침했습니다.');
}));

fields.remoteCommandSelect.addEventListener('change', () => fillCommandForm());

$('#remoteSaveCommandButton').addEventListener('click', () => run(async () => {
  const current = selectedCommand();
  const keyword = String(fields.remoteCommandKeyword.value || '').trim();
  const normalizedKeyword = keyword.startsWith('!') ? keyword : `!${keyword}`;
  await window.aruLocal.remoteSaveCommand({
    ...(current || {}),
    id: current?.id || `cmd_local_${Date.now().toString(36)}`,
    name: fields.remoteCommandName.value.trim() || normalizedKeyword,
    keywords: [normalizedKeyword],
    responses: fields.remoteCommandResponse.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    pointsCost: Number(fields.remoteCommandPoints.value || 0),
    cooldown: Math.max(1, Number(fields.remoteCommandCooldown.value || 1)) * 1000,
    enabled: fields.remoteCommandEnabled.checked,
  });
  await loadRemote();
  pushLocalLog('success', '명령어를 저장했습니다.');
}));

$('#remoteDeleteCommandButton').addEventListener('click', () => run(async () => {
  const current = selectedCommand();
  if (!current?.id) return;
  if (!window.confirm(`"${current.name || current.keywords?.[0] || current.id}" 명령어를 삭제할까요?`)) return;
  await window.aruLocal.remoteDeleteCommand(current.id);
  await loadRemote();
  pushLocalLog('success', '명령어를 삭제했습니다.');
}));

$('#remoteTestRouletteButton').addEventListener('click', () => run(async () => {
  const id = fields.remoteRouletteSelect.value;
  const roulette = remoteState.rouletteDefs.find((item) => String(item.id || item.name || '') === id);
  if (!roulette) return;
  const result = await window.aruLocal.remoteTestRoulette({ id: roulette.id, name: roulette.name });
  const picked = result?.result?.result;
  $('#remoteRouletteResult').textContent = picked?.label ? `테스트 결과: ${picked.label}` : '테스트를 실행했습니다.';
  pushLocalLog('success', `룰렛 테스트를 실행했습니다: ${picked?.label || roulette.name}`);
}));

$('#remotePvdNextButton').addEventListener('click', () => run(async () => {
  await window.aruLocal.remotePopVideoDonation();
  await loadRemote();
}));

$('#remotePvdPlayButton').addEventListener('click', () => run(async () => {
  await window.aruLocal.remoteControlVideoDonation({ op: 'play' });
  pushLocalLog('success', '영상후원 재생 명령을 보냈습니다.');
}));

$('#remotePvdPauseButton').addEventListener('click', () => run(async () => {
  await window.aruLocal.remoteControlVideoDonation({ op: 'pause' });
  pushLocalLog('success', '영상후원 일시정지 명령을 보냈습니다.');
}));

window.aruLocal.onState(renderState);
window.aruLocal.onLocalTask((task) => {
  if (!task || !task.type) return;
  if (task.type === 'tts.speak') {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(String(task.text || ''));
      const voices = window.speechSynthesis.getVoices();
      if (task.voice) {
        const matched = voices.find((voice) => voice.name === task.voice || voice.lang === task.voice);
        if (matched) utterance.voice = matched;
      }
      utterance.rate = Number(task.rate || 1);
      utterance.pitch = Number(task.pitch || 1);
      window.speechSynthesis.speak(utterance);
      pushLocalLog('success', 'TTS를 재생했습니다.');
    } catch (error) {
      pushLocalLog('error', error?.message || 'TTS 재생에 실패했습니다.');
    }
  }
  if (task.type === 'sound.play') {
    try {
      const audio = new Audio(task.fileUrl);
      audio.volume = Math.max(0, Math.min(1, Number(task.volume ?? 1)));
      audio.play().then(() => {
        pushLocalLog('success', `사운드를 재생했습니다: ${task.fileName || '파일'}`);
      }).catch((error) => {
        pushLocalLog('error', error?.message || '사운드 재생에 실패했습니다.');
      });
    } catch (error) {
      pushLocalLog('error', error?.message || '사운드 재생에 실패했습니다.');
    }
  }
});
setActivePage(
  window.location.hash.replace('#', '')
    || window.localStorage.getItem('arubot.local.activePage')
    || 'connect',
);
window.aruLocal.getState().then(renderState);
if ((window.location.hash || '').replace('#', '') === 'remote') {
  loadRemote().catch((error) => pushLocalLog('error', error?.message || '리모컨 정보를 불러오지 못했습니다.'));
}
