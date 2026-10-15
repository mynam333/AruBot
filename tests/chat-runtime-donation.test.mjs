import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchDonationRuleDesktop } from '../server/donation-response.js';

const context = {
  sid: 'user:owner', userId: 'donor', username: 'Viewer', amount: 3000, source: 'donation-rule',
};
const rule = { name: 'reaction', repeatEnabled: true, repeatPerAmount: 1000, repeatCooldown: 100 };
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('completion waits for every scheduled repeat while the first send stays synchronous', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const result = dispatchDonationRuleDesktop(rule, context, {
    broadcastToDesktop: (sid, message) => { calls.push({ sid, message }); return 2; },
  });
  assert.equal(result.desktopSent, 2);
  assert.equal(calls.length, 1);
  let completed = false;
  result.completion.then(() => { completed = true; });
  await flush();
  assert.equal(completed, false);
  t.mock.timers.tick(99);
  await flush();
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(completed, false);
  t.mock.timers.tick(100);
  await result.completion;
  assert.equal(completed, true);
  assert.deepEqual(calls.map(({ message }) => message.repeatIndex), [1, 2, 3]);
  assert.ok(calls.every(({ sid, message }) => sid === context.sid && message.repeatTotal === 3));
});

test('completion waits for asynchronous sends including the final repeat', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sends = [deferred(), deferred(), deferred()];
  let attempts = 0;
  const result = dispatchDonationRuleDesktop(rule, context, {
    broadcastToDesktop: () => sends[attempts++].promise,
  });
  let completed = false;
  result.completion.then(() => { completed = true; });
  await flush();
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(attempts, 1);
  sends[0].resolve(1);
  await flush();
  t.mock.timers.tick(100);
  await flush();
  assert.equal(attempts, 2);
  sends[1].resolve(1);
  await flush();
  t.mock.timers.tick(100);
  await flush();
  assert.equal(attempts, 3);
  assert.equal(completed, false);
  sends[2].resolve(1);
  await result.completion;
  assert.equal(completed, true);
});

test('send failures reach onError and do not skip remaining attempts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const failures = [new Error('first send'), new Error('async repeat'), new Error('last failed repeat')];
  const errors = [];
  let attempts = 0;
  const result = dispatchDonationRuleDesktop(rule, { ...context, amount: 4000 }, {
    broadcastToDesktop: () => {
      const index = attempts++;
      if (index === 1) return Promise.reject(failures[index]);
      if (index < failures.length) throw failures[index];
      return 1;
    },
    onError: error => errors.push(error),
  });
  assert.equal(result.desktopSent, 0);
  assert.deepEqual(errors, [failures[0]]);
  await flush();
  for (let index = 1; index < 4; index++) {
    t.mock.timers.tick(100);
    await flush();
  }
  await result.completion;
  assert.equal(attempts, 4);
  assert.deepEqual(errors, failures);
});

for (const name of ['reaction', '']) {
  test(`completion stays out of enumerable legacy results (${name || 'empty rule'})`, async () => {
    let attempts = 0;
    const result = dispatchDonationRuleDesktop({ name }, context, {
      broadcastToDesktop: () => { attempts++; return 7; },
    });
    const expected = name ? { desktopSent: 7, repeatCount: 1 } : { desktopSent: 0, repeatCount: 0 };
    assert.ok(result.completion instanceof Promise);
    assert.equal(Object.getOwnPropertyDescriptor(result, 'completion').enumerable, false);
    assert.deepEqual(Object.keys(result), ['desktopSent', 'repeatCount']);
    assert.deepEqual(result, expected);
    assert.deepEqual({ ...result }, expected);
    assert.equal(JSON.stringify(result), JSON.stringify(expected));
    await result.completion;
    assert.equal(attempts, name ? 1 : 0);
  });
}
