const TYPES = { bug: '오류 제보', improvement: '개선 제안', etc: '기타' };
const STATUSES = { open: '접수됨', reviewing: '확인 중', done: '반영 완료' };

export function initVoc({ config, onNavigate }) {
  const $ = selector => document.querySelector(selector);
  const button = $('#vocButton'), panel = $('#vocPanel'), form = $('#vocForm');
  const list = $('#vocList'), message = $('#vocMessage'), feedback = $('#vocFeedback');
  const typeFilter = $('#vocTypeFilter'), statusFilter = $('#vocStatusFilter');
  const valid = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config?.url || '') && Boolean(config?.anonKey);
  let entries = [], loading = false;
  const endpoint = valid ? `${config.url.replace(/\/$/, '')}/rest/v1/voc` : '';
  const headers = valid ? { apikey: config.anonKey } : {};

  function setPanel(open) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) $('#vocContent').focus();
  }
  button.addEventListener('click', () => setPanel(panel.hidden));
  $('#vocClose').addEventListener('click', () => setPanel(false));
  $('#vocBoardLink').addEventListener('click', event => { event.preventDefault(); setPanel(false); onNavigate('voc'); });
  try { $('#vocAuthor').value = localStorage.getItem('textkit.vocAuthor') || ''; } catch {}

  function render() {
    list.replaceChildren();
    const filtered = entries.filter(item => (typeFilter.value === 'all' || item.type === typeFilter.value) && (statusFilter.value === 'all' || item.status === statusFilter.value));
    if (!filtered.length) { message.textContent = entries.length ? '선택한 조건의 제보가 없습니다.' : '아직 등록된 제보가 없습니다.'; message.hidden = false; return; }
    message.hidden = true;
    for (const item of filtered) {
      const card = document.createElement('article'); card.className = 'voc-card';
      const head = document.createElement('div'); head.className = 'voc-card-head';
      const badge = document.createElement('span'); badge.className = 'voc-type'; badge.textContent = TYPES[item.type] || TYPES.etc;
      const date = document.createElement('time'); date.dateTime = item.created_at;
      date.textContent = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(item.created_at));
      head.append(badge, date);
      const content = document.createElement('p'); content.className = 'voc-content'; content.textContent = item.content;
      const meta = document.createElement('div'); meta.className = 'voc-meta'; meta.textContent = `${item.author} · ${STATUSES[item.status] || STATUSES.open}`;
      card.append(head, content, meta); list.append(card);
    }
  }
  async function load() {
    if (loading) return;
    if (!valid) { message.hidden = false; message.textContent = 'VOC 저장소 연결을 준비 중입니다.'; return; }
    loading = true; message.hidden = false; message.textContent = '제보를 불러오는 중입니다.';
    try {
      const response = await fetch(`${endpoint}?select=id,type,content,author,status,created_at&order=created_at.desc,id.desc&limit=200`, { headers, cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      entries = await response.json(); render();
    } catch { message.textContent = '제보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'; }
    finally { loading = false; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!valid) { feedback.textContent = 'VOC 저장소 연결을 준비 중입니다.'; return; }
    const content = $('#vocContent').value.trim(), author = $('#vocAuthor').value.trim(), type = $('#vocType').value;
    if (!content || !author || !TYPES[type]) return;
    const submit = $('#vocSubmit'); submit.disabled = true; feedback.textContent = '전송 중입니다.';
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ type, content, author }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const [created] = await response.json();
      if (!created?.id) throw new Error('Missing saved record');
      try { localStorage.setItem('textkit.vocAuthor', author); } catch {}
      $('#vocContent').value = ''; feedback.textContent = '제보가 등록되었습니다.';
      entries.unshift(created); render();
    } catch { feedback.textContent = '등록하지 못했습니다. 잠시 후 다시 시도해 주세요.'; }
    finally { submit.disabled = false; }
  });
  typeFilter.addEventListener('change', render); statusFilter.addEventListener('change', render);
  return { load, setPanel };
}
