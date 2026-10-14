import { useState } from 'react';
import { CARD_KINDS, cardLayersFromThumb } from '../../shared/cards.js';
import { fmt } from '../timeline.js';

function N({ label, value, onChange, step = 0.1, min = 0, max, suffix = 's' }) {
  return (
    <label className="field"><span>{label}</span>
      <span className="numu"><input type="number" step={step} min={min} max={max} value={value ?? 0}
        onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v)) onChange(Math.round(v * 100) / 100); }} /><i>{suffix}</i></span></label>
  );
}

// 가운데 패널: 영상 카드(인트로·챕터·엔딩) 선택·타이밍·텍스트 데이터
export default function CardsPanel({ C, meta, insts, onFocus, onPlay, setMeta, endDur, thumbs = [], tab, st, say }) {
  const [src, setSrc] = useState('');
  const card = C.card; const k = C.kind;
  const set = (patch) => C.updateCard(k, patch);
  const mine = insts.filter((i) => i.kind === k);
  const chapters = meta?.chapters || [];
  const setCh = (i, patch) => setMeta((m) => ({ ...m, chapters: m.chapters.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  return (
    <div className="sidescroll cards-panel">
      <p className="hint">영상에 번인되는 카드입니다(썸네일과 별개). 왼쪽 영상 위에서 레이어를 직접 클릭·드래그해 편집하고, 아래 인스펙터에서 글꼴·색·애니메이션을 바꿉니다. 색·폰트를 <b>스타일</b>로 두면 자막 스타일 탭과 연동됩니다.</p>
      <div className="seg-toggle wide">
        {CARD_KINDS.map(([key, n]) => (
          <button key={key} className={k === key ? 'on' : ''} onClick={() => { C.setKind(key); const i = insts.find((x) => x.kind === key && (key !== 'chapter' || x.idx === C.chIdx)) || insts.find((x) => x.kind === key); if (i) onFocus(i); }}>
            {n}{!C.cards[key].enabled && <small> 끔</small>}
          </button>
        ))}
      </div>

      <div className="cp-sec">
        <div className="row">
          <label className="chk"><input type="checkbox" checked={!!card.enabled} onChange={(e) => set({ enabled: e.target.checked })} />이 카드 사용</label>
          <span className="grow" />
          {mine[0] && <button onClick={() => onPlay(mine.find((x) => k !== 'chapter' || x.idx === C.chIdx) || mine[0])}>▶ 카드 재생</button>}
          <button className="ghost" title="기본 레이아웃으로 되돌리기 (실행취소 가능)" onClick={() => C.reset(k)}>기본값</button>
        </div>
        <div className="row wrap">
          {k === 'intro' && (<>
            <N label="시작" value={card.start} onChange={(v) => set({ start: v })} />
            <N label="길이" value={card.dur} min={0.5} onChange={(v) => set({ dur: v })} />
          </>)}
          {k === 'chapter' && (<>
            <N label="첫 챕터: 구간 시작 +" value={card.firstOffset} onChange={(v) => set({ firstOffset: v })} />
            <N label="이후 챕터: 구간 시작 +" value={card.offset} onChange={(v) => set({ offset: v })} />
            <N label="길이" value={card.dur} min={0.5} onChange={(v) => set({ dur: v })} />
          </>)}
          {k === 'end' && <N label="엔딩 길이(영상 끝에 추가)" value={endDur} min={0} onChange={(v) => setMeta((m) => ({ ...m, end_card: v }))} />}
          <N label="페이드 인" value={card.fadeIn} onChange={(v) => set({ fadeIn: v })} />
          <N label="페이드 아웃" value={card.fadeOut} onChange={(v) => set({ fadeOut: v })} />
        </div>
        {mine.length > 0 && k !== 'chapter' && <p className="muted sm">편집본 {fmt(mine[0].a)} ~ {fmt(mine[0].b)}</p>}
        {k === 'intro' && <p className="muted sm">텍스트 변수: <code>{'{date}'}</code> {meta?.date || '—'} · <code>{'{title}'}</code> {meta?.title || '—'}</p>}
      </div>

      <div className="cp-sec">
        <h4>썸네일에서 가져오기 <small className="muted">레이어 배치·문구·색·폰트를 2배(2560×1440)로 옮겨 이 카드의 레이어를 교체</small></h4>
        <div className="row">
          <select className="grow" value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="">썸네일 초안 선택…</option>
            {[...thumbs].sort((a, b) => (a.key === tab ? -1 : 1) - (b.key === tab ? -1 : 1) || (b.rendered || 0) - (a.rendered || 0)).map((d) => (
              <option key={d.id} value={d.id}>{d.key === tab ? '' : `[${d.key}] `}{d.label || '썸네일'} · {fmt(d.t)}</option>
            ))}
          </select>
          <button className="accent" disabled={!src} onClick={() => {
            const d = thumbs.find((x) => x.id === src); if (!d) return;
            C.update((c) => { c[k] = { ...c[k], layers: cardLayersFromThumb(d.layers, st) }; return c; }); C.setSelLayer(null);
            say?.(`썸네일 "${d.label || d.id}" 레이어를 ${CARD_KINDS.find(([x]) => x === k)[1]} 카드로 가져옴 (Ctrl+Z로 되돌리기)`, 'ok');
            const i = insts.find((x) => x.kind === k); if (i) onFocus(i);
          }}>가져오기</button>
        </div>
        <p className="muted sm">썸네일 배경 장면은 가져오지 않습니다(카드는 영상 위에 겹침). 썸네일에서 스타일과 같은 색·폰트는 스타일 연동으로 바뀝니다.</p>
      </div>

      {k === 'chapter' && (
        <div className="cp-sec">
          <h4>챕터 ({chapters.length}) <small className="muted">텍스트의 {'{num} {kr} {en}'}에 들어갑니다</small></h4>
          {!chapters.length && <p className="muted">이 영상에는 챕터가 없습니다.</p>}
          {chapters.map((c, i) => {
            const inst = insts.find((x) => x.kind === 'chapter' && x.idx === i);
            return (
              <div key={i} className={`chrow ${C.chIdx === i ? 'on' : ''}`} onClick={() => { C.setChIdx(i); if (inst) onFocus(inst); }}>
                <input className="num" value={c.num ?? ''} onChange={(e) => setCh(i, { num: e.target.value })} title="{num}" />
                <input value={c.kr ?? ''} placeholder="한글 제목 {kr}" onChange={(e) => setCh(i, { kr: e.target.value })} />
                <input value={c.en ?? ''} placeholder="영문 {en}" onChange={(e) => setCh(i, { en: e.target.value })} />
                <span className="muted sm">{inst ? fmt(inst.a) : ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
