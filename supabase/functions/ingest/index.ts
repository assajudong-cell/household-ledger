// 휴대폰 자동화(MacroDroid)가 카드 알림을 보내는 수집 주소.
// POST https://<project>.supabase.co/functions/v1/ingest?token=<개인 토큰>
// 본문: JSON { text, title?, app?, received_at? } 또는 알림 텍스트 그대로

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { parseCardMessage } from '../_shared/parser.js';
import { judge, hashRaw } from '../_shared/dedupe.js';
import { guessCategory, merchantRuleKey } from '../_shared/classify.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const SMS_APPS = ['com.samsung.android.messaging', 'com.google.android.apps.messaging', 'com.android.mms'];

function sourceOf(app?: string, explicit?: string) {
  if (explicit) return explicit;
  if (!app) return 'sms';
  // MacroDroid는 앱 이름(예: 메시지, 카카오톡) 또는 패키지명을 보냄
  if (SMS_APPS.includes(app) || /메시지|messages/i.test(app)) return 'sms';
  if (app === 'com.kakao.talk' || /카카오톡|kakaotalk/i.test(app)) return 'kakao';
  return 'app';
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST만 받습니다' }, 405);
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || req.headers.get('x-ingest-token');
  if (!token) return json({ error: '토큰이 없습니다' }, 401);

  const { data: member } = await db.from('members').select('user_id, household_id').eq('ingest_token', token).maybeSingle();
  if (!member) return json({ error: '토큰이 맞지 않습니다' }, 401);

  let payload: { text?: string; title?: string; app?: string; source?: string; received_at?: string } = {};
  payload = parsePayload(await req.text());
  const body = [payload.title, payload.text].filter(Boolean).join('\n').trim();
  if (!body) return json({ error: '내용이 비어 있습니다' }, 400);

  return json(await ingest(member, body, sourceOf(payload.app, payload.source), payload.app, payload.received_at));
});

// MacroDroid가 알림 내용을 그대로 끼워 넣으므로 줄바꿈·따옴표 때문에 JSON이 깨질 수 있다
export function parsePayload(text: string) {
  try { const j = JSON.parse(text); if (j && typeof j === 'object') return j; } catch { /* 아래에서 처리 */ }
  const pick = (k: string) => text.match(new RegExp(`"${k}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,\\s*"[a-z_]+"\\s*:|}\\s*$)`))?.[1];
  const t = pick('text');
  if (t != null) return { title: pick('title'), text: t, app: pick('app'), source: pick('source') };
  return { text };
}

export async function ingest(
  member: { user_id: string; household_id: string },
  body: string,
  channel: string,
  app?: string,
  receivedAtIn?: string,
) {
  const hh = member.household_id;
  const receivedAt = receivedAtIn ? new Date(receivedAtIn) : new Date();
  const parsed = parseCardMessage(body, receivedAt) as any;
  if (!parsed.ok && parsed.reason === 'not_card_message') return { result: 'ignored' };

  const rawHash = await hashRaw(body);
  const { data: raw, error: rawErr } = await db.from('raw_messages')
    .insert({ household_id: hh, member_id: member.user_id, source: channel, app_package: app, body, raw_hash: rawHash, received_at: receivedAt.toISOString() })
    .select('id').single();
  if (rawErr) {
    if (rawErr.code === '23505') return { result: 'drop', reason: '같은 알림 재전송' };
    throw rawErr;
  }
  const setRaw = (result: string, transaction_id?: string) =>
    db.from('raw_messages').update({ result, transaction_id }).eq('id', raw.id);

  if (!parsed.ok) { await setRaw('unparsed'); return { result: 'unparsed', reason: parsed.reason }; }

  // 카드: 처음 보는 카드는 자동 등록 (주인은 앱에서 지정)
  let { data: card } = await db.from('cards').select('id').eq('household_id', hh)
    .eq('issuer', parsed.issuer ?? '').eq('last4', parsed.last4 ?? '').maybeSingle();
  if (!card) {
    ({ data: card } = await db.from('cards')
      .upsert({ household_id: hh, issuer: parsed.issuer ?? '', last4: parsed.last4 ?? '' }, { onConflict: 'household_id,issuer,last4' })
      .select('id').single());
  }

  const source = `${member.user_id}:${channel}`;
  const t0 = Date.parse(parsed.approvedAt);
  const { data: recent } = await db.from('transactions')
    .select('id, kind, amount, approved_at, merchant, canceled, sources, raw_hashes, cards(issuer, last4)')
    .eq('household_id', hh)
    .gte('approved_at', new Date(t0 - 61 * 86400e3).toISOString())
    .lte('approved_at', new Date(t0 + 5 * 60e3).toISOString());

  const existing = (recent ?? []).map((t: any) => ({
    id: t.id, kind: t.kind, amount: t.amount, approvedAt: t.approved_at, merchant: t.merchant,
    canceled: t.canceled, sources: t.sources, rawHashes: t.raw_hashes,
    issuer: t.cards?.issuer || null, last4: t.cards?.last4 || null,
  }));
  const verdict = judge({ ...parsed, rawHash, source }, existing);

  if (verdict.action === 'drop') { await setRaw('drop', verdict.matchId); return verdict; }

  if (verdict.action === 'merge') {
    const t = existing.find((e) => e.id === verdict.matchId)!;
    await db.from('transactions').update({
      sources: [...new Set([...(t.sources || []), source])],
      raw_hashes: [...(t.rawHashes || []), rawHash],
      updated_at: new Date().toISOString(),
    }).eq('id', t.id);
    await setRaw('merge', t.id);
    return verdict;
  }

  // 분류
  const [{ data: rules }, { data: cats }] = await Promise.all([
    db.from('merchant_rules').select('merchant_key, categories(name)').eq('household_id', hh),
    db.from('categories').select('id, name').eq('household_id', hh),
  ]);
  const ruleMap: Record<string, string> = {};
  for (const r of rules ?? []) ruleMap[(r as any).merchant_key] = (r as any).categories?.name;
  const guess = guessCategory(parsed.merchant, ruleMap);
  const categoryId = cats?.find((c) => c.name === guess.name)?.id ?? null;

  const row = {
    household_id: hh, card_id: card?.id, kind: parsed.kind, amount: parsed.amount, currency: parsed.currency,
    foreign_amount: parsed.foreignAmount, installment: parsed.installment, approved_at: parsed.approvedAt,
    merchant: parsed.merchant, category_id: categoryId, category_source: guess.source,
    status: verdict.action === 'suspect' ? 'suspect' : verdict.action === 'review' ? 'review' : 'ok',
    suspect_of: verdict.action === 'suspect' ? verdict.matchId : null,
    sources: [source], raw_hashes: [rawHash], created_by: member.user_id,
  };
  const { data: tx, error } = await db.from('transactions').insert(row).select('id').single();
  if (error) throw error;

  if (verdict.action === 'cancel') {
    await db.from('transactions').update({ canceled: true, canceled_by: tx.id, updated_at: new Date().toISOString() }).eq('id', verdict.matchId);
  }
  await setRaw(verdict.action, tx.id);
  return { ...verdict, transactionId: tx.id, category: guess.name, ruleKey: merchantRuleKey(parsed.merchant ?? '') };
}
