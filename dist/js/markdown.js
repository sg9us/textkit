function markdownInline(node) {
  if (node.nodeType === 3) return node.nodeValue.replace(/\u00a0/g, ' ');
  if (node.nodeType !== 1) return '';
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
      if (child.nodeType === 1 && ['UL','OL'].includes(child.tagName)) nested.push(child);
      else content += markdownInline(child);
    });
    const prefix = ordered ? `${Number(list.getAttribute('start') ?? 1) + index}.` : '-';
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
  if (node.nodeType === 3) return node.nodeValue.trim() ? `${node.nodeValue.trim()}\n\n` : '';
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${markdownInline(node).trim()}\n\n`;
  if (tag === 'p') { const content = markdownInline(node).trim(); return content ? `${content}\n\n` : ''; }
  if (tag === 'div') {
    const hasBlockChildren = [...node.children].some((child) => /^(H[1-6]|P|DIV|UL|OL|BLOCKQUOTE|HR|PRE|TABLE)$/.test(child.tagName));
    if (hasBlockChildren) return nodesToMarkdown(node.childNodes);
    const content = markdownInline(node).trim();
    return content ? `${content}\n\n` : '';
  }
  if (tag === 'ul' || tag === 'ol') return `${listToMarkdown(node)}\n\n`;
  if (tag === 'blockquote') return `${nodesToMarkdown(node.childNodes).trim().split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
  if (tag === 'hr') return '---\n\n';
  if (tag === 'pre') {
    const code = node.textContent.replace(/\n$/, '');
    const longest = Math.max(0, ...(code.match(/`+/g) || []).map(run => run.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `${fence}\n${code}\n${fence}\n\n`;
  }
  if (tag === 'table') return `${tableToMarkdown(node)}\n\n`;
  if (tag === 'br') return '\n';
  if (['strong','b','em','i','del','s','code','a','span'].includes(tag)) return markdownInline(node);
  return [...node.childNodes].map(blockToMarkdown).join('');
}


export function nodesToMarkdown(nodes) {
  let output = '', inline = '';
  const flushInline = () => { if (inline.trim()) output += inline.trim() + '\n\n'; inline = ''; };
  for (const node of nodes) {
    const isBlock = node.nodeType === 1 && /^(H[1-6]|P|DIV|UL|OL|BLOCKQUOTE|HR|PRE|TABLE)$/.test(node.tagName);
    if (isBlock) { flushInline(); output += blockToMarkdown(node); }
    else inline += markdownInline(node);
  }
  flushInline();
  return output;
}

export function documentToMarkdown(editor) {
  if (editor.dataset?.verbatim === 'true') return editor.textContent;
  const markdown = nodesToMarkdown(editor.childNodes).trim();
  return markdown ? markdown + '\n' : '';
}
