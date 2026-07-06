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

const effectiveDate = '2026년 7월 6일';
const controllerName = 'AruBot 운영자';
const privacyContact = 'mynam33333@gmail.com';

const summaryItems = [
  { label: '처리자', value: controllerName },
  { label: '문의', value: privacyContact },
  { label: '적용 서비스', value: 'AruBot 웹·오버레이·로컬 프로그램' },
  { label: '시행일', value: effectiveDate },
] as const;

const contents = [
  '개인정보의 처리 목적, 항목 및 보유기간',
  '개인정보 처리의 법적 근거',
  '만 14세 미만 아동의 개인정보 처리',
  '개인정보의 파기',
  '제3자 제공 및 외부 플랫폼 연동',
  '개인정보 처리업무의 위탁',
  '개인정보의 국외 이전',
  '쿠키 및 자동 수집 장치',
  '정보주체와 법정대리인의 권리',
  '자동화된 처리와 공개 페이지',
  '안전성 확보조치',
  '개인정보 보호담당자 및 권익침해 구제',
  '처리방침의 변경',
] as const;

const processingRows = [
  {
    service: '계정 연결 및 로그인',
    purpose: '방송인 및 시청자 계정 연결, 본인 식별, 플랫폼 권한 확인, 세션 유지, 부정 이용 방지',
    items:
      '내부 사용자 ID, 세션 ID, CHZZK/Naver, CIME, Google/YouTube의 사용자 ID, 채널 ID, 채널명, 핸들, 닉네임, 프로필 이미지, OAuth 권한 범위, access token, refresh token, 만료 시각, 연결 상태, 마지막 로그인 시각',
    basis: '개인정보 보호법 제15조 제1항 제1호(동의), 제4호(서비스 이용계약 이행), 제6호(보안·부정이용 방지를 위한 정당한 이익)',
    retention: '회원 탈퇴, 플랫폼 연결 해제 또는 목적 달성 시까지. 단, 보안·분쟁·부정이용 대응에 필요한 기록은 필요한 기간 동안 보관',
  },
  {
    service: '방송 관리 기능',
    purpose: '채팅 명령어, 매크로, 포인트, 출석, 룰렛, 예측, 영상 후원, 후원 규칙, 공개 페이지 및 OBS 오버레이 제공',
    items:
      '채널 식별자, 관리자 설정, 명령어와 응답 문구, 포인트 잔액 및 변동 이력, 출석 기록, 룰렛 정의와 실행 결과, 예측 항목·배팅·정산 기록, 영상 ID·제목·재생 위치·신청자 ID와 닉네임, 오버레이 및 공개 뷰어 토큰',
    basis: '개인정보 보호법 제15조 제1항 제1호(동의), 제4호(서비스 이용계약 이행), 제6호(서비스 안정성·분쟁 대응을 위한 정당한 이익)',
    retention: '회원 탈퇴 또는 목적 달성 시까지. 단, 방송 운영 이력, 정산·환불·분쟁, 부정이용 대응에 필요한 기록은 필요한 기간 동안 보관',
  },
  {
    service: '그림 후원 및 시청자 참여',
    purpose: '시청자 그림 후원 신청, 승인, 재생, 포인트 차감·환불, 방송 화면 표시, 신고·분쟁 대응',
    items:
      '시청자 플랫폼 ID, 닉네임, 채널 식별자, 그림 획 데이터, 미리보기 이미지, 저장 객체 키, 캔버스 설정, 처리 상태, 포인트 차감 정보, 생성·승인·거절·삭제 시각',
    basis: '개인정보 보호법 제15조 제1항 제1호(동의), 제4호(서비스 이용계약 이행), 제6호(부정이용·분쟁 대응을 위한 정당한 이익)',
    retention: '회원 탈퇴, 삭제 요청 또는 목적 달성 시까지. 단, 분쟁·부정이용 대응에 필요한 기록은 필요한 기간 동안 보관',
  },
  {
    service: '방송 자동화 및 로컬 프로그램',
    purpose: 'TTS, 사운드, T.I.T.S., OBS 등 사용자가 설정한 방송 PC 자동화와 로컬 프로그램 연결',
    items:
      '자동화 설정, 연결 이름과 유형, endpoint, 사용자가 입력한 구성값, 로컬 에이전트 ID, pairing token 또는 token hash, 연결 상태, capabilities, 실행 작업과 결과, 오류 메시지',
    basis: '개인정보 보호법 제15조 제1항 제1호(동의), 제4호(서비스 이용계약 이행), 제6호(보안·장애 대응을 위한 정당한 이익)',
    retention: '회원 탈퇴, 연결 해제 또는 목적 달성 시까지. 단, 로그·분쟁·부정이용 대응에 필요한 기록은 필요한 기간 동안 보관',
  },
  {
    service: '서비스 운영 및 보안',
    purpose: '서비스 제공, 장애 분석, 성능 개선, 보안 사고 예방, 비정상 이용 탐지, 문의 대응',
    items:
      'IP 주소, User-Agent, 요청 URL과 시각, 쿠키 및 세션 정보, API 호출 기록, 오류 로그, 접속 기록, 보안 진단 정보, 문의 내용과 회신 기록',
    basis: '개인정보 보호법 제15조 제1항 제4호(서비스 이용계약 이행), 제6호(서비스 안정성·보안·부정이용 방지를 위한 정당한 이익), 관련 법령상 의무',
    retention: '목적 달성 시까지. 단, 로그·분쟁·부정이용 대응 및 법령상 의무 이행에 필요한 기록은 필요한 기간 동안 보관',
  },
] as const;

const thirdPartyRows = [
  {
    recipient: 'CHZZK/Naver',
    purpose: 'OAuth 인증, 채널 정보 확인, 라이브 상태 조회, 채팅 이벤트 수신 및 메시지 전송',
    items: '사용자가 연결한 계정·채널 식별자, OAuth 토큰을 이용한 API 요청, 채팅 메시지 및 방송 이벤트 처리에 필요한 정보',
    basis: '사용자의 플랫폼 연결 및 기능 요청, 서비스 이용계약 이행, 필요한 경우 정보주체 동의',
    retention: '수신자의 정책 및 사용자가 연결을 유지하는 기간',
  },
  {
    recipient: 'CIME',
    purpose: 'OAuth 인증, 채널 정보 확인, 라이브 채팅, 후원·구독 이벤트 연동',
    items: '사용자가 연결한 계정·채널 식별자, OAuth 토큰을 이용한 API 요청, 채팅·후원·구독 이벤트 처리에 필요한 정보',
    basis: '사용자의 플랫폼 연결 및 기능 요청, 서비스 이용계약 이행, 필요한 경우 정보주체 동의',
    retention: '수신자의 정책 및 사용자가 연결을 유지하는 기간',
  },
  {
    recipient: 'Google/YouTube',
    purpose: 'YouTube OAuth 인증, 채널 정보 확인, Live Chat 수신·전송, 영상 후원 메타데이터 조회',
    items: 'Google/YouTube 계정·채널 식별자, OAuth 토큰을 이용한 API 요청, Live Chat 메시지, 영상 ID 및 영상 메타데이터',
    basis: '사용자의 플랫폼 연결 및 기능 요청, 서비스 이용계약 이행, 필요한 경우 정보주체 동의',
    retention: '수신자의 정책 및 사용자가 연결을 유지하는 기간',
  },
] as const;

const processorRows = [
  {
    processor: 'Vercel',
    work: '프론트엔드 호스팅, 정적 파일 제공, 배포, 접속·장애 로그 처리',
    items: '프론트엔드 접속 과정에서 생성되는 IP 주소, User-Agent, 요청 시각, 오류·성능 로그 등 기술 정보',
  },
  {
    processor: 'Oracle Cloud Infrastructure',
    work: '백엔드 서버, PostgreSQL 데이터베이스, 파일 저장소, 로그 및 백업 운영',
    items: 'AruBot 서비스 제공을 위해 백엔드와 DB에 저장되는 개인정보 및 서비스 이용 기록. 운영 리전은 대한민국 춘천 리전',
  },
] as const;

const transferRows = [
  {
    recipient: 'Vercel Inc.',
    country: '미국 및 Vercel이 운영하는 글로벌 인프라 소재 국가',
    timing: '프론트엔드 접속, 배포, 장애·성능 로그 처리 시 네트워크를 통해 전송',
    items: 'IP 주소, User-Agent, 접속 로그, 오류·성능 로그 등 프론트엔드 운영에 필요한 기술 정보',
    purpose: '프론트엔드 호스팅, 보안, 장애 대응, 서비스 제공',
    contact: 'https://vercel.com/legal/privacy-policy',
    retention: '수탁자의 정책에 따른 기간 또는 위탁 목적 달성 시까지',
  },
  {
    recipient: 'Google LLC 및 Google 계열 서비스',
    country: '미국 등 Google이 운영하는 글로벌 인프라 소재 국가',
    timing: 'YouTube OAuth 인증, API 호출, Live Chat 및 영상 메타데이터 조회 시 암호화된 통신으로 전송',
    items: 'YouTube 계정·채널 식별자, OAuth 인증 정보, Live Chat 메시지, 영상 ID 및 API 요청에 필요한 정보',
    purpose: 'YouTube 계정 연결, 라이브 채팅 연동, 영상 후원 기능 제공',
    contact: 'https://policies.google.com/privacy',
    retention: '사용자 연결 유지 기간 및 Google 정책에 따른 기간',
  },
] as const;

const sections = [
  {
    title: '1. 개인정보 처리방침의 적용 범위',
    body: [
      `이 방침은 ${controllerName}가 제공하는 AruBot 웹 서비스, 백엔드 API, OBS 오버레이, 공개 페이지, 로컬 프로그램 연동 기능에 적용됩니다.`,
      '공식 서비스 주소는 프론트엔드 http://arubot.yuaru.com/ 및 백엔드 http://arubotapi.yuaru.com/ 입니다.',
      '로컬 프로그램 설치 파일은 GitHub Releases를 통해 배포될 수 있고, 브라우저 확장 프로그램은 Chrome Web Store 또는 Firefox Add-ons 등 공식 스토어에서 배포될 수 있습니다. 다만 AruBot이 해당 배포 채널로 서비스 이용자의 개인정보를 직접 이전하거나 보관하도록 위탁하지는 않습니다.',
    ],
  },
  {
    title: '2. 개인정보의 처리 목적, 항목 및 보유기간',
    body: [
      'AruBot은 서비스 제공에 필요한 최소한의 범위에서 개인정보를 처리합니다.',
      '처리하는 개인정보는 아래 목적 외의 용도로 이용하지 않으며, 이용 목적이 변경되는 경우 관련 법령에 따라 별도 동의를 받는 등 필요한 조치를 이행합니다.',
      'AruBot은 주민등록번호, 여권번호, 운전면허번호 등 고유식별정보와 민감정보를 의도적으로 요구하지 않습니다. 이용자는 채팅, 명령어, 그림, 자동화 설정, 외부 endpoint 등에 민감정보나 타인의 개인정보를 입력하지 않아야 합니다.',
    ],
    table: processingRows,
  },
  {
    title: '3. 개인정보 처리의 법적 근거 및 추가 이용·제공',
    body: [
      'AruBot은 정보주체의 동의, 서비스 이용계약의 체결·이행, 법령상 의무 준수, 서비스 보안과 부정이용 방지를 위한 정당한 이익 등 개인정보 보호법에서 허용하는 근거에 따라 개인정보를 처리합니다.',
      'AruBot은 동의 없이 개인정보를 추가적으로 이용 또는 제공해야 하는 경우, 당초 수집 목적과의 관련성, 추가 이용·제공에 대한 예측 가능성, 정보주체의 이익 침해 여부, 가명처리 또는 암호화 등 안전성 확보조치 여부를 종합적으로 고려합니다.',
      '위 기준을 충족하지 않는 목적 변경, 제3자 제공 또는 민감정보 처리가 필요한 경우에는 별도 동의를 받거나 관련 법령에서 정한 절차를 따릅니다.',
    ],
  },
  {
    title: '4. 만 14세 미만 아동의 개인정보 처리',
    body: [
      'AruBot은 방송 채팅과 공개 페이지를 기반으로 동작하는 서비스입니다. 다만 계정 연결, 포인트, 예측, 그림 후원, 참여 기록 저장 등 개인정보가 지속적으로 저장되는 기능을 만 14세 미만 아동이 이용하려는 경우 법정대리인의 동의가 필요합니다.',
      '방송 플랫폼 계정과 채팅 참여 구조상 AruBot이 모든 이용자의 연령을 사전에 독자적으로 확인하기는 어렵습니다.',
      'AruBot은 만 14세 미만 아동의 개인정보가 법정대리인 동의 없이 저장형 기능에서 처리된 사실을 확인한 경우, 법정대리인 동의 확인, 기능 제한, 연결 해제 또는 개인정보 삭제 등 필요한 조치를 할 수 있습니다.',
      '법정대리인은 아동의 개인정보 열람, 정정, 삭제, 처리정지, 동의 철회를 요청할 수 있습니다.',
    ],
  },
  {
    title: '5. 개인정보의 파기 절차 및 방법',
    body: [
      'AruBot은 개인정보 보유기간이 경과하거나 처리 목적이 달성된 경우 지체 없이 해당 개인정보를 파기합니다.',
      '전자적 파일은 복구하기 어렵도록 삭제하고, 데이터베이스 기록은 삭제 또는 접근 제한 처리합니다. 백업에 포함된 정보는 백업 보관 주기와 복구 안정성 확보 절차에 따라 순차적으로 삭제될 수 있습니다.',
      '관계 법령, 분쟁 대응, 보안 사고 조사, 부정 이용 방지 등 정당한 사유가 있는 경우 해당 사유가 해소될 때까지 필요한 범위의 개인정보를 분리 보관하거나 접근을 제한하여 보관할 수 있습니다.',
    ],
  },
  {
    title: '6. 개인정보의 제3자 제공 및 외부 플랫폼 연동',
    body: [
      'AruBot은 원칙적으로 정보주체의 동의 없이 개인정보를 제3자에게 제공하지 않습니다.',
      '다만 사용자가 외부 플랫폼 연결, 채팅 송수신, 라이브 상태 조회, 후원·구독 이벤트 처리, 영상 메타데이터 조회 등 기능을 요청한 경우, 해당 기능 수행에 필요한 범위에서 아래 외부 플랫폼과 정보를 주고받을 수 있습니다.',
      '수사기관, 법원, 감독기관 등 법령에 근거한 요청이 있는 경우 관련 법령에서 정한 절차와 범위에 따라 개인정보가 제공될 수 있습니다.',
    ],
    table: thirdPartyRows,
  },
  {
    title: '7. 개인정보 처리업무의 위탁',
    body: [
      'AruBot은 안정적인 서비스 제공을 위해 아래와 같이 개인정보 처리업무 일부를 외부 인프라 사업자에게 위탁합니다.',
      'AruBot은 현재 운영 데이터베이스로 Oracle Cloud의 PostgreSQL을 사용하며, Supabase는 운영 개인정보 저장소로 사용하지 않습니다.',
      '수탁자 또는 위탁업무가 변경되는 경우 이 방침을 통해 공개합니다.',
    ],
    table: processorRows,
  },
  {
    title: '8. 개인정보의 국외 이전',
    body: [
      'AruBot의 백엔드 서버, 데이터베이스 및 그림 후원 파일 저장소는 Oracle Cloud 대한민국 춘천 리전에서 운영됩니다.',
      '다만 프론트엔드 호스팅, Google/YouTube 연동 등 일부 기능은 아래와 같이 국외 사업자의 인프라를 통해 처리될 수 있습니다.',
      '국외 이전을 원하지 않는 경우 해당 외부 플랫폼 연결을 해제하거나 서비스 이용을 중단할 수 있습니다. 다만 이 경우 YouTube 연동, 프론트엔드 접속 등 일부 기능 이용이 제한될 수 있습니다.',
    ],
    table: transferRows,
  },
  {
    title: '9. 쿠키 및 자동 수집 장치',
    body: [
      'AruBot은 로그인 유지, 세션 구분, 보안 확인, 테마 설정, 오버레이 연결, 사용자 편의 제공을 위해 쿠키, localStorage, sessionStorage 등을 사용할 수 있습니다.',
      '서비스 이용 과정에서 IP 주소, User-Agent, 접속 시각, 요청 URL, 오류 로그, 성능 정보가 자동으로 생성·수집될 수 있습니다.',
      '이용자는 브라우저 설정에서 쿠키 또는 저장소 사용을 제한할 수 있습니다. 다만 이 경우 로그인, 계정 연결, 관리자 기능, 공개 뷰어, OBS 오버레이, 로컬 프로그램 연동이 정상 동작하지 않을 수 있습니다.',
    ],
  },
  {
    title: '10. 정보주체와 법정대리인의 권리 및 행사방법',
    body: [
      '정보주체는 자신의 개인정보에 대해 열람, 정정, 삭제, 처리정지, 동의 철회, 플랫폼 연결 해제를 요청할 수 있습니다.',
      '서비스 화면에서 제공되는 로그아웃, 연결 해제, 토큰 재발급, 삭제 기능을 우선 사용할 수 있으며, 직접 처리가 어렵거나 별도 확인이 필요한 경우 개인정보 보호담당자에게 요청할 수 있습니다.',
      'AruBot은 권리 행사 요청을 받으면 본인 또는 정당한 대리인 여부를 확인한 뒤 관련 법령에 따라 처리합니다.',
      '다른 이용자의 권리, 방송인의 정당한 운영 기록, 법령상 보관 의무, 보안 사고 조사, 분쟁 대응과 관련된 정보는 열람·삭제·처리정지가 일부 제한될 수 있습니다.',
    ],
  },
  {
    title: '11. 자동화된 처리 및 공개 페이지',
    body: [
      'AruBot은 포인트 계산, 룰렛 추첨, 예측 정산, 후원 규칙 실행, 자동화 작업 실행 등 사용자가 설정한 규칙에 따라 일부 처리를 자동으로 수행할 수 있습니다.',
      '위 자동 처리는 방송 운영 기능 제공을 위한 것이며, 이용자의 권리 또는 의무에 중대한 영향을 미치는 법률적 결정을 자동으로 내리기 위한 것이 아닙니다. 결과에 이의가 있는 경우 방송인 또는 AruBot 개인정보 보호담당자에게 검토를 요청할 수 있습니다.',
      '공개 명령어 목록, 포인트 목록, 룰렛 로그, OBS 오버레이, 채팅 메시지, 방송 화면에 표시되는 정보는 링크 접근자 또는 방송 시청자에게 공개될 수 있습니다. 사용자는 공개 URL, 오버레이 토큰, API 키, 로컬 프로그램 토큰을 타인에게 공유하지 않아야 합니다.',
    ],
  },
  {
    title: '12. 개인정보의 안전성 확보조치',
    body: [
      'AruBot은 개인정보 보호를 위해 접근 권한 제한, 인증 토큰 암호화 또는 해시 처리, HTTPS 통신, 환경변수 기반 비밀정보 관리, 세션 관리, 보안 로그 확인, 오류 수정, 백업 및 복구 관리 등 합리적으로 가능한 보호조치를 적용합니다.',
      'OAuth 토큰, API 키, 오버레이 토큰, 로컬 프로그램 pairing token은 기능 제공에 필요한 범위에서만 처리하며, 유출이 의심되는 경우 사용자는 즉시 재발급, 연결 해제 또는 비밀번호 변경을 해야 합니다.',
      '외부 플랫폼 API 정책 변경, 네트워크 장애, 사용자의 공개 URL 공유, 로컬 PC 환경 문제, 사용자가 직접 입력한 외부 endpoint 설정으로 발생하는 위험은 AruBot이 완전히 통제할 수 없습니다.',
    ],
  },
  {
    title: '13. 개인정보 보호담당자 및 권익침해 구제',
    body: [
      `AruBot은 개인정보 처리에 관한 문의, 불만처리, 피해구제 및 열람청구를 처리하기 위해 개인정보 보호담당자를 두고 있습니다.`,
      `개인정보처리자: ${controllerName}`,
      '개인정보 보호 및 고충처리 담당부서: AruBot 개인정보 보호담당자',
      `문의 이메일: ${privacyContact}`,
      '개인정보 침해에 대한 상담 또는 구제가 필요한 경우 개인정보침해신고센터(국번없이 118, privacy.kisa.or.kr), 개인정보분쟁조정위원회(1833-6972, kopico.go.kr), 개인정보 포털(privacy.go.kr)을 이용할 수 있습니다.',
    ],
  },
  {
    title: '14. 개인정보 처리방침의 변경',
    body: [
      '이 개인정보 처리방침은 시행일로부터 적용됩니다.',
      'AruBot은 서비스 기능, 운영 환경, 법령, 외부 플랫폼 정책 변경에 따라 이 방침을 개정할 수 있습니다.',
      '중요한 변경이 있는 경우 서비스 화면, 공지, 배포 노트 또는 이 페이지의 시행일 변경을 통해 안내합니다.',
    ],
  },
] as const;

type TableRow = (typeof processingRows)[number] | (typeof thirdPartyRows)[number] | (typeof processorRows)[number] | (typeof transferRows)[number];

function PolicyTable({ rows }: { rows: readonly TableRow[] }) {
  const columns = Object.keys(rows[0] || {});

  return (
    <div className="mt-5 w-full rounded-[var(--radius-card)] border bg-background/45">
      <table className="w-full table-fixed border-collapse text-left text-[0.78rem] sm:text-sm">
        <colgroup>
          {columns.map((key) => (
            <col key={key} style={{ width: columnWidth(key, columns) }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b bg-muted/65">
            {columns.map((key) => (
              <th key={key} className="break-keep px-2 py-2.5 align-top text-[0.7rem] font-semibold leading-5 text-foreground sm:px-3 sm:text-xs">
                {columnLabel(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b last:border-b-0">
              {columns.map((key) => {
                const value = (row as Record<string, string>)[key] || '';
                return (
                  <td key={key} className="bg-card/95 px-2 py-3 align-top leading-6 text-muted-foreground [overflow-wrap:anywhere] sm:px-3 sm:leading-7">
                    <span className="block break-words">{value}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function columnWidth(key: string, columns: string[]) {
  const widthSets: Record<string, Record<string, string>> = {
    'service,purpose,items,basis,retention': {
      service: '11%',
      purpose: '19%',
      items: '30%',
      basis: '19%',
      retention: '21%',
    },
    'recipient,purpose,items,basis,retention': {
      recipient: '14%',
      purpose: '21%',
      items: '25%',
      basis: '19%',
      retention: '21%',
    },
    'processor,work,items,retention': {
      processor: '18%',
      work: '28%',
      items: '30%',
      retention: '24%',
    },
    'recipient,country,items,timing,retention,contact': {
      recipient: '12%',
      country: '13%',
      items: '20%',
      timing: '20%',
      retention: '19%',
      contact: '16%',
    },
  };

  const widths = widthSets[columns.join(',')];
  return widths?.[key] || `${100 / Math.max(columns.length, 1)}%`;
}

function columnLabel(key: string) {
  const labels: Record<string, string> = {
    service: '업무',
    purpose: '목적',
    items: '항목',
    basis: '근거',
    retention: '보유기간',
    recipient: '제공받는 자',
    processor: '수탁자',
    work: '위탁업무',
    country: '국가',
    timing: '시기·방법',
    contact: '연락처',
  };
  return labels[key] || key;
}

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
          {controllerName}는 정보주체의 자유와 권리 보호를 위해 개인정보 보호법 및 관계 법령을 준수하며, AruBot 서비스 제공에 필요한 개인정보 처리 기준을 다음과 같이 안내합니다.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Badge tone="sky">시행일: {effectiveDate}</Badge>
          <Badge tone="neutral">2026 개인정보 처리방침 작성지침 반영</Badge>
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
          본 방침은 개인정보보호위원회의 2026년 4월 개정 개인정보 처리방침 작성지침을 참고하여 작성했습니다. 서비스 기능, 운영 환경, 법령 또는 외부 플랫폼 정책이 변경되면 실제 처리 현황에 맞게 개정될 수 있습니다.
          <Link
            href="https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=&nttId=12018"
            target="_blank"
            rel="noreferrer"
            className="ml-1 inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            참고 지침
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
          <article key={section.title} className="min-w-0 rounded-[var(--radius-card)] border bg-card/88 p-[clamp(1.1rem,2.2vw,1.5rem)] shadow-subtle">
            <h2 className="break-keep text-lg font-semibold">{section.title}</h2>
            <ul className="mt-4 grid gap-2 text-sm leading-7 text-muted-foreground">
              {section.body.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-[0.65rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/65" />
                  <span className="break-keep">{item}</span>
                </li>
              ))}
            </ul>
            {'table' in section ? <PolicyTable rows={section.table} /> : null}
          </article>
        ))}
      </section>
    </main>
  );
}
