import test from 'node:test';
import assert from 'node:assert/strict';
import { countCharacters, countWithoutWhitespace, plainTextFromRichEditor, processPrompt, rememberRichPlainText, transformText } from '../dist/js/text-utils.js';

test('character counting normalizes NBSP, zero-width characters, and line endings', () => {
  const source = `가\u00a0나\u200B\r\n다\u2060`;
  assert.equal(countCharacters(source), 5);
  assert.equal(countWithoutWhitespace(source), 3);
});

test('rich editor count keeps the clipboard plain text instead of layout line breaks', () => {
  const editor = { innerText: '제목\n\n본문', textContent: '제목본문' };
  rememberRichPlainText(editor, '제목\n본문');
  assert.equal(plainTextFromRichEditor(editor), '제목\n본문');
  assert.equal(countCharacters(plainTextFromRichEditor(editor)), countCharacters('제목\n본문'));
  editor.innerText = '제목\n\n수정 본문';
  assert.equal(plainTextFromRichEditor(editor), '제목\n\n수정 본문');
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
