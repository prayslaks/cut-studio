import { useState } from 'react';
import { Modal } from './Modals.jsx';
import { MAIN } from '../shared/tracks.js';

const LANGS = [['en', '영어', 'English'], ['ja', '일본어', 'Japanese'], ['zh', '중국어', 'Simplified Chinese'], ['es', '스페인어', 'Spanish'],
  ['de', '독일어', 'German'], ['fr', '프랑스어', 'French'], ['ko', '한국어', 'Korean']];

// 나레이션 트랙 추가(빈 트랙 / 복제 / AI 번역) · 이름 바꾸기 · 삭제
export default function TrackModal({ mode, track, tracks, current, onSave, onDelete, onTranslate, aiReady, onClose, say }) {
  const isAdd = mode === 'add';
  const [name, setName] = useState(track?.name || '영어');
  const [lang, setLang] = useState('en');
  const [how, setHow] = useState('translate'); // empty | copy | translate
  const [from, setFrom] = useState(current);
  const [copyVoice, setCopyVoice] = useState(true);
  const [busy, setBusy] = useState(false);

  // 트랙 id = 언어 코드 기반 (대사 id 접두어로도 쓰임: A_en01)
  const baseId = (lang || name).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 't';
  const id = (() => { let i = baseId, n = 2; while (i === MAIN || tracks.some((t) => t.id === i)) i = `${baseId}${n++}`; return i; })();

  const submit = async () => {
    if (!name.trim()) return say('트랙 이름을 입력하세요', 'err');
    if (!isAdd) return onSave({ id: track.id, name: name.trim() });
    let translated = null;
    if (how === 'translate') {
      setBusy(true);
      try { translated = await onTranslate(from, LANGS.find((l) => l[0] === lang)?.[2] || name.trim()); }
      catch (e) { setBusy(false); return say(`번역 실패: ${e.message}`, 'err'); }
    }
    onSave({ id, name: name.trim(), copyFrom: how === 'empty' ? null : from, copyVoice, translated, language_code: lang || undefined });
  };

  const footer = (<>
    {!isAdd && track?.id !== MAIN && <button className="ghost danger" onClick={() => onDelete(track.id)}>트랙 삭제</button>}
    <span className="muted grow">{busy ? 'AI가 영상별로 번역하는 중…' : ''}</span>
    <button onClick={onClose} disabled={busy}>취소</button>
    <button className="primary" onClick={submit} disabled={busy || (isAdd && how === 'translate' && !aiReady)}>{isAdd ? (how === 'translate' ? '번역해서 만들기' : '트랙 만들기') : '저장'}</button>
  </>);

  return (
    <Modal title={isAdd ? '나레이션 트랙 추가' : '트랙 설정'} onClose={() => !busy && onClose()} footer={footer}>
      <section className="set">
        <label className="field"><span>트랙 이름</span><input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="예: 영어, 한국어(짧은 버전)" /></label>
        {!isAdd && track?.id === MAIN && <p className="hint">기본 트랙은 지울 수 없습니다. 이름만 바꿀 수 있어요(예: 한국어).</p>}
        {isAdd && (<>
          <div className="row2c">
            <label className="field"><span>언어</span>
              <select value={lang} onChange={(e) => { setLang(e.target.value); const l = LANGS.find((x) => x[0] === e.target.value); if (l) setName(l[1]); }}>
                {LANGS.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}
                <option value="">지정 안 함</option>
              </select></label>
            <label className="field"><span>원본 트랙</span>
              <select value={from} onChange={(e) => setFrom(e.target.value)} disabled={how === 'empty'}>
                {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select></label>
          </div>
          <div className="seg-toggle">
            {[['translate', 'AI 번역'], ['copy', '그대로 복제'], ['empty', '빈 트랙']].map(([k, n]) => (
              <button key={k} className={how === k ? 'on' : ''} onClick={() => setHow(k)}>{n}</button>))}
          </div>
          <p className="hint">{{
            translate: `모든 영상의 '${tracks.find((t) => t.id === from)?.name}' 대사를 시작 시각 그대로 복제하고, 자막을 AI(설정의 AI 에이전트)로 번역합니다. 발음 사전은 비운 채로 시작합니다.`,
            copy: '대사·시작 시각·발음 칸을 그대로 복제합니다. 같은 언어로 다른 버전(짧은 버전, 다른 목소리)을 만들 때.',
            empty: '대사 없이 시작합니다.',
          }[how]}</p>
          {how === 'translate' && !aiReady && <div className="callout err">설정에서 AI(Claude/OpenAI) API 키를 먼저 등록하세요.</div>}
          <label className="chk"><input type="checkbox" checked={copyVoice} onChange={(e) => setCopyVoice(e.target.checked)} />원본 트랙의 보이스·설정 복사 (언어 코드는 위에서 고른 값)</label>
          <p className="hint">트랙마다 대사·타이밍·보이스·발음 사전이 따로 있습니다. 번역하면 길이가 달라지니 생성 후 타임라인에서 겹침(⚠)을 확인하세요. 음성 생성(ElevenLabs)은 트랙을 만든 뒤 따로 합니다.</p>
        </>)}
      </section>
    </Modal>
  );
}
