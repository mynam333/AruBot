const $ = (selector) => document.querySelector(selector);

const fields = {
  backendUrl: $('#backendUrl'),
  updateManifestUrl: $('#updateManifestUrl'),
  token: $('#token'),
  pollIntervalMs: $('#pollIntervalMs'),
  autoStart: $('#autoStart'),
  titsEndpoint: $('#titsEndpoint'),
  toonationAlertboxKey: $('#toonationAlertboxKey'),
};

let latestState = null;
let latestUpdate = null;
const localTaskLogs = [];

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
  $('#statusCard').classList.toggle('online', !!state.running);
  $('#statusText').textContent = state.running ? '실행 중' : '대기 중';
  $('#heartbeatText').textContent = state.stats?.lastHeartbeatAt ? `마지막 연결 ${fmtTime(state.stats.lastHeartbeatAt)}` : '아직 연결되지 않음';
  $('#completedCount').textContent = String(state.stats?.completed || 0);
  $('#failedCount').textContent = String(state.stats?.failed || 0);
  $('#currentVersionText').textContent = state.version || '확인 중';
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
      ? `새 버전 ${latestUpdate.latestVersion}을 사용할 수 있습니다. 버튼을 누르면 설치 파일을 내려받아 실행합니다.`
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
    $('#updateStatusText').textContent = latestUpdate.opened
      ? '설치 파일을 실행했습니다. 설치가 끝나면 프로그램을 다시 열어주세요.'
      : '이미 최신 버전을 사용 중입니다.';
  } finally {
    $('#installUpdateButton').disabled = !latestUpdate?.updateAvailable;
  }
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
window.aruLocal.getState().then(renderState);
