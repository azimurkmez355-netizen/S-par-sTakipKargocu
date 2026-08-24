# KargoTakip v5 - Sürüm Notları

## ✨ Yeni Özellikler

### 1. **Orijinal Tema Renkleri** 🎨
- **Yeni Renk Paleti**: İndigo (#6366F1), Pembe (#EC4899), Yeşil (#10B981), Turkuaz (#06B6D4)
- Modern ve profesyonel görünüm
- `css/style-v5.css` dosyasında tanımlanmıştır
- Tüm bileşenlerde uygulanmıştır

### 2. **Şifre Göster/Gizle İkonu** 👁️
- Login ekranında şifre alanında göster/gizle butonu
- `js/auth.js` içinde `initPasswordToggle()` fonksiyonu
- Kullanıcı dostu erişim

### 3. **Otomatik QR Kod Üretimi** 📱
- Her kargoya otomatik QR kod oluşturma
- Google Charts API kullanarak gerçek QR kodlar
- `js/qrcode-handler.js` modülü ile merkezi yönetim
- Kargo kartlarına QR kod embed edilir

### 4. **Kargo Çıkışı Sayfası** 🚚
**Yalnızca Depo Görevlilerine Özel Sayfadır**

#### Özellikler:
- **QR Kod Okutma**: Depo görevlisi QR kodunu okutarak kargı teslimatını onaylar
- **Otomatik Teslimat Onayı**: Okutma anında durum "Teslim Edildi" olur
- **Gün Seçimi ve Filtreleme**: Tarih seçerek o güne ait kargıları görebilir
- **Çıkış Günlüğü**: Her gün okutulmuş kargıların kaydı
- **İstatistikler**: Toplam okutuldu, teslim edildi, beklemede sayıları
- **Timestamp Kaydı**: Her okutmanın tarihi ve saati kaydedilir

#### Kullanım:
1. Sidebar'dan "Kargo Çıkışı" sayfasına git
2. QR kod okut butonu ya da metin giriş alanına QR kodu yapıştır
3. Otomatik olarak "Teslim Edildi" statüsü verilir
4. Tarih seçerek gün bazlı filtreleme yap

### 5. **Gün Gün Takip Sistemi** 📅
- Her okutmanın tarihi kaydedilir
- `kargo_cikis_kayitlari` tablosunda saklanır
- Tarih filtrelemesiyle gün bazlı raporlama
- Admin ve Depo Görevlisi panellerinde görünür

### 6. **Admin Panelinde Teslimat Görünürlüğü** 👨‍💼
- Tüm kargılar kargo çıkışı sayfasından teslim edildikçe güncellenir
- Admin "Tüm Kargolar" bölümünde teslim edilenleri görebilir
- Durum filtrelemesi ile sadece teslim edilenleri görüntüle

### 7. **Mesaj Kutusu İyileştirmesi** 💬
- Chat input'ı devre dışı kalma sorunu düzeltme
- `css/style-v5.css` içinde yeni stil kuralları
- Sürekli odaklanabilirlik

## 📁 Yeni/Değişmiş Dosyalar

```
js/
  ├── qrcode-handler.js      (YENİ)
  ├── config.js              (GÜNCELLENDI - Tema ve QR ayarları)
  ├── auth.js                (GÜNCELLENDI - Şifre göster/gizle)
  ├── depo.js                (GÜNCELLENDI - Kargo Çıkışı sayfası)
  ├── main.js                (KOD BAŞVURUSU - QR embed)

css/
  ├── style-v5.css           (YENİ - v5 stili)

SQL/
  ├── NEON_KURULUM_MESAJLAR.sql (GÜNCELLENDI - Kargo çıkışı tablosu)
```

## 🗄️ Yeni SQL Tablosu

### `kargo_cikis_kayitlari`
```sql
id                BIGSERIAL PRIMARY KEY
kargo_id          BIGINT (kargolar.id referans)
kullanici_id      BIGINT (kullanicilar.id referans)
okutma_tarihi     TIMESTAMPTZ
cikis_notu        TEXT (opsiyonel)
```

### `kargolar` Sütun Ekleri
- `qr_kod TEXT` - Kargo QR kodu
- `cikis_tarihi TIMESTAMPTZ` - Çıkış zamanı

## 🚀 Kurulum

1. **SQL Tablolarını Oluştur**:
   - `NEON_KURULUM_MESAJLAR.sql` dosyasını Neon Console'da çalıştır
   - Yeni tabloları ve indeksleri oluştur

2. **CSS Dosyasını Ekle**:
   - `css/style-v5.css` otomatik `index.html`'de yüklenir

3. **QR Kütüphanesini Etkinleştir**:
   - `js/qrcode-handler.js` otomatik yüklenir

4. **Depo.js Güncelle**:
   - Kargo Çıkışı sayfası otomatik nav'da görünür

## 🔧 Teknik Detaylar

### QR Kod Format
- **Kargo QR**: `kargo:{kargoId}`
- **Ürün QR**: `kargo:{kargoId}:urun:{urunId}`
- Base64 encoding ile güvenli aktarım

### API Çağrıları
```javascript
// Kargo çıkış kaydı oluştur
Api.insert("kargo_cikis_kayitlari", {
  kargo_id: id,
  kullanici_id: userId,
  okutma_tarihi: new Date().toISOString()
});

// Kargı durumunu güncelle
Api.update("kargolar", 
  { durum: "Teslim Edildi", cikis_tarihi: timestamp },
  `id=eq.${id}`
);
```

## 🎯 Uyarılar

⚠️ **Google Charts QR API Kullanımı**:
- İnternet bağlantısı gerekli
- Google API'ye bağımlı
- Alternatif: `jsQR` kütüphanesi kurulabilir

⚠️ **Mobil Kamera Erişimi**:
- Gerçek QR tarama için HTTPS gerekli
- Şu an manual text input ile çalışıyor
- Gelecekte HTML5 Media API entegrasyonu yapılabilir

## 📊 v5 İyileştirme Özeti

| Özellik | Status | Açıklama |
|---------|--------|----------|
| Orijinal Tema | ✅ | 8 renk paleti |
| Şifre Göster | ✅ | Login screen |
| QR Üretimi | ✅ | Google Charts |
| Kargo Çıkışı | ✅ | Depo özel sayfası |
| Gün Seçimi | ✅ | Date filter |
| İstatistikler | ✅ | Summaries |
| Chat Fix | ✅ | CSS iyileştirmesi |

## 🚪 Sonraki Adımlar (v6+)

- [ ] Gerçek QR kod kütüphanesi entegrasyonu (jsQR)
- [ ] HTML5 kamera API ile canlı QR tarama
- [ ] Toplu çıkış işlemi (batch export)
- [ ] Çıkış raporları (PDF/Excel)
- [ ] Kargo takibi SMS/Email bildirimleri
- [ ] Dashboard grafikler
- [ ] Multi-user kargo paylaşımı

---

**Versiyon**: v5  
**Tarih**: 2026-08-16  
**Geliştirici**: KargoTakip Team
