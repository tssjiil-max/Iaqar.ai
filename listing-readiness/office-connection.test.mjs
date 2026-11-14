import test from 'node:test';import assert from 'node:assert/strict';import {resolveOfficeConnection} from './office-connection.mjs';
const data={officeId:'office-1',connectionId:'stable-1',enabled:true,contractVersion:1};
const opts={baseUrl:'https://example.com',officeId:'office-1',getAccessToken:async()=> 'token',transport:async()=>({ok:true,json:async()=>data})};
test('connection identity survives new client session',async()=>{const a=await resolveOfficeConnection(opts);const b=await resolveOfficeConnection({...opts});assert.deepEqual(a,b);assert.equal(a.connectionId,'stable-1')});
test('rejects cross-office response',async()=>{await assert.rejects(resolveOfficeConnection({...opts,transport:async()=>({ok:true,json:async()=>({...data,officeId:'other'})})}),/untrusted/)});
test('does not silently reconnect after revoked server link',async()=>{await assert.rejects(resolveOfficeConnection({...opts,transport:async()=>({ok:false,status:404})}),/404/)});
test('requires HTTPS and authenticated session',async()=>{await assert.rejects(resolveOfficeConnection({...opts,baseUrl:'http://example.com'}),/HTTPS/);await assert.rejects(resolveOfficeConnection({...opts,getAccessToken:async()=>''}),/authorization/)});
