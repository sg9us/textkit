import test from 'node:test';
import assert from 'node:assert/strict';
import { documentToMarkdown } from '../dist/js/markdown.js';

// Small DOM-shaped fixtures keep the serializer tests independent of a browser.
const text = value => ({ nodeType: 3, nodeValue: value, textContent: value });
function element(tag, children = [], attributes = {}) {
  const node = {
    nodeType: 1, tagName: tag.toUpperCase(), childNodes: children,
    children: children.filter(child => child.nodeType === 1),
    get textContent() { return children.map(child => child.textContent).join(''); },
    getAttribute: name => attributes[name] ?? null,
    querySelectorAll(name) {
      return children.flatMap(child => child.nodeType === 1
        ? [...(child.tagName === name.toUpperCase() ? [child] : []), ...child.querySelectorAll(name)] : []);
    }
  };
  children.forEach(child => { child.parentElement = node; });
  return node;
}
const md = (...nodes) => documentToMarkdown(element('div', nodes));

test('adjacent root text and emphasis remain in one paragraph', () => {
  assert.equal(md(text('일반 '), element('strong', [text('강조')]), text(' 뒤')), '일반 **강조** 뒤\n');
});
test('spaces around bold runs stay outside Markdown markers', () => {
  assert.equal(md(element('p', [element('strong', [text('굵은 앞 ')]), element('span', [text('보통')]), element('strong', [text(' 굵은 뒤')])])), '**굵은 앞** 보통 **굵은 뒤**\n');
});
test('nested container keeps inline text together between blocks', () => {
  assert.equal(md(element('div', [text('앞 '), element('em', [text('기울임')]), element('p', [text('다음')])])), '앞 *기울임*\n\n다음\n');
});
test('headings and explicit line breaks survive', () => {
  assert.equal(md(element('h2', [text('제목')]), element('p', [text('첫 줄'), element('br'), text('다음 줄')])), '## 제목\n\n첫 줄  \n다음 줄\n');
});
test('numbered lists preserve non-default and zero start', () => {
  for (const start of ['3', '0']) {
    assert.equal(md(element('ol', [element('li', [text('항목')])], { start })), `${start}. 항목\n`);
  }
});
test('nested lists preserve indentation', () => {
  assert.equal(md(element('ul', [element('li', [text('상위'), element('ul', [element('li', [text('하위')])])])])), '- 상위\n  - 하위\n');
});
test('code blank lines and embedded fences are preserved', () => {
  assert.equal(md(element('pre', [text('a\n\n\nb\n```')])), '````\na\n\n\nb\n```\n````\n');
});
test('table pipes are escaped', () => {
  assert.equal(md(element('table', [element('tr', [element('th', [text('제목')])]), element('tr', [element('td', [text('a|b')])])])), '| 제목 |\n| --- |\n| a\\|b |\n');
});
test('empty editor returns empty content', () => assert.equal(md(), ''));

test('verbatim editor preserves Markdown syntax, spaces, and trailing newlines', () => {
  const original = '# 제목\n-항목  \n\n```text\n{{user}}\n```\n\n';
  const editor = element('div', [text(original)]);
  editor.dataset = { verbatim: 'true' };
  assert.equal(documentToMarkdown(editor), original);
});
