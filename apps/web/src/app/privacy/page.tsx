'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { pageWrapper, scrollArea, bottomBar, bottomSep } from '@/lib/styles';

const PRIVACY_AGREED_KEY = 'vocabook_privacy_agreed';

function PrivacyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale } = useTranslation();
  const from = searchParams.get('from');

  const handleAgree = () => {
    sessionStorage.setItem(PRIVACY_AGREED_KEY, 'true');
    router.back();
  };

  return (
    <>
      <Header title={t.consent.privacyPolicyTitle} showBack />

      <div className={pageWrapper}>
        <div className={scrollArea}>
          <div className="prose prose-sm max-w-none px-4 py-6 dark:prose-invert">
            {locale === 'ko' ? <PrivacyKo /> : <PrivacyEn />}
          </div>
        </div>

        {from === 'signup' && (
          <div className={bottomBar}>
            <div className={bottomSep} />
            <Button className="w-full" onClick={handleAgree}>
              {t.auth.privacyAgree}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

export default function PrivacyPage() {
  return (
    <Suspense>
      <PrivacyContent />
    </Suspense>
  );
}

function PrivacyKo() {
  return (
    <>
      <h1>NiVoca 개인정보 처리방침</h1>
      <p>
        NiVoca(이하 &quot;서비스&quot;)는 이용자의 개인정보를 소중하게 여기며,
        「개인정보 보호법」 등 관련 법령을 준수하여 이용자의 개인정보를 안전하게
        처리하기 위하여 다음과 같이 개인정보 처리방침을 수립·공개합니다.
      </p>

      <h2>제1조 (수집하는 개인정보의 항목 및 수집 방법)</h2>
      <h3>1. 수집하는 개인정보 항목</h3>
      <p><strong>1) 회원가입 시 수집되는 항목 (필수)</strong></p>
      <ul>
        <li>이메일 주소</li>
        <li>닉네임</li>
        <li>프로필 사진(이미지 URL 또는 파일)</li>
        <li>JLPT 레벨 정보 (예: N1~N5)</li>
      </ul>
      <p><strong>2) 선택 수집 항목</strong></p>
      <ul>
        <li>LLM API Key (예: OpenAI API Key 등)</li>
      </ul>
      <p><strong>3) 서비스 이용 과정에서 자동으로 수집될 수 있는 정보</strong></p>
      <ul>
        <li>접속 일시, 접속 IP, 서비스 이용 기록, 기기 정보(브라우저 종류, OS 등), 쿠키 정보</li>
      </ul>
      <h3>2. 개인정보 수집 방법</h3>
      <ul>
        <li>회원가입 및 서비스 이용 과정에서 이용자가 직접 입력</li>
        <li>소셜 로그인 기능 이용 시, 해당 제공자의 동의를 거쳐 필요한 범위 내에서 제공받는 방식</li>
      </ul>

      <h2>제2조 (개인정보의 처리 목적 및 처리 근거)</h2>
      <p>서비스는 수집한 개인정보를 다음 목적과 법적 근거에 따라 처리합니다.</p>
      <h3>1. 회원 관리 및 서비스 제공</h3>
      <ul>
        <li>목적: 회원 식별 및 인증, 계정 생성·유지, 부정 이용 방지, 서비스 이용 내역 관리, 일본어 단어장 및 학습 기능 제공</li>
        <li>처리 근거: 서비스 이용계약의 이행 및 정보주체의 동의</li>
      </ul>
      <h3>2. 학습 맞춤 기능 제공</h3>
      <ul>
        <li>목적: JLPT 레벨에 따른 단어·콘텐츠 추천, 학습 기록 및 통계 제공, 프로필 정보를 통한 개인화된 화면 구성</li>
        <li>처리 근거: 정보주체의 동의</li>
      </ul>
      <h3>3. LLM API Key(선택 항목)의 이용 목적</h3>
      <ul>
        <li>목적: 이용자가 직접 제공한 LLM API Key를 사용하여 단어 예문 생성, 번역, 설명 등 개인 맞춤형 LLM 기능 제공</li>
        <li>처리 근거: 정보주체의 동의</li>
      </ul>
      <h3>4. 고객 문의 처리 및 서비스 품질 개선</h3>
      <ul>
        <li>목적: 문의·불만 처리, 오류·버그 확인, 서비스 이용 패턴 분석 및 기능 개선</li>
        <li>처리 근거: 정보주체의 동의 및 정당한 이익 범위 내 처리</li>
      </ul>
      <p>
        서비스는 위 목적을 위해 「개인정보 보호법」 제15조 및 제22조 등 관련 법령에 따라
        이용자의 동의를 기반으로 개인정보를 처리합니다.
      </p>

      <h2>제3조 (개인정보의 보유 및 이용 기간)</h2>
      <h3>1. 기본 보유 기간</h3>
      <ul>
        <li>회원 탈퇴 시까지: 이메일 주소, 닉네임, 프로필 사진, JLPT 레벨 정보, 선택적으로 제공된 LLM API Key, 서비스 이용 기록 등</li>
        <li>회원이 LLM API Key를 삭제하는 경우: 해당 Key는 즉시 파기되며, 관련 기능은 더 이상 제공되지 않습니다.</li>
      </ul>
      <h3>2. 관련 법령에 따른 예외 보유</h3>
      <p>서비스는 다음 각 호의 법령에서 정한 일정 기간 동안 관계 법령의 규정에 따라 개인정보를 보관할 수 있습니다.</p>
      <ul>
        <li>「전자상거래 등에서의 소비자보호에 관한 법률」
          <ul>
            <li>계약 또는 청약철회 등에 관한 기록: 5년</li>
            <li>대금 결제 및 재화 등의 공급에 관한 기록: 5년</li>
            <li>소비자 불만 또는 분쟁처리에 관한 기록: 3년</li>
          </ul>
        </li>
      </ul>
      <h3>3. 보유 기간 경과 또는 처리 목적 달성 시, 해당 개인정보는 지체 없이 파기합니다.</h3>

      <h2>제4조 (개인정보의 제3자 제공 및 국외 이전)</h2>
      <h3>1. 제3자 제공 원칙</h3>
      <p>서비스는 원칙적으로 이용자의 개인정보를 외부에 제공하지 않습니다.</p>
      <h3>2. 예외적으로 제3자 제공이 이루어질 수 있는 경우</h3>
      <ul>
        <li>이용자가 사전에 개별적으로 동의한 경우</li>
        <li>법령에 특별한 규정이 있거나, 수사기관이 법령에 정해진 절차와 방법에 따라 요청한 경우</li>
      </ul>
      <h3>3. LLM 서비스 제공자에 대한 정보 전송 및 국외 이전</h3>
      <ul>
        <li>서비스는 LLM 기능 제공을 위하여 이용자가 입력한 텍스트(단어, 문장, 예문, 번역 요청 내용 등)와, 필요한 경우 선택적으로 제공된 LLM API Key를 LLM 서비스 제공자에게 전송할 수 있습니다.</li>
        <li>LLM 서비스 제공자의 서버 위치가 국외(예: 미국 등)에 있을 수 있으며, 이 경우 해당 정보가 국외로 이전될 수 있습니다.</li>
        <li>국외 이전의 대상, 이전국가, 이전 일시 및 방법, 보유·이용 기간 등은 실제 사용하는 LLM 서비스 제공자(예: OpenAI, Anthropic, Google 등)의 정책에 따르며, 서비스는 이용 약관 및 공지사항 등을 통해 가능한 범위 내에서 이를 안내합니다.</li>
        <li>이용자는 LLM 기능 사용을 선택하지 않을 수 있으며, LLM 기능을 사용하지 않는 경우 해당 데이터는 LLM 서비스 제공자에게 전송되지 않습니다.</li>
      </ul>

      <h2>제5조 (개인정보 처리의 위탁)</h2>
      <p>서비스는 안정적인 운영 및 기능 제공을 위하여 다음과 같이 개인정보 처리 업무를 외부에 위탁하고 있습니다.</p>
      <ul>
        <li>클라우드 인프라 및 인증·데이터베이스 제공: Supabase (AWS 기반)</li>
        <li>CDN 및 네트워크 보안: Cloudflare</li>
      </ul>
      <p>
        서비스는 위탁 계약 체결 시 「개인정보 보호법」 제26조에 따라 수탁자가
        개인정보를 안전하게 처리하도록 필요한 사항을 규정하고, 정기적으로 이를 감독합니다.
      </p>

      <h2>제6조 (이용자의 권리·의무 및 행사 방법)</h2>
      <ol>
        <li>이용자는 언제든지 서비스 내 &quot;설정&quot; 메뉴를 통하여 자신의 개인정보를 조회·수정·삭제할 수 있습니다.</li>
        <li>이용자는 회원 탈퇴 기능을 통하여 개인정보의 수집·이용에 대한 동의를 철회할 수 있습니다. 이 경우 법령에서 정한 바에 따라 보관이 필요한 정보는 별도로 분리하여 보관 후, 보존 기간 종료 시 지체 없이 파기합니다.</li>
        <li>LLM API Key는 이용자가 직접 등록·수정·삭제할 수 있으며, 삭제 시 이후부터는 해당 Key를 활용한 LLM 기능이 제공되지 않습니다.</li>
        <li>이용자는 이메일(haring157@naver.com)을 통하여 개인정보 열람, 정정·삭제, 처리정지, 동의철회를 요청할 수 있으며, 서비스는 관련 법령이 정한 기한 내에 이에 대해 조치하고 그 결과를 통지합니다.</li>
        <li>이용자는 자신의 개인정보를 최신의 상태로 정확하게 입력·관리할 책임이 있으며, 타인의 정보를 도용하는 등 부정한 행위를 해서는 안 됩니다.</li>
      </ol>

      <h2>제7조 (개인정보의 파기 절차 및 방법)</h2>
      <h3>1. 파기 사유</h3>
      <p>개인정보 보유 기간이 경과하거나 처리 목적이 달성되는 등 개인정보가 더 이상 필요하지 않게 된 경우, 해당 개인정보를 지체 없이 파기합니다.</p>
      <h3>2. 파기 방법</h3>
      <ul>
        <li>전자적 파일 형태: 복구 및 재생이 불가능한 기술적 방법을 사용하여 영구 삭제</li>
        <li>종이 문서: 분쇄 또는 소각</li>
      </ul>

      <h2>제8조 (LLM API Key에 관한 특별 조항)</h2>
      <ol>
        <li>LLM API Key는 선택 항목으로, 이용자가 LLM 기능(번역, 예문 생성, 설명 생성 등)을 사용하기 위해 직접 입력하는 경우에만 수집·저장됩니다.</li>
        <li>LLM API Key는 암호화된 형태로 저장되며, 서비스는 해당 Key를 이용자의 계정과 연동된 LLM 요청 처리 목적에 한하여 사용합니다.</li>
        <li>서비스는 이용자가 제공한 LLM API Key를 다른 이용자의 요청 처리, 서비스 자체의 과금 절감 또는 이익을 위한 별도 목적, 서비스 외부의 다른 시스템 연동 등에 사용하지 않습니다.</li>
        <li>이용자는 언제든지 &quot;설정&quot; 화면에서 LLM API Key를 수정 또는 삭제할 수 있으며, 삭제 시 해당 Key를 이용한 기능은 즉시 중단됩니다.</li>
        <li>이용자가 자신의 LLM API Key를 설정하는 경우, 해당 Key 사용에 따른 LLM 서비스 이용료 및 과금 책임은 이용자와 LLM 제공자 간 약관에 따르며, 서비스는 그 비용을 대신 부담하지 않습니다.</li>
      </ol>

      <h2>제9조 (개인정보의 안전성 확보 조치)</h2>
      <p>서비스는 이용자의 개인정보를 안전하게 보호하기 위하여 다음과 같은 안전성 확보 조치를 취하고 있습니다.</p>
      <h3>1. 관리적 조치</h3>
      <ul>
        <li>개인정보 보호를 위한 내부 관리계획 수립 및 시행</li>
        <li>개인정보 처리자에 대한 최소 권한 부여</li>
      </ul>
      <h3>2. 기술적 조치</h3>
      <ul>
        <li>개인정보 및 LLM API Key의 암호화 저장</li>
        <li>서비스 서버 및 DB에 대한 접근 통제, 접근 로그 보관</li>
        <li>보안 프로그램 설치 및 주기적인 취약점 점검 및 업데이트</li>
      </ul>
      <h3>3. 물리적 조치</h3>
      <ul>
        <li>서버 및 네트워크 설비에 대한 물리적 접근 통제(클라우드 제공자의 물리적 보안 정책 준수)</li>
      </ul>

      <h2>제10조 (개인정보 보호책임자)</h2>
      <ul>
        <li>개인정보 보호책임자: 윤준현</li>
        <li>소속: 서비스 운영자 (개인 개발)</li>
        <li>이메일: haring157@naver.com</li>
      </ul>
      <p>
        이용자는 서비스를 이용하면서 발생한 모든 개인정보 보호 관련 문의, 불만 처리, 피해 구제 등에
        관한 사항을 개인정보 보호책임자에게 문의할 수 있으며, 서비스는 이에 대해 지체 없이 답변 및
        처리하겠습니다.
      </p>

      <h2>제11조 (개인정보 처리방침의 변경)</h2>
      <ol>
        <li>본 개인정보 처리방침의 내용 추가, 삭제 및 수정이 있는 경우, 변경 사항의 시행 7일 전부터 서비스 내 공지사항을 통해 공지합니다.</li>
        <li>다만, 이용자 권리의 중요한 변경이 있는 경우에는 최소 30일 전에 공지하며, 필요한 경우 별도의 동의를 다시 받을 수 있습니다.</li>
      </ol>
      <p className="mt-8 text-muted-foreground">이 개인정보 처리방침은 2026년 2월 24일부터 적용됩니다.</p>
    </>
  );
}

function PrivacyEn() {
  return (
    <>
      <h1>NiVoca Privacy Policy</h1>
      <p>
        NiVoca (hereinafter &quot;Service&quot;) values users&apos; personal information and complies
        with the Personal Information Protection Act and other relevant laws to safely process
        users&apos; personal information. This Privacy Policy is established and disclosed as follows.
      </p>

      <h2>Article 1 (Items of Personal Information Collected and Collection Methods)</h2>
      <h3>1. Items of Personal Information Collected</h3>
      <p><strong>1) Items collected during registration (required)</strong></p>
      <ul>
        <li>Email address</li>
        <li>Nickname</li>
        <li>Profile picture (image URL or file)</li>
        <li>JLPT level information (e.g., N1–N5)</li>
      </ul>
      <p><strong>2) Optional items</strong></p>
      <ul>
        <li>LLM API Key (e.g., OpenAI API Key)</li>
      </ul>
      <p><strong>3) Information automatically collected during service usage</strong></p>
      <ul>
        <li>Access time, IP address, service usage records, device information (browser type, OS), cookies</li>
      </ul>
      <h3>2. Methods of Collection</h3>
      <ul>
        <li>Directly entered by users during registration and service usage</li>
        <li>Provided through social login with user consent within necessary scope</li>
      </ul>

      <h2>Article 2 (Purpose and Legal Basis of Processing)</h2>
      <h3>1. Member Management and Service Provision</h3>
      <ul>
        <li>Purpose: User identification and authentication, account management, fraud prevention, Japanese vocabulary and learning features</li>
        <li>Legal basis: Performance of service agreement and user consent</li>
      </ul>
      <h3>2. Personalized Learning Features</h3>
      <ul>
        <li>Purpose: Word/content recommendations by JLPT level, study records and statistics, personalized interface through profile information</li>
        <li>Legal basis: User consent</li>
      </ul>
      <h3>3. LLM API Key (Optional) Usage</h3>
      <ul>
        <li>Purpose: Providing personalized LLM features (example sentences, translation, explanations) using the user&apos;s own API Key</li>
        <li>Legal basis: User consent</li>
      </ul>
      <h3>4. Customer Support and Service Improvement</h3>
      <ul>
        <li>Purpose: Inquiry/complaint handling, bug fixes, usage pattern analysis and feature improvement</li>
        <li>Legal basis: User consent and legitimate interest</li>
      </ul>

      <h2>Article 3 (Retention and Usage Period)</h2>
      <h3>1. Default Retention Period</h3>
      <ul>
        <li>Until account deletion: Email, nickname, profile picture, JLPT level, optional LLM API Key, service usage records</li>
        <li>When user deletes LLM API Key: The Key is immediately destroyed and related features are no longer provided</li>
      </ul>
      <h3>2. Exceptions under Applicable Laws</h3>
      <ul>
        <li>Records related to contracts or withdrawal: 5 years (Act on Consumer Protection in Electronic Commerce)</li>
        <li>Records related to payment and supply of goods: 5 years</li>
        <li>Records related to consumer complaints or disputes: 3 years</li>
      </ul>
      <h3>3. Personal information is destroyed without delay when the retention period expires or the purpose is fulfilled.</h3>

      <h2>Article 4 (Third-Party Provision and International Transfer)</h2>
      <h3>1. Principle</h3>
      <p>The Service does not provide users&apos; personal information to third parties in principle.</p>
      <h3>2. Exceptions</h3>
      <ul>
        <li>When the user has given prior individual consent</li>
        <li>When required by law or requested by investigative authorities following legal procedures</li>
      </ul>
      <h3>3. Information Transfer to LLM Service Providers</h3>
      <ul>
        <li>The Service may transmit user-entered text (words, sentences, translation requests) and, if necessary, the LLM API Key to LLM service providers for LLM functionality.</li>
        <li>LLM service provider servers may be located overseas (e.g., United States), in which case information may be transferred internationally.</li>
        <li>Details of international transfers follow the policies of the LLM service providers (e.g., OpenAI, Anthropic, Google).</li>
        <li>Users may choose not to use LLM features, in which case no data is transmitted to LLM providers.</li>
      </ul>

      <h2>Article 5 (Outsourcing of Processing)</h2>
      <p>The Service outsources the following for stable operation:</p>
      <ul>
        <li>Cloud infrastructure, authentication, and database: Supabase (AWS-based)</li>
        <li>CDN and network security: Cloudflare</li>
      </ul>

      <h2>Article 6 (User Rights and Obligations)</h2>
      <ol>
        <li>Users may view, modify, or delete their personal information through the &quot;Settings&quot; menu at any time.</li>
        <li>Users may withdraw consent by deleting their account. Information required by law will be separately stored and destroyed after the retention period.</li>
        <li>Users may register, modify, or delete their LLM API Key at any time.</li>
        <li>Users may request access, correction, deletion, suspension, or consent withdrawal via email (haring157@naver.com).</li>
        <li>Users are responsible for maintaining accurate personal information and must not misuse others&apos; information.</li>
      </ol>

      <h2>Article 7 (Destruction Procedure and Methods)</h2>
      <h3>1. Grounds for Destruction</h3>
      <p>Personal information is destroyed without delay when no longer necessary.</p>
      <h3>2. Methods</h3>
      <ul>
        <li>Electronic files: Permanently deleted using methods that prevent recovery</li>
        <li>Paper documents: Shredded or incinerated</li>
      </ul>

      <h2>Article 8 (Special Provisions for LLM API Keys)</h2>
      <ol>
        <li>LLM API Keys are optional and collected only when the user voluntarily enters them for LLM features.</li>
        <li>LLM API Keys are stored in encrypted form and used solely for processing LLM requests linked to the user&apos;s account.</li>
        <li>The Service does not use user-provided LLM API Keys for other users&apos; requests, cost reduction for the Service itself, or external system integration.</li>
        <li>Users may modify or delete their LLM API Key in &quot;Settings&quot; at any time.</li>
        <li>When users configure their own LLM API Key, usage fees are governed by the agreement between the user and the LLM provider. The Service does not bear these costs.</li>
      </ol>

      <h2>Article 9 (Security Measures)</h2>
      <h3>1. Administrative Measures</h3>
      <ul>
        <li>Establishment and implementation of internal management plan for personal information protection</li>
        <li>Minimum privilege access for personal information handlers</li>
      </ul>
      <h3>2. Technical Measures</h3>
      <ul>
        <li>Encryption of personal information and LLM API Keys</li>
        <li>Access control and log retention for servers and databases</li>
        <li>Security software and periodic vulnerability assessments</li>
      </ul>
      <h3>3. Physical Measures</h3>
      <ul>
        <li>Physical access control for servers and network equipment (compliance with cloud provider security policies)</li>
      </ul>

      <h2>Article 10 (Privacy Officer)</h2>
      <ul>
        <li>Privacy Officer: Junhyeon Yoon</li>
        <li>Role: Service Operator (Independent Developer)</li>
        <li>Email: haring157@naver.com</li>
      </ul>
      <p>
        Users may contact the Privacy Officer regarding any personal information protection
        inquiries, complaints, or damage relief. The Service will respond and process requests
        without delay.
      </p>

      <h2>Article 11 (Changes to Privacy Policy)</h2>
      <ol>
        <li>Changes to this Privacy Policy will be announced through in-service notices at least 7 days before taking effect.</li>
        <li>For significant changes affecting user rights, at least 30 days&apos; prior notice will be given, and additional consent may be requested if necessary.</li>
      </ol>
      <p className="mt-8 text-muted-foreground">This Privacy Policy is effective from February 24, 2026.</p>
    </>
  );
}
