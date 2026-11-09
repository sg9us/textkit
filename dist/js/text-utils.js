const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/gu;
const plainTextSnapshots = new WeakMap();

export function normalizePlainText(value = '') {
  return String(value)
    .replace(/\r\n?|\u2028|\u2029/gu, '\n')
    .replace(/\u00A0/gu, ' ')
    .replace(ZERO_WIDTH, '');
}

export function countCharacters(value = '') {
  return Array.from(normalizePlainText(value)).length;
}

export function countWithoutWhitespace(value = '') {
  return Array.from(normalizePlainText(value).replace(/\s/gu, '')).length;
}

function renderedEditorText(editor) {
  const visible = typeof editor?.innerText === 'string' ? editor.innerText : editor?.textContent || '';
  return normalizePlainText(visible);
}

export function rememberRichPlainText(editor, plainText) {
  if (!editor) return;
  plainTextSnapshots.set(editor, {
    fingerprint: renderedEditorText(editor),
    text: normalizePlainText(plainText)
  });
}

export function plainTextFromRichEditor(editor) {
  const fingerprint = renderedEditorText(editor);
  const snapshot = plainTextSnapshots.get(editor);
  if (snapshot?.fingerprint === fingerprint) return snapshot.text;
  rememberRichPlainText(editor, fingerprint);
  return fingerprint;
}

export function syncRichPlainText(sourceEditor, targetEditor) {
  if (!sourceEditor || !targetEditor) return;
  rememberRichPlainText(targetEditor, plainTextFromRichEditor(sourceEditor));
}

export function processPrompt(text) {
  let fence = null;
  return String(text).split(/(\r\n|\n|\r)/).map((part, index) => {
    if (index % 2) return part;
    const marker = part.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      const run = marker[1];
      if (!fence) fence = { character: run[0], length: run.length };
      else if (run[0] === fence.character && run.length >= fence.length && new RegExp(`^ {0,3}${fence.character === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`).test(part)) fence = null;
      return part;
    }
    if (fence) return part;
    const heading = part.match(/^( {0,3})(#{1,4})[ \t]+(.*)$/);
    return heading ? `${heading[1]}${heading[2]} ${heading[3].replace(/[ \t]/g, '')}` : part.replace(/[ \t]/g, '');
  }).join('');
}

export function transformText(type, text, options = {}) {
  const value = String(text);
  if (type === 'prompt') return processPrompt(value);
  if (type === 'spaces') return value.replace(/[ \t]/g, '');
  if (type === 'blankLines') return value.split('\n').filter((line) => line.trim() !== '').join('\n');
  if (type === 'lineBreaks') return value.replace(/\s*\r?\n\s*/g, ' ').replace(/ {2,}/g, ' ');
  if (type === 'allWhitespace') return value.replace(/\s/gu, '');
  if (type === 'normalize') return value.split('\n').map((line) => line.trim().replace(/[ \t]+/g, ' ')).join('\n');
  if (type === 'replace') return options.find ? value.split(options.find).join(options.replace ?? '') : value;
  return value;
}
