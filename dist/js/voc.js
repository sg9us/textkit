const TYPES = { bug: '오류 제보', improvement: '개선 제안', etc: '기타' };
const STATUSES = { open: '접수됨', reviewing: '확인 중', done: '반영 완료' };
const ADJECTIVES = ['수줍은', '용감한', '졸린', '엉뚱한', '다정한', '느긋한', '명랑한', '차분한', '씩씩한', '포근한', '반짝이는', '호기심 많은'];
const NOUNS = ['감자', '고양이', '문어', '토끼', '수달', '판다', '참새', '여우', '해달', '두더지', '펭귄', '다람쥐'];

export function generateRandomNickname(random = Math.random) {
  const pick = values => values[Math.min(values.length - 1, Math.max(0, Math.floor(random() * values.length)))];
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}

export function initVoc({ config, onNavigate }) {
  const $ = selector => document.querySelector(selector);
  const button = $('#vocButton'), panel = $('#vocPanel'), form = $('#vocForm');
  const list = $('#vocList'), message = $('#vocMessage'), feedback = $('#vocFeedback');
  const typeFilter = $('#vocTypeFilter'), statusFilter = $('#vocStatusFilter');
  const nicknameInput = $('#vocNickname'), nicknameEdit = $('#vocNicknameEdit');
  const valid = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec(?:\?.*)?$/.test(config?.webAppUrl || '');
  let entries = [], loading = false;
  let bridgeSource = null, bridgeOrigin = '', nextId = 0;
  const pending = new Map();
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  if (valid) {
    const frame = document.createElement('iframe');
    frame.title = 'VOC 저장소 연결'; frame.hidden = true;
    frame.src = config.webAppUrl; document.body.append(frame);
    window.addEventListener('message', event => {
      const originAllowed = event.origin === 'https://script.google.com' || event.origin === 'https://script.googleusercontent.com' || /^https:\/\/[a-z0-9-]+\.googleusercontent\.com$/.test(event.origin);
      if (!originAllowed || event.data?.source !== 'textkit-voc-bridge') return;
      if (event.data.kind === 'ready') { bridgeSource = event.source; bridgeOrigin = event.origin; readyResolve(); return; }
      if (event.source !== bridgeSource || event.origin !== bridgeOrigin) return;
      const request = pending.get(event.data.id);
      if (!request) return;
      pending.delete(event.data.id); clearTimeout(request.timer);
      if (event.data.ok) request.resolve(event.data.result);
      else request.reject(new Error(event.data.error || 'VOC 저장소 오류'));
    });
  }
  async function call(method, payload) {
    if (!valid) throw new Error('VOC 저장소가 연결되지 않았습니다.');
    await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('VOC 연결 시간 초과')), 12000))]);
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('VOC 응답 시간 초과')); }, 20000);
      pending.set(id, { resolve, reject, timer });
      bridgeSource.postMessage({ source: 'textkit-voc-client', id, method, payload }, bridgeOrigin);
    });
  }

  function setPanel(open) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) $('#vocContent').focus();
  }
  button.addEventListener('click', () => setPanel(panel.hidden));
  $('#vocClose').addEventListener('click', () => setPanel(false));
  $('#vocBoardLink').addEventListener('click', event => { event.preventDefault(); setPanel(false); onNavigate('voc'); });
  let nickname = '';
  try {
    nickname = localStorage.getItem('textkit.vocNickname') || localStorage.getItem('textkit.vocAuthor') || '';
  } catch {}
  if (!nickname) nickname = generateRandomNickname();
  nicknameInput.value = nickname;
  try { localStorage.setItem('textkit.vocNickname', nickname); } catch {}

  function finishNicknameEdit() {
    const next = nicknameInput.value.trim() || generateRandomNickname();
    nicknameInput.value = next;
    nicknameInput.readOnly = true;
    try { localStorage.setItem('textkit.vocNickname', next); } catch {}
  }
  nicknameEdit.addEventListener('click', () => {
    if (nicknameInput.readOnly) {
      nicknameInput.readOnly = false;
      nicknameInput.focus();
      nicknameInput.select();
    } else finishNicknameEdit();
  });
  nicknameInput.addEventListener('blur', finishNicknameEdit);
  nicknameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); nicknameInput.blur(); }
  });

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
      const meta = document.createElement('div'); meta.className = 'voc-meta'; meta.textContent = `${item.nickname || item.author || '익명'} · ${STATUSES[item.status] || STATUSES.open}`;
      card.append(head, content, meta); list.append(card);
    }
  }
  async function load() {
    if (loading) return;
    if (!valid) { message.hidden = false; message.textContent = 'VOC 저장소 연결을 준비 중입니다.'; return; }
    loading = true; message.hidden = false; message.textContent = '제보를 불러오는 중입니다.';
    try {
      entries = await call('list'); render();
    } catch { message.textContent = '제보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'; }
    finally { loading = false; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!valid) { feedback.textContent = 'VOC 저장소 연결을 준비 중입니다.'; return; }
    const content = $('#vocContent').value.trim(), nickname = nicknameInput.value.trim(), type = $('#vocType').value;
    if (!content || !nickname || !TYPES[type]) return;
    const submit = $('#vocSubmit'); submit.disabled = true; feedback.textContent = '전송 중입니다.';
    try {
      const created = await call('submit', { type, content, nickname });
      if (!created?.id) throw new Error('Missing saved record');
      try { localStorage.setItem('textkit.vocNickname', nickname); } catch {}
      $('#vocContent').value = ''; feedback.textContent = '제보가 등록되었습니다.';
      entries.unshift(created); render();
    } catch { feedback.textContent = '등록하지 못했습니다. 잠시 후 다시 시도해 주세요.'; }
    finally { submit.disabled = false; }
  });
  typeFilter.addEventListener('change', render); statusFilter.addEventListener('change', render);
  return { load, setPanel };
}
