import { useEffect, useState } from 'react';
import App from './App.jsx';
import ProjectHome from './project/ProjectHome.jsx';

// 열린 프로젝트가 있으면 편집기, 없으면 프로젝트 시작 화면
export default function Root() {
  const [state, setState] = useState(null);
  useEffect(() => {
    fetch('/api/projects').then((r) => r.json()).then(setState).catch((e) => setState({ error: e.message }));
  }, []);
  if (!state) return <div className="boot">불러오는 중…</div>;
  if (state.error) return <div className="boot">서버에 연결할 수 없습니다: {state.error}</div>;
  if (!state.current) return <ProjectHome />;
  return <App key={state.current.id} project={state.current} />;
}
