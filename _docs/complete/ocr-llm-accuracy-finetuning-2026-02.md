# OCR / LLM 정확도 개선 파인튜닝 정리 (2026-02)

## 문서 목적

이미지 기반 단어 추출(OCR/LLM)에서 발생한 노이즈, 과분해, 과치환 문제를 줄이기 위해 적용한 파인튜닝 내용을 한 곳에 정리한다.

---

## 배경 문제

초기 로그에서 다음 문제가 반복적으로 확인되었다.

- OCR 노이즈 토큰 다수 (`ーー`, `ニニ`, `ロロ`, `ンー`, `...`)
- 접두/접미/활용 어미 단독 토큰이 단어처럼 통과
- 단일 한자 과다 통과
- 카타카나 단편 토큰(2~4자) 잔존
- 복합어 과분해 (`世`/`界`, `静`/`岡` 등)
- 사전 보정 시 원문에 없는 과치환 (`ルカ -> ウルカヌス`류)
- Tesseract wasm 콘솔 경고 스팸 (`Warning: Parameter not found ...`)

---

## 적용된 핵심 개선

## 1) 공통 토큰 필터 도입 (OCR/LLM 공통)

파일: `src/lib/ocr/term-filter.ts`

- 접두/접미 단독 차단
  - 접두 예: `お`, `ご`, `未`, `非`, `無`, `再`, `超`, `第`
  - 접미 예: `的`, `性`, `化`, `力`, `者`
- 활용 어미 단독 차단
  - 예: `ます`, `ました`, `ません`, `ない`, `なかった`, `たい`, `れる`, `られる`, `する`, `た`, `だ` 등
- 노이즈 패턴 차단
  - 장음/반복 (`ーー`, 반복문자)
  - 접사형 마킹 (`無-`, `無ー`, `無~`, `-的`, `〜性`, `ー化`, `・的`, `·的`, `.的`)
- 단일 한자 예외 허용
  - 단, 마킹이 붙은 접사형(앞/뒤 기호)은 차단
- 제외 사유 반환 기능 추가
  - `empty`, `affix_only`, `inflection_only`, `noise_pattern`

## 2) LLM 경로 필터링 + 프롬프트 강화

파일:
- `src/lib/ocr/llm-vision.ts`
- `src/app/api/ocr/vision/route.ts`

- 응답 term 정규화 + 공통 필터 적용
- term 기준 dedup
- 시스템 프롬프트에 제외 규칙 명시
  - 접사 단독 / 활용 어미 단독 / OCR 노이즈 / 마킹 접사형 제외

## 3) OCR 다중 패스 + 후보 합성

파일: `src/lib/ocr/tesseract.ts`

- 다중 패스 OCR
  - original
  - grayscale+contrast
  - threshold(binary)
- 패스별 가중치를 적용한 점수 합산
- 카타카나 인접 조각 결합 후보 생성
- 인접 단일 한자 결합 후보 생성 (2자/3자)
  - 예: `世+界 -> 世界`
- 한자 + 짧은 히라가나 결합 후보 생성
  - 예: `眺 + め -> 眺め`, `眺め + ながら -> 眺めながら`

## 4) 카타카나 노이즈 억제 강화

파일: `src/stores/scan-store.ts`

- OCR 토큰 빈도 기반 통과 조건
  - 카타카나 길이별 최소 반복 검출 횟수 상향
- 미리보기 단계 추가 필터
  - 짧은 카타카나/단일 한자에 대해 조건부 통과

## 5) 사전 보정(표제어 치환) 엄격화

파일: `src/stores/scan-store.ts`

- 짧은 카타카나/히라가나 부분 일치 치환 금지
- 비한자 짧은 토큰 부분 일치 금지
- 과도한 길이 확장 치환 금지
- `pref/suf` 품사 후보 감점
- 활용형 정규화 후보(예: `...ながら` -> stem, `stem+る`) 가중
- 축약 치환 금지
  - 예: 긴 원문을 `県` 같은 짧은 하위어로 치환하지 않도록 차단

## 6) 복합어 존재 시 파편 억제

파일:
- `src/stores/scan-store.ts`
- `src/lib/ocr/tesseract.ts`

- 긴 복합어가 존재할 경우 하위 파편 토큰 억제
  - 예: `世界`가 있으면 `世`/`界` 억제
  - 예: `センター`가 있으면 `セン`/`ター` 억제

## 7) 로그 관측 체계 개선

파일: `src/lib/ocr/tesseract.ts`

- `raw_tokens` 로그: 원본 유니크 토큰
- `processed_tokens` 로그: 후처리 결과
- reject 카운트 세분화
  - `rejectedByLengthCount`
  - `rejectedByPatternCount`
  - `rejectedByCapCount`
  - `rejectedReasonCount`

## 8) Tesseract 리소스 경로 고정 + 경고 억제

파일:
- `src/lib/ocr/tesseract.ts`
- `public/tessdata/jpn.traineddata`

- `langPath`를 `/tessdata`로 고정, 실패 시 기본 로딩 fallback
- `Warning: Parameter not found:` 계열 콘솔 스팸 억제
- 억제 개수는 `suppressed_tesseract_warnings`로 요약 로그 출력

---

## 현재 해석 포인트

- `processed_tokens`의 품질은 `scan-store` 최종 결과보다 앞단이므로 더 거칠 수 있음
- 최종 사용자 미리보기는 `scan-store` 보정/재랭킹 규칙을 한 번 더 거친다
- 따라서 개선 판단은 `processed_tokens` + 최종 미리보기 둘 다를 함께 봐야 함

---

## 남은 이슈(관찰됨)

- 고유명사/지명(`静岡`, `富士`, `世界遺産`)은 이미지 품질/줄바꿈 분해 영향이 큼
- 일부 활용형(`眺めながら -> 眺める`)은 케이스별 잔여 오차 존재
- 공격적 노이즈 필터는 정상 외래어 일부를 놓칠 수 있음(정밀도/재현율 trade-off)

---

## 다음 권장

- 샘플 5~10장 고정 회귀 세트 구축
  - 지표: `keptCount`, `dictMatchRate`, 수동 제거율
- 고유명사/지명 전용 우대 규칙(한자 2~4자 연쇄 + 문맥 빈도) 실험
- 필요 시 "노이즈 우선 / 균형" 프리셋 분리

---

## 관련 파일 목록

- `src/lib/ocr/term-filter.ts`
- `src/lib/ocr/tesseract.ts`
- `src/lib/ocr/llm-vision.ts`
- `src/app/api/ocr/vision/route.ts`
- `src/stores/scan-store.ts`
- `public/tessdata/jpn.traineddata`
