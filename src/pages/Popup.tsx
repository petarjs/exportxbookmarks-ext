import chrome from "webextension-polyfill";

import { useEffect, useState } from "react";
import "./Popup.css";

const ENV = process.env.NODE_ENV || "development";
const DOMAIN =
  ENV === "production"
    ? "https://exportxbookmarks.com"
    : "http://exportxbookmarks.test";

export default function () {
  const [isImporting, setIsImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importedMessage, setImportedMessage] = useState("");

  useEffect(() => {
    const getUserData = () => {
      chrome.runtime.sendMessage({ type: "getJwt" });
    };

    getUserData();

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log("Popup received message", request);

      if (request.type === "import-update") {
        setIsImporting(true);
        setImportedMessage(request.importedMessage);
      }

      if (request.type === "import-done") {
        setIsImporting(false);
        setImportDone(true);
        setImportedMessage(
          `Finished importing ${request.importedCount} bookmarks`
        );

        // Update this line to use the DOMAIN constant
        window.open(`${DOMAIN}/bookmarks?imported=true`, "_blank");
      }
    });
  }, []);

  function startImport() {
    chrome.runtime.sendMessage({ type: "batchImportAll" });
    setIsImporting(true);
  }

  return (
    <div className="container">
      <img src="/icon.svg" />
      <h1>Export X Bookmarks</h1>
      <div className="actions">
        <ol className="steps">
          <li>Make sure you are logged in to X and Export X Bookmarks</li>
          <li>
            Open{" "}
            <a href="https://x.com" target="_blank">
              x.com
            </a>
          </li>
          <li>Open this extention</li>
          <li>Click on the Export Bookmarks button</li>
          <li>
            Don't close the extention or navigate away from the page until the
            process is finished
          </li>
        </ol>

        {isImporting && (
          <div className="info tac">
            Exporting... Please don't close or navigate away
          </div>
        )}

        <div className="info tac">{importedMessage}</div>

        <button className="btn" onClick={startImport} disabled={isImporting}>
          Export Bookmarks
        </button>
      </div>
    </div>
  );
}
