import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const localProgramVersion = process.env.ARUBOT_LOCAL_VERSION || packageJson.version;
const outputPath = path.join(root, 'dist', 'local-program', 'RELEASE_NOTES.md');
const releaseTag = process.env.RELEASE_TAG || `local-v${localProgramVersion}`;
const watchedPaths = [
  'local-program',
  'electron-builder.local.yml',
  'scripts/build-local-program.js',
  'scripts/create-local-program-icon.js',
  'scripts/write-local-program-manifest.js',
  'package.json',
  'package-lock.json',
];

function git(args, fallback = '') {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

function previousReleaseTag() {
  const tags = git(['tag', '--list', 'local-v*', '--sort=-creatordate'])
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((tag) => tag !== releaseTag);
  return tags[0] || '';
}

const previousTag = previousReleaseTag();
const range = previousTag ? `${previousTag}..HEAD` : 'HEAD';
const commits = git(['log', '--pretty=format:- %s (%h)', range, '--', ...watchedPaths])
  .split(/\r?\n/)
  .map((item) => item.trim())
  .filter(Boolean);
const changedFiles = git(['diff', '--name-only', previousTag ? `${previousTag}..HEAD` : 'HEAD~1..HEAD', '--', ...watchedPaths])
  .split(/\r?\n/)
  .map((item) => item.trim())
  .filter(Boolean);

const notes = [
  `# AruBot Local Program v${localProgramVersion}`,
  '',
  previousTag ? `기준 릴리스: \`${previousTag}\`` : '기준 릴리스: 첫 로컬 프로그램 릴리스',
  '',
  '## 변경 사항',
  '',
  ...(commits.length ? commits : ['- 로컬 프로그램 릴리스 산출물을 갱신했습니다.']),
  '',
  '## 변경된 파일',
  '',
  ...(changedFiles.length ? changedFiles.map((file) => `- \`${file}\``) : ['- 변경된 로컬 프로그램 파일을 찾지 못했습니다.']),
  '',
  '## 포함된 파일',
  '',
  `- \`AruBot-Local-Program-${localProgramVersion}-x64.exe\``,
  `- \`AruBot-Local-Program-${localProgramVersion}-x64.exe.blockmap\``,
  '- `latest.yml`',
  '- `latest.json`',
  '',
  '## 업데이트 방식',
  '',
  '`latest.yml`과 blockmap은 프로그램 내부 자동 업데이트에 사용되고, `latest.json`은 버전 표시와 수동 복구용 다운로드 정보에 사용됩니다.',
  '',
].join('\n');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, notes, 'utf8');
console.log(`Wrote ${path.relative(root, outputPath)}`);
