const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

describe('스트리머별 포인트 적립 기준', () => {
  let policyResult;
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const policySource = fs.readFileSync(path.join(__dirname, '..', 'server', 'point-earning-policy.js'), 'utf8');
  const databaseSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');
  const viewerPointsPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'viewer', 'viewer-points-page.tsx'), 'utf8');
  const publicChannelPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'public', 'public-channel-page.tsx'), 'utf8');
  const publicPointSummary = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'public', 'public-point-earning-summary.tsx'), 'utf8');

  beforeAll(() => {
    const moduleUrl = new URL(
      '../server/point-earning-policy.js',
      `file://${__filename.replace(/\\/g, '/')}`,
    ).href;
    const script = `
      const {
        buildPointEarningPolicy,
        calculateDonationPointAward,
        normalizePointAward,
        resolveViewerPointEarningPolicy,
      } = await import(${JSON.stringify(moduleUrl)});

      const defaults = buildPointEarningPolicy({});
      const zeros = buildPointEarningPolicy({
        channelPointsPerChat: 0,
        channelPointsPerAttendance: 0,
        donation: { pointsPerK: 0 },
      });
      const disabledAttendance = buildPointEarningPolicy({
        channelPointsPerAttendance: 75,
        attendanceEnabled: false,
      });
      const commandAttendance = buildPointEarningPolicy({
        channelPointsPerAttendance: 25,
        attendanceCommandOnly: true,
        attendanceCommandKeyword: '출첵',
      });
      const pausedCommandAttendance = buildPointEarningPolicy({
        botEnabled: false,
        channelPointsPerAttendance: 25,
        attendanceCommandOnly: true,
        attendanceCommandKeyword: '출첵',
      });
      const invalid = buildPointEarningPolicy({
        channelPointsPerChat: -10,
        channelPointsPerAttendance: Infinity,
        donation: { pointsPerK: 'not-a-number' },
      });
      const decimalRates = buildPointEarningPolicy({
        channelPointsPerChat: 1.9,
        channelPointsPerAttendance: 2.8,
        donation: { pointsPerK: 10.5 },
      });
      const subunitRates = buildPointEarningPolicy({
        channelPointsPerChat: 0.5,
        channelPointsPerAttendance: 0.5,
        donation: { pointsPerK: 0.5 },
      });

      const settingsBySid = new Map([
        ['user:streamer-a', {
          channelPointsPerChat: 3,
          channelPointsPerAttendance: 40,
          donation: { pointsPerK: 15 },
          channelPointsExcludeUserIdsText: 'private-viewer-id',
          rouletteViewerToken: 'secret-token',
        }],
        ['user:streamer-b', {
          channelPointsPerChat: 9,
          channelPointsPerAttendance: 90,
          donation: { pointsPerK: 30 },
        }],
        ['user:resolved-owner', {
          channelPointsPerChat: 7,
          channelPointsPerAttendance: 70,
          donation: { pointsPerK: 21 },
        }],
        ['user:youtube:canonical-owner', {
          channelPointsPerChat: 4,
          channelPointsPerAttendance: 44,
          donation: { pointsPerK: 14 },
        }],
        ['youtube:canonical-owner', {
          channelPointsPerChat: 99,
          channelPointsPerAttendance: 99,
          donation: { pointsPerK: 99 },
        }],
        ['user:current-owner', {
          channelPointsPerChat: 6,
          channelPointsPerAttendance: 66,
          donation: { pointsPerK: 16 },
        }],
        ['youtube:reused-channel', {
          channelPointsPerChat: 88,
          channelPointsPerAttendance: 88,
          donation: { pointsPerK: 88 },
        }],
        ['user:stale-alias', {
          channelPointsPerChat: 55,
          channelPointsPerAttendance: 55,
          donation: { pointsPerK: 55 },
        }],
      ]);
      const calls = [];
      const getSettings = async (sid) => {
        calls.push(sid);
        return settingsBySid.get(sid) || {};
      };
      const policyA = await resolveViewerPointEarningPolicy({
        canonicalChannelUid: 'streamer-a',
        channelUid: 'platform-a',
      }, { getSettings, resolveSid: async () => null });
      const policyB = await resolveViewerPointEarningPolicy({
        canonicalChannelUid: 'streamer-b',
        channelUid: 'platform-b',
      }, { getSettings, resolveSid: async () => null });
      const resolvedLegacy = await resolveViewerPointEarningPolicy({
        canonicalChannelUid: 'legacy-channel',
        channelUid: 'legacy-channel',
      }, {
        getSettings,
        resolveSid: async (uid) => uid === 'legacy-channel' ? 'user:resolved-owner' : null,
      });
      const providerPrefixedOwner = await resolveViewerPointEarningPolicy({
        canonicalChannelUid: 'youtube:canonical-owner',
        channelUid: 'youtube:public-channel',
      }, {
        getSettings,
        resolveSid: async () => 'youtube:canonical-owner',
      });
      const reassignedChannel = await resolveViewerPointEarningPolicy({
        canonicalChannelUid: 'youtube:reused-channel',
        channelUid: 'youtube:reused-channel',
      }, {
        getSettings,
        resolveSid: async () => 'user:current-owner',
      });
      const unmappedLegacy = await resolveViewerPointEarningPolicy({
        canonicalChannelUid: 'legacy-raw',
        channelUid: 'legacy-raw',
        pointSettingsSid: 'user:resolved-owner',
      }, { getSettings });
      const emptyCanonical = await resolveViewerPointEarningPolicy({
        canonicalChannelUid: 'owner-with-defaults',
        channelUid: 'reused-alias',
      }, {
        getSettings,
        resolveSid: async () => 'user:stale-alias',
      });

      console.log(JSON.stringify({
        defaults,
        zeros,
        disabledAttendance,
        commandAttendance,
        pausedCommandAttendance,
        invalid,
        decimalRates,
        subunitRates,
        awards: [999, 1000, 1499, 1500, 2000].map((amount) => calculateDonationPointAward(amount, 10)),
        zeroRateAward: calculateDonationPointAward(5000, 0),
        invalidAward: calculateDonationPointAward('bad', 10),
        normalizedAwards: [normalizePointAward(1.9), normalizePointAward(0.5), normalizePointAward(-1)],
        policyA,
        policyB,
        resolvedLegacy,
        providerPrefixedOwner,
        reassignedChannel,
        unmappedLegacy,
        emptyCanonical,
        calls,
        policyAKeys: Object.keys(policyA).sort(),
      }));
    `;
    policyResult = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..'),
    }).trim());
  });

  test('실제 런타임 기본값과 명시적 0을 그대로 유지한다', () => {
    expect(policyResult.defaults).toMatchObject({
      chatPointsPerMessage: 1,
      attendancePoints: 0,
      attendanceEnabled: true,
      attendanceMode: 'first_chat',
      donationPointsPer1000Won: 10,
    });
    expect(policyResult.zeros).toMatchObject({
      chatPointsPerMessage: 0,
      attendancePoints: 0,
      donationPointsPer1000Won: 0,
    });
    expect(policyResult.invalid).toMatchObject({
      chatPointsPerMessage: 0,
      attendancePoints: 0,
      donationPointsPer1000Won: 0,
    });
    expect(policyResult.decimalRates).toMatchObject({
      chatPointsPerMessage: 1,
      attendancePoints: 2,
      donationPointsPer1000Won: 10,
    });
    expect(policyResult.subunitRates).toMatchObject({
      chatPointsPerMessage: 0,
      attendancePoints: 0,
      donationPointsPer1000Won: 0,
    });
    expect(policyResult.normalizedAwards).toEqual([1, 0, 0]);
  });

  test('출석 활성화 상태와 명령어 모드를 실제 설정대로 노출한다', () => {
    expect(policyResult.disabledAttendance).toMatchObject({
      attendancePoints: 75,
      attendanceEnabled: false,
      attendanceMode: 'disabled',
      attendanceCommandKeyword: null,
    });
    expect(policyResult.commandAttendance).toMatchObject({
      attendancePoints: 25,
      attendanceEnabled: true,
      attendanceMode: 'command',
      attendanceCommandKeyword: '출첵',
    });
    expect(policyResult.pausedCommandAttendance).toMatchObject({
      attendanceEnabled: true,
      attendanceOperational: false,
      attendanceMode: 'command',
      attendanceUnavailableReason: 'bot_disabled',
    });
  });

  test('후원 포인트는 기존처럼 총액 비례 계산 후 최종 소수점을 내린다', () => {
    expect(policyResult.awards).toEqual([9, 10, 14, 15, 20]);
    expect(policyResult.zeroRateAward).toBe(0);
    expect(policyResult.invalidAward).toBe(0);
    expect(serverIndex.match(/calculateDonationPointAward\(amount, pointsPerK\)/g)?.length || 0).toBe(3);
    expect(serverIndex.match(/normalizePointAward\((?:settings|pointSettings)\.channelPointsPer/g)?.length || 0).toBeGreaterThanOrEqual(9);
  });

  test('각 잔액에는 자기 스트리머 정책만 결합하고 legacy 채널도 소유자 SID로 보완한다', () => {
    expect(policyResult.policyA.chatPointsPerMessage).toBe(3);
    expect(policyResult.policyB.chatPointsPerMessage).toBe(9);
    expect(policyResult.resolvedLegacy.chatPointsPerMessage).toBe(7);
    expect(policyResult.calls[0]).toBe('user:streamer-a');
    expect(policyResult.calls).not.toContain('platform-a');
  });

  test('provider 접두 소유자와 재할당된 채널에서도 현재 canonical 설정만 사용한다', () => {
    expect(policyResult.providerPrefixedOwner.chatPointsPerMessage).toBe(4);
    expect(policyResult.reassignedChannel.chatPointsPerMessage).toBe(6);
    expect(policyResult.unmappedLegacy.chatPointsPerMessage).toBe(7);
    expect(policyResult.emptyCanonical).toMatchObject({
      chatPointsPerMessage: 1,
      attendancePoints: 0,
      donationPointsPer1000Won: 10,
    });
    expect(policyResult.calls).not.toContain('youtube:canonical-owner');
    expect(policyResult.calls).not.toContain('youtube:reused-channel');
  });

  test('응답 정책은 허용된 적립 필드만 포함하고 내부 설정을 노출하지 않는다', () => {
    expect(policyResult.policyAKeys).toEqual([
      'attendanceCommandKeyword',
      'attendanceEnabled',
      'attendanceMode',
      'attendanceOperational',
      'attendancePoints',
      'attendanceUnavailableReason',
      'chatPointsPerMessage',
      'donationPointsPer1000Won',
      'donationRounding',
    ]);
    expect(policySource).not.toContain('channelPointsExcludeUserIdsText');
    expect(policySource).not.toContain('rouletteViewerToken');
  });

  test('개인 포인트 응답은 설정을 다시 읽지 않고 기존 잔액과 방송국 정보만 유지한다', () => {
    const routeStart = serverIndex.indexOf("app.get('/api/viewer/points'");
    const routeEnd = serverIndex.indexOf("app.post('/api/account/platforms/refresh'", routeStart);
    const viewerRoute = serverIndex.slice(routeStart, routeEnd);
    expect(viewerRoute.indexOf('getCurrentSessionUserId(req)')).toBeLessThan(viewerRoute.indexOf('readRealtimeCached('));
    expect(viewerRoute).toContain('listPlatformAccountsForUserIds(settingsOwnerIds)');
    expect(viewerRoute).toContain('const normalizedBalances = balances.map((balance) =>');
    expect(viewerRoute).toContain('listStationChannelsForViewerBalance(balance, stationAccountsByOwner.get(settingsOwnerId) || [])');
    expect(viewerRoute).not.toContain('getViewerPlatformLiveState');
    expect(viewerRoute).toContain('delete publicBalance.pointSettingsSid');
    expect(viewerRoute).toContain('publicUid,');
    expect(viewerRoute).toContain('home: `/c/${encodedPublicUid}`');
    expect(viewerRoute).not.toContain('pointEarning');
    expect(viewerRoute).not.toContain('getBotSettings');
    expect(viewerRoute).not.toContain('loadPublicPointEarningPolicy');
    expect(viewerRoute).not.toContain('resolvePublicChannelSid');
    expect(databaseSource).toContain('if (platformIdentityTablesReadyPromise) return platformIdentityTablesReadyPromise');
    expect(databaseSource).toContain('pointSettingsSid: canonicalChannelUid.startsWith');
    expect(serverIndex.match(/invalidatePublicPointPolicyCache\(sid\);/g)?.length || 0).toBeGreaterThanOrEqual(3);
  });

  test('공개 채널 홈에만 모바일 친화적인 세 가지 적립 기준을 표시한다', () => {
    expect(publicChannelPage).toContain('const pointEarning = readPublicPointEarningPolicy(data.points)');
    expect(publicChannelPage).toContain('<PublicPointEarningSummary policy={pointEarning} />');
    expect(publicChannelPage).toContain('<Link href="/" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold">');
    expect(publicChannelPage).not.toContain('<Link href={`/c/${channelUid}`} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold">');
    expect(publicChannelPage).toContain('aria-label={`${channelName} 공개 채널 메뉴`}');
    expect(publicChannelPage).toContain("aria-current={selected ? 'page' : undefined}");
    expect(publicPointSummary).toContain('방송 중 채팅 1회');
    expect(publicPointSummary).toContain('출석 완료 1회');
    expect(publicPointSummary).toContain('후원 1,000원 기준');
    expect(publicPointSummary).toContain('후원 금액에 비례해 계산한 뒤 소수점 내림');
    expect(publicPointSummary).toContain('grid gap-3 sm:grid-cols-3');
    expect(publicPointSummary).toContain("attendanceOperational ? pointRewardLabel(attendancePoints) : '일시 중지'");
    expect(publicPointSummary.match(/aria-hidden="true"/g)).toHaveLength(3);
    expect(publicPointSummary).toContain('break-words');
    expect(viewerPointsPage).not.toContain('PointEarningSummary');
    expect(viewerPointsPage).not.toContain('pointEarning');
    expect(viewerPointsPage).toContain('viewerBalanceLiveStatus(balance, liveByChannel)');
    expect(viewerPointsPage).toContain('stationChannelPublicUid(balance, channel)');
    expect(viewerPointsPage).toContain('key={viewerBalanceKey(balance)}');
    expect(viewerPointsPage).toContain('aria-label="스트리머 이름 또는 채널 ID 검색"');
    expect(viewerPointsPage).toContain('aria-pressed={sortBy === value}');
    expect(viewerPointsPage).toContain('공개 페이지');
    expect(viewerPointsPage).toContain('방송국 바로가기');
  });
});
