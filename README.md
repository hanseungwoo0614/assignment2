# 9주차 실습 2 · 검색·정렬·페이지네이션 게시판 개선

1,000건 인메모리 게시글에서 **제목·본문 검색 / 정렬 / 오프셋·커서 페이지네이션 / 디바운스·요청 취소 / URL 상태 복원**을 구현·검증한 실습입니다.
첨부 예제(`week09-practice.zip`)를 기반으로 수정했고, 수정 전 원본은 첫 커밋에 그대로 남겨 두었습니다 (`git diff HEAD~1` 또는 GitHub 커밋 비교로 확인).

## 실행 방법

```bash
npm install        # express 설치 (node_modules 는 저장소에 포함하지 않음)
node server.js     # http://localhost:3000 접속
npm test           # API 자동 테스트 22개 (서버를 따로 켤 필요 없음)
```

- Node.js 18 이상 필요 (`fetch`, `node:test`, `Object.hasOwn` 사용). 개발 환경: Node 24, Express 5
- 느린 네트워크 실험: 화면의 **[느린 네트워크 시뮬레이션]** 체크 → 요청마다 서버가 300~2000ms 무작위 지연 (`?delay=ms`, 최대 3000)

## 파일 구성

| 파일 | 역할 |
|---|---|
| `server.js` | Express API. `GET /api/posts`(오프셋), `GET /api/posts/cursor`(커서) |
| `index.html` | SPA 클라이언트 + 검사기(요청 로그, 입력/요청/취소 카운터, SQL·meta 표시) |
| `test/api.test.js` | 서버 API 자동 테스트 (`node:test`) |
| `REPORT.md` | 항목별 테스트 입력·기대·실제 결과, 수정 내용 정리 |

## API

### `GET /api/posts?page=&limit=&sort=&search=` (오프셋)

| 파라미터 | 규칙 |
|---|---|
| `page` | 양의 정수만. `0, -1, abc, 1.5, 1abc` → 1. 마지막 페이지 초과 → 마지막 페이지 |
| `limit` | 양의 정수, 최대 100 (`1000` → 100). 잘못된 값 → 10 |
| `sort` | `latest`(id DESC) / `oldest`(id ASC) / `views`(views DESC, id DESC). 그 외 전부 `latest` |
| `search` | 제목 **또는** 본문 포함 검색(대소문자 무시), 최대 50자 |

응답 `meta`: `page, requestedPage, limit, offset, sort, search, totalCount, totalPages, hasNext, hasPrev, executionTimeMs`

### `GET /api/posts/cursor?cursor=&limit=&search=` (커서)

- 정렬은 **id 내림차순 고정** (`sort` 파라미터 무시, 응답 `meta.sort = "id_desc"`). 화면에서도 정렬 선택을 비활성화
- 조건: `(제목/본문 검색) AND id < cursor` → `limit + 1`개까지만 조회 → `hasNext` 판단
- 응답 `meta`: `cursor, nextCursor(마지막이면 null), limit, search, hasNext, executionTimeMs`

## 개념 설명

### ① 오프셋 vs 커서 — 어떤 화면에 적합한가

| | 오프셋 (`LIMIT ? OFFSET ?`) | 커서 (`WHERE id < ? ORDER BY id DESC LIMIT ?`) |
|---|---|---|
| 적합한 화면 | 관리자 게시판, 검색 결과 목록처럼 **"7페이지로 바로 이동"·전체 개수 표시**가 필요한 곳 | SNS 피드, 댓글, 채팅, 알림처럼 **"더 보기"·무한 스크롤**로 이어 보는 곳 |
| 장점 | 임의 페이지 이동, 총 페이지 수 표시, 정렬 자유로움 | 뒤 페이지도 일정한 속도(인덱스로 커서 위치를 바로 찾음), 중간에 새 글이 추가돼도 중복·누락 없음 |
| 단점 | OFFSET이 커질수록 앞의 행을 읽고 버림 → 느려짐. 조회 중 글이 추가/삭제되면 다음 페이지에 중복·누락 발생 | 특정 페이지로 점프 불가, 커서로 쓸 수 있는 **유일하고 정렬된 키**가 필요 (그래서 id DESC 고정) |

### ② 디바운스와 요청 취소의 역할

- **디바운스(300ms)**: 입력이 멈춘 뒤 300ms 동안 추가 입력이 없을 때만 요청을 보냄 → "인덱스"를 빠르게 치면 입력 이벤트는 여러 번이지만 요청은 **1회**. 서버 부하와 불필요한 렌더링을 줄인다. *요청의 개수*를 줄이는 장치.
- **요청 취소(AbortController)**: 디바운스를 지나 이미 나간 요청이라도, 새 요청을 보낼 때 이전 요청을 `abort()` 한다. 네트워크가 느리면 먼저 보낸 요청의 응답이 나중에 도착해 **최신 결과를 덮어쓰는 경쟁 상태(race condition)** 가 생기는데 이를 막는다. *응답의 순서*를 보장하는 장치.
- 취소된 fetch 는 `AbortError` 로 reject 되므로 `catch` 에서 `err.name === 'AbortError'` 를 구분해 **에러 화면을 띄우지 않고 무시**한다. 추가로 요청 번호(`requestSeq`)를 비교해, 최신 요청이 아닌 응답은 화면에 반영하지 않도록 이중 방어했다.
- 둘은 대체 관계가 아니라 보완 관계: 디바운스만 있으면 300ms 이상 간격으로 입력할 때 race 가 생기고, 취소만 있으면 키 입력마다 요청이 나간다.

### ③ `limit + 1` 원리

다음 페이지가 있는지 알려면 원래 `COUNT(*)` 로 전체 개수를 세야 하지만, 커서 방식은 **필요한 것보다 1개 더(limit + 1개)** 요청한다.

- 받아온 개수 `> limit` → 다음 데이터가 존재 → `hasNext = true`, 화면에는 앞의 `limit`개만 보여주고 그 마지막 id 를 `nextCursor` 로 사용
- 받아온 개수 `≤ limit` → 마지막 페이지 → `hasNext = false`, `nextCursor = null`, 더 보기 버튼 숨김

예) 검색 결과가 정확히 11건이고 `limit=11` → 12개를 요청했는데 11개만 옴 → `hasNext=false` (빈 페이지를 한 번 더 요청하지 않음). `limit=10` → 11개가 옴 → `hasNext=true`. 이 경우를 `npm test` 에서 검증한다.

### ④ `offset`·`totalPages` 계산식

```
offset     = (page - 1) × limit
totalPages = max(1, ceil(totalCount / limit))
page       = min(요청 page, totalPages)      // 범위를 넘으면 마지막 페이지
hasNext    = page < totalPages,  hasPrev = page > 1
```

예) 전체 1000건, limit 10 → totalPages = 100, 3페이지의 offset = 20 (id 980~971).
검색 "InnoDB" 167건, limit 10 → totalPages = ceil(16.7) = 17, 17페이지 offset = 160 (7건).
결과가 0건이어도 totalPages 는 1 (빈 1페이지)로 두어 `page`가 0이 되는 것을 막는다.

## 원본 대비 주요 수정 사항

자세한 내용과 테스트 결과는 [REPORT.md](REPORT.md) 참고.

**server.js**
1. 정렬 키 검증을 `SORT_WHITELIST[key] || latest` → `Object.hasOwn(SORT_WHITELIST, key)` 로 변경 — 원본은 `sort=__proto__` 에서 **500 에러(TypeError)**, `constructor` 는 `Object` 함수가 비교 함수로 쓰임
2. 쿼리 값이 배열(`?search=a&search=b`)이면 원본은 `.trim()` 에서 **500 에러** → 문자열 하나만 받도록 `single()` 처리
3. `parseInt` 가 `1abc`, `1.5` 를 1 로 받아주던 것을 정규식으로 순수 정수만 허용
4. **커서 API 에 제목·본문 검색 추가**, id DESC 정렬 명시, limit+1개 모이면 탐색 중단, 마지막 페이지에서 `nextCursor = null`
5. `meta` 에 `offset, sort, search, requestedPage, mode` 추가 (적용된 값을 응답으로 확인 가능)
6. `express.static(__dirname)` 이 `server.js` 소스까지 노출 → `/` 에서 `index.html` 만 서빙
7. 테스트 재현성을 위해 조회수를 시드 고정 난수로 생성(동점 데이터 다수 포함), 작성일을 id 순서와 일치시킴, 일부 글 본문에만 있는 키워드 추가(본문 검색 검증용)
8. 느린 네트워크 실험용 `delay` 파라미터 추가

**index.html**
1. 커서 모드에서도 검색어 적용, 검색어 변경 시 누적 목록·커서 초기화
2. 커서 모드에서 정렬 선택 비활성화 + "id 내림차순 고정" 안내
3. `hasNext=false` 이면 더 보기 버튼 숨김
4. 요청 시점 조건을 스냅샷으로 고정하고 요청 번호로 오래된 응답 차단 (AbortController + 이중 방어), `res.ok` 확인
5. URL ↔ 상태 동기화 정리: 잘못된 `sort/page` 는 정규화해 `replaceState`, 서버가 보정한 page 도 URL 에 반영, 같은 URL 중복 push 방지, 커서 모드도 `mode=cursor` 로 복원
6. 조회 버튼·Enter 시 대기 중인 디바운스 타이머 취소 후 즉시 조회
7. 결과 없음 메시지에 검색어 표시, 검색어 하이라이트, `innerHTML` 출력 시 HTML 이스케이프(XSS 방지)
8. 검사기에 입력/요청/취소/반영 카운터와 요청 로그 추가, SQL 을 `?` 파라미터 바인딩 형태로 표시

## AI 활용 내역

- **사용 도구**: Claude (Claude Code)
- **AI가 한 부분**: 원본 코드의 문제점 분석, `server.js`·`index.html` 수정 코드 작성, `test/api.test.js` 테스트 작성, README·보고서 초안 작성
- **직접 검증한 부분**: *(직접 확인한 내용으로 수정해서 제출하세요)*
  - [ ] `npm test` 22개 통과 확인
  - [ ] 원본 코드에서 `sort=__proto__` 500 에러 재현 확인
  - [ ] 브라우저에서 빠르게 타이핑 → 입력 이벤트 N회 / API 요청 1회 확인
  - [ ] 느린 네트워크 체크 후 검색어 변경 → 이전 요청 "취소됨(AbortError)", 최종 검색어 결과만 표시 확인 (DevTools Network 탭에서 canceled 확인)
  - [ ] 커서 모드에서 검색 후 끝까지 더 보기 → 누적 건수 = 오프셋 totalCount, 중복 0건 확인
  - [ ] 새로고침·뒤로 가기 후 URL·입력창·정렬·목록 일치 확인
