const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { createHash, randomUUID } = require('crypto');

const PORT = Number(process.env.PORT || process.env.SLASH_CHECK_PORT || process.argv[2] || 3101);
const HOST = process.env.SLASH_CHECK_HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'slash-check-app');
const IS_RENDER_RUNTIME = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
const DEFAULT_STATE_DIR = IS_RENDER_RUNTIME ? '/var/data' : ROOT;
const ROOT_STATE_FILE = path.join(ROOT, 'slash-check-state.json');
const STATE_DIR = process.env.SLASH_CHECK_STATE_DIR || process.env.STATE_DIR || DEFAULT_STATE_DIR;
const STATE_FILE = process.env.SLASH_CHECK_STATE_FILE || path.join(STATE_DIR, 'slash-check-state.json');
const GECKO_STATE_FILE = process.env.GECKO_STATE_FILE || path.join(STATE_DIR, 'gecko-state.json');
const TRAVEL_STATE_FILE = process.env.TRAVEL_STATE_FILE || path.join(STATE_DIR, 'travel-expenses.json');
const LEGACY_BOSS_STATE_FILE = path.join(ROOT, 'local-boss-state.json');
const PHOTO_PROOF_DIR = path.join(STATE_DIR, 'boss-photo-proofs');
const TRAVEL_RECEIPT_DIR = process.env.TRAVEL_RECEIPT_DIR || path.join(STATE_DIR, 'travel-receipts');
const BAND_MONITOR_STATUS_FILE = process.env.BAND_MONITOR_STATUS_FILE || path.join(STATE_DIR, 'band-monitor-runtime.json');

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
};

const defaultState = {
    members: ['N건강', 'N하늘', 'N라온', 'N도윤', 'N서아', 'N지호'],
    zones: [
        { id: 'zone-slash-01', name: '마녀의 탑', cooldownMin: 60, cooldownUntil: null, lastBy: null, lastAt: null, reservations: [] },
        { id: 'zone-slash-02', name: '숨겨진 실험실', cooldownMin: 60, cooldownUntil: null, lastBy: null, lastAt: null, reservations: [] },
        { id: 'zone-slash-03', name: '드라카스 화산', cooldownMin: 60, cooldownUntil: null, lastBy: null, lastAt: null, reservations: [] },
        { id: 'zone-slash-04', name: '무덤 3~4층', cooldownMin: 60, cooldownUntil: null, lastBy: null, lastAt: null, reservations: [] },
        { id: 'zone-slash-05', name: '죽대 4층', cooldownMin: 60, cooldownUntil: null, lastBy: null, lastAt: null, reservations: [] },
        { id: 'zone-slash-06', name: '얼어붙은 대지', cooldownMin: 60, cooldownUntil: null, lastBy: null, lastAt: null, reservations: [] },
        { id: 'zone-slash-07', name: '여인의 호수', cooldownMin: 60, cooldownUntil: null, lastBy: null, lastAt: null, reservations: [] },
        { id: 'zone-slash-08', name: '가르바나 지하수로 3층', cooldownMin: 60, cooldownUntil: null, lastBy: null, lastAt: null, reservations: [] },
        { id: 'zone-slash-09', name: '탐식의 균열', cooldownMin: 60, cooldownUntil: null, lastBy: null, lastAt: null, reservations: [] },
        { id: 'zone-slash-10', name: '부식의 균열', cooldownMin: 60, cooldownUntil: null, lastBy: null, lastAt: null, reservations: [] },
        { id: 'zone-slash-11', name: '그림자숲', cooldownMin: 60, cooldownUntil: null, lastBy: null, lastAt: null, reservations: [] }
    ],
    logs: [],
    bossCuts: {},
    bossCutRecords: [],
    bossCutLocks: {},
    bossAuditLogs: [],
    bosses: []
};

const DEFAULT_BOSS_EVENTS = [
    {
        이름: '거점 점령전',
        애칭: '거점',
        위치: '격주 점령전',
        타입: '이벤트',
        시간: '20:00',
        기준일: '2026-05-10',
        반복: '격주',
        간격일: 14,
        점수: 0
    }
];

let state = structuredClone(defaultState);
let geckoState = { geckos: [], logs: [], examplesSeededAt: null, updatedAt: null };
let travelState = { expenses: [], wallets: [], updatedAt: null };
const RESERVATION_GRACE_MS = 10 * 60 * 1000;
const CHECK_UNDO_GRACE_MS = 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BOSS_PARTICIPATION_WINDOW_MIN_INPUT = Number(process.env.BOSS_PARTICIPATION_WINDOW_MIN || process.env.BOSS_PARTICIPATION_MINUTES);
const BOSS_PARTICIPATION_WINDOW_MIN = Number.isFinite(BOSS_PARTICIPATION_WINDOW_MIN_INPUT)
    ? Math.max(10, Math.min(180, Math.round(BOSS_PARTICIPATION_WINDOW_MIN_INPUT)))
    : 60;
const BOSS_PARTICIPATION_WINDOW_MS = BOSS_PARTICIPATION_WINDOW_MIN * 60 * 1000;
const BOSS_CUT_LOCK_MS = 90 * 1000;
const MAX_BOSS_CUT_RECORDS = 300;
const MAX_BOSS_AUDIT_LOGS = 500;
const MAX_GECKO_AUDIT_LOGS = 500;
const PHOTO_PROOF_TTL_MS = 24 * 60 * 60 * 1000;
const PHOTO_PROOF_MAX_BYTES = 2.5 * 1024 * 1024;
const TRAVEL_RECEIPT_MAX_BYTES = 3.5 * 1024 * 1024;
const PHOTO_PROOF_MIME_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
};
const ADMIN_PASSWORD = process.env.SLASH_CHECK_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || (IS_RENDER_RUNTIME ? '' : '1234');
const ADMIN_PASSWORD_CONFIGURED = Boolean(ADMIN_PASSWORD);
const TRAVEL_PIN = normalizeAdminPasswordValue(process.env.TRAVEL_PIN || process.env.TRAVEL_PASSWORD || '1234');
let saveStateQueue = Promise.resolve();
let saveGeckoStateQueue = Promise.resolve();
let saveTravelStateQueue = Promise.resolve();

function send(res, status, body, type = 'text/plain; charset=utf-8') {
    res.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-store'
    });
    res.end(body);
}

function sendJson(res, status, data) {
    send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
}

function cleanText(value, max = 40) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderPublicMemoHtml() {
    return '';
    /*
    const content = '';
    return `<!doctype html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>개인 메모</title>
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            background: #f5f7fb;
            color: #101828;
            font-family: Pretendard, "Malgun Gothic", "Segoe UI", sans-serif;
            -webkit-font-smoothing: antialiased;
        }
        main {
            width: min(980px, 100%);
            min-height: 100vh;
            margin: 0 auto;
            padding: 10px;
        }
        pre {
            min-height: calc(100vh - 20px);
            margin: 0;
            border-radius: 8px;
            background: #ffffff;
            box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
            padding: 18px;
            font: inherit;
            font-size: 16px;
            font-weight: 650;
            line-height: 1.7;
            white-space: pre-wrap;
            word-break: break-word;
        }
        @media (max-width: 640px) {
            main { padding: 6px; }
            pre {
                min-height: calc(100vh - 12px);
                border-radius: 7px;
                padding: 14px;
                font-size: 15px;
            }
        }
    </style>
</head>
<body>
    <main><pre>${content}</pre></main>
</body>
</html>`;
}
*/
}

function parseMembers(value) {
    const raw = Array.isArray(value)
        ? value
        : String(value || '').split(/[\r\n,;]+/);

    const seen = new Set();
    const members = [];

    for (const item of raw) {
        const name = cleanText(item, 24);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        members.push(name);
    }

    return members;
}

function cleanDate(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const normalized = text.replace(/[./]/g, '-');
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const ms = Date.UTC(year, month - 1, day);
    const date = new Date(ms);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeGeckoStatus(value) {
    const text = cleanText(value, 16);
    const lower = text.toLowerCase();
    if (['breeding', 'pairing', 'paired', 'breed'].includes(lower)) return '브리딩';
    if (['sold', 'out', 'released'].includes(lower)) return '분양';
    if (['reserved', 'reserve'].includes(lower)) return '예약';
    if (['dead', 'deceased'].includes(lower)) return '폐사';
    if (['hold', 'holding', 'owned'].includes(lower)) return '보유';
    return ['보유', '분양', '예약', '폐사', '브리딩'].includes(text) ? text : '보유';
}

function normalizeGeckoSex(value) {
    const text = cleanText(value, 16);
    if (['수', '수컷', 'male', 'M'].includes(text)) return '수';
    if (['암', '암컷', 'female', 'F'].includes(text)) return '암';
    return '미구분';
}

function normalizeGeckoWeight(value) {
    const num = Number(String(value || '').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(num) || num <= 0) return null;
    return Math.round(num * 100) / 100;
}

function normalizeGeckoTags(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[\n,;#]+/);
    const seen = new Set();
    const tags = [];
    for (const item of source) {
        const tag = cleanText(item, 24);
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        tags.push(tag);
    }
    return tags.slice(0, 20);
}

function getGeckoValue(value, keys, fallback = '') {
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(value || {}, key) && value[key] !== undefined) {
            return value[key];
        }
    }
    return fallback;
}

function normalizeGeckoEggCount(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(99, Math.round(num)));
}

function normalizeGeckoEggStatus(value) {
    const text = cleanText(value, 16);
    const lower = text.toLowerCase();
    if (['incubating', 'incubation', 'stored'].includes(lower)) return '보관중';
    if (['watch', 'watching', 'observe', 'observing'].includes(lower)) return '관찰';
    if (['hatched', 'hatch'].includes(lower)) return '부화';
    if (['infertile', 'bad'].includes(lower)) return '무정란';
    if (['discarded', 'discard', 'trash'].includes(lower)) return '폐기';
    return ['보관중', '관찰', '부화', '무정란', '폐기'].includes(text) ? text : '보관중';
}

function normalizeGeckoEggRecords(value, existing = null, nowIso = new Date().toISOString()) {
    const explicit = getGeckoValue(value, ['eggRecords', '산란기록'], null);
    let records = Array.isArray(explicit)
        ? explicit
        : Array.isArray(existing?.eggRecords)
            ? existing.eggRecords
            : [];

    const hasLegacyEgg =
        getGeckoValue(value, ['layDate', '산란일'], '') ||
        getGeckoValue(value, ['eggCount', '산란수'], '') ||
        getGeckoValue(value, ['fertileCount', '유정란'], '') ||
        getGeckoValue(value, ['infertileCount', '무정란'], '') ||
        getGeckoValue(value, ['unknownCount', '미확인'], '') ||
        getGeckoValue(value, ['eggMemo', '산란메모'], '');

    if (!Array.isArray(explicit) && records.length === 0 && hasLegacyEgg) {
        records = [{
            layDate: getGeckoValue(value, ['layDate', '산란일'], ''),
            clutchCode: getGeckoValue(value, ['clutchCode', '클러치'], ''),
            fertileCount: getGeckoValue(value, ['fertileCount', '유정란'], 0),
            infertileCount: getGeckoValue(value, ['infertileCount', '무정란'], 0),
            unknownCount: getGeckoValue(value, ['eggCount', '산란수'], 0),
            eggStatus: getGeckoValue(value, ['eggStatus', '알상태'], '보관중'),
            hatchDate: getGeckoValue(value, ['hatchResultDate', '부화예정일', '부화일'], ''),
            memo: getGeckoValue(value, ['eggMemo', '산란메모'], '')
        }];
    }

    return records.map((record) => {
        const layDate = cleanDate(getGeckoValue(record, ['layDate', '산란일'], ''));
        const fertileCount = normalizeGeckoEggCount(getGeckoValue(record, ['fertileCount', '유정란'], 0));
        const infertileCount = normalizeGeckoEggCount(getGeckoValue(record, ['infertileCount', '무정란'], 0));
        const unknownCount = normalizeGeckoEggCount(getGeckoValue(record, ['unknownCount', '미확인', 'eggCount', '산란수'], 0));
        const hatchDate = cleanDate(getGeckoValue(record, ['hatchDate', 'hatchResultDate', '부화예정일', '부화일'], ''));
        return {
            id: cleanText(record?.id, 80) || randomUUID(),
            layDate,
            clutchCode: cleanText(getGeckoValue(record, ['clutchCode', '클러치'], ''), 40),
            mateNumber: cleanText(getGeckoValue(record, ['mateNumber', 'pairedWithNumber', 'pairNumber', '수컷', '페어'], ''), 32),
            incubationLocation: cleanText(getGeckoValue(record, ['incubationLocation', 'incubator', '보관위치', '인큐베이터'], ''), 80),
            fertileCount,
            infertileCount,
            unknownCount,
            eggStatus: normalizeGeckoEggStatus(getGeckoValue(record, ['eggStatus', 'status', '알상태'], '보관중')),
            hatchDate,
            memo: cleanText(getGeckoValue(record, ['memo', '메모'], ''), 400),
            actor: cleanText(getGeckoValue(record, ['actor', '작성자', '수정자'], ''), 60),
            createdAt: cleanText(record?.createdAt, 40) || nowIso,
            updatedAt: cleanText(record?.updatedAt, 40) || nowIso
        };
    }).filter((record) => (
        record.layDate ||
        record.clutchCode ||
        record.fertileCount ||
        record.infertileCount ||
        record.unknownCount ||
        record.memo
    )).sort((a, b) => String(b.layDate || '').localeCompare(String(a.layDate || '')));
}

function normalizeGeckoActivityRecords(value, existing = null, nowIso = new Date().toISOString()) {
    const explicit = getGeckoValue(value, ['activityRecords', '작업기록'], null);
    const records = Array.isArray(explicit)
        ? explicit
        : Array.isArray(existing?.activityRecords)
            ? existing.activityRecords
            : [];

    return records.map((record) => {
        const type = cleanText(getGeckoValue(record, ['type', '작업'], ''), 24);
        const date = cleanDate(getGeckoValue(record, ['date', '작업일'], '')) || cleanDate(record?.createdAt) || cleanDate(nowIso);
        return {
            id: cleanText(record?.id, 80) || randomUUID(),
            type,
            date,
            status: cleanText(getGeckoValue(record, ['status', '상태'], ''), 40),
            weight: normalizeGeckoWeight(getGeckoValue(record, ['weight', '무게'], '')),
            location: cleanText(getGeckoValue(record, ['location', '위치'], ''), 80),
            memo: cleanText(getGeckoValue(record, ['memo', '메모'], ''), 500),
            actor: cleanText(getGeckoValue(record, ['actor', '작성자', '수정자'], ''), 60),
            createdAt: cleanText(record?.createdAt, 40) || nowIso,
            updatedAt: cleanText(record?.updatedAt, 40) || nowIso
        };
    }).filter((record) => record.type || record.status || record.weight || record.memo)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function nextGeckoNumber() {
    let max = 0;
    for (const gecko of geckoState.geckos || []) {
        const match = String(gecko.number || '').match(/(\d+)$/);
        if (!match) continue;
        max = Math.max(max, Number(match[1]));
    }
    return `CG-${String(max + 1).padStart(4, '0')}`;
}

function normalizeGecko(value, existing = null) {
    const nowIso = new Date().toISOString();
    const number = cleanText(getGeckoValue(value, ['number', '넘버', '넘버링'], existing?.number || nextGeckoNumber()), 32);
    if (!number) return null;

    return {
        id: cleanText(existing?.id || value?.id, 80) || randomUUID(),
        number,
        name: cleanText(getGeckoValue(value, ['name', '이름'], existing?.name || ''), 80),
        sex: normalizeGeckoSex(getGeckoValue(value, ['sex', '성별'], existing?.sex || '미확인')),
        status: normalizeGeckoStatus(getGeckoValue(value, ['status', '상태'], existing?.status || '보유')),
        morph: cleanText(getGeckoValue(value, ['morph', '모프'], existing?.morph || ''), 80),
        location: cleanText(getGeckoValue(value, ['location', '위치'], existing?.location || ''), 80),
        hatchDate: cleanDate(getGeckoValue(value, ['hatchDate', 'birthDate', '출생일', '부화일'], existing?.hatchDate || '')),
        acquiredDate: cleanDate(getGeckoValue(value, ['acquiredDate', '입양일', '입고일'], existing?.acquiredDate || '')),
        fatherNumber: cleanText(getGeckoValue(value, ['fatherNumber', 'father', '부'], existing?.fatherNumber || ''), 32),
        motherNumber: cleanText(getGeckoValue(value, ['motherNumber', 'mother', '모'], existing?.motherNumber || ''), 32),
        pairedWithNumber: cleanText(getGeckoValue(value, ['pairedWithNumber', 'pairNumber', 'mateNumber', '페어', '수컷'], existing?.pairedWithNumber || ''), 32),
        pairingDate: cleanDate(getGeckoValue(value, ['pairingDate', 'pairedDate', '합사일', '페어일'], existing?.pairingDate || '')),
        breeder: cleanText(getGeckoValue(value, ['breeder', 'source', '브리더', '출처'], existing?.breeder || ''), 80),
        weight: normalizeGeckoWeight(getGeckoValue(value, ['weight', '무게'], existing?.weight || '')),
        weightDate: cleanDate(getGeckoValue(value, ['weightDate', '측정일'], existing?.weightDate || '')),
        clutchCode: cleanText(getGeckoValue(value, ['clutchCode', '클러치'], existing?.clutchCode || ''), 40),
        layDate: cleanDate(getGeckoValue(value, ['layDate', '산란일'], existing?.layDate || '')),
        eggCount: Math.max(0, Math.min(99, Math.round(Number(getGeckoValue(value, ['eggCount', '산란수'], existing?.eggCount || 0)) || 0))),
        hatchResultDate: cleanDate(getGeckoValue(value, ['hatchResultDate', '부화예정일', '부화일'], existing?.hatchResultDate || '')),
        eggMemo: cleanText(getGeckoValue(value, ['eggMemo', '산란메모'], existing?.eggMemo || ''), 300),
        memo: cleanText(getGeckoValue(value, ['memo', '메모'], existing?.memo || ''), 1200),
        tags: normalizeGeckoTags(getGeckoValue(value, ['tags', '태그'], existing?.tags || [])),
        eggRecords: normalizeGeckoEggRecords(value, existing, nowIso),
        activityRecords: normalizeGeckoActivityRecords(value, existing, nowIso),
        createdBy: cleanText(getGeckoValue(value, ['createdBy', '등록자'], existing?.createdBy || ''), 60),
        updatedBy: cleanText(getGeckoValue(value, ['updatedBy', '수정자'], existing?.updatedBy || ''), 60),
        createdAt: existing?.createdAt || nowIso,
        updatedAt: existing?.updatedAt || nowIso
    };
}

function geckoCompare(a, b) {
    return String(a.number || '').localeCompare(String(b.number || ''), 'ko', { numeric: true })
        || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
}

function geckoActorFrom(value) {
    return cleanText(value?.actor || value?.userName || value?.nickname || value?.updatedBy || value?.createdBy, 60) || '이름없음';
}

function normalizeGeckoLogs(value) {
    const items = Array.isArray(value) ? value : [];
    return items.map((log) => ({
        id: cleanText(log?.id, 80) || randomUUID(),
        at: cleanText(log?.at, 40) || new Date().toISOString(),
        actor: cleanText(log?.actor, 60) || '이름없음',
        action: cleanText(log?.action, 40) || '변경',
        target: cleanText(log?.target, 80),
        targetId: cleanText(log?.targetId, 80),
        detail: cleanText(log?.detail, 240)
    })).filter((log) => log.action || log.target || log.detail)
        .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
        .slice(0, MAX_GECKO_AUDIT_LOGS);
}

function addGeckoLog({ actor, action, target, targetId, detail }) {
    geckoState.logs = normalizeGeckoLogs([
        {
            id: randomUUID(),
            at: new Date().toISOString(),
            actor: actor || '이름없음',
            action,
            target,
            targetId,
            detail
        },
        ...(geckoState.logs || [])
    ]);
}

function exampleGeckoItems(nowIso = new Date().toISOString()) {
    const today = cleanDate(nowIso.slice(0, 10));
    const babies = Array.from({ length: 12 }, (_, index) => {
        const num = index + 1;
        const padded = String(num).padStart(3, '0');
        const pairIndex = Math.floor(index / 4) + 1;
        return {
            number: `EX-B-${padded}`,
            name: `베이비${String(num).padStart(2, '0')}`,
            sex: '미구분',
            location: `베이비 랙 ${Math.floor(index / 6) + 1}`,
            morph: ['미확인', '할리퀸', '릴리 가능', '달마시안'][index % 4],
            motherNumber: `EX-F-${String(pairIndex).padStart(3, '0')}`,
            fatherNumber: `EX-M-${String(pairIndex).padStart(3, '0')}`,
            memo: index < 2 ? '해칭 개체 연속 등록 예시' : ''
        };
    });

    return [
        {
            number: 'EX-F-001',
            name: '달콩',
            sex: '암',
            location: '브리딩 랙 A-1',
            morph: '릴리화이트',
            pairedWithNumber: 'EX-M-001',
            pairingDate: today,
            memo: '예시 암컷입니다. 실제 사용 전 수정하거나 삭제해도 됩니다.',
            eggRecords: [
                {
                    layDate: today,
                    fertileCount: 2,
                    infertileCount: 0,
                    unknownCount: 0,
                    eggStatus: '보관중',
                    incubationLocation: '인큐 1',
                    mateNumber: 'EX-M-001',
                    memo: '유정 2개 예시',
                    actor: '예시',
                    createdAt: nowIso,
                    updatedAt: nowIso
                }
            ],
            activityRecords: [
                {
                    type: '상태메모',
                    date: today,
                    status: '안먹음',
                    memo: '예시 메모입니다. 클릭해서 수정하거나 삭제할 수 있습니다.',
                    actor: '예시',
                    createdAt: nowIso,
                    updatedAt: nowIso
                }
            ]
        },
        {
            number: 'EX-F-002',
            name: '루나',
            sex: '암',
            location: '브리딩 랙 A-2',
            morph: '트라이컬러',
            pairedWithNumber: 'EX-M-002',
            pairingDate: today,
            memo: '산란 기록 입력 예시',
            eggRecords: [
                {
                    layDate: today,
                    fertileCount: 1,
                    infertileCount: 1,
                    unknownCount: 0,
                    eggStatus: '관찰',
                    incubationLocation: '인큐 2',
                    mateNumber: 'EX-M-002',
                    memo: '유1 무1 예시',
                    actor: '예시',
                    createdAt: nowIso,
                    updatedAt: nowIso
                }
            ]
        },
        {
            number: 'EX-F-003',
            name: '라떼',
            sex: '암',
            location: '브리딩 랙 B-1',
            morph: '익스트림 할리퀸',
            pairedWithNumber: 'EX-M-003',
            memo: '페어 준비 예시'
        },
        {
            number: 'EX-F-004',
            name: '복숭',
            sex: '암',
            location: '브리딩 랙 B-2',
            morph: '릴리화이트',
            pairedWithNumber: 'EX-M-004',
            memo: '브리딩 암컷 예시'
        },
        {
            number: 'EX-M-001',
            name: '모카',
            sex: '수',
            location: '브리딩 랙 A-1',
            morph: '할리퀸',
            memo: '페어 수컷 예시'
        },
        {
            number: 'EX-M-002',
            name: '밤톨',
            sex: '수',
            location: '브리딩 랙 A-2',
            morph: '핀스트라이프',
            memo: '페어 수컷 예시'
        },
        {
            number: 'EX-M-003',
            name: '쿠키',
            sex: '수',
            location: '브리딩 랙 B-1',
            morph: '달마시안',
            memo: '페어 수컷 예시'
        },
        {
            number: 'EX-M-004',
            name: '흑당',
            sex: '수',
            location: '브리딩 랙 B-2',
            morph: '다크 할리퀸',
            memo: '페어 수컷 예시'
        },
        ...babies
    ].map((item) => ({
        createdBy: '예시',
        updatedBy: '예시',
        ...item
    }));
}

function createExampleGeckoState() {
    const nowIso = new Date().toISOString();
    const examples = exampleGeckoItems(nowIso);

    return {
        geckos: examples.map((item) => normalizeGecko(item, item)).filter(Boolean),
        logs: normalizeGeckoLogs([
            {
                at: nowIso,
                actor: '예시',
                action: '예시 데이터 생성',
                target: 'CrestBase',
                detail: '처음 화면 확인용 예시 20건을 넣었습니다.'
            }
        ]),
        examplesSeededAt: nowIso,
        updatedAt: nowIso
    };
}

function addMissingGeckoExamples() {
    const nowIso = new Date().toISOString();
    const existingNumbers = new Set((geckoState.geckos || []).map((gecko) => gecko.number));
    let added = 0;
    for (const item of exampleGeckoItems(nowIso)) {
        if (existingNumbers.has(item.number)) continue;
        const gecko = normalizeGecko(item, item);
        if (!gecko) continue;
        geckoState.geckos.push(gecko);
        existingNumbers.add(gecko.number);
        added += 1;
    }
    geckoState.examplesSeededAt = geckoState.examplesSeededAt || nowIso;
    if (added > 0) {
        addGeckoLog({
            actor: '예시',
            action: '예시 데이터 추가',
            target: 'CrestBase',
            detail: `화면 확인용 예시 ${added}건을 추가했습니다.`
        });
    }
    return added;
}

function publicGeckoState() {
    return {
        now: new Date().toISOString(),
        updatedAt: geckoState.updatedAt || null,
        count: geckoState.geckos.length,
        geckos: [...geckoState.geckos].sort(geckoCompare),
        logs: normalizeGeckoLogs(geckoState.logs).slice(0, 200)
    };
}

function normalizeCooldown(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.max(1, Math.min(1440, Math.round(num)));
}

function normalizeBossType(value) {
    const type = String(value || '').trim();
    if (type === '고정' || type === '이벤트') return type;
    return '시간';
}

function normalizeBossCooldown(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.max(0.01, Math.min(240, Math.round(num * 100000) / 100000));
}

function normalizeBossScheduleTime(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{1,2}):?(\d{2})$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeBossDays(value) {
    const source = Array.isArray(value)
        ? value
        : String(value || '').split(/[\s,;/]+/);
    const valid = ['월', '화', '수', '목', '금', '토', '일'];
    const seen = new Set();
    const days = [];

    for (const item of source) {
        const day = String(item || '').trim().slice(0, 1);
        if (!valid.includes(day) || seen.has(day)) continue;
        seen.add(day);
        days.push(day);
    }

    return days;
}

function normalizeBossScore(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(999, Math.round(num)));
}

function normalizeBossNextSpawnAt(value) {
    const ms = new Date(value || '').getTime();
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString();
}

function normalizeBossEventStartDate(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const ms = Date.UTC(year, month - 1, day);
    const check = new Date(ms);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeBossIntervalDays(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 14;
    return Math.max(1, Math.min(365, Math.round(num)));
}

function normalizeBoss(value) {
    const name = cleanText(value?.이름 || value?.name, 40);
    if (!name) return null;

    const type = normalizeBossType(value?.타입 || value?.type);
    const boss = {
        이름: name,
        애칭: cleanText(value?.애칭 || value?.alias, 40),
        위치: cleanText(value?.위치 || value?.location, 40),
        타입: type,
        점수: normalizeBossScore(value?.점수 ?? value?.score)
    };

    if (type === '고정') {
        const time = normalizeBossScheduleTime(value?.시간 || value?.time);
        const days = normalizeBossDays(value?.요일 || value?.days);
        if (!time || days.length === 0) return null;
        boss.시간 = time;
        boss.요일 = days;
        return boss;
    }

    if (type === '이벤트') {
        const time = normalizeBossScheduleTime(value?.시간 || value?.time);
        const startDate = normalizeBossEventStartDate(value?.기준일 || value?.startDate || value?.baseDate);
        if (!time || !startDate) return null;
        boss.시간 = time;
        boss.기준일 = startDate;
        boss.반복 = '격주';
        boss.간격일 = normalizeBossIntervalDays(value?.간격일 ?? value?.intervalDays ?? 14);
        return boss;
    }

    const cooldown = normalizeBossCooldown(value?.쿨타임 ?? value?.cooldownHours);
    if (!cooldown) return null;
    boss.쿨타임 = cooldown;

    const nextSpawnAt = normalizeBossNextSpawnAt(value?.nextSpawnAt || value?.다음젠 || value?.nextSpawn);
    if (nextSpawnAt) boss.nextSpawnAt = nextSpawnAt;
    const nextSpawnUpdatedAt = normalizeBossNextSpawnAt(value?.nextSpawnUpdatedAt || value?.다음젠수정시각);
    if (nextSpawnUpdatedAt) boss.nextSpawnUpdatedAt = nextSpawnUpdatedAt;
    return boss;
}

function normalizeBosses(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const bosses = [];

    for (const item of value) {
        const boss = normalizeBoss(item);
        if (!boss || seen.has(boss.이름)) continue;
        seen.add(boss.이름);
        bosses.push(boss);
    }

    return bosses;
}

function ensureDefaultBossEvents(bosses) {
    const next = Array.isArray(bosses) ? [...bosses] : [];
    const names = new Set(next.map((boss) => boss.이름));
    for (const event of DEFAULT_BOSS_EVENTS) {
        if (names.has(event.이름)) continue;
        const normalized = normalizeBoss(event);
        if (!normalized) continue;
        next.push(normalized);
        names.add(normalized.이름);
    }
    return next;
}

function normalizeBossCutTime(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 4);
    if (!/^\d{4}$/.test(digits)) return null;

    const hour = Number(digits.slice(0, 2));
    const minute = Number(digits.slice(2, 4));
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return digits;
}

function kstDate(ms) {
    return new Date(ms + KST_OFFSET_MS);
}

function startOfKstDay(ms = Date.now()) {
    const date = kstDate(ms);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - KST_OFFSET_MS;
}

function isoFromCommandTime(timeValue, now = Date.now()) {
    const hour = Number(timeValue.slice(0, 2));
    const minute = Number(timeValue.slice(2, 4));
    const todayStart = startOfKstDay(now);
    let target = todayStart + hour * 60 * 60 * 1000 + minute * 60 * 1000;
    if (target > now + 10 * 60 * 1000) target -= DAY_MS;
    return new Date(target).toISOString();
}

function formatCommandTimeFromIso(iso) {
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) return null;
    const date = kstDate(ms);
    return `${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function isoFromBossCutInput(cutAt, timeValue) {
    const cutMs = new Date(cutAt || '').getTime();
    if (Number.isFinite(cutMs)) return new Date(cutMs).toISOString();
    if (timeValue) return isoFromCommandTime(timeValue);
    return null;
}

function fixedBossNextSpawnAt(boss, fromMs = Date.now()) {
    if (!Array.isArray(boss?.요일) || !boss?.시간) return null;

    const [hour, minute] = String(boss.시간).split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const start = startOfKstDay(fromMs);

    for (let offset = 0; offset <= 14; offset += 1) {
        const dayStart = start + offset * DAY_MS;
        const dayName = dayNames[kstDate(dayStart).getUTCDay()];
        if (!boss.요일.includes(dayName)) continue;

        const candidate = dayStart + hour * 60 * 60 * 1000 + minute * 60 * 1000;
        if (candidate > fromMs) return new Date(candidate).toISOString();
    }

    return null;
}

function eventBaseSpawnMs(boss) {
    const date = String(boss?.기준일 || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const [hour, minute] = String(boss?.시간 || '').split(':').map(Number);
    if (!date || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    const year = Number(date[1]);
    const month = Number(date[2]);
    const day = Number(date[3]);
    return Date.UTC(year, month - 1, day, hour, minute) - KST_OFFSET_MS;
}

function eventBossNextSpawnAt(boss, fromMs = Date.now()) {
    const baseMs = eventBaseSpawnMs(boss);
    if (!Number.isFinite(baseMs)) return null;
    const intervalMs = normalizeBossIntervalDays(boss?.간격일 || 14) * DAY_MS;
    let candidate = baseMs;
    if (candidate <= fromMs) {
        candidate += Math.ceil((fromMs - candidate + 1) / intervalMs) * intervalMs;
    }
    return new Date(candidate).toISOString();
}

function calcBossNextSpawnAt(boss, cutAtIso) {
    const cutMs = new Date(cutAtIso).getTime();
    if (!Number.isFinite(cutMs)) return null;

    if (boss?.타입 === '시간') {
        const cooldownHours = Number(boss.쿨타임);
        if (!Number.isFinite(cooldownHours)) return null;
        return new Date(cutMs + cooldownHours * 60 * 60 * 1000).toISOString();
    }

    if (boss?.타입 === '고정') return fixedBossNextSpawnAt(boss, cutMs);
    if (boss?.타입 === '이벤트') return eventBossNextSpawnAt(boss, cutMs);
    return null;
}

function isMayElevenMistimedMissCut(record) {
    if (!record || record.status === 'canceled' || !record.timeUncertain || record.timeValue !== '1349') return false;
    const cutMs = new Date(record.cutAt || '').getTime();
    if (!Number.isFinite(cutMs)) return false;
    const kst = kstDate(cutMs);
    return kst.getUTCFullYear() === 2026
        && kst.getUTCMonth() === 4
        && kst.getUTCDate() === 11
        && kst.getUTCHours() === 13
        && kst.getUTCMinutes() === 49;
}

function repairMayElevenMistimedMissCuts(records, bosses) {
    let changed = false;
    const activeByBoss = new Map();

    for (const record of records) {
        if (record.status === 'canceled') continue;
        if (!activeByBoss.has(record.bossName)) activeByBoss.set(record.bossName, []);
        activeByBoss.get(record.bossName).push(record);
    }

    for (const list of activeByBoss.values()) {
        list.sort((a, b) => new Date(a.cutAt) - new Date(b.cutAt));
    }

    for (const record of records) {
        if (!isMayElevenMistimedMissCut(record)) continue;
        const boss = bosses.find((item) => item.이름 === record.bossName || item.애칭 === record.bossName);
        if (!boss || boss.타입 !== '시간') continue;

        const recordCutMs = new Date(record.cutAt).getTime();
        const previous = (activeByBoss.get(record.bossName) || [])
            .filter((item) => item.id !== record.id && new Date(item.cutAt).getTime() < recordCutMs)
            .sort((a, b) => new Date(b.cutAt) - new Date(a.cutAt))[0];
        const spawnMs = new Date(previous?.nextSpawnAt || boss.nextSpawnAt || '').getTime();
        if (!Number.isFinite(spawnMs)) continue;

        const correctedCutAt = new Date(spawnMs + 60 * 1000).toISOString();
        const correctedTimeValue = formatCommandTimeFromIso(correctedCutAt);
        const correctedNextSpawnAt = calcBossNextSpawnAt(boss, correctedCutAt);
        if (!correctedTimeValue || !correctedNextSpawnAt || record.cutAt === correctedCutAt) continue;

        record.cutAt = correctedCutAt;
        record.timeValue = correctedTimeValue;
        record.nextSpawnAt = correctedNextSpawnAt;
        record.updatedAt = new Date().toISOString();
        record.editedBy = 'system';
        record.timeUncertain = true;
        changed = true;
    }

    return changed;
}

function hashParticipantPassword(value) {
    const password = String(value || '').trim();
    if (!password) return '';
    return createHash('sha256').update(password).digest('hex');
}

function normalizeBossParticipant(value) {
    const memberName = cleanText(value?.memberName, 24);
    if (!memberName) return null;

    return {
        memberName,
        confirmedAt: value?.confirmedAt || value?.addedAt || new Date().toISOString(),
        method: cleanText(value?.method, 16) || 'password',
        addedBy: cleanText(value?.addedBy, 24) || undefined
    };
}

function normalizeParticipantProofStatus(value) {
    const status = cleanText(value, 16);
    return ['pending', 'approved', 'rejected', 'expired'].includes(status) ? status : 'pending';
}

function normalizeBossParticipantProof(value) {
    if (!value || typeof value !== 'object') return null;
    const memberName = cleanText(value.memberName, 24);
    if (!memberName) return null;

    const uploadedMs = new Date(value.uploadedAt || value.createdAt || Date.now()).getTime();
    const expiresMs = new Date(value.expiresAt || (Number.isFinite(uploadedMs) ? uploadedMs + PHOTO_PROOF_TTL_MS : Date.now() + PHOTO_PROOF_TTL_MS)).getTime();
    const status = normalizeParticipantProofStatus(value.status);
    const mimeType = PHOTO_PROOF_MIME_EXT[value.mimeType] ? value.mimeType : 'image/jpeg';

    return {
        id: cleanText(value.id, 80) || randomUUID(),
        memberName,
        uploadedAt: new Date(Number.isFinite(uploadedMs) ? uploadedMs : Date.now()).toISOString(),
        expiresAt: new Date(Number.isFinite(expiresMs) ? expiresMs : Date.now() + PHOTO_PROOF_TTL_MS).toISOString(),
        status,
        fileName: cleanText(value.fileName, 120),
        originalName: cleanText(value.originalName, 120),
        mimeType,
        size: Math.max(0, Math.round(Number(value.size) || 0)),
        reviewedAt: value.reviewedAt || null,
        reviewedBy: cleanText(value.reviewedBy, 24)
    };
}

function publicParticipantProof(proof) {
    if (!proof) return null;
    const expired = new Date(proof.expiresAt || '').getTime() <= Date.now();
    const hasPhoto = proof.fileName && !expired && proof.status !== 'expired';
    return {
        id: proof.id,
        memberName: proof.memberName,
        uploadedAt: proof.uploadedAt,
        expiresAt: proof.expiresAt,
        status: expired && proof.status === 'pending' ? 'expired' : proof.status,
        originalName: proof.originalName || '',
        mimeType: proof.mimeType || '',
        size: proof.size || 0,
        reviewedAt: proof.reviewedAt || null,
        reviewedBy: proof.reviewedBy || '',
        photoUrl: hasPhoto ? `/api/boss-cuts/participant-photo?id=${encodeURIComponent(proof.id)}` : ''
    };
}

function publicParticipantProofs(value) {
    return Array.isArray(value) ? value.map(publicParticipantProof).filter(Boolean) : [];
}

function normalizeBossRecordStatus(value) {
    return cleanText(value, 16) === 'canceled' ? 'canceled' : 'active';
}

function normalizeBossCutRecord(value) {
    if (!value || typeof value !== 'object') return null;

    const bossName = cleanText(value.bossName || value.name, 40);
    const timeValue = normalizeBossCutTime(value.timeValue || formatCommandTimeFromIso(value.cutAt));
    const cutAt = value.cutAt || value.updatedAt || null;
    const cutMs = cutAt ? new Date(cutAt).getTime() : NaN;
    if (!bossName || !timeValue || !Number.isFinite(cutMs)) return null;

    return {
        id: cleanText(value.id, 80) || randomUUID(),
        bossName,
        bossAlias: cleanText(value.bossAlias, 40),
        bossType: cleanText(value.bossType, 16),
        location: cleanText(value.location, 40),
        timeValue,
        cutAt: new Date(cutMs).toISOString(),
        nextSpawnAt: value.nextSpawnAt || null,
        reporterName: cleanText(value.reporterName, 24),
        updatedAt: value.updatedAt || new Date(cutMs).toISOString(),
        status: normalizeBossRecordStatus(value.status),
        canceledAt: value.canceledAt || null,
        canceledBy: cleanText(value.canceledBy, 24),
        cancelReason: cleanText(value.cancelReason, 80),
        editedBy: cleanText(value.editedBy, 24),
        timeUncertain: cleanText(value.bossType, 16) !== '고정' && Boolean(value.timeUncertain),
        requiresParticipation: Boolean(value.requiresParticipation),
        participantPasswordHash: cleanText(value.participantPasswordHash, 128),
        participationOpenUntil: value.participationOpenUntil || null,
        temporary: Boolean(value.temporary) || cleanText(value.bossType, 16) === '임시',
        participants: Array.isArray(value.participants)
            ? value.participants.map(normalizeBossParticipant).filter(Boolean)
            : [],
        participantProofs: Array.isArray(value.participantProofs)
            ? value.participantProofs.map(normalizeBossParticipantProof).filter(Boolean)
            : []
    };
}

function normalizeBossCutRecords(value) {
    if (!Array.isArray(value)) return [];
    return value.map(normalizeBossCutRecord).filter(Boolean).slice(0, MAX_BOSS_CUT_RECORDS);
}

function normalizeBossCutLock(value) {
    if (!value || typeof value !== 'object') return null;
    const bossName = cleanText(value.bossName, 40);
    const memberName = cleanText(value.memberName, 24);
    const expiresMs = new Date(value.expiresAt).getTime();
    if (!bossName || !memberName || !Number.isFinite(expiresMs)) return null;

    return {
        bossName,
        memberName,
        lockedAt: value.lockedAt || new Date().toISOString(),
        expiresAt: new Date(expiresMs).toISOString(),
        spawnAt: value.spawnAt || null
    };
}

function normalizeBossCutLocks(value) {
    const next = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return next;
    for (const [bossName, lock] of Object.entries(value)) {
        const normalized = normalizeBossCutLock({ ...lock, bossName: lock?.bossName || bossName });
        if (normalized) next[normalized.bossName] = normalized;
    }
    return next;
}

function normalizeBossAuditLog(value) {
    if (!value || typeof value !== 'object') return null;
    const action = cleanText(value.action, 32);
    const bossName = cleanText(value.bossName, 40);
    const createdMs = new Date(value.createdAt).getTime();
    if (!action || !bossName || !Number.isFinite(createdMs)) return null;

    return {
        id: cleanText(value.id, 80) || randomUUID(),
        action,
        bossName,
        recordId: cleanText(value.recordId, 80),
        actorName: cleanText(value.actorName, 24),
        createdAt: new Date(createdMs).toISOString(),
        detail: value.detail && typeof value.detail === 'object' && !Array.isArray(value.detail) ? value.detail : {}
    };
}

function normalizeBossAuditLogs(value) {
    if (!Array.isArray(value)) return [];
    return value.map(normalizeBossAuditLog).filter(Boolean).slice(0, MAX_BOSS_AUDIT_LOGS);
}

function normalizeBossCuts(value) {
    const next = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return next;

    for (const [bossName, cut] of Object.entries(value)) {
        const name = cleanText(bossName, 40);
        const timeValue = normalizeBossCutTime(cut?.timeValue);
        if (!name || !timeValue) continue;

        next[name] = {
            recordId: cleanText(cut?.recordId, 80),
            timeValue,
            cutAt: cut?.cutAt || null,
            nextSpawnAt: cut?.nextSpawnAt || null,
            reporterName: cleanText(cut?.reporterName, 24),
            updatedAt: cut?.updatedAt || new Date().toISOString(),
            timeUncertain: Boolean(cut?.timeUncertain),
            requiresParticipation: Boolean(cut?.requiresParticipation),
            participantPasswordHash: cleanText(cut?.participantPasswordHash, 128),
            participationOpenUntil: cut?.participationOpenUntil || null,
            participants: Array.isArray(cut?.participants)
                ? cut.participants.map(normalizeBossParticipant).filter(Boolean)
                : [],
            participantProofs: Array.isArray(cut?.participantProofs)
                ? cut.participantProofs.map(normalizeBossParticipantProof).filter(Boolean)
                : []
        };
    }

    return next;
}

function publicBossCut(value) {
    if (!value) return null;
    return {
        recordId: value.recordId || '',
        timeValue: value.timeValue,
        cutAt: value.cutAt || null,
        nextSpawnAt: value.nextSpawnAt || null,
        reporterName: value.reporterName || '',
        updatedAt: value.updatedAt || null,
        timeUncertain: Boolean(value.timeUncertain),
        requiresParticipation: Boolean(value.requiresParticipation),
        hasParticipantPassword: Boolean(value.participantPasswordHash),
        participationOpenUntil: value.participationOpenUntil || null,
        participants: Array.isArray(value.participants) ? value.participants : [],
        participantProofs: publicParticipantProofs(value.participantProofs)
    };
}

function publicBossCuts() {
    const next = {};
    for (const [bossName, cut] of Object.entries(state.bossCuts || {})) {
        const safe = publicBossCut(cut);
        if (safe) next[bossName] = safe;
    }
    return next;
}

function publicBossCutRecords() {
    return (state.bossCutRecords || []).map((record) => ({
        id: record.id,
        bossName: record.bossName,
        bossAlias: record.bossAlias || '',
        bossType: record.bossType || '',
        location: record.location || '',
        timeValue: record.timeValue,
        cutAt: record.cutAt,
        nextSpawnAt: record.nextSpawnAt || null,
        reporterName: record.reporterName || '',
        updatedAt: record.updatedAt || null,
        status: record.status || 'active',
        canceledAt: record.canceledAt || null,
        canceledBy: record.canceledBy || '',
        cancelReason: record.cancelReason || '',
        editedBy: record.editedBy || '',
        timeUncertain: Boolean(record.timeUncertain),
        requiresParticipation: Boolean(record.requiresParticipation),
        hasParticipantPassword: Boolean(record.participantPasswordHash),
        participationOpenUntil: record.participationOpenUntil || null,
        temporary: Boolean(record.temporary) || record.bossType === '임시',
        participants: Array.isArray(record.participants) ? record.participants : [],
        participantProofs: publicParticipantProofs(record.participantProofs)
    }));
}

function publicBossCutLocks() {
    cleanupExpiredBossCutLocks();
    const next = {};
    for (const [bossName, lock] of Object.entries(state.bossCutLocks || {})) {
        next[bossName] = {
            bossName: lock.bossName,
            memberName: lock.memberName,
            lockedAt: lock.lockedAt,
            expiresAt: lock.expiresAt,
            spawnAt: lock.spawnAt || null
        };
    }
    return next;
}

function publicBossAuditLogs() {
    return (state.bossAuditLogs || []).slice(0, MAX_BOSS_AUDIT_LOGS);
}

function bossCutStateFromRecord(record) {
    return {
        recordId: record.id,
        timeValue: record.timeValue,
        cutAt: record.cutAt,
        nextSpawnAt: record.nextSpawnAt || null,
        reporterName: record.reporterName || '',
        updatedAt: record.updatedAt || null,
        status: record.status || 'active',
        timeUncertain: Boolean(record.timeUncertain),
        requiresParticipation: Boolean(record.requiresParticipation),
        participantPasswordHash: record.participantPasswordHash || '',
        participationOpenUntil: record.participationOpenUntil || null,
        participants: Array.isArray(record.participants) ? record.participants : [],
        participantProofs: Array.isArray(record.participantProofs) ? record.participantProofs : []
    };
}

function timestampMs(value) {
    const ms = new Date(value || '').getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function compareBossCutRecordsByCutAtDesc(a, b) {
    const cutDiff = timestampMs(b.cutAt) - timestampMs(a.cutAt);
    if (cutDiff) return cutDiff;
    return timestampMs(b.updatedAt || b.createdAt) - timestampMs(a.updatedAt || a.createdAt);
}

function latestActiveBossRecord(bossName) {
    return (state.bossCutRecords || [])
        .filter((record) => record.bossName === bossName && record.status !== 'canceled')
        .sort(compareBossCutRecordsByCutAtDesc)[0] || null;
}

function refreshCurrentBossCut(bossName) {
    state.bossCuts = state.bossCuts || {};
    const latest = latestActiveBossRecord(bossName);
    if (latest) {
        state.bossCuts[bossName] = bossCutStateFromRecord(latest);
    } else {
        delete state.bossCuts[bossName];
    }
}

function syncBossCutRecordState(record) {
    const cut = state.bossCuts?.[record?.bossName];
    if (!cut || cut.recordId !== record.id) return;
    cut.participants = Array.isArray(record.participants) ? record.participants : [];
    cut.participantProofs = Array.isArray(record.participantProofs) ? record.participantProofs : [];
    cut.participationOpenUntil = record.participationOpenUntil || null;
}

function findParticipantProofById(proofId) {
    const id = cleanText(proofId, 80);
    if (!id) return null;

    for (const record of state.bossCutRecords || []) {
        const proof = (record.participantProofs || []).find((item) => item.id === id);
        if (proof) return { record, proof };
    }
    return null;
}

function participantProofFilePath(fileName) {
    const safeName = path.basename(cleanText(fileName, 120));
    return safeName ? path.join(PHOTO_PROOF_DIR, safeName) : '';
}

function cleanupExpiredParticipantProofs() {
    const now = Date.now();
    let changed = false;

    for (const record of state.bossCutRecords || []) {
        let recordChanged = false;
        for (const proof of record.participantProofs || []) {
            const expiresMs = new Date(proof.expiresAt || '').getTime();
            if (!Number.isFinite(expiresMs) || expiresMs > now || proof.status === 'expired') continue;

            const filePath = participantProofFilePath(proof.fileName);
            if (proof.status === 'pending') proof.status = 'expired';
            proof.fileName = '';
            proof.reviewedAt = proof.reviewedAt || (proof.status === 'expired' ? new Date(now).toISOString() : null);
            changed = true;
            recordChanged = true;
            if (filePath) fs.unlink(filePath).catch(() => {});
        }
        if (recordChanged) syncBossCutRecordState(record);
    }

    return changed;
}

function appendBossAuditLog(action, { bossName, recordId = '', actorName = '', detail = {} }) {
    state.bossAuditLogs = state.bossAuditLogs || [];
    state.bossAuditLogs.unshift({
        id: randomUUID(),
        action,
        bossName: cleanText(bossName, 40),
        recordId: cleanText(recordId, 80),
        actorName: cleanText(actorName, 24),
        createdAt: new Date().toISOString(),
        detail
    });
    state.bossAuditLogs = state.bossAuditLogs.slice(0, MAX_BOSS_AUDIT_LOGS);
}

function normalizeAdminPasswordValue(value) {
    const raw = String(value || '').trim();
    if (raw.length >= 2) {
        const first = raw[0];
        const last = raw[raw.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return raw.slice(1, -1).trim();
        }
    }
    return raw;
}

function verifyAdminPassword(value) {
    return ADMIN_PASSWORD_CONFIGURED
        && normalizeAdminPasswordValue(value) === normalizeAdminPasswordValue(ADMIN_PASSWORD);
}

function rejectInvalidAdmin(res, value) {
    if (!ADMIN_PASSWORD_CONFIGURED) {
        sendJson(res, 503, { error: '관리자 비밀번호가 서버 환경변수에 설정되지 않았습니다.' });
        return true;
    }
    if (verifyAdminPassword(value)) return false;
    sendJson(res, 403, { error: '관리자 비밀번호가 맞지 않습니다.' });
    return true;
}

function isCheckLog(log) {
    return !log.action || log.action === 'check';
}

async function readBosses() {
    if (Array.isArray(state.bosses) && state.bosses.length > 0) {
        return ensureDefaultBossEvents(state.bosses);
    }

    const raw = await fs.readFile(path.join(ROOT, 'bosses.json'), 'utf8');
    return ensureDefaultBossEvents(normalizeBosses(JSON.parse(raw)));
}

async function hydrateBossCutState() {
    const bosses = await readBosses().catch(() => []);
    const records = state.bossCutRecords || [];
    state.bossCuts = state.bossCuts || {};
    let changed = false;

    for (const [bossName, cut] of Object.entries(state.bossCuts)) {
        const boss = bosses.find((item) => item.이름 === bossName || item.애칭 === bossName);
        if (!boss || !cut?.timeValue) continue;

        if (!cut.cutAt) {
            const baseMs = new Date(cut.updatedAt).getTime();
            cut.cutAt = isoFromCommandTime(cut.timeValue, Number.isFinite(baseMs) ? baseMs : Date.now());
            changed = true;
        }

        const nextSpawnAt = calcBossNextSpawnAt(boss, cut.cutAt);
        if (nextSpawnAt && cut.nextSpawnAt !== nextSpawnAt) {
            cut.nextSpawnAt = nextSpawnAt;
            changed = true;
        }
        if (!Array.isArray(cut.participants)) {
            cut.participants = [];
            changed = true;
        }
        const timeUncertain = boss.타입 === '시간' && Boolean(cut.timeUncertain);
        if (cut.timeUncertain !== timeUncertain) changed = true;
        cut.timeUncertain = timeUncertain;
        const requiresParticipation = Boolean(cut.requiresParticipation);
        if (cut.requiresParticipation !== requiresParticipation) changed = true;
        cut.requiresParticipation = requiresParticipation;
        const participantPasswordHash = cleanText(cut.participantPasswordHash, 128);
        if (cut.participantPasswordHash !== participantPasswordHash) changed = true;
        cut.participantPasswordHash = participantPasswordHash;
        if (!cut.participationOpenUntil) cut.participationOpenUntil = null;

        if (!cut.recordId || !records.some((record) => record.id === cut.recordId)) {
            const record = normalizeBossCutRecord({
                id: cut.recordId || randomUUID(),
                bossName: boss.이름,
                bossAlias: boss.애칭 || '',
                bossType: boss.타입 || '',
                location: boss.위치 || '',
                timeValue: cut.timeValue,
                cutAt: cut.cutAt,
                nextSpawnAt: cut.nextSpawnAt,
                reporterName: cut.reporterName,
                updatedAt: cut.updatedAt,
                timeUncertain: cut.timeUncertain,
                requiresParticipation: cut.requiresParticipation,
                participantPasswordHash: cut.participantPasswordHash,
                participationOpenUntil: cut.participationOpenUntil,
                participants: cut.participants,
                participantProofs: cut.participantProofs
            });

            if (record) {
                cut.recordId = record.id;
                records.unshift(record);
                changed = true;
            }
        }
    }

    const normalizedRecords = records
        .map(normalizeBossCutRecord)
        .filter(Boolean)
        .slice(0, MAX_BOSS_CUT_RECORDS);

    if (normalizedRecords.length !== records.length) changed = true;

    for (const record of normalizedRecords) {
        if (record.status === 'canceled') continue;
        const boss = bosses.find((item) => item.이름 === record.bossName || item.애칭 === record.bossName);
        if (!boss) continue;
        const nextSpawnAt = calcBossNextSpawnAt(boss, record.cutAt);
        if (nextSpawnAt && record.nextSpawnAt !== nextSpawnAt) {
            record.nextSpawnAt = nextSpawnAt;
            changed = true;
        }
    }

    if (repairMayElevenMistimedMissCuts(normalizedRecords, bosses)) changed = true;

    state.bossCutRecords = normalizedRecords
        .sort((a, b) => new Date(b.updatedAt || b.cutAt) - new Date(a.updatedAt || a.cutAt))
        .slice(0, MAX_BOSS_CUT_RECORDS);

    const bossNames = new Set([
        ...Object.keys(state.bossCuts || {}),
        ...state.bossCutRecords.map((record) => record.bossName)
    ]);
    for (const bossName of bossNames) refreshCurrentBossCut(bossName);
    return changed;
}

function reservationExpiresAt(zone, now = Date.now()) {
    const cooldownReadyAt = zone.cooldownUntil ? new Date(zone.cooldownUntil).getTime() : 0;
    const base = Math.max(now, Number.isFinite(cooldownReadyAt) ? cooldownReadyAt : 0);
    return new Date(base + RESERVATION_GRACE_MS).toISOString();
}

function cleanupExpiredReservations(now = Date.now()) {
    let changed = false;

    for (const zone of state.zones) {
        if (!Array.isArray(zone.reservations) || zone.reservations.length === 0) continue;

        const nextReservations = zone.reservations.filter((reservation) => {
            if (!reservation.expiresAt) {
                reservation.expiresAt = reservationExpiresAt(zone, now);
                changed = true;
                return true;
            }
            return new Date(reservation.expiresAt).getTime() > now;
        });

        if (nextReservations.length !== zone.reservations.length) {
            zone.reservations = nextReservations;
            changed = true;
        }
    }

    return changed;
}

function cleanupExpiredBossCutLocks(now = Date.now()) {
    let changed = false;
    state.bossCutLocks = state.bossCutLocks || {};

    for (const [bossName, lock] of Object.entries(state.bossCutLocks)) {
        const expiresMs = new Date(lock.expiresAt).getTime();
        if (!Number.isFinite(expiresMs) || expiresMs <= now) {
            delete state.bossCutLocks[bossName];
            changed = true;
        }
    }

    return changed;
}

function activeBossCutLock(bossName, now = Date.now()) {
    cleanupExpiredBossCutLocks(now);
    const lock = state.bossCutLocks?.[bossName];
    if (!lock) return null;
    const expiresMs = new Date(lock.expiresAt).getTime();
    return Number.isFinite(expiresMs) && expiresMs > now ? lock : null;
}

function releaseBossCutLock(bossName, memberName = '') {
    const lock = state.bossCutLocks?.[bossName];
    if (!lock) return false;
    if (memberName && lock.memberName !== memberName) return false;
    delete state.bossCutLocks[bossName];
    return true;
}

function snapshotZone(zone) {
    return {
        cooldownUntil: zone.cooldownUntil || null,
        lastBy: zone.lastBy || null,
        lastAt: zone.lastAt || null,
        reservations: Array.isArray(zone.reservations) ? structuredClone(zone.reservations) : [],
        orderIndex: state.zones.findIndex((item) => item.id === zone.id)
    };
}

function moveZoneToIndex(zoneId, targetIndex) {
    const currentIndex = state.zones.findIndex((zone) => zone.id === zoneId);
    if (currentIndex === -1) return null;
    const [zone] = state.zones.splice(currentIndex, 1);
    const safeIndex = Math.max(0, Math.min(Number(targetIndex) || 0, state.zones.length));
    state.zones.splice(safeIndex, 0, zone);
    return zone;
}

function moveZoneToEnd(zoneId) {
    const currentIndex = state.zones.findIndex((zone) => zone.id === zoneId);
    if (currentIndex === -1 || currentIndex === state.zones.length - 1) return;
    const [zone] = state.zones.splice(currentIndex, 1);
    state.zones.push(zone);
}

function restoreZoneAfterUndo(zone, removedLog) {
    const previous = removedLog?.previousZoneState;
    if (previous && typeof previous === 'object') {
        zone.cooldownUntil = previous.cooldownUntil || null;
        zone.lastBy = previous.lastBy || null;
        zone.lastAt = previous.lastAt || null;
        zone.reservations = Array.isArray(previous.reservations) ? previous.reservations : [];
        if (Number.isFinite(previous.orderIndex)) moveZoneToIndex(zone.id, previous.orderIndex);
        return;
    }

    const previousLog = state.logs.find((log) => log.zoneId === zone.id && isCheckLog(log));
    if (!previousLog) {
        zone.cooldownUntil = null;
        zone.lastBy = null;
        zone.lastAt = null;
        zone.reservations = [];
        return;
    }

    const previousAt = new Date(previousLog.checkedAt).getTime();
    const previousCooldown = normalizeCooldown(previousLog.cooldownMin) || zone.cooldownMin;
    zone.cooldownUntil = Number.isFinite(previousAt)
        ? new Date(previousAt + previousCooldown * 60000).toISOString()
        : null;
    zone.lastBy = previousLog.memberName || previousLog.checkedBy || null;
    zone.lastAt = previousLog.checkedAt || null;
    zone.reservations = [];
}

function appendEventLog({ action, zone, memberName, detail = {} }) {
    state.logs.unshift({
        id: randomUUID(),
        action,
        zoneId: zone.id,
        zoneName: zone.name,
        memberName,
        checkedBy: memberName,
        checkedAt: new Date().toISOString(),
        ...detail
    });
    state.logs = state.logs.slice(0, 500);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 9000000) {
                req.destroy();
                reject(new Error('Request body too large'));
            }
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

async function readJson(req) {
    const body = await readBody(req);
    if (!body) return {};
    return JSON.parse(body);
}

function decodePhotoProofDataUrl(value) {
    const text = String(value || '');
    const match = text.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) {
        const err = new Error('사진 파일 형식은 JPG, PNG, WEBP만 가능합니다.');
        err.statusCode = 400;
        throw err;
    }

    const mimeType = match[1];
    const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (!buffer.length) {
        const err = new Error('사진 파일을 읽지 못했습니다.');
        err.statusCode = 400;
        throw err;
    }
    if (buffer.length > PHOTO_PROOF_MAX_BYTES) {
        const err = new Error('사진 용량이 큽니다. 다시 압축해서 올려주세요.');
        err.statusCode = 413;
        throw err;
    }

    return { mimeType, buffer, ext: PHOTO_PROOF_MIME_EXT[mimeType] };
}

async function storePhotoProof(imageData) {
    const { mimeType, buffer, ext } = decodePhotoProofDataUrl(imageData);
    const id = randomUUID();
    const fileName = `${id}.${ext}`;
    await fs.mkdir(PHOTO_PROOF_DIR, { recursive: true });
    await fs.writeFile(path.join(PHOTO_PROOF_DIR, fileName), buffer);
    return { id, fileName, mimeType, size: buffer.length };
}

async function readPrimaryStateFile() {
    try {
        return await fs.readFile(STATE_FILE, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT' && STATE_FILE !== ROOT_STATE_FILE) {
            try {
                const rootState = await fs.readFile(ROOT_STATE_FILE, 'utf8');
                console.warn(`[slash-check] migrating state from ${ROOT_STATE_FILE} to ${STATE_FILE}`);
                return rootState;
            } catch {
                // Use the normal empty-state path below.
            }
        }
        throw err;
    }
}

async function loadState() {
    try {
        const raw = await readPrimaryStateFile();
        const parsed = JSON.parse(raw);
        const legacyCuts = parsed.bossCuts ? null : await readLegacyBossCuts();
        state = {
            members: Array.isArray(parsed.members) ? parseMembers(parsed.members) : defaultState.members,
            zones: Array.isArray(parsed.zones) ? parsed.zones : defaultState.zones,
            logs: Array.isArray(parsed.logs) ? parsed.logs : [],
            bossCuts: normalizeBossCuts(parsed.bossCuts || legacyCuts),
            bossCutRecords: normalizeBossCutRecords(parsed.bossCutRecords),
            bossCutLocks: normalizeBossCutLocks(parsed.bossCutLocks),
            bossAuditLogs: normalizeBossAuditLogs(parsed.bossAuditLogs),
            bosses: normalizeBosses(parsed.bosses)
        };
        const bossCountBeforeDefaults = state.bosses.length;
        state.bosses = ensureDefaultBossEvents(state.bosses);
        const bossDefaultsChanged = state.bosses.length !== bossCountBeforeDefaults;
        state.zones = state.zones.map((zone) => ({
            ...zone,
            reservations: Array.isArray(zone.reservations) ? zone.reservations : []
        }));
        const changed = await hydrateBossCutState();
        if (changed || bossDefaultsChanged) await saveState();
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('[slash-check] state load failed:', err);
        state = structuredClone(defaultState);
        state.bossCuts = await readLegacyBossCuts();
        state.bossCutRecords = [];
        state.bossCutLocks = {};
        state.bossAuditLogs = [];
        state.bosses = ensureDefaultBossEvents(state.bosses);
        await hydrateBossCutState();
        await saveState();
    }
}

async function readLegacyBossCuts() {
    try {
        const raw = await fs.readFile(LEGACY_BOSS_STATE_FILE, 'utf8');
        return normalizeBossCuts(JSON.parse(raw));
    } catch {
        return {};
    }
}

async function saveState() {
    const snapshot = JSON.stringify(state, null, 2);
    const targetDir = path.dirname(STATE_FILE);
    const tempFile = path.join(targetDir, `.slash-check-state.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);

    saveStateQueue = saveStateQueue.catch(() => {}).then(async () => {
        await fs.mkdir(targetDir, { recursive: true });
        await fs.writeFile(tempFile, snapshot, 'utf8');
        await fs.rename(tempFile, STATE_FILE);
    });

    return saveStateQueue;
}

async function loadGeckoState() {
    try {
        const raw = await fs.readFile(GECKO_STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        const seen = new Set();
        const geckos = [];
        for (const item of Array.isArray(parsed.geckos) ? parsed.geckos : []) {
            const gecko = normalizeGecko(item, item);
            if (!gecko || seen.has(gecko.number)) continue;
            seen.add(gecko.number);
            geckos.push(gecko);
        }
        geckoState = {
            geckos,
            logs: normalizeGeckoLogs(parsed.logs),
            examplesSeededAt: parsed.examplesSeededAt || null,
            updatedAt: parsed.updatedAt || null
        };
        if (!geckoState.examplesSeededAt) {
            addMissingGeckoExamples();
            await saveGeckoState();
        }
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('[gecko] state load failed:', err);
        geckoState = createExampleGeckoState();
        await saveGeckoState();
    }
}

async function saveGeckoState() {
    geckoState.updatedAt = new Date().toISOString();
    const targetDir = path.dirname(GECKO_STATE_FILE);

    saveGeckoStateQueue = saveGeckoStateQueue.catch(() => {}).then(async () => {
        const snapshot = JSON.stringify(geckoState, null, 2);
        const tempFile = path.join(targetDir, `.gecko-state.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
        await fs.mkdir(targetDir, { recursive: true });
        await fs.writeFile(tempFile, snapshot, 'utf8');
        await fs.rename(tempFile, GECKO_STATE_FILE);
    });

    return saveGeckoStateQueue;
}

function todayKstDate() {
    const now = new Date(Date.now() + KST_OFFSET_MS);
    return now.toISOString().slice(0, 10);
}

function normalizeTravelCurrency(value) {
    const text = String(value || '').trim().toUpperCase();
    return text === 'JPY' ? 'JPY' : 'KRW';
}

function normalizeTravelAmount(value) {
    const number = Number(String(value ?? '').replace(/,/g, '').trim());
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.round(number));
}

function normalizeTravelTime(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const match = text.match(/(\d{1,2})[:시](\d{1,2})/);
    if (!match) return '';
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const TRAVEL_TRANSACTION_TYPES = new Set(['지출', '현금인출', 'IC충전', '환전', '환급', '정산이동', '수수료', '기타']);
const DEFAULT_TRAVEL_WALLETS = [
    { id: 'hana-jpy', name: '하나머니', currency: 'JPY', balance: 133227, note: '300만원 예산 기준 엔화 보유액' },
    { id: 'cash-jpy', name: '현금', currency: 'JPY', balance: 0, note: '' },
    { id: 'ic-jpy', name: 'IC카드', currency: 'JPY', balance: 0, note: '' },
    { id: 'card-jpy', name: '신용카드', currency: 'JPY', balance: 0, note: '' }
];

function normalizeTravelTransactionType(value) {
    const text = cleanText(value, 30);
    if (TRAVEL_TRANSACTION_TYPES.has(text)) return text;
    const lower = text.toLowerCase();
    if (/atm|withdraw|cash withdrawal|출금|현금인출|현금화|인출/.test(lower)) return '현금인출';
    if (/ic|icoca|suica|pasmo|교통카드|충전|charge|チャージ|入金/.test(lower)) return 'IC충전';
    if (/exchange|환전|하나머니|hana/.test(lower)) return '환전';
    if (/refund|환급|返金|취소/.test(lower)) return '환급';
    if (/fee|수수료|手数料/.test(lower)) return '수수료';
    return '지출';
}

function normalizeTravelWallet(value, existing = null, options = {}) {
    const fallback = existing || {};
    const id = cleanText(value?.id || fallback.id, 80);
    const defaultWallet = DEFAULT_TRAVEL_WALLETS.find((wallet) => wallet.id === id) || {};
    const nowIso = new Date().toISOString();
    const legacyUntouchedHana = id === 'hana-jpy'
        && Number(value?.balance) === 0
        && !value?.updatedAt
        && !fallback.updatedAt
        && Number(defaultWallet.balance) > 0;

    return {
        id: id || cleanText(defaultWallet.id, 80) || randomUUID(),
        name: cleanText(value?.name || fallback.name || defaultWallet.name || '지갑', 40),
        currency: normalizeTravelCurrency(value?.currency || fallback.currency || defaultWallet.currency || 'JPY'),
        balance: normalizeTravelAmount(legacyUntouchedHana ? defaultWallet.balance : (value?.balance ?? fallback.balance ?? defaultWallet.balance ?? 0)),
        note: cleanText(value?.note || fallback.note || defaultWallet.note || '', 160),
        updatedAt: options.touch ? nowIso : (fallback.updatedAt || value?.updatedAt || null)
    };
}

function normalizeTravelWallets(value) {
    const map = new Map();

    for (const wallet of DEFAULT_TRAVEL_WALLETS) {
        map.set(wallet.id, normalizeTravelWallet(wallet));
    }

    if (Array.isArray(value)) {
        for (const wallet of value) {
            const id = cleanText(wallet?.id, 80);
            if (!id) continue;
            map.set(id, normalizeTravelWallet(wallet, map.get(id)));
        }
    }

    return [...map.values()].slice(0, 20);
}

function normalizeTravelLineItems(value, fallbackCurrency = 'JPY') {
    const source = Array.isArray(value) ? value : [];
    return source
        .map((item) => {
            const name = cleanText(item?.name || item?.item || item?.menu || item?.title, 80);
            const amount = normalizeTravelAmount(item?.amount ?? item?.price ?? 0);
            const quantityText = cleanText(item?.quantity || item?.qty || '', 20);
            const currency = item?.currency ? normalizeTravelCurrency(item.currency) : fallbackCurrency;
            if (!name && amount <= 0) return null;
            return {
                name: name || '품목 확인 필요',
                amount,
                currency,
                quantity: quantityText
            };
        })
        .filter(Boolean)
        .slice(0, 12);
}

function normalizeTravelExpense(value, existing = null) {
    const date = cleanDate(value?.date) || todayKstDate();
    const amount = normalizeTravelAmount(value?.amount);
    const currency = normalizeTravelCurrency(value?.currency || existing?.currency || 'JPY');
    const nowIso = new Date().toISOString();
    const receipt = value?.receipt || existing?.receipt || null;
    const analysisStatus = cleanText(value?.analysisStatus || existing?.analysisStatus || (receipt ? '분석대기' : '수동'), 30);
    const lineItems = normalizeTravelLineItems(
        value?.lineItems || value?.aiRaw?.lineItems || existing?.lineItems || existing?.aiRaw?.lineItems || [],
        currency
    );

    return {
        id: cleanText(value?.id || existing?.id, 80) || randomUUID(),
        date,
        payer: cleanText(value?.payer || existing?.payer || '공금', 30),
        category: cleanText(value?.category || existing?.category || '식사', 30),
        merchant: cleanText(value?.merchant || existing?.merchant || '', 80),
        item: cleanText(value?.item || existing?.item || '', 120),
        currency,
        amount,
        lineItems,
        paymentTime: normalizeTravelTime(value?.paymentTime || existing?.paymentTime || ''),
        location: cleanText(value?.location || existing?.location || '', 120),
        method: cleanText(value?.method || existing?.method || '카드', 30),
        transactionType: normalizeTravelTransactionType(value?.transactionType || existing?.transactionType || '지출'),
        icCard: cleanText(value?.icCard || existing?.icCard || '', 40),
        icBalance: normalizeTravelAmount(value?.icBalance ?? existing?.icBalance ?? 0),
        icBalanceCurrency: value?.icBalanceCurrency || existing?.icBalanceCurrency
            ? normalizeTravelCurrency(value?.icBalanceCurrency || existing?.icBalanceCurrency)
            : '',
        memo: cleanText(value?.memo || existing?.memo || '', 300),
        receipt,
        analysisStatus,
        confidence: Math.max(0, Math.min(1, Number(value?.confidence ?? existing?.confidence ?? 0) || 0)),
        aiNote: cleanText(value?.aiNote || existing?.aiNote || '', 300),
        aiRaw: value?.aiRaw || existing?.aiRaw || null,
        createdAt: existing?.createdAt || nowIso,
        updatedAt: nowIso
    };
}

function normalizeTravelExpenses(value) {
    const items = Array.isArray(value) ? value : [];
    return items
        .map((item) => normalizeTravelExpense(item, item))
        .filter((item) => item.amount > 0 || item.merchant || item.item || item.memo || item.receipt)
        .slice(0, 1000);
}

async function loadTravelState() {
    try {
        const raw = await fs.readFile(TRAVEL_STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        travelState = {
            expenses: normalizeTravelExpenses(parsed.expenses),
            wallets: normalizeTravelWallets(parsed.wallets),
            updatedAt: parsed.updatedAt || null
        };
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('[travel] state load failed:', err);
        travelState = { expenses: [], wallets: normalizeTravelWallets([]), updatedAt: null };
        await saveTravelState();
    }
}

async function saveTravelState() {
    travelState.wallets = normalizeTravelWallets(travelState.wallets);
    travelState.updatedAt = new Date().toISOString();
    const targetDir = path.dirname(TRAVEL_STATE_FILE);

    saveTravelStateQueue = saveTravelStateQueue.catch(() => {}).then(async () => {
        const snapshot = JSON.stringify(travelState, null, 2);
        const tempFile = path.join(targetDir, `.travel-expenses.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
        await fs.mkdir(targetDir, { recursive: true });
        await fs.writeFile(tempFile, snapshot, 'utf8');
        await fs.rename(tempFile, TRAVEL_STATE_FILE);
    });

    return saveTravelStateQueue;
}

function verifyTravelPin(value) {
    return normalizeAdminPasswordValue(value) === TRAVEL_PIN;
}

function travelPinFrom(req, url, body = {}) {
    return body.pin || url.searchParams.get('pin') || req.headers['x-travel-pin'] || '';
}

function rejectInvalidTravelPin(req, res, url, body = {}) {
    if (verifyTravelPin(travelPinFrom(req, url, body))) return false;
    sendJson(res, 403, { error: '여행 정산 비밀번호가 맞지 않습니다.' });
    return true;
}

function decodeTravelReceiptDataUrl(value) {
    const text = String(value || '');
    const match = text.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) {
        const err = new Error('영수증 사진은 JPG, PNG, WEBP만 가능합니다.');
        err.statusCode = 400;
        throw err;
    }

    const mimeType = match[1];
    const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (!buffer.length) {
        const err = new Error('영수증 사진을 읽지 못했습니다.');
        err.statusCode = 400;
        throw err;
    }
    if (buffer.length > TRAVEL_RECEIPT_MAX_BYTES) {
        const err = new Error('영수증 사진 용량이 큽니다. 다시 압축해서 올려주세요.');
        err.statusCode = 413;
        throw err;
    }

    return { mimeType, buffer, ext: PHOTO_PROOF_MIME_EXT[mimeType] };
}

async function storeTravelReceipt(imageData) {
    const { mimeType, buffer, ext } = decodeTravelReceiptDataUrl(imageData);
    const id = randomUUID();
    const fileName = `${id}.${ext}`;
    await fs.mkdir(TRAVEL_RECEIPT_DIR, { recursive: true });
    await fs.writeFile(path.join(TRAVEL_RECEIPT_DIR, fileName), buffer);
    return {
        id,
        fileName,
        mimeType,
        size: buffer.length,
        uploadedAt: new Date().toISOString()
    };
}

function publicTravelState() {
    return {
        now: new Date().toISOString(),
        updatedAt: travelState.updatedAt,
        expenses: travelState.expenses,
        wallets: normalizeTravelWallets(travelState.wallets)
    };
}

function buildRankings() {
    const counts = new Map();

    for (const member of state.members) {
        counts.set(member, { memberName: member, count: 0, lastZone: null, lastAt: null });
    }

    for (const log of state.logs) {
        if (!isCheckLog(log)) continue;

        const current = counts.get(log.memberName) || {
            memberName: log.memberName,
            count: 0,
            lastZone: null,
            lastAt: null
        };
        current.count += 1;
        if (!current.lastAt || new Date(log.checkedAt) > new Date(current.lastAt)) {
            current.lastZone = log.zoneName;
            current.lastAt = log.checkedAt;
        }
        counts.set(log.memberName, current);
    }

    return [...counts.values()]
        .sort((a, b) => b.count - a.count || String(a.memberName).localeCompare(String(b.memberName), 'ko'));
}

function publicState() {
    cleanupExpiredReservations();
    cleanupExpiredParticipantProofs();
    return {
        now: new Date().toISOString(),
        members: state.members,
        zones: state.zones,
        rankings: buildRankings(),
        logs: state.logs.slice(0, 500),
        bossCuts: publicBossCuts(),
        bossCutRecords: publicBossCutRecords(),
        bossCutLocks: publicBossCutLocks(),
        bossParticipationWindowMin: BOSS_PARTICIPATION_WINDOW_MIN
    };
}

async function publicStateWithBosses() {
    return {
        ...publicState(),
        bosses: await readBosses()
    };
}

async function readBandMonitorStatus() {
    try {
        const raw = await fs.readFile(BAND_MONITOR_STATUS_FILE, 'utf8');
        const value = JSON.parse(raw);
        return value && typeof value === 'object' ? value : { state: 'UNKNOWN' };
    } catch (err) {
        if (err.code !== 'ENOENT') console.warn('[band-monitor] status read failed:', err.message);
        return { state: 'UNKNOWN', connected: false };
    }
}

async function handleApi(req, res, url) {
    if (cleanupExpiredReservations() || cleanupExpiredBossCutLocks() || cleanupExpiredParticipantProofs()) await saveState();

    if (url.pathname === '/health' && req.method === 'GET') {
        sendJson(res, 200, {
            ok: true,
            now: new Date().toISOString(),
            bandMonitor: await readBandMonitorStatus()
        });
        return true;
    }

    if (url.pathname === '/api/private-memo/public' || url.pathname === '/api/private-memo') {
        sendJson(res, 404, { error: 'Not found' });
        return true;
    }

    if (url.pathname === '/api/travel/auth' && req.method === 'POST') {
        const body = await readJson(req);
        if (!verifyTravelPin(body.pin)) {
            sendJson(res, 403, { error: '여행 정산 비밀번호가 맞지 않습니다.' });
            return true;
        }
        sendJson(res, 200, { ok: true });
        return true;
    }

    if (url.pathname === '/api/travel/expenses' && req.method === 'GET') {
        if (rejectInvalidTravelPin(req, res, url)) return true;
        sendJson(res, 200, publicTravelState());
        return true;
    }

    if (url.pathname === '/api/travel/wallets/update' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidTravelPin(req, res, url, body)) return true;

        const id = cleanText(body.id, 80);
        const existing = normalizeTravelWallets(travelState.wallets).find((item) => item.id === id);
        if (!id || !existing) {
            sendJson(res, 404, { error: '수정할 잔액 항목을 찾을 수 없습니다.' });
            return true;
        }

        const next = normalizeTravelWallet(body, existing, { touch: true });
        travelState.wallets = normalizeTravelWallets(
            normalizeTravelWallets(travelState.wallets).map((item) => item.id === id ? next : item)
        );
        await saveTravelState();
        sendJson(res, 200, { ...publicTravelState(), saved: next });
        return true;
    }

    if (url.pathname === '/api/travel/expenses' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidTravelPin(req, res, url, body)) return true;

        let receipt = null;
        if (body.receiptImage) {
            try {
                receipt = await storeTravelReceipt(body.receiptImage);
            } catch (err) {
                sendJson(res, err.statusCode || 400, { error: err.message || '영수증 사진 저장에 실패했습니다.' });
                return true;
            }
        }

        const expense = normalizeTravelExpense({
            ...body,
            receipt,
            analysisStatus: receipt ? '분석대기' : '수동'
        });
        travelState.expenses.unshift(expense);
        travelState.expenses = normalizeTravelExpenses(travelState.expenses);
        await saveTravelState();
        sendJson(res, 200, { ...publicTravelState(), saved: expense });
        return true;
    }

    if (url.pathname === '/api/travel/receipts' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidTravelPin(req, res, url, body)) return true;

        if (!body.receiptImage) {
            sendJson(res, 400, { error: '영수증 사진이 필요합니다.' });
            return true;
        }

        let receipt;
        try {
            receipt = await storeTravelReceipt(body.receiptImage);
        } catch (err) {
            sendJson(res, err.statusCode || 400, { error: err.message || '영수증 사진 저장에 실패했습니다.' });
            return true;
        }

        const expense = normalizeTravelExpense({
            date: body.date,
            payer: body.payer || '공금',
            category: '분석대기',
            merchant: '',
            item: '영수증 AI 분석 대기',
            currency: 'JPY',
            amount: 0,
            method: '카드',
            memo: cleanText(body.memo, 300),
            receipt,
            analysisStatus: '분석대기',
            confidence: 0
        });
        travelState.expenses.unshift(expense);
        travelState.expenses = normalizeTravelExpenses(travelState.expenses);
        await saveTravelState();
        sendJson(res, 200, { ...publicTravelState(), saved: expense });
        return true;
    }

    if (url.pathname === '/api/travel/text-expenses' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidTravelPin(req, res, url, body)) return true;

        const inputText = cleanText(body.text || body.memo, 500);
        if (!inputText) {
            sendJson(res, 400, { error: '내용 필요' });
            return true;
        }

        const expense = normalizeTravelExpense({
            date: body.date,
            payer: body.payer || '공금',
            category: '분석대기',
            merchant: '',
            item: '문장 AI 분석 대기',
            currency: 'JPY',
            amount: 0,
            method: '기타',
            memo: inputText,
            analysisStatus: '문장분석대기',
            confidence: 0,
            aiRaw: { inputText }
        });
        travelState.expenses.unshift(expense);
        travelState.expenses = normalizeTravelExpenses(travelState.expenses);
        await saveTravelState();
        sendJson(res, 200, { ...publicTravelState(), saved: expense });
        return true;
    }

    if (url.pathname === '/api/travel/expenses/update' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidTravelPin(req, res, url, body)) return true;

        const id = cleanText(body.id, 80);
        const existing = travelState.expenses.find((item) => item.id === id);
        if (!existing) {
            sendJson(res, 404, { error: '수정할 결제 내역을 찾을 수 없습니다.' });
            return true;
        }

        const next = normalizeTravelExpense(body, existing);
        travelState.expenses = travelState.expenses.map((item) => item.id === id ? next : item);
        await saveTravelState();
        sendJson(res, 200, { ...publicTravelState(), saved: next });
        return true;
    }

    if (url.pathname === '/api/travel/expenses/reanalyze' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidTravelPin(req, res, url, body)) return true;

        const id = cleanText(body.id, 80);
        const existing = travelState.expenses.find((item) => item.id === id);
        if (!existing) {
            sendJson(res, 404, { error: '재분석할 결제 내역을 찾을 수 없습니다.' });
            return true;
        }

        const canAnalyzeText = Boolean(existing.aiRaw?.inputText || existing.memo);
        if (!existing.receipt?.id && !canAnalyzeText) {
            sendJson(res, 400, { error: '재분석할 영수증 사진이나 문장 입력이 없습니다.' });
            return true;
        }

        const next = normalizeTravelExpense({
            ...existing,
            lineItems: [],
            analysisStatus: existing.receipt?.id ? '분석대기' : '문장분석대기',
            confidence: 0,
            aiNote: '품목 상세 재분석 대기'
        }, existing);
        travelState.expenses = travelState.expenses.map((item) => item.id === id ? next : item);
        await saveTravelState();
        sendJson(res, 200, { ...publicTravelState(), saved: next });
        return true;
    }

    if (url.pathname === '/api/travel/expenses/delete' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidTravelPin(req, res, url, body)) return true;

        const id = cleanText(body.id, 80);
        const target = travelState.expenses.find((item) => item.id === id);
        const before = travelState.expenses.length;
        travelState.expenses = travelState.expenses.filter((item) => item.id !== id);
        if (travelState.expenses.length === before) {
            sendJson(res, 404, { error: '삭제할 결제 내역을 찾을 수 없습니다.' });
            return true;
        }
        if (target?.receipt?.fileName) {
            fs.unlink(path.join(TRAVEL_RECEIPT_DIR, target.receipt.fileName)).catch(() => {});
        }
        await saveTravelState();
        sendJson(res, 200, publicTravelState());
        return true;
    }

    if (url.pathname.startsWith('/api/travel/receipt/') && req.method === 'GET') {
        if (rejectInvalidTravelPin(req, res, url)) return true;

        const id = decodeURIComponent(url.pathname.slice('/api/travel/receipt/'.length));
        const expense = travelState.expenses.find((item) => item.receipt?.id === id);
        if (!expense?.receipt?.fileName) {
            sendJson(res, 404, { error: '영수증 사진을 찾을 수 없습니다.' });
            return true;
        }

        const filePath = path.normalize(path.join(TRAVEL_RECEIPT_DIR, expense.receipt.fileName));
        if (!filePath.startsWith(TRAVEL_RECEIPT_DIR)) {
            send(res, 403, 'Forbidden');
            return true;
        }

        try {
            const data = await fs.readFile(filePath);
            send(res, 200, data, expense.receipt.mimeType || 'application/octet-stream');
        } catch (err) {
            sendJson(res, err.code === 'ENOENT' ? 404 : 500, { error: '영수증 사진을 읽지 못했습니다.' });
        }
        return true;
    }

    if (url.pathname === '/api/geckos' && req.method === 'GET') {
        sendJson(res, 200, publicGeckoState());
        return true;
    }

    if (url.pathname === '/api/geckos' && req.method === 'POST') {
        const body = await readJson(req);
        const input = body.gecko || body;
        const actor = geckoActorFrom(body);
        const existing = geckoState.geckos.find((item) => item.id === input.id || item.number === input.number);
        const gecko = normalizeGecko(input, existing);
        if (!gecko) {
            sendJson(res, 400, { error: '개체 번호를 확인하세요.' });
            return true;
        }
        const duplicate = geckoState.geckos.find((item) => item.number === gecko.number && item.id !== gecko.id);
        if (duplicate) {
            sendJson(res, 409, { error: `${gecko.number} 번호가 이미 있습니다.` });
            return true;
        }
        gecko.updatedAt = new Date().toISOString();
        gecko.updatedBy = actor;
        if (!existing) gecko.createdBy = actor;
        if (existing) {
            geckoState.geckos = geckoState.geckos.map((item) => item.id === existing.id ? gecko : item);
        } else {
            geckoState.geckos.push(gecko);
        }
        addGeckoLog({
            actor,
            action: cleanText(body.action, 40) || (existing ? '개체 수정' : '개체 등록'),
            target: `${gecko.number} ${gecko.name}`.trim(),
            targetId: gecko.id,
            detail: cleanText(body.detail, 240)
        });
        await saveGeckoState();
        sendJson(res, 200, { ...publicGeckoState(), saved: gecko });
        return true;
    }

    if (url.pathname === '/api/geckos/import' && req.method === 'POST') {
        const body = await readJson(req);
        const actor = geckoActorFrom(body);
        const items = Array.isArray(body.geckos) ? body.geckos.slice(0, 3000) : [];
        if (items.length === 0) {
            sendJson(res, 400, { error: '가져올 개체 데이터가 없습니다.' });
            return true;
        }
        let added = 0;
        let updated = 0;
        for (const input of items) {
            const existing = geckoState.geckos.find((item) => item.id === input.id || item.number === input.number);
            const gecko = normalizeGecko(input, existing);
            if (!gecko) continue;
            gecko.updatedAt = new Date().toISOString();
            gecko.updatedBy = actor;
            if (existing) {
                geckoState.geckos = geckoState.geckos.map((item) => item.id === existing.id ? gecko : item);
                updated += 1;
            } else if (!geckoState.geckos.some((item) => item.number === gecko.number)) {
                gecko.createdBy = actor;
                geckoState.geckos.push(gecko);
                added += 1;
            }
        }
        addGeckoLog({
            actor,
            action: '개체 일괄 등록',
            target: '개체 목록',
            detail: `추가 ${added}건 / 수정 ${updated}건`
        });
        await saveGeckoState();
        sendJson(res, 200, { ...publicGeckoState(), added, updated });
        return true;
    }

    if (url.pathname === '/api/geckos' && req.method === 'DELETE') {
        const body = await readJson(req).catch(() => ({}));
        const actor = geckoActorFrom(body);
        const id = cleanText(body.id || url.searchParams.get('id'), 80);
        const deleted = geckoState.geckos.find((item) => item.id === id);
        const before = geckoState.geckos.length;
        geckoState.geckos = geckoState.geckos.filter((item) => item.id !== id);
        if (geckoState.geckos.length === before) {
            sendJson(res, 404, { error: '삭제할 개체를 찾을 수 없습니다.' });
            return true;
        }
        addGeckoLog({
            actor,
            action: '개체 삭제',
            target: deleted ? `${deleted.number} ${deleted.name}`.trim() : id,
            targetId: id
        });
        await saveGeckoState();
        sendJson(res, 200, publicGeckoState());
        return true;
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
        sendJson(res, 200, await publicStateWithBosses());
        return true;
    }

    if (url.pathname === '/api/bosses' && req.method === 'GET') {
        sendJson(res, 200, await readBosses());
        return true;
    }

    if (url.pathname === '/api/bosses/reset-time-spawns' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidAdmin(res, body.adminPassword)) return true;

        const actorName = cleanText(body.actorName, 24);
        const nowIso = new Date().toISOString();
        const bosses = await readBosses();
        let resetCount = 0;

        state.bosses = bosses.map((boss) => {
            if (boss.타입 !== '시간') return { ...boss };
            resetCount += 1;
            return {
                ...boss,
                nextSpawnAt: nowIso,
                nextSpawnUpdatedAt: nowIso
            };
        });

        for (const boss of state.bosses) {
            if (boss.타입 !== '시간') continue;
            releaseBossCutLock(boss.이름);
        }

        appendBossAuditLog('time-reset', {
            bossName: '시간보스 전체',
            actorName,
            detail: {
                count: resetCount,
                nextSpawnAt: nowIso
            }
        });
        await saveState();
        sendJson(res, 200, {
            bosses: state.bosses,
            cuts: publicBossCuts(),
            records: publicBossCutRecords(),
            locks: publicBossCutLocks(),
            resetAt: nowIso,
            resetCount
        });
        return true;
    }

    if (url.pathname === '/api/boss-cuts' && req.method === 'GET') {
        sendJson(res, 200, { cuts: publicBossCuts(), records: publicBossCutRecords() });
        return true;
    }

    if (url.pathname === '/api/boss-logs' && req.method === 'GET') {
        sendJson(res, 200, { logs: publicBossAuditLogs(), now: new Date().toISOString() });
        return true;
    }

    if (url.pathname === '/api/boss-cuts/participant-photo' && req.method === 'GET') {
        const found = findParticipantProofById(url.searchParams.get('id'));
        const proof = found?.proof;
        if (!proof || !proof.fileName || proof.status === 'expired') {
            sendJson(res, 404, { error: '사진 인증 파일을 찾을 수 없습니다.' });
            return true;
        }

        const expiresMs = new Date(proof.expiresAt || '').getTime();
        if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
            cleanupExpiredParticipantProofs();
            await saveState();
            sendJson(res, 410, { error: '사진 인증 보관 시간이 지났습니다.' });
            return true;
        }

        try {
            const data = await fs.readFile(participantProofFilePath(proof.fileName));
            res.writeHead(200, {
                'Content-Type': proof.mimeType || 'image/jpeg',
                'Cache-Control': 'private, no-store'
            });
            res.end(data);
        } catch {
            sendJson(res, 404, { error: '사진 인증 파일을 찾을 수 없습니다.' });
        }
        return true;
    }

    if (url.pathname === '/api/boss-cuts/test-participation' && req.method === 'POST') {
        const body = await readJson(req);
        const reporterName = cleanText(body.reporterName, 24);
        const participantPasswordHash = hashParticipantPassword(body.participantPassword);

        if (!state.members.includes(reporterName)) {
            sendJson(res, 400, { error: '등록된 길드원만 테스트 기록을 열 수 있습니다.' });
            return true;
        }

        if (!participantPasswordHash) {
            sendJson(res, 400, { error: '테스트용 참여 비번을 입력하세요.' });
            return true;
        }

        const now = Date.now();
        const nowIso = new Date(now).toISOString();
        const timeValue = formatCommandTimeFromIso(nowIso);
        const participationOpenUntil = new Date(now + BOSS_PARTICIPATION_WINDOW_MS).toISOString();
        const record = {
            id: randomUUID(),
            bossName: '참여확인 테스트',
            bossAlias: '테스트',
            bossType: '임시',
            location: '테스트',
            timeValue,
            cutAt: nowIso,
            nextSpawnAt: null,
            reporterName,
            updatedAt: nowIso,
            status: 'active',
            timeUncertain: false,
            requiresParticipation: true,
            participantPasswordHash,
            participationOpenUntil,
            temporary: true,
            participants: [],
            participantProofs: []
        };

        state.bossCutRecords = state.bossCutRecords || [];
        state.bossCutRecords.unshift(record);
        state.bossCutRecords = state.bossCutRecords.slice(0, MAX_BOSS_CUT_RECORDS);
        appendBossAuditLog('participation-test', {
            bossName: record.bossName,
            recordId: record.id,
            actorName: reporterName,
            detail: {
                timeValue,
                participationOpenUntil
            }
        });

        await saveState();
        const records = publicBossCutRecords();
        sendJson(res, 200, {
            cuts: publicBossCuts(),
            records,
            record: records.find((item) => item.id === record.id) || null,
            bossParticipationWindowMin: BOSS_PARTICIPATION_WINDOW_MIN
        });
        return true;
    }

    if (url.pathname === '/api/boss-cut-locks' && req.method === 'POST') {
        const body = await readJson(req);
        const bossName = cleanText(body.bossName, 40);
        const memberName = cleanText(body.memberName, 24);
        const spawnMs = body.spawnAt ? new Date(body.spawnAt).getTime() : NaN;
        const spawnAt = Number.isFinite(spawnMs) ? new Date(spawnMs).toISOString() : null;

        if (!bossName || !memberName) {
            sendJson(res, 400, { error: '보스명과 길드원을 확인하세요.' });
            return true;
        }

        if (!state.members.includes(memberName)) {
            sendJson(res, 400, { error: '등록된 길드원만 컷을 입력할 수 있습니다.' });
            return true;
        }

        const bosses = await readBosses();
        const boss = bosses.find((item) => item.이름 === bossName || item.애칭 === bossName);
        if (!boss) {
            sendJson(res, 404, { error: '보스 정보를 찾을 수 없습니다.' });
            return true;
        }

        if (boss.타입 === '이벤트') {
            sendJson(res, 400, { error: '이벤트 일정은 컷 처리 대상이 아닙니다.' });
            return true;
        }

        const currentLock = activeBossCutLock(boss.이름);
        if (currentLock && currentLock.memberName !== memberName) {
            sendJson(res, 409, {
                error: `${currentLock.memberName} 님이 컷 입력 중입니다.`,
                locks: publicBossCutLocks()
            });
            return true;
        }

        const now = Date.now();
        const lock = {
            bossName: boss.이름,
            memberName,
            lockedAt: new Date(now).toISOString(),
            expiresAt: new Date(now + BOSS_CUT_LOCK_MS).toISOString(),
            spawnAt
        };
        state.bossCutLocks = state.bossCutLocks || {};
        state.bossCutLocks[boss.이름] = lock;

        await saveState();
        sendJson(res, 200, { lock, locks: publicBossCutLocks() });
        return true;
    }

    if (url.pathname === '/api/boss-cut-locks' && req.method === 'DELETE') {
        const bossName = cleanText(url.searchParams.get('bossName'), 40);
        const memberName = cleanText(url.searchParams.get('memberName'), 24);
        if (releaseBossCutLock(bossName, memberName)) await saveState();
        sendJson(res, 200, { locks: publicBossCutLocks() });
        return true;
    }

    if (url.pathname === '/api/boss-cuts' && req.method === 'POST') {
        const body = await readJson(req);
        const bossName = cleanText(body.bossName, 40);
        let timeValue = normalizeBossCutTime(body.timeValue || formatCommandTimeFromIso(body.cutAt));
        const cutAt = isoFromBossCutInput(body.cutAt, timeValue);
        if (!timeValue && cutAt) timeValue = formatCommandTimeFromIso(cutAt);
        const reporterName = cleanText(body.reporterName, 24);
        const requiresParticipation = Boolean(body.requiresParticipation);
        const participantPasswordHash = hashParticipantPassword(body.participantPassword);

        if (!bossName || !timeValue || !cutAt) {
            sendJson(res, 400, { error: '보스명과 컷 시간을 확인하세요.' });
            return true;
        }

        if (requiresParticipation && !participantPasswordHash) {
            sendJson(res, 400, { error: '참여 확인을 켰으면 참여 비번을 입력하세요.' });
            return true;
        }

        if (!state.members.includes(reporterName)) {
            sendJson(res, 400, { error: '등록된 길드원만 컷을 입력할 수 있습니다.' });
            return true;
        }

        const bosses = await readBosses();
        const boss = bosses.find((item) => item.이름 === bossName || item.애칭 === bossName);
        if (!boss) {
            sendJson(res, 404, { error: '보스 정보를 찾을 수 없습니다.' });
            return true;
        }

        const currentLock = activeBossCutLock(boss.이름);
        if (currentLock && currentLock.memberName !== reporterName) {
            sendJson(res, 409, { error: `${currentLock.memberName} 님이 컷 입력 중입니다.` });
            return true;
        }

        const nextSpawnAt = calcBossNextSpawnAt(boss, cutAt);
        const nowIso = new Date().toISOString();
        const timeUncertain = boss.타입 === '시간' && Boolean(body.timeUncertain);
        const participationOpenUntil = requiresParticipation && participantPasswordHash
            ? new Date(Date.now() + BOSS_PARTICIPATION_WINDOW_MS).toISOString()
            : null;
        const participants = requiresParticipation
            ? [{
                memberName: reporterName,
                confirmedAt: nowIso,
                method: 'reporter'
            }]
            : [];
        const record = {
            id: randomUUID(),
            bossName: boss.이름,
            bossAlias: boss.애칭 || '',
            bossType: boss.타입 || '',
            location: boss.위치 || '',
            timeValue,
            cutAt,
            nextSpawnAt,
            reporterName,
            updatedAt: nowIso,
            status: 'active',
            timeUncertain,
            requiresParticipation,
            participantPasswordHash,
            participationOpenUntil,
            participants,
            participantProofs: []
        };

        state.bossCuts = state.bossCuts || {};
        state.bossCutRecords = state.bossCutRecords || [];
        state.bossCutRecords.unshift(record);
        state.bossCutRecords = state.bossCutRecords.slice(0, MAX_BOSS_CUT_RECORDS);
        refreshCurrentBossCut(boss.이름);

        releaseBossCutLock(boss.이름, reporterName);
        appendBossAuditLog('cut-create', {
            bossName: boss.이름,
            recordId: record.id,
            actorName: reporterName,
            detail: {
                timeValue,
                cutAt,
                nextSpawnAt,
                timeUncertain,
                requiresParticipation,
                hasParticipantPassword: Boolean(participantPasswordHash)
            }
        });

        await saveState();
        sendJson(res, 200, {
            cuts: publicBossCuts(),
            records: publicBossCutRecords(),
            bossParticipationWindowMin: BOSS_PARTICIPATION_WINDOW_MIN
        });
        return true;
    }

    if (url.pathname === '/api/boss-cuts/record' && req.method === 'PATCH') {
        const body = await readJson(req);
        const recordId = cleanText(body.recordId, 80);
        const actorName = cleanText(body.actorName, 24);
        let timeValue = normalizeBossCutTime(body.timeValue || formatCommandTimeFromIso(body.cutAt));
        const cutAt = isoFromBossCutInput(body.cutAt, timeValue);
        if (!timeValue && cutAt) timeValue = formatCommandTimeFromIso(cutAt);

        if (!state.members.includes(actorName)) {
            sendJson(res, 400, { error: '등록된 길드원만 컷 기록을 수정할 수 있습니다.' });
            return true;
        }

        if (!recordId || !timeValue || !cutAt) {
            sendJson(res, 400, { error: '수정할 컷 날짜와 시간을 확인하세요.' });
            return true;
        }

        const record = (state.bossCutRecords || []).find((item) => item.id === recordId);
        if (!record) {
            sendJson(res, 404, { error: '컷 기록을 찾을 수 없습니다.' });
            return true;
        }

        if (record.status === 'canceled') {
            sendJson(res, 409, { error: '취소된 컷 기록은 수정할 수 없습니다.' });
            return true;
        }

        const bosses = await readBosses();
        const boss = bosses.find((item) => item.이름 === record.bossName || item.애칭 === record.bossName);
        const isTemporaryRecord = Boolean(record.temporary) || record.bossType === '임시';
        if (!boss && !isTemporaryRecord) {
            sendJson(res, 404, { error: '보스 정보를 찾을 수 없습니다.' });
            return true;
        }

        const nowIso = new Date().toISOString();
        const timeUncertain = boss?.타입 === '시간' && Boolean(body.timeUncertain);
        const previous = {
            timeValue: record.timeValue,
            cutAt: record.cutAt,
            nextSpawnAt: record.nextSpawnAt || null,
            timeUncertain: Boolean(record.timeUncertain)
        };
        record.timeValue = timeValue;
        record.cutAt = cutAt;
        record.nextSpawnAt = boss ? calcBossNextSpawnAt(boss, cutAt) : null;
        record.updatedAt = nowIso;
        record.editedBy = actorName;
        record.timeUncertain = timeUncertain;
        state.bossCutRecords = [record, ...(state.bossCutRecords || []).filter((item) => item.id !== record.id)]
            .slice(0, MAX_BOSS_CUT_RECORDS);

        if (boss) refreshCurrentBossCut(record.bossName);
        appendBossAuditLog('cut-update', {
            bossName: record.bossName,
            recordId: record.id,
            actorName,
            detail: {
                previous,
                next: {
                    timeValue: record.timeValue,
                    cutAt: record.cutAt,
                    nextSpawnAt: record.nextSpawnAt || null,
                    timeUncertain: Boolean(record.timeUncertain)
                }
            }
        });

        await saveState();
        sendJson(res, 200, { cuts: publicBossCuts(), records: publicBossCutRecords() });
        return true;
    }

    if (url.pathname === '/api/boss-cuts/record' && req.method === 'DELETE') {
        const body = await readJson(req);
        const recordId = cleanText(body.recordId || url.searchParams.get('recordId'), 80);
        const actorName = cleanText(body.actorName || url.searchParams.get('actorName'), 24);
        const cancelReason = cleanText(body.cancelReason || url.searchParams.get('cancelReason'), 80);

        if (!state.members.includes(actorName)) {
            sendJson(res, 400, { error: '등록된 길드원만 컷 기록을 취소할 수 있습니다.' });
            return true;
        }

        const record = (state.bossCutRecords || []).find((item) => item.id === recordId);
        if (!record) {
            sendJson(res, 404, { error: '컷 기록을 찾을 수 없습니다.' });
            return true;
        }

        if (record.status === 'canceled') {
            sendJson(res, 409, { error: '이미 취소된 컷 기록입니다.' });
            return true;
        }

        const nowIso = new Date().toISOString();
        record.status = 'canceled';
        record.canceledAt = nowIso;
        record.canceledBy = actorName;
        record.cancelReason = cancelReason;
        record.updatedAt = nowIso;
        record.participationOpenUntil = null;
        state.bossCutRecords = [record, ...(state.bossCutRecords || []).filter((item) => item.id !== record.id)]
            .slice(0, MAX_BOSS_CUT_RECORDS);
        refreshCurrentBossCut(record.bossName);
        appendBossAuditLog('cut-cancel', {
            bossName: record.bossName,
            recordId: record.id,
            actorName,
            detail: {
                timeValue: record.timeValue,
                cutAt: record.cutAt,
                nextSpawnAt: record.nextSpawnAt || null,
                participants: Array.isArray(record.participants) ? record.participants.length : 0,
                reason: cancelReason
            }
        });

        await saveState();
        sendJson(res, 200, { cuts: publicBossCuts(), records: publicBossCutRecords() });
        return true;
    }

    if (url.pathname === '/api/boss-cuts' && req.method === 'DELETE') {
        const body = await readJson(req);
        const bossName = cleanText(body.bossName || url.searchParams.get('bossName'), 40);
        const actorName = cleanText(body.actorName || url.searchParams.get('actorName'), 24);
        const cancelReason = cleanText(body.cancelReason || url.searchParams.get('cancelReason'), 80);
        if (!bossName) {
            sendJson(res, 400, { error: '보스명을 확인하세요.' });
            return true;
        }

        if (!state.members.includes(actorName)) {
            sendJson(res, 400, { error: '등록된 길드원만 컷 기록을 취소할 수 있습니다.' });
            return true;
        }

        const record = latestActiveBossRecord(bossName);
        if (record) {
            const nowIso = new Date().toISOString();
            record.status = 'canceled';
            record.canceledAt = nowIso;
            record.canceledBy = actorName;
            record.cancelReason = cancelReason;
            record.updatedAt = nowIso;
            record.participationOpenUntil = null;
            state.bossCutRecords = [record, ...(state.bossCutRecords || []).filter((item) => item.id !== record.id)]
                .slice(0, MAX_BOSS_CUT_RECORDS);
            appendBossAuditLog('cut-cancel', {
                bossName: record.bossName,
                recordId: record.id,
                actorName,
                detail: {
                    timeValue: record.timeValue,
                    cutAt: record.cutAt,
                    nextSpawnAt: record.nextSpawnAt || null,
                    participants: Array.isArray(record.participants) ? record.participants.length : 0,
                    reason: cancelReason
                }
            });
        }
        refreshCurrentBossCut(bossName);
        await saveState();
        sendJson(res, 200, { cuts: publicBossCuts(), records: publicBossCutRecords() });
        return true;
    }

    if (url.pathname === '/api/boss-cuts/participation-window' && req.method === 'POST') {
        const body = await readJson(req);
        const recordId = cleanText(body.recordId, 80);
        const actorName = cleanText(body.actorName, 24);
        const adminPassword = body.adminPassword;
        const minutesInput = Number(body.minutes || 30);
        const minutes = Number.isFinite(minutesInput) ? Math.max(1, Math.min(180, Math.round(minutesInput))) : 30;

        if (!state.members.includes(actorName)) {
            sendJson(res, 400, { error: '등록된 길드원만 참여 입력 시간을 연장할 수 있습니다.' });
            return true;
        }

        const record = (state.bossCutRecords || []).find((item) => item.id === recordId);
        if (!record) {
            sendJson(res, 404, { error: '컷 기록을 찾을 수 없습니다.' });
            return true;
        }

        if (record.status === 'canceled' || !record.requiresParticipation) {
            sendJson(res, 409, { error: '참여 입력을 연장할 수 없는 기록입니다.' });
            return true;
        }

        const isReporter = record.reporterName === actorName;
        const adminOk = Boolean(adminPassword) && verifyAdminPassword(adminPassword);
        if (!isReporter && !adminOk) {
            sendJson(res, 403, { error: '컷 입력자 또는 관리자만 참여 입력 시간을 연장할 수 있습니다.' });
            return true;
        }

        const previous = record.participationOpenUntil || null;
        const currentMs = new Date(previous || 0).getTime();
        const baseMs = Math.max(Date.now(), Number.isFinite(currentMs) ? currentMs : 0);
        record.participationOpenUntil = new Date(baseMs + minutes * 60 * 1000).toISOString();
        record.updatedAt = new Date().toISOString();
        syncBossCutRecordState(record);
        appendBossAuditLog('participation-window-extend', {
            bossName: record.bossName,
            recordId: record.id,
            actorName,
            detail: {
                previous,
                participationOpenUntil: record.participationOpenUntil,
                minutes
            }
        });

        await saveState();
        sendJson(res, 200, { cuts: publicBossCuts(), records: publicBossCutRecords() });
        return true;
    }

    if (url.pathname === '/api/boss-cuts/participants' && req.method === 'POST') {
        const body = await readJson(req);
        const recordId = cleanText(body.recordId, 80);
        const memberName = cleanText(body.memberName, 24);
        const passwordHash = hashParticipantPassword(body.password);

        if (!state.members.includes(memberName)) {
            sendJson(res, 400, { error: '등록된 길드원만 참여 확인할 수 있습니다.' });
            return true;
        }

        const record = (state.bossCutRecords || []).find((item) => item.id === recordId);
        if (!record) {
            sendJson(res, 404, { error: '컷 기록을 찾을 수 없습니다.' });
            return true;
        }

        if (record.status === 'canceled') {
            sendJson(res, 409, { error: '취소된 컷 기록에는 참여 확인할 수 없습니다.' });
            return true;
        }

        if (!record.requiresParticipation) {
            sendJson(res, 400, { error: '참여 확인이 필요 없는 보스입니다.' });
            return true;
        }

        if (!record.participantPasswordHash) {
            sendJson(res, 400, { error: '참여 비번이 없어 관리자 추가만 가능합니다.' });
            return true;
        }

        const openUntilMs = record.participationOpenUntil ? new Date(record.participationOpenUntil).getTime() : 0;
        if (!Number.isFinite(openUntilMs) || openUntilMs <= Date.now()) {
            sendJson(res, 409, { error: '참여 확인 시간이 지났습니다. 관리자 추가만 가능합니다.' });
            return true;
        }

        if (!passwordHash || passwordHash !== record.participantPasswordHash) {
            sendJson(res, 403, { error: '참여 비번이 맞지 않습니다.' });
            return true;
        }

        record.participants = Array.isArray(record.participants) ? record.participants : [];
        if (!record.participants.some((item) => item.memberName === memberName)) {
            record.participants.push({
                memberName,
                confirmedAt: new Date().toISOString(),
                method: 'password'
            });
            appendBossAuditLog('participant-add', {
                bossName: record.bossName,
                recordId: record.id,
                actorName: memberName,
                detail: {
                    participantName: memberName,
                    timeValue: record.timeValue,
                    cutAt: record.cutAt
                }
            });
        }

        syncBossCutRecordState(record);

        await saveState();
        sendJson(res, 200, { cuts: publicBossCuts(), records: publicBossCutRecords() });
        return true;
    }

    if (url.pathname === '/api/boss-cuts/participants/photo' && req.method === 'POST') {
        const body = await readJson(req);
        const recordId = cleanText(body.recordId, 80);
        const memberName = cleanText(body.memberName, 24);
        const originalName = cleanText(body.fileName, 120);

        if (!state.members.includes(memberName)) {
            sendJson(res, 400, { error: '등록된 길드원만 사진 인증을 올릴 수 있습니다.' });
            return true;
        }

        const record = (state.bossCutRecords || []).find((item) => item.id === recordId);
        if (!record) {
            sendJson(res, 404, { error: '컷 기록을 찾을 수 없습니다.' });
            return true;
        }

        if (record.status === 'canceled') {
            sendJson(res, 409, { error: '취소된 컷 기록에는 사진 인증을 올릴 수 없습니다.' });
            return true;
        }

        if (!record.requiresParticipation) {
            sendJson(res, 400, { error: '참여 확인이 필요한 보스 기록이 아닙니다.' });
            return true;
        }

        const openUntilMs = record.participationOpenUntil ? new Date(record.participationOpenUntil).getTime() : 0;
        if (!Number.isFinite(openUntilMs) || openUntilMs <= Date.now()) {
            sendJson(res, 409, { error: '참여 입력 시간이 지났습니다. 관리자 수동 추가만 가능합니다.' });
            return true;
        }

        record.participants = Array.isArray(record.participants) ? record.participants : [];
        if (record.participants.some((item) => item.memberName === memberName)) {
            sendJson(res, 409, { error: '이미 참여 확인된 길드원입니다.' });
            return true;
        }

        record.participantProofs = Array.isArray(record.participantProofs) ? record.participantProofs : [];
        const hasPendingProof = record.participantProofs.some((proof) => (
            proof.memberName === memberName
            && proof.status === 'pending'
            && new Date(proof.expiresAt || '').getTime() > Date.now()
        ));
        if (hasPendingProof) {
            sendJson(res, 409, { error: '이미 확인 대기 중인 사진 인증이 있습니다.' });
            return true;
        }

        let stored;
        try {
            stored = await storePhotoProof(body.imageData);
        } catch (err) {
            sendJson(res, err.statusCode || 400, { error: err.message || '사진 인증을 저장하지 못했습니다.' });
            return true;
        }

        const nowIso = new Date().toISOString();
        const proof = {
            id: stored.id,
            memberName,
            uploadedAt: nowIso,
            expiresAt: new Date(Date.now() + PHOTO_PROOF_TTL_MS).toISOString(),
            status: 'pending',
            fileName: stored.fileName,
            originalName,
            mimeType: stored.mimeType,
            size: stored.size,
            reviewedAt: null,
            reviewedBy: ''
        };
        record.participantProofs.unshift(proof);
        syncBossCutRecordState(record);
        appendBossAuditLog('participant-photo-submit', {
            bossName: record.bossName,
            recordId: record.id,
            actorName: memberName,
            detail: {
                proofId: proof.id,
                timeValue: record.timeValue,
                cutAt: record.cutAt,
                size: proof.size
            }
        });

        await saveState();
        const records = publicBossCutRecords();
        sendJson(res, 200, {
            cuts: publicBossCuts(),
            records,
            proof: records.find((item) => item.id === record.id)?.participantProofs?.find((item) => item.id === proof.id) || null
        });
        return true;
    }

    if (url.pathname === '/api/boss-cuts/participants/photo/resolve' && req.method === 'POST') {
        const body = await readJson(req);
        const recordId = cleanText(body.recordId, 80);
        const proofId = cleanText(body.proofId, 80);
        const actorName = cleanText(body.actorName, 24);
        const decision = cleanText(body.decision, 16);
        const adminPassword = body.adminPassword;

        if (!verifyAdminPassword(adminPassword)) {
            sendJson(res, 403, { error: '관리자 비밀번호가 맞지 않습니다.' });
            return true;
        }

        if (!state.members.includes(actorName)) {
            sendJson(res, 400, { error: '작업자 닉네임을 먼저 선택하세요.' });
            return true;
        }

        if (!['approve', 'reject'].includes(decision)) {
            sendJson(res, 400, { error: '사진 인증 처리 방식을 확인하세요.' });
            return true;
        }

        const record = (state.bossCutRecords || []).find((item) => item.id === recordId);
        if (!record) {
            sendJson(res, 404, { error: '컷 기록을 찾을 수 없습니다.' });
            return true;
        }

        const proof = (record.participantProofs || []).find((item) => item.id === proofId);
        if (!proof) {
            sendJson(res, 404, { error: '사진 인증 요청을 찾을 수 없습니다.' });
            return true;
        }

        if (proof.status !== 'pending') {
            sendJson(res, 409, { error: '이미 처리된 사진 인증입니다.' });
            return true;
        }

        const nowIso = new Date().toISOString();
        proof.status = decision === 'approve' ? 'approved' : 'rejected';
        proof.reviewedAt = nowIso;
        proof.reviewedBy = actorName;

        record.participants = Array.isArray(record.participants) ? record.participants : [];
        if (decision === 'approve' && !record.participants.some((item) => item.memberName === proof.memberName)) {
            record.participants.push({
                memberName: proof.memberName,
                confirmedAt: nowIso,
                method: 'photo',
                addedBy: actorName
            });
        }

        syncBossCutRecordState(record);
        appendBossAuditLog(decision === 'approve' ? 'participant-photo-approve' : 'participant-photo-reject', {
            bossName: record.bossName,
            recordId: record.id,
            actorName,
            detail: {
                proofId: proof.id,
                participantName: proof.memberName,
                timeValue: record.timeValue,
                cutAt: record.cutAt
            }
        });

        await saveState();
        sendJson(res, 200, { cuts: publicBossCuts(), records: publicBossCutRecords() });
        return true;
    }

    if (url.pathname === '/api/boss-cuts/participants/photo' && req.method === 'DELETE') {
        const body = await readJson(req);
        const recordId = cleanText(body.recordId || url.searchParams.get('recordId'), 80);
        const proofId = cleanText(body.proofId || url.searchParams.get('proofId'), 80);
        const actorName = cleanText(body.actorName || url.searchParams.get('actorName'), 24);
        const adminPassword = body.adminPassword || url.searchParams.get('adminPassword');

        if (!state.members.includes(actorName)) {
            sendJson(res, 400, { error: '작업자 닉네임을 먼저 선택하세요.' });
            return true;
        }

        const record = (state.bossCutRecords || []).find((item) => item.id === recordId);
        if (!record) {
            sendJson(res, 404, { error: '컷 기록을 찾을 수 없습니다.' });
            return true;
        }

        record.participantProofs = Array.isArray(record.participantProofs) ? record.participantProofs : [];
        const proofIndex = record.participantProofs.findIndex((item) => item.id === proofId);
        const proof = proofIndex >= 0 ? record.participantProofs[proofIndex] : null;
        if (!proof) {
            sendJson(res, 404, { error: '사진 인증 요청을 찾을 수 없습니다.' });
            return true;
        }

        const isOwner = proof.memberName === actorName;
        const isReporter = record.reporterName === actorName;
        const isAdmin = Boolean(adminPassword) && verifyAdminPassword(adminPassword);
        if (!isOwner && !isReporter && !isAdmin) {
            sendJson(res, 403, { error: '사진 인증 요청을 삭제할 권한이 없습니다.' });
            return true;
        }

        const filePath = participantProofFilePath(proof.fileName);
        record.participantProofs.splice(proofIndex, 1);
        syncBossCutRecordState(record);
        if (filePath) fs.unlink(filePath).catch(() => {});

        await saveState();
        sendJson(res, 200, { cuts: publicBossCuts(), records: publicBossCutRecords() });
        return true;
    }

    if (url.pathname === '/api/boss-cuts/participants/admin' && req.method === 'POST') {
        const body = await readJson(req);
        const recordId = cleanText(body.recordId, 80);
        const memberName = cleanText(body.memberName, 24);
        const actorName = cleanText(body.actorName, 24);
        const adminPassword = body.adminPassword;

        if (!verifyAdminPassword(adminPassword)) {
            sendJson(res, 403, { error: '관리자 비밀번호가 맞지 않습니다.' });
            return true;
        }

        if (!state.members.includes(actorName)) {
            sendJson(res, 400, { error: '작업자 닉네임을 먼저 선택하세요.' });
            return true;
        }

        if (!state.members.includes(memberName)) {
            sendJson(res, 400, { error: '등록된 길드원만 추가할 수 있습니다.' });
            return true;
        }

        const record = (state.bossCutRecords || []).find((item) => item.id === recordId);
        if (!record) {
            sendJson(res, 404, { error: '컷 기록을 찾을 수 없습니다.' });
            return true;
        }

        if (record.status === 'canceled') {
            sendJson(res, 409, { error: '취소된 컷 기록에는 참여자를 추가할 수 없습니다.' });
            return true;
        }

        record.participants = Array.isArray(record.participants) ? record.participants : [];
        const alreadyExists = record.participants.some((item) => item.memberName === memberName);
        if (!alreadyExists) {
            record.participants.push({
                memberName,
                confirmedAt: new Date().toISOString(),
                method: 'admin'
            });
            appendBossAuditLog('participant-add', {
                bossName: record.bossName,
                recordId: record.id,
                actorName,
                detail: {
                    participantName: memberName,
                    method: 'admin',
                    timeValue: record.timeValue,
                    cutAt: record.cutAt
                }
            });
        }

        syncBossCutRecordState(record);

        await saveState();
        sendJson(res, 200, { cuts: publicBossCuts(), records: publicBossCutRecords() });
        return true;
    }

    if (url.pathname === '/api/boss-cuts/participants/admin' && req.method === 'DELETE') {
        const body = await readJson(req);
        const recordId = cleanText(body.recordId || url.searchParams.get('recordId'), 80);
        const memberName = cleanText(body.memberName || url.searchParams.get('memberName'), 24);
        const actorName = cleanText(body.actorName || url.searchParams.get('actorName'), 24);
        const adminPassword = body.adminPassword || url.searchParams.get('adminPassword');

        if (!verifyAdminPassword(adminPassword)) {
            sendJson(res, 403, { error: '관리자 비밀번호가 맞지 않습니다.' });
            return true;
        }

        if (!state.members.includes(actorName)) {
            sendJson(res, 400, { error: '작업자 닉네임을 먼저 선택하세요.' });
            return true;
        }

        if (!memberName) {
            sendJson(res, 400, { error: '제거할 참여자를 선택하세요.' });
            return true;
        }

        const record = (state.bossCutRecords || []).find((item) => item.id === recordId);
        if (!record) {
            sendJson(res, 404, { error: '컷 기록을 찾을 수 없습니다.' });
            return true;
        }

        record.participants = Array.isArray(record.participants) ? record.participants : [];
        const beforeCount = record.participants.length;
        record.participants = record.participants.filter((item) => item.memberName !== memberName);

        if (record.participants.length === beforeCount) {
            sendJson(res, 404, { error: '해당 참여자가 기록에 없습니다.' });
            return true;
        }

        syncBossCutRecordState(record);
        appendBossAuditLog('participant-remove', {
            bossName: record.bossName,
            recordId: record.id,
            actorName,
            detail: {
                participantName: memberName,
                timeValue: record.timeValue,
                cutAt: record.cutAt
            }
        });

        await saveState();
        sendJson(res, 200, { cuts: publicBossCuts(), records: publicBossCutRecords() });
        return true;
    }

    if (url.pathname === '/api/members' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidAdmin(res, body.adminPassword)) return true;

        const members = parseMembers(body.members ?? body.raw);
        if (members.length === 0) {
            sendJson(res, 400, { error: '길드원 목록이 비어 있습니다.' });
            return true;
        }
        state.members = members;
        await saveState();
        sendJson(res, 200, await publicStateWithBosses());
        return true;
    }

    if (url.pathname === '/api/zones' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidAdmin(res, body.adminPassword)) return true;

        const name = cleanText(body.name, 40);
        const cooldownMin = normalizeCooldown(body.cooldownMin);

        if (!name || !cooldownMin) {
            sendJson(res, 400, { error: '구역명과 쿨타임을 확인하세요.' });
            return true;
        }

        state.zones.push({
            id: randomUUID(),
            name,
            cooldownMin,
            cooldownUntil: null,
            lastBy: null,
            lastAt: null,
            reservations: []
        });
        await saveState();
        sendJson(res, 200, await publicStateWithBosses());
        return true;
    }

    if (url.pathname === '/api/admin/bulk' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidAdmin(res, body.adminPassword)) return true;

        const zoneUpdates = Array.isArray(body.zones) ? body.zones : [];
        const hasMembers = Object.prototype.hasOwnProperty.call(body, 'members')
            || Object.prototype.hasOwnProperty.call(body, 'raw');
        const nextMembers = hasMembers ? parseMembers(body.members ?? body.raw) : null;
        const hasBosses = Object.prototype.hasOwnProperty.call(body, 'bosses');
        const nextBosses = hasBosses ? normalizeBosses(body.bosses) : null;
        const zoneOrderIds = Array.isArray(body.zoneOrderIds) ? body.zoneOrderIds.map((id) => String(id)) : null;
        const preparedZones = [];

        if (nextMembers && nextMembers.length === 0) {
            sendJson(res, 400, { error: '길드원 목록이 비어 있습니다.' });
            return true;
        }

        if (hasBosses && nextBosses.length === 0) {
            sendJson(res, 400, { error: '보스 목록을 확인하세요.' });
            return true;
        }

        if (zoneOrderIds) {
            const currentIds = state.zones.map((zone) => zone.id);
            const nextIdSet = new Set(zoneOrderIds);

            if (zoneOrderIds.length !== currentIds.length || nextIdSet.size !== currentIds.length) {
                sendJson(res, 400, { error: '구역 순서 정보를 확인하세요.' });
                return true;
            }

            for (const id of currentIds) {
                if (!nextIdSet.has(id)) {
                    sendJson(res, 400, { error: '구역 순서 정보가 현재 목록과 맞지 않습니다.' });
                    return true;
                }
            }
        }

        for (const item of zoneUpdates) {
            const id = String(item.id || '');
            const zone = state.zones.find((entry) => entry.id === id);
            const name = cleanText(item.name, 40);
            const cooldownMin = normalizeCooldown(item.cooldownMin);

            if (!zone) {
                sendJson(res, 404, { error: '구역을 찾을 수 없습니다.' });
                return true;
            }

            if (!name || !cooldownMin) {
                sendJson(res, 400, { error: '구역명과 쿨타임을 확인하세요.' });
                return true;
            }

            preparedZones.push({ zone, name, cooldownMin });
        }

        for (const item of preparedZones) {
            const oldName = item.zone.name;
            item.zone.name = item.name;
            item.zone.cooldownMin = item.cooldownMin;

            if (oldName !== item.name) {
                for (const log of state.logs) {
                    if (log.zoneId === item.zone.id) log.zoneName = item.name;
                }
            }
        }

        if (zoneOrderIds) {
            const zonesById = new Map(state.zones.map((zone) => [zone.id, zone]));
            state.zones = zoneOrderIds.map((id) => zonesById.get(id));
        }

        if (nextMembers) state.members = nextMembers;
        if (hasBosses) {
            state.bosses = nextBosses;
            await hydrateBossCutState();
        }

        await saveState();
        sendJson(res, 200, await publicStateWithBosses());
        return true;
    }

    if (url.pathname === '/api/reservations' && req.method === 'POST') {
        const body = await readJson(req);
        const zone = state.zones.find((item) => item.id === body.zoneId);
        const memberName = cleanText(body.memberName, 24);

        if (!zone) {
            sendJson(res, 404, { error: '구역을 찾을 수 없습니다.' });
            return true;
        }

        if (!state.members.includes(memberName)) {
            sendJson(res, 400, { error: '등록된 길드원만 예약할 수 있습니다.' });
            return true;
        }

        if (!Array.isArray(zone.reservations)) zone.reservations = [];

        const activeReservation = zone.reservations[0];
        if (activeReservation && activeReservation.memberName !== memberName) {
            sendJson(res, 409, { error: `${activeReservation.memberName} 님이 예약 중입니다.`, state: publicState() });
            return true;
        }

        const now = Date.now();
        const reservedWhileCooldown = Boolean(zone.cooldownUntil && new Date(zone.cooldownUntil).getTime() > now);

        zone.reservations = [{
            id: activeReservation?.id || randomUUID(),
            memberName,
            reservedAt: activeReservation?.reservedAt || new Date().toISOString(),
            expiresAt: reservationExpiresAt(zone, now),
            reservedWhileCooldown: activeReservation?.reservedWhileCooldown ?? reservedWhileCooldown
        }];

        await saveState();
        sendJson(res, 200, await publicStateWithBosses());
        return true;
    }

    if (url.pathname === '/api/reservations' && req.method === 'DELETE') {
        const zoneId = String(url.searchParams.get('zoneId') || '');
        const memberName = cleanText(url.searchParams.get('memberName'), 24);
        const zone = state.zones.find((item) => item.id === zoneId);

        if (!zone) {
            sendJson(res, 404, { error: '구역을 찾을 수 없습니다.' });
            return true;
        }

        zone.reservations = (zone.reservations || []).filter((reservation) => reservation.memberName !== memberName);
        await saveState();
        sendJson(res, 200, publicState());
        return true;
    }

    if (url.pathname === '/api/zones' && (req.method === 'PUT' || req.method === 'PATCH')) {
        const body = await readJson(req);
        if (rejectInvalidAdmin(res, body.adminPassword)) return true;

        const zone = state.zones.find((item) => item.id === body.id);
        const name = cleanText(body.name, 40);
        const cooldownMin = normalizeCooldown(body.cooldownMin);

        if (!zone) {
            sendJson(res, 404, { error: '구역을 찾을 수 없습니다.' });
            return true;
        }

        if (!name || !cooldownMin) {
            sendJson(res, 400, { error: '구역명과 쿨타임을 확인하세요.' });
            return true;
        }

        zone.name = name;
        zone.cooldownMin = cooldownMin;

        for (const log of state.logs) {
            if (log.zoneId === zone.id) log.zoneName = name;
        }

        await saveState();
        sendJson(res, 200, publicState());
        return true;
    }

    if (url.pathname === '/api/zones' && req.method === 'DELETE') {
        const body = await readJson(req).catch(() => ({}));
        if (rejectInvalidAdmin(res, body.adminPassword || url.searchParams.get('adminPassword'))) return true;

        const zoneId = String(url.searchParams.get('id') || '');
        state.zones = state.zones.filter((zone) => zone.id !== zoneId);
        await saveState();
        sendJson(res, 200, await publicStateWithBosses());
        return true;
    }

    if (url.pathname === '/api/zones/reset-state' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidAdmin(res, body.adminPassword)) return true;

        const zone = state.zones.find((item) => item.id === body.zoneId);
        const memberName = cleanText(body.memberName, 24);

        if (!zone) {
            sendJson(res, 404, { error: '구역을 찾을 수 없습니다.' });
            return true;
        }

        if (!state.members.includes(memberName)) {
            sendJson(res, 400, { error: '등록된 길드원만 초기화할 수 있습니다.' });
            return true;
        }

        zone.cooldownUntil = null;
        zone.lastBy = null;
        zone.lastAt = null;
        zone.reservations = [];

        appendEventLog({ action: 'reset-state', zone, memberName });
        await saveState();
        sendJson(res, 200, { ...publicState(), action: 'reset-state' });
        return true;
    }

    if (url.pathname === '/api/zones/cancel-last-check' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidAdmin(res, body.adminPassword)) return true;

        const zone = state.zones.find((item) => item.id === body.zoneId);
        const memberName = cleanText(body.memberName, 24);

        if (!zone) {
            sendJson(res, 404, { error: '구역을 찾을 수 없습니다.' });
            return true;
        }

        if (!state.members.includes(memberName)) {
            sendJson(res, 400, { error: '등록된 길드원만 기록을 취소할 수 있습니다.' });
            return true;
        }

        const logIndex = state.logs.findIndex((log) => log.zoneId === zone.id && isCheckLog(log));
        if (logIndex === -1) {
            sendJson(res, 404, { error: '취소할 완료 기록이 없습니다.' });
            return true;
        }

        const [removedLog] = state.logs.splice(logIndex, 1);
        if (zone.lastAt === removedLog.checkedAt && zone.lastBy === removedLog.memberName) {
            restoreZoneAfterUndo(zone, removedLog);
        }

        appendEventLog({
            action: 'cancel-last-check',
            zone,
            memberName,
            detail: {
                targetMemberName: removedLog.memberName,
                targetCheckedAt: removedLog.checkedAt
            }
        });
        await saveState();
        sendJson(res, 200, { ...publicState(), action: 'cancel-last-check' });
        return true;
    }

    if (url.pathname === '/api/logs/update' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidAdmin(res, body.adminPassword)) return true;

        const logId = String(body.logId || '');
        const memberName = cleanText(body.memberName, 24);
        const actorName = cleanText(body.actorName, 24);
        const log = state.logs.find((item) => item.id === logId && isCheckLog(item));

        if (!log) {
            sendJson(res, 404, { error: '수정할 완료 기록을 찾을 수 없습니다.' });
            return true;
        }

        if (!state.members.includes(actorName)) {
            sendJson(res, 400, { error: '등록된 길드원만 기록을 수정할 수 있습니다.' });
            return true;
        }

        if (!state.members.includes(memberName)) {
            sendJson(res, 400, { error: '수정할 완료자를 확인하세요.' });
            return true;
        }

        const oldMemberName = log.memberName;
        log.memberName = memberName;
        log.checkedBy = memberName;

        const zone = state.zones.find((item) => item.id === log.zoneId);
        if (zone && zone.lastAt === log.checkedAt && zone.lastBy === oldMemberName) {
            zone.lastBy = memberName;
        }

        appendEventLog({
            action: 'edit-log',
            zone: zone || { id: log.zoneId, name: log.zoneName },
            memberName: actorName,
            detail: {
                targetLogId: log.id,
                oldMemberName,
                newMemberName: memberName,
                targetCheckedAt: log.checkedAt
            }
        });
        await saveState();
        sendJson(res, 200, { ...publicState(), action: 'edit-log' });
        return true;
    }

    if (url.pathname === '/api/logs/delete' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidAdmin(res, body.adminPassword)) return true;

        const logId = String(body.logId || '');
        const actorName = cleanText(body.actorName, 24);
        const logIndex = state.logs.findIndex((item) => item.id === logId && isCheckLog(item));

        if (!state.members.includes(actorName)) {
            sendJson(res, 400, { error: '등록된 길드원만 기록을 취소할 수 있습니다.' });
            return true;
        }

        if (logIndex === -1) {
            sendJson(res, 404, { error: '취소할 완료 기록을 찾을 수 없습니다.' });
            return true;
        }

        const [removedLog] = state.logs.splice(logIndex, 1);
        const zone = state.zones.find((item) => item.id === removedLog.zoneId);
        if (zone && zone.lastAt === removedLog.checkedAt && zone.lastBy === removedLog.memberName) {
            restoreZoneAfterUndo(zone, removedLog);
        }

        appendEventLog({
            action: 'delete-log',
            zone: zone || { id: removedLog.zoneId, name: removedLog.zoneName },
            memberName: actorName,
            detail: {
                targetLogId: removedLog.id,
                targetMemberName: removedLog.memberName,
                targetCheckedAt: removedLog.checkedAt
            }
        });
        await saveState();
        sendJson(res, 200, { ...publicState(), action: 'delete-log' });
        return true;
    }

    if (url.pathname === '/api/check' && req.method === 'POST') {
        const body = await readJson(req);
        const zone = state.zones.find((item) => item.id === body.zoneId);
        const memberName = cleanText(body.memberName, 24);
        const now = Date.now();

        if (!zone) {
            sendJson(res, 404, { error: '구역을 찾을 수 없습니다.' });
            return true;
        }

        if (!state.members.includes(memberName)) {
            sendJson(res, 400, { error: '등록된 길드원만 체크할 수 있습니다.' });
            return true;
        }

        const isLocked = Boolean(zone.cooldownUntil && new Date(zone.cooldownUntil).getTime() > now);
        if (isLocked && zone.lastBy === memberName) {
            const logIndex = state.logs.findIndex((log) => {
                return log.zoneId === zone.id
                    && log.memberName === memberName
                    && (!zone.lastAt || log.checkedAt === zone.lastAt);
            });

            if (logIndex === -1) {
                sendJson(res, 409, { error: '되돌릴 완료 기록을 찾을 수 없습니다.', state: publicState() });
                return true;
            }

            const checkedAtMs = new Date(state.logs[logIndex].checkedAt).getTime();
            if (!Number.isFinite(checkedAtMs) || now - checkedAtMs > CHECK_UNDO_GRACE_MS) {
                sendJson(res, 409, { error: '되돌리기는 완료 후 1분 안에만 가능합니다.', state: publicState() });
                return true;
            }

            const [removedLog] = state.logs.splice(logIndex, 1);
            restoreZoneAfterUndo(zone, removedLog);
            await saveState();
            sendJson(res, 200, { ...publicState(), action: 'undo' });
            return true;
        }

        if (isLocked) {
            sendJson(res, 409, { error: '아직 쿨타임 중입니다.', state: publicState() });
            return true;
        }

        const activeReservation = (zone.reservations || [])[0];
        if (activeReservation && activeReservation.memberName !== memberName) {
            sendJson(res, 409, { error: `${activeReservation.memberName} 님이 예약 중입니다.`, state: publicState() });
            return true;
        }

        const checkedAt = new Date(now).toISOString();
        const cooldownUntil = new Date(now + zone.cooldownMin * 60000).toISOString();
        const previousZoneState = snapshotZone(zone);

        zone.cooldownUntil = cooldownUntil;
        zone.lastBy = memberName;
        zone.lastAt = checkedAt;
        zone.reservations = [];
        moveZoneToEnd(zone.id);

        state.logs.unshift({
            id: randomUUID(),
            action: 'check',
            zoneId: zone.id,
            zoneName: zone.name,
            memberName,
            checkedBy: memberName,
            participantCount: 1,
            checkedAt,
            cooldownMin: zone.cooldownMin,
            previousZoneState
        });
        state.logs = state.logs.slice(0, 500);

        await saveState();
        sendJson(res, 200, { ...publicState(), action: 'check' });
        return true;
    }

    return false;
}

async function serveStatic(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const routeAliases = {
        '/gecko': '/gecko.html',
        '/travel': '/travel.html',
        '/receipts': '/travel.html'
    };
    const routePath = routeAliases[url.pathname] || url.pathname;
    const safePath = routePath === '/' ? '/index.html' : decodeURIComponent(routePath);
    const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

    if (!filePath.startsWith(PUBLIC_DIR)) {
        send(res, 403, 'Forbidden');
        return;
    }

    try {
        const data = await fs.readFile(filePath);
        const type = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        send(res, 200, data, type);
    } catch (err) {
        if (err.code === 'ENOENT') send(res, 404, 'Not found');
        else send(res, 500, 'Server error');
    }
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
            const handled = await handleApi(req, res, url);
            if (!handled) sendJson(res, 404, { error: 'Not found' });
            return;
        }

        await serveStatic(req, res);
    } catch (err) {
        console.error(err);
        sendJson(res, 500, { error: 'Server error' });
    }
});

Promise.all([loadState(), loadGeckoState(), loadTravelState()]).then(() => {
    server.listen(PORT, HOST, () => {
        console.log(`Slash check app: http://127.0.0.1:${PORT}`);
    });
}).catch((err) => {
    console.error('[slash-check] startup failed:', err);
    process.exit(1);
});
