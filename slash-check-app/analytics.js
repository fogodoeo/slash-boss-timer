const analyticsSummary = document.querySelector('#analyticsSummary');
const periodButtons = [...document.querySelectorAll('[data-period]')];
const metricChecks = document.querySelector('#metricChecks');
const metricChecksHint = document.querySelector('#metricChecksHint');
const metricMembers = document.querySelector('#metricMembers');
const metricMembersHint = document.querySelector('#metricMembersHint');
const metricZones = document.querySelector('#metricZones');
const metricZonesHint = document.querySelector('#metricZonesHint');
const metricLocked = document.querySelector('#metricLocked');
const metricLockedHint = document.querySelector('#metricLockedHint');
const hourSummary = document.querySelector('#hourSummary');
const hourChart = document.querySelector('#hourChart');
const statusSummary = document.querySelector('#statusSummary');
const statusStack = document.querySelector('#statusStack');
const zoneSummary = document.querySelector('#zoneSummary');
const zoneAnalysisList = document.querySelector('#zoneAnalysisList');
const memberSummary = document.querySelector('#memberSummary');
const memberAnalysisList = document.querySelector('#memberAnalysisList');
const dailySummary = document.querySelector('#dailySummary');
const dailyTrend = document.querySelector('#dailyTrend');
const insightSummary = document.querySelector('#insightSummary');
const insightList = document.querySelector('#insightList');

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
let activePeriod = 'week';
let state = { now: new Date().toISOString(), members: [], zones: [], logs: [] };

function pad2(value) {
    return String(value).padStart(2, '0');
}

function kstDate(ms) {
    return new Date(ms + KST_OFFSET_MS);
}

function currentServerMs() {
    const ms = new Date(state.now).getTime();
    return Number.isFinite(ms) ? ms : Date.now();
}

function startOfKstDay(ms = currentServerMs()) {
    const date = kstDate(ms);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - KST_OFFSET_MS;
}

function startOfKstWeek(ms = currentServerMs()) {
    const start = startOfKstDay(ms);
    const day = kstDate(start).getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    return start - diff * DAY_MS;
}

function periodStartMs() {
    if (activePeriod === 'day') return startOfKstDay();
    if (activePeriod === 'week') return startOfKstWeek();
    return 0;
}

function periodLabel() {
    if (activePeriod === 'day') return '오늘';
    if (activePeriod === 'week') return '이번 주';
    return '전체';
}

function isCheckLog(log) {
    return !log.action || log.action === 'check';
}

function checkTimeMs(log) {
    const ms = new Date(log.checkedAt).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function filteredLogs() {
    const start = periodStartMs();
    return state.logs
        .filter((log) => isCheckLog(log) && (!start || checkTimeMs(log) >= start))
        .sort((a, b) => checkTimeMs(b) - checkTimeMs(a));
}

function activeReservations(zone, now = currentServerMs()) {
    return (zone.reservations || []).filter((reservation) => {
        return !reservation.expiresAt || new Date(reservation.expiresAt).getTime() > now;
    });
}

function zoneLocked(zone, now = currentServerMs()) {
    return Boolean(zone.cooldownUntil && new Date(zone.cooldownUntil).getTime() > now);
}

function formatKstDay(ms) {
    const date = kstDate(ms);
    return `${pad2(date.getUTCMonth() + 1)}.${pad2(date.getUTCDate())}`;
}

function formatHour(hour) {
    return `${pad2(hour)}시`;
}

function formatRemain(ms) {
    if (ms <= 0) return '대기';
    const min = Math.ceil(ms / 60000);
    if (min >= 60) return `${Math.floor(min / 60)}시간 ${min % 60}분`;
    return `${min}분`;
}

function countBy(logs, keyFn) {
    const map = new Map();
    for (const log of logs) {
        const key = keyFn(log);
        if (!key) continue;
        map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
}

function sortedEntries(map) {
    return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'ko'));
}

function renderMetric(element, value) {
    element.textContent = Number(value || 0).toLocaleString('ko-KR');
}

function renderStats(logs) {
    const memberCount = new Set(logs.map((log) => log.memberName).filter(Boolean)).size;
    const zoneCount = new Set(logs.map((log) => log.zoneId || log.zoneName).filter(Boolean)).size;
    const now = currentServerMs();
    const lockedCount = state.zones.filter((zone) => zoneLocked(zone, now)).length;
    const reservedCount = state.zones.filter((zone) => activeReservations(zone, now).length > 0).length;

    renderMetric(metricChecks, logs.length);
    renderMetric(metricMembers, memberCount);
    renderMetric(metricZones, zoneCount);
    renderMetric(metricLocked, lockedCount);

    metricChecksHint.textContent = `${periodLabel()} 완료`;
    metricMembersHint.textContent = state.members.length > 0 ? `전체 ${state.members.length}명 중` : '길드원';
    metricZonesHint.textContent = state.zones.length > 0 ? `전체 ${state.zones.length}개 중` : '활동 구역';
    metricLockedHint.textContent = reservedCount > 0 ? `예약 ${reservedCount}개` : '예약 없음';
    analyticsSummary.textContent = `${periodLabel()} 완료 ${logs.length}건 · 참여 ${memberCount}명`;
}

function renderHourChart(logs) {
    const hours = Array.from({ length: 24 }, () => 0);
    for (const log of logs) {
        const ms = checkTimeMs(log);
        if (!ms) continue;
        hours[kstDate(ms).getUTCHours()] += 1;
    }

    const max = Math.max(1, ...hours);
    const peak = hours.reduce((best, count, hour) => count > hours[best] ? hour : best, 0);
    hourSummary.textContent = logs.length > 0 ? `${formatHour(peak)} 집중` : '기록 없음';
    hourChart.replaceChildren();

    hours.forEach((count, hour) => {
        const item = document.createElement('div');
        item.className = 'hourItem';
        item.title = `${formatHour(hour)} · ${count}건`;

        const bar = document.createElement('span');
        bar.style.height = `${Math.max(6, Math.round((count / max) * 100))}%`;

        const value = document.createElement('strong');
        value.textContent = count;

        const label = document.createElement('small');
        label.textContent = hour % 3 === 0 ? pad2(hour) : '';

        item.append(value, bar, label);
        hourChart.append(item);
    });
}

function renderStatus() {
    const now = currentServerMs();
    const rows = state.zones.map((zone) => {
        const locked = zoneLocked(zone, now);
        const reservations = activeReservations(zone, now);
        const reservation = reservations[0];
        const cooldownMs = zone.cooldownUntil ? new Date(zone.cooldownUntil).getTime() - now : 0;
        return {
            zone,
            locked,
            reservation,
            cooldownMs,
            stateRank: locked ? 0 : reservation ? 1 : 2
        };
    }).sort((a, b) => a.stateRank - b.stateRank || a.zone.name.localeCompare(b.zone.name, 'ko'));

    const locked = rows.filter((row) => row.locked).length;
    const reserved = rows.filter((row) => row.reservation).length;
    statusSummary.textContent = `쿨 ${locked} · 예약 ${reserved}`;
    statusStack.replaceChildren();

    if (rows.length === 0) {
        statusStack.innerHTML = '<div class="empty small">등록된 구역이 없습니다.</div>';
        return;
    }

    rows.slice(0, 8).forEach((row) => {
        const item = document.createElement('div');
        item.className = `statusItem ${row.locked ? 'cooldown' : row.reservation ? 'reserved' : 'available'}`;

        const name = document.createElement('strong');
        name.textContent = row.zone.name;

        const meta = document.createElement('span');
        if (row.locked) meta.textContent = `쿨 ${formatRemain(row.cooldownMs)}`;
        else if (row.reservation) meta.textContent = `예약 ${row.reservation.memberName}`;
        else meta.textContent = '진입 가능';

        item.append(name, meta);
        statusStack.append(item);
    });
}

function renderAnalysisList(container, entries, total, emptyText) {
    container.replaceChildren();
    if (entries.length === 0) {
        container.innerHTML = `<div class="empty small">${emptyText}</div>`;
        return;
    }

    const max = Math.max(1, entries[0][1]);
    entries.slice(0, 10).forEach(([name, count], index) => {
        const row = document.createElement('div');
        row.className = 'analysisRow';

        const rank = document.createElement('span');
        rank.className = 'analysisRank';
        rank.textContent = index + 1;

        const main = document.createElement('div');
        main.className = 'analysisMain';

        const top = document.createElement('div');
        top.className = 'analysisTopline';

        const title = document.createElement('strong');
        title.textContent = name;

        const value = document.createElement('span');
        const percent = total > 0 ? Math.round((count / total) * 100) : 0;
        value.textContent = `${count}건 · ${percent}%`;

        const bar = document.createElement('div');
        bar.className = 'analysisBar';
        const fill = document.createElement('span');
        fill.style.width = `${Math.max(4, Math.round((count / max) * 100))}%`;
        bar.append(fill);

        top.append(title, value);
        main.append(top, bar);
        row.append(rank, main);
        container.append(row);
    });
}

function renderZoneAndMemberLists(logs) {
    const zoneCounts = countBy(logs, (log) => log.zoneName);
    const memberCounts = countBy(logs, (log) => log.memberName);
    const zones = sortedEntries(zoneCounts);
    const members = sortedEntries(memberCounts);

    zoneSummary.textContent = zones.length > 0 ? `${zones[0][0]} ${zones[0][1]}건` : '기록 없음';
    memberSummary.textContent = members.length > 0 ? `${members[0][0]} ${members[0][1]}건` : '기록 없음';

    renderAnalysisList(zoneAnalysisList, zones, logs.length, '선택 기간의 구역 기록이 없습니다.');
    renderAnalysisList(memberAnalysisList, members, logs.length, '선택 기간의 길드원 기록이 없습니다.');
}

function renderDailyTrend() {
    const todayStart = startOfKstDay();
    const buckets = Array.from({ length: 7 }, (_, index) => {
        const start = todayStart - (6 - index) * DAY_MS;
        return { start, label: formatKstDay(start), count: 0 };
    });

    for (const log of state.logs.filter(isCheckLog)) {
        const ms = checkTimeMs(log);
        const dayStart = startOfKstDay(ms);
        const bucket = buckets.find((item) => item.start === dayStart);
        if (bucket) bucket.count += 1;
    }

    const max = Math.max(1, ...buckets.map((item) => item.count));
    const total = buckets.reduce((sum, item) => sum + item.count, 0);
    dailySummary.textContent = `7일 ${total}건`;
    dailyTrend.replaceChildren();

    buckets.forEach((bucket, index) => {
        const item = document.createElement('div');
        item.className = 'dailyItem';
        item.title = `${bucket.label} · ${bucket.count}건`;

        const bar = document.createElement('span');
        bar.style.height = `${Math.max(8, Math.round((bucket.count / max) * 100))}%`;

        const value = document.createElement('strong');
        value.textContent = bucket.count;

        const label = document.createElement('small');
        label.textContent = index === 6 ? '오늘' : bucket.label;

        item.append(value, bar, label);
        dailyTrend.append(item);
    });
}

function renderInsights(logs) {
    insightList.replaceChildren();
    const zoneCounts = sortedEntries(countBy(logs, (log) => log.zoneName));
    const memberCounts = sortedEntries(countBy(logs, (log) => log.memberName));
    const hourCounts = Array.from({ length: 24 }, () => 0);

    for (const log of logs) {
        const ms = checkTimeMs(log);
        if (ms) hourCounts[kstDate(ms).getUTCHours()] += 1;
    }

    const peakHour = hourCounts.reduce((best, count, hour) => count > hourCounts[best] ? hour : best, 0);
    const now = currentServerMs();
    const lockedCount = state.zones.filter((zone) => zoneLocked(zone, now)).length;
    const quietZones = state.zones.filter((zone) => !zoneCounts.some(([name]) => name === zone.name));
    const items = [];

    if (logs.length === 0) {
        items.push(['기록 대기', '선택한 기간에 완료 기록이 없습니다.']);
    } else {
        items.push(['핫 구역', `${zoneCounts[0][0]} 쪽 기록이 가장 많습니다.`]);
        items.push(['핵심 시간', `${formatHour(peakHour)}대에 완료가 가장 몰렸습니다.`]);
        items.push(['활동 상위', `${memberCounts[0][0]} 님이 ${memberCounts[0][1]}건으로 가장 활발합니다.`]);
        if (quietZones.length > 0) items.push(['빈 구역', `${quietZones[0].name} 포함 ${quietZones.length}개 구역은 기록이 없습니다.`]);
    }

    items.push(['현재 운영', `${state.zones.length}개 구역 중 ${lockedCount}개가 쿨타임 중입니다.`]);
    insightSummary.textContent = logs.length > 0 ? '분석 완료' : '기록 없음';

    for (const [title, body] of items) {
        const row = document.createElement('div');
        row.className = 'insightItem';
        const strong = document.createElement('strong');
        strong.textContent = title;
        const span = document.createElement('span');
        span.textContent = body;
        row.append(strong, span);
        insightList.append(row);
    }
}

function render() {
    periodButtons.forEach((button) => {
        button.classList.toggle('active', button.dataset.period === activePeriod);
    });

    const logs = filteredLogs();
    renderStats(logs);
    renderHourChart(logs);
    renderStatus();
    renderZoneAndMemberLists(logs);
    renderDailyTrend();
    renderInsights(logs);
}

async function fetchState() {
    const res = await fetch('/api/state', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '분석 데이터를 불러오지 못했습니다.');
    state = data;
    render();
}

periodButtons.forEach((button) => {
    button.addEventListener('click', () => {
        activePeriod = button.dataset.period;
        render();
    });
});

fetchState().catch(() => {
    analyticsSummary.textContent = '데이터를 불러오지 못했습니다';
});
setInterval(() => fetchState().catch(() => {}), 5000);
