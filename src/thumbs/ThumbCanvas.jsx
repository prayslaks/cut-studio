import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TW, TH, anchorXY } from '../../shared/thumbLayers.js';
import { fontRatio } from '../FrameOverlay.jsx';

const rgba = (hex = '#000000', a = 1) => { const h = String(hex).replace('#', '').padEnd(6, '0'); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; };
const DIRS = { right: 'to right', left: 'to left', down: 'to bottom', up: 'to top' };

// 레이어 폰트 → 브라우저 폰트 정보 (설치 폰트는 FontFace 이름, libass 크기 비율)
export function faceOf(font = {}, fontsList = [], fallback = 'Malgun Gothic') {
  const f = fontsList.find((x) => x.family === font.family && x.weight === font.weight);
  if (f) return { css: `"${f.cssFamily}"`, weight: 400, ratio: f.ratio };
  if (font.source === 'system') return { css: `"${font.family}"`, weight: font.weight || 700, ratio: null };
  return { css: `"${fallback}"`, weight: font.weight || 700, ratio: null, missing: !!font.family };
}

function useBox(ref) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export default function ThumbCanvas({ draft, fontsList, fallbackFont, fontsVer, selLayer, setSelLayer, updateLayer, beginGesture, endGesture, compare }) {
  const boxRef = useRef(null);
  const w = useBox(boxRef);
  const s = w / TW;
  const drag = useRef(null);
  const [bgUrl, setBgUrl] = useState(null);
  const [bgLoading, setBgLoading] = useState(false);

  // 배경 장면 (확대·보정 반영). 값이 바뀌면 잠시 후 갱신
  const bgKey = draft ? `${draft.key}|${draft.t}|${draft.zoom}|${draft.fx}|${draft.fy}|${JSON.stringify(draft.grade || {})}` : '';
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(async () => {
      setBgLoading(true);
      const g = draft.grade || {};
      const q = new URLSearchParams({ key: draft.key, t: draft.t, zoom: draft.zoom || 1, fx: draft.fx ?? 0.5, fy: draft.fy ?? 0.5,
        ...(g.contrast != null ? { c: g.contrast } : {}), ...(g.saturation != null ? { s: g.saturation } : {}), ...(g.brightness != null ? { b: g.brightness } : {}) });
      try {
        const r = await fetch(`/api/thumbs/bg?${q}`); if (!r.ok) throw new Error();
        const u = URL.createObjectURL(await r.blob());
        setBgUrl((old) => { if (old) URL.revokeObjectURL(old); return u; });
      } catch {} finally { setBgLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [bgKey]); // eslint-disable-line

  const toFrame = (e) => { const r = boxRef.current.getBoundingClientRect(); return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s }; };

  const onDown = (e, l, mode = 'move') => {
    e.stopPropagation(); e.preventDefault();
    setSelLayer(l.id);
    const p = toFrame(e);
    drag.current = { id: l.id, mode, p0: p, l0: JSON.parse(JSON.stringify(l)), moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const p = toFrame(e); const dx = p.x - d.p0.x, dy = p.y - d.p0.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 1.5) return;
    if (!d.moved) { d.moved = true; beginGesture(); }
    const l0 = d.l0; const snap = (v) => (e.shiftKey ? Math.round(v / 10) * 10 : Math.round(v));
    if (d.mode === 'move') updateLayer(d.id, { x: snap(l0.x + dx), y: snap(l0.y + dy) }, { commit: false });
    else if (l0.type === 'text') updateLayer(d.id, { size: Math.max(8, Math.round(l0.size * Math.max(0.1, 1 + dy / Math.max(40, l0.size)))) }, { commit: false });
    else updateLayer(d.id, { w: Math.max(4, snap(l0.w + dx)), h: Math.max(4, snap(l0.h + dy)) }, { commit: false });
  };
  const onUp = () => { const d = drag.current; drag.current = null; if (d?.moved) endGesture(); };

  if (!draft) return <div className="tcanvas empty" ref={boxRef}><p className="muted">오른쪽에서 초안을 고르거나 새로 만드세요.</p></div>;

  return (
    <div className="tcanvas" ref={boxRef} onPointerMove={onMove} onPointerUp={onUp} onPointerDown={() => setSelLayer(null)}
      style={{ height: w ? (w * TH) / TW : undefined }}>
      {bgUrl && <img className="tbg" src={bgUrl} alt="" draggable={false} />}
      {bgLoading && <span className="tbg-load">장면 불러오는 중…</span>}
      <div className="tstage" style={{ width: TW, height: TH, transform: `scale(${s})` }}>
        {draft.layers.map((l) => (l.visible === false ? null : (
          <LayerView key={l.id} l={l} sel={selLayer === l.id} onDown={onDown} fontsList={fontsList} fallbackFont={fallbackFont} fontsVer={fontsVer} s={s} />
        )))}
      </div>
      {compare && draft.rendered && <img className="tcompare" src={`/api/thumbs/${draft.id}.png?v=${draft.rendered}`} alt="실제 렌더" />}
    </div>
  );
}

export function LayerView({ l, sel, onDown, fontsList, fallbackFont, fontsVer, s }) {
  const face = useMemo(() => (l.type === 'text' ? faceOf(l.font, fontsList, fallbackFont) : null), [l.type, l.font?.family, l.font?.weight, l.font?.source, fontsList, fallbackFont]); // eslint-disable-line
  const ratio = useMemo(() => (face ? face.ratio || fontRatio(face.css, fontsVer) : 1), [face, fontsVer]);
  const down = onDown ? (e) => onDown(e, l) : undefined;
  const handle = <i className="thandle" style={{ transform: `scale(${1 / s})` }} onPointerDown={(e) => onDown(e, l, 'resize')} />;
  if (l.type === 'rect' || l.type === 'grad') {
    const st = { left: l.x, top: l.y, width: l.w, height: l.h };
    if (l.type === 'rect') Object.assign(st, { background: rgba(l.color, l.alpha ?? 1), filter: l.blur ? `blur(${l.blur / 2}px)` : undefined });
    else Object.assign(st, { background: `linear-gradient(${DIRS[l.dir] || 'to right'}, ${rgba(l.color, l.from)}, ${rgba(l.color, l.to)})` });
    return (
      <div className={`tl tl-shape ${sel ? 'sel' : ''}`} style={st} onPointerDown={down}>
        {sel && <span className="tsel" style={{ outlineWidth: 2 / s }} />}{sel && handle}
      </div>
    );
  }
  const { ax, ay } = anchorXY(l.anchor || 7);
  const ol = l.outline || {}; const sh = l.shadow || {};
  const style = {
    left: l.x, top: l.y, transform: `translate(${-ax * 100}%, ${-ay * 100}%)`,
    fontFamily: `${face.css}, "Malgun Gothic", "Noto Sans CJK KR", sans-serif`, fontWeight: face.weight,
    fontSize: l.size / ratio, lineHeight: `${l.size}px`, letterSpacing: l.spacing ? `${l.spacing}px` : undefined, color: l.color,
    WebkitTextStroke: ol.width ? `${ol.width * 2}px ${ol.color}` : undefined, paintOrder: 'stroke fill',
    textShadow: sh.dist ? `${sh.dist}px ${sh.dist}px 0 ${rgba(sh.color, sh.alpha ?? 1)}` : undefined,
    textAlign: ['left', 'center', 'right'][ax * 2], opacity: l.alpha != null && l.alpha < 1 ? l.alpha : undefined,
  };
  return (
    <div className={`tl tl-text ${sel ? 'sel' : ''}`} style={style} onPointerDown={down}>
      {l.text || ' '}
      {sel && <span className="tsel" style={{ outlineWidth: 2 / s }} />}{sel && handle}
      {face.missing && sel && <em className="tmiss" style={{ transform: `scale(${1 / s})` }}>폰트 미설치</em>}
    </div>
  );
}
