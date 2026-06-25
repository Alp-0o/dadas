> Yeni oturum başında: CLAUDE.md otomatik okunur. PROGRESS.md'yi de oku ve güncel tut.

# RASAD — Proje Bağlam Belgesi

*Çekirdek mimari belgesi: `rasad_cekirdek_mimari_v1.md.docx` (yerel ~/Downloads — gizli, commit edilmedi)*

---

## 1. Projenin Özü

Rasad, jeopolitika/ekonomi/finans olayları arasındaki gizli bağlantıları AI yardımıyla ortaya çıkaran bir istihbarat platformu.

**Canlı site:** `alp-0o.github.io/dadas` | **Repo:** `github.com/Alp-0o/dadas` (public)
**Çalışma dizini:** `/Users/omeralpozdemir/Desktop/rasad`

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

## 7. Ortam

```bash
# Node.js: nvm v26.3.1 | Wrangler: kurulu, alpomerozdemir@gmail.com
# Git push: HTTPS + Personal Access Token
# Deploy: cd cloudflare-worker && wrangler deploy --config wrangler.toml
# KV cache temizleme: wrangler kv key delete "KEY" --binding RASAD_CACHE --config cloudflare-worker/wrangler.toml --remote
# Local preview: http://localhost:3333 (npx serve -l 3333 .)
```

---

## 8. Oturum Kuralı

1. Bu dosyayı yapıştır
2. "Bu oturumda sadece şunu yapacağız: [tek hedef]" de
3. Her adımda "neden bu yolu seçtin" diye sor
4. Kodu anlamadan onaylama
5. Oturum sonunda PROGRESS.md'yi güncelle + sıkıştır
