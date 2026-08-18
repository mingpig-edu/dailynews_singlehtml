// Daily Topic Brief BYOK V0.3.2
// Vercel server-side news relay with automatic provider fallback.
// Fallback order: GDELT -> Google News RSS -> Bing News RSS.
// No Gemini API key is sent to this function.

const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GOOGLE_NEWS_URL = "https://news.google.com/rss/search";
const BING_NEWS_URL = "https://www.bing.com/news/search";

const ALLOWED_TIMESPANS = new Set(["1d", "3d", "7d"]);
const MAX_TOPIC_LENGTH = 180;
const TARGET_ARTICLES = 40;
const UPSTREAM_TIMEOUT_MS = 14000;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function cleanText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sanitizeTopic(topic) {
  return cleanText(topic)
    .normalize("NFKC")
    .replace(/[()"<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TOPIC_LENGTH);
}

function decodeEntities(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

function stripTags(value = "") {
  return cleanText(decodeEntities(String(value).replace(/<[^>]*>/g, " ")));
}

function tagValue(xml, tag) {
  const m = String(xml).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? stripTags(m[1]) : "";
}

function sourceValue(xml) {
  const m = String(xml).match(/<source(?:\s[^>]*)?>([\s\S]*?)<\/source>/i);
  return m ? stripTags(m[1]) : "";
}

function normalizeUrl(value = "") {
  const url = decodeEntities(cleanText(value));
  return /^https?:\/\//i.test(url) ? url : "";
}

function domainFromUrl(value = "") {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function dateToIso(value = "") {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : cleanText(value);
}

function cutoffMs(timespan) {
  const days = timespan === "7d" ? 7 : timespan === "3d" ? 3 : 1;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function isRecent(dateValue, timespan) {
  if (!dateValue) return true;
  const ms = new Date(dateValue).getTime();
  if (!Number.isFinite(ms)) return true;
  return ms >= cutoffMs(timespan) - 3 * 60 * 60 * 1000;
}

function dedupeArticles(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.title || !item?.url) continue;
    const urlKey = item.url.replace(/#.*$/, "");
    const titleKey = `${item.title.toLowerCase()}|${String(item.domain || "").toLowerCase()}`;
    if (seen.has(urlKey) || seen.has(titleKey)) continue;
    seen.add(urlKey);
    seen.add(titleKey);
    out.push(item);
  }
  return out;
}

async function fetchText(url, accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept,
        "user-agent": "DailyTopicBrief/0.3.2 (+Vercel news relay)",
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 250)}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGdelt(topic, timespan) {
  const url = new URL(GDELT_URL);
  url.searchParams.set("query", topic);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("maxrecords", "75");
  url.searchParams.set("timespan", timespan);
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("format", "json");

  const text = await fetchText(url, "application/json");
  const data = JSON.parse(text);

  const raw = Array.isArray(data?.articles)
    ? data.articles
    : Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data?.results)
        ? data.results
        : [];

  return raw.map(article => {
    const url = normalizeUrl(article?.url || article?.link || article?.uri || "");
    const domain = cleanText(article?.domain || article?.source || "") || domainFromUrl(url);
    return {
      title: cleanText(article?.title || article?.name || ""),
      url,
      domain: domain || "來源不明",
      seen_date: article?.seendate || article?.date || article?.datetime || "",
      language: article?.language || "",
      sourcecountry: article?.sourcecountry || article?.country || "",
      image: article?.socialimage || article?.image || "",
      provider: "GDELT",
    };
  }).filter(x => x.title && x.url);
}

function parseRss(xml, provider, timespan) {
  const blocks = String(xml).match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const out = [];

  for (const block of blocks) {
    const title = tagValue(block, "title");
    const link = normalizeUrl(tagValue(block, "link"));
    const pubDate = tagValue(block, "pubDate") || tagValue(block, "date");
    const source = sourceValue(block);

    if (!title || !link || !isRecent(pubDate, timespan)) continue;

    out.push({
      title,
      url: link,
      domain: source || domainFromUrl(link) || provider,
      seen_date: dateToIso(pubDate),
      language: "",
      sourcecountry: "",
      image: "",
      provider,
    });
  }

  return out;
}

async function fetchGoogleNews(topic, timespan) {
  const days = timespan === "7d" ? "7d" : timespan === "3d" ? "3d" : "1d";
  const url = new URL(GOOGLE_NEWS_URL);
  url.searchParams.set("q", `${topic} when:${days}`);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const xml = await fetchText(url, "application/rss+xml, application/xml, text/xml");
  return parseRss(xml, "Google News", timespan);
}

async function fetchBingNews(topic, timespan) {
  const url = new URL(BING_NEWS_URL);
  url.searchParams.set("q", topic);
  url.searchParams.set("format", "RSS");

  const xml = await fetchText(url, "application/rss+xml, application/xml, text/xml");
  return parseRss(xml, "Bing News", timespan);
}

async function tryProvider(name, fn, attempts) {
  try {
    const articles = dedupeArticles(await fn());
    attempts.push({ provider: name, ok: true, count: articles.length });
    return articles;
  } catch (error) {
    attempts.push({
      provider: name,
      ok: false,
      error: error?.name === "AbortError"
        ? "連線逾時"
        : cleanText(error?.message || String(error)).slice(0, 240),
    });
    return [];
  }
}

async function handle(request) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405, { allow: "GET" });
  }

  const incoming = new URL(request.url);
  const topic = sanitizeTopic(incoming.searchParams.get("topic") || "");
  const requestedTimespan = incoming.searchParams.get("timespan") || "1d";
  const timespan = ALLOWED_TIMESPANS.has(requestedTimespan) ? requestedTimespan : "1d";

  if (!topic) {
    return json({ error: "缺少 topic 參數。" }, 400);
  }

  const attempts = [];
  let articles = [];

  articles = dedupeArticles([
    ...articles,
    ...await tryProvider("GDELT", () => fetchGdelt(topic, timespan), attempts),
  ]);

  if (articles.length < TARGET_ARTICLES) {
    articles = dedupeArticles([
      ...articles,
      ...await tryProvider("Google News", () => fetchGoogleNews(topic, timespan), attempts),
    ]);
  }

  if (articles.length < TARGET_ARTICLES) {
    articles = dedupeArticles([
      ...articles,
      ...await tryProvider("Bing News", () => fetchBingNews(topic, timespan), attempts),
    ]);
  }

  articles.sort((a, b) => {
    const ta = new Date(a.seen_date || 0).getTime();
    const tb = new Date(b.seen_date || 0).getTime();
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });

  if (!articles.length) {
    return json({
      error: "所有新聞來源都暫時無法取得可用新聞。",
      topic,
      timespan,
      attempts,
    }, 502);
  }

  return json({
    ok: true,
    topic,
    timespan,
    count: articles.length,
    providers_used: attempts.filter(x => x.ok && x.count > 0).map(x => x.provider),
    attempts,
    articles: articles.slice(0, 75),
  });
}

export default { fetch: handle };
