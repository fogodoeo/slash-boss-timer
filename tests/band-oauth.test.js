const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const {
    BAND_AUTHORIZE_URL,
    SESSION_TYPE,
    createBandOAuth,
    signToken,
    verifyToken
} = require('../band-oauth');

const NOW = Date.parse('2026-07-17T10:00:00.000Z');
const SESSION_SECRET = 'test-session-secret-that-is-at-least-32-characters-long';
const ENV = {
    BAND_OAUTH_CLIENT_ID: '123456789',
    BAND_OAUTH_CLIENT_SECRET: 'client-secret-value',
    BAND_OAUTH_SESSION_SECRET: SESSION_SECRET,
    BAND_OAUTH_PUBLIC_URL: 'https://creo.example.com',
    BAND_OAUTH_REDIRECT_URI: 'https://creo.example.com/api/band-oauth/callback',
    BAND_OAUTH_RETURN_URL: 'https://survey.example.com/crewart-survey.html',
    BAND_OAUTH_TARGET_BAND_NO: '101005857',
    BAND_OAUTH_TARGET_BAND_URL: 'https://www.band.us/band/101005857/post'
};

class CapturedResponse {
    writeHead(status, headers = {}) {
        this.status = status;
        this.headers = headers;
    }

    end(body = '') {
        this.body = String(body || '');
    }
}

function request(method, body = '', headers = {}) {
    const req = Readable.from(body ? [body] : []);
    req.method = method;
    req.headers = headers;
    return req;
}

function jsonResponse(value, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return value; }
    };
}

test('signed session tokens reject tampering and expiry', () => {
    const payload = {
        typ: SESSION_TYPE,
        iat: Math.floor(NOW / 1000),
        exp: Math.floor(NOW / 1000) + 60,
        sub: 'band_test'
    };
    const token = signToken(payload, SESSION_SECRET);
    assert.deepEqual(verifyToken(token, SESSION_SECRET, SESSION_TYPE, NOW), payload);
    assert.throws(
        () => verifyToken(`${token.slice(0, -1)}x`, SESSION_SECRET, SESSION_TYPE, NOW),
        /invalid token/
    );
    assert.throws(
        () => verifyToken(token, SESSION_SECRET, SESSION_TYPE, NOW + 61_000),
        /expired token/
    );
});

test('OAuth start only accepts the configured survey return URL', async () => {
    const oauth = createBandOAuth({ env: ENV, now: () => NOW });

    const rejected = new CapturedResponse();
    await oauth.handle(
        request('GET'),
        rejected,
        new URL('https://creo.example.com/api/band-oauth/start?return_url=https://evil.example/')
    );
    assert.equal(rejected.status, 400);

    const accepted = new CapturedResponse();
    await oauth.handle(
        request('GET'),
        accepted,
        new URL('https://creo.example.com/api/band-oauth/start')
    );
    assert.equal(accepted.status, 302);
    const authorize = new URL(accepted.headers.Location);
    assert.equal(authorize.origin + authorize.pathname, BAND_AUTHORIZE_URL);
    assert.equal(authorize.searchParams.get('client_id'), ENV.BAND_OAUTH_CLIENT_ID);
    const callback = new URL(authorize.searchParams.get('redirect_uri'));
    assert.equal(callback.origin + callback.pathname, ENV.BAND_OAUTH_REDIRECT_URI);
    assert.ok(callback.searchParams.get('state'));
});

test('callback discards BAND access token and creates a verifiable pseudonymous session', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        const parsed = new URL(url);
        calls.push({ url: parsed, options });
        if (parsed.origin + parsed.pathname === 'https://auth.band.us/oauth2/token') {
            return jsonResponse({ access_token: 'raw-band-access-token', user_key: 'raw-user-key' });
        }
        if (parsed.origin + parsed.pathname === 'https://openapi.band.us/v2/profile') {
            assert.equal(parsed.searchParams.get('access_token'), 'raw-band-access-token');
            return jsonResponse({
                result_code: 1,
                result_data: {
                    user_key: 'raw-user-key',
                    name: '밴드 사용자',
                    profile_image_url: 'https://example.com/profile.jpg'
                }
            });
        }
        throw new Error(`unexpected request: ${parsed.origin}${parsed.pathname}`);
    };
    const oauth = createBandOAuth({
        env: ENV,
        fetchImpl,
        now: () => NOW,
        logger: { error() {} }
    });

    const start = new CapturedResponse();
    await oauth.handle(request('GET'), start, new URL('https://creo.example.com/api/band-oauth/start'));
    const authorize = new URL(start.headers.Location);
    const callback = new URL(authorize.searchParams.get('redirect_uri'));
    callback.searchParams.set('code', 'one-time-code');

    const callbackResponse = new CapturedResponse();
    await oauth.handle(request('GET'), callbackResponse, callback);
    assert.equal(callbackResponse.status, 302);
    assert.equal(calls.length, 2);
    assert.equal(callbackResponse.headers.Location.includes('raw-band-access-token'), false);
    assert.equal(callbackResponse.headers.Location.includes('raw-user-key'), false);

    const surveyRedirect = new URL(callbackResponse.headers.Location);
    const sessionToken = new URLSearchParams(surveyRedirect.hash.slice(1)).get('band_auth');
    assert.ok(sessionToken);

    const sessionResponse = new CapturedResponse();
    await oauth.handle(
        request('POST', JSON.stringify({ token: sessionToken }), {
            origin: 'https://survey.example.com',
            'content-type': 'application/json'
        }),
        sessionResponse,
        new URL('https://creo.example.com/api/band-oauth/session')
    );
    assert.equal(sessionResponse.status, 200);
    assert.equal(sessionResponse.headers['Access-Control-Allow-Origin'], 'https://survey.example.com');
    const session = JSON.parse(sessionResponse.body);
    assert.equal(session.authenticated, true);
    assert.equal(session.user.name, '밴드 사용자');
    assert.match(session.user.id, /^band_[A-Za-z0-9_-]{32}$/);
    assert.equal(session.user.id.includes('raw-user-key'), false);
    assert.equal(session.user.isTargetMember, null);
});

test('session endpoint rejects an unapproved browser origin', async () => {
    const oauth = createBandOAuth({ env: ENV, now: () => NOW });
    const response = new CapturedResponse();
    await oauth.handle(
        request('POST', '{}', { origin: 'https://evil.example.com' }),
        response,
        new URL('https://creo.example.com/api/band-oauth/session')
    );
    assert.equal(response.status, 403);
});

test('unconfigured OAuth cannot issue browser sessions', async () => {
    const oauth = createBandOAuth({ env: {}, now: () => NOW });
    const response = new CapturedResponse();
    await oauth.handle(
        request('POST', '{}'),
        response,
        new URL('https://creo.example.com/api/band-oauth/session')
    );
    assert.equal(response.status, 503);
    assert.equal(JSON.parse(response.body).authenticated, false);
});
