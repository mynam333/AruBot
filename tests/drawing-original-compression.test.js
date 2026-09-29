const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const loadSource = require('./helpers/load-source.cjs');

function harness({ failEfforts = [], changedAlpha = false } = {}) {
  const input = Buffer.from('input-png'), output = Buffer.from('output-webp'), encodes = [];
  const sharp = (bytes) => {
    let options, seconds;
    const pipeline = {
      metadata: async () => ({ format: 'png', depth: 'uchar', width: 64, height: 64 }),
      timeout: (value) => { seconds = value.seconds; return pipeline; },
      keepIccProfile: jest.fn(() => pipeline),
      webp: (value) => { options = value; return pipeline; },
      ensureAlpha: () => pipeline, extractChannel: () => pipeline, raw: () => pipeline,
      toBuffer: async () => {
        if (options) {
          encodes.push({ ...options, seconds, keptIcc: pipeline.keepIccProfile.mock.calls.length > 0 });
          if (failEfforts.includes(options.effort)) throw new Error(`webpsave timeout at effort ${options.effort}`);
          return output;
        }
        return { info: { width: 64, height: 64 }, data: Buffer.from([0, 64, 128, changedAlpha && bytes === output ? 254 : 255]) };
      },
    };
    return pipeline;
  };
  const { optimizeDrawingOriginal } = loadSource('server/drawing-original-storage.js', {
    'node:crypto': { default: crypto }, sharp: { default: sharp }, '../shared/drawing/limits.js': loadSource('shared/drawing/limits.js'),
  });
  return { encodes, input, output, optimize: (deadline) => optimizeDrawingOriginal(input, deadline) };
}

test('normal WebP compression uses bounded effort without reducing colour or alpha quality', async () => {
  const h = harness(), result = await h.optimize();
  expect(result.buffer).toBe(h.output);
  expect(result.original).toMatchObject({ format: 'webp', quality: 60, alphaQuality: 100, alphaLossless: true, effort: 4 });
  expect(h.encodes).toEqual([expect.objectContaining({ effort: 4, seconds: 6, keptIcc: true })]);
});

test('encoder failure retries a faster WebP with the same alpha, colour quality and ICC policy', async () => {
  const h = harness({ failEfforts: [4] }), result = await h.optimize();
  expect(h.encodes.map((entry) => entry.effort)).toEqual([4, 2]);
  for (const entry of h.encodes) expect(entry).toMatchObject({ quality: 60, alphaQuality: 100, lossless: false, keptIcc: true });
  expect(result.original.effort).toBe(2);
  expect(result.buffer).toBe(h.output);
});

test('persistent failures keep both encoder causes and never return PNG', async () => {
  const h = harness({ failEfforts: [4, 2] });
  await expect(h.optimize()).rejects.toMatchObject({ message: 'drawing_compression_failed', status: 503,
    diagnostics: { stage: 'encode', reason: 'webpsave timeout at effort 2', attempts: [
      { effort: 4, reason: 'webpsave timeout at effort 4' }, { effort: 2, reason: 'webpsave timeout at effort 2' },
    ] } });
});

test('changed transparency is rejected, not accepted as a compression fallback', async () => {
  const h = harness({ changedAlpha: true });
  await expect(h.optimize()).rejects.toMatchObject({ message: 'drawing_compression_failed', diagnostics: { stage: 'stored_alpha', reason: 'drawing_alpha_mismatch' } });
  expect(h.encodes).toHaveLength(1);
});

test('an exhausted overall budget does not start an encoder or return the input image', async () => {
  const h = harness();
  await expect(h.optimize(Date.now() - 1)).rejects.toMatchObject({ message: 'drawing_compression_failed', diagnostics: { reason: 'drawing_compression_timeout' } });
  expect(h.encodes).toHaveLength(0);
});

function workerHarness() {
  const filename = path.join(__dirname, '../server/drawing-original.js');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'verifyDrawingOriginal');
  const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const workers = [];
  class Worker extends EventEmitter {
    constructor() { super(); workers.push(this); }
    terminate = jest.fn().mockResolvedValue(0);
  }
  const verify = new Function('Worker', 'DRAWING_RENDER_WORKER_URL', 'DRAWING_COMPRESSION_BUDGET_MS', 'exports', `let running = 0; ${code}; return verifyDrawingOriginal;`)(Worker, 'isolated-test-worker', 15000, {});
  return { workers, verify: () => verify({}, Buffer.from('png')) };
}

describe('isolated drawing worker deadlines', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('verification time does not consume the compression budget or resolve a progress message', async () => {
    const h = workerHarness(), promise = h.verify(), settled = jest.fn();
    promise.then(settled);
    jest.advanceTimersByTime(19000);
    h.workers[0].emit('message', { phase: 'compression' });
    jest.advanceTimersByTime(14000);
    await Promise.resolve(); expect(settled).not.toHaveBeenCalled();
    h.workers[0].emit('message', { ok: true, storage: { buffer: 'webp' } });
    await expect(promise).resolves.toMatchObject({ ok: true });
    expect(h.workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('a stalled encoder is still terminated by a bounded compression watchdog', async () => {
    const h = workerHarness(), promise = h.verify();
    const rejected = expect(promise).rejects.toMatchObject({ message: 'drawing_compression_failed', status: 503,
      diagnostics: { stage: 'compression', reason: 'drawing_compression_timeout' } });
    h.workers[0].emit('message', { phase: 'compression' });
    jest.advanceTimersByTime(17000); await rejected;
    expect(h.workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  test('encoder failure diagnostics survive the worker boundary', async () => {
    const h = workerHarness(), promise = h.verify();
    const diagnostics = { stage: 'encode', reason: 'native encoder failed' };
    h.workers[0].emit('message', { ok: false, error: 'drawing_compression_failed', status: 503, diagnostics });
    await expect(promise).rejects.toMatchObject({ message: 'drawing_compression_failed', diagnostics });
  });
});
