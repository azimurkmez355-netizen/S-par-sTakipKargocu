/* ============================================================
   KargoTakip — "Mesajlar" özelliği için ek tablolar
   Bu dosyayı Neon Console > SQL Editor içinde bir kez çalıştırın.
   (Mevcut kullanicilar / kargolar tablolarına dokunmaz, sadece
   yeni tablolar ekler.)
   ============================================================ */

CREATE TABLE IF NOT EXISTS mesaj_talepleri (
  id BIGSERIAL PRIMARY KEY,
  konu TEXT NOT NULL,
  aciliyet TEXT NOT NULL DEFAULT 'normal' CHECK (aciliyet IN ('normal', 'acil')),
  durum TEXT NOT NULL DEFAULT 'acik' CHECK (durum IN ('acik', 'kapali')),
  cevaplandi BOOLEAN NOT NULL DEFAULT false,
  olusturan_admin_id BIGINT REFERENCES kullanicilar(id) ON DELETE SET NULL,
  olusturma_tarihi TIMESTAMPTZ NOT NULL DEFAULT now(),
  kapanma_tarihi TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mesaj_talep_mesajlari (
  id BIGSERIAL PRIMARY KEY,
  talep_id BIGINT NOT NULL REFERENCES mesaj_talepleri(id) ON DELETE CASCADE,
  gonderen_kullanici_id BIGINT REFERENCES kullanicilar(id) ON DELETE SET NULL,
  gonderen_rol TEXT NOT NULL CHECK (gonderen_rol IN ('admin', 'depo')),
  icerik TEXT,
  foto_base64 TEXT,
  gonderim_tarihi TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mesaj_okuma_kayitlari (
  id BIGSERIAL PRIMARY KEY,
  mesaj_id BIGINT NOT NULL REFERENCES mesaj_talep_mesajlari(id) ON DELETE CASCADE,
  kullanici_id BIGINT NOT NULL REFERENCES kullanicilar(id) ON DELETE CASCADE,
  okunma_tarihi TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mesaj_id, kullanici_id)
);

CREATE INDEX IF NOT EXISTS idx_mesaj_talep_mesajlari_talep_id ON mesaj_talep_mesajlari (talep_id);
CREATE INDEX IF NOT EXISTS idx_mesaj_okuma_kayitlari_mesaj_id ON mesaj_okuma_kayitlari (mesaj_id);
CREATE INDEX IF NOT EXISTS idx_mesaj_talepleri_durum_aciliyet ON mesaj_talepleri (durum, aciliyet, cevaplandi);

/* ============================================================
   v5: Kargo Çıkışı Kaydı Tablosu (QR Okutma ve Teslim Onayı)
   ============================================================ */

CREATE TABLE IF NOT EXISTS kargo_cikis_kayitlari (
  id BIGSERIAL PRIMARY KEY,
  kargo_id BIGINT NOT NULL REFERENCES kargolar(id) ON DELETE CASCADE,
  kullanici_id BIGINT NOT NULL REFERENCES kullanicilar(id) ON DELETE SET NULL,
  okutma_tarihi TIMESTAMPTZ NOT NULL DEFAULT now(),
  cikis_notu TEXT,
  CONSTRAINT unique_kargo_cikis UNIQUE (kargo_id, okutma_tarihi)
);

CREATE INDEX IF NOT EXISTS idx_kargo_cikis_kayitlari_kargo_id ON kargo_cikis_kayitlari (kargo_id);
CREATE INDEX IF NOT EXISTS idx_kargo_cikis_kayitlari_kullanici_id ON kargo_cikis_kayitlari (kullanici_id);
CREATE INDEX IF NOT EXISTS idx_kargo_cikis_kayitlari_tarih ON kargo_cikis_kayitlari (okutma_tarihi);

/* Kargo Tablosuna QR Kod ve Çıkış Tarihi Alanları Ekle */
ALTER TABLE kargolar ADD COLUMN IF NOT EXISTS qr_kod TEXT;
ALTER TABLE kargolar ADD COLUMN IF NOT EXISTS cikis_tarihi TIMESTAMPTZ;

/* Data API (PostgREST) anonim rolüne, projedeki diğer tablolarla
   aynı şekilde tam CRUD izni ver. */
GRANT SELECT, INSERT, UPDATE, DELETE ON mesaj_talepleri TO anonymous;
GRANT SELECT, INSERT, UPDATE, DELETE ON mesaj_talep_mesajlari TO anonymous;
GRANT SELECT, INSERT, UPDATE, DELETE ON mesaj_okuma_kayitlari TO anonymous;
GRANT SELECT, INSERT, UPDATE, DELETE ON kargo_cikis_kayitlari TO anonymous;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anonymous;
