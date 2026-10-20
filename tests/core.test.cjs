const test = require('node:test');
const assert = require('node:assert/strict');
const { groupCustomers, calculateRefund, expandTemplate, normalizeEmail } = require('../dist/core.js');
test('same customer across inboxes folds identical Message-ID, preserves followups and sources', () => {
  const source = { id: 1, email: ' A@example.com ', name: 'A', account: 0, messageId: 'one', at: '2026-09-18T10:00', done: false };
  const groups = groupCustomers([source, { ...source, id: 2, email: 'a@example.com', account: 1 }, { ...source, id: 3, messageId: 'two', at: '2026-09-18T11:00' }, { ...source, id: 4, email: 'other@example.com' }]);
  assert.equal(groups.length, 2);
  const c = groups.find(c => c.email === 'a@example.com');
  assert.equal(c.originals.length, 3); assert.equal(c.messages.length, 2);
  assert.deepEqual(c.messages[0].accounts, [0, 1]); assert.deepEqual(c.messages[0].sourceIds, [1, 2]);
  assert.equal(c.last.id, 3); assert.equal(c.pending, true);
});
test('missing Message-ID never causes unrelated messages to disappear', () => {
  const c = groupCustomers([{ id: 1, email: 'x@example.com', at: '1', account: 0 }, { id: 2, email: 'x@example.com', at: '2', account: 0 }])[0];
  assert.equal(c.messages.length, 2);
  assert.notEqual(normalizeEmail('a+b@gmail.com'), normalizeEmail('ab@gmail.com'));
});
test('refund calculation uses integer minor units and deducts earlier refunds', () => {
  assert.deepEqual(calculateRefund('59.90', '10', '20.25'), { paid: 5990, refunded: 1000, available: 4990, requested: 2025, remaining: 2965 });
  assert.equal(calculateRefund('0.30', '0.10', '0.20').remaining, 0);
  assert.equal(calculateRefund('68', '68', '0').available, 0);
});
test('invalid and excessive refund amounts fail instead of silently rounding', () => {
  for (const amount of ['-1', '1.001', 'NaN', '1e2', '', '49.91']) assert.throws(() => calculateRefund('59.90', '10', amount));
  assert.throws(() => calculateRefund('10', '11', '0'));
});
test('template variables are explicit and unresolved variables block insertion', () => {
  assert.equal(expandTemplate('Hi {{客户姓名}}, {{ 订单号 }} / {{订单号}}', { '客户姓名': 'A', '订单号': 'B' }), 'Hi A, B / B');
  assert.throws(() => expandTemplate('Refund {{拟退款金额}}', {}), /拟退款金额/);
  assert.throws(() => expandTemplate('{{订单号}}', { '订单号': ' ' }));
});
