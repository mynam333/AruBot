const fs = require('fs');
const path = require('path');

describe('action blueprint edge compatibility', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const uiSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'action-blueprint-page.tsx'), 'utf8');

  function extractBetween(startMarker, endMarker) {
    const start = serverSource.indexOf(startMarker);
    const end = serverSource.indexOf(endMarker, start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return serverSource.slice(start, end);
  }

  test('normalizes legacy edge fields while preserving case-sensitive random option IDs', () => {
    const block = extractBetween('function blueprintInputPorts', 'const OBS_SCENE_ACTIONS');
    const normalizeBlueprintEdges = Function(`${block}\nreturn normalizeBlueprintEdges;`)();
    const [conditionEdge, randomEdge] = normalizeBlueprintEdges([
      { source_id: 'condition', sourceHandle: 'TRUE', target_id: 'chat', target_handle: 'IN' },
      { source: 'random', sourcePort: 'option:VIP', target: 'vip-chat', targetPort: 'in' },
    ]);

    expect(conditionEdge).toMatchObject({ source: 'condition', sourcePort: 'true', target: 'chat', targetPort: 'in' });
    expect(randomEdge).toMatchObject({ source: 'random', sourcePort: 'option:VIP', target: 'vip-chat', targetPort: 'in' });
  });

  test('allows intentional one-sided conditions but rejects a condition with no branch at all', () => {
    const validationSource = extractBetween('function validateBlueprintGraph', 'async function resolveBlueprintChannelUid');
    const validateBlueprintGraph = Function(
      'normalizeBlueprintEdges',
      'blueprintInputPorts',
      'blueprintOutputPorts',
      'validateBlueprintNodeConfig',
      'blueprintAllowsMultipleOutgoing',
      'hasBlueprintCycle',
      `${validationSource}\nreturn validateBlueprintGraph;`
    )(
      (edges) => edges,
      (node) => node.type === 'start' ? [] : ['in'],
      (node) => node.type === 'end' ? [] : (
        node.type === 'condition' ? ['true', 'false'] : ['out']
      ),
      () => [],
      () => false,
      () => false
    );
    const nodes = [
      { id: 'start', type: 'start' },
      { id: 'condition', type: 'condition', name: '포인트 조건' },
      { id: 'chat', type: 'chat' },
    ];
    const startEdge = { source: 'start', sourcePort: 'out', target: 'condition', targetPort: 'in' };
    const trueEdge = { source: 'condition', sourcePort: 'true', target: 'chat', targetPort: 'in' };

    expect(validateBlueprintGraph(nodes, [startEdge, trueEdge])).toEqual([]);
    expect(validateBlueprintGraph(nodes, [startEdge])).toContain(
      '포인트 조건: 참 또는 거짓 분기 중 하나 이상을 다음 노드에 연결해 주세요.'
    );
  });

  test('keeps the editor loader aligned with server legacy aliases and branch validation', () => {
    expect(uiSource).toContain('source.sourceHandle ?? source.source_port ?? source.source_handle');
    expect(uiSource).toContain('source.source ?? source.sourceId ?? source.source_id');
    expect(uiSource).toContain('참 또는 거짓 분기 중 하나 이상을 다음 노드에 연결해 주세요.');
  });
});
