const test = require("node:test");
const assert = require("node:assert/strict");
const { search, distanceKm } = require("../public/js/smart-search-core.js");
const base = { publicVisible: true, available: true, propertyType: "شقة", purpose: "بيع", price: 450000 };
const listing = (id, officeId, district, extra = {}) => ({ ...base, id, officeId, district, ...extra });

test("office search cannot expose other offices or private/unavailable inventory", () => {
  const data = [listing("1","sultan","الجماوات"), listing("2","khalid","الجماوات"), listing("3","sultan","الجماوات",{publicVisible:false}),listing("4","sultan","الجماوات",{available:false})];
  assert.deepEqual(search(data,{district:"الجماوات"},{officeId:"sultan"}).map(x=>x.propertyId),["1"]);
});
test("global search allows published listings from several offices", () => {
  const result = search([listing("1","sultan","الجماوات"),listing("2","khalid","الجماوات")],{district:"الجماوات"},{scope:"all"});
  assert.equal(result.length,2);
});
test("exact district precedes nearby suggestions, Arabic normalization works", () => {
  const data = [listing("near","khalid","الوبرة",{lat:24.5,lng:39.6}),listing("exact","sultan","الجماوات",{lat:24.52,lng:39.61})];
  const results=search(data,{district:"الجَمَاوَات"},{scope:"all",targetCoordinates:{lat:24.52,lng:39.61}});
  assert.equal(results[0].propertyId,"exact");
  assert.equal(results[1].distanceType,"straight_line");
  assert.ok(results[1].distanceKm > 0);
});
test("limits results to ten, deduplicates canonical property and excludes incompatible type", () => {
  const data=Array.from({length:13},(_,i)=>listing(String(i),"sultan","الجماوات"));
  data.push(listing("copy","khalid","الجماوات",{canonicalPropertyId:"canonical-1"}));
  data[0].canonicalPropertyId="canonical-1";
  data.push(listing("villa","sultan","الجماوات",{propertyType:"فيلا"}));
  const result=search(data,{propertyType:"شقة"},{scope:"all"});
  assert.equal(result.length,10);
  assert.equal(result.filter(x=>x.listing.canonicalPropertyId==="canonical-1").length,1);
});
test("no invented distance and office scope is required", () => {
  assert.equal(distanceKm(null,{lat:24,lng:39}),null);
  assert.equal(search([listing("1","sultan","الجماوات")],{district:"الجماوات"},{scope:"all"})[0].distanceKm,null);
  assert.throws(()=>search([],{},{}),/OFFICE_SCOPE_REQUIRED/);
});
