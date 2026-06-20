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

  const prompt = `Sen bir jeopolitik analistsin. Aşağıdaki haberleri analiz ederek Türkçe istihbarat dosyası üret.

Analiz kuralları:
1. KAYNAK: Her bilgi için "kim neden paylaştı?" diye sor. Resmi açıklama mı, sızıntı mı, propaganda mı? Belirsizse belirt.
2. ALAN: Her gelişmenin alanını kısaca belirt: [askeri] [ekonomik] [siyasi] [siber] gibi.
3. KANIT: Somut ve doğrulanabilir kanıtı olmayan iddiaları "söylem" veya "iddia" olarak işaretle — kesin gerçekmiş gibi sunma.

Haberler:
${newsText}

Yalnızca aşağıdaki geçerli JSON formatını döndür. JSON dışında hiçbir şey yazma.

{
  "ozet": "En az 150 kelime. Savaşın genel bağlamını, mevcut dinamikleri ve kritik gelişmeleri açıkla. Hangi alanda (askeri/siyasi/ekonomik) öne çıkan gelişmeler var? Kaynakların güvenilirliğine dair genel bir not ekle.",
  "son_durum": "En az 100 kelime. Güncel cephe durumu, son haftalarda yaşanan somut gelişmeler. Doğrulanmamış iddiaları 'iddia' olarak işaretle.",
  "kronoloji": [
    {"tarih": "Ay Yıl", "olay": "Alan etiketi ve olay açıklaması. Kaynak belirsizse 'iddia' ekle."},
    {"tarih": "Ay Yıl", "olay": "..."},
    {"tarih": "Ay Yıl", "olay": "..."},
    {"tarih": "Ay Yıl", "olay": "..."},
    {"tarih": "Ay Yıl", "olay": "..."}
  ],
  "rusya_taraf": [
    {"ulke": "Ülke adı", "destek": "Destek türü", "detay": "Bu desteğin niteliği, kaynağı ve doğrulanabilirliği hakkında 2-3 cümle."},
    {"ulke": "Ülke adı", "destek": "Destek türü", "detay": "..."},
    {"ulke": "Ülke adı", "destek": "Destek türü", "detay": "..."}
  ],
  "ukrayna_taraf": [
    {"ulke": "Ülke adı", "destek": "Destek türü", "detay": "Bu desteğin niteliği, kaynağı ve doğrulanabilirliği hakkında 2-3 cümle."},
    {"ulke": "Ülke adı", "destek": "Destek türü", "detay": "..."},
    {"ulke": "Ülke adı", "destek": "Destek türü", "detay": "..."}
  ],
  "etkilenenler": [
    {"baslik": "Avrupa Enerji Piyasaları", "aciklama": "En az 3 cümle. Somut etkiler, doğrulanmış veriler önce, iddialar sonra."},
    {"baslik": "Küresel Tahıl Piyasaları", "aciklama": "En az 3 cümle."},
    {"baslik": "Ukrayna Sivil Halkı", "aciklama": "En az 3 cümle."},
    {"baslik": "NATO ve Batı Savunma Sektörü", "aciklama": "En az 3 cümle."},
    {"baslik": "Rusya Ekonomisi", "aciklama": "En az 3 cümle."}
  ],
  "senaryolar": [
    {"olasilik": "yüksek", "aciklama": "En az 80 kelime. Senaryo neden olası? Hangi somut göstergeler bunu destekliyor?", "veri": "Dayandığı doğrulanabilir göstergeler."},
    {"olasilik": "orta", "aciklama": "En az 80 kelime. Senaryo neden mümkün ama belirsiz?", "veri": "Dayandığı göstergeler."},
    {"olasilik": "düşük", "aciklama": "En az 80 kelime. Neden düşük olasılıklı? Hangi şartlarda gerçekleşebilir?", "veri": "Dayandığı göstergeler."}
  ]
}`;

  const raw = await groqFetch(env, prompt, 2000);

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
