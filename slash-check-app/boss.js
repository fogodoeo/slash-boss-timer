const bossSummary = document.querySelector('#bossSummary');
const bossShortcutList = document.querySelector('#bossShortcutList');
const bossList = document.querySelector('#bossList');
const bossRowTemplate = document.querySelector('#bossRowTemplate');
const bossSearchInput = document.querySelector('#bossSearchInput');
const commandCount = document.querySelector('#commandCount');
const commandOutput = document.querySelector('#commandOutput');
const copyCommandButton = document.querySelector('#copyCommandButton');
const selectedMemberLabel = document.querySelector('#selectedMemberLabel');
const openProfileButton = document.querySelector('#openProfileButton');
const closeProfileButton = document.querySelector('#closeProfileButton');
const skipProfileButton = document.querySelector('#skipProfileButton');
const profileModal = document.querySelector('#profileModal');
const profileForm = document.querySelector('#profileForm');
const memberSearchInput = document.querySelector('#memberSearchInput');
const memberSuggest = document.querySelector('#memberSuggest');
const toastHost = document.querySelector('#toastHost');

const MEMBER_KEY = 'slashCheckMemberName';
let state = { members: [], bossCuts: {} };
let bosses = [];
let selectedMember = localStorage.getItem(MEMBER_KEY) || '';

function pad2(value) {
    return String(value).padStart(2, '0');
}

function cleanName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function normalizeTimeInput(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 4);
}

function isValidCommandTime(value) {
    if (!/^\d{4}$/.test(value)) return false;
    const hour = Number(value.slice(0, 2));
    const minute = Number(value.slice(2, 4));
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function formatNowCommandTime() {
    const now = new Date();
    return `${pad2(now.getHours())}${pad2(now.getMinutes())}`;
}

function displayTime(value) {
    if (!isValidCommandTime(value)) return '--:--';
    return `${value.slice(0, 2)}:${value.slice(2, 4)}`;
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

function describeCooldown(boss) {
    const hours = Math.floor(boss.쿨타임);
    const minutes = Math.round((boss.쿨타임 - hours) * 60);
    return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
}

function commandFor(boss, cut) {
    return `.컷 ${boss.이름} ${cut.timeValue}`;
}

function isEditingBossTime() {
    return document.activeElement?.classList?.contains('bossTimeInput');
}

function setSelectedMember(name) {
    selectedMember = cleanName(name);
    if (selectedMember) {
        localStorage.setItem(MEMBER_KEY, selectedMember);
        selectedMemberLabel.textContent = selectedMember;
    } else {
        localStorage.removeItem(MEMBER_KEY);
        selectedMemberLabel.textContent = '선택 안 됨';
    }
}

function chooseMember(member) {
    const previousMember = selectedMember;
    setSelectedMember(member);
    closeProfileModal();

    if (previousMember && previousMember !== member) {
        showToast('닉네임 변경됨', `${previousMember} → ${member}`);
        render();
        return;
    }

    showToast(previousMember === member ? '닉네임 확인됨' : '닉네임 설정됨', `현재 닉네임: ${member}`);
    render();
}

function openProfileModal() {
    profileModal.classList.remove('hidden');
    memberSearchInput.value = '';
    renderMemberSuggest();
    setTimeout(() => memberSearchInput.focus(), 50);
}

function closeProfileModal() {
    profileModal.classList.add('hidden');
}

function requireMember() {
    if (state.members.includes(selectedMember)) return selectedMember;
    openProfileModal();
    return null;
}

function getMemberMatches(typed) {
    const query = cleanName(typed).toLowerCase();
    if (!query) return [];
    return state.members
        .filter((member) => member.toLowerCase().includes(query))
        .sort((a, b) => {
            const aName = a.toLowerCase();
            const bName = b.toLowerCase();
            const aIndex = aName.indexOf(query);
            const bIndex = bName.indexOf(query);
            return aIndex - bIndex || a.localeCompare(b, 'ko');
        })
        .slice(0, 12);
}

function renderMemberSuggest() {
    const typed = cleanName(memberSearchInput.value);
    const matches = getMemberMatches(typed);
    memberSuggest.replaceChildren();

    if (!typed) {
        memberSuggest.innerHTML = '<div class="suggestHint">닉네임 일부를 입력하세요.</div>';
        return;
    }

    if (matches.length === 0) {
        memberSuggest.innerHTML = '<div class="suggestHint">추천할 길드원이 없습니다. 관리 페이지의 목록을 확인하세요.</div>';
        return;
    }

    for (const member of matches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'suggestItem';
        button.textContent = member;
        button.addEventListener('click', () => {
            chooseMember(member);
        });
        memberSuggest.append(button);
    }
}

function normalizeCuts(cuts) {
    const next = {};
    for (const [bossName, cut] of Object.entries(cuts || {})) {
        if (!isValidCommandTime(cut?.timeValue)) continue;
        next[bossName] = {
            timeValue: cut.timeValue,
            reporterName: cleanName(cut.reporterName),
            updatedAt: cut.updatedAt
        };
    }
    state.bossCuts = next;
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

async function fetchState(shouldRender = true) {
    const data = await api('/api/state');
    state.members = data.members || [];
    normalizeCuts(data.bossCuts || {});
    if (!state.members.includes(selectedMember)) setSelectedMember('');
    if (shouldRender) {
        if (isEditingBossTime()) {
            renderShortcuts();
            updateCommands();
            renderMemberSuggest();
        } else {
            render();
        }
    }
}

async function loadBosses() {
    const allBosses = await api('/api/bosses');
    bosses = allBosses.filter((boss) => boss.타입 === '시간');
    bossSummary.textContent = `시간 보스 ${bosses.length}개`;
    await fetchState(false);
    render();
}

function bossMatchesSearch(boss) {
    const query = bossSearchInput.value.trim().toLowerCase();
    if (!query) return true;
    return `${boss.이름} ${boss.애칭} ${boss.위치}`.toLowerCase().includes(query);
}

function updateCommands() {
    const commands = bosses
        .filter((boss) => state.bossCuts[boss.이름])
        .map((boss) => commandFor(boss, state.bossCuts[boss.이름]));

    commandOutput.value = commands.join('\n');
    commandCount.textContent = `선택된 보스 ${commands.length}개`;
    copyCommandButton.disabled = commands.length === 0;
}

function renderShortcuts() {
    bossShortcutList.replaceChildren();

    for (const boss of bosses) {
        const isCut = Boolean(state.bossCuts[boss.이름]);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'bossShortcutButton';
        button.classList.toggle('isCut', isCut);
        button.textContent = boss.애칭 || boss.이름;
        button.setAttribute('aria-pressed', String(isCut));
        button.addEventListener('click', () => {
            if (state.bossCuts[boss.이름]) clearBossCut(boss);
            else saveBossCut(boss, formatNowCommandTime());
        });
        bossShortcutList.append(button);
    }
}

function renderBosses() {
    const visibleBosses = bosses.filter(bossMatchesSearch);
    bossList.replaceChildren();

    if (visibleBosses.length === 0) {
        bossList.innerHTML = '<div class="empty small">검색 결과가 없습니다.</div>';
        return;
    }

    for (const boss of visibleBosses) {
        const cut = state.bossCuts[boss.이름];
        const row = bossRowTemplate.content.firstElementChild.cloneNode(true);
        const input = row.querySelector('.bossTimeInput');
        const cutButton = row.querySelector('.bossCutButton');

        row.classList.toggle('isCut', Boolean(cut));
        row.querySelector('.bossName').textContent = boss.이름;
        row.querySelector('.bossAlias').textContent = `${boss.애칭} · ${boss.위치 || '-'}`;
        row.querySelector('.bossCutText').textContent = cut ? `컷 ${displayTime(cut.timeValue)}` : describeCooldown(boss);
        row.querySelector('.bossMeta').textContent = cut ? commandFor(boss, cut) : '컷 버튼을 누르면 현재 시간이 입력됩니다.';
        row.querySelector('.bossReporter').textContent = cut?.reporterName ? `기록자 ${cut.reporterName}` : '';

        input.value = cut?.timeValue || '';
        input.addEventListener('input', () => {
            input.value = normalizeTimeInput(input.value);
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                saveBossCut(boss, input.value);
                input.blur();
            }
        });
        input.addEventListener('change', () => {
            if (state.bossCuts[boss.이름] && isValidCommandTime(input.value)) {
                saveBossCut(boss, input.value);
            }
        });

        cutButton.textContent = cut ? '취소' : '컷';
        cutButton.classList.toggle('cancel', Boolean(cut));
        cutButton.addEventListener('click', () => {
            if (state.bossCuts[boss.이름]) clearBossCut(boss);
            else saveBossCut(boss, input.value);
        });

        bossList.append(row);
    }
}

function render() {
    renderShortcuts();
    renderBosses();
    renderMemberSuggest();
    updateCommands();
}

async function saveBossCut(boss, rawValue) {
    const memberName = requireMember();
    if (!memberName) return;

    const normalized = normalizeTimeInput(rawValue);
    const timeValue = isValidCommandTime(normalized) ? normalized : formatNowCommandTime();

    state.bossCuts[boss.이름] = {
        timeValue,
        reporterName: memberName,
        updatedAt: new Date().toISOString()
    };
    render();

    try {
        const data = await api('/api/boss-cuts', {
            method: 'POST',
            body: JSON.stringify({ bossName: boss.이름, timeValue, reporterName: memberName })
        });
        normalizeCuts(data.cuts);
        render();
        showToast('컷 저장됨', commandFor(boss, state.bossCuts[boss.이름]));
    } catch (err) {
        showToast('컷 저장 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    }
}

async function clearBossCut(boss) {
    delete state.bossCuts[boss.이름];
    render();

    try {
        const data = await api(`/api/boss-cuts?bossName=${encodeURIComponent(boss.이름)}`, { method: 'DELETE' });
        normalizeCuts(data.cuts);
        render();
        showToast('컷 취소됨', boss.이름);
    } catch (err) {
        showToast('컷 취소 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    }
}

async function copyCommands() {
    const text = commandOutput.value.trim();
    if (!text) return;

    try {
        await navigator.clipboard.writeText(text);
        copyCommandButton.textContent = '복사됨';
        showToast('명령어 복사됨', `${text.split('\n').length}개 줄`);
        setTimeout(() => {
            copyCommandButton.textContent = '복사';
        }, 900);
    } catch {
        commandOutput.focus();
        commandOutput.select();
        showToast('복사 권한 필요', '텍스트가 선택됐습니다. 직접 복사하세요.', 'error');
    }
}

bossSearchInput.addEventListener('input', renderBosses);
copyCommandButton.addEventListener('click', copyCommands);
openProfileButton.addEventListener('click', openProfileModal);
closeProfileButton.addEventListener('click', closeProfileModal);
skipProfileButton.addEventListener('click', closeProfileModal);
memberSearchInput.addEventListener('input', renderMemberSuggest);
profileForm.addEventListener('submit', (event) => event.preventDefault());
profileModal.addEventListener('click', (event) => {
    if (event.target === profileModal) closeProfileModal();
});

setSelectedMember(selectedMember);
loadBosses().then(() => {
    if (!state.members.includes(selectedMember)) openProfileModal();
}).catch((err) => {
    bossList.innerHTML = `<div class="empty">${err.message}</div>`;
});

setInterval(() => fetchState(true).catch(() => {}), 1500);
