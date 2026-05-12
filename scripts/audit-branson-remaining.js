#!/usr/bin/env node
/**
 * Audit remaining Branson industries using pre-collected business data from search results.
 * SerpAPI credits exhausted, so businesses were found via Brave Search.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'market-audits');
const ONLY = process.argv[2] || null;

const INDUSTRIES = {
  roofers: [
    { name: 'Branson Roof Co', url: 'https://bransonroofco.com/' },
    { name: 'The Micham Roofing Company', url: 'https://michamroofing.com/' },
    { name: 'Don Roofing & Siding', url: 'https://www.donroofing.com/' },
    { name: 'Cook Roofing Company', url: 'https://www.cookroofing.com/' },
    { name: 'SwingCoast Roofs & Gutters', url: 'https://swingcoastroofing.com/' },
    { name: 'Plumlee Construction', url: 'https://plumleeconstruction.com/' },
    { name: 'Heritage Roofing & Repair', url: 'https://myheritageroofing.com/roofing-branson-mo/' },
    { name: 'Benson Roofing', url: 'https://www.bensonroofing.net/' },
    { name: 'Cox Roofing', url: 'https://coxroofing.net/' },
    { name: 'Branson Springfield Roof Co', url: 'https://www.bransonspringfieldroof.com/' },
    { name: 'Mako Exteriors', url: 'https://www.makoexteriors.com/branson-roofing/' },
    { name: 'Storm Restorations of America', url: 'https://www.stormrestorationsofamerica.com/branson-mo-roofers' },
  ],
  'pest-control': [
    { name: 'Rottler Pest Solutions', url: 'https://www.rottler.com/service-areas/branson/' },
    { name: 'Tri-Lakes Pest Control', url: 'https://tri-lakespestcontrolllc.com/' },
    { name: 'Mr. Bug Killer', url: 'https://mrbugkiller.com/' },
    { name: 'Bug Zero', url: 'https://bugzero.com/branson-mo-pest-control/' },
    { name: 'AmeriPest Solutions', url: 'https://ameripest-solutions.com/locations/branson/' },
    { name: 'Nelson Pest & Maintenance', url: 'https://nelsonpestcontrol.com/' },
    { name: 'Schendel Pest Services', url: 'https://www.schendelpest.com/pest-control/branson-mo/' },
    { name: 'Nature Shield Pest Solutions', url: 'https://natureshieldpestsolutions.com/pest-control-branson-mo/' },
    { name: 'Mantis Pest Solutions', url: 'https://mantispestsolutions.com/where-we-service/branson-mo-pest-control/' },
    { name: 'BugX Pest Control', url: 'https://www.pestcontrolbranson.net/' },
    { name: 'Mosquito Joe', url: 'https://mosquitojoe.com/locations/missouri/branson/' },
    { name: '417 Pest Solutions', url: 'https://pest-control-branson-mo.ati-net.com/' },
  ],
  'tree-service': [
    { name: 'Lakes Tree Service', url: 'https://www.lakestreeservicemo.net/' },
    { name: "Benoit's Tree Care", url: 'https://www.benoittreecare.com/' },
    { name: 'Ryan Lawn & Tree', url: 'https://ryanlawn.com/branson-tree-service/' },
    { name: "Hansen's Tree Service", url: 'https://www.hansenstree.com/branson-mo/' },
    { name: 'A Cut Above Tree Service', url: 'https://www.acutabovetreemo.com' },
    { name: "Long's Tree Service", url: 'https://www.longstreeservices.com/' },
    { name: 'Pace Tree Service', url: 'https://www.paceallamericantreeservice.com/' },
    { name: 'Trufast Tree Service', url: 'https://www.trufasttreeservice.com/branson-tree-services/' },
    { name: 'Branson Tree Removal', url: 'https://bransontreeremoval.com/our-services/' },
  ],
  'garage-door': [
    { name: 'Garage Door Guy', url: 'https://mygaragedoorguy.com/branson/' },
    { name: "Kelly's Garage Door", url: 'https://www.kellysgaragedoor.com/' },
    { name: 'Precision Garage Door of Branson', url: 'https://precisiondoorswmo.com/branson' },
    { name: 'Ozarks Overhead Door & More', url: 'https://ozarksoverheaddoor.com/' },
    { name: 'Boone County Door', url: 'https://boonecountydoor.com/' },
    { name: '3S Garage Door Service', url: 'https://3sgaragedoorservice.com/' },
    { name: 'NWA Garage Doors', url: 'https://garagedoorsofnwa.com/garage-door-repair-branson-mo' },
    { name: 'Access Garage Doors', url: 'https://accessdoorcompany.com/springfield-mo/branson-garage-door-company/' },
  ],
  restoration: [
    { name: 'Chief Restoration Services', url: 'https://www.chiefrestorationswmo.com/' },
    { name: 'Clean Green Restoration (CGR)', url: 'https://www.cgrmo.com/' },
    { name: 'Simpson Restoration', url: 'https://simpsonrestorationllc.com/branson-water-damage-restoration/' },
    { name: 'True North Restoration', url: 'https://swmo.gotruenorth.com/water-damage-restoration' },
    { name: 'SERVPRO of Nixa/Branson', url: 'https://www.servpro.com/locations/mo/servpro-of-nixa-branson/services/water-damage' },
    { name: 'Sho-Me Clean', url: 'https://bransoncarpetcleaners.com/water-removal-restoration/' },
    { name: 'Kleen Green Group', url: 'https://www.wekleengreen.com/Water-Restoration' },
    { name: 'Kwik Dry LLC', url: 'https://www.kwikdrysystems.com/services/water-and-fire-damage-restoration-branson,-mo' },
    { name: 'Paul Davis Restoration', url: 'https://southwest-missouri.pauldavis.com/service-area/branson-mo/' },
    { name: 'ABC Damage Restoration', url: 'https://www.abcdamagerestoration.com/service-areas/branson-mo' },
  ],
};

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

async function auditIndustry(slug, businesses) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  INDUSTRY: ${slug.toUpperCase()}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  ${businesses.length} businesses to audit\n`);

  const results = [];
  for (const biz of businesses) {
    console.log(`  Auditing: ${biz.name}`);
    const page = await fetchPage(biz.url);

    if (page.error || page.statusCode >= 400) {
      results.push({ name: biz.name, url: biz.url, phone: '', email: '', address: '', status: 'unreachable', error: page.error || `HTTP ${page.statusCode}`, score: 0, analysis: null });
      console.log(`    FAILED: ${page.error || page.statusCode}`);
      continue;
    }

    const analysis = analyzeHtml(page.html, page.finalUrl || biz.url);
    const score = scoreWebsite(analysis);
    results.push({
      name: biz.name,
      url: biz.url,
      finalUrl: page.finalUrl,
      phone: analysis.phones[0] || '',
      email: analysis.emails[0] || '',
      address: analysis.addresses[0] || '',
      status: 'audited',
      score,
      analysis
    });
    console.log(`    Score: ${score}/100 | Platform: ${analysis.platform} | Schema: ${analysis.hasSchema ? '✓' : '✗'} | Phone: ${analysis.phones[0] || 'none'}`);
  }

  const audited = results.filter(r => r.status === 'audited');
  const avgScore = audited.length ? Math.round(audited.reduce((s, r) => s + r.score, 0) / audited.length) : 0;

  const output = {
    market: 'Branson, MO',
    industry: slug,
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

  const outFile = path.join(OUTPUT_DIR, `branson-${slug}.json`);
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`\n  ✓ Saved: ${outFile} (${audited.length} businesses, avg score: ${avgScore})`);
  return output;
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const toRun = ONLY ? { [ONLY]: INDUSTRIES[ONLY] } : INDUSTRIES;
  if (ONLY && !INDUSTRIES[ONLY]) { console.error(`Unknown: ${ONLY}. Options: ${Object.keys(INDUSTRIES).join(', ')}`); process.exit(1); }

  console.log(`\nGeoNeo Audit — Branson, MO (remaining industries)`);
  console.log(`Industries: ${Object.keys(toRun).join(', ')}\n`);

  const summaries = [];
  for (const [slug, businesses] of Object.entries(toRun)) {
    try {
      const result = await auditIndustry(slug, businesses);
      summaries.push({ industry: slug, businesses: result.auditedCount, avgScore: result.averageScore });
    } catch (e) {
      console.error(`  ERROR: ${slug}: ${e.message}`);
      summaries.push({ industry: slug, error: e.message });
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
