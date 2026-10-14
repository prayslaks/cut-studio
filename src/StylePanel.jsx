import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_STYLE, KEYWORDS } from '../shared/layout.js';

const PRESETS = [
  ['썸네일 톤', { text: '#FFFFFF', accent: '#DCF884', outline: '#080C0F' }],
  ['옐로', { text: '#FFFFFF', accent: '#FFD23F', outline: '#0B0B0B' }],
  ['시안', { text: '#F2FBFF', accent: '#5CE1FF', outline: '#061018' }],
  ['레드', { text: '#FFFFFF', accent: '#FF5A4E', outline: '#140606' }],
];
const SAMPLE = 'PROJECT ZK 탑뷰 공중 액션 123';

let catalogCache = null;

function FontPicker({ label, hint, value, onChange, installed, onInstall, busy }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [korean, setKorean] = useState(true);
  const [cat, setCat] = useState(catalogCache);
  const [pick, setPick] = useState(null);
  useEffect(() => {
    if (!open || cat) return;
    fetch('/api/fonts/catalog').then((r) => r.json()).then((j) => { catalogCache = j; setCat(j); }).catch(() => setCat({ fonts: [], error: '목록 로드 실패' }));
  }, [open, cat]);
  const list = useMemo(() => {
    const f = (cat?.fonts || []).filter((x) => (!korean || x.korean) && (!q || x.family.toLowerCase().includes(q.toLowerCase())));
    return f.sort((a, b) => (a.popularity ?? 999) - (b.popularity ?? 999)).slice(0, 80);
  }, [cat, q, korean]);
  const inst = installed.find((f) => f.family === value.family && f.weight === value.weight);
  const status = value.source === 'system' ? '시스템 폰트' : inst ? `설치됨${inst.hangul === false ? ' · 한글 없음' : ''}` : '미설치';
  const previewFamily = value.source === 'system' ? `"${value.family}"` : inst ? `"${inst.cssFamily}"` : 'inherit';

  return (
    <div className="fpick">
      <div className="fp-h">
        <div><b>{label}</b> <small className="muted">{hint}</small></div>
        <button onClick={() => setOpen((o) => !o)}>{open ? '닫기' : '변경'}</button>
      </div>
      <div className="fp-cur">
        <span className="fp-name">{value.family} <small>{value.weight}</small></span>
        <span className={`c ${inst || value.source === 'system' ? 'ok' : 'warn'}`}>{busy ? '설치 중…' : status}</span>
        {!inst && value.source !== 'system' && !busy && <button className="accent sm" onClick={() => onInstall(value.family, value.weight)}>설치</button>}
      </div>
      <div className="fp-sample" style={{ fontFamily: `${previewFamily}, sans-serif`, fontWeight: inst ? 400 : value.weight }}>{SAMPLE}</div>
      {open && (
        <div className="fp-pop">
          <div className="fp-search">
            <input autoFocus placeholder="Google Fonts 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="chk"><input type="checkbox" checked={korean} onChange={(e) => setKorean(e.target.checked)} />한글 지원만</label>
          </div>
          {cat?.error && <div className="kst err">{cat.error}</div>}
          <div className="fp-list">
            {!cat && <div className="muted">불러오는 중…</div>}
            {list.map((f) => (
              <div key={f.family} className={`fp-item ${pick === f.family ? 'on' : ''}`}>
                <button className="ghost fp-fam" onClick={() => setPick(pick === f.family ? null : f.family)}>
                  {f.family} <small className="muted">{f.category}{f.korean ? ' · 한글' : ''}</small>
                </button>
                {pick === f.family && (
                  <div className="fp-weights">
                    {f.weights.map((w) => (
                      <button key={w} className={value.family === f.family && value.weight === w ? 'on' : ''}
                        onClick={() => { onChange({ family: f.family, weight: w, source: 'google' }); onInstall(f.family, w); }}>{w}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="fp-sys">
            <span className="muted">PC에 설치된 폰트 직접 지정</span>
            <input placeholder="예: Pretendard ExtraBold" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value.trim()) { onChange({ family: e.target.value.trim(), weight: 700, source: 'system' }); setOpen(false); } }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function StylePanel({ style, setStyle, installed, onInstall, installing }) {
  const s = {
    fonts: { sub: { ...DEFAULT_STYLE.fonts.sub, ...(style?.fonts?.sub || {}) }, title: { ...DEFAULT_STYLE.fonts.title, ...(style?.fonts?.title || {}) } },
    colors: { ...DEFAULT_STYLE.colors, ...(style?.colors || {}) },
    sub: { ...DEFAULT_STYLE.sub, ...(style?.sub || {}) },
    keywords: Array.isArray(style?.keywords) ? style.keywords : null,
  };
  const set = (path, v) => setStyle((st) => {
    const n = JSON.parse(JSON.stringify(st || {}));
    let o = n; const ks = path.split('.');
    ks.slice(0, -1).forEach((k) => { o[k] = o[k] || {}; o = o[k]; });
    o[ks.at(-1)] = v; return n;
  });
  const [kw, setKw] = useState((s.keywords || KEYWORDS).join(', '));
  useEffect(() => { setKw((s.keywords || KEYWORDS).join(', ')); }, [style?.keywords]); // eslint-disable-line

  const missing = ['sub', 'title'].filter((k) => s.fonts[k].source !== 'system' && !installed.some((f) => f.family === s.fonts[k].family && f.weight === s.fonts[k].weight));

  return (
    <div className="stylep">
      {missing.length > 0 && (
        <div className="callout warn">선택한 폰트가 아직 설치되지 않아 미리보기·내보내기에 대체 폰트가 쓰입니다.
          <button className="accent sm" onClick={() => missing.forEach((k) => onInstall(s.fonts[k].family, s.fonts[k].weight))}>모두 설치</button></div>
      )}
      <section className="set">
        <h4>폰트</h4>
        <FontPicker label="자막" hint="나레이션 자막·썸네일 보조 문구" value={s.fonts.sub} installed={installed}
          busy={installing[`${s.fonts.sub.family}|${s.fonts.sub.weight}`]}
          onChange={(v) => set('fonts.sub', v)} onInstall={onInstall} />
        <FontPicker label="제목" hint="타이틀·챕터·엔딩 카드, 썸네일 헤드라인" value={s.fonts.title} installed={installed}
          busy={installing[`${s.fonts.title.family}|${s.fonts.title.weight}`]}
          onChange={(v) => set('fonts.title', v)} onInstall={onInstall} />
      </section>

      <section className="set">
        <h4>색상</h4>
        <div className="colors">
          {[['text', '본문'], ['accent', '강조'], ['outline', '외곽선·그림자']].map(([k, n]) => (
            <label key={k} className="colorf"><input type="color" value={s.colors[k]} onChange={(e) => set(`colors.${k}`, e.target.value.toUpperCase())} />
              <span>{n}<code>{s.colors[k]}</code></span></label>
          ))}
        </div>
        <div className="chips">
          {PRESETS.map(([n, c]) => (
            <button key={n} className="chip" onClick={() => set('colors', c)}>
              <i style={{ background: c.accent }} />{n}
            </button>
          ))}
        </div>
      </section>

      <section className="set">
        <h4>나레이션 자막</h4>
        <div className="sliders two">
          {[['size', '크기', 44, 110, 1], ['outline', '외곽선', 0, 12, 0.5], ['shadow', '그림자', 0, 10, 0.5], ['marginV', '아래 여백', 80, 520, 5], ['maxChars', '줄바꿈 기준(자)', 16, 44, 1]].map(([k, n, a, b, st]) => (
            <label key={k} className="field"><span>{n} <b>{s.sub[k]}</b></span>
              <input type="range" min={a} max={b} step={st} value={s.sub[k]} onChange={(e) => set(`sub.${k}`, +e.target.value)} /></label>
          ))}
        </div>
        <p className="hint">값은 2560×1440 기준입니다. 미리보기는 최종본과 같은 비율로 그려집니다. 정확한 결과는 `🎞 실제 렌더 확인`으로.</p>
      </section>

      <section className="set">
        <h4>강조 키워드 <small className="muted">자막에서 강조색으로 표시</small></h4>
        <textarea rows={3} value={kw} onChange={(e) => setKw(e.target.value)}
          onBlur={() => set('keywords', kw.split(',').map((x) => x.trim()).filter(Boolean))} />
        <div className="row-end">
          <button className="ghost" onClick={() => { set('keywords', null); setKw(KEYWORDS.join(', ')); }}>기본값으로</button>
        </div>
      </section>
    </div>
  );
}
