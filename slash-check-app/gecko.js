const geckoSearchInput = document.querySelector('#geckoSearchInput');
const geckoList = document.querySelector('#geckoList');
const geckoTotalCount = document.querySelector('#geckoTotalCount');
const geckoVisibleCount = document.querySelector('#geckoVisibleCount');
const geckoStorageStatus = document.querySelector('#geckoStorageStatus');
const geckoResultTitle = document.querySelector('#geckoResultTitle');
const geckoDetailTitle = document.querySelector('#geckoDetailTitle');
const geckoDetailBody = document.querySelector('#geckoDetailBody');
const detailEditButton = document.querySelector('#detailEditButton');
const detailEggButton = document.querySelector('#detailEggButton');
const geckoCardTemplate = document.querySelector('#geckoCardTemplate');
const eggCardTemplate = document.querySelector('#eggCardTemplate');
const statusButtons = [...document.querySelectorAll('[data-status]')];
const viewButtons = [...document.querySelectorAll('[data-view]')];
const eggFilterButtons = [...document.querySelectorAll('[data-egg-filter]')];
const libraryView = document.querySelector('#libraryView');
const eggView = document.querySelector('#eggView');
const openGeckoFormButton = document.querySelector('#openGeckoFormButton');
const geckoFormModal = document.querySelector('#geckoFormModal');
const geckoForm = document.querySelector('#geckoForm');
const closeGeckoFormButton = document.querySelector('#closeGeckoFormButton');
const deleteGeckoButton = document.querySelector('#deleteGeckoButton');
const openImportButton = document.querySelector('#openImportButton');
const geckoImportModal = document.querySelector('#geckoImportModal');
const geckoImportForm = document.querySelector('#geckoImportForm');
const closeImportButton = document.querySelector('#closeImportButton');
const geckoImportTextInput = document.querySelector('#geckoImportTextInput');
const geckoImportPasswordInput = document.querySelector('#geckoImportPasswordInput');
const openEggFormButton = document.querySelector('#openEggFormButton');
const eggFormModal = document.querySelector('#eggFormModal');
const eggForm = document.querySelector('#eggForm');
const closeEggFormButton = document.querySelector('#closeEggFormButton');
const deleteEggRecordButton = document.querySelector('#deleteEggRecordButton');
const eggGeckoSearchInput = document.querySelector('#eggGeckoSearchInput');
const eggSelectedGeckoLabel = document.querySelector('#eggSelectedGeckoLabel');
const eggGeckoSuggestions = document.querySelector('#eggGeckoSuggestions');
const eggTotalPreview = document.querySelector('#eggTotalPreview');
const eggCandidateList = document.querySelector('#eggCandidateList');
const eggDetailTitle = document.querySelector('#eggDetailTitle');
const eggDetailBody = document.querySelector('#eggDetailBody');
const eggResultTitle = document.querySelector('#eggResultTitle');
const eggBreederCount = document.querySelector('#eggBreederCount');
const eggMonthCount = document.querySelector('#eggMonthCount');
const eggHoldingCount = document.querySelector('#eggHoldingCount');
const eggWatchCount = document.querySelector('#eggWatchCount');
const toastHost = document.querySelector('#toastHost');

const ADMIN_PASSWORD_KEY = 'geckoAdminPassword';
const MAX_RENDERED_GECKOS = 240;
const MAX_RENDERED_EGG_GECKOS = 180;
const ACTIVE_EGG_STATUSES = new Set(['보관중', '관찰']);

let state = { geckos: [], count: 0, updatedAt: null };
let activeView = 'library';
let selectedStatus = 'all';
let selectedGeckoId = '';
let selectedEggGeckoId = '';
let selectedEggFilter = 'all';
let editingGeckoId = '';
let editingEggGeckoId = '';
let editingEggRecordId = '';

async function api(path, options = {}) {
    const response = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '요청 실패');
    return data;
}

function showToast(title, message = '', type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : ''}`;
    const strong = document.createElement('strong');
    strong.textContent = title;
    const span = document.createElement('span');
    span.textContent = message;
    toast.append(strong, span);
    toastHost.append(toast);
    setTimeout(() => toast.remove(), 2800);
}

function todayInputValue() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function currentMonthKey() {
    return todayInputValue().slice(0, 7);
}

function formatDate(value) {
    if (!value) return '-';
    const [year, month, day] = String(value).split('-');
    if (!year || !month || !day) return value;
    return `${month}.${day}`;
}

function formatFullDate(value) {
    return value || '-';
}

function formatAge(value) {
    const ms = new Date(value || '').getTime();
    if (!Number.isFinite(ms)) return '-';
    const days = Math.max(0, Math.floor((Date.now() - ms) / 86400000));
    if (days < 31) return `${days}일`;
    const months = Math.floor(days / 30.4375);
    if (months < 24) return `${months}개월`;
    return `${Math.floor(months / 12)}년 ${months % 12}개월`;
}

function numberValue(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return 0;
    return Math.round(num);
}

function geckoTitle(gecko) {
    return `${gecko.number || ''} ${gecko.name || ''}`.trim() || '이름 없음';
}

function getEggRecords(gecko) {
    const records = Array.isArray(gecko?.eggRecords) ? gecko.eggRecords : [];
    return [...records].sort((a, b) => String(b.layDate || '').localeCompare(String(a.layDate || '')));
}

function eggTotal(record) {
    return numberValue(record?.fertileCount) + numberValue(record?.infertileCount) + numberValue(record?.unknownCount);
}

function eggSummary(record) {
    if (!record) return '산란 기록 없음';
    return `총 ${eggTotal(record)}개 · 유 ${numberValue(record.fertileCount)} · 무 ${numberValue(record.infertileCount)} · 미 ${numberValue(record.unknownCount)}`;
}

function latestEggRecord(gecko) {
    return getEggRecords(gecko)[0] || null;
}

function isEggCandidate(gecko) {
    return gecko.sex === '암' || gecko.status === '브리딩' || getEggRecords(gecko).length > 0;
}

function geckoSearchText(gecko) {
    const eggText = getEggRecords(gecko).map((record) => [
        record.layDate,
        record.clutchCode,
        record.eggStatus,
        record.memo
    ].join(' ')).join(' ');
    return [
        gecko.number,
        gecko.name,
        gecko.sex,
        gecko.status,
        gecko.morph,
        gecko.location,
        gecko.fatherNumber,
        gecko.motherNumber,
        gecko.clutchCode,
        gecko.breeder,
        gecko.memo,
        eggText,
        ...(gecko.tags || [])
    ].join(' ').toLowerCase();
}

function matchesCurrentSearch(gecko) {
    const query = geckoSearchInput.value.trim().toLowerCase();
    return !query || geckoSearchText(gecko).includes(query);
}

function filteredGeckos() {
    return state.geckos.filter((gecko) => {
        const statusOk = selectedStatus === 'all' || gecko.status === selectedStatus;
        return statusOk && matchesCurrentSearch(gecko);
    });
}

function filteredEggGeckos() {
    const query = geckoSearchInput.value.trim();
    let list = state.geckos.filter((gecko) => matchesCurrentSearch(gecko));
    if (!query) list = list.filter(isEggCandidate);

    if (selectedEggFilter === 'active') {
        list = list.filter((gecko) => getEggRecords(gecko).some((record) => ACTIVE_EGG_STATUSES.has(record.eggStatus)));
    } else if (selectedEggFilter === 'month') {
        const month = currentMonthKey();
        list = list.filter((gecko) => getEggRecords(gecko).some((record) => String(record.layDate || '').startsWith(month)));
    } else if (selectedEggFilter === 'empty') {
        list = list.filter((gecko) => getEggRecords(gecko).length === 0);
    }

    return list.sort((a, b) => {
        const aLatest = latestEggRecord(a)?.layDate || '';
        const bLatest = latestEggRecord(b)?.layDate || '';
        return String(bLatest).localeCompare(String(aLatest))
            || String(a.number || '').localeCompare(String(b.number || ''), 'ko', { numeric: true });
    });
}

function setText(parent, selector, value) {
    const el = parent.querySelector(selector);
    if (el) el.textContent = value || '-';
}

function createElement(tag, className = '', text = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
}

function renderList() {
    const visible = filteredGeckos();
    const rendered = visible.slice(0, MAX_RENDERED_GECKOS);
    geckoTotalCount.textContent = `${state.count || state.geckos.length}개체`;
    geckoVisibleCount.textContent = activeView === 'eggs'
        ? `${filteredEggGeckos().length}건 표시`
        : `${visible.length}건 표시`;
    geckoResultTitle.textContent = selectedStatus === 'all' ? '전체 개체' : `${selectedStatus} 개체`;
    geckoList.replaceChildren();

    if (visible.length === 0) {
        geckoList.append(createElement('div', 'empty small', '검색 결과가 없습니다.'));
        return;
    }

    for (const gecko of rendered) {
        const card = geckoCardTemplate.content.firstElementChild.cloneNode(true);
        card.classList.toggle('active', gecko.id === selectedGeckoId);
        card.dataset.id = gecko.id;
        setText(card, '.geckoNumber', gecko.number);
        setText(card, '.geckoName', gecko.name || '이름 없음');
        setText(card, '.geckoMorph', gecko.morph || '모프 미등록');
        setText(card, '.geckoLocation', gecko.location || '위치 미등록');
        setText(card, '.geckoStatus', gecko.status);
        card.addEventListener('click', () => selectGecko(gecko.id));
        geckoList.append(card);
    }

    if (visible.length > rendered.length) {
        geckoList.append(createElement('div', 'empty small', `${visible.length - rendered.length}건 더 있습니다. 검색어를 더 입력하세요.`));
    }
}

function detailRow(label, value) {
    const row = createElement('div', 'geckoDetailRow');
    row.append(createElement('span', '', label), createElement('strong', '', value || '-'));
    return row;
}

function renderEggRecordList(gecko, mode = 'detail') {
    const records = getEggRecords(gecko);
    const wrap = createElement('div', 'eggRecordList');
    if (records.length === 0) {
        wrap.append(createElement('div', 'empty small', '산란 기록이 없습니다.'));
        return wrap;
    }

    for (const record of records) {
        const item = createElement('article', 'eggRecordItem');
        const main = createElement('div');
        const title = createElement('strong', '', `${formatFullDate(record.layDate)} ${record.clutchCode || ''}`.trim());
        const meta = createElement('span', '', `${eggSummary(record)} · ${record.eggStatus || '보관중'}`);
        main.append(title, meta);
        if (record.memo) main.append(createElement('p', '', record.memo));
        const button = createElement('button', 'eggRecordEdit', mode === 'detail' ? '수정' : '열기');
        button.type = 'button';
        button.addEventListener('click', () => openEggForm(gecko, record));
        item.append(main, button);
        wrap.append(item);
    }
    return wrap;
}

function renderDetail() {
    const gecko = state.geckos.find((item) => item.id === selectedGeckoId);
    geckoDetailBody.replaceChildren();
    detailEditButton.disabled = !gecko;
    detailEggButton.disabled = !gecko;

    if (!gecko) {
        geckoDetailTitle.textContent = '개체를 선택하세요';
        geckoDetailBody.append(createElement('div', 'empty small', '목록에서 개체를 선택하면 위치와 산란 정보가 표시됩니다.'));
        return;
    }

    geckoDetailTitle.textContent = geckoTitle(gecko);
    const latest = latestEggRecord(gecko);
    const head = createElement('div', 'geckoDetailHero');
    head.append(
        createElement('strong', '', gecko.name || gecko.number),
        createElement('span', '', `${gecko.number} · ${gecko.status} · ${gecko.sex}`)
    );

    const grid = createElement('div', 'geckoDetailGrid');
    grid.append(
        detailRow('위치', gecko.location),
        detailRow('모프', gecko.morph),
        detailRow('출생일', `${formatFullDate(gecko.hatchDate)} · ${formatAge(gecko.hatchDate)}`),
        detailRow('무게', gecko.weight ? `${gecko.weight}g · ${formatFullDate(gecko.weightDate)}` : ''),
        detailRow('부', gecko.fatherNumber),
        detailRow('모', gecko.motherNumber),
        detailRow('최근 산란', latest ? `${formatFullDate(latest.layDate)} · ${eggSummary(latest)}` : ''),
        detailRow('출처', gecko.breeder)
    );

    const memo = createElement('div', 'geckoMemoBlock');
    memo.append(createElement('span', '', '메모'), createElement('p', '', gecko.memo || '-'));

    const tags = createElement('div', 'geckoTagList');
    for (const tag of gecko.tags || []) tags.append(createElement('span', '', tag));

    geckoDetailBody.append(head, grid, memo, renderEggRecordList(gecko));
    if (tags.childElementCount > 0) geckoDetailBody.append(tags);
}

function renderEggDashboard() {
    const month = currentMonthKey();
    let breederCount = 0;
    let monthCount = 0;
    let holdingCount = 0;
    let watchCount = 0;

    for (const gecko of state.geckos) {
        const records = getEggRecords(gecko);
        if (records.length > 0) breederCount += 1;
        for (const record of records) {
            if (String(record.layDate || '').startsWith(month)) monthCount += 1;
            if (ACTIVE_EGG_STATUSES.has(record.eggStatus)) holdingCount += eggTotal(record);
            if (record.eggStatus === '관찰') watchCount += 1;
        }
    }

    eggBreederCount.textContent = breederCount;
    eggMonthCount.textContent = monthCount;
    eggHoldingCount.textContent = holdingCount;
    eggWatchCount.textContent = watchCount;
}

function renderEggList() {
    const visible = filteredEggGeckos();
    const rendered = visible.slice(0, MAX_RENDERED_EGG_GECKOS);
    eggResultTitle.textContent = selectedEggFilter === 'all' ? '산란 관리 목록' : `${selectedEggFilterText()} 목록`;
    eggCandidateList.replaceChildren();

    if (visible.length === 0) {
        eggCandidateList.append(createElement('div', 'empty small', '표시할 산란 개체가 없습니다. 검색어를 입력하면 전체 개체에서 찾을 수 있습니다.'));
        return;
    }

    for (const gecko of rendered) {
        const latest = latestEggRecord(gecko);
        const card = eggCardTemplate.content.firstElementChild.cloneNode(true);
        card.classList.toggle('active', gecko.id === selectedEggGeckoId);
        setText(card, '.eggGeckoTitle', geckoTitle(gecko));
        setText(card, '.eggGeckoMeta', [gecko.location, gecko.morph].filter(Boolean).join(' · ') || '위치/모프 미등록');
        setText(card, '.eggLastLay', latest ? `최근 ${formatDate(latest.layDate)}` : '기록 없음');
        setText(card, '.eggLastCount', latest ? eggSummary(latest) : '산란 등록 필요');
        setText(card, '.eggLastStatus', latest?.eggStatus || '대기');
        setText(card, '.eggCardMemo', latest?.memo || gecko.memo || '');
        card.addEventListener('click', () => selectEggGecko(gecko.id));
        card.querySelector('.eggQuickButton').addEventListener('click', (event) => {
            event.stopPropagation();
            openEggForm(gecko);
        });
        eggCandidateList.append(card);
    }

    if (visible.length > rendered.length) {
        eggCandidateList.append(createElement('div', 'empty small', `${visible.length - rendered.length}건 더 있습니다. 검색어를 더 입력하세요.`));
    }
}

function selectedEggFilterText() {
    if (selectedEggFilter === 'active') return '보관중';
    if (selectedEggFilter === 'month') return '이번달';
    if (selectedEggFilter === 'empty') return '기록 없음';
    return '전체';
}

function renderEggDetail() {
    const gecko = state.geckos.find((item) => item.id === selectedEggGeckoId);
    eggDetailBody.replaceChildren();

    if (!gecko) {
        eggDetailTitle.textContent = '개체를 선택하세요';
        eggDetailBody.append(createElement('div', 'empty small', '산란 개체를 누르면 기록을 바로 수정할 수 있습니다.'));
        return;
    }

    eggDetailTitle.textContent = geckoTitle(gecko);
    const hero = createElement('div', 'eggDetailHero');
    const addButton = createElement('button', 'copyCommandButton', '산란 등록');
    addButton.type = 'button';
    addButton.addEventListener('click', () => openEggForm(gecko));
    hero.append(
        createElement('strong', '', geckoTitle(gecko)),
        createElement('span', '', [gecko.location, gecko.morph, gecko.sex].filter(Boolean).join(' · ') || '정보 미등록'),
        addButton
    );
    eggDetailBody.append(hero, renderEggRecordList(gecko, 'egg'));
}

function render() {
    statusButtons.forEach((button) => button.classList.toggle('active', button.dataset.status === selectedStatus));
    viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === activeView));
    eggFilterButtons.forEach((button) => button.classList.toggle('active', button.dataset.eggFilter === selectedEggFilter));
    libraryView.classList.toggle('hidden', activeView !== 'library');
    eggView.classList.toggle('hidden', activeView !== 'eggs');
    geckoStorageStatus.textContent = state.updatedAt ? `저장 ${state.updatedAt.slice(0, 10)}` : '저장 대기';
    renderList();
    renderDetail();
    renderEggDashboard();
    renderEggList();
    renderEggDetail();
}

function selectGecko(id) {
    selectedGeckoId = id;
    render();
    if (window.matchMedia('(max-width: 860px)').matches) {
        document.querySelector('.geckoDetailPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function selectEggGecko(id) {
    selectedEggGeckoId = id;
    selectedGeckoId = selectedGeckoId || id;
    render();
    if (window.matchMedia('(max-width: 860px)').matches) {
        document.querySelector('.eggDetailPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function fillForm(gecko = null) {
    editingGeckoId = gecko?.id || '';
    geckoForm.reset();
    document.querySelector('#geckoFormTitle').textContent = gecko ? '개체 수정' : '개체 추가';
    document.querySelector('#geckoNumberInput').value = gecko?.number || '';
    document.querySelector('#geckoNameInput').value = gecko?.name || '';
    document.querySelector('#geckoSexInput').value = gecko?.sex || '미확인';
    document.querySelector('#geckoStatusInput').value = gecko?.status || '보유';
    document.querySelector('#geckoMorphInput').value = gecko?.morph || '';
    document.querySelector('#geckoLocationInput').value = gecko?.location || '';
    document.querySelector('#geckoHatchDateInput').value = gecko?.hatchDate || '';
    document.querySelector('#geckoAcquiredDateInput').value = gecko?.acquiredDate || '';
    document.querySelector('#geckoFatherInput').value = gecko?.fatherNumber || '';
    document.querySelector('#geckoMotherInput').value = gecko?.motherNumber || '';
    document.querySelector('#geckoWeightInput').value = gecko?.weight || '';
    document.querySelector('#geckoWeightDateInput').value = gecko?.weightDate || '';
    document.querySelector('#geckoBreederInput').value = gecko?.breeder || '';
    document.querySelector('#geckoClutchInput').value = gecko?.clutchCode || '';
    document.querySelector('#geckoMemoInput').value = gecko?.memo || '';
    document.querySelector('#geckoTagsInput').value = (gecko?.tags || []).join(', ');
    document.querySelector('#geckoAdminPasswordInput').value = localStorage.getItem(ADMIN_PASSWORD_KEY) || '';
    deleteGeckoButton.hidden = !gecko;
}

function openForm(gecko = null) {
    fillForm(gecko);
    geckoFormModal.classList.remove('hidden');
    setTimeout(() => document.querySelector('#geckoNumberInput').focus(), 30);
}

function closeForm() {
    geckoFormModal.classList.add('hidden');
    editingGeckoId = '';
}

function formValue(selector) {
    return document.querySelector(selector).value.trim();
}

async function saveGecko(event) {
    event.preventDefault();
    const adminPassword = formValue('#geckoAdminPasswordInput');
    if (!adminPassword) {
        showToast('비밀번호 필요', '관리자 비밀번호를 입력하세요.', 'error');
        return;
    }

    const existing = state.geckos.find((item) => item.id === editingGeckoId);
    const gecko = {
        id: editingGeckoId,
        number: formValue('#geckoNumberInput'),
        name: formValue('#geckoNameInput'),
        sex: formValue('#geckoSexInput'),
        status: formValue('#geckoStatusInput'),
        morph: formValue('#geckoMorphInput'),
        location: formValue('#geckoLocationInput'),
        hatchDate: formValue('#geckoHatchDateInput'),
        acquiredDate: formValue('#geckoAcquiredDateInput'),
        fatherNumber: formValue('#geckoFatherInput'),
        motherNumber: formValue('#geckoMotherInput'),
        weight: formValue('#geckoWeightInput'),
        weightDate: formValue('#geckoWeightDateInput'),
        breeder: formValue('#geckoBreederInput'),
        clutchCode: formValue('#geckoClutchInput'),
        memo: formValue('#geckoMemoInput'),
        tags: formValue('#geckoTagsInput'),
        eggRecords: existing?.eggRecords || []
    };

    try {
        const data = await api('/api/geckos', {
            method: 'POST',
            body: JSON.stringify({ adminPassword, gecko })
        });
        localStorage.setItem(ADMIN_PASSWORD_KEY, adminPassword);
        state = data;
        selectedGeckoId = data.saved?.id || selectedGeckoId;
        closeForm();
        render();
        showToast('저장 완료', data.saved?.number || '');
    } catch (err) {
        showToast('저장 실패', err.message, 'error');
    }
}

async function deleteGecko() {
    const gecko = state.geckos.find((item) => item.id === editingGeckoId);
    if (!gecko) return;
    if (!confirm(`${gecko.number} 개체를 삭제할까요?`)) return;
    const adminPassword = formValue('#geckoAdminPasswordInput');
    try {
        const data = await api('/api/geckos', {
            method: 'DELETE',
            body: JSON.stringify({ id: gecko.id, adminPassword })
        });
        state = data;
        selectedGeckoId = '';
        selectedEggGeckoId = '';
        closeForm();
        render();
        showToast('삭제 완료', gecko.number);
    } catch (err) {
        showToast('삭제 실패', err.message, 'error');
    }
}

function updateEggTotalPreview() {
    const total = numberValue(document.querySelector('#eggFertileInput').value)
        + numberValue(document.querySelector('#eggInfertileInput').value)
        + numberValue(document.querySelector('#eggUnknownInput').value);
    eggTotalPreview.textContent = `${total}개`;
}

function updateEggSelectionLabel() {
    const gecko = state.geckos.find((item) => item.id === editingEggGeckoId);
    eggSelectedGeckoLabel.textContent = gecko ? geckoTitle(gecko) : '개체를 선택하세요';
}

function renderEggSuggestions() {
    const query = eggGeckoSearchInput.value.trim().toLowerCase();
    eggGeckoSuggestions.replaceChildren();
    if (!query) return;

    const suggestions = state.geckos
        .filter((gecko) => geckoSearchText(gecko).includes(query))
        .slice(0, 10);

    for (const gecko of suggestions) {
        const button = createElement('button', '', '');
        button.type = 'button';
        const title = createElement('strong', '', geckoTitle(gecko));
        const meta = createElement('span', '', [gecko.location, gecko.morph].filter(Boolean).join(' · ') || '정보 미등록');
        button.append(title, meta);
        button.addEventListener('click', () => {
            editingEggGeckoId = gecko.id;
            eggGeckoSearchInput.value = geckoTitle(gecko);
            eggGeckoSuggestions.replaceChildren();
            updateEggSelectionLabel();
        });
        eggGeckoSuggestions.append(button);
    }
}

function openEggForm(gecko = null, record = null) {
    editingEggGeckoId = gecko?.id || selectedEggGeckoId || selectedGeckoId || '';
    editingEggRecordId = record?.id || '';
    eggForm.reset();
    document.querySelector('#eggFormTitle').textContent = record ? '산란 기록 수정' : '산란 등록';
    const selected = state.geckos.find((item) => item.id === editingEggGeckoId);
    eggGeckoSearchInput.value = selected ? geckoTitle(selected) : '';
    document.querySelector('#eggLayDateInput').value = record?.layDate || todayInputValue();
    document.querySelector('#eggClutchInput').value = record?.clutchCode || selected?.clutchCode || '';
    document.querySelector('#eggFertileInput').value = record?.fertileCount ?? 0;
    document.querySelector('#eggInfertileInput').value = record?.infertileCount ?? 0;
    document.querySelector('#eggUnknownInput').value = record?.unknownCount ?? 0;
    document.querySelector('#eggStatusInput').value = record?.eggStatus || '보관중';
    document.querySelector('#eggHatchDateInput').value = record?.hatchDate || '';
    document.querySelector('#eggMemoInput').value = record?.memo || '';
    document.querySelector('#eggAdminPasswordInput').value = localStorage.getItem(ADMIN_PASSWORD_KEY) || '';
    deleteEggRecordButton.hidden = !record;
    updateEggSelectionLabel();
    updateEggTotalPreview();
    eggGeckoSuggestions.replaceChildren();
    eggFormModal.classList.remove('hidden');
    setTimeout(() => {
        if (selected) document.querySelector('#eggLayDateInput').focus();
        else eggGeckoSearchInput.focus();
    }, 30);
}

function closeEggForm() {
    eggFormModal.classList.add('hidden');
    editingEggGeckoId = '';
    editingEggRecordId = '';
    eggGeckoSuggestions.replaceChildren();
}

function buildEggRecord() {
    return {
        id: editingEggRecordId,
        layDate: formValue('#eggLayDateInput'),
        clutchCode: formValue('#eggClutchInput'),
        fertileCount: numberValue(formValue('#eggFertileInput')),
        infertileCount: numberValue(formValue('#eggInfertileInput')),
        unknownCount: numberValue(formValue('#eggUnknownInput')),
        eggStatus: formValue('#eggStatusInput'),
        hatchDate: formValue('#eggHatchDateInput'),
        memo: formValue('#eggMemoInput')
    };
}

async function saveGeckoEggRecords(gecko, records, adminPassword) {
    const sortedRecords = [...records].sort((a, b) => String(b.layDate || '').localeCompare(String(a.layDate || '')));
    const latest = sortedRecords[0] || null;
    const geckoUpdate = {
        ...gecko,
        eggRecords: sortedRecords,
        layDate: latest?.layDate || '',
        eggCount: latest ? eggTotal(latest) : 0,
        clutchCode: latest?.clutchCode || gecko.clutchCode || '',
        hatchResultDate: latest?.hatchDate || '',
        eggMemo: latest?.memo || ''
    };
    return api('/api/geckos', {
        method: 'POST',
        body: JSON.stringify({ adminPassword, gecko: geckoUpdate })
    });
}

async function saveEgg(event) {
    event.preventDefault();
    const gecko = state.geckos.find((item) => item.id === editingEggGeckoId);
    const adminPassword = formValue('#eggAdminPasswordInput');
    const record = buildEggRecord();

    if (!gecko) {
        showToast('개체 선택 필요', '산란 개체를 선택하세요.', 'error');
        return;
    }
    if (!record.layDate) {
        showToast('산란일 필요', '산란일을 입력하세요.', 'error');
        return;
    }
    if (eggTotal(record) === 0) {
        showToast('알 갯수 필요', '유정란, 무정란, 미확인 중 하나는 1개 이상 입력하세요.', 'error');
        return;
    }
    if (!adminPassword) {
        showToast('비밀번호 필요', '관리자 비밀번호를 입력하세요.', 'error');
        return;
    }

    const records = getEggRecords(gecko);
    const nextRecords = editingEggRecordId
        ? records.map((item) => item.id === editingEggRecordId ? { ...item, ...record } : item)
        : [{ ...record, id: globalThis.crypto?.randomUUID?.() || `${Date.now()}` }, ...records];

    try {
        const data = await saveGeckoEggRecords(gecko, nextRecords, adminPassword);
        localStorage.setItem(ADMIN_PASSWORD_KEY, adminPassword);
        state = data;
        selectedEggGeckoId = data.saved?.id || gecko.id;
        selectedGeckoId = data.saved?.id || gecko.id;
        activeView = 'eggs';
        closeEggForm();
        render();
        showToast('산란 저장 완료', geckoTitle(data.saved || gecko));
    } catch (err) {
        showToast('산란 저장 실패', err.message, 'error');
    }
}

async function deleteEggRecord() {
    const gecko = state.geckos.find((item) => item.id === editingEggGeckoId);
    const record = getEggRecords(gecko).find((item) => item.id === editingEggRecordId);
    if (!gecko || !record) return;
    if (!confirm(`${formatFullDate(record.layDate)} 산란 기록을 삭제할까요?`)) return;
    const adminPassword = formValue('#eggAdminPasswordInput');
    if (!adminPassword) {
        showToast('비밀번호 필요', '관리자 비밀번호를 입력하세요.', 'error');
        return;
    }

    try {
        const nextRecords = getEggRecords(gecko).filter((item) => item.id !== editingEggRecordId);
        const data = await saveGeckoEggRecords(gecko, nextRecords, adminPassword);
        localStorage.setItem(ADMIN_PASSWORD_KEY, adminPassword);
        state = data;
        closeEggForm();
        render();
        showToast('산란 기록 삭제 완료', geckoTitle(gecko));
    } catch (err) {
        showToast('삭제 실패', err.message, 'error');
    }
}

function parseImportRows(text) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    const headers = lines[0].split(delimiter).map((item) => item.trim());
    const map = {
        넘버링: 'number',
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
        출생일: 'hatchDate',
        부화일: 'hatchDate',
        입양일: 'acquiredDate',
        입고일: 'acquiredDate',
        부: 'fatherNumber',
        모: 'motherNumber',
        브리더: 'breeder',
        출처: 'breeder',
        무게: 'weight',
        측정일: 'weightDate',
        산란일: 'layDate',
        산란수: 'eggCount',
        유정란: 'fertileCount',
        무정란: 'infertileCount',
        미확인: 'unknownCount',
        알상태: 'eggStatus',
        클러치: 'clutchCode',
        부화예정일: 'hatchResultDate',
        산란메모: 'eggMemo',
        메모: 'memo',
        태그: 'tags'
    };

    return lines.slice(1).map((line) => {
        const values = line.split(delimiter);
        const row = {};
        headers.forEach((header, index) => {
            const key = map[header] || header;
            row[key] = values[index] || '';
        });
        return row;
    }).filter((row) => row.number || row.name);
}

async function importGeckos(event) {
    event.preventDefault();
    const adminPassword = geckoImportPasswordInput.value.trim();
    const geckos = parseImportRows(geckoImportTextInput.value);
    if (!adminPassword || geckos.length === 0) {
        showToast('가져오기 확인', '비밀번호와 붙여넣은 데이터를 확인하세요.', 'error');
        return;
    }
    try {
        const data = await api('/api/geckos/import', {
            method: 'POST',
            body: JSON.stringify({ adminPassword, geckos })
        });
        localStorage.setItem(ADMIN_PASSWORD_KEY, adminPassword);
        state = data;
        geckoImportModal.classList.add('hidden');
        geckoImportTextInput.value = '';
        render();
        showToast('가져오기 완료', `추가 ${data.added || 0}건 · 수정 ${data.updated || 0}건`);
    } catch (err) {
        showToast('가져오기 실패', err.message, 'error');
    }
}

async function load() {
    try {
        state = await api('/api/geckos');
        render();
    } catch (err) {
        geckoStorageStatus.textContent = '불러오기 실패';
        showToast('불러오기 실패', err.message, 'error');
    }
}

geckoSearchInput.addEventListener('input', render);
statusButtons.forEach((button) => {
    button.addEventListener('click', () => {
        selectedStatus = button.dataset.status;
        render();
    });
});
viewButtons.forEach((button) => {
    button.addEventListener('click', () => {
        activeView = button.dataset.view;
        if (activeView === 'eggs' && !selectedEggGeckoId && selectedGeckoId) selectedEggGeckoId = selectedGeckoId;
        render();
    });
});
eggFilterButtons.forEach((button) => {
    button.addEventListener('click', () => {
        selectedEggFilter = button.dataset.eggFilter;
        render();
    });
});
openGeckoFormButton.addEventListener('click', () => openForm());
closeGeckoFormButton.addEventListener('click', closeForm);
geckoForm.addEventListener('submit', saveGecko);
deleteGeckoButton.addEventListener('click', deleteGecko);
detailEditButton.addEventListener('click', () => {
    const gecko = state.geckos.find((item) => item.id === selectedGeckoId);
    if (gecko) openForm(gecko);
});
detailEggButton.addEventListener('click', () => {
    const gecko = state.geckos.find((item) => item.id === selectedGeckoId);
    if (!gecko) return;
    activeView = 'eggs';
    selectedEggGeckoId = gecko.id;
    openEggForm(gecko);
    render();
});
openEggFormButton.addEventListener('click', () => openEggForm());
closeEggFormButton.addEventListener('click', closeEggForm);
eggForm.addEventListener('submit', saveEgg);
deleteEggRecordButton.addEventListener('click', deleteEggRecord);
eggGeckoSearchInput.addEventListener('input', () => {
    editingEggGeckoId = '';
    updateEggSelectionLabel();
    renderEggSuggestions();
});
['#eggFertileInput', '#eggInfertileInput', '#eggUnknownInput'].forEach((selector) => {
    document.querySelector(selector).addEventListener('input', updateEggTotalPreview);
});
openImportButton.addEventListener('click', () => {
    geckoImportPasswordInput.value = localStorage.getItem(ADMIN_PASSWORD_KEY) || '';
    geckoImportModal.classList.remove('hidden');
});
closeImportButton.addEventListener('click', () => geckoImportModal.classList.add('hidden'));
geckoImportForm.addEventListener('submit', importGeckos);
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!geckoFormModal.classList.contains('hidden')) closeForm();
    else if (!eggFormModal.classList.contains('hidden')) closeEggForm();
    else if (!geckoImportModal.classList.contains('hidden')) geckoImportModal.classList.add('hidden');
});

load();
