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

async function groqFetch(env, prompt, maxTokens = 80, big = false) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: big ? "llama-3.3-70b-versatile" : "llama-3.1-8b-instant",
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

  // Gürültü filtresi
  const NOISE = ["world cup", "visa", "pizza", "ethanol", "biodiesel", "lng", "etanol", "celebrity", "fashion"];
  const filtered = newsData.articles.filter(a => !NOISE.some(k => a.title.toLowerCase().includes(k)));

  // Kaynak etiketleme
  const RUSSIA_STATE = ["sputnik", "rt.com", "tass.ru", "ria.ru", "life.ru", "5-tv.ru", "runews24", "anna-news"];
  const UKRAINE_SRC = ["unian.net", "obozrevatel.com", "glavred.info", "korrespondent.net", "24tv.ua", "delo.ua", "pravda.com.ua"];
  const WESTERN = ["bbc.com", "reuters.com", "theguardian.com", "nytimes.com", "washingtonpost.com", "inquirer.com", "nationalpost.com", "lbc.co.uk", "dw.com", "ft.com", "politico.com"];

  function getDomain(url) {
    try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
  }

  function tagSource(domain) {
    const s = (domain || "").toLowerCase();
    if (RUSSIA_STATE.some(x => s.includes(x))) return "rusya devlet medyası";
    if (UKRAINE_SRC.some(x => s.includes(x))) return "ukrayna kaynağı";
    if (WESTERN.some(x => s.includes(x))) return "batı medyası";
    return "diğer";
  }

  function formatDate(iso) {
    if (!iso) return "tarih bilinmiyor";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
    } catch { return iso; }
  }

  const newsText = filtered
    .map((a, i) => {
      const domain = getDomain(a.url);
      const tag = tagSource(domain);
      const date = formatDate(a.publishedAt);
      return `[${i + 1}] tarih:${date} | kaynak:${domain} | tip:${tag}\nbaşlık: ${a.title}\nözet: ${a.description || "-"}`;
    })
    .join("\n\n");

  const prompt = `Sen bir jeopolitik analistsin. Aşağıdaki ${filtered.length} haber maddesi sana verilmiştir. Bu haberleri analiz ederek Türkçe istihbarat dosyası üret.

KRİTİK KURALLAR — Bu kurallara uymak zorunludur:
- SADECE yukarıda sana verilen haberlerde açıkça geçen bilgileri kullan.
- Kaynağını ham veriden gösteremediğin HİÇBİR iddiayı yazma. Placeholder, örnek veya hayali kaynak ASLA üretme.
- Tarihleri yalnızca haberlerin "tarih:" alanından al. Tahmin etme, uydurmayacaksın.
- "rusya devlet medyası" tipindeki kaynakları mutlaka "([domain] iddiasına göre, doğrulanmamış)" şeklinde işaretle.
- Birden fazla bağımsız kaynak aynı olayı doğruluyorsa "çok kaynaklı doğrulama" olarak belirt.
- Bilgi yoksa o alanı boş bırak veya "ham veride yeterli bilgi yok" yaz.

ALAN ETİKETİ: Her gelişmeye [askeri] [ekonomik] [siyasi] [siber] etiketlerinden birini ekle.

Haberler:
${newsText}

Yalnızca aşağıdaki geçerli JSON formatını döndür. JSON dışında hiçbir şey yazma.

{
  "ozet": "3-4 cümle. Savaşın güncel bağlamı, öne çıkan alan (askeri/siyasi/ekonomik) ve kaynak güvenilirliğine dair kısa not.",
  "son_durum": "2-3 cümle. Güncel cephe durumu ve somut gelişmeler. Doğrulanmamışları 'iddia' olarak işaretle.",
  "kronoloji": [
    {"tarih": "haberin tarih: alanından al, tahmin etme", "kaynak": "domain adı", "olay": "[alan etiketi] Olay açıklaması. Devlet medyasıysa (iddia) ekle."},
    {"tarih": "...", "kaynak": "...", "olay": "..."},
    {"tarih": "...", "kaynak": "...", "olay": "..."}
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
    {"baslik": "Avrupa Enerji Piyasaları", "aciklama": "2 cümle. Somut etkiler."},
    {"baslik": "Küresel Tahıl Piyasaları", "aciklama": "2 cümle."},
    {"baslik": "Ukrayna Sivil Halkı", "aciklama": "2 cümle."},
    {"baslik": "NATO ve Batı Savunma Sektörü", "aciklama": "2 cümle."},
    {"baslik": "Rusya Ekonomisi", "aciklama": "2 cümle."}
  ],
  "senaryolar": [
    {"olasilik": "yüksek", "aciklama": "2-3 cümle. Senaryo ve destekleyen göstergeler.", "veri": "Dayandığı somut göstergeler."},
    {"olasilik": "orta", "aciklama": "2-3 cümle. Senaryo ve koşullar.", "veri": "Dayandığı göstergeler."},
    {"olasilik": "düşük", "aciklama": "2-3 cümle. Senaryo ve gerçekleşme koşulları.", "veri": "Dayandığı göstergeler."}
  ]
}`;

  const raw = await groqFetch(env, prompt, 2500, true);

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
