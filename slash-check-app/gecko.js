const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ACTOR_NAME_KEY = 'geckoActorName';
const ACTIVE_EGG_STATUSES = new Set(['보관중', '관찰']);

const el = {
    modeButtons: $$('[data-gx-mode]'),
    modePanels: $$('[data-gx-panel]'),
    total: $('#gxTotal'),
    updated: $('#gxUpdated'),
    toastHost: $('#toastHost'),

    actorButton: $('#actorButton'),
    actorModal: $('#actorModal'),
    actorForm: $('#actorForm'),
    actorCloseButton: $('#actorCloseButton'),
    actorNameInput: $('#actorNameInput'),

    registerForm: $('#registerForm'),
    resetRegisterButton: $('#resetRegisterButton'),
    seedExamplesButton: $('#seedExamplesButton'),
    registerKindButtons: $$('[data-register-kind]'),
    registerKindHint: $('#registerKindHint'),
    pairFields: $$('.gxPairField'),
    parentFields: $$('.gxParentField'),
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
    importForm: $('#importForm'),
    importText: $('#importText'),

    clutchForm: $('#clutchForm'),
    clutchFemaleSearch: $('#clutchFemaleSearch'),
    clutchFemaleSuggest: $('#clutchFemaleSuggest'),
    clutchQuickList: $('#clutchQuickList'),
    clutchFormTitle: $('#clutchFormTitle'),
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
    clutchSubmitButton: $('#clutchSubmitButton'),
    cancelEggEditButton: $('#cancelEggEditButton'),

    manageSearch: $('#manageSearch'),
    manageSexFilter: $('#manageSexFilter'),
    manageRows: $('#manageRows'),
    manageCards: $('#manageCards'),
    manageEmpty: $('#manageEmpty'),
    detailTitle: $('#detailTitle'),
    detailBody: $('#detailBody'),
    clutchSelectedButton: $('#clutchSelectedButton'),
    editSelectedButton: $('#editSelectedButton'),
    deleteSelectedButton: $('#deleteSelectedButton'),
    pairForm: $('#pairForm'),
    pairManageMate: $('#pairManageMate'),
    pairManageDate: $('#pairManageDate'),
    pairClearButton: $('#pairClearButton'),
    activityForm: $('#activityForm'),
    activityTitle: $('#activityTitle'),
    activityStatusButtons: $$('[data-activity-status]'),
    activityMemo: $('#activityMemo'),
    activitySubmitButton: $('#activitySubmitButton'),
    cancelActivityEditButton: $('#cancelActivityEditButton')
};

let state = { geckos: [], count: 0, logs: [], updatedAt: null };
let registerKind = 'general';
let selectedSex = '미구분';
let selectedFemaleId = '';
let selectedGeckoId = '';
let editingGeckoId = '';
let editingEggId = '';
let editingActivityId = '';
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

function currentActor() {
    return (localStorage.getItem(ACTOR_NAME_KEY) || '').trim();
}

function renderActor() {
    const actor = currentActor();
    el.actorButton.textContent = actor ? `작업자 · ${actor}` : '작업자 설정';
    el.actorButton.classList.toggle('isMissing', false);
}

function openActorModal(force = false) {
    el.actorModal.classList.add('open');
    el.actorModal.dataset.force = force ? 'true' : 'false';
    el.actorNameInput.value = currentActor();
    setTimeout(() => el.actorNameInput.focus(), 40);
}

function closeActorModal() {
    el.actorModal.classList.remove('open');
}

function requireActor() {
    const actor = currentActor();
    return actor || '익명';
}

function titleOf(gecko) {
    return `${gecko?.number || ''} ${gecko?.name || ''}`.trim() || '이름 없음';
}

function displaySex(gecko) {
    if (gecko?.sex === '암') return '암컷';
    if (gecko?.sex === '수') return '수컷';
    if (gecko?.sex === '미확인') return '미구분';
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
        .sort((a, b) => String(b.layDate || '').localeCompare(String(a.layDate || ''))
            || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
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

function setMode(mode) {
    if (mode === 'clutch') mode = 'manage';
    el.modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.gxMode === mode));
    el.modePanels.forEach((panel) => panel.classList.toggle('hidden', panel.dataset.gxPanel !== mode));
    if (mode === 'register') setTimeout(() => el.regName.focus(), 40);
    if (mode === 'manage') setTimeout(() => el.manageSearch.focus(), 40);
}

function setSex(value) {
    selectedSex = value;
    el.sexButtons.forEach((button) => button.classList.toggle('active', button.dataset.sex === value));
}

function setRegisterKind(kind) {
    registerKind = kind === 'hatch' ? 'hatch' : 'general';
    el.registerKindButtons.forEach((button) => button.classList.toggle('active', button.dataset.registerKind === registerKind));
    el.parentFields.forEach((field) => field.classList.toggle('hidden', registerKind !== 'hatch'));
    el.pairFields.forEach((field) => field.classList.add('hidden'));

    if (registerKind === 'hatch') {
        setSex('미구분');
        el.registerKindHint.textContent = '해칭 개체는 어미/아비가 핵심입니다. 위치와 모프는 공통값으로 계속 이어가면 편합니다.';
    } else {
        el.registerKindHint.textContent = '일반 개체는 이름만 넣어도 저장됩니다. 위치와 모프는 필요할 때만 채우세요.';
    }
}

function setActivityStatus(value) {
    activityStatus = value;
    el.activityStatusButtons.forEach((button) => button.classList.toggle('active', button.dataset.activityStatus === value));
}

function renderHeader() {
    el.total.textContent = `${state.count || state.geckos.length}마리`;
    if (!state.updatedAt) {
        el.updated.textContent = '-';
        return;
    }
    const date = new Date(state.updatedAt);
    el.updated.textContent = Number.isNaN(date.getTime())
        ? '-'
        : `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function updateRegisterPreview() {
    if (!el.regContinue.checked) {
        el.regNextPreview.textContent = '현재 입력값만 저장합니다.';
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
    editingGeckoId = '';
    el.registerForm.reset();
    setRegisterKind(keepShared ? registerKind : 'general');
    if (!keepShared) setSex('미구분');
    el.regContinue.checked = true;
    if (shared) {
        el.regLocation.value = shared.location;
        el.regMorph.value = shared.morph;
        el.regPair.value = shared.pair;
        el.regPairDate.value = shared.pairDate;
        el.regMother.value = shared.mother;
        el.regFather.value = shared.father;
    }
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
        pairedWithNumber: registerKind === 'breeding' ? el.regPair.value.trim() : (existing?.pairedWithNumber || ''),
        pairingDate: registerKind === 'breeding' ? el.regPairDate.value : (existing?.pairingDate || ''),
        motherNumber: registerKind === 'hatch' ? el.regMother.value.trim() : (existing?.motherNumber || ''),
        fatherNumber: registerKind === 'hatch' ? el.regFather.value.trim() : (existing?.fatherNumber || ''),
        memo: el.regMemo.value.trim(),
        eggRecords: existing?.eggRecords || [],
        activityRecords: existing?.activityRecords || [],
        tags: existing?.tags || []
    };
}

async function saveGecko(gecko, { action, detail }) {
    const actor = requireActor();
    if (!actor) return null;
    return api('/api/geckos', {
        method: 'POST',
        body: JSON.stringify({ actor, action, detail, gecko })
    });
}

async function saveRegister(event) {
    event.preventDefault();
    const name = el.regName.value.trim();
    const number = el.regNumber.value.trim();
    const editing = geckoById(editingGeckoId);
    const existing = editing || geckoByNumber(number);
    const shouldContinue = el.regContinue.checked && !existing;

    if (!name) return toast('이름 필요', '이름만은 입력해야 나중에 찾기 쉽습니다.', 'error');

    try {
        const data = await saveGecko(registerPayload(existing), {
            action: existing ? '개체 수정' : '개체 등록',
            detail: name
        });
        if (!data) return;
        state = data;
        selectedGeckoId = data.saved?.id || selectedGeckoId;
        editingGeckoId = '';
        renderAll();
        if (shouldContinue) {
            const saved = data.saved || {};
            el.regName.value = incrementTrailingText(saved.name || name, 1);
            el.regNumber.value = incrementTrailingText(saved.number || number, 1);
            el.regMemo.value = '';
            updateRegisterPreview();
            setTimeout(() => el.regName.focus(), 40);
            toast('저장 완료', `${titleOf(saved)} 저장 · 다음 개체 준비`);
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
        페어일: 'pairingDate',
        어미: 'motherNumber',
        엄마: 'motherNumber',
        아비: 'fatherNumber',
        아빠: 'fatherNumber',
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
    const actor = requireActor();
    const geckos = parseImportRows(el.importText.value);
    if (!actor) return;
    if (!geckos.length) return toast('데이터 없음', '붙여넣은 표를 확인하세요.', 'error');
    try {
        state = await api('/api/geckos/import', {
            method: 'POST',
            body: JSON.stringify({ actor, geckos })
        });
        el.importText.value = '';
        renderAll();
        toast('가져오기 완료', `${state.added || geckos.length}건 추가 / ${state.updated || 0}건 수정`);
    } catch (err) {
        toast('가져오기 실패', err.message, 'error');
    }
}

function exampleGeckos() {
    const today = todayValue();
    const actor = currentActor() || '예시';
    const babies = Array.from({ length: 12 }, (_, index) => {
        const num = index + 1;
        const pairIndex = Math.floor(index / 4) + 1;
        return {
            number: `EX-B-${String(num).padStart(3, '0')}`,
            name: `베이비${String(num).padStart(2, '0')}`,
            sex: '미구분',
            location: `베이비 랙 ${Math.floor(index / 6) + 1}`,
            morph: ['미확인', '할리퀸', '릴리 가능', '달마시안'][index % 4],
            motherNumber: `EX-F-${String(pairIndex).padStart(3, '0')}`,
            fatherNumber: `EX-M-${String(pairIndex).padStart(3, '0')}`,
            memo: index < 2 ? '해칭 개체 연속 등록 예시' : ''
        };
    });

    return [
        {
            number: 'EX-F-001',
            name: '달콩',
            sex: '암',
            location: '브리딩 랙 A-1',
            morph: '릴리화이트',
            pairedWithNumber: 'EX-M-001',
            pairingDate: today,
            memo: '예시 암컷입니다. 실제 사용 전 수정하거나 삭제해도 됩니다.',
            eggRecords: [
                {
                    id: makeId(),
                    layDate: today,
                    fertileCount: 2,
                    infertileCount: 0,
                    unknownCount: 0,
                    eggStatus: '보관중',
                    incubationLocation: '인큐 1',
                    mateNumber: 'EX-M-001',
                    memo: '유정 2개 예시',
                    actor,
                    createdAt: new Date().toISOString()
                }
            ],
            activityRecords: [
                {
                    id: makeId(),
                    type: '상태메모',
                    date: today,
                    status: '안먹음',
                    memo: '예시 메모입니다. 클릭해서 수정하거나 삭제할 수 있습니다.',
                    actor,
                    createdAt: new Date().toISOString()
                }
            ]
        },
        {
            number: 'EX-F-002',
            name: '루나',
            sex: '암',
            location: '브리딩 랙 A-2',
            morph: '트라이컬러',
            pairedWithNumber: 'EX-M-002',
            pairingDate: today,
            memo: '산란 기록 입력 예시',
            eggRecords: [{
                id: makeId(),
                layDate: today,
                fertileCount: 1,
                infertileCount: 1,
                unknownCount: 0,
                eggStatus: '관찰',
                incubationLocation: '인큐 2',
                mateNumber: 'EX-M-002',
                memo: '유1 무1 예시',
                actor,
                createdAt: new Date().toISOString()
            }]
        },
        {
            number: 'EX-F-003',
            name: '라떼',
            sex: '암',
            location: '브리딩 랙 B-1',
            morph: '익스트림 할리퀸',
            pairedWithNumber: 'EX-M-003',
            memo: '페어 준비 예시'
        },
        {
            number: 'EX-F-004',
            name: '복숭',
            sex: '암',
            location: '브리딩 랙 B-2',
            morph: '릴리화이트',
            pairedWithNumber: 'EX-M-004',
            memo: '브리딩 암컷 예시'
        },
        {
            number: 'EX-M-001',
            name: '모카',
            sex: '수',
            location: '브리딩 랙 A-1',
            morph: '할리퀸',
            memo: '페어 수컷 예시'
        },
        {
            number: 'EX-M-002',
            name: '밤톨',
            sex: '수',
            location: '브리딩 랙 A-2',
            morph: '핀스트라이프',
            memo: '페어 수컷 예시'
        },
        {
            number: 'EX-M-003',
            name: '쿠키',
            sex: '수',
            location: '브리딩 랙 B-1',
            morph: '달마시안',
            memo: '페어 수컷 예시'
        },
        {
            number: 'EX-M-004',
            name: '흑당',
            sex: '수',
            location: '브리딩 랙 B-2',
            morph: '다크 할리퀸',
            memo: '페어 수컷 예시'
        },
        ...babies
    ];
}

async function seedExamples() {
    const actor = requireActor();
    if (!actor) return;
    try {
        state = await api('/api/geckos/import', {
            method: 'POST',
            body: JSON.stringify({ actor, geckos: exampleGeckos() })
        });
        renderAll();
        toast('예시 추가 완료', '수정/삭제 테스트용 예시 20건을 넣었습니다.');
    } catch (err) {
        toast('예시 추가 실패', err.message, 'error');
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
    if (!el.clutchFemaleSearch || !el.clutchFemaleSuggest) return;
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

function clutchCandidates() {
    return state.geckos
        .filter((gecko) => displaySex(gecko) === '암컷' || gecko.pairedWithNumber || recordsOf(gecko).length)
        .sort((a, b) => {
            const aLatest = latestClutch(a)?.layDate || '';
            const bLatest = latestClutch(b)?.layDate || '';
            return String(bLatest).localeCompare(String(aLatest))
                || String(a.number || '').localeCompare(String(b.number || ''), 'ko', { numeric: true });
        })
        .slice(0, 10);
}

function renderClutchQuickList() {
    if (!el.clutchQuickList) return;
    el.clutchQuickList.replaceChildren();
    const list = clutchCandidates();
    if (!list.length) {
        el.clutchQuickList.append(node('div', 'gxQuickEmpty', '브리딩 암컷을 등록하면 여기에 바로 뜹니다.'));
        return;
    }
    list.forEach((gecko) => {
        const latest = latestClutch(gecko);
        const button = node('button', gecko.id === selectedFemaleId ? 'gxQuickPick active' : 'gxQuickPick');
        button.type = 'button';
        button.append(
            node('strong', '', titleOf(gecko)),
            node('span', '', [
                gecko.pairedWithNumber ? `수컷 ${gecko.pairedWithNumber}` : '페어 없음',
                latest ? `최근 ${shortDate(latest.layDate)}` : '산란 기록 없음'
            ].join(' · '))
        );
        button.addEventListener('click', () => setClutchFemale(gecko));
        el.clutchQuickList.append(button);
    });
}

function setClutchFemale(gecko) {
    selectedFemaleId = gecko?.id || '';
    if (el.clutchFemaleSearch) el.clutchFemaleSearch.value = gecko ? titleOf(gecko) : '';
    el.clutchFemaleLabel.textContent = gecko ? `${titleOf(gecko)} 산란 입력` : '개체를 선택하세요';
    el.clutchMate.value = gecko?.pairedWithNumber || '';
    el.clutchPairHint.textContent = gecko?.pairedWithNumber
        ? `페어 수컷 ${gecko.pairedWithNumber} 자동 연결`
        : '메이팅 정보가 없으면 페어 수컷을 직접 입력하세요.';
    if (el.clutchFemaleSuggest) el.clutchFemaleSuggest.replaceChildren();
    renderClutchQuickList();
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

function resetClutchInputs(gecko = geckoById(selectedFemaleId)) {
    el.clutchLayDate.value = todayValue();
    el.clutchFertile.value = '2';
    el.clutchInfertile.value = '0';
    el.clutchUnknown.value = '0';
    el.clutchIncubation.value = '';
    el.clutchMate.value = gecko?.pairedWithNumber || '';
    el.clutchMemo.value = '';
    updateClutchPreview();
}

function clutchRecord(existing = null) {
    const now = new Date().toISOString();
    return {
        id: existing?.id || makeId(),
        layDate: el.clutchLayDate.value || todayValue(),
        eggStatus: existing?.eggStatus || '보관중',
        fertileCount: numberValue(el.clutchFertile.value),
        infertileCount: numberValue(el.clutchInfertile.value),
        unknownCount: numberValue(el.clutchUnknown.value),
        incubationLocation: el.clutchIncubation.value.trim(),
        mateNumber: el.clutchMate.value.trim() || el.pairManageMate.value.trim(),
        memo: el.clutchMemo.value.trim(),
        actor: currentActor(),
        createdAt: existing?.createdAt || now,
        updatedAt: now
    };
}

function clearEggEdit() {
    editingEggId = '';
    el.cancelEggEditButton.classList.add('hidden');
    el.clutchSubmitButton.textContent = '산란 저장';
    if (el.clutchFormTitle) el.clutchFormTitle.textContent = '산란 정보';
    resetClutchInputs(geckoById(selectedFemaleId));
}

async function saveClutch(event) {
    event.preventDefault();
    const gecko = geckoById(selectedFemaleId);
    const existingRecord = editingEggId ? recordsOf(gecko).find((record) => record.id === editingEggId) : null;
    const record = clutchRecord(existingRecord);

    if (!gecko) return toast('암컷 선택 필요', '산란한 암컷을 먼저 선택하세요.', 'error');
    if (eggTotal(record) === 0) return toast('알 개수 확인', '유정, 무정, 미확인 중 하나는 입력하세요.', 'error');

    const nextRecords = editingEggId
        ? recordsOf(gecko).map((item) => item.id === editingEggId ? record : item)
        : [record, ...recordsOf(gecko)];
    const wasEditing = Boolean(editingEggId);

    try {
        const data = await saveGecko({
            ...gecko,
            sex: displaySex(gecko) === '미구분' ? '암' : gecko.sex,
            pairedWithNumber: record.mateNumber || gecko.pairedWithNumber,
            pairingDate: gecko.pairingDate || el.pairManageDate.value,
            eggRecords: nextRecords
        }, {
            action: editingEggId ? '산란 기록 수정' : '산란 기록',
            detail: `${shortDate(record.layDate)} · ${eggSummary(record)}`
        });
        if (!data) return;
        state = data;
        selectedGeckoId = data.saved?.id || selectedGeckoId;
        selectedFemaleId = selectedGeckoId;
        setClutchFemale(data.saved || geckoById(selectedGeckoId));
        editingEggId = '';
        el.cancelEggEditButton.classList.add('hidden');
        el.clutchSubmitButton.textContent = '산란 저장';
        if (el.clutchFormTitle) el.clutchFormTitle.textContent = '산란 정보';
        resetClutchInputs(data.saved || geckoById(selectedGeckoId));
        renderAll();
        toast(wasEditing ? '산란 수정 완료' : '산란 저장 완료', titleOf(data.saved));
        setTimeout(() => el.clutchFertile.focus(), 40);
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
    el.manageCards.replaceChildren();
    el.manageEmpty.classList.toggle('hidden', list.length > 0);
    if (!geckoById(selectedGeckoId) && list[0]) selectedGeckoId = list[0].id;

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
            editingEggId = '';
            clearActivityEdit();
            renderManageRows();
        });
        el.manageRows.append(tr);

        const card = node('button', gecko.id === selectedGeckoId ? 'gxManageCard active' : 'gxManageCard');
        card.type = 'button';
        card.append(
            node('strong', '', titleOf(gecko)),
            node('span', '', [displaySex(gecko), gecko.location || '위치 없음', gecko.morph || '모프 없음'].join(' · ')),
            node('em', '', latest ? `${shortDate(latest.layDate)} · ${eggSummary(latest)}` : '산란 기록 없음')
        );
        card.addEventListener('click', () => {
            selectedGeckoId = gecko.id;
            editingEggId = '';
            clearActivityEdit();
            renderManageRows();
            setTimeout(() => document.querySelector('.gxDetailCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
        });
        el.manageCards.append(card);
    });
    renderDetail();
}

function infoRow(label, value) {
    const row = node('div', 'gxInfoRow');
    row.append(node('span', '', label), node('strong', '', value || '-'));
    return row;
}

function actionButton(label, className, handler) {
    const button = node('button', className, label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
}

function renderEggTimeline(gecko) {
    const wrap = node('div', 'gxTimeline');
    const records = recordsOf(gecko);
    if (!records.length) {
        wrap.append(node('div', 'gxEmpty', '산란 기록이 없습니다.'));
        return wrap;
    }
    records.forEach((record) => {
        const item = node('article', 'gxTimelineItem gxTimelineAction');
        const main = node('div', 'gxTimelineMain');
        main.append(
            node('strong', '', `${shortDate(record.layDate)} 산란 · ${eggSummary(record)}`),
            node('span', '', [record.incubationLocation, record.mateNumber ? `수컷 ${record.mateNumber}` : '', record.actor ? `기록 ${record.actor}` : ''].filter(Boolean).join(' · '))
        );
        if (record.memo) main.append(node('p', '', record.memo));
        const actions = node('div', 'gxMiniActions');
        actions.append(
            actionButton('수정', 'gxMiniButton', () => editEggRecord(gecko.id, record.id)),
            actionButton('삭제', 'gxMiniDanger', () => deleteEggRecord(gecko.id, record.id))
        );
        item.append(main, actions);
        wrap.append(item);
    });
    return wrap;
}

function renderActivityTimeline(gecko) {
    const wrap = node('div', 'gxTimeline');
    const records = activitiesOf(gecko);
    if (!records.length) {
        wrap.append(node('div', 'gxEmpty', '먹이·탈피 메모가 없습니다.'));
        return wrap;
    }
    records.forEach((record) => {
        const item = node('article', 'gxTimelineItem gxTimelineAction');
        const main = node('div', 'gxTimelineMain');
        main.append(
            node('strong', '', `${shortDate(record.date)} ${record.status}`),
            node('span', '', record.actor ? `기록 ${record.actor}` : '기록자 없음')
        );
        if (record.memo) main.append(node('p', '', record.memo));
        const actions = node('div', 'gxMiniActions');
        actions.append(
            actionButton('수정', 'gxMiniButton', () => editActivityRecord(gecko.id, record.id)),
            actionButton('삭제', 'gxMiniDanger', () => deleteActivityRecord(gecko.id, record.id))
        );
        item.append(main, actions);
        wrap.append(item);
    });
    return wrap;
}

function syncPairForm(gecko) {
    el.pairForm.classList.toggle('hidden', !gecko);
    if (!gecko) return;
    el.pairManageMate.value = gecko.pairedWithNumber || '';
    el.pairManageDate.value = gecko.pairingDate || '';
}

function syncClutchForm(gecko) {
    el.clutchForm.classList.toggle('hidden', !gecko);
    if (!gecko) return;
    setClutchFemale(gecko);
    if (!editingEggId) resetClutchInputs(gecko);
}

function renderDetail() {
    const gecko = geckoById(selectedGeckoId);
    el.clutchSelectedButton.disabled = !gecko;
    el.editSelectedButton.disabled = !gecko;
    el.deleteSelectedButton.disabled = !gecko;
    syncPairForm(gecko);
    syncClutchForm(gecko);
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
        infoRow('등록/수정', [gecko.createdBy ? `등록 ${gecko.createdBy}` : '', gecko.updatedBy ? `수정 ${gecko.updatedBy}` : ''].filter(Boolean).join(' · ')),
        infoRow('메모', gecko.memo)
    );

    el.detailBody.append(
        info,
        node('h3', 'gxSectionTitle', '산란 기록'),
        renderEggTimeline(gecko),
        node('h3', 'gxSectionTitle', '먹이·탈피 메모'),
        renderActivityTimeline(gecko)
    );
}

function fillRegisterFromSelected() {
    const gecko = geckoById(selectedGeckoId);
    if (!gecko) return;
    editingGeckoId = gecko.id;
    setMode('register');
    if (gecko.motherNumber || gecko.fatherNumber) setRegisterKind('hatch');
    else setRegisterKind('general');
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
    toast('수정 모드', `${titleOf(gecko)} 정보를 불러왔습니다.`);
}

function clutchFromSelected() {
    const gecko = geckoById(selectedGeckoId);
    if (!gecko) return;
    setMode('manage');
    editingEggId = '';
    setClutchFemale(gecko);
    resetClutchInputs(gecko);
    renderManageRows();
    setTimeout(() => el.clutchFertile.focus(), 40);
}

async function savePair(event) {
    event.preventDefault();
    const gecko = geckoById(selectedGeckoId);
    if (!gecko) return toast('개체 선택 필요', '메이팅 정보를 넣을 개체를 먼저 선택하세요.', 'error');
    const mate = el.pairManageMate.value.trim();
    const pairDate = el.pairManageDate.value;

    try {
        const data = await saveGecko({
            id: gecko.id,
            number: gecko.number,
            sex: mate && displaySex(gecko) === '미구분' ? '암' : gecko.sex,
            pairedWithNumber: mate,
            pairingDate: pairDate
        }, {
            action: '메이팅 정보 저장',
            detail: mate ? `${mate}${pairDate ? ` · ${pairDate}` : ''}` : '페어 비움'
        });
        if (!data) return;
        state = data;
        selectedGeckoId = data.saved?.id || selectedGeckoId;
        renderAll();
        toast('메이팅 저장 완료', titleOf(data.saved));
    } catch (err) {
        toast('메이팅 저장 실패', err.message, 'error');
    }
}

async function deleteSelectedGecko() {
    const gecko = geckoById(selectedGeckoId);
    const actor = requireActor();
    if (!gecko || !actor) return;
    if (!confirm(`${titleOf(gecko)} 개체를 삭제할까요? 산란/메모 기록도 함께 삭제됩니다.`)) return;
    try {
        state = await api('/api/geckos', {
            method: 'DELETE',
            body: JSON.stringify({ actor, id: gecko.id })
        });
        selectedGeckoId = state.geckos[0]?.id || '';
        renderAll();
        toast('삭제 완료', titleOf(gecko));
    } catch (err) {
        toast('삭제 실패', err.message, 'error');
    }
}

function editEggRecord(geckoId, recordId) {
    const gecko = geckoById(geckoId);
    const record = recordsOf(gecko).find((item) => item.id === recordId);
    if (!gecko || !record) return;
    selectedGeckoId = gecko.id;
    editingEggId = record.id;
    setMode('manage');
    renderManageRows();
    setClutchFemale(gecko);
    el.clutchLayDate.value = record.layDate || todayValue();
    el.clutchFertile.value = numberValue(record.fertileCount);
    el.clutchInfertile.value = numberValue(record.infertileCount);
    el.clutchUnknown.value = numberValue(record.unknownCount);
    el.clutchIncubation.value = record.incubationLocation || '';
    el.clutchMate.value = record.mateNumber || gecko.pairedWithNumber || '';
    el.clutchMemo.value = record.memo || '';
    el.cancelEggEditButton.classList.remove('hidden');
    el.clutchSubmitButton.textContent = '산란 수정';
    if (el.clutchFormTitle) el.clutchFormTitle.textContent = '산란 수정';
    updateClutchPreview();
    setTimeout(() => el.clutchForm.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
}

async function deleteEggRecord(geckoId, recordId) {
    const gecko = geckoById(geckoId);
    const record = recordsOf(gecko).find((item) => item.id === recordId);
    if (!gecko || !record) return;
    if (!confirm(`${shortDate(record.layDate)} 산란 기록을 삭제할까요?`)) return;
    try {
        const data = await saveGecko({
            ...gecko,
            eggRecords: recordsOf(gecko).filter((item) => item.id !== recordId)
        }, {
            action: '산란 기록 삭제',
            detail: `${shortDate(record.layDate)} · ${eggSummary(record)}`
        });
        if (!data) return;
        state = data;
        selectedGeckoId = data.saved?.id || selectedGeckoId;
        renderAll();
        toast('산란 기록 삭제', titleOf(data.saved));
    } catch (err) {
        toast('삭제 실패', err.message, 'error');
    }
}

function clearActivityEdit() {
    editingActivityId = '';
    el.activityTitle.textContent = '상태 메모';
    el.activitySubmitButton.textContent = '메모 저장';
    el.cancelActivityEditButton.classList.add('hidden');
    el.activityMemo.value = '';
    setActivityStatus('안먹음');
}

function editActivityRecord(geckoId, recordId) {
    const gecko = geckoById(geckoId);
    const record = activitiesOf(gecko).find((item) => item.id === recordId);
    if (!gecko || !record) return;
    selectedGeckoId = gecko.id;
    editingActivityId = record.id;
    setActivityStatus(record.status || '기타');
    el.activityMemo.value = record.memo || '';
    el.activityTitle.textContent = '메모 수정';
    el.activitySubmitButton.textContent = '메모 수정';
    el.cancelActivityEditButton.classList.remove('hidden');
    setMode('manage');
    renderManageRows();
    setTimeout(() => el.activityMemo.focus(), 40);
}

async function deleteActivityRecord(geckoId, recordId) {
    const gecko = geckoById(geckoId);
    const record = activitiesOf(gecko).find((item) => item.id === recordId);
    if (!gecko || !record) return;
    if (!confirm(`${record.status || '메모'} 기록을 삭제할까요?`)) return;
    try {
        const data = await saveGecko({
            ...gecko,
            activityRecords: activitiesOf(gecko).filter((item) => item.id !== recordId)
        }, {
            action: '메모 삭제',
            detail: record.status || record.memo || ''
        });
        if (!data) return;
        state = data;
        selectedGeckoId = data.saved?.id || selectedGeckoId;
        clearActivityEdit();
        renderAll();
        toast('메모 삭제', titleOf(data.saved));
    } catch (err) {
        toast('삭제 실패', err.message, 'error');
    }
}

async function saveActivity(event) {
    event.preventDefault();
    const gecko = geckoById(selectedGeckoId);
    if (!gecko) return toast('개체 선택 필요', '개체를 먼저 선택하세요.', 'error');

    const existing = editingActivityId ? activitiesOf(gecko).find((item) => item.id === editingActivityId) : null;
    const now = new Date().toISOString();
    const record = {
        id: existing?.id || makeId(),
        type: '상태메모',
        date: existing?.date || todayValue(),
        status: activityStatus,
        location: gecko.location || '',
        memo: el.activityMemo.value.trim(),
        actor: currentActor(),
        createdAt: existing?.createdAt || now,
        updatedAt: now
    };
    const nextActivities = editingActivityId
        ? activitiesOf(gecko).map((item) => item.id === editingActivityId ? record : item)
        : [record, ...activitiesOf(gecko)];
    const wasEditing = Boolean(editingActivityId);

    try {
        const data = await saveGecko({
            ...gecko,
            tags: [...new Set([...(gecko.tags || []), '확인필요'])],
            activityRecords: nextActivities
        }, {
            action: editingActivityId ? '메모 수정' : '메모 등록',
            detail: `${activityStatus}${record.memo ? ` · ${record.memo}` : ''}`
        });
        if (!data) return;
        state = data;
        selectedGeckoId = data.saved?.id || selectedGeckoId;
        clearActivityEdit();
        renderAll();
        toast(wasEditing ? '메모 수정 완료' : '메모 저장 완료', `${titleOf(data.saved)} · ${record.status}`);
    } catch (err) {
        toast('메모 저장 실패', err.message, 'error');
    }
}

function renderAll() {
    renderActor();
    renderHeader();
    renderManageRows();
    renderClutchQuickList();
    updateRegisterPreview();
    updateClutchPreview();
}

async function load() {
    try {
        state = await api('/api/geckos');
        el.clutchLayDate.value = todayValue();
        selectedGeckoId = state.geckos[0]?.id || '';
        renderAll();
    } catch (err) {
        toast('불러오기 실패', err.message, 'error');
    }
}

el.actorButton.addEventListener('click', () => openActorModal(false));
el.actorCloseButton.addEventListener('click', closeActorModal);
el.actorForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = el.actorNameInput.value.trim().slice(0, 40);
    if (!name) return toast('이름 필요', '작업자 이름을 입력하세요.', 'error');
    localStorage.setItem(ACTOR_NAME_KEY, name);
    renderActor();
    closeActorModal();
    toast('사용자 저장', `${name} 이름으로 기록됩니다.`);
});

el.modeButtons.forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.gxMode));
});
el.sexButtons.forEach((button) => {
    button.addEventListener('click', () => setSex(button.dataset.sex));
});
el.registerKindButtons.forEach((button) => {
    button.addEventListener('click', () => setRegisterKind(button.dataset.registerKind));
});
el.activityStatusButtons.forEach((button) => {
    button.addEventListener('click', () => setActivityStatus(button.dataset.activityStatus));
});
el.eggPresetButtons.forEach((button) => {
    button.addEventListener('click', () => setEggPreset(button));
});

el.registerForm.addEventListener('submit', saveRegister);
el.resetRegisterButton.addEventListener('click', () => resetRegister(false));
el.seedExamplesButton.addEventListener('click', seedExamples);
el.importForm.addEventListener('submit', importGeckos);
el.clutchForm.addEventListener('submit', saveClutch);
el.cancelEggEditButton.addEventListener('click', clearEggEdit);
el.pairForm.addEventListener('submit', savePair);
el.pairClearButton.addEventListener('click', () => {
    el.pairManageMate.value = '';
    el.pairManageDate.value = '';
    el.pairManageMate.focus();
});
el.activityForm.addEventListener('submit', saveActivity);
el.cancelActivityEditButton.addEventListener('click', clearActivityEdit);
el.clutchSelectedButton.addEventListener('click', clutchFromSelected);
el.editSelectedButton.addEventListener('click', fillRegisterFromSelected);
el.deleteSelectedButton.addEventListener('click', deleteSelectedGecko);

[el.regName, el.regNumber, el.regContinue].forEach((input) => {
    input.addEventListener('input', updateRegisterPreview);
    input.addEventListener('change', updateRegisterPreview);
});
[el.clutchLayDate, el.clutchFertile, el.clutchInfertile, el.clutchUnknown].forEach((input) => {
    input.addEventListener('input', updateClutchPreview);
    input.addEventListener('change', updateClutchPreview);
});

if (el.clutchFemaleSearch) {
    el.clutchFemaleSearch.addEventListener('input', () => {
        selectedFemaleId = '';
        clearEggEdit();
        el.clutchFemaleLabel.textContent = '개체를 선택하세요';
        el.clutchPairHint.textContent = '메이팅 정보가 있으면 페어 수컷이 자동으로 들어갑니다.';
        el.clutchMate.value = '';
        renderFemaleSuggestions();
    });
    el.clutchFemaleSearch.addEventListener('focus', renderFemaleSuggestions);
}
el.manageSearch.addEventListener('input', renderManageRows);
el.manageSexFilter.addEventListener('change', renderManageRows);

document.addEventListener('click', (event) => {
    if (event.target.closest('.gxSuggest, .gxSearchField')) return;
    $$('.gxSuggest').forEach((host) => host.replaceChildren());
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        $$('.gxSuggest').forEach((host) => host.replaceChildren());
        closeActorModal();
    }
});

setRegisterKind(registerKind);
setSex(selectedSex);
setActivityStatus(activityStatus);
renderActor();
load();
