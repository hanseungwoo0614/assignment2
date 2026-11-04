/**
 * 웹서비스설계 9주차 실습 2 · 검색·정렬·페이지네이션 게시판 개선 (Express + 1,000건 인메모리 데이터)
 *
 *   1) 방어적 파라미터 파싱 (page/limit 정수 검증, limit 상한 100, 배열·객체 파라미터 차단)
 *   2) 정렬 키 화이트리스트 (Object.hasOwn 으로 __proto__/constructor 등 상속 속성 차단)
 *   3) 오프셋 페이징 API  GET /api/posts         (검색 + 정렬 + page/limit + meta)
 *   4) 커서 페이징 API    GET /api/posts/cursor  (검색 + id DESC 고정 + limit+1 로 hasNext 판단)
 *
 * 실행: npm install → node server.js → http://localhost:3000
 */

const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// [수정] express.static(__dirname) 은 server.js·package.json 까지 노출 → index.html 만 서빙
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ------------------------------------------------------------
// 1,000건 더미 데이터
//  - [수정] 조회수를 시드 고정 난수로 생성 → 서버를 재시작해도 같은 데이터, 테스트 재현 가능
//  - [수정] 조회수 범위를 좁혀(10~509) 동점 데이터가 충분히 생기도록 함 → "동점 시 id DESC" 검증용
// ------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261115);

const TOPICS = [
  'B-Tree 인덱스 구조와 LIKE %kw% 검색 튜닝 실무',
  '커서 기반(Keyset) 페이지네이션 O(log N) 탐색 원리',
  'ORDER BY SQL Injection과 화이트리스트 매핑 방어',
  'InnoDB 버퍼 풀과 LIMIT OFFSET Cache Thrashing',
  'AbortController를 이용한 비동기 Race Condition 방어',
  '300ms 디바운스(Debounce)와 프론트엔드 입력 최적화',
  'URLSearchParams와 history.pushState 뒤로가기 동기화',
  'InnoDB MVCC 메커니즘과 COUNT(*) 전수 스캔 병목',
  '복합 인덱스(Compound Index) 컬럼 순서의 황금률',
  'Redis 분산 캐시를 활용한 카운트 캐싱 아키텍처',
  'RESTful JSON 페이징 Envelope 규격 표준화',
  'ElasticSearch 역색인(Inverted Index)과 N-gram 전문 검색'
];
const AUTHORS = ['이경수', '김철수', '이영희', '박민수', '정다은', '최준호', '강서연', '윤성호'];

// [수정] 본문 검색을 검증할 수 있도록 본문에만 등장하는 키워드를 일부 글에 넣음
const CONTENT_TAGS = ['', '', '', ' 참고 키워드: 실행계획(EXPLAIN).', '', ' 참고 키워드: 트랜잭션 격리수준.'];

const BASE_DATE = Date.UTC(2026, 9, 31); // 2026-10-31
const POSTS = Array.from({ length: 1000 }, (_, i) => {
  const id = 1000 - i;
  return {
    id,
    title: `[#${id}] ${TOPICS[i % TOPICS.length]}`,
    content: `게시글 ${id}번의 상세 본문 데이터입니다. DB 인덱스와 페이징 최적화를 실습합니다.${CONTENT_TAGS[i % CONTENT_TAGS.length]}`,
    author: AUTHORS[i % AUTHORS.length],
    views: Math.floor(rand() * 500) + 10,
    // [수정] 작성일이 id 순서와 일치하도록(최신 글 = 큰 id) 하루에 약 3건씩 과거로
    createdAt: new Date(BASE_DATE - Math.floor(i / 3) * 86400000).toISOString().slice(0, 10)
  };
});

// ------------------------------------------------------------
// 정렬 화이트리스트 (모든 정렬의 마지막 기준은 id → 동점 시 순서 고정)
// ------------------------------------------------------------
const SORT_WHITELIST = Object.freeze({
  latest: (a, b) => b.id - a.id,
  oldest: (a, b) => a.id - b.id,
  views: (a, b) => (b.views !== a.views ? b.views - a.views : b.id - a.id)
});
const DEFAULT_SORT = 'latest';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const MAX_SEARCH_LEN = 50;

// ------------------------------------------------------------
// 파라미터 파서 (공통)
// ------------------------------------------------------------

// 쿼리 값을 "문자열 하나"로만 받는다. ?sort=a&sort=b 처럼 배열이 오면 첫 값만, 객체면 무시
function single(v) {
  if (Array.isArray(v)) v = v[0];
  return typeof v === 'string' ? v : undefined;
}

// [수정] "1abc", "1.5", "1e3" 같은 값을 parseInt 가 1 로 받아주던 문제 → 순수 정수만 허용
function parsePositiveInt(v, fallback) {
  const s = single(v);
  if (s === undefined || !/^\d+$/.test(s.trim())) return fallback;
  const n = Number(s.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

function parseLimit(v) {
  return Math.min(parsePositiveInt(v, DEFAULT_LIMIT), MAX_LIMIT);
}

// [수정] SORT_WHITELIST[key] 는 '__proto__', 'constructor', 'toString' 등 상속 속성도 찾아버림
//        → Object.hasOwn 으로 "자기 자신의 속성"만 허용, 나머지는 전부 latest
function parseSort(v) {
  const s = single(v);
  return s !== undefined && Object.hasOwn(SORT_WHITELIST, s) ? s : DEFAULT_SORT;
}

function parseSearch(v) {
  const s = single(v);
  return s === undefined ? '' : s.trim().slice(0, MAX_SEARCH_LEN);
}

// 제목·본문 검색 (WHERE title LIKE ? OR content LIKE ?) — 오프셋/커서 공통 사용
function matchSearch(post, keyword) {
  if (!keyword) return true;
  const kw = keyword.toLowerCase();
  return post.title.toLowerCase().includes(kw) || post.content.toLowerCase().includes(kw);
}

// [추가] 느린 네트워크 실험용 지연 (?delay=ms, 최대 3000ms). 실제 서비스에서는 제거
function parseDelay(v) {
  const s = single(v);
  if (s === undefined || !/^\d+$/.test(s)) return 0;
  return Math.min(Number(s), 3000);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function elapsedMs(start) {
  const [s, ns] = process.hrtime(start);
  return Number((s * 1000 + ns / 1e6).toFixed(2));
}

// ==========================================
// 1. 오프셋 기반 페이지네이션
// GET /api/posts?page=1&limit=10&sort=views&search=인덱스
// ==========================================
app.get('/api/posts', async (req, res) => {
  const delay = parseDelay(req.query.delay);
  if (delay) await sleep(delay);
  const startTime = process.hrtime();

  const requestedPage = parsePositiveInt(req.query.page, 1); // 0, -1, abc, 1.5 → 1
  const limit = parseLimit(req.query.limit);                 // 1000 → 100
  const sort = parseSort(req.query.sort);                    // 허용되지 않은 값 → latest
  const search = parseSearch(req.query.search);

  // 1) 검색 → 2) 정렬 (filter 가 새 배열을 반환하므로 원본 POSTS 는 변경되지 않음)
  const filtered = POSTS.filter((p) => matchSearch(p, search)).sort(SORT_WHITELIST[sort]);

  // 3) 오프셋 계산
  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const page = Math.min(requestedPage, totalPages); // 마지막 페이지를 넘으면 마지막 페이지로
  const offset = (page - 1) * limit;
  const items = filtered.slice(offset, offset + limit);

  const executionTimeMs = elapsedMs(startTime);
  res.setHeader('X-Response-Time', `${executionTimeMs}ms`);
  res.json({
    items,
    meta: {
      mode: 'offset',
      page,
      requestedPage,
      limit,
      offset,
      sort,
      search,
      totalCount,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      executionTimeMs
    }
  });
});

// ==========================================
// 2. 커서 기반(Keyset) 페이지네이션
// GET /api/posts/cursor?cursor=950&limit=10&search=인덱스
//  - 정렬은 id DESC 로 고정 (커서 = 마지막으로 받은 글의 id)
//  - SQL: WHERE (title LIKE ? OR content LIKE ?) AND id < ? ORDER BY id DESC LIMIT limit+1
// ==========================================
app.get('/api/posts/cursor', async (req, res) => {
  const delay = parseDelay(req.query.delay);
  if (delay) await sleep(delay);
  const startTime = process.hrtime();

  const cursor = parsePositiveInt(req.query.cursor, null); // 잘못된 커서 → 처음부터
  const limit = parseLimit(req.query.limit);
  const search = parseSearch(req.query.search);

  // [수정] 검색 조건 + 커서 조건을 함께 적용하고, id DESC 를 명시적으로 보장
  // [수정] limit+1 개만 모으면 즉시 중단 (실제 DB 의 LIMIT 처럼 전체를 끝까지 훑지 않음)
  const sorted = POSTS.slice().sort((a, b) => b.id - a.id);
  const sliced = [];
  for (const p of sorted) {
    if (cursor !== null && p.id >= cursor) continue;
    if (!matchSearch(p, search)) continue;
    sliced.push(p);
    if (sliced.length > limit) break; // limit + 1 개 확보
  }

  const hasNext = sliced.length > limit;             // 한 개 더 있으면 다음 페이지 존재
  const items = hasNext ? sliced.slice(0, limit) : sliced;
  const nextCursor = hasNext ? items[items.length - 1].id : null; // [수정] 끝이면 null

  const executionTimeMs = elapsedMs(startTime);
  res.setHeader('X-Response-Time', `${executionTimeMs}ms`);
  res.json({
    items,
    meta: {
      mode: 'cursor',
      sort: 'id_desc', // 커서 모드 정렬 기준 고정
      cursor,
      nextCursor,
      limit,
      search,
      hasNext,
      executionTimeMs
    }
  });
});

// 없는 API 경로는 JSON 404
app.use('/api', (req, res) => res.status(404).json({ error: 'Not Found' }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('====================================================');
    console.log('웹서비스설계 9주차 실습 서버 구동 완료');
    console.log(`URL: http://localhost:${PORT}`);
    console.log('데이터: 1,000건의 인메모리 게시글');
    console.log('====================================================');
  });
}

module.exports = { app, POSTS };
