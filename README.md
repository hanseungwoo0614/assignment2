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
