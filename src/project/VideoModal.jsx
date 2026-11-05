import { useEffect, useRef, useState } from 'react';
import { Modal } from '../Modals.jsx';
import FileBrowser from './FileBrowser.jsx';
import { fmt } from '../timeline.js';
import { baseName, packSegs } from '../../shared/clips.js';

const r1 = (v) => Math.round(v * 10) / 10;
const fmtS = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };
const rawUrl = (f) => `/api/rawvideo?path=${encodeURIComponent(f)}`;
const pad2 = (n) => String(n).padStart(2, '0');
const COLORS = ['#dcf884', '#7cc4ff', '#ffb066', '#c9b3d8', '#ff8fb1', '#7fe0c3', '#f2d16b', '#9aa6ff'];

// 촬영본 고르기: 프로젝트 소스의 영상 또는 PC 파일 (복사하지 않고 원래 위치 사용)
function ClipPicker({ sources, used, onPick, onCancel }) {
  const [tab, setTab] = useState(sources.length ? 'sources' : 'pc');
  return (
    <div className="clip-picker">
      <div className="row">
        <div className="seg-toggle sm" role="tablist" aria-label="촬영본 위치">
          <button role="tab" aria-selected={tab === 'sources'} className={tab === 'sources' ? 'on' : ''} disabled={!sources.length} onClick={() => setTab('sources')}>소스 영상 <small>{sources.length}</small></button>
          <button role="tab" aria-selected={tab === 'pc'} className={tab === 'pc' ? 'on' : ''} onClick={() => setTab('pc')}>PC에서 찾기</button>
        </div>
        <span className="grow" />
        {onCancel && <button className="ghost sm" onClick={onCancel}>취소</button>}
      </div>
      {tab === 'sources' ? (
        <ul className="clip-sources">
          {sources.map((s) => (
            <li key={s.id}>
              <button onClick={() => onPick(s.path)} title={s.path}>
                {s.frames?.length ? <img src={`/api/sources/${s.id}/frames/${Math.round(s.frames[0].t * 1000)}.jpg`} alt="" loading="lazy" /> : <span className="clip-noimg">▶</span>}
                <span><b>{s.title}</b><small>{fmtS(s.duration)}{used.has(s.path) ? ' · 사용 중' : ''}</small></span>
              </button>
            </li>
          ))}
        </ul>
      ) : <FileBrowser mode="video" height={300} onPick={onPick} />}
      <p className="muted sm">고른 촬영본은 전체 길이 구간으로 끝에 추가됩니다. 파일은 복사하지 않고 그 위치를 그대로 씁니다.</p>
    </div>
  );
}

// 지금 플레이어에 띄운 촬영본에서 어느 부분을 쓰는지 (클릭으로 이동)
function ClipMap({ rows, file, dur, cur, sel, color, onSeek }) {
  if (!dur) return null;
  return (
    <div className="clipmap" title="이 촬영본에서 쓰는 구간 · 클릭해서 이동"
      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onSeek(Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur))); }}>
      {rows.map((r, i) => r.file === file && (
        <span key={i} className={i === sel ? 'on' : ''} style={{ left: `${(r.s / dur) * 100}%`, width: `${Math.max(0.6, ((r.e - r.s) / dur) * 100)}%`, background: color }}>{i + 1}</span>
      ))}
      <i style={{ left: `${(cur / dur) * 100}%` }} />
    </div>
  );
}

// 편집 영상 설정: 구간(촬영본·사용할 부분·순서)과 구간별 챕터, 제목·날짜·엔딩 문구
// initialSrc: 새 영상을 이 촬영본으로 시작 / appendSrc: 기존 영상 끝에 이 촬영본을 구간으로 추가
export default function VideoModal({ vkey, meta, isNew, initialSrc, initialTitle, appendSrc, sources = [], onSave, onDelete, onClose, say }) {
  const [m, setM] = useState(() => ({ title: initialTitle || '', date: '', end: ['', ''], end_card: 4, ...(meta || {}) }));
  const [rows, setRows] = useState(() => (meta?.segs || []).map((g, i) => ({ s: g[0], e: g[1], file: g[2] || meta.src, chap: meta.chapters?.[i] || {} })));
  const [infos, setInfos] = useState({});
  const [curFile, setCurFile] = useState(() => meta?.segs?.[0]?.[2] || meta?.src || '');
  const [sel, setSel] = useState(0);
  const [picking, setPicking] = useState(isNew && !initialSrc);
  const [cur, setCur] = useState(0);
  const vref = useRef(null);
  const pendingSeek = useRef(null);
  const probing = useRef(new Set());
  const set = (p) => setM((x) => ({ ...x, ...p }));

  const files = [...new Set(rows.map((r) => r.file))];
  const colorOf = (f) => COLORS[Math.max(0, files.indexOf(f)) % COLORS.length];

  const probeFile = async (file) => {
    if (infos[file] || probing.current.has(file)) return infos[file] || {};
    probing.current.add(file);
    let info;
    try { const r = await fetch(`/api/probe?path=${encodeURIComponent(file)}`); const d = await r.json(); info = r.ok ? d : { error: d.error || r.statusText }; }
    catch { info = { error: '정보를 읽지 못했습니다' }; }
    setInfos((x) => ({ ...x, [file]: info }));
    return info;
  };
  useEffect(() => { files.forEach((f) => { if (!infos[f]) probeFile(f); }); }, [files.join('\n')]); // eslint-disable-line react-hooks/exhaustive-deps

  // 촬영본 추가 = 전체 길이 구간을 끝에 붙이고 그 촬영본을 플레이어에 띄움
  const addFile = async (file, count = rows.length) => {
    setPicking(false);
    const info = await probeFile(file);
    if (info.error) say?.(`영상 정보를 읽지 못했습니다: ${info.error}`, 'err');
    setRows((rs) => [...rs, { s: 0, e: r1(info.duration || 10), file, chap: {} }]);
    setSel(count); setCurFile(file); pendingSeek.current = 0;
    setM((x) => ({ ...x, title: x.title || baseName(file).replace(/\.[^.]+$/, '') }));
  };
  useEffect(() => { const f = initialSrc || appendSrc; if (f) addFile(f); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const seek = (t) => { if (vref.current) vref.current.currentTime = t; };
  const selectRow = (i) => {
    if (sel === i) return;
    setSel(i);
    const r = rows[i];
    if (r.file !== curFile) { setCurFile(r.file); pendingSeek.current = r.s; } else seek(r.s);
  };
  const setRow = (i, p) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const setChap = (i, p) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, chap: { ...r.chap, ...p } } : r)));
  const addSeg = () => {
    const a = r1(cur); const d = infos[curFile]?.duration;
    const at = rows.length ? sel + 1 : 0;
    setRows((rs) => [...rs.slice(0, at), { s: a, e: r1(Math.min(d || a + 10, a + 10)), file: curFile, chap: {} }, ...rs.slice(at)]);
    setSel(at);
  };
  const move = (i, d) => {
    const j = i + d; if (j < 0 || j >= rows.length) return;
    setRows((rs) => { const n = [...rs]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    setSel(j);
  };
  const del = (i) => { setRows((rs) => rs.filter((_, j) => j !== i)); setSel((s) => Math.max(0, Math.min(s > i ? s - 1 : s, rows.length - 2))); };

  const total = rows.reduce((n, r) => n + Math.max(0, r.e - r.s), 0);
  const problems = rows.map((r) => { const d = infos[r.file]?.duration; return r.e <= r.s ? '끝이 시작보다 앞' : d && r.e > d + 0.05 ? '촬영본 길이 초과' : ''; });
  const ok = rows.length && m.title.trim() && !problems.some(Boolean);
  const info = infos[curFile];
  const used = new Set(files);

  const save = () => {
    const chapters = rows.map((r, i) => ({ ...r.chap, num: r.chap.num || pad2(i + 1), kr: r.chap.kr || '', en: r.chap.en || '' }));
    onSave({ ...m, title: m.title.trim(), ...packSegs(rows), chapters: chapters.some((c) => c.kr.trim() || c.en.trim()) ? chapters : [] });
  };

  const footer = picking && !rows.length ? <><span className="grow" /><button onClick={onClose}>취소</button></> : (
    <>
      {!isNew && <button className="ghost danger" onClick={() => { if (window.confirm(`'${meta?.title}' 영상을 프로젝트에서 뺄까요? 대사도 함께 지워집니다 (원본 파일·음성 파일은 남음).`)) onDelete(); }}>프로젝트에서 빼기</button>}
      {!isNew && meta?.undo && <button className="ghost" title={`AI 구성 초안을 적용하기 전(${new Date(meta.undo.at).toLocaleString()})의 구간·챕터·제목으로 되돌립니다`}
        onClick={() => { if (window.confirm('AI 구성 초안을 적용하기 전 구성으로 되돌릴까요?')) onSave({ ...m, title: meta.undo.title, src: meta.undo.src, segs: meta.undo.segs, chapters: meta.undo.chapters || [], undo: null }); }}>↶ 초안 적용 전으로</button>}
      <span className="grow muted sm">{!isNew && '구간을 바꾸면 대사·카드 시각(편집본 기준)은 그대로라 화면과 어긋날 수 있습니다.'}</span>
      <button onClick={onClose}>취소</button>
      <button className="primary" disabled={!ok} onClick={save}>{isNew ? '영상 추가' : '저장'}</button>
    </>
  );

  return (
    <Modal title={isNew ? '영상 추가' : `영상 설정 · ${meta?.title || vkey}`} onClose={onClose} footer={footer} wide>
      {picking && !rows.length ? (
        <div className="vm-pick">
          <p className="muted sm">첫 촬영본을 고르세요. 이어서 다른 촬영본을 더해 한 편집 영상으로 이어 붙일 수 있습니다.</p>
          <ClipPicker sources={sources} used={used} onPick={(f) => addFile(f)} />
        </div>
      ) : (
        <div className="vm">
          <div className="vm-left">
            {picking ? <ClipPicker sources={sources} used={used} onPick={(f) => addFile(f)} onCancel={() => setPicking(false)} /> : (<>
              <video ref={vref} src={curFile ? rawUrl(curFile) : undefined} controls preload="metadata"
                onLoadedMetadata={(e) => { if (pendingSeek.current != null) { e.currentTarget.currentTime = pendingSeek.current; pendingSeek.current = null; } }}
                onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)} />
              <ClipMap rows={rows} file={curFile} dur={info?.duration} cur={cur} sel={sel} color={colorOf(curFile)} onSeek={seek} />
              <div className="vm-files" role="group" aria-label="촬영본">
                {files.map((f) => (
                  <button key={f} className={`chip ${f === curFile ? 'on' : ''}`} title={f} onClick={() => { setCurFile(f); setCur(0); }}>
                    <i style={{ background: colorOf(f) }} />{baseName(f)}
                  </button>
                ))}
                <button className="accent sm" onClick={() => setPicking(true)}>＋ 촬영본 추가</button>
              </div>
              <div className="muted sm">{!info ? '정보 읽는 중…' : info.error ? `⚠ ${info.error}` : `${baseName(curFile)} · ${fmtS(info.duration)} · ${info.width}×${info.height}${info.audio ? '' : ' · 소리 없음 (무음으로 채움)'}`}
                {info?.width && Math.abs(info.width / info.height - 16 / 9) > 0.02 && ' · 16:9가 아니면 레터박스로 맞춰집니다'}</div>
            </>)}
            <div className="vm-meta">
              <label className="field grow"><span>영상 제목 {'{title}'}</span><input value={m.title} onChange={(e) => set({ title: e.target.value })} /></label>
              <label className="field"><span>날짜 {'{date}'}</span><input value={m.date || ''} placeholder="2026.10.14" onChange={(e) => set({ date: e.target.value })} /></label>
            </div>
            <div className="vm-meta">
              <label className="field grow"><span>엔딩 윗줄</span><input value={m.end?.[0] || ''} placeholder="THANKS FOR WATCHING" onChange={(e) => set({ end: [e.target.value, m.end?.[1] || ''] })} /></label>
              <label className="field grow"><span>엔딩 아랫줄</span><input value={m.end?.[1] || ''} onChange={(e) => set({ end: [m.end?.[0] || '', e.target.value] })} /></label>
            </div>
          </div>
          <div className="vm-right">
            <div className="row"><h4 className="grow">편집 순서 <small className="muted">편집본 {fmt(total)} · 촬영본 {files.length}개</small></h4>
              <span className="muted sm">현재 {fmtS(cur)}</span>
              <button disabled={!curFile || picking} onClick={addSeg} title="플레이어에 띄운 촬영본의 현재 위치부터 10초 구간을 선택한 구간 다음에 추가">＋ 현재 위치부터 구간</button></div>
            <p className="muted sm">구간을 위에서부터 이어 붙입니다(사이는 짧게 페이드). 구간마다 다른 촬영본을 쓸 수 있고 ↑↓로 순서를 바꿉니다. 구간을 고르면 그 촬영본이 플레이어에 뜨고, ⇤/⇥로 현재 위치를 시작/끝으로 정합니다. 챕터 제목을 적은 구간은 시작 시 챕터 카드가 나옵니다.</p>
            <ol className="vm-segs">
              {rows.map((r, i) => {
                const here = r.file === curFile;
                return (
                  <li key={i} className={`${problems[i] ? 'bad' : ''} ${sel === i ? 'on' : ''}`} onClick={() => selectRow(i)}>
                    <div className="row">
                      <b className="vm-n">{i + 1}</b>
                      <span className="vm-file" title={r.file}><i style={{ background: colorOf(r.file) }} />{baseName(r.file)}</span>
                      <span className="grow" />
                      <span className="muted sm">{fmtS(r.e - r.s)}</span>
                      <button className="ghost sm" aria-label={`${i + 1}번 구간 위로`} disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(i, -1); }}>↑</button>
                      <button className="ghost sm" aria-label={`${i + 1}번 구간 아래로`} disabled={i === rows.length - 1} onClick={(e) => { e.stopPropagation(); move(i, 1); }}>↓</button>
                      <button className="ghost sm" aria-label={`${i + 1}번 구간 삭제`} disabled={rows.length < 2} onClick={(e) => { e.stopPropagation(); del(i); }}>✕</button>
                    </div>
                    <div className="row">
                      <button className="ghost sm" title="이 구간 시작으로 이동" onClick={(e) => { e.stopPropagation(); if (here) seek(r.s); else { setSel(i); setCurFile(r.file); pendingSeek.current = r.s; } }}>▶</button>
                      <input type="number" step="0.1" aria-label="시작(초)" value={r.s} onChange={(e) => setRow(i, { s: r1(+e.target.value) })} />
                      <button className="sm" title="현재 위치를 시작으로" disabled={!here} onClick={(e) => { e.stopPropagation(); setRow(i, { s: r1(cur) }); }}>⇤</button>
                      <span>~</span>
                      <input type="number" step="0.1" aria-label="끝(초)" value={r.e} onChange={(e) => setRow(i, { e: r1(+e.target.value) })} />
                      <button className="sm" title="현재 위치를 끝으로" disabled={!here} onClick={(e) => { e.stopPropagation(); setRow(i, { e: r1(cur) }); }}>⇥</button>
                    </div>
                    <div className="row">
                      <input className="vm-cn" value={r.chap.num ?? pad2(i + 1)} title="챕터 번호 {num}" onChange={(e) => setChap(i, { num: e.target.value })} />
                      <input className="grow" value={r.chap.kr || ''} placeholder="챕터 제목 (비우면 챕터 카드 없음)" onChange={(e) => setChap(i, { kr: e.target.value })} />
                      <input className="grow" value={r.chap.en || ''} placeholder="보조 문구 {en}" onChange={(e) => setChap(i, { en: e.target.value })} />
                    </div>
                    {problems[i] && <div className="warn sm">⚠ {problems[i]}</div>}
                  </li>
                );
              })}
            </ol>
            <label className="field"><span>엔딩 카드 길이(초)</span>
              <input type="number" step="0.5" min="0" value={m.end_card ?? 4} style={{ width: 90 }} onChange={(e) => set({ end_card: +e.target.value })} /></label>
          </div>
        </div>
      )}
    </Modal>
  );
}
