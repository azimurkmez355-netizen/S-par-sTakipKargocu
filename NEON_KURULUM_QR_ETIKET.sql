/* ============================================================
   KargoTakip v8 — Kargo Etiketi QR Sistemi (KURULUM)
   Bu dosyayı Neon Console > SQL Editor'de ÇALIŞTIRINIZ.
   Var olan verilere DOKUNMAZ, sadece yeni kolon/indeks ekler.
   ============================================================ */

-- 1. Etiket fotoğrafı (kargo_fotograflari'ndaki genel ürün fotoğraflarından
--    ayrı — her kargoda tek ve zorunlu olan kargo etiketi görseli).
ALTER TABLE kargolar ADD COLUMN IF NOT EXISTS etiket_foto_base64 TEXT;

-- 2. Teslimatı kimin/ne zaman okuttuğu (mevcut cikis_tarihi "ne zaman"ı
--    zaten karşılıyor, burada sadece "kim" ekleniyor).
ALTER TABLE kargolar ADD COLUMN IF NOT EXISTS teslim_eden_kullanici_id BIGINT REFERENCES kullanicilar(id);
ALTER TABLE kargolar ADD COLUMN IF NOT EXISTS teslim_eden_adi TEXT;

-- 3. Var olan ama kullanılmayan qr_kod kolonu artık etiketten okunan QR
--    değerini tutuyor. Aynı QR iki kargoya kaydedilemesin diye tekil
--    indeks (NULL'lara dokunmaz, eski kayıtlar etkilenmez).
CREATE UNIQUE INDEX IF NOT EXISTS kargolar_qr_kod_key ON kargolar(qr_kod) WHERE qr_kod IS NOT NULL;

-- Not: Yeni GRANT gerekmiyor — NEON_TUMU_KURU_BASLATMA.sql'deki
-- "GRANT ... ON kargolar TO anonymous" tablo seviyesinde olduğu için
-- yeni kolonları da otomatik kapsıyor.

-- ============================================================
-- KONTROL SORGUSU
-- ============================================================
SELECT column_name FROM information_schema.columns
WHERE table_name = 'kargolar'
  AND column_name IN ('etiket_foto_base64', 'teslim_eden_kullanici_id', 'teslim_eden_adi', 'qr_kod');
