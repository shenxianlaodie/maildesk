(function (root) {
  'use strict';
  const normalizeEmail = value => String(value || '').trim().toLowerCase();
  function groupCustomers(messages) {
    const groups = new Map();
    for (const message of messages) {
      const key = normalizeEmail(message.email);
      if (!groups.has(key)) groups.set(key, { email: key, name: message.name, originals: [], messages: [] });
      groups.get(key).originals.push(message);
    }
    for (const customer of groups.values()) {
      const seen = new Map();
      for (const message of customer.originals) {
        const key = message.messageId || `local:${message.id}`;
        if (!seen.has(key)) {
          const merged = { ...message, sourceIds: [message.id], accounts: [message.account] };
          seen.set(key, merged);
          customer.messages.push(merged);
        } else {
          const merged = seen.get(key);
          merged.sourceIds.push(message.id);
          if (!merged.accounts.includes(message.account)) merged.accounts.push(message.account);
        }
      }
      customer.messages.sort((a, b) => a.at.localeCompare(b.at));
      customer.accounts = [...new Set(customer.originals.map(m => m.account))];
      customer.pending = customer.originals.some(m => !m.done);
      customer.last = customer.messages[customer.messages.length - 1];
    }
    return [...groups.values()].sort((a, b) => b.last.at.localeCompare(a.last.at));
  }
  function cents(value) {
    const text = String(value).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('请输入非负金额，最多两位小数');
    const [whole, fraction = ''] = text.split('.');
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(amount)) throw new Error('金额超出范围');
    return amount;
  }
  function calculateRefund(paid, refunded, requested) {
    const total = cents(paid), previous = cents(refunded), next = cents(requested);
    if (previous > total) throw new Error('已退金额大于实付金额，请核对订单');
    const available = total - previous;
    if (next > available) throw new Error('本次拟退款不能超过剩余可退金额');
    return { paid: total, refunded: previous, available, requested: next, remaining: available - next };
  }
  function templateVariables(text) { return [...new Set([...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(m => m[1]))]; }
  function expandTemplate(text, values) {
    const missing = templateVariables(text).filter(key => values[key] === undefined || String(values[key]).trim() === '');
    if (missing.length) throw new Error(`请填写变量：${missing.join('、')}`);
    return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => String(values[key]));
  }
  const api = { normalizeEmail, groupCustomers, cents, calculateRefund, templateVariables, expandTemplate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MailCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
