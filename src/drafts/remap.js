// 대사 재배치: 편집 영상의 구성(구간)이 바뀌면 대사 시작 시각(편집본 기준)이 화면과 어긋난다.
// 각 대사를 '원본 파일 + 원본 시각'으로 바꿔 새 구성에서 같은 장면이 나오는 편집본 시각을 찾는다.
import { locateSeg, segFile } from '../../shared/clips.js';

const r1 = (v) => Math.round(v * 10) / 10;
const body = (segs = []) => segs.reduce((n, [a, b]) => n + (b - a), 0);
export const compKey = (meta) => JSON.stringify((meta?.segs || []).map((g) => [g[0], g[1], segFile(meta, g)]));

// → [{ l, to, kind }]  kind: 'move'(새 위치) | 'gone'(그 장면이 새 구성에 없음) | 'end'(엔딩 카드 구간, 끝 기준 유지). 위치가 같은 대사는 빠짐
export function remapLines(oldMeta, newMeta, lines) {
  const oldBody = body(oldMeta?.segs); const newBody = body(newMeta?.segs);
  const offs = []; let t = 0; for (const [a, b] of newMeta?.segs || []) { offs.push(t); t += b - a; }
  const out = [];
  for (const l of lines) {
    let to = null; let kind = 'gone';
    if (l.start >= oldBody) { to = r1(newBody + (l.start - oldBody)); kind = 'end'; }
    else {
      const loc = locateSeg(oldMeta.segs, l.start);
      if (loc) {
        const file = segFile(oldMeta, loc.seg);
        // 같은 장면이 여러 구간에 있으면 원래 위치에 가장 가까운 곳
        (newMeta.segs || []).forEach((g, i) => {
          if (segFile(newMeta, g) !== file || loc.t < g[0] - 1e-6 || loc.t >= g[1]) return;
          const c = offs[i] + (loc.t - g[0]);
          if (to == null || Math.abs(c - l.start) < Math.abs(to - l.start)) to = c;
        });
        if (to != null) { to = r1(to); kind = 'move'; }
      }
    }
    if (kind === 'gone' || Math.abs(to - l.start) >= 0.05) out.push({ l, to, kind });
  }
  return out;
}
