import { useMemo, useState } from 'react';
import { PROVIDERS } from './Agent.jsx';

const mmss = (t) => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
const normTag = (h) => { const v = String(h || '').trim().replace(/\s+/g, ''); return v ? (v.startsWith('#') ? v : `#${v}`) : ''; };

function Copy({ text, label = '복사', say }) {
  const [done, setDone] = useState(false);
  return (
    <button className={`copybtn ${done ? 'done' : ''}`} disabled={!text} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { say?.('클립보드 복사 실패', 'err'); }
    }}>{done ? '✓ 복사됨' : label}</button>
  );
}
const Count = ({ n, max }) => <span className={`cnt ${n > max ? 'over' : ''}`}>{n.toLocaleString()} / {max.toLocaleString()}</span>;

// 가운데 패널: 유튜브 업로드용 제목·설명·태그 (script.json meta.{A|B}.youtube)
export default function YoutubePanel({ meta, setMeta, tl, tab, ai, aiKey, onOpenSettings, thumbs = [], say, ensureSaved }) {
  const yt = meta?.youtube || {};
  const set = (patch) => setMeta((m) => ({ ...m, youtube: { ...(m.youtube || {}), ...patch } }));
  const [brief, setBrief] = useState('');
  const mine = thumbs.filter((d) => d.key === tab).sort((a, b) => (b.rendered || 0) - (a.rendered || 0));
  const [thumbId, setThumbId] = useState('');
  const thumbSel = thumbId === 'none' ? '' : thumbId || mine[0]?.id || '';
  const [busy, setBusy] = useState(false);

  // 챕터 타임스탬프 (유튜브 규칙: 0:00 시작, 3개 이상, 각 10초 이상)
  const chap = useMemo(() => {
    const list = (meta?.chapters || []).map((c, i) => ({ t: tl.parts[i]?.off ?? 0, name: [c.num, c.kr].filter(Boolean).join(' ') }));
    if (!list.length) return { lines: [], ok: false, why: '이 영상에는 챕터가 없습니다' };
    if (list[0].t > 0.5) list.unshift({ t: 0, name: '인트로' }); else list[0].t = 0;
    const short = list.some((c, i) => (list[i + 1]?.t ?? tl.total) - c.t < 10);
    return { lines: list.map((c) => `${mmss(c.t)} ${c.name}`), ok: list.length >= 3 && !short,
      why: list.length < 3 ? '유튜브 챕터는 3개 이상 필요' : short ? '10초보다 짧은 챕터가 있음' : '' };
  }, [meta?.chapters, tl]);

  const hashtags = (yt.hashtags || []).map(normTag).filter(Boolean);
  const useChap = yt.useChapters !== false && chap.lines.length > 0;
  const useHash = yt.useHashtags !== false && hashtags.length > 0;
  const finalDesc = [
    (yt.description || '').trim(),
    useChap ? chap.lines.join('\n') : '',
    useHash ? hashtags.join(' ') : '',
  ].filter(Boolean).join('\n\n');
  const tags = yt.tags || [];
  const tagsText = tags.join(', ');
  const tagLen = tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, tags.length - 1);

  const generate = async () => {
    if (!aiKey) { onOpenSettings(); return; }
    setBusy(true);
    try {
      await ensureSaved();
      const r = await fetch('/api/youtube/agent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ai-key': aiKey },
        body: JSON.stringify({ key: tab, provider: ai.provider, model: ai.model, brief, thumbId: thumbSel || undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || r.statusText);
      const cands = (d.titles || []).filter((x) => x?.title);
      set({
        candidates: cands, prevDesc: yt.description || '', description: d.description || yt.description || '',
        tags: d.tags?.length ? d.tags.map((x) => String(x).replace(/^#/, '').trim()).filter(Boolean) : tags,
        hashtags: d.hashtags?.length ? d.hashtags.map(normTag).filter(Boolean) : yt.hashtags,
        title: yt.title?.trim() ? yt.title : cands[0]?.title || '', aiNote: d.notes || '', aiAt: Date.now(),
      });
      say(`유튜브 제목 후보 ${cands.length}개·설명·태그 추천 받음`, 'ok');
    } catch (e) { say(`유튜브 추천 실패: ${e.message}`, 'err'); } finally { setBusy(false); }
  };

  return (
    <div className="sidescroll yt-panel">
      <div className="cp-sec">
        <div className="row">
          <b>AI 추천</b><span className="muted sm">{PROVIDERS[ai.provider]?.label} · {ai.model}</span>
        </div>
        <label className="field"><span>사실 메모 — AI가 참고할 내용 (촬영일, 강조할 시스템, 행사 해시태그 등. 저장됨)</span>
          <textarea rows={2} value={yt.notes || ''} placeholder="예: 촬영 장소와 출연자 소개, 시리즈 재생목록 안내"
            onChange={(e) => set({ notes: e.target.value })} /></label>
        <div className="row">
          <input className="grow" value={brief} placeholder="이번 요청 (예: 더 짧고 강하게, 개발기록 톤으로)" onChange={(e) => setBrief(e.target.value)} />
          <select value={thumbSel || 'none'} onChange={(e) => setThumbId(e.target.value)} title="함께 보낼 썸네일 (제목과 톤 맞춤)">
            <option value="none">썸네일 없이</option>
            {mine.map((d) => <option key={d.id} value={d.id}>썸네일: {d.label || d.id}</option>)}
          </select>
        </div>
        <div className="row">
          <button className="primary" disabled={busy} onClick={generate}>{busy ? '추천 받는 중…' : aiKey ? '✦ 제목·설명 추천' : '설정에서 AI 키 등록'}</button>
          {yt.prevDesc != null && yt.prevDesc !== yt.description && <button className="ghost" onClick={() => set({ description: yt.prevDesc, prevDesc: yt.description })} title="AI 적용 전 설명으로 (다시 누르면 되돌림)">설명 되돌리기</button>}
        </div>
        {yt.aiNote && <p className="hint">💡 {yt.aiNote}</p>}
      </div>

      {yt.candidates?.length > 0 && (
        <div className="cp-sec">
          <h4>제목 후보</h4>
          {yt.candidates.map((c, i) => (
            <div key={i} className={`ytcand ${c.title === yt.title ? 'on' : ''}`}>
              <div className="grow"><b>{c.title}</b>{c.angle && <small>{c.angle} · {c.title.length}자</small>}</div>
              <button className="sm" onClick={() => set({ title: c.title })}>사용</button>
              <Copy text={c.title} say={say} />
            </div>
          ))}
        </div>
      )}

      <div className="cp-sec">
        <div className="row"><h4 className="grow">제목</h4><Count n={(yt.title || '').length} max={100} /><Copy text={yt.title} say={say} /></div>
        <input value={yt.title || ''} placeholder="동영상 제목 (필수)" onChange={(e) => set({ title: e.target.value })} />
      </div>

      <div className="cp-sec">
        <div className="row"><h4 className="grow">설명</h4><Count n={finalDesc.length} max={5000} /><Copy text={finalDesc} label="최종 설명 복사" say={say} /></div>
        <textarea rows={10} value={yt.description || ''} placeholder="본문 (타임스탬프·해시태그는 아래 옵션으로 자동 추가)" onChange={(e) => set({ description: e.target.value })} />
        <div className="row wrap">
          <label className="chk" title={chap.why || '챕터 카드 시작 시각 기준'}>
            <input type="checkbox" disabled={!chap.lines.length} checked={useChap} onChange={(e) => set({ useChapters: e.target.checked })} />챕터 타임스탬프 붙이기
          </label>
          {chap.lines.length > 0 && !chap.ok && <span className="warn sm">⚠ {chap.why} — 유튜브가 챕터로 인식하지 않을 수 있음</span>}
          <label className="chk"><input type="checkbox" checked={yt.useHashtags !== false} onChange={(e) => set({ useHashtags: e.target.checked })} />해시태그 붙이기</label>
        </div>
        <label className="field"><span>해시태그 (공백으로 구분, 앞 3개가 제목 위에 표시)</span>
          <input value={(yt.hashtags || []).join(' ')} placeholder="#브랜드 #주제 #키워드"
            onChange={(e) => set({ hashtags: e.target.value.split(/\s+/).filter((x, i, a) => x || i === a.length - 1) })} /></label>
        <details className="ytprev">
          <summary>최종 설명 미리보기</summary>
          <pre>{finalDesc || '(비어 있음)'}</pre>
        </details>
      </div>

      <div className="cp-sec">
        <div className="row"><h4 className="grow">태그</h4><Count n={tagLen} max={500} /><Copy text={tags.map((x) => x.trim()).filter(Boolean).join(', ')} say={say} /></div>
        <textarea rows={3} value={tagsText} placeholder="쉼표로 구분 (유튜브 스튜디오 '태그' 칸에 그대로 붙여넣기)"
          onChange={(e) => set({ tags: e.target.value.split(',').map((x) => x.trimStart()).filter((x, i, a) => x || i === a.length - 1) })} />
      </div>
    </div>
  );
}
