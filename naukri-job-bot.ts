import { chromium } from 'playwright';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';

const BASE_URL =
  'https://in.indeed.com/jobs?q=qa+automation&l=Pune%2C+Maharashtra';

const MAX_JOBS = 50;
const DATA_FILE = 'jobs.json';

type Job = {
  title: string;
  company: string;
  location: string;
  link: string;
};

// Load old jobs
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
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();

  console.log("🔎 Opening Indeed...");

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('.job_seen_beacon', { timeout: 15000 });

  const jobs: Job[] = await page.evaluate(() => {
    const cards = document.querySelectorAll('.job_seen_beacon');

    return Array.from(cards).map((card) => ({
      title:
        (card.querySelector('h2 span') as HTMLElement)?.innerText?.trim() || '',
      company:
        (card.querySelector('[data-testid="company-name"]') as HTMLElement)
          ?.innerText?.trim() || '',
      location:
        (card.querySelector('[data-testid="text-location"]') as HTMLElement)
          ?.innerText?.trim() || '',
      link:
        'https://in.indeed.com' +
        ((card.querySelector('a') as HTMLAnchorElement)?.getAttribute('href') ||
          '')
    }));
  });

  await browser.close();

  console.log(`✅ Jobs found: ${jobs.length}`);

  return jobs.filter(j => j.title && j.link).slice(0, MAX_JOBS);
}

// EMAIL
async function sendEmail(jobs: Job[]): Promise<void> {
  if (jobs.length === 0) {
    console.log("❌ No jobs found.");
    return;
  }

  const jobCards = jobs
    .map(
      (job, i) => `
      <div style="padding:10px;margin-bottom:10px;border:1px solid #ddd;">
        <h3>${i + 1}. ${job.title}</h3>
        <p>${job.company}</p>
        <p>${job.location}</p>
        <a href="${job.link}">Apply</a>
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
    html: `<h2>Latest Jobs</h2>${jobCards}`
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
