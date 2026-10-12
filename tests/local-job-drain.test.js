const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

function worker(apiFetch, processJob) {
  const source = ts.createSourceFile('main.cjs', fs.readFileSync(path.join(__dirname, '../local-program/main.cjs'), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'claimAndProcessJobs');
  return new Function('apiFetch', 'processJob', `
    let running = true, processingJobs = false, jobsCheckPending = false;
    const config = {}, stats = { claimed: 0, completed: 0, failed: 0 }, app = { getVersion: () => 'test' };
    const getFxFolder = () => 'media', addLog = () => {}, emitState = () => {};
    ${fn.getText(source)}
    return { run: claimAndProcessJobs, stop: () => { running = false; }, stats };
  `)(apiFetch, processJob);
}

test('a notification received during execution is drained without waiting for the 15-second poll', async () => {
  const jobs = [{ id: '1', job_type: 'fx.play' }];
  let finish;
  const processJob = jest.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ ok: true });
  const apiFetch = jest.fn(async (url) => url.endsWith('/claim') ? { jobs: jobs.splice(0, 5) } : {});
  const w = worker(apiFetch, processJob);
  const running = w.run(); await flush();
  jobs.push({ id: '2', job_type: 'fx.play' });
  await w.run();
  finish({ ok: true }); await running; await flush();
  expect(processJob.mock.calls.map(([job]) => job.id)).toEqual(['1', '2']);
  expect(w.stats.completed).toBe(2);
});

test('full batches drain sequentially, and an empty queue stops requesting', async () => {
  const jobs = Array.from({ length: 11 }, (_, id) => ({ id, job_type: 'fx.play' }));
  const apiFetch = jest.fn(async (url) => url.endsWith('/claim') ? { jobs: jobs.splice(0, 5) } : {});
  const processJob = jest.fn(async () => ({ ok: true }));
  const w = worker(apiFetch, processJob);
  await w.run(); await flush();
  expect(processJob).toHaveBeenCalledTimes(11);
  expect(apiFetch.mock.calls.filter(([url]) => url.endsWith('/claim'))).toHaveLength(3);
  expect(w.stats.completed).toBe(11);
});
