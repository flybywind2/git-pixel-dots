# GitDots · 회의록으로 연습하는 Git

회의록을 고치다 보면 어느 줄이 바뀌었는지 찾거나, 실수로 바꾼 내용을 돌려놓아야 할 때가 있어요. GitDots에서 스터디 회의록을 직접 고치고, 바뀐 줄을 비교한 뒤 새 기록으로 남겨 보세요. 이 브라우저 안의 예제 저장소에서 실습해요.

**[1장 회의록 실습 시작하기](https://flybywind2.github.io/git-pixel-dots/#/chapter/1)**

## 회의록 고치고 비교하기

1. `회의록.md`에서 스터디 시간이나 장소를 바꾼 뒤 **문서 저장**을 누르세요.
2. **바뀐 줄 확인하기**를 눌러 빠진 줄(−)과 들어간 줄(+)을 찾아보세요.
3. **다음 기록에 담기**로 변경을 고른 뒤 **기록 남기기**를 누르면 새 커밋이 생겨요. 마지막 변경을 취소해 보면 파일이 예전 내용으로 돌아오는 것도 확인할 수 있어요.

| 비교 기준 | 확인할 수 있는 내용 |
| --- | --- |
| 바뀐 줄 · `git diff -- 회의록.md` | 지금 저장한 문서에서 스테이징 영역과 다른 줄 |
| 담아 둔 변경 · `git diff --staged -- 회의록.md` | 최근 커밋 이후 다음 기록에 담아 둔 변경 |
| 이전 기록 · `git diff HEAD~1 HEAD -- 회의록.md` | 바로 이전 커밋과 최근 커밋 사이에 바뀐 줄 |

화면 아래 **직접 입력해 보기**를 누르면 실습 터미널이 열려요. 명령을 입력하고 Tab을 눌러 후보를 순환하거나, **명령어 사전**에서 다른 장의 예제까지 검색할 수 있어요.

편집 중인 문서, 장별 진행 상태, 마지막 캐릭터 안내는 이 브라우저에 저장돼요. 새로고침하거나 다른 장에서 돌아와도 이어서 할 수 있어요. 처음부터 다시 하려면 **현재 장 초기화**를 눌러 확인하세요.

## 기본 과정

1~4장에서 스터디 회의록을 고치고, 기록을 공유하고, 실수를 되돌린 뒤 팀에 검토를 요청해요.

| 장 | 해 볼 일 |
| --- | --- |
| [1. 문서 편집과 비교](https://flybywind2.github.io/git-pixel-dots/#/chapter/1) | 회의록을 고치고 기록에 담긴 줄을 비교해요. |
| [2. 변경 기록과 공유](https://flybywind2.github.io/git-pixel-dots/#/chapter/2) | 회의록과 참석 안내를 새 커밋에 담아 팀에 공유해요. |
| [3. 보관과 취소](https://flybywind2.github.io/git-pixel-dots/#/chapter/3) | 실수로 담은 비밀 메모를 장바구니에서 빼고, 회의록 수정을 잠시 보관한 뒤 잘못 올린 임시 안내를 취소해요. |
| [4. GitHub 협업](https://flybywind2.github.io/git-pixel-dots/#/chapter/4) | 새 브랜치에 모임 장소 수정을 기록하고, 풀 리퀘스트(PR)로 팀원 승인을 받아 합친 뒤 내 컴퓨터로 가져와요. |

## 예측 퀴즈 · 잔디 · 수료증

- 핵심 단계는 추천 버튼을 누르면 실행 전에 **예측 퀴즈**가 열려요. 보기를 고르면 정답·해설을 보여 주고 **계속하기**로 실행해요. 건너뛰고 실행할 수도 있어요.
- 머리글의 **잔디** 9칸은 장을 마칠 때마다 초록으로 차고, 옆에 완료한 장 수가 보여요.
- **기본 1~4장을 마치면 기본 과정 수료증**을, 9장 모두 마치면 심화 완주 문구의 수료증을 받을 수 있어요. 이름(선택)을 넣고 PNG로 저장해 공유할 수 있어요. 수료증 날짜는 과정을 마친 날로 기록돼요.

## 심화 실습

| 장 | 해 볼 일 |
| --- | --- |
| [5. 브랜치와 충돌](https://flybywind2.github.io/git-pixel-dots/#/chapter/5) | 두 브랜치가 같은 줄을 고쳤을 때 합칠 내용을 골라요. |
| [6. GitHub CLI](https://flybywind2.github.io/git-pixel-dots/#/chapter/6) | 터미널에서 이슈를 등록하고 자동 검사를 지켜보며 저장소를 조회해요. |
| [7. 인증과 권한](https://flybywind2.github.io/git-pixel-dots/#/chapter/7) | 예제 토큰의 권한을 비교하고 SSH 키의 역할을 살펴봐요. |
| [8. 사내 GitHub](https://flybywind2.github.io/git-pixel-dots/#/chapter/8) | 회사가 운영하는 서버에 로그인하고 사내 실행기로 빌드해요. |
| [9. AI와 협업](https://flybywind2.github.io/git-pixel-dots/#/chapter/9) | AI가 별도 작업 폴더에서 고친 버그를 사람이 확인하고 합쳐요. |

## GitHub 웹에서 이어 하기

앱의 1장과 4장에서도 이 안내를 열 수 있어요.

- 파일을 열고 연필 버튼으로 수정한 뒤 **Commit changes**에서 변경 메시지를 남길 수 있어요. 다른 브랜치나 포크로 변경을 제안할 때는 **Propose changes**가 표시될 수 있어요. [GitHub 파일 편집 안내](https://docs.github.com/ko/repositories/working-with-files/managing-files/editing-files)
- 새 브랜치의 변경을 제안하려면 **Compare & pull request**에서 대상 브랜치를 확인하고 **Create pull request**를 누르세요. [GitHub 풀 리퀘스트 안내](https://docs.github.com/ko/pull-requests/how-tos/create-pull-requests/creating-a-pull-request)

## 로컬에서 실행하기

Node.js 22 이상이 필요해요.

```bash
npm install
npm run dev      # 개발 서버 (http://localhost:5173)
npm test         # 단위 테스트
npm run build    # 타입 검사 + 프로덕션 빌드
npm run qa:visual  # 빌드 결과 브라우저 검증 (Chromium 필요)
```

픽셀 글꼴 GitDots Pixel은 Galmuri11 2.40.3에서 캔버스와 이름표에 쓰는 글자를 추린 버전이에요. 라벨에 새 글자를 추가한 뒤에는 `fonttools[woff]`가 설치된 환경에서 `python scripts/subset-pixel-font.py /경로/Galmuri11.woff2`로 다시 만들 수 있어요. CI는 `python scripts/subset-pixel-font.py --check`로 캔버스와 이름표에 필요한 글자를 검사해요. [Galmuri 라이선스](public/licenses/Galmuri-OFL.txt)
