const bossLogSummary = document.querySelector('#bossLogSummary');
const bossLogSearchInput = document.querySelector('#bossLogSearchInput');
const bossLogListSummary = document.querySelector('#bossLogListSummary');
const bossLogList = document.querySelector('#bossLogList');
const logMetricTotal = document.querySelector('#logMetricTotal');
const logMetricCreate = document.querySelector('#logMetricCreate');
const logMetricUpdate = document.querySelector('#logMetricUpdate');
const logMetricCancel = document.querySelector('#logMetricCancel');
const toastHost = document.querySelector('#toastHost');

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
let logs = [];

function pad2(value) {
    return String(value).padStart(2, '0');
}

function kstDate(ms) {
    return new Date(ms + KST_OFFSET_MS);
}

function formatKstDateTime(iso) {
    if (!iso) return '-';
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '-';
    const date = kstDate(ms);
    return `${pad2(date.getUTCMonth() + 1)}.${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

function displayTimeValue(value) {
    const text = String(value || '');
    if (!/^\d{4}$/.test(text)) return '--:--';
    return `${text.slice(0, 2)}:${text.slice(2, 4)}`;
}

function showToast(title, message = '', tone = 'success') {
    if (!toastHost) return;
    const toast = document.createElement('div');
    toast.className = `toast ${tone}`;
    const strong = document.createElement('strong');
    strong.textContent = title;
    toast.append(strong);
    if (message) {
        const span = document.createElement('span');
        span.textContent = message;
        toast.append(span);
    }
    toastHost.append(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 180);
    }, 3200);
}

async function api(path) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요청 처리에 실패했습니다.');
    return data;
}

function actionLabel(action) {
    if (action === 'cut-create') return '컷 등록';
    if (action === 'cut-update') return '시간 수정';
    if (action === 'cut-cancel') return '컷 취소';
    if (action === 'participant-add') return '참여 확인';
    return action || '기록';
}

function actionTone(action) {
    if (action === 'cut-create') return 'create';
    if (action === 'cut-update') return 'update';
    if (action === 'cut-cancel') return 'cancel';
    if (action === 'participant-add') return 'participant';
    return 'default';
}

function describeLog(log) {
    const detail = log.detail || {};
    if (log.action === 'cut-create') {
        return `${displayTimeValue(detail.timeValue)} 컷 · 다음 ${formatKstDateTime(detail.nextSpawnAt)}`;
    }
    if (log.action === 'cut-update') {
        return `${displayTimeValue(detail.previous?.timeValue)} → ${displayTimeValue(detail.next?.timeValue)} · 다음 ${formatKstDateTime(detail.next?.nextSpawnAt)}`;
    }
    if (log.action === 'cut-cancel') {
        return `${displayTimeValue(detail.timeValue)} 컷 취소 · 참여 ${detail.participants || 0}명`;
    }
    if (log.action === 'participant-add') {
        return `${detail.participantName || log.actorName || '-'} 참여 · ${displayTimeValue(detail.timeValue)} 컷`;
    }
    return JSON.stringify(detail);
}

function logMatches(log) {
    const query = bossLogSearchInput.value.trim().toLowerCase();
    if (!query) return true;
    return `${log.bossName} ${log.actorName} ${actionLabel(log.action)} ${describeLog(log)}`.toLowerCase().includes(query);
}

function renderStats() {
    logMetricTotal.textContent = logs.length;
    logMetricCreate.textContent = logs.filter((log) => log.action === 'cut-create').length;
    logMetricUpdate.textContent = logs.filter((log) => log.action === 'cut-update').length;
    logMetricCancel.textContent = logs.filter((log) => log.action === 'cut-cancel').length;
    bossLogSummary.textContent = `최근 ${logs.length}건`;
}

function renderLogs() {
    const visible = logs.filter(logMatches);
    bossLogListSummary.textContent = `${visible.length}건`;
    bossLogList.replaceChildren();

    if (visible.length === 0) {
        bossLogList.innerHTML = '<div class="empty small">표시할 보스 로그가 없습니다.</div>';
        return;
    }

    for (const log of visible) {
        const item = document.createElement('article');
        item.className = `bossLogItem ${actionTone(log.action)}`;

        const badge = document.createElement('span');
        badge.className = 'bossLogBadge';
        badge.textContent = actionLabel(log.action);

        const main = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = log.bossName || '-';
        const desc = document.createElement('span');
        desc.textContent = describeLog(log);
        main.append(title, desc);

        const meta = document.createElement('div');
        meta.className = 'bossLogMeta';
        const actor = document.createElement('strong');
        actor.textContent = log.actorName || '-';
        const time = document.createElement('span');
        time.textContent = formatKstDateTime(log.createdAt);
        meta.append(actor, time);

        item.append(badge, main, meta);
        bossLogList.append(item);
    }
}

function render() {
    renderStats();
    renderLogs();
}

async function loadLogs() {
    const data = await api('/api/boss-logs');
    logs = data.logs || [];
    render();
}

bossLogSearchInput.addEventListener('input', renderLogs);
loadLogs().catch((err) => {
    bossLogList.innerHTML = `<div class="empty">${err.message}</div>`;
    showToast('로그 로드 실패', err.message, 'error');
});
setInterval(() => loadLogs().catch(() => {}), 10000);
