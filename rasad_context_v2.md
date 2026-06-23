# RASAD — Proje Bağlam Belgesi v2
*Yeni Claude Code oturumlarının başında bu dosyayı yapıştır.*
*Çekirdek mimari belgesi: `rasad_cekirdek_mimari_v1.md.docx` (yerel ~/Downloads — gizli, commit edilmedi)*

---

## 1. Projenin Özü

Rasad, jeopolitika/ekonomi/finans olayları arasındaki gizli bağlantıları AI yardımıyla ortaya çıkaran bir istihbarat platformu.

**Canlı site:** `alp-0o.github.io/dadas` | **Repo:** `github.com/Alp-0o/dadas` (public)
**Çalışma dizini:** `/Users/fikretozdemir/rasad`

---

## 2. Teknik Altyapı

### Dosya Yapısı
```
rasad/
  index.html                         ← Ana sayfa
  dosya/rusya-ukrayna.html           ← Dosya sayfası (10 bölüm)
  cloudflare-worker/worker.js        ← TÜM backend mantığı
  data/dossiers/rusya-ukrayna/
    entities.json                    ← 17 düğüm
    edges.json                       ← 6 kenar (2 show_in_flow:false, 1 inferred)
    sources.json                     ← 3 kaynak düğümü
  scripts/
    test-edge-extraction.js          ← Edge extraction lokal test scripti
```

### Cloudflare Worker
**URL:** `https://r.rasad-news-proxy.workers.dev/`
**Deploy:** `cd cloudflare-worker && wrangler deploy --config wrangler.toml`
**Secrets:** `GNEWS_API_KEY`, `METALS_API_KEY`, `GROQ_API_KEY` (Cloudflare panelinde)
**KV:** `RASAD_CACHE` binding — günlük cache + kenar log
**CORS:** `"Access-Control-Allow-Origin": "*"` (wildcard, local preview dahil)

**Endpoint'ler:**
| Endpoint | İşlev | Model |
|---|---|---|
| `/news` | GNews haber çek | — |
| `/metals` | metals.dev altın/gümüş | — |
| `/news-comment` | Çatışma AI yorumu | llama-3.1-8b-instant |
| `/metals-comment` | Emtia AI yorumu | llama-3.1-8b-instant |
| `/rusya-ukrayna-content` | Dosya AI içeriği (10 bölüm) | llama-3.3-70b-versatile |
| `/rusya-ukrayna-taraflar` | Grafik tabanlı taraflar (statik+dinamik birleştirilmiş) | — |
| `/rusya-ukrayna-kenar-cikart` | Haber → kenar çıkarımı | llama-3.3-70b-versatile |
| `/rusya-ukrayna-kenarlar` | Temel+güncel bağlantılar (dedup'lu) | — |
| `/rusya-ukrayna-destekci-guncelle` | Taraf/destekçi kenar çıkarımı | llama-3.3-70b-versatile |
| `/rusya-ukrayna-etkilenme-guncelle` | Affects kenar çıkarımı | llama-3.3-70b-versatile |
| `/kenar-log` | Birikmiş kenar log + entity frekansı | — (KV'den) |

---

## 3. Mevcut Mimari Durumu

### Graf Katmanı (aktif)
- `entities.json` / `edges.json` — 17 entity, 6 edge
- **17 entity:** country:russia, country:ukraine, country:usa, org:nato, country:china, country:belarus, org:eu, country:poland, country:uk, country:germany, sector:avrupa-enerji, sector:kuresel-tahil, sector:ukrayna-sivil, sector:global-savunma, event:tam-saldiri-2022-02-24, resource:dogalgaz-rus, place:donbas
- Worker'da `RU_ENTITIES` ve `RU_EDGES` sabit — entities.json/edges.json ile senkron tutulmalı

### show_in_flow Flag
- `edge:00002` (saldırı located_in donbas) — `show_in_flow: false` → temel listede görünmez
- `edge:00005` (rusya controls dogalgaz) — `show_in_flow: false` → temel listede görünmez
- Mantık: "bariz/herkesin bildiği" kenarlar grafikte tutulur ama gösterilmez

### Kenar Deduplication (2026-06-23)
- `/rusya-ukrayna-kenarlar` — `handleKenarlar` fonksiyonu:
  - `temel_baglamlar`: RU_EDGES'den `show_in_flow !== false` olanlar
  - `guncel_baglantılar`: KV'den alınan dinamik kenarlar, **statik RU_EDGES ile çakışanlar çıkarılır** (show_in_flow: false dahil)
  - Bu sayede LLM aynı "bariz" kenarı yeniden üretse bile güncel listede görünmez

### Edge Extraction (Adım 3 — tamamlandı 2026-06-23)
- Kapalı entity uzayı: LLM sadece `RU_ENTITIES` ID'lerini kullanabilir; bilinmeyenleri `unresolved_entities[]`'e atar
- Kapalı ilişki sözlüğü: 13 tip (commands, supports, opposes, attacks, defends, controls, located_in, affects, sanctions, negotiates, supplies, funded_by, mediates)
- Validation: entity ID ve type doğrulama — hatalı kenar cache'e yazılmıyor
- Prompt kuralları: somut eylem zorunlu (söylem/alıntı kenar üretemez)
- **GNews query önemli:** Kısa sorgular kullan (max 4-5 kelime). Çok-kelimeli OR sorguları GNews'te sıfır sonuç döndürür.

### KV Anahtarları
- `ru-content-{today}` — AI içeriği (10 bölüm), TTL: 86400s
- `kenar-cikart-{today}` — /rusya-ukrayna-kenar-cikart sonuçları
- `destekci-kenarlar-{today}` — /rusya-ukrayna-destekci-guncelle sonuçları
- `kenar-log` — birikimli kenar log
- KV temizleme: `wrangler kv key delete "KEY" --binding RASAD_CACHE --config cloudflare-worker/wrangler.toml --remote`

### Kaynak Etiketleme
`SRC_RUSSIA_STATE`, `SRC_UKRAINE`, `SRC_WESTERN` — ~30 domain. `getDomain()` + `tagSource()` paylaşılan modül-seviyesi fonksiyonlar.

---

## 4. Rusya-Ukrayna Dosyası Bölüm Durumu

| # | Bölüm | Kaynak |
|---|---|---|
| 01 | Olayın Özeti | AI (Groq, günlük cache) |
| 02 | Taraflar | Manuel placeholder |
| 03 | Çıkış Sebepleri | Manuel placeholder |
| 04 | İcraatler | Manuel placeholder |
| 05 | Son Durum | AI (Groq, günlük cache) |
| 06 | Zincirleme Haberler | AI (tarih + kaynak domain) |
| 07 | Destekçiler | **Grafik** (statik + dinamik birleşik, `/rusya-ukrayna-taraflar`) |
| 08 | Etkilenenler | **Grafik** (affects kenarları, `/rusya-ukrayna-etkilenme-guncelle`) |
| 09 | Gelecek Senaryoları | AI (yüksek/orta/düşük) |
| 10 | Keşfedilen Bağlantılar | **Grafik** (temel + güncel, `/rusya-ukrayna-kenarlar`) |
| 11 | Açık Sorular | Manuel placeholder |

### HTML localStorage Cache Anahtarları
- `ru-content` / `ru-content-date` — AI içeriği
- `ru-kenarlar-v2` / `ru-kenarlar-v2-date` — kenar listesi (v2: dedup fix sonrası bump)
- `ru-destekci-date` — destekci endpoint'inin o gün çağrıldığını izler
- `ru-etkilenme` / `ru-etkilenme-date` — etkilenme kenarları

---

## 5. Bilinen Sorunlar

| Sorun | Durum |
|---|---|
| metals.dev 530 hatası | Aktif — Alpha Vantage'a geçilecek (bkz. P3) |
| GDELT Worker'a taşınmadı | Planlandı — lokal script hazır (bkz. P2) |
| Destekci endpoint az kenar üretiyor | GNews "Russia Ukraine support alliance" ile sadece NATO dönüyor; sorgu iyileştirilebilir |

---

## 6. Sıradaki Öncelikler

### P0 — Kenar log'unu izle, entity ekleme kararı ver
`/kenar-log` endpoint'ine birkaç gün bak. `unresolved_entity_frequency` içinde `count ≥ 3` olan entity'leri `entities.json`'a ve Worker `RU_ENTITIES`'e ekle. İkisini senkron tut.

### P1 — Destekci kenar kalitesini iyileştir
Şu an sadece NATO edges üretiyor. Çin, Belarus, AB, Polonya, UK, Almanya için ayrı GNews sorguları veya daha hedefli query dene.

### P2 — GDELT'i Worker'a taşı
`scripts/test-gdelt.js`'deki filtre + etiketleme mantığını `/rusya-ukrayna-content` endpoint'ine ekle. `seendate` formatı `20260620T113000Z` (ISO değil) — parse ederken dikkat.

### P3 — metals.dev yerine Alpha Vantage
```
https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=XAU&to_currency=USD&apikey=KEY
```
Worker'a `ALPHA_VANTAGE_KEY` secret ekle, free tier günde 25 istek.

### P4 — İkinci dosya sayfası
İran-İsrail şablonu: `dosya/rusya-ukrayna.html`'i kopyala, Worker'a `/iran-israil-content` ekle.

---

## 7. Ortam

```bash
# Node.js: nvm v26.3.1 | Wrangler: kurulu, alpomerozdemir@gmail.com
# Git push: HTTPS + Personal Access Token
# Deploy: cd cloudflare-worker && wrangler deploy --config wrangler.toml
# KV cache temizleme: wrangler kv key delete "KEY" --binding RASAD_CACHE --config cloudflare-worker/wrangler.toml --remote
# Local preview: http://localhost:3333 (npx serve -l 3333 .)
```

## 8. Oturum Kuralı

1. Bu dosyayı yapıştır
2. "Bu oturumda sadece şunu yapacağız: [tek hedef]" de
3. Her adımda "neden bu yolu seçtin" diye sor
4. Kodu anlamadan onaylama
5. Oturum sonunda bu dosyayı güncelle + sıkıştır
