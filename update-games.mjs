// 更新中職比賽資料 → data/games.json
//
// 由 GitHub Actions 每天自動執行，也可以在自己電腦執行：node scripts/update-games.mjs [年份]
//
// 資料來源（依序嘗試）：
//   1. 中職官網 cpbl.com.tw：比分、先發投手、勝投、敗投、救援、MVP 都有。
//      官網會擋雲端機房（包含 GitHub Actions）的連線，通常只有台灣家用或手機網路連得上。
//   2. 野球革命 Rebas（rebas.tw）網站使用的公開 JSON：有比分、球場、場次，沒有勝敗投與 MVP。
//      雲端也連得上，所以官網被擋時自動改用它。
// 新資料只會「補上或更新」舊資料，不會把舊資料裡已有的球員名字清掉。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_FILE = path.join(ROOT, 'data', 'games.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT = 25000;

/* ---------- 球場與球隊對照（要和 index.html 的 id 一致） ---------- */
// 順序有意義：「亞太」要比「台南」先比對
export const PARKS = [
  ['taipei-dome', ['巨蛋']],
  ['tianmu', ['天母']],
  ['xinzhuang', ['新莊']],
  ['taoyuan', ['桃園']],
  ['intercontinental', ['洲際']],
  ['douliu', ['斗六']],
  ['asia-pacific', ['亞太']],
  ['tainan', ['台南', '臺南']],
  ['chiayi', ['嘉義市', '嘉市']],
  ['chengcing', ['澄清湖']],
  ['taitung', ['台東', '臺東']],
  ['hualien', ['花蓮']]
];
export const TEAMS = [
  ['brothers', '中信兄弟', ['兄弟'], ['ACN']],
  ['lions', '統一7-ELEVEn獅', ['統一', '獅'], ['ADD']],
  ['monkeys', '樂天桃猿', ['樂天', '桃猿'], ['AJL']],
  ['guardians', '富邦悍將', ['富邦', '悍將'], ['AEO']],
  ['dragons', '味全龍', ['味全'], ['AAA']],
  ['hawks', '台鋼雄鷹', ['台鋼', '臺鋼', '雄鷹'], ['AKP']]
];

export function parkIdOf(field) {
  const s = String(field || '').trim();
  if (!s) return '';
  for (const [id, words] of PARKS) if (words.some(w => s.includes(w))) return id;
  if (s.includes('嘉義') && !s.includes('縣')) return 'chiayi';
  return '';
}
export function teamIdOf(nameOrCode) {
  const s = String(nameOrCode || '').trim();
  if (!s) return '';
  for (const [id, , , codes] of TEAMS) if (codes.some(c => s.toUpperCase().startsWith(c))) return id;
  for (const [id, , words] of TEAMS) if (words.some(w => s.includes(w))) return id;
  return '';
}
export function teamNameOf(id, fallback) {
  const t = TEAMS.find(x => x[0] === id);
  return t ? t[1] : String(fallback || '');
}
const clean = v => (v === null || v === undefined) ? '' : String(v).trim();
const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

/* ---------- 共用：連線（自己管理 cookie，手動跟隨轉址） ---------- */
function makeClient() {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  return async function request(url, options = {}, tries = 3) {
    for (let attempt = 1; ; attempt++) {
      try {
        let cur = url;
        for (let hop = 0; hop < 10; hop++) {
          const res = await fetch(cur, {
            ...options,
            redirect: 'manual',
            signal: AbortSignal.timeout(TIMEOUT),
            headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9', Cookie: cookie(), ...(options.headers || {}) }
          });
          for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
            const pair = c.split(';')[0];
            const eq = pair.indexOf('=');
            if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
          }
          if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
            cur = new URL(res.headers.get('location'), cur).href;
            continue;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}（${cur}）`);
          return res;
        }
        throw new Error('轉址次數過多');
      } catch (e) {
        if (attempt >= tries) throw e;
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
  };
}

/* ---------- 來源 1：中職官網 ---------- */
// A＝一軍例行賽、C＝季後挑戰賽、E＝台灣大賽
const OFFICIAL_KINDS = ['A', 'C', 'E'];

export function normalizeOfficial(g) {
  if (!g || !g.GameDate) return null;
  const kind = clean(g.KindCode) || 'A';
  const sno = num(g.GameSno);
  const date = clean(g.GameDate).slice(0, 10);
  const year = num(g.Year) || Number(date.slice(0, 4));
  const postponed = !!g.IsGameStop && String(g.IsGameStop) !== '0';
  const finished = !postponed && g.GameDateTimeE != null && num(g.VisitingScore) !== null && num(g.HomeScore) !== null;
  const away = teamIdOf(g.VisitingTeamCode) || teamIdOf(g.VisitingTeamName);
  const home = teamIdOf(g.HomeTeamCode) || teamIdOf(g.HomeTeamName);
  return {
    id: `${year}-${kind}-${sno}`,
    date,
    time: clean(g.PreExeDate).slice(11, 16),
    kind, sno,
    field: clean(g.FieldAbbe),
    park: parkIdOf(g.FieldAbbe),
    away, home,
    awayName: teamNameOf(away, g.VisitingTeamName),
    homeName: teamNameOf(home, g.HomeTeamName),
    awayScore: finished ? num(g.VisitingScore) : null,
    homeScore: finished ? num(g.HomeScore) : null,
    status: postponed ? 'postponed' : finished ? 'final' : 'scheduled',
    awaySP: clean(g.VisitingPitcherName),
    homeSP: clean(g.HomePitcherName),
    wp: finished ? clean(g.WinningPitcherName) : '',
    lp: finished ? clean(g.LoserPitcherName) : '',
    sv: finished ? clean(g.CloserName) : '',
    mvp: finished ? clean(g.MvpName) : ''
  };
}

export async function fetchOfficial(year) {
  const request = makeClient();
  const page = await (await request('https://www.cpbl.com.tw/schedule')).text();
  const token = (page.match(/RequestVerificationToken:\s*'([^']+)'/) || [])[1];
  if (!token) throw new Error('找不到官網驗證碼，官網可能改版了');
  const out = [];
  for (const kindCode of OFFICIAL_KINDS) {
    const res = await request('https://www.cpbl.com.tw/schedule/getgamedatas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: 'https://www.cpbl.com.tw/schedule',
        RequestVerificationToken: token,
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams({ kindCode, year: String(year), month: '1' }).toString()
    });
    const payload = await res.json();
    if (!payload || !payload.Success) throw new Error(`官網回傳失敗（${kindCode}）`);
    const raw = JSON.parse(payload.GameDatas || '[]');
    const games = raw.map(normalizeOfficial).filter(g => g && g.date.startsWith(String(year)));
    console.log(`  官網 ${kindCode}：${games.length} 筆`);
    out.push(...games);
  }
  return out;
}

/* ---------- 來源 2：野球革命 Rebas ---------- */
const REBAS_KIND = { LEAGUE_MATCHES: 'A', CHALLENGE: 'C', POSTSEASON: 'E' };
const REBAS_HEADERS = { Accept: 'application/json', Origin: 'https://www.rebas.tw', Referer: 'https://www.rebas.tw/' };
// 賽季說明欄位可能夾帶換行等控制字元，標準 JSON 不接受，先換成空白
const parseLoose = text => JSON.parse(text.replace(/[\u0000-\u001F]+/g, ' '));

function rebasSP(side) {
  const sp = side && side.scheduled_SP;
  if (sp && typeof sp === 'object') return clean(sp.name || sp.player_name);
  return clean(sp);
}
export function normalizeRebas(g, kind, year) {
  const info = (g && g.info) || {};
  const when = clean(info.scheduled_start_at);
  if (!/^\d{4}-\d{2}-\d{2}/.test(when)) return null;
  const status = clean(info.status).toUpperCase();
  const fin = clean(info.finished_status).toUpperCase();
  const postponed = /POSTPON|CANCEL|SUSPEND|DELAY/.test(status + ' ' + fin);
  const awaySide = g.away || {}, homeSide = g.home || {};
  const finished = !postponed && status === 'FINISHED' && num(awaySide.runs) !== null && num(homeSide.runs) !== null;
  const sno = num(g.seq);
  const away = teamIdOf(awaySide.team), home = teamIdOf(homeSide.team);
  return {
    id: sno !== null ? `${year}-${kind}-${sno}` : `${year}-${kind}-r${clean(g.uniqid)}`,
    date: when.slice(0, 10),
    time: when.slice(11, 16),
    kind, sno,
    field: clean(info.location_abbr || info.location),
    park: parkIdOf(info.location_abbr) || parkIdOf(info.location),
    away, home,
    awayName: teamNameOf(away, awaySide.team),
    homeName: teamNameOf(home, homeSide.team),
    awayScore: finished ? num(awaySide.runs) : null,
    homeScore: finished ? num(homeSide.runs) : null,
    status: postponed ? 'postponed' : finished ? 'final' : 'scheduled',
    awaySP: rebasSP(awaySide),
    homeSP: rebasSP(homeSide),
    wp: '', lp: '', sv: '', mvp: ''
  };
}

export async function fetchRebas(year) {
  const request = makeClient();
  const league = parseLoose(await (await request('https://www.rebas.tw/api/leagues/CPBL', { headers: REBAS_HEADERS })).text());
  const seasons = ((league.data || {}).seasons || []).filter(s =>
    REBAS_KIND[clean(s.type).toUpperCase()] && (Number(s.year) === year || clean(s.uniqid).startsWith(`CPBL-${year}-`)));
  const out = [];
  for (const s of seasons) {
    const kind = REBAS_KIND[clean(s.type).toUpperCase()];
    const body = parseLoose(await (await request(`https://www.rebas.tw/api/seasons/${encodeURIComponent(s.uniqid)}/games`, { headers: REBAS_HEADERS })).text());
    const rows = Array.isArray(body) ? body : (body.data || []);
    const games = rows.map(g => normalizeRebas(g, kind, year)).filter(Boolean);
    console.log(`  Rebas ${s.uniqid}（${kind}）：${games.length} 筆`);
    out.push(...games);
  }
  return out;
}

/* ---------- 合併 ---------- */
const RANK = { final: 3, scheduled: 2, postponed: 1 };
// 同一場次可能同時有「原訂日期（延賽）」與「補賽日期」兩筆，留下比較完整的那筆
function better(a, b) {
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] > RANK[b.status] ? a : b;
  return a.date >= b.date ? a : b;
}
export function dedupe(list) {
  const map = new Map();
  for (const g of list) map.set(g.id, map.has(g.id) ? better(map.get(g.id), g) : g);
  return [...map.values()];
}
export function mergeGames(oldGames, fresh) {
  const map = new Map((oldGames || []).map(g => [g.id, g]));
  for (const f of dedupe(fresh)) {
    const o = map.get(f.id);
    if (!o) { map.set(f.id, f); continue; }
    // 舊資料已經有較晚的補賽日期，就不要被原訂日期的延賽紀錄蓋回去
    if (f.status === 'postponed' && o.status === 'scheduled' && o.date > f.date) continue;
    if (o.status === 'final' && f.status !== 'final') {
      // 已完賽的資料不會被未完賽的舊排程蓋掉，只補空白的球員欄位
      const m = { ...o };
      for (const k of ['awaySP', 'homeSP']) if (!m[k] && f[k]) m[k] = f[k];
      map.set(f.id, m);
      continue;
    }
    const m = { ...o };
    for (const [k, v] of Object.entries(f)) if (v !== '' && v !== null && v !== undefined) m[k] = v;
    if (f.status !== 'final') { m.awayScore = null; m.homeScore = null; }
    map.set(f.id, m);
  }
  return [...map.values()].sort((a, b) => (a.date + a.time + a.kind).localeCompare(b.date + b.time + b.kind) || (a.sno || 0) - (b.sno || 0));
}

/* ---------- 讀寫檔案 ---------- */
export async function readGames(file = OUT_FILE) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { return { games: [] }; }
}
export function stringifyGames(data) {
  // 一場比賽一行，方便在 GitHub 上看每次更新改了什麼
  const head = { ...data };
  delete head.games;
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  return `{\n${lines.join('\n')}\n  "games": [\n${data.games.map(g => '    ' + JSON.stringify(g)).join(',\n')}\n  ]\n}\n`;
}
export async function writeGames(data, file = OUT_FILE) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, stringifyGames(data), 'utf8');
}

/* ---------- 主程式 ---------- */
async function main() {
  const tw = new Date(Date.now() + 8 * 3600 * 1000);
  const today = tw.toISOString().slice(0, 10);
  const year = Number(process.argv[2]) || tw.getUTCFullYear();
  const old = await readGames();
  console.log(`更新 ${year} 年比賽資料（目前檔案 ${old.games.length} 場）`);

  let fresh = null, source = '';
  try {
    fresh = await fetchOfficial(year);
    source = 'cpbl';
  } catch (e) {
    console.log(`官網抓不到：${e.message}，改用野球革命 Rebas`);
  }
  if (!fresh || !fresh.length) {
    try {
      const r = await fetchRebas(year);
      if (r.length || !fresh) { fresh = r; source = 'rebas'; }
    } catch (e) {
      console.log(`Rebas 也抓不到：${e.message}`);
    }
  }
  if (!fresh) {
    console.log('兩個來源都失敗，保留原本的資料。');
    process.exitCode = 1;
    return;
  }

  const games = mergeGames(old.games, fresh);
  const changed = JSON.stringify(games) !== JSON.stringify(old.games);
  await writeGames({
    updatedAt: changed ? new Date().toISOString() : (old.updatedAt || new Date().toISOString()),
    checkedAt: today,
    source: changed ? source : (old.source || source),
    games
  });
  const finals = games.filter(g => g.status === 'final').length;
  console.log(`完成：共 ${games.length} 場（已完賽 ${finals} 場），來源 ${source}${changed ? '' : '，內容沒有變動'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}
