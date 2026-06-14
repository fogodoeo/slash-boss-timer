const memoLockPanel = document.querySelector('#memoLockPanel');
const memoEditorPanel = document.querySelector('#memoEditorPanel');
const memoUnlockForm = document.querySelector('#memoUnlockForm');
const memoPasswordInput = document.querySelector('#memoPasswordInput');
const memoLockMessage = document.querySelector('#memoLockMessage');
const memoContentInput = document.querySelector('#memoContentInput');
const memoSaveButton = document.querySelector('#memoSaveButton');
const memoLockButton = document.querySelector('#memoLockButton');
const memoState = document.querySelector('#memoState');
const memoUpdatedText = document.querySelector('#memoUpdatedText');
const memoCountText = document.querySelector('#memoCountText');
const memoStatusText = document.querySelector('#memoStatusText');

const ADMIN_PASSWORD_KEY = 'slashCheckAdminPassword';
const MEMBER_KEY = 'slashCheckMemberName';
let adminPassword = localStorage.getItem(ADMIN_PASSWORD_KEY) || '';
let lastSavedContent = '';
let saveTimer = null;
let isSaving = false;
let isUnlocked = false;

function setStatus(text, tone = '') {
    memoStatusText.textContent = text;
    memoStatusText.dataset.tone = tone;
}

function setState(text, tone = '') {
    memoState.textContent = text;
    memoState.dataset.tone = tone;
}

function setLockMessage(text = '', tone = '') {
    memoLockMessage.textContent = text;
    memoLockMessage.dataset.tone = tone;
}

function formatKst(iso) {
    if (!iso) return '저장 전';
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '저장 전';
    const date = new Date(ms + 9 * 60 * 60 * 1000);
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    return `${month}.${day} ${hour}:${minute} 저장`;
}

function updateCount() {
    memoCountText.textContent = `${memoContentInput.value.length.toLocaleString('ko-KR')}자`;
}

async function memoApi(method, body) {
    const res = await fetch('./api/private-memo', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '메모 요청에 실패했습니다.');
    return data;
}

function showEditor(memo) {
    isUnlocked = true;
    memoLockPanel.classList.add('hidden');
    memoEditorPanel.classList.remove('hidden');
    setLockMessage('');
    memoContentInput.value = memo.content || '';
    lastSavedContent = memoContentInput.value;
    memoUpdatedText.textContent = `${formatKst(memo.updatedAt)}${memo.updatedBy ? ` · ${memo.updatedBy}` : ''}`;
    updateCount();
    setState('열림', 'open');
    setStatus('저장됨');
    setTimeout(() => memoContentInput.focus(), 50);
}

async function unlockMemo(event) {
    event?.preventDefault();
    adminPassword = memoPasswordInput.value.trim();
    if (!adminPassword) {
        setState('비밀번호 필요', 'error');
        setLockMessage('관리자 비밀번호를 입력하세요.', 'error');
        return;
    }
    setState('확인 중');
    setLockMessage('');
    try {
        const data = await memoApi('POST', { adminPassword });
        localStorage.setItem(ADMIN_PASSWORD_KEY, adminPassword);
        showEditor(data.memo || {});
    } catch (err) {
        setState('잠김', 'error');
        setLockMessage(err.message, 'error');
        setStatus(err.message, 'error');
    }
}

async function saveMemo({ silent = false } = {}) {
    if (!isUnlocked || isSaving) return;
    if (memoContentInput.value === lastSavedContent && silent) return;
    isSaving = true;
    memoSaveButton.disabled = true;
    if (!silent) setStatus('저장 중...');
    try {
        const data = await memoApi('PUT', {
            adminPassword,
            content: memoContentInput.value,
            updatedBy: localStorage.getItem(MEMBER_KEY) || ''
        });
        lastSavedContent = data.memo?.content || '';
        memoUpdatedText.textContent = `${formatKst(data.memo?.updatedAt)}${data.memo?.updatedBy ? ` · ${data.memo.updatedBy}` : ''}`;
        setStatus('저장됨', 'ok');
    } catch (err) {
        setStatus(err.message, 'error');
    } finally {
        isSaving = false;
        memoSaveButton.disabled = false;
    }
}

function scheduleSave() {
    updateCount();
    setStatus('작성 중');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveMemo({ silent: true }), 1200);
}

function lockMemo() {
    clearTimeout(saveTimer);
    isUnlocked = false;
    lastSavedContent = '';
    memoContentInput.value = '';
    memoEditorPanel.classList.add('hidden');
    memoLockPanel.classList.remove('hidden');
    setState('잠김');
    setStatus('저장됨');
    memoPasswordInput.focus();
}

memoUnlockForm.addEventListener('submit', unlockMemo);
memoSaveButton.addEventListener('click', () => saveMemo());
memoLockButton.addEventListener('click', lockMemo);
memoContentInput.addEventListener('input', scheduleSave);
document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveMemo();
    }
});

if (adminPassword) {
    memoPasswordInput.value = adminPassword;
    unlockMemo();
} else {
    memoPasswordInput.focus();
}
