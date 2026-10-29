import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFacts} from '../public/os/domain/visitor-domain.js';
for(const [text,price,area,rooms] of [
 ['للبيع فيلا في المدينة المنورة حي العزيزية مساحة 400 متر السعر 1200000 ريال 5 غرف',1200000,400,5],
 ['للايجار شقة 3 غرف مساحة 150 متر السعر 30000 ريال',30000,150,3],
 ['مطلوب شقة ٣ غرف ١٥٠ متر الميزانية ٣٥٠٠٠ ريال',35000,150,3],
 ['للبيع شقة 3 غرف 150 متر السعر عند التواصل 0551234567',undefined,150,3],
 ['للبيع فيلا مساحة 400 متر 5 غرف بسعر 1.2 مليون',1200000,400,5]
]) test(`price does not inherit area, room count or phone: ${text}`,()=>{
 const found=extractFacts(text);
 assert.equal(found.price,price);assert.equal(found.area,area);assert.equal(found.rooms,rooms);
});
