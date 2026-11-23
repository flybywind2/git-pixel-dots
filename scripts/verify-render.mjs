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
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main');
    const wide = main ? [...main.querySelectorAll('*')].filter((element) => {
      const style = getComputedStyle(element);
      return element.scrollWidth > element.clientWidth + 1 && style.overflowX === 'visible';
    }).slice(0, 4).map((element) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)}`) : [];
    return {
      page: document.documentElement.scrollWidth - innerWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
      wide,
    };
  });
  assert(overflow.page <= 1, `Page overflows horizontally by ${overflow.page}px (${overflow.wide.join(' | ')})`);
  assert(overflow.main <= 1, `Main area overflows horizontally by ${overflow.main}px (${overflow.wide.join(' | ')})`);
}

async function checkCardOverflow(page) {
  const overflow = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="stage-files-card"]');
    const preview = document.querySelector('[data-testid="stage-file-preview"]');
    return [card, preview].map((element) => element ? element.scrollWidth - element.clientWidth : 0);
  });
  assert(overflow.every((value) => value <= 1), `File card overflows horizontally: ${overflow.join(', ')}px`);
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

// 예측 퀴즈가 있는 단계는 첫 클릭이 퀴즈를 열어요. 보기를 고른 뒤 계속하기로 실행해요.
async function clickGuided(page) {
  const button = page.getByTestId('guided-command');
  await button.click();
  const choice = page.getByTestId('prediction-choice-0');
  if (await choice.isVisible()) {
    await choice.click();
    await button.click();
  }
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

  assert.equal(await page.getByTestId('terminal-input').isVisible(), true, 'Terminal should start expanded by default');
  assert.equal(await page.getByRole('button', { name: '터미널 접기', exact: true }).getAttribute('aria-expanded'), 'true');
  await checkViewport(page);
  await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
  assert.equal(await page.getByTestId('terminal-input').isVisible(), false, 'Terminal should hide after clicking collapse');
  await page.getByRole('button', { name: '직접 입력해 보기', exact: true }).click();
  assert.equal(await page.getByTestId('terminal-input').isVisible(), true, 'Terminal should reopen after clicking expand');
  await clickGuided(page);
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
  await clickGuided(page);
  await expectProgress(page, 1, 6);

  await comparison.getByRole('button', { name: '담아 둔 변경', exact: true }).click();
  await expectProgress(page, 1, 6);
  assert.equal(await guide.innerText(), '바뀐 줄 확인하기');
  await clickGuided(page);
  await expectProgress(page, 2, 6);
  await diff.getByText('다음 모임은 수요일 오후 2시예요.', { exact: false }).waitFor();
  await checkViewport(page);
  if (capture) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, capture), fullPage: true });
  }

  for (let step = 3; step <= 6; step++) {
    await clickGuided(page);
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
    await clickGuided(page);
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
  await clickGuided(page);
  await clickGuided(page);
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
  for (const label of ['장바구니에서 비밀 메모 빼기', '작업 임시 보관하기', '지난 변경 취소하기', '보관한 작업 복원하기', '팀에 공유하기']) {
    assert.equal(await guide.innerText(), label);
    await clickGuided(page);
  }
  await page.getByTestId('next-chapter-btn').click();
  await page.waitForURL('**/#/chapter/4');
  await page.getByRole('heading', { name: '팀에 회의록 수정 제안하기' }).waitFor();
  await page.getByText(/브랜치는 기본 문서를 그대로 두고/).waitFor();
  // 진행 표시가 세 묶음으로 나뉘어 보여요.
  for (const phase of ['내 컴퓨터에서', 'GitHub에 올리고 검토받기', '다시 내 컴퓨터로']) {
    await page.getByText(phase, { exact: true }).waitFor();
  }
  for (const label of ['새 브랜치 만들기', '다음 기록에 담기', '기록 남기기', '팀에 공유하기', '검토 요청하기', '팀원 승인 확인하기', '검토한 변경 합치기', '기본 브랜치로 이동하기', '합친 내용 가져오기']) {
    assert.equal(await guide.innerText(), label);
    await clickGuided(page);
  }
  await expectProgress(page, 9, 9);
  await runCommand(page, 'git show origin/main:회의록.md');
  await page.getByRole('log').getByText(/장소는 2층 모임방이에요\./).waitFor();
  // 합친 뒤 내 컴퓨터의 main에도 같은 내용이 반영돼요.
  await runCommand(page, 'git show HEAD:회의록.md');
  await page.getByRole('log').getByText(/장소는 2층 모임방이에요\./).last().waitFor();

  // GitHub 웹 안내는 장을 완료한 뒤에만 보여요.
  await page.getByText('GitHub 웹에서 이어 하기', { exact: false }).click();
  await page.getByText('Create pull request', { exact: true }).waitFor();
  const webGuideText = await page.getByTestId('github-web-guide').innerText();
  assert.match(webGuideText, /Conversation/);
  assert.match(webGuideText, /리뷰어\(팀원\)/);
  assert.match(webGuideText, /자동으로 도착/);
  const editingHelp = page.getByRole('link', { name: /GitHub 문서 편집 도움말/ });
  const prHelp = page.getByRole('link', { name: /GitHub 검토 요청 도움말/ });
  assert.equal(await editingHelp.getAttribute('target'), '_blank');
  assert.equal(await prHelp.getAttribute('target'), '_blank');
  await page.context().route('https://docs.github.com/**', (route) => route.fulfill({ body: 'GitHub Docs' }));
  const [helpTab] = await Promise.all([page.waitForEvent('popup'), editingHelp.click()]);
  await helpTab.waitForURL('https://docs.github.com/**');
  assert.match(page.url(), /#\/chapter\/4$/);
  await helpTab.close();

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
      if (key === 'gitdots.practice.v4.docs') window.draftWrites++;
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
  await clickGuided(page);
  await openChapter(page, url, 4);
  await clickGuided(page);
  await page.evaluate(() => {
    // docs와 ch4의 v4 저장본을 v2 레거시로 돌려 예제 변경 마이그레이션을 검증해요.
    for (const id of ['docs', 'ch4']) {
      const key = `gitdots.practice.v4.${id}`;
      localStorage.setItem(`gitdots.practice.v2.${id}`, localStorage.getItem(key));
      localStorage.removeItem(key);
    }
    // ch3 저장본의 커밋 부모를 깨뜨려 읽기 불가 복구를 검증해요.
    const key = 'gitdots.practice.v4.ch3';
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
  assert(await page.evaluate(() => !localStorage.getItem('gitdots.practice.v2.ch4') && localStorage.getItem('gitdots.practice.v4.ch3')));
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
  assert(await page.evaluate(() => JSON.parse(localStorage.getItem('gitdots.practice.v4.docs')).sim.bubbles.length > 0));
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
    await clickGuided(page);
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
  await clickGuided(page);
  const alert = page.getByRole('alert');
  await alert.waitFor();
  assert.match(await alert.innerText(), /이 창을 닫으면 진행 상태가 사라져요/);
  await alert.getByRole('button', { name: '닫기', exact: true }).click();
  assert.equal(await page.getByRole('alert').count(), 0);
  // 닫은 뒤에는 저장 실패가 반복돼도 경고를 다시 띄우지 않아요.
  await clickGuided(page);
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
    const raw = localStorage.getItem('gitdots.practice.v4.docs');
    return raw !== null && JSON.parse(raw).documentDraft === expected;
  }, draft);
  // 두 탭이 각자 입력 중인 초안을 가져요. 서로의 초안을 받아도 내 초안은 유지돼요.
  await editorA.fill(draftA);
  await draftSaved(a, draftA);
  await editorB.fill(draftB);
  await draftSaved(b, draftB);
  assert.equal(await editorA.inputValue(), draftA);
  // 탭 A가 초안을 저장하면 EDIT 단계가 완료되고 저장본이 다른 탭으로 전파돼요.
  await clickGuided(a);
  await expectProgress(a, 1, 6);
  // 탭 B는 진행 상태를 반영하되, 이 탭에서 입력 중인 초안(draftB)은 그대로 유지해요.
  await b.waitForFunction(() => document.querySelector('[data-testid="stage-step-badge"]')?.textContent === '실습 1/6 완료');
  assert.equal(await editorB.inputValue(), draftB);

  // 탭 B가 자기 초안을 저장하면 탭 A의 예전 Undo 스냅샷은 최신 저장본을 덮지 못하도록 비워져요.
  const undoA = a.getByTestId('undo-step-btn');
  assert.equal(await undoA.isDisabled(), false);
  await clickGuided(b);
  await a.waitForFunction(() => document.querySelector('[data-testid="undo-step-btn"]')?.disabled === true);
  assert.equal(await editorA.inputValue(), `${draftB}`, 'Tab A did not adopt the latest saved text');
  await context.close();
}

async function crossTabDraftRace(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const a = await context.newPage();
  const b = await context.newPage();
  await openChapter(a, url, 1);
  await openChapter(b, url, 1);
  // 탭 A가 먼저 저장본을 만들어 둬요(다른 탭 저장 이벤트의 기준).
  await runCommand(a, 'git status');
  const editorB = b.getByRole('textbox', { name: '회의록.md', exact: true });
  const original = await editorB.inputValue();
  const draftB = original + '지연 저장 도중 도착한 초안이에요.\n';
  await editorB.fill(draftB);
  // 탭 B의 250ms 지연 저장이 끝나기 전에 탭 A의 저장본이 도착해요.
  await a.evaluate(() => {
    const key = 'gitdots.practice.v4.docs';
    const raw = JSON.parse(localStorage.getItem(key));
    raw.documentDraft = '탭 A가 방금 저장한 초안';
    localStorage.setItem(key, JSON.stringify(raw));
  });
  await b.waitForFunction((expected) => {
    const raw = localStorage.getItem('gitdots.practice.v4.docs');
    return raw !== null && JSON.parse(raw).documentDraft === expected;
  }, draftB, { timeout: 4000 });
  await b.reload();
  await b.getByRole('textbox', { name: '회의록.md', exact: true }).waitFor();
  assert.equal(await b.getByRole('textbox', { name: '회의록.md', exact: true }).inputValue(), draftB,
    'Tab B draft was lost after adopting another tab save during the debounce window');
  await context.close();
}

async function advancedVisualCards(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const guide = page.getByTestId('guided-command');
  // 7장: 토큰 권한 목록이 화면에 보이고, fine-grained에는 삭제 권한이 없어요.
  await openChapter(page, url, 7);
  const scopes = page.getByTestId('token-scopes');
  await clickGuided(page);
  await scopes.waitFor();
  assert.match(await scopes.innerText(), /delete_repo/);
  await clickGuided(page);
  assert.match(await scopes.innerText(), /contents:write/);
  assert.doesNotMatch(await scopes.innerText(), /delete_repo/);
  // 9장: 자동 테스트 결과 화면이 보여요.
  await openChapter(page, url, 9);
  await clickGuided(page);
  await clickGuided(page);
  const tests = page.getByTestId('ai-tests');
  await tests.waitFor();
  assert.match(await tests.innerText(), /sum\(2, 3\) === 5 PASS/);
  // 정보 카드는 캔버스보다 먼저 DOM에 있고, 화면에서도 위에 있어요(키보드/스크린리더 순서 일치).
  const cardOrder = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="ai-tests"]');
    const canvas = document.querySelector('[data-testid="pixel-stage-canvas"]');
    if (!card || !canvas) return null;
    return {
      domBefore: Boolean(card.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING),
      visualAbove: card.getBoundingClientRect().top < canvas.getBoundingClientRect().top,
    };
  });
  assert.deepEqual(cardOrder, { domBefore: true, visualAbove: true });
  await page.close();
}

async function mobileLessonLayout(browser, url) {
  for (const [width, height] of [[390, 760], [320, 568]]) {
    const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
    await openChapter(page, url, 1);
    const allTerms = page.getByTestId('all-terms');
    // 전체 용어 상자는 접혀 있고, 다음 단계 버튼보다 아래에 있어요.
    assert.equal(await allTerms.evaluate((el) => el.open), false);
    const buttonBox = await page.getByTestId('guided-command').boundingBox();
    const termsBox = await allTerms.boundingBox();
    assert(buttonBox.y < termsBox.y, 'Guided button sits below the full terms list on mobile');
    // 다음 단계 버튼이 기본 펼침 터미널 위 첫 화면에 스크롤 없이 보여요.
    const dockBox = await page.getByRole('region', { name: '실습 터미널', exact: true }).boundingBox();
    assert(buttonBox.y >= 0 && buttonBox.y + buttonBox.height <= dockBox.y + 1,
      `Guided button overlaps or sits below default-open terminal at ${width}x${height}`);
    await checkViewport(page);
    // 지금 단계에서 쓰는 용어만 보여 줘요.
    const stepTerms = page.getByTestId('step-terms');
    await stepTerms.waitFor();
    assert.match(await stepTerms.innerText(), /회의록.md/);
    assert.doesNotMatch(await stepTerms.innerText(), /HEAD/);
    // 비교를 실행하기 전에는 결과 한 줄이 보이지 않아요.
    assert.equal(await page.getByText('비교 결과:', { exact: false }).count(), 0);
    // 퀴즈가 열린 동안에도 버튼이 스크롤 없이 보여요(자동 스크롤 없이 측정).
    await openChapter(page, url, 3);
    await page.getByTestId('guided-command').click();
    await page.evaluate(() => document.querySelector('main').scrollTo(0, 0));
    const pendingBox = await page.getByTestId('guided-command').boundingBox();
    assert(pendingBox.y >= 0 && pendingBox.y + pendingBox.height <= height,
      `Quiz pending button not visible without scroll at ${width}x${height}`);
    await page.getByTestId('prediction-choice-0').click();
    await page.evaluate(() => document.querySelector('main').scrollTo(0, 0));
    const continueBox = await page.getByTestId('guided-command').boundingBox();
    assert(continueBox.y >= 0 && continueBox.y + continueBox.height <= height,
      `Continue button not visible without scroll at ${width}x${height}`);
    if (width === 320) {
      // 아주 긴 파일명도 카드와 미리보기에서 가로로 넘치지 않아요.
      const longName = '아주긴파일이름테스트입니다정말로길어요한번더길게.md';
      await runCommand(page, `edit ${longName}`);
      await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
      const filesCard = page.getByTestId('stage-files-card');
      await filesCard.getByRole('button', { name: new RegExp('아주긴파일이름') }).click();
      await page.getByTestId('stage-file-preview').waitFor();
      await checkCardOverflow(page);
      await checkViewport(page);
    }
    await page.close();
  }
}

async function advancedGuidedCompletion(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  // 심화 5~9장을 안내 버튼만으로 끝까지 완료해요(1~4장은 다른 검사에서 완료).
  for (const [chapter, total] of [[5, 4], [6, 4], [7, 4], [8, 4], [9, 6]]) {
    await openChapter(page, url, chapter);
    for (let i = 0; i < total; i++) {
      if (chapter === 5 && i === 2) {
        // 충돌 단계는 상단 버튼으로 바로 해결하지 않고 비교 카드에서 직접 골라요.
        await clickGuided(page);
        await page.getByTestId('conflict-preview').getByRole('button', { name: '두 변경 함께 남기기', exact: true }).click();
      } else {
        await clickGuided(page);
      }
    }
    await expectProgress(page, total, total);
  }
  // 심화만 완료한 상태에서는 수료증 버튼이 없어요.
  assert.equal(await page.getByRole('button', { name: '수료증 보기', exact: true }).count(), 0);
  await page.close();
}

async function basicCertificate(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  // 기본 1~4장만 완주해도 기본 과정 수료증이 열려요.
  await openChapter(page, url, 1);
  await runCommand(page, 'edit 회의록.md');
  for (let i = 0; i < 5; i++) await clickGuided(page);
  await expectProgress(page, 6, 6);
  await page.getByText('1/9장 완료', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '수료증 보기', exact: true }).count(), 0);
  await openChapter(page, url, 2);
  for (let i = 0; i < 3; i++) await clickGuided(page);
  await openChapter(page, url, 3);
  for (let i = 0; i < 5; i++) await clickGuided(page);
  assert.equal(await page.getByRole('button', { name: '수료증 보기', exact: true }).count(), 0);
  await openChapter(page, url, 4);
  for (let i = 0; i < 9; i++) await clickGuided(page);
  await page.getByRole('button', { name: '수료증 보기', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /기본 과정 4장을 마쳤어요/);
  // 네이티브 dialog가 포커스를 가두고, 닫으면 트리거 버튼으로 돌려줘요.
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  assert(await dialog.evaluate((element) => element.contains(document.activeElement)),
    'Certificate dialog let focus escape to the background');
  const trigger = page.getByRole('button', { name: '수료증 보기', exact: true });
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  assert(await trigger.evaluate((element) => element === document.activeElement),
    'Certificate dialog did not restore focus to its trigger');
  await page.close();
}

async function uxImprovements(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  // P0-2: 1장 미저장 상태에서 비교 탭 클릭 시 인라인 경고 배너와 원클릭 저장+비교 버튼이 동작해요.
  await openChapter(page, url, 1);
  const editor = page.getByRole('textbox', { name: '회의록.md', exact: true });
  const original = await editor.inputValue();
  await editor.fill(original.replace('금요일 저녁 7시', '화요일 오후 3시'));
  const comparison = page.getByRole('region', { name: '변경 비교', exact: true });
  await comparison.getByRole('button', { name: '바뀐 줄', exact: true }).click();
  const banner = page.getByTestId('unsaved-compare-banner');
  await banner.waitFor();
  await banner.getByRole('button', { name: '지금 저장하고 비교하기', exact: true }).click();
  await expectProgress(page, 2, 6);
  assert.equal(await banner.count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-pressed')), 'true',
    'Focus did not move to the selected comparison tab');

  // P1-1: 상단 '이전 단계로' 버튼으로 한 단계 되돌릴 수 있어요.
  const undoBtn = page.getByTestId('undo-step-btn');
  assert.equal(await undoBtn.isDisabled(), false);
  await undoBtn.click();
  await expectProgress(page, 1, 6);

  // P0-1 & P1-2: 2~4장 초기 말풍선에 '아래 추천 버튼' 오안내가 없고, 파일 상태 미니 카드 미리보기가 동작해요.
  for (const chapter of [2, 3, 4]) {
    await openChapter(page, url, chapter);
    const bubbleText = await page.getByTestId('speech-bubble').innerText();
    assert.doesNotMatch(bubbleText, /아래 추천 버튼/);
    const filesCard = page.getByTestId('stage-files-card');
    await filesCard.waitFor();
    await filesCard.getByRole('button', { name: /회의록\.md/ }).click();
    await page.getByTestId('stage-file-preview').waitFor();
  }

  // P1-3: 4장 완료 전에도 GitHub 웹 안내를 접이식으로 열 수 있어요.
  const webGuide = page.getByTestId('github-web-guide');
  await webGuide.waitFor();

  // P1-4: 5장 충돌 해결 버튼은 말풍선이 아니라 코드 비교 카드 하단에 놓여요.
  await openChapter(page, url, 5);
  await clickGuided(page);
  await clickGuided(page);
  const preview = page.getByTestId('conflict-preview');
  await preview.getByRole('button', { name: '두 변경 함께 남기기', exact: true }).waitFor();
  assert.equal(await page.getByTestId('speech-bubble').getByRole('button', { name: '두 변경 함께 남기기', exact: true }).count(), 0);
  // 상단 강조 버튼은 비교 전에 바로 해결하지 않고 비교 카드로 포커스를 옮겨요.
  assert.equal(await page.getByTestId('guided-command').innerText(), '남길 내용 비교하기');
  await page.getByTestId('guided-command').click();
  await expectProgress(page, 2, 4);
  assert(await page.evaluate(() => document.activeElement?.id === 'conflict-comparison'), 'Conflict comparison did not receive focus');
  await preview.getByRole('button', { name: '두 변경 함께 남기기', exact: true }).click();
  await expectProgress(page, 3, 4);
  // 해결 뒤에는 새로 나타난 기록 버튼으로 키보드 포커스가 이어져요.
  assert(await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'guided-command'),
    'Focus did not move to the merge commit button');
  assert.equal(await page.getByTestId('guided-command').innerText(), '합친 내용 기록하기');
  // 되돌리면 충돌 단계로 돌아가고, 다른 선택지도 3/4로 인정돼요.
  await page.getByTestId('undo-step-btn').click();
  await expectProgress(page, 2, 4);
  await preview.getByRole('button', { name: '현재 브랜치 내용 유지', exact: true }).click();
  await expectProgress(page, 3, 4);
  await page.close();
}

async function draftUndoProtection(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await openChapter(page, url, 1);
  const editor = page.getByRole('textbox', { name: '회의록.md', exact: true });
  const original = await editor.inputValue();
  await clickGuided(page);
  const first = original.replace('금요일 저녁 7시', '목요일 오후 4시');
  await editor.fill(first);
  await page.getByTestId('guided-command').click();
  await expectProgress(page, 1, 6);

  const draft = `${first}저장하지 않은 초안이에요.\n`;
  await editor.fill(draft);
  await page.getByTestId('undo-step-btn').click();
  const dialog = page.getByRole('dialog', { name: '저장하지 않은 초안이 있어요' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  assert.equal(await editor.inputValue(), draft, 'Cancelling undo lost the unsaved draft');
  await page.waitForFunction((expected) => {
    const raw = localStorage.getItem('gitdots.practice.v4.docs');
    return raw !== null && JSON.parse(raw).documentDraft === expected;
  }, draft);

  // 확인을 누르면 조용히 이전 스냅샷으로 돌아가고 예전 애니메이션은 재생하지 않아요.
  await page.getByTestId('undo-step-btn').click();
  await page.getByRole('dialog', { name: '저장하지 않은 초안이 있어요' })
    .getByRole('button', { name: '초안 버리고 되돌리기', exact: true }).click();
  assert.equal(await editor.inputValue(), first);

  await editor.fill(draft);
  await page.reload();
  assert.equal(await editor.inputValue(), draft, 'Unsaved draft did not survive refresh');
  assert.equal(await page.getByTestId('undo-step-btn').isDisabled(), true, 'Undo stack should reset after refresh');
  await page.close();
}

async function fileCardStates(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await openChapter(page, url, 3);
  await runCommand(page, 'git add .');
  await runCommand(page, 'edit 회의록.md');
  await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
  const card = page.getByTestId('stage-files-card');
  const docButton = card.getByRole('button', { name: /회의록\.md/ }).first();
  await docButton.click();
  const preview = page.getByTestId('stage-file-preview');
  await preview.waitFor();
  assert.match(await preview.innerText(), /작업 파일\(working\)/);
  assert.match(await preview.innerText(), /장바구니 사본\(index\)/);
  assert.match(await preview.innerText(), /추가 수정/);
  await preview.getByRole('button', { name: '파일 미리보기 닫기', exact: true }).click();
  assert(await docButton.evaluate((node) => node === document.activeElement),
    'Closing the preview did not return focus to the file card');

  // 여러 건의 임시 보관도 보관 번호별로 모두 보여요.
  await runCommand(page, 'git stash');
  await runCommand(page, 'edit 회의록.md');
  await runCommand(page, 'git stash');
  await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
  await card.getByText('stash@{0}', { exact: true }).first().waitFor();
  await card.getByText('stash@{1}', { exact: true }).first().waitFor();
  await card.getByRole('button', { name: /stash@\{0\}/ }).first().click();
  assert.match(await preview.innerText(), /stash@\{0\}에 보관된 사본/);
  await checkCardOverflow(page);

  // 원격과의 실제 부모 관계를 상태 문구로 확인해요.
  await openChapter(page, url, 3);
  const sync = page.getByTestId('stage-sync-status');
  await sync.waitFor();
  await runCommand(page, 'git revert HEAD');
  await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
  assert.match(await sync.innerText(), /공유 대기/);
  await runCommand(page, 'git push');
  await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
  assert.match(await sync.innerText(), /동기화 완료/);
  assert.match(await page.getByTestId('stage-command-status').innerText(), /변경 공유/);
  await runCommand(page, 'git reset --soft HEAD~1');
  await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
  assert.match(await sync.innerText(), /원격이 앞섬/);
  await page.close();
}

async function reviewRegressions(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(9000);

  // 4장: main에서는 PR을 열 수 없어요.
  await openChapter(page, url, 4);
  await runCommand(page, 'gh pr create --title "빈 PR"');
  assert.match(await page.getByTestId('speech-bubble').innerText(), /작업 브랜치를 만들어 주세요/);

  // 5장: 충돌 표시가 남은 파일은 add로 조용히 넘어가지 않아요.
  await openChapter(page, url, 5);
  await clickGuided(page);
  await clickGuided(page);
  await runCommand(page, 'git add theme.js');
  assert.match(await page.getByTestId('speech-bubble').innerText(), /충돌 표시/);

  // 7장: 로그인 전 상태를 정확히 알려 주고, --hostname 없는 로그인을 가짜 성공 처리하지 않아요.
  await openChapter(page, url, 8);
  await runCommand(page, 'gh auth status');
  assert.match(await page.getByRole('log').innerText(), /Not logged in/);
  await runCommand(page, 'gh auth login');
  assert.match(await page.getByTestId('speech-bubble').innerText(), /사내 서버 주소/);

  // 8장: AI 코드 수정 전에는 빈 PR을 만들지 않아요.
  await openChapter(page, url, 9);
  await runCommand(page, 'ai pr');
  assert.match(await page.getByTestId('speech-bubble').innerText(), /먼저 AI가 코드를 고쳐야/);

  // 2장: 커밋 후 status가 아직 공유되지 않은 커밋을 알려 줘요.
  await openChapter(page, url, 2);
  await runCommand(page, 'git add .');
  await runCommand(page, 'git commit -m "공유 대기 확인"');
  await runCommand(page, 'git status');
  assert.match(await page.getByRole('log').innerText(), /공유 대기/);

  await page.close();
}

async function cycleOneRegressions(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(9000);

  // H1: stash 목록의 stash@{0}(최신)과 pop 대상이 같아요.
  await openChapter(page, url, 2);
  await runCommand(page, 'git stash');
  await runCommand(page, 'edit 회의록.md');
  await runCommand(page, 'git stash');
  await runCommand(page, 'git stash list');
  const stashLog = await page.getByRole('log').innerText();
  assert.match(stashLog, /stash@\{0\}: 작업 보관 2/);
  assert.match(stashLog, /stash@\{1\}: 작업 보관 1/);
  await runCommand(page, 'git stash pop stash@{0}');
  assert.match(await page.getByRole('log').innerText(), /남은 항목 1개/);

  // H2/H3/M2: worktree 브랜치 보호와 중복 안내.
  await openChapter(page, url, 9);
  await runCommand(page, 'git worktree add -b ai/fix wt-ai');
  await runCommand(page, 'ai code');
  for (const command of ['git push origin ai/fix:main', 'git push origin HEAD:main']) {
    await runCommand(page, command);
    assert.match(await page.getByTestId('speech-bubble').innerText(), /직접 push|main 직접|보호/);
  }
  await runCommand(page, 'git switch ai/fix');
  assert.match(await page.getByTestId('speech-bubble').innerText(), /AI 작업 폴더/);
  await runCommand(page, 'git branch -d ai/fix');
  assert.match(await page.getByTestId('speech-bubble').innerText(), /작업 폴더가 사용 중/);
  await runCommand(page, 'git worktree add -b ai/fix wt-ai');
  assert.match(await page.getByTestId('speech-bubble').innerText(), /이미 작업 폴더/);

  // M3: ai pr을 두 번 실행해도 초안 PR은 하나예요.
  await runCommand(page, 'ai pr');
  await runCommand(page, 'ai pr');
  const duplicatePr = await page.getByTestId('speech-bubble').innerText();
  assert.match(duplicatePr, /이미 초안 PR/);
  assert.match(await page.getByRole('log').innerText(), /PR #1/);

  // M1: 이슈 다음에 만든 PR은 같은 번호를 쓰지 않아요.
  await openChapter(page, url, 6);
  await runCommand(page, 'gh issue create --title "QA 이슈"');
  await runCommand(page, 'gh pr create --title "QA PR"');
  const numbering = await page.getByRole('log').innerText();
  assert.match(numbering, /issues\/13/);
  assert.match(numbering, /pull\/14/);

  // M6: 겹치지 않는 스테이징 변경이 있어도 pull은 진행돼요.
  await openChapter(page, url, 4);
  await runCommand(page, 'git add 회의록.md');
  await runCommand(page, 'git pull origin main');
  const pullBubble = await page.getByTestId('speech-bubble').innerText();
  assert.doesNotMatch(pullBubble, /겹쳐요/);
  assert.match(pullBubble, /가져왔어요/);

  // L1: 4장 자동 검사 안내가 6장 다크 모드 문구를 복사하지 않아요.
  await runCommand(page, 'gh run watch');
  assert.doesNotMatch(await page.getByTestId('speech-bubble').innerText(), /다크 모드/);

  await page.close();
}

async function terminalSizingAndUsability(browser, url) {
  const cases = [
    { width: 1366, height: 860, minDock: 250, minLog: 110, minMain: 500, minTallDock: 560, minTallLog: 400, minInputWidth: 680, minFont: 15 },
    { width: 1024, height: 768, minDock: 225, minLog: 85, minMain: 430, minTallDock: 500, minTallLog: 340, minInputWidth: 560, minFont: 15 },
    { width: 390, height: 760, minDock: 230, minLog: 90, minMain: 390, minTallDock: 480, minTallLog: 320, minInputWidth: 240, minFont: 16 },
    { width: 320, height: 568, minDock: 195, minLog: 58, minMain: 240, minTallDock: 370, minTallLog: 215, minInputWidth: 185, minFont: 16 },
  ];
  for (const spec of cases) {
    const page = await browser.newPage({ viewport: { width: spec.width, height: spec.height } });
    page.setDefaultTimeout(9000);
    const errors = trackErrors(page, new URL(url).origin);

    // 1장 첫 진입: 터미널이 기본 펼침이면서 데스크톱에서는 편집기가 함께 보이고, 모든 뷰포트에서 상단 가이드 버튼과 공존해요.
    await openChapter(page, url, 1);
    const dock = page.getByRole('region', { name: '실습 터미널', exact: true });
    const input = page.getByTestId('terminal-input');
    assert.equal(await dock.getAttribute('data-expanded'), 'true', `Terminal not expanded by default at ${spec.width}x${spec.height}`);
    assert.equal(await dock.getAttribute('data-size'), 'default', `Terminal not in default size on load at ${spec.width}x${spec.height}`);
    assert.equal(await input.isVisible(), true, `Terminal input hidden on initial load at ${spec.width}x${spec.height}`);
    assert(!(await input.evaluate((node) => node === document.activeElement)),
      `Terminal input stole focus on initial load at ${spec.width}x${spec.height}`);
    const ch1DockBox = await dock.boundingBox();
    const ch1GuidedBox = await page.getByTestId('guided-command').boundingBox();
    const ch1MainBox = await page.locator('main').boundingBox();
    assert(ch1MainBox.height >= spec.minMain, `Main area too small on ch1 at ${spec.width}x${spec.height}: ${ch1MainBox.height}px`);
    assert(ch1GuidedBox.y + ch1GuidedBox.height <= ch1DockBox.y + 1,
      `Ch1 guided button hidden behind default-open terminal at ${spec.width}x${spec.height}`);
    if (spec.width >= 1024) {
      const editorBox = await page.getByRole('textbox', { name: '회의록.md', exact: true }).boundingBox();
      assert(editorBox.y < ch1DockBox.y - 24, `Ch1 editor not visible above terminal at ${spec.width}x${spec.height}`);
    }
    await checkViewport(page);

    // 4장 첫 진입: 2~9장 캔버스 화면에서도 기본 펼침으로 열리고 상단 가이드 버튼과 공존해요.
    await openChapter(page, url, 4);
    assert.equal(await input.isVisible(), true, `Terminal input should stay open on ch4 at ${spec.width}x${spec.height}`);
    const ch4DockBox = await dock.boundingBox();
    const ch4GuidedBox = await page.getByTestId('guided-command').boundingBox();
    assert(ch4GuidedBox.y + ch4GuidedBox.height <= ch4DockBox.y + 1,
      `Ch4 guided button hidden behind default-open terminal at ${spec.width}x${spec.height}`);

    await runCommand(page, 'git switch -c feat/very-long-branch-name-for-terminal-layout-check');
    await runCommand(page, 'git log');

    const log = page.getByRole('log', { name: '명령 실행 결과', exact: true });
    const submitBtn = dock.getByRole('button', { name: '실행', exact: true });
    const sizeBtn = page.getByTestId('terminal-size-toggle');

    const defaultDockBox = await dock.boundingBox();
    const defaultLogBox = await log.boundingBox();
    const inputBox = await input.boundingBox();
    const submitBox = await submitBtn.boundingBox();
    const sizeBtnBox = await sizeBtn.boundingBox();
    const inputFont = await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize));

    assert(defaultDockBox.height >= spec.minDock, `Default dock too short at ${spec.width}x${spec.height}: ${defaultDockBox.height}px`);
    assert(defaultLogBox.height >= spec.minLog, `Default log too short at ${spec.width}x${spec.height}: ${defaultLogBox.height}px`);
    assert(inputBox.width >= spec.minInputWidth, `Input too narrow at ${spec.width}x${spec.height}: ${inputBox.width}px`);
    assert(inputBox.height >= 38, `Input too short at ${spec.width}x${spec.height}: ${inputBox.height}px`);
    assert(inputFont >= spec.minFont, `Input font too small at ${spec.width}x${spec.height}: ${inputFont}px`);
    assert(submitBox.x + submitBox.width <= spec.width + 1, `Submit button clipped at ${spec.width}x${spec.height}`);
    assert(sizeBtnBox.x + sizeBtnBox.width <= spec.width + 1, `Size toggle button clipped at ${spec.width}x${spec.height}`);
    assert(defaultDockBox.y + defaultDockBox.height <= spec.height + 1, `Default dock overflows viewport vertically at ${spec.width}x${spec.height}`);
    await checkViewport(page);

    // 크게 보기 토글: 높이가 충분히 커지고 포커스·뷰포트 경계·가로 오버플로가 유지돼요.
    assert.equal(await sizeBtn.innerText(), '크게 보기');
    assert.equal(await sizeBtn.getAttribute('aria-pressed'), 'false');
    await sizeBtn.click();
    assert.equal(await sizeBtn.innerText(), '기본 크기');
    assert.equal(await sizeBtn.getAttribute('aria-pressed'), 'true');
    assert(await sizeBtn.evaluate((node) => node === document.activeElement),
      `Size toggle lost focus at ${spec.width}x${spec.height}`);

    const tallDockBox = await dock.boundingBox();
    const tallLogBox = await log.boundingBox();
    const tallInputBox = await input.boundingBox();
    assert(tallDockBox.height >= spec.minTallDock, `Tall dock too short at ${spec.width}x${spec.height}: ${tallDockBox.height}px`);
    assert(tallLogBox.height >= spec.minTallLog, `Tall log too short at ${spec.width}x${spec.height}: ${tallLogBox.height}px`);
    assert(tallDockBox.height >= defaultDockBox.height + 100, `Tall dock did not grow enough at ${spec.width}x${spec.height}`);
    assert(tallDockBox.y + tallDockBox.height <= spec.height + 1, `Tall dock overflows viewport vertically at ${spec.width}x${spec.height}`);
    assert(tallInputBox.y + tallInputBox.height <= spec.height + 1, `Input overflows viewport in tall mode at ${spec.width}x${spec.height}`);
    const dockOverflow = await dock.evaluate((node) => node.scrollWidth - node.clientWidth);
    assert(dockOverflow <= 1, `Terminal dock overflows horizontally by ${dockOverflow}px at ${spec.width}x${spec.height}`);
    await checkViewport(page);

    // 기본 크기로 복원 후 접으면 컴팩트한 바가 되고, 다시 펼치면 기본 크기로 돌아와요.
    await sizeBtn.click();
    assert.equal(await sizeBtn.innerText(), '크게 보기');
    assert.equal(await sizeBtn.getAttribute('aria-pressed'), 'false');
    const restoredDockBox = await dock.boundingBox();
    assert(Math.abs(restoredDockBox.height - defaultDockBox.height) <= 2,
      `Dock did not return to default height at ${spec.width}x${spec.height}`);

    await page.getByRole('button', { name: '터미널 접기', exact: true }).click();
    assert.equal(await dock.getAttribute('data-size'), 'closed');
    assert.equal(await input.isVisible(), false, `Input still visible after collapse at ${spec.width}x${spec.height}`);
    const recollapsedBox = await dock.boundingBox();
    assert(recollapsedBox.height <= 56, `Recollapsed terminal too tall at ${spec.width}x${spec.height}: ${recollapsedBox.height}px`);

    await page.getByRole('button', { name: '직접 입력해 보기', exact: true }).click();
    assert.equal(await dock.getAttribute('data-size'), 'default');
    assert.equal(await input.isVisible(), true, `Input did not reopen at ${spec.width}x${spec.height}`);
    assert(await input.evaluate((node) => node === document.activeElement),
      `Terminal input did not receive focus after reopen at ${spec.width}x${spec.height}`);
    const reopenedDockBox = await dock.boundingBox();
    assert(Math.abs(reopenedDockBox.height - defaultDockBox.height) <= 2,
      `Dock did not reopen to default height at ${spec.width}x${spec.height}`);
    assert.deepEqual(errors, []);
    await page.close();
  }
}

async function compactTerminalToggle(browser, url) {
  // 가로 모드 폰처럼 높이 420px 미만(compact)에서도 '크게 보기'가 실제로 커져야 해요.
  const page = await browser.newPage({ viewport: { width: 740, height: 360 } });
  page.setDefaultTimeout(9000);
  const errors = trackErrors(page, new URL(url).origin);
  await openChapter(page, url, 1);
  const shell = page.locator('.practice-shell');
  assert.notEqual(await shell.getAttribute('data-compact'), null, 'Compact mode not enabled under 420px height');
  const dock = page.getByRole('region', { name: '실습 터미널', exact: true });
  const input = page.getByTestId('terminal-input');
  const sizeBtn = page.getByTestId('terminal-size-toggle');
  await input.waitFor();
  const defaultBox = await dock.boundingBox();
  await sizeBtn.click();
  assert.equal(await sizeBtn.getAttribute('aria-pressed'), 'true');
  const tallBox = await dock.boundingBox();
  assert(tallBox.height >= defaultBox.height + 40,
    `Compact tall toggle did not grow the dock: ${defaultBox.height}px → ${tallBox.height}px`);
  assert(tallBox.y + tallBox.height <= 361, `Compact tall dock overflows the viewport: ${tallBox.height}px`);
  assert.equal(await dock.getAttribute('data-size'), 'tall');
  await checkViewport(page);
  assert.deepEqual(errors, []);
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
    await basicCertificate(browser, url);
    console.log('[QA] Basic-course certificate unlocks after chapters 1-4 passed');
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
    await crossTabDraftRace(browser, url);
    console.log('[QA] Storage failure warning, cross-tab sync, and pending-draft race passed');
    await advancedVisualCards(browser, url);
    console.log('[QA] Token scope and AI test result cards passed');
    await mobileLessonLayout(browser, url);
    console.log('[QA] Mobile lesson layout (contextual terms, button visible without scroll) passed');
    await advancedGuidedCompletion(browser, url);
    console.log('[QA] Advanced chapters 5-9 completed via guide buttons passed');
    await uxImprovements(browser, url);
    console.log('[QA] Non-dev UX improvements (inline unsaved compare, undo, file cards, pre-completion web guide, conflict button order) passed');
    await draftUndoProtection(browser, url);
    await fileCardStates(browser, url);
    console.log('[QA] Draft-safe undo, staged-plus-working cards, multi-stash cards and remote share status passed');
    await reviewRegressions(browser, url);
    console.log('[QA] Ordering guards (PR/main, conflict markers, GHES login, AI PR, ahead status) passed');
    await cycleOneRegressions(browser, url);
    console.log('[QA] Cycle 1 fixes (stash index, main refspec guard, worktree branch, PR numbering/dedupe, pull overlap, CI wording) passed');
    await terminalSizingAndUsability(browser, url);
    console.log('[QA] Terminal expanded/tall sizing, input width, and responsive layout checks passed');
    await compactTerminalToggle(browser, url);
    console.log('[QA] Compact (<420px) terminal tall toggle passed');

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
