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
        'Read the receipt image carefully. Prefer the final paid total, tax-included total, or card charge total.',
        'If the receipt has multiple totals, choose the largest final payable amount unless a lower card-charge total is clearly the actual payment.',
        'If uncertain, keep confidence below 0.7 and explain briefly in aiNote.',
        'Categories must be one of: 식사, 카페, 교통, 관광, 편의점, 쇼핑, 숙소, 기타.',
        'Currency must be JPY or KRW. Japanese receipts are usually JPY.',
        'Method must be one of: 카드, 현금, 교통카드, 기타.',
        'Use YYYY-MM-DD for date. If unreadable, use empty string.'
    ].join('\n');

    const userText = [
        'Analyze this receipt and output JSON with these keys:',
        'date, merchant, category, item, currency, amount, method, confidence, aiNote.',
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

function normalizeClassification(data, expense) {
    const amount = Math.max(0, Math.round(Number(String(data.amount ?? '').replace(/,/g, '')) || 0));
    const categories = new Set(['식사', '카페', '교통', '관광', '편의점', '쇼핑', '숙소', '기타']);
    const methods = new Set(['카드', '현금', '교통카드', '기타']);
    const currency = clean(data.currency, 'JPY').toUpperCase() === 'KRW' ? 'KRW' : 'JPY';
    const confidence = Math.max(0, Math.min(1, Number(data.confidence) || 0));
    const category = categories.has(clean(data.category)) ? clean(data.category) : '기타';
    const method = methods.has(clean(data.method)) ? clean(data.method) : '카드';
    const status = amount > 0 && confidence >= 0.68 ? '분석완료' : '확인필요';
    return {
        id: expense.id,
        date: /^\d{4}-\d{2}-\d{2}$/.test(clean(data.date)) ? clean(data.date) : expense.date,
        payer: expense.payer || '공금',
        category,
        merchant: clean(data.merchant, '상호 확인 필요').slice(0, 80),
        item: clean(data.item, `${category} 영수증`).slice(0, 120),
        currency,
        amount,
        method,
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
            method: expense.method || '카드',
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
        const dataUrl = await fetchReceiptDataUrl(expense);
        const classified = await classifyReceipt(dataUrl, expense);
        await api('/api/travel/expenses/update', {
            method: 'POST',
            body: JSON.stringify(classified)
        });
        console.log(`[travel-worker] done ${expense.id}: ${classified.currency} ${classified.amount} ${classified.category} ${classified.merchant}`);
    } catch (error) {
        console.error(`[travel-worker] failed ${expense.id}:`, error.message || error);
        await markFailed(expense, error).catch((err) => console.error('[travel-worker] failed to mark error:', err.message || err));
    }
}

async function tick() {
    const data = await api('/api/travel/expenses');
    const expenses = Array.isArray(data.expenses) ? data.expenses : [];
    const pending = expenses.filter((item) => {
        if (!item.receipt?.id) return false;
        if (item.analysisStatus === '분석대기') return true;
        return RETRY_FAILED && item.analysisStatus === '분석실패';
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
