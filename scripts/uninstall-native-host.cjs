#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const os = require("os");

const HOST_NAME = "com.pi.chrome.host";

let manifestDir;
switch (process.platform) {
  case "darwin":
    manifestDir = path.join(
      os.homedir(),
      "Library/Application Support/Google/Chrome/NativeMessagingHosts"
    );
    break;
  case "linux":
    manifestDir = path.join(
      os.homedir(),
      ".config/google-chrome/NativeMessagingHosts"
    );
    break;
  default:
    console.log("Windows: Remove registry entry manually.");
    process.exit(0);
}

const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);
try {
  fs.unlinkSync(manifestPath);
  console.log(`Removed: ${manifestPath}`);
} catch {
  console.log("Manifest not found");
}
