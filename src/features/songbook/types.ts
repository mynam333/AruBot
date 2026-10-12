export type SongbookSong = {
  id: string;
  title: string;
  artist: string;
  videoId: string | null;
  youtubeUrl: string | null;
  thumbnailUrl: string | null;
  keyShift: number;
  difficulty: number;
  tags: string[];
  note: string;
  privateNote?: string;
  visible?: boolean;
  requestable: boolean;
  revision?: number;
};
export type SongbookSettings = { requestsEnabled: boolean; perUserLimit: number };
export type SongbookCatalog = { songs: SongbookSong[]; total: number; page: number; limit: number; tags: string[]; settings: SongbookSettings; publicPath?: string | null };
export type SongbookRequest = {
  id: string;
  songId: string | null;
  song: SongbookSong;
  username: string;
  message: string;
  status: 'pending' | 'singing' | 'done' | 'rejected' | 'cancelled';
  createdAt: string;
  updatedAt: string;
};
export const requestStatusLabels: Record<SongbookRequest['status'], string> = {
  pending: '대기 중', singing: '부르는 중', done: '완료', rejected: '거절됨', cancelled: '취소됨',
};
export const keyLabel = (value: number) => value === 0 ? '원키' : `${value > 0 ? '+' : ''}${value}`;
