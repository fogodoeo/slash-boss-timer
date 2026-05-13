const todayBossCount = document.querySelector('#todayBossCount');
const soonBossCount = document.querySelector('#soonBossCount');
const spawnedBossCount = document.querySelector('#spawnedBossCount');
const participationBossCount = document.querySelector('#participationBossCount');
const timelineSummary = document.querySelector('#timelineSummary');
const bossTimeline = document.querySelector('#bossTimeline');
const bossAlertBanner = document.querySelector('#bossAlertBanner');
const bossAlertTitle = document.querySelector('#bossAlertTitle');
const bossAlertMeta = document.querySelector('#bossAlertMeta');
const bossQuickPanel = document.querySelector('#spawnedBossPanel');
const bossQuickSummary = document.querySelector('#spawnedBossSummary');
const bossQuickList = document.querySelector('#spawnedBossList');
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
const testParticipationPasswordInput = document.querySelector('#testParticipationPasswordInput');
const createTestParticipationButton = document.querySelector('#createTestParticipationButton');
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
const cutSecondInput = document.querySelector('#cutSecondInput');
const cutUncertainInput = document.querySelector('#cutUncertainInput');
const requiresParticipationInput = document.querySelector('#requiresParticipationInput');
const participantPasswordField = document.querySelector('#participantPasswordField');
const participantPasswordInput = document.querySelector('#participantPasswordInput');
const joinModal = document.querySelector('#joinModal');
const joinForm = document.querySelector('#joinForm');
const closeJoinModalButton = document.querySelector('#closeJoinModalButton');
const joinModalTitle = document.querySelector('#joinModalTitle');
const joinModalDesc = document.querySelector('#joinModalDesc');
const joinPasswordInput = document.querySelector('#joinPasswordInput');
const joinPhotoInput = document.querySelector('#joinPhotoInput');
const joinPhotoButton = document.querySelector('#joinPhotoButton');
const joinPhotoStatus = document.querySelector('#joinPhotoStatus');
const participantModal = document.querySelector('#participantModal');
const closeParticipantModalButton = document.querySelector('#closeParticipantModalButton');
const participantModalTitle = document.querySelector('#participantModalTitle');
const participantModalDesc = document.querySelector('#participantModalDesc');
const participantViewButton = document.querySelector('#participantViewButton');
const participantEditButton = document.querySelector('#participantEditButton');
const participantConfirmPanel = document.querySelector('#participantConfirmPanel');
const participantEditPanel = document.querySelector('#participantEditPanel');
const participantList = document.querySelector('#participantList');
const participantProofList = document.querySelector('#participantProofList');
const participantCutDateInput = document.querySelector('#participantCutDateInput');
const participantCutTimeInput = document.querySelector('#participantCutTimeInput');
const participantCutSecondInput = document.querySelector('#participantCutSecondInput');
const participantUncertainInput = document.querySelector('#participantUncertainInput');
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
const NOTIFY_ENABLED_KEY = 'slashCheckNotificationsEnabled';
const BOSS_NOTIFY_LAST_KEY = 'slashBossLastNotificationKey';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SPAWNED_KEEP_MS = 60 * 60 * 1000;
const SOON_MS = 10 * 60 * 1000;
const BOSS_ALERT_MS = 10 * 60 * 1000;
const ORIGINAL_TITLE = document.title;
let state = { now: new Date().toISOString(), members: [], bossCuts: {}, bossCutRecords: [], bossCutLocks: {}, bossParticipationWindowMin: 60 };
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
const quickCutSubmittingBosses = new Set();
let participantAddCandidates = [];
let selectedParticipantAddMember = '';
let selectedParticipantModalMode = 'participants';
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

function notificationsEnabled() {
    const saved = localStorage.getItem(NOTIFY_ENABLED_KEY);
    if (saved === 'off') return false;
    if (saved === 'on') return true;
    return 'Notification' in window && Notification.permission === 'granted';
}

function setNotificationsEnabled(enabled) {
    localStorage.setItem(NOTIFY_ENABLED_KEY, enabled ? 'on' : 'off');
    window.dispatchEvent(new Event('slash-notify-setting-changed'));
}

function displayBossLocation(value) {
    const raw = String(value || '').trim();
    if (!raw) return '위치 미등록';
    if (!/^\s*\(?\s*\d+\s*-\s*\d+/.test(raw)) return raw;
    return raw
        .replace(/^\s*\(?\s*\d+\s*-\s*\d+\s*/, '')
        .replace(/\)\s*$/, '')
        .trim() || raw;
}

function normalizeTimeInput(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 4);
}

function normalizeSecondInput(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 2);
}

function isValidCommandTime(value) {
    if (!/^\d{4}$/.test(value)) return false;
    const hour = Number(value.slice(0, 2));
    const minute = Number(value.slice(2, 4));
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function isValidSecond(value) {
    return /^\d{2}$/.test(value) && Number(value) >= 0 && Number(value) <= 59;
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

function secondInputValueFromMs(ms) {
    const date = kstDate(ms);
    return pad2(date.getUTCSeconds());
}

function isoFromDateTimeInputs(dateValue, timeValue, secondValue = '00') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue || '')) return null;
    const normalizedTime = normalizeTimeInput(timeValue);
    if (!isValidCommandTime(normalizedTime)) return null;
    const normalizedSecond = normalizeSecondInput(secondValue).padStart(2, '0');
    if (!isValidSecond(normalizedSecond)) return null;

    const [year, month, day] = dateValue.split('-').map(Number);
    const hour = Number(normalizedTime.slice(0, 2));
    const minute = Number(normalizedTime.slice(2, 4));
    const second = Number(normalizedSecond);
    const ms = Date.UTC(year, month - 1, day, hour, minute, second) - KST_OFFSET_MS;
    const checkDate = kstDate(ms);

    if (
        checkDate.getUTCFullYear() !== year
        || checkDate.getUTCMonth() + 1 !== month
        || checkDate.getUTCDate() !== day
        || checkDate.getUTCHours() !== hour
        || checkDate.getUTCMinutes() !== minute
        || checkDate.getUTCSeconds() !== second
    ) {
        return null;
    }

    return new Date(ms).toISOString();
}

function setDateTimeInputs(dateInput, timeInput, ms, secondInput = null) {
    dateInput.value = dateInputValueFromMs(ms);
    timeInput.value = timeInputValueFromMs(ms);
    if (secondInput) secondInput.value = secondInputValueFromMs(ms);
}

function stepDateTimeInputs(dateInput, timeInput, minutes, secondInput = null) {
    const iso = isoFromDateTimeInputs(dateInput.value, timeInput.value, secondInput?.value || '00');
    const baseMs = iso ? new Date(iso).getTime() : getNowMs();
    setDateTimeInputs(dateInput, timeInput, baseMs + minutes * 60000, secondInput);
}

function attachMinuteStepper(timeInput, dateInput, secondInput = null) {
    timeInput.addEventListener('input', () => {
        timeInput.value = normalizeTimeInput(timeInput.value);
    });
    timeInput.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        stepDateTimeInputs(dateInput, timeInput, event.key === 'ArrowUp' ? step : -step, secondInput);
    });
    if (!secondInput) return;
    secondInput.addEventListener('input', () => {
        secondInput.value = normalizeSecondInput(secondInput.value);
    });
    secondInput.addEventListener('blur', () => {
        secondInput.value = normalizeSecondInput(secondInput.value).padStart(2, '0');
        if (!isValidSecond(secondInput.value)) secondInput.value = '00';
    });
    secondInput.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const iso = isoFromDateTimeInputs(dateInput.value, timeInput.value, secondInput.value);
        const baseMs = iso ? new Date(iso).getTime() : getNowMs();
        const stepMs = (event.shiftKey ? 10 : 1) * 1000;
        const direction = event.key === 'ArrowUp' ? 1 : -1;
        setDateTimeInputs(dateInput, timeInput, baseMs + direction * stepMs, secondInput);
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

function formatKstDateTimeWithSeconds(iso, { date = true } = {}) {
    if (!iso) return '-';
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) return '-';
    const d = kstDate(ms);
    const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
    if (!date) return time;
    return `${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())} ${time}`;
}

function bossCutMs(record) {
    const ms = new Date(record?.cutAt || '').getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function bossCutClock(record) {
    const ms = bossCutMs(record);
    return ms ? formatKstDateTimeWithSeconds(record.cutAt, { date: false }) : displayTimeValue(record?.timeValue || '');
}

function compareBossCutRecordsForDisplay(a, b) {
    const aMs = bossCutMs(a);
    const bMs = bossCutMs(b);
    const aMinute = Math.floor(aMs / 60000);
    const bMinute = Math.floor(bMs / 60000);
    if (aMinute !== bMinute) return bMinute - aMinute;
    if (aMs !== bMs) return aMs - bMs;
    return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
}

function compareBossCutRecordsByLatest(a, b) {
    const aMs = bossCutMs(a);
    const bMs = bossCutMs(b);
    if (aMs !== bMs) return bMs - aMs;
    return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
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

function formatRemainWithSuffix(targetMs, now = getNowMs()) {
    const remain = formatRemain(targetMs, now);
    return remain === '젠됨' ? remain : `${remain} 남음`;
}

function formatCooldownHours(value) {
    const hours = Number(value);
    if (!Number.isFinite(hours)) return '';
    const rounded = Math.round(hours * 100) / 100;
    return Number.isInteger(rounded) ? `${rounded}시간` : `${rounded}시간`;
}

function bossRuleText(boss) {
    if (!boss) return '';
    if (boss.타입 === '시간') {
        const cooldown = formatCooldownHours(boss.쿨타임);
        return cooldown ? `쿨 ${cooldown}` : '시간보스';
    }
    if (boss.타입 === '고정') {
        const days = Array.isArray(boss.요일) && boss.요일.length > 0 ? boss.요일.join(', ') : '요일 미등록';
        return `${days} ${boss.시간 || '시간 미등록'}`;
    }
    if (boss.타입 === '이벤트') {
        return `${boss.반복 || '반복'} · ${boss.시간 || '시간 미등록'}`;
    }
    return '';
}

function formatDuration(ms) {
    if (ms <= 0) return '마감';
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min >= 60) return `${Math.floor(min / 60)}시간 ${min % 60}분`;
    return `${min}:${pad2(sec)}`;
}

function participationWindowLabel() {
    const minutes = Number(state.bossParticipationWindowMin || 60);
    if (!Number.isFinite(minutes) || minutes <= 0) return '1시간';
    if (minutes % 60 === 0) return `${minutes / 60}시간`;
    if (minutes > 60) return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
    return `${minutes}분`;
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

function hasParticipant(record, memberName = selectedMember) {
    const name = cleanName(memberName);
    if (!name) return false;
    return participantNames(record).some((item) => item === name);
}

function participantProofs(record) {
    return Array.isArray(record?.participantProofs) ? record.participantProofs : [];
}

function activeParticipantProofs(record) {
    return participantProofs(record).filter((proof) => proof.status !== 'expired');
}

function pendingParticipantProofs(record) {
    return participantProofs(record).filter((proof) => proof.status === 'pending');
}

function hasPendingParticipantProof(record, memberName = selectedMember) {
    const name = cleanName(memberName);
    if (!name) return false;
    return pendingParticipantProofs(record).some((proof) => proof.memberName === name);
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

    [...toastHost.querySelectorAll('.toast')].slice(0, -3).forEach((item) => item.remove());

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
    requestAnimationFrame(() => toast.classList.add('show'));

    let closing = false;
    const closeToast = () => {
        if (closing) return;
        closing = true;
        toast.classList.remove('show');
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 260);
    };
    const timer = setTimeout(closeToast, tone === 'error' ? 4200 : 2800);
    toast.addEventListener('click', () => {
        clearTimeout(timer);
        closeToast();
    });
}

function setNotifyButton(button, text, state, disabled = false) {
    if (!button) return;
    const textEl = button.querySelector('.notifyText');
    if (textEl) textEl.textContent = text;
    else button.textContent = text;
    button.dataset.notifyState = state;
    button.disabled = disabled;
    button.title = text;
    button.setAttribute('aria-label', text);
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
    const latest = activeCutRecords()
        .filter((record) => record.bossName === boss.이름)
        .sort(compareBossCutRecordsByLatest)[0];
    return latest
        || (state.bossCuts?.[boss.이름] ? {
            id: state.bossCuts[boss.이름].recordId,
            bossName: boss.이름,
            bossAlias: boss.애칭 || '',
            bossType: boss.타입 || '',
            location: boss.위치 || '',
            ...state.bossCuts[boss.이름]
        } : null);
}

function isTimeBossRecord(record) {
    if (!record) return false;
    if (record.bossType) return record.bossType === '시간';
    const boss = bosses.find((item) => item.이름 === record.bossName || item.애칭 === record.bossName);
    return boss?.타입 === '시간';
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

function nextFixedSpawnAfterMs(boss, afterMs) {
    if (!Array.isArray(boss?.요일) || !boss?.시간 || !Number.isFinite(afterMs)) return null;
    const [hour, minute] = String(boss.시간).split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const start = startOfKstDay(afterMs);
    for (let offset = 0; offset <= 14; offset += 1) {
        const dayStart = start + offset * DAY_MS;
        const dayName = dayNames[kstDate(dayStart).getUTCDay()];
        if (!boss.요일.includes(dayName)) continue;
        const candidate = dayStart + hour * 60 * 60 * 1000 + minute * 60 * 1000;
        if (candidate > afterMs) return candidate;
    }
    return null;
}

function bossTypeClass(boss) {
    if (boss?.타입 === '고정') return 'fixedBoss';
    if (boss?.타입 === '이벤트') return 'eventBoss';
    return 'timeBoss';
}

function eventBaseSpawnMs(boss) {
    const date = String(boss?.기준일 || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const [hour, minute] = String(boss?.시간 || '').split(':').map(Number);
    if (!date || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), hour, minute) - KST_OFFSET_MS;
}

function eventIntervalMs(boss) {
    const days = Number(boss?.간격일 || 14);
    return Math.max(1, Number.isFinite(days) ? Math.round(days) : 14) * DAY_MS;
}

function eventSpawnOccurrences(boss, startMs, endMs) {
    const baseMs = eventBaseSpawnMs(boss);
    if (!Number.isFinite(baseMs)) return [];
    const intervalMs = eventIntervalMs(boss);
    let candidate = baseMs;
    if (candidate < startMs) {
        candidate += Math.ceil((startMs - candidate) / intervalMs) * intervalMs;
    }
    const items = [];
    while (candidate <= endMs) {
        items.push(candidate);
        candidate += intervalMs;
    }
    return items;
}

function nextEventSpawnMs(boss, fromMs = getNowMs()) {
    return eventSpawnOccurrences(boss, fromMs + 1, fromMs + 60 * DAY_MS)[0] || null;
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
    if (boss.타입 === '이벤트') return nextEventSpawnMs(boss);
    return null;
}

function fixedSpawnCoveredByLatestCut(latest, spawnMs) {
    if (!latest) return false;

    const nextSpawnMs = new Date(latest.nextSpawnAt || '').getTime();
    if (Number.isFinite(nextSpawnMs) && spawnMs < nextSpawnMs) return true;

    const cutMs = new Date(latest.cutAt || '').getTime();
    return Number.isFinite(cutMs) && spawnMs <= cutMs;
}

function isUncutPendingTimeItem(item, now = getNowMs()) {
    return item?.boss?.타입 === '시간'
        && Number.isFinite(item.spawnMs)
        && item.spawnMs <= now;
}

function isUncutPendingFixedItem(item, now = getNowMs()) {
    if (item?.boss?.타입 !== '고정'
        || item.source !== 'fixed'
        || !Number.isFinite(item.spawnMs)
        || item.spawnMs > now
        || item.spawnMs < now - DAY_MS) {
        return false;
    }

    const nextSpawnMs = nextFixedSpawnAfterMs(item.boss, item.spawnMs);
    return !Number.isFinite(nextSpawnMs) || nextSpawnMs > now;
}

function isUncutPendingBossItem(item, now = getNowMs()) {
    return isUncutPendingTimeItem(item, now) || isUncutPendingFixedItem(item, now);
}

function buildTimeline() {
    const now = getNowMs();
    const start = startOfKstDay(now) - DAY_MS;
    const end = now + DAY_MS;
    const floor = now - SPAWNED_KEEP_MS;
    const items = [];

    for (const boss of bosses) {
        const latest = latestRecordForBoss(boss);
        if (boss.타입 === '고정') {
            const [hour, minute] = String(boss.시간 || '').split(':').map(Number);
            if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;
            const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
            for (let offset = 0; offset <= 3; offset += 1) {
                const dayStart = start + offset * DAY_MS;
                const dayName = dayNames[kstDate(dayStart).getUTCDay()];
                if (!boss.요일?.includes(dayName)) continue;
                const spawnMs = dayStart + hour * 60 * 60 * 1000 + minute * 60 * 1000;
                if (fixedSpawnCoveredByLatestCut(latest, spawnMs)) continue;
                const item = { boss, spawnMs, source: 'fixed' };
                if (spawnMs <= end && (spawnMs >= floor || isUncutPendingBossItem(item, now))) items.push(item);
            }
            continue;
        }

        if (boss.타입 === '이벤트') {
            for (const spawnMs of eventSpawnOccurrences(boss, now, end)) {
                items.push({ boss, spawnMs, source: 'event' });
            }
            continue;
        }

        const manualMs = manualNextSpawnMs(boss, latest);
        const nextSpawnAt = manualMs ? null : latest?.nextSpawnAt || boss.nextSpawnAt;
        const spawnMs = manualMs || new Date(nextSpawnAt || '').getTime();
        const item = { boss, spawnMs, source: manualMs ? 'manual' : latest ? 'cut' : 'planned', record: manualMs ? null : latest };
        const keepUncutPending = isUncutPendingBossItem(item, now);
        if (Number.isFinite(spawnMs) && spawnMs <= end && (spawnMs >= floor || keepUncutPending)) {
            items.push(item);
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

function leadingAlertItem(items, now = getNowMs()) {
    return alertItems(items, now)[0] || null;
}

function focusBossItems(items, now = getNowMs()) {
    return items
        .filter((item) => {
            const diff = item.spawnMs - now;
            return isUncutPendingBossItem(item, now) || (diff <= BOSS_ALERT_MS && diff >= -SPAWNED_KEEP_MS);
        })
        .sort((a, b) => {
            const aSpawned = a.spawnMs <= now ? 0 : 1;
            const bSpawned = b.spawnMs <= now ? 0 : 1;
            return aSpawned - bSpawned || Math.abs(a.spawnMs - now) - Math.abs(b.spawnMs - now) || a.spawnMs - b.spawnMs;
        });
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
    if (!bossAlertBanner) {
        const item = leadingAlertItem(items, now);
        if (!notificationsEnabled()) stopTitleAlert();
        else if (item) startTitleAlert(item);
        else stopTitleAlert();
        document.body.classList.remove('hasBossAlert');
        return;
    }

    if (!notificationsEnabled()) {
        bossAlertBanner?.classList.add('hidden');
        document.body.classList.remove('hasBossAlert');
        stopTitleAlert();
        return;
    }

    const item = leadingAlertItem(items, now);

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
        bossAlertMeta.textContent = `${formatKstDateTime(new Date(item.spawnMs).toISOString(), { date: false })} 젠 예정 · ${displayBossLocation(item.boss.위치)}`;
    }
    startTitleAlert(item);
}

function maybeNotifyTimeline(items) {
    if (!notificationsEnabled() || !('Notification' in window) || Notification.permission !== 'granted') return;
    const now = getNowMs();
    const item = leadingAlertItem(items, now);
    if (!item) return;

    const key = `${item.boss.이름}:${item.spawnMs}`;
    if (notifiedSpawnKeys.has(key)) return;
    notifiedSpawnKeys.add(key);
    const storedKey = `boss:${key}`;
    if (localStorage.getItem(BOSS_NOTIFY_LAST_KEY) === storedKey) return;
    localStorage.setItem(BOSS_NOTIFY_LAST_KEY, storedKey);
    const notification = new Notification(`${item.boss.이름} ${formatRemain(item.spawnMs, now)}`, {
        body: `${formatKstDateTime(new Date(item.spawnMs).toISOString(), { date: false })} 젠 예정 · ${displayBossLocation(item.boss.위치)}`,
        tag: `boss-leading-${key}`,
        requireInteraction: false
    });
    setTimeout(() => notification.close?.(), 7000);
    playBossAlarm();
    navigator.vibrate?.([180, 70, 180]);
}

function updateNotifyButton() {
    if (!enableBossNotifyButton) return;
    if (!('Notification' in window)) {
        setNotifyButton(enableBossNotifyButton, '알림 미지원', 'unsupported', true);
        return;
    }
    if (Notification.permission === 'granted') {
        setNotifyButton(enableBossNotifyButton, notificationsEnabled() ? '알림 끄기' : '알림 켜기', notificationsEnabled() ? 'granted' : 'off');
        return;
    }
    if (Notification.permission === 'denied') {
        setNotifyButton(enableBossNotifyButton, '알림 차단', 'denied', true);
        return;
    }
    setNotifyButton(enableBossNotifyButton, '알림 켜기', 'default');
}

async function requestNotifications() {
    if (!('Notification' in window)) return;
    unlockBossAlarmAudio();
    if (Notification.permission === 'granted') {
        const nextEnabled = !notificationsEnabled();
        setNotificationsEnabled(nextEnabled);
        if (!nextEnabled) {
            stopTitleAlert();
            bossAlertBanner?.classList.add('hidden');
            document.body.classList.remove('hasBossAlert');
        } else {
            playBossAlarm();
        }
        updateNotifyButton();
        showToast(nextEnabled ? '알림 켜짐' : '알림 꺼짐', nextEnabled ? '10분 전 배너, 탭 깜빡임, 브라우저 알림을 같이 사용합니다.' : '브라우저 권한은 유지하고, 앱 알림만 멈췄습니다.');
        return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') setNotificationsEnabled(true);
    updateNotifyButton();
    if (permission === 'granted') playBossAlarm();
    showToast(permission === 'granted' ? '알림 켜짐' : '알림 미설정', permission === 'granted' ? '10분 전 배너, 탭 깜빡임, 브라우저 알림을 같이 사용합니다.' : '브라우저 알림은 꺼진 상태입니다.', permission === 'granted' ? 'success' : 'error');
}

function renderOverview(timeline) {
    if (!todayBossCount || !soonBossCount || !spawnedBossCount || !participationBossCount) return;
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
    if (liveParticipationSummary) liveParticipationSummary.textContent = `열린 기록 ${records.length}건`;
    liveParticipationList.replaceChildren();

    if (records.length === 0) {
        if (panel) panel.hidden = true;
        return;
    }

    if (panel) panel.hidden = false;

    for (const record of records.slice(0, 8)) {
        const item = liveParticipationTemplate.content.firstElementChild.cloneNode(true);
        const names = participantNames(record);
        const joinedByMe = hasParticipant(record);
        const pendingByMe = hasPendingParticipantProof(record);
        item.querySelector('.liveTitle').textContent = `${record.bossName} · ${displayTimeValue(record.timeValue)}`;
        item.querySelector('.liveMeta').textContent = `${formatDuration(participationOpenMs(record) - now)} 남음 · 참여 ${names.length}명`;
        item.querySelector('.liveDetailButton').addEventListener('click', () => openParticipantModal(record, 'participants'));
        const joinButton = item.querySelector('.liveJoinButton');
        joinButton.textContent = joinedByMe ? '참여함' : pendingByMe ? '인증대기' : '참여입력';
        joinButton.disabled = joinedByMe || pendingByMe;
        joinButton.classList.toggle('isJoined', joinedByMe);
        joinButton.classList.toggle('isPending', pendingByMe);
        joinButton.addEventListener('click', () => {
            if (!joinedByMe && !pendingByMe) openJoinModal(record);
        });
        liveParticipationList.append(item);
    }
}

async function createTestParticipationRecord() {
    const reporterName = requireMember();
    if (!reporterName) return;

    const participantPassword = testParticipationPasswordInput.value.trim();
    if (!participantPassword) {
        showToast('테스트 비번 필요', '참여 입력에서 확인할 비밀번호를 먼저 넣어주세요.', 'error');
        testParticipationPasswordInput.focus();
        return;
    }

    createTestParticipationButton.disabled = true;
    try {
        const data = await api('/api/boss-cuts/test-participation', {
            method: 'POST',
            body: JSON.stringify({
                reporterName,
                participantPassword
            })
        });
        state.bossCuts = data.cuts || {};
        state.bossCutRecords = data.records || [];
        state.bossParticipationWindowMin = data.bossParticipationWindowMin || state.bossParticipationWindowMin;
        testParticipationPasswordInput.value = '';
        render();
        if (data.record) openJoinModal(data.record);
        showToast('테스트 열림', `${participationWindowLabel()} 동안 참여 비번 입력을 확인할 수 있습니다.`);
    } catch (err) {
        showToast('테스트 생성 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    } finally {
        createTestParticipationButton.disabled = false;
    }
}

async function quickCutBoss(boss, options = {}) {
    const memberName = requireMember();
    if (!memberName || !boss || quickCutSubmittingBosses.has(boss.이름)) return;
    const lock = bossLock(boss.이름);
    if (lock && lock.memberName !== memberName) {
        showToast('컷 입력 중', `${lock.memberName} 님이 먼저 열었습니다.`, 'error');
        return;
    }

    const now = getNowMs();
    const baseMs = Number.isFinite(options.baseMs) ? options.baseMs : now;
    const cutMs = baseMs + (Number(options.offsetMinutes || 0) * 60000);
    const timeValue = timeInputValueFromMs(cutMs);
    const timeUncertain = Boolean(options.timeUncertain);
    quickCutSubmittingBosses.add(boss.이름);
    renderQuickBosses(buildTimeline(), now);

    try {
        const data = await api('/api/boss-cuts', {
            method: 'POST',
            body: JSON.stringify({
                bossName: boss.이름,
                timeValue,
                cutAt: new Date(cutMs).toISOString(),
                reporterName: memberName,
                timeUncertain,
                requiresParticipation: false,
                participantPassword: ''
            })
        });
        state.bossCuts = data.cuts || {};
        state.bossCutRecords = data.records || [];
        if (state.bossCutLocks) delete state.bossCutLocks[boss.이름];
        render();
        showToast(timeUncertain ? '멍 처리 완료' : '바로컷 완료', `.컷 ${boss.이름} ${timeValue}${timeUncertain ? ' · 불확실' : ''}`);
    } catch (err) {
        showToast(timeUncertain ? '멍 처리 실패' : '바로컷 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    } finally {
        quickCutSubmittingBosses.delete(boss.이름);
        render();
    }
}

function renderQuickBosses(timeline, now = getNowMs()) {
    if (!bossQuickPanel || !bossQuickList) return;

    const items = timeline
        .filter((item) => item.spawnMs <= now && item.boss.타입 !== '이벤트')
        .sort((a, b) => a.spawnMs - b.spawnMs || a.boss.이름.localeCompare(b.boss.이름, 'ko'));
    bossQuickList.replaceChildren();

    if (items.length === 0) {
        bossQuickPanel?.classList.add('hidden');
        if (bossQuickSummary) bossQuickSummary.textContent = '컷 대기 없음';
        return;
    }

    bossQuickPanel?.classList.remove('hidden');
    const spawnedCount = items.filter((item) => item.spawnMs <= now).length;
    const firstUpcoming = items.find((item) => item.spawnMs > now);
    if (bossQuickSummary) {
        bossQuickSummary.textContent = spawnedCount > 0
            ? `지금 컷 가능 ${spawnedCount}개`
            : `${firstUpcoming.boss.이름} ${formatRemainWithSuffix(firstUpcoming.spawnMs, now)}`;
    }

    for (const item of items) {
        const card = document.createElement('article');
        const lock = bossLock(item.boss.이름);
        const lockedByOther = lock && lock.memberName !== selectedMember;
        const isSubmitting = quickCutSubmittingBosses.has(item.boss.이름);
        card.className = `bossQuickItem spawned ${bossTypeClass(item.boss)}`;
        card.classList.toggle('locked', Boolean(lockedByOther));

        const time = document.createElement('time');
        time.textContent = formatKstDateTime(new Date(item.spawnMs).toISOString(), { date: false });
        const main = document.createElement('span');
        main.className = 'bossQuickMain';
        const name = document.createElement('strong');
        name.textContent = item.boss.이름;
        const location = document.createElement('span');
        location.textContent = lockedByOther ? `${lock.memberName} 입력중` : displayBossLocation(item.boss.위치);
        main.append(name, location);
        const quickButton = document.createElement('button');
        quickButton.type = 'button';
        quickButton.className = 'bossQuickCutLabel';
        quickButton.disabled = Boolean(lockedByOther || isSubmitting);
        quickButton.textContent = lockedByOther ? '입력중' : isSubmitting ? '처리중' : '바로컷';
        const missButton = document.createElement('button');
        missButton.type = 'button';
        missButton.className = 'bossQuickCutLabel bossQuickMissLabel';
        missButton.disabled = Boolean(lockedByOther || isSubmitting);
        missButton.textContent = lockedByOther ? '-' : isSubmitting ? '...' : '멍';
        missButton.title = '젠 시간 +1분으로 불확실 컷';
        const actions = document.createElement('span');
        actions.className = 'bossQuickActions';
        actions.append(missButton, quickButton);

        card.append(time, main, actions);
        card.addEventListener('click', () => {
            if (lockedByOther) showToast('컷 입력 중', `${lock.memberName} 님이 먼저 열었습니다.`, 'error');
            else openCutModal(item.boss, getNowMs());
        });
        missButton.addEventListener('click', (event) => {
            event.stopPropagation();
            if (lockedByOther) {
                showToast('컷 입력 중', `${lock.memberName} 님이 먼저 열었습니다.`, 'error');
                return;
            }
            quickCutBoss(item.boss, { baseMs: item.spawnMs, offsetMinutes: 1, timeUncertain: true });
        });
        quickButton.addEventListener('click', (event) => {
            event.stopPropagation();
            if (lockedByOther) {
                showToast('컷 입력 중', `${lock.memberName} 님이 먼저 열었습니다.`, 'error');
                return;
            }
            quickCutBoss(item.boss);
        });
        bossQuickList.append(card);
    }
}

function renderTimeline() {
    const timeline = buildTimeline();
    const now = getNowMs();
    const leadingAlert = leadingAlertItem(timeline, now);
    const activeAlertKeys = new Set(leadingAlert ? [`${leadingAlert.boss.이름}:${leadingAlert.spawnMs}`] : []);
    renderOverview(timeline);
    updateBossAlertBanner(timeline, now);
    renderQuickBosses(timeline, now);
    maybeNotifyTimeline(timeline);
    const scheduleItems = timeline.filter((item) => item.spawnMs > now);
    bossTimeline.replaceChildren();

    if (timelineSummary) {
        timelineSummary.textContent = scheduleItems.length > 0
            ? `${scheduleItems[0].boss.이름} ${formatRemainWithSuffix(scheduleItems[0].spawnMs, now)}`
            : '예정 없음';
    }

    if (scheduleItems.length === 0) {
        bossTimeline.innerHTML = '<div class="empty small">24시간 안에 표시할 보스 일정이 없습니다.</div>';
        return;
    }

    let previousDateKey = '';
    let firstDateGroup = true;
    let previousSpawnMs = null;
    for (let index = 0; index < scheduleItems.length; index += 1) {
        const item = scheduleItems[index];
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
        const previousItem = scheduleItems[index - 1];
        const nextItem = scheduleItems[index + 1];
        const sameAsPrevious = previousItem && previousItem.spawnMs === item.spawnMs;
        const sameAsNext = nextItem && nextItem.spawnMs === item.spawnMs;
        const sameTimeGroup = sameAsPrevious || sameAsNext;
        const newTimeSlot = previousSpawnMs !== null && item.spawnMs !== previousSpawnMs;
        row.classList.add(stateName, bossTypeClass(item.boss));
        row.classList.toggle('newTimeSlot', newTimeSlot);
        row.classList.toggle('sameTimeGroup', sameTimeGroup);
        row.classList.toggle('sameTimeStart', sameTimeGroup && !sameAsPrevious);
        row.classList.toggle('sameTimeMiddle', sameTimeGroup && sameAsPrevious && sameAsNext);
        row.classList.toggle('sameTimeEnd', sameTimeGroup && !sameAsNext);
        if (previousSpawnMs && item.spawnMs - previousSpawnMs > 60 * 60 * 1000) {
            row.classList.add('hasTimeGap');
        }
        row.classList.toggle('alertTarget', activeAlertKeys.has(`${item.boss.이름}:${item.spawnMs}`));
        const timeEl = row.querySelector('.timelineTime');
        timeEl.textContent = formatKstDateTime(new Date(item.spawnMs).toISOString(), { date: false });
        row.querySelector('.timelineBossName').textContent = item.boss.이름;
        const timelineMeta = row.querySelector('.timelineMeta');
        timelineMeta.textContent = `${displayBossLocation(item.boss.위치)}${latest?.requiresParticipation ? ' · 참여 확인' : ''}`;
        const uncertain = item.boss.타입 === '시간' && latest?.timeUncertain;
        const remainEl = row.querySelector('.timelineRemain');
        const remainText = document.createElement('span');
        remainText.textContent = formatRemainWithSuffix(item.spawnMs, now);
        remainEl.replaceChildren();
        if (uncertain) {
            const uncertainLabel = document.createElement('span');
            uncertainLabel.className = 'timelineUncertain';
            uncertainLabel.textContent = '* 불확실';
            remainEl.append(uncertainLabel);
        }
        remainEl.append(remainText);
        row.classList.toggle('isUncertain', Boolean(uncertain));
        const lock = bossLock(item.boss.이름);
        if (lock && lock.memberName !== selectedMember) {
            row.classList.add('locked');
            timelineMeta.textContent += ` · ${lock.memberName}`;
        }
        if (item.boss.타입 === '이벤트') {
            timelineMeta.textContent = `${displayBossLocation(item.boss.위치)} · ${item.boss.반복 || '격주'} 일정`;
            row.classList.add('notCuttable');
        }
        row.addEventListener('click', (event) => {
            if (isBossCardControl(event.target)) return;
            if (item.boss.타입 === '이벤트') {
                showToast('일정 이벤트', '컷 처리 없이 일정표에만 표시됩니다.');
                return;
            }
            if (lock && lock.memberName !== selectedMember) showToast('컷 입력 중', `${lock.memberName} 님이 먼저 열었습니다.`, 'error');
            else openCutModal(item.boss, getNowMs());
        });
        bossTimeline.append(row);
        previousSpawnMs = item.spawnMs;
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
        card.classList.add(spawnState, bossTypeClass(boss));

        card.querySelector('.bossName').textContent = boss.이름;
        card.querySelector('.bossLocation').textContent = displayBossLocation(boss.위치);
        const typeBadge = card.querySelector('.bossTypeBadge');
        typeBadge.textContent = boss.타입 === '이벤트' ? '이벤트' : boss.타입 === '고정' ? '고정' : '';
        typeBadge.hidden = boss.타입 === '시간';
        card.querySelector('.bossCutText').textContent = nextMs
            ? `${formatSpawnTimeForList(nextMs, now)} · ${formatRemain(nextMs, now)}`
            : boss.타입 === '시간' ? '컷 대기' : '일정 없음';
        const metaText = bossRuleText(boss);
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
        if (boss.타입 === '이벤트') {
            cutButton.disabled = true;
            cutButton.textContent = '일정';
        }
        if (lock && lock.memberName !== selectedMember) {
            cutButton.disabled = true;
            cutButton.textContent = '입력중';
            reporterEl.textContent = `${lock.memberName} 컷 입력 중`;
            reporterEl.hidden = false;
        }
        cutButton.addEventListener('click', () => {
            if (boss.타입 === '이벤트') return;
            openCutModal(boss, getNowMs());
        });

        const joinButton = card.querySelector('.bossJoinButton');
        const joinedByMe = hasParticipant(record);
        const pendingByMe = hasPendingParticipantProof(record);
        joinButton.disabled = boss.타입 === '이벤트' || !participationOpen || joinedByMe || pendingByMe;
        joinButton.textContent = joinedByMe ? '참여함' : pendingByMe ? '인증대기' : participationOpen ? '참여' : record?.requiresParticipation ? '마감' : '-';
        joinButton.classList.toggle('isJoined', joinedByMe);
        joinButton.classList.toggle('isPending', pendingByMe);
        joinButton.addEventListener('click', () => {
            if (!joinedByMe && !pendingByMe) openJoinModal(record);
        });

        card.addEventListener('click', (event) => {
            if (isBossCardControl(event.target)) return;
            if (boss.타입 === '이벤트') return;
            if (record?.id) openParticipantModal(record);
            else openCutModal(boss, getNowMs());
        });

        bossList.append(card);
    }
}

function renderRecords() {
    const records = (state.bossCutRecords || [])
        .slice()
        .sort(compareBossCutRecordsForDisplay)
        .slice(0, 20);
    recordSummary.textContent = `${records.length}건`;
    bossRecordList.replaceChildren();

    if (records.length === 0) {
        bossRecordList.innerHTML = '<div class="empty small">아직 보스 컷 기록이 없습니다.</div>';
        return;
    }

    for (const record of records) {
        const item = recordItemTemplate.content.firstElementChild.cloneNode(true);
        const canceled = record.status === 'canceled';
        const participationOpen = isParticipationOpen(record);
        const joinedByMe = hasParticipant(record);
        const pendingByMe = hasPendingParticipantProof(record);
        item.classList.add('compactRecord');
        item.classList.toggle('canceled', canceled);
        const title = item.querySelector('.recordTitle');
        const titleText = document.createElement('span');
        titleText.className = 'recordTitleText';
        titleText.textContent = canceled
            ? `${record.bossName} · ${bossCutClock(record)} · 취소됨`
            : `${record.bossName} · ${bossCutClock(record)}`;
        title.replaceChildren(titleText);
        if (joinedByMe && !canceled) {
            const joinedMark = document.createElement('span');
            joinedMark.className = 'recordJoinedCheck';
            joinedMark.textContent = '✓';
            joinedMark.title = '참여함';
            joinedMark.setAttribute('aria-label', '참여함');
            title.append(joinedMark);
        }
        const reporterText = canceled
            ? record.canceledBy ? `취소 ${record.canceledBy}` : record.reporterName ? `기록 ${record.reporterName}` : ''
            : record.reporterName ? `기록 ${record.reporterName}` : '';
        const recordMeta = item.querySelector('.recordMeta');
        recordMeta.textContent = reporterText;
        recordMeta.hidden = !reporterText;
        item.querySelector('.recordParticipants').hidden = true;
        item.querySelector('.recordDetailButton').addEventListener('click', () => openParticipantModal(record));
        const button = item.querySelector('.recordJoinButton');
        button.hidden = canceled || joinedByMe || !record.requiresParticipation || !participationOpen;
        button.disabled = !participationOpen || pendingByMe;
        button.textContent = pendingByMe ? '인증대기' : participationOpen ? '참여입력' : '마감';
        button.classList.toggle('isPending', pendingByMe);
        item.classList.toggle('hasRecordJoinButton', !button.hidden);
        button.addEventListener('click', () => {
            if (participationOpen && !pendingByMe) openJoinModal(record);
        });
        item.addEventListener('click', (event) => {
            if (isBossCardControl(event.target)) return;
            openParticipantModal(record);
        });
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
    cutModalDesc.textContent = `${boss.애칭 || '-'} · ${displayBossLocation(boss.위치)} · ${boss.타입} · 한국시간 기준으로 기록됩니다.`;
    cutDateInput.value = dateInputValueFromMs(cutMs);
    cutTimeInput.value = timeInputValueFromMs(cutMs);
    cutSecondInput.value = secondInputValueFromMs(cutMs);
    cutUncertainInput.checked = false;
    cutUncertainInput.closest('label')?.classList.toggle('hiddenField', boss.타입 !== '시간');
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
    if (hasPendingParticipantProof(record)) {
        showToast('사진 인증 대기 중', '관리자가 확인하면 참여자로 올라갑니다.');
        return;
    }
    if (!isParticipationOpen(record)) {
        showToast('참여 입력 마감', '관리자 수동 추가만 가능합니다.', 'error');
        return;
    }
    selectedJoinRecord = record;
    joinModalTitle.textContent = `${record.bossName} 참여 확인`;
    const remain = formatDuration(participationOpenMs(record) - getNowMs());
    joinModalDesc.textContent = record.hasParticipantPassword
        ? `${displayTimeValue(record.timeValue)} 컷 기록에 ${selectedMember} 님으로 참여 확인합니다. 입력 가능 ${remain}`
        : '이 기록은 참여 비번이 없어 관리자 수동 추가만 가능합니다.';
    joinPasswordInput.value = '';
    joinPasswordInput.disabled = false;
    joinForm.querySelector('.bossModalPrimary').disabled = false;
    if (joinPhotoInput) joinPhotoInput.value = '';
    if (joinPhotoButton) joinPhotoButton.disabled = false;
    if (joinPhotoStatus) joinPhotoStatus.textContent = '비번이 없으면 사진 인증으로 관리자 확인을 요청할 수 있습니다.';
    joinModal.classList.remove('hidden');
    setTimeout(() => joinPasswordInput.focus(), 30);
}

function closeJoinModal() {
    selectedJoinRecord = null;
    joinModal.classList.add('hidden');
}

function setParticipantModalMode(mode) {
    selectedParticipantModalMode = mode === 'edit' ? 'edit' : 'participants';
    const isEdit = selectedParticipantModalMode === 'edit';
    participantViewButton?.classList.toggle('active', !isEdit);
    participantEditButton?.classList.toggle('active', isEdit);
    participantViewButton?.setAttribute('aria-selected', String(!isEdit));
    participantEditButton?.setAttribute('aria-selected', String(isEdit));
    participantConfirmPanel?.classList.toggle('hiddenField', isEdit);
    participantEditPanel?.classList.toggle('hiddenField', !isEdit);
}

function openParticipantModal(record, mode = 'edit') {
    selectedParticipantRecord = record;
    const names = participantNames(record);
    const cutMs = new Date(record.cutAt).getTime();
    const canceled = record.status === 'canceled';
    const reason = cancelReasonText(record);
    participantModalTitle.textContent = canceled ? `${record.bossName} 취소 기록` : `${record.bossName} 컷 상세`;
    participantModalDesc.textContent = canceled
        ? `${formatKstDateTimeWithSeconds(record.cutAt)} 컷 · ${record.canceledBy || '-'} 취소${reason ? ` · ${reason}` : ''} · 참여 ${names.length}명`
        : `${formatKstDateTimeWithSeconds(record.cutAt)} 컷 · 입력 ${record.reporterName || '-'} · 참여 ${names.length}명`;
    participantCutDateInput.value = Number.isFinite(cutMs) ? dateInputValueFromMs(cutMs) : dateInputValueFromMs(getNowMs());
    participantCutTimeInput.value = Number.isFinite(cutMs) ? timeInputValueFromMs(cutMs) : displayTimeValue(record.timeValue).replace(':', '');
    participantCutSecondInput.value = Number.isFinite(cutMs) ? secondInputValueFromMs(cutMs) : '00';
    participantCutDateInput.disabled = canceled;
    participantCutTimeInput.disabled = canceled;
    participantCutSecondInput.disabled = canceled;
    const canMarkUncertain = isTimeBossRecord(record);
    participantUncertainInput.checked = Boolean(record.timeUncertain);
    participantUncertainInput.disabled = canceled || !canMarkUncertain;
    participantUncertainInput.closest('label')?.classList.toggle('hiddenField', !canMarkUncertain);
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
            row.append(name);
            participantList.append(row);
        }
    }
    renderParticipantProofs(record, canceled);

    setParticipantModalMode(mode);
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

function proofStatusLabel(status) {
    if (status === 'approved') return '승인됨';
    if (status === 'rejected') return '거절됨';
    if (status === 'expired') return '만료됨';
    return '확인 대기';
}

function renderParticipantProofs(record, canceled = false) {
    if (!participantProofList) return;
    const proofs = activeParticipantProofs(record);
    participantProofList.replaceChildren();
    participantProofList.classList.toggle('hiddenField', proofs.length === 0);
    if (proofs.length === 0) return;

    const header = document.createElement('div');
    header.className = 'bossRecordManageHead';
    const title = document.createElement('strong');
    title.textContent = '사진 인증 요청';
    const desc = document.createElement('span');
    const pendingCount = proofs.filter((proof) => proof.status === 'pending').length;
    desc.textContent = pendingCount ? `확인 대기 ${pendingCount}건 · 승인하면 참여자로 등록됩니다.` : '처리된 사진 인증입니다.';
    header.append(title, desc);
    participantProofList.append(header);

    for (const proof of proofs) {
        const card = document.createElement('article');
        card.className = `photoProofCard ${proof.status || 'pending'}`;

        const imageWrap = document.createElement('a');
        imageWrap.className = 'photoProofThumb';
        imageWrap.href = proof.photoUrl || '#';
        imageWrap.target = '_blank';
        imageWrap.rel = 'noopener noreferrer';
        imageWrap.addEventListener('click', (event) => {
            if (!proof.photoUrl) event.preventDefault();
        });
        if (proof.photoUrl) {
            const img = document.createElement('img');
            img.src = proof.photoUrl;
            img.alt = `${proof.memberName} 사진 인증`;
            imageWrap.append(img);
        } else {
            imageWrap.textContent = '만료';
        }

        const body = document.createElement('div');
        body.className = 'photoProofBody';
        const name = document.createElement('strong');
        name.textContent = proof.memberName;
        const meta = document.createElement('span');
        meta.textContent = `${proofStatusLabel(proof.status)} · ${formatKstDateTime(proof.uploadedAt)}`;
        body.append(name, meta);

        const actions = document.createElement('div');
        actions.className = 'photoProofActions';
        if (proof.status === 'pending' && !canceled) {
            const approveButton = document.createElement('button');
            approveButton.type = 'button';
            approveButton.className = 'photoProofApprove';
            approveButton.textContent = '승인';
            approveButton.addEventListener('click', () => resolvePhotoProof(proof, 'approve'));
            const rejectButton = document.createElement('button');
            rejectButton.type = 'button';
            rejectButton.className = 'photoProofReject';
            rejectButton.textContent = '거절';
            rejectButton.addEventListener('click', () => resolvePhotoProof(proof, 'reject'));
            actions.append(approveButton, rejectButton);
        } else {
            const status = document.createElement('span');
            status.textContent = proofStatusLabel(proof.status);
            actions.append(status);
        }

        card.append(imageWrap, body, actions);
        participantProofList.append(card);
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
    selectedParticipantModalMode = 'participants';
    participantModal.classList.add('hidden');
}

function isModalVisible(modal) {
    return modal && !modal.classList.contains('hidden');
}

function closeTopBossModalByEscape(event) {
    if (event.key !== 'Escape') return;

    if (isModalVisible(cutModal)) {
        closeCutModal();
    } else if (isModalVisible(joinModal)) {
        closeJoinModal();
    } else if (isModalVisible(participantModal)) {
        closeParticipantModal();
    } else if (isModalVisible(profileModal)) {
        closeProfileModal();
    } else {
        return;
    }
    event.preventDefault();
}

async function submitCut(event) {
    event.preventDefault();
    const memberName = requireMember();
    if (!memberName || !selectedCutBoss) return;

    const bossName = selectedCutBoss.이름;
    const normalized = normalizeTimeInput(cutTimeInput.value);
    const normalizedSecond = normalizeSecondInput(cutSecondInput.value).padStart(2, '0');
    if (!cutDateInput.value || !isValidCommandTime(normalized) || !isValidSecond(normalizedSecond)) {
        showToast('컷 시간 확인', '날짜와 시간을 다시 확인하세요.', 'error');
        return;
    }

    const timeValue = normalized;
    const cutAt = isoFromDateTimeInputs(cutDateInput.value, timeValue, normalizedSecond);
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
                timeUncertain: selectedCutBoss.타입 === '시간' && cutUncertainInput.checked,
                requiresParticipation: requiresParticipationInput.checked,
                participantPassword: participantPasswordInput.value
            })
        });
        state.bossCuts = data.cuts || {};
        state.bossCutRecords = data.records || [];
        state.bossParticipationWindowMin = data.bossParticipationWindowMin || state.bossParticipationWindowMin;
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

function adminPasswordForParticipantAction() {
    const current = participantAddAdminPasswordInput?.value.trim()
        || participantAdminPasswordInput?.value.trim()
        || cachedAdminPassword;
    if (current) {
        cacheAdminPassword(current);
        fillAdminPasswordInputs();
        return current;
    }

    const input = prompt('관리자 비밀번호를 입력하세요.', cachedAdminPassword);
    if (!input) return '';
    cacheAdminPassword(input.trim());
    fillAdminPasswordInputs();
    return input.trim();
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('사진 파일을 읽지 못했습니다.'));
        reader.readAsDataURL(file);
    });
}

function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('사진 파일을 열지 못했습니다. JPG나 PNG로 다시 올려주세요.'));
        image.src = dataUrl;
    });
}

async function compressPhotoForProof(file) {
    if (!file || !file.type?.startsWith('image/')) throw new Error('사진 파일을 선택하세요.');
    if (file.size > 12 * 1024 * 1024) throw new Error('사진 용량이 너무 큽니다. 12MB 이하로 선택하세요.');

    const originalDataUrl = await readFileAsDataUrl(file);
    const image = await loadImageFromDataUrl(originalDataUrl);
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.72);
}

async function submitJoinPhoto(file) {
    const memberName = requireMember();
    if (!memberName || !selectedJoinRecord || !file) return;

    const record = selectedJoinRecord;
    joinPhotoButton.disabled = true;
    if (joinPhotoStatus) joinPhotoStatus.textContent = '사진을 압축해서 올리는 중입니다...';

    try {
        const imageData = await compressPhotoForProof(file);
        const data = await api('/api/boss-cuts/participants/photo', {
            method: 'POST',
            body: JSON.stringify({
                recordId: record.id,
                memberName,
                fileName: file.name,
                imageData
            })
        });
        state.bossCuts = data.cuts || {};
        state.bossCutRecords = data.records || [];
        closeJoinModal();
        render();
        showToast('사진 인증 대기', '관리자가 확인하면 참여자로 등록됩니다.');
    } catch (err) {
        showToast('사진 인증 실패', err.message, 'error');
        if (joinPhotoStatus) joinPhotoStatus.textContent = '사진 인증에 실패했습니다. 다시 시도하거나 비번으로 입력하세요.';
        fetchState(true).catch(() => {});
    } finally {
        if (joinPhotoButton) joinPhotoButton.disabled = false;
        if (joinPhotoInput) joinPhotoInput.value = '';
    }
}

async function resolvePhotoProof(proof, decision) {
    const actorName = requireMember();
    if (!actorName || !selectedParticipantRecord || !proof) return;

    const adminPassword = adminPasswordForParticipantAction();
    if (!adminPassword) return;

    try {
        const data = await api('/api/boss-cuts/participants/photo/resolve', {
            method: 'POST',
            body: JSON.stringify({
                recordId: selectedParticipantRecord.id,
                proofId: proof.id,
                actorName,
                decision,
                adminPassword
            })
        });
        state.bossCuts = data.cuts || {};
        state.bossCutRecords = data.records || [];
        const updated = state.bossCutRecords.find((item) => item.id === selectedParticipantRecord.id);
        render();
        if (updated) openParticipantModal(updated, 'participants');
        showToast(decision === 'approve' ? '사진 인증 승인' : '사진 인증 거절', proof.memberName);
    } catch (err) {
        showToast('사진 인증 처리 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    }
}

async function updateParticipantRecordTime() {
    const memberName = requireMember();
    if (!memberName || !selectedParticipantRecord) return;

    const normalized = normalizeTimeInput(participantCutTimeInput.value);
    const normalizedSecond = normalizeSecondInput(participantCutSecondInput.value).padStart(2, '0');
    if (!participantCutDateInput.value || !isValidCommandTime(normalized) || !isValidSecond(normalizedSecond)) {
        showToast('컷 시간 확인', '날짜와 시간을 다시 확인하세요.', 'error');
        return;
    }

    const cutAt = isoFromDateTimeInputs(participantCutDateInput.value, normalized, normalizedSecond);
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
                timeUncertain: isTimeBossRecord(selectedParticipantRecord) && participantUncertainInput.checked,
                adminPassword: participantAdminPasswordInput.value
            })
        });
        state.bossCuts = data.cuts || {};
        state.bossCutRecords = data.records || [];
        const updated = state.bossCutRecords.find((record) => record.id === recordId);
        render();
        if (updated) openParticipantModal(updated, 'edit');
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
        if (canceled) openParticipantModal(canceled, 'edit');
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
        if (updated) {
            openParticipantModal(updated, 'participants');
            setTimeout(() => participantAddMemberInput.focus(), 30);
        }
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
        bossCutLocks: data.bossCutLocks || {},
        bossParticipationWindowMin: data.bossParticipationWindowMin || 60
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
            resetTimeBossButton.textContent = '시간 초기화';
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
createTestParticipationButton?.addEventListener('click', createTestParticipationRecord);
testParticipationPasswordInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    createTestParticipationRecord();
});
openProfileButton.addEventListener('click', openProfileModal);
closeProfileButton.addEventListener('click', closeProfileModal);
skipProfileButton.addEventListener('click', closeProfileModal);
memberSearchInput.addEventListener('input', renderMemberSuggest);
profileForm.addEventListener('submit', (event) => event.preventDefault());
cutForm.addEventListener('submit', submitCut);
closeCutModalButton.addEventListener('click', closeCutModal);
attachMinuteStepper(cutTimeInput, cutDateInput, cutSecondInput);
requiresParticipationInput.addEventListener('change', () => {
    participantPasswordField.classList.toggle('hiddenField', !requiresParticipationInput.checked);
    if (!requiresParticipationInput.checked) participantPasswordInput.value = '';
});
joinForm.addEventListener('submit', submitJoin);
closeJoinModalButton.addEventListener('click', closeJoinModal);
joinPhotoButton?.addEventListener('click', () => joinPhotoInput?.click());
joinPhotoInput?.addEventListener('change', () => {
    const file = joinPhotoInput.files?.[0];
    if (file) submitJoinPhoto(file);
});
closeParticipantModalButton.addEventListener('click', closeParticipantModal);
participantViewButton?.addEventListener('click', () => setParticipantModalMode('participants'));
participantEditButton?.addEventListener('click', () => setParticipantModalMode('edit'));
document.addEventListener('keydown', closeTopBossModalByEscape);
attachMinuteStepper(participantCutTimeInput, participantCutDateInput, participantCutSecondInput);
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
