/* ST Portfolio Psykiatri — v2
 * Läser det publicerade Google-arket (CSV) och renderar sidorna.
 * All text från arket sätts med textContent, aldrig som HTML.
 */
(function () {
  "use strict";

  const BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTO7RdhNGB9AGvPYbdDieARG4DmV1i1Tu--Zwv_ZyL-YvipCAuhAZLJ3b9t-sWOE9OoBTl0sRQh66UH/pub?single=true&output=csv&gid=";
  const CONFIG = {
    sheets: { delmal: "0", kurser: "326536759", placeringar: "635332228", laslista: "1415009810", bedomningar: "1653992571" },
    cacheMinutes: 10,
    stStart: "2023-09-01",
    stEnd: "2028-04-30",
  };

  /* Tidslinje för rotationerna (uppdatera här vid ändringar).
   * kind: psyk | somatik | ovrigt | parallell. Parallella spår ritas i rad 2. */
  const ROTATIONS = [
    { name: "PIVA", from: "2023-09-01", to: "2023-11-30", kind: "psyk" },
    { name: "Psykakuten", from: "2023-12-01", to: "2024-02-29", kind: "psyk" },
    { name: "ECT", from: "2023-12-01", to: "2024-02-29", kind: "parallell" },
    { name: "PIVA", from: "2024-03-01", to: "2024-06-30", kind: "psyk" },
    { name: "Psykakuten", from: "2024-07-01", to: "2024-08-31", kind: "psyk" },
    { name: "KA", from: "2024-09-01", to: "2024-09-15", kind: "psyk" },
    { name: "Bipolärmottagning", from: "2024-09-16", to: "2024-12-31", kind: "psyk" },
    { name: "Amanuens", from: "2025-01-01", to: "2025-06-08", kind: "ovrigt" },
    { name: "Internmedicin", from: "2025-06-09", to: "2025-09-28", kind: "somatik" },
    { name: "Medakuten", from: "2025-09-29", to: "2025-11-30", kind: "somatik" },
    { name: "BUP", from: "2025-12-01", to: "2026-03-29", kind: "psyk" },
    { name: "PDT-utbildning", from: "2026-01-01", to: "2027-12-31", kind: "parallell" },
    { name: "BCM", from: "2026-03-30", to: "2026-08-02", kind: "psyk" },
    { name: "Allmänpsykiatri slutenvård", from: "2026-08-03", to: "2026-10-04", kind: "psyk" },
    { name: "Psykos slutenvård", from: "2026-10-05", to: "2027-01-03", kind: "psyk" },
    { name: "Psykos öppenvård/NIP", from: "2027-01-04", to: "2027-03-28", kind: "psyk" },
    { name: "Minnesmottagning", from: "2027-03-29", to: "2027-07-04", kind: "psyk" },
    { name: "Allmänpsykiatri öppenvård", from: "2027-07-05", to: "2028-01-30", kind: "psyk" },
    { name: "Neurologi", from: "2028-01-31", to: "2028-04-30", kind: "somatik" },
  ];

  const MONTH_SHORT = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const DAY = 86400000;
  const today = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); })();

  /* ---------- Small DOM helper ---------- */
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  const $ = (id) => document.getElementById(id);
  const safeURL = (u) => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "");

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); rows.push(row); row = []; f = "";
      } else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
    return rows
      .filter((r) => r.some((v) => v.trim()))
      .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").replace(/\s+/g, " ").trim()])));
  }

  async function fetchSheet(name) {
    const key = "stp:" + name;
    try {
      const hit = JSON.parse(sessionStorage.getItem(key) || "null");
      if (hit && Date.now() - hit.t < CONFIG.cacheMinutes * 60000) return hit.d;
    } catch (e) { /* storage unavailable */ }
    const res = await fetch(BASE + CONFIG.sheets[name]);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = parseCSV(await res.text());
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data })); } catch (e) { /* ignore */ }
    return data;
  }

  const pick = (row, ...keys) => { for (const k of keys) if (row[k]) return row[k]; return ""; };
  const blank = (v) => (/^(\.\.\.|-|tba|tbd)?$/i.test(String(v || "").trim()) ? "" : String(v).trim());

  /* ---------- Dates & status ---------- */
  function iso(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }

  // "240301-240531", "230901-231130 and 240301-240631", "2024-03-15", "2024"
  function parsePeriod(text) {
    const s = String(text || "");
    const dates = [];
    for (const m of s.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) dates.push(new Date(+m[1], +m[2] - 1, +m[3]));
    for (const m of s.matchAll(/(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/g)) {
      const mo = +m[2], d = +m[3];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) dates.push(new Date(2000 + +m[1], mo - 1, Math.min(d, new Date(2000 + +m[1], mo, 0).getDate())));
    }
    if (dates.length) {
      dates.sort((a, b) => a - b);
      const ranges = [];
      for (let i = 0; i < dates.length; i += 2) ranges.push([dates[i], dates[i + 1] || dates[i]]);
      return { start: dates[0], end: dates[dates.length - 1], ranges };
    }
    const y = s.match(/\b(20\d{2})\b/);
    if (y) return { start: new Date(+y[1], 0, 1), end: new Date(+y[1], 11, 31), ranges: [], yearOnly: +y[1] };
    return null;
  }

  function fmtDate(d, withYear = true) { return d.getDate() + " " + MONTH_SHORT[d.getMonth()] + (withYear ? " " + d.getFullYear() : ""); }
  function fmtRange(a, b) {
    if (+a === +b) return fmtDate(a);
    return a.getFullYear() === b.getFullYear() ? fmtDate(a, false) + " – " + fmtDate(b) : fmtDate(a) + " – " + fmtDate(b);
  }
  function fmtPeriod(p, raw) {
    if (!p) return blank(raw) || "Ej planerat datum";
    if (p.yearOnly) return String(p.yearOnly);
    return p.ranges.map(([a, b]) => fmtRange(a, b)).join(" · ");
  }

  function statusOf(p, note) {
    const n = String(note || "").toLowerCase();
    if (n.includes("planerad")) return "planned";
    if (n.includes("pågående")) return "ongoing";
    if (!p) return "planned";
    if (p.yearOnly) return p.yearOnly < today.getFullYear() ? "completed" : p.yearOnly > today.getFullYear() ? "planned" : "completed";
    if (p.end < today) return "completed";
    if (p.start > today) return "planned";
    return "ongoing";
  }
  const STATUS_LABEL = { completed: "Genomförd", ongoing: "Pågående", planned: "Planerad" };
  const STATUS_ORDER = { ongoing: 0, planned: 1, completed: 2 };
  function sortItems(a, b) {
    if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    const as = a.p ? +a.p.start : Infinity, bs = b.p ? +b.p.start : Infinity;
    return a.status === "planned" ? as - bs : bs - as;
  }

  const codes = (v) => blank(v) ? String(v).split(/[,;\s]+/).map((c) => c.trim().toLowerCase()).filter((c) => /^[abc]\d+$/.test(c)) : [];
  const list = (v) => blank(v) ? String(v).split(",").map((s) => s.trim()).filter((s) => blank(s)) : [];

  /* ---------- Normalise sheets ---------- */
  function normItems(rows, kind) {
    return rows.map((r) => {
      const period = pick(r, "tidsperiod", "period", "datum");
      const note = blank(pick(r, "anteckningar"));
      const p = parsePeriod(period);
      return {
        kind,
        typ: blank(pick(r, "typ")),
        titel: blank(pick(r, "titel")),
        ansvarig: blank(pick(r, "ansvarig/bedömare", "ansvarig", "bedömare")),
        forfattare: blank(pick(r, "författare/källa", "författare", "källa")),
        delmal: codes(pick(r, "delmål")),
        lank: safeURL(pick(r, "länk")),
        note, raw: period, p,
        status: statusOf(p, note),
      };
    }).filter((x) => x.titel).sort(sortItems);
  }

  function normDelmal(rows, kurser, placeringar) {
    const goals = rows.map((r) => {
      const kod = blank(pick(r, "delmål", "kod")).toLowerCase();
      return {
        kod, kat: kod.charAt(0),
        titel: blank(pick(r, "titel")),
        beskrivning: blank(pick(r, "beskrivningar", "beskrivning")),
        kurser: list(pick(r, "kursintyg")),
        placeringar: list(pick(r, "tjänstgöringsintyg")),
      };
    }).filter((g) => /^[abc]\d+$/.test(g.kod));
    // Lägg till kopplingar från Kurser/Placeringar (endast genomförda/pågående)
    const byCode = Object.fromEntries(goals.map((g) => [g.kod, g]));
    const addFrom = (items, field) => items.forEach((it) => {
      if (it.status === "planned") return;
      it.delmal.forEach((c) => { const g = byCode[c]; if (g && !g[field].some((t) => t.toLowerCase() === it.titel.toLowerCase())) g[field].push(it.titel); });
    });
    addFrom(kurser || [], "kurser");
    addFrom(placeringar || [], "placeringar");
    goals.forEach((g) => { g.covered = g.kurser.length + g.placeringar.length > 0; });
    return goals.sort((a, b) => a.kat.localeCompare(b.kat) || parseInt(a.kod.slice(1)) - parseInt(b.kod.slice(1)));
  }

  /* ---------- Shared bits ---------- */
  function statusBadge(s) { return el("span", { class: "status " + s, text: STATUS_LABEL[s] }); }
  function goalTags(cs) { return el("div", { class: "tags" }, cs.map((c) => el("a", { class: "tag " + c[0], href: "delmal.html#" + c, text: c }))); }
  function failNotice(target, err) {
    console.error(err);
    target.replaceChildren(el("p", { class: "notice" }, "Kunde inte hämta data från Google-arket just nu. ", el("button", { class: "refresh", onclick: refresh, text: "Försök igen" })));
  }
  function refresh() {
    try { Object.keys(sessionStorage).filter((k) => k.startsWith("stp:")).forEach((k) => sessionStorage.removeItem(k)); } catch (e) { /* ignore */ }
    location.reload();
  }

  /* ---------- Timeline ---------- */
  function rotationAt(d) { return ROTATIONS.find((r) => r.kind !== "parallell" && iso(r.from) <= d && d <= iso(r.to)); }

  function renderTimeline(target) {
    const y0 = iso(CONFIG.stStart).getFullYear(), y1 = iso(CONFIG.stEnd).getFullYear();
    const tl = el("div", { class: "tl", role: "img", "aria-label": "Tidslinje över placeringar " + y0 + "–" + y1 });
    tl.append(el("div"), el("div", { class: "tl-months" }, MONTH_SHORT.map((m) => el("span", { text: m }))));
    const cur = rotationAt(today);
    for (let y = y0; y <= y1; y++) {
      const ys = new Date(y, 0, 1), ye = new Date(y + 1, 0, 1), span = ye - ys;
      const row = el("div", { class: "tl-row" });
      ROTATIONS.forEach((r) => {
        const a = iso(r.from), b = new Date(+iso(r.to) + DAY);
        if (b <= ys || a >= ye) return;
        const s = Math.max(a, ys), e = Math.min(b, ye);
        const left = ((s - ys) / span) * 100, width = ((e - s) / span) * 100;
        const cls = ["tl-bar", r.kind, r.kind === "parallell" ? "lane-1" : "lane-0"];
        if (a > today) cls.push("future");
        if (r === cur && width > 2) cls.push("current");
        row.append(el("div", {
          class: cls.join(" "),
          style: `left:calc(${left}% + 1px);width:calc(${width}% - 2px)`,
          title: r.name + ": " + fmtRange(a, iso(r.to)),
          text: width > 4 ? r.name : "",
        }));
      });
      if (today >= ys && today < ye) row.append(el("div", { class: "tl-today", style: `left:${((today - ys) / span) * 100}%` }));
      tl.append(el("div", { class: "tl-year", text: y }), row);
    }
    const legend = el("div", { class: "legend" },
      [["psyk", "Psykiatri", "var(--primary)"], ["somatik", "Somatik", "var(--coral)"], ["ovrigt", "Forskning/övrigt", "var(--slate)"], ["parallell", "Parallellt", "var(--sand)"]]
        .map(([, label, c]) => el("span", null, el("i", { style: "background:" + c }), label)));
    const scroller = el("div", { class: "tl-scroll" }, tl);
    target.replaceChildren(scroller, legend);
    const mark = tl.querySelector(".tl-today");
    if (mark && scroller.scrollWidth > scroller.clientWidth) {
      scroller.scrollLeft = mark.getBoundingClientRect().left - scroller.getBoundingClientRect().left - scroller.clientWidth / 2;
    }
  }

  /* ---------- Page: Översikt ---------- */
  async function pageHome() {
    // Nu-kortet bygger på tidslinjen och fungerar utan arket
    const cur = rotationAt(today);
    const st0 = iso(CONFIG.stStart), st1 = iso(CONFIG.stEnd);
    const stPct = Math.min(100, Math.max(0, ((today - st0) / (st1 - st0)) * 100));
    const monthsTotal = Math.round((st1 - st0) / (30.44 * DAY));
    const monthsDone = Math.min(monthsTotal, Math.max(0, Math.floor((today - st0) / (30.44 * DAY)) + 1));
    const next = ROTATIONS.filter((r) => r.kind !== "parallell" && iso(r.from) > today)[0];
    const parallel = ROTATIONS.filter((r) => r.kind === "parallell" && iso(r.from) <= today && today <= iso(r.to));

    const body = el("div", { class: "now-body" });
    if (cur) {
      const a = iso(cur.from), b = iso(cur.to);
      const pct = Math.min(100, ((today - a) / (b - a + DAY)) * 100);
      const daysLeft = Math.round((b - today) / DAY);
      body.append(
        el("div", null, el("div", { class: "now-title", text: cur.name }), el("div", { class: "meta", text: fmtRange(a, b) + (parallel.length ? " · parallellt: " + parallel.map((p) => p.name).join(", ") : "") })),
        el("div", null, el("div", { class: "bar-label" }, el("span", { text: "Placeringen" }), el("strong", { text: daysLeft + " dagar kvar" })), el("div", { class: "bar coral" }, el("span", { style: "width:" + pct + "%" }))),
      );
    } else {
      body.append(el("div", { class: "now-title", text: today < st0 ? "ST har inte börjat" : today > st1 ? "ST klar" : "Mellan placeringar" }));
    }
    body.append(el("div", null, el("div", { class: "bar-label" }, el("span", { text: "Hela ST" }), el("strong", { text: "månad " + monthsDone + " av " + monthsTotal })), el("div", { class: "bar" }, el("span", { style: "width:" + stPct + "%" }))));
    if (next) body.append(el("div", { class: "next-up" }, "Härnäst: ", el("strong", { text: next.name }), " från " + fmtDate(iso(next.from))));
    $("now-card").replaceChildren(el("div", { class: "now-top" }, el("span", { class: "eyebrow", text: "Just nu" }), el("span", { class: "pill", text: Math.round(stPct) + " % av ST" })), body);

    renderTimeline($("timeline"));

    try {
      const [d, k, p, b] = await Promise.all(["delmal", "kurser", "placeringar", "bedomningar"].map(fetchSheet));
      const kurser = normItems(k, "kurs"), plac = normItems(p, "placering"), bed = normItems(b, "bedömning");
      const goals = normDelmal(d, kurser, plac);
      const done = (xs) => xs.filter((x) => x.status === "completed").length;
      const covered = goals.filter((g) => g.covered).length;
      const stat = (href, num, total, label, sub) => el("a", { class: "stat", href },
        el("span", { class: "stat-num" }, String(num), total != null ? el("small", { text: " / " + total }) : null),
        el("span", { class: "stat-label", text: label }), el("span", { class: "stat-sub", text: sub }));
      $("stats").replaceChildren(
        stat("delmal.html", covered, goals.length, "Delmål täckta", goals.length - covered + " kvar att täcka"),
        stat("placeringar.html", done(plac), plac.length, "Placeringar", "genomförda"),
        stat("kurser.html", done(kurser), kurser.length, "Kurser", "genomförda"),
        stat("bedomningar.html", done(bed), bed.length, "Bedömningar", "genomförda"),
      );
      const missing = goals.filter((g) => !g.covered);
      const banner = $("missing");
      if (missing.length) {
        banner.hidden = false;
        $("missing-tags").replaceChildren(...missing.map((g) => el("a", { class: "tag", href: "delmal.html#" + g.kod, title: g.titel, text: g.kod })));
      }
    } catch (e) { failNotice($("stats"), e); }
  }

  /* ---------- Generic list pages ---------- */
  function setupFilters(container, options, onChange) {
    let current = options[0].value;
    const btns = options.map((o) => el("button", {
      class: "filter", type: "button", "aria-pressed": String(o.value === current),
      onclick: () => { current = o.value; btns.forEach((b, i) => b.setAttribute("aria-pressed", String(options[i].value === current))); onChange(current); },
    }, o.label, o.n != null ? el("span", { class: "n", text: o.n }) : null));
    container.replaceChildren(...btns);
    return () => current;
  }

  async function pageList(sheet, kind) {
    const target = $("list");
    let items;
    try { items = normItems(await fetchSheet(sheet), kind); } catch (e) { return failNotice(target, e); }
    const isRead = sheet === "laslista";
    const q = $("q");
    const count = (s) => items.filter((x) => x.status === s).length;
    const opts = isRead
      ? [{ value: "", label: "Alla", n: items.length }, ...[...new Set(items.map((x) => x.typ).filter(Boolean))].sort().map((t) => ({ value: t, label: t, n: items.filter((x) => x.typ === t).length }))]
      : [{ value: "", label: "Alla", n: items.length }, { value: "ongoing", label: "Pågående", n: count("ongoing") }, { value: "planned", label: "Planerade", n: count("planned") }, { value: "completed", label: "Genomförda", n: count("completed") }].filter((o) => o.n || !o.value);
    const getFilter = setupFilters($("filters"), opts, draw);
    q.addEventListener("input", draw);

    function draw() {
      const f = getFilter(), term = q.value.trim().toLowerCase();
      const shown = items.filter((x) => (!f || (isRead ? x.typ === f : x.status === f)) &&
        (!term || [x.titel, x.ansvarig, x.forfattare, x.note, x.typ, x.delmal.join(" ")].join(" ").toLowerCase().includes(term)));
      if (isRead) shown.sort((a, b) => (b.p ? +b.p.start : 0) - (a.p ? +a.p.start : 0));
      if (!shown.length) return target.replaceChildren(el("p", { class: "notice", text: "Inget matchar sökningen." }));
      target.replaceChildren(...shown.map((x) => el("li", { class: "item " + (isRead ? "" : x.status) },
        el("div", { class: "item-when" }, el("span", { class: "date", text: isRead ? (x.p ? fmtDate(x.p.start) : blank(x.raw)) : fmtPeriod(x.p, x.raw) }), isRead ? null : statusBadge(x.status)),
        el("div", { class: "item-main" },
          x.typ ? el("span", { class: "type", text: x.typ }) : null,
          el("span", { class: "item-title", text: x.titel }),
          (x.ansvarig || x.forfattare) ? el("span", { class: "item-sub", text: x.ansvarig || x.forfattare }) : null,
          x.delmal.length ? goalTags(x.delmal) : null,
          x.note ? el("span", { class: "item-note", text: x.note }) : null),
        x.lank ? el("a", { class: "btn btn-light item-link", href: x.lank, target: "_blank", rel: "noopener", text: isRead ? "Öppna ↗" : kind === "kurs" ? "Kursintyg ↗" : kind === "placering" ? "Intyg ↗" : "Dokument ↗" }) : null,
      )));
    }
    draw();
  }

  /* ---------- Page: Delmål ---------- */
  async function pageDelmal() {
    const target = $("goals");
    let goals;
    try {
      const [d, k, p] = await Promise.all(["delmal", "kurser", "placeringar"].map(fetchSheet));
      goals = normDelmal(d, normItems(k, "kurs"), normItems(p, "placering"));
    } catch (e) { return failNotice(target, e); }

    const kats = [["a", "A-mål", "Gemensamma kompetenser"], ["b", "B-mål", "Kompetenser gemensamma med andra specialiteter"], ["c", "C-mål", "Specialitetsspecifika"]];
    $("progress").replaceChildren(...kats.map(([k, label, sub]) => {
      const gs = goals.filter((g) => g.kat === k), c = gs.filter((g) => g.covered).length;
      return el("div", { class: "progress-card" },
        el("div", { class: "bar-label" }, el("span", null, el("strong", { text: label }), " · " + sub), el("strong", { text: c + "/" + gs.length })),
        el("div", { class: "bar" + (k === "b" ? " coral" : "") }, el("span", { style: "width:" + (gs.length ? (c / gs.length) * 100 : 0) + "%" })));
    }));

    const q = $("q");
    const getFilter = setupFilters($("filters"), [
      { value: "", label: "Alla", n: goals.length },
      ...kats.map(([k, label]) => ({ value: k, label, n: goals.filter((g) => g.kat === k).length })),
      { value: "open", label: "Ej täckta", n: goals.filter((g) => !g.covered).length },
    ], draw);
    q.addEventListener("input", draw);

    function draw() {
      const f = getFilter(), term = q.value.trim().toLowerCase();
      const shown = goals.filter((g) => (!f || (f === "open" ? !g.covered : g.kat === f)) &&
        (!term || [g.kod, g.titel, g.beskrivning, g.kurser.join(" "), g.placeringar.join(" ")].join(" ").toLowerCase().includes(term)));
      if (!shown.length) return target.replaceChildren(el("p", { class: "notice", text: "Inga delmål matchar." }));
      target.replaceChildren(...shown.map((g) => {
        const desc = g.beskrivning ? el("p", { class: "goal-desc" + (g.beskrivning.length > 220 ? " clamp" : ""), text: g.beskrivning }) : null;
        const more = desc && g.beskrivning.length > 220 ? el("button", { class: "more", type: "button", text: "Visa mer", onclick: (e) => { const open = desc.classList.toggle("clamp"); e.target.textContent = open ? "Visa mer" : "Visa mindre"; } }) : null;
        const cover = (label, xs) => xs.length ? el("div", { class: "cover" }, el("span", { class: "cover-label", text: label }), el("div", { class: "tags" }, xs.map((t) => el("span", { class: "tag", text: t })))) : null;
        return el("article", { class: "goal" + (g.covered ? "" : " uncovered"), id: g.kod },
          el("div", { class: "goal-head" }, el("div", { class: "code " + g.kat, text: g.kod }), el("div", { class: "goal-title", text: g.titel })),
          desc, more,
          cover("Placeringar", g.placeringar), cover("Kurser", g.kurser),
          g.covered ? null : el("span", { class: "status planned", text: "Ej täckt ännu" }));
      }));
      if (location.hash) { const t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
    }
    draw();
  }

  /* ---------- Boot ---------- */
  const nav = document.querySelector(".nav"), curLink = nav && nav.querySelector("[aria-current]");
  if (nav && curLink && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = curLink.offsetLeft - (nav.clientWidth - curLink.offsetWidth) / 2;
  document.querySelectorAll("[data-refresh]").forEach((b) => b.addEventListener("click", refresh));
  const page = document.body.dataset.page;
  ({
    home: pageHome,
    delmal: pageDelmal,
    kurser: () => pageList("kurser", "kurs"),
    placeringar: () => pageList("placeringar", "placering"),
    bedomningar: () => pageList("bedomningar", "bedömning"),
    laslista: () => pageList("laslista", "läsning"),
  }[page] || (() => {}))();
})();
