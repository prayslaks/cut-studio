import { modelCaps, withTone } from '../shared/voices.js';

const TONE_PRESETS = [
  ['나레이션', '[narrator]'], ['차분한', '[calm]'], ['자신감 있는', '[confident]'], ['진지한', '[serious]'],
  ['따뜻한', '[warm]'], ['또렷한', '[clear articulation]'], ['다큐멘터리', '[documentary style]'], ['활기찬', '[energetic]'],
  ['긴박한', '[tense]'], ['천천히', '[slow pace]'],
];
const parseTags = (s = '') => s.match(/\[[^\]]+\]/g) || [];

export default function VoicePanel({
  tracks, track, onTrackChange, profiles, defaultId, onDefaultChange, selectedId, onSelect, onAdd, onEdit, onRemove, inUse,
  voices, models, context, setContext, rules, setRules, lines, sample,
}) {
  const profile = profiles.find((p) => p.id === selectedId) || profiles.find((p) => p.id === defaultId) || profiles[0];
  const used = profile && inUse(profile.id);
  return (
    <div className="sidescroll voice-panel">
      <section className="panel set voice-default">
        <h2>트랙 기본 보이스</h2>
        <div className="voice-fields">
          <label className="field"><span>나레이션 트랙</span>
            <select value={track} onChange={(e) => onTrackChange(e.target.value)}>
              {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="field"><span>기본 보이스</span>
            <select value={defaultId} onChange={(e) => onDefaultChange(e.target.value)}>
              <option value="">미지정</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name || '이름 없는 보이스'}</option>)}
            </select>
          </label>
        </div>
        <p className="hint">대사는 트랙의 기본 보이스로 생성합니다. 다른 목소리가 필요한 대사에서만 보이스를 변경하세요.</p>
      </section>

      <section className="panel set">
        <div className="voice-heading">
          <h2>프로젝트 보이스 <small>{profiles.length}</small></h2>
          <button className="accent sm" onClick={onAdd}>＋ 보이스 추가</button>
        </div>
        {profile ? (
          <>
            <label className="field"><span>편집할 보이스</span>
              <select value={profile.id} onChange={(e) => onSelect(e.target.value)}>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name || '이름 없는 보이스'}</option>)}
              </select>
            </label>
            <VoiceSettings profile={profile} edit={(update) => onEdit(profile.id, update)} voices={voices} models={models} sample={sample} />
            <div className="voice-heading">
              <p className="hint">{used ? '기본 보이스나 개별 대사에서 사용 중입니다.' : '모든 트랙에서 이 보이스를 선택할 수 있습니다.'}</p>
              <button className="ghost danger sm" disabled={used} onClick={() => onRemove(profile.id)}>보이스 삭제</button>
            </div>
          </>
        ) : <p className="hint">프로젝트에서 사용할 보이스를 추가하세요.</p>}
        <label className="chk" title="인접한 대사가 같은 보이스를 쓰는 경우 발음 텍스트를 함께 보냅니다">
          <input type="checkbox" checked={context} onChange={(e) => setContext(e.target.checked)} />앞뒤 문맥 연결
        </label>
      </section>

      <section className="panel set">
        <div className="voice-heading">
          <h2>발음 사전 <small>{tracks.find((t) => t.id === track)?.name} · {rules.length}개</small></h2>
          <button className="sm" onClick={() => setRules((rs) => [...rs, { from: '', to: '' }])}>＋ 규칙 추가</button>
        </div>
        <p className="hint">현재 트랙에서 발음 칸을 비워 둔 대사에 적용됩니다.</p>
        {rules.length > 0 && <div className="rules">
          {rules.map((r, i) => (
            <div key={i} className="rule">
              <input aria-label="자막 표기" value={r.from} placeholder="자막 표기" onChange={(e) => setRules((rs) => rs.map((x, j) => j === i ? { ...x, from: e.target.value } : x))} />
              <span>→</span>
              <input aria-label="읽는 법" value={r.to} placeholder="읽는 법" onChange={(e) => setRules((rs) => rs.map((x, j) => j === i ? { ...x, to: e.target.value } : x))} />
              <span className="muted">{lines.filter((l) => r.from && !l.tts?.trim() && l.text.includes(r.from)).length}줄</span>
              <button className="ghost" aria-label="발음 규칙 삭제" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>}
      </section>
    </div>
  );
}

function VoiceSettings({ profile, edit, voices, models, sample }) {
  const { voice, voice_settings: settings } = profile;
  const caps = modelCaps(voice.model_id);
  const entry = voices.find((v) => v.voice_id === voice.voice_id);
  const updateVoice = (key, value) => edit((p) => ({ ...p, voice: { ...p.voice, [key]: value } }));
  const updateSetting = (key, value) => edit((p) => ({ ...p, voice_settings: { ...p.voice_settings, [key]: value } }));
  return (
    <>
      <div className="voice-fields">
        <label className="field"><span>보이스 이름</span>
          <input value={profile.name} onChange={(e) => { const name = e.target.value; edit((p) => ({ ...p, name })); }} />
        </label>
        <label className="field"><span>ElevenLabs Voice ID</span>
          <input value={voice.voice_id} placeholder="Voice ID 직접 입력" onChange={(e) => updateVoice('voice_id', e.target.value.trim())} />
        </label>
        {voices.length > 0 && (
          <label className="field"><span>ElevenLabs 보이스 목록</span>
            <select value={entry?.voice_id || ''} onChange={(e) => updateVoice('voice_id', e.target.value)}>
              <option value="">선택…</option>
              {voices.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name} {[v.labels?.language, v.labels?.gender, v.labels?.accent, v.category].filter(Boolean).join(' · ')}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>모델</span>
          <select value={voice.model_id} onChange={(e) => updateVoice('model_id', e.target.value)}>
            {!models.some((m) => m.model_id === voice.model_id) && <option value={voice.model_id}>{voice.model_id}</option>}
            {models.map((m) => <option key={m.model_id} value={m.model_id}>{m.name}</option>)}
          </select>
        </label>
        {caps.lang && <label className="field"><span>언어 코드</span>
          <input value={voice.language_code || ''} placeholder="ko" onChange={(e) => updateVoice('language_code', e.target.value.trim())} />
        </label>}
        {entry?.preview_url && <button className="sm" onClick={() => new Audio(entry.preview_url).play()}>▶ 샘플 듣기</button>}
      </div>
      <div className="sliders">
        {[['stability', '안정성', 0, 1], ['similarity_boost', '유사도', 0, 1], ['style', '스타일 과장', 0, 1], ['speed', '속도', 0.7, 1.2]]
          .filter(([key]) => caps.keys.includes(key)).map(([key, label, min, max]) => (
            <label key={key} className="field"><span>{label} <b>{Number(settings[key]).toFixed(2)}</b></span>
              <input type="range" min={min} max={max} step="0.05" value={settings[key]} onChange={(e) => updateSetting(key, +e.target.value)} />
            </label>
          ))}
        {caps.keys.includes('use_speaker_boost') && (
          <label className="chk checks"><input type="checkbox" checked={!!settings.use_speaker_boost} onChange={(e) => updateSetting('use_speaker_boost', e.target.checked)} />Speaker boost</label>
        )}
        {caps.tags && <ToneEditor tone={voice.tone} onChange={(patch) => updateVoice('tone', { ...voice.tone, ...patch })} sample={withTone(sample, voice)} />}
      </div>
    </>
  );
}

function ToneEditor({ tone, onChange, sample }) {
  const tags = parseTags(tone.tags);
  const toggle = (tag) => onChange({ tags: (tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]).join('') });
  return (
    <div className="tone">
      <div className="tone-h">
        <label className="chk big"><input type="checkbox" checked={!!tone.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          <b>기본 톤</b>&nbsp;이 보이스의 발음 텍스트 앞에 적용</label>
      </div>
      <div className={`tone-b ${tone.enabled ? '' : 'off'}`}>
        <div className="chips">
          {TONE_PRESETS.map(([n, t]) => (
            <button key={t} className={`chip ${tags.includes(t) ? 'on' : ''}`} onClick={() => toggle(t)} title={t}>{n}</button>
          ))}
        </div>
        <input className="tagsin" value={tone.tags} placeholder="[narrator][calm]" spellCheck={false}
          onChange={(e) => onChange({ tags: e.target.value })} />
        <label className="chk"><input type="checkbox" checked={!!tone.override} onChange={(e) => onChange({ override: e.target.checked })} />
          줄 발음이 태그로 시작하면 그 줄은 기본 톤 대신 자체 태그 사용</label>
        {tone.enabled && sample && <div className="tone-pv"><span>전송 예</span><code>{sample}</code></div>}
        <p className="hint">태그는 음성에 읽히지 않고 말투만 지시합니다(자막에도 안 나옴). 영어 지시어가 가장 안정적이며, 톤을 바꾸면 기존 음성은 ‘변경’으로 표시돼 재생성 대상이 됩니다.</p>
      </div>
    </div>
  );
}
