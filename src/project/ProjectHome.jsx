import { useEffect, useRef, useState } from 'react';
import { APP_NAME } from '../../shared/app.js';
import { Modal } from '../Modals.jsx';
import FileBrowser from './FileBrowser.jsx';

const j = async (url, opt) => {
  const r = await fetch(url, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
};
const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export default function ProjectHome({ initialView = 'list', onClose, onOpened, beforeOpen }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState(initialView);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [pickParent, setPickParent] = useState(false);
  const pending = useRef(false);

  const load = async () => {
    const info = await j('/api/projects');
    setData(info);
    setParent((p) => p || info.defaultParent);
  };
  useEffect(() => { load().catch((e) => setErr(e.message)); }, []);
  const run = async (fn) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr(e.message); }
    finally { pending.current = false; setBusy(false); }
  };
  const activate = (endpoint, payload) => run(async () => {
    if (beforeOpen && !await beforeOpen()) return;
    onOpened(await post(endpoint, payload));
  });

  const body = (
    <div className="ph">
      {!onClose && <div className="ph-head">
        <h1>{APP_NAME}</h1>
        <p className="muted">최근 프로젝트를 열어 이어서 작업하거나, 영상과 자료를 모을 새 작업 공간을 만드세요.</p>
      </div>}
      <nav className="ph-tabs" aria-label="프로젝트 작업">
        {[['list', '최근 프로젝트'], ['new', '＋ 새 프로젝트'], ['open', '폴더에서 열기']].map(([key, label]) => (
          <button key={key} className={view === key ? 'accent' : ''} aria-pressed={view === key} disabled={busy}
            onClick={() => { setView(key); setErr(''); }}>{label}</button>
        ))}
      </nav>
      {err && <div className="callout err" role="alert">{err}</div>}

      {view === 'list' && (
        <div className="ph-list">
          {!data && !err && <p className="muted">프로젝트 목록을 불러오는 중…</p>}
          {data?.projects.length === 0 && <div className="ph-empty">
            <b>최근 프로젝트가 없습니다</b>
            <p className="muted">새 프로젝트를 만들거나 기존 프로젝트 폴더를 여세요.</p>
          </div>}
          {data?.projects.map((p, index) => {
            const current = !!onClose && data.current?.id === p.id;
            return (
              <div key={p.id} className={`ph-item ${current ? 'cur' : ''} ${p.missing ? 'missing' : ''}`}>
                <div className="grow">
                  <b>{p.name}</b>{current && <span className="tag">편집 중</span>}
                  {!onClose && index === 0 && !p.missing && <span className="tag">마지막 작업</span>}
                  {p.missing && <span className="tag err">폴더 없음</span>}
                  <small title={p.dir}>{p.dir}</small>
                </div>
                {current ? <button disabled={busy} onClick={onClose}>계속 편집</button> : <>
                  <button disabled={busy || p.missing} onClick={() => activate('/api/projects/open', { id: p.id })}>열기</button>
                  <button className="ghost" disabled={busy} aria-label={`${p.name}을 최근 목록에서 제거`} title="최근 목록에서 제거"
                    onClick={() => run(async () => { await post('/api/projects/forget', { id: p.id }); await load(); })}>✕</button>
                </>}
              </div>
            );
          })}
        </div>
      )}

      {view === 'new' && (
        <form className="ph-new" onSubmit={(e) => { e.preventDefault(); if (name.trim() && parent) activate('/api/projects', { name: name.trim(), parent }); }}>
          <label className="field"><span>프로젝트 이름</span>
            <input autoFocus required value={name} placeholder="예: 인터뷰 시리즈, 여행 기록" onChange={(e) => setName(e.target.value)} /></label>
          <div className="field"><span>저장 위치</span>
            <div className="row"><code className="grow path">{parent || '불러오는 중…'}</code><button type="button" disabled={busy}
              onClick={() => setPickParent(!pickParent)}>{pickParent ? '닫기' : '변경'}</button></div>
          </div>
          {pickParent && <FileBrowser mode="dir" start={parent} height={220} onPick={(dir) => { setParent(dir); setPickParent(false); }} />}
          <p className="hint">선택한 위치에 프로젝트 폴더를 만듭니다. 카드 문구와 출력 위치는 편집기의 프로젝트 설정에서 지정할 수 있습니다.</p>
          <div className="row end">
            <button className="primary" disabled={busy || !name.trim() || !parent}>{busy ? '처리 중…' : '프로젝트 만들기'}</button>
          </div>
        </form>
      )}

      {view === 'open' && (
        <div className="ph-open">
          <p className="muted sm">프로젝트 파일(script.json)이 있는 폴더를 선택하세요.</p>
          <FileBrowser mode="project" height={300} onPick={(dir) => activate('/api/projects/open', { dir })} />
        </div>
      )}
    </div>
  );

  return onClose
    ? <Modal title="프로젝트" wide onClose={() => { if (!pending.current) onClose(); }}>{body}</Modal>
    : <main className="ph-screen">{body}</main>;
}
