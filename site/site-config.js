// إعدادات عامة يكتبها صاحب الموقع مرة واحدة في مستودعه (data/site.json)، فتصل كل أجهزته بلا لصق في كل جهاز. لا أسرار فيها:
//   accounts: رابط خادم «حساباتي» على Netlify (مثل https://my-portals-accounts.netlify.app)، تسحب منه «ألعابي» من Steam وPlayStation وXbox.
//   firebase: إعداد مشروع Firebase للمزامنة بين الأجهزة (firebaseConfig كما يعطيه Firebase، وهو عام بطبيعته؛ والحماية في قواعد القاعدة).
// تُقرأ من المستودع العام مباشرة (raw.githubusercontent.com)، فلا يلزم بناء ليصل تعديلها (قد تتأخر دقائق قليلة)، وتُحفظ للجلسة.
import { repoOf } from './keys.js?v=__BUILD__';
const KEY = 'portal.site';
let got = null;
export function siteConfig() {
  return got ??= (async () => {
    try { const s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') return s; } catch {}
    let c = {};
    try { const repo = await repoOf();
      if (/^[\w.-]+\/[\w.-]+$/.test(repo)) { const r = await fetch(`https://raw.githubusercontent.com/${repo}/main/data/site.json`, { cache: 'no-cache', signal: AbortSignal.timeout(10000) });
        if (r.ok) { const j = await r.json(); if (j && typeof j === 'object' && !Array.isArray(j)) c = j; } } }
    catch { got = null; return {}; }   // تعذّر الاتصال: لا يُحفظ، فيُعاد في الطلب القادم
    if (Object.keys(c).length) try { sessionStorage.setItem(KEY, JSON.stringify(c)); } catch {}
    else got = null;   // لم يُكتب بعد: يُسأل عنه من جديد في الطلب القادم (حين تُفتح «حساباتي» ثانية مثلاً)، فلا يلزم تحديث الصفحة
    return c; })();
}
// رابط خادم «حساباتي» إن كان صالحاً (https فقط، بلا مسار)
export async function accountsServer() { const u = String((await siteConfig()).accounts || '').trim();
  try { const x = new URL(u); return x.protocol === 'https:' ? x.origin : ''; } catch { return ''; } }
