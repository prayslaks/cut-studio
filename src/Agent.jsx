import { useEffect, useRef, useState } from 'react';
import { fmt } from './timeline.js';

// ---- 공급자 설정 ----
export const PROVIDERS = {
  anthropic: { label: 'Claude', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'] },
  openai: { label: 'GPT', models: ['gpt-6-sol', 'gpt-6.1-sol', 'gpt-5.6', 'gpt-5.5'] },
};

const QUICK_BY_MODE = {
  style: [
    ['썸네일 톤 맞추기', '썸네일·카드와 어울리도록 자막 스타일(폰트·색·크기·외곽선)을 제안해줘.'],
    ['가독성 점검', '첨부한 화면 기준으로 자막이 잘 읽히는지, HUD와 겹치지 않는지 점검하고 스타일 수정안을 제안해줘.'],
    ['폰트 추천', '이 게임 분위기(밀리터리·SF 공중전)에 맞는 한글 폰트 조합(자막/제목)을 추천하고 바로 적용 가능한 style 변경으로 제안해줘.'],
  ],
  cards: [
    ['인트로 다듬기', '첨부한 화면(인트로 카드 표시 중일 수 있음)을 보고 인트로 카드의 문구·배치·애니메이션을 더 임팩트 있게 개선해줘.'],
    ['썸네일 톤 맞추기', '선택된 썸네일 느낌과 어울리도록 현재 카드를 조정해줘.'],
    ['챕터 카드 정리', '챕터 카드가 게임 화면을 너무 가리지 않으면서 잘 읽히도록 크기·위치·배경을 조정해줘.'],
  ],
  thumbs: [
    ['이 썸네일 개선', '첨부한 썸네일을 보고 클릭을 부르는 방향으로 레이어(문구·크기·색·배치)를 개선해줘.'],
    ['문구 3안', '핵심 문구를 3가지 다른 방향으로 제안해줘. 가장 좋은 1안은 바로 적용할 수 있게 thumb_layer로.'],
    ['가독성 점검', '모바일 목록 크기에서도 읽히는지 점검하고 크기·대비·외곽선을 조정해줘.'],
    ['배경 장면 조정', '피사체가 더 잘 보이도록 확대/중심/보정(thumb_bg)을 제안해줘.'],
  ],
};
const QUICK = [
  ['선택 대사 다듬기', '선택한 대사를 화면 흐름에 맞게 더 자연스럽고 몰입감 있게 다듬어줘. 길이는 비슷하게 유지.'],
  ['현재 장면 대사 제안', '첨부한 현재 화면을 보고, 지금 재생 위치에 들어갈 나레이션 대사를 제안해줘. 앞뒤 대사와 겹치지 않게 시작 시각도 정해줘.'],
  ['겹침 해결', '겹침 경고가 있는 대사들을 시작 시각 조정이나 문장 축약으로 해결해줘.'],
  ['발음 점검', '모든 대사에서 TTS가 잘못 읽을 만한 영어·숫자·기호·약어를 찾아서 발음 사전 규칙이나 줄별 발음(tts)으로 고쳐줘.'],
  ['톤 통일', '전체 대사를 개발자 소개 톤으로 일관되게 맞추고, 과장되거나 사실 확인이 필요한 표현은 지적해줘.'],
];

const ls = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

export default function Agent({ keys, ai, mode = 'lines', onOpenSettings, buildContext, captureFrame, applyOps, annotate, describeOp, say }) {
  const { provider, model } = ai;
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  const key = keys[provider] || '';
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);

  const send = async (text) => {
    text = (text ?? input).trim();
    if (!text || busy) return;
    if (!key) { onOpenSettings(); say(`설정에서 ${PROVIDERS[provider].label} API 키를 등록하세요`, 'err'); return; }
    const image = attach ? await Promise.resolve(captureFrame()).catch(() => null) : null;
    const userMsg = { role: 'user', text, image };
    const history = [...msgs, userMsg];
    setMsgs(history); setInput(''); setBusy(true);
    try {
      // 이미지는 가장 최근 사용자 메시지에만 첨부 (요청 크기 절약)
      const lastUser = history.length - 1;
      const payload = history.map((m, i) => ({
        role: m.role,
        text: m.role === 'assistant' && m.ops?.length
          ? `${m.text}\n\n[제안했던 변경 ${m.ops.length}건: ${m.ops.map(describeOp).join(' / ')}]${m.applied ? ' (사용자가 적용함)' : ''}`
          : m.text,
        image: i === lastUser ? m.image : null,
      }));
      const r = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ai-key': key },
        body: JSON.stringify({ provider, model, system: buildContext(), messages: payload }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setMsgs((m) => [...m, { role: 'assistant', text: j.text || (j.edits ? j.edits.summary || '' : '(빈 응답)'), ops: annotate(j.edits?.ops || []), usage: j.usage }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: `⚠ ${e.message}`, error: true }]);
      say(`에이전트 오류: ${e.message}`, 'err');
    } finally { setBusy(false); }
  };

  const apply = (mi, idxs) => {
    const m = msgs[mi];
    const ops = idxs.map((i) => m.ops[i]);
    applyOps(ops);
    setMsgs((all) => all.map((x, i) => (i === mi ? { ...x, done: [...new Set([...(x.done || []), ...idxs])], applied: true } : x)));
    say(`제안 ${ops.length}건 적용 (저장 전)`, 'ok');
  };
  const dismiss = (mi, idx) => setMsgs((all) => all.map((x, i) => (i === mi ? { ...x, skipped: [...(x.skipped || []), idx] } : x)));

  const quick = QUICK_BY_MODE[mode] || QUICK;

  return (
    <div className="agent">
      <div className="agent-bar">
        <span className="agent-model" title="설정에서 변경"><b>{PROVIDERS[provider]?.label}</b> <code>{model}</code></span>
        <span className="grow" />
        {!key && <button className="accent" onClick={onOpenSettings}>키 등록</button>}
        <button className="ghost" title="AI 설정" onClick={onOpenSettings}>⚙</button>
        <button className="ghost" title="대화 비우기" onClick={() => setMsgs([])}>↺</button>
      </div>
      <div className="agent-log">
        {!msgs.length && (
          <div className="agent-empty">
            <p>대사·자막 스타일·썸네일 모든 단계에서 지금 보고 있는 작업을 기준으로 도와줍니다. 제안은 검토 후 <b>적용</b>을 눌러야 반영됩니다.</p>
          </div>
        )}
        {msgs.map((m, mi) => (
          <div key={mi} className={`msg ${m.role} ${m.error ? 'error' : ''}`}>
            {m.image && <img src={m.image} alt="첨부 화면" />}
            <div className="bubble">{m.text}</div>
            {!!m.ops?.length && (
              <div className="ops">
                {m.ops.map((op, oi) => {
                  const done = m.done?.includes(oi); const skip = m.skipped?.includes(oi);
                  return (
                    <div key={oi} className={`op ${done ? 'done' : ''} ${skip ? 'skip' : ''}`}>
                      <OpView op={op} />
                      <div className="op-act">
                        {done ? <span className="muted">적용됨</span> : skip ? <span className="muted">무시함</span> : (
                          <><button className="accent" onClick={() => apply(mi, [oi])}>적용</button>
                            <button className="ghost" onClick={() => dismiss(mi, oi)}>무시</button></>
                        )}
                      </div>
                    </div>
                  );
                })}
                {m.ops.length > 1 && m.ops.some((_, i) => !m.done?.includes(i) && !m.skipped?.includes(i)) && (
                  <button className="primary all" onClick={() => apply(mi, m.ops.map((_, i) => i).filter((i) => !m.done?.includes(i) && !m.skipped?.includes(i)))}>남은 제안 모두 적용</button>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant"><div className="bubble typing">생각 중…</div></div>}
        <div ref={endRef} />
      </div>

      <div className="quick">
        {quick.map(([n, p]) => <button key={n} disabled={busy} onClick={() => send(p)}>{n}</button>)}
      </div>
      <div className="agent-input">
        <textarea rows={2} value={input} placeholder="예: B07을 좀 더 긴박하게 바꿔줘 / 03 챕터 대사가 너무 많아, 줄여줘"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        <div className="agent-send">
          <label className="chk" title={mode === 'thumbs' ? '현재 썸네일 렌더 이미지를 함께 보냄' : '현재 재생 위치의 영상 프레임을 함께 보냄'}><input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} />{mode === 'thumbs' ? '썸네일 첨부' : '화면 첨부'}</label>
          <button className="primary" disabled={busy || !input.trim()} onClick={() => send()}>보내기</button>
        </div>
      </div>
    </div>
  );
}

function OpView({ op }) {
  const F = ({ label, before, after }) => (after === undefined ? null : (
    <div className="f"><span>{label}</span>{before !== undefined && before !== after && <del>{String(before || '∅')}</del>}<ins>{String(after || '∅')}</ins></div>
  ));
  const head = { update: '수정', add: '추가', delete: '삭제', rule_add: '사전 추가', rule_remove: '사전 삭제', style: '자막 스타일',
    thumb_layer: '썸네일 레이어', thumb_add: '썸네일 레이어 추가', thumb_remove: '썸네일 레이어 삭제', thumb_bg: '썸네일 배경', card: '영상 카드 설정', card_layer: '카드 레이어', card_add: '카드 레이어 추가', card_remove: '카드 레이어 삭제' }[op.op] || op.op;
  const kv = (o, before) => Object.entries(flat(o || {})).map(([k, v]) => <F key={k} label={k} before={before ? flat(before)[k] : undefined} after={typeof v === 'object' ? JSON.stringify(v) : v} />);
  return (
    <div className="opv">
      <div className="oph"><b>{head}</b> {op.id && <code>{op.id}</code>} {op.reason && <span className="muted">— {op.reason}</span>}</div>
      {op.op === 'update' && (<>
        <F label="시작" before={op._before?.start != null ? fmt(op._before.start) : undefined} after={op.start != null ? fmt(op.start) : undefined} />
        <F label="자막" before={op._before?.text} after={op.text} />
        <F label="발음" before={op._before?.tts} after={op.tts} />
      </>)}
      {op.op === 'add' && (<><F label="시작" after={fmt(op.start)} /><F label="자막" after={op.text} /><F label="발음" after={op.tts} /></>)}
      {op.op === 'delete' && op._before && <div className="f"><del>{op._before.text}</del></div>}
      {op.op === 'style' && <div className="kvs">{kv(op.style)}</div>}
      {(op.op === 'thumb_layer' || op.op === 'thumb_add' || op.op === 'thumb_bg' || op.op === 'card' || op.op === 'card_layer' || op.op === 'card_add') && <div className="kvs">{op.card && <F label="카드" after={op.card} />}{kv(op.props, op._before)}</div>}
      {(op.op === 'thumb_remove' || op.op === 'card_remove') && op._before && <div className="f"><del>{op._before.text || op._before.type}</del></div>}
      {(op.op === 'rule_add' || op.op === 'rule_remove') && <div className="rulef"><code>{op.from}</code> → <code>{op.to ?? ''}</code></div>}
    </div>
  );
}

function flat(o, p = '', out = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out); else out[key] = v;
  }
  return out;
}
