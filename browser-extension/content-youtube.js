(function () {
  if (window.__aruPauseContentLoaded) return;
  window.__aruPauseContentLoaded = true;

  const state = {
    until: 0,
    extensionPaused: false,
    shouldResume: false,
    overlay: null,
    interval: null
  };

  function getVideos() {
    return Array.from(document.querySelectorAll('video')).filter((video) => !video.disablePictureInPicture || video.readyState >= 0);
  }

  function formatRemaining(ms) {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function ensureOverlay() {
    if (state.overlay && document.documentElement.contains(state.overlay)) return state.overlay;
    const overlay = document.createElement('div');
    overlay.id = 'aru-pause-overlay';
    overlay.setAttribute('aria-live', 'polite');
    overlay.style.cssText = [
      'position:fixed',
      'right:18px',
      'bottom:18px',
      'z-index:2147483647',
      'display:none',
      'align-items:center',
      'gap:10px',
      'padding:10px 12px',
      'border:1px solid rgba(255,255,255,.18)',
      'border-radius:8px',
      'background:rgba(12,18,24,.86)',
      'color:#f7fbff',
      'box-shadow:0 18px 54px rgba(0,0,0,.32)',
      'backdrop-filter:blur(16px)',
      'font:600 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'letter-spacing:0'
    ].join(';');
    overlay.innerHTML = '<span style="width:8px;height:8px;border-radius:99px;background:#35d399;box-shadow:0 0 0 4px rgba(53,211,153,.16)"></span><span>Aru Pause</span><strong data-time style="font-variant-numeric:tabular-nums"></strong>';
    document.documentElement.appendChild(overlay);
    state.overlay = overlay;
    return overlay;
  }

  function updateOverlay() {
    const overlay = ensureOverlay();
    const remaining = state.until - Date.now();
    if (remaining > 0) {
      overlay.style.display = 'flex';
      const time = overlay.querySelector('[data-time]');
      if (time) time.textContent = formatRemaining(remaining);
    } else {
      overlay.style.display = 'none';
    }
  }

  function pauseVideos(until) {
    state.until = Math.max(state.until, Number(until) || 0);
    const videos = getVideos();
    if (!state.extensionPaused) {
      state.shouldResume = videos.some((video) => !video.paused && !video.ended);
    }
    for (const video of videos) {
      try { video.pause(); } catch {}
    }
    state.extensionPaused = true;
    updateOverlay();
    if (!state.interval) {
      state.interval = setInterval(() => {
        if (state.until > Date.now()) {
          for (const video of getVideos()) {
            if (!video.paused) {
              try { video.pause(); } catch {}
            }
          }
          updateOverlay();
        } else {
          resumeVideos();
        }
      }, 350);
    }
  }

  function resumeVideos() {
    const shouldResume = state.shouldResume;
    state.until = 0;
    state.extensionPaused = false;
    state.shouldResume = false;
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = null;
    }
    updateOverlay();
    if (!shouldResume) return;
    const videos = getVideos();
    for (const video of videos) {
      if (video.ended) continue;
      const result = video.play();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'aru-pause:pause') {
      pauseVideos(message.until);
    } else if (message?.type === 'aru-pause:resume') {
      resumeVideos();
    }
  });
})();
