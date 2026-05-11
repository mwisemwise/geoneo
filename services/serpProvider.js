const DEFAULT_TIMEOUT_MS = 20000;

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeDomain(input) {
  if (!input) {
    return '';
  }
  try {
    const asUrl = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const host = new URL(asUrl).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return normalizeText(input).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

function extractRootDomain(input) {
  const host = normalizeDomain(input);
  if (!host) {
    return '';
  }
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return host;
  }
  const secondLevelTlds = new Set(['co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'co.nz']);
  const tail2 = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  const tail3 = `${parts[parts.length - 3]}.${tail2}`;
  if (secondLevelTlds.has(tail2) && parts.length >= 3) {
    return tail3;
  }
  return tail2;
}

function safeUrl(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }
  return `https://${normalized}`;
}

function withTimeout(promiseFactory, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  return promiseFactory(controller.signal)
    .finally(() => clearTimeout(timeout));
}

function mapOrganicResults(entries, limit = 10) {
  return (Array.isArray(entries) ? entries : [])
    .slice(0, limit)
    .map((entry, index) => {
      const url = safeUrl(entry.link || entry.url || entry.displayed_link || '');
      return {
        position: Number(entry.position) || (index + 1),
        title: normalizeText(entry.title || entry.name || entry.snippet),
        domain: extractRootDomain(entry.domain || url),
        url
      };
    })
    .filter((entry) => entry.url || entry.domain);
}

function mapLocalPackResults(entries, limit = 10) {
  return (Array.isArray(entries) ? entries : [])
    .slice(0, limit)
    .map((entry, index) => {
      const website = safeUrl(entry.website || entry.link || entry.url || '');
      return {
        position: Number(entry.position) || (index + 1),
        title: normalizeText(entry.title || entry.name || entry.business_name),
        domain: extractRootDomain(website),
        url: website,
        rating: Number.isFinite(Number(entry.rating)) ? Number(entry.rating) : null,
        reviews: Number.isFinite(Number(entry.reviews)) ? Number(entry.reviews) : null
      };
    });
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function safeDecodeUri(value) {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return String(value || '');
  }
}

function parseReviewCount(text) {
  const normalized = normalizeText(text).replace(/,/g, '');
  const explicit = normalized.match(/(\d{1,7})\s+reviews?\b/i);
  if (explicit) {
    const value = Number(explicit[1]);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function parseGoogleSearchHtml(html, startOffset = 0) {
  const unreliablePage = /unusual traffic|consent\.google|our systems have detected|enable javascript/i.test(html);
  if (unreliablePage) {
    return [];
  }

  const snippetMatches = [...html.matchAll(/<div class="VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => stripHtml(decodeHtmlEntities(match[1] || '')));
  const linkMatches = [...html.matchAll(/<a[^>]+href="\/url\?q=([^"&]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/a>/gi)];
  const seenHost = new Set();
  return linkMatches
    .map((match, index) => {
      const rawUrl = safeDecodeUri(match[1] || '');
      const host = normalizeDomain(rawUrl);
      if (!host || /(^|\.)google\./i.test(host)) {
        return null;
      }
      if (seenHost.has(host)) {
        return null;
      }
      seenHost.add(host);
      const title = stripHtml(decodeHtmlEntities(match[2] || ''));
      const snippet = snippetMatches[index] || '';
      return {
        title: title || host,
        domain: extractRootDomain(host),
        link: rawUrl,
        snippet,
        reviews: parseReviewCount(`${title} ${snippet}`),
        position: startOffset + index + 1
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

function hasSerpApiCredentials(config = {}) {
  return Boolean(config.apiKey || process.env.SERP_API_KEY);
}

function hasDataForSeoCredentials(config = {}) {
  return Boolean((config.login || process.env.SERP_API_LOGIN) && (config.apiKey || process.env.SERP_API_KEY));
}

const STATE_ABBREVS = { al:'alabama',ak:'alaska',az:'arizona',ar:'arkansas',ca:'california',co:'colorado',ct:'connecticut',de:'delaware',fl:'florida',ga:'georgia',hi:'hawaii',id:'idaho',il:'illinois',in:'indiana',ia:'iowa',ks:'kansas',ky:'kentucky',la:'louisiana',me:'maine',md:'maryland',ma:'massachusetts',mi:'michigan',mn:'minnesota',ms:'mississippi',mo:'missouri',mt:'montana',ne:'nebraska',nv:'nevada',nh:'new hampshire',nj:'new jersey',nm:'new mexico',ny:'new york',nc:'north carolina',nd:'north dakota',oh:'ohio',ok:'oklahoma',or:'oregon',pa:'pennsylvania',ri:'rhode island',sc:'south carolina',sd:'south dakota',tn:'tennessee',tx:'texas',ut:'utah',vt:'vermont',va:'virginia',wa:'washington',wv:'west virginia',wi:'wisconsin',wy:'wyoming',dc:'district of columbia' };
function stateToFull(abbrev) { return STATE_ABBREVS[(abbrev||'').toLowerCase().trim()] || abbrev; }

class SerpApiProvider {
  constructor(config) {
    this.config = config || {};
    this._locationCache = new Map();
  }

  get name() {
    return 'serpapi';
  }

  async canonicalizeLocation(location) {
    if (!location || location === 'United States') return location;
    const cacheKey = normalizeText(location).toLowerCase();
    if (this._locationCache.has(cacheKey)) return this._locationCache.get(cacheKey);
    try {
      // Extract just the city part for the lookup (SerpAPI matches on city name)
      const cleaned = location.replace(/,\s*United States$/i, '').trim();
      const cityPart = cleaned.split(',')[0].trim();
      const endpoint = new URL('https://serpapi.com/locations.json');
      endpoint.searchParams.set('q', cityPart);
      endpoint.searchParams.set('limit', '3');
      const res = await fetch(endpoint.toString());
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          // Try to match state if provided
          const statePart = (cleaned.split(',')[1] || '').trim().toLowerCase();
          const match = data.find(d => {
            const cn = (d.canonical_name || '').toLowerCase();
            return statePart ? cn.includes(cityPart.toLowerCase()) && (cn.includes(statePart) || cn.includes(stateToFull(statePart))) : true;
          }) || data[0];
          if (match && match.canonical_name) {
            this._locationCache.set(cacheKey, match.canonical_name);
            return match.canonical_name;
          }
        }
      }
    } catch { /* fall through */ }
    this._locationCache.set(cacheKey, location);
    return location;
  }

  async getSearchResults(query, location, options = {}) {
    const apiKey = this.config.apiKey || process.env.SERP_API_KEY;
    if (!apiKey) {
      throw new Error('SERP_API_KEY is required for SerpApi provider.');
    }
    const canonicalLocation = await this.canonicalizeLocation(location);
    const endpoint = new URL(this.config.endpoint || 'https://serpapi.com/search.json');
    endpoint.searchParams.set('engine', 'google');
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('location', canonicalLocation || 'United States');
    endpoint.searchParams.set('hl', this.config.hl || 'en');
    endpoint.searchParams.set('gl', this.config.gl || 'us');
    endpoint.searchParams.set('num', String(options.num || 10));
    endpoint.searchParams.set('api_key', apiKey);
    if (options.uule) {
      endpoint.searchParams.set('uule', options.uule);
    }

    const response = await withTimeout(
      (signal) => fetch(endpoint.toString(), { signal }),
      options.timeoutMs || this.config.timeoutMs || DEFAULT_TIMEOUT_MS
    );
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`SerpApi request failed with status ${response.status}: ${body.slice(0, 200)}`);
    }
    return response.json();
  }

  async getSerpScreenshot(query, location, options = {}) {
    const raw = options.rawResult || {};
    const screenshotUrl = normalizeText(
      raw?.search_metadata?.raw_html_file
      || raw?.search_metadata?.json_endpoint
      || raw?.search_metadata?.google_url
      || ''
    );
    return {
      screenshotUrl: screenshotUrl || '',
      screenshotPath: '',
      source: screenshotUrl ? 'remote' : 'none'
    };
  }

  normalizeResults(rawResponse, context = {}) {
    const organicResults = mapOrganicResults(rawResponse?.organic_results, Number(context.maxOrganic) || 10);
    const localPackCandidates = rawResponse?.local_results?.places
      || rawResponse?.local_results
      || rawResponse?.local_pack?.places
      || rawResponse?.local_pack
      || [];
    const localPackResults = mapLocalPackResults(localPackCandidates, Number(context.maxLocalPack) || 10);
    return {
      query: normalizeText(context.query || rawResponse?.search_parameters?.q),
      location: normalizeText(context.location || rawResponse?.search_parameters?.location),
      timestamp: normalizeText(rawResponse?.search_metadata?.created_at) || new Date().toISOString(),
      organicResults,
      localPackResults,
      screenshotUrl: normalizeText(rawResponse?.search_metadata?.raw_html_file || ''),
      screenshotPath: '',
      providerRaw: rawResponse || {}
    };
  }
}

class DataForSeoProvider {
  constructor(config) {
    this.config = config || {};
  }

  get name() {
    return 'dataforseo';
  }

  authHeader() {
    const login = this.config.login || process.env.SERP_API_LOGIN || '';
    const key = this.config.apiKey || process.env.SERP_API_KEY || '';
    if (!login || !key) {
      throw new Error('SERP_API_LOGIN and SERP_API_KEY are required for DataForSEO provider.');
    }
    return `Basic ${Buffer.from(`${login}:${key}`).toString('base64')}`;
  }

  async getSearchResults(query, location, options = {}) {
    const endpoint = this.config.endpoint || 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';
    const payload = [{
      keyword: query,
      location_name: location || 'United States',
      language_name: 'English',
      device: options.device || 'desktop',
      os: options.os || 'windows',
      depth: Number(options.num || 10)
    }];

    const response = await withTimeout(
      (signal) => fetch(endpoint, {
        method: 'POST',
        signal,
        headers: {
          Authorization: this.authHeader(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }),
      options.timeoutMs || this.config.timeoutMs || DEFAULT_TIMEOUT_MS
    );

    if (!response.ok) {
      throw new Error(`DataForSEO request failed with status ${response.status}`);
    }
    return response.json();
  }

  async getSerpScreenshot(query, location, options = {}) {
    const raw = options.rawResult || {};
    const firstTask = raw?.tasks?.[0];
    const firstResult = firstTask?.result?.[0];
    const screenshotUrl = normalizeText(firstResult?.check_url || firstTask?.status_message || '');
    return {
      screenshotUrl: screenshotUrl || '',
      screenshotPath: '',
      source: screenshotUrl ? 'remote' : 'none'
    };
  }

  normalizeResults(rawResponse, context = {}) {
    const firstTask = rawResponse?.tasks?.[0] || {};
    const firstResult = firstTask?.result?.[0] || {};
    const items = Array.isArray(firstResult?.items) ? firstResult.items : [];
    const organicItems = items.filter((item) => item?.type === 'organic' || item?.rank_group);
    const localPackItems = items.filter((item) => String(item?.type || '').includes('local'));
    const organicResults = organicItems.slice(0, Number(context.maxOrganic) || 10).map((item, index) => {
      const url = safeUrl(item.url || item.domain || '');
      return {
        position: Number(item.rank_group) || Number(item.rank_absolute) || (index + 1),
        title: normalizeText(item.title || item.title_raw || ''),
        domain: extractRootDomain(item.domain || url),
        url
      };
    });
    const localPackResults = localPackItems.slice(0, Number(context.maxLocalPack) || 10).map((item, index) => {
      const url = safeUrl(item.url || item.domain || '');
      return {
        position: Number(item.rank_group) || Number(item.rank_absolute) || (index + 1),
        title: normalizeText(item.title || item.title_raw || item.name || ''),
        domain: extractRootDomain(item.domain || url),
        url,
        rating: Number.isFinite(Number(item.rating?.value || item.rating)) ? Number(item.rating?.value || item.rating) : null,
        reviews: Number.isFinite(Number(item.rating?.votes_count || item.reviews_count)) ? Number(item.rating?.votes_count || item.reviews_count) : null
      };
    });
    return {
      query: normalizeText(context.query || firstResult?.keyword),
      location: normalizeText(context.location || firstResult?.location_name),
      timestamp: normalizeText(firstResult?.datetime || firstTask?.time) || new Date().toISOString(),
      organicResults,
      localPackResults,
      screenshotUrl: normalizeText(firstResult?.check_url || ''),
      screenshotPath: '',
      providerRaw: rawResponse || {}
    };
  }
}

class GoogleHtmlProvider {
  constructor(config) {
    this.config = config || {};
  }

  get name() {
    return 'google_html';
  }

  async getSearchResults(query, location, options = {}) {
    const pages = Math.max(1, Math.min(3, Math.ceil((Number(options.num) || 10) / 10)));
    const organicResults = [];

    for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
      const start = pageIndex * 10;
      const endpoint = new URL('https://www.google.com/search');
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('num', '10');
      endpoint.searchParams.set('start', String(start));

      const response = await withTimeout(
        (signal) => fetch(endpoint.toString(), {
          signal,
          headers: {
            'User-Agent': 'Mozilla/5.0'
          }
        }),
        options.timeoutMs || this.config.timeoutMs || DEFAULT_TIMEOUT_MS
      );

      if (!response.ok) {
        throw new Error(`Google HTML request failed with status ${response.status}`);
      }

      const html = await response.text();
      const pageResults = parseGoogleSearchHtml(html, start);
      organicResults.push(...pageResults);
      if (pageResults.length < 3) {
        break;
      }
    }

    return {
      query,
      location,
      created_at: new Date().toISOString(),
      organic_results: organicResults
    };
  }

  async getSerpScreenshot() {
    return {
      screenshotUrl: '',
      screenshotPath: '',
      source: 'none'
    };
  }

  normalizeResults(rawResponse, context = {}) {
    const organicResults = mapOrganicResults(rawResponse?.organic_results, Number(context.maxOrganic) || 10);
    return {
      query: normalizeText(context.query || rawResponse?.query),
      location: normalizeText(context.location || rawResponse?.location),
      timestamp: normalizeText(rawResponse?.created_at) || new Date().toISOString(),
      organicResults,
      localPackResults: [],
      screenshotUrl: '',
      screenshotPath: '',
      providerRaw: rawResponse || {}
    };
  }
}

function createSerpProvider(config = {}) {
  const configuredName = normalizeText(config.provider || process.env.SERP_PROVIDER || 'serpapi').toLowerCase();
  if (configuredName === 'dataforseo') {
    if (!hasDataForSeoCredentials(config)) {
      return new GoogleHtmlProvider(config);
    }
    return new DataForSeoProvider(config);
  }
  if (!hasSerpApiCredentials(config)) {
    return new GoogleHtmlProvider(config);
  }
  return new SerpApiProvider(config);
}

module.exports = {
  createSerpProvider,
  normalizeDomain,
  extractRootDomain
};
