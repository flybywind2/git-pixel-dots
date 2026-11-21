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

async function expectQuickAction(page, label, command) {
  const quickActions = page.getByRole('group', { name: '빠른 실행', exact: true });
  assert.equal(await quickActions.getByRole('button', { name: label, exact: true }).getAttribute('title'), command);
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
  const editorFont = await editor.evaluate((node) => getComputedStyle(node).fontSize);
  assert.equal(editorFont, page.viewportSize().width < 640 ? '16px' : '14px');

  assert.equal(await page.getByTestId('terminal-input').isVisible(), false);
  await guide.click();
  assert(await editor.evaluate((node) => node === document.activeElement));
  const edited = original.replace('금요일 저녁 7시', '수요일 오후 2시');
  await editor.fill(edited);
  assert.equal(await guide.innerText(), '문서 저장하기');

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
  await expectQuickAction(page, '다음 기록에 담기', 'git add 회의록.md');
  await expectQuickAction(page, '기록 남기기', 'git commit -m "모임 안내 수정"');
  await page.getByText('먼저 문서를 저장하세요.', { exact: false }).waitFor();
  await expectProgress(page, 0, 6);
  await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
  await guide.click();
  await expectProgress(page, 1, 6);

  await comparison.getByRole('button', { name: '담아 둔 변경', exact: true }).click();
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
  await openTerminal(page);
  await expectQuickAction(page, '다음 기록에 담기', 'git add .');
  await expectQuickAction(page, '팀에 공유하기', 'git push');
  for (const label of ['다음 기록에 담기', '기록 남기기', '팀에 공유하기']) {
    assert.equal(await guide.innerText(), label);
    await guide.click();
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
  await history.getByText('잘못 올린 임시 안내', { exact: false }).waitFor();
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
  await runCommand(page, 'git show HEAD:회의록.md');
  await page.getByRole('log').getByText(/다음 모임은 금요일 저녁 7시예요\./).waitFor();

  await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openChapter(page, url, 5);
  await page.getByTestId('guided-command').click();
  await page.getByTestId('guided-command').click();
  await page.getByRole('button', { name: '상대 브랜치 내용 사용', exact: true }).waitFor();
  const bubble = page.getByTestId('speech-bubble');
  assert.match(await bubble.innerText(), /아래 버튼에서 남길 내용을 고르세요/);
  // 충돌 전에 양쪽 실제 내용을 보여 줘요.
  const preview = page.getByTestId('conflict-preview');
  await preview.waitFor();
  assert.match(await preview.innerText(), /dark-midnight/);
  assert.match(await preview.innerText(), /sunset-coral/);
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
  const guide = page.getByTestId('guided-command');
  await openTerminal(page);
  await expectQuickAction(page, '보관한 작업 복원하기', 'git stash pop');
  for (const label of ['작업 임시 보관하기', '지난 변경 취소하기', '보관한 작업 복원하기', '팀에 공유하기']) {
    assert.equal(await guide.innerText(), label);
    await guide.click();
  }
  await page.getByTestId('next-chapter-btn').click();
  await page.waitForURL('**/#/chapter/4');
  await page.getByRole('heading', { name: '팀에 회의록 수정 제안하기' }).waitFor();
  await page.getByText(/브랜치는 기본 문서를 그대로 두고/).waitFor();
  // 진행 표시가 세 묶음으로 나뉘어 보여요.
  for (const phase of ['내 컴퓨터에서', 'GitHub에서', '다시 내 컴퓨터로']) {
    await page.getByText(phase, { exact: true }).waitFor();
  }
  await page.getByText('GitHub 웹에서 이어 하기', { exact: false }).click();
  await page.getByText('Create pull request', { exact: true }).waitFor();
  const editingHelp = page.getByRole('link', { name: /GitHub 문서 편집 도움말/ });
  const prHelp = page.getByRole('link', { name: /GitHub 검토 요청 도움말/ });
  assert.equal(await editingHelp.getAttribute('target'), '_blank');
  assert.equal(await prHelp.getAttribute('target'), '_blank');
  await page.context().route('https://docs.github.com/**', (route) => route.fulfill({ body: 'GitHub Docs' }));
  const [helpTab] = await Promise.all([page.waitForEvent('popup'), editingHelp.click()]);
  await helpTab.waitForURL('https://docs.github.com/**');
  assert.match(page.url(), /#\/chapter\/4$/);
  await helpTab.close();

  for (const label of ['새 브랜치 만들기', '다음 기록에 담기', '기록 남기기', '팀에 공유하기', '검토 요청하기', '팀원 승인 확인하기', '검토한 변경 합치기', '기본 브랜치로 이동하기', '합친 내용 가져오기']) {
    assert.equal(await guide.innerText(), label);
    await guide.click();
  }
  await expectProgress(page, 9, 9);
  await runCommand(page, 'git show origin/main:회의록.md');
  await page.getByRole('log').getByText(/장소는 2층 모임방이에요\./).waitFor();
  // 합친 뒤 내 컴퓨터의 main에도 같은 내용이 반영돼요.
  await runCommand(page, 'git show HEAD:회의록.md');
  await page.getByRole('log').getByText(/장소는 2층 모임방이에요\./).last().waitFor();

  const advanced = page.getByRole('combobox', { name: '심화 실습 선택', exact: true });
  await advanced.selectOption('ch3');
  await page.waitForURL('**/#/chapter/5');
  await advanced.selectOption('ch8');
  await page.waitForURL('**/#/chapter/9');
  const nav = await page.getByRole('navigation', { name: '학습 장' }).boundingBox();
  assert(nav.height <= 35, 'Chapter navigation wraps on desktop');
}

async function storageRecovery(page, url) {
  await openChapter(page, url, 1);
  const editor = page.getByRole('textbox', { name: '회의록.md', exact: true });
  const original = await editor.inputValue();
  const draft = original + '다음 모임 준비를 맡았어요.\n';
  const writesBeforeDelay = await editor.evaluate((node, values) => {
    window.draftWrites = 0;
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'gitdots.practice.v3.docs') window.draftWrites++;
      return originalSet.call(this, key, value);
    };
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    for (const value of values) {
      setValue.call(node, value);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return window.draftWrites;
  }, [original + '다', original + '다음', draft]);
  assert.equal(writesBeforeDelay, 0);
  await page.waitForFunction(() => window.draftWrites === 1);
  assert.equal(await editor.inputValue(), draft);

  const latest = draft + '장소도 확인했어요.\n';
  await editor.fill(latest);
  await page.reload();
  assert.equal(await editor.inputValue(), latest);

  const guide = page.getByTestId('guided-command');
  await openChapter(page, url, 5);
  await guide.click();
  await openChapter(page, url, 4);
  await guide.click();
  await page.evaluate(() => {
    // docs와 ch4의 v3 저장본을 v2 레거시로 돌려 예제 변경 마이그레이션을 검증해요.
    for (const id of ['docs', 'ch4']) {
      const key = `gitdots.practice.v3.${id}`;
      localStorage.setItem(`gitdots.practice.v2.${id}`, localStorage.getItem(key));
      localStorage.removeItem(key);
    }
    // ch3 저장본의 커밋 부모를 깨뜨려 읽기 불가 복구를 검증해요.
    const key = 'gitdots.practice.v3.ch3';
    const broken = JSON.parse(localStorage.getItem(key));
    const firstCommit = broken.sim.commits[0];
    firstCommit.parents = [firstCommit.id];
    localStorage.setItem(key, JSON.stringify(broken));
  });
  // 현재 URL은 #/chapter/4(ch4)예요. v2 레거시 + 예제 변경 → 복구 화면.
  await page.reload();
  const reset = page.getByRole('main').getByRole('button', { name: '현재 장 초기화', exact: true });
  const updated = page.getByRole('heading', { name: '이 장의 실습 예제가 바뀌었어요' });
  await updated.waitFor();
  // 복구 화면의 초기화는 확인 창 없이 바로 동작하고, 옛 v2 저장본은 지워져요.
  await reset.click();
  await expectProgress(page, 0, 9);
  assert(await page.evaluate(() => !localStorage.getItem('gitdots.practice.v2.ch4') && localStorage.getItem('gitdots.practice.v3.ch4')));
  await page.reload();
  await expectProgress(page, 0, 9);

  // 깨진 ch3 저장본 → 읽기 불가 복구.
  await page.goto(`${url}#/chapter/5`);
  const unreadable = page.getByRole('heading', { name: '이 장의 저장 내용을 읽을 수 없어요' });
  await unreadable.waitFor();
  await reset.click();
  await expectProgress(page, 0, 4);
  await page.reload();
  await expectProgress(page, 0, 4);

  // docs는 v2 레거시에서 조용히 마이그레이션돼요.
  await openChapter(page, url, 1);
  assert.equal(await editor.inputValue(), latest);
  assert(await page.evaluate(() => JSON.parse(localStorage.getItem('gitdots.practice.v3.docs')).sim.bubbles.length > 0));
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
    await openChapter(page, url, 1);
    await page.setViewportSize({ width: 844, height: 390 });
    const editor = page.getByRole('textbox', { name: '회의록.md', exact: true });
    assert.equal(await editor.evaluate((node) => getComputedStyle(node).fontSize), '16px');
    await page.setViewportSize({ width: 360, height: 760 });
    await openChapter(page, url, 2);
    await page.waitForFunction(() => window.sampledLabels.has('스테이징'), undefined, { timeout: 9000 });
    const canvas = page.getByTestId('pixel-stage-canvas');
    const before = await canvas.evaluate((element) => element.toDataURL());
    releaseFont();
    await page.waitForFunction((previous) => {
      const font = [...document.fonts].find((item) => item.family.replaceAll('"', '') === 'GitDots Pixel');
      return font?.status === 'loaded' && document.querySelector('canvas').toDataURL() !== previous;
    }, before, { timeout: 9000 });
    await openChapter(page, url, 5);
    await page.waitForFunction(() => window.sampledLabels.has('10aa20b'), undefined, { timeout: 9000 });
    const labels = await page.evaluate(() => Array.from(window.sampledLabels));
    for (const entry of ['10aa20b', '30cc40d', '50ee60f', 'HEAD · main', 'feat/ui']) {
      assert(labels.some(([label]) => label === entry), `Missing canvas label ${entry}`);
    }
    for (const [label, { size, font, maxWidth }] of labels) {
      assert(size >= 11.99, `${label} renders below 12 CSS px`);
      assert(!/\b(?:bold|[5-9]00)\b/.test(font), `${label} uses a synthetic weight`);
      assert.equal(maxWidth, undefined, `${label} can be horizontally compressed`);
    }

    await openChapter(page, url, 4);
    const branch = '검토/쀍';
    await runCommand(page, `git switch -c ${branch}`);
    const branchFont = await page.waitForFunction((text) => window.sampledLabels.get(text)?.font, branch, { timeout: 9000 });
    assert.match(await branchFont.jsonValue(), /monospace/);

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

async function storageWarning(page, url) {
  await openChapter(page, url, 2);
  assert.equal(await page.getByRole('alert').count(), 0);
  // 사생활 보호 모드·용량 초과처럼 저장이 실패하는 상황을 재현해요.
  await page.evaluate(() => {
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('gitdots.practice.')) throw new DOMException('quota exceeded', 'QuotaExceededError');
      return originalSet.call(this, key, value);
    };
  });
  await page.getByTestId('guided-command').click();
  const alert = page.getByRole('alert');
  await alert.waitFor();
  assert.match(await alert.innerText(), /이 창을 닫으면 진행 상태가 사라져요/);
  await alert.getByRole('button', { name: '닫기', exact: true }).click();
  assert.equal(await page.getByRole('alert').count(), 0);
  // 닫은 뒤에는 저장 실패가 반복돼도 경고를 다시 띄우지 않아요.
  await page.getByTestId('guided-command').click();
  assert.equal(await page.getByRole('alert').count(), 0);
}

async function crossTabSync(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const a = await context.newPage();
  const b = await context.newPage();
  await openChapter(a, url, 1);
  await openChapter(b, url, 1);
  const editorA = a.getByRole('textbox', { name: '회의록.md', exact: true });
  const editorB = b.getByRole('textbox', { name: '회의록.md', exact: true });
  const original = await editorA.inputValue();
  const draftA = original + '탭 A에서 작성 중인 초안이에요.\n';
  const draftB = original + '탭 B에서 작성 중인 초안이에요.\n';
  const draftSaved = (page, draft) => page.waitForFunction((expected) => {
    const raw = localStorage.getItem('gitdots.practice.v3.docs');
    return raw !== null && JSON.parse(raw).documentDraft === expected;
  }, draft);
  // 두 탭이 각자 입력 중인 초안을 가져요. 서로의 초안을 받아도 내 초안은 유지돼요.
  await editorA.fill(draftA);
  await draftSaved(a, draftA);
  await editorB.fill(draftB);
  await draftSaved(b, draftB);
  assert.equal(await editorA.inputValue(), draftA);
  // 탭 A가 초안을 저장하면 EDIT 단계가 완료되고 저장본이 다른 탭으로 전파돼요.
  await a.getByTestId('guided-command').click();
  await expectProgress(a, 1, 6);
  // 탭 B는 진행 상태를 반영하되, 이 탭에서 입력 중인 초안(draftB)은 그대로 유지해요.
  await b.waitForFunction(() => document.querySelector('[data-testid="stage-step-badge"]')?.textContent === '실습 1/6 완료');
  assert.equal(await editorB.inputValue(), draftB);
  await context.close();
}

async function advancedVisualCards(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const guide = page.getByTestId('guided-command');
  // 7장: 토큰 권한 목록이 화면에 보이고, fine-grained에는 삭제 권한이 없어요.
  await openChapter(page, url, 7);
  const scopes = page.getByTestId('token-scopes');
  await guide.click();
  await scopes.waitFor();
  assert.match(await scopes.innerText(), /delete_repo/);
  await guide.click();
  assert.match(await scopes.innerText(), /contents:write/);
  assert.doesNotMatch(await scopes.innerText(), /delete_repo/);
  // 9장: 자동 테스트 결과 화면이 보여요.
  await openChapter(page, url, 9);
  await guide.click();
  await guide.click();
  const tests = page.getByTestId('ai-tests');
  await tests.waitFor();
  assert.match(await tests.innerText(), /sum\(2, 3\) === 5 PASS/);
  await page.close();
}

async function mobileLessonLayout(browser, url) {
  const page = await browser.newPage({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true });
  await openChapter(page, url, 1);
  const allTerms = page.getByTestId('all-terms');
  // 전체 용어 상자는 접혀 있고, 다음 단계 버튼보다 아래에 있어요.
  assert.equal(await allTerms.evaluate((el) => el.open), false);
  const buttonBox = await page.getByTestId('guided-command').boundingBox();
  const termsBox = await allTerms.boundingBox();
  assert(buttonBox.y < termsBox.y, 'Guided button sits below the full terms list on mobile');
  // 지금 단계에서 쓰는 용어만 보여 줘요.
  const stepTerms = page.getByTestId('step-terms');
  await stepTerms.waitFor();
  assert.match(await stepTerms.innerText(), /회의록.md/);
  assert.doesNotMatch(await stepTerms.innerText(), /HEAD/);
  await page.close();
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
    const savedPage = await browser.newPage();
    const storageErrors = trackErrors(savedPage, origin);
    await storageRecovery(savedPage, url);
    assert.deepEqual(storageErrors, []);
    await savedPage.close();
    await mobileCanvasAndKeyboard(browser, url);
    console.log('[QA] Course numbering, web guide, save migration and recovery, glyph fallback and mobile keyboard checks passed');

    const warningPage = await browser.newPage();
    const warningErrors = trackErrors(warningPage, origin);
    await storageWarning(warningPage, url);
    assert.deepEqual(warningErrors, []);
    await warningPage.close();
    await crossTabSync(browser, url);
    console.log('[QA] Storage failure warning and cross-tab sync passed');
    await advancedVisualCards(browser, url);
    console.log('[QA] Token scope and AI test result cards passed');
    await mobileLessonLayout(browser, url);
    console.log('[QA] Mobile lesson layout (contextual terms, button above full terms) passed');

    const link = await browser.newPage();
    await link.goto(url + 'docs/deeper/');
    await link.waitForURL('**/#/chapter/1');
    await link.getByRole('textbox', { name: '회의록.md', exact: true }).waitFor();
    await link.goto(url + 'chapter/9/');
    await link.waitForURL('**/#/chapter/9');
    await link.goto(`${url}#/ch3`);
    await link.waitForURL('**/#/chapter/5');
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
