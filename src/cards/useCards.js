import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveCards, defaultCards } from '../../shared/cards.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
function deepMerge(a, b) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? { ...a[k], ...v } : v;
  return o;
}

// 영상 카드 편집 상태. 데이터는 script.meta[tab].cards (저장은 대본과 함께 Ctrl+S)
export function useCards({ script, setScript, setDirty, tab }) {
  const meta = script?.meta?.[tab];
  const cards = useMemo(() => resolveCards(meta || {}), [meta]);
  const [kind, setKind] = useState('intro');
  const [chIdx, setChIdx] = useState(0);
  const [selLayer, setSelLayer] = useState(null);
  const hist = useRef({});           // tab → { past, future }
  const latest = useRef(cards); latest.current = cards;
  const H = () => (hist.current[tab] ||= { past: [], future: [] });
  const [, bump] = useState(0);

  useEffect(() => { setSelLayer(null); setChIdx(0); }, [tab]);
  useEffect(() => { setSelLayer(null); }, [kind]);

  const write = useCallback((next) => {
    setScript((s) => ({ ...s, meta: { ...s.meta, [tab]: { ...s.meta[tab], cards: next } } }));
    setDirty(true);
  }, [setScript, setDirty, tab]);

  // fn: cards(복사본) → cards. commit=false 이면 드래그 중(기록 생략)
  const update = useCallback((fn, { commit = true } = {}) => {
    const cur = latest.current; const next = fn(clone(cur));
    if (commit) { const h = H(); h.past.push(cur); if (h.past.length > 80) h.past.shift(); h.future = []; bump((v) => v + 1); }
    write(next);
  }, [write]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateCard = useCallback((k, patch, opt) => update((c) => { c[k] = { ...c[k], ...patch }; return c; }, opt), [update]);
  const updateLayer = useCallback((lid, patch, opt) => update((c) => {
    c[kind].layers = c[kind].layers.map((l) => (l.id === lid ? deepMerge(l, typeof patch === 'function' ? patch(l) : patch) : l)); return c;
  }, opt), [update, kind]);
  const beginGesture = useCallback(() => { const h = H(); h.past.push(clone(latest.current)); h.future = []; bump((v) => v + 1); }, []); // eslint-disable-line
  const endGesture = useCallback(() => {}, []);
  const undo = useCallback(() => { const h = H(); if (!h.past.length) return; h.future.push(clone(latest.current)); write(h.past.pop()); bump((v) => v + 1); }, [write]); // eslint-disable-line
  const redo = useCallback(() => { const h = H(); if (!h.future.length) return; h.past.push(clone(latest.current)); write(h.future.pop()); bump((v) => v + 1); }, [write]); // eslint-disable-line
  const reset = useCallback((k) => update((c) => { c[k] = defaultCards(meta || {})[k]; return c; }), [update, meta]);
  const h = hist.current[tab] || { past: [], future: [] };

  return { cards, card: cards[kind], kind, setKind, chIdx, setChIdx, selLayer, setSelLayer, update, updateCard, updateLayer,
    beginGesture, endGesture, undo, redo, reset, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
