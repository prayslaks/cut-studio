// 영상 카드(인트로·챕터·엔딩) 모델 — 미리보기(React)·편집기·내보내기(ASS)가 공유.
// 좌표는 2560x1440 프레임 기준. 레이어 모델은 썸네일과 같음(text/rect/grad) + anim.
//   anim: { delay(초), dx, dy(시작 위치 오프셋, px), dur(이동 시간), fade(카드 페이드 적용, 기본 true) }
//   text.alpha: 텍스트 불투명도
// 스타일 연동 토큰: color '@text' | '@accent' | '@outline', font '@title' | '@sub'
// 텍스트 변수: 챕터 {num} {kr} {en}, 공통 {date} {title}
import { lid } from './thumbLayers.js';

export const CW = 2560, CH = 1440;
export const CARD_KINDS = [['intro', '인트로'], ['chapter', '챕터'], ['end', '엔딩']];
export const CARD_VARS = { intro: ['{date}', '{title}'], chapter: ['{num}', '{kr}', '{en}', '{date}', '{title}'], end: ['{date}', '{title}'] };
export const COLOR_TOKENS = [['@text', '본문'], ['@accent', '강조'], ['@outline', '어두운']];
export const FONT_TOKENS = [['@title', '제목 폰트'], ['@sub', '자막 폰트']];

const T = (o) => ({ id: lid('T'), type: 'text', text: '텍스트', x: CW / 2, y: CH / 2, anchor: 7, size: 120, color: '@text', font: '@title',
  outline: { width: 0, color: '@outline' }, shadow: { dist: 0, color: '@outline', alpha: 1 }, spacing: 0, alpha: 1, visible: true,
  anim: { delay: 0, dx: 0, dy: 0, dur: 0.4, fade: true }, ...o });
const Rc = (o) => ({ id: lid('R'), type: 'rect', x: 0, y: 0, w: CW, h: CH, color: '@outline', alpha: 0.6, blur: 0, visible: true,
  anim: { delay: 0, dx: 0, dy: 0, dur: 0.4, fade: true }, ...o });
const A = (delay = 0, dx = 0, dur = 0.4) => ({ delay, dx, dy: 0, dur, fade: true });

export const newCardText = (o) => T(o);
export const newCardRect = (o) => Rc({ x: 200, y: 200, w: 800, h: 300, ...o });
export const newCardGrad = (o) => ({ id: lid('G'), type: 'grad', x: 0, y: 0, w: 1400, h: CH, color: '@outline', from: 0.8, to: 0, dir: 'right', visible: true,
  anim: { delay: 0, dx: 0, dy: 0, dur: 0.4, fade: true }, ...o });

// 기본 카드 (기존 고정 레이아웃과 동일한 결과)
export function defaultCards(meta = {}) {
  const end = meta.end || ['', ''];
  return {
    intro: {
      enabled: true, start: 0.3, dur: 5.3, fadeIn: 0.5, fadeOut: 0.6,
      layers: [
        Rc({ role: 'dim', alpha: +(1 - 0x70 / 255).toFixed(3) }),
        T({ role: 'brand', text: 'PROJECT ZK', x: 76, y: 40, size: 300, spacing: -8, shadow: { dist: 6, color: '@outline', alpha: 1 }, anim: A(0, -36, 0.5) }),
        T({ text: '{date}', x: 76, y: 1020, size: 80, shadow: { dist: 4, color: '@outline', alpha: 1 }, anim: A(0.2) }),
        T({ text: '탑뷰 공중 액션', x: 76, y: 1126, size: 112, color: '@accent', shadow: { dist: 4, color: '@outline', alpha: 1 }, anim: A(0.35) }),
        T({ text: '{title} 플레이 영상', x: 76, y: 1268, size: 80, shadow: { dist: 4, color: '@outline', alpha: 1 }, anim: A(0.5) }),
      ],
    },
    chapter: {
      enabled: true, firstOffset: 6.0, offset: 0.5, dur: 4.5, fadeIn: 0.3, fadeOut: 0.45,
      layers: [
        Rc({ role: 'backdrop', x: 40, y: 500, w: 1150, h: 300, alpha: +(1 - 0x60 / 255).toFixed(3), blur: 40 }),
        Rc({ role: 'bar', x: 110, y: 540, w: 14, h: 220, color: '@accent', alpha: 1 }),
        T({ text: 'CHAPTER {num}', x: 155, y: 535, size: 60, color: '@accent', anim: A(0.1, -45) }),
        T({ text: '{kr}', x: 155, y: 600, size: 120, anim: A(0.2, -45) }),
        T({ text: '{en}', x: 155, y: 738, size: 44, spacing: 6, alpha: +(1 - 0x40 / 255).toFixed(3), anim: A(0.3, -45) }),
      ],
    },
    end: {
      enabled: true, fadeIn: 0.5, fadeOut: 0.5,
      layers: [
        Rc({ role: 'bg', alpha: 1, anim: { delay: 0, dx: 0, dy: 0, dur: 0.4, fade: false } }),
        T({ text: 'PROJECT ZK', x: 1280, y: 560, anchor: 5, size: 260, spacing: -6, anim: A(0.2) }),
        T({ text: end[0] || '', x: 1280, y: 760, anchor: 5, size: 56, spacing: 10, color: '@accent', anim: A(0.4) }),
        T({ text: end[1] || '', x: 1280, y: 860, anchor: 5, size: 64, anim: A(0.5) }),
      ],
    },
  };
}

// 저장된 카드 + 기본값 병합 (없는 카드는 기본값)
export function resolveCards(meta = {}) {
  const def = defaultCards(meta); const c = meta.cards || {};
  const out = {};
  for (const [k] of CARD_KINDS) out[k] = c[k] ? { ...def[k], ...c[k], layers: Array.isArray(c[k].layers) ? c[k].layers : def[k].layers } : def[k];
  return out;
}

// 타임라인 위 카드 인스턴스 [{ kind, idx, a, b, card, vars }]
export function cardInstances(cards, { meta = {}, offs = [], body, total }) {
  const base = { date: meta.date || '', title: meta.title || '' };
  const out = [];
  const ci = cards.intro;
  if (ci?.enabled) out.push({ kind: 'intro', idx: 0, a: ci.start, b: Math.min(ci.start + ci.dur, body), card: ci, vars: base });
  const cc = cards.chapter;
  if (cc?.enabled) (meta.chapters || []).forEach((c, i) => {
    const a = (offs[i] ?? 0) + (i === 0 ? cc.firstOffset : cc.offset);
    out.push({ kind: 'chapter', idx: i, a, b: a + cc.dur, card: cc, vars: { ...base, num: c.num ?? '', kr: c.kr ?? '', en: c.en ?? '' } });
  });
  const ce = cards.end;
  if (ce?.enabled && total > body) out.push({ kind: 'end', idx: 0, a: body, b: total, card: ce, vars: base });
  return out;
}

// 편집기에서 해당 카드를 확인하기 좋은 시각 (모든 레이어 등장 완료 지점)
export function cardFocusTime(inst) {
  const settle = Math.max(0, ...inst.card.layers.map((l) => (l.anim?.delay || 0) + Math.max(l.anim?.dur || 0, inst.card.fadeIn || 0)));
  return Math.min(inst.b - 0.05, inst.a + settle + 0.1);
}

// 토큰·변수 해석 → 썸네일 렌더러가 그대로 쓰는 레이어
const subVars = (s, vars) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
export function resolveLayer(l, st, vars = {}) {
  const C = st?.colors || { text: '#FFFFFF', accent: '#DCF884', outline: '#080C0F' };
  const col = (c) => (c === '@text' ? C.text : c === '@accent' ? C.accent : c === '@outline' ? C.outline : c || '#FFFFFF');
  const r = { ...l, color: col(l.color) };
  if (l.type === 'text') {
    r.text = subVars(l.text, vars);
    r.font = l.font === '@sub' ? st?.fonts?.sub : l.font === '@title' || !l.font ? st?.fonts?.title : l.font;
    r.outline = { ...(l.outline || {}), color: col(l.outline?.color || '@outline') };
    r.shadow = { ...(l.shadow || {}), color: col(l.shadow?.color || '@outline') };
  }
  return r;
}

// ---------- ASS ----------
const ts = (t) => {
  t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};
const assColor = (hex = '#FFFFFF') => { const h = String(hex).replace('#', '').padEnd(6, '0'); return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase(); };
const assA = (op = 1) => `&H${Math.round((1 - Math.max(0, Math.min(1, op))) * 255).toString(16).padStart(2, '0').toUpperCase()}&`;
const esc = (s) => String(s ?? '').replace(/[{}\\]/g, '').replace(/\r?\n/g, '\\N');
const R = (n) => Math.round(n * 10) / 10;
const shape = (x, y, w, h) => `m ${R(x)} ${R(y)} l ${R(x + w)} ${R(y)} ${R(x + w)} ${R(y + h)} ${R(x)} ${R(y + h)}`;
const msec = (s) => Math.round((s || 0) * 1000);

// inst → Dialogue 줄들. fontOf(font{family,weight,source}) → { name, bold }. layerBase: ASS Layer 시작 번호
export function cardAss(inst, st, fontOf, layerBase = 0) {
  const { card } = inst; let o = '';
  const ev = (li, a, text) => { o += `Dialogue: ${layerBase + li},${ts(a)},${ts(inst.b)},Card,,0,0,0,,${text}\n`; };
  card.layers.forEach((raw, li) => {
    if (raw.visible === false) return;
    const l = resolveLayer(raw, st, inst.vars);
    const an = l.anim || {}; const a = inst.a + (an.delay || 0);
    if (a >= inst.b) return;
    const fx = an.fade === false ? '' : `\\fad(${msec(card.fadeIn)},${msec(card.fadeOut)})`;
    const mv = (x, y) => (an.dx || an.dy ? `\\move(${R(x + (an.dx || 0))},${R(y + (an.dy || 0))},${R(x)},${R(y)},0,${msec(an.dur || 0.4)})` : `\\pos(${R(x)},${R(y)})`);
    if (l.type === 'rect') {
      ev(li, a, `{\\an7${mv(0, 0)}\\p1\\bord0\\shad0\\c${assColor(l.color)}\\alpha${assA(l.alpha ?? 1)}${l.blur ? `\\blur${l.blur}` : ''}${fx}}${shape(l.x, l.y, l.w, l.h)}`);
    } else if (l.type === 'grad') {
      const steps = 24; const horiz = l.dir === 'right' || l.dir === 'left';
      for (let i = 0; i < steps; i++) {
        const k = (i + 0.5) / steps; const p = l.dir === 'right' || l.dir === 'down' ? k : 1 - k;
        const op = l.from + (l.to - l.from) * p;
        const seg = horiz ? [l.x + (l.w * i) / steps, l.y, l.w / steps + 1, l.h] : [l.x, l.y + (l.h * i) / steps, l.w, l.h / steps + 1];
        ev(li, a, `{\\an7${mv(0, 0)}\\p1\\bord0\\shad0\\c${assColor(l.color)}\\alpha${assA(op)}\\blur2${fx}}${shape(...seg)}`);
      }
    } else if (l.type === 'text' && String(l.text || '').trim()) {
      const f = fontOf(l.font || {}); const sh = l.shadow || {}; const ol = l.outline || {}; const ta = l.alpha ?? 1;
      ev(li, a, `{\\an${l.anchor || 7}${mv(l.x, l.y)}\\fn${f.name}\\b${f.bold ? 1 : 0}\\fs${R(l.size)}${l.spacing ? `\\fsp${R(l.spacing)}` : ''}`
        + `\\c${assColor(l.color)}\\3c${assColor(ol.color)}\\4c${assColor(sh.color)}\\1a${assA(ta)}\\3a${assA(ta)}\\4a${assA((sh.alpha ?? 1) * ta)}`
        + `\\bord${R(ol.width || 0)}\\shad${R(sh.dist || 0)}${fx}}${esc(l.text)}`);
    }
  });
  return o;
}

// 미리보기용: 시각 t에서 레이어의 불투명도 배수·이동 오프셋
const clamp01 = (v) => Math.max(0, Math.min(1, v));
export function layerState(inst, l, t) {
  const an = l.anim || {}; const a = inst.a + (an.delay || 0), b = inst.b; const c = inst.card;
  if (t < a || t >= b) return null;
  const op = an.fade === false ? 1 : clamp01(Math.min((t - a) / Math.max(0.001, c.fadeIn || 0.001), (b - t) / Math.max(0.001, c.fadeOut || 0.001)));
  const p = clamp01((t - a) / Math.max(0.001, an.dur || 0.4));
  return { op, dx: (an.dx || 0) * (1 - p), dy: (an.dy || 0) * (1 - p) };
}

// 썸네일 레이어(1280x720) → 카드 레이어(2560x1440). 스타일과 같은 색·폰트는 연동 토큰으로 바꿈
export function cardLayersFromThumb(layers = [], st) {
  const k = CW / 1280;
  const C = st?.colors || {}; const F = st?.fonts || {};
  const tokC = (c) => { const u = String(c || '').toUpperCase(); return u === String(C.text).toUpperCase() ? '@text' : u === String(C.accent).toUpperCase() ? '@accent' : u === String(C.outline).toUpperCase() ? '@outline' : c; };
  const tokF = (f) => (!f ? '@title' : f.family === F.title?.family && f.weight === F.title?.weight ? '@title' : f.family === F.sub?.family && f.weight === F.sub?.weight ? '@sub' : f);
  let ti = 0;
  return layers.filter((l) => l.visible !== false).map((l) => {
    const base = { ...JSON.parse(JSON.stringify(l)), x: Math.round(l.x * k), y: Math.round(l.y * k) };
    if (l.type === 'text') {
      return { ...base, id: lid('T'), size: Math.round(l.size * k), spacing: (l.spacing || 0) * k, color: tokC(l.color), font: tokF(l.font), alpha: l.alpha ?? 1,
        outline: { width: (l.outline?.width || 0) * k, color: tokC(l.outline?.color || C.outline) },
        shadow: { dist: (l.shadow?.dist || 0) * k, color: tokC(l.shadow?.color || C.outline), alpha: l.shadow?.alpha ?? 1 },
        anim: { delay: +(0.15 * ti++).toFixed(2), dx: ti === 1 ? -36 : 0, dy: 0, dur: 0.5, fade: true } };
    }
    return { ...base, id: lid(l.type === 'grad' ? 'G' : 'R'), w: Math.round(l.w * k), h: Math.round(l.h * k), color: tokC(l.color),
      ...(l.blur ? { blur: l.blur * k } : {}), anim: { delay: 0, dx: 0, dy: 0, dur: 0.4, fade: true } };
  });
}
