import { useState } from 'react';
import { Modal } from './Modals.jsx';
import { MAIN } from '../shared/tracks.js';

const LANGS = [['en', '영어', 'English'], ['ja', '일본어', 'Japanese'], ['zh', '중국어', 'Simplified Chinese'], ['es', '스페인어', 'Spanish'],
  ['de', '독일어', 'German'], ['fr', '프랑스어', 'French'], ['ko', '한국어', 'Korean']];
const METHODS = [
  ['translate', 'AI 번역', '모든 영상의 대사를 같은 시각에 배치하고 자막을 번역합니다.'],
  ['copy', '그대로 복제', '대사, 시작 시각, 발음 텍스트를 복사합니다.'],
  ['empty', '빈 트랙', '대사 없이 시작합니다.'],
];

// 나레이션 트랙 추가(빈 트랙 / 복제 / AI 번역) · 이름 바꾸기 · 삭제
export default function TrackModal({ mode, track, tracks, current, onSave, onDelete, onTranslate, aiReady, onClose, say }) {
  const isAdd = mode === 'add';
  const [name, setName] = useState(track?.name || '영어');
  const [lang, setLang] = useState('en');
  const [how, setHow] = useState(aiReady ? 'translate' : 'empty');
  const [from, setFrom] = useState(current);
  const [copyVoice, setCopyVoice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 트랙 id = 언어 코드 기반 (대사 id 접두어로도 쓰임: A_en01)
  const baseId = (lang || name).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 't';
  const id = (() => { let i = baseId, n = 2; while (i === MAIN || tracks.some((t) => t.id === i)) i = `${baseId}${n++}`; return i; })();

  const submit = async () => {
    setError('');
    if (!isAdd) return onSave({ id: track.id, name: name.trim() });
    let translated = null;
    if (how === 'translate') {
      setBusy(true);
      try { translated = await onTranslate(from, LANGS.find((l) => l[0] === lang)?.[2] || name.trim()); }
      catch (e) { setBusy(false); setError(`번역 실패: ${e.message}`); return say(`번역 실패: ${e.message}`, 'err'); }
    }
    onSave({ id, name: name.trim(), copyFrom: how === 'empty' ? null : from, copyVoice, translated, language_code: lang || undefined });
  };

  const footer = (<>
    {!isAdd && track?.id !== MAIN && <button className="ghost danger" onClick={() => onDelete(track.id)}>트랙 삭제</button>}
    <span className="muted grow">{busy ? 'AI가 영상별로 번역하는 중…' : ''}</span>
    <button onClick={onClose} disabled={busy}>취소</button>
    <button className="primary" onClick={submit} disabled={busy || !name.trim() || (isAdd && how === 'translate' && !aiReady)}>{isAdd ? (how === 'translate' ? '번역해서 만들기' : '트랙 만들기') : '저장'}</button>
  </>);

  return (
    <Modal title={isAdd ? '나레이션 트랙 추가' : '트랙 설정'} onClose={() => !busy && onClose()} footer={footer}>
      <fieldset className="set track-form" disabled={busy}>
        {isAdd && (<>
          <fieldset className="track-methods">
            <legend>만드는 방법</legend>
            {METHODS.map(([key, label, description]) => (
              <label key={key} className={how === key ? 'selected' : ''}>
                <input type="radio" name="track-method" checked={how === key} onChange={() => { setHow(key); setError(''); }} />
                <span><b>{label}</b><small>{description}</small></span>
              </label>
            ))}
          </fieldset>
          {how === 'translate' && !aiReady && <div className="callout err">AI 번역을 사용하려면 설정에서 Claude 또는 OpenAI API 키를 등록하세요.</div>}
        </>)}
        <div className={isAdd ? 'row2c' : undefined}>
          <label className="field"><span>트랙 이름</span><input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="예: 영어, 한국어(짧은 버전)" /></label>
          {isAdd && (
            <label className="field"><span>언어</span>
              <select value={lang} onChange={(e) => {
                const next = LANGS.find(([code]) => code === e.target.value);
                if (next && (!name.trim() || name === LANGS.find(([code]) => code === lang)?.[1])) setName(next[1]);
                setLang(e.target.value);
              }}>
                {LANGS.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
                <option value="">지정 안 함</option>
              </select></label>
          )}
        </div>
        {!isAdd && track?.id === MAIN && <p className="hint">기본 트랙의 이름을 변경할 수 있습니다.</p>}
        {isAdd && (<>
          {how !== 'empty' && (
            <label className="field"><span>원본 트랙</span>
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select></label>
          )}
          <label className="chk"><input type="checkbox" checked={copyVoice} onChange={(e) => setCopyVoice(e.target.checked)} />{how === 'empty' ? '기본' : '원본'} 트랙의 기본 보이스{how !== 'translate' && '와 발음 사전'} 복제</label>
          <p className="hint">{how === 'translate' && '발음 사전은 비운 채로 시작합니다. '}음성은 트랙을 만든 뒤 대사 화면에서 생성하세요.</p>
          {error && <div className="callout err" role="alert">{error}</div>}
        </>)}
      </fieldset>
    </Modal>
  );
}
