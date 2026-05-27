const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_URL = trimSlash(process.env.TRAVEL_BASE_URL || process.argv[2] || 'http://127.0.0.1:3101');
const PIN = String(process.env.TRAVEL_PIN || process.env.TRAVEL_PASSWORD || '1234');
const MODEL = process.env.TRAVEL_AI_MODEL || 'gpt-5.4-mini';
const POLL_MS = Math.max(5000, Number(process.env.TRAVEL_WORKER_INTERVAL_MS || 15000) || 15000);
const ONCE = process.argv.includes('--once') || process.env.TRAVEL_WORKER_ONCE === '1';
const RETRY_FAILED = process.argv.includes('--retry-failed') || process.env.TRAVEL_WORKER_RETRY_FAILED === '1';
const OAUTH_URL = trimSlash(process.env.IMA2_OAUTH_URL || readIma2OAuthUrl() || 'http://127.0.0.1:10531');
const TRAVEL_CONTEXT = process.env.TRAVEL_CONTEXT || [
    'Trip context: private family trip to Japan, 2026-06-11 to 2026-06-13.',
    'Main area: Kansai Airport, Wakayama, Shirahama, Nachi/Kii-Katsuura, possibly airport and Korea-side transit.',
    'Travelers are three adults using public transportation, taxis, buses, JR, cafes, restaurants, convenience stores, tourist sites, and occasional shopping.',
    'Hotel breakfast and dinner are mostly prepaid, so ordinary hotel meal receipts are less likely unless they are extra charges.',
    'Expected Japanese merchants/places may include Shirahama, Shirarahama, Shiraraso Grand Hotel, Kagerou Cafe, Yamanouchi, Toretore Market, Sandanbeki, Senjojiki, Engetsu Island, Nachi Falls, Kii-Katsuura, Wakayama, Kansai Airport.',
    'Korea-side receipts may be airport meals, buses, trains, taxis, or convenience stores before/after the Japan trip.',
    'Use this context to choose category and currency, but do not invent unreadable merchant names or totals.'
].join('\n');
const CATEGORY_VALUES = ['식사', '카페', '교통', '관광', '편의점', '쇼핑', '숙소', '기타'];
const ITEM_VALUES = ['아침', '점심', '저녁', '식사', '카페', '간식', '택시', '버스', 'JR/철도', '교통카드', '입장료', '온천/관광', '편의점', '기념품', '숙소 추가요금', '기타'];
const METHOD_VALUES = ['카드', '현금', '교통카드', '기타'];
const TRANSACTION_TYPE_VALUES = ['지출', '현금인출', 'IC충전', '환전', '환급', '정산이동', '수수료', '기타'];
const IC_CARD_VALUES = ['ICOCA', 'Suica', 'PASMO', 'PiTaPa', 'TOICA', 'manaca', 'Kitaca', 'SUGOCA', 'nimoca', 'はやかけん', '기타', ''];
const RECEIPT_OUTPUT_CONTRACT = [
    'Output contract:',
    'Return exactly one JSON object. Do not include markdown, comments, code fences, explanation, or extra keys.',
    'Every key below must be present and must use these exact key names and value types.',
    '{"date":"YYYY-MM-DD or empty string","paymentTime":"HH:MM or empty string","location":"visible branch/address/station/place or empty string","merchant":"visible merchant/store name or 상호 확인 필요","transactionType":"지출|현금인출|IC충전|환전|환급|정산이동|수수료|기타","category":"식사|카페|교통|관광|편의점|쇼핑|숙소|기타","item":"아침|점심|저녁|식사|카페|간식|택시|버스|JR/철도|교통카드|입장료|온천/관광|편의점|기념품|숙소 추가요금|기타","currency":"JPY|KRW","amount":integer_without_comma,"method":"카드|현금|교통카드|기타","icCard":"ICOCA|Suica|PASMO|PiTaPa|TOICA|manaca|Kitaca|SUGOCA|nimoca|はやかけん|기타|empty string","icBalance":integer_without_comma_or_0,"icBalanceCurrency":"JPY|KRW|empty string","confidence":number_0_to_1,"aiNote":"short Korean reason; mention 확인필요 if uncertain"}',
    'transactionType, category, item, currency, method, icCard, and icBalanceCurrency must be chosen only from the allowed values.',
    'amount must be a plain integer number without comma, currency symbol, or decimal.',
    'transactionType rules: ordinary purchases/fares/meals are 지출. Seven Bank ATM, ATM withdrawal, cash withdrawal, 현금화, 출금, セブン銀行 withdrawals are 현금인출. IC card recharge/top-up/charge, チャージ, 入金, 충전 are IC충전. Currency exchange/Hana Money conversion is 환전. Refunds are 환급. Standalone fees are 수수료. Money movement between wallets is 정산이동.',
    '현금인출, IC충전, 환전, and 정산이동 are fund movements, not spending. Keep the full movement amount in amount, but use the correct transactionType so the ledger excludes it from spending totals.',
    'If an ATM receipt has a separately visible fee, classify the main transaction as 현금인출 and mention the fee amount in aiNote unless the receipt is only for the fee.',
    'If the receipt shows IC card remaining balance, put the post-payment balance in icBalance. If no balance is visible, icBalance must be 0 and icBalanceCurrency must be empty string.',
    'paymentTime is the receipt transaction/payment time, not upload time. If unreadable, use empty string.',
    'location should capture branch, station, address, or place printed on the receipt when visible. If no place is visible, use empty string.',
    'merchant should be short and stable. Do not translate a readable brand/store name unless the receipt already provides Korean.',
    'item is the display label for the ledger. Prefer the most specific allowed item: 점심/저녁/카페/택시/버스/JR/철도/편의점/입장료/기념품.',
    'If total or merchant is unreadable, set confidence below 0.68 and explain in aiNote.'
].join('\n');

function trimSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function readIma2OAuthUrl() {
    try {
        const file = path.join(os.homedir(), '.ima2', 'server.json');
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return parsed?.oauth?.url || parsed?.oauthUrl || '';
    } catch {
        return '';
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(pathname, options = {}) {
    const res = await fetch(`${BASE_URL}${pathname}`, {
        ...options,
        headers: {
            'content-type': 'application/json',
            'x-travel-pin': PIN,
            ...(options.headers || {})
        }
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
    return data;
}

async function fetchReceiptDataUrl(expense) {
    const id = expense?.receipt?.id;
    if (!id) throw new Error('receipt id missing');
    const res = await fetch(`${BASE_URL}/api/travel/receipt/${encodeURIComponent(id)}?pin=${encodeURIComponent(PIN)}`);
    if (!res.ok) throw new Error(`receipt download failed: ${res.status}`);
    const mime = res.headers.get('content-type') || expense.receipt.mimeType || 'image/jpeg';
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:${mime.split(';')[0]};base64,${buffer.toString('base64')}`;
}

async function classifyReceipt(imageDataUrl, expense) {
    const developer = [
        'You classify Japanese/Korean travel receipts for a private family trip expense ledger.',
        'Return one compact JSON object only. No markdown.',
        'Use the trip context below as a bias for category, currency, and merchant interpretation, but the receipt image is the source of truth.',
        'Read the receipt image carefully. Prefer the final paid total, tax-included total, or card charge total.',
        'If the receipt has multiple totals, choose the largest final payable amount unless a lower card-charge total is clearly the actual payment.',
        'If uncertain, keep confidence below 0.7 and explain briefly in aiNote.',
        RECEIPT_OUTPUT_CONTRACT,
        `Categories must be one of: ${CATEGORY_VALUES.join(', ')}.`,
        `Items must be one of: ${ITEM_VALUES.join(', ')}.`,
        `Transaction types must be one of: ${TRANSACTION_TYPE_VALUES.join(', ')}.`,
        'Use transactionType to separate real spending from fund movements. ATM cash withdrawals, IC card top-ups, Hana Money exchange, and wallet transfers are not ordinary spending.',
        'Currency must be JPY or KRW. Japanese receipts are usually JPY.',
        `Method must be one of: ${METHOD_VALUES.join(', ')}.`,
        `IC card must be one of: ${IC_CARD_VALUES.map((value) => value || 'empty string').join(', ')}.`,
        'Use YYYY-MM-DD for date. If unreadable, use empty string.'
    ].join('\n');

    const userText = [
        'Trip context:',
        TRAVEL_CONTEXT,
        '',
        RECEIPT_OUTPUT_CONTRACT,
        '',
        'Analyze this receipt and return the JSON object now.',
        `Existing upload date: ${expense.date || ''}`,
        `Existing payer: ${expense.payer || ''}`,
        `Existing memo: ${expense.memo || ''}`
    ].join('\n');

    const body = {
        model: MODEL,
        input: [
            { role: 'developer', content: developer },
            {
                role: 'user',
                content: [
                    { type: 'input_text', text: userText },
                    { type: 'input_image', image_url: imageDataUrl }
                ]
            }
        ],
        reasoning: { effort: 'low' },
        stream: true
    };

    const text = await responses(body);
    return normalizeClassification(parseJson(text), expense);
}

async function classifyTextExpense(inputText, expense) {
    const developer = [
        'You classify casual Korean/Japanese travel expense notes into a private family trip expense ledger.',
        'Return one compact JSON object only. No markdown.',
        'The user text is the source of truth. Use the trip context only as a bias for places, categories, and likely currency.',
        'Parse casual wording such as "방금 버스 660엔 이코카", "세븐뱅크 2만엔 뽑음", "카페 2420엔 카드", or "ICOCA 3000엔 현금 충전 잔액 4500엔".',
        'If the user says 방금/지금/today without an explicit date, use the existing upload date.',
        'If the user says 엔/円, currency is JPY. If 원/KRW, currency is KRW. If currency is missing during the Japan trip, prefer JPY.',
        'For amounts like 2만엔, convert to 20000. For 3천엔, convert to 3000.',
        'If the text says 이코카/ICOCA/Suica/PASMO/IC카드로 결제, use method 교통카드 and transactionType 지출 unless it says 충전.',
        'If the text says IC카드/이코카/ICOCA 충전/top-up/チャージ, use transactionType IC충전. Use method 현금 unless the text clearly says card payment.',
        'If the text says 세븐뱅크/ATM/뽑음/출금/현금화, use transactionType 현금인출.',
        'If the text says 하나머니에서 엔화로 바꿈/환전, use transactionType 환전.',
        'If the text says 취소/환불/환급, use transactionType 환급.',
        'If a remaining IC balance is mentioned, fill icBalance and icBalanceCurrency.',
        'If uncertain, keep confidence below 0.7 and explain briefly in aiNote.',
        RECEIPT_OUTPUT_CONTRACT,
        `Categories must be one of: ${CATEGORY_VALUES.join(', ')}.`,
        `Items must be one of: ${ITEM_VALUES.join(', ')}.`,
        `Transaction types must be one of: ${TRANSACTION_TYPE_VALUES.join(', ')}.`,
        `Method must be one of: ${METHOD_VALUES.join(', ')}.`,
        `IC card must be one of: ${IC_CARD_VALUES.map((value) => value || 'empty string').join(', ')}.`
    ].join('\n');

    const userText = [
        'Trip context:',
        TRAVEL_CONTEXT,
        '',
        RECEIPT_OUTPUT_CONTRACT,
        '',
        'Classify this user-entered transaction note and return the JSON object now.',
        `Existing upload date: ${expense.date || ''}`,
        `Existing payer: ${expense.payer || ''}`,
        `User text: ${inputText}`
    ].join('\n');

    const body = {
        model: MODEL,
        input: [
            { role: 'developer', content: developer },
            { role: 'user', content: userText }
        ],
        reasoning: { effort: 'low' },
        stream: true
    };

    const text = await responses(body);
    return normalizeClassification(parseJson(text), expense);
}

async function responses(body) {
    const res = await fetch(`${OAUTH_URL}/v1/responses`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream'
        },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`AI response failed ${res.status}: ${text.slice(0, 300)}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) return readSseText(res);
    const json = await res.json();
    return json.output_text || collectOutputText(json);
}

async function readSseText(res) {
    const reader = res.body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder();
    const parts = [];
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            collectSseBlock(block, parts);
            boundary = buffer.indexOf('\n\n');
        }
    }
    collectSseBlock(buffer, parts);
    return parts.join('').trim();
}

function collectSseBlock(block, parts) {
    const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
    if (!data || data === '[DONE]') return;
    let event;
    try {
        event = JSON.parse(data);
    } catch {
        return;
    }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') parts.push(event.delta);
    if (event.type === 'response.output_text.done' && typeof event.text === 'string' && parts.length === 0) parts.push(event.text);
    if (event.type === 'response.output_item.done' && event.item?.type === 'message' && parts.length === 0) {
        parts.push(collectOutputText({ output: [event.item] }));
    }
    if (event.type === 'error') throw new Error(event.error?.message || 'AI stream error');
}

function collectOutputText(body) {
    const parts = [];
    for (const item of body.output || []) {
        for (const content of item.content || []) {
            if (typeof content.text === 'string') parts.push(content.text);
            else if (content.text?.value) parts.push(content.text.value);
            else if (typeof content.value === 'string') parts.push(content.value);
        }
    }
    return parts.join('\n').trim();
}

function parseJson(text) {
    const raw = String(text || '').trim();
    try {
        return JSON.parse(raw);
    } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) throw new Error(`AI JSON parse failed: ${raw.slice(0, 200)}`);
        return JSON.parse(match[0]);
    }
}

function clean(value, fallback = '') {
    return String(value ?? fallback).trim();
}

function normalizeEnum(value, allowed, fallback) {
    const text = clean(value);
    return allowed.includes(text) ? text : fallback;
}

function normalizeTime(value) {
    const text = clean(value);
    const match = text.match(/(\d{1,2})[:시](\d{1,2})/);
    if (!match) return '';
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeAmount(value) {
    return Math.max(0, Math.round(Number(String(value ?? '').replace(/,/g, '')) || 0));
}

function normalizeIcCard(value) {
    const text = clean(value);
    if (!text) return '';
    const lower = text.toLowerCase();
    if (/icoca|イコカ|이코카/.test(lower)) return 'ICOCA';
    if (/suica|스이카/.test(lower)) return 'Suica';
    if (/pasmo/.test(lower)) return 'PASMO';
    if (/pitapa/.test(lower)) return 'PiTaPa';
    if (/toica/.test(lower)) return 'TOICA';
    if (/manaca/.test(lower)) return 'manaca';
    if (/kitaca/.test(lower)) return 'Kitaca';
    if (/sugoca/.test(lower)) return 'SUGOCA';
    if (/nimoca/.test(lower)) return 'nimoca';
    if (/はやかけん|hayakaken/.test(lower)) return 'はやかけん';
    return IC_CARD_VALUES.includes(text) ? text : '기타';
}

function normalizeTransactionType(value, data = {}) {
    const text = clean(value);
    if (text && text !== '지출' && text !== '기타' && TRANSACTION_TYPE_VALUES.includes(text)) return text;

    const sample = [
        text,
        data.merchant,
        data.category,
        data.item,
        data.method,
        data.aiNote
    ].map((part) => clean(part).toLowerCase()).join(' ');

    if (/atm|withdraw|cash withdrawal|출금|현금인출|현금화|セブン銀行|seven bank|cash out/.test(sample)) return '현금인출';
    if (/(icoca|suica|pasmo|교통카드|ic card|交通系|乗車券)/.test(sample) && /(charge|recharge|top[- ]?up|チャージ|入金|충전)/.test(sample)) return 'IC충전';
    if (/exchange|currency exchange|환전|하나머니|hana money|両替/.test(sample)) return '환전';
    if (/refund|환급|返金|취소|取消/.test(sample)) return '환급';
    if (/fee|수수료|手数料/.test(sample)) return '수수료';
    if (/transfer|이동|정산/.test(sample)) return '정산이동';
    if (TRANSACTION_TYPE_VALUES.includes(text)) return text;
    return '지출';
}

function normalizeItem(value, category) {
    const text = clean(value);
    if (ITEM_VALUES.includes(text)) return text;

    const lower = text.toLowerCase();
    if (/breakfast|morning|朝食|아침/.test(lower)) return '아침';
    if (/lunch|昼|점심/.test(lower)) return '점심';
    if (/dinner|夕|저녁|석식/.test(lower)) return '저녁';
    if (/cafe|coffee|커피|카페|喫茶/.test(lower)) return '카페';
    if (/snack|간식|음료/.test(lower)) return '간식';
    if (/taxi|택시/.test(lower)) return '택시';
    if (/bus|버스/.test(lower)) return '버스';
    if (/jr|train|rail|철도|전철|기차/.test(lower)) return 'JR/철도';
    if (/icoca|suica|교통카드/.test(lower)) return '교통카드';
    if (/ticket|입장|입장료|admission/.test(lower)) return '입장료';
    if (/onsen|온천|관광|폭포|falls/.test(lower)) return '온천/관광';
    if (/convenience|편의점|lawson|family|7-eleven|セブン|ローソン/.test(lower)) return '편의점';
    if (/gift|souvenir|기념품/.test(lower)) return '기념품';
    if (/hotel|숙소|호텔/.test(lower)) return '숙소 추가요금';

    if (category === '식사') return '식사';
    if (category === '카페') return '카페';
    if (category === '편의점') return '편의점';
    if (category === '관광') return '온천/관광';
    if (category === '쇼핑') return '기념품';
    if (category === '숙소') return '숙소 추가요금';
    return '기타';
}

function normalizeClassification(data, expense) {
    const amount = normalizeAmount(data.amount);
    const currency = clean(data.currency, 'JPY').toUpperCase() === 'KRW' ? 'KRW' : 'JPY';
    const confidence = Math.max(0, Math.min(1, Number(data.confidence) || 0));
    const category = normalizeEnum(data.category, CATEGORY_VALUES, '기타');
    const item = normalizeItem(data.item, category);
    const method = normalizeEnum(data.method, METHOD_VALUES, '카드');
    const transactionType = normalizeTransactionType(data.transactionType, data);
    const icCard = normalizeIcCard(data.icCard);
    const icBalance = normalizeAmount(data.icBalance);
    const icBalanceCurrency = icBalance > 0
        ? (clean(data.icBalanceCurrency, currency).toUpperCase() === 'KRW' ? 'KRW' : 'JPY')
        : '';
    const status = amount > 0 && confidence >= 0.68 ? '분석완료' : '확인필요';
    return {
        id: expense.id,
        date: /^\d{4}-\d{2}-\d{2}$/.test(clean(data.date)) ? clean(data.date) : expense.date,
        payer: expense.payer || '공금',
        category,
        merchant: clean(data.merchant, '상호 확인 필요').slice(0, 80),
        item,
        currency,
        amount,
        paymentTime: normalizeTime(data.paymentTime),
        location: clean(data.location, '').slice(0, 120),
        method,
        transactionType,
        icCard,
        icBalance,
        icBalanceCurrency,
        memo: expense.memo || '',
        analysisStatus: status,
        confidence,
        aiNote: clean(data.aiNote, status === '확인필요' ? '금액 또는 상호 확인 필요' : 'AI 자동 판독').slice(0, 300),
        aiRaw: data
    };
}

async function markFailed(expense, error) {
    await api('/api/travel/expenses/update', {
        method: 'POST',
        body: JSON.stringify({
            id: expense.id,
            date: expense.date,
            payer: expense.payer,
            category: expense.category || '기타',
            merchant: expense.merchant || '',
            item: expense.item || '영수증 AI 분석 실패',
            currency: expense.currency || 'JPY',
            amount: expense.amount || 0,
            paymentTime: expense.paymentTime || '',
            location: expense.location || '',
            method: expense.method || '카드',
            transactionType: expense.transactionType || '지출',
            icCard: expense.icCard || '',
            icBalance: expense.icBalance || 0,
            icBalanceCurrency: expense.icBalanceCurrency || '',
            memo: expense.memo || '',
            analysisStatus: '분석실패',
            confidence: 0,
            aiNote: String(error?.message || error).slice(0, 300),
            aiRaw: { error: String(error?.stack || error).slice(0, 1200) }
        })
    });
}

async function processOne(expense) {
    console.log(`[travel-worker] analyzing ${expense.id} ${expense.date}`);
    try {
        await api('/api/travel/expenses/update', {
            method: 'POST',
            body: JSON.stringify({ ...expense, analysisStatus: '분석중', aiNote: '로컬 AI 워커 분석 중' })
        });
        const textInput = clean(expense.aiRaw?.inputText || expense.memo || '');
        const classified = expense.analysisStatus === '문장분석대기' && textInput
            ? await classifyTextExpense(textInput, expense)
            : await classifyReceipt(await fetchReceiptDataUrl(expense), expense);
        await api('/api/travel/expenses/update', {
            method: 'POST',
            body: JSON.stringify(classified)
        });
        console.log(`[travel-worker] done ${expense.id}: ${classified.transactionType} ${classified.currency} ${classified.amount} ${classified.category} ${classified.merchant}`);
    } catch (error) {
        console.error(`[travel-worker] failed ${expense.id}:`, error.message || error);
        await markFailed(expense, error).catch((err) => console.error('[travel-worker] failed to mark error:', err.message || err));
    }
}

async function tick() {
    const data = await api('/api/travel/expenses');
    const expenses = Array.isArray(data.expenses) ? data.expenses : [];
    const now = Date.now();
    const pending = expenses.filter((item) => {
        if (item.receipt?.id && item.analysisStatus === '분석대기') return true;
        if (!item.receipt?.id && item.analysisStatus === '문장분석대기') return true;
        if (item.analysisStatus === '분석중') {
            const updated = Date.parse(item.updatedAt || item.createdAt || '');
            return Number.isFinite(updated) && now - updated > 60 * 1000;
        }
        if (!RETRY_FAILED || item.analysisStatus !== '분석실패') return false;
        return Boolean(item.receipt?.id || item.aiRaw?.inputText || item.memo);
    });
    if (!pending.length) {
        console.log(`[travel-worker] no pending receipts (${new Date().toLocaleTimeString()})`);
        return;
    }
    for (const expense of pending) await processOne(expense);
}

async function main() {
    console.log(`[travel-worker] base=${BASE_URL}`);
    console.log(`[travel-worker] oauth=${OAUTH_URL}`);
    console.log(`[travel-worker] model=${MODEL}`);
    do {
        try {
            await tick();
        } catch (error) {
            console.error('[travel-worker] tick failed:', error.message || error);
        }
        if (ONCE) break;
        await sleep(POLL_MS);
    } while (true);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
