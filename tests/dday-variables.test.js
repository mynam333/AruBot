const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

describe('KST D-Day variables', () => {
  const root = path.join(__dirname, '..');
  const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const variableHelp = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'command-variable-help.tsx'), 'utf8');
  let result;

  beforeAll(() => {
    const ddayModuleUrl = new URL('../server/dday-variables.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const blueprintModuleUrl = new URL('../server/action-blueprint-values.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const dday = await import(${JSON.stringify(ddayModuleUrl)});
      const blueprintValues = await import(${JSON.stringify(blueprintModuleUrl)});
      const now = Date.parse('2026-08-14T03:00:00.000Z');
      const leapNow = Date.parse('2028-02-28T12:00:00.000Z');
      const invalidToken = '\${dday::2026-02-29}';
      const blueprintToken = '\${dday::2099-01-01}';
      console.log(JSON.stringify({
        signs: {
          future: dday.calculateKstDday('2026-08-21', now),
          today: dday.calculateKstDday('2026-08-14', now),
          past: dday.calculateKstDday('2026-08-07', now),
        },
        boundary: {
          before: dday.calculateKstDday('2026-08-14', Date.parse('2026-08-13T14:59:59.999Z')),
          at: dday.calculateKstDday('2026-08-14', Date.parse('2026-08-13T15:00:00.000Z')),
        },
        leap: dday.substituteDdayVariables(
          '내일 \${dday::2028-02-29}, 이틀 뒤 \${ DDAY :: 2028-03-01 }, 어제 \${dday::2028-02-27}',
          leapNow
        ),
        invalid: {
          calculated: dday.calculateKstDday('2026-02-29'),
          rendered: dday.substituteDdayVariables(invalidToken, Date.parse('2026-02-01T00:00:00Z')),
        },
        blueprint: {
          expected: dday.calculateKstDday('2099-01-01'),
          rendered: blueprintValues.renderBlueprintTemplate(blueprintToken, {}),
          evaluated: blueprintValues.evaluateBlueprintValue(blueprintToken, {}),
        },
      }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root,
      encoding: 'utf8',
    }).trim());
  });

  test('returns positive future days, zero today, and negative past days', () => {
    expect(result.signs).toEqual({ future: 7, today: 0, past: -7 });
  });

  test('changes days at KST midnight instead of the host or UTC midnight', () => {
    expect(result.boundary).toEqual({ before: 1, at: 0 });
  });

  test('handles leap days and replaces every valid token', () => {
    expect(result.leap).toBe('내일 1, 이틀 뒤 2, 어제 -1');
  });

  test('leaves impossible calendar dates unchanged', () => {
    const token = '${dday::2026-02-29}';
    expect(result.invalid).toEqual({ calculated: null, rendered: token });
  });

  test('works in blueprint template values as a numeric variable', () => {
    expect(result.blueprint.rendered).toBe(String(result.blueprint.expected));
    expect(result.blueprint.evaluated).toBe(result.blueprint.expected);
  });

  test('is wired into shared placeholders and the variable catalog', () => {
    expect(serverIndex).toContain("import { substituteDdayVariables } from './dday-variables.js'");
    expect(serverIndex).toContain('let out = substituteDdayVariables(text);');
    expect(serverIndex).toContain("key: '${dday::2026-08-14}'");
    expect(variableHelp).toContain("'채널', '날짜'");
  });
});
