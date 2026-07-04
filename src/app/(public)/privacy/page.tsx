/* eslint-disable react-refresh/only-export-components */
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export const metadata: Metadata = {
  title: '개인정보처리방침 | AruBot',
  description: 'AruBot 서비스의 개인정보 수집, 이용, 보관, 삭제 및 외부 서비스 연동에 관한 안내입니다.',
};

const effectiveDate = '2026년 7월 5일';

const sections = [
  {
    title: '1. 기본 원칙',
    body: [
      'AruBot은 인터넷 방송 참여 기능을 제공하기 위해 필요한 범위에서만 개인정보 및 서비스 이용 정보를 처리합니다.',
      'AruBot은 서비스 제공, 계정 연결, 방송 보조 기능, 보안 및 장애 대응에 필요한 정보를 수집, 저장, 이용, 조회, 전송할 수 있습니다.',
      '다만 관련 법령에서 요구하는 범위 내에서 개인정보 보호를 위해 합리적으로 가능한 조치를 취합니다.',
    ],
  },
  {
    title: '2. 수집 및 처리하는 정보',
    body: [
      '계정 및 연동 정보: CHZZK, CIME, YouTube 등 외부 플랫폼의 사용자 식별자, 채널 ID, 닉네임, 프로필 이미지, OAuth 토큰 또는 갱신 토큰, 권한 범위, 연결 상태',
      '방송 참여 정보: 채팅 명령어, 포인트, 출석, 룰렛, 예측, 후원 이벤트, 영상 요청, 자동화 실행 결과, 시청자별 참여 기록',
      '운영 정보: 접속 세션, 쿠키, API 키, OBS 또는 오버레이 토큰, 로컬 프로그램 연결 토큰, 오류 로그, 요청 시각, IP 주소, User-Agent, 보안 및 남용 방지를 위한 진단 정보',
      '사용자가 직접 입력한 정보: 명령어 응답, 자동화 설정, 후원 반응 규칙, 공개 페이지 설정, 업로드한 사운드 또는 FX 에셋 메타데이터',
      '로컬 프로그램 정보: 사용자가 선택한 로컬 폴더 경로, 로컬 에셋 목록, 로컬 프로그램 상태, 실행 결과. 실제 로컬 파일 원본은 기능 실행에 필요한 경우에 한해 사용자의 PC 또는 로컬 프로그램을 통해 처리될 수 있습니다.',
      '브라우저 및 기기 정보: 접속 환경, 브라우저 종류, 화면 또는 오버레이 접속 상태, 오류 정보, 성능 및 연결 상태 등 서비스 운영에 필요한 기술 정보',
    ],
  },
  {
    title: '3. 이용 목적',
    body: [
      '방송인과 시청자 계정 연결, 채팅 명령어 처리, 포인트/출석/룰렛/예측/후원 반응 제공',
      'YouTube Live, CHZZK, CIME 등 외부 플랫폼 API와의 연동, 메시지 전송, 라이브 상태 확인, 이벤트 수신',
      'OBS 오버레이, 영상 후원, FX 효과, TTS, 로컬 프로그램 연동 등 방송 보조 기능 제공',
      '서비스 안정성 확보, 장애 분석, 보안 사고 및 비정상 이용 방지, 문의 대응, 기능 개선',
      '법령상 의무 이행, 분쟁 대응, 권리 침해 또는 오남용 방지',
    ],
  },
  {
    title: '4. 보유 및 이용 기간',
    body: [
      '회원 또는 채널 연결 정보는 사용자가 연결을 해제하거나 삭제를 요청할 때까지 보관할 수 있습니다.',
      '포인트, 출석, 룰렛, 후원, 자동화 기록은 방송 운영 이력 제공과 분쟁 방지를 위해 서비스 운영상 필요한 기간 동안 보관할 수 있습니다.',
      'OAuth 토큰, API 키, 오버레이 토큰 등 인증 정보는 연동 기능 제공에 필요한 동안 보관하며, 연결 해제 또는 보안상 필요 시 삭제하거나 무효화할 수 있습니다.',
      '오류 로그와 보안 로그는 장애 대응, 남용 방지, 법적 대응을 위해 합리적으로 필요한 기간 동안 보관할 수 있습니다.',
      '법령, 수사기관 요청, 분쟁, 부정 이용 조사 등 정당한 사유가 있는 경우 해당 사유가 해소될 때까지 일부 정보를 더 오래 보관할 수 있습니다.',
    ],
  },
  {
    title: '5. 제3자 제공 및 외부 서비스 연동',
    body: [
      'AruBot은 기능 제공을 위해 사용자가 연결한 CHZZK, CIME, YouTube, Google, Supabase, 호스팅/배포/로그 처리 서비스 등 외부 서비스와 정보를 주고받을 수 있습니다.',
      '외부 플랫폼에는 채팅 메시지 전송, 라이브 상태 조회, 채널 정보 확인, OAuth 인증 처리 등 사용자가 요청한 기능 수행에 필요한 정보가 전달될 수 있습니다.',
      '사용자가 방송 화면, 공개 페이지, 오버레이 URL, 채팅 명령어 결과를 공개하면 해당 정보는 방송 시청자 또는 링크 접근자에게 노출될 수 있습니다.',
      'AruBot은 법령에 근거가 있거나, 정보주체 보호 및 서비스 보안을 위해 필요한 경우, 또는 사용자가 명시적으로 요청한 기능 수행에 필요한 경우 정보를 제공할 수 있습니다.',
    ],
  },
  {
    title: '6. 처리 위탁 및 인프라',
    body: [
      'AruBot은 데이터 저장, 인증, 서버 운영, 배포, 모니터링, 이메일 또는 알림, 로그 분석 등을 위해 클라우드 및 오픈소스 기반 인프라를 사용할 수 있습니다.',
      '서비스 운영 규모와 환경에 따라 이용하는 인프라는 변경될 수 있으며, 변경 시 본 방침 또는 서비스 공지를 통해 합리적인 범위에서 안내합니다.',
      '외부 서비스 장애, API 정책 변경, 플랫폼 계정 제한, 네트워크 문제 등 AruBot이 직접 통제할 수 없는 사유로 기능이 제한되거나 데이터 처리가 지연될 수 있습니다.',
    ],
  },
  {
    title: '7. 쿠키와 로컬 저장소',
    body: [
      'AruBot은 로그인 유지, 세션 구분, 테마 설정, 보안 확인, 사용자 편의 제공을 위해 쿠키, localStorage, sessionStorage 등을 사용할 수 있습니다.',
      '브라우저 설정에서 쿠키 또는 저장소 사용을 제한할 수 있으나, 이 경우 로그인, 계정 연결, 관리자 기능, 오버레이 기능이 정상 동작하지 않을 수 있습니다.',
    ],
  },
  {
    title: '8. 정보주체의 권리',
    body: [
      '사용자는 자신의 개인정보에 대해 열람, 정정, 삭제, 처리정지, 동의 철회 또는 계정/플랫폼 연결 해제를 요청할 수 있습니다.',
      '서비스 화면에서 제공되는 연결 해제, 토큰 재발급, 데이터 삭제 기능을 우선 사용할 수 있습니다.',
      '직접 처리가 어렵거나 별도 확인이 필요한 경우, 운영자에게 요청할 수 있으며 본인 확인 및 보안 확인이 필요할 수 있습니다.',
      '다른 이용자, 스트리머, 플랫폼, 법령상 보관 의무, 보안 조사와 관련된 정보는 즉시 삭제가 제한될 수 있습니다.',
    ],
  },
  {
    title: '9. 안전성 확보 조치',
    body: [
      'AruBot은 접근 권한 제한, 토큰 보호, HTTPS 사용, 보안 로그 확인, 중요 정보 최소화, 오류 수정 등 합리적으로 가능한 보호 조치를 적용합니다.',
      '다만 모든 보안 위협, 외부 서비스 장애, 사용자의 설정 실수, 공개 URL 공유, 로컬 PC 환경 문제를 완전히 방지하거나 보증하지는 않습니다.',
      '사용자는 오버레이 URL, API 키, 로컬 프로그램 토큰, OAuth 연결 권한을 타인에게 공유하지 않아야 하며, 유출이 의심되면 즉시 재발급 또는 연결 해제를 해야 합니다.',
    ],
  },
  {
    title: '10. 책임의 범위',
    body: [
      'AruBot은 관련 법령상 허용되는 범위 내에서 기능의 지속성, 외부 플랫폼 연동 성공, 데이터의 무손실 보관, 특정 목적 적합성, 방송 수익 또는 운영 결과를 보증하지 않습니다.',
      'AruBot은 사용자의 방송 설정, 공개 링크 공유, API 키 또는 토큰 유출, 외부 플랫폼 정책 변경, 제3자 서비스 장애, 네트워크 장애, 사용자의 계정 관리 부주의, 로컬 프로그램 실행 환경으로 발생한 문제에 책임지지 않습니다.',
      'AruBot은 사용자가 공개 페이지, 오버레이, 채팅, 방송 화면, 외부 링크를 통해 스스로 공개한 정보가 제3자에게 열람, 저장, 공유되는 것에 책임지지 않습니다.',
      'AruBot은 외부 플랫폼이 제공하는 API, OAuth, 채팅, 후원, 라이브 상태, 영상 또는 프로필 정보의 정확성, 완전성, 계속 제공 여부에 책임지지 않습니다.',
      '본 조항은 개인정보 보호 관련 법령상 인정되는 정보주체의 권리나 AruBot 운영자의 법정 책임을 배제하지 않습니다.',
    ],
  },
  {
    title: '11. 방침 변경',
    body: [
      '본 방침은 서비스 기능, 법령, 외부 플랫폼 정책, 운영 환경 변경에 따라 수시로 개정될 수 있습니다.',
      '중요한 변경이 있는 경우 서비스 화면, 공지, 배포 노트 또는 본 페이지의 시행일 변경을 통해 안내할 수 있습니다.',
    ],
  },
  {
    title: '12. 문의',
    body: [
      '개인정보 열람, 삭제, 연결 해제, 보안 문제, 기타 문의는 AruBot 운영자가 제공하는 공식 문의 채널, 저장소 이슈, 또는 서비스 내 문의 수단을 통해 요청할 수 있습니다.',
      '문의 시 본인 확인, 플랫폼 계정 확인, 관련 채널 ID 또는 오류 상황 설명이 필요할 수 있습니다.',
    ],
  },
] as const;

export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-[var(--page-gutter)] py-[clamp(1rem,2.6vw,1.75rem)]">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <Link href="/" className="group inline-flex items-center gap-3 rounded-full bg-card/70 px-3 py-2 shadow-subtle backdrop-blur-xl transition hover:-translate-y-0.5">
          <Image src="/files/logo.png" alt="AruBot" width={36} height={36} className="aspect-square w-[clamp(2rem,4vw,2.5rem)] object-contain" priority />
          <span className="text-sm font-semibold">AruBot</span>
        </Link>
        <div className="flex items-center gap-2">
          <LinkButton href="/" variant="ghost" className="hidden sm:inline-flex">
            <ArrowLeft className="h-4 w-4" />
            홈
          </LinkButton>
          <ThemeToggle />
        </div>
      </header>

      <section className="mx-auto mt-[clamp(2rem,6vw,4rem)] max-w-5xl rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-mint)/0.28)_54%,hsl(var(--accent-sky)/0.22))] p-[clamp(1.25rem,3.5vw,2.5rem)] shadow-soft">
        <Badge tone="mint">
          <ShieldCheck className="mr-1 h-3.5 w-3.5" />
          개인정보처리방침
        </Badge>
        <h1 className="mt-5 break-keep text-[clamp(2.1rem,5vw,4.2rem)] font-semibold leading-tight">
          AruBot 개인정보처리방침
        </h1>
        <p className="mt-4 max-w-3xl break-keep text-sm leading-7 text-muted-foreground md:text-base">
          이 문서는 AruBot이 방송 참여 관리, 계정 연결, 채팅봇, 포인트, 룰렛, 예측, 영상 후원, 로컬 프로그램 연동 기능을 제공하면서 처리할 수 있는 개인정보와 이용자의 권리를 안내합니다.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Badge tone="sky">시행일: {effectiveDate}</Badge>
          <Badge tone="neutral">개인정보보호위원회 작성지침 참고</Badge>
        </div>
      </section>

      <section className="mx-auto mt-5 grid max-w-5xl gap-4">
        <div className="rounded-[var(--radius-card)] border bg-card/85 p-[clamp(1rem,2vw,1.35rem)] text-sm leading-7 text-muted-foreground shadow-subtle">
          본 방침은 개인정보보호위원회의 개인정보 처리방침 작성지침을 참고해 작성했습니다. 다만 AruBot의 실제 운영 방식, 배포 환경, 외부 플랫폼 정책, 데이터베이스 설정에 따라 세부 내용은 달라질 수 있으며, 본 문서는 법률 자문을 대체하지 않습니다.
          <Link
            href="https://www.privacy.go.kr/front/bbs/bbsView.do?bbsNo=BBSMSTR_000000000049&bbscttNo=20885"
            target="_blank"
            rel="noreferrer"
            className="ml-1 inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            참고 지침
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>

        {sections.map((section) => (
          <article key={section.title} className="rounded-[var(--radius-card)] border bg-card/88 p-[clamp(1.1rem,2.2vw,1.5rem)] shadow-subtle">
            <h2 className="text-lg font-semibold">{section.title}</h2>
            <ul className="mt-4 grid gap-2 text-sm leading-7 text-muted-foreground">
              {section.body.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-[0.65rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/65" />
                  <span className="break-keep">{item}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}
