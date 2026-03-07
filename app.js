(() => {
  "use strict";

  /* =========================================================
    LOGDAY app.js (15日目 / 安定版)
    - iOS(WebKit)で写真が貼れない問題を最優先で対策
    - 写真は IndexedDB に Blob 保存（localStorage容量回避）
    - iOS不安定な ObjectURL 表示は避け、FileReader(dataURL)で表示
    - Canvas圧縮は「試すが必須にしない」(失敗時は元Blob保存へフォールバック)
  ========================================================= */

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
      timer = setTimeout(() => el.classList.remove("show"), 1300);
    }
    return { show };
  })();

  /* =======================
     Storage (localStorage)
  ======================= */
  const Storage = (() => {
    function saveDay(dateKey, dayData) {
      try {
        localStorage.setItem(dateKey, JSON.stringify(dayData));
        return true;
      } catch (err) {
        console.error("saveDay failed:", err);
        if (err && String(err.name) === "QuotaExceededError") {
          Toast.show("保存できなかった：容量オーバー（古い写真が残ってるかも）");
        } else {
          Toast.show("保存できなかった…");
        }
        return false;
      }
    }

    function getDay(dateKey) {
      const dayData = JSON.parse(localStorage.getItem(dateKey) || "{}");
      dayData.entries = dayData.entries || [];
      for (const e of dayData.entries) {
        if (!e.id) e.id = uid();
        if (e.createdAt == null) e.createdAt = Date.now();
      }
      return dayData;
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
          out[k] = JSON.parse(localStorage.getItem(k));
        }
      }
      return out;
    }

    return { saveDay, getDay, sortEntries, exportAll };
  })();

  /* =======================
     EXIF (JPEG) minimal
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

            const y = +m[1],
              mo = +m[2] - 1,
              da = +m[3],
              hh = +m[4],
              mm = +m[5],
              ss = +m[6];
            return new Date(y, mo, da, hh, mm, ss);
          }
        }
        return null;
      }
      offset += 2 + size;
    }
    return null;
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
     PhotosDB (IndexedDB)
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

    // IDBが死んでる/使えない環境を早期検知
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
     Legacy migrate (localStorage dataURL -> IDB)
  ======================= */
  async function migrateLegacyPhotosForDay(dateKey) {
    const dayData = Storage.getDay(dateKey);
    let changed = false;
    let moved = 0;

    for (const e of dayData.entries || []) {
      const isLegacy =
        e && typeof e.photo === "string" && e.photo.startsWith("data:image/");
      const needsMove = isLegacy && !e.photoId;
      if (!needsMove) continue;

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
        e.photoId = pid;
        delete e.photo;
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

    // time
    timeMode: "auto", // auto | set
    selectedTime: "",
    tempTime: "",
    timeTicker: null,

    // edit/save
    editingId: null,
    editingPrevPhotoId: null,
    isSaving: false,

    // attachments
    pendingPhotos: [], // [{ id, name, shotAt, shotTime }]
    pendingFileName: "",

    // swipe
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
    cleanupStorage: $("cleanupStorage"),
    timeStepBtn: $("timeStepBtn"),
    importFile: $("importFile"),
  };

  /* =======================
     Layout (body padding-bottom)
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
     TimeStep (1 or 10)
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
    return { init, get stepMin() { return stepMin; } };
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
      const day = d.getDay(); // 0=日
      const diff = day === 0 ? -6 : 1 - day; // 月曜始まり
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

  const Entries = (() => {
  // iOS安定：FileReader表示に統一（ObjectURL回避）
  async function renderEntryPhoto(imgEl, photoId) {
    if (!imgEl || !photoId) return;

    try {
      imgEl.removeAttribute("src");
      imgEl.dataset.photoId = photoId;
      imgEl.classList.remove("isError");

      const rec = await PhotosDB.get(photoId);
      if (!rec || !rec.blob) {
        imgEl.classList.add("isError");
        return;
      }

      const dataUrl = await blobToDataURL(rec.blob);

      // 非同期中に別entryへ再利用された場合の誤代入防止
      if (imgEl.dataset.photoId !== photoId) return;

      imgEl.src = dataUrl;
    } catch (e) {
      console.warn("photo render failed", e);
      imgEl.classList.add("isError");
    }
  }

  /* ---- Swipe ---- */
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

    const photoId = dayData.entries[idx]?.photoId || null;
    if (wrapEl) wrapEl.classList.add("removing");

    setTimeout(async () => {
      dayData.entries.splice(idx, 1);
      Storage.sortEntries(dayData);

      const ok = Storage.saveDay(State.currentDate, dayData);
      if (!ok) {
        if (wrapEl) wrapEl.classList.remove("removing");
        return;
      }

      if (photoId) {
        try {
          await PhotosDB.del(photoId);
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

        const text = document.createElement("span");
        text.className = "text";
        text.textContent = entry.text || "";

        content.appendChild(time);
        content.appendChild(text);

        if (entry.photoId) {
          const img = document.createElement("img");
          img.className = "entryPhoto";
          img.alt = "photo";
          img.loading = "lazy";
          img.decoding = "async";
          content.appendChild(img);
          renderEntryPhoto(img, entry.photoId);
        }

        if (entry.fileName) {
          const fileLine = document.createElement("div");
          fileLine.className = "fileLine";
          fileLine.textContent = `📎 ${entry.fileName}`;
          content.appendChild(fileLine);
        }

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

    /* ---- time hint ---- */
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

    /* ---- image compress (optional) ---- */
    const fileToDataURL = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

    // iOSで toBlob が null を返すことがある → try/catch & null許容
    async function imageFileToCompressedBlob(file, maxSide = 1600, quality = 0.82) {
  const dataUrl = await fileToDataURL(file);

  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });

  const srcW = img.naturalWidth || img.width || 0;
  const srcH = img.naturalHeight || img.height || 0;
  if (!srcW || !srcH) throw new Error("image size read failed");

  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = dstW;
  canvas.height = dstH;

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("canvas context failed");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, dstW, dstH);

  const blob = await new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b || null), "image/jpeg", quality);
    } catch (e) {
      console.warn("toBlob failed", e);
      resolve(null);
    }
  });

  return blob; // null の場合は呼び出し側で元fileへフォールバック
}

    /* ---- attachments ---- */
    async function handleAttachment(fileList) {
      const files = fileList ? Array.from(fileList) : [];
      if (!files.length) return;

      clearPreview();
      resetPending();

      const images = files.filter((f) => (f.type || "").startsWith("image/"));
      const nonImages = files.filter((f) => !(f.type || "").startsWith("image/"));

      // 画像
      if (images.length) {
        const targets = State.editingId ? [images[0]] : images;

        const grid = document.createElement("div");
        grid.className = "thumbGrid";

        for (const file of targets) {
          try {
            const name = file.name || "";
            const shotDate = await getShotDate(file);
            const shotAt = shotDate ? shotDate.getTime() : Date.now();
            const shotTime = shotDate ? hhmmFromDate(shotDate) : "";

            // ✅ 1) 圧縮を試す（失敗してもOK）
            let blob = null;
            try {
              blob = await imageFileToCompressedBlob(file, 1280, 0.72);
            } catch (_) {
              blob = null;
            }

            // ✅ 2) 圧縮がダメなら元ファイルをそのまま保存（iOS最強安定）
            if (!blob) blob = file;

            const pid = "p_" + uid();

            await PhotosDB.put({
              id: pid,
              blob,
              mime: blob.type || file.type || "image/*",
              name,
              createdAt: shotAt,
            });

            // ✅ 3) すぐ読めるか検証（iOSでIDBが死んでる場合ここで分かる）
            const verify = await PhotosDB.get(pid);
            if (!verify || !verify.blob) {
              throw new Error("IndexedDB write/read verification failed");
            }

            // ✅ プレビューは dataURL（ObjectURLより安定）
            const dataUrl = await blobToDataURL(verify.blob);

            State.pendingPhotos.push({ id: pid, name, shotAt, shotTime });

            const img = document.createElement("img");
            img.src = dataUrl;
            img.alt = "attachment";
            grid.appendChild(img);
          } catch (e) {
            console.error("photo attach failed:", e);
            Toast.show("写真の保存に失敗（iPhoneの制限/プライベート/容量）");
            break; // ← handleAttachment 内なので合法
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
          Toast.show("写真を取り込めなかった…");
        }
        return;
      }

      // 非画像
      if (nonImages.length) {
        State.pendingFileName = nonImages[0].name || "";
        if (DOM.previewArea) {
          DOM.previewArea.innerHTML = `<div class="filePreview">📎 ${State.pendingFileName}</div>`;
        }
        setPreviewVisible(true);
        expand();
        Layout.scheduleUpdate();
        DOM.logInput?.focus?.();
      }
    }

    /* ---- edit ---- */
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
      State.editingPrevPhotoId = entry.photoId || null;

      // 既存写真のプレビュー（iOS安定：dataURL表示）
      if (entry.photoId) {
        try {
          const rec = await PhotosDB.get(entry.photoId);
          if (rec && rec.blob) {
            const dataUrl = await blobToDataURL(rec.blob);

            State.pendingPhotos = [{
              id: entry.photoId,
              name: rec.name || "photo",
              shotAt: rec.createdAt || (entry.createdAt ?? Date.now()),
              shotTime: entry.time || "",
            }];

            const grid = document.createElement("div");
            grid.className = "thumbGrid";
            const img = document.createElement("img");
            img.src = dataUrl;
            img.alt = "attachment";
            grid.appendChild(img);
            DOM.previewArea?.appendChild(grid);

            const meta = document.createElement("div");
            meta.className = "thumbMeta";
            meta.textContent = `編集中：写真 1枚`;
            DOM.previewArea?.appendChild(meta);

            setPreviewVisible(true);
            Layout.scheduleUpdate();
          }
        } catch (e) {
          console.warn(e);
        }
      } else if (entry.fileName) {
        State.pendingFileName = entry.fileName || "";
        if (DOM.previewArea) {
          DOM.previewArea.innerHTML = `<div class="filePreview">📎 ${State.pendingFileName}</div>`;
        }
        setPreviewVisible(true);
        Layout.scheduleUpdate();
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

    /* ---- save ---- */
    async function save() {
      if (State.isSaving) return;
      State.isSaving = true;

      try {
        await migrateLegacyPhotosForDay(State.currentDate);

        const text = (DOM.logInput?.value || "").trim();

        // time
        let time = "";
        if (State.timeMode === "set") {
          time = roundTimeToStep(State.selectedTime, TimeStep.stepMin) || State.selectedTime || "";
          State.selectedTime = time;
          if (DOM.logTime) DOM.logTime.value = time;
          if (!time) State.timeMode = "auto";
        }
        if (State.timeMode === "auto") time = nowHHMM();

        const hasPhoto = State.pendingPhotos.length > 0;
        const hasFileName = !!State.pendingFileName && !hasPhoto;

        if (!text && !hasPhoto && !hasFileName) {
          collapse();
          Layout.scheduleUpdate();
          DOM.logInput?.blur?.();
          return;
        }

        const dayData = Storage.getDay(State.currentDate);
        const baseText =
          text || (hasPhoto ? "📷 写真" : hasFileName ? `📎 ${State.pendingFileName}` : "");

        if (State.editingId) {
          const nextPhotoId = hasPhoto ? State.pendingPhotos[0]?.id || null : State.editingPrevPhotoId || null;

          const newPayload = {
            time,
            text: baseText,
            photoId: nextPhotoId,
            fileName: hasFileName ? State.pendingFileName : null,
          };

          const prevId = State.editingPrevPhotoId;
          const nextId = newPayload.photoId;

          const idx = (dayData.entries || []).findIndex((e) => e.id === State.editingId);
          if (idx >= 0) {
            dayData.entries[idx] = { ...dayData.entries[idx], ...newPayload };
            Toast.show("更新しました");
          } else {
            dayData.entries.push({ id: uid(), createdAt: Date.now(), ...newPayload });
            Toast.show("追加しました");
          }

          const replaced = !!prevId && !!nextId && prevId !== nextId;
          if (replaced) {
            try { await PhotosDB.del(prevId); } catch (e) { console.warn(e); }
          }
        } else {
          if (hasPhoto) {
            for (const p of State.pendingPhotos) {
              const t = p.shotTime || time;
              dayData.entries.push({
                id: uid(),
                createdAt: p.shotAt || Date.now(),
                time: t,
                text: baseText || "📷 写真",
                photoId: p.id,
                fileName: null,
              });
            }
            Toast.show(`${State.pendingPhotos.length}枚 保存しました`);
          } else {
            dayData.entries.push({
              id: uid(),
              createdAt: Date.now(),
              time,
              text: baseText,
              photoId: null,
              fileName: hasFileName ? State.pendingFileName : null,
            });
            Toast.show("保存しました");
          }
        }

        Storage.sortEntries(dayData);

        const ok = Storage.saveDay(State.currentDate, dayData);
        if (!ok) return;

        await App.loadAndRender(State.currentDate);

        // reset UI
        State.editingId = null;
        State.editingPrevPhotoId = null;

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
        setTimeout(() => (State.isSaving = false), 160);
      }
    }

    /* ---- plus sheet ---- */
    let lastFocusEl = null;
    function openPlusSheet() {
      lastFocusEl = document.activeElement;
      DOM.plusSheet?.classList.add("open");
      DOM.plusSheet?.removeAttribute("inert");
      requestAnimationFrame(() => DOM.actPhoto?.focus({ preventScroll: true }));
    }
    function closePlusSheet() {
      const ae = document.activeElement;
      if (ae && DOM.plusSheet && DOM.plusSheet.contains(ae) && typeof ae.blur === "function") ae.blur();
      DOM.plusSheet?.setAttribute("inert", "");
      DOM.plusSheet?.classList.remove("open");
      const back = lastFocusEl || DOM.plusBtn;
      requestAnimationFrame(() => back?.focus?.({ preventScroll: true }));
    }

    function bind() {
      // expand/collapse
      on(DOM.logInput, "focus", () => { expand(); Layout.scheduleUpdate(); });
      on(DOM.logInput, "beforeinput", () => {
        if (DOM.inputBar && !DOM.inputBar.classList.contains("expanded")) {
          expand(); Layout.scheduleUpdate();
        }
      });
      on(DOM.logInput, "blur", () => setTimeout(() => { collapse(); Layout.scheduleUpdate(); }, 80));

      // outside tap blur
      document.addEventListener("pointerdown", (e) => {
        if (document.activeElement !== DOM.logInput) return;
        if (DOM.inputBar && DOM.inputBar.contains(e.target)) return;
        DOM.logInput?.blur?.();
        State.editingId = null;
      }, { passive: true });

      // time picker
      on(DOM.logTime, "pointerdown", () => {
        if (DOM.logTime && !DOM.logTime.value) DOM.logTime.value = nowHHMM();
      }, { passive: true });

      on(DOM.logTime, "input", () => {
        State.tempTime = DOM.logTime?.value || "";
        if (!DOM.timeHint) return;
        if (State.tempTime) {
          DOM.timeHint.textContent = State.tempTime;
          DOM.timeHint.className = "isSet";
        } else {
          refreshTimeHint();
        }
      }, { passive: true });

      on(DOM.logTime, "blur", commitTimeFromPicker, { passive: true });
      on(DOM.logTime, "change", commitTimeFromPicker, { passive: true });

      // save
      on(DOM.saveBtn, "click", save);

      // plus sheet open/close
      on(DOM.plusBtn, "click", openPlusSheet);
      on(DOM.plusSheetBackdrop, "click", closePlusSheet);
      on(DOM.actCancel, "click", closePlusSheet);

      // iOSで click順が重要：click -> close の順
      on(DOM.actPhoto, "click", () => { DOM.pickPhotoInput?.click(); closePlusSheet(); });
      on(DOM.actCamera, "click", () => { DOM.takePhotoInput?.click(); closePlusSheet(); });
      on(DOM.actFile, "click", () => { DOM.fileInput?.click(); closePlusSheet(); });

      [DOM.fileInput, DOM.pickPhotoInput, DOM.takePhotoInput].forEach((inp) => {
        if (!inp) return;
        inp.addEventListener("change", (e) => {
          handleAttachment(e.target.files);
          e.target.value = "";
        });
      });

            // desktop paste (主に Mac Chrome 用)
      document.addEventListener("paste", async (e) => {
        // 入力中の通常テキスト貼り付けは邪魔しない
        const active = document.activeElement;
        const typingIntoTextField =
          active &&
          (active === DOM.logInput ||
            active.tagName === "TEXTAREA" ||
            (active.tagName === "INPUT" && active.type !== "file"));

        const items = Array.from(e.clipboardData?.items || []);
        const imageItems = items.filter((item) => (item.type || "").startsWith("image/"));
        if (!imageItems.length) return;

        // logInputに文字を貼りたい場面でも、
        // 画像が含まれている時だけ画像優先で受ける
        e.preventDefault();

        const files = [];
        for (const item of imageItems) {
          const file = item.getAsFile?.();
          if (file) files.push(file);
        }
        if (!files.length) return;

        try {
          expand();
          Layout.scheduleUpdate();
          await handleAttachment(files);
          if (!typingIntoTextField) DOM.logInput?.focus?.();
        } catch (err) {
          console.error("paste image failed:", err);
          Toast.show("貼り付け画像の取り込みに失敗");
        }
      });
    }

    return { bind, refreshTimeHint, startTimeTicker, beginEditById };
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
      if (ae && DOM.settingsModal && DOM.settingsModal.contains(ae) && typeof ae.blur === "function") ae.blur();
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
        if (!confirm("容量を回復するよ。\n古い写真(dataURL)をIndexedDBへ移行して保存エラーを減らす。\n\n実行する？")) return;
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

          if (!confirm(`データを復元するよ（${dateKeys.length}日分）\n同じ日付は上書き。\n実行する？`)) return;

          for (const k of dateKeys) localStorage.setItem(k, JSON.stringify(data[k]));
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
      // DB open + ping
      PhotosDB.open().catch(() => {});
      const ok = await PhotosDB.ping();
      if (ok === false) {
        Toast.show("写真DBが使えない状態（プライベート/制限の可能性）");
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
})();    if (!m) return 999999;
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
      timer = setTimeout(() => el.classList.remove("show"), 1300);
    }
    return { show };
  })();

  /* =======================
     Storage (localStorage)
  ======================= */
  const Storage = (() => {
    function saveDay(dateKey, dayData) {
      try {
        localStorage.setItem(dateKey, JSON.stringify(dayData));
        return true;
      } catch (err) {
        console.error("saveDay failed:", err);
        if (err && String(err.name) === "QuotaExceededError") {
          Toast.show("保存できなかった：容量オーバー（古い写真が残ってるかも）");
        } else {
          Toast.show("保存できなかった…");
        }
        return false;
      }
    }

    function getDay(dateKey) {
      const dayData = JSON.parse(localStorage.getItem(dateKey) || "{}");
      dayData.entries = dayData.entries || [];
      for (const e of dayData.entries) {
        if (!e.id) e.id = uid();
        if (e.createdAt == null) e.createdAt = Date.now();
      }
      return dayData;
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
          out[k] = JSON.parse(localStorage.getItem(k));
        }
      }
      return out;
    }

    return { saveDay, getDay, sortEntries, exportAll };
  })();

  /* =======================
     EXIF (JPEG) minimal
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

            const y = +m[1],
              mo = +m[2] - 1,
              da = +m[3],
              hh = +m[4],
              mm = +m[5],
              ss = +m[6];
            return new Date(y, mo, da, hh, mm, ss);
          }
        }
        return null;
      }
      offset += 2 + size;
    }
    return null;
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
     PhotosDB (IndexedDB)
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

    // IDBが死んでる/使えない環境を早期検知
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
     Legacy migrate (localStorage dataURL -> IDB)
  ======================= */
  async function migrateLegacyPhotosForDay(dateKey) {
    const dayData = Storage.getDay(dateKey);
    let changed = false;
    let moved = 0;

    for (const e of dayData.entries || []) {
      const isLegacy =
        e && typeof e.photo === "string" && e.photo.startsWith("data:image/");
      const needsMove = isLegacy && !e.photoId;
      if (!needsMove) continue;

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
        e.photoId = pid;
        delete e.photo;
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

    // time
    timeMode: "auto", // auto | set
    selectedTime: "",
    tempTime: "",
    timeTicker: null,

    // edit/save
    editingId: null,
    editingPrevPhotoId: null,
    isSaving: false,

    // attachments
    pendingPhotos: [], // [{ id, name, shotAt, shotTime }]
    pendingFileName: "",

    // swipe
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
    cleanupStorage: $("cleanupStorage"),
    timeStepBtn: $("timeStepBtn"),
    importFile: $("importFile"),
  };

  /* =======================
     Layout (body padding-bottom)
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
     TimeStep (1 or 10)
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
    return { init, get stepMin() { return stepMin; } };
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
      const day = d.getDay(); // 0=日
      const diff = day === 0 ? -6 : 1 - day; // 月曜始まり
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
    // iOS安定：FileReader表示に統一（ObjectURL回避）
    async function renderEntryPhoto(imgEl, photoId) {
      try {
        const rec = await PhotosDB.get(photoId);
        if (!rec || !rec.blob) return;
        const dataUrl = await blobToDataURL(rec.blob);
        imgEl.src = dataUrl;
      } catch (e) {
        console.warn("photo render failed", e);
      }
    }

    /* ---- Swipe ---- */
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

      const photoId = dayData.entries[idx]?.photoId || null;
      if (wrapEl) wrapEl.classList.add("removing");

      setTimeout(async () => {
        dayData.entries.splice(idx, 1);
        Storage.sortEntries(dayData);

        const ok = Storage.saveDay(State.currentDate, dayData);
        if (!ok) {
          if (wrapEl) wrapEl.classList.remove("removing");
          return;
        }

        if (photoId) {
          try {
            await PhotosDB.del(photoId);
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

          const text = document.createElement("span");
          text.className = "text";
          text.textContent = entry.text || "";

          content.appendChild(time);
          content.appendChild(text);

          if (entry.photoId) {
            const img = document.createElement("img");
            img.className = "entryPhoto";
            img.alt = "photo";
            img.loading = "lazy";
            content.appendChild(img);
            renderEntryPhoto(img, entry.photoId);
          }

          if (entry.fileName) {
            const fileLine = document.createElement("div");
            fileLine.className = "fileLine";
            fileLine.textContent = `📎 ${entry.fileName}`;
            content.appendChild(fileLine);
          }

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

    /* ---- time hint ---- */
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

    /* ---- image compress (optional) ---- */
    const fileToDataURL = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

    // iOSで toBlob が null を返すことがある → try/catch & null許容
    async function imageFileToCompressedBlob(file, maxSide = 1280, quality = 0.72) {
      const dataUrl = await fileToDataURL(file);
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = dataUrl;
      });

      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      const nw = Math.round(w * scale);
      const nh = Math.round(h * scale);

      const canvas = document.createElement("canvas");
      canvas.width = nw;
      canvas.height = nh;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, nw, nh);

      const blob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
      });

      return blob; // null もあり得る
    }

    /* ---- attachments ---- */
    async function handleAttachment(fileList) {
      const files = fileList ? Array.from(fileList) : [];
      if (!files.length) return;

      clearPreview();
      resetPending();

      const images = files.filter((f) => (f.type || "").startsWith("image/"));
      const nonImages = files.filter((f) => !(f.type || "").startsWith("image/"));

      // 画像
      if (images.length) {
        const targets = State.editingId ? [images[0]] : images;

        const grid = document.createElement("div");
        grid.className = "thumbGrid";

        for (const file of targets) {
          try {
            const name = file.name || "";
            const shotDate = await getShotDate(file);
            const shotAt = shotDate ? shotDate.getTime() : Date.now();
            const shotTime = shotDate ? hhmmFromDate(shotDate) : "";

            // ✅ 1) 圧縮を試す（失敗してもOK）
            let blob = null;
            try {
              blob = await imageFileToCompressedBlob(file, 1280, 0.72);
            } catch (_) {
              blob = null;
            }

            // ✅ 2) 圧縮がダメなら元ファイルをそのまま保存（iOS最強安定）
            if (!blob) blob = file;

            const pid = "p_" + uid();

            await PhotosDB.put({
              id: pid,
              blob,
              mime: blob.type || file.type || "image/*",
              name,
              createdAt: shotAt,
            });

            // ✅ 3) すぐ読めるか検証（iOSでIDBが死んでる場合ここで分かる）
            const verify = await PhotosDB.get(pid);
            if (!verify || !verify.blob) {
              throw new Error("IndexedDB write/read verification failed");
            }

            // ✅ プレビューは dataURL（ObjectURLより安定）
            const dataUrl = await blobToDataURL(verify.blob);

            State.pendingPhotos.push({ id: pid, name, shotAt, shotTime });

            const img = document.createElement("img");
            img.src = dataUrl;
            img.alt = "attachment";
            grid.appendChild(img);
          } catch (e) {
            console.error("photo attach failed:", e);
            Toast.show("写真の保存に失敗（iPhoneの制限/プライベート/容量）");
            break; // ← handleAttachment 内なので合法
          }
        }

        DOM.previewArea?.appendChild(grid);
        const meta = document.createElement("div");
        meta.className = "thumbMeta";
        meta.textContent = `${State.pendingPhotos.length}枚の写真を選択`;
        DOM.previewArea?.appendChild(meta);

        setPreviewVisible(true);
        expand();
        Layout.scheduleUpdate();
        DOM.logInput?.focus?.();
        return;
      }

      // 非画像
      if (nonImages.length) {
        State.pendingFileName = nonImages[0].name || "";
        if (DOM.previewArea) {
          DOM.previewArea.innerHTML = `<div class="filePreview">📎 ${State.pendingFileName}</div>`;
        }
        setPreviewVisible(true);
        expand();
        Layout.scheduleUpdate();
        DOM.logInput?.focus?.();
      }
    }

    /* ---- edit ---- */
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
      State.editingPrevPhotoId = entry.photoId || null;

      // 既存写真のプレビュー（iOS安定：dataURL表示）
      if (entry.photoId) {
        try {
          const rec = await PhotosDB.get(entry.photoId);
          if (rec && rec.blob) {
            const dataUrl = await blobToDataURL(rec.blob);

            State.pendingPhotos = [{
              id: entry.photoId,
              name: rec.name || "photo",
              shotAt: rec.createdAt || (entry.createdAt ?? Date.now()),
              shotTime: entry.time || "",
            }];

            const grid = document.createElement("div");
            grid.className = "thumbGrid";
            const img = document.createElement("img");
            img.src = dataUrl;
            img.alt = "attachment";
            grid.appendChild(img);
            DOM.previewArea?.appendChild(grid);

            const meta = document.createElement("div");
            meta.className = "thumbMeta";
            meta.textContent = `編集中：写真 1枚`;
            DOM.previewArea?.appendChild(meta);

            setPreviewVisible(true);
            Layout.scheduleUpdate();
          }
        } catch (e) {
          console.warn(e);
        }
      } else if (entry.fileName) {
        State.pendingFileName = entry.fileName || "";
        if (DOM.previewArea) {
          DOM.previewArea.innerHTML = `<div class="filePreview">📎 ${State.pendingFileName}</div>`;
        }
        setPreviewVisible(true);
        Layout.scheduleUpdate();
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

    /* ---- save ---- */
    async function save() {
      if (State.isSaving) return;
      State.isSaving = true;

      try {
        await migrateLegacyPhotosForDay(State.currentDate);

        const text = (DOM.logInput?.value || "").trim();

        // time
        let time = "";
        if (State.timeMode === "set") {
          time = roundTimeToStep(State.selectedTime, TimeStep.stepMin) || State.selectedTime || "";
          State.selectedTime = time;
          if (DOM.logTime) DOM.logTime.value = time;
          if (!time) State.timeMode = "auto";
        }
        if (State.timeMode === "auto") time = nowHHMM();

        const hasPhoto = State.pendingPhotos.length > 0;
        const hasFileName = !!State.pendingFileName && !hasPhoto;

        if (!text && !hasPhoto && !hasFileName) {
          collapse();
          Layout.scheduleUpdate();
          DOM.logInput?.blur?.();
          return;
        }

        const dayData = Storage.getDay(State.currentDate);
        const baseText =
          text || (hasPhoto ? "📷 写真" : hasFileName ? `📎 ${State.pendingFileName}` : "");

        if (State.editingId) {
          const nextPhotoId = hasPhoto ? State.pendingPhotos[0]?.id || null : State.editingPrevPhotoId || null;

          const newPayload = {
            time,
            text: baseText,
            photoId: nextPhotoId,
            fileName: hasFileName ? State.pendingFileName : null,
          };

          const prevId = State.editingPrevPhotoId;
          const nextId = newPayload.photoId;

          const idx = (dayData.entries || []).findIndex((e) => e.id === State.editingId);
          if (idx >= 0) {
            dayData.entries[idx] = { ...dayData.entries[idx], ...newPayload };
            Toast.show("更新しました");
          } else {
            dayData.entries.push({ id: uid(), createdAt: Date.now(), ...newPayload });
            Toast.show("追加しました");
          }

          const replaced = !!prevId && !!nextId && prevId !== nextId;
          if (replaced) {
            try { await PhotosDB.del(prevId); } catch (e) { console.warn(e); }
          }
        } else {
          if (hasPhoto) {
            for (const p of State.pendingPhotos) {
              const t = p.shotTime || time;
              dayData.entries.push({
                id: uid(),
                createdAt: p.shotAt || Date.now(),
                time: t,
                text: baseText || "📷 写真",
                photoId: p.id,
                fileName: null,
              });
            }
            Toast.show(`${State.pendingPhotos.length}枚 保存しました`);
          } else {
            dayData.entries.push({
              id: uid(),
              createdAt: Date.now(),
              time,
              text: baseText,
              photoId: null,
              fileName: hasFileName ? State.pendingFileName : null,
            });
            Toast.show("保存しました");
          }
        }

        Storage.sortEntries(dayData);

        const ok = Storage.saveDay(State.currentDate, dayData);
        if (!ok) return;

        await App.loadAndRender(State.currentDate);

        // reset UI
        State.editingId = null;
        State.editingPrevPhotoId = null;

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
        setTimeout(() => (State.isSaving = false), 160);
      }
    }

    /* ---- plus sheet ---- */
    let lastFocusEl = null;
    function openPlusSheet() {
      lastFocusEl = document.activeElement;
      DOM.plusSheet?.classList.add("open");
      DOM.plusSheet?.removeAttribute("inert");
      requestAnimationFrame(() => DOM.actPhoto?.focus({ preventScroll: true }));
    }
    function closePlusSheet() {
      const ae = document.activeElement;
      if (ae && DOM.plusSheet && DOM.plusSheet.contains(ae) && typeof ae.blur === "function") ae.blur();
      DOM.plusSheet?.setAttribute("inert", "");
      DOM.plusSheet?.classList.remove("open");
      const back = lastFocusEl || DOM.plusBtn;
      requestAnimationFrame(() => back?.focus?.({ preventScroll: true }));
    }

    function bind() {
      // expand/collapse
      on(DOM.logInput, "focus", () => { expand(); Layout.scheduleUpdate(); });
      on(DOM.logInput, "beforeinput", () => {
        if (DOM.inputBar && !DOM.inputBar.classList.contains("expanded")) {
          expand(); Layout.scheduleUpdate();
        }
      });
      on(DOM.logInput, "blur", () => setTimeout(() => { collapse(); Layout.scheduleUpdate(); }, 80));

      // outside tap blur
      document.addEventListener("pointerdown", (e) => {
        if (document.activeElement !== DOM.logInput) return;
        if (DOM.inputBar && DOM.inputBar.contains(e.target)) return;
        DOM.logInput?.blur?.();
        State.editingId = null;
      }, { passive: true });

      // time picker
      on(DOM.logTime, "pointerdown", () => {
        if (DOM.logTime && !DOM.logTime.value) DOM.logTime.value = nowHHMM();
      }, { passive: true });

      on(DOM.logTime, "input", () => {
        State.tempTime = DOM.logTime?.value || "";
        if (!DOM.timeHint) return;
        if (State.tempTime) {
          DOM.timeHint.textContent = State.tempTime;
          DOM.timeHint.className = "isSet";
        } else {
          refreshTimeHint();
        }
      }, { passive: true });

      on(DOM.logTime, "blur", commitTimeFromPicker, { passive: true });
      on(DOM.logTime, "change", commitTimeFromPicker, { passive: true });

      // save
      on(DOM.saveBtn, "click", save);

      // plus sheet open/close
      on(DOM.plusBtn, "click", openPlusSheet);
      on(DOM.plusSheetBackdrop, "click", closePlusSheet);
      on(DOM.actCancel, "click", closePlusSheet);

      // iOSで click順が重要：click -> close の順
      on(DOM.actPhoto, "click", () => { DOM.pickPhotoInput?.click(); closePlusSheet(); });
      on(DOM.actCamera, "click", () => { DOM.takePhotoInput?.click(); closePlusSheet(); });
      on(DOM.actFile, "click", () => { DOM.fileInput?.click(); closePlusSheet(); });

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
      if (ae && DOM.settingsModal && DOM.settingsModal.contains(ae) && typeof ae.blur === "function") ae.blur();
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
        if (!confirm("容量を回復するよ。\n古い写真(dataURL)をIndexedDBへ移行して保存エラーを減らす。\n\n実行する？")) return;
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

          if (!confirm(`データを復元するよ（${dateKeys.length}日分）\n同じ日付は上書き。\n実行する？`)) return;

          for (const k of dateKeys) localStorage.setItem(k, JSON.stringify(data[k]));
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
      // DB open + ping
      PhotosDB.open().catch(() => {});
      const ok = await PhotosDB.ping();
      if (ok === false) {
        Toast.show("写真DBが使えない状態（プライベート/制限の可能性）");
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
