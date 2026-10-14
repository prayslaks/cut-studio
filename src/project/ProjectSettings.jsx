import { useState } from 'react';
import { Modal } from '../Modals.jsx';
import FileBrowser from './FileBrowser.jsx';

// 프로젝트 설정: 이름, 카드·썸네일 기본 문구, AI가 참고할 설명, 출력 폴더
export default function ProjectSettings({ project, onChange, dirty, onSave, onClose, say }) {
  const [pickOut, setPickOut] = useState(false);
  const p = project || {};
  return (
    <Modal title="프로젝트 설정" onClose={onClose}
      footer={<><span className="muted grow">{dirty ? '저장하지 않은 변경이 있습니다.' : '변경은 상단 저장(Ctrl+S)으로 저장됩니다.'}</span>
        <button className="primary" onClick={async () => { try { await onSave(); onClose(); } catch (e) { say(e.message, 'err'); } }}>저장하고 닫기</button></>}>
      <section className="set">
        <h4>기본 정보</h4>
        <label className="field"><span>프로젝트 이름</span><input value={p.name || ''} onChange={(e) => onChange({ name: e.target.value })} /></label>
        <div className="row2c">
          <label className="field"><span>브랜드 문구 {'{brand}'}</span><input value={p.brand || ''} onChange={(e) => onChange({ brand: e.target.value })} /></label>
          <label className="field"><span>대표 키워드 {'{tagline}'}</span><input value={p.tagline || ''} onChange={(e) => onChange({ tagline: e.target.value })} /></label>
        </div>
        <label className="field"><span>부제 형식 {'{subtitle}'} — {'{title}'} = 영상 제목</span><input value={p.subtitleFormat || '{title}'} onChange={(e) => onChange({ subtitleFormat: e.target.value })} /></label>
        <p className="hint">인트로·엔딩 카드와 썸네일 템플릿의 기본 문구로 쓰입니다. 카드에서 직접 고친 문구는 그대로 유지됩니다.</p>
      </section>
      <section className="set">
        <h4>프로젝트 설명 (AI 참고)</h4>
        <textarea rows={6} value={p.brief || ''} placeholder="무엇에 대한 영상인지, 누구에게 보여줄지, 어떤 톤인지, 꼭 지켜야 할 사실·금지 표현 등"
          onChange={(e) => onChange({ brief: e.target.value })} />
        <p className="hint">어시스턴트·썸네일 AI 초안·업로드 문구 추천이 모두 이 설명을 근거로 씁니다.</p>
      </section>
      <section className="set">
        <h4>출력 폴더</h4>
        <div className="row"><code className="grow path">{p.outDir || '(프로젝트 폴더\\output)'}</code>
          <button onClick={() => setPickOut(!pickOut)}>{pickOut ? '닫기' : '변경'}</button>
          {p.outDir && <button className="ghost" onClick={() => onChange({ outDir: undefined })}>기본값</button>}</div>
        {pickOut && <FileBrowser mode="dir" start={p.outDir || ''} height={220} onPick={(d) => { onChange({ outDir: d }); setPickOut(false); }} />}
        <p className="hint">MP4·SRT·썸네일 PNG가 저장됩니다.</p>
      </section>
    </Modal>
  );
}
