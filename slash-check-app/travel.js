(() => {
    const PIN_KEY = 'travelExpensePin';
    const RATE_KEY = 'travelExpenseRate';
    const FIXED_TOTAL_KRW = 2312758;
    const BUDGET_KRW = 3000000;

    const pinOverlay = document.querySelector('#pinOverlay');
    const pinForm = document.querySelector('#pinForm');
    const pinInput = document.querySelector('#pinInput');
    const pinStatus = document.querySelector('#pinStatus');
    const expenseForm = document.querySelector('#expenseForm');
    const quickManualForm = document.querySelector('#quickManualForm');
    const manualForm = document.querySelector('#manualForm');
    const travelList = document.querySelector('#travelList');
    const rateInput = document.querySelector('#rateInput');
    const saveStatus = document.querySelector('#saveStatus');
    const receiptInput = document.querySelector('#receiptInput');
    const photoPreview = document.querySelector('#photoPreview');
    const receiptFileName = document.querySelector('#receiptFileName');
    const walletList = document.querySelector('#walletList');
    const walletStatus = document.querySelector('#walletStatus');

    let pin = sessionStorage.getItem(PIN_KEY) || '';
    let receiptDataUrl = '';
    let expenses = [];
    let wallets = [];

    function todayKst() {
        const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
        return now.toISOString().slice(0, 10);
    }

    function formatKrw(value) {
        const rounded = Math.round(Number(value) || 0);
        const sign = rounded < 0 ? '-' : '';
        return `${sign}${Math.abs(rounded).toLocaleString('ko-KR')}원`;
    }

    function number(value) {
        const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function rate() {
        return Math.max(number(rateInput.value) || 9.5, 0);
    }

    function toKrw(item) {
        const amount = number(item.amount);
        return item.currency === 'JPY' ? amount * rate() : amount;
    }

    function transactionType(item) {
        const type = String(item.transactionType || '지출').trim();
        return ['지출', '현금인출', 'IC충전', '환전', '환급', '정산이동', '수수료', '기타'].includes(type) ? type : '지출';
    }

    function budgetImpactKrw(item) {
        const type = transactionType(item);
        if (type === '환급') return -toKrw(item);
        if (type === '지출' || type === '수수료' || type === '기타') return toKrw(item);
        return 0;
    }

    function isMovement(item) {
        return ['현금인출', 'IC충전', '환전', '정산이동'].includes(transactionType(item));
    }

    function formatCurrencyAmount(currency, amount) {
        const value = Number(amount || 0).toLocaleString('ko-KR');
        return `${currency || 'JPY'} ${value}`;
    }

    function formatSignedCurrencyAmount(currency, amount) {
        const value = number(amount);
        const sign = value > 0 ? '+' : value < 0 ? '-' : '';
        return `${sign}${formatCurrencyAmount(currency, Math.abs(value))}`;
    }

    function showStatus(message, tone = '') {
        saveStatus.textContent = message;
        saveStatus.classList.toggle('error', tone === 'error');
        window.clearTimeout(showStatus.timer);
        showStatus.timer = window.setTimeout(() => {
            saveStatus.textContent = '';
            saveStatus.classList.remove('error');
        }, tone === 'error' ? 4200 : 2400);
    }

    function showWalletStatus(message, tone = '') {
        walletStatus.textContent = message;
        walletStatus.classList.toggle('error', tone === 'error');
        window.clearTimeout(showWalletStatus.timer);
        showWalletStatus.timer = window.setTimeout(() => {
            walletStatus.textContent = '';
            walletStatus.classList.remove('error');
        }, tone === 'error' ? 4200 : 2400);
    }

    function setPinStatus(message, tone = '') {
        pinStatus.textContent = message;
        pinStatus.classList.toggle('error', tone === 'error');
    }

    async function api(path, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'X-Travel-Pin': pin,
            ...(options.headers || {})
        };
        const res = await fetch(path, {
            cache: 'no-store',
            ...options,
            headers
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
        return data;
    }

    async function unlock(nextPin) {
        pin = String(nextPin || '').trim();
        await api('/api/travel/auth', {
            method: 'POST',
            body: JSON.stringify({ pin })
        });
        sessionStorage.setItem(PIN_KEY, pin);
        pinOverlay.classList.add('hidden');
        await loadExpenses();
    }

    async function loadExpenses() {
        const data = await api('/api/travel/expenses');
        expenses = Array.isArray(data.expenses) ? data.expenses : [];
        wallets = Array.isArray(data.wallets) ? data.wallets : [];
        render();
    }

    async function compressImage(file) {
        if (!file) return '';
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
            throw new Error('JPG, PNG, WEBP 사진만 올릴 수 있습니다.');
        }

        const bitmap = await createImageBitmap(file);
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();

        return canvas.toDataURL('image/jpeg', 0.78);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function expenseTime(item) {
        const direct = Date.parse(item.createdAt || item.updatedAt || '');
        if (Number.isFinite(direct)) return direct;
        const date = item.date || '';
        const time = item.paymentTime || '00:00';
        const fromDate = Date.parse(`${date}T${time}:00+09:00`);
        return Number.isFinite(fromDate) ? fromDate : 0;
    }

    function walletDelta(wallet, item) {
        if (!wallet || item.currency !== wallet.currency) return 0;
        const type = transactionType(item);
        const method = String(item.method || '').trim();
        const amount = number(item.amount);
        if (!amount) return 0;

        if (wallet.id === 'hana-jpy') {
            if (type === '환전') return amount;
            if (type === '현금인출') return -amount;
            return 0;
        }

        if (wallet.id === 'cash-jpy') {
            if (type === '현금인출') return amount;
            if (type === 'IC충전' && method === '현금') return -amount;
            if ((type === '지출' || type === '수수료') && method === '현금') return -amount;
            if (type === '환급' && method === '현금') return amount;
            return 0;
        }

        if (wallet.id === 'ic-jpy') {
            if (type === 'IC충전') return amount;
            if (type === '지출' && method === '교통카드') return -amount;
            if (type === '환급' && method === '교통카드') return amount;
            return 0;
        }

        return 0;
    }

    function latestIcReceiptBalance(wallet) {
        if (wallet.id !== 'ic-jpy') return null;
        return expenses
            .filter((item) => number(item.icBalance) > 0 && (item.icBalanceCurrency || item.currency || 'JPY') === wallet.currency)
            .map((item) => ({ item, time: expenseTime(item) }))
            .sort((a, b) => b.time - a.time)[0] || null;
    }

    function computedWallet(wallet) {
        const anchorTime = Date.parse(wallet.updatedAt || '') || 0;
        const base = number(wallet.balance);
        const delta = expenses
            .filter((item) => expenseTime(item) > anchorTime)
            .reduce((sum, item) => sum + walletDelta(wallet, item), 0);
        const receiptBalance = latestIcReceiptBalance(wallet);
        const receiptTime = receiptBalance?.time || 0;

        if (receiptBalance && (!anchorTime || receiptTime > anchorTime)) {
            return {
                balance: number(receiptBalance.item.icBalance),
                base,
                delta,
                source: '최근 IC 영수증 잔액',
                sourceDetail: `${receiptBalance.item.date || ''} ${receiptBalance.item.paymentTime || ''}`.trim()
            };
        }

        return {
            balance: base + delta,
            base,
            delta,
            source: wallet.updatedAt ? '수동 기준 + 이후 영수증' : '초기값 + 전체 영수증',
            sourceDetail: wallet.updatedAt ? new Date(wallet.updatedAt).toLocaleString('ko-KR') : '수동 잔액 미입력'
        };
    }

    function renderWallets() {
        const items = wallets.length ? wallets : [
            { id: 'hana-jpy', name: '하나머니 JPY', currency: 'JPY', balance: 0, note: '하나머니 앱 잔액을 기준으로 보정' },
            { id: 'cash-jpy', name: '현금 JPY', currency: 'JPY', balance: 0, note: '세븐뱅크 인출 후 지갑 현금' },
            { id: 'ic-jpy', name: 'IC카드', currency: 'JPY', balance: 0, note: 'ICOCA/Suica 등 교통카드' }
        ];

        walletList.innerHTML = items.map((wallet) => {
            const computed = computedWallet(wallet);
            const deltaText = computed.delta ? `자동증감 ${formatSignedCurrencyAmount(wallet.currency, computed.delta)}` : '자동증감 없음';
            return `
                <article class="walletCard" data-wallet-id="${escapeHtml(wallet.id)}">
                    <div class="walletCardTop">
                        <div>
                            <b>${escapeHtml(wallet.name)}</b>
                            <div class="walletMeta">${escapeHtml(wallet.note || '')}</div>
                        </div>
                        <span class="travelEntryMeta">${escapeHtml(wallet.currency)}</span>
                    </div>
                    <div class="walletBalance">${escapeHtml(formatCurrencyAmount(wallet.currency, computed.balance))}</div>
                    <div class="walletMeta">${escapeHtml(computed.source)} · ${escapeHtml(deltaText)}</div>
                    <div class="walletMeta">${escapeHtml(computed.sourceDetail || '')}</div>
                    <div class="walletControls">
                        <input data-wallet-balance="${escapeHtml(wallet.id)}" type="number" inputmode="numeric" min="0" step="1" value="${escapeHtml(wallet.balance || 0)}" aria-label="${escapeHtml(wallet.name)} 수동 잔액">
                        <button class="travelGhostButton" type="button" data-wallet-save="${escapeHtml(wallet.id)}">저장</button>
                    </div>
                </article>
            `;
        }).join('');
    }

    function render() {
        renderWallets();
        const spent = expenses.reduce((sum, item) => sum + budgetImpactKrw(item), 0);
        const movementTotal = expenses.reduce((sum, item) => sum + (isMovement(item) ? toKrw(item) : 0), 0);
        const spendingCount = expenses.filter((item) => budgetImpactKrw(item) !== 0).length;
        const movementCount = expenses.filter(isMovement).length;
        const remaining = BUDGET_KRW - FIXED_TOTAL_KRW - spent;
        document.querySelector('#spentTotal').textContent = formatKrw(spent);
        document.querySelector('#spentMeta').textContent = `예산반영 ${spendingCount}건 · 이동 ${movementCount}건 ${formatKrw(movementTotal)} · 환율 ${rate()}원`;
        document.querySelector('#remainTotal').textContent = formatKrw(remaining);
        document.querySelector('#entrySummary').textContent = `${expenses.length}건`;

        if (!expenses.length) {
            travelList.innerHTML = '<div class="travelEntry emptyEntry"><b>아직 등록된 결제 내역이 없습니다.</b><div class="travelEntryMeta">영수증을 올리면 분석 결과가 여기에 쌓입니다.</div></div>';
            return;
        }

        travelList.innerHTML = expenses.map((item) => {
            const title = escapeHtml(item.merchant || item.item || '결제 내역');
            const sub = escapeHtml(item.item && item.merchant ? item.item : item.memo || '');
            const receipt = item.receipt?.id
                ? `<a class="receiptLink" href="/api/travel/receipt/${encodeURIComponent(item.receipt.id)}?pin=${encodeURIComponent(pin)}" target="_blank" rel="noopener noreferrer">영수증</a>`
                : '';
            const status = escapeHtml(item.analysisStatus || (item.amount > 0 ? '완료' : '분석대기'));
            const confidence = Number(item.confidence || 0) > 0
                ? `<span>신뢰도 ${Math.round(Number(item.confidence || 0) * 100)}%</span>`
                : '';
            const timeText = item.paymentTime ? ` ${escapeHtml(item.paymentTime)}` : '';
            const location = item.location ? `<div class="travelEntryMeta">${escapeHtml(item.location)}</div>` : '';
            const icBalance = Number(item.icBalance || 0) > 0
                ? `<span>${escapeHtml(item.icCard || 'IC')} 잔액 ${escapeHtml(formatCurrencyAmount(item.icBalanceCurrency || item.currency || 'JPY', item.icBalance))}</span>`
                : '';
            const type = transactionType(item);
            const impact = budgetImpactKrw(item);
            const impactLabel = impact === 0 ? '예산 제외' : `예산 ${formatKrw(impact)}`;
            return `
                <article class="travelEntry" data-id="${escapeHtml(item.id)}">
                    <div class="travelEntryTop">
                        <div>
                            <b>${title}</b>
                            <div class="travelEntryMeta">${escapeHtml(item.date)}${timeText} · ${escapeHtml(item.payer)} · ${escapeHtml(item.method)}</div>
                            ${location}
                            ${sub ? `<div class="travelEntryMeta">${sub}</div>` : ''}
                        </div>
                        <div class="travelAmount">${escapeHtml(formatCurrencyAmount(item.currency, item.amount))}</div>
                    </div>
                    <div class="travelTags">
                        <span class="tagStatus">${status}</span>
                        <span class="tagType">${escapeHtml(type)}</span>
                        <span class="tagImpact">${escapeHtml(impactLabel)}</span>
                        ${icBalance}
                        ${confidence}
                        ${receipt}
                    </div>
                    ${item.aiNote ? `<div class="travelEntryMeta">${escapeHtml(item.aiNote)}</div>` : ''}
                    ${item.memo ? `<div class="travelEntryMeta">${escapeHtml(item.memo)}</div>` : ''}
                    <button class="travelDangerButton" type="button" data-delete="${escapeHtml(item.id)}">삭제</button>
                </article>
            `;
        }).join('');
    }

    function formPayload() {
        return {
            date: document.querySelector('#dateInput').value || todayKst(),
            payer: document.querySelector('#payerInput').value,
            memo: document.querySelector('#memoInput').value.trim(),
            receiptImage: receiptDataUrl
        };
    }

    function manualType() {
        return document.querySelector('#manualTransactionType').value || '지출';
    }

    function quickManualPayload() {
        return {
            date: document.querySelector('#quickManualDate').value || todayKst(),
            payer: document.querySelector('#quickManualPayer').value || '공금',
            text: document.querySelector('#quickManualText').value.trim()
        };
    }

    function manualMethod() {
        return document.querySelector('#manualMethod').value || '현금';
    }

    function inferManualCategory(type, method) {
        if (type === 'IC충전' || method === '교통카드') return '교통';
        if (type === '현금인출' || type === '환전' || type === '정산이동') return '기타';
        if (type === '수수료') return '기타';
        return '기타';
    }

    function inferManualItem(type, method) {
        if (type === 'IC충전') return '교통카드';
        if (method === '교통카드') return '교통카드';
        if (type === '현금인출') return '기타';
        if (type === '환전') return '기타';
        if (type === '수수료') return '기타';
        return '기타';
    }

    function manualPayload() {
        const type = manualType();
        const method = manualMethod();
        const currency = document.querySelector('#manualCurrency').value || 'JPY';
        const icBalance = number(document.querySelector('#manualIcBalance').value);
        return {
            date: document.querySelector('#manualDate').value || todayKst(),
            payer: document.querySelector('#manualPayer').value || '공금',
            transactionType: type,
            category: inferManualCategory(type, method),
            item: inferManualItem(type, method),
            method,
            currency,
            amount: document.querySelector('#manualAmount').value,
            merchant: document.querySelector('#manualMerchant').value.trim() || type,
            icCard: document.querySelector('#manualIcCard').value,
            icBalance,
            icBalanceCurrency: icBalance > 0 ? currency : '',
            memo: document.querySelector('#manualMemo').value.trim(),
            analysisStatus: '수동',
            confidence: 0
        };
    }

    function resetForm() {
        expenseForm.reset();
        document.querySelector('#dateInput').value = todayKst();
        document.querySelector('#payerInput').value = '공금';
        receiptDataUrl = '';
        receiptFileName.textContent = '선택된 사진 없음';
        photoPreview.removeAttribute('src');
        photoPreview.classList.remove('show');
    }

    function resetManualForm() {
        manualForm.reset();
        document.querySelector('#manualDate').value = todayKst();
        document.querySelector('#manualPayer').value = '공금';
        document.querySelector('#manualCurrency').value = 'JPY';
        document.querySelector('#manualMethod').value = '현금';
        document.querySelector('#manualTransactionType').value = '지출';
    }

    function resetQuickManualForm() {
        quickManualForm.reset();
        document.querySelector('#quickManualDate').value = todayKst();
        document.querySelector('#quickManualPayer').value = '공금';
    }

    function csvText() {
        const rows = [
            ['date', 'time', 'location', 'payer', 'transaction_type', 'category', 'merchant', 'item', 'currency', 'amount', 'krw', 'budget_impact_krw', 'method', 'ic_card', 'ic_balance_currency', 'ic_balance', 'status', 'confidence', 'memo', 'receipt']
        ];
        for (const item of expenses) {
            rows.push([
                item.date,
                item.paymentTime || '',
                item.location || '',
                item.payer,
                transactionType(item),
                item.category,
                item.merchant,
                item.item,
                item.currency,
                item.amount,
                Math.round(toKrw(item)),
                Math.round(budgetImpactKrw(item)),
                item.method,
                item.icCard || '',
                item.icBalanceCurrency || '',
                item.icBalance || '',
                item.analysisStatus || '',
                item.confidence || '',
                item.memo,
                item.receipt?.id ? 'yes' : ''
            ]);
        }
        return rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    }

    pinForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setPinStatus('확인 중...');
        try {
            await unlock(pinInput.value);
            setPinStatus('');
        } catch (err) {
            sessionStorage.removeItem(PIN_KEY);
            setPinStatus(err.message, 'error');
        }
    });

    expenseForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = formPayload();
        if (!payload.receiptImage) {
            showStatus('영수증 사진을 선택하세요.', 'error');
            return;
        }
        try {
            showStatus('업로드 중...');
            const data = await api('/api/travel/receipts', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            expenses = Array.isArray(data.expenses) ? data.expenses : expenses;
            resetForm();
            render();
            showStatus('업로드했습니다. AI 워커가 분석하면 자동 반영됩니다.');
        } catch (err) {
            showStatus(err.message, 'error');
        }
    });

    quickManualForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = quickManualPayload();
        if (!payload.text) {
            showStatus('거래 내용을 입력하세요.', 'error');
            return;
        }
        try {
            showStatus('문장 거래 저장 중...');
            const data = await api('/api/travel/text-expenses', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            expenses = Array.isArray(data.expenses) ? data.expenses : expenses;
            wallets = Array.isArray(data.wallets) ? data.wallets : wallets;
            resetQuickManualForm();
            render();
            showStatus('저장했습니다. AI 워커가 거래로 바꿉니다.');
        } catch (err) {
            showStatus(err.message, 'error');
        }
    });

    manualForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = manualPayload();
        if (number(payload.amount) <= 0) {
            showStatus('수동 거래 금액을 입력하세요.', 'error');
            return;
        }
        try {
            showStatus('수동 거래 저장 중...');
            const data = await api('/api/travel/expenses', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            expenses = Array.isArray(data.expenses) ? data.expenses : expenses;
            wallets = Array.isArray(data.wallets) ? data.wallets : wallets;
            resetManualForm();
            render();
            showStatus('수동 거래를 저장했습니다.');
        } catch (err) {
            showStatus(err.message, 'error');
        }
    });

    receiptInput.addEventListener('change', async () => {
        const file = receiptInput.files?.[0];
        if (!file) {
            receiptDataUrl = '';
            receiptFileName.textContent = '선택된 사진 없음';
            photoPreview.classList.remove('show');
            return;
        }
        try {
            showStatus('사진 압축 중...');
            receiptDataUrl = await compressImage(file);
            receiptFileName.textContent = file.name || '사진 선택됨';
            photoPreview.src = receiptDataUrl;
            photoPreview.classList.add('show');
            showStatus('사진 준비 완료');
        } catch (err) {
            receiptDataUrl = '';
            receiptFileName.textContent = '선택된 사진 없음';
            receiptInput.value = '';
            showStatus(err.message, 'error');
        }
    });

    walletList.addEventListener('click', async (event) => {
        const id = event.target.dataset.walletSave;
        if (!id) return;
        const card = event.target.closest('[data-wallet-id]');
        const wallet = wallets.find((item) => item.id === id);
        const input = card?.querySelector('[data-wallet-balance]');
        if (!wallet || !input) return;

        try {
            showWalletStatus('잔액 저장 중...');
            const data = await api('/api/travel/wallets/update', {
                method: 'POST',
                body: JSON.stringify({
                    ...wallet,
                    balance: input.value
                })
            });
            wallets = Array.isArray(data.wallets) ? data.wallets : wallets;
            expenses = Array.isArray(data.expenses) ? data.expenses : expenses;
            render();
            showWalletStatus('잔액 기준을 저장했습니다.');
        } catch (err) {
            showWalletStatus(err.message, 'error');
        }
    });

    travelList.addEventListener('click', async (event) => {
        const id = event.target.dataset.delete;
        if (!id) return;
        if (!confirm('이 결제 내역을 삭제할까요?')) return;
        try {
            const data = await api('/api/travel/expenses/delete', {
                method: 'POST',
                body: JSON.stringify({ id })
            });
            expenses = Array.isArray(data.expenses) ? data.expenses : [];
            render();
            showStatus('삭제했습니다.');
        } catch (err) {
            showStatus(err.message, 'error');
        }
    });

    rateInput.addEventListener('input', () => {
        localStorage.setItem(RATE_KEY, String(rate()));
        render();
    });

    document.querySelector('#exportCsvButton').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(csvText());
            showStatus('CSV를 복사했습니다.');
        } catch {
            showStatus('복사가 막혔습니다. 브라우저 권한을 확인하세요.', 'error');
        }
    });

    document.querySelector('#lockButton').addEventListener('click', () => {
        sessionStorage.removeItem(PIN_KEY);
        pin = '';
        pinInput.value = '';
        pinOverlay.classList.remove('hidden');
        expenses = [];
        wallets = [];
        render();
    });

    document.querySelector('#dateInput').value = todayKst();
    document.querySelector('#quickManualDate').value = todayKst();
    document.querySelector('#manualDate').value = todayKst();
    rateInput.value = localStorage.getItem(RATE_KEY) || '9.5';
    render();

    if (pin) {
        unlock(pin).catch(() => {
            sessionStorage.removeItem(PIN_KEY);
            pin = '';
            pinOverlay.classList.remove('hidden');
        });
    }

    window.setInterval(() => {
        if (!pin || !pinOverlay.classList.contains('hidden')) return;
        loadExpenses().catch(() => {});
    }, 15000);
})();
