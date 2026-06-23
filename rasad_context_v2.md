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
    entities.json                    ← 7 düğüm
    edges.json                       ← 6 kenar (1 inferred)
    sources.json                     ← 3 kaynak düğümü
  scripts/
    test-gdelt.js                    ← GDELT filtre + etiketleme (lokal)
    test-edge-extraction.js          ← Edge extraction lokal test scripti
```

### Cloudflare Worker
**URL:** `https://r.rasad-news-proxy.workers.dev/`
**Deploy:** `cd cloudflare-worker && wrangler deploy --config wrangler.toml`
**Secrets:** `GNEWS_API_KEY`, `METALS_API_KEY`, `GROQ_API_KEY` (Cloudflare panelinde)
**KV:** `RASAD_CACHE` binding — günlük cache + kenar log

**Endpoint'ler:**
| Endpoint | İşlev | Model |
|---|---|---|
| `/news` | GNews haber çek | — |
| `/metals` | metals.dev altın/gümüş | — |
| `/news-comment` | Çatışma AI yorumu | llama-3.1-8b-instant |
| `/metals-comment` | Emtia AI yorumu | llama-3.1-8b-instant |
| `/rusya-ukrayna-content` | Dosya AI içeriği (10 bölüm) | llama-3.3-70b-versatile |
| `/rusya-ukrayna-taraflar` | Graf tabanlı taraflar+destekçiler | — (graftan) |
| `/rusya-ukrayna-kenar-cikart` | Haber → kenar çıkarımı | llama-3.3-70b-versatile |
| `/kenar-log` | Birikmiş kenar log + entity frekansı | — (KV'den) |

---

## 3. Mevcut Mimari Durumu

### Graf Katmanı (aktif)
- `entities.json` / `edges.json` / `sources.json` — §2.1, §2.2, §2.7 şemasında
- Taraflar+Destekçiler bölümü artık Groq'tan değil graftan render ediliyor (`/rusya-ukrayna-taraflar`)
- Modality badge'leri: `verified` (yeşil) / `reported` (mavi) / `inferred` (turuncu kesik)
- Worker'da `RU_ENTITIES` ve `RU_EDGES` sabit olarak tanımlı; `entities.json`/`edges.json` ile senkron tutulmalı

### Edge Extraction (Adım 3 — tamamlandı 2026-06-23)
- `/rusya-ukrayna-kenar-cikart`: GNews haberleri → Groq → `edges.json` şemasında kenar dizisi
- Kapalı entity uzayı: LLM sadece `RU_ENTITIES` ID'lerini kullanabilir; bilinmeyenleri `unresolved_entities[]`'e atar
- Kapalı ilişki sözlüğü: `RELATION_TYPES` (13 tip: commands, supports, opposes, attacks, defends, controls, located_in, affects, sanctions, negotiates, supplies, funded_by, mediates)
- Validation: source/target entity listesinde mi, type sözlükte mi — hatalı kenar cache'e yazılmıyor
- Prompt kuralları: somut eylem zorunlu (söylem/alıntı kenar üretemez), aynı source+target+type tekrarlanamaz

### KV Log (2026-06-23)
- Her başarılı `/rusya-ukrayna-kenar-cikart` çağrısı `kenar-log` KV anahtarına günlük entry ekler
- `/kenar-log` endpoint'i `unresolved_entity_frequency` hesaplayarak döndürür
- Suspicious excerpts: 5 kelimeden kısa alıntılar otomatik flagleniyor
- **Strateji:** birkaç gün biriktir, `count ≥ 3` olan entity'leri grafiğe ekle

### Kaynak Etiketleme (paylaşılan, modül seviyesi)
`SRC_RUSSIA_STATE`, `SRC_UKRAINE`, `SRC_WESTERN` — ~30 domain. `getDomain()` + `tagSource()` fonksiyonları.
Her iki içerik endpoint'i bu paylaşılan fonksiyonları kullanıyor.

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
| 07 | Destekçiler | **Graf** (`/rusya-ukrayna-taraflar`) |
| 08 | Etkilenenler | AI (5 kategori) |
| 09 | Gelecek Senaryoları | AI (yüksek/orta/düşük) |
| 10 | Açık Sorular | Manuel placeholder |

---

## 5. Bilinen Sorunlar

| Sorun | Durum |
|---|---|
| metals.dev 530 hatası | Aktif — Alpha Vantage'a geçilecek (bkz. P3) |
| GDELT Worker'a taşınmadı | Planlandı — lokal script hazır (bkz. P2) |
| Fabrication fix test edilmedi | Deploy edildi ama doğrulanmadı (bkz. P1) |

---

## 6. Sıradaki Öncelikler

### P0 — Kenar log'unu izle, entity ekleme kararı ver
`/kenar-log` endpoint'ine birkaç gün bak. `unresolved_entity_frequency` içinde `count ≥ 3` olan entity'leri `entities.json`'a ve Worker `RU_ENTITIES`'e ekle. İkisini senkron tut.

### P1 — Fabrication fix'ini doğrula
`/rusya-ukrayna-content` cache'ini sil, kronoloji bölümünde gerçek domainler ve 2026 tarihleri olduğunu kontrol et.

### P2 — GDELT'i Worker'a taşı
`scripts/test-gdelt.js`'deki filtre + etiketleme mantığını `/rusya-ukrayna-content` endpoint'ine ekle (GNews yerine GDELT). `seendate` formatı `20260620T113000Z` (ISO değil) — parse ederken dikkat.

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
```

## 8. Oturum Kuralı

1. Bu dosyayı yapıştır
2. "Bu oturumda sadece şunu yapacağız: [tek hedef]" de
3. Her adımda "neden bu yolu seçtin" diye sor
4. Kodu anlamadan onaylama
5. Oturum sonunda bu dosyayı güncelle + sıkıştır
