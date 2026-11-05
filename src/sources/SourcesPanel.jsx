import { useEffect, useRef, useState } from 'react';
import { Modal } from '../Modals.jsx';
import FileBrowser from '../project/FileBrowser.jsx';
import SourceDetail from './SourceDetail.jsx';
import ContextPreview from './ContextPreview.jsx';
import UsageMeter from './UsageMeter.jsx';
import { RUNNING } from './useSources.js';
import {
  MAX_SOURCES, MAX_SOURCE_TEXT, TEXT_EXT, VIDEO_EXT, fmtTime, fmtBytes,
} from '../../shared/sources.js';

const ACCEPT = ['video/*', 'image/*', ...TEXT_EXT, ...VIDEO_EXT].join(',');
const KIND = { text: '텍스트', image: '이미지', video: '영상' };

export const thumbOf = (s) => (s.kind === 'image' ? `/api/sources/${s.id}/file`
  : s.kind === 'video' && s.frames?.length ? `/api/sources/${s.id}/frames/${Math.round(s.frames[0].t * 1000)}.jpg` : null);

export function SourceThumb({ s }) {
  const url = thumbOf(s);
  return <span className={`src-thumb ${s.kind}`} aria-hidden="true">{url ? <img src={url} alt="" loading="lazy" /> : s.kind === 'text' ? 'T' : '▶'}</span>;
}

const firstLine = (t) => (t.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) || '').slice(0, 40);

function TextDraft({ onSave, onCancel }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await onSave({ title: title.trim() || firstLine(text), text, note }); onCancel(); }
    catch (er) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <form className="src-form" onSubmit={submit}>
      <input value={title} maxLength={100} placeholder="제목 (비우면 첫 줄)" onChange={(e) => setTitle(e.target.value)} disabled={busy} />
      <textarea autoFocus rows={7} value={text} maxLength={MAX_SOURCE_TEXT} disabled={busy}
        placeholder="기획 메모, 대본 초안, 용어집, 사실 확인 자료 등을 붙여넣으세요." onChange={(e) => setText(e.target.value)} />
      <input value={note} maxLength={1000} placeholder="AI에게 알려줄 메모 (선택: 이 자료의 용도)" onChange={(e) => setNote(e.target.value)} disabled={busy} />
      {err && <div className="callout err">{err}</div>}
      <div className="row">
        <small className="muted grow">{text.length.toLocaleString()} / {MAX_SOURCE_TEXT.toLocaleString()}자</small>
        <button type="button" onClick={onCancel} disabled={busy}>취소</button>
        <button className="primary" disabled={busy || !text.trim()}>{busy ? '추가 중…' : '소스 추가'}</button>
      </div>
    </form>
  );
}

function Jobs({ jobs, onDismiss }) {
  if (!jobs.length) return null;
  const label = (j) => ({ wait: '대기', upload: j.kind === 'video' ? `복사 ${Math.round(j.progress * 100)}%` : '추가 중', process: j.kind === 'video' ? '프레임 추출 중' : '처리 중', done: '추가됨', err: '실패' }[j.status]);
  return (
    <ul className="src-jobs" aria-live="polite">
      {jobs.map((j) => (
        <li key={j.id} className={j.status}>
          <span className="src-job-name" title={j.name}>{j.name}</span>
          {j.size > 0 && <small className="muted">{fmtBytes(j.size)}</small>}
          <small className="src-job-st">{label(j)}</small>
          {(j.status === 'err' || j.status === 'done') && <button className="ghost sm" aria-label="닫기" onClick={() => onDismiss(j.id)}>✕</button>}
          {j.status === 'upload' && j.kind === 'video' && <i className="src-job-bar"><em style={{ width: `${j.progress * 100}%` }} /></i>}
          {(j.error || j.notice) && <small className={`src-job-msg ${j.error ? 'err' : 'warn'}`}>{j.error || j.notice}</small>}
        </li>
      ))}
    </ul>
  );
}

function LinkVideos({ onLink, onClose, jobs }) {
  const [picked, setPicked] = useState([]);
  return (
    <Modal title="PC 영상 연결" onClose={onClose} wide footer={<><span className="muted grow">{picked.length ? `${picked.length}개 연결 요청` : ''}</span><button className="primary" onClick={onClose}>닫기</button></>}>
      <p className="hint">영상을 복사하지 않고 원래 위치를 그대로 씁니다. 큰 촬영본에 적합하며, 파일을 옮기면 다시 연결해야 합니다. 여러 개를 차례로 고를 수 있습니다.</p>
      <FileBrowser mode="video" height={360} onPick={(f) => { if (picked.includes(f)) return; setPicked((x) => [...x, f]); onLink(f); }} />
      {picked.length > 0 && <Jobs jobs={jobs.filter((j) => j.linkPath && picked.includes(j.linkPath))} onDismiss={() => {}} />}
    </Modal>
  );
}

const pct = (a) => (a?.progress ? ` ${Math.round(a.progress * 100)}%` : '');
function AnalysisBadges({ s }) {
  const b = [];
  if (RUNNING.includes(s.scenes?.status)) b.push(`장면 분석 중${pct(s.scenes)}`);
  else if (s.scenes?.status === 'done') b.push(`장면 ${s.scenes.cuts.length + 1}`);
  if (RUNNING.includes(s.transcript?.status)) b.push(`받아쓰기 중${pct(s.transcript)}`);
  else if (s.transcript?.status === 'done') b.push(`받아쓰기 ${s.transcript.count}문장`);
  if (s.scenes?.status === 'error') b.push('장면 분석 실패');
  if (s.transcript?.status === 'error' && s.audio !== false) b.push('받아쓰기 실패');
  if (s.audio === false) b.push('소리 없음');
  return b.length ? <> · {b.join(' · ')}</> : null;
}

// 영상 소스를 한 번에 분석: 장면 전환(무료) / 받아쓰기(ElevenLabs 사용량 발생)
function BulkAnalysis({ items, S, elKey, onNeedKey, onCompose, say }) {
  const [busy, setBusy] = useState(false);
  const vids = items.filter((s) => s.kind === 'video');
  if (!vids.length) return null;
  const idle = (a) => !a?.status || a.status === 'error';
  const needScenes = vids.filter((s) => idle(s.scenes));
  const needStt = vids.filter((s) => idle(s.transcript) && s.audio !== false);
  const minutes = Math.max(1, Math.ceil(needStt.reduce((n, s) => n + s.duration, 0) / 60));
  const running = vids.filter((s) => RUNNING.includes(s.scenes?.status) || RUNNING.includes(s.transcript?.status)).length;
  const each = async (list, fn) => {
    setBusy(true);
    try { for (const s of list) await fn(s); } catch (e) { say(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div className="src-bulk">
      <span>영상 분석{running ? <small> · 진행 중 {running}</small> : null}</span>
      <button className="sm" disabled={busy || !needScenes.length} title="장면 전환을 찾아 AI 컨텍스트에 장면 목록으로 넣습니다 (로컬 ffmpeg, 무료)"
        onClick={() => each(needScenes, (s) => S.scenes(s.id, { sensitivity: 'normal' }))}>장면 분석 {needScenes.length}개</button>
      <button className="sm" disabled={busy || !needStt.length} title="말소리를 받아써 AI 컨텍스트에 넣습니다 (ElevenLabs, 사용량 발생)"
        onClick={() => {
          if (!elKey) { say('설정에서 ElevenLabs API 키를 등록하세요', 'err'); onNeedKey(); return; }
          if (!window.confirm(`영상 ${needStt.length}개, 약 ${minutes}분 길이의 오디오를 ElevenLabs로 보내 받아쓰기합니다. 사용량(요금)이 발생합니다. 진행할까요?`)) return;
          const lang = (() => { try { return localStorage.getItem('zk.stt.lang') || ''; } catch { return ''; } })();
          each(needStt, (s) => S.transcribe(s.id, { lang }, elKey));
        }}>받아쓰기 {needStt.length}개 · {minutes}분</button>
      {onCompose && <button className="sm accent" title="체크한 영상 소스로 AI가 구간·순서·챕터를 제안 (검토 후 적용)" onClick={onCompose}>✦ 구성 초안</button>}
    </div>
  );
}

// NotebookLM식 소스 패널: 여러 자료를 한 번에 올리고, 내용과 AI에 실제로 가는 컨텍스트를 확인·제어
export default function SourcesPanel({ S, open, onToggle, view, setView, dragging, pickRequest, usedPaths, brief, onEditProject, onUseAsVideo, appendTitle, onAppend, elKey, onNeedKey, onCompose, evidenceKey, evidenceTitle, say }) {
  const inputRef = useRef(null);
  const [draft, setDraft] = useState(false);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const items = S.items || [];
  useEffect(() => { if (pickRequest) inputRef.current?.click(); }, [pickRequest]);
  const detail = view.startsWith('src:') ? items.find((s) => s.id === view.slice(4)) : null;
  useEffect(() => { if (view.startsWith('src:') && S.items && !detail) setView('list'); }, [view, detail, S.items, setView]);

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { say(e.message, 'err'); } finally { setBusy(false); }
  };
  const all = items.length > 0 && items.every((s) => s.enabled);
  const some = items.some((s) => s.enabled);
  const full = items.length >= MAX_SOURCES;

  if (!open) {
    return (
      <aside className="srcdock closed">
        <button className="src-open-btn" title="소스 패널 열기 (AI 컨텍스트)" aria-label="소스 패널 열기" onClick={onToggle}>
          <span aria-hidden="true">▤</span><span className="src-vlabel">소스</span>
          {items.length > 0 && <small>{S.usage.count}/{items.length}</small>}
          {S.active > 0 && <i className="src-dot" title="업로드 중" />}
        </button>
      </aside>
    );
  }

  return (
    <aside className={`srcdock ${dragging ? 'dragging' : ''}`} aria-label="소스">
      <div className="srcdock-h">
        <b>소스</b>
        <div className="seg-toggle sm" role="tablist" aria-label="소스 보기">
          <button role="tab" aria-selected={view !== 'context'} className={view !== 'context' ? 'on' : ''} onClick={() => setView('list')}>목록 <small>{items.length}</small></button>
          <button role="tab" aria-selected={view === 'context'} className={view === 'context' ? 'on' : ''} onClick={() => setView('context')}>AI 컨텍스트</button>
        </div>
        <span className="grow" />
        <button className="ghost" title="접기" aria-label="소스 패널 접기" onClick={onToggle}>⟨</button>
      </div>
      <input ref={inputRef} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { S.upload(e.target.files || []); e.target.value = ''; }} />

      <div className="srcdock-b">
        {view === 'context' ? (
          <ContextPreview S={S} brief={brief} onEditProject={onEditProject} onOpen={(id) => setView(`src:${id}`)} evidenceKey={evidenceKey} evidenceTitle={evidenceTitle} />
        ) : detail ? (
          <SourceDetail key={detail.id} s={detail} S={S} used={usedPaths.has(detail.path)} onBack={() => setView('list')} onUseAsVideo={onUseAsVideo} appendTitle={appendTitle} onAppend={onAppend} elKey={elKey} onNeedKey={onNeedKey} say={say} />
        ) : (<>
          <div className={`src-drop ${dragging ? 'over' : ''}`}>
            <b>{dragging ? '여기에 놓으면 소스로 추가합니다' : '파일을 끌어다 놓거나 붙여넣기(Ctrl+V)'}</b>
            <small>영상 · 이미지 · 텍스트({TEXT_EXT.join(' ')}) 여러 개를 한 번에</small>
            <div className="src-drop-actions">
              <button className="accent" disabled={full} onClick={() => inputRef.current?.click()}>파일 선택</button>
              <button disabled={full || draft} onClick={() => setDraft(true)}>텍스트 입력</button>
              <button disabled={full} title="복사하지 않고 PC의 영상 위치를 그대로 사용" onClick={() => setLinking(true)}>PC 영상 연결</button>
            </div>
            {full && <small className="warn">소스는 {MAX_SOURCES}개까지 추가할 수 있습니다.</small>}
          </div>
          {draft && <TextDraft onSave={(b) => S.addText(b)} onCancel={() => setDraft(false)} />}
          <Jobs jobs={S.jobs} onDismiss={S.dismissJob} />
          {S.error && <div className="callout err" role="alert">{S.error} <button className="sm" onClick={S.reload}>다시 시도</button></div>}
          {!S.items && !S.error && <p className="muted sm">소스를 불러오는 중…</p>}
          {S.items && (items.length ? (<>
            <UsageMeter usage={S.usage} />
            <BulkAnalysis items={items} S={S} elKey={elKey} onNeedKey={onNeedKey} onCompose={onCompose} say={say} />
            <div className="src-listhead">
              <label className="chk">
                <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = some && !all; }} disabled={busy}
                  onChange={(e) => run(() => S.select(e.target.checked ? items.map((s) => s.id) : []))} />
                모두 선택
              </label>
              <small className="muted">AI 컨텍스트 {S.usage.count} / {items.length}</small>
            </div>
            <ul className="src-list">
              {items.map((s) => (
                <li key={s.id} className={`src-item ${s.enabled ? '' : 'off'}`}>
                  <input type="checkbox" checked={s.enabled} disabled={busy} aria-label={`${s.title} AI 컨텍스트에 포함`}
                    onChange={(e) => { const enabled = e.target.checked; run(() => S.update(s.id, { enabled })); }} />
                  <button className="src-row" onClick={() => setView(`src:${s.id}`)} title="내용 확인·편집">
                    <SourceThumb s={s} />
                    <span className="src-meta">
                      <b>{s.title}</b>
                      <small>
                        {KIND[s.kind]}
                        {s.kind === 'text' && ` · ${s.text.length.toLocaleString()}자`}
                        {s.kind === 'video' && ` · ${fmtTime(s.duration)} · 프레임 ${s.frames?.length || 0}`}
                        {s.kind === 'video' && !s.copied && ' · 연결'}
                        {s.note && ' · 메모'}
                        {s.kind === 'video' && <AnalysisBadges s={s} />}
                      </small>
                    </span>
                    {usedPaths.has(s.path) && <small className="tag">편집 중</small>}
                  </button>
                </li>
              ))}
            </ul>
          </>) : !draft && (
            <div className="src-empty">
              <p>촬영본, 기획 메모, 대본 초안, 용어집, 레퍼런스 이미지를 모아 두면 어시스턴트·썸네일 초안·업로드 문구·번역이 이 소스를 근거로 씁니다.</p>
              <p className="muted">체크한 소스만 AI에 전달되고, 무엇이 전달되는지는 <b>AI 컨텍스트</b> 탭에서 그대로 확인할 수 있습니다.</p>
            </div>
          ))}
        </>)}
      </div>
      {linking && <LinkVideos onLink={S.link} jobs={S.jobs} onClose={() => setLinking(false)} />}
    </aside>
  );
}
