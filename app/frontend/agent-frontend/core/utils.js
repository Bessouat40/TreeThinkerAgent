export const escHTML = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const pretty = (obj) => {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
};

export const shortText = (obj, max = 120) => {
  const s = typeof obj === 'string' ? obj : pretty(obj);
  return s.length > max ? s.slice(0, max) + '…' : s;
};

export const safeToolText = (v, max = 220) => {
  try {
    if (typeof v === 'object' && v !== null)
      return escHTML(shortText(JSON.stringify(v, null, 2), max));
    return escHTML(shortText(String(v), max));
  } catch {
    return escHTML(shortText(String(v), max));
  }
};
