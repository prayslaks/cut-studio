// ZK TTS Studio - 로컬 서버 (Node 18+, 외부 의존성 없음)
// 작업 폴더(workDir, studio.config.json):
//   script.json   대본
//   tts/          생성된 mp3 (+ 생성 당시 정보 .json)
//   ../*.mp4      원본 영상 (videoDir로 변경 가능, workDir 기준 상대경로)
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, spawn } from 'node:child_process';
import { checkFfmpeg, startExport, getJob, cancelJob, renderFrame, ENCODERS } from './export.mjs';
import { createFonts } from './fonts.mjs';
import { createThumbs, TEMPLATES, THUMB_TOOL } from './thumbs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 작업 폴더 설정: 환경변수 ZK_WORK_DIR > studio.config.json > ../ (기존 위치)
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'studio.config.json'), 'utf8')); } catch {}
const WORK = path.resolve(HERE, process.env.ZK_WORK_DIR || cfg.workDir || '..');
const ROOT = path.resolve(WORK, cfg.videoDir || '..');
if (!fs.existsSync(path.join(WORK, 'script.json'))) {
  console.error(`script.json을 찾을 수 없습니다: ${WORK}\nstudio.config.json의 workDir을 확인하세요.`);
  process.exit(1);
}
const CFG_FILE = path.join(HERE, 'studio.config.json');
const ffPath = () => cfg.ffmpegPath || 'ffmpeg';
const defaultFont = () => cfg.fontName || (process.platform === 'win32' ? 'Malgun Gothic' : 'Noto Sans CJK KR');
const outDir = () => (cfg.outDir ? path.resolve(WORK, cfg.outDir) : ROOT);
const SCRIPT = path.join(WORK, 'script.json');
const fonts = createFonts(WORK);
fs.mkdirSync(fonts.DIR, { recursive: true });
const thumbs = createThumbs({ work: WORK, root: ROOT, ffPath: () => ffPath(), fontsMap: () => fonts.fontsMap(), defaultFont: () => defaultFont() });
const TTS_DIR = path.join(WORK, 'tts');
const DIST = path.join(HERE, 'dist');
const PORT = Number(process.env.PORT) || 5178;
const EL = 'https://api.elevenlabs.io';
const ANTHROPIC = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const OPENAI = process.env.OPENAI_BASE_URL || 'https://api.openai.com';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const fail = (res, code, msg) => send(res, code, { error: msg });
const readBody = (req) => new Promise((ok, no) => {
  const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c).toString('utf8'))); req.on('error', no);
});
const safeId = (id) => /^[A-Za-z0-9_-]{1,32}$/.test(id);

async function loadScript() { return JSON.parse(await fsp.readFile(SCRIPT, 'utf8')); }

function streamFile(req, res, file, type) {
  let st;
  try { st = fs.statSync(file); } catch { return fail(res, 404, `파일 없음: ${path.basename(file)}`); }
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (!m[1] && m[2]) { start = st.size - parseInt(m[2], 10); end = st.size - 1; }
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Cache-Control': 'no-store' });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  }
}

async function elFetch(p, key, opt = {}) {
  if (!key) throw Object.assign(new Error('API 키가 없습니다'), { status: 400 });
  const r = await fetch(EL + p, { ...opt, headers: { 'xi-api-key': key, ...(opt.headers || {}) } });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const j = await r.json(); msg = j?.detail?.message || j?.detail?.status || JSON.stringify(j.detail ?? j); } catch {}
    throw Object.assign(new Error(`ElevenLabs: ${msg}`), { status: r.status });
  }
  return r;
}

// ---------- 편집 에이전트 (Claude / OpenAI) ----------
const EDIT_TOOL = {
  name: 'propose_edits',
  description: '대본·발음 사전·자막 스타일·영상 카드(인트로/챕터/엔딩)·선택된 썸네일 레이어의 변경을 제안한다. 사용자가 항목별로 검토 후 적용한다. 무엇이든 바꾸려면 반드시 이 도구를 사용.',
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '변경 요약 한 줄' },
      ops: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['update', 'add', 'delete', 'rule_add', 'rule_remove', 'style', 'thumb_layer', 'thumb_add', 'thumb_remove', 'thumb_bg', 'card', 'card_layer', 'card_add', 'card_remove'] },
            card: { type: 'string', enum: ['intro', 'chapter', 'end'], description: 'card*: 대상 영상 카드' },
            layer: { type: 'string', description: 'thumb_layer/thumb_remove/card_layer/card_remove 대상 레이어 id' },
            props: { type: 'object', description: 'thumb_layer/thumb_add/thumb_bg/card/card_layer/card_add: 바꿀(또는 새) 속성' },
            style: { type: 'object', description: 'op=style: 자막 스타일에서 바꿀 부분' },
            id: { type: 'string', description: 'update/delete 대상 대사 id (예: A03). add일 때는 생략' },
            tab: { type: 'string', enum: ['A', 'B'], description: 'add일 때 대상 영상' },
            start: { type: 'number', description: '편집본 기준 시작 초' },
            text: { type: 'string', description: '화면 자막' },
            tts: { type: 'string', description: 'TTS 발음 텍스트. 빈 문자열이면 발음 사전 자동 적용으로 되돌림' },
            from: { type: 'string', description: 'rule_add/rule_remove: 자막 표기' },
            to: { type: 'string', description: 'rule_add: 읽는 법' },
            reason: { type: 'string', description: '이 변경의 이유 (짧게)' },
          },
          required: ['op'],
        },
      },
    },
    required: ['ops'],
  },
};

async function aiFetch(url, opt, label) {
  const r = await fetch(url, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`${label}: ${j?.error?.message || j?.error?.type || r.status + ' ' + r.statusText}`), { status: r.status });
  return j;
}

async function agentModels(provider, key) {
  if (!key) throw Object.assign(new Error('API 키가 없습니다'), { status: 400 });
  if (provider === 'anthropic') {
    const j = await aiFetch(`${ANTHROPIC}/v1/models?limit=100`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }, 'Claude');
    return (j.data || []).map((m) => m.id);
  }
  const j = await aiFetch(`${OPENAI}/v1/models`, { headers: { Authorization: `Bearer ${key}` } }, 'OpenAI');
  return (j.data || []).map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id)).sort().reverse();
}

// messages: [{ role, text, image?, parts? }]  parts = [{ text } | { image: dataUrl }] (이미지 여러 장 + 라벨)
async function agentCall(b, key, tool = EDIT_TOOL, force = false) {
  if (!key) throw Object.assign(new Error('API 키가 없습니다'), { status: 400 });
  const dataUrl = (u) => /^data:(.+?);base64,(.*)$/.exec(u || '');
  const partsOf = (m) => m.parts || [...(m.image ? [{ image: m.image }] : []), { text: m.text }];
  if (b.provider === 'anthropic') {
    const messages = b.messages.map((m) => {
      if (m.role === 'assistant') return { role: 'assistant', content: m.text || '(no text)' };
      const content = partsOf(m).map((p) => {
        if (p.image) { const d = dataUrl(p.image); return d ? { type: 'image', source: { type: 'base64', media_type: d[1], data: d[2] } } : null; }
        return { type: 'text', text: p.text || '' };
      }).filter(Boolean);
      return { role: 'user', content };
    });
    const j = await aiFetch(`${ANTHROPIC}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: b.model, max_tokens: 8192, system: b.system, messages,
        tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }],
        ...(force ? { tool_choice: { type: 'tool', name: tool.name } } : {}) }),
    }, 'Claude');
    const text = j.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    const use = j.content.find((c) => c.type === 'tool_use' && c.name === tool.name);
    return { text, edits: use?.input || null, usage: j.usage };
  }
  if (b.provider === 'openai') {
    // 최신 GPT 모델의 도구 호출은 Responses API 사용
    const input = b.messages.map((m) => {
      if (m.role === 'assistant') return { role: 'assistant', content: m.text || '(no text)' };
      const content = partsOf(m).map((p) => (p.image ? { type: 'input_image', image_url: p.image } : { type: 'input_text', text: p.text || '' }));
      return { role: 'user', content };
    });
    const j = await aiFetch(`${OPENAI}/v1/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: b.model, instructions: b.system, input, max_output_tokens: 8192,
        tools: [{ type: 'function', name: tool.name, description: tool.description, parameters: tool.schema }],
        ...(force ? { tool_choice: { type: 'function', name: tool.name } } : {}) }),
    }, 'OpenAI');
    let text = ''; let edits = null;
    for (const item of j.output || []) {
      if (item.type === 'message') text += (item.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('\n');
      if (item.type === 'function_call' && item.name === tool.name) { try { edits = JSON.parse(item.arguments); } catch {} }
    }
    return { text: text.trim(), edits, usage: j.usage };
  }
  throw Object.assign(new Error('알 수 없는 provider'), { status: 400 });
}

async function thumbsAgent(b, key) {
  const s = await loadScript(); const meta = s.meta?.[b.key];
  if (!meta) throw Object.assign(new Error('bad key'), { status: 400 });
  const count = Math.max(1, Math.min(10, b.count || 4));
  const cands = await thumbs.sample(b.key, Math.max(16, Math.min(24, b.candidates || count * 2 + 4)));
  if (!cands.length) throw new Error('후보 프레임을 추출하지 못했습니다 (ffmpeg 확인)');
  const offs = []; let t = 0; for (const [a, e] of meta.segs) { offs.push(t); t += e - a; }
  const chapters = (meta.chapters || []).map((c, i) => `${c.num} ${c.kr} (${offs[i]?.toFixed(0)}s~)`).join(', ');
  const narration = [...(s[b.key] || [])].sort((x, y) => x.start - y.start).map((l) => `${l.start}s ${l.text}`).join('\n');
  const system = [
    '너는 게임 유튜브 썸네일 아트 디렉터다. ProjectZK는 개인 개발자가 만든 탑뷰 시점 공중 액션 슈팅 게임이고, 썸네일은 포트폴리오/홍보용 플레이 영상에 쓰인다.',
    '레퍼런스 톤(캔바 썸네일): 큰 흰색 굵은 "PROJECT ZK", 라임(#DCF884) 강조 문구 "탑뷰 공중 액션", 흰색 부제 "… 플레이 영상", 날짜. 어두운 남색 계열(#080C0F) 그림자/그라데이션으로 가독성 확보.',
    `템플릿: ${Object.entries(TEMPLATES).map(([k, v]) => `${k}=${v.desc}`).join(' / ')}`,
    '규칙',
    '- 반드시 propose_thumbnails 도구로 답한다. 초안마다 서로 다른 장면을 고르고, 템플릿도 섞어서 다양하게.',
    '- 요청 개수는 최대치다. 썸네일로 쓸 만한 서로 다른 장면이 부족하면 억지로 채우지 말고 가능한 만큼만 제안한다(비슷한 장면·문구 반복 금지).',
    '- 좋은 장면: 폭발·미사일 궤적·보스 공중전함·근접 공중전처럼 한눈에 액션이 보이는 프레임, 기체가 잘 보이는 프레임. 피할 장면: 메뉴/로딩/검은 화면, HUD만 잔뜩이고 피사체 없는 장면, 흐릿한 전환.',
    '- kicker는 한국어 4~10자, 작은 크기에서도 읽히는 강한 표현. 화면에 실제로 보이는 것만 말한다(없는 기능 지어내지 말 것).',
    '- 텍스트가 놓일 영역(템플릿 설명 참고)에 중요한 피사체가 가려지지 않게 고르고, 피사체가 작으면 zoom/fx/fy로 확대.',
    '- sub/badge는 기본값을 쓰려면 생략 가능. title은 보통 PROJECT ZK.',
  ].join('\n');
  const parts = [{ text: `영상: ${meta.title} 플레이 영상 (${meta.date || ''}), 편집본 ${t.toFixed(0)}초\n챕터: ${chapters || '없음'}\n나레이션:\n${narration}\n\n후보 프레임 ${cands.length}장:` }];
  for (const c of cands) {
    parts.push({ text: `후보 ${c.i} — 편집본 ${c.t}s` });
    parts.push({ image: `data:image/jpeg;base64,${(await fsp.readFile(c.file)).toString('base64')}` });
  }
  parts.push({ text: `썸네일 초안을 최대 ${count}개 제안해줘(좋은 후보가 부족하면 그보다 적게).${b.brief ? ` 추가 요청: ${b.brief}` : ''}` });
  const r = await agentCall({ provider: b.provider, model: b.model, system, messages: [{ role: 'user', parts }] }, key, THUMB_TOOL, true);
  const drafts = (r.edits?.drafts || []).slice(0, count);
  const batch = Date.now().toString(36);
  const out = [];
  for (const d of drafts) {
    const c = cands.find((x) => x.i === d.frame) || cands[0];
    try {
      out.push(await thumbs.upsert({ key: b.key, t: Math.max(0, c.t + Math.max(-4, Math.min(4, d.offset || 0))), template: TEMPLATES[d.template] ? d.template : 'magazine',
        kicker: d.kicker, ...(d.sub ? { sub: d.sub } : {}), ...(d.title ? { title: d.title } : {}), ...(d.badge ? { badge: d.badge } : {}),
        zoom: d.zoom || 1, fx: d.fx ?? 0.5, fy: d.fy ?? 0.5, reason: d.reason || '', agent: b.provider, batch }));
    } catch (e) { out.push({ error: e.message, kicker: d.kicker }); }
  }
  return { text: r.text || r.edits?.summary || '', drafts: out, usage: r.usage };
}

// ---------- 유튜브 제목·설명 추천 ----------
const YT_TOOL = {
  name: 'propose_youtube',
  description: '유튜브 업로드용 제목 후보·설명·태그·해시태그를 제안한다.',
  schema: {
    type: 'object',
    properties: {
      titles: { type: 'array', description: '제목 후보 4~6개 (각각 다른 방향)', items: { type: 'object', properties: {
        title: { type: 'string', description: '100자 이내, 핵심 키워드 앞쪽' }, angle: { type: 'string', description: '이 제목의 방향 (짧게)' } }, required: ['title'] } },
      description: { type: 'string', description: '설명 본문(챕터 타임스탬프·해시태그 제외). 첫 2줄이 검색/미리보기에 노출되므로 훅 우선. 줄바꿈 포함' },
      tags: { type: 'array', items: { type: 'string' }, description: '유튜브 태그 10~20개 (한국어·영어 혼합, 합계 450자 이내)' },
      hashtags: { type: 'array', items: { type: 'string' }, description: '#포함 해시태그 3~5개' },
      notes: { type: 'string', description: '사용자에게 주는 짧은 팁/확인 필요 사항' },
    },
    required: ['titles', 'description', 'tags', 'hashtags'],
  },
};

async function youtubeAgent(b, key) {
  const s = await loadScript(); const meta = s.meta?.[b.key];
  if (!meta) throw Object.assign(new Error('bad key'), { status: 400 });
  const offs = []; let t = 0; for (const [a, e] of meta.segs) { offs.push(t); t += e - a; }
  const total = t + (meta.end_card ?? 4);
  const yt = meta.youtube || {};
  const other = Object.entries(s.meta || {}).filter(([k]) => k !== b.key).map(([k, m]) => `${m.title} 플레이 영상(${m.date || ''})`).join(', ');
  const narration = [...(s[b.key] || [])].sort((x, y) => x.start - y.start).map((l) => `${l.start}s ${l.text}`).join('\n');
  const system = [
    '너는 인디 게임 개발자의 유튜브 채널 운영을 돕는 카피라이터다. ProjectZK는 개인 개발자가 만든 탑뷰 시점 공중 액션 슈팅 게임이고, 영상은 포트폴리오/홍보용 플레이 영상이다.',
    '반드시 propose_youtube 도구로 답한다. 한국어로 쓴다.',
    '규칙',
    '- 사실만 쓴다: 나레이션·챕터·사용자 메모에 근거가 있는 내용만. 없는 기능·출시일·플랫폼·수상 등은 지어내지 않는다. 날짜는 촬영/빌드 날짜로만 언급.',
    '- 제목: 4~6개, 서로 다른 방향(정보형/액션 훅/개발기록/질문형 등). 60자 안팎 권장, 핵심 키워드(Project ZK, 탑뷰 슈팅/공중전 등)를 앞쪽에. 과장된 낚시·이모지 남발 금지.',
    '- 설명: 첫 1~2줄은 시청자를 붙잡는 훅, 이어서 영상 소개(무엇을 볼 수 있는지), 개발 단계 안내(화면·시스템 변경 가능), 댓글/구독 유도 1~2문장. 3~5문단, 문단 사이 빈 줄. 타임스탬프와 해시태그는 넣지 않는다(도구가 따로 붙임).',
    '- 사용자의 기존 초안·메모의 톤과 사실을 존중하고 개선한다.',
    '- 태그: 검색 키워드 위주, 중복 없이. 해시태그 3~5개(첫 3개가 제목 위에 노출됨).',
  ].join('\n');
  const parts = [{ text: [
    `영상: ${meta.title} 플레이 영상 · 날짜 ${meta.date || '미정'} · 편집본 길이 ${Math.floor(total / 60)}분 ${Math.round(total % 60)}초`,
    other ? `같은 채널의 다른 영상: ${other}` : '',
    `챕터: ${(meta.chapters || []).map((c, i) => `${c.num} ${c.kr}${c.en ? ` (${c.en})` : ''} @${Math.round(offs[i] || 0)}s`).join(', ') || '없음(단일 스테이지)'}`,
    `나레이션 대본:\n${narration || '(없음)'}`,
    yt.notes ? `사용자 메모(사실·포함할 내용): ${yt.notes}` : '',
    yt.title || yt.description ? `현재 초안\n제목: ${yt.title || ''}\n설명:\n${yt.description || ''}` : '',
    b.brief ? `추가 요청: ${b.brief}` : '',
  ].filter(Boolean).join('\n\n') }];
  if (b.thumbId) {
    try { parts.push({ text: '사용할 썸네일:' }, { image: `data:image/png;base64,${(await fsp.readFile(thumbs.file(b.thumbId))).toString('base64')}` }); } catch {}
  }
  const r = await agentCall({ provider: b.provider, model: b.model, system, messages: [{ role: 'user', parts }] }, key, YT_TOOL, true);
  if (!r.edits) throw new Error(r.text || 'AI가 제안을 반환하지 않았습니다');
  return { ...r.edits, text: r.text || '', usage: r.usage };
}

async function listTts() {
  await fsp.mkdir(TTS_DIR, { recursive: true });
  const out = {};
  for (const f of await fsp.readdir(TTS_DIR)) {
    if (!f.endsWith('.mp3')) continue;
    const id = f.slice(0, -4);
    const st = await fsp.stat(path.join(TTS_DIR, f));
    let meta = null;
    try { meta = JSON.parse(await fsp.readFile(path.join(TTS_DIR, id + '.json'), 'utf8')); } catch {}
    out[id] = { mtime: Math.round(st.mtimeMs), size: st.size, meta };
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  const key = req.headers['x-el-key'];
  try {
    if (p === '/api/script' && req.method === 'GET') return send(res, 200, await loadScript());
    if (p === '/api/script' && req.method === 'PUT') {
      const body = await readBody(req);
      const j = JSON.parse(body);
      if (!j.A || !j.B) return fail(res, 400, 'A/B 대본이 없습니다');
      try { await fsp.copyFile(SCRIPT, path.join(WORK, 'script.bak.json')); } catch {}
      await fsp.writeFile(SCRIPT, JSON.stringify(j, null, 2), 'utf8');
      return send(res, 200, { ok: true });
    }
    if (p === '/api/tts' && req.method === 'GET') return send(res, 200, await listTts());

    let m = /^\/api\/tts\/([^/]+)\.mp3$/.exec(p);
    if (m && req.method === 'GET') {
      if (!safeId(m[1])) return fail(res, 400, 'bad id');
      return streamFile(req, res, path.join(TTS_DIR, m[1] + '.mp3'), 'audio/mpeg');
    }
    m = /^\/api\/tts\/([^/]+)$/.exec(p);
    if (m && req.method === 'POST') {
      const id = m[1]; if (!safeId(id)) return fail(res, 400, 'bad id');
      const b = JSON.parse(await readBody(req));
      if (!b.text?.trim()) return fail(res, 400, '텍스트가 비어 있습니다');
      if (!b.voice_id) return fail(res, 400, 'Voice ID를 선택하세요');
      const payload = { text: b.text, model_id: b.model_id || 'eleven_v4', voice_settings: b.voice_settings };
      if (b.language_code) payload.language_code = b.language_code;
      if (b.previous_text) payload.previous_text = b.previous_text;
      if (b.next_text) payload.next_text = b.next_text;
      const r = await elFetch(`/v1/text-to-speech/${encodeURIComponent(b.voice_id)}?output_format=mp3_44100_128`, key, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(payload) });
      const buf = Buffer.from(await r.arrayBuffer());
      await fsp.mkdir(TTS_DIR, { recursive: true });
      const tmp = path.join(TTS_DIR, id + '.mp3.part');
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, path.join(TTS_DIR, id + '.mp3'));
      // tts_text: 실제 발음용으로 보낸 텍스트 / subtitle: 생성 당시 자막
      const meta = { tts_text: b.text, subtitle: b.subtitle ?? null, voice_id: b.voice_id, model_id: payload.model_id,
        voice_settings: b.voice_settings, language_code: payload.language_code ?? null,
        created: new Date().toISOString(), chars: b.text.length };
      await fsp.writeFile(path.join(TTS_DIR, id + '.json'), JSON.stringify(meta, null, 2), 'utf8');
      return send(res, 200, { ok: true, bytes: buf.length });
    }
    if (p === '/api/voices') {
      const r = await elFetch('/v1/voices', key);
      const j = await r.json();
      return send(res, 200, (j.voices || []).map((v) => ({ voice_id: v.voice_id, name: v.name, category: v.category,
        labels: v.labels || {}, preview_url: v.preview_url })));
    }
    if (p === '/api/models') {
      const r = await elFetch('/v1/models', key);
      const j = await r.json();
      return send(res, 200, j.filter((m) => m.can_do_text_to_speech).map((m) => ({ model_id: m.model_id, name: m.name,
        description: m.description, max_chars: m.maximum_text_length_per_request,
        languages: (m.languages || []).map((l) => l.language_id) })));
    }
    if (p === '/api/user') {
      const r = await elFetch('/v1/user/subscription', key);
      const j = await r.json();
      return send(res, 200, { used: j.character_count, limit: j.character_limit, tier: j.tier, reset: j.next_character_count_reset_unix });
    }
    if (p === '/api/agent/models') return send(res, 200, await agentModels(url.searchParams.get('provider'), req.headers['x-ai-key']));
    if (p === '/api/agent' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req));
      return send(res, 200, await agentCall(b, req.headers['x-ai-key']));
    }
    // ---- 설정 ----
    if (p === '/api/config' && req.method === 'GET') {
      return send(res, 200, { ffmpegPath: cfg.ffmpegPath || '', fontName: cfg.fontName || '', defaultFont: defaultFont(),
        outDir: outDir(), workDir: WORK, videoDir: ROOT, platform: process.platform });
    }
    if (p === '/api/config' && req.method === 'PUT') {
      const b = JSON.parse(await readBody(req));
      for (const k of ['ffmpegPath', 'fontName', 'outDir']) if (k in b) { if (b[k]) cfg[k] = String(b[k]).trim(); else delete cfg[k]; }
      await fsp.writeFile(CFG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
      return send(res, 200, { ok: true });
    }
    if (p === '/api/ffmpeg/check') return send(res, 200, { ...(await checkFfmpeg(ffPath())), path: ffPath(),
      labels: Object.fromEntries(Object.entries(ENCODERS).map(([k, v]) => [k, v.label])) });
    // ---- 실제 렌더 프레임 (최종 결과물과 동일한 자막) ----
    if (p === '/api/frame') {
      const key = url.searchParams.get('key'); const t = parseFloat(url.searchParams.get('t') || '0');
      if (key !== 'A' && key !== 'B') return fail(res, 400, 'bad key');
      const file = await renderFrame(key, t, { font: defaultFont(), width: Number(url.searchParams.get('w')) || 1600 },
        { ff: ffPath(), work: WORK, root: ROOT, fontsMap: () => fonts.fontsMap() });
      return send(res, 200, await fsp.readFile(file), 'image/jpeg');
    }
    if (p === '/api/font') return send(res, 200, { font: defaultFont() });
    // ---- 폰트 ----
    if (p === '/api/fonts/catalog') return send(res, 200, await fonts.catalog());
    if (p === '/api/fonts' && req.method === 'GET') return send(res, 200, await fonts.installed());
    if (p === '/api/fonts/install' && req.method === 'POST') { const b = JSON.parse(await readBody(req)); return send(res, 200, await fonts.install(b.family, b.weight)); }
    if (p === '/api/fonts' && req.method === 'DELETE') { await fonts.remove(url.searchParams.get('family'), url.searchParams.get('weight')); return send(res, 200, { ok: true }); }
    m = /^\/api\/fonts\/file\/([^/]+\.ttf)$/.exec(p);
    if (m) return streamFile(req, res, fonts.filePath(m[1]), 'font/ttf');
    // ---- 썸네일 ----
    if (p === '/api/thumbs/templates') return send(res, 200, TEMPLATES);
    if (p === '/api/thumbs' && req.method === 'GET') return send(res, 200, await thumbs.load());
    if (p === '/api/thumbs' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req)); if (b.key !== 'A' && b.key !== 'B') return fail(res, 400, 'bad key');
      return send(res, 200, await thumbs.upsert(b, { render: url.searchParams.get('render') !== '0' }));
    }
    if (p === '/api/thumbs/bg') {
      const q = Object.fromEntries(url.searchParams); if (q.key !== 'A' && q.key !== 'B') return fail(res, 400, 'bad key');
      return send(res, 200, await thumbs.background({ key: q.key, t: +q.t || 0, zoom: +q.zoom || 1, fx: q.fx != null ? +q.fx : 0.5, fy: q.fy != null ? +q.fy : 0.5,
        grade: { contrast: q.c != null ? +q.c : undefined, saturation: q.s != null ? +q.s : undefined, brightness: q.b != null ? +q.b : undefined } }), 'image/jpeg');
    }
    if (p === '/api/thumbs/still') {
      const q = Object.fromEntries(url.searchParams); if (q.key !== 'A' && q.key !== 'B') return fail(res, 400, 'bad key');
      return send(res, 200, await thumbs.still(q.key, +q.t || 0, Math.max(80, Math.min(640, +q.w || 240))), 'image/jpeg');
    }
    if (p === '/api/youtube/agent' && req.method === 'POST') return send(res, 200, await youtubeAgent(JSON.parse(await readBody(req)), req.headers['x-ai-key']));
    if (p === '/api/thumbs/agent' && req.method === 'POST') return send(res, 200, await thumbsAgent(JSON.parse(await readBody(req)), req.headers['x-ai-key']));
    m = /^\/api\/thumbs\/([A-Za-z0-9]+)(\.png|\/save)?$/.exec(p);
    if (m) {
      if (m[2] === '.png') return streamFile(req, res, thumbs.file(m[1]), 'image/png');
      if (m[2] === '/save') return send(res, 200, { path: await thumbs.save(m[1], outDir()) });
      if (req.method === 'DELETE') { await thumbs.remove(m[1]); return send(res, 200, { ok: true }); }
    }
    // ---- 내보내기 ----
    if (p === '/api/export' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req));
      const targets = (b.targets || []).filter((k) => k === 'A' || k === 'B');
      if (!targets.length) return fail(res, 400, '내보낼 영상을 선택하세요');
      const job = await startExport({ ...b, targets, font: b.font || defaultFont() }, { ff: ffPath(), work: WORK, root: ROOT, outDir: outDir(), fontsMap: () => fonts.fontsMap() });
      return send(res, 200, { id: job.id });
    }
    m = /^\/api\/export\/([a-z0-9]+)(?:\/(cancel|file\/([AB])))?$/.exec(p);
    if (m) {
      const job = getJob(m[1]); if (!job) return fail(res, 404, '작업 없음');
      if (m[2] === 'cancel') { cancelJob(m[1]); return send(res, 200, { ok: true }); }
      if (m[3]) { const it = job.items.find((x) => x.key === m[3]); return it?.status === 'done' ? streamFile(req, res, it.out, 'video/mp4') : fail(res, 404, '완료된 파일 없음'); }
      const { proc, ...rest } = job;
      return send(res, 200, rest);
    }
    if (p === '/api/open' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req));
      const target = path.resolve(String(b.path || ''));
      const allowed = [ROOT, outDir(), WORK].some((d) => target === d || target.startsWith(d + path.sep));
      if (!allowed || !fs.existsSync(target)) return fail(res, 400, '열 수 없는 경로');
      const isDir = fs.statSync(target).isDirectory();
      if (process.platform === 'win32') spawn('explorer', isDir ? [target] : [`/select,${target}`], { detached: true, stdio: 'ignore' }).unref();
      else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [isDir ? target : path.dirname(target)], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
      return send(res, 200, { ok: true });
    }
    m = /^\/api\/video\/([AB])$/.exec(p);
    if (m) {
      const s = await loadScript();
      const src = s.meta?.[m[1]]?.src; if (!src) return fail(res, 404, 'meta.src 없음');
      return streamFile(req, res, path.join(ROOT, path.basename(src)), 'video/mp4');
    }
    if (p.startsWith('/api/')) return fail(res, 404, 'not found');

    // 정적 파일 (빌드된 UI)
    let file = path.join(DIST, p === '/' ? 'index.html' : p);
    if (!file.startsWith(DIST) || !fs.existsSync(file)) file = path.join(DIST, 'index.html');
    return send(res, 200, await fsp.readFile(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    console.error('[error]', p, e.message);
    return fail(res, e.status && e.status < 600 ? e.status : 500, e.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const u = `http://localhost:${PORT}`;
  console.log(`\n  ZK TTS Studio  →  ${u}\n  작업 폴더: ${WORK}\n  영상 폴더: ${ROOT}\n  종료: Ctrl+C\n`);
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === 'win32' ? `start "" "${u}"` : process.platform === 'darwin' ? `open ${u}` : `xdg-open ${u}`;
    exec(cmd, () => {});
  }
});
