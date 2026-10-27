// 샘플 화면용 가짜 서버: 실제 Supabase 대신 브라우저 메모리의 예시 데이터를 씀
import { parseCardMessage } from './shared/parser.js';
import { guessCategory } from './shared/classify.js';

const ME = 'u-husband', WIFE = 'u-wife', HH = 'h1';
const CATS = ['식비','카페·간식','장보기','생활용품','주거·공과금','교통','주유·차량','의료','교육','쇼핑·의류','문화·여가','여행','경조사·선물','구독·통신','기타'];
const cid = (n) => 'k' + CATS.indexOf(n);
let seq = 0; const id = () => 'x' + (++seq);
const kst = (m, d, hh, mm) => new Date(`2026-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00+09:00`).toISOString();

const db = {
  members: [
    { user_id: ME, household_id: HH, display_name: '남편', ingest_token: 'sample-token-0000' },
    { user_id: WIFE, household_id: HH, display_name: '아내', ingest_token: 'sample-token-1111' },
  ],
  invites: [{ code: '3F9A21BC', household_id: HH }],
  categories: CATS.map((n, i) => ({ id: 'k' + i, household_id: HH, name: n, sort: i + 1 })),
  cards: [
    { id: 'c1', issuer: '신한', last4: '1234', owner_user_id: ME, nickname: null, created_at: '1' },
    { id: 'c2', issuer: '현대', last4: '5678', owner_user_id: WIFE, nickname: null, created_at: '2' },
    { id: 'c3', issuer: '삼성', last4: '9012', owner_user_id: WIFE, nickname: '생활비카드', created_at: '3' },
    { id: 'c4', issuer: 'KB국민', last4: '3456', owner_user_id: null, nickname: null, created_at: '4' },
  ],
  raw_messages: [
    { id: 'r1', member_id: WIFE, result: 'unparsed', received_at: kst(10, 25, 21, 3), body: '[현대카드] 해외승인 USD 23.99 NETFLIX.COM 10/25 21:02' },
  ],
  merchant_rules: [],
  transactions: [],
};
const T = (m, d, hh, mm, merchant, amount, card, cat, extra = {}) =>
  db.transactions.push({ id: id(), household_id: HH, card_id: card, kind: 'approval', amount, currency: 'KRW', installment: 1, approved_at: kst(m, d, hh, mm), merchant, category_id: cat ? cid(cat) : null, memo: null, canceled: false, status: 'ok', excluded: false, raw_hashes: [], category_source: cat ? 'user' : null, ...extra });

// 10월: 대부분 승인된 분류, 일부는 제안 대기
T(10, 1, 8, 12, '스타벅스 역삼점', 6300, 'c1', '카페·간식');
T(10, 2, 19, 40, '이마트 성수점', 87400, 'c3', '장보기');
T(10, 3, 12, 30, '김밥천국', 9000, 'c1', '식비');
T(10, 4, 14, 5, 'GS칼텍스 성수주유소', 72000, 'c1', '주유·차량');
T(10, 5, 11, 20, '쿠팡', 34800, 'c2', '생활용품');
T(10, 6, 18, 55, '배달의민족', 28500, 'c2', '식비');
T(10, 8, 9, 0, '한국전력공사', 54320, 'c3', '주거·공과금');
T(10, 9, 13, 10, '올리브영 강남점', 23900, 'c2', '생활용품');
T(10, 10, 20, 15, 'CGV 왕십리', 30000, 'c1', '문화·여가');
T(10, 11, 10, 40, '홈플러스 익스프레스', 41200, 'c3', '장보기');
T(10, 12, 15, 30, '연세소아과의원', 12500, 'c2', '의료');
T(10, 14, 7, 50, '카카오T 택시', 15800, 'c1', '교통');
T(10, 16, 21, 0, 'SK텔레콤', 89000, 'c3', '구독·통신');
T(10, 17, 18, 20, '무신사', 129000, 'c2', '쇼핑·의류', { installment: 3 });
T(10, 18, 13, 0, '롯데마트 제타플렉스', 112300, 'c3', '장보기');
T(10, 20, 19, 30, '교촌치킨', 23000, 'c1', '식비');
T(10, 22, 10, 30, '쿠팡', 18900, 'c2', '생활용품', { canceled: true });
T(10, 24, 18, 0, '결혼식 축의금', 100000, null, '경조사·선물', { kind: 'manual', memo: '대학 동기' });
T(10, 26, 12, 41, '스타벅스 역삼점', 12800, 'c1', '카페·간식');
// 처음 보는 가게: 키워드로 짐작한 '제안'
T(10, 15, 12, 10, '본죽 성수점', 11000, 'c1', '식비', { category_source: 'suggested' });
T(10, 19, 16, 45, '투썸플레이스', 13600, 'c2', '카페·간식', { category_source: 'suggested' });
T(10, 21, 11, 0, '예스24', 32400, 'c2', '교육', { category_source: 'suggested' });
T(10, 23, 12, 40, '파리바게뜨', 8700, 'c3', '카페·간식', { category_source: 'suggested' });
// 짐작도 못 한 가게: 분류 필요
T(10, 25, 14, 20, '성수동 수제버거', 31000, 'c4', null);
T(10, 26, 12, 42, '스타벅스 역삼점', 12800, 'c1', '카페·간식', { status: 'suspect' });
db.transactions[db.transactions.length - 1].suspect_of = db.transactions.find((t) => t.merchant === '스타벅스 역삼점' && t.amount === 12800).id;

// 5~9월 (추세용)
const PAST = {
  5: { 장보기: 210000, 식비: 180000, '카페·간식': 52000, '주거·공과금': 61000, '구독·통신': 89000, '주유·차량': 80000, 생활용품: 45000, '쇼핑·의류': 90000, '문화·여가': 40000, 의료: 15000 },
  6: { 장보기: 230000, 식비: 210000, '카페·간식': 61000, '주거·공과금': 58000, '구독·통신': 89000, '주유·차량': 75000, 생활용품: 38000, '쇼핑·의류': 60000, 여행: 120000, 교통: 20000 },
  7: { 장보기: 250000, 식비: 260000, '카페·간식': 70000, '주거·공과금': 92000, '구독·통신': 89000, '주유·차량': 95000, 생활용품: 52000, 여행: 680000, '문화·여가': 55000, 의료: 30000 },
  8: { 장보기: 240000, 식비: 230000, '카페·간식': 66000, '주거·공과금': 104000, '구독·통신': 89000, '주유·차량': 88000, 생활용품: 41000, '쇼핑·의류': 130000, '경조사·선물': 200000, 교육: 35000 },
  9: { 장보기: 180000, 식비: 240000, '카페·간식': 60000, '주거·공과금': 95000, '구독·통신': 89000, '주유·차량': 70000, 생활용품: 48000, '쇼핑·의류': 150000, '경조사·선물': 50000, 교통: 25000 },
};
for (const [mo, cats] of Object.entries(PAST)) {
  Object.entries(cats).forEach(([cat, total], i) => {
    // 한 분류를 두 사람 카드에 나눠 담기
    const a = Math.round(total * 0.55 / 100) * 100;
    T(+mo, 2 + i * 2, 12, 0, cat + ' 결제', a, i % 2 ? 'c1' : 'c3', cat);
    T(+mo, 3 + i * 2, 18, 0, cat + ' 결제', total - a, i % 2 ? 'c2' : 'c1', cat);
  });
}

// ---- 간단한 쿼리 흉내 ----
function query(table) {
  let rows = () => db[table], filters = [], order = null, lim = null, op = 'select', payload = null, single = false, maybe = false;
  const q = {
    select() { return q; },
    eq(k, v) { filters.push((r) => r[k] === v); return q; },
    gte(k, v) { filters.push((r) => r[k] >= v); return q; },
    lt(k, v) { filters.push((r) => r[k] < v); return q; },
    order(k, o = {}) { order = [k, o.ascending !== false]; return q; },
    limit(n) { lim = n; return q; },
    maybeSingle() { maybe = true; return q; },
    single() { single = true; return q; },
    update(p) { op = 'update'; payload = p; return q; },
    delete() { op = 'delete'; return q; },
    insert(p) { op = 'insert'; payload = p; return q; },
    upsert(p) { op = 'upsert'; payload = p; return q; },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  function run() {
    let r = rows().filter((x) => filters.every((f) => f(x)));
    if (op === 'update') { r.forEach((x) => Object.assign(x, payload)); return { data: r, error: null }; }
    if (op === 'delete') { db[table] = db[table].filter((x) => !r.includes(x)); return { data: null, error: null }; }
    if (op === 'insert' || op === 'upsert') {
      const row = { id: id(), canceled: false, status: 'ok', raw_hashes: [], installment: 1, currency: 'KRW', ...payload };
      db[table].push(row); return { data: single ? row : [row], error: null };
    }
    if (order) { const [k, asc] = order; r = [...r].sort((a, b) => (a[k] > b[k] ? 1 : -1) * (asc ? 1 : -1)); }
    if (lim) r = r.slice(0, lim);
    if (single || maybe) return { data: r[0] ?? null, error: null };
    return { data: r, error: null };
  }
  return q;
}

const ch = { on() { return ch; }, subscribe() { return ch; } };
window.supabase = {
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: ME } } } }),
      onAuthStateChange() {}, signOut: async () => {}, signInWithOtp: async () => ({}),
    },
    from: query,
    rpc: async () => ({ data: HH, error: null }),
    channel: () => ch,
  }),
};

// "알림 붙여넣기"도 실제 해석기로 동작하게
window.fetch = async (_url, opts) => {
  const { text } = JSON.parse(opts.body);
  const p = parseCardMessage(text, new Date());
  if (!p.ok) return new Response(JSON.stringify({ result: p.reason === 'not_card_message' ? 'ignored' : 'unparsed' }));
  let card = db.cards.find((c) => c.issuer === p.issuer && c.last4 === p.last4);
  if (!card) { card = { id: id(), issuer: p.issuer, last4: p.last4, owner_user_id: null, nickname: null, created_at: String(Date.now()) }; db.cards.push(card); }
  const g = guessCategory(p.merchant);
  const catId = g ? db.categories.find((c) => c.name === (g.name || g))?.id ?? null : null;
  T(1, 1, 0, 0, p.merchant, p.amount, card.id, null, { approved_at: p.approvedAt, installment: p.installment || 1, category_id: catId, category_source: catId ? 'suggested' : null, kind: p.kind === 'cancel' ? 'cancel' : 'approval' });
  return new Response(JSON.stringify({ result: 'new' }));
};
window.LEDGER_CONFIG = { SUPABASE_URL: 'https://sample.supabase.co', SUPABASE_ANON_KEY: 'sample-key' };
