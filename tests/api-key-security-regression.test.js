const fs = require('fs');
const path = require('path');

describe('API key security regressions', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const supabase = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');

  test('/apikey return_to only redirects to the request origin', () => {
    const helperStart = serverIndex.indexOf('function getSameOriginReturnUrl');
    const helperEnd = serverIndex.indexOf('const oauthStateStore', helperStart);
    const helperBody = serverIndex.slice(helperStart, helperEnd);
    expect(helperBody).toContain('url.origin !== requestOrigin');

    const routeStart = serverIndex.indexOf("app.get('/apikey'");
    const routeEnd = serverIndex.indexOf('// Helper to get a valid access token', routeStart);
    const routeBody = serverIndex.slice(routeStart, routeEnd);
    expect(routeBody).toContain('getSameOriginReturnUrl(req, returnTo)');
    expect(routeBody).not.toContain('const url = new URL(returnTo)');
  });

  test('API keys are stored and looked up by hash instead of reusable plaintext', () => {
    const issueStart = supabase.indexOf('export async function issueApiKey');
    const issueEnd = supabase.indexOf('export async function getOwnerPidForApiKey', issueStart);
    const issueBody = supabase.slice(issueStart, issueEnd);
    expect(issueBody).toContain('const hash = secretHash(key)');
    expect(issueBody).toContain('protectSecret(key)');
    expect(issueBody).toContain('api_key_hash');

    const lookupStart = supabase.indexOf('export async function getOwnerPidForApiKey');
    const lookupEnd = supabase.indexOf('export async function touchApiKeyLastUsed', lookupStart);
    const lookupBody = supabase.slice(lookupStart, lookupEnd);
    expect(lookupBody).toContain('where api_key_hash = $1 or api_key = $2');
    expect(lookupBody).toContain('secretHash(key)');
  });

  test('OAuth and platform tokens are protected before storage and revealed on read', () => {
    const tokensStart = supabase.indexOf('export async function upsertTokens');
    const tokensEnd = supabase.indexOf('export async function updateTokens', tokensStart);
    const tokensBody = supabase.slice(tokensStart, tokensEnd);
    expect(tokensBody).toContain('access_token: protectSecret(accessToken)');
    expect(tokensBody).toContain('refresh_token: protectSecret(refreshToken)');
    expect(tokensBody).toContain('revealSecret(data.access_token)');

    const platformStart = supabase.indexOf('export async function upsertPlatformTokens');
    const platformEnd = supabase.indexOf('export async function listPlatformTokenUsers', platformStart);
    const platformBody = supabase.slice(platformStart, platformEnd);
    expect(platformBody).toContain('protectSecret(accessToken)');
    expect(platformBody).toContain('revealSecret(row.access_token)');
  });
});
