// Google Fonts 카탈로그·설치. 설치된 TTF는 작업 폴더 fonts/에 저장되어
// 브라우저 미리보기(@font-face)와 ffmpeg/libass(fontsdir)가 같은 파일을 사용한다.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const CSS_API = process.env.GFONTS_CSS_URL || 'https://fonts.googleapis.com/css2';
const META_URL = 'https://fonts.google.com/metadata/fonts';
const GH_RAW = 'https://raw.githubusercontent.com/google/fonts/main';

// 네트워크가 안 될 때 쓰는 기본 목록 (한글 지원 여부 포함)
const CURATED = [
  ['Noto Sans KR', [100, 200, 300, 400, 500, 600, 700, 800, 900], true, 'Sans Serif'],
  ['Noto Serif KR', [200, 300, 400, 500, 600, 700, 800, 900], true, 'Serif'],
  ['Nanum Gothic', [400, 700, 800], true, 'Sans Serif'],
  ['Nanum Myeongjo', [400, 700, 800], true, 'Serif'],
  ['Gothic A1', [100, 200, 300, 400, 500, 600, 700, 800, 900], true, 'Sans Serif'],
  ['IBM Plex Sans KR', [100, 200, 300, 400, 500, 600, 700], true, 'Sans Serif'],
  ['Black Han Sans', [400], true, 'Display'],
  ['Do Hyeon', [400], true, 'Display'],
  ['Jua', [400], true, 'Display'],
  ['Gugi', [400], true, 'Display'],
  ['Sunflower', [300, 500, 700], true, 'Sans Serif'],
  ['Gowun Dodum', [400], true, 'Sans Serif'],
  ['Gowun Batang', [400, 700], true, 'Serif'],
  ['Hahmlet', [100, 200, 300, 400, 500, 600, 700, 800, 900], true, 'Serif'],
  ['Orbit', [400], true, 'Sans Serif'],
  ['Dongle', [300, 400, 700], true, 'Sans Serif'],
  ['Gasoek One', [400], true, 'Display'],
  ['Bagel Fat One', [400], true, 'Display'],
  ['Song Myung', [400], true, 'Serif'],
  ['Nanum Pen Script', [400], true, 'Handwriting'],
  ['Orbitron', [400, 500, 600, 700, 800, 900], false, 'Display'],
  ['Rajdhani', [300, 400, 500, 600, 700], false, 'Sans Serif'],
  ['Chakra Petch', [300, 400, 500, 600, 700], false, 'Sans Serif'],
  ['Oswald', [200, 300, 400, 500, 600, 700], false, 'Sans Serif'],
  ['Bebas Neue', [400], false, 'Display'],
  ['Anton', [400], false, 'Sans Serif'],
  ['Russo One', [400], false, 'Sans Serif'],
  ['Audiowide', [400], false, 'Display'],
  ['Teko', [300, 400, 500, 600, 700], false, 'Sans Serif'],
  ['Exo 2', [100, 200, 300, 400, 500, 600, 700, 800, 900], false, 'Sans Serif'],
].map(([family, weights, korean, category]) => ({ family, weights, korean, category }));

export function createFonts(work) {
  const DIR = path.join(work, 'fonts');
  const DB = path.join(work, 'fonts.json'); // fonts/ 폴더엔 TTF만 (libass가 폴더 전체를 읽음)
  const CAT = path.join(work, 'fonts_catalog.json');

  const installed = async () => {
    let list; try { list = JSON.parse(await fsp.readFile(DB, 'utf8')); } catch { return []; }
    // libass 크기 기준(winAscent+winDescent / unitsPerEm)을 미리 계산해 둔다 (미리보기 크기 일치용)
    let changed = false;
    for (const f of list) {
      if (f.ratio == null) { try { f.ratio = assRatio(await fsp.readFile(path.join(DIR, f.file))); changed = true; } catch {} }
    }
    if (changed) await fsp.writeFile(DB, JSON.stringify(list, null, 2), 'utf8');
    return list;
  };

  async function catalog() {
    try {
      const st = await fsp.stat(CAT);
      if (Date.now() - st.mtimeMs < 7 * 864e5) return { source: 'google', fonts: JSON.parse(await fsp.readFile(CAT, 'utf8')) };
    } catch {}
    try {
      const r = await fetch(META_URL, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(r.status);
      const txt = (await r.text()).replace(/^\)\]\}'\s*/, '');
      const j = JSON.parse(txt);
      const fonts = (j.familyMetadataList || []).map((f) => ({
        family: f.family, category: f.category, korean: (f.subsets || []).includes('korean'),
        weights: [...new Set(Object.keys(f.fonts || {}).filter((k) => !k.endsWith('i')).map((k) => parseInt(k, 10)).filter(Boolean))].sort((a, b) => a - b),
        popularity: f.popularity,
      })).filter((f) => f.weights.length);
      await fsp.mkdir(DIR, { recursive: true });
      await fsp.writeFile(CAT, JSON.stringify(fonts), 'utf8');
      return { source: 'google', fonts };
    } catch (e) {
      return { source: 'curated', error: `Google Fonts 목록을 가져오지 못해 기본 목록을 사용합니다 (${e.message})`, fonts: CURATED };
    }
  }

  async function download(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return Buffer.from(await r.arrayBuffer());
  }

  async function install(family, weight) {
    weight = parseInt(weight, 10) || 400;
    const list = await installed();
    const hit = list.find((f) => f.family === family && f.weight === weight);
    if (hit && fs.existsSync(path.join(DIR, hit.file))) return hit;
    await fsp.mkdir(DIR, { recursive: true });
    let buf; let via = 'google-css';
    try {
      // 구형 UA로 요청하면 subset 분할 없는 단일 TTF를 돌려준다
      const css = await (await fetch(`${CSS_API}?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${weight}`,
        { headers: { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 8.0)' }, signal: AbortSignal.timeout(15000) })).text();
      const m = /url\((https:[^)]+?)\)\s*format\(['"]?truetype/.exec(css) || /url\((https:[^)]+?\.ttf)\)/.exec(css);
      if (!m) throw new Error(css.includes('400') || css.includes('Error') ? `해당 굵기 없음: ${family} ${weight}` : 'TTF 주소 없음');
      buf = await download(m[1]);
    } catch (e) {
      // 대체 경로: GitHub google/fonts 저장소의 정적 TTF
      via = 'github';
      const slug = family.toLowerCase().replace(/[^a-z0-9]/g, '');
      const base = family.replace(/\s+/g, '');
      const wname = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' }[weight];
      let ok = false;
      for (const lic of ['ofl', 'apache', 'ufl']) {
        try { buf = await download(`${GH_RAW}/${lic}/${slug}/${base}-${wname}.ttf`); ok = true; break; } catch {}
      }
      if (!ok) throw new Error(`폰트 다운로드 실패: ${family} ${weight} (${e.message})`);
    }
    const names = readNames(buf);
    const file = `${family.replace(/[^A-Za-z0-9]+/g, '')}-${weight}.ttf`;
    await fsp.writeFile(path.join(DIR, file), buf);
    // libass(fontconfig)는 전체 이름(full name)으로 정확히 지정할 수 있다
    const rec = { family, weight, file, name: names.full || names.family || family, cssFamily: `zk-${file.replace(/\.ttf$/, '')}`,
      fontFamily: names.family, subfamily: names.subfamily, via, size: buf.length, hangul: hasHangul(buf), ratio: assRatio(buf) };
    const next = [...list.filter((f) => !(f.family === family && f.weight === weight)), rec];
    await fsp.writeFile(DB, JSON.stringify(next, null, 2), 'utf8');
    return rec;
  }

  async function remove(family, weight) {
    const list = await installed();
    const hit = list.find((f) => f.family === family && f.weight === +weight);
    if (hit) await fsp.rm(path.join(DIR, hit.file), { force: true });
    await fsp.writeFile(DB, JSON.stringify(list.filter((f) => f !== hit), null, 2), 'utf8');
  }

  // resolveStyle용 맵: 'family|weight' → { name, bold:false } (정적 굵기 파일이므로 가짜 볼드 금지)
  async function fontsMap() {
    const m = {};
    for (const f of await installed()) if (fs.existsSync(path.join(DIR, f.file))) m[`${f.family}|${f.weight}`] = { name: f.name, bold: false, ratio: f.ratio };
    return m;
  }

  return { DIR, installed, catalog, install, remove, fontsMap, filePath: (file) => path.join(DIR, path.basename(file)) };
}

// ---- TTF name 테이블 파서 (family / subfamily / full name) ----
export function readNames(buf) {
  try {
    const n = buf.readUInt16BE(4); let off = 12; let nameOff = -1;
    for (let i = 0; i < n; i++, off += 16) if (buf.toString('ascii', off, off + 4) === 'name') { nameOff = buf.readUInt32BE(off + 8); break; }
    if (nameOff < 0) return {};
    const count = buf.readUInt16BE(nameOff + 2); const strOff = nameOff + buf.readUInt16BE(nameOff + 4);
    const out = {}; const pick = {};
    for (let i = 0; i < count; i++) {
      const r = nameOff + 6 + i * 12;
      const plat = buf.readUInt16BE(r), enc = buf.readUInt16BE(r + 2), lang = buf.readUInt16BE(r + 4), id = buf.readUInt16BE(r + 6);
      const len = buf.readUInt16BE(r + 8), so = strOff + buf.readUInt16BE(r + 10);
      if (![1, 2, 4, 16, 17].includes(id)) continue;
      let str = null; let score = 0;
      if (plat === 3 && (enc === 1 || enc === 10)) { str = ''; for (let k = 0; k < len; k += 2) str += String.fromCharCode(buf.readUInt16BE(so + k)); score = lang === 0x409 ? 3 : 2; }
      else if (plat === 1 && enc === 0) { str = buf.toString('latin1', so, so + len); score = 1; }
      if (str != null && (pick[id] ?? -1) < score) { pick[id] = score; out[id] = str; }
    }
    return { family: out[1], subfamily: out[2], full: out[4], typoFamily: out[16], typoSub: out[17] };
  } catch { return {}; }
}

// libass(set_font_metrics)와 같은 방식: OS/2 winAscent+winDescent가 있으면 그것, 없으면 hhea
export function assRatio(buf) {
  try {
    const n = buf.readUInt16BE(4); const t = {};
    for (let i = 0, off = 12; i < n; i++, off += 16) t[buf.toString('ascii', off, off + 4)] = buf.readUInt32BE(off + 8);
    const upem = buf.readUInt16BE(t.head + 18);
    if (t['OS/2'] != null) {
      const wa = buf.readInt16BE(t['OS/2'] + 74), wd = buf.readInt16BE(t['OS/2'] + 76);
      if (wa + wd !== 0) return +((wa + wd) / upem).toFixed(4);
    }
    const asc = buf.readInt16BE(t.hhea + 4), desc = buf.readInt16BE(t.hhea + 6);
    return +((asc - desc) / upem).toFixed(4);
  } catch { return null; }
}

// cmap에 '가'(U+AC00)가 있는지 대략 확인
function hasHangul(buf) {
  try {
    const n = buf.readUInt16BE(4); let off = 12; let cmap = -1;
    for (let i = 0; i < n; i++, off += 16) if (buf.toString('ascii', off, off + 4) === 'cmap') { cmap = buf.readUInt32BE(off + 8); break; }
    if (cmap < 0) return false;
    const nt = buf.readUInt16BE(cmap + 2);
    for (let i = 0; i < nt; i++) {
      const so = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4); const fmt = buf.readUInt16BE(so);
      if (fmt === 4) {
        const segX2 = buf.readUInt16BE(so + 6); const ends = so + 14; const starts = ends + segX2 + 2;
        for (let k = 0; k < segX2; k += 2) if (buf.readUInt16BE(starts + k) <= 0xAC00 && buf.readUInt16BE(ends + k) >= 0xAC00) return true;
      } else if (fmt === 12) {
        const ng = buf.readUInt32BE(so + 12);
        for (let k = 0; k < ng; k++) { const g = so + 16 + k * 12; if (buf.readUInt32BE(g) <= 0xAC00 && buf.readUInt32BE(g + 4) >= 0xAC00) return true; }
      }
    }
  } catch {}
  return false;
}
