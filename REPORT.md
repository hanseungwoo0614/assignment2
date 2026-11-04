# 9주차 실습 2 보고서 · 검색·정렬·페이지네이션 게시판 개선

- 실행: `npm install` → `node server.js` → http://localhost:3000 / 자동 테스트: `npm test` (22개 통과)
- 순서: **기능 검증(원본) → 코드 개선 → 결과 확인**
- 표의 "원본 결과"는 수정 전 코드(첫 커밋)로 같은 요청을 보내 확인한 값입니다.

> 📸 캡처 표시가 있는 행은 해당 화면을 캡처해 첨부하세요. 우측 검사기의 **카운터·요청 로그·meta** 가 함께 보이게 찍으면 좋습니다.

---

## 1. 검색·정렬 (25점)

| # | 테스트 입력 | 기대 결과 | 원본 결과 | 수정 후 결과 |
|---|---|---|---|---|
| 1-1 | `/api/posts?search=커서` | 제목/본문에 "커서" 포함 글만 | 정상 | 정상 (84건) |
| 1-2 | `search=실행계획` (본문에만 있는 단어) | 본문 검색으로 조회됨 | 정상 | 정상 (167건, 제목엔 없음) 📸 하이라이트 |
| 1-3 | `search=없는검색어zzz` | `items=[]`, `totalCount=0`, "결과 없음" 안내 | 메시지만 표시 | `totalPages=1`, `hasNext=false`, "'없는검색어'에 대한 검색 결과가 없습니다" 📸 |
| 1-4 | `sort=latest` / `sort=oldest` | id 1000→ / id 1→ | 정상 | 정상 |
| 1-5 | `sort=views` 전체 1000건 | 조회수 내림차순, **동점은 id DESC** | 정상 (단, 조회수가 실행마다 랜덤) | 정상, 동점 쌍 다수 확인 (시드 고정으로 재현 가능) |
| 1-6 | `sort=views; DROP TABLE posts--`, `sort=title` | `latest` 로 처리 | latest | latest (`meta.sort` 로 확인 가능) |
| 1-7 | `sort=__proto__` | `latest` 로 처리 | **❌ 500 에러** `TypeError: The comparison function must be either a function or undefined` | ✅ latest, 200 |
| 1-8 | `sort=constructor`, `toString`, `valueOf` | `latest` 로 처리 | **❌ `Object` 함수가 비교 함수로 사용됨** (우연히 결과만 비슷) | ✅ latest |
| 1-9 | `search=a&search=b` (배열) | 에러 없이 처리 | **❌ 500 에러** (`.trim` is not a function) | ✅ 200, 첫 값 사용 |

**수정 내용**
```js
// 수정 전: 상속 속성(__proto__, constructor …)까지 조회됨
const sortComparator = SORT_WHITELIST[sortKey] || SORT_WHITELIST.latest;

// 수정 후: 객체 "자신의" 속성만 허용
function parseSort(v) {
  const s = single(v);                         // 배열·객체 파라미터 차단
  return s !== undefined && Object.hasOwn(SORT_WHITELIST, s) ? s : 'latest';
}
```
- `Object.freeze` 는 값 변경만 막을 뿐 프로토타입 체인 조회는 막지 못함 → `Object.hasOwn` 필요

## 2. 페이지네이션 (35점)

| # | 테스트 입력 | 기대 결과 | 수정 후 결과 |
|---|---|---|---|
| 2-1 | `page=3&limit=10` | offset 20, id 980~971, hasPrev/hasNext=true | 일치 |
| 2-2 | `page=100` | 마지막 페이지, hasNext=false | 일치 (마지막 id = 1) |
| 2-3 | `page=0`, `-1`, `abc`, `1.5`, `1abc` | 1페이지 | 일치 (원본은 `1.5`, `1abc` 를 parseInt 로 1 처리 — 결과는 같으나 의도치 않은 허용) |
| 2-4 | `page=9999` | 마지막 페이지로 보정 | page=100, 화면 URL 도 보정됨 |
| 2-5 | `limit=1000` | 100 으로 제한 | `items.length=100`, `meta.limit=100` |
| 2-6 | 4페이지에서 검색어 변경 / 정렬 변경 | 1페이지로 초기화 | `?page=4…` → `?page=1&sort=views…` 📸 |
| 2-7 | 커서 API `search=커서` (원본) | 검색 적용 | **❌ 원본: 검색 무시, 1000·999·998 반환** → ✅ 수정 후 검색 결과만 |
| 2-8 | 커서 + 검색 `커서/innodb/실행계획/#99`, limit=7 로 끝까지 | 누락·중복 없이 오프셋 검색 결과와 동일 | 4개 키워드 모두 일치 |
| 2-9 | 화면: 커서 모드 "커서" 검색 → 더 보기 8번 | 누적 = 오프셋 totalCount, 중복 0 | 누적 84건 = totalCount 84, 중복 0건, id 내림차순 📸 |
| 2-10 | `search=#99` limit=11 / limit=10 | 11건이므로 hasNext=false / true | 일치 (limit+1 판단) |
| 2-11 | 커서 모드 정렬 | id DESC 고정 | 정렬 선택 비활성화 + 안내 문구, `meta.sort="id_desc"` 📸 |
| 2-12 | 커서 모드에서 검색어 `커서` → `Redis` 변경 | 누적 목록·커서 초기화 | 84건 → 10건(새 검색), 커서 재시작 |
| 2-13 | 마지막까지 로드 / 결과 없음 | 더 보기 숨김 | 숨김, `nextCursor=null` 📸 |

**수정 내용 (커서 API)**
```js
// 검색 + 커서 조건을 함께 적용, limit+1 개 모이면 중단
for (const p of sorted) {                         // sorted = id DESC
  if (cursor !== null && p.id >= cursor) continue; // WHERE id < ?
  if (!matchSearch(p, search)) continue;           // AND (title LIKE ? OR content LIKE ?)
  sliced.push(p);
  if (sliced.length > limit) break;                // LIMIT limit + 1
}
const hasNext = sliced.length > limit;
const items = hasNext ? sliced.slice(0, limit) : sliced;
const nextCursor = hasNext ? items.at(-1).id : null;
```

## 3. 비동기 처리 (30점)

| # | 테스트 | 기대 결과 | 실제 결과 |
|---|---|---|---|
| 3-1 | "인덱스" 를 100ms 간격으로 입력 (인→인덱→인덱스) | 입력 이벤트 3회, 요청 1회 | 입력 3 / 요청 1 📸 카운터 |
| 3-2 | 느린 네트워크 체크 후 `커서` → `InnoDB` → `실행계획` 을 400ms 간격으로 입력 | 요청 3, 앞의 2개 취소, 최종 검색어 결과만 화면에 | 요청 3 / 취소 2 / 반영 1, 화면 = "실행계획" 결과 167건 📸 요청 로그 |
| 3-3 | 3-2 에서 취소된 요청 | 에러 화면 없이 무시 | 로그 "취소됨(AbortError)", 콘솔 `[AbortController] #n 이전 비동기 요청이 정상 취소되었습니다.` 📸 콘솔 |
| 3-4 | DevTools Network → Slow 3G(또는 시뮬레이션) 에서 빠르게 검색어 변경 | 이전 요청 `(canceled)` | 📸 Network 탭 직접 캡처 |

실제 요청 로그 (3-2):
```
#5 200 · 10건 · 1137ms  /api/posts?search=실행계획&page=1&sort=latest&delay=1123
#4 취소됨(AbortError)   /api/posts?search=InnoDB&page=1&sort=latest&delay=494
#3 취소됨(AbortError)   /api/posts?search=커서&page=1&sort=latest&delay=539
```

**수정 내용**
- 요청 시점의 조건을 `snap` 으로 고정 → 응답 처리 중 전역 `state` 가 바뀌어도 섞이지 않음
- `requestSeq` 로 최신 요청이 아니면 응답 무시 (abort 를 놓쳐도 이중 방어)
- `res.ok` 검사, 일반 에러는 에러 메시지 표시 / `AbortError` 는 화면 변경 없이 기록만
- 조회 버튼·Enter 시 대기 중인 디바운스 타이머 취소, 같은 검색어 재요청 생략

## 4. URL 상태 복원 (10점)

| # | 테스트 | 기대 결과 | 실제 결과 |
|---|---|---|---|
| 4-1 | 검색 "실행계획" → 4페이지 → 조회수순 → 3페이지 → 뒤로 | `page=1&sort=views` 화면 복원 | URL·정렬(views)·입력창·활성 페이지(1) 일치 |
| 4-2 | 한 번 더 뒤로 | `page=4&sort=latest` | 일치 (활성 페이지 4) |
| 4-3 | 앞으로 | `page=1&sort=views` | 일치 |
| 4-4 | `?page=999&sort=__proto__&search=InnoDB` 로 접속(새로고침) | 정규화된 상태로 복원 | URL → `?page=17&sort=latest&search=InnoDB`, 17/17 페이지 📸 |
| 4-5 | 커서 모드에서 새로고침 | 커서 모드·검색어 유지 | `?mode=cursor&search=…` 로 복원 |

## 5. 성능 관찰 (참고)

- `X-Response-Time` 헤더 및 `meta.executionTimeMs` 로 관찰. 1,000건 인메모리 배열이라 두 방식 모두 1ms 내외로 큰 차이는 없음
- 실제 DB 에서는 오프셋이 `OFFSET n` 만큼 행을 읽고 버리므로 뒤 페이지일수록 느려지고, 커서는 `id` 인덱스로 시작 위치를 바로 찾아 일정함 (과제 범위상 DB 실측은 생략)
