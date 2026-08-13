const fs = require('fs');
const path = require('path');

describe('action blueprint point reads', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const start = source.indexOf('async function listExistingPointTablesForChannelAliases');
  const end = source.indexOf('async function deletePointRowsForIdentity', start);

  test('reads existing point tables in a bounded batch without running DDL', async () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    const factory = Function(
      'uniqueNonEmpty',
      'pointTableCandidatesForAliases',
      'quoteChannelPointsTable',
      `${block}\nreturn { sumPointsForIdentity, getPointBalanceSummaryForIdentity };`
    );
    const uniqueNonEmpty = (values) => Array.from(new Set(values.map(String).filter(Boolean)));
    const pointTableCandidatesForAliases = (aliases) => uniqueNonEmpty(
      aliases.flatMap((alias) => {
        const table = `channelpoint_${String(alias).replace(/[^a-zA-Z0-9_]/g, '_')}`;
        return table.toLowerCase() === table ? [table] : [table, table.toLowerCase()];
      })
    );
    const quoteChannelPointsTable = (table) => `"public"."${table}"`;
    const helpers = factory(uniqueNonEmpty, pointTableCandidatesForAliases, quoteChannelPointsTable);
    const queries = [];
    const pg = {
      query: async (sql) => {
        queries.push(sql);
        if (sql.includes('information_schema.tables')) {
          return { rows: [{ table_name: 'channelpoint_channel_a' }, { table_name: 'channelpoint_channel_b' }] };
        }
        return { rows: [{ points: '1000' }] };
      },
    };

    await expect(helpers.sumPointsForIdentity(pg, ['channel_a', 'channel_b'], ['viewer-1'])).resolves.toBe(1000);
    expect(queries).toHaveLength(2);
    expect(queries.some((sql) => /create\s+table/i.test(sql))).toBe(false);
    expect(queries[1]).toContain('union all');
  });

  test('chunks large alias sets and preserves deterministic legacy username priority', async () => {
    const block = source.slice(start, end);
    const factory = Function(
      'uniqueNonEmpty',
      'pointTableCandidatesForAliases',
      'quoteChannelPointsTable',
      `${block}\nreturn { sumPointsForIdentity, getPointBalanceSummaryForIdentity };`
    );
    const uniqueNonEmpty = (values) => Array.from(new Set(values.map(String).filter(Boolean)));
    const pointTableCandidatesForAliases = (aliases) => uniqueNonEmpty(
      aliases.map((alias) => `channelpoint_${String(alias).replace(/[^a-zA-Z0-9_]/g, '_')}`)
    );
    const quoteChannelPointsTable = (table) => `"public"."${table}"`;
    const helpers = factory(uniqueNonEmpty, pointTableCandidatesForAliases, quoteChannelPointsTable);
    const aliases = Array.from({ length: 33 }, (_, index) => `channel_${index}`);
    const pointQueries = [];
    const pg = {
      query: async (sql, params) => {
        if (sql.includes('information_schema.tables')) {
          expect(params).toEqual([aliases.map((alias) => `channelpoint_${alias}`)]);
          return { rows: aliases.map((alias) => ({ table_name: `channelpoint_${alias}` })) };
        }
        pointQueries.push({ sql, params });
        if (sql.includes('source_order')) {
          return { rows: [{ username: pointQueries.length === 1 ? 'primary' : 'legacy', points: '1' }] };
        }
        return { rows: [{ points: '1' }] };
      },
    };

    await expect(helpers.sumPointsForIdentity(pg, aliases, ['viewer-1'])).resolves.toBe(2);
    expect(pointQueries).toHaveLength(2);
    expect(pointQueries.every((query) => query.params[0][0] === 'viewer-1')).toBe(true);

    pointQueries.length = 0;
    await expect(helpers.getPointBalanceSummaryForIdentity(pg, aliases, ['viewer-1'])).resolves.toEqual({
      username: 'primary',
      points: 2,
      found: true,
    });
    expect(pointQueries).toHaveLength(2);
    expect(pointQueries[0].sql).toContain('order by source_order asc');
  });

  test('uses a finite timeout fallback when the environment value is malformed', () => {
    expect(serverSource).toContain('Number.isFinite(configured)');
    expect(serverSource).toContain(': 5000;');
  });
});
