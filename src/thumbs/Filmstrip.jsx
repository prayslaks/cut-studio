import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const FRAME_DT = 1001 / 30000; // 29.97fps 한 프레임
const STEPS = [[FRAME_DT, '1프레임'], [0.1, '0.1초'], [0.5, '0.5초'], [2, '2초'], [10, '10초']];
export const fmt2 = (t) => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`; };
const round = (v) => Math.round(v * 1000) / 1000;

// 현재 장면 주변 프레임을 간격별로 나열 → 클릭으로 정밀 선택, 휠로 한 칸씩 이동
export default function Filmstrip({ vkey, t, body, onPick }) {
  const ref = useRef(null);
  const [n, setN] = useState(9);
  const [si, setSi] = useState(1);
  const step = STEPS[si][0];
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => { const k = Math.max(3, Math.floor(el.clientWidth / 128)); setN(k % 2 ? k : k - 1); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const half = (n - 1) / 2;
  const max = Math.max(0, body - 0.05);
  const clampT = (v) => round(Math.max(0, Math.min(max, v)));
  const frames = Array.from({ length: n }, (_, i) => clampT(t + (i - half) * step));
  const wheel = useRef(null);
  wheel.current = (e) => { e.preventDefault(); onPick(clampT(t + Math.sign(e.deltaY || e.deltaX) * step)); };
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const h = (e) => wheel.current(e); el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  return (
    <div className="fstrip-wrap">
      <div className="fstrip-bar">
        <span className="muted sm">주변 장면 · 간격</span>
        <div className="seg-toggle sm">{STEPS.map(([, label], i) => <button key={label} className={si === i ? 'on' : ''} onClick={() => setSi(i)}>{label}</button>)}</div>
        <span className="grow" />
        <button className="ghost sm" title="한 화면만큼 이전" onClick={() => onPick(clampT(t - step * (half + 1)))}>◀◀</button>
        <button className="ghost sm" title="한 화면만큼 다음" onClick={() => onPick(clampT(t + step * (half + 1)))}>▶▶</button>
      </div>
      <div className="fstrip" ref={ref}>
        {frames.map((ft, i) => (
          <button key={`${i}-${ft}`} className={`fcell ${i === half ? 'on' : ''}`} onClick={() => onPick(ft)} title={`${fmt2(ft)} (${ft.toFixed(3)}s)`}>
            <img src={`/api/thumbs/still?key=${vkey}&t=${ft}&w=240`} alt="" loading="lazy" draggable={false} />
            <small>{i === half ? fmt2(ft) : `${i - half > 0 ? '+' : '−'}${si === 0 ? `${Math.abs(i - half)}f` : `${+(Math.abs(i - half) * step).toFixed(2)}s`}`}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
