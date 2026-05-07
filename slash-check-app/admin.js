const zoneForm = document.querySelector('#zoneForm');
const zoneNameInput = document.querySelector('#zoneNameInput');
const cooldownInput = document.querySelector('#cooldownInput');
const zoneManageList = document.querySelector('#zoneManageList');
const zoneSummary = document.querySelector('#zoneSummary');
const memberSummary = document.querySelector('#memberSummary');
const memberBulkInput = document.querySelector('#memberBulkInput');
const saveMembersButton = document.querySelector('#saveMembersButton');

let state = { members: [], zones: [] };

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
                state = await api('/api/zones', {
                    method: 'PUT',
                    body: JSON.stringify({
                        id: zone.id,
                        name: nameInput.value,
                        cooldownMin: cooldownInput.value
                    })
                });
                render();
            } catch (err) {
                alert(err.message);
            }
        });

        deleteButton.addEventListener('click', async () => {
            if (!confirm(`${zone.name} 구역을 삭제할까요?`)) return;
            try {
                state = await api(`/api/zones?id=${encodeURIComponent(zone.id)}`, { method: 'DELETE' });
                render();
            } catch (err) {
                alert(err.message);
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
        state = await api('/api/zones', {
            method: 'POST',
            body: JSON.stringify({ name, cooldownMin })
        });
        zoneNameInput.value = '';
        render();
    } catch (err) {
        alert(err.message);
    }
});

saveMembersButton.addEventListener('click', async () => {
    try {
        state = await api('/api/members', {
            method: 'POST',
            body: JSON.stringify({ raw: memberBulkInput.value })
        });
        render();
    } catch (err) {
        alert(err.message);
    }
});

fetchState();
