# Gemma 4 를 모바일 앱에 욱여넣기까지: 4번의 피벗

> Status: **Complete** — iOS 네이티브에서 동작 검증 완료.

> 일본어 단어장 PWA에 이미지 → 단어 추출 기능을 붙이려고 Gemma 4 를 띄우려 했다. 웹에서 시작해서 모바일 웹, PWA, iOS 네이티브, LiteRT-LM 라이브러리 버전 0.10 → 0.11 까지 4번 피벗하고서야 동작했다. 그 과정에서 가장 크게 얻은 건 "AI에게 최신 기술을 묻지 마라"는 메타 교훈.

---

## 출발점

만들고 있는 앱은 **Nihongo VocaBook** — 일본어 단어장 PWA. 기능 하나를 추가하고 싶었다.

> 사용자가 일본어가 적힌 이미지를 찍으면, 앱이 이미지에서 단어를 자동으로 뽑아 단어장에 추가한다.

선택지는 둘:

1. **외부 API**: OpenAI Vision, Google Cloud Vision, Anthropic Vision — 정확하고 빠르지만 비용 + 프라이버시 부담 (사용자 사진이 외부로 전송)
2. **온디바이스 LLM**: 모델 다운로드 후 오프라인 추론 — 비용 0, 프라이버시 완벽, 단점은 속도/정확도

**온디바이스 선택**. 비용 부담 없는 학습 앱 + 사용자 이미지 외부 전송 안 함 = 강력한 마케팅 포인트.

모델 후보로 **Gemma 4 E2B** 를 골랐다. Google 의 최신 오픈 멀티모달 LLM, int4 양자화 시 2.41 GB. iPhone에서 돌릴 만한 크기 + 멀티모달 (이미지 + 텍스트 입력) 공식 지원.

---

## 피벗 1: 데스크탑 웹 — 일단 동작은 한다

처음엔 **transformers.js + WebGPU** 로 데스크탑 브라우저에서 추론. Chrome/Edge 에서 WebGPU 활성화되어 있으면 Gemma (또는 Qwen) 모델을 GPU 메모리에 올려서 도는 구조.

데스크탑 (M1 Pro Mac, Chrome) 에서는 **정상 동작**. 모델 다운로드 ~1.5GB, 첫 추론 콜드 스타트 30초 정도, 워밍업 후엔 이미지당 5-10초. 정확도도 쓸 만했다.

문제는 사용자다. **이 앱의 사용자는 99% 모바일에서 쓴다.** 일본어 단어를 카메라로 찍어 추가하는 시나리오 자체가 모바일 우선.

---

## 피벗 2: 모바일 웹 / PWA — 안 됐다

Safari iOS, Chrome iOS 둘 다 시도. **PWA로 홈 화면에 추가한 모드**까지.

결과:
- **모델 다운로드는 됨** (느리지만)
- **모델 로딩 단계에서 메모리 부족으로 탭/PWA 크래시**
- 가장 작은 **Gemma 4 E2B 도 안 됨** (2.41GB 가 iOS Safari 의 탭당 메모리 한계를 초과)

좀 더 작은 모델로 갈아치워 봄. **Qwen3.5 2B** (2.5GB) — 더 작고 가벼운 베이스라인. 결과는 같음.

iOS Safari/PWA 의 탭당 메모리 한계는 디바이스 RAM의 일부 (대략 1-2GB). 거기에 모델을 다 올리기엔 무리. 더 작은 ~1GB 모델로 가도 추론 자체에서 또 OOM 가능성.

> **결론**: 모바일 메인 앱인데 모바일 웹/PWA 가 안 되면 의미 없음. 미루던 **iOS 네이티브** 로 가는 수밖에.

---

## 피벗 3: iOS 네이티브 — 라이브러리 선택

iOS 에서 멀티모달 LLM 을 띄울 수 있는 옵션:

- **MediaPipe LLM Inference**: 멀티모달 지원이 좀 제한적
- **MLX (Apple Silicon)**: 추론 API 가 거칠고 멀티모달 워크플로우 미완성
- **LiteRT-LM (구 TFLite + LiteRT)**: Google 의 공식 모바일 LLM 런타임, **멀티모달 + iOS/Android 둘 다 지원**

LiteRT-LM 선택. 모델은 같은 Gemma 4 E2B 를 `.litertlm` 형식으로 받아서 사용.

기존 React Native 프로젝트 (Expo Bare workflow) 에 통합하려고 **react-native-litert-lm** wrapper 를 찾았다.

🔗 https://github.com/hung-yueh/react-native-litert-lm

이 wrapper는 LiteRT-LM **v0.10.1** 을 빌드해서 XCFramework 형태로 제공한다. 그대로 vendor 해서 Swift Expo Module 에서 호출하면 끝 — 이론상.

---

## 피벗 4: v0.10.1 → v0.11 (이게 진짜 함정이었다)

v0.10.1 XCFramework 를 통합하고 며칠을 디버깅했다. 증상이 다양했다:

- `litert_lm_engine_create returned NULL` (0.1초 만에)
- `unrecognized section: tf_lite_mtp_drafter` (Gemma 4 의 MTP drafter 섹션 인식 못함)
- `Available (registered) engine types: []` (엔진이 등록 자체가 안 됨)

AI (Claude, ChatGPT) 한테 물어봐도 답이 빙빙 돌았다. 매번 다른 가설을 내놓는데 어느 것도 통하지 않음.

결국 한 가지 분명한 메시지가 있었다: **`tf_lite_mtp_drafter` 라는 섹션을 라이브러리가 모른다**.

이게 단서였다. **모델 파일 (`.litertlm`) 의 포맷이 SDK 버전과 직결**되는 구조다:

- Hugging Face 에 올라와 있는 **최신 Gemma 4 멀티모달 번들** 은 **v0.11 의 컨테이너 포맷**으로 빌드되어 있다 — MTP (Multi-Token Prediction) drafter, vision encoder 등 새 섹션 포함
- **v0.10.x SDK** 의 파서는 이 새 섹션을 모른다 → 모델 로딩 자체에서 실패

즉, 빌드 실수가 아니라 **모델 파일 ↔ SDK 버전이 어긋난 것**. AI 한테 "왜 안 되냐"고 물어봤지만, 사용 중인 모델이 어느 SDK 버전 기준으로 패키징됐는지를 인지하지 못한 답변만 받았다. 공식 저장소 changelog 를 보면 답이 거기 박혀 있었음:

> v0.11.0: Added support for Gemma 4 (E2B / E4B) bundles with MTP drafter.

LiteRT-LM 공식 저장소를 다시 봤다.

🔗 https://github.com/google-ai-edge/LiteRT-LM
🔗 https://ai.google.dev/edge/litert-lm/overview?hl=ko

확인 결과 — **v0.11.0 부터 Gemma 4 + MTP drafter 정식 지원**. 그 사이 Google 이 새 모델 받치는 코드를 부었지만, 커뮤니티 wrapper 는 v0.10.1 에 박혀 있어서 동작 안 했다.

해결: 직접 v0.11.0 을 Bazel 로 소스부터 iOS 빌드. ~30분, 80MB device + 83MB simulator static archive.

```bash
brew install bazelisk
git clone https://github.com/google-ai-edge/LiteRT-LM
cd LiteRT-LM
bazel build //c:engine \
  --apple_platform_type=ios \
  --ios_multi_cpus=arm64
```

이걸 새 XCFramework 로 묶어서 vendor. 그러자:

- ✅ Gemma 4 E2B 정상 로딩
- ✅ 멀티모달 추론 동작
- ✅ 일본어 OCR 정확도가 의외로 좋음 (의미·읽기·JLPT 레벨까지 잘 잡아냄)
- ⏱️ 첫 추론 콜드 스타트 ~50초 (모델 + Metal shader compile)
- ⏱️ 이후 따뜻한 추론 ~9-12초

> 속도는 좀 걸리지만 — **GPT-5 nano 보다 체감이 좋다**. 원래 외부 API 였으면 네트워크 RTT + 토큰 출력 streaming 대기까지 + 비용까지 들었을 텐데, 온디바이스라 그게 다 0.

---

## 메타 교훈: LLM 에게 최신 기술을 묻지 마라

이번 여정에서 가장 크게 다친 건 **AI 에게 의존한 시간**. 며칠을 v0.10.1 위에서 디버깅하면서 Claude/ChatGPT 한테 매번 물어봤다. 그런데:

- Gemma **4** 가 나왔는데 AI 는 계속 **Gemma 2 / 3** 의 동작 / 모델 카드 / API 를 참조함
- LiteRT-LM **v0.11** 의 새 C API 시그니처에 대해 물으면 **v0.10** 의 시그니처를 답함
- "이 에러가 왜 나오나?" 라고 물으면 **이전 버전에선 적용되던 가설**을 가져옴

이건 학습 데이터 cutoff 의 자연스러운 결과지만, 그게 위험한 줄 모르고 계속 의존하니까 잘못된 가설을 따라 며칠을 잃은 거.

**원본 소스 + 공식 문서로 돌아가서 GitHub Release 노트 읽는 게 가장 빨랐다.** v0.10 → v0.11 changelog 한 번만 봤으면 첫날에 해결됐을 거.

### 이번에 학습한 작업 룰

1. **모델 / 라이브러리가 "최신" 인 영역은 AI 우선 의존 금지** — 공식 changelog · GitHub Issues · 공식 examples 가 먼저
2. **모델 파일과 SDK 는 한 묶음으로 본다** — Hugging Face 의 최신 모델은 그 시점 기준 최신 SDK 의 컨테이너 포맷으로 빌드됨. 모델 다운로드 페이지에 "Compatible with X.Y+" 명시가 있는지 먼저 확인
3. **AI는 보조 도구로** — 가설 빠르게 찍어보거나, 알려진 코드 패턴 적용할 때 사용
4. **에러 메시지에서 핵심 단서가 나오면 그 단서로 GitHub Issues / 공식 문서를 검색** — AI 답변보다 훨씬 정확
5. **버전 차이가 발생하는 영역은 항상 "공식 저장소 + Release 페이지" 부터** 출발

---

## 정리

| 단계 | 시도 | 결과 |
|------|------|------|
| 1 | 데스크탑 웹 (transformers.js + WebGPU) | ✅ 동작 (그러나 사용자 모바일) |
| 2 | 모바일 웹 / PWA (Safari, Chrome iOS) | ❌ 메모리 한계 (Gemma 4 E2B, Qwen3.5 2B 모두 OOM) |
| 3 | iOS 네이티브 + react-native-litert-lm (v0.10.1) | ❌ 최신 Gemma 4 `.litertlm` 포맷 (v0.11 기준) 과 미호환 |
| 4 | iOS 네이티브 + LiteRT-LM **v0.11.0** 직접 빌드 | ✅ 모델 파일 ↔ SDK 버전 매칭 → 동작 |

최종 스택:

- **모델**: Gemma 4 E2B int4 (2.41 GB)
- **런타임**: LiteRT-LM v0.11.0 (Bazel 로 iOS arm64 직접 빌드)
- **shell**: Expo Bare workflow + Swift Expo Module + react-native-webview
- **추론**: 첫 호출 ~50초, 이후 ~10초
- **품질**: 일본어 OCR + 단어 추출 + 의미 + JLPT 레벨 한 번에 — 작은 모델치고 놀라움

총 시간: 처음 시도부터 최종 동작까지 **약 1주**. 같은 함정 안 밟으면 **1-2일** 내 가능.

---

## 후속 글

이 글은 "어디까지 왔다" 의 큰 그림. 실제 v0.11 빌드 중 만난 **9개의 기술적 벽** (iOS linker stripping, MTP drafter shape mismatch, conversation state pollution, greedy sampler 무한 반복 등) 은 별도 문서로 정리했다 — [iOS 앱에 Gemma 4 멀티모달 LLM 띄우기까지](./blog-gemma4-ios-litert-journey.md).

---

## 참고 링크

- [Gemma 4 모델 카드 (Google AI for Developers)](https://ai.google.dev/gemma/docs/core?hl=ko)
- [LiteRT-LM 공식 문서](https://ai.google.dev/edge/litert-lm/overview?hl=ko)
- [LiteRT-LM GitHub](https://github.com/google-ai-edge/LiteRT-LM)
- [hung-yueh/react-native-litert-lm](https://github.com/hung-yueh/react-native-litert-lm) — 빌드 하네스 참고용
- [transformers.js (Hugging Face)](https://huggingface.co/docs/transformers.js/index)

---

*기록일: 2026-05-14. iPhone 15 Pro 검증.*
