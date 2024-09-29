import chrome from "webextension-polyfill";

console.log("Hello from the background!");

import { Tweet } from "react-tweet/api";
import { features, transformTweetData } from "./helpers";

// Constants for URLs and initial settings
const BOOKMARKS_URL = `https://x.com/i/api/graphql/xLjCVTqYWz8CGSprLU349w/Bookmarks?features=${encodeURIComponent(
  JSON.stringify(features)
)}`;
const BACKEND_URL = "https://api.exportxbookmarks.com";
const INITIAL_WAIT_TIME = 60000; // 1 minute in milliseconds
let waitTime = INITIAL_WAIT_TIME;

// Core function to handle batch import of bookmarks
const batchImportAll = async (
  cursor = "",
  totalImported = 0
): Promise<void> => {
  try {
    console.log("Importing bookmarks", { cursor, totalImported });
    const { cookie, csrf, auth } = await chrome.storage.session.get([
      "cookie",
      "csrf",
      "auth",
    ]);

    if (!cookie || !csrf || !auth) return;

    const headers = new Headers({
      Cookie: cookie,
      "X-Csrf-token": csrf,
      Authorization: auth,
    });

    const variables = {
      count: 100,
      ...(cursor && { cursor }),
      includePromotedContent: false,
    };

    const urlWithCursor = `${BOOKMARKS_URL}&variables=${encodeURIComponent(
      JSON.stringify(variables)
    )}`;

    const response = await fetch(urlWithCursor, { method: "GET", headers });

    if (!response.ok) {
      if (response.status === 429) {
        console.error("Rate limit exceeded");
        await handleRateLimit();
        return batchImportAll(cursor, totalImported); // Retry after waiting
      }
      throw new Error("Failed to fetch data");
    }

    const data = await response.json();
    const tweets = getAllTweets(data);

    try {
      await importTweets(tweets);
      totalImported += tweets.length;
      await updateImportProgress(totalImported);
    } catch (error) {
      console.error("Error importing tweet:", error);
      await handleAppError();
      return; // Stop the process
    }

    // for (const tweet of tweets) {
    //   const tweetMarkdown = tweetToMarkdown(tweet);
    //   try {
    //     // await importTweet(tweetMarkdown, tweet);
    //     totalImported++;
    //     await updateImportProgress(totalImported);
    //   } catch (error) {
    //     console.error("Error importing tweet:", error);
    //     await handleAppError();
    //     return; // Stop the process
    //   }
    // }

    await handleNextCursor(data, cursor, totalImported);

    waitTime = INITIAL_WAIT_TIME; // Reset wait time after successful import
  } catch (error) {
    console.error(error);
    await handleRateLimit();
    batchImportAll(cursor, totalImported); // Retry after waiting
  }
};

// Helper function to handle the next cursor in the pagination
const handleNextCursor = async (
  data: any,
  cursor: string,
  totalImported: number
): Promise<void> => {
  const instructions = data.data?.bookmark_timeline_v2?.timeline?.instructions;
  const cursorInstruction = instructions?.[0]?.entries.find((e: any) =>
    e.entryId.startsWith("cursor-bottom-")
  );

  let nextCursor = cursorInstruction?.content?.value;

  if (nextCursor && nextCursor !== cursor) {
    await delay(1000); // 1 second delay between batches
    batchImportAll(nextCursor, totalImported); // Recursively call with new cursor
  } else {
    await sendImportDoneMessage(totalImported);
  }
};

// Utility function to delay execution
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Function to handle rate limits
const handleRateLimit = async (): Promise<void> => {
  console.log(`Waiting for ${waitTime / 1000} seconds due to rate limit...`);
  await sendMessageToCurrentTab(
    `Rate limit reached. Waiting for ${
      waitTime / 1000
    } seconds before retrying...`
  );
  await delay(waitTime);
  waitTime *= 2; // Double the wait time for next potential rate limit
};

// Function to handle errors
const handleAppError = async (): Promise<void> => {
  const errorMessage =
    "ALERT: Export X Bookmarks is unable to save tweets right now. Please contact support at @SaaSNoCap";
  console.error(errorMessage);
  await sendMessageToCurrentTab(errorMessage);
};

// Function to send a message to the current active tab
const sendMessageToCurrentTab = async (message: string): Promise<void> => {
  // const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // if (tab?.id) {
  //   await chrome.tabs.sendMessage(tab.id, {
  //     type: "import-update",
  //     importedMessage: message,
  //   });
  // }

  await chrome.runtime.sendMessage({
    type: "import-update",
    importedMessage: message,
  });
};

// Function to update import progress
const updateImportProgress = async (totalImported: number): Promise<void> => {
  await sendMessageToCurrentTab(`Imported ${totalImported} tweets`);
};

// Function to import a single tweet
const importTweet = async (
  tweetMarkdown: string,
  tweet: Tweet
): Promise<void> => {
  const { jwt } = await chrome.storage.local.get(["jwt"]);

  // if (!jwt) throw new Error("No JWT found");

  const response = await fetch(`${BACKEND_URL}/api/store`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      pageContent: tweetMarkdown,
      title: `Tweet by ${tweet.user.name}`,
      description: tweet.text.slice(0, 200),
      type: "tweet",
    }),
  });

  if (!response.ok) {
    if (response.status === 444) return; // Skip saving if the tweet already exists
    throw new Error("Failed to save tweet");
  }

  console.log("Tweet saved successfully");
};

function extractTweetInfo(tweet: Tweet & { images?: string[] }): any {
  return {
    id: tweet.id_str,
    content: tweet.text,
    images: tweet.images,
    created_at: tweet.created_at,
    user: {
      name: tweet.user.name,
      screen_name: tweet.user.screen_name,
      profile_image: tweet.user.profile_image_url_https,
      verified: tweet.user.verified,
      is_blue_verified: tweet.user.is_blue_verified,
    },
    raw: tweet,
  };
}

const APP_URL = "https://exportxbookmarks.test";

const importTweets = async (tweets: Tweet[]): Promise<void> => {
  const formattedTweets = tweets.map((t) => extractTweetInfo(t));

  const existingBookmarks = await chrome.storage.local.get(["bookmarks"]);
  const bookmarks = existingBookmarks.bookmarks
    ? [...existingBookmarks.bookmarks, ...formattedTweets]
    : formattedTweets;

  await chrome.storage.local.set({ bookmarks });
  console.log("Bookmarks saved successfully");
};

// Function to send a message indicating the import is complete
const sendImportDoneMessage = async (totalImported: number): Promise<void> => {
  console.log("All bookmarks imported");
  await chrome.runtime.sendMessage({
    type: "import-done",
    importedCount: totalImported,
  });
};

// Function to extract all tweets from the raw JSON response
const getAllTweets = (rawJson: any): Tweet[] => {
  const entries =
    rawJson?.data?.bookmark_timeline_v2?.timeline?.instructions[0]?.entries;

  if (!entries) {
    console.error("No entries found");
    return [];
  }

  return entries
    .map((entry: any) => transformTweetData(entry))
    .filter((tweet: Tweet | null) => tweet !== null) as Tweet[];
};

// Listener for capturing request headers for authorization
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!details.url.includes("x.com") && !details.url.includes("twitter.com"))
      return;

    const headers = extractHeaders(details.requestHeaders);
    if (!headers.auth || !headers.cookie || !headers.csrf) return;

    chrome.storage.session.set(headers);

    // Check and manage cache logic
    chrome.storage.local
      .get(["lastFetch", "cachedData"])
      .then(({ lastFetch, cachedData }) => {
        const now = Date.now();
        if (lastFetch && now - lastFetch < 30 * 60 * 1000) {
          console.log("Using cached data");
          console.log(cachedData);
        } else {
          chrome.storage.session.set(headers);
        }
      })
      .catch((error) => {
        console.error("Error accessing chrome.storage.local:", error);
      });
  },
  { urls: ["*://x.com/*", "*://twitter.com/*"] },
  ["requestHeaders", "extraHeaders"]
);

// Helper function to extract necessary headers
const extractHeaders = (
  requestHeaders?: chrome.WebRequest.HttpHeaders
): { auth: string; cookie: string; csrf: string } => {
  const getHeaderValue = (name: string) =>
    requestHeaders?.find((header) => header.name.toLowerCase() === name)
      ?.value || "";
  return {
    auth: getHeaderValue("authorization"),
    cookie: getHeaderValue("cookie"),
    csrf: getHeaderValue("x-csrf-token"),
  };
};

// Function to handle the message, regardless of its source
const handleMessage = async (request: any, sender: any, sendResponse: any) => {
  if (request.type === "requestBookmarks") {
    // Your logic to handle the requestBookmarks message
    console.log("Received requestBookmarks message");

    const { bookmarks } = await chrome.storage.local.get(["bookmarks"]);
    // @ts-ignore
    sendResponse({ bookmarks });
    return true;
  }

  if (request.type === "batchImportAll") {
    console.log("Starting import");
    await chrome.storage.local.remove(["bookmarks"]);
    batchImportAll();
    return true;
  }
};

// Listen for messages from the extension itself (for local development)
chrome.runtime.onMessage.addListener(handleMessage);

// Listen for messages from external sources (for production)
chrome.runtime.onMessageExternal.addListener(handleMessage);

// Listener for installation events
chrome.runtime.onInstalled.addListener((details) => {});
