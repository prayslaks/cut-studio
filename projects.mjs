// 프로젝트 관리: 레지스트리(앱 폴더의 projects.json), 생성·열기, 기존 단일 작업 폴더 이전, 파일 탐색, 영상 정보
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { APP_NAME } from './shared/app.js';
import { VIDEO_EXT } from './shared/sources.js';

export { VIDEO_EXT };
export const DEFAULT_PARENT = path.join(os.homedir(), 'Videos', APP_NAME);

// 새 프로젝트의 project.json(script.json) 기본값
export function projectTemplate({ name, brand, tagline, brief, subtitleFormat }) {
  return {
    project: { name: name || '새 프로젝트', brand: brand || (name || '').toUpperCase(), tagline: tagline || '', brief: brief || '',
      subtitleFormat: subtitleFormat || '{title}', created: new Date().toISOString() },
    videos: [], meta: {},
    voice: { model_id: 'eleven_v4', voice_id: '', language_code: 'ko', tone: { enabled: false, tags: '[narrator][calm]', override: true } },
    voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 },
    pronunciation: [], style: {},
  };
}

// 이전 버전(ProjectZK 전용) script.json → 프로젝트 형식으로 보정. 바뀌면 true
export function upgradeScript(s, { videoRoot } = {}) {
  let changed = false;
  if (!s.meta) { s.meta = {}; changed = true; }
  if (!Array.isArray(s.videos)) {
    s.videos = Object.keys(s.meta).filter((k) => Array.isArray(s[k]) || s.meta[k]?.segs);
    changed = true;
  }
  for (const k of s.videos) {
    if (!Array.isArray(s[k])) { s[k] = []; changed = true; }
    const m = s.meta[k];
    if (m?.src && !path.isAbsolute(m.src) && videoRoot) { m.src = path.join(videoRoot, path.basename(m.src)); changed = true; }
  }
  if (!s.project) {
    const zk = s.videos.length > 0 && /project\s*zk/i.test(JSON.stringify(s));
    s.project = zk ? {
      name: 'Project ZK', brand: 'PROJECT ZK', tagline: '탑뷰 공중 액션', subtitleFormat: '{title} 플레이 영상',
      brief: 'ProjectZK는 개인 게임 개발자가 만든 탑뷰 시점 공중 액션 슈팅 게임(실시간 전략 플라이트 슈팅)이다. 영상은 포트폴리오/홍보용 플레이 영상이며 개발자 소개 톤으로 설명한다. 썸네일 레퍼런스(캔바): 큰 흰색 굵은 "PROJECT ZK", 라임(#DCF884) 강조 문구 "탑뷰 공중 액션", 흰색 부제 "… 플레이 영상", 날짜, 어두운 남색(#080C0F) 그림자. 게임 HUD(하단 무장 슬롯)를 자막이 가리지 않게.',
    } : { name: '내 프로젝트', brand: '', tagline: '', subtitleFormat: '{title}', brief: '' };
    if (zk && !Array.isArray(s.style?.keywords)) {
      s.style = { ...(s.style || {}), keywords: ['Project ZK', 'AWACS', '벌컨', '다트', '레이저', '플레어', '에어브레이크', '부스트', '기총', '미사일',
        '스트레스', '미니맵', '로드아웃', '공중전함', '에어프레임', '레이더', '록온'] };
    }
    changed = true;
  }
  return changed;
}

export function createRegistry(appDir) {
  const FILE = path.join(appDir, 'projects.json');
  let reg = { current: null, projects: [] };
  try { reg = { ...reg, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  const save = () => fs.writeFileSync(FILE, JSON.stringify(reg, null, 2), 'utf8');
  const exists = (dir) => fs.existsSync(path.join(dir, 'script.json'));
  const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function add(dir, name) {
    dir = path.resolve(dir);
    let p = reg.projects.find((x) => path.resolve(x.dir) === dir);
    if (!p) { p = { id: id(), name, dir }; reg.projects.push(p); }
    if (name) p.name = name;
    p.opened = Date.now(); reg.current = p.id; save();
    return p;
  }
  return {
    FILE,
    list: () => reg.projects.map((p) => ({ ...p, missing: !exists(p.dir) })).sort((a, b) => (b.opened || 0) - (a.opened || 0)),
    current: () => reg.projects.find((p) => p.id === reg.current && exists(p.dir)) || null,
    add,
    open(idOrDir) {
      const p = reg.projects.find((x) => x.id === idOrDir);
      const dir = p ? p.dir : idOrDir;
      if (!dir || !exists(dir)) throw Object.assign(new Error(`프로젝트 파일(script.json)이 없습니다: ${dir}`), { status: 400 });
      let script;
      try { script = JSON.parse(fs.readFileSync(path.join(dir, 'script.json'), 'utf8')); }
      catch { throw Object.assign(new Error('프로젝트 파일(script.json)을 읽을 수 없습니다.'), { status: 400 }); }
      if (!script || typeof script !== 'object' || Array.isArray(script)) {
        throw Object.assign(new Error('올바른 프로젝트 파일이 아닙니다.'), { status: 400 });
      }
      const name = script.project?.name || p?.name;
      return add(dir, name || path.basename(dir));
    },
    rename(pid, name) { const p = reg.projects.find((x) => x.id === pid); if (p) { p.name = name; save(); } },
    forget(pid) { reg.projects = reg.projects.filter((x) => x.id !== pid); if (reg.current === pid) reg.current = null; save(); },
    close() { reg.current = null; save(); },
    isEmpty: () => !reg.projects.length,
  };
}

export async function createProjectDir(parent, b) {
  const safe = String(b.name || '새 프로젝트').replace(/[\\/:*?"<>|\x00-\x1F]+/g, '_').trim().replace(/[. ]+$/, '') || 'project';
  const root = path.resolve(parent || DEFAULT_PARENT);
  await fsp.mkdir(root, { recursive: true });
  let dir = path.join(root, safe);
  for (let n = 2; ; n++) {
    try { await fsp.mkdir(dir); break; }
    catch (e) { if (e.code !== 'EEXIST') throw e; dir = path.join(root, `${safe} (${n})`); }
  }
  await fsp.mkdir(path.join(dir, 'tts'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'script.json'), JSON.stringify(projectTemplate(b), null, 2), 'utf8');
  return dir;
}

// 폴더 탐색 (영상 선택·프로젝트 위치 선택). dir 비면 드라이브/홈 목록
export async function listDir(dir, mode = 'video') {
  if (!dir) {
    const roots = [];
    if (process.platform === 'win32') {
      for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') if (fs.existsSync(`${L}:\\`)) roots.push({ name: `${L}:\\`, path: `${L}:\\`, dir: true });
    } else roots.push({ name: '/', path: '/', dir: true });
    const home = os.homedir();
    const quick = ['Videos', 'Desktop', 'Documents', 'Downloads'].map((n) => path.join(home, n)).filter((d) => fs.existsSync(d));
    return { dir: '', parent: null, entries: [...quick.map((d) => ({ name: path.basename(d), path: d, dir: true, quick: true })), ...roots] };
  }
  dir = path.resolve(dir);
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name.startsWith('$')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push({ name: e.name, path: full, dir: true, project: fs.existsSync(path.join(full, 'script.json')) });
    else if (mode === 'video' && VIDEO_EXT.includes(path.extname(e.name).toLowerCase())) {
      let size = 0; try { size = (await fsp.stat(full)).size; } catch {}
      out.push({ name: e.name, path: full, dir: false, size });
    }
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'ko') : a.dir ? -1 : 1));
  const parent = path.dirname(dir);
  return { dir, parent: parent === dir ? '' : parent, entries: out, isProject: fs.existsSync(path.join(dir, 'script.json')) };
}

// ffprobe로 길이·해상도
export function probe(ffprobe, file) {
  return new Promise((ok) => {
    let out = '';
    let p;
    try { p = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_type', '-of', 'json', file], { windowsHide: true }); }
    catch (e) { return ok({ error: e.message }); }
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', (e) => ok({ error: e.message }));
    p.on('close', () => {
      try {
        const j = JSON.parse(out); const v = (j.streams || []).find((s) => s.codec_type === 'video') || {};
        ok({ duration: +j.format?.duration || 0, width: v.width || 0, height: v.height || 0, audio: (j.streams || []).some((s) => s.codec_type === 'audio') });
      } catch { ok({ error: 'ffprobe 결과를 읽지 못했습니다' }); }
    });
  });
}

// 영상 원본 경로: 절대경로면 그대로, 아니면 기준 폴더 + 파일명 (이전 형식 호환)
export const srcPath = (meta, root) => (!meta?.src ? null : path.isAbsolute(meta.src) ? meta.src : path.join(root || '', path.basename(meta.src)));
