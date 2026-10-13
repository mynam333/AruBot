const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { withRouletteVariableContext } = require('./load-source.cjs')('server/roulette-variable-catalog.js');

module.exports = function loadBotVariableCatalog() {
  const file = path.join(__dirname, '..', '..', 'server', 'index.js');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = source.statements.filter(ts.isVariableStatement).flatMap(node => node.declarationList.declarations);
  const names = ['BOT_VARIABLE_PROVIDERS', 'BOT_VARIABLES'];
  const code = names.map(name => {
    const declaration = declarations.find(node => node.name.getText(source) === name);
    if (!declaration?.initializer) throw new Error(`Missing variable catalog declaration: ${name}`);
    return `const ${name} = ${declaration.initializer.getText(source)};`;
  }).join('\n');
  return new Function('withRouletteVariableContext', `${code}\nreturn BOT_VARIABLES;`)(withRouletteVariableContext);
};
