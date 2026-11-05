import { useState } from 'react';
import { Modal } from '../Modals.jsx';
import { fmt } from '../timeline.js';

// 구성이 바뀐 뒤 대사를 같은 장면 위치로 옮길지 확인. 옮길 대사를 고르고, 장면이 빠진 대사는 그대로 둘지 지울지 선택
export default function RemapModal({ title, rows, trackName, multiTrack, onApply, onClose }) {
  const [on, setOn] = useState(() => new Set(rows.filter((r) => r.kind !== 'gone').map((r) => r.l.id)));
  const [gone, setGone] = useState('keep');
  const moves = rows.filter((r) => r.kind !== 'gone');
  const lost = rows.filter((r) => r.kind === 'gone');
  const toggle = (id, v) => setOn((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });
  const apply = () => onApply(Object.fromEntries(moves.filter((r) => on.has(r.l.id)).map((r) => [r.l.id, r.to])), gone === 'delete' ? lost.map((r) => r.l.id) : []);
  return (
    <Modal title={`대사 재배치 · ${title}`} onClose={onClose} wide
      footer={<><span className="grow muted sm">옮길 대사 {on.size}/{moves.length}{lost.length ? ` · 장면이 빠진 대사 ${lost.length}줄 ${gone === 'delete' ? '삭제' : '그대로 둠'}` : ''}</span>
        <button onClick={onClose}>건너뛰기</button>
        <button className="primary" disabled={!on.size && !(lost.length && gone === 'delete')} onClick={apply}>재배치 적용</button></>}>
      <p className="hint">영상 구성(구간)이 바뀌어 대사 시작 시각이 화면과 어긋났습니다. 각 대사가 붙어 있던 원본 장면을 새 구성에서 찾아 그 위치로 옮깁니다. 구성을 되돌리면(영상 설정 창 → ↶ 초안 적용 전으로) 같은 방식으로 원위치할 수 있습니다.</p>
      {moves.length > 0 && (
        <section className="rm-sec">
          <div className="row"><b className="grow">옮길 대사 {moves.length}줄</b>
            <button className="ghost sm" onClick={() => setOn(new Set(moves.map((r) => r.l.id)))}>모두</button>
            <button className="ghost sm" onClick={() => setOn(new Set())}>없음</button></div>
          <ul className="rm-list">
            {moves.map((r) => (
              <li key={r.l.id}>
                <label className="chk"><input type="checkbox" checked={on.has(r.l.id)} onChange={(e) => toggle(r.l.id, e.target.checked)} /><code>{r.l.id}</code></label>
                {multiTrack && <small className="muted">{trackName(r.l)}</small>}
                <span className="rm-text">{r.l.text || '(빈 자막)'}</span>
                <span className="rm-t">{fmt(r.l.start)} → <b>{fmt(r.to)}</b>{r.kind === 'end' && <small className="muted"> 엔딩</small>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {lost.length > 0 && (
        <section className="rm-sec">
          <div className="row"><b className="grow">장면이 빠진 대사 {lost.length}줄</b>
            <div className="seg-toggle sm">
              <button className={gone === 'keep' ? 'on' : ''} onClick={() => setGone('keep')}>그대로 두기</button>
              <button className={gone === 'delete' ? 'on' : ''} onClick={() => setGone('delete')}>삭제</button>
            </div></div>
          <ul className="rm-list">
            {lost.map((r) => (
              <li key={r.l.id} className="gone">
                <code>{r.l.id}</code>{multiTrack && <small className="muted">{trackName(r.l)}</small>}
                <span className="rm-text">{r.l.text || '(빈 자막)'}</span><span className="rm-t">{fmt(r.l.start)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  );
}
