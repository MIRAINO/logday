(() => {
  "use strict";

  /* =========================================================
     LOGDAY app.js
     - 複数写真1エントリー対応
     - 旧データ自動移行
     - Noteshelf用 直接PDF書き出し
     - Safari写真選択 安定化対策
  ========================================================= */

  const DATA_VERSION = 2;
  const IS_SAFARI = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  /* =======================
     Global error -> Toast
  ======================= */
  window.addEventListener("error", (e) => {
    console.error("GlobalError:", e.error || e.message);
    const t = document.getElementById("toast");
    if (t) {
      t.textContent = "JSエラー: " + (e.message || "unknown");
      t.classList.add("show");
      setTimeout(() => t.classList.remove("show"), 2500);
    }
  });

  window.addEventListener("unhandledrejection", (e) => {
    console.error("UnhandledRejection:", e.reason);
    const t = document.getElementById("toast");
    if (t) {
      t.textContent = "Promiseエラー: " + (String(e.reason) || "unknown");
      t.classList.add("show");
      setTimeout(() => t.classList.remove("show"), 2500);
    }
  });

  /* =======================
     DOM helpers
  ======================= */
  const $ = (id) => document.getElementById(id);
  const on = (el, ev, fn, opt) => el && el.addEventListener(ev, fn, opt);

  /* =======================
     Utils
  ======================= */
  const pad2 = (n) => String(n).padStart(2, "0");

  const uid = () =>
    "e_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);

  const nowHHMM = () => {
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  const hhmmFromDate = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  const formatYMD = (d) => {
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    return `${y}-${m}-${day}`;
  };

  const parseYMD = (str) => {
    const [y, m, d] = String(str).split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const timeToMinutes = (t) => {
    if (!t) return 999999;
    const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return 999999;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  };

  const roundTimeToStep = (timeStr, stepMin) => {
    const m = String(timeStr || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return "";
    let h = parseInt(m[1], 10);
    let mi = parseInt(m[2], 10);
    const rounded = Math.round(mi / stepMin) * stepMin;
    if (rounded === 60) {
      mi = 0;
      h = (h + 1) % 24;
    } else {
      mi = rounded;
    }
    return `${pad2(h)}:${pad2(mi)}`;
  };

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  /* =======================
     Toast
  ======================= */
  const Toast = (() => {
    const el = $("toast");
    let timer = null;

    function show(message) {
      if (!el) return;
      el.textContent = message;
      el.classList.add("show");
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove("show"), 1400);
    }

    return { show };
  })();

  /* =======================
     Storage
  ======================= */
  const Storage = (() => {
    function normalizePhoto(raw, fallbackCreatedAt = Date.now()) {
      if (!raw) return null;
      if (typeof raw === "string") {
        return {
          id: raw,
          name: "",
          shotAt: fallbackCreatedAt,
          shotTime: "",
          mime: "image/jpeg",
        };
      }
      return {
        id: raw.id || "",
        name: raw.name || "",
        shotAt: Number(raw.shotAt || fallbackCreatedAt),
        shotTime: raw.shotTime || "",
        mime: raw.mime || "image/jpeg",
      };
    }

    function normalizeEntry(raw, fallbackCreatedAt = Date.now()) {
      const entry = raw || {};
      const createdAt = Number(entry.createdAt || fallbackCreatedAt);

      let photos = [];
      if (Array.isArray(entry.photos)) {
        photos = entry.photos.map((p) => normalizePhoto(p, createdAt)).filter(Boolean);
      } else if (entry.photoId) {
        photos = [
          normalizePhoto(
            {
              id: entry.photoId,
              name: entry.fileName || "",
              shotAt: createdAt,
              shotTime: entry.time || "",
              mime: "image/jpeg",
            },
            createdAt
          ),
        ].filter(Boolean);
      }

      let attachments = [];
      if (Array.isArray(entry.attachments)) {
        attachments = entry.attachments.map((a) => ({
          id: a.id || "",
          name: a.name || "",
          mime: a.mime || "",
          kind: a.kind || "file",
        }));
      } else if (entry.fileName && !photos.length) {
        attachments = [
          {
            id: "",
            name: entry.fileName,
            mime: "",
            kind: "file",
          },
        ];
      }

      return {
        id: entry.id || uid(),
        createdAt,
        updatedAt: Number(entry.updatedAt || createdAt),
        time: entry.time || "",
        text: entry.text || "",
        type: entry.type || (photos.length ? "photo" : attachments.length ? "file" : "text"),
        photos,
        attachments,
        note: entry.note || "",
      };
    }

    function normalizeDay(dateKey, raw) {
      const day = raw || {};
      const base = {
        version: DATA_VERSION,
        date: dateKey,
        createdAt: Number(day.createdAt || Date.now()),
        updatedAt: Number(day.updatedAt || Date.now()),
        summary: day.summary || "",
        noteshelf: {
          theme: "dark",
          textColor: "#FFFFFF",
          summarySpaceLines: Number(day?.noteshelf?.summarySpaceLines || 12),
        },
        entries: [],
      };

      const srcEntries = Array.isArray(day.entries) ? day.entries : [];
      base.entries = srcEntries.map((e) => normalizeEntry(e, Date.now()));

      return base;
    }

    function getDay(dateKey) {
      try {
        const raw = JSON.parse(localStorage.getItem(dateKey) || "{}");
        return normalizeDay(dateKey, raw);
      } catch (e) {
        console.warn("getDay parse failed:", e);
        return normalizeDay(dateKey, {});
      }
    }

    function saveDay(dateKey, dayData) {
      try {
        const normalized = normalizeDay(dateKey, dayData);
        normalized.version = DATA_VERSION;
        normalized.date = dateKey;
        normalized.updatedAt = Date.now();

        localStorage.setItem(dateKey, JSON.stringify(normalized));
        return true;
      } catch (err) {
        console.error("saveDay failed:", err);
        if (err && String(err.name) === "QuotaExceededError") {
          Toast.show("保存できなかった：容量オーバー");
        } else {
          Toast.show("保存できなかった…");
        }
        return false;
      }
    }

    function sortEntries(dayData) {
      const arr = dayData.entries || [];
      arr.sort((a, b) => {
        const ta = timeToMinutes(a.time);
        const tb = timeToMinutes(b.time);
        if (ta !== tb) return ta - tb;

        const ca = a.createdAt ?? 0;
        const cb = b.createdAt ?? 0;
        if (ca !== cb) return ca - cb;

        return String(a.id || "").localeCompare(String(b.id || ""));
      });
    }

    function exportAll() {
      const out = {};
      for (const k of Object.keys(localStorage)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k)) {
          out[k] = getDay(k);
        }
      }
      return out;
    }

    return {
      saveDay,
      getDay,
      sortEntries,
      exportAll,
      normalizeDay,
    };
  })();

  /* =======================
     EXIF
  ======================= */
  function exifDateFromJpegArrayBuffer(buf) {
    const dv = new DataView(buf);
    if (dv.getUint16(0, false) !== 0xffd8) return null;

    let offset = 2;
    const len = dv.byteLength;

    while (offset + 4 < len) {
      if (dv.getUint8(offset) !== 0xff) break;
      const marker = dv.getUint8(offset + 1);
      const size = dv.getUint16(offset + 2, false);

      if (marker === 0xe1) {
        const exifHeader = offset + 4;
        const isExif =
          dv.getUint8(exifHeader) === 0x45 &&
          dv.getUint8(exifHeader + 1) === 0x78 &&
          dv.getUint8(exifHeader + 2) === 0x69 &&
          dv.getUint8(exifHeader + 3) === 0x66 &&
          dv.getUint8(exifHeader + 4) === 0x00 &&
          dv.getUint8(exifHeader + 5) === 0x00;
        if (!isExif) return null;

        const tiffStart = exifHeader + 6;
        const endianMark = dv.getUint16(tiffStart, false);
        const little = endianMark === 0x4949;
        const get16 = (p) => dv.getUint16(p, little);
        const get32 = (p) => dv.getUint32(p, little);

        if (get16(tiffStart + 2) !== 0x002a) return null;

        const ifd0Offset = get32(tiffStart + 4);
        const ifd0 = tiffStart + ifd0Offset;
        if (ifd0 + 2 > len) return null;

        const num0 = get16(ifd0);
        let exifIFDPtr = null;

        for (let i = 0; i < num0; i++) {
          const ent = ifd0 + 2 + i * 12;
          const tag = get16(ent);
          if (tag === 0x8769) {
            exifIFDPtr = get32(ent + 8);
            break;
          }
        }
        if (exifIFDPtr == null) return null;

        const exifIFD = tiffStart + exifIFDPtr;
        if (exifIFD + 2 > len) return null;

        const numE = get16(exifIFD);

        const readAscii = (valueOffset, count) => {
          const start = tiffStart + valueOffset;
          if (start + count > len) return null;
          let s = "";
          for (let i = 0; i < count; i++) {
            const c = dv.getUint8(start + i);
            if (c === 0) break;
            s += String.fromCharCode(c);
          }
          return s;
        };

        for (let i = 0; i < numE; i++) {
          const ent = exifIFD + 2 + i * 12;
          const tag = get16(ent);

          if (tag === 0x9003 || tag === 0x0132) {
            const type = get16(ent + 2);
            const count = get32(ent + 4);
            const valueOffset = get32(ent + 8);
            if (type !== 2 || count < 10) continue;

            const str = readAscii(valueOffset, count);
            if (!str) continue;

            const m = str.match(
              /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/
            );
            if (!m) continue;

            return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
          }
        }
        return null;
      }

      offset += 2 + size;
    }

    return null;
  }

  function exifOrientationFromJpegArrayBuffer(buf) {
    const dv = new DataView(buf);
    if (dv.getUint16(0, false) !== 0xffd8) return 1;

    let offset = 2;
    const len = dv.byteLength;

    while (offset + 4 < len) {
      if (dv.getUint8(offset) !== 0xff) break;
      const marker = dv.getUint8(offset + 1);
      const size = dv.getUint16(offset + 2, false);

      if (marker === 0xe1) {
        const exifHeader = offset + 4;
        const isExif =
          dv.getUint8(exifHeader) === 0x45 &&
          dv.getUint8(exifHeader + 1) === 0x78 &&
          dv.getUint8(exifHeader + 2) === 0x69 &&
          dv.getUint8(exifHeader + 3) === 0x66 &&
          dv.getUint8(exifHeader + 4) === 0x00 &&
          dv.getUint8(exifHeader + 5) === 0x00;

        if (!isExif) return 1;

        const tiffStart = exifHeader + 6;
        const endianMark = dv.getUint16(tiffStart, false);
        const little = endianMark === 0x4949;
        const get16 = (p) => dv.getUint16(p, little);
        const get32 = (p) => dv.getUint32(p, little);

        if (get16(tiffStart + 2) !== 0x002a) return 1;

        const ifd0Offset = get32(tiffStart + 4);
        const ifd0 = tiffStart + ifd0Offset;
        if (ifd0 + 2 > len) return 1;

        const num0 = get16(ifd0);

        for (let i = 0; i < num0; i++) {
          const ent = ifd0 + 2 + i * 12;
          const tag = get16(ent);
          if (tag === 0x0112) return get16(ent + 8) || 1;
        }
        return 1;
      }

      offset += 2 + size;
    }

    return 1;
  }

  async function getShotDate(file) {
    const isJpeg =
      file.type === "image/jpeg" || /\.(jpe?g)$/i.test(file.name || "");

    if (isJpeg) {
      try {
        const buf = await file.arrayBuffer();
        const exifDate = exifDateFromJpegArrayBuffer(buf);
        if (exifDate && !isNaN(exifDate.getTime())) return exifDate;
      } catch (_) {}
    }

    const lm = file.lastModified ? new Date(file.lastModified) : null;
    if (lm && !isNaN(lm.getTime())) return lm;
    return null;
  }

  /* =======================
     PhotosDB
  ======================= */
  const PhotosDB = (() => {
    const DB_NAME = "logday_db";
    const DB_VER = 1;
    let dbPromise = null;

    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("photos")) {
            const store = db.createObjectStore("photos", { keyPath: "id" });
            store.createIndex("createdAt", "createdAt", { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbPromise;
    }

    async function put({ id, blob, mime, name, createdAt }) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("photos", "readwrite");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.objectStore("photos").put({ id, blob, mime, name, createdAt });
      });
    }

    async function get(id) {
      if (!id) return null;
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("photos", "readonly");
        const req = tx.objectStore("photos").get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }

    async function del(id) {
      if (!id) return;
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("photos", "readwrite");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.objectStore("photos").delete(id);
      });
    }

    async function dataUrlToBlob(dataUrl) {
      const res = await fetch(dataUrl);
      return await res.blob();
    }

    async function ping() {
      try {
        await open();
        const id = "ping_" + uid();
        await put({
          id,
          blob: new Blob(["ok"], { type: "text/plain" }),
          mime: "text/plain",
          name: "ping",
          createdAt: Date.now(),
        });
        await del(id);
        return true;
      } catch (e) {
        console.warn("IndexedDB unavailable:", e);
        return false;
      }
    }

    return { open, put, get, del, dataUrlToBlob, ping };
  })();

  /* =======================
     Legacy migrate
  ======================= */
  async function migrateLegacyPhotosForDay(dateKey) {
    const dayData = Storage.getDay(dateKey);
    let changed = false;
    let moved = 0;

    for (const e of dayData.entries || []) {
      if (Array.isArray(e.photos) && e.photos.length) continue;

      const isLegacy =
        e && typeof e.photo === "string" && e.photo.startsWith("data:image/");

      if (!isLegacy) continue;

      try {
        const blob = await PhotosDB.dataUrlToBlob(e.photo);
        const pid = "p_" + uid();
        await PhotosDB.put({
          id: pid,
          blob,
          mime: blob.type || "image/jpeg",
          name: "photo.jpg",
          createdAt: e.createdAt || Date.now(),
        });

        e.photos = [
          {
            id: pid,
            name: "photo.jpg",
            shotAt: e.createdAt || Date.now(),
            shotTime: e.time || "",
            mime: blob.type || "image/jpeg",
          },
        ];
        e.type = "photo";
        delete e.photo;
        delete e.photoId;
        moved++;
        changed = true;
      } catch (err) {
        console.warn("legacy migrate failed", err);
        delete e.photo;
        changed = true;
      }
    }

    if (changed) Storage.saveDay(dateKey, dayData);
    return { changed, moved };
  }

  /* =======================
     State / DOM refs
  ======================= */
  const State = {
    viewMode: "week",
    currentDate: formatYMD(new Date()),
    todayKey: formatYMD(new Date()),

    timeMode: "auto",
    selectedTime: "",
    tempTime: "",
    timeTicker: null,

    editingId: null,
    editingPrevPhotoIds: [],
    isSaving: false,

    pendingPhotos: [],
    pendingFileName: "",

    openSwipeId: null,
  };

  const DOM = {
    navDate: $("navDate"),
    toggleBtn: $("toggleBtn"),
    calendar: $("calendar"),
    weekBar: $("weekBar"),
    topSticky: $("topSticky"),

    entries: $("entries"),

    inputBar: $("inputBar"),
    plusBtn: $("plusBtn"),
    logInput: $("logInput"),
    saveBtn: $("saveBtn"),
    timeHint: $("timeHint"),
    logTime: $("logTime"),
    previewArea: $("previewArea"),
    fileInput: $("fileInput"),
    pickPhotoInput: $("pickPhotoInput"),
    takePhotoInput: $("takePhotoInput"),

    plusSheet: $("plusSheet"),
    plusSheetBackdrop: $("plusSheetBackdrop"),
    actPhoto: $("actPhoto"),
    actCamera: $("actCamera"),
    actFile: $("actFile"),
    actCancel: $("actCancel"),

    settingsBtn: $("settingsBtn"),
    settingsModal: $("settingsModal"),
    settingsBackdrop: $("settingsBackdrop"),
    closeSettings: $("closeSettings"),
    exportLogday: $("exportLogday"),
    exportNoteshelfPdf: $("exportNoteshelfPdf"),
    cleanupStorage: $("cleanupStorage"),
    timeStepBtn: $("timeStepBtn"),
    importFile: $("importFile"),
  };

  /* =======================
     Layout
  ======================= */
  const Layout = (() => {
    let raf = null;

    function updateBodyPadding() {
      if (!DOM.inputBar) return;
      const h = DOM.inputBar.getBoundingClientRect().height || 0;
      document.body.style.paddingBottom = `calc(${Math.ceil(
        h
      )}px + env(safe-area-inset-bottom, 0px))`;
    }

    function scheduleUpdate() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateBodyPadding);
    }

    function init() {
      scheduleUpdate();
      if ("ResizeObserver" in window && DOM.inputBar) {
        const ro = new ResizeObserver(() => scheduleUpdate());
        ro.observe(DOM.inputBar);
      } else {
        window.addEventListener("resize", scheduleUpdate, { passive: true });
      }
    }

    return { init, scheduleUpdate };
  })();

  /* =======================
     TimeStep
  ======================= */
  const TimeStep = (() => {
    const STEP_KEY = "logday_time_step_min";
    let stepMin = 10;

    function get() {
      const v = parseInt(localStorage.getItem(STEP_KEY) || "10", 10);
      return v === 1 || v === 10 ? v : 10;
    }

    function set(v) {
      const step = v === 1 || v === 10 ? v : 10;
      localStorage.setItem(STEP_KEY, String(step));
      stepMin = step;
      if (DOM.logTime) DOM.logTime.step = String(stepMin * 60);
      refreshLabel();
      Toast.show(stepMin === 1 ? "分刻み：1分" : "分刻み：10分");
    }

    function refreshLabel() {
      if (!DOM.timeStepBtn) return;
      DOM.timeStepBtn.textContent =
        stepMin === 1 ? "分刻み：1分" : "分刻み：10分";
    }

    function init() {
      stepMin = get();
      if (DOM.logTime) DOM.logTime.step = String(stepMin * 60);
      refreshLabel();
      on(DOM.timeStepBtn, "click", () => set(stepMin === 10 ? 1 : 10));
    }

    return {
      init,
      get stepMin() {
        return stepMin;
      },
    };
  })();

  /* =======================
     Header
  ======================= */
  const Header = (() => {
    function renderNavDate(dateStr) {
      const d = parseYMD(dateStr);
      const dateText = d.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const weekdayText = d.toLocaleDateString("ja-JP", { weekday: "short" });
      if (DOM.navDate) DOM.navDate.textContent = `${dateText}（${weekdayText}）`;
    }

    function updateToggleLabel() {
      if (!DOM.toggleBtn) return;
      DOM.toggleBtn.textContent = State.viewMode === "week" ? "月" : "週";
      DOM.toggleBtn.title = State.viewMode === "week" ? "月表示へ" : "週表示へ";
      DOM.toggleBtn.setAttribute(
        "aria-pressed",
        State.viewMode === "month" ? "true" : "false"
      );
    }

    function initShadow() {
      if (!DOM.topSticky) return;
      const TH = 6;
      const onScroll = () =>
        DOM.topSticky.classList.toggle("isScrolled", window.scrollY > TH);
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }

    return { renderNavDate, updateToggleLabel, initShadow };
  })();

  /* =======================
     Calendar
  ======================= */
  const Calendar = (() => {
    const wnames = ["月", "火", "水", "木", "金", "土", "日"];

    function startOfWeek(dateStr) {
      const d = parseYMD(dateStr);
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      return d;
    }

    function renderWeekBar(dateStr) {
      const bar = DOM.weekBar;
      if (!bar) return;

      bar.style.display = State.viewMode === "week" ? "grid" : "none";
      if (State.viewMode !== "week") return;

      bar.innerHTML = "";
      const start = startOfWeek(dateStr);

      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const ymd = formatYMD(d);

        const btn = document.createElement("button");
        btn.dataset.date = ymd;
        btn.innerHTML = `${wnames[i]}<span class="d">${d.getDate()}</span>`;
        btn.classList.toggle("active", ymd === State.currentDate);

        const saved = Storage.getDay(ymd);
        if ((saved.entries || []).length > 0) btn.classList.add("hasEntry");

        btn.onclick = async () => {
          State.currentDate = ymd;
          await App.loadAndRender(State.currentDate);
        };

        bar.appendChild(btn);
      }
    }

    function renderMonthCalendar() {
      const cal = DOM.calendar;
      if (!cal) return;

      cal.innerHTML = "";
      const d = new Date(State.currentDate);
      const year = d.getFullYear();
      const month = d.getMonth();

      const firstDay = new Date(year, month, 1);
      const lastDate = new Date(year, month + 1, 0).getDate();
      const blanks = (firstDay.getDay() + 6) % 7;

      for (let i = 0; i < blanks; i++) {
        const empty = document.createElement("button");
        empty.disabled = true;
        empty.style.visibility = "hidden";
        cal.appendChild(empty);
      }

      for (let day = 1; day <= lastDate; day++) {
        const dayStr = `${year}-${pad2(month + 1)}-${pad2(day)}`;
        const btn = document.createElement("button");
        btn.textContent = String(day);
        btn.dataset.date = dayStr;

        const saved = Storage.getDay(dayStr);
        if ((saved.entries || []).length > 0) btn.classList.add("hasEntry");
        btn.classList.toggle("active", dayStr === State.currentDate);

        btn.onclick = async () => {
          State.currentDate = dayStr;
          await App.loadAndRender(State.currentDate);
        };

        cal.appendChild(btn);
      }
    }

    async function showWeek() {
      State.viewMode = "week";
      DOM.calendar?.classList.add("hidden");
      if (DOM.weekBar) DOM.weekBar.style.display = "grid";
      Header.updateToggleLabel();
      renderWeekBar(State.currentDate);
      await App.loadAndRender(State.currentDate);
    }

    async function showMonth() {
      State.viewMode = "month";
      DOM.calendar?.classList.remove("hidden");
      if (DOM.weekBar) DOM.weekBar.style.display = "none";
      Header.updateToggleLabel();
      renderMonthCalendar();
      await App.loadAndRender(State.currentDate);
    }

    function init() {
      on(DOM.toggleBtn, "click", () => {
        if (State.viewMode === "week") showMonth();
        else showWeek();
      });
    }

    return {
      init,
      showWeek,
      showMonth,
      renderWeekBar,
      renderMonthCalendar,
    };
  })();

  /* =======================
     Entries
  ======================= */
  const Entries = (() => {
    async function renderPhotoThumb(photo) {
      const rec = await PhotosDB.get(photo.id);
      if (!rec || !rec.blob) return "";
      return await blobToDataURL(rec.blob);
    }

    const SWIPE_OPEN_X = -84;
    const SWIPE_THRESHOLD = -42;
    const SWIPE_FULL_DELETE = -170;
    const SWIPE_OVERSHOOT = 26;

    const swipeLock = {
      active: false,
      moved: false,
      id: null,
      startX: 0,
      startY: 0,
      currentX: 0,
    };

    function closeAllSwipes() {
      document
        .querySelectorAll(".entrySwipe.open")
        .forEach((el) => el.classList.remove("open"));
      State.openSwipeId = null;
    }

    function closeOtherSwipes(keepId) {
      document
        .querySelectorAll(".entrySwipe.open")
        .forEach((el) => el.dataset.id !== keepId && el.classList.remove("open"));
      State.openSwipeId = keepId;
    }

    function attachSwipeHandlers(wrapEl, contentEl) {
      wrapEl.addEventListener(
        "pointerdown",
        (e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;

          swipeLock.active = true;
          swipeLock.moved = false;
          swipeLock.id = wrapEl.dataset.id;
          swipeLock.startX = e.clientX;
          swipeLock.startY = e.clientY;
          swipeLock.currentX = 0;

          closeOtherSwipes(wrapEl.dataset.id);

          contentEl.style.transition = "none";
          wrapEl.setPointerCapture?.(e.pointerId);
        },
        { passive: true }
      );

      wrapEl.addEventListener(
        "pointermove",
        (e) => {
          if (!swipeLock.active || swipeLock.id !== wrapEl.dataset.id) return;

          const dx = e.clientX - swipeLock.startX;
          const dy = e.clientY - swipeLock.startY;

          if (!swipeLock.moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) {
            swipeLock.active = false;
            contentEl.style.transition = "";
            return;
          }
          if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;

          swipeLock.moved = true;

          const base = wrapEl.classList.contains("open") ? SWIPE_OPEN_X : 0;
          let x = base + dx;
          x = Math.min(0, x);

          if (x < SWIPE_FULL_DELETE) {
            const over = x - SWIPE_FULL_DELETE;
            x = SWIPE_FULL_DELETE + over * 0.35;
            x = Math.max(SWIPE_FULL_DELETE - SWIPE_OVERSHOOT, x);
          }

          swipeLock.currentX = x;
          contentEl.style.transform = `translateX(${x}px)`;
        },
        { passive: true }
      );

      const finish = async () => {
        if (!swipeLock.active || swipeLock.id !== wrapEl.dataset.id) return;

        contentEl.style.transition = "";
        const x = swipeLock.currentX;

        if (!swipeLock.moved) {
          if (wrapEl.classList.contains("open")) {
            wrapEl.classList.remove("open");
            State.openSwipeId = null;
          }
          swipeLock.active = false;
          contentEl.style.transform = "";
          return;
        }

        if (x <= SWIPE_FULL_DELETE) {
          const kick = SWIPE_FULL_DELETE - 22;
          contentEl.style.transform = `translateX(${kick}px)`;
          setTimeout(() => {
            contentEl.style.transform = `translateX(${SWIPE_FULL_DELETE}px)`;
            deleteEntryById(wrapEl.dataset.id, wrapEl);
          }, 60);
          swipeLock.active = false;
          return;
        }

        if (x <= SWIPE_THRESHOLD) {
          wrapEl.classList.add("open");
          State.openSwipeId = wrapEl.dataset.id;
        } else {
          wrapEl.classList.remove("open");
          State.openSwipeId = null;
        }
        contentEl.style.transform = "";
        swipeLock.active = false;
      };

      wrapEl.addEventListener("pointerup", finish, { passive: true });
      wrapEl.addEventListener("pointercancel", finish, { passive: true });
    }

    async function deleteEntryById(entryId, wrapEl) {
      const dayData = Storage.getDay(State.currentDate);
      const idx = dayData.entries.findIndex((e) => e.id === entryId);
      if (idx < 0) return;

      const prevPhotos = Array.isArray(dayData.entries[idx]?.photos)
        ? dayData.entries[idx].photos.slice()
        : [];

      if (wrapEl) wrapEl.classList.add("removing");

      setTimeout(async () => {
        dayData.entries.splice(idx, 1);
        Storage.sortEntries(dayData);

        const ok = Storage.saveDay(State.currentDate, dayData);
        if (!ok) {
          if (wrapEl) wrapEl.classList.remove("removing");
          return;
        }

        for (const p of prevPhotos) {
          try {
            await PhotosDB.del(p.id);
          } catch (e) {
            console.warn(e);
          }
        }

        Toast.show("削除しました");
        await App.loadAndRender(State.currentDate);
      }, 120);
    }

    document.addEventListener(
      "pointerdown",
      (e) => {
        if (State.openSwipeId && !e.target.closest(".entrySwipe")) closeAllSwipes();
      },
      { passive: true }
    );

    async function renderDay(dateStr) {
      await migrateLegacyPhotosForDay(dateStr);

      Header.renderNavDate(dateStr);

      const entriesDiv = DOM.entries;
      if (!entriesDiv) return;
      entriesDiv.innerHTML = "";

      const saved = Storage.getDay(dateStr);
      Storage.sortEntries(saved);

      if (saved.entries && saved.entries.length) {
        for (const entry of saved.entries) {
          const wrap = document.createElement("div");
          wrap.className = "entrySwipe";
          wrap.dataset.id = entry.id || "";

          const actions = document.createElement("div");
          actions.className = "entryActions";

          const delBtn = document.createElement("button");
          delBtn.className = "entryDeleteBtn";
          delBtn.type = "button";
          delBtn.innerHTML = `<span class="icon">🗑️</span><span class="label">削除</span>`;
          delBtn.onclick = (ev) => {
            ev.stopPropagation();
            deleteEntryById(entry.id, wrap);
          };
          actions.appendChild(delBtn);

          const content = document.createElement("div");
          content.className = "entryContent";

          const time = document.createElement("span");
          time.className = "time";
          time.textContent = entry.time && entry.time.trim() ? entry.time : "•";

          const main = document.createElement("div");
          main.className = "entryMain";

          const text = document.createElement("div");
          text.className = "text";
          text.textContent = entry.text || "";
          main.appendChild(text);

          if (entry.photos && entry.photos.length) {
            const photoGrid = document.createElement("div");
            photoGrid.className = "entryPhotoGrid";

            for (const p of entry.photos) {
              const img = document.createElement("img");
              img.className = "entryPhoto";
              img.alt = "photo";
              img.loading = "lazy";
              photoGrid.appendChild(img);
              renderPhotoThumb(p).then((src) => {
                if (src) img.src = src;
              });
            }

            main.appendChild(photoGrid);
          }

          if (entry.attachments && entry.attachments.length) {
            for (const a of entry.attachments) {
              const fileLine = document.createElement("div");
              fileLine.className = "fileLine";
              fileLine.textContent = `📎 ${a.name}`;
              main.appendChild(fileLine);
            }
          }

          content.appendChild(time);
          content.appendChild(main);

          attachSwipeHandlers(wrap, content);

          content.addEventListener("click", async () => {
            if (wrap.classList.contains("open")) {
              wrap.classList.remove("open");
              State.openSwipeId = null;
              return;
            }
            if (swipeLock.moved) return;
            await Input.beginEditById(entry.id);
          });

          wrap.appendChild(actions);
          wrap.appendChild(content);
          entriesDiv.appendChild(wrap);
        }
      } else {
        entriesDiv.innerHTML = `<div class="emptyState">この日はまだ記録がありません</div>`;
      }
    }

    return { renderDay };
  })();

  /* =======================
     Input
  ======================= */
  const Input = (() => {
    const expand = () => DOM.inputBar?.classList.add("expanded");
    const collapse = () => DOM.inputBar?.classList.remove("expanded");

    function setPreviewVisible(onOff) {
      DOM.previewArea?.classList.toggle("hasContent", !!onOff);
    }

    function clearPreview() {
      if (DOM.previewArea) DOM.previewArea.innerHTML = "";
      setPreviewVisible(false);
    }

    function resetPending() {
      State.pendingPhotos = [];
      State.pendingFileName = "";
    }

    function refreshTimeHint() {
      if (!DOM.timeHint) return;
      if (State.timeMode === "set" && State.selectedTime) {
        DOM.timeHint.textContent = State.selectedTime;
        DOM.timeHint.className = "isSet";
        return;
      }
      DOM.timeHint.textContent = nowHHMM();
      DOM.timeHint.className = "isAuto";
    }

    function commitTimeFromPicker() {
      if (!DOM.logTime) return;
      const raw = DOM.logTime.value || "";
      const rounded = raw ? roundTimeToStep(raw, TimeStep.stepMin) : "";
      DOM.logTime.value = rounded;
      State.selectedTime = rounded;
      State.timeMode = State.selectedTime ? "set" : "auto";
      State.tempTime = "";
      refreshTimeHint();
      expand();
      Layout.scheduleUpdate();
    }

    function startTimeTicker() {
      if (State.timeTicker) return;

      State.timeTicker = setInterval(async () => {
        if (State.timeMode === "auto") refreshTimeHint();

        const nowKey = formatYMD(new Date());
        if (nowKey !== State.todayKey) {
          const prevKey = State.todayKey;
          State.todayKey = nowKey;

          if (State.currentDate === prevKey) {
            State.currentDate = nowKey;
            await App.loadAndRender(State.currentDate);
            Toast.show("日付が変わりました");
          }
        }
      }, 1000);
    }

    const fileToDataURL = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

    async function imageFileToCompressedBlob(file, maxSide = 1600, quality = 0.82) {
      const dataUrl = await fileToDataURL(file);

      let orientation = 1;
      const isJpeg =
        file.type === "image/jpeg" || /\.(jpe?g)$/i.test(file.name || "");

      if (isJpeg) {
        try {
          const buf = await file.arrayBuffer();
          orientation = exifOrientationFromJpegArrayBuffer(buf);
        } catch (_) {
          orientation = 1;
        }
      }

      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });

      const srcW = img.naturalWidth || img.width || 0;
      const srcH = img.naturalHeight || img.height || 0;
      if (!srcW || !srcH) throw new Error("image size read failed");

      const needsSwap = [5, 6, 7, 8].includes(orientation);
      const baseW = needsSwap ? srcH : srcW;
      const baseH = needsSwap ? srcW : srcH;

      const scale = Math.min(1, maxSide / Math.max(baseW, baseH));
      const drawW = Math.max(1, Math.round(srcW * scale));
      const drawH = Math.max(1, Math.round(srcH * scale));

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas context failed");

      if (needsSwap) {
        canvas.width = drawH;
        canvas.height = drawW;
      } else {
        canvas.width = drawW;
        canvas.height = drawH;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      switch (orientation) {
        case 2:
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          break;
        case 3:
          ctx.translate(canvas.width, canvas.height);
          ctx.rotate(Math.PI);
          break;
        case 4:
          ctx.translate(0, canvas.height);
          ctx.scale(1, -1);
          break;
        case 5:
          ctx.rotate(0.5 * Math.PI);
          ctx.scale(1, -1);
          break;
        case 6:
          ctx.rotate(0.5 * Math.PI);
          ctx.translate(0, -drawH);
          break;
        case 7:
          ctx.rotate(0.5 * Math.PI);
          ctx.translate(drawW, -drawH);
          ctx.scale(-1, 1);
          break;
        case 8:
          ctx.rotate(-0.5 * Math.PI);
          ctx.translate(-drawW, 0);
          break;
        default:
          break;
      }

      ctx.drawImage(img, 0, 0, drawW, drawH);

      const blob = await new Promise((resolve) => {
        try {
          canvas.toBlob((b) => resolve(b || null), "image/jpeg", quality);
        } catch (_) {
          resolve(null);
        }
      });

      return blob;
    }

    async function handleAttachment(fileList) {
      const files = fileList ? Array.from(fileList) : [];
      if (!files.length) return;

      clearPreview();
      resetPending();

      const images = files.filter((f) => (f.type || "").startsWith("image/"));
      const nonImages = files.filter((f) => !(f.type || "").startsWith("image/"));

      if (images.length) {
        const safeImages = IS_SAFARI ? images.slice(0, 1) : images;
        if (IS_SAFARI && images.length > 1) {
          Toast.show("Safariでは写真は1回1枚が安定");
        }

        const grid = document.createElement("div");
        grid.className = "thumbGrid";

        for (const file of safeImages) {
          try {
            const name = file.name || "";
            const shotDate = await getShotDate(file);
            const shotAt = shotDate ? shotDate.getTime() : Date.now();
            const shotTime = shotDate ? hhmmFromDate(shotDate) : "";

            const maxSide = IS_SAFARI ? 1280 : 1600;
            const quality = IS_SAFARI ? 0.72 : 0.82;

            let blob = null;
            try {
              blob = await imageFileToCompressedBlob(file, maxSide, quality);
            } catch (_) {
              blob = null;
            }

            if (!blob) {
              try {
                blob = await imageFileToCompressedBlob(file, 960, 0.68);
              } catch (_) {
                blob = file;
              }
            }

            const pid = "p_" + uid();

            await PhotosDB.put({
              id: pid,
              blob,
              mime: blob.type || file.type || "image/*",
              name,
              createdAt: shotAt,
            });

            const verify = await PhotosDB.get(pid);
            if (!verify || !verify.blob) {
              throw new Error("IndexedDB write/read verification failed");
            }

            const dataUrl = await blobToDataURL(verify.blob);

            State.pendingPhotos.push({
              id: pid,
              name,
              shotAt,
              shotTime,
              mime: verify.mime || blob.type || "image/jpeg",
            });

            const img = document.createElement("img");
            img.src = dataUrl;
            img.alt = "attachment";
            grid.appendChild(img);
          } catch (e) {
            console.error("photo attach failed:", e);
            const msg = String(e && e.message ? e.message : e);
            if (/IndexedDB|database|quota/i.test(msg)) {
              Toast.show("写真保存失敗：Safariの保存制限の可能性");
            } else {
              Toast.show("写真の保存に失敗");
            }
            break;
          }
        }

        if (State.pendingPhotos.length) {
          DOM.previewArea?.appendChild(grid);
          const meta = document.createElement("div");
          meta.className = "thumbMeta";
          meta.textContent = `${State.pendingPhotos.length}枚の写真を選択`;
          DOM.previewArea?.appendChild(meta);

          setPreviewVisible(true);
          expand();
          Layout.scheduleUpdate();
          DOM.logInput?.focus?.();
        } else {
          clearPreview();
          resetPending();
        }
        return;
      }

      if (nonImages.length) {
        State.pendingFileName = nonImages[0].name || "";
        if (DOM.previewArea) {
          DOM.previewArea.innerHTML = `<div class="filePreview">📎 ${escapeHtml(
            State.pendingFileName
          )}</div>`;
        }
        setPreviewVisible(true);
        expand();
        Layout.scheduleUpdate();
        DOM.logInput?.focus?.();
      }
    }

    async function beginEditEntry(entry) {
      State.editingId = entry.id;

      expand();
      Layout.scheduleUpdate();

      if (DOM.logInput) DOM.logInput.value = entry.text || "";

      if (!entry.time) {
        State.timeMode = "auto";
        State.selectedTime = "";
        if (DOM.logTime) DOM.logTime.value = "";
      } else {
        State.timeMode = "set";
        State.selectedTime = entry.time;
        if (DOM.logTime) DOM.logTime.value = entry.time;
      }
      refreshTimeHint();

      resetPending();
      clearPreview();

      State.editingPrevPhotoIds = Array.isArray(entry.photos)
        ? entry.photos.map((p) => p.id)
        : [];

      if (entry.photos && entry.photos.length) {
        const grid = document.createElement("div");
        grid.className = "thumbGrid";

        for (const p of entry.photos) {
          try {
            const rec = await PhotosDB.get(p.id);
            if (!rec || !rec.blob) continue;
            const dataUrl = await blobToDataURL(rec.blob);

            State.pendingPhotos.push({
              id: p.id,
              name: p.name || rec.name || "",
              shotAt: p.shotAt || rec.createdAt || Date.now(),
              shotTime: p.shotTime || entry.time || "",
              mime: p.mime || rec.mime || "image/jpeg",
            });

            const img = document.createElement("img");
            img.src = dataUrl;
            img.alt = "attachment";
            grid.appendChild(img);
          } catch (e) {
            console.warn(e);
          }
        }

        if (State.pendingPhotos.length) {
          DOM.previewArea?.appendChild(grid);
          const meta = document.createElement("div");
          meta.className = "thumbMeta";
          meta.textContent = `編集中：写真 ${State.pendingPhotos.length}枚`;
          DOM.previewArea?.appendChild(meta);
          setPreviewVisible(true);
        }
      } else if (entry.attachments && entry.attachments.length) {
        State.pendingFileName = entry.attachments[0]?.name || "";
        if (DOM.previewArea) {
          DOM.previewArea.innerHTML = `<div class="filePreview">📎 ${escapeHtml(
            State.pendingFileName
          )}</div>`;
        }
        setPreviewVisible(true);
      }

      setTimeout(() => DOM.logInput?.focus?.(), 0);
      Toast.show("編集モード");
    }

    async function beginEditById(entryId) {
      const dayData = Storage.getDay(State.currentDate);
      const entry = (dayData.entries || []).find((e) => e.id === entryId);
      if (!entry) {
        Toast.show("編集対象が見つからない…");
        return;
      }
      await beginEditEntry(entry);
    }

    async function save() {
      if (State.isSaving) return;
      State.isSaving = true;

      try {
        await migrateLegacyPhotosForDay(State.currentDate);

        const text = (DOM.logInput?.value || "").trim();
        const hasPhoto = State.pendingPhotos.length > 0;
        const hasFileName = !!State.pendingFileName && !hasPhoto;

        let time = "";
        if (State.timeMode === "set") {
          time =
            roundTimeToStep(State.selectedTime, TimeStep.stepMin) ||
            State.selectedTime ||
            "";
          State.selectedTime = time;
          if (DOM.logTime) DOM.logTime.value = time;
          if (!time) State.timeMode = "auto";
        }

        if (State.timeMode === "auto") {
          if (hasPhoto) {
            const sortedShots = State.pendingPhotos
              .map((p) => p.shotTime)
              .filter(Boolean)
              .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
            time = sortedShots[0] || nowHHMM();
          } else {
            time = nowHHMM();
          }
        }

        if (!text && !hasPhoto && !hasFileName) {
          collapse();
          Layout.scheduleUpdate();
          DOM.logInput?.blur?.();
          return;
        }

        const dayData = Storage.getDay(State.currentDate);

        const baseText =
          text ||
          (hasPhoto ? "📷 写真" : hasFileName ? `📎 ${State.pendingFileName}` : "");

        const newEntry = {
          id: State.editingId || uid(),
          createdAt: hasPhoto
            ? Math.min(...State.pendingPhotos.map((p) => p.shotAt || Date.now()))
            : Date.now(),
          updatedAt: Date.now(),
          time,
          text: baseText,
          type: hasPhoto ? "photo" : hasFileName ? "file" : "text",
          photos: hasPhoto
            ? State.pendingPhotos.map((p) => ({
                id: p.id,
                name: p.name || "",
                shotAt: p.shotAt || Date.now(),
                shotTime: p.shotTime || "",
                mime: p.mime || "image/jpeg",
              }))
            : [],
          attachments: hasFileName
            ? [
                {
                  id: "",
                  name: State.pendingFileName,
                  mime: "",
                  kind: "file",
                },
              ]
            : [],
          note: "",
        };

        if (State.editingId) {
          const idx = (dayData.entries || []).findIndex((e) => e.id === State.editingId);
          if (idx >= 0) {
            const prev = dayData.entries[idx];
            newEntry.createdAt = prev.createdAt || newEntry.createdAt;
            dayData.entries[idx] = { ...prev, ...newEntry };
            Toast.show("更新しました");
          } else {
            dayData.entries.push(newEntry);
            Toast.show("追加しました");
          }

          const nextPhotoIds = new Set((newEntry.photos || []).map((p) => p.id));
          for (const oldId of State.editingPrevPhotoIds || []) {
            if (!nextPhotoIds.has(oldId)) {
              try {
                await PhotosDB.del(oldId);
              } catch (e) {
                console.warn(e);
              }
            }
          }
        } else {
          dayData.entries.push(newEntry);
          Toast.show("保存しました");
        }

        Storage.sortEntries(dayData);

        const ok = Storage.saveDay(State.currentDate, dayData);
        if (!ok) return;

        await App.loadAndRender(State.currentDate);

        State.editingId = null;
        State.editingPrevPhotoIds = [];

        if (DOM.logInput) DOM.logInput.value = "";
        clearPreview();
        resetPending();

        State.timeMode = "auto";
        State.selectedTime = "";
        if (DOM.logTime) DOM.logTime.value = "";
        refreshTimeHint();

        collapse();
        Layout.scheduleUpdate();
        DOM.logInput?.blur?.();
      } finally {
        setTimeout(() => {
          State.isSaving = false;
        }, 160);
      }
    }

    let lastFocusEl = null;

    function openPlusSheet() {
      lastFocusEl = document.activeElement;
      DOM.plusSheet?.classList.add("open");
      DOM.plusSheet?.removeAttribute("inert");
      requestAnimationFrame(() => DOM.actPhoto?.focus({ preventScroll: true }));
    }

    function closePlusSheet() {
      const ae = document.activeElement;
      if (
        ae &&
        DOM.plusSheet &&
        DOM.plusSheet.contains(ae) &&
        typeof ae.blur === "function"
      ) {
        ae.blur();
      }
      DOM.plusSheet?.setAttribute("inert", "");
      DOM.plusSheet?.classList.remove("open");
      const back = lastFocusEl || DOM.plusBtn;
      requestAnimationFrame(() => back?.focus?.({ preventScroll: true }));
    }

    function bind() {
      on(DOM.logInput, "focus", () => {
        expand();
        Layout.scheduleUpdate();
      });

      on(DOM.logInput, "beforeinput", () => {
        if (DOM.inputBar && !DOM.inputBar.classList.contains("expanded")) {
          expand();
          Layout.scheduleUpdate();
        }
      });

      on(DOM.logInput, "blur", () =>
        setTimeout(() => {
          collapse();
          Layout.scheduleUpdate();
        }, 80)
      );

      document.addEventListener(
        "pointerdown",
        (e) => {
          if (document.activeElement !== DOM.logInput) return;
          if (DOM.inputBar && DOM.inputBar.contains(e.target)) return;
          DOM.logInput?.blur?.();
          State.editingId = null;
        },
        { passive: true }
      );

      on(
        DOM.logTime,
        "pointerdown",
        () => {
          if (DOM.logTime && !DOM.logTime.value) DOM.logTime.value = nowHHMM();
        },
        { passive: true }
      );

      on(
        DOM.logTime,
        "input",
        () => {
          State.tempTime = DOM.logTime?.value || "";
          if (!DOM.timeHint) return;
          if (State.tempTime) {
            DOM.timeHint.textContent = State.tempTime;
            DOM.timeHint.className = "isSet";
          } else {
            refreshTimeHint();
          }
        },
        { passive: true }
      );

      on(DOM.logTime, "blur", commitTimeFromPicker, { passive: true });
      on(DOM.logTime, "change", commitTimeFromPicker, { passive: true });

      on(DOM.saveBtn, "click", save);

      on(DOM.plusBtn, "click", openPlusSheet);
      on(DOM.plusSheetBackdrop, "click", closePlusSheet);
      on(DOM.actCancel, "click", closePlusSheet);

      on(DOM.actPhoto, "click", () => {
        closePlusSheet();
        setTimeout(() => DOM.pickPhotoInput?.click(), 30);
      });

      on(DOM.actCamera, "click", () => {
        closePlusSheet();
        setTimeout(() => DOM.takePhotoInput?.click(), 30);
      });

      on(DOM.actFile, "click", () => {
        closePlusSheet();
        setTimeout(() => DOM.fileInput?.click(), 30);
      });

      [DOM.fileInput, DOM.pickPhotoInput, DOM.takePhotoInput].forEach((inp) => {
        if (!inp) return;
        inp.addEventListener("change", (e) => {
          handleAttachment(e.target.files);
          e.target.value = "";
        });
      });
    }

    return { bind, refreshTimeHint, startTimeTicker, beginEditById };
  })();

  /* =======================
     Noteshelf Export
  ======================= */
  const NoteshelfExport = (() => {
    async function buildDayPayload(dateKey) {
      const day = Storage.getDay(dateKey);
      Storage.sortEntries(day);

      const blocks = [];

      for (const entry of day.entries || []) {
        const photos = [];

        for (const p of entry.photos || []) {
          try {
            const rec = await PhotosDB.get(p.id);
            if (!rec || !rec.blob) continue;
            const dataUrl = await blobToDataURL(rec.blob);

            photos.push({
              id: p.id,
              name: p.name || rec.name || "",
              dataUrl,
              shotAt: p.shotAt || rec.createdAt || Date.now(),
              shotTime: p.shotTime || entry.time || "",
            });
          } catch (e) {
            console.warn("noteshelf export photo read failed:", e);
          }
        }

        photos.sort((a, b) => (a.shotAt || 0) - (b.shotAt || 0));

        blocks.push({
          kind: "entry",
          id: entry.id,
          time: entry.time || "",
          text: entry.text || "",
          photos,
          attachments: entry.attachments || [],
        });
      }

      return {
        date: dateKey,
        summary: day.summary || "",
        summarySpaceLines: day?.noteshelf?.summarySpaceLines || 12,
        blocks,
      };
    }

    function buildDayHtmlString(payload) {
      const titleDate = parseYMD(payload.date).toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "short",
      });

      const entryHtml = payload.blocks
        .map((b) => {
          const hasPhotos = Array.isArray(b.photos) && b.photos.length > 0;

          const photosHtml = (b.photos || [])
            .map(
              (p) => `
                <div class="photoWrap">
                  <img src="${p.dataUrl}" alt="${escapeHtml(p.name || "photo")}">
                </div>
              `
            )
            .join("");

          const filesHtml = (b.attachments || [])
            .map((a) => `<div class="fileLine">📎 ${escapeHtml(a.name)}</div>`)
            .join("");

          return `
            <section class="entry ${hasPhotos ? "hasPhoto" : ""}">
              <div class="time">${escapeHtml(b.time || "•")}</div>
              <div class="body">
                <div class="text">${escapeHtml(b.text || "").replace(/\n/g, "<br>")}</div>
                ${
                  hasPhotos
                    ? `
                      <div class="photoRow">
                        <div class="memoCol">
                          <div class="memoBox"></div>
                        </div>
                        <div class="photoCol">
                          ${photosHtml}
                        </div>
                      </div>
                    `
                    : ""
                }
                ${filesHtml}
              </div>
            </section>
          `;
        })
        .join("");

      const summaryLines = new Array(payload.summarySpaceLines)
        .fill('<div class="summaryLine"></div>')
        .join("");

      return `
        <div id="noteshelfPdfPage" class="pdfPage">
          <div class="page">
            <header class="header">
              <h1 class="title">LOGDAY</h1>
              <div class="sub">${escapeHtml(titleDate)}</div>
            </header>

            ${entryHtml || '<div class="sub">この日はまだ記録がありません</div>'}

            <section class="summary">
              <div class="summaryTitle">総括 / メモ</div>
              <div class="summaryText">${escapeHtml(payload.summary || "").replace(/\n/g, "<br>")}</div>
              <div class="summaryLines">${summaryLines}</div>
            </section>
          </div>
        </div>
      `;
    }

    function ensureExportRoot() {
      let root = document.getElementById("pdfExportRoot");
      if (!root) {
        root = document.createElement("div");
        root.id = "pdfExportRoot";
        root.style.position = "fixed";
        root.style.left = "-100000px";
        root.style.top = "0";
        root.style.width = "1240px";
        root.style.zIndex = "-1";
        document.body.appendChild(root);
      }
      return root;
    }

    function injectExportStyle() {
      if (document.getElementById("noteshelfPdfStyle")) return;

      const style = document.createElement("style");
      style.id = "noteshelfPdfStyle";
      style.textContent = `
        .pdfPage {
          width: 1240px;
          background: #000;
          color: #fff;
          font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
          padding: 36px 28px 44px;
          box-sizing: border-box;
        }

        .pdfPage * {
          box-sizing: border-box;
        }

        .pdfPage .page {
          width: 100%;
          min-height: 1754px;
        }

        .pdfPage .header {
          border-bottom: 1px solid rgba(255,255,255,0.18);
          padding-bottom: 18px;
          margin-bottom: 24px;
        }

        .pdfPage .title {
          font-size: 42px;
          font-weight: 800;
          margin: 0 0 10px;
          letter-spacing: 0.03em;
        }

        .pdfPage .sub {
          font-size: 20px;
          color: rgba(255,255,255,0.76);
        }

        .pdfPage .entry {
          display: grid;
          grid-template-columns: 88px 1fr;
          gap: 18px;
          padding: 18px 0 22px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }

        .pdfPage .time {
          font-size: 22px;
          font-weight: 700;
          color: rgba(255,255,255,0.88);
          padding-top: 4px;
          white-space: nowrap;
        }

        .pdfPage .body {
          min-width: 0;
        }

        .pdfPage .text {
          font-size: 30px;
          font-weight: 500;
          line-height: 1.7;
          word-break: break-word;
          margin-bottom: 18px;
        }

        .pdfPage .photoRow {
          display: grid;
          grid-template-columns: 1.45fr 1fr;
          gap: 22px;
          align-items: stretch;
          margin-top: 10px;
        }

        .pdfPage .memoCol {
          min-height: 520px;
        }

        .pdfPage .memoBox {
          width: 100%;
          min-height: 520px;
          border-radius: 12px;
          background:
            repeating-linear-gradient(
              to bottom,
              transparent 0,
              transparent 46px,
              rgba(255,255,255,0.12) 47px,
              transparent 48px
            );
        }

        .pdfPage .photoCol {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 16px;
        }

        .pdfPage .photoWrap {
          width: 100%;
          max-width: 360px;
          border-radius: 16px;
          overflow: hidden;
          background: #111;
          border: 1px solid rgba(255,255,255,0.08);
        }

        .pdfPage .photoWrap img {
          display: block;
          width: 100%;
          height: auto;
        }

        .pdfPage .fileLine {
          font-size: 20px;
          color: rgba(255,255,255,0.78);
          margin-top: 8px;
        }

        .pdfPage .summary {
          margin-top: 36px;
          padding-top: 10px;
        }

        .pdfPage .summaryTitle {
          font-size: 30px;
          font-weight: 800;
          margin-bottom: 16px;
        }

        .pdfPage .summaryText {
          min-height: 48px;
          margin-bottom: 14px;
          font-size: 24px;
          color: rgba(255,255,255,0.96);
          line-height: 1.7;
        }

        .pdfPage .summaryLines {
          min-height: 760px;
        }

        .pdfPage .summaryLine {
          height: 40px;
          border-bottom: 1px solid rgba(255,255,255,0.14);
        }
      `;
      document.head.appendChild(style);
    }

    async function exportDayPdf(dateKey) {
      if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) {
        Toast.show("PDFライブラリが読み込めていない");
        return;
      }

      injectExportStyle();

      const payload = await buildDayPayload(dateKey);
      const root = ensureExportRoot();
      root.innerHTML = buildDayHtmlString(payload);

      const pageEl = root.querySelector("#noteshelfPdfPage");
      if (!pageEl) throw new Error("PDFレイアウト生成失敗");

      await new Promise((resolve) => setTimeout(resolve, 120));

      const canvas = await window.html2canvas(pageEl, {
        backgroundColor: "#000000",
        scale: IS_SAFARI ? 1.2 : 1.5,
        useCORS: true,
        logging: false,
      });

      const imgData = canvas.toDataURL("image/jpeg", IS_SAFARI ? 0.88 : 0.92);

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({
        orientation: "p",
        unit: "mm",
        format: "a4",
        compress: true,
      });

      const pageWidth = 210;
      const pageHeight = 297;
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      if (imgHeight <= pageHeight) {
        pdf.addImage(imgData, "JPEG", 0, 0, imgWidth, imgHeight, undefined, "FAST");
      } else {
        let y = 0;
        let pageIndex = 0;

        const pageCanvas = document.createElement("canvas");
        const pageCtx = pageCanvas.getContext("2d");
        const sliceHeightPx = Math.floor((canvas.width * pageHeight) / pageWidth);

        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHeightPx;

        while (y < canvas.height) {
          pageCtx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
          pageCtx.fillStyle = "#000";
          pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

          pageCtx.drawImage(
            canvas,
            0,
            y,
            canvas.width,
            sliceHeightPx,
            0,
            0,
            pageCanvas.width,
            sliceHeightPx
          );

          const pageImg = pageCanvas.toDataURL("image/jpeg", IS_SAFARI ? 0.88 : 0.92);

          if (pageIndex > 0) pdf.addPage();
          pdf.addImage(pageImg, "JPEG", 0, 0, pageWidth, pageHeight, undefined, "FAST");

          y += sliceHeightPx;
          pageIndex++;
        }
      }

      pdf.save(`logday-noteshelf-${dateKey}.pdf`);
      root.innerHTML = "";
    }

    return {
      exportDayPdf,
    };
  })();

  /* =======================
     Settings
  ======================= */
  const Settings = (() => {
    let lastFocusEl = null;

    function open() {
      lastFocusEl = document.activeElement;
      DOM.settingsModal?.classList.add("open");
      DOM.settingsModal?.removeAttribute("inert");
      requestAnimationFrame(() => DOM.closeSettings?.focus?.({ preventScroll: true }));
    }

    function close() {
      const ae = document.activeElement;
      if (
        ae &&
        DOM.settingsModal &&
        DOM.settingsModal.contains(ae) &&
        typeof ae.blur === "function"
      ) {
        ae.blur();
      }
      DOM.settingsModal?.setAttribute("inert", "");
      DOM.settingsModal?.classList.remove("open");
      const back = lastFocusEl || DOM.settingsBtn;
      requestAnimationFrame(() => back?.focus?.({ preventScroll: true }));
    }

    function bindModal() {
      on(DOM.settingsBtn, "click", open);
      on(DOM.closeSettings, "click", close);
      on(DOM.settingsBackdrop, "click", close);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && DOM.settingsModal?.classList.contains("open")) close();
      });
    }

    function bindExport() {
      on(DOM.exportLogday, "click", () => {
        const out = Storage.exportAll();
        const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `logday-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
    }

    function bindNoteshelfPdfExport() {
      on(DOM.exportNoteshelfPdf, "click", async () => {
        try {
          Toast.show("PDFを作成中...");
          await NoteshelfExport.exportDayPdf(State.currentDate);
          Toast.show("PDFを書き出しました");
        } catch (e) {
          console.error(e);
          Toast.show("PDF書き出しに失敗");
        }
      });
    }

    async function cleanupAllLegacyPhotos() {
      const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
      const keys = Object.keys(localStorage).filter((k) => dateKeyRe.test(k));

      let moved = 0;
      let changedDays = 0;

      for (const k of keys) {
        const r = await migrateLegacyPhotosForDay(k);
        if (r.changed) changedDays++;
        moved += r.moved || 0;
      }
      Toast.show(`容量回復: ${changedDays}日 / 移行${moved}枚`);
    }

    function bindCleanup() {
      on(DOM.cleanupStorage, "click", async () => {
        if (
          !confirm(
            "容量を回復するよ。\n古い写真(dataURL)をIndexedDBへ移行して保存エラーを減らす。\n\n実行する？"
          )
        ) {
          return;
        }
        await cleanupAllLegacyPhotos();
      });
    }

    function bindImport() {
      const input = DOM.importFile;
      if (!input) return;

      const handler = async () => {
        const file = input.files && input.files[0];
        if (!file) return;

        try {
          const text = await file.text();
          const data = JSON.parse(text);

          const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
          const dateKeys = Object.keys(data || {}).filter((k) => dateKeyRe.test(k));

          if (dateKeys.length === 0) {
            Toast.show("バックアップ形式が違うかも");
            return;
          }

          if (
            !confirm(
              `データを復元するよ（${dateKeys.length}日分）\n同じ日付は上書き。\n実行する？`
            )
          ) {
            return;
          }

          for (const k of dateKeys) {
            const normalized = Storage.normalizeDay(k, data[k]);
            localStorage.setItem(k, JSON.stringify(normalized));
          }

          alert(`復元完了！（${dateKeys.length}日分）`);
          input.value = "";
          location.reload();
        } catch (err) {
          console.error(err);
          alert("読み込みに失敗した…");
        }
      };

      input.addEventListener("change", handler);
      input.addEventListener("input", handler);
    }

    function init() {
      bindModal();
      bindExport();
      bindNoteshelfPdfExport();
      bindCleanup();
      bindImport();
    }

    return { init };
  })();

  /* =======================
     App
  ======================= */
  const App = (() => {
    async function loadAndRender(dateKey) {
      Header.renderNavDate(dateKey);
      if (State.viewMode === "week") Calendar.renderWeekBar(dateKey);
      else Calendar.renderMonthCalendar();
      await Entries.renderDay(dateKey);
      Layout.scheduleUpdate();
    }

    async function init() {
      PhotosDB.open().catch(() => {});
      const ok = await PhotosDB.ping();
      if (ok === false) {
        Toast.show("写真DBが使えない状態");
      }

      Header.initShadow();
      Calendar.init();

      TimeStep.init();
      Input.bind();
      Input.refreshTimeHint();
      Input.startTimeTicker();

      Settings.init();

      await Calendar.showWeek();
      await loadAndRender(State.currentDate);

      Layout.init();
    }

    return { init, loadAndRender };
  })();

  /* =======================
     Boot
  ======================= */
  App.init();
})();    const [y, m, d] = String(str).split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const timeToMinutes = (t) => {
    if (!t) return 999999;
    const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return 999999;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  };

  const roundTimeToStep = (timeStr, stepMin) => {
    const m = String(timeStr || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return "";
    let h = parseInt(m[1], 10);
    let mi = parseInt(m[2], 10);
    const rounded = Math.round(mi / stepMin) * stepMin;
    if (rounded === 60) {
      mi = 0;
      h = (h + 1) % 24;
    } else {
      mi = rounded;
    }
    return `${pad2(h)}:${pad2(mi)}`;
  };

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  /* =======================
     Toast
  ======================= */
  const Toast = (() => {
    const el = $("toast");
    let timer = null;

    function show(message) {
      if (!el) return;
      el.textContent = message;
      el.classList.add("show");
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove("show"), 1400);
    }

    return { show };
  })();

  /* =======================
     Storage
  ======================= */
  const Storage = (() => {
    function normalizePhoto(raw, fallbackCreatedAt = Date.now()) {
      if (!raw) return null;
      if (typeof raw === "string") {
        return {
          id: raw,
          name: "",
          shotAt: fallbackCreatedAt,
          shotTime: "",
          mime: "image/jpeg",
        };
      }
      return {
        id: raw.id || "",
        name: raw.name || "",
        shotAt: Number(raw.shotAt || fallbackCreatedAt),
        shotTime: raw.shotTime || "",
        mime: raw.mime || "image/jpeg",
      };
    }

    function normalizeEntry(raw, fallbackCreatedAt = Date.now()) {
      const entry = raw || {};
      const createdAt = Number(entry.createdAt || fallbackCreatedAt);

      let photos = [];
      if (Array.isArray(entry.photos)) {
        photos = entry.photos.map((p) => normalizePhoto(p, createdAt)).filter(Boolean);
      } else if (entry.photoId) {
        photos = [
          normalizePhoto(
            {
              id: entry.photoId,
              name: entry.fileName || "",
              shotAt: createdAt,
              shotTime: entry.time || "",
              mime: "image/jpeg",
            },
            createdAt
          ),
        ].filter(Boolean);
      }

      let attachments = [];
      if (Array.isArray(entry.attachments)) {
        attachments = entry.attachments.map((a) => ({
          id: a.id || "",
          name: a.name || "",
          mime: a.mime || "",
          kind: a.kind || "file",
        }));
      } else if (entry.fileName && !photos.length) {
        attachments = [
          {
            id: "",
            name: entry.fileName,
            mime: "",
            kind: "file",
          },
        ];
      }

      return {
        id: entry.id || uid(),
        createdAt,
        updatedAt: Number(entry.updatedAt || createdAt),
        time: entry.time || "",
        text: entry.text || "",
        type: entry.type || (photos.length ? "photo" : attachments.length ? "file" : "text"),
        photos,
        attachments,
        note: entry.note || "",
      };
    }

    function normalizeDay(dateKey, raw) {
      const day = raw || {};
      const base = {
        version: DATA_VERSION,
        date: dateKey,
        createdAt: Number(day.createdAt || Date.now()),
        updatedAt: Number(day.updatedAt || Date.now()),
        summary: day.summary || "",
        noteshelf: {
          theme: "dark",
          textColor: "#FFFFFF",
          summarySpaceLines: Number(day?.noteshelf?.summarySpaceLines || 12),
        },
        entries: [],
      };

      const srcEntries = Array.isArray(day.entries) ? day.entries : [];
      base.entries = srcEntries.map((e) => normalizeEntry(e, Date.now()));

      return base;
    }

    function getDay(dateKey) {
      try {
        const raw = JSON.parse(localStorage.getItem(dateKey) || "{}");
        return normalizeDay(dateKey, raw);
      } catch (e) {
        console.warn("getDay parse failed:", e);
        return normalizeDay(dateKey, {});
      }
    }

    function saveDay(dateKey, dayData) {
      try {
        const normalized = normalizeDay(dateKey, dayData);
        normalized.version = DATA_VERSION;
        normalized.date = dateKey;
        normalized.updatedAt = Date.now();

        localStorage.setItem(dateKey, JSON.stringify(normalized));
        return true;
      } catch (err) {
        console.error("saveDay failed:", err);
        if (err && String(err.name) === "QuotaExceededError") {
          Toast.show("保存できなかった：容量オーバー");
        } else {
          Toast.show("保存できなかった…");
        }
        return false;
      }
    }

    function sortEntries(dayData) {
      const arr = dayData.entries || [];
      arr.sort((a, b) => {
        const ta = timeToMinutes(a.time);
        const tb = timeToMinutes(b.time);
        if (ta !== tb) return ta - tb;

        const ca = a.createdAt ?? 0;
        const cb = b.createdAt ?? 0;
        if (ca !== cb) return ca - cb;

        return String(a.id || "").localeCompare(String(b.id || ""));
      });
    }

    function exportAll() {
      const out = {};
      for (const k of Object.keys(localStorage)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k)) {
          out[k] = getDay(k);
        }
      }
      return out;
    }

    return {
      saveDay,
      getDay,
      sortEntries,
      exportAll,
      normalizeDay,
    };
  })();

  /* =======================
     EXIF
  ======================= */
  function exifDateFromJpegArrayBuffer(buf) {
    const dv = new DataView(buf);
    if (dv.getUint16(0, false) !== 0xffd8) return null;

    let offset = 2;
    const len = dv.byteLength;

    while (offset + 4 < len) {
      if (dv.getUint8(offset) !== 0xff) break;
      const marker = dv.getUint8(offset + 1);
      const size = dv.getUint16(offset + 2, false);

      if (marker === 0xe1) {
        const exifHeader = offset + 4;
        const isExif =
          dv.getUint8(exifHeader) === 0x45 &&
          dv.getUint8(exifHeader + 1) === 0x78 &&
          dv.getUint8(exifHeader + 2) === 0x69 &&
          dv.getUint8(exifHeader + 3) === 0x66 &&
          dv.getUint8(exifHeader + 4) === 0x00 &&
          dv.getUint8(exifHeader + 5) === 0x00;
        if (!isExif) return null;

        const tiffStart = exifHeader + 6;
        const endianMark = dv.getUint16(tiffStart, false);
        const little = endianMark === 0x4949;
        const get16 = (p) => dv.getUint16(p, little);
        const get32 = (p) => dv.getUint32(p, little);

        if (get16(tiffStart + 2) !== 0x002a) return null;

        const ifd0Offset = get32(tiffStart + 4);
        const ifd0 = tiffStart + ifd0Offset;
        if (ifd0 + 2 > len) return null;

        const num0 = get16(ifd0);
        let exifIFDPtr = null;

        for (let i = 0; i < num0; i++) {
          const ent = ifd0 + 2 + i * 12;
          const tag = get16(ent);
          if (tag === 0x8769) {
            exifIFDPtr = get32(ent + 8);
            break;
          }
        }
        if (exifIFDPtr == null) return null;

        const exifIFD = tiffStart + exifIFDPtr;
        if (exifIFD + 2 > len) return null;

        const numE = get16(exifIFD);

        const readAscii = (valueOffset, count) => {
          const start = tiffStart + valueOffset;
          if (start + count > len) return null;
          let s = "";
          for (let i = 0; i < count; i++) {
            const c = dv.getUint8(start + i);
            if (c === 0) break;
            s += String.fromCharCode(c);
          }
          return s;
        };

        for (let i = 0; i < numE; i++) {
          const ent = exifIFD + 2 + i * 12;
          const tag = get16(ent);

          if (tag === 0x9003 || tag === 0x0132) {
            const type = get16(ent + 2);
            const count = get32(ent + 4);
            const valueOffset = get32(ent + 8);
            if (type !== 2 || count < 10) continue;

            const str = readAscii(valueOffset, count);
            if (!str) continue;

            const m = str.match(
              /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/
            );
            if (!m) continue;

            return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
          }
        }
        return null;
      }

      offset += 2 + size;
    }

    return null;
  }

  function exifOrientationFromJpegArrayBuffer(buf) {
    const dv = new DataView(buf);
    if (dv.getUint16(0, false) !== 0xffd8) return 1;

    let offset = 2;
    const len = dv.byteLength;

    while (offset + 4 < len) {
      if (dv.getUint8(offset) !== 0xff) break;
      const marker = dv.getUint8(offset + 1);
      const size = dv.getUint16(offset + 2, false);

      if (marker === 0xe1) {
        const exifHeader = offset + 4;
        const isExif =
          dv.getUint8(exifHeader) === 0x45 &&
          dv.getUint8(exifHeader + 1) === 0x78 &&
          dv.getUint8(exifHeader + 2) === 0x69 &&
          dv.getUint8(exifHeader + 3) === 0x66 &&
          dv.getUint8(exifHeader + 4) === 0x00 &&
          dv.getUint8(exifHeader + 5) === 0x00;

        if (!isExif) return 1;

        const tiffStart = exifHeader + 6;
        const endianMark = dv.getUint16(tiffStart, false);
        const little = endianMark === 0x4949;
        const get16 = (p) => dv.getUint16(p, little);
        const get32 = (p) => dv.getUint32(p, little);

        if (get16(tiffStart + 2) !== 0x002a) return 1;

        const ifd0Offset = get32(tiffStart + 4);
        const ifd0 = tiffStart + ifd0Offset;
        if (ifd0 + 2 > len) return 1;

        const num0 = get16(ifd0);

        for (let i = 0; i < num0; i++) {
          const ent = ifd0 + 2 + i * 12;
          const tag = get16(ent);
          if (tag === 0x0112) return get16(ent + 8) || 1;
        }
        return 1;
      }

      offset += 2 + size;
    }

    return 1;
  }

  async function getShotDate(file) {
    const isJpeg =
      file.type === "image/jpeg" || /\.(jpe?g)$/i.test(file.name || "");

    if (isJpeg) {
      try {
        const buf = await file.arrayBuffer();
        const exifDate = exifDateFromJpegArrayBuffer(buf);
        if (exifDate && !isNaN(exifDate.getTime())) return exifDate;
      } catch (_) {}
    }

    const lm = file.lastModified ? new Date(file.lastModified) : null;
    if (lm && !isNaN(lm.getTime())) return lm;
    return null;
  }

  /* =======================
     PhotosDB
  ======================= */
  const PhotosDB = (() => {
    const DB_NAME = "logday_db";
    const DB_VER = 1;
    let dbPromise = null;

    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("photos")) {
            const store = db.createObjectStore("photos", { keyPath: "id" });
            store.createIndex("createdAt", "createdAt", { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbPromise;
    }

    async function put({ id, blob, mime, name, createdAt }) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("photos", "readwrite");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.objectStore("photos").put({ id, blob, mime, name, createdAt });
      });
    }

    async function get(id) {
      if (!id) return null;
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("photos", "readonly");
        const req = tx.objectStore("photos").get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }

    async function del(id) {
      if (!id) return;
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("photos", "readwrite");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.objectStore("photos").delete(id);
      });
    }

    async function dataUrlToBlob(dataUrl) {
      const res = await fetch(dataUrl);
      return await res.blob();
    }

    async function ping() {
      try {
        await open();
        const id = "ping_" + uid();
        await put({
          id,
          blob: new Blob(["ok"], { type: "text/plain" }),
          mime: "text/plain",
          name: "ping",
          createdAt: Date.now(),
        });
        await del(id);
        return true;
      } catch (e) {
        console.warn("IndexedDB unavailable:", e);
        return false;
      }
    }

    return { open, put, get, del, dataUrlToBlob, ping };
  })();

  /* =======================
     Legacy migrate
  ======================= */
  async function migrateLegacyPhotosForDay(dateKey) {
    const dayData = Storage.getDay(dateKey);
    let changed = false;
    let moved = 0;

    for (const e of dayData.entries || []) {
      if (Array.isArray(e.photos) && e.photos.length) continue;

      const isLegacy =
        e && typeof e.photo === "string" && e.photo.startsWith("data:image/");

      if (!isLegacy) continue;

      try {
        const blob = await PhotosDB.dataUrlToBlob(e.photo);
        const pid = "p_" + uid();
        await PhotosDB.put({
          id: pid,
          blob,
          mime: blob.type || "image/jpeg",
          name: "photo.jpg",
          createdAt: e.createdAt || Date.now(),
        });

        e.photos = [
          {
            id: pid,
            name: "photo.jpg",
            shotAt: e.createdAt || Date.now(),
            shotTime: e.time || "",
            mime: blob.type || "image/jpeg",
          },
        ];
        e.type = "photo";
        delete e.photo;
        delete e.photoId;
        moved++;
        changed = true;
      } catch (err) {
        console.warn("legacy migrate failed", err);
        delete e.photo;
        changed = true;
      }
    }

    if (changed) Storage.saveDay(dateKey, dayData);
    return { changed, moved };
  }

  /* =======================
     State / DOM refs
  ======================= */
  const State = {
    viewMode: "week",
    currentDate: formatYMD(new Date()),
    todayKey: formatYMD(new Date()),

    timeMode: "auto",
    selectedTime: "",
    tempTime: "",
    timeTicker: null,

    editingId: null,
    editingPrevPhotoIds: [],
    isSaving: false,

    pendingPhotos: [],
    pendingFileName: "",

    openSwipeId: null,
  };

  const DOM = {
    navDate: $("navDate"),
    toggleBtn: $("toggleBtn"),
    calendar: $("calendar"),
    weekBar: $("weekBar"),
    topSticky: $("topSticky"),

    entries: $("entries"),

    inputBar: $("inputBar"),
    plusBtn: $("plusBtn"),
    logInput: $("logInput"),
    saveBtn: $("saveBtn"),
    timeHint: $("timeHint"),
    logTime: $("logTime"),
    previewArea: $("previewArea"),
    fileInput: $("fileInput"),
    pickPhotoInput: $("pickPhotoInput"),
    takePhotoInput: $("takePhotoInput"),

    plusSheet: $("plusSheet"),
    plusSheetBackdrop: $("plusSheetBackdrop"),
    actPhoto: $("actPhoto"),
    actCamera: $("actCamera"),
    actFile: $("actFile"),
    actCancel: $("actCancel"),

    settingsBtn: $("settingsBtn"),
    settingsModal: $("settingsModal"),
    settingsBackdrop: $("settingsBackdrop"),
    closeSettings: $("closeSettings"),
    exportLogday: $("exportLogday"),
    exportNoteshelfPdf: $("exportNoteshelfPdf"),
    cleanupStorage: $("cleanupStorage"),
    timeStepBtn: $("timeStepBtn"),
    importFile: $("importFile"),
  };

  /* =======================
     Layout
  ======================= */
  const Layout = (() => {
    let raf = null;

    function updateBodyPadding() {
      if (!DOM.inputBar) return;
      const h = DOM.inputBar.getBoundingClientRect().height || 0;
      document.body.style.paddingBottom = `calc(${Math.ceil(
        h
      )}px + env(safe-area-inset-bottom, 0px))`;
    }

    function scheduleUpdate() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateBodyPadding);
    }

    function init() {
      scheduleUpdate();
      if ("ResizeObserver" in window && DOM.inputBar) {
        const ro = new ResizeObserver(() => scheduleUpdate());
        ro.observe(DOM.inputBar);
      } else {
        window.addEventListener("resize", scheduleUpdate, { passive: true });
      }
    }

    return { init, scheduleUpdate };
  })();

  /* =======================
     TimeStep
  ======================= */
  const TimeStep = (() => {
    const STEP_KEY = "logday_time_step_min";
    let stepMin = 10;

    function get() {
      const v = parseInt(localStorage.getItem(STEP_KEY) || "10", 10);
      return v === 1 || v === 10 ? v : 10;
    }

    function set(v) {
      const step = v === 1 || v === 10 ? v : 10;
      localStorage.setItem(STEP_KEY, String(step));
      stepMin = step;
      if (DOM.logTime) DOM.logTime.step = String(stepMin * 60);
      refreshLabel();
      Toast.show(stepMin === 1 ? "分刻み：1分" : "分刻み：10分");
    }

    function refreshLabel() {
      if (!DOM.timeStepBtn) return;
      DOM.timeStepBtn.textContent =
        stepMin === 1 ? "分刻み：1分" : "分刻み：10分";
    }

    function init() {
      stepMin = get();
      if (DOM.logTime) DOM.logTime.step = String(stepMin * 60);
      refreshLabel();
      on(DOM.timeStepBtn, "click", () => set(stepMin === 10 ? 1 : 10));
    }

    return {
      init,
      get stepMin() {
        return stepMin;
      },
    };
  })();

  /* =======================
     Header
  ======================= */
  const Header = (() => {
    function renderNavDate(dateStr) {
      const d = parseYMD(dateStr);
      const dateText = d.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const weekdayText = d.toLocaleDateString("ja-JP", { weekday: "short" });
      if (DOM.navDate) DOM.navDate.textContent = `${dateText}（${weekdayText}）`;
    }

    function updateToggleLabel() {
      if (!DOM.toggleBtn) return;
      DOM.toggleBtn.textContent = State.viewMode === "week" ? "月" : "週";
      DOM.toggleBtn.title = State.viewMode === "week" ? "月表示へ" : "週表示へ";
      DOM.toggleBtn.setAttribute(
        "aria-pressed",
        State.viewMode === "month" ? "true" : "false"
      );
    }

    function initShadow() {
      if (!DOM.topSticky) return;
      const TH = 6;
      const onScroll = () =>
        DOM.topSticky.classList.toggle("isScrolled", window.scrollY > TH);
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }

    return { renderNavDate, updateToggleLabel, initShadow };
  })();

  /* =======================
     Calendar
  ======================= */
  const Calendar = (() => {
    const wnames = ["月", "火", "水", "木", "金", "土", "日"];

    function startOfWeek(dateStr) {
      const d = parseYMD(dateStr);
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      return d;
    }

    function renderWeekBar(dateStr) {
      const bar = DOM.weekBar;
      if (!bar) return;

      bar.style.display = State.viewMode === "week" ? "grid" : "none";
      if (State.viewMode !== "week") return;

      bar.innerHTML = "";
      const start = startOfWeek(dateStr);

      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const ymd = formatYMD(d);

        const btn = document.createElement("button");
        btn.dataset.date = ymd;
        btn.innerHTML = `${wnames[i]}<span class="d">${d.getDate()}</span>`;
        btn.classList.toggle("active", ymd === State.currentDate);

        const saved = Storage.getDay(ymd);
        if ((saved.entries || []).length > 0) btn.classList.add("hasEntry");

        btn.onclick = async () => {
          State.currentDate = ymd;
          await App.loadAndRender(State.currentDate);
        };

        bar.appendChild(btn);
      }
    }

    function renderMonthCalendar() {
      const cal = DOM.calendar;
      if (!cal) return;

      cal.innerHTML = "";
      const d = new Date(State.currentDate);
      const year = d.getFullYear();
      const month = d.getMonth();

      const firstDay = new Date(year, month, 1);
      const lastDate = new Date(year, month + 1, 0).getDate();
      const blanks = (firstDay.getDay() + 6) % 7;

      for (let i = 0; i < blanks; i++) {
        const empty = document.createElement("button");
        empty.disabled = true;
        empty.style.visibility = "hidden";
        cal.appendChild(empty);
      }

      for (let day = 1; day <= lastDate; day++) {
        const dayStr = `${year}-${pad2(month + 1)}-${pad2(day)}`;
        const btn = document.createElement("button");
        btn.textContent = String(day);
        btn.dataset.date = dayStr;

        const saved = Storage.getDay(dayStr);
        if ((saved.entries || []).length > 0) btn.classList.add("hasEntry");
        btn.classList.toggle("active", dayStr === State.currentDate);

        btn.onclick = async () => {
          State.currentDate = dayStr;
          await App.loadAndRender(State.currentDate);
        };

        cal.appendChild(btn);
      }
    }

    async function showWeek() {
      State.viewMode = "week";
      DOM.calendar?.classList.add("hidden");
      if (DOM.weekBar) DOM.weekBar.style.display = "grid";
      Header.updateToggleLabel();
      renderWeekBar(State.currentDate);
      await App.loadAndRender(State.currentDate);
    }

    async function showMonth() {
      State.viewMode = "month";
      DOM.calendar?.classList.remove("hidden");
      if (DOM.weekBar) DOM.weekBar.style.display = "none";
      Header.updateToggleLabel();
      renderMonthCalendar();
      await App.loadAndRender(State.currentDate);
    }

    function init() {
      on(DOM.toggleBtn, "click", () => {
        if (State.viewMode === "week") showMonth();
        else showWeek();
      });
    }

    return {
      init,
      showWeek,
      showMonth,
      renderWeekBar,
      renderMonthCalendar,
    };
  })();

  /* =======================
     Entries
  ======================= */
  const Entries = (() => {
    async function renderPhotoThumb(photo) {
      const rec = await PhotosDB.get(photo.id);
      if (!rec || !rec.blob) return "";
      return await blobToDataURL(rec.blob);
    }

    const SWIPE_OPEN_X = -84;
    const SWIPE_THRESHOLD = -42;
    const SWIPE_FULL_DELETE = -170;
    const SWIPE_OVERSHOOT = 26;

    const swipeLock = {
      active: false,
      moved: false,
      id: null,
      startX: 0,
      startY: 0,
      currentX: 0,
    };

    function closeAllSwipes() {
      document
        .querySelectorAll(".entrySwipe.open")
        .forEach((el) => el.classList.remove("open"));
      State.openSwipeId = null;
    }

    function closeOtherSwipes(keepId) {
      document
        .querySelectorAll(".entrySwipe.open")
        .forEach((el) => el.dataset.id !== keepId && el.classList.remove("open"));
      State.openSwipeId = keepId;
    }

    function attachSwipeHandlers(wrapEl, contentEl) {
      wrapEl.addEventListener(
        "pointerdown",
        (e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;

          swipeLock.active = true;
          swipeLock.moved = false;
          swipeLock.id = wrapEl.dataset.id;
          swipeLock.startX = e.clientX;
          swipeLock.startY = e.clientY;
          swipeLock.currentX = 0;

          closeOtherSwipes(wrapEl.dataset.id);

          contentEl.style.transition = "none";
          wrapEl.setPointerCapture?.(e.pointerId);
        },
        { passive: true }
      );

      wrapEl.addEventListener(
        "pointermove",
        (e) => {
          if (!swipeLock.active || swipeLock.id !== wrapEl.dataset.id) return;

          const dx = e.clientX - swipeLock.startX;
          const dy = e.clientY - swipeLock.startY;

          if (!swipeLock.moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) {
            swipeLock.active = false;
            contentEl.style.transition = "";
            return;
          }
          if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;

          swipeLock.moved = true;

          const base = wrapEl.classList.contains("open") ? SWIPE_OPEN_X : 0;
          let x = base + dx;
          x = Math.min(0, x);

          if (x < SWIPE_FULL_DELETE) {
            const over = x - SWIPE_FULL_DELETE;
            x = SWIPE_FULL_DELETE + over * 0.35;
            x = Math.max(SWIPE_FULL_DELETE - SWIPE_OVERSHOOT, x);
          }

          swipeLock.currentX = x;
          contentEl.style.transform = `translateX(${x}px)`;
        },
        { passive: true }
      );

      const finish = async () => {
        if (!swipeLock.active || swipeLock.id !== wrapEl.dataset.id) return;

        contentEl.style.transition = "";
        const x = swipeLock.currentX;

        if (!swipeLock.moved) {
          if (wrapEl.classList.contains("open")) {
            wrapEl.classList.remove("open");
            State.openSwipeId = null;
          }
          swipeLock.active = false;
          contentEl.style.transform = "";
          return;
        }

        if (x <= SWIPE_FULL_DELETE) {
          const kick = SWIPE_FULL_DELETE - 22;
          contentEl.style.transform = `translateX(${kick}px)`;
          setTimeout(() => {
            contentEl.style.transform = `translateX(${SWIPE_FULL_DELETE}px)`;
            deleteEntryById(wrapEl.dataset.id, wrapEl);
          }, 60);
          swipeLock.active = false;
          return;
        }

        if (x <= SWIPE_THRESHOLD) {
          wrapEl.classList.add("open");
          State.openSwipeId = wrapEl.dataset.id;
        } else {
          wrapEl.classList.remove("open");
          State.openSwipeId = null;
        }
        contentEl.style.transform = "";
        swipeLock.active = false;
      };

      wrapEl.addEventListener("pointerup", finish, { passive: true });
      wrapEl.addEventListener("pointercancel", finish, { passive: true });
    }

    async function deleteEntryById(entryId, wrapEl) {
      const dayData = Storage.getDay(State.currentDate);
      const idx = dayData.entries.findIndex((e) => e.id === entryId);
      if (idx < 0) return;

      const prevPhotos = Array.isArray(dayData.entries[idx]?.photos)
        ? dayData.entries[idx].photos.slice()
        : [];

      if (wrapEl) wrapEl.classList.add("removing");

      setTimeout(async () => {
        dayData.entries.splice(idx, 1);
        Storage.sortEntries(dayData);

        const ok = Storage.saveDay(State.currentDate, dayData);
        if (!ok) {
          if (wrapEl) wrapEl.classList.remove("removing");
          return;
        }

        for (const p of prevPhotos) {
          try {
            await PhotosDB.del(p.id);
          } catch (e) {
            console.warn(e);
          }
        }

        Toast.show("削除しました");
        await App.loadAndRender(State.currentDate);
      }, 120);
    }

    document.addEventListener(
      "pointerdown",
      (e) => {
        if (State.openSwipeId && !e.target.closest(".entrySwipe")) closeAllSwipes();
      },
      { passive: true }
    );

    async function renderDay(dateStr) {
      await migrateLegacyPhotosForDay(dateStr);

      Header.renderNavDate(dateStr);

      const entriesDiv = DOM.entries;
      if (!entriesDiv) return;
      entriesDiv.innerHTML = "";

      const saved = Storage.getDay(dateStr);
      Storage.sortEntries(saved);

      if (saved.entries && saved.entries.length) {
        for (const entry of saved.entries) {
          const wrap = document.createElement("div");
          wrap.className = "entrySwipe";
          wrap.dataset.id = entry.id || "";

          const actions = document.createElement("div");
          actions.className = "entryActions";

          const delBtn = document.createElement("button");
          delBtn.className = "entryDeleteBtn";
          delBtn.type = "button";
          delBtn.innerHTML = `<span class="icon">🗑️</span><span class="label">削除</span>`;
          delBtn.onclick = (ev) => {
            ev.stopPropagation();
            deleteEntryById(entry.id, wrap);
          };
          actions.appendChild(delBtn);

          const content = document.createElement("div");
          content.className = "entryContent";

          const time = document.createElement("span");
          time.className = "time";
          time.textContent = entry.time && entry.time.trim() ? entry.time : "•";

          const main = document.createElement("div");
          main.className = "entryMain";

          const text = document.createElement("div");
          text.className = "text";
          text.textContent = entry.text || "";
          main.appendChild(text);

          if (entry.photos && entry.photos.length) {
            const photoGrid = document.createElement("div");
            photoGrid.className = "entryPhotoGrid";

            for (const p of entry.photos) {
              const img = document.createElement("img");
              img.className = "entryPhoto";
              img.alt = "photo";
              img.loading = "lazy";
              photoGrid.appendChild(img);
              renderPhotoThumb(p).then((src) => {
                if (src) img.src = src;
              });
            }

            main.appendChild(photoGrid);
          }

          if (entry.attachments && entry.attachments.length) {
            for (const a of entry.attachments) {
              const fileLine = document.createElement("div");
              fileLine.className = "fileLine";
              fileLine.textContent = `📎 ${a.name}`;
              main.appendChild(fileLine);
            }
          }

          content.appendChild(time);
          content.appendChild(main);

          attachSwipeHandlers(wrap, content);

          content.addEventListener("click", async () => {
            if (wrap.classList.contains("open")) {
              wrap.classList.remove("open");
              State.openSwipeId = null;
              return;
            }
            if (swipeLock.moved) return;
            await Input.beginEditById(entry.id);
          });

          wrap.appendChild(actions);
          wrap.appendChild(content);
          entriesDiv.appendChild(wrap);
        }
      } else {
        entriesDiv.innerHTML = `<div class="emptyState">この日はまだ記録がありません</div>`;
      }
    }

    return { renderDay };
  })();

  /* =======================
     Input
  ======================= */
  const Input = (() => {
    const expand = () => DOM.inputBar?.classList.add("expanded");
    const collapse = () => DOM.inputBar?.classList.remove("expanded");

    function setPreviewVisible(onOff) {
      DOM.previewArea?.classList.toggle("hasContent", !!onOff);
    }

    function clearPreview() {
      if (DOM.previewArea) DOM.previewArea.innerHTML = "";
      setPreviewVisible(false);
    }

    function resetPending() {
      State.pendingPhotos = [];
      State.pendingFileName = "";
    }

    function refreshTimeHint() {
      if (!DOM.timeHint) return;
      if (State.timeMode === "set" && State.selectedTime) {
        DOM.timeHint.textContent = State.selectedTime;
        DOM.timeHint.className = "isSet";
        return;
      }
      DOM.timeHint.textContent = nowHHMM();
      DOM.timeHint.className = "isAuto";
    }

    function commitTimeFromPicker() {
      if (!DOM.logTime) return;
      const raw = DOM.logTime.value || "";
      const rounded = raw ? roundTimeToStep(raw, TimeStep.stepMin) : "";
      DOM.logTime.value = rounded;
      State.selectedTime = rounded;
      State.timeMode = State.selectedTime ? "set" : "auto";
      State.tempTime = "";
      refreshTimeHint();
      expand();
      Layout.scheduleUpdate();
    }

    function startTimeTicker() {
      if (State.timeTicker) return;

      State.timeTicker = setInterval(async () => {
        if (State.timeMode === "auto") refreshTimeHint();

        const nowKey = formatYMD(new Date());
        if (nowKey !== State.todayKey) {
          const prevKey = State.todayKey;
          State.todayKey = nowKey;

          if (State.currentDate === prevKey) {
            State.currentDate = nowKey;
            await App.loadAndRender(State.currentDate);
            Toast.show("日付が変わりました");
          }
        }
      }, 1000);
    }

    const fileToDataURL = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

    async function imageFileToCompressedBlob(file, maxSide = 1600, quality = 0.82) {
      const dataUrl = await fileToDataURL(file);

      let orientation = 1;
      const isJpeg =
        file.type === "image/jpeg" || /\.(jpe?g)$/i.test(file.name || "");

      if (isJpeg) {
        try {
          const buf = await file.arrayBuffer();
          orientation = exifOrientationFromJpegArrayBuffer(buf);
        } catch (_) {
          orientation = 1;
        }
      }

      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });

      const srcW = img.naturalWidth || img.width || 0;
      const srcH = img.naturalHeight || img.height || 0;
      if (!srcW || !srcH) throw new Error("image size read failed");

      const needsSwap = [5, 6, 7, 8].includes(orientation);
      const baseW = needsSwap ? srcH : srcW;
      const baseH = needsSwap ? srcW : srcH;

      const scale = Math.min(1, maxSide / Math.max(baseW, baseH));
      const drawW = Math.max(1, Math.round(srcW * scale));
      const drawH = Math.max(1, Math.round(srcH * scale));

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas context failed");

      if (needsSwap) {
        canvas.width = drawH;
        canvas.height = drawW;
      } else {
        canvas.width = drawW;
        canvas.height = drawH;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      switch (orientation) {
        case 2:
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          break;
        case 3:
          ctx.translate(canvas.width, canvas.height);
          ctx.rotate(Math.PI);
          break;
        case 4:
          ctx.translate(0, canvas.height);
          ctx.scale(1, -1);
          break;
        case 5:
          ctx.rotate(0.5 * Math.PI);
          ctx.scale(1, -1);
          break;
        case 6:
          ctx.rotate(0.5 * Math.PI);
          ctx.translate(0, -drawH);
          break;
        case 7:
          ctx.rotate(0.5 * Math.PI);
          ctx.translate(drawW, -drawH);
          ctx.scale(-1, 1);
          break;
        case 8:
          ctx.rotate(-0.5 * Math.PI);
          ctx.translate(-drawW, 0);
          break;
        default:
          break;
      }

      ctx.drawImage(img, 0, 0, drawW, drawH);

      const blob = await new Promise((resolve) => {
        try {
          canvas.toBlob((b) => resolve(b || null), "image/jpeg", quality);
        } catch (_) {
          resolve(null);
        }
      });

      return blob;
    }

    async function handleAttachment(fileList) {
      const files = fileList ? Array.from(fileList) : [];
      if (!files.length) return;

      clearPreview();
      resetPending();

      const images = files.filter((f) => (f.type || "").startsWith("image/"));
      const nonImages = files.filter((f) => !(f.type || "").startsWith("image/"));

      if (images.length) {
        const safeImages = IS_SAFARI ? images.slice(0, 1) : images;
        if (IS_SAFARI && images.length > 1) {
          Toast.show("Safariでは写真は1回1枚が安定");
        }

        const grid = document.createElement("div");
        grid.className = "thumbGrid";

        for (const file of safeImages) {
          try {
            const name = file.name || "";
            const shotDate = await getShotDate(file);
            const shotAt = shotDate ? shotDate.getTime() : Date.now();
            const shotTime = shotDate ? hhmmFromDate(shotDate) : "";

            const maxSide = IS_SAFARI ? 1280 : 1600;
            const quality = IS_SAFARI ? 0.72 : 0.82;

            let blob = null;
            try {
              blob = await imageFileToCompressedBlob(file, maxSide, quality);
            } catch (_) {
              blob = null;
            }

            if (!blob) {
              try {
                blob = await imageFileToCompressedBlob(file, 960, 0.68);
              } catch (_) {
                blob = file;
              }
            }

            const pid = "p_" + uid();

            await PhotosDB.put({
              id: pid,
              blob,
              mime: blob.type || file.type || "image/*",
              name,
              createdAt: shotAt,
            });

            const verify = await PhotosDB.get(pid);
            if (!verify || !verify.blob) {
              throw new Error("IndexedDB write/read verification failed");
            }

            const dataUrl = await blobToDataURL(verify.blob);

            State.pendingPhotos.push({
              id: pid,
              name,
              shotAt,
              shotTime,
              mime: verify.mime || blob.type || "image/jpeg",
            });

            const img = document.createElement("img");
            img.src = dataUrl;
            img.alt = "attachment";
            grid.appendChild(img);
          } catch (e) {
            console.error("photo attach failed:", e);
            const msg = String(e && e.message ? e.message : e);
            if (/IndexedDB|database|quota/i.test(msg)) {
              Toast.show("写真保存失敗：Safariの保存制限の可能性");
            } else {
              Toast.show("写真の保存に失敗");
            }
            break;
          }
        }

        if (State.pendingPhotos.length) {
          DOM.previewArea?.appendChild(grid);
          const meta = document.createElement("div");
          meta.className = "thumbMeta";
          meta.textContent = `${State.pendingPhotos.length}枚の写真を選択`;
          DOM.previewArea?.appendChild(meta);

          setPreviewVisible(true);
          expand();
          Layout.scheduleUpdate();
          DOM.logInput?.focus?.();
        } else {
          clearPreview();
          resetPending();
        }
        return;
      }

      if (nonImages.length) {
        State.pendingFileName = nonImages[0].name || "";
        if (DOM.previewArea) {
          DOM.previewArea.innerHTML = `<div class="filePreview">📎 ${escapeHtml(
            State.pendingFileName
          )}</div>`;
        }
        setPreviewVisible(true);
        expand();
        Layout.scheduleUpdate();
        DOM.logInput?.focus?.();
      }
    }

    async function beginEditEntry(entry) {
      State.editingId = entry.id;

      expand();
      Layout.scheduleUpdate();

      if (DOM.logInput) DOM.logInput.value = entry.text || "";

      if (!entry.time) {
        State.timeMode = "auto";
        State.selectedTime = "";
        if (DOM.logTime) DOM.logTime.value = "";
      } else {
        State.timeMode = "set";
        State.selectedTime = entry.time;
        if (DOM.logTime) DOM.logTime.value = entry.time;
      }
      refreshTimeHint();

      resetPending();
      clearPreview();

      State.editingPrevPhotoIds = Array.isArray(entry.photos)
        ? entry.photos.map((p) => p.id)
        : [];

      if (entry.photos && entry.photos.length) {
        const grid = document.createElement("div");
        grid.className = "thumbGrid";

        for (const p of entry.photos) {
          try {
            const rec = await PhotosDB.get(p.id);
            if (!rec || !rec.blob) continue;
            const dataUrl = await blobToDataURL(rec.blob);

            State.pendingPhotos.push({
              id: p.id,
              name: p.name || rec.name || "",
              shotAt: p.shotAt || rec.createdAt || Date.now(),
              shotTime: p.shotTime || entry.time || "",
              mime: p.mime || rec.mime || "image/jpeg",
            });

            const img = document.createElement("img");
            img.src = dataUrl;
            img.alt = "attachment";
            grid.appendChild(img);
          } catch (e) {
            console.warn(e);
          }
        }

        if (State.pendingPhotos.length) {
          DOM.previewArea?.appendChild(grid);
          const meta = document.createElement("div");
          meta.className = "thumbMeta";
          meta.textContent = `編集中：写真 ${State.pendingPhotos.length}枚`;
          DOM.previewArea?.appendChild(meta);
          setPreviewVisible(true);
        }
      } else if (entry.attachments && entry.attachments.length) {
        State.pendingFileName = entry.attachments[0]?.name || "";
        if (DOM.previewArea) {
          DOM.previewArea.innerHTML = `<div class="filePreview">📎 ${escapeHtml(
            State.pendingFileName
          )}</div>`;
        }
        setPreviewVisible(true);
      }

      setTimeout(() => DOM.logInput?.focus?.(), 0);
      Toast.show("編集モード");
    }

    async function beginEditById(entryId) {
      const dayData = Storage.getDay(State.currentDate);
      const entry = (dayData.entries || []).find((e) => e.id === entryId);
      if (!entry) {
        Toast.show("編集対象が見つからない…");
        return;
      }
      await beginEditEntry(entry);
    }

    async function save() {
      if (State.isSaving) return;
      State.isSaving = true;

      try {
        await migrateLegacyPhotosForDay(State.currentDate);

        const text = (DOM.logInput?.value || "").trim();
        const hasPhoto = State.pendingPhotos.length > 0;
        const hasFileName = !!State.pendingFileName && !hasPhoto;

        let time = "";
        if (State.timeMode === "set") {
          time =
            roundTimeToStep(State.selectedTime, TimeStep.stepMin) ||
            State.selectedTime ||
            "";
          State.selectedTime = time;
          if (DOM.logTime) DOM.logTime.value = time;
          if (!time) State.timeMode = "auto";
        }

        if (State.timeMode === "auto") {
          if (hasPhoto) {
            const sortedShots = State.pendingPhotos
              .map((p) => p.shotTime)
              .filter(Boolean)
              .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
            time = sortedShots[0] || nowHHMM();
          } else {
            time = nowHHMM();
          }
        }

        if (!text && !hasPhoto && !hasFileName) {
          collapse();
          Layout.scheduleUpdate();
          DOM.logInput?.blur?.();
          return;
        }

        const dayData = Storage.getDay(State.currentDate);

        const baseText =
          text ||
          (hasPhoto ? "📷 写真" : hasFileName ? `📎 ${State.pendingFileName}` : "");

        const newEntry = {
          id: State.editingId || uid(),
          createdAt: hasPhoto
            ? Math.min(...State.pendingPhotos.map((p) => p.shotAt || Date.now()))
            : Date.now(),
          updatedAt: Date.now(),
          time,
          text: baseText,
          type: hasPhoto ? "photo" : hasFileName ? "file" : "text",
          photos: hasPhoto
            ? State.pendingPhotos.map((p) => ({
                id: p.id,
                name: p.name || "",
                shotAt: p.shotAt || Date.now(),
                shotTime: p.shotTime || "",
                mime: p.mime || "image/jpeg",
              }))
            : [],
          attachments: hasFileName
            ? [
                {
                  id: "",
                  name: State.pendingFileName,
                  mime: "",
                  kind: "file",
                },
              ]
            : [],
          note: "",
        };

        if (State.editingId) {
          const idx = (dayData.entries || []).findIndex((e) => e.id === State.editingId);
          if (idx >= 0) {
            const prev = dayData.entries[idx];
            newEntry.createdAt = prev.createdAt || newEntry.createdAt;
            dayData.entries[idx] = { ...prev, ...newEntry };
            Toast.show("更新しました");
          } else {
            dayData.entries.push(newEntry);
            Toast.show("追加しました");
          }

          const nextPhotoIds = new Set((newEntry.photos || []).map((p) => p.id));
          for (const oldId of State.editingPrevPhotoIds || []) {
            if (!nextPhotoIds.has(oldId)) {
              try {
                await PhotosDB.del(oldId);
              } catch (e) {
                console.warn(e);
              }
            }
          }
        } else {
          dayData.entries.push(newEntry);
          Toast.show("保存しました");
        }

        Storage.sortEntries(dayData);

        const ok = Storage.saveDay(State.currentDate, dayData);
        if (!ok) return;

        await App.loadAndRender(State.currentDate);

        State.editingId = null;
        State.editingPrevPhotoIds = [];

        if (DOM.logInput) DOM.logInput.value = "";
        clearPreview();
        resetPending();

        State.timeMode = "auto";
        State.selectedTime = "";
        if (DOM.logTime) DOM.logTime.value = "";
        refreshTimeHint();

        collapse();
        Layout.scheduleUpdate();
        DOM.logInput?.blur?.();
      } finally {
        setTimeout(() => {
          State.isSaving = false;
        }, 160);
      }
    }

    let lastFocusEl = null;

    function openPlusSheet() {
      lastFocusEl = document.activeElement;
      DOM.plusSheet?.classList.add("open");
      DOM.plusSheet?.removeAttribute("inert");
      requestAnimationFrame(() => DOM.actPhoto?.focus({ preventScroll: true }));
    }

    function closePlusSheet() {
      const ae = document.activeElement;
      if (
        ae &&
        DOM.plusSheet &&
        DOM.plusSheet.contains(ae) &&
        typeof ae.blur === "function"
      ) {
        ae.blur();
      }
      DOM.plusSheet?.setAttribute("inert", "");
      DOM.plusSheet?.classList.remove("open");
      const back = lastFocusEl || DOM.plusBtn;
      requestAnimationFrame(() => back?.focus?.({ preventScroll: true }));
    }

    function bind() {
      on(DOM.logInput, "focus", () => {
        expand();
        Layout.scheduleUpdate();
      });

      on(DOM.logInput, "beforeinput", () => {
        if (DOM.inputBar && !DOM.inputBar.classList.contains("expanded")) {
          expand();
          Layout.scheduleUpdate();
        }
      });

      on(DOM.logInput, "blur", () =>
        setTimeout(() => {
          collapse();
          Layout.scheduleUpdate();
        }, 80)
      );

      document.addEventListener(
        "pointerdown",
        (e) => {
          if (document.activeElement !== DOM.logInput) return;
          if (DOM.inputBar && DOM.inputBar.contains(e.target)) return;
          DOM.logInput?.blur?.();
          State.editingId = null;
        },
        { passive: true }
      );

      on(
        DOM.logTime,
        "pointerdown",
        () => {
          if (DOM.logTime && !DOM.logTime.value) DOM.logTime.value = nowHHMM();
        },
        { passive: true }
      );

      on(
        DOM.logTime,
        "input",
        () => {
          State.tempTime = DOM.logTime?.value || "";
          if (!DOM.timeHint) return;
          if (State.tempTime) {
            DOM.timeHint.textContent = State.tempTime;
            DOM.timeHint.className = "isSet";
          } else {
            refreshTimeHint();
          }
        },
        { passive: true }
      );

      on(DOM.logTime, "blur", commitTimeFromPicker, { passive: true });
      on(DOM.logTime, "change", commitTimeFromPicker, { passive: true });

      on(DOM.saveBtn, "click", save);

      on(DOM.plusBtn, "click", openPlusSheet);
      on(DOM.plusSheetBackdrop, "click", closePlusSheet);
      on(DOM.actCancel, "click", closePlusSheet);

      on(DOM.actPhoto, "click", () => {
        closePlusSheet();
        setTimeout(() => DOM.pickPhotoInput?.click(), 30);
      });

      on(DOM.actCamera, "click", () => {
        closePlusSheet();
        setTimeout(() => DOM.takePhotoInput?.click(), 30);
      });

      on(DOM.actFile, "click", () => {
        closePlusSheet();
        setTimeout(() => DOM.fileInput?.click(), 30);
      });

      [DOM.fileInput, DOM.pickPhotoInput, DOM.takePhotoInput].forEach((inp) => {
        if (!inp) return;
        inp.addEventListener("change", (e) => {
          handleAttachment(e.target.files);
          e.target.value = "";
        });
      });
    }

    return { bind, refreshTimeHint, startTimeTicker, beginEditById };
  })();

  /* =======================
     Noteshelf Export
  ======================= */
  const NoteshelfExport = (() => {
    async function buildDayPayload(dateKey) {
      const day = Storage.getDay(dateKey);
      Storage.sortEntries(day);

      const blocks = [];

      for (const entry of day.entries || []) {
        const photos = [];

        for (const p of entry.photos || []) {
          try {
            const rec = await PhotosDB.get(p.id);
            if (!rec || !rec.blob) continue;
            const dataUrl = await blobToDataURL(rec.blob);

            photos.push({
              id: p.id,
              name: p.name || rec.name || "",
              dataUrl,
              shotAt: p.shotAt || rec.createdAt || Date.now(),
              shotTime: p.shotTime || entry.time || "",
            });
          } catch (e) {
            console.warn("noteshelf export photo read failed:", e);
          }
        }

        photos.sort((a, b) => (a.shotAt || 0) - (b.shotAt || 0));

        blocks.push({
          kind: "entry",
          id: entry.id,
          time: entry.time || "",
          text: entry.text || "",
          photos,
          attachments: entry.attachments || [],
        });
      }

      return {
        date: dateKey,
        summary: day.summary || "",
        summarySpaceLines: day?.noteshelf?.summarySpaceLines || 12,
        blocks,
      };
    }

    function buildDayHtmlString(payload) {
      const titleDate = parseYMD(payload.date).toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "short",
      });

      const entryHtml = payload.blocks
        .map((b) => {
          const hasPhotos = Array.isArray(b.photos) && b.photos.length > 0;

          const photosHtml = (b.photos || [])
            .map(
              (p) => `
                <div class="photoWrap">
                  <img src="${p.dataUrl}" alt="${escapeHtml(p.name || "photo")}">
                </div>
              `
            )
            .join("");

          const filesHtml = (b.attachments || [])
            .map((a) => `<div class="fileLine">📎 ${escapeHtml(a.name)}</div>`)
            .join("");

          return `
            <section class="entry ${hasPhotos ? "hasPhoto" : ""}">
              <div class="time">${escapeHtml(b.time || "•")}</div>
              <div class="body">
                <div class="text">${escapeHtml(b.text || "").replace(/\n/g, "<br>")}</div>
                ${
                  hasPhotos
                    ? `
                      <div class="photoRow">
                        <div class="memoCol">
                          <div class="memoBox"></div>
                        </div>
                        <div class="photoCol">
                          ${photosHtml}
                        </div>
                      </div>
                    `
                    : ""
                }
                ${filesHtml}
              </div>
            </section>
          `;
        })
        .join("");

      const summaryLines = new Array(payload.summarySpaceLines)
        .fill('<div class="summaryLine"></div>')
        .join("");

      return `
        <div id="noteshelfPdfPage" class="pdfPage">
          <div class="page">
            <header class="header">
              <h1 class="title">LOGDAY</h1>
              <div class="sub">${escapeHtml(titleDate)}</div>
            </header>

            ${entryHtml || '<div class="sub">この日はまだ記録がありません</div>'}

            <section class="summary">
              <div class="summaryTitle">総括 / メモ</div>
              <div class="summaryText">${escapeHtml(payload.summary || "").replace(/\n/g, "<br>")}</div>
              <div class="summaryLines">${summaryLines}</div>
            </section>
          </div>
        </div>
      `;
    }

    function ensureExportRoot() {
      let root = document.getElementById("pdfExportRoot");
      if (!root) {
        root = document.createElement("div");
        root.id = "pdfExportRoot";
        root.style.position = "fixed";
        root.style.left = "-100000px";
        root.style.top = "0";
        root.style.width = "1240px";
        root.style.zIndex = "-1";
        document.body.appendChild(root);
      }
      return root;
    }

    function injectExportStyle() {
      if (document.getElementById("noteshelfPdfStyle")) return;

      const style = document.createElement("style");
      style.id = "noteshelfPdfStyle";
      style.textContent = `
        .pdfPage {
          width: 1240px;
          background: #000;
          color: #fff;
          font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
          padding: 36px 28px 44px;
          box-sizing: border-box;
        }

        .pdfPage * {
          box-sizing: border-box;
        }

        .pdfPage .page {
          width: 100%;
          min-height: 1754px;
        }

        .pdfPage .header {
          border-bottom: 1px solid rgba(255,255,255,0.18);
          padding-bottom: 18px;
          margin-bottom: 24px;
        }

        .pdfPage .title {
          font-size: 42px;
          font-weight: 800;
          margin: 0 0 10px;
          letter-spacing: 0.03em;
        }

        .pdfPage .sub {
          font-size: 20px;
          color: rgba(255,255,255,0.76);
        }

        .pdfPage .entry {
          display: grid;
          grid-template-columns: 88px 1fr;
          gap: 18px;
          padding: 18px 0 22px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }

        .pdfPage .time {
          font-size: 22px;
          font-weight: 700;
          color: rgba(255,255,255,0.88);
          padding-top: 4px;
          white-space: nowrap;
        }

        .pdfPage .body {
          min-width: 0;
        }

        .pdfPage .text {
          font-size: 30px;
          font-weight: 500;
          line-height: 1.7;
          word-break: break-word;
          margin-bottom: 18px;
        }

        .pdfPage .photoRow {
          display: grid;
          grid-template-columns: 1.45fr 1fr;
          gap: 22px;
          align-items: stretch;
          margin-top: 10px;
        }

        .pdfPage .memoCol {
          min-height: 520px;
        }

        .pdfPage .memoBox {
          width: 100%;
          min-height: 520px;
          border-radius: 12px;
          background:
            repeating-linear-gradient(
              to bottom,
              transparent 0,
              transparent 46px,
              rgba(255,255,255,0.12) 47px,
              transparent 48px
            );
        }

        .pdfPage .photoCol {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 16px;
        }

        .pdfPage .photoWrap {
          width: 100%;
          max-width: 360px;
          border-radius: 16px;
          overflow: hidden;
          background: #111;
          border: 1px solid rgba(255,255,255,0.08);
        }

        .pdfPage .photoWrap img {
          display: block;
          width: 100%;
          height: auto;
        }

        .pdfPage .fileLine {
          font-size: 20px;
          color: rgba(255,255,255,0.78);
          margin-top: 8px;
        }

        .pdfPage .summary {
          margin-top: 36px;
          padding-top: 10px;
        }

        .pdfPage .summaryTitle {
          font-size: 30px;
          font-weight: 800;
          margin-bottom: 16px;
        }

        .pdfPage .summaryText {
          min-height: 48px;
          margin-bottom: 14px;
          font-size: 24px;
          color: rgba(255,255,255,0.96);
          line-height: 1.7;
        }

        .pdfPage .summaryLines {
          min-height: 760px;
        }

        .pdfPage .summaryLine {
          height: 40px;
          border-bottom: 1px solid rgba(255,255,255,0.14);
        }
      `;
      document.head.appendChild(style);
    }

    async function exportDayPdf(dateKey) {
      if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) {
        Toast.show("PDFライブラリが読み込めていない");
        return;
      }

      injectExportStyle();

      const payload = await buildDayPayload(dateKey);
      const root = ensureExportRoot();
      root.innerHTML = buildDayHtmlString(payload);

      const pageEl = root.querySelector("#noteshelfPdfPage");
      if (!pageEl) throw new Error("PDFレイアウト生成失敗");

      await new Promise((resolve) => setTimeout(resolve, 120));

      const canvas = await window.html2canvas(pageEl, {
        backgroundColor: "#000000",
        scale: IS_SAFARI ? 1.2 : 1.5,
        useCORS: true,
        logging: false,
      });

      const imgData = canvas.toDataURL("image/jpeg", IS_SAFARI ? 0.88 : 0.92);

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({
        orientation: "p",
        unit: "mm",
        format: "a4",
        compress: true,
      });

      const pageWidth = 210;
      const pageHeight = 297;
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      if (imgHeight <= pageHeight) {
        pdf.addImage(imgData, "JPEG", 0, 0, imgWidth, imgHeight, undefined, "FAST");
      } else {
        let y = 0;
        let pageIndex = 0;

        const pageCanvas = document.createElement("canvas");
        const pageCtx = pageCanvas.getContext("2d");
        const sliceHeightPx = Math.floor((canvas.width * pageHeight) / pageWidth);

        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHeightPx;

        while (y < canvas.height) {
          pageCtx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
          pageCtx.fillStyle = "#000";
          pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

          pageCtx.drawImage(
            canvas,
            0,
            y,
            canvas.width,
            sliceHeightPx,
            0,
            0,
            pageCanvas.width,
            sliceHeightPx
          );

          const pageImg = pageCanvas.toDataURL("image/jpeg", IS_SAFARI ? 0.88 : 0.92);

          if (pageIndex > 0) pdf.addPage();
          pdf.addImage(pageImg, "JPEG", 0, 0, pageWidth, pageHeight, undefined, "FAST");

          y += sliceHeightPx;
          pageIndex++;
        }
      }

      pdf.save(`logday-noteshelf-${dateKey}.pdf`);
      root.innerHTML = "";
    }

    return {
      exportDayPdf,
    };
  })();

  /* =======================
     Settings
  ======================= */
  const Settings = (() => {
    let lastFocusEl = null;

    function open() {
      lastFocusEl = document.activeElement;
      DOM.settingsModal?.classList.add("open");
      DOM.settingsModal?.removeAttribute("inert");
      requestAnimationFrame(() => DOM.closeSettings?.focus?.({ preventScroll: true }));
    }

    function close() {
      const ae = document.activeElement;
      if (
        ae &&
        DOM.settingsModal &&
        DOM.settingsModal.contains(ae) &&
        typeof ae.blur === "function"
      ) {
        ae.blur();
      }
      DOM.settingsModal?.setAttribute("inert", "");
      DOM.settingsModal?.classList.remove("open");
      const back = lastFocusEl || DOM.settingsBtn;
      requestAnimationFrame(() => back?.focus?.({ preventScroll: true }));
    }

    function bindModal() {
      on(DOM.settingsBtn, "click", open);
      on(DOM.closeSettings, "click", close);
      on(DOM.settingsBackdrop, "click", close);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && DOM.settingsModal?.classList.contains("open")) close();
      });
    }

    function bindExport() {
      on(DOM.exportLogday, "click", () => {
        const out = Storage.exportAll();
        const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `logday-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
    }

    function bindNoteshelfPdfExport() {
      on(DOM.exportNoteshelfPdf, "click", async () => {
        try {
          Toast.show("PDFを作成中...");
          await NoteshelfExport.exportDayPdf(State.currentDate);
          Toast.show("PDFを書き出しました");
        } catch (e) {
          console.error(e);
          Toast.show("PDF書き出しに失敗");
        }
      });
    }

    async function cleanupAllLegacyPhotos() {
      const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
      const keys = Object.keys(localStorage).filter((k) => dateKeyRe.test(k));

      let moved = 0;
      let changedDays = 0;

      for (const k of keys) {
        const r = await migrateLegacyPhotosForDay(k);
        if (r.changed) changedDays++;
        moved += r.moved || 0;
      }
      Toast.show(`容量回復: ${changedDays}日 / 移行${moved}枚`);
    }

    function bindCleanup() {
      on(DOM.cleanupStorage, "click", async () => {
        if (
          !confirm(
            "容量を回復するよ。\n古い写真(dataURL)をIndexedDBへ移行して保存エラーを減らす。\n\n実行する？"
          )
        ) {
          return;
        }
        await cleanupAllLegacyPhotos();
      });
    }

    function bindImport() {
      const input = DOM.importFile;
      if (!input) return;

      const handler = async () => {
        const file = input.files && input.files[0];
        if (!file) return;

        try {
          const text = await file.text();
          const data = JSON.parse(text);

          const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
          const dateKeys = Object.keys(data || {}).filter((k) => dateKeyRe.test(k));

          if (dateKeys.length === 0) {
            Toast.show("バックアップ形式が違うかも");
            return;
          }

          if (
            !confirm(
              `データを復元するよ（${dateKeys.length}日分）\n同じ日付は上書き。\n実行する？`
            )
          ) {
            return;
          }

          for (const k of dateKeys) {
            const normalized = Storage.normalizeDay(k, data[k]);
            localStorage.setItem(k, JSON.stringify(normalized));
          }

          alert(`復元完了！（${dateKeys.length}日分）`);
          input.value = "";
          location.reload();
        } catch (err) {
          console.error(err);
          alert("読み込みに失敗した…");
        }
      };

      input.addEventListener("change", handler);
      input.addEventListener("input", handler);
    }

    function init() {
      bindModal();
      bindExport();
      bindNoteshelfPdfExport();
      bindCleanup();
      bindImport();
    }

    return { init };
  })();

  /* =======================
     App
  ======================= */
  const App = (() => {
    async function loadAndRender(dateKey) {
      Header.renderNavDate(dateKey);
      if (State.viewMode === "week") Calendar.renderWeekBar(dateKey);
      else Calendar.renderMonthCalendar();
      await Entries.renderDay(dateKey);
      Layout.scheduleUpdate();
    }

    async function init() {
      PhotosDB.open().catch(() => {});
      const ok = await PhotosDB.ping();
      if (ok === false) {
        Toast.show("写真DBが使えない状態");
      }

      Header.initShadow();
      Calendar.init();

      TimeStep.init();
      Input.bind();
      Input.refreshTimeHint();
      Input.startTimeTicker();

      Settings.init();

      await Calendar.showWeek();
      await loadAndRender(State.currentDate);

      Layout.init();
    }

    return { init, loadAndRender };
  })();

  /* =======================
     Boot
  ======================= */
  App.init();
})();
