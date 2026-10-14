import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildTimeline, editToSrc, srcToEdit, fmt, estDur, SUB_TAIL } from './timeline.js';
import Agent from './Agent.jsx';
import FrameOverlay, { useFrameRect } from './FrameOverlay.jsx';
import StylePanel from './StylePanel.jsx';
import Splitter from './Splitter.jsx';
import { useThumbs } from './thumbs/useThumbs.js';
import { textLayer, rectLayer, gradLayer } from '../shared/thumbLayers.js';
import ThumbCanvas from './thumbs/ThumbCanvas.jsx';
import ThumbInspector from './thumbs/ThumbInspector.jsx';
import ThumbsSide from './thumbs/ThumbsSide.jsx';
import { PROVIDERS } from './Agent.jsx';
import { resolveStyle } from '../shared/layout.js';
import { SettingsModal, ExportModal } from './Modals.jsx';
import { useCards } from './cards/useCards.js';
import CardsPanel from './cards/CardsPanel.jsx';
import YoutubePanel from './YoutubePanel.jsx';
import Timeline from './Timeline.jsx';
import VideoModal from './project/VideoModal.jsx';
import ProjectHome from './project/ProjectHome.jsx';
import ProjectSettings from './project/ProjectSettings.jsx';
import CardInspector from './cards/CardInspector.jsx';
import CardEditOverlay from './cards/CardEditOverlay.jsx';
import { cardInstances, cardFocusTime, newCardText, newCardRect, newCardGrad } from '../shared/cards.js';
const mergeLayer = (l, p = {}) => { const o = { ...l }; for (const [k, v] of Object.entries(p)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && l[k] && typeof l[k] === 'object' ? { ...l[k], ...v } : v; return o; };

// API 키로 /v1/models 를 불러오면 계정에서 쓸 수 있는 목록으로 교체됨
const FALLBACK_MODELS = [
  { model_id: 'eleven_v4', name: 'Eleven v4' },
  { model_id: 'eleven_v4_turbo', name: 'Eleven v4 Turbo' },
  { model_id: 'eleven_v3', name: 'Eleven v3' },
  { model_id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2' },
  { model_id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5' },
];
// 모델별로 받는 voice_settings 항목 (v4: Stability/Similarity만, SSML 미지원)
const modelCaps = (id = '') => {
  if (id.startsWith('eleven_v4')) return { keys: ['stability', 'similarity_boost'], lang: true, tags: true };
  if (id.startsWith('eleven_v3')) return { keys: ['stability', 'similarity_boost', 'use_speaker_boost'], lang: true, tags: true };
  if (id === 'eleven_multilingual_v2') return { keys: ['stability', 'similarity_boost', 'style', 'use_speaker_boost', 'speed'], lang: false, tags: false };
  return { keys: ['stability', 'similarity_boost', 'style', 'use_speaker_boost', 'speed'], lang: true, tags: false };
};
const pickVS = (vs, model) => Object.fromEntries(modelCaps(model).keys.filter((k) => vs[k] != null).map((k) => [k, vs[k]]));

// 발음 사전: 자막 → 발음 텍스트 자동 치환 (긴 단어 우선)
function applyDict(text, rules = []) {
  let out = text || '';
  [...rules].filter((r) => r.from).sort((a, b) => b.from.length - a.from.length).forEach((r) => {
    out = out.split(r.from).join(r.to ?? '');
  });
  return out;
}

// 기본 톤 프리셋 (Eleven v3/v4 오디오 태그 — 영어 지시어가 가장 안정적)
const TONE_PRESETS = [
  ['나레이션', '[narrator]'], ['차분한', '[calm]'], ['자신감 있는', '[confident]'], ['진지한', '[serious]'],
  ['따뜻한', '[warm]'], ['또렷한', '[clear articulation]'], ['다큐멘터리', '[documentary style]'], ['활기찬', '[energetic]'],
  ['긴박한', '[tense]'], ['천천히', '[slow pace]'],
];
const parseTags = (s = '') => (s.match(/\[[^\]]+\]/g) || []);
const DEFAULT_VS = { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 };

async function api(url, { key, ...opt } = {}) {
  const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), ...(key ? { 'x-el-key': key } : {}) } });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error(data?.error || `${r.status} ${r.statusText}`);
  return data;
}

const ls = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

const pick = (o, ks) => Object.fromEntries(ks.filter((k) => o[k] != null).map((k) => [k, o[k]]));
function deepMergeObj(a = {}, b = {}) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMergeObj(a[k] || {}, v) : v;
  return o;
}


const nextNum = (arr) => Math.max(0, ...arr.map((l) => parseInt((/(\d+)$/.exec(l.id) || [])[1], 10)).filter(Number.isFinite)) + 1;
const nextKey = (s) => { for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!s.meta?.[c] && !s[c]) return c; return `V${Date.now().toString(36)}`; };

export default function App({ project }) {
  const [script, setScript] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState(() => ls.get('zk.tab', ''));
  const [vmodal, setVmodal] = useState(null); // { key, isNew }
  const [phome, setPhome] = useState(false);
  const [tts, setTts] = useState({});
  const [durs, setDurs] = useState({});
  const [keys, setKeys] = useState(() => ({ el: ls.get('zk.elkey', ''), anthropic: ls.get('zk.ai.key.anthropic', ''), openai: ls.get('zk.ai.key.openai', '') }));
  const [remember, setRemember] = useState(() => !!(ls.get('zk.elkey', '') || ls.get('zk.ai.key.anthropic', '') || ls.get('zk.ai.key.openai', '')));
  const apiKey = keys.el;
  const setKey = (k, v) => setKeys((x) => ({ ...x, [k]: v }));
  const [modal, setModal] = useState(null);
  const [exportJob, setExportJob] = useState(null);
  const [voices, setVoices] = useState([]);
  const [models, setModels] = useState(FALLBACK_MODELS);
  const [quota, setQuota] = useState(null);
  const [busy, setBusy] = useState({});
  const [batch, setBatch] = useState(null);
  const [log, setLog] = useState([]);
  const [toast, setToast] = useState(null);
  const [unreadErr, setUnreadErr] = useState(0);
  const [setFocus, setSetFocus] = useState(null);
  const [sel, setSel] = useState(null);
  const [editTime, setEditTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [gameVol, setGameVol] = useState(0.6);
  const [context, setContext] = useState(false);
  const [side, setSide] = useState(() => { const v = ls.get('zk.side', 'lines'); return ['lines', 'style', 'cards', 'thumbs', 'youtube'].includes(v) ? v : 'lines'; });

  const videoRef = useRef(null);
  const [scriptReady, setScriptReady] = useState(false);
  const frameRect = useFrameRect(videoRef, scriptReady);
  const [font, setFont] = useState('Malgun Gothic');
  const [shot, setShot] = useState(null); // ffmpeg 실제 렌더 프레임
  const [compare, setCompare] = useState(false); // 썸네일: 실제 렌더 겹쳐 보기
  const [asstOpen, setAsstOpen] = useState(() => ls.get('zk.asst', '1') === '1');
  // 자유 레이아웃: 가운데 패널·어시스턴트 너비, 영상/썸네일 캔버스 높이 (드래그 분할선, localStorage 기억)
  const LAYOUT0 = { mid: 460, asst: 380, stageH: null, canvasH: null };
  const [lay, setLay] = useState(() => { try { return { ...LAYOUT0, ...JSON.parse(ls.get('zk.layout', '{}')) }; } catch { return LAYOUT0; } });
  useEffect(() => { ls.set('zk.layout', JSON.stringify(lay)); }, [lay]);
  const setL = (k, v) => setLay((x) => ({ ...x, [k]: v }));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const stageRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const [ai, setAi] = useState(() => {
    const provider = ls.get('zk.ai.provider', 'anthropic');
    return { provider, model: ls.get(`zk.ai.model.${provider}`, PROVIDERS[provider]?.models[0]) };
  });
  const [fontsList, setFontsList] = useState([]);
  const [fontsVer, setFontsVer] = useState(0);
  const [installing, setInstalling] = useState({});
  const registered = useRef(new Set());
  const audios = useRef({});
  const play = useRef(null);
  const raf = useRef(0);
  const latest = useRef({});

  const say = useCallback((msg, kind = 'info') => {
    const item = { t: new Date().toLocaleTimeString(), msg, kind, id: Date.now() + Math.random() };
    setLog((l) => [item, ...l].slice(0, 200));
    if (kind !== 'info') setToast(item);
    if (kind === 'err') setUnreadErr((n) => n + 1);
  }, []);

  useEffect(() => { if (modal === 'settings') setUnreadErr(0); }, [modal]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), toast.kind === 'err' ? 8000 : 3500); return () => clearTimeout(id); }, [toast]);
  const T = useThumbs({ say });
  const C = useCards({ script, setScript, setDirty, tab });
  useEffect(() => { ls.set('zk.asst', asstOpen ? '1' : '0'); }, [asstOpen]);

  const bodyRef = useRef(0);
  // 썸네일 편집 단축키
  useEffect(() => {
    if (side !== 'thumbs') return;
    const h = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? T.redo() : T.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); T.redo(); return; }
      if ((e.key === ',' || e.key === '.') && T.draft) {
        const dt = (e.key === ',' ? -1 : 1) * (e.shiftKey ? 0.1 : 1001 / 30000);
        T.update((d) => ({ ...d, t: Math.round(Math.max(0, Math.min(bodyRef.current - 0.05, d.t + dt)) * 1000) / 1000 })); return;
      }
      if (!T.selLayer) return;
      if (e.key === 'Escape') T.setSelLayer(null);
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); T.update((d) => { d.layers = d.layers.filter((l) => l.id !== T.selLayer); return d; }); T.setSelLayer(null); }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault(); const k = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -k : e.key === 'ArrowRight' ? k : 0, dy = e.key === 'ArrowUp' ? -k : e.key === 'ArrowDown' ? k : 0;
        T.updateLayer(T.selLayer, (l) => ({ x: l.x + dx, y: l.y + dy }));
      }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [side, T]);
  // 카드 편집 단축키
  useEffect(() => {
    if (side !== 'cards') return;
    const h = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? C.redo() : C.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); C.redo(); return; }
      if (!C.selLayer) return;
      if (e.key === 'Escape') C.setSelLayer(null);
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); C.update((c) => { c[C.kind].layers = c[C.kind].layers.filter((l) => l.id !== C.selLayer); return c; }); C.setSelLayer(null); }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault(); const k = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -k : e.key === 'ArrowRight' ? k : 0, dy = e.key === 'ArrowUp' ? -k : e.key === 'ArrowDown' ? k : 0;
        C.updateLayer(C.selLayer, (l) => ({ x: l.x + dx, y: l.y + dy }));
      }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [side, C]);
  const setAiCfg = useCallback((v) => {
    setAi(v); ls.set('zk.ai.provider', v.provider); if (v.model) ls.set(`zk.ai.model.${v.provider}`, v.model);
  }, []);

  // ---------- 데이터 로드 ----------
  const refreshTts = useCallback(async () => setTts(await api('/api/tts')), []);
  useEffect(() => {
    api('/api/script').then((s) => {
      s.voice_settings = { ...DEFAULT_VS, ...(s.voice_settings || {}) };
      s.voice = { model_id: 'eleven_v4', voice_id: '', language_code: 'ko', ...(s.voice || {}) };
      s.pronunciation = s.pronunciation || [];
      s.voice.tone = { enabled: false, tags: '[narrator][calm]', override: true, ...(s.voice.tone || {}) };
      setScript(s);
    }).catch((e) => say(`대본 로드 실패: ${e.message}`, 'err'));
    refreshTts().catch((e) => say(`TTS 목록 로드 실패: ${e.message}`, 'err'));
    api('/api/font').then((f) => setFont(f.font)).catch(() => {});
    api('/api/fonts').then(setFontsList).catch(() => {});
  }, [refreshTts, say]);

  useEffect(() => { if (tab) ls.set('zk.tab', tab); }, [tab]);
  useEffect(() => { document.title = `${script?.project?.name || project?.name || '프로젝트'} · TTS Studio`; }, [script?.project?.name, project?.name]);
  useEffect(() => { if (script && !(script.videos || []).includes(tab)) setTab(script.videos?.[0] || ''); }, [script, tab]);
  useEffect(() => { ls.set('zk.side', side); }, [side]);
  useEffect(() => {
    ls.set('zk.elkey', remember && keys.el ? keys.el : null);
    ls.set('zk.ai.key.anthropic', remember && keys.anthropic ? keys.anthropic : null);
    ls.set('zk.ai.key.openai', remember && keys.openai ? keys.openai : null);
  }, [keys, remember]);

  // 내보내기 작업 폴링
  useEffect(() => {
    if (!exportJob?.id || exportJob.finished) return;
    const t = setInterval(async () => {
      try {
        const j = await api(`/api/export/${exportJob.id}`);
        setExportJob(j);
        if (j.finished) {
          const ok = j.items.filter((x) => x.status === 'done').length;
          say(`내보내기 끝: 완료 ${ok}/${j.items.length}`, ok === j.items.length ? 'ok' : 'err');
        }
      } catch (e) { say(e.message, 'err'); }
    }, 1000);
    return () => clearInterval(t);
  }, [exportJob?.id, exportJob?.finished, say]);

  // mp3 길이 측정
  useEffect(() => {
    Object.entries(tts).forEach(([id, info]) => {
      const k = `${id}@${info.mtime}`;
      if (durs[k] != null) return;
      const a = new Audio(); a.preload = 'metadata';
      a.onloadedmetadata = () => setDurs((d) => ({ ...d, [k]: a.duration }));
      a.src = `/api/tts/${id}.mp3?v=${info.mtime}`;
    });
  }, [tts]); // eslint-disable-line

  useEffect(() => { if (script) setScriptReady(true); }, [script]);

  // 설치된 Google 폰트 → 브라우저 FontFace 등록 (미리보기와 내보내기가 같은 TTF 사용)
  useEffect(() => {
    const todo = fontsList.filter((f) => !registered.current.has(f.cssFamily));
    if (!todo.length) return;
    Promise.all(todo.map(async (f) => {
      registered.current.add(f.cssFamily);
      try { const ff = new FontFace(f.cssFamily, `url(/api/fonts/file/${encodeURIComponent(f.file)})`); await ff.load(); document.fonts.add(ff); } catch {}
    })).then(() => setFontsVer((v) => v + 1));
  }, [fontsList]);

  const installFont = useCallback(async (family, weight) => {
    const k = `${family}|${weight}`;
    setInstalling((x) => ({ ...x, [k]: true }));
    try {
      await api('/api/fonts/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ family, weight }) });
      setFontsList(await api('/api/fonts'));
      say(`폰트 설치: ${family} ${weight}`, 'ok');
    } catch (e) { say(`폰트 설치 실패: ${e.message}`, 'err'); }
    finally { setInstalling((x) => ({ ...x, [k]: false })); }
  }, [say]);

  const setStyle = useCallback((fn) => { setScript((s) => ({ ...s, style: fn(s.style || {}) })); setDirty(true); }, []);
  const clientStyle = useMemo(() => {
    const map = {}; fontsList.forEach((f) => { map[`${f.family}|${f.weight}`] = { name: f.cssFamily, bold: false, ratio: f.ratio }; });
    return resolveStyle(script?.style || {}, map, font);
  }, [script?.style, fontsList, font]);
  const meta = script?.meta?.[tab];
  const tl = useMemo(() => buildTimeline(meta?.segs, meta?.end_card ?? 4), [meta]);
  bodyRef.current = tl.body;
  const lines = useMemo(() => [...(script?.[tab] || [])].sort((a, b) => a.start - b.start), [script, tab]);
  const insts = useMemo(() => cardInstances(C.cards, { meta: meta || {}, offs: tl.parts.map((p) => p.off), body: tl.body, total: tl.total, project: script?.project }), [C.cards, meta, tl, script?.project]);
  const setMeta = useCallback((fn) => { setScript((s) => ({ ...s, meta: { ...s.meta, [tab]: fn(s.meta[tab]) } })); setDirty(true); }, [tab]);

  // 실제로 TTS에 보낼 텍스트: 발음 입력이 있으면 그것, 없으면 자막에 발음 사전 적용
  const ttsText = useCallback((l) => (l.tts?.trim() ? l.tts : applyDict(l.text, script?.pronunciation)), [script?.pronunciation]);

  // 실제 ElevenLabs로 보내는 텍스트 = (기본 톤 태그) + 발음 텍스트
  const toneTags = (() => {
    const t = script?.voice?.tone; const id = script?.voice?.model_id || '';
    return t?.enabled && (id.startsWith('eleven_v4') || id.startsWith('eleven_v3')) ? parseTags(t.tags).join('') : '';
  })();
  const sendText = useCallback((l) => {
    const base = ttsText(l);
    if (!toneTags || !base.trim()) return base;
    if (script?.voice?.tone?.override && /^\s*\[/.test(base)) return base; // 줄 자체 태그가 우선
    return `${toneTags} ${base}`;
  }, [ttsText, toneTags, script?.voice?.tone?.override]);

  const durOf = useCallback((l) => {
    const info = tts[l.id];
    const real = info ? durs[`${l.id}@${info.mtime}`] : null;
    return real ?? estDur(ttsText(l));
  }, [tts, durs, ttsText]);

  const statusOf = useCallback((l) => {
    const info = tts[l.id];
    if (!info) return 'none';
    const m = info.meta;
    if (!m) return 'ok';
    if ((m.tts_text ?? m.text) !== sendText(l)) return 'stale';
    if (script?.voice?.voice_id && m.voice_id !== script.voice.voice_id) return 'voice';
    if (m.model_id && script?.voice?.model_id && m.model_id !== script.voice.model_id) return 'voice';
    return 'ok';
  }, [tts, script, sendText]);

  const warnings = useMemo(() => {
    const w = {};
    lines.forEach((l, i) => {
      const end = l.start + durOf(l) + 0.3;
      const nx = lines[i + 1];
      if (nx && end > nx.start) w[l.id] = `${nx.id}와 ${(end - nx.start).toFixed(1)}s 겹침`;
      if (l.start + durOf(l) > tl.total) w[l.id] = '영상 끝을 넘어감';
    });
    return w;
  }, [lines, durOf, tl]);

  latest.current = { lines, tl, durOf, gameVol };

  // ---------- 대본 편집 ----------
  const updateLine = (id, patch) => {
    setScript((s) => ({ ...s, [tab]: s[tab].map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
    setDirty(true);
  };
  const listRef = useRef(null);
  const scrollLock = useRef(false);
  const [follow, setFollow] = useState(() => ls.get('zk.follow', '1') === '1');
  const scrollToLine = useCallback((id, flash = true) => {
    const el = listRef.current?.querySelector(`[data-line="${id}"]`); if (!el) return;
    el.scrollIntoView({ block: flash ? 'nearest' : 'center', behavior: 'smooth' });
    if (flash) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }, []);
  const liveId = lines.find((l) => editTime >= l.start && editTime < l.start + durOf(l) + SUB_TAIL)?.id;
  useEffect(() => { if (follow && playing && liveId) scrollToLine(liveId, false); }, [liveId, follow, playing, scrollToLine]);
  // 선택이 바뀌면(타임라인 클릭·드래그 등) 목록을 그 대사로 스크롤 (목록에서 직접 클릭한 경우 제외)
  useEffect(() => { if (!sel) return; if (scrollLock.current) { scrollLock.current = false; return; } scrollToLine(sel); }, [sel, scrollToLine]);
  const moveLine = useCallback((id, start) => {
    setScript((s) => ({ ...s, [tab]: s[tab].map((l) => (l.id === id ? { ...l, start } : l)) })); setDirty(true);
  }, [tab]);
  const addLine = () => {
    const id = `${tab}${String(nextNum(script[tab])).padStart(2, '0')}`;
    setScript((s) => ({ ...s, [tab]: [...s[tab], { id, start: Math.round(editTime * 10) / 10, text: '' }] }));
    setSel(id); setDirty(true);
  };
  const removeLine = (id) => {
    if (!window.confirm(`${id} 대사를 삭제할까요? (생성된 mp3는 남습니다)`)) return;
    setScript((s) => ({ ...s, [tab]: s[tab].filter((l) => l.id !== id) })); setDirty(true);
  };
  const setVS = (k, v) => { setScript((s) => ({ ...s, voice_settings: { ...s.voice_settings, [k]: v } })); setDirty(true); };
  const setVoice = (k, v) => { setScript((s) => ({ ...s, voice: { ...s.voice, [k]: v } })); setDirty(true); };
  const setRules = (fn) => { setScript((s) => ({ ...s, pronunciation: fn(s.pronunciation || []) })); setDirty(true); };

  const save = useCallback(async (s = script) => {
    await api('/api/script', { method: 'PUT', body: JSON.stringify(s, null, 2), headers: { 'Content-Type': 'application/json' } });
    setDirty(false); say('script.json 저장됨', 'ok');
  }, [script, say]);

  useEffect(() => {
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save().catch((er) => say(er.message, 'err')); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [save, say]);
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // ---------- ElevenLabs ----------
  const loadVoices = async (rethrow = false) => {
    try {
      const [v, q, m] = await Promise.all([api('/api/voices', { key: apiKey }), api('/api/user', { key: apiKey }).catch(() => null),
        api('/api/models', { key: apiKey }).catch(() => null)]);
      setVoices(v); setQuota(q);
      if (m?.length) setModels(m);
      const msg = `보이스 ${v.length}개${m?.length ? `, 모델 ${m.length}개` : ''}${q ? ` · 사용 ${q.used?.toLocaleString()} / ${q.limit?.toLocaleString()}자` : ''}`;
      say(`${msg} 불러옴`, 'ok');
      return msg;
    } catch (e) { say(e.message, 'err'); if (rethrow) throw e; }
  };

  const generate = async (l, all = lines) => {
    const i = all.findIndex((x) => x.id === l.id);
    setBusy((b) => ({ ...b, [l.id]: 'gen' }));
    try {
      await api(`/api/tts/${l.id}`, {
        method: 'POST', key: apiKey, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sendText(l), subtitle: l.text, voice_id: script.voice.voice_id, model_id: script.voice.model_id,
          voice_settings: pickVS(script.voice_settings, script.voice.model_id),
          language_code: modelCaps(script.voice.model_id).lang ? script.voice.language_code || undefined : undefined,
          previous_text: context && all[i - 1] ? ttsText(all[i - 1]) : undefined,
          next_text: context && all[i + 1] ? ttsText(all[i + 1]) : undefined,
        }),
      });
      setBusy((b) => ({ ...b, [l.id]: null }));
      say(`${l.id} 생성 완료`, 'ok');
      return true;
    } catch (e) {
      setBusy((b) => ({ ...b, [l.id]: 'err' }));
      say(`${l.id} 실패: ${e.message}`, 'err');
      return false;
    }
  };

  const genOne = async (l) => {
    if (!preflight()) return;
    if (dirty) await save();
    await generate(l); await refreshTts();
  };

  const preflight = () => {
    if (!apiKey) { say('설정에서 ElevenLabs API 키를 등록하세요', 'err'); setModal('settings'); return false; }
    if (!script.voice.voice_id) { say('보이스를 선택하세요', 'err'); return false; }
    return true;
  };

  const runBatch = async (scope, onlyMissing) => {
    if (!preflight()) return;
    const keys = scope === 'all' ? [...(script.videos || [])] : [tab];
    const targets = keys.flatMap((k) => [...script[k]].sort((a, b) => a.start - b.start).map((l, _, arr) => ({ l, arr })))
      .filter(({ l }) => ttsText(l).trim() && (!onlyMissing || statusOf(l) !== 'ok'));
    if (!targets.length) { say('생성할 대사가 없습니다', 'ok'); return; }
    const chars = targets.reduce((n, { l }) => n + sendText(l).length, 0);
    if (!window.confirm(`${targets.length}개 대사, 약 ${chars}자를 생성합니다. 진행할까요?`)) return;
    if (dirty) await save();
    setBatch({ done: 0, total: targets.length, fail: 0 });
    let fail = 0;
    for (let i = 0; i < targets.length; i++) {
      const ok = await generate(targets[i].l, targets[i].arr);
      if (!ok) fail++;
      setBatch({ done: i + 1, total: targets.length, fail });
    }
    await refreshTts();
    say(`일괄 생성 끝: 성공 ${targets.length - fail} / 실패 ${fail}`, fail ? 'err' : 'ok');
    setTimeout(() => setBatch(null), 2500);
  };

  // ---------- 미리보기 엔진 ----------
  const audioFor = (l) => {
    const info = tts[l.id]; if (!info) return null;
    const cur = audios.current[l.id];
    if (cur && cur.v === info.mtime) return cur.el;
    const el = new Audio(`/api/tts/${l.id}.mp3?v=${info.mtime}`); el.preload = 'auto';
    audios.current[l.id] = { v: info.mtime, el };
    return el;
  };
  const stopAudios = () => Object.values(audios.current).forEach(({ el }) => { el.pause(); });

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current); play.current = null; setPlaying(false);
    videoRef.current?.pause(); stopAudios();
  }, []);

  const startLine = (l, offset) => {
    const el = audioFor(l); if (!el) return;
    try { el.currentTime = Math.max(0, offset); el.play().catch(() => {}); } catch {}
  };

  const startPlay = (from, stopAt = null) => {
    stop(); setShot(null);
    const v = videoRef.current; if (!v) return;
    const { lines: L, tl: T, durOf: D } = latest.current;
    from = Math.max(0, Math.min(from, T.total - 0.05));
    const st = { idx: null, endStart: null, started: new Set(), stopAt };
    const loc = editToSrc(T, from);
    if (loc) { st.idx = loc.seg; v.currentTime = loc.src; v.play().catch(() => {}); }
    else { st.endStart = performance.now() - (from - T.body) * 1000; v.pause(); }
    L.forEach((l) => {
      if (l.start <= from) { st.started.add(l.id); if (from < l.start + D(l)) startLine(l, from - l.start); }
    });
    play.current = st; setPlaying(true);
    let lastSet = -1;
    const loop = () => {
      const s = play.current; if (!s) return;
      const { lines: L2, tl: T2, gameVol: gv } = latest.current;
      if (s.idx != null) {
        const g = T2.parts[s.idx];
        if (v.currentTime >= g.e - 0.03 || v.ended) {
          s.idx++;
          if (s.idx < T2.parts.length) v.currentTime = T2.parts[s.idx].s;
          else { s.idx = null; v.pause(); s.endStart = performance.now(); }
        }
      }
      const edit = s.idx != null
        ? T2.parts[s.idx].off + Math.max(0, v.currentTime - T2.parts[s.idx].s)
        : T2.body + (performance.now() - s.endStart) / 1000;
      if (edit >= T2.total || (s.stopAt != null && edit >= s.stopAt)) { setEditTime(Math.min(edit, T2.total)); stop(); return; }
      L2.forEach((l) => { if (!s.started.has(l.id) && l.start <= edit) { s.started.add(l.id); startLine(l, edit - l.start); } });
      const speaking = Object.values(audios.current).some(({ el }) => !el.paused && !el.ended);
      // 엔딩 직전 게임 소리 페이드아웃 (내보내기 설정과 동일)
      let ef = 3; try { ef = +JSON.parse(localStorage.getItem('zk.export') || '{}').endFade || 3; } catch {}
      const fadeK = Math.max(0, Math.min(1, (T2.body - edit) / ef));
      v.volume = Math.min(1, (speaking ? gv * 0.3 : gv) * fadeK);
      if (Math.abs(edit - lastSet) > 0.04) { lastSet = edit; setEditTime(edit); }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  };

  const renderShot = async () => {
    stop();
    const t = editTime;
    setShot({ t });
    try {
      if (dirty) await save();
      const r = await fetch(`/api/frame?key=${tab}&t=${t.toFixed(2)}&w=${Math.min(2560, Math.round(frameRect.w * (window.devicePixelRatio || 1)))}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      const url = URL.createObjectURL(await r.blob());
      setShot((s) => (s && s.t === t ? { t, url } : s));
    } catch (e) { setShot({ t, err: `렌더 실패: ${e.message}` }); say(`실제 렌더 실패: ${e.message}`, 'err'); }
  };

  const seek = (t) => {
    setShot(null);
    if (play.current) return startPlay(t, play.current.stopAt);
    setEditTime(t);
    const loc = editToSrc(tl, t);
    if (loc && videoRef.current) videoRef.current.currentTime = loc.src;
  };

  const onVideoTime = () => {
    if (play.current || !videoRef.current) return;
    const e = srcToEdit(tl, videoRef.current.currentTime);
    if (e != null) setEditTime(e);
  };

  useEffect(() => { stop(); setEditTime(0); setSel(null); }, [tab, stop]);

  const focusCard = (inst) => { stop(); setShot(null); if (inst.kind === 'chapter') C.setChIdx(inst.idx); seek(cardFocusTime(inst)); };
  const playCard = (inst) => { setShot(null); startPlay(Math.max(0, inst.a - 0.5), Math.min(tl.total, inst.b + 0.3)); };
  const editInst = side === 'cards' && !playing
    ? insts.find((i) => i.kind === C.kind && (C.kind !== 'chapter' || i.idx === C.chIdx) && editTime >= i.a && editTime < i.b) : null;
  const previewLine = (l) => { setSel(l.id); startPlay(l.start - 1.5, l.start + durOf(l) + 1.2); };
  const playAudioOnly = (l) => { stop(); const el = audioFor(l); if (el) { el.currentTime = 0; el.play(); } };


  // ---------- 편집 에이전트 연동 ----------
  const findLine = (id) => { for (const k of (script?.videos || [])) { const l = script?.[k]?.find((x) => x.id === id); if (l) return { k, l }; } return null; };

  const annotate = (ops) => ops.map((op) => {
    if (op.op?.startsWith('card')) {
      const c = C.cards[op.card || C.kind]; const l = c?.layers.find((x) => x.id === op.layer);
      const before = op.op === 'card' ? Object.fromEntries(Object.keys(op.props || {}).map((k) => [k, c?.[k]])) : l ? JSON.parse(JSON.stringify(l)) : null;
      return { ...op, card: op.card || C.kind, _before: before };
    }
    if (op.op?.startsWith('thumb')) {
      const l = T.draft?.layers.find((x) => x.id === op.layer);
      return { ...op, _draft: T.draft?.id, _before: l ? JSON.parse(JSON.stringify(l)) : null };
    }
    const f = op.id ? findLine(op.id) : null;
    return f ? { ...op, _before: { start: f.l.start, text: f.l.text, tts: f.l.tts || '' } } : op;
  });

  const describeOp = (op) => {
    if (op.op === 'update') return `${op.id} 수정${op.text != null ? ` 자막="${op.text}"` : ''}${op.tts != null ? ` 발음="${op.tts}"` : ''}${op.start != null ? ` 시작=${op.start}` : ''}`;
    if (op.op === 'add') return `추가 ${op.start}s "${op.text}"`;
    if (op.op === 'delete') return `${op.id} 삭제`;
    if (op.op === 'rule_add') return `사전 ${op.from}→${op.to}`;
    if (op.op === 'rule_remove') return `사전 삭제 ${op.from}`;
    if (op.op === 'style') return `자막 스타일 ${JSON.stringify(op.style)}`;
    if (op.op === 'card') return `${op.card} 카드 설정 ${JSON.stringify(op.props)}`;
    if (op.op === 'card_layer') return `${op.card} 카드 레이어 ${op.layer} ${JSON.stringify(op.props)}`;
    if (op.op === 'card_add') return `${op.card} 카드 레이어 추가 ${JSON.stringify(op.props)}`;
    if (op.op === 'card_remove') return `${op.card} 카드 레이어 ${op.layer} 삭제`;
    if (op.op === 'thumb_layer') return `썸네일 레이어 ${op.layer} ${JSON.stringify(op.props)}`;
    if (op.op === 'thumb_add') return `썸네일 레이어 추가 ${JSON.stringify(op.props)}`;
    if (op.op === 'thumb_remove') return `썸네일 레이어 ${op.layer} 삭제`;
    if (op.op === 'thumb_bg') return `썸네일 배경 ${JSON.stringify(op.props)}`;
    return op.op;
  };

  const applyOps = (ops) => {
    // 썸네일·스타일 작업
    for (const op of ops) {
      if (op.op === 'style' && op.style) setStyle((st) => deepMergeObj(st, op.style));
      if (!op.op?.startsWith('thumb')) continue;
      if (!T.draft || (op._draft && op._draft !== T.draft.id)) { say('제안 대상 썸네일이 선택돼 있지 않습니다', 'err'); continue; }
      if (op.op === 'thumb_layer' && op.layer) T.updateLayer(op.layer, op.props || {});
      if (op.op === 'thumb_remove' && op.layer) T.update((d) => { d.layers = d.layers.filter((l) => l.id !== op.layer); return d; });
      if (op.op === 'thumb_add' && op.props) {
        const base = op.props.type === 'rect' ? rectLayer() : op.props.type === 'grad' ? gradLayer() : textLayer({ font: { ...(clientStyle.fonts.title) } });
        T.update((d) => { d.layers = [...d.layers, { ...base, ...op.props, id: base.id }]; return d; });
      }
      if (op.op === 'thumb_bg' && op.props) T.update((d) => ({ ...d, ...pick(op.props, ['t', 'zoom', 'fx', 'fy']), ...(op.props.grade ? { grade: { ...(d.grade || {}), ...op.props.grade } } : {}) }));
    }
    const cardOps = ops.filter((op) => op.op?.startsWith('card'));
    if (cardOps.length) {
      C.update((c) => {
        for (const op of cardOps) {
          const k = ['intro', 'chapter', 'end'].includes(op.card) ? op.card : C.kind; const cd = c[k];
          if (op.op === 'card' && op.props) Object.assign(cd, pick(op.props, ['enabled', 'start', 'dur', 'firstOffset', 'offset', 'fadeIn', 'fadeOut']));
          if (op.op === 'card_layer' && op.layer) cd.layers = cd.layers.map((l) => (l.id === op.layer ? mergeLayer(l, op.props) : l));
          if (op.op === 'card_remove' && op.layer) cd.layers = cd.layers.filter((l) => l.id !== op.layer);
          if (op.op === 'card_add' && op.props) {
            const f = op.props.type === 'rect' ? newCardRect : op.props.type === 'grad' ? newCardGrad : newCardText;
            const { id, ...rest } = op.props; cd.layers = [...cd.layers, mergeLayer(f(), rest)];
          }
        }
        return c;
      });
    }
    const scriptOps = ops.filter((op) => ['update', 'add', 'delete', 'rule_add', 'rule_remove'].includes(op.op));
    if (!scriptOps.length) return;
    ops = scriptOps;
    setScript((s) => {
      let n = { ...s, A: [...s.A], B: [...s.B], pronunciation: [...(s.pronunciation || [])] };
      for (const op of ops) {
        const k = op.id ? (n.A.some((l) => l.id === op.id) ? 'A' : n.B.some((l) => l.id === op.id) ? 'B' : null) : null;
        if (op.op === 'update' && k) {
          const patch = {};
          if (op.text != null) patch.text = op.text;
          if (op.tts != null) patch.tts = op.tts;
          if (op.start != null && Number.isFinite(+op.start)) patch.start = Math.round(+op.start * 10) / 10;
          n[k] = n[k].map((l) => (l.id === op.id ? { ...l, ...patch } : l));
        } else if (op.op === 'delete' && k) {
          n[k] = n[k].filter((l) => l.id !== op.id);
        } else if (op.op === 'add') {
          const t = (script.videos || []).includes(op.tab) ? op.tab : tab;
          const id = `${t}${String(nextNum(n[t])).padStart(2, '0')}`;
          n[t] = [...n[t], { id, start: Math.round((+op.start || 0) * 10) / 10, text: op.text || '', ...(op.tts ? { tts: op.tts } : {}) }];
        } else if (op.op === 'rule_add' && op.from) {
          n.pronunciation = [...n.pronunciation.filter((r) => r.from !== op.from), { from: op.from, to: op.to ?? '' }];
        } else if (op.op === 'rule_remove') {
          n.pronunciation = n.pronunciation.filter((r) => r.from !== op.from);
        }
      }
      return n;
    });
    setDirty(true);
  };

  const captureFrame = async () => {
    if (side === 'thumbs') {
      if (!T.draft) return null;
      const d = await T.renderNow();
      const r = await fetch(`/api/thumbs/${T.draft.id}.png?v=${d?.rendered || Date.now()}`);
      const b = await r.blob();
      return new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); });
    }
    if (side === 'cards') {
      try {
        if (dirty) await save();
        const r = await fetch(`/api/frame?key=${tab}&t=${editTime.toFixed(2)}&w=1280`); if (!r.ok) return null;
        const b = await r.blob();
        return await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); });
      } catch { return null; }
    }
    const v = videoRef.current;
    if (!v || !v.videoWidth || editTime >= tl.body) return null;
    try {
      const w = 1024; const c = document.createElement('canvas');
      c.width = w; c.height = Math.round((v.videoHeight / v.videoWidth) * w);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.8);
    } catch { return null; }
  };

  const buildContext = () => {
    const common = [
      '당신은 영상 나레이션·자막·썸네일 제작 도구에 내장된 어시스턴트다. 사용자는 대사·TTS → 자막 스타일 → 카드 → 썸네일 → 업로드 문구 → MP4 내보내기 과정을 이 도구로 진행한다.',
      `프로젝트: ${script.project?.name || ''} (브랜드 문구 ${script.project?.brand || '-'}, 대표 키워드 ${script.project?.tagline || '-'})`,
      script.project?.brief ? `프로젝트 설명·톤(사용자 작성, 사실의 근거로 사용): ${script.project.brief}` : '프로젝트 설명 없음 — 영상·대본에서 확인되는 것만 말할 것.',
      `프로젝트 영상: ${(script.videos || []).map((k) => `${k}=${script.meta?.[k]?.title || ''}`).join(', ')}`,
      `현재 사용자가 보고 있는 작업: ${{ lines: '대사/나레이션 편집', style: '자막 스타일 편집', cards: '영상 카드(인트로·챕터·엔딩) 편집', thumbs: '썸네일 편집', youtube: '유튜브 업로드 제목·설명·태그 작성(업로드 탭에 전용 AI 추천 버튼 있음)' }[side]}. 질문이 다른 작업에 관한 것이어도 도와준다.`,
      '변경은 반드시 propose_edits 도구로 제안한다(사용자가 항목별 적용). 설명은 한국어로 짧게. 과장·확인 안 된 사실 단정 금지.',
      `현재 자막 스타일: ${JSON.stringify({ fonts: clientStyle.fonts, colors: clientStyle.colors, sub: clientStyle.sub })}`,
      `설치된 폰트(family/weight): ${JSON.stringify(fontsList.map((f) => [f.family, f.weight]))}. style 변경 시 설치된 폰트를 우선 사용.`,
      '- op=style: style에 바꿀 부분만 (예: {"colors":{"accent":"#FFD23F"}}, {"sub":{"size":72}}, {"fonts":{"title":{"family":"Black Han Sans","weight":400}}})',
      '영상 카드(영상에 번인되는 인트로·챕터·엔딩 카드, 썸네일과 별개) — 어떤 작업 화면에서든 수정 제안 가능',
      '- 프레임 2560x1440(썸네일 1280x720의 정확히 2배: 썸네일 값을 카드에 옮길 땐 x,y,w,h,size,spacing,outline.width,shadow.dist,blur ×2). 레이어 모델은 썸네일과 같음 + alpha(텍스트 불투명도), anim.',
      '- color "@text"|"@accent"|"@outline", font "@title"|"@sub" = 자막 스타일 연동. 직접 지정은 "#RRGGBB", {family,weight}.',
      '- anim: {delay(초), dx, dy(등장 시작 위치 오프셋 px), dur(이동 시간), fade(bool)}. 텍스트 변수: 챕터 {num} {kr} {en}, 공통 {date} {title}.',
      '- op=card {card, props:{enabled,start,dur,firstOffset,offset,fadeIn,fadeOut}}, op=card_layer {card, layer, props}, op=card_add {card, props:{type,...}}, op=card_remove {card, layer}. 레이어 전체 교체는 card_remove 여러 개 + card_add 여러 개로.',
      `- 영상 정보(${tab}): ${JSON.stringify({ title: meta?.title, date: meta?.date, chapters: meta?.chapters, end_card: meta?.end_card })}`,
      `- 카드 정의(${tab}): ${JSON.stringify(C.cards)}`,
      '- 사용자는 카드 탭의 "썸네일에서 가져오기"로 썸네일 레이어를 그대로 옮길 수도 있다(필요하면 안내).',
    ];
    if (side === 'thumbs') {
      const d = T.draft;
      return [...common,
        '썸네일 편집 규칙',
        '- 캔버스 1280x720. 텍스트 레이어: x,y는 anchor(ASS \\an, 7=왼쪽위 8=위중앙 9=오른쪽위 4/5/6 가운데 1/2/3 아래) 기준점, size=줄높이(px), color, outline{width,color}, shadow{dist,color,alpha}, spacing, font{family,weight}.',
        '- rect: x,y,w,h,color,alpha(불투명도),blur / grad: x,y,w,h,color,from,to(불투명도),dir(right|left|down|up: 짙은 쪽에서 옅어지는 방향).',
        '- op=thumb_layer {layer:레이어id, props:{바꿀 속성}}, op=thumb_add {props:{type:"text"|"rect"|"grad", ...}}, op=thumb_remove {layer}, op=thumb_bg {props:{t, zoom(1~2.5), fx, fy, grade:{contrast,saturation,brightness}}}.',
        '- 작은 크기(모바일 목록)에서도 읽히는 큰 글자, 높은 대비, 핵심 피사체를 가리지 않는 배치. 이미지가 첨부되면 그것이 현재 썸네일 렌더 결과다.',
        d ? `선택된 썸네일 (${d.key}, 장면 ${d.t}s, 확대 ${d.zoom || 1}): ${JSON.stringify(d.layers)}` : '선택된 썸네일 없음 — 썸네일 패널에서 초안을 고르거나 만들라고 안내.',
      ].join('\n');
    }
    if (side === 'cards') {
      const d = T.draft;
      return [...common,
        `현재 선택 카드: ${C.kind}${C.kind === 'chapter' ? ` (챕터 ${C.chIdx + 1} 미리보기)` : ''}, 선택 레이어: ${C.selLayer || '없음'}, 재생 위치 ${editTime.toFixed(1)}s. 이미지가 첨부되면 현재 위치의 실제 렌더(카드·자막 포함)다.`,
        d ? `썸네일 편집기에서 선택된 썸네일 (${d.key}, 1280x720 좌표): ${JSON.stringify(d.layers)}` : `썸네일 초안 목록(${tab}): ${JSON.stringify(T.list.filter((x) => x.key === tab).slice(0, 6).map((x) => ({ label: x.label, layers: x.layers })))}`,
      ].join('\n');
    }
    if (side === 'style') {
      return [...common,
        '자막 스타일 규칙: 자막은 2560x1440 기준 크기. 썸네일·카드와 톤을 맞추고, 영상 하단의 중요한 정보(UI·HUD 등)를 가리지 않도록 아래 여백(marginV)을 조절.',
        '이미지가 첨부되면 현재 영상 화면(자막 미리보기 없음)이다.',
      ].join('\n');
    }
    return [...common, '', buildLinesContext()].join('\n');
  };

  const buildLinesContext = () => {
    const chapters = (meta?.chapters || []).map((c, i) => ({ chapter: c.num, name: c.kr, edit_start: +(tl.parts[i]?.off ?? 0).toFixed(1),
      edit_end: +((tl.parts[i]?.off ?? 0) + (tl.parts[i]?.dur ?? 0)).toFixed(1) }));
    const L = lines.map((l) => {
      const info = tts[l.id]; const real = info && durs[`${l.id}@${info.mtime}`];
      return { id: l.id, start: l.start, end: +(l.start + durOf(l)).toFixed(1), dur_source: real ? 'mp3' : 'estimate',
        text: l.text, tts_custom: l.tts || '', tts_effective: ttsText(l), status: statusOf(l), warning: warnings[l.id] || undefined };
    });
    const act = lines.find((l) => editTime >= l.start && editTime < l.start + durOf(l) + SUB_TAIL);
    return [
      '나레이션 톤: 프로젝트 설명의 톤을 따른다. 화면/대본에서 알 수 없는 내용은 단정하지 말고 추측이라고 밝힐 것.',
      '대사 편집 규칙 (op=update/add/delete/rule_add/rule_remove)',
      '- text = 화면 자막(표기 그대로, 영어 고유명사 허용). 한 줄 약 30자, 최대 2줄 권장.',
      '- tts = TTS 발음 텍스트. 비어 있으면 발음 사전이 자막에 적용된 값이 쓰인다. 반복되는 표기는 rule_add로 사전에 넣고, 한 줄만 다른 경우에만 tts를 쓴다. tts를 자동으로 되돌리려면 빈 문자열.',
      `- TTS 모델: ${script.voice.model_id}. ${modelCaps(script.voice.model_id).tags ? 'SSML 미지원, 대신 tts 안에 [excited] [whispers] 같은 오디오 태그 사용 가능(자막에는 넣지 말 것).' : 'SSML/오디오 태그 사용 금지.'} 영문 약어·숫자·기호는 tts에서 한글 읽기로.`,
      toneTags ? `- 기본 톤 태그 ${toneTags} 가 모든 발음 텍스트 앞에 자동으로 붙는다(줄 tts가 태그로 시작하면 ${script.voice.tone.override ? '그 줄은 기본 톤 대신 자체 태그 사용' : '기본 톤 뒤에 추가'}). 같은 태그를 tts에 중복해서 넣지 말 것. 특정 줄만 톤을 바꾸고 싶을 때만 tts 앞에 태그.` : '- 기본 톤 태그 없음.',
      '- 한국어 TTS는 약 초당 7자. 대사 end + 0.3초 < 다음 대사 start 가 되도록. start는 편집본 기준 초(0.1 단위).',
      `- 편집본 길이 ${tl.total.toFixed(1)}초, ${tl.body.toFixed(1)}초부터 엔딩 카드(검은 화면). 첫 5.6초는 타이틀 카드가 화면을 덮는다.`,
      '',
      `현재 영상: ${tab} = ${meta?.title}`,
      chapters.length ? `챕터(편집본 시각): ${JSON.stringify(chapters)}` : '챕터 없음',
      `재생 위치: ${editTime.toFixed(1)}초${act ? `, 현재 자막 ${act.id}` : ''}${sel ? `, 선택된 대사 ${sel}` : ''}`,
      `발음 사전: ${JSON.stringify(script.pronunciation || [])}`,
      ...(script.videos || []).filter((k) => k !== tab).map((k) => `다른 영상 ${k}(${script.meta?.[k]?.title || ''}) 대사 id들: ${(script[k] || []).map((l) => l.id).join(', ')} (요청 시에만 수정)`),
      `대사 목록: ${JSON.stringify(L)}`,
      '사용자 메시지에 이미지가 있으면 그것은 현재 재생 위치의 영상 화면이다.',
    ].join('\n');
  };

  // ---------- 내보내기 ----------
  const summaryOf = (k) => {
    const m = script?.meta?.[k]; const T = buildTimeline(m?.segs, m?.end_card ?? 4);
    const L = [...(script?.[k] || [])].sort((a, b) => a.start - b.start);
    const r = { count: L.length, ok: 0, stale: 0, none: 0, overlaps: 0, total: T.total };
    L.forEach((l, i) => {
      const st = statusOf(l); if (st === 'ok') r.ok++; else if (st === 'none') r.none++; else r.stale++;
      if (L[i + 1] && l.start + durOf(l) + 0.3 > L[i + 1].start) r.overlaps++;
    });
    return r;
  };
  const startExport = async (opt) => {
    if (!opt) { setExportJob(null); return; }
    const { id } = await api('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opt) });
    setExportJob({ id, items: opt.targets.map((k) => ({ key: k, status: 'queued', progress: 0 })), finished: false });
    say(`내보내기 시작 (${opt.targets.join(', ')})`, 'ok');
  };
  const cancelExport = async () => { if (exportJob?.id) await api(`/api/export/${exportJob.id}/cancel`, { method: 'POST' }).catch(() => {}); };

  // ---------- 렌더 ----------
  if (!script) return <div className="boot">프로젝트 불러오는 중… <small>{log[0]?.msg}</small></div>;

  // ---- 영상 추가·설정·삭제 ----
  const saveVideo = async (m, key) => {
    const isNew = !key; const k = key || nextKey(script);
    const next = { ...script, meta: { ...script.meta, [k]: { ...(script.meta[k] || {}), ...m } }, videos: isNew ? [...script.videos, k] : script.videos, [k]: script[k] || [] };
    setScript(next); setVmodal(null); setTab(k);
    try { await save(next); say(isNew ? `영상 추가: ${m.title}` : `영상 설정 저장: ${m.title}`, 'ok'); } catch (e) { say(e.message, 'err'); }
  };
  const deleteVideo = async (k) => {
    const { [k]: _l, ...rest } = script; const { [k]: _m, ...meta2 } = script.meta;
    const next = { ...rest, meta: meta2, videos: script.videos.filter((x) => x !== k) };
    setScript(next); setVmodal(null); setTab(next.videos[0] || '');
    try { await save(next); say('영상을 프로젝트에서 뺐습니다', 'ok'); } catch (e) { say(e.message, 'err'); }
  };
  const setProject = (patch) => { setScript((x) => ({ ...x, project: { ...(x.project || {}), ...patch } })); setDirty(true); };
  const projectModals = (<>
    {vmodal && <VideoModal vkey={vmodal.key} meta={vmodal.key ? script.meta[vmodal.key] : null} isNew={!!vmodal.isNew} say={say}
      onSave={(m) => saveVideo(m, vmodal.isNew ? null : vmodal.key)} onDelete={() => deleteVideo(vmodal.key)} onClose={() => setVmodal(null)} />}
    {phome && <ProjectHome asModal onClose={() => setPhome(false)} />}
    {modal === 'project' && <ProjectSettings project={script.project || {}} onChange={setProject} dirty={dirty} onSave={() => save()} onClose={() => setModal(null)} say={say} />}
  </>);
  const headerEl = (
      <header>
        <div className="brand">
          <button className="projbtn" title="프로젝트 전환·새로 만들기" onClick={() => setPhome(true)}><b>{script.project?.name || project?.name || '프로젝트'}</b><i>▾</i></button>
          <span>TTS STUDIO</span>
          <button className="ghost sm" title="프로젝트 설정 (브랜드 문구·설명·출력 폴더)" onClick={() => setModal('project')}>프로젝트 설정</button>
        </div>
        <div className="cred">
          {quota && <span className="quota" title="ElevenLabs 사용량">TTS {quota.used?.toLocaleString()} / {quota.limit?.toLocaleString()}자</span>}
          {!apiKey && <button className="accent" onClick={() => setModal('settings')}>API 키 등록 필요</button>}
          {apiKey && !voices.length && <button className="ghost" onClick={() => loadVoices()}>보이스 불러오기</button>}
          <button className={`savebtn ${dirty ? 'dirty' : ''}`} title={dirty ? '저장하지 않은 변경 (대사·자막 스타일·카드·업로드 문구) — Ctrl+S' : '모든 변경이 저장됨'}
            onClick={() => dirty && save().catch((e) => say(e.message, 'err'))}>{dirty ? '● 저장' : '✓ 저장됨'}</button>
          {toast && <button className={`toast ${toast.kind}`} title="설정 → 로그에서 전체 보기" onClick={() => { setSetFocus('log'); setModal('settings'); setToast(null); }}>{toast.msg}</button>}
          <button onClick={() => { setSetFocus(unreadErr ? 'log' : null); setModal('settings'); }}>⚙ 설정{unreadErr > 0 && <i className="errbadge" title="확인하지 않은 오류">{unreadErr}</i>}</button>
          <button className="primary export-btn" onClick={() => setModal('export')}>
            {exportJob && !exportJob.finished
              ? `내보내는 중 ${Math.round(((exportJob.items.reduce((n, x) => n + (x.status === 'done' ? 1 : x.progress || 0), 0)) / exportJob.items.length) * 100)}%`
              : '⬇ MP4 내보내기'}
            {exportJob && !exportJob.finished && <i className="mini" style={{ width: `${(exportJob.items.reduce((n, x) => n + (x.status === 'done' ? 1 : x.progress || 0), 0) / exportJob.items.length) * 100}%` }} />}
          </button>
        </div>
      </header>
  );
  if (!script.videos?.length || !meta) {
    return (
      <div className="app">
        {headerEl}
        <div className="empty-proj">
          <h2>{script.project?.name}</h2>
          <p className="muted">아직 영상이 없습니다. 작업할 영상을 추가하세요. 원본 파일은 복사하지 않고 그 위치를 그대로 씁니다.</p>
          <button className="primary" onClick={() => setVmodal({ isNew: true })}>＋ 영상 추가</button>
        </div>
        {projectModals}
        {modal === 'settings' && <SettingsModal keys={keys} setKey={setKey} remember={remember} setRemember={setRemember} ai={ai} setAi={setAiCfg}
          onTestEl={() => loadVoices(true)} onClose={() => setModal(null)} say={say} log={log} clearLog={() => setLog([])} focus={setFocus} />}
      </div>
    );
  }

  const active = lines.find((l) => editTime >= l.start && editTime < l.start + durOf(l) + SUB_TAIL);
  const inEnd = editTime >= tl.body;
  const chapter = (meta?.chapters || []).map((c, i) => ({ ...c, at: tl.parts[i]?.off ?? 0 }))
    .filter((c) => editTime >= c.at && editTime < c.at + 6).pop();
  const counts = lines.reduce((m, l) => { const s = statusOf(l); m[s] = (m[s] || 0) + 1; return m; }, {});
  const todoChars = lines.filter((l) => statusOf(l) !== 'ok').reduce((n, l) => n + sendText(l).length, 0);
  const caps = modelCaps(script.voice.model_id);
  const modelList = models.some((m) => m.model_id === script.voice.model_id) ? models
    : [{ model_id: script.voice.model_id, name: script.voice.model_id }, ...models];
  const voiceName = voices.find((v) => v.voice_id === script.voice.voice_id)?.name;

  return (
    <div className="app">
      {headerEl}

      <div className="layout" style={{ gridTemplateColumns: `minmax(380px, 1fr) 6px ${lay.mid}px ${asstOpen ? `6px ${lay.asst}px` : '44px'}` }}>
        <section className="left">
          <nav className="tabs">
            {script.videos.map((k) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} onDoubleClick={() => setVmodal({ key: k })} title="더블클릭: 영상 설정">
                {script.meta[k]?.title || k}<small>{(script[k] || []).length}</small>
                {tab === k && <i className="vset" title="영상 설정 (파일·구간·챕터)" onClick={(e) => { e.stopPropagation(); setVmodal({ key: k }); }}>⚙</i>}
              </button>
            ))}
            <button className="addvid" title="영상 추가" onClick={() => setVmodal({ isNew: true })}>＋ 영상</button>
            <span className="grow" />
            <span className="len">편집본 {fmt(tl.total)}</span>
          </nav>

          {side === 'thumbs' && (
            <div className="thumbwork">
              <div ref={canvasWrapRef} className="tcanvas-wrap" style={lay.canvasH ? { '--maxh': `${lay.canvasH}px` } : undefined}>
                <ThumbCanvas draft={T.draft?.key === tab ? T.draft : null} fontsList={fontsList} fallbackFont={font} fontsVer={fontsVer}
                  selLayer={T.selLayer} setSelLayer={T.setSelLayer} updateLayer={T.updateLayer} beginGesture={T.beginGesture} endGesture={T.endGesture} compare={compare} />
              </div>
              <Splitter axis="y" getStart={() => canvasWrapRef.current?.querySelector('.tcanvas')?.clientHeight || 400}
                onDrag={(d, v) => setL('canvasH', clamp(v + d, 180, 1400))} onReset={() => setL('canvasH', null)} />
              {T.draft?.key === tab && (
                <ThumbInspector T={T} body={tl.body} editTime={editTime} style={clientStyle} fontsList={fontsList} onInstallFont={installFont}
                  compare={compare} setCompare={setCompare} />
              )}
            </div>
          )}
          <div className="videowork" style={{ display: side === 'thumbs' ? 'none' : undefined }}>
          <div className="stagewrap">
          <div className="stage" ref={stageRef} style={lay.stageH ? { width: `min(100%, ${(lay.stageH * 16) / 9}px)` } : undefined}>
            <video ref={videoRef} src={`/api/video/${tab}`} preload="metadata" onTimeUpdate={onVideoTime}
              onClick={() => (playing ? stop() : startPlay(editTime))} />
            <FrameOverlay rect={frameRect} t={editTime} st={clientStyle} fontsReady={fontsVer} fontsList={fontsList} fallbackFont={font}
              lines={lines.map((l) => ({ start: l.start, dur: durOf(l), text: l.text }))}
              insts={insts} hide={editInst ? `${editInst.kind}:${editInst.idx}` : null} />
            {editInst && !shot && <CardEditOverlay rect={frameRect} inst={editInst} st={clientStyle} C={C} fontsList={fontsList} fallbackFont={font} fontsVer={fontsVer} />}
            {shot && (
              <div className="shot" style={{ left: frameRect.x, top: frameRect.y, width: frameRect.w, height: frameRect.h }}>
                {shot.url ? <img src={shot.url} alt="실제 렌더" /> : <div className="shot-wait">{shot.err || 'ffmpeg로 렌더 중…'}</div>}
                <span className="shot-tag">ffmpeg 실제 렌더 · {fmt(shot.t)} <button className="ghost" onClick={() => setShot(null)}>✕</button></span>
              </div>
            )}
          </div>

          <Timeline tl={tl} lines={lines} durOf={durOf} statusOf={statusOf} warnings={warnings} playing={playing}
            editTime={editTime} sel={sel} onSeek={seek} onSel={(l, keep) => { setSel(l.id); if (!keep) seek(Math.max(0, l.start - 0.5)); }}
            onMove={moveLine} onDragStart={stop} onDrop={(id) => scrollToLine(id)}
            chapters={meta?.chapters || []} insts={insts} thumbs={T.list.filter((d) => d.key === tab)}
            onCardClick={(inst) => { setSide('cards'); C.setKind(inst.kind); focusCard(inst); }}
            onCardDragStart={(inst) => { if (inst.kind === 'intro') C.beginGesture(); }}
            onCardMove={(inst, a) => {
              if (inst.kind === 'intro') C.updateCard('intro', { start: a }, { commit: false });
              else if (inst.kind === 'chapter') setMeta((m) => ({ ...m, chapters: (m.chapters || []).map((c, i) => (i === inst.idx ? { ...c, cardAt: Math.round((a - (tl.parts[i]?.off ?? 0)) * 100) / 100 } : c)) }));
            }}
            onThumbClick={(d) => { setSide('thumbs'); T.select(d.id); }} />

          <div className="transport">
            <button className="primary" onClick={() => (playing ? stop() : startPlay(editTime))}>{playing ? '■ 정지' : '▶ 편집본 재생'}</button>
            <button onClick={() => seek(0)}>⏮ 처음</button>
            <span className="tc">{fmt(editTime)} <small>/ {fmt(tl.total)}</small></span>
            <button title="현재 위치를 최종 내보내기와 똑같이(ffmpeg + 자막) 한 프레임 렌더해서 비교" onClick={renderShot}>🎞 실제 렌더 확인</button>
            <span className="grow" />
            <label className="field inline"><span>게임 볼륨</span>
              <input type="range" min="0" max="1" step="0.05" value={gameVol} onChange={(e) => setGameVol(+e.target.value)} /></label>
          </div>
          <Splitter axis="y" getStart={() => stageRef.current?.clientHeight || 400}
            onDrag={(d, v) => setL('stageH', clamp(v + d, 160, 1400))} onReset={() => setL('stageH', null)} />
          </div>

          {side === 'cards' && <CardInspector C={C} st={clientStyle} fontsList={fontsList} onInstallFont={installFont} />}
          {side !== 'cards' && (<>
          <Section id="voice" title="보이스" className="voice" defaultOpen={!script.voice.voice_id}
            summary={`${voiceName || (script.voice.voice_id ? script.voice.voice_id.slice(0, 8) + '…' : '미선택')} · ${modelList.find((m) => m.model_id === script.voice.model_id)?.name || script.voice.model_id}${toneTags ? ` · 톤 ${toneTags}` : ''}`}>
            <div className="row">
              <label className="field grow"><span>Voice {voiceName ? `· ${voiceName}` : ''}</span>
                {voices.length ? (
                  <select value={script.voice.voice_id} onChange={(e) => setVoice('voice_id', e.target.value)}>
                    <option value="">선택…</option>
                    {voices.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name} {[v.labels.language, v.labels.gender, v.labels.accent, v.category].filter(Boolean).join(' · ')}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={script.voice.voice_id} placeholder="Voice ID 직접 입력 또는 ‘보이스 불러오기’" onChange={(e) => setVoice('voice_id', e.target.value.trim())} />
                )}
              </label>
              {voices.find((v) => v.voice_id === script.voice.voice_id)?.preview_url && (
                <button onClick={() => new Audio(voices.find((v) => v.voice_id === script.voice.voice_id).preview_url).play()}>샘플 ▶</button>
              )}
              <label className="field"><span>Model</span>
                <select value={script.voice.model_id} onChange={(e) => setVoice('model_id', e.target.value)}>
                  {modelList.map((m) => <option key={m.model_id} value={m.model_id}>{m.name}</option>)}
                </select>
              </label>
              {caps.lang && (
                <label className="field lang"><span>언어</span>
                  <input value={script.voice.language_code || ''} placeholder="ko" onChange={(e) => setVoice('language_code', e.target.value.trim())} />
                </label>
              )}
            </div>
            <div className="sliders">
              {[['stability', '안정성', 0, 1], ['similarity_boost', '유사도', 0, 1], ['style', '스타일 과장', 0, 1], ['speed', '속도', 0.7, 1.2]]
                .filter(([k]) => caps.keys.includes(k)).map(([k, n, a, b]) => (
                  <label key={k} className="field"><span>{n} <b>{Number(script.voice_settings[k]).toFixed(2)}</b></span>
                    <input type="range" min={a} max={b} step="0.05" value={script.voice_settings[k]} onChange={(e) => setVS(k, +e.target.value)} />
                  </label>
                ))}
              <div className="checks">
                {caps.keys.includes('use_speaker_boost') && (
                  <label className="chk"><input type="checkbox" checked={!!script.voice_settings.use_speaker_boost} onChange={(e) => setVS('use_speaker_boost', e.target.checked)} />Speaker boost</label>
                )}
                <label className="chk" title="앞뒤 대사의 발음 텍스트를 함께 보내 억양을 자연스럽게 이어줌"><input type="checkbox" checked={context} onChange={(e) => setContext(e.target.checked)} />앞뒤 문맥 연결</label>
              </div>
              {caps.tags ? (
                <ToneEditor tone={script.voice.tone} onChange={(t) => setVoice('tone', { ...script.voice.tone, ...t })}
                  sample={(lines.find((l) => l.id === sel) || lines[0]) ? sendText(lines.find((l) => l.id === sel) || lines[0]) : ''} />
              ) : (
                <p className="hint">기본 톤(오디오 태그)은 Eleven v3/v4 모델에서만 쓸 수 있습니다.</p>
              )}
            </div>
          </Section>

          <Section id="dict" title="발음 사전" className="dict"
            summary={`규칙 ${(script.pronunciation || []).length}개 · 자막 → 발음 자동 치환 (발음 칸이 비어 있을 때)`}>
            <div className="rules">
              {(script.pronunciation || []).map((r, i) => (
                <div key={i} className="rule">
                  <input value={r.from} placeholder="자막 표기" onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
                  <span>→</span>
                  <input value={r.to} placeholder="읽는 법" onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
                  <span className="muted">{lines.filter((l) => r.from && !l.tts?.trim() && l.text.includes(r.from)).length}줄</span>
                  <button className="ghost" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
            <button onClick={() => setRules((rs) => [...rs, { from: '', to: '' }])}>+ 규칙 추가</button>
          </Section>

          </>)}
          </div>
        </section>

        <Splitter axis="x" getStart={() => lay.mid} onDrag={(d, v) => setL('mid', clamp(v - d, 300, 1100))} onReset={() => setL('mid', LAYOUT0.mid)} />
        <section className="right">
          <nav className="sidetabs">
            <button className={side === 'lines' ? 'on' : ''} onClick={() => setSide('lines')}>대사 <small>{lines.length}</small></button>
            <button className={side === 'style' ? 'on' : ''} onClick={() => setSide('style')}>자막 스타일</button>
            <button className={side === 'cards' ? 'on' : ''} onClick={() => { setSide('cards'); const i = insts.find((x) => x.kind === C.kind && (C.kind !== 'chapter' || x.idx === C.chIdx)); if (i && !(editTime >= i.a && editTime < i.b)) focusCard(i); }}>카드</button>
            <button className={side === 'thumbs' ? 'on' : ''} onClick={() => { setSide('thumbs'); stop(); }}>썸네일 <small>{T.list.filter((d) => d.key === tab).length}</small></button>
            <button className={side === 'youtube' ? 'on' : ''} onClick={() => setSide('youtube')} title="유튜브 업로드용 제목·설명·태그">업로드</button>
          </nav>
          {side === 'style' ? (
            <div className="sidescroll"><StylePanel sample={`${script.project?.brand || ''} ${script.project?.tagline || ''} 가나다 123`.trim()} style={script.style} setStyle={setStyle} installed={fontsList} onInstall={installFont} installing={installing} /></div>
          ) : side === 'youtube' ? (
            <YoutubePanel meta={meta} setMeta={setMeta} tl={tl} tab={tab} ai={ai} aiKey={keys[ai.provider]} onOpenSettings={() => setModal('settings')}
              thumbs={T.list} say={say} ensureSaved={async () => { if (dirty) await save(); }} />
          ) : side === 'cards' ? (
            <CardsPanel C={C} meta={meta} insts={insts} onFocus={focusCard} onPlay={playCard} setMeta={setMeta} endDur={meta?.end_card ?? 4} thumbs={T.list} tab={tab} st={clientStyle} say={say} />
          ) : side === 'thumbs' ? (
            <ThumbsSide T={T} tab={tab} editTime={editTime} ai={ai} aiKey={keys[ai.provider]} onOpenSettings={() => setModal('settings')} />
          ) : (<>
          <div className="listhead">
            <div className="stats">
              <span className="s-ok">완료 {counts.ok || 0}</span>
              <span className="s-stale">변경 {(counts.stale || 0) + (counts.voice || 0)}</span>
              <span className="s-none">없음 {counts.none || 0}</span>
              <span className="muted">생성 필요 {todoChars}자</span>
            </div>
            <div className="actions">
              <button onClick={addLine}>+ 대사 (재생 위치)</button>
              <label className="chk" title="재생 중 지금 나오는 대사로 목록을 자동 스크롤"><input type="checkbox" checked={follow} onChange={(e) => { setFollow(e.target.checked); ls.set('zk.follow', e.target.checked ? '1' : '0'); }} />재생 따라가기</label>
            </div>
          </div>

          <ol className="lines" ref={listRef}>
            {lines.map((l) => {
              const st = statusOf(l); const d = durOf(l); const real = !!(tts[l.id] && durs[`${l.id}@${tts[l.id].mtime}`]);
              const b = busy[l.id];
              return (
                <li key={l.id} data-line={l.id} className={`line ${sel === l.id ? 'sel' : ''} ${active?.id === l.id ? 'live' : ''}`} onClick={() => { scrollLock.current = true; setSel(l.id); }}>
                  <div className="lh">
                    <b className="id">{l.id}</b>
                    <span className={`badge ${st}`}>{{ ok: '생성됨', stale: '대사 변경', voice: '보이스 변경', none: '미생성' }[st]}</span>
                    <label className="start">
                      <input type="number" step="0.1" min="0" value={l.start} onChange={(e) => updateLine(l.id, { start: +e.target.value })} />
                      <button title="현재 재생 위치로" onClick={(e) => { e.stopPropagation(); updateLine(l.id, { start: Math.round(editTime * 10) / 10 }); }}>⌖</button>
                    </label>
                    <span className="dur">{real ? '' : '≈'}{d.toFixed(1)}s</span>
                    <span className="grow" />
                    <button title="편집본 위에서 미리보기" onClick={(e) => { e.stopPropagation(); previewLine(l); }}>▶ 영상</button>
                    <button title="음성만 듣기" disabled={!tts[l.id]} onClick={(e) => { e.stopPropagation(); playAudioOnly(l); }}>♪</button>
                    <button className={st === 'ok' ? '' : 'accent'} disabled={b === 'gen' || !!batch}
                      onClick={(e) => { e.stopPropagation(); genOne(l); }}>{b === 'gen' ? '생성 중…' : st === 'ok' ? '재생성' : '생성'}</button>
                    <button className="ghost" title="삭제" onClick={(e) => { e.stopPropagation(); removeLine(l.id); }}>✕</button>
                  </div>
                  <div className="pair">
                    <label><span>자막</span>
                      <textarea rows={2} value={l.text} onChange={(e) => updateLine(l.id, { text: e.target.value })} /></label>
                    <label className={l.tts?.trim() ? 'custom' : ''}><span>발음{l.tts?.trim() ? '' : ' (자동)'}</span>
                      <textarea rows={2} value={l.tts || ''} placeholder={applyDict(l.text, script.pronunciation)}
                        onChange={(e) => updateLine(l.id, { tts: e.target.value })} />
                      {!l.tts?.trim() && (
                        <button className="ghost fill" title="자동 발음 텍스트를 복사해서 직접 고치기"
                          onClick={(e) => { e.stopPropagation(); updateLine(l.id, { tts: applyDict(l.text, script.pronunciation) }); }}>편집</button>
                      )}
                      {l.tts?.trim() && (
                        <button className="ghost fill" title="발음 입력을 비우고 자동(사전 적용)으로 되돌리기"
                          onClick={(e) => { e.stopPropagation(); updateLine(l.id, { tts: '' }); }}>자동</button>
                      )}
                    </label>
                  </div>
                  <div className="lf">
                    <span className="muted">자막 {l.text.length}자 · 발음 {ttsText(l).length}자</span>
                    {toneTags && sendText(l) !== ttsText(l) && <span className="tonebadge" title="보이스 탭의 기본 톤이 앞에 붙어 전송됩니다">+ {toneTags}</span>}
                    {warnings[l.id] && <span className="warn">⚠ {warnings[l.id]}</span>}
                    {b === 'err' && <span className="warn">생성 실패 — 로그 확인</span>}
                  </div>
                </li>
              );
            })}
          </ol>

          <footer className="batch">
            {batch ? (
              <div className="progress"><div style={{ width: `${(batch.done / batch.total) * 100}%` }} />
                <span>{batch.done} / {batch.total} 생성 중{batch.fail ? ` · 실패 ${batch.fail}` : ''}</span></div>
            ) : (
              <>
                <button className="primary" onClick={() => runBatch('tab', true)}>이 영상 미생성·변경분 생성</button>
                <button onClick={() => runBatch('tab', false)}>이 영상 전체 재생성</button>
              </>
            )}
          </footer>
          </>)}
        </section>

        {asstOpen && <Splitter axis="x" getStart={() => lay.asst} onDrag={(d, v) => setL('asst', clamp(v - d, 260, 900))} onReset={() => setL('asst', LAYOUT0.asst)} />}
        <aside className={`asst ${asstOpen ? '' : 'closed'}`}>
          <div className="asst-h">
            {asstOpen && <><b>AI 어시스턴트</b><span className="muted sm">{{ lines: '대사', style: '자막 스타일', thumbs: '썸네일' }[side]} 작업 중</span><span className="grow" /></>}
            <button className="ghost" title={asstOpen ? '접기' : 'AI 어시스턴트 열기'} onClick={() => setAsstOpen((o) => !o)}>{asstOpen ? '⟩' : '✦'}</button>
          </div>
          <div className="asst-b" style={{ display: asstOpen ? undefined : 'none' }}>
            <Agent keys={keys} ai={ai} mode={side} onOpenSettings={() => setModal('settings')} buildContext={buildContext} captureFrame={captureFrame}
              applyOps={applyOps} annotate={annotate} describeOp={describeOp} say={say} />
          </div>
        </aside>
      </div>
      {modal === 'settings' && (
        <SettingsModal keys={keys} setKey={setKey} remember={remember} setRemember={setRemember} ai={ai} setAi={setAiCfg}
          onTestEl={() => loadVoices(true)} onClose={() => { setModal(null); setSetFocus(null); api('/api/font').then((f) => setFont(f.font)).catch(() => {}); }} say={say}
          log={log} clearLog={() => { setLog([]); setUnreadErr(0); }} focus={setFocus} />
      )}
      {modal === 'export' && (
        <ExportModal summaries={Object.fromEntries(script.videos.map((k) => [k, summaryOf(k)]))}
          titles={Object.fromEntries(script.videos.map((k) => [k, script.meta[k]?.title || k]))}
          dirty={dirty} onSave={() => save()} job={exportJob} onStart={startExport} onCancel={cancelExport}
          onClose={() => setModal(null)} say={say} />
      )}
      {projectModals}
    </div>
  );
}

function ToneEditor({ tone, onChange, sample }) {
  const tags = parseTags(tone.tags);
  const toggle = (tag) => onChange({ tags: (tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]).join('') });
  return (
    <div className="tone">
      <div className="tone-h">
        <label className="chk big"><input type="checkbox" checked={!!tone.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          <b>기본 톤</b>&nbsp;모든 대사 생성 시 앞에 자동 적용</label>
      </div>
      <div className={`tone-b ${tone.enabled ? '' : 'off'}`}>
        <div className="chips">
          {TONE_PRESETS.map(([n, t]) => (
            <button key={t} className={`chip ${tags.includes(t) ? 'on' : ''}`} onClick={() => toggle(t)} title={t}>{n}</button>
          ))}
        </div>
        <input className="tagsin" value={tone.tags} placeholder="[narrator][calm]" spellCheck={false}
          onChange={(e) => onChange({ tags: e.target.value })} />
        <label className="chk"><input type="checkbox" checked={!!tone.override} onChange={(e) => onChange({ override: e.target.checked })} />
          줄 발음이 태그로 시작하면 그 줄은 기본 톤 대신 자체 태그 사용</label>
        {tone.enabled && sample && <div className="tone-pv"><span>전송 예</span><code>{sample}</code></div>}
        <p className="hint">태그는 음성에 읽히지 않고 말투만 지시합니다(자막에도 안 나옴). 영어 지시어가 가장 안정적이며, 톤을 바꾸면 기존 음성은 ‘변경’으로 표시돼 재생성 대상이 됩니다.</p>
      </div>
    </div>
  );
}

function Section({ id, title, summary, className = '', defaultOpen = false, children }) {
  const [open, setOpen] = useState(() => ls.get(`zk.sec.${id}`, defaultOpen ? '1' : '0') === '1');
  useEffect(() => { ls.set(`zk.sec.${id}`, open ? '1' : '0'); }, [id, open]);
  return (
    <div className={`panel sec ${className} ${open ? 'open' : ''}`}>
      <button className="sechead" onClick={() => setOpen((o) => !o)}>
        <span className="chev">{open ? '▾' : '▸'}</span><h3>{title}</h3><span className="secsum">{summary}</span>
      </button>
      {open && <div className="secbody">{children}</div>}
    </div>
  );
}

