const load = require('./helpers/load-source.cjs');
let savedAudio, savedImage, audios, images;
beforeEach(() => {
  savedAudio = global.Audio; savedImage = global.Image; audios = []; images = [];
  global.Audio = class {
    constructor(src) { this.src = src; this.play = jest.fn(async () => {}); this.load = jest.fn(); this.pause = jest.fn(); this.removeAttribute = jest.fn(); audios.push(this); }
  };
  global.Image = class {
    constructor() { this.decode = jest.fn(async () => {}); images.push(this); }
  };
});
afterEach(() => {
  if (savedAudio === undefined) delete global.Audio; else global.Audio = savedAudio;
  if (savedImage === undefined) delete global.Image; else global.Image = savedImage;
});
const cache = () => load('src/shared/lib/fx-media.ts').createFxMediaCache();

test('preloads each asset once without playing any sound', () => {
  const media = cache();
  for (let i = 0; i < 5; i++) {
    media.warm({ kind: 'sound', assetUrl: '/sound.mp3' });
    media.warm({ kind: 'image', assetUrl: '/image.png' });
  }
  expect(audios).toHaveLength(1); expect(images).toHaveLength(1);
  expect(audios[0].preload).toBe('auto');
  expect(audios[0].load).toHaveBeenCalledTimes(1);
  expect(audios[0].play).not.toHaveBeenCalled();
  expect(images[0].decode).toHaveBeenCalledTimes(1);
  media.dispose();
});

test('plays the preloaded audio immediately, preserves zero volume and reuses completed sounds', () => {
  const media = cache();
  media.warm({ kind: 'sound', assetUrl: '/sound.mp3' });
  media.play('/sound.mp3', 0);
  expect(audios).toHaveLength(1);
  expect(audios[0].play).toHaveBeenCalledTimes(1);
  expect(audios[0].volume).toBe(0);
  audios[0].onended();
  media.play('/sound.mp3', 0.2);
  expect(audios).toHaveLength(1);
  expect(audios[0].play).toHaveBeenCalledTimes(2);
  expect(audios[0].currentTime).toBe(0);
  media.dispose();
});

test('overlapping requests do not interrupt a sound that is already playing', () => {
  const media = cache();
  media.warm({ kind: 'sound', assetUrl: '/sound.mp3' });
  media.play('/sound.mp3', 0.5); media.play('/sound.mp3', 0.5);
  expect(audios).toHaveLength(2);
  expect(audios[0].pause).not.toHaveBeenCalled();
  expect(audios[1].play).toHaveBeenCalledTimes(1);
  media.dispose();
  expect(audios.every((audio) => audio.pause.mock.calls.length === 1)).toBe(true);
});

test('preload cache is bounded and unloading releases cached and playing media', () => {
  const media = cache();
  for (let i = 0; i < 40; i++) media.warm({ kind: 'sound', assetUrl: `/sound-${i}.mp3` });
  media.play('/sound-0.mp3', 1);
  expect(audios).toHaveLength(41);
  media.dispose();
  expect(audios.filter((audio) => audio.removeAttribute.mock.calls.length)).toHaveLength(33);
});
