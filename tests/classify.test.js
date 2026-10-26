import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessCategory, merchantRuleKey } from '../supabase/functions/_shared/classify.js';

test('키워드 분류', () => {
  assert.equal(guessCategory('스타벅스역삼점').name, '카페·간식');
  assert.equal(guessCategory('이마트 성수점').name, '장보기');
  assert.equal(guessCategory('GS25 역삼점').name, '카페·간식');
  assert.equal(guessCategory('SK에너지 역삼주유소').name, '주유·차량');
  assert.equal(guessCategory('NETFLIX.COM').name, '구독·통신');
  assert.equal(guessCategory('(주)한국정보통신').name, null);
  assert.equal(guessCategory('알수없는상호').name, null);
});
test('지점명을 떼고 규칙 키 생성', () => {
  assert.equal(merchantRuleKey('스타벅스역삼점'), '스타벅스');
  assert.equal(merchantRuleKey('이마트 성수점'), '이마트');
  assert.equal(merchantRuleKey('쿠팡'), '쿠팡');
});
test('사용자 규칙이 우선', () => {
  const r = guessCategory('쿠팡', { '쿠팡': '장보기' });
  assert.deepEqual(r, { name: '장보기', source: 'rule' });
  assert.equal(guessCategory('스타벅스 강남점', { '스타벅스': '식비' }).name, '식비');
});
