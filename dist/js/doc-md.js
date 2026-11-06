let initialized = false;
let controller = null;

export function initDocumentMd({ notify = () => {} } = {}) {
  if (initialized) return controller;
  initialized = true;

  const $ = (selector) => document.querySelector(selector);
  const els = {
    project: $('#docProjectName'), type: $('#docType'), customType: $('#docCustomType'),
    customTypeWrap: $('#docCustomTypeWrap'), fileName: $('#docFileName'), autoName: $('#docAutoName'),
    editor: $('#docEditor'), blockStyle: $('#docBlockStyle'), previewToggle: $('#docPreviewToggle'),
    preview: $('#docMarkdownPreview'), source: $('#docMarkdownSource'), copy: $('#docMarkdownCopy'),
    clear: $('#docClear'), save: $('#docSave'), warning: $('#docWarning'),
    fallbackDialog: $('#docSaveDialog'), fallbackName: $('#docFallbackName'), fallbackForm: $('#docSaveForm')
  };

  let fileNameManuallyEdited = false;
  let pipBinding = null;

  const TYPE_LABELS = {
    character: '캐릭터 설정', direction: '방향성_줄거리', prompt: '캐릭터 프롬프트',
    scene: '첫장면', detail: '상세페이지 html', custom: '기타'
  };

  function escapeHTML(value) {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function safeFileName(value) {
    const base = value.trim().replace(/(?:\.md)+$/i, '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').slice(0, 120) || '문서';
    return `${base}.md`;
  }

  function selectedTypeLabel() {
    return els.type.value === 'custom' ? (els.customType.value.trim() || '기타') : TYPE_LABELS[els.type.value];
  }

  function generatedFileName() {
    const project = els.project.value.trim() || '문서';
    return safeFileName(`${project}_${selectedTypeLabel()}`);
  }

  function updateGeneratedName(force = false) {
    els.customTypeWrap.hidden = els.type.value !== 'custom';
    if (force || !fileNameManuallyEdited || !els.fileName.value.trim()) els.fileName.value = generatedFileName();
    localStorage.setItem('textkit.docProject', els.project.value);
    localStorage.setItem('textkit.docType', els.type.value);
    syncPipFromMain();
  }

  function parseFontPixels(value) {
    const number = Number.parseFloat(value);
    if (!number) return 0;
    if (value.endsWith('pt')) return number * 1.333;
    if (value.endsWith('em')) return number * 16;
    return number;
  }

  function replaceTag(element, tagName) {
    const replacement = element.ownerDocument.createElement(tagName);
    while (element.firstChild) replacement.append(element.firstChild);
    element.replaceWith(replacement);
    return replacement;
  }

  function wrapContents(element, tagName) {
    if (element.querySelector(`:scope > ${tagName}`) && element.childNodes.length === 1) return;
    const wrapper = element.ownerDocument.createElement(tagName);
    while (element.firstChild) wrapper.append(element.firstChild);
    element.append(wrapper);
  }

  function unwrapElement(element) {
    const fragment = element.ownerDocument.createDocumentFragment();
    while (element.firstChild) fragment.append(element.firstChild);
    element.replaceWith(fragment);
  }

  function sanitizeGoogleDocsHTML(html) {
    const parser = new DOMParser();
    const documentCopy = parser.parseFromString(html, 'text/html');
    const forbidden = 'script,style,iframe,object,embed,form,input,button,textarea,select,svg,math,link,meta,base,noscript';
    documentCopy.querySelectorAll(forbidden).forEach((element) => element.remove());
    const allowed = new Set(['H1','H2','H3','H4','H5','H6','P','BR','STRONG','B','EM','I','S','DEL','UL','OL','LI','BLOCKQUOTE','HR','A','TABLE','THEAD','TBODY','TFOOT','TR','TH','TD','CODE','PRE','DIV','SPAN']);
    const documentTextLength = documentCopy.body.textContent.replace(/\s/g, '').length;

    if (documentTextLength >= 40) {
      [...documentCopy.body.querySelectorAll('b,strong,[style]')].forEach((element) => {
        if (!element.isConnected) return;
        const weight = element.style.fontWeight;
        const hasBoldStyle = weight === 'bold' || Number.parseInt(weight, 10) >= 600;
        const isBoldTag = element.tagName === 'B' || element.tagName === 'STRONG';
        if (!hasBoldStyle && !isBoldTag) return;
        const textLength = element.textContent.replace(/\s/g, '').length;
        if (textLength / documentTextLength < 0.8) return;
        if (isBoldTag) {
          const wrapsDocumentStructure = Boolean(element.querySelector('p,div,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,table,pre'));
          if (wrapsDocumentStructure) unwrapElement(element);
        } else element.style.removeProperty('font-weight');
      });
    }

    const styledBoldTextNodes = new Set();
    documentCopy.body.querySelectorAll('span[style]').forEach((element) => {
      const weight = element.style.fontWeight;
      if (weight !== 'bold' && !(Number.parseInt(weight, 10) >= 600)) return;
      const walker = documentCopy.createTreeWalker(element, 4);
      while (walker.nextNode()) styledBoldTextNodes.add(walker.currentNode);
    });
    const styledBoldTextLength = [...styledBoldTextNodes].reduce((sum, node) => sum + node.nodeValue.replace(/\s/g, '').length, 0);
    const suppressDocumentWideStyledBold = documentTextLength >= 40 && styledBoldTextLength / documentTextLength >= 0.8;

    [...documentCopy.body.querySelectorAll('*')].forEach((original) => {
      if (!original.isConnected) return;
      let element = original;
      const tag = element.tagName;
      const style = element.getAttribute('style') || '';
      const weight = element.style.fontWeight;
      const isBold = weight === 'bold' || Number.parseInt(weight, 10) >= 600;
      const isItalic = element.style.fontStyle === 'italic';
      const isStrike = /line-through/i.test(element.style.textDecoration || element.style.textDecorationLine || '');
      const fontSize = parseFontPixels(element.style.fontSize || '');

      if ((tag === 'P' || tag === 'DIV') && element.textContent.trim().length < 180) {
        if (fontSize >= 27) element = replaceTag(element, 'h1');
        else if (fontSize >= 22) element = replaceTag(element, 'h2');
        else if (fontSize >= 18 && isBold) element = replaceTag(element, 'h3');
      }
      if (element.tagName === 'B') element = replaceTag(element, 'strong');
      if (element.tagName === 'I') element = replaceTag(element, 'em');
      if (element.tagName === 'S') element = replaceTag(element, 'del');
      if (isStrike && !['DEL','S'].includes(element.tagName)) wrapContents(element, 'del');
      if (isItalic && !['EM','I'].includes(element.tagName)) wrapContents(element, 'em');
      if (element.tagName === 'SPAN' && isBold && !suppressDocumentWideStyledBold) wrapContents(element, 'strong');

      if (!allowed.has(element.tagName)) {
        const fragment = documentCopy.createDocumentFragment();
        while (element.firstChild) fragment.append(element.firstChild);
        element.replaceWith(fragment);
        return;
      }
      const href = element.tagName === 'A' ? element.getAttribute('href') : null;
      [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));
      if (element.tagName === 'A' && href && /^(https?:|mailto:)/i.test(href)) {
        element.setAttribute('href', href);
        element.setAttribute('rel', 'noopener noreferrer');
      }
      if (element.tagName === 'A' && !element.hasAttribute('href')) {
        const fragment = documentCopy.createDocumentFragment();
        while (element.firstChild) fragment.append(element.firstChild);
        element.replaceWith(fragment);
      }
    });

    return documentCopy.body.innerHTML;
  }

  function markdownInline(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\u00a0/g, ' ');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    const inner = [...node.childNodes].map(markdownInline).join('');
    if (tag === 'strong' || tag === 'b') return inner.trim() ? `**${inner}**` : '';
    if (tag === 'em' || tag === 'i') return inner.trim() ? `*${inner}*` : '';
    if (tag === 'del' || tag === 's') return inner.trim() ? `~~${inner}~~` : '';
    if (tag === 'code' && node.parentElement?.tagName !== 'PRE') return `\`${inner.replace(/`/g, '\\`')}\``;
    if (tag === 'a') { const href = node.getAttribute('href'); return href ? `[${inner}](${href})` : inner; }
    if (tag === 'br') return '  \n';
    return inner;
  }

  function listToMarkdown(list, depth = 0) {
    const ordered = list.tagName === 'OL';
    const items = [...list.children].filter((child) => child.tagName === 'LI');
    return items.map((item, index) => {
      let content = '';
      const nested = [];
      [...item.childNodes].forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE && ['UL','OL'].includes(child.tagName)) nested.push(child);
        else content += markdownInline(child);
      });
      const prefix = ordered ? `${index + 1}.` : '-';
      const line = `${'  '.repeat(depth)}${prefix} ${content.trim()}`;
      const children = nested.map((child) => listToMarkdown(child, depth + 1)).join('\n');
      return children ? `${line}\n${children}` : line;
    }).join('\n');
  }

  function tableToMarkdown(table) {
    const rows = [...table.querySelectorAll('tr')].map((row) => [...row.children].filter((cell) => ['TH','TD'].includes(cell.tagName)).map((cell) => markdownInline(cell).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()));
    if (!rows.length || !rows[0].length) return '';
    const columns = Math.max(...rows.map((row) => row.length));
    rows.forEach((row) => { while (row.length < columns) row.push(''); });
    const line = (row) => `| ${row.join(' | ')} |`;
    return [line(rows[0]), line(Array(columns).fill('---')), ...rows.slice(1).map(line)].join('\n');
  }

  function blockToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.trim() ? `${node.nodeValue.trim()}\n\n` : '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${markdownInline(node).trim()}\n\n`;
    if (tag === 'p') { const content = markdownInline(node).trim(); return content ? `${content}\n\n` : ''; }
    if (tag === 'div') {
      const hasBlockChildren = [...node.children].some((child) => /^(H[1-6]|P|DIV|UL|OL|BLOCKQUOTE|HR|PRE|TABLE)$/.test(child.tagName));
      if (hasBlockChildren) return [...node.childNodes].map(blockToMarkdown).join('');
      const content = markdownInline(node).trim();
      return content ? `${content}\n\n` : '';
    }
    if (tag === 'ul' || tag === 'ol') return `${listToMarkdown(node)}\n\n`;
    if (tag === 'blockquote') return `${[...node.childNodes].map(blockToMarkdown).join('').trim().split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
    if (tag === 'hr') return '---\n\n';
    if (tag === 'pre') { const code = node.textContent.replace(/\n$/, ''); return `\`\`\`\n${code}\n\`\`\`\n\n`; }
    if (tag === 'table') return `${tableToMarkdown(node)}\n\n`;
    if (tag === 'br') return '\n';
    if (['strong','b','em','i','del','s','code','a','span'].includes(tag)) return markdownInline(node);
    return [...node.childNodes].map(blockToMarkdown).join('');
  }

  function currentMarkdown() {
    const markdown = [...els.editor.childNodes].map(blockToMarkdown).join('').replace(/\n{3,}/g, '\n\n').trim();
    return markdown ? `${markdown}\n` : '';
  }

  function refreshPreview() {
    if (!els.preview.hidden) els.source.textContent = currentMarkdown();
  }

  function exec(command, value = null) {
    els.editor.focus();
    document.execCommand(command, false, value);
    refreshPreview();
    syncPipFromMain();
  }

  function insertTable() {
    exec('insertHTML', '<table><thead><tr><th>제목 1</th><th>제목 2</th><th>제목 3</th></tr></thead><tbody><tr><td>내용</td><td>내용</td><td>내용</td></tr></tbody></table><p><br></p>');
  }

  function insertLink() {
    const url = window.prompt('링크 주소를 입력하세요. (https:// 또는 mailto:)');
    if (!url) return;
    if (!/^(https?:|mailto:)/i.test(url)) { notify('안전한 링크 주소만 사용할 수 있습니다.'); return; }
    exec('createLink', url);
  }

  function setSaveFeedback(button = els.save) {
    const original = button.textContent;
    button.textContent = '✓ 저장 완료';
    button.classList.add('success');
    setTimeout(() => { button.textContent = original; button.classList.remove('success'); }, 1700);
  }

  async function saveMarkdown(pickerWindow = window, feedbackButton = els.save) {
    const markdown = currentMarkdown();
    if (!markdown.trim()) { notify('저장할 문서 내용을 붙여넣어 주세요.'); return; }
    const fileName = safeFileName(els.fileName.value || generatedFileName());
    const pickerHost = typeof pickerWindow.showSaveFilePicker === 'function' ? pickerWindow : window;
    if (typeof pickerHost.showSaveFilePicker !== 'function') {
      els.fallbackName.value = fileName.replace(/\.md$/i, '');
      els.fallbackDialog.showModal();
      window.focus();
      return;
    }
    try {
      const handle = await pickerHost.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'Markdown 문서', accept: { 'text/markdown': ['.md'] } }] });
      const writable = await handle.createWritable();
      await writable.write(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
      await writable.close();
      notify('저장 완료');
      setSaveFeedback(feedbackButton);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      notify(`저장 실패: ${error?.message || '파일을 저장하지 못했습니다.'}`);
    }
  }

  function fallbackDownload(event) {
    event.preventDefault();
    const markdown = currentMarkdown();
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeFileName(els.fallbackName.value);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    els.fallbackDialog.close();
    notify('다운로드를 시작했습니다. 저장 위치는 브라우저 설정을 따릅니다.');
  }

  function syncPipFromMain() {
    if (!pipBinding || pipBinding.win.closed) return;
    const { doc, editor, project, type, customType, customWrap, fileName } = pipBinding;
    if (doc.activeElement !== editor) editor.innerHTML = els.editor.innerHTML;
    if (doc.activeElement !== project) project.value = els.project.value;
    if (doc.activeElement !== type) type.value = els.type.value;
    if (doc.activeElement !== customType) customType.value = els.customType.value;
    customWrap.hidden = els.type.value !== 'custom';
    if (doc.activeElement !== fileName) fileName.value = els.fileName.value;
    const preview = doc.querySelector('#pDocMarkdownPreview');
    if (preview && !preview.hidden) doc.querySelector('#pDocMarkdownSource').textContent = currentMarkdown();
  }

  function syncMainFromPipEditor(editor) {
    els.editor.innerHTML = editor.innerHTML;
    refreshPreview();
    if (pipBinding && !pipBinding.win.closed) {
      const preview = pipBinding.doc.querySelector('#pDocMarkdownPreview');
      if (preview && !preview.hidden) pipBinding.doc.querySelector('#pDocMarkdownSource').textContent = currentMarkdown();
    }
  }

  function attachPipWindow(pipWindow) {
    const doc = pipWindow.document;
    const editor = doc.querySelector('#pDocEditor');
    const project = doc.querySelector('#pDocProject');
    const type = doc.querySelector('#pDocType');
    const customType = doc.querySelector('#pDocCustomType');
    const customWrap = doc.querySelector('#pDocCustomWrap');
    const fileName = doc.querySelector('#pDocFileName');
    if (!editor || !project || !type || !customType || !customWrap || !fileName) return;
    pipBinding = { win: pipWindow, doc, editor, project, type, customType, customWrap, fileName };
    syncPipFromMain();

    project.addEventListener('input', () => { els.project.value = project.value; updateGeneratedName(); });
    type.addEventListener('change', () => { els.type.value = type.value; updateGeneratedName(); });
    customType.addEventListener('input', () => { els.customType.value = customType.value; updateGeneratedName(); });
    fileName.addEventListener('input', () => { fileNameManuallyEdited = true; els.fileName.value = fileName.value; });
    fileName.addEventListener('blur', () => { els.fileName.value = safeFileName(fileName.value); fileName.value = els.fileName.value; });
    doc.querySelector('#pDocAutoName').addEventListener('click', () => { fileNameManuallyEdited = false; updateGeneratedName(true); });

    editor.addEventListener('paste', (event) => {
      const html = event.clipboardData?.getData('text/html');
      const plain = event.clipboardData?.getData('text/plain') || '';
      event.preventDefault();
      editor.focus();
      if (html) {
        doc.execCommand('insertHTML', false, sanitizeGoogleDocsHTML(html));
        const warning = doc.querySelector('#pDocWarning');
        warning.classList.toggle('show', /rowspan|colspan|font-size|color:/i.test(html));
        warning.textContent = 'Google Docs 서식을 Markdown으로 표현 가능한 구조로 정리했습니다.';
      } else doc.execCommand('insertText', false, plain);
      syncMainFromPipEditor(editor);
    });
    editor.addEventListener('input', () => syncMainFromPipEditor(editor));

    const pipExec = (command, value = null) => { editor.focus(); doc.execCommand(command, false, value); syncMainFromPipEditor(editor); };
    doc.querySelector('#pDocBlockStyle').addEventListener('change', (event) => pipExec('formatBlock', event.target.value));
    doc.querySelectorAll('[data-pdoc-command]').forEach((button) => button.addEventListener('click', () => pipExec(button.dataset.pdocCommand)));
    doc.querySelector('#pDocHr').addEventListener('click', () => pipExec('insertHorizontalRule'));
    doc.querySelector('#pDocTable').addEventListener('click', () => pipExec('insertHTML', '<table><thead><tr><th>제목 1</th><th>제목 2</th></tr></thead><tbody><tr><td>내용</td><td>내용</td></tr></tbody></table><p><br></p>'));
    doc.querySelector('#pDocLink').addEventListener('click', () => {
      const url = pipWindow.prompt('링크 주소를 입력하세요. (https:// 또는 mailto:)');
      if (!url) return;
      if (!/^(https?:|mailto:)/i.test(url)) { notify('안전한 링크 주소만 사용할 수 있습니다.'); return; }
      pipExec('createLink', url);
    });

    const preview = doc.querySelector('#pDocMarkdownPreview');
    const source = doc.querySelector('#pDocMarkdownSource');
    const previewButton = doc.querySelector('#pDocPreview');
    previewButton.addEventListener('click', () => {
      const open = preview.hidden;
      preview.hidden = !open;
      previewButton.textContent = open ? 'Markdown 닫기' : 'Markdown 보기';
      if (open) source.textContent = currentMarkdown();
    });
    doc.querySelector('#pDocCopy').addEventListener('click', async () => {
      const markdown = currentMarkdown();
      try { await pipWindow.navigator.clipboard.writeText(markdown); }
      catch { const area = doc.createElement('textarea'); area.value = markdown; doc.body.append(area); area.select(); doc.execCommand('copy'); area.remove(); }
      notify('Markdown 원문을 복사했습니다.');
    });
    doc.querySelector('#pDocClear').addEventListener('click', () => {
      if (!editor.textContent.trim() || pipWindow.confirm('편집 중인 문서를 모두 지울까요? 이 작업은 되돌릴 수 없습니다.')) {
        editor.innerHTML = '';
        syncMainFromPipEditor(editor);
        doc.querySelector('#pDocWarning').classList.remove('show');
      }
    });
    doc.querySelector('#pDocSave').addEventListener('click', () => saveMarkdown(pipWindow, doc.querySelector('#pDocSave')));
    pipWindow.addEventListener('pagehide', () => { if (pipBinding?.win === pipWindow) pipBinding = null; });
  }

  els.project.value = localStorage.getItem('textkit.docProject') || '';
  els.type.value = localStorage.getItem('textkit.docType') || 'character';
  updateGeneratedName(true);
  els.project.addEventListener('input', () => updateGeneratedName());
  els.type.addEventListener('change', () => updateGeneratedName());
  els.customType.addEventListener('input', () => updateGeneratedName());
  els.fileName.addEventListener('input', () => { fileNameManuallyEdited = true; syncPipFromMain(); });
  els.fileName.addEventListener('blur', () => { els.fileName.value = safeFileName(els.fileName.value); syncPipFromMain(); });
  els.autoName.addEventListener('click', () => { fileNameManuallyEdited = false; updateGeneratedName(true); });

  els.editor.addEventListener('paste', (event) => {
    const html = event.clipboardData?.getData('text/html');
    const plain = event.clipboardData?.getData('text/plain') || '';
    event.preventDefault();
    if (html) {
      const sanitized = sanitizeGoogleDocsHTML(html);
      document.execCommand('insertHTML', false, sanitized);
      els.warning.classList.toggle('show', /rowspan|colspan|font-size|color:/i.test(html));
      els.warning.textContent = 'Google Docs 서식을 Markdown으로 표현 가능한 구조로 정리했습니다. 병합 셀·글자색·사용자 지정 정렬은 원문 보기에서 확인해 주세요.';
    } else document.execCommand('insertText', false, plain);
    refreshPreview();
    syncPipFromMain();
  });
  els.editor.addEventListener('input', () => { refreshPreview(); syncPipFromMain(); });
  els.blockStyle.addEventListener('change', () => exec('formatBlock', els.blockStyle.value));
  document.querySelectorAll('[data-doc-command]').forEach((button) => button.addEventListener('click', () => exec(button.dataset.docCommand)));
  $('#docLink').addEventListener('click', insertLink);
  $('#docHr').addEventListener('click', () => exec('insertHorizontalRule'));
  $('#docTable').addEventListener('click', insertTable);
  els.previewToggle.addEventListener('click', () => {
    const open = els.preview.hidden;
    els.preview.hidden = !open;
    els.previewToggle.textContent = open ? 'Markdown 원문 닫기' : 'Markdown 원문 보기';
    if (!open) return;
    els.source.textContent = currentMarkdown();
    requestAnimationFrame(() => requestAnimationFrame(() => els.preview.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  });
  els.copy.addEventListener('click', async () => { const markdown = currentMarkdown(); try { await navigator.clipboard.writeText(markdown); } catch { const area = document.createElement('textarea'); area.value = markdown; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); } notify('Markdown 원문을 복사했습니다.'); });
  els.clear.addEventListener('click', () => { if (!els.editor.textContent.trim() || window.confirm('편집 중인 문서를 모두 지울까요? 이 작업은 되돌릴 수 없습니다.')) { els.editor.innerHTML = ''; refreshPreview(); syncPipFromMain(); els.warning.classList.remove('show'); } });
  els.save.addEventListener('click', () => saveMarkdown());
  els.fallbackForm.addEventListener('submit', fallbackDownload);
  controller = { attachPipWindow, currentMarkdown, syncPipFromMain };
  return controller;
}
