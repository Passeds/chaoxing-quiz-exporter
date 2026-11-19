// Every exported function is self-contained: chrome.scripting serialises it into the page.
export function extractWork() {
  const text = e => (e?.innerText || e?.textContent || '').trim();
  const url = new URL(location.href);
  // Read only explicitly labelled, rendered explanation blocks. Do not open AI services.
  function explanationFor(question){
    const blocks=[];
    for(const label of question.querySelectorAll('i,span,b,strong,h4,p,div')){
      const labelText=text(label),standalone=/^(?:答案解析|试题解析|题目解析|解析|答案分析)\s*[:：]?\s*$/.test(labelText);
      const inline=/^(?:答案解析|试题解析|题目解析|解析|答案分析)\s*[:：]\s*\S/.test(labelText);
      if(!standalone&&!inline)continue;
      if(label.closest('.qtContent,.qtDetail'))continue;
      if(label.querySelector('i,span,b,strong,h4,p,div'))continue;
      if(label.hidden||label.closest('[hidden],[aria-hidden="true"]')||!label.getClientRects().length)continue;
      let block=inline?label:label.parentElement;
      if(!block||block===question||block.querySelector('.qtContent,.rightAnswerContent,.stuAnswerContent'))continue;
      let value=text(block).replace(/^(?:答案解析|试题解析|题目解析|解析|答案分析)\s*[:：]?\s*/,'').trim();
      if(!value&&!block.querySelector('img')){
        block=label.nextElementSibling||block.nextElementSibling;
        if(!block||block.querySelector('.qtContent,.rightAnswerContent,.stuAnswerContent'))continue;
        value=text(block);
      }
      if(value||block?.querySelector('img'))blocks.push({text:value,images:Array.from(block.querySelectorAll('img')).map(x=>x.src)});
    }
    return {explanation:[...new Set(blocks.map(x=>x.text).filter(Boolean))].join('\n'),explanationImages:[...new Set(blocks.flatMap(x=>x.images))]};
  }
  const questions = Array.from(document.querySelectorAll('.questionLi')).map(e => ({
    id: e.id,
    type: text(e.querySelector('h3 .colorShallow')),
    stem: text(e.querySelector('.qtContent')),
    options: Array.from(e.querySelectorAll('.qtDetail li')).map(text),
    answer: text(e.querySelector('.rightAnswerContent')),
    mine: text(e.querySelector('.stuAnswerContent')),
    ...explanationFor(e),
    images: Array.from(e.querySelectorAll('.qtContent img,.qtDetail img')).map(x => x.src)
  }));
  return {
    title: text(document.querySelector('h2.mark_title')),
    expected: Number(document.body.innerText.match(/题量[:：]\s*(\d+)/)?.[1] || 0),
    courseId: url.searchParams.get('courseId'), workId: url.searchParams.get('workId'),
    collectedAt: new Date().toISOString(), questions
  };
}

export function discoverWorks() {
  return Array.from(document.querySelectorAll('li[role="link"][data]'))
    .filter(e => e.querySelector('.status')?.textContent.trim() === '已完成')
    .map(e => ({title:e.querySelector('p')?.textContent.trim(),url:e.getAttribute('data')}))
    .filter(x => {
      try { const u = new URL(x.url); return u.protocol === 'https:' && u.hostname.endsWith('.chaoxing.com') && /\/work\/task$/.test(u.pathname); }
      catch {return false;}
    });
}

// Identify what the currently opened tab shows. No network access, no page JS variables.
export function probeSource() {
  const txt = e => (e && (e.innerText || e.textContent) || '').replace(/\u00a0/g,' ').trim();
  const body = txt(document.body);
  const url = new URL(location.href);
  const domId = document.querySelector('#curCourseId,input[name="courseId"],input[name="courseid"],[data-courseid]');
  const courseId = url.searchParams.get('courseId') || url.searchParams.get('courseid') ||
    (domId && (domId.value || domId.getAttribute('data-courseid'))) || url.searchParams.get('clazzid') || '';
  const workLinks = Array.from(document.querySelectorAll('li[role="link"][data]'))
    .filter(e => e.querySelector('.status')?.textContent.trim() === '已完成').length;
  const quizCatalog = Array.from(document.querySelectorAll('a,li,div,span,p'))
    .filter(e => e.children.length === 0 && /单元检测|单元测验|章节测验|章节检测/.test(txt(e)) && txt(e).length < 40).length;
  const hasQuizAnswers = /正确答案\s*[:：]/.test(body) && /我的答案\s*[:：]/.test(body);
  const hasQuizMeta = /题量\s*[:：]?\s*\d+/.test(body);
  const hasSections = /^[一二三四五六七八九十]+、\s*.+?（共\s*\d+\s*题）/m.test(body);
  const expected = Number((body.match(/题量\s*[:：]?\s*(\d+)/) || [])[1] || 0);
  // Chapter document pages (PPT / PDF) mount an ananas viewer or link the object store.
  const hasDoc = !!document.querySelector('iframe[src*="/ananas/modules/pdf"],iframe[src*="/ananas/modules/ppt"],iframe[src*="/ananas/modules/office"],iframe[src*="/ananas/modules/doc"],a[href*="/star3/origin/"]');
  let kind = 'unknown';
  if (hasQuizAnswers && (hasQuizMeta || hasSections)) kind = 'quiz';
  else if (workLinks) kind = 'works';
  else if (hasDoc) kind = 'doc';
  else if (quizCatalog) kind = 'catalog';
  return {kind,url:location.href,courseId,expected,title:document.title||'',workLinks,quizCatalog,hasDoc,
    hasQuizAnswers,hasQuizMeta,hasSections,inIframe:top!==self};
}

// Read the chapter catalog. Only report URLs that the page itself exposes; never build one.
export function discoverChapterQuizzes() {
  const txt = e => (e && (e.innerText || e.textContent) || '').replace(/\u00a0/g,' ').trim();
  const label = /单元检测|单元测验|章节测验|章节检测/;
  const leaves = Array.from(document.querySelectorAll('a,li,div,span,p,[cardid],[jobid]'))
    .filter(e => label.test(txt(e)) && txt(e).length < 40 && (e.children.length === 0 || e.matches('[cardid],[jobid],li')));
  const out = [];
  for (const leaf of leaves) {
    let el = leaf;
    for (let i=0;i<4 && el.parentElement;i++) {
      el = el.parentElement;
      if (el.matches('a,li[role],[data],[onclick],button') || /unit|chapter|knowledge|catalog|item|node/i.test(String(el.className||''))) break;
    }
    const attrs = {};
    for (const a of Array.from(el.attributes)) if (/^(href|data-|onclick)/.test(a.name)) attrs[a.name] = a.value.slice(0,300);
    const raw = attrs.href || Object.values(attrs).find(v => /^https:\/\//.test(v)) || '';
    let url = '';
    try { const u = new URL(raw, location.href); if (u.protocol==='https:' && u.hostname.endsWith('.chaoxing.com')) url = u.href; } catch {}
    const title = txt(el).replace(/\s+/g,' ').slice(0,80) || txt(leaf);
    const area = txt(el.parentElement);
    const done = /已完成|已通过|已提交|已结束/.test(area) || /done|finish|complete|pass|finished/i.test(String(el.className||'')) ||
      !!el.closest('.ans-job-finished') || !!el.querySelector('.ans-job-finished');
    out.push({title,url,done,needsClick:!url,attrs,cardId:attrs.cardid||'',jobId:attrs.jobid||''});
  }
  return [...new Map(out.map(x => [x.title+'|'+x.url, x])).values()].slice(0,60);
}

// Read a completed chapter quiz answer-review page.
// Primary path: the real Chaoxing answer-card DOM (.TiMu / .questionLi) read through explicit
// selectors, so one card always yields exactly one question. Fallback: the visible-text state
// machine, only used when no card container exists at all.
export function extractChapterQuiz() {
  const txt = e => (e && (e.innerText || e.textContent) || '').replace(/\u00a0/g, ' ').trim();
  const url = new URL(location.href);
  const param = n => url.searchParams.get(n) || '';
  const domId = document.querySelector('#curCourseId,input[name="courseId"],input[name="courseid"],[data-courseid]');
  const courseId = param('courseId') || param('courseid') ||
    (domId && (domId.value || domId.getAttribute('data-courseid'))) || param('clazzid') || '';
  const body = txt(document.body);
  const LETTERS = 'ABCDEFGHIJ';
  const cleanNoise = s => String(s || '')
    .replace(/\s*(?:AI\s*讲解|加入错题|查看解析|收起|展开|重做测验|重新测验|重新作答)\s*/g, ' ')
    .replace(/[ \t\u3000]+/g, ' ').trim();
  const stripLabel = s => String(s || '')
    .replace(/^\s*(?:我的答案|正确答案|参考答案|答案解析|试题解析|题目解析|知识点|题型|难度)\s*[:：]\s*/, '').trim();
  const answerOf = raw => {
    const v = stripLabel(cleanNoise(raw));
    if (!v) return '';
    if (/^[A-J][A-J\s、,，.．]*$/.test(v)) return v.replace(/[^A-J]/g, '');
    return v.slice(0, 20);
  };
  const firstText = (card, sels) => {
    for (const s of sels) {
      const el = card.querySelector(s);
      if (!el) continue;
      const v = cleanNoise(txt(el));
      if (v) return v;
    }
    return '';
  };
  const sectionCounts = [];

  // ---------- pass 1: real answer cards ----------
  let cards = Array.from(document.querySelectorAll('.TiMu'));
  if (!cards.length) cards = Array.from(document.querySelectorAll('.questionLi'));
  if (!cards.length) {
    cards = Array.from(document.querySelectorAll('.ans-cc,[id^="question"]'))
      .filter(e => /正确答案|我的答案/.test(txt(e)));
  }
  let blankCards = 0;
  const questions = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const numText = txt(card.querySelector('.Zy_TItle i,i.fl,.mark_name,.questionNum,.num'));
    let number = Number((numText.match(/\d{1,3}/) || [])[0] || 0);
    if (!number) number = i + 1;

    const type = firstText(card, ['.newZy_TItle', '.colorShallow', '.questionType', '.type'])
      .replace(/^[【\[（(]\s*/, '').replace(/\s*[】\]）)]$/, '').trim();

    let stem = firstText(card, ['.qtContent', '.questionStem', '.stem']);
    if (!stem) stem = firstText(card, ['.Zy_TItle']).replace(/^\d{1,3}\s*[\.、．\)）]?\s*/, '');
    stem = cleanNoise(stem.replace(/^[【\[（(]\s*[^】\]）)]{1,12}\s*[】\]）)]\s*/, ''));
    if (!stem) { blankCards++; continue; }

    const options = [];
    for (const li of Array.from(card.querySelectorAll('.qtDetail li,.Zy_ulTop li,ul li[role="option"]'))) {
      const letterEl = li.querySelector('i,.optionLetter');
      const linkEl = li.querySelector('a');
      let letter = letterEl ? txt(letterEl).replace(/[^A-J]/g, '') : '';
      let content = linkEl ? txt(linkEl) : txt(li);
      if (!letter) {
        const mm = content.match(/^\s*([A-J])\s*[\.、．\)）:：]\s*/);
        if (!mm) continue;
        letter = mm[1]; content = content.slice(mm[0].length);
      } else if (!linkEl) {
        content = content.replace(/^\s*[A-J]\s*[\.、．\)）:：]?\s*/, '');
      }
      content = cleanNoise(content);
      if (letter && content) options.push(letter + '. ' + content);
    }

    const q = {
      id: 'q' + number, number, type, stem,
      options: Array.from(new Set(options)),
      answer: answerOf(firstText(card, ['.rightAnswerContent', '.correctAnswer .answerCon', '.correctAnswer'])),
      mine: answerOf(firstText(card, ['.stuAnswerContent', '.myAnswer .answerCon', '.myAnswer'])),
      explanation: cleanNoise(firstText(card, ['.answerKeyBx .answerCon', '.answerKeyBx', '.explanation', '.analysis'])).slice(0, 6000),
      explanationImages: [], images: [],
      knowledgePoints: Array.from(card.querySelectorAll('.knowledgePointBx .knowledgeList li,.knowledgePointBx li'))
        .map(li => (li.getAttribute('title') || txt(li)).trim()).filter(Boolean).join('；').slice(0, 120),
      score: (firstText(card, ['.scoreNum', '.newAnswerScore']) || '').match(/\d+(?:\.\d+)?/)?.[0] || '',
      section: '', notes: []
    };
    for (const img of Array.from(card.querySelectorAll('img'))) {
      const src = img.currentSrc || img.src || '';
      if (!/^https:\/\//.test(src)) continue;
      // Real question images live on p.ananas.chaoxing.com/star3/... so "star" must not be filtered.
      if (/avatar|emoji|placeholder|marking_|icon_|sprite/i.test(src)) continue;
      if (img.naturalWidth && img.naturalWidth < 40) continue;
      if (img.closest('.answerKeyBx')) q.explanationImages.push(src); else q.images.push(src);
    }
    q.images = Array.from(new Set(q.images));
    q.explanationImages = Array.from(new Set(q.explanationImages));
    questions.push(q);
  }

  // A page can render a hidden duplicate copy of the same cards; keep the first of each pair.
  const seenQ = new Set();
  const uniqueQ = [];
  for (const q of questions) {
    const k = q.number + '|' + q.stem;
    if (seenQ.has(k)) continue;
    seenQ.add(k); uniqueQ.push(q);
  }
  questions.length = 0;
  questions.push(...uniqueQ);

  // Section headings ("一. 单选题（共65题）") sit outside the cards; map them by order.
  const heads = [];
  if (questions.length) {
    for (const line of body.split(/\r?\n/).map(s => s.trim())) {
      const mm = line.match(/^([一二三四五六七八九十]+)\s*[.、．]\s*(.{1,20}?)\s*[（(]\s*共\s*(\d+)\s*题\s*[)）]/);
      if (mm) heads.push({label: mm[1] + '. ' + mm[2].trim(), count: Number(mm[3])});
    }
  }
  if (heads.length) {
    for (const h of heads) sectionCounts.push(h.count);
    let cursor = 0;
    for (const h of heads) {
      const end = Math.min(questions.length, cursor + h.count);
      for (let i = cursor; i < end; i++) questions[i].section = h.label;
      cursor = end;
    }
    for (let i = cursor; i < questions.length; i++) questions[i].section = heads[heads.length - 1].label;
  }

  // ---------- pass 2: line state machine fallback ----------
  if (!questions.length) {
    const noise = /^(?:AI\s*讲解|加入错题|重做测验|重新测验|重新作答|返回课程|章节详情|目录|讨论|笔记|标注|搜索|任务点.*|已完成.*|最高分.*|截止时间.*|题量.*|满分.*|第\d{1,3}次作答.*|本次成绩.*|查看解析.*|收起.*|展开.*)$/;
    const raw = body.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const lines = [];
    for (let i = 0; i < raw.length; i++) {
      const line = raw[i], nxt = raw[i + 1];
      const takeNext = !!nxt && !noise.test(nxt);
      const numOnly = /^\d{1,3}$/.test(line) || /^\d{1,3}\s*[\.、．\)）]$/.test(line);
      const labelOnly = /^(我的答案|正确答案|参考答案|答案解析|试题解析|题目解析|答案分析|知识点)$/.test(line);
      const letterOnly = /^[A-J]$/.test(line) || /^[A-J]\s*[\.、．\)）]$/.test(line);
      if (takeNext && numOnly && !/^\d{1,3}$/.test(nxt) && !/^[一二三四五六七八九十]+、/.test(nxt) &&
          !/^(我的答案|正确答案|参考答案|答案解析|知识点)$/.test(nxt)) {
        const head = line.replace(/\s*[\.、．\)）]$/, '');
        lines.push(/^[【\[]/.test(nxt) ? head + nxt : head + '. ' + nxt);
        i++; continue;
      }
      if (takeNext && labelOnly) { lines.push(line + '：' + nxt); i++; continue; }
      if (takeNext && letterOnly && !/^[A-J]$/.test(nxt) && !/^[A-J]\s*[\.、．\)）]$/.test(nxt)) {
        lines.push(line.replace(/\s*[\.、．\)）]$/, '') + '. ' + nxt); i++; continue;
      }
      lines.push(line);
    }
    if (!lines.some(l => /^(?:第\s*)?\d{1,3}\s*(?:题)?\s*(?:[\.、．\)）]|[【\[])/.test(l))) {
      let seq = 0;
      for (let i = 0; i < lines.length; i++) {
        if (/^[【\[]\s*[^】\]]{1,12}\s*[】\]]/.test(lines[i])) lines[i] = (++seq) + lines[i];
      }
    }

    const sectionRe = /^([一二三四五六七八九十]+、\s*.+?)\s*(?:[（(]\s*共\s*(\d+)\s*题\s*[)）])?\s*$/;
    const headTypeRe = /^(?:第\s*)?(\d{1,3})\s*(?:题)?\s*[\.、．\)）]?\s*[【\[]\s*([^】\]]{1,12})\s*[】\]]\s*(.*)$/;
    const headPlainRe = /^(?:第\s*)?(\d{1,3})\s*(?:题)?\s*[\.、．\)）]\s*([^\d\s].*)$/;
    const optionRe = /^([A-J])\s*(?:[\.、．\)）:：]\s*|\s+)(.+)$/;
    const scoreRe = /^[✓✔]?\s*(\d+(?:\.\d+)?)\s*分\s*$/;
    const labelRe = /(我的答案|正确答案|参考答案|答案解析|试题解析|题目解析|答案分析|知识点)\s*[:：]/g;
    const splitLabels = line => {
      const marks = []; labelRe.lastIndex = 0; let mm;
      while ((mm = labelRe.exec(line))) marks.push({label: mm[1], start: mm.index, end: labelRe.lastIndex});
      if (!marks.length) return [{label: '', text: line}];
      const out = [];
      if (marks[0].start > 0) out.push({label: '', text: line.slice(0, marks[0].start).trim()});
      for (let i = 0; i < marks.length; i++) {
        out.push({label: marks[i].label, text: line.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].start : line.length).trim()});
      }
      return out;
    };

    const fb = [];
    let cur = null, section = '', sectionChanged = false, expectNum = 1, inExpl = false;
    const flush = () => { if (cur) fb.push(cur); cur = null; };
    const stripScore = t => {
      let s = String(t || '');
      const mm = s.match(/(?:[✓✔]\s*)?(\d+(?:\.\d+)?)\s*分\s*$/);
      if (mm) { cur.score = mm[1]; s = s.slice(0, mm.index); }
      return s.replace(/^(?:AI\s*讲解|加入错题|查看解析|收起|展开)\b\s*/, '').trim();
    };
    const applyLabel = p => {
      const t = stripScore(p.text);
      if (p.label === '正确答案' || p.label === '参考答案') { cur.answer = t; inExpl = false; }
      else if (p.label === '我的答案') { cur.mine = t; inExpl = false; }
      else if (p.label === '知识点') { cur.knowledgePoints = t; inExpl = false; }
      else { inExpl = true; if (t) cur.explanation += (cur.explanation ? '\n' : '') + t.slice(0, 4000); }
    };
    const takeOption = line => {
      const mm = line.match(optionRe);
      if (!mm || mm[1] !== String.fromCharCode(65 + cur.options.length)) return false;
      cur.options.push(mm[1] + '. ' + mm[2].trim());
      return true;
    };
    const takeOptions = line => {
      let taken = 0;
      for (const piece of line.split(/\s+(?=[A-J]\s*[\.、．\)）]\s*\S)/)) if (takeOption(piece.trim())) taken++;
      return taken > 0;
    };

    for (const line of lines) {
      const sec = line.match(sectionRe);
      if (sec && line.length < 60) {
        flush(); section = sec[1].trim(); sectionChanged = true;
        if (sec[2]) sectionCounts.push(Number(sec[2]));
        inExpl = false; expectNum = 1; continue;
      }
      if (noise.test(line)) { inExpl = false; continue; }

      let number = 0, type = '', stem = '';
      const h1 = line.match(headTypeRe);
      const h2 = h1 ? null : line.match(headPlainRe);
      if (h1) { number = Number(h1[1]); type = h1[2].trim(); stem = h1[3].trim(); }
      else if (h2) { number = Number(h2[1]); stem = h2[2].trim(); }
      const plausible = number > 0 && (number === expectNum || (number === 1 && sectionChanged && fb.length > 0));
      if (plausible) {
        flush(); sectionChanged = false; expectNum = number + 1; inExpl = false;
        cur = {id:'q'+number,number,type:type || section.replace(/^[一二三四五六七八九十]+、\s*/,'').replace(/[（(]共\d+题[)）]/,'').trim(),
          stem:'',options:[],answer:'',mine:'',explanation:'',explanationImages:[],images:[],
          knowledgePoints:'',score:'',section,notes:[],pre:[]};
        const pieces = splitLabels(stem);
        cur.stem = pieces.filter(p => !p.label).map(p => p.text).join(' ')
          .replace(/\s*(?:AI\s*讲解|加入错题|查看解析|收起|展开)\s*/g,' ').trim();
        for (const p of pieces) if (p.label) applyLabel(p);
        continue;
      }
      if (!cur) continue;

      const parts = splitLabels(line);
      if (parts.some(p => p.label)) {
        for (const p of parts) {
          if (p.label) applyLabel(p);
          else if (p.text && !cur.options.length && !cur.stem) cur.stem = p.text;
        }
        continue;
      }
      let mm;
      if ((mm = line.match(scoreRe))) { cur.score = mm[1]; inExpl = false; continue; }
      if (inExpl) { cur.explanation += (cur.explanation ? '\n' : '') + line; continue; }
      if (takeOptions(line)) continue;
      if (!cur.answer && !cur.mine && line.length < 160) { cur.pre.push(line); continue; }
      if (!cur.answer && !cur.mine) cur.stem += (cur.stem ? ' ' : '') + line;
    }
    flush();

    for (const q of fb) {
      if (!q.stem && q.pre.length) q.stem = q.pre.shift();
      if (!q.options.length && q.pre.length && q.pre.every(s => s.length < 40)) {
        q.options = q.pre.map((s,i) => String.fromCharCode(65+i) + '. ' + s);
      } else if (q.pre.length && q.stem.length < 12) {
        q.stem += ' ' + q.pre.shift();
        q.options = q.pre.map((s,i) => String.fromCharCode(65+i) + '. ' + s).concat(q.options);
      }
      delete q.pre;
      if (q.options.length < 2) q.notes.push('选项可能未完整识别，请对照原页面核对');
    }
    questions.push(...fb);

    let looseImages = 0;
    for (const img of Array.from(document.querySelectorAll('img'))) {
      const src = img.currentSrc || img.src || '';
      if (!/^https:\/\//.test(src) || /avatar|icon|logo|emoji|face|star|placeholder/i.test(src)) continue;
      if (img.naturalWidth && img.naturalWidth < 40) continue;
      let node = img, num = 0, isExpl = false;
      for (let i = 0; i < 7 && node.parentElement; i++) {
        node = node.parentElement;
        const t = txt(node);
        if (t.length > 3500) break;
        const hit = t.match(/^\s*(\d{1,3})\s*[【\[]/m);
        if (hit) { num = Number(hit[1]); isExpl = /答案解析|试题解析|题目解析/.test(t); break; }
      }
      const q = questions.find(x => x.number === num);
      if (!q) { looseImages++; continue; }
      if (isExpl) q.explanationImages.push(src); else q.images.push(src);
    }
    for (const q of questions) {
      q.images = Array.from(new Set(q.images));
      q.explanationImages = Array.from(new Set(q.explanationImages));
    }
    if (looseImages && questions.length) questions[0].notes.push('页面有 ' + looseImages + ' 张图片未能定位归属，请用原页面核对');
  }

  const headingPool = [];
  for (const sel of ['h1', 'h2', 'h3', '.mark_title', '[class*="mark_title"]']) {
    for (const e of Array.from(document.querySelectorAll(sel))) { const v = txt(e); if (v && v.length < 80) headingPool.push(v); }
  }
  const bodyLines = body.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const quizTitle = /单元检测|单元测验|单元测试|章节检测|综合练习|检测$/;
  const title = headingPool.find(v => quizTitle.test(v)) ||
    bodyLines.find(v => v.length >= 4 && v.length <= 80 && quizTitle.test(v)) ||
    bodyLines.find(v => /检测|测验/.test(v) && v.length >= 4 && v.length <= 80) ||
    document.title || '章节检测';
  const meta = body.match(/题量\s*[:：]?\s*(\d+)/);
  const sectionTotal = sectionCounts.reduce((a, b) => a + b, 0);
  let expected = meta ? Number(meta[1]) : (sectionTotal || questions.length);
  if (!expected) expected = questions.length;
  if (meta && sectionTotal && sectionTotal !== expected && questions.length) {
    questions[0].notes.push('页面题量 ' + expected + ' 与分节合计 ' + sectionTotal + ' 不一致，已按页面题量校验');
  }
  if (blankCards) {
    if (questions.length) questions[0].notes.push('有 ' + blankCards + ' 道题未能读到题干，请对照原页面核对');
  }
  const stableKeys = ['chapterid', 'knowledgeid', 'cardid', 'workid', 'testid', 'examid', 'paperid', 'quizid'];
  const idPart = Array.from(url.searchParams).filter(([k]) => stableKeys.includes(k.toLowerCase())).map(([k, v]) => k + '=' + v).join('&');
  const domPart = document.querySelector('.prev_ul li.active')?.getAttribute('cardid') || document.querySelector('#chapterIdid')?.value || '';
  const quizId = [idPart, domPart, title].filter(Boolean).join('|');
  // Which chapter this answer page belongs to. The dashboard uses it to ignore frames
  // that still belong to another chapter, so one unit never inherits the previous unit's quiz.
  const knowledgeId = param('knowledgeid') || param('knowledgeId') || param('chapterid') || param('chapterId') || '';
  return {
    title, expected, sectionCounts, courseId, quizId, knowledgeId,
    workId: 'quiz-' + quizId, source: 'quiz', collectedAt: new Date().toISOString(),
    pageUrl: location.href, cardCount: cards.length, blankCards, questions
  };
}

// Read the chapter's attachment list (PPT / PDF / 讲义) from what the page itself holds.
// Sources, in priority order: the cards page AttachmentSetting object, iframe data attributes,
// links to the object storage, and the resource-timing history of the document viewer.
// Nothing is fetched: the URLs reported are the ones this page already requested.
export function scanDocuments() {
  const txt = e => (e && (e.innerText || e.textContent) || '').replace(/\u00a0/g, ' ').trim();
  const url = new URL(location.href);
  const rows = [];
  // Chaoxing hands the same file over under many key names; collect every URL shape, then let
  // the downloader verify which one really answers with the file body.
  const URL_KEYS = ['url', 'downloadUrl', 'download', 'pdf', 'src', 'fileUrl', 'href', 'previewUrl', 'viewUrl', 'objectUrl'];
  const asUrl = v => {
    const s = String(v ?? '').trim().replace(/^http:\/\//i, 'https://');
    return /^https:\/\/[^/\s]+chaoxing\.com\//i.test(s) ? s : '';
  };
  const push = o => {
    if (!o || typeof o !== 'object') return;
    const objectid = String(o.objectid || o.objectId || o.objectidStr || o.fileid || o.fileId || '').trim();
    const name = String(o.name || o.fileName || o.filename || o.title || o.originalName || '').trim();
    const urls = [];
    const addUrl = v => { const s = asUrl(v); if (s && !urls.includes(s)) urls.push(s); };
    if (Array.isArray(o.urls)) o.urls.forEach(addUrl);
    URL_KEYS.forEach(k => addUrl(o[k]));
    if (!objectid && !urls.length) return;
    rows.push({
      objectid, name, url: urls[0] || '', urls,
      type: String(o.type || o.fileType || o.filetype || '').toLowerCase(),
      size: Number(o.size || o.length || o.fileSize || 0) || 0,
      jobid: String(o.jobid || o.jobId || ''),
      from: o.from || 'dom'
    });
  };
  const CONTAINER_KEYS = ['attachments', 'attachment', 'attach', 'fileList', 'files', 'documents', 'docs', 'list', 'data', 'result'];
  const walk = (node, from, depth) => {
    if (!node || typeof node !== 'object' || depth > 3) return;
    if (Array.isArray(node)) { node.forEach(x => walk(x, from, depth + 1)); return; }
    push({ ...node, from });
    for (const key of CONTAINER_KEYS) if (node[key]) walk(node[key], from, depth + 1);
  };
  const fromJson = (raw, from) => {
    if (!raw) return;
    let data = raw;
    if (typeof raw === 'string') {
      const s = raw.trim();
      if (!s || s[0] !== '{' && s[0] !== '[') return;
      try { data = JSON.parse(s); } catch { try { data = JSON.parse(decodeURIComponent(s)); } catch { return; } }
    }
    walk(data, from, 0);
  };

  // 1. Cards page global: parent.AttachmentSetting is what the module frames read.
  for (const key of ['AttachmentSetting', 'attachmentSetting', 'attachmentSettingJson', 'AttachmentSettingJson', 'setting', 'docConfig', 'officeConfig']) {
    try {
      const value = window[key];
      if (value && typeof value === 'object') fromJson(value, 'setting');
    } catch {}
  }
  // 2. Attachment iframes and elements carry the same metadata in data/objectid attributes.
  for (const el of Array.from(document.querySelectorAll('iframe[data],[data*="objectid"],[objectid]'))) {
    const attr = el.getAttribute('data');
    if (attr && /objectid/i.test(attr)) fromJson(attr, 'iframe');
    const oid = el.getAttribute('objectid');
    if (oid) push({ objectid: oid, name: el.getAttribute('name') || el.getAttribute('title') || '', type: el.getAttribute('type') || '', from: 'dom' });
  }
  // 2b. Some viewer builds put the file id (and even the file URL) in the iframe query string.
  for (const el of Array.from(document.querySelectorAll('iframe[src*="/ananas/"],iframe[src*="star3/origin"],iframe[src*="modules/"]'))) {
    let src = '';
    try { src = new URL(el.getAttribute('src') || '', location.href).href; } catch { continue; }
    const q = new URL(src).searchParams;
    const oid = q.get('objectid') || q.get('objectId') || q.get('fileid') || q.get('fileId') || '';
    if (oid) {
      push({
        objectid: oid, name: q.get('name') || q.get('fileName') || '', type: q.get('type') || '',
        url: q.get('url') || '', downloadUrl: q.get('download') || '', pdf: q.get('pdf') || '', from: 'iframe'
      });
    } else if (/star3\/origin\//.test(src)) push({ objectid: '', url: src, from: 'iframe' });
  }
  // 3. Direct links already pointing at a file or at the download gateway.
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') || '';
    if (!/star3\/origin|flag=|\.(?:pdf|pptx?|docx?|xlsx?|zip)(?:[?#]|$)/i.test(href)) continue;
    const hit = href.match(/\/star3\/origin\/([^/?#]+)/);
    let abs = '';
    try { abs = new URL(href, location.href).href; } catch {}
    if (!asUrl(abs)) continue;
    push({ objectid: hit ? decodeURIComponent(hit[1]) : '', url: abs, name: txt(a), from: 'link' });
  }
  // 4. What the viewer already loaded: this is the F12 "flag / .pdf" request, already made by
  // the page with its own cookies, so it is the most reliable URL we can get.
  const perfUrls = [];
  try {
    // The default resource buffer drops old entries; raise it so a file request made while
    // paging through the deck is still visible when the user clicks scan.
    if (typeof performance.setResourceTimingBufferSize === 'function') performance.setResourceTimingBufferSize(2000);
    for (const entry of performance.getEntriesByType('resource')) {
      const u = String(entry.name || '').replace(/^http:\/\//i, 'https://');
      if (!asUrl(u)) continue;
      const hit = u.match(/\/star3\/origin\/([^/?#]+)/);
      const statusHit = u.match(/\/ananas\/status\/([^/?#]+)/i);
      const tail = decodeURIComponent((u.split(/[?#]/)[0].split('/').pop() || ''));
      const isFile = /\.(pdf|pptx?|pptm|potx?|docx?|docm|rtf|xlsx?|xlsm|csv|txt|zip|rar|7z|wps|et|dps|ofd|mp4|m4v|flv|mp3|m4a|wav|avi|mov|wmv|mkv|webm)$/i.test(tail);
      // /ananas/status/<id> is the JSON manifest the viewer reads first; it names the file.
      const oid = hit ? decodeURIComponent(hit[1]) : (statusHit ? decodeURIComponent(statusHit[1]) : '');
      if (!isFile && !oid && !/[?&]flag=/i.test(u)) continue;
      perfUrls.push(u);
      push({ objectid: oid, url: u, urls: [u], name: isFile && !oid ? tail : '', from: 'perf' });
    }
  } catch {}
  // 5. Some builds only leave the download URL inside an inline script/config string.
  try {
    const html = (document.documentElement && document.documentElement.innerHTML || '').slice(0, 800000);
    const found = html.match(/https?:\/\/[^"'\s<>\\]{20,300}?\.(?:pdf|pptx?|docx?|xlsx?|zip)(?:\?[^"'\s<>\\]{0,200})?/gi) || [];
    for (const raw of [...new Set(found)].slice(0, 60)) {
      const u = raw.replace(/^http:\/\//i, 'https://');
      // Only file-storage or explicit-download URLs; other .pdf links on the page are unrelated.
      if (!/\/star3\/origin\/|[?&]flag=/i.test(u)) continue;
      push({ url: u, from: 'script' });
    }
  } catch {}

  // Collapse the same file reported by several sources.
  const merged = new Map();
  for (const row of rows) {
    const key = (row.objectid || row.url || (row.urls && row.urls[0]) || '').toLowerCase();
    if (!key) continue;
    const prev = merged.get(key);
    if (!prev) { merged.set(key, row); continue; }
    merged.set(key, {
      ...prev, ...row,
      objectid: prev.objectid || row.objectid,
      name: prev.name || row.name,
      url: prev.url || row.url,
      urls: [...new Set([...(prev.urls || []), ...(row.urls || [])])],
      size: prev.size || row.size,
      type: prev.type || row.type,
      from: [prev.from, row.from].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join('+')
    });
  }

  // Chapter title as shown in the class catalog, for optional naming.
  const titleCandidates = [];
  for (const sel of [
    '.prev_ul li.active', '.prev_ul li.on', '.prev_ul li.current',
    '.posCatalog_active', '.posCatalog_select', '.prev_list li.active',
    '#prev_tab .active', '.nav_chapter .active',
    '[class*="catalog"] [class*="active"]', '[class*="catalog"] [class*="cur"]',
    '.chapter_item.active', '.chapterName', '#chapterName', '#contentTitle',
    '.mark_title', '.zt_name', 'h1', 'h2'
  ]) {
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const v = txt(el);
      if (v && v.length <= 80) titleCandidates.push(v);
    }
  }
  const tabs = Array.from(document.querySelectorAll('.prev_ul li')).map(e => txt(e)).filter(v => v && v.length <= 80).slice(0, 20);

  return {
    url: location.href,
    title: document.title || '',
    activeTitle: titleCandidates[0] || '',
    titles: [...new Set(titleCandidates)].slice(0, 5),
    tabs,
    courseId: url.searchParams.get('courseid') || url.searchParams.get('courseId') || '',
    clazzId: url.searchParams.get('clazzid') || '',
    cpi: url.searchParams.get('cpi') || '',
    inIframe: top !== self,
    perfUrls: perfUrls.slice(0, 40),
    attachments: [...merged.values()].slice(0, 200)
  };
}

// Last resort: let the page itself fetch the file, so the request carries the page's cookies
// and Referer (Chaoxing's storage rejects requests without them). The blob is handed to a
// temporary <a download>, which cannot choose a sub-folder but does keep the real bytes.
export async function fetchDocInPage(args) {
  const urls = (args && Array.isArray(args.urls) ? args.urls : []).slice(0, 8);
  const filename = String(args && args.filename || 'course-file');
  const tried = [];
  for (const u of urls) {
    try {
      const res = await fetch(u, { credentials: 'include' });
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok) { tried.push({ url: u, status: res.status, ct }); continue; }
      if (/html|json|xml|javascript/.test(ct)) { tried.push({ url: u, status: res.status, ct }); continue; }
      const blob = await res.blob();
      if (blob.size < 1024) { tried.push({ url: u, status: res.status, ct, size: blob.size }); continue; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 120000);
      return { ok: true, url: u, size: blob.size, ct, tried };
    } catch (e) {
      tried.push({ url: u, error: String(e && e.message || e) });
    }
  }
  return { ok: false, tried };
}

// /ananas/status/<id> answers with a JSON manifest (real download / pdf URLs, file name,
// size). Fetching it from the page context keeps the viewer's own cookies and Referer.
export async function readStatusInPage(args) {
  const urls = (args && Array.isArray(args.urls) ? args.urls : []).slice(0, 4);
  const out = [];
  for (const u of urls) {
    try {
      const res = await fetch(u, { credentials: 'include' });
      const text = await res.text();
      if (!res.ok) { out.push({ url: u, status: res.status }); continue; }
      if (!/^\s*[{[]/.test(text)) { out.push({ url: u, error: 'not-json', ct: res.headers.get('content-type') || '' }); continue; }
      out.push({ url: u, data: JSON.parse(text) });
    } catch (e) {
      out.push({ url: u, error: String(e && e.message || e) });
    }
  }
  return out;
}

// Copyable diagnostics when a future Chaoxing build breaks the text parser.
export function diagnosePage() {
  const txt = e => (e && (e.innerText || e.textContent) || '').replace(/\u00a0/g,' ').trim();
  const body = txt(document.body);
  const leaf = Array.from(document.querySelectorAll('body *')).filter(e => e.children.length === 0 && txt(e));
  const anchors = leaf.filter(e => /^(?:正确答案|我的答案|答案解析|知识点)\s*[:：]?/.test(txt(e)))
    .slice(0,12).map(e => ({tag:e.tagName,cls:String(e.className||'').slice(0,120),text:txt(e).slice(0,160)}));
  const counts = new Map();
  for (const e of Array.from(document.querySelectorAll('[class]'))) {
    for (const c of String(e.className||'').split(/\s+/)) if (c) counts.set(c,(counts.get(c)||0)+1);
  }
  return {
    url:location.href, title:document.title||'', inIframe:top!==self,
    cards:document.querySelectorAll('.TiMu').length,
    legacyCards:document.querySelectorAll('.questionLi').length,
    frames:Array.from(document.querySelectorAll('iframe')).map(f => f.src),
    frameSrc:document.querySelector('#iframe')?.src || '',
    courseDom:document.querySelector('#curCourseId')?.value || '',
    catalog:Array.from(document.querySelectorAll('.prev_ul li,[cardid]')).slice(0,20).map(e => ({text:txt(e).slice(0,60),cardId:e.getAttribute('cardid')||''})),
    meta:(body.match(/题量[\s\S]{0,140}/)||[])[0] || '',
    head:body.slice(0,2500), anchors,
    topClasses:[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,30),
    sample:(Array.from(document.querySelectorAll('[class]')).find(e => /正确答案/.test(txt(e)) && txt(e).length < 2500)?.outerHTML || '').slice(0,4000)
  };
}
