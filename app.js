// Плеер фонограмм. Страница раздела задаёт window.FONO = {root, sections:[{id,name}]},
// общая страница Светы — ещё admin:true и оба раздела.
const CFG = window.FONO, SECS = CFG.sections;
// Значки рисуем сами: символы ▶ ⏮ ⏸ ⏭ iPhone показывает цветными эмодзи.
const svg = (d, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const IC = {
  play: svg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>'),
  pause: svg('<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>'),
  prev: svg('<rect x="5" y="5.5" width="2.6" height="13" rx="1"/><path d="M19 6.6v10.8a1 1 0 0 1-1.55.83L9.6 13a1.2 1.2 0 0 1 0-2l7.85-5.23A1 1 0 0 1 19 6.6z"/>'),
  next: svg('<rect x="16.4" y="5.5" width="2.6" height="13" rx="1"/><path d="M5 6.6v10.8a1 1 0 0 0 1.55.83L14.4 13a1.2 1.2 0 0 0 0-2L6.55 5.77A1 1 0 0 0 5 6.6z"/>'),
  down: svg('<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  eq: svg('<rect x="4" y="6" width="3.5" height="14" rx="1"/><rect x="10.25" y="6" width="3.5" height="14" rx="1"/><rect x="16.5" y="6" width="3.5" height="14" rx="1"/>', 'eq'),
};
const FIRST_TITLE = CFG.admin ? 'Фонограммы' : SECS[0].name;
document.body.insertAdjacentHTML('afterbegin', `
<div class="secs" id="secs"></div>
<header><h1 id="title">${FIRST_TITLE}</h1><div class="sub" id="status"></div></header>
<div id="links"></div>
<div class="tabs" id="tabs"></div>
<div class="bar" id="actions"></div>
<div id="editPanel"></div>
<ol id="list"><div class="empty">Загружаю треки…</div></ol>
<footer><button id="editToggle">✎ редактор</button>${CFG.admin ? `<div class="ver">версия ${CFG.v || 1}</div>` : ''}</footer>
<div class="player">
  <div class="ptitle" id="ptitle">Нажми на трек</div>
  <input type="range" id="seek" min="0" max="1000" value="0">
  <div class="ptime"><span id="tcur">0:00</span><span id="tdur">0:00</span></div>
  <div class="ctrl">
    <button id="prev" aria-label="Предыдущий">${IC.prev}</button>
    <button id="play" class="play" aria-label="Играть">${IC.play}</button>
    <button id="next" aria-label="Следующий">${IC.next}</button>
    <button id="rep" class="rep" aria-label="Повтор трека">повтор</button>
  </div>
</div>
<audio id="audio" preload="auto" playsinline></audio>
<input type="file" id="file" accept="audio/*,.mp3,.m4a,.wav,.aac" hidden>
<div class="toast" id="toast"></div>`);

const $ = s => document.querySelector(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem('fono.' + k); return v == null ? d : JSON.parse(v) } catch { return d } },
  set(k, v) { try { localStorage.setItem('fono.' + k, JSON.stringify(v)) } catch {} },
  del(k) { try { localStorage.removeItem('fono.' + k) } catch {} }
};
const AUDIO_CACHE = 'fono-audio';
const audio = $('#audio');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const today = () => new Date().toISOString().slice(0, 10);
const ddmm = d => d ? d.slice(8, 10) + '.' + d.slice(5, 7) : '';
const fmt = s => isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '0:00';
const abs = f => new URL(f, location.href).href;

let sec = CFG.admin ? Math.min(LS.get('sec', 0), SECS.length - 1) : 0;
const S = () => SECS[sec];
const local = f => (CFG.admin ? S().id + '/' : '') + f;   // адрес файла относительно этой страницы
const repoPath = f => S().id + '/' + f;                     // путь файла в репозитории

let data = null, offline = false;
let cur = 0;
let playing = null;          // {list, i, id, base, name}
let repeatOne = false;
let cached = new Set();
let seen = LS.get('seen', null), firstVisit = !seen; seen = seen || {};
// редактор
let edit = false, token = LS.get('token', ''), dirty = false, pending = {}, fileTarget = null, saving = false;

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), ms);
}
const pl = () => data && data.playlists[Math.min(cur, data.playlists.length - 1)];

async function load() {
  cur = LS.get('pl.' + S().id, 0);
  if (CFG.admin && !token) {
    $('#title').textContent = 'Фонограммы';
    $('#list').innerHTML = '<div class="empty">Это служебная страница.<br>Открой ссылку своего раздела — её присылает Света.</div>';
    return;
  }
  try {
    const r = await fetch(local('data/playlists.json') + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw 0;
    data = await r.json(); offline = false; LS.set('data.' + S().id, data);
  } catch {
    data = LS.get('data.' + S().id, null); offline = true;
  }
  if (!data) { $('#list').innerHTML = '<div class="empty">Нет интернета и нет сохранённого списка.<br>Открой один раз онлайн.</div>'; return }
  if (firstVisit) {   // в первый раз всё «новое» — значит, ничего не новое
    data.playlists.forEach(p => p.tracks.forEach(t => { seen[t.id] = t.file }));
    LS.set('seen', seen); firstVisit = false;
  }
  await refreshCached();
  probeDurations();
  render();
}

async function refreshCached() {
  if (!('caches' in window)) return;
  try {
    const c = await caches.open(AUDIO_CACHE);
    cached = new Set((await c.keys()).map(k => k.url.split('?')[0]));
  } catch {}
}

function allFiles() {
  const s = new Set();
  data.playlists.forEach(p => p.tracks.forEach(t => s.add(abs(local(t.file)))));
  return s;
}

// Длительность: из списка (пишется при загрузке), иначе узнаём у файла и запоминаем в телефоне.
let durs = LS.get('dur', {});
const durOf = t => t.dur || durs[t.file];
function fileDuration(src) {
  return new Promise(res => {
    const a = new Audio(); a.preload = 'metadata';
    const done = v => { a.removeAttribute('src'); a.load(); res(v) };
    a.onloadedmetadata = () => done(isFinite(a.duration) ? Math.floor(a.duration) : 0);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 15000);
    a.src = src;
  });
}
async function probeDurations() {
  if (probeDurations.busy) return; probeDurations.busy = true;
  try {
    const d0 = data, base = local('');   // раздел могут переключить, пока узнаём
    for (const p of d0.playlists) for (const t of p.tracks) {
      if (data !== d0) return;
      if (durOf(t) || pending[t.id]) continue;
      const d = await fileDuration(base + t.file);
      if (d) { durs[t.file] = d; LS.set('dur', durs); render() }
    }
  } finally { probeDurations.busy = false }
}

function isNew(t) {
  if (!t.updated || seen[t.id] === t.file) return false;
  return (Date.now() - new Date(t.updated)) / 864e5 < 14;
}

function render() {
  const p = pl();
  $('#secs').innerHTML = CFG.admin
    ? SECS.map((s, i) => `<button class="sec${i === sec ? ' on' : ''}" data-sec="${i}">${esc(s.name)}</button>`).join('') : '';
  $('#links').innerHTML = CFG.admin && !edit
    ? `<div class="links">Ссылка для группы «${esc(S().name)}»: <b>${esc(abs(S().id + '/'))}</b> <button class="btn" data-act="copy">копировать</button></div>` : '';
  $('#tabs').innerHTML = data.playlists.length > 1 || edit
    ? data.playlists.map((q, i) => `<button class="tab${q === p ? ' on' : ''}" data-pl="${i}">${esc(q.name)}</button>`).join('')
      + (edit ? '<button class="tab" data-act="addpl">＋ список</button>' : '')
    : '';
  $('#title').textContent = p ? p.name : S().name;
  document.title = S().name + ' · фонограммы';

  const files = allFiles();
  const missing = [...files].filter(f => !cached.has(f)).length;
  let st = offline ? 'без интернета · играют сохранённые треки' : (p ? p.tracks.length + ' тр.' : '');
  if (data.updated) st += ' · обновлено ' + ddmm(data.updated);
  $('#status').textContent = st;

  let acts = '';
  if (!edit) {
    acts += `<button class="btn main" data-act="playall">${IC.play}Прогон с начала</button>`;
    if (CFG.admin && token) acts += `<button class="btn" data-act="edit">✎ Редактировать</button>`;
    if ('caches' in window && files.size) acts += missing
      ? `<button class="btn" data-act="dl">${IC.down}В телефон (${missing})</button>`
      : `<button class="btn" disabled>✓ Всё в телефоне</button>`;
  } else {
    acts += `<button class="btn main" data-act="add">＋ трек</button>`;
    acts += `<button class="btn" disabled>${saving || (dirty && !saveError) ? '⏳ Отправляю…' : saveError ? '⚠ Не отправлено' : '✓ Всё на сайте'}</button>`;
    if (p) acts += `<button class="btn" data-act="renpl">✎ название</button><button class="btn" data-act="delpl">✕ список</button>`;
  }
  $('#actions').innerHTML = acts;

  if (!p || !p.tracks.length) { $('#list').innerHTML = `<div class="empty">${edit ? (p ? 'Пусто. Нажми «＋ трек».' : 'Нажми «＋ список».') : 'Треков пока нет.'}</div>`; return }
  $('#list').innerHTML = p.tracks.map((t, i) => {
    const now = playing && playing.id === t.id;
    const meta = [];
    if (pending[t.id]) meta.push('<span class="badge">⏳ отправляется</span>');
    else if (isNew(t)) meta.push(`<span class="badge">● новая версия ${ddmm(t.updated)}</span>`);
    if (t.note) meta.push(esc(t.note));
    if (!edit && cached.has(abs(local(t.file)))) meta.push('<span class="saved">✓ в телефоне</span>');
    const ed = edit ? `<div class="ed">
      <button data-ed="up" data-i="${i}" aria-label="Выше">↑</button>
      <button data-ed="down" data-i="${i}" aria-label="Ниже">↓</button>
      <button data-ed="ren" data-i="${i}" aria-label="Название и заметка">✎</button>
      <button data-ed="rep" data-i="${i}" aria-label="Заменить файл">⟳</button>
      <button data-ed="del" data-i="${i}" class="del" aria-label="Удалить">🗑</button></div>`
      : CFG.admin && token ? `<div class="ed"><button data-qdel="${esc(t.id)}" class="del" aria-label="Удалить">🗑</button></div>` : '';
    return `<li class="tr${now ? ' now' : ''}" data-i="${i}">
      <div class="n">${now && !audio.paused ? IC.eq : i + 1}</div>
      <div class="info"><div class="t">${esc(t.title)}</div>${meta.length ? `<div class="meta">${meta.join('<span>·</span>')}</div>` : ''}</div>${!edit && durOf(t) ? `<div class="dur">${fmt(durOf(t))}</div>` : ''}${ed}</li>`;
  }).join('');
}

/* ---------- плеер ---------- */
// Играет из «снимка» списка, чтобы переключение раздела или вкладки не сбивало прогон.
function playFrom(list, i, base, name) {
  if (i < 0 || i >= list.length) { audio.pause(); return }
  const t = list[i];
  if (pending[t.id]) { toast('Трек ещё отправляется'); return }
  playing = { list, i, id: t.id, base, name };
  audio.src = base + t.file;
  audio.play().catch(() => {});
  seen[t.id] = t.file; LS.set('seen', seen);
  $('#ptitle').textContent = (i + 1) + '. ' + t.title;
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: name, album: 'Фонограммы' });
  if (data) render();
}
function playAt(i) { const p = pl(); if (p) playFrom(p.tracks, i, local(''), p.name) }
function step(d) {
  if (!playing) return playAt(0);
  playFrom(playing.list, playing.i + d, playing.base, playing.name);
}
audio.addEventListener('ended', () => {
  if (repeatOne) { audio.currentTime = 0; audio.play(); return }
  if (playing.i + 1 < playing.list.length) step(1);
  else { playing = null; $('#ptitle').textContent = 'Прогон закончен'; if (data) render() }
});
audio.addEventListener('play', () => { $('#play').innerHTML = IC.pause; if (data) render() });
audio.addEventListener('pause', () => { $('#play').innerHTML = IC.play; if (data) render() });
audio.addEventListener('error', () => { if (audio.src) toast(offline ? 'Этот трек не сохранён в телефон' : 'Не получилось загрузить трек') });
audio.addEventListener('timeupdate', () => {
  if (!seeking && audio.duration) $('#seek').value = audio.currentTime / audio.duration * 1000;
  $('#tcur').textContent = fmt(audio.currentTime); $('#tdur').textContent = fmt(audio.duration);
});
let seeking = false;
$('#seek').addEventListener('input', () => { seeking = true; if (audio.duration) $('#tcur').textContent = fmt($('#seek').value / 1000 * audio.duration) });
$('#seek').addEventListener('change', () => { if (audio.duration) audio.currentTime = $('#seek').value / 1000 * audio.duration; seeking = false });
$('#play').onclick = () => { if (!playing) return playAt(0); audio.paused ? audio.play() : audio.pause() };
$('#prev').onclick = () => { if (audio.currentTime > 3) audio.currentTime = 0; else step(-1) };
$('#next').onclick = () => step(1);
$('#rep').onclick = () => { repeatOne = !repeatOne; $('#rep').classList.toggle('on', repeatOne) };
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => audio.play());
  ms.setActionHandler('pause', () => audio.pause());
  ms.setActionHandler('previoustrack', () => step(-1));
  ms.setActionHandler('nexttrack', () => step(1));
  try { ms.setActionHandler('seekto', e => { audio.currentTime = e.seekTime }) } catch {}
}

/* ---------- офлайн ---------- */
async function download() {
  const c = await caches.open(AUDIO_CACHE);
  const need = [...allFiles()].filter(f => !cached.has(f));
  let done = 0, fail = 0;
  for (const f of need) {
    $('#status').textContent = `Сохраняю в телефон ${done + 1} из ${need.length}…`;
    try { const r = await fetch(f, { cache: 'no-store' }); if (!r.ok) throw 0; await c.put(f, r); done++ } catch { fail++ }
  }
  // убрать старые версии этого раздела, которых больше нет в списках
  const keep = allFiles(), mine = '/' + S().id + '/';
  for (const k of await c.keys()) { const u = k.url.split('?')[0]; if (u.includes(mine) && !keep.has(u)) await c.delete(k) }
  await refreshCached(); render();
  toast(fail ? `Сохранено ${done}, не вышло ${fail} — проверь интернет` : 'Все треки в телефоне, можно без интернета');
}

/* ---------- редактор (GitHub) ---------- */
function repoInfo() {
  const h = location.hostname;
  if (h.endsWith('.github.io')) return { owner: h.split('.')[0], repo: location.pathname.split('/')[1] || h };
  return LS.get('repo', null);
}
async function api(path, opt = {}) {
  const R = repoInfo();
  const r = await fetch(`https://api.github.com/repos/${R.owner}/${R.repo}/contents/${path}`, {
    method: opt.method || 'GET',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
    cache: 'no-store'
  }).catch(() => { throw new Error('нет связи с GitHub — проверь интернет') });
  if (r.status === 404 && opt.allow404) return null;
  if (r.status === 401) throw new Error('ключ не подходит или истёк');
  if (r.status === 403 || r.status === 404) throw new Error('у ключа нет доступа к fonogrammy — нужно Contents: Read and write');
  if (r.status === 413 || r.status === 422) throw new Error('файл слишком большой для загрузки, сожми в mp3 (до 20 МБ)');
  if (!r.ok) throw new Error('GitHub ответил ' + r.status);
  return r.json();
}
const encUtf8 = s => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin) };
const decUtf8 = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), c => c.charCodeAt(0)));
const fileB64 = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = no; r.readAsDataURL(f) });

async function enterEdit() {
  if (!repoInfo() || !token) return showTokenPanel();
  try {
    $('#status').textContent = 'Открываю редактор…';
    const j = await api(repoPath('data/playlists.json'));
    data = JSON.parse(decUtf8(j.content));
    edit = true; dirty = false; pending = {}; saveError = '';
    $('#editPanel').innerHTML = '';
    $('#editToggle').textContent = '✓ выйти из редактора';
    render();
  } catch (e) {
    // редактор не открылся — показать раздел в обычном режиме, а не оставлять старый
    edit = false; $('#editToggle').textContent = '✎ редактор';
    await load(); toast('Редактор: ' + e.message, 5000); showTokenPanel();
  }
}
function exitEdit() {
  if ((dirty || saving) && !confirm('Ещё не всё отправлено на сайт. Всё равно выйти? Неотправленное пропадёт.')) return;
  edit = false; dirty = false; pending = {};
  $('#editToggle').textContent = '✎ редактор';
  load();
}
function showTokenPanel() {
  const local = !location.hostname.endsWith('.github.io');
  $('#editPanel').innerHTML = `<div class="panel">
    <p>Редактор только для Светы. Вставь токен GitHub — он сохранится в этом телефоне.</p>
    ${local ? '<input id="repoIn" placeholder="владелец/репозиторий">' : ''}
    <input id="tokIn" type="password" placeholder="github_pat_…" autocomplete="off">
    <button class="btn main" id="tokOk">Войти</button>
    ${token ? '<button class="btn" id="tokForget">Забыть токен</button>' : ''}
  </div>`;
  $('#tokOk').onclick = () => {
    if (local) { const [owner, repo] = ($('#repoIn').value || '').trim().split('/'); LS.set('repo', { owner, repo }) }
    token = $('#tokIn').value.trim(); LS.set('token', token); enterEdit();
  };
  if ($('#tokForget')) $('#tokForget').onclick = () => { token = ''; LS.del('token'); $('#editPanel').innerHTML = ''; toast('Токен удалён из телефона'); load() };
}
// Каждое изменение отправляется само через пару секунд — отдельной кнопки «сохранить» нет.
let changeNo = 0, saveTimer = null, saveError = '';
async function quickDelete(id) {
  const t = pl().tracks.find(x => x.id === id);
  if (!t || !confirm(`Удалить «${t.title}»? У ребят он тоже пропадёт.`)) return;
  await enterEdit();
  if (!edit) return;
  for (const p of data.playlists) {
    const i = p.tracks.findIndex(x => x.id === id);
    if (i >= 0) { p.tracks.splice(i, 1); delete pending[id] }
  }
  toast('Удаляю…'); touch();
}
function touch() {
  dirty = true; changeNo++; render();
  clearTimeout(saveTimer); saveTimer = setTimeout(autoSave, 1500);
}
async function autoSave() {
  if (saving) { saveTimer = setTimeout(autoSave, 1000); return }
  await save();
}
function showSaveError() {
  $('#editPanel').innerHTML = saveError ? `<div class="panel err"><p>Не отправилось на сайт: ${esc(saveError)}</p>
    <button class="btn main" data-act="save">Повторить</button></div>` : '';
}
const ext = f => ((f.name.match(/\.([a-z0-9]+)$/i) || [])[1] || 'mp3').toLowerCase();

function setDur(t, f) {
  const u = URL.createObjectURL(f);
  fileDuration(u).then(d => { URL.revokeObjectURL(u); if (d) { t.dur = d; touch() } });
}

function onFile(f) {
  if (!f) return;
  if (f.size > 45e6) { toast('Файл больше 45 МБ — сожми в mp3'); return }
  const p = pl();
  if (fileTarget === 'new') {
    const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const title = prompt('Название трека', f.name.replace(/\.[^.]+$/, '')) || f.name;
    const t = { id, title, note: '', v: 1, updated: today(), file: `audio/${id}-1.${ext(f)}` };
    p.tracks.push(t); pending[id] = f; setDur(t, f);
    toast('Добавлен в конец, отправляю… Стрелками ↑ поставь на место');
  } else {
    const t = p.tracks[fileTarget];
    if (!pending[t.id]) t.prev = t.file;   // пока новый файл грузится, ребята слышат старый
    t.v = (t.v || 1) + 1; t.updated = today(); t.file = `audio/${t.id}-${t.v}.${ext(f)}`;
    pending[t.id] = f; delete t.dur; setDur(t, f);
    toast('Файл заменён, отправляю…');
  }
  touch();
}
$('#file').addEventListener('change', e => { onFile(e.target.files[0]); e.target.value = '' });

async function save() {
  clearTimeout(saveTimer);
  saving = true; const startNo = changeNo; render();
  try {
    const ids = Object.keys(pending);
    const all = () => data.playlists.flatMap(p => p.tracks);
    for (let k = 0; k < ids.length; k++) {
      const t = all().find(x => x.id === ids[k]);
      if (!t || !pending[t.id]) continue;
      const f = pending[t.id], path = t.file;
      $('#status').textContent = `Отправляю ${k + 1} из ${ids.length}: ${t.title}`;
      await api(repoPath(path), { method: 'PUT', body: { message: `${S().name}: трек ${t.title}`, content: await fileB64(f) } });
      if (pending[t.id] === f) { delete pending[t.id]; delete t.prev }   // за это время файл не заменили ещё раз
    }
    $('#status').textContent = 'Сохраняю порядок…';
    data.updated = today();
    // в общий список — только то, что уже лежит на сайте
    const pub = JSON.parse(JSON.stringify(data));
    pub.playlists.forEach(p => {
      p.tracks = p.tracks.filter(t => !pending[t.id] || t.prev);
      p.tracks.forEach(t => { if (pending[t.id]) t.file = t.prev; delete t.prev });
    });
    const jp = repoPath('data/playlists.json');
    const old = await api(jp, { allow404: true });
    await api(jp, { method: 'PUT', body: { message: `${S().name}: порядок треков`, content: encUtf8(JSON.stringify(pub, null, 1)), sha: old && old.sha } });
    // удалить файлы раздела, которые больше нигде не используются
    const used = new Set(data.playlists.flatMap(p => p.tracks.flatMap(t => [t.file, t.prev].filter(Boolean).map(repoPath))));
    const dir = await api(repoPath('audio'), { allow404: true }) || [];
    for (const f of dir) if (f.type === 'file' && !used.has(f.path))
      await api(f.path, { method: 'DELETE', body: { message: `${S().name}: удалён старый файл`, sha: f.sha } });
    LS.set('data.' + S().id, pub);
    saveError = '';
    dirty = changeNo !== startNo || Object.keys(pending).length > 0;
    if (!dirty) toast('✓ На сайте. У ребят обновится примерно через минуту', 4000);
  } catch (e) { saveError = e.message }
  saving = false; showSaveError(); render();
  if (dirty && !saveError) autoSave();
}

/* ---------- клики ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-sec],[data-pl],[data-act],[data-ed],[data-qdel],li.tr');
  if (!b) return;
  if (b.dataset.sec != null) {
    if (+b.dataset.sec === sec) return;
    if ((dirty || saving) && !confirm('Ещё не всё отправлено на сайт. Переключить? Неотправленное пропадёт.')) return;
    sec = +b.dataset.sec; LS.set('sec', sec); dirty = false; pending = {};
    return edit ? enterEdit() : load();
  }
  if (b.dataset.pl != null) { cur = +b.dataset.pl; LS.set('pl.' + S().id, cur); render(); return }
  const a = b.dataset.act, p = pl();
  if (a === 'copy') { navigator.clipboard.writeText(abs(S().id + '/')).then(() => toast('Ссылка скопирована'), () => toast('Не скопировалось — выдели вручную')); return }
  if (a === 'playall') return playAt(0);
  if (a === 'edit') return enterEdit();
  if (b.dataset.qdel) return quickDelete(b.dataset.qdel);
  if (a === 'dl') return download();
  if (a === 'save') return save();
  if (a === 'add') { if (!p) return toast('Сначала создай список'); fileTarget = 'new'; return $('#file').click() }
  if (a === 'addpl') { const n = prompt('Название списка (номер, сцена)'); if (n) { data.playlists.push({ id: 'p' + Date.now().toString(36), name: n, tracks: [] }); cur = data.playlists.length - 1; touch() } return }
  if (a === 'renpl') { const n = prompt('Название списка', p.name); if (n) { p.name = n; touch() } return }
  if (a === 'delpl') { if (confirm(`Удалить список «${p.name}» целиком?`)) { data.playlists.splice(cur, 1); cur = 0; touch() } return }
  const ed = b.dataset.ed;
  if (ed) {
    const i = +b.dataset.i, T = p.tracks;
    if (ed === 'up' && i > 0) [T[i - 1], T[i]] = [T[i], T[i - 1]];
    else if (ed === 'down' && i < T.length - 1) [T[i + 1], T[i]] = [T[i], T[i + 1]];
    else if (ed === 'ren') {
      const n = prompt('Название', T[i].title); if (n == null) return; T[i].title = n || T[i].title;
      const note = prompt('Заметка для ребят (можно пусто): например «вступление 8 тактов»', T[i].note || ''); if (note != null) T[i].note = note.trim();
    }
    else if (ed === 'rep') { fileTarget = i; return $('#file').click() }
    else if (ed === 'del') { if (!confirm(`Удалить «${T[i].title}»? У ребят он тоже пропадёт.`)) return; delete pending[T[i].id]; T.splice(i, 1) }
    else return;
    return touch();
  }
  if (b.matches('li.tr') && !edit) playAt(+b.dataset.i);
});
$('#editToggle').onclick = () => edit ? exitEdit() : ($('#editPanel').innerHTML ? ($('#editPanel').innerHTML = '') : enterEdit());
addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = '' } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !edit && !playing) load() });

if ('serviceWorker' in navigator) navigator.serviceWorker.register(CFG.root + 'sw.js').catch(() => {});
load();
