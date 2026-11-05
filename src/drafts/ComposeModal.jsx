import { useRef, useState } from 'react';
import { Modal } from '../Modals.jsx';
import { PROVIDERS } from '../Agent.jsx';
import { fmt } from '../timeline.js';
import { packSegs } from '../../shared/clips.js';

const ls = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const LENGTHS = [['0', '자동'], ['30', '30초'], ['60', '1분'], ['90', '1분 30초'], ['120', '2분'], ['180', '3분'], ['300', '5분'], ['600', '10분']];
const r1 = (v) => Math.round(v * 10) / 10;
const pad2 = (n) => String(n).padStart(2, '0');

// AI 구성 초안: 켜진 소스(장면·받아쓰기·대표 장면·메모)를 근거로 촬영본 구간·순서·챕터를 제안받고,
// 구간마다 넣을지·범위·순서·챕터를 사람이 정한 뒤 편집 영상으로 적용 (기존 영상은 이전 구성을 남겨 되돌릴 수 있음)
export default function ComposeModal({ projectId, ai, aiKey, onOpenSettings, sources = [], videos = [], initialKey = '', usage, onApply, onClose, say }) {
  const vids = sources.filter((s) => s.kind === 'video' && s.enabled);
  const [target, setTarget] = useState(initialKey);
  const [len, setLen] = useState(() => ls.get('zk.compose.len', '60'));
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState(0);
  const vref = useRef(null);
  const play = useRef(null); // { s, e } 재생 중인 구간

  const generate = async () => {
    if (!aiKey) { say(`설정에서 ${PROVIDERS[ai.provider]?.label || 'AI'} API 키를 등록하세요`, 'err'); onOpenSettings(); return; }
    ls.set('zk.compose.len', len);
    setBusy(true);
    try {
      const r = await fetch('/api/compose', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ai-key': aiKey, 'x-project-id': projectId },
        body: JSON.stringify({ provider: ai.provider, model: ai.model, brief, target: +len || 0, key: target || undefined }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      setDraft({ ...j, rows: j.rows.map((x, i) => ({ ...x, on: true, key: i })) });
      setTitle(j.title || videos.find((v) => v.key === target)?.title || '');
      setSel(0);
    } catch (e) { say(`구성 초안 실패: ${e.message}`, 'err'); } finally { setBusy(false); }
  };

  const rows = draft?.rows || [];
  const setRows = (fn) => setDraft((d) => ({ ...d, rows: fn(d.rows) }));
  const setRow = (i, p) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i, d) => {
    const j = i + d; if (j < 0 || j >= rows.length) return;
    setRows((rs) => { const n = [...rs]; [n[i], n[j]] = [n[j], n[i]]; return n; }); setSel(j);
  };
  const cur = rows[sel];
  const bad = (r) => !(r.e - r.s >= 0.5) || r.s < 0 || r.e > r.duration + 0.05;
  const on = rows.filter((r) => r.on);
  const total = on.reduce((n, r) => n + Math.max(0, r.e - r.s), 0);
  const ok = on.length > 0 && !on.some(bad) && title.trim();

  // 구간 선택 = 플레이어를 그 구간 시작으로 (다른 촬영본이면 불러온 뒤 이동)
  const select = (i) => {
    if (sel === i) return;
    const r = rows[i]; const v = vref.current; play.current = null;
    setSel(i);
    if (v && v.dataset.src === r.sourceId) { v.pause(); v.currentTime = r.s; }
  };
  // 선택한 구간만 재생 (끝에서 멈춤)
  const preview = (i) => {
    setSel(i); const r = rows[i]; play.current = { s: r.s, e: r.e, id: r.sourceId };
    const v = vref.current; if (!v) return;
    if (v.dataset.src !== r.sourceId) return; // 다른 소스면 로드 후 onLoadedMetadata에서 재생
    v.currentTime = r.s; v.play().catch(() => {}); watch();
  };
  // timeupdate는 0.25초 간격이라 끝을 넘기므로 매 프레임 확인해 구간 끝에서 정확히 멈춤
  const watch = () => {
    const tick = () => {
      const v = vref.current; const p = play.current;
      if (!v || !p) return;
      if (v.currentTime >= p.e - 0.02) { v.pause(); v.currentTime = p.e; play.current = null; return; }
      if (!v.paused) requestAnimationFrame(tick); else play.current = null;
    };
    requestAnimationFrame(tick);
  };

  const apply = () => {
    let ch = 0;
    const chapters = on.map((r) => (r.chapter.trim() ? { num: pad2(++ch), kr: r.chapter.trim(), en: '' } : { num: '', kr: '', en: '' }));
    onApply({ title: title.trim(), ...packSegs(on.map((r) => ({ s: r.s, e: r.e, file: r.file }))), chapters: ch ? chapters : [] }, target || null);
  };

  const targetTitle = videos.find((v) => v.key === target)?.title;
  const footer = !draft ? (
    <><span className="grow muted sm">{PROVIDERS[ai.provider]?.label} <code>{ai.model}</code> · 소스 {usage.count}개(텍스트 {usage.text.toLocaleString()}자 · 이미지 {usage.images}장)를 함께 보냅니다</span>
      <button onClick={onClose}>취소</button>
      <button className="primary" disabled={busy || !vids.length} onClick={generate}>{busy ? '초안 만드는 중…' : '✦ 초안 만들기'}</button></>
  ) : (
    <><button className="ghost" disabled={busy} onClick={() => setDraft(null)}>← 요청 고치기</button>
      <button disabled={busy} onClick={generate}>{busy ? '다시 만드는 중…' : '다시 만들기'}</button>
      <span className="grow muted sm">{on.length}/{rows.length}구간 · {fmt(total)}{target ? ` · ‘${targetTitle}’ 구성을 바꿈(되돌리기 가능)` : ' · 새 편집 영상'}</span>
      <button onClick={onClose}>취소</button>
      <button className="primary" disabled={!ok} onClick={apply}>적용</button></>
  );

  return (
    <Modal title="✦ AI 구성 초안" onClose={() => { if (!draft || window.confirm('구성 초안을 버리고 닫을까요?')) onClose(); }} footer={footer} wide>
      {!draft ? (
        <div className="cmp-setup">
          <p className="hint">AI 컨텍스트에 켜진 소스(장면 목록·받아쓰기·대표 장면·메모)를 근거로 어떤 촬영본의 어느 구간을 어떤 순서로 쓸지 제안받습니다. 결과는 구간마다 넣을지·범위·순서·챕터를 고친 뒤 적용합니다.</p>
          <div className="row2c">
            <label className="field"><span>적용 대상</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">새 편집 영상</option>
                {videos.map((v) => <option key={v.key} value={v.key}>‘{v.title}’ 다시 구성</option>)}
              </select></label>
            <label className="field"><span>목표 길이</span>
              <select value={len} onChange={(e) => setLen(e.target.value)}>{LENGTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          </div>
          <label className="field"><span>요청 (선택)</span>
            <textarea rows={3} value={brief} placeholder="예: 보스전 위주 1분 하이라이트 / 신규 무기 소개 → 실전 사용 → 마무리 순서 / 메뉴 화면은 빼줘" onChange={(e) => setBrief(e.target.value)} /></label>
          <div className="cmp-cands">
            <b>잘라 쓸 수 있는 촬영본 {vids.length}개</b> <small className="muted">— 소스 패널에서 체크한 영상 소스</small>
            {vids.length ? (
              <ul>
                {vids.map((v) => (
                  <li key={v.id}>
                    <img src={v.frames?.length ? `/api/sources/${v.id}/frames/${Math.round(v.frames[0].t * 1000)}.jpg` : ''} alt="" />
                    <span><b>{v.title}</b><small>{fmt(v.duration)} · 장면 {v.scenes?.status === 'done' ? `${v.scenes.cuts.length + 1}개` : '분석 안 함'} · 받아쓰기 {v.transcript?.status === 'done' ? `${v.transcript.count}문장` : '없음'}</small></span>
                  </li>
                ))}
              </ul>
            ) : <div className="callout warn">AI 컨텍스트에 켜진 영상 소스가 없습니다. 소스 패널에서 쓸 촬영본을 체크하세요.</div>}
            {vids.some((v) => v.scenes?.status !== 'done' || (v.transcript?.status !== 'done' && v.audio !== false)) && (
              <p className="hint">장면 분석·받아쓰기를 한 촬영본은 장면 경계와 말소리를 근거로 더 정확하게 자릅니다 (소스 패널 → 영상 분석).</p>
            )}
          </div>
        </div>
      ) : (
        <div className="cmp-review">
          <div className="cmp-left">
            {cur && (
              <video ref={vref} className="cmp-video" src={`/api/sources/${cur.sourceId}/file`} data-src={cur.sourceId} controls preload="metadata"
                onLoadedMetadata={(e) => { const p = play.current; if (p && p.id === cur.sourceId) { e.currentTarget.currentTime = p.s; e.currentTarget.play().then(watch).catch(() => {}); } else e.currentTarget.currentTime = cur.s; }} />
            )}
            <label className="field"><span>편집 영상 제목</span><input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></label>
            {draft.summary && <p className="cmp-summary">{draft.summary}</p>}
            {draft.notes && <div className="callout warn">{draft.notes}</div>}
            {draft.skipped?.length > 0 && <p className="hint">AI가 제안했지만 뺀 구간: {draft.skipped.join(' / ')}</p>}
          </div>
          <ol className="cmp-rows">
            {rows.map((r, i) => (
              <li key={r.key} className={`${r.on ? '' : 'off'} ${sel === i ? 'on' : ''} ${bad(r) ? 'bad' : ''}`} onClick={() => select(i)}>
                <input type="checkbox" checked={r.on} aria-label={`${i + 1}번 구간 적용`} onClick={(e) => e.stopPropagation()} onChange={(e) => setRow(i, { on: e.target.checked })} />
                <button className="cmp-thumb" title="이 구간만 재생" onClick={(e) => { e.stopPropagation(); preview(i); }}>
                  <img src={`/api/sources/${r.sourceId}/still?t=${r.s}&w=192`} alt="" loading="lazy" /><i>▶</i>
                </button>
                <div className="cmp-main">
                  <div className="row">
                    <b className="vm-n">{i + 1}</b>
                    <span className="cmp-src" title={r.file}>[소스 {r.n}] {r.title}</span>
                    <span className="grow" />
                    <span className="muted sm">{fmt(Math.max(0, r.e - r.s))}</span>
                    <button className="ghost sm" aria-label="위로" disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(i, -1); }}>↑</button>
                    <button className="ghost sm" aria-label="아래로" disabled={i === rows.length - 1} onClick={(e) => { e.stopPropagation(); move(i, 1); }}>↓</button>
                  </div>
                  <div className="row">
                    <input type="number" step="0.1" aria-label="시작(초)" value={r.s} onChange={(e) => setRow(i, { s: r1(+e.target.value) })} />
                    <span>~</span>
                    <input type="number" step="0.1" aria-label="끝(초)" value={r.e} onChange={(e) => setRow(i, { e: r1(+e.target.value) })} />
                    <input className="grow" value={r.chapter} placeholder="챕터 제목 (없으면 비움)" maxLength={40} onChange={(e) => setRow(i, { chapter: e.target.value })} />
                  </div>
                  {r.reason && <small className="cmp-reason">{r.reason}</small>}
                  {bad(r) && <small className="warn">⚠ 구간 범위를 확인하세요 (0.5초 이상, 영상 길이 {fmt(r.duration)} 이내)</small>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  );
}
