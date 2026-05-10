const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ADMIN_PASSWORD_KEY = 'geckoAdminPassword';
const DAY_MS = 86400000;
const ACTIVE_EGG_STATUSES = new Set(['보관중', '관찰']);
const FEED_ATTENTION_STATUSES = new Set(['안먹음', '탈피중', '기타']);

const el = {
    modeButtons: $$('[data-mode]'),
    modePanels: $$('[data-mode-panel]'),
    registerKindButtons: $$('[data-register-kind]'),
    registerPanels: $$('[data-register-panel]'),
    headerCount: $('#headerCount'),
    headerUpdated: $('#headerUpdated'),
    toastHost: $('#toastHost'),

    registerForm: $('#registerForm'),
    registerTitle: $('#registerTitle'),
    registerClearButton: $('#registerClearButton'),
    regNumber: $('#regNumber'),
    regName: $('#regName'),
    regSex: $('#regSex'),
    regStatus: $('#regStatus'),
    regLocation: $('#regLocation'),
    regMorph: $('#regMorph'),
    regMother: $('#regMother'),
    regFather: $('#regFather'),
    regPair: $('#regPair'),
    regPairDate: $('#regPairDate'),
    regHatchDate: $('#regHatchDate'),
    regMemo: $('#regMemo'),
    regPassword: $('#regPassword'),

    hatchForm: $('#hatchForm'),
    hatchParentSearch: $('#hatchParentSearch'),
    hatchSuggestions: $('#hatchSuggestions'),
    hatchParentLabel: $('#hatchParentLabel'),
    hatchDate: $('#hatchDate'),
    hatchCount: $('#hatchCount'),
    hatchStartNumber: $('#hatchStartNumber'),
    hatchLocation: $('#hatchLocation'),
    hatchPassword: $('#hatchPassword'),

    importForm: $('#importForm'),
    importText: $('#importText'),
    importPassword: $('#importPassword'),

    feedingForm: $('#feedingForm'),
    feedingLocation: $('#feedingLocation'),
    feedingDate: $('#feedingDate'),
    feedingGeckoSearch: $('#feedingGeckoSearch'),
    feedingSuggestions: $('#feedingSuggestions'),
    feedingSelectedLabel: $('#feedingSelectedLabel'),
    feedingMemo: $('#feedingMemo'),
    feedingPassword: $('#feedingPassword'),
    feedStatusButtons: $$('[data-feed-status]'),
    todayFeedingCount: $('#todayFeedingCount'),
    todayFeedingList: $('#todayFeedingList'),

    searchInput: $('#searchInput'),
    searchCount: $('#searchCount'),
    searchList: $('#searchList'),
    detailTitle: $('#detailTitle'),
    detailBody: $('#detailBody'),
    detailEditButton: $('#detailEditButton'),
    detailClutchButton: $('#detailClutchButton'),

    breedingSearch: $('#breedingSearch'),
    breedingList: $('#breedingList'),
    breedingTitle: $('#breedingTitle'),
    breedingDetail: $('#breedingDetail'),
    clutchForm: $('#clutchForm'),
    clutchTargetLabel: $('#clutchTargetLabel'),
    clutchLayDate: $('#clutchLayDate'),
    clutchStatus: $('#clutchStatus'),
    clutchFertile: $('#clutchFertile'),
    clutchInfertile: $('#clutchInfertile'),
    clutchUnknown: $('#clutchUnknown'),
    clutchIncubation: $('#clutchIncubation'),
    clutchMate: $('#clutchMate'),
    clutchMemo: $('#clutchMemo'),
    clutchPassword: $('#clutchPassword')
};

let state = { geckos: [], count: 0, updatedAt: null };
let editingGeckoId = '';
let hatchParentId = '';
let feedingGeckoId = '';
let feedingStatus = '안먹음';
let searchSelectedId = '';
let breedingSelectedId = '';

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

function dateMs(value) {
    const ms = new Date(`${value || ''}T00:00:00`).getTime();
    return Number.isFinite(ms) ? ms : null;
}

function addDays(value, days) {
    const ms = dateMs(value);
    if (ms === null) return '';
    const date = new Date(ms + DAY_MS * days);
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function daysUntil(value) {
    const target = dateMs(value);
    const today = dateMs(todayValue());
    if (target === null || today === null) return null;
    return Math.round((target - today) / DAY_MS);
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

function geckoById(id) {
    return state.geckos.find((gecko) => gecko.id === id) || null;
}

function geckoByNumber(number) {
    return state.geckos.find((gecko) => String(gecko.number || '') === String(number || '')) || null;
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
    if (!record) return '산란 기록 없음';
    return `총 ${eggTotal(record)}개 · 유 ${numberValue(record.fertileCount)} / 무 ${numberValue(record.infertileCount)} / 미 ${numberValue(record.unknownCount)}`;
}

function activeEggCount(gecko) {
    return recordsOf(gecko).reduce((sum, record) => (
        ACTIVE_EGG_STATUSES.has(record.eggStatus) ? sum + eggTotal(record) : sum
    ), 0);
}

function isBreedingCandidate(gecko) {
    return gecko.sex === '암'
        || gecko.status === '브리딩'
        || Boolean(gecko.pairedWithNumber)
        || recordsOf(gecko).length > 0;
}

function cycleOf(gecko) {
    const records = recordsOf(gecko);
    const latest = records[0] || null;
    const nextStart = latest?.layDate ? addDays(latest.layDate, 30) : '';
    const nextEnd = latest?.layDate ? addDays(latest.layDate, 45) : '';
    const endDate = gecko?.pairingDate ? addDays(gecko.pairingDate, 180) : '';
    const startDays = daysUntil(nextStart);
    let label = '첫 산란 대기';
    let tone = 'empty';

    if (latest?.layDate) {
        if (startDays !== null && startDays <= 0) {
            label = `${shortDate(nextStart)}~${shortDate(nextEnd)} 산란권`;
            tone = 'ready';
        } else if (startDays !== null) {
            label = `${startDays}일 후 산란권`;
            tone = 'wait';
        }
    }

    return { latest, nextStart, nextEnd, endDate, label, tone };
}

function searchText(gecko) {
    const eggText = recordsOf(gecko).map((record) => [
        record.layDate,
        record.eggStatus,
        record.mateNumber,
        record.incubationLocation,
        record.memo
    ].join(' ')).join(' ');
    const activityText = activitiesOf(gecko).map((record) => [
        record.type,
        record.date,
        record.status,
        record.location,
        record.memo
    ].join(' ')).join(' ');
    return [
        gecko.number,
        gecko.name,
        gecko.sex,
        gecko.status,
        gecko.location,
        gecko.morph,
        gecko.motherNumber,
        gecko.fatherNumber,
        gecko.pairedWithNumber,
        gecko.breeder,
        gecko.memo,
        ...(gecko.tags || []),
        eggText,
        activityText
    ].join(' ').toLowerCase();
}

function filteredGeckos(query, predicate = null) {
    const lower = String(query || '').trim().toLowerCase();
    return state.geckos
        .filter((gecko) => (!predicate || predicate(gecko)) && (!lower || searchText(gecko).includes(lower)))
        .sort((a, b) => String(a.number || '').localeCompare(String(b.number || ''), 'ko', { numeric: true })
            || String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
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
    el.modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
    el.modePanels.forEach((panel) => panel.classList.toggle('hidden', panel.dataset.modePanel !== mode));
    if (mode === 'search') setTimeout(() => el.searchInput.focus(), 40);
    if (mode === 'feeding') setTimeout(() => el.feedingGeckoSearch.focus(), 40);
}

function setRegisterKind(kind) {
    el.registerKindButtons.forEach((button) => button.classList.toggle('active', button.dataset.registerKind === kind));
    el.registerPanels.forEach((panel) => panel.classList.toggle('hidden', panel.dataset.registerPanel !== kind));
    if (kind === 'single') setTimeout(() => el.regNumber.focus(), 40);
    if (kind === 'hatch') setTimeout(() => el.hatchParentSearch.focus(), 40);
}

function renderHeader() {
    el.headerCount.textContent = `${state.count || state.geckos.length}마리`;
    if (!state.updatedAt) {
        el.headerUpdated.textContent = '저장 전';
        return;
    }
    const date = new Date(state.updatedAt);
    el.headerUpdated.textContent = Number.isNaN(date.getTime())
        ? '저장됨'
        : `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} 저장`;
}

function suggestionButton(gecko, onPick) {
    const button = node('button', 'cgSuggestItem');
    button.type = 'button';
    button.append(
        node('strong', '', titleOf(gecko)),
        node('span', '', [gecko.location, gecko.morph, gecko.status].filter(Boolean).join(' · ') || '정보 없음')
    );
    button.addEventListener('click', () => onPick(gecko));
    return button;
}

function renderSuggestions(input, host, onPick, predicate = null) {
    const query = input.value.trim();
    host.replaceChildren();
    if (!query) return;

    const list = filteredGeckos(query, predicate).slice(0, 10);
    if (!list.length) {
        host.append(node('div', 'cgSuggestEmpty', '검색 결과 없음'));
        return;
    }
    list.forEach((gecko) => host.append(suggestionButton(gecko, onPick)));
}

function clearRegisterForm() {
    editingGeckoId = '';
    el.registerTitle.textContent = '새 개체 등록';
    el.registerForm.reset();
    el.regSex.value = '미확인';
    el.regStatus.value = '보유';
    syncPasswords();
    el.regNumber.focus();
}

function fillRegisterForm(gecko) {
    editingGeckoId = gecko?.id || '';
    el.registerTitle.textContent = gecko ? `${titleOf(gecko)} 수정` : '새 개체 등록';
    el.regNumber.value = gecko?.number || '';
    el.regName.value = gecko?.name || '';
    el.regSex.value = gecko?.sex || '미확인';
    el.regStatus.value = gecko?.status || '보유';
    el.regLocation.value = gecko?.location || '';
    el.regMorph.value = gecko?.morph || '';
    el.regMother.value = gecko?.motherNumber || '';
    el.regFather.value = gecko?.fatherNumber || '';
    el.regPair.value = gecko?.pairedWithNumber || '';
    el.regPairDate.value = gecko?.pairingDate || '';
    el.regHatchDate.value = gecko?.hatchDate || '';
    el.regMemo.value = gecko?.memo || '';
    syncPasswords();
}

function registerPayload(existing = null) {
    return {
        id: editingGeckoId || existing?.id || '',
        number: el.regNumber.value.trim(),
        name: el.regName.value.trim(),
        sex: el.regSex.value,
        status: el.regStatus.value,
        location: el.regLocation.value.trim(),
        morph: el.regMorph.value.trim(),
        motherNumber: el.regMother.value.trim(),
        fatherNumber: el.regFather.value.trim(),
        pairedWithNumber: el.regPair.value.trim(),
        pairingDate: el.regPairDate.value,
        hatchDate: el.regHatchDate.value,
        memo: el.regMemo.value.trim(),
        eggRecords: existing?.eggRecords || [],
        activityRecords: existing?.activityRecords || [],
        tags: existing?.tags || [],
        breeder: existing?.breeder || ''
    };
}

async function saveRegister(event) {
    event.preventDefault();
    const adminPassword = passwordValue(el.regPassword);
    const number = el.regNumber.value.trim();
    const existing = geckoById(editingGeckoId) || geckoByNumber(number);

    if (!number) return toast('번호 필요', '개체 번호를 입력하세요.', 'error');
    if (!adminPassword) return toast('비밀번호 필요', '관리 비밀번호를 입력하세요.', 'error');

    try {
        const data = await api('/api/geckos', {
            method: 'POST',
            body: JSON.stringify({ adminPassword, gecko: registerPayload(existing) })
        });
        state = data;
        editingGeckoId = data.saved?.id || '';
        searchSelectedId = data.saved?.id || searchSelectedId;
        breedingSelectedId = data.saved?.id || breedingSelectedId;
        render();
        fillRegisterForm(data.saved);
        toast('저장 완료', titleOf(data.saved));
    } catch (err) {
        toast('저장 실패', err.message, 'error');
    }
}

function setHatchParent(gecko) {
    hatchParentId = gecko?.id || '';
    el.hatchParentLabel.textContent = gecko ? titleOf(gecko) : '어미 개체를 선택하세요';
    el.hatchParentSearch.value = gecko ? titleOf(gecko) : '';
    el.hatchSuggestions.replaceChildren();
}

function incrementNumber(start, index) {
    const text = String(start || '').trim();
    if (!text) return '';
    const match = text.match(/^(.*?)(\d+)$/);
    if (!match) return index === 0 ? text : `${text}-${index + 1}`;
    return `${match[1]}${String(Number(match[2]) + index).padStart(match[2].length, '0')}`;
}

async function saveHatch(event) {
    event.preventDefault();
    const parent = geckoById(hatchParentId);
    const adminPassword = passwordValue(el.hatchPassword);
    const hatchDate = el.hatchDate.value || todayValue();
    const count = numberValue(el.hatchCount.value);
    const startNumber = el.hatchStartNumber.value.trim();

    if (!parent) return toast('어미 선택 필요', '어미 개체를 먼저 선택하세요.', 'error');
    if (!startNumber) return toast('시작 번호 필요', '새 개체 시작 번호를 입력하세요.', 'error');
    if (!count) return toast('마릿수 확인', '생성할 마릿수를 입력하세요.', 'error');
    if (!adminPassword) return toast('비밀번호 필요', '관리 비밀번호를 입력하세요.', 'error');

    const geckos = Array.from({ length: count }, (_, index) => ({
        number: incrementNumber(startNumber, index),
        name: '',
        sex: '미확인',
        status: '보유',
        location: el.hatchLocation.value.trim(),
        hatchDate,
        motherNumber: parent.number,
        fatherNumber: parent.pairedWithNumber || '',
        breeder: `${titleOf(parent)} 해칭`,
        tags: ['해칭'],
        memo: ''
    }));

    try {
        let data = await api('/api/geckos/import', {
            method: 'POST',
            body: JSON.stringify({ adminPassword, geckos })
        });
        state = data;

        const parentAfter = geckoById(parent.id) || geckoByNumber(parent.number);
        if (parentAfter) {
            const record = {
                id: makeId(),
                type: '해칭',
                date: hatchDate,
                status: `${count}마리`,
                location: el.hatchLocation.value.trim(),
                memo: `${startNumber}부터 생성`,
                createdAt: new Date().toISOString()
            };
            data = await api('/api/geckos', {
                method: 'POST',
                body: JSON.stringify({
                    adminPassword,
                    gecko: {
                        ...parentAfter,
                        activityRecords: [record, ...activitiesOf(parentAfter)]
                    }
                })
            });
            state = data;
        }

        el.hatchStartNumber.value = '';
        setHatchParent(parentAfter || parent);
        render();
        toast('해칭 등록 완료', `${count}마리 생성`);
    } catch (err) {
        toast('해칭 등록 실패', err.message, 'error');
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
        어미: 'motherNumber',
        모: 'motherNumber',
        아비: 'fatherNumber',
        부: 'fatherNumber',
        페어: 'pairedWithNumber',
        페어수컷: 'pairedWithNumber',
        합사일: 'pairingDate',
        부화일: 'hatchDate',
        출생일: 'hatchDate',
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
        render();
        toast('가져오기 완료', `${geckos.length}건 처리`);
    } catch (err) {
        toast('가져오기 실패', err.message, 'error');
    }
}

function setFeedingGecko(gecko) {
    feedingGeckoId = gecko?.id || '';
    el.feedingSelectedLabel.textContent = gecko ? titleOf(gecko) : '개체를 선택하세요';
    el.feedingGeckoSearch.value = gecko ? titleOf(gecko) : '';
    el.feedingSuggestions.replaceChildren();
}

async function saveFeeding(event) {
    event.preventDefault();
    const gecko = geckoById(feedingGeckoId);
    const adminPassword = passwordValue(el.feedingPassword);
    const date = el.feedingDate.value || todayValue();

    if (!gecko) return toast('개체 선택 필요', '개체를 먼저 선택하세요.', 'error');
    if (!adminPassword) return toast('비밀번호 필요', '관리 비밀번호를 입력하세요.', 'error');

    const record = {
        id: makeId(),
        type: '피딩',
        date,
        status: feedingStatus,
        location: el.feedingLocation.value.trim(),
        memo: el.feedingMemo.value.trim(),
        createdAt: new Date().toISOString()
    };
    const tags = new Set(gecko.tags || []);
    if (FEED_ATTENTION_STATUSES.has(feedingStatus)) tags.add('확인필요');

    try {
        const data = await api('/api/geckos', {
            method: 'POST',
            body: JSON.stringify({
                adminPassword,
                gecko: {
                    ...gecko,
                    location: gecko.location || record.location,
                    tags: [...tags],
                    activityRecords: [record, ...activitiesOf(gecko)]
                }
            })
        });
        state = data;
        setFeedingGecko(null);
        el.feedingMemo.value = '';
        el.feedingGeckoSearch.value = '';
        render();
        toast('피딩 기록 완료', `${titleOf(data.saved)} · ${feedingStatus}`);
        el.feedingGeckoSearch.focus();
    } catch (err) {
        toast('피딩 기록 실패', err.message, 'error');
    }
}

function setFeedStatus(status) {
    feedingStatus = status;
    el.feedStatusButtons.forEach((button) => {
        button.classList.toggle('active', button.dataset.feedStatus === status);
    });
}

function renderTodayFeeding() {
    const today = el.feedingDate.value || todayValue();
    const items = state.geckos.flatMap((gecko) => activitiesOf(gecko)
        .filter((record) => record.type === '피딩' && record.date === today)
        .map((record) => ({ gecko, record })))
        .sort((a, b) => String(b.record.createdAt || '').localeCompare(String(a.record.createdAt || '')))
        .slice(0, 30);

    el.todayFeedingCount.textContent = `${items.length}건`;
    el.todayFeedingList.replaceChildren();
    if (!items.length) {
        el.todayFeedingList.append(node('div', 'cgEmpty', '오늘 기록이 없습니다.'));
        return;
    }

    items.forEach(({ gecko, record }) => {
        const card = node('button', 'cgMiniRecord');
        card.type = 'button';
        card.append(
            node('strong', '', `${record.status} · ${titleOf(gecko)}`),
            node('span', '', [record.location, record.memo].filter(Boolean).join(' · ') || '메모 없음')
        );
        card.addEventListener('click', () => {
            searchSelectedId = gecko.id;
            el.searchInput.value = titleOf(gecko);
            setMode('search');
            render();
        });
        el.todayFeedingList.append(card);
    });
}

function geckoCard(gecko, selectedId, onClick) {
    const card = node('button', `cgGeckoCard${gecko.id === selectedId ? ' active' : ''}`);
    card.type = 'button';
    const main = node('div');
    main.append(
        node('strong', '', titleOf(gecko)),
        node('span', '', [gecko.location, gecko.morph].filter(Boolean).join(' · ') || '정보 없음')
    );
    const tags = node('div', 'cgCardTags');
    tags.append(
        node('em', '', gecko.sex || '미확인'),
        node('em', '', gecko.status || '보유')
    );
    if (activeEggCount(gecko)) tags.append(node('em', 'hot', `알 ${activeEggCount(gecko)}`));
    const latestFeed = activitiesOf(gecko).find((record) => record.type === '피딩');
    if (latestFeed) tags.append(node('em', 'warn', `${latestFeed.status} ${shortDate(latestFeed.date)}`));
    card.append(main, tags);
    card.addEventListener('click', () => onClick(gecko));
    return card;
}

function renderSearch() {
    const list = filteredGeckos(el.searchInput.value).slice(0, 250);
    el.searchCount.textContent = `${list.length}건`;
    el.searchList.replaceChildren();

    if (!list.length) {
        el.searchList.append(node('div', 'cgEmpty', '검색 결과가 없습니다.'));
    } else {
        list.forEach((gecko) => {
            el.searchList.append(geckoCard(gecko, searchSelectedId, (picked) => {
                searchSelectedId = picked.id;
                renderSearch();
                renderDetail();
            }));
        });
    }

    if (!geckoById(searchSelectedId) && list[0]) searchSelectedId = list[0].id;
    renderDetail();
}

function infoRow(label, value) {
    const row = node('div', 'cgInfoRow');
    row.append(node('span', '', label), node('strong', '', value || '-'));
    return row;
}

function renderTimeline(records, emptyText) {
    const wrap = node('div', 'cgTimeline');
    if (!records.length) {
        wrap.append(node('div', 'cgEmpty', emptyText));
        return wrap;
    }
    records.forEach((record) => {
        const item = node('article', 'cgTimelineItem');
        item.append(node('strong', '', record.title), node('span', '', record.meta || '-'));
        if (record.memo) item.append(node('p', '', record.memo));
        wrap.append(item);
    });
    return wrap;
}

function renderDetail() {
    const gecko = geckoById(searchSelectedId);
    el.detailEditButton.disabled = !gecko;
    el.detailClutchButton.disabled = !gecko;

    if (!gecko) {
        el.detailTitle.textContent = '개체를 선택하세요';
        el.detailBody.className = 'cgDetailEmpty';
        el.detailBody.textContent = '왼쪽 목록에서 개체를 누르세요.';
        return;
    }

    const cycle = cycleOf(gecko);
    el.detailTitle.textContent = titleOf(gecko);
    el.detailBody.className = 'cgDetail';
    el.detailBody.replaceChildren();

    const hero = node('section', 'cgDetailHero');
    hero.append(
        node('strong', '', titleOf(gecko)),
        node('span', '', [gecko.location, gecko.morph].filter(Boolean).join(' · ') || '기본 정보 없음')
    );

    const grid = node('section', 'cgInfoGrid');
    grid.append(
        infoRow('성별/상태', [gecko.sex, gecko.status].filter(Boolean).join(' · ')),
        infoRow('부화/출생일', gecko.hatchDate),
        infoRow('모 개체', gecko.motherNumber),
        infoRow('부 개체', gecko.fatherNumber),
        infoRow('페어 수컷', gecko.pairedWithNumber),
        infoRow('합사일', gecko.pairingDate),
        infoRow('다음 산란권', cycle.latest ? cycle.label : ''),
        infoRow('예상 종료일', cycle.endDate)
    );

    el.detailBody.append(hero, grid);

    if (gecko.memo) {
        const memo = node('section', 'cgMemo');
        memo.append(node('span', '', '메모'), node('p', '', gecko.memo));
        el.detailBody.append(memo);
    }

    const eggRecords = recordsOf(gecko).map((record) => ({
        title: `${shortDate(record.layDate)} 산란 · ${eggSummary(record)}`,
        meta: [record.eggStatus, record.incubationLocation, record.mateNumber ? `수컷 ${record.mateNumber}` : ''].filter(Boolean).join(' · '),
        memo: record.memo
    }));
    const activityRecords = activitiesOf(gecko).map((record) => ({
        title: `${shortDate(record.date)} ${record.type || '기록'} · ${record.status || '-'}`,
        meta: [record.location, record.memo].filter(Boolean).join(' · '),
        memo: ''
    }));

    el.detailBody.append(
        node('h3', 'cgSectionTitle', '산란 기록'),
        renderTimeline(eggRecords, '산란 기록이 없습니다.'),
        node('h3', 'cgSectionTitle', '피딩/해칭 기록'),
        renderTimeline(activityRecords, '피딩 또는 해칭 기록이 없습니다.')
    );
}

function breedingCard(gecko) {
    const cycle = cycleOf(gecko);
    const card = node('button', `cgBreedingCard ${cycle.tone}${gecko.id === breedingSelectedId ? ' active' : ''}`);
    card.type = 'button';
    card.append(
        node('strong', '', titleOf(gecko)),
        node('span', '', [gecko.location, gecko.pairedWithNumber ? `수컷 ${gecko.pairedWithNumber}` : '수컷 미등록'].filter(Boolean).join(' · ')),
        node('em', '', cycle.latest ? `${shortDate(cycle.latest.layDate)} 산란 · ${cycle.label}` : cycle.label)
    );
    card.addEventListener('click', () => {
        breedingSelectedId = gecko.id;
        renderBreeding();
    });
    return card;
}

function renderBreeding() {
    const list = filteredGeckos(el.breedingSearch.value, isBreedingCandidate).slice(0, 250);
    if (!geckoById(breedingSelectedId) && list[0]) breedingSelectedId = list[0].id;

    el.breedingList.replaceChildren();
    if (!list.length) {
        el.breedingList.append(node('div', 'cgEmpty', '브리딩 개체가 없습니다.'));
    } else {
        list.forEach((gecko) => el.breedingList.append(breedingCard(gecko)));
    }

    const gecko = geckoById(breedingSelectedId);
    el.breedingDetail.replaceChildren();

    if (!gecko) {
        el.breedingTitle.textContent = '개체를 선택하세요';
        el.clutchTargetLabel.textContent = '개체 선택 필요';
        return;
    }

    const cycle = cycleOf(gecko);
    el.breedingTitle.textContent = titleOf(gecko);
    el.clutchTargetLabel.textContent = titleOf(gecko);
    if (!el.clutchMate.value) el.clutchMate.value = gecko.pairedWithNumber || '';

    const summary = node('div', 'cgBreedingSummary');
    summary.append(
        infoRow('페어 수컷', gecko.pairedWithNumber),
        infoRow('합사일', gecko.pairingDate),
        infoRow('예상 종료일', cycle.endDate),
        infoRow('최근 산란', cycle.latest ? `${cycle.latest.layDate} · ${eggSummary(cycle.latest)}` : ''),
        infoRow('다음 산란권', cycle.latest ? cycle.label : '첫 산란 대기'),
        infoRow('보관 알', activeEggCount(gecko) ? `${activeEggCount(gecko)}개` : '')
    );

    const timeline = recordsOf(gecko).map((record) => ({
        title: `${shortDate(record.layDate)} · ${eggSummary(record)}`,
        meta: [record.eggStatus, record.incubationLocation].filter(Boolean).join(' · '),
        memo: record.memo
    }));
    el.breedingDetail.append(summary, node('h3', 'cgSectionTitle', '산란 흐름'), renderTimeline(timeline, '산란 기록이 없습니다.'));
}

function clutchRecord() {
    return {
        id: makeId(),
        layDate: el.clutchLayDate.value || todayValue(),
        eggStatus: el.clutchStatus.value,
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
    const gecko = geckoById(breedingSelectedId);
    const adminPassword = passwordValue(el.clutchPassword);
    const record = clutchRecord();

    if (!gecko) return toast('개체 선택 필요', '산란 개체를 먼저 선택하세요.', 'error');
    if (!adminPassword) return toast('비밀번호 필요', '관리 비밀번호를 입력하세요.', 'error');
    if (eggTotal(record) === 0) return toast('알 개수 확인', '유정, 무정, 미확인 중 하나는 입력하세요.', 'error');

    try {
        const data = await api('/api/geckos', {
            method: 'POST',
            body: JSON.stringify({
                adminPassword,
                gecko: {
                    ...gecko,
                    status: gecko.status === '보유' ? '브리딩' : gecko.status,
                    pairedWithNumber: gecko.pairedWithNumber || record.mateNumber,
                    eggRecords: [record, ...recordsOf(gecko)]
                }
            })
        });
        state = data;
        breedingSelectedId = data.saved?.id || breedingSelectedId;
        searchSelectedId = data.saved?.id || searchSelectedId;
        el.clutchMemo.value = '';
        el.clutchFertile.value = 2;
        el.clutchInfertile.value = 0;
        el.clutchUnknown.value = 0;
        render();
        toast('산란 저장 완료', titleOf(data.saved));
    } catch (err) {
        toast('산란 저장 실패', err.message, 'error');
    }
}

function render() {
    renderHeader();
    renderTodayFeeding();
    renderSearch();
    renderBreeding();
}

async function load() {
    try {
        state = await api('/api/geckos');
        el.hatchDate.value = todayValue();
        el.feedingDate.value = todayValue();
        el.clutchLayDate.value = todayValue();
        syncPasswords();
        searchSelectedId = state.geckos[0]?.id || '';
        breedingSelectedId = state.geckos.find(isBreedingCandidate)?.id || '';
        render();
    } catch (err) {
        toast('불러오기 실패', err.message, 'error');
    }
}

el.modeButtons.forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
});

el.registerKindButtons.forEach((button) => {
    button.addEventListener('click', () => setRegisterKind(button.dataset.registerKind));
});

el.registerForm.addEventListener('submit', saveRegister);
el.registerClearButton.addEventListener('click', clearRegisterForm);
el.hatchForm.addEventListener('submit', saveHatch);
el.importForm.addEventListener('submit', importGeckos);

el.hatchParentSearch.addEventListener('input', () => {
    hatchParentId = '';
    el.hatchParentLabel.textContent = '어미 개체를 선택하세요';
    renderSuggestions(el.hatchParentSearch, el.hatchSuggestions, setHatchParent);
});
el.hatchParentSearch.addEventListener('focus', () => {
    renderSuggestions(el.hatchParentSearch, el.hatchSuggestions, setHatchParent);
});

el.feedingForm.addEventListener('submit', saveFeeding);
el.feedingGeckoSearch.addEventListener('input', () => {
    feedingGeckoId = '';
    el.feedingSelectedLabel.textContent = '개체를 선택하세요';
    renderSuggestions(el.feedingGeckoSearch, el.feedingSuggestions, setFeedingGecko);
});
el.feedingGeckoSearch.addEventListener('focus', () => {
    renderSuggestions(el.feedingGeckoSearch, el.feedingSuggestions, setFeedingGecko);
});
el.feedingDate.addEventListener('change', renderTodayFeeding);
el.feedStatusButtons.forEach((button) => {
    button.addEventListener('click', () => setFeedStatus(button.dataset.feedStatus));
});

el.searchInput.addEventListener('input', renderSearch);
el.detailEditButton.addEventListener('click', () => {
    const gecko = geckoById(searchSelectedId);
    if (!gecko) return;
    fillRegisterForm(gecko);
    setMode('register');
    setRegisterKind('single');
});
el.detailClutchButton.addEventListener('click', () => {
    const gecko = geckoById(searchSelectedId);
    if (!gecko) return;
    breedingSelectedId = gecko.id;
    el.clutchMate.value = gecko.pairedWithNumber || '';
    setMode('breeding');
    renderBreeding();
});

el.breedingSearch.addEventListener('input', renderBreeding);
el.clutchForm.addEventListener('submit', saveClutch);

$$('[data-admin-password]').forEach((input) => {
    input.addEventListener('input', () => {
        if (input.value.trim()) localStorage.setItem(ADMIN_PASSWORD_KEY, input.value.trim());
    });
});

document.addEventListener('click', (event) => {
    if (event.target.closest('.cgSuggest, .cgSearchField')) return;
    $$('.cgSuggest').forEach((host) => host.replaceChildren());
});

setFeedStatus(feedingStatus);
load();
