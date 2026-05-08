const zoneList = document.querySelector('#zoneList');
const selectedMemberLabel = document.querySelector('#selectedMemberLabel');
const openProfileButton = document.querySelector('#openProfileButton');
const closeProfileButton = document.querySelector('#closeProfileButton');
const skipProfileButton = document.querySelector('#skipProfileButton');
const profileModal = document.querySelector('#profileModal');
const profileForm = document.querySelector('#profileForm');
const memberSearchInput = document.querySelector('#memberSearchInput');
const memberSuggest = document.querySelector('#memberSuggest');
const zoneCardTemplate = document.querySelector('#zoneCardTemplate');
const enableNotifyButton = document.querySelector('#enableNotifyButton');
const zoneActionModal = document.querySelector('#zoneActionModal');
const closeZoneActionButton = document.querySelector('#closeZoneActionButton');
const zoneActionTitle = document.querySelector('#zoneActionTitle');
const zoneActionDesc = document.querySelector('#zoneActionDesc');
const resetZoneStateButton = document.querySelector('#resetZoneStateButton');
const cancelLastCheckButton = document.querySelector('#cancelLastCheckButton');
const toastHost = document.querySelector('#toastHost');

const MEMBER_KEY = 'slashCheckMemberName';
const CHECK_UNDO_GRACE_MS = 60 * 1000;
let state = { now: new Date().toISOString(), members: [], zones: [], rankings: [], logs: [] };
let selectedMember = localStorage.getItem(MEMBER_KEY) || '';
let lastSyncAt = Date.now();
let selectedActionZone = null;
const notifiedReadyReservations = new Set();

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatTime(iso) {
    if (!iso) return '-';
    const date = new Date(iso);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatRemain(ms) {
    if (ms <= 0) return '가능';
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min >= 60) {
        const hour = Math.floor(min / 60);
        const rest = min % 60;
        return `${hour}시간 ${rest}분`;
    }
    return `${min}:${pad2(sec)}`;
}

function formatCountdown(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const hour = Math.floor(totalSec / 3600);
    const min = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;

    if (hour > 0) return `${hour}:${pad2(min)}:${pad2(sec)}`;
    return `${pad2(min)}:${pad2(sec)}`;
}

function cleanName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function getNowMs() {
    return new Date(state.now).getTime() + (Date.now() - lastSyncAt);
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
    }, 5200);
}

function updateNotifyButton() {
    if (!enableNotifyButton) return;

    if (!('Notification' in window)) {
        enableNotifyButton.textContent = '알림 미지원';
        enableNotifyButton.disabled = true;
        return;
    }

    if (Notification.permission === 'granted') {
        enableNotifyButton.textContent = '알림 켜짐';
        enableNotifyButton.disabled = true;
        return;
    }

    if (Notification.permission === 'denied') {
        enableNotifyButton.textContent = '알림 차단됨';
        enableNotifyButton.disabled = true;
        return;
    }

    enableNotifyButton.textContent = '알림 켜기';
    enableNotifyButton.disabled = false;
}

async function requestNotifications({ quiet = false } = {}) {
    if (!('Notification' in window)) {
        if (!quiet) showToast('브라우저 알림 미지원', '이 브라우저에서는 화면 안 알림만 표시됩니다.');
        updateNotifyButton();
        return false;
    }

    if (Notification.permission === 'granted') return true;

    if (Notification.permission === 'denied') {
        if (!quiet) showToast('알림이 차단됨', '브라우저 설정에서 알림을 허용해야 합니다.');
        updateNotifyButton();
        return false;
    }

    const permission = await Notification.requestPermission();
    updateNotifyButton();

    if (permission === 'granted') {
        if (!quiet) showToast('알림이 켜졌습니다', '예약한 구역이 가능해지면 알려드릴게요.');
        return true;
    }

    if (!quiet) showToast('알림을 켜지 못했습니다', '화면 안 알림은 계속 표시됩니다.');
    return false;
}

function notifyReservationReady(zone) {
    showToast(`${zone.name} 진행 가능`, '예약한 구역의 쿨타임이 끝났습니다.');

    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('썰자 진행 가능', {
            body: `${zone.name} 완료가 가능합니다.`,
            tag: `slash-ready-${zone.id}`
        });
    }
}

function shouldAlertReservationReady(zone, reservation, locked) {
    if (!reservation || reservation.memberName !== selectedMember || locked) return false;

    const key = `${zone.id}:${reservation.reservedAt || ''}:${reservation.expiresAt || ''}`;
    if (notifiedReadyReservations.has(key)) return false;

    const cooldownAtReservation = zone.cooldownUntil && reservation.reservedAt
        ? new Date(zone.cooldownUntil).getTime() > new Date(reservation.reservedAt).getTime()
        : false;
    const wasReservedDuringCooldown = reservation.reservedWhileCooldown || cooldownAtReservation;

    if (!wasReservedDuringCooldown) return false;

    notifiedReadyReservations.add(key);
    return true;
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
        return;
    }

    showToast(previousMember === member ? '닉네임 확인됨' : '닉네임 설정됨', `현재 닉네임: ${member}`);
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

function openZoneActionModal(zone) {
    const memberName = requireMember();
    if (!memberName) return;

    selectedActionZone = zone;
    zoneActionTitle.textContent = zone.name;
    zoneActionDesc.textContent = `${memberName} 이름으로 처리됩니다.`;
    zoneActionModal.classList.remove('hidden');
}

function closeZoneActionModal() {
    selectedActionZone = null;
    zoneActionModal.classList.add('hidden');
}

function requireMember() {
    if (state.members.includes(selectedMember)) return selectedMember;
    openProfileModal();
    return null;
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
    state = await api('/api/state');
    lastSyncAt = Date.now();
    if (!state.members.includes(selectedMember)) setSelectedMember('');
    if (shouldRender) render();
}

async function toggleReservation(zone) {
    const memberName = requireMember();
    if (!memberName) return;

    const reserved = (zone.reservations || []).some((reservation) => reservation.memberName === memberName);
    const wasLocked = zone.cooldownUntil && new Date(zone.cooldownUntil).getTime() > getNowMs();
    const path = reserved
        ? `/api/reservations?zoneId=${encodeURIComponent(zone.id)}&memberName=${encodeURIComponent(memberName)}`
        : '/api/reservations';

    try {
        if (!reserved) requestNotifications({ quiet: true }).catch(() => {});

        state = await api(path, {
            method: reserved ? 'DELETE' : 'POST',
            body: reserved ? undefined : JSON.stringify({ zoneId: zone.id, memberName })
        });
        lastSyncAt = Date.now();
        render();
        showToast(
            reserved ? '예약을 취소했습니다' : '예약했습니다',
            reserved ? zone.name : wasLocked ? '쿨타임이 끝나면 알려드릴게요.' : '지금 바로 완료할 수 있습니다.'
        );
    } catch (err) {
        showToast('예약 처리 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    }
}

async function resetZoneState() {
    const zone = selectedActionZone;
    const memberName = requireMember();
    if (!zone || !memberName) return;

    if (!confirm(`${zone.name} 상태를 초기화할까요?\n랭킹 기록은 유지됩니다.`)) return;

    try {
        const data = await api('/api/zones/reset-state', {
            method: 'POST',
            body: JSON.stringify({ zoneId: zone.id, memberName })
        });
        state = data;
        lastSyncAt = Date.now();
        closeZoneActionModal();
        render();
        showToast('상태 초기화 완료', `${zone.name} 잠김과 예약을 비웠습니다.`);
    } catch (err) {
        showToast('초기화 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    }
}

async function cancelLastCheck() {
    const zone = selectedActionZone;
    const memberName = requireMember();
    if (!zone || !memberName) return;

    if (!confirm(`${zone.name}의 마지막 완료 기록을 취소할까요?\n랭킹 횟수도 차감됩니다.`)) return;

    try {
        const data = await api('/api/zones/cancel-last-check', {
            method: 'POST',
            body: JSON.stringify({ zoneId: zone.id, memberName })
        });
        state = data;
        lastSyncAt = Date.now();
        closeZoneActionModal();
        render();
        showToast('마지막 완료 기록 취소됨', `${zone.name} 랭킹 기록을 되돌렸습니다.`);
    } catch (err) {
        showToast('기록 취소 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    }
}

function isCardControl(target) {
    return Boolean(target.closest('button, a, input, textarea, select, label'));
}

async function submitZoneCheck(zone) {
    const memberName = requireMember();
    if (!memberName) return;

    try {
        const data = await api('/api/check', {
            method: 'POST',
            body: JSON.stringify({ zoneId: zone.id, memberName })
        });
        state = data;
        lastSyncAt = Date.now();
        render();
        if (data.action === 'undo') {
            showToast('완료 취소됨', `${zone.name} 이전 상태로 복구`);
        } else {
            showToast('완료 저장됨', `${zone.name} 쿨타임 ${zone.cooldownMin}분 시작`);
        }
    } catch (err) {
        showToast('완료 실패', err.message, 'error');
        fetchState(true).catch(() => {});
    }
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

function renderZones() {
    const now = getNowMs();
    zoneList.replaceChildren();

    if (state.zones.length === 0) {
        zoneList.innerHTML = '<div class="empty">아직 등록된 썰자 구역이 없습니다. 관리 페이지에서 구역을 추가하세요.</div>';
        return;
    }

    for (const zone of state.zones) {
        const card = zoneCardTemplate.content.firstElementChild.cloneNode(true);
        const cooldownUntil = zone.cooldownUntil ? new Date(zone.cooldownUntil).getTime() : 0;
        const remain = cooldownUntil - now;
        const locked = remain > 0;

        card.classList.toggle('isLocked', locked);
        card.querySelector('.zoneName').textContent = zone.name;
        const menuButton = card.querySelector('.zoneMenuButton');
        menuButton.setAttribute('aria-label', `${zone.name} 관리 메뉴`);
        menuButton.addEventListener('click', () => openZoneActionModal(zone));
        card.querySelector('.lastText').textContent = zone.lastBy
            ? `최근 ${zone.lastBy} · ${formatTime(zone.lastAt)}`
            : '';
        const reservations = (zone.reservations || []).filter((reservation) => {
            return !reservation.expiresAt || new Date(reservation.expiresAt).getTime() > now;
        });
        const activeReservation = reservations[0];
        const reservedByMe = activeReservation?.memberName === selectedMember;
        const reservedByOther = Boolean(activeReservation && !reservedByMe);
        const inProgress = reservedByOther && !locked;
        const checkedByMeAt = zone.lastAt ? new Date(zone.lastAt).getTime() : 0;
        const canUndoCheck = locked
            && zone.lastBy === selectedMember
            && Number.isFinite(checkedByMeAt)
            && now - checkedByMeAt <= CHECK_UNDO_GRACE_MS;
        const canUseCardCheck = !reservedByOther && (!locked || canUndoCheck);
        const reservationRemain = activeReservation?.expiresAt
            ? formatRemain(new Date(activeReservation.expiresAt).getTime() - now)
            : null;

        card.classList.toggle('isInProgress', inProgress);
        card.querySelector('.statusText').textContent = locked ? '쿨타임' : inProgress ? '진행중' : '가능';
        card.classList.toggle('isTappable', canUseCardCheck);
        if (canUseCardCheck) {
            card.tabIndex = 0;
            card.setAttribute('role', 'button');
            card.setAttribute('aria-label', canUndoCheck ? `${zone.name} 완료 취소` : `${zone.name} 완료`);
        }

        if (shouldAlertReservationReady(zone, activeReservation, locked)) notifyReservationReady(zone);

        card.querySelector('.reservationText').textContent = reservations.length > 0
            ? `예약 ${activeReservation.memberName} · ${reservationRemain}`
            : '';

        const reserveButton = card.querySelector('.reserveButton');
        reserveButton.textContent = reservedByMe ? '예약 취소' : reservedByOther ? '진행중' : '예약';
        reserveButton.classList.toggle('isReserved', reservedByMe);
        reserveButton.disabled = reservedByOther;
        reserveButton.addEventListener('click', () => toggleReservation(zone));

        const button = card.querySelector('.checkButton');
        button.textContent = canUndoCheck ? '되돌리기' : locked ? formatCountdown(remain) : reservedByOther ? '예약자 전용' : '완료';
        button.classList.toggle('isCooldown', locked && !canUndoCheck);
        button.classList.toggle('isUndo', canUndoCheck);
        button.setAttribute('aria-label', canUndoCheck ? `${zone.name} 완료 취소` : locked ? `${zone.name} ${formatCountdown(remain)} 남음` : `${zone.name} 완료`);
        button.disabled = (locked && !canUndoCheck) || reservedByOther;
        button.addEventListener('click', () => submitZoneCheck(zone));

        card.addEventListener('click', (event) => {
            if (isCardControl(event.target) || !canUseCardCheck) return;
            submitZoneCheck(zone);
        });
        card.addEventListener('keydown', (event) => {
            if (!canUseCardCheck || isCardControl(event.target)) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                submitZoneCheck(zone);
            }
        });

        zoneList.append(card);
    }
}

function render() {
    renderZones();
    renderMemberSuggest();
}

openProfileButton.addEventListener('click', openProfileModal);
closeProfileButton.addEventListener('click', closeProfileModal);
skipProfileButton.addEventListener('click', closeProfileModal);
enableNotifyButton?.addEventListener('click', () => requestNotifications());
closeZoneActionButton.addEventListener('click', closeZoneActionModal);
resetZoneStateButton.addEventListener('click', resetZoneState);
cancelLastCheckButton.addEventListener('click', cancelLastCheck);
memberSearchInput.addEventListener('input', renderMemberSuggest);
profileForm.addEventListener('submit', (event) => event.preventDefault());
profileModal.addEventListener('click', (event) => {
    if (event.target === profileModal) closeProfileModal();
});
zoneActionModal.addEventListener('click', (event) => {
    if (event.target === zoneActionModal) closeZoneActionModal();
});

setSelectedMember(selectedMember);
updateNotifyButton();
fetchState(true).then(() => {
    if (!state.members.includes(selectedMember)) openProfileModal();
});

setInterval(() => renderZones(), 1000);
setInterval(() => fetchState(true).catch(() => {}), 3000);
