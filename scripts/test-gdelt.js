// GDELT DOC 2.0 API - Filtreleme + Kaynak Etiketleme Testi
// Çalıştır: node scripts/test-gdelt.js

import { writeFileSync } from "fs";

const GDELT_URL =
  "https://api.gdeltproject.org/api/v2/doc/doc" +
  "?query=Russia%20Ukraine" +
  "&mode=artlist" +
  "&maxrecords=75" +
  "&format=json" +
  "&timespan=7d" +
  "&sort=DateDesc";

// --- GÜRÜLTÜ FİLTRESİ ---
const NOISE_KEYWORDS = [
  "world cup", "visa", "pizza", "ethanol", "biodiesel", "lng",
  "etanol", "adolf hitler", "canicule", "formula 1", "sport",
  "football", "basketball", "tennis", "celebrity", "fashion",
];

function isNoise(title) {
  const lower = title.toLowerCase();
  return NOISE_KEYWORDS.some((k) => lower.includes(k));
}

// --- KAYNAK ETİKETLEME ---
const RUSSIA_STATE = [
  "sputnik", "rt.com", "tass.ru", "ria.ru", "life.ru",
  "5-tv.ru", "runews24.ru", "anna-news.info", "gazeta.ru",
  "kremlin.ru", "rg.ru", "vesti.ru", "runews24", "lenta.ru",
];

const WESTERN_MEDIA = [
  "bbc.com", "reuters.com", "apnews.com", "theguardian.com",
  "nytimes.com", "washingtonpost.com", "inquirer.com",
  "nationalpost.com", "lbc.co.uk", "dailymail.com", "dw.com",
  "france24.com", "lexpress.fr", "franceinfo.fr", "economist.com",
  "ft.com", "wsj.com", "politico.com", "foreignpolicy.com",
  "bozemandailychronicle.com",
];

const INDEPENDENT_RUSSIA = ["themoscowtimes.com", "meduza.io", "novayagazeta.ru"];

const UKRAINE_DOMAINS = [
  "unian.net", "obozrevatel.com", "glavred.info", "korrespondent.net",
  "pravda.com.ua", "ukrainska.pravda.com.ua", "24tv.ua", "delo.ua",
  "kontrakty.ua", "war.obozrevatel.com", "6262.com.ua", "vesti-ua.net",
  "anna-news.info", "glavnoe.in.ua",
];

function classifySource(domain, sourcecountry) {
  if (RUSSIA_STATE.some((s) => domain.includes(s))) return "rusya devlet medyası";
  if (INDEPENDENT_RUSSIA.some((s) => domain.includes(s))) return "bağımsız";
  if (UKRAINE_DOMAINS.some((s) => domain.includes(s))) return "ukrayna kaynağı";
  if (sourcecountry === "Ukraine" || domain.endsWith(".ua")) return "ukrayna kaynağı";
  if (WESTERN_MEDIA.some((s) => domain.includes(s))) return "batı medyası";
  if (sourcecountry === "Russia") return "rusya kaynağı";
  return "diğer";
}

// --- ANA FONKSİYON ---
async function main() {
  let raw;

  // Önce cache'den oku, yoksa GDELT'e git
  try {
    const { readFileSync } = await import("fs");
    const cached = JSON.parse(readFileSync("scripts/gdelt-raw.json", "utf8"));
    raw = cached.makaleler || [];
    console.log(`Cache'den okundu: ${raw.length} makale\n`);
  } catch {
    console.log("Cache yok, GDELT'e bağlanılıyor...\n");
    const res = await fetch(GDELT_URL);
    if (!res.ok) {
      console.error("HATA:", res.status, res.statusText);
      process.exit(1);
    }
    const data = await res.json();
    raw = data.articles || [];
    const { writeFileSync } = await import("fs");
    writeFileSync("scripts/gdelt-raw.json", JSON.stringify({ cekme_tarihi: new Date().toISOString(), makaleler: raw }, null, 2));
  }
  console.log(`Ham makale sayısı: ${raw.length}`);

  // 1. Gürültüyü çıkar
  const withoutNoise = raw.filter((a) => !isNoise(a.title));
  console.log(`Gürültü filtresinden sonra: ${withoutNoise.length}`);

  // 2. Başlık tekrarlarını çıkar (aynı başlık, farklı URL)
  const seenTitles = new Set();
  const deduplicated = withoutNoise.filter((a) => {
    const normalTitle = a.title.trim().toLowerCase().slice(0, 60);
    if (seenTitles.has(normalTitle)) return false;
    seenTitles.add(normalTitle);
    return true;
  });
  console.log(`Tekrar temizliğinden sonra: ${deduplicated.length}`);

  // 3. Kaynak etiketi ekle
  const tagged = deduplicated.map((a) => ({
    ...a,
    kaynak_tipi: classifySource(a.domain, a.sourcecountry),
  }));

  // 4. Kaynak tipi dağılımı
  const dist = {};
  tagged.forEach((a) => {
    dist[a.kaynak_tipi] = (dist[a.kaynak_tipi] || 0) + 1;
  });

  console.log("\n=== Kaynak Tipi Dağılımı ===");
  Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .forEach(([tip, sayi]) => console.log(`  ${tip.padEnd(24)} ${sayi}`));

  console.log("\n=== İlk 5 Makale (etiketli) ===");
  tagged.slice(0, 5).forEach((a, i) => {
    console.log(`\n[${i + 1}] [${a.kaynak_tipi}]`);
    console.log(`  Başlık : ${a.title}`);
    console.log(`  Domain : ${a.domain} | Dil: ${a.language}`);
  });

  // 5. Groq'a hazır formata çevir
  const groqInput = tagged.map((a) => ({
    baslik: a.title,
    kaynak: a.domain,
    kaynak_tipi: a.kaynak_tipi,
    dil: a.language,
    tarih: a.seendate,
    url: a.url,
  }));

  // Kaydet
  const output = {
    cekme_tarihi: new Date().toISOString(),
    ham_sayi: raw.length,
    filtrelenmis_sayi: tagged.length,
    kaynak_dagılımı: dist,
    makaleler: groqInput,
  };

  writeFileSync("scripts/gdelt-filtered.json", JSON.stringify(output, null, 2));
  console.log(`\n✓ Filtrelenmiş veri scripts/gdelt-filtered.json dosyasına kaydedildi.`);
  console.log(`  ${raw.length} ham → ${tagged.length} temiz makale`);
}

main().catch(console.error);
