import { useEffect, useRef, useState } from 'react';
import { fmt } from './timeline.js';
import { PROVIDERS } from './Agent.jsx';

const j = async (url, opt = {}) => {
  const r = await fetch(url, opt);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `${r.status}`);
  return d;
};
const post = (url, body, headers = {}) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const mb = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';
const dur = (s) => (s == null || !Number.isFinite(s) ? '--' : s >= 60 ? `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초` : `${Math.round(s)}초`);

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-h"><h2>{title}</h2><button className="ghost" onClick={onClose} aria-label="닫기">✕</button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------- 설정 ----------------
function KeyRow({ label, hint, value, onChange, onTest, status }) {
  const [show, setShow] = useState(false);
  return (
    <div className="keyrow">
      <div className="kl"><b>{label}</b><small>{hint}</small></div>
      <div className="kin">
        <input type={show ? 'text' : 'password'} value={value} placeholder="미등록" onChange={(e) => onChange(e.target.value.trim())} spellCheck={false} />
        <button className="ghost" title={show ? '숨기기' : '보기'} onClick={() => setShow((s) => !s)}>{show ? '🙈' : '👁'}</button>
        <button onClick={onTest} disabled={!value || status?.busy}>{status?.busy ? '확인 중…' : '연결 테스트'}</button>
      </div>
      {status?.msg && <div className={`kst ${status.ok ? 'ok' : 'err'}`}>{status.ok ? '✓ ' : '✕ '}{status.msg}</div>}
    </div>
  );
}

export function SettingsModal({ keys, setKey, remember, setRemember, ai, setAi, onTestEl, onClose, say, log = [], clearLog, focus }) {
  const logRef = useRef(null);
  const [logFilter, setLogFilter] = useState('all');
  useEffect(() => { if (focus === 'log') setTimeout(() => logRef.current?.scrollIntoView({ block: 'start' }), 0); }, [focus]);
  const [models, setModels] = useState({});
  const [st, setSt] = useState({});
  const [cfg, setCfg] = useState(null);
  const [ff, setFf] = useState(null);
  const [cfgDirty, setCfgDirty] = useState(false);

  useEffect(() => { j('/api/config').then(setCfg).catch((e) => say(e.message, 'err')); }, [say]);

  const test = async (k) => {
    setSt((s) => ({ ...s, [k]: { busy: true } }));
    try {
      let msg;
      if (k === 'el') msg = await onTestEl();
      else {
        const list = await j(`/api/agent/models?provider=${k}`, { headers: { 'x-ai-key': keys[k] } });
        msg = `모델 ${list.length}개 사용 가능`;
      }
      setSt((s) => ({ ...s, [k]: { ok: true, msg } }));
    } catch (e) { setSt((s) => ({ ...s, [k]: { ok: false, msg: e.message } })); }
  };

  const detect = async () => {
    setFf({ busy: true });
    try {
      if (cfgDirty) await saveCfg();
      setFf(await j('/api/ffmpeg/check'));
    } catch (e) { setFf({ ok: false, error: e.message }); }
  };
  const saveCfg = async () => {
    await j('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ffmpegPath: cfg.ffmpegPath, fontName: cfg.fontName }) });
    setCfgDirty(false); say('내보내기 설정 저장됨', 'ok');
  };
  const setC = (k, v) => { setCfg((c) => ({ ...c, [k]: v })); setCfgDirty(true); };

  return (
    <Modal title="설정" onClose={onClose}
      footer={<><span className="muted grow">키는 서버 파일에 저장되지 않습니다. ‘기억’ 시 이 브라우저에만 보관.</span>
        {cfgDirty && <button onClick={() => saveCfg().catch((e) => say(e.message, 'err'))}>설정 저장</button>}
        <button className="primary" onClick={async () => { if (cfgDirty) await saveCfg().catch(() => {}); onClose(); }}>완료</button></>}>
      <section className="set">
        <h4>API 키</h4>
        <KeyRow label="ElevenLabs" hint="TTS 생성 · 보이스/모델 목록" value={keys.el} onChange={(v) => setKey('el', v)} onTest={() => test('el')} status={st.el} />
        <KeyRow label="Claude (Anthropic)" hint="AI 어시스턴트" value={keys.anthropic} onChange={(v) => setKey('anthropic', v)} onTest={() => test('anthropic')} status={st.anthropic} />
        <KeyRow label="OpenAI" hint="AI 어시스턴트 (GPT)" value={keys.openai} onChange={(v) => setKey('openai', v)} onTest={() => test('openai')} status={st.openai} />
        <label className="chk big"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />이 PC 브라우저에 키 기억하기</label>
      </section>

      <section className="set">
        <h4>AI 에이전트</h4>
        <p className="hint">어시스턴트와 썸네일 AI 초안이 모두 이 설정을 사용합니다.</p>
        <div className="row2">
          <span>제공자</span>
          <div className="seg-toggle">
            {Object.entries(PROVIDERS).map(([k, p]) => (
              <button key={k} className={ai.provider === k ? 'on' : ''}
                onClick={() => setAi({ provider: k, model: localStorage.getItem(`zk.ai.model.${k}`) || p.models[0] })}>{p.label}{keys[k] ? '' : ' (키 없음)'}</button>
            ))}
          </div>
          <span />
        </div>
        <label className="row2"><span>모델</span>
          <input list="ai-models" value={ai.model || ''} onChange={(e) => setAi({ ...ai, model: e.target.value.trim() })} spellCheck={false} />
          <button disabled={!keys[ai.provider]} onClick={async () => {
            try { const l = await j(`/api/agent/models?provider=${ai.provider}`, { headers: { 'x-ai-key': keys[ai.provider] } }); setModels((m) => ({ ...m, [ai.provider]: l })); say(`모델 ${l.length}개`, 'ok'); }
            catch (e) { say(e.message, 'err'); }
          }}>목록 불러오기</button></label>
        <datalist id="ai-models">{(models[ai.provider]?.length ? models[ai.provider] : PROVIDERS[ai.provider].models).map((m) => <option key={m} value={m} />)}</datalist>
      </section>

      <section className="set">
        <h4>내보내기 환경</h4>
        {!cfg ? <p className="muted">불러오는 중…</p> : (<>
          <label className="row2"><span>ffmpeg 경로</span>
            <input value={cfg.ffmpegPath} placeholder="비워두면 PATH의 ffmpeg 사용" onChange={(e) => setC('ffmpegPath', e.target.value)} />
            <button onClick={detect} disabled={ff?.busy}>{ff?.busy ? '감지 중…' : '감지'}</button></label>
          {ff && !ff.busy && (ff.ok ? (
            <div className="kst ok">✓ {ff.version}<br />
              인코더: {ff.encoders.map((e) => ff.labels?.[e] || e).join(', ')} · 자막(libass) {ff.libass ? '지원' : <b className="err">미지원</b>}{!ff.ffprobe && ' · ffprobe 없음'}</div>
          ) : (
            <div className="kst err">✕ ffmpeg를 실행할 수 없습니다: {ff.error}<br />
              설치: <code>winget install Gyan.FFmpeg</code> 후 서버 재시작, 또는 ffmpeg.exe 전체 경로 입력</div>
          ))}
          <label className="row2"><span>자막 폰트</span>
            <input value={cfg.fontName} placeholder={`기본: ${cfg.defaultFont}`} onChange={(e) => setC('fontName', e.target.value)} />
            <span className="muted sm">Pretendard 등 설치된 폰트 이름</span></label>
          <label className="row2"><span>출력 폴더</span>
            <code className="grow path">{cfg.outDir || '(프로젝트를 열면 표시)'}</code>
            <button className="ghost" disabled={!cfg.outDir} onClick={() => post('/api/open', { path: cfg.outDir }).catch((e) => say(e.message, 'err'))}>열기</button></label>
          <p className="hint">출력 폴더는 프로젝트마다 다르며 상단 ‘프로젝트 설정’에서 바꿉니다.</p>
          <div className="paths muted">작업 폴더 <code>{cfg.workDir}</code><br />영상 폴더 <code>{cfg.videoDir}</code></div>
        </>)}
      </section>

      <section className="set log" ref={logRef}>
        <h4>작업 · API 로그 <small className="muted">{log.length}건 (최근 200건, 새로고침 시 초기화)</small></h4>
        <div className="row2 logbar">
          <div className="seg-toggle sm">
            {[['all', '전체'], ['err', `오류 ${log.filter((x) => x.kind === 'err').length}`], ['ok', '완료']].map(([k, n]) => <button key={k} className={logFilter === k ? 'on' : ''} onClick={() => setLogFilter(k)}>{n}</button>)}
          </div>
          <span className="grow" />
          <button className="ghost" disabled={!log.length} onClick={() => navigator.clipboard?.writeText(log.map((x) => `${x.t} [${x.kind}] ${x.msg}`).join('\n')).then(() => say('로그 복사됨', 'ok'), () => {})}>복사</button>
          <button className="ghost" disabled={!log.length} onClick={clearLog}>지우기</button>
        </div>
        <ul>
          {log.filter((x) => logFilter === 'all' || x.kind === logFilter).map((x, i) => <li key={i} className={x.kind}><time>{x.t}</time>{x.msg}</li>)}
          {!log.length && <li className="muted">기록 없음</li>}
        </ul>
      </section>
    </Modal>
  );
}

// ---------------- MP4 내보내기 ----------------
const QUALITY = [['high', '고화질', '느림 · 업로드용'], ['standard', '표준', '권장'], ['draft', '빠른 초안', '검토용']];
const HEIGHTS = [[1440, '1440p (원본)'], [1080, '1080p'], [720, '720p']];
const PREF = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'];

export function ExportModal({ summaries, titles, dirty, onSave, job, onStart, onCancel, onClose, say }) {
  const [ff, setFf] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [opt, setOpt] = useState(() => {
    try { return { targets: [], height: 1440, quality: 'standard', encoder: '', tts: true, srt: true, gameVolume: 0.55, endFade: 3, ...JSON.parse(localStorage.getItem('zk.export') || '{}') }; }
    catch { return { targets: [], height: 1440, quality: 'standard', encoder: '', tts: true, srt: true, gameVolume: 0.55, endFade: 3 }; }
  });
  const [preview, setPreview] = useState(null);
  useEffect(() => { try { localStorage.setItem('zk.export', JSON.stringify(opt)); } catch {} }, [opt]);
  useEffect(() => {
    j('/api/config').then(setCfg).catch(() => {});
    j('/api/ffmpeg/check').then((r) => {
      setFf(r);
      if (r.ok) setOpt((o) => (r.encoders.includes(o.encoder) ? o : { ...o, encoder: PREF.find((e) => r.encoders.includes(e)) || 'libx264' }));
    }).catch((e) => setFf({ ok: false, error: e.message }));
  }, []);
  const keys = Object.keys(summaries);
  useEffect(() => { setOpt((o) => { const t = (o.targets || []).filter((k) => keys.includes(k)); return { ...o, targets: t.length ? t : keys }; }); }, [keys.join()]); // eslint-disable-line
  const set = (k, v) => setOpt((o) => ({ ...o, [k]: v }));
  const toggle = (k) => set('targets', opt.targets.includes(k) ? opt.targets.filter((x) => x !== k) : keys.filter((x) => x === k || opt.targets.includes(x)));

  const running = job && !job.finished;
  const canStart = ff?.ok && ff.libass && opt.targets.length && !running;
  const start = async () => {
    try {
      if (dirty) await onSave();
      await onStart(opt);
    } catch (e) { say(`내보내기 시작 실패: ${e.message}`, 'err'); }
  };

  const footer = running
    ? (<><span className="muted grow">창을 닫아도 계속 진행됩니다.</span><button onClick={onCancel}>취소</button><button onClick={onClose}>백그라운드로</button></>)
    : (<><span className="muted grow">{dirty ? '저장되지 않은 변경은 시작 시 자동 저장됩니다.' : ''}</span>
      <button onClick={onClose}>닫기</button>
      <button className="primary" disabled={!canStart} onClick={start}>{job?.finished ? '다시 내보내기' : '내보내기 시작'}</button></>);

  return (
    <Modal title="MP4 내보내기" onClose={onClose} footer={footer} wide>
      {ff && !ff.ok && (
        <div className="callout err">ffmpeg를 찾을 수 없습니다. <code>winget install Gyan.FFmpeg</code>로 설치 후 서버를 재시작하거나, 설정에서 ffmpeg.exe 경로를 지정하세요.<br /><small>{ff.error}</small></div>
      )}
      {ff?.ok && !ff.libass && <div className="callout err">이 ffmpeg 빌드는 자막(libass)을 지원하지 않습니다. full 빌드(Gyan.FFmpeg 등)를 사용하세요.</div>}

      {job ? (
        <div className="jobs">
          {job.items.map((it) => {
            const pct = Math.round((it.progress || 0) * 100);
            const eta = it.speed && it.total ? ((1 - (it.progress || 0)) * it.total) / it.speed : null;
            return (
              <div key={it.key} className={`jobitem ${it.status}`}>
                <div className="jh"><b>{titles[it.key]}</b>
                  <span className="jst">{{ queued: '대기', preparing: '준비 중', encoding: `인코딩 ${pct}%`, done: '완료', error: '실패', canceled: '취소됨' }[it.status]}</span></div>
                <div className="bar"><div style={{ width: `${it.status === 'done' ? 100 : pct}%` }} /></div>
                <div className="jm muted">
                  {it.status === 'encoding' && <>{fmt(it.sec || 0)} / {fmt(it.total)} · {it.speed ? `${it.speed.toFixed(2)}x` : '…'} · 남은 시간 약 {dur(eta)}</>}
                  {it.status === 'done' && <>{mb(it.size)} · {dur(it.elapsed)} 소요</>}
                </div>
                {it.status === 'error' && <pre className="jerr">{it.error}</pre>}
                {it.status === 'done' && (
                  <div className="jact">
                    <code className="path">{it.out}</code>
                    <button onClick={() => setPreview(preview === it.key ? null : it.key)}>{preview === it.key ? '미리보기 닫기' : '▶ 미리보기'}</button>
                    <button onClick={() => post('/api/open', { path: it.out }).catch((e) => say(e.message, 'err'))}>📂 폴더에서 보기</button>
                  </div>
                )}
                {preview === it.key && <video className="pv" src={`/api/export/${job.id}/file/${it.key}`} controls autoPlay />}
              </div>
            );
          })}
          {job.finished && <button className="ghost" onClick={() => onStart(null)}>← 옵션으로 돌아가기</button>}
        </div>
      ) : (
        <div className="exp">
          <div className="targets">
            {keys.map((k) => {
              const s = summaries[k];
              const warn = s.none + s.stale > 0 || s.overlaps > 0;
              return (
                <label key={k} className={`target ${opt.targets.includes(k) ? 'on' : ''}`}>
                  <input type="checkbox" checked={opt.targets.includes(k)} onChange={() => toggle(k)} />
                  <div>
                    <b>{titles[k]}</b> <span className="muted">· {fmt(s.total)}</span>
                    <div className="tchips">
                      <span className="c ok">나레이션 {s.ok}/{s.count}</span>
                      {s.stale > 0 && <span className="c warn">변경 미반영 {s.stale}</span>}
                      {s.none > 0 && <span className="c warn">미생성 {s.none}</span>}
                      {s.overlaps > 0 && <span className="c err">겹침 {s.overlaps}</span>}
                    </div>
                    {warn && opt.tts && <small className="muted">미생성 줄은 자막만, 변경 미반영 줄은 이전 음성으로 들어갑니다.</small>}
                  </div>
                </label>
              );
            })}
          </div>

          <div className="ogrid">
            <div className="og"><span>해상도</span>
              <div className="seg-toggle">{HEIGHTS.map(([h, n]) => <button key={h} className={opt.height === h ? 'on' : ''} onClick={() => set('height', h)}>{n}</button>)}</div></div>
            <div className="og"><span>품질</span>
              <div className="seg-toggle">{QUALITY.map(([q, n, d]) => <button key={q} title={d} className={opt.quality === q ? 'on' : ''} onClick={() => set('quality', q)}>{n}</button>)}</div></div>
            <div className="og"><span>인코더</span>
              <select value={opt.encoder} onChange={(e) => set('encoder', e.target.value)} disabled={!ff?.ok}>
                {(ff?.encoders || []).map((e) => <option key={e} value={e}>{ff.labels?.[e] || e}</option>)}
              </select></div>
            <div className="og"><span>게임 사운드 <b>{Math.round(opt.gameVolume * 100)}%</b></span>
              <input type="range" min="0" max="1" step="0.05" value={opt.gameVolume} onChange={(e) => set('gameVolume', +e.target.value)} /></div>
            <div className="og" title="엔딩 카드로 넘어가기 전, 원본 게임 소리를 이 시간 동안 서서히 줄임 (나레이션은 영향 없음)"><span>엔딩 전 게임 소리 페이드아웃 <b>{(opt.endFade ?? 3).toFixed(1)}초</b></span>
              <input type="range" min="0.4" max="8" step="0.1" value={opt.endFade ?? 3} onChange={(e) => set('endFade', +e.target.value)} /></div>
            <label className="chk"><input type="checkbox" checked={opt.tts} onChange={(e) => set('tts', e.target.checked)} />TTS 나레이션 포함 (나레이션 중 게임음 자동 감쇄)</label>
            <label className="chk"><input type="checkbox" checked={opt.srt} onChange={(e) => set('srt', e.target.checked)} />SRT 자막 파일도 저장 (유튜브 업로드용)</label>
          </div>
          <div className="outinfo muted">
            저장 위치 <code>{cfg?.outDir || '…'}</code> · 파일명 <code>…_편집본.mp4</code> (같은 이름은 덮어씀)
            {!ff && <> · ffmpeg 확인 중…</>}
          </div>
        </div>
      )}
    </Modal>
  );
}
