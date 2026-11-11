const test=require("node:test");const assert=require("node:assert/strict");const {parse}=require("../public/js/smart-request-parser.js");
test("extracts apartment, sale, district and budget from Saudi Arabic",()=>{
 const r=parse("أبغى شقة تمليك في الجماوات، ٤ غرف، ميزانيتي ٥٠٠ ألف",{districts:["الجماوات","الوبرة"]});
 assert.equal(r.propertyType,"شقة");assert.equal(r.purpose,"بيع");assert.equal(r.district,"الجماوات");assert.equal(r.minRooms,4);assert.equal(r.maxPrice,500000);
});
test("does not fabricate unprovided price or district",()=>{
 const r=parse("أبغى عمارة للإيجار",{districts:["الجماوات"]});
 assert.equal(r.propertyType,"عمارة");assert.equal(r.purpose,"إيجار");assert.equal(r.maxPrice,undefined);assert.equal(r.district,undefined);
});
test("prefers longest district name when names overlap",()=>{
 const r=parse("شقة في حرة الوبرة",{districts:["الوبرة","حرة الوبرة"]});
 assert.equal(r.district,"حرة الوبرة");
});
