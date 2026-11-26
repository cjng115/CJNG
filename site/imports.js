// قراءة القوائم التي تُستورد في المتصفح، بلا رفع إلى أي مكان:
// - AniList باسم المستخدم (قوائمه عامة، فلا دخول ولا مفتاح)، بالشكل نفسه الذي يقرأ به site/anime-mal.js ملف MyAnimeList
// - IMDb: ملفات CSV يصدّرها (Your ratings، وWatchlist، وأي قائمة)، وفيها رقم كل عمل في IMDb
// - Letterboxd: ملف ZIP الذي يصدّره (Settings ← Data ← Export your data) أو ملفات CSV منه، وفيها الاسم والسنة
import { STATUSES } from './anime-mal.js?v=__BUILD__';

// ---------- CSV (RFC 4180): فواصل وعلامات تنصيص وأسطر داخل الخانة، وBOM في أول الملف
export function parseCsv(text) { const rows = []; let row = [], cell = '', q = false; text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x !== '')) rows.push(row); row = []; } else cell += c; }
  row.push(cell); if (row.some(x => x !== '')) rows.push(row);
  const head = (rows.shift() || []).map(h => h.trim());
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()]))); }

// ---------- ZIP: يُقرأ الفهرس المركزي، وتُفك الملفات المضغوطة بـDecompressionStream (deflate-raw) في المتصفح
export async function unzip(buf, want = () => true) { const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = {};
  let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ليس ملف ZIP سليماً.');
  let p = dv.getUint32(eocd + 16, true); const n = dv.getUint16(eocd + 10, true);
  for (let k = 0; k < n; k++) { if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen)); p += 46 + nameLen + extra + comment;
    if (name.endsWith('/') || !want(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true), data = u8.subarray(start, start + size);
    if (method === 0) out[name] = new TextDecoder().decode(data);
    else if (method === 8) { if (typeof DecompressionStream !== 'function') throw new Error('متصفحك لا يفك ملفات ZIP. فكّه أولاً ثم اختر ملفات CSV منه.');
      out[name] = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text(); } }
  return out; }

// ---------- AniList باسم المستخدم: القوائم كما في حسابه، بأرقام MyAnimeList (ما ليس له رقم هناك لا يُطابق فيُعدّ)
const AL_STATUS = { CURRENT: 'watching', REPEATING: 'watching', COMPLETED: 'completed', PAUSED: 'hold', DROPPED: 'dropped', PLANNING: 'plan' };
const AL_TYPE = { TV: 'TV', TV_SHORT: 'TV', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music' };
const alDate = d => !d?.year ? null : `${d.year}${d.month ? `-${String(d.month).padStart(2, '0')}${d.day ? `-${String(d.day).padStart(2, '0')}` : ''}` : ''}`;
export async function readAniList(user, { signal } = {}) { user = String(user || '').trim().replace(/^https?:\/\/anilist\.co\/user\//i, '').replace(/\/.*$/, '');
  if (!/^[\w-]{2,40}$/.test(user)) throw new Error('اكتب اسم المستخدم في AniList كما في رابط صفحته.');
  const query = `query($u:String){MediaListCollection(userName:$u,type:ANIME){user{name} lists{entries{status progress repeat score(format:POINT_10) startedAt{year month day} completedAt{year month day} media{idMal title{romaji} format episodes isAdult}}}}}`;
  let r; try { r = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query, variables: { u: user } }), signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'لم يُجب AniList الآن. حاول بعد قليل.' : 'تعذّر الاتصال بـAniList. تحقق من الشبكة ثم حاول.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.data?.MediaListCollection) { const m = j?.errors?.[0]?.message || ''; throw new Error(/not found|private/i.test(m) || r.status === 404 ? 'لا مستخدم بهذا الاسم في AniList، أو قائمته خاصة.' : 'تعذّرت قراءة القائمة من AniList الآن.'); }
  const entries = [], skipped = [], seen = new Set(); let ord = 0;
  for (const l of j.data.MediaListCollection.lists || []) for (const x of l.entries || []) { const m = x.media || {}, status = AL_STATUS[x.status];
    if (!Number.isInteger(m.idMal) || !status) { skipped.push(m.title?.romaji || '؟'); continue; } if (seen.has(m.idMal)) continue; seen.add(m.idMal);
    entries.push({ id: m.idMal, ord: ord++, title: m.title?.romaji || String(m.idMal), type: AL_TYPE[m.format] || '', eps: Number.isInteger(m.episodes) ? m.episodes : 0, status,
      watched: Math.max(0, x.progress | 0), score: Math.min(10, Math.max(0, Math.round(x.score || 0))), start: alDate(x.startedAt), finish: alDate(x.completedAt), ...(m.isAdult ? { ad: 1 } : {}) }); }
  const count = s => entries.filter(e => e.status === s).length;
  return { source: 'anilist', user: { name: j.data.MediaListCollection.user?.name || user }, entries, skipped,
    totals: { all: entries.length, ...Object.fromEntries(STATUSES.map(s => [s, count(s)])), episodes: entries.reduce((n, e) => n + e.watched, 0), scored: entries.filter(e => e.score).length } }; }

// ---------- IMDb: ملف CSV. «Your ratings» يُعدّ ما شاهدته، والقوائم الأخرى (Watchlist وغيرها) ما ستشاهده. الحلقات والألعاب والبودكاست لا تدخل
const IMDB_SKIP = /episode|video ?game|podcast|music ?video/i, IMDB_TV = /series|mini/i;
export function readImdbCsv(text, name = '') { const rows = parseCsv(text); if (!rows.length || !('Const' in rows[0])) throw new Error(`${name || 'الملف'}: ليس ملف تصدير من IMDb (لا عمود Const).`);
  const rated = 'Date Rated' in rows[0] && !('Position' in rows[0]), list = rated ? 'watched' : /watch ?list/i.test(name) || !('Your Rating' in rows[0]) || 'Position' in rows[0] ? 'next' : 'watched', items = [], skipped = [];
  for (const r of rows) { const tt = (r.Const.match(/tt\d{5,10}/) || [])[0], type = r['Title Type'] || '';
    if (!tt || IMDB_SKIP.test(type)) { skipped.push(r.Title || r.Const); continue; }
    items.push({ imdb: tt, title: r.Title || r['Original Title'] || tt, year: +r.Year || null, tv: IMDB_TV.test(type), list }); }
  return { source: 'imdb', name, list, items, skipped }; }

// ---------- Letterboxd: watched.csv وwatchlist.csv (وما في ratings.csv وdiary.csv يُعدّ مشاهداً). أعمدتها: Date، Name، Year، Letterboxd URI
const LB_LIST = n => /watchlist/i.test(n) ? 'next' : /(^|\/)(watched|ratings|diary|reviews)\.csv$/i.test(n) ? 'watched' : '';
export async function readLetterboxd(files) { const texts = {};
  for (const f of files) { const buf = await f.arrayBuffer(), b = new Uint8Array(buf);
    if (b[0] === 0x50 && b[1] === 0x4b) Object.assign(texts, await unzip(buf, n => !!LB_LIST(n) && !/(^|\/)(deleted|orphaned)\//i.test(n)));
    else texts[f.name] = new TextDecoder().decode(b); }
  const items = [], seen = new Map(), skipped = [];
  for (const [n, t] of Object.entries(texts)) { const list = LB_LIST(n); if (!list) continue; const rows = parseCsv(t);
    if (rows.length && !('Name' in rows[0])) throw new Error(`${n}: ليس ملف تصدير من Letterboxd (لا عمود Name).`);
    for (const r of rows) { const title = r.Name, year = +r.Year || null; if (!title) continue; const k = title.toLowerCase() + '|' + (year || '');
      const had = seen.get(k); if (had) { if (list === 'watched') had.list = 'watched'; continue; }   // ما شوهد يغلب ما في قائمة المشاهدة
      const it = { title, year, list }; seen.set(k, it); items.push(it); } }
  if (!Object.keys(texts).some(LB_LIST)) throw new Error('لم أجد في الملف watched.csv ولا watchlist.csv. اختر ملف ZIP كما نزل من Letterboxd، أو ملفات CSV منه.');
  return { source: 'letterboxd', items, skipped }; }
