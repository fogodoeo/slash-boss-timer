const todayBossCount = document.querySelector('#todayBossCount');
const soonBossCount = document.querySelector('#soonBossCount');
const spawnedBossCount = document.querySelector('#spawnedBossCount');
const participationBossCount = document.querySelector('#participationBossCount');
const timelineSummary = document.querySelector('#timelineSummary');
const bossTimeline = document.querySelector('#bossTimeline');
const bossAlertBanner = document.querySelector('#bossAlertBanner');
const bossAlertTitle = document.querySelector('#bossAlertTitle');
const bossAlertMeta = document.querySelector('#bossAlertMeta');
const bossMainPanel = document.querySelector('.bossMainPanel');
const bossSummary = document.querySelector('#bossSummary');
const bossList = document.querySelector('#bossList');
const bossSearchInput = document.querySelector('#bossSearchInput');
const toggleBossListButton = document.querySelector('#toggleBossListButton');
const filterButtons = [...document.querySelectorAll('[data-filter]')];
const recordSummary = document.querySelector('#recordSummary');
const bossRecordList = document.querySelector('#bossRecordList');
const liveParticipationSummary = document.querySelector('#liveParticipationSummary');
const liveParticipationList = document.querySelector('#liveParticipationList');
const enableBossNotifyButton = document.querySelector('#enableBossNotifyButton');
const selectedMemberLabel = document.querySelector('#selectedMemberLabel');
const openProfileButton = document.querySelector('#openProfileButton');
const closeProfileButton = document.querySelector('#closeProfileButton');
const skipProfileButton = document.querySelector('#skipProfileButton');
const profileModal = document.querySelector('#profileModal');
const profileForm = document.querySelector('#profileForm');
const memberSearchInput = document.querySelector('#memberSearchInput');
const memberSuggest = document.querySelector('#memberSuggest');
const cutModal = document.querySelector('#cutModal');
const cutForm = document.querySelector('#cutForm');
const closeCutModalButton = document.querySelector('#closeCutModalButton');
const cutModalTitle = document.querySelector('#cutModalTitle');
const cutModalDesc = document.querySelector('#cutModalDesc');
const cutDateInput = document.querySelector('#cutDateInput');
const cutTimeInput = document.querySelector('#cutTimeInput');
const requiresParticipationInput = document.querySelector('#requiresParticipationInput');
const participantPasswordField = document.querySelector('#participantPasswordField');
const participantPasswordInput = document.querySelector('#participantPasswordInput');
const joinModal = document.querySelector('#joinModal');
const joinForm = document.querySelector('#joinForm');
const closeJoinModalButton = document.querySelector('#closeJoinModalButton');
const joinModalTitle = document.querySelector('#joinModalTitle');
const joinModalDesc = document.querySelector('#joinModalDesc');
const joinPasswordInput = document.querySelector('#joinPasswordInput');
const participantModal = document.querySelector('#participantModal');
const closeParticipantModalButton = document.querySelector('#closeParticipantModalButton');
const participantModalTitle = document.querySelector('#participantModalTitle');
const participantModalDesc = document.querySelector('#participantModalDesc');
const participantList = document.querySelector('#participantList');
const participantCutDateInput = document.querySelector('#participantCutDateInput');
const participantCutTimeInput = document.querySelector('#participantCutTimeInput');
const participantAdminPasswordInput = document.querySelector('#participantAdminPasswordInput');
const participantCancelReasonInput = document.querySelector('#participantCancelReasonInput');
const participantAddMemberInput = document.querySelector('#participantAddMemberInput');
const participantAddMemberSuggest = document.querySelector('#participantAddMemberSuggest');
const participantAddAdminPasswordInput = document.querySelector('#participantAddAdminPasswordInput');
const addParticipantButton = document.querySelector('#addParticipantButton');
const saveParticipantRecordButton = document.querySelector('#saveParticipantRecordButton');
const deleteParticipantRecordButton = document.querySelector('#deleteParticipantRecordButton');
const timelineItemTemplate = document.querySelector('#timelineItemTemplate');
const bossCardTemplate = document.querySelector('#bossCardTemplate');
const recordItemTemplate = document.querySelector('#recordItemTemplate');
const liveParticipationTemplate = document.querySelector('#liveParticipationTemplate');
const toastHost = document.querySelector('#toastHost');
const resetTimeBossButton = document.querySelector('#resetTimeBossButton');

const MEMBER_KEY = 'slashCheckMemberName';
const ADMIN_PASSWORD_KEY = 'slashCheckAdminPassword';
const BOSS_LIST_OPEN_KEY = 'slashBossListOpen';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SPAWNED_KEEP_MS = 60 * 60 * 1000;
const SOON_MS = 10 * 60 * 1000;
const BOSS_ALERT_MS = 5 * 60 * 1000;
const ORIGINAL_TITLE = document.title;
let state = { now: new Date().toISOString(), members: [], bossCuts: {}, bossCutRecords: [], bossCutLocks: {} };
let bosses = [];
let selectedMember = localStorage.getItem(MEMBER_KEY) || '';
let selectedFilter = 'all';
let lastSyncAt = Date.now();
let selectedCutBoss = null;
let selectedCutLock = null;
let selectedJoinRecord = null;
let selectedParticipantRecord = null;
let isSubmittingCut = false;
let cachedAdminPassword = localStorage.getItem(ADMIN_PASSWORD_KEY) || '';
let bossListOpen = localStorage.getItem(BOSS_LIST_OPEN_KEY) === '1';
let participantAddCandidates = [];
let selectedParticipantAddMember = '';
let bossAlarmAudioContext = null;
let titleAlertTimer = null;
let titleAlertKey = '';
let titleAlertFlip = false;
const notifiedSpawnKeys = new Set();

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

function kstDate(ms) {
    return new Date(ms + KST_OFFSET_MS);
}

function getNowMs() {
    return new Date(state.now).getTime() + (Date.now() - lastSyncAt);
}

function startOfKstDay(ms = getNowMs()) {
    const date = kstDate(ms);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - KST_OFFSET_MS;
}

function formatNowCommandTime() {
    return timeInputValueFromMs(Date.now());
}

function dateInputValueFromMs(ms) {
    const date = kstDate(ms);
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function timeInputValueFromMs(ms) {
    const date = kstDate(ms);
    return `${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}`;
}

function isoFromDateTimeInputs(dateValue, timeValue) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue || '')) return null;
    const normalizedTime = normalizeTimeInput(timeValue);
    if (!isValidCommandTime(normalizedTime)) return null;

    const [year, month, day] = dateValue.split('-').map(Number);
    const hour = Number(normalizedTime.slice(0, 2));
    const minute = Number(normalizedTime.slice(2, 4));
    const ms = Date.UTC(year, month - 1, day, hour, minute, 0) - KST_OFFSET_MS;
    const checkDate = kstDate(ms);

    if (
        checkDate.getUTCFullYear() !== year
        || checkDate.getUTCMonth() + 1 !== month
        || checkDate.getUTCDate() !== day
        || checkDate.getUTCHours() !== hour
        || checkDate.getUTCMinutes() !== minute
    ) {
        return null;
    }

    return new Date(ms).toISOString();
}

function setDateTimeInputs(dateInput, timeInput, ms) {
    dateInput.value = dateInputValueFromMs(ms);
    timeInput.value = timeInputValueFromMs(ms);
}

function stepDateTimeInputs(dateInput, timeInput, minutes) {
    const iso = isoFromDateTimeInputs(dateInput.value, timeInput.value);
    const baseMs = iso ? new Date(iso).getTime() : getNowMs();
    setDateTimeInputs(dateInput, timeInput, baseMs + minutes * 60000);
}

function attachMinuteStepper(timeInput, dateInput) {
    timeInput.addEventListener('input', () => {
        timeInput.value = normalizeTimeInput(timeInput.value);
    });
    timeInput.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        stepDateTimeInputs(dateInput, timeInput, event.key === 'ArrowUp' ? step : -step);
    });
}

function displayTimeValue(value) {
    if (!isValidCommandTime(value)) return '--:--';
    return `${value.slice(0, 2)}:${value.slice(2, 4)}`;
}

function formatKstDateTime(iso, { date = true } = {}) {
    if (!iso) return '-';
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '-';
    const d = kstDate(ms);
    const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
    if (!date) return time;
    return `${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())} ${time}`;
}

function kstDateKey(ms) {
    const d = kstDate(ms);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function formatTimelineDateLabel(ms, now = getNowMs()) {
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const d = kstDate(ms);
    const dayStart = startOfKstDay(ms);
    const todayStart = startOfKstDay(now);
    const dayDiff = Math.round((dayStart - todayStart) / DAY_MS);
    const prefix = dayDiff === 0 ? '오늘' : dayDiff === 1 ? '내일' : dayDiff === -1 ? '어제' : '';
    const dateText = `${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())} ${dayNames[d.getUTCDay()]}`;
    return prefix ? `${prefix} · ${dateText}` : dateText;
}

function formatSpawnTimeForList(ms, now = getNowMs()) {
    return formatKstDateTime(new Date(ms).toISOString(), { date: startOfKstDay(ms) !== startOfKstDay(now) });
}

function formatRemain(targetMs, now = getNowMs()) {
    const diff = targetMs - now;
    if (diff <= 0) return '젠됨';
    const totalMin = Math.ceil(diff / 60000);
    if (totalMin >= 60) return `${Math.floor(totalMin / 60)}시간 ${totalMin % 60}분`;
    return `${totalMin}분`;
}

function formatDuration(ms) {
    if (ms <= 0) return '마감';
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min >= 60) return `${Math.floor(min / 60)}시간 ${min % 60}분`;
    return `${min}:${pad2(sec)}`;
}

function participationOpenMs(record) {
    const ms = record?.participationOpenUntil ? new Date(record.participationOpenUntil).getTime() : 0;
    return Number.isFinite(ms) ? ms : 0;
}

function isParticipationOpen(record, now = getNowMs()) {
    return Boolean(record?.status !== 'canceled' && record?.requiresParticipation && record?.hasParticipantPassword && participationOpenMs(record) > now);
}

function participantNames(record) {
    return (record?.participants || []).map((item) => item.memberName).filter(Boolean);
}

function cancelReasonText(record) {
    return String(record?.cancelReason || '').trim();
}

function activeCutRecords() {
    return (state.bossCutRecords || []).filter((record) => record.status !== 'canceled');
}

function bossLock(bossName) {
    const lock = state.bossCutLocks?.[bossName];
    if (!lock) return null;
    const expiresMs = new Date(lock.expiresAt).getTime();
    return Number.isFinite(expiresMs) && expiresMs > getNowMs() ? lock : null;
}

function isLockedByOther(bossName) {
    const lock = bossLock(bossName);
    return Boolean(lock && lock.memberName !== selectedMember);
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

function cacheAdminPassword(value) {
    cachedAdminPassword = String(value || '');
    if (cachedAdminPassword) localStorage.setItem(ADMIN_PASSWORD_KEY, cachedAdminPassword);
    else localStorage.removeItem(ADMIN_PASSWORD_KEY);
}

function fillAdminPasswordInputs() {
    if (participantAdminPasswordInput && !participantAdminPasswordInput.value) {
        participantAdminPasswordInput.value = cachedAdminPassword;
    }
    if (participantAddAdminPasswordInput && !participantAddAdminPasswordInput.value) {
        participantAddAdminPasswordInput.value = cachedAdminPassword;
    }
}

function syncBossListPanel() {
    bossMainPanel?.classList.toggle('isCollapsed', !bossListOpen);
    if (toggleBossListButton) {
        toggleBossListButton.textContent = bossListOpen ? '목록 접기' : '목록 열기';
        toggleBossListButton.setAttribute('aria-expanded', String(bossListOpen));
    }
}

function setBossListOpen(open) {
    bossListOpen = Boolean(open);
    localStorage.setItem(BOSS_LIST_OPEN_KEY, bossListOpen ? '1' : '0');
    syncBossListPanel();
    renderBosses();
}

function unlockBossAlarmAudio() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    if (!bossAlarmAudioContext) bossAlarmAudioContext = new AudioContextCtor();
    bossAlarmAudioContext.resume?.().catch(() => {});
}

function playBossAlarm() {
    try {
        unlockBossAlarmAudio();
        if (!bossAlarmAudioContext) return;
        const startAt = bossAlarmAudioContext.currentTime + 0.02;
        [0, 0.16, 0.32].forEach((offset) => {
            const oscillator = bossAlarmAudioContext.createOscillator();
            const gain = bossAlarmAudioContext.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, startAt + offset);
            gain.gain.setValueAtTime(0.0001, startAt + offset);
            gain.gain.exponentialRampToValueAtTime(0.12, startAt + offset + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.11);
            oscillator.connect(gain);
            gain.connect(bossAlarmAudioContext.destination);
            oscillator.start(startAt + offset);
            oscillator.stop(startAt + offset + 0.12);
        });
    } catch (err) {
        // 브라우저 정책상 소리가 막히면 배너/탭/시스템 알림만 유지합니다.
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
    showToast(previousMember && previousMember !== member ? '닉네임 변경됨' : '닉네임 설정됨', `현재 닉네임: ${member}`);
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
        memberSuggest.innerHTML = '<div class="suggestHint">추천할 길드원이 없습니다.</div>';
        return;
    }

    for (const member of matches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'suggestItem';
        button.textContent = member;
        button.addEventListener('click', () => chooseMember(member));
        memberSuggest.append(button);
    }
}

function isBossCardControl(target) {
    return Boolean(target.closest('button, a, input, select, textarea, label'));
}

function bossNeedsParticipation(boss) {
    return Number(boss.점수 || 0) > 0;
}

function latestRecordForBoss(boss) {
    return activeCutRecords().find((record) => record.bossName === boss.이름)
        || (state.bossCuts?.[boss.이름] ? {
            id: state.bossCuts[boss.이름].recordId,
            bossName: boss.이름,
            bossAlias: boss.애칭 || '',
            bossType: boss.타입 || '',
            location: boss.위치 || '',
            ...state.bossCuts[boss.이름]
        } : null);
}

function manualNextSpawnMs(boss, latest) {
    if (!boss.nextSpawnAt) return null;
    const spawnMs = new Date(boss.nextSpawnAt).getTime();
    if (!Number.isFinite(spawnMs)) return null;

    const manualUpdatedMs = new Date(boss.nextSpawnUpdatedAt || '').getTime();
    const latestUpdatedMs = new Date(latest?.updatedAt || latest?.cutAt || '').getTime();
    if (latest && Number.isFinite(manualUpdatedMs) && Number.isFinite(latestUpdatedMs) && manualUpdatedMs <= latestUpdatedMs) {
        return null;
    }

    if (latest && !Number.isFinite(manualUpdatedMs)) return null;
    return spawnMs;
}

function nextFixedSpawnMs(boss, fromMs = getNowMs()) {
    if (!Array.isArray(boss.요일) || !boss.시간) return null;
    const [hour, minute] = String(boss.시간).split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const start = startOfKstDay(fromMs);
    for (let offset = 0; offset <= 14; offset += 1) {
        const dayStart = start + offset * DAY_MS;
        const dayName = dayNames[kstDate(dayStart).getUTCDay()];
        if (!boss.요일.includes(dayName)) continue;
        const candidate = dayStart + hour * 60 * 60 * 1000 + minute * 60 * 1000;
        if (candidate > fromMs - SPAWNED_KEEP_MS) return candidate;
    }
    return null;
}

function bossNextSpawnMs(boss) {
    const latest = latestRecordForBoss(boss);
    const manualMs = manualNextSpawnMs(boss, latest);
    if (manualMs) return manualMs;
    if (latest?.nextSpawnAt) {
        const ms = new Date(latest.nextSpawnAt).getTime();
        if (Number.isFinite(ms)) return ms;
    }
    if (boss.nextSpawnAt) {
        const ms = new Date(boss.nextSpawnAt).getTime();
        if (Number.isFinite(ms)) return ms;
    }
    if (boss.타입 === '고정') return nextFixedSpawnMs(boss);
    return null;
}

function buildTimeline() {
    const now = getNowMs();
    const start = startOfKstDay(now) - DAY_MS;
    const end = now + DAY_MS;
    const floor = now - SPAWNED_KEEP_MS;
    const items = [];

    for (const boss of bosses) {
        if (boss.타입 === '고정') {
            const [hour, minute] = String(boss.시간 || '').split(':').map(Number);
            if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;
            const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
            for (let offset = 0; offset <= 3; offset += 1) {
                const dayStart = start + offset * DAY_MS;
                const dayName = dayNames[kstDate(dayStart).getUTCDay()];
                if (!boss.요일?.includes(dayName)) continue;
                const spawnMs = dayStart + hour * 60 * 60 * 1000 + minute * 60 * 1000;
                if (spawnMs >= floor && spawnMs <= end) items.push({ boss, spawnMs, source: 'fixed' });
            }
            continue;
        }

        const latest = latestRecordForBoss(boss);
        const manualMs = manualNextSpawnMs(boss, latest);
        const nextSpawnAt = manualMs ? null : latest?.nextSpawnAt || boss.nextSpawnAt;
        const spawnMs = manualMs || new Date(nextSpawnAt || '').getTime();
        if (Number.isFinite(spawnMs) && spawnMs >= floor && spawnMs <= end) {
            items.push({ boss, spawnMs, source: manualMs ? 'manual' : latest ? 'cut' : 'planned', record: manualMs ? null : latest });
        }
    }

    return items.sort((a, b) => a.spawnMs - b.spawnMs || a.boss.이름.localeCompare(b.boss.이름, 'ko'));
}

function activeParticipationRecords() {
    const now = getNowMs();
    return activeCutRecords()
        .filter((record) => isParticipationOpen(record, now))
        .sort((a, b) => participationOpenMs(a) - participationOpenMs(b));
}

function bossStateFromSpawn(spawnMs, now = getNowMs()) {
    if (!spawnMs) return 'unknown';
    if (spawnMs <= now) return 'spawned';
    if (spawnMs - now <= SOON_MS) return 'soon';
    return 'upcoming';
}

function alertItems(items, now = getNowMs()) {
    return items
        .filter((item) => {
            const diff = item.spawnMs - now;
            return diff >= 0 && diff <= BOSS_ALERT_MS;
        })
        .sort((a, b) => a.spawnMs - b.spawnMs);
}

function stopTitleAlert() {
    if (titleAlertTimer) clearInterval(titleAlertTimer);
    titleAlertTimer = null;
    titleAlertKey = '';
    titleAlertFlip = false;
    document.title = ORIGINAL_TITLE;
}

function startTitleAlert(item) {
    const key = `${item.boss.이름}:${item.spawnMs}`;
    const makeAlertTitle = () => `[젠 ${formatRemain(item.spawnMs, getNowMs())}] ${item.boss.이름}`;

    if (titleAlertKey !== key) {
        stopTitleAlert();
        titleAlertKey = key;
    }

    document.title = makeAlertTitle();
    if (titleAlertTimer) return;

    titleAlertTimer = setInterval(() => {
        titleAlertFlip = !titleAlertFlip;
        document.title = titleAlertFlip ? makeAlertTitle() : ORIGINAL_TITLE;
    }, 1000);
}

function updateBossAlertBanner(items, now = getNowMs()) {
    const alerts = alertItems(items, now);
    const item = alerts[0];

    if (!item) {
        bossAlertBanner?.classList.add('hidden');
        document.body.classList.remove('hasBossAlert');
        stopTitleAlert();
        return;
    }

    document.body.classList.add('hasBossAlert');
    bossAlertBanner?.classList.remove('hidden');
    if (bossAlertTitle) bossAlertTitle.textContent = `${item.boss.이름} ${formatRemain(item.spawnMs, now)}`;
    if (bossAlertMeta) {
        const extra = alerts.length > 1 ? ` · 외 ${alerts.length - 1}개` : '';
        bossAlertMeta.textContent = `${formatKstDateTime(new Date(item.spawnMs).toISOString(), { date: false })} 젠 예정 · ${item.boss.위치 || '위치 미등록'}${extra}`;
    }
    startTitleAlert(item);
}

function maybeNotifyTimeline(items) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = getNowMs();
    for (const item of alertItems(items, now)) {
        const key = `${item.boss.이름}:${item.spawnMs}`;
        if (notifiedSpawnKeys.has(key)) continue;
        notifiedSpawnKeys.add(key);
        new Notification(`${item.boss.이름} 5분 전`, {
            body: `${formatKstDateTime(new Date(item.spawnMs).toISOString(), { date: false })} 젠 예정 · ${formatRemain(item.spawnMs, now)}`,
            tag: `boss-${key}`
        });
        playBossAlarm();
        navigator.vibrate?.([180, 70, 180]);
    }
}

function updateNotifyButton() {
    if (!enableBossNotifyButton) return;
    if (!('Notification' in window)) {
        enableBossNotifyButton.textContent = '알림 미지원';
        enableBossNotifyButton.disabled = true;
        return;
    }
    if (Notification.permission === 'granted') {
        enableBossNotifyButton.textContent = '알림 테스트';
        enableBossNotifyButton.disabled = false;
        return;
    }
    if (Notification.permission === 'denied') {
        enableBossNotifyButton.textContent = '알림 차단';
        enableBossNotifyButton.disabled = true;
        return;
    }
    enableBossNotifyButton.textContent = '알림 켜기';
    enableBossNotifyButton.disabled = false;
}

async function requestNotifications() {
    if (!('Notification' in window)) return;
    unlockBossAlarmAudio();
    const permission = await Notification.requestPermission();
    updateNotifyButton();
    if (permission === 'granted') playBossAlarm();
    showToast(permission === 'granted' ? '알림 켜짐' : '알림 미설정', permission === 'granted' ? '5분 전 배너, 탭 깜빡임, 브라우저 알림을 같이 사용합니다.' : '브라우저 알림은 꺼진 상태입니다.', permission === 'granted' ? 'success' : 'error');
}

function renderOverview(timeline) {
    const now = getNowMs();
    todayBossCount.textContent = timeline.length;
    soonBossCount.textContent = timeline.filter((item) => bossStateFromSpawn(item.spawnMs, now) === 'soon').length;
    spawnedBossCount.textContent = timeline.filter((item) => bossStateFromSpawn(item.spawnMs, now) === 'spawned').length;
    participationBossCount.textContent = activeParticipationRecords().length;
}

function renderLiveParticipation() {
    const now = getNowMs();
    const records = activeParticipationRecords();
    const panel = liveParticipationList.closest('.bossLivePanel');
    liveParticipationSummary.textContent = `열린 기록 ${records.length}건`;
    liveParticipationList.replaceChildren();

    if (records.length === 0) {
        if (panel) panel.hidden = true;
        return;
    }

    if (panel) panel.hidden = false;

    for (const record of records.slice(0, 8)) {
        const item = liveParticipationTemplate.content.firstElementChild.cloneNode(true);
        const names = participantNames(record);
        item.querySelector('.liveTitle').textContent = `${record.bossName} · ${displayTimeValue(record.timeValue)}`;
        item.querySelector('.liveMeta').textContent = `${formatDuration(participationOpenMs(record) - now)} 남음 · 참여 ${names.length}명`;
        item.querySelector('.liveDetailButton').addEventListener('click', () => openParticipantModal(record));
        item.querySelector('.liveJoinButton').addEventListener('click', () => openJoinModal(record));
        liveParticipationList.append(item);
    }
}

function renderTimeline() {
    const timeline = buildTimeline();
    const now = getNowMs();
    const activeAlertKeys = new Set(alertItems(timeline, now).map((item) => `${item.boss.이름}:${item.spawnMs}`));
    renderOverview(timeline);
    updateBossAlertBanner(timeline, now);
    maybeNotifyTimeline(timeline);
    bossTimeline.replaceChildren();

    timelineSummary.textContent = timeline.length > 0
        ? `${timeline[0].boss.이름} ${formatRemain(timeline[0].spawnMs, now)}`
        : '예정 없음';

    if (timeline.length === 0) {
        bossTimeline.innerHTML = '<div class="empty small">24시간 안에 표시할 보스 일정이 없습니다.</div>';
        return;
    }

    let previousDateKey = '';
    let firstDateGroup = true;

    for (const item of timeline.slice(0, 40)) {
        const dateKey = kstDateKey(item.spawnMs);
        if (dateKey !== previousDateKey) {
            const divider = document.createElement('div');
            divider.className = 'timelineDateDivider';
            if (!firstDateGroup) divider.classList.add('isNextDay');
            divider.textContent = formatTimelineDateLabel(item.spawnMs, now);
            bossTimeline.append(divider);
            previousDateKey = dateKey;
            firstDateGroup = false;
        }

        const row = timelineItemTemplate.content.firstElementChild.cloneNode(true);
        const stateName = bossStateFromSpawn(item.spawnMs, now);
        const latest = item.record || latestRecordForBoss(item.boss);
        row.classList.add(stateName, item.boss.타입 === '고정' ? 'fixedBoss' : 'timeBoss');
        row.classList.toggle('alertTarget', activeAlertKeys.has(`${item.boss.이름}:${item.spawnMs}`));
        row.querySelector('.timelineTime').textContent = formatKstDateTime(new Date(item.spawnMs).toISOString(), { date: false });
        row.querySelector('.timelineBossName').textContent = item.boss.이름;
        const timelineMeta = row.querySelector('.timelineMeta');
        timelineMeta.textContent = `${item.boss.위치 || '위치 미등록'}${latest?.requiresParticipation ? ' · 참여 확인' : ''}`;
        row.querySelector('.timelineRemain').textContent = formatRemain(item.spawnMs, now);
        const lock = bossLock(item.boss.이름);
        if (lock && lock.memberName !== selectedMember) {
            row.classList.add('locked');
            timelineMeta.textContent += ` · ${lock.memberName}`;
        }
        row.addEventListener('click', (event) => {
            if (isBossCardControl(event.target)) return;
            if (lock && lock.memberName !== selectedMember) showToast('컷 입력 중', `${lock.memberName} 님이 먼저 열었습니다.`, 'error');
            else openCutModal(item.boss, item.spawnMs);
        });
        bossTimeline.append(row);
    }
}

function bossMatches(boss) {
    const query = bossSearchInput.value.trim().toLowerCase();
    const latest = latestRecordForBoss(boss);
    const typeOk = selectedFilter === 'all'
        || (selectedFilter === 'time' && boss.타입 === '시간')
        || (selectedFilter === 'fixed' && boss.타입 === '고정')
        || (selectedFilter === 'participation' && (bossNeedsParticipation(boss) || latest?.requiresParticipation));
    if (!typeOk) return false;
    if (!query) return true;
    return `${boss.이름} ${boss.애칭} ${boss.위치}`.toLowerCase().includes(query);
}

function renderBosses() {
    const now = getNowMs();
    const visible = bosses.filter(bossMatches).sort((a, b) => {
        const aNext = bossNextSpawnMs(a) || Number.MAX_SAFE_INTEGER;
        const bNext = bossNextSpawnMs(b) || Number.MAX_SAFE_INTEGER;
        return aNext - bNext || a.이름.localeCompare(b.이름, 'ko');
    });

    bossSummary.textContent = `${visible.length}개 / 전체 ${bosses.length}개`;
    syncBossListPanel();
    bossList.replaceChildren();

    if (!bossListOpen) return;

    if (visible.length === 0) {
        bossList.innerHTML = '<div class="empty small">조건에 맞는 보스가 없습니다.</div>';
        return;
    }

    for (const boss of visible) {
        const record = latestRecordForBoss(boss);
        const nextMs = bossNextSpawnMs(boss);
        const spawnState = bossStateFromSpawn(nextMs, now);
        const card = bossCardTemplate.content.firstElementChild.cloneNode(true);
        card.classList.add(spawnState, boss.타입 === '고정' ? 'fixedBoss' : 'timeBoss');

        card.querySelector('.bossName').textContent = boss.이름;
        card.querySelector('.bossLocation').textContent = boss.위치 || '위치 미등록';
        const typeBadge = card.querySelector('.bossTypeBadge');
        typeBadge.textContent = boss.타입 === '고정' ? '고정' : '';
        typeBadge.hidden = boss.타입 !== '고정';
        card.querySelector('.bossCutText').textContent = nextMs
            ? `${formatSpawnTimeForList(nextMs, now)} · ${formatRemain(nextMs, now)}`
            : boss.타입 === '시간' ? '컷 대기' : '일정 없음';
        const metaText = record?.cutAt
            ? `최근 컷 ${formatKstDateTime(record.cutAt)}`
            : boss.타입 === '시간'
                ? ''
                : `${(boss.요일 || []).join(', ')} ${boss.시간 || ''}`;
        const metaEl = card.querySelector('.bossMeta');
        metaEl.textContent = metaText;
        metaEl.hidden = !metaText;
        const participationOpen = isParticipationOpen(record, now);
        const participationText = record?.requiresParticipation
            ? ` · 참여 ${record.participants?.length || 0}명${participationOpen ? ` · ${formatDuration(participationOpenMs(record) - now)}` : record.hasParticipantPassword ? ' · 마감' : ' · 비번 없음'}`
            : '';
        const reporterEl = card.querySelector('.bossReporter');
        reporterEl.textContent = record?.reporterName
            ? `컷 ${record.reporterName}${participationText}`
            : '';
        reporterEl.hidden = !reporterEl.textContent;

        const cutButton = card.querySelector('.bossCutButton');
        const lock = bossLock(boss.이름);
        if (lock && lock.memberName !== selectedMember) {
            cutButton.disabled = true;
            cutButton.textContent = '입력중';
            reporterEl.textContent = `${lock.memberName} 컷 입력 중`;
            reporterEl.hidden = false;
        }
        cutButton.addEventListener('click', () => openCutModal(boss, Number.isFinite(nextMs) ? nextMs : getNowMs()));

        const joinButton = card.querySelector('.bossJoinButton');
        joinButton.disabled = !participationOpen;
        joinButton.textContent = participationOpen ? '참여' : record?.requiresParticipation ? '마감' : '-';
        joinButton.addEventListener('click', () => openJoinModal(record));

        card.addEventListener('click', (event) => {
            if (isBossCardControl(event.target)) return;
            if (record?.id) openParticipantModal(record);
            else openCutModal(boss, Number.isFinite(nextMs) ? nextMs : getNowMs());
        });

        bossList.append(card);
    }
}

function renderRecords() {
    const now = getNowMs();
    const records = (state.bossCutRecords || []).slice(0, 20);
    recordSummary.textContent = `${records.length}건`;
    bossRecordList.replaceChildren();

    if (records.length === 0) {
        bossRecordList.innerHTML = '<div class="empty small">아직 보스 컷 기록이 없습니다.</div>';
        return;
    }

    for (const record of records) {
        const item = recordItemTemplate.content.firstElementChild.cloneNode(true);
        const canceled = record.status === 'canceled';
        item.classList.toggle('canceled', canceled);
        item.querySelector('.recordTitle').textContent = canceled
            ? `${record.bossName} · ${displayTimeValue(record.timeValue)} · 취소됨`
            : `${record.bossName} · ${displayTimeValue(record.timeValue)}`;
        item.querySelector('.recordMeta').textContent = canceled
            ? `${record.canceledBy || '-'} 취소 · ${formatKstDateTime(record.canceledAt || record.updatedAt)}`
            : `${record.reporterName || '-'} · 다음 ${record.nextSpawnAt ? formatKstDateTime(record.nextSpawnAt) : '-'}`;
        const reason = cancelReasonText(record);
        const open = isParticipationOpen(record, now);
        item.querySelector('.recordParticipants').textContent = canceled
            ? `원 입력 ${record.reporterName || '-'} · 참여 ${record.participants?.length || 0}명${reason ? ` · ${reason}` : ''}`
            : record.requiresParticipation
            ? `참여 ${record.participants?.length || 0}명${open ? ` · ${formatDuration(participationOpenMs(record) - now)}` : record.hasParticipantPassword ? ' · 마감' : ' · 비번 없음'}`
            : record.participants?.length
                ? `참여 ${record.participants.length}명`
                : '참여 확인 없음';
        item.querySelector('.recordDetailButton').addEventListener('click', () => openParticipantModal(record));
        const button = item.querySelector('.recordJoinButton');
        button.textContent = canceled ? '취소' : open ? '입력' : record.requiresParticipation ? '마감' : '-';
        button.disabled = canceled || !open;
        button.addEventListener('click', () => openJoinModal(record));
        bossRecordList.append(item);
    }
}

function render() {
    filterButtons.forEach((button) => button.classList.toggle('active', button.dataset.filter === selectedFilter));
    renderLiveParticipation();
    renderTimeline();
    renderBosses();
    renderRecords();
    renderMemberSuggest();
    updateNotifyButton();
}

async function acquireCutLock(boss, defaultMs) {
    const memberName = requireMember();
    if (!memberName) return null;
    const spawnAt = Number.isFinite(defaultMs) ? new Date(defaultMs).toISOString() : null;
    const data = await api('/api/boss-cut-locks', {
        method: 'POST',
        body: JSON.stringify({
            bossName: boss.이름,
            memberName,
            spawnAt
        })
    });
    state.bossCutLocks = data.locks || {};
    return data.lock || null;
}

function releaseSelectedCutLock() {
    if (!selectedCutLock) return;
    const lock = selectedCutLock;
    selectedCutLock = null;
    api(`/api/boss-cut-locks?bossName=${encodeURIComponent(lock.bossName)}&memberName=${encodeURIComponent(lock.memberName)}`, {
        method: 'DELETE'
    }).then((data) => {
        state.bossCutLocks = data.locks || {};
        render();
    }).catch(() => {});
}

async function openCutModal(boss, defaultMs = null) {
    const memberName = requireMember();
    if (!memberName) return;
    try {
        const lock = await acquireCutLock(boss, defaultMs);
        if (!lock) return;
        selectedCutLock = { bossName: lock.bossName, memberName: lock.memberName };
    } catch (err) {
        showToast('컷 입력 대기', err.message, 'error');
        fetchState(true).catch(() => {});
        return;
    }

    const cutMs = Number.isFinite(defaultMs) ? defaultMs : getNowMs();
    selectedCutBoss = boss;
    cutModalTitle.textContent = `${boss.이름} 컷 확인`;
    cutModalDesc.textContent = `${boss.애칭 || '-'} · ${boss.위치 || '-'} · ${boss.타입} · 한국시간 기준으로 기록됩니다.`;
    cutDateInput.value = dateInputValueFromMs(cutMs);
    cutTimeInput.value = timeInputValueFromMs(cutMs);
    requiresParticipationInput.checked = false;
    participantPasswordInput.value = '';
    participantPasswordField.classList.add('hiddenField');
    cutModal.classList.remove('hidden');
    setTimeout(() => cutTimeInput.focus(), 30);
}

function closeCutModal({ releaseLock = true } = {}) {
    selectedCutBoss = null;
    if (releaseLock && !isSubmittingCut) releaseSelectedCutLock();
    cutModal.classList.add('hidden');
}

function openJoinModal(record) {
    if (!record || !record.requiresParticipation) return;
    if (!requireMember()) return;
    if (!isParticipationOpen(record)) {
        showToast('참여 입력 마감', '관리자 수동 추가만 가능합니다.', 'error');
        return;
    }
    selectedJoinRecord = record;
    joinModalTitle.textContent = `${record.bossName} 참여 확인`;
    joinModalDesc.textContent = record.hasParticipantPassword
        ? `${displayTimeValue(record.timeValue)} 컷 기록에 ${selectedMember} 님으로 참여 확인합니다.`
        : '이 기록은 참여 비번이 없어 관리자 수동 추가만 가능합니다.';
    joinPasswordInput.value = '';
    joinPasswordInput.disabled = false;
    joinForm.querySelector('.bossModalPrimary').disabled = false;
    joinModal.classList.remove('hidden');
    setTimeout(() => joinPasswordInput.focus(), 30);
}

function closeJoinModal() {
    selectedJoinRecord = null;
    joinModal.classList.add('hidden');
}

function openParticipantModal(record) {
    selectedParticipantRecord = record;
    const names = participantNames(record);
    const cutMs = new Date(record.cutAt).getTime();
    const canceled = record.status === 'canceled';
    const reason = cancelReasonText(record);
    participantModalTitle.textContent = canceled ? `${record.bossName} 취소 기록` : `${record.bossName} 컷 상세`;
    participantModalDesc.textContent = canceled
        ? `${formatKstDateTime(record.cutAt)} 컷 · ${record.canceledBy || '-'} 취소${reason ? ` · ${reason}` : ''} · 참여 ${names.length}명`
        : `${formatKstDateTime(record.cutAt)} 컷 · 입력 ${record.reporterName || '-'} · 참여 ${names.length}명`;
    participantCutDateInput.value = Number.isFinite(cutMs) ? dateInputValueFromMs(cutMs) : dateInputValueFromMs(getNowMs());
    participantCutTimeInput.value = Number.isFinite(cutMs) ? timeInputValueFromMs(cutMs) : displayTimeValue(record.timeValue).replace(':', '');
    participantCutDateInput.disabled = canceled;
    participantCutTimeInput.disabled = canceled;
    participantAdminPasswordInput.value = cachedAdminPassword;
    participantAdminPasswordInput.disabled = canceled;
    participantCancelReasonInput.value = reason;
    participantCancelReasonInput.disabled = canceled;
    saveParticipantRecordButton.disabled = canceled;
    deleteParticipantRecordButton.disabled = canceled;
    deleteParticipantRecordButton.textContent = canceled ? '취소됨' : '컷 취소';
    const addableCount = renderParticipantAddOptions(record);
    participantAddAdminPasswordInput.value = cachedAdminPassword;
    participantAddMemberInput.disabled = canceled || addableCount === 0;
    participantAddAdminPasswordInput.disabled = canceled || addableCount === 0;
    addParticipantButton.disabled = canceled || addableCount === 0;
    fillAdminPasswordInputs();
    participantList.replaceChildren();

    if (names.length === 0) {
        participantList.innerHTML = '<div class="empty small">아직 확인된 참여자가 없습니다.</div>';
    } else {
        for (const participant of record.participants || []) {
            const row = document.createElement('div');
            row.className = 'participantRow';
            const name = document.createElement('strong');
            name.textContent = participant.memberName;
            const meta = document.createElement('span');
            meta.textContent = `${participant.method === 'admin' ? '관리자 추가' : '비번 확인'} · ${formatKstDateTime(participant.confirmedAt)}`;
            row.append(name, meta);
            participantList.append(row);
        }
    }

    participantModal.classList.remove('hidden');
}

function renderParticipantAddOptions(record) {
    participantAddCandidates = [];
    selectedParticipantAddMember = '';
    participantAddMemberInput.value = '';
    participantAddMemberSuggest.replaceChildren();
    const existing = new Set(participantNames(record));
    participantAddCandidates = state.members.filter((member) => !existing.has(member));

    if (participantAddCandidates.length === 0) {
        participantAddMemberSuggest.innerHTML = '<div class="suggestHint">추가할 길드원이 없습니다.</div>';
        return 0;
    }

    renderParticipantAddSuggest();
    return participantAddCandidates.length;
}

function participantAddMatches() {
    const query = cleanName(participantAddMemberInput.value).toLowerCase();
    const source = participantAddCandidates.length ? participantAddCandidates : state.members;
    if (!query) return source.slice(0, 8);
    return source
        .filter((member) => member.toLowerCase().includes(query))
        .sort((a, b) => {
            const aName = a.toLowerCase();
            const bName = b.toLowerCase();
            return aName.indexOf(query) - bName.indexOf(query) || a.localeCompare(b, 'ko');
        })
        .slice(0, 8);
}

function renderParticipantAddSuggest() {
    participantAddMemberSuggest.replaceChildren();
    if (!selectedParticipantRecord) return;
    if (participantAddCandidates.length === 0) {
        participantAddMemberSuggest.innerHTML = '<div class="suggestHint">추가할 길드원이 없습니다.</div>';
        return;
    }

    const matches = participantAddMatches();
    if (matches.length === 0) {
        participantAddMemberSuggest.innerHTML = '<div class="suggestHint">일치하는 길드원이 없습니다.</div>';
        selectedParticipantAddMember = '';
        return;
    }

    for (const member of matches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'suggestItem';
        button.textContent = member;
        button.addEventListener('click', () => {
            selectedParticipantAddMember = member;
            participantAddMemberInput.value = member;
            renderParticipantAddSuggest();
        });
        participantAddMemberSuggest.append(button);
    }
}

function resolveParticipantAddMember() {
    const typed = cleanName(participantAddMemberInput.value);
    if (selectedParticipantAddMember && participantAddCandidates.includes(selectedParticipantAddMember)) {
        return selectedParticipantAddMember;
    }
    const exact = participantAddCandidates.find((member) => member === typed)
        || participantAddCandidates.find((member) => member.toLowerCase() === typed.toLowerCase());
    if (exact) return exact;
    const matches = participantAddMatches();
    return matches.length === 1 ? matches[0] : '';
}

function closeParticipantModal() {
    selectedParticipantRecord = null;
    participantModal.classList.add('hidden');
}

async function submitCut(event) {
    event.preventDefault();
    const memberName = requireMember();
    if (!memberName || !selectedCutBoss) return;

    const bossName = selectedCutBoss.이름;
    const normalized = normalizeTimeInput(cutTimeInput.value);
    if (!cutDateInput.value || !isValidCommandTime(normalized)) {
        showToast('컷 시간 확인', '날짜와 시간을 다시 확인하세요.', 'error');
        return;
    }

    const timeValue = normalized;
    const cutAt = isoFromDateTimeInputs(cutDateInput.value, timeValue);
    if (!cutAt) {
        showToast('컷 시간 확인', '날짜와 시간을 다시 확인하세요.', 'error');
        return;
    }
    if (requiresParticipationInput.checked && !participantPasswordInput.value.trim()) {
        showToast('참여 비번 확인', '참여 확인을 켰으면 비밀번호를 입력하세요.', 'error');
        return;
    }

    isSubmittingCut = true;
    try {
        const data = await api('/api/boss-cuts', {
            method: 'POST',
            body: JSON.stringify({
                bossName,
                timeValue,
                cutAt,
                reporterName: memberName,
                requiresParticipation: requiresParticipationInput.checked,
                participantPassword: participantPasswordInput.value
            })
        });
        state.bossCuts = data.cuts || {};
        state.bossCutRecords = data.records || [];
        if (state.bossCutLocks) delete state.bossCutLocks[bossName];
        selectedCutLock = null;
        closeCutModal({ releaseLock: false });
        render();
        showToast('컷 저장됨', `.컷 ${bossName} ${timeValue}`);
    } catch (err) {
        showToast('컷 저장 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    } finally {
        isSubmittingCut = false;
    }
}

async function submitJoin(event) {
    event.preventDefault();
    const memberName = requireMember();
    if (!memberName || !selectedJoinRecord) return;

    const bossName = selectedJoinRecord.bossName;
    try {
        const data = await api('/api/boss-cuts/participants', {
            method: 'POST',
            body: JSON.stringify({
                recordId: selectedJoinRecord.id,
                memberName,
                password: joinPasswordInput.value
            })
        });
        state.bossCuts = data.cuts || {};
        state.bossCutRecords = data.records || [];
        closeJoinModal();
        render();
        showToast('참여 확인됨', bossName);
    } catch (err) {
        showToast('참여 확인 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    }
}

async function updateParticipantRecordTime() {
    const memberName = requireMember();
    if (!memberName || !selectedParticipantRecord) return;

    const normalized = normalizeTimeInput(participantCutTimeInput.value);
    if (!participantCutDateInput.value || !isValidCommandTime(normalized)) {
        showToast('컷 시간 확인', '날짜와 시간을 다시 확인하세요.', 'error');
        return;
    }

    const cutAt = isoFromDateTimeInputs(participantCutDateInput.value, normalized);
    if (!cutAt) {
        showToast('컷 시간 확인', '날짜와 시간을 다시 확인하세요.', 'error');
        return;
    }
    if (!participantAdminPasswordInput.value.trim()) {
        showToast('관리자 확인', '관리자 비밀번호를 입력하세요.', 'error');
        return;
    }
    cacheAdminPassword(participantAdminPasswordInput.value.trim());

    try {
        const recordId = selectedParticipantRecord.id;
        const data = await api('/api/boss-cuts/record', {
            method: 'PATCH',
            body: JSON.stringify({
                recordId,
                timeValue: normalized,
                cutAt,
                actorName: memberName,
                adminPassword: participantAdminPasswordInput.value
            })
        });
        state.bossCuts = data.cuts || {};
        state.bossCutRecords = data.records || [];
        const updated = state.bossCutRecords.find((record) => record.id === recordId);
        render();
        if (updated) openParticipantModal(updated);
        showToast('컷 시간 수정됨', `${updated?.bossName || selectedParticipantRecord.bossName} ${displayTimeValue(normalized)}`);
    } catch (err) {
        showToast('컷 시간 수정 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    }
}

async function cancelParticipantRecord() {
    const memberName = requireMember();
    if (!memberName || !selectedParticipantRecord) return;

    const record = selectedParticipantRecord;
    if (!confirm(`${record.bossName} ${formatKstDateTime(record.cutAt)} 컷 기록을 취소 처리할까요?\n기록은 최근 컷에 취소됨으로 남습니다.`)) return;

    try {
        const data = await api('/api/boss-cuts/record', {
            method: 'DELETE',
            body: JSON.stringify({
                recordId: record.id,
                actorName: memberName,
                cancelReason: participantCancelReasonInput.value.trim()
            })
        });
        state.bossCuts = data.cuts || {};
        state.bossCutRecords = data.records || [];
        const canceled = state.bossCutRecords.find((item) => item.id === record.id);
        render();
        if (canceled) openParticipantModal(canceled);
        showToast('컷 기록 취소됨', record.bossName);
    } catch (err) {
        showToast('컷 취소 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    }
}

async function addParticipantManually() {
    const actorName = requireMember();
    if (!actorName || !selectedParticipantRecord) return;

    const record = selectedParticipantRecord;
    const memberName = resolveParticipantAddMember();
    if (!memberName) {
        showToast('참여자 선택 필요', '추천 목록에서 길드원을 선택하세요.', 'error');
        return;
    }
    if (!participantAddAdminPasswordInput.value.trim()) {
        showToast('관리자 확인', '관리자 비밀번호를 입력하세요.', 'error');
        return;
    }
    cacheAdminPassword(participantAddAdminPasswordInput.value.trim());

    try {
        const data = await api('/api/boss-cuts/participants/admin', {
            method: 'POST',
            body: JSON.stringify({
                recordId: record.id,
                memberName,
                actorName,
                adminPassword: participantAddAdminPasswordInput.value
            })
        });
        state.bossCuts = data.cuts || {};
        state.bossCutRecords = data.records || [];
        const updated = state.bossCutRecords.find((item) => item.id === record.id);
        render();
        if (updated) openParticipantModal(updated);
        showToast('참여자 추가됨', `${record.bossName} · ${memberName}`);
    } catch (err) {
        showToast('참여자 추가 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    }
}

async function fetchState(shouldRender = true) {
    const data = await api('/api/state');
    state = {
        now: data.now || new Date().toISOString(),
        members: data.members || [],
        bossCuts: data.bossCuts || {},
        bossCutRecords: data.bossCutRecords || [],
        bossCutLocks: data.bossCutLocks || {}
    };
    lastSyncAt = Date.now();
    if (!state.members.includes(selectedMember)) setSelectedMember('');
    if (shouldRender) render();
}

async function loadBosses() {
    bosses = await api('/api/bosses');
    await fetchState(false);
    render();
}

async function resetTimeBossSpawns() {
    const actorName = selectedMember || '';
    const adminPassword = prompt('시간보스 전체를 지금 즉시 젠된 상태로 초기화합니다.\n관리자 비밀번호를 입력하세요.', cachedAdminPassword);
    if (!adminPassword) return;
    if (!confirm('모든 시간보스의 다음 젠을 지금 시각으로 맞출까요? 최근 컷 기록은 삭제하지 않습니다.')) return;
    cacheAdminPassword(adminPassword.trim());

    try {
        if (resetTimeBossButton) {
            resetTimeBossButton.disabled = true;
            resetTimeBossButton.textContent = '초기화 중';
        }
        const data = await api('/api/bosses/reset-time-spawns', {
            method: 'POST',
            body: JSON.stringify({ actorName, adminPassword })
        });
        bosses = data.bosses || bosses;
        state.bossCuts = data.cuts || state.bossCuts;
        state.bossCutRecords = data.records || state.bossCutRecords;
        state.bossCutLocks = data.locks || {};
        state.now = data.resetAt || new Date().toISOString();
        lastSyncAt = Date.now();
        render();
        showToast('시간보스 초기화 완료', `${data.resetCount || 0}개 보스가 즉시 젠 상태가 됐습니다.`);
    } catch (err) {
        showToast('초기화 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    } finally {
        if (resetTimeBossButton) {
            resetTimeBossButton.disabled = false;
            resetTimeBossButton.textContent = '시간보스 초기화';
        }
    }
}

filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
        selectedFilter = button.dataset.filter;
        render();
    });
});
bossSearchInput.addEventListener('input', renderBosses);
toggleBossListButton?.addEventListener('click', () => setBossListOpen(!bossListOpen));
resetTimeBossButton?.addEventListener('click', resetTimeBossSpawns);
enableBossNotifyButton?.addEventListener('click', requestNotifications);
openProfileButton.addEventListener('click', openProfileModal);
closeProfileButton.addEventListener('click', closeProfileModal);
skipProfileButton.addEventListener('click', closeProfileModal);
memberSearchInput.addEventListener('input', renderMemberSuggest);
profileForm.addEventListener('submit', (event) => event.preventDefault());
profileModal.addEventListener('click', (event) => {
    if (event.target === profileModal) closeProfileModal();
});
cutForm.addEventListener('submit', submitCut);
closeCutModalButton.addEventListener('click', closeCutModal);
cutModal.addEventListener('click', (event) => {
    if (event.target === cutModal) closeCutModal();
});
attachMinuteStepper(cutTimeInput, cutDateInput);
requiresParticipationInput.addEventListener('change', () => {
    participantPasswordField.classList.toggle('hiddenField', !requiresParticipationInput.checked);
    if (!requiresParticipationInput.checked) participantPasswordInput.value = '';
});
joinForm.addEventListener('submit', submitJoin);
closeJoinModalButton.addEventListener('click', closeJoinModal);
joinModal.addEventListener('click', (event) => {
    if (event.target === joinModal) closeJoinModal();
});
closeParticipantModalButton.addEventListener('click', closeParticipantModal);
participantModal.addEventListener('click', (event) => {
    if (event.target === participantModal) closeParticipantModal();
});
attachMinuteStepper(participantCutTimeInput, participantCutDateInput);
participantAdminPasswordInput.addEventListener('input', () => cacheAdminPassword(participantAdminPasswordInput.value));
participantAddAdminPasswordInput.addEventListener('input', () => cacheAdminPassword(participantAddAdminPasswordInput.value));
participantAddMemberInput.addEventListener('input', () => {
    selectedParticipantAddMember = '';
    renderParticipantAddSuggest();
});
participantAddMemberInput.addEventListener('focus', renderParticipantAddSuggest);
saveParticipantRecordButton.addEventListener('click', updateParticipantRecordTime);
deleteParticipantRecordButton.addEventListener('click', cancelParticipantRecord);
addParticipantButton.addEventListener('click', addParticipantManually);

syncBossListPanel();
setSelectedMember(selectedMember);
updateNotifyButton();
loadBosses().then(() => {
    if (!state.members.includes(selectedMember)) openProfileModal();
}).catch((err) => {
    bossList.innerHTML = `<div class="empty">${err.message}</div>`;
});

setInterval(() => render(), 1000);
setInterval(() => fetchState(true).catch(() => {}), 5000);
