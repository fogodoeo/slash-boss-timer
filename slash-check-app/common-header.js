(() => {
    const MEMBER_KEY = 'slashCheckMemberName';
    const memberButton = document.querySelector('#openProfileButton');
    const memberLabel = document.querySelector('#selectedMemberLabel');
    const notifyButton = document.querySelector('#enableNotifyButton');

    function cleanName(value) {
        return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    }

    function updateMemberLabel() {
        if (!memberLabel) return;
        memberLabel.textContent = cleanName(localStorage.getItem(MEMBER_KEY)) || '길드원 미선택';
    }

    function toastHost() {
        let host = document.querySelector('#toastHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'toastHost';
            host.className = 'toastHost';
            host.setAttribute('aria-live', 'polite');
            document.body.append(host);
        }
        return host;
    }

    function showToast(title, message = '', tone = 'success') {
        const host = toastHost();
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

        host.append(toast);
        requestAnimationFrame(() => toast.classList.add('show'));

        const closeToast = () => {
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

    function updateNotifyButton() {
        if (!notifyButton) return;
        if (!('Notification' in window)) {
            setNotifyButton(notifyButton, '알림 미지원', 'unsupported', true);
            return;
        }
        if (Notification.permission === 'granted') {
            setNotifyButton(notifyButton, '알림 켜짐', 'granted');
            return;
        }
        if (Notification.permission === 'denied') {
            setNotifyButton(notifyButton, '알림 차단됨', 'denied', true);
            return;
        }
        setNotifyButton(notifyButton, '알림 켜기', 'default');
    }

    async function requestNotifications() {
        if (!('Notification' in window)) {
            showToast('브라우저 알림 미지원', '이 브라우저에서는 화면 안 알림만 표시됩니다.');
            updateNotifyButton();
            return;
        }
        if (Notification.permission === 'granted') {
            showToast('알림 켜짐', '이 브라우저에서 알림을 받을 수 있습니다.');
            updateNotifyButton();
            return;
        }
        if (Notification.permission === 'denied') {
            showToast('알림 차단됨', '브라우저 설정에서 알림을 허용해야 합니다.', 'error');
            updateNotifyButton();
            return;
        }

        const permission = await Notification.requestPermission();
        updateNotifyButton();
        showToast(permission === 'granted' ? '알림이 켜졌습니다' : '알림을 켜지 못했습니다', permission === 'granted' ? '예약과 보스 알림을 받을 준비가 됐습니다.' : '브라우저 알림 권한이 필요합니다.', permission === 'granted' ? 'success' : 'error');
    }

    let membersPromise = null;
    function loadMembers() {
        if (!membersPromise) {
            membersPromise = fetch('/api/state', { cache: 'no-store' })
                .then((res) => res.ok ? res.json() : Promise.reject(new Error('state')))
                .then((data) => Array.isArray(data.members) ? data.members : [])
                .catch(() => []);
        }
        return membersPromise;
    }

    function ensureProfileModal() {
        let modal = document.querySelector('#commonProfileModal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'commonProfileModal';
        modal.className = 'modalOverlay hidden';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'commonProfileTitle');
        modal.innerHTML = `
            <form class="profileModal">
                <button class="modalClose" type="button" aria-label="닫기" data-profile-close>×</button>
                <span class="modalEyebrow">사용자 설정</span>
                <h2 id="commonProfileTitle">길드원을 선택하세요</h2>
                <p>닉네임 일부를 입력하면 등록된 길드원이 추천됩니다. 목록에서 본인 닉네임을 선택하세요.</p>
                <input id="commonMemberSearchInput" type="text" autocomplete="off" placeholder="예: N건강">
                <div id="commonMemberSuggest" class="memberSuggest"></div>
                <button class="modalSkip" type="button" data-profile-close>닫기</button>
            </form>
        `;
        document.body.append(modal);

        modal.addEventListener('click', (event) => {
            if (event.target === modal || event.target.closest('[data-profile-close]')) {
                closeProfileModal();
            }
        });
        modal.querySelector('form').addEventListener('submit', (event) => event.preventDefault());
        modal.querySelector('#commonMemberSearchInput').addEventListener('input', () => renderSuggestions());
        return modal;
    }

    function closeProfileModal() {
        document.querySelector('#commonProfileModal')?.classList.add('hidden');
    }

    async function renderSuggestions() {
        const modal = ensureProfileModal();
        const input = modal.querySelector('#commonMemberSearchInput');
        const suggest = modal.querySelector('#commonMemberSuggest');
        const members = await loadMembers();
        const query = cleanName(input.value).toLowerCase().replace(/\s+/g, '');

        suggest.replaceChildren();
        if (!query) {
            const hint = document.createElement('div');
            hint.className = 'suggestHint';
            hint.textContent = '닉네임을 입력하면 추천 목록이 표시됩니다.';
            suggest.append(hint);
            return;
        }

        const matches = members
            .map((member) => String(member || '').trim())
            .filter((member) => member.toLowerCase().replace(/\s+/g, '').includes(query))
            .slice(0, 24);

        if (matches.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'suggestHint';
            hint.textContent = '등록된 길드원 중 일치하는 닉네임이 없습니다.';
            suggest.append(hint);
            return;
        }

        for (const member of matches) {
            const button = document.createElement('button');
            button.className = 'suggestItem';
            button.type = 'button';
            button.textContent = member;
            button.addEventListener('click', () => {
                localStorage.setItem(MEMBER_KEY, member);
                updateMemberLabel();
                closeProfileModal();
                showToast('닉네임 변경됨', member);
            });
            suggest.append(button);
        }
    }

    async function openProfileModal() {
        const modal = ensureProfileModal();
        const input = modal.querySelector('#commonMemberSearchInput');
        input.value = cleanName(localStorage.getItem(MEMBER_KEY));
        modal.classList.remove('hidden');
        await renderSuggestions();
        requestAnimationFrame(() => {
            input.focus();
            input.select();
        });
    }

    updateMemberLabel();
    updateNotifyButton();
    memberButton?.addEventListener('click', openProfileModal);
    notifyButton?.addEventListener('click', requestNotifications);
})();
