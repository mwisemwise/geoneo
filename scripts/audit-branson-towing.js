#!/usr/bin/env node
/**
 * Audit all Branson MO tow truck businesses.
 * Crawls each website and stores real data in data/market-audits/branson-towing.json
 */
require('dotenv').config();
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'market-audits');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'branson-towing.json');

// Only businesses that actually show up when you Google "towing branson mo"
// Verified from real Google SERP results May 2026
const BUSINESSES = [
  { name: "Crawford's Automotive & Towing", url: 'https://www.crawfordsautomotiveandtowing.com' },
  { name: "Chris's Towing & Recovery", url: 'https://chrisstowingrecovery.com' },
  { name: "Davey's Auto Body Sales & Towing", url: 'https://daveysautobody.com' },
  { name: "Schrader's Towing", url: 'http://schraderstowingmo.com' },
  { name: "Kinsley's Towing & Recovery", url: 'https://kinsleystowing.com' },
  { name: "Affordable Towing - Branson", url: 'http://www.affordabletowingservice.com' },
  { name: "Taney County Tire And Towing", url: 'https://taneycountytireandtowing.com' },
];

function fetchPage(url, redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 5) return resolve({ error: 'too many redirects', html: '', finalUrl: url, statusCode: 0 });
    const mod = url.startsWith('https') ? https : http;
    const timeout = 12000;
    try {
      const req = mod.get(url, { timeout, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GeoNeoAudit/1.0)' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let loc = res.headers.location;
          if (loc.startsWith('/')) loc = new URL(loc, url).href;
          return resolve(fetchPage(loc, redirectCount + 1));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ html: body, finalUrl: url, statusCode: res.statusCode, error: null }));
      });
      req.on('error', (e) => resolve({ error: e.message, html: '', finalUrl: url, statusCode: 0 }));
      req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', html: '', finalUrl: url, statusCode: 0 }); });
    } catch (e) {
      resolve({ error: e.message, html: '', finalUrl: url, statusCode: 0 });
    }
  });
}

function analyzeHtml(html, url) {
  const lower = html.toLowerCase();
  const result = {
    hasTitle: /<title[^>]*>.+<\/title>/i.test(html),
    title: (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '',
    hasMetaDescription: /name=["']description["']/i.test(html),
    metaDescription: (html.match(/name=["']description["']\s*content=["']([^"']+)/i) || html.match(/content=["']([^"']+)["']\s*name=["']description/i) || [])[1] || '',
    hasH1: /<h1[\s>]/i.test(html),
    h1Count: (html.match(/<h1[\s>]/gi) || []).length,
    hasSchema: /application\/ld\+json/i.test(html) || /itemtype.*schema\.org/i.test(html),
    schemaTypes: (html.match(/"@type"\s*:\s*"([^"]+)"/gi) || []).map(m => m.replace(/"@type"\s*:\s*"/i, '').replace(/"$/, '')),
    hasPhone: /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(html),
    phones: (html.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || []).slice(0, 3),
    hasAddress: /\d+\s+\w+\s+(st|street|ave|avenue|blvd|rd|road|dr|drive|ln|lane|way|hwy|highway)/i.test(html),
    hasSSL: url.startsWith('https'),
    wordCount: (html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ')).length,
    hasImages: (html.match(/<img[\s]/gi) || []).length,
    imagesWithAlt: (html.match(/<img[^>]+alt=["'][^"']+["']/gi) || []).length,
    hasMobileViewport: /name=["']viewport["']/i.test(html),
    hasServicePages: /services|towing|recovery|roadside/i.test(html) && (html.match(/<a[^>]+href=["'][^"']*(?:service|towing|recovery|roadside)[^"']*["']/gi) || []).length > 0,
    internalLinks: (html.match(/<a[^>]+href=["']\/[^"']+["']/gi) || []).length,
    externalLinks: (html.match(/<a[^>]+href=["']https?:\/\/(?!.*(?:crawfords|chriss|daveys|anchor|rpm|servicewise|mohneys|ozark|kinsley|american|natural|schrader))[^"']+["']/gi) || []).length,
    hasReviews: /review|testimonial|rating|star/i.test(html),
    has24Hour: /24.?(?:hour|hr|\/7)/i.test(html),
    hasEmergency: /emergency/i.test(html),
    hasPricing: /price|pricing|cost|rate|quote|free estimate/i.test(html),
    hasContactForm: /<form/i.test(html),
    hasSitemap: false, // checked separately
    hasRobotsTxt: false, // checked separately
    platform: detectPlatform(html),
    grammarIssues: detectGrammarIssues(html),
  };
  return result;
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
  // Strip tags, check for common issues
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const issues = [];
  if (/\bi\b(?!\s*[A-Z''])/g.test(text)) issues.push('lowercase "i"');
  if (/\s{2,}[a-z]/g.test(text)) issues.push('missing capitalization after period');
  if (/teh |adn |taht |thier |recieve |seperate |definately |occured |accomodate /i.test(text)) issues.push('common misspellings detected');
  if (/\.\.[^.]|,,/g.test(text)) issues.push('double punctuation');
  // Count sentences that don't start with capital
  const sentences = text.split(/[.!?]\s+/);
  const badStarts = sentences.filter(s => s.length > 3 && /^[a-z]/.test(s.trim())).length;
  if (badStarts > 2) issues.push(badStarts + ' sentences not capitalized');
  return issues;
}

async function checkRobots(baseUrl) {
  try {
    const res = await fetchPage(baseUrl.replace(/\/$/, '') + '/robots.txt');
    return res.statusCode === 200 && res.html.length > 10;
  } catch { return false; }
}

async function checkSitemap(baseUrl) {
  try {
    const res = await fetchPage(baseUrl.replace(/\/$/, '') + '/sitemap.xml');
    return res.statusCode === 200 && /urlset|sitemapindex/i.test(res.html);
  } catch { return false; }
}

function scoreWebsite(analysis) {
  let score = 0;
  if (analysis.hasTitle && analysis.title.length > 10) score += 8;
  if (analysis.hasMetaDescription && analysis.metaDescription.length > 50) score += 8;
  if (analysis.hasH1) score += 5;
  if (analysis.hasSchema) score += 12;
  if (analysis.hasPhone) score += 5;
  if (analysis.hasAddress) score += 5;
  if (analysis.hasSSL) score += 8;
  if (analysis.hasMobileViewport) score += 8;
  if (analysis.wordCount > 300) score += 5;
  if (analysis.wordCount > 800) score += 5;
  if (analysis.hasServicePages) score += 8;
  if (analysis.internalLinks > 3) score += 5;
  if (analysis.hasReviews) score += 5;
  if (analysis.has24Hour) score += 3;
  if (analysis.hasContactForm) score += 4;
  if (analysis.hasSitemap) score += 4;
  if (analysis.hasRobotsTxt) score += 3;
  if (analysis.imagesWithAlt > 0 && analysis.hasImages > 0) score += 4;
  // Penalties
  if (analysis.grammarIssues.length > 0) score -= 5;
  if (!analysis.hasSSL) score -= 10;
  if (analysis.wordCount < 100) score -= 10;
  return Math.max(0, Math.min(100, score));
}

async function auditBusiness(biz) {
  console.log(`  Auditing: ${biz.name} (${biz.url})`);
  const page = await fetchPage(biz.url);
  
  if (page.error || page.statusCode >= 400) {
    return {
      name: biz.name,
      url: biz.url,
      status: 'unreachable',
      error: page.error || `HTTP ${page.statusCode}`,
      auditedAt: new Date().toISOString(),
      score: 0,
      analysis: null
    };
  }

  const analysis = analyzeHtml(page.html, page.finalUrl || biz.url);
  analysis.hasRobotsTxt = await checkRobots(biz.url);
  analysis.hasSitemap = await checkSitemap(biz.url);
  const score = scoreWebsite(analysis);

  return {
    name: biz.name,
    url: biz.url,
    finalUrl: page.finalUrl,
    status: 'audited',
    statusCode: page.statusCode,
    auditedAt: new Date().toISOString(),
    score,
    analysis
  };
}

async function main() {
  console.log(`\nAuditing ${BUSINESSES.length} Branson MO tow truck businesses...\n`);
  
  const results = [];
  for (const biz of BUSINESSES) {
    const result = await auditBusiness(biz);
    results.push(result);
    if (result.status === 'audited') {
      console.log(`    Score: ${result.score}/100 | Platform: ${result.analysis.platform} | Schema: ${result.analysis.hasSchema ? 'Yes' : 'No'} | Words: ${result.analysis.wordCount}`);
    } else {
      console.log(`    FAILED: ${result.error}`);
    }
  }

  // Build summary
  const audited = results.filter(r => r.status === 'audited');
  const avgScore = audited.length ? Math.round(audited.reduce((s, r) => s + r.score, 0) / audited.length) : 0;
  
  const output = {
    market: 'Branson, MO',
    industry: 'Towing',
    lastUpdated: new Date().toISOString(),
    totalBusinesses: BUSINESSES.length,
    auditedCount: audited.length,
    unreachableCount: results.length - audited.length,
    averageScore: avgScore,
    summary: {
      avgWebsiteQuality: avgScore,
      withSchema: audited.filter(r => r.analysis.hasSchema).length,
      withSSL: audited.filter(r => r.analysis.hasSSL).length,
      withMobileViewport: audited.filter(r => r.analysis.hasMobileViewport).length,
      withServicePages: audited.filter(r => r.analysis.hasServicePages).length,
      withReviews: audited.filter(r => r.analysis.hasReviews).length,
      withContactForm: audited.filter(r => r.analysis.hasContactForm).length,
      withSitemap: audited.filter(r => r.analysis.hasSitemap).length,
      avgWordCount: audited.length ? Math.round(audited.reduce((s, r) => s + r.analysis.wordCount, 0) / audited.length) : 0,
      platforms: audited.reduce((acc, r) => { acc[r.analysis.platform] = (acc[r.analysis.platform] || 0) + 1; return acc; }, {}),
      grammarIssuesFound: audited.filter(r => r.analysis.grammarIssues.length > 0).length,
    },
    businesses: results
  };

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\n${'='.repeat(50)}`);
  console.log(`RESULTS SUMMARY`);
  console.log(`${'='.repeat(50)}`);
  console.log(`Businesses found: ${BUSINESSES.length}`);
  console.log(`Successfully audited: ${audited.length}`);
  console.log(`Average website score: ${avgScore}/100`);
  console.log(`With structured data (schema): ${output.summary.withSchema}/${audited.length}`);
  console.log(`With SSL: ${output.summary.withSSL}/${audited.length}`);
  console.log(`With sitemap: ${output.summary.withSitemap}/${audited.length}`);
  console.log(`With service pages: ${output.summary.withServicePages}/${audited.length}`);
  console.log(`Grammar issues detected: ${output.summary.grammarIssuesFound}/${audited.length}`);
  console.log(`Avg word count: ${output.summary.avgWordCount}`);
  console.log(`\nSaved to: ${OUTPUT_FILE}`);
}

main().catch(console.error);
