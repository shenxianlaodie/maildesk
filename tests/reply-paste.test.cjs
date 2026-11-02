const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const source = fs.readFileSync(require.resolve('../backend/public/desk/app.js'), 'utf8');
  const nodes = { '#files': { innerHTML: '' }, '#file-input': { value: '' } };
  const context = vm.createContext({
    state: { id: 'customer', files: [], requestId: 'old' },
    retryReplies: new Map([['customer', {}]]), sendingReplies: new Map(),
    $: selector => nodes[selector], $$: () => [],
    icon: () => '', esc: value => value, requestAnimationFrame() {}, resizeReply() {},
  });
  vm.runInContext(source.slice(source.indexOf('async function addFiles('), source.indexOf('function updateRepliedRow(')), context);
  return { context, nodes };
}

function paste(files, text = '', useItems = true) {
  return { clipboardData: { files, items: useItems ? files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })) : [], getData: () => text }, prevented: false, preventDefault() { this.prevented = true; } };
}

test('pasted images join existing attachments once and use the same file chips', async () => {
  const { context: c, nodes } = setup();
  c.state.files.push({ name: 'existing.pdf', size: 10 });
  const image = { name: 'screenshot.png', type: 'image/png', size: 2048 };
  const event = paste([image]);
  assert.equal(typeof c.pasteReplyImages, 'function');
  await c.pasteReplyImages(event);
  assert.equal(c.state.files.length, 2);
  assert.equal(c.state.files[1], image);
  assert.match(nodes['#files'].innerHTML, /screenshot.png · 2 KB/);
  assert.equal(c.state.requestId, null);
  assert.equal(c.retryReplies.has('customer'), false);
  assert.equal(event.prevented, true);
});

test('text paste is preserved and clipboard files fallback accepts only images', async () => {
  const { context: c } = setup();
  const text = paste([{ name: 'a.txt', type: 'text/plain', size: 4 }], 'hello');
  await c.pasteReplyImages(text);
  assert.equal(text.prevented, false);
  assert.equal(c.state.files.length, 0);
  const mixed = paste([{ name: 'photo.jpg', type: 'image/jpeg', size: 5 }], 'caption', false);
  await c.pasteReplyImages(mixed);
  assert.equal(c.state.files.length, 1);
  assert.equal(mixed.prevented, false);
});

test('pasted images obey attachment limits and cannot alter an in-flight reply', async () => {
  const { context: c } = setup();
  const event = paste([{ name: 'large.png', type: 'image/png', size: 11 * 1024 * 1024 }]);
  await assert.rejects(() => c.pasteReplyImages(event), /FILE_TOO_LARGE/);
  assert.equal(c.state.files.length, 0);
  c.sendingReplies.set('customer', {});
  await c.pasteReplyImages(paste([{ name: 'a.png', type: 'image/png', size: 1 }]));
  assert.equal(c.state.files.length, 0);
});
