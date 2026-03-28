/**
 * scraper.js — Domain.com.au search results scraper.
 *
 * Tries Puppeteer first (full data — all listings rendered via JS).
 * Falls back to plain fetch if Chrome is not available (partial data —
 * only pages that Domain SSR-renders, typically ~50% of total).
 *
 * To get full data, install Chrome deps:
 *   sudo apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
 *     libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
 *     libxrandr2 libgbm1 libasound2
 */

import { execSync } from 'child_process';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Fetch with retry + exponential backoff.
 * Domain returns 429 (rate limit) or drops connections if you hit it too fast.
 * Standard practice for any web scraper or API client.
 */
async function fetchWithRetry(url, options, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const resp = await fetch(url, options);
    if (resp.status === 429) {
      const wait = attempt * 3000; // 3s, 6s, 9s
      console.log(`  ⚠️  Rate limited (429). Waiting ${wait / 1000}s before retry ${attempt}/${retries}...`);
      await sleep(wait);
      continue;
    }
    return resp;
  }
  throw new Error(`Rate limit exceeded after ${retries} retries. Wait a few minutes and try again.`);
}

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
};

// ── Shared helpers ─────────────────────────────────────────────────────────

function stripHtml(str) {
  if (!str) {
    return '';
  }
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseNextData(nextData) {
  if (!nextData) {
    return { listings: [], nearby: [] };
  }
  const cp      = nextData.props?.pageProps?.componentProps;
  const results = cp?.rootGraphQuery?.upvSearchListingsV2?.searchResults ?? [];
  const nearby  = (cp?.suburb?.surroundingSuburbs ?? []).map(s => ({
    name: s.name, slug: s.urlSlug,
  }));
  return { listings: results.map(mapListing), nearby };
}

function mapListing(l) {
  const addr = l.displayableAddress ?? {};
  return {
    id:           l.listingId,
    slug:         l.listingSlug,
    url:          l.listingSlug ? `https://www.domain.com.au/${l.listingSlug}` : null,
    address:      addr.displayAddress  ?? '',
    streetNum:    addr.streetNumber    ?? '',
    unit:         addr.unitNumber      ?? '',
    street:       addr.street          ?? '',
    suburb:       addr.suburbName      ?? '',
    state:        addr.state           ?? '',
    postcode:     addr.postcode        ?? '',
    lat:          addr.geolocation?.latitude  ?? null,
    lon:          addr.geolocation?.longitude ?? null,
    listingType:  l.listingType        ?? 'Sale',
    type:         (l.propertyTypes ?? [l.propertyType] ?? ['Unknown'])[0],
    beds:         l.bedrooms   ?? 0,
    baths:        l.bathrooms  ?? 0,
    cars:         l.carspaces  ?? 0,
    landArea:     l.landArea?.size ?? null,
    landUnit:     l.landArea?.unit ?? 'm²',
    features:     l.features       ?? [],
    displayPrice: l.priceDetails?.displayPrice   ?? '',
    priceFrom:    l.priceDetails?.rawValues?.from ?? 0,
    priceTo:      l.priceDetails?.rawValues?.to   ?? 0,
    headline:     l.headline                      ?? '',
    description:  stripHtml(l.summaryDescription) ?? '',
    auctionDate:  l.auctionDetails?.auctionSchedule?.auctionDateDisplay ?? null,
    inspections:  (l.inspectionDetails?.inspections ?? []).map(i => i.display).filter(Boolean),
  };
}

// ── Puppeteer scraper (full data) ──────────────────────────────────────────

function findChrome() {
  try {
    const out     = execSync('npx puppeteer browsers list 2>/dev/null', { encoding: 'utf-8' });
    const matches = [...out.matchAll(/chrome@[\d.]+\s+\(linux\)\s+(\S+)/g)];
    if (matches.length) {
      return matches[matches.length - 1][1];
    }
  } catch {}
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']) {
    try { execSync(`test -x ${p}`); return p; } catch {}
  }
  return null;
}

async function scrapeWithPuppeteer(slug, { onPage, maxPages }) {
  const puppeteer = (await import('puppeteer-core')).default;
  const executablePath = findChrome();
  if (!executablePath) {
    throw new Error('Chrome not found');
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page    = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'User-Agent': HEADERS['User-Agent'] });

  const allListings = [];
  let nearby  = [];
  let pageNum = 1;
  const seen  = new Set();

  try {
    while (pageNum <= maxPages) {
      await page.goto(
        `https://www.domain.com.au/sale/${slug}/?page=${pageNum}`,
        { waitUntil: 'networkidle2', timeout: 30_000 }
      );

      await page.waitForSelector(
        '[data-testid="listing-card-wrapper"], [data-testid="no-results"]',
        { timeout: 15_000 }
      ).catch(() => {});

      const nextData = await page.evaluate(() => window.__NEXT_DATA__);
      const { listings, nearby: pNearby } = parseNextData(nextData);

      if (pageNum === 1 && pNearby.length) {
        nearby = pNearby;
      }

      const fresh = listings.filter(l => l.id && !seen.has(l.id));
      fresh.forEach(l => seen.add(l.id));

      if (fresh.length === 0) {
        break;
      }
      allListings.push(...fresh);
      if (onPage) {
        onPage(pageNum, fresh.length);
      }

      if (listings.length < 10) {
        break;
      }
      pageNum++;
      await sleep(1500); // polite delay — avoid 429 rate limit
    }
  } finally {
    await browser.close();
  }

  return { allListings, nearby };
}

// ── Fetch scraper fallback (partial data) ─────────────────────────────────
// Domain only SSR-renders some pages. We skip empty pages and keep going
// for up to MAX_EMPTY_STREAK consecutive empty pages before stopping.

const MAX_EMPTY_STREAK = 5;

async function scrapeWithFetch(slug, { onPage, maxPages }) {
  const allListings = [];
  let nearby        = [];
  let pageNum       = 1;
  let emptyStreak   = 0;
  const seen        = new Set();

  while (pageNum <= maxPages) {
    const url  = `https://www.domain.com.au/sale/${slug}/?page=${pageNum}`;
    const resp = await fetchWithRetry(url, { headers: HEADERS });
    if (!resp.ok) {
      break;
    }

    const html = await resp.text();
    const m    = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);

    if (!m) {
      emptyStreak++;
      if (emptyStreak >= MAX_EMPTY_STREAK) {
        break;
      }
      pageNum++;
      continue;
    }

    let nextData;
    try {
      nextData = JSON.parse(m[1]);
    } catch {
      break;
    }

    const { listings, nearby: pNearby } = parseNextData({ props: nextData.props });
    if (pageNum === 1 && pNearby.length) {
      nearby = pNearby;
    }

    const fresh = listings.filter(l => l.id && !seen.has(l.id));
    fresh.forEach(l => seen.add(l.id));

    if (fresh.length === 0) {
      emptyStreak++;
      if (emptyStreak >= MAX_EMPTY_STREAK) break;
    } else {
      emptyStreak = 0;
      allListings.push(...fresh);
      if (onPage) {
        onPage(pageNum, fresh.length);
      }
    }

    pageNum++;
    await sleep(1500); // polite delay — avoid 429 rate limit
  }

  return { allListings, nearby };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Scrape all for-sale listings for a Domain suburb slug.
 * Uses Puppeteer if Chrome is available, falls back to fetch.
 *
 * Returns { slug, suburb, nearby, listings, method }
 */
export async function scrapeSuburb(slug, { onPage, maxPages = Infinity } = {}) {
  let method = 'fetch';
  let result;

  // Try Puppeteer first
  const chromePath = findChrome();
  if (chromePath) {
    try {
      result = await scrapeWithPuppeteer(slug, { onPage, maxPages });
      method = 'puppeteer';
    } catch (e) {
      if (e.message.includes('Failed to launch') || e.message.includes('shared libraries')) {
        // Chrome deps missing — fall back silently
      } else {
        throw e;
      }
    }
  }

  if (!result) {
    result = await scrapeWithFetch(slug, { onPage, maxPages });
  }

  const { allListings, nearby } = result;

  const suburbName = allListings[0]?.suburb
    || slug.split('-').slice(0, -2).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

  return { slug, suburb: suburbName, nearby, listings: allListings, method };
}
