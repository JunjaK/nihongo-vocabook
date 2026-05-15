# Nihongo VocaBook 퀴즈/학습 로직 정리

## 0. 프로젝트/현재 구조 개요

### 0-1. 기술 스택 및 구조

- **Framework**: Next.js 16 (App Router)
- **UI**: React + Tailwind + shadcn/ui
- **Data**: Repository 패턴
  - 로그인 유저 → SupabaseRepository
  - 게스트 → IndexedDBRepository (Dexie)
- **i18n**: 커스텀 context 기반 (ko/en)
- **Types**: `src/types/word.ts`, `src/types/wordbook.ts`

### 0-2. 단어/학습 관련 핵심 타입

`src/types/word.ts`:

- `Word`
  - `id: string`
  - `term`, `reading`, `meaning`, `notes`
  - `tags: string[]`
  - `jlptLevel: number | null` (1=N1, …, 5=N5 가정)
  - `priority: number` (1=상, 2=중, 3=하 — 기본은 중)
  - `mastered: boolean`
  - `masteredAt: Date | null`
  - `createdAt`, `updatedAt`
- `StudyProgress`
  - `id: string`
  - `wordId: string`
  - `nextReview: Date`
  - `intervalDays: number`
  - `easeFactor: number`
  - `reviewCount: number`
  - `lastReviewedAt: Date | null`
- `WordWithProgress = Word & { progress: StudyProgress | null }`

### 0-3. 퀴즈 관련 주요 파일

- `src/app/(app)/quiz/page.tsx`
  - 퀴즈 페이지, `useRepository()`로 데이터 접근
  - 단어 로딩:
    - `?wordId=`: 해당 단어 1개만 퀴즈
    - `?wordbookId=`: 해당 단어장의 단어들
    - 그 외: `repo.study.getDueWords(20)` 호출
- `src/components/quiz/flashcard.tsx`
  - 카드 UI 및 평가 버튼:
    - Again → `onRate(0)`
    - Hard → `onRate(3)`
    - Good → `onRate(4)`
    - Mastered → `onMaster()`
- `src/lib/spaced-repetition.ts`
  - SM-2 알고리즘 구현
- `src/lib/repository/indexeddb-repo.ts`
  - `StudyRepository` 구현
  - `getDueWords`, `recordReview` 등

---

## 1. 현재 SM-2 구현과 한계

### 1-1. SM-2 구현(요약)

`src/lib/spaced-repetition.ts`:

- 입력: `quality` (0~5), `progress: StudyProgress`
- 로직:
  - `quality >= 3`:
    - `reviewCount === 0` → interval = 1일
    - `reviewCount === 1` → interval = 6일
    - 그 외 → `intervalDays = round(intervalDays * easeFactor)`
    - `reviewCount++`
  - `quality < 3`:
    - `reviewCount = 0`
    - `intervalDays = 1`
  - `easeFactor` 업데이트:
    - SM-2 오리지널 공식으로 계산
  - `nextReview = today + intervalDays`
  - `lastReviewedAt = today`

퀴즈 UI에서:

- Again → 0
- Hard → 3
- Good → 4

…로 전달되고 있으므로, SM-2가 기대하는 0~5 6단계에 비해 실제 입력은 3단계에 가까움.

### 1-2. SM-2의 구조적 한계

- Difficulty와 Stability를 모두 `easeFactor` 하나에 몰아넣음
  → 한 번 Again을 많이 누르면 EF가 크게 떨어지고 회복이 어려운 "ease hell" 패턴이 생기기 쉬움.
- 경과 시간에 대한 정보 부족
  → 3일 늦게 복습하든 30일 늦게 복습하든, 동일한 업데이트.
- 초반 간격이 하드코딩
  → 1일 → 6일 → 이후 EF 기반, 개인 차나 단어 특성 반영 한계.
- quality 스케일 대비 UI 입력이 단순
  → UI는 0 / 3 / 4만 쓰고 있어, 6단계 스케일의 장점이 제대로 활용되지 않음.

---

## 2. FSRS 도입 방향 (SM-2 대체)

### 2-1. FSRS(Free Spaced Repetition Scheduler) 개요

- Anki 최신 버전에서 채택된 현대적인 SRS 알고리즘.
- 장점:
  - Difficulty(난이도)와 Stability(기억 안정성)를 분리해 추적.
  - 망각 곡선을 명시적으로 모델링.
  - 4단계 Rating(Again/Hard/Good/Easy)을 기준으로 설계.
- TypeScript 구현체: `ts-fsrs` (npm 패키지).

### 2-2. 도입 설계 개요

1. `ts-fsrs` 설치
   - `bun add ts-fsrs`
2. `StudyProgress` 타입 확장
   - 기존 필드 유지 (`easeFactor`는 레거시 호환용으로 남겨둠).
   - FSRS 관련 필드 추가:
     - `stability: number`
     - `difficulty: number`
     - `elapsedDays: number`
     - `learningSteps: number`
     - `lapses: number`
     - `cardState: number` (0=New, 1=Learning, 2=Review, 3=Relearning)
3. `src/lib/spaced-repetition.ts` 재구성
   - `sm2` 대신 FSRS 래퍼 함수 제공:
     - `progressToCard(progress: StudyProgress | null): Card`
     - `cardToProgress(card: Card, wordId: string, existingId?: string): StudyProgress`
     - `mapQualityToRating(quality: number): Rating`
     - `reviewCard(quality, progress, wordId): StudyProgress`
4. `StudyRepository.recordReview` 수정
   - 기존:
     - `existing ? sm2(quality, current) : sm2(quality, initial)`
   - 변경:
     - `existing ? reviewCard(quality, current, wordId) : reviewCard(quality, null, wordId)`
5. Flashcard 버튼
   - Easy(5) 버튼을 하나 더 추가하면 FSRS Rating 네 단계(Again/Hard/Good/Easy)와 완전히 맞출 수 있음.

---

## 3. 퀴즈 설정(Quiz Options) 설계

### 3-1. 문제 상황

- 공유 단어장(N1 단어 3,000개 등)을 추가하면, 비마스터 단어가 한 번에 수천 개로 증가.
- 현재 `getDueWords`는:
  - 비마스터 단어 전체를 순회하면서
  - `progress 없음 or nextReview <= now`인 단어를 최대 `limit`개까지 순서대로 반환.
- “오늘 신규 카드는 최대 N개”, “하루 최대 리뷰 수” 같은 **학습량 제어 장치**가 없음.
- 결과: 대형 단어장을 추가하면 사용자가 감당하기 어려운 양이 한 번에 퀴즈 대상이 됨.

### 3-2. 필요한 설정 항목

1. **하루 신규 단어 수 제한 (newPerDay)**
   - 예: 5 / 10 / 20 / 30
   - 오늘 처음으로 SRS에 들어오는 단어 수 상한.
2. **하루 복습 최대치 (maxReviewsPerDay)**
   - 예: 50 / 100 / 200 / 무제한.
3. **퀴즈 대상 필터**
   - 전체 단어.
   - 특정 단어장만.
   - 특정 JLPT 범위 (예: N3 이상).
   - 우선순위(상/중/하) 기반 필터.
4. **새 카드 우선순위 규칙**
   - 최근 추가된 단어 우선.
   - 우선순위 상 먼저.
   - JLPT 낮은 레벨 먼저 등.

### 3-3. 구현 개략

- `QuizSettings` 타입 도입 (IndexedDB/Supabase에 저장).
- `StudyRepository`에 `getQuizSettings`, `setQuizSettings` 추가.
- `getDueWords(limit)`에서:
  1. 오늘 통계(`dailyStats`: newShownCount, reviewDoneCount) 조회.
  2. 우선 **due 카드**(nextReview <= now)로 슬롯을 채움.
  3. 남은 슬롯에 대해서만 새 카드 투입.
     - 이미 newPerDay만큼 새 카드가 나온 날이라면, 새 카드 추가 X.
  4. 이 과정에서 우선순위/JLPT 기반 점수로 정렬.

---

## 4. 단어 선택 로직 (우선순위 × JLPT × Overdue)

### 4-1. 기본 아이디어

각 단어에 대해 **퀴즈 점수(score)**를 계산하고, 그 점수로 정렬한 뒤 상위 N개만 퀴즈로 사용:

- 반영 요소:
  - 우선순위(priority: 상/중/하).
  - JLPT 레벨.
  - 신규/복습 상태.
  - overdue 정도 (예정일 대비 얼마나 늦었는지).
  - 유저 JLPT 설정.

### 4-2. 가중치 설계 예시

#### (1) 우선순위 가중치

```ts
function priorityWeight(priority: 1 | 2 | 3): number {
  // 1=상, 2=중, 3=하
  if (priority === 1)
    return 1.0; // 상
  if (priority === 2)
    return 0.7; // 중
  return 0.4; // 하
}
```

#### (2) JLPT 가중치 기본 버전

유저 JLPT를 고려하지 않을 때:

```ts
function jlptWeightBasic(jlptLevel: number | null): number {
  if (!jlptLevel)
    return 0.6;
  switch (jlptLevel) {
    case 5: return 1.0; // N5
    case 4: return 0.9; // N4
    case 3: return 0.8; // N3
    case 2: return 0.7; // N2
    case 1: return 0.6; // N1
    default: return 0.6;
  }
}
```

#### (3) 유저 JLPT 기반 JLPT 가중치

전제: 이 단어장은 “모르는 단어만 모아두는 곳”이므로, 낮은 JLPT라도 모르면 충분히 중요하다.
따라서, 유저 JLPT 기준으로 지나치게 낮은 레벨에 큰 패널티를 주지 않고, 완만한 차이만 둔다.
예) 유저 레벨 N1 (1)일 때:

```ts
function jlptWeightForUser(userJlpt: number | null, wordJlpt: number | null): number {
  if (!wordJlpt)
    return 0.9;

  if (!userJlpt) {
    return jlptWeightBasic(wordJlpt);
  }

  // 예: userJlpt === 1 (N1)
  if (userJlpt === 1) {
    switch (wordJlpt) {
      case 1: return 1.0;
      case 2: return 0.95;
      case 3: return 0.9;
      case 4: return 0.85;
      case 5: return 0.8;
      default: return 0.9;
    }
  }

  // 기타 레벨은 diff 기반으로 일반화
  const diff = wordJlpt - userJlpt; // 양수: 더 쉬움, 음수: 더 어려움

  if (diff === 0)
    return 1.0;
  if (diff === 1)
    return 0.95;
  if (diff === -1)
    return 0.9;
  if (diff >= 2)
    return 0.8;
  if (diff <= -2)
    return 0.85;
  return 0.9;
}
```

또한, JLPT는 가중치뿐 아니라 퀴즈 설정에서 필터로도 사용 가능:

- “N3 이상만 퀴즈에 포함”
- “내 JLPT 레벨보다 2단계 이상 낮은 단어는 신규 카드에서 제외” 등.

#### (4) Overdue 가중치

```ts
function calcOverdueFactor(progress: StudyProgress | null): number {
  if (!progress || !progress.lastReviewedAt) {
    return 0.5; // 신규 카드
  }

  const now = Date.now();
  const due = progress.nextReview.getTime();
  const daysOverdue = (now - due) / (1000 * 60 * 60 * 24);

  if (daysOverdue <= 0)
    return 0.8;
  if (daysOverdue < 3)
    return 1.0;
  if (daysOverdue < 7)
    return 1.2;
  return 1.5;
}

function isNew(progress: StudyProgress | null): boolean {
  return !progress || progress.reviewCount === 0;
}
```

#### (5) 최종 score 계산

```ts
function calcQuizScore(word: WordWithProgress, userJlpt: number | null): number {
  const basePriority = priorityWeight(word.priority as 1 | 2 | 3);
  const jlpt = jlptWeightForUser(userJlpt, word.jlptLevel);
  const overdue = calcOverdueFactor(word.progress);
  const newCardBoost = isNew(word.progress) ? 0.2 : 0;

  return (basePriority * 0.6 + jlpt * 0.4 + newCardBoost) * overdue;
}
```

### 4-3.  getDueWords 에서의 실제 사용 흐름

    1.	비마스터 단어 전체 조회.
    2.	각 단어에 대해 Progress 조회.
    3.	 (progress 없음) or (nextReview <= now) 인 단어들을 후보로 모음.
    4.	각 후보에 대해  calcQuizScore  계산.
    5.	점수 내림차순 정렬.
    6.	상위 N개만 반환.

```ts
async getDueWords(limit = 20): Promise<WordWithProgress[]> {
  const now = new Date();
  const userJlpt = await this.getUserJlptLevel();
  const allWords = await db.words
    .filter((w) => !w.mastered)
    .toArray();

  const candidates: WordWithProgress[] = [];

  for (const word of allWords) {
    const w = word as LocalWord & { id: number };
    const progress = await db.studyProgress
      .where('wordId')
      .equals(w.id)
      .first();

    const p = progress
      ? localProgressToProgress(progress as LocalStudyProgress & { id: number })
      : null;

    if (!p || p.nextReview <= now) {
      candidates.push({
        ...localWordToWord(w),
        progress: p,
      });
    }
  }

  const sorted = candidates
    .map((w) => ({ word: w, score: calcQuizScore(w, userJlpt) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.word);

  return sorted.slice(0, limit);
}
```

여기에 “오늘 신규/복습 제한”과 단어장/JLPT 필터를 추가로 적용해서 최종 퀴즈 대상 리스트를 구성하면 된다.

## 5. “모르는 단어만 넣는 단어장” 컨셉과 JLPT

- 이 단어장의 목표는 **“내가 모르는 단어만 모아놓고 공부하는 것”**이다.
- 따라서:
  - JLPT 레벨이 낮더라도, 모르는 단어라면 그 자체로 충분히 중요하다.
  - N1 유저라도 N3/N4 단어를 모르면 실전에서 큰 구멍이 될 수 있다.
- 결론:
  - JLPT는 “쉽다/어렵다” 기준으로 강하게 패널티를 줄 대상이 아니다.
  - 실제 중요도는 `priority`(상/중/하), overdue(얼마나 미뤄졌는지), 유저의 수동 태깅이 기준이 된다.
  - JLPT는:
    - 가중치는 완만하게 두고,
    - 대신 “어느 레벨까지 퀴즈에 포함할지” 같은 **필터**로 강하게 제어하는 것이 자연스럽다.
    - 예: “N3 이상만 퀴즈에 포함”, “내 JLPT보다 2단계 이상 낮은 단어는 신규 카드에서 제외” 등.

---

## 6. 학습 동기(모티베이션) 장치 설계

### 6-1. 스트릭(연속 학습)

- 연속 학습 일수를 보여주는 장치:
  - 예: “연속 7일 학습 중 🔥”.
- 내부 데이터 구조:
  - `dailyStats` 테이블 (예시):
    - `date` (YYYY-MM-DD)
    - `newCount` (해당 날짜에 본 신규 카드 수)
    - `reviewCount` (해당 날짜에 복습한 카드 수)
- 스트릭 계산:
  - 오늘 날짜부터 과거로 거슬러 올라가며, `newCount + reviewCount > 0`인 날이 몇 일 연속인지 계산.
- UX 아이디어:
  - 홈 혹은 퀴즈 헤더에 스트릭 표시.
  - 스트릭이 끊겼을 때 “이번 최고 기록: 10일 — 다시 도전해볼까요?” 같은 메시지로 리커버리 유도.
  - 나중에 여유가 되면 “Streak Freeze” 같은 한 번 정도 봐주는 기능도 고려 가능.

### 6-2. 세션 리포트(퀴즈 완료 화면)

- 퀴즈를 모두 마쳤을 때, 단순 “다 했습니다”가 아니라 **세션 요약**을 보여주는 것이 중요하다.
- 표시 항목 예:
  - 오늘 복습한 카드 수.
  - 오늘 새로 본 카드 수.
  - 정답률 (Again 비율 기준으로 계산).
  - 현재 스트릭 (연속 X일 학습).
  - 간단한 피드백 문구:
    - 정답률 90% 이상: “完璧！ 오늘도 최고예요.”
    - 70~89%: “いい調子！ 내일도 이어가볼까요?”
    - 70% 미만: “難しい単語が多かったみたい요. 천천히 다시 가봅시다.”
- 구현 포인트:
  - `recordReview` 호출 시, `dailyStats`를 함께 업데이트.
  - 퀴즈 세션이 끝날 때, 오늘 날짜의 `dailyStats` + 세션 내 Again 횟수 등을 기반으로 요약 생성.

### 6-3. 진행률 시각화

- **단어장별 진행률**:
  - 각 단어장에 대해 “학습된 단어 수 / 전체 단어 수”를 계산.
  - 카드나 리스트에서 Progress Bar로 표현.
  - 예: “N1 단어장 — 127 / 3,000 단어”.
- **JLPT 레벨별 진행률**:
  - N5~N1 레벨별로 학습된 단어 수를 집계.
  - 단순한 막대/도넛 차트 형태로 보여줄 수 있다.
  - 예: “N3 단어 320개 중 180개 학습 완료”.
- **주간/월간 학습 히트맵**:
  - GitHub 잔디처럼, 날짜별 학습량을 색 농도로 표현.
  - 필수는 아니지만, 나중에 동기부여 요소로 추가하기 좋다.
- 구현 난이도 기준:
  - 단어장별 Progress Bar → 가장 구현이 쉽고, 바로 체감됨.
  - JLPT별 진행률 → 집계 쿼리/루프 추가 정도로 구현 가능.
  - 히트맵 → UI/레이아웃 부담이 있으므로 후순위로 두어도 된다.

### 6-4. 마일스톤/뱃지

- 과한 “게임화”는 부담이 될 수 있으니, 몇 개의 **핵심 마일스톤**만 잡는 것이 좋다.
- 예시:
  - “첫 퀴즈 완료” — 온보딩용.
  - “누적 100/500/1000 단어 학습” — 중/장기 목표 지점.
  - “7일/30일 연속 학습” — 습관 형성/고착.
  - “특정 단어장 완전 마스터” — 단어장 완주 보상.
- 데이터 구조 예:
  - `achievements` 테이블:
    - `id: string`
    - `type: string` (예: `first_quiz`, `words_100`, `streak_7`, `wordbook_full_XXX`)
    - `unlockedAt: Date`
- UI:
  - 설정/프로필 화면에 간단한 뱃지 리스트 페이지.
  - 퀴즈 완료 시, 새로운 뱃지가 해금되면 작은 모달/토스트로 노출.

### 6-5. 구현 우선순위 제안

1. **퀴즈 완료 후 세션 리포트**
   - 지금 구조에 가장 적은 변경으로, 가장 눈에 띄는 동기부여 효과를 얻을 수 있음.
2. **스트릭 + 오늘 학습량 카운트**
   - `dailyStats`만 잡으면 되므로 구현 난이도가 낮은 편.
3. **단어장별 Progress Bar**
   - 기존 `mastered` 플래그를 이용해 바로 계산 가능.
4. **마일스톤/뱃지**
   - 나중에 여유 있을 때 추가해도 늦지 않음.
5. **히트맵/고급 시각화**
   - UX를 풍부하게 하지만 필수는 아니므로 가장 후순위.

---

## 7. 큰 그림 요약

1. **알고리즘 레벨**
   - SM-2에서 FSRS로 점진적 교체를 고려한다.
   - `StudyProgress`를 FSRS에 맞게 확장하고, `recordReview` 로직을 래핑한다.
2. **선택/스케줄링 레벨**
   - `getDueWords`를 “점수 기반 정렬 + 데일리 제한” 구조로 재설계한다.
   - 점수는 우선순위 × JLPT × overdue × 신규/복습 × 유저 JLPT 설정으로 구성한다.
3. **설정 레벨**
   - 신규/일, 리뷰/일, 대상 범위(JLPT/단어장/우선순위) 등을 유저 설정으로 제공한다.
4. **동기부여 레벨**
   - 스트릭, 세션 리포트, 진행률 시각화, 마일스톤을 단계적으로 추가해 학습 동기를 유지/강화한다.

이 5~7번 블록을 기존 문서의 앞부분(0~4번) 뒤에 그대로 붙이면, 하나의 완성된 `quiz-design.md`로 사용할 수 있다.

출처
