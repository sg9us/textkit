import { documentToMarkdown } from './markdown.js?v=1.6.5';
import { countCharacters, getEditorPlainText } from './text-utils.js?v=1.6.5';

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
    textCopy: $('#docTextCopy'), characterCount: $('#docCharacterCount'),
    clear: $('#docClear'), save: $('#docSave'), warning: $('#docWarning'),
    fallbackDialog: $('#docSaveDialog'), fallbackName: $('#docFallbackName'), fallbackForm: $('#docSaveForm')
  };

  let fileNameManuallyEdited = false;
  let pipBinding = null;
  let saving = false;
  let fallbackMarkdown = '';

  function hasDocumentFormatting(html) {
    const copied = new DOMParser().parseFromString(html, 'text/html');
    if (copied.querySelector('h1,h2,h3,h4,h5,h6,ul,ol,li,table,blockquote,pre,hr,em,i,s,del')) return true;
    return [...copied.body.querySelectorAll('b,strong,span,p,div')].some((element) => {
      if (['B','STRONG'].includes(element.tagName) && !element.querySelector('p,div,h1,h2,h3,h4,h5,h6,ul,ol,table')) {
        return !/^(normal|400)$/i.test(element.style.fontWeight);
      }
      const style = element.style;
      return /^(bold|[6-9]00)$/i.test(style.fontWeight)
        || ((element.tagName === 'P' || element.tagName === 'DIV') && parseFontPixels(style.fontSize) >= 18)
        || Boolean(style.marginLeft || style.paddingLeft);
    });
  }

  function insertPlainText(editor, value) {
    const doc = editor.ownerDocument;
    const selection = doc.getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) {
      editor.append(doc.createTextNode(value));
      return;
    }
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const text = doc.createTextNode(value);
    range.insertNode(text);
    range.setStartAfter(text);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function pasteDocument(editor, html, plain) {
    const empty = !editor.textContent && !editor.querySelector('img,hr,table');
    const plainPreferred = Boolean(plain) && (!html || (els.type.value === 'prompt' && !hasDocumentFormatting(html)));
    const verbatim = plainPreferred && (empty || editor.dataset.verbatim === 'true');
    if (verbatim) {
      insertPlainText(editor, plain);
      editor.dataset.verbatim = 'true';
    } else if (html && !plainPreferred) {
      delete editor.dataset.verbatim;
      editor.ownerDocument.execCommand('insertHTML', false, sanitizeGoogleDocsHTML(html));
    } else {
      editor.ownerDocument.execCommand('insertText', false, plain);
    }
    return { richHtml: Boolean(html && !plainPreferred) };
  }

  function handleVerbatimLineBreak(editor, event) {
    if (editor.dataset.verbatim !== 'true' || !['insertParagraph', 'insertLineBreak'].includes(event.inputType)) return;
    event.preventDefault();
    insertPlainText(editor, '\n');
    editor.dispatchEvent(new editor.ownerDocument.defaultView.Event('input', { bubbles: true }));
  }

  function clearVerbatim(editor) {
    delete editor.dataset.verbatim;
  }

  const TYPE_LABELS = {
    character: '캐릭터 설정', direction: '방향성_줄거리', prompt: '캐릭터 프롬프트',
    scene: '첫장면', detail: '상세페이지 html', custom: '기타'
  };

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
    refreshPreview();
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

  function preserveParagraphBold(paragraph) {
    const visit = (parent) => {
      [...parent.childNodes].forEach((child) => {
        if (child.nodeType === 3) {
          if (!child.nodeValue.trim()) return;
          const strong = paragraph.ownerDocument.createElement('strong');
          child.replaceWith(strong);
          strong.append(child);
        } else if (child.nodeType === 1) {
          if (['B','STRONG'].includes(child.tagName) || /^(normal|400)$/i.test(child.style.fontWeight)) return;
          visit(child);
        }
      });
    };
    visit(paragraph);
  }

  function sanitizeGoogleDocsHTML(html) {
    const parser = new DOMParser();
    const documentCopy = parser.parseFromString(html, 'text/html');
    const forbidden = 'script,style,iframe,object,embed,form,input,button,textarea,select,svg,math,link,meta,base,noscript';
    documentCopy.querySelectorAll(forbidden).forEach((element) => element.remove());
    const allowed = new Set(['H1','H2','H3','H4','H5','H6','P','BR','STRONG','B','EM','I','S','DEL','UL','OL','LI','BLOCKQUOTE','HR','A','TABLE','THEAD','TBODY','TFOOT','TR','TH','TD','CODE','PRE','DIV','SPAN']);
    // Clipboard wrappers can mark an entire document bold even when its paragraphs are not.
    // Remove only wrappers around block structure; retain formatting on actual text runs.
    [...documentCopy.body.querySelectorAll('b,strong,span')].forEach((element) => {
      if (element.isConnected && element.querySelector('p,div,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,table,pre')) unwrapElement(element);
    });

    [...documentCopy.body.querySelectorAll('*')].forEach((original) => {
      if (!original.isConnected) return;
      let element = original;
      const tag = element.tagName;
      const weight = element.style.fontWeight;
      const isBold = weight === 'bold' || Number.parseInt(weight, 10) >= 600;
      const isItalic = element.style.fontStyle === 'italic';
      const isStrike = /line-through/i.test(element.style.textDecoration || element.style.textDecorationLine || '');
      const fontSize = parseFontPixels(element.style.fontSize || '');
      const indent = Math.max(parseFontPixels(element.style.marginLeft || ''), parseFontPixels(element.style.paddingLeft || ''));

      if ((tag === 'P' || tag === 'DIV') && element.textContent.trim().length < 180) {
        if (fontSize >= 27) element = replaceTag(element, 'h1');
        else if (fontSize >= 22) element = replaceTag(element, 'h2');
        else if (fontSize >= 18 && isBold) element = replaceTag(element, 'h3');
      }
      if (['B','STRONG'].includes(element.tagName) && /^(normal|400)$/i.test(weight)) element = replaceTag(element, 'span');
      else if (element.tagName === 'B') element = replaceTag(element, 'strong');
      if (element.tagName === 'I') element = replaceTag(element, 'em');
      if (element.tagName === 'S') element = replaceTag(element, 'del');
      if (isStrike && !['DEL','S'].includes(element.tagName)) wrapContents(element, 'del');
      if (isItalic && !['EM','I'].includes(element.tagName)) wrapContents(element, 'em');
      if (element.tagName === 'SPAN' && isBold) wrapContents(element, 'strong');
      if (element.tagName === 'P' && isBold) preserveParagraphBold(element);

      if (!allowed.has(element.tagName)) {
        const fragment = documentCopy.createDocumentFragment();
        while (element.firstChild) fragment.append(element.firstChild);
        element.replaceWith(fragment);
        return;
      }
      const href = element.tagName === 'A' ? element.getAttribute('href') : null;
      const listStart = element.tagName === 'OL' ? element.getAttribute('start') : null;
      [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));
      if (listStart !== null && /^-?\d+$/.test(listStart)) element.setAttribute('start', listStart);
      if (element.tagName === 'A' && href && /^(https?:|mailto:)/i.test(href)) {
        element.setAttribute('href', href);
        element.setAttribute('rel', 'noopener noreferrer');
      }
      if (element.tagName === 'A' && !element.hasAttribute('href')) {
        const fragment = documentCopy.createDocumentFragment();
        while (element.firstChild) fragment.append(element.firstChild);
        element.replaceWith(fragment);
      }
      if (element.isConnected && element.tagName === 'P' && indent >= 16 && !element.closest('li,td,th,blockquote')) {
        const quote = documentCopy.createElement('blockquote');
        element.replaceWith(quote);
        quote.append(element);
      }
    });

    documentCopy.body.querySelectorAll('strong strong').forEach((element) => unwrapElement(element));

    // Google Docs can place a sublist directly under a list instead of under its item.
    // Attach it to the preceding item so both the editor and Markdown keep the depth.
    documentCopy.body.querySelectorAll('ul,ol').forEach((list) => {
      [...list.children].forEach((child) => {
        if (!['UL','OL'].includes(child.tagName)) return;
        const previous = child.previousElementSibling;
        if (previous?.tagName === 'LI') previous.append(child);
      });
    });

    return documentCopy.body.innerHTML;
  }

  function serializeMarkdown(editor = els.editor) {
    return documentToMarkdown(editor);
  }

  function currentMarkdown() {
    return serializeMarkdown(els.editor);
  }

  function updateCharacterCounts() {
    const label = `공백 포함 ${countCharacters(getEditorPlainText(els.editor)).toLocaleString('ko-KR')}자`;
    els.characterCount.textContent = label;
    if (pipBinding && !pipBinding.win.closed) {
      const pipCount = pipBinding.doc.querySelector('#pDocCharacterCount');
      if (pipCount) pipCount.textContent = label;
    }
  }

  function refreshPreview() {
    if (!els.preview.hidden) els.source.textContent = currentMarkdown();
  }

  function exec(command, value = null) {
    clearVerbatim(els.editor);
    els.editor.focus();
    document.execCommand(command, false, value);
    refreshPreview();
    updateCharacterCounts();
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
    const label = button.querySelector('[data-doc-save-label]');
    const original = label?.textContent || button.textContent;
    if (label) label.textContent = '✓ 저장 완료';
    else button.textContent = '✓ 저장 완료';
    button.classList.add('success');
    setTimeout(() => {
      const currentLabel = button.querySelector('[data-doc-save-label]');
      if (currentLabel) currentLabel.textContent = original;
      else button.textContent = original;
      button.classList.remove('success');
    }, 1700);
  }

  function setCopyFeedback(button) {
    const label = button?.querySelector('[data-doc-copy-label]');
    if (!button || !label) return;
    const original = label.textContent;
    label.textContent = '✓ 복사 완료';
    button.classList.add('success');
    setTimeout(() => { label.textContent = original; button.classList.remove('success'); }, 1500);
  }

  async function copyRichText(editor = els.editor, targetWindow = window, feedbackButton = els.textCopy) {
    const plain = getEditorPlainText(editor);
    const html = editor.innerHTML;
    if (!plain.trim() && !editor.querySelector('hr,table')) { notify('복사할 문서 내용을 붙여넣어 주세요.'); return; }
    const clipboard = targetWindow.navigator?.clipboard || navigator.clipboard;
    const ClipboardItemCtor = targetWindow.ClipboardItem || window.ClipboardItem;
    try {
      if (clipboard?.write && ClipboardItemCtor) {
        await clipboard.write([new ClipboardItemCtor({
          'text/html': new Blob([html], { type: 'text/html;charset=utf-8' }),
          'text/plain': new Blob([plain], { type: 'text/plain;charset=utf-8' })
        })]);
      } else {
        const doc = editor.ownerDocument;
        const selection = doc.getSelection();
        const savedRanges = selection ? [...Array(selection.rangeCount)].map((_, index) => selection.getRangeAt(index).cloneRange()) : [];
        const range = doc.createRange();
        range.selectNodeContents(editor);
        selection?.removeAllRanges();
        selection?.addRange(range);
        const copied = doc.execCommand('copy');
        selection?.removeAllRanges();
        savedRanges.forEach((savedRange) => selection?.addRange(savedRange));
        if (!copied) await clipboard.writeText(plain);
      }
      setCopyFeedback(feedbackButton);
      notify('서식을 포함해 텍스트를 복사했습니다.');
    } catch {
      try {
        await clipboard.writeText(plain);
        setCopyFeedback(feedbackButton);
        notify('텍스트를 복사했습니다. 이 브라우저에서는 일부 서식이 제외될 수 있습니다.');
      } catch { notify('텍스트를 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.'); }
    }
  }

  async function saveMarkdown(pickerWindow = window, feedbackButton = els.save, sourceEditor = els.editor) {
    if (saving) return;
    const markdown = serializeMarkdown(sourceEditor);
    if (!markdown.trim()) { notify('저장할 문서 내용을 붙여넣어 주세요.'); return; }
    const fileName = safeFileName(els.fileName.value || generatedFileName());
    const pickerHost = typeof pickerWindow.showSaveFilePicker === 'function' ? pickerWindow : window;
    if (typeof pickerHost.showSaveFilePicker !== 'function') {
      fallbackMarkdown = markdown;
      els.fallbackName.value = fileName.replace(/\.md$/i, '');
      els.fallbackDialog.showModal();
      window.focus();
      return;
    }
    saving = true;
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
    } finally {
      saving = false;
    }
  }

  function fallbackDownload(event) {
    event.preventDefault();
    const markdown = fallbackMarkdown || currentMarkdown();
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeFileName(els.fallbackName.value);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    els.fallbackDialog.close();
    fallbackMarkdown = '';
    notify('다운로드를 시작했습니다. 저장 위치는 브라우저 설정을 따릅니다.');
  }

  function syncPipFromMain() {
    if (!pipBinding || pipBinding.win.closed) return;
    const { doc, editor, project, type, customType, customWrap, fileName } = pipBinding;
    if (doc.activeElement !== editor) {
      editor.innerHTML = els.editor.innerHTML;
      if (els.editor.dataset.verbatim === 'true') editor.dataset.verbatim = 'true';
      else delete editor.dataset.verbatim;
    }
    if (doc.activeElement !== project) project.value = els.project.value;
    if (doc.activeElement !== type) type.value = els.type.value;
    if (doc.activeElement !== customType) customType.value = els.customType.value;
    customWrap.hidden = els.type.value !== 'custom';
    if (doc.activeElement !== fileName) fileName.value = els.fileName.value;
    updateCharacterCounts();
  }

  function syncMainFromPipEditor(editor) {
    els.editor.innerHTML = editor.innerHTML;
    if (editor.dataset.verbatim === 'true') els.editor.dataset.verbatim = 'true';
    else delete els.editor.dataset.verbatim;
    refreshPreview();
    updateCharacterCounts();
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
      const result = pasteDocument(editor, html, plain);
      if (result.richHtml) {
        const warning = doc.querySelector('#pDocWarning');
        warning.classList.toggle('show', /rowspan|colspan|font-size|color:/i.test(html));
        warning.textContent = 'Google Docs 서식을 Markdown으로 표현 가능한 구조로 정리했습니다.';
      } else doc.querySelector('#pDocWarning').classList.remove('show');
      syncMainFromPipEditor(editor);
    });
    editor.addEventListener('beforeinput', (event) => handleVerbatimLineBreak(editor, event));
    editor.addEventListener('input', () => syncMainFromPipEditor(editor));

    const pipExec = (command, value = null) => { clearVerbatim(editor); editor.focus(); doc.execCommand(command, false, value); syncMainFromPipEditor(editor); };
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

    doc.querySelector('#pDocTextCopy').addEventListener('click', () => copyRichText(editor, pipWindow, doc.querySelector('#pDocTextCopy')));
    doc.querySelector('#pDocClear').addEventListener('click', () => {
      if (!editor.textContent.trim() || pipWindow.confirm('편집 중인 문서를 모두 지울까요? 이 작업은 되돌릴 수 없습니다.')) {
        editor.innerHTML = '';
        clearVerbatim(editor);
        syncMainFromPipEditor(editor);
        doc.querySelector('#pDocWarning').classList.remove('show');
      }
    });
    doc.querySelector('#pDocSave').addEventListener('click', () => saveMarkdown(pipWindow, doc.querySelector('#pDocSave'), editor));
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
    const result = pasteDocument(els.editor, html, plain);
    if (result.richHtml) {
      els.warning.classList.toggle('show', /rowspan|colspan|font-size|color:/i.test(html));
      els.warning.textContent = 'Google Docs 서식을 Markdown으로 표현 가능한 구조로 정리했습니다. 병합 셀·글자색·사용자 지정 정렬은 원문 보기에서 확인해 주세요.';
    } else els.warning.classList.remove('show');
    refreshPreview();
    syncPipFromMain();
    updateCharacterCounts();
  });
  els.editor.addEventListener('beforeinput', (event) => handleVerbatimLineBreak(els.editor, event));
  els.editor.addEventListener('input', () => { refreshPreview(); syncPipFromMain(); updateCharacterCounts(); });
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
  els.textCopy.addEventListener('click', () => copyRichText());
  els.clear.addEventListener('click', () => { if (!els.editor.textContent.trim() || window.confirm('편집 중인 문서를 모두 지울까요? 이 작업은 되돌릴 수 없습니다.')) { els.editor.innerHTML = ''; clearVerbatim(els.editor); refreshPreview(); syncPipFromMain(); updateCharacterCounts(); els.warning.classList.remove('show'); } });
  els.save.addEventListener('click', () => saveMarkdown(window, els.save, els.editor));
  els.fallbackForm.addEventListener('submit', fallbackDownload);
  updateCharacterCounts();
  controller = { attachPipWindow, currentMarkdown, plainText: () => getEditorPlainText(els.editor), serializeMarkdown, syncPipFromMain };
  return controller;
}
