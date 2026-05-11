const $ = (selector) => document.querySelector(selector);

const el = {
    list: $('#geckoLogList'),
    reload: $('#reloadLogButton'),
    toastHost: $('#toastHost')
};

function node(tag, className = '', text = '') {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== '') item.textContent = text;
    return item;
}

function toast(title, message = '', type = 'success') {
    const item = node('div', `toast ${type === 'error' ? 'error' : 'success'}`);
    item.append(node('strong', '', title), node('span', '', message));
    el.toastHost.append(item);
    setTimeout(() => item.remove(), 2600);
}

function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function renderLogs(logs) {
    el.list.replaceChildren();
    if (!logs.length) {
        el.list.append(node('div', 'gxEmpty', '아직 작업 로그가 없습니다.'));
        return;
    }

    logs.forEach((log) => {
        const item = node('article', 'gxLogItem');
        const top = node('div', 'gxLogTop');
        top.append(
            node('strong', '', log.action || '변경'),
            node('span', '', formatDate(log.at))
        );
        item.append(
            top,
            node('div', 'gxLogTarget', log.target || '-'),
            node('p', '', [log.actor ? `작업자 ${log.actor}` : '', log.detail || ''].filter(Boolean).join(' · '))
        );
        el.list.append(item);
    });
}

async function loadLogs() {
    try {
        const response = await fetch('/api/geckos');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '로그를 불러오지 못했습니다.');
        renderLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (err) {
        toast('로그 불러오기 실패', err.message, 'error');
    }
}

el.reload.addEventListener('click', loadLogs);
loadLogs();
