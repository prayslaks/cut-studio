import { DEFAULT_VOICE, DEFAULT_VS, trackCfg, trackList } from './tracks.js';

export function createVoiceProfile(id, name, { voice, voice_settings } = {}) {
  return {
    id,
    name,
    voice: { ...DEFAULT_VOICE, ...voice, tone: { ...DEFAULT_VOICE.tone, ...voice?.tone } },
    voice_settings: { ...DEFAULT_VS, ...voice_settings },
  };
}

const unassigned = createVoiceProfile('', '미지정');

// 기존 트랙별 설정으로 프로젝트 보이스와 트랙 기본값을 구성한다.
export function migrateVoiceProfiles(script) {
  if (Array.isArray(script.voiceProfiles)) return script;
  const voiceProfiles = trackList(script).map((track) =>
    createVoiceProfile(`legacy-${track.id}`, `${track.name} 보이스`, trackCfg(script, track.id)));
  const trackVoices = Object.fromEntries(trackList(script).map((track, i) => [track.id, voiceProfiles[i].id]));
  return { ...script, voiceProfiles, trackVoices };
}

export function resolveVoiceProfile(script, track, overrideId) {
  const profiles = script?.voiceProfiles || [];
  return profiles.find((profile) => profile.id === overrideId)
    || profiles.find((profile) => profile.id === script?.trackVoices?.[track])
    || unassigned;
}

// 기존 모델별 TTS 요청 형식을 보이스 편집기와 생성 경로에서 공유한다.
export function modelCaps(id = '') {
  if (id.startsWith('eleven_v4')) return { keys: ['stability', 'similarity_boost'], lang: true, tags: true };
  if (id.startsWith('eleven_v3')) return { keys: ['stability', 'similarity_boost', 'use_speaker_boost'], lang: true, tags: true };
  if (id === 'eleven_multilingual_v2') return { keys: ['stability', 'similarity_boost', 'style', 'use_speaker_boost', 'speed'], lang: false, tags: false };
  return { keys: ['stability', 'similarity_boost', 'style', 'use_speaker_boost', 'speed'], lang: true, tags: false };
}

export const toneOf = (voice) => voice.tone?.enabled && modelCaps(voice.model_id).tags
  ? (voice.tone.tags?.match(/\[[^\]]+\]/g) || []).join('')
  : '';

export function withTone(text, voice) {
  const tags = toneOf(voice);
  return tags && text.trim() && !(voice.tone.override && /^\s*\[/.test(text)) ? `${tags} ${text}` : text;
}
