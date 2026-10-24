/* =========================================================================
   TOEIC BOOST — 前端邏輯（無框架、無外部依賴）
   學習進度存在 localStorage，不會上傳到任何地方。
   ========================================================================= */
'use strict';

const KEY = 'toeic-boost-v1';
const PARTS = [
  { n: 2, label: 'Part 2', sub: '應答問題' },
  { n: 3, label: 'Part 3', sub: '對話' },
  { n: 4, label: 'Part 4', sub: '短講' },
  { n: 5, label: 'Part 5', sub: '句子填空' },
  { n: 6, label: 'Part 6', sub: '段落填空' },
  { n: 7, label: 'Part 7', sub: '閱讀理解' },
];
const TASKS = [
  { key: 'vocab10', no: '01', title: '暖身單字 10 個', desc: '先聽發音再翻卡，把昨天的字叫回來。', time: '3 分鐘', cta: '開始背' },
  { key: 'part2', no: '02', title: 'Part 2 應答 5 題', desc: '最短的 Part，練抓疑問詞跟間接答句。', time: '2 分鐘', cta: '開始練' },
  { key: 'part5', no: '03', title: 'Part 5 文法 6 題', desc: '詞性、時態、被動，一眼看出空格要什麼。', time: '3 分鐘', cta: '開始練' },
  { key: 'read1', no: '04', title: '閱讀 1 篇', desc: '一篇商用文章配題組，練定位速度。', time: '4 分鐘', cta: '開始讀' },
  { key: 'quiz5', no: '05', title: '5 題綜合小考', desc: '混合各 Part 抽題，驗收今天的手感。', time: '3 分鐘', cta: '開始考' },
];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const todayISO = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------------ 狀態 */
const blankState = () => ({
  sound: true,
  streak: { count: 0, last: null },
  days: {},
  vocab: {},
  partStats: {},
  exams: [],
});
let state = blankState();

function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = Object.assign(blankState(), JSON.parse(raw));
  } catch (e) { console.warn('讀取進度失敗', e); }
}
function saveState() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('儲存失敗', e); }
}
function todayRec() {
  const d = todayISO();
  state.days[d] ||= { tasks: {}, q: 0, c: 0 };
  return state.days[d];
}
function touchDay() {
  const d = todayISO();
  if (state.streak.last === d) return;
  const y = new Date(Date.now() - 864e5).toLocaleDateString('sv-SE');
  state.streak.count = state.streak.last === y ? (state.streak.count || 0) + 1 : 1;
  state.streak.last = d;
  saveState();
}
function markTask(key) {
  touchDay();
  todayRec().tasks[key] = true;
  saveState();
  renderToday();
  renderStats();
  toast('已記錄：' + (TASKS.find((t) => t.key === key)?.title ?? key));
}
function recordAnswer(part, correct) {
  touchDay();
  const rec = todayRec();
  rec.q += 1;
  if (correct) rec.c += 1;
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
  u.pitch = 1;
  window.speechSynthesis.speak(u);
  return u;
}

/* ------------------------------------------------------------------ 資料 */
let VOCAB = [], DRILLS = [];

async function loadData() {
  const [v, l, r] = await Promise.all([
    fetch('data/vocab.json').then((x) => x.json()),
    fetch('data/drills_listen.json').then((x) => x.json()),
    fetch('data/drills_read.json').then((x) => x.json()),
  ]);
  VOCAB = Array.isArray(v) ? v : v.words || [];
  DRILLS = [...(l.questions || []), ...(r.questions || [])];
}
const byPart = (n) => DRILLS.filter((q) => q.part === n);

/* ------------------------------------------------------------------ 跑馬燈 */
function renderTicker() {
  const words = shuffle(VOCAB).slice(0, 14);
  const bits = words.map((w) => `<span><b>${esc(w.w)}</b> <i>${esc(w.zh.split('；')[0])}</i></span>`).join('<span aria-hidden="true">·</span>');
  $('#tickerTrack').innerHTML = bits + '<span aria-hidden="true">·</span>' + bits;
}

/* ------------------------------------------------------------------ 今日 */
function renderToday() {
  const t = todayRec();
  const doneN = TASKS.filter((x) => t.tasks[x.key]).length;
  const pct = Math.round((doneN / TASKS.length) * 100);

  $('#planGrid').innerHTML = TASKS.map((task, i) => {
    const done = !!t.tasks[task.key];
    const total = parseInt(task.title.match(/(\d+)/)?.[1] ?? '1', 10);
    const step = Math.min(total, Math.round(((i + 1) / TASKS.length) * total));
    return `<article class="plan__card ${done ? 'is-done' : ''}">
      <span class="plan__no">STEP ${task.no} · ${esc(task.time)}</span>
      <h3>${esc(task.title)}</h3>
      <p>${esc(task.desc)}</p>
      <span class="plan__time">${done ? `${step} 題完成` : '未開始'}</span>
      <button class="btn btn--sm ${done ? 'btn--line' : 'btn--primary'}" data-start="${task.key}">${done ? '再練一次' : task.cta}</button>
    </article>`;
  }).join('');

  $('#ringPct').textContent = pct + '%';
  $('#ringFg').style.strokeDashoffset = String(327 - (327 * pct) / 100);
  $('#streakNum').textContent = state.streak.last === todayISO() ? state.streak.count : (state.streak.count || 0);
  $('#todayDate').textContent = new Date().toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' });
  $('#todayMini').innerHTML = TASKS.map((x) => `<li class="${t.tasks[x.key] ? 'is-done' : ''}"><span>${esc(x.title)}</span><span>${t.tasks[x.key] ? '✓' : '—'}</span></li>`).join('');

  const acc = t.q ? Math.round((t.c / t.q) * 100) + '%' : '—';
  $('#miniAcc').textContent = acc;
  $('#miniVocab').textContent = Object.values(state.vocab).filter((v) => (v.box || 0) >= 3).length;
}

/* ------------------------------------------------------------------ 單字卡 */
let deck = [], di = 0, catFilter = '全部', reviewOnly = false, vocabSession = null;

function buildDeck() {
  let pool = VOCAB.slice();
  if (catFilter !== '全部') pool = pool.filter((w) => w.cat === catFilter);
  if (reviewOnly) pool = pool.filter((w) => (state.vocab[w.w]?.box || 0) < 3);
  const rank = (w) => state.vocab[w.w]?.box ?? 0;
  deck = pool.sort((a, b) => rank(a) - rank(b) || Math.random() - 0.5);
  if (vocabSession) deck = vocabSession.words.slice();
  di = 0;
  renderVocab();
}

function renderVocab() {
  const card = $('#flashCard');
  card.classList.remove('is-flipped');
  const w = deck[di];
  const total = vocabSession ? vocabSession.words.length : deck.length;

  $('#vocabIdx').textContent = deck.length ? di + 1 : 0;
  $('#vocabTotal').textContent = total;
  $('#vocabBar').style.width = total ? ((di / total) * 100).toFixed(1) + '%' : '0%';
  $('#vocabMastered').textContent = Object.values(state.vocab).filter((v) => (v.box || 0) >= 3).length;

  if (!w) {
    $('#flashWord').textContent = '這個分類沒有單字';
    $('#flashCat').textContent = '—'; $('#flashCatBack').textContent = '—';
    $('#flashPh').textContent = ''; $('#flashZh').textContent = '—';
    $('#flashEx').textContent = ''; $('#flashEzh').textContent = '';
    return;
  }
  $('#flashCat').textContent = w.cat;
  $('#flashCatBack').textContent = `${w.cat} · ${w.pos}`;
  $('#flashWord').textContent = w.w;
  $('#flashPh').textContent = w.ph ? `/${w.ph}/` : '';
  $('#flashZh').textContent = w.zh;
  $('#flashEx').textContent = w.ex;
  $('#flashEzh').textContent = w.ezh;

  const box = state.vocab[w.w]?.box ?? 0;
  const boxLabel = ['沒印象', '看過 1 次', '有點熟', '已熟練'][clamp(box, 0, 3)];
  $('#vocabStats').innerHTML = `
    <div><span>這個字</span><b>${boxLabel}</b></div>
    <div><span>分類</span><b>${esc(w.cat)}</b></div>`;
}

function rateVocab(remember) {
  const w = deck[di];
  if (!w) return;
  const rec = (state.vocab[w.w] ||= { box: 0, seen: 0 });
  rec.seen += 1;
  rec.box = remember ? clamp((rec.box || 0) + 1, 0, 3) : 0;
  if (!remember) deck.push(w);
  saveState();

  if (vocabSession) {
    vocabSession.done += 1;
    if (vocabSession.done >= vocabSession.target) {
      const key = vocabSession.taskKey;
      vocabSession = null;
      buildDeck();
      if (key) markTask(key);
      toast('暖身完成，繼續下一格吧');
      return;
    }
  }
  di = Math.min(di + 1, deck.length - 1);
  renderVocab();
}

/* ------------------------------------------------------------------ 練習引擎 */
const session = {
  queue: [], idx: 0, picked: null, checked: false, taskKey: null, title: '', finished: false,
};

function startDrill(part, limit, taskKey, title) {
  let pool = part ? byPart(part) : DRILLS.slice();
  if (part === 6 || part === 7) {
    // 同組同篇文章保持相鄰
    const groups = {};
    pool.forEach((q) => { (groups[q.group || q.id] ||= []).push(q); });
    pool = shuffle(Object.values(groups)).flat();
  } else {
    pool = shuffle(pool);
  }
  if (limit) pool = pool.slice(0, limit);
  Object.assign(session, { queue: pool, idx: 0, picked: null, checked: false, taskKey: taskKey || null, title: title || '', finished: false });
  $('#practiceEmpty').hidden = true;
  $('#qbox').hidden = false;
  renderQuestion();
  if (part) selectPartTab(part);
  $('#drills').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderQuestion() {
  const q = session.queue[session.idx];
  if (!q) return finishSession();
  session.picked = null;
  session.checked = false;

  $('#qPart').textContent = 'Part ' + q.part;
  $('#qCat').textContent = q.cat || '綜合';
  $('#qTally').textContent = `${session.idx + 1} / ${session.queue.length}` + (session.title ? ` · ${session.title}` : '');
  $('#qQuestion').textContent = q.question;

  const needsAudio = q.audio && q.audio.trim();
  $('#qAudioWrap').hidden = !needsAudio;
  if (needsAudio) {
    $('#qAudioNote').textContent = q.part === 2 ? '點播放聽一次問句，再選最適合的回應' : '點播放聽對話／短講，可重播';
  }

  const passage = (q.passage && q.passage.trim()) ? q.passage : '';
  $('#qPassage').hidden = !passage || q.part === 3 || q.part === 4;
  $('#qPassage').textContent = (passage && q.part !== 3 && q.part !== 4) ? passage : '';

  $('#qOptions').innerHTML = q.options.map((opt, i) =>
    `<button class="option" data-opt="${i}"><span class="option__key">${'ABCD'[i]}</span><span>${esc(opt)}</span></button>`
  ).join('');

  $('#qFeedback').hidden = true;
  $('#qCheck').disabled = true;
  $('#qCheck').hidden = false;
  $('#qNext').hidden = true;

  const tr = $('#qTranscript');
  if ((q.part === 3 || q.part === 4) && q.passage) {
    tr.hidden = false;
    $('#qTranscriptBody').textContent = q.passage;
  } else { tr.hidden = true; }

  if (needsAudio && (q.part === 2 || q.part === 3 || q.part === 4)) autoPlay(q);
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
    b.disabled = true;
    b.classList.remove('is-picked');
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

  const tr = $('#qTranscript');
  if ((q.part === 3 || q.part === 4) && q.passage) { tr.hidden = false; $('#qTranscriptBody').textContent = q.passage; }

  recordAnswer(q.part, ok);
  if ((q.part === 3 || q.part === 4) && !ok) speak(q.audio, { rate: 0.9 });

  $('#qCheck').hidden = true;
  $('#qNext').hidden = false;
  $('#qNext').textContent = session.idx + 1 >= session.queue.length ? '看結果 →' : '下一題 →';
  renderStats();
  renderToday();
}

function nextQuestion() {
  session.idx += 1;
  if (session.idx >= session.queue.length) return finishSession();
  renderQuestion();
}

function finishSession() {
  const key = session.taskKey;
  session.taskKey = null;
  $('#qbox').hidden = true;
  $('#practiceEmpty').hidden = false;
  $('#practiceEmpty').innerHTML = `<p class="practice__emptyIcon" aria-hidden="true">🎉</p>
    <h3>這一輪完成了</h3>
    <p class="muted">再挑一個 Part，或去「我的進度」看看正確率。</p>
    <button class="btn btn--line btn--sm" id="againBtn">再練一輪</button>`;
  $('#againBtn')?.addEventListener('click', () => startDrill(null, 10));
  if (key) markTask(key);
  renderStats();
}

/* ------------------------------------------------------------------ Part tabs */
function renderPartTabs() {
  $('#partTabs').innerHTML = PARTS.map((p) => {
    const st = state.partStats[p.n];
    const acc = st && st.n ? Math.round((st.c / st.n) * 100) + '%' : '未練';
    return `<button class="parttab" role="tab" data-part="${p.n}" aria-selected="false">
      ${p.label}<small>${p.sub} · ${acc}</small></button>`;
  }).join('');
}
function selectPartTab(n) {
  $$('.parttab').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.part === n)));
}

/* ------------------------------------------------------------------ 模考 */
const exam = { list: [], idx: 0, ans: [], left: 0, timer: null, running: false };

function startExam() {
  exam.list = shuffle(DRILLS).slice(0, 10);
  exam.idx = 0; exam.ans = []; exam.left = 5 * 60; exam.running = true;
  $('#examStart').hidden = true;
  $('#examResult').hidden = true;
  $('#examRun').hidden = false;
  renderExamQ();
  tickExam();
  exam.timer = setInterval(tickExam, 1000);
}
function tickExam() {
  const m = String(Math.floor(exam.left / 60)).padStart(2, '0');
  const s = String(exam.left % 60).padStart(2, '0');
  const t = $('#examTimer');
  t.textContent = `${m}:${s}`;
  t.classList.toggle('is-low', exam.left <= 30);
  if (exam.left <= 0) return endExam();
  exam.left -= 1;
}
function renderExamQ() {
  const q = exam.list[exam.idx];
  $('#examIdx').textContent = exam.idx + 1;
  $('#examLen').textContent = exam.list.length;
  $('#examQuestion').textContent = q.question + (q.part >= 6 && q.passage ? '\n\n' + q.passage : '');
  $('#examQuestion').style.whiteSpace = 'pre-wrap';
  $('#examOptions').innerHTML = q.options.map((o, i) =>
    `<button class="option" data-eopt="${i}"><span class="option__key">${'ABCD'[i]}</span><span>${esc(o)}</span></button>`
  ).join('');
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
  exam.running = false;
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
  const rec = { date: todayISO(), score, correct, total: exam.list.length, byPart };
  state.exams.unshift(rec);
  state.exams = state.exams.slice(0, 12);
  saveState();

  const rank = score >= 90 ? '可以直接上考場了' : score >= 70 ? '基礎穩了，再練速度' : score >= 50 ? '有底子，弱點要補' : '先把單字量補起來';
  const partRows = Object.entries(byPart).map(([p, s]) => {
    const acc = Math.round((s.c / s.n) * 100);
    const cls = acc >= 80 ? 'tag--good' : acc < 50 ? 'tag--bad' : '';
    return `<span class="tag ${cls}">Part ${p} ${s.c}/${s.n}</span>`;
  }).join('');

  $('#examResult').innerHTML = `
    <div class="exam__score"><b>${score}</b><div>
      <span>分 · 答對 ${correct} / ${exam.list.length} 題</span><br/>
      <span>${rank}</span></div></div>
    <div class="exam__weak">${partRows}</div>
    <div class="qbox__foot"><button class="btn btn--accent" id="examAgain">再考一次</button>
    <a class="btn btn--line" href="#progress">看累積進度</a></div>`;
  $('#examAgain').addEventListener('click', startExam);
  renderStats(); renderToday(); renderExamList(); renderPartTabs();
}

/* ------------------------------------------------------------------ 進度 */
function renderStats() {
  const all = Object.values(state.partStats).reduce((a, s) => ({ n: a.n + s.n, c: a.c + s.c }), { n: 0, c: 0 });
  const acc = all.n ? Math.round((all.c / all.n) * 100) : 0;
  const mastered = Object.values(state.vocab).filter((v) => (v.box || 0) >= 3).length;
  const seen = Object.keys(state.vocab).length;

  $('#statGrid').innerHTML = `
    <div class="stat"><span>連續學習</span><b>${state.streak.last === todayISO() ? state.streak.count : 0}</b><small>天</small></div>
    <div class="stat"><span>累計作答</span><b>${all.n}</b><small>題</small></div>
    <div class="stat"><span>整體正確率</span><b>${all.n ? acc : '—'}</b><small>%</small></div>
    <div class="stat"><span>熟練單字</span><b>${mastered}</b><small>/ ${seen || 0} 看過</small></div>
    <div class="stat"><span>模考次數</span><b>${state.exams.length}</b><small>次</small></div>`;

  $('#partBars').innerHTML = PARTS.map((p) => {
    const s = state.partStats[p.n];
    const acc2 = s && s.n ? Math.round((s.c / s.n) * 100) : 0;
    const cls = !s || !s.n ? '' : acc2 >= 80 ? 'high' : acc2 >= 50 ? 'mid' : 'low';
    return `<div class="bar"><div class="bar__top"><span>${p.label} ${p.sub}</span><span>${s && s.n ? acc2 + '%（' + s.n + ' 題）' : '未練'}</span></div>
      <div class="bar__track"><i class="bar__fill ${cls}" style="width:${acc2}%"></i></div></div>`;
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
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 2200);
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

function bindEvents() {
  // 今日課表
  $('#planGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-start]');
    if (!btn) return;
    const key = btn.dataset.start;
    if (key === 'vocab10') startVocabSession(10, key);
    else if (key === 'part2') startDrill(2, 5, key, '今日 Part 2');
    else if (key === 'part5') startDrill(5, 6, key, '今日 Part 5');
    else if (key === 'read1') {
      const g = shuffle(Object.values(byPart(7).reduce((a, q) => ((a[q.group || q.id] ||= []).push(q), a), {})))[0] || [];
      Object.assign(session, { queue: g, idx: 0, picked: null, checked: false, taskKey: key, title: '今日閱讀', finished: false });
      $('#practiceEmpty').hidden = true; $('#qbox').hidden = false; renderQuestion();
      $('#drills').scrollIntoView({ behavior: 'smooth' });
      selectPartTab(7);
    } else if (key === 'quiz5') startDrill(null, 5, key, '今日小考');
  });

  $('#heroStart').addEventListener('click', () => {
    const t = todayRec();
    const next = TASKS.find((x) => !t.tasks[x.key]);
    if (!next) { $('#progress').scrollIntoView({ behavior: 'smooth' }); toast('今天五格都完成了 🎉'); return; }
    $(`[data-start="${next.key}"]`)?.click();
  });

  // 單字卡
  $('#flashCard').addEventListener('click', (e) => {
    if (e.target.closest('.speak')) return;
    toggleFlip();
  });
  $('#flashCard').addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleFlip(); }
  });
  $('#flashSpeak').addEventListener('click', (e) => { e.stopPropagation(); const w = deck[di]; if (w) speak(`${w.w}. ${w.ex}`); });
  $('#vocabKnow').addEventListener('click', () => rateVocab(true));
  $('#vocabForget').addEventListener('click', () => rateVocab(false));
  $('#vocabReviewBtn').addEventListener('click', () => {
    reviewOnly = !reviewOnly;
    $('#vocabReviewBtn').textContent = reviewOnly ? '看全部分類' : '只練複習池';
    vocabSession = null;
    buildDeck();
  });
  $('#vocabCats').addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]');
    if (!c) return;
    catFilter = c.dataset.cat;
    vocabSession = null;
    $$('#vocabCats .chip').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.cat === catFilter)));
    buildDeck();
  });

  // 練習
  $('#partTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-part]');
    if (!b) return;
    startDrill(+b.dataset.part, null, null, '');
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
    const u = speak(q.audio);
    if (u) u.onend = () => wrap.classList.remove('is-playing');
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
    if (q && q.audio) speak(q.audio, { rate: 0.92 });
  });

  // 進度
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('確定要清空所有學習進度嗎？（單字熟練度、正確率、模考紀錄都會消失）')) return;
    localStorage.removeItem(KEY);
    state = blankState();
    saveState();
    vocabSession = null; reviewOnly = false;
    buildDeck(); renderToday(); renderStats(); renderPartTabs();
    toast('進度已重設');
  });

  // 發音開關
  $('#soundToggle').addEventListener('click', (e) => {
    state.sound = !state.sound;
    saveState();
    e.currentTarget.setAttribute('aria-pressed', String(state.sound));
    if (!state.sound) window.speechSynthesis?.cancel();
    toast(state.sound ? '英文發音：開' : '英文發音：關');
  });

  // 鍵盤
  document.addEventListener('keydown', (e) => {
    if ($('#drills').contains(document.activeElement) || document.activeElement === document.body) {
      const q = session.queue[session.idx];
      if (!q || $('#qbox').hidden) return;
      if (/^[1-4]$/.test(e.key)) { const i = +e.key - 1; if (i < q.options.length) pickOption(i); }
      if (e.key === 'Enter') { e.preventDefault(); session.checked ? nextQuestion() : ($('#qCheck').disabled ? null : checkAnswer()); }
    }
  });
}

function toggleFlip() {
  $('#flashCard').classList.toggle('is-flipped');
}

function startVocabSession(n, taskKey) {
  const words = deck.length >= n ? shuffle(deck).slice(0, n) : shuffle(VOCAB).slice(0, n);
  vocabSession = { words, target: n, done: 0, taskKey };
  deck = words.slice();
  di = 0;
  renderVocab();
  $('#vocab').scrollIntoView({ behavior: 'smooth' });
  toast(`開始暖身：${n} 個單字`);
}

/* ------------------------------------------------------------------ 啟動 */
async function init() {
  loadState();
  $('#soundToggle').setAttribute('aria-pressed', String(state.sound));
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    toast('題庫載入失敗，請重新整理');
    return;
  }
  if ('speechSynthesis' in window) {
    voices = window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => { voices = window.speechSynthesis.getVoices(); };
  }

  renderTicker();
  renderPartTabs();
  renderStats();
  renderToday();
  renderExamList();
  initNav();

  const cats = ['全部', ...new Set(VOCAB.map((w) => w.cat))];
  $('#vocabCats').innerHTML = cats.map((c) =>
    `<button class="chip" role="tab" data-cat="${esc(c)}" aria-selected="${c === '全部'}">${esc(c)}</button>`).join('');
  buildDeck();
  bindEvents();
  renderVocab();
}

document.addEventListener('DOMContentLoaded', init);
