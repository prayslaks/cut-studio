// 편집본 타임라인 <-> 원본 영상 시간 변환 (build.py와 동일 규칙)
export function buildTimeline(segs = [], endCard = 4) {
  let t = 0;
  const parts = segs.map(([s, e], i) => {
    const g = { i, s, e, off: t, dur: e - s };
    t += e - s;
    return g;
  });
  return { parts, body: t, total: t + endCard };
}

export function editToSrc(tl, t) {
  for (const g of tl.parts) if (t < g.off + g.dur - 1e-6) return { src: g.s + Math.max(0, t - g.off), seg: g.i };
  return null; // 엔딩 카드 구간
}

export function srcToEdit(tl, s) {
  for (const g of tl.parts) if (s >= g.s - 0.05 && s < g.e) return g.off + Math.max(0, s - g.s);
  return null; // 잘려나간 구간
}

export const fmt = (t) => {
  if (t == null || Number.isNaN(t)) return '--:--';
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
};

export const estDur = (text) => Math.max(2, (text || '').length / 7);
export const SUB_TAIL = 0.35; // 자막이 음성보다 늦게 사라지는 시간 (build.py와 동일)
