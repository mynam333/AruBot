export function registerSongbookRoutes(app, { store, getAdminOwner, getViewerUser, resolveChannel, normalizeUid, getPublicPath, writeLimiter, logger = console }) {
  const wrap = fn => async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try { return res.json(await fn(req)); }
    catch (error) {
      if (!error.status) logger.error('[songbook] Request failed:', error);
      return res.status(error.status || 503).json({ error: error.status ? error.message : '노래책을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  };
  const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };
  const owner = async req => await getAdminOwner(req) || fail('로그인이 필요합니다.', 401);
  const viewer = async req => await getViewerUser(req) || fail('로그인이 필요합니다.', 401);
  const channel = async req => {
    const uid = normalizeUid(req.params.uid);
    if (!uid) return fail('채널 주소를 확인해 주세요.', 400);
    const identity = await resolveChannel(uid);
    return identity?.ownerUserId || fail('채널을 찾지 못했습니다.', 404);
  };

  app.get('/api/songbook', wrap(async req => {
    const id = await owner(req);
    return { ...await store.listSongs(id, req.query), publicPath: await getPublicPath(id).catch(() => null) };
  }));
  app.post('/api/songbook/songs', writeLimiter, wrap(async req => ({ song: await store.upsertSong(await owner(req), req.body) })));
  app.delete('/api/songbook/songs/:id', writeLimiter, wrap(async req => store.deleteSong(await owner(req), req.params.id, req.body?.revision)));
  app.patch('/api/songbook/settings', writeLimiter, wrap(async req => ({ settings: await store.updateSettings(await owner(req), req.body) })));
  app.get('/api/songbook/requests', wrap(async req => store.listRequests(await owner(req), { history: req.query.history === '1' })));
  app.patch('/api/songbook/requests/:id', writeLimiter, wrap(async req => ({ item: await store.changeRequest(await owner(req), req.params.id, req.body?.status, { expectedStatus: req.body?.expectedStatus }) })));

  app.get('/api/public/:uid/songbook', wrap(async req => store.listSongs(await channel(req), req.query, { publicOnly: true })));
  app.get('/api/viewer/songbook/:uid/requests', wrap(async req => {
    const viewerUserId = await viewer(req);
    return store.listRequests(await channel(req), { viewerUserId });
  }));
  app.post('/api/viewer/songbook/:uid/requests', writeLimiter, wrap(async req => {
    const actor = await viewer(req);
    return { item: await store.requestSong(await channel(req), actor, req.body) };
  }));
  app.post('/api/viewer/songbook/:uid/requests/:id/cancel', writeLimiter, wrap(async req => {
    const viewerUserId = await viewer(req);
    return { item: await store.changeRequest(await channel(req), req.params.id, 'cancelled', { viewerUserId }) };
  }));
}
