import { merchantRuleKey } from './shared/classify.js';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.LEDGER_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const won = (n) => '₩' + Math.round(n || 0).toLocaleString('ko-KR');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = {
  me: null, members: [], cards: [], categories: [], tx: [], hist: [], prevTotal: 0, raws: [], trendSel: null,
  month: { y: 2026, m: 10 }, // 샘플: 2026년 10월
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

const TREND_MONTHS = 6;
const addMonth = ({ y, m }, k) => { const n = y * 12 + (m - 1) + k; return { y: Math.floor(n / 12), m: (n % 12) + 1 }; };
const kstMonth = (iso) => { const d = new Date(new Date(iso).getTime() + 9 * 3600e3); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; };
const sameMonth = (iso, mo) => { const k = kstMonth(iso); return k.y === mo.y && k.m === mo.m; };

function monthRange({ y, m }) {
  // KST 기준 월 경계
  const start = new Date(Date.UTC(y, m - 1, 1, -9));
  const end = new Date(Date.UTC(y, m, 1, -9));
  return [start.toISOString(), end.toISOString()];
}

async function loadMonth() {
  const [from, to] = monthRange(state.month);
  const [hfrom] = monthRange(addMonth(state.month, -(TREND_MONTHS - 1)));
  const [cur, hist, raws] = await Promise.all([
    sb.from('transactions').select('*').gte('approved_at', from).lt('approved_at', to).order('approved_at', { ascending: false }),
    sb.from('transactions').select('amount, kind, canceled, excluded, approved_at, category_id, card_id').gte('approved_at', hfrom).lt('approved_at', from),
    sb.from('raw_messages').select('id, body, received_at, member_id').eq('result', 'unparsed').order('received_at', { ascending: false }).limit(20),
  ]);
  state.tx = cur.data || [];
  state.hist = [...(hist.data || []), ...state.tx];
  const pm = addMonth(state.month, -1);
  state.prevTotal = sum(state.hist.filter((t) => sameMonth(t.approved_at, pm)));
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
  renderCategories();
  renderTrend();
}

function renderInbox() {
  const newCards = state.cards.filter((c) => !c.owner_user_id && !c.nickname);
  const items = [
    ...newCards.map((c) => `<div class="item"><div><b>새 카드 발견: ${esc(c.issuer)} ${esc(c.last4)}</b><div class="small muted">누구 카드인가요?</div></div>
      <div class="chips">${state.members.map((mm) => `<button class="chip" data-owner="${c.id}" data-user="${mm.user_id}">${esc(mm.display_name)}</button>`).join('')}</div></div>`),
    ...state.tx.filter((t) => t.status === 'suspect').map((t) => `<div class="item"><div><span class="pill warn">중복 의심</span> <b>${esc(t.merchant)}</b> ${won(t.amount)}<div class="small muted">${fmtDate(t.approved_at)} · ${esc(cardName(t.card_id))}</div></div>
      <div class="chips"><button class="chip" data-dup="${t.id}" data-act="merge">같은 결제로 합치기</button><button class="chip" data-dup="${t.id}" data-act="keep">별도 결제 맞음</button></div></div>`),
    ...state.tx.filter((t) => t.status === 'review').map((t) => `<div class="item" data-edit="${t.id}"><div><span class="pill bad">확인 필요</span> <b>${esc(t.merchant || '내용 없음')}</b> ${won(t.amount)}<div class="small muted">취소할 원래 결제를 찾지 못했어요. 눌러서 확인</div></div></div>`),
    ...pendingGroups().map(({ key, rows }) => {
      const t = rows[0];
      const extra = rows.length > 1 ? ` 외 ${rows.length - 1}건` : '';
      return `<div class="item"><div><span class="pill ${t.category_id ? 'info' : 'warn'}">${t.category_id ? '분류 제안' : '분류 필요'}</span> <b>${esc(t.merchant)}</b> ${won(t.amount)}${extra}
        <div class="small muted">${fmtDate(t.approved_at)} · ${esc(cardName(t.card_id))}</div></div>
        <div class="approve"><select data-sugcat="${esc(key)}" aria-label="분류">${t.category_id ? '' : '<option value="">분류 선택</option>'}${catOptions(t.category_id)}</select>
        <button class="btn small primary" data-approve="${esc(key)}">승인</button></div></div>`;
    }),
    ...state.raws.map((r) => `<div class="item"><div><span class="pill bad">해석 실패</span><pre class="raw">${esc(r.body)}</pre></div><div class="chips"><button class="chip" data-rawadd="${r.id}">직접 입력</button><button class="chip" data-rawdel="${r.id}">무시</button></div></div>`),
  ];
  const pend = pendingGroups(), sugg = pend.filter((g) => g.rows[0].category_id).length;
  const n = items.length;
  if (pend.length) items.unshift(`<div class="inbox-head"><span class="small">처음 보는 가게는 분류를 제안해 드려요. 고르거나 승인하면 다음부터 그 분류로 자동으로 들어가요.</span>${sugg > 1 ? `<button class="btn small" data-approveall="1">제안 ${sugg}개 모두 승인</button>` : ''}</div>`);
  $('inbox-wrap').hidden = !n;
  $('inbox-count').textContent = n;
  $('inbox').innerHTML = items.join('');
}

// 아직 두 분이 확인하지 않은 분류 (제안 또는 미분류), 같은 가게끼리 묶음
function pendingGroups() {
  const m = new Map();
  for (const t of state.tx) {
    if (!counts(t) || t.status !== 'ok' || !t.merchant) continue;
    if (t.category_id && t.category_source !== 'suggested') continue;
    const key = merchantRuleKey(t.merchant);
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(t);
  }
  return [...m].map(([key, rows]) => ({ key, rows }));
}

const catOptions = (sel) => state.categories.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

async function approve(key, category_id) {
  if (!category_id) return;
  const g = pendingGroups().find((x) => x.key === key);
  for (const t of g?.rows || []) {
    await sb.from('transactions').update({ category_id, category_source: 'user', updated_at: new Date().toISOString() }).eq('id', t.id);
  }
  await sb.from('merchant_rules').upsert({ household_id: state.me.household_id, merchant_key: key, category_id });
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
      <div class="small muted">${fmtDate(t.approved_at)} · ${esc(cardName(t.card_id))} · ${esc(catName(t.category_id))}${t.category_source === 'suggested' ? '(제안)' : ''}${t.installment > 1 ? ` · ${t.installment}개월` : ''}${t.memo ? ' · ' + esc(t.memo) : ''}${t.excluded ? ' · 통계 제외' : ''}</div>
    </div>`).join('') || '<p class="muted small">내역이 없어요.</p>';
}

function renderCategories() {
  const n = new Map();
  for (const t of state.tx.filter(counts)) n.set(t.category_id, (n.get(t.category_id) || 0) + 1);
  $('cat-manage').innerHTML = state.categories.map((c) => `
    <div class="item cat-edit">
      <input data-catname="${c.id}" value="${esc(c.name)}" aria-label="분류 이름">
      <span class="small muted n">이번 달 ${n.get(c.id) || 0}건</span>
      <button class="chip" data-catdel="${c.id}">삭제</button>
    </div>`).join('') || '<p class="muted small">분류가 없어요. 아래에서 추가해 주세요.</p>';
}

const man = (v) => (v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString('ko-KR')}만` : Math.round(v).toLocaleString('ko-KR'));

function ownerOf(t) {
  const c = state.cards.find((x) => x.id === t.card_id);
  return c?.owner_user_id || null;
}

function renderTrend() {
  const months = Array.from({ length: TREND_MONTHS }, (_, i) => addMonth(state.month, i - (TREND_MONTHS - 1)));
  const rows = state.hist.filter(counts);
  const byMonth = months.map((mo) => rows.filter((t) => sameMonth(t.approved_at, mo)));
  const series = [
    ...state.members.map((mm, i) => ({ key: mm.user_id, name: mm.display_name, color: i === 0 ? 'var(--c1)' : 'var(--c3)' })),
    { key: null, name: '현금·주인 미지정', color: 'var(--c6)' },
  ];
  const stacks = byMonth.map((rs) => series.map((s) => rs.filter((t) => ownerOf(t) === s.key).reduce((a, t) => a + Number(t.amount), 0)));
  const totals = stacks.map((st) => st.reduce((a, b) => a + b, 0));
  const used = series.filter((_, si) => stacks.some((st) => st[si] > 0));
  $('trend-range').textContent = `${months[0].m}월 ~ ${months[months.length - 1].m}월`;
  $('trend-legend').innerHTML = used.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
  const filledAvg = totals.slice(0, -1).filter((v) => v > 0);
  if (filledAvg.length) $('trend-legend').innerHTML += `<span><i class="dash"></i>이전 ${filledAvg.length}개월 평균 ${man(filledAvg.reduce((a, b) => a + b, 0) / filledAvg.length)}</span>`;

  // 막대 그래프 (y축 하나, 만원 단위)
  const W = 360, H = 190, L = 34, B = 22, T = 18, cw = (W - L) / months.length, bw = Math.min(30, cw * 0.55);
  const step = niceStep(Math.max(1, ...totals) / 3);
  const top = step * Math.max(1, Math.ceil(Math.max(1, ...totals) / step));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const filled = totals.filter((v, i) => v > 0 && i < months.length - 1);
  const avg = filled.length ? filled.reduce((a, b) => a + b, 0) / filled.length : 0;
  if (state.trendSel == null) state.trendSel = months.length - 1;
  let g = '';
  for (let k = 0; k <= top / step; k++) g += `<line class="grid" x1="${L}" x2="${W}" y1="${y(k * step)}" y2="${y(k * step)}"/><text x="${L - 4}" y="${y(k * step) + 3}" text-anchor="end">${man(k * step)}</text>`;
  months.forEach((mo, i) => {
    const cx = L + cw * i + cw / 2;
    let acc = 0, segs = '';
    series.forEach((s, si) => {
      const v = stacks[i][si]; if (!v) return;
      const y1 = y(acc + v), y0 = y(acc);
      segs += `<rect x="${cx - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1 - (acc ? 2 : 0))}" rx="3" fill="${s.color}"><title>${mo.m}월 ${esc(s.name)} ${won(v)}</title></rect>`;
      acc += v;
    });
    const sel = i === state.trendSel ? ' sel' : '';
    g += `<g class="col${sel}" data-trend="${i}"><rect class="hit" x="${cx - cw / 2 + 2}" y="${T - 14}" width="${cw - 4}" height="${H - T + 14}" rx="6"/>${segs}
      ${totals[i] ? `<text x="${cx}" y="${y(totals[i]) - 5}" text-anchor="middle" class="${sel.trim()}">${man(totals[i])}</text>` : ''}
      <text x="${cx}" y="${H - 6}" text-anchor="middle" class="${sel.trim()}">${mo.m}월</text></g>`;
  });
  if (avg) g += `<line class="avg" x1="${L}" x2="${W}" y1="${y(avg)}" y2="${y(avg)}"><title>평균 ${won(avg)}</title></line>`;
  $('trend-total').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 ${months.length}개월 월별 지출">${g}</svg>`;

  const si = state.trendSel, mo = months[si];
  const prevT = si > 0 ? totals[si - 1] : 0;
  $('trend-detail').innerHTML = `<b>${mo.y}년 ${mo.m}월 ${won(totals[si])}</b>` +
    (prevT ? ` · 전달보다 ${won(Math.abs(totals[si] - prevT))} ${totals[si] >= prevT ? '많음' : '적음'}` : '') +
    `<br>${used.map((s) => `${esc(s.name)} ${won(stacks[si][series.indexOf(s)])}`).join(' · ')}`;

  // 분류별 미니 막대 + 이번 달 vs 앞선 3개월 평균
  const last = months.length - 1;
  const catRows = [...state.categories.map((c) => c.id), null].map((cid) => {
    const vals = byMonth.map((rs) => rs.filter((t) => (t.category_id || null) === cid).reduce((a, t) => a + Number(t.amount), 0));
    const base = vals.slice(last - 3, last).filter((v) => v > 0);
    const avg3 = base.length ? base.reduce((a, b) => a + b, 0) / base.length : 0;
    return { cid, vals, now: vals[last], avg3 };
  }).filter((r) => r.vals.some((v) => v > 0)).sort((a, b) => b.now - a.now || b.avg3 - a.avg3);
  $('trend-cats').innerHTML = catRows.map((r) => {
    const mx = Math.max(...r.vals, 1);
    const bars = r.vals.map((v, i) => { const h = Math.max(v ? 2 : 0, (v / mx) * 20); return `<rect class="${i === last ? 'now' : ''}" x="${i * 11}" y="${22 - h}" width="8" height="${h}" rx="2"><title>${months[i].m}월 ${won(v)}</title></rect>`; }).join('');
    const pct = r.avg3 ? Math.round(((r.now - r.avg3) / r.avg3) * 100) : null;
    const chg = pct == null ? '새로 생김' : !r.now ? '이번 달 없음' : pct === 0 ? '비슷함' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%`;
    return `<div class="item trend-row" data-gocat="${r.cid ?? 'none'}"><span class="lbl">${esc(r.cid ? catName(r.cid) : '분류 필요')}</span>
      <svg class="spark" viewBox="0 0 66 22" width="66" height="22" aria-hidden="true">${bars}</svg>
      <span class="val">${won(r.now)}</span><span class="chg">${chg}</span></div>`;
  }).join('') || '<p class="muted small">아직 쌓인 내역이 없어요.</p>';
}

function niceStep(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= v);
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
  const b = e.target.closest('button, .item[data-edit], .item[data-gocat], g[data-trend]');
  if (!b) return;
  const d = b.dataset;
  if (d.tab) {
    showTab(d.tab);
  } else if (d.trend != null) {
    state.trendSel = Number(d.trend); renderTrend();
  } else if (d.gocat) {
    $('f-card').value = ''; $('f-cat').value = d.gocat; renderList(); showTab('list');
  } else if (d.approve) {
    const sel = [...document.querySelectorAll('[data-sugcat]')].find((x) => x.dataset.sugcat === d.approve);
    await approve(d.approve, sel?.value); loadMonth();
  } else if (d.approveall) {
    for (const g of pendingGroups().filter((x) => x.rows[0].category_id)) {
      const sel = [...document.querySelectorAll('[data-sugcat]')].find((x) => x.dataset.sugcat === g.key);
      await approve(g.key, sel?.value || g.rows[0].category_id);
    }
    loadMonth();
  } else if (d.catdel) {
    if (!d.armed) { b.dataset.armed = '1'; b.textContent = '한 번 더'; return; }
    await sb.from('categories').delete().eq('id', d.catdel);
    await loadStatic(); loadMonth();
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
  if (d.catname) { const name = e.target.value.trim(); if (name) await sb.from('categories').update({ name }).eq('id', d.catname); }
  else if (d.sugcat != null) return;
  else if (d.cardowner) await sb.from('cards').update({ owner_user_id: e.target.value || null }).eq('id', d.cardowner);
  else if (d.cardnick) await sb.from('cards').update({ nickname: e.target.value.trim() || null }).eq('id', d.cardnick);
  else if (e.target.id === 'f-card' || e.target.id === 'f-cat') return renderList();
  else return;
  await loadStatic(); render();
});

$('prev-month').onclick = () => { const s = state.month; state.month = s.m === 1 ? { y: s.y - 1, m: 12 } : { y: s.y, m: s.m - 1 }; state.trendSel = null; loadMonth(); };
$('next-month').onclick = () => { const s = state.month; state.month = s.m === 12 ? { y: s.y + 1, m: 1 } : { y: s.y, m: s.m + 1 }; state.trendSel = null; loadMonth(); };

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

$('btn-add-cat').onclick = async () => {
  const name = $('new-cat').value.trim();
  if (!name) { $('new-cat').focus(); return; }
  const sort = Math.max(0, ...state.categories.map((c) => c.sort || 0)) + 1;
  await sb.from('categories').insert({ household_id: state.me.household_id, name, sort });
  $('new-cat').value = '';
  await loadStatic(); render();
};

function showTab(tab) {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  for (const t of ['home', 'list', 'trend', 'settings']) $('tab-' + t).hidden = t !== tab;
  scrollTo(0, 0);
}

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

