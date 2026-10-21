/* Lahza Realm core: pure game rules (no DOM). Shared by the realm UI and tests. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  root.LZRCore = m;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var VERSION = 1;
  var MAP = 72; // tiles per side
  var PLOT_GRID = 4; // plots per city side
  var VOX = 16; // voxel plot size (x,z) and max height

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  /* ---------- levels ---------- */
  function xpForLevel(level) {
    return Math.floor(100 * Math.pow(level, 1.5));
  }
  function levelInfo(xp) {
    var level = 1, rest = Math.max(0, xp | 0);
    while (rest >= xpForLevel(level)) {
      rest -= xpForLevel(level);
      level++;
    }
    return { level: level, into: rest, need: xpForLevel(level) };
  }

  /* ---------- world ---------- */
  var BASE_COUNTRIES = [
    { name: "مملكة النخيل", color: "#7fbf5a", biome: "grass" },
    { name: "جمهورية الرمال", color: "#e0b56a", biome: "sand" },
    { name: "جزر الثلج", color: "#cfe3ee", biome: "snow" },
    { name: "وادي الأرز", color: "#4f9d6b", biome: "forest" }
  ];
  var CITY_NAMES = ["المرسى", "النور", "السلام", "القمر", "الياسمين", "الواحة", "الفجر", "النجمة", "البحيرة", "الريح", "الضياء", "الربيع"];

  function baseWorldDef(seed) {
    var r = rng(seed);
    var centers = [[22, 22], [50, 22], [50, 50], [22, 50]];
    return BASE_COUNTRIES.map(function (c, i) {
      return {
        id: "c" + i,
        name: c.name,
        color: c.color,
        biome: c.biome,
        cx: centers[i][0] + Math.floor(r() * 5) - 2,
        cz: centers[i][1] + Math.floor(r() * 5) - 2,
        rad: 12 + Math.floor(r() * 3),
        cities: [0, 1, 2].map(function (k) {
          var ang = (k / 3) * Math.PI * 2 + r();
          return { id: "c" + i + "t" + k, name: CITY_NAMES[(i * 3 + k) % CITY_NAMES.length], ox: Math.round(Math.cos(ang) * 6), oz: Math.round(Math.sin(ang) * 6) };
        })
      };
    });
  }

  function buildWorld(state) {
    var defs = baseWorldDef(state.seed).concat(state.world.custom || []);
    var tiles = new Array(MAP * MAP);
    var n = rng(state.seed ^ 0x9e37);
    var noise = [];
    for (var i = 0; i < MAP * MAP; i++) noise.push(n());
    function smooth(x, z) {
      var s = 0, c = 0;
      for (var dx = -2; dx <= 2; dx++)
        for (var dz = -2; dz <= 2; dz++) {
          var xx = x + dx, zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= MAP || zz >= MAP) continue;
          s += noise[zz * MAP + xx];
          c++;
        }
      return s / c;
    }
    for (var z = 0; z < MAP; z++)
      for (var x = 0; x < MAP; x++) {
        var best = null, bd = 1e9;
        for (var k = 0; k < defs.length; k++) {
          var d = defs[k];
          var dist = Math.hypot(x - d.cx, z - d.cz) / d.rad;
          if (dist < bd) { bd = dist; best = d; }
        }
        var nv = smooth(x, z);
        var land = bd < 0.85 + (nv - 0.5) * 0.9;
        var type = "water", h = 0;
        if (land) {
          type = bd > 0.78 ? "beach" : nv > 0.62 && bd > 0.35 ? "mountain" : best.biome;
          h = type === "mountain" ? 1.6 + (nv - 0.62) * 8 : type === "beach" ? 0.25 : 0.5 + nv * 0.25;
        }
        tiles[z * MAP + x] = { x: x, z: z, type: type, h: h, country: land ? best.id : null, city: null, plot: null };
      }
    var countries = defs.map(function (d) {
      var cities = d.cities.map(function (c) {
        var cx = d.cx + c.ox, cz = d.cz + c.oz;
        var plots = [];
        var pr = rng(hash(c.id) ^ state.seed);
        for (var pz = 0; pz < PLOT_GRID; pz++)
          for (var px = 0; px < PLOT_GRID; px++) {
            var tx = cx + px - 1, tz = cz + pz - 1;
            if (tx < 0 || tz < 0 || tx >= MAP || tz >= MAP) continue;
            var t = tiles[tz * MAP + tx];
            t.type = "city"; t.h = 0.55; t.country = d.id; t.city = c.id;
            var id = c.id + ":" + (pz * PLOT_GRID + px);
            var npc = pr() < 0.55;
            var plot = { id: id, x: tx, z: tz, city: c.id, country: d.id, npc: npc, floors: npc ? 1 + Math.floor(pr() * 5) : 0, hue: pr() };
            t.plot = id;
            plots.push(plot);
          }
        return { id: c.id, name: c.name, x: cx, z: cz, country: d.id, plots: plots };
      });
      return { id: d.id, name: d.name, color: d.color, biome: d.biome, cx: d.cx, cz: d.cz, rad: d.rad, custom: !!d.custom, cities: cities, stats: statsFor(state, d.id) };
    });
    return { size: MAP, tiles: tiles, countries: countries };
  }

  function statsFor(state, id) {
    var s = state.world.stats[id];
    if (!s) s = state.world.stats[id] = { prosperity: 50, safety: 50, happiness: 50 };
    return s;
  }

  function findFreeSpot(state) {
    var defs = baseWorldDef(state.seed).concat(state.world.custom || []);
    var r = rng(hash("spot" + defs.length) ^ state.seed);
    for (var tries = 0; tries < 400; tries++) {
      var x = 8 + Math.floor(r() * (MAP - 16)), z = 8 + Math.floor(r() * (MAP - 16));
      var ok = defs.every(function (d) { return Math.hypot(x - d.cx, z - d.cz) > d.rad + 9; });
      if (ok) return { x: x, z: z };
    }
    return null;
  }

  var COUNTRY_COST = 1500, CITY_COST = 400;
  function createCountry(state, name, color) {
    name = String(name || "").trim().slice(0, 24);
    if (!name) return { ok: false, err: "اكتب اسم الدولة" };
    if (levelInfo(state.xp).level < 3) return { ok: false, err: "تحتاج المستوى 3 لإنشاء دولة" };
    if (state.coins < COUNTRY_COST) return { ok: false, err: "تحتاج " + COUNTRY_COST + " عملة" };
    var spot = findFreeSpot(state);
    if (!spot) return { ok: false, err: "لا توجد مساحة فارغة في المحيط" };
    var id = "u" + Date.now().toString(36);
    state.coins -= COUNTRY_COST;
    state.world.custom.push({ id: id, name: name, color: color || "#8fd0a0", biome: "grass", cx: spot.x, cz: spot.z, rad: 7, custom: true, cities: [{ id: id + "t0", name: "عاصمة " + name, ox: 0, oz: 0 }] });
    state.world.stats[id] = { prosperity: 40, safety: 60, happiness: 60 };
    return { ok: true, id: id };
  }
  function createCity(state, countryId, name) {
    var c = (state.world.custom || []).filter(function (d) { return d.id === countryId; })[0];
    if (!c) return { ok: false, err: "يمكنك إضافة مدن لدولك فقط" };
    name = String(name || "").trim().slice(0, 24);
    if (!name) return { ok: false, err: "اكتب اسم المدينة" };
    if (c.cities.length >= 4) return { ok: false, err: "الحد الأقصى 4 مدن لكل دولة" };
    if (state.coins < CITY_COST) return { ok: false, err: "تحتاج " + CITY_COST + " عملة" };
    var offs = [[0, 0], [5, 0], [-5, 0], [0, 5]];
    var o = offs[c.cities.length];
    state.coins -= CITY_COST;
    c.cities.push({ id: c.id + "t" + c.cities.length, name: name, ox: o[0], oz: o[1] });
    c.rad = Math.max(c.rad, 9);
    return { ok: true };
  }

  /* ---------- economy ---------- */
  function plotPrice(plot, stats) {
    var p = stats ? stats.prosperity : 50;
    return Math.round(150 * (0.6 + p / 100) / 10) * 10;
  }
  function buyPlot(state, plot, stats) {
    if (plot.npc) return { ok: false, err: "هذه الأرض مملوكة لسكان المدينة" };
    if (state.props[plot.id]) return { ok: false, err: "تملكها بالفعل" };
    var price = plotPrice(plot, stats);
    if (state.coins < price) return { ok: false, err: "تحتاج " + price + " عملة" };
    state.coins -= price;
    state.props[plot.id] = { t: Date.now(), last: Date.now() };
    return { ok: true, price: price };
  }
  var INCOME_CAP_H = 12;
  function plotRate(state, plotId) {
    var b = state.plots[plotId] ? state.plots[plotId].length : 0;
    return 6 + Math.floor(b / 15); // coins per hour
  }
  function pendingIncome(state, now) {
    var total = 0;
    Object.keys(state.props).forEach(function (id) {
      var h = Math.min(INCOME_CAP_H, (now - state.props[id].last) / 3600000);
      total += Math.floor(h * plotRate(state, id));
    });
    return total;
  }
  function collectIncome(state, now) {
    var c = pendingIncome(state, now);
    Object.keys(state.props).forEach(function (id) { state.props[id].last = now; });
    state.coins += c;
    return c;
  }

  function dayKey(now) {
    var d = new Date(now);
    return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate();
  }
  function claimDaily(state, now) {
    var today = dayKey(now);
    if (state.daily.last === today) return { ok: false, err: "استلمت مكافأة اليوم" };
    var yest = dayKey(now - 86400000);
    state.daily.streak = state.daily.last === yest ? state.daily.streak + 1 : 1;
    state.daily.last = today;
    var coins = 50 + 25 * Math.min(state.daily.streak - 1, 6);
    var gems = state.daily.streak % 7 === 0 ? 5 : 0;
    state.coins += coins;
    state.gems += gems;
    state.energy = Math.max(state.energy, 10);
    return { ok: true, coins: coins, gems: gems, streak: state.daily.streak };
  }

  /* ---------- quests ---------- */
  var QUEST_POOL = [
    { id: "place", type: "place_blocks", n: 40, label: "ضع 40 حجراً في أراضيك", coins: 80, xp: 60 },
    { id: "visit", type: "visit_city", n: 3, label: "زر 3 مدن مختلفة", coins: 60, xp: 50 },
    { id: "talk", type: "talk_npc", n: 3, label: "تحدّث مع 3 من سكان العالم", coins: 50, xp: 40 },
    { id: "game", type: "play_game", n: 2, label: "العب لعبتين", coins: 70, xp: 60 },
    { id: "quiz", type: "win_quiz", n: 1, label: "اربح مسابقة مباشرة", coins: 120, xp: 90 },
    { id: "buy", type: "buy_item", n: 1, label: "اشترِ شيئاً من المتجر", coins: 40, xp: 30 },
    { id: "income", type: "collect_income", n: 1, label: "اجمع دخل ممتلكاتك", coins: 40, xp: 30 },
    { id: "event", type: "choose_event", n: 1, label: "اتخذ قراراً في حدث عالمي", coins: 90, xp: 70 },
    { id: "walk", type: "walk", n: 20, label: "تنقّل 20 مرة على الخريطة", coins: 50, xp: 40 }
  ];
  function ensureQuests(state, now) {
    var today = dayKey(now);
    if (state.quests.day === today) return state.quests.list;
    var r = rng(hash(today + state.seed));
    var pool = QUEST_POOL.slice();
    var list = [];
    while (list.length < 4) {
      var q = pool.splice(Math.floor(r() * pool.length), 1)[0];
      list.push({ id: q.id, prog: 0, claimed: false });
    }
    state.quests = { day: today, list: list };
    return list;
  }
  function questDef(id) { return QUEST_POOL.filter(function (q) { return q.id === id; })[0]; }
  function progress(state, type, n, now) {
    ensureQuests(state, now || Date.now());
    var changed = [];
    state.quests.list.forEach(function (q) {
      var d = questDef(q.id);
      if (d.type === type && q.prog < d.n) {
        q.prog = Math.min(d.n, q.prog + (n || 1));
        if (q.prog >= d.n) changed.push(d);
      }
    });
    state.stats[type] = (state.stats[type] || 0) + (n || 1);
    return changed;
  }
  function claimQuest(state, id) {
    var q = state.quests.list.filter(function (x) { return x.id === id; })[0];
    if (!q) return { ok: false, err: "مهمة غير موجودة" };
    var d = questDef(id);
    if (q.claimed) return { ok: false, err: "استلمتها" };
    if (q.prog < d.n) return { ok: false, err: "لم تكتمل بعد" };
    q.claimed = true;
    state.coins += d.coins;
    var lv = addXp(state, d.xp);
    return { ok: true, coins: d.coins, xp: d.xp, levelUp: lv };
  }
  function addXp(state, n) {
    var before = levelInfo(state.xp).level;
    state.xp += n;
    var after = levelInfo(state.xp).level;
    if (after > before) {
      state.gems += 3 * (after - before);
      state.energy = Math.min(20, state.energy + 5);
      return after;
    }
    return 0;
  }

  /* ---------- shop ---------- */
  var SHOP = [
    { id: "b_gold", kind: "block", block: 9, qty: 20, label: "ذهب ×20", icon: "🟨", coins: 120 },
    { id: "b_neon", kind: "block", block: 10, qty: 20, label: "نيون ×20", icon: "🟪", coins: 150 },
    { id: "b_glass", kind: "block", block: 6, qty: 30, label: "زجاج ×30", icon: "🔷", coins: 90 },
    { id: "b_marble", kind: "block", block: 14, qty: 30, label: "رخام ×30", icon: "⬜", coins: 110 },
    { id: "b_lamp", kind: "block", block: 15, qty: 10, label: "فانوس ×10", icon: "🏮", coins: 100 },
    { id: "energy", kind: "energy", qty: 5, label: "طاقة +5", icon: "⚡", gems: 2 },
    { id: "hat_crown", kind: "hat", hat: "crown", label: "تاج ذهبي", icon: "👑", gems: 8 },
    { id: "hat_cap", kind: "hat", hat: "cap", label: "قبعة رياضية", icon: "🧢", coins: 200 },
    { id: "skin_teal", kind: "skin", color: "#2bb3a3", label: "زي فيروزي", icon: "🟢", coins: 150 },
    { id: "skin_red", kind: "skin", color: "#e0554f", label: "زي أحمر", icon: "🔴", coins: 150 },
    { id: "skin_gold", kind: "skin", color: "#e8b54a", label: "زي ذهبي", icon: "🟡", gems: 5 },
    { id: "gem_pack", kind: "gems", qty: 3, label: "3 جواهر", icon: "💎", coins: 600 }
  ];
  function buy(state, itemId) {
    var it = SHOP.filter(function (s) { return s.id === itemId; })[0];
    if (!it) return { ok: false, err: "غير موجود" };
    if ((it.kind === "hat" && state.owned.indexOf(it.id) >= 0) || (it.kind === "skin" && state.owned.indexOf(it.id) >= 0)) {
      if (it.kind === "hat") state.avatar.hat = it.hat; else state.avatar.color = it.color;
      return { ok: true, equipped: true };
    }
    if (it.coins && state.coins < it.coins) return { ok: false, err: "عملات غير كافية" };
    if (it.gems && state.gems < it.gems) return { ok: false, err: "جواهر غير كافية" };
    state.coins -= it.coins || 0;
    state.gems -= it.gems || 0;
    if (it.kind === "block") state.inv[it.block] = (state.inv[it.block] || 0) + it.qty;
    else if (it.kind === "energy") state.energy = Math.min(30, state.energy + it.qty);
    else if (it.kind === "gems") state.gems += it.qty;
    else { state.owned.push(it.id); if (it.kind === "hat") state.avatar.hat = it.hat; else state.avatar.color = it.color; }
    return { ok: true, item: it };
  }

  /* ---------- dynamic events ---------- */
  var EVENTS = [
    { id: "drought", title: "جفاف في {c}", text: "الآبار تجف والمحاصيل تذبل. ماذا تفعل؟", fx: "dry",
      a: { label: "تبرّع ببناء آبار (100 عملة)", cost: 100, eff: { prosperity: 8, happiness: 10 }, xp: 60 },
      b: { label: "استغل الأزمة ورفع الأسعار", gain: 150, eff: { happiness: -12, safety: -5 }, xp: 20 } },
    { id: "festival", title: "مهرجان في {c}", text: "السكان يحضّرون لمهرجان كبير.", fx: "fireworks",
      a: { label: "موّل الألعاب النارية (80 عملة)", cost: 80, eff: { happiness: 14, prosperity: 4 }, xp: 70 },
      b: { label: "افتح كشكاً وبع للزوار", gain: 90, eff: { prosperity: 6 }, xp: 40 } },
    { id: "storm", title: "عاصفة تضرب {c}", text: "رياح قوية وأمطار غزيرة على المدن.", fx: "rain",
      a: { label: "ساعد في الإنقاذ (طاقة 2)", energy: 2, eff: { safety: 10, happiness: 6 }, xp: 80 },
      b: { label: "احمِ ممتلكاتك فقط", eff: { safety: -6 }, xp: 15 } },
    { id: "boom", title: "طفرة تجارية في {c}", text: "تجار من الخارج يريدون الاستثمار.", fx: "gold",
      a: { label: "استثمر معهم (150 عملة)", cost: 150, eff: { prosperity: 15 }, xp: 60, gainLater: 260 },
      b: { label: "ارفض لحماية السوق المحلي", eff: { safety: 5, prosperity: -3 }, xp: 25 } },
    { id: "thieves", title: "لصوص في {c}", text: "عصابة تسرق المتاجر ليلاً.", fx: "night",
      a: { label: "نظّم دورية ليلية (طاقة 3)", energy: 3, eff: { safety: 14 }, xp: 90 },
      b: { label: "تجاهل الأمر", eff: { safety: -10, prosperity: -5 }, xp: 5 } }
  ];
  function rollEvent(state, world, now) {
    var r = rng(hash("ev" + Math.floor(now / 600000)) ^ state.seed);
    var ev = EVENTS[Math.floor(r() * EVENTS.length)];
    var c = world.countries[Math.floor(r() * world.countries.length)];
    return { key: ev.id + ":" + c.id + ":" + Math.floor(now / 600000), id: ev.id, country: c.id, title: ev.title.replace("{c}", c.name), text: ev.text, fx: ev.fx, a: ev.a, b: ev.b };
  }
  function resolveEvent(state, ev, which) {
    var opt = ev[which];
    if (!opt) return { ok: false, err: "خيار غير صالح" };
    if (state.events.done.indexOf(ev.key) >= 0) return { ok: false, err: "اتخذت قرارك في هذا الحدث" };
    if (opt.cost && state.coins < opt.cost) return { ok: false, err: "عملات غير كافية" };
    if (opt.energy && state.energy < opt.energy) return { ok: false, err: "طاقة غير كافية" };
    state.coins -= opt.cost || 0;
    state.energy -= opt.energy || 0;
    state.coins += (opt.gain || 0) + (opt.gainLater || 0);
    var s = statsFor(state, ev.country);
    Object.keys(opt.eff).forEach(function (k) { s[k] = clamp(s[k] + opt.eff[k], 0, 100); });
    var lv = addXp(state, opt.xp || 0);
    state.events.done.push(ev.key);
    if (state.events.done.length > 60) state.events.done.shift();
    state.events.log.unshift({ t: Date.now(), title: ev.title, choice: opt.label, eff: opt.eff });
    if (state.events.log.length > 30) state.events.log.pop();
    return { ok: true, levelUp: lv, eff: opt.eff };
  }

  /* ---------- state ---------- */
  function newState(name) {
    return {
      v: VERSION, t: Date.now(), seed: 20261021, name: name || "مستكشف",
      avatar: { color: "#4f8cff", hat: "" }, xp: 0, coins: 300, gems: 5, energy: 10,
      daily: { last: "", streak: 0 }, quests: { day: "", list: [] }, inv: {}, owned: [],
      props: {}, plots: {}, world: { custom: [], stats: {} }, events: { done: [], log: [] },
      stats: {}, pos: { x: 22, z: 22 }, met: {}
    };
  }
  function migrate(s) {
    var d = newState();
    if (!s || typeof s !== "object") return d;
    Object.keys(d).forEach(function (k) { if (s[k] === undefined) s[k] = d[k]; });
    s.world.custom = s.world.custom || [];
    s.world.stats = s.world.stats || {};
    return s;
  }
  /* compact voxel encoding: each block = x,y,z,type as 4 chars base36 (x,z<16,y<16,type<36) */
  function encodeBlocks(list) {
    return list.map(function (b) { return b[0].toString(16) + b[1].toString(16) + b[2].toString(16) + b[3].toString(36); }).join("");
  }
  function decodeBlocks(str) {
    var out = [];
    if (!str) return out;
    for (var i = 0; i + 3 < str.length; i += 4)
      out.push([parseInt(str[i], 16), parseInt(str[i + 1], 16), parseInt(str[i + 2], 16), parseInt(str[i + 3], 36)]);
    return out;
  }

  return {
    VERSION: VERSION, MAP: MAP, VOX: VOX, rng: rng, hash: hash, clamp: clamp,
    xpForLevel: xpForLevel, levelInfo: levelInfo, addXp: addXp,
    buildWorld: buildWorld, createCountry: createCountry, createCity: createCity, COUNTRY_COST: COUNTRY_COST, CITY_COST: CITY_COST,
    plotPrice: plotPrice, buyPlot: buyPlot, plotRate: plotRate, pendingIncome: pendingIncome, collectIncome: collectIncome, INCOME_CAP_H: INCOME_CAP_H,
    dayKey: dayKey, claimDaily: claimDaily,
    QUEST_POOL: QUEST_POOL, ensureQuests: ensureQuests, questDef: questDef, progress: progress, claimQuest: claimQuest,
    SHOP: SHOP, buy: buy, EVENTS: EVENTS, rollEvent: rollEvent, resolveEvent: resolveEvent,
    newState: newState, migrate: migrate, encodeBlocks: encodeBlocks, decodeBlocks: decodeBlocks
  };
});
