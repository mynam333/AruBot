const $ = (selector) => document.querySelector(selector);

const fields = {
  token: $('#token'),
  autoStart: $('#autoStart'),
  titsEndpoint: $('#titsEndpoint'),
  vtubeEndpoint: $('#vtubeEndpoint'),
  vtubeHotkeySelect: $('#vtubeHotkeySelect'),
  remoteCommandSelect: $('#remoteCommandSelect'),
  remoteCommandName: $('#remoteCommandName'),
  remoteCommandKeyword: $('#remoteCommandKeyword'),
  remoteCommandPoints: $('#remoteCommandPoints'),
  remoteCommandCooldown: $('#remoteCommandCooldown'),
  remoteCommandResponse: $('#remoteCommandResponse'),
  remoteCommandEnabled: $('#remoteCommandEnabled'),
  remoteRouletteSelect: $('#remoteRouletteSelect'),
  remotePvdVolume: $('#remotePvdVolume'),
};

const pageMeta = {
  connect: {
    title: '방송 도구를 안전하게 연결하세요.',
    description: '아루봇과 실시간으로 연결해 방송 PC의 T.I.T.S., VTube Studio, TTS, 사운드 효과를 바로 실행합니다.',
  },
  remote: {
    title: '방송 중 필요한 버튼을 가까이에 두세요.',
    description: '명령어, 룰렛 테스트, 포인트 영상후원을 방송 PC에서 바로 누르고 흐름을 이어갑니다.',
  },
  tits: {
    title: 'T.I.T.S. 아이템과 트리거를 바로 불러오세요.',
    description: 'T.I.T.S. 아이템과 트리거를 불러와 방송 중 원하는 연출을 바로 고를 수 있게 합니다.',
  },
  vtube: {
    title: 'VTube Studio 모델 반응을 방송 흐름에 맞추세요.',
    description: '표정, 모델 전환, 아이템 핫키를 불러와 채팅과 후원 순간에 자연스럽게 실행합니다.',
  },
  sound: {
    title: 'FX 에셋은 방송 PC에서 관리하세요.',
    description: '이미지, 스티커, 비디오, 사운드를 로컬 폴더에서 직접 호스팅하고 FX 오버레이로 실시간 실행합니다.',
  },
  updates: {
    title: '로컬 프로그램을 최신 상태로 유지하세요.',
    description: 'GitHub Releases의 최신 manifest를 확인하고, 가능한 환경에서는 프로그램 안에서 업데이트를 내려받아 설치합니다.',
  },
  logs: {
    title: '방송 중 실행된 반응을 살펴보세요.',
    description: 'TTS, 사운드, 룰렛 테스트처럼 방송 PC에서 실행된 최근 반응을 모아 보여줍니다.',
  },
};

let latestState = null;
let latestUpdate = null;
let remoteState = { rules: [], rouletteDefs: [], videoQueue: [] };
let vtubeDiscovery = { models: [], hotkeys: [] };
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
  if (nextPage === 'logs') scrollLogsToBottom();
}

function fmtTime(value) {
  if (!value) return '아직 연결되지 않음';
  try {
    return new Date(value).toLocaleString('ko-KR');
  } catch {
    return String(value);
  }
}

function fmtLogTime(value) {
  if (!value) return '--:--:--';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function scrollLogsToBottom() {
  const list = $('#logList');
  if (!list) return;
  window.requestAnimationFrame(() => {
    list.scrollTop = list.scrollHeight;
  });
}

function renderLogs(logs) {
  const list = $('#logList');
  const rows = [...localTaskLogs, ...(Array.isArray(logs) ? logs : [])]
    .sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime())
    .slice(-120);
  if (!rows.length) {
    list.innerHTML = '<div class="folder-path">아직 실행 기록이 없습니다.</div>';
    return;
  }
  list.innerHTML = rows.map((log) => `
    <div class="log-row">
      <span>${fmtLogTime(log.at)}</span>
      <span class="log-level ${log.level}">${log.level}</span>
      <span>${escapeHtml(log.message || '')}</span>
    </div>
  `).join('');
  scrollLogsToBottom();
}

function pushLocalLog(level, message) {
  localTaskLogs.push({
    id: `local_${Date.now()}`,
    at: new Date().toISOString(),
    level,
    message,
  });
  if (localTaskLogs.length > 20) {
    localTaskLogs.splice(0, localTaskLogs.length - 20);
  }
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
  if (typeof update.updateAvailable === 'boolean') {
    $('#installUpdateButton').disabled = !update.updateAvailable || !!update.readyToApply || update.status === 'downloading';
  }
  if (update.status === 'downloading' && update.progress?.percent != null) {
    $('#updateStatusText').textContent = `업데이트를 다운로드하고 있습니다. ${Math.round(Number(update.progress.percent || 0))}%`;
    $('#installUpdateButton').disabled = true;
  } else if (update.status === 'ready' || update.readyToApply) {
    $('#updateStatusText').textContent = '업데이트 파일이 준비됐습니다. 프로그램을 종료한 뒤 다시 열면 새 버전으로 시작합니다.';
    $('#installUpdateButton').disabled = true;
  } else if (update.status === 'installing') {
    $('#updateStatusText').textContent = '업데이트를 조용히 적용하고 있습니다.';
    $('#installUpdateButton').disabled = true;
  } else if (update.status === 'error' && update.error) {
    $('#updateStatusText').textContent = `업데이트 확인에 실패했습니다. ${update.error}`;
  }
  $('#encryptionState').textContent = state.encryptionAvailable ? 'OS 보호' : '기본 보호';
  $('#vtubeState').textContent = cfg.hasVtubeAuthToken ? '인증됨' : '미인증';
  $('#soundFolderText').textContent = cfg.fxFolder || cfg.soundFolder || '선택된 폴더 없음';

  if (!fields.token.dataset.dirty) fields.token.placeholder = cfg.hasToken ? cfg.token : '웹 대시보드에서 발급한 토큰';
  fields.autoStart.checked = !!cfg.autoStart;
  fields.titsEndpoint.value = cfg.titsEndpoint || 'ws://localhost:42069';
  fields.vtubeEndpoint.value = cfg.vtubeEndpoint || 'ws://localhost:8001';

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
  const nextVolume = Math.max(0, Math.min(100, Math.round(Number(data?.settings?.videoDonationVolume ?? 100))));
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
  fields.remotePvdVolume.value = String(nextVolume);
  $('#remotePvdVolumeText').textContent = `${nextVolume}%`;
}

function diagnosticStatusLabel(status) {
  if (status === 'pass') return '정상';
  if (status === 'warn') return '확인 필요';
  return '실패';
}

function renderDiagnostics(result) {
  const summary = result?.summary || {};
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const summaryEl = $('#diagnosticSummary');
  const listEl = $('#diagnosticList');
  if (!summaryEl || !listEl) return;
  if (!checks.length) {
    summaryEl.textContent = '점검 결과가 없습니다.';
    listEl.innerHTML = '';
    return;
  }
  summaryEl.innerHTML = `
    <strong>${summary.status === 'fail' ? '실패 항목이 있습니다' : summary.status === 'warn' ? '확인할 항목이 있습니다' : '방송 PC 연결 준비 완료'}</strong>
    <span>정상 ${Number(summary.passed || 0)} · 확인 필요 ${Number(summary.warnings || 0)} · 실패 ${Number(summary.failed || 0)}</span>
  `;
  listEl.innerHTML = checks.map((check) => `
    <div class="diagnostic-row ${escapeHtml(check.status || 'fail')}">
      <span class="diagnostic-state">${diagnosticStatusLabel(check.status)}</span>
      <strong>${escapeHtml(check.label || '')}</strong>
      <span>${escapeHtml(check.detail || '')}</span>
    </div>
  `).join('');
}

async function loadRemote() {
  const data = await window.aruLocal.remoteOverview();
  renderRemote(data);
  return data;
}

function collectConfig() {
  return {
    token: fields.token.value || undefined,
    autoStart: fields.autoStart.checked,
    titsEndpoint: fields.titsEndpoint.value,
    vtubeEndpoint: fields.vtubeEndpoint.value,
  };
}

function renderVtubeDiscovery(discovery) {
  vtubeDiscovery = {
    models: Array.isArray(discovery?.models) ? discovery.models : [],
    hotkeys: Array.isArray(discovery?.hotkeys) ? discovery.hotkeys : [],
  };
  $('#vtubeModelCount').textContent = String(vtubeDiscovery.models.length);
  $('#vtubeHotkeyCount').textContent = String(vtubeDiscovery.hotkeys.length);
  fields.vtubeHotkeySelect.innerHTML = vtubeDiscovery.hotkeys.length
    ? vtubeDiscovery.hotkeys.map((hotkey) => `<option value="${escapeHtml(hotkey.id || hotkey.name || '')}">${escapeHtml(hotkey.name || hotkey.id || '핫키')}</option>`).join('')
    : '<option value="">핫키 없음</option>';
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

$('#authenticateVtubeButton').addEventListener('click', () => run(async () => {
  await window.aruLocal.saveConfig(collectConfig());
  const result = await window.aruLocal.authenticateVtube();
  $('#vtubeState').textContent = result.authenticated ? '인증됨' : '미인증';
  pushLocalLog('success', result.reused ? 'VTube Studio 인증을 확인했습니다.' : 'VTube Studio 인증을 완료했습니다.');
}));

$('#discoverVtubeButton').addEventListener('click', () => run(async () => {
  await window.aruLocal.saveConfig(collectConfig());
  const discovery = await window.aruLocal.discoverVtube();
  renderVtubeDiscovery(discovery);
  $('#vtubeState').textContent = '인증됨';
}));

$('#triggerVtubeHotkeyButton').addEventListener('click', () => run(async () => {
  const hotkeyId = fields.vtubeHotkeySelect.value;
  if (!hotkeyId) return;
  await window.aruLocal.saveConfig(collectConfig());
  await window.aruLocal.triggerVtubeHotkey({ hotkeyId });
  pushLocalLog('success', 'VTube Studio 핫키를 실행했습니다.');
}));

$('#chooseSoundFolderButton').addEventListener('click', () => run(async () => {
  const folder = await window.aruLocal.chooseSoundFolder();
  if (folder) $('#soundFolderText').textContent = folder;
}));

$('#openSoundFolderButton').addEventListener('click', () => run(async () => {
  await window.aruLocal.openSoundFolder();
}));

$('#openDashboardButton').addEventListener('click', () => run(async () => {
  await window.aruLocal.openDashboard();
}));

$('#runDiagnosticsButton').addEventListener('click', () => run(async () => {
  await window.aruLocal.saveConfig(collectConfig());
  const button = $('#runDiagnosticsButton');
  button.disabled = true;
  button.textContent = '점검 중';
  try {
    const result = await window.aruLocal.runDiagnostics();
    renderDiagnostics(result);
  } finally {
    button.disabled = false;
    button.textContent = '점검 실행';
  }
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
      ? `새 버전 ${latestUpdate.latestVersion}이 준비됐습니다. 방송 전에 바로 업데이트할 수 있어요.`
      : '최신 버전을 사용 중입니다.';
  } finally {
    $('#checkUpdateButton').disabled = false;
  }
}));

$('#installUpdateButton').addEventListener('click', () => run(async () => {
  await window.aruLocal.saveConfig(collectConfig());
  $('#installUpdateButton').disabled = true;
  $('#updateStatusText').textContent = '업데이트를 프로그램 안에서 다운로드하고 있습니다.';
  try {
    latestUpdate = await window.aruLocal.installUpdate();
    $('#latestVersionText').textContent = latestUpdate.latestVersion || '확인 완료';
    $('#updateStatusText').textContent = latestUpdate.readyToApply
      ? '업데이트 파일이 준비됐습니다. 프로그램을 종료한 뒤 다시 열면 새 버전으로 시작합니다.'
      : latestUpdate.opened
      ? '업데이트 설치 파일을 열었습니다.'
      : '이미 최신 버전을 사용 중입니다.';
  } finally {
    $('#installUpdateButton').disabled = !latestUpdate?.updateAvailable || !!latestUpdate?.readyToApply || !!latestUpdate?.downloaded;
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

fields.remotePvdVolume.addEventListener('input', () => {
  const nextVolume = Math.max(0, Math.min(100, Math.round(Number(fields.remotePvdVolume.value || 0))));
  $('#remotePvdVolumeText').textContent = `${nextVolume}%`;
});

$('#remotePvdVolumeButton').addEventListener('click', () => run(async () => {
  const nextVolume = Math.max(0, Math.min(100, Math.round(Number(fields.remotePvdVolume.value || 0))));
  await window.aruLocal.remoteControlVideoDonation({ op: 'volume', volume: nextVolume });
  await loadRemote();
  pushLocalLog('success', `영상후원 소리를 ${nextVolume}%로 조절했습니다.`);
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
