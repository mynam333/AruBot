const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const ts = require('typescript');

// Inspect the staged files, not the checkout: tests in the full repository
// cannot catch a shared runtime module omitted from the deployment archive.
function verifyBackendArtifact(directory) {
  const root = path.resolve(directory);
  const pending = ['server/index.js'];
  const visited = new Set();
  while (pending.length) {
    const relative = pending.pop();
    if (visited.has(relative)) continue;
    visited.add(relative);
    const filename = path.resolve(root, relative);
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      throw new Error(`Missing backend runtime module: ${relative}`);
    }
    if (!/\.[cm]?js$/.test(filename)) continue;
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const inspectSpecifier = (node) => {
      if (!node || !ts.isStringLiteralLike(node) || !node.text.startsWith('.')) return;
      const target = fileURLToPath(new URL(node.text, pathToFileURL(filename)));
      const targetRelative = path.relative(root, target);
      if (targetRelative === '..' || targetRelative.startsWith(`..${path.sep}`) || path.isAbsolute(targetRelative)) {
        throw new Error(`Backend import escapes the artifact: ${relative} -> ${node.text}`);
      }
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new Error(`Missing backend runtime module: ${relative} -> ${node.text}`);
      }
      pending.push(targetRelative);
    };
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) inspectSpecifier(node.moduleSpecifier);
      if (ts.isCallExpression(node) && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      )) inspectSpecifier(node.arguments[0]);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { modules: visited.size };
}

module.exports = { verifyBackendArtifact };

if (require.main === module) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node scripts/verify-backend-artifact.cjs <staging-directory>');
    const result = verifyBackendArtifact(process.argv[2]);
    console.log(`[backend artifact] verified ${result.modules} local runtime modules`);
  } catch (error) {
    console.error(`[backend artifact] ${error.message}`);
    process.exitCode = 1;
  }
}
