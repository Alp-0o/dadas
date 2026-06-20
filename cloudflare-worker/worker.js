const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://alp-0o.github.io",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function groqFetch(env, prompt, maxTokens = 80) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Groq hatası: ${res.status} — ${JSON.stringify(data)}`);
  if (!data.choices?.[0]?.message?.content) throw new Error(`Groq boş yanıt: ${JSON.stringify(data)}`);
  return data.choices[0].message.content.trim();
}

async function kvGet(env, key) {
  return env.RASAD_CACHE ? await env.RASAD_CACHE.get(key) : null;
}

async function kvPut(env, key, value) {
  if (env.RASAD_CACHE) await env.RASAD_CACHE.put(key, value, { expirationTtl: 86400 });
}

// --- MEVCUT ENDPOINTler ---

async function handleMetals(env) {
  const res = await fetch(`https://api.metals.dev/v1/latest?api_key=${env.METALS_API_KEY}&currency=USD&unit=toz`);
  if (!res.ok) return jsonResponse({ error: `Metals.dev hatası: ${res.status}` }, res.status);
  return jsonResponse(await res.json());
}

async function handleMetalsComment(env) {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `metals-comment-${today}`;
  const cached = await kvGet(env, cacheKey);
  if (cached) return jsonResponse({ comment: cached, cached: true });

  const res = await fetch(`https://api.metals.dev/v1/latest?api_key=${env.METALS_API_KEY}&currency=USD&unit=toz`);
  if (!res.ok) return jsonResponse({ error: `Metals.dev hatası: ${res.status}` }, res.status);
  const data = await res.json();

  const prompt = `Altın fiyatı $${data.metals.gold.toFixed(2)}/ons, gümüş fiyatı $${data.metals.silver.toFixed(2)}/ons. Bu fiyatlar küresel piyasalar açısından ne anlama geliyor? Türkçe, 1-2 cümle, sade bir dille açıkla.`;
  const comment = await groqFetch(env, prompt, 80);
  await kvPut(env, cacheKey, comment);
  return jsonResponse({ comment, cached: false });
}

async function handleNews(request, env) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "Russia Ukraine OR Iran Israel";
  const max = url.searchParams.get("max") || "3";
  const lang = url.searchParams.get("lang") || "en";
  const res = await fetch(`https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=${lang}&max=${max}&apikey=${env.GNEWS_API_KEY}`);
  if (!res.ok) return jsonResponse({ error: `GNews hatası: ${res.status}` }, res.status);
  return jsonResponse(await res.json());
}

async function handleNewsComment(env) {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `news-comment-${today}`;
  const cached = await kvGet(env, cacheKey);
  if (cached) return jsonResponse({ comment: cached, cached: true });

  const res = await fetch(`https://gnews.io/api/v4/search?q=Russia Ukraine OR Iran Israel&lang=en&max=3&apikey=${env.GNEWS_API_KEY}`);
  if (!res.ok) return jsonResponse({ error: `GNews hatası: ${res.status}` }, res.status);
  const data = await res.json();

  const headlines = data.articles.map((a) => a.title).join(" | ");
  const prompt = `Bu haber başlıklarını analiz et: "${headlines}". Jeopolitik açıdan ne anlama geliyor? Türkçe, 1-2 cümle, sade bir dille açıkla.`;
  const comment = await groqFetch(env, prompt, 80);
  await kvPut(env, cacheKey, comment);
  return jsonResponse({ comment, cached: false });
}

// --- YENİ: RUSYA-UKRAYNA DOSYA İÇERİĞİ ---

async function handleRusyaUkraynaContent(env) {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `rusya-ukrayna-content-${today}`;

  const cached = await kvGet(env, cacheKey);
  if (cached) return jsonResponse({ ...JSON.parse(cached), cached: true });

  // GNews'ten 10 haber çek
  const res = await fetch(`https://gnews.io/api/v4/search?q=Russia Ukraine war&lang=en&max=10&apikey=${env.GNEWS_API_KEY}`);
  if (!res.ok) return jsonResponse({ error: `GNews hatası: ${res.status}` }, res.status);
  const newsData = await res.json();

  const newsText = newsData.articles
    .map((a, i) => `${i + 1}. ${a.title} — ${a.description || ""}`)
    .join("\n");

  const prompt = `Aşağıdaki Rusya-Ukrayna savaşına ait haber başlıkları ve açıklamalarını analiz et. Yalnızca aşağıdaki JSON formatında Türkçe içerik üret. JSON dışında hiçbir şey yazma, açıklama ekleme.

Haberler:
${newsText}

Döndür (yalnızca geçerli JSON):
{
  "ozet": "Savaşın güncel durumunu özetleyen 2-3 cümle.",
  "son_durum": "Son gelişmeleri aktaran 2-3 cümle.",
  "kronoloji": [
    {"tarih": "Ay Yıl", "olay": "Kısa olay açıklaması"},
    {"tarih": "Ay Yıl", "olay": "Kısa olay açıklaması"},
    {"tarih": "Ay Yıl", "olay": "Kısa olay açıklaması"}
  ],
  "etkilenenler": [
    {"baslik": "Etkilenen taraf adı", "aciklama": "Nasıl etkilendiği, 1-2 cümle."},
    {"baslik": "Etkilenen taraf adı", "aciklama": "Nasıl etkilendiği, 1-2 cümle."}
  ],
  "senaryolar": [
    {"olasilik": "yüksek", "aciklama": "Senaryo açıklaması.", "veri": "Bu senaryoyu destekleyen göstergeler."},
    {"olasilik": "orta", "aciklama": "Senaryo açıklaması.", "veri": "Bu senaryoyu destekleyen göstergeler."},
    {"olasilik": "düşük", "aciklama": "Senaryo açıklaması.", "veri": "Bu senaryoyu destekleyen göstergeler."}
  ]
}`;

  const raw = await groqFetch(env, prompt, 1000);

  let content;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("JSON bulunamadı");
    content = JSON.parse(jsonMatch[0]);
  } catch (e) {
    return jsonResponse({ error: "JSON parse hatası", raw }, 500);
  }

  await kvPut(env, cacheKey, JSON.stringify(content));
  return jsonResponse({ ...content, cached: false });
}

// --- ROUTER ---

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const path = new URL(request.url).pathname;

    try {
      if (path === "/news") return await handleNews(request, env);
      if (path === "/metals") return await handleMetals(env);
      if (path === "/metals-comment") return await handleMetalsComment(env);
      if (path === "/news-comment") return await handleNewsComment(env);
      if (path === "/rusya-ukrayna-content") return await handleRusyaUkraynaContent(env);
      return jsonResponse({ error: "Geçersiz endpoint." }, 404);
    } catch (err) {
      return jsonResponse({ error: "Worker iç hatası", detail: err.message }, 500);
    }
  },
};
