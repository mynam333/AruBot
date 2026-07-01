import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'public', 'files', 'logo.png');
const outputPath = path.join(root, 'local-program', 'build', 'icon.ico');
const sizes = [256, 128, 64, 48, 32, 16];

function writeDirectoryHeader(buffer, imageCount) {
  buffer.writeUInt16LE(0, 0);
  buffer.writeUInt16LE(1, 2);
  buffer.writeUInt16LE(imageCount, 4);
}

async function createIcon() {
  const pngBuffers = await Promise.all(sizes.map((size) => sharp(sourcePath)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()));

  const headerSize = 6 + (pngBuffers.length * 16);
  const totalSize = headerSize + pngBuffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const iconBuffer = Buffer.alloc(totalSize);
  writeDirectoryHeader(iconBuffer, pngBuffers.length);

  let imageOffset = headerSize;
  for (let index = 0; index < pngBuffers.length; index += 1) {
    const size = sizes[index];
    const pngBuffer = pngBuffers[index];
    const entryOffset = 6 + (index * 16);
    iconBuffer.writeUInt8(size === 256 ? 0 : size, entryOffset);
    iconBuffer.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    iconBuffer.writeUInt8(0, entryOffset + 2);
    iconBuffer.writeUInt8(0, entryOffset + 3);
    iconBuffer.writeUInt16LE(1, entryOffset + 4);
    iconBuffer.writeUInt16LE(32, entryOffset + 6);
    iconBuffer.writeUInt32LE(pngBuffer.length, entryOffset + 8);
    iconBuffer.writeUInt32LE(imageOffset, entryOffset + 12);
    pngBuffer.copy(iconBuffer, imageOffset);
    imageOffset += pngBuffer.length;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, iconBuffer);
  console.log(`Wrote ${path.relative(root, outputPath)}`);
}

createIcon();
