import { MAX_CONTEXT_TEXT, MAX_CONTEXT_IMAGES } from '../../shared/sources.js';

// AI 컨텍스트 사용량 (켜진 소스의 텍스트 글자 수, 이미지·영상 프레임 장 수)
export default function UsageMeter({ usage }) {
  const bars = [
    ['텍스트', usage.text, MAX_CONTEXT_TEXT, '자'],
    ['이미지·영상 프레임', usage.images, MAX_CONTEXT_IMAGES, '장'],
  ];
  return (
    <div className="src-usage" aria-label="AI 컨텍스트 사용량">
      {bars.map(([label, v, max, unit]) => (
        <div key={label} className={`src-meter ${v > max * 0.9 ? 'hot' : ''}`}>
          <span>{label}<b>{v.toLocaleString()} / {max.toLocaleString()}{unit}</b></span>
          <i><em style={{ width: `${Math.min(100, (v / max) * 100)}%` }} /></i>
        </div>
      ))}
    </div>
  );
}
