import test from 'node:test';
import assert from 'node:assert/strict';
import { countCharacters, countWithoutWhitespace, getEditorPlainText, processPrompt, transformText } from '../dist/js/text-utils.js';

const textNode = (value) => ({ nodeType: 3, nodeValue: value });
const element = (tagName, ...childNodes) => ({ nodeType: 1, tagName, childNodes });
const editorRoot = (...childNodes) => ({ childNodes });

test('character counting normalizes NBSP, zero-width characters, and line endings', () => {
  const source = `가\u00a0나\u200B\r\n다\u2060`;
  assert.equal(countCharacters(source), 5);
  assert.equal(countWithoutWhitespace(source), 3);
});

test('character counting follows JavaScript UTF-16 length semantics', () => {
  assert.equal(countCharacters('ABC'), 3);
  assert.equal(countCharacters('𝓓𝓮𝓱'), 6);
  assert.equal(countCharacters('📍'), 2);
  assert.equal(countCharacters('😀'), 2);
});

test('mathematical alphanumeric phrase uses UTF-16 units with and without spaces', () => {
  const source = '𝓓𝓮𝓱, 𝓼𝓪𝓵𝓿𝓪𝓶𝓲 !';
  assert.equal(countCharacters(source), 24);
  assert.equal(countWithoutWhitespace(source), 22);
  assert.equal(countCharacters(source), source.length);
});

test('legacy 469-code-point content counts as 480 UTF-16 units', () => {
  const source = `${'가'.repeat(454)}𝓓𝓮𝓱, 𝓼𝓪𝓵𝓿𝓪𝓶𝓲 !📍`;
  assert.equal(Array.from(source).length, 469);
  assert.equal(countCharacters(source), 480);
});

test('rich editor canonical text adds only semantic line breaks', () => {
  const editor = editorRoot(
    element('P', textNode('제목')),
    element('P', textNode('본문')),
    element('DIV', element('BR')),
    element('TABLE', element('TBODY', element('TR', element('TD', element('P', textNode('셀')))))),
    element('P', textNode('끝')),
    element('BR'),
    element('BR')
  );
  assert.equal(getEditorPlainText(editor), '제목\n본문\n\n셀\n\n끝\n\n\n');
});

test('rich editor edits change only the edited UTF-16 units', () => {
  const value = textNode('가 나');
  const editor = editorRoot(element('P', value));
  const before = countCharacters(getEditorPlainText(editor));
  value.nodeValue = '가나';
  assert.equal(countCharacters(getEditorPlainText(editor)), before - 1);
  value.nodeValue = '가나다';
  assert.equal(countCharacters(getEditorPlainText(editor)), before);
});

test('bold and heading level changes do not affect rich editor count', () => {
  const boldHeading = editorRoot(element('H1', element('STRONG', textNode('제목'))));
  const plainHeading = editorRoot(element('H2', textNode('제목')));
  assert.equal(getEditorPlainText(boldHeading), getEditorPlainText(plainHeading));
});

test('prompt formatting keeps heading spaces and every line break', () => {
  const source = '# 캐릭터 설정\n\n## 관계 진행\n* 유저에게만 특별한 태도를 보인다.\n';
  assert.equal(processPrompt(source), '# 캐릭터설정\n\n## 관계진행\n*유저에게만특별한태도를보인다.\n');
  assert.equal(source, '# 캐릭터 설정\n\n## 관계 진행\n* 유저에게만 특별한 태도를 보인다.\n');
});

test('prompt formatting preserves variables, CRLF, and fenced code', () => {
  const source = '###  {{user}} 와 {{char}}\r\n\r\n~~~js\r\nconst a = " spaced value ";\r\n~~~\r\n본문 띄어 쓰기\r\n';
  assert.equal(processPrompt(source), '### {{user}}와{{char}}\r\n\r\n~~~js\r\nconst a = " spaced value ";\r\n~~~\r\n본문띄어쓰기\r\n');
});

test('fourth-level heading gets one separator; unrelated hash text does not', () => {
  assert.equal(processPrompt('####   세 부 제 목\n#본문  기 호\n```\na b\n```'), '#### 세부제목\n#본문기호\n```\na b\n```');
});

test('all cleanup types use the common transformer', () => {
  assert.equal(transformText('spaces', '가 나\t다'), '가나다');
  assert.equal(transformText('blankLines', '가\n\n나'), '가\n나');
  assert.equal(transformText('replace', '가나다가', { find: '가', replace: 'A' }), 'A나다A');
});
