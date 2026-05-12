const bossRankingSummary = document.querySelector('#bossRankingSummary');
const bossRankingList = document.querySelector('#bossRankingList');
const bossRecentSummary = document.querySelector('#bossRecentSummary');
const bossRecentList = document.querySelector('#bossRecentList');
const periodButtons = [...document.querySelectorAll('[data-period]')];

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
let activePeriod = 'day';
let state = { now: new Date().toISOString(), members: [], bossCutRecords: [] };
let bosses = [];

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

function formatTime(iso) {
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '-';
    const d = kstDate(ms);
    return `${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function recordMs(record) {
    const ms = new Date(record.cutAt || record.updatedAt).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function activeRecords() {
    const start = periodStartMs();
    return (state.bossCutRecords || [])
        .filter((record) => !record.temporary && record.bossType !== '임시')
        .filter((record) => record.status !== 'canceled' && (!start || recordMs(record) >= start))
        .sort((a, b) => recordMs(b) - recordMs(a));
}

function bossScore(record) {
    const boss = bosses.find((item) => item.이름 === record.bossName);
    return Number(boss?.점수 || 0);
}

function participantNames(record) {
    return [...new Set((record.participants || []).map((item) => item.memberName).filter(Boolean))];
}

function buildRanking(records) {
    const map = new Map();
    for (const member of state.members || []) {
        map.set(member, { memberName: member, score: 0, participation: 0, cuts: 0, lastBoss: '', lastAt: '' });
    }

    for (const record of records) {
        const score = bossScore(record);
        for (const name of participantNames(record)) {
            const item = map.get(name) || { memberName: name, score: 0, participation: 0, cuts: 0, lastBoss: '', lastAt: '' };
            item.score += score;
            item.participation += 1;
            if (!item.lastAt || recordMs(record) > recordMs({ cutAt: item.lastAt })) {
                item.lastBoss = record.bossName;
                item.lastAt = record.cutAt;
            }
            map.set(name, item);
        }

        if (record.reporterName) {
            const item = map.get(record.reporterName) || { memberName: record.reporterName, score: 0, participation: 0, cuts: 0, lastBoss: '', lastAt: '' };
            item.cuts += 1;
            if (!item.lastAt || recordMs(record) > recordMs({ cutAt: item.lastAt })) {
                item.lastBoss = record.bossName;
                item.lastAt = record.cutAt;
            }
            map.set(record.reporterName, item);
        }
    }

    return [...map.values()]
        .filter((item) => item.score > 0 || item.participation > 0 || item.cuts > 0)
        .sort((a, b) => b.score - a.score || b.participation - a.participation || b.cuts - a.cuts || a.memberName.localeCompare(b.memberName, 'ko'));
}

function renderRanking(records) {
    const rankings = buildRanking(records);
    bossRankingSummary.textContent = `${periodLabel()} ${rankings.length}명 · 보스 ${records.length}건`;
    bossRankingList.replaceChildren();

    if (rankings.length === 0) {
        bossRankingList.innerHTML = '<div class="empty small">보스 참여 기록이 없습니다.</div>';
        return;
    }

    rankings.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'rankRow detail';

        const rankNo = document.createElement('span');
        rankNo.className = 'rankNo';
        rankNo.textContent = index + 1;

        const member = document.createElement('strong');
        member.textContent = item.memberName;

        const score = document.createElement('span');
        score.textContent = `${item.score}점`;

        const detail = document.createElement('small');
        detail.textContent = `참여 ${item.participation}회 · 컷입력 ${item.cuts}회 · 최근 ${item.lastBoss || '-'} ${formatTime(item.lastAt)}`;

        row.append(rankNo, member, score, detail);
        bossRankingList.append(row);
    });
}

function renderRecent(records) {
    const recent = records.slice(0, 30);
    bossRecentSummary.textContent = `${recent.length}건`;
    bossRecentList.replaceChildren();

    if (recent.length === 0) {
        bossRecentList.innerHTML = '<div class="empty small">최근 보스 기록이 없습니다.</div>';
        return;
    }

    for (const record of recent) {
        const row = document.createElement('div');
        row.className = 'activityRow';

        const time = document.createElement('time');
        time.textContent = formatTime(record.cutAt);

        const main = document.createElement('div');
        main.className = 'activityMain';
        const title = document.createElement('strong');
        title.textContent = record.bossName;
        const meta = document.createElement('span');
        const names = participantNames(record);
        meta.textContent = `${record.reporterName || '-'} 컷 · 참여 ${names.length}명 · ${bossScore(record)}점`;
        main.append(title, meta);

        const count = document.createElement('span');
        count.className = 'score';
        count.textContent = `${names.length}`;
        row.append(time, main, count);
        bossRecentList.append(row);
    }
}

function render() {
    const records = activeRecords();
    periodButtons.forEach((button) => button.classList.toggle('active', button.dataset.period === activePeriod));
    renderRanking(records);
    renderRecent(records);
}

async function load() {
    const [stateData, bossData] = await Promise.all([
        fetch('/api/state').then((res) => res.json()),
        fetch('/api/bosses').then((res) => res.json())
    ]);
    state = stateData;
    bosses = bossData;
    render();
}

periodButtons.forEach((button) => {
    button.addEventListener('click', () => {
        activePeriod = button.dataset.period;
        render();
    });
});

load().catch((err) => {
    bossRankingList.innerHTML = `<div class="empty">${err.message}</div>`;
});
