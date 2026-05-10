const geckoSearchInput = document.querySelector('#geckoSearchInput');
const geckoList = document.querySelector('#geckoList');
const geckoTotalCount = document.querySelector('#geckoTotalCount');
const geckoVisibleCount = document.querySelector('#geckoVisibleCount');
const geckoStorageStatus = document.querySelector('#geckoStorageStatus');
const geckoResultTitle = document.querySelector('#geckoResultTitle');
const geckoDetailTitle = document.querySelector('#geckoDetailTitle');
const geckoDetailBody = document.querySelector('#geckoDetailBody');
const detailEditButton = document.querySelector('#detailEditButton');
const geckoCardTemplate = document.querySelector('#geckoCardTemplate');
const statusButtons = [...document.querySelectorAll('[data-status]')];
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
const toastHost = document.querySelector('#toastHost');

const ADMIN_PASSWORD_KEY = 'geckoAdminPassword';
const MAX_RENDERED_GECKOS = 220;

let state = { geckos: [], count: 0, updatedAt: null };
let selectedStatus = 'all';
let selectedGeckoId = '';
let editingGeckoId = '';

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

function formatDate(value) {
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

function geckoSearchText(gecko) {
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
        gecko.memo,
        ...(gecko.tags || [])
    ].join(' ').toLowerCase();
}

function filteredGeckos() {
    const query = geckoSearchInput.value.trim().toLowerCase();
    return state.geckos.filter((gecko) => {
        const statusOk = selectedStatus === 'all' || gecko.status === selectedStatus;
        if (!statusOk) return false;
        if (!query) return true;
        return geckoSearchText(gecko).includes(query);
    });
}

function setText(parent, selector, value) {
    const el = parent.querySelector(selector);
    if (el) el.textContent = value || '-';
}

function renderList() {
    const visible = filteredGeckos();
    const rendered = visible.slice(0, MAX_RENDERED_GECKOS);
    geckoTotalCount.textContent = `${state.count || state.geckos.length}개체`;
    geckoVisibleCount.textContent = `${visible.length}건 검색`;
    geckoResultTitle.textContent = selectedStatus === 'all' ? '전체 개체' : `${selectedStatus} 개체`;
    geckoList.replaceChildren();

    if (visible.length === 0) {
        geckoList.innerHTML = '<div class="empty small">검색 결과가 없습니다.</div>';
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
        const more = document.createElement('div');
        more.className = 'empty small';
        more.textContent = `${visible.length - rendered.length}건 더 있습니다. 검색어를 더 입력하세요.`;
        geckoList.append(more);
    }
}

function detailRow(label, value) {
    const row = document.createElement('div');
    row.className = 'geckoDetailRow';
    const key = document.createElement('span');
    key.textContent = label;
    const val = document.createElement('strong');
    val.textContent = value || '-';
    row.append(key, val);
    return row;
}

function renderDetail() {
    const gecko = state.geckos.find((item) => item.id === selectedGeckoId);
    geckoDetailBody.replaceChildren();
    detailEditButton.disabled = !gecko;

    if (!gecko) {
        geckoDetailTitle.textContent = '개체를 선택하세요';
        geckoDetailBody.innerHTML = '<div class="empty small">목록에서 개체를 선택하면 위치와 산란 정보가 표시됩니다.</div>';
        return;
    }

    geckoDetailTitle.textContent = `${gecko.number} ${gecko.name || ''}`.trim();
    const head = document.createElement('div');
    head.className = 'geckoDetailHero';
    const title = document.createElement('strong');
    title.textContent = gecko.name || gecko.number;
    const meta = document.createElement('span');
    meta.textContent = `${gecko.number} · ${gecko.status} · ${gecko.sex}`;
    head.append(title, meta);

    const grid = document.createElement('div');
    grid.className = 'geckoDetailGrid';
    grid.append(
        detailRow('위치', gecko.location),
        detailRow('모프', gecko.morph),
        detailRow('출생일', `${formatDate(gecko.hatchDate)} · ${formatAge(gecko.hatchDate)}`),
        detailRow('무게', gecko.weight ? `${gecko.weight}g · ${formatDate(gecko.weightDate)}` : ''),
        detailRow('부', gecko.fatherNumber),
        detailRow('모', gecko.motherNumber),
        detailRow('산란', gecko.layDate ? `${gecko.layDate} · ${gecko.eggCount || 0}란` : ''),
        detailRow('클러치', gecko.clutchCode),
        detailRow('부화/예정', gecko.hatchResultDate),
        detailRow('출처', gecko.breeder)
    );

    const memo = document.createElement('div');
    memo.className = 'geckoMemoBlock';
    const memoTitle = document.createElement('span');
    memoTitle.textContent = '메모';
    const memoText = document.createElement('p');
    memoText.textContent = [gecko.eggMemo, gecko.memo].filter(Boolean).join('\n') || '-';
    memo.append(memoTitle, memoText);

    const tags = document.createElement('div');
    tags.className = 'geckoTagList';
    for (const tag of gecko.tags || []) {
        const chip = document.createElement('span');
        chip.textContent = tag;
        tags.append(chip);
    }

    geckoDetailBody.append(head, grid, memo);
    if (tags.childElementCount > 0) geckoDetailBody.append(tags);
}

function render() {
    statusButtons.forEach((button) => button.classList.toggle('active', button.dataset.status === selectedStatus));
    geckoStorageStatus.textContent = state.updatedAt ? `저장 ${state.updatedAt.slice(0, 10)}` : '저장 대기';
    renderList();
    renderDetail();
}

function selectGecko(id) {
    selectedGeckoId = id;
    render();
    if (window.matchMedia('(max-width: 860px)').matches) {
        document.querySelector('.geckoDetailPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    document.querySelector('#geckoLayDateInput').value = gecko?.layDate || '';
    document.querySelector('#geckoEggCountInput').value = gecko?.eggCount || '';
    document.querySelector('#geckoClutchInput').value = gecko?.clutchCode || '';
    document.querySelector('#geckoHatchResultInput').value = gecko?.hatchResultDate || '';
    document.querySelector('#geckoEggMemoInput').value = gecko?.eggMemo || '';
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
        layDate: formValue('#geckoLayDateInput'),
        eggCount: formValue('#geckoEggCountInput'),
        clutchCode: formValue('#geckoClutchInput'),
        hatchResultDate: formValue('#geckoHatchResultInput'),
        eggMemo: formValue('#geckoEggMemoInput'),
        memo: formValue('#geckoMemoInput'),
        tags: formValue('#geckoTagsInput')
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
        closeForm();
        render();
        showToast('삭제 완료', gecko.number);
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
openGeckoFormButton.addEventListener('click', () => openForm());
closeGeckoFormButton.addEventListener('click', closeForm);
geckoForm.addEventListener('submit', saveGecko);
deleteGeckoButton.addEventListener('click', deleteGecko);
detailEditButton.addEventListener('click', () => {
    const gecko = state.geckos.find((item) => item.id === selectedGeckoId);
    if (gecko) openForm(gecko);
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
    else if (!geckoImportModal.classList.contains('hidden')) geckoImportModal.classList.add('hidden');
});

load();
