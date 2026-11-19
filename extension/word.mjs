import {Document,Paragraph,TextRun,Footer,PageNumber,Packer,ImageRun} from './vendor/docx.mjs';
import {prepareChapters} from './core.mjs';

const song={name:'宋体',eastAsia:'宋体'},hei={name:'黑体',eastAsia:'黑体'};
function paragraph(text,{size=21,bold=false,font=song,...options}={}){
  return new Paragraph({spacing:{after:40,line:280},...options,children:[new TextRun({text,font,size,bold,color:'000000'})]});
}
async function imageParagraph(url){
  const u=new URL(url);
  if(u.protocol!=='https:'||!u.hostname.endsWith('.chaoxing.com'))throw Error('Word 中的图片需要可访问的学习通 HTTPS 地址；请改用 PDF 并核对图片。');
  const response=await fetch(url,{credentials:'include',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('题目图片下载失败，请重新登录后导出。');
  const blob=await response.blob();
  if(blob.size>10*1024*1024)throw Error('图片超过 10 MB，请改用 PDF。');
  const data=new Uint8Array(await blob.arrayBuffer());
  const type=data[0]===137&&data[1]===80?'png':data[0]===255&&data[1]===216?'jpg':data[0]===71&&data[1]===73?'gif':null;
  if(!type)throw Error('Word 暂不支持此图片类型，请改用 PDF。');
  const bitmap=await createImageBitmap(blob);
  const ratio=Math.min(1,620/bitmap.width,850/bitmap.height);
  const transformation={width:Math.round(bitmap.width*ratio),height:Math.round(bitmap.height*ratio)};bitmap.close();
  return new Paragraph({children:[new ImageRun({data,type,transformation})],spacing:{after:80}});
}
export async function toDocx(works,title='学习通作业题库',{showExplanations=true,answerMode='end'}={}){
  const chapters=prepareChapters(works),children=[];
  const inline=answerMode==='inline';
  if(!chapters.length)throw Error('没有可导出的题目');
  for(const [index,c] of chapters.entries()){
    children.push(paragraph(c.title,{size:32,font:hei,bold:true,alignment:'center',pageBreakBefore:index>0,keepNext:true,spacing:{before:0,after:240,line:360}}));
    for(const q of c.questions){
      children.push(paragraph(`${q.number}. ${q.stem}（${q.type}）`,{size:24,keepNext:q.options.length>0,spacing:{before:100,after:60,line:300}}));
      for(const [i,option] of q.options.entries())children.push(paragraph(option,{indent:{left:280},keepNext:i<q.options.length-1}));
      for(const url of q.images||[])children.push(await imageParagraph(url));
      if(inline){
        // 答案位置=紧跟题目：正确答案（含历史错题）、解析、核对备注直接排在这道题下面。
        children.push(paragraph(`正确答案：${q.answer||'未公布'}${q.wrong?`　（我的答案：${q.mine}，历史错题）`:''}`,{size:21,spacing:{before:80,after:40,line:280}}));
        if(showExplanations&&(q.explanation||q.explanationImages.length)){
          const lines=(q.explanation||'').split(/\r?\n/);
          children.push(paragraph(`解析：${lines.shift()||''}`,{size:21,spacing:{before:40,after:40,line:280}}));
          for(const line of lines)children.push(paragraph(line,{size:21}));
          for(const url of q.explanationImages)children.push(await imageParagraph(url));
        }
        if(q.notes.length)children.push(paragraph(q.notes.join('；'),{size:18}));
        children.push(paragraph('',{spacing:{after:100}}));
      }
    }
    if(inline)continue;
    children.push(paragraph('参考答案',{size:24,bold:true,keepNext:true,spacing:{before:200,after:80}}));
    for(let i=0;i<c.questions.length;i+=5){
      const group=c.questions.slice(i,i+5),range=group.length===1?group[0].number:`${group[0].number}–${group.at(-1).number}`;
      children.push(paragraph(`${range}题　　${group.map(q=>`${q.number}. ${q.answer||'未公布'}`).join('　　')}`));
    }
    if(showExplanations)for(const q of c.questions){
      if(q.explanation||q.explanationImages.length){
        const lines=(q.explanation||'').split(/\r?\n/);
        children.push(paragraph(`${q.number}题解析：${lines.shift()||''}`,{spacing:{before:100,after:40,line:300}}));
        for(const line of lines)children.push(paragraph(line));
        for(const url of q.explanationImages)children.push(await imageParagraph(url));
      }
    }
    for(const q of c.questions)if(q.notes.length)children.push(paragraph(`${q.number}题：${q.notes.join('；')}`,{size:18}));
  }
  const doc=new Document({title,creator:'学习通题库整理',description:'按章节归档的作业题库',styles:{default:{document:{run:{font:song,size:24,color:'000000'},paragraph:{spacing:{line:280,after:40}}}}},sections:[{
    properties:{page:{size:{width:11906,height:16838},margin:{top:907,bottom:907,left:1020,right:1020,footer:400}}},
    footers:{default:new Footer({children:[new Paragraph({alignment:'center',children:[new TextRun({font:song,size:21,children:[PageNumber.CURRENT]})]})]})},children
  }]});
  return Packer.toBlob(doc);
}
