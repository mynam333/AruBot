const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

describe('PostgreSQL JSONB adapter regression', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');

  test('serializes known JSONB columns and casts their placeholders explicitly', () => {
    expect(source).toContain("bot_rules: new Set(['keywords', 'responses'])");
    expect(source).toContain("bot_settings: new Set(['settings'])");
    expect(source).toContain("return `$${position}${jsonColumn ? '::jsonb' : ''}`;");
    expect(source).toContain('addPgColumnValue(values, this.table, column, row[column] ?? null)');
    expect(source).toContain('addPgColumnValue(values, this.table, column, value)');
  });

  test('uses the same JSONB serializer in the direct bot rule upsert path', () => {
    expect(source).toContain("normalizePgJsonColumnValue('bot_rules', columns[index], value)");
    expect(source).toContain("isPgJsonColumn('bot_rules', column) ? `${placeholder}::jsonb` : placeholder");
  });

  test('normalizes arrays, objects, strings, and non-JSON columns without data loss', () => {
    const moduleUrl = new URL('../server/supabase.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const { isPgJsonColumn, normalizePgJsonColumnValue } = await import(${JSON.stringify(moduleUrl)});
      console.log(JSON.stringify({
        known: isPgJsonColumn('bot_rules', 'keywords'),
        unknown: isPgJsonColumn('bot_rules', 'name'),
        keywords: normalizePgJsonColumnValue('bot_rules', 'keywords', ['!룰렛', '!roulette']),
        optionalPrefixKeywords: normalizePgJsonColumnValue('bot_rules', 'keywords', ['출석', '!출석', 'Help']),
        settings: normalizePgJsonColumnValue('bot_settings', 'settings', { enabled: true }),
        jsonString: normalizePgJsonColumnValue('bot_rules', 'responses', '["당첨"]'),
        plainString: normalizePgJsonColumnValue('bot_rules', 'responses', '당첨'),
        plainColumn: normalizePgJsonColumnValue('bot_rules', 'name', ['plain-column']),
        nullValue: normalizePgJsonColumnValue('bot_rules', 'keywords', null),
      }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());

    expect(result.known).toBe(true);
    expect(result.unknown).toBe(false);
    expect(JSON.parse(result.keywords)).toEqual(['!룰렛', '!roulette']);
    expect(JSON.parse(result.optionalPrefixKeywords)).toEqual(['출석', '!출석', 'Help']);
    expect(JSON.parse(result.settings)).toEqual({ enabled: true });
    expect(result.jsonString).toBe('["당첨"]');
    expect(result.plainString).toBe('"당첨"');
    expect(result.plainColumn).toEqual(['plain-column']);
    expect(result.nullValue).toBeNull();
  });
});
