/* ============================================================
   KargoTakip v5 — FULL KURULUM (Tüm Tablolar + Test Verisi)
   Bu dosyayı Neon Console > SQL Editor'de ÇALIŞTIRINIZ
   ============================================================ */

-- 1. KULLANICILAR TABLOSU
CREATE TABLE IF NOT EXISTS kullanicilar (
  id BIGSERIAL PRIMARY KEY,
  ad_soyad TEXT NOT NULL,
  kullanici_adi TEXT UNIQUE NOT NULL,
  sifre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin', 'depo')),
  aktif BOOLEAN DEFAULT true,
  olusturma_tarihi TIMESTAMPTZ DEFAULT now()
);

-- 2. KARGOLAR TABLOSU
CREATE TABLE IF NOT EXISTS kargolar (
  id BIGSERIAL PRIMARY KEY,
  alici_ad_soyad TEXT NOT NULL,
  kargo_firmasi TEXT NOT NULL,
  durum TEXT DEFAULT 'Paketlendi',
  ekleyen_kullanici_id BIGINT REFERENCES kullanicilar(id),
  olusturma_tarihi TIMESTAMPTZ DEFAULT now(),
  qr_kod TEXT,
  cikis_tarihi TIMESTAMPTZ
);

-- 3. KARGO URUNLERI TABLOSU
CREATE TABLE IF NOT EXISTS kargo_urunleri (
  id BIGSERIAL PRIMARY KEY,
  kargo_id BIGINT NOT NULL REFERENCES kargolar(id) ON DELETE CASCADE,
  urun_adi TEXT NOT NULL,
  sku TEXT NOT NULL
);

-- 4. KARGO FOTOGRAFLARI TABLOSU
CREATE TABLE IF NOT EXISTS kargo_fotograflari (
  id BIGSERIAL PRIMARY KEY,
  kargo_id BIGINT NOT NULL REFERENCES kargolar(id) ON DELETE CASCADE,
  foto_base64 TEXT NOT NULL
);

-- 5. MESAJ TALEPLERI TABLOSU
CREATE TABLE IF NOT EXISTS mesaj_talepleri (
  id BIGSERIAL PRIMARY KEY,
  konu TEXT NOT NULL,
  aciliyet TEXT DEFAULT 'normal' CHECK (aciliyet IN ('normal', 'acil')),
  durum TEXT DEFAULT 'acik' CHECK (durum IN ('acik', 'kapali')),
  cevaplandi BOOLEAN DEFAULT false,
  olusturan_admin_id BIGINT REFERENCES kullanicilar(id),
  olusturma_tarihi TIMESTAMPTZ DEFAULT now(),
  kapanma_tarihi TIMESTAMPTZ
);

-- 6. MESAJ TALEP MESAJLARI TABLOSU
CREATE TABLE IF NOT EXISTS mesaj_talep_mesajlari (
  id BIGSERIAL PRIMARY KEY,
  talep_id BIGINT NOT NULL REFERENCES mesaj_talepleri(id) ON DELETE CASCADE,
  gonderen_kullanici_id BIGINT REFERENCES kullanicilar(id),
  gonderen_rol TEXT NOT NULL CHECK (gonderen_rol IN ('admin', 'depo')),
  icerik TEXT,
  foto_base64 TEXT,
  gonderim_tarihi TIMESTAMPTZ DEFAULT now()
);

-- 7. MESAJ OKUMA KAYITLARI TABLOSU
CREATE TABLE IF NOT EXISTS mesaj_okuma_kayitlari (
  id BIGSERIAL PRIMARY KEY,
  mesaj_id BIGINT NOT NULL REFERENCES mesaj_talep_mesajlari(id) ON DELETE CASCADE,
  kullanici_id BIGINT NOT NULL REFERENCES kullanicilar(id) ON DELETE CASCADE,
  okunma_tarihi TIMESTAMPTZ DEFAULT now(),
  UNIQUE (mesaj_id, kullanici_id)
);

-- 8. KARGO CIKIS KAYITLARI TABLOSU (v5)
CREATE TABLE IF NOT EXISTS kargo_cikis_kayitlari (
  id BIGSERIAL PRIMARY KEY,
  kargo_id BIGINT NOT NULL REFERENCES kargolar(id) ON DELETE CASCADE,
  kullanici_id BIGINT NOT NULL REFERENCES kullanicilar(id),
  okutma_tarihi TIMESTAMPTZ DEFAULT now(),
  cikis_notu TEXT
);

-- ============================================================
-- İNDEKSLER
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_kargolar_ekleyen ON kargolar(ekleyen_kullanici_id);
CREATE INDEX IF NOT EXISTS idx_kargo_urunleri_kargo_id ON kargo_urunleri(kargo_id);
CREATE INDEX IF NOT EXISTS idx_kargo_fotograflari_kargo_id ON kargo_fotograflari(kargo_id);
CREATE INDEX IF NOT EXISTS idx_mesaj_talep_mesajlari_talep_id ON mesaj_talep_mesajlari(talep_id);
CREATE INDEX IF NOT EXISTS idx_mesaj_okuma_kayitlari_mesaj_id ON mesaj_okuma_kayitlari(mesaj_id);
CREATE INDEX IF NOT EXISTS idx_kargo_cikis_kayitlari_kargo_id ON kargo_cikis_kayitlari(kargo_id);
CREATE INDEX IF NOT EXISTS idx_kargo_cikis_kayitlari_tarih ON kargo_cikis_kayitlari(okutma_tarihi);

-- ============================================================
-- TEST KULLANICILARI EKLE
-- ============================================================
DELETE FROM kullanicilar WHERE kullanici_adi IN ('admin', 'depo1', 'depo2', 'admin2');

INSERT INTO kullanicilar (ad_soyad, kullanici_adi, sifre, rol, aktif)
VALUES 
  ('Admin Kullanıcı', 'admin', 'admin123', 'admin', true),
  ('Admin 2', 'admin2', '1234', 'admin', true),
  ('Ahmet Demir', 'depo1', 'depo123', 'depo', true),
  ('Fatma Yılmaz', 'depo2', 'depo456', 'depo', true)
ON CONFLICT (kullanici_adi) DO NOTHING;

-- ============================================================
-- PostgREST İZİNLERİ (ÇIKIS için)
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
-- KONTROL SORGUSU (Çalıştıktan sonra aşağıdaki sonucu görmelisin)
-- ============================================================
SELECT 'Tablolar oluşturuldu' as status;
SELECT COUNT(*) as kullanici_sayisi FROM kullanicilar;
SELECT ad_soyad, kullanici_adi, rol FROM kullanicilar ORDER BY id;
