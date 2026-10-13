const fs = require('fs');
const path = require('path');
const loadFunctions = require('./helpers/load-server-functions.cjs');

describe('PostgreSQL roulette result value storage', () => {
  const root = path.join(__dirname, '..');
  const supabaseSource = fs.readFileSync(path.join(root, 'server', 'supabase.js'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'server', 'migrations', '018_roulette_result_value_text.sql'), 'utf8');
  const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');

  test('new and existing roulette tables store command/action values as text', () => {
    expect(supabaseSource).not.toMatch(/result_value\s+numeric/i);
    expect(supabaseSource.match(/result_value\s+text/gi)?.length).toBeGreaterThanOrEqual(3);
    expect(supabaseSource).toContain('alter column result_value type text');
    expect(supabaseSource).toContain('using result_value::text');
  });

  test('the numbered migration preserves existing numeric values losslessly', () => {
    expect(migration).toContain('alter table if exists public.roulette_sessions');
    expect(migration).toContain('alter column result_value type text');
    expect(migration).toContain('using result_value::text');
  });

  test('stored action text reaches the unified result renderer without conversion', async () => {
    expect(serverIndex).toContain('result_value: picked.value');
    const render = jest.fn(async () => ({ text: '', commandTemplate: '', used: true }));
    const { executeRouletteResultActions } = loadFunctions(['executeRouletteResultActions'], {
      renderRouletteActionTemplate: render,
    });
    const value = '${roulette::next} ${blueprint::celebrate}';
    await executeRouletteResultActions('user:owner', { id: 'a', name: 'Wheel' },
      { label: 'Winner', value }, 'viewer', 'Viewer', 'channel', { provider: 'youtube' });
    expect(render).toHaveBeenCalledWith('user:owner', value, expect.objectContaining({
      provider: 'youtube', userId: 'viewer', result: { label: 'Winner', value },
      roulette: { id: 'a', name: 'Wheel', result: { label: 'Winner', value } },
    }));
  });
});
