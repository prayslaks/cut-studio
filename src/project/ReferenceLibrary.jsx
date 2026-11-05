import { useRef, useState } from 'react';
import { Modal } from '../Modals.jsx';
import { MAX_REFERENCES, MAX_REFERENCE_TEXT, MAX_REFERENCE_IMAGE_BYTES } from '../../shared/references.js';

const newDraft = (kind) => ({ id: crypto.randomUUID(), kind, title: '', text: '', image: '', enabled: true });

async function readImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPEG, PNG 또는 WebP 이미지를 선택하세요.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/jpeg', 0.84);
    if (image.length > Math.ceil(MAX_REFERENCE_IMAGE_BYTES / 3) * 4 + 23) throw new Error('이미지가 너무 큽니다. 더 작은 이미지를 선택하세요.');
    return image;
  } finally { bitmap.close(); }
}

export default function ReferenceLibrary({ references, onSave, onClose, loadError, onReload }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const edit = (item) => { setError(''); setDraft(item); };
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const run = async (fn) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message); }
    finally { pending.current = false; setBusy(false); }
  };
  const importFile = (file) => {
    if (!file) return;
    run(async () => {
      const content = draft.kind === 'image' ? { image: await readImage(file) } : { text: await file.text() };
      if (content.text?.length > MAX_REFERENCE_TEXT) throw new Error(`텍스트는 ${MAX_REFERENCE_TEXT.toLocaleString()}자까지 가져올 수 있습니다.`);
      update({ ...content, title: draft.title || file.name.replace(/\.[^.]+$/, '').slice(0, 100) });
    });
  };
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const exists = references.some((item) => item.id === draft.id);
      await onSave(exists ? references.map((item) => item.id === draft.id ? draft : item) : [...references, draft]);
      setDraft(null);
    });
  };
  const active = references?.filter((item) => item.enabled).length || 0;
  const ready = draft?.title.trim() && (draft.kind === 'text' ? draft.text.trim() : draft.image);
  return (
    <Modal title="프로젝트 자료" onClose={() => { if (!pending.current) onClose(); }} wide>
      <div className="reference-library">
        <p className="hint">이 프로젝트의 모든 영상이 자료를 공유합니다. ‘AI 참고’를 켠 자료는 선택한 AI 서비스로 요청과 함께 전송됩니다.</p>
        {(error || loadError) && <div className="callout err" role="alert">{error || loadError}{!references && <button onClick={onReload}>다시 시도</button>}</div>}
        {!references && !loadError && <p className="muted">자료를 불러오는 중…</p>}
        {references && <>
          <div className="reference-actions">
            <span className="muted">자료 {references.length}개 · AI 참고 {active}개</span>
            <button disabled={busy || !!draft || references.length >= MAX_REFERENCES} onClick={() => edit(newDraft('text'))}>＋ 텍스트</button>
            <button disabled={busy || !!draft || references.length >= MAX_REFERENCES} onClick={() => edit(newDraft('image'))}>＋ 이미지</button>
          </div>
          {draft && (
            <form className="panel set reference-form" onSubmit={submit}>
              <label className="field"><span>자료 제목</span>
                <input required maxLength={100} value={draft.title} onChange={(e) => update({ title: e.target.value })} placeholder="예: 시리즈 편집 가이드" disabled={busy} />
              </label>
              <label className="field"><span>{draft.kind === 'text' ? '텍스트 파일 가져오기 (.txt, .md)' : '이미지 파일 선택 (JPEG, PNG, WebP)'}</span>
                <input key={draft.id} type="file" accept={draft.kind === 'text' ? '.txt,.md' : 'image/jpeg,image/png,image/webp'}
                  onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} disabled={busy} />
              </label>
              {draft.kind === 'text'
                ? <label className="field"><span>참고 텍스트</span><textarea rows={6} maxLength={MAX_REFERENCE_TEXT}
                  value={draft.text} onChange={(e) => update({ text: e.target.value })} placeholder="기획 메모, 용어집, 사실 확인 자료 등을 입력하세요." disabled={busy} /></label>
                : draft.image && <img className="reference-preview" src={draft.image} alt={draft.title || '추가할 이미지'} />}
              <div className="reference-actions">
                <label className="chk"><input type="checkbox" checked={draft.enabled} onChange={(e) => update({ enabled: e.target.checked })} disabled={busy} />AI 참고</label>
                <button type="button" disabled={busy} onClick={() => edit(null)}>취소</button>
                <button className="primary" disabled={busy || !ready}>자료 저장</button>
              </div>
            </form>
          )}
          {!draft && !references.length && <div className="ph-empty">기획 메모, 스타일 가이드, 참고 이미지처럼 여러 영상에서 다시 쓸 자료를 추가하세요.</div>}
          <div className="reference-list">
            {references.map((item) => (
              <article className="reference-item" key={item.id}>
                {item.kind === 'image' && <img src={item.image} alt="" loading="lazy" />}
                <div className="reference-description">
                  <b>{item.title}</b>
                  <small>{item.kind === 'text' ? item.text.slice(0, 120) : '참고 이미지'}</small>
                </div>
                <label className="chk"><input type="checkbox" checked={item.enabled} disabled={busy || !!draft}
                  onChange={(e) => { const enabled = e.target.checked; run(() => onSave(references.map((ref) => ref.id === item.id ? { ...ref, enabled } : ref))); }} />AI 참고</label>
                <button className="sm" disabled={busy || !!draft} onClick={() => edit(item)}>편집</button>
                <button className="ghost danger sm" disabled={busy || !!draft}
                  onClick={() => { if (window.confirm(`‘${item.title}’ 자료를 삭제할까요?`)) run(() => onSave(references.filter((ref) => ref.id !== item.id))); }}>삭제</button>
              </article>
            ))}
          </div>
        </>}
      </div>
    </Modal>
  );
}
