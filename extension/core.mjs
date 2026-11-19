export const clean = x => String(x ?? '').replace(/\s+/g,' ').trim();
export const escapeHtml = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validateWork(w) {
  if (!w.title || !w.expected || w.questions.length !== w.expected) throw Error('题量不匹配或页面尚未加载，未保存本次结果');
  if(w.questions.some(q=>!q.stem)) throw Error('存在无法读取的题干，未保存本次结果');
  return w;
}
export function validateQuiz(w) {
  if (!w.title) throw Error('未读到章节检测标题，未保存本次结果');
  if (!w.questions.length) throw Error('未在页面可见内容中识别到题目。若页面上已显示「我的答案 / 正确答案」，请点「复制页面诊断信息」把内容发给开发者。');
  if (w.questions.some(q=>!q.stem)) throw Error('存在无法读取的题干，未保存本次结果');
  const nums=w.questions.map(q=>Number(q.number)||0);
  if (!w.expected && !nums.every((n,i)=>i===0||n>nums[i-1]||n===1)) throw Error('题号异常且页面未给出题量，未保存本次结果');
  // 真实答卷页可能分页或懒加载，一次只渲染一部分题目。允许保存已渲染部分，由调用方按题号合并并提示缺口。
  const complete = !w.expected || w.questions.length >= w.expected;
  return {...w, complete, missing: complete ? 0 : Math.max(0, w.expected - w.questions.length)};
}
const normAnswer = s => { const v=clean(s).toUpperCase(); return /^[A-Z]+$/.test(v) ? [...v].sort().join('') : v; };
// Export scope: one unit's 单元检测 must never drag another unit's questions into the file.
// choice: '__recent' (last collected), '__all', or an exact workId.
export function pickQuizzes(quizzes=[],lastIds=[],choice='__recent'){
  if(choice==='__all')return quizzes.slice();
  if(choice==='__recent'){
    const list=quizzes.filter(q=>lastIds.includes(q.workId));
    return list.length?list:quizzes.slice();
  }
  const one=quizzes.filter(q=>q.workId===choice);
  return one.length?one:quizzes.slice();
}
export function makeBank(works) {
  const bank=[]; const seen=new Map();
  for(const w of works) for(const raw of w.questions) {
    const q={...raw,stem:clean(raw.stem),type:clean(raw.type).replace(/[()（）]/g,''),options:(raw.options||[]).map(clean),answer:clean(raw.answer),mine:clean(raw.mine),explanation:String(raw.explanation||'').trim(),explanationImages:raw.explanationImages||[],notes:Array.isArray(raw.notes)?[...raw.notes]:[],sources:[{title:w.title,workId:w.workId,questionId:raw.id}]};
    if(!q.answer)q.notes.push('平台未公布答案，待核对');
    if(q.options.some(s=>/答案\s*[:：]/.test(s)))q.notes.push('原选项夹带答案文字；以独立的“正确答案”字段为准，原文保留');
    if(q.options.some(s=>/\b([A-Z])\1\./.test(s)))q.notes.push('原选项存在合并或重复标签，需核对排版');
    if(q.options.some(s=>/AI\s*讲解|加入错题|重新测验|返回课程|任务点/.test(s)))q.notes.push('选项疑似混入页面按钮文字，原文保留');
    if(q.images?.length)q.notes.push('含在线图片，离线阅读可能无法显示；请保留原页面核对');
    q.wrong=!!q.answer && !!q.mine && normAnswer(q.answer)!==normAnswer(q.mine);
    const key=JSON.stringify([q.type,q.stem,q.options]);
    if(seen.has(key)) {
      const old=seen.get(key);
      old.sources.push(...q.sources); old.wrong ||= q.wrong;
      for(const n of q.notes)if(!old.notes.includes(n))old.notes.push(n);
      if(q.explanation && !old.explanation)old.explanation=q.explanation;
      else if(q.explanation && old.explanation!==q.explanation)old.explanation+='\n'+q.sources[0].title+'：'+q.explanation;
      old.explanationImages=[...new Set([...old.explanationImages,...q.explanationImages])];
      if(old.answer!==q.answer){old.notes.push('不同来源公布答案不一致：'+old.answer+' / '+q.answer);old.conflict=true;}
    } else {seen.set(key,q);bank.push(q);}
  }
  return bank;
}
export function toCsv(bank) {
  const cell=x=>'"'+String(x??'').replace(/^[\s]*[=+@-]/,m=>"'"+m).replace(/"/g,'""')+'"';
  const rows=[['来源','题型','题干','选项','平台正确答案','我的答案','错题','核对备注','题目ID'],...bank.map(q=>[q.sources.map(x=>x.title).join('；'),q.type,q.stem,q.options.join('\n'),q.answer,q.mine,q.wrong?'是':'否',q.notes.join('；'),q.sources.map(x=>x.questionId).join('；')])];
  return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
}
export function prepareChapters(works){
  const bank=makeBank(works);
  let questionNumber=0;
  const chapters=[];
  for(const q of bank){
    const source=q.sources[0];
    let chapter=chapters.find(c=>c.workId===source.workId&&c.title===source.title);
    if(!chapter){chapter={workId:source.workId,title:source.title,questions:[]};chapters.push(chapter);}
    chapter.questions.push({...q,number:++questionNumber});
  }
  return chapters;
}
export function toHtml(works,title='学习通作业题库',settings={}) {
  const bank=makeBank(works),e=escapeHtml,chapters=prepareChapters(works);
  const showExplanations=settings.showExplanations!==false;
  const inlineAnswers=settings.answerMode==='inline';
  // Answer + explanation right under the question, used when 答案位置 is 紧跟题目.
  function inlineAnswer(q){
    const mine=q.wrong?` <span class="badge">历史错题（我的答案：${e(q.mine)}）</span>`:'';
    const expl=showExplanations&&q.explanation?`<div class="ia-expl"><strong>解析：</strong>${e(q.explanation)}</div>`:'';
    const imgs=showExplanations?q.explanationImages.filter(u=>/^https:\/\//.test(u)).map(u=>`<img src="${e(u)}" alt="解析原图">`).join(''):'';
    const notes=q.notes.length?`<p class="note">${e(q.notes.join('；'))}</p>`:'';
    return `<div class="inline-answer"><p><strong>正确答案：</strong>${e(q.answer||'未公布')}${mine}</p>${expl}${imgs}${notes}</div>`;
  }
  function answerSummary(c){
    if(inlineAnswers)return '';
    const groups=[];
    for(let i=0;i<c.questions.length;i+=5){
      const batch=c.questions.slice(i,i+5);
      const range=batch.length===1?String(batch[0].number):batch[0].number+'–'+batch.at(-1).number;
      groups.push(`<div class="answer-group"><span class="answer-range">${range}题</span><div class="answer-items">${batch.map(q=>`<span class="answer-item" data-number="${q.number}">${q.number}. ${e(q.answer||'未公布')}</span>`).join('')}</div></div>`);
    }
    const notes=c.questions.filter(q=>q.notes.length).map(q=>`<p class="note" data-number="${q.number}">${q.number}题：${e(q.notes.join('；'))}</p>`).join('');
    const explanations=showExplanations?c.questions.filter(q=>q.explanation||q.explanationImages.length).map(q=>`<div class="explanation" data-number="${q.number}"><p><strong>${q.number}题解析：</strong>${e(q.explanation)}</p>${q.explanationImages.filter(u=>/^https:\/\//.test(u)).map(u=>`<img src="${e(u)}" alt="解析原图">`).join('')}</div>`).join(''):'';
    return `<div class="answer"><h3>参考答案</h3>${groups.join('')}${explanations}${notes}</div>`;
  }
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{font:12pt/1.4 "SimSun","宋体",serif;color:#111;background:#e9ecef;margin:0}
  main{max-width:210mm;margin:24px auto}
  header{padding:20px 24px}h1{font:700 22pt/1.4 "SimHei","黑体",sans-serif;margin:8px 0}
  .muted{font-size:10.5pt;color:#555}
  nav{position:sticky;top:0;z-index:1;background:#f5f6f7;padding:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;border:1px solid #ccc;font:10.5pt "SimSun","宋体",serif}
  input[type=search]{flex:1;min-width:180px;padding:8px;border:1px solid #bbb}
  button{font:inherit;padding:8px 12px;border:1px solid #bbb;background:white;cursor:pointer}
  .chapter{background:white;min-height:297mm;margin:24px 0;padding:16mm 18mm 14mm;box-shadow:0 2px 10px #0001}
  h2.chapter-title{font:700 16pt/1.4 "SimHei","黑体",sans-serif;text-align:center;margin:0 0 7mm;break-after:avoid}
  article{margin:0 0 4mm;padding:0;break-inside:avoid}
  h3{font:400 12pt/1.4 "SimSun","宋体",serif;margin:0 0 1.5mm;break-after:avoid}
  p{margin:0}.options{padding-left:5mm;font-size:10.5pt;line-height:1.35}.options p{margin:0 0 .5mm}
  .answer{font-size:10.5pt;margin-top:6mm;padding-top:3mm;border-top:1px solid #999}.answer h3{font-weight:700}.answer-group{display:flex;gap:4mm;margin:2mm 0;break-inside:avoid}.answer-range{min-width:18mm;color:#555}.answer-items{display:flex;flex:1;gap:4mm;flex-wrap:wrap}.answer-item{min-width:19mm}
  .note{font-size:9pt;color:#666;margin-top:1mm}.badge{font-size:9pt;color:#666}
  .explanation{font-size:10.5pt;line-height:1.5;white-space:pre-wrap;margin:3mm 0}.hideExplanations .explanation,.hideExplanations .ia-expl{display:none}
  .inline-answer{font-size:10.5pt;line-height:1.5;margin-top:2mm;padding-top:1.5mm;border-top:1px dashed #c4c4c4}.inline-answer p{margin:0}.ia-expl{white-space:pre-wrap;margin:1mm 0 0}
  img{max-width:100%}.chapter-page{text-align:center;font-size:10.5pt;margin-top:6mm}
  [hidden]{display:none!important}.hideAnswers .answer,.hideAnswers .inline-answer{display:none}
  @page{size:A4;margin:16mm 18mm 16mm;@bottom-center{content:counter(page);font-family:"SimSun","宋体",serif;font-size:10.5pt}}
  @media print{body{background:white}main{margin:0;max-width:none}header,nav,footer,.chapter-page{display:none}.chapter{min-height:0;margin:0;padding:0;box-shadow:none;break-before:page}.chapter:first-of-type{break-before:auto}h2.chapter-title{margin-bottom:6mm}article{break-inside:avoid}.inline-answers article{break-inside:auto}}
  @media screen and (max-width:800px){main{margin:0}.chapter{min-height:0;margin:16px 0;padding:24px 18px}h1{font-size:18pt}}
</style>
  <main class="${inlineAnswers?'inline-answers':''}"><header><div class="muted">学习通 · 已完成作业与章节检测归档</div><h1>${e(title)}</h1><p>${works.length} 份来源 · ${bank.length} 道题 · ${bank.filter(q=>q.wrong).length} 道历史错题</p><p class="muted">答案来源：页面公布的“正确答案”。保留源题原意与疑似错字；平台答案未经过教材独立复核。未公布的答案不推测。</p></header><nav><input id="search" type="search" placeholder="搜索题干、选项或章节" aria-label="搜索题库"><label><input id="wrong" type="checkbox"> 只看错题</label><label><input id="answers" type="checkbox" checked> 显示答案</label><label><input id="explanations" type="checkbox" ${showExplanations?'checked':'disabled'}> 显示解析</label><button id="print">打印 / 另存为 PDF</button><span id="count"></span></nav>
  ${chapters.map((c,chapterIndex)=>`<section class="chapter"><h2 class="chapter-title">${e(c.title)}</h2>${c.questions.map(q=>`<article data-number="${q.number}" data-wrong="${q.wrong}" data-chapters="${e(q.sources.map(s=>s.title).join(' / '))}"><h3>${q.number}. ${e(q.stem)} <span class="muted">${e(q.type)}</span> ${q.wrong&&!inlineAnswers?'<span class="badge">历史错题</span>':''}</h3><div class="options">${q.options.map(o=>`<p>${e(o)}</p>`).join('')}</div>${(q.images||[]).filter(u=>/^https:\/\//.test(u)).map(u=>`<img src="${e(u)}" alt="题目原图">`).join('')}${inlineAnswers?inlineAnswer(q):''}</article>`).join('')}${answerSummary(c)}<div class="chapter-page">${chapterIndex+1}</div></section>`).join('')}
  <footer class="muted">本地归档 · 共 ${bank.length} 题</footer></main><script>
  ${initViewer.toString()};initViewer();</script></html>`;
}

export function initViewer(){
  const search=document.getElementById('search'),wrong=document.getElementById('wrong'),articles=[...document.querySelectorAll('article')];
  function filter(){
    const visible=new Set();
    for(const a of articles){a.hidden=!((a.textContent+' '+a.dataset.chapters).toLowerCase().includes(search.value.toLowerCase())&&(!wrong.checked||a.dataset.wrong==='true'));if(!a.hidden)visible.add(a.dataset.number);}
    for(const c of document.querySelectorAll('.chapter'))c.hidden=![...c.querySelectorAll('article')].some(a=>!a.hidden);
    for(const a of document.querySelectorAll('.answer [data-number]'))a.hidden=!visible.has(a.dataset.number);
    for(const g of document.querySelectorAll('.answer-group'))g.hidden=![...g.querySelectorAll('.answer-item')].some(a=>!a.hidden);
    document.getElementById('count').textContent=visible.size+' 题';
  }
  search.oninput=filter;wrong.onchange=filter;
  document.getElementById('answers').onchange=e=>document.body.classList.toggle('hideAnswers',!e.target.checked);
  document.getElementById('explanations').onchange=e=>document.body.classList.toggle('hideExplanations',!e.target.checked);
  document.getElementById('print').onclick=()=>window.print();filter();
}
