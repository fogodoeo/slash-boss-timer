const zoneForm = document.querySelector('#zoneForm');
const zoneNameInput = document.querySelector('#zoneNameInput');
const cooldownInput = document.querySelector('#cooldownInput');
const zoneManageList = document.querySelector('#zoneManageList');
const zoneSummary = document.querySelector('#zoneSummary');
const memberSummary = document.querySelector('#memberSummary');
const memberBulkInput = document.querySelector('#memberBulkInput');
const bulkSaveButton = document.querySelector('#bulkSaveButton');
const changeSummary = document.querySelector('#changeSummary');
const changeHint = document.querySelector('#changeHint');
const changeReport = document.querySelector('#changeReport');
const toastHost = document.querySelector('#toastHost');

let state = { members: [], zones: [] };
let baseline = { members: [], zones: [] };
const REORDER_HOLD_MS = 420;
const REORDER_MOVE_CANCEL_PX = 8;
let zoneReorderPress = null;

function cleanText(value, max = 40) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function parseMembers(value) {
    const seen = new Set();
    const members = [];
    const raw = String(value || '').split(/[\r\n,;]+/);

    for (const item of raw) {
        const name = cleanText(item, 24);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        members.push(name);
    }

    return members;
}

function normalizeCooldown(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.max(1, Math.min(1440, Math.round(num)));
}

function cloneBaseline(data) {
    return {
        members: [...(data.members || [])],
        zones: (data.zones || []).map((zone) => ({
            id: zone.id,
            name: zone.name,
            cooldownMin: zone.cooldownMin
        }))
    };
}

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

function applyState(data) {
    state = data;
    baseline = cloneBaseline(data);
    render();
}

async function fetchState() {
    applyState(await api('/api/state'));
}

function formatList(names) {
    const visible = names.slice(0, 8).join(', ');
    const rest = names.length > 8 ? ` 외 ${names.length - 8}명` : '';
    return `${visible}${rest}`;
}

function makeChange(title, detail) {
    return { title, detail };
}

function zoneOrderFromDom() {
    return [...zoneManageList.querySelectorAll('.zoneManageRow[data-zone-id]')]
        .map((row) => row.dataset.zoneId)
        .filter(Boolean);
}

function isSameOrder(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cancelZoneReorderPress() {
    if (!zoneReorderPress) return;
    clearTimeout(zoneReorderPress.timer);
    if (zoneReorderPress.active) {
        zoneReorderPress.row.classList.remove('isDragging');
        zoneManageList.classList.remove('isReordering');
    }
    zoneReorderPress = null;
}

function beginZoneReorder() {
    if (!zoneReorderPress || zoneReorderPress.active) return;

    zoneReorderPress.active = true;
    zoneReorderPress.originalOrder = zoneOrderFromDom();
    zoneReorderPress.row.classList.add('isDragging');
    zoneManageList.classList.add('isReordering');

    try {
        zoneReorderPress.handle.setPointerCapture(zoneReorderPress.pointerId);
    } catch {
        // Pointer capture may fail if the pointer ended during the long press.
    }
}

function zoneRowAtPoint(event) {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const row = target?.closest?.('.zoneManageRow[data-zone-id]');
    return row && zoneManageList.contains(row) ? row : null;
}

function moveZoneRow(event) {
    if (!zoneReorderPress?.active) return;

    const draggedRow = zoneReorderPress.row;
    const targetRow = zoneRowAtPoint(event);
    if (!targetRow || targetRow === draggedRow) return;

    const rect = targetRow.getBoundingClientRect();
    const insertAfter = event.clientY > rect.top + rect.height / 2;
    zoneManageList.insertBefore(draggedRow, insertAfter ? targetRow.nextSibling : targetRow);
    zoneReorderPress.moved = true;
}

function finishZoneReorderPress(event) {
    if (!zoneReorderPress || event.pointerId !== zoneReorderPress.pointerId) return;

    const finished = zoneReorderPress;
    clearTimeout(finished.timer);
    zoneReorderPress = null;

    if (!finished.active) return;

    finished.row.classList.remove('isDragging');
    zoneManageList.classList.remove('isReordering');

    const nextOrder = zoneOrderFromDom();
    if (finished.moved && !isSameOrder(nextOrder, finished.originalOrder || [])) {
        renderChangeState();
    }
}

function handleZoneReorderMove(event) {
    if (!zoneReorderPress || event.pointerId !== zoneReorderPress.pointerId) return;

    const distance = Math.hypot(event.clientX - zoneReorderPress.startX, event.clientY - zoneReorderPress.startY);
    if (!zoneReorderPress.active) {
        if (distance > REORDER_MOVE_CANCEL_PX) cancelZoneReorderPress();
        return;
    }

    event.preventDefault();
    moveZoneRow(event);
}

function startZoneReorderPress(event, row, handle) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    cancelZoneReorderPress();
    zoneReorderPress = {
        row,
        handle,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        moved: false,
        originalOrder: null,
        timer: setTimeout(beginZoneReorder, REORDER_HOLD_MS)
    };
}

function getAdminDraft() {
    const rows = [...zoneManageList.querySelectorAll('.zoneManageRow')];
    const rowOrderIds = rows.map((row) => row.dataset.zoneId).filter(Boolean);
    const baselineOrderIds = (baseline.zones || []).map((zone) => zone.id);
    const zoneOrderChanged = rowOrderIds.length > 0 && !isSameOrder(rowOrderIds, baselineOrderIds);
    const zoneUpdates = [];
    const changes = [];
    const errors = [];

    if (zoneOrderChanged) {
        changes.push(makeChange('구역 순서 변경', '체크 화면에 표시되는 구역 순서가 변경됩니다.'));
    }

    for (const row of rows) {
        const original = baseline.zones.find((zone) => zone.id === row.dataset.zoneId);
        if (!original) continue;

        const name = cleanText(row.querySelector('.manageName').value, 40);
        const cooldownMin = normalizeCooldown(row.querySelector('.manageCooldown').value);
        const rowChanges = [];

        if (!name) errors.push(`${original.name} 구역명이 비어 있습니다.`);
        if (!cooldownMin) errors.push(`${original.name} 쿨타임을 확인하세요.`);

        if (name && name !== original.name) {
            rowChanges.push(makeChange('구역명 변경', `${original.name} → ${name}`));
        }

        if (cooldownMin && cooldownMin !== original.cooldownMin) {
            rowChanges.push(makeChange('쿨타임 변경', `${name || original.name}: ${original.cooldownMin}분 → ${cooldownMin}분`));
        }

        row.classList.toggle('isChanged', rowChanges.length > 0);
        const status = row.querySelector('.manageStatus');
        if (status) status.textContent = rowChanges.length > 0 ? '수정됨' : '기존';

        if (rowChanges.length > 0 && name && cooldownMin) {
            zoneUpdates.push({ id: original.id, name, cooldownMin });
            changes.push(...rowChanges);
        }
    }

    const members = parseMembers(memberBulkInput.value);
    const previousMembers = baseline.members || [];
    const oldSet = new Set(previousMembers);
    const newSet = new Set(members);
    const addedMembers = members.filter((name) => !oldSet.has(name));
    const removedMembers = previousMembers.filter((name) => !newSet.has(name));
    const sameMembers = addedMembers.length === 0 && removedMembers.length === 0;
    const orderChanged = sameMembers && members.join('\n') !== previousMembers.join('\n');
    const membersChanged = addedMembers.length > 0 || removedMembers.length > 0 || orderChanged;

    if (members.length === 0) {
        errors.push('길드원 목록을 확인하세요.');
    }

    if (addedMembers.length > 0) changes.push(makeChange('길드원 추가', formatList(addedMembers)));
    if (removedMembers.length > 0) changes.push(makeChange('길드원 제거', formatList(removedMembers)));
    if (orderChanged) changes.push(makeChange('길드원 순서 변경', '추천 목록 표시 순서가 변경됩니다.'));

    return {
        changes,
        errors,
        members,
        membersChanged,
        zoneOrderChanged,
        zoneOrderIds: zoneOrderChanged ? rowOrderIds : null,
        zoneUpdates
    };
}

function renderChangeReport(items) {
    changeReport.replaceChildren();

    if (!items.length) {
        changeReport.classList.add('hidden');
        return;
    }

    const head = document.createElement('div');
    head.className = 'changeReportHead';

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = '방금 저장됨';

    const title = document.createElement('strong');
    title.textContent = `${items.length}개 변경사항`;

    head.append(label, title);

    const list = document.createElement('ul');
    for (const item of items) {
        const row = document.createElement('li');
        const itemTitle = document.createElement('strong');
        const itemDetail = document.createElement('span');

        itemTitle.textContent = item.title;
        itemDetail.textContent = item.detail;
        row.append(itemTitle, itemDetail);
        list.append(row);
    }

    changeReport.append(head, list);
    changeReport.classList.remove('hidden');
}

function renderChangeState() {
    const draft = getAdminDraft();

    if (draft.errors.length > 0) {
        changeSummary.textContent = '입력값 확인 필요';
        changeHint.textContent = draft.errors[0];
        bulkSaveButton.disabled = true;
        return;
    }

    if (draft.changes.length === 0) {
        changeSummary.textContent = '변경 없음';
        changeHint.textContent = '구역명, 쿨타임, 길드원 목록을 수정한 뒤 일괄 저장하세요.';
        bulkSaveButton.disabled = true;
        return;
    }

    changeSummary.textContent = `${draft.changes.length}개 변경 대기`;
    changeHint.textContent = draft.changes.slice(0, 2).map((item) => `${item.title}: ${item.detail}`).join(' / ');
    bulkSaveButton.disabled = false;
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
        row.dataset.zoneId = zone.id;

        const dragHandle = document.createElement('button');
        dragHandle.className = 'zoneDragHandle';
        dragHandle.type = 'button';
        dragHandle.textContent = '순서';
        dragHandle.title = '길게 눌러 순서 변경';
        dragHandle.setAttribute('aria-label', `${zone.name} 순서 변경`);

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

        const status = document.createElement('span');
        status.className = 'manageStatus';
        status.textContent = '기존';

        const deleteButton = document.createElement('button');
        deleteButton.className = 'deleteZone';
        deleteButton.type = 'button';
        deleteButton.textContent = '삭제';

        row.append(dragHandle, nameInput, cooldownInput, status, deleteButton);

        dragHandle.addEventListener('pointerdown', (event) => startZoneReorderPress(event, row, dragHandle));
        dragHandle.addEventListener('contextmenu', (event) => event.preventDefault());

        deleteButton.addEventListener('click', async () => {
            if (!confirm(`${zone.name} 구역을 삭제할까요?`)) return;
            try {
                await withPending(deleteButton, '삭제 중', async () => {
                    const data = await api(`/api/zones?id=${encodeURIComponent(zone.id)}`, { method: 'DELETE' });
                    applyState(data);
                    renderChangeReport([makeChange('구역 삭제', zone.name)]);
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
    renderChangeState();
}

zoneForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = zoneNameInput.value.trim();
    const cooldownMin = Number(cooldownInput.value);
    if (!name || !cooldownMin) return;

    try {
        const submitButton = zoneForm.querySelector('button[type="submit"]');
        await withPending(submitButton, '추가 중', async () => {
            const data = await api('/api/zones', {
                method: 'POST',
                body: JSON.stringify({ name, cooldownMin })
            });
            zoneNameInput.value = '';
            applyState(data);
            renderChangeReport([makeChange('구역 추가', `${name} / ${cooldownMin}분`)]);
            showToast('구역 추가됨', `${name} / ${cooldownMin}분`);
        });
    } catch (err) {
        showToast('추가 실패', err.message, 'error');
    }
});

bulkSaveButton.addEventListener('click', async () => {
    const draft = getAdminDraft();

    if (draft.errors.length > 0) {
        showToast('일괄 저장 불가', draft.errors[0], 'error');
        return;
    }

    if (draft.changes.length === 0) {
        showToast('변경 없음', '저장할 내용이 없습니다.');
        return;
    }

    try {
        await withPending(bulkSaveButton, '저장 중', async () => {
            const body = {
                zones: draft.zoneUpdates
            };
            if (draft.membersChanged) body.members = draft.members;
            if (draft.zoneOrderChanged) body.zoneOrderIds = draft.zoneOrderIds;

            const data = await api('/api/admin/bulk', {
                method: 'POST',
                body: JSON.stringify(body)
            });

            applyState(data);
            renderChangeReport(draft.changes);
            showToast('일괄 저장 완료', `${draft.changes.length}개 변경사항 반영`);
        });
    } catch (err) {
        showToast('일괄 저장 실패', err.message, 'error');
    } finally {
        renderChangeState();
    }
});

zoneManageList.addEventListener('input', renderChangeState);
memberBulkInput.addEventListener('input', renderChangeState);
window.addEventListener('pointermove', handleZoneReorderMove, { passive: false });
window.addEventListener('pointerup', finishZoneReorderPress);
window.addEventListener('pointercancel', finishZoneReorderPress);

fetchState().catch((err) => showToast('불러오기 실패', err.message, 'error'));
