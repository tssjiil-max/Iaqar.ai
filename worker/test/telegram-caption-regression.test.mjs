import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTelegramInbound } from '../src/telegram-intake-domain.js';
for (const [kind,media] of [['text',{text:'طلب شقة'}],['photo',{photo:[{file_id:'small'},{file_id:'large'}]}],['voice',{voice:{file_id:'voice'}}],['document',{document:{file_id:'doc'}}]]) {
  for (const caption of kind === 'text' ? [''] : ['', 'عرض شقة للبيع']) {
    test(`${kind} preserves media with caption=${!!caption}`, () => {
      const got=normalizeTelegramInbound({update_id:1,message:{chat:{id:99},date:1,...media,...(caption?{caption}:{})}},{officeId:'test-office'});
      assert.equal(got.kind,kind);
      assert.equal(got.officeId,'test-office');
      if(caption) assert.equal(got.text,caption);
      if(kind==='photo')assert.equal(got.mediaFileId,'large');
      assert.equal(got.autoSendAllowed,false);
    });
  }
}
