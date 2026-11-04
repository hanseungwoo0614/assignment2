/**
 * 서버 API 자동 테스트 (node:test, 외부 라이브러리 없음)
 * 실행: npm test   (서버를 따로 켤 필요 없음 — 임의 포트로 직접 띄움)
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, POSTS } = require('../server');

let server;
let base;
before(() => new Promise((resolve) => {
  server = app.listen(0, () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));
after(() => server.close());

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json(), headers: res.headers };
};
const ids = (items) => items.map((p) => p.id);
const q = encodeURIComponent;

// ---------------- 검색·정렬 ----------------
test('[검색] 제목 검색: "커서" 가 들어간 글만 반환', async () => {
  const { body } = await get(`/api/posts?search=${q('커서')}&limit=100`);
  assert.ok(body.meta.totalCount > 0);
  for (const p of body.items) assert.ok(p.title.includes('커서') || p.content.includes('커서'));
});

test('[검색] 본문 검색: 본문에만 있는 "실행계획" 으로도 검색됨', async () => {
  const { body } = await get(`/api/posts?search=${q('실행계획')}&limit=100`);
  const expected = POSTS.filter((p) => p.content.includes('실행계획')).length;
  assert.equal(body.meta.totalCount, expected);
  assert.ok(expected > 0);
  assert.ok(body.items.every((p) => !p.title.includes('실행계획'))); // 제목엔 없음 → 본문으로 찾은 것
});

test('[검색] 결과 없음: items=[], totalCount=0, totalPages=1', async () => {
  const { body } = await get(`/api/posts?search=${q('없는검색어zzz')}`);
  assert.deepEqual(body.items, []);
  assert.equal(body.meta.totalCount, 0);
  assert.equal(body.meta.totalPages, 1);
  assert.equal(body.meta.hasNext, false);
});

test('[정렬] latest = id 내림차순, oldest = id 오름차순', async () => {
  const latest = await get('/api/posts?sort=latest&limit=100');
  const oldest = await get('/api/posts?sort=oldest&limit=100');
  assert.deepEqual(ids(latest.body.items), Array.from({ length: 100 }, (_, i) => 1000 - i));
  assert.deepEqual(ids(oldest.body.items), Array.from({ length: 100 }, (_, i) => i + 1));
});

test('[정렬] views = 조회수 내림차순, 동점이면 id DESC', async () => {
  let all = [];
  for (let page = 1; page <= 10; page++) {
    const { body } = await get(`/api/posts?sort=views&limit=100&page=${page}`);
    all = all.concat(body.items);
  }
  assert.equal(all.length, 1000);
  let ties = 0;
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1], b = all[i];
    assert.ok(a.views >= b.views, `조회수 순서 오류 @${i}`);
    if (a.views === b.views) { ties++; assert.ok(a.id > b.id, `동점 id DESC 오류 @${i}`); }
  }
  assert.ok(ties > 0, '동점 데이터가 있어야 검증 의미가 있음');
});

test('[정렬] 화이트리스트 밖 값 → latest', async () => {
  for (const bad of ['views; DROP TABLE posts--', 'title', 'VIEWS', '', 'id DESC']) {
    const { body } = await get(`/api/posts?sort=${q(bad)}`);
    assert.equal(body.meta.sort, 'latest', bad);
    assert.equal(body.items[0].id, 1000, bad);
  }
});

test('[정렬] __proto__, constructor 등 상속 속성 차단 → latest', async () => {
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    const { status, body } = await get(`/api/posts?sort=${bad}`);
    assert.equal(status, 200, bad);
    assert.equal(body.meta.sort, 'latest', bad);
    assert.deepEqual(ids(body.items), [1000, 999, 998, 997, 996, 995, 994, 993, 992, 991], bad);
  }
});

test('[정렬] sort 배열 파라미터(?sort=a&sort=b)도 500 없이 처리', async () => {
  const { status, body } = await get('/api/posts?sort=views&sort=__proto__&search=a&search=b');
  assert.equal(status, 200);
  assert.equal(body.meta.sort, 'views');
});

// ---------------- 오프셋 페이지네이션 ----------------
test('[오프셋] page 이동 시 offset·meta 정확', async () => {
  const { body } = await get('/api/posts?page=3&limit=10');
  assert.equal(body.meta.page, 3);
  assert.equal(body.meta.offset, 20);
  assert.equal(body.meta.totalCount, 1000);
  assert.equal(body.meta.totalPages, 100);
  assert.equal(body.meta.hasPrev, true);
  assert.equal(body.meta.hasNext, true);
  assert.deepEqual(ids(body.items), [980, 979, 978, 977, 976, 975, 974, 973, 972, 971]);
});

test('[오프셋] 마지막 페이지: hasNext=false', async () => {
  const { body } = await get('/api/posts?page=100&limit=10');
  assert.equal(body.meta.hasNext, false);
  assert.equal(body.items.length, 10);
  assert.equal(body.items.at(-1).id, 1);
});

test('[오프셋] page=0, -1, abc, 1.5, 빈값 → 1페이지', async () => {
  for (const bad of ['0', '-1', 'abc', '1.5', '', '1abc']) {
    const { body } = await get(`/api/posts?page=${bad}`);
    assert.equal(body.meta.page, 1, `page=${bad}`);
  }
});

test('[오프셋] 범위 초과 page=9999 → 마지막 페이지로 보정', async () => {
  const { body } = await get('/api/posts?page=9999');
  assert.equal(body.meta.page, 100);
  assert.equal(body.items.length, 10);
});

test('[오프셋] limit=1000 → 100 으로 제한, limit=0/-5/abc → 10', async () => {
  assert.equal((await get('/api/posts?limit=1000')).body.items.length, 100);
  assert.equal((await get('/api/posts?limit=1000')).body.meta.limit, 100);
  for (const bad of ['0', '-5', 'abc']) {
    assert.equal((await get(`/api/posts?limit=${bad}`)).body.meta.limit, 10, `limit=${bad}`);
  }
});

test('[오프셋] totalPages = ceil(totalCount / limit) (검색 결과 기준)', async () => {
  const { body } = await get(`/api/posts?search=${q('커서')}&limit=7`);
  assert.equal(body.meta.totalPages, Math.ceil(body.meta.totalCount / 7));
});

// ---------------- 커서 페이지네이션 ----------------
async function walkCursor(search, limit = 10) {
  const all = [];
  let cursor = null;
  let calls = 0;
  for (;;) {
    const params = new URLSearchParams({ limit });
    if (search) params.set('search', search);
    if (cursor) params.set('cursor', cursor);
    const { body } = await get('/api/posts/cursor?' + params);
    calls++;
    all.push(...body.items);
    if (!body.meta.hasNext) { assert.equal(body.meta.nextCursor, null); break; }
    cursor = body.meta.nextCursor;
    assert.ok(calls < 500, '무한 루프 방지');
  }
  return { all, calls };
}

test('[커서] 검색 없이 끝까지: 1000건 누락·중복 없음, id DESC', async () => {
  const { all, calls } = await walkCursor('', 10);
  assert.equal(all.length, 1000);
  assert.equal(new Set(ids(all)).size, 1000);
  assert.deepEqual(ids(all), Array.from({ length: 1000 }, (_, i) => 1000 - i));
  assert.equal(calls, 100);
});

test('[커서] 검색 + 커서: 끝까지 누락·중복 없이 검색 결과와 정확히 일치', async () => {
  for (const kw of ['커서', 'innodb', '실행계획', '#99']) {
    const expected = POSTS
      .filter((p) => (p.title + '\n' + p.content).toLowerCase().includes(kw.toLowerCase()))
      .map((p) => p.id).sort((a, b) => b - a);
    const { all } = await walkCursor(kw, 7);
    assert.deepEqual(ids(all), expected, kw);
  }
});

test('[커서] limit+1 로 hasNext 판단: 결과가 정확히 limit 개면 hasNext=false', async () => {
  // "#99" → 제목에 #99, #990~#999 가 포함 = 11건
  const { body: b11 } = await get(`/api/posts/cursor?search=${q('#99')}&limit=11`);
  assert.equal(b11.items.length, 11);
  assert.equal(b11.meta.hasNext, false);
  const { body: b10 } = await get(`/api/posts/cursor?search=${q('#99')}&limit=10`);
  assert.equal(b10.items.length, 10);
  assert.equal(b10.meta.hasNext, true);
});

test('[커서] 검색 결과 없음 → items=[], hasNext=false, nextCursor=null', async () => {
  const { body } = await get(`/api/posts/cursor?search=${q('없는검색어zzz')}`);
  assert.deepEqual(body.items, []);
  assert.equal(body.meta.hasNext, false);
  assert.equal(body.meta.nextCursor, null);
});

test('[커서] 정렬 기준은 id DESC 로 고정 (sort 파라미터 무시)', async () => {
  const { body } = await get('/api/posts/cursor?sort=views&limit=5');
  assert.equal(body.meta.sort, 'id_desc');
  assert.deepEqual(ids(body.items), [1000, 999, 998, 997, 996]);
});

test('[커서] 잘못된 cursor(abc, -1, 0) → 처음부터', async () => {
  for (const bad of ['abc', '-1', '0']) {
    const { body } = await get(`/api/posts/cursor?cursor=${bad}&limit=3`);
    assert.deepEqual(ids(body.items), [1000, 999, 998], bad);
  }
});

test('[공통] X-Response-Time 헤더 존재', async () => {
  const { headers } = await get('/api/posts');
  assert.match(headers.get('x-response-time'), /ms$/);
});

test('[보안] 서버 소스 파일은 정적 서빙되지 않음', async () => {
  const res = await fetch(base + '/server.js');
  assert.notEqual(res.status, 200);
});
