#!/usr/bin/env node
/**
 * Audit all Branson MO businesses across multiple industries.
 * Uses SerpAPI to find businesses that actually rank, then crawls each website.
 * Stores results in data/market-audits/branson-{industry}.json
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'market-audits');
const SERP_API_KEY = process.env.SERP_API_KEY;

const INDUSTRIES = [
  { slug: 'hvac', queries: ['hvac branson mo', 'air conditioning repair branson mo', 'heating branson mo'] },
  { slug: 'plumbers', queries: ['plumber branson mo', 'plumbing branson mo', 'plumber near branson missouri'] },
  { slug: 'electricians', queries: ['electrician branson mo', 'electrical contractor branson mo'] },
  { slug: 'roofers', queries: ['roofing branson mo', 'roofer branson mo', 'roof repair branson missouri'] },
  { slug: 'pest-control', queries: ['pest control branson mo', 'exterminator branson mo'] },
  { slug: 'tree-service', queries: ['tree service branson mo', 'tree removal branson mo', 'tree trimming branson missouri'] },
  { slug: 'garage-door', queries: ['garage door repair branson mo', 'garage door branson mo'] },
  { slug: 'restoration', queries: ['water damage restoration branson mo', 'fire restoration branson mo', 'restoration company branson mo'] },
];

// Allow running a single industry: node audit-branson-all.js hvac
const ONLY = process.argv[2] || null;

function serpSearch(query) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ q: query, location: 'Branson, Missouri, United States', hl: 'en', gl: 'us', api_key: SERP_API_KEY });
    const url = `https://serpapi.com/search.json?${params}`;
    https.get(url, { timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function extractBusinesses(serpResult) {
  const businesses = new Map(); // domain -> info

  // From local pack
  const localResults = serpResult.local_results?.places || serpResult.local_results || [];
  for (const r of Array.isArray(localResults) ? localResults : []) {
    if (r.link || r.website) {
      const url = r.link || r.website;
      const domain = extractDomain(url);
      if (domain && !isJunk(domain)) {
        businesses.set(domain, {
          name: r.title || r.name || '',
          url,
          phone: r.phone || '',
          address: r.address || '',
          rating: r.rating || null,
          reviews: r.reviews || null,
          source: 'local_pack'
        });
      }
    }
  }

  // From organic results
  for (const r of (serpResult.organic_results || [])) {
    const domain = extractDomain(r.link);
    if (domain && !isJunk(domain) && !businesses.has(domain)) {
      businesses.set(domain, {
        name: r.title || '',
        url: r.link,
        phone: '',
        address: '',
        rating: null,
        reviews: null,
        source: 'organic'
      });
    }
  }

  return [...businesses.values()];
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function isJunk(domain) {
  const junk = ['yelp.com','facebook.com','yellowpages.com','bbb.org','angi.com','homeadvisor.com',
    'thumbtack.com','nextdoor.com','mapquest.com','manta.com','google.com','apple.com',
    'angieslist.com','porch.com','houzz.com','bark.com','expertise.com','chamberofcommerce.com',
    'superpages.com','citysearch.com','merchantcircle.com','kudzu.com','dexknows.com',
    'tripadvisor.com','indeed.com','glassdoor.com','linkedin.com','twitter.com','instagram.com',
    'tiktok.com','youtube.com','pinterest.com','reddit.com','wikipedia.org'];
  return junk.some(j => domain.includes(j));
}

function fetchPage(url, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 5) return resolve({ error: 'too many redirects', html: '', finalUrl: url, statusCode: 0 });
    const mod = url.startsWith('https') ? https : http;
    try {
      const req = mod.get(url, { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GeoNeoAudit/1.0)' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let loc = res.headers.location;
          if (loc.startsWith('/')) loc = new URL(loc, url).href;
          return resolve(fetchPage(loc, redirectCount + 1));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', c => body += c);
        res.on('end', () => resolve({ html: body, finalUrl: url, statusCode: res.statusCode, error: null }));
      });
      req.on('error', e => resolve({ error: e.message, html: '', finalUrl: url, statusCode: 0 }));
      req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', html: '', finalUrl: url, statusCode: 0 }); });
    } catch (e) { resolve({ error: e.message, html: '', finalUrl: url, statusCode: 0 }); }
  });
}

function analyzeHtml(html, url) {
  return {
    hasTitle: /<title[^>]*>.+<\/title>/i.test(html),
    title: (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '',
    hasMetaDescription: /name=["']description["']/i.test(html),
    metaDescription: (html.match(/name=["']description["']\s*content=["']([^"']+)/i) || html.match(/content=["']([^"']+)["']\s*name=["']description/i) || [])[1] || '',
    hasH1: /<h1[\s>]/i.test(html),
    hasSchema: /application\/ld\+json/i.test(html) || /itemtype.*schema\.org/i.test(html),
    schemaTypes: (html.match(/"@type"\s*:\s*"([^"]+)"/gi) || []).map(m => m.replace(/"@type"\s*:\s*"/i, '').replace(/"$/, '')),
    hasPhone: /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(html),
    phones: [...new Set((html.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || []).slice(0, 5))],
    emails: [...new Set((html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []).filter(e => !e.includes('example') && !e.includes('sentry') && !e.includes('wixpress')).slice(0, 3))],
    hasAddress: /\d+\s+\w+\s+(st|street|ave|avenue|blvd|rd|road|dr|drive|ln|lane|way|hwy|highway)/i.test(html),
    addresses: (html.match(/\d+\s+[A-Z][a-zA-Z\s]+(?:St|Street|Ave|Avenue|Blvd|Rd|Road|Dr|Drive|Ln|Lane|Way|Hwy|Highway)[.,]?\s*(?:[A-Za-z\s]+,?\s*)?(?:MO|Missouri)?\s*\d{5}/g) || []).slice(0, 2),
    hasSSL: url.startsWith('https'),
    wordCount: (html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ')).length,
    hasImages: (html.match(/<img[\s]/gi) || []).length,
    imagesWithAlt: (html.match(/<img[^>]+alt=["'][^"']+["']/gi) || []).length,
    hasMobileViewport: /name=["']viewport["']/i.test(html),
    hasServicePages: (html.match(/<a[^>]+href=["'][^"']*(?:service|about|contact)[^"']*["']/gi) || []).length > 0,
    internalLinks: (html.match(/<a[^>]+href=["']\/[^"']+["']/gi) || []).length,
    hasReviews: /review|testimonial|rating|star/i.test(html),
    hasContactForm: /<form/i.test(html),
    platform: detectPlatform(html),
    grammarIssues: detectGrammarIssues(html),
  };
}

function detectPlatform(html) {
  if (/wp-content|wordpress/i.test(html)) return 'WordPress';
  if (/wix\.com|wixsite/i.test(html)) return 'Wix';
  if (/squarespace/i.test(html)) return 'Squarespace';
  if (/godaddy|secureserver/i.test(html)) return 'GoDaddy';
  if (/weebly/i.test(html)) return 'Weebly';
  if (/shopify/i.test(html)) return 'Shopify';
  if (/duda/i.test(html)) return 'Duda';
  if (/webflow/i.test(html)) return 'Webflow';
  if (/sites\.google/i.test(html)) return 'Google Sites';
  return 'Unknown/Custom';
}

function detectGrammarIssues(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const issues = [];
  if (/teh |adn |taht |thier |recieve |seperate |definately |occured /i.test(text)) issues.push('misspellings');
  if (/\.\.[^.]|,,/g.test(text)) issues.push('double punctuation');
  const sentences = text.split(/[.!?]\s+/);
  const badStarts = sentences.filter(s => s.length > 3 && /^[a-z]/.test(s.trim())).length;
  if (badStarts > 2) issues.push(badStarts + ' uncapitalized sentences');
  return issues;
}

function scoreWebsite(a) {
  let score = 0;
  if (a.hasTitle && a.title.length > 10) score += 8;
  if (a.hasMetaDescription && a.metaDescription.length > 50) score += 8;
  if (a.hasH1) score += 5;
  if (a.hasSchema) score += 12;
  if (a.hasPhone) score += 5;
  if (a.hasAddress) score += 5;
  if (a.hasSSL) score += 8;
  if (a.hasMobileViewport) score += 8;
  if (a.wordCount > 300) score += 5;
  if (a.wordCount > 800) score += 5;
  if (a.hasServicePages) score += 8;
  if (a.internalLinks > 3) score += 5;
  if (a.hasReviews) score += 5;
  if (a.hasContactForm) score += 4;
  if (a.imagesWithAlt > 0 && a.hasImages > 0) score += 4;
  if (a.grammarIssues.length > 0) score -= 5;
  if (!a.hasSSL) score -= 10;
  if (a.wordCount < 100) score -= 10;
  return Math.max(0, Math.min(100, score));
}

async function auditIndustry(industry) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  INDUSTRY: ${industry.slug.toUpperCase()}`);
  console.log(`${'═'.repeat(60)}`);

  // Search all queries and merge unique businesses
  const allBiz = new Map();
  for (const query of industry.queries) {
    console.log(`  Searching: "${query}"`);
    try {
      const serp = await serpSearch(query);
      const found = extractBusinesses(serp);
      for (const b of found) {
        const domain = extractDomain(b.url);
        if (!allBiz.has(domain)) allBiz.set(domain, b);
        else {
          // Merge contact info if we got more from this query
          const existing = allBiz.get(domain);
          if (!existing.phone && b.phone) existing.phone = b.phone;
          if (!existing.address && b.address) existing.address = b.address;
          if (!existing.rating && b.rating) existing.rating = b.rating;
        }
      }
      // Rate limit: 1 req/sec for free SerpAPI
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.log(`    ERROR: ${e.message}`);
    }
  }

  const businesses = [...allBiz.values()].slice(0, 15); // Cap at 15 per industry
  console.log(`  Found ${businesses.length} unique businesses to audit\n`);

  const results = [];
  for (const biz of businesses) {
    console.log(`  Auditing: ${biz.name || extractDomain(biz.url)}`);
    const page = await fetchPage(biz.url);

    if (page.error || page.statusCode >= 400) {
      results.push({ name: biz.name, url: biz.url, phone: biz.phone, address: biz.address, email: '', status: 'unreachable', error: page.error || `HTTP ${page.statusCode}`, score: 0, analysis: null, rating: biz.rating, reviews: biz.reviews });
      console.log(`    FAILED: ${page.error || page.statusCode}`);
      continue;
    }

    const analysis = analyzeHtml(page.html, page.finalUrl || biz.url);
    const score = scoreWebsite(analysis);

    // Merge contact info: prefer SERP data, supplement from crawl
    const phone = biz.phone || (analysis.phones[0] || '');
    const email = analysis.emails[0] || '';
    const address = biz.address || (analysis.addresses[0] || '');

    results.push({
      name: biz.name,
      url: biz.url,
      finalUrl: page.finalUrl,
      phone,
      email,
      address,
      rating: biz.rating,
      reviews: biz.reviews,
      status: 'audited',
      score,
      analysis
    });
    console.log(`    Score: ${score}/100 | Platform: ${analysis.platform} | Schema: ${analysis.hasSchema ? '✓' : '✗'} | Phone: ${phone || 'none'}`);
  }

  // Build output
  const audited = results.filter(r => r.status === 'audited');
  const avgScore = audited.length ? Math.round(audited.reduce((s, r) => s + r.score, 0) / audited.length) : 0;

  const output = {
    market: 'Branson, MO',
    industry: industry.slug,
    lastUpdated: new Date().toISOString(),
    totalBusinesses: results.length,
    auditedCount: audited.length,
    averageScore: avgScore,
    summary: {
      avgWebsiteQuality: avgScore,
      withSchema: audited.filter(r => r.analysis.hasSchema).length,
      withSSL: audited.filter(r => r.analysis.hasSSL).length,
      withMobileViewport: audited.filter(r => r.analysis.hasMobileViewport).length,
      withReviews: audited.filter(r => r.analysis.hasReviews).length,
      withContactForm: audited.filter(r => r.analysis.hasContactForm).length,
      avgWordCount: audited.length ? Math.round(audited.reduce((s, r) => s + r.analysis.wordCount, 0) / audited.length) : 0,
      platforms: audited.reduce((acc, r) => { acc[r.analysis.platform] = (acc[r.analysis.platform] || 0) + 1; return acc; }, {}),
    },
    businesses: results
  };

  const outFile = path.join(OUTPUT_DIR, `branson-${industry.slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`\n  ✓ Saved: ${outFile} (${audited.length} businesses, avg score: ${avgScore})`);
  return output;
}

async function main() {
  if (!SERP_API_KEY) { console.error('ERROR: SERP_API_KEY not set in .env'); process.exit(1); }
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const toRun = ONLY ? INDUSTRIES.filter(i => i.slug === ONLY) : INDUSTRIES;
  if (ONLY && toRun.length === 0) { console.error(`Unknown industry: ${ONLY}. Options: ${INDUSTRIES.map(i=>i.slug).join(', ')}`); process.exit(1); }

  console.log(`\nGeoNeo Multi-Industry Audit — Branson, MO`);
  console.log(`Industries to audit: ${toRun.map(i => i.slug).join(', ')}`);
  console.log(`Using SerpAPI to find real ranking businesses\n`);

  const summaries = [];
  for (const industry of toRun) {
    try {
      const result = await auditIndustry(industry);
      summaries.push({ industry: industry.slug, businesses: result.auditedCount, avgScore: result.averageScore });
    } catch (e) {
      console.error(`  ERROR auditing ${industry.slug}: ${e.message}`);
      summaries.push({ industry: industry.slug, error: e.message });
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  FINAL SUMMARY`);
  console.log(`${'═'.repeat(60)}`);
  for (const s of summaries) {
    if (s.error) console.log(`  ${s.industry}: ERROR - ${s.error}`);
    else console.log(`  ${s.industry}: ${s.businesses} businesses, avg score ${s.avgScore}/100`);
  }
}

main().catch(console.error);
