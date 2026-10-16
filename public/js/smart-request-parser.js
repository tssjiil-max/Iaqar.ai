/* Minimal Arabic request parser for public property search.
 * Heuristic fallback only; uncertain values are left unset.
 */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;if(root)root.IAQARRequestParser=api;})(typeof window!=="undefined"?window:null,function(){
"use strict";
const normalize=s=>String(s||"").replace(/[٠-٩]/g,c=>String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/[۰-۹]/g,c=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/[\u064B-\u065F\u0670]/g,"").replace(/[إأآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").toLowerCase();
const types=[["شقة",/شق[هة]/],["فيلا",/فيلا/],["عمارة",/عمار[هة]/],["أرض",/ارض/],["دور",/\bدور\b/],["مكتب",/مكتب/],["محل",/محل/]];
function parse(raw,{districts=[]}={}){
 const s=normalize(raw),result={originalText:String(raw||"").trim(),confidence:"heuristic"};
 const type=types.find(([,rx])=>rx.test(s));if(type)result.propertyType=type[0];
 if(/ايجار|استئجار|استاجار|للايجار|اجره|استاجر/.test(s))result.purpose="إيجار";
 else if(/شراء|تمليك|للبيع|ابيع|اشتري/.test(s))result.purpose="بيع";
 const district=districts.map(name=>({name,needle:normalize(name)})).filter(x=>x.needle&&s.includes(x.needle)).sort((a,b)=>b.needle.length-a.needle.length)[0];
 if(district)result.district=district.name;
 const money=[...s.matchAll(/(?:بحدود|ميزانيتي|ميزانيه|حدي|سعر|الى|حتى|بـ|ب)\s*([\d,]+(?:\.\d+)?)\s*(مليون|ملايين|الف|الاف|ريال)?/g)];
 const match=money.find(m=>{const n=Number(m[1].replace(/,/g,""));return n>=1;});
 if(match){const n=Number(match[1].replace(/,/g,""));const mult=/مليون|ملايين/.test(match[2]||"")?1e6:/الف|الاف/.test(match[2]||"")?1e3:1;const price=n*mult;if(price>=1000&&price<=1e10)result.maxPrice=price;}
 const rooms=s.match(/(?:عدد\s*)?([\d]+)\s*(?:غرف|غرفه)/);if(rooms){const n=Number(rooms[1]);if(n>=1&&n<=30)result.minRooms=n;}
 return result;
}
return Object.freeze({parse,normalize});
});
