// 편집 영상 = 구간 목록. 구간마다 원본 파일을 따로 둘 수 있어 여러 촬영본을 이어 붙인다.
//   meta.segs[i] = [원본 시작, 원본 끝, 원본 파일?]  — 파일이 없으면 영상의 기본 원본(meta.src)
//   (이전 형식 [시작, 끝]과 그대로 호환. 길이 계산은 앞의 두 값만 쓴다)
// 화면 비율이 다른 촬영본은 16:9 프레임 안에 레터박스로 맞춘다 (미리보기·렌더·내보내기 공통)
export const segFile = (meta, seg) => (seg && seg[2]) || meta?.src || '';
export const clipFiles = (meta) => [...new Set((meta?.segs || []).map((g) => segFile(meta, g)).filter(Boolean))];
export const baseName = (f = '') => String(f).split(/[\\/]/).pop();

// 편집본 시각 → { i: 구간 번호, seg, t: 원본 시각 }. 엔딩 카드 구간이면 null
export function locateSeg(segs = [], t) {
  let off = 0;
  for (let i = 0; i < segs.length; i++) {
    const [s, e] = segs[i]; const d = e - s;
    if (t < off + d - 1e-6) return { i, seg: segs[i], t: s + Math.max(0, t - off) };
    off += d;
  }
  return null;
}

// 저장 형식으로: 기본 원본(첫 구간의 파일)과 같은 파일이면 세 번째 값을 생략
export function packSegs(rows) {
  const src = rows[0]?.file || '';
  return { src, segs: rows.map((r) => (r.file && r.file !== src ? [r.s, r.e, r.file] : [r.s, r.e])) };
}

// 16:9 프레임에 레터박스로 맞추는 ffmpeg 필터
export const fitFilter = (w, h, flags = '') => `scale=${w}:${h}:force_original_aspect_ratio=decrease${flags ? `:flags=${flags}` : ''},pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
