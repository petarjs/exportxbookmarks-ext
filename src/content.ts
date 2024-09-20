import chrome from "webextension-polyfill";

window.addEventListener("message", async (event) => {
  if (event.source !== window) {
    return;
  }

  // Security: Check the origin of the message
  if (event.origin !== window.location.origin) return;

  if (event.data && event.data.type === "requestBookmarks") {
    const { bookmarks } = await chrome.storage.local.get(["bookmarks"]);
    event.source.postMessage(
      { type: "bookmarks", bookmarks },
      window.location.origin
    );
  }
});
