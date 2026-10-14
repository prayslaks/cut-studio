// 썸네일: 편집본 한 장면(배경) + 레이어(텍스트/박스/그라데이션) → 1280x720 PNG
// 레이어는 shared/thumbLayers.js 모델. 렌더는 ffmpeg + libass (자막과 같은 fonts/ 폴더 사용)
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { resolveStyle } from './shared/layout.js';
import { TW, TH, TEMPLATES, templateLayers, draftLabel } from './shared/thumbLayers.js';

export { TEMPLATES };

const run = (bin, args, opt = {}) => new Promise((ok) => {
  let err = '';
  let p;
  try { p = spawn(bin, args, { windowsHide: true, ...opt }); } catch (e) { return ok({ code: -1, err: e.message }); }
  p.stderr?.on('data', (d) => { err += d; });
  p.on('error', (e) => ok({ code: -1, err: e.message }));
  p.on('close', (code) => ok({ code, err }));
});

const assColor = (hex = '#FFFFFF') => { const h = String(hex).replace('#', '').padEnd(6, '0'); return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase(); };
const assAlpha = (opacity = 1) => `&H${Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255).toString(16).padStart(2, '0').toUpperCase()}&`;
const esc = (s) => String(s ?? '').replace(/[{}\\]/g, '').replace(/\r?\n/g, '\\N');
const R = (n) => Math.round(n * 10) / 10;
const shape = (x, y, w, h) => `m ${R(x)} ${R(y)} l ${R(x + w)} ${R(y)} ${R(x + w)} ${R(y + h)} ${R(x)} ${R(y + h)}`;
const ev = (layer, text) => `Dialogue: ${layer},0:00:00.00,0:00:10.00,T,,0,0,0,,${text}\n`;

// 그라데이션: 띠 여러 장 + 약한 blur (CSS linear-gradient와 시각적으로 맞춤)
function gradAss(l, li) {
  const steps = 24; let o = '';
  const horiz = l.dir === 'right' || l.dir === 'left';
  for (let i = 0; i < steps; i++) {
    const k = (i + 0.5) / steps;
    // dir = 짙은 쪽 → 옅은 쪽 방향 (right: 왼쪽이 from)
    const p = l.dir === 'right' || l.dir === 'down' ? k : 1 - k;
    const a = l.from + (l.to - l.from) * p;
    const seg = horiz ? [l.x + (l.w * i) / steps, l.y, l.w / steps + 1, l.h] : [l.x, l.y + (l.h * i) / steps, l.w, l.h / steps + 1];
    o += ev(li, `{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\c${assColor(l.color)}\\alpha${assAlpha(a)}\\blur2}${shape(...seg)}`);
  }
  return o;
}

export function layersAss(d, fontsMap = {}, fallback = 'Malgun Gothic') {
  const fontName = (f = {}) => {
    const hit = fontsMap[`${f.family}|${f.weight}`];
    if (hit) return { name: hit.name, bold: false };
    if (f.source === 'system') return { name: f.family, bold: (f.weight || 700) >= 600 };
    return { name: fallback, bold: (f.weight || 700) >= 600 };
  };
  let o = `[Script Info]
ScriptType: v4.00+
PlayResX: ${TW}
PlayResY: ${TH}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: T,${fallback},60,&H00FFFFFF,&H000000FF,&H000F0C08,&H000F0C08,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  (d.layers || []).forEach((l, i) => {
    if (l.visible === false) return;
    if (l.type === 'grad') o += gradAss(l, i);
    else if (l.type === 'rect') o += ev(i, `{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\c${assColor(l.color)}\\alpha${assAlpha(l.alpha ?? 1)}${l.blur ? `\\blur${l.blur}` : ''}}${shape(l.x, l.y, l.w, l.h)}`);
    else if (l.type === 'text' && String(l.text || '').trim()) {
      const f = fontName(l.font);
      const sh = l.shadow || {}; const ol = l.outline || {};
      o += ev(i, `{\\an${l.anchor || 7}\\pos(${R(l.x)},${R(l.y)})\\fn${f.name}\\b${f.bold ? 1 : 0}\\fs${R(l.size)}${l.spacing ? `\\fsp${R(l.spacing)}` : ''}`
        + `\\c${assColor(l.color)}\\3c${assColor(ol.color || '#000000')}\\4c${assColor(sh.color || '#000000')}\\4a${assAlpha(sh.alpha ?? 1)}`
        + `\\bord${R(ol.width || 0)}\\shad${R(sh.dist || 0)}}${esc(l.text)}`);
    }
  });
  return o;
}

export function createThumbs({ work, root, ffPath, fontsMap, defaultFont }) {
  const DIR = path.join(work, 'thumbs');
  const DB = path.join(DIR, 'drafts.json');
  const load = async () => { try { return JSON.parse(await fsp.readFile(DB, 'utf8')); } catch { return []; } };
  const store = async (list) => { await fsp.mkdir(DIR, { recursive: true }); await fsp.writeFile(DB, JSON.stringify(list, null, 2), 'utf8'); };
  const script = async () => JSON.parse(await fsp.readFile(path.join(work, 'script.json'), 'utf8'));

  function timeline(meta) {
    const offs = []; let t = 0; for (const [s, e] of meta.segs) { offs.push(t); t += e - s; }
    return { offs, body: t };
  }
  function toSrc(meta, t) {
    const { offs, body } = timeline(meta);
    t = Math.max(0, Math.min(t, body - 0.05));
    const i = offs.reduce((k, o, j) => (o <= t ? j : k), 0);
    return meta.segs[i][0] + t - offs[i];
  }
  // 배경 필터 (확대·밝기 보정) — 편집기 배경과 최종 렌더가 공유
  const bgFilter = (d, w = TW, h = TH) => {
    const z = Math.max(1, Math.min(2.5, d.zoom || 1)); const fx = Math.max(0, Math.min(1, d.fx ?? 0.5)), fy = Math.max(0, Math.min(1, d.fy ?? 0.5));
    const crop = z > 1.001 ? `crop=iw/${z}:ih/${z}:(iw-iw/${z})*${fx}:(ih-ih/${z})*${fy},` : '';
    const g = d.grade || {};
    return `${crop}scale=${w}:${h}:flags=lanczos,setsar=1,eq=contrast=${g.contrast ?? 1.06}:saturation=${g.saturation ?? 1.12}:brightness=${g.brightness ?? 0}`;
  };

  async function sample(key, n = 16, width = 640) {
    const s = await script(); const meta = s.meta[key]; const { body } = timeline(meta);
    const src = path.join(root, path.basename(meta.src));
    await fsp.mkdir(path.join(DIR, 'cand'), { recursive: true });
    const lo = Math.min(8, body * 0.05), hi = body - 2;
    const out = [];
    await Promise.all(Array.from({ length: n }, async (_, i) => {
      const t = +(lo + ((hi - lo) * (i + 0.5)) / n).toFixed(1);
      const file = path.join(DIR, 'cand', `${key}_${i}.jpg`);
      const r = await run(ffPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', toSrc(meta, t).toFixed(3), '-i', src, '-frames:v', '1',
        '-vf', `scale=${width}:-2`, '-q:v', '4', file]);
      if (r.code === 0) out.push({ i, t, file });
    }));
    return out.sort((a, b) => a.i - b.i);
  }

  // 필름스트립용 원본 프레임 (작은 크기, 디스크 캐시)
  async function still(key, t, w = 240) {
    const s = await script(); const meta = s.meta[key]; const { body } = timeline(meta);
    t = Math.max(0, Math.min(body - 0.02, t));
    const dir = path.join(DIR, 'still'); await fsp.mkdir(dir, { recursive: true });
    const out = path.join(dir, `${key}_${Math.round(t * 1000)}_${w}.jpg`);
    try { return await fsp.readFile(out); } catch {}
    const r = await run(ffPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', toSrc(meta, t).toFixed(3), '-i', path.join(root, path.basename(meta.src)),
      '-frames:v', '1', '-vf', `scale=${w}:-2`, '-q:v', '5', out]);
    if (r.code !== 0) throw new Error(r.err.trim().split('\n').slice(-2).join('\n') || '프레임 추출 실패');
    return fsp.readFile(out);
  }

  // 편집기 배경 (레이어 없이, 확대·보정만 적용한 장면)
  async function background(q) {
    const s = await script(); const meta = s.meta[q.key];
    await fsp.mkdir(path.join(DIR, 'bg'), { recursive: true });
    const out = path.join(DIR, 'bg', `${q.key}.jpg`);
    const r = await run(ffPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', toSrc(meta, +q.t || 0).toFixed(3), '-i', path.join(root, path.basename(meta.src)),
      '-frames:v', '1', '-vf', bgFilter(q), '-q:v', '3', out]);
    if (r.code !== 0) throw new Error(r.err.trim().split('\n').slice(-2).join('\n') || '배경 추출 실패');
    return fsp.readFile(out);
  }

  async function render(d) {
    const s = await script(); const meta = s.meta[d.key];
    await fsp.mkdir(DIR, { recursive: true });
    const assName = `thumb_${d.id}.ass`;
    await fsp.writeFile(path.join(DIR, assName), layersAss(d, await fontsMap(), defaultFont()), 'utf8');
    const out = path.join(DIR, `${d.id}.png`);
    const r = await run(ffPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', toSrc(meta, d.t).toFixed(3), '-i', path.join(root, path.basename(meta.src)),
      '-frames:v', '1', '-vf', `${bgFilter(d)},subtitles=filename=${assName}:fontsdir=../fonts`, out], { cwd: DIR });
    if (r.code !== 0) throw new Error(r.err.trim().split('\n').slice(-3).join('\n') || '썸네일 렌더 실패');
    return { ...d, png: `${d.id}.png`, rendered: Date.now() };
  }

  // 템플릿 기반 초안(구버전·에이전트 제안)을 레이어로 변환
  async function ensureLayers(d) {
    if (Array.isArray(d.layers)) return d;
    const s = await script(); const meta = s.meta[d.key];
    const st = resolveStyle(s.style || {}, {}, defaultFont());
    const f = { title: d.title ?? 'PROJECT ZK', kicker: d.kicker ?? '탑뷰 공중 액션', sub: d.sub ?? `${meta?.title || ''} 플레이 영상`, badge: d.badge ?? (meta?.date || '') };
    const { title, kicker, sub, badge, ...rest } = d;
    return { ...rest, template: d.template || 'magazine', layers: templateLayers(d.template || 'magazine', f, st) };
  }

  async function upsert(d, { render: doRender = true } = {}) {
    const list = await load();
    const prev = list.find((x) => x.id === d.id);
    let draft = { zoom: 1, fx: 0.5, fy: 0.5, ...(prev || {}), ...d, id: d.id || `${d.key}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}` };
    draft = await ensureLayers(draft);
    draft.label = draftLabel(draft);
    if (doRender) draft = await render(draft);
    await store([...list.filter((x) => x.id !== draft.id), draft]);
    return draft;
  }

  async function migrateAll() {
    const list = await load(); let changed = false;
    const out = [];
    for (const d of list) { if (!Array.isArray(d.layers)) { out.push({ ...(await ensureLayers(d)), label: d.kicker }); changed = true; } else out.push(d); }
    if (changed) await store(out);
    return out;
  }

  async function remove(id) {
    const list = await load();
    await fsp.rm(path.join(DIR, `${id}.png`), { force: true });
    await fsp.rm(path.join(DIR, `thumb_${id}.ass`), { force: true });
    await store(list.filter((x) => x.id !== id));
  }

  async function save(id, outDir) {
    const list = await load(); const d = list.find((x) => x.id === id); if (!d) throw new Error('초안 없음');
    const dir = path.join(outDir, '썸네일'); await fsp.mkdir(dir, { recursive: true });
    const name = `ProjectZK_${d.key}_${draftLabel(d).replace(/[\\/:*?"<>|\s]+/g, '_')}_${id.slice(-4)}.png`;
    const dest = path.join(dir, name);
    await fsp.copyFile(path.join(DIR, `${id}.png`), dest);
    return dest;
  }

  return { DIR, load: migrateAll, sample, still, background, render, upsert, remove, save, toSrc, file: (id) => path.join(DIR, `${path.basename(id)}.png`) };
}

// 에이전트: 썸네일 초안 일괄 제안
export const THUMB_TOOL = {
  name: 'propose_thumbnails',
  description: '후보 장면 중에서 골라 유튜브 썸네일 초안을 여러 개 제안한다. 각 초안은 서버에서 템플릿 레이어로 만들어 즉시 PNG로 렌더된다.',
  schema: {
    type: 'object',
    properties: {
      drafts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            frame: { type: 'integer', description: '후보 프레임 번호' },
            offset: { type: 'number', description: '후보 시각 기준 미세 조정(초, -4~4)' },
            template: { type: 'string', enum: Object.keys(TEMPLATES) },
            kicker: { type: 'string', description: '핵심 문구(강조색, 한국어 4~10자 권장)' },
            sub: { type: 'string', description: '부제 (예: 프로토타입 플레이 영상)' },
            title: { type: 'string', description: '브랜드 문구, 기본 PROJECT ZK' },
            badge: { type: 'string', description: '날짜/라벨, 생략 가능' },
            zoom: { type: 'number', description: '1.0~1.6 확대' },
            fx: { type: 'number', description: '확대 중심 x (0~1)' },
            fy: { type: 'number', description: '확대 중심 y (0~1)' },
            reason: { type: 'string', description: '선택 이유 (짧게)' },
          },
          required: ['frame', 'template', 'kicker'],
        },
      },
      summary: { type: 'string' },
    },
    required: ['drafts'],
  },
};
