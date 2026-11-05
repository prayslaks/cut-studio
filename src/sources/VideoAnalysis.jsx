import { useEffect, useMemo, useState } from 'react';
import { SCENE_SENS, STT_MODELS, STT_LANGS, sceneSpans, speakerNames, ctxOn, fmtTime } from '../../shared/sources.js';
import { RUNNING } from './useSources.js';

const ls = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const PHASE = { queued: '대기 중', running: '분석 중', audio: '오디오 추출 중', stt: 'ElevenLabs 처리 중' };
const ft = (t) => fmtTime(t, true);

function Status({ a }) {
  if (!a?.status) return <small className="src-st">없음</small>;
  if (RUNNING.includes(a.status)) return <small className="src-st run">{PHASE[a.phase] || PHASE[a.status]}{a.progress ? ` ${Math.round(a.progress * 100)}%` : ''}</small>;
  if (a.status === 'error') return <small className="src-st err">실패</small>;
  return <small className="src-st ok">완료</small>;
}
const Bar = ({ a }) => (RUNNING.includes(a?.status) ? <i className="src-job-bar"><em style={{ width: `${Math.max(3, (a.progress || 0) * 100)}%` }} /></i> : null);

function CtxToggle({ s, kind, S, run }) {
  return (
    <label className="chk" title="이 결과를 AI 컨텍스트에 텍스트로 함께 보냄">
      <input type="checkbox" checked={ctxOn(s, kind)} disabled={!s.enabled} onChange={(e) => { const v = e.target.checked; run(() => S.update(s.id, { ctx: { [kind]: v } })); }} />AI에 포함
    </label>
  );
}

// 받아쓰기 편집: 문장 클릭 = 그 위치로 이동, 문장 고치기·빼기, 찾아 바꾸기 (게임 용어 오인식 교정)
function TranscriptEditor({ s, S, cur, seek, say }) {
  const [orig, setOrig] = useState(null);
  const [segs, setSegs] = useState(null);
  const [find, setFind] = useState('');
  const [repl, setRepl] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    S.transcript(s.id).then((d) => { if (alive) { setOrig(d.segments); setSegs(d.segments); } }).catch((e) => say(e.message, 'err'));
    return () => { alive = false; };
  }, [s.id, s.transcript?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = useMemo(() => speakerNames(segs || []), [segs]);
  if (!segs) return <small className="muted">불러오는 중…</small>;
  const dirty = JSON.stringify(segs) !== JSON.stringify(orig);
  const hits = find ? segs.reduce((n, g) => n + g.text.split(find).length - 1, 0) : 0;
  const save = async () => {
    setBusy(true);
    try { await S.saveTranscript(s.id, segs); say('받아쓰기 저장됨', 'ok'); } catch (e) { say(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div className="src-tr">
      <div className="src-tr-find">
        <input value={find} placeholder="찾기 (예: 로콘)" onChange={(e) => setFind(e.target.value)} />
        <span>→</span>
        <input value={repl} placeholder="바꾸기 (예: 록온)" onChange={(e) => setRepl(e.target.value)} />
        <button className="sm" disabled={!hits} onClick={() => setSegs(segs.map((g) => ({ ...g, text: g.text.split(find).join(repl) })))}>모두 바꾸기{find ? ` ${hits}곳` : ''}</button>
      </div>
      <ol className="src-tr-list">
        {segs.map((g, i) => (
          <li key={i} className={cur >= g.s && cur < g.e ? 'on' : ''}>
            <button className="ghost sm src-tr-t" title="이 위치로 이동" onClick={() => seek(g.s)}>{ft(g.s)}</button>
            {names[g.speaker] && <small className="src-tr-sp">{names[g.speaker]}</small>}
            <input aria-label={`${ft(g.s)} 문장`} value={g.text} onChange={(e) => setSegs(segs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            <button className="ghost sm" aria-label={`${ft(g.s)} 문장 빼기`} onClick={() => setSegs(segs.filter((_, j) => j !== i))}>✕</button>
          </li>
        ))}
        {!segs.length && <li className="muted sm">인식된 말소리가 없습니다.</li>}
      </ol>
      {dirty && (
        <div className="row src-save">
          <span className="muted sm grow">저장하지 않은 받아쓰기 변경</span>
          <button className="sm" disabled={busy} onClick={() => setSegs(orig)}>되돌리기</button>
          <button className="primary sm" disabled={busy} onClick={save}>변경 저장</button>
        </div>
      )}
    </div>
  );
}

// 영상 소스 분석: 장면 전환(로컬 ffmpeg, 무료) · 받아쓰기(ElevenLabs, 유료). 결과는 직접 고칠 수 있고 AI 컨텍스트에 텍스트로 들어감
export default function VideoAnalysis({ s, S, cur, seek, elKey, onNeedKey, say }) {
  const [sens, setSens] = useState(s.scenes?.sensitivity || 'normal');
  const [lang, setLang] = useState(() => ls.get('zk.stt.lang', ''));
  const [model, setModel] = useState(() => { const m = ls.get('zk.stt.model', STT_MODELS[0]); return STT_MODELS.includes(m) ? m : STT_MODELS[0]; });
  const [diarize, setDiarize] = useState(() => ls.get('zk.stt.diarize', '0') === '1');
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { say(e.message, 'err'); } finally { setBusy(false); }
  };
  const sc = s.scenes; const tr = s.transcript;
  const scDone = sc?.status === 'done'; const trDone = tr?.status === 'done';
  const spans = scDone ? sceneSpans(sc.cuts, s.duration) : [];
  const saveCuts = (cuts) => run(() => S.scenes(s.id, { cuts }));
  const analyze = () => run(() => S.scenes(s.id, { sensitivity: sens }));
  const stt = () => {
    if (!elKey) { say('설정에서 ElevenLabs API 키를 등록하세요', 'err'); onNeedKey(); return; }
    if (trDone && !window.confirm('지금 받아쓰기(직접 고친 내용 포함)를 지우고 다시 받아쓸까요?')) return;
    if (!window.confirm(`약 ${Math.max(1, Math.ceil(s.duration / 60))}분 길이의 오디오를 ElevenLabs로 보내 받아쓰기합니다. ElevenLabs 사용량(요금)이 발생합니다. 진행할까요?`)) return;
    ls.set('zk.stt.lang', lang); ls.set('zk.stt.model', model); ls.set('zk.stt.diarize', diarize ? '1' : '0');
    run(() => S.transcribe(s.id, { lang, model, diarize }, elKey));
  };
  const scRunning = RUNNING.includes(sc?.status); const trRunning = RUNNING.includes(tr?.status);

  return (
    <div className="src-ana-wrap">
      <section className="src-ana">
        <div className="src-ana-h"><b>장면 전환</b><Status a={sc} />{scDone && <small className="muted">{spans.length}개{sc.manual ? ' · 직접 고침' : ''}</small>}<span className="grow" />{scDone && <CtxToggle s={s} kind="scenes" S={S} run={run} />}</div>
        <Bar a={sc} />
        {sc?.status === 'error' && <small className="src-ana-err">{sc.error}</small>}
        {sc?.budgetOff && <small className="warn">컨텍스트 한도를 넘어 AI 첨부를 껐습니다.</small>}
        {scDone && (
          <ol className="src-scenes">
            {spans.map((g, i) => (
              <li key={g.s} className={cur >= g.s && cur < g.e ? 'on' : ''}>
                <button className="ghost sm" title="이 장면으로 이동" onClick={() => seek(g.s + 0.05)}><b>{i + 1}</b> {ft(g.s)}–{ft(g.e)}</button>
                {i > 0 && <button className="ghost sm" title="앞 장면과 합치기 (이 경계 지우기)" disabled={busy || scRunning}
                  onClick={() => saveCuts(sc.cuts.filter((_, j) => j !== i - 1))}>합치기</button>}
              </li>
            ))}
          </ol>
        )}
        <div className="src-ana-act">
          {scDone && <button className="sm" disabled={busy || scRunning} title="플레이어의 현재 위치를 장면 경계로 추가"
            onClick={() => saveCuts([...sc.cuts, Math.round(cur * 100) / 100])}>＋ {ft(cur)}에서 나누기</button>}
          {scDone && <button className="sm" disabled={busy || scRunning} title="장면마다 가운데 프레임을 대표 장면으로 (최대 12장)"
            onClick={() => { if (window.confirm('대표 장면을 장면마다 하나씩(최대 12장) 다시 뽑을까요?')) run(() => S.frames(s.id, { scenes: true })); }}>장면마다 대표 장면</button>}
          <label className="src-ana-sel" title="높을수록 작은 변화도 장면 전환으로 잡습니다">민감도
            <select value={sens} disabled={scRunning} onChange={(e) => setSens(e.target.value)}>
              {Object.entries(SCENE_SENS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <button className={scDone ? 'sm' : 'sm accent'} disabled={busy || scRunning}
            onClick={() => { if (!sc?.manual || window.confirm('직접 고친 장면 경계를 지우고 다시 분석할까요?')) analyze(); }}>{scDone ? '다시 분석' : '장면 분석'}</button>
          {!scDone && <small className="muted">로컬 ffmpeg · 무료</small>}
        </div>
      </section>

      <section className="src-ana">
        <div className="src-ana-h"><b>받아쓰기</b><Status a={tr} />{trDone && <small className="muted">{tr.count}문장 · {tr.lang || '언어 자동'}{tr.edited ? ' · 직접 고침' : ''}</small>}<span className="grow" />{trDone && <CtxToggle s={s} kind="transcript" S={S} run={run} />}</div>
        <Bar a={tr} />
        {tr?.status === 'error' && s.audio !== false && <small className="src-ana-err">{tr.error}</small>}
        {tr?.budgetOff && <small className="warn">컨텍스트 한도를 넘어 AI 첨부를 껐습니다. 문장을 줄이거나 다른 소스를 끄고 다시 켜세요.</small>}
        {trDone && <TranscriptEditor s={s} S={S} cur={cur} seek={seek} say={say} />}
        <div className="src-ana-act">
          <label className="src-ana-sel">언어<select value={lang} disabled={trRunning} onChange={(e) => setLang(e.target.value)}>{STT_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="src-ana-sel">모델<select value={model} disabled={trRunning} onChange={(e) => setModel(e.target.value)}>{STT_MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="chk" title="여러 사람이 말하면 화자를 구분합니다"><input type="checkbox" checked={diarize} disabled={trRunning} onChange={(e) => setDiarize(e.target.checked)} />화자 구분</label>
          <button className={trDone ? 'sm' : 'sm accent'} disabled={busy || trRunning || s.audio === false} onClick={stt}>{trDone ? '다시 받아쓰기' : '받아쓰기'}</button>
          {s.audio === false ? <small className="muted">소리가 없는 영상</small> : !trDone && <small className="muted">ElevenLabs · 사용량 발생</small>}
        </div>
      </section>
    </div>
  );
}
