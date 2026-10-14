import { useEffect, useState } from 'react';
import FileBrowser from './FileBrowser.jsx';

const j = async (url, opt = {}) => {
  const r = await fetch(url, opt); const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText); return d;
};
const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const ago = (t) => { if (!t) return ''; const d = (Date.now() - t) / 1000; return d < 3600 ? `${Math.max(1, Math.round(d / 60))}분 전` : d < 86400 ? `${Math.round(d / 3600)}시간 전` : `${Math.round(d / 86400)}일 전`; };

// 프로젝트 시작 화면 (열린 프로젝트가 없을 때 전체 화면, 상단 프로젝트 버튼에서는 창으로)
export default function ProjectHome({ asModal, onClose }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState('list'); // list | new | open
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', brand: '', tagline: '', subtitleFormat: '{title}', brief: '', parent: '' });
  const [pickParent, setPickParent] = useState(false);
  const load = () => j('/api/projects').then((d) => { setData(d); setF((x) => ({ ...x, parent: x.parent || d.defaultParent })); if (!d.projects.length) setView('new'); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const done = () => window.location.reload();
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };

  const body = (
    <div className="ph">
      <div className="ph-head">
        <div className="brand"><b>TTS</b><span>STUDIO</span></div>
        <p className="muted">영상 하나 이상을 묶어 나레이션·자막·카드·썸네일·업로드 문구를 만드는 작업 단위가 프로젝트입니다. 프로젝트마다 폴더 하나에 저장됩니다.</p>
        {asModal && <button className="ghost ph-x" onClick={onClose}>✕</button>}
      </div>
      <div className="seg-toggle ph-tabs">
        {[['list', `최근 프로젝트 ${data?.projects.length || 0}`], ['new', '＋ 새 프로젝트'], ['open', '폴더에서 열기']].map(([k, n]) => (
          <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{n}</button>
        ))}
      </div>
      {err && <div className="callout err">{err}</div>}

      {view === 'list' && (
        <div className="ph-list">
          {!data?.projects.length && <p className="muted">아직 프로젝트가 없습니다.</p>}
          {data?.projects.map((p) => (
            <div key={p.id} className={`ph-item ${data.current?.id === p.id ? 'cur' : ''} ${p.missing ? 'missing' : ''}`}>
              <div className="grow" onClick={() => !p.missing && run(async () => { await post('/api/projects/open', { id: p.id }); done(); })}>
                <b>{p.name}</b>{data.current?.id === p.id && <span className="tag">열림</span>}{p.missing && <span className="tag err">폴더 없음</span>}
                <small>{p.dir}</small>
              </div>
              <span className="muted sm">{ago(p.opened)}</span>
              <button disabled={busy || p.missing} onClick={() => run(async () => { await post('/api/projects/open', { id: p.id }); done(); })}>열기</button>
              <button className="ghost" title="목록에서만 지움 (폴더·파일은 그대로)" onClick={() => run(async () => { await post('/api/projects/forget', { id: p.id }); await load(); })}>✕</button>
            </div>
          ))}
        </div>
      )}

      {view === 'new' && (
        <div className="ph-new">
          <label className="field"><span>프로젝트 이름 *</span>
            <input autoFocus value={f.name} placeholder="예: 우리 카페 홍보 영상, 여행 브이로그 3편" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <div className="row2c">
            <label className="field"><span>브랜드 문구 — 카드·썸네일 큰 제목 {'{brand}'}</span>
              <input value={f.brand} placeholder={(f.name || '').toUpperCase() || 'PROJECT NAME'} onChange={(e) => setF({ ...f, brand: e.target.value })} /></label>
            <label className="field"><span>대표 키워드 — 강조 문구 {'{tagline}'}</span>
              <input value={f.tagline} placeholder="예: 탑뷰 공중 액션" onChange={(e) => setF({ ...f, tagline: e.target.value })} /></label>
          </div>
          <label className="field"><span>부제 형식 {'{subtitle}'} — {'{title}'}은 영상 제목</span>
            <input value={f.subtitleFormat} placeholder="{title} 플레이 영상" onChange={(e) => setF({ ...f, subtitleFormat: e.target.value })} /></label>
          <label className="field"><span>프로젝트 설명 — AI 어시스턴트·썸네일·업로드 추천이 참고 (무엇을, 누구에게, 어떤 톤으로)</span>
            <textarea rows={4} value={f.brief} placeholder="예: 1인 개발 중인 탑뷰 슈팅 게임의 포트폴리오용 플레이 영상. 개발자 소개 톤, 과장 없이 실제 구현된 것만."
              onChange={(e) => setF({ ...f, brief: e.target.value })} /></label>
          <div className="field"><span>저장 위치 (이 폴더 안에 프로젝트 폴더를 만듭니다)</span>
            <div className="row"><code className="grow path">{f.parent}</code><button onClick={() => setPickParent(!pickParent)}>{pickParent ? '닫기' : '변경'}</button></div></div>
          {pickParent && <FileBrowser mode="dir" start={f.parent} height={220} onPick={(d) => { setF({ ...f, parent: d }); setPickParent(false); }} />}
          <div className="row end">
            <button className="primary" disabled={busy || !f.name.trim()} onClick={() => run(async () => {
              await post('/api/projects', { ...f, brand: f.brand || f.name.toUpperCase() }); done();
            })}>{busy ? '만드는 중…' : '프로젝트 만들기'}</button>
          </div>
        </div>
      )}

      {view === 'open' && (
        <div className="ph-open">
          <p className="muted sm">script.json이 있는 프로젝트 폴더(◆)를 찾아 여세요. 다른 PC에서 복사해 온 프로젝트도 이렇게 엽니다.</p>
          <FileBrowser mode="project" height={300} onPick={(d) => run(async () => { await post('/api/projects/open', { dir: d }); done(); })} />
        </div>
      )}
    </div>
  );

  if (!asModal) return <div className="ph-screen">{body}</div>;
  return <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="modal wide ph-modal">{body}</div></div>;
}
