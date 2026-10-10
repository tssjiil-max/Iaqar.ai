import { MARKETING_SIZES } from '../domain/marketing-domain.js';
export const MARKETING_FONTS={plex:'IBM Plex Sans Arabic',tajawal:'Tajawal',naskh:'Noto Naskh Arabic',kufi:'Noto Kufi Arabic'};
function lines(ctx,text,maxWidth) {
 const out=[];for(const paragraph of String(text||'').split('\n')) {
  let line='';for(const word of paragraph.split(/\s+/)) {
   if(ctx.measureText(word).width>maxWidth)throw new Error('النص يحتوي كلمة أو رابطًا أطول من مساحة التصميم');
   const next=line?line+' '+word:word;if(ctx.measureText(next).width>maxWidth){out.push(line);line=word;}else line=next;
  }if(line)out.push(line);
 }return out;
}
function image(url) {return new Promise((resolve,reject)=>{const img=new Image();img.crossOrigin='anonymous';const timer=setTimeout(()=>reject(new Error('تعذر تحميل شعار المكتب؛ تحقق من الصورة قبل التصدير')),12000);img.onload=()=>{clearTimeout(timer);resolve(img);};img.onerror=()=>{clearTimeout(timer);reject(new Error('تعذر تحميل شعار المكتب؛ تحقق من الصورة قبل التصدير'));};img.src=url;});}
export async function drawMarketing(canvas,profile,draft) {
 const [w,h]=MARKETING_SIZES[draft.size];const family=MARKETING_FONTS[draft.font]||MARKETING_FONTS.plex;
 await document.fonts.ready;
 for(const weight of [400,500,600]) {
  const loaded=await document.fonts.load(`${weight} 52px "${family}"`);
  if(!loaded.length||!document.fonts.check(`${weight} 52px "${family}"`))throw new Error('تعذر تحميل الخط العربي');
 }
 const logo=profile.logoUrl?await image(profile.logoUrl):null;
 // Render offscreen and replace the preview only when the complete frame is ready.
 const frame=document.createElement('canvas');frame.width=w;frame.height=h;const ctx=frame.getContext('2d');
 const dark=draft.template==='petrol';ctx.fillStyle=dark?profile.color:'#ffffff';ctx.fillRect(0,0,w,h);
 ctx.strokeStyle=profile.color;ctx.lineWidth=3;if(draft.template==='frame')ctx.strokeRect(36,36,w-72,h-72);
 ctx.fillStyle=dark?'#ffffff':profile.color;ctx.direction='rtl';ctx.textAlign='center';
 const compact=h<900;const top=compact?36:80;const logoSize=compact?100:160;
 if(logo) {const scale=Math.min(logoSize/logo.width,logoSize/logo.height);ctx.drawImage(logo,w/2-logo.width*scale/2,top,logo.width*scale,logo.height*scale);}
 ctx.font=`600 ${compact?36:46}px "${family}"`;ctx.fillText(profile.name,w/2,top+(logo?logoSize+48:58),w-120);
 if(profile.city){ctx.font=`400 28px "${family}"`;ctx.fillText(profile.city,w/2,top+(logo?logoSize+88:98));}
 const x=w*draft.textX/100;const y=h*draft.textY/100;const available=Math.min(x-55,w-x-55)*2;
 let fs=draft.fontSize;let title;
 do{ctx.font=`600 ${fs}px "${family}"`;title=lines(ctx,draft.headline,available);if(title.length<=3)break;fs-=2;}while(fs>=28);
 if(title.length>3)throw new Error('اختصر عنوان الإعلان ليلائم التصميم');
 title.forEach((line,i)=>ctx.fillText(line,x,y+i*fs*1.45));
 ctx.font=`400 ${compact?26:34}px "${family}"`;const body=lines(ctx,draft.body,available);const bodyStart=y+title.length*fs*1.45+22;const gap=compact?36:48;
 if(bodyStart+body.length*gap>h*(compact?.75:.79))throw new Error('النص طويل لهذا الموضع؛ اختصره أو ارفع موضع النص أو اختر الستوري');
 body.forEach((line,i)=>ctx.fillText(line,x,bodyStart+i*gap));
 ctx.font=`500 ${compact?26:34}px "${family}"`;if(profile.phone)ctx.fillText(profile.phone,w/2,h*.86);
 ctx.font=`400 ${compact?23:28}px "${family}"`;ctx.fillText('أرسل عقارك أو طلبك عبر رابط المكتب',w/2,h*.91);
 ctx.direction='ltr';let linkSize=compact?20:26;while(linkSize>14){ctx.font=`500 ${linkSize}px "${family}"`;if(ctx.measureText(profile.link).width<=w-100)break;linkSize--;}
 if(ctx.measureText(profile.link).width>w-100)throw new Error('الرابط طويل لمساحة التصميم');ctx.fillText(profile.link,w/2,h*.96);
 canvas.width=w;canvas.height=h;canvas.getContext('2d').drawImage(frame,0,0);
 return canvas;
}
export async function marketingPng(canvas) {
 if(!canvas.width||!canvas.height)throw new Error('جهز المعاينة أولًا');
 return new Promise((resolve,reject)=>{try{canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('تعذر تصدير الصورة')),'image/png');}catch{reject(new Error('تعذر التصدير؛ شعار المكتب يحتاج السماح بالتحميل من مصدره'));}});
}
