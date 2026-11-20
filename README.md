# GitDots

수정한 파일은 언제 GitHub에 올라갈까요? GitDots는 버튼을 누르거나 명령어를 입력하면서 픽셀 그림으로 결과를 확인하는 한국어 Git·GitHub 연습장이에요. 실습은 브라우저 속 예제 저장소에서 진행돼요. 설치나 GitHub 로그인 없이 시작할 수 있어요.

**[첫 커밋 실습 시작하기](https://flybywind2.github.io/git-pixel-dots/#/ch1)**

## 첫 커밋 만들어 보기

1장에는 이미 고친 `app.js`와 새로 만든 `style.css`가 준비되어 있어요. 화면 위쪽의 **실행** 버튼을 차례로 누르고, 단계마다 바구니와 두 저장소가 어떻게 달라지는지 살펴보세요.

| 실행할 명령 | 확인할 변화 |
| --- | --- |
| `git add .` | 두 파일의 변경이 바구니에 담겨요. 이 바구니가 다음 커밋에 넣을 내용을 고르는 **스테이징 영역**이에요. |
| `git commit -m "첫 세이브"` | 내 컴퓨터를 나타내는 **로컬 저장소**에 커밋이 하나 늘어요. 따옴표 안의 글은 변경에 붙이는 메시지예요. |
| `git push` | GitHub를 나타내는 **원격 저장소**가 방금 만든 커밋을 가리켜요. 이제 팀원도 그 변경을 받아 갈 수 있어요. |

직접 입력하려면 아래 터미널에 명령을 쓰고 Enter를 누르세요. **명령어 사전**에는 지금 배우는 용어와 실행할 수 있는 예제가 있어요. `resolve both`, `token fine`, `ai code`처럼 **실습 전용**으로 표시된 동작은 GitDots에서 상황을 재현하는 버튼이에요.

## 문서 편집과 비교

예제 `README.md`에서 스터디 시간이나 장소를 고치고 **문서 저장**을 누르세요. **변경 비교**의 `−`는 빠진 줄, `+`는 들어간 줄이에요. 직접 내용을 고치거나 **예시 수정 넣기**로 시작할 수 있어요. [문서 실습 시작하기](https://flybywind2.github.io/git-pixel-dots/#/docs)

| 비교 기준 | 무엇을 확인할 수 있나요? |
| --- | --- |
| 작업 중 · `git diff -- README.md` | 스테이징 영역을 기준으로, 저장한 작업 문서에서 더 바뀐 줄을 봐요. |
| 스테이징 · `git diff --staged -- README.md` | `git add README.md`로 다음 커밋에 담은 줄을 최근 커밋과 비교해요. |
| 커밋 이력 · `git diff HEAD~1 HEAD -- README.md` | 문서를 커밋한 뒤, 그 커밋과 바로 앞 커밋 사이에서 바뀐 줄을 봐요. |

## 배우고 싶은 장으로 이동하기

각 장은 준비된 예제로 시작해요. 처음 방문했다면 1~5장에서 첫 커밋부터 문서 비교와 팀 협업까지 이어서 연습할 수 있어요.

| 장 | 해 볼 일 |
| --- | --- |
| [1. 첫 커밋](https://flybywind2.github.io/git-pixel-dots/#/ch1) | 변경을 고르고, 커밋하고, GitHub에 올려요. |
| [2. 문서 편집과 비교](https://flybywind2.github.io/git-pixel-dots/#/docs) | README.md를 고쳐서 작업 문서, 스테이징 영역, 커밋의 변경을 비교해요. |
| [3. 보관과 취소](https://flybywind2.github.io/git-pixel-dots/#/ch2) | 하던 작업을 잠시 보관하고 실수로 넣은 변경을 되돌려요. |
| [4. 브랜치와 충돌](https://flybywind2.github.io/git-pixel-dots/#/ch3) | 두 브랜치가 같은 줄을 고쳤을 때 병합할 내용을 골라요. |
| [5. GitHub 협업](https://flybywind2.github.io/git-pixel-dots/#/ch4) | 팀에 변경을 제안하는 풀 리퀘스트(PR)를 열고 합쳐요. |
| [6. GitHub CLI](https://flybywind2.github.io/git-pixel-dots/#/ch5) | 터미널에서 PR과 이슈를 만들고 저장소 정보를 조회해요. |
| [7. 인증과 권한](https://flybywind2.github.io/git-pixel-dots/#/ch6) | 예제 토큰 두 개의 권한을 비교하고 SSH 키의 역할을 살펴봐요. |
| [8. 사내 GitHub](https://flybywind2.github.io/git-pixel-dots/#/ch7) | 회사가 운영하는 서버에 로그인하고 사내 실행기로 빌드해요. |
| [9. AI와 협업](https://flybywind2.github.io/git-pixel-dots/#/ch8) | AI가 별도 작업 폴더에서 고친 버그를 사람이 확인하고 합쳐요. |

현재 장을 다시 연습하려면 상단의 **초기화**를 누르세요. 다른 장으로 이동했다 돌아오거나 페이지를 새로 고치면 해당 장의 예제가 처음 상태로 열려요.
