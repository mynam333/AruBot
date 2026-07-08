const fs = require('fs');
const path = require('path');

describe('출석 명령어 전용 모드 회귀 방지', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const commandsPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'commands-page.tsx'), 'utf8');

  test('서버는 첫 채팅 자동 출석과 명령어 전용 출석을 설정으로 분리해야 함', () => {
    expect(serverIndex).toContain('function shouldRecordAttendanceAutomatically');
    expect(serverIndex).toContain('settings.attendanceCommandOnly !== true');
    expect(serverIndex).toContain('function isAttendanceCommandText');
    expect(serverIndex).toContain('function recordAttendanceFromCommand');
    expect(serverIndex.match(/shouldRecordAttendanceAutomatically\(settings\)/g)?.length || 0).toBeGreaterThanOrEqual(2);
    expect(serverIndex).toContain('shouldRecordAttendanceAutomatically(attendanceSettings)');
  });

  test('명령어 전용 모드에서는 지정 출석 명령어가 실제 출석을 기록해야 함', () => {
    expect(serverIndex.match(/settings\.attendanceCommandOnly === true && isAttendanceCommandText\(text, settings\)/g)?.length || 0).toBeGreaterThanOrEqual(2);
    expect(serverIndex).toContain('commandSettings.attendanceCommandOnly === true && isAttendanceCommandText(text, commandSettings)');
    expect(serverIndex.match(/recordAttendanceFromCommand\(/g)?.length || 0).toBeGreaterThanOrEqual(4);
    expect(serverIndex).toContain("attendanceCommandKeyword: normalizeAttendanceCommandKeyword(settings)");
  });

  test('관리자 출석 설정 UI는 기능 사용, 명령어 전용, 출석 명령어를 저장해야 함', () => {
    expect(commandsPage).toContain('attendanceEnabled');
    expect(commandsPage).toContain('attendanceCommandOnly');
    expect(commandsPage).toContain('attendanceCommandKeyword');
    expect(commandsPage).toContain('명령어로만 출석');
    expect(commandsPage).toContain('첫 채팅 자동 출석');
    expect(commandsPage).toContain('출석 명령어');
    expect(commandsPage).toContain('attendanceCommandKeyword: normalizeCommand(attendanceCommandKeyword ||');
  });
});
