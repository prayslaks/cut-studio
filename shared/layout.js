// 미리보기(React)와 내보내기(export.mjs/ASS)가 함께 쓰는 자막·카드 레이아웃 정의.
// 모든 좌표/크기는 2560x1440 프레임 기준 픽셀이며, fs는 ASS Fontsize(= 줄 높이) 값이다.
export const FRAME = { W: 2560, H: 1440 };
export const COLORS = { lime: '#DCF884', white: '#FFFFFF', dark: '#080C0F' };

// ---- 스타일 (자막 탭에서 편집, script.json의 style) ----
export const DEFAULT_STYLE = {
  fonts: {
    sub: { family: 'Noto Sans KR', weight: 700 },   // 나레이션 자막
    title: { family: 'Noto Sans KR', weight: 900 }, // 타이틀·챕터·엔딩 카드, 썸네일 헤드라인
  },
  colors: { text: '#FFFFFF', accent: '#DCF884', outline: '#080C0F' },
  sub: { size: 68, outline: 5, shadow: 3, marginV: 275, maxChars: 30 },
  cards: { scale: 1 },
  keywords: null, // null이면 기본 키워드
};
// 스타일 해석: 기본값 병합 + 렌더용 이름. fontsMap: { 'family|weight': { name, bold } } (설치된 폰트의 실제 이름)
export function resolveStyle(style = {}, fontsMap = {}, fallbackFont = 'Malgun Gothic') {
  const st = {
    fonts: { sub: { ...DEFAULT_STYLE.fonts.sub, ...(style.fonts?.sub || {}) }, title: { ...DEFAULT_STYLE.fonts.title, ...(style.fonts?.title || {}) } },
    colors: { ...DEFAULT_STYLE.colors, ...(style.colors || {}) },
    sub: { ...DEFAULT_STYLE.sub, ...(style.sub || {}) },
    cards: { ...DEFAULT_STYLE.cards, ...(style.cards || {}) },
    keywords: Array.isArray(style.keywords) ? style.keywords : KEYWORDS,
  };
  const face = (f) => {
    const hit = fontsMap[`${f.family}|${f.weight}`];
    if (hit) return { ...f, name: hit.name, bold: hit.bold, ratio: hit.ratio, installed: true };
    // 시스템 폰트는 이름 그대로, 설치 안 된 Google 폰트는 대체 폰트로 렌더
    if (f.source === 'system') return { ...f, name: f.family, bold: (f.weight || 700) >= 600, installed: true };
    return { ...f, name: fallbackFont, bold: (f.weight || 700) >= 600, installed: false };
  };
  st.face = { sub: face(st.fonts.sub), title: face(st.fonts.title) };
  return st;
}
export const SUB_TAIL = 0.35; // 자막이 음성보다 늦게 사라지는 시간
export const KEYWORDS = []; // 강조 키워드 기본값 (프로젝트별로 자막 스타일 탭에서 지정)

// 나레이션 자막 스타일 (ASS Style: Sub)
export const SUB = { fs: 68, marginV: 275, marginH: 200, outline: 5, shadow: 3, shadowAlpha: 0.5, maxChars: 30 };

// 타이틀·챕터·엔딩 카드는 shared/cards.js (편집 가능한 레이어 모델)

// 자막 줄바꿈: 30자 초과 시 가운데에 가까운 공백(문장부호 뒤 우선)에서 한 번 끊음
export function wrapLines(text, maxc = SUB.maxChars) {
  maxc = maxc || SUB.maxChars;
  if (text.length <= maxc) return [text];
  const mid = text.length / 2; let best = null; const re = /[.,] |\s/g; let m;
  while ((m = re.exec(text))) {
    const i = m.index + m[0].length; const score = Math.abs(i - mid) - (/[.,]/.test(m[0]) ? 14 : 0);
    if (!best || score < best[0]) best = [score, i];
  }
  if (!best) return [text];
  return [text.slice(0, best[1]).trimEnd(), text.slice(best[1]).trimStart()];
}

// 키워드 강조 구간 분할 → [{ t, hl }]
export function highlightParts(text, keywords = KEYWORDS) {
  const kw = (keywords || []).filter(Boolean);
  if (!kw.length) return [{ t: text, hl: false }];
  const re = new RegExp(`(${[...kw].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return text.split(re).filter(Boolean).map((t) => ({ t, hl: kw.includes(t) }));
}
