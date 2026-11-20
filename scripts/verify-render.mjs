import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';

const DIST_DIR = path.resolve('dist');
const OUT_DIR = path.resolve('qa-screenshots');
const SUBPATH = '/git-pixel-dots';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      const p = decodeURIComponent(u.pathname);
      if (p === SUBPATH) {
        res.writeHead(301, { Location: `${SUBPATH}/` });
        res.end();
        return;
      }
      if (!p.startsWith(`${SUBPATH}/`)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const rel = p.slice(SUBPATH.length + 1) || 'index.html';
      const file = path.resolve(DIST_DIR, rel);
      if (!file.startsWith(DIST_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}${SUBPATH}/` });
    });
  });
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { server, url } = await startServer();
  const consoleErrors = [];
  const pageErrors = [];
  const failedReqs = [];
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('response', (r) => {
      if (r.status() >= 400 && r.url().startsWith('http://127.0.0.1')) {
        failedReqs.push(`HTTP ${r.status()} ${r.url()}`);
      }
    });

    // 1. Ch1 initial + live terminal animation (git add . -> git commit)
    await page.goto(`${url}#/ch1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas', { timeout: 10000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT_DIR, '01-ch1-start.png') });

    const input = page.locator('input[data-testid="terminal-input"]');
    await input.fill('git add .');
    await input.press('Enter');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT_DIR, '02-ch1-after-add.png') });

    await input.fill('git commit -m "첫 세이브"');
    await input.press('Enter');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT_DIR, '03-ch1-after-commit.png') });

    // 2. Ch3 merge conflict & speech bubble
    await page.goto(`${url}#/ch3`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await input.fill('git merge feature/ui');
    await input.press('Enter');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT_DIR, '04-ch3-conflict.png') });

    // 3. Ch5 gh CLI
    await page.goto(`${url}#/ch5`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await input.fill('gh pr create --title "다크모드"');
    await input.press('Enter');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT_DIR, '05-ch5-gh-cli.png') });

    // 4. Ch6 Classic vs Fine-Grained Token
    await page.goto(`${url}#/ch6`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await input.fill('token fine');
    await input.press('Enter');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT_DIR, '06-ch6-token.png') });

    // 5. Ch7 GHES Castle
    await page.goto(`${url}#/ch7`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await input.fill('ghes test-public');
    await input.press('Enter');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT_DIR, '07-ch7-ghes.png') });

    // 6. Ch8 AI Agent Worktree & PR
    await page.goto(`${url}#/ch8`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await input.fill('git worktree add wt-ai -b ai/fix');
    await input.press('Enter');
    await page.waitForTimeout(800);
    await input.fill('ai pr');
    await input.press('Enter');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT_DIR, '08-ch8-ai-agent.png') });

    const canvasMetrics = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height) };
    });
    console.log('[QA] Canvas:', canvasMetrics);
    if (!canvasMetrics || canvasMetrics.width < 600 || canvasMetrics.height < 350) {
      throw new Error(`Canvas too small: ${JSON.stringify(canvasMetrics)}`);
    }
    if (consoleErrors.length || pageErrors.length || failedReqs.length) {
      console.error({ consoleErrors, pageErrors, failedReqs });
      process.exit(1);
    }
    console.log('[QA] PASSED: All 8 Pixel-Dots captures green with 0 errors!');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error('[QA] FAILED:', err);
  process.exit(1);
});
