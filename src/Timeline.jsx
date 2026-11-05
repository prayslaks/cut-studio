import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fmt } from './timeline.js';

const TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
const MAX_ZOOM = 80;
const KIND = { intro: '인트로', chapter: '챕터', end: '엔딩' };
const rulerTime = (t, step) => {
  const tenths = Math.round(t * 10);
  const seconds = ((tenths % 600) / 10).toFixed(step < 1 ? 1 : 0);
  return `${Math.floor(tenths / 600)}:${seconds.padStart(step < 1 ? 4 : 2, '0')}`;
};

// 멀티 트랙 타임라인: 눈금 / 영상 구간 / 카드 / 나레이션(자막·음성) / 썸네일 장면
// - 빈 곳 클릭·드래그: 재생 위치 이동, 대사·카드 블록 드래그: 시작 시각 이동, Ctrl+휠: 확대
export default function Timeline({ tl, lines, trackName, durOf, statusOf, warnings, editTime, sel, playing, onSeek, onSel, onMove, onDragStart, onDrop,
  chapters = [], insts = [], thumbs = [], onCardClick, onCardMove, onCardDragStart, onThumbClick }) {
  const scRef = useRef(null);
  const wrapRef = useRef(null);
  const ref = useRef(null);
  const drag = useRef(null);
  const pendingZoom = useRef(null);
  const [tip, setTip] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [vw, setVw] = useState(800);
  const [scrollLeft, setScrollLeft] = useState(0);
  useLayoutEffect(() => {
    const el = scRef.current; if (!el) return;
    const measure = () => { if (el.clientWidth) setVw(el.clientWidth); };
    const ro = new ResizeObserver(measure); ro.observe(el); measure();
    return () => ro.disconnect();
  }, []);
  const W = vw * zoom; const pps = W / (tl.total || 1);
  const px = (t) => t * pps;
  const toT = (x) => { const r = ref.current.getBoundingClientRect(); return Math.max(0, Math.min(tl.total, (x - r.left) / pps)); };
  const step = TICKS.find((s) => s * pps >= 70) || TICKS.at(-1);
  const viewStart = Math.min(tl.total, scrollLeft / pps);
  const viewEnd = Math.min(tl.total, (scrollLeft + vw) / pps);

  // 재생 위치가 바뀌었을 때만 따라간다. 확대하거나 범위를 둘러보는 동안에는 위치를 유지한다.
  useEffect(() => {
    const el = scRef.current; if (!el || !tl.total || el.scrollWidth <= el.clientWidth) return;
    const x = editTime / tl.total * ref.current.offsetWidth;
    if (x < el.scrollLeft + 20 || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - el.clientWidth * (playing ? 0.15 : 0.4));
  }, [editTime, playing, tl.total]);

  const changeZoom = (factor, anchor) => {
    const el = scRef.current;
    const current = pendingZoom.current || { scale: zoom, left: el.scrollLeft };
    const scale = factor === null ? 1 : Math.max(1, Math.min(MAX_ZOOM, current.scale * factor));
    if (scale === current.scale) return;
    const left = Math.max(0, Math.min(vw * (scale - 1), (current.left + anchor) * scale / current.scale - anchor));
    pendingZoom.current = { scale, left };
    setZoom(scale);
  };
  useLayoutEffect(() => {
    const next = pendingZoom.current;
    if (!next) return;
    scRef.current.scrollLeft = next.left;
    setScrollLeft(scRef.current.scrollLeft);
    pendingZoom.current = null;
  });

  const wheel = useRef(null);
  wheel.current = (e) => {
    const el = scRef.current;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const anchor = Math.max(0, Math.min(el.clientWidth, e.clientX - el.getBoundingClientRect().left));
      if (e.deltaY) changeZoom(e.deltaY < 0 ? 1.25 : 1 / 1.25, anchor);
    } else if (e.shiftKey && !e.deltaX && el.scrollWidth > el.clientWidth) {
      e.preventDefault();
      el.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1);
    }
  };
  useEffect(() => {
    const el = wrapRef.current;
    const h = (e) => wheel.current(e); el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);
  const zoomBy = (factor) => {
    const el = scRef.current;
    const cursor = px(editTime) - el.scrollLeft;
    changeZoom(factor, cursor >= 0 && cursor < el.clientWidth ? cursor : el.clientWidth / 2);
  };

  const downBg = (e) => {
    if (e.button !== 0) return;
    drag.current = { mode: 'seek' }; ref.current.setPointerCapture(e.pointerId);
    onSeek(toT(e.clientX));
  };
  const downItem = (e, d) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    ref.current.setPointerCapture(e.pointerId);
    drag.current = { ...d, x0: e.clientX, moved: false };
  };
  const move = (e) => {
    const d = drag.current; if (!d) return;
    if (d.mode === 'seek') { onSeek(toT(e.clientX)); return; }
    const dx = e.clientX - d.x0;
    if (!d.moved) { if (Math.abs(dx) < 3 || d.fixed) return; d.moved = true; onDragStart?.(); if (d.mode === 'mark') onSel(d.l, true); else onCardDragStart?.(d.inst); }
    const stepT = e.altKey ? 0.01 : 0.1;
    let t = d.t0 + dx / pps;
    if (Math.abs(t - editTime) * pps < 6) t = editTime;
    t = Math.round(Math.max(d.min ?? 0, Math.min(d.max ?? tl.total - 0.5, t)) / stepT) * stepT;
    t = Math.round(t * 100) / 100;
    if (t === d.cur) return; d.cur = t;
    if (d.mode === 'mark') { onMove(d.id, t); onSeek(t); setTip({ x: px(t), text: `${d.id} ${fmt(t)}  (${t - d.t0 >= 0 ? '+' : '−'}${Math.abs(t - d.t0).toFixed(e.altKey ? 2 : 1)}s)` }); }
    else { onCardMove?.(d.inst, t); onSeek(t + 0.05); setTip({ x: px(t), text: `${d.label} ${fmt(t)}` }); }
  };
  const up = () => {
    const d = drag.current; drag.current = null; setTip(null);
    if (!d || d.mode === 'seek') return;
    if (!d.moved) { if (d.mode === 'mark') onSel(d.l); else if (d.mode === 'card') onCardClick?.(d.inst); else if (d.mode === 'thumb') onThumbClick?.(d.th); return; }
    if (d.mode === 'mark') setTimeout(() => onDrop?.(d.id), 50);
  };
  const cancel = useCallback((e) => {
    const d = drag.current; if (e.key !== 'Escape' || !d?.moved) return;
    if (d.mode === 'mark') { onMove(d.id, d.t0); onSeek(d.t0); } else onCardMove?.(d.inst, d.t0);
    drag.current = null; setTip(null);
  }, [onMove, onSeek, onCardMove]);
  useEffect(() => { window.addEventListener('keydown', cancel); return () => window.removeEventListener('keydown', cancel); }, [cancel]);

  const ticks = []; for (let i = 0; i * step < tl.total; i++) ticks.push(i * step);
  const cls = (d) => (drag.current?.moved && drag.current[d.k] === d.v ? 'dragging' : '');

  return (
    <div className="mtl" ref={wrapRef}>
      <div className="mtl-toolbar">
        <div className="mtl-zoom" aria-label="타임라인 확대·축소" role="group">
          <button className="ghost" aria-label="타임라인 축소" onClick={() => zoomBy(1 / 1.5)} disabled={zoom <= 1}>−</button>
          <button className="ghost" aria-label="타임라인 확대" onClick={() => zoomBy(1.5)} disabled={zoom >= MAX_ZOOM}>＋</button>
          <button className="ghost" onClick={() => changeZoom(null, 0)} disabled={zoom <= 1}>전체 보기</button>
        </div>
        <span className="mtl-range" title="타임라인에 표시 중인 편집본 범위">{fmt(viewStart)} – {fmt(viewEnd)}</span>
        <span className="mtl-hint">Ctrl+휠 확대·축소 · Shift+휠 이동</span>
      </div>
      <div className="mtl-labels">
        <span className="r-ruler">시간</span>
        <span className="r-video">영상</span>
        <span className="r-cards">카드</span>
        <span className="r-lines" title={trackName ? `나레이션 트랙: ${trackName}` : undefined}>{trackName || '나레이션'}</span>
        <span className="r-thumbs">썸네일</span>
      </div>
      <div className="mtl-scroll" ref={scRef} tabIndex={0} role="region" aria-label="편집본 타임라인" onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}>
        <div className="mtl-inner" ref={ref} style={{ width: W }} onPointerDown={downBg} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="trk r-ruler">
            {ticks.map((t) => <span key={t} className="tick" style={{ left: px(t) }}>{rulerTime(t, step)}</span>)}
          </div>
          <div className="trk r-video">
            {tl.parts.map((g) => {
              const c = chapters[g.i]; const name = c && (c.kr || c.en) ? `${c.num ? `${c.num} ` : ''}${c.kr || c.en}` : `구간 ${g.i + 1}`;
              return <div key={g.i} className="clip" style={{ left: px(g.off), width: Math.max(2, px(g.dur) - 1) }} title={`${name} · 원본 ${fmt(g.s)}–${fmt(g.e)} · 편집본 ${fmt(g.off)}부터`}>{name}</div>;
            })}
            <div className="clip end" style={{ left: px(tl.body), width: px(tl.total - tl.body) }} title="엔딩 카드 구간">엔딩</div>
          </div>
          <div className="trk r-cards">
            {insts.map((inst) => {
              const label = inst.kind === 'chapter' ? `${inst.vars.num || ''} ${inst.vars.kr || inst.vars.en || ''}`.trim() : KIND[inst.kind];
              const key = `${inst.kind}:${inst.idx}`;
              const segStart = tl.parts[inst.idx]?.off ?? 0;
              const fixed = inst.kind === 'end';
              const d = inst.kind === 'intro' ? { min: 0, max: tl.body - 1 } : inst.kind === 'chapter' ? { min: segStart, max: segStart + (tl.parts[inst.idx]?.dur || 1) - 1 } : {};
              return (
                <div key={key} className={`cblk ${inst.kind} ${drag.current?.moved && drag.current.key === key ? 'dragging' : ''}`}
                  style={{ left: px(inst.a), width: Math.max(4, px(inst.b - inst.a)) }}
                  title={`${KIND[inst.kind]} 카드 ${fmt(inst.a)}–${fmt(inst.b)}${fixed ? '' : '\n드래그: 시작 시각 이동 · 클릭: 카드 편집'}`}
                  onPointerDown={(e) => downItem(e, { mode: 'card', inst, key, t0: inst.a, label: KIND[inst.kind], fixed, ...d })}>{label}</div>
              );
            })}
          </div>
          <div className="trk r-lines">
            {lines.map((l) => (
              <div key={l.id} className={`mark ${statusOf(l)} ${warnings[l.id] ? 'warnm' : ''} ${sel === l.id ? 'sel' : ''} ${cls({ k: 'id', v: l.id })}`}
                style={{ left: px(l.start), width: Math.max(14, px(durOf(l))) }} title={`${l.id} ${fmt(l.start)} · ${l.text}\n드래그: 시작 시각 이동 (0.1초, Alt 0.01초, Esc 취소)`}
                onPointerDown={(e) => downItem(e, { mode: 'mark', id: l.id, l, t0: l.start })}>{l.id.replace(/^[A-Za-z]+/, '')}</div>
            ))}
          </div>
          <div className="trk r-thumbs">
            {thumbs.map((d) => (
              <i key={d.id} className="tmk" style={{ left: px(d.t) }} title={`썸네일 '${d.label || ''}' 장면 ${fmt(d.t)} · 클릭: 썸네일 편집`}
                onPointerDown={(e) => downItem(e, { mode: 'thumb', th: d, t0: d.t, fixed: true })} />
            ))}
          </div>
          <div className="head" style={{ left: Math.min(px(editTime), W - 2) }} />
          {tip && <div className="tl-tip" style={{ left: tip.x }}>{tip.text}</div>}
        </div>
      </div>
    </div>
  );
}
