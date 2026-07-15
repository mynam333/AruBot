const fs = require('fs');
const path = require('path');

describe('streamer shell brand navigation', () => {
  test('the top-left brand opens the main landing page', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'components', 'app-shell', 'admin-shell.tsx'),
      'utf8',
    );
    const brandStart = source.indexOf('function Brand(');
    const brandEnd = source.indexOf('function NavItem(', brandStart);
    const brand = source.slice(brandStart, brandEnd);

    expect(brand).toContain('href="/"');
    expect(brand).not.toContain('href="/dashboard"');
  });
});
