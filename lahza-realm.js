/* Lahza Realm — عالم لحظة الحي: خريطة دول ومدن، بناء حجر بحجر، شخصيات، مهام، ألعاب، متجر، أحداث، لاعبين.
   Additive module: does not touch existing app features. Rules live in lahza-realm-core.js. */
(function () {
  "use strict";
  var C = window.LZRCore;
  if (!C || window.LahzaRealm) return;
  var KEY = "lzr.v1";
  var TS = 2; // tile size in world units
  var BLOCKS = [
    { n: "عشب", c: "#6dbb4c", top: "#7fd35a" }, { n: "تراب", c: "#8a5f3c" }, { n: "حجر", c: "#8e9399" }, { n: "طوب", c: "#b5523b", brick: 1 },
    { n: "جذع", c: "#7a5530", log: 1 }, { n: "خشب", c: "#c89b5e", plank: 1 }, { n: "زجاج", c: "#bfe8ff", glass: 1, prem: 1 }, { n: "رمل", c: "#e3cf8f" },
    { n: "ماء", c: "#3a9ad9", water: 1 }, { n: "ذهب", c: "#f2c230", prem: 1, metal: 1 }, { n: "نيون", c: "#c56cff", prem: 1, glow: 1 }, { n: "أوراق", c: "#3f9a3a" },
    { n: "ثلج", c: "#f3f8fb" }, { n: "قرميد", c: "#c4473a", brick: 1 }, { n: "رخام", c: "#ece9e2", prem: 1 }, { n: "فانوس", c: "#ffcf6b", prem: 1, glow: 1 }
  ];
  var S, W, root, T, gl, sceneMap, sceneBuild, cam, raf = 0, mode = "map", opened = false;
  var mapObj = {}, buildObj = {}, labels = [], npcs = [], player = null, curEvent = null, fxObj = {};
  var camState = { tx: 44, tz: 44, dist: 46, yaw: 0.7, pitch: 0.95 };
  var bCam = { yaw: 0.8, pitch: 0.7, dist: 30 };
  var clock = { last: 0, t: 0 };
  var mobile = matchMedia("(pointer:coarse)").matches;

  /* ---------------- persistence ---------------- */
  function load() {
    try { S = C.migrate(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { S = C.newState(); }
    if (!S.inv[6] && !S.stats.starter) { S.inv[6] = 10; S.inv[15] = 4; S.stats.starter = 1; }
    try { var u = window.firebase && firebase.auth && firebase.auth().currentUser; if (u && S.name === "مستكشف") S.name = (u.displayName || "مستكشف").slice(0, 20); } catch (e) {}
  }
  var saveT = 0, cloudT = 0;
  function save() {
    S.t = Date.now();
    clearTimeout(saveT);
    saveT = setTimeout(function () { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast("⚠️ مساحة التخزين ممتلئة"); } }, 300);
    clearTimeout(cloudT);
    cloudT = setTimeout(cloudSave, 6000);
    hud();
  }
  function fbUser() { try { return window.firebase && firebase.apps && firebase.apps.length && firebase.auth().currentUser; } catch (e) { return null; } }
  function packCloud() {
    var plots = {};
    Object.keys(S.plots).forEach(function (k) { plots[k.replace(/[.:]/g, "_")] = C.encodeBlocks(S.plots[k]); });
    var meta = JSON.parse(JSON.stringify(S)); meta.plots = {};
    return { realm: JSON.stringify(meta), realmPlots: plots, realmXp: S.xp, realmLevel: C.levelInfo(S.xp).level, realmName: S.name, realmColor: S.avatar.color, realmProps: Object.keys(S.props).length, realmT: S.t };
  }
  function cloudSave() {
    var u = fbUser(); if (!u) return;
    try {
      firebase.firestore().collection("users").doc(u.uid).set(packCloud(), { merge: true })
        .then(function () { setSync("☁️ محفوظ سحابياً"); })
        .catch(function () { setSync("💾 محفوظ على الجهاز"); });
    } catch (e) {}
  }
  function cloudLoad() {
    var u = fbUser(); if (!u) { setSync("💾 محفوظ على الجهاز — سجّل دخولك للحفظ السحابي"); return Promise.resolve(); }
    return firebase.firestore().collection("users").doc(u.uid).get().then(function (d) {
      var x = d.exists && d.data();
      if (x && x.realm && (x.realmT || 0) > (S.t || 0) + 1000) {
        var s = C.migrate(JSON.parse(x.realm)); s.plots = {};
        var rp = x.realmPlots || {};
        Object.keys(s.props).concat(Object.keys(S.plots)).forEach(function (k) { var e = rp[k.replace(/[.:]/g, "_")]; if (e) s.plots[k] = C.decodeBlocks(e); });
        S = s; localStorage.setItem(KEY, JSON.stringify(S));
        W = C.buildWorld(S); if (mapObj.built) rebuildMap();
        toast("☁️ تم استرجاع عالمك من السحابة");
      }
      setSync("☁️ متزامن");
    }).catch(function () { setSync("💾 محفوظ على الجهاز"); });
  }
  function setSync(t) { var e = $("#lzr-sync"); if (e) e.textContent = t; }

  /* ---------------- dom helpers ---------------- */
  function $(s) { return root ? root.querySelector(s) : null; }
  function h(tag, attrs, html) { var e = document.createElement(tag); if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var toastT = 0;
  function toast(msg) { var t = $("#lzr-toast"); if (!t) return; t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("on"); }, 2600); }
  function reward(r, prefix) {
    if (!r || !r.ok) { if (r && r.err) toast("⚠️ " + r.err); return false; }
    var parts = []; if (r.coins) parts.push("+" + r.coins + " 🪙"); if (r.xp) parts.push("+" + r.xp + " XP"); if (r.gems) parts.push("+" + r.gems + " 💎");
    toast((prefix || "✅") + " " + parts.join("  "));
    if (r.levelUp) levelUp(r.levelUp);
    save(); return true;
  }
  function levelUp(lv) {
    var o = h("div", { class: "lzr-lvup" }, "<b>⭐ المستوى " + lv + "</b><span>+جواهر وطاقة</span>");
    root.appendChild(o); setTimeout(function () { o.remove(); }, 2600);
  }
  function quest(type, n) {
    var done = C.progress(S, type, n || 1, Date.now());
    done.forEach(function (d) { toast("🎯 مهمة مكتملة: " + d.label); });
    if (done.length) badge();
  }
  function gainXp(n) { var lv = C.addXp(S, n); if (lv) levelUp(lv); }

  /* ---------------- UI shell ---------------- */
  var CSS = "" +
    "#lzr{position:fixed;inset:0;z-index:99990;background:#0d1b1e;color:#f4f1e8;font-family:system-ui,'Segoe UI',Tahoma,sans-serif;direction:rtl;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}" +
    "#lzr canvas.gl{position:absolute;inset:0;width:100%;height:100%;display:block}" +
    "#lzr .glass{background:rgba(14,30,32,.78);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,236,190,.14);box-shadow:0 10px 30px -12px rgba(0,0,0,.6)}" +
    "#lzr .top{position:absolute;top:calc(8px + env(safe-area-inset-top));left:8px;right:8px;display:flex;gap:6px;align-items:center;z-index:5}" +
    "#lzr .me{display:flex;align-items:center;gap:8px;padding:6px 10px 6px 6px;border-radius:16px;flex:1;min-width:0;cursor:pointer}" +
    "#lzr .av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-weight:800;color:#10201f;flex:none;box-shadow:inset 0 -3px 0 rgba(0,0,0,.2)}" +
    "#lzr .lv{flex:1;min-width:0}#lzr .lv b{font-size:12px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    "#lzr .bar{height:6px;border-radius:6px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:3px}#lzr .bar i{display:block;height:100%;background:linear-gradient(90deg,#f5c451,#ff8f5a);border-radius:6px;transition:width .4s}" +
    "#lzr .res{display:flex;gap:4px}#lzr .pill{padding:7px 9px;border-radius:14px;font-size:12px;font-weight:700;white-space:nowrap}" +
    "#lzr .x{width:40px;height:40px;border-radius:14px;border:0;color:#f4f1e8;font-size:18px;cursor:pointer}" +
    "#lzr .nav{position:absolute;bottom:calc(8px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);display:flex;gap:2px;padding:5px;border-radius:22px;z-index:5;max-width:calc(100% - 16px);overflow-x:auto;scrollbar-width:none}" +
    "#lzr .nav button{position:relative;border:0;background:transparent;color:#d9d3c2;display:flex;flex-direction:column;align-items:center;gap:1px;font-size:10.5px;padding:6px 8px;border-radius:16px;cursor:pointer;min-width:50px}" +
    "#lzr .nav button span{font-size:19px;line-height:1}#lzr .nav button.on{background:rgba(245,196,81,.18);color:#ffe3a0}" +
    "#lzr .nav .dot{position:absolute;top:3px;left:9px;width:8px;height:8px;border-radius:50%;background:#ff6b5a;display:none}#lzr .nav .dot.on{display:block}" +
    "#lzr .sheet{position:absolute;left:0;right:0;bottom:0;max-height:78%;border-radius:24px 24px 0 0;z-index:8;transform:translateY(105%);transition:transform .32s cubic-bezier(.2,.9,.3,1);display:flex;flex-direction:column;padding-bottom:env(safe-area-inset-bottom)}" +
    "#lzr .sheet.on{transform:none}#lzr .sh-h{display:flex;align-items:center;gap:8px;padding:14px 16px 8px}#lzr .sh-h h3{margin:0;font-size:17px;flex:1}" +
    "#lzr .sh-b{overflow-y:auto;padding:4px 14px 18px;touch-action:pan-y;-webkit-overflow-scrolling:touch}" +
    "#lzr .card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:12px;margin:8px 0}" +
    "#lzr .row{display:flex;align-items:center;gap:10px}#lzr .grow{flex:1;min-width:0}#lzr small,#lzr .mut{color:#b9b29f;font-size:12px}" +
    "#lzr .btn{border:0;border-radius:12px;padding:9px 13px;font-weight:700;font-size:13px;cursor:pointer;background:linear-gradient(180deg,#f7cf62,#e9a83c);color:#2b1d05;box-shadow:0 3px 0 #a86f1c}" +
    "#lzr .btn:active{transform:translateY(2px);box-shadow:0 1px 0 #a86f1c}#lzr .btn.s{background:rgba(255,255,255,.1);color:#f4f1e8;box-shadow:none}#lzr .btn:disabled{opacity:.45}" +
    "#lzr .btn.g{background:linear-gradient(180deg,#7ee0a1,#3fb877);box-shadow:0 3px 0 #23804e;color:#06260f}" +
    "#lzr .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}" +
    "#lzr .item{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:10px;text-align:center;display:flex;flex-direction:column;gap:6px;align-items:center}#lzr .item .ic{font-size:30px}" +
    "#lzr .stat{display:grid;grid-template-columns:70px 1fr 30px;gap:6px;align-items:center;font-size:12px;margin:4px 0}" +
    "#lzr .stat .bar i{background:linear-gradient(90deg,#5ad19a,#b7f07a)}" +
    "#lzr .info{position:absolute;top:calc(64px + env(safe-area-inset-top));right:8px;width:min(300px,calc(100% - 16px));border-radius:18px;padding:12px;z-index:6;display:none}#lzr .info.on{display:block;animation:lzrIn .25s}" +
    "#lzr .lbl{position:absolute;top:0;left:0;pointer-events:none;z-index:2;font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 3px #000,0 0 8px rgba(0,0,0,.6);white-space:nowrap;transform:translate(-50%,-50%)}#lzr .lbl.cty{font-size:14px;color:#ffe9b0;letter-spacing:.3px}" +
    "#lzr #lzr-toast{position:absolute;top:calc(64px + env(safe-area-inset-top));left:50%;transform:translate(-50%,-20px);opacity:0;transition:.3s;padding:10px 16px;border-radius:14px;font-size:13px;font-weight:700;z-index:20;pointer-events:none;max-width:90%;text-align:center}#lzr #lzr-toast.on{opacity:1;transform:translate(-50%,0)}" +
    "#lzr .lzr-lvup{position:absolute;inset:0;display:grid;place-content:center;text-align:center;z-index:30;pointer-events:none;animation:lzrPop 2.6s forwards}#lzr .lzr-lvup b{font-size:40px;color:#ffd76a;text-shadow:0 0 30px #ff9d3a}#lzr .lzr-lvup span{color:#fff}" +
    "@keyframes lzrPop{0%{opacity:0;transform:scale(.6)}15%{opacity:1;transform:scale(1.05)}80%{opacity:1}100%{opacity:0;transform:scale(1.1)}}@keyframes lzrIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1}}" +
    "#lzr .tools{position:absolute;bottom:calc(8px + env(safe-area-inset-bottom));left:8px;right:8px;z-index:5;border-radius:20px;padding:8px;display:none;flex-direction:column;gap:6px}#lzr.build .tools{display:flex}#lzr.build .nav{display:none}" +
    "#lzr .pal{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px;touch-action:pan-x}" +
    "#lzr .pal button{flex:none;width:44px;height:44px;border-radius:12px;border:2px solid transparent;cursor:pointer;position:relative;box-shadow:inset 0 -4px 0 rgba(0,0,0,.25)}#lzr .pal button.on{border-color:#ffe3a0;transform:translateY(-2px)}" +
    "#lzr .pal button em{position:absolute;bottom:-2px;left:-2px;font-style:normal;font-size:10px;background:#111;color:#ffe3a0;border-radius:8px;padding:0 4px}" +
    "#lzr .tb{display:flex;gap:5px;overflow-x:auto;scrollbar-width:none;touch-action:pan-x}#lzr .tb button{flex:none;border:0;border-radius:11px;padding:8px 10px;font-size:12px;font-weight:700;background:rgba(255,255,255,.09);color:#f4f1e8;cursor:pointer}#lzr .tb button.on{background:#f5c451;color:#2b1d05}" +
    "#lzr .cam{position:absolute;left:8px;top:calc(64px + env(safe-area-inset-top));display:flex;flex-direction:column;gap:6px;z-index:5}#lzr .cam button{width:40px;height:40px;border-radius:12px;border:0;color:#f4f1e8;font-size:16px;cursor:pointer}" +
    "#lzr .opts{display:grid;gap:8px}#lzr .opt{text-align:right;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#f4f1e8;border-radius:14px;padding:12px;font-size:14px;cursor:pointer}#lzr .opt.ok{background:#2f8f5b}#lzr .opt.bad{background:#9b3b33}" +
    "#lzr input.inp{width:100%;box-sizing:border-box;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#fff;border-radius:12px;padding:10px;font-size:14px;margin:6px 0}" +
    "#lzr .mg{width:100%;height:360px;border-radius:16px;background:linear-gradient(#173b46,#0e2228);display:block;touch-action:none}" +
    "#lzr .mem{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}#lzr .mem button{aspect-ratio:1;border-radius:14px;border:0;font-size:28px;background:linear-gradient(160deg,#2c5961,#183a40);color:#fff;cursor:pointer}#lzr .mem button.up{background:#f4ecd6}" +
    "#lzr .tag{display:inline-block;font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(245,196,81,.18);color:#ffe3a0}" +
    "#lzr .ld{position:absolute;inset:0;display:grid;place-content:center;text-align:center;z-index:40;background:radial-gradient(#173b46,#0b1618)}#lzr .ld b{font-size:26px;color:#ffd76a}" +
    "#lzr-btn{position:fixed;left:12px;bottom:calc(86px + env(safe-area-inset-bottom));z-index:9990;border:0;border-radius:18px;padding:10px 14px;font:700 13px system-ui,Tahoma;color:#2b1d05;background:linear-gradient(180deg,#f7cf62,#e9a83c);box-shadow:0 6px 18px -4px rgba(233,168,60,.7),0 3px 0 #a86f1c;cursor:pointer;display:flex;gap:6px;align-items:center;direction:rtl}" +
    "@media(min-width:900px){#lzr .sheet{left:auto;right:16px;bottom:84px;width:420px;border-radius:24px;max-height:calc(100% - 170px)}}";

  function shell() {
    root = h("div", { id: "lzr" });
    root.innerHTML =
      '<canvas class="gl"></canvas><div id="lzr-lbls"></div>' +
      '<div class="top"><div class="me glass" data-a="profile"><div class="av" id="lzr-av"></div><div class="lv"><b id="lzr-nm"></b><div class="bar"><i id="lzr-xp"></i></div></div></div>' +
      '<div class="res"><div class="pill glass" id="lzr-c"></div><div class="pill glass" id="lzr-g"></div><div class="pill glass" id="lzr-e"></div></div>' +
      '<button class="x glass" data-a="close" aria-label="خروج">✕</button></div>' +
      '<div class="cam" id="lzr-cam"><button class="glass" data-a="zin" aria-label="تكبير">＋</button><button class="glass" data-a="zout" aria-label="تصغير">－</button><button class="glass" data-a="rotl" aria-label="تدوير">⟲</button><button class="glass" data-a="rotr" aria-label="تدوير">⟳</button><button class="glass" data-a="home" aria-label="موقعي">◎</button></div>' +
      '<div class="info glass" id="lzr-info"></div>' +
      '<div class="nav glass">' +
      [["map", "🗺️", "الخريطة"], ["quests", "🎯", "المهام"], ["games", "🎮", "الألعاب"], ["shop", "🛒", "المتجر"], ["props", "🏘️", "ممتلكاتي"], ["players", "👥", "اللاعبون"], ["events", "📰", "الأحداث"], ["create", "🌍", "أنشئ"]]
        .map(function (n) { return '<button data-tab="' + n[0] + '"' + (n[0] === "map" ? ' class="on"' : "") + '><i class="dot" id="lzr-dot-' + n[0] + '"></i><span>' + n[1] + "</span>" + n[2] + "</button>"; }).join("") +
      "</div>" +
      '<div class="tools glass"><div class="tb" id="lzr-tb"></div><div class="pal" id="lzr-pal"></div></div>' +
      '<div class="sheet glass" id="lzr-sheet"><div class="sh-h"><h3 id="lzr-sht"></h3><button class="btn s" data-a="shclose">إغلاق</button></div><div class="sh-b" id="lzr-shb"></div></div>' +
      '<div id="lzr-toast" class="glass"></div>' +
      '<div class="ld" id="lzr-ld"><b>🌍 عالم لحظة</b><small>جارِ تجهيز العالم…</small></div>';
    if (!document.getElementById("lzr-css")) document.head.appendChild(h("style", { id: "lzr-css" }, CSS));
    document.body.appendChild(root);
    root.addEventListener("click", onClick);
  }

  function hud() {
    if (!root) return;
    var li = C.levelInfo(S.xp);
    $("#lzr-av").textContent = (S.avatar.hat === "crown" ? "👑" : S.avatar.hat === "cap" ? "🧢" : S.name.slice(0, 1));
    $("#lzr-av").style.background = S.avatar.color;
    $("#lzr-nm").textContent = S.name + " · مستوى " + li.level;
    $("#lzr-xp").style.width = Math.round((li.into / li.need) * 100) + "%";
    $("#lzr-c").textContent = "🪙 " + S.coins;
    $("#lzr-g").textContent = "💎 " + S.gems;
    $("#lzr-e").textContent = "⚡ " + S.energy;
  }
  function badge() {
    C.ensureQuests(S, Date.now());
    var q = S.quests.list.some(function (x) { return !x.claimed && x.prog >= C.questDef(x.id).n; }) || S.daily.last !== C.dayKey(Date.now());
    var d = $("#lzr-dot-quests"); if (d) d.classList.toggle("on", q);
    var e = $("#lzr-dot-events"); if (e) e.classList.toggle("on", !!curEvent && S.events.done.indexOf(curEvent.key) < 0);
  }

  function onClick(e) {
    var t = e.target.closest("[data-a],[data-tab]");
    if (!t) return;
    var a = t.getAttribute("data-a"), tab = t.getAttribute("data-tab");
    if (tab) return openTab(tab);
    var fn = ACT[a]; if (fn) fn(t);
  }
  var ACT = {
    close: function () { close(); },
    shclose: function () { closeSheet(); },
    zin: function () { if (mode === "map") camState.dist = Math.max(16, camState.dist * 0.8); else bCam.dist = Math.max(10, bCam.dist * 0.85); },
    zout: function () { if (mode === "map") camState.dist = Math.min(120, camState.dist * 1.25); else bCam.dist = Math.min(60, bCam.dist * 1.15); },
    rotl: function () { if (mode === "map") camState.yaw += 0.5; else bCam.yaw += 0.5; },
    rotr: function () { if (mode === "map") camState.yaw -= 0.5; else bCam.yaw -= 0.5; },
    home: function () { if (mode === "map") { camState.tx = player.pos.x; camState.tz = player.pos.z; } else { bCam.yaw = 0.8; bCam.pitch = 0.7; bCam.dist = 30; } },
    profile: function () { openTab("profile"); }
  };

  /* ---------------- sheets / tabs ---------------- */
  var curTab = "map";
  function openSheet(title, html) { $("#lzr-sht").textContent = title; $("#lzr-shb").innerHTML = html; $("#lzr-sheet").classList.add("on"); $("#lzr-shb").scrollTop = 0; }
  function closeSheet() { $("#lzr-sheet").classList.remove("on"); stopGames(); setNav("map"); }
  function setNav(t) { curTab = t; root.querySelectorAll(".nav button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === t); }); }
  function openTab(t) {
    stopGames(); setNav(t); hideInfo();
    if (t === "map") return closeSheet();
    (TABS[t] || TABS.map)();
  }
  var TABS = {};

  TABS.quests = function () {
    var list = C.ensureQuests(S, Date.now());
    var today = C.dayKey(Date.now()), dailyDone = S.daily.last === today;
    var html = '<div class="card row"><div class="grow"><b>🎁 مكافأة الدخول اليومية</b><br><small>سلسلة الأيام: ' + S.daily.streak + " يوم — كل يوم متتالي يزيد المكافأة</small></div>" +
      '<button class="btn" id="lzr-daily" ' + (dailyDone ? "disabled" : "") + ">" + (dailyDone ? "تم ✓" : "استلم") + "</button></div>";
    list.forEach(function (q) {
      var d = C.questDef(q.id), pct = Math.round((q.prog / d.n) * 100);
      html += '<div class="card"><div class="row"><div class="grow"><b>' + esc(d.label) + "</b><br><small>" + q.prog + " / " + d.n + "  ·  🪙 " + d.coins + "  ·  " + d.xp + " XP</small></div>" +
        '<button class="btn ' + (q.prog >= d.n && !q.claimed ? "g" : "s") + '" data-q="' + q.id + '" ' + (q.claimed || q.prog < d.n ? "disabled" : "") + ">" + (q.claimed ? "✓" : "استلم") + "</button></div>" +
        '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
    });
    html += '<p class="mut">تتجدد المهام كل يوم. أكملها بالاستكشاف والبناء واللعب واتخاذ القرارات.</p>';
    openSheet("🎯 المهام اليومية", html);
    $("#lzr-daily").onclick = function () { if (reward(C.claimDaily(S, Date.now()), "🎁")) TABS.quests(); badge(); };
    root.querySelectorAll("[data-q]").forEach(function (b) { b.onclick = function () { if (reward(C.claimQuest(S, b.getAttribute("data-q")), "🎯")) TABS.quests(); badge(); }; });
  };

  TABS.shop = function () {
    var html = '<div class="grid">' + C.SHOP.map(function (it) {
      var own = S.owned.indexOf(it.id) >= 0;
      var eq = (it.kind === "hat" && S.avatar.hat === it.hat) || (it.kind === "skin" && S.avatar.color === it.color);
      var price = it.coins ? "🪙 " + it.coins : "💎 " + it.gems;
      var extra = it.kind === "block" ? "<small>لديك " + (S.inv[it.block] || 0) + "</small>" : "";
      return '<div class="item"><div class="ic">' + it.icon + "</div><b>" + esc(it.label) + "</b>" + extra +
        '<button class="btn ' + (own ? "s" : "") + '" data-buy="' + it.id + '" ' + (eq ? "disabled" : "") + ">" + (eq ? "مُرتدى" : own ? "ارتدِ" : price) + "</button></div>";
    }).join("") + "</div>";
    openSheet("🛒 متجر لحظة", html);
    root.querySelectorAll("[data-buy]").forEach(function (b) {
      b.onclick = function () {
        var r = C.buy(S, b.getAttribute("data-buy"));
        if (!r.ok) return toast("⚠️ " + r.err);
        if (!r.equipped) quest("buy_item");
        toast(r.equipped ? "👕 تم الارتداء" : "🛍️ تم الشراء: " + r.item.label);
        if (player) refreshPlayer();
        save(); TABS.shop();
      };
    });
  };

  TABS.props = function () {
    var ids = Object.keys(S.props), pend = C.pendingIncome(S, Date.now());
    var html = '<div class="card row"><div class="grow"><b>💰 دخل الممتلكات</b><br><small>كل أرض تنتج عملات كل ساعة (حتى ' + C.INCOME_CAP_H + " ساعة). كلما بنيت أكثر زاد دخلها.</small></div>" +
      '<button class="btn g" id="lzr-col" ' + (pend ? "" : "disabled") + ">اجمع " + pend + " 🪙</button></div>";
    if (!ids.length) html += '<div class="card"><b>لا تملك أراضي بعد</b><br><small>افتح الخريطة، اضغط على قطعة أرض عليها لافتة «للبيع» داخل أي مدينة واشترِها، ثم ابنِ عليها حجراً بحجر.</small></div>';
    ids.forEach(function (id) {
      var p = findPlot(id); if (!p) return;
      var city = findCity(p.city), co = findCountry(p.country);
      var n = (S.plots[id] || []).length;
      html += '<div class="card row"><div class="grow"><b>🏡 أرض في ' + esc(city ? city.name : "") + "</b><br><small>" + esc(co ? co.name : "") + " · " + n + " حجر · " + C.plotRate(S, id) + " 🪙/ساعة</small></div>" +
        '<button class="btn s" data-go="' + id + '">📍</button><button class="btn" data-bd="' + id + '">ابنِ</button></div>';
    });
    var inv = BLOCKS.map(function (b, i) { return b.prem ? "<span class=tag>" + b.n + ": " + (S.inv[i] || 0) + "</span> " : ""; }).join("");
    html += '<div class="card"><b>🎒 الحقيبة</b><br>' + inv + "<br><small>الأحجار الأساسية مجانية. الأحجار المميزة تُشترى من المتجر.</small></div>";
    openSheet("🏘️ ممتلكاتي", html);
    var col = $("#lzr-col"); if (col) col.onclick = function () { var c = C.collectIncome(S, Date.now()); quest("collect_income"); reward({ ok: true, coins: c }, "💰"); TABS.props(); };
    root.querySelectorAll("[data-go]").forEach(function (b) { b.onclick = function () { var p = findPlot(b.getAttribute("data-go")); closeSheet(); camState.tx = p.x * TS; camState.tz = p.z * TS; camState.dist = 26; showPlotInfo(p); }; });
    root.querySelectorAll("[data-bd]").forEach(function (b) { b.onclick = function () { closeSheet(); enterBuild(b.getAttribute("data-bd")); }; });
  };

  TABS.events = function () {
    var ev = curEvent, html = "";
    if (ev) {
      var done = S.events.done.indexOf(ev.key) >= 0;
      html += '<div class="card"><span class="tag">حدث مباشر</span><h3 style="margin:6px 0">' + esc(ev.title) + "</h3><p class=mut>" + esc(ev.text) + "</p>" +
        (done ? "<b>✓ اتخذت قرارك. حدث جديد خلال دقائق.</b>" : '<div class="opts"><button class="opt" data-ev="a">' + esc(ev.a.label) + '</button><button class="opt" data-ev="b">' + esc(ev.b.label) + "</button></div>") +
        "<p class=mut>قراراتك تغيّر ازدهار وأمان وسعادة الدولة، وهذا يغيّر أسعار الأراضي ومظهر العالم.</p></div>";
    }
    html += "<h4>📊 حالة الدول</h4>";
    W.countries.forEach(function (c) {
      html += '<div class="card"><b>' + esc(c.name) + "</b>" + statBars(c.stats) + "</div>";
    });
    html += "<h4>📰 سجل قراراتك</h4>" + (S.events.log.length ? S.events.log.map(function (l) { return '<div class="card"><b>' + esc(l.title) + "</b><br><small>" + esc(l.choice) + " · " + new Date(l.t).toLocaleString("ar") + "</small></div>"; }).join("") : "<p class=mut>لم تتخذ قرارات بعد.</p>");
    openSheet("📰 أحداث العالم", html);
    root.querySelectorAll("[data-ev]").forEach(function (b) {
      b.onclick = function () {
        var r = C.resolveEvent(S, ev, b.getAttribute("data-ev"));
        if (!r.ok) return toast("⚠️ " + r.err);
        quest("choose_event"); if (r.levelUp) levelUp(r.levelUp);
        toast("🌍 قرارك غيّر مصير " + findCountry(ev.country).name);
        save(); updateFx(); badge(); TABS.events();
      };
    });
  };
  function statBars(s) {
    return [["prosperity", "الازدهار"], ["safety", "الأمان"], ["happiness", "السعادة"]].map(function (k) {
      return '<div class="stat"><span>' + k[1] + '</span><div class="bar"><i style="width:' + s[k[0]] + '%"></i></div><b>' + s[k[0]] + "</b></div>";
    }).join("");
  }

  TABS.create = function () {
    var mine = S.world.custom;
    var html = '<div class="card"><b>🌍 أنشئ دولة جديدة</b><br><small>تظهر كجزيرة جديدة في المحيط بمدينة عاصمة وأراضٍ للبناء. التكلفة ' + C.COUNTRY_COST + " 🪙 — يتطلب المستوى 3.</small>" +
      '<input class="inp" id="lzr-cn" maxlength="24" placeholder="اسم الدولة"><div class="row"><input type="color" id="lzr-cc" value="#8fd0a0" style="width:48px;height:38px;border:0;background:none"><button class="btn" id="lzr-mkc">أنشئ الدولة</button></div></div>';
    mine.forEach(function (c) {
      html += '<div class="card"><b>🏳️ ' + esc(c.name) + "</b><br><small>" + c.cities.length + ' مدن</small><input class="inp" data-cityname="' + c.id + '" maxlength="24" placeholder="اسم مدينة جديدة"><div class="row"><button class="btn" data-mkcity="' + c.id + '">أضف مدينة (' + C.CITY_COST + ' 🪙)</button><button class="btn s" data-goc="' + c.id + '">📍 اذهب</button></div></div>';
    });
    html += '<p class="mut">كل مدينة فيها أراضٍ تشتريها وتبني عليها حجراً بحجر بنفس جودة العالم الرئيسي.</p>';
    openSheet("🌍 أنشئ عالمك", html);
    $("#lzr-mkc").onclick = function () {
      var r = C.createCountry(S, $("#lzr-cn").value, $("#lzr-cc").value);
      if (!r.ok) return toast("⚠️ " + r.err);
      gainXp(150); W = C.buildWorld(S); rebuildMap(); save();
      var c = findCountry(r.id); closeSheet(); camState.tx = c.cx * TS; camState.tz = c.cz * TS; camState.dist = 40;
      toast("🎉 وُلدت دولة " + c.name + "!");
    };
    root.querySelectorAll("[data-mkcity]").forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute("data-mkcity"), nm = root.querySelector('[data-cityname="' + id + '"]').value;
        var r = C.createCity(S, id, nm); if (!r.ok) return toast("⚠️ " + r.err);
        gainXp(60); W = C.buildWorld(S); rebuildMap(); save(); toast("🏙️ تأسست مدينة " + nm); TABS.create();
      };
    });
    root.querySelectorAll("[data-goc]").forEach(function (b) { b.onclick = function () { var c = findCountry(b.getAttribute("data-goc")); closeSheet(); camState.tx = c.cx * TS; camState.tz = c.cz * TS; }; });
  };

  TABS.profile = function () {
    var li = C.levelInfo(S.xp);
    var html = '<div class="card"><b>الاسم في العالم</b><input class="inp" id="lzr-name" maxlength="20" value="' + esc(S.name) + '"><button class="btn" id="lzr-svn">حفظ</button></div>' +
      '<div class="card"><b>المستوى ' + li.level + "</b> — " + li.into + " / " + li.need + ' XP<div class="bar"><i style="width:' + Math.round((li.into / li.need) * 100) + '%"></i></div></div>' +
      '<div class="card"><b>📈 إحصاءاتك</b><br><small>أحجار وُضعت: ' + (S.stats.place_blocks || 0) + " · مدن زرتها: " + (S.stats.visit_city || 0) + " · ألعاب: " + (S.stats.play_game || 0) + " · قرارات: " + (S.stats.choose_event || 0) + " · أراضٍ: " + Object.keys(S.props).length + "</small></div>" +
      '<div class="card"><small id="lzr-sync">…</small><br><button class="btn s" id="lzr-cs">☁️ حفظ سحابي الآن</button></div>';
    openSheet("👤 ملفي في العالم", html);
    $("#lzr-svn").onclick = function () { var v = $("#lzr-name").value.trim(); if (!v) return; S.name = v.slice(0, 20); save(); refreshPlayer(); toast("✅ تم الحفظ"); };
    $("#lzr-cs").onclick = function () { if (!fbUser()) return toast("سجّل دخولك في لحظة أولاً"); cloudSave(); toast("☁️ جارِ الحفظ…"); };
    setSync(fbUser() ? "☁️ الحفظ السحابي مفعّل لحسابك" : "💾 محفوظ على هذا الجهاز — سجّل الدخول للحفظ السحابي");
  };

  /* ---------------- players / social ---------------- */
  var BOTS = [["سارة", 2400, "#e0554f"], ["عمر", 1900, "#2bb3a3"], ["ليان", 1500, "#e8b54a"], ["يوسف", 900, "#4f8cff"], ["نور", 520, "#c56cff"]];
  TABS.players = function () {
    openSheet("👥 اللاعبون", '<p class="mut">جارِ تحميل لوحة المتصدرين…</p>');
    var u = fbUser();
    var mine = { id: u ? u.uid : "me", name: S.name, xp: S.xp, color: S.avatar.color, me: 1, props: Object.keys(S.props).length };
    var render = function (list, live) {
      if (!list.some(function (p) { return p.me; })) list.push(mine);
      list.sort(function (a, b) { return b.xp - a.xp; });
      var html = '<div class="card"><small>' + (live ? "🟢 لاعبون حقيقيون من مجتمع لحظة" : "سجّل دخولك في لحظة لترى اللاعبين الحقيقيين. يظهر الآن سكان العالم الافتراضيون.") + "</small></div>";
      list.forEach(function (p, i) {
        html += '<div class="card row"><b style="width:22px">' + (i + 1) + '</b><div class="av" style="background:' + esc(p.color || "#4f8cff") + '">' + esc((p.name || "?").slice(0, 1)) + '</div><div class="grow"><b>' + esc(p.name) + (p.me ? " (أنت)" : "") + "</b><br><small>مستوى " + C.levelInfo(p.xp).level + " · " + p.xp + " XP" + (p.props != null ? " · " + p.props + " أرض" : "") + "</small></div>" +
          (p.me || p.bot ? "" : '<button class="btn s" data-visit="' + esc(p.id) + '">🏡 زيارة</button>' + (typeof window.openUser === "function" ? '<button class="btn s" data-user="' + esc(p.id) + '">💬</button>' : "")) + "</div>";
      });
      openSheet("👥 اللاعبون", html);
      root.querySelectorAll("[data-visit]").forEach(function (b) { b.onclick = function () { visitPlayer(b.getAttribute("data-visit")); }; });
      root.querySelectorAll("[data-user]").forEach(function (b) { b.onclick = function () { var id = b.getAttribute("data-user"); close(); try { window.openUser(id); } catch (e) {} }; });
    };
    var bots = BOTS.map(function (b, i) { return { id: "bot" + i, name: b[0], xp: b[1], color: b[2], bot: 1 }; });
    if (!u) return render(bots, false);
    firebase.firestore().collection("users").orderBy("realmXp", "desc").limit(25).get().then(function (qs) {
      var list = [];
      qs.forEach(function (d) { var x = d.data(); list.push({ id: d.id, name: x.realmName || x.name || x.displayName || x.username || "لاعب", xp: x.realmXp || 0, color: x.realmColor, props: x.realmProps || 0, me: d.id === u.uid }); });
      render(list.length > 1 ? list : list.concat(bots), list.length > 1);
    }).catch(function () { render(bots, false); });
  };
  function visitPlayer(uid) {
    firebase.firestore().collection("users").doc(uid).get().then(function (d) {
      var x = d.data() || {}, rp = x.realmPlots || {}, keys = Object.keys(rp);
      if (!keys.length) return toast("هذا اللاعب لم يبنِ بعد");
      keys.sort(function (a, b) { return rp[b].length - rp[a].length; });
      closeSheet();
      enterBuild(null, { blocks: C.decodeBlocks(rp[keys[0]]), owner: x.realmName || "لاعب" });
      quest("visit_city");
    }).catch(function () { toast("تعذّر تحميل عالم اللاعب"); });
  }

  /* ---------------- games ---------------- */
  var gameTimers = [];
  function stopGames() { gameTimers.forEach(function (t) { clearInterval(t); clearTimeout(t); cancelAnimationFrame(t); }); gameTimers = []; }
  function useEnergy() { if (S.energy < 1) { toast("⚡ لا توجد طاقة — استلم المكافأة اليومية أو اشترِ من المتجر"); return false; } S.energy--; save(); return true; }
  TABS.games = function () {
    openSheet("🎮 ألعاب ومسابقات", '<div class="grid">' +
      '<div class="item"><div class="ic">🏆</div><b>مسابقة مباشرة</b><small>5 أسئلة ضد 3 منافسين، الأسرع يفوز</small><button class="btn" data-g="quiz">العب ⚡1</button></div>' +
      '<div class="item"><div class="ic">🪙</div><b>سباق العملات</b><small>اجمع العملات وتجنّب القنابل في 25 ثانية</small><button class="btn" data-g="rush">العب ⚡1</button></div>' +
      '<div class="item"><div class="ic">🧠</div><b>ذاكرة لحظة</b><small>طابق الأزواج بأقل عدد حركات</small><button class="btn" data-g="mem">العب ⚡1</button></div>' +
      "</div>");
    root.querySelectorAll("[data-g]").forEach(function (b) { b.onclick = function () { if (!useEnergy()) return; ({ quiz: gameQuiz, rush: gameRush, mem: gameMem })[b.getAttribute("data-g")](); }; });
  };
  function finishGame(coins, xp, label) {
    quest("play_game");
    S.coins += coins; var lv = C.addXp(S, xp);
    reward({ ok: true, coins: coins, xp: xp, levelUp: lv }, label);
  }
  var QZ = [
    ["ما عاصمة العراق؟", ["بغداد", "البصرة", "الموصل", "أربيل"], 0], ["كم عدد أيام الأسبوع؟", ["5", "6", "7", "8"], 2], ["أكبر كوكب في المجموعة الشمسية؟", ["المريخ", "المشتري", "زحل", "الأرض"], 1],
    ["ما لون الزمرد؟", ["أحمر", "أزرق", "أخضر", "أصفر"], 2], ["كم ضلعاً للمسدس؟", ["5", "6", "7", "8"], 1], ["أسرع حيوان بري؟", ["الأسد", "الفهد", "الحصان", "الغزال"], 1],
    ["ما أطول نهر في العالم؟", ["النيل", "الفرات", "الأمازون", "دجلة"], 0], ["كم دقيقة في الساعة؟", ["30", "60", "90", "100"], 1], ["ما عاصمة مصر؟", ["الإسكندرية", "القاهرة", "أسوان", "الجيزة"], 1],
    ["أي غاز نتنفسه للحياة؟", ["الأكسجين", "الهيليوم", "النيتروجين", "الهيدروجين"], 0], ["كم قارة في العالم؟", ["5", "6", "7", "8"], 2], ["ما ناتج 9×7؟", ["56", "63", "72", "81"], 1],
    ["أكبر محيط؟", ["الأطلسي", "الهندي", "الهادئ", "المتجمد"], 2], ["ما عاصمة السعودية؟", ["جدة", "الرياض", "مكة", "الدمام"], 1], ["كم لاعباً في فريق كرة القدم؟", ["9", "10", "11", "12"], 2],
    ["أي فصل يأتي بعد الصيف؟", ["الربيع", "الخريف", "الشتاء", "لا شيء"], 1], ["ما الحيوان الملقب بسفينة الصحراء؟", ["الحصان", "الجمل", "الفيل", "الحمار"], 1], ["كم عدد ألوان قوس قزح؟", ["5", "6", "7", "8"], 2]
  ];
  function gameQuiz() {
    var r = C.rng(Date.now() & 0xffffffff), qs = QZ.slice().sort(function () { return r() - 0.5; }).slice(0, 5);
    var players = [{ n: S.name, s: 0, me: 1 }, { n: "سارة", s: 0, k: 0.8 }, { n: "عمر", s: 0, k: 0.65 }, { n: "ليان", s: 0, k: 0.55 }];
    var qi = 0;
    function board() { return players.slice().sort(function (a, b) { return b.s - a.s; }).map(function (p, i) { return '<div class="row" style="font-size:13px;margin:3px 0"><b style="width:18px">' + (i + 1) + '</b><span class="grow">' + esc(p.n) + (p.me ? " (أنت)" : "") + "</span><b>" + p.s + "</b></div>"; }).join(""); }
    function next() {
      stopGames();
      if (qi >= qs.length) return end();
      var q = qs[qi], left = 10, answered = false, botsDone = {};
      function draw(pick) {
        openSheet("🏆 مسابقة مباشرة — سؤال " + (qi + 1) + "/5",
          '<div class="card"><div class="row"><b class="grow" style="font-size:16px">' + esc(q[0]) + '</b><span class="tag" id="lzr-qt">' + left + "ث</span></div></div>" +
          '<div class="opts">' + q[1].map(function (o, i) { var cls = pick == null ? "" : i === q[2] ? " ok" : i === pick ? " bad" : ""; return '<button class="opt' + cls + '" data-o="' + i + '" ' + (pick != null ? "disabled" : "") + ">" + esc(o) + "</button>"; }).join("") + "</div>" +
          '<div class="card"><b>المتصدرون مباشرة</b>' + board() + "</div>");
        root.querySelectorAll("[data-o]").forEach(function (b) { b.onclick = function () { answer(+b.getAttribute("data-o")); }; });
      }
      function answer(i) {
        if (answered) return; answered = true;
        if (i === q[2]) players[0].s += 100 + left * 10;
        draw(i); gameTimers.push(setTimeout(function () { qi++; next(); }, 1300));
      }
      draw(null);
      gameTimers.push(setInterval(function () {
        left--;
        players.forEach(function (p, i) { if (!p.me && !botsDone[i] && r() < 0.28) { botsDone[i] = 1; if (r() < p.k) p.s += 100 + left * 10; } });
        var el = $("#lzr-qt"); if (el) el.textContent = left + "ث";
        if (left <= 0 && !answered) answer(-1);
      }, 1000));
    }
    function end() {
      players.sort(function (a, b) { return b.s - a.s; });
      var rank = players.findIndex(function (p) { return p.me; }) + 1;
      openSheet("🏆 النتيجة", '<div class="card" style="text-align:center"><div style="font-size:48px">' + (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "🎗️") + "</div><b>المركز " + rank + "</b>" + board() + '</div><button class="btn" data-g2="1">العب مجدداً</button>');
      if (rank === 1) { quest("win_quiz"); finishGame(90, 70, "🏆 فزت!"); } else finishGame(rank === 2 ? 40 : 15, 25, "🎮");
      $("[data-g2]").onclick = function () { if (useEnergy()) gameQuiz(); };
    }
    next();
  }
  function gameRush() {
    openSheet("🪙 سباق العملات", '<div class="row"><b class="grow" id="lzr-rs">النقاط: 0</b><span class="tag" id="lzr-rt">25ث</span></div><canvas class="mg" id="lzr-rc"></canvas><small>اضغط على العملات 🪙 والجواهر 💎 — تجنّب 💣</small>');
    var cv = $("#lzr-rc"), ctx = cv.getContext("2d"), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; ctx.scale(dpr, dpr);
    var Wd = cv.clientWidth, Hd = cv.clientHeight, items = [], score = 0, left = 25, last = performance.now(), spawn = 0, over = false, pops = [];
    cv.addEventListener("pointerdown", function (e) {
      var rc = cv.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top;
      for (var i = items.length - 1; i >= 0; i--) { var it = items[i]; if (Math.hypot(it.x - x, it.y - y) < 26) { score += it.v; pops.push({ x: it.x, y: it.y, t: 0, v: it.v }); items.splice(i, 1); if (navigator.vibrate) try { navigator.vibrate(12); } catch (er) {} break; } }
      $("#lzr-rs").textContent = "النقاط: " + score;
    });
    function loop(now) {
      if (over) return;
      var dt = Math.min(0.05, (now - last) / 1000); last = now; spawn -= dt;
      if (spawn <= 0) { spawn = 0.45 - (25 - left) * 0.008; var k = Math.random(); items.push({ x: 24 + Math.random() * (Wd - 48), y: -20, vy: 90 + Math.random() * 90 + (25 - left) * 4, e: k < 0.15 ? "💣" : k < 0.25 ? "💎" : "🪙", v: k < 0.15 ? -30 : k < 0.25 ? 25 : 10 }); }
      ctx.clearRect(0, 0, Wd, Hd);
      ctx.font = "34px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      items.forEach(function (it) { it.y += it.vy * dt; ctx.fillText(it.e, it.x, it.y); });
      items = items.filter(function (it) { return it.y < Hd + 30; });
      ctx.font = "bold 16px system-ui";
      pops.forEach(function (p) { p.t += dt; ctx.fillStyle = p.v > 0 ? "rgba(255,215,106," + (1 - p.t) + ")" : "rgba(255,90,80," + (1 - p.t) + ")"; ctx.fillText((p.v > 0 ? "+" : "") + p.v, p.x, p.y - p.t * 40); });
      pops = pops.filter(function (p) { return p.t < 1; });
      gameTimers.push(requestAnimationFrame(loop));
    }
    gameTimers.push(requestAnimationFrame(loop));
    gameTimers.push(setInterval(function () {
      left--; var el = $("#lzr-rt"); if (el) el.textContent = left + "ث";
      if (left <= 0) { over = true; stopGames(); var coins = Math.max(5, Math.round(score / 4)); openSheet("🪙 انتهى السباق", '<div class="card" style="text-align:center"><div style="font-size:44px">🪙</div><b>نقاطك: ' + score + '</b></div><button class="btn" id="lzr-again">العب مجدداً</button>'); finishGame(coins, 20 + Math.round(score / 10), "🪙"); $("#lzr-again").onclick = function () { if (useEnergy()) gameRush(); }; }
    }, 1000));
  }
  function gameMem() {
    var em = ["🌴", "🏰", "🐪", "⛵", "🌙", "⭐"], cards = em.concat(em).sort(function () { return Math.random() - 0.5; });
    var up = [], done = {}, moves = 0, lock = false;
    function draw() {
      openSheet("🧠 ذاكرة لحظة", '<div class="row"><b class="grow">الحركات: ' + moves + '</b><small>طابق كل الأزواج</small></div><div class="mem">' + cards.map(function (c, i) { var show = done[i] || up.indexOf(i) >= 0; return '<button class="' + (show ? "up" : "") + '" data-m="' + i + '">' + (show ? c : "؟") + "</button>"; }).join("") + "</div>");
      root.querySelectorAll("[data-m]").forEach(function (b) { b.onclick = function () { flip(+b.getAttribute("data-m")); }; });
    }
    function flip(i) {
      if (lock || done[i] || up.indexOf(i) >= 0) return;
      up.push(i); draw();
      if (up.length === 2) {
        moves++; lock = true;
        gameTimers.push(setTimeout(function () {
          if (cards[up[0]] === cards[up[1]]) { done[up[0]] = done[up[1]] = 1; }
          up = []; lock = false; draw();
          if (Object.keys(done).length === cards.length) { var coins = Math.max(15, 80 - (moves - 6) * 6); finishGame(coins, 35, "🧠 أحسنت!"); openSheet("🧠 أنهيتها!", '<div class="card" style="text-align:center"><b>' + moves + ' حركة</b></div><button class="btn" id="lzr-again">العب مجدداً</button>'); $("#lzr-again").onclick = function () { if (useEnergy()) gameMem(); }; }
        }, 650));
      }
    }
    draw();
  }

  /* ---------------- world lookup ---------------- */
  function findCountry(id) { return W.countries.filter(function (c) { return c.id === id; })[0]; }
  function findCity(id) { for (var i = 0; i < W.countries.length; i++) for (var j = 0; j < W.countries[i].cities.length; j++) if (W.countries[i].cities[j].id === id) return W.countries[i].cities[j]; }
  function findPlot(id) { var cid = id.split(":")[0], c = findCity(cid); return c && c.plots.filter(function (p) { return p.id === id; })[0]; }
  function tileAt(x, z) { x = Math.round(x); z = Math.round(z); if (x < 0 || z < 0 || x >= W.size || z >= W.size) return null; return W.tiles[z * W.size + x]; }

  /* ---------------- three.js shared stage ---------------- */
  function loadThree() {
    if (window.THREE && THREE.InstancedMesh) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
      s.onload = res; s.onerror = function () { rej(new Error("three")); }; document.head.appendChild(s);
    });
  }
  var texCache = {};
  function noiseTex(base, opts) {
    opts = opts || {};
    var key = base + JSON.stringify(opts); if (texCache[key]) return texCache[key];
    var cv = document.createElement("canvas"); cv.width = cv.height = 32; var x = cv.getContext("2d");
    x.fillStyle = base; x.fillRect(0, 0, 32, 32);
    var r = C.rng(C.hash(key));
    for (var i = 0; i < 260; i++) { var v = r(); x.fillStyle = v < 0.5 ? "rgba(0,0,0," + (0.05 + r() * 0.1) + ")" : "rgba(255,255,255," + (0.04 + r() * 0.08) + ")"; x.fillRect(Math.floor(r() * 32), Math.floor(r() * 32), 2, 2); }
    if (opts.grassSide) { x.fillStyle = "#6dbb4c"; for (var gx = 0; gx < 32; gx++) { var gh = 7 + Math.floor(r() * 4); x.fillRect(gx, 0, 1, gh); } x.fillStyle = "rgba(0,0,0,.14)"; for (var gx2 = 0; gx2 < 32; gx2++) x.fillRect(gx2, 9 + Math.floor(r() * 3), 1, 1); }
    if (opts.brick) { x.fillStyle = "rgba(240,230,215,.45)"; for (var y = 0; y < 32; y += 8) { x.fillRect(0, y, 32, 1); for (var bx = (y / 8) % 2 ? 0 : 8; bx < 32; bx += 16) x.fillRect(bx, y, 1, 8); } }
    if (opts.plank) { x.fillStyle = "rgba(60,35,10,.35)"; for (var py = 0; py < 32; py += 8) x.fillRect(0, py, 32, 1); }
    if (opts.log) { x.fillStyle = "rgba(40,20,5,.35)"; for (var lx = 2; lx < 32; lx += 6) x.fillRect(lx, 0, 1, 32); }
    if (opts.glass) { x.clearRect(0, 0, 32, 32); x.fillStyle = "rgba(200,235,255,.25)"; x.fillRect(0, 0, 32, 32); x.fillStyle = "rgba(255,255,255,.8)"; x.fillRect(0, 0, 32, 2); x.fillRect(0, 30, 32, 2); x.fillRect(0, 0, 2, 32); x.fillRect(30, 0, 2, 32); x.fillRect(6, 6, 6, 2); }
    if (opts.window) { x.fillStyle = "#e7dccb"; x.fillRect(0, 0, 32, 32); for (var wy = 4; wy < 30; wy += 10) for (var wx = 4; wx < 30; wx += 10) { x.fillStyle = "#3b4a56"; x.fillRect(wx, wy, 6, 7); } }
    if (opts.lit) { x.fillStyle = "#000"; x.fillRect(0, 0, 32, 32); for (var ly = 4; ly < 30; ly += 10) for (var lw = 4; lw < 30; lw += 10) { x.fillStyle = r() < 0.65 ? "#ffd27a" : "#111"; x.fillRect(lw, ly, 6, 7); } }
    if (!opts.glass && !opts.window && !opts.lit && !opts.flat) { x.strokeStyle = "rgba(0,0,0,.18)"; x.strokeRect(0.5, 0.5, 31, 31); }
    var t = new THREE.CanvasTexture(cv); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipMapLinearFilter; t.encoding = THREE.sRGBEncoding;
    if (opts.window || opts.lit) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    texCache[key] = t; return t;
  }
  function blockMat(i) {
    var b = BLOCKS[i];
    if (b.top && !b.glass) {
      var sideM = new THREE.MeshStandardMaterial({ map: noiseTex("#8a5f3c", { grassSide: 1 }), roughness: 0.9 });
      var topM = new THREE.MeshStandardMaterial({ map: noiseTex(b.top, {}), roughness: 0.9 });
      var botM = new THREE.MeshStandardMaterial({ map: noiseTex("#8a5f3c", {}), roughness: 0.95 });
      return [sideM, sideM, topM, botM, sideM, sideM];
    }
    var m = new THREE.MeshStandardMaterial({ map: noiseTex(b.glass ? "#ffffff" : b.c, { brick: b.brick, plank: b.plank, log: b.log, glass: b.glass }), roughness: b.metal ? 0.25 : b.water ? 0.1 : 0.85, metalness: b.metal ? 0.8 : 0 });
    if (b.glass || b.water) { m.transparent = true; m.opacity = b.water ? 0.72 : 0.55; m.depthWrite = false; }
    if (b.glow) { m.emissive = new THREE.Color(b.c); m.emissiveIntensity = 0.9; }
    return m;
  }
  function lights(scene) {
    var hemi = new THREE.HemisphereLight(0xd6ecff, 0x46512f, 0.7); scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xfff0d4, 1.3); sun.castShadow = true;
    var sm = mobile ? 1024 : 2048; sun.shadow.mapSize.set(sm, sm); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
    scene.add(sun); scene.add(sun.target);
    var amb = new THREE.AmbientLight(0xffffff, 0.12); scene.add(amb);
    var rim = new THREE.DirectionalLight(0x9ec7ff, 0.28); rim.position.set(-40, 24, -30); scene.add(rim);
    scene.fog = new THREE.Fog(0xa7d8f0, 70, 250); scene.background = new THREE.Color(0xa7d8f0);
    return { hemi: hemi, sun: sun, rim: rim };
  }
  function makeStage() {
    T = THREE;
    var cv = root.querySelector("canvas.gl");
    gl = new T.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: "high-performance" });
    gl.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.75 : 2));
    gl.shadowMap.enabled = true; gl.shadowMap.type = T.PCFSoftShadowMap;
    gl.outputEncoding = T.sRGBEncoding; gl.toneMapping = T.ACESFilmicToneMapping; gl.toneMappingExposure = 1.12;
    cam = new T.PerspectiveCamera(45, 1, 0.3, 700); tmpC = new T.Color();
    resize(); addEventListener("resize", resize);
    bindPointer(cv);
  }
  function resize() { if (!gl) return; var w = root.clientWidth, hh = root.clientHeight; gl.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix(); }


  /* ---------------- visual upgrade helpers (sky, stars, decor, fireflies) ---------------- */
  function safe(f) { try { return f(); } catch (e) { try { console.warn("lzr-visual", e); } catch (_) {} } }
  function makeSky(scene) {
    var mat = new T.ShaderMaterial({
      uniforms: { top: { value: new T.Color(0x4a90d9) }, hor: { value: new T.Color(0xa7d8f0) }, sunDir: { value: new T.Vector3(0, 1, 0) }, sunCol: { value: new T.Color(0xfff0c0) }, night: { value: 0 } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float night; varying vec3 vP; void main(){ float h = clamp(vP.y, 0.0, 1.0); vec3 c = mix(hor, top, pow(h, 0.5)); float sd = max(dot(normalize(vP), normalize(sunDir)), 0.0); c += sunCol * (pow(sd, 800.0) * 1.6 + pow(sd, 14.0) * 0.28 * (1.0 - night)); gl_FragColor = vec4(c, 1.0); }",
      side: T.BackSide, depthWrite: false, depthTest: false, fog: false
    });
    var dome = new T.Mesh(new T.SphereGeometry(450, 24, 16), mat); dome.renderOrder = -10; dome.frustumCulled = false; scene.add(dome);
    var n = 450, a = new Float32Array(n * 3), r = C.rng(77);
    for (var i = 0; i < n; i++) { var u = r() * Math.PI * 2, v = 0.12 + r() * 0.88, rad = Math.sqrt(1 - v * v) * 430; a[i * 3] = Math.cos(u) * rad; a[i * 3 + 1] = v * 430; a[i * 3 + 2] = Math.sin(u) * rad; }
    var sg = new T.BufferGeometry(); sg.setAttribute("position", new T.BufferAttribute(a, 3));
    var stars = new T.Points(sg, new T.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false }));
    stars.renderOrder = -9; stars.frustumCulled = false; scene.add(stars);
    return { dome: dome, mat: mat, stars: stars };
  }
  function skyFrame(SK, L, sky, night, dusk) {
    if (!SK) return;
    SK.dome.position.copy(cam.position); SK.stars.position.copy(cam.position);
    var u = SK.mat.uniforms;
    u.hor.value.copy(sky);
    u.top.value.set(0x4a90d9).lerp(tmpC.set(0x050b1a), night);
    if (dusk > 0.01) u.top.value.lerp(tmpC.set(0x6a5a9a), dusk * 0.35 * (1 - night));
    u.sunDir.value.copy(L.sun.position).sub(L.sun.target.position).normalize();
    u.sunCol.value.set(0xfff0c0).lerp(tmpC.set(0xffa860), dusk * 0.8);
    u.night.value = night;
    SK.stars.material.opacity = Math.max(0, night - 0.15) * 1.1;
  }
  var tmpC = null;
  function addDecor(grp, land, npcPlots) {
    var r = C.rng(S.seed + 21), m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), col = new T.Color();
    var fl = [], tf = [], rk = [];
    land.forEach(function (t) {
      if (t.plot || t.type === "city" || t.type === "water") return;
      if (t.type === "grass" || t.type === "forest") {
        if (r() < 0.38) fl.push({ x: t.x * TS + (r() - 0.5) * 1.7, z: t.z * TS + (r() - 0.5) * 1.7, y: t.h });
        var k = r() < 0.5 ? 2 : 1; for (var i = 0; i < k; i++) tf.push({ x: t.x * TS + (r() - 0.5) * 1.8, z: t.z * TS + (r() - 0.5) * 1.8, y: t.h, s: 0.7 + r() * 0.8 });
      } else if (t.type === "mountain" || t.type === "sand" || t.type === "snow") {
        if (r() < 0.3) rk.push({ x: t.x * TS + (r() - 0.5) * 1.6, z: t.z * TS + (r() - 0.5) * 1.6, y: t.h, s: 0.5 + r() * 1.1 });
      }
    });
    var flc = ["#ff6b81", "#ffd23a", "#ffffff", "#b983ff", "#ff9f43", "#4fc3f7"];
    if (fl.length) {
      var fm = new T.InstancedMesh(new T.SphereGeometry(0.1, 6, 5), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), fl.length);
      fl.forEach(function (f, i) { sc.set(1, 1, 1); ps.set(f.x, f.y + 0.14, f.z); m4.compose(ps, q, sc); fm.setMatrixAt(i, m4); fm.setColorAt(i, col.set(flc[Math.floor(r() * flc.length)])); });
      fm.instanceColor.needsUpdate = true; grp.add(fm);
    }
    if (tf.length) {
      var gm = new T.InstancedMesh(new T.ConeGeometry(0.09, 0.42, 4), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), tf.length);
      tf.forEach(function (f, i) { sc.set(f.s, f.s, f.s); ps.set(f.x, f.y + 0.18 * f.s, f.z); m4.compose(ps, q, sc); gm.setMatrixAt(i, m4); gm.setColorAt(i, col.set(r() < 0.5 ? "#5fae45" : "#79c557")); });
      gm.instanceColor.needsUpdate = true; grp.add(gm);
    }
    if (rk.length) {
      var rm = new T.InstancedMesh(new T.IcosahedronGeometry(0.26, 0), new T.MeshStandardMaterial({ color: 0x8d9296, roughness: 1, flatShading: true }), rk.length);
      rk.forEach(function (f, i) { sc.set(f.s, f.s * 0.8, f.s); q.setFromAxisAngle(new T.Vector3(0, 1, 0), r() * 6.28); ps.set(f.x, f.y + 0.1 * f.s, f.z); m4.compose(ps, q, sc); rm.setMatrixAt(i, m4); });
      rm.castShadow = true; grp.add(rm); q.set(0, 0, 0, 1);
    }
    // street lamps (glow at night)
    var lampMat = new T.MeshStandardMaterial({ color: 0xffe9a8, emissive: new T.Color(0xffc861), emissiveIntensity: 0.15, roughness: 0.4 });
    mapObj.lampMat = lampMat;
    if (npcPlots.length) {
      var pole = new T.InstancedMesh(new T.CylinderGeometry(0.04, 0.05, 1.5, 6), new T.MeshStandardMaterial({ color: 0x2f3438, roughness: 0.6 }), npcPlots.length);
      var bulb = new T.InstancedMesh(new T.SphereGeometry(0.13, 8, 6), lampMat, npcPlots.length);
      npcPlots.forEach(function (p, i) { sc.set(1, 1, 1); ps.set(p.x * TS + 1.15, 0.55 + 0.75, p.z * TS + 1.15); m4.compose(ps, q, sc); pole.setMatrixAt(i, m4); ps.y = 0.55 + 1.55; m4.compose(ps, q, sc); bulb.setMatrixAt(i, m4); });
      pole.castShadow = true; grp.add(pole); grp.add(bulb);
    }
    // shoreline foam: land tiles touching water
    var fo = [];
    land.forEach(function (t) {
      if (t.type === "mountain") return;
      var n = [tileAt(t.x + 1, t.z), tileAt(t.x - 1, t.z), tileAt(t.x, t.z + 1), tileAt(t.x, t.z - 1)];
      if (n.some(function (u) { return !u || u.type === "water"; })) fo.push(t);
    });
    if (fo.length) {
      var fmesh = new T.InstancedMesh(new T.BoxGeometry(TS * 1.16, 0.04, TS * 1.16), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false }), fo.length);
      fo.forEach(function (t, i) { sc.set(1, 1, 1); ps.set(t.x * TS, 0.15, t.z * TS); m4.compose(ps, q, sc); fmesh.setMatrixAt(i, m4); });
      grp.add(fmesh); mapObj.foam = fmesh;
    } else mapObj.foam = null;
  }
  function makeFlies(scene, count, spread, cx, cz, y0) {
    var a = new Float32Array(count * 3), r = C.rng(5), base = [];
    for (var i = 0; i < count; i++) { var x = cx + (r() - 0.5) * spread, z = cz + (r() - 0.5) * spread, y = y0 + r() * 2.2; a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z; base.push([x, y, z, r() * 6.28]); }
    var g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(a, 3));
    var pts = new T.Points(g, new T.PointsMaterial({ color: 0xfff3a0, size: 0.38, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
    pts.frustumCulled = false; pts.userData.base = base; scene.add(pts); return pts;
  }
  function fliesFrame(pts, night, t) {
    if (!pts) return;
    pts.material.opacity = night * 0.9; pts.visible = night > 0.05; if (!pts.visible) return;
    var a = pts.geometry.attributes.position.array, b = pts.userData.base;
    for (var i = 0; i < b.length; i++) { var e = b[i]; a[i * 3] = e[0] + Math.sin(t * 0.6 + e[3]) * 0.8; a[i * 3 + 1] = e[1] + Math.sin(t * 1.1 + e[3] * 2) * 0.4; a[i * 3 + 2] = e[2] + Math.cos(t * 0.5 + e[3]) * 0.8; }
    pts.geometry.attributes.position.needsUpdate = true;
  }

  /* ---------------- characters ---------------- */
  function makeChar(color, hat) {
    var g = new T.Group(), skin = new T.MeshStandardMaterial({ color: 0xf1c7a0, roughness: 0.7 }), cloth = new T.MeshStandardMaterial({ color: color, roughness: 0.6 });
    var dark = new T.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.8 });
    var body = new T.Mesh(new T.CylinderGeometry(0.28, 0.34, 0.7, 10), cloth); body.position.y = 0.95; g.add(body);
    var head = new T.Mesh(new T.SphereGeometry(0.27, 14, 12), skin); head.position.y = 1.55; g.add(head);
    var eyeM = new T.MeshBasicMaterial({ color: 0x1a1a1a });
    [-0.09, 0.09].forEach(function (x) { var e = new T.Mesh(new T.SphereGeometry(0.035, 6, 6), eyeM); e.position.set(x, 1.6, 0.24); g.add(e); });
    function limb(x, y, len, mat) { var p = new T.Group(); p.position.set(x, y, 0); var m = new T.Mesh(new T.BoxGeometry(0.16, len, 0.16), mat); m.position.y = -len / 2; p.add(m); g.add(p); return p; }
    var legL = limb(-0.13, 0.6, 0.6, dark), legR = limb(0.13, 0.6, 0.6, dark), armL = limb(-0.38, 1.25, 0.55, cloth), armR = limb(0.38, 1.25, 0.55, cloth);
    if (hat === "crown") { var cr = new T.Mesh(new T.CylinderGeometry(0.2, 0.22, 0.16, 8, 1, true), new T.MeshStandardMaterial({ color: 0xf2c230, metalness: 0.8, roughness: 0.3, side: T.DoubleSide })); cr.position.y = 1.83; g.add(cr); }
    else if (hat === "cap") { var cp = new T.Mesh(new T.SphereGeometry(0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshStandardMaterial({ color: 0xe0554f })); cp.position.y = 1.6; g.add(cp); var br = new T.Mesh(new T.BoxGeometry(0.3, 0.03, 0.22), cp.material); br.position.set(0, 1.62, 0.3); g.add(br); }
    var shoeM = new T.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.8 });
    [legL, legR].forEach(function (lg) { var sh = new T.Mesh(new T.BoxGeometry(0.19, 0.09, 0.28), shoeM); sh.position.set(0, -0.58, 0.04); lg.add(sh); });
    if (!hat) { var hair = new T.Mesh(new T.SphereGeometry(0.285, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), new T.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.9 })); hair.position.set(0, 1.57, -0.015); g.add(hair); }
    var mouth = new T.Mesh(new T.BoxGeometry(0.1, 0.02, 0.02), new T.MeshBasicMaterial({ color: 0x8a3b30 })); mouth.position.set(0, 1.49, 0.26); g.add(mouth);
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; } });
    g.userData = { legL: legL, legR: legR, armL: armL, armR: armR, phase: Math.random() * 6 };
    g.scale.setScalar(0.85);
    return g;
  }
  function animChar(g, moving, dt) {
    var u = g.userData; u.phase += dt * (moving ? 9 : 2);
    var s = moving ? Math.sin(u.phase) * 0.7 : Math.sin(u.phase) * 0.05;
    u.legL.rotation.x = s; u.legR.rotation.x = -s; u.armL.rotation.x = -s * 0.8; u.armR.rotation.x = s * 0.8;
    g.children[0].position.y = 0.95 + (moving ? Math.abs(Math.sin(u.phase)) * 0.05 : 0);
  }
  var NPC_NAMES = ["أبو سالم التاجر", "مريم المعمارية", "الحارس خالد", "جدّة حليمة", "المزارع حسن", "رنا الرسامة", "الطاهي كريم", "الصياد ماجد", "المعلمة هدى", "الساعي فراس", "الشاعر عادل", "لينا المستكشفة"];
  var NPC_LINES = [
    "أهلاً بك في مدينتنا! هل جرّبت البناء على أرضك؟", "سمعت أن الأسعار ترتفع حين تزدهر الدولة.", "الأمان مهم، القرارات الحكيمة تحمينا.", "يا بني، المهام اليومية تجلب الخير!",
    "المسابقات المباشرة اليوم حماسية جداً!", "الطوب والقرميد يصنعان بيوتاً جميلة.", "هل زرت جزر الثلج؟ منظرها خلاب.", "اجمع دخل أراضيك كل يوم ولا تنسَ."
  ];

  /* ---------------- MAP scene ---------------- */
  var TYPE_COL = { grass: "#7fbf5a", sand: "#e3c88a", snow: "#eef5f8", forest: "#4f9d6b", mountain: "#8a8f8a", beach: "#ecd9a0", city: "#c9c1b0", water: "#2e86c1" };
  function buildMap() {
    sceneMap = new T.Scene(); mapObj.l = lights(sceneMap); mapObj.built = true;
    mapObj.sky = safe(function () { return makeSky(sceneMap); });
    mapObj.grp = new T.Group(); sceneMap.add(mapObj.grp);
    // ocean
    var og = new T.PlaneGeometry(W.size * TS + 300, W.size * TS + 300, 90, 90); og.rotateX(-Math.PI / 2);
    var water = new T.Mesh(og, new T.MeshStandardMaterial({ color: 0x2796d0, roughness: 0.06, metalness: 0.35, transparent: true, opacity: 0.84 }));
    water.position.set(W.size * TS / 2, 0.12, W.size * TS / 2); water.receiveShadow = true; sceneMap.add(water); mapObj.water = water; mapObj.wbase = og.attributes.position.array.slice();
    var floor = new T.Mesh(new T.PlaneGeometry(W.size * TS + 300, W.size * TS + 300).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({ color: 0x1b4f6b }));
    floor.position.set(W.size * TS / 2, -1.2, W.size * TS / 2); sceneMap.add(floor);
    // clouds
    mapObj.clouds = [];
    var cm = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92 });
    for (var i = 0; i < 12; i++) { var cg = new T.Group(); for (var k = 0; k < 4; k++) { var s = new T.Mesh(new T.SphereGeometry(2 + Math.random() * 1.5, 10, 8), cm); s.position.set(k * 2.4 - 3, Math.random(), Math.random() * 1.5); cg.add(s); } cg.position.set(Math.random() * W.size * TS, 26 + Math.random() * 8, Math.random() * W.size * TS); mapObj.clouds.push(cg); sceneMap.add(cg); }
    mapObj.flies = safe(function () { return makeFlies(sceneMap, 380, W.size * TS, W.size * TS / 2, W.size * TS / 2, 0.8); });
    rebuildMap();
    // characters
    player = makeChar(S.avatar.color, S.avatar.hat); player.pos = new T.Vector3(S.pos.x * TS, 0, S.pos.z * TS); player.target = null; sceneMap.add(player);
    var ring = new T.Mesh(new T.RingGeometry(0.55, 0.75, 24).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.85 })); ring.position.y = 0.05; player.add(ring);
    camState.tx = player.pos.x; camState.tz = player.pos.z;
    spawnNpcs();
  }
  function refreshPlayer() { if (!player) return; var p = player.pos, t = player.target; sceneMap.remove(player); var ring = player.children[player.children.length - 1]; player = makeChar(S.avatar.color, S.avatar.hat); player.pos = p; player.target = t; player.add(ring); sceneMap.add(player); }
  function spawnNpcs() {
    npcs.forEach(function (n) { sceneMap.remove(n); }); npcs = [];
    var r = C.rng(S.seed + 7), cols = [0xe0554f, 0x2bb3a3, 0xe8b54a, 0x7d6cff, 0x5fb35a, 0xd96aa8, 0x4f8cff, 0xf08a4b];
    var cities = []; W.countries.forEach(function (c) { c.cities.forEach(function (ct) { cities.push(ct); }); });
    for (var i = 0; i < Math.min(16, cities.length * 2); i++) {
      var ct = cities[i % cities.length], g = makeChar(cols[i % cols.length], i % 5 === 0 ? "cap" : "");
      g.pos = new T.Vector3((ct.x + r() * 3 - 1) * TS, 0, (ct.z + r() * 3 - 1) * TS); g.home = ct; g.target = null; g.wait = r() * 3;
      g.userData.name = NPC_NAMES[i % NPC_NAMES.length]; g.userData.npc = i;
      sceneMap.add(g); npcs.push(g);
    }
  }
  function disposeGroup(g) { g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }
  function rebuildMap() {
    var grp = mapObj.grp; disposeGroup(grp); while (grp.children.length) grp.remove(grp.children[0]);
    labels.forEach(function (l) { l.el.remove(); }); labels = [];
    var land = W.tiles.filter(function (t) { return t.type !== "water"; });
    var tex = noiseTex("#dcdcdc", {});
    var tm = new T.InstancedMesh(new T.BoxGeometry(TS, 1, TS), new T.MeshStandardMaterial({ map: tex, roughness: 0.95 }), land.length);
    var m4 = new T.Matrix4(), col = new T.Color(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3();
    mapObj.landTiles = land;
    land.forEach(function (t, i) {
      var hh = t.h + 0.6; sc.set(1, hh, 1); ps.set(t.x * TS, hh / 2 - 0.6, t.z * TS); m4.compose(ps, q, sc); tm.setMatrixAt(i, m4);
      var co = t.country && findCountry(t.country), base = t.type === "grass" && co ? co.color : TYPE_COL[t.type] || "#888";
      col.set(base);
      if (t.type === "mountain" && t.h > 2.3) col.set("#f2f4f5");
      var nv = ((t.x * 73856093) ^ (t.z * 19349663)) % 100 / 100; col.offsetHSL(0, 0, (nv - 0.5) * 0.06);
      if (t.plot && S.props[t.plot]) col.set("#e9d9a6");
      tm.setColorAt(i, col);
    });
    tm.instanceColor.needsUpdate = true; tm.receiveShadow = true; tm.castShadow = true; grp.add(tm); mapObj.terrain = tm;
    // trees
    var r = C.rng(S.seed + 3), trees = [];
    land.forEach(function (t) { if (!t.plot && t.type !== "city" && t.type !== "beach" && t.type !== "mountain") { var dens = t.type === "forest" ? 0.6 : t.type === "sand" ? 0.06 : 0.22; if (r() < dens) trees.push({ x: t.x * TS + (r() - 0.5) * 1.2, z: t.z * TS + (r() - 0.5) * 1.2, y: t.h, s: 0.7 + r() * 0.6, palm: t.type === "sand", snow: t.type === "snow" }); } });
    var trunk = new T.InstancedMesh(new T.CylinderGeometry(0.12, 0.18, 1, 6), new T.MeshStandardMaterial({ color: 0x6b4a2b }), trees.length);
    var leaf = new T.InstancedMesh(new T.ConeGeometry(0.75, 1.6, 7), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), trees.length);
    trees.forEach(function (t, i) {
      sc.set(t.s, t.s, t.s); ps.set(t.x, t.y + 0.5 * t.s, t.z); m4.compose(ps, q, sc); trunk.setMatrixAt(i, m4);
      ps.set(t.x, t.y + 1.6 * t.s, t.z); m4.compose(ps, q, sc); leaf.setMatrixAt(i, m4);
      leaf.setColorAt(i, col.set(t.snow ? "#e8f1ef" : t.palm ? "#7bb04a" : r() < 0.5 ? "#3f8f3a" : "#4fa548"));
    });
    if (trees.length) { leaf.instanceColor.needsUpdate = true; }
    trunk.castShadow = leaf.castShadow = true; grp.add(trunk); grp.add(leaf);
    var leaf2 = new T.InstancedMesh(new T.ConeGeometry(0.52, 1.1, 7), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), trees.length);
    trees.forEach(function (t, i) { sc.set(t.s, t.s, t.s); ps.set(t.x, t.y + 2.3 * t.s, t.z); m4.compose(ps, q, sc); leaf2.setMatrixAt(i, m4); leaf2.setColorAt(i, col.set(t.snow ? "#f4f9f8" : t.palm ? "#93c65a" : r() < 0.5 ? "#4a9d43" : "#5cb552")); });
    if (trees.length) leaf2.instanceColor.needsUpdate = true; leaf2.castShadow = true; grp.add(leaf2);
    // buildings + plots
    var npcPlots = [], freePlots = [], ownPlots = [];
    W.countries.forEach(function (c) { c.cities.forEach(function (ct) { ct.plots.forEach(function (p) { if (p.npc) npcPlots.push(p); else if (S.props[p.id]) ownPlots.push(p); else freePlots.push(p); }); }); });
    var wallTex = noiseTex("#ffffff", { window: 1 }), litTex = noiseTex("#000", { lit: 1 });
    var bm = new T.MeshStandardMaterial({ map: wallTex, emissiveMap: litTex, emissive: new T.Color(0xffd27a), emissiveIntensity: 0, roughness: 0.8 });
    mapObj.bmat = bm;
    var bmesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), bm, npcPlots.length);
    var roof = new T.InstancedMesh(new T.ConeGeometry(1.15, 0.8, 4), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, flatShading: true }), npcPlots.length);
    var hues = ["#f1e3c8", "#e8c9a8", "#d9e4ec", "#f2d0c4", "#e3e8cf", "#efe0b0"], roofs = ["#b9483a", "#3e6f8f", "#4e7d4b", "#8a5a3c", "#c27a2c"];
    var qr = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 4);
    npcPlots.forEach(function (p, i) {
      var hh = p.floors * 0.9; sc.set(1.5, hh, 1.5); ps.set(p.x * TS, 0.55 + hh / 2, p.z * TS); m4.compose(ps, q, sc); bmesh.setMatrixAt(i, m4);
      bmesh.setColorAt(i, col.set(hues[Math.floor(p.hue * hues.length)]));
      sc.set(1, 1, 1); ps.set(p.x * TS, 0.55 + hh + 0.4, p.z * TS); m4.compose(ps, qr, sc); roof.setMatrixAt(i, m4);
      roof.setColorAt(i, col.set(roofs[Math.floor(p.hue * 97) % roofs.length]));
    });
    if (npcPlots.length) { bmesh.instanceColor.needsUpdate = true; roof.instanceColor.needsUpdate = true; }
    bmesh.castShadow = bmesh.receiveShadow = roof.castShadow = true; grp.add(bmesh); grp.add(roof);
    safe(function () { addDecor(grp, land, npcPlots); });
    // for-sale signs
    var post = new T.InstancedMesh(new T.BoxGeometry(0.08, 0.9, 0.08), new T.MeshStandardMaterial({ color: 0x5a3b22 }), freePlots.length);
    var board = new T.InstancedMesh(new T.BoxGeometry(0.7, 0.4, 0.05), new T.MeshStandardMaterial({ color: 0xffd76a, emissive: 0x6b4a00, emissiveIntensity: 0.3 }), freePlots.length);
    freePlots.forEach(function (p, i) { sc.set(1, 1, 1); ps.set(p.x * TS + 0.5, 1, p.z * TS + 0.5); m4.compose(ps, q, sc); post.setMatrixAt(i, m4); ps.y = 1.35; m4.compose(ps, q, sc); board.setMatrixAt(i, m4); });
    post.castShadow = board.castShadow = true; grp.add(post); grp.add(board);
    // owned plots: render real voxels
    var vox = {};
    ownPlots.forEach(function (p) { (S.plots[p.id] || []).forEach(function (b) { (vox[b[3]] = vox[b[3]] || []).push([p, b]); }); });
    var vs = TS / C.VOX;
    Object.keys(vox).forEach(function (k) {
      var arr = vox[k], im = new T.InstancedMesh(new T.BoxGeometry(vs, vs, vs), blockMat(+k), arr.length);
      arr.forEach(function (e, i) { var p = e[0], b = e[1]; ps.set(p.x * TS - TS / 2 + (b[0] + 0.5) * vs, 0.55 + (b[1] + 0.5) * vs, p.z * TS - TS / 2 + (b[2] + 0.5) * vs); sc.set(1, 1, 1); m4.compose(ps, q, sc); im.setMatrixAt(i, m4); });
      im.castShadow = im.receiveShadow = true; grp.add(im);
    });
    var rings = new T.InstancedMesh(new T.RingGeometry(0.85, 1, 4, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 4), new T.MeshBasicMaterial({ color: 0xffd76a }), ownPlots.length);
    ownPlots.forEach(function (p, i) { sc.set(1.35, 1, 1.35); ps.set(p.x * TS, 0.58, p.z * TS); m4.compose(ps, q, sc); rings.setMatrixAt(i, m4); });
    grp.add(rings);
    // labels
    var lb = $("#lzr-lbls");
    W.countries.forEach(function (c) {
      var e = h("div", { class: "lbl cty" }, (c.custom ? "🏳️ " : "") + esc(c.name)); lb.appendChild(e); labels.push({ el: e, v: new T.Vector3(c.cx * TS, 5, c.cz * TS), far: 1 });
      c.cities.forEach(function (ct) { var e2 = h("div", { class: "lbl" }, "🏙️ " + esc(ct.name)); lb.appendChild(e2); labels.push({ el: e2, v: new T.Vector3(ct.x * TS + 1, 4, ct.z * TS + 1) }); });
    });
    updateFx();
  }

  /* ---------------- events fx ---------------- */
  function updateFx() {
    if (!sceneMap) return;
    if (fxObj.rain) { sceneMap.remove(fxObj.rain); fxObj.rain = null; }
    fxObj.fw = []; fxObj.dark = 0;
    curEvent = C.rollEvent(S, W, Date.now());
    var c = findCountry(curEvent.country); if (!c) return;
    fxObj.center = new T.Vector3(c.cx * TS, 0, c.cz * TS);
    fxObj.kind = curEvent.fx;
    if (curEvent.fx === "rain") {
      var n = 1500, g = new T.BufferGeometry(), a = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) { a[i * 3] = fxObj.center.x + (Math.random() - 0.5) * c.rad * TS * 2; a[i * 3 + 1] = Math.random() * 30; a[i * 3 + 2] = fxObj.center.z + (Math.random() - 0.5) * c.rad * TS * 2; }
      g.setAttribute("position", new T.BufferAttribute(a, 3));
      fxObj.rain = new T.Points(g, new T.PointsMaterial({ color: 0xbfe3ff, size: 0.18, transparent: true, opacity: 0.75 })); sceneMap.add(fxObj.rain);
    }
    badge();
  }
  function fireworks(dt) {
    if (fxObj.kind !== "fireworks" && fxObj.kind !== "gold") return;
    if (Math.random() < dt * (fxObj.kind === "gold" ? 0.8 : 1.6)) {
      var n = 60, g = new T.BufferGeometry(), a = new Float32Array(n * 3), v = [];
      var o = fxObj.center.clone().add(new T.Vector3((Math.random() - 0.5) * 20, 14 + Math.random() * 6, (Math.random() - 0.5) * 20));
      for (var i = 0; i < n; i++) { a[i * 3] = o.x; a[i * 3 + 1] = o.y; a[i * 3 + 2] = o.z; var d = new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 3); v.push(d); }
      g.setAttribute("position", new T.BufferAttribute(a, 3));
      var p = new T.Points(g, new T.PointsMaterial({ color: fxObj.kind === "gold" ? 0xffd76a : new T.Color().setHSL(Math.random(), 0.9, 0.6), size: 0.45, transparent: true }));
      p.userData = { v: v, t: 0 }; sceneMap.add(p); fxObj.fw.push(p);
    }
    fxObj.fw = fxObj.fw.filter(function (p) {
      p.userData.t += dt; var a = p.geometry.attributes.position.array;
      for (var i = 0; i < p.userData.v.length; i++) { var d = p.userData.v[i]; d.y -= 6 * dt; a[i * 3] += d.x * dt; a[i * 3 + 1] += d.y * dt; a[i * 3 + 2] += d.z * dt; }
      p.geometry.attributes.position.needsUpdate = true; p.material.opacity = 1 - p.userData.t / 1.6;
      if (p.userData.t > 1.6) { sceneMap.remove(p); p.geometry.dispose(); return false; } return true;
    });
  }

  /* ---------------- map interaction ---------------- */
  function hideInfo() { var i = $("#lzr-info"); if (i) i.classList.remove("on"); }
  function showInfo(html) { var i = $("#lzr-info"); i.innerHTML = html; i.classList.add("on"); }
  function showTileInfo(t) {
    if (t.plot) return showPlotInfo(findPlot(t.plot));
    var co = t.country && findCountry(t.country);
    var names = { grass: "سهول خضراء", sand: "صحراء", snow: "أرض ثلجية", forest: "غابة", mountain: "جبال", beach: "شاطئ", water: "بحر", city: "مدينة" };
    showInfo('<div class="row"><b class="grow">' + (co ? "🏳️ " + esc(co.name) : "🌊 المحيط") + '</b><button class="btn s" onclick="this.parentNode.parentNode.classList.remove(\'on\')">✕</button></div><small>' + names[t.type] + "</small>" + (co ? statBars(co.stats) : ""));
  }
  function showPlotInfo(p) {
    if (!p) return;
    var co = findCountry(p.country), ct = findCity(p.city), mine = S.props[p.id], price = C.plotPrice(p, co.stats);
    var body = p.npc ? "<small>🏢 مبنى من " + p.floors + " طوابق — يسكنه أهل المدينة</small>" :
      mine ? "<small>🏡 أرضك · " + (S.plots[p.id] || []).length + " حجر · " + C.plotRate(S, p.id) + ' 🪙/ساعة</small><div class="row" style="margin-top:8px"><button class="btn" data-bd2="1">🧱 ابنِ حجراً بحجر</button></div>' :
      "<small>🪧 أرض للبيع — السعر يتغير مع ازدهار الدولة</small>" + '<div class="row" style="margin-top:8px"><button class="btn" data-buyp="1">اشترِ بـ ' + price + " 🪙</button></div>";
    showInfo('<div class="row"><b class="grow">🏙️ ' + esc(ct.name) + " · " + esc(co.name) + '</b><button class="btn s" data-x="1">✕</button></div>' + body + statBars(co.stats));
    var i = $("#lzr-info");
    i.querySelector("[data-x]").onclick = hideInfo;
    var bp = i.querySelector("[data-buyp]"); if (bp) bp.onclick = function () { var r = C.buyPlot(S, p, co.stats); if (!r.ok) return toast("⚠️ " + r.err); gainXp(40); save(); rebuildMap(); toast("🏡 أصبحت مالك أرض في " + ct.name + "!"); showPlotInfo(p); };
    var bd = i.querySelector("[data-bd2]"); if (bd) bd.onclick = function () { hideInfo(); enterBuild(p.id); };
  }
  function talkNpc(n) {
    var day = C.dayKey(Date.now()), key = "n" + day + n.userData.npc, first = !S.met[key];
    var line = NPC_LINES[(n.userData.npc + (first ? 0 : 3)) % NPC_LINES.length];
    if (first) { S.met[key] = 1; quest("talk_npc"); S.coins += 10; gainXp(10); save(); }
    var keys = Object.keys(S.met); if (keys.length > 200) keys.slice(0, 100).forEach(function (k) { delete S.met[k]; });
    showInfo('<div class="row"><b class="grow">🗣️ ' + esc(n.userData.name) + '</b><button class="btn s" data-x="1">✕</button></div><p style="margin:8px 0">«' + esc(line) + "»</p>" + (first ? '<span class="tag">+10 🪙 +10 XP</span>' : "") +
      (curEvent && S.events.done.indexOf(curEvent.key) < 0 ? '<p class=mut>📰 ' + esc(curEvent.title) + '</p><button class="btn" data-evo="1">ساعدنا في القرار</button>' : ""));
    var i = $("#lzr-info"); i.querySelector("[data-x]").onclick = hideInfo;
    var eo = i.querySelector("[data-evo]"); if (eo) eo.onclick = function () { openTab("events"); };
  }

  /* ---------------- pointer controls (map + build) ---------------- */
  var ptrs = {}, drag = null, pinch = 0;
  function bindPointer(cv) {
    cv.addEventListener("pointerdown", function (e) { cv.setPointerCapture(e.pointerId); ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, btn: e.button }; pinch = 0; });
    cv.addEventListener("pointermove", function (e) {
      if (!ptrs[e.pointerId]) { if (mode === "build") hoverBuild(e); return; }
      var ids = Object.keys(ptrs);
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) { var k = pinch / d; if (mode === "map") camState.dist = C.clamp(camState.dist * k, 16, 120); else bCam.dist = C.clamp(bCam.dist * k, 10, 60); }
        pinch = d; drag.moved = 99; return;
      }
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved < 8) return;
      if (mode === "map") {
        if (drag.btn === 2 || e.shiftKey) { camState.yaw -= dx * 0.008; camState.pitch = C.clamp(camState.pitch + dy * 0.005, 0.45, 1.35); }
        else { var s = camState.dist * 0.0022, cy = Math.cos(camState.yaw), sy = Math.sin(camState.yaw); camState.tx -= (dx * cy - dy * sy) * s * 1.0 * -1 * -1; camState.tz -= (-dx * sy - dy * cy) * s * -1 * -1; camState.tx = C.clamp(camState.tx, 0, W.size * TS); camState.tz = C.clamp(camState.tz, 0, W.size * TS); }
      } else { bCam.yaw -= dx * 0.008; bCam.pitch = C.clamp(bCam.pitch + dy * 0.006, 0.15, 1.45); }
    });
    function up(e) {
      delete ptrs[e.pointerId];
      if (drag && drag.moved < 8 && Object.keys(ptrs).length === 0) { if (mode === "map") tapMap(e); else tapBuild(e); }
      if (!Object.keys(ptrs).length) drag = null;
    }
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", function (e) { delete ptrs[e.pointerId]; drag = null; });
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    cv.addEventListener("wheel", function (e) {
      e.preventDefault();
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1), k = Math.exp(dy * 0.0015);
      if (mode === "map") camState.dist = C.clamp(camState.dist * k, 16, 120); else bCam.dist = C.clamp(bCam.dist * k, 10, 60);
    }, { passive: false });
    addEventListener("keydown", function (e) {
      if (!opened || e.target.tagName === "INPUT") return;
      var k = e.key.toLowerCase(), st = 2;
      if (mode === "map") {
        var cy = Math.cos(camState.yaw), sy = Math.sin(camState.yaw);
        if (k === "w" || k === "arrowup") { camState.tx -= sy * st; camState.tz -= cy * st; }
        if (k === "s" || k === "arrowdown") { camState.tx += sy * st; camState.tz += cy * st; }
        if (k === "a" || k === "arrowleft") { camState.tx -= cy * st; camState.tz += sy * st; }
        if (k === "d" || k === "arrowright") { camState.tx += cy * st; camState.tz -= sy * st; }
      } else if (k === "z" && (e.ctrlKey || e.metaKey)) undoBuild();
      if (k === "escape") { if (mode === "build") exitBuild(); else close(); }
    });
  }
  var ray = null, ndc = null;
  function setRay(e) { var r = gl.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam); }
  function tapMap(e) {
    setRay(e);
    var hits = ray.intersectObjects(npcs, true);
    if (hits.length) { var o = hits[0].object; while (o.parent && !o.userData.name) o = o.parent; return talkNpc(o); }
    var th = ray.intersectObject(mapObj.terrain);
    var t;
    if (th.length && th[0].instanceId != null) t = mapObj.landTiles[th[0].instanceId];
    else { var p = new T.Vector3(); if (ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -0.1), p)) t = tileAt(p.x / TS, p.z / TS); }
    if (!t) return;
    showTileInfo(t);
    if (t.type !== "water") {
      player.target = new T.Vector3(t.x * TS + (t.plot ? 0.9 : 0), t.h, t.z * TS + (t.plot ? 0.9 : 0)); quest("walk");
      S.pos = { x: t.x, z: t.z };
      if (t.city) { var key = "v" + C.dayKey(Date.now()) + t.city; if (!S.met[key]) { S.met[key] = 1; quest("visit_city"); gainXp(5); toast("🏙️ وصلت إلى " + findCity(t.city).name); } }
      save();
    }
  }

  /* ---------------- BUILD scene ---------------- */
  var bState = { plot: null, ro: false, map: {}, sel: 3, tool: "place", undo: [], placed: 0, meshes: [], hover: null };
  function key3(x, y, z) { return x + "," + y + "," + z; }
  function enterBuild(plotId, visit) {
    mode = "build"; root.classList.add("build"); hideInfo();
    bState.plot = plotId; bState.ro = !!visit; bState.map = {}; bState.undo = []; bState.placed = 0;
    (visit ? visit.blocks : S.plots[plotId] || []).forEach(function (b) { bState.map[key3(b[0], b[1], b[2])] = b[3]; });
    if (!sceneBuild) buildBuildScene();
    var co = plotId ? findCountry(findPlot(plotId).country) : null;
    buildObj.ground.material.color.set(co && co.biome === "snow" ? "#e8f0f3" : co && co.biome === "sand" ? "#e3c88a" : "#7fbf5a");
    refreshVox(); toolbar();
    toast(visit ? "🏡 تزور أرض " + visit.owner : "🧱 اضغط لوضع حجر — اسحب لتدوير الكاميرا");
  }
  function buildBuildScene() {
    sceneBuild = new T.Scene(); buildObj.l = lights(sceneBuild);
    buildObj.sky = safe(function () { return makeSky(sceneBuild); });
    buildObj.l.sun.position.set(20, 30, 14); buildObj.l.sun.target.position.set(0, 0, 0);
    var sc = buildObj.l.sun.shadow.camera; sc.left = sc.bottom = -16; sc.right = sc.top = 16; sc.near = 1; sc.far = 80; sc.updateProjectionMatrix();
    var island = new T.Mesh(new T.CylinderGeometry(26, 22, 3, 40), new T.MeshStandardMaterial({ map: noiseTex("#7fbf5a", { flat: 1 }), roughness: 1 }));
    island.position.y = -1.5; island.receiveShadow = true; sceneBuild.add(island); buildObj.ground = island;
    safe(function () {
      var under = new T.Mesh(new T.CylinderGeometry(22, 12, 6, 28), new T.MeshStandardMaterial({ map: noiseTex("#8a5f3c", {}), roughness: 1, flatShading: true }));
      under.position.y = -6; under.castShadow = true; sceneBuild.add(under);
      var rr = C.rng(31), m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), col = new T.Color(), nf = 90;
      var flw = new T.InstancedMesh(new T.SphereGeometry(0.12, 6, 5), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), nf), fc = ["#ff6b81", "#ffd23a", "#ffffff", "#b983ff", "#ff9f43"];
      var tuf = new T.InstancedMesh(new T.ConeGeometry(0.11, 0.55, 4), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), 220);
      for (var i = 0; i < nf; i++) { var a = rr() * 6.283, d = 9.5 + rr() * 14; sc.set(1, 1, 1); ps.set(Math.cos(a) * d, 0.14, Math.sin(a) * d); m4.compose(ps, q, sc); flw.setMatrixAt(i, m4); flw.setColorAt(i, col.set(fc[Math.floor(rr() * fc.length)])); }
      for (var j = 0; j < 220; j++) { var b = rr() * 6.283, e = 9.5 + rr() * 15, k = 0.7 + rr() * 0.9; sc.set(k, k, k); ps.set(Math.cos(b) * e, 0.22 * k, Math.sin(b) * e); m4.compose(ps, q, sc); tuf.setMatrixAt(j, m4); tuf.setColorAt(j, col.set(rr() < 0.5 ? "#5fae45" : "#79c557")); }
      flw.instanceColor.needsUpdate = true; tuf.instanceColor.needsUpdate = true; sceneBuild.add(flw); sceneBuild.add(tuf);
      var lm = new T.MeshStandardMaterial({ color: 0xffe9a8, emissive: new T.Color(0xffc861), emissiveIntensity: 0.15 }); buildObj.lampMat = lm;
      [[-8.6, -8.6], [8.6, -8.6], [-8.6, 8.6], [8.6, 8.6]].forEach(function (c) {
        var pl = new T.Mesh(new T.CylinderGeometry(0.07, 0.09, 2.6, 6), new T.MeshStandardMaterial({ color: 0x2f3438 })); pl.position.set(c[0], 1.3, c[1]); pl.castShadow = true; sceneBuild.add(pl);
        var bb = new T.Mesh(new T.SphereGeometry(0.28, 10, 8), lm); bb.position.set(c[0], 2.75, c[1]); sceneBuild.add(bb);
      });
      buildObj.flies = makeFlies(sceneBuild, 140, 40, 0, 0, 0.6);
    });
    var plate = new T.Mesh(new T.BoxGeometry(16, 0.2, 16), new T.MeshStandardMaterial({ color: 0xcdbf9e, roughness: 0.9 })); plate.position.y = -0.1; plate.receiveShadow = true; sceneBuild.add(plate); buildObj.plate = plate;
    var grid = new T.GridHelper(16, 16, 0x6b5b3a, 0x8d7c58); grid.position.y = 0.01; grid.material.transparent = true; grid.material.opacity = 0.45; sceneBuild.add(grid);
    var sea = new T.Mesh(new T.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({ color: 0x2a8cc4, roughness: 0.15, transparent: true, opacity: 0.9 })); sea.position.y = -1.2; sceneBuild.add(sea);
    // surrounding trees for the same living look as the map
    var r = C.rng(11), n = 34, trunk = new T.InstancedMesh(new T.CylinderGeometry(0.2, 0.3, 1.6, 6), new T.MeshStandardMaterial({ color: 0x6b4a2b }), n), leaf = new T.InstancedMesh(new T.ConeGeometry(1.2, 2.6, 7), new T.MeshStandardMaterial({ color: 0x3f8f3a, flatShading: true }), n);
    var m4 = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(1, 1, 1), p = new T.Vector3();
    for (var i = 0; i < n; i++) { var a = r() * Math.PI * 2, d = 12 + r() * 11, k = 0.8 + r() * 0.7; s.set(k, k, k); p.set(Math.cos(a) * d, 0.8 * k, Math.sin(a) * d); m4.compose(p, q, s); trunk.setMatrixAt(i, m4); p.y = 2.6 * k; m4.compose(p, q, s); leaf.setMatrixAt(i, m4); }
    trunk.castShadow = leaf.castShadow = true; sceneBuild.add(trunk); sceneBuild.add(leaf);
    var cm = new T.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    buildObj.clouds = [];
    for (var c = 0; c < 6; c++) { var cg = new T.Group(); for (var j = 0; j < 4; j++) { var sp = new T.Mesh(new T.SphereGeometry(2 + r() * 1.5, 10, 8), cm); sp.position.set(j * 2.4, r(), r()); cg.add(sp); } cg.position.set((r() - 0.5) * 120, 22 + r() * 8, (r() - 0.5) * 120); sceneBuild.add(cg); buildObj.clouds.push(cg); }
    buildObj.meshes = BLOCKS.map(function (b, i) { var m = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), blockMat(i), 4096); m.count = 0; m.castShadow = !b.glass && !b.water; m.receiveShadow = true; m.userData.type = i; m.userData.keys = []; sceneBuild.add(m); return m; });
    var ghost = new T.Mesh(new T.BoxGeometry(1.02, 1.02, 1.02), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false }));
    var edges = new T.LineSegments(new T.EdgesGeometry(ghost.geometry), new T.LineBasicMaterial({ color: 0xffe3a0 })); ghost.add(edges); ghost.visible = false; sceneBuild.add(ghost); buildObj.ghost = ghost;
  }
  function refreshVox() {
    var m4 = new T.Matrix4();
    buildObj.meshes.forEach(function (m) { m.count = 0; m.userData.keys = []; });
    Object.keys(bState.map).forEach(function (k) {
      var t = bState.map[k], m = buildObj.meshes[t]; if (!m || m.count >= 4096) return;
      var p = k.split(",").map(Number); m4.makeTranslation(p[0] - 8 + 0.5, p[1] + 0.5, p[2] - 8 + 0.5);
      m.setMatrixAt(m.count, m4); m.userData.keys.push(k); m.count++;
    });
    buildObj.meshes.forEach(function (m) { m.instanceMatrix.needsUpdate = true; });
    var cnt = $("#lzr-bcnt"); if (cnt) cnt.textContent = Object.keys(bState.map).length + " حجر";
  }
  function pickBuild(e) {
    setRay(e);
    var hits = ray.intersectObjects(buildObj.meshes.concat([buildObj.plate]));
    if (!hits.length) return null;
    var h0 = hits[0];
    if (h0.object === buildObj.plate) { var x = Math.floor(h0.point.x + 8), z = Math.floor(h0.point.z + 8); if (x < 0 || z < 0 || x > 15 || z > 15) return null; return { place: [x, 0, z], hit: null }; }
    var k = h0.object.userData.keys[h0.instanceId]; if (!k) return null;
    var p = k.split(",").map(Number), n = h0.face.normal;
    return { hit: p, place: [p[0] + Math.round(n.x), p[1] + Math.round(n.y), p[2] + Math.round(n.z)] };
  }
  function inBounds(p) { return p[0] >= 0 && p[2] >= 0 && p[0] < 16 && p[2] < 16 && p[1] >= 0 && p[1] < 16; }
  function hoverBuild(e) {
    if (bState.ro) return;
    var r = pickBuild(e), g = buildObj.ghost;
    if (!r) { g.visible = false; return; }
    var p = bState.tool === "place" ? r.place : r.hit; if (!p || !inBounds(p)) { g.visible = false; return; }
    g.position.set(p[0] - 8 + 0.5, p[1] + 0.5, p[2] - 8 + 0.5); g.visible = true;
    g.material.color.set(bState.tool === "erase" ? 0xff5a4f : BLOCKS[bState.sel].c);
  }
  function setBlock(p, t, rec) {
    var k = key3(p[0], p[1], p[2]), prev = bState.map[k];
    if (prev === t) return false;
    if (t != null && BLOCKS[t].prem) { if ((S.inv[t] || 0) < 1) { toast("💎 نفد " + BLOCKS[t].n + " — اشترِ المزيد من المتجر"); return false; } S.inv[t]--; }
    if (prev != null && BLOCKS[prev].prem) S.inv[prev] = (S.inv[prev] || 0) + 1;
    if (t == null) delete bState.map[k]; else bState.map[k] = t;
    if (rec) rec.push([k, prev, t]);
    return true;
  }
  function tapBuild(e) {
    if (bState.ro) return;
    var r = pickBuild(e); if (!r) return;
    var rec = [];
    if (bState.tool === "place") { if (!inBounds(r.place)) return toast("الحد الأقصى للبناء 16×16×16"); if (Object.keys(bState.map).length >= 3000) return toast("وصلت للحد الأقصى من الأحجار"); if (setBlock(r.place, bState.sel, rec)) bState.placed++; }
    else if (bState.tool === "erase" && r.hit) setBlock(r.hit, null, rec);
    else if (bState.tool === "paint" && r.hit) setBlock(r.hit, bState.sel, rec);
    else if (bState.tool === "pick" && r.hit) { bState.sel = bState.map[key3(r.hit[0], r.hit[1], r.hit[2])]; bState.tool = "place"; toolbar(); return; }
    if (rec.length) { bState.undo.push(rec); refreshVox(); markDirty(); if (navigator.vibrate) try { navigator.vibrate(8); } catch (er) {} }
  }
  function undoBuild() {
    var rec = bState.undo.pop(); if (!rec) return toast("لا يوجد ما يُتراجع عنه");
    rec.reverse().forEach(function (r) {
      var cur = bState.map[r[0]];
      if (cur != null && BLOCKS[cur].prem) S.inv[cur] = (S.inv[cur] || 0) + 1;
      if (r[1] != null && BLOCKS[r[1]].prem) S.inv[r[1]] = Math.max(0, (S.inv[r[1]] || 0) - 1);
      if (r[1] == null) delete bState.map[r[0]]; else bState.map[r[0]] = r[1];
    });
    refreshVox(); markDirty(); toolbar();
  }
  var STAMPS = {
    house: function (o) { var L = []; for (var x = 0; x < 6; x++) for (var z = 0; z < 6; z++) for (var y = 0; y < 4; y++) { var edge = x === 0 || z === 0 || x === 5 || z === 5; if (!edge) continue; var door = z === 0 && (x === 2 || x === 3) && y < 2, win = (x === 0 || x === 5) && z === 2 && y === 2; if (door) continue; L.push([x, y, z, win ? 6 : y === 0 ? 2 : 5]); } for (var r = 0; r < 4; r++) for (var x2 = r - 1; x2 < 7 - r; x2++) for (var z2 = -1; z2 < 7; z2++) if (x2 === r - 1 || x2 === 6 - r) L.push([x2, 4 + r, z2, 13]); for (var x3 = 0; x3 < 6; x3++) for (var z3 = 0; z3 < 6; z3++) L.push([x3, 0, z3, 5]); return L.map(function (b) { return [b[0] + o[0], b[1] + o[1], b[2] + o[2], b[3]]; }); },
    tower: function (o) { var L = []; for (var y = 0; y < 10; y++) for (var x = 0; x < 3; x++) for (var z = 0; z < 3; z++) if (x !== 1 || z !== 1 || y === 0) L.push([x + o[0], y + o[1], z + o[2], y % 3 === 2 && x === 1 ? 6 : 2]); L.push([1 + o[0], 10 + o[1], 1 + o[2], 15]); return L; },
    tree: function (o) { var L = []; for (var y = 0; y < 4; y++) L.push([o[0] + 1, o[1] + y, o[2] + 1, 4]); for (var x = 0; x < 3; x++) for (var z = 0; z < 3; z++) for (var y2 = 3; y2 < 6; y2++) if (!(x === 1 && z === 1 && y2 < 4) && !(y2 === 5 && (x !== 1 && z !== 1))) L.push([o[0] + x, o[1] + y2, o[2] + z, 11]); return L; },
    pool: function (o) { var L = []; for (var x = 0; x < 5; x++) for (var z = 0; z < 4; z++) L.push([o[0] + x, o[1], o[2] + z, x === 0 || z === 0 || x === 4 || z === 3 ? 14 : 8]); return L; }
  };
  function stamp(name) {
    var base = [5, 0, 5]; if (name === "tower") base = [1, 0, 1]; if (name === "tree") base = [12, 0, 12]; if (name === "pool") base = [10, 0, 1];
    var rec = [], list = STAMPS[name](base), skipped = 0;
    list.forEach(function (b) { if (inBounds(b)) { if (setBlock(b, b[3], rec)) bState.placed++; else if (BLOCKS[b[3]].prem) skipped++; } });
    if (rec.length) { bState.undo.push(rec); refreshVox(); markDirty(); }
    toast(skipped ? "تم البناء — بعض الأحجار المميزة نفدت" : "✨ تم وضع القالب");
    toolbar();
  }
  var dirty = false;
  function markDirty() { dirty = true; var b = $("#lzr-bsave"); if (b) b.textContent = "💾 حفظ *"; }
  function saveBuild(silent) {
    if (bState.ro || !bState.plot) return;
    S.plots[bState.plot] = Object.keys(bState.map).map(function (k) { var p = k.split(",").map(Number); return [p[0], p[1], p[2], bState.map[k]]; });
    if (bState.placed) { quest("place_blocks", bState.placed); gainXp(Math.floor(bState.placed / 4)); bState.placed = 0; }
    dirty = false; save(); var b = $("#lzr-bsave"); if (b) b.textContent = "💾 حفظ";
    if (!silent) toast("✅ تم حفظ بنائك");
  }
  function exitBuild() {
    if (dirty) saveBuild(true);
    mode = "map"; root.classList.remove("build"); buildObj.ghost.visible = false; rebuildMap();
  }
  function toolbar() {
    var tb = $("#lzr-tb"), pal = $("#lzr-pal");
    if (bState.ro) { tb.innerHTML = '<button data-bt="exit">⬅️ رجوع للخريطة</button><span class="mut" style="align-self:center">👀 وضع الزيارة</span>'; pal.innerHTML = ""; }
    else {
      tb.innerHTML = '<button data-bt="exit">⬅️ الخريطة</button>' +
        [["place", "🧱 بناء"], ["erase", "🧹 هدم"], ["paint", "🎨 تلوين"], ["pick", "💧 التقاط"]].map(function (t) { return '<button data-bt="' + t[0] + '" class="' + (bState.tool === t[0] ? "on" : "") + '">' + t[1] + "</button>"; }).join("") +
        '<button data-bt="undo">↩️ تراجع</button><button data-bt="floor">🟫 أرضية</button><button data-st="house">🏠 بيت</button><button data-st="tower">🗼 برج</button><button data-st="tree">🌳 شجرة</button><button data-st="pool">🏊 مسبح</button><button data-bt="clear">🗑️ مسح</button><button data-bt="save" id="lzr-bsave">💾 حفظ</button><span class="mut" id="lzr-bcnt" style="align-self:center;white-space:nowrap"></span>';
      pal.innerHTML = BLOCKS.map(function (b, i) { return '<button data-blk="' + i + '" class="' + (bState.sel === i ? "on" : "") + '" title="' + b.n + '" style="background:' + b.c + '">' + (b.prem ? "<em>" + (S.inv[i] || 0) + "</em>" : "") + "</button>"; }).join("");
    }
    tb.querySelectorAll("[data-bt]").forEach(function (b) {
      b.onclick = function () {
        var a = b.getAttribute("data-bt");
        if (a === "exit") return exitBuild();
        if (a === "undo") return undoBuild();
        if (a === "save") return saveBuild();
        if (a === "clear") { if (!confirm("مسح كل الأحجار في هذه الأرض؟")) return; var rec = []; Object.keys(bState.map).forEach(function (k) { setBlock(k.split(",").map(Number), null, rec); }); bState.undo.push(rec); refreshVox(); markDirty(); return toolbar(); }
        if (a === "floor") { var rec2 = []; for (var x = 0; x < 16; x++) for (var z = 0; z < 16; z++) if (bState.map[key3(x, 0, z)] == null) { if (setBlock([x, 0, z], bState.sel, rec2)) bState.placed++; } if (rec2.length) { bState.undo.push(rec2); refreshVox(); markDirty(); } return toolbar(); }
        bState.tool = a; toolbar();
      };
    });
    tb.querySelectorAll("[data-st]").forEach(function (b) { b.onclick = function () { stamp(b.getAttribute("data-st")); }; });
    pal.querySelectorAll("[data-blk]").forEach(function (b) { b.onclick = function () { bState.sel = +b.getAttribute("data-blk"); if (bState.tool === "erase" || bState.tool === "pick") bState.tool = "place"; toolbar(); }; });
    refreshVox();
  }

  /* ---------------- render loop ---------------- */
  var tmpV;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    var dt = Math.min(0.05, (now - (clock.last || now)) / 1000); clock.last = now; clock.t += dt;
    var day = (Date.now() / 240000) % 1, ang = day * Math.PI * 2, night = C.clamp(-Math.sin(ang) * 1.6, 0, 1);
    var skyDay = new T.Color(0xa7d8f0), skyNight = new T.Color(0x1a2a4a), sky = skyDay.clone().lerp(skyNight, night);
    var dusk = Math.pow(C.clamp(1 - Math.abs(Math.sin(ang)) * 2.5, 0, 1), 1.5);
    if (dusk > 0.01) sky.lerp(tmpC.set(0xf0a070), dusk * 0.35 * (1 - night));
    if (fxObj.kind === "rain" || fxObj.kind === "night") sky.lerp(new T.Color(0x56616b), 0.25);
    var sc = mode === "map" ? sceneMap : sceneBuild, L = mode === "map" ? mapObj.l : buildObj.l;
    sc.background.copy(sky); sc.fog.color.copy(sky);
    L.sun.intensity = 1.35 * (1 - night * 0.8); L.hemi.intensity = 0.7 - night * 0.35;
    L.sun.color.setHSL(0.1 - dusk * 0.04, 0.6 + dusk * 0.25, 0.85 - night * 0.2 - dusk * 0.08);
    if (L.rim) L.rim.intensity = 0.28 * (0.4 + night * 0.9);
    safe(function () { skyFrame(mode === "map" ? mapObj.sky : buildObj.sky, L, sky, night, dusk); });
    if (mode === "map") {
      var cy = Math.cos(camState.yaw), sy = Math.sin(camState.yaw), cp = Math.cos(camState.pitch), sp = Math.sin(camState.pitch);
      cam.position.set(camState.tx + sy * cp * camState.dist, sp * camState.dist, camState.tz + cy * cp * camState.dist);
      cam.lookAt(camState.tx, 0, camState.tz);
      var sx = Math.cos(ang) * 60, sz = Math.sin(ang * 0.5) * 30, syy = Math.max(15, Math.abs(Math.sin(ang)) * 70);
      L.sun.position.set(camState.tx + sx, syy, camState.tz + 30 + sz); L.sun.target.position.set(camState.tx, 0, camState.tz);
      var shc = L.sun.shadow.camera, ext = C.clamp(camState.dist * 0.75, 20, 70); shc.left = shc.bottom = -ext; shc.right = shc.top = ext; shc.near = 1; shc.far = 220; shc.updateProjectionMatrix();
      if (mapObj.bmat) mapObj.bmat.emissiveIntensity = night * 1.2;
      // water waves
      var wa = mapObj.water.geometry.attributes.position.array, wb = mapObj.wbase;
      for (var i = 1; i < wa.length; i += 3) wa[i] = Math.sin(wb[i - 1] * 0.15 + clock.t * 1.4) * 0.12 + Math.cos(wb[i + 1] * 0.12 + clock.t) * 0.1;
      mapObj.water.geometry.attributes.position.needsUpdate = true;
      mapObj.wf = (mapObj.wf || 0) + 1; if (mapObj.wf % 3 === 0) mapObj.water.geometry.computeVertexNormals();
      if (mapObj.lampMat) mapObj.lampMat.emissiveIntensity = 0.15 + night * 2.2;
      if (mapObj.foam) mapObj.foam.material.opacity = 0.3 + Math.sin(clock.t * 1.8) * 0.12;
      fliesFrame(mapObj.flies, night, clock.t);
      mapObj.clouds.forEach(function (c) { c.position.x += dt * 1.2; if (c.position.x > W.size * TS + 40) c.position.x = -40; });
      moveChar(player, dt, 4.2);
      npcs.forEach(function (n) {
        if (!n.target) { n.wait -= dt; if (n.wait <= 0) { var t = tileAt(n.home.x + Math.floor(Math.random() * 5) - 2, n.home.z + Math.floor(Math.random() * 5) - 2); if (t && t.type !== "water" && t.type !== "mountain") n.target = new T.Vector3(t.x * TS + (Math.random() - 0.5), t.h, t.z * TS + (Math.random() - 0.5)); n.wait = 1 + Math.random() * 4; } }
        moveChar(n, dt, 1.8);
      });
      if (fxObj.rain) { var ra = fxObj.rain.geometry.attributes.position.array; for (var j = 1; j < ra.length; j += 3) { ra[j] -= dt * 28; if (ra[j] < 0) ra[j] = 30; } fxObj.rain.geometry.attributes.position.needsUpdate = true; }
      fireworks(dt);
      // labels
      var w = root.clientWidth, hh = root.clientHeight;
      labels.forEach(function (l) {
        tmpV.copy(l.v).project(cam);
        var vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 && (l.far ? camState.dist > 30 : camState.dist < 75);
        l.el.style.display = vis ? "" : "none";
        if (vis) l.el.style.transform = "translate(" + ((tmpV.x * 0.5 + 0.5) * w) + "px," + ((-tmpV.y * 0.5 + 0.5) * hh) + "px) translate(-50%,-50%)";
      });
    } else {
      var by = bCam.yaw, bp = bCam.pitch;
      cam.position.set(Math.sin(by) * Math.cos(bp) * bCam.dist, 4 + Math.sin(bp) * bCam.dist, Math.cos(by) * Math.cos(bp) * bCam.dist);
      cam.lookAt(0, 3, 0);
      L.sun.position.set(Math.cos(ang) * 22, Math.max(12, Math.abs(Math.sin(ang)) * 32), 14); 
      buildObj.clouds.forEach(function (c) { c.position.x += dt; if (c.position.x > 70) c.position.x = -70; });
      if (buildObj.lampMat) buildObj.lampMat.emissiveIntensity = 0.15 + night * 2.2;
      fliesFrame(buildObj.flies, night, clock.t);
    }
    gl.render(sc, cam);
  }
  function moveChar(g, dt, speed) {
    var moving = false;
    if (g.target) {
      tmpV.copy(g.target).sub(g.pos); tmpV.y = 0; var d = tmpV.length();
      if (d < 0.08) { g.target = null; }
      else { moving = true; tmpV.normalize(); var step = Math.min(d, speed * dt); g.pos.x += tmpV.x * step; g.pos.z += tmpV.z * step; var want = Math.atan2(tmpV.x, tmpV.z), da = ((want - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI; g.rotation.y += da * Math.min(1, dt * 10); }
    }
    var t = tileAt(g.pos.x / TS, g.pos.z / TS), gy = t ? (t.type === "water" ? 0 : t.h) : 0;
    g.pos.y += (gy - g.pos.y) * Math.min(1, dt * 10);
    g.position.copy(g.pos);
    animChar(g, moving, dt);
  }

  /* ---------------- open / close ---------------- */
  var evTimer = 0;
  function open() {
    if (opened) return; opened = true;
    if (!S) load();
    if (!root) shell(); else root.style.display = "";
    hud(); badge();
    try { history.pushState({ lzr: 1 }, "", location.pathname + location.search + "#realm"); } catch (e) {}
    loadThree().then(function () {
      if (!gl) { W = C.buildWorld(S); makeStage(); ray = new THREE.Raycaster(); ndc = new THREE.Vector2(); tmpV = new THREE.Vector3(); buildMap(); }
      resize();
      var ld = $("#lzr-ld"); if (ld) ld.remove();
      cancelAnimationFrame(raf); clock.last = 0; raf = requestAnimationFrame(frame);
      cloudLoad();
      var pend = C.pendingIncome(S, Date.now());
      if (S.daily.last !== C.dayKey(Date.now())) toast("🎁 مكافأتك اليومية بانتظارك في المهام");
      else if (pend > 20) toast("💰 لديك " + pend + " عملة دخل جاهزة في ممتلكاتي");
      clearInterval(evTimer); evTimer = setInterval(function () { var k = curEvent && curEvent.key; var ev = C.rollEvent(S, W, Date.now()); if (ev.key !== k) { updateFx(); toast("📰 حدث جديد: " + curEvent.title); } }, 30000);
    }).catch(function () {
      var ld = $("#lzr-ld"); if (ld) ld.innerHTML = "<b>⚠️ تعذّر تحميل محرك العالم</b><small>تحقق من الاتصال بالإنترنت ثم أعد المحاولة</small><br><button class='btn' onclick='LahzaRealm.close()'>رجوع</button>";
    });
  }
  function close() {
    if (!opened) return; opened = false;
    if (mode === "build" && dirty) saveBuild(true);
    cancelAnimationFrame(raf); clearInterval(evTimer); stopGames();
    if (root) root.style.display = "none";
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    cloudSave();
    if (location.hash === "#realm") try { history.back(); } catch (e) {}
  }
  addEventListener("popstate", function () { if (opened && location.hash !== "#realm") { opened = true; close(); } });

  function launcher() {
    if (document.getElementById("lzr-btn")) return;
    var st = document.getElementById("lzr-css"); if (!st) document.head.appendChild(h("style", { id: "lzr-css" }, CSS));
    var b = h("button", { id: "lzr-btn", "aria-label": "عالم لحظة" }, "🌍 <span>عالم لحظة</span>");
    b.onclick = open; document.body.appendChild(b);
  }
  window.LahzaRealm = { open: open, close: close, state: function () { return S; } };
  function boot() { launcher(); if (location.hash === "#realm") setTimeout(open, 300); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
