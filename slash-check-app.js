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
const LEGACY_BOSS_STATE_FILE = path.join(ROOT, 'local-boss-state.json');

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
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
let geckoState = { geckos: [], updatedAt: null };
const RESERVATION_GRACE_MS = 10 * 60 * 1000;
const CHECK_UNDO_GRACE_MS = 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BOSS_PARTICIPATION_WINDOW_MS = 10 * 60 * 1000;
const BOSS_CUT_LOCK_MS = 90 * 1000;
const MAX_BOSS_CUT_RECORDS = 300;
const MAX_BOSS_AUDIT_LOGS = 500;
const ADMIN_PASSWORD = process.env.SLASH_CHECK_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || (IS_RENDER_RUNTIME ? '' : '1234');
const ADMIN_PASSWORD_CONFIGURED = Boolean(ADMIN_PASSWORD);
let saveStateQueue = Promise.resolve();
let saveGeckoStateQueue = Promise.resolve();

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
    return ['보유', '분양', '예약', '폐사', '브리딩'].includes(text) ? text : '보유';
}

function normalizeGeckoSex(value) {
    const text = cleanText(value, 16);
    if (['수', '수컷', 'male', 'M'].includes(text)) return '수';
    if (['암', '암컷', 'female', 'F'].includes(text)) return '암';
    return '미확인';
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
        createdAt: existing?.createdAt || nowIso,
        updatedAt: existing?.updatedAt || nowIso
    };
}

function geckoCompare(a, b) {
    return String(a.number || '').localeCompare(String(b.number || ''), 'ko', { numeric: true })
        || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
}

function publicGeckoState() {
    return {
        now: new Date().toISOString(),
        updatedAt: geckoState.updatedAt || null,
        count: geckoState.geckos.length,
        geckos: [...geckoState.geckos].sort(geckoCompare)
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
        participants: Array.isArray(value.participants)
            ? value.participants.map(normalizeBossParticipant).filter(Boolean)
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
        participants: Array.isArray(value.participants) ? value.participants : []
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
        participants: Array.isArray(record.participants) ? record.participants : []
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
        participants: Array.isArray(record.participants) ? record.participants : []
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
                participants: cut.participants
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
            if (body.length > 5000000) {
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
            updatedAt: parsed.updatedAt || null
        };
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('[gecko] state load failed:', err);
        geckoState = { geckos: [], updatedAt: null };
        await saveGeckoState();
    }
}

async function saveGeckoState() {
    geckoState.updatedAt = new Date().toISOString();
    const snapshot = JSON.stringify(geckoState, null, 2);
    const targetDir = path.dirname(GECKO_STATE_FILE);
    const tempFile = path.join(targetDir, `.gecko-state.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);

    saveGeckoStateQueue = saveGeckoStateQueue.catch(() => {}).then(async () => {
        await fs.mkdir(targetDir, { recursive: true });
        await fs.writeFile(tempFile, snapshot, 'utf8');
        await fs.rename(tempFile, GECKO_STATE_FILE);
    });

    return saveGeckoStateQueue;
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
    return {
        now: new Date().toISOString(),
        members: state.members,
        zones: state.zones,
        rankings: buildRankings(),
        logs: state.logs.slice(0, 500),
        bossCuts: publicBossCuts(),
        bossCutRecords: publicBossCutRecords(),
        bossCutLocks: publicBossCutLocks()
    };
}

async function publicStateWithBosses() {
    return {
        ...publicState(),
        bosses: await readBosses()
    };
}

async function handleApi(req, res, url) {
    if (cleanupExpiredReservations() || cleanupExpiredBossCutLocks()) await saveState();

    if (url.pathname === '/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, now: new Date().toISOString() });
        return true;
    }

    if (url.pathname === '/api/geckos' && req.method === 'GET') {
        sendJson(res, 200, publicGeckoState());
        return true;
    }

    if (url.pathname === '/api/geckos' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidAdmin(res, body.adminPassword)) return true;
        const input = body.gecko || body;
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
        if (existing) {
            geckoState.geckos = geckoState.geckos.map((item) => item.id === existing.id ? gecko : item);
        } else {
            geckoState.geckos.push(gecko);
        }
        await saveGeckoState();
        sendJson(res, 200, { ...publicGeckoState(), saved: gecko });
        return true;
    }

    if (url.pathname === '/api/geckos/import' && req.method === 'POST') {
        const body = await readJson(req);
        if (rejectInvalidAdmin(res, body.adminPassword)) return true;
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
            if (existing) {
                geckoState.geckos = geckoState.geckos.map((item) => item.id === existing.id ? gecko : item);
                updated += 1;
            } else if (!geckoState.geckos.some((item) => item.number === gecko.number)) {
                geckoState.geckos.push(gecko);
                added += 1;
            }
        }
        await saveGeckoState();
        sendJson(res, 200, { ...publicGeckoState(), added, updated });
        return true;
    }

    if (url.pathname === '/api/geckos' && req.method === 'DELETE') {
        const body = await readJson(req).catch(() => ({}));
        const adminPassword = body.adminPassword || url.searchParams.get('adminPassword');
        if (rejectInvalidAdmin(res, adminPassword)) return true;
        const id = cleanText(body.id || url.searchParams.get('id'), 80);
        const before = geckoState.geckos.length;
        geckoState.geckos = geckoState.geckos.filter((item) => item.id !== id);
        if (geckoState.geckos.length === before) {
            sendJson(res, 404, { error: '삭제할 개체를 찾을 수 없습니다.' });
            return true;
        }
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
            participants: []
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
        sendJson(res, 200, { cuts: publicBossCuts(), records: publicBossCutRecords() });
        return true;
    }

    if (url.pathname === '/api/boss-cuts/record' && req.method === 'PATCH') {
        const body = await readJson(req);
        const recordId = cleanText(body.recordId, 80);
        const actorName = cleanText(body.actorName, 24);
        const adminPassword = body.adminPassword;
        let timeValue = normalizeBossCutTime(body.timeValue || formatCommandTimeFromIso(body.cutAt));
        const cutAt = isoFromBossCutInput(body.cutAt, timeValue);
        if (!timeValue && cutAt) timeValue = formatCommandTimeFromIso(cutAt);

        if (!state.members.includes(actorName)) {
            sendJson(res, 400, { error: '등록된 길드원만 컷 기록을 수정할 수 있습니다.' });
            return true;
        }

        if (!verifyAdminPassword(adminPassword)) {
            sendJson(res, 403, { error: '관리자 비밀번호가 맞지 않습니다.' });
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
        if (!boss) {
            sendJson(res, 404, { error: '보스 정보를 찾을 수 없습니다.' });
            return true;
        }

        const nowIso = new Date().toISOString();
        const timeUncertain = boss.타입 === '시간' && Boolean(body.timeUncertain);
        const previous = {
            timeValue: record.timeValue,
            cutAt: record.cutAt,
            nextSpawnAt: record.nextSpawnAt || null,
            timeUncertain: Boolean(record.timeUncertain)
        };
        record.timeValue = timeValue;
        record.cutAt = cutAt;
        record.nextSpawnAt = calcBossNextSpawnAt(boss, cutAt);
        record.updatedAt = nowIso;
        record.editedBy = actorName;
        record.timeUncertain = timeUncertain;
        state.bossCutRecords = [record, ...(state.bossCutRecords || []).filter((item) => item.id !== record.id)]
            .slice(0, MAX_BOSS_CUT_RECORDS);

        refreshCurrentBossCut(record.bossName);
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

        const cut = state.bossCuts?.[record.bossName];
        if (cut && cut.recordId === record.id) cut.participants = record.participants;

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

        const cut = state.bossCuts?.[record.bossName];
        if (cut && cut.recordId === record.id) cut.participants = record.participants;

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
    const safePath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
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

Promise.all([loadState(), loadGeckoState()]).then(() => {
    server.listen(PORT, HOST, () => {
        console.log(`Slash check app: http://127.0.0.1:${PORT}`);
    });
}).catch((err) => {
    console.error('[slash-check] startup failed:', err);
    process.exit(1);
});
