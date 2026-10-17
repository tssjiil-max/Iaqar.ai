import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWithClaude, classifyEconomicWhatsApp, economicModeActive, sendWhatsAppMessage, usesPaidClassifier } from '../worker/src/office-os/whatsapp-agent-transport.js';

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
 await assert.rejects(()=>classifyWithClaude({env:{ECONOMIC_TEST_MODE:'disabled',WHATSAPP_AGENT_CLASSIFIER:'claude'}},'مرحبا'),e=>e.code==='claude_not_configured');
 const local=await classifyWithClaude({env:{ANTHROPIC_API_KEY:'k',ANTHROPIC_MODEL:'m'},fetchImpl:async()=>{throw Error('no network expected');}},'مرحبا');
 assert.equal(local.simulated,true,'keys alone never enable paid calls');
});

const LIVE_KEYS={WHATSAPP_AGENT_CLASSIFIER:'claude',ANTHROPIC_API_KEY:'k',ANTHROPIC_MODEL:'m',WHATSAPP_AGENT_SEND:'enabled',META_WHATSAPP_ACCESS_TOKEN:'t'};
const NOT_DISABLED=[['missing',undefined],['empty',''],['unknown','off'],['differently cased','DISABLED'],['padded',' disabled '],['legacy enabled','enabled']];
test('economic mode is on unless ECONOMIC_TEST_MODE is exactly "disabled"',()=>{
 for(const [label,value] of NOT_DISABLED)assert.equal(economicModeActive({...LIVE_KEYS,ECONOMIC_TEST_MODE:value}),true,label);
 assert.equal(economicModeActive({}),true,'empty env');
 assert.equal(economicModeActive({ECONOMIC_TEST_MODE:'disabled'}),false);
});
test('with keys present, economic mode makes no Anthropic request and no Meta request',async()=>{
 for(const [label,value] of NOT_DISABLED){
  const urls=[];const ctx={env:{...LIVE_KEYS,ECONOMIC_TEST_MODE:value},fetchImpl:async url=>{urls.push(String(url));throw Error('unexpected network');}};
  assert.equal(usesPaidClassifier(ctx.env),false,label);
  const classified=await classifyWithClaude(ctx,'أبحث عن فيلا للشراء');
  assert.equal(classified.simulated,true,label);
  const sent=await sendWhatsAppMessage(ctx,{phoneNumberId:'1',to:'966500000001',message:{type:'text',text:{body:'x'}}});
  assert.deepEqual(sent,{ok:false,error:'economic_mode_no_send'},label);
  assert.deepEqual(urls,[],label);
 }
});
test('"disabled" lifts only the economic gate: Claude still needs its classifier flag and keys',async()=>{
 const off={ECONOMIC_TEST_MODE:'disabled'};
 assert.equal(usesPaidClassifier({...off,ANTHROPIC_API_KEY:'k',ANTHROPIC_MODEL:'m'}),false,'no classifier flag → local classifier');
 const local=await classifyWithClaude({env:{...off,ANTHROPIC_API_KEY:'k',ANTHROPIC_MODEL:'m'},fetchImpl:async()=>{throw Error('no network expected');}},'مرحبا');
 assert.equal(local.simulated,true);
 await assert.rejects(()=>classifyWithClaude({env:{...off,WHATSAPP_AGENT_CLASSIFIER:'claude'}},'مرحبا'),e=>e.code==='claude_not_configured');
 const urls=[];
 const result=await classifyWithClaude({env:{...off,WHATSAPP_AGENT_CLASSIFIER:'claude',ANTHROPIC_API_KEY:'k',ANTHROPIC_MODEL:'m'},fetchImpl:async url=>{urls.push(String(url));return Response.json({content:[{type:'text',text:'{"intent":"purchase","requiresHuman":false}'}],usage:{}});}},'مرحبا');
 assert.equal(result.intent,'purchase');
 assert.deepEqual(urls,['https://api.anthropic.com/v1/messages'],'only with every gate open is Claude reached');
});
