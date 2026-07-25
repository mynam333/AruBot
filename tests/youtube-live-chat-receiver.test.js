const axios = require('axios');
const {
  buildYoutubeChatRequest,
  createYoutubeLiveChatReceiver,
  fetchChatCompat,
  getOptionsFromLivePageCompat,
  liveIdsFromChannelPage,
  receiverMessageText,
  toYoutubeLiveChatItem,
} = require('../server/youtube-live-chat-receiver.cjs');

describe('YouTube live chat receiver adapter', () => {
  test('reads the live-chat continuation instead of unrelated page continuations', () => {
    const options = getOptionsFromLivePageCompat(`
      <script>var ytcfg = {"INNERTUBE_API_KEY":"api-key","clientVersion":"2.20260715.00.00"};</script>
      <script>window["ytInitialData"] = ${JSON.stringify({
        contents: {
          liveChatRenderer: {
            continuations: [{ invalidationContinuationData: { continuation: 'live-chat-token' } }],
            header: {
              continuationCommand: { token: 'unrelated-token' },
            },
          },
        },
      })};</script>
    `, 'video123');

    expect(options).toEqual({
      liveId: 'video123',
      apiKey: 'api-key',
      clientVersion: '2.20260715.00.00',
      continuation: 'live-chat-token',
    });
  });

  test('reports a disabled live chat without selecting another continuation', () => {
    expect(() => getOptionsFromLivePageCompat(`
      <script>window["ytInitialData"] = ${JSON.stringify({
        contents: {
          messageRenderer: { text: { runs: [{ text: 'Chat is disabled for this live stream.' }] } },
        },
      })};</script>
      {"INNERTUBE_API_KEY":"api-key","clientVersion":"2.20260715.00.00","continuationCommand":{"token":"comments-token"}}
    `, 'video123')).toThrow('Chat is disabled for this live stream.');
  });

  test('finds a live video in the current channel lockup page shape', () => {
    const page = `
      <script>var ytInitialData = ${JSON.stringify({
        contents: {
          richGridRenderer: {
            contents: [
              {
                richItemRenderer: {
                  content: {
                    lockupViewModel: {
                      contentId: 'liveVideo01',
                      contentImage: {
                        thumbnailViewModel: {
                          overlays: [{
                            thumbnailBottomOverlayViewModel: {
                              badges: [{
                                thumbnailBadgeViewModel: {
                                  badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE',
                                  text: 'LIVE',
                                },
                              }],
                            },
                          }],
                        },
                      },
                    },
                  },
                },
              },
              {
                richItemRenderer: {
                  content: {
                    lockupViewModel: {
                      contentId: 'recorded001',
                      contentImage: {
                        thumbnailViewModel: {
                          overlays: [{
                            thumbnailBottomOverlayViewModel: {
                              badges: [{ thumbnailBadgeViewModel: { badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT' } }],
                            },
                          }],
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      })};</script>
    `;

    expect(liveIdsFromChannelPage(page)).toEqual(['liveVideo01']);
  });

  test('keeps the legacy live video renderer compatible', () => {
    const page = `
      <script>var ytInitialData = ${JSON.stringify({
        contents: {
          videoRenderer: {
            videoId: 'legacyLive1',
            thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { style: 'LIVE' } }],
          },
        },
      })};</script>
    `;

    expect(liveIdsFromChannelPage(page)).toEqual(['legacyLive1']);
  });

  test('builds browser-context headers for live chat continuation requests', () => {
    const request = buildYoutubeChatRequest({
      liveId: 'video123',
      clientVersion: '2.20260716.00.00',
      visitorData: 'visitor-token',
      continuation: 'continuation-token',
    });

    expect(request.body).toMatchObject({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20260716.00.00',
          visitorData: 'visitor-token',
        },
      },
      continuation: 'continuation-token',
    });
    expect(request.headers).toMatchObject({
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/live_chat?v=video123&is_popout=1',
      'X-Goog-Visitor-Id': 'visitor-token',
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': '2.20260716.00.00',
    });
  });

  test('refreshes the live page once and retries a rejected chat request', async () => {
    const post = jest.spyOn(axios, 'post')
      .mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 403'), { response: { status: 403 } }))
      .mockResolvedValueOnce({
        data: {
          continuationContents: {
            liveChatContinuation: {
              actions: [],
              continuations: [{ timedContinuationData: { continuation: 'next-token' } }],
            },
          },
        },
      });
    const get = jest.spyOn(axios, 'get').mockResolvedValue({
      data: `
        <script>var ytcfg = {"INNERTUBE_API_KEY":"fresh-api-key","clientVersion":"2.20260716.01.00","visitorData":"fresh-visitor"};</script>
        <script>window["ytInitialData"] = ${JSON.stringify({
          contents: {
            liveChatRenderer: {
              continuations: [{ timedContinuationData: { continuation: 'fresh-token' } }],
            },
          },
        })};</script>
      `,
    });

    try {
      const [items, continuation] = await fetchChatCompat({
        liveId: 'video123',
        apiKey: 'expired-api-key',
        clientVersion: '2.20260716.00.00',
        visitorData: 'expired-visitor',
        continuation: 'expired-token',
      });

      expect(items).toEqual([]);
      expect(continuation).toBe('next-token');
      expect(post).toHaveBeenCalledTimes(2);
      expect(post.mock.calls[1][1]).toMatchObject({ continuation: 'fresh-token' });
      expect(post.mock.calls[1][2].headers).toMatchObject({
        'X-Goog-Visitor-Id': 'fresh-visitor',
        'X-Youtube-Client-Version': '2.20260716.01.00',
      });
      expect(get).toHaveBeenCalledTimes(1);
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });

  test('retries a transient 503 chat response before ending the receiver session', async () => {
    const post = jest.spyOn(axios, 'post')
      .mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 503'), {
        response: { status: 503, headers: { 'retry-after': '0' } },
      }))
      .mockResolvedValueOnce({
        data: {
          continuationContents: {
            liveChatContinuation: {
              actions: [],
              continuations: [{ timedContinuationData: { continuation: 'recovered-token' } }],
            },
          },
        },
      });

    try {
      const [items, continuation] = await fetchChatCompat({
        liveId: 'video123',
        apiKey: 'api-key',
        clientVersion: '2.20260725.00.00',
        continuation: 'continuation-token',
      });

      expect(items).toEqual([]);
      expect(continuation).toBe('recovered-token');
      expect(post).toHaveBeenCalledTimes(2);
    } finally {
      post.mockRestore();
    }
  });

  test('creates an event receiver for a known broadcast without starting network work', () => {
    const receiver = createYoutubeLiveChatReceiver({ broadcastId: 'video123', intervalMs: 5000 });

    expect(receiver.liveId).toBe('video123');
    expect(typeof receiver.start).toBe('function');
    expect(typeof receiver.stop).toBe('function');
  });

  test('joins text and emoji message segments', () => {
    expect(receiverMessageText([
      { text: 'hello ' },
      { emojiText: ':wave:', alt: 'wave' },
      { text: ' world' },
    ])).toBe('hello :wave: world');
  });

  test('maps chat identity and roles into the existing event shape', () => {
    const item = toYoutubeLiveChatItem({
      id: 'chat-1',
      author: { name: 'viewer', channelId: 'channel-1', thumbnail: { url: 'https://example.com/a.jpg' } },
      message: [{ text: 'hello' }],
      isMembership: true,
      isVerified: true,
      isOwner: false,
      isModerator: true,
      timestamp: new Date('2026-07-15T00:00:00.000Z'),
    });

    expect(item.id).toBe('chat-1');
    expect(item.snippet.type).toBe('textMessageEvent');
    expect(item.snippet.textMessageDetails.messageText).toBe('hello');
    expect(item.authorDetails).toMatchObject({
      channelId: 'channel-1',
      displayName: 'viewer',
      isChatSponsor: true,
      isVerified: true,
      isChatModerator: true,
    });
  });

  test('maps KRW Super Chat amounts and keeps stickers distinguishable', () => {
    const superChat = toYoutubeLiveChatItem({
      id: 'paid-1',
      author: { name: 'donor', channelId: 'channel-2' },
      message: [{ text: 'support' }],
      superchat: { amount: '\u20a91,000', color: '#00ff00' },
      timestamp: new Date('2026-07-15T00:00:00.000Z'),
    });
    const sticker = toYoutubeLiveChatItem({
      id: 'sticker-1',
      author: { name: 'donor', channelId: 'channel-2' },
      message: [],
      superchat: {
        amount: 'US$2.00',
        color: '#00ff00',
        sticker: { url: 'https://example.com/sticker.png', alt: 'sticker' },
      },
      timestamp: new Date('2026-07-15T00:00:00.000Z'),
    });

    expect(superChat.snippet.type).toBe('superChatEvent');
    expect(superChat.snippet.superChatDetails).toMatchObject({
      currency: 'KRW',
      amountMicros: 1000000000,
      userComment: 'support',
    });
    expect(sticker.snippet.type).toBe('superStickerEvent');
  });
});
