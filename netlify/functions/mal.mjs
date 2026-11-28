// دالة «MyAnimeList» (/api/mal) على Netlify: تربط موقعك بحسابك في MyAnimeList ربطاً باتجاهين. ما تضيفه أو تغيّره في «أنمياتي» يُكتب
// في قائمتك هناك، وما تغيّره هناك يُسحب إلى الموقع. الصفحة تقارن وتقرر (site/anime-malsync.js)، وهذه الدالة تحمل رمز الدخول وتكلّم MyAnimeList.
//   الربط: OAuth 2.0 بـPKCE. الصفحة تطلب رابط الدخول (action: login)، فتذهب إلى MyAnimeList وتوافق، ويرجع MyAnimeList إلى هذه الدالة
//   بالرمز، فتستبدله برمز دخول ورمز تجديد وتحفظهما في Netlify Blobs (مخزن المشروع نفسه، لا في المستودع ولا في المتصفح)، ثم تعيدك إلى «أنمياتي».
//   متغيرات Netlify: MAL_CLIENT_ID (معرّف تطبيقك، كسر المستودع) وMAL_CLIENT_SECRET (سرّ التطبيق من صفحته في MyAnimeList)، وGH_REPO كما في «حساباتي».
//   وفي صفحة التطبيق في MyAnimeList يكون App Redirect URL هو رابط هذه الدالة: https://<المشروع>.netlify.app/api/mal
// الطلبات (عدا رجوع MyAnimeList) لصاحب الموقع وحده: تحمل رمز GitHub الذي في متصفحه، وتُقبل إن كان الرمز يكتب في GH_REPO. لا يُكتب رمز في السجل.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const AUTH = 'https://myanimelist.net/v1/oauth2', API = 'https://api.myanimelist.net/v2';
const REPO = () => (process.env.GH_REPO || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$|\/+$/g, '');
const SITE = () => { const s = (process.env.SITE_URL || '').trim().replace(/\/+$/, ''); if (/^https:\/\/[^/]+/.test(s)) return s; const [o, r] = REPO().split('/'); if (!o || !r) return '';
  return r.toLowerCase() === `${o.toLowerCase()}.github.io` ? `https://${r.toLowerCase()}` : `https://${o.toLowerCase()}.github.io/${r}`; };
const ORIGIN = () => { try { return new URL(SITE()).origin; } catch { return ''; } };
const cors = () => ({ 'access-control-allow-origin': ORIGIN() || 'null', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '86400', vary: 'origin' });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors() } });
const go = url => new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } });
const ID = () => (process.env.MAL_CLIENT_ID || '').trim(), SECRET = () => (process.env.MAL_CLIENT_SECRET || '').trim();
const fail = (msg, status = 400, extra = {}) => Object.assign(new Error(msg), { status, extra });

// صاحب الموقع: رمز GitHub يكتب في مستودعه (كما في «حساباتي»)
const OWN = new Map(), hash = x => createHash('sha256').update(String(x)).digest('hex');
async function owner(req) { const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim(); if (!tok || tok.length > 400) return 'none';
  const k = hash(tok), c = OWN.get(k); if (c && c.until > Date.now()) return c.v;
  const r = await fetch(`https://api.github.com/repos/${REPO()}`, { headers: { authorization: `Bearer ${tok}`, accept: 'application/vnd.github+json', 'user-agent': 'watch-portals-mal' }, signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!r) return 'down'; const j = r.ok ? await r.json().catch(() => ({})) : {}, v = r.ok && (j.permissions?.push || j.permissions?.admin) ? 'ok' : r.status === 401 ? 'bad' : 'other';
  OWN.set(k, { v, until: Date.now() + (v === 'ok' ? 6e5 : 6e4) }); return v; }

// الحالة الموقّعة: تحمل مفتاح PKCE ووقت الطلب، موقّعة بسرّ التطبيق فلا يُزوَّر رجوع
const b64u = b => Buffer.from(b).toString('base64url');
const sign = s => createHmac('sha256', SECRET()).update(s).digest('base64url');
function makeState() { const v = b64u(randomBytes(48)), body = b64u(JSON.stringify({ v, t: Date.now() })); return { v, state: body + '.' + sign(body) }; }
function readState(s) { const [body, sig] = String(s || '').split('.'); if (!body || !sig) return null; const want = Buffer.from(sign(body)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null; try { const o = JSON.parse(Buffer.from(body, 'base64url').toString()); return Date.now() - o.t < 20 * 60e3 ? o : null; } catch { return null; } }

// الرموز في Netlify Blobs
const store = () => getStore({ name: 'mal', consistency: 'strong' });
const loadTok = () => store().get('token', { type: 'json' }).catch(() => null);
const saveTok = (j, old) => { const t = { access: j.access_token, refresh: j.refresh_token || old?.refresh, exp: Date.now() + (+j.expires_in || 2678400) * 1000 }; return store().setJSON('token', t).then(() => t); };
async function tokenCall(params) { const r = await fetch(AUTH + '/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: ID(), client_secret: SECRET(), ...params }), signal: AbortSignal.timeout(15000) }); const j = await r.json().catch(() => ({})); return { ok: r.ok && !!j.access_token, j }; }
async function access() { let t = await loadTok(); if (!t?.access) throw fail('لم يُربط حسابك في MyAnimeList بعد.', 409, { need: 'link' });
  if (t.exp - Date.now() < 5 * 60e3) { const { ok, j } = await tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh });
    if (!ok) { await store().delete('token').catch(() => {}); throw fail('انتهى ربط MyAnimeList: اربطه من جديد.', 409, { need: 'link' }); } t = await saveTok(j, t); }
  return t.access; }
async function mal(path, init = {}) { const tok = await access(); const r = await fetch(API + path, { ...init, headers: { ...(init.headers || {}), authorization: 'Bearer ' + tok }, signal: AbortSignal.timeout(15000) });
  if (r.status === 401) { await store().delete('token').catch(() => {}); throw fail('رفض MyAnimeList رمز الدخول: اربط حسابك من جديد.', 409, { need: 'link' }); }
  return r; }

// قائمتك كلها من MyAnimeList (حتى 1000 في الصفحة)، مختصرة لما تحتاجه الصفحة
async function list() { const out = []; let next = `/users/@me/animelist?${new URLSearchParams({ fields: 'list_status,num_episodes,media_type,start_season,nsfw', limit: '1000', nsfw: 'true' })}`;
  for (let i = 0; next && i < 20; i++) { const r = await mal(next.replace(API, '')); if (!r.ok) throw fail('تعذّر سحب قائمتك من MyAnimeList الآن.', 502); const j = await r.json();
    for (const { node: n, list_status: s } of j.data || []) out.push({ id: n.id, t: n.title, ty: n.media_type, n: n.num_episodes || 0, y: n.start_season?.year || null, ad: n.nsfw === 'black' ? 1 : 0,
      s: s.status, p: s.num_episodes_watched || 0, r: s.score || 0, b: s.start_date || null, e: s.finish_date || null, u: s.updated_at || null });
    next = j.paging?.next || null; }
  return out; }
// متى أضفت كل عمل إلى قائمتك (created_at). واجهة MyAnimeList الرسمية لا تعطيه، فيُقرأ من صفحة قائمتك نفسها (load.json، 300 في الصفحة)
async function added() { const r = await mal('/users/@me'); if (!r.ok) throw fail('تعذّر التعرف على حسابك في MyAnimeList الآن.', 502);
  const name = (await r.json()).name; if (!/^[\w-]{2,30}$/.test(name || '')) throw fail('اسم حسابك في MyAnimeList غير متوقع.', 502);
  const at = {};
  for (let off = 0; off < 20000; off += 300) { const q = await fetch(`https://myanimelist.net/animelist/${name}/load.json?status=7&offset=${off}`, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (watch-portals)' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!q?.ok) { if (off) break; throw fail('تعذّر قراءة تواريخ الإضافة من MyAnimeList الآن.', 502); }
    const j = await q.json().catch(() => null); if (!Array.isArray(j)) break;
    for (const x of j) if (Number.isInteger(x?.anime_id) && Number.isInteger(x?.created_at)) at[x.anime_id] = x.created_at;
    if (j.length < 300) break; }
  return at; }
// كتابة دفعة: لكل عمل حالته وحلقاته وتقييمه وتاريخاه، أو حذفه من قائمتك هناك
const STAT = new Set(['watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch']), DAY = /^\d{4}-\d{2}-\d{2}$/;
async function push(items, until) { const done = [], todo = [];
  const one = async x => { const id = +x?.id; if (!Number.isInteger(id) || id <= 0) return;
    if (Date.now() > until) { todo.push(id); return; }
    if (x.del) { const r = await mal(`/anime/${id}/my_list_status`, { method: 'DELETE' }); done.push({ id, ok: r.ok || r.status === 404 }); return; }
    if (!STAT.has(x.s)) return; const f = { status: x.s };
    if (Number.isInteger(x.p) && x.p >= 0) f.num_watched_episodes = String(x.p); if (Number.isInteger(x.r) && x.r >= 0 && x.r <= 10) f.score = String(x.r);
    if (DAY.test(x.b || '')) f.start_date = x.b; if (DAY.test(x.e || '')) f.finish_date = x.e;
    const r = await mal(`/anime/${id}/my_list_status`, { method: 'PATCH', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f) });
    const j = r.ok ? await r.json().catch(() => ({})) : null; done.push({ id, ok: r.ok, u: j?.updated_at || null }); };
  const q = items.slice(0, 40); let i = 0; await Promise.all([0, 1, 2].map(async () => { while (i < q.length) await one(q[i++]); }));
  return { done, todo }; }

export default async req => {
  const t0 = Date.now(), url = new URL(req.url), self = `${url.origin}/api/mal`;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (!REPO() || !SITE()) return json(500, { error: 'إعدادات الخادم ناقصة: GH_REPO غير موجود في Netlify.' });
  // رجوع MyAnimeList بعد الموافقة: يُستبدل الرمز ويُحفظ، ثم إلى «أنمياتي»
  if (req.method === 'GET' && (url.searchParams.has('code') || url.searchParams.has('error'))) {
    const st = readState(url.searchParams.get('state')), code = url.searchParams.get('code');
    if (!st || !code) return go(`${SITE()}/anime/#mal-fail`);
    const { ok, j } = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: self, code_verifier: st.v });
    if (!ok) { console.error('mal token', j.error || '', j.message || ''); return go(`${SITE()}/anime/#mal-fail`); }
    await saveTok(j); return go(`${SITE()}/anime/#mal-linked`); }
  if (req.method === 'GET') return json(200, { ok: true, mal: !!(ID() && SECRET()), repo: REPO(), site: SITE(), redirect: self });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const who = await owner(req);
  if (who === 'down') return json(502, { error: 'تعذّر التحقق من رمز GitHub الآن. حاول بعد قليل.' });
  if (who !== 'ok') return json(401, { error: who === 'none' ? 'token' : 'owner' });
  let b; try { b = await req.json(); } catch { return json(400, { error: 'طلب غير صالح.' }); }
  if (!ID() || !SECRET()) return json(503, { error: 'مفتاحا MyAnimeList غير موجودين في Netlify بعد (MAL_CLIENT_ID وMAL_CLIENT_SECRET).', need: 'keys' });
  try {
    if (b.action === 'status') { const t = await loadTok(); let user = null;
      if (t?.access) { const r = await mal('/users/@me').catch(() => null); if (r?.ok) user = (await r.json()).name || null; }
      return json(200, { linked: !!user, user }); }
    if (b.action === 'login') { const { v, state } = makeState();
      return json(200, { url: `${AUTH}/authorize?${new URLSearchParams({ response_type: 'code', client_id: ID(), redirect_uri: self, state, code_challenge: v, code_challenge_method: 'plain' })}` }); }
    if (b.action === 'unlink') { await store().delete('token'); return json(200, { linked: false }); }
    if (b.action === 'list') return json(200, { items: await list() });
    if (b.action === 'added') return json(200, { at: await added() });
    if (b.action === 'push') return json(200, await push(Array.isArray(b.items) ? b.items : [], t0 + 8000));
    return json(400, { error: 'طلب غير معروف.' });
  } catch (e) {
    if (e.status) return json(e.status, { error: e.message, ...e.extra });
    console.error(e.name, e.message?.replace(/[A-Za-z0-9._-]{40,}/g, '…')); return json(502, { error: 'تعذّر إكمال الطلب الآن. حاول بعد قليل.' });
  }
};
export const config = { path: '/api/mal' };
