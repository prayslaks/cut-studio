import { useState } from 'react';
import { TEMPLATES, templateLayers, textLayer, rectLayer, gradLayer } from '../../shared/thumbLayers.js';
import { fmt } from '../timeline.js';
import Filmstrip, { FRAME_DT, fmt2 } from './Filmstrip.jsx';

const ICON = { text: 'T', rect: '■', grad: '◐' };
const ROLE = { title: '브랜드', kicker: '핵심 문구', sub: '부제', badge: '날짜', bar: '강조 바' };
const nameOf = (l) => (l.type === 'text' ? (l.text || '').split('\n')[0].slice(0, 18) || '(빈 텍스트)' : l.role ? ROLE[l.role] : l.type === 'rect' ? '박스' : '그라데이션');

export function Num({ label, value, onChange, step = 1, min, max, w = 64 }) {
  return (
    <label className="ifield"><span>{label}</span>
      <input type="number" step={step} min={min} max={max} value={value ?? 0} style={{ width: w }} onChange={(e) => onChange(+e.target.value)} /></label>
  );
}
export function Slider({ label, value, onChange, min, max, step = 1, fmtv = (v) => v }) {
  return (
    <label className="ifield grow"><span>{label} <b>{fmtv(value ?? 0)}</b></span>
      <input type="range" min={min} max={max} step={step} value={value ?? 0} onChange={(e) => onChange(+e.target.value)} /></label>
  );
}
export function Color({ label, value, onChange }) {
  return (
    <label className="ifield color"><span>{label}</span>
      <span className="cwrap"><input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} /><code>{value}</code></span></label>
  );
}

export default function ThumbInspector({ T, body, editTime, style, fontsList, onInstallFont, compare, setCompare }) {
  const d = T.draft;
  const [tab, setTab] = useState('layer');
  if (!d) return null;
  const l = d.layers.find((x) => x.id === T.selLayer);
  const set = (patch) => l && T.updateLayer(l.id, patch);
  const setD = (patch) => T.update((x) => ({ ...x, ...patch }));
  const setT = (v) => T.update((x) => ({ ...x, t: Math.round(Math.max(0, Math.min(body - 0.05, v)) * 1000) / 1000 }));
  const move = (dir) => T.update((x) => {
    const i = x.layers.findIndex((y) => y.id === l.id); const k = i + dir;
    if (k < 0 || k >= x.layers.length) return x;
    const a = [...x.layers]; [a[i], a[k]] = [a[k], a[i]]; x.layers = a; return x;
  });
  const add = (factory) => {
    const nl = factory();
    if (nl.type === 'text') { nl.font = { ...(style?.fonts?.title || {}) }; nl.color = style?.colors?.text || '#FFFFFF'; nl.shadow = { dist: 4, color: style?.colors?.outline || '#080C0F', alpha: 1 }; }
    T.update((x) => { x.layers = [...x.layers, nl]; return x; }); T.setSelLayer(nl.id);
  };
  const applyTemplate = (tpl) => {
    const get = (role) => d.layers.find((y) => y.role === role)?.text;
    const f = { title: get('title') ?? '', kicker: get('kicker') || '', sub: get('sub') || '', badge: get('badge') || '' };
    T.update((x) => ({ ...x, template: tpl, layers: templateLayers(tpl, f, style) })); T.setSelLayer(null);
  };
  const fontKey = l?.font ? `${l.font.source === 'system' ? 'sys' : 'g'}|${l.font.family}|${l.font.weight}` : '';
  const fontOpts = [
    ...fontsList.map((f) => ({ k: `g|${f.family}|${f.weight}`, label: `${f.family} ${f.weight}`, v: { family: f.family, weight: f.weight } })),
  ];
  const inList = fontOpts.some((o) => o.k === fontKey);

  return (
    <div className="tinsp">
      <div className="ti-bar">
        <div className="seg-toggle">
          {[['layer', '레이어'], ['bg', '배경 장면'], ['tpl', '템플릿']].map(([k, n]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>)}
        </div>
        <span className="grow" />
        <button className="ghost" disabled={!T.canUndo} title="실행취소 (Ctrl+Z)" onClick={T.undo}>↶</button>
        <button className="ghost" disabled={!T.canRedo} title="다시 실행 (Ctrl+Y)" onClick={T.redo}>↷</button>
        <label className="chk" title="서버(ffmpeg) 최종 렌더를 겹쳐 비교"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />실제 렌더 비교</label>
        <span className="muted sm">{T.saving ? '저장·렌더 중…' : '자동 저장됨'}</span>
        <button onClick={T.duplicate} disabled={!!T.busy}>복제</button>
        <button className="primary" onClick={T.savePng} disabled={!!T.busy}>⬇ PNG 저장</button>
      </div>

      {tab === 'layer' && (
        <div className="ti-body">
          <div className="ti-layers">
            <div className="ti-add">
              <button onClick={() => add(() => textLayer({ text: '새 텍스트' }))}>＋ 텍스트</button>
              <button onClick={() => add(() => rectLayer())}>＋ 박스</button>
              <button onClick={() => add(() => gradLayer())}>＋ 그라데이션</button>
            </div>
            <ol>
              {[...d.layers].reverse().map((y) => (
                <li key={y.id} className={`${T.selLayer === y.id ? 'on' : ''} ${y.visible === false ? 'hid' : ''}`} onClick={() => T.setSelLayer(y.id)}>
                  <i>{ICON[y.type]}</i><span>{nameOf(y)}</span>
                  <button className="ghost" title="보이기/숨기기" onClick={(e) => { e.stopPropagation(); T.updateLayer(y.id, { visible: y.visible === false }); }}>{y.visible === false ? '◌' : '●'}</button>
                </li>
              ))}
            </ol>
          </div>
          <div className="ti-props">
            {!l ? <p className="muted">캔버스나 목록에서 레이어를 선택하세요. 드래그로 이동, 모서리 핸들로 크기 조절, 방향키로 미세 이동(Shift ×10), Delete로 삭제.</p> : (
              <>
                <div className="ti-row ti-head">
                  <b>{nameOf(l)}</b><span className="grow" />
                  <button className="ghost" title="앞으로" onClick={() => move(1)}>▲</button>
                  <button className="ghost" title="뒤로" onClick={() => move(-1)}>▼</button>
                  <button className="ghost" onClick={() => { T.update((x) => { x.layers = x.layers.filter((y) => y.id !== l.id); return x; }); T.setSelLayer(null); }}>삭제</button>
                </div>
                {l.type === 'text' && (<>
                  <textarea rows={2} value={l.text} onChange={(e) => set({ text: e.target.value })} />
                  <div className="ti-row">
                    <label className="ifield grow"><span>폰트</span>
                      <select value={inList ? fontKey : '__cur'} onChange={(e) => {
                        const o = fontOpts.find((x) => x.k === e.target.value); if (o) set({ font: o.v });
                      }}>
                        {!inList && <option value="__cur">{l.font?.family || '기본'} {l.font?.weight || ''}{l.font?.source === 'system' ? ' (시스템)' : ' (미설치)'}</option>}
                        {fontOpts.map((o) => <option key={o.k} value={o.k}>{o.label}</option>)}
                      </select></label>
                    {!inList && l.font?.family && l.font?.source !== 'system' && <button className="accent sm" onClick={() => onInstallFont(l.font.family, l.font.weight)}>설치</button>}
                  </div>
                  <div className="ti-row">
                    <Slider label="크기" value={l.size} min={12} max={320} onChange={(v) => set({ size: v })} />
                    <Slider label="자간" value={l.spacing || 0} min={-20} max={40} onChange={(v) => set({ spacing: v })} />
                    <Color label="색" value={l.color} onChange={(v) => set({ color: v })} />
                  </div>
                  <div className="ti-row">
                    <Slider label="외곽선" value={l.outline?.width || 0} min={0} max={16} step={0.5} onChange={(v) => set({ outline: { width: v } })} />
                    <Color label="외곽선 색" value={l.outline?.color} onChange={(v) => set({ outline: { color: v } })} />
                    <Slider label="그림자" value={l.shadow?.dist || 0} min={0} max={16} step={0.5} onChange={(v) => set({ shadow: { dist: v } })} />
                    <Color label="그림자 색" value={l.shadow?.color} onChange={(v) => set({ shadow: { color: v } })} />
                  </div>
                  <div className="ti-row">
                    <div className="ifield"><span>기준점</span>
                      <div className="anchors">{[7, 8, 9, 4, 5, 6, 1, 2, 3].map((a) => <button key={a} className={l.anchor === a ? 'on' : ''} onClick={() => set({ anchor: a })} />)}</div></div>
                    <Num label="X" value={l.x} onChange={(v) => set({ x: v })} />
                    <Num label="Y" value={l.y} onChange={(v) => set({ y: v })} />
                    <div className="ifield"><span>색 빠른 선택</span>
                      <div className="swatch">{[style?.colors?.text, style?.colors?.accent, style?.colors?.outline].filter(Boolean).map((c) => <button key={c} style={{ background: c }} title={c} onClick={() => set({ color: c })} />)}</div></div>
                  </div>
                </>)}
                {(l.type === 'rect' || l.type === 'grad') && (<>
                  <div className="ti-row">
                    <Num label="X" value={l.x} onChange={(v) => set({ x: v })} /><Num label="Y" value={l.y} onChange={(v) => set({ y: v })} />
                    <Num label="너비" value={l.w} onChange={(v) => set({ w: v })} /><Num label="높이" value={l.h} onChange={(v) => set({ h: v })} />
                    <Color label="색" value={l.color} onChange={(v) => set({ color: v })} />
                  </div>
                  {l.type === 'rect' ? (
                    <div className="ti-row">
                      <Slider label="불투명도" value={l.alpha ?? 1} min={0} max={1} step={0.01} fmtv={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ alpha: v })} />
                      <Slider label="흐림" value={l.blur || 0} min={0} max={60} onChange={(v) => set({ blur: v })} />
                    </div>
                  ) : (
                    <div className="ti-row">
                      <label className="ifield"><span>방향</span>
                        <select value={l.dir} onChange={(e) => set({ dir: e.target.value })}>
                          <option value="right">왼쪽 → 오른쪽</option><option value="left">오른쪽 → 왼쪽</option><option value="down">위 → 아래</option><option value="up">아래 → 위</option>
                        </select></label>
                      <Slider label="시작 불투명도" value={l.from} min={0} max={1} step={0.01} fmtv={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ from: v })} />
                      <Slider label="끝 불투명도" value={l.to} min={0} max={1} step={0.01} fmtv={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ to: v })} />
                    </div>
                  )}
                </>)}
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'bg' && (
        <div className="ti-body col">
          <div className="ti-row">
            <Slider label={`장면 시각 ${fmt2(d.t)}`} value={d.t} min={0} max={Math.max(1, body - 0.05)} step={0.01} onChange={(v) => setT(v)} />
          </div>
          <div className="ti-row tjog">
            <label className="ifield"><span>시각(초)</span>
              <input type="number" step={0.01} min={0} value={d.t} style={{ width: 92 }} onChange={(e) => Number.isFinite(+e.target.value) && setT(+e.target.value)} /></label>
            {[[-1, '−1초'], [-0.1, '−0.1'], [-FRAME_DT, '−1f'], [FRAME_DT, '+1f'], [0.1, '+0.1'], [1, '+1초']].map(([dt, n]) => (
              <button key={n} className="sm" title={dt === FRAME_DT || dt === -FRAME_DT ? '한 프레임 (단축키 , .)' : undefined} onClick={() => setT(d.t + dt)}>{n}</button>
            ))}
            <span className="grow" />
            <button onClick={() => setT(editTime)}>⌖ 영상 재생 위치({fmt(editTime)})</button>
          </div>
          <Filmstrip vkey={d.key} t={d.t} body={body} onPick={setT} />
          <div className="ti-row">
            <Slider label="확대" value={d.zoom || 1} min={1} max={2.5} step={0.05} fmtv={(v) => `${v.toFixed(2)}×`} onChange={(v) => setD({ zoom: v })} />
            <Slider label="중심 X" value={d.fx ?? 0.5} min={0} max={1} step={0.01} fmtv={(v) => v.toFixed(2)} onChange={(v) => setD({ fx: v })} />
            <Slider label="중심 Y" value={d.fy ?? 0.5} min={0} max={1} step={0.01} fmtv={(v) => v.toFixed(2)} onChange={(v) => setD({ fy: v })} />
          </div>
          <div className="ti-row">
            <Slider label="대비" value={d.grade?.contrast ?? 1.06} min={0.7} max={1.5} step={0.01} fmtv={(v) => v.toFixed(2)} onChange={(v) => setD({ grade: { ...(d.grade || {}), contrast: v } })} />
            <Slider label="채도" value={d.grade?.saturation ?? 1.12} min={0} max={2} step={0.01} fmtv={(v) => v.toFixed(2)} onChange={(v) => setD({ grade: { ...(d.grade || {}), saturation: v } })} />
            <Slider label="밝기" value={d.grade?.brightness ?? 0} min={-0.3} max={0.3} step={0.01} fmtv={(v) => v.toFixed(2)} onChange={(v) => setD({ grade: { ...(d.grade || {}), brightness: v } })} />
          </div>
        </div>
      )}

      {tab === 'tpl' && (
        <div className="ti-body col">
          <p className="hint">템플릿을 적용하면 레이어 배치가 바뀝니다(브랜드·핵심 문구·부제·날짜 텍스트는 유지). 실행취소로 되돌릴 수 있습니다.</p>
          <div className="tpls">
            {Object.entries(TEMPLATES).map(([k, v]) => (
              <button key={k} className={d.template === k ? 'on' : ''} onClick={() => applyTemplate(k)}><b>{v.label}</b><small>{v.desc}</small></button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
