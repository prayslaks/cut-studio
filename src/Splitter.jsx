import { useRef } from 'react';

// 드래그 분할선. axis='x' (열 너비) | 'y' (높이). onDrag(델타px, 시작값) / 더블클릭 → onReset
export default function Splitter({ axis = 'x', getStart, onDrag, onReset, title }) {
  const st = useRef(null);
  const down = (e) => {
    e.preventDefault();
    st.current = { p: axis === 'x' ? e.clientX : e.clientY, v: getStart() };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add(axis === 'x' ? 'resizing-x' : 'resizing-y');
  };
  const move = (e) => {
    if (!st.current) return;
    onDrag((axis === 'x' ? e.clientX : e.clientY) - st.current.p, st.current.v);
  };
  const up = () => { st.current = null; document.body.classList.remove('resizing-x', 'resizing-y'); };
  return (
    <div className={`splitter ${axis}`} title={title || '드래그로 크기 조절 · 더블클릭으로 초기화'}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={onReset}><i /></div>
  );
}
