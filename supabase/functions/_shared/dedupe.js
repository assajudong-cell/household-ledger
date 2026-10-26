// 새로 들어온 알림이 이미 있는 거래와 같은 결제인지 판정한다.
// candidate: { rawHash, source, issuer, last4, amount, approvedAt, merchant, kind }
//   source: 어느 휴대폰의 어떤 채널에서 왔는지 (예: "husband:sms", "wife:kakao")
// existing: 같은 카드의 최근 거래 목록 (같은 필드 + id, sources[], rawHashes[], canceled)

import { normalizeMerchant } from './parser.js';

export const SAME_PAYMENT_WINDOW_MS = 2 * 60 * 1000;
const CANCEL_LOOKBACK_MS = 60 * 24 * 3600 * 1000;

export function judge(candidate, existing) {
  // 1) 같은 알림이 다시 들어옴
  const exact = existing.find(t => (t.rawHashes || []).includes(candidate.rawHash));
  if (exact) return { action: 'drop', matchId: exact.id, reason: '같은 알림 재전송' };

  const t0 = Date.parse(candidate.approvedAt);
  const sameCard = existing.filter(t => sameCardOf(t, candidate) && t.amount === candidate.amount);

  // 2) 취소: 같은 카드, 같은 금액의 가장 최근 승인 건을 상쇄
  if (candidate.kind === 'cancel') {
    const target = sameCard
      .filter(t => t.kind === 'approval' && !t.canceled)
      .filter(t => { const d = t0 - Date.parse(t.approvedAt); return d >= -SAME_PAYMENT_WINDOW_MS && d <= CANCEL_LOOKBACK_MS; })
      .sort((a, b) => Date.parse(b.approvedAt) - Date.parse(a.approvedAt))[0];
    // 취소 알림도 여러 채널로 올 수 있음
    const dupCancel = sameCard.find(t => t.kind === 'cancel' && Math.abs(Date.parse(t.approvedAt) - t0) <= SAME_PAYMENT_WINDOW_MS && !(t.sources || []).includes(candidate.source));
    if (dupCancel) return { action: 'merge', matchId: dupCancel.id, reason: '같은 취소의 다른 알림' };
    if (target) return { action: 'cancel', matchId: target.id, reason: '원거래 취소' };
    return { action: 'review', reason: '취소할 원거래를 찾지 못함' };
  }

  // 3) 같은 카드 + 같은 금액 + 승인 시각 ±2분
  const near = sameCard
    .filter(t => t.kind === 'approval' && Math.abs(Date.parse(t.approvedAt) - t0) <= SAME_PAYMENT_WINDOW_MS)
    .sort((a, b) => Math.abs(Date.parse(a.approvedAt) - t0) - Math.abs(Date.parse(b.approvedAt) - t0));

  for (const t of near) {
    // 다른 채널/다른 사람 휴대폰에서 온 알림이면 같은 결제로 합침
    if (!(t.sources || []).includes(candidate.source)) {
      return { action: 'merge', matchId: t.id, reason: '같은 결제의 다른 알림' };
    }
  }
  if (near.length) {
    // 같은 채널에서 별도 알림이 또 옴: 같은 가게에서 실제로 두 번 결제했을 수도 있으니 사람이 확인
    const m = normalizeMerchant(candidate.merchant);
    const t = near[0];
    const sameShop = !m || !t.merchant || normalizeMerchant(t.merchant).startsWith(m.slice(0, 4)) || m.startsWith(normalizeMerchant(t.merchant).slice(0, 4));
    if (sameShop) return { action: 'suspect', matchId: t.id, reason: '중복 의심' };
  }
  return { action: 'new' };
}

function sameCardOf(a, b) {
  if (a.last4 && b.last4) return lastDigitsMatch(a.last4, b.last4) && (!a.issuer || !b.issuer || a.issuer === b.issuer);
  // 끝자리가 없는 알림은 카드사만 같으면 후보로 봄
  return !!a.issuer && a.issuer === b.issuer;
}

// "1*2*" 처럼 가려진 끝자리도 비교
function lastDigitsMatch(x, y) {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== '*' && y[i] !== '*' && x[i] !== y[i]) return false;
  }
  return true;
}

export async function hashRaw(text) {
  const data = new TextEncoder().encode(String(text).replace(/\s+/g, ' ').trim());
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
