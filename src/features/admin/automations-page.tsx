'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { toast } from 'sonner';
import {
  Bot,
  Cable,
  CheckCircle2,
  Copy,
  Database,
  HardDrive,
  Loader2,
  MousePointerClick,
  Play,
  PlugZap,
  RadioTower,
  RefreshCw,
  Save,
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

type ExecutionMode = 'web' | 'local';
type SoundStorageMode = 'managed' | 'local';
type AutomationTab = 'local' | 'obs' | 'tits' | 'vtube' | 'voice' | 'network' | 'control' | 'connections';

type AutomationSettings = {
  integrationMode?: ExecutionMode;
  soundStorageMode?: SoundStorageMode;
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
  capabilities?: Record<string, unknown>;
  discoveryCache?: {
    items?: Array<{ id: string; name: string; encodedImage?: string | null }>;
    triggers?: Array<{ id: string; name: string }>;
    hotkeys?: Array<{ id: string; name: string; type?: string; description?: string }>;
    models?: Array<{ id: string; name: string; loaded?: boolean }>;
    expressions?: Array<{ file?: string; name: string; active?: boolean }>;
    currentModel?: { loaded?: boolean; id?: string; name?: string };
    scenes?: Array<{ id?: string; name: string; current?: boolean }>;
    sources?: Array<{ id?: string; name: string; sceneName?: string; inputKind?: string; enabled?: boolean }>;
    filters?: Array<{ id?: string; name: string; sourceName?: string; kind?: string; enabled?: boolean }>;
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
};

type Blueprint = {
  id: string;
  slug?: string;
  name: string;
  enabled?: boolean;
  version?: { published?: boolean } | null;
};

type ConnectionDraft = {
  name: string;
  endpoint: string;
  enabled: boolean;
};

const tabs: Array<{ id: AutomationTab; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: 'local', label: '로컬 프로그램', icon: Cable },
  { id: 'obs', label: 'OBS', icon: RadioTower },
  { id: 'tits', label: 'T.I.T.S.', icon: Sparkles },
  { id: 'vtube', label: 'VTube Studio', icon: Bot },
  { id: 'voice', label: '음성/사운드', icon: Volume2 },
  { id: 'network', label: 'HTTP/WS/UDP', icon: RadioTower },
  { id: 'control', label: '버튼 URL', icon: MousePointerClick },
  { id: 'connections', label: '연결 목록', icon: PlugZap },
];

function connectionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    obs: 'OBS',
    stream_deck_touch_portal: 'Stream Deck / Touch Portal',
    tits: 'T.I.T.S.',
    vtube_studio: 'VTube Studio',
    tts: 'TTS',
    http: 'HTTP',
    websocket: 'WebSocket',
    udp: 'UDP',
    sound: '사운드',
  };
  return labels[type] || type;
}

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

function TabButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex min-h-[var(--control-height-sm)] w-full shrink-0 items-center justify-center gap-2 rounded-full border px-[clamp(0.75rem,1.4vw,1rem)] text-sm font-bold leading-tight transition hover:-translate-y-0.5 hover:border-primary/35 sm:w-auto',
        active ? 'border-primary/35 bg-pastel-mint text-teal-950 shadow-subtle dark:bg-primary/20 dark:text-teal-50' : 'bg-card/70 text-muted-foreground',
      )}
    >
      <Icon className="h-[1em] w-[1em] shrink-0" />
      <span>{label}</span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid min-w-0 gap-2 text-sm font-semibold">{label}{children}</label>;
}

function Textarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="box-border min-h-[clamp(6.5rem,16svh,10rem)] w-full min-w-0 max-w-full resize-y rounded-[var(--radius-control)] border bg-background/80 px-[clamp(0.85rem,1.6vw,1.1rem)] py-[clamp(0.85rem,1.6vw,1.1rem)] text-sm leading-7 outline-none transition placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-ring"
    />
  );
}

function ToggleRow({
  checked,
  label,
  description,
  onClick,
}: {
  checked: boolean;
  label: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'grid min-w-0 gap-1 rounded-[var(--radius-control)] border p-[clamp(0.8rem,1.5vw,1rem)] text-left transition hover:border-primary/35',
        checked ? 'bg-pastel-mint/70 text-teal-950 dark:bg-primary/15 dark:text-teal-50' : 'bg-background/70 text-muted-foreground',
      )}
    >
      <span className="flex items-center gap-2 text-sm font-bold">
        {checked ? <CheckCircle2 className="h-[1em] w-[1em]" /> : null}
        {label}
      </span>
      {description ? <span className="text-xs leading-5">{description}</span> : null}
    </button>
  );
}

function SecretCopyBlock({ value, empty = '생성된 주소가 없습니다.' }: { value: string; empty?: string }) {
  const copy = async () => {
    if (!value) return;
    await navigator.clipboard?.writeText(value).catch(() => undefined);
    toast.success('주소를 복사했습니다.');
  };

  return (
    <button
      type="button"
      onClick={copy}
      disabled={!value}
      className="group grid min-w-0 gap-2 rounded-[var(--radius-card)] border bg-background/72 p-[clamp(0.9rem,1.6vw,1.15rem)] text-left transition hover:border-primary/35 hover:bg-pastel-sky/35 disabled:cursor-not-allowed disabled:opacity-70"
    >
      <span className="inline-flex items-center gap-2 text-xs font-bold text-muted-foreground">
        <Copy className="h-[1em] w-[1em]" />
        클릭해서 복사
      </span>
      <code className={cn('block break-all text-xs leading-6 text-foreground transition', value && 'blur-sm group-hover:blur-0 group-focus-visible:blur-0')}>
        {value || empty}
      </code>
    </button>
  );
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
        'group grid min-w-0 gap-3 rounded-[var(--radius-card)] border bg-card/70 p-[clamp(1rem,1.7vw,1.25rem)] text-left transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-subtle',
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
  const [activeTab, setActiveTab] = useState<AutomationTab>('local');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<ExecutionMode>('local');
  const [soundMode, setSoundMode] = useState<SoundStorageMode>('managed');
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsVoice, setTtsVoice] = useState('');
  const [ttsRate, setTtsRate] = useState('1');
  const [ttsPitch, setTtsPitch] = useState('1');
  const [ttsText, setTtsText] = useState('아루봇 음성 안내 테스트입니다.');
  const [titsEndpoint, setTitsEndpoint] = useState('ws://localhost:42069');
  const [selectedTitsItem, setSelectedTitsItem] = useState('');
  const [selectedTitsTrigger, setSelectedTitsTrigger] = useState('');
  const [titsThrowAmount, setTitsThrowAmount] = useState('1');
  const [vtubeEndpoint, setVtubeEndpoint] = useState('ws://localhost:8001');
  const [selectedVtubeHotkey, setSelectedVtubeHotkey] = useState('');
  const [obsEndpoint, setObsEndpoint] = useState('ws://localhost:4455');
  const [selectedObsScene, setSelectedObsScene] = useState('');
  const [selectedObsSource, setSelectedObsSource] = useState('');
  const [selectedObsFilter, setSelectedObsFilter] = useState('');
  const [selectedObsAction, setSelectedObsAction] = useState('scene.switch');
  const [controlLabel, setControlLabel] = useState('방송 액션 실행');
  const [controlUrl, setControlUrl] = useState('');
  const [fxViewerUrl, setFxViewerUrl] = useState('');
  const [selectedControlActionId, setSelectedControlActionId] = useState('');
  const [localProgramName, setLocalProgramName] = useState('방송 PC');
  const [localProgramToken, setLocalProgramToken] = useState('');
  const [connectionDrafts, setConnectionDrafts] = useState<Record<string, ConnectionDraft>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [httpMethod, setHttpMethod] = useState('POST');
  const [httpUrl, setHttpUrl] = useState('http://127.0.0.1:8080/action');
  const [httpHeaders, setHttpHeaders] = useState('{}');
  const [httpBody, setHttpBody] = useState('{}');
  const [networkAllowPrivate, setNetworkAllowPrivate] = useState(true);
  const [websocketUrl, setWebsocketUrl] = useState('ws://127.0.0.1:8080');
  const [websocketMessage, setWebsocketMessage] = useState('{}');
  const [udpHost, setUdpHost] = useState('127.0.0.1');
  const [udpPort, setUdpPort] = useState('');
  const [udpMessage, setUdpMessage] = useState('');

  const connections = overview?.connections || [];
  const titsConnection = connections.find((item) => item.type === 'tits');
  const vtubeConnection = connections.find((item) => item.type === 'vtube_studio');
  const obsConnection = connections.find((item) => item.type === 'obs');
  const storage = overview?.soundStorage;
  const storageRatio = storage ? Math.min(100, Math.round((storage.usedBytes / Math.max(1, storage.quotaBytes)) * 100)) : 0;
  const localAgents = overview?.localAgents || [];
  const hasOnlineAgent = localAgents.some((agent) => agent.status === 'online');
  const titsItems = useMemo(() => titsConnection?.discoveryCache?.items || [], [titsConnection]);
  const titsTriggers = useMemo(() => titsConnection?.discoveryCache?.triggers || [], [titsConnection]);
  const vtubeModels = useMemo(() => vtubeConnection?.discoveryCache?.models || [], [vtubeConnection]);
  const vtubeHotkeys = useMemo(() => vtubeConnection?.discoveryCache?.hotkeys || [], [vtubeConnection]);
  const obsScenes = useMemo(() => obsConnection?.discoveryCache?.scenes || [], [obsConnection]);
  const obsSources = useMemo(() => obsConnection?.discoveryCache?.sources || [], [obsConnection]);
  const obsFilters = useMemo(() => obsConnection?.discoveryCache?.filters || [], [obsConnection]);
  const publishedBlueprints = useMemo(
    () => blueprints.filter((item) => item.enabled !== false && item.version?.published),
    [blueprints],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [overviewData, blueprintData] = await Promise.all([
      readJson<Overview>('/api/automations/overview'),
      readJson<{ blueprints?: Blueprint[] }>('/api/action-blueprints'),
    ]);
    if (overviewData) {
      setOverview(overviewData);
      setMode(overviewData.settings.integrationMode === 'web' ? 'web' : 'local');
      setSoundMode(overviewData.settings.soundStorageMode === 'local' ? 'local' : 'managed');
      setTtsEnabled(overviewData.settings.tts?.enabled !== false);
      setTtsVoice(overviewData.settings.tts?.voice || '');
      setTtsRate(String(overviewData.settings.tts?.rate || 1));
      setTtsPitch(String(overviewData.settings.tts?.pitch || 1));
      const savedTits = overviewData.connections.find((item) => item.type === 'tits');
      if (savedTits?.endpoint) setTitsEndpoint(savedTits.endpoint);
      const savedVtube = overviewData.connections.find((item) => item.type === 'vtube_studio');
      if (savedVtube?.endpoint) setVtubeEndpoint(savedVtube.endpoint);
      const savedObs = overviewData.connections.find((item) => item.type === 'obs');
      if (savedObs?.endpoint) setObsEndpoint(savedObs.endpoint);
      setConnectionDrafts(Object.fromEntries(overviewData.connections.map((item) => [
        item.id,
        {
          name: item.name || '',
          endpoint: item.endpoint || '',
          enabled: item.enabled !== false,
        },
      ])));
    }
    const nextBlueprints = blueprintData?.blueprints || [];
    setBlueprints(nextBlueprints);
    const firstPublished = nextBlueprints.find((item) => item.enabled !== false && item.version?.published);
    setSelectedControlActionId((current) => current || firstPublished?.slug || firstPublished?.id || '');
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedTitsItem && titsItems[0]?.id) setSelectedTitsItem(titsItems[0].id);
    if (!selectedTitsTrigger && titsTriggers[0]?.id) setSelectedTitsTrigger(titsTriggers[0].id);
  }, [selectedTitsItem, selectedTitsTrigger, titsItems, titsTriggers]);

  useEffect(() => {
    if (!selectedVtubeHotkey && vtubeHotkeys[0]?.id) setSelectedVtubeHotkey(vtubeHotkeys[0].id);
  }, [selectedVtubeHotkey, vtubeHotkeys]);

  useEffect(() => {
    if (!selectedObsScene && obsScenes[0]?.name) setSelectedObsScene(obsScenes[0].name);
    if (!selectedObsSource && obsSources[0]?.name) setSelectedObsSource(obsSources[0].name);
    if (!selectedObsFilter && obsFilters[0]?.name) setSelectedObsFilter(obsFilters[0].name);
  }, [obsFilters, obsScenes, obsSources, selectedObsFilter, selectedObsScene, selectedObsSource]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const data = await jsonRequest<{ settings: AutomationSettings }>('/api/automations/settings', 'PUT', {
        integrationMode: mode,
        soundStorageMode: soundMode,
        tts: {
          enabled: ttsEnabled,
          provider: mode === 'local' ? 'local' : 'browser',
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

  const ensureTitsConnection = async () => {
    if (titsConnection) return titsConnection;
    const data = await jsonRequest<{ connection: AutomationConnection }>('/api/automations/connections', 'POST', {
      type: 'tits',
      name: 'T.I.T.S.',
      executionMode: mode,
      endpoint: titsEndpoint,
    });
    return data.connection;
  };

  const ensureVtubeConnection = async () => {
    if (vtubeConnection) return vtubeConnection;
    const data = await jsonRequest<{ connection: AutomationConnection }>('/api/automations/connections', 'POST', {
      type: 'vtube_studio',
      name: 'VTube Studio',
      executionMode: 'local',
      endpoint: vtubeEndpoint,
    });
    return data.connection;
  };

  const ensureObsConnection = async () => {
    if (obsConnection) return obsConnection;
    const data = await jsonRequest<{ connection: AutomationConnection }>('/api/automations/connections', 'POST', {
      type: 'obs',
      name: 'OBS Studio',
      executionMode: 'local',
      endpoint: obsEndpoint,
    });
    return data.connection;
  };

  const discoverTits = async () => {
    setBusyAction('tits.discover');
    try {
      const connection = await ensureTitsConnection();
      const data = await jsonRequest<{ queued?: boolean; discovery?: AutomationConnection['discoveryCache']; message?: string }>('/api/automations/tits/discover', 'POST', {
        executionMode: mode,
        endpoint: titsEndpoint,
        connectionId: connection.id,
        name: 'T.I.T.S.',
        sendImage: true,
      });
      toast.success(data.queued ? (data.message || '로컬 프로그램으로 목록을 불러오도록 요청했습니다.') : 'T.I.T.S. 목록을 불러왔습니다.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'T.I.T.S. 목록을 불러오지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const runTitsThrow = async () => {
    if (!selectedTitsItem) return toast.warning('던질 아이템을 선택해 주세요.');
    setBusyAction('tits.throw');
    try {
      await jsonRequest('/api/automations/tits/throw', 'POST', {
        executionMode: mode,
        endpoint: titsEndpoint,
        connectionId: titsConnection?.id || null,
        items: [selectedTitsItem],
        amountOfThrows: Number(titsThrowAmount || 1),
      });
      toast.success(mode === 'local' ? '로컬 프로그램에 아이템 던지기를 요청했습니다.' : 'T.I.T.S. 아이템을 던졌습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '아이템 던지기에 실패했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const runTitsTrigger = async () => {
    if (!selectedTitsTrigger) return toast.warning('실행할 트리거를 선택해 주세요.');
    setBusyAction('tits.trigger');
    try {
      await jsonRequest('/api/automations/tits/trigger', 'POST', {
        executionMode: mode,
        endpoint: titsEndpoint,
        connectionId: titsConnection?.id || null,
        triggerId: selectedTitsTrigger,
      });
      toast.success(mode === 'local' ? '로컬 프로그램에 트리거 실행을 요청했습니다.' : 'T.I.T.S. 트리거를 실행했습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '트리거 실행에 실패했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const discoverVtube = async () => {
    setBusyAction('vtube.discover');
    try {
      const connection = await ensureVtubeConnection();
      const data = await jsonRequest<{ queued?: boolean; discovery?: AutomationConnection['discoveryCache']; message?: string }>('/api/automations/vtube/discover', 'POST', {
        executionMode: 'local',
        endpoint: vtubeEndpoint,
        connectionId: connection.id,
        name: 'VTube Studio',
      });
      toast.success(data.queued ? (data.message || '로컬 프로그램으로 VTube Studio 목록을 불러오도록 요청했습니다.') : 'VTube Studio 목록을 불러왔습니다.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'VTube Studio 목록을 불러오지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const runVtubeHotkey = async () => {
    if (!selectedVtubeHotkey) return toast.warning('실행할 VTube Studio 핫키를 선택해 주세요.');
    setBusyAction('vtube.hotkey');
    try {
      const connection = await ensureVtubeConnection();
      await jsonRequest('/api/automations/vtube/hotkey', 'POST', {
        executionMode: 'local',
        endpoint: vtubeEndpoint,
        connectionId: connection.id,
        hotkeyId: selectedVtubeHotkey,
      });
      toast.success('로컬 프로그램에 VTube Studio 핫키 실행을 요청했습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'VTube Studio 핫키를 실행하지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const discoverObs = async () => {
    setBusyAction('obs.discover');
    try {
      const connection = await ensureObsConnection();
      const data = await jsonRequest<{ queued?: boolean; message?: string }>('/api/automations/obs/discover', 'POST', {
        executionMode: 'local',
        endpoint: obsEndpoint,
        connectionId: connection.id,
        name: 'OBS Studio',
      });
      toast.success(data.queued ? (data.message || '로컬 프로그램으로 OBS 목록을 불러오도록 요청했습니다.') : 'OBS 목록을 불러왔습니다.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'OBS 목록을 불러오지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const runObsAction = async () => {
    setBusyAction('obs.action');
    try {
      const connection = await ensureObsConnection();
      const source = obsSources.find((item) => item.name === selectedObsSource);
      await jsonRequest('/api/automations/run', 'POST', {
        type: 'obs',
        payload: {
          connectionId: connection.id,
          endpoint: obsEndpoint,
          action: selectedObsAction,
          sceneName: selectedObsScene || source?.sceneName || '',
          sourceName: selectedObsSource,
          filterName: selectedObsFilter,
          enabled: true,
        },
      });
      toast.success('로컬 프로그램에 OBS 실행을 요청했습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'OBS 동작을 실행하지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const testTts = async () => {
    setBusyAction('tts');
    try {
      await jsonRequest('/api/automations/tts/test', 'POST', {
        text: ttsText,
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

  const runNetwork = async (type: 'http' | 'websocket' | 'udp') => {
    setBusyAction(`network.${type}`);
    try {
      const payload = type === 'http'
        ? { method: httpMethod, url: httpUrl, headers: httpHeaders, body: httpBody, allowInsecureHttp: httpUrl.startsWith('http://'), allowPrivateNetwork: networkAllowPrivate }
        : type === 'websocket'
          ? { url: websocketUrl, message: websocketMessage, allowInsecureWebSocket: websocketUrl.startsWith('ws://'), allowPrivateNetwork: networkAllowPrivate }
          : { host: udpHost, port: Number(udpPort || 0), message: udpMessage };
      await jsonRequest('/api/automations/run', 'POST', { type, payload });
      toast.success('로컬 프로그램 실행 큐에 추가했습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '네트워크 액션을 실행하지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const createControlLink = async () => {
    if (!selectedControlActionId) return toast.warning('실행할 액션을 선택해 주세요.');
    setBusyAction('control');
    try {
      const data = await jsonRequest<{ url: string }>('/api/automations/control-links', 'POST', {
        label: controlLabel,
        actionId: selectedControlActionId,
      });
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
      const data = await jsonRequest<{ token?: string | null; tokenMasked?: string | null }>('/api/automations/local-agents/pair', 'POST', {
        name: localProgramName,
      });
      if (data.token) {
        setLocalProgramToken(data.token);
        await navigator.clipboard?.writeText(data.token).catch(() => undefined);
        toast.success('로컬 프로그램 토큰이 생성되어 복사되었습니다.');
      } else {
        setLocalProgramToken(data.tokenMasked || '이미 발급됨');
        toast.info('이미 발급된 로컬 프로그램 토큰이 있습니다. 토큰을 잃어버렸다면 재발급해 주세요.');
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '로컬 프로그램 토큰을 만들지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const rotateLocalProgramToken = async () => {
    setBusyAction('local-program-rotate');
    try {
      const data = await jsonRequest<{ token: string }>('/api/automations/local-agents/rotate', 'POST', {
        name: localProgramName,
      });
      setLocalProgramToken(data.token);
      await navigator.clipboard?.writeText(data.token).catch(() => undefined);
      toast.success('로컬 프로그램 토큰을 재발급하고 복사했습니다.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '로컬 프로그램 토큰을 재발급하지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const saveConnection = async (connection: AutomationConnection) => {
    const draft = connectionDrafts[connection.id];
    if (!draft) return;
    setBusyAction(`connection-save:${connection.id}`);
    try {
      await jsonRequest('/api/automations/connections', 'POST', {
        id: connection.id,
        type: connection.type,
        name: draft.name,
        enabled: draft.enabled,
        executionMode: connection.executionMode,
        endpoint: draft.endpoint,
        config: connection.config || {},
        capabilities: connection.capabilities || {},
        discoveryCache: connection.discoveryCache || {},
      });
      toast.success('연결 항목을 수정했습니다.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '연결 항목을 수정하지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const removeConnection = async (connection: AutomationConnection) => {
    if (!window.confirm(`${connection.name || '연결 항목'}을 삭제할까요?`)) return;
    setBusyAction(`connection-delete:${connection.id}`);
    try {
      const response = await fetch(apiUrl(`/api/automations/connections/${encodeURIComponent(connection.id)}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('delete_failed');
      toast.success('연결 항목을 삭제했습니다.');
      await load();
    } catch {
      toast.error('연결 항목을 삭제하지 못했습니다.');
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

  const loadFxViewerUrl = async () => {
    setBusyAction('fx-viewer-url');
    try {
      const data = await readJson<{ path?: string }>('/api/fx/viewer-url');
      const path = data?.path || '';
      const url = path ? new URL(path, window.location.origin).toString() : '';
      setFxViewerUrl(url);
      if (url) {
        await navigator.clipboard?.writeText(url).catch(() => undefined);
        toast.success('FX OBS 주소를 복사했습니다.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'FX OBS 주소를 만들지 못했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  const renderLocalTab = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Cable className="h-5 w-5 text-primary" />실행 방식</CardTitle>
          <CardDescription>방송 PC의 TTS, 사운드, T.I.T.S. 연출을 버튼처럼 실행합니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))]">
            <SegmentedButton active={mode === 'local'} title="방송 PC 실행" description="내 PC의 방송 도구를 바로 움직여요" icon={HardDrive} onClick={() => setMode('local')} />
            <SegmentedButton active={mode === 'web'} title="웹에서 실행" description="외부에서 접근 가능한 도구에 사용해요" icon={Database} onClick={() => setMode('web')} />
          </div>
          <Button type="button" variant="outline" onClick={saveSettings} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            설정 저장
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>로컬 프로그램 연결</CardTitle>
          <CardDescription>생성된 토큰은 한 번만 표시됩니다. 복사해서 로컬 프로그램에 붙여넣으세요.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(var(--control-height),0.32fr)_minmax(var(--control-height),0.32fr)]">
            <Input value={localProgramName} onChange={(event) => setLocalProgramName(event.target.value)} placeholder="방송 PC" />
            <Button type="button" variant="outline" onClick={createLocalProgramToken} disabled={busyAction === 'local-program'}>
              {busyAction === 'local-program' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              토큰 확인
            </Button>
            <Button type="button" variant="destructive" onClick={rotateLocalProgramToken} disabled={busyAction === 'local-program-rotate'}>
              {busyAction === 'local-program-rotate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              재발급
            </Button>
          </div>
          <SecretCopyBlock value={localProgramToken} empty="토큰을 생성하면 여기에 표시됩니다." />
          <div className="grid gap-2">
            {localAgents.map((agent) => (
              <div key={agent.id} className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-background/70 p-[clamp(0.8rem,1.4vw,1rem)]">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{agent.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{agent.lastSeenAt ? new Date(agent.lastSeenAt).toLocaleString('ko-KR') : '아직 연결 기록 없음'}</div>
                </div>
                <Badge tone={agent.status === 'online' ? 'mint' : 'neutral'}>{agent.status === 'online' ? '온라인' : '오프라인'}</Badge>
              </div>
            ))}
            {!localAgents.length ? <div className="rounded-[var(--radius-control)] border bg-background/70 p-4 text-sm text-muted-foreground">등록된 로컬 프로그램이 없습니다.</div> : null}
          </div>
        </CardContent>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />FX 오버레이</CardTitle>
          <CardDescription>OBS 브라우저 소스에 추가하면 실행 액션의 이미지, 비디오, 사운드 효과가 실시간으로 표시됩니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={loadFxViewerUrl} disabled={busyAction === 'fx-viewer-url'}>
              {busyAction === 'fx-viewer-url' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              OBS 주소 만들기
            </Button>
            <LinkButton href="/actions" variant="outline">FX 액션 편집</LinkButton>
          </div>
          <SecretCopyBlock value={fxViewerUrl} empty="OBS 주소를 만들면 여기에 표시됩니다." />
        </CardContent>
      </Card>
    </div>
  );

  const renderObsTab = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RadioTower className="h-5 w-5 text-primary" />OBS 연결</CardTitle>
          <CardDescription>로컬 프로그램이 OBS에서 장면, 소스, 필터 목록을 불러옵니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="OBS WebSocket 주소">
            <Input value={obsEndpoint} onChange={(event) => setObsEndpoint(event.target.value)} placeholder="ws://localhost:4455" />
          </Field>
          <Button type="button" onClick={discoverObs} disabled={busyAction === 'obs.discover'}>
            {busyAction === 'obs.discover' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            장면/소스 불러오기
          </Button>
          <div className="grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))]">
            <Badge tone={obsScenes.length ? 'mint' : 'neutral'}>{obsScenes.length}개 장면</Badge>
            <Badge tone={obsSources.length ? 'mint' : 'neutral'}>{obsSources.length}개 소스</Badge>
            <Badge tone={obsFilters.length ? 'mint' : 'neutral'}>{obsFilters.length}개 필터</Badge>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>OBS 테스트 실행</CardTitle>
          <CardDescription>불러온 목록에서 고른 동작을 실행합니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="동작">
            <select value={selectedObsAction} onChange={(event) => setSelectedObsAction(event.target.value)} className="min-h-[var(--control-height)] w-full min-w-0 rounded-[var(--radius-control)] border bg-background px-[clamp(0.75rem,1.4vw,1rem)] text-sm">
              <option value="scene.switch">장면 전환</option>
              <option value="source.visibility">소스 표시</option>
              <option value="filter.enabled">필터 켜기</option>
              <option value="record.start">녹화 시작</option>
              <option value="record.stop">녹화 중지</option>
              <option value="stream.start">방송 시작</option>
              <option value="stream.stop">방송 종료</option>
              <option value="replay.save">리플레이 저장</option>
            </select>
          </Field>
          <Field label="장면">
            <select value={selectedObsScene} onChange={(event) => setSelectedObsScene(event.target.value)} className="min-h-[var(--control-height)] w-full min-w-0 rounded-[var(--radius-control)] border bg-background px-[clamp(0.75rem,1.4vw,1rem)] text-sm">
              <option value="">장면 선택</option>
              {obsScenes.map((scene) => <option key={scene.id || scene.name} value={scene.name}>{scene.name}{scene.current ? ' · 현재' : ''}</option>)}
            </select>
          </Field>
          <Field label="소스">
            <select value={selectedObsSource} onChange={(event) => setSelectedObsSource(event.target.value)} className="min-h-[var(--control-height)] w-full min-w-0 rounded-[var(--radius-control)] border bg-background px-[clamp(0.75rem,1.4vw,1rem)] text-sm">
              <option value="">소스 선택</option>
              {obsSources.map((source) => <option key={`${source.sceneName || 'global'}:${source.name}`} value={source.name}>{source.name}{source.sceneName ? ` · ${source.sceneName}` : ''}</option>)}
            </select>
          </Field>
          <Field label="필터">
            <select value={selectedObsFilter} onChange={(event) => setSelectedObsFilter(event.target.value)} className="min-h-[var(--control-height)] w-full min-w-0 rounded-[var(--radius-control)] border bg-background px-[clamp(0.75rem,1.4vw,1rem)] text-sm">
              <option value="">필터 선택</option>
              {obsFilters.map((filter) => <option key={`${filter.sourceName || 'source'}:${filter.name}`} value={filter.name}>{filter.name}{filter.sourceName ? ` · ${filter.sourceName}` : ''}</option>)}
            </select>
          </Field>
          <Button type="button" onClick={runObsAction} disabled={busyAction === 'obs.action'}>
            {busyAction === 'obs.action' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            OBS 실행
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  const renderTitsTab = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />T.I.T.S. 연결</CardTitle>
          <CardDescription>T.I.T.S. 아이템과 트리거를 불러와 바로 선택합니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="WebSocket 주소">
            <Input value={titsEndpoint} onChange={(event) => setTitsEndpoint(event.target.value)} placeholder="ws://localhost:42069" />
          </Field>
          <Button type="button" onClick={discoverTits} disabled={busyAction === 'tits.discover'}>
            {busyAction === 'tits.discover' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            목록 불러오기
          </Button>
          <div className="grid gap-2 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
            <Badge tone={titsItems.length ? 'mint' : 'neutral'}>{titsItems.length}개 아이템</Badge>
            <Badge tone={titsTriggers.length ? 'mint' : 'neutral'}>{titsTriggers.length}개 트리거</Badge>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>아이템/트리거 실행</CardTitle>
          <CardDescription>선택한 아이템과 트리거를 실행합니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,0.42fr)]">
            <Field label="던질 아이템">
              <select value={selectedTitsItem} onChange={(event) => setSelectedTitsItem(event.target.value)} className="min-h-[var(--control-height)] w-full min-w-0 rounded-[var(--radius-control)] border bg-background px-[clamp(0.75rem,1.4vw,1rem)] text-sm">
                <option value="">아이템 선택</option>
                {titsItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="수량">
              <Input value={titsThrowAmount} onChange={(event) => setTitsThrowAmount(event.target.value)} inputMode="numeric" />
            </Field>
          </div>
          <Button type="button" variant="outline" onClick={runTitsThrow} disabled={busyAction === 'tits.throw' || !selectedTitsItem}>
            {busyAction === 'tits.throw' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            아이템 던지기
          </Button>
          <Field label="실행 트리거">
            <select value={selectedTitsTrigger} onChange={(event) => setSelectedTitsTrigger(event.target.value)} className="min-h-[var(--control-height)] w-full min-w-0 rounded-[var(--radius-control)] border bg-background px-[clamp(0.75rem,1.4vw,1rem)] text-sm">
              <option value="">트리거 선택</option>
              {titsTriggers.map((trigger) => <option key={trigger.id || trigger.name} value={trigger.id}>{trigger.name}</option>)}
            </select>
          </Field>
          <Button type="button" variant="outline" onClick={runTitsTrigger} disabled={busyAction === 'tits.trigger' || !selectedTitsTrigger}>
            {busyAction === 'tits.trigger' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            트리거 실행
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  const renderVtubeTab = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-primary" />VTube Studio 연결</CardTitle>
          <CardDescription>VTube Studio 모델, 핫키, 표정 목록을 불러옵니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="WebSocket 주소">
            <Input value={vtubeEndpoint} onChange={(event) => setVtubeEndpoint(event.target.value)} placeholder="ws://localhost:8001" />
          </Field>
          <div className="grid gap-2 rounded-[var(--radius-card)] border bg-background/70 p-[clamp(0.9rem,1.6vw,1.15rem)] text-sm leading-6 text-muted-foreground">
            <div className="font-semibold text-foreground">연결 전 확인</div>
            <div>VTube Studio 설정에서 Plugin API access를 켠 뒤, 로컬 프로그램에서 인증 요청을 허용하세요.</div>
          </div>
          <Button type="button" onClick={discoverVtube} disabled={busyAction === 'vtube.discover'}>
            {busyAction === 'vtube.discover' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            모델/핫키 불러오기
          </Button>
          <div className="grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))]">
            <Badge tone={vtubeConnection?.discoveryCache?.currentModel?.loaded ? 'mint' : 'neutral'}>
              {vtubeConnection?.discoveryCache?.currentModel?.name || '모델 대기'}
            </Badge>
            <Badge tone={vtubeModels.length ? 'mint' : 'neutral'}>{vtubeModels.length}개 모델</Badge>
            <Badge tone={vtubeHotkeys.length ? 'mint' : 'neutral'}>{vtubeHotkeys.length}개 핫키</Badge>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>핫키 테스트</CardTitle>
          <CardDescription>목록에서 고른 반응을 실행해 봅니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="실행 핫키">
            <select value={selectedVtubeHotkey} onChange={(event) => setSelectedVtubeHotkey(event.target.value)} className="min-h-[var(--control-height)] w-full min-w-0 rounded-[var(--radius-control)] border bg-background px-[clamp(0.75rem,1.4vw,1rem)] text-sm">
              <option value="">핫키 선택</option>
              {vtubeHotkeys.map((hotkey) => <option key={hotkey.id || hotkey.name} value={hotkey.id}>{hotkey.name || hotkey.id}</option>)}
            </select>
          </Field>
          <Button type="button" variant="outline" onClick={runVtubeHotkey} disabled={busyAction === 'vtube.hotkey' || !selectedVtubeHotkey}>
            {busyAction === 'vtube.hotkey' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            핫키 실행
          </Button>
          <div className="grid gap-2">
            {vtubeHotkeys.slice(0, 6).map((hotkey) => (
              <div key={hotkey.id || hotkey.name} className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-background/70 p-[clamp(0.8rem,1.4vw,1rem)]">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{hotkey.name || hotkey.id}</div>
                  <div className="truncate text-xs text-muted-foreground">{hotkey.type || 'hotkey'}</div>
                </div>
                <Badge tone="rose">VTS</Badge>
              </div>
            ))}
            {!vtubeHotkeys.length ? <div className="rounded-[var(--radius-control)] border bg-background/70 p-4 text-sm text-muted-foreground">아직 불러온 VTube Studio 핫키가 없습니다.</div> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderVoiceTab = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <Card>
        <CardHeader>
          <CardTitle>TTS</CardTitle>
          <CardDescription>채팅과 액션에서 사용할 음성 안내를 테스트합니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ToggleRow checked={ttsEnabled} label={ttsEnabled ? 'TTS 사용 중' : 'TTS 꺼짐'} onClick={() => setTtsEnabled((value) => !value)} />
          <div className="grid gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))]">
            <Field label="음성 이름"><Input value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)} /></Field>
            <Field label="속도"><Input value={ttsRate} onChange={(event) => setTtsRate(event.target.value)} inputMode="decimal" /></Field>
            <Field label="피치"><Input value={ttsPitch} onChange={(event) => setTtsPitch(event.target.value)} inputMode="decimal" /></Field>
          </div>
          <Field label="테스트 문구"><Textarea value={ttsText} onChange={setTtsText} /></Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={saveSettings} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              설정 저장
            </Button>
            <Button type="button" onClick={testTts} disabled={busyAction === 'tts'}>
              {busyAction === 'tts' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              TTS 테스트
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>사운드 저장소</CardTitle>
          <CardDescription>짧은 효과음을 올리고 재생 방식을 고릅니다.</CardDescription>
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
          <div className="grid gap-2 md:grid-cols-[repeat(2,minmax(0,1fr))]">
            <SegmentedButton active={soundMode === 'managed'} title="클라우드 보관" description="짧은 효과음을 올려 재생" icon={Database} onClick={() => setSoundMode('managed')} />
            <SegmentedButton active={soundMode === 'local'} title="내 PC 저장" description="로컬 사운드 폴더에서 재생" icon={HardDrive} onClick={() => setSoundMode('local')} />
          </div>
          <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={(event) => uploadSound(event.target.files?.[0])} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={saveSettings} disabled={saving}>
              <Save className="h-4 w-4" />
              저장 방식 저장
            </Button>
            <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={busyAction === 'sound' || soundMode !== 'managed'}>
              {busyAction === 'sound' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              사운드 업로드
            </Button>
          </div>
          <div className="grid gap-2">
            {(storage?.files || []).map((file) => (
              <div key={file.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-background/70 p-[clamp(0.8rem,1.4vw,1rem)]">
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
    </div>
  );

  const renderNetworkTab = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>HTTP 실행</CardTitle>
          <CardDescription>보조 도구와 외부 연출을 실행합니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,0.32fr)_minmax(0,1fr)]">
            <Field label="메서드"><Input value={httpMethod} onChange={(event) => setHttpMethod(event.target.value.toUpperCase())} /></Field>
            <Field label="URL"><Input value={httpUrl} onChange={(event) => setHttpUrl(event.target.value)} /></Field>
          </div>
          <Field label="Headers(JSON)"><Textarea value={httpHeaders} onChange={setHttpHeaders} /></Field>
          <Field label="Body"><Textarea value={httpBody} onChange={setHttpBody} /></Field>
          <ToggleRow checked={networkAllowPrivate} label="내 방송 PC 주소 허용" description="로컬 프로그램으로 실행할 때만 사용합니다." onClick={() => setNetworkAllowPrivate((value) => !value)} />
          <Button type="button" onClick={() => runNetwork('http')} disabled={busyAction === 'network.http'}>
            {busyAction === 'network.http' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            HTTP 실행
          </Button>
        </CardContent>
      </Card>
      <div className="grid gap-5">
        <Card>
          <CardHeader>
            <CardTitle>WebSocket 실행</CardTitle>
            <CardDescription>로컬 도구에 메시지를 보냅니다.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="WebSocket URL"><Input value={websocketUrl} onChange={(event) => setWebsocketUrl(event.target.value)} /></Field>
            <Field label="메시지"><Textarea value={websocketMessage} onChange={setWebsocketMessage} /></Field>
            <Button type="button" onClick={() => runNetwork('websocket')} disabled={busyAction === 'network.websocket'}>
              {busyAction === 'network.websocket' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              WebSocket 전송
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>UDP 실행</CardTitle>
            <CardDescription>조명, 효과, 보조 프로그램에 UDP 메시지를 보냅니다.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,0.38fr)]">
              <Field label="호스트"><Input value={udpHost} onChange={(event) => setUdpHost(event.target.value)} /></Field>
              <Field label="포트"><Input value={udpPort} onChange={(event) => setUdpPort(event.target.value)} inputMode="numeric" /></Field>
            </div>
            <Field label="메시지"><Textarea value={udpMessage} onChange={setUdpMessage} /></Field>
            <Button type="button" onClick={() => runNetwork('udp')} disabled={busyAction === 'network.udp'}>
              {busyAction === 'network.udp' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              UDP 전송
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const renderControlTab = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MousePointerClick className="h-5 w-5 text-primary" />Stream Deck / Touch Portal</CardTitle>
        <CardDescription>버튼 앱에서 선택한 액션을 실행합니다.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)]">
          <Field label="버튼 이름">
            <Input value={controlLabel} onChange={(event) => setControlLabel(event.target.value)} />
          </Field>
          <Field label="실행 액션">
            <select value={selectedControlActionId} onChange={(event) => setSelectedControlActionId(event.target.value)} className="min-h-[var(--control-height)] w-full min-w-0 rounded-[var(--radius-control)] border bg-background px-[clamp(0.75rem,1.4vw,1rem)] text-sm">
              <option value="">게시된 액션 선택</option>
              {publishedBlueprints.map((item) => (
                <option key={item.id} value={item.slug || item.id}>{item.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={createControlLink} disabled={busyAction === 'control' || !selectedControlActionId}>
            {busyAction === 'control' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            제어 URL 만들기
          </Button>
          <LinkButton href="/actions" variant="outline">
            액션 편집
          </LinkButton>
        </div>
        {!publishedBlueprints.length ? (
          <div className="rounded-[var(--radius-control)] border bg-background/70 p-4 text-sm leading-6 text-muted-foreground">
            아직 바로 실행할 액션이 없습니다. 액션을 게시하면 이곳에서 버튼으로 연결할 수 있습니다.
          </div>
        ) : null}
        <SecretCopyBlock value={controlUrl} empty="제어 URL을 만들면 여기에 표시됩니다." />
        <div className="grid gap-2 rounded-[var(--radius-card)] border bg-background/70 p-[clamp(0.9rem,1.6vw,1.15rem)] text-sm leading-6 text-muted-foreground">
          <div className="font-semibold text-foreground">버튼 앱에 넣을 값</div>
          <div>Method: GET 또는 POST</div>
          <div>URL: 위 주소를 그대로 입력</div>
          <div>Body: 비워둬도 실행 가능</div>
        </div>
      </CardContent>
    </Card>
  );

  const renderConnectionsTab = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PlugZap className="h-5 w-5 text-primary" />연결 목록</CardTitle>
        <CardDescription>방송 도구와 버튼 앱 연결을 관리합니다.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {connections.map((item) => (
          <div key={item.id} className="grid gap-3 rounded-[var(--radius-control)] border bg-background/70 p-[clamp(0.85rem,1.5vw,1rem)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="sky">{connectionTypeLabel(item.type)}</Badge>
                <Badge tone={item.executionMode === 'local' ? 'mint' : 'lemon'}>{item.executionMode === 'local' ? '방송 PC 실행' : '웹 실행'}</Badge>
              </div>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon" onClick={() => saveConnection(item)} aria-label="연결 저장">
                  {busyAction === `connection-save:${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => removeConnection(item)} aria-label="연결 삭제">
                  {busyAction === `connection-delete:${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)_minmax(var(--control-height),0.28fr)] md:items-end">
              <Field label="이름">
                <Input
                  value={connectionDrafts[item.id]?.name ?? item.name}
                  onChange={(event) => setConnectionDrafts((current) => ({
                    ...current,
                    [item.id]: { name: event.target.value, endpoint: current[item.id]?.endpoint ?? item.endpoint ?? '', enabled: current[item.id]?.enabled ?? item.enabled },
                  }))}
                />
              </Field>
              <Field label="엔드포인트">
                <Input
                  value={connectionDrafts[item.id]?.endpoint ?? item.endpoint ?? ''}
                  onChange={(event) => setConnectionDrafts((current) => ({
                    ...current,
                    [item.id]: { name: current[item.id]?.name ?? item.name, endpoint: event.target.value, enabled: current[item.id]?.enabled ?? item.enabled },
                  }))}
                />
              </Field>
              <Button
                type="button"
                variant={(connectionDrafts[item.id]?.enabled ?? item.enabled) ? 'soft' : 'outline'}
                onClick={() => setConnectionDrafts((current) => ({
                  ...current,
                  [item.id]: { name: current[item.id]?.name ?? item.name, endpoint: current[item.id]?.endpoint ?? item.endpoint ?? '', enabled: !(current[item.id]?.enabled ?? item.enabled) },
                }))}
              >
                {(connectionDrafts[item.id]?.enabled ?? item.enabled) ? '사용 중' : '꺼짐'}
              </Button>
            </div>
          </div>
        ))}
        {!connections.length ? <div className="rounded-[var(--radius-control)] border bg-background/70 p-4 text-sm text-muted-foreground">아직 생성한 자동화 연결이 없습니다.</div> : null}
      </CardContent>
    </Card>
  );

  const renderActiveTab = () => {
    if (activeTab === 'local') return renderLocalTab();
    if (activeTab === 'obs') return renderObsTab();
    if (activeTab === 'tits') return renderTitsTab();
    if (activeTab === 'vtube') return renderVtubeTab();
    if (activeTab === 'voice') return renderVoiceTab();
    if (activeTab === 'network') return renderNetworkTab();
    if (activeTab === 'control') return renderControlTab();
    return renderConnectionsTab();
  };

  return (
    <div className="grid gap-[clamp(1rem,2vw,1.5rem)]">
      <section className="overflow-hidden rounded-[var(--radius-panel)] border bg-[radial-gradient(circle_at_15%_10%,hsl(var(--accent-mint)/0.68),transparent_30%),radial-gradient(circle_at_86%_16%,hsl(var(--accent-coral)/0.55),transparent_28%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-sky)/0.26))] p-[clamp(1.25rem,3vw,2rem)] shadow-soft">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.42fr)] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="mint">방송 자동화</Badge>
              <Badge tone={hasOnlineAgent ? 'mint' : 'neutral'}>{hasOnlineAgent ? '로컬 온라인' : '로컬 대기'}</Badge>
              <Badge tone="sky">{publishedBlueprints.length}개 게시 액션</Badge>
            </div>
            <h1 className="mt-4 max-w-3xl break-keep text-3xl font-semibold leading-tight md:text-5xl">
              방송의 순간을 한 번의 액션으로 움직이세요.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              OBS, T.I.T.S., VTube Studio, TTS, 사운드, 버튼 앱을 연결합니다.
            </p>
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))]">
            <div className="min-w-0 rounded-[var(--radius-card)] border bg-card/78 p-[clamp(0.75rem,1.4vw,1rem)] text-center">
              <div className="truncate text-xl font-bold">{localAgents.length}</div>
              <div className="mt-1 text-xs text-muted-foreground">로컬</div>
            </div>
            <div className="min-w-0 rounded-[var(--radius-card)] border bg-card/78 p-[clamp(0.75rem,1.4vw,1rem)] text-center">
              <div className="truncate text-xl font-bold">{connections.length}</div>
              <div className="mt-1 text-xs text-muted-foreground">연결</div>
            </div>
            <div className="min-w-0 rounded-[var(--radius-card)] border bg-card/78 p-[clamp(0.75rem,1.4vw,1rem)] text-center">
              <div className="truncate text-xl font-bold">{publishedBlueprints.length}</div>
              <div className="mt-1 text-xs text-muted-foreground">액션</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:max-w-full sm:flex-wrap">
        {tabs.map((tab) => (
          <TabButton key={tab.id} active={activeTab === tab.id} label={tab.label} icon={tab.icon} onClick={() => setActiveTab(tab.id)} />
        ))}
      </div>

      {renderActiveTab()}

      {loading ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/45 backdrop-blur-sm">
          <div className="rounded-[var(--radius-card)] border bg-card p-[clamp(1rem,2vw,1.25rem)] shadow-lift">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
            <div className="mt-3 text-sm font-semibold">자동화 설정을 불러오는 중</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
