(() => {
    const $ = (id) => document.getElementById(id);
    const stateHero = $('stateHero');
    const refreshButton = $('refreshButton');
    let loading = false;

    const stateCopy = {
        CONNECTED: ['정상 작동', 'BAND 가입 신청을 실시간으로 감시 중입니다', 'good'],
        CONNECTING: ['연결 중', 'BAND 로그인 세션에 연결하고 있습니다', 'warn'],
        LOGIN_REQUIRED: ['로그인 필요', 'BAND 로그인 세션이 만료되었습니다', 'warn'],
        FALLBACK: ['복구 중', '기본 감시 방식으로 전환해 연결을 복구 중입니다', 'warn'],
        DISABLED: ['실행 중지', 'Render에서 승인 프로그램이 꺼져 있습니다', 'bad'],
        DISCONNECTED: ['연결 끊김', '승인 프로그램이 BAND와 연결되지 않았습니다', 'bad'],
        UNKNOWN: ['상태 없음', '아직 승인 프로그램의 실행 신호가 없습니다', 'bad']
    };
    const actionNames = { approve: '자동 승인', reject: '자동 반려', question: '추가 질문 전송', feedback: '수정 안내 전송' };

    function formatRelative(value) {
        if (!value) return '—';
        const diff = Math.max(0, Date.now() - Date.parse(value));
        if (!Number.isFinite(diff)) return '—';
        const seconds = Math.floor(diff / 1000);
        if (seconds < 5) return '방금 전';
        if (seconds < 60) return `${seconds}초 전`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}분 전`;
        return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
    }

    function setBadge(id, label, tone) {
        const badge = $(id);
        badge.textContent = label;
        badge.className = `miniBadge ${tone}`;
    }

    function setFlow(id, ready, pendingLabel = '꺼짐') {
        const item = $(id);
        item.classList.toggle('ready', ready);
        item.classList.toggle('problem', !ready);
        item.querySelector('b').textContent = ready ? '준비됨' : pendingLabel;
    }

    function render(data) {
        const monitor = data.monitor || {};
        const stale = Boolean(monitor.stale);
        const copy = stateCopy[monitor.state] || stateCopy.UNKNOWN;
        const tone = stale ? 'bad' : copy[2];
        stateHero.className = `stateHero tone-${tone}`;
        $('stateKicker').textContent = stale ? '신호 지연' : copy[0];
        $('stateTitle').textContent = stale ? '승인 프로그램의 최신 신호가 늦어지고 있습니다' : copy[1];
        $('stateDetail').textContent = monitor.detail || (stale ? 'Render 재배포 또는 프로세스 재시작 여부를 확인하세요.' : '상세 메시지가 없습니다.');
        $('heartbeatValue').textContent = formatRelative(monitor.updated_at);
        $('versionValue').textContent = monitor.version || '—';

        const monitorOn = monitor.monitor_enabled && monitor.state !== 'DISABLED';
        $('monitorValue').textContent = monitorOn ? '실행 중' : '꺼짐';
        setBadge('monitorBadge', monitorOn ? 'ON' : 'OFF', monitorOn ? 'good' : 'bad');

        const bandReady = monitor.connected && !stale;
        $('bandValue').textContent = bandReady ? '연결됨' : monitor.state === 'LOGIN_REQUIRED' ? '로그인 필요' : '연결 안 됨';
        setBadge('bandBadge', bandReady ? '정상' : monitor.state === 'CONNECTING' ? '연결 중' : '점검', bandReady ? 'good' : monitor.state === 'CONNECTING' ? 'warn' : 'bad');

        const decisionReady = monitor.auto_approve && monitor.auto_reject && monitor.phone_verification?.require_number_match;
        $('decisionValue').textContent = decisionReady ? '승인·반려 ON' : '설정 확인';
        setBadge('decisionBadge', decisionReady ? '자동' : '미완료', decisionReady ? 'good' : 'warn');

        const syncReady = monitor.member_sync?.enabled && monitor.member_sync?.configured;
        $('syncValue').textContent = syncReady ? '연동 준비됨' : monitor.member_sync?.enabled ? '키 확인 필요' : '꺼짐';
        setBadge('syncBadge', syncReady ? 'READY' : 'CHECK', syncReady ? 'good' : 'warn');

        const counts = monitor.applications || {};
        $('trackedCount').textContent = counts.tracked || 0;
        $('queuedCount').textContent = counts.queued || 0;
        $('eligibleCount').textContent = counts.eligible || 0;
        $('verificationCount').textContent = counts.verification_pending || 0;
        $('invalidCount').textContent = counts.invalid || 0;
        $('failedCount').textContent = counts.action_failed || 0;

        const lastAction = monitor.last_action;
        if (lastAction) {
            $('lastActionValue').textContent = `${actionNames[lastAction.type] || lastAction.type || '자동 동작'} · ${lastAction.success ? '성공' : '실패'}`;
            $('lastActionTime').textContent = formatRelative(lastAction.at);
        } else {
            $('lastActionValue').textContent = '아직 동작 기록이 없습니다';
            $('lastActionTime').textContent = '—';
        }

        const phoneReady = monitor.phone_verification?.enabled && monitor.phone_verification?.require_verified && monitor.phone_verification?.require_number_match;
        setFlow('phoneRuleStep', phoneReady, '설정 확인');
        setFlow('approveStep', monitor.auto_approve && monitor.auto_reject, '설정 확인');
        setFlow('syncStep', syncReady, monitor.member_sync?.enabled ? '키 확인' : '꺼짐');

        $('livePulse').classList.toggle('offline', stale || !data.ok);
        $('lastChecked').textContent = `화면 갱신 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }

    function renderError() {
        stateHero.className = 'stateHero tone-bad';
        $('stateKicker').textContent = '연결 오류';
        $('stateTitle').textContent = '상태 서버에 연결하지 못했습니다';
        $('stateDetail').textContent = '네트워크 연결이나 Render 서비스 상태를 확인하세요.';
        $('livePulse').classList.add('offline');
        $('lastChecked').textContent = '갱신 실패';
    }

    async function loadStatus() {
        if (loading) return;
        loading = true;
        refreshButton.disabled = true;
        try {
            const response = await fetch('/api/band-monitor/status', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            render(await response.json());
        } catch (error) {
            console.warn('[band-monitor-ui] status load failed', error);
            renderError();
        } finally {
            loading = false;
            refreshButton.disabled = false;
        }
    }

    refreshButton.addEventListener('click', loadStatus);
    loadStatus();
    window.setInterval(loadStatus, 2000);
})();
