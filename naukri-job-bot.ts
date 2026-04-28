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

// Load previous jobs
function loadOldJobs(): Job[] {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  }
  return [];
}

// Save jobs
function saveJobs(jobs: Job[]): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(jobs, null, 2));
}

// Filter new jobs
function filterNewJobs(oldJobs: Job[], newJobs: Job[]): Job[] {
  const oldLinks = new Set(oldJobs.map(job => job.link));
  return newJobs.filter(job => !oldLinks.has(job.link));
}

// SCRAPER
async function scrapeJobs(): Promise<Job[]> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();

  // Anti-detection
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false
    });
  });

  let allJobs: Job[] = [];

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const pageUrl =
      pageNum === 1
        ? BASE_URL
        : BASE_URL.replace('?jobAge=1', `-${pageNum}?jobAge=1`);

    console.log(`\n🔎 Opening Page ${pageNum}: ${pageUrl}`);

    await page.goto(pageUrl, { waitUntil: 'networkidle' });

    try {
      await page.waitForSelector('.srp-jobtuple-wrapper', { timeout: 15000 });
    } catch {
      console.log("⚠️ Jobs not loaded (possibly blocked)");
      await page.screenshot({ path: `debug-page-${pageNum}.png` });
      continue;
    }

    const jobs: Job[] = await page.evaluate(() => {
      const cards = document.querySelectorAll('.srp-jobtuple-wrapper');

      return Array.from(cards).map((card) => ({
        title:
          (card.querySelector('a.title') as HTMLElement)?.innerText?.trim() ||
          '',
        company:
          (card.querySelector('.comp-name') as HTMLElement)?.innerText?.trim() ||
          '',
        location:
          (card.querySelector('.locWdth') as HTMLElement)?.innerText?.trim() ||
          '',
        link:
          (card.querySelector('a.title') as HTMLAnchorElement)?.href || ''
      }));
    });

    console.log(`✅ Page ${pageNum} jobs found: ${jobs.length}`);

    allJobs.push(...jobs);
  }

  await browser.close();

  const uniqueJobs = Array.from(
    new Map(allJobs.map(job => [job.link, job])).values()
  );

  console.log(`\n📊 Total unique jobs: ${uniqueJobs.length}`);

  return uniqueJobs.filter(j => j.title && j.link).slice(0, MAX_JOBS);
}

// EMAIL
async function sendEmail(jobs: Job[]): Promise<void> {
  if (jobs.length === 0) {
    console.log("❌ No jobs found. Skipping email.");
    return;
  }

  const jobCards = jobs
    .map(
      (job, i) => `
      <div style="padding:15px;margin-bottom:15px;border:1px solid #eee;border-radius:10px;">
        <h3>${i + 1}. ${job.title}</h3>
        <p><b>${job.company}</b></p>
        <p>📍 ${job.location}</p>
        <a href="${job.link}">View Job</a>
      </div>
    `
    )
    .join('');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL,
      pass: process.env.PASS
    }
  });

  await transporter.sendMail({
    from: process.env.EMAIL,
    to: process.env.TO_EMAIL,
    subject: `🚀 ${jobs.length} QA Automation Jobs`,
    html: `<h2>New Jobs Found</h2>${jobCards}`
  });

  console.log("📧 Email sent!");
}

// MAIN
(async () => {
  try {
    const oldJobs = loadOldJobs();
    const scrapedJobs = await scrapeJobs();
    const newJobs = filterNewJobs(oldJobs, scrapedJobs);

    console.log(`🆕 New jobs: ${newJobs.length}`);

    await sendEmail(newJobs);
    saveJobs(scrapedJobs);

  } catch (err) {
    console.error("❌ Error:", err);
  }
})();
