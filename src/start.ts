import { Browser, ElementHandle, Page } from "puppeteer-core";
import fs from "fs";

function holdBeforeFileExists(filePath: string, timeout: number, afm: string) {
  console.log(filePath);
  timeout = timeout < 1000 ? 1000 : timeout;
  return new Promise<void>((resolve) => {
    var timer = setTimeout(() => {
      console.log("Timeout!");
      resolve();
    }, timeout);

    var inter = setInterval(() => {
      if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
        clearInterval(inter);
        clearTimeout(timer);

        if (process.env.AFM_FOREA) {
          fs.rename(
            filePath,
            filePath.replace(process.env.AFM_FOREA, afm),
            (err) => {
              if (err) throw err;
              console.log("Rename complete!");
            }
          );
        } else {
          throw new Error("Δεν έχει οριστεί η τιμή για το AFM_FOREA!");
        }
        resolve();
      }
    }, 100);
  });
}

const downloadFiles = async (
  ids: Array<string>,
  afm: Array<string>,
  baseUrl: string,
  browser: Browser
) => {
  for (let i = 0; i < ids.length; i++) {
    const page = await browser.newPage();
    const url = `${baseUrl}/AnaggeliesPrintPDF.aspx?id=${ids[i]}`;

    const client = await page.target().createCDPSession();

    await client.send("Fetch.enable", {
      patterns: [
        {
          urlPattern: "*",
          requestStage: "Response",
        },
      ],
    });

    client.on("Fetch.requestPaused", async (reqEvent) => {
      const { requestId } = reqEvent;

      let responseHeaders = reqEvent.responseHeaders || [];
      let contentType = "";

      for (let elements of responseHeaders) {
        if (elements.name.toLowerCase() === "content-type") {
          contentType = elements.value;
        }
      }

      if (contentType.endsWith("pdf")) {
        responseHeaders.push({
          name: "content-disposition",
          value: "attachment",
        });

        const responseObj = await client.send("Fetch.getResponseBody", {
          requestId,
        });

        await client.send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders,
          body: responseObj.body,
        });
      } else {
        await client.send("Fetch.continueRequest", { requestId });
      }
    });

    console.log(`Downloading ${url}`);

    try {
      await page.goto(url);
    } catch (e) {
      if (e instanceof Error) {
        if (!e.message.includes("net::ERR_ABORTED")) {
          console.error(e);
        }
      } else {
        console.error(e);
      }
    }

    await client.send("Fetch.disable");

    // Μην βομβαρδίσεις τον server, περίμενε 1 δευτερόλεπτο πριν το επόμενο αίτημα
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });

    await holdBeforeFileExists(
      `${process.env.PUPPETEER_DOWNLOAD_DIR}/${process.env.AFM_FOREA}-${ids[i]}.pdf`,
      20000,
      afm[i]
    );
    await page.close();
  }

  console.log("done");
  return Promise.resolve();
};

export default async function start({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}): Promise<void> {
  // ---------------
  // Κάνε login στο σύστημα
  console.log("Εμφάνισε αρχική σελίδα");
  await page.goto("https://eservices.yeka.gr/", { waitUntil: "networkidle0" });

  if (
    typeof process.env.ERGANI_USERNAME === "undefined" ||
    typeof process.env.ERGANI_PASSWORD === "undefined"
  ) {
    console.log("MYSCH_USERNAME και MYSCH_PASSWORD είναι κενά!");
    return;
  }
  await page.type(
    "#ctl00_ctl00_ContentHolder_ContentHolder_SiteLogin_UserName",
    process.env.ERGANI_USERNAME
  );
  await page.type(
    "#ctl00_ctl00_ContentHolder_ContentHolder_SiteLogin_Password",
    process.env.ERGANI_PASSWORD
  );
  console.log("Κάνε login");
  await Promise.all([
    page.click("#ctl00_ctl00_ContentHolder_ContentHolder_SiteLogin_Login"),
    page.waitForNavigation(),
  ]);
  // ---------------

  // ---------------
  // Πήγαινε στην αναζήτηση αναγγελιών
  console.log("Πήγαινε στην αναζήτηση αναγγελιών");
  await Promise.all([
    page.goto("https://eservices.yeka.gr/Anaggelies/AnaggeliesSearch.aspx"),
    page.waitForNavigation(),
  ]);
  await page
    .waitForSelector(
      "#ctl00_ctl00_ContentHolder_ContentHolder_AnaggeliesSearchControl_SKYpobolesList"
    )
    .then(async (response) => {
      console.log(
        "Επέλεξε τύπο αναγγελίας σε Υποβληθείσα Ε7 μέσα στο απαιτούμενο διάστημα"
      );
      return await Promise.all([
        page.select(
          "#ctl00_ctl00_ContentHolder_ContentHolder_AnaggeliesSearchControl_SKYpobolesList",
          "11" // Ε7
        ),
        page.select(
          "#ctl00_ctl00_ContentHolder_ContentHolder_AnaggeliesSearchControl_StatusList",
          "Submitted" // Υποβληθείσα
        ),
      ]);
    })
    .then(async () => {
      return await page.type(
        "#igtxtctl00_ctl00_ContentHolder_ContentHolder_AnaggeliesSearchControl_DateYpobolisFromEdit",
        process.env.FROM ?? "",
        { delay: 300 }
      );
    })
    .then(async () => {
      return await page.waitForSelector(
        "#igtxtctl00_ctl00_ContentHolder_ContentHolder_AnaggeliesSearchControl_DateYpobolisToEdit"
      );
    })
    .then(async () => {
      return await page.type(
        "#igtxtctl00_ctl00_ContentHolder_ContentHolder_AnaggeliesSearchControl_DateYpobolisToEdit",
        process.env.TO ?? "",
        { delay: 300 }
      );
    })
    .then(async () => {
      console.log("Πάτησε αναζήτηση");
      return await Promise.all([
        page.click(
          "#ctl00_ctl00_ContentHolder_ContentHolder_AnaggeliesSearchControl_SearchControlSearchButton"
        ),
        // page.waitForSelector(
        //   "#ctl00_ctl00_ContentHolder_ContentHolder_AnaggeliesSearchControl_AnaggeliesGridControl_Grid_Grid"
        // ),
        page.waitForNavigation({ waitUntil: "networkidle2" }),
      ]);
    })
    // .then(async () => {
    //   console.log("Αναμονή για φόρτωση σελίδας");
    //   return await page.waitForNavigation({ waitUntil: "networkidle2" });
    // })
    .then(async (response) => {
      // Πρέπει για κάθε γραμμή του πίνακα να κατεβάσουμε το αντίστοιχο αρχείο
      let rows = new Array<string>();
      let afm = new Array<string>();
      let morePages: boolean;

      console.log("Έναρξη ελέγχου αποτελεσμάτων");
      // Επανέλαβε για κάθε σελίδα αποτελεσμάτων
      do {
        let pageRows = new Array<string>();
        let pageAFM = new Array<string>();

        pageRows = await page.evaluate(() => {
          let rows: Array<string> = [];

          // Βρες κάθε γραμμή του πίνακα
          document
            .querySelectorAll(
              "#ctl00_ctl00_ContentHolder_ContentHolder_AnaggeliesSearchControl_AnaggeliesGridControl_Grid_Grid > tbody > tr > td:nth-child(1) > input"
            )
            .forEach((el) => {
              // Έλεγξε τον κώδικα πίσω από το κουμπί για το id
              const match = /Select.+'(\d+)\|/.exec(el.outerHTML);
              if (match) {
                rows.push(match[1]);
              }
            });

          return rows;
        });

        pageAFM = await page.evaluate(() => {
          let rows: Array<string> = [];

          // Βρες κάθε γραμμή του πίνακα
          document
            .querySelectorAll(
              "#ctl00_ctl00_ContentHolder_ContentHolder_AnaggeliesSearchControl_AnaggeliesGridControl_Grid_Grid > tbody > tr > td:nth-child(5)"
            )
            .forEach((el) => {
              // Έλεγξε τον κώδικα πίσω από το κουμπί για το id
              rows.push(el.innerHTML);
            });

          return rows;
        });

        console.log(`pageRows: ${pageRows}`);
        console.log(`pageAFM: ${pageAFM}`);
        rows.push(...pageRows);
        afm.push(...pageAFM);

        const singlePage = process.env.SINGLE_PAGE;

        // Βρες αν υπάρχει άλλη σελίδα
        const checkPager = await page.evaluate((singlePage) => {
          const pagerLinks = document.querySelectorAll(
            "#ctl00_ctl00_ContentHolder_ContentHolder_AnaggeliesSearchControl_AnaggeliesGridControl_Grid_Grid > tbody td > table > tbody > tr > td > a"
          );

          if ((!singlePage || singlePage === "0") && pagerLinks.length !== 0) {
            if (pagerLinks[pagerLinks.length - 1].innerHTML === "&gt;") {
              return {
                morePages: true,
                selector:
                  pagerLinks.length === 1
                    ? "#ctl00_ctl00_ContentHolder_ContentHolder_AnaggeliesSearchControl_AnaggeliesGridControl_Grid_Grid > tbody td > table > tbody > tr > td > a"
                    : "#ctl00_ctl00_ContentHolder_ContentHolder_AnaggeliesSearchControl_AnaggeliesGridControl_Grid_Grid > tbody td > table > tbody > tr > td:nth-child(2) > a",
              };
            }

            return { morePages: false, selector: "" };
          } else {
            return { morePages: false, selector: "" };
          }
        }, singlePage);

        console.log(
          `checkPager: ${checkPager.morePages} ${checkPager.selector}`
        );
        morePages = checkPager.morePages;

        // Αν υπάρχει άλλη σελίδα ακολούθησέ την
        if (checkPager.morePages) {
          await Promise.all([
            page.click(checkPager.selector),
            page.waitForNavigation({ waitUntil: "networkidle0" }),
          ]);
        }
      } while (morePages);

      console.log(rows);

      let baseUrl = page.url().replace("/AnaggeliesSearch.aspx", "");

      // return await new Promise((resolve) => {
      //   setTimeout(resolve, 20000);
      // });
      return await downloadFiles(rows, afm, baseUrl, browser);
    })
    .finally(() => {
      console.log("Τέλος");
    });
  // ---------------
}
