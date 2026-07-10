'use client';

import * as Dialog from '@radix-ui/react-dialog';
import {
  Activity,
  BadgeCheck,
  Bot,
  Braces,
  CalendarClock,
  CheckCircle2,
  Code2,
  Coins,
  Copy,
  Download,
  GitBranch,
  Layers3,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  MousePointer2,
  Move,
  Network,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Search,
  Shuffle,
  Sparkles,
  Trash2,
  Type,
  Redo2,
  Undo2,
  Upload,
  Volume2,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { type CSSProperties, useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CommandVariableHelpButton } from '@/features/admin/command-variable-help';
import { cn, compactDateTime } from '@/shared/lib/utils';
import { apiUrl, readJson } from '@/shared/api/http';

type ActionMenuEntry = {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
};

function ActionMenu({ label, entries }: { label: string; entries: ActionMenuEntry[] }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`${label} 메뉴`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal className="h-4 w-4" />
        {label}
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label={`${label} 메뉴 항목`}
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-48 rounded-[var(--radius-control)] border bg-card p-1.5 text-foreground shadow-lift"
        >
          {entries.map((entry) => {
            const Icon = entry.icon;
            return (
              <div key={entry.label}>
                {entry.separatorBefore ? <div role="separator" className="my-1 h-px bg-border" /> : null}
                <button
                  type="button"
                  role="menuitem"
                  disabled={entry.disabled}
                  onClick={() => {
                    setOpen(false);
                    entry.onSelect();
                  }}
                  className={cn(
                    'flex min-h-9 w-full select-none items-center gap-2 rounded-[calc(var(--radius-control)*0.8)] px-2.5 text-left text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-45',
                    entry.danger ? 'text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10' : null,
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {entry.label}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

type NodeType =
  | 'start'
  | 'end'
  | 'chat'
  | 'wait'
  | 'condition'
  | 'setVariable'
  | 'readVariable'
  | 'action'
  | 'parallel'
  | 'loop'
  | 'random'
  | 'pointsGet'
  | 'pointsAdjust'
  | 'pointsEnough'
  | 'pointsRanking'
  | 'pointsExcluded'
  | 'rouletteList'
  | 'rouletteRun'
  | 'rouletteCompare'
  | 'rouletteDisplay'
  | 'attendanceGet'
  | 'cooldown'
  | 'join'
  | 'approval'
  | 'timer'
  | 'chatVote'
  | 'highlight'
  | 'overlay'
  | 'overlayUpdate'
  | 'overlayHide'
  | 'fx'
  | 'tts'
  | 'sound'
  | 'obs'
  | 'http'
  | 'websocket'
  | 'udp'
  | 'tits'
  | 'vtube'
  | 'log';

type BlueprintNode = {
  id: string;
  type: NodeType;
  name: string;
  position: { x: number; y: number };
  enabled?: boolean;
  config: Record<string, unknown>;
};

type BlueprintEdge = {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
};

type Blueprint = {
  id?: string;
  name: string;
  slug?: string;
  enabled?: boolean;
  description?: string;
  currentVersionId?: string | null;
  updatedAt?: string | null;
  version?: {
    id?: string;
    version?: number;
    published?: boolean;
    nodes?: BlueprintNode[];
    edges?: BlueprintEdge[];
    viewport?: Viewport;
  } | null;
};

type BlueprintRun = {
  id: string;
  status?: string;
  triggerSource?: string;
  startedAt?: string;
  finishedAt?: string | null;
  error?: string | null;
};

type BlueprintVersion = {
  id: string;
  version?: number;
  published?: boolean;
  createdAt?: string | null;
};

type AutomationDiscoveryCache = {
  items?: Array<{ id: string; name: string; encodedImage?: string | null }>;
  triggers?: Array<{ id: string; name: string }>;
  hotkeys?: Array<{ id: string; name: string; type?: string; description?: string }>;
  models?: Array<{ id: string; name: string; loaded?: boolean }>;
  expressions?: Array<{ file?: string; name: string; active?: boolean }>;
  parameters?: Array<{ id: string; name: string; min?: number | null; max?: number | null; defaultValue?: number | null }>;
  scenes?: Array<{ id?: string; name: string; current?: boolean }>;
  sources?: Array<{ id?: string; name: string; sceneName?: string; inputKind?: string; enabled?: boolean }>;
  filters?: Array<{ id?: string; name: string; sourceName?: string; kind?: string; enabled?: boolean }>;
  requests?: Array<{ id: string; name: string; group?: string }>;
  transitions?: Array<{ id?: string; name: string; current?: boolean }>;
  currentModel?: { loaded?: boolean; id?: string; name?: string };
  fetchedAt?: string;
};

type AutomationConnection = {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  executionMode?: 'web' | 'local';
  endpoint?: string;
  discoveryCache?: AutomationDiscoveryCache;
  lastStatus?: string | null;
};

type AutomationOverview = {
  settings?: {
    integrationMode?: 'web' | 'local';
  };
  connections?: AutomationConnection[];
  soundStorage?: {
    files?: Array<{ id: string; name: string; size?: number; updatedAt?: string; url?: string }>;
  };
  fxAssets?: Array<{ id: string; name: string; kind: 'image' | 'sticker' | 'video' | 'sound'; previewDataUrl?: string | null }>;
  localAgents?: Array<{
    id: string;
    name: string;
    status: string;
    lastSeenAt: string | null;
  }>;
};

type BlueprintRunStep = {
  id: string;
  nodeId?: string;
  nodeType?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  status?: string;
  output?: Record<string, unknown>;
  durationMs?: number | null;
  error?: string | null;
};

type Viewport = { x: number; y: number; zoom: number };
type BlueprintClipboard = {
  schema: 'arubot.blueprint.selection';
  version: 1;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
};
type BlueprintExport = {
  schema: 'arubot.blueprint';
  version: 1;
  exportedAt: string;
  blueprint: Pick<Blueprint, 'name' | 'slug' | 'description' | 'enabled'> & {
    version: {
      nodes: BlueprintNode[];
      edges: BlueprintEdge[];
      viewport: Viewport;
    };
  };
};

type BlueprintContextMenu = {
  kind: 'node' | 'pane';
  x: number;
  y: number;
  nodeId?: string;
  flowPosition?: { x: number; y: number };
};

type BlueprintNodeFlowData = {
  node: BlueprintNode;
  active: boolean;
  latestStep?: BlueprintRunStep;
};
type BlueprintFlowNode = FlowNode<BlueprintNodeFlowData, 'blueprintNode'>;
type BlueprintFlowEdge = FlowEdge<{ sourcePort: string; targetPort: string }>;
type BlueprintTone = NonNullable<React.ComponentProps<typeof Badge>['tone']>;

const FLOW_UNIT = 16;
const NODE_SIZE = { width: 16.5, height: 8.2 };
const NODE_WIDTH = NODE_SIZE.width * FLOW_UNIT;
const NODE_MIN_HEIGHT = NODE_SIZE.height * FLOW_UNIT;
const PORT_CHIP_HEIGHT = 1.55;
const PORT_CHIP_GAP = 0.34;
const PORT_CHIP_BOTTOM = 0.72;
const PORT_CHIP_SIDE = 0.78;
const DEFAULT_VIEWPORT: Viewport = { x: 80, y: 80, zoom: 1 };
const SELECTION_CLIPBOARD_SCHEMA = 'arubot.blueprint.selection';
const BLUEPRINT_EXPORT_SCHEMA = 'arubot.blueprint';
const AUTOSAVE_KEY = 'arubot:action-blueprint:draft:v1';

const OBS_ACTION_OPTIONS = [
  { value: 'scene.switch', label: '장면 전환', group: '장면' },
  { value: 'scene.preview', label: '미리보기 장면 전환', group: '장면' },
  { value: 'source.show', label: '소스 표시', group: '소스' },
  { value: 'source.hide', label: '소스 숨기기', group: '소스' },
  { value: 'source.toggle', label: '소스 표시 토글', group: '소스' },
  { value: 'input.mute', label: '입력 음소거', group: '오디오' },
  { value: 'input.unmute', label: '입력 음소거 해제', group: '오디오' },
  { value: 'input.toggleMute', label: '입력 음소거 토글', group: '오디오' },
  { value: 'input.volume', label: '입력 볼륨 설정', group: '오디오' },
  { value: 'filter.on', label: '필터 ON', group: '필터' },
  { value: 'filter.off', label: '필터 OFF', group: '필터' },
  { value: 'filter.toggle', label: '필터 토글', group: '필터' },
  { value: 'input.text', label: '텍스트 소스 수정', group: '입력' },
  { value: 'input.settings', label: '입력 설정 JSON 적용', group: '입력' },
  { value: 'media.play', label: '미디어 재생', group: '미디어' },
  { value: 'media.pause', label: '미디어 일시정지', group: '미디어' },
  { value: 'media.stop', label: '미디어 정지', group: '미디어' },
  { value: 'media.restart', label: '미디어 다시 시작', group: '미디어' },
  { value: 'media.next', label: '미디어 다음', group: '미디어' },
  { value: 'media.previous', label: '미디어 이전', group: '미디어' },
  { value: 'record.start', label: '녹화 시작', group: '녹화' },
  { value: 'record.stop', label: '녹화 중지', group: '녹화' },
  { value: 'record.toggle', label: '녹화 토글', group: '녹화' },
  { value: 'record.pause', label: '녹화 일시정지', group: '녹화' },
  { value: 'record.resume', label: '녹화 재개', group: '녹화' },
  { value: 'record.togglePause', label: '녹화 일시정지 토글', group: '녹화' },
  { value: 'record.split', label: '녹화 파일 분할', group: '녹화' },
  { value: 'record.chapter', label: '녹화 챕터 만들기', group: '녹화' },
  { value: 'stream.start', label: '방송 시작', group: '방송' },
  { value: 'stream.stop', label: '방송 종료', group: '방송' },
  { value: 'stream.toggle', label: '방송 토글', group: '방송' },
  { value: 'stream.caption', label: '방송 자막 전송', group: '방송' },
  { value: 'replay.start', label: '리플레이 버퍼 시작', group: '리플레이' },
  { value: 'replay.stop', label: '리플레이 버퍼 중지', group: '리플레이' },
  { value: 'replay.toggle', label: '리플레이 버퍼 토글', group: '리플레이' },
  { value: 'replay.save', label: '리플레이 저장', group: '리플레이' },
  { value: 'virtualcam.start', label: '가상 카메라 시작', group: '출력' },
  { value: 'virtualcam.stop', label: '가상 카메라 중지', group: '출력' },
  { value: 'virtualcam.toggle', label: '가상 카메라 토글', group: '출력' },
  { value: 'transition.set', label: '전환 효과 선택', group: '전환' },
  { value: 'transition.duration', label: '전환 시간 설정', group: '전환' },
  { value: 'studio.mode.on', label: '스튜디오 모드 켜기', group: '스튜디오' },
  { value: 'studio.mode.off', label: '스튜디오 모드 끄기', group: '스튜디오' },
  { value: 'studio.mode.toggle', label: '스튜디오 모드 토글', group: '스튜디오' },
  { value: 'hotkey.trigger', label: 'OBS 핫키 실행', group: '핫키' },
] as const;

const obsSceneActions = new Set(['scene.switch', 'scene.preview']);
const obsSceneSourceActions = new Set(['source.show', 'source.hide', 'source.toggle', 'source.visibility']);
const obsFilterActions = new Set(['filter.on', 'filter.off', 'filter.toggle', 'filter.enabled']);
const obsInputActions = new Set(['input.mute', 'input.unmute', 'input.toggleMute', 'input.volume', 'input.text', 'input.settings']);
const obsMediaActions = new Set(['media.play', 'media.pause', 'media.stop', 'media.restart', 'media.next', 'media.previous']);
const obsSupportedActions = new Set([...OBS_ACTION_OPTIONS.map((item) => item.value), 'source.visibility', 'filter.enabled']);

const nodeCatalog: Array<{
  type: NodeType;
  title: string;
  body: string;
  group: string;
  icon: typeof Workflow;
  tone: BlueprintTone;
  config: Record<string, unknown>;
  hidden?: boolean;
}> = [
  { type: 'start', title: '시작', body: '액션의 첫 순간', group: '필수', icon: Play, tone: 'mint', config: {} },
  { type: 'end', title: '종료', body: '마무리 응답', group: '필수', icon: BadgeCheck, tone: 'coral', config: { status: 'success', message: '완료' } },
  { type: 'chat', title: '채팅 전송', body: '채팅에 바로 말하기', group: '기본', icon: MessageSquare, tone: 'sky', config: { message: '{user.username}님, 실행되었습니다.' } },
  { type: 'wait', title: '대기', body: '잠깐 쉬어가기', group: '기본', icon: CalendarClock, tone: 'neutral', config: { seconds: 1 } },
  { type: 'condition', title: '조건문', body: '상황에 따라 나누기', group: '기본', icon: GitBranch, tone: 'lemon', config: { left: '{user.points}', operator: 'gte', right: '1000' } },
  { type: 'setVariable', title: '임시 변수', body: '값을 잠시 보관', group: '기본', icon: Braces, tone: 'amber', config: { key: 'bonusPoint', mode: 'set', value: '100' } },
  { type: 'readVariable', title: '변수 읽기', body: '필요한 값 꺼내기', group: '기본', icon: Type, tone: 'cyan', config: { path: '{user.name}' } },
  { type: 'action', title: '다른 블루프린트 실행', body: '다른 액션 이어가기', group: '기본', icon: Workflow, tone: 'sky', config: { actionId: '' } },
  { type: 'parallel', title: '다중 실행', body: '연결된 노드를 동시에 실행', group: '흐름', icon: GitBranch, tone: 'violet', config: {} },
  { type: 'loop', title: 'N회 반복', body: '반복 중 true, 완료 후 false', group: '흐름', icon: RefreshCw, tone: 'sky', config: { count: 3, gapMs: 250 } },
  { type: 'random', title: '랜덤 분기', body: '가중치 기반 분기', group: '흐름', icon: Shuffle, tone: 'lemon', config: { options: [{ id: 'a', label: 'A', weight: 1 }, { id: 'b', label: 'B', weight: 1 }] } },
  { type: 'pointsGet', title: '포인트 조회', body: '보유 포인트 가져오기', group: '포인트', icon: Coins, tone: 'mint', config: { userId: '{user.userId}' } },
  { type: 'pointsAdjust', title: '포인트 지급/차감', body: '보상/사용 포인트 반영', group: '포인트', icon: Coins, tone: 'mint', config: { userId: '{user.userId}', delta: '100' } },
  { type: 'pointsEnough', title: '포인트 충분 여부', body: '조건문으로 대체됨', group: '레거시', icon: Coins, tone: 'lemon', config: { userId: '{user.userId}', required: '1000' }, hidden: true },
  { type: 'pointsRanking', title: '포인트 랭킹', body: '상위 시청자 조회', group: '포인트', icon: Coins, tone: 'mint', config: { limit: 10 } },
  { type: 'pointsExcluded', title: '적립 제외 확인', body: '제외 UUID true/false', group: '포인트', icon: Coins, tone: 'lemon', config: { userId: '{user.userId}' } },
  { type: 'rouletteList', title: '룰렛 목록', body: '실행 가능한 룰렛 조회', group: '룰렛', icon: Sparkles, tone: 'lemon', config: {} },
  { type: 'rouletteRun', title: '룰렛 실행', body: '당첨 결과 만들기', group: '룰렛', icon: Sparkles, tone: 'lemon', config: { name: '' } },
  { type: 'rouletteCompare', title: '룰렛 결과 비교', body: '조건문으로 대체됨', group: '레거시', icon: Sparkles, tone: 'lemon', config: { left: '{node.rouletteRun.result.label}', operator: 'eq', right: '' }, hidden: true },
  { type: 'rouletteDisplay', title: '룰렛 결과 표시', body: '오버레이 표시로 대체됨', group: '레거시', icon: Sparkles, tone: 'sky', config: { text: '{roulette.result.label}', durationMs: 4000 }, hidden: true },
  { type: 'attendanceGet', title: '출석 조회', body: '누적 출석일 확인', group: '참여', icon: CheckCircle2, tone: 'mint', config: { userId: '{user.userId}' } },
  { type: 'cooldown', title: '쿨다운 확인', body: '조건문으로 대체됨', group: '레거시', icon: CalendarClock, tone: 'lemon', config: { key: '{user.userId}', seconds: 30 }, hidden: true },
  { type: 'join', title: '흐름 합류', body: 'React Flow 연결 방식으로 대체됨', group: '레거시', icon: GitBranch, tone: 'neutral', config: {}, hidden: true },
  { type: 'approval', title: '관리자 확인', body: '방송 전 승인 받기', group: '흐름', icon: CheckCircle2, tone: 'emerald', config: { message: '이 액션을 실행할까요?' } },
  { type: 'timer', title: '타이머 예약', body: '대기 노드로 대체됨', group: '레거시', icon: CalendarClock, tone: 'sky', config: { seconds: 10 }, hidden: true },
  { type: 'chatVote', title: '채팅 투표 대기', body: '채팅 투표 기능으로 대체됨', group: '레거시', icon: MessageSquare, tone: 'sky', config: { seconds: 30, options: '1,2' }, hidden: true },
  { type: 'highlight', title: '하이라이트 마커', body: '로그 노드로 대체됨', group: '레거시', icon: BadgeCheck, tone: 'neutral', config: { label: '하이라이트' }, hidden: true },
  { type: 'overlay', title: '오버레이 표시', body: '텍스트/진행바/카운트다운', group: '연출', icon: Layers3, tone: 'sky', config: { text: '{user.name}님 당첨!', durationMs: 4000, animation: '', cssCode: '', animationKey: '' } },
  { type: 'overlayUpdate', title: '오버레이 수정', body: '표시 내용/진행률 수정', group: '연출', icon: Layers3, tone: 'sky', config: { overlayId: '{node.overlay.overlayId}', text: '', progress: '', animation: '', cssCode: '', animationKey: '' } },
  { type: 'overlayHide', title: '오버레이 숨김', body: '표시 중인 오버레이 닫기', group: '연출', icon: Layers3, tone: 'neutral', config: { overlayId: '{node.overlay.overlayId}' } },
  { type: 'tts', title: 'TTS', body: '말할 내용 입력', group: '연출', icon: Volume2, tone: 'coral', config: { text: '{user.name}님 축하합니다!', voice: '', rate: 1, pitch: 1 } },
  { type: 'fx', title: 'FX 오버레이', body: '이미지/스티커/비디오/사운드', group: '연출', icon: Volume2, tone: 'coral', config: { kind: 'image', assetId: '', x: 50, y: 50, width: 28, height: 28, xUnit: '%', yUnit: '%', widthUnit: '%', heightUnit: '%', durationMs: 4000, enterCss: '', exitCss: '', chromaKey: false, chromaKeyColor: '#00ff00', volume: 1 } },
  { type: 'obs', title: 'OBS', body: '장면/소스/필터 제어', group: '연동', icon: Radio, tone: 'mint', config: { connectionId: '', action: 'scene.switch', sceneName: '', sourceName: '', filterName: '', enabled: true } },
  { type: 'http', title: 'HTTP 요청', body: '외부 도구 깨우기', group: '연동', icon: Network, tone: 'neutral', config: { method: 'POST', url: '', body: '{}' } },
  { type: 'websocket', title: 'WebSocket', body: '로컬 도구에 메시지', group: '연동', icon: Network, tone: 'neutral', config: { url: '', message: '{}', timeoutMs: 8000 } },
  { type: 'udp', title: 'UDP', body: '장비/효과 실행', group: '연동', icon: Network, tone: 'neutral', config: { host: '127.0.0.1', port: 0, message: '' } },
  { type: 'tits', title: 'T.I.T.S', body: '아이템/트리거 실행', group: '로컬', icon: Activity, tone: 'amber', config: { triggerId: '', strength: 1, durationMs: 1000 } },
  { type: 'vtube', title: 'VTube Studio', body: '핫키/파라미터 제어', group: '로컬', icon: Bot, tone: 'cyan', config: { hotkeyId: '', parameter: '', value: '' } },
  { type: 'log', title: '로그', body: '실행 기록에 남김', group: '기본', icon: Code2, tone: 'neutral', config: { message: '로그: {flow.bonusPoint}' } },
];

const operators = [
  ['eq', '같음'],
  ['neq', '다름'],
  ['contains', '포함'],
  ['regex', '정규식'],
  ['gt', '초과'],
  ['gte', '이상'],
  ['lt', '미만'],
  ['lte', '이하'],
  ['empty', '비어 있음'],
  ['exists', '존재함'],
] as const;

const blueprintTemplates: Array<{
  id: string;
  title: string;
  body: string;
  tone: BlueprintTone;
  nodes: Array<{ type: NodeType; name?: string; position: { x: number; y: number }; config?: Record<string, unknown> }>;
  edges: Array<{ source: number; sourcePort?: string; target: number; targetPort?: string }>;
}> = [
  {
    id: 'points-roulette-overlay',
    title: '포인트 룰렛 연출',
    body: '포인트가 충분하면 차감 후 룰렛을 돌리고 결과를 오버레이로 보여줍니다.',
    tone: 'lemon',
    nodes: [
      { type: 'condition', name: '포인트 확인', position: { x: 0, y: 0 }, config: { left: '{user.points}', operator: 'gte', right: '1000' } },
      { type: 'pointsAdjust', name: '포인트 차감', position: { x: 22, y: -2 }, config: { userId: '{user.userId}', delta: '-1000' } },
      { type: 'rouletteRun', name: '룰렛 실행', position: { x: 44, y: -2 }, config: { name: '' } },
      { type: 'overlay', name: '룰렛 결과 표시', position: { x: 66, y: -2 }, config: { text: '{node.rouletteRun.result.label}', durationMs: 4500, animation: '', cssCode: '', animationKey: '' } },
      { type: 'chat', name: '포인트 부족 안내', position: { x: 22, y: 10 }, config: { message: '{user.username}님, 포인트가 부족합니다.' } },
    ],
    edges: [
      { source: 0, sourcePort: 'true', target: 1 },
      { source: 1, target: 2 },
      { source: 2, target: 3 },
      { source: 0, sourcePort: 'false', target: 4 },
    ],
  },
  {
    id: 'chat-highlight-tts',
    title: '채팅 하이라이트',
    body: '조건을 만족한 채팅을 하이라이트로 남기고 TTS로 읽습니다.',
    tone: 'sky',
    nodes: [
      { type: 'condition', name: '키워드 확인', position: { x: 0, y: 0 }, config: { left: '{trigger.message}', operator: 'contains', right: '축하' } },
      { type: 'log', name: '하이라이트 기록', position: { x: 22, y: -2 }, config: { message: '{user.username} 채팅: {trigger.message}' } },
      { type: 'tts', name: 'TTS 읽기', position: { x: 44, y: -2 }, config: { text: '{user.username}님이 말했어요. {trigger.message}', voice: '', rate: 1, pitch: 1 } },
    ],
    edges: [
      { source: 0, sourcePort: 'true', target: 1 },
      { source: 1, target: 2 },
    ],
  },
  {
    id: 'attendance-bonus',
    title: '출석 보너스',
    body: '출석일을 확인하고 누적 출석자에게 보너스 포인트와 메시지를 지급합니다.',
    tone: 'mint',
    nodes: [
      { type: 'attendanceGet', name: '출석 조회', position: { x: 0, y: 0 }, config: { userId: '{user.userId}' } },
      { type: 'condition', name: '누적 7일 확인', position: { x: 22, y: 0 }, config: { left: '{node.attendanceGet.totalDays}', operator: 'gte', right: '7' } },
      { type: 'pointsAdjust', name: '보너스 지급', position: { x: 44, y: -2 }, config: { userId: '{user.userId}', delta: '500' } },
      { type: 'chat', name: '보너스 안내', position: { x: 66, y: -2 }, config: { message: '{user.username}님, 누적 출석 보너스 500포인트를 받았습니다.' } },
    ],
    edges: [
      { source: 0, target: 1 },
      { source: 1, sourcePort: 'true', target: 2 },
      { source: 2, target: 3 },
    ],
  },
  {
    id: 'random-reaction',
    title: '랜덤 리액션',
    body: '랜덤 분기로 채팅, 사운드, 오버레이 반응을 섞어 보여줍니다.',
    tone: 'violet',
    nodes: [
      { type: 'random', name: '반응 선택', position: { x: 0, y: 0 }, config: { options: [{ id: 'chat', label: '채팅', weight: 2 }, { id: 'sound', label: '사운드', weight: 1 }, { id: 'overlay', label: '오버레이', weight: 1 }] } },
      { type: 'chat', name: '채팅 반응', position: { x: 24, y: -8 }, config: { message: '{user.username}님 반가워요!' } },
      { type: 'fx', name: 'FX 사운드', position: { x: 24, y: 2 }, config: { kind: 'sound', assetId: '', volume: 1, durationMs: 1000 } },
      { type: 'overlay', name: '오버레이 반응', position: { x: 24, y: 12 }, config: { text: '{user.username}님 등장!', durationMs: 3500, animation: 'pop' } },
    ],
    edges: [
      { source: 0, sourcePort: 'option:chat', target: 1 },
      { source: 0, sourcePort: 'option:sound', target: 2 },
      { source: 0, sourcePort: 'option:overlay', target: 3 },
    ],
  },
];

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function createNode(type: NodeType, position: { x: number; y: number }, id = createId(type)): BlueprintNode {
  const spec = nodeCatalog.find((item) => item.type === type) || nodeCatalog[0];
  return {
    id,
    type,
    name: spec.title,
    position,
    enabled: true,
    config: JSON.parse(JSON.stringify(spec.config)),
  };
}

function normalizeNodeName(node: BlueprintNode): BlueprintNode {
  if (node.type === 'action' && node.name === '특수 변수 실행') {
    return { ...node, name: nodeSpec('action').title };
  }
  return node;
}

function defaultNodes(): BlueprintNode[] {
  return [
    createNode('start', { x: 0, y: 3 }, 'starter_start'),
    createNode('chat', { x: 24, y: 1 }, 'starter_chat'),
    createNode('end', { x: 48, y: 3 }, 'starter_end'),
  ];
}

function defaultEdges(nodes: BlueprintNode[]): BlueprintEdge[] {
  return [
    { id: 'starter_edge_start_chat', source: nodes[0].id, sourcePort: 'out', target: nodes[1].id, targetPort: 'in' },
    { id: 'starter_edge_chat_end', source: nodes[1].id, sourcePort: 'out', target: nodes[2].id, targetPort: 'in' },
  ];
}

function inputPorts(node: BlueprintNode) {
  return node.type === 'start' ? [] : ['in'];
}

function outputPorts(node: BlueprintNode) {
  if (node.type === 'end') return [];
  if (node.type === 'condition' || node.type === 'pointsEnough' || node.type === 'pointsExcluded' || node.type === 'rouletteCompare' || node.type === 'cooldown' || node.type === 'loop') return ['true', 'false'];
  if (node.type === 'random') {
    const options = Array.isArray(node.config.options) ? node.config.options as Array<{ id?: string }> : [];
    return options.length ? options.map((option, index) => `option:${option.id || index}`) : ['option:a', 'option:b'];
  }
  return ['out'];
}

function allowsMultipleOutgoing(node?: Pick<BlueprintNode, 'type'> | null) {
  return node?.type === 'parallel';
}

function isBlank(value: unknown) {
  return value == null || String(value).trim() === '';
}

function requiredConfigErrors(node: BlueprintNode) {
  const errors: string[] = [];
  const cfg = node.config || {};
  const label = node.name || node.type;
  const need = (key: string, field: string) => {
    if (isBlank(cfg[key])) errors.push(`${label}: ${field} 값이 필요합니다.`);
  };
  const numberInRange = (key: string, field: string, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => {
    if (isBlank(cfg[key])) return;
    const value = Number(cfg[key]);
    if (!Number.isFinite(value) || value < min || value > max) errors.push(`${label}: ${field} 값이 올바른 숫자여야 합니다.`);
  };
  if (node.type === 'chat') need('message', '메시지');
  if (node.type === 'readVariable') need('path', '읽을 변수');
  if (node.type === 'condition' || node.type === 'rouletteCompare') {
    need('left', '좌변');
    need('operator', '연산자');
    if (!['exists', 'empty'].includes(String(cfg.operator || 'eq'))) need('right', '우변');
  }
  if (node.type === 'setVariable') need('key', '변수 이름');
  if (node.type === 'random') {
    const options = Array.isArray(cfg.options) ? cfg.options as Array<{ id?: unknown; weight?: unknown }> : [];
    if (options.length < 2) errors.push(`${label}: 랜덤 분기는 선택지가 2개 이상 필요합니다.`);
    const ids = options.map((option, index) => String(option.id || index).trim());
    if (new Set(ids).size !== ids.length) errors.push(`${label}: 분기 포트 ID가 중복되었습니다.`);
    if (!options.some((option) => Number(option.weight ?? 1) > 0)) errors.push(`${label}: 가중치가 1 이상인 선택지가 필요합니다.`);
  }
  if (node.type === 'action') need('actionId', '실행할 액션 ID');
  if (node.type === 'wait') numberInRange('seconds', '대기 시간', 0);
  if (node.type === 'loop') {
    numberInRange('count', '반복 횟수', 0);
    numberInRange('gapMs', '반복 간격', 0);
  }
  if (node.type === 'pointsAdjust') {
    need('delta', '변경 포인트');
    numberInRange('delta', '변경 포인트');
  }
  if (node.type === 'pointsEnough') need('required', '필요 포인트');
  if (node.type === 'pointsRanking') numberInRange('limit', '조회 인원', 1, 50);
  if (node.type === 'rouletteRun') need('name', '룰렛 이름 또는 ID');
  if (node.type === 'rouletteDisplay' || node.type === 'overlay') need('text', '표시 내용');
  if (node.type === 'overlayUpdate' || node.type === 'overlayHide') need('overlayId', '오버레이 ID');
  if (node.type === 'fx' && !(String(node.config.kind || '') === 'video' && String(node.config.youtubeUrl || '').trim())) need('assetId', 'FX 에셋');
  if (node.type === 'tts') need('text', '말할 내용');
  if (node.type === 'http') need('url', 'URL');
  if (node.type === 'http') {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(cfg.method || 'POST').toUpperCase())) errors.push(`${label}: HTTP 메서드는 GET, POST, PUT, PATCH, DELETE 중 하나여야 합니다.`);
    if (!isBlank(cfg.headers)) {
      try {
        const parsed = JSON.parse(String(cfg.headers));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) errors.push(`${label}: Headers는 JSON 객체여야 합니다.`);
      } catch {
        errors.push(`${label}: Headers JSON 형식이 올바르지 않습니다.`);
      }
    }
  }
  if (node.type === 'websocket') {
    need('url', 'URL');
    need('message', '메시지');
  }
  if (node.type === 'udp') {
    need('host', '호스트');
    need('port', '포트');
    numberInRange('port', '포트', 1, 65535);
    need('message', '메시지');
  }
  if (node.type === 'tits') need('triggerId', '트리거');
  if (node.type === 'vtube' && isBlank(cfg.hotkeyId) && isBlank(cfg.parameter)) {
    errors.push(`${label}: 핫키 또는 파라미터 중 하나가 필요합니다.`);
  }
  if (node.type === 'obs') {
    const action = String(cfg.action || 'scene.switch');
    if (!obsSupportedActions.has(action)) errors.push(`${label}: 지원하지 않는 OBS 동작입니다.`);
    if (obsSceneActions.has(action)) need('sceneName', '장면 이름');
    if (obsSceneSourceActions.has(action)) {
      need('sceneName', '장면 이름');
      need('sourceName', '소스 이름');
    }
    if (obsFilterActions.has(action)) {
      need('sourceName', '소스 이름');
      need('filterName', '필터 이름');
    }
    if (obsInputActions.has(action) || obsMediaActions.has(action)) need('sourceName', '소스/입력 이름');
    if (action === 'input.volume') numberInRange('volume', '볼륨', 0, 2);
    if (action === 'input.text' || action === 'stream.caption') need('text', '텍스트');
    if (action === 'input.settings' && !isBlank(cfg.inputSettingsJson)) {
      try {
        const parsed = JSON.parse(String(cfg.inputSettingsJson));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) errors.push(`${label}: 입력 설정 JSON은 객체여야 합니다.`);
      } catch {
        errors.push(`${label}: 입력 설정 JSON 형식이 올바르지 않습니다.`);
      }
    }
    if (action === 'hotkey.trigger') need('hotkeyName', '핫키');
    if (action === 'transition.set') need('transitionName', '전환 효과');
    if (action === 'transition.duration') numberInRange('durationMs', '전환 시간', 0);
  }
  if (node.type === 'approval') need('message', '승인 메시지');
  return errors;
}

function hasCycle(nodes: BlueprintNode[], edges: BlueprintEdge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const graph = new Map([...nodeIds].map((id) => [id, [] as string[]]));
  edges.forEach((edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) graph.get(edge.source)?.push(edge.target);
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of graph.get(id) || []) {
      if (visit(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...nodeIds].some((id) => visit(id));
}

function validateBlueprint(nodes: BlueprintNode[], edges: BlueprintEdge[]) {
  const errors: string[] = [];
  const startCount = nodes.filter((node) => node.type === 'start').length;
  if (startCount !== 1) errors.push('시작 노드는 반드시 1개여야 합니다.');
  const seenNodeIds = new Set<string>();
  nodes.forEach((node) => {
    if (!node.id) errors.push('ID가 없는 노드가 있습니다.');
    if (seenNodeIds.has(node.id)) errors.push(`중복된 노드 ID가 있습니다: ${node.id}`);
    seenNodeIds.add(node.id);
    errors.push(...requiredConfigErrors(node));
  });

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const outputKeys = new Set<string>();
  edges.forEach((edge) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) {
      errors.push('존재하지 않는 노드 연결이 있습니다.');
      return;
    }
    if (!outputPorts(source).includes(edge.sourcePort || 'out')) {
      errors.push(`${source.name}: 존재하지 않는 출력 포트가 연결되어 있습니다.`);
    }
    if (!inputPorts(target).includes(edge.targetPort || 'in')) {
      errors.push(`${target.name}: 존재하지 않는 입력 포트가 연결되어 있습니다.`);
    }
    const key = `${edge.source}:${edge.sourcePort || 'out'}`;
    if (!allowsMultipleOutgoing(source)) {
      if (outputKeys.has(key)) errors.push('하나의 출력 포트에서 여러 연결이 나갈 수 없습니다. 동시에 여러 노드를 실행하려면 다중 실행 노드를 사용하세요.');
      outputKeys.add(key);
    }
  });
  if (nodes.length && hasCycle(nodes, edges)) errors.push('순환 연결은 실행할 수 없습니다. 반복은 N회 반복 노드를 사용하세요.');
  return Array.from(new Set(errors));
}

function isDefaultStarterBlueprint(nodes: BlueprintNode[], edges: BlueprintEdge[]) {
  if (nodes.length !== 3 || edges.length !== 2) return false;
  const start = nodes.find((node) => node.type === 'start');
  const chat = nodes.find((node) => node.type === 'chat');
  const end = nodes.find((node) => node.type === 'end');
  if (!start || !chat || !end) return false;
  return edges.some((edge) => edge.source === start.id && edge.target === chat.id)
    && edges.some((edge) => edge.source === chat.id && edge.target === end.id);
}

function portLabel(port: string) {
  if (port === 'in') return '받기';
  if (port === 'out') return '계속';
  if (port === 'true') return '참';
  if (port === 'false') return '거짓';
  return port.replace(/^option:/, '');
}

function portTone(port: string) {
  if (port === 'false') return {
    accent: 'hsl(351 84% 58%)',
    edge: 'hsl(351 84% 58%)',
  };
  if (port === 'true') return {
    accent: 'hsl(158 64% 43%)',
    edge: 'hsl(158 64% 43%)',
  };
  if (port === 'in') return {
    accent: 'hsl(var(--primary))',
    edge: 'hsl(var(--primary))',
  };
  if (port.startsWith('option:')) return {
    accent: 'hsl(262 72% 58%)',
    edge: 'hsl(262 72% 58%)',
  };
  return {
    accent: 'hsl(202 82% 48%)',
    edge: 'hsl(202 82% 48%)',
  };
}

function portEdgeStroke(port: string) {
  return portTone(port).edge;
}

function nodeSpec(type: NodeType) {
  return nodeCatalog.find((item) => item.type === type) || nodeCatalog[0];
}

function toneClass(tone: (typeof nodeCatalog)[number]['tone']) {
  return {
    mint: {
      strip: 'from-emerald-300 via-teal-300 to-cyan-300 dark:from-emerald-500 dark:via-teal-500 dark:to-cyan-500',
      icon: 'bg-pastel-mint/85 text-teal-800 ring-teal-500/18 dark:bg-teal-400/18 dark:text-teal-300',
      soft: 'bg-pastel-mint/55 text-teal-900 dark:bg-teal-400/12 dark:text-teal-100',
    },
    sky: {
      strip: 'from-sky-300 via-cyan-300 to-teal-200 dark:from-sky-500 dark:via-cyan-500 dark:to-teal-500',
      icon: 'bg-pastel-sky/85 text-sky-800 ring-sky-500/18 dark:bg-sky-400/18 dark:text-sky-300',
      soft: 'bg-pastel-sky/55 text-sky-900 dark:bg-sky-400/12 dark:text-sky-100',
    },
    lemon: {
      strip: 'from-amber-200 via-yellow-200 to-lime-200 dark:from-amber-500 dark:via-yellow-500 dark:to-lime-500',
      icon: 'bg-pastel-lemon/90 text-amber-900 ring-amber-500/18 dark:bg-amber-400/18 dark:text-amber-300',
      soft: 'bg-pastel-lemon/60 text-amber-950 dark:bg-amber-400/12 dark:text-amber-100',
    },
    coral: {
      strip: 'from-rose-300 via-orange-200 to-amber-200 dark:from-rose-500 dark:via-orange-500 dark:to-amber-500',
      icon: 'bg-pastel-coral/85 text-rose-800 ring-rose-500/18 dark:bg-rose-400/18 dark:text-rose-300',
      soft: 'bg-pastel-coral/58 text-rose-900 dark:bg-rose-400/12 dark:text-rose-100',
    },
    cyan: {
      strip: 'from-cyan-300 via-sky-200 to-indigo-200 dark:from-cyan-400 dark:via-sky-500 dark:to-indigo-500',
      icon: 'bg-cyan-100 text-cyan-800 ring-cyan-500/18 dark:bg-cyan-400/14 dark:text-cyan-200 dark:ring-cyan-300/20',
      soft: 'bg-cyan-100/70 text-cyan-900 dark:bg-cyan-400/10 dark:text-cyan-100',
    },
    emerald: {
      strip: 'from-emerald-300 via-lime-200 to-teal-200 dark:from-emerald-400 dark:via-lime-500 dark:to-teal-500',
      icon: 'bg-emerald-100 text-emerald-800 ring-emerald-500/18 dark:bg-emerald-400/14 dark:text-emerald-200 dark:ring-emerald-300/20',
      soft: 'bg-emerald-100/70 text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-100',
    },
    amber: {
      strip: 'from-amber-300 via-orange-200 to-yellow-200 dark:from-amber-400 dark:via-orange-500 dark:to-yellow-500',
      icon: 'bg-amber-100 text-amber-900 ring-amber-500/18 dark:bg-amber-400/14 dark:text-amber-200 dark:ring-amber-300/20',
      soft: 'bg-amber-100/72 text-amber-950 dark:bg-amber-400/10 dark:text-amber-100',
    },
    violet: {
      strip: 'from-violet-300 via-fuchsia-200 to-sky-200 dark:from-violet-500 dark:via-fuchsia-500 dark:to-sky-500',
      icon: 'bg-violet-100 text-violet-800 ring-violet-500/18 dark:bg-violet-400/18 dark:text-violet-300',
      soft: 'bg-violet-100/70 text-violet-900 dark:bg-violet-400/12 dark:text-violet-100',
    },
    rose: {
      strip: 'from-pink-300 via-rose-200 to-orange-200 dark:from-pink-500 dark:via-rose-500 dark:to-orange-500',
      icon: 'bg-rose-100 text-rose-800 ring-rose-500/18 dark:bg-rose-400/18 dark:text-rose-300',
      soft: 'bg-rose-100/70 text-rose-900 dark:bg-rose-400/12 dark:text-rose-100',
    },
    neutral: {
      strip: 'from-slate-300 via-zinc-200 to-stone-200 dark:from-slate-500 dark:via-zinc-500 dark:to-stone-500',
      icon: 'bg-muted text-muted-foreground ring-border dark:bg-slate-400/12 dark:text-slate-300',
      soft: 'bg-muted/75 text-muted-foreground',
    },
  }[tone];
}

function paletteIconClass(item: (typeof nodeCatalog)[number]) {
  if (item.type === 'setVariable' || item.type === 'tits') {
    return 'bg-amber-100 text-amber-900 ring-amber-500/18 dark:bg-amber-950/55 dark:text-amber-300/75 dark:ring-amber-500/16';
  }
  if (item.type === 'readVariable' || item.type === 'vtube') {
    return 'bg-cyan-100 text-cyan-800 ring-cyan-500/18 dark:bg-sky-950/55 dark:text-sky-300/75 dark:ring-sky-500/16';
  }
  return toneClass(item.tone).icon;
}

function nodePreview(node: BlueprintNode) {
  if (node.type === 'condition' || node.type === 'rouletteCompare') return `${String(node.config.left || '')} ${String(node.config.operator || '')} ${String(node.config.right || '')}`.trim();
  if (node.type === 'chat') return String(node.config.message || '').slice(0, 54);
  if (node.type === 'tts') return String(node.config.text || '').slice(0, 54);
  if (node.type === 'wait') return `${String(node.config.seconds || 0)}초 대기`;
  if (node.type === 'loop') return `${String(node.config.count || 1)}회 반복`;
  if (node.type === 'parallel') return '출력 포트에 연결된 노드를 동시에 실행';
  if (node.type === 'http') return `${String(node.config.method || 'GET')} ${String(node.config.url || 'URL 미설정')}`;
  if (node.type === 'websocket') return String(node.config.url || 'WSS URL 미설정');
  if (node.type === 'udp') return `${String(node.config.host || '127.0.0.1')}:${String(node.config.port || '포트 미설정')}`;
  if (node.type === 'obs') {
    const parts = [String(node.config.action || 'scene.switch'), node.config.sceneName, node.config.sourceName, node.config.filterName]
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    return parts.join(' · ') || 'OBS 동작 미설정';
  }
  if (node.type === 'overlay' || node.type === 'rouletteDisplay') return String(node.config.text || '표시 내용 미설정').slice(0, 54);
  if (node.type === 'overlayUpdate') return `${String(node.config.overlayId || '오버레이 ID 미설정')} · 수정`;
  if (node.type === 'overlayHide') return `${String(node.config.overlayId || '오버레이 ID 미설정')} · 숨김`;
  if (node.type === 'pointsGet') return `${String(node.config.userId || '{user.userId}')} 포인트 조회`;
  if (node.type === 'pointsAdjust') return `${String(node.config.delta || 0)} 포인트`;
  if (node.type === 'pointsRanking') return `상위 ${String(node.config.limit || 10)}명`;
  if (node.type === 'attendanceGet') return `${String(node.config.userId || '{user.userId}')} 출석 조회`;
  if (node.type === 'rouletteRun') return String(node.config.name || '룰렛 미선택');
  if (node.type === 'action') return String(node.config.actionId || '블루프린트 미선택');
  if (node.type === 'approval') return String(node.config.message || '승인 메시지 미설정').slice(0, 54);
  if (node.type === 'log' || node.type === 'highlight') return String(node.config.message || node.config.label || '로그 내용 미설정').slice(0, 54);
  if (node.type === 'fx') return `${String(node.config.kind || '종류 미지정')} · ${String(node.config.assetName || node.config.assetId || node.config.youtubeUrl || '에셋 미선택')}`;
  if (node.type === 'sound') return String(node.config.fileId || '사운드 미선택');
  if (node.type === 'tits') return String(node.config.triggerName || node.config.triggerId || '트리거 미선택');
  if (node.type === 'vtube') {
    const hotkey = String(node.config.hotkeyName || node.config.hotkeyId || '').trim();
    const parameter = String(node.config.parameter || '').trim();
    if (hotkey && parameter) return `${hotkey} · ${parameter}`;
    return hotkey || parameter || '핫키/파라미터 미선택';
  }
  return node.type;
}

function nodeOutputHints(node: Pick<BlueprintNode, 'id' | 'type'>) {
  const prefix = `{node.${node.id}.`;
  const byType: Partial<Record<NodeType, string[]>> = {
    start: ['context}'],
    chat: ['sent}', 'platform}', 'text}'],
    wait: ['waitedMs}'],
    timer: ['delayMs}', 'queued}'],
    condition: ['passed}', 'left}', 'right}'],
    cooldown: ['passed}', 'remainingMs}'],
    pointsGet: ['points}', 'userId}', 'channelUid}'],
    pointsEnough: ['passed}', 'points}', 'required}'],
    pointsAdjust: ['points}', 'delta}', 'previous}'],
    pointsRanking: ['ranking}'],
    pointsExcluded: ['excluded}'],
    attendanceGet: ['totalDays}', 'userId}'],
    rouletteList: ['roulettes}'],
    rouletteRun: ['result.label}', 'result.value}', 'roulette.name}'],
    rouletteCompare: ['passed}', 'left}', 'right}'],
    rouletteDisplay: ['overlayId}', 'shown}'],
    overlay: ['overlayId}', 'shown}'],
    overlayUpdate: ['overlayId}', 'updated}'],
    overlayHide: ['overlayId}', 'hidden}'],
    tts: ['spoken}', 'voice}', 'queued}'],
    fx: ['queued}', 'jobId}', 'payload.id}'],
    sound: ['queued}', 'jobId}'],
    http: ['queued}', 'jobId}'],
    websocket: ['queued}', 'jobId}'],
    udp: ['queued}', 'jobId}'],
    obs: ['queued}', 'jobId}'],
    tits: ['queued}', 'jobId}'],
    vtube: ['queued}', 'jobId}'],
    random: ['picked.label}', 'picked.id}'],
    parallel: ['results}', 'count}'],
    loop: ['count}'],
    action: ['ok}', 'result}'],
    approval: ['approvalRequired}', 'jobId}'],
    highlight: ['marked}', 'label}'],
    log: ['message}', 'at}'],
    readVariable: ['value}'],
    setVariable: ['key}', 'value}'],
    join: ['joined}'],
  };
  return (byType[node.type] || ['status}']).map((suffix) => `${prefix}${suffix}`);
}

const outputHintDescriptions: Record<string, { title: string; description: string }> = {
  context: { title: '실행 컨텍스트', description: '명령어, 후원, 테스트 실행 등 액션이 시작된 전체 상황입니다.' },
  sent: { title: '전송 여부', description: '채팅 메시지를 실제 플랫폼으로 전송했는지 나타냅니다.' },
  platform: { title: '플랫폼', description: '이 노드가 대상으로 삼은 플랫폼 이름입니다.' },
  text: { title: '텍스트', description: '노드가 전송하거나 표시한 최종 문구입니다.' },
  waitedMs: { title: '대기 시간', description: '대기 노드가 기다린 밀리초 값입니다.' },
  delayMs: { title: '예약 시간', description: '예약 또는 타이머로 밀린 시간입니다.' },
  queued: { title: '대기열 등록', description: '로컬 프로그램 또는 오버레이 작업 대기열에 들어갔는지 나타냅니다.' },
  passed: { title: '조건 결과', description: '조건, 비교, 충분 여부 확인의 true/false 결과입니다.' },
  left: { title: '좌변 값', description: '조건 비교에 사용된 왼쪽 값입니다.' },
  right: { title: '우변 값', description: '조건 비교에 사용된 오른쪽 값입니다.' },
  remainingMs: { title: '남은 시간', description: '쿨다운 등에서 아직 기다려야 하는 밀리초 값입니다.' },
  points: { title: '포인트', description: '조회 또는 변경 후의 시청자 포인트입니다.' },
  userId: { title: '시청자 ID', description: '포인트, 출석, 실행 대상이 된 시청자 식별자입니다.' },
  channelUid: { title: '채널 ID', description: '포인트와 출석이 집계되는 방송 채널 식별자입니다.' },
  required: { title: '필요 포인트', description: '조건을 통과하기 위해 필요했던 포인트입니다.' },
  delta: { title: '변경량', description: '포인트 지급 또는 차감에 사용된 값입니다.' },
  previous: { title: '이전 포인트', description: '포인트 변경 전의 보유 포인트입니다.' },
  ranking: { title: '랭킹 목록', description: '포인트 랭킹 조회 결과 배열입니다.' },
  excluded: { title: '제외 여부', description: '포인트 적립 제외 대상인지 나타냅니다.' },
  totalDays: { title: '누적 출석일', description: '시청자의 누적 출석일입니다.' },
  roulettes: { title: '룰렛 목록', description: '실행 가능한 룰렛 목록입니다.' },
  'result.label': { title: '룰렛 결과 이름', description: '당첨된 룰렛 항목의 표시 이름입니다.' },
  'result.value': { title: '룰렛 결과 값', description: '당첨된 룰렛 항목에 설정된 값입니다.' },
  'roulette.name': { title: '룰렛 이름', description: '실행된 룰렛의 이름입니다.' },
  overlayId: { title: '오버레이 ID', description: '표시, 수정, 숨김에 사용할 오버레이 식별자입니다.' },
  shown: { title: '표시 여부', description: '오버레이가 화면에 표시됐는지 나타냅니다.' },
  updated: { title: '수정 여부', description: '오버레이 내용이나 상태가 수정됐는지 나타냅니다.' },
  hidden: { title: '숨김 여부', description: '오버레이가 숨겨졌는지 나타냅니다.' },
  spoken: { title: 'TTS 재생 여부', description: 'TTS가 오버레이에서 재생됐는지 나타냅니다.' },
  voice: { title: '목소리', description: 'TTS에 사용된 브라우저 음성 이름입니다.' },
  jobId: { title: '작업 ID', description: '로컬 프로그램이 처리할 자동화 작업 ID입니다.' },
  'payload.id': { title: '페이로드 ID', description: 'FX, 오버레이 등 화면 효과 작업의 식별자입니다.' },
  'picked.label': { title: '랜덤 선택 이름', description: '랜덤 분기에서 선택된 항목 이름입니다.' },
  'picked.id': { title: '랜덤 선택 ID', description: '랜덤 분기에서 선택된 출력 포트 ID입니다.' },
  results: { title: '병렬 실행 결과', description: '다중 실행 노드에서 동시에 실행한 하위 노드들의 결과입니다.' },
  count: { title: '개수', description: '반복 횟수 또는 병렬 실행 대상 개수입니다.' },
  ok: { title: '성공 여부', description: '다른 블루프린트 실행 결과의 성공 여부입니다.' },
  result: { title: '실행 결과', description: '다른 블루프린트에서 반환된 결과입니다.' },
  approvalRequired: { title: '승인 필요', description: '관리자 확인이 필요한 상태인지 나타냅니다.' },
  marked: { title: '마킹 여부', description: '레거시 하이라이트 마커가 처리됐는지 나타냅니다.' },
  label: { title: '라벨', description: '선택, 결과, 마커 등에 붙은 표시 이름입니다.' },
  message: { title: '메시지', description: '로그 또는 승인 요청에 남긴 문구입니다.' },
  at: { title: '기록 시각', description: '로그가 남겨진 ISO 시각입니다.' },
  value: { title: '값', description: '읽거나 저장한 임시 변수 값입니다.' },
  key: { title: '키', description: '저장한 임시 변수 이름입니다.' },
  joined: { title: '합류 여부', description: '레거시 흐름 합류 노드 처리 여부입니다.' },
  status: { title: '상태', description: '노드 실행 상태입니다.' },
};

function nodeOutputDetails(node: Pick<BlueprintNode, 'id' | 'type'>) {
  return nodeOutputHints(node).map((value) => {
    const match = value.match(/\.([^.]*(?:\.[^.]*)?)}$/);
    const key = match?.[1] || 'status';
    const fallback = outputHintDescriptions[key.split('.').slice(-1)[0]] || outputHintDescriptions.status;
    return {
      value,
      title: outputHintDescriptions[key]?.title || fallback.title,
      description: outputHintDescriptions[key]?.description || fallback.description,
    };
  });
}

function normalizeBlueprint(payload?: Blueprint | null) {
  if (!payload) {
    const nodes = defaultNodes();
    return {
      name: '새 실행 액션',
      description: '',
      enabled: true,
      version: { nodes, edges: defaultEdges(nodes), viewport: DEFAULT_VIEWPORT, published: false },
    } satisfies Blueprint;
  }
  return {
    ...payload,
    version: {
      ...(payload.version || {}),
      nodes: payload.version?.nodes?.length ? payload.version.nodes.map(normalizeNodeName) : defaultNodes(),
      edges: payload.version?.edges || [],
      viewport: payload.version?.viewport || DEFAULT_VIEWPORT,
    },
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isKnownNodeType(type: unknown): type is NodeType {
  return nodeCatalog.some((item) => item.type === type);
}

function normalizePosition(position: unknown, fallback: { x: number; y: number }) {
  const source = position && typeof position === 'object' ? position as { x?: unknown; y?: unknown } : {};
  const x = Number(source.x);
  const y = Number(source.y);
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
  };
}

function normalizeViewport(viewport: unknown): Viewport {
  const source = viewport && typeof viewport === 'object' ? viewport as { x?: unknown; y?: unknown; zoom?: unknown } : {};
  const x = Number(source.x);
  const y = Number(source.y);
  const zoom = Number(source.zoom);
  return {
    x: Number.isFinite(x) ? x : DEFAULT_VIEWPORT.x,
    y: Number.isFinite(y) ? y : DEFAULT_VIEWPORT.y,
    zoom: Number.isFinite(zoom) ? Math.max(0.45, Math.min(1.8, zoom)) : DEFAULT_VIEWPORT.zoom,
  };
}

function normalizeImportedNodes(rawNodes: unknown, fallbackToDefault = true) {
  if (!Array.isArray(rawNodes)) return fallbackToDefault ? defaultNodes() : [];
  const nodes = rawNodes.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const source = raw as Partial<BlueprintNode>;
    if (!isKnownNodeType(source.type)) return [];
    return [{
      id: String(source.id || createId(source.type)),
      type: source.type,
      name: String(source.type === 'action' && source.name === '특수 변수 실행' ? nodeSpec(source.type).title : source.name || nodeSpec(source.type).title),
      position: normalizePosition(source.position, { x: index * 22, y: 3 }),
      enabled: source.enabled !== false,
      config: source.config && typeof source.config === 'object' ? cloneJson(source.config) : cloneJson(nodeSpec(source.type).config),
    } satisfies BlueprintNode];
  });
  return nodes.length ? nodes : fallbackToDefault ? defaultNodes() : [];
}

function normalizeImportedEdges(rawEdges: unknown, nodes: BlueprintNode[]) {
  if (!Array.isArray(rawEdges)) return [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return rawEdges.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const source = raw as Partial<BlueprintEdge>;
    const sourceNode = nodeMap.get(String(source.source || ''));
    const targetNode = nodeMap.get(String(source.target || ''));
    const sourcePort = String(source.sourcePort || 'out');
    const targetPort = String(source.targetPort || 'in');
    if (!sourceNode || !targetNode) return [];
    if (!outputPorts(sourceNode).includes(sourcePort) || !inputPorts(targetNode).includes(targetPort)) return [];
    return [{
      id: String(source.id || createId('edge')),
      source: sourceNode.id,
      sourcePort,
      target: targetNode.id,
      targetPort,
    } satisfies BlueprintEdge];
  });
}

function normalizeImportedBlueprint(payload: unknown): Blueprint | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as { schema?: unknown; blueprint?: unknown; version?: unknown; name?: unknown; description?: unknown; enabled?: unknown; slug?: unknown };
  const imported = root.schema === BLUEPRINT_EXPORT_SCHEMA && root.blueprint && typeof root.blueprint === 'object'
    ? root.blueprint as typeof root
    : root.blueprint && typeof root.blueprint === 'object'
      ? root.blueprint as typeof root
      : root;
  const version = imported.version && typeof imported.version === 'object' ? imported.version as { nodes?: unknown; edges?: unknown; viewport?: unknown } : {};
  const nodes = normalizeImportedNodes(version.nodes);
  const edges = normalizeImportedEdges(version.edges, nodes);
  const name = String(imported.name || '가져온 블루프린트').trim() || '가져온 블루프린트';
  return {
    name: `${name} 복사`,
    slug: '',
    description: typeof imported.description === 'string' ? imported.description : '',
    enabled: imported.enabled !== false,
    version: {
      nodes,
      edges,
      viewport: normalizeViewport(version.viewport),
      published: false,
    },
  };
}

function safeJsonFilename(name: string) {
  const normalized = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80);
  return `${normalized || 'arubot-blueprint'}.json`;
}

function buildBlueprintExport(blueprint: Blueprint, nodes: BlueprintNode[], edges: BlueprintEdge[], viewport: Viewport): BlueprintExport {
  return {
    schema: BLUEPRINT_EXPORT_SCHEMA,
    version: 1,
    exportedAt: new Date().toISOString(),
    blueprint: {
      name: blueprint.name,
      slug: blueprint.slug || '',
      description: blueprint.description || '',
      enabled: blueprint.enabled !== false,
      version: {
        nodes: cloneJson(nodes),
        edges: cloneJson(edges),
        viewport,
      },
    },
  };
}

function serializeBlueprintSnapshot(blueprint: Blueprint) {
  return JSON.stringify({
    name: blueprint.name,
    slug: blueprint.slug || '',
    description: blueprint.description || '',
    enabled: blueprint.enabled !== false,
    version: {
      nodes: blueprint.version?.nodes || [],
      edges: blueprint.version?.edges || [],
      viewport: blueprint.version?.viewport || DEFAULT_VIEWPORT,
    },
  });
}

function restoreBlueprintSnapshot(snapshot: string): Blueprint {
  const parsed = JSON.parse(snapshot) as Blueprint;
  const nodes = normalizeImportedNodes(parsed.version?.nodes);
  return normalizeBlueprint({
    name: String(parsed.name || '새 실행 액션'),
    slug: parsed.slug || '',
    description: parsed.description || '',
    enabled: parsed.enabled !== false,
    version: {
      nodes,
      edges: normalizeImportedEdges(parsed.version?.edges, nodes),
      viewport: normalizeViewport(parsed.version?.viewport),
      published: false,
    },
  });
}

async function jsonRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'request_failed');
  return data as T;
}

function nodeHeightPx(node: BlueprintNode) {
  const outputCount = outputPorts(node).length;
  const extraRows = Math.max(0, outputCount - 2);
  return Math.max(NODE_MIN_HEIGHT, (NODE_SIZE.height + extraRows * (PORT_CHIP_HEIGHT + PORT_CHIP_GAP)) * FLOW_UNIT);
}

function BlueprintPortHandle({
  port,
  kind,
  index,
  total,
  nodeHeight,
}: {
  port: string;
  kind: 'input' | 'output';
  index: number;
  total: number;
  nodeHeight: number;
}) {
  const tone = portTone(kind === 'input' ? 'in' : port);
  const label = portLabel(kind === 'input' ? 'in' : port);
  const top = kind === 'input'
    ? 0.9 + index * (PORT_CHIP_HEIGHT + PORT_CHIP_GAP)
    : nodeHeight / FLOW_UNIT - PORT_CHIP_BOTTOM - (total - 1 - index) * (PORT_CHIP_HEIGHT + PORT_CHIP_GAP) - PORT_CHIP_HEIGHT;
  const sideStyle = kind === 'input'
    ? { left: `${PORT_CHIP_SIDE}rem`, right: 'auto' }
    : { left: 'auto', right: `${PORT_CHIP_SIDE}rem` };
  const handleStyle = {
    ...sideStyle,
    top: `${top}rem`,
    transform: 'none',
    background: `color-mix(in srgb, ${tone.accent} 12%, hsl(var(--card)) 88%)`,
    borderColor: `color-mix(in srgb, ${tone.accent} 44%, hsl(var(--border)) 56%)`,
    color: `color-mix(in srgb, ${tone.accent} 74%, hsl(var(--foreground)) 26%)`,
    '--port-accent': tone.accent,
  } as CSSProperties;
  return (
    <Handle
      id={port}
      type={kind === 'input' ? 'target' : 'source'}
      position={kind === 'input' ? Position.Left : Position.Right}
      title={`${kind === 'input' ? '입력' : '출력'}: ${label}`}
      aria-label={`${kind === 'input' ? '입력' : '출력'} 포트 ${label}`}
      className={cn(
        'arubot-blueprint-port nodrag nowheel !absolute !z-40 !flex !h-[1.55rem] !min-w-[4.25rem] !items-center !gap-1.5 !rounded-full !border !px-2 !text-[0.63rem] !font-extrabold !opacity-100 !shadow-subtle !backdrop-blur-xl transition hover:!scale-[1.04]',
        'before:!absolute before:!inset-[-0.28rem] before:!rounded-full before:!content-[""]',
        kind === 'input' ? '!justify-start' : '!justify-end',
      )}
      style={handleStyle}
    >
      {kind === 'input' ? <span className="relative z-10 h-2 w-2 rounded-full" style={{ backgroundColor: tone.accent }} /> : null}
      <span className="relative z-10 min-w-0 truncate">{label}</span>
      {kind === 'output' ? <span className="relative z-10 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone.accent }} /> : null}
    </Handle>
  );
}

function BlueprintCanvasNode({ data, selected }: NodeProps<BlueprintFlowNode>) {
  const { node, active, latestStep } = data;
  const spec = nodeSpec(node.type);
  const Icon = spec.icon;
  const ins = inputPorts(node);
  const outs = outputPorts(node);
  const tone = toneClass(spec.tone);
  const statusTone = latestStep?.status === 'failed' ? 'bg-destructive' : active ? 'bg-primary' : latestStep?.status === 'done' ? 'bg-emerald-500' : node.enabled === false ? 'bg-muted-foreground' : 'bg-primary/65';
  const nodeHeight = nodeHeightPx(node);
  const outputHintCount = nodeOutputHints(node).length;
  return (
    <div
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        window.dispatchEvent(new CustomEvent('arubot-blueprint-node-context', {
          detail: { nodeId: node.id, x: event.clientX, y: event.clientY },
        }));
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        window.dispatchEvent(new CustomEvent('arubot-blueprint-node-edit', {
          detail: { nodeId: node.id },
        }));
      }}
      className={cn(
        'group/blueprint-node relative select-none overflow-visible rounded-[calc(var(--radius-card)*0.92)] border bg-card/96 shadow-subtle backdrop-blur-xl transition duration-200',
        'hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lift',
        selected && 'border-primary/55 ring-2 ring-primary/35 shadow-lift',
        active && 'scale-[1.025] border-primary/65 bg-pastel-sky/75 ring-4 ring-primary/18 shadow-lift',
        latestStep?.status === 'done' && 'border-primary/45',
        latestStep?.status === 'failed' && 'border-destructive/70 ring-2 ring-destructive/30',
        node.enabled === false && 'opacity-55',
      )}
      style={{ width: `${NODE_WIDTH}px`, minHeight: `${nodeHeight}px` }}
    >
      <div className={cn('h-[max(0.25rem,0.26vw)] rounded-t-[calc(var(--radius-card)*0.92)] bg-[linear-gradient(90deg,var(--tw-gradient-stops))]', tone.strip)} />
      <div className="grid gap-3 p-[clamp(0.75rem,1.1vw,0.875rem)] pb-[3.35rem] pt-[2.85rem]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className={cn('grid aspect-square w-[2.15rem] shrink-0 place-items-center rounded-[calc(var(--radius-control)*0.82)] ring-1', tone.icon)}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[0.78rem] font-extrabold leading-tight text-foreground">{node.name}</span>
              <span className="mt-0.5 block truncate text-[0.66rem] font-semibold text-muted-foreground">{spec.group} · {spec.title}</span>
              <span className="mt-1 block truncate font-mono text-[0.58rem] font-bold text-muted-foreground/80">ID {node.id}</span>
            </span>
          </div>
          <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_0_0.25rem_hsl(var(--background)/0.88)]', statusTone)} />
        </div>
        <div className={cn('rounded-[calc(var(--radius-control)*0.82)] px-2.5 py-2 text-[0.69rem] font-semibold leading-5', tone.soft)}>
          <span className="line-clamp-2">{nodePreview(node) || spec.body}</span>
        </div>
        {latestStep ? (
          <div className="grid gap-1 rounded-[calc(var(--radius-control)*0.8)] border bg-background/72 px-2.5 py-1.5 text-[0.66rem] font-bold text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <span>{latestStep.status || 'done'}</span>
              <span>{latestStep.durationMs ?? 0}ms</span>
            </div>
            {outputHintCount ? <span className="text-[0.58rem] text-muted-foreground/80">출력 변수 {outputHintCount}개</span> : null}
          </div>
        ) : outputHintCount ? (
          <div className="grid gap-1 text-[0.64rem] font-semibold text-muted-foreground">
            <span className="truncate">{spec.body}</span>
            <span className="text-[0.58rem]">출력 변수 {outputHintCount}개</span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 text-[0.66rem] font-semibold text-muted-foreground">
            <span className="truncate">{spec.body}</span>
            <span>{outs.length ? `${outs.length}개 출력` : '마지막'}</span>
          </div>
        )}
      </div>
      {ins.map((port, index) => (
        <BlueprintPortHandle key={`input-${port}`} port={port} kind="input" index={index} total={ins.length} nodeHeight={nodeHeight} />
      ))}
      {outs.map((port, index) => (
        <BlueprintPortHandle key={`output-${port}`} port={port} kind="output" index={index} total={outs.length} nodeHeight={nodeHeight} />
      ))}
    </div>
  );
}

const flowNodeTypes = { blueprintNode: BlueprintCanvasNode };

export function ActionBlueprintPage() {
  const flowWrapperRef = useRef<HTMLDivElement | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<BlueprintFlowNode, BlueprintFlowEdge> | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const historyPastRef = useRef<string[]>([]);
  const historyFutureRef = useRef<string[]>([]);
  const lastSnapshotRef = useRef('');
  const persistedSnapshotRef = useRef('');
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingHistoryRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectEdgeRef = useRef<{ edgeId: string; handleType: 'source' | 'target' | null; completed: boolean } | null>(null);
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [blueprint, setBlueprint] = useState<Blueprint>(() => normalizeBlueprint(null));
  const [automationOverview, setAutomationOverview] = useState<AutomationOverview | null>(null);
  const [runs, setRuns] = useState<BlueprintRun[]>([]);
  const [versions, setVersions] = useState<BlueprintVersion[]>([]);
  const [runSteps, setRunSteps] = useState<BlueprintRunStep[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<BlueprintContextMenu | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [clipboard, setClipboard] = useState<BlueprintClipboard | null>(null);
  const [pasteCount, setPasteCount] = useState(0);
  const [historyCount, setHistoryCount] = useState({ past: 0, future: 0 });
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saved' | 'restored'>('idle');
  const [activeRunNodeId, setActiveRunNodeId] = useState<string | null>(null);
  const [automationBusy, setAutomationBusy] = useState<string | null>(null);
  const [simulator, setSimulator] = useState({
    platform: 'chzzk',
    username: '테스트 시청자',
    userId: 'test_viewer',
    points: '3000',
    message: '!테스트',
    rouletteResult: '당첨',
    donationAmount: '1000',
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [isPending, startTransition] = useTransition();

  const nodes = useMemo(() => blueprint.version?.nodes || [], [blueprint.version?.nodes]);
  const edges = useMemo(() => blueprint.version?.edges || [], [blueprint.version?.edges]);
  const viewport = blueprint.version?.viewport || DEFAULT_VIEWPORT;
  const [liveViewport, setLiveViewport] = useState<Viewport>(viewport);
  const selectedNode = selectedIds.length === 1 ? nodes.find((node) => node.id === selectedIds[0]) || null : null;
  const editingNode = editingNodeId ? nodes.find((node) => node.id === editingNodeId) || null : null;
  const validationErrors = useMemo(() => {
    return validateBlueprint(nodes, edges);
  }, [edges, nodes]);
  const latestStepByNodeId = useMemo(() => {
    const map = new Map<string, BlueprintRunStep>();
    for (let index = runSteps.length - 1; index >= 0; index -= 1) {
      const step = runSteps[index];
      if (step.nodeId && !map.has(step.nodeId)) map.set(step.nodeId, step);
    }
    return map;
  }, [runSteps]);
  const flowNodes = useMemo<BlueprintFlowNode[]>(() => {
    return nodes.map((node) => ({
      ...(() => {
        const height = nodeHeightPx(node);
        return {
          initialHeight: height,
          height,
        };
      })(),
      id: node.id,
      type: 'blueprintNode',
      position: { x: node.position.x * FLOW_UNIT, y: node.position.y * FLOW_UNIT },
      initialWidth: NODE_WIDTH,
      width: NODE_WIDTH,
      selected: selectedIds.includes(node.id),
      draggable: node.type !== 'start',
      data: {
        node,
        active: activeRunNodeId === node.id,
        latestStep: latestStepByNodeId.get(node.id),
      },
    }));
  }, [activeRunNodeId, latestStepByNodeId, nodes, selectedIds]);
  const flowEdges = useMemo<BlueprintFlowEdge[]>(() => {
    return edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourcePort || 'out',
      targetHandle: edge.targetPort || 'in',
      type: 'default',
      selected: selectedEdgeId === edge.id,
      data: { sourcePort: edge.sourcePort || 'out', targetPort: edge.targetPort || 'in' },
      style: {
        stroke: selectedEdgeId === edge.id
          ? 'hsl(var(--primary))'
          : portEdgeStroke(edge.sourcePort || 'out'),
        strokeWidth: selectedEdgeId === edge.id ? 4 : 2.5,
      },
    }));
  }, [edges, selectedEdgeId]);

  const filteredCatalog = useMemo(() => {
    const term = paletteQuery.trim().toLowerCase();
    return nodeCatalog.filter((item) => !item.hidden && (!term || `${item.title} ${item.body} ${item.group}`.toLowerCase().includes(term)));
  }, [paletteQuery]);
  const catalogGroups = useMemo(() => {
    const groups = new Map<string, typeof filteredCatalog>();
    filteredCatalog.forEach((item) => {
      groups.set(item.group, [...(groups.get(item.group) || []), item]);
    });
    return [...groups.entries()];
  }, [filteredCatalog]);
  const automationConnections = useMemo(() => automationOverview?.connections || [], [automationOverview?.connections]);
  const titsConnection = useMemo(() => automationConnections.find((item) => item.type === 'tits') || null, [automationConnections]);
  const vtubeConnection = useMemo(() => automationConnections.find((item) => item.type === 'vtube_studio') || null, [automationConnections]);
  const obsConnection = useMemo(() => automationConnections.find((item) => item.type === 'obs') || null, [automationConnections]);
  const zoomLabel = Math.round((liveViewport.zoom || 1) * 100);

  const updateBlueprint = useCallback((updater: (current: Blueprint) => Blueprint) => {
    setBlueprint((current) => updater({
      ...current,
      version: {
        ...(current.version || {}),
        nodes: current.version?.nodes || [],
        edges: current.version?.edges || [],
        viewport: current.version?.viewport || DEFAULT_VIEWPORT,
      },
    }));
  }, []);

  const syncFlowViewport = useCallback((nextViewport: Viewport) => {
    setLiveViewport(nextViewport);
    void flowInstanceRef.current?.setViewport(nextViewport);
  }, []);

  const load = useCallback(() => {
    startTransition(async () => {
      const [data, automationData] = await Promise.all([
        readJson<{ blueprints?: Blueprint[] }>('/api/action-blueprints'),
        readJson<AutomationOverview>('/api/automations/overview').catch(() => null),
      ]);
      setAutomationOverview(automationData);
      const list = data?.blueprints || [];
      setBlueprints(list);
      if (list.length) {
        const nextBlueprint = normalizeBlueprint(list[0]);
        setBlueprint(nextBlueprint);
        syncFlowViewport(nextBlueprint.version?.viewport || DEFAULT_VIEWPORT);
        historyPastRef.current = [];
        historyFutureRef.current = [];
        lastSnapshotRef.current = serializeBlueprintSnapshot(nextBlueprint);
        persistedSnapshotRef.current = serializeBlueprintSnapshot(nextBlueprint);
        setHistoryCount({ past: 0, future: 0 });
        const [runData, versionData] = await Promise.all([
          readJson<{ runs?: BlueprintRun[] }>(`/api/action-blueprints/${encodeURIComponent(list[0].id || '')}/runs`),
          readJson<{ versions?: BlueprintVersion[] }>(`/api/action-blueprints/${encodeURIComponent(list[0].id || '')}/versions`),
        ]);
        setRuns(runData?.runs || []);
        setVersions(versionData?.versions || []);
      }
    });
  }, [syncFlowViewport]);

  const refreshAutomationOverview = useCallback(async () => {
    const data = await readJson<AutomationOverview>('/api/automations/overview').catch(() => null);
    setAutomationOverview(data);
    return data;
  }, []);

  const ensureAutomationConnection = useCallback(async (type: 'tits' | 'vtube' | 'obs') => {
    const existing = type === 'tits' ? titsConnection : type === 'vtube' ? vtubeConnection : obsConnection;
    if (existing) return existing;
    const data = await jsonRequest<{ connection: AutomationConnection }>('/api/automations/connections', 'POST', {
      type: type === 'tits' ? 'tits' : type === 'vtube' ? 'vtube_studio' : 'obs',
      name: type === 'tits' ? 'T.I.T.S.' : type === 'vtube' ? 'VTube Studio' : 'OBS Studio',
      executionMode: 'local',
      endpoint: type === 'tits' ? 'ws://localhost:42069' : type === 'vtube' ? 'ws://localhost:8001' : 'ws://localhost:4455',
    });
    await refreshAutomationOverview();
    return data.connection;
  }, [obsConnection, refreshAutomationOverview, titsConnection, vtubeConnection]);

  const discoverAutomation = useCallback(async (type: 'tits' | 'vtube' | 'obs') => {
    const busyKey = `${type}.discover`;
    setAutomationBusy(busyKey);
    try {
      const connection = await ensureAutomationConnection(type);
      const endpoint = connection.endpoint || (type === 'tits' ? 'ws://localhost:42069' : type === 'vtube' ? 'ws://localhost:8001' : 'ws://localhost:4455');
      const data = await jsonRequest<{ queued?: boolean; discovery?: AutomationDiscoveryCache; message?: string }>(
        type === 'tits' ? '/api/automations/tits/discover' : type === 'vtube' ? '/api/automations/vtube/discover' : '/api/automations/obs/discover',
        'POST',
        {
          executionMode: 'local',
          endpoint,
          connectionId: connection.id,
          name: type === 'tits' ? 'T.I.T.S.' : type === 'vtube' ? 'VTube Studio' : 'OBS Studio',
          sendImage: type === 'tits',
        },
      );
      toast.success(data.queued ? (data.message || '로컬 프로그램으로 목록을 불러오도록 요청했습니다.') : '로컬 프로그램 목록을 불러왔습니다.');
      await refreshAutomationOverview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '로컬 프로그램 목록을 불러오지 못했습니다.');
    } finally {
      setAutomationBusy(null);
    }
  }, [ensureAutomationConnection, refreshAutomationOverview]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const snapshot = serializeBlueprintSnapshot(blueprint);
    if (!lastSnapshotRef.current || applyingHistoryRef.current) {
      lastSnapshotRef.current = snapshot;
      applyingHistoryRef.current = false;
      return;
    }
    if (snapshot === lastSnapshotRef.current) return;
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      historyPastRef.current = [...historyPastRef.current.slice(-59), lastSnapshotRef.current];
      historyFutureRef.current = [];
      lastSnapshotRef.current = snapshot;
      setHistoryCount({ past: historyPastRef.current.length, future: 0 });
    }, 450);
    return () => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    };
  }, [blueprint]);

  useEffect(() => {
    if (!historyPastRef.current.length && draftStatus !== 'restored') return;
    const payload = buildBlueprintExport(blueprint, nodes, edges, viewport);
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
        setDraftStatus('saved');
      } catch {
        setDraftStatus('idle');
      }
    }, 900);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [blueprint, draftStatus, edges, nodes, viewport]);

  useEffect(() => () => {
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
  }, []);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = (event?: Event) => {
      const target = event?.target as HTMLElement | null;
      if (target?.closest('[data-blueprint-context-menu="true"]')) return;
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    const element = flowWrapperRef.current;
    if (!element) return undefined;
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const nodeElement = target?.closest('.react-flow__node') as HTMLElement | null;
      const nodeId = nodeElement?.getAttribute('data-id');
      if (nodeId && nodes.some((node) => node.id === nodeId)) {
        setSelectedIds([nodeId]);
        setSelectedEdgeId(null);
        setContextMenu({ kind: 'node', nodeId, x: event.clientX, y: event.clientY });
        return;
      }
      const flowPosition = flowInstanceRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setSelectedIds([]);
      setSelectedEdgeId(null);
      setContextMenu({
        kind: 'pane',
        x: event.clientX,
        y: event.clientY,
        flowPosition: flowPosition ? { x: flowPosition.x / FLOW_UNIT, y: flowPosition.y / FLOW_UNIT } : undefined,
      });
    };
    element.addEventListener('contextmenu', handleContextMenu, true);
    return () => element.removeEventListener('contextmenu', handleContextMenu, true);
  }, [nodes]);

  useEffect(() => {
    const handleNodeContext = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string; x?: number; y?: number }>).detail;
      const nodeId = detail?.nodeId;
      if (!nodeId || !nodes.some((node) => node.id === nodeId)) return;
      setSelectedIds([nodeId]);
      setSelectedEdgeId(null);
      setContextMenu({ kind: 'node', nodeId, x: detail.x || 0, y: detail.y || 0 });
    };
    const handleNodeEdit = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string }>).detail;
      const nodeId = detail?.nodeId;
      if (!nodeId || !nodes.some((node) => node.id === nodeId)) return;
      setSelectedIds([nodeId]);
      setSelectedEdgeId(null);
      setEditingNodeId(nodeId);
      setContextMenu(null);
    };
    window.addEventListener('arubot-blueprint-node-context', handleNodeContext);
    window.addEventListener('arubot-blueprint-node-edit', handleNodeEdit);
    return () => {
      window.removeEventListener('arubot-blueprint-node-context', handleNodeContext);
      window.removeEventListener('arubot-blueprint-node-edit', handleNodeEdit);
    };
  }, [nodes]);

  const addNode = (type: NodeType) => {
    const rect = flowWrapperRef.current?.getBoundingClientRect();
    const center = rect
      ? flowInstanceRef.current?.screenToFlowPosition({ x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 }) || { x: 320, y: 220 }
      : { x: 320, y: 220 };
    const position = { x: center.x / FLOW_UNIT, y: center.y / FLOW_UNIT };
    const node = createNode(type, position);
    if (type === 'start' && nodes.some((item) => item.type === 'start')) {
      toast.info('시작 노드는 블루프린트마다 1개만 사용할 수 있습니다.');
      return;
    }
    updateBlueprint((current) => ({
      ...current,
      version: { ...current.version, nodes: [...(current.version?.nodes || []), node] },
    }));
    setSelectedIds([node.id]);
    setEditingNodeId(node.id);
  };

  const removeSelection = () => {
    if (!selectedIds.length && !selectedEdgeId) return;
    const startSelected = nodes.some((node) => selectedIds.includes(node.id) && node.type === 'start');
    if (startSelected) {
      toast.info('시작 노드는 삭제할 수 없습니다.');
      return;
    }
    updateBlueprint((current) => ({
      ...current,
      version: {
        ...current.version,
        nodes: (current.version?.nodes || []).filter((node) => !selectedIds.includes(node.id)),
        edges: (current.version?.edges || []).filter((edge) => !selectedEdgeId || edge.id !== selectedEdgeId).filter((edge) => !selectedIds.includes(edge.source) && !selectedIds.includes(edge.target)),
      },
    }));
    setSelectedIds([]);
    setSelectedEdgeId(null);
  };

  const onNodesChange = useCallback<OnNodesChange<BlueprintFlowNode>>((changes) => {
    const positionChanges = changes.flatMap((change) => (
      change.type === 'position' && change.position ? [{ id: change.id, position: change.position }] : []
    ));
    if (!positionChanges.length) return;
    const nextPositions = new Map(positionChanges.map((change) => [change.id, change.position!]));
    updateBlueprint((current) => ({
      ...current,
      version: {
        ...current.version,
        nodes: (current.version?.nodes || []).map((node) => {
          const next = nextPositions.get(node.id);
          return next ? { ...node, position: { x: next.x / FLOW_UNIT, y: next.y / FLOW_UNIT } } : node;
        }),
      },
    }));
  }, [updateBlueprint]);

  const onEdgesChange = useCallback<OnEdgesChange<BlueprintFlowEdge>>((changes) => {
    const selected = changes.find((change) => change.type === 'select' && change.selected);
    if (selected?.type === 'select') {
      setSelectedEdgeId(selected.id);
      setSelectedIds([]);
    }
  }, []);

  const upsertConnection = useCallback((connection: Connection, replaceEdgeId?: string) => {
    const sourceId = String(connection.source || '');
    const targetId = String(connection.target || '');
    const sourcePort = String(connection.sourceHandle || 'out');
    const targetPort = String(connection.targetHandle || 'in');
    if (!sourceId || !targetId || sourceId === targetId) {
      toast.error('연결할 수 없는 포트입니다.');
      return;
    }
    const sourceNode = nodes.find((node) => node.id === sourceId);
    const targetNode = nodes.find((node) => node.id === targetId);
    if (!sourceNode || !targetNode || !outputPorts(sourceNode).includes(sourcePort) || !inputPorts(targetNode).includes(targetPort)) {
      toast.error('연결할 수 없는 포트입니다.');
      return;
    }
    updateBlueprint((current) => {
      const currentEdges = current.version?.edges || [];
      const nextEdges = currentEdges.filter((edge) => {
        if (replaceEdgeId && edge.id === replaceEdgeId) return false;
        if (!allowsMultipleOutgoing(sourceNode) && edge.source === sourceId && edge.sourcePort === sourcePort) return false;
        if (edge.target === targetId && edge.targetPort === targetPort) return false;
        return true;
      });
      return {
        ...current,
        version: {
          ...current.version,
          edges: [...nextEdges, { id: replaceEdgeId || createId('edge'), source: sourceId, sourcePort, target: targetId, targetPort }],
        },
      };
    });
    setSelectedIds([]);
    setSelectedEdgeId(null);
  }, [nodes, updateBlueprint]);

  const onConnect = useCallback<OnConnect>((connection: Connection) => {
    upsertConnection(connection);
  }, [upsertConnection]);

  const onReconnectStart = useCallback((_event: unknown, edge: BlueprintFlowEdge, handleType?: 'source' | 'target') => {
    reconnectEdgeRef.current = { edgeId: edge.id, handleType: handleType || null, completed: false };
  }, []);

  const onReconnect = useCallback((oldEdge: BlueprintFlowEdge, connection: Connection) => {
    reconnectEdgeRef.current = { edgeId: oldEdge.id, handleType: reconnectEdgeRef.current?.handleType || null, completed: true };
    upsertConnection(connection, oldEdge.id);
  }, [upsertConnection]);

  const onReconnectEnd = useCallback(() => {
    const pending = reconnectEdgeRef.current;
    reconnectEdgeRef.current = null;
    if (!pending || pending.completed) return;
    const edge = edges.find((item) => item.id === pending.edgeId);
    const sourceNode = edge ? nodes.find((node) => node.id === edge.source) : null;
    if (pending.handleType === 'source' && allowsMultipleOutgoing(sourceNode)) return;
    updateBlueprint((current) => ({
      ...current,
      version: {
        ...current.version,
        edges: (current.version?.edges || []).filter((item) => item.id !== pending.edgeId),
      },
    }));
    setSelectedEdgeId(null);
  }, [edges, nodes, updateBlueprint]);

  const onSelectionChange = useCallback((params: OnSelectionChangeParams<BlueprintFlowNode, BlueprintFlowEdge>) => {
    setSelectedIds(params.nodes.map((node) => node.id));
    setSelectedEdgeId(params.edges[0]?.id || null);
  }, []);

  const onMoveEnd = useCallback((_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
    updateBlueprint((current) => ({ ...current, version: { ...current.version, viewport: nextViewport } }));
  }, [updateBlueprint]);

  const onInit = useCallback((instance: ReactFlowInstance<BlueprintFlowNode, BlueprintFlowEdge>) => {
    flowInstanceRef.current = instance;
    syncFlowViewport(viewport);
  }, [syncFlowViewport, viewport]);

  const handleNodeDoubleClick = (event: React.MouseEvent, node: BlueprintFlowNode) => {
    event.preventDefault();
    setSelectedIds([node.id]);
    setSelectedEdgeId(null);
    setEditingNodeId(node.id);
    setContextMenu(null);
  };

  const updateNodeConfig = (key: string, value: unknown) => {
    if (!selectedNode) return;
    updateBlueprint((current) => ({
      ...current,
      version: {
        ...current.version,
        nodes: (current.version?.nodes || []).map((node) => node.id === selectedNode.id ? { ...node, config: { ...node.config, [key]: value } } : node),
      },
    }));
  };

  const updateNodeConfigById = (nodeId: string, key: string, value: unknown) => {
    updateBlueprint((current) => ({
      ...current,
      version: {
        ...current.version,
        nodes: (current.version?.nodes || []).map((node) => node.id === nodeId ? { ...node, config: { ...node.config, [key]: value } } : node),
      },
    }));
  };

  const updateNodeNameById = (nodeId: string, name: string) => {
    updateBlueprint((current) => ({
      ...current,
      version: {
        ...current.version,
        nodes: (current.version?.nodes || []).map((node) => node.id === nodeId ? { ...node, name } : node),
      },
    }));
  };

  const editNode = (nodeId: string) => {
    setSelectedIds([nodeId]);
    setSelectedEdgeId(null);
    setEditingNodeId(nodeId);
    setContextMenu(null);
  };

  const deleteNodeById = (nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return;
    if (node.type === 'start') {
      toast.info('시작 노드는 삭제할 수 없습니다.');
      return;
    }
    updateBlueprint((current) => ({
      ...current,
      version: {
        ...current.version,
        nodes: (current.version?.nodes || []).filter((item) => item.id !== nodeId),
        edges: (current.version?.edges || []).filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      },
    }));
    setSelectedIds((current) => current.filter((id) => id !== nodeId));
    setSelectedEdgeId(null);
    setContextMenu(null);
  };

  const copyNodesByIds = async (nodeIds: string[]) => {
    const selectedSet = new Set(nodeIds);
    const selectedNodes = nodes.filter((node) => selectedSet.has(node.id));
    if (!selectedNodes.length) return;
    const selectedEdges = edges.filter((edge) => selectedSet.has(edge.source) && selectedSet.has(edge.target));
    const payload: BlueprintClipboard = {
      schema: SELECTION_CLIPBOARD_SCHEMA,
      version: 1,
      nodes: cloneJson(selectedNodes),
      edges: cloneJson(selectedEdges),
    };
    setClipboard(payload);
    try {
      await navigator.clipboard?.writeText(JSON.stringify(payload));
    } catch {
      // Browser clipboard access can be blocked; the in-memory clipboard still works.
    }
    toast.success(`${selectedNodes.length}개 노드를 복사했습니다.`);
  };

  const testRunFromNode = async (nodeId: string) => {
    setSelectedIds([nodeId]);
    setSelectedEdgeId(null);
    setContextMenu(null);
    await testRun();
  };

  const save = async () => {
    setSaving(true);
    try {
      const data = await jsonRequest<{ blueprint: Blueprint; validationErrors?: string[] }>('/api/action-blueprints', 'POST', {
        id: blueprint.id,
        name: blueprint.name,
        slug: blueprint.slug,
        description: blueprint.description,
        enabled: blueprint.enabled !== false,
        nodes,
        edges,
        viewport,
      });
      const nextBlueprint = normalizeBlueprint(data.blueprint);
      setBlueprint(nextBlueprint);
      persistedSnapshotRef.current = serializeBlueprintSnapshot(nextBlueprint);
      lastSnapshotRef.current = serializeBlueprintSnapshot(nextBlueprint);
      setBlueprints((current) => [data.blueprint, ...current.filter((item) => item.id !== data.blueprint.id)]);
      const versionData = data.blueprint.id ? await readJson<{ versions?: BlueprintVersion[] }>(`/api/action-blueprints/${encodeURIComponent(data.blueprint.id)}/versions`) : null;
      setVersions(versionData?.versions || []);
      toast.success(data.validationErrors?.length ? '저장했습니다. 게시 전 확인할 항목이 있습니다.' : '블루프린트를 저장했습니다.');
      return data.blueprint;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '저장하지 못했습니다.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (validationErrors.length) {
      toast.error('검증 항목을 먼저 해결한 뒤 게시할 수 있습니다.');
      return;
    }
    const currentSnapshot = serializeBlueprintSnapshot(blueprint);
    const saved = blueprint.id && persistedSnapshotRef.current === currentSnapshot ? blueprint : await save();
    const id = saved?.id;
    if (!id) return;
    try {
      const data = await jsonRequest<{ blueprint: Blueprint }>(`/api/action-blueprints/${encodeURIComponent(id)}/publish`, 'POST');
      const nextBlueprint = normalizeBlueprint(data.blueprint);
      setBlueprint(nextBlueprint);
      persistedSnapshotRef.current = serializeBlueprintSnapshot(nextBlueprint);
      lastSnapshotRef.current = serializeBlueprintSnapshot(nextBlueprint);
      setBlueprints((current) => [data.blueprint, ...current.filter((item) => item.id !== data.blueprint.id)]);
      toast.success('게시했습니다. 이제 특수 변수로 실행할 수 있습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '게시하지 못했습니다.');
    }
  };

  const simulatorContext = () => ({
    user: {
      userId: simulator.userId || 'test_viewer',
      username: simulator.username || '테스트 시청자',
      name: simulator.username || '테스트 시청자',
      points: Number(simulator.points || 0),
    },
    channel: { channelUid: 'simulator-channel' },
    trigger: {
      platform: simulator.platform || 'chzzk',
      message: simulator.message || '!테스트',
    },
    platform: simulator.platform || 'chzzk',
    roulette: { result: { label: simulator.rouletteResult || '당첨' } },
    donation: { amount: Number(simulator.donationAmount || 0) },
    attendance: { streak: 3, totalDays: 7, points: 100 },
    live: { title: '시뮬레이션 방송', category: 'Just Chatting', viewers: 128, live: true },
  });

  const testRun = async () => {
    if (validationErrors.length) {
      toast.error('검증 항목을 먼저 해결한 뒤 테스트할 수 있습니다.');
      return;
    }
    setTesting(true);
    setActiveRunNodeId(null);
    try {
      const currentSnapshot = serializeBlueprintSnapshot(blueprint);
      const targetBlueprint = blueprint.id && persistedSnapshotRef.current === currentSnapshot ? blueprint : await save();
      if (!targetBlueprint?.id) return;
      const data = await jsonRequest<{ ok?: boolean; error?: string; run?: BlueprintRun; executed?: string[] }>(`/api/action-blueprints/${encodeURIComponent(targetBlueprint.id)}/test`, 'POST', {
        context: simulatorContext(),
      });
      toast[data.ok ? 'success' : 'error'](data.ok ? `테스트 실행 완료: ${data.executed?.length || 0}개 노드` : data.error || '테스트 실패');
      const runData = await readJson<{ runs?: BlueprintRun[] }>(`/api/action-blueprints/${encodeURIComponent(targetBlueprint.id)}/runs`);
      setRuns(runData?.runs || []);
      if (data.run?.id) {
        const stepData = await readJson<{ steps?: BlueprintRunStep[] }>(`/api/action-blueprints/runs/${encodeURIComponent(data.run.id)}/steps`);
        setRunSteps(stepData?.steps || []);
        replayRunSteps(stepData?.steps || []);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '테스트를 실행하지 못했습니다.');
    } finally {
      setTesting(false);
    }
  };

  const deleteBlueprint = async () => {
    if (!blueprint.id || !window.confirm(`"${blueprint.name}" 블루프린트를 삭제할까요?`)) return;
    try {
      await jsonRequest(`/api/action-blueprints/${encodeURIComponent(blueprint.id)}`, 'DELETE');
      toast.success('블루프린트를 삭제했습니다.');
      const remaining = blueprints.filter((item) => item.id !== blueprint.id);
      const nextBlueprint = normalizeBlueprint(remaining[0] || null);
      setBlueprints(remaining);
      setBlueprint(nextBlueprint);
      syncFlowViewport(nextBlueprint.version?.viewport || DEFAULT_VIEWPORT);
      persistedSnapshotRef.current = serializeBlueprintSnapshot(nextBlueprint);
      lastSnapshotRef.current = serializeBlueprintSnapshot(nextBlueprint);
      setRuns([]);
      setVersions([]);
      setRunSteps([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '삭제하지 못했습니다.');
    }
  };

  const duplicateSelection = () => {
    if (!selectedIds.length) return;
    const selectedNodes = nodes.filter((node) => selectedIds.includes(node.id) && node.type !== 'start');
    if (!selectedNodes.length) return;
    const idMap = new Map(selectedNodes.map((node) => [node.id, createId(node.type)]));
    const clones = selectedNodes.map((node) => ({
      ...node,
      id: idMap.get(node.id) || createId(node.type),
      name: `${node.name} 복사`,
      position: { x: node.position.x + 2, y: node.position.y + 2 },
      config: JSON.parse(JSON.stringify(node.config || {})),
    }));
    const cloneEdges = edges
      .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge) => ({ ...edge, id: createId('edge'), source: idMap.get(edge.source) || edge.source, target: idMap.get(edge.target) || edge.target }));
    updateBlueprint((current) => ({
      ...current,
      version: {
        ...current.version,
        nodes: [...(current.version?.nodes || []), ...clones],
        edges: [...(current.version?.edges || []), ...cloneEdges],
      },
    }));
    setSelectedIds(clones.map((node) => node.id));
  };

  const autoLayout = () => {
    const levels = new Map<string, number>();
    const start = nodes.find((node) => node.type === 'start') || nodes[0];
    if (start) levels.set(start.id, 0);
    for (let pass = 0; pass < nodes.length; pass += 1) {
      edges.forEach((edge) => {
        const sourceLevel = levels.get(edge.source);
        if (sourceLevel != null) levels.set(edge.target, Math.max(levels.get(edge.target) ?? 0, sourceLevel + 1));
      });
    }
    const grouped = new Map<number, BlueprintNode[]>();
    nodes.forEach((node) => {
      const level = levels.get(node.id) ?? 0;
      grouped.set(level, [...(grouped.get(level) || []), node]);
    });
    updateBlueprint((current) => ({
      ...current,
      version: {
        ...current.version,
        nodes: (current.version?.nodes || []).map((node) => {
          const level = levels.get(node.id) ?? 0;
          const siblings = grouped.get(level) || [];
          const index = siblings.findIndex((item) => item.id === node.id);
          return { ...node, position: { x: level * 24, y: 3 + index * 11 } };
        }),
        viewport: DEFAULT_VIEWPORT,
      },
    }));
  };

  const fitViewportToNodes = (targetNodes = nodes) => {
    const visibleNodes = targetNodes.length ? targetNodes : nodes;
    if (!visibleNodes.length) return;
    void flowInstanceRef.current?.fitView({
      nodes: visibleNodes.map((node) => ({ id: node.id })),
      padding: 0.22,
      duration: 220,
      minZoom: 0.45,
      maxZoom: 1.8,
    });
  };

  const focusSelection = () => {
    const selectedNodes = nodes.filter((node) => selectedIds.includes(node.id));
    fitViewportToNodes(selectedNodes.length ? selectedNodes : nodes);
  };

  const restoreVersion = async (versionId: string) => {
    if (!blueprint.id) return;
    try {
      const data = await jsonRequest<{ blueprint: Blueprint }>(`/api/action-blueprints/${encodeURIComponent(blueprint.id)}/versions/${encodeURIComponent(versionId)}/restore`, 'POST');
      const nextBlueprint = normalizeBlueprint(data.blueprint);
      setBlueprint(nextBlueprint);
      syncFlowViewport(nextBlueprint.version?.viewport || DEFAULT_VIEWPORT);
      persistedSnapshotRef.current = serializeBlueprintSnapshot(nextBlueprint);
      lastSnapshotRef.current = serializeBlueprintSnapshot(nextBlueprint);
      toast.success('선택한 버전으로 되돌렸습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '버전을 복원하지 못했습니다.');
    }
  };

  const loadRunSteps = async (runId: string) => {
    const data = await readJson<{ steps?: BlueprintRunStep[] }>(`/api/action-blueprints/runs/${encodeURIComponent(runId)}/steps`);
    setRunSteps(data?.steps || []);
    replayRunSteps(data?.steps || []);
  };

  const copyVariable = () => {
    const token = `\${action::${blueprint.slug || blueprint.id || 'blueprint_id'}}`;
    navigator.clipboard?.writeText(token).then(() => toast.success('특수 변수를 복사했습니다.')).catch(() => undefined);
  };

  const newBlueprint = () => {
    const fresh = normalizeBlueprint(null);
    setBlueprint(fresh);
    syncFlowViewport(fresh.version?.viewport || DEFAULT_VIEWPORT);
    historyPastRef.current = [];
    historyFutureRef.current = [];
    lastSnapshotRef.current = serializeBlueprintSnapshot(fresh);
    persistedSnapshotRef.current = '';
    setHistoryCount({ past: 0, future: 0 });
    setSelectedIds([fresh.version?.nodes?.[0]?.id || '']);
    setRuns([]);
    setVersions([]);
    setRunSteps([]);
  };

  const loadBlueprint = async (item: Blueprint) => {
    if (!item.id) return;
    const [data, versionData] = await Promise.all([
      readJson<{ blueprint?: Blueprint; runs?: BlueprintRun[] }>(`/api/action-blueprints/${encodeURIComponent(item.id)}`),
      readJson<{ versions?: BlueprintVersion[] }>(`/api/action-blueprints/${encodeURIComponent(item.id)}/versions`),
    ]);
    const nextBlueprint = normalizeBlueprint(data?.blueprint || item);
    setBlueprint(nextBlueprint);
    syncFlowViewport(nextBlueprint.version?.viewport || DEFAULT_VIEWPORT);
    historyPastRef.current = [];
    historyFutureRef.current = [];
    lastSnapshotRef.current = serializeBlueprintSnapshot(nextBlueprint);
    persistedSnapshotRef.current = serializeBlueprintSnapshot(nextBlueprint);
    setHistoryCount({ past: 0, future: 0 });
    setRuns(data?.runs || []);
    setVersions(versionData?.versions || []);
    setRunSteps([]);
    setSelectedIds([]);
    setSelectedEdgeId(null);
  };

  const flushPendingHistory = () => {
    if (!historyTimerRef.current) return;
    clearTimeout(historyTimerRef.current);
    historyTimerRef.current = null;
    const snapshot = serializeBlueprintSnapshot(blueprint);
    if (snapshot !== lastSnapshotRef.current) {
      historyPastRef.current = [...historyPastRef.current.slice(-59), lastSnapshotRef.current];
      historyFutureRef.current = [];
      lastSnapshotRef.current = snapshot;
      setHistoryCount({ past: historyPastRef.current.length, future: 0 });
    }
  };

  const undoBlueprint = () => {
    flushPendingHistory();
    const target = historyPastRef.current.at(-1);
    if (!target) return;
    const current = serializeBlueprintSnapshot(blueprint);
    historyPastRef.current = historyPastRef.current.slice(0, -1);
    historyFutureRef.current = [current, ...historyFutureRef.current.slice(0, 59)];
    lastSnapshotRef.current = target;
    applyingHistoryRef.current = true;
    const restored = restoreBlueprintSnapshot(target);
    setBlueprint(restored);
    syncFlowViewport(restored.version?.viewport || DEFAULT_VIEWPORT);
    setSelectedIds([]);
    setSelectedEdgeId(null);
    setHistoryCount({ past: historyPastRef.current.length, future: historyFutureRef.current.length });
  };

  const redoBlueprint = () => {
    const target = historyFutureRef.current[0];
    if (!target) return;
    const current = serializeBlueprintSnapshot(blueprint);
    historyFutureRef.current = historyFutureRef.current.slice(1);
    historyPastRef.current = [...historyPastRef.current.slice(-59), current];
    lastSnapshotRef.current = target;
    applyingHistoryRef.current = true;
    const restored = restoreBlueprintSnapshot(target);
    setBlueprint(restored);
    syncFlowViewport(restored.version?.viewport || DEFAULT_VIEWPORT);
    setSelectedIds([]);
    setSelectedEdgeId(null);
    setHistoryCount({ past: historyPastRef.current.length, future: historyFutureRef.current.length });
  };

  const restoreAutosaveDraft = () => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      const imported = raw ? normalizeImportedBlueprint(JSON.parse(raw)) : null;
      if (!imported) {
        toast.info('복원할 자동 저장 초안이 없습니다.');
        return;
      }
      const nextBlueprint = { ...imported, name: imported.name.replace(/\s복사$/, '') };
      setBlueprint(nextBlueprint);
      syncFlowViewport(nextBlueprint.version?.viewport || DEFAULT_VIEWPORT);
      historyPastRef.current = [];
      historyFutureRef.current = [];
      lastSnapshotRef.current = serializeBlueprintSnapshot(nextBlueprint);
      persistedSnapshotRef.current = '';
      setHistoryCount({ past: 0, future: 0 });
      setSelectedIds(nextBlueprint.version?.nodes?.[0]?.id ? [nextBlueprint.version.nodes[0].id] : []);
      setSelectedEdgeId(null);
      setRuns([]);
      setVersions([]);
      setRunSteps([]);
      setDraftStatus('restored');
      toast.success('자동 저장 초안을 불러왔습니다.');
    } catch {
      toast.error('자동 저장 초안을 불러오지 못했습니다.');
    }
  };

  const replayRunSteps = (steps = runSteps) => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    const ordered = [...steps].sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
    if (!ordered.length) {
      toast.info('재생할 실행 단계가 없습니다.');
      return;
    }
    let index = 0;
    const play = () => {
      const step = ordered[index];
      setActiveRunNodeId(step?.nodeId || null);
      index += 1;
      if (index <= ordered.length) {
        playTimerRef.current = setTimeout(play, Math.max(260, Math.min(900, Number(step?.durationMs || 360) + 220)));
      } else {
        playTimerRef.current = setTimeout(() => setActiveRunNodeId(null), 700);
      }
    };
    play();
  };

  const insertTemplate = (templateId: string) => {
    const template = blueprintTemplates.find((item) => item.id === templateId);
    if (!template) return;
    const rect = flowWrapperRef.current?.getBoundingClientRect();
    const center = rect
      ? flowInstanceRef.current?.screenToFlowPosition({ x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 }) || { x: 240, y: 180 }
      : { x: 240, y: 180 };
    const base = { x: center.x / FLOW_UNIT, y: center.y / FLOW_UNIT };
    const created = template.nodes.map((item) => ({
      ...createNode(item.type, { x: base.x + item.position.x, y: base.y + item.position.y }),
      name: item.name || nodeSpec(item.type).title,
      config: { ...cloneJson(nodeSpec(item.type).config), ...(item.config ? cloneJson(item.config) : {}) },
    }));
    const createdEdges = template.edges.flatMap((edge) => {
      const source = created[edge.source];
      const target = created[edge.target];
      if (!source || !target) return [];
      const sourcePort = edge.sourcePort || 'out';
      const targetPort = edge.targetPort || 'in';
      if (!outputPorts(source).includes(sourcePort) || !inputPorts(target).includes(targetPort)) return [];
      return [{ id: createId('edge'), source: source.id, sourcePort, target: target.id, targetPort }];
    });
    const defaultStarter = isDefaultStarterBlueprint(nodes, edges);
    if (defaultStarter) {
      const start = nodes.find((node) => node.type === 'start');
      const end = nodes.find((node) => node.type === 'end');
      const first = created[0];
      if (start && end && first) {
        const createdOutgoing = new Set(createdEdges.map((edge) => `${edge.source}:${edge.sourcePort}`));
        const terminalEdges = created.flatMap((node) => {
          return outputPorts(node)
            .filter((port) => !createdOutgoing.has(`${node.id}:${port}`))
            .map((port) => ({ id: createId('edge'), source: node.id, sourcePort: port, target: end.id, targetPort: 'in' }));
        });
        updateBlueprint((current) => ({
          ...current,
          version: {
            ...current.version,
            nodes: [start, ...created, end],
            edges: [
              { id: createId('edge'), source: start.id, sourcePort: 'out', target: first.id, targetPort: 'in' },
              ...createdEdges,
              ...terminalEdges,
            ],
          },
        }));
        setSelectedIds(created.map((node) => node.id));
        setSelectedEdgeId(null);
        toast.success(`${template.title} 템플릿을 적용했습니다.`);
        return;
      }
    }
    const first = created[0];
    const selectedSource = nodes.find((node) => selectedIds.includes(node.id));
    const usedOutputs = new Set(edges.map((edge) => `${edge.source}:${edge.sourcePort || 'out'}`));
    const freePort = selectedSource ? outputPorts(selectedSource).find((port) => !usedOutputs.has(`${selectedSource.id}:${port}`)) : null;
    const autoConnectEdge = selectedSource && first && freePort
      ? [{ id: createId('edge'), source: selectedSource.id, sourcePort: freePort, target: first.id, targetPort: 'in' }]
      : [];
    updateBlueprint((current) => ({
      ...current,
      version: {
        ...current.version,
        nodes: [...(current.version?.nodes || []), ...created],
        edges: [...(current.version?.edges || []), ...autoConnectEdge, ...createdEdges],
      },
    }));
    setSelectedIds(created.map((node) => node.id));
    setSelectedEdgeId(null);
    toast.success(autoConnectEdge.length ? `${template.title} 템플릿을 선택한 노드에 연결했습니다.` : `${template.title} 템플릿을 추가했습니다.`);
  };

  const copySelection = async () => {
    if (!selectedIds.length) {
      toast.info('복사할 노드를 선택하세요.');
      return;
    }
    await copyNodesByIds(selectedIds);
  };

  const readClipboardSelection = async () => {
    try {
      const text = await navigator.clipboard?.readText();
      if (text) {
        const parsed = JSON.parse(text) as Partial<BlueprintClipboard>;
        if (parsed.schema === SELECTION_CLIPBOARD_SCHEMA && Array.isArray(parsed.nodes)) return parsed as BlueprintClipboard;
      }
    } catch {
      // Fall back to the local clipboard state.
    }
    return clipboard;
  };

  const pasteSelection = async (targetPosition?: { x: number; y: number }) => {
    const payload = await readClipboardSelection();
    if (!payload?.nodes?.length) {
      toast.info('붙여넣을 블루프린트 노드가 없습니다.');
      return;
    }
    const clipboardNodes = normalizeImportedNodes(payload.nodes, false);
    const clipboardEdges = normalizeImportedEdges(payload.edges, clipboardNodes);
    const hasStart = nodes.some((node) => node.type === 'start');
    const sourceNodes = clipboardNodes.filter((node) => node.type !== 'start' || !hasStart);
    if (!sourceNodes.length) {
      toast.info('시작 노드는 이미 존재해서 붙여넣지 않았습니다.');
      return;
    }
    const idMap = new Map(sourceNodes.map((node) => [node.id, createId(node.type)]));
    const offset = 2 + pasteCount * 1.5;
    const minX = Math.min(...sourceNodes.map((node) => node.position.x));
    const minY = Math.min(...sourceNodes.map((node) => node.position.y));
    const pastedNodes = sourceNodes.map((node) => ({
      ...node,
      id: idMap.get(node.id) || createId(node.type),
      name: node.type === 'start' ? node.name : `${node.name} 복사`,
      position: targetPosition
        ? { x: targetPosition.x + node.position.x - minX, y: targetPosition.y + node.position.y - minY }
        : { x: node.position.x + offset, y: node.position.y + offset },
      config: cloneJson(node.config || {}),
    }));
    const pastedEdges = clipboardEdges
      .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge) => ({
        ...edge,
        id: createId('edge'),
        source: idMap.get(edge.source) || edge.source,
        target: idMap.get(edge.target) || edge.target,
      }));
    updateBlueprint((current) => ({
      ...current,
      version: {
        ...current.version,
        nodes: [...(current.version?.nodes || []), ...pastedNodes],
        edges: [...(current.version?.edges || []), ...pastedEdges],
      },
    }));
    setPasteCount((current) => current + 1);
    setSelectedIds(pastedNodes.map((node) => node.id));
    setSelectedEdgeId(null);
    setContextMenu(null);
    toast.success(`${pastedNodes.length}개 노드를 붙여넣었습니다.`);
  };

  const exportBlueprintJson = () => {
    const payload = buildBlueprintExport(blueprint, nodes, edges, viewport);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeJsonFilename(blueprint.name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success('블루프린트 JSON을 내보냈습니다.');
  };

  const importBlueprintJson = async (file: File | null) => {
    if (!file) return;
    try {
      const imported = normalizeImportedBlueprint(JSON.parse(await file.text()));
      if (!imported) throw new Error('invalid_blueprint_json');
      setBlueprint(imported);
      syncFlowViewport(imported.version?.viewport || DEFAULT_VIEWPORT);
      historyPastRef.current = [];
      historyFutureRef.current = [];
      lastSnapshotRef.current = serializeBlueprintSnapshot(imported);
      persistedSnapshotRef.current = '';
      setHistoryCount({ past: 0, future: 0 });
      setSelectedIds(imported.version?.nodes?.[0]?.id ? [imported.version.nodes[0].id] : []);
      setSelectedEdgeId(null);
      setRuns([]);
      setVersions([]);
      setRunSteps([]);
      setPasteCount(0);
      toast.success('JSON 블루프린트를 새 초안으로 불러왔습니다.');
    } catch {
      toast.error('블루프린트 JSON을 읽지 못했습니다.');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handleCanvasKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setSelectedIds([]);
      setSelectedEdgeId(null);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && (selectedIds.length || selectedEdgeId)) {
      event.preventDefault();
      removeSelection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      duplicateSelection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoBlueprint();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
      event.preventDefault();
      redoBlueprint();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      void copySelection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      void pasteSelection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void testRun();
    }
  };

  const contextNode = contextMenu?.nodeId ? nodes.find((node) => node.id === contextMenu.nodeId) || null : null;

  return (
    <div className="grid gap-[clamp(1rem,2vw,1.5rem)]">
      <section className="border-b pb-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[calc(var(--radius-control)*0.9)] bg-card/75 text-primary shadow-subtle ring-1 ring-primary/15">
                <Workflow className="h-5 w-5" />
              </span>
              <Badge tone="violet">실행 액션</Badge>
              <Badge tone={blueprint.version?.published ? 'mint' : 'lemon'}>{blueprint.version?.published ? '게시됨' : '초안'}</Badge>
              <Badge tone={validationErrors.length ? 'amber' : 'neutral'}>{validationErrors.length ? `${validationErrors.length}개 확인 필요` : '검증 통과'}</Badge>
              <Badge tone={draftStatus === 'restored' ? 'sky' : draftStatus === 'saved' ? 'mint' : 'neutral'}>
                {draftStatus === 'restored' ? '임시 초안 복원' : draftStatus === 'saved' ? '자동 저장됨' : '편집 중'}
              </Badge>
            </div>
            <h1 className="max-w-[22ch] break-keep text-[clamp(1.75rem,3.2vw,2.7rem)] font-bold leading-tight tracking-tight">방송 액션 설계</h1>
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                ['노드', nodes.length],
                ['연결', edges.length],
                ['선택', selectedIds.length + (selectedEdgeId ? 1 : 0)],
                ['줌', `${zoomLabel}%`],
              ].map(([label, value]) => (
                <span key={label} className="inline-flex min-h-[var(--control-height-sm)] items-center gap-2 rounded-full border bg-card/72 px-3 text-xs font-bold text-muted-foreground shadow-subtle backdrop-blur-xl">
                  <span>{label}</span>
                  <span className="text-foreground">{value}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-[repeat(2,minmax(0,1fr))] xl:max-w-[min(100%,42rem)] xl:grid-cols-[repeat(5,minmax(0,1fr))]">
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void importBlueprintJson(event.target.files?.[0] || null)}
            />
            <select
              value={blueprint.id || ''}
              onChange={(event) => {
                const next = blueprints.find((item) => item.id === event.target.value);
                if (next) void loadBlueprint(next);
              }}
              className="min-h-[var(--control-height-sm)] rounded-[var(--radius-control)] border bg-card/75 px-3 text-sm font-semibold outline-none transition focus:border-primary/45 focus:ring-2 focus:ring-ring sm:col-span-2 xl:col-span-5"
              aria-label="저장된 블루프린트 선택"
            >
              <option value="">{blueprints.length ? '저장된 블루프린트 선택' : '저장된 블루프린트 없음'}</option>
              {blueprints.map((item) => (
                <option key={item.id || item.name} value={item.id || ''}>
                  {item.name}{item.version?.published ? ' · 게시됨' : ''}
                </option>
              ))}
            </select>
            <Button type="button" variant="outline" size="sm" onClick={newBlueprint}>
              <Plus className="h-4 w-4" />
              새 블루프린트
            </Button>
            <ActionMenu
              label="관리"
              entries={[
                { label: 'JSON 내보내기', icon: Download, onSelect: exportBlueprintJson },
                { label: 'JSON 불러오기', icon: Upload, onSelect: () => importInputRef.current?.click() },
                { label: '임시 초안 복원', icon: RefreshCw, onSelect: restoreAutosaveDraft },
                { label: '특수 변수 복사', icon: Copy, onSelect: copyVariable, disabled: !blueprint.id && !blueprint.slug },
                { label: '블루프린트 삭제', icon: Trash2, onSelect: deleteBlueprint, disabled: !blueprint.id, danger: true, separatorBefore: true },
              ]}
            />
            <Button type="button" variant="outline" size="sm" onClick={testRun} disabled={testing || saving}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              테스트
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              저장
            </Button>
            <Button type="button" size="sm" onClick={publish} disabled={!!validationErrors.length || saving}>
              <Radio className="h-4 w-4" />
              게시
            </Button>
          </div>
        </div>
      </section>

      <section className="grid min-h-[min(78svh,54rem)] gap-4 xl:grid-cols-[minmax(20rem,0.34fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden border-border/70 bg-card/74 shadow-subtle">
          <CardHeader className="border-b bg-card/62">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">노드 팔레트</CardTitle>
                <CardDescription className="text-xs leading-5">필요한 블록을 캔버스 중앙에 추가합니다.</CardDescription>
              </div>
              <Badge tone="neutral">{filteredCatalog.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="노드 검색" className="pl-9" />
            </div>
            <div className="grid max-h-[18rem] gap-2 overflow-y-auto rounded-[calc(var(--radius-control)*0.95)] border bg-background/48 p-2 md:max-h-none">
              <div className="px-1 text-[0.68rem] font-extrabold uppercase text-muted-foreground">템플릿</div>
              {blueprintTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => insertTemplate(template.id)}
                  className="group rounded-[calc(var(--radius-control)*0.9)] border bg-card/80 p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card hover:shadow-subtle"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">{template.title}</span>
                    <Badge tone={template.tone}>묶음</Badge>
                  </span>
                  <span className="mt-1 block break-keep text-xs leading-5 text-muted-foreground">{template.body}</span>
                </button>
              ))}
            </div>
            <div className="max-h-[28rem] overflow-y-auto pr-1 md:max-h-[34rem]">
              {catalogGroups.map(([group, items]) => (
                <div key={group} className="mb-3 grid gap-2">
                  <div className="sticky top-0 z-10 flex items-center justify-between bg-card/90 px-1 py-1 text-[0.68rem] font-extrabold uppercase text-muted-foreground backdrop-blur-xl">
                    <span>{group}</span>
                    <span>{items.length}</span>
                  </div>
                  {items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => addNode(item.type)}
                        className="group flex w-full items-start gap-3 rounded-[calc(var(--radius-control)*0.9)] border bg-background/64 p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card hover:shadow-subtle"
                      >
                        <span className={cn('grid aspect-square w-[2.15rem] shrink-0 place-items-center rounded-[calc(var(--radius-control)*0.82)] ring-1 transition group-hover:scale-105', paletteIconClass(item))}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-bold">{item.title}</span>
                            <Badge tone={item.tone} className="px-2 py-0.5 text-[0.65rem]">{item.group}</Badge>
                          </span>
                          <span className="mt-1 block break-keep text-xs leading-5 text-muted-foreground">{item.body}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {!filteredCatalog.length ? (
                <div className="rounded-[var(--radius-control)] border border-dashed bg-background/55 p-4 text-sm text-muted-foreground">
                  검색 결과가 없습니다.
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border/70 bg-card/82 shadow-soft">
          <CardHeader className="border-b bg-card p-3">
            <div className="flex flex-col gap-3">
              <div className="grid gap-2 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_auto] lg:items-center">
                <Input value={blueprint.name} onChange={(event) => setBlueprint((current) => ({ ...current, name: event.target.value }))} aria-label="블루프린트 이름" className="font-bold" />
                <Input value={blueprint.description || ''} onChange={(event) => setBlueprint((current) => ({ ...current, description: event.target.value }))} placeholder="설명" aria-label="블루프린트 설명" />
                <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-bold text-muted-foreground lg:justify-end lg:overflow-visible lg:pb-0">
                  <span className="shrink-0 rounded-full border bg-background/70 px-3 py-2">노드 {nodes.length}</span>
                  <span className="shrink-0 rounded-full border bg-background/70 px-3 py-2">연결 {edges.length}</span>
                  <span className="shrink-0 rounded-full border bg-background/70 px-3 py-2">줌 {zoomLabel}%</span>
                </div>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 [&>button]:shrink-0 lg:flex-wrap lg:overflow-visible lg:pb-0">
                <Button type="button" variant="outline" size="icon" onClick={() => void flowInstanceRef.current?.zoomIn({ duration: 160 })} aria-label="확대" title="확대">
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" size="icon" onClick={() => void flowInstanceRef.current?.zoomOut({ duration: 160 })} aria-label="축소" title="축소">
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => fitViewportToNodes()}>
                  <Move className="h-4 w-4" />
                  전체 보기
                </Button>
                <Button type="button" variant="outline" size="icon" onClick={autoLayout} aria-label="자동 정렬" title="자동 정렬">
                  <Workflow className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" size="icon" onClick={undoBlueprint} disabled={!historyCount.past} aria-label="되돌리기" title="되돌리기">
                  <Undo2 className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" size="icon" onClick={redoBlueprint} disabled={!historyCount.future} aria-label="다시 실행" title="다시 실행">
                  <Redo2 className="h-4 w-4" />
                </Button>
                <ActionMenu
                  label="편집"
                  entries={[
                    { label: '선택 보기', icon: MousePointer2, onSelect: focusSelection, disabled: !nodes.length },
                    { label: '실행 재생', icon: Play, onSelect: () => replayRunSteps(), disabled: !runSteps.length },
                    { label: '선택 복제', icon: Copy, onSelect: duplicateSelection, disabled: !selectedIds.length, separatorBefore: true },
                    { label: '선택 복사', icon: Copy, onSelect: () => void copySelection(), disabled: !selectedIds.length },
                    { label: '붙여넣기', icon: Upload, onSelect: () => void pasteSelection() },
                    { label: '선택 삭제', icon: Trash2, onSelect: removeSelection, disabled: !selectedIds.length && !selectedEdgeId, danger: true, separatorBefore: true },
                  ]}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div
              ref={flowWrapperRef}
              tabIndex={0}
              data-flow-node-count={flowNodes.length}
              data-flow-edge-count={flowEdges.length}
              className="relative h-[min(72svh,46rem)] min-h-[32rem] overflow-hidden bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={handleCanvasKeyDown}
            >
              <div className="absolute bottom-3 left-3 z-20 hidden items-center gap-2 rounded-full border bg-card/88 px-3 py-2 text-[0.68rem] font-bold text-muted-foreground shadow-subtle backdrop-blur-xl sm:flex">
                <span className="h-2 w-2 rounded-full bg-primary" />
                <span>{selectedIds.length || selectedEdgeId ? `${selectedIds.length + (selectedEdgeId ? 1 : 0)}개 선택` : '선택 없음'}</span>
                <span className="text-border">/</span>
                <span>{zoomLabel}%</span>
              </div>
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                defaultNodes={flowNodes}
                defaultEdges={flowEdges}
                nodeTypes={flowNodeTypes}
                defaultViewport={viewport}
                viewport={liveViewport}
                minZoom={0.45}
                maxZoom={1.8}
                fitView={false}
                connectionLineStyle={{ stroke: 'hsl(var(--primary))', strokeWidth: 3, strokeDasharray: '7 5' }}
                panOnDrag
                panOnScroll={false}
                zoomOnScroll
                zoomOnPinch
                zoomOnDoubleClick={false}
                connectOnClick
                selectionOnDrag
                multiSelectionKeyCode={['Control', 'Meta']}
                deleteKeyCode={null}
                nodesDraggable
                nodesConnectable
                elementsSelectable
                onInit={onInit}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                edgesReconnectable
                onReconnectStart={onReconnectStart}
                onReconnect={onReconnect}
                onReconnectEnd={onReconnectEnd}
                onSelectionChange={onSelectionChange}
                onNodeDoubleClick={handleNodeDoubleClick}
                onViewportChange={setLiveViewport}
                onMoveEnd={onMoveEnd}
                onError={(code, message) => {
                  console.warn(`[ReactFlow:${code}] ${message}`);
                }}
                onPaneClick={() => {
                  setSelectedIds([]);
                  setSelectedEdgeId(null);
                }}
                className="arubot-blueprint-flow"
              >
                <Background gap={40} color="hsl(var(--border))" />
                <Controls className="!border !border-border !bg-card/88 !shadow-subtle !backdrop-blur-xl" />
                <MiniMap
                  pannable
                  zoomable
                  bgColor="hsl(var(--card))"
                  nodeColor="hsl(var(--primary))"
                  nodeStrokeColor="hsl(var(--border))"
                  nodeBorderRadius={8}
                  maskColor="hsl(var(--background)/0.62)"
                  className="!hidden !border !border-border !bg-card/88 !shadow-subtle !backdrop-blur-xl md:!block"
                />
              </ReactFlow>
            </div>
          </CardContent>
        </Card>

        <div className="hidden">
          <Card className="border-border/70 bg-card/74 shadow-subtle">
            <CardHeader className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">검증</CardTitle>
                  <CardDescription className="text-xs leading-5">방송에 올리기 전 빠진 값이 없는지 살펴봅니다.</CardDescription>
                </div>
                <Badge tone={validationErrors.length ? 'amber' : 'mint'}>{validationErrors.length ? validationErrors.length : 'OK'}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-2 p-4 pt-0">
              {validationErrors.length ? validationErrors.map((error) => (
                <div key={error} className="rounded-[var(--radius-control)] border border-amber-400/35 bg-amber-100/45 px-3 py-2 text-xs font-semibold text-amber-900 dark:bg-amber-400/10 dark:text-amber-100">
                  {error}
                </div>
              )) : (
                <div className="rounded-[var(--radius-control)] border bg-pastel-mint/50 px-3 py-2 text-xs font-semibold text-foreground dark:bg-primary/12">
                  검증을 통과했습니다. 저장 후 게시할 수 있습니다.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/74 shadow-subtle">
            <CardHeader className="p-4">
              <CardTitle className="text-base">테스트 시뮬레이터</CardTitle>
              <CardDescription className="text-xs leading-5">테스트 버튼 실행 시 사용할 시청자 상황입니다.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 pt-0">
              <label className="grid gap-2 text-sm font-semibold">
                플랫폼
                <select
                  value={simulator.platform}
                  onChange={(event) => setSimulator((current) => ({ ...current, platform: event.target.value }))}
                  className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-background px-3 text-sm"
                >
                  <option value="chzzk">치지직</option>
                  <option value="cime">씨미</option>
                  <option value="youtube">YouTube</option>
                </select>
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="시청자 이름" value={simulator.username} onChange={(value) => setSimulator((current) => ({ ...current, username: value }))} />
                <Field label="시청자 UUID" value={simulator.userId} onChange={(value) => setSimulator((current) => ({ ...current, userId: value }))} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="보유 포인트" value={simulator.points} onChange={(value) => setSimulator((current) => ({ ...current, points: value }))} />
                <Field label="후원 금액" value={simulator.donationAmount} onChange={(value) => setSimulator((current) => ({ ...current, donationAmount: value }))} />
              </div>
              <Field label="채팅 메시지" value={simulator.message} onChange={(value) => setSimulator((current) => ({ ...current, message: value }))} />
              <Field label="룰렛 결과값" value={simulator.rouletteResult} onChange={(value) => setSimulator((current) => ({ ...current, rouletteResult: value }))} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={testRun} disabled={testing || saving}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  시뮬레이션 실행
                </Button>
                <Button type="button" variant="outline" onClick={() => replayRunSteps()} disabled={!runSteps.length}>
                  <RefreshCw className="h-4 w-4" />
                  결과 재생
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/82 shadow-subtle">
            <CardHeader className="p-4">
              <CardTitle className="text-base">설정 패널</CardTitle>
              <CardDescription className="text-xs leading-5">{selectedNode ? '채팅, 후원, 포인트 변수를 섞어 원하는 반응을 만들 수 있습니다.' : '노드를 선택하면 방송에서 나갈 반응을 다듬을 수 있습니다.'}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 pt-0">
              {selectedNode ? (
                <>
                  <NodeReferencePanel node={selectedNode} />
                  <label className="grid gap-2 text-sm font-semibold">
                    노드 이름
                    <Input value={selectedNode.name} onChange={(event) => updateBlueprint((current) => ({ ...current, version: { ...current.version, nodes: (current.version?.nodes || []).map((node) => node.id === selectedNode.id ? { ...node, name: event.target.value } : node) } }))} />
                  </label>
                  <ConfigFields
                    node={selectedNode}
                    onChange={updateNodeConfig}
                    automationOverview={automationOverview}
                    automationBusy={automationBusy}
                    onDiscoverAutomation={discoverAutomation}
                    blueprints={blueprints}
                  />
                  <div className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
                    예: <code>{'{user.name}'}</code>, <code>{'{user.points}'}</code>, <code>{'{roulette.result}'}</code>, <code>{'{flow.bonusPoint} * 2'}</code>
                  </div>
                </>
              ) : (
                <div className="grid place-items-center rounded-[var(--radius-control)] border border-dashed bg-background/50 p-8 text-center text-sm text-muted-foreground">
                  <MousePointer2 className="mb-3 h-7 w-7 text-primary" />
                  노드나 연결선을 선택하세요.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/74 shadow-subtle">
            <CardHeader className="p-4">
              <CardTitle className="text-base">블루프린트 목록</CardTitle>
              <CardDescription className="text-xs leading-5">저장된 실행 액션을 불러옵니다.</CardDescription>
            </CardHeader>
            <CardContent className="grid max-h-[18rem] gap-2 overflow-y-auto p-4 pt-0">
              {blueprints.map((item) => (
                <button key={item.id || item.name} type="button" onClick={() => loadBlueprint(item)} className={cn('rounded-[var(--radius-control)] border bg-background/70 p-3 text-left transition hover:border-primary/35', item.id === blueprint.id && 'border-primary/50 bg-pastel-mint/45')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold">{item.name}</span>
                    <Badge tone={item.version?.published ? 'mint' : 'lemon'}>{item.version?.published ? '게시' : '초안'}</Badge>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{item.updatedAt ? compactDateTime(item.updatedAt) : item.slug}</div>
                </button>
              ))}
              {!blueprints.length ? <div className="rounded-[var(--radius-control)] border bg-background/55 p-4 text-sm text-muted-foreground">{isPending ? '불러오는 중입니다.' : '저장된 블루프린트가 없습니다.'}</div> : null}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/74 shadow-subtle">
            <CardHeader className="p-4">
              <CardTitle className="text-base">버전</CardTitle>
              <CardDescription className="text-xs leading-5">저장할 때마다 새 버전이 만들어집니다.</CardDescription>
            </CardHeader>
            <CardContent className="grid max-h-[14rem] gap-2 overflow-y-auto p-4 pt-0">
              {versions.map((version) => (
                <div key={version.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border bg-background/70 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-bold">v{version.version || '-'}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{compactDateTime(version.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {version.published ? <Badge tone="mint">게시</Badge> : <Badge tone="neutral">초안</Badge>}
                    <Button type="button" variant="outline" size="sm" onClick={() => restoreVersion(version.id)}>
                      복원
                    </Button>
                  </div>
                </div>
              ))}
              {!versions.length ? <div className="rounded-[var(--radius-control)] border bg-background/55 p-4 text-sm text-muted-foreground">저장된 버전이 없습니다.</div> : null}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/74 shadow-subtle">
            <CardHeader className="p-4">
              <CardTitle className="text-base">실행 기록</CardTitle>
              <CardDescription className="text-xs leading-5">최근 테스트와 실행 결과입니다.</CardDescription>
            </CardHeader>
            <CardContent className="grid max-h-[16rem] gap-2 overflow-y-auto p-4 pt-0">
              {runs.map((run) => (
                <button key={run.id} type="button" onClick={() => loadRunSteps(run.id)} className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-left text-sm transition hover:border-primary/35">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{run.triggerSource || 'manual'}</span>
                    <Badge tone={run.status === 'done' ? 'mint' : run.status === 'failed' ? 'coral' : 'neutral'}>{run.status || 'running'}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{compactDateTime(run.startedAt)}</div>
                  {run.error ? <div className="mt-2 text-xs text-destructive">{run.error}</div> : null}
                </button>
              ))}
              {!runs.length ? <div className="rounded-[var(--radius-control)] border bg-background/55 p-4 text-sm text-muted-foreground">아직 실행 기록이 없습니다.</div> : null}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/74 shadow-subtle">
            <CardHeader className="p-4">
              <CardTitle className="text-base">실행 단계</CardTitle>
              <CardDescription className="text-xs leading-5">실행된 순서를 따라가며 어떤 반응이 나갔는지 살펴봅니다.</CardDescription>
            </CardHeader>
            <CardContent className="grid max-h-[18rem] gap-2 overflow-y-auto p-4 pt-0">
              {runSteps.map((step) => (
                <div key={step.id} className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">{step.nodeType} · {step.nodeId}</span>
                    <Badge tone={step.status === 'failed' ? 'coral' : 'mint'}>{step.status || 'done'}</Badge>
                  </div>
                  <div className="mt-1 text-muted-foreground">{step.durationMs ?? 0}ms</div>
                  {step.error ? <div className="mt-2 text-destructive">{step.error}</div> : null}
                  {step.output ? <pre className="mt-2 max-h-24 overflow-auto rounded-[var(--radius-control)] bg-muted/70 p-2 text-[0.68rem] leading-5">{JSON.stringify(step.output, null, 2)}</pre> : null}
                </div>
              ))}
              {!runSteps.length ? <div className="rounded-[var(--radius-control)] border bg-background/55 p-4 text-sm text-muted-foreground">선택된 실행 단계가 없습니다.</div> : null}
            </CardContent>
          </Card>
        </div>
      </section>
      {contextMenu ? (
        <div
          role="menu"
          data-blueprint-context-menu="true"
          className="fixed z-50 min-w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-control)] border bg-card/96 p-1.5 text-sm shadow-lift backdrop-blur-xl"
          style={{ left: `min(${contextMenu.x}px, calc(100vw - 19rem))`, top: `min(${contextMenu.y}px, calc(100vh - 18rem))` }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {contextNode ? (
            <>
              <div className="px-3 py-2 text-xs font-bold text-muted-foreground">{contextNode.name}</div>
              <ContextMenuButton icon={<Pencil className="h-4 w-4" />} label="수정" onClick={() => editNode(contextNode.id)} />
              <ContextMenuButton icon={<Copy className="h-4 w-4" />} label="복사" onClick={() => void copyNodesByIds([contextNode.id]).then(() => setContextMenu(null))} />
              <ContextMenuButton icon={<Play className="h-4 w-4" />} label="테스트 실행" onClick={() => void testRunFromNode(contextNode.id)} disabled={testing || saving} />
              <ContextMenuButton icon={<Trash2 className="h-4 w-4" />} label="삭제" onClick={() => deleteNodeById(contextNode.id)} disabled={contextNode.type === 'start'} danger />
              <div className="my-1 h-px bg-border" />
            </>
          ) : (
            <>
              <div className="px-3 py-2 text-xs font-bold text-muted-foreground">캔버스</div>
              <ContextMenuButton icon={<Upload className="h-4 w-4" />} label="붙여넣기" onClick={() => void pasteSelection(contextMenu.flowPosition)} />
              <div className="my-1 h-px bg-border" />
            </>
          )}
          <ContextMenuButton icon={<Undo2 className="h-4 w-4" />} label="되돌리기" onClick={undoBlueprint} disabled={!historyCount.past} />
          <ContextMenuButton icon={<Redo2 className="h-4 w-4" />} label="다시 실행" onClick={redoBlueprint} disabled={!historyCount.future} />
        </div>
      ) : null}
      <Dialog.Root open={!!editingNode} onOpenChange={(open) => {
        if (!open) setEditingNodeId(null);
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/24 backdrop-blur-[clamp(0.5rem,1.4vw,1rem)] data-[state=open]:animate-fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[min(86svh,48rem)] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[var(--radius-panel)] border bg-card text-card-foreground shadow-lift outline-none data-[state=open]:animate-scale-in">
            {editingNode ? (
              <>
                <div className="border-b bg-card p-[clamp(1rem,2vw,1.35rem)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <Dialog.Title className="break-keep text-xl font-extrabold leading-tight">노드 수정</Dialog.Title>
                      <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
                        {nodeSpec(editingNode.type).title} 노드의 실행 값을 수정합니다.
                      </Dialog.Description>
                    </div>
                    <Dialog.Close asChild>
                      <Button type="button" variant="outline" size="icon" aria-label="닫기">
                        <X className="h-4 w-4" />
                      </Button>
                    </Dialog.Close>
                  </div>
                </div>
                <div className="grid max-h-[calc(min(86svh,48rem)-8rem)] gap-4 overflow-y-auto p-[clamp(1rem,2vw,1.35rem)]">
                  <label className="grid min-w-0 gap-2 text-sm font-semibold">
                    노드 이름
                    <Input value={editingNode.name} onChange={(event) => updateNodeNameById(editingNode.id, event.target.value)} className="w-full min-w-0" />
                  </label>
                  <NodeReferencePanel node={editingNode} />
                  <ConfigFields
                    node={editingNode}
                    onChange={(key, value) => updateNodeConfigById(editingNode.id, key, value)}
                    automationOverview={automationOverview}
                    automationBusy={automationBusy}
                    onDiscoverAutomation={discoverAutomation}
                    blueprints={blueprints}
                  />
                </div>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function ContextMenuButton({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 rounded-[calc(var(--radius-control)*0.75)] px-3 py-2 text-left text-sm font-semibold transition hover:bg-muted disabled:pointer-events-none disabled:opacity-45',
        danger && 'text-destructive hover:bg-destructive/10',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function CopyTokenButton({ value, label = value, title }: { value: string; label?: string; title?: string }) {
  const copy = async () => {
    await navigator.clipboard?.writeText(value).catch(() => undefined);
    toast.success('복사했습니다.');
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-muted/80 px-2.5 py-1 font-mono text-[0.68rem] font-bold text-foreground/80 ring-1 ring-border/60 transition hover:bg-primary/12 hover:text-primary hover:ring-primary/25"
      title={title || `${value} 복사`}
    >
      <Copy className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function NodeReferencePanel({ node }: { node: BlueprintNode }) {
  const spec = nodeSpec(node.type);
  const details = nodeOutputDetails(node);
  return (
    <section className="overflow-hidden rounded-[var(--radius-control)] border bg-card shadow-subtle">
      <div className="border-b bg-background/55 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">노드 참조</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-extrabold text-foreground">{spec.title}</span>
              {spec.hidden ? <Badge tone="neutral">호환 노드</Badge> : null}
              <Badge tone={spec.tone}>{details.length}개 변수</Badge>
            </div>
          </div>
          <CopyTokenButton value={node.id} label="ID 복사" title={`${node.id} 복사`} />
        </div>
        <div className="mt-2 rounded-[calc(var(--radius-control)*0.8)] bg-muted/55 px-2.5 py-2">
          <code className="break-all font-mono text-[0.72rem] font-bold text-foreground">{node.id}</code>
        </div>
      </div>
      <div className="grid gap-2 p-3">
        {details.map((item) => (
          <article key={item.value} className="grid gap-2 rounded-[calc(var(--radius-control)*0.85)] border bg-background/72 p-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-foreground">{item.title}</p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.description}</p>
              </div>
              <CopyTokenButton value={item.value} label="복사" title={`${item.value} 복사`} />
            </div>
            <code className="block min-w-0 break-all rounded-[calc(var(--radius-control)*0.7)] bg-muted/55 px-2.5 py-2 font-mono text-[0.7rem] font-bold text-foreground/86">{item.value}</code>
          </article>
        ))}
        {spec.hidden ? (
          <p className="rounded-[calc(var(--radius-control)*0.85)] border border-dashed bg-background/60 p-3 text-xs leading-5 text-muted-foreground">
            새 액션에서는 조건문, 대기, 로그, 오버레이 표시 노드로 대체하는 것을 권장합니다. 기존 저장본은 계속 실행됩니다.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ConfigFields({
  node,
  onChange,
  automationOverview,
  automationBusy,
  onDiscoverAutomation,
  blueprints = [],
}: {
  node: BlueprintNode;
  onChange: (key: string, value: unknown) => void;
  automationOverview?: AutomationOverview | null;
  automationBusy?: string | null;
  onDiscoverAutomation?: (type: 'tits' | 'vtube' | 'obs') => void;
  blueprints?: Blueprint[];
}) {
  const cfg = node.config || {};
  const automationConnections = automationOverview?.connections || [];
  const titsConnection = automationConnections.find((item) => item.type === 'tits') || null;
  const vtubeConnection = automationConnections.find((item) => item.type === 'vtube_studio') || null;
  const obsConnections = automationConnections.filter((item) => item.type === 'obs' && item.enabled !== false);
  const selectedObsConnection = obsConnections.find((item) => item.id === cfg.connectionId) || obsConnections[0] || null;
  const hasOnlineLocalAgent = (automationOverview?.localAgents || []).some((agent) => agent.status === 'online');
  const soundFiles = automationOverview?.soundStorage?.files || [];
  const fxAssets = automationOverview?.fxAssets || [];
  const [ttsVoices, setTtsVoices] = useState<Array<{ value: string; label: string }>>([]);
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return undefined;
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setTtsVoices(voices.map((voice) => ({
        value: voice.name,
        label: `${voice.name}${voice.lang ? ` · ${voice.lang}` : ''}${voice.default ? ' · 기본' : ''}`,
      })));
    };
    loadVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', loadVoices);
  }, []);
  if (node.type === 'condition' || node.type === 'rouletteCompare') {
    return (
      <div className="grid gap-3">
        {node.type === 'condition' ? (
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-muted/30 p-3 shadow-subtle">
            <div className="min-w-0">
              <div className="text-sm font-extrabold">조건에 사용할 변수</div>
              <div className="text-xs font-medium leading-5 text-muted-foreground">좌변이나 우변에 넣을 수 있는 치환 변수를 모아봅니다.</div>
            </div>
            <CommandVariableHelpButton />
          </div>
        ) : null}
        <Field label="좌변" value={String(cfg.left || '')} onChange={(value) => onChange('left', value)} />
        <label className="grid gap-2 text-sm font-semibold">
          연산자
          <select value={String(cfg.operator || 'eq')} onChange={(event) => onChange('operator', event.target.value)} className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-background px-3 text-sm">
            {operators.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <Field label="우변" value={String(cfg.right || '')} onChange={(value) => onChange('right', value)} />
      </div>
    );
  }
  if (node.type === 'setVariable') {
    return (
      <div className="grid gap-3">
        <Field label="변수 이름" value={String(cfg.key || '')} onChange={(value) => onChange('key', value)} />
        <label className="grid gap-2 text-sm font-semibold">
          연산
          <select value={String(cfg.mode || 'set')} onChange={(event) => onChange('mode', event.target.value)} className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-background px-3 text-sm">
            {['set', 'add', 'subtract', 'multiply', 'divide', 'append'].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <Field label="값/계산식" value={String(cfg.value || '')} onChange={(value) => onChange('value', value)} />
      </div>
    );
  }
  if (node.type === 'random') {
    const options = Array.isArray(cfg.options) ? cfg.options as Array<{ id?: string; label?: string; weight?: number }> : [];
    return (
      <div className="grid gap-3">
        {options.map((option, index) => (
          <div key={option.id || index} className="grid gap-2 rounded-[var(--radius-control)] border bg-background/70 p-3">
            <Field label="포트 ID" value={String(option.id || '')} onChange={(value) => onChange('options', options.map((item, i) => i === index ? { ...item, id: value } : item))} />
            <Field label="라벨" value={String(option.label || '')} onChange={(value) => onChange('options', options.map((item, i) => i === index ? { ...item, label: value } : item))} />
            <Field label="가중치" value={String(option.weight ?? 1)} onChange={(value) => onChange('options', options.map((item, i) => i === index ? { ...item, weight: Number(value || 0) } : item))} />
            <Button type="button" variant="outline" size="sm" onClick={() => onChange('options', options.filter((_, i) => i !== index))} disabled={options.length <= 2}>
              <Trash2 className="h-4 w-4" />
              분기 삭제
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => onChange('options', [...options, { id: `o${options.length + 1}`, label: `분기 ${options.length + 1}`, weight: 1 }])}>
          <Plus className="h-4 w-4" />
          분기 추가
        </Button>
      </div>
    );
  }
  if (node.type === 'chat') return <LongField label="메시지" value={String(cfg.message || '')} onChange={(value) => onChange('message', value)} />;
  if (node.type === 'tts') {
    return (
      <div className="grid gap-3">
        <div className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
          TTS는 OBS에 추가한 FX 오버레이 브라우저 소스에서 재생됩니다. 방송에 소리가 나가려면 해당 브라우저 소스의 오디오가 OBS에서 활성화되어 있어야 합니다.
        </div>
        <LongField label="말할 내용" value={String(cfg.text || '')} onChange={(value) => onChange('text', value)} />
        {ttsVoices.length ? (
          <SelectField
            label="목소리"
            value={String(cfg.voice || '')}
            onChange={(value) => onChange('voice', value)}
            placeholder="오버레이 브라우저의 기본 목소리"
            options={ttsVoices}
          />
        ) : (
          <Field label="목소리" value={String(cfg.voice || '')} onChange={(value) => onChange('voice', value)} />
        )}
        <Field label="속도" value={String(cfg.rate || 1)} onChange={(value) => onChange('rate', value)} />
        <Field label="높낮이" value={String(cfg.pitch || 1)} onChange={(value) => onChange('pitch', value)} />
      </div>
    );
  }
  if (node.type === 'fx') {
    const kind = typeof cfg.kind === 'string' ? cfg.kind : 'image';
    const normalizedKind = kind.trim().toLowerCase();
    const assets = normalizedKind
      ? fxAssets.filter((asset) => asset.kind === normalizedKind || (normalizedKind === 'sticker' && asset.kind === 'image'))
      : fxAssets;
    const selectedAsset = fxAssets.find((asset) => asset.id === cfg.assetId);
    const chromaKeyColor = String(cfg.chromaKeyColor || '#00ff00');
    const pickColor = async () => {
      type EyeDropperConstructor = new () => { open: () => Promise<{ sRGBHex: string }> };
      const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper;
      if (!EyeDropper) return;
      const result = await new EyeDropper().open().catch(() => null);
      if (result?.sRGBHex) onChange('chromaKeyColor', result.sRGBHex);
    };
    return (
      <div className="grid gap-3">
        <ExampleField
          label="FX 종류"
          value={kind}
          onChange={(value) => {
            onChange('kind', value);
            onChange('assetId', '');
            onChange('assetName', '');
          }}
          placeholder="비워두거나 image, sticker, video, sound"
          examples={['image', 'sticker', 'video', 'sound']}
        />
        {normalizedKind === 'video' ? <Field label="YouTube 링크" value={String(cfg.youtubeUrl || '')} onChange={(value) => onChange('youtubeUrl', value)} /> : null}
        <SelectField
          label={normalizedKind === 'sound' ? '사운드 에셋' : normalizedKind === 'video' ? '로컬 비디오 에셋' : normalizedKind ? '이미지/스티커 에셋' : 'FX 에셋'}
          value={String(cfg.assetId || '')}
          onChange={(value) => {
            const asset = fxAssets.find((item) => item.id === value);
            onChange('assetId', value);
            onChange('assetName', asset?.name || '');
            onChange('assetKind', asset?.kind || '');
          }}
          placeholder={assets.length ? '로컬 에셋 선택' : '로컬 프로그램에서 에셋 목록을 불러오세요'}
          options={assets.map((asset) => ({ value: asset.id, label: asset.name || asset.id }))}
        />
        {selectedAsset?.previewDataUrl ? (
          <div className="rounded-[var(--radius-control)] border bg-background/70 p-3">
            <img src={selectedAsset.previewDataUrl} alt="" className="max-h-36 max-w-full rounded-[calc(var(--radius-control)*0.8)] object-contain" />
          </div>
        ) : null}
        {normalizedKind !== 'sound' ? (
          <>
            <div className="relative overflow-hidden rounded-[var(--radius-control)] border bg-card p-3 shadow-subtle">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] border bg-card/78 text-primary shadow-subtle">
                    <Move className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold">배치와 크기</div>
                    <div className="text-xs font-medium text-muted-foreground">%와 px를 항목별로 섞어 쓸 수 있습니다.</div>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <LengthField
                  label="위치 X"
                  value={String(cfg.x ?? 50)}
                  unit={String(cfg.xUnit || '%')}
                  onValueChange={(value) => onChange('x', value)}
                  onUnitChange={(unit) => onChange('xUnit', unit)}
                />
                <LengthField
                  label="위치 Y"
                  value={String(cfg.y ?? 50)}
                  unit={String(cfg.yUnit || '%')}
                  onValueChange={(value) => onChange('y', value)}
                  onUnitChange={(unit) => onChange('yUnit', unit)}
                />
                <LengthField
                  label="너비"
                  value={String(cfg.width ?? 28)}
                  unit={String(cfg.widthUnit || '%')}
                  onValueChange={(value) => onChange('width', value)}
                  onUnitChange={(unit) => onChange('widthUnit', unit)}
                />
                <LengthField
                  label="높이"
                  value={String(cfg.height ?? 28)}
                  unit={String(cfg.heightUnit || '%')}
                  onValueChange={(value) => onChange('height', value)}
                  onUnitChange={(unit) => onChange('heightUnit', unit)}
                />
              </div>
            </div>
            <ExampleField
              label="등장 CSS animation"
              value={String(cfg.enterCss || '')}
              onChange={(value) => onChange('enterCss', value)}
              placeholder="비워두면 애니메이션 없음"
              examples={['fx-pop-in 360ms ease-out both', 'fx-slide-up 420ms ease-out both', 'fx-spin-in 520ms cubic-bezier(.2,.8,.2,1) both', 'fade-in 280ms ease-out both']}
            />
            <ExampleField
              label="퇴장 CSS animation"
              value={String(cfg.exitCss || '')}
              onChange={(value) => onChange('exitCss', value)}
              placeholder="비워두면 애니메이션 없음"
              examples={['fx-fade-out 280ms ease-in both', 'fade-out 280ms ease-in both', 'fx-slide-up 260ms ease-in reverse both', 'fx-pop-in 240ms ease-in reverse both']}
            />
            <Field label="적용할 CSS 키" value={String(cfg.animationKey || '')} onChange={(value) => onChange('animationKey', value)} />
            <LongField label="CSS 코드" value={String(cfg.cssCode || '')} onChange={(value) => onChange('cssCode', value)} />
            <label className="flex items-center gap-2 rounded-[var(--radius-control)] border bg-background/70 p-3 text-sm font-semibold">
              <input type="checkbox" checked={cfg.chromaKey === true} onChange={(event) => onChange('chromaKey', event.target.checked)} />
              크로마키 사용
            </label>
            {cfg.chromaKey === true ? (
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <label className="grid gap-2 text-sm font-semibold">
                  크로마키 색
                  <input type="color" value={chromaKeyColor} onChange={(event) => onChange('chromaKeyColor', event.target.value)} className="min-h-[var(--control-height)] w-full rounded-[var(--radius-control)] border bg-background p-1" />
                </label>
                <Button type="button" variant="outline" onClick={pickColor}>스포이드</Button>
                <Field label="허용 오차" value={String(cfg.chromaKeyTolerance ?? 42)} onChange={(value) => onChange('chromaKeyTolerance', value)} />
              </div>
            ) : null}
          </>
        ) : null}
        <Field label={normalizedKind === 'sound' ? '볼륨(0-1)' : '유지 시간(ms)'} value={String(normalizedKind === 'sound' ? cfg.volume ?? 1 : cfg.durationMs ?? 4000)} onChange={(value) => onChange(normalizedKind === 'sound' ? 'volume' : 'durationMs', value)} />
      </div>
    );
  }
  if (node.type === 'overlay') {
    return (
      <div className="grid gap-3">
        <LongField label="표시 내용" value={String(cfg.text || '')} onChange={(value) => onChange('text', value)} />
        <Field label="표시 시간(ms)" value={String(cfg.durationMs || 4000)} onChange={(value) => onChange('durationMs', value)} />
        <Field label="오버레이 ID(비워두면 자동 생성)" value={String(cfg.overlayId || '')} onChange={(value) => onChange('overlayId', value)} />
        <LongField label="CSS 코드" value={String(cfg.cssCode || '')} onChange={(value) => onChange('cssCode', value)} />
        <Field label="적용할 CSS 키" value={String(cfg.animationKey || '')} onChange={(value) => onChange('animationKey', value)} />
        <ExampleField
          label="CSS animation"
          value={String(cfg.animation || '')}
          onChange={(value) => onChange('animation', value)}
          placeholder="예: my-pop 420ms ease-out both"
          examples={['my-pop 420ms ease-out both', 'fade-in 280ms ease-out both', 'slide-soft 520ms cubic-bezier(.2,.8,.2,1) both']}
        />
      </div>
    );
  }
  if (node.type === 'loop') {
    return (
      <div className="grid gap-3">
        <Field label="반복 횟수" value={String(cfg.count || 1)} onChange={(value) => onChange('count', value)} />
        <Field label="반복 간격(ms)" value={String(cfg.gapMs || 0)} onChange={(value) => onChange('gapMs', value)} />
      </div>
    );
  }
  if (node.type === 'parallel') {
    return (
      <div className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
        출력 포트 하나에 여러 노드를 연결하면 동시에 실행됩니다. 출력 포트를 빈 공간으로 끌어도 기존 연결은 유지되고, 입력 포트에서 빈 공간으로 끌면 해당 연결만 해제됩니다.
      </div>
    );
  }
  if (node.type === 'pointsAdjust') {
    return (
      <div className="grid gap-3">
        <Field label="시청자 UUID" value={String(cfg.userId || '')} onChange={(value) => onChange('userId', value)} />
        <Field label="변경 포인트" value={String(cfg.delta || '')} onChange={(value) => onChange('delta', value)} />
      </div>
    );
  }
  if (node.type === 'pointsEnough' || node.type === 'pointsExcluded') {
    return (
      <div className="grid gap-3">
        <Field label="시청자 UUID" value={String(cfg.userId || '')} onChange={(value) => onChange('userId', value)} />
        {node.type === 'pointsEnough' ? <Field label="필요 포인트" value={String(cfg.required || '')} onChange={(value) => onChange('required', value)} /> : null}
      </div>
    );
  }
  if (node.type === 'pointsGet' || node.type === 'attendanceGet') return <Field label="시청자 UUID" value={String(cfg.userId || '')} onChange={(value) => onChange('userId', value)} />;
  if (node.type === 'pointsRanking') return <Field label="조회 인원" value={String(cfg.limit || 10)} onChange={(value) => onChange('limit', value)} />;
  if (node.type === 'rouletteRun') return <Field label="룰렛 이름 또는 ID" value={String(cfg.name || '')} onChange={(value) => onChange('name', value)} />;
  if (node.type === 'rouletteDisplay') {
    return (
      <div className="grid gap-3">
        <LongField label="표시 문구" value={String(cfg.text || '')} onChange={(value) => onChange('text', value)} />
        <Field label="표시 시간(ms)" value={String(cfg.durationMs || 4000)} onChange={(value) => onChange('durationMs', value)} />
        <Field label="오버레이 ID(비워두면 자동 생성)" value={String(cfg.overlayId || '')} onChange={(value) => onChange('overlayId', value)} />
        <LongField label="CSS 코드" value={String(cfg.cssCode || '')} onChange={(value) => onChange('cssCode', value)} />
        <Field label="적용할 CSS 키" value={String(cfg.animationKey || '')} onChange={(value) => onChange('animationKey', value)} />
        <ExampleField
          label="CSS animation"
          value={String(cfg.animation || '')}
          onChange={(value) => onChange('animation', value)}
          placeholder="예: roulette-pop 420ms ease-out both"
          examples={['roulette-pop 420ms ease-out both', 'fade-in 280ms ease-out both', 'slide-soft 520ms cubic-bezier(.2,.8,.2,1) both']}
        />
      </div>
    );
  }
  if (node.type === 'action') {
    const runnableBlueprints = blueprints.filter((item) => item.enabled !== false);
    return runnableBlueprints.length ? (
      <SelectField
        label="실행할 블루프린트"
        value={String(cfg.actionId || '')}
        onChange={(value) => onChange('actionId', value)}
        placeholder="블루프린트 선택"
        options={runnableBlueprints.map((item) => ({
          value: item.slug || item.id || '',
          label: `${item.name}${item.version?.published ? ' · 게시됨' : ''}`,
        })).filter((item) => item.value)}
      />
    ) : (
      <Field label="실행할 액션 ID" value={String(cfg.actionId || '')} onChange={(value) => onChange('actionId', value)} />
    );
  }
  if (node.type === 'wait') return <Field label="대기 시간(초)" value={String(cfg.seconds || 0)} onChange={(value) => onChange('seconds', value)} />;
  if (node.type === 'cooldown') {
    return (
      <div className="grid gap-3">
        <Field label="쿨다운 키" value={String(cfg.key || '')} onChange={(value) => onChange('key', value)} />
        <Field label="제한 시간(초)" value={String(cfg.seconds || 30)} onChange={(value) => onChange('seconds', value)} />
      </div>
    );
  }
  if (node.type === 'approval') return <LongField label="승인 메시지" value={String(cfg.message || '')} onChange={(value) => onChange('message', value)} />;
  if (node.type === 'timer') return <Field label="예약 시간(초)" value={String(cfg.seconds || 10)} onChange={(value) => onChange('seconds', value)} />;
  if (node.type === 'chatVote') {
    return (
      <div className="grid gap-3">
        <Field label="투표 시간(초)" value={String(cfg.seconds || 30)} onChange={(value) => onChange('seconds', value)} />
        <Field label="선택지" value={String(cfg.options || '1,2')} onChange={(value) => onChange('options', value)} />
      </div>
    );
  }
  if (node.type === 'highlight') return <Field label="마커 이름" value={String(cfg.label || '')} onChange={(value) => onChange('label', value)} />;
  if (node.type === 'overlayUpdate' || node.type === 'overlayHide') {
    return (
      <div className="grid gap-3">
        <Field label="오버레이 ID" value={String(cfg.overlayId || '')} onChange={(value) => onChange('overlayId', value)} />
        {node.type === 'overlayUpdate' ? (
          <>
            <LongField label="새 표시 내용" value={String(cfg.text || '')} onChange={(value) => onChange('text', value)} />
            <Field label="진행률" value={String(cfg.progress || '')} onChange={(value) => onChange('progress', value)} />
            <LongField label="CSS 코드" value={String(cfg.cssCode || '')} onChange={(value) => onChange('cssCode', value)} />
            <Field label="적용할 CSS 키" value={String(cfg.animationKey || '')} onChange={(value) => onChange('animationKey', value)} />
            <ExampleField
              label="CSS animation"
              value={String(cfg.animation || '')}
              onChange={(value) => onChange('animation', value)}
              placeholder="비워두면 현재 애니메이션 유지"
              examples={['my-pop 420ms ease-out both', 'fade-in 280ms ease-out both', 'slide-soft 520ms cubic-bezier(.2,.8,.2,1) both']}
            />
          </>
        ) : null}
      </div>
    );
  }
  if (node.type === 'http') {
    return (
      <div className="grid gap-3">
        <SelectField
          label="메서드"
          value={String(cfg.method || 'POST').toUpperCase()}
          onChange={(value) => onChange('method', value)}
          options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => ({ value: method, label: method }))}
        />
        <Field label="URL" value={String(cfg.url || '')} onChange={(value) => onChange('url', value)} />
        <LongField label="Headers(JSON)" value={typeof cfg.headers === 'object' ? JSON.stringify(cfg.headers, null, 2) : String(cfg.headers || '{}')} onChange={(value) => onChange('headers', value)} />
        <LongField label="Body" value={String(cfg.body || '{}')} onChange={(value) => onChange('body', value)} />
        <Field label="타임아웃(ms)" value={String(cfg.timeoutMs || 10000)} onChange={(value) => onChange('timeoutMs', value)} />
        <label className="flex items-center gap-2 rounded-[var(--radius-control)] border bg-background/70 p-3 text-sm font-semibold">
          <input type="checkbox" checked={cfg.allowInsecureHttp === true} onChange={(event) => onChange('allowInsecureHttp', event.target.checked)} />
          HTTP URL 허용
        </label>
        <div className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
          외부 HTTPS 웹훅을 권장합니다. localhost, 사설망, 내부 IP 대역은 보안상 로컬 프로그램에서 차단됩니다.
        </div>
      </div>
    );
  }
  if (node.type === 'websocket') {
    return (
      <div className="grid gap-3">
        <Field label="URL" value={String(cfg.url || '')} onChange={(value) => onChange('url', value)} />
        <LongField label="메시지" value={String(cfg.message || '{}')} onChange={(value) => onChange('message', value)} />
        <Field label="타임아웃(ms)" value={String(cfg.timeoutMs || 8000)} onChange={(value) => onChange('timeoutMs', value)} />
        <label className="flex items-center gap-2 rounded-[var(--radius-control)] border bg-background/70 p-3 text-sm font-semibold">
          <input type="checkbox" checked={cfg.allowInsecureWebSocket === true} onChange={(event) => onChange('allowInsecureWebSocket', event.target.checked)} />
          WS URL 허용
        </label>
        <div className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
          외부 WSS 연결을 권장합니다. ws:// 연결은 명시적으로 허용한 경우에만 실행되며, localhost와 사설망 주소는 외부 요청으로 사용되지 않습니다.
        </div>
      </div>
    );
  }
  if (node.type === 'udp') {
    return (
      <div className="grid gap-3">
        <Field label="호스트" value={String(cfg.host || '127.0.0.1')} onChange={(value) => onChange('host', value)} />
        <Field label="포트" value={String(cfg.port || '')} onChange={(value) => onChange('port', value)} />
        <LongField label="메시지" value={String(cfg.message || '')} onChange={(value) => onChange('message', value)} />
        <Field label="타임아웃(ms)" value={String(cfg.timeoutMs || 3000)} onChange={(value) => onChange('timeoutMs', value)} />
      </div>
    );
  }
  if (node.type === 'obs') {
    const discovery = selectedObsConnection?.discoveryCache || {};
    const scenes = discovery.scenes || [];
    const sources = discovery.sources || [];
    const filters = discovery.filters || [];
    const hotkeys = discovery.hotkeys || [];
    const transitions = discovery.transitions || [];
    const action = String(cfg.action || 'scene.switch');
    const needsScene = obsSceneActions.has(action) || obsSceneSourceActions.has(action);
    const needsSource = obsSceneSourceActions.has(action) || obsFilterActions.has(action) || obsInputActions.has(action) || obsMediaActions.has(action);
    const needsFilter = obsFilterActions.has(action);
    const sceneOptions = scenes.map((scene) => ({ value: scene.name, label: `${scene.name}${scene.current ? ' · 현재' : ''}` }));
    const sourceOptions = sources
      .filter((source) => !obsSceneSourceActions.has(action) || !cfg.sceneName || source.sceneName === cfg.sceneName || !source.sceneName)
      .map((source) => ({ value: source.name, label: `${source.name}${source.sceneName ? ` · ${source.sceneName}` : ''}` }));
    const filterOptions = filters
      .filter((filter) => !cfg.sourceName || filter.sourceName === cfg.sourceName || !filter.sourceName)
      .map((filter) => ({ value: filter.name, label: `${filter.name}${filter.sourceName ? ` · ${filter.sourceName}` : ''}` }));
    const transitionOptions = transitions.map((transition) => ({ value: transition.name, label: `${transition.name}${transition.current ? ' · 현재' : ''}` }));
    const hotkeyOptions = hotkeys.map((hotkey) => ({ value: hotkey.name || hotkey.id, label: hotkey.name || hotkey.id }));
    return (
      <div className="grid gap-3">
        <AutomationDiscoveryHeader
          title="OBS Studio"
          connection={selectedObsConnection}
          hasOnlineLocalAgent={hasOnlineLocalAgent}
          busy={automationBusy === 'obs.discover'}
          onDiscover={() => onDiscoverAutomation?.('obs')}
        />
        {obsConnections.length ? (
          <SelectField
            label="연결할 OBS"
            value={String(cfg.connectionId || selectedObsConnection?.id || '')}
            onChange={(value) => onChange('connectionId', value)}
            placeholder="OBS 연결 선택"
            options={obsConnections.map((connection) => ({ value: connection.id, label: connection.name || connection.endpoint || connection.id }))}
          />
        ) : (
          <Field label="연결 ID" value={String(cfg.connectionId || '')} onChange={(value) => onChange('connectionId', value)} />
        )}
        <SelectField
          label="동작"
          value={action}
          onChange={(value) => onChange('action', value)}
          options={OBS_ACTION_OPTIONS.map((item) => ({ value: item.value, label: `${item.group} · ${item.label}` }))}
        />
        {needsScene ? (
          <SelectField
            label="장면 이름"
            value={String(cfg.sceneName || '')}
            onChange={(value) => onChange('sceneName', value)}
            placeholder={sceneOptions.length ? '장면 선택' : 'OBS 목록을 먼저 불러오세요'}
            options={sceneOptions}
          />
        ) : null}
        {needsSource ? (
          <SelectField
            label={obsInputActions.has(action) || obsMediaActions.has(action) ? '소스/입력 이름' : '소스 이름'}
            value={String(cfg.sourceName || '')}
            onChange={(value) => onChange('sourceName', value)}
            placeholder={sourceOptions.length ? '소스 또는 입력 선택' : 'OBS 목록을 먼저 불러오세요'}
            options={sourceOptions}
          />
        ) : null}
        {needsFilter ? (
          <SelectField
            label="필터 이름"
            value={String(cfg.filterName || '')}
            onChange={(value) => onChange('filterName', value)}
            placeholder={filterOptions.length ? '필터 선택' : '필터가 필요한 동작에서 선택'}
            options={filterOptions}
          />
        ) : null}
        {action === 'input.volume' ? <Field label="볼륨(0-2)" value={String(cfg.volume ?? 1)} onChange={(value) => onChange('volume', value)} /> : null}
        {action === 'input.text' || action === 'stream.caption' ? <LongField label="텍스트" value={String(cfg.text || '')} onChange={(value) => onChange('text', value)} /> : null}
        {action === 'input.settings' ? (
          <LongField label="입력 설정 JSON" value={String(cfg.inputSettingsJson || '{\n  "text": "새 문구"\n}')} onChange={(value) => onChange('inputSettingsJson', value)} />
        ) : null}
        {action === 'record.chapter' ? <Field label="챕터 이름" value={String(cfg.chapterName || '')} onChange={(value) => onChange('chapterName', value)} /> : null}
        {action === 'transition.set' ? (
          <SelectField
            label="전환 효과"
            value={String(cfg.transitionName || '')}
            onChange={(value) => onChange('transitionName', value)}
            placeholder={transitionOptions.length ? '전환 효과 선택' : 'OBS 목록을 먼저 불러오세요'}
            options={transitionOptions}
          />
        ) : null}
        {action === 'transition.duration' ? <Field label="전환 시간(ms)" value={String(cfg.durationMs || 300)} onChange={(value) => onChange('durationMs', value)} /> : null}
        {action === 'hotkey.trigger' ? (
          <SelectField
            label="OBS 핫키"
            value={String(cfg.hotkeyName || '')}
            onChange={(value) => onChange('hotkeyName', value)}
            placeholder={hotkeyOptions.length ? '핫키 선택' : 'OBS 목록을 먼저 불러오세요'}
            options={hotkeyOptions}
          />
        ) : null}
      </div>
    );
  }
  if (node.type === 'sound') {
    return (
      <div className="grid gap-3">
        {soundFiles.length ? (
          <SelectField
            label="사운드 파일"
            value={String(cfg.fileId || '')}
            onChange={(value) => onChange('fileId', value)}
            placeholder="사운드 선택"
            options={soundFiles.map((file) => ({ value: file.id, label: file.name || file.id }))}
          />
        ) : (
          <Field label="사운드 파일 ID" value={String(cfg.fileId || '')} onChange={(value) => onChange('fileId', value)} />
        )}
        <Field label="볼륨" value={String(cfg.volume || 1)} onChange={(value) => onChange('volume', value)} />
      </div>
    );
  }
  if (node.type === 'tits') {
    const triggers = titsConnection?.discoveryCache?.triggers || [];
    const items = titsConnection?.discoveryCache?.items || [];
    return (
      <div className="grid gap-3">
        <AutomationDiscoveryHeader
          title="T.I.T.S. 트리거"
          connection={titsConnection}
          hasOnlineLocalAgent={hasOnlineLocalAgent}
          busy={automationBusy === 'tits.discover'}
          onDiscover={() => onDiscoverAutomation?.('tits')}
        />
        {triggers.length ? (
          <SelectField
            label="실행할 트리거"
            value={String(cfg.triggerId || '')}
            onChange={(value) => {
              const trigger = triggers.find((item) => item.id === value);
              onChange('triggerId', value);
              if (trigger?.name) onChange('triggerName', trigger.name);
            }}
            placeholder="트리거 선택"
            options={triggers.map((trigger) => ({ value: trigger.id, label: trigger.name || trigger.id }))}
          />
        ) : (
          <Field label="트리거 ID" value={String(cfg.triggerId || '')} onChange={(value) => onChange('triggerId', value)} />
        )}
        {items.length ? (
          <SelectField
            label="참고: 불러온 아이템"
            value={String(cfg.itemId || '')}
            onChange={(value) => onChange('itemId', value)}
            placeholder="아이템을 선택해 메모"
            options={items.map((item) => ({ value: item.id, label: item.name || item.id }))}
          />
        ) : null}
        <Field label="강도" value={String(cfg.strength || 1)} onChange={(value) => onChange('strength', value)} />
        <Field label="지속 시간(ms)" value={String(cfg.durationMs || 1000)} onChange={(value) => onChange('durationMs', value)} />
      </div>
    );
  }
  if (node.type === 'vtube') {
    const discovery = vtubeConnection?.discoveryCache;
    const hotkeys = discovery?.hotkeys || [];
    const expressions = discovery?.expressions || [];
    const models = discovery?.models || [];
    const parameters = discovery?.parameters || [];
    return (
      <div className="grid gap-3">
        <AutomationDiscoveryHeader
          title="VTube Studio 반응"
          connection={vtubeConnection}
          hasOnlineLocalAgent={hasOnlineLocalAgent}
          busy={automationBusy === 'vtube.discover'}
          onDiscover={() => onDiscoverAutomation?.('vtube')}
        />
        {discovery?.currentModel?.name ? (
          <div className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
            현재 모델: <span className="font-bold text-foreground">{discovery.currentModel.name}</span>
          </div>
        ) : null}
        {models.length ? (
          <SelectField
            label="참고: 불러온 모델"
            value={String(cfg.modelId || '')}
            onChange={(value) => onChange('modelId', value)}
            placeholder="모델을 선택해 메모"
            options={models.map((model) => ({ value: model.id, label: `${model.name || model.id}${model.loaded ? ' · 로드됨' : ''}` }))}
          />
        ) : null}
        <SelectField
          label="실행할 핫키"
          value={String(cfg.hotkeyId || '')}
          onChange={(value) => {
            const hotkey = hotkeys.find((item) => item.id === value);
            onChange('hotkeyId', value);
            if (hotkey?.name) onChange('hotkeyName', hotkey.name);
          }}
          placeholder={hotkeys.length ? '핫키 선택' : '목록을 먼저 불러오세요'}
          options={hotkeys.map((hotkey) => ({ value: hotkey.id, label: hotkey.name || hotkey.id }))}
        />
        {expressions.length ? (
          <SelectField
            label="참고: 표정 파일"
            value={String(cfg.expressionFile || '')}
            onChange={(value) => onChange('expressionFile', value)}
            placeholder="표정 파일을 선택해 메모"
            options={expressions.map((expression) => ({ value: expression.file || expression.name, label: `${expression.name || expression.file}${expression.active ? ' · 활성' : ''}` }))}
          />
        ) : null}
        <SelectField
          label="변경할 파라미터"
          value={String(cfg.parameter || '')}
          onChange={(value) => {
            const parameter = parameters.find((item) => item.id === value || item.name === value);
            onChange('parameter', value);
            if (parameter?.name) onChange('parameterName', parameter.name);
          }}
          placeholder={parameters.length ? '파라미터 선택' : '목록을 먼저 불러오세요'}
          options={parameters.map((parameter) => {
            const range = parameter.min != null || parameter.max != null
              ? ` · ${parameter.min ?? '-'}~${parameter.max ?? '-'}`
              : '';
            return {
              value: parameter.id || parameter.name,
              label: `${parameter.name || parameter.id}${range}`,
            };
          }).filter((option) => option.value)}
        />
        <Field label="값" value={String(cfg.value || '')} onChange={(value) => onChange('value', value)} />
      </div>
    );
  }
  if (node.type === 'log') return <LongField label="기록할 메시지" value={String(cfg.message || '')} onChange={(value) => onChange('message', value)} />;
  return (
    <div className="grid gap-3">
      {Object.entries(cfg).map(([key, value]) => (
        <Field key={key} label={key} value={typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')} onChange={(next) => onChange(key, next)} />
      ))}
      {!Object.keys(cfg).length ? <div className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-sm text-muted-foreground">설정할 항목이 없습니다.</div> : null}
    </div>
  );
}

function AutomationDiscoveryHeader({
  title,
  connection,
  hasOnlineLocalAgent,
  busy,
  onDiscover,
}: {
  title: string;
  connection: AutomationConnection | null;
  hasOnlineLocalAgent: boolean;
  busy: boolean;
  onDiscover: () => void;
}) {
  const cache = connection?.discoveryCache;
  return (
    <div className="grid gap-3 rounded-[var(--radius-control)] border bg-background/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold">{title}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {cache?.fetchedAt ? `${compactDateTime(cache.fetchedAt)} 불러옴` : '아직 로컬 프로그램 목록을 불러오지 않았습니다.'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={hasOnlineLocalAgent ? 'mint' : 'neutral'}>{hasOnlineLocalAgent ? '로컬 연결됨' : '로컬 대기'}</Badge>
          {connection?.endpoint ? <Badge tone="neutral">{connection.endpoint}</Badge> : null}
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onDiscover} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        로컬 프로그램에서 목록 불러오기
      </Button>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <label className="grid min-w-0 gap-2 text-sm font-semibold">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[var(--control-height)] w-full min-w-0 rounded-[var(--radius-control)] border bg-background px-3 text-sm outline-none transition focus:border-primary/45 focus:ring-2 focus:ring-ring"
      >
        <option value="">{placeholder || '선택'}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

type FxLengthUnit = '%' | 'px';

function normalizeFxLengthUnit(unit: string): FxLengthUnit {
  return unit === 'px' ? 'px' : '%';
}

function LengthField({
  label,
  value,
  unit,
  onValueChange,
  onUnitChange,
}: {
  label: string;
  value: string;
  unit: string;
  onValueChange: (value: string) => void;
  onUnitChange: (unit: FxLengthUnit) => void;
}) {
  const selectedUnit = normalizeFxLengthUnit(unit);
  return (
    <label className="grid min-w-0 gap-2 text-sm font-semibold">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="text-[0.7rem] font-bold uppercase tracking-normal text-muted-foreground">{selectedUnit}</span>
      </span>
      <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius-control)] border bg-background/76 shadow-[inset_0_1px_0_hsl(var(--card)/0.82)] transition focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-ring">
        <Input
          value={value}
          inputMode="decimal"
          onChange={(event) => onValueChange(event.target.value)}
          className="min-h-[var(--control-height)] rounded-none border-0 bg-transparent shadow-none focus:border-transparent focus:ring-0"
        />
        <span className="flex items-center gap-1 border-l bg-card/70 p-1">
          {(['%', 'px'] as FxLengthUnit[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={selectedUnit === option}
              onClick={() => onUnitChange(option)}
              className={cn(
                'grid h-8 min-w-9 place-items-center rounded-[calc(var(--radius-control)*0.72)] px-2 text-xs font-extrabold tabular-nums transition',
                selectedUnit === option
                  ? 'bg-primary text-primary-foreground shadow-subtle'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {option}
            </button>
          ))}
        </span>
      </span>
    </label>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid min-w-0 gap-2 text-sm font-semibold">
      {label}
      <Input value={value} onChange={(event) => onChange(event.target.value)} className="w-full min-w-0" />
    </label>
  );
}

function ExampleField({
  label,
  value,
  onChange,
  placeholder,
  examples,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  examples: string[];
}) {
  const reactId = useId();
  const datalistId = `example-${reactId.replace(/:/g, '-')}`;
  return (
    <label className="grid min-w-0 gap-2 text-sm font-semibold">
      {label}
      <Input
        value={value}
        list={datalistId}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-w-0"
      />
      <datalist id={datalistId}>
        {examples.map((example) => (
          <option key={example} value={example} />
        ))}
      </datalist>
      <span className="text-xs font-medium text-muted-foreground">예: {examples.join(' / ')}</span>
    </label>
  );
}

function LongField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid min-w-0 gap-2 text-sm font-semibold">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="box-border min-h-[7rem] w-full min-w-0 max-w-full resize-y rounded-[var(--radius-control)] border bg-background/80 px-[clamp(0.85rem,1.6vw,1.1rem)] py-[clamp(0.85rem,1.6vw,1.1rem)] text-sm leading-7 outline-none transition focus:border-primary/45 focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}
