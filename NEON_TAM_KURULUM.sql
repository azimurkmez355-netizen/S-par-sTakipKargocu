/* ============================================================
   KargoTakip — TEK DOSYA TAM KURULUM (v8)
   ------------------------------------------------------------
   ⚠️ DİKKAT — GERİ ALINAMAZ: Bu script önce TÜM tabloları
   (kargolar, kullanıcılar, mesajlar, çıkış kayıtları — HER ŞEY)
   SİLER, sonra v8 QR sistemiyle tam uyumlu, eksiksiz haliyle
   sıfırdan yeniden oluşturur. Şu ana kadar eklediğiniz gerçek
   kargo kayıtları varsa bu script'i çalıştırdığınızda hepsi
   kaybolur.

   Bu üç eski dosyanın (NEON_TUMU_KURU_BASLATMA.sql,
   NEON_KURULUM_MESAJLAR.sql, NEON_KURULUM_QR_ETIKET.sql)
   aralarında küçük tutarsızlıklar vardı (ör. kargolar.qr_kod'un
   hangi dosyada eklendiği, kargo_cikis_kayitlari'nın iki farklı
   tanımı) — muhtemelen "column does not exist" hatanızın sebebi
   de bu, yani hangisinin/hangilerinin gerçekten çalıştığı belirsiz
   kalmış olması. Bundan sonra SADECE bu dosyayı kullanın.

   Neon Console > SQL Editor'e yapıştırıp RUN'a basın.
   ============================================================ */

DROP TABLE IF EXISTS kargo_cikis_kayitlari CASCADE;
DROP TABLE IF EXISTS mesaj_okuma_kayitlari CASCADE;
DROP TABLE IF EXISTS mesaj_talep_mesajlari CASCADE;
DROP TABLE IF EXISTS mesaj_talepleri CASCADE;
DROP TABLE IF EXISTS kargo_fotograflari CASCADE;
DROP TABLE IF EXISTS kargo_urunleri CASCADE;
DROP TABLE IF EXISTS kargolar CASCADE;
DROP TABLE IF EXISTS kullanicilar CASCADE;

-- ============================================================
-- 1. KULLANICILAR
-- ============================================================
CREATE TABLE kullanicilar (
  id BIGSERIAL PRIMARY KEY,
  ad_soyad TEXT NOT NULL,
  kullanici_adi TEXT UNIQUE NOT NULL,
  sifre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin', 'depo')),
  aktif BOOLEAN NOT NULL DEFAULT true,
  olusturma_tarihi TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. KARGOLAR (v8: qr_kod + etiket_foto_base64 + teslim_eden_* dahil)
-- ============================================================
CREATE TABLE kargolar (
  id BIGSERIAL PRIMARY KEY,
  alici_ad_soyad TEXT NOT NULL,
  kargo_firmasi TEXT NOT NULL,
  durum TEXT NOT NULL DEFAULT 'Paketlendi',
  ekleyen_kullanici_id BIGINT REFERENCES kullanicilar(id),
  olusturma_tarihi TIMESTAMPTZ NOT NULL DEFAULT now(),
  qr_kod TEXT,
  etiket_foto_base64 TEXT,
  cikis_tarihi TIMESTAMPTZ,
  teslim_eden_kullanici_id BIGINT REFERENCES kullanicilar(id),
  teslim_eden_adi TEXT
);

-- ============================================================
-- 3. KARGO URUNLERI
-- ============================================================
CREATE TABLE kargo_urunleri (
  id BIGSERIAL PRIMARY KEY,
  kargo_id BIGINT NOT NULL REFERENCES kargolar(id) ON DELETE CASCADE,
  urun_adi TEXT NOT NULL,
  sku TEXT, -- v8.10: artık formda gösterilmiyor/istenmiyor, ürün fotoğrafla tanımlanıyor
  adet INTEGER NOT NULL DEFAULT 1
);

-- ============================================================
-- 4. KARGO FOTOGRAFLARI (genel kargo fotoğrafları + ürün bazlı
--    fotoğraflar; etiket fotoğrafı ayrı olarak
--    kargolar.etiket_foto_base64'te tutulur)
-- ============================================================
CREATE TABLE kargo_fotograflari (
  id BIGSERIAL PRIMARY KEY,
  kargo_id BIGINT NOT NULL REFERENCES kargolar(id) ON DELETE CASCADE,
  kargo_urun_id BIGINT REFERENCES kargo_urunleri(id) ON DELETE CASCADE, -- v8.10: doluysa belirli bir ürüne ait; boşsa genel kargo fotoğrafı
  foto_base64 TEXT NOT NULL
);

-- ============================================================
-- 5. MESAJ TALEPLERI
-- ============================================================
CREATE TABLE mesaj_talepleri (
  id BIGSERIAL PRIMARY KEY,
  konu TEXT NOT NULL,
  aciliyet TEXT NOT NULL DEFAULT 'normal' CHECK (aciliyet IN ('normal', 'acil')),
  durum TEXT NOT NULL DEFAULT 'acik' CHECK (durum IN ('acik', 'kapali')),
  cevaplandi BOOLEAN NOT NULL DEFAULT false,
  olusturan_admin_id BIGINT REFERENCES kullanicilar(id) ON DELETE SET NULL,
  olusturma_tarihi TIMESTAMPTZ NOT NULL DEFAULT now(),
  kapanma_tarihi TIMESTAMPTZ
);

-- ============================================================
-- 6. MESAJ TALEP MESAJLARI
-- ============================================================
CREATE TABLE mesaj_talep_mesajlari (
  id BIGSERIAL PRIMARY KEY,
  talep_id BIGINT NOT NULL REFERENCES mesaj_talepleri(id) ON DELETE CASCADE,
  gonderen_kullanici_id BIGINT REFERENCES kullanicilar(id) ON DELETE SET NULL,
  gonderen_rol TEXT NOT NULL CHECK (gonderen_rol IN ('admin', 'depo')),
  icerik TEXT,
  foto_base64 TEXT,
  gonderim_tarihi TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 7. MESAJ OKUMA KAYITLARI
-- ============================================================
CREATE TABLE mesaj_okuma_kayitlari (
  id BIGSERIAL PRIMARY KEY,
  mesaj_id BIGINT NOT NULL REFERENCES mesaj_talep_mesajlari(id) ON DELETE CASCADE,
  kullanici_id BIGINT NOT NULL REFERENCES kullanicilar(id) ON DELETE CASCADE,
  okunma_tarihi TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mesaj_id, kullanici_id)
);

-- ============================================================
-- 8. KARGO CIKIS KAYITLARI (QR okutma / teslimat günlüğü)
-- ============================================================
CREATE TABLE kargo_cikis_kayitlari (
  id BIGSERIAL PRIMARY KEY,
  kargo_id BIGINT NOT NULL REFERENCES kargolar(id) ON DELETE CASCADE,
  kullanici_id BIGINT NOT NULL REFERENCES kullanicilar(id),
  okutma_tarihi TIMESTAMPTZ NOT NULL DEFAULT now(),
  cikis_notu TEXT
);

-- ============================================================
-- İNDEKSLER
-- ============================================================
CREATE INDEX idx_kargolar_ekleyen ON kargolar(ekleyen_kullanici_id);
CREATE UNIQUE INDEX kargolar_qr_kod_key ON kargolar(qr_kod) WHERE qr_kod IS NOT NULL;
CREATE INDEX idx_kargo_urunleri_kargo_id ON kargo_urunleri(kargo_id);
CREATE INDEX idx_kargo_fotograflari_kargo_id ON kargo_fotograflari(kargo_id);
CREATE INDEX idx_mesaj_talep_mesajlari_talep_id ON mesaj_talep_mesajlari(talep_id);
CREATE INDEX idx_mesaj_okuma_kayitlari_mesaj_id ON mesaj_okuma_kayitlari(mesaj_id);
CREATE INDEX idx_mesaj_talepleri_durum_aciliyet ON mesaj_talepleri(durum, aciliyet, cevaplandi);
CREATE INDEX idx_kargo_cikis_kayitlari_kargo_id ON kargo_cikis_kayitlari(kargo_id);
CREATE INDEX idx_kargo_cikis_kayitlari_tarih ON kargo_cikis_kayitlari(okutma_tarihi);

-- ============================================================
-- TEST KULLANICILARI
-- ============================================================
INSERT INTO kullanicilar (ad_soyad, kullanici_adi, sifre, rol, aktif) VALUES
  ('Admin Kullanıcı', 'admin', 'admin123', 'admin', true),
  ('Admin 2', 'admin2', '1234', 'admin', true),
  ('Ahmet Demir', 'depo1', 'depo123', 'depo', true),
  ('Fatma Yılmaz', 'depo2', 'depo456', 'depo', true);

-- ============================================================
-- POSTGREST (DATA API) İZİNLERİ — anonim role tam CRUD
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON kullanicilar TO anonymous;
GRANT SELECT, INSERT, UPDATE, DELETE ON kargolar TO anonymous;
GRANT SELECT, INSERT, UPDATE, DELETE ON kargo_urunleri TO anonymous;
GRANT SELECT, INSERT, UPDATE, DELETE ON kargo_fotograflari TO anonymous;
GRANT SELECT, INSERT, UPDATE, DELETE ON mesaj_talepleri TO anonymous;
GRANT SELECT, INSERT, UPDATE, DELETE ON mesaj_talep_mesajlari TO anonymous;
GRANT SELECT, INSERT, UPDATE, DELETE ON mesaj_okuma_kayitlari TO anonymous;
GRANT SELECT, INSERT, UPDATE, DELETE ON kargo_cikis_kayitlari TO anonymous;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anonymous;

-- ============================================================
-- KONTROL — çalıştırdıktan sonra aşağıdakileri görmelisiniz
-- ============================================================
SELECT 'Tablolar sıfırdan, v8 ile uyumlu şekilde oluşturuldu.' AS status;
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
SELECT column_name FROM information_schema.columns WHERE table_name = 'kargolar' ORDER BY ordinal_position;
SELECT ad_soyad, kullanici_adi, rol FROM kullanicilar ORDER BY id;
