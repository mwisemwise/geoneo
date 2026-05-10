const test = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeGeo,
  scorePassageCitability,
  analyzeAiCrawlerAccess,
  analyzeLlmsTxt,
  generateLlmsTxt
} = require('../services/geoAnalyzer');

const RICH_GEO_PAGE = `
  <html><body>
    <article datetime="2026-04-01">
    <h1>Plumbing Services Branson MO</h1>
    <nav><a href="#services">Services</a> <a href="#faq">FAQ</a></nav>
    <h2>What is hydro jetting?</h2>
    <p>Hydro jetting is a drain-cleaning method that uses high-pressure water (3,500 PSI) to clear blockages.</p>
    <h3>How much does plumbing repair cost in Branson?</h3>
    <p>Most jobs run $150-$500 depending on scope. Emergency calls add 30%.</p>
    <ol><li>Diagnose the issue</li><li>Provide estimate</li><li>Complete work</li></ol>
    <details><summary>Do you offer 24/7 service?</summary><p>Yes, our team is on-call.</p></details>
    <p>According to the EPA, water-saving fixtures reduce usage 20%. <a href="https://epa.gov/watersense">Source</a>.</p>
    <p>Last updated January 2026</p>
    </article>
  </body></html>
`;

const BARE_PAGE = '<html><body><h1>Plumber</h1><p>Call us today.</p></body></html>';

test('scorePassageCitability: rich page hits multiple blocks', () => {
  const r = scorePassageCitability(RICH_GEO_PAGE);
  assert.ok(r.score > 50, `expected >50, got ${r.score}`);
  assert.equal(r.blocks.qa_blocks.passed, true);
  assert.equal(r.blocks.definition_blocks.passed, true);
  assert.equal(r.blocks.list_blocks.passed, true);
  assert.equal(r.blocks.citations.passed, true);
});

test('scorePassageCitability: bare page scores poorly', () => {
  const r = scorePassageCitability(BARE_PAGE);
  assert.ok(r.score < 30, `expected <30, got ${r.score}`);
});

test('analyzeAiCrawlerAccess: blanket Disallow blocks all crawlers', () => {
  const robots = 'User-agent: *\nDisallow: /\n';
  const r = analyzeAiCrawlerAccess(robots);
  Object.values(r).forEach(v => assert.equal(v.allowed, false));
});

test('analyzeAiCrawlerAccess: explicit GPTBot allow overrides wildcard disallow', () => {
  const robots = 'User-agent: GPTBot\nAllow: /\n\nUser-agent: *\nDisallow: /\n';
  const r = analyzeAiCrawlerAccess(robots);
  assert.equal(r.GPTBot.allowed, true);
  assert.equal(r.ClaudeBot.allowed, false);
});

test('analyzeAiCrawlerAccess: empty robots = all allowed', () => {
  const r = analyzeAiCrawlerAccess('');
  Object.values(r).forEach(v => assert.equal(v.allowed, true));
});

test('analyzeLlmsTxt: detects presence + parses structure', () => {
  const llms = '# Acme\n\n> Plumber in Branson\n\n## Services\n\n- [Drain cleaning](https://acme.com/drain)\n- [Water heater](https://acme.com/wh)\n';
  const r = analyzeLlmsTxt(llms);
  assert.equal(r.llmsTxt.present, true);
  assert.ok(r.llmsTxt.bytes > 0);
  assert.equal(r.llmsTxt.headerCount, 2);
  assert.equal(r.llmsTxt.linkCount, 2);
  assert.equal(r.llmsTxt.sectionCount, 1);
});

test('analyzeLlmsTxt: missing returns present=false', () => {
  const r = analyzeLlmsTxt(null);
  assert.equal(r.llmsTxt.present, false);
});

test('generateLlmsTxt: produces valid structure', () => {
  const out = generateLlmsTxt({
    businessName: 'Acme Plumbing',
    description: 'Trusted plumbing in Branson MO since 2010.',
    url: 'https://acme.com',
    industry: 'plumbing',
    city: 'Branson',
    state: 'MO',
    primaryServices: [
      { name: 'Drain cleaning', url: 'https://acme.com/drain' },
      { name: 'Water heaters', url: 'https://acme.com/wh' }
    ],
    sitemapUrls: ['https://acme.com/about', 'https://acme.com/contact']
  });
  assert.ok(out.startsWith('# Acme Plumbing'));
  assert.ok(out.includes('## Services'));
  assert.ok(out.includes('## Service Area'));
  assert.ok(out.includes('Branson, MO'));
  assert.ok(out.includes('[Drain cleaning](https://acme.com/drain)'));
});

test('generateLlmsTxt: refuses to generate without basics', () => {
  assert.equal(generateLlmsTxt({ industry: 'plumbing' }), null);
});

test('analyzeGeo: rich page + open robots + has llms.txt → high score', () => {
  const r = analyzeGeo({
    html: RICH_GEO_PAGE,
    robotsTxt: 'User-agent: *\nAllow: /\n',
    llmsTxtContent: '# Acme\n## Services\n- [A](http://x)'
  });
  assert.ok(r.overallScore >= 70, `expected >=70, got ${r.overallScore}`);
  assert.equal(r.status, 'pass');
  assert.equal(r.blockedCrawlers.length, 0);
});

test('analyzeGeo: blocked crawlers surface as a high-severity fix', () => {
  const r = analyzeGeo({
    html: BARE_PAGE,
    robotsTxt: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n',
    llmsTxtContent: null
  });
  assert.ok(r.fixes.some(f => f.key === 'geo-unblock-ai-crawlers' && f.severity === 'high'));
  const unblockFix = r.fixes.find(f => f.key === 'geo-unblock-ai-crawlers');
  assert.ok(unblockFix.snippet.includes('GPTBot'));
  assert.ok(unblockFix.snippet.includes('ClaudeBot'));
});

test('analyzeGeo: missing llms.txt surfaces as a fix', () => {
  const r = analyzeGeo({
    html: RICH_GEO_PAGE,
    robotsTxt: '',
    llmsTxtContent: null
  });
  assert.ok(r.fixes.some(f => f.key === 'geo-add-llms-txt'));
});

test('analyzeGeo: weights sum to 1.0', () => {
  const r = analyzeGeo({ html: BARE_PAGE, robotsTxt: '', llmsTxtContent: null });
  const sum = Object.values(r.weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1.0) < 0.001);
});
