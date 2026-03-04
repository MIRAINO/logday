(() => {
  'use strict';

  // ✅ 二重実行ガード（同じJSが再評価されても安全）
  if (window.__LOGDAY_APPJS_LOADED__) {
    console.warn('[LOGDAY] app.js already loaded -> skip');
    return;
  }
  window.__LOGDAY_APPJS_LOADED__ = true;

  /* =======================
     Utilities / Storage
  ======================= */
  function byId(id){ return document.getElementById(id); }
  function pad2(n){ return String(n).padStart(2,'0'); }
  function nowHHMM(){
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function uid(){
    return "e_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,8);
  }
  function hhmmFromDate(d){
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function formatYMD(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function parseYMD(str){
    const [y,m,d] = str.split('-').map(Number);
    return new Date(y, m-1, d);
  }
  function timeToMinutes(t){
    if(!t) return 999999;
    const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
    if(!m) return 999999;
    return parseInt(m[1],10)*60 + parseInt(m[2],10);
  }

  function showToast(message){
    const toast = byId('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1200);
  }

  window.saveDayData = function(dateKey, dayData){
    try {
      localStorage.setItem(dateKey, JSON.stringify(dayData));
      return true;
    } catch (err) {
      console.error("saveDayData failed:", err);
      if (err && String(err.name) === "QuotaExceededError") {
        showToast("保存できなかった：容量オーバー（古い写真データが残ってるかも）");
      } else {
        showToast("保存できなかった…");
      }
      return false;
    }
  };

  function getDayData(dateKey){
    const dayData = JSON.parse(localStorage.getItem(dateKey) || '{}');
    dayData.entries = dayData.entries || [];
    dayData.entries.forEach(e=>{
      if(!e.id) e.id = uid();
      if(e.createdAt == null) e.createdAt = Date.now();
    });
    return dayData;
  }

  function sortEntries(dayData){
    const arr = dayData.entries || [];
    arr.sort((a,b)=>{
      const ta = timeToMinutes(a.time);
      const tb = timeToMinutes(b.time);
      if (ta !== tb) return ta - tb;
      const ca = a.createdAt ?? 0;
      const cb = b.createdAt ?? 0;
      if (ca !== cb) return ca - cb;
      return String(a.id||"").localeCompare(String(b.id||""));
    });
  }

  function roundTimeToStep(timeStr, stepMin){
    const m = String(timeStr || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return '';
    let h = parseInt(m[1], 10);
    let mi = parseInt(m[2], 10);
    const rounded = Math.round(mi / stepMin) * stepMin;
    if (rounded === 60) { mi = 0; h = (h + 1) % 24; }
    else { mi = rounded; }
    return `${pad2(h)}:${pad2(mi)}`;
  }

  /* =======================
     EXIF (JPEG DateTimeOriginal/DateTime) minimal
  ======================= */
  function exifDateFromJpegArrayBuffer(buf){
    const dv = new DataView(buf);
    if (dv.getUint16(0, false) !== 0xFFD8) return null; // JPEG SOI

    let offset = 2;
    const len = dv.byteLength;

    while (offset + 4 < len) {
      if (dv.getUint8(offset) !== 0xFF) break;
      const marker = dv.getUint8(offset + 1);
      const size = dv.getUint16(offset + 2, false);

      if (marker === 0xE1) { // APP1 (EXIF)
        const exifHeader = offset + 4;
        const isExif =
          dv.getUint8(exifHeader) === 0x45 &&
          dv.getUint8(exifHeader+1) === 0x78 &&
          dv.getUint8(exifHeader+2) === 0x69 &&
          dv.getUint8(exifHeader+3) === 0x66 &&
          dv.getUint8(exifHeader+4) === 0x00 &&
          dv.getUint8(exifHeader+5) === 0x00;
        if (!isExif) return null;

        const tiffStart = exifHeader + 6;
        const endianMark = dv.getUint16(tiffStart, false);
        const little = (endianMark === 0x4949); // "II"
        const get16 = (p)=> dv.getUint16(p, little);
        const get32 = (p)=> dv.getUint32(p, little);

        if (get16(tiffStart + 2) !== 0x002A) return null;

        const ifd0Offset = get32(tiffStart + 4);
        const ifd0 = tiffStart + ifd0Offset;
        if (ifd0 + 2 > len) return null;

        const num0 = get16(ifd0);
        let exifIFDPtr = null;

        for (let i=0;i<num0;i++){
          const ent = ifd0 + 2 + i*12;
          const tag = get16(ent);
          if (tag === 0x8769) { // ExifIFDPointer
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
          for (let i=0;i<count;i++){
            const c = dv.getUint8(start+i);
            if (c === 0) break;
            s += String.fromCharCode(c);
          }
          return s;
        };

        for (let i=0;i<numE;i++){
          const ent = exifIFD + 2 + i*12;
          const tag = get16(ent);

          if (tag === 0x9003 || tag === 0x0132) { // DateTimeOriginal / DateTime
            const type = get16(ent + 2);
            const count = get32(ent + 4);
            const valueOffset = get32(ent + 8);
            if (type !== 2 || count < 10) continue;

            const str = readAscii(valueOffset, count);
            if (!str) continue;

            const m = str.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
            if (!m) continue;

            const y = +m[1], mo = +m[2]-1, da = +m[3], hh = +m[4], mm = +m[5], ss = +m[6];
            return new Date(y, mo, da, hh, mm, ss);
          }
        }
        return null;
      }

      offset += 2 + size;
    }
    return null;
  }

  async function getShotDate(file){
    const isJpeg = (file.type === 'image/jpeg') || /\.(jpe?g)$/i.test(file.name || '');
    if (isJpeg) {
      try{
        const buf = await file.arrayBuffer();
        const exifDate = exifDateFromJpegArrayBuffer(buf);
        if (exifDate && !isNaN(exifDate.getTime())) return exifDate;
      }catch(e){}
    }
    const lm = file.lastModified ? new Date(file.lastModified) : null;
    if (lm && !isNaN(lm.getTime())) return lm;
    return null;
  }

  /* =======================
     IndexedDB (photos)
  ======================= */
  const DB_NAME = 'logday_db';
  const DB_VER  = 1;
  let dbPromise = null;

  function openDB(){
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('photos')) {
          const store = db.createObjectStore('photos', { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique:false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function idbPutPhoto({ id, blob, mime, name, createdAt }){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.objectStore('photos').put({ id, blob, mime, name, createdAt });
    });
  }

  async function idbGetPhoto(id){
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readonly');
      const req = tx.objectStore('photos').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbDeletePhoto(id){
    if (!id) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.objectStore('photos').delete(id);
    });
  }

  async function dataUrlToBlob(dataUrl){
    const res = await fetch(dataUrl);
    return await res.blob();
  }

  /* =======================
     Legacy photo migration (localStorage -> IDB)
  ======================= */
  async function migrateLegacyPhotosForDay(dateKey){
    const dayData = getDayData(dateKey);
    let changed = false;
    let moved = 0;

    for (const e of (dayData.entries || [])) {
      const isLegacy = e && typeof e.photo === 'string' && e.photo.startsWith('data:image/');
      const needsMove = isLegacy && !e.photoId;
      if (!needsMove) continue;

      try{
        const blob = await dataUrlToBlob(e.photo);
        const pid = 'p_' + uid();
        await idbPutPhoto({
          id: pid,
          blob,
          mime: blob.type || 'image/jpeg',
          name: 'photo.jpg',
          createdAt: e.createdAt || Date.now()
        });

        e.photoId = pid;
        delete e.photo;
        moved++;
        changed = true;
      }catch(err){
        console.warn('legacy migrate failed', err);
        delete e.photo;
        changed = true;
      }
    }

    if (changed) window.saveDayData(dateKey, dayData);
    return { changed, moved };
  }

  /* =======================
     App State
  ======================= */
  let viewMode = 'week';
  let currentDate = formatYMD(new Date());
  let todayKey = formatYMD(new Date());

  let timeMode = 'auto';
  let selectedTime = '';
  let tempTime = '';
  let timeTicker = null;

  let editingId = null;
  let editingPrevPhotoId = null;
  let isSaving = false;

  let pendingPhotos = []; // [{ id, url, name, shotAt, shotTime }]
  let pendingFileName = '';

  function revokePendingPhotoUrls(){
    for (const p of pendingPhotos) {
      if (p?.url) {
        try { URL.revokeObjectURL(p.url); } catch(e){}
      }
    }
    pendingPhotos = [];
  }

  /* time step */
  const STEP_KEY = 'logday_time_step_min';
  function getTimeStepMin(){
    const v = parseInt(localStorage.getItem(STEP_KEY) || '10', 10);
    return (v === 1 || v === 10) ? v : 10;
  }
  function setTimeStepMin(v){
    const step = (v === 1 || v === 10) ? v : 10;
    localStorage.setItem(STEP_KEY, String(step));
    applyTimeStepToUI(step);
    showToast(step === 1 ? '分刻み：1分' : '分刻み：10分');
  }
  let timeStepMin = getTimeStepMin();

  /* =======================
     Header / Date / Calendar
  ======================= */
  function renderNavDate(dateStr){
    const d = parseYMD(dateStr);
    const dateText = d.toLocaleDateString('ja-JP',{ year:'numeric', month:'2-digit', day:'2-digit' });
    const weekdayText = d.toLocaleDateString('ja-JP',{ weekday:'short' });
    const el = byId('navDate');
    if (el) el.textContent = `${dateText}（${weekdayText}）`;
  }

  function startOfWeek(dateStr){
    const d = parseYMD(dateStr);
    const day = d.getDay();
    const diff = (day === 0) ? -6 : (1 - day);
    d.setDate(d.getDate() + diff);
    return d;
  }

  function renderWeekBar(dateStr){
    const bar = byId('weekBar');
    if (!bar) return;

    bar.style.display = (viewMode === 'week') ? 'grid' : 'none';
    if (viewMode !== 'week') return;

    bar.innerHTML = '';
    const start = startOfWeek(dateStr);
    const wnames = ['月','火','水','木','金','土','日'];

    for(let i=0;i<7;i++){
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const ymd = formatYMD(d);

      const btn = document.createElement('button');
      btn.dataset.date = ymd;
      btn.innerHTML = `${wnames[i]}<span class="d">${d.getDate()}</span>`;
      btn.classList.toggle('active', ymd === currentDate);

      btn.onclick = async () => {
        currentDate = ymd;
        await loadDay(currentDate);
        renderWeekBar(currentDate);
        generateCalendar();
      };
      bar.appendChild(btn);
    }
  }

  function generateCalendar(){
    const cal = byId('calendar');
    if (!cal) return;

    cal.innerHTML = '';

    const d = new Date(currentDate);
    const year = d.getFullYear();
    const month = d.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDate = new Date(year, month + 1, 0).getDate();
    const blanks = (firstDay.getDay() + 6) % 7;

    for(let i=0;i<blanks;i++){
      const empty = document.createElement('button');
      empty.disabled = true;
      empty.style.visibility = 'hidden';
      cal.appendChild(empty);
    }

    for(let day=1; day<=lastDate; day++){
      const dayStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const btn = document.createElement('button');
      btn.textContent = day;
      btn.dataset.date = dayStr;
      btn.classList.toggle('active', dayStr === currentDate);

      btn.onclick = async () => {
        currentDate = dayStr;
        await loadDay(currentDate);
        generateCalendar();
        renderWeekBar(currentDate);
      };
      cal.appendChild(btn);
    }
  }

  /* =======================
     Swipe to delete
  ======================= */
  const SWIPE_OPEN_X = -84;
  const SWIPE_THRESHOLD = -42;
  const SWIPE_FULL_DELETE = -170;
  const SWIPE_OVERSHOOT = 26;

  let openSwipeId = null;
  const swipeLock = { active:false, moved:false, id:null, startX:0, startY:0, currentX:0 };

  function closeAllSwipes(){
    document.querySelectorAll('.entrySwipe.open').forEach(el => el.classList.remove('open'));
    openSwipeId = null;
  }
  function closeOtherSwipes(keepId){
    document.querySelectorAll('.entrySwipe.open').forEach(el => {
      if (el.dataset.id !== keepId) el.classList.remove('open');
    });
    openSwipeId = keepId;
  }

  function attachSwipeHandlers(wrapEl, contentEl){
    wrapEl.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      swipeLock.active = true;
      swipeLock.moved = false;
      swipeLock.id = wrapEl.dataset.id;
      swipeLock.startX = e.clientX;
      swipeLock.startY = e.clientY;
      swipeLock.currentX = 0;

      closeOtherSwipes(wrapEl.dataset.id);

      contentEl.style.transition = 'none';
      wrapEl.setPointerCapture?.(e.pointerId);
    }, { passive:true });

    wrapEl.addEventListener('pointermove', (e) => {
      if (!swipeLock.active || swipeLock.id !== wrapEl.dataset.id) return;

      const dx = e.clientX - swipeLock.startX;
      const dy = e.clientY - swipeLock.startY;

      if (!swipeLock.moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) {
        swipeLock.active = false;
        contentEl.style.transition = '';
        return;
      }
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;

      swipeLock.moved = true;

      const base = wrapEl.classList.contains('open') ? SWIPE_OPEN_X : 0;
      let x = base + dx;
      x = Math.min(0, x);

      if (x < SWIPE_FULL_DELETE) {
        const over = x - SWIPE_FULL_DELETE;
        x = SWIPE_FULL_DELETE + over * 0.35;
        x = Math.max(SWIPE_FULL_DELETE - SWIPE_OVERSHOOT, x);
      }
      swipeLock.currentX = x;
      contentEl.style.transform = `translateX(${x}px)`;
    }, { passive:true });

    const finish = async () => {
      if (!swipeLock.active || swipeLock.id !== wrapEl.dataset.id) return;

      contentEl.style.transition = '';
      const x = swipeLock.currentX;

      if (!swipeLock.moved) {
        if (wrapEl.classList.contains('open')) {
          wrapEl.classList.remove('open');
          openSwipeId = null;
        }
        swipeLock.active = false;
        contentEl.style.transform = '';
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
        wrapEl.classList.add('open');
        openSwipeId = wrapEl.dataset.id;
        contentEl.style.transform = '';
      } else {
        wrapEl.classList.remove('open');
        openSwipeId = null;
        contentEl.style.transform = '';
      }

      swipeLock.active = false;
    };

    wrapEl.addEventListener('pointerup', finish, { passive:true });
    wrapEl.addEventListener('pointercancel', finish, { passive:true });
  }

  async function deleteEntryById(entryId, wrapEl){
    const dayData = getDayData(currentDate);
    const idx = dayData.entries.findIndex(e => e.id === entryId);
    if (idx < 0) return;

    const photoId = dayData.entries[idx]?.photoId || null;
    if (wrapEl) wrapEl.classList.add('removing');

    setTimeout(async () => {
      dayData.entries.splice(idx, 1);
      sortEntries(dayData);

      const ok = window.saveDayData(currentDate, dayData);
      if (!ok) {
        if (wrapEl) wrapEl.classList.remove('removing');
        return;
      }
      if (photoId) {
        try { await idbDeletePhoto(photoId); } catch(e){ console.warn(e); }
      }

      showToast('削除しました');
      await loadDay(currentDate);
    }, 120);
  }

  document.addEventListener('pointerdown', (e) => {
    if (openSwipeId && !e.target.closest('.entrySwipe')) closeAllSwipes();
  }, {passive:true});

  /* =======================
     Render Day
  ======================= */
  function cleanupEntryObjectUrls(){
    document.querySelectorAll('img.entryPhoto[data-objurl]').forEach(img=>{
      try { URL.revokeObjectURL(img.dataset.objurl); } catch(e){}
      img.removeAttribute('data-objurl');
    });
  }

  async function renderEntryPhoto(imgEl, photoId){
    try{
      const rec = await idbGetPhoto(photoId);
      if (!rec || !rec.blob) return;
      const url = URL.createObjectURL(rec.blob);
      imgEl.src = url;
      imgEl.dataset.objurl = url;
    }catch(e){ console.warn(e); }
  }

  async function loadDay(dateStr){
    await migrateLegacyPhotosForDay(dateStr);

    cleanupEntryObjectUrls();
    renderNavDate(dateStr);

    const entriesDiv = byId('entries');
    if (!entriesDiv) return;
    entriesDiv.innerHTML = '';

    const saved = getDayData(dateStr);
    sortEntries(saved);

    if(saved.entries && saved.entries.length){
      saved.entries.forEach(entry=>{
        const wrap = document.createElement('div');
        wrap.className = 'entrySwipe';
        wrap.dataset.id = entry.id || '';

        const actions = document.createElement('div');
        actions.className = 'entryActions';

        const delBtn = document.createElement('button');
        delBtn.className = 'entryDeleteBtn';
        delBtn.type = 'button';
        delBtn.innerHTML = `<span class="icon">🗑️</span><span class="label">削除</span>`;
        delBtn.onclick = (ev) => {
          ev.stopPropagation();
          deleteEntryById(entry.id, wrap);
        };
        actions.appendChild(delBtn);

        const content = document.createElement('div');
        content.className = 'entryContent';

        const time = document.createElement('span');
        time.className = 'time';
        time.textContent = (entry.time && entry.time.trim()) ? entry.time : '•';

        const text = document.createElement('span');
        text.className = 'text';
        text.textContent = entry.text || '';

        content.appendChild(time);
        content.appendChild(text);

        if (entry.photoId) {
          const img = document.createElement('img');
          img.className = 'entryPhoto';
          img.alt = 'photo';
          img.loading = 'lazy';
          content.appendChild(img);
          renderEntryPhoto(img, entry.photoId);
        }

        if (entry.fileName) {
          const fileLine = document.createElement('div');
          fileLine.className = 'fileLine';
          fileLine.textContent = `📎 ${entry.fileName}`;
          content.appendChild(fileLine);
        }

        attachSwipeHandlers(wrap, content);

        content.addEventListener('click', async () => {
          if (wrap.classList.contains('open')) {
            wrap.classList.remove('open');
            openSwipeId = null;
            return;
          }
          if (swipeLock.moved) return;
          await beginEditById(entry.id);
        });

        wrap.appendChild(actions);
        wrap.appendChild(content);
        entriesDiv.appendChild(wrap);
      });
    } else {
      entriesDiv.innerHTML = '<div class="emptyState">この日はまだ記録がありません</div>';
    }
  }

  /* =======================
     View Switch
  ======================= */
  const toggleBtn = byId('toggleBtn');
  const calEl = byId('calendar');
  const weekBarEl = byId('weekBar');

  function updateToggleLabel(){
    if (!toggleBtn) return;
    toggleBtn.textContent = (viewMode === 'week') ? '月' : '週';
    toggleBtn.title = (viewMode === 'week') ? '月表示へ' : '週表示へ';
  }

  async function showWeek(){
    viewMode = 'week';
    calEl?.classList.add('hidden');
    if (weekBarEl) weekBarEl.style.display = 'grid';
    renderWeekBar(currentDate);
    await loadDay(currentDate);
    updateToggleLabel();
  }

  async function showMonth(){
    viewMode = 'month';
    calEl?.classList.remove('hidden');
    if (weekBarEl) weekBarEl.style.display = 'none';
    generateCalendar();
    await loadDay(currentDate);
    updateToggleLabel();
  }

  if (toggleBtn) {
    toggleBtn.onclick = () => (viewMode === 'week') ? showMonth() : showWeek();
  }

  /* =======================
     Input Bar / Attachments / Edit / Save / Settings
     ※あなたの現行コードと同じなので、ここはこの後に足す形でOK
     （もし今エラーを潰すのが最優先なら、まずはここまででDB_NAME問題を消す）
  ======================= */

  // --- ここから下は “あなたが貼ってくれた残り全部” をそのまま続けてOK ---
  // ただし「const DB_NAME / DB_VER / dbPromise / openDB」の再宣言は絶対しないこと。

  /* init */
  (async () => {
    generateCalendar();
    await showWeek();
    // refreshTimeHint/startTimeTicker/applyTimeStepToUI はあなたの残りのコード内にある前提
    // もし未定義なら、残りの部分を続けて貼ってあるかを確認してね。
    // openDB はこのファイル内にあるのでOK
    openDB().catch(()=>{});
  })();

})();
