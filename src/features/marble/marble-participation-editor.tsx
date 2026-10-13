'use client';

import * as Switch from '@radix-ui/react-switch';
import { Link2, Save, Settings2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseMarbleParticipationSettings, type MarbleParticipationSettings, type MarbleViewerParticipation } from '../../../shared/marble';
import styles from '@/features/admin/marble-page.module.css';

function Toggle({ id, label, checked, disabled, onChange }: {
  id: string; label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void;
}) {
  return <div className={styles.toggleRow}><label htmlFor={id}>{label}</label><Switch.Root id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} className={styles.switch}><Switch.Thumb className={styles.switchThumb} /></Switch.Root></div>;
}

export function MarbleParticipationFields({ value, onChange, disabled, idPrefix }: {
  value: MarbleParticipationSettings; onChange: (value: MarbleParticipationSettings) => void; disabled: boolean; idPrefix: string;
}) {
  return <>
    <Toggle id={`${idPrefix}-points`} label="포인트 명령어" checked={value.points.enabled} disabled={disabled} onChange={enabled => onChange({ ...value, points: { ...value.points, enabled } })} />
    <div className={styles.fieldPair}>
      <label className={styles.field}>명령어<Input required maxLength={40} value={value.points.command} disabled={disabled} onChange={event => onChange({ ...value, points: { ...value.points, command: event.target.value } })} /></label>
      <label className={styles.field}>1회 가격 (포인트)<Input required type="number" min={1} max={1000000000} step={1} value={value.points.cost || ''} disabled={disabled} onChange={event => onChange({ ...value, points: { ...value.points, cost: Number(event.target.value) } })} /></label>
    </div>
    <Toggle id={`${idPrefix}-donation`} label="후원으로 굴리기" checked={value.donation.enabled} disabled={disabled} onChange={enabled => onChange({ ...value, donation: { ...value.donation, enabled } })} />
    <label className={styles.field}>1회 최소 후원 금액 (원)<Input required type="number" min={1} max={1000000000} step={1} value={value.donation.minimum || ''} disabled={disabled} onChange={event => onChange({ ...value, donation: { ...value.donation, minimum: Number(event.target.value) } })} /></label>
    <p className={styles.policy}>포인트는 굴릴 수 있을 때만 사용됩니다. 후원 굴리기는 최대 20건까지 대기하며, 게임 종료 시 남은 예약은 삭제됩니다. 외부 후원 금액은 환불되지 않습니다.</p>
  </>;
}

type Draft = { settings: MarbleParticipationSettings; connected: boolean; revision: number };

export function MarbleParticipationEditor({ participation, roomTitle, playerName, disabled, onSave }: {
  participation: MarbleViewerParticipation; roomTitle: string; playerName: string; disabled: boolean;
  onSave: (draft: Draft, success: () => void, conflict: () => void) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saveConflict, setSaveConflict] = useState(false);
  const value = draft ?? { settings: participation.settings, connected: participation.connected, revision: participation.revision };
  const conflict = !!draft && (saveConflict || draft.revision !== participation.revision);
  const elsewhere = !!participation.connectedOwnerUserId && !participation.connected && !participation.suspended;
  const dirty = !!draft && (draft.connected !== participation.connected || JSON.stringify(draft.settings) !== JSON.stringify(participation.settings));
  const change = (next: Partial<Draft>) => {
    setError(''); setNotice('');
    setDraft(current => ({ ...(current ?? { settings: structuredClone(participation.settings), connected: participation.connected, revision: participation.revision }), ...next }));
  };
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  const save = () => {
    if (!dirty || disabled || conflict) return;
    try {
      const settings = parseMarbleParticipationSettings(value.settings);
      onSave({ ...value, settings }, () => { setDraft(null); setSaveConflict(false); setNotice('내 시청자 참여 설정을 저장했습니다.'); }, () => setSaveConflict(true));
    } catch (failure) { setError(failure instanceof Error ? failure.message : '입력값을 확인해 주세요.'); }
  };
  return <section className={styles.section} aria-label="내 시청자 참여 설정">
    <div className={styles.sectionHeading}><h2><Settings2 size={17} />내 시청자 참여</h2><span className={styles.badge}>{participation.suspended ? '재연결 필요' : participation.connected ? '이 방에 연결됨' : elsewhere ? '다른 방에 연결됨' : '연결 안 됨'}</span></div>
    <dl className={styles.participationFacts}><div><dt>참여할 게임</dt><dd>{roomTitle}</dd></div><div><dt>내 시청자가 굴릴 말</dt><dd>{playerName}</dd></div><div><dt>사용 포인트</dt><dd>내 채널 포인트</dd></div></dl>
    {elsewhere ? <p className={styles.warning}>현재 연결: {participation.connectedRoomTitle || '다른 주루마블 방'}. 명령어·금액은 내 채널 공통 설정으로 현재 연결된 방에도 적용됩니다. 이 방으로 연결을 저장하면 기존 방 연결은 해제됩니다.</p> : null}
    {participation.suspended ? <p className={styles.warning}>이전 참여가 종료되어 포인트·후원 연동이 중단되었습니다. 저장된 명령어·금액은 유지됩니다. 다시 연동하려면 연결을 켜고 저장해 주세요.</p> : null}
    <form onSubmit={event => { event.preventDefault(); save(); }}>
      <fieldset disabled={disabled} className={styles.settingsFields}>
        <Toggle id="marble-viewer-connect" label="내 시청자의 포인트·후원을 이 방에 연결" checked={value.connected} disabled={disabled} onChange={connected => change({ connected })} />
        <MarbleParticipationFields value={value.settings} onChange={settings => change({ settings })} disabled={disabled} idPrefix="marble-member" />
      </fieldset>
      {participation.connected && !value.connected ? <p className={styles.warning}>시청자 참여만 내 주루마블로 돌아갑니다. OBS 표시 방과 이 방에 이미 접수된 후원 예약은 유지됩니다.</p> : null}
      {value.connected && !value.settings.points.enabled && !value.settings.donation.enabled ? <p className={styles.muted}>포인트 명령어와 후원 참여가 모두 꺼져 있습니다.</p> : null}
      {conflict ? <p className={styles.conflict} role="alert">다른 화면에서 내 참여 설정이 변경되었습니다. 작성한 값은 보존됩니다. 변경 취소 후 최신 설정을 확인해 주세요.</p> : null}
      {error ? <p className={styles.warning} role="alert">{error}</p> : null}
      <div className={styles.saveBar}><span role="status">{notice || (dirty ? '저장하지 않은 변경사항' : '저장된 설정')}</span><div className={styles.actions}>
        <Button type="button" variant="ghost" disabled={!draft || disabled} onClick={() => { setDraft(null); setSaveConflict(false); setError(''); setNotice(''); }}><X size={16} />변경 취소</Button>
        <Button type="submit" disabled={!dirty || disabled || conflict}>{elsewhere && value.connected ? <Link2 size={16} /> : <Save size={16} />}{elsewhere && value.connected ? '이 방으로 연결 변경 및 저장' : '내 참여 설정 저장'}</Button>
      </div></div>
    </form>
  </section>;
}
