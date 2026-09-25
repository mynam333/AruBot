const fs = require('fs');
const path = require('path');
const ts = require('typescript');

module.exports = function loadSource(relativePath, imports = {}) {
  const filename = path.join(__dirname, '..', '..', relativePath);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => Object.hasOwn(imports, name) ? imports[name] : require(name);
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
};
