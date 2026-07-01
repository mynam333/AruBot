'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { toast } from 'sonner';
import {
  Bot,
  Cable,
  CheckCircle2,
  Copy,
  Database,
  Download,
  HardDrive,
  Headphones,
  Loader2,
  MonitorUp,
  MousePointerClick,
  Play,
  RadioTower,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  Wand2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { apiUrl, readJson } from '@/shared/api/http';
import { cn } from '@/shared/lib/utils';

type ExecutionMode = 'oracle_direct' | 'local_program';
type SoundStorageMode = 'server_hosted' | 'local_program';

type AutomationSettings = {
  integrationMode?: ExecutionMode;
  soundStorageMode?: SoundStorageMode;
  queueBackend?: string;
  secretPolicy?: string;
  tts?: {
    enabled?: boolean;
    provider?: string;
    voice?: string;
    rate?: number;
    pitch?: number;
  };
};

type AutomationConnection = {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  executionMode: ExecutionMode;
  endpoint?: string;
  config?: Record<string, unknown>;
  discoveryCache?: {
    items?: Array<{ id: string; name: string; encodedImage?: string | null }>;
    triggers?: Array<{ id: string; name: string }>;
    fetchedAt?: string;
  };
  lastStatus?: string | null;
};

type SoundStorage = {
  quotaBytes: number;
  usedBytes: number;
  files: Array<{ id: string; name: string; size: number; updatedAt: string; url: string }>;
};

type Overview = {
  settings: AutomationSettings;
  connections: AutomationConnection[];
  localAgents?: Array<{
    id: string;
    name: string;
    status: string;
    lastSeenAt: string | null;
  }>;
  soundStorage: SoundStorage;
  supportedConnectors: string[];
  disabledConnectors: string[];
};

const LOCAL_SECRET_KEY = 'arubot.automation.localSecrets.v1';

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)}KB`;
  return `${value}B`;
}

async function jsonRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || 'request_failed');
  return data as T;
}

function readLocalSecrets() {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(LOCAL_SECRET_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeLocalSecret(key: string, value: string) {
  if (typeof window === 'undefined') return;
  const next = { ...readLocalSecrets(), [key]: value };
  window.localStorage.setItem(LOCAL_SECRET_KEY, JSON.stringify(next));
}

function SegmentedButton({
  active,
  title,
  description,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group grid gap-3 rounded-[var(--radius-card)] border bg-card/70 p-[clamp(1rem,1.7vw,1.25rem)] text-left transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-subtle',
        active && 'border-primary/40 bg-pastel-mint/60 shadow-subtle dark:bg-primary/15',
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-background text-primary shadow-subtle">
          <Icon className="h-5 w-5" />
        </span>
        {active ? <CheckCircle2 className="h-5 w-5 text-primary" /> : null}
      </span>
      <span>
        <span className="block text-sm font-bold">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

export function AutomationsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<ExecutionMode>('oracle_direct');
  const [soundMode, setSoundMode] = useState<SoundStorageMode>('server_hosted');
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsVoice, setTtsVoice] = useState('');
  const [ttsRate, setTtsRate] = useState('1');
  const [ttsPitch, setTtsPitch] = useState('1');
  const [titsEndpoint, setTitsEndpoint] = useState('ws://localhost:42069');
  const [toonationKey, setToonationKey] = useState('');
  const [controlLabel, setControlLabel] = useState('방송 액션 실행');
  const [controlUrl, setControlUrl] = useState('');
  const [localProgramName, setLocalProgramName] = useState('방송 PC');
  const [localProgramToken, setLocalProgramToken] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const connections = overview?.connections || [];
  const titsConnection = connections.find((item) => item.type === 'tits');
  const storage = overview?.soundStorage;
  const storageRatio = storage ? Math.min(100, Math.round((storage.usedBytes / Math.max(1, storage.quotaBytes)) * 100)) : 0;

  const load = useCallback(async () => {
    setLoading(true);
    const data = await readJson<Overview>('/api/automations/overview');
    if (data) {
      setOverview(data);
      setMode(data.settings.integrationMode === 'local_program' ? 'local_program' : 'oracle_direct');
      setSoundMode(data.settings.soundStorageMode === 'local_program' ? 'local_program' : 'server_hosted');
      setTtsEnabled(data.settings.tts?.enabled !== false);
      setTtsVoice(data.settings.tts?.voice || '');
      setTtsRate(String(data.settings.tts?.rate || 1));
      setTtsPitch(String(data.settings.tts?.pitch || 1));
      const savedTits = data.connections.find((item) => item.type === 'tits');
      if (savedTits?.endpoint) setTitsEndpoint(savedTits.endpoint);
    }
    const local = readLocalSecrets() as Record<string, string>;
    setToonationKey(local.toonationAlertboxKey || '');
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const data = await jsonRequest<{ settings: AutomationSettings }>('/api/automations/settings', 'PUT', {
        integrationMode: mode,
        soundStorageMode: soundMode,
        tts: {
          enabled: ttsEnabled,
          provider: mode === 'local_program' ? 'local_program' : 'browser',
          voice: ttsVoice,
          rate: Number(ttsRate || 1),
          pitch: Number(ttsPitch || 1),
        },
      });
      setOverview((current) => current ? { ...current, settings: data.settings } : current);
      toast.success('자동화 설정을 저장했습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '설정을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const saveToonationKey = () => {
    writeLocalSecret('toonationAlertboxKey', toonationKey.trim());
    toast.success('투네이션 알림 키를 이 브라우저에 저장했습니다.');
  };

  const discoverTits = async () => {
    setBusyAction('tits');
    try {
      const connection = titsConnection || (await jsonRequest<{ connection: AutomationConnection }>('/api/automations/connections', 'POST', {
        type: 'tits',
        name: 'T.I.T.S.',
        executionMode: mode,
        endpoint: titsEndpoint,
      }).then((data) => data.connection));
      const data = await jsonRequest<{ queued?: boolean; discovery?: AutomationConnection['discoveryCache']; message?: string }>('/api/automations/tits/discover', 'POST', {
        executionMode: mode,
        endpoint: titsEndpoint,
        connectionId: connection.id,
        name: 'T.I.T.S.',
        sendImage: true,
      });
      if (data.queued) {
        toast.info(data.message || '로컬 프로그램으로 목록 동기화를 요청했습니다.');
      } else {
        toast.success('T.I.T.S. 아이템과 트리거 목록을 불러왔습니다.');
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'T.I.T.S. 목록을 불러오지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const testToonation = async () => {
    if (!toonationKey.trim()) {
      toast.error('투네이션 Alertbox 키를 먼저 입력해 주세요.');
      return;
    }
    saveToonationKey();
    setBusyAction('toonation');
    try {
      await jsonRequest('/api/automations/connections', 'POST', {
        type: 'toonation_alertbox',
        name: 'Toonation 후원 알림',
        executionMode: 'local_program',
        config: { keyStorage: 'localStorage', events: ['donation'] },
      });
      const data = await jsonRequest<{ queued?: boolean; message?: string }>('/api/automations/toonation/test', 'POST', {
        executionMode: 'local_program',
      });
      toast.success(data.queued ? '로컬 프로그램에 투네이션 테스트를 요청했습니다.' : '투네이션 설정을 저장했습니다.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '투네이션 연결을 확인하지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const testTts = async () => {
    setBusyAction('tts');
    try {
      await jsonRequest('/api/automations/tts/test', 'POST', {
        text: '아루봇 음성 안내 테스트입니다.',
        voice: ttsVoice,
        rate: Number(ttsRate || 1),
        pitch: Number(ttsPitch || 1),
      });
      toast.success('로컬 프로그램에 TTS 테스트를 요청했습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'TTS 테스트를 요청하지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const testSound = async (fileId: string) => {
    setBusyAction(`sound-test:${fileId}`);
    try {
      await jsonRequest('/api/automations/sounds/test', 'POST', { fileId });
      toast.success('로컬 프로그램에 사운드 재생을 요청했습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '사운드 테스트를 요청하지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const createControlLink = async () => {
    setBusyAction('control');
    try {
      const data = await jsonRequest<{ url: string }>('/api/automations/control-links', 'POST', { label: controlLabel });
      setControlUrl(data.url);
      await navigator.clipboard?.writeText(data.url).catch(() => undefined);
      toast.success('제어 URL을 만들고 복사했습니다.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '제어 URL을 만들지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const createLocalProgramToken = async () => {
    setBusyAction('local-program');
    try {
      const data = await jsonRequest<{ token: string; backendUrl: string }>('/api/automations/local-agents/pair', 'POST', {
        name: localProgramName,
      });
      const command = `백엔드 주소: ${data.backendUrl}\n토큰: ${data.token}`;
      setLocalProgramToken(command);
      await navigator.clipboard?.writeText(command).catch(() => undefined);
      toast.success('로컬 프로그램 연결 정보가 생성되어 복사되었습니다.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '로컬 프로그램 토큰을 만들지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const uploadSound = async (file?: File) => {
    if (!file) return;
    setBusyAction('sound');
    try {
      const response = await fetch(apiUrl(`/api/automations/assets/sounds?name=${encodeURIComponent(file.name)}`), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.guidance || data?.error || 'upload_failed');
      toast.success('사운드 파일을 업로드했습니다.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '사운드 파일을 업로드하지 못했습니다.');
    } finally {
      setBusyAction(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const deleteSound = async (fileId: string) => {
    setBusyAction(fileId);
    try {
      await fetch(apiUrl(`/api/automations/assets/sounds/${encodeURIComponent(fileId)}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      toast.success('사운드 파일을 삭제했습니다.');
      await load();
    } catch {
      toast.error('사운드 파일을 삭제하지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const titsItems = titsConnection?.discoveryCache?.items || [];
  const titsTriggers = titsConnection?.discoveryCache?.triggers || [];

  return (
    <div className="grid gap-[clamp(1rem,2vw,1.5rem)]">
      <section className="overflow-hidden rounded-[var(--radius-panel)] border bg-[radial-gradient(circle_at_15%_10%,hsl(var(--accent-mint)/0.68),transparent_30%),radial-gradient(circle_at_86%_16%,hsl(var(--accent-coral)/0.55),transparent_28%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-sky)/0.26))] p-[clamp(1.25rem,3vw,2rem)] shadow-soft">
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(18rem,0.38fr)] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="mint">방송 자동화</Badge>
              <Badge tone="sky">Postgres Queue</Badge>
              <Badge tone="lemon">Local Secret</Badge>
            </div>
            <h1 className="mt-4 max-w-3xl break-keep text-3xl font-semibold leading-tight md:text-5xl">
              방송 도구를 한 번의 액션으로 자연스럽게 이어주세요.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              T.I.T.S., 투네이션 후원 알림, TTS, 사운드, Stream Deck과 Touch Portal 제어를 아루봇 자동화 흐름으로 연결합니다.
            </p>
          </div>
          <Card className="bg-card/75">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                저장 원칙
              </CardTitle>
              <CardDescription>민감한 키는 서버에 저장하지 않고, 일반 설정만 DB에 저장합니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 text-sm">
                <div className="flex items-center justify-between rounded-[var(--radius-control)] bg-background/70 px-3 py-2">
                  <span>큐</span>
                  <strong>무료 Postgres</strong>
                </div>
                <div className="flex items-center justify-between rounded-[var(--radius-control)] bg-background/70 px-3 py-2">
                  <span>사운드</span>
                  <strong>기본 10MB</strong>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <SegmentedButton
          active={mode === 'oracle_direct'}
          title="오라클 직접 연동 모드"
          description="Oracle 백엔드가 접근 가능한 HTTPS/WebSocket/UDP 대상에 직접 요청합니다. 공개 API와 서버형 Webhook에 적합합니다."
          icon={RadioTower}
          onClick={() => setMode('oracle_direct')}
        />
        <SegmentedButton
          active={mode === 'local_program'}
          title="로컬 프로그램 모드"
          description="방송 PC의 아루봇 로컬 프로그램이 OBS, T.I.T.S., VTube Studio, 로컬 파일과 민감한 키를 처리합니다."
          icon={MonitorUp}
          onClick={() => setMode('local_program')}
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cable className="h-5 w-5 text-primary" />
              연결과 실행 방식
            </CardTitle>
            <CardDescription>로컬 앱은 두 모드 중 하나로 실행합니다. 민감한 값은 로컬 저장소 또는 로컬 프로그램에만 둡니다.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid gap-2 text-sm font-semibold">
              T.I.T.S. WebSocket 주소
              <Input value={titsEndpoint} onChange={(event) => setTitsEndpoint(event.target.value)} placeholder="ws://localhost:42069" />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={discoverTits} disabled={busyAction === 'tits'}>
                {busyAction === 'tits' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                T.I.T.S. 목록 동기화
              </Button>
              <Button type="button" variant="outline" onClick={saveSettings} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                설정 저장
              </Button>
            </div>
            <div className="grid gap-3 rounded-[var(--radius-card)] border bg-background/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold">로컬 프로그램 연결</div>
                  <div className="mt-1 text-xs text-muted-foreground">GUI 프로그램에 입력할 백엔드 주소와 1회용 토큰을 발급합니다.</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <LinkButton href="/downloads/local-program" variant="outline" size="sm">
                    <Download className="h-4 w-4" />
                    다운로드
                  </LinkButton>
                  <Badge tone={(overview?.localAgents || []).some((agent) => agent.status === 'online') ? 'mint' : 'neutral'}>
                    {(overview?.localAgents || []).length}대 등록
                  </Badge>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                <Input value={localProgramName} onChange={(event) => setLocalProgramName(event.target.value)} placeholder="방송 PC" />
                <Button type="button" variant="outline" onClick={createLocalProgramToken} disabled={busyAction === 'local-program'}>
                  {busyAction === 'local-program' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                  토큰 발급
                </Button>
              </div>
              {localProgramToken ? (
                <code className="block whitespace-pre-wrap rounded-[var(--radius-control)] bg-muted p-3 text-xs leading-5 text-muted-foreground">
                  {localProgramToken}
                </code>
              ) : null}
              <div className="grid gap-2">
                {(overview?.localAgents || []).map((agent) => (
                  <div key={agent.id} className="flex items-center justify-between rounded-[var(--radius-control)] border bg-card/70 p-3">
                    <div>
                      <div className="text-sm font-semibold">{agent.name}</div>
                      <div className="text-xs text-muted-foreground">{agent.lastSeenAt ? new Date(agent.lastSeenAt).toLocaleString('ko-KR') : '아직 연결 기록 없음'}</div>
                    </div>
                    <Badge tone={agent.status === 'online' ? 'mint' : 'neutral'}>{agent.status === 'online' ? '온라인' : '오프라인'}</Badge>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-3 rounded-[var(--radius-card)] border bg-background/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold">T.I.T.S. 동기화 결과</div>
                  <div className="mt-1 text-xs text-muted-foreground">{titsConnection?.discoveryCache?.fetchedAt ? `마지막 동기화 ${new Date(titsConnection.discoveryCache.fetchedAt).toLocaleString('ko-KR')}` : '아직 동기화된 목록이 없습니다.'}</div>
                </div>
                <Badge tone={titsItems.length || titsTriggers.length ? 'mint' : 'neutral'}>{titsItems.length}개 아이템 · {titsTriggers.length}개 트리거</Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <select className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-card px-3 text-sm">
                  <option>아이템 선택</option>
                  {titsItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-card px-3 text-sm">
                  <option>트리거 선택</option>
                  {titsTriggers.map((trigger) => <option key={trigger.id || trigger.name} value={trigger.id}>{trigger.name}</option>)}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              투네이션과 TTS
            </CardTitle>
            <CardDescription>투네이션 Alertbox 키는 이 브라우저나 로컬 프로그램에만 저장합니다.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid gap-2 text-sm font-semibold">
              투네이션 Alertbox 키
              <Input value={toonationKey} onChange={(event) => setToonationKey(event.target.value)} placeholder="toon.at/widget/alertbox/ 뒤의 키" />
            </label>
            <Button type="button" variant="outline" onClick={testToonation} disabled={busyAction === 'toonation'}>
              {busyAction === 'toonation' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              로컬 저장 후 연결 준비
            </Button>
            <div className="grid gap-3 rounded-[var(--radius-card)] border bg-background/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold">TTS</div>
                  <div className="mt-1 text-xs text-muted-foreground">후원, 룰렛, 예측 결과를 음성으로 읽어줍니다.</div>
                </div>
                <button
                  type="button"
                  className={cn('rounded-full border px-3 py-1 text-xs font-bold transition', ttsEnabled ? 'bg-pastel-mint text-teal-900' : 'bg-muted text-muted-foreground')}
                  onClick={() => setTtsEnabled((value) => !value)}
                >
                  {ttsEnabled ? '사용 중' : '꺼짐'}
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Input value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)} placeholder="음성 이름" />
                <Input value={ttsRate} onChange={(event) => setTtsRate(event.target.value)} inputMode="decimal" placeholder="속도" />
                <Input value={ttsPitch} onChange={(event) => setTtsPitch(event.target.value)} inputMode="decimal" placeholder="피치" />
              </div>
              <Button type="button" variant="outline" onClick={testTts} disabled={busyAction === 'tts'}>
                {busyAction === 'tts' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                로컬 프로그램에서 테스트
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Volume2 className="h-5 w-5 text-primary" />
              사운드 저장소
            </CardTitle>
            <CardDescription>기본 서버 저장소는 사용자별 10MB까지 제공합니다. 더 큰 라이브러리는 로컬 프로그램 모드를 사용하세요.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">{formatBytes(storage?.usedBytes || 0)} 사용</span>
                <span className="text-muted-foreground">{formatBytes(storage?.quotaBytes || 0)}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--primary)),hsl(var(--accent)))] transition-all" style={{ width: `${storageRatio}%` }} />
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <SegmentedButton active={soundMode === 'server_hosted'} title="서버 저장" description="10MB까지 빠르게 사용" icon={Database} onClick={() => setSoundMode('server_hosted')} />
              <SegmentedButton active={soundMode === 'local_program'} title="내 PC 저장" description="대용량 파일은 로컬 호스팅" icon={HardDrive} onClick={() => setSoundMode('local_program')} />
            </div>
            <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={(event) => uploadSound(event.target.files?.[0])} />
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={busyAction === 'sound' || soundMode !== 'server_hosted'}>
              {busyAction === 'sound' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              사운드 업로드
            </Button>
            <div className="grid gap-2">
              {(storage?.files || []).map((file) => (
                <div key={file.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-background/70 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{file.name}</div>
                    <div className="text-xs text-muted-foreground">{formatBytes(file.size)}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Tooltip content="로컬 프로그램에서 테스트">
                      <Button type="button" variant="ghost" size="icon" onClick={() => testSound(file.id)} aria-label="사운드 테스트">
                        {busyAction === `sound-test:${file.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      </Button>
                    </Tooltip>
                    <Tooltip content="삭제">
                      <Button type="button" variant="ghost" size="icon" onClick={() => deleteSound(file.id)} aria-label="사운드 삭제">
                        {busyAction === file.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              ))}
              {!(storage?.files || []).length ? <div className="rounded-[var(--radius-control)] border bg-background/70 p-4 text-sm text-muted-foreground">아직 업로드한 사운드가 없습니다.</div> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MousePointerClick className="h-5 w-5 text-primary" />
              Stream Deck / Touch Portal
            </CardTitle>
            <CardDescription>HTTP 요청 액션에 아래 URL을 넣으면 버튼 한 번으로 아루봇 자동화 이벤트를 실행할 수 있습니다.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid gap-2 text-sm font-semibold">
              버튼 이름
              <Input value={controlLabel} onChange={(event) => setControlLabel(event.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={createControlLink} disabled={busyAction === 'control'}>
                {busyAction === 'control' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                제어 URL 만들기
              </Button>
              {controlUrl ? (
                <Button type="button" variant="outline" onClick={() => navigator.clipboard?.writeText(controlUrl)}>
                  <Copy className="h-4 w-4" />
                  복사
                </Button>
              ) : null}
            </div>
            {controlUrl ? (
              <div className="rounded-[var(--radius-card)] border bg-background/70 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-bold">
                  <Play className="h-4 w-4 text-primary" />
                  POST 또는 GET
                </div>
                <code className="block break-all rounded-[var(--radius-control)] bg-muted p-3 text-xs leading-5 text-muted-foreground">{controlUrl}</code>
              </div>
            ) : null}
            <div className="grid gap-2">
              {connections.filter((item) => item.type === 'stream_deck_touch_portal').map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-[var(--radius-control)] border bg-background/70 p-3">
                  <span className="text-sm font-semibold">{item.name}</span>
                  <Badge tone="sky">HTTP 버튼</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            지원 정책
          </CardTitle>
          <CardDescription>SOOP, SSAPI, Twip은 현재 제품 범위에서 제외했습니다. Toonation, T.I.T.S., TTS, 제어 버튼은 실제 사용 흐름에 맞춰 제공합니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[var(--radius-card)] border bg-background/70 p-4">
              <Headphones className="mb-3 h-5 w-5 text-primary" />
              <div className="text-sm font-bold">음성 안내</div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">브라우저 TTS와 로컬 TTS를 나눠 후원 메시지와 방송 이벤트를 읽어줍니다.</p>
            </div>
            <div className="rounded-[var(--radius-card)] border bg-background/70 p-4">
              <Database className="mb-3 h-5 w-5 text-primary" />
              <div className="text-sm font-bold">저비용 큐</div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">추가 Redis 비용 없이 Postgres 큐로 로컬 프로그램 실행 요청을 보관합니다.</p>
            </div>
            <div className="rounded-[var(--radius-card)] border bg-background/70 p-4">
              <ShieldCheck className="mb-3 h-5 w-5 text-primary" />
              <div className="text-sm font-bold">민감정보 보호</div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">후원 알림 키와 로컬 토큰은 사용자의 브라우저나 로컬 프로그램에서 관리합니다.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/45 backdrop-blur-sm">
          <div className="rounded-[var(--radius-card)] border bg-card p-5 shadow-lift">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
            <div className="mt-3 text-sm font-semibold">자동화 설정을 불러오는 중</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
