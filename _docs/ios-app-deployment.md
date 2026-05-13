# Expo iOS 앱 배포 (NiVoca)

> Status: **Complete** — EAS Build production 빌드 성공, TestFlight 업로드 대기 단계.

> Expo Bare workflow (LiteRT-LM XCFramework 포함) 프로젝트를 EAS Build로 production 배포하기까지의 셋업 + 트러블슈팅 기록. Gemma 4 멀티모달 통합은 별도 문서 [blog-gemma4-ios-litert-journey.md](./blog-gemma4-ios-litert-journey.md) 참고.

---

## 출발점

- **앱**: NiVoca (일본어 단어장 PWA + iOS WebView shell)
- **Bundle ID**: `win.jun-devlog.nivoca`
- **개발 계정**: Junhyeon Yoon (Apple Developer Program 유료 가입, Team `7D92AXK55P`)
- **Stack**: Expo 55, Bare workflow (`ios/` 디렉토리 git 트래킹), Vendored LiteRTLM.xcframework (~163 MB)
- **WebView**: `https://nivoca.jun-devlog.win` (별도 호스팅)

배포 목표: **TestFlight Internal Testing → App Store 정식 출시**.

---

## 1. EAS CLI 셋업

```bash
bun add -g eas-cli
eas whoami   # 미로그인이면 eas login
```

⚠️ `bunx eas` 가 아니라 **`eas-cli`** 가 패키지 이름. 전역 설치하면 `eas` 명령으로 단축.

`expo.dev` 계정 필요 — 무료 가입.

---

## 2. iOS 빌드 자격증명

```bash
cd apps/mobile
eas credentials -p ios
```

`All: Set up all the required credentials to build your project` 선택. 입력 받는 것:

- Apple ID + 2FA (Apple Developer Portal 로그인)
- Team 선택 (paid Individual / Organization)

자동 처리:
- ✅ Bundle identifier 등록 (`win.jun-devlog.nivoca`)
- ✅ App capabilities sync (Push Notifications, Extended Virtual Addressing)
- ✅ Distribution Certificate 생성 (서명 키 — 2년 만료)
- ✅ App Store Provisioning Profile 생성

결과 예시:

```
Distribution Certificate  Serial 4CF8AFB47F445F2DDBF9A6E62F9710C3
Provisioning Profile      Developer Portal ID L37SAY826H
Apple Team                7D92AXK55P (Junhyeon Yoon (Individual))
```

EAS가 키를 자기 서버에 암호화 저장 → 매 빌드마다 자동 사용. 로컬 keychain 의존 안 함.

### 중요한 entitlement

`extended-virtual-addressing` 가 provisioning profile에 포함됐는지 확인.
`apps/mobile/ios/NiVoca/NiVoca.entitlements`:

```xml
<plist version="1.0">
  <dict>
    <key>com.apple.developer.kernel.extended-virtual-addressing</key>
    <true/>
    <key>aps-environment</key>
    <string>development</string>
  </dict>
</plist>
```

- `extended-virtual-addressing`: 2 GB+ 모델 mmap (Gemma 4 E2B = 2.41 GB)
- `aps-environment`: Push Notification — `development` 값이 APNs sandbox + production 둘 다 작동

---

## 3. Push Notifications 키

EAS credentials 메뉴 → **Push Notifications** → `Set up a Push Notifications Key` → `Generate a new Apple Push Notifications service key`.

자동 처리:
- Apple Developer Portal에 새 APNs `.p8` key 생성
- EAS 서버 암호화 저장
- 프로젝트(`nivoca`)에 자동 할당

⚠️ Apple 계정당 APNs key는 **최대 2개**만 활성화 가능. 첫 셋업이면 그냥 새로 만들면 됨.

---

## 4. App Store Connect 자동화

EAS credentials 메뉴 → **App Store Connect: Manage your API Key** → `Set up your project to use an API Key for EAS Submit` → `Generate a new App Store Connect API Key` (Role: ADMIN).

이 키는 `eas submit -p ios --latest` 시 자동 인증용. 안 만들면 매번 Apple ID + 2FA 수동.

---

## 5. App Store Connect에 앱 등록 (수동, 1회)

https://appstoreconnect.apple.com → **My Apps** → **+** → **New App**:

| 필드 | 값 |
|------|-----|
| Platform | iOS |
| Name | NiVoca |
| Primary Language | 한국어 |
| Bundle ID | `win.jun-devlog.nivoca` (드롭다운에 EAS가 등록한 ID 자동 노출) |
| SKU | `nivoca-ios` (임의 식별자) |
| User Access | Full Access |

→ 빈 앱 항목 생성. Metadata (스크린샷, 설명, 카테고리) 는 TestFlight Internal Testing 단계에서 없어도 됨. App Store 정식 출시 시점에만 필수.

⚠️ 등록 시 이름을 "Nivoca" 같은 소문자로 잘못 쳤다면 **App Information** 메뉴에서 변경 가능 (정식 리뷰 제출 전).

---

## 6. eas.json 설정

```json
{
  "cli": {
    "version": ">= 14.0.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": { ... },
    "production": {
      "autoIncrement": true,
      "env": {
        "EXPO_PUBLIC_WEB_URL": "https://nivoca.jun-devlog.win"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

핵심:
- **`appVersionSource: "remote"`** — `buildNumber`를 EAS 서버가 관리. 첫 빌드 시 EAS CLI가 자동 추가.
- **`autoIncrement: true`** — 매 빌드마다 `buildNumber` +1 자동 (boolean만 받음, "buildNumber" 같은 문자열 안 됨).
- **`EXPO_PUBLIC_WEB_URL`** — WebView가 로드할 prod web URL. dev/preview 프로필별로 다르게 설정 가능.

---

## 7. 빌드 + 트러블슈팅

```bash
eas build -p ios --profile production
```

### Vendored XCFramework — `no such module 'LiteRTLM'` 에러

**증상**:

```
🍏 iOS build failed:
The "Run fastlane" step failed because of an error in the Xcode build process.
- no such module 'LiteRTLM'
```

**원인**: `.gitignore` 가 `apps/mobile/modules/nivoca-ai/ios/Frameworks/*` 를 제외. EAS Build는 git에 추적된 파일만 클라우드로 업로드 → vendored XCFramework가 빌드 환경에 없음.

**해결**: Git LFS 로 80–83 MB 정적 아카이브 추적.

```bash
# 1. LFS 활성화
brew install git-lfs   # 없으면
git lfs install

# 2. .gitattributes 추가
cat > .gitattributes <<'EOF'
apps/mobile/modules/nivoca-ai/ios/Frameworks/LiteRTLM.xcframework/**/LiteRTLM filter=lfs diff=lfs merge=lfs -text
EOF

# 3. .gitignore에서 Frameworks 제외 해제
# (Frameworks/* 통째로 ignore 였던 줄을 삭제하거나 주석)

# 4. add + commit + push
git add .gitattributes .gitignore apps/mobile/modules/nivoca-ai/ios/Frameworks/LiteRTLM.xcframework
git lfs ls-files   # 정상 pattern 매칭 확인
git commit -m "feat(mobile): vendor patched LiteRT-LM XCFramework via Git LFS"
git push
```

**확인**:
- `git cat-file -p HEAD:path/to/LiteRTLM` → "version https://git-lfs.github.com/spec/v1" 으로 시작하면 LFS pointer (130 bytes). raw ELF 바이너리면 LFS가 안 잡힘.
- EAS Build는 LFS 자동 지원. `git push` 시 LFS 객체가 GitHub LFS storage 로 별도 업로드 됨.

### Git history orphan — 84 MB raw blobs

LFS 셋업 *이전에* push한 raw 바이너리 또는 백업 폴더가 history에 남음. GitHub push 시 경고:

```
remote: warning: File be9df5ac... is 84.11 MB; this is larger than GitHub's
        recommended maximum file size of 50.00 MB
```

**진단**:

```bash
git rev-list --objects --all | grep -E 'binary-path$'
git log --all --find-object=<orphan-sha> --oneline
git ls-tree -r <commit-sha> | grep <orphan-sha>
```

→ `LiteRTLM.xcframework.v0.10.2.bak/` 처럼 LFS pattern 안 맞는 백업 폴더에 있던 raw bytes 였음.

**해결**: history rewrite로 path 완전 제거.

```bash
brew install git-filter-repo

# 안전망
git tag pre-filter-repo-backup

# 해당 path 가 들어간 모든 commit에서 path 자체를 제거
git filter-repo --path apps/mobile/modules/nivoca-ai/ios/Frameworks/LiteRTLM.xcframework.v0.10.2.bak \
                --invert-paths --force

# filter-repo는 안전 차원에서 origin remote를 제거 → 재추가
git remote add origin https://github.com/<user>/<repo>.git

# rewrite는 모든 commit SHA를 바꾸므로 force push 필수
git push --force origin main
```

⚠️ GitHub은 unreferenced blob을 즉시 GC 하지 않음 (몇 주 후 자동). SHA로 직접 접근하면 보일 수 있지만 모든 clone / EAS Build / 일반 사용자엔 안 보임.

### 빌드 산출물

```
Compressing project files 3s (~150 MB after LFS pull)
✔ Uploaded to EAS 5s
✔ Build Succeeded

Result: /Users/jun/Downloads/application-<uuid>.ipa
```

`.ipa` 다운로드 URL은 EAS dashboard에도 표시 — https://expo.dev/accounts/.../builds/...

---

## 8. App Store Connect 업로드 (TestFlight 노출)

```bash
eas submit -p ios --latest
```

자동 처리:
- App Store Connect API key 로 인증 (5번 셋업)
- 최근 production 빌드 자동 선택
- App Store Connect 업로드 (몇 분)

### Export Compliance

iOS 첫 빌드 업로드 시 한 번 질문:
- Q: "Does your app use encryption?"
- A: 보통 **Yes** (HTTPS만 써도 yes) → 후속 질문 "exempt under category 5D992 (mass market)" → **Yes** (standard HTTPS는 면제)

`Info.plist`에 `ITSAppUsesNonExemptEncryption = NO` 추가하면 매번 질문 안 받음.

### TestFlight 설치

1. App Store Connect → 앱 → **TestFlight** 탭
2. 빌드 처리 ~5–15분 (encryption export compliance + malware scan)
3. **Internal Testing** 그룹 생성 → 본인 Apple ID 이메일을 테스터로 추가
4. iPhone에서 **TestFlight 앱** 설치 → 같은 Apple ID 로그인 → 빌드 자동 노출 → Install

⚠️ TestFlight에서 받은 빌드는 **production signed**. `expo run:ios` 로컬 빌드와 별개 (다른 인증서로 사인).

---

## Final Summary

### 끝낸 일

- [x] EAS CLI 전역 설치 + expo.dev 계정 로그인
- [x] iOS Distribution Certificate + Provisioning Profile (EAS 자동 관리)
- [x] APNs `.p8` key 생성 + 프로젝트 할당
- [x] App Store Connect API Key 생성 (EAS Submit 용)
- [x] App Store Connect 에 앱 등록 (`win.jun-devlog.nivoca`)
- [x] eas.json — `appVersionSource: remote`, `autoIncrement: true`
- [x] `extended-virtual-addressing` + `aps-environment` entitlement
- [x] Vendored XCFramework Git LFS 마이그레이션
- [x] Git history orphan blob 정리 (`git filter-repo --invert-paths`)
- [x] `eas build -p ios --profile production` 성공 → `.ipa` 생성
- [x] `eas submit -p ios --latest` → App Store Connect 업로드

### 다음 단계

- [ ] TestFlight 빌드 처리 완료 확인
- [ ] Internal Testing 그룹 세팅 + 본인 iPhone 에 설치
- [ ] 실기기 production 빌드에서 멀티모달 OCR 동작 검증
- [ ] App Store metadata 작성 (앱 설명, 스크린샷, 카테고리, 개인정보 처리방침)
- [ ] App Privacy 신고 (Apple 양식)
- [ ] App Store 정식 리뷰 제출

### 교훈

1. **Bare workflow + EAS Build = vendored binary 처리 주의**. `.gitignore` 로 빼면 클라우드 빌드에 없음. Git LFS 가 표준 해법.
2. **첫 push 전에 LFS 셋업 끝내라**. raw bytes 가 history 에 들어가면 force-push + history rewrite 가 필요해짐.
3. **`autoIncrement` 는 boolean**. `"buildNumber"` 같은 string은 거부됨 (CLI 버전 따라 차이).
4. **`appVersionSource: remote`** 추천. EAS 서버가 buildNumber 관리 → 로컬 commit 충돌 없음.
5. **`aps-environment = development`** 가 production builds 에서도 작동. APNs key 가 universal token 으로 두 endpoint 다 인증.
6. **EAS credentials menu 는 한 자리에 모든 거**. Distribution Cert, Provisioning Profile, Push Key, App Store Connect API Key — 처음에 한 번 다 셋업하면 그 후 빌드/제출 자동.

---

*기록일: 2026-05-14. EAS CLI 14.x, Expo SDK 55, Bare workflow.*
