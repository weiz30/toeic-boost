/* =========================================================================
   TOEIC BOOST v2 — 100 天 × 20 字（2000 多益單字）＋ 遺忘曲線複習
   純前端、無框架、無外部依賴。進度存 localStorage，不上傳。
   ========================================================================= */
'use strict';

const KEY = 'toeic-boost-v1';                  // 沿用舊 key，舊進度不會消失
const INTERVALS = [1, 2, 4, 7, 15, 30];        // 遺忘曲線：box 0→5 的複習間隔（天）
const PARTS = [
  { n: 2, label: 'Part 2', sub: '應答問題' },
  { n: 3, label: 'Part 3', sub: '對話' },
  { n: 4, label: 'Part 4', sub: '短講' },
  { n: 5, label: 'Part 5', sub: '句子填空' },
  { n: 6, label: 'Part 6', sub: '段落填空' },
  { n: 7, label: 'Part 7', sub: '閱讀理解' },
];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => new Date().toLocaleDateString('sv-SE');
const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('sv-SE');
};
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------------ 狀態 */
const blankState = () => ({
  v: 2,
  sound: true,
  streak: { count: 0, last: null },
  days: {},          // { 'YYYY-MM-DD': { q, c } }
  srs: {},           // { word: { box, due, seen, lapses, last, day } }
  dayDone: {},       // { '1': 'YYYY-MM-DD' }
  curDay: 1,
  partStats: {},
  exams: [],
});
let state = blankState();

function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const old = JSON.parse(raw);
    state = Object.assign(blankState(), old);
    state.srs ||= {};
    state.dayDone ||= {};
    // 舊版（150 字字卡）進度搬進遺忘曲線，一個都不丟
    if (old.vocab && typeof old.vocab === 'object') {
      const t = todayISO();
      for (const [w, rec] of Object.entries(old.vocab)) {
        const k = w.toLowerCase();
        if (state.srs[k]) continue;
        state.srs[k] = {
          box: clamp(rec.box || 0, 0, 3),
          due: t,
          seen: rec.seen || 1,
          lapses: 0,
          last: t,
          legacy: true,
        };
      }
    }
    state.v = 2;
    saveState();
  } catch (e) { console.warn('讀取進度失敗', e); }
}
function saveState() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('儲存失敗', e); }
  if (typeof schedulePush === 'function') schedulePush();
}
function touchDay() {
  const d = todayISO();
  if (state.streak.last === d) return;
  state.streak.count = state.streak.last === isoPlus(-1) ? (state.streak.count || 0) + 1 : 1;
  state.streak.last = d;
  saveState();
}
function recordAnswer(part, correct) {
  touchDay();
  const rec = (state.days[todayISO()] ||= { q: 0, c: 0 });
  rec.q += 1; if (correct) rec.c += 1;
  const p = (state.partStats[part] ||= { n: 0, c: 0 });
  p.n += 1; if (correct) p.c += 1;
  saveState();
}

/* ------------------------------------------------------------------ 語音 */
let voices = [];
function pickVoice() {
  const v = voices.filter((x) => /^en[-_]US/i.test(x.lang) || /^en[-_]GB/i.test(x.lang));
  const pref = [/Jenny/i, /Aria/i, /Samantha/i, /Google US English/i, /Natural/i, /Zira/i];
  for (const re of pref) { const f = v.find((x) => re.test(x.name)); if (f) return f; }
  return v[0] || null;
}
function speak(text, opts = {}) {
  if (!state.sound || !('speechSynthesis' in window) || !text) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).replace(/\n/g, '. '));
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = v?.lang || 'en-US';
  u.rate = opts.rate ?? 0.92;
  window.speechSynthesis.speak(u);
  return u;
}

/* 真人-ish 發音：直接串有道詞典的發音檔（免費、不用 key、不佔網站空間）
   失敗（離線／被擋／429）就退回瀏覽器內建語音。 */
let audioEl = null;
const sayCache = new Set();
function sayExternal(text) {
  const t = String(text || '').trim();
  if (!state.sound || !t) return null;
  try {
    if (audioEl) { audioEl.pause(); audioEl = null; }
    window.speechSynthesis?.cancel();
    const url = 'https://dict.youdao.com/dictvoice?type=2&audio=' + encodeURIComponent(t);
    const a = new Audio(url);
    a.preload = 'auto';
    audioEl = a;
    const fallback = () => { speak(t, { rate: 0.9 }); };
    a.addEventListener('error', fallback, { once: true });
    const p = a.play();
    if (p && typeof p.catch === 'function') p.catch(fallback);
    sayCache.add(url);
    return a;
  } catch (e) {
    return speak(t, { rate: 0.9 });
  }
}

/* ------------------------------------------------------------------ 資料 */
let CURR = { meta: {}, days: [] };
let INDEX = new Map();        // word(lower) → { day, item, theme, level }
let LEGACY = new Map();       // 舊字庫（150 字）
let DRILLS = [];

async function loadData() {
  const [c, v, l, r] = await Promise.all([
    fetch('data/curriculum.json').then((x) => x.json()),
    fetch('data/vocab.json').then((x) => x.json()).catch(() => []),
    fetch('data/drills_listen.json').then((x) => x.json()),
    fetch('data/drills_read.json').then((x) => x.json()),
  ]);
  CURR = c;
  (c.days || []).forEach((d) => (d.items || []).forEach((it) => {
    INDEX.set(it.word.toLowerCase(), { day: d.day, item: it, theme: d.theme, level: d.level });
  }));
  (Array.isArray(v) ? v : []).forEach((it) => {
    const k = String(it.w || '').toLowerCase();
    if (k && !INDEX.has(k)) {
      LEGACY.set(k, {
        day: 0,
        item: {
          word: it.w, ph: it.ph ? `/${it.ph}/` : '', pos: it.pos, zh: it.zh,
          colloc: it.tag || '', distinct: '', ex: it.ex ? [[it.ex, it.ezh || '']] : [],
        },
        theme: '舊字庫', level: '前期字卡',
      });
    }
  });
  DRILLS = [...(l.questions || []), ...(r.questions || [])];
}
const lookup = (w) => INDEX.get(String(w).toLowerCase()) || LEGACY.get(String(w).toLowerCase()) || null;
const dayOf = (n) => CURR.days.find((d) => d.day === n) || CURR.days[0];
const byPart = (n) => DRILLS.filter((q) => q.part === n);

/* ------------------------------------------------------------------ 遺忘曲線 */
function srsEntry(word, opts = {}) {
  const k = word.toLowerCase();
  if (!state.srs[k]) {
    state.srs[k] = { box: 0, due: isoPlus(1), seen: 0, lapses: 0, last: todayISO(), day: opts.day || 0 };
  }
  return state.srs[k];
}
function dueWords() {
  const t = todayISO();
  return Object.entries(state.srs)
    .filter(([w, r]) => r && r.due && r.due <= t && lookup(w))
    .sort((a, b) => (a[1].due < b[1].due ? -1 : a[1].due > b[1].due ? 1 : 0))
    .map(([w]) => w);
}
const learnedCount = () => Object.keys(state.srs).length;
const masteredCount = () => Object.values(state.srs).filter((r) => (r.box || 0) >= 4).length;

function gradeWord(word, grade) {
  const r = srsEntry(word);
  r.seen = (r.seen || 0) + 1;
  r.last = todayISO();
  if (grade === 'again') {
    r.lapses = (r.lapses || 0) + 1;
    r.box = 0;
    r.due = isoPlus(INTERVALS[0]);
  } else if (grade === 'hard') {
    r.due = isoPlus(Math.max(1, Math.round(INTERVALS[clamp(r.box, 0, 5)] * 0.6)));
  } else if (grade === 'good') {
    r.box = clamp((r.box || 0) + 1, 0, 5);
    r.due = isoPlus(INTERVALS[r.box]);
  } else if (grade === 'easy') {
    r.box = clamp((r.box || 0) + 2, 0, 5);
    r.due = isoPlus(INTERVALS[r.box]);
  }
  if (grade === 'again') wrongAdd(word);
  else if (grade === 'good' || grade === 'easy') wrongSoften(word);
  saveState();
  return r;
}
function upcomingSchedule(n = 6) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = isoPlus(i);
    out.push({
      d,
      c: Object.values(state.srs).filter((r) => (i === 0 ? r.due <= d : r.due === d)).length,
      label: i === 0 ? '今天' : i === 1 ? '明天' : `${i} 天後`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ 跑馬燈 */
function renderTicker() {
  // 固定不滾動：每次重新整理隨機挑 9 個字顯示
  const pool = [];
  CURR.days.forEach((d) => (d.items || []).forEach((it) => pool.push(it)));
  const words = shuffle(pool).slice(0, 9);
  $('#tickerTrack').innerHTML = words
    .map((w) => `<span><b>${esc(w.word)}</b> <i>${esc((w.zh || '').split('；')[0])}</i></span>`)
    .join('');
}

/* ------------------------------------------------------------------ 今日 */
function currentDayNum() {
  for (let d = 1; d <= CURR.days.length; d++) if (!state.dayDone[d]) return d;
  return CURR.days.length;
}
function dayLearned(n) {
  const d = dayOf(n);
  if (!d) return 0;
  return (d.items || []).filter((it) => state.srs[it.word.toLowerCase()]?.day === n).length;
}

function renderToday() {
  const n = state.curDay || currentDayNum();
  const d = dayOf(n);
  $('#todayNum').textContent = n;
  $('#todayLevel').textContent = d.level || '';
  $('#todayTheme').textContent = d.theme || '';
  $('#todayTitle').textContent = `今天的 20 個字 · 第 ${n} 天`;
  $('#todayWords').innerHTML = (d.items || []).map((it) => {
    const learned = state.srs[it.word.toLowerCase()]?.day === n;
    return `<li class="${learned ? 'is-learned' : ''}">${esc(it.word)}</li>`;
  }).join('');

  const learned = dayLearned(n);
  $('#todayDone').textContent = learned;
  $('#todayBar').style.width = (learned / 20) * 100 + '%';
  $('#todayState').textContent = state.dayDone[n] ? `已完成（${state.dayDone[n]}）` : learned ? '進行中' : '尚未開始';
  $('#todayStart').textContent = learned ? '繼續今天的課' : '開始今天的課';
  $('#todayNext').hidden = n >= CURR.days.length;

  const due = dueWords().length;
  $('#peekDue').textContent = due;
  $('#heroDue').textContent = due;
  $('#heroDay').textContent = n;
  $('#miniLearned').textContent = learnedCount();
  $('#miniDue').textContent = due;
  $('#streakNum').textContent = state.streak.last === todayISO() ? state.streak.count : (state.streak.count || 0);
  $('#todayDate').textContent = new Date().toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' });

  const qToday = state.days[todayISO()]?.q || 0;
  const tasks = [
    { t: `第 ${n} 天 20 字`, done: !!state.dayDone[n], v: learned + '/20' },
    { t: '遺忘曲線複習', done: due === 0 && learnedCount() > 0, v: due ? due + ' 字' : '清空' },
    { t: 'Part 練習', done: qToday > 0, v: qToday + ' 題' },
  ];
  $('#todayMini').innerHTML = tasks.map((x) => `<li class="${x.done ? 'is-done' : ''}"><span>${esc(x.t)}</span><span>${esc(x.v)}</span></li>`).join('');

  const pct = Math.round(
    (state.dayDone[n] ? 55 : (learned / 20) * 45) +
    (due === 0 && learnedCount() ? 20 : 0) +
    (qToday > 0 ? 25 : 0)
  );
  $('#ringPct').textContent = clamp(pct, 0, 100) + '%';
  $('#ringFg').style.strokeDashoffset = String(327 - (327 * clamp(pct, 0, 100)) / 100);

  const sched = upcomingSchedule(5);
  $('#schedList').innerHTML = sched.map((s) => `<li><span>${s.label}</span><b>${s.c} 字</b></li>`).join('');
  $('#reviewEmptyNote').textContent = `明天有 ${sched[1] ? sched[1].c : 0} 個字會回來找你。先去學新的 20 個字。`;
}

/* ------------------------------------------------------------------ 每日課程 */
const dayView = { n: 1, i: 0 };

function openDay(n) {
  dayView.n = clamp(n, 1, CURR.days.length);
  const d = dayOf(dayView.n);
  const firstUnlearned = (d.items || []).findIndex((it) => state.srs[it.word.toLowerCase()]?.day !== dayView.n);
  dayView.i = firstUnlearned >= 0 ? firstUnlearned : 0;
  $('#day').hidden = false;
  $('#dayKicker').textContent = `DAY ${dayView.n}`;
  $('#dayTheme').textContent = d.theme || '';
  $('#dayNote').textContent = `${d.level || ''} · ${(d.items || []).length} 個字 · 每個字 3 組例句`;
  $('#dayFinishNum').textContent = dayView.n;
  renderWord();
  $('#day').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderWord() {
  const d = dayOf(dayView.n);
  const items = d.items || [];
  const it = items[dayView.i];
  if (!it) return;
  const rec = state.srs[it.word.toLowerCase()];
  const learned = rec?.day === dayView.n;

  $('#wordIdx').textContent = `${dayView.i + 1} / ${items.length}`;
  $('#wordCat').textContent = learned ? (rec.box >= 4 ? '已熟練' : '已學過') : '未學';
  $('#wordText').textContent = it.word;
  $('#wordPh').textContent = it.ph || '';
  $('#wordPos').textContent = it.pos || it.zh || '';
  $('#wordColloc').textContent = it.colloc || '—';
  $('#wordDistinct').textContent = it.distinct || '—';
  if (it.root) { $('#wordRootWrap').hidden = false; $('#wordRoot').textContent = it.root; }
  else $('#wordRootWrap').hidden = true;

  $('#exList').innerHTML = (it.ex || []).map((p, k) => `
    <li>
      <div class="exline">
        <button class="exspeak" data-ex="${k}" aria-label="播放例句">🔊</button>
        <div><p class="exline__en">${esc(p[0])}</p><p class="exline__zh">${esc(p[1] || '')}</p></div>
      </div>
    </li>`).join('');

  $('#dayPos').textContent = dayView.i + 1;
  $('#dayBar').style.width = ((dayView.i + 1) / items.length) * 100 + '%';
  $('#wordPrev').disabled = dayView.i === 0;
  $('#wordNext').disabled = dayView.i >= items.length - 1;
  $('#wordDots').innerHTML = items.map((x, k) => {
    const st = state.srs[x.word.toLowerCase()]?.day === dayView.n ? 'is-learned' : '';
    return `<button class="dotbtn ${st} ${k === dayView.i ? 'is-cur' : ''}" data-jump="${k}" title="${esc(x.word)}"></button>`;
  }).join('');
  $('#dayDoneNote').textContent = state.dayDone[dayView.n]
    ? `這天已在 ${state.dayDone[dayView.n]} 完成 ✓`
    : `已學 ${dayLearned(dayView.n)} / ${items.length}`;
}

function markWord(known) {
  const d = dayOf(dayView.n);
  const it = (d.items || [])[dayView.i];
  if (!it) return;
  const r = srsEntry(it.word, { day: dayView.n });
  r.day = dayView.n;
  if (!r.seen) {
    r.seen = 1;
    r.box = known ? 1 : 0;
    r.due = isoPlus(known ? INTERVALS[1] : INTERVALS[0]);
  } else {
    r.box = known ? clamp((r.box || 0) + 1, 0, 5) : 0;
    r.due = isoPlus(INTERVALS[r.box]);
  }
  r.last = todayISO();
  if (!known) wrongAdd(it.word);
  touchDay();
  saveState();
  renderToday();
  renderStats();
  if (dayView.i < d.items.length - 1) { dayView.i += 1; renderWord(); }
  else finishDay(true);
}

function finishDay(auto) {
  const n = dayView.n;
  const learned = dayLearned(n);
  if (!auto && learned < 20 && !confirm(`第 ${n} 天還有 ${20 - learned} 個字沒學，還是要標記完成嗎？`)) return;
  state.dayDone[n] = todayISO();
  state.curDay = Math.min(CURR.days.length, Math.max(state.curDay || 1, n + 1));
  saveState();
  renderToday(); renderMap(); renderStats();
  toast(`第 ${n} 天完成！接著是第 ${state.curDay} 天`);
  $('#dayDoneNote').textContent = `完成於 ${state.dayDone[n]} ✓`;
  if (dueWords().length) setTimeout(() => openReview(), 800);
}

/* ------------------------------------------------------------------ 地圖 */
// 階段直接由資料的 level 欄位分群（課程字表可能改版，不要寫死天數區間）
function stageBands() {
  const keyOf = (d) => (d.kind === 'phrase' ? '教材片語' : d.level || '其他');
  const bands = [];
  (CURR.days || []).forEach((d) => {
    const lv = keyOf(d);
    const last = bands[bands.length - 1];
    if (last && last.name === lv) { last.to = d.day; last.days.push(d.day); }
    else bands.push({ name: lv, from: d.day, to: d.day, days: [d.day] });
  });
  // 少於 4 天的零碎階段併進前一階段，避免地圖出現一堆碎片
  const merged = [];
  bands.forEach((b) => {
    if (merged.length && b.days.length < 4) {
      const prev = merged[merged.length - 1];
      prev.to = b.to; prev.days.push(...b.days);
    } else merged.push(b);
  });
  return merged;
}
function renderMap() {
  const bands = stageBands();
  $('#stageLegend').innerHTML = bands
    .map((b, i) => `<span class="stagechip s${(i % 4) + 1}">第 ${b.from}${b.to !== b.from ? '–' + b.to : ''} 天 · ${esc(b.name)}${b.days.length < 3 ? '' : ''}</span>`)
    .join('');
  const cur = state.curDay || currentDayNum();
  $('#dayGrid').innerHTML = CURR.days.map((d) => {
    const bi = bands.findIndex((b) => d.day >= b.from && d.day <= b.to);
    const cls = ['daycell', `s${(bi % 4) + 1}`].filter(Boolean).join(' ');
    const learned = dayLearned(d.day);
    const done = !!state.dayDone[d.day];
    const extra = [done ? 'is-done' : learned ? 'is-doing' : '', d.day === cur ? 'is-cur' : ''].filter(Boolean).join(' ');
    return `<button class="${cls} ${extra}" data-day="${d.day}" title="${esc(d.theme)}">
      <b>${pad(d.day)}</b><span>${esc((d.theme || '').slice(0, 8))}</span>
      <i style="width:${(learned / 20) * 100}%"></i></button>`;
  }).join('');
}
function searchWords(q) {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const out = [];
  for (const [w, rec] of INDEX) {
    if (w.includes(s)) out.push({ w, ...rec });
    if (out.length >= 12) break;
  }
  return out;
}

/* ------------------------------------------------------------------ 複習 */
const review = { queue: [], i: 0, shown: false, stats: { again: 0, hard: 0, good: 0, easy: 0 } };

function openReview() {
  review.queue = dueWords().slice(0, 60);
  review.i = 0;
  review.shown = false;
  review.stats = { again: 0, hard: 0, good: 0, easy: 0 };
  $('#reviewEmpty').hidden = review.queue.length > 0;
  $('#reviewDone').hidden = true;
  $('#reviewRun').hidden = review.queue.length === 0;
  if (review.queue.length) renderReview();
  $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderReview() {
  const w = review.queue[review.i];
  if (!w) return finishReview();
  const rec = lookup(w);
  const it = rec.item;
  const s = state.srs[w] || {};
  $('#reviewPos').textContent = review.i + 1;
  $('#reviewLen').textContent = review.queue.length;
  $('#reviewFrom').textContent = `第 ${rec.day || '—'} 天 · 第 ${clamp((s.box || 0) + 1, 1, 6)} 階`;
  $('#reviewWord').textContent = it.word;
  $('#reviewPh').textContent = it.ph || '';
  $('#reviewPosText').textContent = it.pos || it.zh || '';
  $('#reviewEx').innerHTML = (it.ex || []).slice(0, 2).map((p) => `
    <li><p class="exline__en">${esc(p[0])}</p><p class="exline__zh">${esc(p[1] || '')}</p></li>`).join('');
  $('#reviewMeta').textContent = [it.colloc, it.distinct].filter(Boolean).join('　·　');
  $('#reviewAnswer').hidden = true;
  $('#reviewGrade').hidden = true;
  $('#reviewBtns').hidden = false;
  review.shown = false;
}

function showAnswer() {
  $('#reviewAnswer').hidden = false;
  $('#reviewGrade').hidden = false;
  $('#reviewBtns').hidden = true;
  review.shown = true;
  const it = lookup(review.queue[review.i])?.item;
  if (it) speak(`${it.word}. ${(it.ex?.[0]?.[0]) || ''}`);
}

function grade(which) {
  if (!review.shown) return;
  const w = review.queue[review.i];
  gradeWord(w, which);
  review.stats[which] = (review.stats[which] || 0) + 1;
  review.i += 1;
  renderToday(); renderStats();
  if (review.i >= review.queue.length) finishReview();
  else renderReview();
}

function finishReview() {
  $('#reviewRun').hidden = true;
  $('#reviewDone').hidden = false;
  const s = review.stats;
  const total = s.again + s.hard + s.good + s.easy;
  if (!total) return;
  const sched = upcomingSchedule(6);
  $('#reviewDone').innerHTML = `
    <p class="review__icon" aria-hidden="true">🎯</p>
    <h3>這一輪複習完成：${total} 個字</h3>
    <p class="muted">忘記 ${s.again}　有點難 ${s.hard}　記得住 ${s.good}　太簡單 ${s.easy}</p>
    <ul class="schedlist">${sched.map((x) => `<li><span>${x.label}</span><b>${x.c} 字</b></li>`).join('')}</ul>
    <button class="btn btn--accent btn--sm" id="reviewAgainBtn">再複習一次</button>`;
  $('#reviewAgainBtn').addEventListener('click', openReview);
  renderToday(); renderMap(); renderStats();
}

/* ------------------------------------------------------------------ Part 練習 */
const session = { queue: [], idx: 0, picked: null, checked: false };

function startDrill(part, limit) {
  let pool = part ? byPart(part) : DRILLS.slice();
  if (part === 6 || part === 7) {
    const groups = {};
    pool.forEach((q) => { (groups[q.group || q.id] ||= []).push(q); });
    pool = shuffle(Object.values(groups)).flat();
  } else pool = shuffle(pool);
  if (limit) pool = pool.slice(0, limit);
  Object.assign(session, { queue: pool, idx: 0, picked: null, checked: false });
  $('#practiceEmpty').hidden = true;
  $('#qbox').hidden = false;
  renderQuestion();
  if (part) selectPartTab(part);
  $('#drills').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderQuestion() {
  const q = session.queue[session.idx];
  if (!q) return finishSession();
  session.picked = null; session.checked = false;
  $('#qPart').textContent = 'Part ' + q.part;
  $('#qCat').textContent = q.cat || '綜合';
  $('#qTally').textContent = `${session.idx + 1} / ${session.queue.length}`;
  $('#qQuestion').textContent = q.question;
  const needsAudio = q.audio && q.audio.trim();
  $('#qAudioWrap').hidden = !needsAudio;
  if (needsAudio) $('#qAudioNote').textContent = q.part === 2 ? '點播放聽一次問句，再選最適合的回應' : '點播放聽對話／短講，可重播';
  const passage = (q.passage && q.passage.trim()) ? q.passage : '';
  $('#qPassage').hidden = !passage || q.part === 3 || q.part === 4;
  $('#qPassage').textContent = (passage && q.part !== 3 && q.part !== 4) ? passage : '';
  $('#qOptions').innerHTML = q.options.map((opt, i) =>
    `<button class="option" data-opt="${i}"><span class="option__key">${'ABCD'[i]}</span><span>${esc(opt)}</span></button>`).join('');
  $('#qFeedback').hidden = true;
  $('#qCheck').disabled = true;
  $('#qCheck').hidden = false;
  $('#qNext').hidden = true;
  const tr = $('#qTranscript');
  if ((q.part === 3 || q.part === 4) && q.passage) { tr.hidden = false; $('#qTranscriptBody').textContent = q.passage; }
  else tr.hidden = true;
  if (needsAudio && q.part >= 2 && q.part <= 4) autoPlay(q);
}
function autoPlay(q) {
  const wrap = $('#qAudioWrap');
  if (!wrap || !q.audio) return;
  wrap.classList.add('is-playing');
  const u = speak(q.audio, { rate: q.part === 2 ? 0.9 : 0.94 });
  if (u) u.onend = () => wrap.classList.remove('is-playing');
  else setTimeout(() => wrap.classList.remove('is-playing'), 900);
}
function pickOption(i) {
  if (session.checked) return;
  session.picked = i;
  $$('#qOptions .option').forEach((b, k) => b.classList.toggle('is-picked', k === i));
  $('#qCheck').disabled = false;
}
function checkAnswer() {
  const q = session.queue[session.idx];
  if (!q || session.picked == null || session.checked) return;
  session.checked = true;
  const ok = session.picked === q.answer;
  $$('#qOptions .option').forEach((b, k) => {
    b.disabled = true; b.classList.remove('is-picked');
    if (k === q.answer) b.classList.add('is-correct');
    else if (k === session.picked) b.classList.add('is-wrong');
  });
  const v = $('#fbVerdict');
  v.textContent = ok ? '答對 ✓' : `答錯 ✗ 正解是 ${'ABCD'[q.answer]}`;
  v.className = 'feedback__verdict ' + (ok ? 'ok' : 'no');
  $('#fbZh').textContent = q.zh || '';
  $('#fbTip').textContent = q.tip || '';
  $('#fbTip').hidden = !q.tip;
  $('#qFeedback').hidden = false;
  if ((q.part === 3 || q.part === 4) && q.passage) { $('#qTranscript').hidden = false; $('#qTranscriptBody').textContent = q.passage; }
  recordAnswer(q.part, ok);
  if ((q.part === 3 || q.part === 4) && !ok) speak(q.audio, { rate: 0.9 });
  $('#qCheck').hidden = true;
  $('#qNext').hidden = false;
  $('#qNext').textContent = session.idx + 1 >= session.queue.length ? '看結果 →' : '下一題 →';
  renderStats(); renderToday();
}
function nextQuestion() {
  session.idx += 1;
  if (session.idx >= session.queue.length) return finishSession();
  renderQuestion();
}
function finishSession() {
  $('#qbox').hidden = true;
  $('#practiceEmpty').hidden = false;
  $('#practiceEmpty').innerHTML = `<p class="practice__emptyIcon" aria-hidden="true">🎉</p>
    <h3>這一輪完成了</h3>
    <p class="muted">再挑一個 Part，或去「我的進度」看看正確率。</p>
    <button class="btn btn--line btn--sm" id="againBtn">再練一輪</button>`;
  $('#againBtn')?.addEventListener('click', () => startDrill(null, 10));
  renderStats();
}
function renderPartTabs() {
  $('#partTabs').innerHTML = PARTS.map((p) => {
    const st = state.partStats[p.n];
    const acc = st && st.n ? Math.round((st.c / st.n) * 100) + '%' : '未練';
    return `<button class="parttab" role="tab" data-part="${p.n}" aria-selected="false">${p.label}<small>${p.sub} · ${acc}</small></button>`;
  }).join('');
}
function selectPartTab(n) {
  $$('.parttab').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.part === n)));
}

/* ------------------------------------------------------------------ 模考 */
const exam = { list: [], idx: 0, ans: [], left: 0, timer: null };

function startExam() {
  exam.list = shuffle(DRILLS).slice(0, 10);
  exam.idx = 0; exam.ans = []; exam.left = 5 * 60;
  $('#examStart').hidden = true; $('#examResult').hidden = true; $('#examRun').hidden = false;
  renderExamQ();
  tickExam();
  exam.timer = setInterval(tickExam, 1000);
}
function tickExam() {
  $('#examTimer').textContent = `${pad(Math.floor(exam.left / 60))}:${pad(exam.left % 60)}`;
  $('#examTimer').classList.toggle('is-low', exam.left <= 30);
  if (exam.left <= 0) return endExam();
  exam.left -= 1;
}
function renderExamQ() {
  const q = exam.list[exam.idx];
  $('#examIdx').textContent = exam.idx + 1;
  $('#examLen').textContent = exam.list.length;
  const el = $('#examQuestion');
  el.textContent = q.question + (q.part >= 6 && q.passage ? '\n\n' + q.passage : '');
  el.style.whiteSpace = 'pre-wrap';
  $('#examOptions').innerHTML = q.options.map((o, i) =>
    `<button class="option" data-eopt="${i}"><span class="option__key">${'ABCD'[i]}</span><span>${esc(o)}</span></button>`).join('');
  $$('#examOptions .option').forEach((b) => b.addEventListener('click', () => {
    exam.ans[exam.idx] = +b.dataset.eopt;
    $$('#examOptions .option').forEach((x, k) => x.classList.toggle('is-picked', k === +b.dataset.eopt));
  }));
  $('#examNext').textContent = exam.idx + 1 >= exam.list.length ? '交卷' : '下一題 →';
  $('#examAudioWrap').hidden = !(q.audio && q.audio.trim());
  if (q.audio && q.audio.trim()) speak(q.audio, { rate: 0.92 });
}
function endExam() {
  clearInterval(exam.timer);
  $('#examRun').hidden = true;
  $('#examResult').hidden = false;
  const byPart = {};
  let correct = 0;
  exam.list.forEach((q, i) => {
    const ok = exam.ans[i] === q.answer;
    if (ok) correct += 1;
    const p = (byPart[q.part] ||= { n: 0, c: 0 });
    p.n += 1; if (ok) p.c += 1;
    recordAnswer(q.part, ok);
  });
  const score = Math.round((correct / exam.list.length) * 100);
  state.exams.unshift({ date: todayISO(), score, correct, total: exam.list.length, byPart });
  state.exams = state.exams.slice(0, 12);
  saveState();
  const rank = score >= 90 ? '可以直接上考場了' : score >= 70 ? '基礎穩了，再練速度' : score >= 50 ? '有底子，弱點要補' : '先把單字量補起來';
  const partRows = Object.entries(byPart).map(([p, s]) => {
    const acc = Math.round((s.c / s.n) * 100);
    const cls = acc >= 80 ? 'tag--good' : acc < 50 ? 'tag--bad' : '';
    return `<span class="tag ${cls}">Part ${p} ${s.c}/${s.n}</span>`;
  }).join('');
  $('#examResult').innerHTML = `
    <div class="exam__score"><b>${score}</b><div><span>分 · 答對 ${correct} / ${exam.list.length} 題</span><br/><span>${rank}</span></div></div>
    <div class="exam__weak">${partRows}</div>
    <div class="qbox__foot"><button class="btn btn--accent" id="examAgain">再考一次</button>
    <a class="btn btn--line" href="#progress">看累積進度</a></div>`;
  $('#examAgain').addEventListener('click', startExam);
  renderStats(); renderToday(); renderPartTabs(); renderExamList();
}

/* ------------------------------------------------------------------ 進度 */
function renderStats() {
  const all = Object.values(state.partStats).reduce((a, s) => ({ n: a.n + s.n, c: a.c + s.c }), { n: 0, c: 0 });
  const acc = all.n ? Math.round((all.c / all.n) * 100) : 0;
  const doneDays = Object.keys(state.dayDone).length;
  const boxes = [0, 0, 0, 0, 0, 0];
  Object.values(state.srs).forEach((r) => { boxes[clamp(r.box || 0, 0, 5)] += 1; });

  $('#statGrid').innerHTML = `
    <div class="stat"><span>連續學習</span><b>${state.streak.last === todayISO() ? state.streak.count : 0}</b><small>天</small></div>
    <div class="stat"><span>已完成天數</span><b>${doneDays}</b><small>/ ${CURR.days.length}</small></div>
    <div class="stat"><span>已學單字</span><b>${learnedCount()}</b><small>/ ${INDEX.size}</small></div>
    <div class="stat"><span>待複習</span><b>${dueWords().length}</b><small>字</small></div>
    <div class="stat"><span>熟練（第 5 階以上）</span><b>${masteredCount()}</b><small>字</small></div>
    <div class="stat"><span>題目正確率</span><b>${all.n ? acc + '%' : '—'}</b><small>${all.n} 題</small></div>`;

  $('#partBars').innerHTML = PARTS.map((p) => {
    const s = state.partStats[p.n];
    const a = s && s.n ? Math.round((s.c / s.n) * 100) : 0;
    const cls = !s || !s.n ? '' : a >= 80 ? 'high' : a >= 50 ? 'mid' : 'low';
    return `<div class="bar"><div class="bar__top"><span>${p.label} ${p.sub}</span><span>${s && s.n ? a + '%（' + s.n + ' 題）' : '未練'}</span></div>
      <div class="bar__track"><i class="bar__fill ${cls}" style="width:${a}%"></i></div></div>`;
  }).join('');

  const labels = ['第 1 階（1 天）', '第 2 階（2 天）', '第 3 階（4 天）', '第 4 階（7 天）', '第 5 階（15 天）', '第 6 階（30 天）'];
  const maxB = Math.max(1, ...boxes);
  $('#srsBars').innerHTML = boxes.map((c, i) => {
    const w = Math.round((c / maxB) * 100);
    const cls = i >= 4 ? 'high' : i >= 2 ? 'mid' : 'low';
    return `<div class="bar"><div class="bar__top"><span>${labels[i]}</span><span>${c} 字</span></div>
      <div class="bar__track"><i class="bar__fill ${cls}" style="width:${w}%"></i></div></div>`;
  }).join('');

  renderExamList();
}
function renderExamList() {
  const el = $('#examList');
  if (!state.exams.length) { el.innerHTML = '<li class="empty">還沒考過模考，去上面試一次 5 分鐘的吧。</li>'; return; }
  el.innerHTML = state.exams.map((e) => {
    const weakest = Object.entries(e.byPart || {}).sort((a, b) => a[1].c / a[1].n - b[1].c / b[1].n)[0];
    return `<li><span>${e.date} · 最弱 Part ${weakest ? weakest[0] : '—'}</span><b>${e.score} 分（${e.correct}/${e.total}）</b></li>`;
  }).join('');
}

/* ------------------------------------------------------------------ 小工具 */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 2400);
}
function initNav() {
  const links = $$('.nav a');
  const secs = links.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === '#' + e.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  secs.forEach((s) => io.observe(s));
}

/* ------------------------------------------------------------------ 事件 */
function bindEvents() {
  $('#heroStart').addEventListener('click', () => openDay(state.curDay || currentDayNum()));
  $('#heroReview').addEventListener('click', openReview);
  $('#todayStart').addEventListener('click', () => openDay(state.curDay || currentDayNum()));
  $('#todayNext').addEventListener('click', () => openDay(Math.min(CURR.days.length, (state.curDay || 1) + 1)));
  $('#peekStart').addEventListener('click', openReview);
  $('#reviewToToday').addEventListener('click', () => $('#today').scrollIntoView({ behavior: 'smooth' }));

  // 每日課程
  $('#wordSpeak').addEventListener('click', () => {
    const it = dayOf(dayView.n).items[dayView.i];
    if (it) sayExternal(it.word);
  });
  $('#exList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ex]');
    if (!b) return;
    const it = dayOf(dayView.n).items[dayView.i];
    const p = it?.ex?.[+b.dataset.ex];
    if (p) sayExternal(p[0]);
  });
  $('#wordKnow').addEventListener('click', () => markWord(true));
  $('#wordHazy').addEventListener('click', () => markWord(false));
  $('#wordPrev').addEventListener('click', () => { if (dayView.i > 0) { dayView.i -= 1; renderWord(); } });
  $('#wordNext').addEventListener('click', () => {
    const items = dayOf(dayView.n).items;
    if (dayView.i < items.length - 1) { dayView.i += 1; renderWord(); }
  });
  $('#wordDots').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jump]');
    if (b) { dayView.i = +b.dataset.jump; renderWord(); }
  });
  $('#dayFinish').addEventListener('click', () => finishDay(false));

  // 地圖 + 搜尋
  $('#dayGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (b) openDay(+b.dataset.day);
  });
  let searchTimer = null;
  $('#wordSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value;
    searchTimer = setTimeout(() => {
      const res = searchWords(q);
      $('#searchResults').innerHTML = res.length
        ? res.map((r) => `<button class="searchhit" data-goday="${r.day}" data-word="${esc(r.w)}"><b>${esc(r.w)}</b><span>第 ${r.day} 天 · ${esc(r.theme)} · ${esc(r.item.zh)}</span></button>`).join('')
        : (q.trim().length >= 2 ? '<p class="muted">找不到這個字（目前收錄 2000 字）</p>' : '');
    }, 160);
  });
  $('#searchResults').addEventListener('click', (e) => {
    const b = e.target.closest('[data-goday]');
    if (!b) return;
    const day = +b.dataset.goday;
    const w = (b.dataset.word || '').toLowerCase();
    openDay(day);
    const idx = (dayOf(day).items || []).findIndex((it) => it.word.toLowerCase() === w);
    if (idx >= 0) { dayView.i = idx; renderWord(); }
  });

  // 複習
  $('#reviewShow').addEventListener('click', showAnswer);
  $('#reviewSpeak').addEventListener('click', () => {
    const it = lookup(review.queue[review.i])?.item;
    if (it) sayExternal(it.word);
  });
  $('#reviewGrade').addEventListener('click', (e) => {
    const b = e.target.closest('[data-grade]');
    if (b) grade(b.dataset.grade);
  });

  // Part 練習
  $('#partTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-part]');
    if (b) startDrill(+b.dataset.part, null);
  });
  $('#qOptions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-opt]');
    if (b) pickOption(+b.dataset.opt);
  });
  $('#qCheck').addEventListener('click', checkAnswer);
  $('#qNext').addEventListener('click', nextQuestion);
  $('#qSkip').addEventListener('click', () => { session.idx = Math.min(session.idx + 1, session.queue.length); nextQuestion(); });
  $('#qPlay').addEventListener('click', () => {
    const q = session.queue[session.idx];
    if (!q) return;
    const wrap = $('#qAudioWrap');
    wrap.classList.add('is-playing');
    const a = sayExternal(q.audio);
    if (a) a.addEventListener('ended', () => wrap.classList.remove('is-playing'), { once: true });
    else setTimeout(() => wrap.classList.remove('is-playing'), 1200);
  });

  // 模考
  $('#examGo').addEventListener('click', startExam);
  $('#examNext').addEventListener('click', () => {
    exam.idx += 1;
    if (exam.idx >= exam.list.length) return endExam();
    renderExamQ();
  });
  $('#examQuit').addEventListener('click', endExam);
  $('#examPlay').addEventListener('click', () => {
    const q = exam.list[exam.idx];
    if (q && q.audio) sayExternal(q.audio);
  });

  // 進度
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('確定要清空所有學習進度嗎？（單字熟練度、已完成天數、正確率、模考紀錄都會消失）')) return;
    localStorage.removeItem(KEY);
    state = blankState();
    saveState();
    renderToday(); renderStats(); renderMap(); renderPartTabs();
    toast('進度已重設');
  });

  $('#soundToggle').addEventListener('click', (e) => {
    state.sound = !state.sound;
    saveState();
    e.currentTarget.setAttribute('aria-pressed', String(state.sound));
    if (!state.sound) window.speechSynthesis?.cancel();
    toast(state.sound ? '英文發音：開' : '英文發音：關');
  });

  // 鍵盤
  document.addEventListener('keydown', (e) => {
    const typing = /input|textarea/i.test(document.activeElement?.tagName || '');
    if (typing) return;
    if (!$('#day').hidden) {
      const items = dayOf(dayView.n)?.items || [];
      if (e.key === 'ArrowRight' && dayView.i < items.length - 1) { dayView.i += 1; renderWord(); }
      if (e.key === 'ArrowLeft' && dayView.i > 0) { dayView.i -= 1; renderWord(); }
    }
    if (!$('#reviewRun').hidden) {
      if ((e.key === ' ' || e.key === 'Enter') && !review.shown) { e.preventDefault(); showAnswer(); }
      if (review.shown && /^[1-4]$/.test(e.key)) grade(['again', 'hard', 'good', 'easy'][+e.key - 1]);
    }
  });
}

/* ------------------------------------------------------------------ 啟動 */
async function init() {
  loadState();
  $('#soundToggle').setAttribute('aria-pressed', String(state.sound));
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    toast('課程資料載入失敗，請重新整理');
    return;
  }
  if ('speechSynthesis' in window) {
    voices = window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => { voices = window.speechSynthesis.getVoices(); };
  }
  state.curDay = state.curDay || currentDayNum();
  // 數字依實際資料顯示（目前上線天數可能少於規劃的 100 天）
  const metaB = $$('.hero__meta li b');
  if (metaB[0]) metaB[0].textContent = INDEX.size + LEGACY.size;
  if (metaB[1]) metaB[1].textContent = CURR.days.length;
  const legend = $('#stageLegend');
  if (legend && CURR.days.length < 100) {
    legend.insertAdjacentHTML('beforeend',
      `<span class="stagechip buildnote">目前上線 ${CURR.days.length} 天 · ${INDEX.size} 字，其餘內容產生中</span>`);
  }
  renderTicker();
  renderPartTabs();
  renderMap();
  renderToday();
  renderStats();
  initNav();
  bindEvents();
  const legacyCount = Object.values(state.srs).filter((r) => r.legacy).length;
  if (legacyCount) setTimeout(() => toast(`已保留你之前的 ${legacyCount} 個單字進度，全部排進複習`), 900);
}

document.addEventListener('DOMContentLoaded', init);

/* =========================================================================
   帳號 / 雲端同步 / 錯題本 / 留言板 / 管理介面
   ========================================================================= */
const AUTH = { token: localStorage.getItem('tb_token') || '', user: null };
const SYNC = { timer: null, paused: false };

async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth !== false && AUTH.token) headers.authorization = 'Bearer ' + AUTH.token;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

const progressPayload = () => ({
  srs: state.srs || {}, dayDone: state.dayDone || {}, curDay: state.curDay || 1,
  partStats: state.partStats || {}, exams: state.exams || [], wrong: state.wrong || {},
  streak: state.streak || {},
});

function applyProgress(p) {
  if (!p) return;
  SYNC.paused = true;
  if (p.srs) state.srs = p.srs;
  if (p.dayDone) state.dayDone = p.dayDone;
  if (p.curDay) state.curDay = p.curDay;
  if (p.partStats) state.partStats = p.partStats;
  if (p.exams) state.exams = p.exams;
  state.wrong = p.wrong || state.wrong || {};
  if (p.streak) state.streak = p.streak;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  SYNC.paused = false;
  renderToday(); renderStats(); renderMap(); renderPartTabs(); renderWrong();
}

function schedulePush() {
  if (SYNC.paused || !AUTH.token) return;
  clearTimeout(SYNC.timer);
  SYNC.timer = setTimeout(() => { syncUp().catch(() => {}); }, 2500);
}

async function syncUp() {
  if (!AUTH.token) return;
  const r = await apiFetch('/api/progress', { method: 'PUT', body: progressPayload() });
  if (r.progress) applyProgress(r.progress);
}

/* ---------------- 錯題本 ---------------- */
function wrongAdd(word) {
  state.wrong ||= {};
  const k = String(word).toLowerCase();
  const cur = state.wrong[k] || { n: 0, last: '' };
  state.wrong[k] = { n: (cur.n || 0) + 1, last: todayISO() };
  renderWrong();
}
function wrongSoften(word) {
  state.wrong ||= {};
  const k = String(word).toLowerCase();
  const cur = state.wrong[k];
  if (!cur) return;
  cur.n = (cur.n || 0) - 1;
  if (cur.n <= 0) delete state.wrong[k];
  renderWrong();
}
function wrongSorted() {
  state.wrong ||= {};
  return Object.entries(state.wrong)
    .map(([w, r]) => ({ w, n: r.n || 1, last: r.last || '', info: lookup(w) }))
    .filter((x) => x.info)
    .sort((a, b) => b.n - a.n || String(b.last).localeCompare(String(a.last)));
}
function renderWrong() {
  const el = $('#wrongList');
  if (!el) return;
  const items = wrongSorted();
  const c = $('#wrongCount');
  if (c) c.textContent = items.length;
  el.innerHTML = items.length
    ? items.map((x) => `<div class="wrongitem">
        <div>
          <b>${esc(x.info.item.word)}</b> <span class="muted">${esc(x.info.item.zh || '')}</span>
          <div class="muted small">第 ${x.info.day || '—'} 天 · 錯 ${x.n} 次${x.last ? ' · 最後 ' + esc(x.last) : ''}</div>
        </div>
        <div class="wrongitem__btns">
          <button class="btn btn--line btn--sm" data-say="${esc(x.info.item.word)}" aria-label="發音">🔊</button>
          <button class="btn btn--mint btn--sm" data-ok="${esc(x.info.item.word)}">已記住</button>
        </div>
      </div>`).join('')
    : '<p class="empty">還沒有錯題。答錯或按「不熟」就會自動記錄在這裡。</p>';
}
function practiceWrong() {
  const words = wrongSorted().map((x) => x.w);
  if (!words.length) return toast('目前沒有錯題，先去練今天的課');
  review.queue = words.slice(0, 60);
  review.i = 0; review.shown = false; review.stats = { again: 0, hard: 0, good: 0, easy: 0 };
  $('#reviewEmpty').hidden = true; $('#reviewDone').hidden = true; $('#reviewRun').hidden = false;
  renderReview();
  $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast(`開始練 ${review.queue.length} 個容易錯的字`);
}

/* ---------------- 帳號介面 ---------------- */
function renderAuth() {
  const box = $('#authBox');
  if (!box) return;
  if (AUTH.user) {
    box.innerHTML = `<span class="pill pill--user">👤 ${esc(AUTH.user.username)}</span>
      <button class="btn btn--ghost btn--sm" id="logoutBtn">登出</button>`;
    $('#logoutBtn').addEventListener('click', doLogout);
    const navA = $('#navAdmin'); if (navA) navA.hidden = !AUTH.user.isAdmin;
    const sec = $('#admin'); if (sec) sec.hidden = !AUTH.user.isAdmin;
    if (AUTH.user.isAdmin) renderAdmin().catch(() => {});
  } else {
    box.innerHTML = '<button class="btn btn--sm btn--line" id="openAuth">登入 / 註冊</button>';
    $('#openAuth').addEventListener('click', () => openAuth('login'));
    const navA = $('#navAdmin'); if (navA) navA.hidden = true;
    const sec = $('#admin'); if (sec) sec.hidden = true;
  }
  const hint = $('#boardHint');
  if (hint) hint.textContent = AUTH.user ? `以 ${AUTH.user.username} 的身分留言` : '登入後才能留言';
}

function openAuth(mode = 'login') {
  const m = $('#authModal');
  if (!m) return;
  m.hidden = false;
  AUTH.mode = mode;
  $$('#authModal .chip').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.auth === mode)));
  $('#authSubmit').textContent = mode === 'login' ? '登入' : '建立帳號';
  $('#authPass').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  $('#authErr').hidden = true;
  setTimeout(() => $('#authUser').focus(), 50);
}
function closeAuth() { const m = $('#authModal'); if (m) m.hidden = true; }

async function doAuthSubmit(e) {
  e.preventDefault();
  const username = $('#authUser').value.trim();
  const password = $('#authPass').value;
  const err = $('#authErr');
  const btn = $('#authSubmit');
  err.hidden = true; btn.disabled = true;
  try {
    const r = await apiFetch('/api/' + (AUTH.mode === 'register' ? 'register' : 'login'),
      { method: 'POST', body: { username, password }, auth: false });
    AUTH.token = r.token; AUTH.user = r.user;
    localStorage.setItem('tb_token', r.token);
    // 把本機進度推上去（伺服器會合併），再用合併結果覆蓋
    const merged = await apiFetch('/api/progress', { method: 'PUT', body: progressPayload() });
    applyProgress(merged.progress);
    closeAuth();
    renderAuth();
    renderBoard().catch(() => {});
    toast(`歡迎，${AUTH.user.username}！進度已同步到雲端`);
    $('#authPass').value = '';
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally { btn.disabled = false; }
}

async function doLogout() {
  try { await apiFetch('/api/logout', { method: 'POST' }); } catch (e) {}
  AUTH.token = ''; AUTH.user = null;
  localStorage.removeItem('tb_token');
  renderAuth();
  toast('已登出，進度仍保留在這台裝置');
}

async function bootstrapAuth() {
  state.wrong ||= {};
  if (!AUTH.token) { renderAuth(); renderWrong(); return; }
  try {
    const me = await apiFetch('/api/me');
    AUTH.user = me.user;
    const merged = await apiFetch('/api/progress', { method: 'PUT', body: progressPayload() });
    applyProgress(merged.progress);
  } catch (e) {
    AUTH.token = ''; localStorage.removeItem('tb_token'); AUTH.user = null;
  }
  renderAuth(); renderWrong();
}

/* ---------------- 留言板 ---------------- */
async function renderBoard() {
  const list = $('#boardList');
  if (!list) return;
  let data = { messages: [] };
  try { data = await apiFetch('/api/messages', { auth: false }); } catch (e) { return; }
  const isAdmin = !!AUTH.user?.isAdmin;
  list.innerHTML = (data.messages || []).length
    ? data.messages.map((m) => `<article class="msg">
        <header><b>${esc(m.username)}</b><time>${esc(m.created_at)}</time></header>
        <p>${esc(m.body)}</p>
        ${m.admin_reply ? `<div class="msg__reply"><b>管理者回覆</b><p>${esc(m.admin_reply)}</p><time>${esc(m.replied_at || '')}</time></div>` : ''}
        ${isAdmin && !m.admin_reply ? `<button class="btn btn--line btn--sm" data-reply="${m.id}">回覆</button>` : ''}
      </article>`).join('')
    : '<p class="empty">還沒有人留言。有問題就問吧。</p>';
  if (isAdmin) {
    $$('#boardList [data-reply]').forEach((b) => b.addEventListener('click', async () => {
      const text = prompt('回覆內容：');
      if (!text) return;
      try {
        await apiFetch('/api/admin/reply', { method: 'POST', body: { id: +b.dataset.reply, reply: text } });
        toast('已回覆'); renderBoard(); renderAdmin().catch(() => {});
      } catch (e) { toast('回覆失敗：' + e.message); }
    }));
  }
  const adminPending = $('#adminPending');
  if (adminPending) {
    const pend = (data.messages || []).filter((m) => !m.admin_reply);
    adminPending.innerHTML = pend.length
      ? pend.slice(0, 8).map((m) => `<div class="pend"><b>${esc(m.username)}</b>：${esc(m.body.slice(0, 60))}
          <button class="btn btn--line btn--sm" data-reply="${m.id}">回覆</button></div>`).join('')
      : '<p class="empty">沒有待回覆的留言。</p>';
    $$('#adminPending [data-reply]').forEach((b) => b.addEventListener('click', async () => {
      const text = prompt('回覆內容：');
      if (!text) return;
      try { await apiFetch('/api/admin/reply', { method: 'POST', body: { id: +b.dataset.reply, reply: text } }); toast('已回覆'); renderBoard(); renderAdmin(); } catch (e) { toast('回覆失敗'); }
    }));
  }
}

async function submitBoard(e) {
  e.preventDefault();
  const input = $('#boardInput');
  const body = input.value.trim();
  if (!AUTH.token) { openAuth('login'); return; }
  if (body.length < 2) return toast('留言太短了');
  try {
    await apiFetch('/api/messages', { method: 'POST', body: { body } });
    input.value = '';
    toast('留言已送出');
    renderBoard();
  } catch (ex) { toast('留言失敗：' + ex.message); }
}

/* ---------------- 管理介面 ---------------- */
async function renderAdmin() {
  if (!AUTH.user?.isAdmin) return;
  const sec = $('#admin');
  if (!sec || sec.hidden) return;
  try {
    const s = await apiFetch('/api/admin/stats');
    $('#adminStats').innerHTML = `
      <div class="stat"><span>學習者總數</span><b>${s.users}</b><small>人</small></div>
      <div class="stat"><span>近 7 日活躍</span><b>${s.active7d}</b><small>人</small></div>
      <div class="stat"><span>平均已學單字</span><b>${s.avgLearned}</b><small>字</small></div>
      <div class="stat"><span>留言 / 待回覆</span><b>${s.messages}/${s.pending}</b><small>則</small></div>
      <div class="stat"><span>全站錯題</span><b>${s.wrongTotal}</b><small>筆</small></div>`;
    $('#adminTopWrong').innerHTML = (s.topWrong || []).length
      ? s.topWrong.map((x) => `<li><b>${esc(x.word)}</b> <span>${x.n} 次</span></li>`).join('')
      : '<li class="empty">還沒有資料</li>';

    const u = await apiFetch('/api/admin/users');
    $('#adminUsers').innerHTML = `<thead><tr><th>帳號</th><th>已學</th><th>完成天數</th><th>錯題</th><th>正確率</th><th>最後上線</th><th>註冊</th></tr></thead>
      <tbody>${(u.users || []).map((x) => `<tr>
        <td><b>${esc(x.username)}</b>${x.id === AUTH.user.id ? ' <span class="tag tag--level">我</span>' : ''}</td>
        <td>${x.learned}</td><td>${x.daysDone}</td><td>${x.wrong}</td>
        <td>${x.accuracy == null ? '—' : x.accuracy + '%'}</td>
        <td>${esc(x.lastSeen || '—')}</td><td>${esc(x.created || '')}</td></tr>`).join('')}</tbody>`;
    renderBoard();
  } catch (e) {
    $('#adminStats').innerHTML = `<p class="empty">載入失敗：${esc(e.message)}</p>`;
  }
}

/* ---------------- 綁事件 + 啟動 ---------------- */
function bindAccountUI() {
  $('#openAuth')?.addEventListener('click', () => openAuth('login'));
  $('#authClose')?.addEventListener('click', closeAuth);
  $('#authModal')?.addEventListener('click', (e) => { if (e.target.id === 'authModal') closeAuth(); });
  $$('#authModal .chip').forEach((b) => b.addEventListener('click', () => openAuth(b.dataset.auth)));
  $('#authForm')?.addEventListener('submit', doAuthSubmit);
  $('#boardForm')?.addEventListener('submit', submitBoard);
  $('#wrongPractice')?.addEventListener('click', practiceWrong);
  $('#wrongClear')?.addEventListener('click', () => {
    if (!confirm('清空錯題本？（不影響已學進度）')) return;
    state.wrong = {}; saveState(); renderWrong(); toast('錯題本已清空');
  });
  $('#wrongList')?.addEventListener('click', (e) => {
    const say = e.target.closest('[data-say]');
    if (say) return sayExternal(say.dataset.say);
    const ok = e.target.closest('[data-ok]');
    if (ok) { wrongSoften(ok.dataset.ok); gradeWord(ok.dataset.ok, 'good'); toast('已記錄：記住了'); }
  });
  if (AUTH.token) renderBoard().catch(() => {});
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { bindAccountUI(); bootstrapAuth(); }, 0);
});
