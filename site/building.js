// بعد كل إيداع في قوائم المستودع (إضافة أو استيراد) يبني GitHub الموقع من جديد في دقائق. تبقى أسفل الصفحة لافتة بما يُنتظر، وتسأل الصفحة كل
// 30 ثانية عن ملف بياناتها حتى يصل بناء أحدث من الذي كان حين الإيداع (base: وقت بنائه)، فتعرض «اعرضه» (تحديث الصفحة). البناء الذي بدأ قبل
// الإيداع يلغيه بناء الإيداع (concurrency في سير العمل)، فأول بناء أحدث يحمل الإضافة. وإن تأخر كثيراً تقول ذلك وتدل على صفحة البناء.
const K = 'portal.wait', LATE = 25 * 60e3;
const read = () => { try { return JSON.parse(localStorage.getItem(K) || '{}') || {}; } catch { return {}; } };
const write = w => { try { localStorage.setItem(K, JSON.stringify(w)); } catch {} };
const CSS = `#gbuild{position:fixed;z-index:60;inset-inline:0;bottom:max(12px,env(safe-area-inset-bottom));width:min(560px,calc(100vw - 24px));margin:0 auto;display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:14px;
  border:1px solid color-mix(in srgb,var(--acc,var(--cel,#7fd4ff)) 45%,#000);background:rgba(14,15,30,.94);color:#f1eef8;font-size:.92rem;line-height:1.6;box-shadow:0 12px 34px -12px rgba(0,0,0,.7)}
#gbuild[hidden]{display:none}
#gbuild .gb-dot{flex:none;width:12px;height:12px;border-radius:50%;border:2px solid var(--acc,var(--cel,#7fd4ff));border-top-color:transparent;animation:gb-spin 1s linear infinite}
#gbuild[data-st=ready] .gb-dot{animation:none;border-color:#86d6b6;background:#86d6b6}#gbuild[data-st=late] .gb-dot{animation:none;border-color:#ffb36b}
#gbuild p{flex:1;margin:0}#gbuild a{color:var(--acc,var(--cel,#7fd4ff))}
#gbuild button{flex:none;min-height:44px;padding:6px 14px;border-radius:10px;border:1px solid var(--acc,var(--cel,#7fd4ff));background:var(--acc,var(--cel,#7fd4ff));color:#0d0f1f;font:inherit;font-weight:700;cursor:pointer}
#gbuild button.gb-x{background:transparent;color:#f1eef8;border-color:#4a4866;width:44px;padding:0}
@keyframes gb-spin{to{transform:rotate(1turn)}}
@media (prefers-reduced-motion:reduce){#gbuild .gb-dot{animation:none}}`;
let bar = null, timer = 0, url = '', field = 'generatedAt', portal = '';
function paint(st, text, act = '') { if (!bar) { document.head.insertAdjacentHTML('beforeend', `<style>${CSS}</style>`); document.body.insertAdjacentHTML('beforeend', '<div id="gbuild" role="status" hidden></div>'); bar = document.getElementById('gbuild');
    bar.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.gb === 'show') location.reload(); else { const w = read(); delete w[portal]; write(w); bar.hidden = true; clearInterval(timer); } }); }
  bar.dataset.st = st; bar.innerHTML = `<span class="gb-dot" aria-hidden="true"></span><p>${text}</p>${act}<button type="button" class="gb-x" data-gb="x" aria-label="أخفِ">✕</button>`; bar.hidden = false; }
const many = n => n === 1 ? 'عمل واحد' : n === 2 ? 'عملان' : n % 100 >= 3 && n % 100 <= 10 ? `${n} أعمال` : `${n} عملاً`;
async function check() { const w = read()[portal]; if (!w) { if (bar) bar.hidden = true; clearInterval(timer); return; }
  try { const j = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()), at = Date.parse(j?.[field] || 0);
    if (at > (w.base || 0) && at > w.at - 10 * 60e3) { const all = read(); delete all[portal]; write(all); clearInterval(timer); paint('ready', 'اكتمل بناء الموقع بما أضفته.', '<button type="button" data-gb="show">اعرضه</button>'); return; } } catch {}
  if (Date.now() - w.at > LATE) paint('late', `تأخر بناء الموقع أكثر من المعتاد. <a href="https://github.com/${w.repo || ''}/actions" target="_blank" rel="noopener">صفحة البناء في GitHub</a> تقول ما جرى.`);
  else paint('wait', `يُبنى الموقع بما أضفته (${many(w.n)})، ويظهر بمعلوماته كاملة خلال دقائق.`); }
// waiting(البوابة): عدد ما ينتظر البناء فيها (0 إن لم يكن شيء)
export const waiting = name => { const w = read()[name]; return w ? w.n || 1 : 0; };
// watchBuild(البوابة، رابط ملف بياناتها، حقل وقت بنائه): عند فتح الصفحة، فإن كان بناء ينتظر عُرضت اللافتة وبدأ السؤال
export function watchBuild(name, dataUrl, at = 'generatedAt') { portal = name; url = dataUrl; field = at; if (read()[portal]) { check(); clearInterval(timer); timer = setInterval(check, 30e3); } }
// waitBuild(عدد ما أُضيف، المستودع، وقت بناء البيانات المعروضة الآن): بعد إيداع ناجح
export function waitBuild(n, repo = '', base = '') { const w = read(), had = w[portal]; w[portal] = { at: Date.now(), n: (had?.n || 0) + n, repo, base: had?.base ?? (Date.parse(base) || 0) }; write(w); check(); clearInterval(timer); timer = setInterval(check, 30e3); }
