// ما كانت تفعله دوال الخادم، من الصفحة نفسها: الموقع على GitHub Pages بلا خادم، فالبحث والمعاينة من TMDB بمفتاح صاحبه، والإضافة والاستيراد
// كتابة في قوائم المستودع برمزه (site/keys.js)، فيبني المستودع الموقع من جديد. كل دالة ترمي خطأً رسالته للعرض، وما ينقصه مفتاح يحمل need.
import { tmdb, ghUpdate, need } from './keys.js?v=__BUILD__';
import { parseLine, search, shape, shapeCollection, detailPath, detailParams, ADULT_PAGES } from './lib/lib-films.mjs?v=__BUILD__';
import { worldsFor } from './lib/lib-worlds.mjs?v=__BUILD__';
import { gatherEvidence, chronoOrder, WIKI_API } from './lib/lib-chrono.mjs?v=__BUILD__';

const year = c => +(c.release_date || c.first_air_date || '').slice(0, 4) || null;
// Wikipedia لا يجيب الصفحات إلا بـorigin=*، وWikidata بلا ترويسات خاصة (المكتبتان تمرّران fetchImpl هذا إلى كل طلب)
const pageFetch = (url, init = {}) => { const u = String(url); const h = { ...(init.headers || {}) }; delete h['User-Agent'];
  return fetch(u.startsWith(WIKI_API) && !/[?&]origin=/.test(u) ? u + '&origin=*' : u, { ...init, headers: h }); };

// ---------- الأفلام: اقتراح، بحث، معاينة، إضافة، عالم العمل. العقد نفسه الذي كانت تعيده دالة «أضف فيلماً»
export async function filmApi(b) { const adult = b.adult === true || b.adult === 1;
  if (b.action === 'suggest') {
    const q = String(b.q || '').replace(/\s+/g, ' ').trim().slice(0, 80); if (q.length < 2) return { items: [] };
    const rs = await Promise.all((adult ? ADULT_PAGES : [1]).map(page => tmdb('/search/multi', { query: q, include_adult: adult, language: 'en-US', ...(page > 1 ? { page } : {}) }).catch(e => { if (page === 1) throw e; return {}; }))), seen = new Set();
    const all = rs.flatMap(r => r.results || []).filter(x => (x.media_type === 'movie' || x.media_type === 'tv') && (adult || !x.adult) && !seen.has(x.media_type + x.id) && seen.add(x.media_type + x.id));
    const top = all.slice(0, adult ? 4 : 6), items = [...top, ...(adult ? all.filter(x => x.adult && !top.includes(x)).slice(0, 2) : [])]
      .map(x => ({ tmdb: x.id, kind: x.media_type, title: x.title || x.name, year: year(x), poster: x.poster_path || null, adult: x.adult ? 1 : undefined }));
    return { items }; }
  if (b.action === 'search') {
    const parsed = parseLine(String(b.q || '').slice(0, 200)); if (!parsed.title) throw new Error('اكتب اسم الفيلم.');
    const [mv, tv] = await Promise.all([search(tmdb, 'movie', parsed.title, parsed.year, adult), search(tmdb, 'tv', parsed.title, parsed.year, adult)]);
    const usual = s => s.filter(x => !x.c.adult), x18 = s => adult ? s.filter(x => x.c.adult).slice(0, 3) : [], byScore = (a, c) => c.score - a.score;
    const movies = [...usual(mv.scored).slice(0, 5), ...x18(mv.scored)].sort(byScore).map(x => ({ kind: 'movie', c: x.c })), shows = [...usual(tv.scored).filter(x => x.exact).slice(0, 2), ...x18(tv.scored)].sort(byScore).map(x => ({ kind: 'tv', c: x.c }));
    const candidates = await Promise.all([...movies, ...shows].map(async ({ kind, c }, i) => {
      const col = kind === 'movie' && i < 4 && !c.adult ? (await tmdb('/movie/' + c.id).catch(() => null))?.belongs_to_collection?.name?.replace(/\s+Collection$/i, '') : null;
      return { tmdb: c.id, kind, title: c.title || c.name, year: year(c), poster: c.poster_path || null, collection: col || undefined, adult: c.adult ? 1 : undefined }; }));
    return { parsed, sure: mv.sure, candidates }; }
  if (b.action === 'add' || b.action === 'preview') {
    const kind = b.kind === 'tv' ? 'tv' : 'movie', id = +b.tmdb; if (!Number.isInteger(id) || id <= 0) throw new Error('معرّف غير صالح.');
    const providers = {}, film = shape(kind, await tmdb(detailPath(kind, id), detailParams(kind)).catch(e => { if (e.status === 404) throw new Error('هذا العمل غير موجود في TMDB.'); throw e; }), providers);
    if (film.adult && !adult) throw new Error('هذا العمل مصنَّف للبالغين: افتح العين أعلى الصفحة ثم أضفه.');
    const collection = film.col ? await tmdb('/collection/' + film.col, { language: 'en-US' }).then(shapeCollection).catch(() => null) : null;
    if (b.action === 'preview') return { film, collection, providers };
    const at = new Date().toISOString(), state = await addFilms([{ tmdb: id, kind, title: film.title, year: film.year, at, ...(film.adult ? { adult: 1 } : {}) }]) ? 'added' : 'exists';
    return { state, film: { ...film, src: 'added', addedAt: at }, collection, providers }; }
  // عالم العمل: سلسلته وعالمه وأعماله المرتبطة من Wikidata، وترتيب أحداثه من أدلة Wikipedia. الفشل لا يعطّل البطاقة
  if (b.action === 'worlds') {
    const kind = b.kind === 'tv' ? 'tv' : 'movie', id = +b.tmdb; if (!Number.isInteger(id) || id <= 0) throw new Error('معرّف غير صالح.');
    const key = (kind === 'tv' ? 't' : 'm') + id, t0 = Date.now(), opt = { timeout: 20000, tries: 2, fetchImpl: pageFetch }, r = await worldsFor([key], { tmdb, opt }), cols = {};
    const self = await tmdb(detailPath(kind, id), { language: 'en-US' }).catch(() => null), date = (kind === 'tv' ? self?.first_air_date : self?.release_date) || null;
    const groups = (r.works[key]?.worlds || []).map(w => ({ w, keys: r.worlds[w].order, wide: ['universe', 'franchise'].includes(r.worlds[w].kind) })).filter(g => g.keys.length >= 2 && g.keys.length <= 40);
    const col = kind === 'movie' && self?.belongs_to_collection?.id ? await tmdb('/collection/' + self.belongs_to_collection.id, { language: 'en-US' }).then(shapeCollection).catch(() => null) : null;
    if (col?.parts.length > 1) groups.push({ c: col.id, keys: col.parts.map(p => 'm' + p.tmdb) });
    const left = Math.max(3000, 40000 - (Date.now() - t0));
    const ev = groups.length ? await Promise.race([gatherEvidence([...new Set(groups.flatMap(g => g.keys))], { tmdb, opt: { timeout: Math.min(15000, left), tries: 1, fetchImpl: pageFetch } }).catch(() => null), new Promise(ok => setTimeout(() => ok(null), left))]) : null;
    if (ev) { const part = new Map((col?.parts || []).map(p => ['m' + p.tmdb, p]));
      const meta = k => { const o = k === key ? { title: self?.title || self?.name, date } : r.basic[k] || part.get(k) || {}; return { k, title: o.title || k, date: o.date || null }; };
      for (const g of groups) { const c = chronoOrder(g.keys.map(meta), ev, { wide: g.wide }), moved = Object.keys(c.moved).length;
        const seen = g.keys.every(k => ev[k] && !ev[k].miss); if (!moved && !seen) continue;
        if (g.c) cols[g.c] = moved ? c : { chk: 1 }; else if (moved) r.worlds[g.w].chrono = c; else r.worlds[g.w].chk = 1; } }
    return { key, worlds: r.worlds, works: r.works, info: r.info, cols }; }
  throw new Error('طلب غير معروف.'); }

// ---------- مطابقة ما يُستورد في TMDB: IMDb برقمه (find)، وLetterboxd باسمه وسنته (البحث نفسه الذي تُطابق به القائمة المكتوبة في البناء).
// يعيد { found: [{ tmdb, kind, title, year, list, adult? }], missing: [اسم] }. onProgress(تمّ، الكل)
export async function resolveFilms(items, { onProgress = () => {} } = {}) {
  await tmdb('/configuration');   // يتحقق من المفتاح أولاً: البحث يبتلع أخطاءه، فمفتاح غير صالح كان سيجعل كل شيء «لم يُطابق»
  const found = [], missing = [], seen = new Set(); let done = 0;
  await Promise.all(items.map(async it => { try { let x = null, kind = 'movie';
      if (it.imdb) { const r = await tmdb(`/find/${it.imdb}`, { external_source: 'imdb_id', language: 'en-US' }), mv = r.movie_results?.[0], tv = r.tv_results?.[0];
        x = it.tv ? tv || mv : mv || tv; kind = x && x === tv ? 'tv' : 'movie'; }
      else { x = (await search(tmdb, 'movie', it.title, it.year)).top; if (!x) { x = (await search(tmdb, 'tv', it.title, it.year)).top; kind = 'tv'; } }
      const k = x && (kind === 'tv' ? 't' : 'm') + x.id;
      if (!x) missing.push(it.title + (it.year ? ` (${it.year})` : ''));
      else if (!seen.has(k)) { seen.add(k); found.push({ tmdb: x.id, kind, title: x.title || x.name, year: year(x), list: it.list, ...(x.adult ? { adult: 1 } : {}),
          // وما يكفي لبطاقة مؤقتة بغلافها حتى يبنيه الموقع
          date: (kind === 'tv' ? x.first_air_date : x.release_date) || null, poster: x.poster_path || null, rating: x.vote_count ? Math.round(x.vote_average * 10) / 10 : null, votes: x.vote_count || 0,
          genres: x.genre_ids || [], lang: x.original_language || null, overview: (x.overview || '').trim() || null }); }
      else if (it.list === 'watched') { const f = found.find(y => (y.kind === 'tv' ? 't' : 'm') + y.tmdb === k); if (f) f.list = 'watched'; } }
    catch (e) { if (e.need) throw e; missing.push(it.title); }
    finally { onProgress(++done, items.length); } }));
  return { found, missing }; }

// ---------- الكتابة في قوائم المستودع. عنوان الإيداع بالعدد، وعمل +18 برقمه بلا اسمه
const FILMS = 'data/films/added.json', ANIME = 'data/anime/list.json';
// الأفلام: { tmdb, kind, title, year, at, adult? }، ما في الملف لا يتكرر. يعيد عدد ما أُضيف
export async function addFilms(entries) { let n = 0, one = null;
  const ok = await ghUpdate(FILMS, cur => { const list = Array.isArray(cur) ? cur : [], have = new Set(list.map(x => (x.kind === 'tv' ? 't' : 'm') + x.tmdb)); n = 0;
    for (const e of entries) { const k = (e.kind === 'tv' ? 't' : 'm') + e.tmdb; if (have.has(k)) continue; have.add(k); list.push(e); n++; one = e; }
    return n ? list : undefined; }, () => n === 1 ? (one.adult ? `films: add +18 (${one.kind === 'tv' ? 't' : 'm'}${one.tmdb})` : `films: add ${one.title}${one.year ? ` (${one.year})` : ''}`) : `films: import ${n}`);
  return ok ? n : 0; }
// الأنمي: { mal, title, type, eps, ad? } بترتيب الأسماء كما يرتّب MyAnimeList قائمته. يعيد عدد ما أُضيف
const up = s => String(s).toUpperCase();
export async function addAnime(entries) { let n = 0, one = null;
  const ok = await ghUpdate(ANIME, cur => { const list = Array.isArray(cur) ? cur : [], have = new Set(list.map(x => +x.mal)); n = 0;
    for (const e of entries) { if (!Number.isInteger(e.mal) || e.mal <= 0 || have.has(e.mal)) continue; have.add(e.mal); const i = list.findIndex(x => up(x.title) > up(e.title)); list.splice(i < 0 ? list.length : i, 0, e); n++; one = e; }
    return n ? '[\n' + list.map(x => JSON.stringify(x)).join(',\n') + '\n]\n' : undefined; }, () => n === 1 ? (one.ad ? `anime: add +18 (#${one.mal})` : `anime: add ${one.title} (#${one.mal})`) : `anime: import ${n}`);
  return ok ? n : 0; }

// الألعاب: { games: [{ igdb?, title, year?, at, adult? }] } في data/games/added.json. ما لا رقم له في IGDB يُكتب باسمه وسنته فيطابقه البناء هناك
const GAMES = 'data/games/added.json', gname = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
const gkey = e => e.igdb ? 'i' + e.igdb : 'n' + gname(e.title) + '|' + (e.year || '');
const gclean = e => ({ ...(Number.isInteger(+e.igdb) && +e.igdb > 0 ? { igdb: +e.igdb } : {}), title: String(e.title || '').replace(/[\p{C}<>"`\\]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 160),
  ...(Number.isInteger(+e.year) && +e.year > 1950 ? { year: +e.year } : {}), at: e.at || new Date().toISOString(), ...(e.adult ? { adult: 1 } : {}) });
export async function addGames(entries) { let n = 0, one = null;
  const ok = await ghUpdate(GAMES, cur => { const list = Array.isArray(cur?.games) ? cur.games : [], have = new Set(list.map(gkey)); n = 0;
    for (const e0 of entries) { const e = gclean(e0); if (!e.title && !e.igdb) continue; const k = gkey(e); if (have.has(k)) continue; have.add(k); list.push(e); n++; one = e; }
    return n ? { games: list } : undefined; }, () => n === 1 ? (one.adult ? `games: add +18 (#${one.igdb})` : `games: add ${one.title}${one.year ? ` (${one.year})` : ''}`) : `games: import ${n}`);
  return ok ? n : 0; }
// الحذف برقمها، وما أُضيف باسمه (بلا رقم) يُحذف إن طابق اسمها
export async function removeGames(ids, g = null) { const rm = new Set(ids.map(Number)); let n = 0;
  await ghUpdate(GAMES, cur => { const list = Array.isArray(cur?.games) ? cur.games : [], keep = list.filter(x => !(rm.has(+x.igdb) || (!x.igdb && g && gname(x.title) === gname(g.title))));
    n = list.length - keep.length; return n ? { games: keep } : undefined; }, () => g?.adult ? `games: remove +18 (#${g.id})` : `games: remove ${g?.title || [...rm].join(', ')}`);
  return n; }

// ---------- البحث باسم عربي في الأنمي (E70): MyAnimeList وAniList لا يعرفان الأسماء العربية، وTMDB يعرفها. يعيد الرسوم المتحركة اليابانية بأسمائها
export async function arabicFind(q, adult = false) {
  const bare = q.split(' ').map(w => w.replace(/^(?:[وفبك]?ال|لل)(?=\S{2})/, '')).join(' '), qs = [...new Set([q, bare])];
  const runs = await Promise.allSettled(qs.flatMap(query => ['tv', 'movie'].map(k => tmdb(`/search/${k}`, { query, language: 'en-US', include_adult: adult ? 'true' : 'false' }).then(r => (r.results || []).map(x => ({ ...x, k }))))));
  if (runs.every(r => r.status === 'rejected')) throw runs[0].reason;
  const seen = new Set(), out = [];
  for (const x of runs.flatMap(r => r.status === 'fulfilled' ? r.value : [])) { if (seen.has(x.k + x.id)) continue; seen.add(x.k + x.id);
    if (!(x.genre_ids || []).includes(16) || !(x.original_language === 'ja' || (x.origin_country || []).includes('JP'))) continue;
    const en = String(x.name || x.title || '').trim(), orig = String(x.original_name || x.original_title || '').trim(); if (!en && !orig) continue;
    out.push({ tmdb: x.id, kind: x.k, en: en || orig, ...(orig && orig !== en ? { orig } : {}), year: +String(x.first_air_date || x.release_date || '').slice(0, 4) || null }); }
  return out.slice(0, 5); }
export { need };
