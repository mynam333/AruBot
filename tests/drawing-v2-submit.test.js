const crypto = require('node:crypto');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const loadSource = require('./helpers/load-source.cjs');
const model = loadSource('shared/drawing/document.js', { './selection.js': loadSource('shared/drawing/selection.js'), './limits.js': loadSource('shared/drawing/limits.js') });
const recording = loadSource('server/drawing-recording-storage.js', { '../shared/drawing/document.js': model, '../shared/drawing/limits.js': loadSource('shared/drawing/limits.js') });

function harness() {
  const document = model.createDrawing(16, 9, 'submission');
  document.strokes = [{ id: 's1', layerId: 'layer-1', seed: 1, brush: model.createBrush(), kind: 'line', mirror: false, transform: { x: 0, y: 0, scale: 1 }, points: [{ x: 0.1, y: 0.1, p: 1, t: 0 }, { x: 0.8, y: 0.8, p: 1, t: 1000 }] }];
  const originalOwnerKey = (owner) => crypto.createHash('sha256').update(owner).digest('hex').slice(0, 32);
  const documentHash = crypto.createHash('sha256').update(model.canonicalDrawing(document)).digest('hex');
  const original = Buffer.from('original-image'), originalHash = crypto.createHash('sha256').update(original).digest('hex');
  const storedBuffer = Buffer.from('compressed-webp');
  const storedHash = crypto.createHash('sha256').update(storedBuffer).digest('hex');
  const storage = { buffer: storedBuffer, original: { width: document.width, height: document.height, format: 'webp', contentType: 'image/webp', hash: storedHash, sourceHash: originalHash, byteLength: storedBuffer.length, sourceByteLength: original.length, lossless: false, alphaLossless: true } };
  const settings = { enabled: true, pricingMode: 'fixed', costPoints: 100, inkCostPerUnit: 1, perUserQueueLimit: 3, submitCooldownSec: 0, approvalMode: 'auto', replayMaxSec: 12, resultHoldSec: 8, canvas: { widthRatio: 16, heightRatio: 9 } };
  const jobs = new Map();
  const bindings = {
    ...model, ...recording, crypto, originalOwnerKey,
    getDurableRuntimeJob: jest.fn(async (id) => jobs.get(id)),
    validateDrawingSubmission: jest.fn(() => ({ document, documentHash, strokes: document.strokes, ...model.validateDrawing(document), ink: model.drawingInk(document), replay: model.buildTimeline(document) })),
    listDrawingQueueForSid: jest.fn().mockResolvedValue([]),
    downloadDrawingDonationObject: jest.fn().mockResolvedValue(original),
    inspectOriginal: jest.fn().mockResolvedValue({ width: document.width, height: document.height, hash: originalHash }),
    verifyDrawingOriginal: jest.fn().mockResolvedValue({ ok: true, previewImage: 'thumbnail', comparison: { different: 0 }, storage }),
    uploadDrawingDonationObject: jest.fn(async (key) => `local:${key}`),
    deleteDrawingDonationObjectKeys: jest.fn().mockResolvedValue({ deleted: 1 }),
    enqueuePaidDurableRuntimeJob: jest.fn(async (input) => {
      if (jobs.has(input.id)) return { created: false, job: jobs.get(input.id) };
      const job = { ...input, status: 'completed' }; jobs.set(input.id, job);
      return { created: true, job, deduction: { deducted: true, balanceBefore: 500, balanceAfter: 400 } };
    }),
    runDurableRuntimeWorker: jest.fn().mockResolvedValue(true),
    recordBotEventLogSafe: jest.fn().mockResolvedValue(true),
  };
  const functions = loadServerFunctions(['submitDrawingV2'], bindings);
  const request = { get: () => '', body: { requestId: 'submission-repeat-1234', document, documentHash, original: { hash: originalHash, key: `local:drawing-donations/uploads/${originalOwnerKey('viewer')}/1760000000000-${crypto.randomUUID()}.png` }, expectedCost: 100 } };
  const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
  return { ...bindings, document, documentHash, original, originalHash, storedBuffer, storedHash, storage, request, response, jobs, submit: (req, res) => functions.submitDrawingV2(req, res, 'viewer', { points: 500, channelUid: 'channel' }, { sid: 'user:streamer', drawing: settings }) };
}

describe('V2 drawing acceptance without production services', () => {
  test('persists exact assets before charging and acknowledges both hashes', async () => {
    const h = harness(), res = h.response(); await h.submit(h.request, res);
    expect(h.uploadDrawingDonationObject).toHaveBeenCalledTimes(2);
    expect(await recording.decodeDrawingRecording(h.uploadDrawingDonationObject.mock.calls[0][1])).toEqual(h.document);
    expect(h.uploadDrawingDonationObject.mock.calls[0][0]).toMatch(/\.json\.gz$/);
    expect(h.uploadDrawingDonationObject.mock.calls[0][2]).toBe('application/gzip');
    expect(h.uploadDrawingDonationObject.mock.invocationCallOrder[1]).toBeLessThan(h.enqueuePaidDurableRuntimeJob.mock.invocationCallOrder[0]);
    const accepted = res.json.mock.calls[0][0];
    expect(accepted).toMatchObject({ ok: true, documentHash: h.documentHash, originalHash: h.originalHash });
    expect(accepted.item.strokeObjectKey).toMatch(/^local:/);
    expect(accepted.item.previewObjectKey).toMatch(/^local:/);
    expect(accepted.item.strokes).toEqual([]);
    expect(accepted.item.previewObjectKey).toMatch(/\.webp$/);
    expect(accepted.item.metrics.original).toMatchObject({ hash: h.storedHash, sourceHash: h.originalHash, lossless: false, alphaLossless: true });
    expect(h.uploadDrawingDonationObject.mock.calls[1].slice(1)).toEqual([h.storedBuffer, 'image/webp']);
  });

  test('a lost acknowledgement can be retried without charging or rendering twice', async () => {
    const h = harness(); await h.submit(h.request, h.response());
    const response = h.response(); await h.submit(h.request, response);
    expect(h.enqueuePaidDurableRuntimeJob).toHaveBeenCalledTimes(1);
    expect(h.verifyDrawingOriginal).toHaveBeenCalledTimes(1);
    expect(response.json.mock.calls[0][0]).toMatchObject({ ok: true, deduplicated: true, originalHash: h.originalHash });
    expect(h.deleteDrawingDonationObjectKeys).toHaveBeenCalledTimes(2);
  });

  test('rejects a changed request with the same idempotency key', async () => {
    const h = harness(); await h.submit(h.request, h.response());
    h.request.body.documentHash = 'different'; const res = h.response(); await h.submit(h.request, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(h.enqueuePaidDurableRuntimeJob).toHaveBeenCalledTimes(1);
  });

  test('pre-WebP acknowledgements remain compatible without re-encoding or charging', async () => {
    const h = harness(), res = h.response(); await h.submit(h.request, res);
    const accepted = res.json.mock.calls[0][0];
    accepted.item.metrics.original = { hash: h.originalHash };
    accepted.item.previewObjectKey = 'local:legacy.png';
    const retry = h.response(); await h.submit(h.request, retry);
    expect(retry.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, deduplicated: true, originalHash: h.originalHash }));
    expect(h.enqueuePaidDurableRuntimeJob).toHaveBeenCalledTimes(1);
    expect(h.verifyDrawingOriginal).toHaveBeenCalledTimes(1);
  });

  test('compression failure and PNG fallback cannot reach persistence or point charging', async () => {
    const h = harness();
    h.verifyDrawingOriginal.mockRejectedValueOnce(new Error('drawing_compression_failed'));
    await expect(h.submit(h.request, h.response())).rejects.toThrow('drawing_compression_failed');
    h.storage.original.format = 'png';
    await expect(h.submit(h.request, h.response())).rejects.toThrow('drawing_original_mismatch');
    expect(h.uploadDrawingDonationObject).not.toHaveBeenCalled();
    expect(h.enqueuePaidDurableRuntimeJob).not.toHaveBeenCalled();
  });

  test('a changed source image or corrupted compressed output cannot be charged', async () => {
    const h = harness();
    h.storage.buffer = Buffer.from('changed');
    await expect(h.submit(h.request, h.response())).rejects.toThrow('drawing_original_mismatch');
    expect(h.uploadDrawingDonationObject).not.toHaveBeenCalled();
    expect(h.enqueuePaidDurableRuntimeJob).not.toHaveBeenCalled();
    h.storage.buffer = h.storedBuffer;
    await h.submit(h.request, h.response());
    h.request.body.original.hash = 'different-source';
    const retry = h.response(); await h.submit(h.request, retry);
    expect(retry.status).toHaveBeenCalledWith(409);
    expect(h.enqueuePaidDurableRuntimeJob).toHaveBeenCalledTimes(1);
  });

  test.each(['png', 'webp'])('serves %s originals with the correct MIME type and stored-file hash', async (format) => {
    const h = harness(), accepted = h.response(); await h.submit(h.request, accepted);
    const item = accepted.json.mock.calls[0][0].item;
    const storedBuffer = format === 'png' ? h.original : h.storedBuffer;
    if (format === 'png') { item.metrics.original = { hash: h.originalHash }; item.previewObjectKey = 'local:legacy.png'; }
    const route = loadServerFunctions.route('/api/drawing-donation/originals/:id', {
      crypto, getCurrentSessionUserId: async () => 'streamer', getDrawingItemForSid: async () => item,
      downloadDrawingDonationObject: async () => storedBuffer,
    });
    const res = { ...h.response(), set: jest.fn().mockReturnThis(), type: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() };
    await route({ query: {}, params: { id: item.id } }, res);
    expect(res.type).toHaveBeenCalledWith(`image/${format}`); expect(res.send).toHaveBeenCalledWith(storedBuffer);
    item.metrics.original.hash = 'corrupted'; await route({ query: {}, params: { id: item.id } }, res);
    expect(res.status).toHaveBeenCalledWith(503); expect(res.send).toHaveBeenCalledTimes(1);
  });

  test.each(['png', 'webp'])('free replay of %s always saves WebP and only converts legacy PNG', async (format) => {
    const h = harness(), res = h.response(); await h.submit(h.request, res);
    const source = { ...res.json.mock.calls[0][0].item, strokes: h.document.strokes };
    if (format === 'png') { source.metrics.original = { hash: h.originalHash }; source.previewObjectKey = 'local:legacy.png'; }
    const upload = jest.fn(async (key) => `local:${key}`);
    const optimize = jest.fn().mockResolvedValue(h.storage);
    const { replayDrawingDonationLog } = loadServerFunctions(['replayDrawingDonationLog'], {
      crypto, originalOwnerKey: h.originalOwnerKey, canonicalDrawing: h.canonicalDrawing, ...recording,
      getEventLogMetadata: () => ({ drawingId: source.id }), getDrawingDonationItem: async () => source,
      downloadDrawingDonationObject: async () => format === 'png' ? h.original : h.storedBuffer, uploadDrawingDonationObject: upload,
      optimizeDrawingOriginal: optimize,
      insertDrawingDonationItem: async (item) => item, recordBotEventLogSafe: jest.fn(),
      notifyDrawingSubscribers: jest.fn().mockResolvedValue(true), notifyDrawingAdminSubscribers: jest.fn().mockResolvedValue(true),
    });
    const replay = await replayDrawingDonationLog('user:streamer', 'streamer', { id: 'log-1' });
    expect(replay.ok).toBe(true); expect(replay.item.cost).toBe(0);
    expect(replay.item.previewObjectKey).toMatch(/\.webp$/);
    expect(upload.mock.calls[1].slice(1)).toEqual([h.storedBuffer, 'image/webp']);
    expect(replay.item.metrics.original).toEqual(h.storage.original);
    expect(optimize).toHaveBeenCalledTimes(format === 'png' ? 1 : 0);
    if (format === 'png') expect(source.metrics.original).toEqual({ hash: h.originalHash });
  });

  test('price changes and another viewer upload cannot reach charging', async () => {
    const h = harness(), price = h.response(); h.request.body.expectedCost = 99;
    await h.submit(h.request, price); expect(price.status).toHaveBeenCalledWith(409);
    h.request.body.expectedCost = 100;
    h.request.body.original.key = 'local:drawing-donations/uploads/another-user/1760000000000-image.png';
    const asset = h.response(); await h.submit(h.request, asset);
    expect(asset.status).toHaveBeenCalledWith(400);
    expect(h.downloadDrawingDonationObject).not.toHaveBeenCalled();
    expect(h.enqueuePaidDurableRuntimeJob).not.toHaveBeenCalled();
  });

  test('a mismatched image or storage failure leaves points untouched', async () => {
    const h = harness(); h.verifyDrawingOriginal.mockRejectedValueOnce(new Error('drawing_original_mismatch'));
    await expect(h.submit(h.request, h.response())).rejects.toThrow('drawing_original_mismatch');
    expect(h.uploadDrawingDonationObject).not.toHaveBeenCalled();
    h.uploadDrawingDonationObject.mockRejectedValueOnce(new Error('storage failed'));
    await expect(h.submit(h.request, h.response())).rejects.toThrow('storage failed');
    expect(h.enqueuePaidDurableRuntimeJob).not.toHaveBeenCalled();
  });

  test('unauthenticated original uploads are rejected before inspecting or storing data', async () => {
    const h = harness();
    const route = loadServerFunctions.route('/api/drawing-donation/originals', { ...h, getCurrentSessionUserId: async () => null });
    const res = h.response(); await route({ body: Buffer.from('png') }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(h.inspectOriginal).not.toHaveBeenCalled(); expect(h.uploadDrawingDonationObject).not.toHaveBeenCalled();
  });
});
