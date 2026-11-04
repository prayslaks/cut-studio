// 나레이션 트랙 모델 — 미리보기(React)·서버·내보내기가 공유.
// 트랙 목록은 프로젝트 공통(script.tracks), 대사는 영상별 배열(script[영상키])에 그대로 두고 l.track으로 구분.
//   기본 트랙(MAIN): 보이스·설정·발음 사전을 예전처럼 최상위(script.voice / voice_settings / pronunciation)에 둠 (이전 형식 호환)
//   추가 트랙: { id, name, voice, voice_settings, pronunciation }
// 내보내기 조합(script.exports): { id, name, audio: 트랙id|null, subs: 트랙id|null, suffix, audioOnly }
export const MAIN = 'main';
export const DEFAULT_VOICE = { model_id: 'eleven_v4', voice_id: '', language_code: 'ko', tone: { enabled: false, tags: '[narrator][calm]', override: true } };
export const DEFAULT_VS = { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 };

export const trackOf = (l) => l?.track || MAIN;
export const trackList = (s) => (s?.tracks?.length ? s.tracks : [{ id: MAIN, name: '기본' }]);
export const trackName = (s, tid) => trackList(s).find((t) => t.id === tid)?.name || tid;
export const trackLines = (s, k, tid) => (s?.[k] || []).filter((l) => trackOf(l) === tid);

// 트랙의 보이스·설정·발음 사전 (기본 트랙은 최상위 값)
export function trackCfg(s, tid) {
  if (tid === MAIN || !s?.tracks?.some((t) => t.id === tid)) {
    return { voice: s?.voice || DEFAULT_VOICE, voice_settings: s?.voice_settings || DEFAULT_VS, pronunciation: s?.pronunciation || [] };
  }
  const t = s.tracks.find((x) => x.id === tid);
  return { voice: t.voice || DEFAULT_VOICE, voice_settings: t.voice_settings || DEFAULT_VS, pronunciation: t.pronunciation || [] };
}

// 트랙 설정 한 항목(voice | voice_settings | pronunciation)을 바꾼 새 script
export function patchTrackCfg(s, tid, field, fn) {
  if (tid === MAIN) return { ...s, [field]: fn(s[field]) };
  return { ...s, tracks: s.tracks.map((t) => (t.id === tid ? { ...t, [field]: fn(trackCfg(s, tid)[field]) } : t)) };
}

// 대사 id 접두어: 기본 트랙 "A01", 추가 트랙 "A_en01"
export const linePrefix = (k, tid) => (tid === MAIN ? k : `${k}_${tid}`);
export function nextLineId(s, k, tid) {
  const pre = linePrefix(k, tid);
  const nums = (s?.[k] || []).map((l) => (l.id.startsWith(pre) ? /^(\d+)$/.exec(l.id.slice(pre.length))?.[1] : null)).filter(Boolean).map(Number);
  return `${pre}${String(Math.max(0, ...nums) + 1).padStart(2, '0')}`;
}

// 저장된 조합이 없으면 트랙마다 하나 (첫 트랙은 파일명 접미사 없음 = 예전 파일명)
export function exportCombos(s) {
  if (s?.exports?.length) return s.exports;
  return trackList(s).map((t, i) => ({ id: t.id, name: t.name, audio: t.id, subs: t.id, suffix: i === 0 ? '' : `_${t.name}`, audioOnly: false }));
}

export function applyDict(text, rules = []) {
  let out = text || '';
  [...rules].filter((r) => r.from).sort((a, b) => b.from.length - a.from.length).forEach((r) => { out = out.split(r.from).join(r.to ?? ''); });
  return out;
}
