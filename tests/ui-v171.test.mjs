import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const documentModule = await readFile(new URL('../dist/js/doc-md.js', import.meta.url), 'utf8');

test('cleanup controls expose the supported toggle set without a more menu', () => {
  for (const type of ['prompt', 'spaces', 'blankLines', 'lineBreaks']) {
    assert.match(index, new RegExp(`data-tool="${type}"[^>]*aria-pressed=`));
    assert.match(index, new RegExp(`data-pip-tool="${type}"[^>]*aria-pressed=`));
  }
  assert.doesNotMatch(index, /id="moreBtn"|id="extraTools"|data-tool="allWhitespace"|data-tool="normalize"/);
  assert.match(index, /># 프롬프트형식<\/button>/);
  assert.match(index, />#띄어쓰기제거<\/button>/);
});

test('Markdown save copy remains while raw preview UI and handlers are removed', () => {
  assert.match(index, /복사한 텍스트를 마크다운 서식 그대로 확인하고, \.md 파일로 저장하세요\./);
  assert.match(index, /id="docTextCopy"/);
  assert.match(index, /id="docSave"/);
  assert.doesNotMatch(index, /docPreviewToggle|docMarkdownPreview|docMarkdownCopy|docMarkdownSource/);
  assert.doesNotMatch(documentModule, /previewToggle|Markdown 원문 닫기|Markdown 원문을 복사했습니다/);
  assert.match(documentModule, /function serializeMarkdown/);
  assert.match(documentModule, /async function saveMarkdown/);
});
