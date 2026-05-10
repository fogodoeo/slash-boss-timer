const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const el = {
    search: $('#searchInput'),
    tabs: $$('[data-view]'),
    quickForm: $('#quickEggForm'),
    quickSummary: $('#quickSummary'),
    quickGeckoSearch: $('#quickGeckoSearch'),
    quickSuggestions: $('#quickSuggestions'),
    quickSelectedLabel: $('#quickSelectedLabel'),
    cardList: $('#cardList'),
    actionQueue: $('#actionQueue'),
    recentClutches: $('#recentClutches'),
    queueCount: $('#queueCount'),
    recentCount: $('#recentCount'),
    resultCount: $('#resultCount'),
    listTitle: $('#listTitle'),
    listEyebrow: $('#listEyebrow'),
    detailTitle: $('#detailTitle'),
    detailBody: $('#detailBody'),
    detailEggButton: $('#detailEggButton'),
    detailEditButton: $('#detailEditButton'),
    metricTotal: $('#metricTotal'),
    metricBreeding: $('#metricBreeding'),
    metricEggs: $('#metricEggs'),
    metricAttention: $('#metricAttention'),
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
    toastHost: $('#toastHost')
};

const ADMIN_PASSWORD_KEY = 'geckoAdminPassword';
const DAY_MS = 86400000;
const NEXT_LAY_MIN_DAYS = 30;
const NEXT_LAY_MAX_DAYS = 45;
const INCUBATION_WATCH_DAY = 60;
const MAX_CARDS = 320;
const ACTIVE_EGG_STATUSES = new Set(['보관중', '관찰']);

const VIEW_LABELS = {
    all: ['개체', '전체 개체'],
    breeding: ['브리딩', '브리딩 개체'],
    incubation: ['인큐', '보관중 알'],
    attention: ['확인', '확인 필요']
};

let state = { geckos: [], count: 0, updatedAt: null };
let currentView = 'all';
let selectedGeckoId = '';
let editingGeckoId = '';
let editingEggGeckoId = '';
let editingEggRecordId = '';
let quickGeckoId = '';

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
    node.className = `toast ${type === 'error' ? 'error' : 'success'}`;
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

function daysSince(value) {
    const diff = daysUntil(value);
    return diff === null ? null : -diff;
}

function shortDate(value) {
    if (!value) return '-';
    const [, month, day] = String(value).split('-');
    return month && day ? `${Number(month)}.${String(day).padStart(2, '0')}` : value;
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

function formNumber(id) {
    return numberValue($(id).value);
}

function node(tag, className = '', text = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== '') element.textContent = text;
    return element;
}

function setText(root, selector, value) {
    const target = root.querySelector(selector);
    if (target) target.textContent = value || '-';
}

function recordsOf(gecko) {
    return [...(Array.isArray(gecko?.eggRecords) ? gecko.eggRecords : [])]
        .sort((a, b) => String(b.layDate || '').localeCompare(String(a.layDate || '')));
}

function eggTotal(record) {
    return numberValue(record?.fertileCount) + numberValue(record?.infertileCount) + numberValue(record?.unknownCount);
}

function eggSummary(record) {
    if (!record) return '산란 없음';
    return `총 ${eggTotal(record)} · 유 ${numberValue(record.fertileCount)} / 무 ${numberValue(record.infertileCount)} / 미 ${numberValue(record.unknownCount)}`;
}

function isBreedingCandidate(gecko) {
    return gecko.sex === '암'
        || gecko.status === '브리딩'
        || Boolean(gecko.pairedWithNumber)
        || recordsOf(gecko).length > 0;
}

function activeEggTotal(gecko) {
    return recordsOf(gecko).reduce((sum, record) => (
        ACTIVE_EGG_STATUSES.has(record.eggStatus) ? sum + eggTotal(record) : sum
    ), 0);
}

function activeEggRecords(gecko) {
    return recordsOf(gecko).filter((record) => ACTIVE_EGG_STATUSES.has(record.eggStatus));
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
        if (ACTIVE_EGG_STATUSES.has(record.eggStatus)) acc.activeEggs += eggTotal(record);
        if (record.eggStatus === '관찰') acc.watchRecords += 1;
        return acc;
    }, { eggs: 0, fertile: 0, infertile: 0, unknown: 0, activeEggs: 0, watchRecords: 0 });

    let tone = 'quiet';
    let nextLabel = isBreedingCandidate(gecko) ? '첫 기록 필요' : '산란 없음';
    let nextStart = '';
    let nextEnd = '';
    let nextDays = null;

    if (latest?.layDate) {
        nextStart = addDays(latest.layDate, NEXT_LAY_MIN_DAYS);
        nextEnd = addDays(latest.layDate, NEXT_LAY_MAX_DAYS);
        const startDiff = daysUntil(nextStart);
        const endDiff = daysUntil(nextEnd);
        nextDays = startDiff;

        if (endDiff !== null && endDiff < 0) {
            tone = 'danger';
            nextLabel = `체크 ${Math.abs(endDiff)}일 지남`;
        } else if (startDiff !== null && startDiff <= 0) {
            tone = 'ready';
            nextLabel = `${shortDate(nextStart)}~${shortDate(nextEnd)}`;
        } else if (startDiff !== null) {
            tone = 'wait';
            nextLabel = `${startDiff}일 후`;
        }
    } else if (isBreedingCandidate(gecko)) {
        tone = 'empty';
    }

    let averageGap = null;
    const ascending = [...records].reverse().filter((record) => record.layDate);
    if (ascending.length >= 2) {
        let sum = 0;
        let count = 0;
        for (let i = 1; i < ascending.length; i += 1) {
            const previous = dateMs(ascending[i - 1].layDate);
            const current = dateMs(ascending[i].layDate);
            if (previous === null || current === null) continue;
            sum += Math.round((current - previous) / DAY_MS);
            count += 1;
        }
        if (count) averageGap = Math.round(sum / count);
    }

    return {
        records,
        latest,
        seasonRecords,
        seasonClutches: seasonRecords.length,
        clutches: records.length,
        nextStart,
        nextEnd,
        nextDays,
        nextLabel,
        tone,
        averageGap,
        ...totals
    };
}

function needsAttention(gecko) {
    const stats = statsOf(gecko);
    return ['danger', 'ready', 'empty'].includes(stats.tone)
        || stats.watchRecords > 0
        || activeEggRecords(gecko).some((record) => (daysSince(record.layDate) || 0) >= INCUBATION_WATCH_DAY);
}

function searchText(gecko) {
    const recordText = recordsOf(gecko).map((record) => [
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
        recordText
    ].join(' ').toLowerCase();
}

function visibleGeckos() {
    const query = el.search.value.trim().toLowerCase();
    const tonePriority = { danger: 0, ready: 1, empty: 2, wait: 3, quiet: 4 };
    let list = state.geckos.filter((gecko) => !query || searchText(gecko).includes(query));

    if (currentView === 'breeding') list = list.filter(isBreedingCandidate);
    if (currentView === 'incubation') list = list.filter((gecko) => activeEggTotal(gecko) > 0);
    if (currentView === 'attention') list = list.filter(needsAttention);

    return list.sort((a, b) => {
        if (currentView === 'all' && !query) {
            return String(a.number || '').localeCompare(String(b.number || ''), 'ko', { numeric: true })
                || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
        }
        const aStats = statsOf(a);
        const bStats = statsOf(b);
        return (tonePriority[aStats.tone] ?? 9) - (tonePriority[bStats.tone] ?? 9)
            || (aStats.nextDays ?? 9999) - (bStats.nextDays ?? 9999)
            || String(a.number || '').localeCompare(String(b.number || ''), 'ko', { numeric: true });
    });
}

function allRecentRecords(limit = 12) {
    return state.geckos.flatMap((gecko) => recordsOf(gecko).map((record) => ({ gecko, record })))
        .sort((a, b) => String(b.record.layDate || '').localeCompare(String(a.record.layDate || '')))
        .slice(0, limit);
}

function buildActionItems(limit = 10) {
    const items = [];
    for (const gecko of state.geckos) {
        const stats = statsOf(gecko);
        if (stats.tone === 'danger') {
            items.push({ gecko, tone: 'danger', priority: 0, title: '산란 체크', meta: stats.nextLabel });
        } else if (stats.tone === 'ready') {
            items.push({ gecko, tone: 'ready', priority: 1, title: '산란 가능 구간', meta: stats.nextLabel });
        } else if (stats.tone === 'empty') {
            items.push({ gecko, tone: 'empty', priority: 3, title: '첫 기록 필요', meta: gecko.pairedWithNumber ? `페어 ${gecko.pairedWithNumber}` : gecko.status || '브리딩' });
        }

        for (const record of activeEggRecords(gecko)) {
            const age = daysSince(record.layDate);
            if (record.eggStatus !== '관찰' && (age === null || age < INCUBATION_WATCH_DAY)) continue;
            items.push({
                gecko,
                record,
                tone: record.eggStatus === '관찰' ? 'ready' : 'wait',
                priority: record.eggStatus === '관찰' ? 1 : 2,
                title: '인큐 확인',
                meta: `${age ?? '-'}일차 · ${record.incubationLocation || '위치 미등록'}`
            });
        }
    }
    return items.sort((a, b) => a.priority - b.priority
        || String(a.gecko.number || '').localeCompare(String(b.gecko.number || ''), 'ko', { numeric: true }))
        .slice(0, limit);
}

function selectGecko(geckoId, scroll = false) {
    selectedGeckoId = geckoId || '';
    render();
    if (scroll || window.matchMedia('(max-width: 980px)').matches) {
        document.querySelector('.cbRecordPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function selectedGecko() {
    return state.geckos.find((gecko) => gecko.id === selectedGeckoId) || null;
}

function quickGecko() {
    return state.geckos.find((gecko) => gecko.id === quickGeckoId) || null;
}

function renderMetrics() {
    const breeding = state.geckos.filter(isBreedingCandidate).length;
    const eggs = state.geckos.reduce((sum, gecko) => sum + activeEggTotal(gecko), 0);
    const attention = state.geckos.filter(needsAttention).length;
    el.metricTotal.textContent = state.count || state.geckos.length;
    el.metricBreeding.textContent = breeding;
    el.metricEggs.textContent = eggs;
    el.metricAttention.textContent = attention;
}

function queueNode(item) {
    const button = node('button', `cbQueueItem tone-${item.tone}`);
    button.type = 'button';
    const main = node('div');
    main.append(
        node('strong', '', titleOf(item.gecko)),
        node('span', '', [item.gecko.location, item.gecko.morph].filter(Boolean).join(' · ') || '정보 미등록')
    );
    const side = node('div', 'cbQueueSide');
    side.append(node('em', '', item.title), node('span', '', item.meta || '-'));
    button.append(main, side);
    button.addEventListener('click', () => {
        if (item.record) openEggModal(item.gecko, item.record);
        else selectGecko(item.gecko.id, true);
    });
    return button;
}

function renderQueue() {
    const items = buildActionItems();
    el.queueCount.textContent = `${items.length}건`;
    el.actionQueue.replaceChildren();
    if (items.length === 0) {
        el.actionQueue.append(node('div', 'cbEmpty compact', '오늘 체크할 항목이 없습니다.'));
        return;
    }
    items.forEach((item) => el.actionQueue.append(queueNode(item)));
}

function recentNode(item) {
    const button = node('button', 'cbRecentItem');
    button.type = 'button';
    const line = node('div');
    line.append(
        node('strong', '', titleOf(item.gecko)),
        node('span', '', `${fullDate(item.record.layDate)} · ${eggSummary(item.record)}`)
    );
    const meta = node('small', '', [
        item.record.eggStatus || '보관중',
        item.record.incubationLocation || '',
        item.record.mateNumber ? `수컷 ${item.record.mateNumber}` : ''
    ].filter(Boolean).join(' · '));
    button.append(line, meta);
    button.addEventListener('click', () => openEggModal(item.gecko, item.record));
    return button;
}

function renderRecent() {
    const records = allRecentRecords(8);
    el.recentCount.textContent = `${records.length}건`;
    el.recentClutches.replaceChildren();
    if (records.length === 0) {
        el.recentClutches.append(node('div', 'cbEmpty compact', '산란 기록이 없습니다.'));
        return;
    }
    records.forEach((item) => el.recentClutches.append(recentNode(item)));
}

function updateQuickSummary() {
    const total = formNumber('#quickFertile') + formNumber('#quickInfertile') + formNumber('#quickUnknown');
    const gecko = quickGecko();
    el.quickSummary.textContent = gecko ? `총 ${total}알 · ${titleOf(gecko)}` : `총 ${total}알`;
}

function setQuickSelected(gecko) {
    quickGeckoId = gecko?.id || '';
    el.quickSelectedLabel.textContent = gecko ? titleOf(gecko) : '개체를 선택하세요';
    if (gecko) {
        $('#quickIncubation').value = activeEggRecords(gecko)[0]?.incubationLocation || $('#quickIncubation').value;
    }
    updateQuickSummary();
}

function quickSuggestionButton(gecko) {
    const stats = statsOf(gecko);
    const button = node('button');
    button.type = 'button';
    button.append(
        node('strong', '', titleOf(gecko)),
        node('span', '', [gecko.location, gecko.morph, stats.nextLabel].filter(Boolean).join(' · ') || '정보 미등록')
    );
    button.addEventListener('click', () => {
        setQuickSelected(gecko);
        el.quickGeckoSearch.value = titleOf(gecko);
        el.quickSuggestions.replaceChildren();
        $('#quickIncubation').focus();
    });
    return button;
}

function renderQuickSuggestions() {
    const query = el.quickGeckoSearch.value.trim().toLowerCase();
    el.quickSuggestions.replaceChildren();
    if (!query) {
        setQuickSelected(null);
        return;
    }

    const matches = state.geckos
        .filter((gecko) => searchText(gecko).includes(query))
        .slice(0, 8);

    if (matches.length === 1) setQuickSelected(matches[0]);
    else setQuickSelected(null);
    matches.forEach((gecko) => el.quickSuggestions.append(quickSuggestionButton(gecko)));
}

function quickRecord() {
    return {
        layDate: $('#quickLayDate').value || todayValue(),
        eggStatus: $('#quickEggStatus').value,
        fertileCount: formNumber('#quickFertile'),
        infertileCount: formNumber('#quickInfertile'),
        unknownCount: formNumber('#quickUnknown'),
        clutchCode: '',
        mateNumber: quickGecko()?.pairedWithNumber || '',
        hatchDate: '',
        incubationLocation: $('#quickIncubation').value.trim(),
        memo: ''
    };
}

async function saveQuickEgg(event) {
    event.preventDefault();
    const gecko = quickGecko();
    const record = quickRecord();
    const adminPassword = passwordValue('#quickPassword');

    if (!gecko) return toast('개체 선택 필요', '번호나 이름을 입력하고 추천 개체를 선택하세요.', 'error');
    if (eggTotal(record) === 0) return toast('알 갯수 필요', '유정/무정/미확인 중 하나는 입력하세요.', 'error');
    if (!adminPassword) return toast('비밀번호 필요', '관리자 비밀번호를 입력하세요.', 'error');

    const savedGecko = {
        ...gecko,
        status: gecko.status === '보유' ? '브리딩' : gecko.status,
        eggRecords: [
            {
                ...record,
                id: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
                clutchCode: nextClutchCode(gecko)
            },
            ...recordsOf(gecko)
        ]
    };

    try {
        const data = await api('/api/geckos', {
            method: 'POST',
            body: JSON.stringify({ adminPassword, gecko: savedGecko })
        });
        state = data;
        selectedGeckoId = data.saved?.id || gecko.id;
        currentView = 'breeding';
        $('#quickFertile').value = '2';
        $('#quickInfertile').value = '0';
        $('#quickUnknown').value = '0';
        el.quickGeckoSearch.select();
        render();
        setQuickSelected(data.saved);
        toast('산란 저장 완료', `${titleOf(data.saved)} · ${eggSummary(record)}`);
    } catch (err) {
        toast('산란 저장 실패', err.message, 'error');
    }
}

function renderCards() {
    const list = visibleGeckos();
    if (el.search.value.trim() && list.length === 1) selectedGeckoId = list[0].id;
    if (!selectedGeckoId && list[0]) selectedGeckoId = list[0].id;

    const [eyebrow, title] = VIEW_LABELS[currentView] || VIEW_LABELS.all;
    el.listEyebrow.textContent = eyebrow;
    el.listTitle.textContent = title;
    el.resultCount.textContent = `${list.length}건`;
    el.cardList.replaceChildren();

    if (list.length === 0) {
        el.cardList.append(node('div', 'cbEmpty', '조건에 맞는 개체가 없습니다.'));
        return;
    }

    for (const gecko of list.slice(0, MAX_CARDS)) {
        const stats = statsOf(gecko);
        const card = el.geckoTemplate.content.firstElementChild.cloneNode(true);
        card.classList.toggle('active', gecko.id === selectedGeckoId);
        card.classList.add(`tone-${stats.tone}`);
        setText(card, '.cardTitle', titleOf(gecko));
        setText(card, '.cardSub', [gecko.morph, gecko.sex, gecko.pairedWithNumber ? `페어 ${gecko.pairedWithNumber}` : ''].filter(Boolean).join(' · '));
        setText(card, '.cardStatus', gecko.status || '보유');
        setText(card, '.cardLocation', gecko.location || '위치 미등록');
        setText(card, '.cardCycle', stats.clutches ? `${stats.clutches}회 · ${stats.activeEggs}알 보관` : '기록 없음');
        setText(card, '.cardNext', stats.nextLabel);
        card.addEventListener('click', () => selectGecko(gecko.id));
        el.cardList.append(card);
    }
}

function metric(label, value, tone = '') {
    const item = node('article', tone ? `tone-${tone}` : '');
    item.append(node('span', '', label), node('strong', '', value || '-'));
    return item;
}

function infoRow(label, value) {
    const row = node('div', 'cbInfoRow');
    row.append(node('span', '', label), node('strong', '', value || '-'));
    return row;
}

function renderTimeline(gecko) {
    const stats = statsOf(gecko);
    const wrap = node('div', 'cbTimeline');
    if (stats.records.length === 0) {
        wrap.append(node('div', 'cbEmpty compact', '산란 기록이 없습니다.'));
        return wrap;
    }

    for (const [index, record] of stats.records.entries()) {
        const cycle = stats.records.length - index;
        const item = node('article', 'cbTimelineItem');
        const age = daysSince(record.layDate);
        const main = node('div');
        main.append(
            node('strong', '', `${cycle}회차 · ${fullDate(record.layDate)} ${record.clutchCode || ''}`.trim()),
            node('span', '', `${eggSummary(record)} · ${record.eggStatus || '보관중'}`)
        );
        const meta = [
            age !== null ? `${age}일차` : '',
            record.incubationLocation ? `보관 ${record.incubationLocation}` : '',
            record.mateNumber ? `수컷 ${record.mateNumber}` : '',
            record.hatchDate ? `부화 ${fullDate(record.hatchDate)}` : ''
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
        el.detailBody.append(node('div', 'cbEmpty', '개체를 선택하면 기록이 표시됩니다.'));
        return;
    }

    const stats = statsOf(gecko);
    el.detailTitle.textContent = titleOf(gecko);

    const hero = node('section', `cbRecordHero tone-${stats.tone}`);
    const heroMain = node('div');
    heroMain.append(
        node('span', '', gecko.number || 'NO NUMBER'),
        node('strong', '', gecko.name || '이름 없음'),
        node('small', '', [gecko.morph, gecko.location].filter(Boolean).join(' · ') || '기본 정보 미등록')
    );
    const heroState = node('div', 'cbRecordState');
    heroState.append(node('em', '', gecko.status || '보유'), node('strong', '', stats.nextLabel));
    hero.append(heroMain, heroState);

    const cycle = node('section', 'cbCycleGrid');
    cycle.append(
        metric('이번 시즌', `${stats.seasonClutches}회`),
        metric('누적 산란', `${stats.clutches}회 · ${stats.eggs}알`),
        metric('보관 알', `${stats.activeEggs}알`),
        metric('다음 체크', stats.nextLabel, stats.tone)
    );

    const quick = node('section', 'cbInfoGrid');
    quick.append(
        infoRow('위치', gecko.location),
        infoRow('성별/상태', [gecko.sex, gecko.status].filter(Boolean).join(' · ')),
        infoRow('페어 수컷', gecko.pairedWithNumber),
        infoRow('합사일', fullDate(gecko.pairingDate)),
        infoRow('최근 산란', stats.latest ? `${fullDate(stats.latest.layDate)} · ${eggSummary(stats.latest)}` : ''),
        infoRow('혈통', [gecko.fatherNumber ? `부 ${gecko.fatherNumber}` : '', gecko.motherNumber ? `모 ${gecko.motherNumber}` : ''].filter(Boolean).join(' · ')),
        infoRow('무게', gecko.weight ? `${gecko.weight}g · ${fullDate(gecko.weightDate)}` : ''),
        infoRow('출처', gecko.breeder)
    );

    if (stats.averageGap) {
        const note = node('section', 'cbAutoNote');
        note.append(node('span', '', '자동 계산'), node('strong', '', `평균 산란 간격 ${stats.averageGap}일`));
        el.detailBody.append(hero, cycle, note, quick);
    } else {
        el.detailBody.append(hero, cycle, quick);
    }

    if (gecko.memo) {
        const memo = node('section', 'cbMemo');
        memo.append(node('span', '', '메모'), node('p', '', gecko.memo));
        el.detailBody.append(memo);
    }

    const timelineHead = node('div', 'cbTimelineHead');
    timelineHead.append(node('strong', '', '산란 기록'), node('span', '', `${stats.records.length}건`));
    el.detailBody.append(timelineHead, renderTimeline(gecko));
}

function render() {
    el.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === currentView));
    renderMetrics();
    renderQueue();
    renderRecent();
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
        selectedGeckoId = state.geckos[0]?.id || '';
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
        .slice(0, 12);

    for (const gecko of suggestions) {
        const stats = statsOf(gecko);
        const button = node('button');
        button.type = 'button';
        button.append(
            node('strong', '', titleOf(gecko)),
            node('span', '', [gecko.location, gecko.morph, stats.nextLabel].filter(Boolean).join(' · ') || '정보 미등록')
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
    $('#eggModalTitle').textContent = record ? '산란 기록 수정' : '산란 기록';
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
        입양일: 'acquiredDate',
        부: 'fatherNumber',
        모: 'motherNumber',
        무게: 'weight',
        측정일: 'weightDate',
        출처: 'breeder',
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
        selectedGeckoId = state.geckos[0]?.id || '';
        $('#quickLayDate').value = todayValue();
        $('#quickPassword').value = localStorage.getItem(ADMIN_PASSWORD_KEY) || '';
        updateQuickSummary();
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
el.quickForm.addEventListener('submit', saveQuickEgg);
el.quickGeckoSearch.addEventListener('input', renderQuickSuggestions);
el.quickGeckoSearch.addEventListener('focus', renderQuickSuggestions);
['#quickFertile', '#quickInfertile', '#quickUnknown'].forEach((selector) => {
    const input = $(selector);
    input.addEventListener('input', updateQuickSummary);
    input.addEventListener('change', updateQuickSummary);
});
$$('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
        const [fertile, infertile, unknown] = button.dataset.preset.split(',');
        $('#quickFertile').value = fertile;
        $('#quickInfertile').value = infertile;
        $('#quickUnknown').value = unknown;
        updateQuickSummary();
        $('#quickIncubation').focus();
    });
});
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
    const input = $(selector);
    input.addEventListener('input', updateEggTotal);
    input.addEventListener('change', updateEggTotal);
});
el.eggForm.addEventListener('input', (event) => {
    if (['eggFertile', 'eggInfertile', 'eggUnknown'].includes(event.target.id)) updateEggTotal();
});
el.openImportButton.addEventListener('click', openImportModal);
el.closeImportButton.addEventListener('click', closeImportModal);
el.importForm.addEventListener('submit', importGeckos);
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!el.eggModal.classList.contains('hidden')) closeEggModal();
    else if (!el.geckoModal.classList.contains('hidden')) closeGeckoModal();
    else if (!el.importModal.classList.contains('hidden')) closeImportModal();
});

load();
