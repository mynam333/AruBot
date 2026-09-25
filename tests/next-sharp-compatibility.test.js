const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { optimizeImage } = require('next/dist/server/image-optimizer');

const root = path.join(__dirname, '..');

describe('Next.js and sharp image optimization compatibility', () => {
  test('optimizes the production logo to a non-empty 64x64 WebP image', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(require('next/package.json').version).toBe(manifest.dependencies.next);
    expect(sharp.versions.sharp).toBe(manifest.dependencies.sharp);

    const source = fs.readFileSync(path.join(root, 'public', 'files', 'logo.png'));
    const optimized = await optimizeImage({
      buffer: source,
      contentType: 'image/webp',
      quality: 75,
      width: 64,
    });

    expect(Buffer.isBuffer(optimized)).toBe(true);
    expect(optimized.length).toBeGreaterThan(0);

    const metadata = await sharp(optimized).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(64);
    expect(metadata.height).toBe(64);
  });
});
