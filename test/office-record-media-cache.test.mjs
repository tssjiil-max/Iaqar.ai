import test from 'node:test';
import assert from 'node:assert/strict';
import { state, patchCachedRecordImages, subscribe } from '../public/os/core/state.js';
test('saved image order replaces deleted cover before navigation, without touching amounts',()=>{
 const record={id:'r1',officeId:'office-a',images:[{id:'old',url:'https://test.local/old.jpg'}],coverUrl:'https://test.local/old.jpg',imageCount:1,price:600000.5};
 state.records=[record];state.recordsById=new Map([['r1',record]]);let updates=0;const stop=subscribe(k=>{if(k==='records')updates++;});
 const images=[{id:'new',url:'https://test.local/new.jpg'}];
 assert.equal(patchCachedRecordImages('office-a','r1',images),true);
 assert.equal(state.recordsById.get('r1').coverUrl,images[0].url);assert.equal(state.records[0].price,600000.5);assert.equal(updates,1);
 assert.equal(patchCachedRecordImages('office-a','r1',[]),true);assert.equal(state.records[0].coverUrl,null);assert.equal(state.records[0].imageCount,0);stop();
});
test('another office and missing records cannot patch the displayed cache',()=>{
 const before=state.recordsById.get('r1');assert.equal(patchCachedRecordImages('office-b','r1',[]),false);assert.equal(patchCachedRecordImages('office-a','missing',[]),false);assert.equal(state.recordsById.get('r1'),before);
});
