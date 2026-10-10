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
    busy = false;
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
    dirty = true;
    q('avDirty').textContent = '미저장 변경';
  }
  function notice(message, error = false) {
    q('avNotice').textContent = message;
    q('avNotice').className = error ? 'av-error' : 'av-notice';
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    root.setAttribute('aria-busy', 'true');
    try {
      await fn();
    } catch (error) {
      notice(error.message || '작업에 실패했습니다.', true);
    } finally {
      busy = false;
      root.removeAttribute('aria-busy');
    }
  }
  function shell() {
    root.innerHTML = `<div class="av-toolbar"><h2>방송 아바타</h2><div class="av-actions">${button('실행', 'toggle', 'id="avToggle"')}${button('일시정지', 'pause', 'id="avPause"')}${button('화면 비우기', 'clear')}${button('설정 저장', 'save')}</div></div>
      <div class="av-status"><strong id="avRunning"></strong><span id="avConnection"></span><span id="avCount"></span><span id="avDirty"></span></div>
      <div class="av-preview"><iframe id="avPreview" title="아바타 실시간 미리보기" sandbox="allow-scripts allow-same-origin"></iframe></div>
      <div class="av-url"><input id="avUrl" readonly aria-label="OBS 브라우저 주소">${button('OBS 주소 복사', 'copy')}</div>
      <div id="avNotice" class="av-notice" role="status" aria-live="polite"></div>
      <div class="av-tabs" role="tablist">${[
        ['avatars', '캐릭터'],
        ['scene', '장면'],
        ['rules', '채팅 반응'],
        ['viewers', '참여자'],
        ['games', '게임 / 테스트'],
        ['storage', '백업'],
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
    q('avRunning').textContent = state.config.enabled
      ? state.config.paused
        ? '일시정지'
        : '실행 중'
      : '중지';
    q('avConnection').textContent = state.connected
      ? '치지직 이벤트 연결됨'
      : '채팅 연결 대기';
    q('avCount').textContent =
      `${state.snapshot.actors.length}명 · 출력 ${Math.max(0, state.clients - 1)}개`;
    q('avToggle').textContent = state.config.enabled ? '중지' : '실행';
    q('avPause').textContent = state.config.paused ? '재개' : '일시정지';
    q('avUrl').value = state.url || '';
    if (state.url && q('avPreview').getAttribute('src') !== state.url)
      q('avPreview').src = state.url;
  }
  function renderBody() {
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
            return `<div class="av-state"><div class="av-state-head">${thumbnail(s || a.states.idle, a.pixelated)}<strong>${label}</strong>${button('이미지 선택', 'state-image', `data-state="${key}"`)}${s && key !== 'idle' ? button('해제', 'state-clear', `data-state="${key}"`) : !s ? '<span>기본 이미지</span>' : ''}</div>${
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
          )}<div class="av-actions" style="margin-top:16px">${button('캐릭터 삭제', 'delete-avatar')}</div></div></div>`;
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
          ? `<div class="av-form">${field('반응 이름', 'rule.name', r.name)}<label>발생 조건<select data-field="rule.trigger">${options(triggers, r.trigger)}</select></label>${field('명령어 / 별칭', 'rule.aliases', r.aliases.join(' '), 'text', 'placeholder="!점프 !jump"')}<label>사용 권한<select data-field="rule.role">${options(roles, r.role)}</select></label>${field('재사용 대기 (초)', 'rule.cooldown', r.cooldown, 'number', 'min="1" max="600"')}${field('최소 후원 금액', 'rule.minimum', r.minimum, 'number', 'min="0"')}${check('반응 사용', 'rule.enabled', r.enabled)}</div>
        <div class="av-section-head"><h3>순서대로 실행</h3>${button('동작 추가', 'add-step')}</div>
        ${r.steps.map((s, i) => `<div class="av-step"><label>동작 ${i + 1}<select data-field="step.${i}.action">${options(actions, s.action)}</select></label>${field(s.action === 'say' ? '문구 ({user}, {target})' : s.action === 'size' ? '배율 (0.5~1.6)' : s.action === 'walk' ? '방향 (-1: 왼쪽 / 1: 오른쪽)' : '값', `step.${i}.value`, s.value)}${field('시간 (초)', `step.${i}.duration`, s.duration, 'number', 'min="0.1" max="10" step="0.1"')}<div class="av-actions"><button class="av-icon" data-av="step-up" data-step="${i}" title="위로 이동" aria-label="동작 ${i + 1} 위로 이동">↑</button><button class="av-icon" data-av="step-delete" data-step="${i}" title="동작 삭제" aria-label="동작 ${i + 1} 삭제">×</button></div></div>`).join('')}<div class="av-actions" style="margin-top:16px">${button('반응 삭제', 'delete-rule')}</div>`
          : '<div class="av-empty">등록된 반응이 없습니다.</div>'
      }</div></div>`;
    } else if (tab === 'viewers') {
      body.innerHTML = '<div id="avViewers"></div>';
      renderViewers();
    } else if (tab === 'games') {
      body.innerHTML = `<div class="av-editor"><div class="av-actions">${button('달리기 시작', 'race')}${button('공동 응원 시작', 'cheer')}${button('게임 종료', 'stop-game')}${button('테스트 참여자 10명', 'test-crowd')}${button('테스트 참여자 지우기', 'clear-tests')}</div>
        <form id="avTestForm" class="av-test"><label>테스트 닉네임<input id="avTestName" value="테스트" maxlength="32"></label><label>이벤트<select id="avTestKind">${options({ chat: '채팅', donation: '후원', subscription: '구독' }, 'chat')}</select></label><label>권한<select id="avTestRole">${options(roles, 'everyone')}</select></label><label class="av-chat">채팅 내용<input id="avTestText" value="!점프" maxlength="300"></label><label>후원 금액<input id="avTestAmount" type="number" min="0" value="1000"></label><button type="submit" class="button primary">테스트 전송</button></form><h3>최근 반응</h3><ul id="avRecent" class="av-log"></ul></div>`;
      q('avTestForm').addEventListener('submit', (event) => {
        event.preventDefault();
        void run(async () => {
          state = await api.avatarCommand('test', {
            name: q('avTestName').value,
            text: q('avTestText').value,
            kind: q('avTestKind').value,
            role: q('avTestRole').value,
            amount: q('avTestAmount').value,
          });
          updateStatus();
          renderRecent();
        });
      });
      renderRecent();
    } else {
      body.innerHTML = `<div class="av-editor"><h3>로컬 저장소</h3><p>${state.assets.length}개 이미지 · ${(state.assets.reduce((sum, a) => sum + a.bytes, 0) / 1048576).toFixed(1)} / 48MB</p><div class="av-actions">${button('백업 내보내기', 'backup')}${button('백업 불러오기', 'restore')}${button('미사용 이미지 정리', 'prune')}${button('시청자 기록 전체 삭제', 'forget-all')}</div></div>`;
    }
  }
  function renderRecent() {
    if (q('avRecent'))
      q('avRecent').innerHTML =
        state.recent
          .map(
            (r) =>
              `<li>${esc(new Date(r.at).toLocaleTimeString())} · ${esc(r.message)}</li>`,
          )
          .join('') || '<li>아직 실행된 반응이 없습니다.</li>';
  }
  function renderViewers() {
    if (!q('avViewers')) return;
    q('avViewers').innerHTML =
      `<table class="av-table"><thead><tr><th>참여자</th><th>캐릭터</th><th>승리</th><th>관리</th></tr></thead><tbody>${state.snapshot.actors.map((a) => `<tr><td>${esc(a.name)}${a.test ? ' (테스트)' : ''}</td><td>${esc(draft.avatars.find((v) => v.id === a.avatar)?.name || a.avatar)}</td><td>${a.wins}</td><td><div class="av-actions">${button('퇴장', 'moderate', `data-id="${a.id}" data-mode="remove"`)}${button('차단', 'moderate', `data-id="${a.id}" data-mode="block"`)}${button('기록 삭제', 'moderate', `data-id="${a.id}" data-mode="forget"`)}</div></td></tr>`).join('')}</tbody></table>${!state.snapshot.actors.length ? '<div class="av-empty">현재 참여자가 없습니다.</div>' : ''}<h3>차단 목록</h3>${state.blocked.map((a) => `<div class="av-status">${esc(a.name)}${button('차단 해제', 'moderate', `data-id="${a.id}" data-mode="unblock"`)}${button('기록 삭제', 'moderate', `data-id="${a.id}" data-mode="forget"`)}</div>`).join('') || '<div class="av-empty">차단된 참여자가 없습니다.</div>'}`;
  }
  async function save() {
    state = await api.avatarSave(draft);
    draft = structuredClone(state.config);
    dirty = false;
    q('avDirty').textContent = '';
    updateStatus();
    notice('저장했습니다.');
  }
  root.addEventListener('change', (event) => {
    const key = event.target.dataset.field;
    if (!key) return;
    const value =
      event.target.type === 'checkbox'
        ? event.target.checked
        : event.target.type === 'number'
          ? Number(event.target.value)
          : event.target.value;
    const parts = key.split('.'),
      a = draft.avatars.find((a) => a.id === selectedAvatar),
      r = draft.rules.find((r) => r.id === selectedRule);
    if (parts[0] === 'avatar') a[parts[1]] = value;
    else if (parts[0] === 'clip') a.states[parts[1]][parts[2]] = value;
    else if (parts[0] === 'rule')
      r[parts[1]] = parts[1] === 'aliases' ? value.trim().split(/\s+/) : value;
    else if (parts[0] === 'step') r.steps[Number(parts[1])][parts[2]] = value;
    else draft[key] = value;
    changed();
    if (key.endsWith('.action')) renderBody();
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
      if (command === 'save') {
        await save();
        renderBody();
        return;
      }
      if (command === 'toggle' || command === 'pause') {
        draft[command === 'toggle' ? 'enabled' : 'paused'] =
          !state.config[command === 'toggle' ? 'enabled' : 'paused'];
        await save();
        return;
      }
      if (command === 'copy' || command === 'copy-commands') {
        await api.avatarCopy(command === 'copy' ? 'url' : 'commands');
        notice('복사했습니다.');
        return;
      }
      if (command === 'add-avatar' || command === 'state-image') {
        const result = await api.avatarImport();
        if (!result) return;
        const clip = {
          asset: result.asset,
          columns: 1,
          rows: 1,
          frames: 1,
          fps: 12,
        };
        if (command === 'add-avatar') {
          const item = {
            id: crypto.randomUUID(),
            name: `캐릭터 ${draft.avatars.length + 1}`,
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
        delete a.states[target.dataset.state];
        changed();
        renderBody();
        return;
      }
      if (command === 'delete-avatar') {
        if (draft.avatars.length <= 1)
          throw new Error('캐릭터는 최소 한 개가 필요합니다.');
        if (!confirm(`'${a.name}' 캐릭터를 삭제할까요?`)) return;
        draft.avatars = draft.avatars.filter((v) => v !== a);
        changed();
        renderBody();
        return;
      }
      if (command === 'preset') {
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
        const item = {
          id: crypto.randomUUID(),
          name: welcome ? '입장 환영' : '새 반응',
          enabled: true,
          trigger: welcome ? 'join' : 'command',
          aliases: welcome ? [] : [`!반응${Date.now().toString().slice(-6)}`],
          role: 'everyone',
          cooldown: 3,
          minimum: 0,
          steps: welcome
            ? [
                { action: 'wave', value: '', duration: 2 },
                { action: 'say', value: '{user}님, 반가워요!', duration: 3 },
              ]
            : [{ action: 'jump', value: '', duration: 1 }],
        };
        draft.rules.push(item);
        selectedRule = item.id;
        changed();
        renderBody();
        return;
      }
      if (command === 'delete-rule') {
        draft.rules = draft.rules.filter((v) => v !== r);
        changed();
        renderBody();
        return;
      }
      if (command === 'add-step') {
        if (r.steps.length >= 8) throw new Error('동작은 최대 8개입니다.');
        r.steps.push({ action: 'wave', value: '', duration: 2 });
        changed();
        renderBody();
        return;
      }
      if (command === 'step-delete') {
        if (r.steps.length <= 1)
          throw new Error('동작은 최소 한 개가 필요합니다.');
        r.steps.splice(Number(target.dataset.step), 1);
        changed();
        renderBody();
        return;
      }
      if (command === 'step-up') {
        const i = Number(target.dataset.step);
        if (i > 0) [r.steps[i - 1], r.steps[i]] = [r.steps[i], r.steps[i - 1]];
        changed();
        renderBody();
        return;
      }
      if (command === 'backup' || command === 'restore') {
        if (dirty && !confirm('미저장 변경은 포함되지 않습니다. 계속할까요?'))
          return;
        const next = await api.avatarBackup(command === 'restore');
        if (next) {
          state = next;
          draft = structuredClone(state.config);
          dirty = false;
          shell();
          notice(
            command === 'restore'
              ? '복원했습니다. 아바타는 중지 상태입니다.'
              : '백업을 저장했습니다.',
          );
        }
        return;
      }
      if (command === 'test-crowd') {
        for (let i = 1; i <= 10; i++)
          state = await api.avatarCommand('test', {
            name: `테스트 ${i}`,
            text: '!입장',
          });
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
      state = await api.avatarState();
      draft = structuredClone(state.config);
      shell();
      if (state.error) notice(state.error, true);
    } catch (error) {
      root.textContent = error.message || '아바타 초기화 실패';
      setTimeout(init, 5000);
    }
  }
  setInterval(async () => {
    if (
      busy ||
      !state ||
      !document.getElementById('page-avatars').classList.contains('active')
    )
      return;
    try {
      state = await api.avatarState();
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
