'use client';

import * as Switch from '@radix-ui/react-switch';
import {
  ArrowDown,
  ArrowUp,
  ListMusic,
  Loader2,
  Music2,
  Plus,
  Repeat2,
  Shuffle,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiUrl } from '@/shared/api/http';
import { cn } from '@/shared/lib/utils';
import {
  MAX_VIDEO_DONATION_IDLE_TRACKS,
  normalizeVideoDonationIdleTracks,
  type VideoDonationIdlePlaylist,
  type VideoDonationIdleTrack,
} from '@/features/admin/video-donation-idle-playlist-model';

const TOPIC_PRESETS = [
  '로파이 집중',
  '잔잔한 카페',
  '신나는 K-POP',
  '새벽 감성',
  '게임 방송',
  '재즈 라운지',
  '피아노 연주',
  '클래식',
] as const;

type PlaylistLookupResult = {
  tracks?: VideoDonationIdleTrack[];
  requestedCount?: number;
  excludedCount?: number;
  excludedTooLongCount?: number;
  cacheHit?: boolean;
};


async function postPlaylistJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || '플레이리스트 요청에 실패했습니다.');
  return payload as T;
}

function formatDuration(value: number | null) {
  if (!value) return null;
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatExcludedSummary(result: PlaylistLookupResult) {
  const excludedCount = Math.max(0, Number(result.excludedCount) || 0);
  const tooLongCount = Math.max(0, Number(result.excludedTooLongCount) || 0);
  if (!excludedCount) return '';
  if (tooLongCount === excludedCount) return ` · 10분 초과 ${tooLongCount}개 제외`;
  if (tooLongCount > 0) return ` · ${excludedCount}개 제외(10분 초과 ${tooLongCount}개)`;
  return ` · 재생 시간/상태 미확인 ${excludedCount}개 제외`;
}

function PlaylistToggle({
  checked,
  onCheckedChange,
  icon,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex min-h-[var(--control-height)] min-w-0 items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-card/75 px-[clamp(0.85rem,1.6vw,1.1rem)]">
      <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold">
        <span className="text-primary">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <Switch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative h-[1.75rem] w-[3.25rem] shrink-0 rounded-full border bg-muted transition data-[state=checked]:border-primary/35 data-[state=checked]:bg-primary/75"
      >
        <Switch.Thumb className="block h-[1.35rem] w-[1.35rem] translate-x-[0.2rem] rounded-full bg-card shadow-subtle transition data-[state=checked]:translate-x-[1.55rem]" />
      </Switch.Root>
    </div>
  );
}

function PlaylistTrackList({
  tracks,
  onChange,
}: {
  tracks: VideoDonationIdleTrack[];
  onChange: (tracks: VideoDonationIdleTrack[]) => void;
}) {
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= tracks.length) return;
    const next = tracks.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  if (!tracks.length) {
    return (
      <div className="grid min-h-28 place-items-center rounded-[var(--radius-control)] border border-dashed bg-muted/35 px-4 text-center text-sm text-muted-foreground">
        재생할 곡이 아직 없습니다.
      </div>
    );
  }

  return (
    <div className="max-h-[22rem] overflow-y-auto rounded-[var(--radius-control)] border bg-card/65">
      {tracks.map((track, index) => (
        <div
          key={track.id}
          className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3 border-b p-3 [content-visibility:auto] last:border-b-0"
        >
          <div className="relative aspect-video overflow-hidden rounded-md border bg-muted">
            <img src={track.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
            <span className="absolute bottom-1 left-1 rounded bg-black/72 px-1.5 py-0.5 text-[0.625rem] font-semibold text-white">
              {index + 1}
            </span>
          </div>
          <div className="min-w-0">
            <div className="line-clamp-2 break-keep text-sm font-semibold leading-5">{track.title}</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>YouTube</span>
              {formatDuration(track.durationSec) ? <span className="tabular-nums">{formatDuration(track.durationSec)}</span> : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <Button type="button" variant="ghost" size="icon" className="min-h-8 w-8" onClick={() => move(index, -1)} disabled={index === 0} aria-label="위로 이동" title="위로 이동">
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="min-h-8 w-8" onClick={() => move(index, 1)} disabled={index === tracks.length - 1} aria-label="아래로 이동" title="아래로 이동">
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="col-span-2 min-h-8 w-full text-destructive hover:text-destructive"
              onClick={() => onChange(tracks.filter((item) => item.id !== track.id))}
              aria-label="곡 삭제"
              title="곡 삭제"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function mergeTracks(current: VideoDonationIdleTrack[], incoming: VideoDonationIdleTrack[]) {
  const next = current.slice();
  const seen = new Set(current.map((track) => track.mediaId));
  for (const track of normalizeVideoDonationIdleTracks(incoming)) {
    if (seen.has(track.mediaId)) continue;
    seen.add(track.mediaId);
    next.push(track);
    if (next.length >= MAX_VIDEO_DONATION_IDLE_TRACKS) break;
  }
  return next;
}

export function VideoDonationIdlePlaylistEditor({
  value,
  onChange,
}: {
  value: VideoDonationIdlePlaylist;
  onChange: (value: VideoDonationIdlePlaylist) => void;
}) {
  const [customInput, setCustomInput] = useState('');
  const [recommendPending, setRecommendPending] = useState(false);
  const [addPending, setAddPending] = useState(false);
  const activeTracks = value.mode === 'recommended' ? value.recommendedTracks : value.customTracks;

  const update = (patch: Partial<VideoDonationIdlePlaylist>) => onChange({ ...value, ...patch });

  const createRecommendations = async () => {
    const topic = value.topic.trim();
    if (!topic) return toast.warning('추천 주제를 입력해 주세요.');
    setRecommendPending(true);
    try {
      const result = await postPlaylistJson<PlaylistLookupResult>('/api/video-donation/idle-playlist/recommend', {
        topic,
        limit: value.recommendationCount,
      });
      const tracks = normalizeVideoDonationIdleTracks(result.tracks);
      if (!tracks.length) throw new Error('추천곡을 찾지 못했습니다.');
      update({ recommendedTracks: tracks });
      toast.success(`${tracks.length}곡으로 추천 플레이리스트를 만들었어요${formatExcludedSummary(result)}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '추천 플레이리스트를 만들지 못했습니다.');
    } finally {
      setRecommendPending(false);
    }
  };

  const addCustomInput = async () => {
    const input = customInput.trim();
    if (!input) return toast.warning('곡, 영상 또는 플레이리스트를 입력해 주세요.');
    setAddPending(true);
    try {
      const result = await postPlaylistJson<PlaylistLookupResult & { kind?: string }>('/api/video-donation/idle-playlist/resolve', { input });
      const incoming = normalizeVideoDonationIdleTracks(result.tracks);
      const next = mergeTracks(value.customTracks, incoming);
      const added = next.length - value.customTracks.length;
      update({ customTracks: next });
      setCustomInput('');
      toast.success(added > 0
        ? `${added}곡을 플레이리스트에 추가했어요${formatExcludedSummary(result)}.`
        : '이미 추가된 곡입니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '곡을 추가하지 못했습니다.');
    } finally {
      setAddPending(false);
    }
  };

  return (
    <div className="grid min-w-0 gap-[clamp(1rem,2vw,1.35rem)] rounded-[var(--radius-card)] border bg-background/62 p-[clamp(1rem,2vw,1.25rem)]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-pastel-sky/70 text-sky-800 ring-1 ring-sky-500/20 dark:bg-sky-500/15 dark:text-sky-200">
            <ListMusic className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold">대기 음악</div>
            <div className="mt-0.5 text-xs text-muted-foreground">후원 대기열이 비었을 때 재생</div>
          </div>
        </div>
        <Switch.Root
          checked={value.enabled}
          onCheckedChange={(enabled) => update({ enabled })}
          className="relative h-[1.9rem] w-[3.55rem] shrink-0 rounded-full border bg-muted transition data-[state=checked]:border-primary/35 data-[state=checked]:bg-primary/75"
          aria-label="대기 음악 사용"
        >
          <Switch.Thumb className="block h-[1.45rem] w-[1.45rem] translate-x-[0.22rem] rounded-full bg-card shadow-subtle transition data-[state=checked]:translate-x-[1.82rem]" />
        </Switch.Root>
      </div>

      {value.enabled ? (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] border bg-muted/55 p-1" role="group" aria-label="대기 음악 구성 방식">
            <button
              type="button"
              onClick={() => update({ mode: 'recommended' })}
              aria-pressed={value.mode === 'recommended'}
              className={cn(
                'inline-flex min-h-[var(--control-height)] items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition',
                value.mode === 'recommended' ? 'bg-card text-foreground shadow-subtle' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Sparkles className="h-4 w-4" />
              주제 추천
            </button>
            <button
              type="button"
              onClick={() => update({ mode: 'custom' })}
              aria-pressed={value.mode === 'custom'}
              className={cn(
                'inline-flex min-h-[var(--control-height)] items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition',
                value.mode === 'custom' ? 'bg-card text-foreground shadow-subtle' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Music2 className="h-4 w-4" />
              직접 구성
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <PlaylistToggle checked={value.loop} onCheckedChange={(loop) => update({ loop })} icon={<Repeat2 className="h-4 w-4" />} label="반복 재생" />
            <PlaylistToggle checked={value.shuffle} onCheckedChange={(shuffle) => update({ shuffle })} icon={<Shuffle className="h-4 w-4" />} label="셔플" />
          </div>

          {value.mode === 'recommended' ? (
            <div className="grid gap-3">
              <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
                <label className="grid min-w-0 gap-2 text-sm font-semibold" htmlFor="video-donation-idle-topic">
                  추천 주제
                  <Input
                    id="video-donation-idle-topic"
                    list="video-donation-idle-topic-presets"
                    value={value.topic}
                    onChange={(event) => update({ topic: event.target.value, recommendedTracks: [] })}
                    placeholder="예: 비 오는 밤 재즈"
                    className="min-w-0"
                  />
                </label>
                <datalist id="video-donation-idle-topic-presets">
                  {TOPIC_PRESETS.map((topic) => <option key={topic} value={topic} />)}
                </datalist>
                <label className="grid min-w-0 gap-2 text-sm font-semibold" htmlFor="video-donation-idle-recommendation-count">
                  추천 곡 수
                  <div className="relative min-w-0">
                    <Input
                      id="video-donation-idle-recommendation-count"
                      type="number"
                      min={1}
                      max={MAX_VIDEO_DONATION_IDLE_TRACKS}
                      inputMode="numeric"
                      aria-label="추천 곡 수"
                      value={value.recommendationCount}
                      onChange={(event) => {
                        const count = Math.max(1, Math.min(MAX_VIDEO_DONATION_IDLE_TRACKS, Math.floor(Number(event.target.value) || 1)));
                        update({ recommendationCount: count, recommendedTracks: [] });
                      }}
                      className="min-w-0 pr-10 tabular-nums"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs font-medium text-muted-foreground">곡</span>
                  </div>
                </label>
                <Button type="button" variant="soft" className="sm:self-end" onClick={() => void createRecommendations()} disabled={recommendPending}>
                  {recommendPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  추천곡 구성
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              <label className="grid gap-2 text-sm font-semibold" htmlFor="video-donation-idle-custom-input">곡 또는 YouTube 플레이리스트</label>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                <Input
                  id="video-donation-idle-custom-input"
                  value={customInput}
                  onChange={(event) => setCustomInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void addCustomInput();
                    }
                  }}
                  placeholder="URL, 영상 ID 또는 검색어"
                  className="min-w-0 flex-1"
                />
                <Button type="button" variant="soft" onClick={() => void addCustomInput()} disabled={addPending}>
                  {addPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  추가
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">재생 목록</div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Badge tone="neutral">최대 10분</Badge>
                <Badge tone={activeTracks.length ? 'mint' : 'neutral'}>{activeTracks.length}곡</Badge>
              </div>
            </div>
            <PlaylistTrackList
              tracks={activeTracks}
              onChange={(tracks) => update(value.mode === 'recommended' ? { recommendedTracks: tracks } : { customTracks: tracks })}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
