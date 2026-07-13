const fs = require('fs');
const path = require('path');

describe('drawing donation overlay alert sound regression', () => {
  const componentPath = path.join(__dirname, '..', 'src', 'components', 'DrawingDonationOverlay.tsx');
  const component = fs.readFileSync(componentPath, 'utf8');

  test('ships a non-empty production alert sound and preloads it in the overlay', () => {
    const alertPath = path.join(__dirname, '..', 'public', 'files', 'drawing_alert.mp3');

    expect(fs.existsSync(alertPath)).toBe(true);
    expect(fs.statSync(alertPath).size).toBeGreaterThan(0);
    expect(component).toContain("const DRAWING_ALERT_AUDIO_SRC = '/files/drawing_alert.mp3'");
    expect(component).toContain('src={DRAWING_ALERT_AUDIO_SRC} preload="auto" playsInline');
  });

  test('plays once only after a new drawing id passes the websocket dedupe gate', () => {
    const applyStart = component.indexOf('const applyIncomingItem');
    const applyEnd = component.indexOf('useEffect(() => {', applyStart);
    const applyBody = component.slice(applyStart, applyEnd);

    expect(applyBody).toContain('if (nextItem.id === playingIdRef.current) return');
    expect(applyBody.indexOf('if (nextItem.id === playingIdRef.current) return'))
      .toBeLessThan(applyBody.indexOf('playDrawingAlert()'));
    expect(applyBody.indexOf('playDrawingAlert()')).toBeLessThan(applyBody.indexOf('setItem(nextItem)'));
  });

  test('restarts the sound safely without allowing an audio error to block drawing', () => {
    const playStart = component.indexOf('const playDrawingAlert');
    const playEnd = component.indexOf('const pop', playStart);
    const playBody = component.slice(playStart, playEnd);

    expect(playBody).toContain('audio.pause()');
    expect(playBody).toContain('audio.currentTime = 0');
    expect(playBody).toContain('audio.play()');
    expect(playBody).toContain('playback.catch(() => undefined)');
  });

  test('an old completion response cannot clear a newer drawing', () => {
    const popStart = component.indexOf('const pop');
    const popEnd = component.indexOf('const applyIncomingItem', popStart);
    const popBody = component.slice(popStart, popEnd);

    expect(popBody).toContain('if (playingIdRef.current !== completedItemId) return');
    expect(popBody).toContain('current?.id === completedItemId ? null : current');
    expect(component).toContain('void pop(item.id)');
  });
});
