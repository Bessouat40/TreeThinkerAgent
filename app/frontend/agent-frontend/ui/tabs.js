export function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const panels = {
    nodes: 'tab-nodes',
    settings: 'tab-settings',
  };

  function updatePanels(activeTab) {
    for (const [k, id] of Object.entries(panels)) {
      document.getElementById(id).style.display =
        activeTab.dataset.tab === k ? 'block' : 'none';
    }
  }

  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      updatePanels(t);
    })
  );

  const activeTab = document.querySelector('.tab.active');
  if (activeTab) {
    updatePanels(activeTab);
  }
}
