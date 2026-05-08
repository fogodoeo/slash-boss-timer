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
const bossAdminSummary = document.querySelector('#bossAdminSummary');
const bossForm = document.querySelector('#bossForm');
const bossNameInput = document.querySelector('#bossNameInput');
const bossAliasInput = document.querySelector('#bossAliasInput');
const bossTypeInput = document.querySelector('#bossTypeInput');
const bossManageSearchInput = document.querySelector('#bossManageSearchInput');
const bossManageList = document.querySelector('#bossManageList');
const toastHost = document.querySelector('#toastHost');

let state = { members: [], zones: [], bosses: [] };
let baseline = { members: [], zones: [], bosses: [] };
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

function normalizeBossCooldown(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.max(0.01, Math.min(240, Math.round(num * 100000) / 100000));
}

function normalizeBossTime(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):?(\d{2})$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeBossDays(value) {
    const valid = ['월', '화', '수', '목', '금', '토', '일'];
    const seen = new Set();
    const source = Array.isArray(value) ? value : String(value || '').split(/[\s,;/]+/);
    const days = [];

    for (const item of source) {
        const day = String(item || '').trim().slice(0, 1);
        if (!valid.includes(day) || seen.has(day)) continue;
        seen.add(day);
        days.push(day);
    }

    return days;
}

function normalizeBossScore(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(999, Math.round(num)));
}

function normalizeBossDraft(raw) {
    const name = cleanText(raw.name, 40);
    if (!name) return null;

    const type = raw.type === '고정' ? '고정' : '시간';
    const boss = {
        이름: name,
        애칭: cleanText(raw.alias, 40),
        위치: cleanText(raw.location, 40),
        타입: type,
        점수: normalizeBossScore(raw.score)
    };

    if (type === '고정') {
        const time = normalizeBossTime(raw.time);
        const days = normalizeBossDays(raw.days);
        if (!time || days.length === 0) return null;
        boss.시간 = time;
        boss.요일 = days;
        return boss;
    }

    const cooldown = normalizeBossCooldown(raw.cooldown);
    if (!cooldown) return null;
    boss.쿨타임 = cooldown;
    return boss;
}

function bossIdentity(boss) {
    return JSON.stringify({
        이름: boss.이름,
        애칭: boss.애칭 || '',
        위치: boss.위치 || '',
        타입: boss.타입,
        쿨타임: boss.쿨타임 || null,
        시간: boss.시간 || '',
        요일: boss.요일 || [],
        점수: boss.점수 || 0
    });
}

function cloneBaseline(data) {
    return {
        members: [...(data.members || [])],
        zones: (data.zones || []).map((zone) => ({
            id: zone.id,
            name: zone.name,
            cooldownMin: zone.cooldownMin
        })),
        bosses: (data.bosses || []).map((boss) => ({ ...boss, 요일: [...(boss.요일 || [])] }))
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
    const [appState, bosses] = await Promise.all([
        api('/api/state'),
        api('/api/bosses')
    ]);
    applyState({ ...appState, bosses });
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

function readBossRows() {
    return [...bossManageList.querySelectorAll('.bossManageRow')];
}

function bossNameSet(rows) {
    const seen = new Set();
    const duplicates = new Set();

    for (const row of rows) {
        const name = cleanText(row.querySelector('.bossManageName').value, 40);
        if (!name) continue;
        if (seen.has(name)) duplicates.add(name);
        seen.add(name);
    }

    return duplicates;
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

    const bossRows = readBossRows();
    const duplicateBosses = bossNameSet(bossRows);
    const bosses = [];
    const addedBosses = [];
    const removedBosses = [];
    const changedBosses = [];

    for (const row of bossRows) {
        const originalName = row.dataset.originalName || '';
        const original = baseline.bosses.find((boss) => boss.이름 === originalName);
        const raw = {
            name: row.querySelector('.bossManageName').value,
            alias: row.querySelector('.bossManageAlias').value,
            location: row.querySelector('.bossManageLocation').value,
            type: row.querySelector('.bossManageType').value,
            cooldown: row.querySelector('.bossManageCooldown').value,
            time: row.querySelector('.bossManageTime').value,
            days: row.querySelector('.bossManageDays').value,
            score: row.querySelector('.bossManageScore').value
        };
        const name = cleanText(raw.name, 40);
        const status = row.querySelector('.manageStatus');

        if (!name) errors.push('보스명이 비어 있습니다.');
        if (name && duplicateBosses.has(name)) errors.push(`${name} 보스명이 중복됩니다.`);
        if (original && name !== original.이름) errors.push(`${original.이름} 보스명은 기존 기록 보호를 위해 수정할 수 없습니다.`);

        const boss = normalizeBossDraft(raw);
        if (!boss) {
            errors.push(`${name || '새 보스'} 일정 값을 확인하세요.`);
            row.classList.add('isChanged');
            if (status) status.textContent = '확인';
            continue;
        }

        bosses.push(boss);
        const changed = original ? bossIdentity(boss) !== bossIdentity(original) : true;
        row.classList.toggle('isChanged', changed);
        if (status) status.textContent = changed ? '수정됨' : '기존';
        if (!original) addedBosses.push(boss.이름);
        else if (changed) changedBosses.push(boss.이름);
    }

    const nextBossNames = new Set(bosses.map((boss) => boss.이름));
    for (const original of baseline.bosses) {
        if (!nextBossNames.has(original.이름)) removedBosses.push(original.이름);
    }

    if (bossRows.length === 0) {
        errors.push('보스 목록을 확인하세요.');
    }

    if (addedBosses.length > 0) changes.push(makeChange('보스 추가', formatList(addedBosses)));
    if (removedBosses.length > 0) changes.push(makeChange('보스 삭제', formatList(removedBosses)));
    if (changedBosses.length > 0) changes.push(makeChange('보스 일정 수정', formatList(changedBosses)));

    return {
        changes,
        errors,
        members,
        membersChanged,
        bosses,
        bossesChanged: addedBosses.length > 0 || removedBosses.length > 0 || changedBosses.length > 0,
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
        changeHint.textContent = '구역명, 쿨타임, 길드원 목록, 보스 일정을 수정한 뒤 일괄 저장하세요.';
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
        dragHandle.textContent = '↕';
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

function updateBossRowMode(row) {
    const isFixed = row.querySelector('.bossManageType').value === '고정';
    row.classList.toggle('isFixedBoss', isFixed);
    row.querySelector('.bossManageCooldown').disabled = isFixed;
    row.querySelector('.bossManageTime').disabled = !isFixed;
    row.querySelector('.bossManageDays').disabled = !isFixed;
}

function createBossManageRow(boss) {
    const original = baseline.bosses.find((item) => item.이름 === boss.이름);
    const row = document.createElement('div');
    row.className = 'bossManageRow';
    row.dataset.originalName = original ? boss.이름 : '';

    const nameInput = document.createElement('input');
    nameInput.className = 'bossManageName';
    nameInput.type = 'text';
    nameInput.value = boss.이름 || '';
    nameInput.placeholder = '보스명';
    nameInput.readOnly = Boolean(original);
    nameInput.title = original ? '기존 기록 보호를 위해 보스명은 고정됩니다.' : '';

    const aliasInput = document.createElement('input');
    aliasInput.className = 'bossManageAlias';
    aliasInput.type = 'text';
    aliasInput.value = boss.애칭 || '';
    aliasInput.placeholder = '애칭';

    const locationInput = document.createElement('input');
    locationInput.className = 'bossManageLocation';
    locationInput.type = 'text';
    locationInput.value = boss.위치 || '';
    locationInput.placeholder = '위치';

    const typeSelect = document.createElement('select');
    typeSelect.className = 'bossManageType';
    for (const value of ['시간', '고정']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value === '시간' ? '시간' : '고정';
        option.selected = boss.타입 === value;
        typeSelect.append(option);
    }

    const cooldownInput = document.createElement('input');
    cooldownInput.className = 'bossManageCooldown';
    cooldownInput.type = 'number';
    cooldownInput.min = '0.01';
    cooldownInput.max = '240';
    cooldownInput.step = '0.00001';
    cooldownInput.value = boss.쿨타임 || 24;
    cooldownInput.placeholder = '쿨(h)';

    const timeInput = document.createElement('input');
    timeInput.className = 'bossManageTime';
    timeInput.type = 'text';
    timeInput.inputMode = 'numeric';
    timeInput.value = boss.시간 || '20:00';
    timeInput.placeholder = '22:00';

    const daysInput = document.createElement('input');
    daysInput.className = 'bossManageDays';
    daysInput.type = 'text';
    daysInput.value = (boss.요일 || []).join(',');
    daysInput.placeholder = '월,금';

    const scoreInput = document.createElement('input');
    scoreInput.className = 'bossManageScore';
    scoreInput.type = 'number';
    scoreInput.min = '0';
    scoreInput.max = '999';
    scoreInput.value = boss.점수 || 0;
    scoreInput.placeholder = '점수';

    const status = document.createElement('span');
    status.className = 'manageStatus';
    status.textContent = original ? '기존' : '신규';

    const deleteButton = document.createElement('button');
    deleteButton.className = 'deleteBoss';
    deleteButton.type = 'button';
    deleteButton.textContent = '삭제';
    deleteButton.addEventListener('click', () => {
        if (original && !confirm(`${boss.이름} 보스를 목록에서 제거할까요? 기존 컷 기록은 남습니다.`)) return;
        row.remove();
        applyBossSearchFilter();
        renderChangeState();
    });

    typeSelect.addEventListener('change', () => {
        updateBossRowMode(row);
        renderChangeState();
    });

    row.append(nameInput, aliasInput, locationInput, typeSelect, cooldownInput, timeInput, daysInput, scoreInput, status, deleteButton);
    updateBossRowMode(row);
    return row;
}

function applyBossSearchFilter() {
    const query = bossManageSearchInput.value.trim().toLowerCase();
    const rows = readBossRows();
    let visible = 0;

    for (const row of rows) {
        const text = [
            row.querySelector('.bossManageName').value,
            row.querySelector('.bossManageAlias').value,
            row.querySelector('.bossManageLocation').value
        ].join(' ').toLowerCase();
        const matched = !query || text.includes(query);
        row.classList.toggle('isFilteredOut', !matched);
        if (matched) visible += 1;
    }

    bossAdminSummary.textContent = query ? `${visible}개 / 전체 ${rows.length}개` : `${rows.length}개`;
}

function renderBosses() {
    bossManageList.replaceChildren();

    if (!state.bosses.length) {
        bossManageList.innerHTML = '<div class="empty small">등록된 보스가 없습니다.</div>';
        bossAdminSummary.textContent = '0개';
        return;
    }

    for (const boss of state.bosses) {
        bossManageList.append(createBossManageRow(boss));
    }

    applyBossSearchFilter();
}

function render() {
    renderZones();
    renderMembers();
    renderBosses();
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

bossForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = cleanText(bossNameInput.value, 40);
    if (!name) {
        showToast('보스명 필요', '추가할 보스명을 입력하세요.', 'error');
        return;
    }

    const existingNames = new Set(readBossRows().map((row) => cleanText(row.querySelector('.bossManageName').value, 40)));
    if (existingNames.has(name)) {
        showToast('보스명 중복', `${name} 보스가 이미 있습니다.`, 'error');
        return;
    }

    const boss = normalizeBossDraft({
        name,
        alias: bossAliasInput.value,
        location: '',
        type: bossTypeInput.value,
        cooldown: 24,
        time: '20:00',
        days: '토',
        score: 0
    });
    if (!boss) {
        showToast('보스 추가 실패', '보스 정보를 확인하세요.', 'error');
        return;
    }

    const empty = bossManageList.querySelector('.empty');
    if (empty) empty.remove();
    bossManageList.append(createBossManageRow(boss));
    bossNameInput.value = '';
    bossAliasInput.value = '';
    applyBossSearchFilter();
    renderChangeState();
    showToast('보스 추가됨', '일괄 저장을 눌러야 반영됩니다.');
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
            if (draft.bossesChanged) body.bosses = draft.bosses;

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
bossManageList.addEventListener('input', () => {
    applyBossSearchFilter();
    renderChangeState();
});
bossManageSearchInput.addEventListener('input', applyBossSearchFilter);
window.addEventListener('pointermove', handleZoneReorderMove, { passive: false });
window.addEventListener('pointerup', finishZoneReorderPress);
window.addEventListener('pointercancel', finishZoneReorderPress);

fetchState().catch((err) => showToast('불러오기 실패', err.message, 'error'));
