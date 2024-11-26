// Configuration
const IS_DEV = false; // Set to true only during development

// Minimal logging wrapper
const log = (...args) => {
  if (IS_DEV) {
    console.log("[Rush Melt Tube]", ...args);
  }
};

// Listen for clicks on the browser action (extension icon)
browser.browserAction.onClicked.addListener(async (tab) => {
  try {
    // Only process YouTube videos
    if (!tab.url.includes("youtube.com/watch?v=")) {
      log("Not a YouTube video page");
      return;
    }

    // Send message to content script to start the summary process
    await browser.tabs.sendMessage(tab.id, {
      action: "START_SUMMARY",
    });
  } catch (error) {
    // Only log actual errors
    console.error("[Rush Melt Tube] Error in background script:", error);
  }
});

// Handle messages from content script
browser.runtime.onMessage.addListener(async (message, sender) => {
  try {
    switch (message.type) {
      case "GETTING_SUMMARY":
        await browser.tabs.sendMessage(sender.tab.id, {
          action: "UPDATE_POPUP",
          message: message.detail || "Getting summary...",
        });
        break;

      case "SUMMARY_ERROR":
        await browser.tabs.sendMessage(sender.tab.id, {
          action: "UPDATE_POPUP",
          message: `Error: ${message.error}`,
        });
        break;

      case "SUMMARY_COMPLETE":
        await browser.tabs.sendMessage(sender.tab.id, {
          action: "UPDATE_POPUP",
          message: message.summary,
        });
        break;
    }
  } catch (error) {
    console.error("[Rush Melt Tube] Error handling message:", error);
  }
});
