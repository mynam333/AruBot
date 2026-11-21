const load = require('./helpers/load-source.cjs');
const loadFunctions = require('./helpers/load-server-functions.cjs');
const { annotatePointDisplay } = load('server/point-variable-display.js');

function renderer(bonus, ordinary = 500) {
  const getViewerBroadcastBonus = jest.fn().mockResolvedValue(bonus);
  const { substituteAllPlaceholders } = loadFunctions(['substituteAllPlaceholders'], {
    substituteDdayVariables: text => text, resolveStreamerUidForSid: async () => 'channel',
    getChannelPoints: async () => ordinary, getViewerBroadcastBonus, annotatePointDisplay,
  });
  return { bonus: getViewerBroadcastBonus, render: (text, ctx) => substituteAllPlaceholders(text, 'user:owner', 'viewer', 'Viewer', ctx) };
}
test('both displayed aliases use the actual remaining allowance once, after any attached point unit', async () => {
  const r = renderer({ live: true, amount: 300, remaining: 25 }, 0);
  expect(await r.render('{user.points} / {user.channelPoints}P / {user.points}포인트')).toBe('0 (+25) / 0P (+25) / 0포인트 (+25)');
  expect(r.bonus.mock.calls).toEqual([['user:owner', 'viewer']]);
});
test.each([{live:true, remaining:0}, {live:false, remaining:25}, {live:true, remaining:null}, null])(
  'no suffix when the viewer has no active extra points (%j)', async bonus => {
    expect(await renderer(bonus).render('{user.points}P')).toBe('500P');
  });
test('bonus lookup failure does not mask the ordinary balance', async () => {
  const r = renderer();
  r.bonus.mockRejectedValue(new Error('unavailable'));
  expect(await r.render('{user.points}')).toBe('500');
});
test('no extra balance lookup for action inputs, unidentified viewers or messages without balance tokens', async () => {
  const r = renderer({live:true, remaining:12});
  expect(await r.render('${action::{user.points}}')).toBe('${action::500}');
  expect(await r.render('{user.points}', {pointViewerId:''})).toBe('500');
  expect(await r.render('안녕')).toBe('안녕');
  expect(r.bonus).not.toHaveBeenCalled();
  expect(await r.render('${action::{user.points}} {user.points}')).toBe('${action::500} 500 (+12)');
});
