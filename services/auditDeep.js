/**
 * Deep Audit Orchestrator — adapted from a1davida1/geoneo fork.
 * Runs parallel sub-analyzers (sitemap, NAP, images) and stamps dollar
 * lift onto every finding. Schema/E-E-A-T/GEO analyzers not yet merged;
 * scores from the main audit engine fill those gaps.
 *
 * NO LLM. Pure deterministic.
 */

const { analyzeSitemap } = require('./sitemapValidator');
const { analyzeNap } = require('./napChecker');
const { analyzeImages } = require('./imageAuditor');
const { estimateForFinding, estimateSpecificLoss } = require('./dollarLiftEngine');

const SECTION_TIMEOUT_MS = 8000;

async function withTimeout(promise, ms, label) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]).catch(err => ({ status: 'error', error: err.message, overallScore: 0, fixes: [] }));
}

/**
 * Run the deep audit on already-fetched HTML + supporting files.
 */
async function runDeepAudit(input = {}) {
  const {
    html = '',
    finalUrl = '',
    robotsTxt = '',
    sitemapXml = null,
    industry = '',
    city = '',
    state = '',
    businessFacts = {},
    serpContext = null
  } = input;

  const sectionStart = Date.now();
  const [sitemapResult, napResult, imagesResult] = await Promise.all([
    withTimeout(Promise.resolve(analyzeSitemap({ sitemapXml, sitemapUrl: businessFacts.sitemapUrl || (finalUrl ? new URL(finalUrl).origin + '/sitemap.xml' : ''), robotsTxt })), SECTION_TIMEOUT_MS, 'sitemap'),
    withTimeout(Promise.resolve(analyzeNap({ html, expectedBusinessName: businessFacts.businessName, expectedPhone: businessFacts.phone, expectedAddress: businessFacts.address })), SECTION_TIMEOUT_MS, 'nap'),
    withTimeout(Promise.resolve(analyzeImages({ html })), SECTION_TIMEOUT_MS, 'images')
  ]);
  const sectionMs = Date.now() - sectionStart;

  const missingFromQueries = serpContext?.missingCount || 0;
  const totalQueriesTested = serpContext?.totalQueries || 8;
  const currentAvgPosition = serpContext?.avgPosition || 99;

  // Stamp $$ onto every finding
  const allFindings = [];
  const sectionMap = { sitemap: sitemapResult, nap: napResult, images: imagesResult };
  Object.entries(sectionMap).forEach(([sectionName, result]) => {
    if (!result || result.status === 'error') return;
    const fixes = result.fixes || [];
    fixes.forEach(fix => {
      const dollarImpact = estimateForFinding({
        findingKey: fix.key || sectionName,
        industry, city,
        missingFromQueries, totalQueriesTested, currentAvgPosition
      });
      allFindings.push({
        ...fix,
        section: sectionName,
        dollarImpact: {
          monthly: dollarImpact.specific?.monthlyDollarLoss || { low: 0, high: 0 },
          general: dollarImpact.general?.monthlyDollarLoss || { low: 0, high: 0 },
          headlineText: dollarImpact.headlineText
        }
      });
    });
  });

  // Weighted overall from available sections
  const sectionScores = {
    sitemap: sitemapResult?.overallScore || 0,
    nap: napResult?.overallScore || 0,
    images: imagesResult?.overallScore || 0
  };
  // With 3 sections: nap 45%, images 30%, sitemap 25%
  const overallScore = Math.round(
    (sectionScores.nap * 0.45) +
    (sectionScores.images * 0.30) +
    (sectionScores.sitemap * 0.25)
  );

  const sortedByImpact = allFindings.slice().sort(
    (a, b) => (b.dollarImpact.monthly.high || 0) - (a.dollarImpact.monthly.high || 0)
  );
  const top5 = sortedByImpact.slice(0, 5);
  const totalLow = Math.round(top5.reduce((s, f) => s + f.dollarImpact.monthly.low, 0) * 0.8);
  const totalHigh = Math.round(top5.reduce((s, f) => s + f.dollarImpact.monthly.high, 0) * 0.8);

  return {
    schemaVersion: 'audit-deep/1.1',
    generatedAt: new Date().toISOString(),
    finalUrl,
    industry, city, state,
    sectionElapsedMs: sectionMs,
    overallScore,
    grade: overallScore >= 80 ? 'A' : overallScore >= 70 ? 'B+' : overallScore >= 60 ? 'B' : overallScore >= 50 ? 'C+' : overallScore >= 40 ? 'C' : 'D',
    status: overallScore >= 75 ? 'pass' : overallScore >= 50 ? 'warn' : 'fail',
    sections: { sitemap: sitemapResult, nap: napResult, images: imagesResult },
    sectionScores,
    findings: allFindings,
    topFiveFindings: top5,
    dollarOpportunity: {
      monthly: { low: totalLow, high: totalHigh },
      annual: { low: totalLow * 12, high: totalHigh * 12 },
      method: 'Sum of top 5 finding-level $$ impacts × 0.8'
    },
    serpContext: { missingFromQueries, totalQueriesTested, currentAvgPosition, provided: !!serpContext }
  };
}

module.exports = { runDeepAudit };
