// 완성본 MP4 내보내기: 트림 + 자막(ASS 번인) + TTS 덕킹 믹스를 ffmpeg 한 번으로 처리
// 구간마다 원본 촬영본이 다를 수 있음(shared/clips.js) — 촬영본마다 입력 하나, 비율이 다르면 레터박스
// (작업 폴더의 build.py와 같은 규칙. 자막 스타일 = 캔바 썸네일 톤)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { FRAME, SUB, resolveStyle, SUB_TAIL, wrapLines, highlightParts } from './shared/layout.js';
import { resolveCards, cardInstances, cardAss } from './shared/cards.js';
import { segPath } from './projects.mjs';
import { locateSeg, fitFilter } from './shared/clips.js';
import { MAIN, trackLines, trackCfg, applyDict } from './shared/tracks.js';

const { W, H } = FRAME;
const assColor = (hex = '#FFFFFF') => { const h = hex.replace('#', '').padEnd(6, '0'); return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase(); };
const assColorA = (hex, alpha = '00') => assColor(hex).replace('&H', `&H${alpha}`).replace(/&$/, '');
const FADE = 0.4;
const assAlpha = (a) => `&H${Math.round((1 - a) * 255).toString(16).padStart(2, '0').toUpperCase()}&`; // 불투명도 → ASS alpha

export const ENCODERS = {
  libx264: { label: 'CPU (x264)', args: (q) => ['-c:v', 'libx264', '-preset', { high: 'medium', standard: 'veryfast', draft: 'ultrafast' }[q], '-crf', { high: '18', standard: '20', draft: '26' }[q], '-profile:v', 'high'] },
  h264_nvenc: { label: 'NVIDIA (NVENC)', args: (q) => ['-c:v', 'h264_nvenc', '-preset', { high: 'p6', standard: 'p5', draft: 'p2' }[q], '-rc', 'vbr', '-cq', { high: '19', standard: '22', draft: '28' }[q], '-b:v', '0', '-profile:v', 'high'] },
  h264_qsv: { label: 'Intel (QSV)', args: (q) => ['-c:v', 'h264_qsv', '-global_quality', { high: '20', standard: '23', draft: '28' }[q]] },
  h264_amf: { label: 'AMD (AMF)', args: (q) => ['-c:v', 'h264_amf', '-quality', q === 'draft' ? 'speed' : 'quality', '-rc', 'cqp', '-qp_i', { high: '19', standard: '22', draft: '28' }[q], '-qp_p', { high: '21', standard: '24', draft: '30' }[q]] },
};

// ---------- 공통 ----------
const run = (bin, args, opt = {}) => new Promise((ok) => {
  let out = '', err = '';
  let p;
  try { p = spawn(bin, args, { windowsHide: true, ...opt }); } catch (e) { return ok({ code: -1, out, err: e.message }); }
  p.stdout?.on('data', (d) => { out += d; });
  p.stderr?.on('data', (d) => { err += d; });
  p.on('error', (e) => ok({ code: -1, out, err: e.message }));
  p.on('close', (code) => ok({ code, out, err }));
});

export const ffprobeOf = (ff) => {
  if (!ff || ff === 'ffmpeg') return 'ffprobe';
  const dir = path.dirname(ff); const ext = path.extname(ff);
  return path.join(dir, `ffprobe${ext}`);
};

export async function checkFfmpeg(ff) {
  const v = await run(ff, ['-hide_banner', '-version']);
  if (v.code !== 0) return { ok: false, error: v.err || 'ffmpeg 실행 실패' };
  const version = v.out.split('\n')[0].trim();
  const probe = await run(ffprobeOf(ff), ['-version']);
  const encoders = [];
  await Promise.all(Object.keys(ENCODERS).map(async (enc) => {
    const r = await run(ff, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=0.2',
      '-frames:v', '3', ...ENCODERS[enc].args('draft'), '-f', 'null', '-']);
    if (r.code === 0) encoders.push(enc);
  }));
  const f = await run(ff, ['-hide_banner', '-filters']);
  return { ok: true, version, ffprobe: probe.code === 0, libass: /\bsubtitles\b/.test(f.out), encoders: Object.keys(ENCODERS).filter((e) => encoders.includes(e)) };
}

// 오디오 스트림이 없는 촬영본(화면 녹화 등)은 무음으로 채운다
async function hasAudio(ff, file) {
  const r = await run(ffprobeOf(ff), ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
  return r.code === 0 && r.out.trim().length > 0;
}

async function probeDur(ff, file) {
  const r = await run(ffprobeOf(ff), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = parseFloat(r.out); return Number.isFinite(d) ? d : null;
}

// ---------- 자막 (ASS) ----------
const ts = (t) => {
  t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};
const srtTs = (t) => {
  t = Math.max(0, t); const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
const assEsc = (s) => String(s).replace(/[{}\\]/g, '');
const ev = (layer, a, b, text, style = 'Card') => `Dialogue: ${layer},${ts(a)},${ts(b)},${style},,0,0,0,,${text}\n`;
const ms = (s) => Math.round(s * 1000);

export function buildAss({ st, meta, cards, fontsMap = {}, offs, body, total, lines, project }) {
  st = st || resolveStyle({});
  const LIME = assColor(st.colors.accent), WHITE = assColor(st.colors.text);
  const assText = (line) => highlightParts(assEsc(line), st.keywords).map((p) => (p.hl ? `{\\c${LIME}}${p.t}{\\c${WHITE}}` : p.t)).join('');
  const fs = st.face.sub, ft = st.face.title, S = st.sub;
  let o = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,${fs.name},${S.size},${assColorA(st.colors.text)},&H000000FF,${assColorA(st.colors.outline)},${assColorA(st.colors.outline, assAlpha(SUB.shadowAlpha).slice(2, 4))},${fs.bold ? -1 : 0},0,0,0,100,100,0,0,1,${S.outline},${S.shadow},2,${SUB.marginH},${SUB.marginH},${S.marginV},1
Style: Card,${ft.name},80,${assColorA(st.colors.text)},&H000000FF,${assColorA(st.colors.outline)},${assColorA(st.colors.outline)},${ft.bold ? -1 : 0},0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  // 카드 (인트로·챕터·엔딩) — shared/cards.js
  const fontOf = (f = {}) => {
    const hit = fontsMap[`${f.family}|${f.weight}`];
    if (hit) return { name: hit.name, bold: hit.bold };
    if (f.source === 'system') return { name: f.family, bold: (f.weight || 700) >= 600 };
    return { name: ft.name, bold: (f.weight || 700) >= 600 };
  };
  const insts = cardInstances(cards || resolveCards(meta || {}), { meta: meta || {}, offs, body, total, project });
  insts.forEach((inst) => { o += cardAss(inst, st, fontOf, inst.kind === 'end' ? 20 : 0); });
  // 나레이션 자막
  for (const l of lines) {
    if (!l.text.trim()) continue;
    o += ev(40, l.start, l.start + l.dur + SUB_TAIL, `{\\fad(150,150)}${wrapLines(l.text, S.maxChars).map(assText).join('\\N')}`, 'Sub');
  }
  return o;
}

// ---------- 내보내기 작업 ----------
const jobs = new Map();
let current = null;

export function getJob(id) { return jobs.get(id) || null; }

export function cancelJob(id) {
  const j = jobs.get(id); if (!j) return false;
  j.canceled = true;
  j.proc?.kill('SIGKILL');
  return true;
}

export async function startExport(opts, env) {
  if (current && !current.finished) throw Object.assign(new Error('이미 내보내기가 진행 중입니다'), { status: 409 });
  const id = Date.now().toString(36);
  // 항목 = 영상 × 조합 (조합 없으면 기본 트랙 하나)
  const combos = opts.combos?.length ? opts.combos : [{ id: MAIN, name: '', audio: MAIN, subs: MAIN, suffix: '' }];
  const job = { id, created: Date.now(), finished: false,
    items: opts.targets.flatMap((k) => combos.map((c) => ({ id: `${k}__${c.id}`, key: k, combo: c, status: 'queued', progress: 0 }))) };
  jobs.set(id, job); current = job;
  (async () => {
    for (const it of job.items) {
      if (job.canceled) { it.status = 'canceled'; continue; }
      try { await exportOne(it, opts, env, job); } catch (e) {
        it.status = job.canceled ? 'canceled' : 'error'; it.error = e.message;
      }
    }
    job.finished = true;
  })();
  return job;
}

// 편집본 타임라인·대사 길이 계산 + ASS 파일 작성 (내보내기와 프레임 렌더가 공유)
// opts.audio / opts.subs: 음성·자막으로 쓸 나레이션 트랙 id (null = 넣지 않음)
async function prepare(key, opts, env) {
  const { ff, work } = env;
  const script = JSON.parse(await fsp.readFile(path.join(work, 'script.json'), 'utf8'));
  const meta = script.meta?.[key];
  if (!meta) throw new Error(`meta.${key} 없음`);
  const segs = meta.segs; const endDur = meta.end_card ?? 4;
  const offs = []; let t = 0; for (const [s, e] of segs) { offs.push(t); t += e - s; }
  const body = t, total = body + endDur;
  const linesOf = async (tid) => {
    if (!tid) return [];
    const dict = trackCfg(script, tid).pronunciation;
    const out = [];
    for (const l of trackLines(script, key, tid).sort((a, b) => a.start - b.start)) {
      const mp3 = path.join(work, 'tts', `${l.id}.mp3`);
      const exists = fs.existsSync(mp3);
      const say = l.tts?.trim() ? l.tts : applyDict(l.text, dict);
      const dur = (exists && await probeDur(ff, mp3)) || Math.max(2, say.length / 7);
      out.push({ ...l, mp3: exists ? mp3 : null, dur });
    }
    return out;
  };
  const audioTrack = opts.audio === undefined ? MAIN : opts.audio, subTrack = opts.subs === undefined ? MAIN : opts.subs;
  const lines = await linesOf(subTrack); // 자막
  const voice = opts.tts === false ? [] : (audioTrack === subTrack ? lines : await linesOf(audioTrack)).filter((l) => l.mp3); // 음성
  const assName = opts.assName || `subs_${key}.ass`;
  const fontsMap = env.fontsMap ? await env.fontsMap() : {};
  const st = resolveStyle(script.style || {}, fontsMap, opts.font);
  await fsp.writeFile(path.join(work, assName), buildAss({ st, meta, cards: resolveCards(meta), fontsMap, offs, body, total, lines, project: script.project }), 'utf8');
  return { script, meta, segs, endDur, offs, body, total, lines, voice, assName, st };
}

// 최종 렌더와 동일한 자막·카드로 한 프레임만 렌더 (편집본 시각 t)
export async function renderFrame(key, t, opts, env) {
  const { ff, work, root } = env;
  const P = await prepare(key, { ...opts, audio: null, assName: `subs_${key}_frame.ass` }, env);
  t = Math.max(0, Math.min(t, P.total - 0.05));
  let inp;
  if (t >= P.body) inp = ['-f', 'lavfi', '-i', `color=c=0x080C0F:s=${W}x${H}:d=1`];
  else {
    const last = P.segs[P.segs.length - 1];
    const loc = locateSeg(P.segs, t) || { seg: last, t: last[1] - 0.05 };
    inp = ['-ss', loc.t.toFixed(3), '-i', segPath(P.meta, loc.seg, root)];
  }
  const out = path.join(work, `frame_${key}.jpg`);
  const r = await run(ff, ['-y', '-hide_banner', '-loglevel', 'error', ...inp, '-frames:v', '1', '-vf',
    `${fitFilter(W, H)},setpts=PTS-STARTPTS+${t.toFixed(3)}/TB,subtitles=filename=${P.assName}:fontsdir=fonts,scale=${opts.width || 1600}:-2`,
    '-q:v', '3', out], { cwd: work });
  if (r.code !== 0) throw new Error(r.err.trim().split('\n').slice(-4).join('\n') || 'ffmpeg 실패');
  return out;
}

async function exportOne(it, opts, env, job) {
  const { ff, work, root, outDir } = env;
  const key = it.key; const combo = it.combo || {};
  const audioOnly = !!combo.audioOnly;
  it.status = 'preparing';
  const { meta, segs, endDur, body, total, lines, voice, assName, st } = await prepare(key, { ...opts, audio: combo.audio ?? MAIN, subs: audioOnly ? null : combo.subs ?? MAIN, assName: `subs_${key}_${combo.id || MAIN}.ass` }, env);

  const base = (meta.out || `${path.parse(meta.src).name}_편집본`) + (opts.suffix || '') + String(combo.suffix || '').replace(/[\/:*?"<>|]+/g, '_');
  const ext = audioOnly ? 'm4a' : 'mp4';
  const out = path.join(outDir || root, `${base}.${ext}`);
  const part = path.join(outDir || root, `${base}.part.${ext}`);
  await fsp.mkdir(outDir || root, { recursive: true });
  if (opts.srt && !audioOnly && combo.subs !== null) {
    const srt = lines.filter((l) => l.text.trim()).map((l, i) =>
      `${i + 1}\n${srtTs(l.start)} --> ${srtTs(l.start + l.dur + SUB_TAIL)}\n${wrapLines(l.text, st.sub.maxChars).join('\n')}\n`).join('\n');
    await fsp.writeFile(path.join(outDir || root, `${base}.srt`), '﻿' + srt, 'utf8');
    it.srt = path.join(outDir || root, `${base}.srt`);
  }

  // 필터 그래프 (오디오만 내보내기: 영상 없이 같은 길이의 최종 믹스 — 유튜브 다국어 오디오 트랙용)
  const files = [...new Set(segs.map((g) => segPath(meta, g, root)))];
  const audio = await Promise.all(files.map((f) => hasAudio(ff, f)));
  const inputs = files.flatMap((f) => ['-i', f]); const fc = []; const n = segs.length;
  // 마지막 구간: 엔딩 카드로 넘어가기 전에 게임 소리를 길게 페이드아웃 (소스가 끝나며 뚝 끊기지 않도록)
  const endFade = Math.max(FADE, Math.min(+(opts.endFade ?? 3), 10));
  segs.forEach((g, i) => {
    const [s, e] = g; const d = e - s;
    const fi = files.indexOf(segPath(meta, g, root));
    const af = i === n - 1 ? Math.min(endFade, d) : FADE;
    if (!audioOnly) fc.push(`[${fi}:v]trim=${s}:${e},setpts=PTS-STARTPTS,fps=30000/1001,${fitFilter(W, H)},format=yuv420p,fade=in:st=0:d=${FADE},fade=out:st=${(d - FADE).toFixed(3)}:d=${FADE}[v${i}]`);
    fc.push(audio[fi]
      ? `[${fi}:a]atrim=${s}:${e},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,afade=in:st=0:d=${FADE},afade=out:st=${(d - af).toFixed(3)}:d=${af.toFixed(3)}[a${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=0:${d.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  if (!audioOnly) fc.push(`color=c=0x080C0F:s=${W}x${H}:r=30000/1001:d=${endDur},format=yuv420p,setsar=1[v${n}]`);
  fc.push(`anullsrc=r=48000:cl=stereo,atrim=0:${endDur}[a${n}]`);
  if (audioOnly) fc.push(Array.from({ length: n + 1 }, (_, i) => `[a${i}]`).join('') + `concat=n=${n + 1}:v=0:a=1[ac]`);
  else {
    fc.push(Array.from({ length: n + 1 }, (_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${n + 1}:v=1:a=1[vc][ac]`);
    const scale = opts.height && opts.height !== H ? `,scale=-2:${opts.height}:flags=lanczos` : '';
    fc.push(`[vc]subtitles=filename=${assName}:fontsdir=fonts${scale},format=yuv420p[vout]`);
  }
  const gv = (opts.gameVolume ?? 0.55).toFixed(2);
  if (voice.length) {
    voice.forEach((l, k) => {
      inputs.push('-i', l.mp3); const ms = Math.round(l.start * 1000);
      fc.push(`[${files.length + k}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms},volume=${(opts.ttsVolume ?? 1.6).toFixed(2)}[t${k}]`);
    });
    // apad: 마지막 대사가 영상보다 먼저 끝나도 사이드체인 입력이 끊기지 않게 (끊기면 sidechaincompress가 멈춰 인코딩이 멈춤, 길이는 -t로 자름)
    fc.push(voice.map((_, k) => `[t${k}]`).join('') + `amix=inputs=${voice.length}:normalize=0:duration=longest,apad,asplit=2[tts1][tts2]`);
    fc.push(`[ac]volume=${gv}[g]`);
    fc.push('[g][tts1]sidechaincompress=threshold=0.015:ratio=10:attack=30:release=500[gd]');
    fc.push('[gd][tts2]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[aout]');
  } else {
    fc.push(`[ac]volume=${gv},alimiter=limit=0.95[aout]`);
  }
  const enc = ENCODERS[opts.encoder] || ENCODERS.libx264;
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...inputs,
    '-filter_complex', fc.join(';'),
    ...(audioOnly ? ['-map', '[aout]', '-vn'] : ['-map', '[vout]', '-map', '[aout]', ...enc.args(opts.quality || 'standard'), '-pix_fmt', 'yuv420p']),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', total.toFixed(3), part];

  it.status = 'encoding'; it.total = total; it.started = Date.now(); it.out = out; it.audioOnly = audioOnly;
  let errTail = '';
  const code = await new Promise((ok) => {
    const p = spawn(ff, args, { cwd: work, windowsHide: true });
    job.proc = p;
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d; const ls = buf.split('\n'); buf = ls.pop();
      for (const ln of ls) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(ln);
        if (m) { const sec = parseInt(m[1], 10) / 1e6; it.progress = Math.min(0.999, sec / total); it.sec = sec; }
        const sp = /^speed=\s*([\d.]+)x/.exec(ln); if (sp) it.speed = parseFloat(sp[1]);
      }
    });
    p.stderr.on('data', (d) => { errTail = (errTail + d).slice(-4000); });
    p.on('error', (e) => { errTail += e.message; ok(-1); });
    p.on('close', ok);
  });
  job.proc = null;
  if (job.canceled) { await fsp.rm(part, { force: true }); it.status = 'canceled'; return; }
  if (code !== 0) { await fsp.rm(part, { force: true }); throw new Error(errTail.trim().split('\n').slice(-6).join('\n') || `ffmpeg 종료 코드 ${code}`); }
  await fsp.rm(out, { force: true });
  await fsp.rename(part, out);
  it.size = (await fsp.stat(out)).size;
  it.progress = 1; it.status = 'done'; it.elapsed = (Date.now() - it.started) / 1000;
}
