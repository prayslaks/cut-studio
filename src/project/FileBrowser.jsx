import { useEffect, useState } from 'react';

const mb = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`);

// 서버(PC) 파일 시스템 탐색 — 브라우저 파일 선택창은 실제 경로를 알려주지 않으므로 서버가 목록을 줌
// mode: 'video' (영상 파일 선택) | 'dir' (폴더 선택) | 'project' (script.json이 있는 폴더 선택)
export default function FileBrowser({ mode = 'video', start = '', onPick, height = 320 }) {
  const [dir, setDir] = useState(start || localStorage.getItem(`zk.fb.${mode}`) || '');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => {
    let alive = true; setErr('');
    fetch(`/api/fs/list?mode=${mode === 'video' ? 'video' : 'dir'}&dir=${encodeURIComponent(dir)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j; })
      .then((j) => { if (alive) { setData(j); setTyped(j.dir); try { if (j.dir) localStorage.setItem(`zk.fb.${mode}`, j.dir); } catch {} } })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [dir, mode]);

  return (
    <div className="fb">
      <div className="fb-bar">
        <button type="button" className="ghost" disabled={data?.parent == null} title="상위 폴더" onClick={() => setDir(data?.parent || '')}>↑</button>
        <button type="button" className="ghost" title="드라이브·바로가기" onClick={() => setDir('')}>⌂</button>
        <input value={typed} placeholder="경로를 붙여넣고 Enter" onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setDir(typed.trim().replace(/^"|"$/g, '')); } }} />
        {mode !== 'video' && data?.dir && <button type="button" className="primary" disabled={mode === 'project' && !data.isProject} onClick={() => onPick(data.dir)}>{mode === 'project' ? '이 프로젝트 열기' : '이 폴더 선택'}</button>}
      </div>
      {err && <div className="fb-err">{err}</div>}
      <ul className="fb-list" style={{ height }}>
        {data?.entries.map((e) => (
          <li key={e.path} className={`${e.dir ? 'd' : 'f'} ${e.project ? 'proj' : ''}`}
            onClick={() => (e.dir ? setDir(e.path) : onPick(e.path))}
            onDoubleClick={() => { if (e.dir && mode === 'project' && e.project) onPick(e.path); }}>
            <i>{e.dir ? (e.project ? '◆' : e.quick ? '★' : '▸') : '▶'}</i><span>{e.name}</span>
            {e.project && <small className="tag">프로젝트</small>}
            {!e.dir && <small className="muted">{mb(e.size)}</small>}
          </li>
        ))}
        {data && !data.entries.length && <li className="muted empty">{mode === 'video' ? '영상 파일(mp4·mov·mkv·webm)이 없습니다' : '하위 폴더가 없습니다'}</li>}
      </ul>
    </div>
  );
}
