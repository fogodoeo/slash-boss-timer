const { spawnSync } = require('node:child_process');

const truthy = new Set(['1', 'true', 'yes', 'y', 'on']);
const skipDownload = truthy.has(
    String(process.env.PUPPETEER_SKIP_DOWNLOAD || '').trim().toLowerCase()
);
const isRender = Boolean(
    process.env.RENDER ||
    process.env.RENDER_SERVICE_ID ||
    process.env.RENDER_EXTERNAL_URL
);

if (skipDownload || !isRender) {
    console.log('[postinstall] Render Chrome download skipped');
    process.exit(0);
}

console.log('[postinstall] Installing Chrome for the Render BAND monitor');
const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(
    executable,
    ['puppeteer', 'browsers', 'install', 'chrome'],
    { stdio: 'inherit' }
);

if (result.error) {
    console.error(`[postinstall] Chrome installation failed: ${result.error.message}`);
    process.exit(1);
}
process.exit(result.status ?? 1);
