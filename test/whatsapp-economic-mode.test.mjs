import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWithClaude, classifyEconomicWhatsApp } from '../worker/src/office-os/whatsapp-agent-transport.js';

test('economic mode classifies Arabic request without invoking network or Claude', async () => {
 let calls=0;
 const result=await classifyWithClaude({env:{ECONOMIC_TEST_MODE:'enabled'},fetchImpl:async()=>{calls++;throw Error('unexpected network');}},'أبحث عن أرض للشراء في المدينة');
 assert.equal(result.intent,'purchase');
 assert.equal(result.simulated,true);
 assert.deepEqual(result.usage,{inputTokens:0,outputTokens:0});
 assert.equal(calls,0);
});
test('economic mode routes contracts and price changes to human',()=>{
 assert.equal(classifyEconomicWhatsApp('أريد توقيع عقد').requiresHuman,true);
 assert.equal(classifyEconomicWhatsApp('غير السعر إلى 500 ألف').requiresHuman,true);
});
test('economic mode handles rental intent conservatively',()=>{
 assert.equal(classifyEconomicWhatsApp('أبغى شقة للإيجار').intent,'rent');
 assert.equal(classifyEconomicWhatsApp('مرحبا').intent,'inquiry');
});
test('non-economic mode still requires configured Claude',async()=>{
 await assert.rejects(()=>classifyWithClaude({env:{}},'مرحبا'),e=>e.code==='claude_not_configured');
});
