const fs = require('fs');
const path = require('path');

describe('production log persistence', () => {
  const root = path.join(__dirname, '..');
  const ecosystem = fs.readFileSync(path.join(root, 'ecosystem.config.cjs'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-backend.yml'), 'utf8');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

  test('PM2 creates and writes both streams under the project logs directory', () => {
    expect(ecosystem).toContain("const logsDir = path.join(rootDir, 'logs')");
    expect(ecosystem).toContain('fs.mkdirSync(logsDir, { recursive: true })');
    expect(ecosystem).not.toContain('process.env.ARUBOT_LOG_DIR');
    expect(ecosystem).toContain("out_file: path.join(logsDir, 'api.out.log')");
    expect(ecosystem).toContain("error_file: path.join(logsDir, 'api.err.log')");
    expect(ecosystem).toContain("log_date_format: 'YYYY-MM-DD HH:mm:ss Z'");
  });

  test('deployments preserve logs and verify the target is writable before PM2 starts', () => {
    expect(workflow).toContain('ln -sfn "$SHARED_DIR/logs" "$TMP_RELEASE_DIR/logs"');
    expect(workflow).toContain('verify_log_dir_writable');
    expect(workflow).toContain('.arubot-write-probe-$$');
    expect(workflow).toContain('readlink -f "$stable_cwd/logs"');
    expect(workflow).toContain('readlink -f "$APP_DIR/shared/logs"');
  });

  test('the directory is committed but runtime log contents remain ignored', () => {
    expect(fs.existsSync(path.join(root, 'logs', '.gitkeep'))).toBe(true);
    expect(ignore).toContain('/logs/*');
    expect(ignore).toContain('!/logs/.gitkeep');
    expect(ignore).toContain('*.log');
  });
});
