const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const el = {
    search: $('#searchInput'),
    tabs: $$('[data-view]'),
    cardList: $('#cardList'),
    resultCount: $('#resultCount'),
    listTitle: $('#listTitle'),
    listEyebrow: $('#listEyebrow'),
    detailTitle: $('#detailTitle'),
    detailBody: $('#detailBody'),
    detailEggButton: $('#detailEggButton'),
    detailEditButton: $('#detailEditButton'),
    statTotal: $('#statTotal'),
    statBreeding: $('#statBreeding'),
    statActiveEggs: $('#statActiveEggs'),
    statDue: $('#statDue'),
    geckoTemplate: $('#geckoCardTemplate'),
    geckoModal: $('#geckoModal'),
    geckoForm: $('#geckoForm'),
    closeGeckoButton: $('#closeGeckoButton'),
    openGeckoButton: $('#openGeckoButton'),
    deleteGeckoButton: $('#deleteGeckoButton'),
    eggModal: $('#eggModal'),
    eggForm: $('#eggForm'),
    closeEggButton: $('#closeEggButton'),
    openEggButton: $('#openEggButton'),
    deleteEggButton: $('#deleteEggButton'),
    eggGeckoSearch: $('#eggGeckoSearch'),
    eggSelectedLabel: $('#eggSelectedLabel'),
    eggSuggestions: $('#eggSuggestions'),
    eggTotal: $('#eggTotal'),
    importModal: $('#importModal'),
    importForm: $('#importForm'),
    openImportButton: $('#openImportButton'),
    closeImportButton: $('#closeImportButton'),
    importText: $('#importText'),
    importPassword: $('#importPassword'),
    toastHost: $('#toastHost')
};

const ADMIN_PASSWORD_KEY = 'geckoAdminPassword';
const MAX_CARDS = 260;
const DAY_MS = 86400000;
const NEXT_LAY_MIN_DAYS = 30;
const NEXT_LAY_MAX_DAYS = 45;
const ACTIVE_EGG_STATUSES = new Set(['보관중', '관찰']);
const VIEW_LABELS = {
    all: ['개체 목록', '전체 개체'],
    breeding: ['브리딩', '산란 사이클'],
    incubation: ['인큐베이터', '보관중 알']
};

let state = { geckos: [], count: 0, updatedAt: null };
let currentView = 'all';
let selectedGeckoId = '';
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

function toast(title, message = '', type = 'success') {
    const node = document.createElement('div');
    node.className = `toast ${type === 'error' ? 'error' : ''}`;
    const strong = document.createElement('strong');
    strong.textContent = title;
    const span = document.createElement('span');
    span.textContent = message;
    node.append(strong, span);
    el.toastHost.append(node);
    setTimeout(() => node.remove(), 2600);
}

function todayValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dateMs(value) {
    const ms = new Date(`${value || ''}T00:00:00`).getTime();
    return Number.isFinite(ms) ? ms : null;
}

function addDays(value, days) {
    const ms = dateMs(value);
    if (ms === null) return '';
    const date = new Date(ms + days * DAY_MS);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysUntil(value) {
    const target = dateMs(value);
    const today = dateMs(todayValue());
    if (target === null || today === null) return null;
    return Math.round((target - today) / DAY_MS);
}

function shortDate(value) {
    if (!value) return '-';
    const [, month, day] = String(value).split('-');
    return month && day ? `${month}.${day}` : value;
}

function fullDate(value) {
    return value || '-';
}

function numberValue(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
}

function titleOf(gecko) {
    return `${gecko?.number || ''} ${gecko?.name || ''}`.trim() || '이름 없음';
}

function recordsOf(gecko) {
    return [...(Array.isArray(gecko?.eggRecords) ? gecko.eggRecords : [])]
        .sort((a, b) => String(b.layDate || '').localeCompare(String(a.layDate || '')));
}

function eggTotal(record) {
    return numberValue(record?.fertileCount) + numberValue(record?.infertileCount) + numberValue(record?.unknownCount);
}

function eggLine(record) {
    if (!record) return '산란 기록 없음';
    return `총 ${eggTotal(record)} · 유 ${numberValue(record.fertileCount)} / 무 ${numberValue(record.infertileCount)} / 미 ${numberValue(record.unknownCount)}`;
}

function statsOf(gecko) {
    const records = recordsOf(gecko);
    const latest = records[0] || null;
    const year = todayValue().slice(0, 4);
    const seasonRecords = records.filter((record) => String(record.layDate || '').startsWith(year));
    const totals = records.reduce((acc, record) => {
        acc.eggs += eggTotal(record);
        acc.fertile += numberValue(record.fertileCount);
        acc.infertile += numberValue(record.infertileCount);
        acc.unknown += numberValue(record.unknownCount);
        if (ACTIVE_EGG_STATUSES.has(record.eggStatus)) acc.active += eggTotal(record);
        if (record.eggStatus === '관찰') acc.watch += 1;
        return acc;
    }, { eggs: 0, fertile: 0, infertile: 0, unknown: 0, active: 0, watch: 0 });

    const nextStart = latest ? addDays(latest.layDate, NEXT_LAY_MIN_DAYS) : '';
    const nextEnd = latest ? addDays(latest.layDate, NEXT_LAY_MAX_DAYS) : '';
    const startDiff = daysUntil(nextStart);
    const endDiff = daysUntil(nextEnd);
    let nextLabel = '기록 없음';
    let tone = 'none';

    if (latest && startDiff !== null && endDiff !== null) {
        if (endDiff < 0) {
            nextLabel = `체크 ${Math.abs(endDiff)}일 지남`;
            tone = 'danger';
        } else if (startDiff <= 0) {
            nextLabel = `${shortDate(nextStart)}~${shortDate(nextEnd)} 예상`;
            tone = 'ready';
        } else {
            nextLabel = `${startDiff}일 후 예상`;
            tone = 'wait';
        }
    }

    let averageGap = null;
    const asc = [...records].reverse().filter((record) => record.layDate);
    if (asc.length >= 2) {
        let sum = 0;
        let count = 0;
        for (let i = 1; i < asc.length; i += 1) {
            const prev = dateMs(asc[i - 1].layDate);
            const cur = dateMs(asc[i].layDate);
            if (prev === null || cur === null) continue;
            sum += Math.round((cur - prev) / DAY_MS);
            count += 1;
        }
        if (count) averageGap = Math.round(sum / count);
    }

    return {
        records,
        latest,
        seasonRecords,
        clutches: records.length,
        seasonClutches: seasonRecords.length,
        nextStart,
        nextEnd,
        nextLabel,
        tone,
        averageGap,
        ...totals
    };
}

function isBreeding(gecko) {
    return gecko.sex === '암'
        || gecko.status === '브리딩'
        || Boolean(gecko.pairedWithNumber)
        || recordsOf(gecko).length > 0;
}

function hasActiveEggs(gecko) {
    return recordsOf(gecko).some((record) => ACTIVE_EGG_STATUSES.has(record.eggStatus));
}

function searchText(gecko) {
    const recordsText = recordsOf(gecko).map((record) => [
        record.layDate,
        record.clutchCode,
        record.mateNumber,
        record.incubationLocation,
        record.eggStatus,
        record.memo
    ].join(' ')).join(' ');
    return [
        gecko.number,
        gecko.name,
        gecko.sex,
        gecko.status,
        gecko.location,
        gecko.morph,
        gecko.fatherNumber,
        gecko.motherNumber,
        gecko.pairedWithNumber,
        gecko.breeder,
        gecko.memo,
        ...(gecko.tags || []),
        recordsText
    ].join(' ').toLowerCase();
}

function visibleGeckos() {
    const query = el.search.value.trim().toLowerCase();
    const tonePriority = { danger: 0, ready: 1, wait: 2, none: 3 };
    let list = state.geckos.filter((gecko) => !query || searchText(gecko).includes(query));

    if (currentView === 'breeding') list = list.filter(isBreeding);
    if (currentView === 'incubation') list = list.filter(hasActiveEggs);

    return list.sort((a, b) => {
        if (currentView === 'all') {
            return String(a.number || '').localeCompare(String(b.number || ''), 'ko', { numeric: true });
        }
        const aStats = statsOf(a);
        const bStats = statsOf(b);
        const aNext = daysUntil(aStats.nextStart) ?? 9999;
        const bNext = daysUntil(bStats.nextStart) ?? 9999;
        return (tonePriority[aStats.tone] ?? 9) - (tonePriority[bStats.tone] ?? 9)
            || aNext - bNext
            || String(bStats.latest?.layDate || '').localeCompare(String(aStats.latest?.layDate || ''))
            || String(a.number || '').localeCompare(String(b.number || ''), 'ko', { numeric: true });
    });
}

function setText(root, selector, value) {
    const target = root.querySelector(selector);
    if (target) target.textContent = value || '-';
}

function node(tag, className = '', text = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function selectedGecko() {
    return state.geckos.find((gecko) => gecko.id === selectedGeckoId) || null;
}

function renderStats() {
    let breeding = 0;
    let activeEggs = 0;
    let due = 0;

    for (const gecko of state.geckos) {
        const stats = statsOf(gecko);
        if (isBreeding(gecko)) breeding += 1;
        activeEggs += stats.active;
        if (stats.tone === 'danger' || stats.tone === 'ready') due += 1;
        due += stats.watch;
    }

    el.statTotal.textContent = state.count || state.geckos.length;
    el.statBreeding.textContent = breeding;
    el.statActiveEggs.textContent = activeEggs;
    el.statDue.textContent = due;
}

function renderCards() {
    const list = visibleGeckos();
    if (el.search.value.trim() && list.length === 1) selectedGeckoId = list[0].id;

    const [eyebrow, title] = VIEW_LABELS[currentView] || VIEW_LABELS.all;
    el.listEyebrow.textContent = eyebrow;
    el.listTitle.textContent = title;
    el.resultCount.textContent = `${list.length}건`;
    el.cardList.replaceChildren();

    if (list.length === 0) {
        el.cardList.append(node('div', 'creEmpty', '표시할 개체가 없습니다.'));
        return;
    }

    for (const gecko of list.slice(0, MAX_CARDS)) {
        const stats = statsOf(gecko);
        const card = el.geckoTemplate.content.firstElementChild.cloneNode(true);
        card.classList.toggle('active', gecko.id === selectedGeckoId);
        card.classList.add(`tone-${stats.tone}`);
        setText(card, '.cardTitle', titleOf(gecko));
        setText(card, '.cardSub', [gecko.morph, gecko.sex, gecko.status].filter(Boolean).join(' · '));
        setText(card, '.cardBadge', gecko.status || '보유');
        setText(card, '.cardLocation', gecko.location || '위치 미등록');
        setText(card, '.cardCycle', stats.clutches ? `${stats.clutches}회차 · ${stats.eggs}알` : '산란 없음');
        setText(card, '.cardNext', stats.nextLabel);
        card.addEventListener('click', () => {
            selectedGeckoId = gecko.id;
            render();
            if (window.matchMedia('(max-width: 900px)').matches) {
                document.querySelector('.creDetailPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
        el.cardList.append(card);
    }
}

function metric(label, value, tone = '') {
    const item = node('article', tone ? `tone-${tone}` : '');
    item.append(node('span', '', label), node('strong', '', value || '-'));
    return item;
}

function row(label, value) {
    const item = node('div', 'creInfoRow');
    item.append(node('span', '', label), node('strong', '', value || '-'));
    return item;
}

function renderEggTimeline(gecko) {
    const stats = statsOf(gecko);
    const wrap = node('div', 'creTimeline');
    if (stats.records.length === 0) {
        wrap.append(node('div', 'creEmpty', '아직 산란 기록이 없습니다.'));
        return wrap;
    }

    for (const [index, record] of stats.records.entries()) {
        const cycle = stats.records.length - index;
        const item = node('article', 'creTimelineItem');
        const main = node('div');
        main.append(
            node('strong', '', `${cycle}회차 · ${fullDate(record.layDate)} ${record.clutchCode || ''}`.trim()),
            node('span', '', `${eggLine(record)} · ${record.eggStatus || '보관중'}`)
        );
        const meta = [
            record.mateNumber ? `수컷 ${record.mateNumber}` : '',
            record.hatchDate ? `부화 ${fullDate(record.hatchDate)}` : '',
            record.incubationLocation ? `보관 ${record.incubationLocation}` : ''
        ].filter(Boolean).join(' · ');
        if (meta) main.append(node('small', '', meta));
        if (record.memo) main.append(node('p', '', record.memo));
        const edit = node('button', '', '수정');
        edit.type = 'button';
        edit.addEventListener('click', () => openEggModal(gecko, record));
        item.append(main, edit);
        wrap.append(item);
    }
    return wrap;
}

function renderDetail() {
    const gecko = selectedGecko();
    el.detailBody.replaceChildren();
    el.detailEggButton.disabled = !gecko;
    el.detailEditButton.disabled = !gecko;

    if (!gecko) {
        el.detailTitle.textContent = '개체를 선택하세요';
        el.detailBody.append(node('div', 'creEmpty', '개체를 누르면 위치, 페어링, 산란 사이클이 정리됩니다.'));
        return;
    }

    const stats = statsOf(gecko);
    el.detailTitle.textContent = titleOf(gecko);

    const hero = node('section', 'creDetailHero');
    hero.append(
        node('strong', '', titleOf(gecko)),
        node('span', '', [gecko.location, gecko.morph, gecko.status].filter(Boolean).join(' · ') || '기본 정보 미등록')
    );

    const cycle = node('section', 'creCycleGrid');
    cycle.append(
        metric('이번 시즌', `${stats.seasonClutches}회`),
        metric('전체 산란', `${stats.clutches}회 · ${stats.eggs}알`),
        metric('유정/무정', `유 ${stats.fertile} · 무 ${stats.infertile} · 미 ${stats.unknown}`),
        metric('다음 산란', stats.nextLabel, stats.tone)
    );
    if (stats.averageGap) {
        const note = node('p', 'creCycleNote', `평균 산란 간격 ${stats.averageGap}일 · 최근 기록 기준 자동 계산`);
        cycle.append(note);
    }

    const info = node('section', 'creInfoGrid');
    info.append(
        row('위치', gecko.location),
        row('페어 수컷', gecko.pairedWithNumber),
        row('합사일', fullDate(gecko.pairingDate)),
        row('최근 산란', stats.latest ? `${fullDate(stats.latest.layDate)} · ${eggLine(stats.latest)}` : ''),
        row('부', gecko.fatherNumber),
        row('모', gecko.motherNumber),
        row('무게', gecko.weight ? `${gecko.weight}g · ${fullDate(gecko.weightDate)}` : ''),
        row('출처', gecko.breeder)
    );

    const memo = node('section', 'creMemo');
    memo.append(node('span', '', '메모'), node('p', '', gecko.memo || '-'));

    el.detailBody.append(hero, cycle, info, memo, renderEggTimeline(gecko));
}

function render() {
    el.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === currentView));
    renderStats();
    renderCards();
    renderDetail();
}

function passwordValue(selector) {
    const value = $(selector).value.trim();
    if (value) localStorage.setItem(ADMIN_PASSWORD_KEY, value);
    return value;
}

function fillGeckoForm(gecko = null) {
    editingGeckoId = gecko?.id || '';
    $('#geckoModalTitle').textContent = gecko ? '개체 수정' : '개체 등록';
    $('#geckoNumber').value = gecko?.number || '';
    $('#geckoName').value = gecko?.name || '';
    $('#geckoSex').value = gecko?.sex || '미확인';
    $('#geckoStatus').value = gecko?.status || '보유';
    $('#geckoLocation').value = gecko?.location || '';
    $('#geckoMorph').value = gecko?.morph || '';
    $('#geckoPair').value = gecko?.pairedWithNumber || '';
    $('#geckoPairingDate').value = gecko?.pairingDate || '';
    $('#geckoFather').value = gecko?.fatherNumber || '';
    $('#geckoMother').value = gecko?.motherNumber || '';
    $('#geckoHatchDate').value = gecko?.hatchDate || '';
    $('#geckoAcquiredDate').value = gecko?.acquiredDate || '';
    $('#geckoWeight').value = gecko?.weight || '';
    $('#geckoWeightDate').value = gecko?.weightDate || '';
    $('#geckoBreeder').value = gecko?.breeder || '';
    $('#geckoTags').value = (gecko?.tags || []).join(', ');
    $('#geckoMemo').value = gecko?.memo || '';
    $('#geckoPassword').value = localStorage.getItem(ADMIN_PASSWORD_KEY) || '';
    el.deleteGeckoButton.hidden = !gecko;
}

function openGeckoModal(gecko = null) {
    fillGeckoForm(gecko);
    el.geckoModal.classList.remove('hidden');
    setTimeout(() => $('#geckoNumber').focus(), 40);
}

function closeGeckoModal() {
    el.geckoModal.classList.add('hidden');
    editingGeckoId = '';
}

async function saveGecko(event) {
    event.preventDefault();
    const adminPassword = passwordValue('#geckoPassword');
    if (!adminPassword) {
        toast('비밀번호 필요', '관리자 비밀번호를 입력하세요.', 'error');
        return;
    }

    const existing = state.geckos.find((gecko) => gecko.id === editingGeckoId);
    const gecko = {
        id: editingGeckoId,
        number: $('#geckoNumber').value.trim(),
        name: $('#geckoName').value.trim(),
        sex: $('#geckoSex').value,
        status: $('#geckoStatus').value,
        location: $('#geckoLocation').value.trim(),
        morph: $('#geckoMorph').value.trim(),
        pairedWithNumber: $('#geckoPair').value.trim(),
        pairingDate: $('#geckoPairingDate').value,
        fatherNumber: $('#geckoFather').value.trim(),
        motherNumber: $('#geckoMother').value.trim(),
        hatchDate: $('#geckoHatchDate').value,
        acquiredDate: $('#geckoAcquiredDate').value,
        weight: $('#geckoWeight').value,
        weightDate: $('#geckoWeightDate').value,
        breeder: $('#geckoBreeder').value.trim(),
        tags: $('#geckoTags').value.trim(),
        memo: $('#geckoMemo').value.trim(),
        eggRecords: existing?.eggRecords || []
    };

    try {
        const data = await api('/api/geckos', {
            method: 'POST',
            body: JSON.stringify({ adminPassword, gecko })
        });
        state = data;
        selectedGeckoId = data.saved?.id || selectedGeckoId;
        closeGeckoModal();
        render();
        toast('저장 완료', titleOf(data.saved));
    } catch (err) {
        toast('저장 실패', err.message, 'error');
    }
}

async function deleteGecko() {
    const gecko = state.geckos.find((item) => item.id === editingGeckoId);
    if (!gecko) return;
    if (!confirm(`${titleOf(gecko)} 개체를 삭제할까요?`)) return;
    const adminPassword = passwordValue('#geckoPassword');
    if (!adminPassword) return toast('비밀번호 필요', '관리자 비밀번호를 입력하세요.', 'error');

    try {
        state = await api('/api/geckos', {
            method: 'DELETE',
            body: JSON.stringify({ id: gecko.id, adminPassword })
        });
        selectedGeckoId = '';
        closeGeckoModal();
        render();
        toast('삭제 완료', titleOf(gecko));
    } catch (err) {
        toast('삭제 실패', err.message, 'error');
    }
}

function nextClutchCode(gecko) {
    if (!gecko) return '';
    const count = recordsOf(gecko).length + 1;
    const base = (gecko.number || gecko.name || 'CL').replace(/\s+/g, '').slice(0, 12);
    return `${base}-${todayValue().slice(2, 4)}-${String(count).padStart(2, '0')}`;
}

function updateEggTotal() {
    const total = numberValue($('#eggFertile').value) + numberValue($('#eggInfertile').value) + numberValue($('#eggUnknown').value);
    el.eggTotal.textContent = `${total}개`;
}

function setEggSelected(gecko) {
    editingEggGeckoId = gecko?.id || '';
    el.eggSelectedLabel.textContent = gecko ? titleOf(gecko) : '개체를 선택하세요';
}

function renderSuggestions() {
    const query = el.eggGeckoSearch.value.trim().toLowerCase();
    el.eggSuggestions.replaceChildren();
    if (!query) return;

    const suggestions = state.geckos
        .filter((gecko) => searchText(gecko).includes(query))
        .slice(0, 10);

    for (const gecko of suggestions) {
        const button = node('button');
        button.type = 'button';
        button.append(
            node('strong', '', titleOf(gecko)),
            node('span', '', [gecko.location, gecko.morph, gecko.pairedWithNumber ? `페어 ${gecko.pairedWithNumber}` : ''].filter(Boolean).join(' · ') || '정보 미등록')
        );
        button.addEventListener('click', () => {
            setEggSelected(gecko);
            el.eggGeckoSearch.value = titleOf(gecko);
            el.eggSuggestions.replaceChildren();
            $('#eggClutch').value = nextClutchCode(gecko);
            $('#eggMate').value = gecko.pairedWithNumber || '';
        });
        el.eggSuggestions.append(button);
    }
}

function openEggModal(gecko = null, record = null) {
    const searched = el.search.value.trim() ? visibleGeckos() : [];
    const autoGecko = searched.length === 1 ? searched[0] : null;
    const target = gecko || autoGecko || selectedGecko();
    editingEggRecordId = record?.id || '';
    setEggSelected(target);
    $('#eggModalTitle').textContent = record ? '산란 기록 수정' : '산란 입력';
    el.eggGeckoSearch.value = target ? titleOf(target) : '';
    $('#eggLayDate').value = record?.layDate || todayValue();
    $('#eggStatus').value = record?.eggStatus || '보관중';
    $('#eggFertile').value = record?.fertileCount ?? 2;
    $('#eggInfertile').value = record?.infertileCount ?? 0;
    $('#eggUnknown').value = record?.unknownCount ?? 0;
    $('#eggClutch').value = record?.clutchCode || nextClutchCode(target);
    $('#eggMate').value = record?.mateNumber || target?.pairedWithNumber || '';
    $('#eggHatchDate').value = record?.hatchDate || '';
    $('#eggIncubation').value = record?.incubationLocation || '';
    $('#eggMemo').value = record?.memo || '';
    $('#eggPassword').value = localStorage.getItem(ADMIN_PASSWORD_KEY) || '';
    el.deleteEggButton.hidden = !record;
    el.eggSuggestions.replaceChildren();
    updateEggTotal();
    el.eggModal.classList.remove('hidden');
    setTimeout(() => (target ? $('#eggLayDate') : el.eggGeckoSearch).focus(), 40);
}

function closeEggModal() {
    el.eggModal.classList.add('hidden');
    editingEggGeckoId = '';
    editingEggRecordId = '';
    el.eggSuggestions.replaceChildren();
}

function eggFormRecord() {
    return {
        id: editingEggRecordId,
        layDate: $('#eggLayDate').value,
        eggStatus: $('#eggStatus').value,
        fertileCount: numberValue($('#eggFertile').value),
        infertileCount: numberValue($('#eggInfertile').value),
        unknownCount: numberValue($('#eggUnknown').value),
        clutchCode: $('#eggClutch').value.trim(),
        mateNumber: $('#eggMate').value.trim(),
        hatchDate: $('#eggHatchDate').value,
        incubationLocation: $('#eggIncubation').value.trim(),
        memo: $('#eggMemo').value.trim()
    };
}

async function saveEgg(event) {
    event.preventDefault();
    const gecko = state.geckos.find((item) => item.id === editingEggGeckoId);
    const adminPassword = passwordValue('#eggPassword');
    const record = eggFormRecord();

    if (!gecko) return toast('개체 선택 필요', '산란 개체를 선택하세요.', 'error');
    if (!record.layDate) return toast('산란일 필요', '산란일을 입력하세요.', 'error');
    if (eggTotal(record) === 0) return toast('알 갯수 필요', '유정/무정/미확인 중 하나는 입력하세요.', 'error');
    if (!adminPassword) return toast('비밀번호 필요', '관리자 비밀번호를 입력하세요.', 'error');

    const existingRecords = recordsOf(gecko);
    const nextRecords = editingEggRecordId
        ? existingRecords.map((item) => item.id === editingEggRecordId ? { ...item, ...record } : item)
        : [{ ...record, id: globalThis.crypto?.randomUUID?.() || `${Date.now()}` }, ...existingRecords];

    const savedGecko = {
        ...gecko,
        status: gecko.status === '보유' ? '브리딩' : gecko.status,
        pairedWithNumber: gecko.pairedWithNumber || record.mateNumber,
        eggRecords: nextRecords
    };

    try {
        const data = await api('/api/geckos', {
            method: 'POST',
            body: JSON.stringify({ adminPassword, gecko: savedGecko })
        });
        state = data;
        selectedGeckoId = data.saved?.id || gecko.id;
        currentView = 'breeding';
        closeEggModal();
        render();
        toast('산란 저장 완료', titleOf(data.saved));
    } catch (err) {
        toast('산란 저장 실패', err.message, 'error');
    }
}

async function deleteEgg() {
    const gecko = state.geckos.find((item) => item.id === editingEggGeckoId);
    if (!gecko || !editingEggRecordId) return;
    if (!confirm('이 산란 기록을 삭제할까요?')) return;
    const adminPassword = passwordValue('#eggPassword');
    if (!adminPassword) return toast('비밀번호 필요', '관리자 비밀번호를 입력하세요.', 'error');

    try {
        const data = await api('/api/geckos', {
            method: 'POST',
            body: JSON.stringify({
                adminPassword,
                gecko: {
                    ...gecko,
                    eggRecords: recordsOf(gecko).filter((record) => record.id !== editingEggRecordId)
                }
            })
        });
        state = data;
        closeEggModal();
        render();
        toast('기록 삭제 완료', titleOf(gecko));
    } catch (err) {
        toast('삭제 실패', err.message, 'error');
    }
}

function parseImportRows(text) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const delimiter = lines[0].includes('\t') ? '\t' : ',';
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
        수컷: 'pairedWithNumber',
        페어: 'pairedWithNumber',
        합사일: 'pairingDate',
        출생일: 'hatchDate',
        부화일: 'hatchDate',
        부: 'fatherNumber',
        모: 'motherNumber',
        무게: 'weight',
        메모: 'memo',
        태그: 'tags'
    };
    const headers = lines[0].split(delimiter).map((item) => item.trim());
    return lines.slice(1).map((line) => {
        const row = {};
        line.split(delimiter).forEach((value, index) => {
            const key = map[headers[index]] || headers[index];
            row[key] = value || '';
        });
        return row;
    }).filter((row) => row.number || row.name);
}

async function importGeckos(event) {
    event.preventDefault();
    const adminPassword = passwordValue('#importPassword');
    const geckos = parseImportRows(el.importText.value);
    if (!adminPassword || geckos.length === 0) {
        toast('가져오기 확인', '비밀번호와 붙여넣은 데이터를 확인하세요.', 'error');
        return;
    }

    try {
        state = await api('/api/geckos/import', {
            method: 'POST',
            body: JSON.stringify({ adminPassword, geckos })
        });
        el.importText.value = '';
        closeImportModal();
        render();
        toast('가져오기 완료', `${geckos.length}건 처리`);
    } catch (err) {
        toast('가져오기 실패', err.message, 'error');
    }
}

function openImportModal() {
    $('#importPassword').value = localStorage.getItem(ADMIN_PASSWORD_KEY) || '';
    el.importModal.classList.remove('hidden');
}

function closeImportModal() {
    el.importModal.classList.add('hidden');
}

async function load() {
    try {
        state = await api('/api/geckos');
        if (!selectedGeckoId && state.geckos[0]) selectedGeckoId = state.geckos[0].id;
        render();
    } catch (err) {
        toast('불러오기 실패', err.message, 'error');
    }
}

el.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
        currentView = tab.dataset.view;
        const list = visibleGeckos();
        if (!list.some((gecko) => gecko.id === selectedGeckoId)) selectedGeckoId = list[0]?.id || '';
        render();
    });
});
el.search.addEventListener('input', render);
el.openGeckoButton.addEventListener('click', () => openGeckoModal());
el.closeGeckoButton.addEventListener('click', closeGeckoModal);
el.geckoForm.addEventListener('submit', saveGecko);
el.deleteGeckoButton.addEventListener('click', deleteGecko);
el.detailEditButton.addEventListener('click', () => {
    const gecko = selectedGecko();
    if (gecko) openGeckoModal(gecko);
});
el.openEggButton.addEventListener('click', () => openEggModal());
el.detailEggButton.addEventListener('click', () => {
    const gecko = selectedGecko();
    if (gecko) openEggModal(gecko);
});
el.closeEggButton.addEventListener('click', closeEggModal);
el.eggForm.addEventListener('submit', saveEgg);
el.deleteEggButton.addEventListener('click', deleteEgg);
el.eggGeckoSearch.addEventListener('input', () => {
    setEggSelected(null);
    renderSuggestions();
});
['#eggFertile', '#eggInfertile', '#eggUnknown'].forEach((selector) => {
    $(selector).addEventListener('input', updateEggTotal);
});
el.openImportButton.addEventListener('click', openImportModal);
el.closeImportButton.addEventListener('click', closeImportModal);
el.importForm.addEventListener('submit', importGeckos);
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!el.geckoModal.classList.contains('hidden')) closeGeckoModal();
    else if (!el.eggModal.classList.contains('hidden')) closeEggModal();
    else if (!el.importModal.classList.contains('hidden')) closeImportModal();
});

load();
