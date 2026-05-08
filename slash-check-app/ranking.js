const rankingList = document.querySelector('#rankingList');
const logList = document.querySelector('#logList');
const rankingSummary = document.querySelector('#rankingSummary');
const logSummary = document.querySelector('#logSummary');
const logPanelLabel = document.querySelector('#logPanelLabel');
const memberFilterInput = document.querySelector('#memberFilterInput');
const periodButtons = [...document.querySelectorAll('[data-period]')];

let state = { rankings: [], logs: [], members: [] };
let activePeriod = 'day';

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatTime(iso) {
    if (!iso) return '-';
    const date = new Date(iso);
    return `${pad2(date.getMonth() + 1)}.${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function isCheckLog(log) {
    return !log.action || log.action === 'check';
}

function actionLabel(log) {
    if (log.action === 'reset-state') return '상태 초기화';
    if (log.action === 'cancel-last-check') return `완료 기록 취소${log.targetMemberName ? ` · ${log.targetMemberName}` : ''}`;
    return '완료';
}

function startOfToday() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

function startOfWeek() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    const diff = day === 0 ? 6 : day - 1;
    date.setDate(date.getDate() - diff);
    return date.getTime();
}

function periodStartMs() {
    if (activePeriod === 'day') return startOfToday();
    if (activePeriod === 'week') return startOfWeek();
    return 0;
}

function memberQuery() {
    return memberFilterInput.value.trim().toLowerCase();
}

function filteredLogs() {
    const start = periodStartMs();
    const query = memberQuery();

    return state.logs.filter((log) => {
        if (!isCheckLog(log)) return false;

        const timeOk = !start || new Date(log.checkedAt).getTime() >= start;
        const memberOk = !query || log.memberName.toLowerCase().includes(query);
        return timeOk && memberOk;
    });
}

function matchingMemberNames() {
    const query = memberQuery();
    if (!query) return [];
    return state.members.filter((member) => member.toLowerCase().includes(query));
}

function buildRankings(logs) {
    const map = new Map();

    for (const log of logs) {
        if (!isCheckLog(log)) continue;

        const current = map.get(log.memberName) || {
            memberName: log.memberName,
            count: 0,
            zones: new Map(),
            lastZone: null,
            lastAt: null
        };

        current.count += 1;
        current.zones.set(log.zoneName, (current.zones.get(log.zoneName) || 0) + 1);
        if (!current.lastAt || new Date(log.checkedAt) > new Date(current.lastAt)) {
            current.lastZone = log.zoneName;
            current.lastAt = log.checkedAt;
        }
        map.set(log.memberName, current);
    }

    return [...map.values()]
        .map((item) => ({
            ...item,
            topZones: [...item.zones.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
                .slice(0, 3)
        }))
        .sort((a, b) => b.count - a.count || a.memberName.localeCompare(b.memberName, 'ko'));
}

async function fetchState() {
    const res = await fetch('/api/state', { cache: 'no-store' });
    state = await res.json();
    render();
}

function periodLabel() {
    if (activePeriod === 'day') return '오늘';
    if (activePeriod === 'week') return '이번 주';
    return '전체';
}

function renderRankings() {
    rankingList.replaceChildren();
    const logs = filteredLogs();
    const rankings = buildRankings(logs);
    rankingSummary.textContent = `${periodLabel()} ${rankings.length}명 · 완료 ${logs.length}건`;

    if (rankings.length === 0) {
        rankingList.innerHTML = '<div class="empty small">조건에 맞는 랭킹 기록이 없습니다.</div>';
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

        const count = document.createElement('span');
        count.textContent = `${item.count}회`;

        const detail = document.createElement('small');
        const zoneText = item.topZones.map(([zone, countValue]) => `${zone} ${countValue}`).join(' · ');
        detail.textContent = `주요 구역: ${zoneText || '-'} / 최근: ${item.lastZone || '-'} · ${formatTime(item.lastAt)}`;

        row.append(rankNo, member, count, detail);
        row.tabIndex = 0;
        row.addEventListener('click', () => {
            memberFilterInput.value = item.memberName;
            render();
        });
        row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                memberFilterInput.value = item.memberName;
                render();
            }
        });
        rankingList.append(row);
    });
}

function renderLogs() {
    logList.replaceChildren();
    const logs = filteredLogs();
    const query = memberQuery();
    const matches = matchingMemberNames();
    const exactMember = matches.find((member) => member.toLowerCase() === query);

    logPanelLabel.textContent = query ? '길드원 활동 내역' : '최근 기록';
    logSummary.textContent = query
        ? `${periodLabel()} ${logs.length}건${exactMember ? ` · ${exactMember}` : matches.length > 1 ? ` · ${matches.length}명` : ''}`
        : `${logs.length}건`;

    if (logs.length === 0) {
        logList.innerHTML = query
            ? '<div class="empty small">이 길드원의 체크 기록이 없습니다.</div>'
            : '<div class="empty small">조건에 맞는 체크 기록이 없습니다.</div>';
        return;
    }

    logs.forEach((log) => {
        const row = document.createElement('div');
        row.className = 'activityRow';

        const time = document.createElement('time');
        time.textContent = formatTime(log.checkedAt);

        const main = document.createElement('div');
        main.className = 'activityMain';

        const title = document.createElement('strong');
        title.textContent = query ? log.zoneName : log.memberName;

        const meta = document.createElement('span');
        meta.textContent = isCheckLog(log)
            ? query
                ? `${log.memberName} · 쿨타임 ${log.cooldownMin || '-'}분`
                : `${log.zoneName} 완료`
            : query
                ? `${log.memberName} · ${actionLabel(log)}`
                : `${log.zoneName} · ${actionLabel(log)}`;

        main.append(title, meta);
        row.append(time, main);
        row.tabIndex = 0;
        row.addEventListener('click', () => {
            memberFilterInput.value = log.memberName;
            render();
        });
        row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                memberFilterInput.value = log.memberName;
                render();
            }
        });
        logList.append(row);
    });
}

function render() {
    periodButtons.forEach((button) => {
        button.classList.toggle('active', button.dataset.period === activePeriod);
    });
    renderRankings();
    renderLogs();
}

periodButtons.forEach((button) => {
    button.addEventListener('click', () => {
        activePeriod = button.dataset.period;
        render();
    });
});

memberFilterInput.addEventListener('input', render);

fetchState();
setInterval(() => fetchState().catch(() => {}), 3000);
