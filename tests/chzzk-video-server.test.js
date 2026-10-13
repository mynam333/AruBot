const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = ts.createSourceFile('index.js', fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find((node) => ts.isVariableStatement(node)
  && node.declarationList.declarations.some((item) => item.name?.text === 'chzzkVideoRuntime')).getText(source);

function harness(items, cancel = jest.fn(async () => {})) {
  const notifyPlayback = jest.fn(async () => {});
  const broadcastPvdStart = jest.fn(async () => {});
  const notifyPvdAdminSubscribers = jest.fn(async () => {});
  const bindings = {
    createChzzkVideoRuntime: (callbacks) => ({ ...callbacks, notifyPlayback }),
    chzzkVideoStore: { cancel }, getVideoQueue: () => items,
    broadcastPvdStart, notifyPvdAdminSubscribers,
  };
  const runtime = new Function(...Object.keys(bindings), `${declaration}; return chzzkVideoRuntime;`)(...Object.values(bindings));
  return { runtime, cancel, notifyPlayback, broadcastPvdStart, notifyPvdAdminSubscribers };
}

test('upstream skip completes only the matched donation and reports current playback end', async () => {
  const head = { id: 'current', source: 'chzzk-donation', chzzkDonationId: 'd1' };
  const next = { id: 'next', source: 'chzzk-donation', chzzkDonationId: 'd2' };
  const items = [head, next];
  const h = harness(items);
  await h.runtime.remove('sid', 'd1');
  expect(h.cancel).toHaveBeenCalledWith('sid', 'd1');
  expect(items).toEqual([next]);
  expect(h.notifyPlayback).toHaveBeenCalledWith('sid', head, 'end');
  expect(h.broadcastPvdStart).toHaveBeenCalledWith('sid');
});

test('skipping a queued donation does not interrupt unrelated current playback', async () => {
  const head = { id: 'current', source: 'viewer' };
  const items = [head, { id: 'next', source: 'chzzk-donation', chzzkDonationId: 'd2' }];
  const h = harness(items);
  await h.runtime.remove('sid', 'd2');
  expect(items).toEqual([head]);
  expect(h.notifyPlayback).not.toHaveBeenCalled();
  expect(h.broadcastPvdStart).not.toHaveBeenCalled();
  expect(h.notifyPvdAdminSubscribers).toHaveBeenCalledWith('sid', 'chzzk_skipped');
});

test('failed durable cancellation is surfaced without claiming local completion', async () => {
  const head = { id: 'current', source: 'chzzk-donation', chzzkDonationId: 'd1' };
  const items = [head];
  const h = harness(items, jest.fn(async () => { throw new Error('database unavailable'); }));
  await expect(h.runtime.remove('sid', 'd1')).rejects.toThrow('database unavailable');
  expect(items).toEqual([head]);
  expect(h.notifyPlayback).not.toHaveBeenCalled();
  expect(h.broadcastPvdStart).not.toHaveBeenCalled();
});
