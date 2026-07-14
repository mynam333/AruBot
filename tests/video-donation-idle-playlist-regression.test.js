const fs = require('fs');
const path = require('path');

describe('영상 후원 대기 플레이리스트 회귀 방지', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const pvdViewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'PvdViewer.tsx'), 'utf8');
  const idleModel = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'pvdIdlePlaylist.ts'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'video-donation-idle-playlist-editor.tsx'), 'utf8');
  const settingsDialog = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'admin-action-dialogs.tsx'), 'utf8');

  test('추천 목록과 직접 구성 목록을 별도로 저장하고 현재 모드 목록만 오버레이에 전달해야 함', () => {
    expect(serverIndex).toContain('recommendedTracks: normalizePvdIdleTracks');
    expect(serverIndex).toContain('customTracks: normalizePvdIdleTracks');
    expect(serverIndex).toContain("const tracks = playlist.mode === 'custom' ? playlist.customTracks : playlist.recommendedTracks");
    expect(serverIndex).toContain('videoDonationIdlePlaylist: idlePlaylist');
    expect(serverIndex).toContain('idlePlaylist: getPvdIdlePlaylistForViewer(settings.videoDonationIdlePlaylist)');
  });

  test('YouTube 플레이리스트는 페이지를 순회해 곡 단위로 펼치고 최대 개수를 제한해야 함', () => {
    expect(serverIndex).toContain("youtubeApiGetPublic('playlistItems'");
    expect(serverIndex).toContain('nextPageToken');
    expect(serverIndex).toContain('PVD_IDLE_PLAYLIST_MAX_TRACKS = 200');
    expect(serverIndex).toContain("app.post('/api/video-donation/idle-playlist/resolve'");
    expect(serverIndex).toContain("app.post('/api/video-donation/idle-playlist/recommend'");
  });

  test('주제 추천 곡 수는 1~200곡으로 저장하고 50곡 단위 페이지를 이어서 구성해야 함', () => {
    expect(serverIndex).toContain('normalizePvdIdleRecommendationCount');
    expect(serverIndex).toContain('recommendationCount,');
    expect(serverIndex).toContain('maxResults: 50');
    expect(serverIndex).toContain('pageToken: entry.started ? entry.nextPageToken');
    expect(serverIndex).toContain('entry.tracks.length < safeLimit');
    expect(editor).toContain('value.recommendationCount');
    expect(editor).toContain('max={MAX_VIDEO_DONATION_IDLE_TRACKS}');
    expect(editor).toContain('추천 곡 수');
  });

  test('추천 결과는 주제별로 재사용하고 동시에 같은 주제를 구성해도 API 요청을 합쳐야 함', () => {
    expect(serverIndex).toContain('PVD_IDLE_RECOMMENDATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000');
    expect(serverIndex).toContain('pvdIdleRecommendationCache');
    expect(serverIndex).toContain('pvdIdleRecommendationInFlight');
    expect(serverIndex).toContain('withPvdIdleRecommendationLock');
    expect(serverIndex).toContain('cacheHit: hadFreshCache && searchRequests === 0 && detailRequests === 0');
  });

  test('재생 시간이 확인된 10분 이하 영상만 대기 음악으로 저장해야 함', () => {
    expect(serverIndex).toContain('PVD_IDLE_TRACK_MAX_DURATION_SEC = 10 * 60');
    expect(serverIndex).toContain('durationSec > PVD_IDLE_TRACK_MAX_DURATION_SEC');
    expect(serverIndex).toContain('{ requireKnownDuration: true }');
    expect(serverIndex).toContain('10분 이하이며 재생 시간이 확인된 YouTube 영상만 추가할 수 있습니다.');
    expect(editor).toContain('최대 10분');
  });

  test('대기곡 재생 중 들어온 첫 후원은 곡이 끝날 때까지 정지된 대기열 head로 유지해야 함', () => {
    expect(serverIndex).toContain('broadcastPvdStart(job.sid, { deferForIdle: true })');
    expect(serverIndex).toContain('pausedAtSec: idleDeferred ? getPvdItemStartSec(item) : null');
    expect(serverIndex).toContain('if (state.paused) return;');
    expect(serverIndex).toContain("app.post('/api/video-donation/activate-by-token'");
    expect(serverIndex).toContain('if (!state?.idleDeferred || state.itemKey !== itemKey)');
    expect(serverIndex).toContain('await broadcastPvdStart(sid, { activateDeferredPlayback: true })');

    expect(pvdViewer).toContain('if (payload.idleDeferred === true)');
    expect(pvdViewer).toContain('deferredDonationRef.current = item;');
    expect(pvdViewer).toContain("playbackModeRef.current === 'idle' && idlePlayingRef.current");
    expect(pvdViewer).toContain('if (e?.data === YT.PlayerState.PLAYING) idlePlayingRef.current = true;');
    expect(pvdViewer).toContain('activateDeferredDonation(deferredItem);');
    const nextTrackSelection = pvdViewer.indexOf('idleCurrentMediaIdRef.current = nextMediaId;');
    const deferredActivation = pvdViewer.indexOf('activateDeferredDonation(deferredItem);', nextTrackSelection);
    expect(nextTrackSelection).toBeGreaterThan(-1);
    expect(deferredActivation).toBeGreaterThan(nextTrackSelection);
  });

  test('지연 중인 head 교체와 대기 음악 비활성화도 안전하게 상태를 전환해야 함', () => {
    expect(serverIndex).toContain('const wasIdleDeferred = pvdPlaybackState.get(sid)?.idleDeferred === true;');
    expect(serverIndex).toContain('broadcastPvdStart(sid, { deferForIdle: wasIdleDeferred })');
    expect(serverIndex).toContain('if (!viewerIdlePlaylist.enabled && pvdPlaybackState.get(sid)?.idleDeferred)');
    expect(serverIndex).toContain('await activateDeferredPvdPlayback(sid);');
    expect(serverIndex).toContain('idleDeferred: state?.idleDeferred === true');
    expect(pvdViewer).toContain('if (deferredItem) activateDeferredDonation(deferredItem);');
  });

  test('대기곡과 후원 종료 이벤트는 서로의 큐 처리 경로를 침범하지 않아야 함', () => {
    expect(pvdViewer).toContain("playbackModeRef.current !== 'donation'");
    expect(pvdViewer).toContain("idleAdvanceRef.current('end')");
    expect(pvdViewer).toContain("idleAdvanceRef.current('error')");
    expect(pvdViewer).toContain("playbackModeRef.current = 'donation'");
    expect(pvdViewer).toContain('captureIdlePosition();');
    expect(pvdViewer).toContain('if (playlist.enabled) startIdlePlayback();');
    expect(pvdViewer).toContain('expectedYouTubeMediaIdRef');
    expect(pvdViewer).toContain('getVideoData');
    expect(pvdViewer).toContain('if (!isExpectedYouTubePlayerMedia(e?.target)) return;');
    expect(pvdViewer).toContain('if (sourcePlayer && sourcePlayer !== playerRef.current) return false;');
  });

  test('후원 종료 뒤에는 분리된 YouTube 대상 노드를 재사용하지 않고 서버 상태를 다시 확인해야 함', () => {
    expect(pvdViewer).toContain('const createYouTubePlayerMount = useCallback');
    expect(pvdViewer).toContain('host.appendChild(mount);');
    expect(pvdViewer).toContain('new YT.Player(mount, {');
    expect(pvdViewer).not.toContain('new YT.Player(playerDivRef.current, {');
    expect(pvdViewer).toContain('void playbackSyncRef.current(true);');
    expect(pvdViewer).toContain('playbackSyncRef.current = resyncFromServer;');
  });

  test('반복과 셔플을 지원하고 반복 비활성화 시 한 바퀴 뒤 종료해야 함', () => {
    expect(idleModel).toContain('source.loop !== false');
    expect(idleModel).toContain('source.shuffle === true');
    expect(idleModel).toContain('createPvdIdlePlaybackOrder');
    expect(pvdViewer).toContain('if (!playlist.loop) break;');
    expect(pvdViewer).toContain('idleExhaustedRef.current = true;');
  });

  test('관리자 설정에서 대기 음악 토글, 모드, 주제, 곡 수, 반복, 셔플과 곡 편집을 제공해야 함', () => {
    expect(settingsDialog).toContain('<VideoDonationIdlePlaylistEditor value={idlePlaylist} onChange={setIdlePlaylist} />');
    expect(settingsDialog).toContain('idlePlaylist,');
    expect(editor).toContain('대기 음악');
    expect(editor).toContain('주제 추천');
    expect(editor).toContain('직접 구성');
    expect(editor).toContain('반복 재생');
    expect(editor).toContain('셔플');
    expect(editor).toContain('곡 또는 YouTube 플레이리스트');
  });
});
