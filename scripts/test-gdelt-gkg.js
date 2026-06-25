#!/usr/bin/env node
// Test: son GDELT GKG dosyasını storage.googleapis.com'dan çek, ZIP aç, Russia/Ukraine filtrele

const https = require('https');
const zlib  = require('zlib');

// Son tamamlanmış 15-dakika bloğunun timestamp'ini döner (ör. "20260625013000")
function lastGkgTimestamp(offsetBlocks = 1) {
  const now = new Date();
  const block = Math.floor(now.getUTCMinutes() / 15) * 15;
  const d = new Date(now);
  d.setUTCMinutes(block - offsetBlocks * 15, 0, 0);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, buffer: Buffer.concat(chunks) }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ZIP local file header parse — GDELT dosyaları tek entry içerir
function unzipFirst(buf) {
  const sig = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
  const off = buf.indexOf(sig);
  if (off === -1) throw new Error('ZIP local file header bulunamadı');

  const method         = buf.readUInt16LE(off + 8);
  const compressedSize = buf.readUInt32LE(off + 18);
  const fnLen          = buf.readUInt16LE(off + 26);
  const exLen          = buf.readUInt16LE(off + 28);
  const dataStart      = off + 30 + fnLen + exLen;
  const compressed     = buf.slice(dataStart, dataStart + compressedSize);

  if (method === 0) return compressed;               // stored
  if (method === 8) return zlib.inflateRawSync(compressed); // deflate
  throw new Error(`Desteklenmeyen sıkıştırma metodu: ${method}`);
}

// GKG 2.0 tab-separated field indeksleri
const F = {
  ID:       0,  // GKGRECORDID
  DATE:     1,  // DATE
  URL:      4,  // DocumentIdentifier
  THEMES:   7,  // Themes
  LOCS:     9,  // Locations
  PERSONS:  12, // V2Persons
  ORGS:     14, // V2Organizations
  TONE:     15, // V1Tone
};

async function main() {
  // 1 önceki bloğu dene, 404 gelirse 2 öncekine geç
  let buffer, ts;
  for (let offset = 1; offset <= 4; offset++) {
    ts = lastGkgTimestamp(offset);
    const url = `https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/${ts}.gkg.csv.zip`;
    console.log(`[${offset}] Deneniyor: ${url}`);
    const t0 = Date.now();
    const res = await fetchBuffer(url);
    console.log(`    → HTTP ${res.statusCode} | ${(res.buffer.length/1024/1024).toFixed(2)} MB | ${Date.now()-t0}ms`);
    if (res.statusCode === 200) { buffer = res.buffer; break; }
  }
  if (!buffer) { console.error('Dosya bulunamadı'); process.exit(1); }

  // ZIP aç
  console.log('\nZIP açılıyor...');
  const t1 = Date.now();
  const memBefore = process.memoryUsage().heapUsed;
  const csv = unzipFirst(buffer).toString('utf8');
  const memAfter  = process.memoryUsage().heapUsed;
  console.log(`Açma süresi: ${Date.now()-t1}ms | Açık boyut: ${(csv.length/1024/1024).toFixed(2)} MB`);
  console.log(`Heap delta: +${((memAfter-memBefore)/1024/1024).toFixed(1)} MB`);

  // Satır say ve filtrele
  const lines = csv.split('\n').filter(l => l.trim());
  console.log(`\nToplam satır: ${lines.length}`);

  // Locations alanı (index 9) içinde ülke-düzeyi entry'lere bak:
  // Format: "1#Russia#RS#RS#..." veya "1#Ukraine#UP#UP#..."
  // type=1 → ülke; "#Russia#" veya "#Ukraine#" country name kısmına denk gelir
  const filtered = lines.filter(l => {
    const fields = l.split('\t');
    const locs = fields[9] || '';
    return /\b1#Russia#/i.test(locs) || /\b1#Ukraine#/i.test(locs);
  });
  console.log(`Russia/Ukraine (Locations ülke kodu) içeren satır: ${filtered.length} (%${((filtered.length/lines.length)*100).toFixed(1)})\n`);

  // İlk 3 eşleşen satırdan özet
  console.log('=== Örnek 3 satır (özet) ===');
  filtered.slice(0, 3).forEach((row, i) => {
    const f = row.split('\t');
    const locs = f[F.LOCS] || '';
    // Hangi loc girişi eşleşti göster
    const matchedLoc = locs.split(';').find(e => /\b1#Russia#/i.test(e) || /\b1#Ukraine#/i.test(e)) || '(bulunamadı)';
    console.log(`\n--- Satır ${i+1} ---`);
    console.log(`  URL         : ${(f[F.URL]  || '').slice(0, 100)}`);
    console.log(`  Themes      : ${(f[F.THEMES] || '').split(';').slice(0, 5).join('; ')}`);
    console.log(`  Eşleşen Loc : ${matchedLoc.trim()}`);
    console.log(`  Tone        : ${(f[F.TONE]   || '').split(',').slice(0, 3).join(', ')}`);
  });

  console.log('\n=== Özet ===');
  console.log(`Zaman damgası : ${ts}`);
  console.log(`ZIP boyutu    : ${(buffer.length/1024/1024).toFixed(2)} MB`);
  console.log(`CSV boyutu    : ${(csv.length/1024/1024).toFixed(2)} MB`);
  console.log(`Toplam satır  : ${lines.length}`);
  console.log(`Filtrelenmiş  : ${filtered.length}`);
  console.log(`Heap delta    : +${((memAfter-memBefore)/1024/1024).toFixed(1)} MB`);
}

main().catch(err => { console.error(err); process.exit(1); });
