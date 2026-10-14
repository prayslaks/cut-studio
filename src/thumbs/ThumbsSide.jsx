import { useState } from 'react';
import { fmt } from '../timeline.js';
import { PROVIDERS } from '../Agent.jsx';

// 가운데 패널(썸네일 모드): AI 일괄 생성 + 초안 목록
export default function ThumbsSide({ T, tab, editTime, ai, aiKey, onOpenSettings }) {
  const [count, setCount] = useState(4);
  const [brief, setBrief] = useState('');
  const mine = T.list.filter((d) => d.key === tab).sort((a, b) => (b.rendered || 0) - (a.rendered || 0));
  const generate = () => {
    if (!aiKey) { onOpenSettings(); return; }
    T.agentGenerate({ key: tab, provider: ai.provider, model: ai.model, aiKey, count, brief });
  };
  return (
    <div className="thumbs">
      <div className="th-gen">
        <div className="th-row">
          <b>AI 초안</b><span className="muted sm">{PROVIDERS[ai.provider]?.label} · {ai.model}</span>
          <span className="grow" />
          <label className="field inline"><span>개수</span>
            <select value={count} onChange={(e) => setCount(+e.target.value)}>{[2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n === 10 ? '최대 10' : n}</option>)}</select></label>
        </div>
        <input value={brief} placeholder="추가 요청 (예: 보스전 위주로, 문구는 더 강하게)" onChange={(e) => setBrief(e.target.value)} />
        <div className="th-row">
          <button className="primary" disabled={!!T.busy} onClick={generate}>{aiKey ? '✦ AI 초안 생성' : '설정에서 AI 키 등록'}</button>
          <button disabled={!!T.busy} onClick={() => T.create(tab, editTime)}>＋ 영상 위치({fmt(editTime)})로 새 초안</button>
        </div>
        {T.busy && <div className="th-busy">{T.busy === 'AI 초안 생성' ? `후보 장면 추출 → AI가 장면·문구 선택(최대 ${count}개) → PNG 렌더 중…` : `${T.busy} 중…`}</div>}
      </div>
      <div className="th-grid">
        {!mine.length && <div className="muted empty">아직 초안이 없습니다.</div>}
        {mine.map((d) => (
          <div key={d.id} role="button" tabIndex={0} className={`th-card ${T.draft?.id === d.id ? 'on' : ''}`} onClick={() => T.select(d.id)}>
            <span className="th-img"><img src={`/api/thumbs/${d.id}.png?v=${d.rendered}`} alt={d.label} loading="lazy" /><i className="th-time">{fmt(d.t)}</i></span>
            <span className="th-meta" title={d.reason || undefined}>
              <b>{d.label || '썸네일'}</b>
              <small>{[d.agent ? `AI · ${PROVIDERS[d.agent]?.label || d.agent}` : '직접 만듦', d.template && d.template !== 'custom' ? d.template : null].filter(Boolean).join(' · ')}</small>
              {d.reason && <em>{d.reason}</em>}
            </span>
            <button className="ghost th-del" title="삭제" onClick={(e) => { e.stopPropagation(); if (window.confirm('이 초안을 삭제할까요?')) T.remove(d.id); }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
