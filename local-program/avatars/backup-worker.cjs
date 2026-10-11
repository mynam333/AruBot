const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parentPort, workerData: input } = require('worker_threads');
const {
  LIMITS,
  assetId,
  migrateConfig,
  validateConfig,
} = require('./schema.cjs');
const { validateImage, checkVersion, references } = require('./storage.cjs');
const { migrateLegacyAvatars } = require('./bundled.cjs');

const progress = (value, phase) =>
  parentPort.postMessage({ type: 'progress', progress: value, phase });

async function run() {
  if (input.action === 'export') {
    let data;
    if (input.kind === 'profiles') {
      data = {
        format: 'aruavatars-profiles',
        version: 1,
        profiles: input.profiles,
      };
    } else {
      const names = [...references(input.config)],
        assets = [];
      for (let i = 0; i < names.length; i++) {
        const buffer = fs.readFileSync(path.join(input.assetRoot, names[i]));
        const meta = await validateImage(buffer);
        if (meta.asset !== names[i])
          throw new Error('백업 이미지 무결성 오류입니다.');
        assets.push({ name: names[i], data: buffer.toString('base64') });
        progress(Math.round(((i + 1) / names.length) * 70), 'images');
      }
      data = {
        format: 'aruavatars',
        version: 1,
        config: {
          ...input.config,
          key: undefined,
          enabled: false,
          paused: false,
        },
        assets,
      };
    }
    progress(75, 'compressing');
    fs.writeFileSync(
      path.join(input.stage, 'backup'),
      zlib.gzipSync(JSON.stringify(data), { level: 9 }),
      { mode: 0o600 },
    );
    progress(95, 'prepared');
    return { prepared: true };
  }

  if (fs.statSync(input.file).size > 64 * 1024 * 1024)
    throw new Error('백업 파일이 너무 큽니다.');
  progress(5, 'decompressing');
  const data = JSON.parse(
    zlib
      .gunzipSync(fs.readFileSync(input.file), {
        maxOutputLength: 72 * 1024 * 1024,
      })
      .toString('utf8'),
  );
  if (data.version !== 1) throw new Error('지원하지 않는 백업입니다.');
  if (data.format === 'aruavatars-profiles') {
    if (!input.restoreProfiles || input.kind !== 'profiles')
      throw new Error('개인 기록 복원은 별도 동의가 필요합니다.');
    if (
      !data.profiles ||
      typeof data.profiles !== 'object' ||
      Array.isArray(data.profiles) ||
      Buffer.byteLength(JSON.stringify(data.profiles)) > 4 * 1024 * 1024
    )
      throw new Error('개인 기록 형식이 올바르지 않습니다.');
    return { profiles: data.profiles };
  }
  if (
    input.kind === 'profiles' ||
    data.format !== 'aruavatars' ||
    !Array.isArray(data.assets) ||
    data.assets.length > LIMITS.assets
  )
    throw new Error('지원하지 않는 백업입니다.');
  checkVersion(data.config);
  const config = validateConfig(
    {
      ...migrateConfig(migrateLegacyAvatars(data.config)),
      enabled: false,
      paused: false,
      port: input.config.port,
    },
    input.config,
  );
  const names = new Set(),
    assets = [];
  let total = 0;
  for (const a of data.assets) {
    if (
      !assetId(a.name) ||
      typeof a.data !== 'string' ||
      a.data.length > LIMITS.fileBytes * 1.4 ||
      names.has(a.name)
    )
      throw new Error('백업 이미지가 올바르지 않습니다.');
    names.add(a.name);
    const buffer = Buffer.from(a.data, 'base64');
    total += buffer.length;
    if (total > LIMITS.totalBytes)
      throw new Error('백업 이미지 용량을 초과했습니다.');
    const meta = await validateImage(buffer);
    if (meta.asset !== a.name)
      throw new Error('백업 이미지 무결성 오류입니다.');
    fs.writeFileSync(path.join(input.stage, a.name), buffer, {
      flag: 'wx',
      mode: 0o600,
    });
    const existing = path.join(input.assetRoot, a.name);
    if (fs.existsSync(existing)) {
      if (fs.statSync(existing).size > LIMITS.fileBytes)
        throw new Error(
          '기존 이미지 크기가 비정상입니다. 원본을 별도로 보관한 뒤 복원해 주세요.',
        );
      const original = fs.readFileSync(existing);
      if (!original.equals(buffer)) {
        fs.writeFileSync(
          path.join(input.stage, `original-${a.name}`),
          original,
          { flag: 'wx', mode: 0o600 },
        );
        meta.replace = true;
      }
    }
    assets.push(meta);
    progress(
      10 + Math.round((assets.length / data.assets.length) * 80),
      'validating',
    );
  }
  for (const name of references(config))
    if (!names.has(name)) throw new Error('백업에 필요한 이미지가 없습니다.');
  return { config, assets };
}

run()
  .then((value) => parentPort.postMessage({ type: 'result', value }))
  .catch((error) =>
    parentPort.postMessage({
      type: 'error',
      message: error.message,
      code: error.code,
    }),
  );
