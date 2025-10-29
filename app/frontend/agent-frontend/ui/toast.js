const box = document.getElementById('toast');
export const toast = (msg) => {
  const el = document.createElement('div');
  el.className = 't';
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3000);
};
