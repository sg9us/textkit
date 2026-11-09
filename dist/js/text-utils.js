const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/gu;
const LINE_BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TR']);

export function normalizePlainText(value = '') {
  return String(value)
    .replace(/\r\n?|\u2028|\u2029/gu, '\n')
    .replace(/\u00A0/gu, ' ')
    .replace(ZERO_WIDTH, '');
}

export function countCharacters(value = '') {
  return normalizePlainText(value).length;
}

export function countWithoutWhitespace(value = '') {
  return normalizePlainText(value).replace(/\s/gu, '').length;
}

function canonicalNodeText(node) {
  if (node?.nodeType === 3) return node.nodeValue || '';
  if (node?.nodeType !== 1) return '';
  if (node.tagName === 'BR') return '\n';
  let text = Array.from(node.childNodes || [], canonicalNodeText).join('');
  if (LINE_BLOCKS.has(node.tagName) && !text.endsWith('\n')) text += '\n';
  // Google Docs preserves one blank line after a table in text/plain.
  if (node.tagName === 'TABLE') text += '\n';
  return text;
}

export function getEditorPlainText(editor) {
  if (!editor) return '';
  return normalizePlainText(Array.from(editor.childNodes || [], canonicalNodeText).join(''));
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
