# 09주차 실습 패키지 · 대용량 검색·정렬·페이징 심화 (3학년 전공)

본 실습 패키지는 웹서비스설계 9주차 (3시간 마스터) 강의에서 다루는 **1,000건 대용량 데이터셋 기반 검색, 정렬 보안, 오프셋 vs 커서 페이지네이션, 프론트엔드 비동기 최적화**의 실제 구동 코드입니다.

---

## 🚀 빠른 실행 방법

```bash
# 1. 의존성 설치
npm install express

# 2. 백엔드 서버 구동
node server.js

# 3. 브라우저 접속
# http://localhost:3000
```

---

## 📂 파일 구성 및 엔지니어링 특징

### 1. `server.js` (Express 백엔드 API)
- **대량 데이터셋**: 1,000건의 인메모리 게시글 데이터 자동 시드.
- **방어적 파라미터 파싱**: `parseInt(..., 10)` 기수 명시, 음수 및 0 페이지 차단, `Math.min(..., 100)` 대량 조회 공격 방어.
- **ORDER BY 화이트리스트 보안**: `SORT_WHITELIST` 객체 매핑으로 SQL Injection 원천 봉쇄 및 `id DESC` 동점자 방지 2차 정렬 결합.
- **2대 페이징 API 제공**:
  - `GET /api/posts`: 오프셋 기반 페이징 (`LIMIT` / `OFFSET`, 표준 `meta` Envelope 응답)
  - `GET /api/posts/cursor`: 고성능 커서 기반 페이징 (`WHERE id < ? ORDER BY id DESC LIMIT 10`, `limit + 1` 패턴으로 `COUNT(*)` 제거)

### 2. `index.html` (SPA 프론트엔드 & 실시간 DevTools 검사기)
- **탭 모드 전환**: [오프셋 번호 페이징] ↔ [커서 기반 무한 스크롤] 즉시 비교.
- **실시간 디바운스 (300ms)**: 연속 타이핑 시 불필요한 API 요청 폭격 방지.
- **AbortController 비동기 방어**: 새 검색어 입력 시 이전 진행 중인 fetch 요청을 즉각 취소하여 Race Condition 버그 예방.
- **브라우저 히스토리 동기화**: `URLSearchParams`와 `history.pushState` 및 `window.onpopstate` 이벤트로 뒤로 가기 / 새로고침 상태 복원 지원.

---

## 🎯 3학년 전공 실습 과제 체크리스트

1. **정렬 보안**: `server.js`에서 허용되지 않은 정렬 키(예: `sort=views; DROP TABLE--`) 입력 시 안전하게 기본값(`latest`)으로 격리되는지 검증하세요.
2. **커서 페이징**: 100페이지 이상 스킵 시 오프셋 방식의 한계와 커서 방식의 속도 차이를 DevTools의 `X-Response-Time` 헤더로 측정해 보세요.
3. **Race Condition 실험**: `index.html`에서 빠른 타이핑 시 콘솔에 `[AbortController] 이전 비동기 요청이 정상 취소되었습니다` 로그가 정상 출력되는지 확인하세요.
