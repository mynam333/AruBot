const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');

const filename = path.join(__dirname, '../server/supabase.js');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
const declarations = ['completeDrawingDonationItem', 'updateDrawingDonationItemStatus', 'normalizeDrawingDonationRow'].map((name) =>
  source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source));
const code = ts.transpileModule(declarations.join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness() {
  const rows = [
    { sid: 'user:streamer', id: 'drawing-1', status: 'playing', stroke_object_key: 'unavailable.json.gz' },
    { sid: 'user:streamer', id: 'drawing-2', status: 'approved' },
  ];
  const query = jest.fn(async (sql, [sid, id, status]) => {
    const row = rows.find((entry) => entry.sid === sid && entry.id === id);
    if (sql.trim().startsWith('update')) {
      if (!row || (!status && row.status !== 'playing')) return { rows: [] };
      const keepStatus = status === 'approved' && ['playing', 'done'].includes(row.status)
        && sql.includes("status = case when status in ('playing', 'done') then status else $3 end");
      if (!keepStatus) row.status = status || 'done';
    }
    return { rows: row ? [{ ...row }] : [] };
  });
  const db = {
    ensureDrawingDonationTables: async () => {},
    withPgClient: (callback) => callback({ query }),
    hydrateDrawingDonationStrokes: jest.fn(() => { throw new Error('storage unavailable'); }),
    cutoffIsoForDays: () => '2026-09-01', drawingRetentionDays: () => 30,
  };
  const functions = new Function(...Object.keys(db), 'exports', `${code}; return { completeDrawingDonationItem, updateDrawingDonationItemStatus };`)(...Object.values(db), {});
  const complete = jest.fn(functions.completeDrawingDonationItem);
  const cache = [{ ...rows[0] }];
  const bindings = {
    completeDrawingDonationItem: complete,
    updateDrawingDonationItemStatus: functions.updateDrawingDonationItemStatus,
    getDrawingQueue: () => cache,
    recordBotEventLogSafe: jest.fn().mockResolvedValue(undefined),
    notifyDrawingSubscribers: jest.fn().mockResolvedValue(undefined),
    notifyDrawingAdminSubscribers: jest.fn().mockResolvedValue(undefined),
  };
  const server = loadServerFunctions(['completeDrawingItemForSid', 'updateDrawingItemStatusForSid'], bindings);
  const getCurrentDrawingItemForSid = jest.fn();
  const route = loadServerFunctions.route('/api/drawing-donation/pop-by-token', {
    getDrawingSidByToken: async () => 'user:streamer',
    ...server, getCurrentDrawingItemForSid,
    console: { error: jest.fn() },
  });
  const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
  return { rows, query, db, cache, bindings, server, complete, getCurrentDrawingItemForSid, response,
    run: async (itemId = 'drawing-1') => {
      const res = response(); await route({ body: { token: 'draw_test', itemId } }, res); return res;
    },
  };
}

test('completion only updates the acknowledged playing drawing without reading recordings or selecting another item', async () => {
  const h = harness();
  const res = await h.run();
  expect(res.json).toHaveBeenCalledWith({ item: expect.objectContaining({ id: 'drawing-1', status: 'done' }), completedItemId: 'drawing-1' });
  expect(h.rows[1].status).toBe('approved');
  expect(h.cache[0].status).toBe('done');
  expect(h.query.mock.calls[0][0]).toContain("where sid = $1 and id = $2 and status = 'playing'");
  expect(h.db.hydrateDrawingDonationStrokes).not.toHaveBeenCalled();
  expect(h.getCurrentDrawingItemForSid).not.toHaveBeenCalled();
});

test('duplicate acknowledgements after a lost response cannot consume the next drawing or duplicate completion logs', async () => {
  const h = harness();
  await h.run();
  h.rows[1].status = 'playing';
  const res = await h.run();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ completedItemId: 'drawing-1' }));
  expect(h.rows[1].status).toBe('playing');
  expect(h.bindings.recordBotEventLogSafe).toHaveBeenCalledTimes(1);
  expect(h.bindings.notifyDrawingAdminSubscribers).toHaveBeenCalledTimes(2);
});

test('database failures return an error and retain the drawing for completion retry', async () => {
  const h = harness();
  h.query.mockRejectedValueOnce(new Error('database restarting'));
  const failed = await h.run();
  expect(failed.status).toHaveBeenCalledWith(500);
  expect(h.rows[0].status).toBe('playing');
  expect(h.cache[0].status).toBe('playing');
  expect(h.bindings.recordBotEventLogSafe).not.toHaveBeenCalled();
  expect(h.bindings.notifyDrawingSubscribers).not.toHaveBeenCalled();
  const recovered = await h.run();
  expect(recovered.json).toHaveBeenCalledWith(expect.objectContaining({ completedItemId: 'drawing-1' }));
});

test.each(['approved', 'queued', 'rejected', 'deleted'])('completion never consumes an item with status %s', async (status) => {
  const h = harness(); h.rows[0].status = status;
  const res = await h.run();
  expect(res.status).toHaveBeenCalledWith(409);
  expect(h.rows[0].status).toBe(status);
  expect(h.bindings.recordBotEventLogSafe).not.toHaveBeenCalled();
});

test('queue approval does not depend on the recording storage and cannot succeed only in memory', async () => {
  const h = harness();
  await expect(h.server.updateDrawingItemStatusForSid('user:streamer', 'drawing-2', 'approved')).resolves.toMatchObject({ status: 'approved' });
  expect(h.db.hydrateDrawingDonationStrokes).not.toHaveBeenCalled();
  h.query.mockRejectedValueOnce(new Error('database restarting'));
  await expect(h.server.updateDrawingItemStatusForSid('user:streamer', 'drawing-1', 'done')).rejects.toThrow('database restarting');
  expect(h.cache[0].status).toBe('playing');
});

test.each(['playing', 'done'])('a duplicate approval cannot revert a %s drawing into the queue', async (status) => {
  const h = harness(); h.rows[0].status = status;
  await expect(h.server.updateDrawingItemStatusForSid('user:streamer', 'drawing-1', 'approved')).resolves.toMatchObject({ status });
  expect(h.rows[0].status).toBe(status);
});

test('manual deletion must commit before removing a cached queue entry', async () => {
  const queue = [{ id: 'drawing-1', status: 'playing' }];
  const deleteDrawingDonationItem = jest.fn().mockRejectedValueOnce(new Error('database restarting')).mockResolvedValue({ id: 'drawing-1' });
  const { deleteDrawingItemForSid } = loadServerFunctions(['deleteDrawingItemForSid'], { deleteDrawingDonationItem, getDrawingQueue: () => queue });
  await expect(deleteDrawingItemForSid('user:streamer', 'drawing-1')).rejects.toThrow('database restarting');
  expect(queue).toHaveLength(1);
  await expect(deleteDrawingItemForSid('user:streamer', 'drawing-1')).resolves.toEqual({ id: 'drawing-1' });
  expect(queue).toHaveLength(0);
});

test('a transient current-item failure must not broadcast an empty queue and interrupt the overlay', async () => {
  const ws = { readyState: 1, send: jest.fn() };
  const { notifyDrawingSubscribers } = loadServerFunctions(['notifyDrawingSubscribers'], {
    drawingOverlaySockets: new Map([['user:streamer', new Set([ws])]]),
    getCurrentDrawingItemForSid: jest.fn().mockRejectedValue(new Error('storage unavailable')),
    WebSocket: { OPEN: 1 },
  });
  await expect(notifyDrawingSubscribers('user:streamer')).rejects.toThrow('storage unavailable');
  expect(ws.send).not.toHaveBeenCalled();
});

test('queue lookups propagate database failures instead of returning a stale process-local queue', async () => {
  const getDrawingQueue = jest.fn();
  const { listDrawingQueueForSid } = loadServerFunctions(['listDrawingQueueForSid'], {
    listDrawingDonationItems: jest.fn().mockRejectedValue(new Error('database restarting')), getDrawingQueue,
  });
  await expect(listDrawingQueueForSid('user:streamer')).rejects.toThrow('database restarting');
  expect(getDrawingQueue).not.toHaveBeenCalled();
});
