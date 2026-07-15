const path = require('path');
const { execFileSync } = require('child_process');

describe('video donation start/end timing', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/video-donation-timing.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const timing = await import(${JSON.stringify(moduleUrl)});
      const resolve = (input) => timing.resolveVideoDonationTiming(input);
      console.log(JSON.stringify({
        full: resolve({ mediaDurationSec: 120, maxDurationSec: 600 }),
        startOnly: resolve({ startSec: 30, mediaDurationSec: 120, maxDurationSec: 600 }),
        endOnly: resolve({ endSec: 45, mediaDurationSec: 120, maxDurationSec: 600 }),
        range: resolve({ startSec: 30, endSec: 45, mediaDurationSec: 120, maxDurationSec: 600 }),
        minuteSecondRange: resolve({ startSec: '1:23', endSec: '2:05', mediaDurationSec: 180, maxDurationSec: 600 }),
        zeroPaddedRange: resolve({ startSec: '00:30', endSec: '01:00', mediaDurationSec: 120, maxDurationSec: 600 }),
        invalidRange: resolve({ startSec: 30, endSec: 30, mediaDurationSec: 120 }),
        invalidStart: resolve({ startSec: 'abc', mediaDurationSec: 120 }),
        invalidMinuteSecond: resolve({ startSec: '1:60', endSec: '2:00', mediaDurationSec: 180 }),
        pastEnd: resolve({ startSec: 120, mediaDurationSec: 120 }),
        mediaClamp: resolve({ startSec: 30, endSec: 200, mediaDurationSec: 120, maxDurationSec: 600 }),
        maxClamp: resolve({ startSec: 30, endSec: 200, mediaDurationSec: 300, maxDurationSec: 60 }),
        unknownDefault: resolve({ startSec: 10, mediaDurationSec: null, maxDurationSec: 600 }),
        unknownExplicit: resolve({ startSec: 10, endSec: 25, mediaDurationSec: null, maxDurationSec: 600 }),
        legacy: resolve({ startSec: 10, legacyPlaySec: 15, mediaDurationSec: 120, maxDurationSec: 600 }),
        watchDuration: timing.extractYouTubeWatchDurationSec('<script>ytInitialPlayerResponse={"videoDetails":{"title":"x","lengthSeconds":"123"}}</script>'),
        escapedWatchDuration: timing.extractYouTubeWatchDurationSec('{\\"videoDetails\\":{\\"lengthSeconds\\":\\"77\\"}}'),
        approximateDuration: timing.extractYouTubeWatchDurationSec('{"approxDurationMs":"1501"}'),
        isoDuration: timing.extractYouTubeWatchDurationSec('<meta itemprop="duration" content="PT2M3S">'),
      }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());
  });

  test('defaults to 0 seconds through the known end of the video', () => {
    expect(result.full).toMatchObject({ ok: true, startSec: 0, durationSec: 120, actualEndSec: 120, requestedEndSec: null });
    expect(result.startOnly).toMatchObject({ ok: true, startSec: 30, durationSec: 90, actualEndSec: 120 });
  });

  test('treats the third argument as an absolute end second', () => {
    expect(result.endOnly).toMatchObject({ ok: true, startSec: 0, requestedEndSec: 45, durationSec: 45, actualEndSec: 45 });
    expect(result.range).toMatchObject({ ok: true, startSec: 30, requestedEndSec: 45, durationSec: 15, actualEndSec: 45 });
  });

  test('accepts minute:second values for both start and end', () => {
    expect(result.minuteSecondRange).toMatchObject({ ok: true, startSec: 83, requestedEndSec: 125, durationSec: 42, actualEndSec: 125 });
    expect(result.zeroPaddedRange).toMatchObject({ ok: true, startSec: 30, requestedEndSec: 60, durationSec: 30, actualEndSec: 60 });
    expect(result.invalidMinuteSecond).toMatchObject({ ok: false, code: 'invalid_start_sec' });
  });

  test('rejects invalid ranges and starts beyond a known video end', () => {
    expect(result.invalidRange).toMatchObject({ ok: false, code: 'end_not_after_start' });
    expect(result.invalidStart).toMatchObject({ ok: false, code: 'invalid_start_sec' });
    expect(result.pastEnd).toMatchObject({ ok: false, code: 'start_after_media_end' });
  });

  test('clamps the requested end to both the media end and configured maximum', () => {
    expect(result.mediaClamp).toMatchObject({ ok: true, durationSec: 90, actualEndSec: 120, requestedEndSec: 200 });
    expect(result.maxClamp).toMatchObject({ ok: true, durationSec: 60, actualEndSec: 90, requestedEndSec: 200 });
  });

  test('requires metadata for an omitted end but accepts an explicit range without it', () => {
    expect(result.unknownDefault).toMatchObject({ ok: true, durationSec: null, actualEndSec: null, needsMediaDuration: true });
    expect(result.unknownExplicit).toMatchObject({ ok: true, startSec: 10, requestedEndSec: 25, durationSec: 15, needsMediaDuration: false });
  });

  test('keeps legacy REST duration input compatible without changing new end semantics', () => {
    expect(result.legacy).toMatchObject({ ok: true, startSec: 10, requestedEndSec: null, requestedPlaySec: 15, durationSec: 15, actualEndSec: 25 });
  });

  test('extracts YouTube duration from watch-page metadata fallbacks', () => {
    expect(result.watchDuration).toBe(123);
    expect(result.escapedWatchDuration).toBe(77);
    expect(result.approximateDuration).toBe(2);
    expect(result.isoDuration).toBe(123);
  });
});
