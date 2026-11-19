import {extractWork,discoverWorks,probeSource,discoverChapterQuizzes,extractChapterQuiz,diagnosePage,scanDocuments,fetchDocInPage,readStatusInPage} from './extract.js';
import {validateWork,validateQuiz,makeBank,pickQuizzes} from './core.mjs';
import {dedupeAttachments,fileNameFor,fileBaseFor,candidateUrls,mimeKind,extFromMime,extensionOf,nameFromDisposition,isMedia,formatSize,downloadPath,attachmentExt,safeName,urlsOf,isStatusUrl,stripExtension} from './documents.mjs';
import {toDocx} from './word.mjs';
const $=id=>document.getElementById(id);
const params=new URL(location.href).searchParams;
// Same document serves both entry points: the tab opened from a non-Chaoxing page
// and the floating panel mounted on a Chaoxing page.
const embed=params.get('embed')==='1';
if(embed)document.documentElement.classList.add('embed');
let sourceTab=Number(params.get('tab'))||0;
let links=[],works=[],quizzes=[],catalog=[],courseId='',cancel=false,running=false,lastQuizIds=[],docQueue=[],lastScanChapter='',autoDocTitle='',lastProbeKind='';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const say=t=>$('status').textContent=t;
const log=t=>{$('log').textContent+=t+'\n';};
function needTab(){
  if(!sourceTab)throw new Error('没有定位到学习通标签页，请从学习通页面点扩展图标重新打开面板。');
}
async function injectList(func){
  needTab();
  const frames=await chrome.scripting.executeScript({target:{tabId:sourceTab,allFrames:true},func});
  return frames.flatMap(f=>Array.isArray(f.result)?f.result:[]);
}
async function injectObjects(func){
  needTab();
  const frames=await chrome.scripting.executeScript({target:{tabId:sourceTab,allFrames:true},func});
  return frames.map(f=>f.result).filter(Boolean);
}
async function guessCourseId(){
  const all=await chrome.storage.local.get(null);
  const ids=new Set(Object.keys(all).filter(k=>/^(course|quiz)-/.test(k)).map(k=>k.replace(/^(course|quiz)-/,'')));
  return ids.size===1?[...ids][0]:'';
}
function readCourseId(){
  courseId=$('courseId').value.trim();
  if(!courseId){say('请先填写课程编号（扫描当前页通常会自动填入）。');return false;}
  return true;
}
async function loadArchives(){
  if(!courseId){works=[];quizzes=[];lastQuizIds=[];return;}
  const saved=await chrome.storage.local.get(['course-'+courseId,'quiz-'+courseId,'quizlast-'+courseId]);
  works=saved['course-'+courseId]||[];quizzes=saved['quiz-'+courseId]||[];
  lastQuizIds=Array.isArray(saved['quizlast-'+courseId])?saved['quizlast-'+courseId]:[];
}
const chapterOf=u=>{try{const s=new URL(u).searchParams;return s.get('chapterId')||s.get('chapterid')||s.get('knowledgeid')||s.get('knowledgeId')||'';}catch{return '';}};
const quizTotal=list=>list.reduce((n,q)=>n+((q.questions&&q.questions.length)||0),0);
function pickedQuizzes(){
  return pickQuizzes(quizzes,lastQuizIds,$('quizPick').value);
}
// The export picker defaults to the quiz collected last, so switching to another unit never
// drags the previous unit's questions into the new file.
function renderQuizPick(){
  const sel=$('quizPick');
  if(!sel)return;
  const prev=sel.value;
  const recent=quizzes.filter(q=>lastQuizIds.includes(q.workId));
  const opts=[];
  if(recent.length)opts.push(['__recent','最近采集：'+recent.map(q=>`${q.title}（${(q.questions||[]).length} 题）`).join('、')]);
  opts.push(['__all',`全部已采集检测（${quizzes.length} 份 · ${quizTotal(quizzes)} 题）`]);
  for(const q of quizzes)opts.push([q.workId,`${q.title}（${(q.questions||[]).length} 题）`]);
  sel.replaceChildren(...opts.map(([value,text])=>{
    const o=document.createElement('option');o.value=value;o.textContent=text;return o;
  }));
  sel.value=opts.some(([value])=>value===prev)?prev:(recent.length?'__recent':'__all');
  syncQuizPickRow();
}
function syncQuizPickRow(){
  $('quizPickRow').hidden=$('scope').value==='works'||!quizzes.length;
}
function exportSummary(){
  const scope=$('scope').value;
  const picks=scope==='works'?[]:pickedQuizzes();
  const list=picks.length?picks.map(q=>`${q.title}（${(q.questions||[]).length} 题）`).join('、'):'（无章节检测）';
  if(scope==='works')return `将导出作业 ${works.length} 份。`;
  if(scope==='quiz')return `将导出 ${picks.length} 份检测：${list}。`;
  return `将导出作业 ${works.length} 份 + 检测 ${picks.length} 份：${list}。`;
}
function updateCounts(){
  const bank=makeBank([...works,...quizzes]);
  $('counts').textContent=`作业 ${works.length} 份 · 章节检测 ${quizzes.length} 份 · 合计 ${bank.length} 题`;
  const explained=bank.filter(q=>q.explanation||q.explanationImages.length).length;
  $('explanationCount').textContent=`已采集 ${explained} 题解析（旧归档需重新采集；未公布的不会生成）。`;
  renderQuizPick();
  refreshExportPreview();
}
function refreshExportPreview(){
  const el=$('exportPreview');
  if(el)el.textContent=quizzes.length||works.length?exportSummary():'';
}
async function scan(){
  try{
    say('正在识别当前页…');
    const probes=await injectObjects(probeSource);
    const probe=probes.find(p=>p.kind==='quiz')||probes.find(p=>p.kind==='works')||probes.find(p=>p.kind==='doc')||probes.find(p=>p.kind==='catalog')||probes[0];
    links=[...new Map((await injectList(discoverWorks)).filter(x=>x.url).map(x=>[new URL(x.url).searchParams.get('workId'),x])).values()];
    catalog=await injectList(discoverChapterQuizzes);
    if(!$('courseId').value.trim()){
      const fromProbe=probes.map(p=>p.courseId).find(Boolean)||(links[0]?new URL(links[0].url).searchParams.get('courseId'):'')||await guessCourseId();
      $('courseId').value=fromProbe||'';
    }
    courseId=$('courseId').value.trim();
    await loadArchives();
    lastProbeKind=probe?.kind||'unknown';
    const kindName={quiz:'章节检测答卷回看页',works:'已完成作业列表',doc:'章节学习页（课件）',catalog:'课程章节目录',unknown:'未能识别的页面'}[probe?.kind||'unknown'];
    const advice={quiz:'当前页可直接点「采集当前章节检测」。',works:'可点「批量采集已完成作业」。',doc:'当前页可点「扫描本页课件」下载 PPT / PDF。',catalog:'目录条目由页面脚本跳转；请逐个点开单元检测的答卷回看页再采集。',unknown:'请确认打开的是学习通作业列表、已完成检测的答卷回看页，或章节学习页。'}[probe?.kind||'unknown'];
    $('sourceInfo').textContent=`页面类型：${kindName}${probe?.inIframe?'（内容在 iframe 中，已按全部 frame 扫描）':''}。${advice}`;
    const items=[];
    for(const x of links)items.push(x.title||'已完成作业');
    for(const x of catalog.slice(0,20))items.push((x.title||'单元检测')+(x.needsClick?'（需手动点开）':'（页面已给出链接）'));
    $('list').replaceChildren(...items.map(t=>{const li=document.createElement('li');li.textContent=t;return li;}));
    $('start').disabled=!links.length;
    updateCounts();
    say(`发现 ${links.length} 份已完成作业、${catalog.length} 个检测入口；本地已有 ${works.length} 份作业、${quizzes.length} 份章节检测。${courseId?'':' 请填写课程编号。'}`);
  }catch(e){say('扫描失败：'+e.message);}
}
async function dumpDiagnostics(){
  try{
    const data=await injectObjects(diagnosePage);
    const best=data.filter(d=>/正确答案|单选题|【/.test(String(d.head||'')))
      .sort((a,b)=>String(b.head||'').length-String(a.head||'').length)[0]||data[0];
    if(!best){log('诊断：没有收到任何 frame 的结构信息。');return;}
    log('--- 诊断 ---');
    log('url='+best.url+' inIframe='+best.inIframe+' title='+best.title);
    log('题量行：'+(best.meta||'（未找到）'));
    log('题卡数：'+(best.cards??'?')+'（旧版结构 '+(best.legacyCards??'?')+'）');
    log('标签样本：'+JSON.stringify(best.anchors||[]).slice(0,600));
    log('页面文本前 1200 字：');
    log(String(best.head||'').slice(0,1200));
  }catch(e){log('诊断失败：'+e.message);}
}
async function grabQuiz(){
  if(!readCourseId())return;
  say('正在读取当前章节检测…');
  try{
    const raw=(await injectObjects(extractChapterQuiz))
      .filter(r=>r&&Array.isArray(r.questions)&&r.questions.length);
    if(!raw.length){
      await dumpDiagnostics();
      throw Error('识别失败：页面已加载但没读到题卡。下方已写入页面结构，请点「复制页面诊断信息」发给开发者。');
    }
    // A quiz frame can outlive the chapter switch, and one chapter can hold several 单元检测
    // attachments. Keep only the frames that belong to the chapter currently open.
    let probes=[];
    try{probes=await injectObjects(probeSource);}catch{}
    const tab=await chrome.tabs.get(sourceTab).catch(()=>null);
    const activeChapter=[
      chapterOf(tab&&tab.url||''),
      ...probes.filter(p=>p.kind!=='quiz').map(p=>chapterOf(p.url||''))
    ].find(Boolean)||'';
    const foreign=[];
    const matched=raw.filter(r=>{
      if(activeChapter&&r.knowledgeId&&r.knowledgeId!==activeChapter){foreign.push(r.title);return false;}
      return true;
    });
    // If every frame looks foreign, the chapter id probably just is not comparable on this
    // build; trust what the user actually opened instead of refusing to save.
    const results=matched.length?matched:raw;
    if(!matched.length)foreign.length=0;
    // One chapter page can hold several 单元检测 attachments, each in its own frame.
    // Keep every distinct quiz instead of only the longest one; drop duplicate frames.
    const byId=new Map();
    for(const r of results){
      const prev=byId.get(r.workId);
      if(!prev||r.questions.length>prev.questions.length)byId.set(r.workId,r);
    }
    // The 题量 meta line can live in the outer frame while the questions live in an iframe.
    const pageExpected=Math.max(0,...probes.map(p=>Number(p.expected)||0));
    const saved=[],skipped=[];
    for(const r of byId.values()){
      // Only fill in a missing 题量; never overwrite one quiz's own count with another's.
      if(!r.expected && pageExpected)r.expected=pageExpected;
      let valid;
      try{valid=validateQuiz(r);}catch(e){skipped.push(`《${r.title}》${e.message}`);continue;}
      valid.courseId=courseId;
      const old=quizzes.find(q=>q.workId===valid.workId);
      if(old&&Array.isArray(old.questions)&&old.questions.length){
        // Paged / lazy-loaded answer pages are collected page by page: merge by question number.
        const byNumber=new Map(old.questions.map(q=>[String(q.number),q]));
        for(const q of valid.questions)byNumber.set(String(q.number),q);
        valid.questions=[...byNumber.values()].sort((a,b)=>(Number(a.number)||0)-(Number(b.number)||0));
        valid.expected=Math.max(Number(valid.expected)||0,Number(old.expected)||0);
        valid.complete=!valid.expected||valid.questions.length>=valid.expected;
        valid.missing=valid.complete?0:Math.max(0,valid.expected-valid.questions.length);
        if(old.notes?.length)valid.notes=[...new Set([...(valid.notes||[]),...old.notes])];
      }
      quizzes=quizzes.filter(q=>q.workId!==valid.workId);quizzes.push(valid);
      saved.push(valid);
    }
    if(!saved.length)throw Error('识别到的题卡未通过校验，未保存。'+(skipped.length?'（'+skipped.join('；')+'）':''));
    // Older runs could archive the same quiz under another frame id with fewer questions.
    // Drop such leftovers only when every question of it is already contained in this run.
    const sig=q=>String(q.number)+'|'+String(q.stem||'').slice(0,40);
    const kept=new Set(saved.map(v=>v.workId));
    quizzes=quizzes.filter(q=>{
      if(kept.has(q.workId))return true;
      const twin=saved.find(v=>v.title===q.title);
      if(!twin)return true;
      const have=new Set(twin.questions.map(sig));
      return !(q.questions.length<=twin.questions.length&&q.questions.every(x=>have.has(sig(x))));
    });
    quizzes.sort((a,b)=>String(a.title).localeCompare(String(b.title),'zh-CN'));
    lastQuizIds=saved.map(v=>v.workId);
    await chrome.storage.local.set({['quiz-'+courseId]:quizzes,['quizlast-'+courseId]:lastQuizIds});
    updateCounts();
    const parts=saved.map(v=>`「${v.title}」${v.questions.length}/${v.expected||v.questions.length} 题`);
    const short=saved.filter(v=>!v.complete);
    const tail=short.length?`尚未采全的：${short.map(v=>`${v.title}（缺 ${v.missing} 题，翻页或滚到底后再点一次会自动按题号合并）`).join('；')}`:'';
    const skipTail=skipped.length?` 跳过 ${skipped.length} 份：${skipped.join('；')}`:'';
    const foreignTail=foreign.length?` 已忽略其他章节的 ${foreign.length} 份（${foreign.join('；')}）。`:'';
    say(`已采集 ${saved.length} 份：${parts.join('，')}。导出已自动切换到这一份，只导它、不夹带其他单元。${tail}${skipTail}${foreignTail}`);
  }catch(e){say('采集失败：'+e.message);log('章节检测：'+e.message);}
}
async function run(){
  if(running)return;
  if(!readCourseId())return;
  if(!links.length){say('当前页没有发现已完成作业，请先打开课程「作业」列表后重新扫描。');return;}
  running=true;cancel=false;$('start').disabled=true;$('scan').disabled=true;$('stop').disabled=false;$('log').textContent='';
  let worker,success=0,failed=0;
  try{
    worker=await chrome.tabs.create({url:'about:blank',active:false});
    for(const [i,link] of links.entries()){
      if(cancel)break;
      say(`采集 ${i+1}/${links.length}：${link.title}`);
      try{
        await chrome.tabs.update(worker.id,{url:link.url});
        const expectedId=new URL(link.url).searchParams.get('workId');
        let result,lastError='页面未加载';
        for(let attempt=0;attempt<40&&!cancel;attempt++){
          await delay(750);
          try{
            const tab=await chrome.tabs.get(worker.id);
            if(tab.status!=='complete')continue;
            const [r]=await chrome.scripting.executeScript({target:{tabId:worker.id},func:extractWork});
            if(r.result.workId!==expectedId)continue;
            result=validateWork(r.result);break;
          }catch(e){lastError=e.message;}
        }
        if(cancel)break;
        if(!result)throw Error('读取超时（可能需要重新登录或验证码）：'+lastError);
        works=works.filter(w=>w.workId!==result.workId);works.push(result);
        works.sort((a,b)=>links.findIndex(x=>new URL(x.url).searchParams.get('workId')===a.workId)-links.findIndex(x=>new URL(x.url).searchParams.get('workId')===b.workId));
        await chrome.storage.local.set({['course-'+courseId]:works});success++;updateCounts();
      }catch(e){failed++;log(link.title+'：'+e.message);}
    }
    say(`${cancel?'已停止':'本轮结束'}：成功 ${success} 份，失败 ${failed} 份；本地作业 ${makeBank(works).length} 题。${failed?'旧版数据保留，请查看失败记录。':''}`);
  }catch(e){say(e.message);}finally{
    if(worker)await chrome.tabs.remove(worker.id).catch(()=>{});
    running=false;$('start').disabled=!links.length;$('scan').disabled=false;$('stop').disabled=true;
  }
}
async function download(type){
  const scope=$('scope').value;
  const picks=scope==='works'?[]:pickedQuizzes();
  const set=scope==='works'?works.slice():scope==='quiz'?picks:[...works,...picks];
  if(!set.length){say('该导出范围还没有采集数据，请先采集。');return;}
  const single=scope==='quiz'&&picks.length===1?picks[0].title:'';
  const suffix=scope==='works'?'作业题库':scope==='quiz'?'章节检测题库':'题库';
  // Quiz titles can be used as the file name, so strip characters Windows rejects.
  const safe=s=>String(s).replace(/[\\/:*?"<>|\r\n]/g,' ').replace(/\s+/g,' ').trim().slice(0,80);
  const title=safe(single||('课程'+(courseId||'未命名')+suffix));
  const settings={showExplanations:$('showExplanations').checked,answerMode:$('answerMode').value};
  $('pdf').disabled=true;$('docx').disabled=true;
  try{
    if(type==='pdf'){
      const id='print-'+crypto.randomUUID();
      await chrome.storage.session.set({[id]:{works:set,title,settings}});
      try{await chrome.tabs.create({url:chrome.runtime.getURL('print.html')+'?job='+id});}
      catch(e){await chrome.storage.session.remove(id);throw e;}
      say('已打开 PDF 预览；点击打印并选择「另存为 PDF」。');
    }else{
      say('正在生成 Word 文件…');
      const blob=await toDocx(set,title,settings),url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download=title+'.docx';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
      say('Word 文件已生成，请查看浏览器下载。');
    }
  }catch(e){say('导出失败：'+e.message);}
  finally{$('pdf').disabled=false;$('docx').disabled=false;}
}
async function diagnose(){
  try{
    const data=await injectObjects(diagnosePage);
    const text=JSON.stringify(data,null,2);
    try{await navigator.clipboard.writeText(text);}
    catch{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}
    say('页面诊断信息已复制，可粘贴给开发者用于适配新版页面。');
  }catch(e){say('诊断失败：'+e.message);}
}
// ---------- chapter documents (PPT / PDF) ----------
// Nothing is downloaded blind: every candidate URL is asked for its content type first,
// because Chaoxing answers an extension-less /star3/origin/<id> with an HTML viewer page.
async function probeUrl(url){
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),8000);
  try{
    const res=await fetch(url,{method:'GET',headers:{Range:'bytes=0-1'},credentials:'include',cache:'no-store',signal:ctl.signal});
    const ct=(res.headers.get('content-type')||'').toLowerCase();
    const cd=res.headers.get('content-disposition')||'';
    const range=res.headers.get('content-range')||'';
    const total=Number((range.split('/')[1]||res.headers.get('content-length')||0))||0;
    try{await (res.body&&res.body.cancel&&res.body.cancel());}catch{}
    return {ok:res.ok,status:res.status,ct,cd,total,kind:mimeKind(ct)};
  }catch(e){
    return {ok:false,status:0,ct:'',cd:'',total:0,kind:'unknown',error:e.message};
  }finally{clearTimeout(timer);}
}
async function findWorkingUrl(a){
  const extra=await resolveViaStatus(a);
  for(const url of [...new Set([...extra.map(x=>x.url),...candidateUrls(a)])]){
    const p=await probeUrl(url);
    if(p.kind==='file')return {url,ct:p.ct,total:p.total,cd:p.cd};
  }
  return null;
}
// The viewer's first request is /ananas/status/<id>?flag=normal. It answers JSON that names
// the real file (download) and a converted PDF copy (pdf). Downloading it directly only saves
// the JSON page, so read it first and treat its URLs as the best candidates.
function pickStatusMeta(data,base){
  if(!data||typeof data!=='object'||Array.isArray(data))return null;
  const root=data.data&&typeof data.data==='object'&&!Array.isArray(data.data)?data.data:data;
  const abs=value=>{
    const s=String(value||'').trim();
    if(!s)return '';
    try{const u=new URL(s,base);return u.protocol==='https:'?u.href:'';}catch{return '';}
  };
  const pick=(...keys)=>{
    for(const k of keys){const v=root[k];if(typeof v==='string'&&v.trim())return v.trim();}
    return '';
  };
  const download=abs(pick('download','downloadUrl','fileUrl','url','objectUrl','objUrl','src'));
  const pdf=abs(pick('pdf','pdfUrl','pdfpath','pdfPath'));
  const filename=pick('filename','fileName','name','originalName','title');
  const size=Number(pick('size','fileSize','length','filesize'))||0;
  if(!download&&!pdf)return null;
  return {download,pdf,filename,size};
}
async function readStatusJson(url){
  try{
    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(),10000);
    const res=await fetch(url,{credentials:'include',cache:'no-store',signal:ctl.signal});
    clearTimeout(timer);
    if(res.ok){
      const text=await res.text();
      if(/^\s*[{[]/.test(text)){
        try{return JSON.parse(text);}catch{}
      }
    }
  }catch{}
  // Extension requests may miss the viewer's Referer; the page itself always has it.
  try{
    const frames=await chrome.scripting.executeScript({target:{tabId:sourceTab,allFrames:true},func:readStatusInPage,args:[{urls:[url]}]});
    for(const f of frames){
      const list=f.result;
      if(Array.isArray(list)&&list[0]&&list[0].data)return list[0].data;
    }
  }catch{}
  return null;
}
async function resolveViaStatus(a){
  const statusUrls=urlsOf(a).filter(isStatusUrl).slice(0,2);
  if(!statusUrls.length)return [];
  const out=[];
  const seen=new Set();
  for(const url of statusUrls){
    const data=await readStatusJson(url);
    const meta=data&&pickStatusMeta(data,url);
    if(!meta)continue;
    for(const [target,kind] of [[meta.download,'status'],[meta.pdf,'status-pdf']]){
      if(!target||seen.has(target))continue;
      seen.add(target);
      out.push({url:target,kind,name:meta.filename,size:meta.size});
    }
  }
  return out;
}
function docItemsForDownload(){
  const includeMedia=$('includeMedia').checked;
  const WEB=/^(html?|xhtml|jsp|do|action|php|aspx?)$/;
  return docQueue.filter(a=>{
    if(!candidateUrls(a).length&&!urlsOf(a).some(isStatusUrl))return false;
    // Card pages sometimes list a plain HTML page rather than a file; never fetch those.
    if(WEB.test(attachmentExt(a))||WEB.test(String(a.type||'').toLowerCase()))return false;
    if(isMedia(a)&&!includeMedia)return false;
    return true;
  });
}
function chapterGroups(items){
  const counts=new Map();
  for(const a of items)counts.set(a.chapter||'',(counts.get(a.chapter||'')||0)+1);
  return counts;
}
function docNameFor(a,items){
  const counts=chapterGroups(items);
  const chapter=a.chapter||'';
  const same=items.filter(x=>(x.chapter||'')===chapter);
  const index=same.indexOf(a);
  return fileNameFor(chapter,a,index<0?0:index,counts.get(chapter)||1);
}
function renderDocs(){
  const list=$('docList');
  list.replaceChildren(...docQueue.map(a=>{
    const li=document.createElement('li');
    const kind=attachmentExt(a);
    const chapter=a.chapter||'';
    const name=docNameFor(a,docQueue);
    const candidates=candidateUrls(a);
    const viaStatus=urlsOf(a).some(isStatusUrl);
    const state=a.verified?'✓ 已下载':(a.failed?'✗ 没下成':((candidates.length||viaStatus)?(viaStatus?'待解析':'待验证'):'无直链'));
    const meta=[chapter,kind?kind.toUpperCase():'类型待定',formatSize(a.size),a.from,state].filter(Boolean).join(' · ');
    const label=document.createElement('span');
    label.textContent=`${name}${meta?'（'+meta+'）':''}`;
    label.title=candidates[0]||urlsOf(a)[0]||'';
    const open=document.createElement('button');
    open.className='mini';open.textContent='下载';open.onclick=()=>downloadAttachments([a]);
    const copy=document.createElement('button');
    copy.className='mini ghost';copy.textContent='复制直链';
    copy.onclick=()=>copyLink(a);
    li.append(label,open,copy);
    return li;
  }));
  const docs=docItemsForDownload();
  $('downloadDocs').disabled=!docs.length;
  $('downloadDocs').textContent=docs.length?`下载全部（${docs.length}）`:'下载全部';
  $('docStatus').textContent=docQueue.length
    ? `已扫描 ${docQueue.length} 个，${docs.length} 个可下载 · 存到「学习通课件/${courseId||'未填课程编号'}」`
    : '尚未扫描课件。';
}
async function copyLink(a){
  if(!candidateUrls(a).length&&!urlsOf(a).some(isStatusUrl)){say('这个附件没有可用的直链。');return;}
  say('正在解析文件清单并逐个验证下载地址…');
  const hit=await findWorkingUrl(a);
  const url=hit?hit.url:candidateUrls(a)[0];
  try{
    await navigator.clipboard.writeText(url);
    say(hit
      ? `已复制验证通过的直链（${hit.ct||'文件'}${hit.total?'，'+formatSize(hit.total):''}）。粘贴到浏览器地址栏即可另存。`
      : '没有地址通过验证，已复制最可能的一条。可先在学习通里翻一页 PPT 让它真正加载文件，再回来扫描。');
  }catch{say('复制失败，请手动重试。');}
}
async function scanDocs(){
  try{
    say('正在扫描本页课件…');
    const results=(await injectObjects(scanDocuments)).filter(r=>r&&Array.isArray(r.attachments));
    const withFiles=results.filter(r=>r.attachments.length);
    const best=withFiles.sort((a,b)=>b.attachments.length-a.attachments.length)[0];
    if(!best){
      log('课件扫描：0 个附件。frames='+results.length+'，可点「复制页面诊断信息」反馈结构。');
      say('本页没有找到课件附件。请确认当前是能翻页看 PPT 的章节学习页，并等页面加载完再扫描。');
      return;
    }
    // Catalog heading first; when the page hides it, the attachment's own name is still a far
    // better title than 「课件」.
    const scanned=dedupeAttachments(results.flatMap(r=>r.attachments||[]));
    const detected=(best.activeTitle||(best.titles&&best.titles[0])||'').replace(/\s+/g,' ').trim();
    const fromAttachment=scanned.map(a=>stripExtension(a.name||'').replace(/[(（]\d+[)）]$/,'').trim()).find(v=>v&&v.length>=2)||'';
    const fallback=detected||fromAttachment;
    const current=$('docTitle').value.trim();
    // Only auto-fill when the user has not typed their own title.
    if(fallback&&(!current||current===autoDocTitle)){$('docTitle').value=fallback;autoDocTitle=fallback;}
    const pageCourse=best.courseId||'';
    if(!courseId&&pageCourse){courseId=pageCourse;$('courseId').value=pageCourse;}
    const chapter=$('docTitle').value.trim()||'课件';
    lastScanChapter=chapter;
    // Merge every frame: the real file request usually fires inside the viewer iframe, while
    // the catalog heading lives in the outer page.
    const rows=scanned.map(a=>({...a,chapter}));
    const map=new Map(docQueue.map(a=>[a.objectid||a.url,a]));
    let added=0;
    for(const row of rows){
      const key=row.objectid||row.url;
      if(!key)continue;
      if(!map.has(key))added++;
      map.set(key,row);
    }
    docQueue=[...map.values()];
    renderDocs();
    const docs=docItemsForDownload();
    const perfCount=results.reduce((n,r)=>n+((r.perfUrls&&r.perfUrls.length)||0),0);
    say(`本页识别到 ${rows.length} 个附件，新增 ${added} 个；可尝试下载 ${docs.length} 个。命名小标题：${chapter}`);
    log(`扫描结果：可尝试 ${docs.length} 个，页面真实文件请求记录 ${perfCount} 条。`);
    if(!perfCount)log('提示：这页还没有文件请求记录。先在页面里翻到第 2 页 PPT（让浏览器真的加载一次课件），再点「扫描本页课件」，直链才最准。');
    if(rows.length&&!docs.length)log('提示：只看到附件元数据，没有能直接下载的地址。点该行「复制直链」可验证；或按 F12 → Network 找带 flag / .pdf 的请求，把地址粘到下面「粘贴直链」框里。');
    if(best.tabs.length>1){
      log(`本页有 ${best.tabs.length} 个卡片：${best.tabs.join(' / ')}。切换卡片后再点一次「扫描本页课件」可累加。`);
    }
  }catch(e){say('扫描失败：'+e.message);}
}
async function waitDownload(id,timeout=180000){
  const start=Date.now();
  for(;;){
    const [item]=await chrome.downloads.search({id});
    if(!item)throw new Error('下载项已丢失');
    if(item.state==='complete'||item.state==='interrupted')return item;
    if(Date.now()-start>timeout)throw new Error('下载超时');
    await delay(400);
  }
}
async function dropDownload(id){
  try{await chrome.downloads.removeFile(id);}catch{}
  try{await chrome.downloads.erase({id});}catch{}
}
// Try every candidate URL; only keep the file when the server really answered with a document.
async function saveAttachment(a,base){
  const extra=await resolveViaStatus(a);
  const hintName=(extra.find(x=>x.name)||{}).name||'';
  const cands=[];
  const seen=new Set();
  const queue=[...extra.map(x=>({url:x.url,via:x.kind})),...candidateUrls(a).map(u=>({url:u,via:''}))];
  for(const item of queue){
    if(!item.url||seen.has(item.url))continue;
    seen.add(item.url);cands.push(item);
    if(cands.length>=6)break;
  }
  if(!cands.length)throw new Error('没有可用的下载地址');
  const notes=[];
  const usable=[];
  for(const item of cands){
    const p=await probeUrl(item.url);
    if(p.kind==='file'){usable.push({...item,ct:p.ct,cd:p.cd,trusted:true});continue;}
    // A failed or cookie-less probe proves nothing: the real download may still work, so keep
    // the URL as a last try and let the response type decide.
    if(p.kind==='unknown'){usable.push({...item,ct:p.ct,cd:p.cd,trusted:false});continue;}
    notes.push(`${item.url.slice(0,90)} → ${p.ct||'网页'}`);
  }
  usable.sort((x,y)=>(y.trusted?1:0)-(x.trusted?1:0));
  for(const cand of usable.slice(0,4)){
    const url=cand.url;
    // The server's own Content-Disposition names the file more reliably than the page metadata.
    const ext=extensionOf(nameFromDisposition(cand.cd||''))||extFromMime(cand.ct)||extensionOf(hintName)||attachmentExt(a)||'';
    const filename=downloadPath(courseId,ext?`${base}.${ext}`:base);
    let id;
    try{id=await chrome.downloads.download({url,filename,conflictAction:'uniquify',saveAs:false});}
    catch(e){notes.push(`${url.slice(0,90)} → 提交失败：${e.message}`);continue;}
    const item=await waitDownload(id);
    if(item.state!=='complete'){await dropDownload(id);notes.push(`${url.slice(0,90)} → ${item.error||'下载中断'}`);continue;}
    const kind=mimeKind(item.mime);
    if(kind==='web'||kind==='image'||!item.fileSize||item.fileSize<1024){
      await dropDownload(id);
      notes.push(`${url.slice(0,90)} → 服务器返回网页（${item.mime||'未知类型'}），已删除`);
      continue;
    }
    return {url,ext:ext||extFromMime(item.mime)||'',item,notes,via:cand.via};
  }
  throw new Error(notes.length?notes.join('；'):'所有候选地址都不可用');
}
// Last resort: the page fetches it with its own cookies/Referer and hands the bytes to a link.
async function pageFetchFallback(a,base){
  const ext=attachmentExt(a);
  const filename=ext?`${safeName(base,'课件')}.${ext}`:safeName(base,'课件');
  try{
    const frames=await chrome.scripting.executeScript({
      target:{tabId:sourceTab,allFrames:true},func:fetchDocInPage,
      args:[{urls:candidateUrls(a).slice(0,6),filename}]
    });
    const results=frames.map(f=>f.result).filter(Boolean);
    return results.find(r=>r.ok)||results[0]||null;
  }catch(e){return {ok:false,tried:[{error:e.message}]};}
}
async function downloadAttachments(only){
  const items=only||docItemsForDownload();
  if(!items.length){say('列表里没有可下载的文档。若这页只有视频，请勾选「也下载视频 / 音频」。');return;}
  const counts=chapterGroups(items);
  const used=new Map();
  let ok=0,fail=0;
  $('downloadDocs').disabled=true;
  try{
    if(!courseId)courseId=$('courseId').value.trim();
    for(const a of items){
      const chapter=a.chapter||'';
      const total=counts.get(chapter)||1;
      const index=used.get(chapter)||0;used.set(chapter,index+1);
      const base=fileBaseFor(chapter,a,index,total);
      say(`正在下载：${base}…`);
      try{
        const saved=await saveAttachment(a,base);
        a.ext=saved.ext;a.verified=true;a.failed=false;
        ok++;
        const note=saved.via==='status-pdf'?'（服务器只给了转码 PDF，原文件未开放下载）':(saved.via==='status'?'（地址取自文件清单）':'');
        log(`已下载：${base}${saved.ext?'.'+saved.ext:''}（${formatSize(saved.item.fileSize)}）${note}→ ${saved.item.filename||''}`);
      }catch(e){
        const page=await pageFetchFallback(a,base);
        if(page&&page.ok){
          a.verified='page';a.failed=false;ok++;
          log(`已用页面内取回存下：${base}（${formatSize(page.size)}）。这一份落在「下载」根目录，需要时可手动移动。`);
        }else{
          a.failed=true;fail++;
          log(`下载失败：${base}｜${e.message}`);
          if(page&&page.tried)log(`页面内取回也没成功：${JSON.stringify(page.tried).slice(0,400)}`);
        }
      }
      renderDocs();
    }
    say(`完成：成功 ${ok} 个${fail?`，失败 ${fail} 个（见日志）`:''}。保存位置：下载 / 学习通课件 / ${courseId||'（未填课程编号）'} /`);
  }finally{renderDocs();}
}
// A URL copied from F12 (the "flag / .pdf" request) can always be added by hand.
function addManualUrl(){
  const input=$('docUrl');
  const raw=input.value.trim();
  if(!/^https:\/\/[^/\s]+chaoxing\.com\//i.test(raw)){say('请粘贴以 https:// 开头的学习通地址。');return;}
  const tail=(raw.split(/[?#]/)[0].split('/').pop()||'');
  const chapter=$('docTitle').value.trim()||'课件';
  const row={url:raw,urls:[raw],name:/\.\w{2,5}$/.test(tail)?tail:'',objectid:'',from:'手动',chapter};
  const key=row.url;
  if(docQueue.some(a=>(a.objectid||a.url)===key)){say('列表里已经有这个地址了。');return;}
  docQueue=[...docQueue,row];
  input.value='';
  renderDocs();
  say(`已加入：${docNameFor(row,docQueue)}。点「下载」会先验证类型再保存。`);
}
function clearDocs(){
  docQueue=[];lastScanChapter='';renderDocs();say('已清空课件列表。');
}
$('scanDocs').onclick=scanDocs;
$('downloadDocs').onclick=()=>downloadAttachments();
$('clearDocs').onclick=clearDocs;
$('addDocUrl').onclick=addManualUrl;
$('docUrl').onkeydown=e=>{if(e.key==='Enter')addManualUrl();};
$('includeMedia').onchange=renderDocs;
$('docTitle').onchange=()=>{
  const t=$('docTitle').value.trim();
  if(!t)return;
  docQueue=docQueue.map(a=>a.chapter===lastScanChapter?{...a,chapter:t}:a);
  lastScanChapter=t;
  renderDocs();
};
$('scan').onclick=scan;$('start').onclick=run;$('grab').onclick=grabQuiz;$('diagnose').onclick=diagnose;
$('stop').onclick=()=>{cancel=true;say('正在停止，已采集内容保留。');};
$('courseId').onchange=async()=>{courseId=$('courseId').value.trim();await loadArchives();updateCounts();say(courseId?'已切换课程编号：'+courseId:'已清空课程编号。');};
for(const type of ['pdf','docx'])$(type).onclick=()=>download(type);
$('scope').onchange=()=>{syncQuizPickRow();refreshExportPreview();say(exportSummary());};
$('quizPick').onchange=()=>{refreshExportPreview();say(exportSummary());};
$('showExplanations').onchange=()=>chrome.storage.local.set({showExplanations:$('showExplanations').checked});
$('answerMode').onchange=()=>chrome.storage.local.set({answerMode:$('answerMode').value});
chrome.storage.local.get(['showExplanations','answerMode']).then(s=>{
  $('showExplanations').checked=s.showExplanations!==false;
  $('answerMode').value=s.answerMode==='inline'?'inline':'end';
});
const verEl=$('ver');
if(verEl)verEl.textContent='v'+chrome.runtime.getManifest().version;
// The panel scans on open, so the same button is a refresh from then on.
if(embed)$('scan').textContent='重新扫描';
(async()=>{
  // The overlay passes the tab id; a standalone tab still knows it from the query string.
  if(!sourceTab){
    try{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(tab&&tab.id)sourceTab=tab.id;}catch{}
  }
  if(!sourceTab){say('没有定位到学习通标签页，请从学习通页面点扩展图标重新打开面板。');return;}
  await scan();
  // On a chapter page the panel can start scanning at once, sparing one click.
  if(embed&&lastProbeKind==='doc')scanDocs();
})();
