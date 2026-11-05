// 영상 소스 분석: 장면 전환 감지(로컬 ffmpeg, 무료) · 받아쓰기(ElevenLabs Speech-to-Text, 유료)
// 결과는 사람이 고칠 수 있는 데이터로 저장하고(sources.mjs), AI 컨텍스트에 텍스트로 첨부한다.
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { SCENE_SENS, MIN_SCENE } from './shared/sources.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const tail = (e) => String(e || '').trim().split('\n').slice(-3).join('\n');

// ffmpeg 실행 + -progress로 진행률(0~1) 보고
function runFF(ff, args, { cwd, duration, onProgress } = {}) {
  return new Promise((ok) => {
    let err = ''; let buf = ''; let p;
    try { p = spawn(ff, ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', ...args], { cwd, windowsHide: true }); }
    catch (e) { return ok({ code: -1, err: e.message }); }
    p.stdout.on('data', (d) => {
      buf += d; const ls = buf.split('\n'); buf = ls.pop();
      for (const ln of ls) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(ln);
        if (m && duration) onProgress?.(Math.max(0, Math.min(0.99, parseInt(m[1], 10) / 1e6 / duration)));
      }
    });
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', (e) => ok({ code: -1, err: e.message }));
    p.on('close', (code) => ok({ code, err }));
  });
}

// 장면 전환 시각 정리: 정렬, 앞뒤 끝 근처 제거, 너무 짧은 장면은 앞 장면에 합침
export function cleanCuts(cuts, duration, min = MIN_SCENE) {
  const out = [];
  for (const t of [...cuts].map(Number).filter(Number.isFinite).sort((a, b) => a - b)) {
    const r = Math.round(t * 100) / 100;
    if (r < min || r > duration - min) continue;
    if (out.length && r - out[out.length - 1] < min) continue;
    out.push(r);
  }
  return out.slice(0, 400);
}

// 작은 크기·초당 10장으로 훑으며 이전 장면과의 차이(scene score)가 임계값을 넘는 시각을 찾음
export async function detectScenes({ ff, file, dir, duration, sensitivity = 'normal', onProgress }) {
  const th = (SCENE_SENS[sensitivity] || SCENE_SENS.normal).th;
  const out = path.join(dir, 'scenes.txt');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.rm(out, { force: true });
  const r = await runFF(ff, ['-i', file, '-an', '-sn', '-dn', '-vf', `fps=10,scale=192:-2,select='gt(scene,${th})',metadata=print:file=scenes.txt`, '-f', 'null', '-'],
    { cwd: dir, duration, onProgress });
  if (r.code !== 0) throw fail(tail(r.err) || '장면 분석에 실패했습니다 (ffmpeg 확인).', 500);
  let txt = ''; try { txt = await fsp.readFile(out, 'utf8'); } catch {}
  await fsp.rm(out, { force: true });
  return cleanCuts([...txt.matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]), duration);
}

// 단어 단위 타임스탬프 → 화면에서 고치기 좋은 문장 단위 (쉼 0.7초·문장부호·70자·화자 변경에서 나눔)
export function groupWords(j, duration = 0) {
  const words = Array.isArray(j?.words) ? j.words : [];
  const segs = []; let cur = null;
  for (const w of words) {
    if (w.type === 'audio_event') continue;
    if (w.type === 'spacing') { if (cur) cur.pending += w.text || ' '; continue; }
    const t = String(w.text || '');
    if (!t.trim() || !Number.isFinite(+w.start)) continue;
    const s = +w.start; const e = Number.isFinite(+w.end) ? +w.end : s;
    const brk = !cur || s - cur.e > 0.7 || cur.text.length >= 70 || (/[.!?。？！…]$/.test(cur.text) && cur.text.length >= 8)
      || (w.speaker_id != null && w.speaker_id !== cur.speaker);
    if (brk) { cur = { s, e, text: t.trim(), speaker: w.speaker_id ?? null, pending: '' }; segs.push(cur); }
    else { cur.text += (cur.pending || ' ') + t; cur.text = cur.text.replace(/\s+/g, ' ').trim(); cur.e = e; cur.pending = ''; }
  }
  const out = segs.map(({ s, e, text, speaker }) => ({ s: Math.round(s * 100) / 100, e: Math.round(e * 100) / 100, text, ...(speaker != null ? { speaker } : {}) }));
  if (!out.length && String(j?.text || '').trim()) out.push({ s: 0, e: Math.round(duration * 100) / 100, text: j.text.trim() });
  return out;
}

// 오디오만 작게(모노 16kHz AAC) 뽑아 ElevenLabs Speech-to-Text로 보냄
export async function transcribe({ ff, file, dir, duration, key, base, model = 'scribe_v2', lang = '', diarize = false, onProgress, onPhase }) {
  if (!key) throw fail('설정에서 ElevenLabs API 키를 등록하세요.');
  await fsp.mkdir(dir, { recursive: true });
  const audio = path.join(dir, 'stt_audio.m4a');
  onPhase?.('audio');
  const r = await runFF(ff, ['-y', '-i', file, '-vn', '-sn', '-dn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', audio],
    { cwd: dir, duration, onProgress: (p) => onProgress?.(p * 0.3) });
  try {
    if (r.code !== 0) {
      if (/does not contain any stream|matches no streams|no audio/i.test(r.err)) throw fail('소리가 없는 영상입니다.');
      throw fail(tail(r.err) || '오디오 추출에 실패했습니다 (ffmpeg 확인).', 500);
    }
    onPhase?.('stt'); onProgress?.(0.35);
    const fd = new FormData();
    fd.append('model_id', model);
    fd.append('file', new Blob([await fsp.readFile(audio)], { type: 'audio/mp4' }), 'audio.m4a');
    fd.append('timestamps_granularity', 'word');
    fd.append('tag_audio_events', 'false');
    if (lang) fd.append('language_code', lang);
    if (diarize) fd.append('diarize', 'true');
    const res = await fetch(`${base}/v1/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = j?.detail;
      throw fail(`ElevenLabs 받아쓰기: ${d?.message || d?.status || (typeof d === 'string' ? d : '') || `${res.status} ${res.statusText}`}`, res.status);
    }
    onProgress?.(0.97);
    return { lang: j.language_code || lang || '', segments: groupWords(j, duration) };
  } finally { await fsp.rm(audio, { force: true }); }
}
