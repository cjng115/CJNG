// ثيم كل عالم في «أنمياتي»: لون أرضيته (bg) ولوناه المميِّزان (c1 وc2) ونقش جوّه (motif) ولمسته الخاصة إن كانت له (sig).
// كل عالم يأخذ ألوانه من أغلفة أعماله
// (لون الغلاف من AniList، ac في الكتالوج) ونقشه من تصنيف أعماله. يستعمله شريط السلاسل (توهج كل عالم بلونه) والبوابة (site/anime-gate.js).
// المفتاح رقم السلسلة (أصغر أرقام أعمالها في MyAnimeList، كما في الكتالوج).
export const THEMES = {};   // لا ثيمات مصممة يدوياً في هذه النسخة: كل عالم يأخذ ألوانه من أغلفة أعماله ونقشه من تصنيفها
// نقش الجو من تصنيفات العالم، بالأولوية: أول ما يوجد منها
const MOTIF = [[['Mecha', 'Space'], 'scan'], [['Sci-Fi', 'Time Travel'], 'crystal'], [['Sports', 'Team Sports', 'Combat Sports', 'Racing'], 'rays'],
  [['Mystery', 'Detective', 'Psychological', 'Suspense'], 'rain'], [['Horror', 'Gore', 'Vampire'], 'gothic'], [['Samurai', 'Historical', 'Martial Arts'], 'slash'],
  [['Romance', 'Love Polygon', 'Love Status Quo', 'Shoujo'], 'diamonds'], [['Comedy', 'Gag Humor', 'Parody'], 'halftone'], [['Music', 'Idols (Female)', 'Idols (Male)', 'Showbiz', 'Performing Arts'], 'stars'],
  [['Isekai', 'Fantasy', 'Mythology', 'Supernatural', 'Urban Fantasy', 'Mahou Shoujo'], 'embers'], [['Adventure'], 'horizon'], [['Slice of Life', 'Iyashikei', 'CGDCT'], 'sand'], [['Action', 'Shounen', 'Super Power'], 'bolts']];
// ---------- الألوان: من لون الغلاف إلى لون مميِّز فاتح يُقرأ على أرضية داكنة، وأرضية داكنة من درجته
const hsl = hex => { const n = parseInt(hex, 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0, h = !d ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h * 60, s, l]; };
const css = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
const dist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const cache = new WeakMap();
export function themeOf(w, by, genres = []) { if (cache.has(w)) return cache.get(w); let t = THEMES[w.id];
  if (!t) { const order = w.story || w.ids, head = by.get(w.head), cols = order.map(id => by.get(id)?.ac).filter(Boolean), first = head?.ac || cols[0];
    let c1 = '#7fd4ff', c2 = '#ff6f91', bg = '#0e1028';
    if (first) { const [h, s0] = hsl(first), s = Math.min(.92, Math.max(.55, s0));
      if (s0 < .14) { c1 = '#ece6da'; bg = '#0b0b0f'; } else { c1 = css(h, s, .7); bg = css(h, Math.min(.5, s0 * .7 + .1), .075); }
      const other = cols.map(hsl).filter(([hh, ss]) => ss > .25 && dist(hh, h) >= 35).sort((x, y) => dist(y[0], h) - dist(x[0], h))[0];
      c2 = other ? css(other[0], Math.min(.9, Math.max(.6, other[1])), .66) : css((h + 150) % 360, .75, .66); }
    // النقش من تصنيفات أعمال العالم كلها: الأكثر حضوراً في المجموعة الأعلى أولوية
    const count = new Map(); for (const id of order) for (const g of by.get(id)?.g || []) { const n = genres[g]; if (n) count.set(n, (count.get(n) || 0) + 1); }
    const motif = MOTIF.find(([names]) => names.some(n => count.has(n)))?.[1] || 'stars';
    t = { bg, c1, c2, motif }; }
  cache.set(w, t); return t; }
export const themeVars = t => `--bg:${t.bg};--c1:${t.c1};--c2:${t.c2}`;
