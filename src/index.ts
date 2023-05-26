import dotenv from "dotenv";
import consoleStamp from "console-stamp";
import puppeteer from "puppeteer-core";
import { default as start } from "./start.js";

// Διάβασε τις ρυθμίσεις από το .env αρχείο
dotenv.config();

// Πρόσθεσε χρονοσφραγίδα στα μηνύματα του αρχείου καταγραφής
consoleStamp(console);

(async () => {
  console.log("Εκκίνηση νέας εργασίας");

  console.log("Αρχικοποίηση σύνδεσης με τον φυλλομετρητή");
  const browser = await puppeteer.connect({
    // defaultViewport: { width: 1920, height: 1080 },
    browserWSEndpoint: "ws://host.docker.internal:3000",
    ignoreHTTPSErrors: true,
  });
  const page = await browser.newPage();

  if (
    process.env.SCRAPE_TEST_REMOTE_DEBUG &&
    process.env.SCRAPE_TEST_REMOTE_DEBUG === "true"
  ) {
    // https://github.com/puppeteer/puppeteer/issues/5730
    console.log(
      "Remote debugging enabled, disabling touch events before click."
    );

    page.click = (function (originalMethod, context) {
      return async function (...args) {
        const CDPSession = await context.target().createCDPSession();
        await CDPSession.send("Emulation.setEmitTouchEventsForMouse", {
          enabled: false,
        });
        await CDPSession.send("Emulation.setTouchEmulationEnabled", {
          enabled: false,
        });
        return originalMethod.apply(context, [...args]);
      };
    })(page.click, page);
  }

  await start({ page, browser }).catch(async (err) => {
    console.log(err);
    await page.screenshot({ path: "error.png" });
    return Promise.reject(err);
  });

  for (let page of await browser.pages()) {
    await page.close();
  }

  const response = await browser.close();
  return response;
})()
  .then(() => console.log("Η εργασία ολοκληρώθηκε!"))
  .catch((err) => {
    process.exit(1);
  });
