// 썸네일 레이어 모델 (편집기 캔버스와 서버 렌더가 공유). 좌표는 1280x720 기준.
// text  : { id, type:'text', text, x, y, anchor(1~9, ASS \an), font:{family,weight}, size(=ASS fs, 줄높이), color,
//           outline:{width,color}, shadow:{dist,color,alpha}, spacing, visible }
// rect  : { id, type:'rect', x, y, w, h, color, alpha(불투명도), blur }
// grad  : { id, type:'grad', x, y, w, h, color, from, to(불투명도), dir:'right'|'left'|'down'|'up' }
export const TW = 1280, TH = 720;

export const TEMPLATES = {
  magazine: { label: '매거진', desc: '왼쪽 위 큰 브랜드 문구, 왼쪽 아래에 날짜·강조색 키워드·부제. 왼쪽이 어둡게 깔림' },
  impact: { label: '임팩트', desc: '화면 하단 중앙에 아주 큰 라임색 키워드, 그 아래 부제. 브랜드는 왼쪽 위 작게. 하단이 어둡게 깔림' },
  split: { label: '스플릿', desc: '오른쪽 40%에 어두운 패널, 오른쪽 정렬로 브랜드·키워드·부제. 왼쪽 60%에 장면 주인공을 배치' },
  minimal: { label: '미니멀', desc: '장면을 크게 살리고 왼쪽 아래에 라임 바 + 키워드 + 작은 브랜드만' },
};

let seq = 0;
export const lid = (p = 'L') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

// anchor → CSS translate 비율, ASS와 동일 (7 8 9 / 4 5 6 / 1 2 3)
export const anchorXY = (an = 7) => ({ ax: [0, 0.5, 1][(an - 1) % 3], ay: an >= 7 ? 0 : an >= 4 ? 0.5 : 1 });

export function textLayer(o) {
  return { id: lid('T'), type: 'text', text: '텍스트', x: 640, y: 360, anchor: 5, size: 80, color: '#FFFFFF',
    outline: { width: 0, color: '#080C0F' }, shadow: { dist: 4, color: '#080C0F', alpha: 1 }, spacing: 0, visible: true, ...o };
}
export const rectLayer = (o) => ({ id: lid('R'), type: 'rect', x: 80, y: 80, w: 400, h: 200, color: '#080C0F', alpha: 0.6, blur: 0, visible: true, ...o });
export const gradLayer = (o) => ({ id: lid('G'), type: 'grad', x: 0, y: 0, w: 860, h: TH, color: '#080C0F', from: 0.82, to: 0, dir: 'right', visible: true, ...o });

// style: resolveStyle 결과(색·폰트). f: { title, kicker, sub, badge }
export function templateLayers(tpl, f, style) {
  const C = style?.colors || { text: '#FFFFFF', accent: '#DCF884', outline: '#080C0F' };
  const FT = { family: style?.fonts?.title?.family || 'Noto Sans KR', weight: style?.fonts?.title?.weight || 900, source: style?.fonts?.title?.source };
  const FS = { family: style?.fonts?.sub?.family || 'Noto Sans KR', weight: style?.fonts?.sub?.weight || 700, source: style?.fonts?.sub?.source };
  const sh = (d) => ({ dist: d, color: C.outline, alpha: 1 });
  const T = (role, text, o) => (text ? [textLayer({ role, text, color: C.text, shadow: sh(4), outline: { width: 0, color: C.outline }, ...o })] : []);
  const title = f.title ?? '';
  switch (tpl) {
    case 'impact': return [
      gradLayer({ x: 0, y: 330, w: TW, h: TH - 330, from: 0.92, to: 0, dir: 'up', color: C.outline }),
      ...T('title', title, { x: 36, y: 28, anchor: 7, size: 72, font: FT, shadow: sh(3) }),
      ...T('badge', f.badge, { x: TW - 36, y: 34, anchor: 9, size: 40, font: FS, shadow: sh(2) }),
      ...T('kicker', f.kicker, { x: TW / 2, y: 560, anchor: 5, size: 168, font: FT, color: C.accent, outline: { width: 7, color: C.outline }, shadow: sh(6), spacing: -2 }),
      ...T('sub', f.sub, { x: TW / 2, y: 662, anchor: 5, size: 52, font: FS, outline: { width: 3, color: C.outline }, shadow: sh(2) }),
    ];
    case 'split': return [
      rectLayer({ x: 760, y: -40, w: 600, h: TH + 80, color: C.outline, alpha: 0.81, blur: 20 }),
      gradLayer({ x: 560, y: 0, w: 220, h: TH, from: 0, to: 0.8, dir: 'right', color: C.outline }),
      rectLayer({ role: 'bar', x: 1236, y: 300, w: 8, h: 210, color: C.accent, alpha: 1 }),
      ...T('title', title, { x: TW - 44, y: 48, anchor: 9, size: 122, font: FT, spacing: -3 }),
      ...T('kicker', f.kicker, { x: TW - 64, y: 300, anchor: 9, size: 104, font: FT, color: C.accent }),
      ...T('sub', f.sub, { x: TW - 64, y: 450, anchor: 9, size: 50, font: FS, shadow: sh(2) }),
      ...T('badge', f.badge, { x: TW - 44, y: TH - 40, anchor: 3, size: 42, font: FS, shadow: sh(2) }),
    ];
    case 'minimal': return [
      gradLayer({ x: 0, y: 470, w: TW, h: TH - 470, from: 0.7, to: 0, dir: 'up', color: C.outline }),
      rectLayer({ role: 'bar', x: 40, y: 560, w: 10, h: 120, color: C.accent, alpha: 1 }),
      ...T('kicker', f.kicker, { x: 70, y: 548, anchor: 7, size: 104, font: FT }),
      ...T('title', `${title}${f.sub ? `  ·  ${f.sub}` : ''}`, { x: 72, y: 664, anchor: 7, size: 44, font: FS, color: C.accent, shadow: sh(2) }),
    ];
    default: return [ // magazine
      gradLayer({ x: 0, y: 0, w: 860, h: TH, from: 0.82, to: 0, dir: 'right', color: C.outline }),
      gradLayer({ x: 0, y: 0, w: TW, h: 250, from: 0.45, to: 0, dir: 'down', color: C.outline }),
      ...T('title', title, { x: 38, y: 22, anchor: 7, size: 200, font: FT, spacing: -5, shadow: sh(6) }),
      ...T('badge', f.badge, { x: 40, y: 486, anchor: 7, size: 58, font: FS, shadow: sh(3) }),
      ...T('kicker', f.kicker, { x: 38, y: 552, anchor: 7, size: 90, font: FT, color: C.accent }),
      ...T('sub', f.sub, { x: 40, y: 640, anchor: 7, size: 58, font: FS, shadow: sh(3) }),
    ];
  }
}

// 초안의 대표 문구 (목록·파일명용)
export const draftLabel = (d) => d.layers?.find((l) => l.role === 'kicker')?.text || d.layers?.find((l) => l.type === 'text')?.text || d.kicker || '썸네일';
