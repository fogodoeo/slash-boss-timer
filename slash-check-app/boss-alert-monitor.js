(() => {
    if (window.__bossAlertMonitorStarted) return;
    if (document.querySelector('#bossTimeline')) return;
    window.__bossAlertMonitorStarted = true;

    const NOTIFY_ENABLED_KEY = 'slashCheckNotificationsEnabled';
    const BOSS_NOTIFY_LAST_KEY = 'slashBossLastNotificationKey';
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const BOSS_ALERT_MS = 60 * 60 * 1000;
    const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
    const ORIGINAL_TITLE = document.title;

    let titleAlertTimer = null;
    let titleAlertKey = '';
    let titleAlertFlip = false;
    let serverNowMs = Date.now();
    let syncedAtMs = Date.now();

    function notificationsEnabled() {
        const saved = localStorage.getItem(NOTIFY_ENABLED_KEY);
        if (saved === 'off') return false;
        if (saved === 'on') return true;
        return 'Notification' in window && Notification.permission === 'granted';
    }

    function getNowMs() {
        return serverNowMs + (Date.now() - syncedAtMs);
    }

    function pad2(value) {
        return String(value).padStart(2, '0');
    }

    function kstDate(ms) {
        return new Date(ms + KST_OFFSET_MS);
    }

    function startOfKstDay(ms = getNowMs()) {
        const date = kstDate(ms);
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - KST_OFFSET_MS;
    }

    function formatRemain(targetMs, now = getNowMs()) {
        const diff = targetMs - now;
        if (diff <= 0) return '젠됨';
        const totalMin = Math.ceil(diff / 60000);
        if (totalMin >= 60) return `${Math.floor(totalMin / 60)}시간 ${totalMin % 60}분`;
        return `${totalMin}분`;
    }

    function formatKstTime(ms) {
        const date = kstDate(ms);
        return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
    }

    function displayBossLocation(value) {
        const raw = String(value || '').trim();
        if (!raw) return '위치 미등록';
        return raw
            .replace(/^\s*\(?\s*\d+\s*-\s*\d+\s*\)?\s*/, '')
            .replace(/[()]/g, '')
            .trim() || raw;
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
        const makeTitle = () => `[젠 ${formatRemain(item.spawnMs)}] ${item.boss.이름}`;

        if (titleAlertKey !== key) {
            stopTitleAlert();
            titleAlertKey = key;
        }

        document.title = makeTitle();
        if (titleAlertTimer) return;

        titleAlertTimer = setInterval(() => {
            titleAlertFlip = !titleAlertFlip;
            document.title = titleAlertFlip ? makeTitle() : ORIGINAL_TITLE;
        }, 1000);
    }

    function latestRecordForBoss(data, boss) {
        const name = boss.이름;
        const fromCuts = data.bossCuts?.[name] ? {
            bossName: name,
            ...data.bossCuts[name]
        } : null;
        const fromRecords = (data.bossCutRecords || [])
            .filter((record) => record.status !== 'canceled' && record.bossName === name)
            .sort((a, b) => new Date(b.cutAt || b.updatedAt || 0) - new Date(a.cutAt || a.updatedAt || 0))[0] || null;
        return fromCuts || fromRecords;
    }

    function addItem(items, seen, boss, spawnMs, source) {
        if (!Number.isFinite(spawnMs)) return;
        const now = getNowMs();
        if (spawnMs < now || spawnMs > now + LOOKAHEAD_MS) return;
        const key = `${boss.이름}:${spawnMs}`;
        if (seen.has(key)) return;
        seen.add(key);
        items.push({ boss, spawnMs, source });
    }

    function fixedSpawnCoveredByLatestCut(latest, spawnMs) {
        if (!latest) return false;

        const nextSpawnMs = new Date(latest.nextSpawnAt || '').getTime();
        if (Number.isFinite(nextSpawnMs) && spawnMs < nextSpawnMs) return true;

        const cutMs = new Date(latest.cutAt || '').getTime();
        return Number.isFinite(cutMs) && spawnMs <= cutMs;
    }

    function addFixedBossItems(items, seen, boss, latest) {
        if (!Array.isArray(boss.요일) || !boss.시간) return;
        const [hour, minute] = String(boss.시간).split(':').map(Number);
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return;

        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
        const start = startOfKstDay(getNowMs());
        for (let offset = 0; offset <= 2; offset += 1) {
            const dayStart = start + offset * DAY_MS;
            const dayName = dayNames[kstDate(dayStart).getUTCDay()];
            if (!boss.요일.includes(dayName)) continue;
            const spawnMs = dayStart + hour * 60 * 60 * 1000 + minute * 60 * 1000;
            if (fixedSpawnCoveredByLatestCut(latest, spawnMs)) continue;
            addItem(items, seen, boss, spawnMs, 'fixed');
        }
    }

    function buildTimeline(data) {
        const items = [];
        const seen = new Set();
        for (const boss of data.bosses || []) {
            const latest = latestRecordForBoss(data, boss);
            const plannedMs = new Date(latest?.nextSpawnAt || boss.nextSpawnAt || '').getTime();
            addItem(items, seen, boss, plannedMs, latest ? 'cut' : 'planned');
            if (boss.타입 === '고정') addFixedBossItems(items, seen, boss, latest);
        }
        return items.sort((a, b) => a.spawnMs - b.spawnMs || String(a.boss.이름).localeCompare(String(b.boss.이름), 'ko'));
    }

    function leadingAlertItem(items) {
        const now = getNowMs();
        return items.find((item) => item.spawnMs >= now && item.spawnMs - now <= BOSS_ALERT_MS) || null;
    }

    function shouldSendBrowserNotification(item) {
        const key = `${item.boss.이름}:${item.spawnMs}`;
        const storedKey = `boss:${key}`;
        if (localStorage.getItem(BOSS_NOTIFY_LAST_KEY) === storedKey) return false;
        localStorage.setItem(BOSS_NOTIFY_LAST_KEY, storedKey);
        return true;
    }

    function maybeNotify(item) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        if (!shouldSendBrowserNotification(item)) return;

        const notification = new Notification(`${item.boss.이름} ${formatRemain(item.spawnMs)}`, {
            body: `${formatKstTime(item.spawnMs)} 젠 예정 · ${displayBossLocation(item.boss.위치)}`,
            tag: `boss-global-${item.boss.이름}-${item.spawnMs}`,
            requireInteraction: false
        });
        setTimeout(() => notification.close?.(), 7000);
        navigator.vibrate?.([180, 70, 180]);
    }

    async function tick() {
        if (!notificationsEnabled()) {
            stopTitleAlert();
            return;
        }

        try {
            const res = await fetch('/api/state', { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            const nowMs = new Date(data.now || '').getTime();
            serverNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
            syncedAtMs = Date.now();

            const item = leadingAlertItem(buildTimeline(data));
            if (!item) {
                stopTitleAlert();
                return;
            }

            startTitleAlert(item);
            maybeNotify(item);
        } catch {
            // Keep the current title state during transient network errors.
        }
    }

    window.addEventListener('storage', (event) => {
        if (event.key === NOTIFY_ENABLED_KEY) tick();
    });
    window.addEventListener('slash-notify-setting-changed', tick);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) tick();
    });

    tick();
    setInterval(tick, 15000);
})();
