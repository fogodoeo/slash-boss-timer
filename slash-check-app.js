const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

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
    bossCuts: {}
};

let state = structuredClone(defaultState);
const RESERVATION_GRACE_MS = 10 * 60 * 1000;
const CHECK_UNDO_GRACE_MS = 60 * 1000;

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

function normalizeBossCuts(value) {
    const next = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return next;

    for (const [bossName, cut] of Object.entries(value)) {
        const name = cleanText(bossName, 40);
        const timeValue = normalizeBossCutTime(cut?.timeValue);
        if (!name || !timeValue) continue;

        next[name] = {
            timeValue,
            reporterName: cleanText(cut?.reporterName, 24),
            updatedAt: cut?.updatedAt || new Date().toISOString()
        };
    }

    return next;
}

function isCheckLog(log) {
    return !log.action || log.action === 'check';
}

async function readBosses() {
    const raw = await fs.readFile(path.join(ROOT, 'bosses.json'), 'utf8');
    return JSON.parse(raw);
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
            bossCuts: normalizeBossCuts(parsed.bossCuts || legacyCuts)
        };
        state.zones = state.zones.map((zone) => ({
            ...zone,
            reservations: Array.isArray(zone.reservations) ? zone.reservations : []
        }));
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('[slash-check] state load failed:', err);
        state = structuredClone(defaultState);
        state.bossCuts = await readLegacyBossCuts();
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
        bossCuts: state.bossCuts || {}
    };
}

async function handleApi(req, res, url) {
    if (cleanupExpiredReservations()) await saveState();

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
        sendJson(res, 200, { cuts: state.bossCuts || {} });
        return true;
    }

    if (url.pathname === '/api/boss-cuts' && req.method === 'POST') {
        const body = await readJson(req);
        const bossName = cleanText(body.bossName, 40);
        const timeValue = normalizeBossCutTime(body.timeValue);
        const reporterName = cleanText(body.reporterName, 24);

        if (!bossName || !timeValue) {
            sendJson(res, 400, { error: '보스명과 컷 시간을 확인하세요.' });
            return true;
        }

        if (!state.members.includes(reporterName)) {
            sendJson(res, 400, { error: '등록된 길드원만 컷을 입력할 수 있습니다.' });
            return true;
        }

        state.bossCuts = state.bossCuts || {};
        state.bossCuts[bossName] = {
            timeValue,
            reporterName,
            updatedAt: new Date().toISOString()
        };

        await saveState();
        sendJson(res, 200, { cuts: state.bossCuts });
        return true;
    }

    if (url.pathname === '/api/boss-cuts' && req.method === 'DELETE') {
        const bossName = cleanText(url.searchParams.get('bossName'), 40);
        if (!bossName) {
            sendJson(res, 400, { error: '보스명을 확인하세요.' });
            return true;
        }

        state.bossCuts = state.bossCuts || {};
        delete state.bossCuts[bossName];
        await saveState();
        sendJson(res, 200, { cuts: state.bossCuts });
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
