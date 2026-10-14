(() => {
  'use strict';
  const root = document.getElementById('pngtuberEditor');
  const page = document.getElementById('page-pngtuber');
  if (!root || !page) return;

  const defaults = {
    version: 1, enabled: false, port: 17842, inputName: '', inputUuid: '',
    thresholdDb: -38, hysteresisDb: 6, holdMs: 160,
    openAsset: '', closedAsset: '', mutedAsset: '', fit: 'contain', flipX: false,
    reactionMode: 'queue', reactions: [],
  };
  const clone = (value) => structuredClone(value);
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const q = (id) => root.querySelector(`#${id}`);
  const text = (id, value) => { const node = q(id); if (node.textContent !== value) node.textContent = value; };
  // Additional Lucide paths from installed lucide-react (ISC; license in avatar-icons.js).
  const lucide = (paths) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths.map((d) => `<path d="${d}"></path>`).join('')}</svg>`;
  const refreshIcon = lucide(['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5']);
  const saveIcon = lucide(['M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7', 'M7 3v4a1 1 0 0 0 1 1h7']);
  const button = (label, action, extra = '') => {
    const iconName = { reset: 'Undo2', import: 'ArrowUp', 'remove-asset': 'X', delete: 'X', test: 'Play', 'copy-url': 'Copy', 'copy-variable': 'Copy', add: 'Plus', clear: 'X' }[action];
    const icon = ['discover', 'retry'].includes(action) ? refreshIcon : window.aruAvatarIcons?.[iconName] || '';
    const iconOnly = !!icon && ['reset', 'discover', 'remove-asset', 'copy-url', 'copy-variable', 'delete'].includes(action);
    return `<button type="button" class="button secondary${iconOnly ? ' pt-icon-button' : ''}" data-pt="${action}" title="${label}" ${extra.includes('aria-label=') ? '' : `aria-label="${label}"`} ${extra}>${icon}${iconOnly ? '' : `<span>${label}</span>`}</button>`;
  };
  const normalize = (value) => ({ ...clone(defaults), ...clone(value), reactions: clone(value.reactions || []) });
  let state = null, saved = null, draft = null;
  let busy = false, polling = false, timer = null, epoch = 0, failed = false;
  let revealed = false, catalogKey = '', sourceKey = '';
  const dirty = () => !!draft && !same(draft, saved);
  const visible = () => page.classList.contains('active') && !document.hidden;
  const api = () => window.aruLocal;

  function mediaUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  function assetSlot(field, label, reactionIndex) {
    const reaction = reactionIndex !== undefined;
    const attr = reaction ? 'data-pt-reaction="asset"' : `data-pt-field="${field}"`;
    return `<div class="pt-asset" data-pt-slot="${field}">
      <div class="pt-thumbnail"><img alt="${label} 미리보기" hidden><span>이미지 없음</span></div>
      <div class="pt-asset-controls"><label>${label}<select ${attr} aria-label="${label}"></select></label>
      <div class="pt-actions">${button('가져오기', 'import', `data-slot="${field}" aria-label="${label} 가져오기"`)}${button('해제', 'remove-asset', `data-slot="${field}" aria-label="${label} 해제"`)}</div>
      <span class="pt-meta" data-pt-asset-status></span></div></div>`;
  }

  root.innerHTML = `<div class="pt-toolbar">
    <div class="pt-save-state"><strong id="ptDirty" role="status">불러오는 중</strong><span id="ptSaved" class="pt-meta"></span></div>
    <div class="pt-actions">${button('변경 취소', 'reset', 'disabled')}<button type="submit" form="ptForm" class="button primary" id="ptSave" disabled>${saveIcon}<span id="ptSaveLabel">설정 저장</span></button></div>
  </div>
  <div class="pt-notice" id="ptNotice" hidden><span id="ptNoticeText" role="status"></span>${button('다시 시도', 'retry', 'id="ptRetry" hidden')}</div>
  <form id="ptForm" novalidate><fieldset id="ptFields" disabled>
    <legend class="pt-sr-only">짚톡 설정</legend>
    <div class="pt-layout"><div class="pt-settings">
      <section class="pt-section" aria-labelledby="ptMicHeading">
        <div class="pt-section-head"><h2 id="ptMicHeading">OBS 마이크</h2><label class="pt-check"><input type="checkbox" data-pt-field="enabled">짚톡 사용</label></div>
        <div class="pt-source"><label>마이크 소스<select id="ptInput" aria-label="마이크 소스"></select></label>${button('소스 새로고침', 'discover')}</div>
        <div class="pt-live"><span id="ptConnection" role="status">OBS 확인 중</span><span id="ptMouth" role="status">입 다묾</span><output id="ptLevel">신호 없음</output></div>
        <div class="pt-meter-track"><meter id="ptMeter" min="-100" max="0" value="-100" aria-label="현재 마이크 음량"></meter><span id="ptThresholdMark" aria-hidden="true"></span></div>
        <div class="pt-threshold"><label>입 열림 기준 (dB)<input type="range" id="ptThresholdRange" min="-100" max="0" step="1" value="-38" aria-label="입 열림 기준 슬라이더"></label><label class="pt-number"><span class="pt-sr-only">입 열림 기준 (dB) 숫자</span><input type="number" data-pt-field="thresholdDb" min="-100" max="0" step="any" required aria-label="입 열림 기준 (dB) 숫자"></label></div>
        <div class="pt-form-grid"><label>입 닫힘 여유 (dB)<input type="number" data-pt-field="hysteresisDb" min="0" max="40" step="any" required></label><label>입 열림 유지 (ms)<input type="number" data-pt-field="holdMs" min="0" max="2000" step="1" required></label></div>
      </section>
      <section class="pt-section" aria-labelledby="ptImagesHeading"><div class="pt-section-head"><h2 id="ptImagesHeading">기본 이미지</h2><span class="pt-meta">미지정 시 입 다묾</span></div>
        <div class="pt-slots">${assetSlot('closedAsset', '입 다묾 이미지')}${assetSlot('openAsset', '입 열림 이미지')}${assetSlot('mutedAsset', '음소거 이미지')}</div>
      </section>
    </div><aside class="pt-output" aria-labelledby="ptOutputHeading">
      <section class="pt-section"><div class="pt-section-head"><h2 id="ptOutputHeading">출력 미리보기</h2><span class="pt-meta">저장된 설정</span></div>
        <div class="pt-preview"><iframe id="ptPreview" title="짚톡 출력 미리보기 (읽기 전용)" tabindex="-1" inert sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer"></iframe><span id="ptPreviewEmpty">출력 대기 중</span></div>
        <div class="pt-output-controls"><fieldset class="pt-fit"><legend>화면 맞춤</legend><div class="pt-segment"><label><input type="radio" name="ptFit" value="contain" data-pt-field="fit">전체 표시</label><label><input type="radio" name="ptFit" value="cover" data-pt-field="fit">화면 채움</label></div></fieldset><label class="pt-check"><input type="checkbox" data-pt-field="flipX">좌우 반전</label></div>
        <label>브라우저 소스 URL<input id="ptUrl" type="password" readonly autocomplete="off" spellcheck="false" placeholder="주소 없음"></label>
        <div class="pt-actions pt-url-actions">${button('주소 표시', 'reveal', 'aria-pressed="false" aria-controls="ptUrl"')}${button('주소 복사', 'copy-url')}</div>
        <label>로컬 포트<input type="number" data-pt-field="port" min="1024" max="65535" step="1" required></label>
      </section>
      <section class="pt-section" aria-labelledby="ptRuntimeHeading"><div class="pt-section-head"><h2 id="ptRuntimeHeading">현재 출력</h2>${button('반응·대기열 비우기', 'clear')}</div>
        <dl class="pt-runtime"><div><dt>상태</dt><dd id="ptRuntimeMode">대기 중</dd></div><div><dt>반응</dt><dd id="ptReaction">없음</dd></div><div><dt>남은 시간</dt><dd id="ptRemaining">0.0초</dd></div><div><dt>대기열</dt><dd id="ptQueued">0개</dd></div></dl>
        <div id="ptRuntimeError" class="pt-error" role="status" hidden>짚톡 실행 오류 · OBS 연결과 설정을 확인하세요.</div>
      </section>
    </aside></div>
    <section class="pt-section pt-reactions" aria-labelledby="ptReactionsHeading"><div class="pt-section-head"><h2 id="ptReactionsHeading">포인트·후원 반응</h2><div class="pt-actions"><label class="pt-inline-label">재생 방식<select data-pt-field="reactionMode"><option value="queue">순서대로 재생</option><option value="replace">즉시 교체</option></select></label>${button('반응 추가', 'add')}</div></div>
      <div id="ptReactions"></div><div id="ptNoReactions" class="pt-empty">등록된 반응 없음</div>
    </section>
  </fieldset></form>`;

  function notice(message = '', error = false, retry = false) {
    q('ptNotice').hidden = !message;
    q('ptNotice').classList.toggle('pt-error', error);
    text('ptNoticeText', message);
    q('ptRetry').hidden = !retry;
  }

  function errorMessage(error, fallback) {
    const message = String(error?.message || error || '');
    if (/EADDRINUSE|address.*in use|port.*in use/i.test(message)) return '로컬 포트가 사용 중입니다. 다른 포트로 변경한 뒤 저장하세요.';
    if (/output server failed/i.test(message)) return '출력 서버를 열지 못했습니다. 로컬 포트와 방화벽 설정을 확인하세요.';
    if (/20 MiB|at most 20/i.test(message)) return '20 MiB 이하의 이미지 파일을 선택하세요.';
    if (/decoded pixels|240 frames|PNG\/JPEG/i.test(message)) return 'PNG·JPEG·GIF·WebP 이미지를 선택하세요. 최대 1,600만 화소·240프레임입니다.';
    if (/library is full/i.test(message)) return '보관 이미지가 256개로 가득 찼습니다. 기존 이미지를 선택하세요.';
    if (/image asset is missing|image changed during import/i.test(message)) return '이미지 파일이 없거나 변경되었습니다. 다시 가져오세요.';
    if (/could not be recovered/i.test(message)) return '설정을 복구하지 못했습니다. 원본 파일은 보존되어 있습니다.';
    if (/Recovered PNGTuber settings/i.test(message)) return '백업에서 설정을 복구했습니다. 내용을 확인하세요.';
    if (/Select an OBS audio input|selected.*input.*unavailable/i.test(message)) return 'OBS 마이크 소스를 선택하고 저장하세요. 목록에 없으면 소스를 새로고침하세요.';
    if (/renamed OBS input/i.test(message)) return '변경된 소스 이름을 저장하지 못했습니다. 소스를 새로고침한 뒤 저장하세요.';
    if (/OBS/i.test(message)) return 'OBS에 연결하지 못했습니다. OBS 연결 설정을 확인한 뒤 소스를 새로고침하세요.';
    return fallback;
  }

  function renderSources() {
    if (!draft) return;
    const inputs = state.inputs || [];
    const key = JSON.stringify([inputs, draft.inputName, draft.inputUuid]);
    if (key === sourceKey) return;
    sourceKey = key;
    const select = q('ptInput');
    select.replaceChildren(new Option('소스 선택', ''));
    let selected = false;
    inputs.forEach((input, index) => {
      const match = draft.inputUuid ? input.uuid === draft.inputUuid : !!draft.inputName && input.name === draft.inputName;
      select.add(new Option(input.name, String(index), false, match));
      selected ||= match;
    });
    if (!selected && (draft.inputName || draft.inputUuid)) select.add(new Option(`${draft.inputName || '선택한 소스'} (목록에 없음)`, 'missing', false, true));
  }

  function renderAssets(force = false) {
    const key = JSON.stringify(state.assets || []);
    if (!force && key === catalogKey) return;
    catalogKey = key;
    for (const slot of root.querySelectorAll('[data-pt-slot]')) {
      const row = slot.closest('[data-pt-row]');
      const value = row ? draft.reactions[Number(row.dataset.ptRow)].asset : draft[slot.dataset.ptSlot];
      const select = slot.querySelector('select');
      select.replaceChildren(new Option(row || slot.dataset.ptSlot === 'closedAsset' ? '이미지 없음' : '입 다묾으로 대체', ''));
      for (const asset of state.assets || []) select.add(new Option(asset.name, asset.id));
      if (value && !(state.assets || []).some((asset) => asset.id === value)) select.add(new Option('찾을 수 없는 이미지', value));
      select.value = value || '';
    }
    renderThumbnails();
  }

  function renderThumbnails() {
    for (const slot of root.querySelectorAll('[data-pt-slot]')) {
      const row = slot.closest('[data-pt-row]');
      const selected = row ? draft.reactions[Number(row.dataset.ptRow)].asset : draft[slot.dataset.ptSlot];
      const fallback = !row && slot.dataset.ptSlot !== 'closedAsset' && !selected;
      const asset = (state.assets || []).find((item) => item.id === (selected || (fallback ? draft.closedAsset : '')));
      const url = mediaUrl(asset?.url);
      const img = slot.querySelector('img');
      if (url && img.getAttribute('src') !== url) img.src = url;
      if (!url) img.removeAttribute('src');
      const unavailable = !!url && img.dataset.failedUrl === url;
      img.hidden = !url || unavailable;
      slot.querySelector('.pt-thumbnail span').hidden = !!url && !unavailable;
      slot.querySelector('[data-pt-asset-status]').textContent = unavailable ? '이미지를 불러오지 못했습니다.' : selected && !asset ? '이미지를 다시 선택하세요.' : fallback ? '입 다묾으로 대체' : asset?.name || '미지정';
      slot.querySelector('[data-pt="remove-asset"]').disabled = busy || !selected;
    }
  }

  function renderReactions() {
    q('ptReactions').innerHTML = draft.reactions.map((reaction, index) => `<div class="pt-reaction" data-pt-row="${index}">
      <div class="pt-reaction-fields"><label>반응 이름<input data-pt-reaction="name" value="${esc(reaction.name)}" maxlength="96" required></label><label>반응 ID<input data-pt-reaction="id" value="${esc(reaction.id)}" maxlength="64" required spellcheck="false" autocapitalize="off"></label><label>표시 시간 (초)<input type="number" data-pt-reaction="durationSec" min="0.1" max="300" step="any" value="${esc(reaction.durationSec)}" required></label>${button('삭제', 'delete')}</div>
      ${assetSlot('reaction', '반응 이미지', index)}
      <div class="pt-reaction-footer"><code data-pt-variable></code><div class="pt-actions">${button('변수 복사', 'copy-variable')}${button('테스트', 'test')}</div><span class="pt-meta" data-pt-reaction-status></span></div>
    </div>`).join('');
    q('ptNoReactions').hidden = !!draft.reactions.length;
    renderAssets(true);
  }

  function renderConfig() {
    for (const node of root.querySelectorAll('[data-pt-field]')) {
      const value = draft[node.dataset.ptField];
      if (node.type === 'checkbox') node.checked = !!value;
      else if (node.type === 'radio') node.checked = node.value === value;
      else node.value = value;
    }
    sourceKey = '';
    renderSources();
    renderReactions();
    updateEditing();
  }

  function updateEditing() {
    if (!draft) return;
    const changed = dirty();
    text('ptDirty', changed ? '미저장 변경' : '저장 완료');
    q('ptDirty').classList.toggle('pt-unsaved', changed);
    text('ptSaved', `저장된 설정 · ${saved.enabled ? '사용 중' : '꺼짐'}`);
    q('ptSave').disabled = busy || !changed;
    text('ptSaveLabel', busy ? '처리 중' : '설정 저장');
    root.querySelector('[data-pt="reset"]').disabled = busy || !changed;
    root.querySelector('[data-pt="add"]').disabled = busy || draft.reactions.length >= 32;
    q('ptFields').disabled = busy;
    const threshold = Number(draft.thresholdDb);
    if (Number.isFinite(threshold) && draft.thresholdDb !== '') {
      q('ptThresholdRange').value = threshold;
      q('ptThresholdMark').style.left = `${Math.max(0, Math.min(100, threshold + 100))}%`;
    }
    for (const row of root.querySelectorAll('[data-pt-row]')) {
      const reaction = draft.reactions[Number(row.dataset.ptRow)];
      const id = row.querySelector('[data-pt-reaction="id"]');
      const validId = /^[a-zA-Z0-9_-]{1,64}$/.test(reaction.id);
      const unique = draft.reactions.filter((item) => item.id === reaction.id).length === 1;
      id.setCustomValidity(!validId ? '반응 ID는 영문·숫자·하이픈·밑줄만 사용할 수 있습니다.' : !unique ? '이미 사용 중인 반응 ID입니다.' : '');
      const name = row.querySelector('[data-pt-reaction="name"]');
      name.setCustomValidity(reaction.name.trim() ? '' : '반응 이름을 입력하세요.');
      const asset = row.querySelector('[data-pt-reaction="asset"]');
      asset.setCustomValidity((state.assets || []).some((item) => item.id === reaction.asset) ? '' : '반응 이미지를 선택하세요.');
      const usable = !changed && !!saved.reactions.find((item) => item.id === reaction.id);
      const copy = row.querySelector('[data-pt="copy-variable"]');
      const test = row.querySelector('[data-pt="test"]');
      copy.disabled = busy || !usable;
      test.disabled = busy || !usable || !saved.enabled;
      copy.title = usable ? '포인트·후원 반응 변수 복사' : '설정을 저장한 뒤 복사하세요.';
      test.title = !usable ? '설정을 저장한 뒤 테스트하세요.' : !saved.enabled ? '짚톡 사용을 켜고 저장하세요.' : '저장된 반응 실행';
      row.querySelector('[data-pt-variable]').textContent = validId && unique && reaction.durationSec !== '' ? `\${pngtuber::${reaction.id}::${reaction.durationSec}}` : '변수 미완성';
      row.querySelector('[data-pt-reaction-status]').textContent = !validId ? 'ID: 영문·숫자·하이픈·밑줄, 최대 64자' : !unique ? '중복된 반응 ID' : changed ? '저장 후 복사·테스트' : !saved.enabled ? '테스트: 짚톡 꺼짐' : '저장됨';
    }
    for (const node of root.querySelectorAll('[data-pt-field], [data-pt-reaction]')) node.setAttribute('aria-invalid', String(!node.validity.valid));
    renderThumbnails();
  }

  function renderRuntime() {
    const runtime = state.runtime || {};
    const connected = !!runtime.connected, available = !!runtime.sourceAvailable;
    const muted = connected && available && runtime.muted;
    const open = saved.enabled && connected && available && !runtime.muted && runtime.mouthOpen;
    text('ptConnection', !connected ? 'OBS 연결 안 됨' : !available ? '선택한 소스 없음' : 'OBS 연결됨');
    text('ptMouth', muted ? '음소거' : open ? '입 열림' : '입 다묾');
    const hasLevel = connected && available && Number.isFinite(runtime.levelDb);
    text('ptLevel', hasLevel ? `${runtime.levelDb.toFixed(1)} dB` : '신호 없음');
    q('ptMeter').value = hasLevel ? Math.max(-100, Math.min(0, runtime.levelDb)) : -100;
    q('ptMeter').setAttribute('aria-valuetext', hasLevel ? `${runtime.levelDb.toFixed(1)} dB` : '신호 없음');
    q('ptMeter').classList.toggle('pt-muted', !!runtime.muted || !saved.enabled);
    const active = !!runtime.reactionId;
    const queued = Array.isArray(runtime.queued) ? runtime.queued.length : Math.max(0, Number(runtime.queued) || 0);
    text('ptRuntimeMode', !saved.enabled ? '꺼짐' : active ? '반응 재생 중' : muted ? '음소거' : open ? '입 열림' : '입 다묾');
    text('ptReaction', active ? saved.reactions.find((item) => item.id === runtime.reactionId)?.name || runtime.reactionId : '없음');
    text('ptRemaining', `${(Math.max(0, Number(runtime.remainingMs) || 0) / 1000).toFixed(1)}초`);
    text('ptQueued', `${queued}개`);
    q('ptRuntimeError').hidden = !runtime.error;
    text('ptRuntimeError', errorMessage(runtime.error, '짚톡 실행 오류 · OBS 연결과 설정을 확인하세요.'));
    root.querySelector('[data-pt="clear"]').disabled = busy || (!active && !queued);
    const url = mediaUrl(state.previewUrl);
    const preview = q('ptPreview');
    // The preview is live output, not a draft renderer. Keep its browsing context across polls.
    if (url && preview.getAttribute('src') !== url) preview.src = url;
    if (!url) preview.removeAttribute('src');
    q('ptPreviewEmpty').hidden = !!url;
    renderUrl();
  }

  function renderUrl() {
    q('ptUrl').type = revealed ? 'text' : 'password';
    q('ptUrl').value = revealed ? state?.url || '' : state?.url ? '****************' : '';
    const reveal = root.querySelector('[data-pt="reveal"]');
    reveal.textContent = revealed ? '주소 숨기기' : '주소 표시';
    reveal.setAttribute('aria-pressed', String(revealed));
    reveal.disabled = busy || !state?.url;
    root.querySelector('[data-pt="copy-url"]').disabled = busy || !state?.url;
  }

  function accept(next, replaceDraft = false) {
    if (!next?.config) throw new Error('Invalid PNGTuber state');
    const keep = dirty() && !replaceDraft;
    const nextConfig = normalize(next.config);
    const configChanged = !same(saved, nextConfig);
    state = next;
    saved = nextConfig;
    if (!keep) draft = clone(saved);
    if (replaceDraft || (!keep && configChanged)) renderConfig();
    else { renderSources(); renderAssets(); updateEditing(); }
    renderRuntime();
  }

  async function run(action, message, retry = false) {
    if (busy) return;
    busy = true;
    ++epoch;
    root.setAttribute('aria-busy', 'true');
    if (draft) updateEditing();
    q('ptRetry').disabled = true;
    try { await action(); }
    catch (error) { notice(errorMessage(error, message), true, retry); }
    finally {
      busy = false;
      root.removeAttribute('aria-busy');
      q('ptRetry').disabled = false;
      if (draft) { updateEditing(); renderRuntime(); }
    }
  }

  async function refresh() {
    if (!visible() || busy || polling || (failed && !state)) return;
    polling = true;
    const requestEpoch = epoch;
    try {
      const next = await api().pngtuberState();
      if (requestEpoch !== epoch) return;
      accept(next);
      if (failed) notice();
      failed = false;
    } catch (error) {
      if (requestEpoch !== epoch) return;
      failed = true;
      if (!state) text('ptDirty', '불러오기 실패');
      notice(errorMessage(error, '짚톡 상태를 불러오지 못했습니다. 다시 시도하세요.'), true, true);
    } finally { polling = false; }
  }

  function visibilityChanged() {
    if (!visible()) {
      if (timer !== null) clearInterval(timer);
      timer = null;
      revealed = false;
      renderUrl();
      return;
    }
    if (timer !== null) return;
    void refresh();
    timer = setInterval(refresh, 250);
  }

  function edit(event) {
    if (!draft || busy) return;
    const node = event.target;
    if (node.id === 'ptThresholdRange') {
      draft.thresholdDb = Number(node.value);
      root.querySelector('[data-pt-field="thresholdDb"]').value = node.value;
    } else if (node.id === 'ptInput') {
      if (node.value === 'missing') return;
      const input = node.value === '' ? null : state.inputs?.[Number(node.value)];
      draft.inputName = input?.name || '';
      draft.inputUuid = input?.uuid || '';
    } else if (node.dataset.ptField || node.dataset.ptReaction) {
      const target = node.dataset.ptReaction ? draft.reactions[Number(node.closest('[data-pt-row]').dataset.ptRow)] : draft;
      const key = node.dataset.ptReaction || node.dataset.ptField;
      target[key] = node.type === 'checkbox' ? node.checked : node.type === 'number' && node.value !== '' ? Number(node.value) : node.value;
    } else return;
    notice();
    updateEditing();
  }
  root.addEventListener('input', edit);
  root.addEventListener('change', edit);

  q('ptForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!draft || busy || !dirty()) return;
    updateEditing();
    if (!q('ptForm').reportValidity()) { notice('입력값을 확인한 뒤 저장하세요.', true); return; }
    void run(async () => {
      accept(await api().pngtuberSave(clone(draft)), true);
      notice('설정을 저장했습니다.');
    }, '설정을 저장하지 못했습니다. 편집 내용은 유지됩니다. 다시 저장하세요.');
  });

  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-pt]');
    if (!target || target.disabled || busy) return;
    const action = target.dataset.pt;
    if (action === 'retry') {
      failed = false;
      void refresh();
      return;
    }
    if (!draft) return;
    if (action === 'reveal') { revealed = !revealed; renderUrl(); return; }
    if (action === 'reset') {
      if (!window.confirm('저장하지 않은 짚톡 변경 내용을 취소할까요?')) return;
      draft = clone(saved);
      renderConfig();
      notice();
      return;
    }
    const row = target.closest('[data-pt-row]');
    const index = row ? Number(row.dataset.ptRow) : -1;
    const reaction = draft.reactions[index];
    if (action === 'add') {
      if (draft.reactions.length >= 32) return;
      let n = 1;
      while (draft.reactions.some((item) => item.id === `reaction-${n}` || item.name === `반응 ${n}`)) ++n;
      draft.reactions.push({ id: `reaction-${n}`, name: `반응 ${n}`, asset: '', durationSec: 5 });
      renderReactions(); updateEditing();
      q('ptReactions').lastElementChild.querySelector('input').focus();
      return;
    }
    if (action === 'delete') {
      draft.reactions.splice(index, 1);
      renderReactions(); updateEditing();
      (q('ptReactions').children[Math.min(index, draft.reactions.length - 1)]?.querySelector('input') || root.querySelector('[data-pt="add"]')).focus();
      return;
    }
    if (action === 'remove-asset') {
      if (reaction) reaction.asset = '';
      else draft[target.dataset.slot] = '';
      renderAssets(true); updateEditing();
      return;
    }
    const errors = {
      discover: 'OBS 소스를 불러오지 못했습니다. OBS 연결을 확인하고 새로고침하세요.',
      import: '이미지를 가져오지 못했습니다. 파일을 확인하고 다시 가져오세요.',
      test: '반응을 실행하지 못했습니다. 저장 상태와 짚톡 사용 설정을 확인하세요.',
      clear: '반응과 대기열을 비우지 못했습니다. 다시 시도하세요.',
      'copy-url': '주소를 복사하지 못했습니다. 다시 복사하세요.',
      'copy-variable': '변수를 복사하지 못했습니다. 저장 상태를 확인하고 다시 복사하세요.',
    };
    void run(async () => {
      if (action === 'discover') { accept(await api().pngtuberDiscover()); notice('소스 목록을 새로고침했습니다.'); }
      if (action === 'import') {
        const next = await api().pngtuberImport();
        if (!next) return;
        // Imports change the asset catalog only; the assignment remains an explicit-save draft.
        const currentDraft = clone(draft);
        accept(next);
        draft = currentDraft;
        if (next.importedAssetId) {
          if (index >= 0) draft.reactions[index].asset = next.importedAssetId;
          else draft[target.dataset.slot] = next.importedAssetId;
        }
        renderAssets(true);
        notice(next.importedAssetId ? '이미지를 가져왔습니다. 저장 대기 중입니다.' : '이미지 선택이 취소되었습니다.');
      }
      if (action === 'test' && reaction && !dirty()) {
        const result = await api().pngtuberTrigger({ reactionId: reaction.id, durationSec: reaction.durationSec });
        if (result?.ok === false) {
          const reasons = {
            disabled: '짚톡이 꺼져 있습니다. 사용 설정을 켜고 저장하세요.',
            'queue-full': '반응 대기열이 가득 찼습니다. 대기열을 비우거나 재생이 끝난 뒤 다시 시도하세요.',
            'unknown-reaction': '저장된 반응을 찾을 수 없습니다. 설정을 새로 불러오세요.',
            'ambiguous-reaction': '반응을 구분할 수 없습니다. 반응 ID를 확인하세요.',
            'invalid-reaction': '반응 ID를 확인하고 다시 저장하세요.',
            'invalid-duration': '반응 표시 시간을 확인하고 다시 저장하세요.',
            expired: '반응 요청이 만료되었습니다. 다시 테스트하세요.',
          };
          notice(reasons[result.reason] || '반응 요청이 거절되었습니다. 설정을 확인하고 다시 시도하세요.', true);
        } else if (result?.ok === true) {
          notice('반응을 요청했습니다.');
        } else throw new Error('Invalid trigger result');
        try { accept(await api().pngtuberState()); }
        catch { notice('반응 요청 후 상태를 불러오지 못했습니다. 다시 시도하세요.', true, true); }
      }
      if (action === 'clear') { accept(await api().pngtuberCommand('clear')); notice('반응과 대기열을 비웠습니다.'); }
      if (action === 'copy-url' || action === 'copy-variable') {
        if (action === 'copy-variable' && (dirty() || !reaction)) return;
        const copied = action === 'copy-url' ? await api().pngtuberCopy('url') : await api().pngtuberCopy('variable', { reactionId: reaction.id, durationSec: reaction.durationSec });
        if (!copied) throw new Error('Copy failed');
        notice(action === 'copy-url' ? '브라우저 소스 주소를 복사했습니다.' : '반응 변수를 복사했습니다.');
      }
    }, errors[action] || '작업을 완료하지 못했습니다. 다시 시도하세요.');
  });

  root.addEventListener('error', (event) => {
    if (event.target.tagName !== 'IMG') return;
    event.target.dataset.failedUrl = event.target.src;
    event.target.hidden = true;
    const slot = event.target.closest('[data-pt-slot]');
    slot.querySelector('.pt-thumbnail span').hidden = false;
    slot.querySelector('[data-pt-asset-status]').textContent = '이미지를 불러오지 못했습니다.';
  }, true);
  window.addEventListener('beforeunload', (event) => {
    if (!dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  new MutationObserver(visibilityChanged).observe(page, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', visibilityChanged);
  visibilityChanged();
})();
