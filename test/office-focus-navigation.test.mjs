import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationSection, OFFICE_NAV } from '../public/os/domain/office-navigation-domain.js';
test('five internal destinations in approved RTL order',()=>assert.deepEqual(OFFICE_NAV.map(x=>x[0]),['office','repo','deals','inbox','more']));
test('nested and legacy routes select their owning destination',()=>{
 for(const [route,want] of Object.entries({'record/new':'repo','record/x/edit':'repo','journey/x':'deals','session/x':'deals','deal/x':'deals','review/x':'deals','conversations/x':'inbox','settings/brokers':'more','tools/calculator':'more','search':'more','tasks':'office','agent':'office','scout/opp/x':'office'})) assert.equal(navigationSection(route),want,route);
});
