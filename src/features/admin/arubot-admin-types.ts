export type AdminStatus = {
  userId?: string | null;
  isAdmin?: boolean;
  displayName?: string | null;
  avatarUrl?: string | null;
};

export type YoutubePendingChannel = {
  channelId?: string;
  channelName?: string | null;
  channelHandle?: string | null;
  channelImageUrl?: string | null;
};

export type YoutubeBotStatus = {
  configured?: boolean;
  profile?: {
    selectedChannelId?: string | null;
    selectedChannelTitle?: string | null;
    selectedChannelHandle?: string | null;
    selectedChannelThumbnailUrl?: string | null;
    status?: string | null;
    reauthRequired?: boolean;
    scope?: string | null;
    consentGrantedAt?: string | null;
    consentConfirmedAt?: string | null;
    lastUsedAt?: string | null;
    lastActivityAt?: string | null;
    validationIntervalDays?: number;
    inactivityDays?: number;
    lastVerifiedAt?: string | null;
    nextValidationAt?: string | null;
    inactivityRevocationAt?: string | null;
    lastError?: string | null;
    updatedAt?: string | null;
  } | null;
  pending?: {
    channels?: YoutubePendingChannel[];
    expiresAt?: string;
  } | null;
};

export type AdminPlatformRuntime = {
  provider: string;
  platformUserId?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  channelHandle?: string | null;
  avatarUrl?: string | null;
  connectedAt?: string | null;
  lastActivityAt?: string | null;
  authorization?: 'valid' | 'configured' | 'expired' | 'unknown' | string;
  authorizationExpiresAt?: string | null;
  lastValidatedAt?: string | null;
  moderatorRegistered?: boolean | null;
  websubStatus?: string | null;
  websubLeaseExpiresAt?: string | null;
  lastLiveTitle?: string | null;
  lastLiveStartedAt?: string | null;
  lastError?: string | null;
  runtimeLeaseActive?: boolean;
  runtimeManaged?: boolean;
  runtimeLocation?: 'local' | 'managed' | 'none';
  live?: boolean | null;
  streamConnected?: boolean;
  queueSize?: number;
  reauthRequired?: boolean;
  recovering?: boolean;
  recoveryAttempt?: number;
  nextRetryAt?: number | null;
  recoveryError?: string | null;
};

export type AdminFeatureCount = {
  total: number;
  enabled?: number;
  users?: number;
  published?: number;
  items?: number;
  lastUsed?: number | null;
  updatedAt?: string | null;
};

export type AdminStreamer = {
  userId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  primaryProvider?: string | null;
  isAdmin?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastPlatformActivityAt?: string | null;
  platforms: AdminPlatformRuntime[];
  live: {
    live: boolean;
    stale?: boolean;
    startDate?: string | null;
    sessionStartTime?: number | null;
    lastUpdate?: number | null;
  };
  features: {
    commands: AdminFeatureCount;
    macros: AdminFeatureCount;
    roulettes: AdminFeatureCount;
    actions: AdminFeatureCount;
    donations: AdminFeatureCount;
    automations: AdminFeatureCount & {
      attention?: number;
      lastCheckedAt?: string | null;
      localAgents?: number;
      localAgentsOnline?: number;
    };
    videoDonations?: { enabled?: boolean };
    drawingDonations?: { enabled?: boolean };
  };
  bot: {
    enabled?: boolean;
    messagesProcessed?: number;
    commandsHandled?: number;
    lastActiveAt?: string | null;
  };
  activity: {
    lastEventAt?: string | null;
    events24h?: number;
    failedEvents24h?: number;
  };
  runtime: {
    status: 'running' | 'managed_elsewhere' | 'standby' | 'attention' | 'checking' | 'disabled' | 'unconfigured';
    streamConnected?: boolean;
    managedElsewhere?: boolean;
    runtimeLeaseActive?: boolean;
    recovering?: boolean;
    responseAvailable?: boolean;
    lastError?: string | null;
    configurationRevision?: number;
  };
};

export type AdminStreamerFeatureDetails = {
  userId: string;
  generatedAt?: string;
  commands: Array<{
    id: string;
    name?: string | null;
    keywords?: string[];
    responsePreview?: string | null;
    enabled?: boolean;
    adminOnly?: boolean;
  }>;
  macros: Array<{
    id: string;
    messagePreview?: string | null;
    intervalSec?: number | null;
    enabled?: boolean;
  }>;
  roulettes: Array<{
    id: string;
    name?: string | null;
    type?: string | null;
    theme?: string | null;
    itemCount?: number;
  }>;
  actions: Array<{
    id: string;
    name?: string | null;
    slug?: string | null;
    description?: string | null;
    enabled?: boolean;
    published?: boolean;
    updatedAt?: string | null;
  }>;
  donations: Array<{
    id: string;
    name?: string | null;
    enabled?: boolean;
    amountSummary?: string | null;
  }>;
  automations: Array<{
    id: string;
    name?: string | null;
    type?: string | null;
    enabled?: boolean;
    executionMode?: string | null;
    lastStatus?: string | null;
    lastCheckedAt?: string | null;
  }>;
  truncated?: Partial<Record<'commands' | 'macros' | 'roulettes' | 'actions' | 'donations' | 'automations', boolean>>;
};

export type AdminEvent = {
  id: string;
  ownerUserId: string;
  streamerName?: string | null;
  provider?: string | null;
  category?: string | null;
  eventType?: string | null;
  triggerName?: string | null;
  viewerName?: string | null;
  status?: string | null;
  summary?: string | null;
  createdAt?: string | null;
};

export type AdminConsoleSnapshot = {
  generatedAt?: string;
  total: number;
  nextCursor?: string | null;
  filters?: {
    q?: string;
    platform?: string;
    live?: string;
    feature?: string;
    limit?: number;
  };
  summary: {
    registeredUsers?: number;
    linkedStreamers?: number;
    connectedPlatforms?: number;
    liveStreamers?: number;
    activeLast24h?: number;
    failedEvents24h?: number;
    platforms?: Record<string, number>;
    features?: Record<string, AdminFeatureCount>;
  };
  streamers: AdminStreamer[];
  recentEvents: AdminEvent[];
  system: {
    role?: string;
    releaseSha?: string;
    startedAt?: string;
    uptimeSec?: number;
    database?: {
      ok?: boolean;
      latencyMs?: number;
      pool?: {
        totalCount?: number;
        idleCount?: number;
        waitingCount?: number;
        max?: number;
        connectTimeoutMs?: number;
        statementTimeoutMs?: number;
        idleTimeoutMs?: number;
      };
    };
    readiness?: {
      ready?: boolean;
      initialBootstrapCompleted?: boolean;
      lastMonitorAt?: string | null;
      lastMonitorError?: string | null;
      shuttingDown?: boolean;
    };
    runtime?: Record<string, number>;
    memory?: {
      heapUsedMb?: number;
      heapTotalMb?: number;
      rssMb?: number;
    };
    chzzkTransport?: {
      protocol?: string;
      clientVersion?: string;
      locked?: boolean;
    };
  };
};

export type AdminConsoleTab = 'overview' | 'streamers' | 'features' | 'activity' | 'system';

export type AdminConsoleFilters = {
  q: string;
  platform: 'all' | 'chzzk' | 'cime' | 'youtube';
  live: 'all' | 'live' | 'offline';
  feature: 'all' | 'commands' | 'macros' | 'roulettes' | 'actions' | 'donations' | 'automations';
};
