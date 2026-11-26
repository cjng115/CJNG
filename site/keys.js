// مفتاحا هذا الموقع في هذا المتصفح، ونافذتهما. لا شيء منهما في المستودع، ولا يُرسلان إلا إلى صاحبيهما:
// - رمز GitHub (Fine-grained، صلاحية Contents: Read and write على مستودع الموقع وحده): به تُكتب الإضافة والاستيراد في قوائم المستودع
//   (data/anime/list.json وdata/films/added.json)، فيبني المستودع الموقع من جديد وتظهر الأعمال بمعلوماتها كاملة بعد دقائق.
// - مفتاح TMDB: به يُبحث عن الأفلام ويُطّلع على بطاقاتها في الصفحة، ويُطابق ما يُستورد من IMDb وLetterboxd.
// يُلصقان مرة في كل جهاز يُضاف منه أو يُستورد. والتصفح وحده لا يحتاج شيئاً منهما. والمستودع يُعرف من site/build.json (يكتبه البناء)،
// وإلا فمن رابط GitHub Pages نفسه، وإلا فمما يُكتب في النافذة.
const K = { gh: 'portal.gh', tmdb: 'portal.tmdb', repo: 'portal.repo' };
const ls = { get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); return true; } catch { return false; } } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const ghToken = () => ls.get(K.gh).trim(), tmdbKey = () => ls.get(K.tmdb).trim();

// ---------- المستودع
const fromPages = () => { const h = location.hostname; if (!/\.github\.io$/i.test(h)) return ''; const owner = h.split('.')[0], first = location.pathname.split('/').filter(Boolean)[0];
  return first && !/\.html?$/i.test(first) ? `${owner}/${first}` : `${owner}/${h}`; };
let built = null;
const builtRepo = () => built ??= fetch(new URL('build.json', import.meta.url), { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}).then(j => /^[\w.-]+\/[\w.-]+$/.test(j?.repo || '') ? j.repo : '').catch(() => '');
export async function repoOf() { return ls.get(K.repo) || await builtRepo() || fromPages(); }

// خطأ يقول ما ينقص: need = 'gh' أو 'tmdb'، فتفتح الصفحة النافذة عليه
export const need = (what, text) => Object.assign(new Error(text || (what === 'gh' ? 'الإضافة والاستيراد يحتاجان رمز GitHub على هذا الجهاز.' : 'البحث في TMDB يحتاج مفتاح TMDB على هذا الجهاز.')), { need: what });

// ---------- TMDB من الصفحة: طلبات قليلة متزامنة، وإعادة المحاولة عند 429
let active = 0; const queue = [];
const slot = () => new Promise(r => { const go = () => { active++; r(); }; active < 8 ? go() : queue.push(go); }), release = () => { active--; queue.shift()?.(); };
export async function tmdb(path, params = {}) { const key = tmdbKey(); if (!key) throw need('tmdb');
  const u = new URL('https://api.themoviedb.org/3' + path); for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  const bearer = key.length > 40; if (!bearer) u.searchParams.set('api_key', key);
  await slot();
  try { for (let i = 1; ; i++) { let r;
      try { r = await fetch(u, { headers: bearer ? { Authorization: 'Bearer ' + key } : {} }); } catch (e) { if (i >= 3) throw Object.assign(new Error('تعذّر الاتصال بـTMDB. تحقق من الشبكة ثم حاول.'), { net: true }); await sleep(700 * i); continue; }
      if (r.status === 429 && i < 5) { await sleep((+r.headers.get('retry-after') || 1) * 1000); continue; }
      if (r.status === 401) throw Object.assign(need('tmdb', 'مفتاح TMDB على هذا الجهاز غير صالح.'), { status: 401 });
      if (!r.ok) throw Object.assign(new Error(`TMDB ${r.status}`), { status: r.status });
      return r.json(); } }
  finally { release(); } }

// ---------- GitHub: قراءة ملف من المستودع وكتابته (اقرأ ← غيّر ← اكتب، ويُعاد إن تغيّر الملف بينهما)
const b64 = s => { const b = new TextEncoder().encode(s); let t = ''; for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(t); };
const unb64 = s => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/\s/g, '')), c => c.charCodeAt(0)));
async function gh(path, init = {}) { const token = ghToken(), repo = await repoOf(); if (!token) throw need('gh'); if (!repo) throw need('gh', 'لم يُعرف مستودع الموقع: اكتبه في نافذة المفاتيح.');
  let r; try { r = await fetch(`https://api.github.com/repos/${repo}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } }); }
  catch { throw new Error('تعذّر الاتصال بـGitHub. تحقق من الشبكة ثم حاول.'); }
  if (r.status === 401) throw Object.assign(need('gh', 'رمز GitHub على هذا الجهاز غير صالح أو انتهت مدته.'), { status: 401 });
  if (r.status === 403 && r.headers.get('x-ratelimit-remaining') !== '0') throw need('gh', 'رمز GitHub بلا صلاحية الكتابة على المستودع (Contents: Read and write).');
  return r; }
// update(path, change, message): change(القيمة الحالية أو null) تعيد القيمة الجديدة، أو undefined إن لم يتغير شيء. message نص أو دالة تُستدعى بعد change. يعيد true إن كُتب
export async function ghUpdate(path, change, message) {
  for (let i = 0; i < 4; i++) { const cur = await gh(`/contents/${path}?ref=main`); let val = null, sha;
    if (cur.ok) { const j = await cur.json(); sha = j.sha; try { val = JSON.parse(unb64(j.content)); } catch { throw new Error(`تعذّرت قراءة ${path} في المستودع، فلم يُكتب شيء.`); } }
    else if (cur.status !== 404) throw new Error(`تعذّرت قراءة المستودع (GitHub ${cur.status}).`);
    const next = change(val); if (next === undefined) return false;
    const put = await gh(`/contents/${path}`, { method: 'PUT', body: JSON.stringify({ message: typeof message === 'function' ? message() : message, branch: 'main', ...(sha ? { sha } : {}), content: b64(typeof next === 'string' ? next : JSON.stringify(next, null, 1) + '\n') }) });
    if (put.ok) return true;
    if (put.status !== 409 && put.status !== 422) throw new Error(`تعذّرت الكتابة في المستودع (GitHub ${put.status}).`);
    await sleep(500 * (i + 1)); }
  throw new Error('تغيّر الملف في المستودع أثناء الكتابة مرات متتالية. حاول بعد قليل.'); }

// ---------- النافذة: data-keys-open في أي صفحة يفتحها، وopenKeys(need, msg) من الكود حين ينقص مفتاح
const CSS = `#gkeys{--sa:var(--c1,var(--acc,var(--cel,#7fd4ff)));box-sizing:border-box;width:min(580px,calc(100vw - 20px));max-height:min(92dvh,820px);margin:auto;padding:0;border:1px solid color-mix(in srgb,var(--sa) 45%,#000);border-radius:16px;background:#12131f;color:#f1eef8;overflow:hidden;font-size:1rem;line-height:1.75;text-align:start}
#gkeys::backdrop{background:rgba(3,3,8,.74)}
#gkeys *{box-sizing:border-box}
#gkeys .gk{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;margin:0;padding:22px clamp(14px,4vw,26px);max-height:inherit;overflow-y:auto}
#gkeys h2{margin:0;padding-inline-end:48px;font-size:1.45rem;line-height:1.35;font-weight:700;color:#fff}
#gkeys h3{margin:4px 0 0;font-size:1.05rem;color:#fff}
#gkeys p,#gkeys ol{margin:0}#gkeys ol{padding-inline-start:20px;font-size:.92rem;color:#cfcbe0}
#gkeys bdi{white-space:nowrap}
#gkeys a{color:var(--sa)}
#gkeys .gk-dim{color:#aaa6bf;font-size:.9rem}
#gkeys .gk-msg{padding:10px 12px;border-radius:10px;border:1px solid #6a4a20;background:#241a0c;color:#ffe2b0;font-size:.95rem}
#gkeys .gk-msg:empty{display:none}
#gkeys .gk-st{font-size:.9rem;font-weight:700}#gkeys .gk-st[data-ok="1"]{color:#86d6b6}#gkeys .gk-st[data-ok="0"]{color:#ff9d8a}#gkeys .gk-st:empty{display:none}
#gkeys label{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;font-size:.92rem;color:#d6d2e6}
#gkeys input{width:100%;min-width:0;height:46px;margin:0;padding:10px 12px;border-radius:10px;border:1px solid #3d3b55;background:#1b1b2b;color:#fff;font:inherit;font-size:.9rem;direction:ltr;text-align:left}
#gkeys :is(input,button,a):focus-visible{outline:2px solid var(--sa);outline-offset:2px}
#gkeys button{font:inherit;cursor:pointer;min-height:46px;padding:8px 18px;border-radius:10px;font-weight:700;border:1px solid var(--sa);background:var(--sa);color:#0d0f1f}
#gkeys .gk-acts{display:flex;flex-wrap:wrap;gap:10px}
#gkeys button.gk-quiet{background:transparent;color:#f1eef8;border-color:#4a4866}
#gkeys button.gk-x{position:absolute;top:10px;inset-inline-end:10px;min-height:0;width:44px;height:44px;padding:0;border-radius:50%;background:#1d1d2d;color:#f1eef8;border-color:#3d3b55;font-size:1.1rem;line-height:1}
#gkeys .gk-sec{display:grid;gap:8px;padding:14px;border:1px solid #2c2b42;border-radius:12px;background:#171727}
#gkeys .gk-sec[data-need]{border-color:var(--sa)}
#gkeys [hidden]{display:none}`;
let dlg = null;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function build() {
  document.head.insertAdjacentHTML('beforeend', `<style>${CSS}</style>`);
  document.body.insertAdjacentHTML('beforeend', `<dialog id="gkeys" aria-labelledby="gkeys-h"><div class="gk">
    <button type="button" class="gk-x" data-gk="close" aria-label="إغلاق">✕</button>
    <h2 id="gkeys-h">مفاتيح الموقع</h2>
    <p class="gk-msg" data-gk="msg" role="alert"></p>
    <p class="gk-dim">التصفح لا يحتاج شيئاً. هذان للإضافة والاستيراد والبحث، ويُحفظان في هذا المتصفح وحده، فتلصقهما مرة في كل جهاز تضيف منه.</p>
    <section class="gk-sec" data-gk="gh-sec"><h3>رمز <bdi dir="ltr">GitHub</bdi></h3>
      <p class="gk-dim">به تُكتب أعمالك في مستودع الموقع، فيبنيها من جديد وتظهر بمعلوماتها كاملة بعد دقائق.</p>
      <ol><li>افتح <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">صفحة الرموز الجديدة</a>.</li><li>في <bdi dir="ltr">Repository access</bdi> اختر <bdi dir="ltr">Only select repositories</bdi> ثم مستودع الموقع.</li>
        <li>في <bdi dir="ltr">Permissions</bdi> اجعل <bdi dir="ltr">Contents</bdi> على <bdi dir="ltr">Read and write</bdi>، ثم أنشئ الرمز وانسخه.</li></ol>
      <label>الرمز<input data-gk="gh" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
      <label>المستودع<input data-gk="repo" type="text" autocomplete="off" spellcheck="false" placeholder="owner/repo"></label>
      <p class="gk-st" data-gk="gh-st"></p></section>
    <section class="gk-sec" data-gk="tmdb-sec"><h3>مفتاح <bdi dir="ltr">TMDB</bdi></h3>
      <p class="gk-dim">به تبحث عن الأفلام وتطّلع على بطاقاتها، ويُطابَق ما تستورده من <bdi dir="ltr">IMDb</bdi> و<bdi dir="ltr">Letterboxd</bdi>.</p>
      <ol><li>من <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">إعدادات الواجهة في TMDB</a> انسخ <bdi dir="ltr">API Key</bdi> أو <bdi dir="ltr">API Read Access Token</bdi>.</li></ol>
      <label>المفتاح<input data-gk="tmdb" type="password" autocomplete="off" spellcheck="false"></label>
      <p class="gk-st" data-gk="tmdb-st"></p></section>
    <div class="gk-acts"><button type="button" data-gk="save">احفظ وتحقّق</button><button type="button" class="gk-quiet" data-gk="forget">امسحهما من هذا الجهاز</button></div>
  </div></dialog>`);
  dlg = document.getElementById('gkeys');
  dlg.addEventListener('click', e => { const b = e.target.closest('[data-gk]'); if (e.target === dlg) return dlg.close(); if (!b) return;
    if (b.dataset.gk === 'close') dlg.close(); else if (b.dataset.gk === 'save') save(); else if (b.dataset.gk === 'forget') { ls.set(K.gh, ''); ls.set(K.tmdb, ''); fill(); status('gh', ''); status('tmdb', ''); done({ gh: false, tmdb: false }); } });
  dlg.addEventListener('close', () => { clearTimeout(closeT); cont = null; needing = ''; });
  dlg.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); save(); } });
}
const q = k => dlg.querySelector(`[data-gk="${k}"]`);
const status = (what, text, ok) => { const el = q(what + '-st'); el.textContent = text; el.dataset.ok = ok ? '1' : '0'; };
async function fill() { q('gh').value = ''; q('tmdb').value = ''; q('gh').placeholder = ghToken() ? 'محفوظ على هذا الجهاز' : 'github_pat_…'; q('tmdb').placeholder = tmdbKey() ? 'محفوظ على هذا الجهاز' : '';
  q('repo').value = await repoOf(); }
// يحفظ ما كُتب ويتحقق منه: الرمز بقراءة المستودع وصلاحية الكتابة عليه، والمفتاح بطلب صغير من TMDB
async function save() { const g = q('gh').value.trim(), t = q('tmdb').value.trim(), repo = q('repo').value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) { status('gh', 'اكتب المستودع بالصيغة owner/repo.', false); return; }
  if (repo && repo !== await builtRepo() && repo !== fromPages()) ls.set(K.repo, repo); else ls.set(K.repo, '');
  if (g) ls.set(K.gh, g); if (t) ls.set(K.tmdb, t); fill();
  const checks = [];
  if (ghToken()) checks.push(['gh', (async () => { status('gh', 'يُتحقق…', true); try { const r = await gh(''); const j = await r.json().catch(() => ({}));
      if (!r.ok) status('gh', r.status === 404 ? 'المستودع غير موجود، أو الرمز لا يصل إليه.' : `GitHub ${r.status}`, false); else if (!j.permissions?.push) status('gh', 'الرمز يقرأ المستودع ولا يكتب فيه: اجعل Contents على Read and write.', false); else { status('gh', `يعمل: يكتب في ${j.full_name}.`, true); return true; } }
    catch (e) { if (e.status === 401) forgetBad('gh'); status('gh', e.message, false); } return false; })()]);
  if (tmdbKey()) checks.push(['tmdb', (async () => { status('tmdb', 'يُتحقق…', true); try { await tmdb('/configuration'); status('tmdb', 'يعمل.', true); return true; } catch (e) { if (e.status === 401) forgetBad('tmdb'); status('tmdb', e.message, false); return false; } })()]);
  const res = {}; await Promise.all(checks.map(([k, c]) => c.then(ok => { res[k] = ok; })));
  // ما فُتحت النافذة من أجله صار يعمل: تُغلق بعد لحظة يُرى فيها «يعمل»، ويُكمل ما طُلب وحده (وإن احتاج مفتاحاً آخر فتحها له فلا تُغلق)
  if (needing && res[needing]) closeT = setTimeout(() => dlg.open && dlg.close(), 900);
  done(res); }
// res: لكل مفتاح فُحص هل يعمل. يصل إلى ما فتح النافذة (cont)، وإلى الصفحة كلها بحدث keys تعيد به رسم ما يتعلق بالمفاتيح
// مفتاح رفضه صاحبه (401) لا يُبقى: تعود الخانة فارغة تنتظر غيره
const forgetBad = k => { ls.set(K[k], ''); fill(); };
function done(res) { const c = cont; c?.(res); document.dispatchEvent(new CustomEvent('keys', { detail: res })); }
let cont = null, needing = '', closeT = 0;
// needWhat: المفتاح الذي ينقص ('gh' أو 'tmdb')، وmsg سببه، وthen(res) ما يُكمَل بعد الحفظ (يُكمل حين res[needWhat])
export function openKeys(needWhat = '', msg = '', then = null) { if (!dlg) build(); clearTimeout(closeT); cont = then; needing = needWhat; fill();
  q('msg').textContent = msg || ''; q('gh-sec').toggleAttribute('data-need', needWhat === 'gh'); q('tmdb-sec').toggleAttribute('data-need', needWhat === 'tmdb');
  status('gh', ''); status('tmdb', ''); if (!dlg.open) dlg.showModal(); (needWhat === 'tmdb' ? q('tmdb') : q('gh')).focus(); }
if (typeof document !== 'undefined') document.addEventListener('click', e => { const b = e.target.closest('[data-keys-open]'); if (b) { e.preventDefault(); openKeys(); } });
