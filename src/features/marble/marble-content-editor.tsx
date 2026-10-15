'use client';

import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { DEFAULT_MARBLE_SETTINGS, MARBLE_EFFECT_LABELS, MARBLE_ICON_LABELS, MARBLE_EVENT_LABELS, marbleContentIcon, type MarbleChallenge, type MarbleEffect, type MarbleEffectType, type MarbleEventKind, type MarbleIcon, type MarbleSettings, type MarbleTile } from '../../../shared/marble';
import { MarbleTileArt } from './marble-tile-art';
import styles from '@/features/admin/marble-page.module.css';

const effectTypes: MarbleEffectType[] = ['message', 'timer', 'rollForward', 'rollBackward', 'move', 'goto', 'skip', 'extra', 'shield', 'shieldLoss', 'shieldClear', 'shieldDouble', 'card'];
const valueRules: Partial<Record<MarbleEffectType, { min: number; max: number; initial: number; label: string }>> = {
  timer: { min: 5, max: 600, initial: 30, label: '시간 (초)' },
  move: { min: -12, max: 12, initial: 1, label: '이동 칸 수' },
  goto: { min: 0, max: 39, initial: 0, label: '도착 칸 번호' },
  skip: { min: 1, max: 3, initial: 1, label: '휴식 횟수' },
  shield: { min: 1, max: 99, initial: 1, label: '획득할 방어권 (장)' },
  shieldLoss: { min: 1, max: 99, initial: 1, label: '차감할 방어권 (장)' },
};

function newEffect(type: MarbleEffectType): MarbleEffect {
  const rule = valueRules[type];
  return rule ? { type, value: rule.initial } : type === 'message' ? { type, text: '' } : { type };
}

function Tool({ label, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <Tooltip content={label}><button type="button" className={styles.iconButton} aria-label={label} title={label} {...props}>{children}</button></Tooltip>;
}

const resultTypes = effectTypes.filter(type => !['card', 'move', 'goto', 'skip'].includes(type));
function EffectEditor({ label, effects, allowed, tileCount, disabled, onChange }: {
  label: string; effects: MarbleEffect[]; allowed: MarbleEffectType[]; tileCount: number; disabled: boolean; onChange: (effects: MarbleEffect[]) => void;
}) {
  const update = (index: number, effect: MarbleEffect) => onChange(effects.map((item, i) => i === index ? effect : item));
  return <>
    <div className={styles.sectionHeading}><h3>{label} <span className={styles.muted}>{effects.length}/6</span></h3><Button type="button" variant="outline" size="sm" disabled={disabled || effects.length >= 6} onClick={() => onChange([...effects, newEffect('message')])}><Plus size={15} />효과 추가</Button></div>
    <div className={styles.effectList}>{effects.length === 0 ? <p className={styles.muted}>등록된 효과 없음</p> : effects.map((effect, index) => {
      const rule = valueRules[effect.type];
      return <div className={styles.effectRow} key={index}>
        <label className={styles.field}>{label} {index + 1}<select className={styles.select} value={effect.type} onChange={event => update(index, newEffect(event.target.value as MarbleEffectType))}>{allowed.map(type => <option key={type} value={type}>{MARBLE_EFFECT_LABELS[type]}</option>)}</select></label>
        {rule ? <label className={styles.field}>{rule.label}<Input type="number" required min={rule.min} max={effect.type === 'goto' ? tileCount - 1 : rule.max} step={1} value={effect.type === 'shield' && effect.value === undefined ? 1 : Number.isFinite(effect.value) ? effect.value : ''} onChange={event => update(index, { ...effect, value: event.target.value === '' ? Number.NaN : Number(event.target.value) })} /></label>
          : effect.type === 'message' ? <label className={styles.field}>메시지<Input maxLength={500} value={effect.text ?? ''} onChange={event => update(index, { ...effect, text: event.target.value })} /></label> : <span className={styles.effectSummary}>{MARBLE_EFFECT_LABELS[effect.type]}</span>}
        <Tool label={`${label} ${index + 1} 삭제`} disabled={disabled} onClick={() => onChange(effects.filter((_, i) => i !== index))}><Trash2 size={16} /></Tool>
        {effect.type !== 'message' ? <label className={`${styles.field} ${styles.effectText}`}>추가 메시지 (선택)<Input maxLength={500} value={effect.text ?? ''} onChange={event => update(index, { ...effect, text: event.target.value })} /></label> : null}
      </div>;
    })}</div>
  </>;
}

export function MarbleContentEditor({ settings, onChange, disabled = false }: {
  settings: MarbleSettings; onChange: (settings: MarbleSettings) => void; disabled?: boolean;
}) {
  const [kind, setKind] = useState<'tiles' | 'cards'>('tiles');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = settings[kind];
  const selectedIndex = Math.max(0, items.findIndex(item => item.id === selectedId));
  const selected = items[selectedIndex];
  const isTile = kind === 'tiles';
  const label = isTile ? '칸' : '카드';
  const minimum = isTile ? 12 : 1;
  const maximum = isTile ? 40 : 60;
  const batch = isTile ? 4 : 1;

  const updateItems = (next: MarbleTile[]) => onChange({ ...settings, [kind]: next });
  const updateSelected = (patch: Partial<MarbleTile>) => updateItems(items.map((item, index) => index === selectedIndex ? { ...item, ...patch } : item));
  const updateChallenge = (patch: Partial<MarbleChallenge>) => updateSelected({ challenge: { ...selected.challenge!, ...patch } });
  const move = (direction: -1 | 1) => {
    const next = [...items];
    const target = selectedIndex + direction;
    if (target < 0 || target >= next.length) return;
    [next[selectedIndex], next[target]] = [next[target], next[selectedIndex]];
    setSelectedId(selected.id);
    updateItems(next);
  };
  const add = () => {
    if (items.length + batch > maximum) return;
    const additions = Array.from({ length: batch }, (_, index): MarbleTile => ({
      id: crypto.randomUUID(), title: `새 ${label} ${items.length + index + 1}`, text: '',
      color: isTile ? '#e5f3ef' : '#f7df91', effects: [],
      ...(!isTile ? { challenge: { rollDice: false, success: { text: '방어권 1장 획득', effects: [{ type: 'shield' as const }] }, failure: { text: '시청자에게 한 문장으로 인사하기', effects: [] } } } : {}),
    }));
    updateItems([...items, ...additions]);
    setSelectedId(additions[0].id);
  };
  const remove = () => {
    if (items.length - batch < minimum) return;
    const start = isTile ? Math.min(selectedIndex, items.length - batch) : selectedIndex;
    if (!window.confirm(isTile ? `${start}~${start + 3}번 칸을 삭제할까요? 이동 효과의 도착 칸 번호도 확인해 주세요.` : `“${selected.title}” 카드를 삭제할까요?`)) return;
    updateItems(items.filter((_, index) => index < start || index >= start + batch));
    setSelectedId(null);
  };

  return <section className={styles.contentEditor} aria-label="판과 카드 편집">
    <div className={styles.sectionHeading}>
      <div className={styles.segmented} role="group" aria-label="콘텐츠 종류">
        <button type="button" aria-pressed={kind === 'tiles'} onClick={() => { setKind('tiles'); setSelectedId(null); }}>게임 판 <span>{settings.tiles.length}</span></button>
        <button type="button" aria-pressed={kind === 'cards'} onClick={() => { setKind('cards'); setSelectedId(null); }}>황금 카드 <span>{settings.cards.length}</span></button>
      </div>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => {
        if (!window.confirm(`${isTile ? '게임 판' : '황금 카드'}을 기본 구성으로 되돌릴까요? 저장 전까지 서버에는 반영되지 않습니다.`)) return;
        updateItems(structuredClone(DEFAULT_MARBLE_SETTINGS[kind])); setSelectedId(null);
      }}><RotateCcw size={15} />기본 구성</Button>
    </div>
    <div className={styles.editorGrid}>
      <div className={styles.contentIndex}>
        <div className={styles.indexHeading}><span>{isTile ? '12~40칸 · 4칸 단위' : '1~60장'}</span><Button type="button" size="sm" variant="outline" disabled={disabled || items.length + batch > maximum} onClick={add}><Plus size={15} />{isTile ? '4칸 추가' : '카드 추가'}</Button></div>
        <ol className={styles.tileList} aria-label={`${label} 목록`}>
          {items.map((item, index) => <li key={item.id}><button type="button" aria-pressed={index === selectedIndex} onClick={() => setSelectedId(item.id)}>
            <span className={styles.swatch} style={{ backgroundColor: item.color }} /><span className={styles.contentArt}><MarbleTileArt kind={marbleContentIcon(item, isTile ? index : -1)} /></span><span className={styles.indexNumber}>{isTile ? index : index + 1}</span><span>{item.title || `이름 없는 ${label}`}</span>
          </button></li>)}
        </ol>
      </div>
      {selected ? <fieldset className={styles.itemEditor} disabled={disabled}>
        <div className={styles.sectionHeading}><h3>{isTile ? `${selectedIndex}번 칸` : `${selectedIndex + 1}번째 카드`}</h3><div className={styles.actions}>
          <Tool label="앞으로 이동" disabled={disabled || selectedIndex === 0} onClick={() => move(-1)}><ArrowUp size={17} /></Tool>
          <Tool label="뒤로 이동" disabled={disabled || selectedIndex === items.length - 1} onClick={() => move(1)}><ArrowDown size={17} /></Tool>
          <Tool label={isTile ? '선택 위치부터 4칸 삭제' : '카드 삭제'} disabled={disabled || items.length - batch < minimum} onClick={remove}><Trash2 size={17} /></Tool>
        </div></div>
        <div className={styles.nameAndColor}>
          <label className={styles.field}>이름<Input required maxLength={60} value={selected.title} onChange={event => updateSelected({ title: event.target.value })} /></label>
          <label className={styles.field}>색상<input type="color" className={styles.colorInput} value={selected.color} onChange={event => updateSelected({ color: event.target.value })} /></label>
        </div>
        <div className={styles.contentIconField}>
          <MarbleTileArt kind={marbleContentIcon(selected, isTile ? selectedIndex : -1)} />
          <label className={styles.field}>아이콘<select className={styles.select} value={selected.icon ?? ''} onChange={event => {
            const next = { ...selected };
            if (event.target.value) next.icon = event.target.value as MarbleIcon;
            else delete next.icon;
            updateItems(items.map((item, index) => index === selectedIndex ? next : item));
          }}><option value="">자동 선택</option>{Object.entries(MARBLE_ICON_LABELS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        </div>
        {!isTile ? <label className={styles.field}>이벤트 종류<select className={styles.select} value={selected.eventKind ?? ''} onChange={event => {
          const next = { ...selected };
          if (event.target.value) next.eventKind = event.target.value as MarbleEventKind;
          else delete next.eventKind;
          updateItems(items.map((item, index) => index === selectedIndex ? next : item));
        }}><option value="">특별 이벤트</option>{Object.entries(MARBLE_EVENT_LABELS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label> : null}
        <label className={styles.field}>본문<textarea className={styles.textarea} rows={4} maxLength={1000} value={selected.text} onChange={event => updateSelected({ text: event.target.value })} /></label>
        {!isTile ? <label className={styles.challengeToggle}><input type="checkbox" checked={!!selected.challenge} onChange={event => {
          if (event.target.checked) {
            if (selected.effects.some(effect => ['move', 'goto', 'skip'].includes(effect.type)) && !window.confirm('판정형 카드에서는 고정 이동·지정 칸 이동·쉬어가기 효과가 제거됩니다. 전환할까요?')) return;
            updateSelected({ effects: selected.effects.filter(effect => ['message', 'timer'].includes(effect.type)), challenge: {
            rollDice: false, success: { text: '성공 보상', effects: selected.effects.filter(effect => resultTypes.includes(effect.type) && !['timer', 'message'].includes(effect.type)) },
            failure: { text: '실패 벌칙', effects: [] },
          } });
          }
          else if (window.confirm('판정별 보상·벌칙을 제거하고 즉시 실행형으로 바꿀까요?')) {
            const next = { ...selected }; delete next.challenge;
            updateItems(items.map((item, index) => index === selectedIndex ? next : item));
          }
        }} /> 성공·실패 판정</label> : null}
        <EffectEditor label={selected.challenge ? '미션 진행 효과' : '효과'} effects={selected.effects} allowed={selected.challenge ? ['message', 'timer'] : effectTypes.filter(type => isTile || type !== 'card')} tileCount={settings.tiles.length} disabled={disabled} onChange={effects => updateSelected({ effects })} />
        {selected.challenge ? <div className={styles.challengeEditor}>
          <label className={styles.challengeToggle}><input type="checkbox" checked={selected.challenge.rollDice} onChange={event => updateChallenge({ rollDice: event.target.checked })} /> 별도 미션 주사위 1개</label>
          {selected.challenge.rollDice ? <Button type="button" size="sm" variant="outline" onClick={() => updateSelected({ text: selected.text + '{dice}' })} disabled={disabled || selected.text.length > 994}><Plus size={14} />본문에 주사위 눈금 삽입</Button> : null}
          {(['success', 'failure'] as const).map(key => <div className={styles.challengeEditor} key={key}>
            <label className={styles.field}>{key === 'success' ? '성공 보상' : '실패 벌칙'}<textarea className={styles.textarea} rows={3} required maxLength={1000} value={selected.challenge![key].text} onChange={event => updateChallenge({ [key]: { ...selected.challenge![key], text: event.target.value } })} /></label>
            <EffectEditor label={key === 'success' ? '성공 효과' : '실패 효과'} effects={selected.challenge![key].effects} allowed={resultTypes} tileCount={settings.tiles.length} disabled={disabled} onChange={effects => updateChallenge({ [key]: { ...selected.challenge![key], effects } })} />
          </div>)}
        </div> : null}
      </fieldset> : null}
    </div>
  </section>;
}
