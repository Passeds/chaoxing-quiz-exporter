import {toHtml,initViewer} from './core.mjs';
async function start(){
  const id=new URL(location.href).searchParams.get('job');
  if(!id||!/^print-[a-f0-9-]+$/.test(id))throw Error('无效的导出任务，请从题库面板重新导出。');
  const stored=await chrome.storage.session.get(id),job=stored[id];
  if(!job)throw Error('预览已过期，请回到题库面板重新导出。');
  await chrome.storage.session.remove(id);
  const parsed=new DOMParser().parseFromString(toHtml(job.works,job.title,job.settings),'text/html');
  document.title=job.title;
  document.head.append(document.importNode(parsed.querySelector('style'),true));
  document.body.replaceChildren(document.importNode(parsed.querySelector('main'),true));
  const hint=document.createElement('p');hint.className='muted';hint.textContent='点击“打印 / 另存为 PDF”，目标选择“另存为 PDF”，纸张 A4、缩放 100%，关闭浏览器自带页眉和页脚。';
  document.querySelector('header').append(hint);
  initViewer();
  const print=document.getElementById('print');
  print.onclick=async()=>{
    print.disabled=true;
    try{
      await document.fonts.ready;
      const images=[...document.querySelectorAll('img')].filter(x=>!x.closest('[hidden]')&&x.getClientRects().length);
      await Promise.all(images.map(img=>Promise.race([img.decode(),new Promise((_,reject)=>setTimeout(()=>reject(Error('图片加载超时')),15000))])));
      window.print();
    }catch{hint.textContent='有图片未加载完成，暂未打开打印。请检查网络或重新采集，确保题目及解析图片完整。';}
    finally{print.disabled=false;}
  };
}
start().catch(e=>{document.getElementById('loading').textContent=e.message;});
