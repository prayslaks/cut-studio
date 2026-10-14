import { COLOR_TOKENS, FONT_TOKENS, CARD_VARS, newCardText, newCardRect, newCardGrad } from '../../shared/cards.js';
import { Num, Slider } from '../thumbs/ThumbInspector.jsx';

const ICON = { text: 'T', rect: '■', grad: '◐' };
const ROLE = { dim: '배경 어둡게', backdrop: '배경 박스', bar: '강조 바', bg: '배경' };
const nameOf = (l) => (l.type === 'text' ? (l.text || '').split('\n')[0].slice(0, 20) || '(빈 텍스트)' : ROLE[l.role] || (l.type === 'rect' ? '박스' : '그라데이션'));
const pct = (v) => `${Math.round(v * 100)}%`;

// 스타일 연동 토큰 또는 직접 색
function TokColor({ label, value, onChange, st }) {
  const tok = COLOR_TOKENS.find(([k]) => k === value);
  const hex = tok ? st.colors[value.slice(1)] : value || '#FFFFFF';
  return (
    <div className="ifield color"><span>{label}</span>
      <span className="cwrap">
        {COLOR_TOKENS.map(([k, n]) => (
          <button key={k} className={`tok ${value === k ? 'on' : ''}`} title={`자막 스타일의 ${n} 색 (스타일 바꾸면 함께 바뀜)`}
            style={{ '--c': st.colors[k.slice(1)] }} onClick={() => onChange(k)}>{n}</button>
        ))}
        <input type="color" value={hex} title="직접 지정" onChange={(e) => onChange(e.target.value.toUpperCase())} />
        {!tok && <code>{value}</code>}
      </span>
    </div>
  );
}

export default function CardInspector({ C, st, fontsList, onInstallFont }) {
  const card = C.card; const l = card.layers.find((x) => x.id === C.selLayer);
  const set = (patch) => l && C.updateLayer(l.id, patch);
  const move = (dir) => C.update((c) => {
    const a = [...c[C.kind].layers]; const i = a.findIndex((y) => y.id === l.id); const k = i + dir;
    if (k < 0 || k >= a.length) return c; [a[i], a[k]] = [a[k], a[i]]; c[C.kind].layers = a; return c;
  });
  const add = (nl) => { C.update((c) => { c[C.kind].layers = [...c[C.kind].layers, nl]; return c; }); C.setSelLayer(nl.id); };
  const remove = () => { C.update((c) => { c[C.kind].layers = c[C.kind].layers.filter((y) => y.id !== l.id); return c; }); C.setSelLayer(null); };

  const fontKey = !l?.font || typeof l.font === 'string' ? l?.font || '@title' : `${l.font.source === 'system' ? 'sys' : 'g'}|${l.font.family}|${l.font.weight}`;
  const fontOpts = [
    ...FONT_TOKENS.map(([k, n]) => ({ k, label: `스타일: ${n} (${st.fonts[k.slice(1)].family} ${st.fonts[k.slice(1)].weight})`, v: k })),
    ...fontsList.map((f) => ({ k: `g|${f.family}|${f.weight}`, label: `${f.family} ${f.weight}`, v: { family: f.family, weight: f.weight } })),
  ];
  const inList = fontOpts.some((o) => o.k === fontKey);
  const an = l?.anim || {};
  const setAnim = (p) => set({ anim: { ...an, ...p } });

  return (
    <div className="tinsp cinsp">
      <div className="ti-bar">
        <b className="ci-title">{{ intro: '인트로', chapter: '챕터', end: '엔딩' }[C.kind]} 카드 레이어</b>
        <span className="muted sm">변수 {CARD_VARS[C.kind].join(' ')}</span>
        <span className="grow" />
        <button className="ghost" disabled={!C.canUndo} title="실행취소 (Ctrl+Z)" onClick={C.undo}>↶</button>
        <button className="ghost" disabled={!C.canRedo} title="다시 실행 (Ctrl+Y)" onClick={C.redo}>↷</button>
      </div>
      <div className="ti-body">
        <div className="ti-layers">
          <div className="ti-add">
            <button onClick={() => add(newCardText({ text: '새 텍스트', x: 1280, y: 720, anchor: 5 }))}>＋ 텍스트</button>
            <button onClick={() => add(newCardRect())}>＋ 박스</button>
            <button onClick={() => add(newCardGrad())}>＋ 그라데이션</button>
          </div>
          <ol>
            {[...card.layers].reverse().map((y) => (
              <li key={y.id} className={`${C.selLayer === y.id ? 'on' : ''} ${y.visible === false ? 'hid' : ''}`} onClick={() => C.setSelLayer(y.id)}>
                <i>{ICON[y.type]}</i><span>{nameOf(y)}</span>
                <button className="ghost" title="보이기/숨기기" onClick={(e) => { e.stopPropagation(); C.updateLayer(y.id, { visible: y.visible === false }); }}>{y.visible === false ? '◌' : '●'}</button>
              </li>
            ))}
          </ol>
        </div>
        <div className="ti-props">
          {!l ? <p className="muted">영상 위나 목록에서 레이어를 선택하세요. 드래그로 이동, 모서리 핸들로 크기, 방향키 미세 이동(Shift ×10), Delete 삭제. 좌표는 2560×1440 기준.</p> : (<>
            <div className="ti-row ti-head">
              <b>{nameOf(l)}</b><span className="grow" />
              <button className="ghost" title="앞으로" onClick={() => move(1)}>▲</button>
              <button className="ghost" title="뒤로" onClick={() => move(-1)}>▼</button>
              <button className="ghost" onClick={remove}>삭제</button>
            </div>
            {l.type === 'text' && (<>
              <textarea rows={2} value={l.text} onChange={(e) => set({ text: e.target.value })} />
              <div className="ti-row">
                <label className="ifield grow"><span>폰트</span>
                  <select value={inList ? fontKey : '__cur'} onChange={(e) => { const o = fontOpts.find((x) => x.k === e.target.value); if (o) set({ font: o.v }); }}>
                    {!inList && <option value="__cur">{l.font?.family} {l.font?.weight}{l.font?.source === 'system' ? ' (시스템)' : ' (미설치)'}</option>}
                    {fontOpts.map((o) => <option key={o.k} value={o.k}>{o.label}</option>)}
                  </select></label>
                {!inList && l.font?.family && l.font?.source !== 'system' && <button className="accent sm" onClick={() => onInstallFont(l.font.family, l.font.weight)}>설치</button>}
              </div>
              <div className="ti-row">
                <Slider label="크기" value={l.size} min={20} max={480} onChange={(v) => set({ size: v })} />
                <Slider label="자간" value={l.spacing || 0} min={-30} max={60} onChange={(v) => set({ spacing: v })} />
                <Slider label="불투명도" value={l.alpha ?? 1} min={0} max={1} step={0.01} fmtv={pct} onChange={(v) => set({ alpha: v })} />
              </div>
              <div className="ti-row"><TokColor label="색" value={l.color} st={st} onChange={(v) => set({ color: v })} /></div>
              <div className="ti-row">
                <Slider label="외곽선" value={l.outline?.width || 0} min={0} max={24} step={0.5} onChange={(v) => set({ outline: { width: v } })} />
                <Slider label="그림자" value={l.shadow?.dist || 0} min={0} max={24} step={0.5} onChange={(v) => set({ shadow: { dist: v } })} />
              </div>
              {(l.outline?.width > 0 || l.shadow?.dist > 0) && (
                <div className="ti-row">
                  {l.outline?.width > 0 && <TokColor label="외곽선 색" value={l.outline?.color || '@outline'} st={st} onChange={(v) => set({ outline: { color: v } })} />}
                  {l.shadow?.dist > 0 && <TokColor label="그림자 색" value={l.shadow?.color || '@outline'} st={st} onChange={(v) => set({ shadow: { color: v } })} />}
                </div>
              )}
              <div className="ti-row">
                <div className="ifield"><span>기준점</span>
                  <div className="anchors">{[7, 8, 9, 4, 5, 6, 1, 2, 3].map((a) => <button key={a} className={l.anchor === a ? 'on' : ''} onClick={() => set({ anchor: a })} />)}</div></div>
                <Num label="X" value={l.x} onChange={(v) => set({ x: v })} />
                <Num label="Y" value={l.y} onChange={(v) => set({ y: v })} />
              </div>
            </>)}
            {(l.type === 'rect' || l.type === 'grad') && (<>
              <div className="ti-row">
                <Num label="X" value={l.x} onChange={(v) => set({ x: v })} /><Num label="Y" value={l.y} onChange={(v) => set({ y: v })} />
                <Num label="너비" value={l.w} onChange={(v) => set({ w: v })} /><Num label="높이" value={l.h} onChange={(v) => set({ h: v })} />
                <button className="sm" title="화면 전체" onClick={() => set({ x: 0, y: 0, w: 2560, h: 1440 })}>전체 화면</button>
              </div>
              <div className="ti-row"><TokColor label="색" value={l.color} st={st} onChange={(v) => set({ color: v })} /></div>
              {l.type === 'rect' ? (
                <div className="ti-row">
                  <Slider label="불투명도" value={l.alpha ?? 1} min={0} max={1} step={0.01} fmtv={pct} onChange={(v) => set({ alpha: v })} />
                  <Slider label="흐림" value={l.blur || 0} min={0} max={80} onChange={(v) => set({ blur: v })} />
                </div>
              ) : (
                <div className="ti-row">
                  <label className="ifield"><span>방향</span>
                    <select value={l.dir} onChange={(e) => set({ dir: e.target.value })}>
                      <option value="right">왼쪽 → 오른쪽</option><option value="left">오른쪽 → 왼쪽</option><option value="down">위 → 아래</option><option value="up">아래 → 위</option>
                    </select></label>
                  <Slider label="시작 불투명도" value={l.from} min={0} max={1} step={0.01} fmtv={pct} onChange={(v) => set({ from: v })} />
                  <Slider label="끝 불투명도" value={l.to} min={0} max={1} step={0.01} fmtv={pct} onChange={(v) => set({ to: v })} />
                </div>
              )}
            </>)}
            <div className="ti-sub">등장 애니메이션</div>
            <div className="ti-row">
              <Slider label="지연" value={an.delay || 0} min={0} max={3} step={0.05} fmtv={(v) => `${v.toFixed(2)}s`} onChange={(v) => setAnim({ delay: v })} />
              <Slider label="시작 X 오프셋" value={an.dx || 0} min={-600} max={600} step={2} onChange={(v) => setAnim({ dx: v })} />
              <Slider label="시작 Y 오프셋" value={an.dy || 0} min={-600} max={600} step={2} onChange={(v) => setAnim({ dy: v })} />
              <Slider label="이동 시간" value={an.dur ?? 0.4} min={0.05} max={2} step={0.05} fmtv={(v) => `${v.toFixed(2)}s`} onChange={(v) => setAnim({ dur: v })} />
              <label className="chk" title="카드의 페이드 인/아웃 적용"><input type="checkbox" checked={an.fade !== false} onChange={(e) => setAnim({ fade: e.target.checked })} />페이드</label>
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}
