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
    const receiptGalleryInput = document.querySelector('#receiptGalleryInput');
    const openCameraButton = document.querySelector('#openCameraButton');
    const closeCameraButton = document.querySelector('#closeCameraButton');
    const closeCameraTopButton = document.querySelector('#closeCameraTopButton');
    const captureShotButton = document.querySelector('#captureShotButton');
    const cameraPanel = document.querySelector('#cameraPanel');
    const cameraPreview = document.querySelector('#cameraPreview');
    const cameraCanvas = document.querySelector('#cameraCanvas');
    const quickCaptureStatus = document.querySelector('#quickCaptureStatus');
    const photoPreview = document.querySelector('#photoPreview');
    const receiptFileName = document.querySelector('#receiptFileName');
    const walletList = document.querySelector('#walletList');
    const walletStatus = document.querySelector('#walletStatus');
    const receiptModal = document.querySelector('#receiptModal');
    const modalTitle = document.querySelector('#modalTitle');
    const modalReceiptImage = document.querySelector('#modalReceiptImage');
    const modalExpenseSummary = document.querySelector('#modalExpenseSummary');
    const modalAiNote = document.querySelector('#modalAiNote');
    const modalReceiptLink = document.querySelector('#modalReceiptLink');
    const modalCloseButton = document.querySelector('#modalCloseButton');
    const receiptInputs = [receiptGalleryInput].filter(Boolean);
    const bottomNavLinks = Array.from(document.querySelectorAll('.bottomNav a'));

    let pin = sessionStorage.getItem(PIN_KEY) || '';
    let receiptDataUrl = '';
    let cameraStream = null;
    let activeReceiptId = '';
    let expenses = [];
    let wallets = [];

    const WALLET_LABELS = {
        'hana-jpy': { name: '하나머니' },
        'cash-jpy': { name: '현금' },
        'ic-jpy': { name: 'IC카드' },
        'card-jpy': { name: '신용카드' }
    };

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

    function expenseLineItems(item) {
        const list = Array.isArray(item.lineItems) ? item.lineItems : [];
        return list
            .map((line) => ({
                name: String(line?.name || '').trim(),
                amount: number(line?.amount),
                currency: line?.currency || item.currency || 'JPY',
                quantity: String(line?.quantity || '').trim()
            }))
            .filter((line) => line.name || line.amount > 0)
            .slice(0, 5);
    }

    function lineItemsHtml(item) {
        const lines = expenseLineItems(item);
        if (!lines.length) return '';
        return `
            <div class="entryItemList">
                ${lines.map((line) => {
                    const label = line.quantity ? `${line.name || '품목 확인 필요'} · ${line.quantity}` : (line.name || '품목 확인 필요');
                    const amount = line.amount > 0 ? formatCurrencyAmount(line.currency, line.amount) : '금액 확인';
                    return `
                        <div class="entryItemRow">
                            <span class="entryItemName">${escapeHtml(label)}</span>
                            <span class="entryItemAmount">${escapeHtml(amount)}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function itemFallbackText(item) {
        const text = String(item.item || '').trim();
        return text && !/분석 대기/.test(text) ? text : '';
    }

    function receiptUrl(item) {
        const id = item?.receipt?.id;
        return id ? `/api/travel/receipt/${encodeURIComponent(id)}?pin=${encodeURIComponent(pin)}` : '';
    }

    function showStatus(message, tone = '') {
        saveStatus.textContent = message;
        if (quickCaptureStatus) quickCaptureStatus.textContent = message;
        saveStatus.classList.toggle('error', tone === 'error');
        quickCaptureStatus?.classList.toggle('error', tone === 'error');
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
        if (file.type && !file.type.startsWith('image/')) {
            throw new Error('사진 파일만 가능');
        }

        let source;
        let closeSource = null;
        try {
            if (typeof createImageBitmap === 'function') {
                source = await createImageBitmap(file);
                closeSource = () => source.close?.();
            }
        } catch {
            source = null;
        }

        const rawDataUrl = source ? '' : await readFileDataUrl(file);
        if (!source) {
            try {
                source = await loadImage(rawDataUrl);
            } catch {
                if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size <= 3.4 * 1024 * 1024) {
                    return rawDataUrl;
                }
                throw new Error('사진을 읽지 못함');
            }
        }

        const maxSide = 1600;
        const sourceWidth = source.width || source.videoWidth || source.naturalWidth;
        const sourceHeight = source.height || source.videoHeight || source.naturalHeight;
        const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        closeSource?.();

        return canvas.toDataURL('image/jpeg', 0.78);
    }

    function readFileDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('사진을 읽지 못함'));
            reader.readAsDataURL(file);
        });
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('사진을 읽지 못함'));
            image.src = src;
        });
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

        if (wallet.id === 'card-jpy') {
            if (method !== '카드') return 0;
            if (type === '지출' || type === '수수료' || type === 'IC충전') return amount;
            if (type === '환급') return -amount;
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
                source: '영수증',
                sourceDetail: `${receiptBalance.item.date || ''} ${receiptBalance.item.paymentTime || ''}`.trim()
            };
        }

        if (wallet.id === 'card-jpy') {
            return {
                balance: base + delta,
                base,
                delta,
                source: '누적',
                sourceDetail: wallet.updatedAt ? '기준 이후' : '전체'
            };
        }

        return {
            balance: base + delta,
            base,
            delta,
            source: wallet.updatedAt ? '기준' : '전체',
            sourceDetail: wallet.updatedAt ? new Date(wallet.updatedAt).toLocaleString('ko-KR') : ''
        };
    }

    function renderWallets() {
        const items = wallets.length ? wallets : [
            { id: 'hana-jpy', name: '하나머니', currency: 'JPY', balance: 0 },
            { id: 'cash-jpy', name: '현금', currency: 'JPY', balance: 0 },
            { id: 'ic-jpy', name: 'IC카드', currency: 'JPY', balance: 0 },
            { id: 'card-jpy', name: '신용카드', currency: 'JPY', balance: 0 }
        ];

        walletList.innerHTML = items.map((wallet) => {
            const label = WALLET_LABELS[wallet.id] || { name: wallet.name, note: wallet.note };
            const computed = computedWallet(wallet);
            const deltaText = computed.delta ? `<div class="walletMeta">${escapeHtml(formatSignedCurrencyAmount(wallet.currency, computed.delta))}</div>` : '';
            const baseLabel = wallet.id === 'card-jpy' ? '기준 사용액' : '기준 잔액';
            return `
                <article class="walletCard" data-wallet-id="${escapeHtml(wallet.id)}">
                    <div class="walletCardTop">
                        <div>
                            <b>${escapeHtml(label.name)}</b>
                        </div>
                    </div>
                    <div class="walletBalance">${escapeHtml(formatCurrencyAmount(wallet.currency, computed.balance))}</div>
                    ${deltaText}
                    <div class="walletControls">
                        <input data-wallet-balance="${escapeHtml(wallet.id)}" type="number" inputmode="numeric" min="0" step="1" value="${escapeHtml(wallet.balance || 0)}" aria-label="${escapeHtml(label.name)} ${escapeHtml(baseLabel)}">
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
        document.querySelector('#spentMeta').textContent = movementCount
            ? `${spendingCount}건 · 이동 ${movementCount}건 · ${rate()}원`
            : `${spendingCount}건 · ${rate()}원`;
        document.querySelector('#remainTotal').textContent = formatKrw(remaining);
        document.querySelector('#entrySummary').textContent = `${expenses.length}건`;
        if (activeReceiptId) {
            const active = expenses.find((item) => item.id === activeReceiptId);
            if (active) {
                if (['분석대기', '분석중'].includes(active.analysisStatus)) showStatus('분석 중');
                if (active.analysisStatus === '분석완료') {
                    showStatus('분석 완료');
                    activeReceiptId = '';
                }
                if (['확인필요', '분석실패'].includes(active.analysisStatus)) {
                    showStatus(active.analysisStatus, active.analysisStatus === '분석실패' ? 'error' : '');
                    activeReceiptId = '';
                }
            } else {
                showStatus('저장 확인 실패', 'error');
                activeReceiptId = '';
            }
        }

        if (!expenses.length) {
            travelList.innerHTML = '<div class="travelEntry emptyEntry"><b>내역 없음</b></div>';
            return;
        }

        travelList.innerHTML = expenses.map((item) => {
            const title = escapeHtml(item.merchant || item.item || '결제 내역');
            const sub = escapeHtml(itemFallbackText(item));
            const detailRows = lineItemsHtml(item);
            const receiptImage = receiptUrl(item);
            const thumbnail = receiptImage
                ? `<button class="receiptThumb" type="button" data-receipt-modal="${escapeHtml(item.id)}" aria-label="${title} 영수증 보기"><img src="${escapeHtml(receiptImage)}" alt=""></button>`
                : '<div class="receiptThumb empty">사진</div>';
            const status = escapeHtml(item.analysisStatus || (item.amount > 0 ? '완료' : '분석대기'));
            const statusTag = ['분석대기', '문장분석대기', '분석중', '확인필요', '분석실패'].includes(item.analysisStatus)
                ? `<span class="entryStatus">${status}</span>`
                : '';
            const needsLineItemReanalysis = receiptImage
                && !expenseLineItems(item).length
                && !['분석대기', '문장분석대기', '분석중'].includes(item.analysisStatus);
            const reanalyzeButton = needsLineItemReanalysis
                ? `<button class="receiptLink aiNoteButton" type="button" data-reanalyze="${escapeHtml(item.id)}">재분석</button>`
                : '';
            const timeText = item.paymentTime ? ` ${escapeHtml(item.paymentTime)}` : '';
            const location = item.location ? `<div class="travelEntryMeta">${escapeHtml(item.location)}</div>` : '';
            const icBalance = Number(item.icBalance || 0) > 0
                ? `<div class="travelEntryMeta">${escapeHtml(item.icCard || 'IC')} 잔액 ${escapeHtml(formatCurrencyAmount(item.icBalanceCurrency || item.currency || 'JPY', item.icBalance))}</div>`
                : '';
            const type = transactionType(item);
            const typeText = type === '지출' ? '' : ` · ${escapeHtml(type)}`;
            return `
                <article class="travelEntry" data-id="${escapeHtml(item.id)}">
                    <div class="travelEntryBody">
                        ${thumbnail}
                        <div>
                            <div class="travelEntryTop">
                                <div>
                                    <b>${title}</b>
                                    <div class="travelEntryMeta">${escapeHtml(item.date)}${timeText} · ${escapeHtml(item.payer)} · ${escapeHtml(item.method)}${typeText}</div>
                                    ${location}
                                    ${icBalance}
                                    ${detailRows}
                                    ${!detailRows && sub ? `<div class="entryItemFallback">${sub}</div>` : ''}
                                </div>
                                <div class="travelAmount">${escapeHtml(formatCurrencyAmount(item.currency, item.amount))}</div>
                            </div>
                        </div>
                    </div>
                    <div class="entryFooter">
                        ${statusTag}
                        <details class="entryManage">
                            <summary>관리</summary>
                            <div class="entryMenu">
                                ${reanalyzeButton}
                                <button class="travelDangerButton" type="button" data-delete="${escapeHtml(item.id)}">삭제</button>
                            </div>
                        </details>
                    </div>
                    ${item.memo ? `<div class="travelEntryMeta">${escapeHtml(item.memo)}</div>` : ''}
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

    function quickManualLines(text) {
        return String(text || '')
            .split(/\n+/)
            .map((line) => line.replace(/^\s*[-*•]+\s*/, '').trim())
            .filter(Boolean)
            .slice(0, 20);
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
        receiptFileName.textContent = '';
        receiptInputs.forEach((input) => {
            input.value = '';
        });
        photoPreview.removeAttribute('src');
        photoPreview.classList.remove('show');
    }

    function stopCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach((track) => track.stop());
        }
        cameraStream = null;
        if (cameraPreview) cameraPreview.srcObject = null;
        cameraPanel?.classList.add('hidden');
        document.body.classList.remove('cameraOpen');
    }

    function openReceiptModal(item) {
        const imageUrl = receiptUrl(item);
        if (!receiptModal || !item || !imageUrl) return;
        modalTitle.textContent = item.merchant || item.item || '영수증';
        modalReceiptImage.src = imageUrl;
        if (modalExpenseSummary) {
            const details = lineItemsHtml(item);
            const fallback = itemFallbackText(item);
            modalExpenseSummary.innerHTML = `
                <div class="travelEntryTop">
                    <div>
                        <b>${escapeHtml(item.merchant || '상호 확인 필요')}</b>
                        <div class="travelEntryMeta">${escapeHtml(item.date || '')}${item.paymentTime ? ` ${escapeHtml(item.paymentTime)}` : ''} · ${escapeHtml(item.category || '')}</div>
                    </div>
                    <div class="travelAmount">${escapeHtml(formatCurrencyAmount(item.currency, item.amount))}</div>
                </div>
                ${details}
                ${!details && fallback ? `<div class="entryItemFallback">${escapeHtml(fallback)}</div>` : ''}
            `;
        }
        modalAiNote.textContent = item.aiNote || 'AI 코멘트 없음';
        modalReceiptLink.href = imageUrl;
        receiptModal.classList.remove('hidden');
        document.body.classList.add('cameraOpen');
    }

    function closeReceiptModal() {
        receiptModal?.classList.add('hidden');
        if (modalReceiptImage) modalReceiptImage.removeAttribute('src');
        document.body.classList.remove('cameraOpen');
    }

    function setActiveNav(targetHash = '#receiptPanel') {
        if (!bottomNavLinks.length) return;
        bottomNavLinks.forEach((link) => {
            link.classList.toggle('active', link.getAttribute('href') === targetHash);
        });
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
            ['date', 'time', 'location', 'payer', 'transaction_type', 'category', 'merchant', 'item', 'line_items', 'currency', 'amount', 'krw', 'budget_impact_krw', 'method', 'ic_card', 'ic_balance_currency', 'ic_balance', 'status', 'confidence', 'memo', 'receipt']
        ];
        for (const item of expenses) {
            const lineItemText = expenseLineItems(item)
                .map((line) => `${line.name || '품목'} ${line.amount > 0 ? formatCurrencyAmount(line.currency, line.amount) : ''}`.trim())
                .join(' / ');
            rows.push([
                item.date,
                item.paymentTime || '',
                item.location || '',
                item.payer,
                transactionType(item),
                item.category,
                item.merchant,
                item.item,
                lineItemText,
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

    async function submitReceipt() {
        const payload = formPayload();
        if (!payload.receiptImage) {
            showStatus('사진 필요', 'error');
            return;
        }
        try {
            showStatus('업로드 중');
            const data = await api('/api/travel/receipts', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            if (!data.saved?.id) throw new Error('서버 저장 실패');
            expenses = Array.isArray(data.expenses) ? data.expenses : expenses;
            activeReceiptId = data.saved?.id || '';
            resetForm();
            render();
            showStatus('업로드 완료 · 분석 중');
        } catch (err) {
            showStatus(err.message, 'error');
        }
    }

    async function openCamera() {
        if (!navigator.mediaDevices?.getUserMedia) {
            showStatus('카메라 불가', 'error');
            receiptGalleryInput?.click();
            return;
        }
        try {
            showStatus('카메라 여는 중');
            stopCamera();
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' }
                },
                audio: false
            });
            cameraPreview.srcObject = cameraStream;
            cameraPanel.classList.remove('hidden');
            document.body.classList.add('cameraOpen');
            await cameraPreview.play();
            showStatus('촬영 준비');
        } catch (err) {
            stopCamera();
            showStatus('카메라 권한 필요', 'error');
            receiptGalleryInput?.click();
        }
    }

    async function captureCameraFrame() {
        if (!cameraPreview.videoWidth || !cameraPreview.videoHeight) {
            showStatus('카메라 준비 중', 'error');
            return;
        }
        cameraCanvas.width = cameraPreview.videoWidth;
        cameraCanvas.height = cameraPreview.videoHeight;
        cameraCanvas.getContext('2d').drawImage(cameraPreview, 0, 0, cameraCanvas.width, cameraCanvas.height);
        receiptDataUrl = cameraCanvas.toDataURL('image/jpeg', 0.82);
        receiptFileName.textContent = '촬영됨';
        photoPreview.src = receiptDataUrl;
        photoPreview.classList.add('show');
        stopCamera();
        await submitReceipt();
    }

    async function handleReceiptFile(input) {
        const file = input.files?.[0];
        if (!file) {
            receiptDataUrl = '';
            receiptFileName.textContent = '';
            photoPreview.classList.remove('show');
            return;
        }
        try {
            showStatus('준비 중');
            receiptDataUrl = await compressImage(file);
            receiptFileName.textContent = file.name || '선택됨';
            photoPreview.src = receiptDataUrl;
            photoPreview.classList.add('show');
            await submitReceipt();
        } catch (err) {
            receiptDataUrl = '';
            receiptFileName.textContent = '';
            receiptInputs.forEach((item) => {
                item.value = '';
            });
            showStatus(err.message, 'error');
        }
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
        await submitReceipt();
    });

    openCameraButton?.addEventListener('click', openCamera);
    closeCameraButton?.addEventListener('click', stopCamera);
    closeCameraTopButton?.addEventListener('click', stopCamera);
    captureShotButton?.addEventListener('click', captureCameraFrame);

    quickManualForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = quickManualPayload();
        const lines = quickManualLines(payload.text);
        if (!lines.length) {
            showStatus('내용 필요', 'error');
            return;
        }
        try {
            showStatus(lines.length > 1 ? `${lines.length}건 저장 중` : '저장 중');
            let latest = null;
            for (const line of lines) {
                latest = await api('/api/travel/text-expenses', {
                    method: 'POST',
                    body: JSON.stringify({ ...payload, text: line })
                });
            }
            expenses = Array.isArray(latest?.expenses) ? latest.expenses : expenses;
            wallets = Array.isArray(latest?.wallets) ? latest.wallets : wallets;
            resetQuickManualForm();
            render();
            showStatus(lines.length > 1 ? `${lines.length}건 분석 대기` : '분석 대기');
        } catch (err) {
            showStatus(err.message, 'error');
        }
    });

    manualForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const payload = manualPayload();
        if (number(payload.amount) <= 0) {
            showStatus('금액 필요', 'error');
            return;
        }
        try {
            showStatus('저장 중');
            const data = await api('/api/travel/expenses', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            expenses = Array.isArray(data.expenses) ? data.expenses : expenses;
            wallets = Array.isArray(data.wallets) ? data.wallets : wallets;
            resetManualForm();
            render();
            showStatus('저장됨');
        } catch (err) {
            showStatus(err.message, 'error');
        }
    });

    receiptInputs.forEach((input) => {
        input.addEventListener('change', () => handleReceiptFile(input));
    });

    walletList.addEventListener('click', async (event) => {
        const id = event.target.dataset.walletSave;
        if (!id) return;
        const card = event.target.closest('[data-wallet-id]');
        const wallet = wallets.find((item) => item.id === id);
        const input = card?.querySelector('[data-wallet-balance]');
        if (!wallet || !input) return;

        try {
            showWalletStatus('저장 중');
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
            showWalletStatus('저장됨');
        } catch (err) {
            showWalletStatus(err.message, 'error');
        }
    });

    travelList.addEventListener('click', async (event) => {
        const modalId = event.target.closest('[data-receipt-modal]')?.dataset.receiptModal;
        if (modalId) {
            const item = expenses.find((expense) => expense.id === modalId);
            openReceiptModal(item);
            return;
        }
        const reanalyzeId = event.target.closest('[data-reanalyze]')?.dataset.reanalyze;
        if (reanalyzeId) {
            try {
                showStatus('재분석 대기 등록 중');
                const data = await api('/api/travel/expenses/reanalyze', {
                    method: 'POST',
                    body: JSON.stringify({ id: reanalyzeId })
                });
                expenses = Array.isArray(data.expenses) ? data.expenses : expenses;
                wallets = Array.isArray(data.wallets) ? data.wallets : wallets;
                activeReceiptId = reanalyzeId;
                render();
                showStatus('품목 재분석 대기');
            } catch (err) {
                showStatus(err.message, 'error');
            }
            return;
        }
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

    modalCloseButton?.addEventListener('click', closeReceiptModal);
    receiptModal?.addEventListener('click', (event) => {
        if (event.target === receiptModal) closeReceiptModal();
    });

    bottomNavLinks.forEach((link) => {
        link.addEventListener('click', () => setActiveNav(link.getAttribute('href')));
    });
    window.addEventListener('hashchange', () => {
        if (location.hash) setActiveNav(location.hash);
    });

    if ('IntersectionObserver' in window && bottomNavLinks.length) {
        const navTargets = bottomNavLinks
            .map((link) => document.querySelector(link.getAttribute('href')))
            .filter(Boolean);
        const navObserver = new IntersectionObserver((entries) => {
            if (location.hash && bottomNavLinks.some((link) => link.getAttribute('href') === location.hash)) {
                setActiveNav(location.hash);
                return;
            }
            const visible = entries
                .filter((entry) => entry.isIntersecting)
                .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
            if (visible?.target?.id) setActiveNav(`#${visible.target.id}`);
        }, {
            rootMargin: '-34% 0px -54% 0px',
            threshold: 0
        });
        navTargets.forEach((target) => navObserver.observe(target));
    }

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
    setActiveNav(location.hash || '#receiptPanel');
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
    }, 3000);
})();
