# iOS 앱에 Gemma 4 멀티모달 LLM 띄우기까지: 시행착오 기록

> 일본어 단어장 PWA에 이미지 → 단어 추출 기능을 붙이려고 iPhone에서 멀티모달 Gemma 4 E2B를 오프라인으로 추론하기까지의 기록. 결과적으로 동작은 하지만, 그 사이 9개의 막다른 길과 잘못된 가설이 있었다.

## 시작

목표는 단순했다. **iPhone에서 모델 다운로드 후 오프라인으로 이미지 → 일본어 단어 JSON 추출**. 백엔드 호출 0번, 사용자 이미지가 외부로 안 나가는 구조.

후보를 추렸을 때:

- **MediaPipe LLM Inference**: 멀티모달 지원이 제한적
- **MLX**: Apple Silicon 전용이지만 추론 API가 아직 거칠다
- **LiteRT-LM (구 TFLite + LiteRT)**: Google이 공식 멀티모달 + iOS/Android 둘 다 지원

LiteRT-LM 채택. 모델은 [Gemma 4 E2B int4](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm) (2.41 GB)을 골랐다. iPhone에서 mmap 가능한 적당한 크기.

빌드는 [hung-yueh/react-native-litert-lm](https://github.com/hung-yueh/react-native-litert-lm)가 제공하는 빌드 하네스를 재활용했다 — 직접 Google LiteRT-LM 저장소를 Bazel로 빌드하는 것보다 빠르게 시작할 수 있었다.

스택: **Expo 55 + React Native (Bare workflow), LiteRT-LM C API, Swift Expo Module**. 추론은 Swift, 모델 다운로드 / 단어 가공은 TS.

---

## 1. 첫 번째 벽 — `mmap-cap`

```
litert_lm_engine_create returned NULL after 0.07s
```

빌드 직후 첫 추론 호출이 100ms도 안 되어 NULL을 뱉었다.

**잘못된 가설**: "GPU accelerator dylib이 누락된 거 아닐까?" — gpu_registry 경고가 같이 보였다. 며칠 동안 XCFramework 안에 들어 있어야 할 Metal accelerator를 찾아 헤맸다.

**진짜 원인**: iOS의 단일 프로세스 가상주소 공간이 **약 18 GB**로 캡되어 있고, 2.5 GB 모델 mmap은 그걸 초과한다. Google 문서엔 친절하게 언급 없음.

해결책은 단 한 줄의 entitlement:

```xml
<key>com.apple.developer.kernel.extended-virtual-addressing</key>
<true/>
```

**함정**: 이 entitlement는 **유료 Apple Developer Program 계정 (개인 $99/년)** 에만 발급된다. Personal Team으로 sideload하면 entitlement는 .entitlements 파일에 있어도 provisioning profile에서 제거되어 무조건 실패. 코드 사인 검사도 통과하니까 빌드는 되고 실행도 되는데 모델만 안 뜨는 짜증나는 패턴.

> 교훈: **iOS에서 2GB 넘는 모델을 mmap한다면 entitlement + 유료 계정**. 이걸 하루라도 일찍 알았다면.

---

## 2. 두 번째 벽 — v0.10.2가 Gemma 4를 모름

Entitlement 해결 후 다음 에러:

```
Available (registered) engine types: []
unrecognized section: tf_lite_mtp_drafter
```

Gemma 4의 `.litertlm` 번들에는 12개 섹션이 있는데, 그중 **MTP (Multi-Token Prediction) drafter** 섹션이 v0.10.2 파서에서 인식되지 않았다. hung-yueh 하네스가 빌드해둔 v0.10.2 XCFramework가 너무 오래된 게 문제.

LiteRT-LM **v0.11.0**부터 Gemma 4 지원. 하지만 hung-yueh는 v0.10.2까지만 빌드 제공 → **직접 빌드 필요**.

---

## 3. 세 번째 벽 — Bazel iOS 빌드

겁먹었지만 의외로 깔끔했다.

```bash
brew install bazelisk
git clone https://github.com/google-ai-edge/LiteRT-LM
cd LiteRT-LM
bazel build //c:engine \
  --apple_platform_type=ios \
  --ios_multi_cpus=arm64 \
  --config=ios_arm64
```

결과: 80 MB device static archive + 83 MB simulator archive. XCFramework로 묶으면 끝.

소요 시간: 약 30분 (M1 Pro 기준).

이걸 vendor 디렉터리에 넣고 Expo module이 import. 첫 번째 모델 파일 파싱 성공.

---

## 4. 네 번째 벽 — Linker stripping (이게 진짜)

빌드는 성공. 모델 파일도 정상 파싱. 하지만 추론을 시도하면:

```
NOT_FOUND: No available engine for backend: GPU.
Available (registered) engine types: []
```

엔진이 0개 등록되어 있다.

LiteRT-LM은 엔진 구현을 매크로로 자기 자신에 등록한다:

```cpp
// engine_impl.cc
namespace {
LITERT_LM_REGISTER_ENGINE(
    EngineFactory::EngineType::kLiteRTCompiledModel,
    [](EngineSettings settings, absl::string_view input_prompt_as_hint) {
      return EngineImpl::Create(std::move(settings), input_prompt_as_hint);
    });
}  // namespace
```

이 매크로는 **anonymous namespace 안에 static initializer**를 만든다. 그런데 iOS의 정적 링커는 **외부에서 참조되지 않는 anonymous namespace 심볼을 stripping**한다. 동적 라이브러리라면 살아남았겠지만 우리는 static archive.

결과: 컴파일은 되지만 등록 코드가 최종 바이너리에서 사라짐.

**해결 (소스 수정 2곳)**:

```cpp
// runtime/core/engine_impl.cc
// 1. anonymous namespace 밖으로 이동 + 명시적 이름 부여
}  // namespace

static const ::litert::lm::EngineRegisterer kEngineRegisterer(
    EngineFactory::EngineType::kLiteRTCompiledModel,
    [](EngineSettings settings, absl::string_view input_prompt_as_hint) {
      return EngineImpl::Create(std::move(settings), input_prompt_as_hint);
    });

}  // namespace litert::lm

// 2. extern "C" 진입점이 이걸 참조하도록 강제
extern "C" void ForceLinkEngineImpl() {
  volatile const void* p = &litert::lm::kEngineRegisterer;
  (void)p;
}
```

```cpp
// c/engine.cc
extern "C" void ForceLinkEngineImpl();

LiteRtLmEngine* litert_lm_engine_create(const LiteRtLmEngineSettings* settings) {
  ForceLinkEngineImpl();  // ← 이 한 줄
  // ...
}
```

`volatile`로 컴파일러가 dead-store 제거 못하게 막고, `extern "C"` 진입점이 참조하니까 링커가 함부로 못 자른다.

> 교훈: **iOS 정적 라이브러리 + anonymous namespace에 self-registration 패턴 = 함정**. 라이브러리가 매크로로 자기 자신에 등록하는 구조라면 거의 항상 force-link 필요.

---

## 5. 다섯 번째 벽 — Rust minijinja

이번 빌드의 한 가지 특이점: LiteRT-LM의 `prompt_template.cc`가 **Rust로 작성된 minijinja**를 호출하는 cxx bridge를 쓴다. iOS Bazel 빌드에서 이게 깨끗하게 안 빌드된다.

**선택**:
- (A) Rust 빌드 체인을 iOS Bazel에 통합 → 큰 작업
- (B) Jinja2 템플릿 엔진을 통째로 들어내고 C++로 단순 대체

Gemma chat template은 단순해서 (B) 선택:

```cpp
// 새로 작성한 SimpleFormatMessages
static std::string SimpleFormatMessages(
    const json& messages,
    const std::string& bos_token,
    const std::string& eos_token,
    bool add_generation_prompt) {
  std::string result;
  if (!bos_token.empty()) result += bos_token;
  for (const auto& msg : messages) {
    std::string role = msg.value("role", "user");
    std::string content;
    if (msg["content"].is_string()) {
      content = msg["content"].get<std::string>();
    } else if (msg["content"].is_array()) {
      for (const auto& block : msg["content"]) {
        std::string type = block.value("type", "");
        if (type == "text") content += block.value("text", "");
        else if (type == "image") content += "\n\n<start_of_image>";
      }
    }
    result += "<start_of_turn>" + role + "\n" + content + "<end_of_turn>\n";
  }
  if (add_generation_prompt) result += "<start_of_turn>model\n";
  return result;
}
```

`<start_of_image>` 토큰은 LiteRT-LM의 vision encoder가 인식하는 placeholder. 실제 이미지 임베딩은 prefill 단계에서 그 자리에 주입된다.

이건 모델-특화 코드라 다른 모델 가족엔 통하지 않는다. 임시 해결책으로 봐야 함.

---

## 6. 여섯 번째 벽 — C API 시그니처 변경

v0.10.2 → v0.11.0에서 conversation config API가 깨졌다:

```c
// v0.10.2 (6-args)
litert_lm_conversation_config_create(eng, sc, nil, nil, nil, false);

// v0.11.0 (zero-arg + setters)
auto* cc = litert_lm_conversation_config_create();
litert_lm_conversation_config_set_session_config(cc, sc);
litert_lm_conversation_config_set_enable_constrained_decoding(cc, false);
```

5분 작업. Swift `'nil' requires a contextual type` 컴파일러 에러가 알려준다.

---

## 7. 일곱 번째 벽 — `DYNAMIC_UPDATE_SLICE failed to prepare`

엔진이 등록되고, 모델이 로드되고, 추론을 호출했다:

```
external/litert/tflite/kernels/dynamic_update_slice.cc:70
  SizeOfDimension(update, i) <= SizeOfDimension(operand, i) was not true.
Node number 1164 (DYNAMIC_UPDATE_SLICE) failed to prepare.
conversation_send_message returned NULL after 3.67s
```

`DYNAMIC_UPDATE_SLICE`는 KV 캐시에 새 토큰을 쓸 때 쓰는 TFLite 노드. "update slice가 cache buffer보다 크다"는 건 보통:

- (가설 A) max_num_tokens가 prefill 토큰 수보다 작아서 cache overflow
- (가설 B) MTP drafter가 K-토큰을 한 번에 cache에 쓰는데 메인 디코더 slot이 K=1만 받게 설계됨

가설 A를 먼저 시도 — 1024 → 2048 — **부분 해결**, 하지만 같은 에러가 다른 위치에서 또 발생.

가설 B가 정답이었다. v0.11.0이 `.litertlm` 번들에서 `tf_lite_mtp_drafter` 섹션을 발견하면 **speculative decoding을 자동 ON**한다. 그런데 Gemma 4의 MTP drafter는 main decoder와 KV 캐시 슬라이스 shape가 다르다.

```swift
litert_lm_engine_settings_set_enable_speculative_decoding(settings, false)
litert_lm_engine_settings_set_max_num_tokens(settings, 2048)
```

MTP를 끄면 throughput 손해. 하지만 일단 동작이 우선.

---

## 8. 여덟 번째 벽 — Conversation API state pollution

추론이 동작했다. 첫 호출 응답 길이 2176자 — Korean meaning까지 멀쩡한 JSON 배열.

```
[nivoca-ai] NivocaAi.infer returned in 62385ms raw.len=2176
```

두 번째 호출:
```
[nivoca-ai] NivocaAi.infer returned in 9481ms raw.len=2
```

세 번째:
```
[nivoca-ai] NivocaAi.infer returned in 7476ms raw.len=1
```

**원인**: conversation 객체는 stateful이다. 매 `send_message` 호출은 이전 메시지를 chat history에 누적시키고 prefill 단계에서 다시 입력으로 사용한다. 우리 prompt가 약 1284자 + 이미지 토큰 256개 + 응답 1024 토큰을 누적하면 max_num_tokens=2048를 두 번째 호출에서 이미 넘는다.

**해결**: engine + sessionConfig + convConfig (모두 비싼 setup) 는 캐시. **conversation은 매 추론마다 새로 생성하고 finally에서 delete**.

```swift
// 캐시된 engine을 재사용하되 conversation은 새로
guard let conversation = litert_lm_conversation_create(engine, convConfig) else {
  throw NivocaAiError("not_ready", ...)
}
defer { litert_lm_conversation_delete(conversation) }
// ... send_message ...
```

> 교훈: **LLM conversation API는 거의 항상 stateful**. 일회성 추론이라면 매 호출마다 새 객체를 생성하고 폐기하라.

---

## 9. 아홉 번째 벽 — 그리디 sampler가 만든 무한 반복

이제 conversation은 깨끗하지만 모델 출력이 망가졌다:

```
[{"term": "新着情報"...}, {"term": "静岡県"...}, {"term": "富士山"...},
 {"term": "世界遺産"...}, {"term": "センター"...},
 {"term": "静岡県"...}, {"term": "富士山"...}, ...(반복 5x)...
 {"term": "センター", "  <- 잘림
```

같은 5개 단어가 끝없이 반복되다가 max_output_tokens에서 잘린다.

**원인**: LiteRT-LM의 default sampler가 **그리디** (argmax)다. 그리디 디코딩은 동일 컨텍스트에서 동일 출력 → JSON 배열의 닫기 직전에서 무한 루프.

LiteRT-LM C API에 `repetition_penalty`는 없다. 대신 sampler type을 바꿀 수 있다:

```swift
var sampler = LiteRtLmSamplerParams(
  type: kLiteRtLmSamplerTypeTopP,
  top_k: 40,
  top_p: 0.95,
  temperature: 0.7,
  seed: 0
)
withUnsafePointer(to: &sampler) { ptr in
  litert_lm_session_config_set_sampler_params(sc, ptr)
}
```

확률적 샘플링으로 바꾸면 반복 루프 즉시 사라진다.

---

## 10. JSON 파서 보강 (모델 후처리)

마지막으로 JS 측에서:

1. 모델이 종종 ` ```json [...] ``` ` 마크다운으로 출력을 감싼다
2. max_output_tokens에 도달하면 항목 중간에서 잘린다 — JSON.parse 실패
3. 동일 단어를 중복 출력하는 경향 (특히 `お城` + `城` 같은 honorific 변형)

→ **Balanced bracket walker**로 다시 작성:

```ts
function parseJsonArray(content: string): AiExtractedWord[] {
  const start = content.indexOf('[');
  if (start === -1) return [];

  // Fast path
  const fullMatch = content.slice(start).match(/\[[\s\S]*\]/);
  if (fullMatch) {
    try { return JSON.parse(fullMatch[0]); } catch {}
  }

  // Fallback: walk and collect each balanced {...}
  const items: Record<string, unknown>[] = [];
  let depth = 0, inString = false, escape = false, itemStart = -1;
  for (let i = start + 1; i < content.length; i++) {
    const c = content[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') { if (depth === 0) itemStart = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && itemStart >= 0) {
        try { items.push(JSON.parse(content.slice(itemStart, i + 1))); }
        catch {}
        itemStart = -1;
      }
    } else if (c === ']' && depth === 0) break;
  }
  return items;
}
```

잘린 마지막 항목은 skip, 그 전 항목들은 살린다. 마크다운 코드 펜스도 자연스럽게 무시.

Honorific 중복은 별도 후처리: `お城`과 `城`이 둘 다 있으면 `お城` 쪽 drop. `御朱印`처럼 base form이 없으면 그대로 유지.

---

## 회고

### 체감 시간 분배

| 단계 | 시간 |
|-----|-----|
| Entitlement 발견 + 해결 | 2일 |
| v0.11.0 Bazel 빌드 | 반나절 |
| Linker stripping 패치 | 하루 |
| MTP / KV cache 튜닝 | 반나절 |
| Conversation state pollution | 2시간 |
| Sampler / 후처리 | 반나절 |
| 멀티 variant 모델 매니저 + UI | 1일 |

처음 시도 → 첫 OCR 성공까지 **5일 정도**. 같은 함정 피하면 1-2일로 가능.

### 교훈 정리

1. **iOS + 2GB 넘는 모델 = `extended-virtual-addressing` entitlement + 유료 개발자 계정**. 가장 먼저 확인할 것
2. **iOS 정적 라이브러리 + self-registration 패턴 = force-link 필요**. 라이브러리 어셈블리 동작을 의심해라
3. **stderr 캡처는 필수**. iOS는 stderr을 os_log에 라우팅 안 함 → `dup2` 로 파일로 우회한 후 다시 os_log로 drain하는 헬퍼 코드 한 번 만들어두면 인생 편해짐
4. **새 모델 + 새 라이브러리 버전 = MTP/speculative 같은 부가 기능은 OFF로 시작**. 안정 동작 확인 후 켜기
5. **conversation API는 stateful로 가정하라**. 매 요청마다 폐기/재생성
6. **default sampler가 greedy인 라이브러리는 무한 반복에 취약**. TopP + temperature 0.7-1.0 + 보조 보호망
7. **모델 출력 파서는 관대해야 한다**. JSON.parse 한 번으로 끝나는 사치는 누리지 마라
8. **시행착오는 stderr 로그에 다 있다**. 보이지 않으면 보이게 만들기부터

### Stack 최종

- **iOS 네이티브**: LiteRT-LM v0.11.0 (patched), Gemma 4 E2B int4, TopP sampler, MTP off, max_num_tokens=2048
- **TS**: Balanced JSON parser, honorific dedup, decomposition pass, multi-variant model manager
- **UX**: 2개 variant 동시 보유, sequential 다운로드, active 선택, "모델 없으면 설정으로 redirect"

소스: 작동 중. 다음 단계는 E4B (3.41 GB) 변종에서 같은 코드가 잘 도는지 확인하고 TestFlight 베타 시작.

---

*기록일: 2026-05. iPhone 15 Pro에서 검증. LiteRT-LM v0.11.0 + 자체 패치.*
