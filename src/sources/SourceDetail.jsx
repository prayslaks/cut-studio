import { useRef, useState } from 'react';
import { MAX_SOURCE_TEXT, MAX_NOTE, MAX_FRAMES, FRAME_COUNTS, fmtTime, fmtBytes } from '../../shared/sources.js';

const KIND = { text: '텍스트', image: '이미지', video: '영상' };

// 소스 하나의 내용 확인·편집. 제목·메모·본문은 '변경 저장'으로 반영, 켜기/프레임은 즉시 반영
export default function SourceDetail({ s, S, used, onBack, onUseAsVideo, say }) {
  const [draft, setDraft] = useState({ title: s.title, note: s.note || '', text: s.text || '' });
  const [busy, setBusy] = useState('');
  const [playErr, setPlayErr] = useState(false);
  const [cur, setCur] = useState(0);
  const vref = useRef(null);
  const dirty = draft.title !== s.title || draft.note !== (s.note || '') || (s.kind === 'text' && draft.text !== s.text);
  const set = (p) => setDraft((d) => ({ ...d, ...p }));

  const run = async (label, fn) => {
    if (busy) return;
    setBusy(label);
    try { await fn(); } catch (e) { say(e.message, 'err'); } finally { setBusy(''); }
  };
  const save = () => run('save', async () => {
    const patch = {};
    if (draft.title !== s.title) patch.title = draft.title;
    if (draft.note !== (s.note || '')) patch.note = draft.note;
    if (s.kind === 'text' && draft.text !== s.text) patch.text = draft.text;
    const { item } = await S.update(s.id, patch);
    setDraft({ title: item.title, note: item.note || '', text: item.text || '' });
    say('소스 저장됨', 'ok');
  });
  const remove = () => {
    if (!window.confirm(`‘${s.title}’ 소스를 삭제할까요?${s.kind === 'video' && !s.copied ? ' (PC의 원본 영상은 그대로 남습니다)' : ''}`)) return;
    run('remove', async () => { await S.remove(s.id); onBack(); });
  };
  const frames = s.frames || [];
  const frameUrl = (t) => `/api/sources/${s.id}/frames/${Math.round(t * 1000)}.jpg`;
  const seek = (t) => { if (vref.current) { vref.current.currentTime = t; vref.current.pause(); } };

  return (
    <div className="src-detail">
      <div className="src-detail-bar">
        <button className="ghost sm" onClick={() => { if (!dirty || window.confirm('저장하지 않은 변경을 버릴까요?')) onBack(); }}>← 목록</button>
        <span className={`src-kind ${s.kind}`}>{KIND[s.kind]}</span>
        <span className="grow" />
        <label className="chk" title="체크하면 AI 요청에 이 소스를 함께 보냅니다">
          <input type="checkbox" checked={s.enabled} disabled={!!busy} onChange={(e) => { const enabled = e.target.checked; run('toggle', () => S.update(s.id, { enabled })); }} />AI 컨텍스트
        </label>
        <button className="ghost danger sm" disabled={!!busy} onClick={remove}>삭제</button>
      </div>

      <input className="src-title-in" aria-label="소스 제목" value={draft.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} />

      {s.kind === 'text' && (
        <label className="field"><span>본문 <b>{draft.text.length.toLocaleString()}</b> / {MAX_SOURCE_TEXT.toLocaleString()}자{s.origin ? ` · ${s.origin}` : ''}</span>
          <textarea className="src-text" value={draft.text} maxLength={MAX_SOURCE_TEXT} onChange={(e) => set({ text: e.target.value })} />
        </label>
      )}

      {s.kind === 'image' && (
        <a className="src-image" href={`/api/sources/${s.id}/file`} target="_blank" rel="noreferrer" title="새 탭에서 원본 크기로 보기">
          <img src={`/api/sources/${s.id}/file`} alt={s.title} />
        </a>
      )}

      {s.kind === 'video' && (<>
        <video ref={vref} className="src-video" src={`/api/sources/${s.id}/file`} controls preload="metadata"
          onError={() => setPlayErr(true)} onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)} />
        {playErr && <small className="warn">브라우저에서 재생할 수 없는 형식입니다. 대표 프레임은 AI에 정상 전달됩니다.</small>}
        <div className="src-vinfo muted">
          {fmtTime(s.duration)} · {s.width}×{s.height}{s.size ? ` · ${fmtBytes(s.size)}` : ''}
          <br /><span title={s.path}>{s.copied ? '프로젝트 폴더에 복사됨' : `PC 원본 연결: ${s.path}`}</span>
        </div>
        <div className="src-frames-h">
          <b>AI에 보낼 장면 {frames.length}장</b>
          <span className="grow" />
          <button className="sm" disabled={!!busy || frames.length >= MAX_FRAMES || playErr} title="플레이어의 현재 위치 장면을 추가"
            onClick={() => run('frames', () => S.frames(s.id, { add: Math.round(cur * 100) / 100 }))}>＋ 현재 장면 {fmtTime(cur, true)}</button>
          <select className="sm" aria-label="균등 간격으로 다시 뽑기" value="" disabled={!!busy}
            onChange={(e) => {
              const count = +e.target.value;
              if (count && window.confirm(`지금 장면 ${frames.length}장을 지우고 균등 간격으로 ${count}장을 다시 뽑을까요?`)) run('frames', () => S.frames(s.id, { count }));
            }}>
            <option value="">균등 재추출…</option>
            {FRAME_COUNTS.map((n) => <option key={n} value={n}>{n}장</option>)}
          </select>
        </div>
        {busy === 'frames' && <small className="th-busy">프레임 추출 중…</small>}
        <div className="src-frames">
          {frames.map((f) => (
            <figure key={f.t}>
              <button className="src-frame" title="이 장면으로 이동" onClick={() => seek(f.t)}><img src={frameUrl(f.t)} alt={`${fmtTime(f.t, true)} 장면`} loading="lazy" /></button>
              <figcaption>{fmtTime(f.t, true)}<button className="ghost sm" aria-label={`${fmtTime(f.t, true)} 장면 빼기`} disabled={!!busy}
                onClick={() => run('frames', () => S.frames(s.id, { remove: f.t }))}>✕</button></figcaption>
            </figure>
          ))}
          {!frames.length && <small className="muted">대표 장면이 없습니다. 영상 정보와 메모만 전달됩니다.</small>}
        </div>
        <div className="row">
          {used ? <small className="tag">편집 영상으로 사용 중</small>
            : <button onClick={() => onUseAsVideo(s)} title="이 영상을 프로젝트의 편집 영상 탭으로 가져오기 (구간·챕터 설정)">편집 영상으로 추가</button>}
        </div>
      </>)}

      <label className="field"><span>AI에게 알려줄 메모 <small className="muted">— 예: “톤 참고용, 사실 근거로 쓰지 말 것”, “03 챕터 촬영본”</small></span>
        <textarea className="src-note" rows={3} value={draft.note} maxLength={MAX_NOTE} placeholder="이 소스를 어떻게 써야 하는지 적으면 AI가 따릅니다."
          onChange={(e) => set({ note: e.target.value })} />
      </label>

      {dirty && (
        <div className="row src-save">
          <span className="muted sm grow">저장하지 않은 변경</span>
          <button className="sm" disabled={!!busy} onClick={() => setDraft({ title: s.title, note: s.note || '', text: s.text || '' })}>되돌리기</button>
          <button className="primary sm" disabled={!!busy || !draft.title.trim() || (s.kind === 'text' && !draft.text.trim())} onClick={save}>변경 저장</button>
        </div>
      )}
      <p className="hint">{s.enabled ? 'AI 컨텍스트에 포함됨' : 'AI 컨텍스트에서 제외됨'} — {
        s.kind === 'text' ? `본문 ${(s.text || '').length.toLocaleString()}자` : s.kind === 'image' ? '이미지 1장' : `영상 정보 + 장면 ${frames.length}장`}{s.note ? ' + 메모' : ''}</p>
    </div>
  );
}
