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
    const travelList = document.querySelector('#travelList');
    const rateInput = document.querySelector('#rateInput');
    const saveStatus = document.querySelector('#saveStatus');
    const receiptInput = document.querySelector('#receiptInput');
    const photoPreview = document.querySelector('#photoPreview');

    let pin = sessionStorage.getItem(PIN_KEY) || '';
    let receiptDataUrl = '';
    let expenses = [];

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

    function formatCurrencyAmount(currency, amount) {
        const value = Number(amount || 0).toLocaleString('ko-KR');
        return `${currency || 'JPY'} ${value}`;
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

    function render() {
        const spent = expenses.reduce((sum, item) => sum + toKrw(item), 0);
        const remaining = BUDGET_KRW - FIXED_TOTAL_KRW - spent;
        document.querySelector('#spentTotal').textContent = formatKrw(spent);
        document.querySelector('#spentMeta').textContent = `${expenses.length}건 · 환율 ${rate()}원`;
        document.querySelector('#remainTotal').textContent = formatKrw(remaining);
        document.querySelector('#entrySummary').textContent = `${expenses.length}건`;

        if (!expenses.length) {
            travelList.innerHTML = '<div class="travelEntry"><b>아직 등록된 결제 내역이 없습니다.</b><div class="travelEntryMeta">여행 중 영수증을 찍고 금액을 넣으면 여기에 쌓입니다.</div></div>';
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
                        <span>${status}</span>
                        <span>${escapeHtml(item.category)}</span>
                        <span>${formatKrw(toKrw(item))}</span>
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

    function resetForm() {
        expenseForm.reset();
        document.querySelector('#dateInput').value = todayKst();
        document.querySelector('#payerInput').value = '공금';
        receiptDataUrl = '';
        photoPreview.removeAttribute('src');
        photoPreview.classList.remove('show');
    }

    function csvText() {
        const rows = [
            ['date', 'time', 'location', 'payer', 'category', 'merchant', 'item', 'currency', 'amount', 'krw', 'method', 'ic_card', 'ic_balance_currency', 'ic_balance', 'status', 'confidence', 'memo', 'receipt']
        ];
        for (const item of expenses) {
            rows.push([
                item.date,
                item.paymentTime || '',
                item.location || '',
                item.payer,
                item.category,
                item.merchant,
                item.item,
                item.currency,
                item.amount,
                Math.round(toKrw(item)),
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

    receiptInput.addEventListener('change', async () => {
        const file = receiptInput.files?.[0];
        if (!file) {
            receiptDataUrl = '';
            photoPreview.classList.remove('show');
            return;
        }
        try {
            showStatus('사진 압축 중...');
            receiptDataUrl = await compressImage(file);
            photoPreview.src = receiptDataUrl;
            photoPreview.classList.add('show');
            showStatus('사진 준비 완료');
        } catch (err) {
            receiptDataUrl = '';
            receiptInput.value = '';
            showStatus(err.message, 'error');
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
        render();
    });

    document.querySelector('#dateInput').value = todayKst();
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
