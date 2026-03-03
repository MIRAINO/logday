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

/**
 * JPEGのEXIF(DateTimeOriginal/DateTime)を読む（最低限実装）
 * 取れなければ null
 */
function exifDateFromJpegArrayBuffer(buf){
  const dv = new DataView(buf);
  // JPEG SOI 0xFFD8
  if (dv.getUint16(0, false) !== 0xFFD8) return null;

  let offset = 2;
  const len = dv.byteLength;

  while (offset + 4 < len) {
    if (dv.getUint8(offset) !== 0xFF) break;
    const marker = dv.getUint8(offset + 1);
    const size = dv.getUint16(offset + 2, false);

    // APP1 (EXIF)
    if (marker === 0xE1) {
      const exifHeader = offset + 4;
      // "Exif\0\0"
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

      // TIFF固定値 0x002A
      if (get16(tiffStart + 2) !== 0x002A) return null;

      const ifd0Offset = get32(tiffStart + 4);
      let ifd0 = tiffStart + ifd0Offset;
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

      let dt = null;

      for (let i=0;i<numE;i++){
        const ent = exifIFD + 2 + i*12;
        const tag = get16(ent);

        // DateTimeOriginal(0x9003) / DateTime(0x0132)
        if (tag === 0x9003 || tag === 0x0132) {
          const type = get16(ent + 2); // 2=ASCII
          const count = get32(ent + 4);
          const valueOffset = get32(ent + 8);
          if (type !== 2 || count < 10) continue;

          const str = readAscii(valueOffset, count);
          if (!str) continue;

          // "YYYY:MM:DD HH:MM:SS"
          const m = str.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
          if (!m) continue;

          const y = +m[1], mo = +m[2]-1, da = +m[3], hh = +m[4], mm = +m[5], ss = +m[6];
          dt = new Date(y, mo, da, hh, mm, ss);
          break;
        }
      }
      return dt;
    }

    // 次のセグメントへ
    offset += 2 + size;
  }

  return null;
}

async function getShotDate(file){
  // JPEGだけEXIFを読む（.jpg/.jpeg or image/jpeg）
  const isJpeg = (file.type === 'image/jpeg') || /\.(jpe?g)$/i.test(file.name || '');
  if (isJpeg) {
    try{
      const buf = await file.arrayBuffer();
      const exifDate = exifDateFromJpegArrayBuffer(buf);
      if (exifDate && !isNaN(exifDate.getTime())) return exifDate;
    }catch(e){}
  }
  // フォールバック（HEICなど）
  const lm = file.lastModified ? new Date(file.lastModified) : null;
  if (lm && !isNaN(lm.getTime())) return lm;
  return null;
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
   - QuotaExceededの根本原因は「昔の data:image/... がlocalStorageに残ってる」こと
   - 表示/編集を壊さず、見つけ次第IDBへ移して localStorage から削除する
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
      await idbPutPhoto({ id: pid, blob, mime: blob.type || 'image/jpeg', name: 'photo.jpg', createdAt: e.createdAt || Date.now() });

      e.photoId = pid;
      delete e.photo; // ← localStorageから巨大データを消す
      moved++;
      changed = true;
    }catch(err){
      console.warn('legacy migrate failed', err);
      // 失敗したら最悪でも容量確保のため削る（表示は消えるが保存は復帰する）
      delete e.photo;
      changed = true;
    }
  }

  if (changed) {
    // 小さくなるので通る可能性が高い
    window.saveDayData(dateKey, dayData);
  }
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
let isSaving = false;

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

// attachments
let pendingPhotos = []; // [{ id, url, name, shotAt, shotTime }]
let pendingFileName = '';
let editingPrevPhotoId = null; // 編集時の旧photoId（単一）

function revokePendingPhotoUrls(){
  for (const p of pendingPhotos) {
    if (p?.url) {
      try { URL.revokeObjectURL(p.url); } catch(e){}
    }
  }
  pendingPhotos = [];
}

/* =======================
   Header / Date / Calendar
======================= */
function renderNavDate(dateStr){
  const d = parseYMD(dateStr);
  const dateText = d.toLocaleDateString('ja-JP',{ year:'numeric', month:'2-digit', day:'2-digit' });
  const weekdayText = d.toLocaleDateString('ja-JP',{ weekday:'short' });
  byId('navDate').textContent = `${dateText}（${weekdayText}）`;
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
let swipeLock = { active:false, moved:false, id:null, startX:0, startY:0, currentX:0 };

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
  // まず「その日」に古い写真dataURLがあればIDBへ移してサイズを縮める
  await migrateLegacyPhotosForDay(dateStr);

  cleanupEntryObjectUrls();
  renderNavDate(dateStr);

  const entriesDiv = byId('entries');
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
  toggleBtn.textContent = (viewMode === 'week') ? '月' : '週';
  toggleBtn.title = (viewMode === 'week') ? '月表示へ' : '週表示へ';
}
async function showWeek(){
  viewMode = 'week';
  calEl.classList.add('hidden');
  weekBarEl.style.display = 'grid';
  renderWeekBar(currentDate);
  await loadDay(currentDate);
  updateToggleLabel();
}
async function showMonth(){
  viewMode = 'month';
  calEl.classList.remove('hidden');
  weekBarEl.style.display = 'none';
  generateCalendar();
  await loadDay(currentDate);
  updateToggleLabel();
}
toggleBtn.onclick = () => (viewMode === 'week') ? showMonth() : showWeek();

/* =======================
   Input Bar
======================= */
const inputBar = byId('inputBar');
const plusBtn  = byId('plusBtn');
const logInput = byId('logInput');
const saveBtn  = byId('saveBtn');

const timeHint  = byId('timeHint');
const logTimeEl = byId('logTime');

const fileInputEl = byId('fileInput');
const photoEl     = byId('pickPhotoInput');
const cameraEl    = byId('takePhotoInput');
const previewArea = byId('previewArea');

function expandInputBar(){ inputBar.classList.add('expanded'); }
function collapseInputBar(){ inputBar.classList.remove('expanded'); }
function setPreviewVisible(isOn){ previewArea.classList.toggle('hasContent', !!isOn); }

function refreshTimeHint(){
  if (timeMode === 'set' && selectedTime) {
    timeHint.textContent = selectedTime;
    timeHint.className = 'isSet';
    return;
  }
  timeHint.textContent = nowHHMM();
  timeHint.className = 'isAuto';
}
function applyTimeStepToUI(stepMin){
  timeStepMin = stepMin;
  logTimeEl.step = String(stepMin * 60);
}

function startTimeTicker(){
  if (timeTicker) return;

  timeTicker = setInterval(async () => {
    if (timeMode === 'auto') refreshTimeHint();

    const nowKey = formatYMD(new Date());
    if (nowKey !== todayKey) {
      const prevKey = todayKey;
      todayKey = nowKey;

      if (currentDate === prevKey) {
        currentDate = nowKey;
        await loadDay(currentDate);
        renderWeekBar(currentDate);
        generateCalendar();
        showToast("日付が変わりました");
      }
    }
  }, 1000);
}

/* time picker */
logTimeEl.addEventListener('pointerdown', () => {
  if (!logTimeEl.value) logTimeEl.value = nowHHMM();
}, { passive:true });

logTimeEl.addEventListener('input', () => {
  tempTime = logTimeEl.value || '';
  if (tempTime) {
    timeHint.textContent = tempTime;
    timeHint.className = 'isSet';
  } else {
    refreshTimeHint();
  }
}, { passive:true });

function commitTimeFromPicker(){
  const raw = logTimeEl.value || '';
  const rounded = raw ? roundTimeToStep(raw, timeStepMin) : '';
  logTimeEl.value = rounded;
  selectedTime = rounded;
  timeMode = selectedTime ? 'set' : 'auto';
  tempTime = '';
  refreshTimeHint();
  expandInputBar();
}
logTimeEl.addEventListener('blur', commitTimeFromPicker, { passive:true });
logTimeEl.addEventListener('change', commitTimeFromPicker, { passive:true });

logInput.addEventListener('focus', () => expandInputBar());

logInput.addEventListener('beforeinput', () => {
  if (!inputBar.classList.contains('expanded')) expandInputBar();
});

logInput.addEventListener('blur', () => setTimeout(() => collapseInputBar(), 80));

document.addEventListener('pointerdown', (e) => {
  if (document.activeElement !== logInput) return;
  if (inputBar.contains(e.target)) return;
  logInput.blur();
  editingId = null;
}, { passive:true });

/* =======================
   Plus Sheet (inert only + focus restore)
======================= */
const plusSheet = byId('plusSheet');
const plusSheetBackdrop = byId('plusSheetBackdrop');
const actPhoto = byId('actPhoto');
const actCamera= byId('actCamera');
const actFile  = byId('actFile');
const actCancel= byId('actCancel');

let lastFocusEl = null;

function openPlusSheet(){
  lastFocusEl = document.activeElement;
  plusSheet.classList.add('open');
  plusSheet.removeAttribute('inert');
  requestAnimationFrame(() => actPhoto?.focus({ preventScroll:true }));
}
function closePlusSheet(){
  const ae = document.activeElement;
  if (ae && plusSheet.contains(ae) && typeof ae.blur === 'function') ae.blur();
  plusSheet.setAttribute('inert','');
  plusSheet.classList.remove('open');

  const back = lastFocusEl || plusBtn;
  requestAnimationFrame(() => back?.focus?.({ preventScroll:true }));
}

plusBtn.onclick = openPlusSheet;
plusSheetBackdrop.onclick = closePlusSheet;
actCancel.onclick = closePlusSheet;

actPhoto.onclick = () => { closePlusSheet(); photoEl.click(); };
actCamera.onclick= () => { closePlusSheet(); cameraEl.click(); };
actFile.onclick  = () => { closePlusSheet(); fileInputEl.click(); };

/* =======================
   Attachments (photo -> IDB)
======================= */
function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function imageFileToCompressedDataURL(file, maxSide = 1280, quality = 0.68){
  const dataUrl = await fileToDataURL(file);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, nw, nh);

  return canvas.toDataURL('image/jpeg', quality);
}

async function handleAttachment(input){
  // input: File か FileList(ArrayLike) を許容
  const files = (input && input.length != null) ? Array.from(input) : (input ? [input] : []);
  if (!files.length) return;

  previewArea.innerHTML = '';
  setPreviewVisible(false);

  // reset
  pendingFileName = '';
  revokePendingPhotoUrls();

  const images = files.filter(f => (f.type || '').startsWith('image/'));
  const nonImages = files.filter(f => !(f.type || '').startsWith('image/'));

  // 画像がある場合：複数処理
  if (images.length) {
    // 編集中は “1枚だけ” に制限（編集のUX崩壊を避ける）
    const targets = editingId ? [images[0]] : images;

    const grid = document.createElement('div');
    grid.className = 'thumbGrid';

    for (const file of targets) {
  const name = file.name || '';

  // ✅ 撮影日時（EXIF優先、無ければ lastModified）
  const shotDate = await getShotDate(file);
  const shotAt = shotDate ? shotDate.getTime() : Date.now();
  const shotTime = shotDate ? hhmmFromDate(shotDate) : '';

  const compressedDataUrl = await imageFileToCompressedDataURL(file, 1280, 0.68);
  const blob = await dataUrlToBlob(compressedDataUrl);

  const pid = "p_" + uid();

  // ✅ createdAt に撮影日時を入れる（ソート安定にも効く）
  await idbPutPhoto({
    id: pid,
    blob,
    mime: blob.type || 'image/jpeg',
    name,
    createdAt: shotAt
  });

  const url = URL.createObjectURL(blob);

  // ✅ pendingPhotos に shotAt/shotTime を保持
  pendingPhotos.push({ id: pid, url, name, shotAt, shotTime });

  const img = document.createElement('img');
  img.src = url;
  img.alt = 'attachment';
  grid.appendChild(img);
}

    previewArea.appendChild(grid);

    const meta = document.createElement('div');
    meta.className = 'thumbMeta';
    meta.textContent = `${pendingPhotos.length}枚の写真を選択`;
    previewArea.appendChild(meta);

    setPreviewVisible(true);
    expandInputBar();
    logInput.focus();
    return;
  }

  // 非画像：従来通り（複数来たら先頭だけ扱う）
  if (nonImages.length) {
    pendingFileName = nonImages[0].name || '';
    previewArea.innerHTML = `<div class="filePreview">📎 ${pendingFileName}</div>`;
    setPreviewVisible(true);
    expandInputBar();
    logInput.focus();
  }
}

[fileInputEl, photoEl, cameraEl].forEach(inp => {
  inp.addEventListener('change', (e) => {
    const fl = e.target.files;
    handleAttachment(fl);
    e.target.value = '';
  });
});

/* =======================
   Edit  (pendingPhotos版)
======================= */
async function beginEditEntry(entry){
  editingId = entry.id;

  expandInputBar();
  logInput.value = entry.text || "";

  // time
  if (!entry.time) {
    timeMode = 'auto';
    selectedTime = '';
    logTimeEl.value = '';
  } else {
    timeMode = 'set';
    selectedTime = entry.time;
    logTimeEl.value = entry.time;
  }
  refreshTimeHint();

  // 添付を一旦リセット
  pendingFileName = '';
  revokePendingPhotoUrls();

  // 「この編集対象が元々持っている写真ID」を保持
  editingPrevPhotoId = entry.photoId || null;

  previewArea.innerHTML = '';
  setPreviewVisible(false);

  // 写真があれば：編集では1枚のみ（= pendingPhotos に1件入れておく）
  if (entry.photoId) {
    const rec = await idbGetPhoto(entry.photoId);
    if (rec && rec.blob) {
      const url = URL.createObjectURL(rec.blob);

      pendingPhotos = [{
        id: entry.photoId,
        url,
        name: rec.name || 'photo',
        shotAt: rec.createdAt || (entry.createdAt ?? Date.now()),
        shotTime: entry.time || ''
      }];

      const grid = document.createElement('div');
      grid.className = 'thumbGrid';

      const img = document.createElement('img');
      img.src = url;
      img.alt = 'attachment';
      grid.appendChild(img);

      previewArea.appendChild(grid);

      const meta = document.createElement('div');
      meta.className = 'thumbMeta';
      meta.textContent = `編集中：写真 1枚`;
      previewArea.appendChild(meta);

      setPreviewVisible(true);
    }
  } else if (entry.fileName) {
    // 非画像（名前だけ）
    pendingFileName = entry.fileName || '';
    previewArea.innerHTML = `<div class="filePreview">📎 ${pendingFileName}</div>`;
    setPreviewVisible(true);
  }

  setTimeout(()=>logInput.focus(), 0);
  showToast('編集モード');
}

async function beginEditById(entryId){
  const dayData = getDayData(currentDate);
  const entry = (dayData.entries || []).find(e => e.id === entryId);
  if (!entry) { showToast('編集対象が見つからない…'); return; }
  await beginEditEntry(entry);
}

/* =======================
   Save
======================= */
saveBtn.onclick = async () => {
  if (isSaving) return;
  isSaving = true;

  try {
    await migrateLegacyPhotosForDay(currentDate);

    const text = logInput.value.trim();

    let time = '';
    if (timeMode === 'set') {
      time = roundTimeToStep(selectedTime, timeStepMin) || selectedTime || '';
      selectedTime = time;
      logTimeEl.value = time;
      if (!time) timeMode = 'auto';
    }
    if (timeMode === 'auto') time = nowHHMM();

    const hasPhoto = pendingPhotos.length > 0;
    const hasFileName = !!pendingFileName && !hasPhoto;

    if (!text && !hasPhoto && !hasFileName) {
      collapseInputBar();
      logInput.blur();
      return;
    }

    const dayData = getDayData(currentDate);

    const baseText =
      text || (hasPhoto ? '📷 写真' : (hasFileName ? `📎 ${pendingFileName}` : ''));

    if (editingId) {
      // ✅ 編集：写真は「差し替えない限り維持」
      // 編集開始時点で pendingPhotos に元写真を入れてるので、
      // 差し替え判定は「IDが変わったか」で見る
      const nextPhotoId = hasPhoto ? (pendingPhotos[0].id || null) : null;

      const newPayload = {
        time,
        text: baseText,
        photoId: nextPhotoId,
        fileName: hasFileName ? pendingFileName : null
      };

      const prevId = editingPrevPhotoId;
      const nextId = newPayload.photoId;

      const idx = dayData.entries.findIndex(e => e.id === editingId);
      if (idx >= 0) {
        dayData.entries[idx] = { ...dayData.entries[idx], ...newPayload };
        showToast('更新しました');
      } else {
        dayData.entries.push({ id: uid(), createdAt: Date.now(), ...newPayload });
        showToast('追加しました');
      }

      // ✅ 旧写真の削除は「差し替えた時だけ」
      const replaced = !!prevId && !!nextId && (prevId !== nextId);
      if (replaced) {
        try { await idbDeletePhoto(prevId); } catch(e){ console.warn(e); }
      }

    } else {
      // ✅ 新規：複数写真ならまとめて追加
      if (hasPhoto) {
        for (const p of pendingPhotos) {
          const t = p.shotTime || time;
          dayData.entries.push({
            id: uid(),
            createdAt: p.shotAt || Date.now(),
            time: t,
            text: baseText || '📷 写真',
            photoId: p.id,
            fileName: null
          });
        }
        showToast(`${pendingPhotos.length}枚 保存しました`);
      } else {
        // 画像なし：従来通り1件
        dayData.entries.push({
          id: uid(),
          createdAt: Date.now(),
          time,
          text: baseText,
          photoId: null,
          fileName: hasFileName ? pendingFileName : null
        });
        showToast('保存しました');
      }
    }

    sortEntries(dayData);

    const ok = window.saveDayData(currentDate, dayData);
    if (!ok) return;

    await loadDay(currentDate);

    // reset
    editingId = null;
    editingPrevPhotoId = null;

    logInput.value = '';
    previewArea.innerHTML = '';
    setPreviewVisible(false);

    pendingFileName = '';
    revokePendingPhotoUrls();

    timeMode = 'auto';
    selectedTime = '';
    logTimeEl.value = '';
    refreshTimeHint();

    collapseInputBar();
    logInput.blur();

  } finally {
    setTimeout(() => { isSaving = false; }, 160);
  }
};

/* =======================
   Settings Modal (inert only)
======================= */
const settingsBtn = byId('settingsBtn');
const settingsModal = byId('settingsModal');
const closeSettings = byId('closeSettings');
const settingsBackdrop = byId('settingsBackdrop');

let lastFocusSettings = null;

function openSettings(){
  lastFocusSettings = document.activeElement;
  settingsModal.classList.add('open');
  settingsModal.removeAttribute('inert');
  requestAnimationFrame(() => closeSettings.focus({ preventScroll:true }));
}
function closeSettingsModal(){
  const ae = document.activeElement;
  if (ae && settingsModal.contains(ae) && typeof ae.blur === 'function') ae.blur();

  settingsModal.setAttribute('inert','');
  settingsModal.classList.remove('open');

  const back = lastFocusSettings || settingsBtn;
  requestAnimationFrame(() => back?.focus?.({ preventScroll:true }));
}
settingsBtn.onclick = openSettings;
closeSettings.onclick = closeSettingsModal;
settingsBackdrop.onclick = closeSettingsModal;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsModal.classList.contains('open')) closeSettingsModal();
});

/* export/import */
byId('exportLogday').onclick = () => {
  const out = {};
  for (const k of Object.keys(localStorage)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) out[k] = JSON.parse(localStorage.getItem(k));
  }
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `logday-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
};

/* 容量回復：全日付の「旧photo(dataURL)」をIDBに移す */
async function cleanupAllLegacyPhotos(){
  const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
  const keys = Object.keys(localStorage).filter(k => dateKeyRe.test(k));

  let moved = 0;
  let changedDays = 0;

  for (const k of keys) {
    const r = await migrateLegacyPhotosForDay(k);
    if (r.changed) changedDays++;
    moved += r.moved || 0;
  }
  showToast(`容量回復: ${changedDays}日 / 移行${moved}枚`);
}

const cleanupBtn = byId('cleanupStorage');
if (cleanupBtn){
  cleanupBtn.onclick = async () => {
    if (!confirm('容量を回復するよ。\n「古い形式の写真(dataURL)」をIndexedDBへ移行して、保存エラーを直す。\n\n実行する？')) return;
    await cleanupAllLegacyPhotos();
  };
}

/* time step */
const timeStepBtn = byId('timeStepBtn');
function refreshTimeStepLabel(){
  if (!timeStepBtn) return;
  timeStepBtn.textContent = (timeStepMin === 1) ? '分刻み：1分' : '分刻み：10分';
}
if (timeStepBtn){
  refreshTimeStepLabel();
  timeStepBtn.onclick = () => {
    const next = (timeStepMin === 10) ? 1 : 10;
    setTimeStepMin(next);
    refreshTimeStepLabel();
  };
}

/* import */
(() => {
  const input = byId('importFile');
  const handler = async () => {
    const file = input.files && input.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
      const dateKeys = Object.keys(data || {}).filter(k => dateKeyRe.test(k));
      if (dateKeys.length === 0) { showToast("バックアップ形式が違うかも"); return; }

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
})();

/* top shadow */
(() => {
  const topSticky = byId('topSticky');
  const TH = 6;
  const onScroll = () => topSticky.classList.toggle('isScrolled', window.scrollY > TH);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

      
/* init */
(async () => {
  generateCalendar();
  await showWeek();            // ←ここが重要
  refreshTimeHint();
  startTimeTicker();
  applyTimeStepToUI(timeStepMin);
  openDB().catch(()=>{});
})();      for (let i=0;i<num0;i++){
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

      let dt = null;

      for (let i=0;i<numE;i++){
        const ent = exifIFD + 2 + i*12;
        const tag = get16(ent);

        // DateTimeOriginal(0x9003) / DateTime(0x0132)
        if (tag === 0x9003 || tag === 0x0132) {
          const type = get16(ent + 2); // 2=ASCII
          const count = get32(ent + 4);
          const valueOffset = get32(ent + 8);
          if (type !== 2 || count < 10) continue;

          const str = readAscii(valueOffset, count);
          if (!str) continue;

          // "YYYY:MM:DD HH:MM:SS"
          const m = str.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
          if (!m) continue;

          const y = +m[1], mo = +m[2]-1, da = +m[3], hh = +m[4], mm = +m[5], ss = +m[6];
          dt = new Date(y, mo, da, hh, mm, ss);
          break;
        }
      }
      return dt;
    }

    // 次のセグメントへ
    offset += 2 + size;
  }

  return null;
}

async function getShotDate(file){
  // JPEGだけEXIFを読む（.jpg/.jpeg or image/jpeg）
  const isJpeg = (file.type === 'image/jpeg') || /\.(jpe?g)$/i.test(file.name || '');
  if (isJpeg) {
    try{
      const buf = await file.arrayBuffer();
      const exifDate = exifDateFromJpegArrayBuffer(buf);
      if (exifDate && !isNaN(exifDate.getTime())) return exifDate;
    }catch(e){}
  }
  // フォールバック（HEICなど）
  const lm = file.lastModified ? new Date(file.lastModified) : null;
  if (lm && !isNaN(lm.getTime())) return lm;
  return null;
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
   - QuotaExceededの根本原因は「昔の data:image/... がlocalStorageに残ってる」こと
   - 表示/編集を壊さず、見つけ次第IDBへ移して localStorage から削除する
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
      await idbPutPhoto({ id: pid, blob, mime: blob.type || 'image/jpeg', name: 'photo.jpg', createdAt: e.createdAt || Date.now() });

      e.photoId = pid;
      delete e.photo; // ← localStorageから巨大データを消す
      moved++;
      changed = true;
    }catch(err){
      console.warn('legacy migrate failed', err);
      // 失敗したら最悪でも容量確保のため削る（表示は消えるが保存は復帰する）
      delete e.photo;
      changed = true;
    }
  }

  if (changed) {
    // 小さくなるので通る可能性が高い
    window.saveDayData(dateKey, dayData);
  }
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
let isSaving = false;

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

// attachments
let pendingPhotos = []; // [{ id, url, name, shotAt, shotTime }]
let pendingFileName = '';
let editingPrevPhotoId = null; // 編集時の旧photoId（単一）

function revokePendingPhotoUrls(){
  for (const p of pendingPhotos) {
    if (p?.url) {
      try { URL.revokeObjectURL(p.url); } catch(e){}
    }
  }
  pendingPhotos = [];
}

/* =======================
   Header / Date / Calendar
======================= */
function renderNavDate(dateStr){
  const d = parseYMD(dateStr);
  const dateText = d.toLocaleDateString('ja-JP',{ year:'numeric', month:'2-digit', day:'2-digit' });
  const weekdayText = d.toLocaleDateString('ja-JP',{ weekday:'short' });
  byId('navDate').textContent = `${dateText}（${weekdayText}）`;
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
let swipeLock = { active:false, moved:false, id:null, startX:0, startY:0, currentX:0 };

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
  // まず「その日」に古い写真dataURLがあればIDBへ移してサイズを縮める
  await migrateLegacyPhotosForDay(dateStr);

  cleanupEntryObjectUrls();
  renderNavDate(dateStr);

  const entriesDiv = byId('entries');
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
  toggleBtn.textContent = (viewMode === 'week') ? '月' : '週';
  toggleBtn.title = (viewMode === 'week') ? '月表示へ' : '週表示へ';
}
async function showWeek(){
  viewMode = 'week';
  calEl.classList.add('hidden');
  weekBarEl.style.display = 'grid';
  renderWeekBar(currentDate);
  await loadDay(currentDate);
  updateToggleLabel();
}
async function showMonth(){
  viewMode = 'month';
  calEl.classList.remove('hidden');
  weekBarEl.style.display = 'none';
  generateCalendar();
  await loadDay(currentDate);
  updateToggleLabel();
}
toggleBtn.onclick = () => (viewMode === 'week') ? showMonth() : showWeek();

/* =======================
   Input Bar
======================= */
const inputBar = byId('inputBar');
const plusBtn  = byId('plusBtn');
const logInput = byId('logInput');
const saveBtn  = byId('saveBtn');

const timeHint  = byId('timeHint');
const logTimeEl = byId('logTime');

const fileInputEl = byId('fileInput');
const photoEl     = byId('pickPhotoInput');
const cameraEl    = byId('takePhotoInput');
const previewArea = byId('previewArea');

function expandInputBar(){ inputBar.classList.add('expanded'); }
function collapseInputBar(){ inputBar.classList.remove('expanded'); }
function setPreviewVisible(isOn){ previewArea.classList.toggle('hasContent', !!isOn); }

function refreshTimeHint(){
  if (timeMode === 'set' && selectedTime) {
    timeHint.textContent = selectedTime;
    timeHint.className = 'isSet';
    return;
  }
  timeHint.textContent = nowHHMM();
  timeHint.className = 'isAuto';
}
function applyTimeStepToUI(stepMin){
  timeStepMin = stepMin;
  logTimeEl.step = String(stepMin * 60);
}

function startTimeTicker(){
  if (timeTicker) return;

  timeTicker = setInterval(async () => {
    if (timeMode === 'auto') refreshTimeHint();

    const nowKey = formatYMD(new Date());
    if (nowKey !== todayKey) {
      const prevKey = todayKey;
      todayKey = nowKey;

      if (currentDate === prevKey) {
        currentDate = nowKey;
        await loadDay(currentDate);
        renderWeekBar(currentDate);
        generateCalendar();
        showToast("日付が変わりました");
      }
    }
  }, 1000);
}

/* time picker */
logTimeEl.addEventListener('pointerdown', () => {
  if (!logTimeEl.value) logTimeEl.value = nowHHMM();
}, { passive:true });

logTimeEl.addEventListener('input', () => {
  tempTime = logTimeEl.value || '';
  if (tempTime) {
    timeHint.textContent = tempTime;
    timeHint.className = 'isSet';
  } else {
    refreshTimeHint();
  }
}, { passive:true });

function commitTimeFromPicker(){
  const raw = logTimeEl.value || '';
  const rounded = raw ? roundTimeToStep(raw, timeStepMin) : '';
  logTimeEl.value = rounded;
  selectedTime = rounded;
  timeMode = selectedTime ? 'set' : 'auto';
  tempTime = '';
  refreshTimeHint();
  expandInputBar();
}
logTimeEl.addEventListener('blur', commitTimeFromPicker, { passive:true });
logTimeEl.addEventListener('change', commitTimeFromPicker, { passive:true });

logInput.addEventListener('focus', () => expandInputBar());

logInput.addEventListener('beforeinput', () => {
  if (!inputBar.classList.contains('expanded')) expandInputBar();
});

logInput.addEventListener('blur', () => setTimeout(() => collapseInputBar(), 80));

document.addEventListener('pointerdown', (e) => {
  if (document.activeElement !== logInput) return;
  if (inputBar.contains(e.target)) return;
  logInput.blur();
  editingId = null;
}, { passive:true });

/* =======================
   Plus Sheet (inert only + focus restore)
======================= */
const plusSheet = byId('plusSheet');
const plusSheetBackdrop = byId('plusSheetBackdrop');
const actPhoto = byId('actPhoto');
const actCamera= byId('actCamera');
const actFile  = byId('actFile');
const actCancel= byId('actCancel');

let lastFocusEl = null;

function openPlusSheet(){
  lastFocusEl = document.activeElement;
  plusSheet.classList.add('open');
  plusSheet.removeAttribute('inert');
  requestAnimationFrame(() => actPhoto?.focus({ preventScroll:true }));
}
function closePlusSheet(){
  const ae = document.activeElement;
  if (ae && plusSheet.contains(ae) && typeof ae.blur === 'function') ae.blur();
  plusSheet.setAttribute('inert','');
  plusSheet.classList.remove('open');

  const back = lastFocusEl || plusBtn;
  requestAnimationFrame(() => back?.focus?.({ preventScroll:true }));
}

plusBtn.onclick = openPlusSheet;
plusSheetBackdrop.onclick = closePlusSheet;
actCancel.onclick = closePlusSheet;

actPhoto.onclick = () => { closePlusSheet(); photoEl.click(); };
actCamera.onclick= () => { closePlusSheet(); cameraEl.click(); };
actFile.onclick  = () => { closePlusSheet(); fileInputEl.click(); };

/* =======================
   Attachments (photo -> IDB)
======================= */
function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function imageFileToCompressedDataURL(file, maxSide = 1280, quality = 0.68){
  const dataUrl = await fileToDataURL(file);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, nw, nh);

  return canvas.toDataURL('image/jpeg', quality);
}

async function handleAttachment(input){
  // input: File か FileList(ArrayLike) を許容
  const files = (input && input.length != null) ? Array.from(input) : (input ? [input] : []);
  if (!files.length) return;

  previewArea.innerHTML = '';
  setPreviewVisible(false);

  // reset
  pendingFileName = '';
  revokePendingPhotoUrls();

  const images = files.filter(f => (f.type || '').startsWith('image/'));
  const nonImages = files.filter(f => !(f.type || '').startsWith('image/'));

  // 画像がある場合：複数処理
  if (images.length) {
    // 編集中は “1枚だけ” に制限（編集のUX崩壊を避ける）
    const targets = editingId ? [images[0]] : images;

    const grid = document.createElement('div');
    grid.className = 'thumbGrid';

    for (const file of targets) {
  const name = file.name || '';

  // ✅ 撮影日時（EXIF優先、無ければ lastModified）
  const shotDate = await getShotDate(file);
  const shotAt = shotDate ? shotDate.getTime() : Date.now();
  const shotTime = shotDate ? hhmmFromDate(shotDate) : '';

  const compressedDataUrl = await imageFileToCompressedDataURL(file, 1280, 0.68);
  const blob = await dataUrlToBlob(compressedDataUrl);

  const pid = "p_" + uid();

  // ✅ createdAt に撮影日時を入れる（ソート安定にも効く）
  await idbPutPhoto({
    id: pid,
    blob,
    mime: blob.type || 'image/jpeg',
    name,
    createdAt: shotAt
  });

  const url = URL.createObjectURL(blob);

  // ✅ pendingPhotos に shotAt/shotTime を保持
  pendingPhotos.push({ id: pid, url, name, shotAt, shotTime });

  const img = document.createElement('img');
  img.src = url;
  img.alt = 'attachment';
  grid.appendChild(img);
}

    previewArea.appendChild(grid);

    const meta = document.createElement('div');
    meta.className = 'thumbMeta';
    meta.textContent = `${pendingPhotos.length}枚の写真を選択`;
    previewArea.appendChild(meta);

    setPreviewVisible(true);
    expandInputBar();
    logInput.focus();
    return;
  }

  // 非画像：従来通り（複数来たら先頭だけ扱う）
  if (nonImages.length) {
    pendingFileName = nonImages[0].name || '';
    previewArea.innerHTML = `<div class="filePreview">📎 ${pendingFileName}</div>`;
    setPreviewVisible(true);
    expandInputBar();
    logInput.focus();
  }
}

[fileInputEl, photoEl, cameraEl].forEach(inp => {
  inp.addEventListener('change', (e) => {
    const fl = e.target.files;
    handleAttachment(fl);
    e.target.value = '';
  });
});

/* =======================
   Edit  (pendingPhotos版)
======================= */
async function beginEditEntry(entry){
  editingId = entry.id;

  expandInputBar();
  logInput.value = entry.text || "";

  // time
  if (!entry.time) {
    timeMode = 'auto';
    selectedTime = '';
    logTimeEl.value = '';
  } else {
    timeMode = 'set';
    selectedTime = entry.time;
    logTimeEl.value = entry.time;
  }
  refreshTimeHint();

  // 添付を一旦リセット
  pendingFileName = '';
  revokePendingPhotoUrls();
  editingPrevPhotoId = entry.photoId || null;

  previewArea.innerHTML = '';
  setPreviewVisible(false);

  // 写真があれば：編集では1枚のみ
  if (entry.photoId) {
    const rec = await idbGetPhoto(entry.photoId);
    if (rec && rec.blob) {
      const url = URL.createObjectURL(rec.blob);

      // pendingPhotos に 1枚だけ入れる（編集は単一運用）
      pendingPhotos = [{
        id: entry.photoId,
        url,
        name: rec.name || 'photo',
        shotAt: rec.createdAt || (entry.createdAt ?? Date.now()),
        shotTime: entry.time || ''
      }];

      const grid = document.createElement('div');
      grid.className = 'thumbGrid';

      const img = document.createElement('img');
      img.src = url;
      img.alt = 'attachment';
      grid.appendChild(img);

      previewArea.appendChild(grid);

      const meta = document.createElement('div');
      meta.className = 'thumbMeta';
      meta.textContent = `編集中：写真 1枚`;
      previewArea.appendChild(meta);

      setPreviewVisible(true);
    } else {
      setPreviewVisible(false);
    }

  } else if (entry.fileName) {
    // ファイル名だけ（非画像）
    pendingFileName = entry.fileName || '';
    previewArea.innerHTML = `<div class="filePreview">📎 ${pendingFileName}</div>`;
    setPreviewVisible(true);
  }

  setTimeout(()=>logInput.focus(), 0);
  showToast('編集モード');
}

async function beginEditById(entryId){
  const dayData = getDayData(currentDate);
  const entry = (dayData.entries || []).find(e => e.id === entryId);
  if (!entry) { showToast('編集対象が見つからない…'); return; }
  await beginEditEntry(entry);
}

/* =======================
   Save
======================= */
saveBtn.onclick = async () => {
  if (isSaving) return;
  isSaving = true;

  try {
    await migrateLegacyPhotosForDay(currentDate);

    const text = logInput.value.trim();

    let time = '';
    if (timeMode === 'set') {
      time = roundTimeToStep(selectedTime, timeStepMin) || selectedTime || '';
      selectedTime = time;
      logTimeEl.value = time;
      if (!time) timeMode = 'auto';
    }
    if (timeMode === 'auto') time = nowHHMM();

    const hasPhoto = pendingPhotos.length > 0;
    const hasFileName = !!pendingFileName && !hasPhoto;

    if (!text && !hasPhoto && !hasFileName) {
      collapseInputBar();
      logInput.blur();
      return;
    }

    const dayData = getDayData(currentDate);

    const baseText =
      text || (hasPhoto ? '📷 写真' : (hasFileName ? `📎 ${pendingFileName}` : ''));

    // --- ここから追加ロジック ---
    if (editingId) {
  // 編集：写真を選び直してないなら元のphotoIdを維持
  const keepPhotoId = hasPhoto ? pendingPhotos[0].id : (editingPrevPhotoId || null);

  const newPayload = {
    time,
    text: baseText,
    photoId: keepPhotoId,
    fileName: hasFileName ? pendingFileName : null
  };

  const prevId = editingPrevPhotoId;
  const nextId = newPayload.photoId;

  const idx = dayData.entries.findIndex(e => e.id === editingId);
  if (idx >= 0) {
    dayData.entries[idx] = { ...dayData.entries[idx], ...newPayload };
    showToast('更新しました');
  } else {
    dayData.entries.push({ id: uid(), createdAt: Date.now(), ...newPayload });
    showToast('追加しました');
  }

  // 旧写真の削除は「写真を差し替えた時だけ」
  if (hasPhoto && prevId && prevId !== nextId) {
    try { await idbDeletePhoto(prevId); } catch(e){ console.warn(e); }
  }

} else {


      // 新規：複数写真ならまとめて追加
      if (hasPhoto) {
        for (const p of pendingPhotos) {
  const t = p.shotTime || time; // ✅ 写真の撮影時刻が取れたらそれを使う
  dayData.entries.push({
    id: uid(),
    createdAt: p.shotAt || Date.now(), // ✅ 撮影日時
    time: t,
    text: baseText || '📷 写真',
    photoId: p.id,
    fileName: null
  });
}
        showToast(`${pendingPhotos.length}枚 保存しました`);
      } else {
        // 画像なし：従来通り1件
        dayData.entries.push({
          id: uid(),
          createdAt: Date.now(),
          time,
          text: baseText,
          photoId: null,
          fileName: hasFileName ? pendingFileName : null
        });
        showToast('保存しました');
      }
    }
    // --- ここまで追加ロジック ---

    sortEntries(dayData);

    const ok = window.saveDayData(currentDate, dayData);
    if (!ok) return;

    await loadDay(currentDate);

    // reset
    editingId = null;
    editingPrevPhotoId = null;

    logInput.value = '';
    previewArea.innerHTML = '';
    setPreviewVisible(false);

    pendingFileName = '';
    revokePendingPhotoUrls(); // ← pendingPhotosのURLを全部revokeして pendingPhotosも空にする想定

    timeMode = 'auto';
    selectedTime = '';
    logTimeEl.value = '';
    refreshTimeHint();

    collapseInputBar();
    logInput.blur();

  } finally {
    setTimeout(() => { isSaving = false; }, 160);
  }
};

/* =======================
   Settings Modal (inert only)
======================= */
const settingsBtn = byId('settingsBtn');
const settingsModal = byId('settingsModal');
const closeSettings = byId('closeSettings');
const settingsBackdrop = byId('settingsBackdrop');

let lastFocusSettings = null;

function openSettings(){
  lastFocusSettings = document.activeElement;
  settingsModal.classList.add('open');
  settingsModal.removeAttribute('inert');
  requestAnimationFrame(() => closeSettings.focus({ preventScroll:true }));
}
function closeSettingsModal(){
  const ae = document.activeElement;
  if (ae && settingsModal.contains(ae) && typeof ae.blur === 'function') ae.blur();

  settingsModal.setAttribute('inert','');
  settingsModal.classList.remove('open');

  const back = lastFocusSettings || settingsBtn;
  requestAnimationFrame(() => back?.focus?.({ preventScroll:true }));
}
settingsBtn.onclick = openSettings;
closeSettings.onclick = closeSettingsModal;
settingsBackdrop.onclick = closeSettingsModal;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsModal.classList.contains('open')) closeSettingsModal();
});

/* export/import */
byId('exportLogday').onclick = () => {
  const out = {};
  for (const k of Object.keys(localStorage)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) out[k] = JSON.parse(localStorage.getItem(k));
  }
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `logday-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
};

/* 容量回復：全日付の「旧photo(dataURL)」をIDBに移す */
async function cleanupAllLegacyPhotos(){
  const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
  const keys = Object.keys(localStorage).filter(k => dateKeyRe.test(k));

  let moved = 0;
  let changedDays = 0;

  for (const k of keys) {
    const r = await migrateLegacyPhotosForDay(k);
    if (r.changed) changedDays++;
    moved += r.moved || 0;
  }
  showToast(`容量回復: ${changedDays}日 / 移行${moved}枚`);
}

const cleanupBtn = byId('cleanupStorage');
if (cleanupBtn){
  cleanupBtn.onclick = async () => {
    if (!confirm('容量を回復するよ。\n「古い形式の写真(dataURL)」をIndexedDBへ移行して、保存エラーを直す。\n\n実行する？')) return;
    await cleanupAllLegacyPhotos();
  };
}

/* time step */
const timeStepBtn = byId('timeStepBtn');
function refreshTimeStepLabel(){
  if (!timeStepBtn) return;
  timeStepBtn.textContent = (timeStepMin === 1) ? '分刻み：1分' : '分刻み：10分';
}
if (timeStepBtn){
  refreshTimeStepLabel();
  timeStepBtn.onclick = () => {
    const next = (timeStepMin === 10) ? 1 : 10;
    setTimeStepMin(next);
    refreshTimeStepLabel();
  };
}

/* import */
(() => {
  const input = byId('importFile');
  const handler = async () => {
    const file = input.files && input.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
      const dateKeys = Object.keys(data || {}).filter(k => dateKeyRe.test(k));
      if (dateKeys.length === 0) { showToast("バックアップ形式が違うかも"); return; }

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
})();

/* top shadow */
(() => {
  const topSticky = byId('topSticky');
  const TH = 6;
  const onScroll = () => topSticky.classList.toggle('isScrolled', window.scrollY > TH);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

      
/* init */
(async () => {
  generateCalendar();
  await showWeek();            // ←ここが重要
  refreshTimeHint();
  startTimeTicker();
  applyTimeStepToUI(timeStepMin);
  openDB().catch(()=>{});
})();      for (let i=0;i<num0;i++){
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

      let dt = null;

      for (let i=0;i<numE;i++){
        const ent = exifIFD + 2 + i*12;
        const tag = get16(ent);

        // DateTimeOriginal(0x9003) / DateTime(0x0132)
        if (tag === 0x9003 || tag === 0x0132) {
          const type = get16(ent + 2); // 2=ASCII
          const count = get32(ent + 4);
          const valueOffset = get32(ent + 8);
          if (type !== 2 || count < 10) continue;

          const str = readAscii(valueOffset, count);
          if (!str) continue;

          // "YYYY:MM:DD HH:MM:SS"
          const m = str.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
          if (!m) continue;

          const y = +m[1], mo = +m[2]-1, da = +m[3], hh = +m[4], mm = +m[5], ss = +m[6];
          dt = new Date(y, mo, da, hh, mm, ss);
          break;
        }
      }
      return dt;
    }

    // 次のセグメントへ
    offset += 2 + size;
  }

  return null;
}

async function getShotDate(file){
  // JPEGだけEXIFを読む（.jpg/.jpeg or image/jpeg）
  const isJpeg = (file.type === 'image/jpeg') || /\.(jpe?g)$/i.test(file.name || '');
  if (isJpeg) {
    try{
      const buf = await file.arrayBuffer();
      const exifDate = exifDateFromJpegArrayBuffer(buf);
      if (exifDate && !isNaN(exifDate.getTime())) return exifDate;
    }catch(e){}
  }
  // フォールバック（HEICなど）
  const lm = file.lastModified ? new Date(file.lastModified) : null;
  if (lm && !isNaN(lm.getTime())) return lm;
  return null;
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
   - QuotaExceededの根本原因は「昔の data:image/... がlocalStorageに残ってる」こと
   - 表示/編集を壊さず、見つけ次第IDBへ移して localStorage から削除する
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
      await idbPutPhoto({ id: pid, blob, mime: blob.type || 'image/jpeg', name: 'photo.jpg', createdAt: e.createdAt || Date.now() });

      e.photoId = pid;
      delete e.photo; // ← localStorageから巨大データを消す
      moved++;
      changed = true;
    }catch(err){
      console.warn('legacy migrate failed', err);
      // 失敗したら最悪でも容量確保のため削る（表示は消えるが保存は復帰する）
      delete e.photo;
      changed = true;
    }
  }

  if (changed) {
    // 小さくなるので通る可能性が高い
    window.saveDayData(dateKey, dayData);
  }
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
let isSaving = false;

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

// attachments
let pendingPhotos = []; // [{ id, url, name, shotAt, shotTime }]
let pendingFileName = '';
let editingPrevPhotoId = null; // 編集時の旧photoId（単一）

function revokePendingPhotoUrls(){
  for (const p of pendingPhotos) {
    if (p?.url) {
      try { URL.revokeObjectURL(p.url); } catch(e){}
    }
  }
  pendingPhotos = [];
}

/* =======================
   Header / Date / Calendar
======================= */
function renderNavDate(dateStr){
  const d = parseYMD(dateStr);
  const dateText = d.toLocaleDateString('ja-JP',{ year:'numeric', month:'2-digit', day:'2-digit' });
  const weekdayText = d.toLocaleDateString('ja-JP',{ weekday:'short' });
  byId('navDate').textContent = `${dateText}（${weekdayText}）`;
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
let swipeLock = { active:false, moved:false, id:null, startX:0, startY:0, currentX:0 };

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
  // まず「その日」に古い写真dataURLがあればIDBへ移してサイズを縮める
  await migrateLegacyPhotosForDay(dateStr);

  cleanupEntryObjectUrls();
  renderNavDate(dateStr);

  const entriesDiv = byId('entries');
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
  toggleBtn.textContent = (viewMode === 'week') ? '月' : '週';
  toggleBtn.title = (viewMode === 'week') ? '月表示へ' : '週表示へ';
}
async function showWeek(){
  viewMode = 'week';
  calEl.classList.add('hidden');
  weekBarEl.style.display = 'grid';
  renderWeekBar(currentDate);
  await loadDay(currentDate);
  updateToggleLabel();
}
async function showMonth(){
  viewMode = 'month';
  calEl.classList.remove('hidden');
  weekBarEl.style.display = 'none';
  generateCalendar();
  await loadDay(currentDate);
  updateToggleLabel();
}
toggleBtn.onclick = () => (viewMode === 'week') ? showMonth() : showWeek();

/* =======================
   Input Bar
======================= */
const inputBar = byId('inputBar');
const plusBtn  = byId('plusBtn');
const logInput = byId('logInput');
const saveBtn  = byId('saveBtn');

const timeHint  = byId('timeHint');
const logTimeEl = byId('logTime');

const fileInputEl = byId('fileInput');
const photoEl     = byId('pickPhotoInput');
const cameraEl    = byId('takePhotoInput');
const previewArea = byId('previewArea');

function expandInputBar(){ inputBar.classList.add('expanded'); }
function collapseInputBar(){ inputBar.classList.remove('expanded'); }
function setPreviewVisible(isOn){ previewArea.classList.toggle('hasContent', !!isOn); }

function refreshTimeHint(){
  if (timeMode === 'set' && selectedTime) {
    timeHint.textContent = selectedTime;
    timeHint.className = 'isSet';
    return;
  }
  timeHint.textContent = nowHHMM();
  timeHint.className = 'isAuto';
}
function applyTimeStepToUI(stepMin){
  timeStepMin = stepMin;
  logTimeEl.step = String(stepMin * 60);
}

function startTimeTicker(){
  if (timeTicker) return;

  timeTicker = setInterval(async () => {
    if (timeMode === 'auto') refreshTimeHint();

    const nowKey = formatYMD(new Date());
    if (nowKey !== todayKey) {
      const prevKey = todayKey;
      todayKey = nowKey;

      if (currentDate === prevKey) {
        currentDate = nowKey;
        await loadDay(currentDate);
        renderWeekBar(currentDate);
        generateCalendar();
        showToast("日付が変わりました");
      }
    }
  }, 1000);
}

/* time picker */
logTimeEl.addEventListener('pointerdown', () => {
  if (!logTimeEl.value) logTimeEl.value = nowHHMM();
}, { passive:true });

logTimeEl.addEventListener('input', () => {
  tempTime = logTimeEl.value || '';
  if (tempTime) {
    timeHint.textContent = tempTime;
    timeHint.className = 'isSet';
  } else {
    refreshTimeHint();
  }
}, { passive:true });

function commitTimeFromPicker(){
  const raw = logTimeEl.value || '';
  const rounded = raw ? roundTimeToStep(raw, timeStepMin) : '';
  logTimeEl.value = rounded;
  selectedTime = rounded;
  timeMode = selectedTime ? 'set' : 'auto';
  tempTime = '';
  refreshTimeHint();
  expandInputBar();
}
logTimeEl.addEventListener('blur', commitTimeFromPicker, { passive:true });
logTimeEl.addEventListener('change', commitTimeFromPicker, { passive:true });

logInput.addEventListener('focus', () => expandInputBar());

logInput.addEventListener('beforeinput', () => {
  if (!inputBar.classList.contains('expanded')) expandInputBar();
});

logInput.addEventListener('blur', () => setTimeout(() => collapseInputBar(), 80));

document.addEventListener('pointerdown', (e) => {
  if (document.activeElement !== logInput) return;
  if (inputBar.contains(e.target)) return;
  logInput.blur();
  editingId = null;
}, { passive:true });

/* =======================
   Plus Sheet (inert only + focus restore)
======================= */
const plusSheet = byId('plusSheet');
const plusSheetBackdrop = byId('plusSheetBackdrop');
const actPhoto = byId('actPhoto');
const actCamera= byId('actCamera');
const actFile  = byId('actFile');
const actCancel= byId('actCancel');

let lastFocusEl = null;

function openPlusSheet(){
  lastFocusEl = document.activeElement;
  plusSheet.classList.add('open');
  plusSheet.removeAttribute('inert');
  requestAnimationFrame(() => actPhoto?.focus({ preventScroll:true }));
}
function closePlusSheet(){
  const ae = document.activeElement;
  if (ae && plusSheet.contains(ae) && typeof ae.blur === 'function') ae.blur();
  plusSheet.setAttribute('inert','');
  plusSheet.classList.remove('open');

  const back = lastFocusEl || plusBtn;
  requestAnimationFrame(() => back?.focus?.({ preventScroll:true }));
}

plusBtn.onclick = openPlusSheet;
plusSheetBackdrop.onclick = closePlusSheet;
actCancel.onclick = closePlusSheet;

actPhoto.onclick = () => { closePlusSheet(); photoEl.click(); };
actCamera.onclick= () => { closePlusSheet(); cameraEl.click(); };
actFile.onclick  = () => { closePlusSheet(); fileInputEl.click(); };

/* =======================
   Attachments (photo -> IDB)
======================= */
function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function imageFileToCompressedDataURL(file, maxSide = 1280, quality = 0.68){
  const dataUrl = await fileToDataURL(file);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, nw, nh);

  return canvas.toDataURL('image/jpeg', quality);
}

async function handleAttachment(input){
  // input: File か FileList(ArrayLike) を許容
  const files = (input && input.length != null) ? Array.from(input) : (input ? [input] : []);
  if (!files.length) return;

  previewArea.innerHTML = '';
  setPreviewVisible(false);

  // reset
  pendingFileName = '';
  revokePendingPhotoUrls();

  const images = files.filter(f => (f.type || '').startsWith('image/'));
  const nonImages = files.filter(f => !(f.type || '').startsWith('image/'));

  // 画像がある場合：複数処理
  if (images.length) {
    // 編集中は “1枚だけ” に制限（編集のUX崩壊を避ける）
    const targets = editingId ? [images[0]] : images;

    const grid = document.createElement('div');
    grid.className = 'thumbGrid';

    for (const file of targets) {
  const name = file.name || '';

  // ✅ 撮影日時（EXIF優先、無ければ lastModified）
  const shotDate = await getShotDate(file);
  const shotAt = shotDate ? shotDate.getTime() : Date.now();
  const shotTime = shotDate ? hhmmFromDate(shotDate) : '';

  const compressedDataUrl = await imageFileToCompressedDataURL(file, 1280, 0.68);
  const blob = await dataUrlToBlob(compressedDataUrl);

  const pid = "p_" + uid();

  // ✅ createdAt に撮影日時を入れる（ソート安定にも効く）
  await idbPutPhoto({
    id: pid,
    blob,
    mime: blob.type || 'image/jpeg',
    name,
    createdAt: shotAt
  });

  const url = URL.createObjectURL(blob);

  // ✅ pendingPhotos に shotAt/shotTime を保持
  pendingPhotos.push({ id: pid, url, name, shotAt, shotTime });

  const img = document.createElement('img');
  img.src = url;
  img.alt = 'attachment';
  grid.appendChild(img);
}

    previewArea.appendChild(grid);

    const meta = document.createElement('div');
    meta.className = 'thumbMeta';
    meta.textContent = `${pendingPhotos.length}枚の写真を選択`;
    previewArea.appendChild(meta);

    setPreviewVisible(true);
    expandInputBar();
    logInput.focus();
    return;
  }

  // 非画像：従来通り（複数来たら先頭だけ扱う）
  if (nonImages.length) {
    pendingFileName = nonImages[0].name || '';
    previewArea.innerHTML = `<div class="filePreview">📎 ${pendingFileName}</div>`;
    setPreviewVisible(true);
    expandInputBar();
    logInput.focus();
  }
}

[fileInputEl, photoEl, cameraEl].forEach(inp => {
  inp.addEventListener('change', (e) => {
    const fl = e.target.files;
    handleAttachment(fl);
    e.target.value = '';
  });
});

/* =======================
   Edit  (pendingPhotos版)
======================= */
async function beginEditEntry(entry){
  editingId = entry.id;

  expandInputBar();
  logInput.value = entry.text || "";

  // time
  if (!entry.time) {
    timeMode = 'auto';
    selectedTime = '';
    logTimeEl.value = '';
  } else {
    timeMode = 'set';
    selectedTime = entry.time;
    logTimeEl.value = entry.time;
  }
  refreshTimeHint();

  // 添付を一旦リセット
  pendingFileName = '';
  revokePendingPhotoUrls();
  editingPrevPhotoId = entry.photoId || null;

  previewArea.innerHTML = '';
  setPreviewVisible(false);

  // 写真があれば：編集では1枚のみ
  if (entry.photoId) {
    const rec = await idbGetPhoto(entry.photoId);
    if (rec && rec.blob) {
      const url = URL.createObjectURL(rec.blob);

      // pendingPhotos に 1枚だけ入れる（編集は単一運用）
      pendingPhotos = [{
        id: entry.photoId,
        url,
        name: rec.name || 'photo',
        shotAt: rec.createdAt || (entry.createdAt ?? Date.now()),
        shotTime: entry.time || ''
      }];

      const grid = document.createElement('div');
      grid.className = 'thumbGrid';

      const img = document.createElement('img');
      img.src = url;
      img.alt = 'attachment';
      grid.appendChild(img);

      previewArea.appendChild(grid);

      const meta = document.createElement('div');
      meta.className = 'thumbMeta';
      meta.textContent = `編集中：写真 1枚`;
      previewArea.appendChild(meta);

      setPreviewVisible(true);
    } else {
      setPreviewVisible(false);
    }

  } else if (entry.fileName) {
    // ファイル名だけ（非画像）
    pendingFileName = entry.fileName || '';
    previewArea.innerHTML = `<div class="filePreview">📎 ${pendingFileName}</div>`;
    setPreviewVisible(true);
  }

  setTimeout(()=>logInput.focus(), 0);
  showToast('編集モード');
}

async function beginEditById(entryId){
  const dayData = getDayData(currentDate);
  const entry = (dayData.entries || []).find(e => e.id === entryId);
  if (!entry) { showToast('編集対象が見つからない…'); return; }
  await beginEditEntry(entry);
}

/* =======================
   Save
======================= */
saveBtn.onclick = async () => {
  if (isSaving) return;
  isSaving = true;

  try {
    await migrateLegacyPhotosForDay(currentDate);

    const text = logInput.value.trim();

    let time = '';
    if (timeMode === 'set') {
      time = roundTimeToStep(selectedTime, timeStepMin) || selectedTime || '';
      selectedTime = time;
      logTimeEl.value = time;
      if (!time) timeMode = 'auto';
    }
    if (timeMode === 'auto') time = nowHHMM();

    const hasPhoto = pendingPhotos.length > 0;
    const hasFileName = !!pendingFileName && !hasPhoto;

    if (!text && !hasPhoto && !hasFileName) {
      collapseInputBar();
      logInput.blur();
      return;
    }

    const dayData = getDayData(currentDate);

    const baseText =
      text || (hasPhoto ? '📷 写真' : (hasFileName ? `📎 ${pendingFileName}` : ''));

    // --- ここから追加ロジック ---
    if (editingId) {
      // 編集モードは1件更新（写真も1枚のみ運用）
      const newPayload = {
        time,
        text: baseText,
        photoId: hasPhoto ? pendingPhotos[0].id : null,
        fileName: hasFileName ? pendingFileName : null
      };

      const prevId = editingPrevPhotoId;
      const nextId = newPayload.photoId;

      const idx = dayData.entries.findIndex(e => e.id === editingId);
      if (idx >= 0) {
        dayData.entries[idx] = { ...dayData.entries[idx], ...newPayload };
        showToast('更新しました');
      } else {
        dayData.entries.push({ id: uid(), createdAt: Date.now(), ...newPayload });
        showToast('追加しました');
      }

      // 置換で旧写真が不要なら消す
      if (prevId && prevId !== nextId) {
        try { await idbDeletePhoto(prevId); } catch(e){ console.warn(e); }
      }

    } else {
      // 新規：複数写真ならまとめて追加
      if (hasPhoto) {
        for (const p of pendingPhotos) {
  const t = p.shotTime || time; // ✅ 写真の撮影時刻が取れたらそれを使う
  dayData.entries.push({
    id: uid(),
    createdAt: p.shotAt || Date.now(), // ✅ 撮影日時
    time: t,
    text: baseText || '📷 写真',
    photoId: p.id,
    fileName: null
  });
}
        showToast(`${pendingPhotos.length}枚 保存しました`);
      } else {
        // 画像なし：従来通り1件
        dayData.entries.push({
          id: uid(),
          createdAt: Date.now(),
          time,
          text: baseText,
          photoId: null,
          fileName: hasFileName ? pendingFileName : null
        });
        showToast('保存しました');
      }
    }
    // --- ここまで追加ロジック ---

    sortEntries(dayData);

    const ok = window.saveDayData(currentDate, dayData);
    if (!ok) return;

    await loadDay(currentDate);

    // reset
    editingId = null;
    editingPrevPhotoId = null;

    logInput.value = '';
    previewArea.innerHTML = '';
    setPreviewVisible(false);

    pendingFileName = '';
    revokePendingPhotoUrls(); // ← pendingPhotosのURLを全部revokeして pendingPhotosも空にする想定

    timeMode = 'auto';
    selectedTime = '';
    logTimeEl.value = '';
    refreshTimeHint();

    collapseInputBar();
    logInput.blur();

  } finally {
    setTimeout(() => { isSaving = false; }, 160);
  }
};

/* =======================
   Settings Modal (inert only)
======================= */
const settingsBtn = byId('settingsBtn');
const settingsModal = byId('settingsModal');
const closeSettings = byId('closeSettings');
const settingsBackdrop = byId('settingsBackdrop');

let lastFocusSettings = null;

function openSettings(){
  lastFocusSettings = document.activeElement;
  settingsModal.classList.add('open');
  settingsModal.removeAttribute('inert');
  requestAnimationFrame(() => closeSettings.focus({ preventScroll:true }));
}
function closeSettingsModal(){
  const ae = document.activeElement;
  if (ae && settingsModal.contains(ae) && typeof ae.blur === 'function') ae.blur();

  settingsModal.setAttribute('inert','');
  settingsModal.classList.remove('open');

  const back = lastFocusSettings || settingsBtn;
  requestAnimationFrame(() => back?.focus?.({ preventScroll:true }));
}
settingsBtn.onclick = openSettings;
closeSettings.onclick = closeSettingsModal;
settingsBackdrop.onclick = closeSettingsModal;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsModal.classList.contains('open')) closeSettingsModal();
});

/* export/import */
byId('exportLogday').onclick = () => {
  const out = {};
  for (const k of Object.keys(localStorage)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) out[k] = JSON.parse(localStorage.getItem(k));
  }
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `logday-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
};

/* 容量回復：全日付の「旧photo(dataURL)」をIDBに移す */
async function cleanupAllLegacyPhotos(){
  const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
  const keys = Object.keys(localStorage).filter(k => dateKeyRe.test(k));

  let moved = 0;
  let changedDays = 0;

  for (const k of keys) {
    const r = await migrateLegacyPhotosForDay(k);
    if (r.changed) changedDays++;
    moved += r.moved || 0;
  }
  showToast(`容量回復: ${changedDays}日 / 移行${moved}枚`);
}

const cleanupBtn = byId('cleanupStorage');
if (cleanupBtn){
  cleanupBtn.onclick = async () => {
    if (!confirm('容量を回復するよ。\n「古い形式の写真(dataURL)」をIndexedDBへ移行して、保存エラーを直す。\n\n実行する？')) return;
    await cleanupAllLegacyPhotos();
  };
}

/* time step */
const timeStepBtn = byId('timeStepBtn');
function refreshTimeStepLabel(){
  if (!timeStepBtn) return;
  timeStepBtn.textContent = (timeStepMin === 1) ? '分刻み：1分' : '分刻み：10分';
}
if (timeStepBtn){
  refreshTimeStepLabel();
  timeStepBtn.onclick = () => {
    const next = (timeStepMin === 10) ? 1 : 10;
    setTimeStepMin(next);
    refreshTimeStepLabel();
  };
}

/* import */
(() => {
  const input = byId('importFile');
  const handler = async () => {
    const file = input.files && input.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
      const dateKeys = Object.keys(data || {}).filter(k => dateKeyRe.test(k));
      if (dateKeys.length === 0) { showToast("バックアップ形式が違うかも"); return; }

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
})();

/* top shadow */
(() => {
  const topSticky = byId('topSticky');
  const TH = 6;
  const onScroll = () => topSticky.classList.toggle('isScrolled', window.scrollY > TH);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

      
/* init */
(async () => {
  generateCalendar();
  await showWeek();            // ←ここが重要
  refreshTimeHint();
  startTimeTicker();
  applyTimeStepToUI(timeStepMin);
  openDB().catch(()=>{});
})();      for (let i=0;i<num0;i++){
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

      let dt = null;

      for (let i=0;i<numE;i++){
        const ent = exifIFD + 2 + i*12;
        const tag = get16(ent);

        // DateTimeOriginal(0x9003) / DateTime(0x0132)
        if (tag === 0x9003 || tag === 0x0132) {
          const type = get16(ent + 2); // 2=ASCII
          const count = get32(ent + 4);
          const valueOffset = get32(ent + 8);
          if (type !== 2 || count < 10) continue;

          const str = readAscii(valueOffset, count);
          if (!str) continue;

          // "YYYY:MM:DD HH:MM:SS"
          const m = str.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
          if (!m) continue;

          const y = +m[1], mo = +m[2]-1, da = +m[3], hh = +m[4], mm = +m[5], ss = +m[6];
          dt = new Date(y, mo, da, hh, mm, ss);
          break;
        }
      }
      return dt;
    }

    // 次のセグメントへ
    offset += 2 + size;
  }

  return null;
}

async function getShotDate(file){
  // JPEGだけEXIFを読む（.jpg/.jpeg or image/jpeg）
  const isJpeg = (file.type === 'image/jpeg') || /\.(jpe?g)$/i.test(file.name || '');
  if (isJpeg) {
    try{
      const buf = await file.arrayBuffer();
      const exifDate = exifDateFromJpegArrayBuffer(buf);
      if (exifDate && !isNaN(exifDate.getTime())) return exifDate;
    }catch(e){}
  }
  // フォールバック（HEICなど）
  const lm = file.lastModified ? new Date(file.lastModified) : null;
  if (lm && !isNaN(lm.getTime())) return lm;
  return null;
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
   - QuotaExceededの根本原因は「昔の data:image/... がlocalStorageに残ってる」こと
   - 表示/編集を壊さず、見つけ次第IDBへ移して localStorage から削除する
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
      await idbPutPhoto({ id: pid, blob, mime: blob.type || 'image/jpeg', name: 'photo.jpg', createdAt: e.createdAt || Date.now() });

      e.photoId = pid;
      delete e.photo; // ← localStorageから巨大データを消す
      moved++;
      changed = true;
    }catch(err){
      console.warn('legacy migrate failed', err);
      // 失敗したら最悪でも容量確保のため削る（表示は消えるが保存は復帰する）
      delete e.photo;
      changed = true;
    }
  }

  if (changed) {
    // 小さくなるので通る可能性が高い
    window.saveDayData(dateKey, dayData);
  }
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
let isSaving = false;

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

// attachments
let pendingPhotos = []; // [{ id, url, name, shotAt, shotTime }]
let pendingFileName = '';
let editingPrevPhotoId = null; // 編集時の旧photoId（単一）

function revokePendingPhotoUrls(){
  for (const p of pendingPhotos) {
    if (p?.url) {
      try { URL.revokeObjectURL(p.url); } catch(e){}
    }
  }
  pendingPhotos = [];
}

/* =======================
   Header / Date / Calendar
======================= */
function renderNavDate(dateStr){
  const d = parseYMD(dateStr);
  const dateText = d.toLocaleDateString('ja-JP',{ year:'numeric', month:'2-digit', day:'2-digit' });
  const weekdayText = d.toLocaleDateString('ja-JP',{ weekday:'short' });
  byId('navDate').textContent = `${dateText}（${weekdayText}）`;
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
let swipeLock = { active:false, moved:false, id:null, startX:0, startY:0, currentX:0 };

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
  // まず「その日」に古い写真dataURLがあればIDBへ移してサイズを縮める
  await migrateLegacyPhotosForDay(dateStr);

  cleanupEntryObjectUrls();
  renderNavDate(dateStr);

  const entriesDiv = byId('entries');
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
  toggleBtn.textContent = (viewMode === 'week') ? '月' : '週';
  toggleBtn.title = (viewMode === 'week') ? '月表示へ' : '週表示へ';
}
async function showWeek(){
  viewMode = 'week';
  calEl.classList.add('hidden');
  weekBarEl.style.display = 'grid';
  renderWeekBar(currentDate);
  await loadDay(currentDate);
  updateToggleLabel();
}
async function showMonth(){
  viewMode = 'month';
  calEl.classList.remove('hidden');
  weekBarEl.style.display = 'none';
  generateCalendar();
  await loadDay(currentDate);
  updateToggleLabel();
}
toggleBtn.onclick = () => (viewMode === 'week') ? showMonth() : showWeek();

/* =======================
   Input Bar
======================= */
const inputBar = byId('inputBar');
const plusBtn  = byId('plusBtn');
const logInput = byId('logInput');
const saveBtn  = byId('saveBtn');

const timeHint  = byId('timeHint');
const logTimeEl = byId('logTime');

const fileInputEl = byId('fileInput');
const photoEl     = byId('pickPhotoInput');
const cameraEl    = byId('takePhotoInput');
const previewArea = byId('previewArea');

function expandInputBar(){ inputBar.classList.add('expanded'); }
function collapseInputBar(){ inputBar.classList.remove('expanded'); }
function setPreviewVisible(isOn){ previewArea.classList.toggle('hasContent', !!isOn); }

function refreshTimeHint(){
  if (timeMode === 'set' && selectedTime) {
    timeHint.textContent = selectedTime;
    timeHint.className = 'isSet';
    return;
  }
  timeHint.textContent = nowHHMM();
  timeHint.className = 'isAuto';
}
function applyTimeStepToUI(stepMin){
  timeStepMin = stepMin;
  logTimeEl.step = String(stepMin * 60);
}

function startTimeTicker(){
  if (timeTicker) return;

  timeTicker = setInterval(async () => {
    if (timeMode === 'auto') refreshTimeHint();

    const nowKey = formatYMD(new Date());
    if (nowKey !== todayKey) {
      const prevKey = todayKey;
      todayKey = nowKey;

      if (currentDate === prevKey) {
        currentDate = nowKey;
        await loadDay(currentDate);
        renderWeekBar(currentDate);
        generateCalendar();
        showToast("日付が変わりました");
      }
    }
  }, 1000);
}

/* time picker */
logTimeEl.addEventListener('pointerdown', () => {
  if (!logTimeEl.value) logTimeEl.value = nowHHMM();
}, { passive:true });

logTimeEl.addEventListener('input', () => {
  tempTime = logTimeEl.value || '';
  if (tempTime) {
    timeHint.textContent = tempTime;
    timeHint.className = 'isSet';
  } else {
    refreshTimeHint();
  }
}, { passive:true });

function commitTimeFromPicker(){
  const raw = logTimeEl.value || '';
  const rounded = raw ? roundTimeToStep(raw, timeStepMin) : '';
  logTimeEl.value = rounded;
  selectedTime = rounded;
  timeMode = selectedTime ? 'set' : 'auto';
  tempTime = '';
  refreshTimeHint();
  expandInputBar();
}
logTimeEl.addEventListener('blur', commitTimeFromPicker, { passive:true });
logTimeEl.addEventListener('change', commitTimeFromPicker, { passive:true });

logInput.addEventListener('focus', () => expandInputBar());

logInput.addEventListener('beforeinput', () => {
  if (!inputBar.classList.contains('expanded')) expandInputBar();
});

logInput.addEventListener('blur', () => setTimeout(() => collapseInputBar(), 80));

document.addEventListener('pointerdown', (e) => {
  if (document.activeElement !== logInput) return;
  if (inputBar.contains(e.target)) return;
  logInput.blur();
  editingId = null;
}, { passive:true });

/* =======================
   Plus Sheet (inert only + focus restore)
======================= */
const plusSheet = byId('plusSheet');
const plusSheetBackdrop = byId('plusSheetBackdrop');
const actPhoto = byId('actPhoto');
const actCamera= byId('actCamera');
const actFile  = byId('actFile');
const actCancel= byId('actCancel');

let lastFocusEl = null;

function openPlusSheet(){
  lastFocusEl = document.activeElement;
  plusSheet.classList.add('open');
  plusSheet.removeAttribute('inert');
  requestAnimationFrame(() => actPhoto?.focus({ preventScroll:true }));
}
function closePlusSheet(){
  const ae = document.activeElement;
  if (ae && plusSheet.contains(ae) && typeof ae.blur === 'function') ae.blur();
  plusSheet.setAttribute('inert','');
  plusSheet.classList.remove('open');

  const back = lastFocusEl || plusBtn;
  requestAnimationFrame(() => back?.focus?.({ preventScroll:true }));
}

plusBtn.onclick = openPlusSheet;
plusSheetBackdrop.onclick = closePlusSheet;
actCancel.onclick = closePlusSheet;

actPhoto.onclick = () => { closePlusSheet(); photoEl.click(); };
actCamera.onclick= () => { closePlusSheet(); cameraEl.click(); };
actFile.onclick  = () => { closePlusSheet(); fileInputEl.click(); };

/* =======================
   Attachments (photo -> IDB)
======================= */
function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function imageFileToCompressedDataURL(file, maxSide = 1280, quality = 0.68){
  const dataUrl = await fileToDataURL(file);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, nw, nh);

  return canvas.toDataURL('image/jpeg', quality);
}

async function handleAttachment(input){
  // input: File か FileList(ArrayLike) を許容
  const files = (input && input.length != null) ? Array.from(input) : (input ? [input] : []);
  if (!files.length) return;

  previewArea.innerHTML = '';
  setPreviewVisible(false);

  // reset
  pendingFileName = '';
  revokePendingPhotoUrls();

  const images = files.filter(f => (f.type || '').startsWith('image/'));
  const nonImages = files.filter(f => !(f.type || '').startsWith('image/'));

  // 画像がある場合：複数処理
  if (images.length) {
    // 編集中は “1枚だけ” に制限（編集のUX崩壊を避ける）
    const targets = editingId ? [images[0]] : images;

    const grid = document.createElement('div');
    grid.className = 'thumbGrid';

    for (const file of targets) {
  const name = file.name || '';

  // ✅ 撮影日時（EXIF優先、無ければ lastModified）
  const shotDate = await getShotDate(file);
  const shotAt = shotDate ? shotDate.getTime() : Date.now();
  const shotTime = shotDate ? hhmmFromDate(shotDate) : '';

  const compressedDataUrl = await imageFileToCompressedDataURL(file, 1280, 0.68);
  const blob = await dataUrlToBlob(compressedDataUrl);

  const pid = "p_" + uid();

  // ✅ createdAt に撮影日時を入れる（ソート安定にも効く）
  await idbPutPhoto({
    id: pid,
    blob,
    mime: blob.type || 'image/jpeg',
    name,
    createdAt: shotAt
  });

  const url = URL.createObjectURL(blob);

  // ✅ pendingPhotos に shotAt/shotTime を保持
  pendingPhotos.push({ id: pid, url, name, shotAt, shotTime });

  const img = document.createElement('img');
  img.src = url;
  img.alt = 'attachment';
  grid.appendChild(img);
}

    previewArea.appendChild(grid);

    const meta = document.createElement('div');
    meta.className = 'thumbMeta';
    meta.textContent = `${pendingPhotos.length}枚の写真を選択`;
    previewArea.appendChild(meta);

    setPreviewVisible(true);
    expandInputBar();
    logInput.focus();
    return;
  }

  // 非画像：従来通り（複数来たら先頭だけ扱う）
  if (nonImages.length) {
    pendingFileName = nonImages[0].name || '';
    previewArea.innerHTML = `<div class="filePreview">📎 ${pendingFileName}</div>`;
    setPreviewVisible(true);
    expandInputBar();
    logInput.focus();
  }
}

[fileInputEl, photoEl, cameraEl].forEach(inp => {
  inp.addEventListener('change', (e) => {
    const fl = e.target.files;
    handleAttachment(fl);
    e.target.value = '';
  });
});

/* =======================
   Edit
======================= */
async function beginEditEntry(entry){
  editingId = entry.id;

  expandInputBar();
  logInput.value = entry.text || "";

  if (!entry.time) {
    timeMode = 'auto';
    selectedTime = '';
    logTimeEl.value = '';
  } else {
    timeMode = 'set';
    selectedTime = entry.time;
    logTimeEl.value = entry.time;
  }
  refreshTimeHint();

  // 添付（写真はIDB）
  pendingName = entry.fileName || '';
  editingPrevPhotoId = entry.photoId || null;
  pendingPhotoId = entry.photoId || null;
  revokePendingPhotoUrl();

  previewArea.innerHTML = '';

  if (pendingPhotoId) {
    const rec = await idbGetPhoto(pendingPhotoId);
    if (rec && rec.blob) {
      const url = URL.createObjectURL(rec.blob);
      pendingPhotoUrl = url;

      const img = document.createElement('img');
      img.src = url;
      img.alt = 'attachment';
      previewArea.appendChild(img);
      setPreviewVisible(true);
    } else {
      setPreviewVisible(false);
    }
  } else if (pendingName) {
    previewArea.innerHTML = `<div class="filePreview">📎 ${pendingName}</div>`;
    setPreviewVisible(true);
  } else {
    setPreviewVisible(false);
  }

  setTimeout(()=>logInput.focus(), 0);
  showToast('編集モード');
}
async function beginEditById(entryId){
  const dayData = getDayData(currentDate);
  const entry = (dayData.entries || []).find(e => e.id === entryId);
  if (!entry) { showToast('編集対象が見つからない…'); return; }
  await beginEditEntry(entry);
}

/* =======================
   Save
======================= */
saveBtn.onclick = async () => {
  if (isSaving) return;
  isSaving = true;

  try {
    await migrateLegacyPhotosForDay(currentDate);

    const text = logInput.value.trim();

    let time = '';
    if (timeMode === 'set') {
      time = roundTimeToStep(selectedTime, timeStepMin) || selectedTime || '';
      selectedTime = time;
      logTimeEl.value = time;
      if (!time) timeMode = 'auto';
    }
    if (timeMode === 'auto') time = nowHHMM();

    const hasPhoto = pendingPhotos.length > 0;
    const hasFileName = !!pendingFileName && !hasPhoto;

    if (!text && !hasPhoto && !hasFileName) {
      collapseInputBar();
      logInput.blur();
      return;
    }

    const dayData = getDayData(currentDate);

    const baseText =
      text || (hasPhoto ? '📷 写真' : (hasFileName ? `📎 ${pendingFileName}` : ''));

    // --- ここから追加ロジック ---
    if (editingId) {
      // 編集モードは1件更新（写真も1枚のみ運用）
      const newPayload = {
        time,
        text: baseText,
        photoId: hasPhoto ? pendingPhotos[0].id : null,
        fileName: hasFileName ? pendingFileName : null
      };

      const prevId = editingPrevPhotoId;
      const nextId = newPayload.photoId;

      const idx = dayData.entries.findIndex(e => e.id === editingId);
      if (idx >= 0) {
        dayData.entries[idx] = { ...dayData.entries[idx], ...newPayload };
        showToast('更新しました');
      } else {
        dayData.entries.push({ id: uid(), createdAt: Date.now(), ...newPayload });
        showToast('追加しました');
      }

      // 置換で旧写真が不要なら消す
      if (prevId && prevId !== nextId) {
        try { await idbDeletePhoto(prevId); } catch(e){ console.warn(e); }
      }

    } else {
      // 新規：複数写真ならまとめて追加
      if (hasPhoto) {
        for (const p of pendingPhotos) {
  const t = p.shotTime || time; // ✅ 写真の撮影時刻が取れたらそれを使う
  dayData.entries.push({
    id: uid(),
    createdAt: p.shotAt || Date.now(), // ✅ 撮影日時
    time: t,
    text: baseText || '📷 写真',
    photoId: p.id,
    fileName: null
  });
}
        showToast(`${pendingPhotos.length}枚 保存しました`);
      } else {
        // 画像なし：従来通り1件
        dayData.entries.push({
          id: uid(),
          createdAt: Date.now(),
          time,
          text: baseText,
          photoId: null,
          fileName: hasFileName ? pendingFileName : null
        });
        showToast('保存しました');
      }
    }
    // --- ここまで追加ロジック ---

    sortEntries(dayData);

    const ok = window.saveDayData(currentDate, dayData);
    if (!ok) return;

    await loadDay(currentDate);

    // reset
    editingId = null;
    editingPrevPhotoId = null;

    logInput.value = '';
    previewArea.innerHTML = '';
    setPreviewVisible(false);

    pendingFileName = '';
    revokePendingPhotoUrls(); // ← pendingPhotosのURLを全部revokeして pendingPhotosも空にする想定

    timeMode = 'auto';
    selectedTime = '';
    logTimeEl.value = '';
    refreshTimeHint();

    collapseInputBar();
    logInput.blur();

  } finally {
    setTimeout(() => { isSaving = false; }, 160);
  }
};

/* =======================
   Settings Modal (inert only)
======================= */
const settingsBtn = byId('settingsBtn');
const settingsModal = byId('settingsModal');
const closeSettings = byId('closeSettings');
const settingsBackdrop = byId('settingsBackdrop');

let lastFocusSettings = null;

function openSettings(){
  lastFocusSettings = document.activeElement;
  settingsModal.classList.add('open');
  settingsModal.removeAttribute('inert');
  requestAnimationFrame(() => closeSettings.focus({ preventScroll:true }));
}
function closeSettingsModal(){
  const ae = document.activeElement;
  if (ae && settingsModal.contains(ae) && typeof ae.blur === 'function') ae.blur();

  settingsModal.setAttribute('inert','');
  settingsModal.classList.remove('open');

  const back = lastFocusSettings || settingsBtn;
  requestAnimationFrame(() => back?.focus?.({ preventScroll:true }));
}
settingsBtn.onclick = openSettings;
closeSettings.onclick = closeSettingsModal;
settingsBackdrop.onclick = closeSettingsModal;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsModal.classList.contains('open')) closeSettingsModal();
});

/* export/import */
byId('exportLogday').onclick = () => {
  const out = {};
  for (const k of Object.keys(localStorage)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) out[k] = JSON.parse(localStorage.getItem(k));
  }
  const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `logday-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
};

/* 容量回復：全日付の「旧photo(dataURL)」をIDBに移す */
async function cleanupAllLegacyPhotos(){
  const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
  const keys = Object.keys(localStorage).filter(k => dateKeyRe.test(k));

  let moved = 0;
  let changedDays = 0;

  for (const k of keys) {
    const r = await migrateLegacyPhotosForDay(k);
    if (r.changed) changedDays++;
    moved += r.moved || 0;
  }
  showToast(`容量回復: ${changedDays}日 / 移行${moved}枚`);
}

const cleanupBtn = byId('cleanupStorage');
if (cleanupBtn){
  cleanupBtn.onclick = async () => {
    if (!confirm('容量を回復するよ。\n「古い形式の写真(dataURL)」をIndexedDBへ移行して、保存エラーを直す。\n\n実行する？')) return;
    await cleanupAllLegacyPhotos();
  };
}

/* time step */
const timeStepBtn = byId('timeStepBtn');
function refreshTimeStepLabel(){
  if (!timeStepBtn) return;
  timeStepBtn.textContent = (timeStepMin === 1) ? '分刻み：1分' : '分刻み：10分';
}
if (timeStepBtn){
  refreshTimeStepLabel();
  timeStepBtn.onclick = () => {
    const next = (timeStepMin === 10) ? 1 : 10;
    setTimeStepMin(next);
    refreshTimeStepLabel();
  };
}

/* import */
(() => {
  const input = byId('importFile');
  const handler = async () => {
    const file = input.files && input.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
      const dateKeys = Object.keys(data || {}).filter(k => dateKeyRe.test(k));
      if (dateKeys.length === 0) { showToast("バックアップ形式が違うかも"); return; }

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
})();

/* top shadow */
(() => {
  const topSticky = byId('topSticky');
  const TH = 6;
  const onScroll = () => topSticky.classList.toggle('isScrolled', window.scrollY > TH);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

      
/* init */
(async () => {
  generateCalendar();
  await showWeek();            // ←ここが重要
  refreshTimeHint();
  startTimeTicker();
  applyTimeStepToUI(timeStepMin);
  openDB().catch(()=>{});
})();
