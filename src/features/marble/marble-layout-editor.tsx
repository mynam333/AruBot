'use client';

import { Crown, Dice5, Grid3X3, Monitor, RotateCcw, Smartphone, Timer, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_MARBLE_SETTINGS, type MarbleBlock, type MarbleLayouts, type MarbleOrientation, type MarbleSnapshot } from '../../../shared/marble';
import { constrainMarbleLayout, marbleBlockGeometry, MARBLE_STAGE_BLOCKS, MARBLE_STAGE_LABELS, MARBLE_STAGE_SIZES, MarbleStage } from './marble-stage';
import styles from './marble-stage.module.css';

const icons = { board: Grid3X3, dice: Dice5, timer: Timer, card: Crown, roster: Users };

function LayoutNumber({ label, value, max, min = 0, onChange }: { label: string; value: number; max: number; min?: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(String(Math.round(value * 100) / 100)); }, [value]);
  return <label className={styles.layoutField}><span>{label} (%)</span><input type="number" min={min} max={Math.max(min, max)} step={.1} value={draft}
    onFocus={() => { editing.current = true; }} onChange={event => { const next = event.target.value; setDraft(next); if (next !== '' && Number.isFinite(Number(next))) onChange(Number(next)); }}
    onBlur={() => { editing.current = false; setDraft(String(Math.round(value * 100) / 100)); }} /></label>;
}

export type MarbleLayoutEditorProps = { snapshot: MarbleSnapshot; layouts: MarbleLayouts; onChange: (layouts: MarbleLayouts) => void; disabled?: boolean };

export function MarbleLayoutEditor({ snapshot, layouts, onChange, disabled = false }: MarbleLayoutEditorProps) {
  const [orientation, setOrientation] = useState<MarbleOrientation>('landscape');
  const [selected, setSelected] = useState<MarbleBlock>('board');
  const [status, setStatus] = useState('');
  const item = constrainMarbleLayout(selected, layouts[orientation][selected], orientation);
  const canvas = MARBLE_STAGE_SIZES[orientation];
  const shape = marbleBlockGeometry(selected, orientation);
  const heightFactor = canvas.width / canvas.height * shape.height / shape.width;
  const update = (patch: Partial<typeof item>) => {
    if (disabled) return;
    onChange({ ...layouts, [orientation]: { ...layouts[orientation], [selected]: constrainMarbleLayout(selected, { ...item, ...patch }, orientation) } });
    setStatus('배치 변경됨');
  };
  return <section className={styles.editor} aria-label="OBS 화면 배치">
    <div className={styles.editorToolbar}><div className={styles.segments} role="group" aria-label="화면 방향">
      <button type="button" aria-pressed={orientation === 'landscape'} onClick={() => setOrientation('landscape')}><Monitor />가로</button>
      <button type="button" aria-pressed={orientation === 'portrait'} onClick={() => setOrientation('portrait')}><Smartphone />세로</button>
    </div><span className={styles.canvasSize}>{canvas.width} × {canvas.height}</span></div>
    <div className={styles.editorBody}>
      <div><div className={styles.preview} data-orientation={orientation}><MarbleStage snapshot={snapshot} layouts={layouts} orientation={orientation} editable={!disabled} selected={selected} onSelect={setSelected} onLayoutChange={value => { if (!disabled) { onChange(value); setStatus('배치 변경됨'); } }} /></div><div className={styles.layoutStatus} role="status">{status}</div></div>
      <fieldset className={styles.layoutControls} disabled={disabled}><legend>배치 요소</legend>
        <div className={styles.blockChooser} role="group" aria-label="편집할 요소">{MARBLE_STAGE_BLOCKS.map(block => { const Icon = icons[block]; return <button key={block} type="button" aria-pressed={selected === block} onClick={() => setSelected(block)}><Icon />{MARBLE_STAGE_LABELS[block]}</button>; })}</div>
        <div className={styles.layoutFields} key={`${orientation}-${selected}`}>
          <label className={styles.layoutField}>화면에 표시<input type="checkbox" checked={item.visible} onChange={event => update({ visible: event.target.checked })} /></label>
          <LayoutNumber label="가로 위치" value={item.x} max={100 - item.width} onChange={x => update({ x })} />
          <LayoutNumber label="세로 위치" value={item.y} max={100 - item.width * heightFactor} onChange={y => update({ y })} />
          <LayoutNumber label="너비" value={item.width} min={8} max={Math.min(100, 100 / heightFactor)} onChange={width => update({ width })} />
        </div>
        <button type="button" className={styles.resetLayout} onClick={() => { if (disabled) return; onChange({ ...layouts, [orientation]: structuredClone(DEFAULT_MARBLE_SETTINGS.layouts[orientation]) }); setStatus(`${orientation === 'landscape' ? '가로' : '세로'} 기본 배치로 복원됨`); }}><RotateCcw />{orientation === 'landscape' ? '가로' : '세로'} 배치 초기화</button>
      </fieldset>
    </div>
  </section>;
}
