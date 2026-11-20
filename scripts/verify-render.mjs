import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const dist = path.resolve('dist');
const out = path.resolve('qa-screenshots');
const subpath = '/git-pixel-dots/';
const publicUrl = process.env.GITDOTS_PUBLIC_URL;
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

async function startServer() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const relative = pathname.startsWith(subpath) ? pathname.slice(subpath.length) || 'index.html' : '';
    const candidate = relative ? path.resolve(dist, relative) : '';
    const valid = candidate.startsWith(dist + path.sep) &&
      fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    const file = valid ? candidate : path.join(dist, '404.html');
    res.writeHead(valid ? 200 : 404, {
      'Content-Type': contentTypes[path.extname(file)] ?? 'application/octet-stream',
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}${subpath}` };
}

function trackErrors(page, origin) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => {
    if (new URL(response.url()).origin === origin && response.status() >= 400) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  return errors;
}

async function checkViewport(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page overflows horizontally');
}

async function openTerminal(page) {
  const input = page.getByTestId('terminal-input');
  if (!await input.isVisible()) await page.getByRole('button', { name: '직접 입력해 보기', exact: true }).click();
  return input;
}

async function runCommand(page, command) {
  const input = await openTerminal(page);
  await input.fill(command);
  await input.press('Enter');
}

async function expectProgress(page, current, total) {
  assert.equal(await page.getByTestId('stage-step-badge').innerText(), `실습 ${current}/${total} 완료`);
}

async function openChapter(page, url, number) {
  await page.goto(`${url}#/chapter/${number}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('stage-step-badge').waitFor();
}

async function documentLesson(page, url, capture) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  assert.equal(response?.status(), 200);
  await page.waitForURL('**/#/chapter/1');
  assert.equal(await page.title(), 'GitDots · 회의록으로 연습하는 Git');
  const editor = page.getByRole('textbox', { name: '회의록.md', exact: true });
  const guide = page.getByTestId('guided-command');
  const comparison = page.getByRole('region', { name: '변경 비교', exact: true });
  const diff = comparison.getByRole('list', { name: '회의록.md 변경 내용', exact: true });
  const original = await editor.inputValue();

  assert.equal(await page.getByTestId('terminal-input').isVisible(), false);
  await guide.click();
  assert(await editor.evaluate((node) => node === document.activeElement));
  const edited = original.replace('금요일 저녁 7시', '수요일 오후 2시');
  await editor.fill(edited);
  assert.equal(await guide.innerText(), '문서 저장');

  const example = page.getByRole('button', { name: '예시 수정 넣기', exact: true });
  const replace = page.getByRole('dialog', { name: '예시 문장으로 바꿀까요?' });
  await example.click();
  await replace.getByRole('button', { name: '취소', exact: true }).click();
  assert.equal(await editor.inputValue(), edited);
  await example.click();
  await replace.getByRole('button', { name: '예시로 바꾸기', exact: true }).click();
  assert.match(await editor.inputValue(), /토요일 오전 10시/);
  await expectProgress(page, 0, 6);
  await editor.fill(edited);

  await runCommand(page, 'git add 회의록.md');
  await page.getByText('먼저 문서를 저장하세요.', { exact: false }).waitFor();
  await expectProgress(page, 0, 6);
  await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
  await guide.click();
  await expectProgress(page, 1, 6);

  await comparison.getByRole('button', { name: '스테이징', exact: true }).click();
  await expectProgress(page, 1, 6);
  assert.equal(await guide.innerText(), '바뀐 줄 확인하기');
  await guide.click();
  await expectProgress(page, 2, 6);
  await diff.getByText('다음 모임은 수요일 오후 2시예요.', { exact: false }).waitFor();
  await checkViewport(page);
  if (capture) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, capture), fullPage: true });
  }

  for (let step = 3; step <= 6; step++) {
    await guide.click();
    await expectProgress(page, step, 6);
  }
  await page.getByRole('button', { name: '마지막 변경 취소해 보기', exact: true }).click();
  assert.equal(await editor.inputValue(), original);

  const draft = original + '여기까지 작성했어요.\n';
  await editor.fill(draft);
  const chapterMenu = page.getByRole('combobox', { name: '학습할 장 선택', exact: true });
  if (await chapterMenu.isVisible()) {
    await chapterMenu.selectOption('ch2');
    await page.waitForURL('**/#/chapter/3');
    await chapterMenu.selectOption('docs');
    await page.waitForURL('**/#/chapter/1');
    assert.equal(await editor.inputValue(), draft);
  }
  await page.goto(`${url}#/ch1`);
  await page.waitForURL('**/#/chapter/2');
  await page.getByRole('heading', { name: '변경 사항을 커밋하고 공유하기', exact: true }).waitFor();
  for (const label of ['공유할 변경 담기', '기록 남기기', '팀에 공유하기']) {
    await page.getByRole('button', { name: label, exact: true }).click();
  }
  await expectProgress(page, 3, 3);
  await page.goto(`${url}#/docs`);
  await page.waitForURL('**/#/chapter/1');
  await page.reload();
  assert.equal(await editor.inputValue(), draft);
  await expectProgress(page, 6, 6);

  await page.getByRole('button', { name: '현재 장 초기화', exact: true }).click();
  const reset = page.getByRole('dialog');
  await reset.getByRole('button', { name: '취소', exact: true }).click();
  assert.equal(await editor.inputValue(), draft);
  await page.getByRole('button', { name: '현재 장 초기화', exact: true }).click();
  await reset.getByRole('button', { name: '현재 장 초기화', exact: true }).click();
  assert.equal(await editor.inputValue(), original);
  await expectProgress(page, 0, 6);
}

async function terminalAndScenes(page, url) {
  await openChapter(page, url, 3);
  const history = page.getByRole('list', { name: '최근 커밋', exact: true });
  await history.getByText('실수로 넣은 테스트 코드', { exact: false }).waitFor();
  assert.deepEqual(await history.locator('code').allTextContents(), ['1a2b3c4', '4d5e6f7', '7e8f9a0']);
  const input = await openTerminal(page);
  await history.scrollIntoViewIfNeeded();
  const historyBox = await history.boundingBox();
  const terminalBox = await page.getByRole('region', { name: '실습 터미널' }).boundingBox();
  assert(historyBox.y + historyBox.height <= terminalBox.y + 1, 'Terminal overlaps commit history');
  await input.fill('git');
  await input.press('Tab');
  const first = await input.inputValue();
  await input.press('Tab');
  assert.notEqual(await input.inputValue(), first);
  await page.getByRole('listbox', { name: '자동완성 후보' }).getByRole('option', { selected: true }).waitFor();
  await input.press('Escape');
  assert.equal(await input.getAttribute('aria-expanded'), 'false');

  await runCommand(page, 'git reset --hard HEAD~2');
  const choice = page.getByRole('dialog');
  await choice.getByText('커밋하지 않은 변경이 사라질 수 있어요.', { exact: false }).waitFor();
  await choice.getByRole('button', { name: '취소', exact: true }).click();
  await runCommand(page, 'git reset --hard HEAD~2');
  await choice.getByRole('button', { name: '대상 커밋으로 복원', exact: true }).click();
  await runCommand(page, 'git show HEAD:app.js');
  await page.getByRole('log').getByText('// 프로젝트 시작', { exact: true }).waitFor();

  await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openChapter(page, url, 4);
  await page.getByTestId('guided-command').click();
  await page.getByTestId('guided-command').click();
  await page.getByRole('button', { name: '상대 브랜치 내용 사용', exact: true }).waitFor();
  const bubble = page.getByTestId('speech-bubble');
  assert.match(await bubble.innerText(), /아래 버튼에서 남길 내용을 고르세요/);
  const lastMessage = await bubble.innerText();
  await page.reload();
  assert.equal(await bubble.innerText(), lastMessage);
  const canvas = page.getByTestId('pixel-stage-canvas');
  assert.equal(await canvas.getAttribute('role'), 'img');
  await page.evaluate(() => document.fonts.ready);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const still = await canvas.evaluate((element) => element.toDataURL());
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await canvas.evaluate((element) => element.toDataURL()), still, 'Canvas moves with reduced motion enabled');
  await checkViewport(page);
}

async function practiceTracks(page, url) {
  await openChapter(page, url, 3);
  for (const label of ['작업 임시 보관', '지난 변경 취소', '보관한 작업 복원']) {
    await page.getByRole('button', { name: label, exact: true }).click();
  }
  await page.getByTestId('next-chapter-btn').click();
  await page.waitForURL('**/#/chapter/5');
  await page.getByText('GitHub 웹에서 이어 하기', { exact: true }).click();
  await page.getByText('Create pull request', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'GitHub 문서 편집 도움말' }).waitFor();
  const advanced = page.getByRole('combobox', { name: '심화 실습 선택', exact: true });
  await advanced.selectOption('ch8');
  await page.waitForURL('**/#/chapter/9');
  const nav = await page.getByRole('navigation', { name: '학습 장' }).boundingBox();
  assert(nav.height <= 35, 'Chapter navigation wraps on desktop');

  await page.evaluate(() => {
    const key = 'gitdots.practice.v1.ch2';
    const legacy = JSON.parse(localStorage.getItem(key));
    legacy.sim.bubbles = [];
    localStorage.setItem(key, JSON.stringify(legacy));
  });
  await openChapter(page, url, 3);
  await page.reload();
  await expectProgress(page, 3, 3);
  await page.getByTestId('speech-bubble').getByText('이 장의 실습을 마쳤어요').waitFor();
}

async function mobileCanvasAndKeyboard(browser, url) {
  const page = await browser.newPage({
    viewport: { width: 360, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce',
  });
  let releaseFont;
  const fontGate = new Promise((resolve) => { releaseFont = resolve; });
  try {
    await page.route('**/GitDotsPixel-Regular-*.woff2', async (route) => {
      await fontGate;
      await route.continue();
    });
    await page.addInitScript(() => {
      window.sampledLabels = new Map();
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
        const transform = this.getTransform();
        const size = Number(/([\d.]+)px/.exec(this.font)?.[1]);
        const scale = transform.a / Math.min(devicePixelRatio, 2);
        window.sampledLabels.set(text, { size: size * scale, font: this.font, maxWidth });
        return original.apply(this, arguments);
      };
    });
    await openChapter(page, url, 2);
    await page.waitForFunction(() => window.sampledLabels.has('스테이징'), undefined, { timeout: 9000 });
    const canvas = page.getByTestId('pixel-stage-canvas');
    const before = await canvas.evaluate((element) => element.toDataURL());
    releaseFont();
    await page.waitForFunction((previous) => {
      const font = [...document.fonts].find((item) => item.family.replaceAll('"', '') === 'GitDots Pixel');
      return font?.status === 'loaded' && document.querySelector('canvas').toDataURL() !== previous;
    }, before, { timeout: 9000 });
    await openChapter(page, url, 4);
    await page.waitForFunction(() => window.sampledLabels.has('10aa20b'), undefined, { timeout: 9000 });
    const labels = await page.evaluate(() => Array.from(window.sampledLabels));
    for (const entry of ['10aa20b', '30cc40d', '50ee60f', 'HEAD · main', 'feature/ui']) {
      assert(labels.some(([label]) => label === entry), `Missing canvas label ${entry}`);
    }
    for (const [label, { size, font, maxWidth }] of labels) {
      assert(size >= 11.99, `${label} renders below 12 CSS px`);
      assert(!/\b(?:bold|[5-9]00)\b/.test(font), `${label} uses a synthetic weight`);
      assert.equal(maxWidth, undefined, `${label} can be horizontally compressed`);
    }

    await openChapter(page, url, 3);
    const input = await openTerminal(page);
    await input.focus();
    const log = page.getByRole('log', { name: '명령 실행 결과' });
    for (const [width, height] of [[360, 350], [320, 270]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction((size) => document.querySelector('.practice-shell').clientHeight === size, height);
      await runCommand(page, 'git log --oneline');
      const result = log.getByText(/1a2b3c4/).last();
      await result.waitFor();
      const resultBox = await result.boundingBox();
      const logBox = await log.boundingBox();
      const promptBox = await input.boundingBox();
      const viewportBottom = await page.evaluate(() => visualViewport.height + visualViewport.offsetTop);
      assert(logBox.height >= 32 && logBox.y + logBox.height < promptBox.y, 'Output loses its space above the input');
      assert(resultBox.y >= logBox.y && resultBox.y + resultBox.height <= logBox.y + logBox.height, 'Latest result is out of view');
      assert(promptBox.y + promptBox.height <= viewportBottom + 1, 'Input is hidden by the keyboard-sized viewport');
    }
  } finally {
    releaseFont();
    await page.close();
  }
}

async function revertConflict(page) {
  const editor = page.getByRole('textbox', { name: '회의록.md', exact: true });
  const original = await editor.inputValue();
  const first = original.replace('금요일 저녁 7시', '일요일 저녁 7시');
  const second = first.replace('1층 회의실', '도서관');
  for (const text of [first, second]) {
    await editor.fill(text);
    await page.getByTestId('guided-command').click();
    await runCommand(page, 'git add 회의록.md');
    await runCommand(page, 'git commit -m "회의록 수정"');
    await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
  }
  await runCommand(page, 'git revert HEAD~1');
  await page.getByRole('heading', { name: '커밋 취소 중 변경이 겹쳤어요', exact: true }).waitFor();
  assert((await editor.inputValue()).includes('<<<<<<< HEAD'));
  await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
  await page.getByRole('button', { name: '취소 작업 중단', exact: true }).click();
  assert.equal(await editor.inputValue(), second);

  await runCommand(page, 'git revert HEAD~1');
  await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
  await page.getByRole('button', { name: '이전 버전 사용', exact: true }).click();
  await page.getByRole('button', { name: '취소 커밋 기록하기', exact: true }).click();
  assert.equal(await editor.inputValue(), original);
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const local = publicUrl ? undefined : await startServer();
  const url = publicUrl ?? local.url;
  const origin = new URL(url).origin;
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    for (const [width, height] of [[1366, 860], [390, 760], [320, 568]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.setDefaultTimeout(9000);
      const errors = trackErrors(page, origin);
      await documentLesson(page, url, width === 1366 ? '01-documents.png' : undefined);
      if (width === 1366) await revertConflict(page);
      await terminalAndScenes(page, url);
      assert.deepEqual(errors, []);
      console.log(`[QA] ${width} × ${height} · document, persistence, reset, autocomplete and reduced motion`);
      await page.close();
    }

    const trackPage = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await practiceTracks(trackPage, url);
    await trackPage.close();
    await mobileCanvasAndKeyboard(browser, url);
    console.log('[QA] Course navigation, web guide, legacy saves, delayed fonts and mobile keyboard-sized viewport passed');

    const link = await browser.newPage();
    await link.goto(url + 'docs/deeper/');
    await link.waitForURL('**/#/chapter/1');
    await link.getByRole('textbox', { name: '회의록.md', exact: true }).waitFor();
    await link.goto(url + 'chapter/9/');
    await link.waitForURL('**/#/chapter/9');
    const share = await link.request.get(url + 'share.jpg');
    assert.equal(share.status(), 200);
    assert.equal(share.headers()['content-type'], 'image/jpeg');
    const noScript = await browser.newPage({ javaScriptEnabled: false });
    await noScript.goto(url);
    await noScript.getByRole('link', { name: '실습 안내 읽기', exact: true }).waitFor();
    console.log('[QA] Nested route recovery passed');
  } finally {
    await browser?.close();
    if (local) await new Promise((resolve) => local.server.close(resolve));
  }
}

main().catch((error) => {
  console.error('[QA] FAILED', error);
  process.exitCode = 1;
});
