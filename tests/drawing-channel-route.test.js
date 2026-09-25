const loadSource = require('./helpers/load-source.cjs');
const { decodeChannelRouteParam } = loadSource('src/shared/lib/channel-route-param.ts');

describe('drawing channel route identity', () => {
  test.each([
    ['cime:1033927', 'cime:1033927'],
    ['cime%3A1033927', 'cime:1033927'],
    ['cime%253A1033927', 'cime:1033927'],
    ['cime%25253A1033927', 'cime:1033927'],
    ['youtube%3AUCOR7E6eE8qJ8NLvRxbZin3w', 'youtube:UCOR7E6eE8qJ8NLvRxbZin3w'],
    ['chzzk:0123456789abcdef0123456789abcdef', 'chzzk:0123456789abcdef0123456789abcdef'],
    ['legacy_channel-123', 'legacy_channel-123'],
  ])('preserves the exact channel identity for %s', (input, expected) => {
    expect(decodeChannelRouteParam(input)).toBe(expected);
  });

  test.each(['', '%', 'cime%3A1033927%2Fother', '%252e%252e', 'cime:1033927?other=1', 'javascript:123', 'cime%2525253A1033927'])('rejects malformed or unsafe route identities: %s', (input) => {
    expect(decodeChannelRouteParam(input)).toBeNull();
  });

  test('passes the normalized UID to the editor for the reported double-encoded route', async () => {
    const { default: Page } = loadSource('src/app/(viewer-dashboard)/viewer/drawing/[channelUid]/page.tsx', {
      'next/navigation': { notFound: () => { throw new Error('not found'); } },
      '@/features/viewer/drawing-donation-page': { DrawingDonationEditorPage: () => null },
      '@/shared/lib/channel-route-param': { decodeChannelRouteParam },
    });
    const page = await Page({ params: Promise.resolve({ channelUid: 'cime%253A1033927' }) });
    expect(page.props.channelUid).toBe('cime:1033927');
    await expect(Page({ params: Promise.resolve({ channelUid: '%' }) })).rejects.toThrow('not found');
  });
});
