(() => {
  const root = document.getElementById('avatarStudio'),
    api = window.aruLocal;
  const esc = (v) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  const states = {
    idle: '기본 / 대기',
    walk: '걷기',
    run: '달리기',
    float: '공중부양',
    jump: '점프',
    dance: '춤',
    wave: '인사',
    sit: '앉기',
    hit: '피격',
  };
  const actions = {
    wait: '대기',
    jump: '점프',
    dance: '춤',
    wave: '인사',
    sit: '앉기',
    walk: '좌우 이동',
    run: '달리기',
    float: '공중부양',
    gather: '가운데로 이동',
    follow: '따라가기',
    highfive: '하이파이브',
    push: '밀기',
    size: '크기 변경',
    say: '말풍선',
  };
  const triggers = {
    command: '채팅 명령어',
    join: '입장',
    firstJoin: '세션 첫 참여',
    chat: '모든 채팅',
    donation: '후원',
    subscription: '구독',
  };
  const roles = {
    everyone: '모든 시청자',
    moderator: '운영자 이상',
    owner: '스트리머',
  };
  let state,
    draft,
    dirty = false,
    tab = 'avatars',
    selectedAvatar = '',
    selectedRule = '',
    busy = false,
    previewMode = false,
    requestEpoch = 0,
    savedDraft = '',
    draftTimer,
    draftWrites = Promise.resolve(),
    recovery = null,
    editGroup = '',
    clipState = 'idle',
    clipPlaying = true,
    clipFrame = 0,
    clipStarted = 0,
    clipAnimation = 0,
    latestJob = null;
  const jobPanel = document.createElement('div');
  jobPanel.className = 'av-job';
  jobPanel.hidden = true;
  root.insertAdjacentElement('afterend', jobPanel);
  jobPanel.innerHTML = '<span role="status"></span><progress max="100"></progress><button type="button" class="button secondary" title="백업 작업 취소">작업 취소</button>';
  jobPanel.querySelector('button').addEventListener('click', async () => {
    if (!latestJob?.id) return;
    try { await api.avatarCommand('backup-cancel', { id: latestJob.id }); }
    catch (error) { notice(error.message, true); }
  });
  function updateJob(job) {
    latestJob = job || null;
    const active = job && ['running', 'queued', 'pending'].includes(job.status);
    jobPanel.hidden = !active;
    if (!job) return;
    jobPanel.querySelector('span').textContent = `${job.action || '백업'} · ${job.status} · ${job.progress ?? 0}%`;
    jobPanel.querySelector('progress').value = Number(job.progress) || 0;
    jobPanel.querySelector('button').disabled = !active || !job.id;
  }
  const history = { undo: [], redo: [] };
  const filters = { avatars: '', rules: '', enabled: '', trigger: '', viewers: '', sort: 'number' };
  const monitorOptions = { view: 'zoom', follow: '' };
  const newRuleIds = new Set();
  const localDiagnostics = [];
  const testOptions = { source: 'draft', actorId: '', targetName: '' };
  const testInput = {
    userId: 'rehearsal-user-1',
    name: '테스트',
    text: '!점프',
    kind: 'chat',
    role: 'everyone',
    amount: 1000,
  };
  const q = (id) => root.querySelector(`#${id}`);
  const button = (label, action, extra = '') =>
    `<button type="button" class="button secondary" data-av="${action}" ${extra}>${label}</button>`;
  const options = (items, selected) =>
    Object.entries(items)
      .map(
        ([key, label]) =>
          `<option value="${esc(key)}" ${key === selected ? 'selected' : ''}>${esc(label)}</option>`,
      )
      .join('');
  const field = (label, key, value, type = 'text', attrs = '') =>
    `<label>${label}<input type="${type}" data-field="${key}" value="${esc(value)}" ${attrs}></label>`;
  const check = (label, key, value) =>
    `<label class="av-check"><input type="checkbox" data-field="${key}" ${value ? 'checked' : ''}>${label}</label>`;
  const select = (label, key, items, value) => `<label>${label}<select data-field="${key}">${options(items, String(value))}</select></label>`;
  const icon = (symbol, title, action, extra = '') => `<button type="button" class="av-icon" data-av="${action}" title="${esc(title)}" aria-label="${esc(title)}" ${extra}>${window.aruAvatarIcons?.[{ '↶': 'Undo2', '↷': 'Redo2', '▷': 'Play', '▸': 'Play', '⧉': 'Copy', '↑': 'ArrowUp', '↓': 'ArrowDown', '×': 'X' }[symbol]] || symbol}</button>`;
  const gameDefaults = { duration: 30, recruitSeconds: 0, countdownSeconds: 0, resultSeconds: 10, goal: 0, departures: 'keep', boosts: 0 };
  const reservedAliases = new Set('!입장 !join !퇴장 !leave !캐릭터 !avatar !색 !color !크기 !size !도움말 !help !응원 !cheer !상호작용 !targeting !참가 !participate !부스트 !boost'.split(' '));
  const codes = {
    OK: '실행됨', EXECUTED: '실행됨', COOLDOWN: '재사용 대기 중', ROLE_DENIED: '사용 권한 부족',
    TARGET_MISSING: '대상을 찾을 수 없음', TARGET_AMBIGUOUS: '동명이인: #참여번호로 지정', TARGET_DENIED: '대상 상호작용 거부',
    TARGETING_DISABLED: '대상 상호작용 꺼짐', ACTOR_LIMIT: '참여 정원 초과', DISABLED: '방송 실행 꺼짐', PAUSED: '일시정지 중',
    STALE_EVENT: '유효 시간이 지난 이벤트', RATE_LIMIT: '입력 빈도 한도 초과', GAME_OWNS_MOTION: '게임이 이동 제어 중',
    INVALID_ARGUMENT: '명령 인자 오류', LANE_CONFLICT: '동시에 실행할 동작의 제어 영역 충돌', BLOCKED: '운영자 차단',
    NEW_JOINS_DISABLED: '신규 참여 중지', TARGET_LEFT: '대상 퇴장', TIMEOUT: '완료 조건 시간 초과', QUEUE_FULL: '반응 대기열 가득 참',
    ASSET_LOAD_FAILED: '이미지 로드 실패', OUTPUT_DISCONNECTED: '출력 연결 끊김', FRAME_DELAY: '출력 프레임 지연',
    HEIGHT_CLAMPED: '안전 영역에 맞춰 높이 제한', JOINS_CLOSED: '신규 참여 중지', NO_CHANNEL: '채널 연결 없음',
    INVALID_EVENT: '이벤트 형식 오류', DUPLICATE: '중복 이벤트', UNSAFE_TEXT: '허용되지 않는 입력', LEFT: '자발적 퇴장',
    CONTROL_APPLIED: '참여 설정 적용', NO_RULE: '일치하는 반응 없음', RULE_DISABLED: '반응 꺼짐', MINIMUM_AMOUNT: '최소 후원 금액 미달',
    DURATION_CLAMPED: '시간 입력 상한 적용', DURATION_LIMIT: '전체 반응 시간 상한 초과', LANE_BUSY: '다른 반응이 같은 동작 영역 사용 중',
    QUEUED: '반응 대기열 등록', GAME_JOIN_CLOSED: '게임 참가 마감', GAME_JOINED: '게임 참가 완료', NO_ACTIVE_RACE: '진행 중인 달리기 없음',
    BOOST_LIMIT: '개인 부스트 한도 도달', BOOST_APPLIED: '부스트 적용', SUSPEND_GAP: '절전 또는 긴 프레임 공백',
    INVALID_FRAME: '잘못된 출력 프레임', STALE_FRAME: '오래된 출력 프레임', FRAME_STALE: '새 출력 프레임 대기 시간 초과',
    PROTOCOL_MISMATCH: '출력 프로토콜 버전 불일치', BOOTSTRAP_MISSING: '초기 출력 상태 없음', RELOAD_LIMIT: '자동 재로딩 한도 도달',
    RELOAD_UNAVAILABLE: '출력 재로딩 불가', RENDER_FAILED: '출력 렌더링 실패', NATIVE_ANIMATION_UNCONTROLLED: 'GIF/WebP 자체 재생은 프레임 설정으로 제어 불가',
  };
  function snapshotEdit() {
    return JSON.stringify({ config: draft, selectedAvatar, selectedRule });
  }
  function trimHistory() {
    const bytes = () => new TextEncoder().encode([...history.undo, ...history.redo].join('')).length;
    while (history.undo.length + history.redo.length > 50 || bytes() > 2 * 1024 * 1024) {
      if (history.undo.length) history.undo.shift();
      else if (history.redo.length) history.redo.shift();
      else break;
    }
  }
  function checkpoint(group = '') {
    if (!group || editGroup !== group) history.undo.push(snapshotEdit());
    history.redo.length = 0;
    editGroup = group;
    trimHistory();
  }
  function historyMove(direction) {
    const from = history[direction], to = history[direction === 'undo' ? 'redo' : 'undo'];
    if (!from.length) return;
    to.push(snapshotEdit());
    const entry = JSON.parse(from.pop());
    draft = entry.config;
    selectedAvatar = entry.selectedAvatar;
    selectedRule = entry.selectedRule;
    editGroup = '';
    trimHistory();
    changed();
    renderBody();
  }
  function persistDraft() {
    clearTimeout(draftTimer);
    if (!api.avatarDraft || recovery) return Promise.resolve();
    const refs = new Set();
    for (const entry of [...history.undo, ...history.redo]) {
      for (const avatar of JSON.parse(entry).config.avatars || []) {
        for (const clip of Object.values(avatar.states || {})) if (clip.asset) refs.add(clip.asset);
      }
    }
    const payload = { config: structuredClone(draft), undoAssets: [...refs], selectedAvatar, selectedRule };
    const action = dirty || history.undo.length || history.redo.length ? 'save' : 'discard';
    draftWrites = draftWrites.catch(() => {}).then(() => api.avatarDraft(action, payload));
    return draftWrites;
  }
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => void persistDraft().catch((error) => notice(`초안 복구 저장 실패: ${error.message}`, true)), 450);
  }
  async function choose(title, choices, renderChoice) {
    const dialog = document.createElement('dialog');
    dialog.className = 'av-dialog';
    dialog.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><div class="av-actions">${choices.map(([value, label]) => `<button class="button secondary" value="${esc(value)}">${renderChoice ? renderChoice(value, label) : esc(label)}</button>`).join('')}<button class="button secondary" value="cancel">취소</button></div></form>`;
    document.body.append(dialog);
    const answer = new Promise((resolve) => dialog.addEventListener('close', () => { const value = dialog.returnValue; dialog.remove(); resolve(value || 'cancel'); }, { once: true }));
    dialog.showModal();
    return answer;
  }
  function diagnosticText(item) {
    if (!item) return '';
    if (typeof item === 'string') return item;
    return [item.code, codes[item.code] || item.message || '처리 결과', typeof item.detail === 'string' ? item.detail : ''].filter(Boolean).join(' · ');
  }
  function uniqueName(name, items, limit = 32) {
    let suffix = 2, candidate = String(name).slice(0, limit);
    while (items.some((item) => item.name.toLocaleLowerCase() === candidate.toLocaleLowerCase())) {
      const tail = ` ${suffix++}`;
      candidate = String(name).slice(0, limit - tail.length) + tail;
    }
    return candidate;
  }
  function uniqueAliases(aliases) {
    const used = new Set([...reservedAliases, ...draft.rules.filter((r) => r.trigger === 'command').flatMap((r) => r.aliases.map((a) => a.toLowerCase()))]);
    return aliases.map((alias) => {
      let next = alias, n = 2;
      while (used.has(next.toLowerCase())) { const tail = String(n++); next = alias.slice(0, 32 - tail.length) + tail; }
      used.add(next.toLowerCase());
      return next;
    });
  }
  function assetUrl(asset) {
    if (!state?.url || !asset) return '';
    const u = new URL(state.url);
    u.pathname = `/assets/${asset}`;
    return u.toString();
  }
  function thumbnail(clip, pixelated) {
    if (!clip) return '';
    return `<span class="av-thumb" aria-hidden="true" style="background-image:url('${esc(assetUrl(clip.asset))}');background-size:${clip.columns * 100}% ${clip.rows * 100}%;image-rendering:${pixelated ? 'pixelated' : 'auto'}"></span>`;
  }
  function changed() {
    dirty = JSON.stringify(draft) !== savedDraft;
    q('avDirty').textContent = dirty ? '미저장 변경' : '';
    if (q('avUndo')) q('avUndo').disabled = !history.undo.length;
    if (q('avRedo')) q('avRedo').disabled = !history.redo.length;
    scheduleDraft();
    validateFields();
  }
  function notice(message, error = false) {
    q('avNotice').textContent = message;
    q('avNotice').className = error ? 'av-error' : 'av-notice';
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    requestEpoch++;
    root.inert = true;
    root.setAttribute('aria-busy', 'true');
    try {
      await fn();
    } catch (error) {
      notice(error.message || '작업에 실패했습니다.', true);
    } finally {
      busy = false;
      root.inert = false;
      root.removeAttribute('aria-busy');
    }
  }
  function shell() {
    root.innerHTML = `<div class="av-toolbar"><h2>방송 아바타</h2><div class="av-actions">${icon('↶', '실행 취소', 'undo', 'id="avUndo"')}${icon('↷', '다시 실행', 'redo', 'id="avRedo"')}${button('실행', 'toggle', 'id="avToggle"')}${button('일시정지', 'pause', 'id="avPause"')}${button('화면 비우기', 'clear')}${button('설정 저장', 'save')}</div></div>
      <div class="av-status"><strong id="avRunning"></strong><span id="avConnection"></span><span id="avCount"></span><span id="avDirty"></span></div>
      <div id="avRecovery" class="av-recovery" ${recovery ? '' : 'hidden'}>복구 가능한 초안${button('초안 복구', 'recover')}${button('복구 초안 삭제', 'discard-recovery')}</div>
      <div class="av-preview-controls"><div class="av-segment" role="group" aria-label="미리보기 모드">${button('방송 출력', 'view-live', 'id="avViewLive" aria-pressed="true"')}${button('동작 미리보기', 'view-test', 'id="avViewTest" aria-pressed="false"')}${button('채팅 리허설', 'view-rehearsal', 'id="avViewRehearsal" aria-pressed="false"')}</div><span id="avTestStatus"></span>${button('일시정지', 'test-pause', 'id="avTestPause"')}${button('초기화', 'test-reset', 'id="avTestReset"')}${icon('▸', '미리보기 100ms 진행', 'preview-step', 'id="avTestStep"')}</div>
      <div class="av-preview"><iframe id="avPreview" title="아바타 실시간 미리보기" sandbox="allow-scripts allow-same-origin"></iframe></div>
      <div class="av-monitor-controls"><label>검사 화면<select data-monitor="view">${options({ zoom: '확대 보기', full: '방송 전체 크기' }, monitorOptions.view)}</select></label><label>참여자 추적<select id="avFollow" data-monitor="follow"><option value="">추적 안 함</option></select></label><span class="av-meta">안전 영역: 검사 화면에만 표시</span></div>
      <div class="av-url"><input id="avUrl" readonly aria-label="OBS 브라우저 주소">${button('OBS 주소 복사', 'copy')}</div>
      <div id="avNotice" class="av-notice" role="status" aria-live="polite"></div>
      <div class="av-tabs" role="tablist">${[
        ['avatars', '캐릭터'],
        ['scene', '장면'],
        ['rules', '채팅 반응'],
        ['viewers', '참여자'],
        ['games', '게임 / 테스트'],
        ['storage', '백업 / 진단'],
      ]
        .map(
          ([key, label]) =>
            `<button role="tab" data-tab="${key}" aria-selected="${key === tab}">${label}</button>`,
        )
        .join(
          '',
        )}</div><div id="avBody" class="av-body" role="tabpanel"></div>`;
    updateStatus();
    renderBody();
  }
  function updateStatus() {
    if (!state) return;
    updateJob(state.job);
    const targetSelect = q('avPreviewTarget');
    if (targetSelect && document.activeElement !== targetSelect) targetSelect.innerHTML = options({ '': '대상 없음', ...Object.fromEntries((state.preview?.snapshot?.actors || []).map((a) => [`#${a.number}`, `#${a.number} ${a.name}`])) }, testOptions.targetName);
    q('avRunning').textContent = state.config.enabled
      ? state.config.paused
        ? '일시정지'
        : '실행 중'
      : '중지';
    q('avConnection').textContent = state.connected
      ? '치지직 이벤트 연결됨'
      : '채팅 연결 대기';
    q('avCount').textContent =
      `${state.snapshot.actors.length}명 · 출력 연결 ${state.clients}개 · v${state.config.version} / revision ${state.snapshot.configRevision ?? 0}`;
    q('avToggle').textContent = state.config.enabled
      ? '방송 중지'
      : '방송 시작';
    q('avPause').textContent = state.config.paused
      ? '방송 재개'
      : '방송 일시정지';
    q('avUrl').value = state.url || '';
    let previewUrl = previewMode === 'rehearsal'
      ? state.rehearsalUrl
      : previewMode
      ? state.previewUrl
      : state.url
        ? `${state.url}&monitor=1`
        : '';
    if (previewUrl) {
      const url = new URL(previewUrl); url.searchParams.set('monitor', '1'); url.searchParams.set('view', monitorOptions.view);
      if (monitorOptions.follow) url.searchParams.set('follow', monitorOptions.follow);
      previewUrl = url.toString();
    }
    q('avViewLive').setAttribute('aria-pressed', String(!previewMode));
    q('avViewTest').setAttribute('aria-pressed', String(previewMode === true));
    q('avViewRehearsal').setAttribute('aria-pressed', String(previewMode === 'rehearsal'));
    const testing = previewMode === 'rehearsal' ? state.rehearsal : state.preview;
    const follow = q('avFollow');
    if (document.activeElement !== follow) follow.innerHTML = options({ '': '추적 안 함', ...Object.fromEntries(((previewMode ? testing : state)?.snapshot?.actors || []).map((a) => [a.id, `#${a.number} ${a.name}`])) }, monitorOptions.follow);
    q('avTestStatus').textContent = previewMode
      ? `${previewMode === 'rehearsal' ? '조건 검사' : '권한·입장·쿨다운 우회'} · ${testing?.snapshot?.actors.length ?? 0}명${previewMode === 'rehearsal' ? ` · ${testOptions.source === 'draft' ? '편집 설정' : '저장 설정'}` : dirty ? ' · 미저장 설정' : ''}`
      : '';
    q('avTestPause').hidden = !previewMode;
    q('avTestReset').hidden = !previewMode;
    q('avTestStep').hidden = previewMode !== true;
    q('avTestPause').textContent = testing?.snapshot?.paused ? '재개' : '일시정지';
    q('avUndo').disabled = !history.undo.length;
    q('avRedo').disabled = !history.redo.length;
    q('avDirty').textContent = dirty ? '미저장 변경' : '';
    if (previewUrl && q('avPreview').getAttribute('src') !== previewUrl)
      q('avPreview').src = previewUrl;
    if (!previewUrl) q('avPreview').removeAttribute('src');
  }
  function stepValue(step, index) {
    const key = `step.${index}.value`;
    if (step.action === 'walk')
      return `<label>방향<select data-field="${key}">${options({ '-1': '왼쪽', 1: '오른쪽' }, String(step.value))}</select></label>`;
    if (step.action === 'run')
      return field(
        '속도 배율',
        key,
        step.value || 3,
        'number',
        'min="1.5" max="6" step="0.5"',
      );
    if (step.action === 'float')
      return field(
        '부양 높이 (px)',
        key,
        step.value || 160,
        'number',
        'min="30" max="500" step="10"',
      );
    if (step.action === 'size')
      return field(
        '크기 배율',
        key,
        step.value || 1,
        'number',
        'min="0.5" max="1.6" step="0.1"',
      );
    if (step.action === 'say')
      return field('문구 ({user}, {target})', key, step.value);
    return '<span></span>';
  }
  async function test(payload) {
    validateFields(true);
    state = await api.avatarCommand('test', {
      ...testInput,
      actorId: testOptions.actorId || testInput.userId,
      targetName: testOptions.targetName,
      avatarId: selectedAvatar || draft.defaultAvatar,
      ...payload,
      config: structuredClone(draft),
    });
    previewMode = true;
    updateStatus();
    renderRecent();
    notice(diagnosticText(state.preview.lastResult || state.preview.result));
  }
  function renderBody() {
    cancelAnimationFrame(clipAnimation);
    root
      .querySelectorAll('[data-tab]')
      .forEach((b) =>
        b.setAttribute('aria-selected', String(b.dataset.tab === tab)),
      );
    const body = q('avBody');
    if (tab === 'avatars') {
      const a =
        draft.avatars.find((a) => a.id === selectedAvatar) || draft.avatars[0];
      selectedAvatar = a.id;
      body.innerHTML = `<div class="av-grid"><div class="av-list">${draft.avatars.map((v) => `<button data-avatar="${esc(v.id)}" aria-pressed="${v.id === a.id}">${thumbnail(v.states.idle, v.pixelated)}<span>${esc(v.name)}</span></button>`).join('')}${button('이미지로 추가', 'add-avatar')}</div><div class="av-editor"><div class="av-form">${field('캐릭터 이름', 'avatar.name', a.name, 'text', 'maxlength="32"')}<label>기본 캐릭터<select data-field="defaultAvatar">${options(Object.fromEntries(draft.avatars.map((v) => [v.id, v.name])), draft.defaultAvatar)}</select></label>${check('픽셀 아트 선명하게', 'avatar.pixelated', a.pixelated)}</div>
        ${Object.entries(states)
          .map(([key, label]) => {
            const s = a.states[key];
            const fallback = key === 'run' && a.states.walk ? 'walk' : 'idle';
            return `<div class="av-state"><div class="av-state-head">${thumbnail(s || a.states[fallback], a.pixelated)}<strong>${label}</strong>${button('이미지 선택', 'state-image', `data-state="${key}"`)}${s && key !== 'idle' ? button('해제', 'state-clear', `data-state="${key}"`) : !s ? `<span>${fallback === 'walk' ? '걷기' : '기본'} 이미지 대체</span>` : ''}</div>${
              s
                ? `<details><summary>스프라이트 시트</summary><div class="av-sheet">${[
                    ['columns', '열'],
                    ['rows', '행'],
                    ['frames', '프레임'],
                    ['fps', 'FPS'],
                  ]
                    .map(([p, label]) =>
                      field(
                        label,
                        `clip.${key}.${p}`,
                        s[p],
                        'number',
                        'min="1" max="1024"',
                      ),
                    )
                    .join('')}</div></details>`
                : ''
            }</div>`;
          })
          .join(
            '',
          )}<div class="av-actions" style="margin-top:16px">${button('선택 캐릭터 테스트', 'test-avatar')}${button('캐릭터 삭제', 'delete-avatar')}</div></div></div>`;
    } else if (tab === 'scene') {
      body.innerHTML = `<div class="av-editor"><div class="av-actions">${button('차분하게', 'preset', 'data-preset="quiet"')}${button('기본', 'preset', 'data-preset="normal"')}${button('활발하게', 'preset', 'data-preset="party"')}</div><div class="av-form" style="margin-top:16px">
        ${field('캐릭터 크기 (px)', 'size', draft.size, 'number', 'min="24" max="160"')}${field('걷기 속도', 'speed', draft.speed, 'number', 'min="0.2" max="4" step="0.1"')}
        ${field('최대 참여자', 'maxActors', draft.maxActors, 'number', 'min="1" max="150"')}${field('자동 퇴장 (분)', 'idleMinutes', draft.idleMinutes, 'number', 'min="1" max="120"')}
        ${field('바닥 여백 (px)', 'floor', draft.floor, 'number', 'min="0" max="300"')}${field('OBS 출력 포트', 'port', draft.port, 'number', 'min="1024" max="65535"')}
        ${check('채팅 시 자동 입장', 'autoJoin', draft.autoJoin)}${check('이름표 표시', 'showNames', draft.showNames)}${check('일반 채팅 말풍선', 'bubbles', draft.bubbles)}${check('시청자 간 대상 상호작용', 'allowTargeting', draft.allowTargeting)}</div></div>`;
    } else if (tab === 'rules') {
      const r =
        draft.rules.find((r) => r.id === selectedRule) || draft.rules[0];
      selectedRule = r?.id;
      body.innerHTML = `<div class="av-grid"><div class="av-list">${draft.rules.map((v) => `<button data-rule="${esc(v.id)}" aria-pressed="${v.id === r?.id}">${esc(v.name)}${v.enabled ? '' : ' (꺼짐)'}</button>`).join('')}${button('반응 추가', 'add-rule')}${button('환영 반응 추가', 'welcome-rule')}${button('명령 목록 복사', 'copy-commands')}</div><div class="av-editor">${
        r
          ? `<div class="av-form">${field('반응 이름', 'rule.name', r.name)}<label>발생 조건<select data-field="rule.trigger">${options(triggers, r.trigger)}</select></label>${field('명령어 / 별칭', 'rule.aliases', r.aliases.join(' '), 'text', 'placeholder="!점프 !jump"')}<label>사용 권한<select data-field="rule.role">${options(roles, r.role)}</select></label>${field('재사용 대기 (초)', 'rule.cooldown', r.cooldown, 'number', 'min="1" max="600"')}${field('최소 후원 금액', 'rule.minimum', r.minimum, 'number', 'min="0"')}${check('반응 사용', 'rule.enabled', r.enabled)}${check('채팅 숫자로 시간 지정 (최대 120초)', 'rule.durationFromChat', r.durationFromChat)}</div>
        <div class="av-section-head"><h3>순서대로 실행</h3>${button('동작 추가', 'add-step')}</div>
        ${r.steps.map((s, i) => `<div class="av-step"><label>동작 ${i + 1}<select data-field="step.${i}.action">${options(actions, s.action)}</select></label>${stepValue(s, i)}${field('전체 시간 (초)', `step.${i}.duration`, s.duration, 'number', 'min="0.1" max="120" step="0.1"')}<div class="av-actions"><button class="av-icon" data-av="step-up" data-step="${i}" title="위로 이동" aria-label="동작 ${i + 1} 위로 이동">↑</button><button class="av-icon" data-av="step-delete" data-step="${i}" title="동작 삭제" aria-label="동작 ${i + 1} 삭제">×</button></div></div>`).join('')}<div class="av-actions" style="margin-top:16px">${button('이 반응 테스트', 'test-rule')}${button('우선순위 올리기', 'rule-up')}${button('반응 삭제', 'delete-rule')}</div>`
          : '<div class="av-empty">등록된 반응이 없습니다.</div>'
      }</div></div>`;
    } else if (tab === 'viewers') {
      body.innerHTML = '<div id="avViewers"></div>';
      renderViewers();
    } else if (tab === 'games') {
      body.innerHTML = `<div class="av-editor"><h3>방송 게임</h3><div class="av-actions">${button('달리기 시작', 'race')}${button('공동 응원 시작', 'cheer')}${button('게임 종료', 'stop-game')}</div><h3 class="av-test-heading">편집 테스트</h3><div class="av-actions">${button('테스트 참여자 10명', 'test-crowd')}${button('달리기 게임 테스트', 'preview-race')}${button('공동 응원 테스트', 'preview-cheer')}${button('테스트 게임 종료', 'preview-stop-game')}</div>
        <form id="avTestForm" class="av-test"><label>테스트 닉네임<input id="avTestName" data-test-field="name" value="${esc(testInput.name)}" maxlength="32"></label><label>이벤트<select id="avTestKind" data-test-field="kind">${options({ chat: '채팅', donation: '후원', subscription: '구독' }, testInput.kind)}</select></label><label>권한<select id="avTestRole" data-test-field="role">${options(roles, testInput.role)}</select></label><label class="av-chat">채팅 내용<input id="avTestText" data-test-field="text" value="${esc(testInput.text)}" maxlength="300"></label><label>후원 금액<input id="avTestAmount" data-test-field="amount" type="number" min="0" value="${esc(testInput.amount)}"></label><button type="submit" class="button primary">테스트 전송</button></form><h3>최근 반응</h3><ul id="avRecent" class="av-log"></ul></div>`;
      q('avTestForm').addEventListener('submit', (event) => {
        event.preventDefault();
        void run(async () => {
          if (!testInput.userId.trim()) throw new Error('리허설 사용자 ID를 입력해 주세요.');
          if (testOptions.source === 'draft') validateFields(true);
          state = await api.avatarCommand('rehearsal', {
            userId: testInput.userId,
            actorId: testInput.userId,
            ...(testOptions.source === 'saved' ? { source: 'saved' } : { config: structuredClone(draft) }),
            name: q('avTestName').value,
            text: q('avTestText').value,
            kind: q('avTestKind').value,
            role: q('avTestRole').value,
            amount: q('avTestAmount').value,
          });
          previewMode = 'rehearsal';
          updateStatus(); renderRecent();
          notice(diagnosticText(state.rehearsal?.lastResult || state.rehearsal?.result));
        });
      });
      renderRecent();
    } else {
      body.innerHTML = `<div class="av-editor"><h3>로컬 저장소</h3><p>${state.assets.length}개 이미지 · ${(state.assets.reduce((sum, a) => sum + a.bytes, 0) / 1048576).toFixed(1)} / 48MB</p><div class="av-actions">${button('백업 내보내기', 'backup')}${button('백업 불러오기', 'restore')}${button('미사용 이미지 정리', 'prune')}${button('시청자 기록 전체 삭제', 'forget-all')}</div></div>`;
    }
    if (['avatars', 'rules'].includes(tab)) {
      body.querySelector('.av-editor')?.insertAdjacentHTML('beforeend', `<div class="av-form av-preview-fields"><label>미리보기 사용자 ID<input data-test-option="actorId" maxlength="128" value="${esc(testOptions.actorId)}" placeholder="${esc(testInput.userId)}"></label><label>미리보기 대상<select id="avPreviewTarget" data-test-option="targetName">${options({ '': '대상 없음', ...Object.fromEntries((state.preview?.snapshot?.actors || []).map((a) => [`#${a.number}`, `#${a.number} ${a.name}`])) }, testOptions.targetName)}</select></label><label>미리보기 말풍선 / 입력<input data-test-field="text" maxlength="300" value="${esc(testInput.text)}"></label></div>`);
    }
    enhanceBody();
    validateFields();
  }
  function renderRecent() {
    if (q('avRecent'))
      q('avRecent').innerHTML =
        (previewMode === 'rehearsal' ? state.rehearsal?.recent || [] : previewMode ? state.preview.recent : state.recent)
          .map(
            (r) =>
              `<li>${esc(new Date(r.at).toLocaleTimeString())} · ${esc(r.message)}</li>`,
          )
          .join('') || '<li>아직 실행된 반응이 없습니다.</li>';
    const source = previewMode === 'rehearsal' ? state.rehearsal : previewMode ? state.preview : state;
    if (q('avResult')) q('avResult').textContent = diagnosticText(source?.lastResult || source?.result);
    if (q('avDiagnostics')) q('avDiagnostics').innerHTML = [...localDiagnostics.filter((d) => d.source === (previewMode || 'live')), ...(source?.diagnostics || [])].slice(0, 200).map((entry) => `<li><strong>${esc(diagnosticText(entry))}</strong><details><summary>판정 정보</summary><dl>${['eventId', 'ruleId', 'configRevision', 'latency', 'interruptedBy'].filter((key) => entry[key] != null).map((key) => `<dt>${esc(key)}</dt><dd>${esc(entry[key])}</dd>`).join('')}</dl></details></li>`).join('') || '<li>진단 기록 없음</li>';
    if (q('avGameStatus')) {
      const game = state.snapshot.game;
      q('avGameStatus').textContent = game ? `${game.type} · ${game.phase || '진행'} · 참가 ${Array.isArray(game.participants) ? game.participants.length : game.participants ?? 0}명${game.phaseEndsAt ? ` · ${Math.max(0, Math.ceil((game.phaseEndsAt - (state.snapshot.simulationTime ?? state.snapshot.at)) / 1000))}초` : ''}${game.result ? ` · ${game.result}` : ''}` : '진행 중인 방송 게임 없음';
    }
  }
  function renderViewers() {
    if (!q('avViewers')) return;
    const host = q('avViewers');
    if (!q('avViewerRows')) host.innerHTML = `<div class="av-form"><label>참여자 검색<input type="search" data-filter="viewers" value="${esc(filters.viewers)}"></label><label>정렬<select data-filter="sort">${options({ number: '참여 번호', name: '이름', wins: '승리 횟수' }, filters.sort)}</select></label></div><div class="av-table-scroll"><table class="av-table"><thead><tr><th>참여자</th><th>캐릭터</th><th>승리</th><th>관리</th></tr></thead><tbody id="avViewerRows"></tbody></table></div><p id="avViewerEmpty" class="av-meta"></p><h3>차단 / 시간제 제외</h3><p class="av-meta">차단은 해제 또는 기록 삭제까지 유지 · 일반 프로필은 90일 보관</p><div id="avBlockedRows"></div>`;
    const rows = q('avViewerRows'), active = document.activeElement;
    const existing = new Map([...rows.children].map((row) => [row.dataset.viewerRow, row]));
    const actors = [...state.snapshot.actors].sort((a, b) => filters.sort === 'name' ? a.name.localeCompare(b.name) : filters.sort === 'wins' ? b.wins - a.wins : (a.number || 0) - (b.number || 0));
    let visible = 0;
    const keepOrder = rows.contains(active);
    for (const a of actors) {
      let row = existing.get(a.id);
      if (!row) {
        row = document.createElement('tr'); row.dataset.viewerRow = a.id;
        row.innerHTML = `<td data-cell="name"></td><td data-cell="avatar"></td><td data-cell="wins"></td><td><div class="av-actions">${button('화면에서 퇴장', 'moderate', `data-id="${esc(a.id)}" data-mode="remove"`)}<label class="av-timeout">제외 (분)<input data-timeout type="number" min="1" max="10080" value="10" aria-label="제외 시간 (분)"></label>${button('시간제 제외', 'moderate', `data-id="${esc(a.id)}" data-mode="timeout"`)}${button('차단', 'moderate', `data-id="${esc(a.id)}" data-mode="block"`)}${button('기록 삭제', 'moderate', `data-id="${esc(a.id)}" data-mode="forget"`)}${button('대상 허용', 'moderate', `data-id="${esc(a.id)}" data-mode="targeting" title="개인 대상 상호작용 허용 변경"`)}</div></td>`;
        rows.append(row);
      }
      existing.delete(a.id);
      row.querySelector('[data-cell="name"]').textContent = `#${a.number ?? '?'} ${a.name}`;
      row.querySelector('[data-cell="avatar"]').textContent = state.config.avatars.find((v) => v.id === a.avatar)?.name || a.avatar;
      row.querySelector('[data-cell="wins"]').textContent = a.wins ?? 0;
      const targeting = row.querySelector('[data-mode="targeting"]');
      const allowed = a.targeting !== false && a.allowTargeting !== false;
      targeting.dataset.allowed = String(!allowed);
      targeting.setAttribute('aria-pressed', String(allowed));
      targeting.textContent = allowed ? '대상 허용 중' : '대상 거부 중';
      row.hidden = !`#${a.number} ${a.name}`.toLocaleLowerCase().includes(filters.viewers.toLocaleLowerCase());
      if (!row.hidden) visible++;
      if (!keepOrder) rows.append(row);
    }
    for (const row of existing.values()) row.remove();
    q('avViewerEmpty').textContent = visible ? `${visible}명` : '일치하는 참여자가 없습니다.';
    const blockedHost = q('avBlockedRows'), blockedRows = new Map([...blockedHost.children].map((row) => [row.dataset.blockedRow, row]));
    for (const a of state.blocked || []) {
      let row = blockedRows.get(a.id);
      if (!row) {
        row = document.createElement('div'); row.className = 'av-status'; row.dataset.blockedRow = a.id;
        row.innerHTML = `<span></span>${button('제외 / 차단 해제', 'moderate', `data-id="${esc(a.id)}" data-mode="unblock"`)}${button('기록 삭제', 'moderate', `data-id="${esc(a.id)}" data-mode="forget"`)}`;
        blockedHost.append(row);
      }
      blockedRows.delete(a.id);
      row.querySelector('span').textContent = `${a.name} · ${a.blocked ? '차단' : `${new Date(a.blockedUntil).toLocaleString()}까지 제외`}`;
    }
    for (const row of blockedRows.values()) row.remove();
  }
  const imageCache = new Map();
  function renderClipPreview() {
    cancelAnimationFrame(clipAnimation);
    const canvas = q('avClipCanvas'), sheet = q('avSheetCanvas');
    if (!canvas || !sheet) return;
    const avatar = draft.avatars.find((v) => v.id === selectedAvatar);
    const clip = avatar?.states[clipState] || (clipState === 'run' ? avatar?.states.walk : null) || avatar?.states.idle;
    if (!clip) return;
    const url = assetUrl(clip.asset);
    let image = imageCache.get(url);
    if (!image) {
      image = new Image(); imageCache.set(url, image);
      image.onload = () => renderClipPreview();
      image.onerror = () => { if (q('avClipStatus')) q('avClipStatus').textContent = 'ASSET_LOAD_FAILED · 이미지 로드 실패'; };
      image.src = url;
      if (imageCache.size > 64) imageCache.delete(imageCache.keys().next().value);
    }
    if (!image.complete || !image.naturalWidth) return;
    const columns = Math.max(1, Number(clip.columns) || 1), rows = Math.max(1, Number(clip.rows) || 1);
    const fw = Number(clip.frameWidth) || image.naturalWidth / columns, fh = Number(clip.frameHeight) || image.naturalHeight / rows;
    const start = Math.max(0, Number(clip.startFrame) || 0), end = Math.max(start, Math.min(clip.frames - 1, clip.endFrame ?? clip.frames - 1));
    const paint = (now) => {
      if (!canvas.isConnected) return;
      const tick = Math.floor(Math.max(0, now - clipStarted) / 1000 * Math.max(1, Math.min(60, clip.fps || 12)));
      const finished = clipPlaying && clip.playback !== 'loop' && tick >= end - start + 1;
      if (finished && clip.playback === 'once' && clipState !== 'idle') {
        clipState = 'idle'; clipStarted = now;
        const picker = root.querySelector('[data-clip-view="state"]'); if (picker) picker.value = 'idle';
        renderClipPreview(); return;
      }
      const frame = clipPlaying ? start + (clip.playback === 'once' || clip.playback === 'hold' ? Math.min(tick, end - start) : tick % (end - start + 1)) : Math.min(end, Math.max(start, clipFrame));
      clipFrame = frame;
      const sx = frame % columns * fw, sy = Math.floor(frame / columns) * fh;
      const ctx = canvas.getContext('2d'), sc = sheet.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#aab7b4'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, 220); ctx.lineTo(800, 220); ctx.moveTo(400, 0); ctx.lineTo(400, 280); ctx.stroke();
      const height = 110 * (Number(clip.scale) || 1), width = (clip.preserveAspect === false ? 1 : fw / fh) * height;
      const direction = clip.direction === 'left' ? -1 : 1;
      ctx.save(); ctx.translate(400 + Number(clip.offsetX || 0), 220 + Number(clip.offsetY || 0)); ctx.scale(direction, 1); ctx.imageSmoothingEnabled = !avatar.pixelated;
      ctx.drawImage(image, sx, sy, fw, fh, -width * (clip.anchorX ?? 0.5), -height * (clip.anchorY ?? 1), width, height); ctx.restore();
      ctx.fillStyle = '#a12836'; ctx.fillRect(397, 217, 6, 6);
      const scale = Math.min(sheet.width / image.naturalWidth, sheet.height / image.naturalHeight);
      sc.clearRect(0, 0, sheet.width, sheet.height); sc.imageSmoothingEnabled = !avatar.pixelated;
      sc.drawImage(image, 0, 0, image.naturalWidth * scale, image.naturalHeight * scale);
      sc.strokeStyle = '#a12836'; sc.lineWidth = 2; sc.strokeRect(sx * scale, sy * scale, fw * scale, fh * scale);
      q('avClipFrame').max = Math.max(0, clip.frames - 1);
      if (document.activeElement !== q('avClipFrame')) q('avClipFrame').value = frame;
      q('avClipStatus').textContent = `${frame + 1}/${clip.frames} · ${Math.round(fw)}×${Math.round(fh)} · ${clip.fps} FPS${avatar.states[clipState] ? '' : clipState === 'run' && avatar.states.walk ? ' · 걷기 이미지 대체' : ' · 기본 이미지 대체'}`;
      sheet.onclick = (event) => {
        if (busy) return;
        const rect = sheet.getBoundingClientRect();
        const x = (event.clientX - rect.left) * sheet.width / rect.width / scale;
        const y = (event.clientY - rect.top) * sheet.height / rect.height / scale;
        const selected = Math.floor(y / fh) * columns + Math.floor(x / fw);
        if (x < image.naturalWidth && y < image.naturalHeight && selected < clip.frames) { clipFrame = selected; clipPlaying = false; renderClipPreview(); }
      };
      if (clipPlaying && !finished) clipAnimation = requestAnimationFrame(paint);
    };
    paint(performance.now());
  }
  function filterLists() {
    for (const node of root.querySelectorAll('[data-avatar], [data-rule]')) {
      const item = node.dataset.avatar ? draft.avatars.find((v) => v.id === node.dataset.avatar) : draft.rules.find((v) => v.id === node.dataset.rule);
      if (!item) continue;
      const rule = Boolean(node.dataset.rule);
      const text = `${item.name} ${(item.aliases || []).join(' ')} ${item.author || ''}`.toLocaleLowerCase();
      node.hidden = !text.includes(filters[rule ? 'rules' : 'avatars'].toLocaleLowerCase()) || (rule && filters.enabled !== '' && String(item.enabled) !== filters.enabled) || (rule && filters.trigger && item.trigger !== filters.trigger);
    }
  }
  function timingSummary(rule) {
    let total = 0, group = 0;
    for (const [index, step] of rule.steps.entries()) {
      if (index && step.start !== 'withPrevious') { total += group; group = 0; }
      group = Math.max(group, Number(step.duration) || 0);
    }
    return Math.round((total + group) * 10) / 10;
  }
  function enhanceBody() {
    const body = q('avBody'), editor = body.querySelector('.av-editor'), list = body.querySelector('.av-list');
    if (list) {
      list.insertAdjacentHTML('afterbegin', `<label class="av-search">${tab === 'avatars' ? '캐릭터' : '반응'} 검색<input type="search" data-filter="${tab}" value="${esc(filters[tab])}"></label>${tab === 'rules' ? `<label>활성 상태<select data-filter="enabled">${options({ '': '전체', true: '사용', false: '꺼짐' }, filters.enabled)}</select></label><label>발생 조건<select data-filter="trigger">${options({ '': '전체', ...triggers }, filters.trigger)}</select></label>` : ''}`);
      filterLists();
    }
    if (tab === 'avatars') {
      const a = draft.avatars.find((v) => v.id === selectedAvatar);
      editor.insertAdjacentHTML('afterbegin', `<div class="av-actions">${icon('⧉', '캐릭터 복제', 'duplicate-avatar')}${icon('↑', '캐릭터 위로', 'avatar-up')}${icon('↓', '캐릭터 아래로', 'avatar-down')}${button('보관 이미지로 추가', 'reuse-image', 'data-state="new"')}</div>`);
      editor.querySelector('.av-form').insertAdjacentHTML('beforeend', `${field('보폭 (px)', 'avatar.stride', a.stride ?? 50, 'number', 'min="10" max="200" step="any"')}${field('제작자', 'avatar.author', a.author || '', 'text', 'maxlength="80"')}${field('출처', 'avatar.source', a.source || '', 'text', 'maxlength="300"')}${field('라이선스', 'avatar.license', a.license || '', 'text', 'maxlength="80"')}${check('재배포 허용 확인', 'avatar.redistributable', a.redistributable)}`);
      for (const [index, [key]] of Object.entries(states).entries()) {
        const section = editor.querySelectorAll('.av-state')[index], clip = a.states[key];
        section.querySelector('.av-state-head').insertAdjacentHTML('beforeend', button('보관 이미지', 'reuse-image', `data-state="${key}"`) + icon('▷', `${states[key]} 상태 미리보기`, 'clip-state', `data-state="${key}"`));
        if (!clip) continue;
        const sheet = section.querySelector('.av-sheet');
        for (const name of ['columns', 'rows']) sheet.querySelector(`[data-field="clip.${key}.${name}"]`).max = 32;
        sheet.querySelector(`[data-field="clip.${key}.frames"]`).max = (clip.columns || 1) * (clip.rows || 1);
        sheet.querySelector(`[data-field="clip.${key}.fps"]`).max = 60;
        sheet.querySelector(`[data-field="clip.${key}.fps"]`).step = 'any';
        sheet.insertAdjacentHTML('beforeend', [
          ['frameWidth', '프레임 너비 (0=자동)', 0, 2048, 0], ['frameHeight', '프레임 높이 (0=자동)', 0, 2048, 0],
          ['anchorX', '가로 피벗', 0, 1, 0.5], ['anchorY', '세로 피벗', 0, 1, 1],
          ['offsetX', '가로 보정 (px)', -200, 200, 0], ['offsetY', '세로 보정 (px)', -200, 200, 0], ['scale', '상태 배율', 0.25, 4, 1],
          ['startFrame', '시작 프레임 (0부터)', 0, clip.frames - 1, 0], ['endFrame', '종료 프레임', 0, clip.frames - 1, clip.frames - 1],
        ].map(([name, label, min, max, fallback]) => field(label, `clip.${key}.${name}`, clip[name] ?? fallback, 'number', `min="${min}" max="${max}" step="${name.endsWith('Frame') ? '1' : 'any'}"`)).join('') + select('원본 방향', `clip.${key}.direction`, { right: '오른쪽', left: '왼쪽' }, clip.direction || 'right') + select('재생', `clip.${key}.playback`, { loop: '반복', once: '한 번', hold: '마지막 프레임 유지' }, clip.playback || 'loop') + check('원본 비율 유지', `clip.${key}.preserveAspect`, clip.preserveAspect ?? draft.version >= 3));
      }
      editor.insertAdjacentHTML('afterbegin', `<section class="av-clip-preview"><div class="av-actions"><label>상태<select data-clip-view="state">${options(states, clipState)}</select></label>${icon('▷', '재생 / 정지', 'clip-play')}<label>프레임<input type="range" id="avClipFrame" data-clip-view="frame" min="0" max="${Math.max(0, (a.states[clipState] || a.states.idle).frames - 1)}" value="${clipFrame}"></label><output id="avClipStatus"></output></div><canvas id="avClipCanvas" width="800" height="280" aria-label="고정된 발 피벗 기준 상태 미리보기"></canvas><canvas id="avSheetCanvas" width="800" height="140" aria-label="전체 시트와 선택 프레임"></canvas></section>`);
      renderClipPreview();
    } else if (tab === 'scene') {
      editor.querySelector('.av-form').insertAdjacentHTML('beforeend', `${check('신규 참여 허용', 'newJoins', draft.newJoins !== false)}${check('방송 출력 숨김', 'outputHidden', draft.outputHidden)}${select('정원 초과 정책', 'admission', { reject: '신규 입장 거부', replaceIdle: '오래 쉰 참여자 교체', queue: '입장 대기열' }, draft.admission || 'reject')}${select('이름표 표시 정책', 'namesMode', { always: '항상', recent: '최근 반응 참여자' }, draft.namesMode || 'always')}${[
        ['safeLeft', '왼쪽 안전 여백 (px)', 0, 600, 0], ['safeRight', '오른쪽 안전 여백 (px)', 0, 600, 0], ['safeTop', '위쪽 안전 여백 (px)', 0, 500, 0],
        ['nameSize', '이름표 글자 크기', 10, 40, 20], ['nameLimit', '이름표 최대 개수', 0, 150, 150], ['bubbleLimit', '말풍선 최대 개수', 0, 30, 10], ['gameBottom', '게임 표시 하단 여백 (px)', 0, 900, 245],
      ].map(([key, label, min, max, fallback]) => field(label, key, draft[key] ?? fallback, 'number', `min="${min}" max="${max}" step="${['nameLimit', 'bubbleLimit'].includes(key) ? 1 : 'any'}"`)).join('')}`);
    } else if (tab === 'rules') {
      const r = draft.rules.find((v) => v.id === selectedRule);
      list.insertAdjacentHTML('beforeend', `${button('편집 명령 복사', 'copy-draft-commands')}<label>반응 템플릿<select id="avTemplate">${options(Object.fromEntries((state.templates || []).map((v) => [v.id, v.name])), state.templates?.[0]?.id)}</select></label>${button('템플릿 복제', 'add-template')}`);
      list.querySelector('[data-av="copy-commands"]').textContent = '저장 명령 복사';
      if (!r) return;
      const old = editor.querySelector('[data-field="rule.durationFromChat"]');
      old?.closest('label').remove();
      const form = editor.querySelector('.av-form');
      form.insertAdjacentHTML('beforeend', `${select('시간 입력 방식', 'rule.durationMode', { fixed: '고정 시간', step: '채팅 숫자 → 지정 단계', legacyAllSteps: '기존 방식: 모든 단계' }, r.durationMode || (r.durationFromChat ? 'legacyAllSteps' : 'fixed'))}${select('시간을 적용할 단계', 'rule.durationStep', Object.fromEntries(r.steps.map((s, i) => [i, `${i + 1}. ${actions[s.action]}`])), r.durationStep || 0)}${select('새 반응 중단 정책', 'rule.interrupt', { replace: '즉시 교체', queue: '현재 반응 뒤 대기', parallel: '다른 영역에 겹쳐 실행' }, r.interrupt || 'replace')}${select('실패 시', 'rule.failure', { stop: '반응 종료', skip: '다음 단계로' }, r.failure || 'stop')}${field('반응 전체 상한 (초)', 'rule.maxDuration', r.maxDuration ?? (draft.version < 3 ? 960 : 120), 'number', 'min="0.1" max="960" step="any"')}`);
      form.querySelector('[data-field="rule.durationStep"]').disabled = (r.durationMode || (r.durationFromChat ? 'legacyAllSteps' : 'fixed')) !== 'step';
      for (const [i, step] of r.steps.entries()) {
        const node = editor.querySelectorAll('.av-step')[i];
        node.querySelector(`[data-field="step.${i}.duration"]`).parentElement.firstChild.textContent = ['landing', 'arrival'].includes(step.completion) ? '최대 대기 (초)' : step.action === 'float' ? '부양 전체 시간 (초)' : '단계 시간 (초)';
        const completion = { duration: '설정 시간', ...(step.action === 'jump' ? { landing: '착지' } : {}), ...(['gather', 'follow', 'push', 'highfive'].includes(step.action) ? { arrival: '도착 / 접촉' } : {}) };
        node.insertAdjacentHTML('beforeend', `${select('시작', `step.${i}.start`, { after: '앞 단계 뒤', withPrevious: '앞 단계와 함께' }, step.start || 'after')}${select('완료 조건', `step.${i}.completion`, completion, step.completion || 'duration')}${step.action === 'size' ? select('크기 적용', `step.${i}.sizeMode`, { permanent: '개인 기본 크기 변경', temporary: '유지 후 원래 크기' }, step.sizeMode || 'permanent') : ''}${step.action === 'wait' ? select('대기 중', `step.${i}.waitMode`, { stop: '제자리 정지', continue: '현재 동작 유지' }, step.waitMode || 'stop') : ''}${step.action === 'jump' ? field('점프 강도', `step.${i}.jumpStrength`, step.jumpStrength ?? 12, 'number', 'min="4" max="20" step="any"') : ''}${step.action === 'float' ? `${field('상승 비율 (%)', `step.${i}.risePercent`, step.risePercent ?? 25, 'number', 'min="0" max="45" step="any"')}${field('하강 비율 (%)', `step.${i}.fallPercent`, step.fallPercent ?? 25, 'number', 'min="0" max="45" step="any"')}` : ''}`);
        node.querySelector('.av-actions').insertAdjacentHTML('beforeend', icon('↓', '동작 아래로 이동', 'step-down', `data-step="${i}"`));
      }
      editor.insertAdjacentHTML('beforeend', `<div class="av-actions">${icon('⧉', '반응 복제', 'duplicate-rule')}${icon('↓', '반응 우선순위 내리기', 'rule-down')}</div><div id="avRuleSummary" class="av-summary"></div><ul id="avRuleWarnings" class="av-warnings"></ul>${r.templateId ? `<p class="av-meta">템플릿 ${esc(r.templateId)} v${esc(r.templateVersion)}</p>` : ''}`);
      editor.querySelector('.av-section-head h3').textContent = '동작 단계';
    } else if (tab === 'games') {
      const settings = { ...gameDefaults, ...draft.gameSettings };
      editor.insertAdjacentHTML('afterbegin', `<div class="av-form">${[
        ['recruitSeconds', '모집 (초)', 0, 60], ['countdownSeconds', '카운트다운 (초)', 0, 10], ['duration', '게임 진행 (초)', 10, 120], ['resultSeconds', '결과 표시 (초)', 1, 30], ['goal', '응원 목표 (0=자동)', 0, 10000], ['boosts', '1인당 부스트 횟수', 0, 5],
      ].map(([key, label, min, max]) => field(label, `gameSettings.${key}`, settings[key], 'number', `min="${min}" max="${max}" step="${['goal', 'boosts'].includes(key) ? 1 : 'any'}"`)).join('')}${select('중도 이탈 시 목표', 'gameSettings.departures', { keep: '목표 유지', reduce: '참가 인원에 맞춰 감소' }, settings.departures)}</div><p id="avGameStatus" class="av-meta"></p><p class="av-meta">달리기: 난수 기반 관전 · 모집 중 !참가 · 부스트 ${esc(settings.boosts)}회/인</p><div id="avGameWarnings" class="av-warnings"></div>`);
      const form = q('avTestForm');
      form.insertAdjacentHTML('afterbegin', `<label>리허설 사용자 ID<input data-test-field="userId" value="${esc(testInput.userId)}" maxlength="128" required></label><label>리허설 설정<select data-test-option="source">${options({ draft: '편집 중 설정', saved: '저장된 설정' }, testOptions.source)}</select></label>`);
      form.querySelector('[type="submit"]').textContent = '채팅 리허설 전송';
      editor.querySelector('.av-test-heading').textContent = '독립 테스트';
      editor.insertAdjacentHTML('beforeend', `<div class="av-form"><label>미리보기 사용자 ID<input data-test-option="actorId" value="${esc(testOptions.actorId)}" placeholder="${esc(testInput.userId)}" maxlength="128"></label><label>미리보기 대상<select id="avPreviewTarget" data-test-option="targetName">${options({ '': '대상 없음', ...Object.fromEntries((state.preview?.snapshot?.actors || []).map((a) => [`#${a.number}`, `#${a.number} ${a.name}`])) }, testOptions.targetName)}</select></label></div><div class="av-actions">${button('입력 동작 미리보기', 'preview-input')}${button('리허설 초기화', 'rehearsal-reset')}${button('리허설 일시정지 / 재개', 'rehearsal-pause')}</div><output id="avResult" class="av-summary"></output><h3>판정 진단</h3><ul id="avDiagnostics" class="av-log"></ul>`);
      renderRecent();
    } else if (tab === 'storage') {
      editor.insertAdjacentHTML('beforeend', `<div class="av-actions">${button('저장 후 백업', 'save-backup')}${button('편집 이력 비우기', 'clear-history')}${button('진단 내보내기', 'export-diagnostics')}</div><p class="av-meta">편집 이력 ${history.undo.length + history.redo.length}/50 · 복구 ${api.avatarDraft ? '사용 가능' : 'API 미지원'}</p><ul id="avDiagnostics" class="av-log"></ul>`);
      renderRecent();
    }
  }
  function validateFields(throwOnError = false) {
    const errors = [];
    const numeric = (object, key, min, max, integer = false) => {
      if (object[key] === undefined) return;
      const value = object[key];
      if (value === '' || !Number.isFinite(Number(value)) || value < min || value > max || (integer && !Number.isInteger(Number(value)))) errors.push(`${key}: ${min}~${max}${integer ? ' 정수' : ''} 범위를 확인하세요.`);
    };
    for (const [key, min, max, integer] of [['port', 1024, 65535, true], ['size', 24, 160], ['speed', 0.2, 4], ['maxActors', 1, 150, true], ['idleMinutes', 1, 120], ['floor', 0, 300], ['safeLeft', 0, 600], ['safeRight', 0, 600], ['safeTop', 0, 500], ['nameSize', 10, 40], ['nameLimit', 0, 150, true], ['bubbleLimit', 0, 30, true], ['gameBottom', 0, 900]]) numeric(draft, key, min, max, integer);
    for (const [key, min, max, integer] of [['duration', 10, 120], ['recruitSeconds', 0, 60], ['countdownSeconds', 0, 10], ['resultSeconds', 1, 30], ['goal', 0, 10000, true], ['boosts', 0, 5, true]]) numeric(draft.gameSettings || {}, key, min, max, integer);
    for (const input of root.querySelectorAll('[data-field]')) {
      const previous = input.parentElement.querySelector('.av-field-error');
      previous?.remove();
      input.removeAttribute('aria-invalid');
      let message = '';
      if (input.type === 'number' && (input.value === '' || !input.validity.valid)) message = `${input.min || 0}~${input.max || '상한 없음'} 범위의 ${input.step === '1' || !input.step ? '정수' : '숫자'}를 입력하세요.`;
      if (message) {
        input.setAttribute('aria-invalid', 'true');
        const note = document.createElement('small'); note.className = 'av-field-error'; note.textContent = message; input.parentElement.append(note);
        errors.push(message);
      }
    }
    const names = new Set(), aliases = new Set(reservedAliases);
    for (const a of draft.avatars) {
      numeric(a, 'stride', 10, 200);
      const name = a.name.trim().toLowerCase();
      if (!name || names.has(name)) errors.push('캐릭터 이름이 비어 있거나 중복됩니다.');
      names.add(name);
      for (const clip of Object.values(a.states)) {
        for (const [key, min, max, integer] of [['columns', 1, 32, true], ['rows', 1, 32, true], ['frames', 1, clip.columns * clip.rows, true], ['fps', 1, 60], ['frameWidth', 0, 2048], ['frameHeight', 0, 2048], ['anchorX', 0, 1], ['anchorY', 0, 1], ['offsetX', -200, 200], ['offsetY', -200, 200], ['scale', 0.25, 4], ['startFrame', 0, clip.frames - 1, true], ['endFrame', 0, clip.frames - 1, true]]) numeric(clip, key, min, max, integer);
        if (clip.frames > clip.columns * clip.rows || (clip.startFrame ?? 0) > (clip.endFrame ?? clip.frames - 1) || (clip.endFrame ?? clip.frames - 1) >= clip.frames) errors.push(`${a.name}: 프레임 범위가 잘못되었습니다.`);
      }
    }
    for (const rule of draft.rules) {
      numeric(rule, 'cooldown', 1, 600); numeric(rule, 'minimum', 0, 1e9); numeric(rule, 'maxDuration', 0.1, 960); numeric(rule, 'durationStep', 0, rule.steps.length - 1, true);
      if (rule.trigger === 'command' && (rule.aliases.length < 1 || rule.aliases.length > 8)) errors.push('명령 별칭은 1~8개입니다.');
      if (rule.trigger === 'command') for (const alias of rule.aliases) {
        const key = alias.toLowerCase();
        if (!/^![^\s]{1,31}$/u.test(alias) || aliases.has(key)) errors.push(`중복 또는 잘못된 명령어: ${alias}`);
        aliases.add(key);
      }
      if (rule.durationMode === 'step' && (rule.durationStep < 0 || rule.durationStep >= rule.steps.length)) errors.push(`${rule.name}: 시간 적용 단계 오류`);
      for (const step of rule.steps) if (step.duration === '' || !Number.isFinite(Number(step.duration)) || step.duration < 0.1 || step.duration > 120) errors.push(`${rule.name}: 동작 시간은 0.1~120초입니다.`);
      for (const step of rule.steps) {
        numeric(step, 'jumpStrength', 4, 20); numeric(step, 'risePercent', 0, 45); numeric(step, 'fallPercent', 0, 45);
        if (step.action === 'run') numeric(step, 'value', 1.5, 6);
        if (step.action === 'float') numeric(step, 'value', 30, 500);
        if (step.action === 'size') numeric(step, 'value', 0.5, 1.6);
      }
    }
    const rule = draft.rules.find((r) => r.id === selectedRule);
    if (rule && q('avRuleSummary')) {
      const total = timingSummary(rule);
      q('avRuleSummary').textContent = `설정 시간 ${total}초 · 전체 상한 ${rule.maxDuration ?? 120}초 · 착지·도착 조건은 실제 완료 시점에 따름`;
      const warnings = [...errors];
      if (total > (rule.maxDuration ?? 120)) warnings.push('설정 시간보다 전체 상한이 짧아 반응이 중단될 수 있습니다.');
      if (rule.durationMode === 'legacyAllSteps' || (!rule.durationMode && rule.durationFromChat)) warnings.push(`기존 호환 방식: 채팅 숫자가 ${rule.steps.length}개 단계 모두에 적용됩니다.`);
      if (!state.commandsKnown) warnings.push('웹 명령 충돌 확인 안 됨');
      const known = new Set((state.commandAliases || []).map((v) => String(v).toLowerCase()));
      for (const alias of rule.aliases) if (known.has(alias.toLowerCase())) warnings.push(`웹 명령과 겹침: ${alias}`);
      if (rule.steps.some((s) => ['follow', 'push', 'highfive'].includes(s.action)) && !draft.allowTargeting) warnings.push('장면의 대상 상호작용이 꺼져 있습니다.');
      for (let i = 1; i < rule.steps.length; i++) if (rule.steps[i].start === 'withPrevious') {
        const lane = (action) => ['say', 'size'].includes(action) ? action : ['dance', 'wave', 'sit'].includes(action) ? 'pose' : 'motion';
        for (let j = i - 1; j >= 0; j--) {
          if (lane(rule.steps[j].action) === lane(rule.steps[i].action)) { warnings.push(`LANE_CONFLICT: 동작 ${j + 1}과 ${i + 1}의 동시 실행 영역이 같습니다.`); break; }
          if (rule.steps[j].start !== 'withPrevious') break;
        }
      }
      q('avRuleWarnings').innerHTML = [...new Set(warnings)].map((v) => `<li>${esc(v)}</li>`).join('');
    }
    if (q('avGameWarnings')) {
      const settings = { ...gameDefaults, ...draft.gameSettings }, count = state.snapshot.actors.length;
      q('avGameWarnings').textContent = settings.goal > count * Math.ceil(settings.duration) ? `목표 ${settings.goal}: 현재 ${count}명 기준 초당 1회 응원 상한으로도 달성 불가 (모집 인원에 따라 달라짐)` : '';
    }
    if (throwOnError && errors.length) throw new Error([...new Set(errors)].join(' '));
    return errors;
  }
  async function editorCommand(command, target, avatar, rule) {
    if (command === 'undo' || command === 'redo') { historyMove(command); return true; }
    if (command === 'view-rehearsal') { previewMode = 'rehearsal'; updateStatus(); renderRecent(); return true; }
    if (command === 'recover') {
      if (!recovery) return true;
      if (dirty && !confirm('현재 편집을 복구 초안으로 교체할까요?')) return true;
      const recovered = recovery.config || recovery;
      if (!Array.isArray(recovered.avatars) || !Array.isArray(recovered.rules) || recovered.version > 3) throw new Error('초안 형식 또는 버전을 확인해 주세요.');
      checkpoint();
      draft = structuredClone(recovered);
      selectedAvatar = recovery.selectedAvatar || draft.defaultAvatar;
      selectedRule = recovery.selectedRule || draft.rules[0]?.id;
      recovery = null;
      changed(); shell(); notice('초안을 복구했습니다. 방송에는 적용되지 않았습니다.');
      return true;
    }
    if (command === 'discard-recovery') {
      if (!confirm('보관 중인 복구 초안을 삭제할까요? 현재 편집은 유지됩니다.')) return true;
      clearTimeout(draftTimer);
      await draftWrites.catch(() => {});
      await api.avatarDraft('discard');
      recovery = null;
      q('avRecovery').hidden = true;
      if (dirty) await persistDraft();
      return true;
    }
    if (command === 'clear-history') {
      if (!confirm('실행 취소와 다시 실행 이력을 비울까요? 현재 편집은 유지됩니다.')) return true;
      history.undo.length = 0; history.redo.length = 0; editGroup = '';
      await persistDraft(); updateStatus(); renderBody(); return true;
    }
    if (command === 'backup' || command === 'save-backup' || command === 'restore') {
      let keep = false;
      if (command === 'save-backup') await save();
      if (command === 'restore' && dirty) {
        const choice = await choose('복원 후 현재 편집을 어떻게 할까요?', [['keep', '현재 초안을 유지'], ['discard', '복원 성공 후 초안 교체']]);
        if (choice === 'cancel') return true;
        keep = choice === 'keep';
        if (keep) {
          if (!api.avatarDraft || recovery) throw new Error('보관 중인 초안을 먼저 복구하거나 삭제해 주세요.');
          await persistDraft();
        }
      }
      const next = await api.avatarBackup(command === 'restore');
      if (!next) return true;
      state = next;
      if (command === 'restore') {
        savedDraft = JSON.stringify(state.config);
        if (!keep) {
          checkpoint(); draft = structuredClone(state.config);
        }
        changed(); renderBody();
      }
      updateStatus();
      notice(command === 'restore' ? `복원했습니다.${keep ? ' 편집 초안은 유지됩니다.' : ''}` : '저장된 설정을 백업했습니다. 편집 초안은 유지됩니다.');
      return true;
    }
    if (command === 'copy-draft-commands') {
      validateFields(true); await api.avatarCopy('commands-draft', { config: structuredClone(draft) }); notice('미적용 표시를 포함한 편집 명령을 복사했습니다.'); return true;
    }
    if (command === 'export-diagnostics') {
      if (!api.avatarDiagnostics) throw new Error('진단 내보내기 API가 없습니다.');
      const result = await api.avatarDiagnostics();
      if (result) notice('개인정보를 제외한 진단을 내보냈습니다.');
      return true;
    }
    if (command === 'duplicate-avatar' || command === 'duplicate-rule' || command === 'add-template') {
      const isAvatar = command === 'duplicate-avatar', items = isAvatar ? draft.avatars : draft.rules;
      if (items.length >= 64) throw new Error('최대 64개입니다.');
      const source = command === 'add-template' ? state.templates?.find((v) => v.id === q('avTemplate').value) : isAvatar ? avatar : rule;
      if (!source) throw new Error('복제할 항목을 선택해 주세요.');
      const clone = structuredClone(source);
      clone.id = crypto.randomUUID(); clone.name = uniqueName(clone.name, items, isAvatar ? 32 : 48);
      if (!isAvatar) clone.aliases = uniqueAliases(clone.aliases || []);
      checkpoint(); items.push(clone);
      if (isAvatar) selectedAvatar = clone.id; else selectedRule = clone.id;
      changed(); renderBody(); return true;
    }
    if (['avatar-up', 'avatar-down', 'rule-up', 'rule-down', 'step-down'].includes(command)) {
      const items = command.startsWith('avatar') ? draft.avatars : command.startsWith('rule') ? draft.rules : rule.steps;
      const index = command === 'step-down' ? Number(target.dataset.step) : items.indexOf(command.startsWith('avatar') ? avatar : rule);
      const next = index + (command.endsWith('up') ? -1 : 1);
      if (next < 0 || next >= items.length) return true;
      checkpoint(); [items[index], items[next]] = [items[next], items[index]];
      if (command === 'step-down') {
        if (rule.durationStep === index) rule.durationStep = next;
        else if (rule.durationStep === next) rule.durationStep = index;
      }
      changed(); renderBody(); return true;
    }
    if (command === 'reuse-image') {
      if (target.dataset.state === 'new' && draft.avatars.length >= 64) throw new Error('캐릭터는 최대 64개입니다.');
      const assets = [...new Map([...(state.assets || []), ...(state.catalog || [])].map((v) => [v.asset || v.name, v])).values()];
      const choices = assets.map((asset, i) => [String(i), asset.label || asset.originalName || `${i + 1}. ${(asset.asset || asset.name).slice(0, 12)}`]);
      const choice = await choose('보관 이미지 선택', choices, (value, label) => `<img class="av-asset-choice" src="${esc(assetUrl(assets[Number(value)].asset || assets[Number(value)].name))}" alt=""><span>${esc(label)}</span>`);
      if (choice === 'cancel') return true;
      const asset = assets[Number(choice)];
      if (!asset) return true;
      const clip = { asset: asset.asset || asset.name, columns: 1, rows: 1, frames: 1, fps: 12, frameWidth: 0, frameHeight: 0, anchorX: 0.5, anchorY: 1, offsetX: 0, offsetY: 0, scale: 1, direction: 'right', preserveAspect: true, playback: 'loop', startFrame: 0, endFrame: 0 };
      checkpoint();
      if (target.dataset.state === 'new') {
        const next = { id: crypto.randomUUID(), name: uniqueName('캐릭터', draft.avatars), pixelated: false, stride: 50, author: '', source: '', license: '', redistributable: false, states: { idle: clip } };
        draft.avatars.push(next); selectedAvatar = next.id;
      } else avatar.states[target.dataset.state] = clip;
      changed(); renderBody(); return true;
    }
    if (command === 'clip-state' || command === 'clip-play') {
      if (command === 'clip-state') { clipState = target.dataset.state; clipFrame = 0; clipPlaying = true; }
      else clipPlaying = !clipPlaying;
      clipStarted = performance.now(); renderBody(); return true;
    }
    if (command === 'preview-input') { await test({}); return true; }
    if (['test-pause', 'test-reset', 'rehearsal-reset', 'rehearsal-pause', 'preview-step'].includes(command)) {
      const rehearsal = command.startsWith('rehearsal') || previewMode === 'rehearsal';
      const action = command === 'test-pause' ? rehearsal ? 'rehearsal-pause' : 'preview-pause' : command === 'test-reset' ? rehearsal ? 'rehearsal-reset' : 'clear-tests' : command;
      state = await api.avatarCommand(action, { ...(testOptions.source === 'saved' ? { source: 'saved' } : { config: structuredClone(draft) }), milliseconds: 100 });
      previewMode = rehearsal ? 'rehearsal' : true; updateStatus(); renderRecent(); return true;
    }
    if (['race', 'cheer', 'preview-race', 'preview-cheer'].includes(command)) {
      validateFields(true);
      const preview = command.startsWith('preview-'), settings = { ...gameDefaults, ...draft.gameSettings };
      if (!preview && !confirm(`방송에서 ${command === 'race' ? '달리기' : '공동 응원'} 게임을 시작할까요?`)) return true;
      state = await api.avatarCommand(preview ? 'preview-game' : 'game', { type: command.replace('preview-', ''), duration: settings.duration, options: settings, ...(preview ? { config: structuredClone(draft) } : {}) });
      if (preview) previewMode = true;
      updateStatus(); renderRecent(); return true;
    }
    if (command === 'prune') {
      if (dirty || recovery || history.undo.length || history.redo.length) throw new Error('초안을 저장하고 복구 초안과 편집 이력을 먼저 정리해 주세요.');
      await persistDraft();
    }
    if (command === 'moderate') {
      const action = target.dataset.mode, row = target.closest('[data-viewer-row]');
      if (['forget', 'block'].includes(action) && !confirm(action === 'forget' ? '선택한 시청자의 기록을 삭제할까요?' : '해제할 때까지 참여를 차단할까요?')) return true;
      const minutes = Number(row?.querySelector('[data-timeout]')?.value || 10);
      if (action === 'timeout' && (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080)) throw new Error('제외 시간은 1~10080분입니다.');
      state = await api.avatarCommand('moderate', { id: target.dataset.id, action, minutes, options: { minutes, allowed: target.dataset.allowed === 'true' } });
      updateStatus(); renderViewers(); return true;
    }
    return false;
  }
  async function save() {
    validateFields(true);
    state = await api.avatarSave({ ...structuredClone(draft), enabled: state.config.enabled, paused: state.config.paused });
    draft = structuredClone(state.config);
    savedDraft = JSON.stringify(draft);
    dirty = false;
    q('avDirty').textContent = '';
    updateStatus();
    notice('저장했습니다.');
    await persistDraft();
  }
  function updateField(event) {
    if (event.target.dataset.monitor) {
      monitorOptions[event.target.dataset.monitor] = event.target.value;
      updateStatus(); return;
    }
    if (event.target.dataset.filter) {
      filters[event.target.dataset.filter] = event.target.value;
      if (tab === 'viewers') renderViewers(); else filterLists();
      return;
    }
    if (event.target.dataset.testOption) {
      testOptions[event.target.dataset.testOption] = event.target.value;
      return;
    }
    if (event.target.dataset.clipView) {
      if (event.target.dataset.clipView === 'state') clipState = event.target.value;
      else if (event.target.dataset.clipView === 'frame') { clipFrame = Number(event.target.value); clipPlaying = false; }
      clipStarted = performance.now();
      renderClipPreview();
      return;
    }
    if (event.target.dataset.testField) {
      testInput[event.target.dataset.testField] = event.target.value;
      return;
    }
    const key = event.target.dataset.field;
    if (!key || !draft || busy) return;
    checkpoint(key);
    const value =
      event.target.type === 'checkbox'
        ? event.target.checked
        : event.target.type === 'number'
          ? event.target.value === ''
            ? ''
            : Number(event.target.value)
          : event.target.value;
    const parts = key.split('.'),
      a = draft.avatars.find((a) => a.id === selectedAvatar),
      r = draft.rules.find((r) => r.id === selectedRule);
    if (parts[0] === 'avatar') a[parts[1]] = value;
    else if (parts[0] === 'clip') {
      const clip = a.states[parts[1]];
      clip[parts[2]] = value;
      for (const [property, maximum] of [['frames', clip.columns * clip.rows], ['startFrame', clip.frames - 1], ['endFrame', clip.frames - 1]]) {
        const input = root.querySelector(`[data-field="clip.${parts[1]}.${property}"]`);
        if (input) input.max = Math.max(property === 'frames' ? 1 : 0, maximum);
      }
    }
    else if (parts[0] === 'rule') {
      r[parts[1]] = parts[1] === 'aliases' ? value.trim().split(/\s+/) : value;
      if (parts[1] === 'durationStep') r.durationStep = Number(value);
      if (parts[1] === 'durationMode') r.durationFromChat = value !== 'fixed';
      if (parts[1] === 'trigger' && value !== 'command') { r.durationMode = 'fixed'; r.durationFromChat = false; }
      if (parts[1] === 'trigger' && value === 'chat' && newRuleIds.has(r.id)) r.interrupt = 'parallel';
    }
    else if (parts[0] === 'step') {
      const step = r.steps[Number(parts[1])];
      step[parts[2]] = value;
      if (parts[2] === 'action') {
        step.value =
          { run: '3', float: '160', walk: '1', size: '1' }[value] || '';
        step.completion = 'duration';
      }
    } else if (parts[0] === 'gameSettings') {
      draft.gameSettings = { ...gameDefaults, ...draft.gameSettings, [parts[1]]: value };
    } else draft[key] = value;
    changed();
    if (key.endsWith('.action') || key.endsWith('.completion') || key === 'rule.trigger' || key === 'rule.durationMode') renderBody();
    if (key.startsWith('clip.') || key.startsWith('avatar.')) renderClipPreview();
  }
  root.addEventListener('focusout', () => { editGroup = ''; });
  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    void persistDraft().catch(() => {});
    event.preventDefault();
    event.returnValue = false;
  });
  window.addEventListener('message', (event) => {
    if (event.source !== q('avPreview')?.contentWindow || event.data?.type !== 'arubot:avatar-overlay-diagnostic') return;
    const urls = [state?.url, state?.previewUrl, state?.rehearsalUrl].filter(Boolean);
    if (!urls.some((url) => { try { return new URL(url).origin === event.origin; } catch { return false; } })) return;
    if (typeof event.data.code !== 'string' || !/^[A-Z_]{1,64}$/.test(event.data.code)) return;
    localDiagnostics.unshift({ at: Date.now(), code: event.data.code, source: previewMode || 'live' });
    localDiagnostics.splice(200);
    renderRecent();
  });
  root.addEventListener('input', (event) => {
    if (event.target.tagName !== 'SELECT' && event.target.type !== 'checkbox')
      updateField(event);
  });
  root.addEventListener('change', (event) => {
    if (event.target.tagName === 'SELECT' || event.target.type === 'checkbox')
      updateField(event);
  });
  root.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target || busy || !draft) return;
    if (target.dataset.tab) {
      tab = target.dataset.tab;
      renderBody();
      return;
    }
    if (target.dataset.avatar) {
      selectedAvatar = target.dataset.avatar;
      renderBody();
      return;
    }
    if (target.dataset.rule) {
      selectedRule = target.dataset.rule;
      renderBody();
      return;
    }
    const command = target.dataset.av;
    if (!command) return;
    void run(async () => {
      const a = draft.avatars.find((a) => a.id === selectedAvatar),
        r = draft.rules.find((r) => r.id === selectedRule);
      if (await editorCommand(command, target, a, r)) return;
      if (command === 'view-live' || command === 'view-test') {
        previewMode = command === 'view-test';
        updateStatus();
        renderRecent();
        return;
      }
      if (command === 'test-rule' || command === 'test-avatar') {
        await test(
          command === 'test-rule' ? { ruleId: r.id } : { text: '!입장' },
        );
        return;
      }
      if (command === 'save') {
        await save();
        renderBody();
        return;
      }
      if (command === 'toggle' || command === 'pause') {
        if (command === 'toggle' && !state.config.enabled && dirty) {
          const choice = await choose('미저장 변경이 있습니다.', [['saved', '저장된 설정으로 시작'], ['save', '저장 후 시작']]);
          if (choice === 'cancel') return;
          if (choice === 'save') await save();
        }
        const property = command === 'toggle' ? 'enabled' : 'paused';
        state = await api.avatarSave({
          ...state.config,
          [property]: !state.config[property],
          ...(command === 'toggle' && !state.config.enabled
            ? { paused: false }
            : {}),
        });
        draft.enabled = state.config.enabled;
        draft.paused = state.config.paused;
        const base = JSON.parse(savedDraft);
        base.enabled = draft.enabled;
        base.paused = draft.paused;
        savedDraft = JSON.stringify(base);
        for (const direction of ['undo', 'redo']) history[direction] = history[direction].map((entry) => {
          const value = JSON.parse(entry);
          value.config.enabled = draft.enabled;
          value.config.paused = draft.paused;
          return JSON.stringify(value);
        });
        changed();
        updateStatus();
        return;
      }
      if (command === 'copy' || command === 'copy-commands') {
        await api.avatarCopy(command === 'copy' ? 'url' : 'commands');
        notice('복사했습니다.');
        return;
      }
      if (command === 'add-avatar' || command === 'state-image') {
        if (command === 'add-avatar' && draft.avatars.length >= 64)
          throw new Error('캐릭터는 최대 64개입니다.');
        const result = await api.avatarImport();
        if (!result) return;
        checkpoint();
        const clip = {
          asset: result.asset,
          columns: 1,
          rows: 1,
          frames: 1,
          fps: 12,
          anchorX: 0.5, anchorY: 1, offsetX: 0, offsetY: 0, scale: 1,
          direction: 'right', preserveAspect: true, playback: 'loop', startFrame: 0, endFrame: 0,
          frameWidth: 0, frameHeight: 0,
        };
        if (command === 'add-avatar') {
          let nextName = 1;
          while (draft.avatars.some((v) => v.name === `캐릭터 ${nextName}`))
            nextName++;
          const item = {
            id: crypto.randomUUID(),
            name: `캐릭터 ${nextName}`,
            states: { idle: clip },
          };
          draft.avatars.push(item);
          selectedAvatar = item.id;
        } else a.states[target.dataset.state] = clip;
        changed();
        renderBody();
        return;
      }
      if (command === 'state-clear') {
        if (target.dataset.state === 'idle')
          throw new Error('기본 이미지는 다른 이미지로 교체해 주세요.');
        checkpoint();
        delete a.states[target.dataset.state];
        changed();
        renderBody();
        return;
      }
      if (command === 'delete-avatar') {
        if (draft.avatars.length <= 1)
          throw new Error('캐릭터는 최소 한 개가 필요합니다.');
        if (!confirm(`'${a.name}' 캐릭터를 삭제할까요?`)) return;
        checkpoint();
        draft.avatars = draft.avatars.filter((v) => v !== a);
        if (draft.defaultAvatar === a.id)
          draft.defaultAvatar = draft.avatars[0].id;
        changed();
        renderBody();
        return;
      }
      if (command === 'preset') {
        checkpoint();
        Object.assign(
          draft,
          {
            quiet: { speed: 0.6, size: 64, maxActors: 30, bubbles: false },
            normal: { speed: 1.5, size: 76, maxActors: 60, bubbles: false },
            party: { speed: 2.5, size: 90, maxActors: 100, bubbles: false },
          }[target.dataset.preset],
        );
        changed();
        renderBody();
        return;
      }
      if (command === 'add-rule' || command === 'welcome-rule') {
        if (draft.rules.length >= 64)
          throw new Error('반응은 최대 64개입니다.');
        const welcome = command === 'welcome-rule';
        checkpoint();
        const item = {
          id: crypto.randomUUID(),
          name: welcome ? '입장 환영' : '새 반응',
          enabled: true,
          trigger: welcome ? 'join' : 'command',
          aliases: welcome ? [] : [`!반응${Date.now().toString().slice(-6)}`],
          role: 'everyone',
          cooldown: 3,
          minimum: 0,
          durationFromChat: !welcome,
          durationMode: welcome ? 'fixed' : 'step',
          durationStep: 0,
          interrupt: 'replace',
          maxDuration: 120,
          failure: 'stop',
          steps: welcome
            ? [
                { action: 'wave', value: '', duration: 2 },
                { action: 'say', value: '{user}님, 반가워요!', duration: 3 },
              ]
            : [{ action: 'jump', value: '', duration: 1 }],
        };
        draft.rules.push(item);
        newRuleIds.add(item.id);
        selectedRule = item.id;
        changed();
        renderBody();
        return;
      }
      if (command === 'delete-rule') {
        if (!confirm(`'${r.name}' 반응을 삭제할까요?`)) return;
        checkpoint();
        draft.rules = draft.rules.filter((v) => v !== r);
        changed();
        renderBody();
        return;
      }
      if (command === 'add-step') {
        if (r.steps.length >= 8) throw new Error('동작은 최대 8개입니다.');
        checkpoint();
        r.steps.push({ action: 'wave', value: '', duration: 2, start: 'after', completion: 'duration' });
        changed();
        renderBody();
        return;
      }
      if (command === 'step-delete') {
        if (r.steps.length <= 1)
          throw new Error('동작은 최소 한 개가 필요합니다.');
        checkpoint();
        const index = Number(target.dataset.step);
        r.steps.splice(index, 1);
        r.durationStep = r.durationStep === index ? 0 : r.durationStep > index ? r.durationStep - 1 : r.durationStep || 0;
        changed();
        renderBody();
        return;
      }
      if (command === 'step-up') {
        const i = Number(target.dataset.step);
        if (i > 0) {
          checkpoint();
          [r.steps[i - 1], r.steps[i]] = [r.steps[i], r.steps[i - 1]];
          if (r.durationStep === i) r.durationStep = i - 1;
          else if (r.durationStep === i - 1) r.durationStep = i;
        }
        changed();
        renderBody();
        return;
      }
      if (command === 'test-crowd') {
        for (let i = 1; i <= 10; i++)
          state = await api.avatarCommand('test', {
            name: `테스트 ${i}`,
            text: '!입장',
            config: structuredClone(draft),
            avatarId: draft.avatars[(i - 1) % draft.avatars.length].id,
          });
        previewMode = true;
        updateStatus();
        return;
      }
      if (
        ['clear', 'forget-all', 'prune'].includes(command) &&
        !confirm(
          command === 'forget-all'
            ? '모든 시청자 선택, 차단과 승리 기록을 삭제할까요?'
            : command === 'prune'
              ? '저장된 설정에서 사용하지 않는 이미지를 삭제할까요?'
              : '현재 화면의 모든 참여자를 퇴장시킬까요?',
        )
      )
        return;
      if (command === 'prune' && dirty)
        throw new Error('설정을 먼저 저장해 주세요.');
      if (
        command === 'moderate' &&
        target.dataset.mode === 'forget' &&
        !confirm('선택한 시청자의 로컬 기록을 삭제할까요?')
      )
        return;
      state = await api.avatarCommand(
        ['race', 'cheer'].includes(command) ? 'game' : command,
        {
          type: command,
          duration: 30,
          id: target.dataset.id,
          action: target.dataset.mode,
        },
      );
      updateStatus();
      renderBody();
    });
  });
  async function init() {
    try {
      const epoch = requestEpoch;
      const next = await api.avatarState();
      if (busy || epoch !== requestEpoch) return;
      state = next;
      draft = structuredClone(state.config);
      savedDraft = JSON.stringify(draft);
      if (api.avatarDraft) recovery = await api.avatarDraft('load');
      shell();
      if (state.error) notice(state.error, true);
    } catch (error) {
      root.textContent = error.message || '아바타 초기화 실패';
      setTimeout(init, 5000);
    }
  }
  setInterval(async () => {
    if (
      !state ||
      !document.getElementById('page-avatars').classList.contains('active')
    )
      return;
    try {
      const epoch = requestEpoch;
      const next = await api.avatarState();
      if (busy || epoch !== requestEpoch) { updateJob(next.job); return; }
      state = next;
      updateStatus();
      if (tab === 'viewers') renderViewers();
      if (tab === 'games') renderRecent();
      if (state.error) notice(state.error, true);
    } catch (error) {
      notice(error.message, true);
    }
  }, 1500);
  void init();
})();
