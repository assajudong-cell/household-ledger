// 카드 승인 문자/앱 알림/카톡 알림톡 한 건을 거래 정보로 해석한다.
// 브라우저(붙여넣기 입력), Supabase Edge Function(Deno), Node 테스트에서 같이 쓴다.

const ISSUERS = [
  ['KB국민', /KB\s*국민|국민카드|KB카드/],
  ['신한', /신한/],
  ['삼성', /삼성/],
  ['현대', /현대카드|현대/],
  ['롯데', /롯데/],
  ['하나', /하나/],
  ['우리', /우리/],
  ['NH농협', /NH|농협/],
  ['BC', /BC|비씨/],
  ['IBK기업', /IBK|기업/],
  ['카카오뱅크', /카카오뱅크/],
  ['토스뱅크', /토스뱅크/],
  ['씨티', /씨티/],
];

const NOISE_LINE = /^(\[Web발신\]|\[국외발신\]|누적|잔액|이용한도|한도|승인번호|결제|카드|금액|일시|가맹점|https?:)/;

export function parseCardMessage(text, receivedAt = new Date()) {
  const raw = String(text || '').replace(/\r/g, '').trim();
  if (!raw) return { ok: false, reason: 'empty' };

  const isCancel = /승인\s*취소|취소\s*승인|결제\s*취소|취소/.test(raw);
  if (!isCancel && !/승인|결제|사용/.test(raw)) return { ok: false, reason: 'not_card_message' };

  // 카드사 이름은 금액 앞쪽에 나오므로 가맹점명(롯데마트, 현대백화점 등)에 속지 않게 앞부분만 본다
  const firstAmount = raw.search(/[\d,]+\s*원/);
  const head = firstAmount > 0 ? raw.slice(0, firstAmount) : raw.split('\n').slice(0, 2).join('\n');
  const issuer = (ISSUERS.find(([, re]) => re.test(head)) || [null])[0];

  // 끝자리: "(1234)", "1234승인", "본인(5678)", "1*2*"
  const last4m = raw.match(/\((\d[\d*]{3})\)/) || raw.match(/(?:카드|국민|신한|삼성|현대|롯데|하나|우리|농협|BC|체크)\s*(\d[\d*]{3})(?!\d)/) || raw.match(/(?<![\d,])(\d{4})(?=\s*(?:승인|취소))/);
  const last4 = last4m ? last4m[1] : null;

  // 금액: 누적/잔액/한도 뒤의 금액은 제외
  let amount = null;
  for (const m of raw.matchAll(/([\d,]+)\s*원/g)) {
    const before = raw.slice(Math.max(0, m.index - 6), m.index);
    if (/누적|잔액|한도|포인트/.test(before)) continue;
    amount = Number(m[1].replace(/,/g, ''));
    if (amount > 0) break;
  }

  // 해외 승인
  let currency = 'KRW';
  let foreignAmount = null;
  const fx = raw.match(/(USD|EUR|JPY|CNY|GBP|\$)\s*([\d,]+(?:\.\d+)?)/) || raw.match(/([\d,]+(?:\.\d+)?)\s*(USD|EUR|JPY|CNY|GBP)/);
  if (fx && amount == null) {
    const [a, b] = /^[\d,.]+$/.test(fx[1]) ? [fx[2], fx[1]] : [fx[1], fx[2]];
    currency = a === '$' ? 'USD' : a;
    foreignAmount = Number(b.replace(/,/g, ''));
  }
  if (amount == null && foreignAmount == null) return { ok: false, reason: 'no_amount' };

  const instM = raw.match(/(\d{1,2})\s*개월/);
  const installment = instM ? Number(instM[1]) : 1;

  // 승인 일시 MM/DD HH:mm (연도는 수신 시각 기준, 연말·연초 넘어가는 경우 보정)
  const recv = new Date(receivedAt);
  let approvedAt = recv;
  const dt = raw.match(/(\d{1,2})[\/.-](\d{1,2})\s*(\d{1,2}):(\d{2})/);
  if (dt) {
    let year = kstYear(recv);
    const month = Number(dt[1]);
    if (month === 12 && kstMonth(recv) === 1) year -= 1;
    approvedAt = kstToDate(year, month, Number(dt[2]), Number(dt[3]), Number(dt[4]));
  }

  const merchant = extractMerchant(raw, dt);

  return {
    ok: true,
    kind: isCancel ? 'cancel' : 'approval',
    issuer,
    last4,
    amount,
    currency,
    foreignAmount,
    installment,
    approvedAt: approvedAt.toISOString(),
    merchant,
  };
}

function extractMerchant(raw, dt) {
  // 1) "가맹점 이마트 성수점" 형식
  const labeled = raw.match(/가맹점\s*[:：]?\s*(.+)/);
  if (labeled) return clean(labeled[1]);
  // 2) 일시와 같은 줄, 일시 뒤 텍스트
  if (dt) {
    const after = raw.slice(dt.index + dt[0].length).split('\n')[0];
    const c = clean(after);
    if (c) return c;
    // 3) 일시 다음 줄
    const nextLines = raw.slice(dt.index + dt[0].length).split('\n').slice(1);
    for (const line of nextLines) {
      const t = line.trim();
      if (t && !NOISE_LINE.test(t) && !/[\d,]+\s*원/.test(t)) return clean(t);
    }
  }
  return null;
}

function clean(s) {
  return s.replace(/누적.*$/, '').replace(/[\d,]+\s*원.*$/, '').trim() || null;
}

// 가맹점 이름 비교용 정규화: 공백, 법인 표기, 기호 제거
export function normalizeMerchant(name) {
  if (!name) return '';
  return name
    .replace(/\(주\)|㈜|주식회사|\(유\)/g, '')
    .replace(/[\s\-_.·()]/g, '')
    .toLowerCase();
}

// KST(UTC+9) 기준 날짜 계산
function kstYear(d) { return new Date(d.getTime() + 9 * 3600e3).getUTCFullYear(); }
function kstMonth(d) { return new Date(d.getTime() + 9 * 3600e3).getUTCMonth() + 1; }
function kstToDate(y, mo, da, h, mi) { return new Date(Date.UTC(y, mo - 1, da, h - 9, mi)); }
