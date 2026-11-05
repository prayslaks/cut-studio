import { useEffect, useState } from 'react';
import App from './App.jsx';
import ProjectHome from './project/ProjectHome.jsx';
import { APP_NAME } from '../shared/app.js';

export default function Root() {
  const [current, setCurrent] = useState(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!current) document.title = APP_NAME;
  }, [current]);
  const selectProject = (project) => {
    setCurrent(project);
    setRevision((value) => value + 1);
  };
  if (!current) return <ProjectHome onOpened={selectProject} />;
  return <App key={`${current.id}:${revision}`} project={current} onProjectChange={selectProject} />;
}
