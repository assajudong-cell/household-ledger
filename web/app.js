import { merchantRuleKey } from './shared/classify.js';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.LEDGER_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const won = (n) => '₩' + Math.round(n || 0).toLocaleString('ko-KR');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = {
  me: null, members: [], cards: [], categories: [], tx: [], prevTotal: 0, raws: [],
  month: (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; })(),
  editing: null,
};

function show(view) {
  for (const v of ['login', 'onboard', 'main']) $('view-' + v).hidden = v !== view;
}

// ---------- 로그인 ----------
// 이메일로 받은 링크를 누르면 로그인 (구글 클라우드 설정 없이 바로 쓸 수 있음)
$('btn-login').onclick = async () => {
  const email = $('login-email').value.trim();
  if (!email) { $('login-email').focus(); return; }
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split('#')[0] } });
  $('login-msg').textContent = error ? error.message : `${email} 로 로그인 링크를 보냈어요. 메일의 링크를 이 휴대폰에서 눌러 주세요.`;
  $('login-msg').hidden = false;
};
$('btn-logout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

$('btn-onboard').onclick = async () => {
  const name = $('ob-name').value.trim();
  if (!name) { $('ob-name').focus(); return; }
  const { error } = await sb.rpc('join_or_create_household', { p_name: name, p_invite: $('ob-invite').value.trim() || null });
  if (error) { $('ob-error').textContent = error.message; $('ob-error').hidden = false; return; }
  boot();
};

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return show('login');
  const { data: me } = await sb.from('members').select('*').eq('user_id', session.user.id).maybeSingle();
  if (!me) return show('onboard');
  state.me = me;
  show('main');
  await loadStatic();
  await loadMonth();
  sb.channel('ledger')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => loadMonth())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, async () => { await loadStatic(); render(); })
    .subscribe();
}

async function loadStatic() {
  const [m, c, k, inv] = await Promise.all([
    sb.from('members').select('user_id, display_name'),
    sb.from('cards').select('*').order('created_at'),
    sb.from('categories').select('*').order('sort'),
    sb.from('invites').select('code').limit(1).maybeSingle(),
  ]);
  state.members = m.data || [];
  state.cards = c.data || [];
  state.categories = k.data || [];
  $('invite-code').textContent = inv.data?.code || '';
  $('ingest-url').textContent = `${SUPABASE_URL}/functions/v1/ingest?token=${state.me.ingest_token}`;
  $('ingest-auth').textContent = `Bearer ${SUPABASE_ANON_KEY}`;
}

function monthRange({ y, m }) {
  // KST 기준 월 경계
  const start = new Date(Date.UTC(y, m - 1, 1, -9));
  const end = new Date(Date.UTC(y, m, 1, -9));
  return [start.toISOString(), end.toISOString()];
}

async function loadMonth() {
  const [from, to] = monthRange(state.month);
  const pm = state.month.m === 1 ? { y: state.month.y - 1, m: 12 } : { y: state.month.y, m: state.month.m - 1 };
  const [pfrom, pto] = monthRange(pm);
  const [cur, prev, raws] = await Promise.all([
    sb.from('transactions').select('*').gte('approved_at', from).lt('approved_at', to).order('approved_at', { ascending: false }),
    sb.from('transactions').select('amount, kind, canceled, excluded').gte('approved_at', pfrom).lt('approved_at', pto),
    sb.from('raw_messages').select('id, body, received_at, member_id').eq('result', 'unparsed').order('received_at', { ascending: false }).limit(20),
  ]);
  state.tx = cur.data || [];
  state.prevTotal = sum(prev.data || []);
  state.raws = raws.data || [];
  render();
}

const counts = (t) => t.kind !== 'cancel' && !t.canceled && !t.excluded && t.amount != null;
const sum = (rows) => rows.filter(counts).reduce((a, t) => a + Number(t.amount), 0);

// ---------- 화면 ----------
const cardName = (id) => {
  const c = state.cards.find((x) => x.id === id);
  if (!c) return '현금·이체';
  if (c.nickname) return c.nickname;
  const owner = state.members.find((m) => m.user_id === c.owner_user_id)?.display_name;
  return `${c.issuer || '카드'} ${c.last4 || ''}${owner ? ' · ' + owner : ''}`.trim();
};
const catName = (id) => state.categories.find((c) => c.id === id)?.name || '분류 필요';

function bars(el, groups) {
  const max = Math.max(1, ...groups.map((g) => g.v));
  el.innerHTML = groups.length ? groups.map((g, i) => `
    <div class="bar-row">
      <span class="lbl">${esc(g.k)}</span>
      <span class="track"><i style="width:${(g.v / max) * 100}%;background:var(--c${(i % 6) + 1})"></i></span>
      <span class="val">${won(g.v)}</span>
    </div>`).join('') : '<p class="muted small">이번 달 내역이 아직 없어요.</p>';
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const t of rows.filter(counts)) m.set(keyFn(t), (m.get(keyFn(t)) || 0) + Number(t.amount));
  return [...m].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
}

function render() {
  const { y, m } = state.month;
  $('month-label').textContent = `${y}년 ${m}월`;
  const total = sum(state.tx);
  $('total').textContent = won(total);
  const diff = total - state.prevTotal;
  $('total-diff').textContent = state.prevTotal ? `지난달보다 ${won(Math.abs(diff))} ${diff >= 0 ? '많음' : '적음'}` : '';

  bars($('by-card'), groupBy(state.tx, (t) => cardName(t.card_id)));
  bars($('by-cat'), groupBy(state.tx, (t) => catName(t.category_id)));
  renderInbox();
  renderList();
  renderCards();
}

function renderInbox() {
  const newCards = state.cards.filter((c) => !c.owner_user_id && !c.nickname);
  const items = [
    ...newCards.map((c) => `<div class="item"><div><b>새 카드 발견: ${esc(c.issuer)} ${esc(c.last4)}</b><div class="small muted">누구 카드인가요?</div></div>
      <div class="chips">${state.members.map((mm) => `<button class="chip" data-owner="${c.id}" data-user="${mm.user_id}">${esc(mm.display_name)}</button>`).join('')}</div></div>`),
    ...state.tx.filter((t) => t.status === 'suspect').map((t) => `<div class="item"><div><span class="pill warn">중복 의심</span> <b>${esc(t.merchant)}</b> ${won(t.amount)}<div class="small muted">${fmtDate(t.approved_at)} · ${esc(cardName(t.card_id))}</div></div>
      <div class="chips"><button class="chip" data-dup="${t.id}" data-act="merge">같은 결제로 합치기</button><button class="chip" data-dup="${t.id}" data-act="keep">별도 결제 맞음</button></div></div>`),
    ...state.tx.filter((t) => t.status === 'review').map((t) => `<div class="item" data-edit="${t.id}"><div><span class="pill bad">확인 필요</span> <b>${esc(t.merchant || '내용 없음')}</b> ${won(t.amount)}<div class="small muted">취소할 원래 결제를 찾지 못했어요. 눌러서 확인</div></div></div>`),
    ...state.tx.filter((t) => counts(t) && !t.category_id).map((t) => `<div class="item" data-edit="${t.id}"><div><span class="pill warn">분류 필요</span> <b>${esc(t.merchant)}</b> ${won(t.amount)}<div class="small muted">${fmtDate(t.approved_at)} · ${esc(cardName(t.card_id))}</div></div></div>`),
    ...state.raws.map((r) => `<div class="item"><div><span class="pill bad">해석 실패</span><pre class="raw">${esc(r.body)}</pre></div><div class="chips"><button class="chip" data-rawadd="${r.id}">직접 입력</button><button class="chip" data-rawdel="${r.id}">무시</button></div></div>`),
  ];
  $('inbox-wrap').hidden = !items.length;
  $('inbox-count').textContent = items.length;
  $('inbox').innerHTML = items.join('');
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
}

function renderList() {
  const fc = $('f-card').value, fk = $('f-cat').value;
  $('f-card').innerHTML = `<option value="">모든 카드</option>${state.cards.map((c) => `<option value="${c.id}">${esc(cardName(c.id))}</option>`).join('')}<option value="none">현금·이체</option>`;
  $('f-cat').innerHTML = `<option value="">모든 카테고리</option>${state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}<option value="none">분류 필요</option>`;
  $('f-card').value = fc; $('f-cat').value = fk;
  const rows = state.tx.filter((t) =>
    (!fc || (fc === 'none' ? !t.card_id : t.card_id === fc)) &&
    (!fk || (fk === 'none' ? !t.category_id : t.category_id === fk)));
  $('tx-list').innerHTML = rows.map((t) => `
    <div class="item tx ${t.canceled || t.kind === 'cancel' ? 'struck' : ''}" data-edit="${t.id}">
      <div class="tx-main"><b>${esc(t.merchant || '내용 없음')}</b><span class="amt">${t.kind === 'cancel' ? '−' : ''}${t.amount != null ? won(t.amount) : esc(t.currency + ' ' + t.foreign_amount)}</span></div>
      <div class="small muted">${fmtDate(t.approved_at)} · ${esc(cardName(t.card_id))} · ${esc(catName(t.category_id))}${t.installment > 1 ? ` · ${t.installment}개월` : ''}${t.memo ? ' · ' + esc(t.memo) : ''}${t.excluded ? ' · 통계 제외' : ''}</div>
    </div>`).join('') || '<p class="muted small">내역이 없어요.</p>';
}

function renderCards() {
  $('cards').innerHTML = state.cards.map((c) => `
    <div class="item card-edit">
      <div><b>${esc(c.issuer || '카드')} ${esc(c.last4 || '')}</b></div>
      <select data-cardowner="${c.id}" aria-label="카드 주인"><option value="">주인 미지정</option>${state.members.map((m) => `<option value="${m.user_id}" ${m.user_id === c.owner_user_id ? 'selected' : ''}>${esc(m.display_name)}</option>`).join('')}</select>
      <input data-cardnick="${c.id}" value="${esc(c.nickname || '')}" placeholder="별명 (예: 생활비카드)" aria-label="카드 별명">
    </div>`).join('') || '<p class="muted small">아직 들어온 카드 알림이 없어요.</p>';
}

// ---------- 동작 ----------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button, .item[data-edit]');
  if (!b) return;
  const d = b.dataset;
  if (d.tab) {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    for (const t of ['home', 'list', 'settings']) $('tab-' + t).hidden = t !== d.tab;
  } else if (d.owner) {
    await sb.from('cards').update({ owner_user_id: d.user }).eq('id', d.owner);
    await loadStatic(); render();
  } else if (d.dup) {
    const t = state.tx.find((x) => x.id === d.dup);
    if (d.act === 'merge') {
      const orig = state.tx.find((x) => x.id === t.suspect_of);
      if (orig) await sb.from('transactions').update({ raw_hashes: [...orig.raw_hashes, ...t.raw_hashes] }).eq('id', orig.id);
      await sb.from('transactions').delete().eq('id', t.id);
    } else {
      await sb.from('transactions').update({ status: 'ok', suspect_of: null }).eq('id', t.id);
    }
    loadMonth();
  } else if (d.rawdel) {
    await sb.from('raw_messages').update({ result: 'ignored' }).eq('id', d.rawdel);
    loadMonth();
  } else if (d.rawadd) {
    const r = state.raws.find((x) => x.id === d.rawadd);
    openEditor(null, { merchant: '', memo: r.body.slice(0, 60) }, r.id);
  } else if (d.edit) {
    openEditor(state.tx.find((x) => x.id === d.edit));
  } else if (d.copy) {
    const text = $(d.copy).textContent;
    try { await navigator.clipboard.writeText(text); b.textContent = '복사됨'; setTimeout(() => (b.textContent = '복사'), 1500); }
    catch { getSelection().selectAllChildren($(d.copy)); }
  }
});

document.addEventListener('change', async (e) => {
  const d = e.target.dataset;
  if (d.cardowner) await sb.from('cards').update({ owner_user_id: e.target.value || null }).eq('id', d.cardowner);
  else if (d.cardnick) await sb.from('cards').update({ nickname: e.target.value.trim() || null }).eq('id', d.cardnick);
  else if (e.target.id === 'f-card' || e.target.id === 'f-cat') return renderList();
  else return;
  await loadStatic(); render();
});

$('prev-month').onclick = () => { const s = state.month; state.month = s.m === 1 ? { y: s.y - 1, m: 12 } : { y: s.y, m: s.m - 1 }; loadMonth(); };
$('next-month').onclick = () => { const s = state.month; state.month = s.m === 12 ? { y: s.y + 1, m: 1 } : { y: s.y, m: s.m + 1 }; loadMonth(); };

$('btn-paste').onclick = async () => {
  const text = $('paste').value.trim();
  if (!text) return;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ingest?token=${state.me.ingest_token}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SUPABASE_ANON_KEY}` }, body: JSON.stringify({ text, source: 'paste' }),
  }).then((r) => r.json()).catch(() => ({ error: '서버에 연결하지 못했어요' }));
  const msg = { new: '등록했어요', merge: '이미 있는 결제라 합쳤어요', drop: '이미 등록된 알림이에요', suspect: '중복 의심으로 등록했어요. 홈에서 확인해 주세요', cancel: '원래 결제를 취소 처리했어요', review: '확인 필요로 등록했어요', unparsed: '형식을 읽지 못해 확인 필요에 넣었어요', ignored: '카드 결제 문자가 아닌 것 같아요' };
  $('paste-result').textContent = res.error || msg[res.action || res.result] || '처리했어요';
  $('paste-result').hidden = false;
  $('paste').value = '';
  loadMonth();
};

$('btn-add').onclick = () => openEditor(null);

// ---------- 편집 ----------
function toLocalInput(iso) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600e3);
  return d.toISOString().slice(0, 16);
}

function openEditor(t, preset = {}, rawId = null) {
  state.editing = { t, rawId };
  $('dlg-title').textContent = t ? '거래 수정' : '직접 추가';
  $('tx-merchant').value = t?.merchant ?? preset.merchant ?? '';
  $('tx-amount').value = t?.amount ?? '';
  $('tx-date').value = toLocalInput(t?.approved_at ?? new Date().toISOString());
  $('tx-cat').innerHTML = `<option value="">분류 필요</option>${state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}`;
  $('tx-cat').value = t?.category_id ?? '';
  $('tx-memo').value = t?.memo ?? preset.memo ?? '';
  $('tx-excluded').checked = !!t?.excluded;
  $('tx-remember').checked = true;
  $('tx-delete').hidden = !t;
  $('dlg-tx').showModal();
}

$('tx-delete').onclick = async () => {
  const { t } = state.editing;
  if (!$('tx-delete').dataset.armed) { $('tx-delete').dataset.armed = '1'; $('tx-delete').textContent = '한 번 더 누르면 삭제'; return; }
  delete $('tx-delete').dataset.armed; $('tx-delete').textContent = '삭제';
  await sb.from('transactions').delete().eq('id', t.id);
  $('dlg-tx').close(); loadMonth();
};

$('dlg-tx').addEventListener('close', async () => {
  delete $('tx-delete').dataset.armed; $('tx-delete').textContent = '삭제';
  if ($('dlg-tx').returnValue !== 'save') return;
  const { t, rawId } = state.editing;
  const merchant = $('tx-merchant').value.trim();
  const category_id = $('tx-cat').value || null;
  const kstLocal = $('tx-date').value; // KST 입력으로 간주
  const row = {
    merchant, amount: Number($('tx-amount').value), category_id, category_source: category_id ? 'user' : null,
    approved_at: new Date(kstLocal + ':00+09:00').toISOString(), memo: $('tx-memo').value.trim() || null,
    excluded: $('tx-excluded').checked, status: 'ok', updated_at: new Date().toISOString(),
  };
  if (t) await sb.from('transactions').update(row).eq('id', t.id);
  else {
    const { data } = await sb.from('transactions').insert({ ...row, household_id: state.me.household_id, kind: 'manual', created_by: state.me.user_id }).select('id').single();
    if (rawId && data) await sb.from('raw_messages').update({ result: 'manual', transaction_id: data.id }).eq('id', rawId);
  }
  // 한 번 고친 가맹점은 다음부터 자동 분류
  if (category_id && merchant && $('tx-remember').checked) {
    await sb.from('merchant_rules').upsert({ household_id: state.me.household_id, merchant_key: merchantRuleKey(merchant), category_id });
  }
  loadMonth();
});

sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' && !state.me) boot(); });
boot();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
