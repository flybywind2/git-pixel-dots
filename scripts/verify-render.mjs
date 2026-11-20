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
  const editor = page.getByRole('textbox', { name: '회의록.md', exact: true });
  const guide = page.getByTestId('guided-command');
  const comparison = page.getByRole('region', { name: '변경 비교', exact: true });
  const diff = comparison.getByRole('list', { name: '회의록.md 변경 내용', exact: true });
  const original = await editor.inputValue();

  assert.equal(await page.getByTestId('terminal-input').isVisible(), false);
  await guide.click();
  assert(await editor.evaluate((node) => node === document.activeElement));
  await editor.fill(original.replace('금요일 저녁 7시', '수요일 오후 2시'));
  assert.equal(await guide.innerText(), '문서 저장');

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
  await page.getByText('실수로 넣은 테스트 코드', { exact: false }).first().waitFor();
  const input = await openTerminal(page);
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
  const canvas = page.getByTestId('pixel-stage-canvas');
  assert.equal(await canvas.getAttribute('role'), 'img');
  await page.evaluate(() => document.fonts.ready);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const still = await canvas.evaluate((element) => element.toDataURL());
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await canvas.evaluate((element) => element.toDataURL()), still, 'Canvas moves with reduced motion enabled');
  await checkViewport(page);
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
      await terminalAndScenes(page, url);
      assert.deepEqual(errors, []);
      console.log(`[QA] ${width} × ${height} · document, persistence, reset, autocomplete and reduced motion`);
      await page.close();
    }

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
