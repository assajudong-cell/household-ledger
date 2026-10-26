import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../supabase/functions/_shared/dedupe.js';

const base = { issuer: '신한', last4: '1234', amount: 12800, approvedAt: '2026-10-26T03:41:00Z', merchant: '스타벅스역삼점', kind: 'approval' };
const stored = [{ ...base, id: 't1', sources: ['husband:sms'], rawHashes: ['h1'] }];

test('같은 알림 재전송은 버림', () => {
  assert.equal(judge({ ...base, rawHash: 'h1', source: 'husband:sms' }, stored).action, 'drop');
});
test('같은 결제의 앱 알림은 합침', () => {
  const r = judge({ ...base, merchant: '스타벅스 역삼', rawHash: 'h2', source: 'husband:app' }, stored);
  assert.deepEqual([r.action, r.matchId], ['merge', 't1']);
});
test('가족카드로 아내에게 온 알림도 합침', () => {
  assert.equal(judge({ ...base, rawHash: 'h3', source: 'wife:sms' }, stored).action, 'merge');
});
test('같은 채널 1분 뒤 같은 금액은 중복 의심', () => {
  assert.equal(judge({ ...base, approvedAt: '2026-10-26T03:42:00Z', rawHash: 'h4', source: 'husband:sms' }, stored).action, 'suspect');
});
test('10분 뒤 같은 금액은 새 거래', () => {
  assert.equal(judge({ ...base, approvedAt: '2026-10-26T03:51:00Z', rawHash: 'h5', source: 'husband:sms' }, stored).action, 'new');
});
test('다른 카드는 새 거래', () => {
  assert.equal(judge({ ...base, last4: '9999', rawHash: 'h6', source: 'wife:sms' }, stored).action, 'new');
});
test('취소는 원거래를 찾음', () => {
  const r = judge({ ...base, kind: 'cancel', approvedAt: '2026-10-26T04:02:00Z', rawHash: 'h7', source: 'husband:sms' }, stored);
  assert.deepEqual([r.action, r.matchId], ['cancel', 't1']);
});
test('원거래 없는 취소는 확인 필요', () => {
  assert.equal(judge({ ...base, amount: 5000, kind: 'cancel', rawHash: 'h8', source: 'husband:sms' }, stored).action, 'review');
});
test('가려진 끝자리도 같은 카드로 봄', () => {
  assert.equal(judge({ ...base, last4: '1*3*', rawHash: 'h9', source: 'husband:app' }, stored).action, 'merge');
});
