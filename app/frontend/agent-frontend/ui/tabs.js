export function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const panels = {
    history: 'tab-history',
    nodes: 'tab-nodes',
    settings: 'tab-settings',
  };

  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      for (const [k, id] of Object.entries(panels)) {
        document.getElementById(id).style.display =
          t.dataset.tab === k ? 'block' : 'none';
      }
    })
  );
}
