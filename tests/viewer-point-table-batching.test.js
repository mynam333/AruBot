const path = require('path');
const { execFileSync } = require('child_process');

describe('viewer point table batching', () => {
  test('batches healthy tables and isolates one unreadable table', () => {
    const moduleUrl = new URL(
      '../server/supabase.js',
      `file://${__filename.replace(/\\/g, '/')}`,
    ).href;
    const script = `
      console.warn = () => {};
      const { queryViewerPointTablesForUserIds } = await import(${JSON.stringify(moduleUrl)});
      const calls = [];
      const pg = {
        async query(sql) {
          calls.push(sql);
          const tables = Array.from(sql.matchAll(/select '([^']+)'::text as point_table/g), (match) => match[1]);
          if (tables.includes('channelpoint_bad')) throw Object.assign(new Error('missing table'), { code: '42P01' });
          return { rows: tables.map((table) => ({ point_table: table, user_id: 'viewer', username: table, points: 1 })) };
        },
      };
      const healthyTables = Array.from({ length: 65 }, (_, index) => 'channelpoint_ok_' + index);
      const healthyRows = await queryViewerPointTablesForUserIds(pg, healthyTables, ['viewer']);
      const healthyCallCount = calls.length;
      calls.length = 0;
      const isolatedRows = await queryViewerPointTablesForUserIds(pg, [
        'channelpoint_ok_a',
        'channelpoint_bad',
        'channelpoint_ok_b',
      ], ['viewer']);
      const isolatedCallCount = calls.length;
      calls.length = 0;
      let systemicError = null;
      try {
        await queryViewerPointTablesForUserIds({
          async query() {
            calls.push('systemic');
            throw Object.assign(new Error('permission denied'), { code: '42501' });
          },
        }, ['channelpoint_ok_a', 'channelpoint_ok_b'], ['viewer']);
      } catch (error) {
        systemicError = error.code;
      }
      console.log(JSON.stringify({
        healthyCallCount,
        healthyRowCount: healthyRows.length,
        isolatedNames: isolatedRows.map((row) => row.username).sort(),
        isolatedCallCount,
        systemicError,
        systemicCallCount: calls.filter((call) => call === 'systemic').length,
      }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());

    expect(result).toEqual({
      healthyCallCount: 3,
      healthyRowCount: 65,
      isolatedNames: ['channelpoint_ok_a', 'channelpoint_ok_b'],
      isolatedCallCount: 5,
      systemicError: '42501',
      systemicCallCount: 1,
    });
  });
});
