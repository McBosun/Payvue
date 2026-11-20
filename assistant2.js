/** Rule-based intent parser for the Vue assistant. It only PROPOSES an action; the app must confirm before calling the real endpoint. */
export function parseCommand(text) {
  const t = String(text || '').toLowerCase().replace(/,/g, '').replace(/₦|ngn|naira/g, '');
  const m = t.match(/(\d+(?:\.\d+)?)\s*(k)?\b/);
  const amountKobo = m ? Math.round(parseFloat(m[1]) * (m[2] ? 1000 : 1) * 100) : null;
  const to = t.match(/\bto ([a-z][a-z' -]{1,30})$/) || t.match(/\bto ([a-z][a-z'-]{1,30})/);

  if (/\b(send|transfer|pay)\b/.test(t) && to) return { intent: 'transfer', amountKobo, recipient: to[1].trim(), needsConfirmation: true };
  if (/\bairtime\b/.test(t)) return { intent: 'bill', service: 'airtime', amountKobo, needsConfirmation: true };
  if (/\bdata\b/.test(t)) return { intent: 'bill', service: 'data', amountKobo, needsConfirmation: true };
  if (/\bbalance\b/.test(t)) return { intent: 'balance', needsConfirmation: false };
  if (/\b(spend|spent|spending)\b/.test(t)) return { intent: 'spending_summary', needsConfirmation: false };
  return { intent: 'unknown', needsConfirmation: false };
}
