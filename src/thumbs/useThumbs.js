import { useCallback, useEffect, useRef, useState } from 'react';

const j = async (url, opt = {}) => {
  const r = await fetch(url, opt);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
};
const post = (url, body, headers = {}) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
const clone = (x) => JSON.parse(JSON.stringify(x));

// 썸네일 초안 상태 (목록 + 선택 초안 작업본 + 실행취소 + 자동 저장/렌더)
export function useThumbs({ say }) {
  const [list, setList] = useState([]);
  const [draft, setDraft] = useState(null);      // 선택 초안 작업본
  const [selLayer, setSelLayer] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(null);
  const hist = useRef({ past: [], future: [] });
  const timer = useRef(0);
  const latest = useRef(null);
  latest.current = draft;

  const reload = useCallback(async () => { const l = await j('/api/thumbs'); setList(Array.isArray(l) ? l : []); return l; }, []);
  useEffect(() => { reload().catch(() => {}); }, [reload]);

  const persist = useCallback(async (d) => {
    setSaving(true);
    try {
      const out = await post('/api/thumbs', d);
      setList((l) => [...l.filter((x) => x.id !== out.id), out]);
      setDraft((cur) => (cur && cur.id === out.id ? { ...cur, rendered: out.rendered, label: out.label } : cur));
      return out;
    } catch (e) { say(`썸네일 저장 실패: ${e.message}`, 'err'); return null; } finally { setSaving(false); }
  }, [say]);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (latest.current) persist(latest.current); }, 900);
  }, [persist]);

  const select = useCallback((id) => {
    clearTimeout(timer.current);
    const d = list.find((x) => x.id === id);
    setDraft(d ? clone(d) : null); setSelLayer(null);
    hist.current = { past: [], future: [] };
  }, [list]);

  // fn: draft → draft. commit=false 이면 드래그 중(기록·저장 생략)
  const update = useCallback((fn, { commit = true } = {}) => {
    setDraft((cur) => {
      if (!cur) return cur;
      const next = fn(clone(cur));
      if (commit) { hist.current.past.push(cur); if (hist.current.past.length > 60) hist.current.past.shift(); hist.current.future = []; }
      return next;
    });
    if (commit) schedule();
  }, [schedule]);
  // 드래그 시작 시점 스냅샷을 기록하고 끝날 때 커밋
  const beginGesture = useCallback(() => { if (latest.current) { hist.current.past.push(clone(latest.current)); hist.current.future = []; } }, []);
  const endGesture = useCallback(() => schedule(), [schedule]);

  const updateLayer = useCallback((lid, patch, opt) => update((d) => {
    d.layers = d.layers.map((l) => (l.id === lid ? deepMerge(l, typeof patch === 'function' ? patch(l) : patch) : l)); return d;
  }, opt), [update]);

  const undo = useCallback(() => {
    const h = hist.current; if (!h.past.length || !latest.current) return;
    h.future.push(clone(latest.current)); const prev = h.past.pop(); setDraft(prev); schedule();
  }, [schedule]);
  const redo = useCallback(() => {
    const h = hist.current; if (!h.future.length || !latest.current) return;
    h.past.push(clone(latest.current)); const nx = h.future.pop(); setDraft(nx); schedule();
  }, [schedule]);

  const run = async (label, fn) => { setBusy(label); try { return await fn(); } catch (e) { say(`${label} 실패: ${e.message}`, 'err'); return null; } finally { setBusy(null); } };

  const create = (key, t) => run('새 초안', async () => {
    const d = await post('/api/thumbs', { key, t: +(+t).toFixed(2) });
    setList((l) => [...l.filter((x) => x.id !== d.id), d]); setDraft(clone(d)); setSelLayer(null); hist.current = { past: [], future: [] };
    return d;
  });
  const duplicate = () => run('복제', async () => {
    const { id, png, rendered, ...rest } = latest.current;
    const d = await post('/api/thumbs', rest);
    setList((l) => [...l, d]); setDraft(clone(d)); return d;
  });
  const remove = (id) => run('삭제', async () => {
    await fetch(`/api/thumbs/${id}`, { method: 'DELETE' });
    setList((l) => l.filter((x) => x.id !== id)); if (latest.current?.id === id) setDraft(null);
  });
  const savePng = () => run('PNG 저장', async () => {
    clearTimeout(timer.current); await persist(latest.current);
    const r = await post(`/api/thumbs/${latest.current.id}/save`);
    say(`썸네일 저장: ${r.path}`, 'ok');
    post('/api/open', { path: r.path }).catch(() => {});
    return r.path;
  });
  const renderNow = () => run('렌더', async () => { clearTimeout(timer.current); return persist(latest.current); });

  const agentGenerate = ({ key, provider, model, aiKey, count, brief }) => run('AI 초안 생성', async () => {
    const r = await post('/api/thumbs/agent', { key, provider, model, count, brief }, { 'x-ai-key': aiKey });
    await reload();
    const ok = r.drafts.filter((d) => !d.error);
    if (ok[0]) { setDraft(clone(ok[0])); setSelLayer(null); hist.current = { past: [], future: [] }; }
    say(`썸네일 초안 ${ok.length}개 생성${r.text ? ` — ${r.text.slice(0, 80)}` : ''}`, 'ok');
    return r;
  });

  return { list, draft, select, update, updateLayer, beginGesture, endGesture, undo, redo, selLayer, setSelLayer,
    create, duplicate, remove, savePng, renderNow, agentGenerate, reload, saving, busy,
    canUndo: hist.current.past.length > 0, canRedo: hist.current.future.length > 0 };
}

function deepMerge(a, b) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? { ...a[k], ...v } : v;
  return o;
}
