# 퀴즈 기능 개선 정리 (2026-02)

## 문서 목적

최근 반영한 퀴즈 관련 개선사항을 한 곳에 정리하여, UI/동작/데이터 처리 기준을 빠르게 파악할 수 있도록 한다.

## 적용 범위

- 퀴즈/연습 화면 UI
- SRS 저장 안정성
- 하단 퀴즈 배지 동기화
- 단어 페이지에서 즉시 퀴즈 시작
- 중간 이탈 시 SRS 세션 복원

## 1) 용어 정리

- 단어장 진입 플로우의 용어를 `퀴즈`에서 `연습`으로 정리
  - `단어장 퀴즈` → `단어장 연습`
  - `퀴즈 시작`(단어장 문맥) → `연습 시작`

## 2) 카드 UI 개선

### 2-1. 공통 무드 정리

- `flashcard`와 `practice-flashcard` 버튼 팔레트를 저채도 톤으로 정리
- 강한 원색을 줄여 다크 테마에서 눈부심을 완화

### 2-2. 개별 버튼 톤 조정

- `flashcard`의 `어려움(Hard)` 버튼은 `primary` 톤으로 강조
- `practice-flashcard`는 우선순위 변경 로직을 유지한 상태에서 UI만 조정

## 3) 로딩 렌더링 구조 개선

- 기존: `quiz/page.tsx`에서 로딩 UI를 직접 렌더
- 변경: 각 카드 컴포넌트 내부에서 로딩 처리
  - `Flashcard`가 자체 로딩 UI 렌더
  - `PracticeFlashcard`가 자체 로딩 UI 렌더

의도:
- 모드별 버튼 구성이 섞이지 않도록 컴포넌트 책임 분리
- 로딩 상태와 실제 카드 UI의 결합도 감소

## 4) 우선순위 저장 경로 정정

### 문제

- 연습 모드에서 우선순위 변경 시 `words.update()` 경로를 타며 권한/행 미존재 이슈가 발생할 수 있었음.

### 수정

- `WordRepository.setPriority(id, priority)` API 추가
- 연습 모드 우선순위 저장은 항상 `user_word_state`만 업데이트하도록 고정
- `quiz/page.tsx`의 연습 우선순위 처리에서 `repo.words.setPriority(...)` 사용

## 5) SRS 저장 안정성 강화

### 문제

- 일부 레거시/비정상 `study_progress` 레코드에서 FSRS 계산 결과가 비정상 값이 되어
  - `Invalid time value`
  - `stability NOT NULL` 제약 위반
  가 발생할 수 있었음.

### 수정

- `SupabaseStudyRepository.recordReview`에 데이터 정규화/방어 로직 추가
  - 날짜 유효성 보정
  - 숫자 finite 검사 및 fallback 적용
- `handleRate`에 예외 처리 추가하여 unhandled promise로 화면이 깨지지 않도록 보호

## 6) 하단 퀴즈 배지 즉시 동기화

### 기존

- 60초 주기 polling 중심

### 변경

- 즉시 갱신 이벤트 기반 동기화 추가
  - `requestDueCountRefresh()` 이벤트 발행/구독
  - 퀴즈 평가/암기 완료 시 즉시 갱신
  - 퀴즈 페이지 이탈(unmount) 시 갱신
  - `BottomNav`에서 `focus`, `visibilitychange`, `pathname` 변경 시 재조회

## 7) 중간 이탈 대응

정책:
- **SRS 모드만 복원**
- **연습 모드는 복원하지 않음**

SRS 복원 동작:
- `localStorage`에 현재 세션 스냅샷 저장
  - 현재 단어 ID
  - 완료 수(`completed`)
  - 세션 통계(`sessionStats`)
  - 갱신 시각
- TTL(24시간) 내 재진입 시 복원
- 세션 완료/빈 세션/새 세션 시작 시 스냅샷 제거

## 8) 단어 페이지 즉시 퀴즈 시작

- 단어 목록 페이지 하단에 `퀴즈 시작` 버튼 추가
- `/quiz?quickStart=1` 진입 시:
  - 퀴즈 설정의 `newPerDay`를 읽음
  - 비암기 단어에서 랜덤으로 `newPerDay`개 선택
  - 즉시 퀴즈 세션 구성
- `quickStart`는 매번 새 세션으로 시작(복원 미적용)

## 9) 점검 체크리스트

- 단어장 연습 화면 용어가 `연습`으로 표시되는가
- 카드 버튼 색감이 저채도 톤으로 일관적인가
- 연습 우선순위 클릭 시 `user_word_state`만 업데이트되는가
- 퀴즈 배지 숫자가 퀴즈 진행/이탈 직후 빠르게 갱신되는가
- SRS에서 중간 이탈 후 재진입 시 진행 위치가 복원되는가
- 연습 모드/quickStart 모드는 항상 새 세션으로 시작되는가

## 10) 참고 파일

- `src/app/(app)/quiz/page.tsx`
- `src/components/quiz/flashcard.tsx`
- `src/components/quiz/practice-flashcard.tsx`
- `src/components/layout/bottom-nav.tsx`
- `src/lib/quiz/due-count-sync.ts`
- `src/lib/repository/types.ts`
- `src/lib/repository/supabase-repo.ts`
- `src/lib/repository/indexeddb-repo.ts`
- `src/app/(app)/words/page.tsx`
- `src/lib/i18n/ko.ts`
- `src/lib/i18n/en.ts`
- `src/lib/i18n/types.ts`
