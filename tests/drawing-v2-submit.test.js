const crypto = require('node:crypto');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const loadSource = require('./helpers/load-source.cjs');
const model = loadSource('shared/drawing/document.js', { './selection.js': loadSource('shared/drawing/selection.js') });

function harness() {
  const document = model.createDrawing(16, 9, 'submission');
  document.strokes = [{ id: 's1', layerId: 'layer-1', seed: 1, brush: model.createBrush(), kind: 'line', mirror: false, transform: { x: 0, y: 0, scale: 1 }, points: [{ x: 0.1, y: 0.1, p: 1, t: 0 }, { x: 0.8, y: 0.8, p: 1, t: 1000 }] }];
  const originalOwnerKey = (owner) => crypto.createHash('sha256').update(owner).digest('hex').slice(0, 32);
  const documentHash = crypto.createHash('sha256').update(model.canonicalDrawing(document)).digest('hex');
  const original = Buffer.from('original-image'), originalHash = crypto.createHash('sha256').update(original).digest('hex');
  const settings = { enabled: true, pricingMode: 'fixed', costPoints: 100, inkCostPerUnit: 1, perUserQueueLimit: 3, submitCooldownSec: 0, approvalMode: 'auto', replayMaxSec: 12, resultHoldSec: 8, canvas: { widthRatio: 16, heightRatio: 9 } };
  const jobs = new Map();
  const bindings = {
    ...model, crypto, originalOwnerKey,
    getDurableRuntimeJob: jest.fn(async (id) => jobs.get(id)),
    validateDrawingSubmission: jest.fn(() => ({ document, documentHash, strokes: document.strokes, ...model.validateDrawing(document), ink: model.drawingInk(document), replay: model.buildTimeline(document) })),
    listDrawingQueueForSid: jest.fn().mockResolvedValue([]),
    downloadDrawingDonationObject: jest.fn().mockResolvedValue(original),
    inspectOriginal: jest.fn().mockResolvedValue({ width: document.width, height: document.height, hash: originalHash }),
    verifyDrawingOriginal: jest.fn().mockResolvedValue({ ok: true, previewImage: 'thumbnail', comparison: { different: 0 } }),
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
  return { ...bindings, document, documentHash, originalHash, request, response, jobs, submit: (req, res) => functions.submitDrawingV2(req, res, 'viewer', { points: 500, channelUid: 'channel' }, { sid: 'user:streamer', drawing: settings }) };
}

describe('V2 drawing acceptance without production services', () => {
  test('persists exact assets before charging and acknowledges both hashes', async () => {
    const h = harness(), res = h.response(); await h.submit(h.request, res);
    expect(h.uploadDrawingDonationObject).toHaveBeenCalledTimes(2);
    expect(h.uploadDrawingDonationObject.mock.calls[0][1]).toBe(model.canonicalDrawing(h.document));
    expect(h.uploadDrawingDonationObject.mock.invocationCallOrder[1]).toBeLessThan(h.enqueuePaidDurableRuntimeJob.mock.invocationCallOrder[0]);
    const accepted = res.json.mock.calls[0][0];
    expect(accepted).toMatchObject({ ok: true, documentHash: h.documentHash, originalHash: h.originalHash });
    expect(accepted.item.strokeObjectKey).toMatch(/^local:/);
    expect(accepted.item.previewObjectKey).toMatch(/^local:/);
    expect(accepted.item.strokes).toEqual([]);
  });

  test('a lost acknowledgement can be retried without charging or rendering twice', async () => {
    const h = harness(); await h.submit(h.request, h.response());
    const response = h.response(); await h.submit(h.request, response);
    expect(h.enqueuePaidDurableRuntimeJob).toHaveBeenCalledTimes(1);
    expect(h.verifyDrawingOriginal).toHaveBeenCalledTimes(1);
    expect(response.json.mock.calls[0][0]).toMatchObject({ ok: true, deduplicated: true });
    expect(h.deleteDrawingDonationObjectKeys).toHaveBeenCalledTimes(2);
  });

  test('rejects a changed request with the same idempotency key', async () => {
    const h = harness(); await h.submit(h.request, h.response());
    h.request.body.documentHash = 'different'; const res = h.response(); await h.submit(h.request, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(h.enqueuePaidDurableRuntimeJob).toHaveBeenCalledTimes(1);
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
