import { useEffect, useRef, useState } from 'react';
import { Modal } from '../Modals.jsx';
import FileBrowser from './FileBrowser.jsx';
import { fmt } from '../timeline.js';

const r1 = (v) => Math.round(v * 10) / 10;
const fmtS = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };

// 영상 추가·설정: 원본 파일, 제목·날짜, 사용할 구간(트림)과 구간별 챕터, 엔딩 문구
export default function VideoModal({ vkey, meta, isNew, onSave, onDelete, onClose, say }) {
  const [step, setStep] = useState(isNew ? 'pick' : 'edit');
  const [m, setM] = useState(() => ({ title: '', date: '', src: '', segs: [], chapters: [], end: ['', ''], end_card: 4, ...(meta || {}) }));
  const [info, setInfo] = useState(null);
  const [cur, setCur] = useState(0);
  const vref = useRef(null);
  const set = (p) => setM((x) => ({ ...x, ...p }));

  useEffect(() => {
    if (!m.src) return;
    fetch(`/api/probe?path=${encodeURIComponent(m.src)}`).then((r) => r.json()).then((d) => setInfo(d)).catch(() => setInfo({ error: '정보를 읽지 못했습니다' }));
  }, [m.src]);

  const pick = async (file) => {
    const r = await fetch(`/api/probe?path=${encodeURIComponent(file)}`); const d = await r.json();
    if (!r.ok || d.error) { say?.(`영상 정보를 읽지 못했습니다: ${d.error || r.statusText}`, 'err'); }
    const name = file.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    setM((x) => ({ ...x, src: file, title: x.title || name, segs: x.segs.length ? x.segs : d.duration ? [[0, r1(d.duration)]] : [] }));
    setInfo(d); setStep('edit');
  };

  const dur = info?.duration || 0;
  const segs = m.segs || [];
  const chap = (i) => m.chapters?.[i] || {};
  const setSeg = (i, k, v) => set({ segs: segs.map((s, j) => (j === i ? (k === 0 ? [r1(v), s[1]] : [s[0], r1(v)]) : s)) });
  const setChap = (i, p) => { const c = [...(m.chapters || [])]; while (c.length <= i) c.push({ num: String(c.length + 1).padStart(2, '0'), kr: '', en: '' }); c[i] = { ...c[i], ...p }; set({ chapters: c }); };
  const addSeg = () => { const a = r1(cur); set({ segs: [...segs, [a, r1(Math.min(dur || a + 10, a + 10))]].sort((x, y) => x[0] - y[0]) }); };
  const delSeg = (i) => set({ segs: segs.filter((_, j) => j !== i), chapters: (m.chapters || []).filter((_, j) => j !== i) });
  const seek = (t) => { if (vref.current) vref.current.currentTime = t; };
  const total = segs.reduce((n, [a, b]) => n + Math.max(0, b - a), 0);
  const problems = segs.map(([a, b], i) => (b <= a ? '끝이 시작보다 앞' : dur && b > dur + 0.05 ? '영상 길이 초과' : i > 0 && a < segs[i - 1][1] ? '앞 구간과 겹침' : ''));
  const ok = m.src && m.title.trim() && segs.length && !problems.some(Boolean);

  const save = () => {
    const chapters = (m.chapters || []).slice(0, segs.length).map((c, i) => ({ num: c.num || String(i + 1).padStart(2, '0'), kr: c.kr || '', en: c.en || '' }));
    onSave({ ...m, title: m.title.trim(), chapters: chapters.some((c) => c.kr.trim() || c.en.trim()) ? chapters : [] });
  };

  const footer = step === 'pick' ? <><span className="grow" /><button onClick={onClose}>취소</button></> : (
    <>
      {!isNew && <button className="ghost danger" onClick={() => { if (window.confirm(`'${meta?.title}' 영상을 프로젝트에서 뺄까요? 대사도 함께 지워집니다 (원본 파일·음성 파일은 남음).`)) onDelete(); }}>프로젝트에서 빼기</button>}
      <span className="grow muted sm">{!isNew && '구간을 바꾸면 대사·카드 시각(편집본 기준)은 그대로라 화면과 어긋날 수 있습니다.'}</span>
      <button onClick={onClose}>취소</button>
      <button className="primary" disabled={!ok} onClick={save}>{isNew ? '영상 추가' : '저장'}</button>
    </>
  );

  return (
    <Modal title={isNew ? '영상 추가' : `영상 설정 · ${meta?.title || vkey}`} onClose={onClose} footer={footer} wide>
      {step === 'pick' ? (
        <div className="vm-pick">
          <p className="muted sm">PC에 있는 영상 파일을 고르세요. 파일은 복사하지 않고 그 위치를 그대로 사용합니다.</p>
          <FileBrowser mode="video" height={380} onPick={pick} />
        </div>
      ) : (
        <div className="vm">
          <div className="vm-left">
            <video ref={vref} src={`/api/rawvideo?path=${encodeURIComponent(m.src)}`} controls preload="metadata"
              onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)} />
            <div className="vm-src">
              <code title={m.src}>{m.src}</code>
              <button className="ghost" onClick={() => setStep('pick')}>파일 변경</button>
            </div>
            <div className="muted sm">{info?.error ? `⚠ ${info.error}` : info ? `원본 ${fmtS(dur)} · ${info.width}×${info.height}${info.audio ? '' : ' · 소리 없음'}` : '정보 읽는 중…'}
              {info?.width && info.width / info.height < 1.7 && ' · 16:9가 아니면 레터박스로 맞춰집니다'}</div>
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
            <div className="row"><h4 className="grow">사용할 구간 <small className="muted">편집본 {fmt(total)}</small></h4>
              <span className="muted sm">현재 {fmtS(cur)}</span>
              <button onClick={addSeg}>＋ 현재 위치부터 구간</button></div>
            <p className="muted sm">원본에서 남길 부분만 고릅니다(앞뒤 자르기·중간 빼기). 구간 사이는 짧게 페이드로 이어집니다. 챕터 제목을 적은 구간은 시작 시 챕터 카드가 나옵니다.</p>
            <ol className="vm-segs">
              {segs.map(([a, b], i) => (
                <li key={i} className={problems[i] ? 'bad' : ''}>
                  <div className="row">
                    <b className="vm-n">{i + 1}</b>
                    <button className="ghost sm" title="이 구간 시작으로 이동" onClick={() => seek(a)}>▶</button>
                    <input type="number" step="0.1" value={a} onChange={(e) => setSeg(i, 0, +e.target.value)} />
                    <button className="sm" title="현재 위치를 시작으로" onClick={() => setSeg(i, 0, cur)}>⇤</button>
                    <span>~</span>
                    <input type="number" step="0.1" value={b} onChange={(e) => setSeg(i, 1, +e.target.value)} />
                    <button className="sm" title="현재 위치를 끝으로" onClick={() => setSeg(i, 1, cur)}>⇥</button>
                    <span className="muted sm">{fmtS(b - a)}</span>
                    <span className="grow" />
                    <button className="ghost" disabled={segs.length < 2} onClick={() => delSeg(i)}>✕</button>
                  </div>
                  <div className="row">
                    <input className="vm-cn" value={chap(i).num ?? String(i + 1).padStart(2, '0')} title="챕터 번호 {num}" onChange={(e) => setChap(i, { num: e.target.value })} />
                    <input className="grow" value={chap(i).kr || ''} placeholder="챕터 제목 (비우면 챕터 카드 없음)" onChange={(e) => setChap(i, { kr: e.target.value })} />
                    <input className="grow" value={chap(i).en || ''} placeholder="보조 문구 {en}" onChange={(e) => setChap(i, { en: e.target.value })} />
                  </div>
                  {problems[i] && <div className="warn sm">⚠ {problems[i]}</div>}
                </li>
              ))}
            </ol>
            <label className="field"><span>엔딩 카드 길이(초)</span>
              <input type="number" step="0.5" min="0" value={m.end_card ?? 4} style={{ width: 90 }} onChange={(e) => set({ end_card: +e.target.value })} /></label>
          </div>
        </div>
      )}
    </Modal>
  );
}
