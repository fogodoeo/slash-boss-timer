const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { createHash, randomUUID } = require('crypto');

const PORT = Number(process.env.PORT || process.env.SLASH_CHECK_PORT || process.argv[2] || 3101);
const HOST = process.env.SLASH_CHECK_HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'slash-check-app');
const STATE_DIR = process.env.SLASH_CHECK_STATE_DIR || process.env.STATE_DIR || ROOT;
const STATE_FILE = process.env.SLASH_CHECK_STATE_FILE || path.join(STATE_DIR, 'slash-check-state.json');
const LEGACY_BOSS_STATE_FILE = path.join(ROOT, 'local-boss-state.json');

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
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
    bossAuditLogs: []
};

let state = structuredClone(defaultState);
const RESERVATION_GRACE_MS = 10 * 60 * 1000;
const CHECK_UNDO_GRACE_MS = 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BOSS_PARTICIPATION_WINDOW_MS = 10 * 60 * 1000;
const BOSS_CUT_LOCK_MS = 90 * 1000;
const MAX_BOSS_CUT_RECORDS = 300;
const MAX_BOSS_AUDIT_LOGS = 500;
const ADMIN_PASSWORD = process.env.SLASH_CHECK_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '1234';

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

function normalizeCooldown(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.max(1, Math.min(1440, Math.round(num)));
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

function applyDawnDelay(ms) {
    const date = kstDate(ms);
    const hour = date.getUTCHours();
    if (hour < 2 || hour >= 7) return ms;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 7, 0, 0) - KST_OFFSET_MS;
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

function calcBossNextSpawnAt(boss, cutAtIso) {
    const cutMs = new Date(cutAtIso).getTime();
    if (!Number.isFinite(cutMs)) return null;

    if (boss?.타입 === '시간') {
        const cooldownHours = Number(boss.쿨타임);
        if (!Number.isFinite(cooldownHours)) return null;
        return new Date(applyDawnDelay(cutMs + cooldownHours * 60 * 60 * 1000)).toISOString();
    }

    if (boss?.타입 === '고정') return fixedBossNextSpawnAt(boss, cutMs);
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
        editedBy: cleanText(value.editedBy, 24),
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
        editedBy: record.editedBy || '',
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
        requiresParticipation: Boolean(record.requiresParticipation),
        participantPasswordHash: record.participantPasswordHash || '',
        participationOpenUntil: record.participationOpenUntil || null,
        participants: Array.isArray(record.participants) ? record.participants : []
    };
}

function refreshCurrentBossCut(bossName) {
    state.bossCuts = state.bossCuts || {};
    const latest = (state.bossCutRecords || []).find((record) => record.bossName === bossName && record.status !== 'canceled');
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

function verifyAdminPassword(value) {
    return String(value || '') === ADMIN_PASSWORD;
}

function isCheckLog(log) {
    return !log.action || log.action === 'check';
}

async function readBosses() {
    const raw = await fs.readFile(path.join(ROOT, 'bosses.json'), 'utf8');
    return JSON.parse(raw);
}

async function hydrateBossCutState() {
    const bosses = await readBosses().catch(() => []);
    const records = state.bossCutRecords || [];
    state.bossCuts = state.bossCuts || {};

    for (const [bossName, cut] of Object.entries(state.bossCuts)) {
        const boss = bosses.find((item) => item.이름 === bossName || item.애칭 === bossName);
        if (!boss || !cut?.timeValue) continue;

        if (!cut.cutAt) {
            const baseMs = new Date(cut.updatedAt).getTime();
            cut.cutAt = isoFromCommandTime(cut.timeValue, Number.isFinite(baseMs) ? baseMs : Date.now());
        }

        if (!cut.nextSpawnAt) cut.nextSpawnAt = calcBossNextSpawnAt(boss, cut.cutAt);
        if (!Array.isArray(cut.participants)) cut.participants = [];
        cut.requiresParticipation = Boolean(cut.requiresParticipation);
        cut.participantPasswordHash = cleanText(cut.participantPasswordHash, 128);
        cut.participationOpenUntil = cut.participationOpenUntil || null;

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
                requiresParticipation: cut.requiresParticipation,
                participantPasswordHash: cut.participantPasswordHash,
                participationOpenUntil: cut.participationOpenUntil,
                participants: cut.participants
            });

            if (record) {
                cut.recordId = record.id;
                records.unshift(record);
            }
        }
    }

    state.bossCutRecords = records
        .map(normalizeBossCutRecord)
        .filter(Boolean)
        .sort((a, b) => new Date(b.updatedAt || b.cutAt) - new Date(a.updatedAt || a.cutAt))
        .slice(0, MAX_BOSS_CUT_RECORDS);

    const bossNames = new Set([
        ...Object.keys(state.bossCuts || {}),
        ...state.bossCutRecords.map((record) => record.bossName)
    ]);
    for (const bossName of bossNames) refreshCurrentBossCut(bossName);
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
        reservations: Array.isArray(zone.reservations) ? structuredClone(zone.reservations) : []
    };
}

function restoreZoneAfterUndo(zone, removedLog) {
    const previous = removedLog?.previousZoneState;
    if (previous && typeof previous === 'object') {
        zone.cooldownUntil = previous.cooldownUntil || null;
        zone.lastBy = previous.lastBy || null;
        zone.lastAt = previous.lastAt || null;
        zone.reservations = Array.isArray(previous.reservations) ? previous.reservations : [];
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
            if (body.length > 200000) {
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

async function loadState() {
    try {
        const raw = await fs.readFile(STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        const legacyCuts = parsed.bossCuts ? null : await readLegacyBossCuts();
        state = {
            members: Array.isArray(parsed.members) ? parseMembers(parsed.members) : defaultState.members,
            zones: Array.isArray(parsed.zones) ? parsed.zones : defaultState.zones,
            logs: Array.isArray(parsed.logs) ? parsed.logs : [],
            bossCuts: normalizeBossCuts(parsed.bossCuts || legacyCuts),
            bossCutRecords: normalizeBossCutRecords(parsed.bossCutRecords),
            bossCutLocks: normalizeBossCutLocks(parsed.bossCutLocks),
            bossAuditLogs: normalizeBossAuditLogs(parsed.bossAuditLogs)
        };
        state.zones = state.zones.map((zone) => ({
            ...zone,
            reservations: Array.isArray(zone.reservations) ? zone.reservations : []
        }));
        await hydrateBossCutState();
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('[slash-check] state load failed:', err);
        state = structuredClone(defaultState);
        state.bossCuts = await readLegacyBossCuts();
        state.bossCutRecords = [];
        state.bossCutLocks = {};
        state.bossAuditLogs = [];
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
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
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

async function handleApi(req, res, url) {
    if (cleanupExpiredReservations() || cleanupExpiredBossCutLocks()) await saveState();

    if (url.pathname === '/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, now: new Date().toISOString() });
        return true;
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
        sendJson(res, 200, publicState());
        return true;
    }

    if (url.pathname === '/api/bosses' && req.method === 'GET') {
        sendJson(res, 200, await readBosses());
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
            requiresParticipation,
            participantPasswordHash,
            participationOpenUntil,
            participants: []
        };

        state.bossCuts = state.bossCuts || {};
        state.bossCutRecords = state.bossCutRecords || [];
        state.bossCutRecords.unshift(record);
        state.bossCutRecords = state.bossCutRecords.slice(0, MAX_BOSS_CUT_RECORDS);
        state.bossCuts[boss.이름] = {
            recordId: record.id,
            timeValue,
            cutAt,
            nextSpawnAt,
            reporterName,
            updatedAt: nowIso,
            status: 'active',
            requiresParticipation,
            participantPasswordHash,
            participationOpenUntil,
            participants: []
        };

        releaseBossCutLock(boss.이름, reporterName);
        appendBossAuditLog('cut-create', {
            bossName: boss.이름,
            recordId: record.id,
            actorName: reporterName,
            detail: {
                timeValue,
                cutAt,
                nextSpawnAt,
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
        const previous = {
            timeValue: record.timeValue,
            cutAt: record.cutAt,
            nextSpawnAt: record.nextSpawnAt || null
        };
        record.timeValue = timeValue;
        record.cutAt = cutAt;
        record.nextSpawnAt = calcBossNextSpawnAt(boss, cutAt);
        record.updatedAt = nowIso;
        record.editedBy = actorName;
        state.bossCutRecords = [record, ...(state.bossCutRecords || []).filter((item) => item.id !== record.id)]
            .slice(0, MAX_BOSS_CUT_RECORDS);

        const cut = state.bossCuts?.[record.bossName];
        if (cut && cut.recordId === record.id) state.bossCuts[record.bossName] = bossCutStateFromRecord(record);
        appendBossAuditLog('cut-update', {
            bossName: record.bossName,
            recordId: record.id,
            actorName,
            detail: {
                previous,
                next: {
                    timeValue: record.timeValue,
                    cutAt: record.cutAt,
                    nextSpawnAt: record.nextSpawnAt || null
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
                participants: Array.isArray(record.participants) ? record.participants.length : 0
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
        if (!bossName) {
            sendJson(res, 400, { error: '보스명을 확인하세요.' });
            return true;
        }

        if (!state.members.includes(actorName)) {
            sendJson(res, 400, { error: '등록된 길드원만 컷 기록을 취소할 수 있습니다.' });
            return true;
        }

        const record = (state.bossCutRecords || []).find((item) => item.bossName === bossName && item.status !== 'canceled');
        if (record) {
            const nowIso = new Date().toISOString();
            record.status = 'canceled';
            record.canceledAt = nowIso;
            record.canceledBy = actorName;
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
                    participants: Array.isArray(record.participants) ? record.participants.length : 0
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

    if (url.pathname === '/api/members' && req.method === 'POST') {
        const body = await readJson(req);
        const members = parseMembers(body.members ?? body.raw);
        if (members.length === 0) {
            sendJson(res, 400, { error: '길드원 목록이 비어 있습니다.' });
            return true;
        }
        state.members = members;
        await saveState();
        sendJson(res, 200, publicState());
        return true;
    }

    if (url.pathname === '/api/zones' && req.method === 'POST') {
        const body = await readJson(req);
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
        sendJson(res, 200, publicState());
        return true;
    }

    if (url.pathname === '/api/admin/bulk' && req.method === 'POST') {
        const body = await readJson(req);
        const zoneUpdates = Array.isArray(body.zones) ? body.zones : [];
        const hasMembers = Object.prototype.hasOwnProperty.call(body, 'members')
            || Object.prototype.hasOwnProperty.call(body, 'raw');
        const nextMembers = hasMembers ? parseMembers(body.members ?? body.raw) : null;
        const zoneOrderIds = Array.isArray(body.zoneOrderIds) ? body.zoneOrderIds.map((id) => String(id)) : null;
        const preparedZones = [];

        if (nextMembers && nextMembers.length === 0) {
            sendJson(res, 400, { error: '길드원 목록이 비어 있습니다.' });
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

        await saveState();
        sendJson(res, 200, publicState());
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
        sendJson(res, 200, publicState());
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
        const zoneId = String(url.searchParams.get('id') || '');
        state.zones = state.zones.filter((zone) => zone.id !== zoneId);
        await saveState();
        sendJson(res, 200, publicState());
        return true;
    }

    if (url.pathname === '/api/zones/reset-state' && req.method === 'POST') {
        const body = await readJson(req);
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

loadState().then(() => {
    server.listen(PORT, HOST, () => {
        console.log(`Slash check app: http://127.0.0.1:${PORT}`);
    });
}).catch((err) => {
    console.error('[slash-check] startup failed:', err);
    process.exit(1);
});
