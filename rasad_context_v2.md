# RASAD — Proje Bağlam Belgesi v2
*Yeni Claude Code oturumlarının başında bu dosyayı yapıştır.*
*Önceki versiyon: rasad_context.md (temel proje tanımı için hâlâ geçerli)*
*Çekirdek mimari belgesi: rasad_cekirdek_mimari_v1.md.docx (yerel ~/Downloads — GitHub'a commit edilmedi, gizli belge)*

---

## 1. Projenin Özü (Kısa)

Rasad, jeopolitika/ekonomi/finans olayları arasındaki gizli bağlantıları AI yardımıyla ortaya çıkaran bir istihbarat platformu. Hedef kitle: bağımsız analistler, araştırmacı gazeteciler, akademisyenler.

**Canlı site:** `alp-0o.github.io/dadas`
**Repo:** `github.com/Alp-0o/dadas` (public)
**Çalışma dizini:** `/Users/fikretozdemir/rasad` (Mac'e geçildi — önceki Windows: `C:\Users\Monster Jo\rasad`)

---

## 2. Teknik Altyapı

### Dosya Yapısı
```
rasad/
  index.html                    ← Ana sayfa (emtia + çatışma kartları)
  dosya/
    rusya-ukrayna.html          ← İlk dosya sayfası (10 bölüm)
  cloudflare-worker/
    worker.js                   ← TÜM backend mantığı burada
  scripts/
    test-gdelt.js               ← GDELT test + filtre scripti
    gdelt-raw.json              ← Ham GDELT verisi (75 makale)
    gdelt-filtered.json         ← Filtrelenmiş GDELT verisi (67 makale)
```

### Cloudflare Worker
**URL:** `https://r.rasad-news-proxy.workers.dev/`
**Secrets (Cloudflare panelinde):**
- `GNEWS_API_KEY` — GNews API
- `METALS_API_KEY` — metals.dev API
- `GROQ_API_KEY` — Groq API (llama modelleri)
- `GEMINI_API_KEY` — eski, artık kullanılmıyor

**KV Binding:**
- Variable: `RASAD_CACHE`, Namespace: `rasad-cache`
- ⚠️ Bağlantı sorunu yaşandı — Worker kodunda null-check bypass var (`env.RASAD_CACHE ?`)
- Yani KV cache çalışmıyor olabilir, sadece localStorage cache aktif

**Worker Endpoint'leri:**
| Endpoint | İşlev | Model |
|---|---|---|
| `/news` | GNews'ten haber çek | — |
| `/metals` | metals.dev'den altın/gümüş fiyatı | — |
| `/news-comment` | Çatışma haberleri için AI yorum | llama-3.1-8b-instant |
| `/metals-comment` | Emtia fiyatları için AI yorum | llama-3.1-8b-instant |
| `/rusya-ukrayna-content` | Rusya-Ukrayna dosyası için tam AI içerik | llama-3.3-70b-versatile |

---

## 3. Tamamlanan Aşamalar

### Aşama 1 — Temel Site ✓
- GitHub Pages'de canlı site
- Altın/gümüş fiyatı Cloudflare Worker üzerinden çekiliyor
- GNews haberleri Cloudflare Worker üzerinden çekiliyor (CORS çözüldü)
- Her iki veri kaynağı için localStorage günlük cache

### Aşama 2 — AI Yorum Katmanı ✓ (kısmen)
- Ana sayfadaki her iki kart için Groq ile kısa AI yorumu
- Rusya-Ukrayna dosyası için tam 10 bölümlü AI içerik
- Cache: Worker tarafı KV (sorunlu), frontend tarafı localStorage (çalışıyor)

### Aşama 3 — GDELT Testi ✓ (lokal)
- GDELT DOC 2.0 API bağlantısı test edildi
- 75 ham makale → 67 filtrelenmiş
- Kaynak etiketleme sistemi yazıldı (ukrayna kaynağı / batı medyası / rusya devlet medyası / diğer)
- **Henüz Worker'a taşınmadı** — Worker hâlâ GNews kullanıyor

### Aşama 4 — Grafik-Merkezli Mimariye Geçiş ✓ (başladı)
- `data/dossiers/rusya-ukrayna/entities.json` — 7 düğüm (çekirdek mimari v1 §2.1 şemasında)
- `data/dossiers/rusya-ukrayna/edges.json` — 6 kenar, 1 `inferred` (§2.2 şemasında)
- `data/dossiers/rusya-ukrayna/sources.json` — 3 kaynak düğümü (§2.7 şemasında)
- **Pivot anı gerçekleşti:** Taraflar + Destekçiler bölümleri artık Groq'tan değil, `/rusya-ukrayna-taraflar` endpoint'i üzerinden graftan render ediliyor
- Section 02 (Taraflar, manuel) kaldırıldı; section 07 (Destekçiler) ikisini birleştirdi
- Entity kartları: canonical_name, aliases (Россия/Україна vb.), sector_tag pilleri
- Modality badge'leri: verified (yeşil) / reported (mavi) / inferred (turuncu kesik)

---

## 4. Rusya-Ukrayna Dosyası Yapısı

`dosya/rusya-ukrayna.html` — 10 bölüm:

| # | Bölüm | Doluluğu |
|---|---|---|
| 01 | Olayın Özeti | AI (Groq, günlük) |
| 02 | Taraflar | Manuel (placeholder) |
| 03 | Çıkış Sebepleri | Manuel (placeholder) |
| 04 | İcraatler ve Fiiliyatlar | Manuel (placeholder) |
| 05 | Son Durum | AI (Groq, günlük) |
| 06 | Zincirleme Haberler | AI (tarih + kaynak domain ile) |
| 07 | Destekçiler | AI (rusya_taraf / ukrayna_taraf ayrımıyla) |
| 08 | Etkilenenler | AI (5 kategori) |
| 09 | Gelecek Senaryoları | AI (yüksek/orta/düşük olasılık) |
| 10 | Açık Sorular | Manuel (placeholder) |

**Sidebar:** Yapışkan, aktif bölümü otomatik vurgular.
**Disclaimer:** Sarı banner — "Bu içerik AI tarafından üretilmiştir, doğrulanmamıştır."

---

## 5. Groq Prompt Mimarisi

### Temel İlkeler (prompt'a yerleştirilmiş)
1. **KAYNAK:** Sadece ham veride geçen gerçek domain'leri kaynak göster. Placeholder/hayali kaynak ASLA üretme.
2. **ALAN:** Her gelişmeye `[askeri]` `[ekonomik]` `[siyasi]` `[siber]` etiketi ekle.
3. **KANIT:** Doğrulanamayan iddiaları "söylem" veya "iddia" olarak işaretle.
4. **TARİH:** Tarihleri yalnızca haberlerin `publishedAt` alanından al, tahmin etme.

### newsText Formatı (Worker'da)
```
[1] tarih:20 Haziran 2026 | kaynak:inquirer.com | tip:batı medyası
başlık: EU leaders squabble over outreach to Moscow
özet: ...
```

### JSON Çıktı Yapısı
```json
{
  "ozet": "...",
  "son_durum": "...",
  "kronoloji": [{"tarih": "...", "kaynak": "domain.com", "olay": "[alan] ..."}],
  "rusya_taraf": [{"ulke": "...", "destek": "...", "detay": "..."}],
  "ukrayna_taraf": [{"ulke": "...", "destek": "...", "detay": "..."}],
  "etkilenenler": [{"baslik": "...", "aciklama": "..."}],
  "senaryolar": [{"olasilik": "yüksek|orta|düşük", "aciklama": "...", "veri": "..."}]
}
```

---

## 6. Bilinen Sorunlar

| Sorun | Durum | Çözüm |
|---|---|---|
| metals.dev 530 hatası | Aktif | metals.dev geçici çökmüş. Alpha Vantage'a geçmeyi planla (bkz. P4) |
| KV cache bağlantısı | **Çözüldü** | wrangler.toml + doğru KV ID ile test edildi, `cached: true` doğrulandı |
| AI fabrication (sahte kaynak/tarih) | Düzeltildi, kısmen test edildi | localStorage temizleyip kronoloji bölümünü kontrol et |
| GDELT Worker'a taşınmadı | Planlandı | Bkz. Sıradaki Öncelikler |
| Worker adı karışıklığı | **Çözüldü** | Gerçek worker adı `r` (`r.rasad-news-proxy.workers.dev`). `wrangler.toml` buna göre ayarlandı. Deploy her zaman `--config cloudflare-worker/wrangler.toml` ile yapılmalı |
| Git kimlik doğrulama (Mac) | **Çözüldü** | GitHub Personal Access Token ile HTTPS push çalışıyor |

### localStorage Temizleme (test için console'a gir)
```javascript
localStorage.removeItem("ru-content");
localStorage.removeItem("ru-content-date");
location.reload();
```

---

## 7. Sıradaki Öncelikler (Sıralı)

### P0 — Adım 3: LLM'ye "kenar üret" dedirtmek ← YARIN
Mimari belge §10, Adım 3. Tek hedef:
- Worker'a (veya lokal test scripti olarak) yeni bir prompt yaz
- LLM'nin görevi: "10 bölüm doldur" değil, bir haber metninden `edges.json` şemasında (`type`, `source_id`, `target_id`, `modality`, `provenance[]`) kenar nesneleri üretmek
- İlişki tipini §2.6 sözlüğünden seçmeli, serbest metin üretmemeli
- Tek bir makale üzerinde test et, çıktıyı elle doğrula
- Başlangıç prompt'u için: `rasad_cekirdek_mimari_v1.md.docx` §5 (Katman 2 kontratı) ve §10 Adım 3

### P1 — Fabrication fix'ini doğrula
Zaten deploy edildi. Hâlâ test edilmedi.
1. localStorage temizle: `localStorage.removeItem("ru-content"); localStorage.removeItem("ru-content-date"); location.reload();`
2. Kronoloji bölümünde gerçek domainler ve 2026 tarihleri görünmeli

### P2 — GDELT'i Worker'a taşı
Lokal test scripti (`scripts/test-gdelt.js`) hazır ve çalışıyor.
Worker'da yeni endpoint: `/rusya-ukrayna-content` GNews yerine GDELT kullanacak.
- GDELT URL: `https://api.gdeltproject.org/api/v2/doc/doc?query=Russia%20Ukraine&mode=artlist&maxrecords=75&format=json&timespan=7d&sort=DateDesc`
- Filtre + etiketleme mantığı `scripts/test-gdelt.js`'de hazır, Worker'a taşınacak
- ⚠️ GDELT rate limit var (429), Worker'da KV cache kritik hale gelir

### P3 — KV Cache'i düzelt
Şu an null-check bypass ile çalışıyor. Doğru çalışırsa:
- `/rusya-ukrayna-content` günde 1 kez GDELT + Groq çağrısı yapar
- Diğer tüm kullanıcılar KV'den anında alır

### P4 — metals.dev yerine Alpha Vantage
metals.dev sık çöküyor. Alternatif:
```
https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=XAU&to_currency=USD&apikey=KEY
```
Free tier: günde 25 istek. Worker'da `ALPHA_VANTAGE_KEY` secret ekle.

### P5 — İkinci dosya sayfası
İran-İsrail veya ABD-İran için aynı şablonu (`dosya/rusya-ukrayna.html`) kopyala.
Bölüm 2 (Taraflar) ve Bölüm 3 (Sebepler) elle doldurulacak.
AI bölümleri için Worker'a yeni endpoint: `/iran-israil-content`

---

## 8. GDELT API Notları

```
Endpoint: https://api.gdeltproject.org/api/v2/doc/doc
Parametreler:
  query=Russia Ukraine
  mode=artlist
  maxrecords=75        (max 250)
  format=json
  timespan=7d
  sort=DateDesc
API key gerekmez. Rate limit var (429 alınabilir).
```

Dönen alanlar: `url, url_mobile, title, seendate, socialimage, domain, language, sourcecountry`
Not: `seendate` formatı `20260620T113000Z` — `publishedAt` değil!

---

## 9. Mac Kurulum Notları

```bash
# Node.js: nvm ile v26.3.1
# Wrangler: kurulu, giriş yapıldı (alpomerozdemir@gmail.com)
# Git push: HTTPS + Personal Access Token (GitHub CLI kurulu değil, Homebrew yok)
# Deploy komutu (her zaman bu dizinden):
cd cloudflare-worker && wrangler deploy --config wrangler.toml
# Kök dizinden çalıştırma — wrangler.jsonc'yi bulur, yanlış worker'a deploy eder
```

## 10. Oturum Kuralı

Her oturumun başında:
1. Bu dosyayı yapıştır
2. "Bu oturumda sadece şunu yapacağız: [tek hedef]" de
3. Her adımda "neden bu yolu seçtin" diye sor
4. Kodu anlamadan onaylama
5. Oturum sonunda bu dosyayı güncelle
