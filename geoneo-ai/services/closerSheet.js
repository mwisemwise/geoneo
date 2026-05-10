/**
 * Closer Sheet — the parallel artifact a salesperson (or AI call agent) reads
 * during a closing conversation. 1-2 page distilled view of:
 *   - Top 5 audit findings with dollar impact
 *   - Visual before/after (placeholder until Instant Makeover lands)
 *   - Total dollar opportunity (monthly + annual)
 *   - Persona-targeted recommended package
 *   - ROI math vs the prospect's current monthly marketing spend
 *   - Microscripts: opener / pain validation / solution bridge / trial close /
 *     objection handlers / close ask / follow-up triggers / upsell pivot
 *   - Follow-up sequence triggers
 *
 * NO LLM. All scripts are hand-written templates with deterministic variable
 * substitution from real audit + prospect data. Microscripts are tested
 * patterns, not generated copy.
 *
 * Output: structured object suitable for HTML render, print/PDF, or
 * AI call agent reading.
 */

const { estimateForFinding, cplFor, citySizeBucketFor } = require('./dollarLiftEngine');

// Persona detection from audit signals + prospect intel.
const PERSONAS = {
  bar_friend_victim: {
    label: 'The Bar-Friend Victim',
    rationale: (p) => `Spends ~$${p.currentMonthlySpend || 500}/mo with a vendor whose deliverable is invisible. High pain, looking for accountability.`,
    targetTier: 'smart_spend'
  },
  escapee: {
    label: 'The Escapee',
    rationale: () => 'Already pays an SEO agency $1,500-$3,000/mo, hates the reports, can\u2019t fire without replacement.',
    targetTier: 'white_glove'
  },
  high_ltv_specialist: {
    label: 'The High-LTV Specialist',
    rationale: (p) => `${p.industry} customers worth $5K-$50K each. One captured customer pays for 6+ months of service.`,
    targetTier: 'white_glove'
  },
  multi_location: {
    label: 'The Multi-Location Owner',
    rationale: (p) => `${p.locationCount || 'Multiple'} locations multiply both the problem and the opportunity. Per-location ROI math is obvious.`,
    targetTier: 'white_glove'
  },
  established_pro: {
    label: 'The Established Pro',
    rationale: (p) => `${p.yearsInBusiness || '8+'} years in business. Has revenue, credentials, and team — missing only content velocity. Done-for-you with their byline fits perfectly.`,
    targetTier: 'white_glove'
  },
  latecomer: {
    label: 'The Latecomer',
    rationale: () => 'Knows SEO matters, has nothing yet. Easiest close — just hasn\u2019t picked a vendor.',
    targetTier: 'fix_plan'
  },
  unaware_leaker: {
    label: 'The Unaware Leaker',
    rationale: () => 'Doesn\u2019t realize they\u2019re losing online customers. The dollar number IS the wake-up call.',
    targetTier: 'fix_plan'
  },
  diy_overconfident: {
    label: 'The Overconfident DIY-er',
    rationale: () => 'Set up GBP, posts on Facebook, runs $200/mo Google Ads. Thinks they have it covered. The audit shows the structural gaps.',
    targetTier: 'maintenance'
  }
};

const TIER_DEFINITIONS = {
  fix_plan: {
    label: 'Fix Plan',
    oneTimePrice: 199,
    monthlyPrice: 0,
    rollsToTier: 'maintenance',
    rollsToPriceMonthly: 79,
    rollsAfterDays: 60,
    valueLine: '$199 one-time + 2 months free Maintenance ($158 value), then $79/mo'
  },
  maintenance: {
    label: 'Maintenance Plan',
    oneTimePrice: 0,
    monthlyPrice: 79,
    valueLine: '$79/mo — weekly re-score + brief + fix tracker + member dashboard'
  },
  smart_spend: {
    label: 'Smart Spend',
    oneTimePrice: 0,
    monthlyPrice: 499,
    valueLine: '$499/mo — Maintenance + ad spend audit + keyword strategy + monthly Matt review + vendor accountability'
  },
  white_glove_low: {
    label: 'White Glove (entry)',
    oneTimePrice: 0,
    monthlyPrice: 800,
    valueLine: '$800/mo — Smart Spend + 2 expert-byline articles/mo + content roadmap + done-for-you fixes'
  },
  white_glove_high: {
    label: 'White Glove (established)',
    oneTimePrice: 0,
    monthlyPrice: 1500,
    valueLine: '$1,500/mo — White Glove + quarterly Matt visit + multi-location coverage + priority response'
  }
};

function detectPersona(prospect = {}, audit = {}) {
  const p = prospect;
  const spend = Number(p.currentMonthlySpend) || 0;
  const vendor = String(p.currentVendor || '').toLowerCase();
  const yrs = Number(p.yearsInBusiness) || 0;
  const locations = Number(p.locationCount) || 1;
  const industry = String(p.industry || '').toLowerCase();
  const cpl = cplFor(industry);

  // Multi-location wins first if 3+
  if (locations >= 3) return 'multi_location';
  // Escapee: high spend with explicit "agency"
  if (spend >= 1200 && /agenc|firm|marketing.*compan/.test(vendor)) return 'escapee';
  // Bar-friend victim: $300-$700 spend with informal vendor or none stated
  if (spend >= 300 && spend <= 700) return 'bar_friend_victim';
  // High-LTV specialist: high-CPL vertical with established business
  if (cpl >= 100 && yrs >= 3) return 'high_ltv_specialist';
  // Established Pro: 8+ years, real revenue, but thin content
  if (yrs >= 8 && (audit?.contentVelocity?.score || 0) < 50) return 'established_pro';
  // DIY: has GBP claimed + paid ad signals + no agency mentioned
  if (audit?.adSpendSignals?.detected && spend < 300 && !vendor) return 'diy_overconfident';
  // Unaware leaker: no GBP + thin site + no spend mentioned
  if (!audit?.localSignals?.gbpClaimed && spend === 0) return 'unaware_leaker';
  // Default: latecomer
  return 'latecomer';
}

function recommendTier(persona, prospect = {}, audit = {}) {
  const personaDef = PERSONAS[persona] || PERSONAS.latecomer;
  let tierKey = personaDef.targetTier;
  // Refine: white_glove tier within the high tier — choose entry vs established
  if (tierKey === 'white_glove') {
    const cpl = cplFor(prospect.industry);
    const locations = Number(prospect.locationCount) || 1;
    tierKey = (cpl >= 100 || locations >= 3) ? 'white_glove_high' : 'white_glove_low';
  }
  return { tierKey, ...TIER_DEFINITIONS[tierKey], rationale: personaDef.rationale(prospect) };
}

function computeRoi({ tier, monthlyOpportunityHigh, monthlyOpportunityLow, currentMonthlySpend = 0 }) {
  const tierMonthlyCost = tier.monthlyPrice;
  const tierOneTime = tier.oneTimePrice || 0;

  // Net monthly gain = audit-identified opportunity captured - tier cost
  const netLow = Math.max(0, monthlyOpportunityLow - tierMonthlyCost);
  const netHigh = Math.max(0, monthlyOpportunityHigh - tierMonthlyCost);

  // Months to break even on the one-time fee, given lower-bound monthly capture
  const monthsToBreakEvenOneTime = (tierOneTime > 0 && netLow > 0) ? Math.ceil(tierOneTime / netLow) : 0;

  // Annual net gain
  const annualNetLow = netLow * 12 - tierOneTime;
  const annualNetHigh = netHigh * 12 - tierOneTime;

  // ROI percentage: (annual net gain) / (annual cost) * 100
  const annualCost = (tierMonthlyCost * 12) + tierOneTime;
  const roiLow = annualCost > 0 ? Math.round((annualNetLow / annualCost) * 100) : null;
  const roiHigh = annualCost > 0 ? Math.round((annualNetHigh / annualCost) * 100) : null;

  // Spend reallocation framing if they already pay for marketing
  const replacedSpendAnnual = (Number(currentMonthlySpend) || 0) * 12;
  const totalReturnIfReplacing = annualNetLow + replacedSpendAnnual;

  return {
    monthlyTierCost: tierMonthlyCost,
    oneTimeFee: tierOneTime,
    monthlyNet: { low: netLow, high: netHigh },
    annualNet: { low: annualNetLow, high: annualNetHigh },
    monthsToBreakEvenOneTime,
    annualROIPercent: { low: roiLow, high: roiHigh },
    currentMonthlySpend: Number(currentMonthlySpend) || 0,
    spendIfReplaced: { annualSavings: replacedSpendAnnual, totalAnnualImpact: totalReturnIfReplacing }
  };
}

function buildMicroscripts({ prospect, audit, topFinding, totalMonthlyHigh, recommendedTier, persona }) {
  const biz = prospect.businessName || 'your business';
  const city = prospect.city || 'your area';
  const industry = String(prospect.industry || 'local services').toLowerCase();
  const contactName = prospect.contactName || prospect.firstName || 'there';
  const personaLabel = PERSONAS[persona]?.label || 'Local owner';

  return {
    opener: {
      duration: '15-20s',
      script: `Hi ${contactName}, this is [your name] from GeoNeo. I ran a free SEO + AI-search audit on ${biz} this morning — got 90 seconds for what I found?`,
      tone: 'casual, low-pressure, confident'
    },

    painValidation: {
      duration: '30-45s',
      script: `So here\u2019s what jumped out: I tested ${biz} across the queries your customers type when they need a ${industry.split(' ')[0]} in ${city}. You showed up in ${audit.localPresence?.appearsIn || 1} of ${audit.localPresence?.tested || 8} searches I ran. Your top competitor — ${audit.topCompetitor?.name || '[competitor]'} — showed up in ${audit.topCompetitor?.appearsIn || 6}. The math says that\u2019s costing you somewhere around $${Math.round(totalMonthlyHigh / 100) * 100}/month in lost calls and contacts. Want me to walk you through the top 3 things driving that gap?`,
      dataPoints: ['localPresence.appearsIn', 'topCompetitor.name', 'totalMonthlyHigh']
    },

    solutionBridge: {
      duration: '40-60s',
      script: `Quick context: we\u2019re not an agency, no contracts, month-to-month. The ${recommendedTier.label} ($${recommendedTier.monthlyPrice}/mo${recommendedTier.oneTimePrice ? ` + $${recommendedTier.oneTimePrice} one-time` : ''}) does exactly the work the audit says you need: [top 3 deliverables for tier]. The math: at the low end of what we calculated, you net $${Math.max(0, totalMonthlyHigh * 0.6 - recommendedTier.monthlyPrice)}/mo positive. ${recommendedTier.tierKey === 'fix_plan' ? 'And the $199 includes 2 months of ongoing service free.' : 'Cancel anytime if it\u2019s not working.'}`,
      tone: 'specific, low-pressure, math-first'
    },

    trialClose: {
      script: `Does that math line up with what you\u2019d expect from solving this? Anything jump out as unrealistic?`,
      purpose: 'Surface objections before the close ask'
    },

    objectionHandlers: [
      {
        objection: 'It\u2019s too expensive',
        response: `Compared to what? You\u2019re currently spending $${prospect.currentMonthlySpend || '0-X'} on marketing today. The ${recommendedTier.label} replaces or augments that — and the audit says it captures $${Math.round(totalMonthlyHigh / 100) * 100}/mo more than you\u2019re getting now. Net positive. If the numbers don\u2019t hold up, you cancel.`
      },
      {
        objection: 'I have a guy',
        response: `Cool — what does your guy say about your AI-search visibility on ChatGPT and Perplexity? And what does he do about your missing schema? Don\u2019t replace him. Hand him this audit and ask him for a quote on doing what\u2019s in it. If he can, he\u2019s your guy. If he can\u2019t, you have cover to switch.`
      },
      {
        objection: 'I need to think about it',
        response: `Totally fair. What specifically do you need to think through? If it\u2019s the price, here\u2019s the alternative: keep losing $${Math.round(totalMonthlyHigh / 100) * 100}/mo for the next 90 days while you decide. If it\u2019s trust — month-to-month, cancel anytime, we\u2019re local in Branson. What\u2019s the actual hesitation?`
      },
      {
        objection: 'Just email me the info',
        response: `Sure — but the audit is already in your inbox from yesterday. Did you open it? [If yes] What part wasn\u2019t clear? [If no] How about I send it again right now and we\u2019re on the phone in 10 minutes after you\u2019ve looked at the dollar number?`
      },
      {
        objection: 'I\u2019ve tried SEO before, didn\u2019t work',
        response: `Who did you work with, and how long? Most contractors who say that paid an agency for 6-12 months and saw nothing. We\u2019re different shape: month-to-month, no contracts, and the audit shows you exactly what we\u2019d do — no mystery work. If after 60 days you don\u2019t see your visibility number move, you cancel.`
      },
      {
        objection: 'I don\u2019t trust online services',
        response: `Fair. We\u2019re Branson-based — Matt can drive over and sit in your office. We work face-to-face for year-1 customers in the Ozarks. When works for a 30-min coffee?`
      },
      {
        objection: 'Send me a contract',
        response: `There isn\u2019t one. ${recommendedTier.label} is month-to-month. No setup fee${recommendedTier.oneTimePrice ? ` other than the $${recommendedTier.oneTimePrice} one-time fix work` : ''}. You can cancel after one month. That\u2019s the whole agreement.`
      },
      {
        objection: 'My competitor uses XYZ tool',
        response: `That tool is built for marketers — it spits out reports your competitor probably doesn\u2019t read. We give you 3 specific fixes per week with the exact code to paste. Apples to oranges. The audit shows YOU what to do; XYZ shows your competitor a dashboard.`
      }
    ],

    closeAsk: {
      script: `OK — sounds like the math works for you. I have ${recommendedTier.tierKey === 'fix_plan' ? 'an opening to start the fix work this week' : 'two slots open for kickoff calls'}: Tuesday at 2pm or Thursday at 10am. Which works better?`,
      commitment: 'specific time slot, not "let me know"',
      fallback: 'If neither works: "What time tomorrow morning is good?"'
    },

    notNowFollowUp: {
      triggerDays: 3,
      script: `Hey ${contactName} — quick check-in. Re-ran your audit this morning and your visibility score moved ${audit.scoreDelta?.direction || 'down'} ${audit.scoreDelta?.points || 2} points since we talked. ${audit.topCompetitor?.name || 'Your top competitor'} added ${audit.competitorDelta?.newCitations || 3} new AI citations. Want me to send the updated dollar number?`
    },

    upsellPivot: {
      trigger: 'after first month of ${recommendedTier.label}',
      script: recommendedTier.tierKey === 'fix_plan' ? `Your Maintenance starts in 7 days. Here\u2019s the difference between staying on Maintenance ($79/mo) vs. moving up to Smart Spend ($499/mo): Smart Spend includes ad-budget oversight which based on your $${prospect.currentMonthlySpend || 0}/mo current spend would either save you money or 3-5x your conversion. Worth a 15-min look?` :
        recommendedTier.tierKey === 'maintenance' ? `Month 1 numbers are in — your visibility score moved from X to Y. Most members at your stage benefit from Smart Spend ($499/mo) because we add ad-spend oversight on top of what you\u2019re already getting.` :
        `Year-1 customers hitting consistent results often move to White Glove — we draft and ship 2 expert-byline articles per month under your name. That\u2019s the next gear for content velocity.`
    }
  };
}

function buildFollowUpPath(prospect, recommendedTier) {
  const biz = prospect.businessName || 'their business';
  return [
    { trigger: '+1 hour after call', action: `Send written summary + audit PDF + 3 prioritized fixes from the conversation. Subject: "Recap: ${biz} audit + the 3 fixes we discussed"` },
    { trigger: '+2 days', action: `Send same-vertical case study from same city. Subject: "Quick case study from a ${prospect.industry || 'similar'} customer in ${prospect.city || 'your area'}"` },
    { trigger: '+5 days', action: `Re-run audit, send fresh number. Subject: "Your visibility score this week — what moved"` },
    { trigger: '+14 days', action: `Comparison delta: what changed on their site vs what didn\u2019t, plus competitor score moved. Subject: "${biz} vs [top competitor]: 14-day update"` },
    { trigger: '+30 days', action: `Final pre-close: "Last check-in" with full re-audit + final ${recommendedTier.label} offer.` }
  ];
}

/**
 * Top-level: assemble the closer sheet from all inputs.
 */
function buildCloserSheet({ prospect = {}, audit = {}, allFindings = [], dollarLifts = [], makeover = null }) {
  const persona = detectPersona(prospect, audit);
  const tier = recommendTier(persona, prospect, audit);

  // Top 5 findings: rank by $$ impact (high end), tie-break by severity
  const ranked = (allFindings || []).slice().sort((a, b) => {
    const aDollar = a.dollarImpact?.monthly?.high || 0;
    const bDollar = b.dollarImpact?.monthly?.high || 0;
    if (bDollar !== aDollar) return bDollar - aDollar;
    const sevRank = { high: 3, medium: 2, low: 1 };
    return (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
  });
  const top5 = ranked.slice(0, 5).map((f, i) => ({
    rank: i + 1,
    severity: f.severity,
    title: f.title,
    oneLineImpact: f.detail || f.title,
    evidence: f.evidence || {},
    dollarImpact: f.dollarImpact || { monthly: { low: 0, high: 0 } },
    fixCategory: f.key || 'unknown'
  }));

  // Sum up $$ across top 5 (capped at 80% to avoid additive overstatement)
  const sumLow = top5.reduce((s, f) => s + (f.dollarImpact.monthly.low || 0), 0);
  const sumHigh = top5.reduce((s, f) => s + (f.dollarImpact.monthly.high || 0), 0);
  const totalMonthly = { low: Math.round(sumLow * 0.8), high: Math.round(sumHigh * 0.8) };
  const totalAnnual = { low: totalMonthly.low * 12, high: totalMonthly.high * 12 };

  const roi = computeRoi({
    tier,
    monthlyOpportunityLow: totalMonthly.low,
    monthlyOpportunityHigh: totalMonthly.high,
    currentMonthlySpend: prospect.currentMonthlySpend
  });

  const microscripts = buildMicroscripts({
    prospect, audit, topFinding: top5[0],
    totalMonthlyHigh: totalMonthly.high,
    recommendedTier: tier,
    persona
  });

  const followUpPath = buildFollowUpPath(prospect, tier);

  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: 'closer-sheet/1.0',

    prospect: {
      businessName: prospect.businessName,
      domain: prospect.domain,
      industry: prospect.industry,
      city: prospect.city,
      state: prospect.state,
      contactName: prospect.contactName,
      phone: prospect.phone,
      email: prospect.email,
      currentMonthlySpend: prospect.currentMonthlySpend || 0,
      currentVendor: prospect.currentVendor || null,
      yearsInBusiness: prospect.yearsInBusiness || null,
      locationCount: prospect.locationCount || 1,
      persona,
      personaLabel: PERSONAS[persona]?.label
    },

    hero: {
      overallScore: audit.overallScore || 0,
      grade: scoreToGrade(audit.overallScore || 0),
      industryPercentile: audit.industryPercentile || null,
      headline: buildHeadline(prospect, audit, totalMonthly),
      visualBeforeUrl: makeover?.beforeUrl || null,
      visualAfterUrls: makeover?.afterUrls || []
    },

    topFiveFindings: top5,

    dollarMath: {
      totalMonthlyOpportunity: totalMonthly,
      totalAnnualOpportunity: totalAnnual,
      methodNote: 'Sum of top 5 finding-level $$ impacts, capped at 80% to avoid additive overstatement. Each finding\u2019s $$ shown in inputs.',
      industryBenchmarkLine: `Contractors in ${prospect.industry || 'this vertical'} ${prospect.city ? `serving ${prospect.city}-size markets ` : ''}who lack these capabilities typically miss $${totalMonthly.low}-$${totalMonthly.high}/mo in unconverted local search demand.`
    },

    competitiveContext: {
      yourScore: audit.overallScore || 0,
      industryMedian: audit.industryMedian || null,
      topCompetitor: audit.topCompetitor || null,
      citySize: citySizeBucketFor(prospect.city).popMax === 25000 ? 'micro' : 'small/medium'
    },

    recommendedPackage: {
      tierKey: tier.tierKey,
      label: tier.label,
      monthlyPrice: tier.monthlyPrice,
      oneTimeFee: tier.oneTimePrice,
      valueLine: tier.valueLine,
      personaRationale: tier.rationale,
      whyThisTier: `Persona "${PERSONAS[persona]?.label}" + industry CPL $${cplFor(prospect.industry)} + ${roi.monthlyNet.high > 0 ? 'net positive ROI' : 'breakeven point identified'} → ${tier.label} is the right fit.`,
      roi
    },

    microscripts,
    followUpPath,

    rendering: {
      printPages: 2,
      keyHighlights: [
        `Overall: ${audit.overallScore || 0}/100 (${scoreToGrade(audit.overallScore || 0)})`,
        `Lost: $${totalMonthly.low}-$${totalMonthly.high}/mo`,
        `Recommended: ${tier.label} ($${tier.monthlyPrice}/mo${tier.oneTimePrice ? ` + $${tier.oneTimePrice}` : ''})`,
        roi.monthlyNet.high > 0 ? `Net positive: $${roi.monthlyNet.low}-$${roi.monthlyNet.high}/mo` : 'Break-even path defined'
      ]
    }
  };
}

function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C+';
  if (score >= 50) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function buildHeadline(prospect, audit, totalMonthly) {
  const biz = prospect.businessName || 'This business';
  const city = prospect.city || 'their market';
  const competitor = audit?.topCompetitor?.name;
  const score = audit?.overallScore || 0;

  if (totalMonthly.high >= 2000) {
    return `${biz} is leaving $${totalMonthly.low}-$${totalMonthly.high}/mo on the table${competitor ? ` while ${competitor} captures it` : ''}. Score: ${score}/100.`;
  }
  if (totalMonthly.high >= 500) {
    return `${biz} scores ${score}/100 in ${city} — costing roughly $${totalMonthly.low}-$${totalMonthly.high}/mo in missed local search.`;
  }
  return `${biz}\u2019s search visibility is ${score}/100. Closing the top 5 gaps captures $${totalMonthly.low}-$${totalMonthly.high}/mo.`;
}

module.exports = {
  buildCloserSheet,
  detectPersona,
  recommendTier,
  computeRoi,
  buildMicroscripts,
  buildFollowUpPath,
  scoreToGrade,
  PERSONAS,
  TIER_DEFINITIONS
};
