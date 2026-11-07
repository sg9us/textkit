import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const start = html.indexOf('function processPrompt(text)');
const end = html.indexOf('const transforms=', start);
assert.ok(start > 0 && end > start);
const processPrompt = new Function(`${html.slice(start, end)};return processPrompt;`)();

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
