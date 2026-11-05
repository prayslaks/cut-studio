import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sourceKindOf, contextUsage, MAX_SOURCE_TEXT, IMAGE_MAX_SIDE, MAX_IMAGE_BYTES } from '../../shared/sources.js';

// 텍스트 파일: UTF-8로 읽고, 깨지면 한국어 Windows 기본 인코딩(CP949)으로 다시 시도
async function readText(file) {
  const buf = await file.arrayBuffer();
  const text = new TextDecoder('utf-8').decode(buf);
  if (!text.includes('�')) return text;
  try { return new TextDecoder('euc-kr', { fatal: true }).decode(buf); } catch { return text; }
}

// 이미지: 긴 변 IMAGE_MAX_SIDE, JPEG로 줄여서 업로드 (AI 요청 크기 절약)
async function shrinkImage(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('이미지를 읽지 못했습니다 (JPEG·PNG·WebP·GIF를 사용하세요)'); }
  try {
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const q of [0.86, 0.74, 0.6, 0.45]) {
      const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', q));
      if (blob && blob.size <= MAX_IMAGE_BYTES) return blob;
    }
    throw new Error('이미지가 너무 큽니다');
  } finally { bitmap.close(); }
}

// fetch는 업로드 진행률을 주지 않으므로 XHR 사용
function sendBlob(url, blob, projectId, onProgress) {
  return new Promise((ok, no) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('x-project-id', projectId);
    x.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      let d = {}; try { d = JSON.parse(x.responseText); } catch {}
      if (x.status >= 200 && x.status < 300) ok(d); else no(new Error(d.error || `${x.status} ${x.statusText}`));
    };
    x.onerror = () => no(new Error('업로드가 중단되었습니다'));
    x.send(blob);
  });
}

const ACTIVE = ['wait', 'upload', 'process'];
const ANALYSIS = ['scenes', 'transcript'];
export const RUNNING = ['queued', 'running'];

// 프로젝트 소스 상태와 서버 호출. 모든 변경 API는 전체 목록을 돌려주므로 그대로 반영한다
export function useSources(projectId, say) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState([]);
  const queue = useRef([]);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const apply = useCallback((data) => {
    if (data?.items && alive.current) setItems(data.items);
    if (data?.notice) say(data.notice, 'ok');
    return data;
  }, [say]);

  const call = useCallback(async (method, url, body, headers = {}) => {
    const r = await fetch(url, { method, headers: { 'x-project-id': projectId, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `${r.status} ${r.statusText}`);
    return apply(data);
  }, [projectId, apply]);

  const reload = useCallback(async () => {
    setError('');
    try { await call('GET', '/api/sources'); } catch (e) { setError(e.message); }
  }, [call]);
  useEffect(() => { reload(); }, [reload]);

  const patchJob = (id, p) => { if (alive.current) setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j))); };

  const runJob = async (job) => {
    if (job.linkPath) { patchJob(job.id, { status: 'process' }); return call('POST', '/api/sources/link', { path: job.linkPath }); }
    if (job.kind === 'text') {
      const text = await readText(job.file);
      if (text.length > MAX_SOURCE_TEXT) throw new Error(`${MAX_SOURCE_TEXT.toLocaleString()}자를 넘습니다 (${text.length.toLocaleString()}자). 나눠서 추가하세요.`);
      return call('POST', '/api/sources/text', { text, origin: job.file.name });
    }
    const blob = job.kind === 'image' ? await shrinkImage(job.file) : job.file;
    return apply(await sendBlob(`/api/sources/upload?kind=${job.kind}&name=${encodeURIComponent(job.file.name)}`, blob, projectId,
      (p) => patchJob(job.id, { progress: p, status: p >= 1 ? 'process' : 'upload' })));
  };

  const pump = async () => {
    if (running.current) return;
    running.current = true;
    while (queue.current.length) {
      const job = queue.current.shift();
      patchJob(job.id, { status: 'upload' });
      try { const data = await runJob(job); patchJob(job.id, { status: 'done', notice: data?.notice }); }
      catch (e) { patchJob(job.id, { status: 'err', error: e.message }); }
    }
    running.current = false;
    setTimeout(() => { if (alive.current) setJobs((js) => js.filter((j) => j.status !== 'done' || j.notice)); }, 3000);
  };

  const enqueue = (list) => {
    const ok = list.filter((j) => j.status === 'wait');
    setJobs((js) => [...js.filter((j) => j.status !== 'done'), ...list]);
    queue.current.push(...ok);
    pump();
  };

  // 여러 파일을 한 번에 — 텍스트·이미지를 먼저, 큰 영상은 뒤에 차례로
  const upload = (fileList) => {
    const list = [...fileList].map((file) => {
      const kind = sourceKindOf(file.name, file.type);
      return { id: crypto.randomUUID(), file, name: file.name, size: file.size, kind, progress: 0,
        status: kind ? 'wait' : 'err', error: kind ? '' : '지원하지 않는 형식입니다' };
    }).sort((a, b) => (a.kind === 'video') - (b.kind === 'video'));
    if (list.length) enqueue(list);
  };
  const link = (path) => enqueue([{ id: crypto.randomUUID(), linkPath: path, name: path.split(/[\\/]/).pop(), kind: 'video', status: 'wait', progress: 0 }]);
  const dismissJob = (id) => setJobs((js) => js.filter((j) => j.id !== id));

  // 영상 분석(장면·받아쓰기)이 진행 중이면 목록을 1초마다 다시 받아 진행률 갱신, 끝나면 알림
  const analyzing = (items || []).some((s) => ANALYSIS.some((k) => RUNNING.includes(s[k]?.status)));
  useEffect(() => {
    if (!analyzing) return;
    const t = setInterval(() => { call('GET', '/api/sources').catch(() => {}); }, 1000);
    return () => clearInterval(t);
  }, [analyzing, call]);
  const lastStatus = useRef({});
  useEffect(() => {
    for (const s of items || []) for (const k of ANALYSIS) {
      const key = `${s.id}:${k}`; const st = s[k]?.status; const prev = lastStatus.current[key];
      if (RUNNING.includes(prev) && st === 'done') say(`${k === 'scenes' ? '장면 분석' : '받아쓰기'} 완료: ${s.title}`, 'ok');
      if (RUNNING.includes(prev) && st === 'error') say(`${k === 'scenes' ? '장면 분석' : '받아쓰기'} 실패: ${s.title} — ${s[k].error}`, 'err');
      lastStatus.current[key] = st;
    }
  }, [items, say]);

  const active = jobs.filter((j) => ACTIVE.includes(j.status)).length;
  const usage = useMemo(() => contextUsage(items || []), [items]);

  return {
    items, error, reload, jobs, active, usage, upload, link, dismissJob,
    addText: (b) => call('POST', '/api/sources/text', b),
    update: (id, b) => call('PATCH', `/api/sources/${id}`, b),
    select: (ids) => call('POST', '/api/sources/select', { ids }),
    remove: (id) => call('DELETE', `/api/sources/${id}`),
    frames: (id, b) => call('POST', `/api/sources/${id}/frames`, b),
    preview: () => call('GET', '/api/sources/context'),
    scenes: (id, b) => call('POST', `/api/sources/${id}/scenes`, b),
    transcribe: (id, b, key) => call('POST', `/api/sources/${id}/transcribe`, b, { 'x-el-key': key || '' }),
    transcript: (id) => call('GET', `/api/sources/${id}/transcript`),
    saveTranscript: (id, segments) => call('PUT', `/api/sources/${id}/transcript`, { segments }),
  };
}
