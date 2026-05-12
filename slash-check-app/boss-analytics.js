const bossAnalyticsSummary = document.querySelector('#bossAnalyticsSummary');
const periodButtons = [...document.querySelectorAll('[data-period]')];
const metricBossCuts = document.querySelector('#metricBossCuts');
const metricBossCutsHint = document.querySelector('#metricBossCutsHint');
const metricBossParticipants = document.querySelector('#metricBossParticipants');
const metricBossParticipantsHint = document.querySelector('#metricBossParticipantsHint');
const metricBossConfirm = document.querySelector('#metricBossConfirm');
const metricBossCanceled = document.querySelector('#metricBossCanceled');
const bossHourSummary = document.querySelector('#bossHourSummary');
const bossHourChart = document.querySelector('#bossHourChart');
const bossFocusSummary = document.querySelector('#bossFocusSummary');
const bossFocusList = document.querySelector('#bossFocusList');
const bossMemberSummary = document.querySelector('#bossMemberSummary');
const bossMemberList = document.querySelector('#bossMemberList');

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
let activePeriod = 'week';
let state = { now: new Date().toISOString(), bossCutRecords: [] };

function pad2(value) {
    return String(value).padStart(2, '0');
}

function kstDate(ms) {
    return new Date(ms + KST_OFFSET_MS);
}

function nowMs() {
    const ms = new Date(state.now).getTime();
    return Number.isFinite(ms) ? ms : Date.now();
}

function startOfKstDay(ms = nowMs()) {
    const d = kstDate(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - KST_OFFSET_MS;
}

function startOfKstWeek(ms = nowMs()) {
    const start = startOfKstDay(ms);
    const day = kstDate(start).getUTCDay();
    return start - (day === 0 ? 6 : day - 1) * DAY_MS;
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

function recordMs(record) {
    const ms = new Date(record.cutAt || record.updatedAt).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function filteredRecords() {
    const start = periodStartMs();
    return (state.bossCutRecords || [])
        .filter((record) => !record.temporary && record.bossType !== '임시')
        .filter((record) => !start || recordMs(record) >= start)
        .sort((a, b) => recordMs(b) - recordMs(a));
}

function activeRecords(records) {
    return records.filter((record) => record.status !== 'canceled');
}

function participantNames(record) {
    return [...new Set((record.participants || []).map((item) => item.memberName).filter(Boolean))];
}

function countBy(items, keyFn) {
    const map = new Map();
    for (const item of items) {
        const key = keyFn(item);
        if (!key) continue;
        map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'ko'));
}

function renderMetric(el, value) {
    el.textContent = Number(value || 0).toLocaleString('ko-KR');
}

function renderStats(records) {
    const active = activeRecords(records);
    const participants = new Set(active.flatMap(participantNames));
    renderMetric(metricBossCuts, active.length);
    renderMetric(metricBossParticipants, participants.size);
    renderMetric(metricBossConfirm, active.filter((record) => record.requiresParticipation).length);
    renderMetric(metricBossCanceled, records.filter((record) => record.status === 'canceled').length);
    metricBossCutsHint.textContent = `${periodLabel()} 컷`;
    metricBossParticipantsHint.textContent = participants.size > 0 ? '중복 제외' : '참여 없음';
    bossAnalyticsSummary.textContent = `${periodLabel()} 컷 ${active.length}건 · 참여 ${participants.size}명`;
}

function renderHourChart(records) {
    const hours = Array.from({ length: 24 }, () => 0);
    for (const record of activeRecords(records)) {
        const ms = recordMs(record);
        if (!ms) continue;
        hours[kstDate(ms).getUTCHours()] += 1;
    }
    const max = Math.max(1, ...hours);
    const peak = hours.reduce((best, count, hour) => count > hours[best] ? hour : best, 0);
    bossHourSummary.textContent = hours[peak] > 0 ? `${pad2(peak)}시 집중` : '기록 없음';
    bossHourChart.replaceChildren();

    hours.forEach((count, hour) => {
        const item = document.createElement('div');
        item.className = 'hourItem';
        item.style.setProperty('--height', `${Math.max(8, Math.round((count / max) * 100))}%`);
        item.innerHTML = `<span>${count}</span><strong>${pad2(hour)}</strong>`;
        bossHourChart.append(item);
    });
}

function renderAnalysisList(target, entries, emptyText, suffix = '건') {
    target.replaceChildren();
    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty small';
        empty.textContent = emptyText;
        target.append(empty);
        return;
    }

    const max = Math.max(1, entries[0][1]);
    for (const [name, count] of entries.slice(0, 10)) {
        const row = document.createElement('div');
        row.className = 'analysisRow';
        row.style.setProperty('--ratio', `${Math.max(6, Math.round((count / max) * 100))}%`);
        const title = document.createElement('strong');
        title.textContent = name;
        const value = document.createElement('span');
        value.textContent = `${count}${suffix}`;
        row.append(title, value);
        target.append(row);
    }
}

function renderDetails(records) {
    const active = activeRecords(records);
    const bossEntries = countBy(active, (record) => record.bossName);
    const memberCounts = new Map();
    for (const record of active) {
        for (const name of participantNames(record)) {
            memberCounts.set(name, (memberCounts.get(name) || 0) + 1);
        }
    }
    const memberEntries = [...memberCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));

    bossFocusSummary.textContent = `${bossEntries.length}개 보스`;
    bossMemberSummary.textContent = `${memberEntries.length}명`;
    renderAnalysisList(bossFocusList, bossEntries, '보스 컷 기록이 없습니다.');
    renderAnalysisList(bossMemberList, memberEntries, '참여 기록이 없습니다.', '회');
}

function render() {
    const records = filteredRecords();
    periodButtons.forEach((button) => button.classList.toggle('active', button.dataset.period === activePeriod));
    renderStats(records);
    renderHourChart(records);
    renderDetails(records);
}

async function load() {
    state = await fetch('/api/state').then((res) => res.json());
    render();
}

periodButtons.forEach((button) => {
    button.addEventListener('click', () => {
        activePeriod = button.dataset.period;
        render();
    });
});

load().catch((err) => {
    bossFocusList.innerHTML = `<div class="empty">${err.message}</div>`;
});
