const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ADMIN_PASSWORD_KEY = 'geckoAdminPassword';
const DAY_MS = 86400000;
const ACTIVE_EGG_STATUSES = new Set(['보관중', '관찰']);

const el = {
    modeButtons: $$('[data-gx-mode]'),
    modePanels: $$('[data-gx-panel]'),
    total: $('#gxTotal'),
    updated: $('#gxUpdated'),
    toastHost: $('#toastHost'),

    registerForm: $('#registerForm'),
    resetRegisterButton: $('#resetRegisterButton'),
    sexButtons: $$('[data-sex]'),
    regName: $('#regName'),
    regNumber: $('#regNumber'),
    regContinue: $('#regContinue'),
    regNextPreview: $('#regNextPreview'),
    regLocation: $('#regLocation'),
    regMorph: $('#regMorph'),
    regPair: $('#regPair'),
    regPairDate: $('#regPairDate'),
    regMother: $('#regMother'),
    regFather: $('#regFather'),
    regMemo: $('#regMemo'),
    regPassword: $('#regPassword'),

    importForm: $('#importForm'),
    importText: $('#importText'),
    importPassword: $('#importPassword'),

    clutchForm: $('#clutchForm'),
    clutchFemaleSearch: $('#clutchFemaleSearch'),
    clutchFemaleSuggest: $('#clutchFemaleSuggest'),
    clutchFemaleLabel: $('#clutchFemaleLabel'),
    clutchPairHint: $('#clutchPairHint'),
    clutchLayDate: $('#clutchLayDate'),
    eggPresetButtons: $$('[data-egg-preset]'),
    clutchFertile: $('#clutchFertile'),
    clutchInfertile: $('#clutchInfertile'),
    clutchUnknown: $('#clutchUnknown'),
    clutchIncubation: $('#clutchIncubation'),
    clutchMate: $('#clutchMate'),
    clutchMemo: $('#clutchMemo'),
    clutchPreview: $('#clutchPreview'),
    clutchPassword: $('#clutchPassword'),

    manageSearch: $('#manageSearch'),
    manageSexFilter: $('#manageSexFilter'),
    manageRows: $('#manageRows'),
    manageEmpty: $('#manageEmpty'),
    detailTitle: $('#detailTitle'),
    detailBody: $('#detailBody'),
    editSelectedButton: $('#editSelectedButton'),
    activityForm: $('#activityForm'),
    activityStatusButtons: $$('[data-activity-status]'),
    activityMemo: $('#activityMemo'),
    activityPassword: $('#activityPassword')
};

let state = { geckos: [], count: 0, updatedAt: null };
let selectedSex = '미구분';
let selectedFemaleId = '';
let selectedGeckoId = '';
let activityStatus = '안먹음';

async function api(path, options = {}) {
    const response = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '요청에 실패했습니다.');
    return data;
}

function toast(title, message = '', type = 'success') {
    const item = document.createElement('div');
    item.className = `toast ${type === 'error' ? 'error' : 'success'}`;
    const strong = document.createElement('strong');
    const span = document.createElement('span');
    strong.textContent = title;
    span.textContent = message;
    item.append(strong, span);
    el.toastHost.append(item);
    setTimeout(() => item.remove(), 2600);
}

function todayValue() {
    const now = new Date();
    return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
    ].join('-');
}

function shortDate(value) {
    if (!value) return '-';
    const parts = String(value).split('-');
    return parts.length === 3 ? `${Number(parts[1])}.${parts[2]}` : value;
}

function numberValue(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
}

function makeId() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function node(tag, className = '', text = '') {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== '') item.textContent = text;
    return item;
}

function titleOf(gecko) {
    return `${gecko?.number || ''} ${gecko?.name || ''}`.trim() || '이름 없음';
}

function displaySex(gecko) {
    if (gecko?.sex === '암') return '암컷';
    if (gecko?.sex === '수') return '수컷';
    return gecko?.sex || '미구분';
}

function apiSex(value) {
    if (value === '암컷') return '암';
    if (value === '수컷') return '수';
    return '미구분';
}

function geckoById(id) {
    return state.geckos.find((gecko) => gecko.id === id) || null;
}

function geckoByNumber(number) {
    if (!number) return null;
    return state.geckos.find((gecko) => String(gecko.number || '') === String(number)) || null;
}

function recordsOf(gecko) {
    return [...(Array.isArray(gecko?.eggRecords) ? gecko.eggRecords : [])]
        .sort((a, b) => String(b.layDate || '').localeCompare(String(a.layDate || '')));
}

function activitiesOf(gecko) {
    return [...(Array.isArray(gecko?.activityRecords) ? gecko.activityRecords : [])]
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))
            || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function eggTotal(record) {
    return numberValue(record?.fertileCount) + numberValue(record?.infertileCount) + numberValue(record?.unknownCount);
}

function eggSummary(record) {
    if (!record) return '기록 없음';
    return `유 ${numberValue(record.fertileCount)} / 무 ${numberValue(record.infertileCount)} / 미 ${numberValue(record.unknownCount)}`;
}

function latestClutch(gecko) {
    return recordsOf(gecko)[0] || null;
}

function activeEggCount(gecko) {
    return recordsOf(gecko).reduce((sum, record) => (
        ACTIVE_EGG_STATUSES.has(record.eggStatus) ? sum + eggTotal(record) : sum
    ), 0);
}

function searchText(gecko) {
    return [
        gecko.number,
        gecko.name,
        displaySex(gecko),
        gecko.status,
        gecko.location,
        gecko.morph,
        gecko.pairedWithNumber,
        gecko.motherNumber,
        gecko.fatherNumber,
        gecko.memo,
        ...(gecko.tags || [])
    ].join(' ').toLowerCase();
}

function filteredGeckos(query = '', sex = 'all') {
    const lower = String(query || '').trim().toLowerCase();
    return state.geckos
        .filter((gecko) => sex === 'all' || displaySex(gecko) === sex)
        .filter((gecko) => !lower || searchText(gecko).includes(lower))
        .sort((a, b) => String(a.number || '').localeCompare(String(b.number || ''), 'ko', { numeric: true })
            || String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
}

function incrementTrailingText(start, step = 1) {
    const text = String(start || '').trim();
    if (!text) return '';
    const match = text.match(/^(.*?)(\d+)$/);
    if (!match) return step === 0 ? text : `${text}${step + 1}`;
    return `${match[1]}${String(Number(match[2]) + step).padStart(match[2].length, '0')}`;
}

function passwordValue(input) {
    const value = input.value.trim();
    if (value) {
        localStorage.setItem(ADMIN_PASSWORD_KEY, value);
        syncPasswords(value);
    }
    return value;
}

function syncPasswords(value = localStorage.getItem(ADMIN_PASSWORD_KEY) || '') {
    $$('[data-admin-password]').forEach((input) => {
        if (!input.value) input.value = value;
    });
}

function setMode(mode) {
    el.modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.gxMode === mode));
    el.modePanels.forEach((panel) => panel.classList.toggle('hidden', panel.dataset.gxPanel !== mode));
    if (mode === 'register') setTimeout(() => el.regName.focus(), 40);
    if (mode === 'clutch') setTimeout(() => el.clutchFemaleSearch.focus(), 40);
    if (mode === 'manage') setTimeout(() => el.manageSearch.focus(), 40);
}

function setSex(value) {
    selectedSex = value;
    el.sexButtons.forEach((button) => button.classList.toggle('active', button.dataset.sex === value));
}

function setActivityStatus(value) {
    activityStatus = value;
    el.activityStatusButtons.forEach((button) => button.classList.toggle('active', button.dataset.activityStatus === value));
}

function renderHeader() {
    el.total.textContent = `${state.count || state.geckos.length}마리`;
    if (!state.updatedAt) {
        el.updated.textContent = '저장 전';
        return;
    }
    const date = new Date(state.updatedAt);
    el.updated.textContent = Number.isNaN(date.getTime())
        ? '저장됨'
        : `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} 저장`;
}

function updateRegisterPreview() {
    if (!el.regContinue.checked) {
        el.regNextPreview.textContent = '저장 후 현재 입력값을 유지합니다.';
        return;
    }
    const nextName = incrementTrailingText(el.regName.value, 1);
    const nextNumber = incrementTrailingText(el.regNumber.value, 1);
    el.regNextPreview.textContent = `저장 후 다음 값: ${nextName || '이름 비움'}${nextNumber ? ` / ${nextNumber}` : ''}`;
}

function resetRegister(keepShared = false) {
    const shared = keepShared ? {
        location: el.regLocation.value,
        morph: el.regMorph.value,
        pair: el.regPair.value,
        pairDate: el.regPairDate.value,
        mother: el.regMother.value,
        father: el.regFather.value
    } : null;
    el.registerForm.reset();
    setSex(keepShared ? selectedSex : '미구분');
    el.regContinue.checked = true;
    if (shared) {
        el.regLocation.value = shared.location;
        el.regMorph.value = shared.morph;
        el.regPair.value = shared.pair;
        el.regPairDate.value = shared.pairDate;
        el.regMother.value = shared.mother;
        el.regFather.value = shared.father;
    }
    syncPasswords();
    updateRegisterPreview();
}

function registerPayload(existing = null) {
    return {
        id: existing?.id || '',
        number: el.regNumber.value.trim(),
        name: el.regName.value.trim(),
        sex: apiSex(selectedSex),
        status: existing?.status || '보유',
        location: el.regLocation.value.trim(),
        morph: el.regMorph.value.trim(),
        pairedWithNumber: el.regPair.value.trim(),
        pairingDate: el.regPairDate.value,
        motherNumber: el.regMother.value.trim(),
        fatherNumber: el.regFather.value.trim(),
        memo: el.regMemo.value.trim(),
        eggRecords: existing?.eggRecords || [],
        activityRecords: existing?.activityRecords || [],
        tags: existing?.tags || []
    };
}

async function saveRegister(event) {
    event.preventDefault();
    const adminPassword = passwordValue(el.regPassword);
    const name = el.regName.value.trim();
    const number = el.regNumber.value.trim();
    const existing = geckoByNumber(number);
    const shouldContinue = el.regContinue.checked && !existing;

    if (!name) return toast('이름 필요', '이름만은 입력해야 나중에 찾기 쉽습니다.', 'error');
    if (!adminPassword) return toast('비밀번호 필요', '관리 비밀번호를 입력하세요.', 'error');

    try {
        const data = await api('/api/geckos', {
            method: 'POST',
            body: JSON.stringify({ adminPassword, gecko: registerPayload(existing) })
        });
        state = data;
        selectedGeckoId = data.saved?.id || selectedGeckoId;
        renderAll();
        if (shouldContinue) {
            const saved = data.saved || {};
            el.regName.value = incrementTrailingText(saved.name || name, 1);
            el.regNumber.value = incrementTrailingText(saved.number || number, 1);
            el.regMemo.value = '';
            updateRegisterPreview();
            setTimeout(() => el.regName.focus(), 40);
            toast('저장 완료', `${titleOf(saved)} 저장, 다음 개체 준비`);
        } else {
            toast('저장 완료', titleOf(data.saved));
        }
    } catch (err) {
        toast('저장 실패', err.message, 'error');
    }
}

function parseImportRows(text) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    const map = {
        번호: 'number',
        넘버: 'number',
        넘버링: 'number',
        number: 'number',
        이름: 'name',
        name: 'name',
        성별: 'sex',
        sex: 'sex',
        상태: 'status',
        status: 'status',
        모프: 'morph',
        morph: 'morph',
        위치: 'location',
        location: 'location',
        페어: 'pairedWithNumber',
        페어수컷: 'pairedWithNumber',
        합사일: 'pairingDate',
        어미: 'motherNumber',
        모: 'motherNumber',
        아비: 'fatherNumber',
        부: 'fatherNumber',
        메모: 'memo'
    };
    const headers = lines[0].split(delimiter).map((item) => item.trim());
    return lines.slice(1).map((line) => {
        const row = {};
        line.split(delimiter).forEach((value, index) => {
            const key = map[headers[index]] || headers[index];
            row[key] = String(value || '').trim();
        });
        return row;
    }).filter((row) => row.number || row.name);
}

async function importGeckos(event) {
    event.preventDefault();
    const adminPassword = passwordValue(el.importPassword);
    const geckos = parseImportRows(el.importText.value);
    if (!adminPassword) return toast('비밀번호 필요', '관리 비밀번호를 입력하세요.', 'error');
    if (!geckos.length) return toast('데이터 없음', '붙여넣은 표를 확인하세요.', 'error');
    try {
        state = await api('/api/geckos/import', {
            method: 'POST',
            body: JSON.stringify({ adminPassword, geckos })
        });
        el.importText.value = '';
        renderAll();
        toast('가져오기 완료', `${geckos.length}건 처리`);
    } catch (err) {
        toast('가져오기 실패', err.message, 'error');
    }
}

function suggestButton(gecko, onPick) {
    const button = node('button', 'gxSuggestItem');
    button.type = 'button';
    button.append(
        node('strong', '', titleOf(gecko)),
        node('span', '', [displaySex(gecko), gecko.location, gecko.pairedWithNumber ? `페어 ${gecko.pairedWithNumber}` : ''].filter(Boolean).join(' · '))
    );
    button.addEventListener('click', () => onPick(gecko));
    return button;
}

function renderFemaleSuggestions() {
    const query = el.clutchFemaleSearch.value.trim().toLowerCase();
    el.clutchFemaleSuggest.replaceChildren();
    if (!query) return;
    const list = filteredGeckos(query)
        .sort((a, b) => (displaySex(b) === '암컷') - (displaySex(a) === '암컷'))
        .slice(0, 10);
    if (!list.length) {
        el.clutchFemaleSuggest.append(node('div', 'gxSuggestEmpty', '검색 결과 없음'));
        return;
    }
    list.forEach((gecko) => el.clutchFemaleSuggest.append(suggestButton(gecko, setClutchFemale)));
}

function setClutchFemale(gecko) {
    selectedFemaleId = gecko?.id || '';
    el.clutchFemaleSearch.value = gecko ? titleOf(gecko) : '';
    el.clutchFemaleLabel.textContent = gecko ? titleOf(gecko) : '암컷을 선택하세요.';
    el.clutchMate.value = gecko?.pairedWithNumber || '';
    el.clutchPairHint.textContent = gecko?.pairedWithNumber
        ? `페어 수컷 ${gecko.pairedWithNumber} 자동 연결`
        : '페어 수컷이 없으면 직접 입력하세요.';
    el.clutchFemaleSuggest.replaceChildren();
}

function setEggPreset(button) {
    const [fertile, infertile, unknown] = button.dataset.eggPreset.split(',');
    el.clutchFertile.value = fertile;
    el.clutchInfertile.value = infertile;
    el.clutchUnknown.value = unknown;
    el.eggPresetButtons.forEach((item) => item.classList.toggle('active', item === button));
    updateClutchPreview();
}

function updateClutchPreview() {
    const date = el.clutchLayDate.value || todayValue();
    el.clutchPreview.textContent = `${date} 산란 · 유정 ${numberValue(el.clutchFertile.value)} / 무정 ${numberValue(el.clutchInfertile.value)} / 미확인 ${numberValue(el.clutchUnknown.value)}`;
}

function clutchRecord() {
    return {
        id: makeId(),
        layDate: el.clutchLayDate.value || todayValue(),
        eggStatus: '보관중',
        fertileCount: numberValue(el.clutchFertile.value),
        infertileCount: numberValue(el.clutchInfertile.value),
        unknownCount: numberValue(el.clutchUnknown.value),
        incubationLocation: el.clutchIncubation.value.trim(),
        mateNumber: el.clutchMate.value.trim(),
        memo: el.clutchMemo.value.trim(),
        createdAt: new Date().toISOString()
    };
}

async function saveClutch(event) {
    event.preventDefault();
    const gecko = geckoById(selectedFemaleId);
    const adminPassword = passwordValue(el.clutchPassword);
    const record = clutchRecord();

    if (!gecko) return toast('암컷 선택 필요', '산란한 암컷을 먼저 선택하세요.', 'error');
    if (eggTotal(record) === 0) return toast('알 개수 확인', '유정, 무정, 미확인 중 하나는 입력하세요.', 'error');
    if (!adminPassword) return toast('비밀번호 필요', '관리 비밀번호를 입력하세요.', 'error');

    try {
        const data = await api('/api/geckos', {
            method: 'POST',
            body: JSON.stringify({
                adminPassword,
                gecko: {
                    ...gecko,
                    sex: displaySex(gecko) === '미구분' ? '암' : gecko.sex,
                    pairedWithNumber: gecko.pairedWithNumber || record.mateNumber,
                    eggRecords: [record, ...recordsOf(gecko)]
                }
            })
        });
        state = data;
        selectedGeckoId = data.saved?.id || selectedGeckoId;
        setClutchFemale(null);
        el.clutchMemo.value = '';
        renderAll();
        toast('산란 저장 완료', titleOf(data.saved));
        setTimeout(() => el.clutchFemaleSearch.focus(), 40);
    } catch (err) {
        toast('산란 저장 실패', err.message, 'error');
    }
}

function manageList() {
    return filteredGeckos(el.manageSearch.value, el.manageSexFilter.value);
}

function renderManageRows() {
    const list = manageList();
    el.manageRows.replaceChildren();
    el.manageEmpty.classList.toggle('hidden', list.length > 0);
    list.forEach((gecko) => {
        const latest = latestClutch(gecko);
        const tr = document.createElement('tr');
        tr.className = gecko.id === selectedGeckoId ? 'active' : '';
        const nameCell = document.createElement('td');
        nameCell.append(node('strong', '', titleOf(gecko)), node('span', '', gecko.morph || '-'));
        tr.append(
            nameCell,
            node('td', '', displaySex(gecko)),
            node('td', '', gecko.location || '-'),
            node('td', '', gecko.pairedWithNumber || '-'),
            node('td', '', latest ? `${shortDate(latest.layDate)} · ${eggSummary(latest)}` : '-')
        );
        tr.addEventListener('click', () => {
            selectedGeckoId = gecko.id;
            renderManageRows();
            renderDetail();
        });
        el.manageRows.append(tr);
    });
    if (!geckoById(selectedGeckoId) && list[0]) selectedGeckoId = list[0].id;
    renderDetail();
}

function infoRow(label, value) {
    const row = node('div', 'gxInfoRow');
    row.append(node('span', '', label), node('strong', '', value || '-'));
    return row;
}

function timeline(records, emptyText) {
    const wrap = node('div', 'gxTimeline');
    if (!records.length) {
        wrap.append(node('div', 'gxEmpty', emptyText));
        return wrap;
    }
    records.forEach((record) => {
        const item = node('article', 'gxTimelineItem');
        item.append(node('strong', '', record.title), node('span', '', record.meta || '-'));
        if (record.memo) item.append(node('p', '', record.memo));
        wrap.append(item);
    });
    return wrap;
}

function renderDetail() {
    const gecko = geckoById(selectedGeckoId);
    el.editSelectedButton.disabled = !gecko;
    el.activityForm.classList.toggle('hidden', !gecko);
    if (!gecko) {
        el.detailTitle.textContent = '개체를 선택하세요';
        el.detailBody.className = 'gxEmpty';
        el.detailBody.textContent = '표에서 개체를 누르면 정보가 표시됩니다.';
        return;
    }

    el.detailTitle.textContent = titleOf(gecko);
    el.detailBody.className = 'gxDetailBody';
    el.detailBody.replaceChildren();

    const info = node('section', 'gxInfoGrid');
    info.append(
        infoRow('성별', displaySex(gecko)),
        infoRow('위치', gecko.location),
        infoRow('모프', gecko.morph),
        infoRow('페어 수컷', gecko.pairedWithNumber),
        infoRow('보관 알', activeEggCount(gecko) ? `${activeEggCount(gecko)}개` : ''),
        infoRow('메모', gecko.memo)
    );

    const eggs = recordsOf(gecko).map((record) => ({
        title: `${shortDate(record.layDate)} 산란 · ${eggSummary(record)}`,
        meta: [record.incubationLocation, record.mateNumber ? `수컷 ${record.mateNumber}` : ''].filter(Boolean).join(' · '),
        memo: record.memo
    }));
    const acts = activitiesOf(gecko).map((record) => ({
        title: `${shortDate(record.date)} ${record.status}`,
        meta: record.memo || record.location || '-',
        memo: ''
    }));

    el.detailBody.append(
        info,
        node('h3', 'gxSectionTitle', '산란 기록'),
        timeline(eggs, '산란 기록이 없습니다.'),
        node('h3', 'gxSectionTitle', '상태 메모'),
        timeline(acts, '먹이·탈피 메모가 없습니다.')
    );
}

function fillRegisterFromSelected() {
    const gecko = geckoById(selectedGeckoId);
    if (!gecko) return;
    setMode('register');
    setSex(displaySex(gecko));
    el.regName.value = gecko.name || '';
    el.regNumber.value = gecko.number || '';
    el.regLocation.value = gecko.location || '';
    el.regMorph.value = gecko.morph || '';
    el.regPair.value = gecko.pairedWithNumber || '';
    el.regPairDate.value = gecko.pairingDate || '';
    el.regMother.value = gecko.motherNumber || '';
    el.regFather.value = gecko.fatherNumber || '';
    el.regMemo.value = gecko.memo || '';
    el.regContinue.checked = false;
    updateRegisterPreview();
}

async function saveActivity(event) {
    event.preventDefault();
    const gecko = geckoById(selectedGeckoId);
    const adminPassword = passwordValue(el.activityPassword);
    if (!gecko) return toast('개체 선택 필요', '개체를 먼저 선택하세요.', 'error');
    if (!adminPassword) return toast('비밀번호 필요', '관리 비밀번호를 입력하세요.', 'error');

    const record = {
        id: makeId(),
        type: '상태메모',
        date: todayValue(),
        status: activityStatus,
        location: gecko.location || '',
        memo: el.activityMemo.value.trim(),
        createdAt: new Date().toISOString()
    };

    try {
        const data = await api('/api/geckos', {
            method: 'POST',
            body: JSON.stringify({
                adminPassword,
                gecko: {
                    ...gecko,
                    tags: [...new Set([...(gecko.tags || []), '확인필요'])],
                    activityRecords: [record, ...activitiesOf(gecko)]
                }
            })
        });
        state = data;
        selectedGeckoId = data.saved?.id || selectedGeckoId;
        el.activityMemo.value = '';
        renderAll();
        toast('메모 저장 완료', `${titleOf(data.saved)} · ${activityStatus}`);
    } catch (err) {
        toast('메모 저장 실패', err.message, 'error');
    }
}

function renderAll() {
    renderHeader();
    renderManageRows();
    updateRegisterPreview();
    updateClutchPreview();
}

async function load() {
    try {
        state = await api('/api/geckos');
        el.clutchLayDate.value = todayValue();
        syncPasswords();
        selectedGeckoId = state.geckos[0]?.id || '';
        renderAll();
    } catch (err) {
        toast('불러오기 실패', err.message, 'error');
    }
}

el.modeButtons.forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.gxMode));
});
el.sexButtons.forEach((button) => {
    button.addEventListener('click', () => setSex(button.dataset.sex));
});
el.activityStatusButtons.forEach((button) => {
    button.addEventListener('click', () => setActivityStatus(button.dataset.activityStatus));
});
el.eggPresetButtons.forEach((button) => {
    button.addEventListener('click', () => setEggPreset(button));
});

el.registerForm.addEventListener('submit', saveRegister);
el.resetRegisterButton.addEventListener('click', () => resetRegister(false));
el.importForm.addEventListener('submit', importGeckos);
el.clutchForm.addEventListener('submit', saveClutch);
el.activityForm.addEventListener('submit', saveActivity);
el.editSelectedButton.addEventListener('click', fillRegisterFromSelected);

[el.regName, el.regNumber, el.regContinue].forEach((input) => {
    input.addEventListener('input', updateRegisterPreview);
    input.addEventListener('change', updateRegisterPreview);
});
[el.clutchLayDate, el.clutchFertile, el.clutchInfertile, el.clutchUnknown].forEach((input) => {
    input.addEventListener('input', updateClutchPreview);
    input.addEventListener('change', updateClutchPreview);
});

el.clutchFemaleSearch.addEventListener('input', () => {
    selectedFemaleId = '';
    el.clutchFemaleLabel.textContent = '암컷을 선택하세요.';
    el.clutchPairHint.textContent = '개체 정보에 페어 수컷이 있으면 자동으로 연결됩니다.';
    el.clutchMate.value = '';
    renderFemaleSuggestions();
});
el.clutchFemaleSearch.addEventListener('focus', renderFemaleSuggestions);
el.manageSearch.addEventListener('input', renderManageRows);
el.manageSexFilter.addEventListener('change', renderManageRows);

$$('[data-admin-password]').forEach((input) => {
    input.addEventListener('input', () => {
        if (input.value.trim()) localStorage.setItem(ADMIN_PASSWORD_KEY, input.value.trim());
    });
});

document.addEventListener('click', (event) => {
    if (event.target.closest('.gxSuggest, .gxSearchField')) return;
    $$('.gxSuggest').forEach((host) => host.replaceChildren());
});

setSex(selectedSex);
setActivityStatus(activityStatus);
load();
