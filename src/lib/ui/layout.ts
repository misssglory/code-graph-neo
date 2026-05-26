export function applyPaneTransparency(root, value, valueEl) {
  root.style.setProperty('--panel-alpha', String(value));
  root.style.setProperty('--panel-alpha-2', String(Math.max(0.04, value - 0.10)));
  valueEl.textContent = Number(value).toFixed(2);
}

export function setActiveTab(tabButtons, tabPanels, tabId) {
  tabButtons.forEach((btn) => btn.dataset.active = btn.dataset.tabButton === tabId ? 'true' : 'false');
  tabPanels.forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== tabId; });
}

export function setSidebarCollapsed(appRoot, button, collapsed) {
  appRoot.dataset.sidebarCollapsed = collapsed ? 'true' : 'false';
  button.textContent = collapsed ? '←' : '→';
  button.setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel');
  button.setAttribute('title', collapsed ? 'Expand panel' : 'Collapse panel');
}