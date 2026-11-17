/* BBY E-Book Builder — Built By You Academy. Runs fully in the browser. */
(function () {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m, ms) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms || 2600); };

/* ---------------- storage (IndexedDB, with in-memory fallback) ---------------- */
const DB = (() => {
  let dbp = null, mem = {};
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(res => {
      try {
        const r = indexedDB.open('bby-ebook-builder', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('projects', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    if (!db) return fn(null);
    return new Promise((res, rej) => {
      const t = db.transaction('projects', mode), st = t.objectStore('projects');
      const out = fn(st);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  }
  return {
    persistent: async () => !!(await open()),
    all: async () => { const db = await open(); if (!db) return Object.values(mem); return tx('readonly', st => st.getAll()); },
    get: async id => { const db = await open(); if (!db) return mem[id]; return tx('readonly', st => st.get(id)); },
    put: async p => { const db = await open(); if (!db) { mem[p.id] = JSON.parse(JSON.stringify(p)); return; } return tx('readwrite', st => { st.put(p); }); },
    del: async id => { const db = await open(); if (!db) { delete mem[id]; return; } return tx('readwrite', st => { st.delete(id); }); }
  };
})();

/* ---------------- project model ---------------- */
function newProject(type) {
  return {
    id: uid(), app: 'bby-ebook-builder', version: 1, type, created: Date.now(), updated: Date.now(),
    title: '', subtitle: '', author: '', brand: '', topic: '', audience: '', year: String(new Date().getFullYear()), lang: 'en',
    description: '', keywords: '', pageSize: 'letter', headerText: '', footerText: '', fontSize: '12',
    dedication: '', intro: '', conclusion: '', about: '', cta: '', disclaimer: '',
    chapters: [{ id: uid(), title: 'Chapter 1', body: '' }],
    images: [], // {id,name,data,w,h}
    cover: { mode: 'design', bg: '#141a2b', accent: '#e3b54a', text: '#ffffff', style: 'band', upload: null, bgImage: null },
    confirms: {}
  };
}
let P = null, curCh = 0, step = 0, saveTimer = null;
const STEPS = [['details', 'Book details'], ['ai', 'AI prompts'], ['chapters', 'Chapters'], ['matter', 'Intro & extras'], ['cover', 'Cover'], ['export', 'Checklist & export']];

function touch() {
  if (!P) return;
  P.updated = Date.now();
  $('#saveState').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await DB.put(P); $('#saveState').textContent = (await DB.persistent()) ? 'Saved on this device ✓' : 'Not saved (private mode). Use Back up.'; }
    catch (e) { $('#saveState').textContent = 'Save failed. Use Back up now.'; }
  }, 500);
}

/* ---------------- markdown-lite parser ---------------- */
function inline(text) {
  const runs = [], re = /\*\*([^*]+?)\*\*|\*([^*\s][^*]*?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ t: text.slice(last, m.index) });
    if (m[1] != null) runs.push({ t: m[1], b: 1 });
    else if (m[2] != null) runs.push({ t: m[2], i: 1 });
    else runs.push({ t: m[3], href: normUrl(m[4]) });
    last = re.lastIndex;
  }
  if (last < text.length) runs.push({ t: text.slice(last) });
  return runs.filter(r => r.t);
}
function normUrl(u) { u = u.trim(); if (/^(https?:|mailto:)/i.test(u)) return u; if (/^[\w.-]+\.[a-z]{2,}/i.test(u)) return 'https://' + u; return u; }
function blocks(src) {
  const out = [], lines = String(src || '').replace(/\r/g, '').split('\n');
  let para = [], list = null;
  const flushP = () => { if (para.length) { out.push({ k: 'p', runs: inline(para.join(' ')) }); para = []; } };
  const flushL = () => { if (list) { out.push(list); list = null; } };
  for (const raw of lines) {
    const l = raw.trim();
    let m;
    if (!l) { flushP(); flushL(); continue; }
    if ((m = l.match(/^!\[([^\]]*)\]\(img:([\w-]+)\)$/))) { flushP(); flushL(); out.push({ k: 'img', id: m[2], cap: m[1] }); continue; }
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { flushP(); flushL(); out.push({ k: m[1].length === 3 ? 'h3' : 'h2', runs: inline(m[2]) }); continue; }
    if (/^(-{3,}|\*{3,})$/.test(l)) { flushP(); flushL(); out.push({ k: 'hr' }); continue; }
    if ((m = l.match(/^>\s?(.*)$/))) { flushP(); flushL(); out.push({ k: 'q', runs: inline(m[1]) }); continue; }
    if ((m = l.match(/^[-*•]\s+(.*)$/))) { flushP(); if (!list || list.k !== 'ul') { flushL(); list = { k: 'ul', items: [] }; } list.items.push(inline(m[1])); continue; }
    if ((m = l.match(/^(\d+)[.)]\s+(.*)$/))) { flushP(); if (!list || list.k !== 'ol') { flushL(); list = { k: 'ol', items: [], start: +m[1] }; } list.items.push(inline(m[2])); continue; }
    flushL(); para.push(l);
  }
  flushP(); flushL();
  return out;
}
const imgById = id => (P.images || []).find(x => x.id === id);
function runsHtml(runs, xhtml) {
  return runs.map(r => {
    let s = esc(r.t);
    if (r.b) s = '<strong>' + s + '</strong>';
    if (r.i) s = '<em>' + s + '</em>';
    if (r.href) s = '<a href="' + esc(r.href) + '"' + (xhtml ? '' : ' target="_blank" rel="noopener"') + '>' + s + '</a>';
    return s;
  }).join('');
}
function blocksHtml(bl, xhtml, imgSrc) {
  return bl.map(b => {
    if (b.k === 'p') return '<p>' + runsHtml(b.runs, xhtml) + '</p>';
    if (b.k === 'h2') return '<h2>' + runsHtml(b.runs, xhtml) + '</h2>';
    if (b.k === 'h3') return '<h3>' + runsHtml(b.runs, xhtml) + '</h3>';
    if (b.k === 'q') return '<blockquote><p>' + runsHtml(b.runs, xhtml) + '</p></blockquote>';
    if (b.k === 'hr') return xhtml ? '<hr class="brk"/>' : '<hr>';
    if (b.k === 'ul' || b.k === 'ol') return '<' + b.k + (b.k === 'ol' && b.start > 1 ? ' start="' + b.start + '"' : '') + '>' + b.items.map(it => '<li>' + runsHtml(it, xhtml) + '</li>').join('') + '</' + b.k + '>';
    if (b.k === 'img') {
      const im = imgById(b.id); if (!im) return xhtml ? '' : '<p class="small">[missing picture]</p>';
      const src = imgSrc ? imgSrc(im) : im.data;
      return '<figure><img src="' + esc(src) + '" alt="' + esc(b.cap || im.name || 'Illustration') + '"' + (xhtml ? '/' : '') + '>' + (b.cap ? '<figcaption>' + esc(b.cap) + '</figcaption>' : '') + '</figure>';
    }
    return '';
  }).join('\n');
}

/* ---------------- AI prompts ---------------- */
function v(x, fb) { return (x && String(x).trim()) || fb; }
function prompts() {
  const T = v(P.title, '[my book title]'), A = v(P.audience, '[describe your reader]'), Tp = v(P.topic, '[what the book is about]');
  const kind = P.type === 'kindle' ? 'an Amazon Kindle e-book' : 'a downloadable PDF e-book I will sell from my own online store';
  const chs = P.chapters.map((c, i) => (i + 1) + '. ' + (c.title || 'Untitled')).join('\n');
  const ci = Math.min(+($('#promptChapter').value || 0), P.chapters.length - 1), ch = P.chapters[ci] || { title: '', body: '' };
  const rules = 'Rules: write in plain, friendly language a beginner can follow. Do not invent statistics, studies, quotes, testimonials or personal stories. If a fact needs a source, write [CHECK SOURCE] so I can verify it. Do not promise guaranteed results or income.';
  return [
    ['Book ideas', 'Start here if you don\'t have a topic yet.', `I want to write ${kind}. Give me 10 practical book ideas based on these interests and experience:\n[list your skills, jobs, hobbies and problems you've solved]\n\nFor each idea give: a working title, who the reader is, the main problem it solves, and why someone would pay for it. Keep ideas specific and realistic for a first-time author. Then tell me which 3 are the strongest and why.`],
    ['Target audience', 'Know exactly who you\'re writing for.', `My book: "${T}". It is about: ${Tp}.\nHelp me define my ideal reader. Describe: their situation, their biggest frustrations, what they've already tried, the words they use to describe the problem, what result they want, and what would make them trust a new author. Then write a one-sentence reader description I can paste into my book plan.`],
    ['Title and subtitle', 'Clear titles sell better than clever ones.', `Suggest 10 title and subtitle combinations for ${kind} about: ${Tp}. Reader: ${A}.\nThe title should be short and memorable; the subtitle should say exactly what the reader gets. Avoid hype words and guaranteed-results claims. Don't copy existing famous book titles. Mark your top 3.`],
    ['Professional outline', 'Then paste the answer into "Turn your outline into chapters" below.', `Create a detailed outline for ${kind} titled "${T}". It is about: ${Tp}. Reader: ${A}.\nGive 6 to 12 chapters in a logical order from beginner to confident. Format every chapter line exactly like:\nChapter 1: [chapter title]\n- [key point]\n- [key point]\n- [action step for the reader]\nAlso suggest what the Introduction and Conclusion should cover.\n${rules}`],
    ['Write a chapter', 'Choose the chapter in the box above first.', `I'm writing ${kind} titled "${T}" for ${A}.\nFull chapter list:\n${chs}\n\nWrite chapter ${ci + 1}: "${v(ch.title, '[chapter title]')}".\n${ch.body ? 'My notes for this chapter:\n' + ch.body.slice(0, 1500) + '\n' : ''}Length: about 1,500 to 2,500 words. Use short paragraphs, 2 to 4 section headings written as "## Heading", bullet lists written with "- ", and end with a short "Action steps" list. Use **bold** for key terms only.\n${rules}`],
    ['Expand a short section', 'Paste the short part where it says.', `Expand this section of my book "${T}" for ${A}. Keep my voice and meaning. Add a clear explanation, one realistic example (label it as an example), and practical steps. Keep the same headings.\n${rules}\n\nSECTION:\n[paste the short section here]`],
    ['Edit and proofread', 'Run this on every chapter before you export.', `Proofread and edit this chapter of my book "${T}". Fix spelling, grammar, punctuation and unclear sentences. Shorten long paragraphs. Keep my voice, my meaning and my formatting marks (## headings, - bullets, **bold**, [links](...)). Don't add new facts. After the edited text, list the changes you made and anything that needs a fact-check.\n\nCHAPTER:\n${ch.body ? ch.body.slice(0, 6000) : '[paste your chapter here]'}`],
    ['Introduction and conclusion', 'Paste the results into step 4.', `Write an Introduction (400 to 700 words) and a Conclusion (300 to 500 words) for ${kind} titled "${T}" for ${A}.\nChapters:\n${chs}\nThe Introduction should explain who the book is for, what problem it solves, and how to use the book. The Conclusion should recap the main lessons and give clear next steps.\n${rules}`],
    [P.type === 'kindle' ? 'Amazon description and keywords' : 'Sales description', 'Paste into the description box in step 1.', P.type === 'kindle'
      ? `Write an Amazon Kindle book description for "${T}"${P.subtitle ? ': ' + P.subtitle : ''}, for ${A}.\nStructure: a 1-2 sentence hook about the reader's problem, a short paragraph about the book, a bullet list of 5-7 things the reader will learn, and a closing line. Keep it under 2,000 characters. No hype, no guaranteed results, no reviews or quotes, no mention of price, and don't compare it to other books or authors.\nThen suggest 7 Amazon keyword phrases (2-4 words each) that real readers might search for. Don't use other authors' names or brand names.\nChapters:\n${chs}`
      : `Write a sales description for my downloadable e-book "${T}"${P.subtitle ? ': ' + P.subtitle : ''}, for ${A}, to use on my Stan Store or Beacons product page.\nInclude: a headline, a short problem/solution paragraph, 5-7 bullet points of what's inside, who it is for and who it's not for, and a simple call to action. No hype, no guaranteed results and no invented testimonials.\nChapters:\n${chs}`],
    ['Cover concepts', 'Use the ideas in step 5 or in Canva.', `Suggest 3 original cover concepts for ${kind} titled "${T}"${P.subtitle ? ' with the subtitle "' + P.subtitle + '"' : ''}, for ${A}.\nFor each: the main image or shapes, color palette (with hex codes), font style, and the mood it creates. Leave clear space for the title and author name "${v(P.author, '[author]')}" and make sure it's readable as a small thumbnail. Don't copy famous covers, characters or brands.`],
    ['About the author', 'Short and honest bio.', `Write a short "About the Author" section (80 to 150 words) for ${v(P.author, '[my name]')}, author of "${T}". Use only these true facts about me:\n[list your real experience, location if you want, and why you wrote this book]\nWrite it in third person, warm and professional. Don't invent awards, credentials or numbers.`]
  ];
}
function renderPrompts() {
  const sel = $('#promptChapter'), keep = sel.value;
  sel.innerHTML = P.chapters.map((c, i) => `<option value="${i}">${i + 1}. ${esc(c.title || 'Untitled')}</option>`).join('');
  if (keep && +keep < P.chapters.length) sel.value = keep;
  $('#promptList').innerHTML = prompts().map(([h, hint, text], i) =>
    `<div class="prompt"><div class="row" style="justify-content:space-between"><div><h3>${esc(h)}</h3><div class="small">${esc(hint)}</div></div><button class="btn sm" data-copy="${i}">Copy prompt</button></div><pre>${esc(text)}</pre></div>`).join('');
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e2) {} ta.remove(); return ok; }
}
function outlineToChapters(txt) {
  const lines = String(txt || '').replace(/\r/g, '').split('\n');
  const made = []; let cur = null;
  for (const raw of lines) {
    const l = raw.trim(); if (!l) continue;
    const m = l.match(/^(?:#{1,3}\s*)?(?:chapter\s+\d+\s*[:.\-–—]\s*|chapter\s+\d+\s+|\d+[.)]\s+|#{1,3}\s+)(.+)$/i);
    if (m && !/^[-*•]/.test(l)) { cur = { id: uid(), title: m[1].replace(/\*\*/g, '').trim(), body: '' }; made.push(cur); }
    else if (cur) cur.body += (cur.body ? '\n' : '') + (/^[-*•]/.test(l) ? l.replace(/^[-*•]\s*/, '- ') : l);
  }
  return made;
}

/* ---------------- UI wiring ---------------- */
function show(id) { $('#home').classList.toggle('hide', id !== 'home'); $('#studio').classList.toggle('hide', id !== 'studio'); window.scrollTo(0, 0); }
async function renderHome() {
  P = null; $('#saveState').textContent = '';
  const all = ((await DB.all()) || []).sort((a, b) => b.updated - a.updated);
  $('#noProj').classList.toggle('hide', all.length > 0);
  $('#projList').innerHTML = all.map(p => `<li><div class="t"><b>${esc(p.title || 'Untitled book')}</b><span class="small">${p.type === 'kindle' ? 'Kindle EPUB' : 'Printable PDF'} · ${p.chapters.length} chapter${p.chapters.length === 1 ? '' : 's'} · edited ${new Date(p.updated).toLocaleString()}</span></div>
    <button class="btn sm" data-open="${p.id}">Open</button><button class="btn sm ghost" data-dup="${p.id}">Copy as ${p.type === 'kindle' ? 'PDF' : 'Kindle'}</button><button class="btn sm ghost" data-backup="${p.id}">Back up</button><button class="btn sm danger" data-del="${p.id}">Delete</button></li>`).join('');
  show('home');
}
function openProject(p) {
  P = p; curCh = 0; step = 0;
  P.cover = Object.assign(newProject(P.type).cover, P.cover || {});
  P.confirms = P.confirms || {}; P.images = P.images || [];
  if (!P.chapters || !P.chapters.length) P.chapters = [{ id: uid(), title: 'Chapter 1', body: '' }];
  document.body.dataset.mode = P.type;
  $$('.pdf-only').forEach(e => e.classList.toggle('hide', P.type !== 'pdf'));
  $$('.kindle-only').forEach(e => e.classList.toggle('hide', P.type !== 'kindle'));
  $('#modeBadge').textContent = P.type === 'kindle' ? 'Option B · Kindle EPUB' : 'Option A · Printable PDF';
  $$('[data-f]').forEach(el => { el.value = P[el.dataset.f] == null ? '' : P[el.dataset.f]; });
  $$('[data-c]').forEach(el => { el.value = P.cover[el.dataset.c] || ''; });
  $$('input[name=cmode]').forEach(r => { r.checked = r.value === P.cover.mode; });
  $('#pdfOut').classList.add('hide'); $('#log').style.display = 'none';
  renderSteps(); renderChapters(); renderImages(); renderPrompts(); setCoverMode(); drawCoverPreview();
  $('#bookName').textContent = P.title || 'Untitled book';
  show('studio'); goStep(0);
  touch();
}
function renderSteps() {
  $('#steps').innerHTML = STEPS.map(([k, n], i) => `<button data-step-i="${i}" class="${i === step ? 'on' : ''}"><span class="n">${i + 1}</span>${n}</button>`).join('');
}
function goStep(i) {
  step = Math.max(0, Math.min(STEPS.length - 1, i));
  $$('.step').forEach(s => s.classList.toggle('hide', s.dataset.step !== STEPS[step][0]));
  renderSteps();
  const on = $('#steps .on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  $('#prevStep').style.visibility = step ? 'visible' : 'hidden';
  $('#nextStep').style.visibility = step < STEPS.length - 1 ? 'visible' : 'hidden';
  if (STEPS[step][0] === 'ai') renderPrompts();
  if (STEPS[step][0] === 'export') renderChecks();
  if (STEPS[step][0] === 'cover') drawCoverPreview();
  window.scrollTo(0, 0);
}
function renderChapters() {
  $('#chList').innerHTML = P.chapters.map((c, i) => `<li class="${i === curCh ? 'on' : ''}" data-ch="${i}"><span>${i + 1}. ${esc(c.title || 'Untitled')}</span><button data-up="${i}" title="Move up">↑</button><button data-down="${i}" title="Move down">↓</button><button data-rm="${i}" title="Delete chapter">✕</button></li>`).join('');
  const c = P.chapters[curCh];
  $('#chTitle').value = c.title; $('#chBody').value = c.body;
  updatePreview();
}
function updatePreview() {
  const c = P.chapters[curCh];
  $('#chPrev').innerHTML = '<h1>' + esc(c.title || 'Untitled chapter') + '</h1>' + blocksHtml(blocks(c.body));
  const w = (c.body.match(/\S+/g) || []).length, tot = P.chapters.reduce((s, x) => s + (x.body.match(/\S+/g) || []).length, 0);
  $('#wordCount').textContent = `This chapter: ${w.toLocaleString()} words · Whole book: ${tot.toLocaleString()} words`;
}
function renderImages() {
  $('#imgList').innerHTML = P.images.map(im => `<figure><img src="${im.data}" alt=""><div style="display:flex;gap:4px;align-items:center;margin-top:4px"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(im.name)}</span><button class="btn sm ghost" data-ins="${im.id}" title="Insert into chapter">Insert</button><button class="btn sm danger" data-rmimg="${im.id}" title="Remove">✕</button></div></figure>`).join('') || '<p class="small">No pictures yet.</p>';
}
function wrapSel(ta, before, after, ph) {
  const s = ta.selectionStart, e = ta.selectionEnd, val = ta.value, sel = val.slice(s, e) || ph;
  ta.value = val.slice(0, s) + before + sel + after + val.slice(e);
  ta.focus(); ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length;
  ta.dispatchEvent(new Event('input'));
}
function linePrefix(ta, pre, ph) {
  const s = ta.selectionStart, e = ta.selectionEnd, val = ta.value;
  const ls = val.lastIndexOf('\n', s - 1) + 1; let le = val.indexOf('\n', e); if (le < 0) le = val.length;
  let chunk = val.slice(ls, le) || ph;
  let n = 1; chunk = chunk.split('\n').map(l => (typeof pre === 'function' ? pre(n++) : pre) + l.replace(/^(#{1,3}\s|[-*•]\s|\d+[.)]\s|>\s?)/, '')).join('\n');
  const needNL = ls > 0 && val[ls - 2] !== '\n' && val[ls - 1] === '\n' ? '\n' : '';
  ta.value = val.slice(0, ls) + needNL + chunk + val.slice(le);
  ta.focus(); ta.dispatchEvent(new Event('input'));
}
function insertAtCursor(ta, txt) {
  const s = ta.selectionStart, val = ta.value;
  const pre = s > 0 && val[s - 1] !== '\n' ? '\n\n' : (s > 1 && val[s - 2] !== '\n' ? '\n' : '');
  ta.value = val.slice(0, s) + pre + txt + '\n\n' + val.slice(s);
  ta.focus(); ta.selectionStart = ta.selectionEnd = s + pre.length + txt.length;
  ta.dispatchEvent(new Event('input'));
}
function readImage(file, maxW) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(fr.error);
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('Could not read that picture. Try a PNG or JPG.'));
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight; const sc = Math.min(1, (maxW || 1600) / w); w = Math.round(w * sc); h = Math.round(h * sc);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d');
        const png = /png|gif|webp|svg/i.test(file.type);
        if (!png) { cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); }
        cx.drawImage(img, 0, 0, w, h);
        let data = png ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.88);
        if (png && data.length > 2.5e6) { cx.globalCompositeOperation = 'destination-over'; cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); data = cv.toDataURL('image/jpeg', 0.88); }
        res({ data, w, h });
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* ---------------- cover ---------------- */
let coverImgCache = {};
function loadImg(src) { return new Promise((res, rej) => { if (coverImgCache[src]) return res(coverImgCache[src]); const i = new Image(); i.onload = () => { coverImgCache[src] = i; res(i); }; i.onerror = rej; i.src = src; }); }
function wrapLines(cx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean), lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (cx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}
function fitText(cx, text, font, maxW, maxH, start, minS, lh) {
  for (let s = start; s >= minS; s -= 2) { cx.font = font.replace('{s}', s); const ls = wrapLines(cx, text, maxW); if (ls.length * s * lh <= maxH && ls.every(l => cx.measureText(l).width <= maxW)) return { s, ls }; }
  cx.font = font.replace('{s}', minS); return { s: minS, ls: wrapLines(cx, text, maxW) };
}
async function renderCover(W, H) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d');
  const c = P.cover;
  if (c.mode === 'upload' && c.upload) {
    const im = await loadImg(c.upload);
    const sc = Math.max(W / im.naturalWidth, H / im.naturalHeight), w = im.naturalWidth * sc, h = im.naturalHeight * sc;
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H); cx.drawImage(im, (W - w) / 2, (H - h) / 2, w, h); return cv;
  }
  try { await Promise.all([document.fonts.load('700 40px Poppins'), document.fonts.load('40px Poppins'), document.fonts.load('italic 40px Lora')]); } catch (e) {}
  const bg = c.bg || '#141a2b', ac = c.accent || '#e3b54a', tx = c.text || '#ffffff', u = W / 1600;
  cx.fillStyle = bg; cx.fillRect(0, 0, W, H);
  if (c.bgImage) {
    try { const im = await loadImg(c.bgImage); const sc = Math.max(W / im.naturalWidth, H / im.naturalHeight); cx.globalAlpha = 1; cx.drawImage(im, (W - im.naturalWidth * sc) / 2, (H - im.naturalHeight * sc) / 2, im.naturalWidth * sc, im.naturalHeight * sc); cx.fillStyle = 'rgba(0,0,0,0.45)'; cx.fillRect(0, 0, W, H); } catch (e) {}
  }
  const title = (P.title || 'Your Book Title'), sub = P.subtitle || '', au = P.author || 'Author Name';
  const M = 150 * u, mw = W - 2 * M;
  cx.textAlign = 'center'; cx.textBaseline = 'top';
  if (c.style === 'frame') { cx.strokeStyle = ac; cx.lineWidth = 10 * u; cx.strokeRect(70 * u, 70 * u, W - 140 * u, H - 140 * u); cx.lineWidth = 3 * u; cx.strokeRect(100 * u, 100 * u, W - 200 * u, H - 200 * u); }
  if (c.style === 'band') { cx.fillStyle = ac; cx.fillRect(0, H * 0.62, W, 26 * u); cx.fillRect(0, 0, W, 26 * u); }
  let y = c.style === 'minimal' ? H * 0.16 : H * 0.18;
  if (P.brand) { cx.fillStyle = ac; cx.font = `700 ${46 * u}px Poppins`; cx.fillText(P.brand.toUpperCase(), W / 2, y - 70 * u); }
  const t = fitText(cx, title, `700 {s}px Poppins`, mw, H * 0.30, Math.round(190 * u), Math.round(70 * u), 1.12);
  cx.fillStyle = tx; t.ls.forEach((l, i) => { cx.font = `700 ${t.s}px Poppins`; cx.fillText(l, W / 2, y + i * t.s * 1.12); });
  y += t.ls.length * t.s * 1.12 + 50 * u;
  cx.fillStyle = ac; cx.fillRect(W / 2 - 110 * u, y, 220 * u, 10 * u); y += 60 * u;
  if (sub) { const s = fitText(cx, sub, `italic {s}px Lora`, mw * 0.92, H * 0.16, Math.round(80 * u), Math.round(40 * u), 1.3); cx.fillStyle = tx; s.ls.forEach((l, i) => { cx.font = `italic ${s.s}px Lora`; cx.fillText(l, W / 2, y + i * s.s * 1.3); }); }
  const a = fitText(cx, au, `{s}px Poppins`, mw, 200 * u, Math.round(84 * u), Math.round(40 * u), 1.2);
  cx.fillStyle = tx; a.ls.forEach((l, i) => { cx.font = `${a.s}px Poppins`; cx.fillText(l, W / 2, H - 260 * u - (a.ls.length - 1 - i) * a.s * 1.2); });
  return cv;
}
async function drawCoverPreview() {
  if (!P) return;
  const cv = await renderCover(800, 1280), pv = $('#coverPrev');
  pv.getContext('2d').clearRect(0, 0, 800, 1280); pv.getContext('2d').drawImage(cv, 0, 0);
}
function setCoverMode() { $('#cDesign').classList.toggle('hide', P.cover.mode !== 'design'); $('#cUpload').classList.toggle('hide', P.cover.mode !== 'upload'); }
const canvasBytes = (cv, type, q) => new Promise(res => cv.toBlob(b => b.arrayBuffer().then(a => res(new Uint8Array(a))), type, q));
function download(bytes, name, type) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return url;
}
const slug = s => (String(s || 'my-ebook').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'my-ebook');

/* ---------------- checks ---------------- */
function checks() {
  const out = [], add = (lvl, msg) => out.push([lvl, msg]);
  add(P.title.trim() ? 'ok' : 'bad', P.title.trim() ? 'Title: ' + P.title : 'Add a book title (step 1).');
  add(P.author.trim() ? 'ok' : 'bad', P.author.trim() ? 'Author: ' + P.author : 'Add the author name (step 1).');
  const empty = P.chapters.filter(c => !c.body.trim());
  add(P.chapters.length && !empty.length ? 'ok' : 'bad', !empty.length ? P.chapters.length + ' chapter(s), all with text' : empty.length + ' chapter(s) have no text: ' + empty.map(c => '"' + (c.title || 'Untitled') + '"').join(', '));
  const untitled = P.chapters.filter(c => !c.title.trim()); if (untitled.length) add('bad', untitled.length + ' chapter(s) have no title.');
  const words = P.chapters.reduce((s, x) => s + (x.body.match(/\S+/g) || []).length, 0);
  add(words >= 2500 ? 'ok' : 'warn', words.toLocaleString() + ' words in the chapters' + (words < 2500 ? ' — that is short for a paid e-book. Make sure it delivers real value.' : ''));
  add(P.intro.trim() ? 'ok' : 'warn', P.intro.trim() ? 'Introduction added' : 'No introduction (optional, but recommended).');
  add(P.conclusion.trim() ? 'ok' : 'warn', P.conclusion.trim() ? 'Conclusion added' : 'No conclusion (optional, but recommended).');
  add(P.description.trim() ? 'ok' : (P.type === 'kindle' ? 'bad' : 'warn'), P.description.trim() ? 'Description written' : 'Write the book description (step 1). ' + (P.type === 'kindle' ? 'KDP requires one.' : 'You need it for your product page.'));
  const hasCover = P.cover.mode === 'design' || !!P.cover.upload;
  add(hasCover ? 'ok' : 'bad', hasCover ? (P.cover.mode === 'upload' ? 'Cover uploaded' : 'Text cover will be used') : 'Upload a cover or switch to "Make a text cover" (step 5).');
  const allText = [P.intro, P.conclusion, P.about, P.cta, ...P.chapters.map(c => c.body)].join('\n');
  const ph = allText.match(/\[(CHECK SOURCE|paste[^\]]*|insert[^\]]*|your [^\]]*|TODO[^\]]*|my [^\]]*)\]/gi);
  add(ph ? 'bad' : 'ok', ph ? 'Leftover placeholders found: ' + [...new Set(ph)].slice(0, 5).join(', ') + '. Replace them before publishing.' : 'No leftover AI placeholders');
  const missing = []; allText.replace(/!\[[^\]]*\]\(img:([\w-]+)\)/g, (m, id) => { if (!imgById(id)) missing.push(id); });
  if (missing.length) add('bad', missing.length + ' picture(s) placed in the text were deleted. Remove those picture lines.');
  const badLinks = []; allText.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => { if (!/^(https?:\/\/[^\s.]+\.[^\s]+|mailto:.+@.+)/i.test(normUrl(u)) && !/^img:/.test(u)) badLinks.push(u); });
  add(badLinks.length ? 'bad' : 'ok', badLinks.length ? 'These links don\'t look like web addresses: ' + badLinks.slice(0, 4).join(', ') : 'Links look like valid web addresses');
  if (P.type === 'kindle') {
    const kw = P.keywords.split(',').map(s => s.trim()).filter(Boolean);
    add(kw.length ? (kw.length <= 7 ? 'ok' : 'bad') : 'warn', kw.length ? kw.length + ' keyword(s)' + (kw.length > 7 ? ' — KDP allows 7. Remove some.' : '') : 'No keywords yet (you can also add them on KDP).');
    if (/\bpage \d+|\bon page\b|next page|previous page/i.test(allText)) add('warn', 'Your text mentions page numbers ("page 12", "next page"). Kindle books have no fixed pages; refer to chapters instead.');
    if (P.cover.mode === 'upload' && P.cover.uploadW && (P.cover.uploadH / P.cover.uploadW < 1.4 || P.cover.uploadH < 1000)) add('warn', 'Your cover image is ' + P.cover.uploadW + ' × ' + P.cover.uploadH + ' px. KDP\'s ideal is 1,600 × 2,560 px (tall). It may look stretched or blurry.');
  }
  return out;
}
const MAN = [
  ['rights', 'I wrote this book or have the rights to everything in it (text, pictures, quotes, cover art).'],
  ['facts', 'I fact-checked every claim, number and source, especially anything written by AI.'],
  ['proof', 'I proofread every chapter (the Edit and proofread prompt helps).'],
  ['claims', 'The book makes no guaranteed income, health or legal promises.'],
  ['links', 'I tested my links and they go to the right pages.']
];
function renderChecks() {
  $('#autoCheck').innerHTML = checks().map(([l, m]) => `<li><span class="ic ${l}">${l === 'ok' ? '✓' : l === 'warn' ? '!' : '✕'}</span><span>${esc(m)}</span></li>`).join('');
  $('#manCheck').innerHTML = MAN.map(([k, t]) => `<li><label><input type="checkbox" data-conf="${k}" ${P.confirms[k] ? 'checked' : ''}> ${esc(t)}</label></li>`).join('');
}

/* ---------------- logging ---------------- */
function log(m, reset) { const l = $('#log'); l.style.display = 'block'; if (reset) l.textContent = ''; l.textContent += m + '\n'; l.scrollTop = l.scrollHeight; }

/* ---------------- PDF export ---------------- */
async function fetchBytes(u) { const r = await fetch(u); if (!r.ok) throw new Error('Could not load ' + u); return new Uint8Array(await r.arrayBuffer()); }
function dataUrlBytes(d) { const b = atob(d.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
async function buildPdf(Pj) {
  const { PDFDocument, rgb, PDFName, PDFString, PDFArray, PDFNumber } = PDFLib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(window.fontkit);
  const [lr, lb, li, lbi, pb, pr] = await Promise.all(['Lora-Regular.ttf', 'Lora-Bold.ttf', 'Lora-Italic.ttf', 'Lora-BoldItalic.ttf', 'Poppins-Bold.ttf', 'Poppins-Regular.ttf'].map(fetchBytes));
  const F = { r: await doc.embedFont(lr, { subset: true }), b: await doc.embedFont(lb, { subset: true }), i: await doc.embedFont(li, { subset: true }), bi: await doc.embedFont(lbi, { subset: true }), H: await doc.embedFont(pb, { subset: true }), h: await doc.embedFont(pr, { subset: true }) };
  const charsets = {}; for (const k in F) charsets[k] = new Set(F[k].getCharacterSet());
  const clean = (s, k) => { const cs = charsets[k]; let o = ''; for (const ch of String(s).replace(/\t/g, '    ')) { const cp = ch.codePointAt(0); o += cs.has(cp) ? ch : (ch === ' ' ? ' ' : (cs.has(0x25A1) && cp > 0x2000 && !/[‘’“”–—…]/.test(ch) ? '' : '')); } return o; };
  const fontFor = r => r.b && r.i ? 'bi' : r.b ? 'b' : r.i ? 'i' : 'r';
  const [PW, PH] = Pj.pageSize === 'a4' ? [595.28, 841.89] : [612, 792];
  const ML = 72, MR = 72, MT = 78, MB = 78, CW = PW - ML - MR;
  const fs = +Pj.fontSize || 12, LH = fs * 1.5;
  const ink = rgb(0.1, 0.11, 0.15), muted = rgb(0.42, 0.45, 0.52), gold = hexRgb(Pj.cover.accent || '#c99a2e', rgb), navy = rgb(0.078, 0.102, 0.169);
  function hexRgb(h, rgbf) { const m = String(h).replace('#', '').match(/^([0-9a-f]{6})$/i); if (!m) return rgbf(0.79, 0.6, 0.18); const n = parseInt(m[1], 16); const c = rgbf(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); return c; }
  const pages = []; // {page, num, hdr, noHF}
  let pg = null, y = 0, bodyNum = 0;
  const links = []; // {pi, rect, url | destPi}
  function addPage(opts) { const page = doc.addPage([PW, PH]); const o = Object.assign({ page, num: null, hdr: '', noHF: false }, opts || {}); pages.push(o); pg = o; y = PH - MT; return o; }
  function bodyPage(hdr, noHF) { bodyNum++; return addPage({ num: bodyNum, hdr, noHF }); }
  let curHdr = '';
  function need(h) { if (y - h < MB) { bodyPage(curHdr); } }
  // layout a paragraph of runs
  function layoutRuns(runs, o) {
    o = Object.assign({ size: fs, lh: LH, indent: 0, first: '', color: ink, font: null, align: 'left', width: CW, x: ML }, o || {});
    const words = [];
    runs.forEach(r => {
      const fk = o.font || fontFor(r);
      String(r.t).split(/(\s+)/).forEach(part => { if (!part) return; if (/^\s+$/.test(part)) words.push({ sp: 1, fk }); else words.push({ t: clean(part, fk), fk, href: r.href }); });
    });
    const lines = []; let line = [], w = 0, maxW = o.width - o.indent;
    const spW = fk => F[fk].widthOfTextAtSize(' ', o.size);
    for (const wd of words) {
      if (wd.sp) { if (line.length) { line.push({ sp: 1, w: spW(wd.fk) }); w += spW(wd.fk); } continue; }
      let ww = F[wd.fk].widthOfTextAtSize(wd.t, o.size);
      if (w + ww > maxW && line.length) { while (line.length && line[line.length - 1].sp) { w -= line.pop().w; } lines.push(line); line = []; w = 0; }
      if (ww > maxW) { // break very long word
        let s = wd.t; while (F[wd.fk].widthOfTextAtSize(s, o.size) > maxW && s.length > 1) { let k = s.length; while (k > 1 && F[wd.fk].widthOfTextAtSize(s.slice(0, k), o.size) > maxW) k--; lines.push([{ t: s.slice(0, k), fk: wd.fk, href: wd.href, w: F[wd.fk].widthOfTextAtSize(s.slice(0, k), o.size) }]); s = s.slice(k); }
        wd.t = s; ww = F[wd.fk].widthOfTextAtSize(s, o.size);
      }
      line.push({ t: wd.t, fk: wd.fk, href: wd.href, w: ww }); w += ww;
    }
    while (line.length && line[line.length - 1].sp) line.pop();
    if (line.length) lines.push(line);
    return { lines, o };
  }
  function drawLines(L, opt) {
    const o = L.o;
    L.lines.forEach((ln, li) => {
      need(o.lh);
      const lw = ln.reduce((s, p) => s + p.w, 0);
      let x = o.x + o.indent + (o.align === 'center' ? (o.width - o.indent - lw) / 2 : 0);
      const base = y - o.size;
      if (li === 0 && o.first) pg.page.drawText(clean(o.first, 'r'), { x: o.x + o.indent - F.r.widthOfTextAtSize(o.first, o.size) - 6, y: base, size: o.size, font: F.r, color: o.firstColor || o.color });
      if (li === 0 && opt && opt.bar) opt.bar.start = { pi: pages.length - 1, y: y };
      for (const p of ln) {
        if (p.sp) { x += p.w; continue; }
        const col = p.href ? rgb(0.09, 0.33, 0.75) : o.color;
        pg.page.drawText(p.t, { x, y: base, size: o.size, font: F[p.fk], color: col });
        if (p.href) { pg.page.drawLine({ start: { x, y: base - 1.5 }, end: { x: x + p.w, y: base - 1.5 }, thickness: 0.5, color: col }); links.push({ pi: pages.length - 1, rect: [x, base - 3, x + p.w, base + o.size], url: p.href }); }
        x += p.w;
      }
      y -= o.lh;
    });
  }
  async function drawBlocks(bl) {
    for (const b of bl) {
      if (b.k === 'p') { drawLines(layoutRuns(b.runs)); y -= fs * 0.6; }
      else if (b.k === 'h2' || b.k === 'h3') {
        const s = b.k === 'h2' ? fs * 1.45 : fs * 1.18, L = layoutRuns(b.runs.map(r => ({ t: r.t, href: r.href })), { size: s, lh: s * 1.3, font: 'H', color: navy });
        need(L.lines.length * s * 1.3 + LH * 2 + 10); y -= b.k === 'h2' ? fs * 0.8 : fs * 0.4; drawLines(L); y -= fs * 0.35;
      }
      else if (b.k === 'q') { const L = layoutRuns(b.runs.map(r => Object.assign({}, r, { i: 1 })), { indent: 22, color: rgb(0.25, 0.27, 0.33) }); need(LH * 2); const top = y; const startPi = pages.length; drawLines(L); if (pages.length === startPi) pg.page.drawRectangle({ x: ML + 6, y: y + fs * 0.25, width: 3, height: top - y - fs * 0.25, color: gold }); y -= fs * 0.6; }
      else if (b.k === 'ul' || b.k === 'ol') { b.items.forEach((it, i) => { drawLines(layoutRuns(it, { indent: 22, first: b.k === 'ul' ? '•' : (b.start || 1) + i + '.', firstColor: gold })); y -= fs * 0.25; }); y -= fs * 0.4; }
      else if (b.k === 'hr') { need(LH * 2); y -= LH * 0.6; pg.page.drawText('* * *', { x: PW / 2 - F.r.widthOfTextAtSize('* * *', fs) / 2, y: y - fs, size: fs, font: F.r, color: gold }); y -= LH * 1.4; }
      else if (b.k === 'img') {
        const im = (Pj.images || []).find(x => x.id === b.id); if (!im) continue;
        const bytes = dataUrlBytes(im.data); const emb = /^data:image\/png/.test(im.data) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        let w = Math.min(CW, emb.width * 0.75), h = w * emb.height / emb.width; const maxH = (PH - MT - MB) * 0.62; if (h > maxH) { h = maxH; w = h * emb.width / emb.height; }
        const capL = b.cap ? layoutRuns([{ t: b.cap, i: 1 }], { size: fs * 0.85, lh: fs * 1.2, align: 'center', color: muted }) : null;
        need(h + 12 + (capL ? capL.lines.length * fs * 1.2 + 6 : 0));
        y -= 6; pg.page.drawImage(emb, { x: ML + (CW - w) / 2, y: y - h, width: w, height: h }); y -= h + 8;
        if (capL) drawLines(capL); y -= fs * 0.6;
      }
    }
  }
  // ---- cover page
  log('Making the cover page…');
  const cvc = await renderCover(Math.round(PW * 3), Math.round(PH * 3));
  const covJ = await doc.embedJpg(await canvasBytes(cvc, 'image/jpeg', 0.9));
  addPage({ noHF: true }).page.drawImage(covJ, { x: 0, y: 0, width: PW, height: PH });
  // ---- title page
  addPage({ noHF: true });
  const tL = layoutRuns([{ t: Pj.title || 'Untitled' }], { size: 30, lh: 36, font: 'H', align: 'center', color: navy });
  y = PH * 0.62 + tL.lines.length * 18; drawLines(tL);
  if (Pj.subtitle) { y -= 6; drawLines(layoutRuns([{ t: Pj.subtitle, i: 1 }], { size: 15, lh: 21, align: 'center', color: muted })); }
  y -= 16; pg.page.drawRectangle({ x: PW / 2 - 40, y: y, width: 80, height: 2.5, color: gold }); y -= 30;
  drawLines(layoutRuns([{ t: Pj.author || '' }], { size: 15, lh: 20, font: 'h', align: 'center', color: ink }));
  if (Pj.brand) { y = MB + 40; drawLines(layoutRuns([{ t: Pj.brand.toUpperCase() }], { size: 10, lh: 14, font: 'H', align: 'center', color: muted })); }
  // ---- copyright page
  addPage({ noHF: true }); y = MB + 190;
  const cpy = [[{ t: Pj.title + (Pj.subtitle ? ': ' + Pj.subtitle : '') , b: 1 }], [{ t: 'Copyright © ' + (Pj.year || new Date().getFullYear()) + ' ' + (Pj.author || '') + '. All rights reserved.' }], [{ t: 'No part of this book may be copied, shared or resold without written permission from the author, except for brief quotations in reviews.' }]];
  if (Pj.disclaimer) cpy.push(...blocks(Pj.disclaimer).filter(x => x.runs).map(x => x.runs));
  if (Pj.brand) cpy.push([{ t: 'Published by ' + Pj.brand }]);
  cpy.forEach(r => { drawLines(layoutRuns(r, { size: 9.5, lh: 13.5, color: muted })); y -= 7; });
  // ---- dedication
  if (Pj.dedication.trim()) { addPage({ noHF: true }); y = PH * 0.62; drawLines(layoutRuns([{ t: Pj.dedication, i: 1 }], { size: 14, lh: 20, align: 'center', color: muted })); }
  // ---- TOC (reserve pages)
  const sections = [];
  if (Pj.intro.trim()) sections.push({ title: 'Introduction', body: Pj.intro });
  Pj.chapters.forEach((c, i) => sections.push({ title: c.title || 'Chapter ' + (i + 1), label: 'Chapter ' + (i + 1), body: c.body }));
  if (Pj.conclusion.trim()) sections.push({ title: 'Conclusion', body: Pj.conclusion });
  if (Pj.about.trim()) sections.push({ title: 'About the Author', body: Pj.about });
  if (Pj.cta.trim()) sections.push({ title: 'Next Steps', body: Pj.cta });
  const tocEntryH = fs * 2.1, tocFirst = Math.floor((PH - MT - MB - 90) / tocEntryH), tocRest = Math.floor((PH - MT - MB) / tocEntryH);
  const tocPagesN = sections.length <= tocFirst ? 1 : 1 + Math.ceil((sections.length - tocFirst) / tocRest);
  const tocStart = pages.length; for (let i = 0; i < tocPagesN; i++) addPage({ noHF: true });
  // ---- body
  log('Laying out ' + sections.length + ' sections…');
  for (const s of sections) {
    curHdr = s.title; const op = bodyPage(s.title, true); s.pi = pages.length - 1; s.num = op.num;
    y = PH - MT - 70;
    if (s.label) { pg.page.drawText(clean(s.label.toUpperCase(), 'H'), { x: ML, y: y, size: 10.5, font: F.H, color: gold }); y -= 14; }
    drawLines(layoutRuns([{ t: s.title }], { size: 25, lh: 31, font: 'H', color: navy }));
    y -= 4; pg.page.drawRectangle({ x: ML, y: y, width: 56, height: 2.5, color: gold }); y -= 30;
    await drawBlocks(blocks(s.body));
  }
  // ---- TOC draw
  let ti = 0;
  for (let p = 0; p < tocPagesN; p++) {
    pg = pages[tocStart + p]; y = PH - MT;
    if (p === 0) { pg.page.drawText('Contents', { x: ML, y: y - 26, size: 26, font: F.H, color: navy }); pg.page.drawRectangle({ x: ML, y: y - 40, width: 56, height: 2.5, color: gold }); y -= 90; }
    const cap = p === 0 ? tocFirst : tocRest;
    for (let k = 0; k < cap && ti < sections.length; k++, ti++) {
      const s = sections[ti], base = y - fs; const label = clean((s.label ? s.label + ': ' : '') + s.title, 'r'); const num = String(s.num);
      const nw = F.r.widthOfTextAtSize(num, fs); let t = label; while (F.r.widthOfTextAtSize(t, fs) > CW - nw - 30 && t.length > 4) t = t.slice(0, -2); if (t !== label) t = t.replace(/\s*\S*$/, '') + '…';
      const tw = F.r.widthOfTextAtSize(t, fs);
      pg.page.drawText(t, { x: ML, y: base, size: fs, font: F.r, color: ink });
      pg.page.drawText(num, { x: PW - MR - nw, y: base, size: fs, font: F.r, color: ink });
      const dotW = F.r.widthOfTextAtSize('.', fs); let dx = ML + tw + 8; while (dx < PW - MR - nw - 8) { pg.page.drawText('.', { x: dx, y: base, size: fs, font: F.r, color: muted }); dx += dotW * 2; }
      links.push({ pi: tocStart + p, rect: [ML, base - 4, PW - MR, base + fs + 2], destPi: s.pi });
      y -= tocEntryH;
    }
  }
  // ---- headers / footers
  const hdrText = clean(Pj.headerText || Pj.title || '', 'h'), ftr = clean(Pj.footerText || '', 'h');
  pages.forEach(o => {
    if (o.num == null) return;
    const p = o.page, ns = String(o.num);
    p.drawText(ns, { x: PW / 2 - F.h.widthOfTextAtSize(ns, 9.5) / 2, y: MB - 38, size: 9.5, font: F.h, color: muted });
    if (ftr) p.drawText(ftr, { x: ML, y: MB - 38, size: 8.5, font: F.h, color: muted });
    if (!o.noHF) {
      const h1 = hdrText.length > 70 ? hdrText.slice(0, 68) + '…' : hdrText, h2 = clean(o.hdr, 'h'), h2s = h2.length > 45 ? h2.slice(0, 43) + '…' : h2;
      p.drawText(h1, { x: ML, y: PH - MT + 30, size: 8.5, font: F.h, color: muted });
      if (h2s && h2s !== h1) p.drawText(h2s, { x: PW - MR - F.h.widthOfTextAtSize(h2s, 8.5), y: PH - MT + 30, size: 8.5, font: F.h, color: muted });
      p.drawLine({ start: { x: ML, y: PH - MT + 22 }, end: { x: PW - MR, y: PH - MT + 22 }, thickness: 0.5, color: rgb(0.85, 0.83, 0.78) });
    }
  });
  // ---- link annotations
  for (const L of links) {
    const page = pages[L.pi].page;
    const dict = { Type: 'Annot', Subtype: 'Link', Rect: L.rect, Border: [0, 0, 0] };
    if (L.url) dict.A = { Type: 'Action', S: 'URI', URI: PDFString.of(L.url) };
    else dict.Dest = [pages[L.destPi].page.ref, 'XYZ', null, null, null];
    page.node.addAnnot(doc.context.register(doc.context.obj(dict)));
  }
  doc.setTitle(Pj.title || 'E-book', { showInWindowTitleBar: true }); doc.setAuthor(Pj.author || ''); doc.setSubject(Pj.subtitle || Pj.topic || ''); doc.setKeywords((Pj.keywords || '').split(',').map(s => s.trim()).filter(Boolean)); doc.setCreator('BBY E-Book Builder (Built By You Academy)'); doc.setProducer('BBY E-Book Builder'); doc.setLanguage(Pj.lang || 'en');
  const bytes = await doc.save();
  return { bytes, pages: pages.length, links: links.filter(l => l.url).length, toc: links.filter(l => l.destPi != null).length };
}

/* ---------------- EPUB export ---------------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }; })();
function zip(files) { // files: [{name, data:Uint8Array}] stored (no compression)
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  for (const f of files) {
    const nm = enc.encode(f.name), data = f.data, crc = CRC(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nm, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const cs = central.reduce((s, a) => s + a.length, 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/epub+zip' });
}
async function buildEpub(Pj) {
  const enc = new TextEncoder(), files = [], add = (name, s) => files.push({ name, data: typeof s === 'string' ? enc.encode(s) : s });
  const lang = Pj.lang || 'en', bookId = 'urn:uuid:' + (Pj.uuid || (Pj.uuid = ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16))));
  const x = esc, now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const page = (title, body, cls) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">\n<head>\n<meta charset="UTF-8"/>\n<title>${x(title)}</title>\n<link rel="stylesheet" type="text/css" href="styles.css"/>\n</head>\n<body${cls ? ' class="' + cls + '"' : ''}>\n${body}\n</body>\n</html>\n`;
  add('mimetype', 'application/epub+zip');
  add('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>\n');
  add('OEBPS/styles.css', `body{margin:0 5%;font-family:serif;line-height:1.5}\nh1{font-size:1.6em;line-height:1.25;margin:1.5em 0 .3em;text-align:left;page-break-before:always}\nh2{font-size:1.3em;margin:1.4em 0 .4em}\nh3{font-size:1.1em;margin:1.2em 0 .3em}\np{margin:0 0 .8em;text-indent:0}\n.label{font-size:.8em;letter-spacing:.12em;text-transform:uppercase;margin:2em 0 0;color:#8a6a1c}\nblockquote{margin:1em 1.5em;font-style:italic}\nfigure{margin:1.2em 0;text-align:center}\nfigure img{max-width:100%;height:auto}\nfigcaption{font-size:.9em;font-style:italic}\nhr.brk{border:0;margin:1.5em 0;text-align:center}\nhr.brk:after{content:"* * *"}\n.center{text-align:center}\n.title{font-size:2em;margin-top:30%;text-align:center;page-break-before:auto}\n.subtitle{text-align:center;font-style:italic;font-size:1.15em}\n.author{text-align:center;margin-top:2em;font-size:1.1em}\n.small{font-size:.85em}\nnav ol{list-style:none;padding-left:0}\nnav li{margin:.5em 0}\n.cover{margin:0;padding:0;text-align:center}\n.cover img{height:100%;max-width:100%}\n`);
  // images
  const man = [], usedImgs = new Map();
  const imgSrc = im => { if (!usedImgs.has(im.id)) { const ext = /^data:image\/png/.test(im.data) ? 'png' : 'jpg'; usedImgs.set(im.id, { href: 'images/' + im.id + '.' + ext, type: ext === 'png' ? 'image/png' : 'image/jpeg', im }); } return usedImgs.get(im.id).href; };
  const docs = [], nav = [];
  // cover
  const cv = await renderCover(1600, 2560); const coverJpg = await canvasBytes(cv, 'image/jpeg', 0.9);
  add('OEBPS/images/cover.jpg', coverJpg);
  add('OEBPS/cover.xhtml', page('Cover', `<div class="cover"><img src="images/cover.jpg" alt="${x(Pj.title)} cover"/></div>`, 'cover'));
  docs.push({ id: 'cover', href: 'cover.xhtml', linear: 'yes', props: '' });
  add('OEBPS/title.xhtml', page(Pj.title, `<h1 class="title">${x(Pj.title)}</h1>${Pj.subtitle ? `<p class="subtitle">${x(Pj.subtitle)}</p>` : ''}<p class="author">${x(Pj.author)}</p>${Pj.brand ? `<p class="center small">${x(Pj.brand)}</p>` : ''}`));
  docs.push({ id: 'titlepage', href: 'title.xhtml' });
  add('OEBPS/copyright.xhtml', page('Copyright', `<p class="small"><strong>${x(Pj.title)}${Pj.subtitle ? ': ' + x(Pj.subtitle) : ''}</strong></p><p class="small">Copyright © ${x(Pj.year || new Date().getFullYear())} ${x(Pj.author)}. All rights reserved.</p><p class="small">No part of this book may be copied, shared or resold without written permission from the author, except for brief quotations in reviews.</p>${Pj.disclaimer ? blocksHtml(blocks(Pj.disclaimer), true, imgSrc).replace(/<p>/g, '<p class="small">') : ''}${Pj.brand ? `<p class="small">Published by ${x(Pj.brand)}</p>` : ''}`));
  docs.push({ id: 'copyright', href: 'copyright.xhtml' });
  if (Pj.dedication.trim()) { add('OEBPS/dedication.xhtml', page('Dedication', `<p class="center" style="margin-top:30%"><em>${x(Pj.dedication)}</em></p>`)); docs.push({ id: 'dedication', href: 'dedication.xhtml' }); }
  docs.push({ id: 'nav', href: 'nav.xhtml', props: 'nav' });
  const sections = [];
  if (Pj.intro.trim()) sections.push({ title: 'Introduction', body: Pj.intro, id: 'intro' });
  Pj.chapters.forEach((c, i) => sections.push({ title: c.title || 'Chapter ' + (i + 1), label: 'Chapter ' + (i + 1), body: c.body, id: 'chapter' + (i + 1) }));
  if (Pj.conclusion.trim()) sections.push({ title: 'Conclusion', body: Pj.conclusion, id: 'conclusion' });
  if (Pj.about.trim()) sections.push({ title: 'About the Author', body: Pj.about, id: 'about' });
  if (Pj.cta.trim()) sections.push({ title: 'Next Steps', body: Pj.cta, id: 'next' });
  sections.forEach(s => {
    const html = (s.label ? `<p class="label">${x(s.label)}</p>` : '') + `<h1 id="${s.id}-title">${x(s.title)}</h1>\n` + blocksHtml(blocks(s.body), true, imgSrc);
    add('OEBPS/' + s.id + '.xhtml', page(s.title, `<section epub:type="${s.label ? 'chapter' : s.id === 'about' ? 'appendix' : s.id === 'intro' ? 'introduction' : s.id === 'conclusion' ? 'conclusion' : 'appendix'}">\n${html}\n</section>`));
    docs.push({ id: s.id, href: s.id + '.xhtml' });
    nav.push({ href: s.id + '.xhtml', title: (s.label ? s.label + ': ' : '') + s.title });
  });
  const startHref = sections.length ? sections[0].id + '.xhtml' : 'title.xhtml';
  add('OEBPS/nav.xhtml', page('Contents', `<nav epub:type="toc" id="toc">\n<h1>Contents</h1>\n<ol>\n${nav.map(n => `<li><a href="${n.href}">${x(n.title)}</a></li>`).join('\n')}\n</ol>\n</nav>\n<nav epub:type="landmarks" hidden="hidden">\n<ol>\n<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>\n<li><a epub:type="toc" href="nav.xhtml">Contents</a></li>\n<li><a epub:type="bodymatter" href="${startHref}">Start reading</a></li>\n</ol>\n</nav>`));
  add('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n<head><meta name="dtb:uid" content="${bookId}"/></head>\n<docTitle><text>${x(Pj.title)}</text></docTitle>\n<navMap>\n${nav.map((n, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${x(n.title)}</text></navLabel><content src="${n.href}"/></navPoint>`).join('\n')}\n</navMap>\n</ncx>\n`);
  for (const [id, u] of usedImgs) add('OEBPS/' + u.href, dataUrlBytes(u.im.data));
  const kw = (Pj.keywords || '').split(',').map(s => s.trim()).filter(Boolean);
  const opf = `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n<dc:identifier id="bookid">${bookId}</dc:identifier>\n<dc:title>${x(Pj.title)}</dc:title>\n<dc:creator id="author">${x(Pj.author)}</dc:creator>\n<dc:language>${lang}</dc:language>\n${Pj.description ? `<dc:description>${x(Pj.description)}</dc:description>\n` : ''}${Pj.brand ? `<dc:publisher>${x(Pj.brand)}</dc:publisher>\n` : ''}<dc:rights>Copyright © ${x(Pj.year)} ${x(Pj.author)}. All rights reserved.</dc:rights>\n${kw.map(k => `<dc:subject>${x(k)}</dc:subject>`).join('\n')}${kw.length ? '\n' : ''}<meta property="dcterms:modified">${now}</meta>\n<meta name="cover" content="cover-image"/>\n</metadata>\n<manifest>\n<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n<item id="css" href="styles.css" media-type="text/css"/>\n<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>\n${docs.map(d => `<item id="${d.id}" href="${d.href}" media-type="application/xhtml+xml"${d.props ? ` properties="${d.props}"` : ''}/>`).join('\n')}\n${[...usedImgs].map(([id, u]) => `<item id="img-${id}" href="${u.href}" media-type="${u.type}"/>`).join('\n')}\n</manifest>\n<spine toc="ncx">\n${docs.map(d => `<itemref idref="${d.id}"/>`).join('\n')}\n</spine>\n<guide>\n<reference type="cover" title="Cover" href="cover.xhtml"/>\n<reference type="toc" title="Contents" href="nav.xhtml"/>\n<reference type="text" title="Start" href="${startHref}"/>\n</guide>\n</package>\n`;
  add('OEBPS/content.opf', opf);
  return { blob: zip(files), files: files.length, chapters: sections.length, images: usedImgs.size };
}

/* ---------------- sample ---------------- */
function sampleProject() {
  const p = newProject('pdf');
  Object.assign(p, {
    title: 'The 15-Minute Evening Reset', subtitle: 'A simple plan for calmer mornings', author: 'Sample Author', brand: 'BBY Sample Press',
    topic: 'A 15-minute evening routine that makes the next morning easier', audience: 'busy working parents who feel rushed every morning',
    description: 'Mornings feel rushed because the work starts too late. This short, practical guide shows busy parents how to use 15 minutes each evening to prepare for a calmer morning.\n\nInside you will learn:\n- how to spot your three biggest morning time-wasters\n- a simple 15-minute evening checklist\n- how to get kids to help without arguments',
    keywords: 'evening routine, morning routine for parents, family organization',
    dedication: 'For every parent who has searched for car keys at 7:58 a.m.',
    intro: 'Most rushed mornings are decided the night before. This book gives you one small habit: a **15-minute evening reset**.\n\nRead one chapter a day and try the action steps. *This is a sample book made with the BBY E-Book Builder.*',
    conclusion: 'You do not need a perfect routine. You need a **repeatable** one. Start tonight with the checklist in Chapter 2.',
    about: 'Sample Author is a placeholder name used to show how this page looks. Replace this with your real bio.',
    cta: 'Want more tools like this? Visit [Built By You Academy](https://www.skool.com/built-by-you-academy-3341).',
    disclaimer: 'This book is for educational purposes only.',
    chapters: [
      { id: uid(), title: 'Why Evenings Decide Your Mornings', body: '## The real problem\nMost morning stress comes from **decisions** made too late: what to wear, what to eat, where things are.\n\n> A calm morning starts the night before.\n\n### Common time-wasters\n- looking for keys, shoes or bags\n- deciding what to make for breakfast\n- signing forms at the door\n\nRead more about planning at [Built By You Academy](https://www.skool.com/built-by-you-academy-3341).' },
      { id: uid(), title: 'The 15-Minute Reset Checklist', body: '## Your checklist\n1. Clear the kitchen counter (3 minutes)\n2. Lay out clothes for everyone (4 minutes)\n3. Pack bags and put them by the door (4 minutes)\n4. Check tomorrow\'s calendar (2 minutes)\n5. Set out breakfast items (2 minutes)\n\n---\n\n## Action steps\n- Set a phone reminder for the same time every evening.\n- Try the checklist for 7 nights before changing it.' }
    ]
  });
  return p;
}

/* ---------------- events ---------------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('button,a,[data-ch]'); if (!t) return;
  const d = t.dataset;
  try {
    if (d.new) { const p = newProject(d.new); await DB.put(p); openProject(p); }
    else if (t.id === 'homeBtn') { if (P) { clearTimeout(saveTimer); await DB.put(P); } renderHome(); }
    else if (t.id === 'sampleBtn') { const p = sampleProject(); await DB.put(p); openProject(p); toast('Sample book opened. Change anything you like.'); }
    else if (d.open) { const p = await DB.get(d.open); if (p) openProject(p); }
    else if (d.dup) { const p = JSON.parse(JSON.stringify(await DB.get(d.dup))); p.id = uid(); p.type = p.type === 'kindle' ? 'pdf' : 'kindle'; p.title = p.title; p.updated = Date.now(); delete p.uuid; await DB.put(p); toast('Copied as a ' + (p.type === 'kindle' ? 'Kindle EPUB' : 'PDF') + ' project.'); renderHome(); }
    else if (d.backup) { const p = await DB.get(d.backup); download(new Blob([JSON.stringify(p)], { type: 'application/json' }), slug(p.title) + '.bbybook.json'); }
    else if (d.del) { const p = await DB.get(d.del); if (confirm('Delete "' + (p.title || 'Untitled book') + '" from this device? This cannot be undone unless you have a backup file.')) { await DB.del(d.del); renderHome(); } }
    else if (d.stepI != null) goStep(+d.stepI);
    else if (d.go) goStep(STEPS.findIndex(s => s[0] === d.go));
    else if (t.id === 'nextStep') goStep(step + 1);
    else if (t.id === 'prevStep') goStep(step - 1);
    else if (d.copy != null) { const ok = await copyText(prompts()[+d.copy][2]); toast(ok ? 'Prompt copied. Paste it into ChatGPT or Claude.' : 'Could not copy. Select the text and copy it.'); }
    else if (t.id === 'outlineBtn') { const made = outlineToChapters($('#outlineIn').value); if (!made.length) return toast('No chapter lines found. Start lines with "Chapter 1:" or "1."'); if (P.chapters.length === 1 && !P.chapters[0].body.trim() && /^Chapter 1$/.test(P.chapters[0].title)) P.chapters = []; P.chapters.push(...made); curCh = P.chapters.length - made.length; renderChapters(); renderPrompts(); touch(); toast(made.length + ' chapter(s) added. Go to step 3 to write them.'); $('#outlineIn').value = ''; }
    else if (t.id === 'addCh') { P.chapters.push({ id: uid(), title: 'Chapter ' + (P.chapters.length + 1), body: '' }); curCh = P.chapters.length - 1; renderChapters(); touch(); $('#chTitle').select(); }
    else if (d.up != null) { e.stopPropagation(); const i = +d.up; if (i > 0) { [P.chapters[i - 1], P.chapters[i]] = [P.chapters[i], P.chapters[i - 1]]; curCh = i - 1; renderChapters(); touch(); } }
    else if (d.down != null) { e.stopPropagation(); const i = +d.down; if (i < P.chapters.length - 1) { [P.chapters[i + 1], P.chapters[i]] = [P.chapters[i], P.chapters[i + 1]]; curCh = i + 1; renderChapters(); touch(); } }
    else if (d.rm != null) { e.stopPropagation(); const i = +d.rm; if (P.chapters.length === 1) return toast('A book needs at least one chapter.'); if (confirm('Delete chapter "' + (P.chapters[i].title || 'Untitled') + '"?')) { P.chapters.splice(i, 1); curCh = Math.max(0, Math.min(curCh, P.chapters.length - 1)); renderChapters(); touch(); } }
    else if (d.ch != null) { curCh = +d.ch; renderChapters(); }
    else if (d.md) {
      const ta = $('#chBody');
      if (d.md === 'b') wrapSel(ta, '**', '**', 'bold text');
      else if (d.md === 'i') wrapSel(ta, '*', '*', 'italic text');
      else if (d.md === 'h2') linePrefix(ta, '## ', 'Section heading');
      else if (d.md === 'h3') linePrefix(ta, '### ', 'Subheading');
      else if (d.md === 'ul') linePrefix(ta, '- ', 'List item');
      else if (d.md === 'ol') linePrefix(ta, n => n + '. ', 'List item');
      else if (d.md === 'q') linePrefix(ta, '> ', 'Quote');
      else if (d.md === 'hr') insertAtCursor(ta, '---');
      else if (d.md === 'link') { const url = prompt('Paste the web address (for example https://yourwebsite.com):'); if (url) wrapSel(ta, '[', '](' + normUrl(url) + ')', 'link text'); }
      else if (d.md === 'img') { if (!P.images.length) { toast('Add a picture first (below the editor).'); $('#imgFile').click(); return; } const list = P.images.map((m, i) => (i + 1) + '. ' + m.name).join('\n'); const n = prompt('Which picture? Type its number:\n' + list, '1'); const im = P.images[(+n || 0) - 1]; if (im) { const cap = prompt('Caption (optional, also used as alt text for Kindle):', '') || ''; insertAtCursor(ta, '![' + cap.replace(/[\[\]]/g, '') + '](img:' + im.id + ')'); } }
    }
    else if (t.id === 'togglePrev') { const pv = $('#chPrev'), hid = pv.classList.toggle('hide'); $('#splitBox').style.gridTemplateColumns = hid ? '1fr' : ''; t.textContent = hid ? 'Show preview' : 'Hide preview'; }
    else if (d.ins) { goStep(2); const ta = $('#chBody'); const cap = prompt('Caption (optional, also used as alt text for Kindle):', '') || ''; insertAtCursor(ta, '![' + cap.replace(/[\[\]]/g, '') + '](img:' + d.ins + ')'); }
    else if (d.rmimg) { if (confirm('Remove this picture from the project?')) { P.images = P.images.filter(x => x.id !== d.rmimg); renderImages(); updatePreview(); touch(); } }
    else if (t.id === 'cBgClear') { P.cover.bgImage = null; drawCoverPreview(); touch(); }
    else if (t.id === 'dlCover') { const cv = await renderCover(1600, 2560); download(await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92)), slug(P.title) + '-cover-1600x2560.jpg'); toast('Cover downloaded (1600 × 2560 JPG).'); }
    else if (t.id === 'expBackup') { download(new Blob([JSON.stringify(P)], { type: 'application/json' }), slug(P.title) + '.bbybook.json'); toast('Backup saved. Keep it somewhere safe.'); }
    else if (t.id === 'expPdf' || t.id === 'expEpub') {
      const bad = checks().filter(c => c[0] === 'bad');
      if (bad.length && !confirm('The checklist has ' + bad.length + ' red item(s). Export anyway as a draft?')) return;
      t.disabled = true; log('Starting export…', true);
      try {
        if (t.id === 'expPdf') {
          const r = await buildPdf(P); const url = download(r.bytes, slug(P.title) + '.pdf', 'application/pdf');
          $('#pdfOpen').href = URL.createObjectURL(new Blob([r.bytes], { type: 'application/pdf' })); $('#pdfOut').classList.remove('hide');
          $('#pdfInfo').textContent = r.pages + ' pages · ' + r.toc + ' clickable contents entries · ' + r.links + ' web links · ' + Math.round(r.bytes.length / 1024) + ' KB';
          log('Done! ' + $('#pdfInfo').textContent + '. Check your Downloads folder.'); window.__lastPdf = r;
        } else {
          const r = await buildEpub(P); download(r.blob, slug(P.title) + '.epub'); touch();
          log('Done! EPUB with ' + r.chapters + ' sections and ' + r.images + ' picture(s), ' + Math.round(r.blob.size / 1024) + ' KB. Check your Downloads folder, then follow the KDP steps below.'); window.__lastEpub = r;
        }
        toast('Export finished. Check your downloads.');
      } catch (err) { console.error(err); log('Something went wrong: ' + (err && err.message || err) + '\nTry again, or back up your project and ask in the BBY community.'); }
      t.disabled = false;
    }
  } catch (err) { console.error(err); toast('Error: ' + (err.message || err)); }
});
document.addEventListener('input', e => {
  const el = e.target; if (!P) return;
  if (el.dataset.f) { P[el.dataset.f] = el.value; if (el.dataset.f === 'title') $('#bookName').textContent = el.value || 'Untitled book'; if (/title|subtitle|author|brand/.test(el.dataset.f)) drawCoverPreview(); touch(); }
  else if (el.dataset.c) { P.cover[el.dataset.c] = el.value; drawCoverPreview(); touch(); }
  else if (el.id === 'chTitle') { P.chapters[curCh].title = el.value; const li = $(`#chList li[data-ch="${curCh}"] span`); if (li) li.textContent = (curCh + 1) + '. ' + (el.value || 'Untitled'); updatePreview(); touch(); }
  else if (el.id === 'chBody') { P.chapters[curCh].body = el.value; updatePreview(); touch(); }
});
document.addEventListener('change', async e => {
  const el = e.target;
  try {
    if (el.id === 'importFile' && el.files[0]) { const p = JSON.parse(await el.files[0].text()); if (p.app !== 'bby-ebook-builder' || !Array.isArray(p.chapters)) throw new Error('That is not a BBY E-Book Builder backup file.'); const ex = await DB.get(p.id); if (ex && !confirm('This project is already on this device. Replace it with the backup?')) { p.id = uid(); } await DB.put(p); el.value = ''; toast('Backup imported.'); openProject(p); }
    else if (el.id === 'imgFile' && el.files.length) { for (const f of el.files) { const r = await readImage(f, 1600); P.images.push({ id: uid(), name: f.name.replace(/\.[^.]+$/, ''), data: r.data, w: r.w, h: r.h }); } el.value = ''; renderImages(); touch(); toast('Picture(s) added. Use Insert to place one in the chapter.'); }
    else if (el.id === 'cFile' && el.files[0]) { const r = await readImage(el.files[0], 2560); P.cover.upload = r.data; P.cover.uploadW = r.w; P.cover.uploadH = r.h; el.value = ''; drawCoverPreview(); touch(); }
    else if (el.id === 'cBgFile' && el.files[0]) { const r = await readImage(el.files[0], 1600); P.cover.bgImage = r.data; el.value = ''; drawCoverPreview(); touch(); }
    else if (el.name === 'cmode') { P.cover.mode = el.value; setCoverMode(); drawCoverPreview(); touch(); }
    else if (el.id === 'promptChapter') renderPrompts();
    else if (el.dataset.conf) { P.confirms[el.dataset.conf] = el.checked; touch(); }
    else if (el.dataset.f && el.tagName === 'SELECT') { P[el.dataset.f] = el.value; touch(); }
    else if (el.dataset.c && el.tagName === 'SELECT') { P.cover[el.dataset.c] = el.value; drawCoverPreview(); touch(); }
  } catch (err) { console.error(err); toast(err.message || String(err), 4000); el.value = ''; }
});
window.addEventListener('beforeunload', () => { if (P) DB.put(P); });

// test hooks (used for automated checks; harmless for students)
window.BBYEBOOK = { buildPdf: p => buildPdf(p || P), buildEpub: p => buildEpub(p || P), sampleProject, get project() { return P; }, blocks, checks: () => checks() };
renderHome();
})();
