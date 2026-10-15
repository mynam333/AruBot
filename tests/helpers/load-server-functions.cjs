const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const textSafety = require('./load-source.cjs')('shared/text-safety.js');
const rulePatterns = require('./load-source.cjs')('server/rule-pattern.js');
const memoVariables = require('./load-source.cjs')('server/memo-variables.js', { '../shared/text-safety.js': textSafety });
const { createCommandExecutionSafety, isCommandSafetyError } = require('./load-source.cjs')('server/command-execution-safety.js');
const { createCommandAdmission } = require('./load-source.cjs')('server/command-admission.js');
function safetyBindings() {
  const commandAdmission = createCommandAdmission();
  return {
    chatIngress: { enabled: false, canRun: () => true },
    runtimeBackgroundInFlight: 0,
    ...memoVariables,
    resolveCommandMemoVariables: (plan, text) => memoVariables.resolveMemoVariablePlan(plan, text, { readMemos: async () => new Map() }),
    commandExecution: createCommandExecutionSafety(), commandAdmission, isCommandSafetyError,
    admitChatCommand: async (sid, provider, userId) => (await commandAdmission.admit({ sid, provider, userId })).allowed,
  };
}
const filename = path.join(__dirname, '..', '..', 'server', 'index.js');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

module.exports = function loadServerFunctions(names, bindings = {}) {
  bindings = { ...textSafety, ...rulePatterns, ...safetyBindings(), ...bindings };
  const functions = names.map((name) => {
    const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (!declaration) throw new Error(`Missing server function: ${name}`);
    return declaration.getText(source);
  });
  return new Function(...Object.keys(bindings), `${functions.join('\n')}\nreturn {${names.join(',')}};`)(...Object.values(bindings));
};

module.exports.route = function loadServerRoute(route, bindings = {}, method) {
  bindings = { ...textSafety, ...rulePatterns, ...safetyBindings(), ...bindings };
  const statement = source.statements.find((node) => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.arguments[0]?.text === route
    && (!method || node.expression.expression.name?.text === method));
  if (!statement) throw new Error(`Missing route: ${route}`);
  const handler = statement.expression.arguments.at(-1).getText(source);
  return new Function(...Object.keys(bindings), `return (${handler});`)(...Object.values(bindings));
};
