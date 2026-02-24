---
name: nihongo-quiz-maintainer
description: Maintains Nihongo VocaBook quiz and practice flows with safe data-path rules. Use when changing quiz/practice UI, badge counts, session behavior, wordbook-to-quiz entry, priority/mastered updates, or related i18n/docs.
---

# Nihongo Quiz Maintainer

## 목적

이 스킬은 Nihongo VocaBook의 퀴즈/연습 기능을 수정할 때, UI 변경과 데이터 로직 변경이 섞여서 회귀가 발생하는 문제를 줄이기 위한 작업 규칙이다.

## 핵심 운영 원칙

- UI 변경과 로직 변경을 분리한다.
- 연습(단어장 기반)과 SRS 퀴즈(복습 기반)를 구분해서 처리한다.
- 사용자 상태 값은 `user_word_state` 경로를 우선 사용한다.
- 사용자 노출 문구는 항상 i18n 키를 사용한다.
- 변경 후 `_docs`에 핵심 변경 배경/검증 포인트를 남긴다.

## 모드 구분 규칙

- **SRS 모드**: `/quiz` 또는 `/quiz?wordId=...`
  - `repo.study` 기반 복습 흐름
  - 중간 이탈 복원 대상
- **연습 모드**: `/quiz?wordbookId=...`
  - 단어장 단어 순회 + 우선순위/암기 처리
  - 기본적으로 세션 복원 비대상
- **즉시 퀴즈(quick start)**: `/quiz?quickStart=1`
  - `newPerDay` 개수 랜덤 세션
  - 매번 새 세션(복원 비대상)

## 데이터 저장 경로 규칙

### 우선순위 변경

- 우선순위는 `words`가 아니라 `user_word_state`를 수정한다.
- 반드시 repository API를 통해 처리한다.
- 권장 API: `repo.words.setPriority(wordId, priority)`.

### 암기 완료

- `repo.words.setMastered(wordId, boolean)` 사용.
- 성공 후 관련 캐시(`words`, `mastered`, 필요 시 `wordbooks`)를 무효화한다.

### 단어장 추가(구독 단어장 포함)

- 구독 단어를 내 단어장에 추가할 때는 내 소유 단어로 정규화한다.
- mastered 판단은 `(user_id, word_id)` 스코프로 확인한다.

## UI 작업 규칙

- 연습/퀴즈 버튼 톤은 저채도 다크 팔레트로 일관성 유지.
- `flashcard`와 `practice-flashcard` 무드를 맞출 때:
  - 클릭 액션 로직은 변경하지 않는다.
  - 상태 표현(선택/비선택) 대비만 조정한다.
- 로딩 UI는 가능한 해당 카드 컴포넌트 내부에서 처리한다.
- 리스트/상세 하단 고정 버튼은 페이지 컨텍스트(소유/구독, 모드)에 맞게 분기한다.

## 배지/동기화 규칙

- 하단 퀴즈 배지는 `repo.study.getDueCount()`를 기준으로 한다.
- 60초 polling 외에 아래 시점에 즉시 갱신을 호출한다.
  - 리뷰/암기/우선순위 저장 직후(필요한 경우)
  - 퀴즈 화면 이탈 시
  - 포커스 복귀/가시성 복귀 시

## 세션 이탈 처리 규칙

- SRS는 세션 스냅샷을 저장/복원한다.
  - 최소 저장 항목: 현재 단어 식별자, 진행 카운트, 세션 통계, timestamp
  - TTL 만료 시 폐기
- 연습 모드와 quick start는 복원하지 않는다.

## i18n 규칙

- 사용자 노출 문자열은 `ko.ts`, `en.ts`, `types.ts`를 함께 업데이트한다.
- 용어 변경 시 같은 문맥의 키들을 묶어서 일관되게 수정한다.
  - 예: `퀴즈 시작` vs `연습 시작`

## 문서화 규칙

- 퀴즈 기능 변경 시 `_docs`에 별도 문서를 추가한다.
- 문서에는 최소 아래를 포함한다.
  - 변경 배경
  - 동작 규칙
  - 데이터 경로 변경점
  - 수동 검증 체크리스트

## 작업 체크리스트

- [ ] 모드(SRS/연습/quick start)별 요구사항을 분리했는가
- [ ] `user_word_state` 경로를 써야 할 변경이 `words`를 건드리지 않는가
- [ ] UI 변경이 클릭 로직을 훼손하지 않았는가
- [ ] i18n 3종(`types/en/ko`)이 동기화되었는가
- [ ] `_docs` 문서가 최신 변경을 반영하는가
- [ ] 변경 파일 린트를 확인했는가

## 자주 수정하는 파일

- `src/app/(app)/quiz/page.tsx`
- `src/components/quiz/flashcard.tsx`
- `src/components/quiz/practice-flashcard.tsx`
- `src/components/layout/bottom-nav.tsx`
- `src/lib/repository/supabase-repo.ts`
- `src/lib/repository/indexeddb-repo.ts`
- `src/lib/repository/types.ts`
- `src/lib/i18n/types.ts`
- `src/lib/i18n/ko.ts`
- `src/lib/i18n/en.ts`
- `_docs/*quiz*.md`
