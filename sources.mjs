// 프로젝트 소스: 텍스트·이미지·영상을 프로젝트 폴더에 모아 AI 요청의 컨텍스트로 첨부
//   sources.json   소스 목록(메타데이터). 순서 = AI에 전달되는 순서
//   sources/<id>/  이미지 파일, 복사해 온 영상, 영상 대표 프레임(f_<ms>.jpg), 받아쓰기 문장(transcript.json)
// 영상 분석(장면 전환·받아쓰기)은 프로젝트마다 한 번에 하나씩 차례로 돌고, 진행률은 목록 응답에 실려 간다.
// 이전 버전의 references.json(이미지를 data URL로 저장)은 처음 열 때 이 형식으로 옮긴다(원본 파일은 그대로 둠).
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import {
  MAX_SOURCES, MAX_SOURCE_TEXT, MAX_NOTE, MAX_TITLE, MAX_IMAGE_BYTES, DEFAULT_FRAMES, MAX_FRAMES, VIDEO_EXT,
  contextUsage, overBudget, budgetMessage, titleOf, sourceHeader, frameCaption, SOURCE_INTRO, SOURCE_RULES,
  SCENE_SENS, STT_MODELS, STT_LANGS, ctxOn, sceneSpans, transcriptBlock,
} from './shared/sources.js';
import { detectScenes, transcribe as runStt, cleanCuts } from './analysis.mjs';
import { fitFilter } from './shared/clips.js';

const invalid = (message, status = 400) => Object.assign(new Error(message), { status });
const ID = /^[a-z0-9-]{1,64}$/;
const IMAGE_MAGIC = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];
const frameName = (t) => `f_${Math.round(t * 1000)}.jpg`;
const safeFileName = (name) => {
  const base = path.basename(String(name || 'video')).replace(/[\\/:*?"<>|\x00-\x1F]+/g, '_').trim();
  return base.length > 120 ? base.slice(-120) : base || 'video';
};

const run = (bin, args) => new Promise((ok) => {
  let err = ''; let p;
  try { p = spawn(bin, args, { windowsHide: true }); } catch (e) { return ok({ code: -1, err: e.message }); }
  p.stderr?.on('data', (d) => { err += d; });
  p.on('error', (e) => ok({ code: -1, err: e.message }));
  p.on('close', (code) => ok({ code, err }));
});

async function readRaw(req, limit) {
  const chunks = []; let bytes = 0;
  for await (const c of req) {
    bytes += c.length;
    if (bytes > limit) throw invalid('파일 용량이 너무 큽니다.', 413);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

// 같은 프로젝트의 목록 읽기·쓰기는 한 번에 하나씩 (여러 파일 동시 업로드)
const locks = new Map();
function locked(key, fn) {
  const next = (locks.get(key) || Promise.resolve()).then(fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

// 소스 목록 그대로 AI 메시지에 붙이는 형태(parts)로 — 미리보기와 실제 요청이 같은 구성을 쓰도록 한 곳에서 만든다
export function attachSources(body, parts) {
  const last = body.messages?.findLastIndex((message) => message.role === 'user') ?? -1;
  if (!parts.length || last < 0) return body;
  const message = body.messages[last];
  const own = message.parts || [...(message.image ? [{ image: message.image }] : []), { text: message.text }];
  const messages = body.messages.slice();
  messages[last] = { ...message, parts: [...own, { text: SOURCE_INTRO }, ...parts] };
  return { ...body, messages, system: `${body.system || ''}\n${SOURCE_RULES}` };
}

export function createSources({ work, ff, probe, inUse = async () => false, elBase = () => 'https://api.elevenlabs.io' }) {
  const LIST = path.join(work, 'sources.json');
  const ROOT = path.join(work, 'sources');
  const dirOf = (id) => path.join(ROOT, id);
  const lock = (fn) => locked(work, fn);

  async function write(list) {
    const temp = `${LIST}.${randomUUID()}.tmp`;
    try {
      await fsp.writeFile(temp, JSON.stringify(list, null, 2), 'utf8');
      await fsp.rename(temp, LIST);
    } finally { await fsp.rm(temp, { force: true }); }
  }

  async function migrate() {
    let old;
    try { old = JSON.parse(await fsp.readFile(path.join(work, 'references.json'), 'utf8')); } catch { return []; }
    const list = [];
    for (const r of Array.isArray(old) ? old : []) {
      if (!r || !ID.test(r.id || '') || list.some((x) => x.id === r.id)) continue;
      const base = { id: r.id, title: String(r.title || '자료').trim().slice(0, MAX_TITLE) || '자료', note: '', enabled: !!r.enabled, added: new Date().toISOString() };
      if (r.kind === 'text' && typeof r.text === 'string' && r.text.trim()) list.push({ ...base, kind: 'text', text: r.text.slice(0, MAX_SOURCE_TEXT) });
      const m = r.kind === 'image' && /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(r.image || '');
      if (m) {
        const file = `image.${m[1] === 'image/jpeg' ? 'jpg' : m[1].slice(6)}`;
        await fsp.mkdir(dirOf(r.id), { recursive: true });
        await fsp.writeFile(path.join(dirOf(r.id), file), Buffer.from(m[2], 'base64'));
        list.push({ ...base, kind: 'image', file, mime: m[1] });
      }
    }
    await write(list);
    return list;
  }

  async function read() {
    try { return JSON.parse(await fsp.readFile(LIST, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    return migrate();
  }

  const find = (list, id) => {
    const item = ID.test(id || '') && list.find((s) => s.id === id);
    if (!item) throw invalid('소스를 찾을 수 없습니다.', 404);
    return item;
  };

  // ---- 분석 작업 (장면 전환·받아쓰기) ----
  const KINDS = ['scenes', 'transcript'];
  const tasks = new Map(); // `${id}:${kind}` → { progress, phase }
  let queue = Promise.resolve();
  // 진행 중 작업의 진행률을 붙여 내보냄. 서버가 다시 켜져 사라진 작업은 '중단됨'으로 표시
  const present = (items) => items.map((s) => {
    let o = s;
    for (const k of KINDS) {
      const a = s[k];
      if (a?.status !== 'queued' && a?.status !== 'running') continue;
      const t = tasks.get(`${s.id}:${k}`);
      o = { ...o, [k]: t ? { ...a, progress: t.progress, phase: t.phase } : { ...a, status: 'error', error: '작업이 중단되었습니다. 다시 실행하세요.' } };
    }
    return o;
  });
  const out = (r) => ({ ...r, items: present(r.items), ...(r.item ? { item: present([r.item])[0] } : {}) });
  const patchItem = (id, fn) => lock(async () => {
    const list = await read(); const i = list.findIndex((s) => s.id === id);
    if (i < 0) return null;
    const next = fn({ ...list[i] }, list);
    if (!next) return null;
    list[i] = next; await write(list);
    return next;
  });
  // 분석 결과를 붙였더니 컨텍스트 한도를 넘으면 그 결과의 AI 첨부만 끔 (결과는 남김)
  const fitBudget = (list, next, kind) => {
    if (next.enabled && ctxOn(next, kind) && overBudget(contextUsage(list.map((s) => (s.id === next.id ? next : s))))) {
      next.ctx = { ...(next.ctx || {}), [kind]: false };
      next[kind] = { ...next[kind], budgetOff: true };
    }
    return next;
  };
  const begin = async (list, item, kind, patch) => {
    if (item.kind !== 'video') throw invalid('영상 소스만 분석할 수 있습니다.');
    if (tasks.has(`${item.id}:${kind}`)) throw invalid('이미 진행 중인 분석입니다.');
    item[kind] = { ...(item[kind] || {}), ...patch, status: 'queued', error: undefined, budgetOff: undefined };
    await write(list);
  };
  const schedule = (id, kind, job) => {
    const key = `${id}:${kind}`;
    const t = { progress: 0, phase: 'queued' }; tasks.set(key, t);
    queue = queue.then(async () => {
      try {
        const item = await patchItem(id, (s) => ({ ...s, [kind]: { ...s[kind], status: 'running' } }));
        if (!item) return;
        t.phase = 'running';
        await job(item, t);
      } catch (e) {
        console.error(`[sources] ${kind} 분석 실패`, e.message);
        await patchItem(id, (s) => ({ ...s, [kind]: { ...s[kind], status: 'error', error: e.message } })).catch(() => {});
      } finally { tasks.delete(key); }
    });
  };
  const transcriptFile = (id) => path.join(dirOf(id), 'transcript.json');
  const readTranscript = async (id) => { try { return JSON.parse(await fsp.readFile(transcriptFile(id), 'utf8')).segments || []; } catch { return []; } };
  const doneScenes = (s, cuts, extra = {}) => ({ ...s, scenes: { ...(s.scenes || {}), ...extra, status: 'done', cuts, error: undefined, at: new Date().toISOString() } });
  const doneTranscript = (s, segs, extra = {}) => {
    const tr = { ...(s.transcript || {}), ...extra, status: 'done', count: segs.length, error: undefined, at: new Date().toISOString() };
    return { ...s, transcript: { ...tr, chars: transcriptBlock(tr, segs).length } };
  };

  // 새 소스를 목록 끝에 추가. 컨텍스트 한도를 넘으면 꺼진 상태로 추가
  const append = (item) => lock(async () => {
    const list = await read();
    if (list.length >= MAX_SOURCES) throw invalid(`소스는 프로젝트당 ${MAX_SOURCES}개까지 추가할 수 있습니다.`);
    item.enabled = item.enabled !== false && !overBudget(contextUsage([...list, { ...item, enabled: true }]));
    const next = [...list, item];
    await write(next);
    return out({ items: next, item, notice: item.enabled ? undefined : `‘${item.title}’은 컨텍스트 한도 때문에 꺼진 상태로 추가했습니다. ${budgetMessage()}` });
  });
  const precheck = async () => {
    if ((await lock(read)).length >= MAX_SOURCES) throw invalid(`소스는 프로젝트당 ${MAX_SOURCES}개까지 추가할 수 있습니다.`);
  };

  async function grab(src, id, t) {
    const out = path.join(dirOf(id), frameName(t));
    const r = await run(ff(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', src, '-frames:v', '1',
      '-vf', "scale='min(640,iw)':-2", '-q:v', '4', out]);
    try { await fsp.access(out); return { t }; }
    catch { if (r.err) console.error('[sources] 프레임 추출 실패', t, r.err.trim().split('\n').pop()); return null; }
  }
  async function evenFrames(item, n) {
    const ts = [...new Set(Array.from({ length: n }, (_, i) => Math.round(item.duration * ((i + 0.5) / n) * 10) / 10))];
    return (await Promise.all(ts.map((t) => grab(item.path, item.id, t)))).filter(Boolean);
  }
  async function videoItem(id, file, origin, copied) {
    const info = await probe(file);
    if (info.error || !info.duration) throw invalid(`영상 정보를 읽지 못했습니다${info.error ? `: ${info.error}` : ''} (ffmpeg·ffprobe 설치 확인)`);
    const item = { id, kind: 'video', title: titleOf(origin), note: '', enabled: true, added: new Date().toISOString(),
      path: file, copied, origin: path.basename(origin), duration: +info.duration.toFixed(2), width: info.width || 0, height: info.height || 0, audio: !!info.audio,
      size: (await fsp.stat(file)).size, frames: [] };
    await fsp.mkdir(dirOf(id), { recursive: true });
    item.frames = await evenFrames(item, DEFAULT_FRAMES);
    if (!item.frames.length) throw invalid('영상에서 프레임을 추출하지 못했습니다 (ffmpeg 확인).');
    return item;
  }

  async function imageFile(item) { return path.join(dirOf(item.id), item.file); }

  // 켜진 소스를 AI 컨텍스트 블록으로: { n, id, kind, title, text, images: [{ file, mime, caption, url }] }
  async function blocks({ images = true } = {}) {
    const list = (await lock(read)).filter((s) => s.enabled);
    return Promise.all(list.map(async (s, i) => {
      const n = i + 1;
      const pics = !images ? [] : s.kind === 'image'
        ? [{ file: await imageFile(s), mime: s.mime, caption: '', url: `/api/sources/${s.id}/file` }]
        : s.kind === 'video' ? (s.frames || []).map((f) => ({ file: path.join(dirOf(s.id), frameName(f.t)), mime: 'image/jpeg',
          caption: frameCaption(n, f.t), url: `/api/sources/${s.id}/frames/${Math.round(f.t * 1000)}.jpg`, t: f.t })) : [];
      const transcript = s.kind === 'video' && s.transcript?.status === 'done' && ctxOn(s, 'transcript') ? await readTranscript(s.id) : null;
      return { n, id: s.id, kind: s.kind, title: s.title, text: sourceHeader(s, n, { images, transcript }), images: pics };
    }));
  }

  return {
    ROOT,
    list: async () => present(await lock(read)),

    async addText(b) {
      const text = typeof b?.text === 'string' ? b.text.replace(/\r\n/g, '\n').trim() : '';
      if (!text) throw invalid('텍스트를 입력하세요.');
      if (text.length > MAX_SOURCE_TEXT) throw invalid(`텍스트 소스는 ${MAX_SOURCE_TEXT.toLocaleString()}자까지 추가할 수 있습니다 (현재 ${text.length.toLocaleString()}자).`);
      const title = String(b.title || '').trim().slice(0, MAX_TITLE) || titleOf(b.origin) || '텍스트';
      return append({ id: randomUUID(), kind: 'text', title, note: String(b.note || '').slice(0, MAX_NOTE), enabled: b.enabled !== false,
        added: new Date().toISOString(), text, ...(b.origin ? { origin: path.basename(String(b.origin)).slice(0, 120) } : {}) });
    },

    async addImage(req, name) {
      await precheck();
      const buf = await readRaw(req, MAX_IMAGE_BYTES);
      const type = IMAGE_MAGIC.find((x) => x.test(buf));
      if (!type) throw invalid('JPEG, PNG 또는 WebP 이미지만 추가할 수 있습니다.');
      const id = randomUUID(); const file = `image.${type.ext}`;
      await fsp.mkdir(dirOf(id), { recursive: true });
      try {
        await fsp.writeFile(path.join(dirOf(id), file), buf);
        return await append({ id, kind: 'image', title: titleOf(name), note: '', enabled: true, added: new Date().toISOString(),
          file, mime: type.mime, origin: path.basename(String(name || '')), size: buf.length });
      } catch (e) { await fsp.rm(dirOf(id), { recursive: true, force: true }); throw e; }
    },

    // 브라우저에서 올린 영상을 프로젝트 폴더로 복사
    async addVideo(req, name) {
      if (!VIDEO_EXT.includes(path.extname(String(name || '')).toLowerCase())) throw invalid(`지원하는 영상 형식: ${VIDEO_EXT.join(' ')}`);
      await precheck();
      const id = randomUUID(); const file = path.join(dirOf(id), safeFileName(name));
      await fsp.mkdir(dirOf(id), { recursive: true });
      try {
        await pipeline(req, fs.createWriteStream(`${file}.part`));
        await fsp.rename(`${file}.part`, file);
        return await append(await videoItem(id, file, String(name), true));
      } catch (e) { await fsp.rm(dirOf(id), { recursive: true, force: true }); throw e; }
    },

    // PC에 있는 영상을 복사하지 않고 연결
    async linkVideo(file) {
      file = String(file || '');
      if (!path.isAbsolute(file) || !VIDEO_EXT.includes(path.extname(file).toLowerCase()) || !fs.existsSync(file)) throw invalid('영상 파일을 찾을 수 없습니다.');
      const list = await lock(read);
      if (list.some((s) => s.kind === 'video' && path.resolve(s.path) === path.resolve(file))) throw invalid('이미 추가한 영상입니다.');
      await precheck();
      const id = randomUUID();
      try { return await append(await videoItem(id, path.resolve(file), file, false)); }
      catch (e) { await fsp.rm(dirOf(id), { recursive: true, force: true }); throw e; }
    },

    update: (id, b = {}) => lock(async () => {
      const list = await read(); const item = find(list, id);
      const next = { ...item };
      if ('title' in b) {
        const title = String(b.title ?? '').trim();
        if (!title || title.length > MAX_TITLE) throw invalid(`제목은 1~${MAX_TITLE}자로 입력하세요.`);
        next.title = title;
      }
      if ('note' in b) {
        if (typeof b.note !== 'string' || b.note.length > MAX_NOTE) throw invalid(`메모는 ${MAX_NOTE.toLocaleString()}자까지 입력할 수 있습니다.`);
        next.note = b.note.trim();
      }
      if ('text' in b) {
        const text = typeof b.text === 'string' ? b.text.replace(/\r\n/g, '\n').trim() : '';
        if (item.kind !== 'text') throw invalid('텍스트 소스만 본문을 고칠 수 있습니다.');
        if (!text || text.length > MAX_SOURCE_TEXT) throw invalid(`텍스트는 1~${MAX_SOURCE_TEXT.toLocaleString()}자로 입력하세요.`);
        next.text = text;
      }
      if ('enabled' in b) next.enabled = !!b.enabled;
      // 영상 분석 결과(장면·받아쓰기)를 AI 컨텍스트에 넣을지
      if (b.ctx && typeof b.ctx === 'object') {
        next.ctx = { ...(item.ctx || {}) };
        for (const k of KINDS) if (k in b.ctx) { next.ctx[k] = !!b.ctx[k]; if (next[k]?.budgetOff) next[k] = { ...next[k], budgetOff: undefined }; }
      }
      const items = list.map((s) => (s.id === id ? next : s));
      const before = contextUsage(list); const after = contextUsage(items);
      if (overBudget(after) && (after.text > before.text || after.images > before.images)) throw invalid(`컨텍스트 한도를 넘습니다. 다른 소스를 끄거나 내용을 줄이세요. ${budgetMessage()}`);
      await write(items);
      return out({ items, item: next });
    }),

    // ids에 든 소스만 켬 (목록 순서대로 한도 안에서). 한도 때문에 못 켠 개수를 알려줌
    select: (ids = []) => lock(async () => {
      const want = new Set(Array.isArray(ids) ? ids : []);
      const list = await read(); const items = []; let skipped = 0;
      for (const s of list) {
        const on = want.has(s.id) && !overBudget(contextUsage([...items, { ...s, enabled: true }]));
        if (want.has(s.id) && !on) skipped++;
        items.push({ ...s, enabled: on });
      }
      await write(items);
      return out({ items, notice: skipped ? `${skipped}개는 컨텍스트 한도 때문에 켜지 않았습니다. ${budgetMessage()}` : undefined });
    }),

    remove: (id) => lock(async () => {
      const list = await read(); const item = find(list, id);
      const items = list.filter((s) => s.id !== id);
      await write(items);
      let notice;
      if (item.kind === 'video' && item.copied && await inUse(item.path)) {
        for (const f of item.frames || []) await fsp.rm(path.join(dirOf(id), frameName(f.t)), { force: true });
        notice = `편집 영상으로 쓰는 중이라 영상 파일은 남겨 두었습니다: ${item.path}`;
      } else await fsp.rm(dirOf(id), { recursive: true, force: true });
      return out({ items, notice });
    }),

    // 영상 대표 프레임: { count } 균등 재추출 | { scenes: true } 장면마다 가운데 | { add: 초 } 장면 추가 | { remove: 초 } 장면 빼기
    frames: (id, b = {}) => lock(async () => {
      const list = await read(); const item = find(list, id);
      if (item.kind !== 'video') throw invalid('영상 소스가 아닙니다.');
      const old = item.frames || [];
      let frames;
      if (b.count != null) {
        const n = Math.round(+b.count);
        if (!(n >= 1 && n <= MAX_FRAMES)) throw invalid(`프레임은 1~${MAX_FRAMES}장으로 정하세요.`);
        if (item.enabled && overBudget(contextUsage(list.map((s) => (s.id === id ? { ...s, frames: Array(n) } : s))))) throw invalid(`컨텍스트 한도를 넘습니다. ${budgetMessage()}`);
        for (const f of old) await fsp.rm(path.join(dirOf(id), frameName(f.t)), { force: true });
        frames = await evenFrames(item, n);
      } else if (b.scenes) {
        if (item.scenes?.status !== 'done') throw invalid('장면 분석을 먼저 실행하세요.');
        // 장면이 많으면 긴 장면부터 MAX_FRAMES개, 시간 순으로
        const spans = sceneSpans(item.scenes.cuts, item.duration).sort((a, c) => (c.e - c.s) - (a.e - a.s)).slice(0, MAX_FRAMES).sort((a, c) => a.s - c.s);
        const ts = [...new Set(spans.map((g) => Math.round(((g.s + g.e) / 2) * 10) / 10))];
        if (item.enabled && overBudget(contextUsage(list.map((s) => (s.id === id ? { ...s, frames: ts } : s))))) throw invalid(`컨텍스트 한도를 넘습니다. ${budgetMessage()}`);
        for (const f of old) await fsp.rm(path.join(dirOf(id), frameName(f.t)), { force: true });
        frames = (await Promise.all(ts.map((t) => grab(item.path, id, t)))).filter(Boolean);
      } else if (b.add != null) {
        const t = Math.round(Math.max(0, Math.min(item.duration - 0.05, +b.add || 0)) * 100) / 100;
        if (old.some((f) => Math.abs(f.t - t) < 0.05)) throw invalid('이미 추가한 장면입니다.');
        if (old.length >= MAX_FRAMES) throw invalid(`영상 하나에 프레임은 ${MAX_FRAMES}장까지 넣을 수 있습니다.`);
        if (item.enabled && overBudget(contextUsage(list.map((s) => (s.id === id ? { ...s, frames: [...old, { t }] } : s))))) throw invalid(`컨텍스트 한도를 넘습니다. ${budgetMessage()}`);
        const f = await grab(item.path, id, t);
        if (!f) throw invalid('그 위치의 프레임을 추출하지 못했습니다.');
        frames = [...old, f].sort((a, c) => a.t - c.t);
      } else if (b.remove != null) {
        const gone = old.filter((f) => Math.abs(f.t - +b.remove) < 0.005);
        frames = old.filter((f) => !gone.includes(f));
        for (const f of gone) await fsp.rm(path.join(dirOf(id), frameName(f.t)), { force: true });
      } else throw invalid('프레임 작업을 지정하세요.');
      const next = { ...item, frames };
      const items = list.map((s) => (s.id === id ? next : s));
      await write(items);
      return out({ items, item: next });
    }),

    // 장면 전환: { sensitivity } 자동 분석(로컬 ffmpeg, 백그라운드) | { cuts: [초…] } 사람이 고친 경계 저장
    scenes: (id, b = {}) => lock(async () => {
      const list = await read(); const item = find(list, id);
      if (item.kind !== 'video') throw invalid('영상 소스만 분석할 수 있습니다.');
      if (Array.isArray(b.cuts)) {
        if (tasks.has(`${id}:scenes`)) throw invalid('장면 분석이 진행 중입니다.');
        const next = fitBudget(list, doneScenes(item, cleanCuts(b.cuts, item.duration, 0.2), { manual: true }), 'scenes');
        const items = list.map((s) => (s.id === id ? next : s));
        await write(items);
        return out({ items, item: next });
      }
      const sensitivity = SCENE_SENS[b.sensitivity] ? b.sensitivity : 'normal';
      await begin(list, item, 'scenes', { sensitivity, manual: undefined });
      schedule(id, 'scenes', async (it, t) => {
        const cuts = await detectScenes({ ff: ff(), file: it.path, dir: dirOf(id), duration: it.duration, sensitivity, onProgress: (p) => { t.progress = p; } });
        await patchItem(id, (s, all) => fitBudget(all, doneScenes(s, cuts, { sensitivity }), 'scenes'));
      });
      return out({ items: list, item });
    }),

    // 받아쓰기 (ElevenLabs Speech-to-Text, 백그라운드). key = 브라우저가 보낸 ElevenLabs API 키 (저장하지 않음)
    transcribe: (id, b = {}, key) => lock(async () => {
      if (!key) throw invalid('설정에서 ElevenLabs API 키를 등록하세요.');
      const list = await read(); const item = find(list, id);
      if (item.audio === false) throw invalid('소리가 없는 영상이라 받아쓸 수 없습니다.');
      const model = STT_MODELS.includes(b.model) ? b.model : STT_MODELS[0];
      const lang = STT_LANGS.some(([v]) => v === b.lang) ? b.lang : '';
      const diarize = !!b.diarize;
      await begin(list, item, 'transcript', { model, request: { lang, diarize } });
      schedule(id, 'transcript', async (it, t) => {
        const r = await runStt({ ff: ff(), file: it.path, dir: dirOf(id), duration: it.duration, key, base: elBase(), model, lang, diarize,
          onProgress: (p) => { t.progress = p; }, onPhase: (ph) => { t.phase = ph; } })
          .catch(async (e) => { if (/소리가 없는/.test(e.message)) await patchItem(id, (s) => ({ ...s, audio: false })); throw e; });
        await fsp.writeFile(transcriptFile(id), JSON.stringify({ segments: r.segments }, null, 2), 'utf8');
        await patchItem(id, (s, all) => fitBudget(all, doneTranscript(s, r.segments, { lang: r.lang, model }), 'transcript'));
      });
      return out({ items: list, item });
    }),

    async transcript(id) {
      const item = find(await lock(read), id);
      return { segments: item.transcript?.status === 'done' ? await readTranscript(id) : [] };
    },

    // 사람이 고친 받아쓰기 저장 (문장 편집·삭제·찾아 바꾸기)
    saveTranscript: (id, segments) => lock(async () => {
      const list = await read(); const item = find(list, id);
      if (item.transcript?.status !== 'done') throw invalid('받아쓰기 결과가 없습니다.');
      if (!Array.isArray(segments) || segments.length > 5000) throw invalid('받아쓰기 형식이 올바르지 않습니다.');
      const segs = segments.map((g) => ({ s: Math.round(+g.s * 100) / 100, e: Math.round(+g.e * 100) / 100, text: String(g.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000),
        ...(g.speaker != null ? { speaker: String(g.speaker).slice(0, 40) } : {}) }))
        .filter((g) => g.text && Number.isFinite(g.s) && Number.isFinite(g.e)).sort((a, c) => a.s - c.s);
      await fsp.writeFile(transcriptFile(id), JSON.stringify({ segments: segs }, null, 2), 'utf8');
      const next = fitBudget(list, doneTranscript(item, segs, { edited: true }), 'transcript');
      const items = list.map((s) => (s.id === id ? next : s));
      await write(items);
      return out({ items, item: next, notice: next.transcript.budgetOff ? `받아쓰기가 컨텍스트 한도를 넘어 AI 첨부를 껐습니다. ${budgetMessage()}` : undefined });
    }),

    async file(id) {
      const item = find(await lock(read), id);
      if (item.kind === 'image') return { file: await imageFile(item), type: item.mime };
      if (item.kind === 'video') {
        const ext = path.extname(item.path).toLowerCase();
        return { file: item.path, type: ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4' };
      }
      throw invalid('파일이 없는 소스입니다.', 404);
    },
    // 영상 소스의 임의 시각 장면 (구성 초안 검토용 썸네일, 디스크 캐시)
    async still(id, t, w = 192) {
      const item = find(await lock(read), id);
      if (item.kind !== 'video') throw invalid('영상 소스가 아닙니다.', 404);
      t = Math.max(0, Math.min(item.duration - 0.05, +t || 0));
      w = Math.max(80, Math.min(640, Math.round(+w || 192)));
      const out = path.join(dirOf(id), `still_${Math.round(t * 1000)}_${w}.jpg`);
      try { await fsp.access(out); return out; } catch {}
      await fsp.mkdir(dirOf(id), { recursive: true });
      const r = await run(ff(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', item.path, '-frames:v', '1',
        '-vf', fitFilter(w, Math.round((w * 9) / 16 / 2) * 2), '-q:v', '5', out]);
      try { await fsp.access(out); return out; } catch { throw invalid(r.err.trim().split('\n').pop() || '장면을 추출하지 못했습니다.', 500); }
    },
    frameFile(id, ms) {
      if (!ID.test(id || '') || !/^\d{1,9}$/.test(ms)) throw invalid('bad frame');
      return path.join(dirOf(id), `f_${ms}.jpg`);
    },

    // 화면 확인용: 실제 요청과 같은 블록 (이미지는 URL)
    async preview() {
      const list = await lock(read);
      const out = await blocks();
      return { intro: SOURCE_INTRO, rules: SOURCE_RULES, usage: contextUsage(list), total: list.length,
        blocks: out.map(({ images, ...b }) => ({ ...b, images: images.map(({ file, mime, ...x }) => x) })) };
    },

    // AI 요청 본문에 켜진 소스를 첨부. images=false면 텍스트(머리글·메모 포함)만
    async attach(body, { images = true } = {}) {
      const parts = [];
      for (const b of await blocks({ images })) {
        parts.push({ text: b.text });
        for (const p of b.images) {
          try {
            const data = (await fsp.readFile(p.file)).toString('base64');
            if (p.caption) parts.push({ text: p.caption });
            parts.push({ image: `data:${p.mime};base64,${data}` });
          } catch { parts.push({ text: `${p.caption || `[소스 ${b.n}]`} (이미지 파일을 찾을 수 없음)` }); }
        }
      }
      return attachSources(body, parts);
    },
  };
}
