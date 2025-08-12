// ===== background.js =====
// Service Worker for background processing

// 設定のデフォルト値
const DEFAULT_SETTINGS = {
  enabled: true,
  threshold: 3,
  excludeDailyThreshold: 3,
  keepDataMonths: 6,
  organizationType: "frequency",
  autoCleanup: true,
};

// インストール時の初期化
chrome.runtime.onInstalled.addListener(async () => {
  console.log("Smart Auto Bookmark installed");

  // デフォルト設定を保存
  await chrome.storage.local.set({
    settings: DEFAULT_SETTINGS,
    visitHistory: {},
    redlist: [
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
    ],
  });

  // 自動ブックマークフォルダを作成
  await createAutoBookmarkFolder();

  // 週次クリーンアップアラームを設定
  chrome.alarms.create("cleanup", { periodInMinutes: 10080 }); // 週1回

  // リトライキューアラームを設定
  chrome.alarms.create("retryQueue", { periodInMinutes: 60 });

  // ストレージ容量チェックアラームを設定
  chrome.alarms.create("storageCheck", { periodInMinutes: 1440 }); // 日1回
});

// タブ更新の監視
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    await processVisit(tab.url, tab.title || "Untitled");
  }
});

// アラーム処理（クリーンアップ）
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "cleanup") {
    await performCleanup();
  } else if (alarm.name === "retryQueue") {
    await processRetryQueue();
  } else if (alarm.name === "storageCheck") {
    await checkStorageUsage();
  }
});

// 訪問処理のメイン関数
async function processVisit(url, title) {
  try {
    const { settings } = await chrome.storage.local.get(["settings"]);
    if (!settings?.enabled) return;

    // 無効なURLやレッドリストチェック
    if (!isValidUrl(url) || (await isRedlisted(url))) return;

    const today = new Date().toISOString().split("T")[0];
    const monthKey = today.substring(0, 7);

    // 既存データを取得
    const { visitHistory } = await chrome.storage.local.get(["visitHistory"]);
    const history = visitHistory || {};

    // 月データの初期化
    if (!history[monthKey]) history[monthKey] = {};
    if (!history[monthKey][url]) {
      history[monthKey][url] = {
        dailyVisits: {},
        totalCount: 0,
        title: title,
        bookmarked: false,
        firstVisit: today,
      };
    }

    const urlData = history[monthKey][url];

    // タイトルを最新のものに更新
    urlData.title = title;

    // 日別訪問回数を記録
    urlData.dailyVisits[today] = (urlData.dailyVisits[today] || 0) + 1;

    // メモリリーク対策：日次訪問データの上限設定（31日分まで保持）
    if (Object.keys(urlData.dailyVisits).length > 31) {
      // 古いデータを削除
      const dates = Object.keys(urlData.dailyVisits).sort();
      dates.slice(0, -31).forEach((date) => {
        delete urlData.dailyVisits[date];
      });
    }

    // 今日の訪問が除外閾値を超えた場合は早期リターン
    if (urlData.dailyVisits[today] >= settings.excludeDailyThreshold) {
      await chrome.storage.local.set({ visitHistory: history });
      return;
    }

    // 月間総訪問回数を計算（1日最大2回まで）
    urlData.totalCount = Object.values(urlData.dailyVisits).reduce(
      (sum, dailyCount) => sum + Math.min(dailyCount, 2),
      0
    );

    // 閾値に達したらブックマーク追加
    if (urlData.totalCount >= settings.threshold && !urlData.bookmarked) {
      const success = await addToBookmarksWithRetry(url, title, urlData);
      if (success) {
        urlData.bookmarked = true;

        // 通知を表示
        await showBookmarkNotification(url, title, urlData.totalCount);
      }
    }

    // データを保存
    await chrome.storage.local.set({ visitHistory: history });
  } catch (error) {
    console.error("Error processing visit:", error);
  }
}

// 有効なURLかチェック
function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    return ["http:", "https:"].includes(urlObj.protocol);
  } catch {
    return false;
  }
}

// レッドリストチェック
async function isRedlisted(url) {
  try {
    const { redlist } = await chrome.storage.local.get(["redlist"]);
    if (!redlist) return false;

    return redlist.some((item) => {
      if (item.pattern.includes("*")) {
        return matchWildcard(url, item.pattern);
      }
      return url.includes(item.pattern);
    });
  } catch {
    return false;
  }
}

// ワイルドカードマッチング
function matchWildcard(str, pattern) {
  const regexPattern = pattern.replace(/\*/g, ".*").replace(/\?/g, ".");
  const regex = new RegExp("^" + regexPattern + "$");
  return regex.test(str);
}

// 自動ブックマークフォルダの作成
async function createAutoBookmarkFolder() {
  try {
    const bookmarks = await chrome.bookmarks.search({
      title: "Auto Bookmarks",
    });
    if (bookmarks.length === 0) {
      const [bookmarkBar] = await chrome.bookmarks.getTree();
      const folder = await chrome.bookmarks.create({
        parentId: bookmarkBar.children[0].id,
        title: "Auto Bookmarks",
      });
      return folder;
    }
    return bookmarks[0];
  } catch (error) {
    console.error("Error creating auto bookmark folder:", error);
    return null;
  }
}

// 頻度別フォルダの取得/作成
async function getFrequencyFolder(visitCount, visitDays) {
  const autoFolder = await createAutoBookmarkFolder();
  if (!autoFolder) return null;

  let folderName;
  if (visitCount >= 15) {
    folderName = "🔥 Daily";
  } else if (visitCount >= 7) {
    folderName = "⭐ Regular";
  } else if (visitCount >= 4) {
    folderName = "📅 Weekly";
  } else {
    folderName = "💡 New";
  }

  // サブフォルダを検索/作成
  const subfolders = await chrome.bookmarks.getChildren(autoFolder.id);
  let targetFolder = subfolders.find((folder) => folder.title === folderName);

  if (!targetFolder) {
    targetFolder = await chrome.bookmarks.create({
      parentId: autoFolder.id,
      title: folderName,
    });
  }

  return targetFolder;
}

// ブックマーク追加（リトライ機能付き）
async function addToBookmarksWithRetry(url, title, visitData, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      // 重複チェック
      const existingBookmarks = await chrome.bookmarks.search({ url });
      if (existingBookmarks.length > 0) {
        console.log("Bookmark already exists:", url);
        return true;
      }

      // 適切なフォルダを取得
      const visitDays = Object.keys(visitData.dailyVisits).length;
      const folder = await getFrequencyFolder(visitData.totalCount, visitDays);

      if (!folder) {
        throw new Error("Could not create folder");
      }

      // ブックマークを作成
      await chrome.bookmarks.create({
        parentId: folder.id,
        title: title,
        url: url,
      });

      console.log("Bookmark created:", title);
      return true;
    } catch (error) {
      console.log(`Bookmark creation failed (attempt ${i + 1}):`, error);

      if (i === maxRetries - 1) {
        // 最後の試行も失敗した場合、再試行キューに追加
        await addToRetryQueue(url, title, visitData);
        return false;
      }

      // 1秒待ってから再試行
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return false;
}

// 再試行キューに追加
async function addToRetryQueue(url, title, visitData) {
  try {
    const { retryQueue } = await chrome.storage.local.get(["retryQueue"]);
    const queue = retryQueue || [];

    queue.push({
      url,
      title,
      visitData,
      timestamp: Date.now(),
    });

    await chrome.storage.local.set({ retryQueue: queue });
  } catch (error) {
    console.error("Error adding to retry queue:", error);
  }
}

// リトライキューの処理
async function processRetryQueue() {
  const { retryQueue } = await chrome.storage.local.get(["retryQueue"]);
  if (!retryQueue || retryQueue.length === 0) return;

  const newQueue = [];
  const now = Date.now();
  const RETRY_DELAY = 60 * 60 * 1000; // 1時間後に再試行

  for (const item of retryQueue) {
    if (now - item.timestamp > RETRY_DELAY) {
      const success = await addToBookmarksWithRetry(
        item.url,
        item.title,
        item.visitData,
        1 // 1回だけ再試行
      );
      if (!success) {
        newQueue.push(item);
      }
    } else {
      newQueue.push(item);
    }
  }

  await chrome.storage.local.set({ retryQueue: newQueue });
}

// 通知表示
async function showBookmarkNotification(url, title, visitCount) {
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    // IDを指定し、Promiseを適切に処理
    chrome.notifications.create(
      "bookmark-" + Date.now(),
      {
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "Auto Bookmark Added",
        message: `${domain} (${visitCount} visits)\n"${title}"`,
        priority: 0,
      },
      (notificationId) => {
        if (chrome.runtime.lastError) {
          console.error("Notification error:", chrome.runtime.lastError);
        }
      }
    );
  } catch (error) {
    console.error("Error showing notification:", error);
  }
}

// ストレージ容量チェック
async function checkStorageUsage() {
  const bytesInUse = await chrome.storage.local.getBytesInUse();
  const MAX_BYTES = chrome.storage.local.QUOTA_BYTES;

  if (bytesInUse > MAX_BYTES * 0.8) {
    // 80%を超えたら警告
    console.warn(
      "Storage usage high:",
      Math.round((bytesInUse / MAX_BYTES) * 100) + "%"
    );
    // 古いデータの強制クリーンアップ
    await performCleanup();
  }
}

// 定期クリーンアップ
async function performCleanup() {
  try {
    const { visitHistory, settings } = await chrome.storage.local.get([
      "visitHistory",
      "settings",
    ]);
    const keepMonths = settings?.keepDataMonths || 6;

    if (!visitHistory || !settings?.autoCleanup) return;

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - keepMonths);
    const cutoffKey = `${cutoffDate.getFullYear()}-${String(
      cutoffDate.getMonth() + 1
    ).padStart(2, "0")}`;

    // 古いデータを削除
    const updatedHistory = {};
    Object.keys(visitHistory).forEach((monthKey) => {
      if (monthKey >= cutoffKey) {
        updatedHistory[monthKey] = visitHistory[monthKey];
      }
    });

    await chrome.storage.local.set({ visitHistory: updatedHistory });
    console.log("Cleanup completed");
  } catch (error) {
    console.error("Error during cleanup:", error);
  }
}
