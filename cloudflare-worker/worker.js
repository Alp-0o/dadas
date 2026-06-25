// Graf verisi — tek kaynak gerçeklik: data/dossiers/rusya-ukrayna/ JSON dosyaları
import RU_ENTITIES from '../data/dossiers/rusya-ukrayna/entities.json';
import RU_EDGES from '../data/dossiers/rusya-ukrayna/edges.json';

// --- KAYNAK ETİKETLEME (paylaşılan) ---
const SRC_RUSSIA_STATE = [
  "sputnik", "rt.com", "tass.ru", "ria.ru", "life.ru",
  "5-tv.ru", "runews24", "anna-news", "gazeta.ru", "kremlin.ru",
  "rg.ru", "vesti.ru", "lenta.ru",
];
const SRC_UKRAINE = [
  "unian.net", "obozrevatel.com", "glavred.info", "korrespondent.net",
  "24tv.ua", "delo.ua", "pravda.com.ua", "ukrainska.pravda.com.ua",
  "war.obozrevatel.com", "kontrakty.ua",
];
const SRC_WESTERN = [
  // ABD
  "apnews.com", "reuters.com", "nytimes.com", "washingtonpost.com",
  "wsj.com", "bloomberg.com", "axios.com", "thehill.com", "politico.com",
  "foreignpolicy.com", "forbes.com", "cbsnews.com", "nbcnews.com",
  "cnn.com", "npr.org", "vox.com", "businessinsider.com",
  "ajc.com", "inquirer.com", "nationalpost.com",
  // İngiltere
  "bbc.com", "bbc.co.uk", "theguardian.com", "ft.com", "economist.com",
  "independent.co.uk", "telegraph.co.uk", "mirror.co.uk", "lbc.co.uk",
  "thetimes.co.uk", "dailymail.co.uk",
  // Avrupa
  "dw.com", "france24.com", "rfi.fr", "euronews.com",
  "rferl.org", "lemonde.fr", "spiegel.de",
  // Diğer Batı
  "abc.net.au", "cbc.ca", "globeandmail.com",
];

function getDomain(url) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
}

function tagSource(domain) {
  const s = (domain || "").toLowerCase();
  if (SRC_RUSSIA_STATE.some(x => s.includes(x))) return "rusya devlet medyası";
  if (SRC_UKRAINE.some(x => s.includes(x)))       return "ukrayna kaynağı";
  if (SRC_WESTERN.some(x => s.includes(x)))        return "batı medyası";
  return "diğer";
}

// Kapalı ilişki sözlüğü — LLM sadece bu type değerlerini kullanabilir
const RELATION_TYPES = [
  "commands", "supports", "opposes", "attacks", "defends",
  "controls", "located_in", "affects", "sanctions",
  "negotiates", "supplies", "funded_by", "mediates",
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
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

// --- YENİ: GRAFIK TABANLI TARAFLAR + DESTEKÇİLER ---

async function handleRusyaUkraynaTaraflar(env) {
  const entityMap = Object.fromEntries(RU_ENTITIES.map(e => [e.id, e]));

  function modalityLabel(m) {
    const map = { verified: "doğrulanmış", reported: "haberlenmiş", inferred: "çıkarım", claimed: "iddia" };
    return map[m] || m;
  }

  function entityCard(id) {
    const e = entityMap[id];
    if (!e) return null;
    return { id: e.id, canonical_name: e.canonical_name,
      aliases: (e.aliases || []).filter(a => a !== e.canonical_name).slice(0, 4),
      sector_tags: e.sector_tags || [], type: e.type };
  }

  function edgeToDestekci(e, isStatic) {
    const entity = entityMap[e.source_id];
    return {
      ulke: entity?.canonical_name || e.source_id,
      destek: e.attributes?.support_type || e.type,
      detay: e.attributes?.note || e.attributes?.excerpt || "",
      modality: e.modality,
      modality_label: modalityLabel(e.modality),
      valid_from: e.valid_from,
      edge_id: e.id || null,
      is_static: isStatic,
    };
  }

  // Statik destekçiler (RU_EDGES'den)
  const staticRusya   = RU_EDGES.filter(e => e.type === "supports" && e.target_id === "country:russia"  && e.polarity === "support");
  const staticUkrayna = RU_EDGES.filter(e => e.type === "supports" && e.target_id === "country:ukraine" && e.polarity === "support");

  // Dinamik destekçiler (KV cache'den)
  const today = new Date().toISOString().slice(0, 10);
  const cached = await kvGet(env, `destekci-kenarlar-${today}`);
  const dynEdges = cached ? (JSON.parse(cached).extracted_edges || []) : [];

  const dynRusya   = dynEdges.filter(e => (e.type === "supports" || e.type === "supplies" || e.type === "funded_by" || e.type === "defends") && e.target_id === "country:russia");
  const dynUkrayna = dynEdges.filter(e => (e.type === "supports" || e.type === "supplies" || e.type === "funded_by" || e.type === "defends") && e.target_id === "country:ukraine");

  // Karşı çıkanlar (opposes/sanctions russia = ukrayna tarafı, opposes ukraine = rusya tarafı)
  const dynRusyaOpposes   = dynEdges.filter(e => (e.type === "opposes" || e.type === "sanctions") && e.target_id === "country:ukraine");
  const dynUkraynaOpposes = dynEdges.filter(e => (e.type === "opposes" || e.type === "sanctions") && e.target_id === "country:russia");

  return jsonResponse({
    rusya: {
      entity: entityCard("country:russia"),
      destekcilar: [
        ...staticRusya.map(e => edgeToDestekci(e, true)),
        ...dynRusya.map(e => edgeToDestekci(e, false)),
        ...dynRusyaOpposes.map(e => edgeToDestekci(e, false)),
      ],
      has_dynamic: dynRusya.length + dynRusyaOpposes.length > 0,
    },
    ukrayna: {
      entity: entityCard("country:ukraine"),
      destekcilar: [
        ...staticUkrayna.map(e => edgeToDestekci(e, true)),
        ...dynUkrayna.map(e => edgeToDestekci(e, false)),
        ...dynUkraynaOpposes.map(e => edgeToDestekci(e, false)),
      ],
      has_dynamic: dynUkrayna.length + dynUkraynaOpposes.length > 0,
    },
    source: "graph+pipeline",
    schema_version: "1.0",
  });
}

// --- ADIM 3: HABER → KENAR ÇIKARIMI ---

function buildEdgeExtractionPrompt(articles) {
  const entityList = RU_ENTITIES
    .map(e => `- ${e.id}  (${e.canonical_name}, ${e.type})`)
    .join("\n");
  const typeList = RELATION_TYPES.join(", ");
  const newsText = articles
    .map((a, i) => `[${i + 1}] tarih:${a.tarih} | kaynak:${a.kaynak} | tip:${a.kaynak_tipi}\nbaşlık: ${a.baslik}\nözet: ${a.ozet || "-"}`)
    .join("\n\n");

  return `Sen bir jeopolitik ilişki çıkarma motorusun. Sana haber metinleri verilecek. Görevin, bu haberlerden tespit ettiğin varlıklar arası ilişkileri (kenarları) çıkarmak.

KISITLAR — bunlara uymak zorunludur:
1. source_id ve target_id SADECE şu entity listesinden seçilmeli — listede olmayan ID üretemezsin:
${entityList}

2. type SADECE şu değerlerden biri olabilir: ${typeList}

3. modality:
- "verified": birden fazla bağımsız kaynak doğruladı
- "reported": en az bir kaynak haberleştirdi, çapraz doğrulama yok
- "inferred": haber bunu doğrudan söylemiyor ama mantıksal çıkarım yapılabilir
- "claimed": tek taraflı iddia, doğrulanmamış

4. Haberde açıkça desteklenmeyen ilişki üretme.
5. Listede olmayan ama haberde geçen önemli entityleri unresolved_entities dizisine ekle.
6. provenance'ı haber kaynağından doldur — kendi ürettiğin kaynak yazma.
7. polarity: "support", "oppose", "neutral" değerlerinden biri.
8. excerpt: bu ilişkiyi destekleyen haber cümlesinden kısa alıntı.
9. SOMUT EYLEM KURALI: Kenar ancak somut bir eylemi, kararı veya durumu kanıtlıyorsa üretilebilir (saldırı, yardım paketi, yaptırım, anlaşma, kontrol, tedarik vb.). Siyasi söylem, yorum veya retorik alıntılar ("X dedi ki...", "Y'ye göre...", "Z'nin iddiasına göre...") somut eylemin kendisi değildir — bu tür cümlelere dayanan kenar üretme.
10. TEKİL İLİŞKİ KURALI: Aynı source_id + target_id + type kombinasyonunu birden fazla kez üretme.
11. YÖN KURALI: supports / funded_by / supplies / defends gibi yönlü ilişkilerde source_id DESTEKLEYEN, target_id DESTEKLENEN taraftır. Örnek: ABD Ukrayna'yı destekliyorsa source_id=country:usa, target_id=country:ukraine. Bunun tersini asla üretme. opposes / sanctions / attacks ilişkilerinde source_id EYLEMI YAPAN, target_id EYLEMDEN ETKİLENEN taraftır.

HABERLER:
${newsText}

Yalnızca aşağıdaki JSON formatını döndür. JSON dışında HİÇBİR ŞEY yazma.

{
  "extracted_edges": [
    {
      "source_id": "entity:id",
      "target_id": "entity:id",
      "type": "tip",
      "directed": true,
      "polarity": "support|oppose|neutral",
      "modality": "verified|reported|inferred|claimed",
      "valid_from": "YYYY-MM-DD",
      "provenance": [{"domain": "domain.com", "published": "YYYY-MM-DD", "source_type": "batı medyası|ukrayna kaynağı|rusya devlet medyası|diğer"}],
      "attributes": {"excerpt": "alıntı"}
    }
  ],
  "unresolved_entities": ["listede olmayan varlık adları"]
}`;
}

function validateEdges(edges) {
  const validIds = new Set(RU_ENTITIES.map(e => e.id));
  const validTypes = new Set(RELATION_TYPES);
  const errors = [];
  for (const [i, edge] of edges.entries()) {
    if (!validIds.has(edge.source_id)) errors.push(`edge[${i}]: source_id geçersiz "${edge.source_id}"`);
    if (!validIds.has(edge.target_id)) errors.push(`edge[${i}]: target_id geçersiz "${edge.target_id}"`);
    if (!validTypes.has(edge.type))    errors.push(`edge[${i}]: type geçersiz "${edge.type}"`);
    if (edge.source_id === edge.target_id) errors.push(`edge[${i}]: self-loop`);
  }
  return errors;
}

async function handleKenarCikart(env) {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `kenar-cikart-${today}`;

  const cached = await kvGet(env, cacheKey);
  if (cached) return jsonResponse({ ...JSON.parse(cached), cached: true });

  // GNews'ten haber çek
  const res = await fetch(`https://gnews.io/api/v4/search?q=Russia Ukraine war&lang=en&max=8&apikey=${env.GNEWS_API_KEY}`);
  if (!res.ok) return jsonResponse({ error: `GNews hatası: ${res.status}` }, res.status);
  const newsData = await res.json();

  const NOISE = ["world cup", "visa", "pizza", "ethanol", "biodiesel", "celebrity", "fashion"];
  function fmtDate(iso) { try { return new Date(iso).toISOString().slice(0, 10); } catch { return iso; } }

  const articles = newsData.articles
    .filter(a => !NOISE.some(k => a.title.toLowerCase().includes(k)))
    .map(a => {
      const domain = getDomain(a.url);
      return { baslik: a.title, ozet: a.description || "", kaynak: domain, kaynak_tipi: tagSource(domain), tarih: fmtDate(a.publishedAt) };
    });

  if (!articles.length) return jsonResponse({ error: "Haber bulunamadı" }, 422);

  const prompt = buildEdgeExtractionPrompt(articles);
  const raw = await groqFetch(env, prompt, 2000, true);

  let result;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("JSON bulunamadı");
    result = JSON.parse(m[0]);
  } catch (e) {
    return jsonResponse({ error: "JSON parse hatası", raw }, 500);
  }

  const errors = validateEdges(result.extracted_edges || []);
  const output = {
    date: today,
    source_article_count: articles.length,
    extracted_edges: result.extracted_edges || [],
    unresolved_entities: result.unresolved_entities || [],
    validation_errors: errors,
  };

  // Validasyon hatasız ise cache'e yaz ve log'a ekle
  if (!errors.length) {
    await kvPut(env, cacheKey, JSON.stringify(output));
    await appendKenarLog(env, {
      date: today,
      edge_count: output.extracted_edges.length,
      unresolved_entities: output.unresolved_entities,
      suspicious_excerpts: output.extracted_edges
        .filter(e => !e.attributes?.excerpt || e.attributes.excerpt.split(" ").length < 5)
        .map(e => ({ edge: `${e.source_id} -[${e.type}]→ ${e.target_id}`, excerpt: e.attributes?.excerpt || "" })),
    });
  }

  return jsonResponse({ ...output, cached: false });
}

// --- TARAFLAR: DESTEKÇİ KENAR ÇIKARIMI ---

function buildDestekciPrompt(articles, entityList, typeList) {
  const newsText = articles.map((a, i) =>
    `[${i + 1}] tarih:${a.tarih} | kaynak:${a.kaynak} | tip:${a.kaynak_tipi}\nbaşlık: ${a.baslik}\nözet: ${a.ozet || "-"}`
  ).join("\n\n");

  return `Sen bir jeopolitik ilişki çıkarma motorusun. Görevin: bu haberlerden Rusya-Ukrayna savaşındaki TARAF ve DESTEKÇİ ilişkilerini çıkarmak.

SADECE şu ilişki tipleri kabul edilir: ${typeList}
SADECE şu entity ID'leri kabul edilir:
${entityList}

KISITLAR:
1. Her kenar bir ülkenin/örgütün başka bir ülkeyi/tarafı nasıl desteklediğini veya karşı çıktığını göstermeli.
2. excerpt somut bir eylemi kanıtlamalı (silah yardımı, mali destek, siyasi destek, yaptırım, vs.).
3. Aynı source+target+type kombinasyonunu tekrarlama.
4. Haberde açıkça geçmeyen ilişki üretme.
5. Listede olmayan entity'leri unresolved_entities'e ekle.
6. YÖN KURALI: supports / funded_by / supplies / defends gibi yönlü ilişkilerde source_id DESTEKLEYEN, target_id DESTEKLENEN taraftır. Örnek: ABD Ukrayna'yı destekliyorsa source_id=country:usa, target_id=country:ukraine. Bunun tersini asla üretme. opposes / sanctions ilişkilerinde source_id EYLEMI YAPAN, target_id EYLEMDEN ETKİLENEN taraftır.

HABERLER:
${newsText}

Sadece JSON döndür:
{"extracted_edges":[{"source_id":"...","target_id":"...","type":"...","directed":true,"polarity":"support|oppose|neutral","modality":"verified|reported|inferred|claimed","valid_from":"YYYY-MM-DD","provenance":[{"domain":"...","published":"YYYY-MM-DD","source_type":"..."}],"attributes":{"excerpt":"..."}}],"unresolved_entities":[]}`;
}

async function handleDestekciGuncelle(env) {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `destekci-kenarlar-${today}`;

  const cached = await kvGet(env, cacheKey);
  if (cached) return jsonResponse({ ...JSON.parse(cached), cached: true });

  const query = "Russia Ukraine support alliance";
  const res = await fetch(`https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&max=10&apikey=${env.GNEWS_API_KEY}`);
  if (!res.ok) return jsonResponse({ error: `GNews hatası: ${res.status}` }, res.status);
  const newsData = await res.json();

  const NOISE = ["world cup", "visa", "pizza", "celebrity", "fashion", "sport"];
  function fmtDate(iso) { try { return new Date(iso).toISOString().slice(0, 10); } catch { return iso; } }

  const articles = newsData.articles
    .filter(a => !NOISE.some(k => a.title.toLowerCase().includes(k)))
    .map(a => {
      const domain = getDomain(a.url);
      return { baslik: a.title, ozet: a.description || "", kaynak: domain, kaynak_tipi: tagSource(domain), tarih: fmtDate(a.publishedAt) };
    });

  if (!articles.length) return jsonResponse({ error: "Haber bulunamadı" }, 422);

  const DESTEKCI_TYPES = ["supports", "opposes", "sanctions", "supplies", "funded_by", "negotiates", "mediates"];
  const entityList = RU_ENTITIES.map(e => `- ${e.id}  (${e.canonical_name})`).join("\n");
  const prompt = buildDestekciPrompt(articles, entityList, DESTEKCI_TYPES.join(", "));
  const raw = await groqFetch(env, prompt, 2000, true);

  let result;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("JSON bulunamadı");
    result = JSON.parse(m[0]);
  } catch (e) {
    return jsonResponse({ error: "JSON parse hatası", raw }, 500);
  }

  const errors = validateEdges(result.extracted_edges || []);
  const output = {
    date: today,
    source_article_count: articles.length,
    extracted_edges: result.extracted_edges || [],
    unresolved_entities: result.unresolved_entities || [],
    validation_errors: errors,
  };

  if (!errors.length) {
    await kvPut(env, cacheKey, JSON.stringify(output));
    await appendKenarLog(env, {
      date: today + "-destekci",
      edge_count: output.extracted_edges.length,
      unresolved_entities: output.unresolved_entities,
      suspicious_excerpts: output.extracted_edges
        .filter(e => !e.attributes?.excerpt || e.attributes.excerpt.split(" ").length < 5)
        .map(e => ({ edge: `${e.source_id}-[${e.type}]->${e.target_id}`, excerpt: e.attributes?.excerpt || "" })),
    });
  }

  return jsonResponse({ ...output, cached: false });
}

// --- ETKİLENENLER: AFFECTS KENAR ÇIKARIMI ---

function buildEtkilenmePrompt(articles, entityList) {
  const newsText = articles.map((a, i) =>
    `[${i + 1}] tarih:${a.tarih} | kaynak:${a.kaynak} | tip:${a.kaynak_tipi}\nbaşlık: ${a.baslik}\nözet: ${a.ozet || "-"}`
  ).join("\n\n");

  return `Sen bir jeopolitik ilişki çıkarma motorusun. Görevin: Rusya-Ukrayna savaşının hangi sektörleri, piyasaları ve toplulukları nasıl ETKİLEDİĞİNİ çıkarmak.

SADECE "affects" tipi kenar üret. Başka tip kabul edilmez.
SADECE şu entity ID'leri kabul edilir:
${entityList}

KISITLAR:
1. excerpt somut bir etkiyi kanıtlamalı (fiyat artışı, arz kesintisi, göç, harcama artışı, vs.).
2. Aynı source+target kombinasyonunu tekrarlama.
3. Haberde açıkça geçmeyen etki üretme.
4. Listede olmayan entity'leri unresolved_entities'e ekle.
5. polarity: savaşın etkilenen taraf için olumsuz etkisi "oppose", fırsata dönüşmesi "support", olgusal "neutral".

HABERLER:
${newsText}

Sadece JSON döndür:
{"extracted_edges":[{"source_id":"...","target_id":"...","type":"affects","directed":true,"polarity":"oppose|support|neutral","modality":"verified|reported|inferred|claimed","valid_from":"YYYY-MM-DD","provenance":[{"domain":"...","published":"YYYY-MM-DD","source_type":"..."}],"attributes":{"excerpt":"...","impact_summary":"tek cümle Türkçe etki özeti"}}],"unresolved_entities":[]}`;
}

async function handleEtkilenmeGuncelle(env) {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `etkilenme-kenarlar-${today}`;

  const cached = await kvGet(env, cacheKey);
  if (cached) return jsonResponse({ ...JSON.parse(cached), cached: true });

  const query = "Europe energy war";
  const res = await fetch(`https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&max=10&apikey=${env.GNEWS_API_KEY}`);
  if (!res.ok) return jsonResponse({ error: `GNews hatası: ${res.status}` }, res.status);
  const newsData = await res.json();

  const NOISE = ["world cup", "visa", "pizza", "celebrity", "fashion", "sport"];
  function fmtDate(iso) { try { return new Date(iso).toISOString().slice(0, 10); } catch { return iso; } }

  const articles = newsData.articles
    .filter(a => !NOISE.some(k => a.title.toLowerCase().includes(k)))
    .map(a => {
      const domain = getDomain(a.url);
      return { baslik: a.title, ozet: a.description || "", kaynak: domain, kaynak_tipi: tagSource(domain), tarih: fmtDate(a.publishedAt) };
    });

  if (!articles.length) return jsonResponse({ error: "Haber bulunamadı" }, 422);

  const entityList = RU_ENTITIES.map(e => `- ${e.id}  (${e.canonical_name})`).join("\n");
  const prompt = buildEtkilenmePrompt(articles, entityList);
  const raw = await groqFetch(env, prompt, 2000, true);

  let result;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("JSON bulunamadı");
    result = JSON.parse(m[0]);
  } catch (e) {
    return jsonResponse({ error: "JSON parse hatası", raw }, 500);
  }

  // Sadece affects kenarları kabul et
  const affectsOnly = (result.extracted_edges || []).filter(e => e.type === "affects");
  const errors = validateEdges(affectsOnly);
  const output = {
    date: today,
    source_article_count: articles.length,
    extracted_edges: affectsOnly,
    unresolved_entities: result.unresolved_entities || [],
    validation_errors: errors,
  };

  if (!errors.length) await kvPut(env, cacheKey, JSON.stringify(output));
  return jsonResponse({ ...output, cached: false });
}

async function handleKenarlar(env) {
  const entityMap = Object.fromEntries(RU_ENTITIES.map(e => [e.id, e]));
  const MODALITY_TR = { verified: "doğrulanmış", reported: "haberlenmiş", inferred: "çıkarım", claimed: "iddia" };

  const temel = RU_EDGES.filter(e => e.show_in_flow !== false).map(e => ({
    source_id: e.source_id,
    source_name: entityMap[e.source_id]?.canonical_name || e.source_id,
    target_id: e.target_id,
    target_name: entityMap[e.target_id]?.canonical_name || e.target_id,
    type: e.type,
    polarity: e.polarity,
    modality: e.modality,
    modality_label: MODALITY_TR[e.modality] || e.modality,
    valid_from: e.valid_from,
    attributes: e.attributes,
  }));

  const today = new Date().toISOString().slice(0, 10);
  const cached = await kvGet(env, `kenar-cikart-${today}`);
  const rawGuncel = cached ? (JSON.parse(cached).extracted_edges || []) : [];

  // Statik grafikte zaten tanımlı (show_in_flow: false dahil) edgeleri güncel listesinden çıkar
  const staticKeys = new Set(RU_EDGES.map(e => `${e.source_id}|${e.target_id}|${e.type}`));
  const guncel = rawGuncel.filter(e => !staticKeys.has(`${e.source_id}|${e.target_id}|${e.type}`));

  return jsonResponse({ temel_baglamlar: temel, guncel_baglantılar: guncel, date: today });
}

async function appendKenarLog(env, entry) {
  if (!env.RASAD_CACHE) return;
  const raw = await env.RASAD_CACHE.get("kenar-log");
  const log = raw ? JSON.parse(raw) : [];
  // Aynı güne ait eski kaydı güncelle, yoksa ekle
  const idx = log.findIndex(e => e.date === entry.date);
  if (idx >= 0) log[idx] = entry; else log.push(entry);
  await env.RASAD_CACHE.put("kenar-log", JSON.stringify(log));
}

async function handleKenarLog(env) {
  if (!env.RASAD_CACHE) return jsonResponse({ error: "KV bağlı değil" }, 503);
  const raw = await env.RASAD_CACHE.get("kenar-log");
  if (!raw) return jsonResponse({ log: [], message: "Henüz kayıt yok" });

  const log = JSON.parse(raw);

  // unresolved_entities frekans sayımı
  const freq = {};
  for (const entry of log) {
    for (const entity of entry.unresolved_entities || []) {
      freq[entity] = (freq[entity] || 0) + 1;
    }
  }
  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return jsonResponse({ entry_count: log.length, unresolved_entity_frequency: sorted, log });
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
      if (path === "/rusya-ukrayna-taraflar") return await handleRusyaUkraynaTaraflar(env);
      if (path === "/rusya-ukrayna-kenar-cikart") return await handleKenarCikart(env);
      if (path === "/rusya-ukrayna-kenarlar") return await handleKenarlar(env);
      if (path === "/rusya-ukrayna-destekci-guncelle") return await handleDestekciGuncelle(env);
      if (path === "/rusya-ukrayna-etkilenme-guncelle") return await handleEtkilenmeGuncelle(env);
      if (path === "/kenar-log") return await handleKenarLog(env);
      return jsonResponse({ error: "Geçersiz endpoint." }, 404);
    } catch (err) {
      return jsonResponse({ error: "Worker iç hatası", detail: err.message }, 500);
    }
  },
};
