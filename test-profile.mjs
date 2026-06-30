import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const SCRATCHPAD = "C:/Users/Samithin/AppData/Local/Temp/claude/D--Famman/c6600d9d-3828-43b1-9066-5ab9da814bf1/scratchpad";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// 1. Hit /profile unauthenticated — should redirect to /login
await page.goto("http://localhost:3000/profile", { waitUntil: "networkidle" });
console.log("Unauthenticated /profile → landed on:", page.url());
await page.screenshot({ path: SCRATCHPAD + "/01-login-redirect.png", fullPage: true });

await browser.close();
console.log("Done. Screenshot saved.");
