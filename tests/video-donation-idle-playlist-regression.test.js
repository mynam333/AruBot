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

  test('대기곡 종료는 후원 큐를 pop하지 않고 후원 영상이 항상 우선해야 함', () => {
    expect(pvdViewer).toContain("playbackModeRef.current !== 'donation'");
    expect(pvdViewer).toContain("idleAdvanceRef.current('end')");
    expect(pvdViewer).toContain("idleAdvanceRef.current('error')");
    expect(pvdViewer).toContain("playbackModeRef.current = 'donation'");
    expect(pvdViewer).toContain('captureIdlePosition();');
    expect(pvdViewer).toContain('if (playlist.enabled) startIdlePlayback();');
    expect(pvdViewer).toContain('expectedYouTubeMediaIdRef');
    expect(pvdViewer).toContain('getVideoData');
    expect(pvdViewer).toContain('if (!isExpectedYouTubePlayerMedia()) return;');
  });

  test('반복과 셔플을 지원하고 반복 비활성화 시 한 바퀴 뒤 종료해야 함', () => {
    expect(idleModel).toContain('source.loop !== false');
    expect(idleModel).toContain('source.shuffle === true');
    expect(idleModel).toContain('createPvdIdlePlaybackOrder');
    expect(pvdViewer).toContain('if (!playlist.loop) break;');
    expect(pvdViewer).toContain('idleExhaustedRef.current = true;');
  });

  test('관리자 설정에서 대기 음악 토글, 모드, 주제, 반복, 셔플과 곡 편집을 제공해야 함', () => {
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
