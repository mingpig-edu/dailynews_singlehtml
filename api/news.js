// V0.3.1 - Vercel relay for GDELT DOC 2.0
// Put this file at: /api/news.js
// The browser calls /api/news?topic=...&timespan=1d
// No Gemini API key is sent to this function.

const GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const ALLOWED_TIMESPANS = new Set(["1d", "3d", "7d"]);
const MAX_TOPIC_LENGTH = 180;

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

function normalizeArticle(article) {
  const url = article?.url || article?.link || article?.uri || "";
  let domain = article?.domain || article?.source || "";

  if (!domain && url) {
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {}
  }

  return {
    title: cleanText(article?.title || article?.name || ""),
    url,
    domain: cleanText(domain) || "來源不明",
    seen_date: article?.seendate || article?.date || article?.datetime || "",
    language: article?.language || "",
    sourcecountry: article?.sourcecountry || article?.country || "",
    image: article?.socialimage || article?.image || "",
  };
}

async function handle(request) {
  if (request.method !== "GET") {
    return json(
      { error: "Method not allowed" },
      405,
      { allow: "GET" }
    );
  }

  const incoming = new URL(request.url);
  const topic = sanitizeTopic(incoming.searchParams.get("topic") || "");
  const requestedTimespan = incoming.searchParams.get("timespan") || "1d";
  const timespan = ALLOWED_TIMESPANS.has(requestedTimespan)
    ? requestedTimespan
    : "1d";

  if (!topic) {
    return json({ error: "缺少 topic 參數。" }, 400);
  }

  const upstream = new URL(GDELT_URL);
  upstream.searchParams.set("query", topic);
  upstream.searchParams.set("mode", "artlist");
  upstream.searchParams.set("maxrecords", "75");
  upstream.searchParams.set("timespan", timespan);
  upstream.searchParams.set("sort", "datedesc");
  upstream.searchParams.set("format", "json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);

  try {
    const response = await fetch(upstream, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "DailyTopicBrief/0.3.1 (+Vercel relay)",
      },
    });

    const text = await response.text();

    if (!response.ok) {
      return json(
        {
          error: `GDELT HTTP ${response.status}`,
          detail: text.slice(0, 800),
        },
        502
      );
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return json(
        {
          error: "GDELT 回傳了無法解析的資料。",
          detail: text.slice(0, 800),
        },
        502
      );
    }

    const raw = Array.isArray(data?.articles)
      ? data.articles
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.results)
          ? data.results
          : [];

    const seen = new Set();
    const articles = [];

    for (const item of raw) {
      const article = normalizeArticle(item);
      if (!article.title || !/^https?:\/\//i.test(article.url)) continue;

      const key = article.url.replace(/#.*$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      articles.push(article);
    }

    return json({
      ok: true,
      topic,
      timespan,
      count: articles.length,
      articles,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return json({ error: "GDELT 連線逾時，請稍後再試。" }, 504);
    }

    return json(
      {
        error: "新聞來源中繼服務失敗。",
        detail: String(error?.message || error).slice(0, 800),
      },
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  fetch: handle,
};
