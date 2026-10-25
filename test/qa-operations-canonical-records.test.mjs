import test from 'node:test';
import assert from 'node:assert/strict';
import { resetWorld, runMatching, operationsForOffice } from '../e2e/qa-store.mjs';
import { mapOperationsItemsToDailyTasks } from '../public/js/v2/daily-tasks/domain.js';

test('legacy browser harness supplies canonical records required by the production task projector', () => {
  resetWorld();
  runMatching('qa-office-client');
  const tasks = mapOperationsItemsToDailyTasks(operationsForOffice('qa-office-client'), new Date(), {
    officeId: 'qa-office-client', requireOpportunityRecords: true
  });
  assert.ok(tasks.some(task => task.matchId === 'match_aziz_1842'), 'real linked fixture match must survive integrity checks');
  assert.ok(tasks.some(task => task.matchId === 'match_close_9901'), 'the in-progress fixture must remain available');
});

test('legacy browser harness never includes another office canonical records', () => {
  resetWorld();
  runMatching('qa-office-client');
  const records = operationsForOffice('qa-office-client').filter(item => item.recordType === 'opportunity');
  assert.ok(records.length > 0, 'the feed contains canonical records');
  assert.ok(records.every(item => item.officeId === 'qa-office-client'));
});
