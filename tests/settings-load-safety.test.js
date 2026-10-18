const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Execute the actual page callbacks without requiring a browser or a live account.
function callback(file, component, name, bindings) {
  const text = fs.readFileSync(path.join(__dirname, '../src/features/admin', `${file}.tsx`), 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const root = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === component);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) {
      expression = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  if (!expression) throw new Error(`Missing ${component}.${name}`);
  const js = ts.transpileModule(`const handler = ${expression.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return handler;`)(...Object.values(bindings));
}

function setters(names) {
  return Object.fromEntries(names.split(' ').map((name) => [name, jest.fn()]));
}

const toast = { error: jest.fn(), success: jest.fn() };

test('attendance lookup failure retains the last values and retry loads the saved values', async () => {
  const bindings = {
    ...setters('setAttendanceLoadState setAttendanceEnabled setAttendanceAnnounce setAttendanceCommandOnly setAttendanceCommandKeyword setAttendanceMessage setAttendancePoints'),
    DEFAULT_ATTENDANCE_MESSAGE: 'Default', readJson: jest.fn(async () => null),
  };
  const load = callback('commands-page', 'CommandsPage', 'loadAttendanceSettings', bindings);
  await load();
  expect(bindings.setAttendanceLoadState.mock.calls).toEqual([['loading'], ['error']]);
  for (const [key, setter] of Object.entries(bindings)) {
    if (key.startsWith('setAttendance') && key !== 'setAttendanceLoadState') expect(setter).not.toHaveBeenCalled();
  }
  bindings.readJson.mockResolvedValueOnce({ settings: { attendanceEnabled: false, attendanceMessage: 'Saved message', channelPointsPerAttendance: 42 } });
  await load();
  expect(bindings.setAttendanceLoadState).toHaveBeenLastCalledWith('ready');
  expect(bindings.setAttendanceEnabled).toHaveBeenCalledWith(false);
  expect(bindings.setAttendanceMessage).toHaveBeenCalledWith('Saved message');
  expect(bindings.setAttendancePoints).toHaveBeenCalledWith('42');
});

test.each(['loading', 'error'])("unloaded settings cannot be submitted (%s)", async (state) => {
  const bindings = {
    writable: true, isPending: false, busyId: null, settingsLoaded: false,
    attendanceLoadState: state, settingsLoadState: state, settingsState: state,
    startTransition: jest.fn(), postJson: jest.fn(), setBusyId: jest.fn(),
  };
  for (const [file, component, name] of [
    ['commands-page', 'CommandsPage', 'saveAttendanceSettings'],
    ['points-page', 'PointsPage', 'savePointSettings'],
    ['drawing-donation-page', 'DrawingDonationPage', 'saveSettings'],
    ['admin-action-dialogs', 'DonationSettingsDialog', 'submit'],
  ]) await callback(file, component, name, bindings)(() => {});
  expect(bindings.startTransition).not.toHaveBeenCalled();
  expect(bindings.postJson).not.toHaveBeenCalled();
  expect(bindings.setBusyId).not.toHaveBeenCalled();
});

test.each(['points', 'donation', 'missing-settings'])('point form cannot use defaults after %s lookup failure', async (failure) => {
  const bindings = {
    ...setters('setSettingsLoadState setRows setDrafts setTotalRows setTotalPoints setFilteredTotalRows setFilteredPoints setTotalPages setPage setPointsPerChat setPointsPerAttendance setExcludeText setPointsPerDonationK'),
    page: 1, POINTS_PAGE_SIZE: 25, sortBy: 'points-desc', deferredQuery: '', donationReadable: true,
    startTransition: (fn) => fn(), rowUserId: (row) => row.userId, toast,
    readJson: jest.fn(async (url) => {
      if (url.startsWith('/api/channelpoints')) return failure === 'points' ? null : { points: [], settings: failure === 'missing-settings' ? undefined : {} };
      return failure === 'donation' ? null : { settings: { pointsPerK: 15 } };
    }),
  };
  callback('points-page', 'PointsPage', 'load', bindings)();
  // load starts a transition rather than returning its promise.
  await new Promise(setImmediate);
  expect(bindings.setSettingsLoadState).toHaveBeenLastCalledWith('error');
  for (const setter of ['setPointsPerChat', 'setPointsPerAttendance', 'setExcludeText', 'setPointsPerDonationK']) {
    expect(bindings[setter]).not.toHaveBeenCalled();
  }
  if (failure === 'points') expect(bindings.setRows).not.toHaveBeenCalled();
});

test('donation settings require a successful read and recover when reopened', async () => {
  const bindings = {
    ...setters('setSettingsState setPointsPerK'), apiUrl: (url) => url,
    fetch: jest.fn(async () => ({ ok: false })),
  };
  const load = callback('admin-action-dialogs', 'DonationSettingsDialog', 'load', bindings);
  await load();
  expect(bindings.setSettingsState).toHaveBeenLastCalledWith('error');
  expect(bindings.setPointsPerK).not.toHaveBeenCalled();
  bindings.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ settings: { pointsPerK: 0 } }) });
  await load();
  expect(bindings.setSettingsState).toHaveBeenLastCalledWith('ready');
  expect(bindings.setPointsPerK).toHaveBeenCalledWith('0');
});

test.each([
  ['commands-page', 'CommandsPage', 'setRules'],
  ['donation-rules-page', 'DonationRulesPage', 'setRules'],
  ['roulette-page', 'RoulettePage', 'setDefinitions'],
  ['macros-page', 'MacrosPage', 'setMacros'],
])('%s retains the last list during temporary read failures', async (file, component, setter) => {
  const bindings = { [setter]: jest.fn(), toast, readJson: async () => null, startTransition: (fn) => fn() };
  callback(file, component, 'load', bindings)();
  await new Promise(setImmediate);
  expect(bindings[setter]).not.toHaveBeenCalled();
});
