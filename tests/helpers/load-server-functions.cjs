const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const textSafety = require('./load-source.cjs')('shared/text-safety.js');
const filename = path.join(__dirname, '..', '..', 'server', 'index.js');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

module.exports = function loadServerFunctions(names, bindings = {}) {
  bindings = { ...textSafety, ...bindings };
  const functions = names.map((name) => {
    const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (!declaration) throw new Error(`Missing server function: ${name}`);
    return declaration.getText(source);
  });
  return new Function(...Object.keys(bindings), `${functions.join('\n')}\nreturn {${names.join(',')}};`)(...Object.values(bindings));
};

module.exports.route = function loadServerRoute(route, bindings = {}, method) {
  bindings = { ...textSafety, ...bindings };
  const statement = source.statements.find((node) => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.arguments[0]?.text === route
    && (!method || node.expression.expression.name?.text === method));
  if (!statement) throw new Error(`Missing route: ${route}`);
  const handler = statement.expression.arguments.at(-1).getText(source);
  return new Function(...Object.keys(bindings), `return (${handler});`)(...Object.values(bindings));
};
