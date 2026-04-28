import { chromium } from 'playwright';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';

const BASE_URL =
  'https://www.naukri.com/qa-automation-jobs-in-pune-mumbai-navi-mumbai?jobAge=1';

const MAX_JOBS = 100;
const MAX_PAGES = 3;
const DATA_FILE = 'jobs.json';

type Job = {
  title: string;
  company: string;
  location: string;
  link: string;
};

// 📌 Load previous jobs
function loadOldJobs(): Job[] {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
  return [];
}

// 📌 Save jobs
function saveJobs(jobs: Job[]): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(jobs, null, 2));
}

// 📌 Remove duplicates
function filterNewJobs(oldJobs: Job[], newJobs: Job[]): Job[] {
  const oldLinks = new Set(oldJobs.map(job => job.link));
  return newJobs.filter(job => !oldLinks.has(job.link));
}

// 🔍 Scrape jobs
async function scrapeJobs(): Promise<Job[]> {
  const browser = await chromium.launch({
    headless: true,
    slowMo: 100
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  });

  const page = await context.newPage();

  let allJobs: Job[] = [];

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const pageUrl =
      pageNum === 1
        ? BASE_URL
        : BASE_URL.replace('?jobAge=1', `-${pageNum}?jobAge=1`);

    console.log(`\n🔎 Opening Page ${pageNum}: ${pageUrl}`);

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(5000);

    // scroll to load jobs
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(1200);
    }

    const jobs: Job[] = await page.evaluate(() => {
      const jobLinks = document.querySelectorAll('a[href*="/job-listings"]');

      return Array.from(jobLinks).map((link) => {
        const parent = link.closest('div');

        return {
          title: (link as HTMLElement).innerText?.trim() || '',
          company:
            (parent?.querySelector('[class*="comp"]') as HTMLElement)?.innerText?.trim() || '',
          location:
            (parent?.querySelector('[class*="loc"]') as HTMLElement)?.innerText?.trim() || '',
          link: (link as HTMLAnchorElement).href
        };
      });
    });

    console.log(`✅ Page ${pageNum} jobs found: ${jobs.length}`);

    allJobs.push(...jobs);
  }

  await browser.close();

  const uniqueJobs = Array.from(
    new Map(allJobs.map(job => [job.link, job])).values()
  );

  console.log(`\n📊 Total unique jobs: ${uniqueJobs.length}`);

  return uniqueJobs
    .filter(job => job.title && job.link)
    .slice(0, MAX_JOBS);
}

// 📧 Beautiful Email
async function sendEmail(jobs: Job[]): Promise<void> {
  if (jobs.length === 0) {
    console.log("No new jobs found.");
    return;
  }

  const jobCards = jobs
    .map(
      (job, i) => `
      <div style="padding:15px; margin-bottom:15px; border:1px solid #eee; border-radius:10px;">
        <h3 style="margin:0; color:#2c3e50;">${i + 1}. ${job.title}</h3>
        <p style="margin:5px 0; font-weight:600; color:#34495e;">
          ${job.company}
        </p>
        <p style="margin:5px 0; color:#7f8c8d;">
          📍 ${job.location}
        </p>
        <a href="${job.link}" target="_blank"
           style="display:inline-block; margin-top:10px; padding:8px 12px;
                  background:#3498db; color:#fff; text-decoration:none;
                  border-radius:6px;">
          View Job
        </a>
      </div>
    `
    )
    .join('');

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto;">
      
      <h2 style="text-align:center; color:#2c3e50;">
        🚀 QA Automation Job Alerts
      </h2>

      <p style="text-align:center; color:#7f8c8d;">
        Found ${jobs.length} new jobs for you today
      </p>

      ${jobCards}

      <hr style="margin:30px 0;" />

      <p style="text-align:center; font-size:12px; color:#aaa;">
        Automated Job Bot | Built by You 😎
      </p>
    </div>
  `;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL,
      pass: process.env.PASS
    }
  });

  await transporter.sendMail({
    from: 'akashbhade333@gmail.com',
    to: 'akashbhade722@gmail.com',
    subject: `🚀 ${jobs.length} New QA Automation Jobs`,
    html: htmlContent
  });

  console.log("📧 Beautiful email sent!");
}

// 🚀 Main
(async () => {
  try {
    const oldJobs = loadOldJobs();
    const scrapedJobs = await scrapeJobs();
    const newJobs = filterNewJobs(oldJobs, scrapedJobs);

    console.log(`\n🆕 New jobs: ${newJobs.length}`);

    await sendEmail(newJobs);

    saveJobs(scrapedJobs);

  } catch (err) {
    console.error("❌ Error:", err);
  }
})();