// ===== popup.js =====
document.addEventListener("DOMContentLoaded", async () => {
  await loadStats();
  await loadRecentSites();
  await loadSettings();

  // 設定画面を開く
  document.getElementById("openOptions").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // 有効/無効トグル
  document
    .getElementById("enabledToggle")
    .addEventListener("change", async (e) => {
      const { settings } = await chrome.storage.local.get(["settings"]);
      settings.enabled = e.target.checked;
      await chrome.storage.local.set({ settings });
    });
});

async function loadStats() {
  try {
    const { visitHistory } = await chrome.storage.local.get(["visitHistory"]);
    const currentMonth = new Date().toISOString().substring(0, 7);
    const monthData = visitHistory?.[currentMonth] || {};

    const totalSites = Object.keys(monthData).length;
    const bookmarksAdded = Object.values(monthData).filter(
      (site) => site.bookmarked
    ).length;

    document.getElementById("totalSites").textContent = totalSites;
    document.getElementById("bookmarksAdded").textContent = bookmarksAdded;
  } catch (error) {
    console.error("Error loading stats:", error);
  }
}

async function loadRecentSites() {
  try {
    const { visitHistory } = await chrome.storage.local.get(["visitHistory"]);
    const currentMonth = new Date().toISOString().substring(0, 7);
    const monthData = visitHistory?.[currentMonth] || {};

    const sites = Object.entries(monthData)
      .map(([url, data]) => ({ url, ...data }))
      .sort((a, b) => b.totalCount - a.totalCount)
      .slice(0, 5);

    const listElement = document.getElementById("recentSitesList");
    listElement.innerHTML = "";

    sites.forEach((site) => {
      const item = document.createElement("div");
      item.className = "site-item";

      const domain = new URL(site.url).hostname.replace("www.", "");
      const status = site.bookmarked ? "📑" : `${site.totalCount}/3`;

      item.innerHTML = `
        <a href="${site.url}" class="site-url" target="_blank">${domain}</a>
        <span class="site-count">${status}</span>
      `;

      listElement.appendChild(item);
    });

    if (sites.length === 0) {
      listElement.innerHTML =
        '<div style="color: #5f6368; text-align: center;">No activity this month</div>';
    }
  } catch (error) {
    console.error("Error loading recent sites:", error);
  }
}

async function loadSettings() {
  try {
    const { settings } = await chrome.storage.local.get(["settings"]);
    document.getElementById("enabledToggle").checked =
      settings?.enabled ?? true;
  } catch (error) {
    console.error("Error loading settings:", error);
  }
}
