// Adım 3: LLM'ye "kenar üret" dedirtme — Lokal Test Scripti
// Çalıştır: GROQ_API_KEY=xxx node scripts/test-edge-extraction.js
//
// Neden bu script var?
// Worker'a deploy etmeden, prompt'un doğru kenar üretip üretmediğini test etmek için.
// Elle doğrulama sonrası /rusya-ukrayna-kenar-cikart endpoint'e taşınacak.

import { writeFileSync } from "fs";

// --- SABITLER ---

// Kapalı entity uzayı — LLM sadece bu ID'leri kullanabilir
const ENTITIES = [
  { id: "country:russia",               canonical_name: "Rusya Federasyonu",          type: "country" },
  { id: "country:ukraine",              canonical_name: "Ukrayna",                     type: "country" },
  { id: "country:usa",                  canonical_name: "Amerika Birleşik Devletleri", type: "country" },
  { id: "org:nato",                     canonical_name: "NATO",                        type: "organization" },
  { id: "event:tam-saldiri-2022-02-24", canonical_name: "Tam Ölçekli Saldırı (24 Şubat 2022)", type: "event" },
  { id: "resource:dogalgaz-rus",        canonical_name: "Rus Doğal Gazı",              type: "resource" },
  { id: "place:donbas",                 canonical_name: "Donbas",                      type: "place" },
];

// Kapalı ilişki sözlüğü — LLM sadece bu type değerlerini kullanabilir
const RELATION_TYPES = {
  commands:    "Bir aktör bir olayı veya eylemi yönetiyor/emrediyor",
  supports:    "Bir aktör başka bir aktörü destekliyor (askeri/mali/diplomatik)",
  opposes:     "Bir aktör başka bir aktöre karşı çıkıyor",
  attacks:     "Bir aktör başka bir aktörü/yeri saldırıyor",
  defends:     "Bir aktör bir bölgeyi/aktörü savunuyor",
  controls:    "Bir aktör bir kaynak veya bölge üzerinde kontrol sağlıyor",
  located_in:  "Bir olay veya varlık bir yerde gerçekleşiyor/bulunuyor",
  affects:     "Bir gelişme başka bir aktörü/kaynağı etkiliyor",
  sanctions:   "Bir aktör başka bir aktöre yaptırım uyguluyor",
  negotiates:  "İki aktör müzakere/görüşme yürütüyor",
  supplies:    "Bir aktör başka bir aktöre malzeme/silah/kaynak temin ediyor",
  funded_by:   "Bir aktör veya faaliyet bir başkası tarafından finanse ediliyor",
  mediates:    "Bir aktör iki taraf arasında arabuluculuk yapıyor",
};

// Modality tanımları (prompt'a yerleştirilir)
const MODALITY_GUIDE = `
- "verified": birden fazla bağımsız kaynak doğruladı
- "reported": en az bir kaynak haberleştirdi, çapraz doğrulama yok
- "inferred": haber bunu doğrudan söylemiyor ama mantıksal çıkarım yapılabilir
- "claimed": tek taraflı iddia, doğrulanmamış (özellikle devlet medyası iddiaları)
`;

// --- TEST HABERLERİ ---
// Gerçek GDELT/GNews haberleri yerine temsili test vakası kullanıyoruz.
// Bu sayede Groq API çağrısı olmadan da prompt mantığını test edebiliriz.

const TEST_ARTICLES = [
  {
    title: "Russia launches drone strikes on Kyiv, Ukraine air defense intercepts most",
    description: "Russian forces launched a massive drone attack on the Ukrainian capital overnight. Ukraine's air defense forces reported intercepting 34 of 40 drones. The strikes caused damage to residential buildings in the Obolon district.",
    domain: "reuters.com",
    source_type: "batı medyası",
    published: "2026-06-20",
    url: "https://reuters.com/world/europe/russia-ukraine-drone-2026-06-20",
  },
  {
    title: "US announces additional $500 million military aid package for Ukraine",
    description: "The Biden administration announced a new military assistance package for Ukraine, including air defense ammunition and artillery shells. The package brings total US assistance to Ukraine to over $175 billion since the war began.",
    domain: "apnews.com",
    source_type: "batı medyası",
    published: "2026-06-19",
    url: "https://apnews.com/article/us-ukraine-aid-2026-06-19",
  },
  {
    title: "NATO allies agree to increase defense spending following Eastern flank pressure",
    description: "NATO member states agreed to increase defense spending commitments as Russian forces maintained pressure on the eastern front. The alliance also reaffirmed support for Ukraine's territorial integrity.",
    domain: "dw.com",
    source_type: "batı medyası",
    published: "2026-06-18",
    url: "https://dw.com/en/nato-defense-spending-2026-06-18",
  },
];

// --- PROMPT ---

function buildPrompt(articles) {
  const entityList = ENTITIES.map(e => `- ${e.id}  (${e.canonical_name}, ${e.type})`).join("\n");
  const typeList = Object.entries(RELATION_TYPES)
    .map(([k, v]) => `- "${k}": ${v}`)
    .join("\n");
  const newsText = articles.map((a, i) => `[${i + 1}] tarih:${a.published} | kaynak:${a.domain} | tip:${a.source_type}
başlık: ${a.title}
özet: ${a.description}`).join("\n\n");

  return `Sen bir jeopolitik ilişki çıkarma motorusun. Sana haber metinleri verilecek. Görevin, bu haberlerden tespit ettiğin varlıklar arası ilişkileri (kenarları) çıkarmak.

KISITLAR — bunlara uymak zorunludur:
1. source_id ve target_id SADECE aşağıdaki ENTITY LİSTESİ'nden seçilmeli. Listede olmayan bir entity ID'si asla üretemezsin.
2. type SADECE aşağıdaki İLİŞKİ TİPİ SÖZLÜĞü'nden seçilmeli. Serbest metin üretemezsin.
3. modality şu dört değerden biri olabilir:${MODALITY_GUIDE}
4. Haberde açıkça desteklenmeyen ilişki üretme.
5. Listede olmayan ama haberde geçen önemli entity'leri unresolved_entities dizisine ekle.
6. Her kenar için provenance'ı haber kaynağından doldur — kendi ürettiğin kaynak yazma.
7. directed: true demek source→target yönü. İki taraflı ilişkiler için iki ayrı kenar üret.
8. polarity: "support" (destekleyici), "oppose" (karşı çıkan), "neutral" (tarafsız/olgusal).
9. excerpt: hangi cümleden bu ilişkiyi çıkardığını kısa alıntıyla göster.

ENTITY LİSTESİ (sadece bu ID'leri kullan):
${entityList}

İLİŞKİ TİPİ SÖZLÜĞü (sadece bu type değerlerini kullan):
${typeList}

HABERLER:
${newsText}

Yalnızca aşağıdaki JSON formatını döndür. JSON dışında HİÇBİR ŞEY yazma — ne açıklama ne başlık ne yorum.

{
  "extracted_edges": [
    {
      "source_id": "entity:id-buraya",
      "target_id": "entity:id-buraya",
      "type": "tip-buraya",
      "directed": true,
      "polarity": "support|oppose|neutral",
      "modality": "verified|reported|inferred|claimed",
      "valid_from": "YYYY-MM-DD",
      "provenance": [
        {
          "domain": "kaynak-domain.com",
          "published": "YYYY-MM-DD",
          "source_type": "batı medyası|ukrayna kaynağı|rusya devlet medyası|bağımsız|diğer"
        }
      ],
      "attributes": {
        "excerpt": "Bu ilişkiyi destekleyen haber alıntısı"
      }
    }
  ],
  "unresolved_entities": [
    "Haberde geçen ama listede olmayan varlık adları"
  ]
}`;
}

// --- GROQ ÇAĞRISI ---

async function groqExtract(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY env değişkeni tanımlı değil");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
      temperature: 0.1,  // Düşük temperature: sözlük bağlılığı için kritik
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Groq hatası: ${res.status} — ${JSON.stringify(data)}`);
  if (!data.choices?.[0]?.message?.content) throw new Error(`Groq boş yanıt`);
  return data.choices[0].message.content.trim();
}

// --- VALİDASYON ---

function validate(result) {
  const validEntityIds = new Set(ENTITIES.map(e => e.id));
  const validTypes = new Set(Object.keys(RELATION_TYPES));
  const validModalities = new Set(["verified", "reported", "inferred", "claimed"]);
  const validPolarities = new Set(["support", "oppose", "neutral"]);

  const errors = [];
  const warnings = [];

  for (const [i, edge] of result.extracted_edges.entries()) {
    const prefix = `Kenar[${i}]`;

    if (!validEntityIds.has(edge.source_id))
      errors.push(`${prefix}: source_id geçersiz — "${edge.source_id}"`);
    if (!validEntityIds.has(edge.target_id))
      errors.push(`${prefix}: target_id geçersiz — "${edge.target_id}"`);
    if (!validTypes.has(edge.type))
      errors.push(`${prefix}: type geçersiz — "${edge.type}"`);
    if (!validModalities.has(edge.modality))
      errors.push(`${prefix}: modality geçersiz — "${edge.modality}"`);
    if (!validPolarities.has(edge.polarity))
      warnings.push(`${prefix}: polarity beklenmedik — "${edge.polarity}"`);
    if (!edge.provenance?.length)
      warnings.push(`${prefix}: provenance boş`);
    if (edge.source_id === edge.target_id)
      errors.push(`${prefix}: source_id === target_id (self-loop)`);
  }

  return { errors, warnings };
}

// --- ANA FONKSİYON ---

async function main() {
  console.log("=== RASAD Adım 3: Edge Extraction Testi ===\n");

  const articles = TEST_ARTICLES;
  console.log(`Test haberleri: ${articles.length} makale`);
  articles.forEach((a, i) => console.log(`  [${i + 1}] ${a.domain}: ${a.title.slice(0, 60)}...`));

  const prompt = buildPrompt(articles);
  console.log(`\nPrompt uzunluğu: ~${Math.round(prompt.length / 4)} token tahmini`);

  let raw;
  if (!process.env.GROQ_API_KEY) {
    console.log("\n⚠  GROQ_API_KEY yok — gerçek API çağrısı yapılmıyor.");
    console.log("   Çalıştırmak için: GROQ_API_KEY=xxx node scripts/test-edge-extraction.js\n");
    console.log("=== PROMPT ÖNIZLEMESI ===\n");
    console.log(prompt.slice(0, 1200) + "\n...[kısaltıldı]");

    // Şema doğruluğunu test etmek için sahte çıktı
    raw = JSON.stringify({
      extracted_edges: [
        {
          source_id: "country:russia",
          target_id: "country:ukraine",
          type: "attacks",
          directed: true,
          polarity: "oppose",
          modality: "reported",
          valid_from: "2026-06-20",
          provenance: [{ domain: "reuters.com", published: "2026-06-20", source_type: "batı medyası" }],
          attributes: { excerpt: "Russian forces launched a massive drone attack on the Ukrainian capital overnight." },
        },
        {
          source_id: "country:usa",
          target_id: "country:ukraine",
          type: "supplies",
          directed: true,
          polarity: "support",
          modality: "verified",
          valid_from: "2026-06-19",
          provenance: [{ domain: "apnews.com", published: "2026-06-19", source_type: "batı medyası" }],
          attributes: { excerpt: "The Biden administration announced a new military assistance package for Ukraine." },
        },
        {
          source_id: "org:nato",
          target_id: "country:ukraine",
          type: "supports",
          directed: true,
          polarity: "support",
          modality: "reported",
          valid_from: "2026-06-18",
          provenance: [{ domain: "dw.com", published: "2026-06-18", source_type: "batı medyası" }],
          attributes: { excerpt: "The alliance also reaffirmed support for Ukraine's territorial integrity." },
        },
      ],
      unresolved_entities: ["Biden administration", "Obolon district"],
    });

    console.log("\n=== SAHTE ÇIKTI (şema testi) ===");
  } else {
    console.log("\nGroq'a gönderiliyor...");
    raw = await groqExtract(prompt);
    console.log("Yanıt alındı.");
  }

  // JSON parse
  let result;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("JSON bulunamadı");
    result = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("\nJSON parse hatası:", e.message);
    console.error("Ham yanıt:\n", raw);
    process.exit(1);
  }

  // Validation
  const { errors, warnings } = validate(result);

  // Rapor
  console.log(`\n=== SONUÇ ===`);
  console.log(`Çıkarılan kenar sayısı: ${result.extracted_edges.length}`);
  console.log(`Çözümsüz entity sayısı: ${result.unresolved_entities?.length || 0}`);

  if (result.unresolved_entities?.length) {
    console.log(`\nÇözümsüz entityler (yeni düğüm adayları):`);
    result.unresolved_entities.forEach(e => console.log(`  - ${e}`));
  }

  console.log(`\n=== KENARLAR ===`);
  result.extracted_edges.forEach((e, i) => {
    console.log(`\n[${i + 1}] ${e.source_id} —[${e.type}, ${e.modality}]→ ${e.target_id}`);
    console.log(`     polarity: ${e.polarity} | tarih: ${e.valid_from}`);
    if (e.attributes?.excerpt) console.log(`     alıntı: "${e.attributes.excerpt.slice(0, 80)}..."`);
  });

  if (warnings.length) {
    console.log(`\n⚠  Uyarılar (${warnings.length}):`);
    warnings.forEach(w => console.log(`  - ${w}`));
  }

  if (errors.length) {
    console.log(`\n✗ Validasyon hataları (${errors.length}):`);
    errors.forEach(e => console.log(`  - ${e}`));
    console.log("\nBu hatalar LLM'nin kısıtları ihlal ettiğini gösterir — prompt güçlendirilmeli.");
  } else {
    console.log(`\n✓ Validasyon geçti — tüm edge'ler şemaya uygun`);
  }

  // Kaydet
  const output = {
    test_tarihi: new Date().toISOString(),
    model: "llama-3.3-70b-versatile",
    test_haberleri: articles.map(a => ({ domain: a.domain, title: a.title, published: a.published })),
    validation: { errors, warnings },
    result,
  };

  writeFileSync("scripts/edge-extraction-output.json", JSON.stringify(output, null, 2));
  console.log(`\n✓ Çıktı: scripts/edge-extraction-output.json`);
}

main().catch(console.error);
