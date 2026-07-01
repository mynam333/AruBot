import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const appStageDir = path.join(root, 'dist', 'local-program-app');
const distDir = path.join(root, 'dist', 'local-program');
const publicDir = path.join(root, 'public', 'downloads', 'local-program');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const externalMode = process.argv.includes('--external') || process.env.ARUBOT_LOCAL_COPY_EXE_TO_PUBLIC === 'false';

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function cleanDirectory(targetDir) {
  if (!targetDir.startsWith(root)) {
    throw new Error(`Refusing to clean outside workspace: ${targetDir}`);
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
}

function findDistInstallers() {
  return fs.readdirSync(distDir).filter((fileName) => /^AruBot-Local-Program-.+\.exe$/i.test(fileName));
}

function syncPublicInstallers() {
  fs.mkdirSync(publicDir, { recursive: true });
  for (const fileName of fs.readdirSync(publicDir)) {
    if (/^AruBot-Local-Program-.+\.exe$/i.test(fileName) || fileName === 'latest.json') {
      fs.rmSync(path.join(publicDir, fileName), { force: true });
    }
  }
  const installers = findDistInstallers();
  if (!installers.length) throw new Error(`No installer was generated in ${distDir}`);
  if (externalMode) return;
  for (const fileName of installers) {
    fs.copyFileSync(path.join(distDir, fileName), path.join(publicDir, fileName));
  }
}

function prepareAppStage() {
  cleanDirectory(appStageDir);
  fs.cpSync(path.join(root, 'local-program'), appStageDir, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`),
  });
  fs.mkdirSync(path.join(appStageDir, 'node_modules'), { recursive: true });
  fs.cpSync(path.join(root, 'node_modules', 'ws'), path.join(appStageDir, 'node_modules', 'ws'), { recursive: true });
  fs.writeFileSync(path.join(appStageDir, 'package.json'), `${JSON.stringify({
    name: 'arubot-local-program',
    productName: 'AruBot Local Program',
    version: packageJson.version,
    description: 'AruBot broadcast PC automation client',
    author: packageJson.author || 'AruBot',
    main: 'main.cjs',
    dependencies: {
      ws: packageJson.dependencies.ws,
    },
  }, null, 2)}\n`, 'utf8');
}

cleanDirectory(distDir);
run('node', ['scripts/create-local-program-icon.js']);
prepareAppStage();
run('npx', ['electron-builder', '--config', 'electron-builder.local.yml']);
syncPublicInstallers();
run('node', ['scripts/write-local-program-manifest.js'], {
  ARUBOT_LOCAL_INSTALLER_DIR: externalMode ? distDir : publicDir,
  ARUBOT_LOCAL_MANIFEST_EXTRA_DIRS: distDir,
  ARUBOT_LOCAL_REQUIRE_EXTERNAL_URL: externalMode ? 'true' : '',
});
