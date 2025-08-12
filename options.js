// ===== options.js =====
let redlistData = [];

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await loadRedlist();

  // イベントリスナー設定
  document
    .getElementById("saveSettings")
    .addEventListener("click", saveSettings);
  document
    .getElementById("addRedlistItem")
    .addEventListener("click", addRedlistItem);
  document
    .getElementById("exportSettings")
    .addEventListener("click", exportSettings);
  document
    .getElementById("importSettings")
    .addEventListener("click", importSettings);
  document.getElementById("resetData").addEventListener("click", resetData);
});

async function loadSettings() {
  try {
    const { settings } = await chrome.storage.local.get(["settings"]);

    if (settings) {
      document.getElementById("threshold").value = settings.threshold || 3;
      document.getElementById("excludeDailyThreshold").value =
        settings.excludeDailyThreshold || 3;
      document.getElementById("organizationType").value =
        settings.organizationType || "frequency";
      document.getElementById("keepDataMonths").value =
        settings.keepDataMonths || 6;
    }
  } catch (error) {
    console.error("Error loading settings:", error);
  }
}

async function loadRedlist() {
  try {
    const { redlist } = await chrome.storage.local.get(["redlist"]);
    redlistData = redlist || [];
    renderRedlist();
  } catch (error) {
    console.error("Error loading redlist:", error);
  }
}

function renderRedlist() {
  const container = document.getElementById("redlistContainer");
  container.innerHTML = "";

  redlistData.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "redlist-item";

    div.innerHTML = `
      <input type="url" placeholder="https://example.com" value="${item.url}" 
             onchange="updateRedlistItem(${index}, 'url', this.value)">
      <input type="text" placeholder="*.example.com" value="${item.pattern}" 
             onchange="updateRedlistItem(${index}, 'pattern', this.value)">
      <input type="text" placeholder="Description" value="${item.description}" 
             onchange="updateRedlistItem(${index}, 'description', this.value)">
      <button class="button danger" onclick="removeRedlistItem(${index})">Remove</button>
    `;

    container.appendChild(div);
  });
}

function addRedlistItem() {
  redlistData.push({
    url: "",
    pattern: "",
    description: "",
  });
  renderRedlist();
}

function updateRedlistItem(index, field, value) {
  if (redlistData[index]) {
    redlistData[index][field] = value;
  }
}

function removeRedlistItem(index) {
  redlistData.splice(index, 1);
  renderRedlist();
}

async function saveSettings() {
  try {
    const settings = {
      enabled: true,
      threshold: parseInt(document.getElementById("threshold").value),
      excludeDailyThreshold: parseInt(
        document.getElementById("excludeDailyThreshold").value
      ),
      organizationType: document.getElementById("organizationType").value,
      keepDataMonths: parseInt(document.getElementById("keepDataMonths").value),
      autoCleanup: true,
    };

    await chrome.storage.local.set({
      settings,
      redlist: redlistData,
    });

    // 成功メッセージを表示
    const message = document.getElementById("successMessage");
    message.style.display = "block";
    setTimeout(() => {
      message.style.display = "none";
    }, 3000);
  } catch (error) {
    console.error("Error saving settings:", error);
    alert("Error saving settings. Please try again.");
  }
}

async function exportSettings() {
  try {
    const data = await chrome.storage.local.get(["settings", "redlist"]);
    const exportData = {
      settings: data.settings,
      redlist: data.redlist,
      exportDate: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `smart-bookmark-settings-${
      new Date().toISOString().split("T")[0]
    }.json`;
    a.click();

    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error exporting settings:", error);
  }
}

function importSettings() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  input.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      if (importData.settings && importData.redlist) {
        await chrome.storage.local.set({
          settings: importData.settings,
          redlist: importData.redlist,
        });

        // UI を更新
        await loadSettings();
        redlistData = importData.redlist;
        renderRedlist();

        alert("Settings imported successfully!");
      } else {
        alert("Invalid settings file format.");
      }
    } catch (error) {
      console.error("Error importing settings:", error);
      alert("Error importing settings. Please check the file format.");
    }
  });

  input.click();
}

async function resetData() {
  if (
    confirm("Are you sure you want to reset all data? This cannot be undone.")
  ) {
    try {
      await chrome.storage.local.clear();

      // デフォルト設定を再設定
      const defaultSettings = {
        enabled: true,
        threshold: 3,
        excludeDailyThreshold: 3,
        keepDataMonths: 6,
        organizationType: "frequency",
        autoCleanup: true,
      };

      const defaultRedlist = [
        {
          url: "chrome://",
          pattern: "chrome://*",
          description: "Chrome内部ページ",
        },
        {
          url: "chrome-extension://",
          pattern: "chrome-extension://*",
          description: "拡張機能ページ",
        },
      ];

      await chrome.storage.local.set({
        settings: defaultSettings,
        redlist: defaultRedlist,
        visitHistory: {},
      });

      // UI を更新
      await loadSettings();
      redlistData = defaultRedlist;
      renderRedlist();

      alert("All data has been reset to defaults.");
    } catch (error) {
      console.error("Error resetting data:", error);
      alert("Error resetting data. Please try again.");
    }
  }
}

// グローバル関数として定義（HTML内のonchange属性から呼び出される）
window.updateRedlistItem = updateRedlistItem;
window.removeRedlistItem = removeRedlistItem;
