import { useEffect, useState } from 'react';
import UsageMeter from './UsageMeter.jsx';

function TextBlock({ text }) {
  const [more, setMore] = useState(false);
  const long = text.length > 600;
  return (
    <>
      <pre className={`ctx-text ${long && !more ? 'clip' : ''}`}>{text}</pre>
      {long && <button className="ghost sm" onClick={() => setMore((m) => !m)}>{more ? '접기' : `전체 보기 (${text.length.toLocaleString()}자)`}</button>}
    </>
  );
}

// AI 요청에 실제로 붙는 소스 컨텍스트를 그대로 보여줌 (서버가 요청을 만들 때와 같은 구성)
// 편집본 근거: 지금 영상의 구간별 장면·원본 말소리 (대사 작업 때 어시스턴트에 함께 감)
function Evidence({ k, title, items }) {
  const [ev, setEv] = useState(null);
  useEffect(() => {
    if (!k) return undefined;
    let alive = true;
    fetch(`/api/videos/${k}/evidence`).then((r) => r.json()).then((d) => { if (alive) setEv(d); }).catch(() => { if (alive) setEv({ text: '' }); });
    return () => { alive = false; };
  }, [k, items]);
  if (!k) return null;
  return (
    <section className="ctx-brief">
      <b>편집본 근거 · ‘{title}’</b>
      <small className="muted">대사 탭에서 어시스턴트에 함께 보냅니다 (나레이션 위치를 정하는 근거).</small>
      {!ev ? <small className="muted">불러오는 중…</small> : ev.text ? <TextBlock text={ev.text} />
        : <p className="muted sm">이 영상의 구간에 장면 분석·받아쓰기를 한 소스 촬영본이 없습니다.</p>}
    </section>
  );
}

export default function ContextPreview({ S, brief, onEditProject, onOpen, evidenceKey, evidenceTitle }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    setErr('');
    S.preview().then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [S.items]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ctx">
      <section className="ctx-brief">
        <div className="row"><b className="grow">프로젝트 설명</b><button className="ghost sm" onClick={onEditProject}>편집</button></div>
        <small className="muted">모든 AI 요청의 시스템 프롬프트에 들어갑니다.</small>
        {brief ? <TextBlock text={brief} /> : <p className="muted sm">없음 — 프로젝트 설정에서 무엇에 대한 영상인지, 톤, 꼭 지킬 사실을 적어 두세요.</p>}
      </section>

      <Evidence k={evidenceKey} title={evidenceTitle} items={S.items} />
      {err && <div className="callout err">{err}</div>}
      {!data && !err && <p className="muted sm">불러오는 중…</p>}
      {data && (<>
        <UsageMeter usage={data.usage} />
        <p className="hint">선택한 소스 {data.usage.count}개 / 전체 {data.total}개. 어시스턴트(메시지마다), 썸네일 AI 초안, 업로드 문구 추천에 아래 내용이 첨부되고, 트랙 번역에는 텍스트만 첨부됩니다.</p>
        {!data.blocks.length ? (
          <div className="src-empty"><p>AI 컨텍스트로 선택한 소스가 없습니다. 목록에서 체크하면 여기에 표시됩니다.</p></div>
        ) : (<>
          <pre className="ctx-text ctx-intro">{data.intro}</pre>
          {data.blocks.map((b) => (
            <article key={b.id} className="ctx-block">
              <div className="ctx-block-h"><b>[소스 {b.n}]</b><span className="grow">{b.title}</span><button className="ghost sm" onClick={() => onOpen(b.id)}>열기</button></div>
              <TextBlock text={b.text} />
              {b.images.length > 0 && (
                <div className="ctx-imgs">
                  {b.images.map((im) => (
                    <figure key={im.url}><img src={im.url} alt={im.caption || b.title} loading="lazy" />{im.caption && <figcaption>{im.caption}</figcaption>}</figure>
                  ))}
                </div>
              )}
            </article>
          ))}
          <details className="ctx-rules"><summary>AI에게 함께 전달되는 규칙</summary><p>{data.rules}</p></details>
        </>)}
      </>)}
    </div>
  );
}
