const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'viewer', 'drawing-donation-page.tsx'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

describe('drawing live viewer regression', () => {
  test('resolves both HLS and YouTube playback through the live endpoint', () => {
    expect(page).toContain('loadLivePlayback(selectedSurface)');
    expect(page).toContain('setLiveEmbedUrl(embedUrl)');
    expect(page).toContain('src={liveEmbedUrl}');
    expect(page).not.toContain('src={selectedSurface.embedUrl}');
    expect(server).toContain("['chzzk', 'cime', 'youtube'].includes(provider)");
  });

  test('prefers HLS.js before native playback and preserves it across sound changes', () => {
    expect(page.indexOf('if (!Hls.isSupported())')).toBeLessThan(page.indexOf("video.canPlayType('application/vnd.apple.mpegurl')"));
    expect(page).toContain('}, [livePlaybackUrl]);');
    expect(page).toContain('}, [liveMuted, livePlaybackUrl, liveVolume]);');
    expect(page).toContain('video.addEventListener(\'playing\', onPlaying)');
  });

  test('keeps drawing available and offers retry when playback is offline or fails', () => {
    expect(page).toContain("setLivePlaybackStatus(offline ? 'offline' : 'error')");
    expect(page).toContain("if (offline) retryTimer = setTimeout");
    expect(page).toContain('onClick={() => setPlaybackRetryToken((current) => current + 1)}');
    expect(page).toContain('onPointerDown={startStroke}');
  });
});
