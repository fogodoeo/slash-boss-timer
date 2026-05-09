const bossLogSummary = document.querySelector('#bossLogSummary');
const bossLogSearchInput = document.querySelector('#bossLogSearchInput');
const bossLogCategoryFilter = document.querySelector('#bossLogCategoryFilter');
const bossLogActionFilter = document.querySelector('#bossLogActionFilter');
const bossLogBossFilter = document.querySelector('#bossLogBossFilter');
const bossLogActorFilter = document.querySelector('#bossLogActorFilter');
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
    [...toastHost.querySelectorAll('.toast')].slice(0, -3).forEach((item) => item.remove());
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
    requestAnimationFrame(() => toast.classList.add('show'));

    let closing = false;
    const closeToast = () => {
        if (closing) return;
        closing = true;
        toast.classList.remove('show');
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 260);
    };
    const timer = setTimeout(closeToast, tone === 'error' ? 4200 : 2800);
    toast.addEventListener('click', () => {
        clearTimeout(timer);
        closeToast();
    });
}

async function api(path) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요청 처리에 실패했습니다.');
    return data;
}

function categoryLabel(category) {
    return category === 'slash' ? '썰자' : '보스';
}

function actionLabel(action) {
    const labels = {
        check: '완료',
        'reset-state': '상태 초기화',
        'cancel-last-check': '완료 취소',
        'edit-log': '완료자 수정',
        'delete-log': '기록 취소',
        'cut-create': '컷 등록',
        'cut-update': '시간 수정',
        'cut-cancel': '컷 취소',
        'participant-add': '참여 확인',
        'time-reset': '시간보스 초기화'
    };
    return labels[action] || action || '기록';
}

function actionTone(action) {
    if (action === 'check' || action === 'cut-create') return 'create';
    if (action === 'edit-log' || action === 'cut-update' || action === 'time-reset' || action === 'reset-state') return 'update';
    if (action === 'delete-log' || action === 'cancel-last-check' || action === 'cut-cancel') return 'cancel';
    if (action === 'participant-add') return 'participant';
    return 'default';
}

function describeBossLog(log) {
    const detail = log.detail || {};
    if (log.action === 'cut-create') {
        return `${displayTimeValue(detail.timeValue)} 컷 · 다음 ${formatKstDateTime(detail.nextSpawnAt)}`;
    }
    if (log.action === 'cut-update') {
        return `${displayTimeValue(detail.previous?.timeValue)} → ${displayTimeValue(detail.next?.timeValue)} · 다음 ${formatKstDateTime(detail.next?.nextSpawnAt)}`;
    }
    if (log.action === 'cut-cancel') {
        return `${displayTimeValue(detail.timeValue)} 컷 취소 · 참여 ${detail.participants || 0}명${detail.reason ? ` · ${detail.reason}` : ''}`;
    }
    if (log.action === 'participant-add') {
        return `${detail.participantName || log.actorName || '-'} 참여 · ${displayTimeValue(detail.timeValue)} 컷`;
    }
    if (log.action === 'time-reset') {
        return `${detail.count || 0}개 시간보스 · ${formatKstDateTime(detail.nextSpawnAt)} 즉시 젠`;
    }
    return JSON.stringify(detail);
}

function describeSlashLog(log) {
    if (log.action === 'check' || !log.action) return `${log.memberName || '-'} 완료`;
    if (log.action === 'reset-state') return `${log.memberName || '-'} · 잠김/예약 초기화`;
    if (log.action === 'cancel-last-check') return `${log.detail?.targetMemberName || '-'} 완료 취소`;
    if (log.action === 'edit-log') return `${log.detail?.oldMemberName || '-'} → ${log.detail?.newMemberName || '-'}`;
    if (log.action === 'delete-log') return `${log.detail?.targetMemberName || '-'} 기록 취소`;
    return JSON.stringify(log.detail || {});
}

function describeLog(log) {
    return log.category === 'slash' ? describeSlashLog(log) : describeBossLog(log);
}

function logMatches(log) {
    const query = bossLogSearchInput.value.trim().toLowerCase();
    const categoryOk = bossLogCategoryFilter.value === 'all' || log.category === bossLogCategoryFilter.value;
    const actionOk = bossLogActionFilter.value === 'all' || log.action === bossLogActionFilter.value;
    const targetOk = bossLogBossFilter.value === 'all' || log.targetName === bossLogBossFilter.value;
    const actorOk = bossLogActorFilter.value === 'all' || log.actorName === bossLogActorFilter.value;
    if (!categoryOk || !actionOk || !targetOk || !actorOk) return false;
    if (!query) return true;
    return `${log.targetName} ${log.actorName} ${categoryLabel(log.category)} ${actionLabel(log.action)} ${describeLog(log)}`.toLowerCase().includes(query);
}

function option(label, value) {
    const item = document.createElement('option');
    item.value = value;
    item.textContent = label;
    return item;
}

function renderFilterOptions() {
    const selectedTarget = bossLogBossFilter.value;
    const selectedActor = bossLogActorFilter.value;
    const selectedAction = bossLogActionFilter.value;
    const targets = [...new Set(logs.map((log) => log.targetName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    const actors = [...new Set(logs.map((log) => log.actorName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    const actions = [...new Set(logs.map((log) => log.action).filter(Boolean))];

    bossLogBossFilter.replaceChildren(option('전체 대상', 'all'), ...targets.map((target) => option(target, target)));
    bossLogActorFilter.replaceChildren(option('전체 작업자', 'all'), ...actors.map((actor) => option(actor, actor)));
    bossLogActionFilter.replaceChildren(option('전체 작업', 'all'), ...actions.map((action) => option(actionLabel(action), action)));

    bossLogBossFilter.value = targets.includes(selectedTarget) ? selectedTarget : 'all';
    bossLogActorFilter.value = actors.includes(selectedActor) ? selectedActor : 'all';
    bossLogActionFilter.value = actions.includes(selectedAction) ? selectedAction : 'all';
}

function renderStats() {
    const slashCount = logs.filter((log) => log.category === 'slash').length;
    const bossCount = logs.filter((log) => log.category === 'boss').length;
    logMetricTotal.textContent = logs.length;
    logMetricCreate.textContent = slashCount;
    logMetricUpdate.textContent = bossCount;
    logMetricCancel.textContent = logs.filter((log) => ['delete-log', 'cancel-last-check', 'cut-cancel'].includes(log.action)).length;
    bossLogSummary.textContent = `최근 ${logs.length}건`;
}

function renderLogs() {
    const visible = logs.filter(logMatches);
    bossLogListSummary.textContent = `${visible.length}건`;
    bossLogList.replaceChildren();

    if (visible.length === 0) {
        bossLogList.innerHTML = '<div class="empty small">표시할 로그가 없습니다.</div>';
        return;
    }

    for (const log of visible) {
        const item = document.createElement('article');
        item.className = `bossLogItem ${actionTone(log.action)}`;

        const badge = document.createElement('span');
        badge.className = 'bossLogBadge';
        badge.textContent = `${categoryLabel(log.category)} · ${actionLabel(log.action)}`;

        const main = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = log.targetName || '-';
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

function normalizeSlashLog(log) {
    return {
        id: `slash-${log.id}`,
        category: 'slash',
        action: log.action || 'check',
        targetName: log.zoneName || '-',
        actorName: log.checkedBy || log.memberName || '',
        memberName: log.memberName || '',
        createdAt: log.checkedAt,
        detail: log.detail || log
    };
}

function normalizeBossLog(log) {
    return {
        ...log,
        id: `boss-${log.id}`,
        category: 'boss',
        targetName: log.bossName || '-',
        createdAt: log.createdAt
    };
}

function render() {
    renderFilterOptions();
    renderStats();
    renderLogs();
}

async function loadLogs() {
    const [stateData, bossData] = await Promise.all([api('/api/state'), api('/api/boss-logs')]);
    logs = [
        ...(stateData.logs || []).map(normalizeSlashLog),
        ...(bossData.logs || []).map(normalizeBossLog)
    ].filter((log) => log.createdAt)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 500);
    render();
}

bossLogSearchInput.addEventListener('input', renderLogs);
bossLogCategoryFilter.addEventListener('change', renderLogs);
bossLogActionFilter.addEventListener('change', renderLogs);
bossLogBossFilter.addEventListener('change', renderLogs);
bossLogActorFilter.addEventListener('change', renderLogs);
loadLogs().catch((err) => {
    bossLogList.innerHTML = `<div class="empty">${err.message}</div>`;
    showToast('로그 로드 실패', err.message, 'error');
});
setInterval(() => loadLogs().catch(() => {}), 10000);
