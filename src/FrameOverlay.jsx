import { useLayoutEffect, useMemo, useState } from 'react';
import { FRAME, SUB, resolveStyle, SUB_TAIL, wrapLines, highlightParts } from '../shared/layout.js';
import { resolveLayer, layerState } from '../shared/cards.js';
import { LayerView } from './thumbs/ThumbCanvas.jsx';

// libass의 Fontsize는 '줄 높이(ascent+descent)' 기준 → CSS px = fs / ratio
const ratioCache = new Map();
export function fontRatio(family, ver = 0) {
  const ck = `${family}|${ver}`;
  if (ratioCache.has(ck)) return ratioCache.get(ck);
  let r = 1.45;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `100px ${family}`;
    const m = ctx.measureText('가Ag');
    const h = (m.fontBoundingBoxAscent || 0) + (m.fontBoundingBoxDescent || 0);
    if (h > 50) r = h / 100;
  } catch {}
  ratioCache.set(ck, r);
  return r;
}
const fam = (font) => `"${font}", "Malgun Gothic", "Noto Sans CJK KR", "Noto Sans KR", sans-serif`;
// 설치된 Google 폰트는 정적 굵기 파일을 FontFace로 등록(normal) → 굵기 지정 불필요
const weightOf = (face) => (face.installed && face.source !== 'system' ? 400 : face.weight || 700);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const fade = (t, a, b, fi, fo) => (t < a || t >= b ? 0 : clamp01(Math.min((t - a) / fi, (b - t) / fo)));

// 비디오 요소 안에서 실제 영상이 그려지는 영역 (object-fit: contain)
export function useFrameRect(ref, ready) {
  const [rect, setRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const calc = () => {
      const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return;
      const ar = FRAME.W / FRAME.H;
      const w = W / H > ar ? H * ar : W; const h = w / ar;
      setRect({ x: (W - w) / 2, y: (H - h) / 2, w, h });
    };
    calc();
    const ro = new ResizeObserver(calc); ro.observe(el);
    return () => ro.disconnect();
  }, [ref, ready]);
  return rect;
}

// insts: shared/cards.js cardInstances 결과. hide: 편집 중이라 따로 그리는 카드 인스턴스(kind:idx)
export default function FrameOverlay({ rect, t, lines, insts = [], hide, st, fontsReady, fontsList = [], fallbackFont }) {
  st = st || resolveStyle({});
  const C = st.colors; const S = st.sub; const fsub = st.face.sub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rSub = useMemo(() => fsub.ratio || fontRatio(fam(fsub.name), fontsReady), [fsub.name, fsub.ratio, fontsReady]);
  if (!rect.w) return null;
  const s = rect.w / FRAME.W;
  const box = { position: 'absolute', left: rect.x, top: rect.y, width: FRAME.W, height: FRAME.H, transform: `scale(${s})`,
    transformOrigin: '0 0', pointerEvents: 'none', overflow: 'hidden' };

  const els = [];
  // 카드 (인트로·챕터·엔딩)
  insts.forEach((inst) => {
    if (t < inst.a || t >= inst.b || hide === `${inst.kind}:${inst.idx}`) return;
    inst.card.layers.forEach((l) => {
      if (l.visible === false) return;
      const ls = layerState(inst, l, t); if (!ls || ls.op <= 0) return;
      els.push(
        <div key={`${inst.kind}${inst.idx}-${l.id}`} style={{ position: 'absolute', inset: 0, opacity: ls.op, transform: ls.dx || ls.dy ? `translate(${ls.dx}px, ${ls.dy}px)` : undefined }}>
          <LayerView l={resolveLayer(l, st, inst.vars)} fontsList={fontsList} fallbackFont={fallbackFont} fontsVer={fontsReady} s={s} />
        </div>,
      );
    });
  });
  // 나레이션 자막
  const act = lines.find((l) => l.text.trim() && t >= l.start && t < l.start + l.dur + SUB_TAIL);
  const hexA = (hex, a) => { const h = hex.replace('#', ''); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; };
  if (act) {
    const o = fade(t, act.start, act.start + act.dur + SUB_TAIL, 0.15, 0.15);
    els.push(
      <div key="sub" style={{ position: 'absolute', left: SUB.marginH, right: SUB.marginH, bottom: S.marginV, textAlign: 'center',
        fontFamily: fam(fsub.name), fontWeight: weightOf(fsub), fontSize: S.size / rSub, lineHeight: `${S.size}px`, color: C.text, opacity: o,
        WebkitTextStroke: S.outline ? `${S.outline * 2}px ${C.outline}` : undefined, paintOrder: 'stroke fill',
        textShadow: S.shadow ? `${S.shadow}px ${S.shadow}px 0 ${hexA(C.outline, SUB.shadowAlpha)}` : undefined, whiteSpace: 'pre' }}>
        {wrapLines(act.text, S.maxChars).map((ln, i) => (
          <div key={i}>{highlightParts(ln, st.keywords).map((p, j) => (p.hl ? <span key={j} style={{ color: C.accent }}>{p.t}</span> : <span key={j}>{p.t}</span>))}</div>
        ))}
      </div>,
    );
  }
  return <div className="frame-overlay" style={box}>{els}</div>;
}
