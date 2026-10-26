import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCardMessage } from '../supabase/functions/_shared/parser.js';

const RECV = new Date('2026-10-26T03:45:00Z'); // KST 12:45

const kst = iso => new Date(iso).toISOString();

test('신한 한 줄 문자', () => {
  const r = parseCardMessage('[Web발신]\n신한카드(1234)승인 홍*동 12,800원(일시불)10/26 12:41 스타벅스역삼점 누적842,300원', RECV);
  assert.equal(r.ok, true);
  assert.equal(r.issuer, '신한');
  assert.equal(r.last4, '1234');
  assert.equal(r.amount, 12800);
  assert.equal(r.installment, 1);
  assert.equal(r.kind, 'approval');
  assert.equal(r.merchant, '스타벅스역삼점');
  assert.equal(r.approvedAt, kst('2026-10-26T12:41:00+09:00'));
});

test('KB 여러 줄 문자', () => {
  const r = parseCardMessage('[Web발신]\nKB국민카드1234승인\n홍*동님\n64,500원 03개월\n10/26 19:05\n이마트 성수점\n누적1,203,000원', RECV);
  assert.equal(r.issuer, 'KB국민');
  assert.equal(r.last4, '1234');
  assert.equal(r.amount, 64500);
  assert.equal(r.installment, 3);
  assert.equal(r.merchant, '이마트 성수점');
});

test('가맹점 라벨이 있는 카톡 알림톡', () => {
  const r = parseCardMessage('현대카드 승인\n카드 본인(5678)\n금액 64,500원 (3개월)\n일시 10/26 19:05\n가맹점 롯데마트 잠실점', RECV);
  assert.equal(r.issuer, '현대');
  assert.equal(r.last4, '5678');
  assert.equal(r.merchant, '롯데마트 잠실점');
});

test('취소 문자', () => {
  const r = parseCardMessage('[Web발신]\n신한카드(1234) 승인취소\n12,800원\n10/26 13:02 스타벅스역삼점', RECV);
  assert.equal(r.kind, 'cancel');
  assert.equal(r.amount, 12800);
});

test('가려진 끝자리', () => {
  const r = parseCardMessage('삼성1*2*승인 홍*동\n9,000원 일시불\n10/26 08:10 GS25 역삼점\n누적55,000원', RECV);
  assert.equal(r.issuer, '삼성');
  assert.equal(r.last4, '1*2*');
  assert.equal(r.merchant, 'GS25 역삼점');
});

test('해외 승인', () => {
  const r = parseCardMessage('신한카드(1234)승인 홍*동 USD 23.50 10/26 02:11 NETFLIX.COM', RECV);
  assert.equal(r.currency, 'USD');
  assert.equal(r.foreignAmount, 23.5);
  assert.equal(r.amount, null);
});

test('연초에 받은 12월 승인은 작년으로', () => {
  const r = parseCardMessage('신한카드(1234)승인 12,800원 12/31 23:50 편의점', new Date('2027-01-01T00:10:00+09:00'));
  assert.equal(r.approvedAt, kst('2026-12-31T23:50:00+09:00'));
});

test('카드 문자가 아니면 거절', () => {
  assert.equal(parseCardMessage('엄마: 저녁 먹었니?').ok, false);
});
