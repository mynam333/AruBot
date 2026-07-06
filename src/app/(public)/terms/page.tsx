/* eslint-disable react-refresh/only-export-components */
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export const metadata: Metadata = {
  title: '이용약관 | AruBot',
  description: 'AruBot 서비스 이용 조건, 이용자의 의무, 서비스 제한, 책임 범위 및 외부 플랫폼 연동에 관한 약관입니다.',
};

const effectiveDate = '2026년 7월 6일';
const providerName = 'AruBot 운영자';
const contactEmail = 'mynam33333@gmail.com';

const summaryItems = [
  { label: '서비스', value: 'AruBot' },
  { label: '제공자', value: providerName },
  { label: '문의', value: contactEmail },
  { label: '적용', value: '웹·오버레이·로컬 프로그램' },
] as const;

const contents = [
  '목적 및 적용 범위',
  '정의',
  '약관의 게시와 변경',
  '이용계약과 계정 연결',
  '서비스 내용 및 변경',
  '외부 플랫폼과 제3자 서비스',
  '로컬 프로그램 및 자동화',
  '이용자의 의무와 금지행위',
  '콘텐츠와 이용허락',
  '포인트, 이벤트 및 공개 페이지',
  '서비스 제한, 정지 및 해지',
  '지식재산권',
  '개인정보 보호',
  '보증 부인 및 책임 제한',
  '손해배상 및 면책',
  '통지, 준거법 및 분쟁 해결',
] as const;

const sections = [
  {
    title: '제1조 목적 및 적용 범위',
    body: [
      `이 약관은 ${providerName}(이하 "운영자")가 제공하는 AruBot 웹 서비스, 백엔드 API, 공개 페이지, OBS 오버레이, 브라우저 확장 프로그램, 로컬 프로그램 및 이에 부수되는 기능(이하 "서비스")의 이용 조건과 운영자와 이용자 사이의 권리·의무 및 책임 범위를 정합니다.`,
      '이용자는 회원가입, 로그인, 외부 플랫폼 계정 연결, 관리자 기능 사용, 오버레이 URL 생성·사용, 로컬 프로그램 설치, API 호출 등 서비스를 적극적으로 이용하는 방법으로 이 약관에 동의합니다. 단순한 공개 페이지 열람에는 해당 열람 행위에 필요한 범위에서 이 약관이 적용됩니다.',
      '서비스에 별도 약관, 안내, 정책, 화면상 고지 또는 외부 플랫폼 정책이 적용되는 경우 해당 내용은 이 약관의 일부를 구성합니다. 서로 충돌하는 경우 외부 플랫폼의 필수 정책, 개별 서비스 안내, 이 약관 순으로 적용됩니다.',
      '서비스의 구체적인 제공 범위, 이용 방법 및 제한 사항은 서비스 화면과 운영자가 게시한 안내에 따릅니다.',
    ],
  },
  {
    title: '제2조 정의',
    body: [
      '"이용자"란 방송인, 시청자, 관리자, 로컬 프로그램 사용자 등 서비스를 접속하거나 사용하는 모든 사람을 말합니다.',
      '"방송인"이란 CHZZK, CIME, YouTube 등 외부 플랫폼 계정을 연결하여 방송 관리 기능을 사용하는 이용자를 말합니다.',
      '"시청자"란 방송인의 공개 페이지, 포인트, 룰렛, 예측, 그림 후원, 영상 후원 등 참여 기능을 이용하는 이용자를 말합니다.',
      '"외부 플랫폼"이란 CHZZK/Naver, CIME, Google/YouTube 및 이용자가 서비스와 함께 사용하는 방송·후원·자동화·재생·호스팅·배포 서비스를 말합니다.',
      '"사용자 콘텐츠"란 이용자가 서비스에 입력, 업로드, 전송, 저장, 표시 또는 연동한 명령어, 문구, 채팅, 이미지, 그림 데이터, URL, endpoint, 설정값, 파일 메타데이터, 자동화 규칙 및 기타 자료를 말합니다.',
      '"토큰"이란 OAuth 토큰, 세션 쿠키, API 키, 오버레이 URL, 공개 뷰어 토큰, 로컬 프로그램 pairing token 등 서비스 접근 또는 연동에 사용되는 모든 인증·식별 정보를 말합니다.',
    ],
  },
  {
    title: '제3조 약관의 게시와 변경',
    body: [
      '운영자는 이용자가 쉽게 확인할 수 있도록 이 약관을 서비스 화면 또는 연결된 페이지에 게시합니다.',
      '운영자는 법령, 외부 플랫폼 정책, 서비스 구조, 보안상 필요, 기능 변경, 운영상 필요에 따라 이 약관을 개정할 수 있습니다.',
      '운영자는 약관을 변경하는 경우 적용일자와 주요 변경 내용을 서비스 화면, 공지, 배포 노트 또는 이 페이지를 통해 원칙적으로 적용일 7일 전부터 알립니다. 이용자에게 불리하거나 중대한 변경은 특별한 사정이 없는 한 적용일 30일 전부터 알립니다.',
      '이용자가 변경 약관의 적용일 이후에도 서비스를 계속 이용하면 변경 약관에 동의한 것으로 봅니다. 변경 약관에 동의하지 않는 이용자는 서비스 이용을 중단하고 계정 연결 해제 또는 탈퇴를 요청할 수 있습니다.',
    ],
  },
  {
    title: '제4조 이용계약과 계정 연결',
    body: [
      '서비스 이용계약은 이용자가 이 약관에 동의하고 서비스를 이용하거나 외부 플랫폼 계정을 연결하며, 운영자가 이를 승낙함으로써 성립합니다.',
      '운영자는 서비스 안정성, 보안, 외부 플랫폼 정책, 기술적 제한, 부정 이용 이력, 미성년자 보호, 법령 준수 필요가 있는 경우 이용 신청을 거절하거나 이용 범위를 제한할 수 있습니다.',
      '이용자는 본인이 정당하게 사용할 권한이 있는 계정, 채널, 토큰, 파일, URL, endpoint 및 외부 서비스를 연결해야 합니다.',
      '만 14세 미만 아동이 계정 연결, 포인트, 예측, 그림 후원, 참여 기록 저장 등 개인정보가 지속적으로 저장되는 기능을 이용하려는 경우 법정대리인의 동의가 필요합니다. 운영자는 동의 확인이 어렵거나 보호 필요가 있다고 판단되는 경우 해당 저장형 기능 이용을 제한할 수 있습니다.',
    ],
  },
  {
    title: '제5조 서비스 내용 및 변경',
    body: [
      '서비스는 방송 채팅 명령어, 포인트, 출석, 룰렛, 예측, 영상 후원, 그림 후원, 후원 반응, 공개 페이지, OBS 오버레이, 로컬 프로그램 연동, 자동화 실행, 이벤트 로그 및 관련 관리 기능을 제공합니다.',
      '운영자는 기능 개선, 보안, 비용, 외부 플랫폼 정책, API 제한, 기술적 문제, 법령 준수, 운영상 필요에 따라 서비스의 전부 또는 일부를 변경, 추가, 중단, 제한하거나 제공 방식을 바꿀 수 있습니다.',
      '서비스는 무상 또는 시험적 성격으로 제공되는 기능을 포함할 수 있으며, 운영자는 특정 기능의 계속성, 정확성, 호환성, 무중단성, 데이터 무손실, 외부 플랫폼 연동 성공, 방송 수익 또는 특정 결과를 보증하지 않습니다.',
      '운영자는 안정적인 운영을 위해 점검, 업데이트, 마이그레이션, 보안 조치, 장애 대응을 실시할 수 있으며, 긴급한 경우 사전 고지 없이 서비스를 제한하거나 중단할 수 있습니다.',
    ],
  },
  {
    title: '제6조 외부 플랫폼과 제3자 서비스',
    body: [
      '서비스는 CHZZK/Naver, CIME, Google/YouTube 등 외부 플랫폼의 API, OAuth, 채팅, 라이브 상태, 영상 메타데이터, 후원·구독 이벤트 및 기타 기능에 의존할 수 있습니다.',
      '이용자는 외부 플랫폼을 사용할 때 해당 플랫폼의 약관, 정책, 커뮤니티 가이드, API 정책, 권한 범위 및 운영 기준을 준수해야 합니다.',
      '외부 플랫폼의 장애, 지연, API 변경, 정책 변경, 권한 회수, 계정 제한, 심사 지연, 데이터 오류, 네트워크 문제로 서비스 기능이 제한되거나 중단될 수 있으며, 운영자는 법령상 책임이 인정되는 경우를 제외하고 이에 대해 책임을 지지 않습니다.',
      'YouTube 연동 기능을 이용하는 경우 이용자는 YouTube 서비스 약관 및 YouTube API Services Terms of Service, Developer Policies 등 Google/YouTube의 적용 정책을 준수해야 합니다.',
      '로컬 프로그램 설치 파일은 GitHub Releases, 브라우저 확장 프로그램은 Chrome Web Store 또는 Firefox Add-ons 등 배포 채널을 통해 제공될 수 있습니다. 해당 배포 채널 자체의 이용, 계정, 다운로드, 심사, 차단, 업데이트 문제는 각 채널의 정책에 따릅니다.',
    ],
  },
  {
    title: '제7조 로컬 프로그램 및 자동화',
    body: [
      '로컬 프로그램은 이용자의 방송 PC 또는 이용자가 관리하는 환경에서 외부 도구, 사운드, TTS, T.I.T.S., OBS, 브라우저, 파일 경로, 네트워크 endpoint 등과 연동할 수 있습니다.',
      '이용자는 로컬 프로그램과 자동화 설정을 자신의 책임으로 구성해야 하며, 실행 전 대상 endpoint, 파일, 명령, 권한, 볼륨, 방송 화면 노출 여부, 저작권 및 외부 도구 정책을 확인해야 합니다.',
      '운영자는 이용자가 설정한 자동화 규칙, 외부 endpoint, 로컬 파일, 방송 PC 환경, 외부 프로그램 오작동, 공개 토큰 유출, 사용자의 설정 실수로 발생한 손해에 대해 법령상 책임이 인정되는 경우를 제외하고 책임을 지지 않습니다.',
      '운영자는 보안상 위험이 있거나 서비스 안정성을 해칠 수 있는 자동화, endpoint, 요청, 파일 또는 연결을 차단하거나 제한할 수 있습니다.',
    ],
  },
  {
    title: '제8조 이용자의 의무와 금지행위',
    body: [
      '이용자는 관계 법령, 이 약관, 외부 플랫폼 정책, 서비스 화면의 안내 및 운영자의 합리적인 요청을 준수해야 합니다.',
      '이용자는 토큰, API 키, 오버레이 URL, 로컬 프로그램 연결 정보, OAuth 권한, 관리자 계정을 안전하게 관리해야 하며, 유출이 의심되는 경우 즉시 재발급, 연결 해제 또는 비밀번호 변경을 해야 합니다.',
      '이용자는 타인의 개인정보, 민감정보, 고유식별정보, 계정 정보, 저작권 침해 자료, 불법·유해 정보, 악성 코드, 스팸, 사기성 링크, 외부 플랫폼 정책을 위반하는 콘텐츠를 서비스에 입력하거나 전송해서는 안 됩니다.',
      '이용자는 서비스의 보안 또는 안정성을 해치는 행위, 비정상적인 대량 요청, 우회 접속, 역설계, 무단 크롤링, 취약점 악용, 권한 없는 계정·채널 연결, 타인 사칭, 토큰 공유, 운영 방해, 부정 포인트 적립, 이벤트 조작을 해서는 안 됩니다.',
      '이용자는 서비스가 제공하는 포인트, 룰렛, 예측, 이벤트 기능을 현금, 현물, 재산상 이익, 도박, 사행행위, 불법 경품 또는 외부 플랫폼 정책 위반 목적으로 사용해서는 안 됩니다.',
    ],
  },
  {
    title: '제9조 사용자 콘텐츠와 이용허락',
    body: [
      '이용자는 자신이 서비스에 입력하거나 연동하는 사용자 콘텐츠에 대해 필요한 권리와 권한을 보유해야 하며, 해당 콘텐츠로 인해 발생하는 분쟁과 책임은 이용자에게 있습니다.',
      '운영자는 사용자 콘텐츠의 소유권을 취득하지 않습니다.',
      '이용자는 서비스 제공, 저장, 백업, 전송, 변환, 표시, 공개 페이지·오버레이 출력, 외부 플랫폼 API 전송, 오류 수정, 보안 대응, 기능 개선 및 분쟁 대응에 필요한 범위에서 운영자에게 사용자 콘텐츠를 이용, 복제, 저장, 전송, 표시, 변환, 가공할 수 있는 비독점적이고 무상인 이용권을 부여합니다.',
      '이용자가 공개 페이지, 오버레이, 채팅, 방송 화면, 공유 URL 또는 외부 플랫폼을 통해 공개한 사용자 콘텐츠는 제3자가 열람, 저장, 캡처, 공유할 수 있습니다. 공개 범위와 링크 관리는 이용자의 책임입니다.',
      '운영자는 법령 위반, 권리 침해, 외부 플랫폼 정책 위반, 보안 위험, 운영 방해 또는 신고가 있는 사용자 콘텐츠를 사전 통지 없이 숨김, 삭제, 접근 제한, 전송 중단 또는 계정 제한 처리할 수 있습니다.',
    ],
  },
  {
    title: '제10조 포인트, 이벤트 및 공개 페이지',
    body: [
      '서비스의 포인트, 출석, 룰렛, 예측, 후원 반응, 그림 후원, 영상 후원 기록은 방송 참여와 운영 편의를 위한 가상 기록이며 현금, 재산권, 선불전자지급수단, 상품권, 환급 가능한 포인트가 아닙니다.',
      '운영자는 서비스 오류, 부정 이용, 외부 플랫폼 오류, 방송인의 설정, 채널 운영 정책, 보안상 필요가 있는 경우 포인트, 이벤트 기록, 룰렛 결과, 예측 정산, 후원 기록을 정정, 취소, 제한 또는 초기화할 수 있습니다.',
      '방송인은 자신의 공개 페이지와 이벤트 설정이 법령, 외부 플랫폼 정책, 저작권, 표시·광고 규정, 경품·사행행위 관련 규정에 맞는지 스스로 확인해야 합니다.',
      '공개 명령어 목록, 포인트 목록, 룰렛 로그, 예측 현황, 오버레이, 채팅 응답, 영상 정보, 그림 후원 결과 등은 링크 접근자와 방송 시청자에게 노출될 수 있습니다.',
    ],
  },
  {
    title: '제11조 서비스 제한, 정지 및 해지',
    body: [
      '이용자는 서비스 화면에서 제공되는 연결 해제, 로그아웃, 토큰 재발급, 삭제 기능을 이용하거나 운영자에게 요청하여 서비스 이용을 중단할 수 있습니다.',
      '운영자는 이용자가 이 약관 또는 외부 플랫폼 정책을 위반하거나, 법령 위반·권리 침해·보안 위험·부정 이용·서비스 장애 유발·민원 발생 가능성이 있다고 합리적으로 판단하는 경우 서비스 이용을 제한, 정지, 해지하거나 데이터 접근을 제한할 수 있습니다.',
      '운영자는 장기간 미사용, 서비스 종료, 인프라 변경, 기능 폐지, 외부 플랫폼 연동 종료, 보안상 필요, 법령 준수 필요가 있는 경우 계정, 토큰, 로그, 사용자 콘텐츠 또는 일부 데이터를 삭제하거나 비활성화할 수 있습니다.',
      '해지 또는 이용 제한 이후에도 법령 준수, 분쟁 대응, 부정 이용 방지, 보안 사고 조사, 백업 복구 안정성을 위해 필요한 정보는 개인정보처리방침에서 정한 범위 내에서 보관될 수 있습니다.',
    ],
  },
  {
    title: '제12조 지식재산권',
    body: [
      '서비스, 소프트웨어, 화면, 로고, 디자인, 문구, 데이터베이스 구조, API, 문서, 코드 및 운영자가 생성한 자료에 관한 지식재산권은 운영자 또는 정당한 권리자에게 귀속됩니다.',
      '이용자는 서비스 이용에 필요한 범위에서만 서비스를 사용할 수 있으며, 운영자의 사전 서면 동의 없이 서비스 또는 그 일부를 복제, 수정, 배포, 판매, 대여, 역설계, 소스 추출, 경쟁 서비스 개발 목적으로 사용할 수 없습니다.',
      '외부 플랫폼, 오픈소스, 아이콘, 라이브러리, 브라우저 스토어, GitHub Releases 등 제3자 자료와 도구에는 각 권리자의 약관과 라이선스가 적용됩니다.',
    ],
  },
  {
    title: '제13조 개인정보 보호',
    body: [
      '운영자는 서비스 제공에 필요한 개인정보를 개인정보처리방침에 따라 처리합니다.',
      '이용자는 서비스 이용 중 타인의 개인정보 또는 민감정보를 불필요하게 입력, 업로드, 공개 또는 자동화 전송하지 않아야 합니다.',
      '개인정보 처리에 관한 자세한 내용은 AruBot 개인정보처리방침에서 확인할 수 있습니다.',
    ],
    link: { href: '/privacy', label: '개인정보처리방침 보기' },
  },
  {
    title: '제14조 보증 부인 및 책임 제한',
    body: [
      '서비스는 현재 상태와 제공 가능한 상태로 제공됩니다. 운영자는 법령상 허용되는 범위에서 서비스의 무중단성, 오류 없음, 특정 목적 적합성, 외부 플랫폼 연동 성공, 데이터의 무손실 보관, 방송 수익, 시청자 증가, 이벤트 결과, 자동화 실행 결과를 보증하지 않습니다.',
      '운영자는 외부 플랫폼의 데이터, API 응답, 프로필, 영상, 채팅, 후원·구독 이벤트, 라이브 상태, 이용자 계정 상태의 정확성·완전성·계속 제공 여부를 보증하지 않습니다.',
      '운영자는 법령상 허용되는 범위에서 간접손해, 특별손해, 결과손해, 영업손실, 수익상실, 데이터 손실, 평판 손상, 방송 사고, 외부 플랫폼 제재, 사용자의 설정 실수 또는 토큰 관리 부주의로 인한 손해에 대해 책임을 지지 않습니다.',
      '운영자의 고의 또는 중대한 과실, 소비자 보호 관련 강행법규상 배제할 수 없는 책임은 이 약관의 책임 제한에도 불구하고 관련 법령에 따릅니다.',
    ],
  },
  {
    title: '제15조 손해배상 및 면책',
    body: [
      '이용자가 이 약관, 법령 또는 외부 플랫폼 정책을 위반하여 운영자 또는 제3자에게 손해를 발생시킨 경우, 이용자는 법령상 허용되는 범위에서 그 손해를 배상해야 합니다.',
      '운영자는 천재지변, 전쟁, 테러, 화재, 정전, 통신 장애, 클라우드 장애, 외부 플랫폼 장애, API 정책 변경, 심사 지연, 보안 사고, 수사·행정기관 조치, 이용자 귀책사유 등 운영자의 합리적 통제를 벗어난 사유로 서비스를 제공할 수 없는 경우 책임을 지지 않습니다.',
      '이 약관의 어떤 조항도 이용자에게 법령상 보장되는 권리를 부당하게 배제하거나 운영자의 고의 또는 중대한 과실 책임을 면제하는 것으로 해석되지 않습니다.',
    ],
  },
  {
    title: '제16조 통지, 준거법 및 분쟁 해결',
    body: [
      '운영자는 서비스 화면, 공지, 배포 노트, 이메일 또는 이용자가 제공한 연락처를 통해 이용자에게 통지할 수 있습니다.',
      `서비스 관련 문의, 권리 침해 신고, 약관 관련 요청은 ${contactEmail}로 접수할 수 있습니다.`,
      '이 약관은 대한민국 법령에 따라 해석됩니다.',
      '운영자와 이용자 사이에 분쟁이 발생한 경우 양 당사자는 성실히 협의하여 해결하도록 노력합니다. 협의로 해결되지 않는 분쟁은 민사소송법 등 관련 법령에 따른 관할 법원에 제기합니다.',
    ],
  },
] as const;

export default function TermsPage() {
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

      <section className="mx-auto mt-[clamp(2rem,6vw,4rem)] max-w-5xl rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-lemon)/0.24)_48%,hsl(var(--accent-coral)/0.22))] p-[clamp(1.25rem,3.5vw,2.5rem)] shadow-soft">
        <Badge tone="lemon">
          <FileText className="mr-1 h-3.5 w-3.5" />
          서비스 이용약관
        </Badge>
        <h1 className="mt-5 break-keep text-[clamp(2.1rem,5vw,4.2rem)] font-semibold leading-tight">
          AruBot 이용약관
        </h1>
        <p className="mt-4 max-w-3xl break-keep text-sm leading-7 text-muted-foreground md:text-base">
          이 약관은 AruBot의 방송 참여 관리, 외부 플랫폼 연동, 공개 페이지, 오버레이, 로컬 프로그램 및 자동화 기능을 이용할 때 적용되는 기본 조건을 정합니다.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Badge tone="sky">시행일: {effectiveDate}</Badge>
          <Badge tone="neutral">서비스 기본 조건</Badge>
        </div>
      </section>

      <section className="mx-auto mt-5 grid max-w-5xl gap-4">
        <div className="grid gap-3 rounded-[var(--radius-card)] border bg-card/85 p-[clamp(1rem,2vw,1.35rem)] shadow-subtle md:grid-cols-4">
          {summaryItems.map((item) => (
            <div key={item.label} className="min-w-0">
              <div className="text-xs font-semibold text-muted-foreground">{item.label}</div>
              <div className="mt-1 break-words text-sm font-semibold">{item.value}</div>
            </div>
          ))}
        </div>

        <div className="rounded-[var(--radius-card)] border bg-card/85 p-[clamp(1rem,2vw,1.35rem)] text-sm leading-7 text-muted-foreground shadow-subtle">
          본 약관은 현행 약관규제법의 기본 원칙과 외부 플랫폼 API 정책을 고려하여 작성했습니다. AruBot 이용자는 서비스 기능과 외부 플랫폼 연동 조건을 확인하고 이 약관에 따라 서비스를 이용해야 합니다.
          <Link
            href="https://www.law.go.kr/lsSc.do?query=%EC%95%BD%EA%B4%80%EC%9D%98%20%EA%B7%9C%EC%A0%9C%EC%97%90%20%EA%B4%80%ED%95%9C%20%EB%B2%95%EB%A5%A0"
            target="_blank"
            rel="noreferrer"
            className="ml-1 inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            약관법
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>

        <nav className="rounded-[var(--radius-card)] border bg-card/85 p-[clamp(1rem,2vw,1.35rem)] shadow-subtle">
          <h2 className="text-lg font-semibold">목차</h2>
          <ol className="mt-4 grid gap-2 text-sm leading-7 text-muted-foreground md:grid-cols-2">
            {contents.map((item, index) => (
              <li key={item} className="break-keep">
                {index + 1}. {item}
              </li>
            ))}
          </ol>
        </nav>

        {sections.map((section) => (
          <article key={section.title} className="rounded-[var(--radius-card)] border bg-card/88 p-[clamp(1.1rem,2.2vw,1.5rem)] shadow-subtle">
            <h2 className="break-keep text-lg font-semibold">{section.title}</h2>
            <ul className="mt-4 grid gap-2 text-sm leading-7 text-muted-foreground">
              {section.body.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-[0.65rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/65" />
                  <span className="break-keep">{item}</span>
                </li>
              ))}
            </ul>
            {'link' in section ? (
              <LinkButton href={section.link.href} variant="outline" className="mt-5">
                {section.link.label}
                <ExternalLink className="h-4 w-4" />
              </LinkButton>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  );
}
