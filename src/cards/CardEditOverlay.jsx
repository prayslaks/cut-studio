import { useRef } from 'react';
import { CW, CH, resolveLayer } from '../../shared/cards.js';
import { LayerView } from '../thumbs/ThumbCanvas.jsx';

// 영상 위에 겹치는 카드 편집 레이어 (최종 상태로 표시, 클릭 선택·드래그 이동·핸들 크기)
export default function CardEditOverlay({ rect, inst, st, C, fontsList, fallbackFont, fontsVer }) {
  const boxRef = useRef(null);
  const drag = useRef(null);
  if (!rect.w || !inst) return null;
  const s = rect.w / CW;

  const toFrame = (e) => { const r = boxRef.current.getBoundingClientRect(); return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s }; };
  const onDown = (e, l, mode = 'move') => {
    e.stopPropagation(); e.preventDefault();
    C.setSelLayer(l.id);
    const raw = inst.card.layers.find((x) => x.id === l.id);
    drag.current = { id: l.id, mode, p0: toFrame(e), l0: JSON.parse(JSON.stringify(raw)), moved: false };
    boxRef.current.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const p = toFrame(e); const dx = p.x - d.p0.x, dy = p.y - d.p0.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    if (!d.moved) { d.moved = true; C.beginGesture(); }
    const l0 = d.l0; const snap = (v) => (e.shiftKey ? Math.round(v / 20) * 20 : Math.round(v));
    if (d.mode === 'move') C.updateLayer(d.id, { x: snap(l0.x + dx), y: snap(l0.y + dy) }, { commit: false });
    else if (l0.type === 'text') C.updateLayer(d.id, { size: Math.max(12, Math.round(l0.size * Math.max(0.1, 1 + dy / Math.max(60, l0.size)))) }, { commit: false });
    else C.updateLayer(d.id, { w: Math.max(4, snap(l0.w + dx)), h: Math.max(4, snap(l0.h + dy)) }, { commit: false });
  };
  const onUp = () => { const d = drag.current; drag.current = null; if (d?.moved) C.endGesture(); };

  return (
    <div className="card-edit" ref={boxRef} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerMove={onMove} onPointerUp={onUp} onPointerDown={() => C.setSelLayer(null)}>
      <div className="tstage" style={{ width: CW, height: CH, transform: `scale(${s})` }}>
        {inst.card.layers.map((l) => (l.visible === false ? null : (
          <LayerView key={l.id} l={resolveLayer(l, st, inst.vars)} sel={C.selLayer === l.id} onDown={onDown}
            fontsList={fontsList} fallbackFont={fallbackFont} fontsVer={fontsVer} s={s} />
        )))}
      </div>
      <span className="card-edit-tag">카드 편집 · 재생하면 애니메이션 미리보기</span>
    </div>
  );
}
