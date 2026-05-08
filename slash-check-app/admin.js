const zoneForm = document.querySelector('#zoneForm');
const zoneNameInput = document.querySelector('#zoneNameInput');
const cooldownInput = document.querySelector('#cooldownInput');
const zoneManageList = document.querySelector('#zoneManageList');
const zoneSummary = document.querySelector('#zoneSummary');
const memberSummary = document.querySelector('#memberSummary');
const memberBulkInput = document.querySelector('#memberBulkInput');
const saveMembersButton = document.querySelector('#saveMembersButton');
const toastHost = document.querySelector('#toastHost');

let state = { members: [], zones: [] };

function showToast(title, message = '', tone = 'success') {
    if (!toastHost) return;

    const toast = document.createElement('div');
    toast.className = `toast ${tone}`;

    const titleEl = document.createElement('strong');
    titleEl.textContent = title;
    toast.append(titleEl);

    if (message) {
        const messageEl = document.createElement('span');
        messageEl.textContent = message;
        toast.append(messageEl);
    }

    toastHost.append(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 180);
    }, 3600);
}

async function withPending(button, pendingText, task) {
    const previousText = button.textContent;
    button.disabled = true;
    button.textContent = pendingText;

    try {
        return await task();
    } finally {
        button.disabled = false;
        button.textContent = previousText;
    }
}

async function api(path, options = {}) {
    const res = await fetch(path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요청 처리에 실패했습니다.');
    return data;
}

async function fetchState() {
    state = await api('/api/state');
    render();
}

function renderZones() {
    zoneSummary.textContent = `${state.zones.length}개`;
    zoneManageList.replaceChildren();

    if (state.zones.length === 0) {
        zoneManageList.innerHTML = '<div class="empty small">등록된 구역이 없습니다.</div>';
        return;
    }

    state.zones.forEach((zone) => {
        const row = document.createElement('div');
        row.className = 'zoneManageRow';

        const nameInput = document.createElement('input');
        nameInput.className = 'manageName';
        nameInput.type = 'text';
        nameInput.value = zone.name;

        const cooldownInput = document.createElement('input');
        cooldownInput.className = 'manageCooldown';
        cooldownInput.type = 'number';
        cooldownInput.min = '1';
        cooldownInput.max = '1440';
        cooldownInput.value = zone.cooldownMin;

        const saveButton = document.createElement('button');
        saveButton.className = 'saveZone';
        saveButton.type = 'button';
        saveButton.textContent = '변경 저장';

        const deleteButton = document.createElement('button');
        deleteButton.className = 'deleteZone';
        deleteButton.type = 'button';
        deleteButton.textContent = '삭제';

        row.append(nameInput, cooldownInput, saveButton, deleteButton);

        saveButton.addEventListener('click', async () => {
            try {
                await withPending(saveButton, '저장 중', async () => {
                    const nextName = nameInput.value.trim();
                    const nextCooldown = Number(cooldownInput.value);
                    state = await api('/api/zones', {
                        method: 'PUT',
                        body: JSON.stringify({
                            id: zone.id,
                            name: nextName,
                            cooldownMin: nextCooldown
                        })
                    });
                    render();
                    showToast('구역 변경 저장됨', `${nextName} / ${nextCooldown}분`);
                });
            } catch (err) {
                showToast('저장 실패', err.message, 'error');
            }
        });

        deleteButton.addEventListener('click', async () => {
            if (!confirm(`${zone.name} 구역을 삭제할까요?`)) return;
            try {
                await withPending(deleteButton, '삭제 중', async () => {
                    state = await api(`/api/zones?id=${encodeURIComponent(zone.id)}`, { method: 'DELETE' });
                    render();
                    showToast('구역 삭제됨', zone.name);
                });
            } catch (err) {
                showToast('삭제 실패', err.message, 'error');
            }
        });

        zoneManageList.append(row);
    });
}

function renderMembers() {
    memberSummary.textContent = `${state.members.length}명`;
    memberBulkInput.value = state.members.join('\n');
}

function render() {
    renderZones();
    renderMembers();
}

zoneForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = zoneNameInput.value.trim();
    const cooldownMin = Number(cooldownInput.value);
    if (!name || !cooldownMin) return;

    try {
        const submitButton = zoneForm.querySelector('button[type="submit"]');
        await withPending(submitButton, '추가 중', async () => {
            state = await api('/api/zones', {
                method: 'POST',
                body: JSON.stringify({ name, cooldownMin })
            });
            zoneNameInput.value = '';
            render();
            showToast('구역 추가됨', `${name} / ${cooldownMin}분`);
        });
    } catch (err) {
        showToast('추가 실패', err.message, 'error');
    }
});

saveMembersButton.addEventListener('click', async () => {
    try {
        await withPending(saveMembersButton, '저장 중', async () => {
            state = await api('/api/members', {
                method: 'POST',
                body: JSON.stringify({ raw: memberBulkInput.value })
            });
            render();
            showToast('길드원 목록 저장됨', `${state.members.length}명 반영`);
        });
    } catch (err) {
        showToast('저장 실패', err.message, 'error');
    }
});

fetchState().catch((err) => showToast('불러오기 실패', err.message, 'error'));
