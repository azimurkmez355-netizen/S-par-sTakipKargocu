# KargoTakip V8 — Değişiklik Notları

Bu sürüm kendi ürettiğimiz sahte QR sistemini (`kargo:{id}`) tamamen
kaldırıp, kargo firmasının **gerçek** etiketindeki QR kodu okuyan bir
sisteme geçiyor. Ayrıca depo görevlilerine "Tüm Kargolar" ekranı ve
kart üzerinde "kim teslim etti" bilgisi eklendi.

## v8.1 düzeltmesi — asıl sorun "QR" değil Data Matrix'miş

Canlı denemede etiketler hiç okunmadı. İncelenen örnek etiket
fotoğraflarında klasik QR'ın üç köşe "gözü" (iç içe kareler) yoktu —
bu desen, kargo firmalarının etiketlerde sıklıkla kullandığı **Data
Matrix** formatına işaret ediyor. `jsQR` sadece ISO 18004 QR okuyabilen
bir kütüphane olduğu için bu etiketleri hiçbir çözünürlükte okuyamazdı.

Çözüm: `js/vendor/jsqr.js` kaldırıldı, yerine `js/vendor/zxing.js`
(@zxing/library) vendor edildi — QR + Data Matrix + Aztec + PDF417 +
yaygın 1D barkodları tek okuyucuda deniyor, format önceden bilinmese
de otomatik tanıyor. `js/qr-scanner.js`'in dış API'si (decodeFromImageFile/
startLive/stopLive/resumeLive) değişmedi, sadece iç okuma motoru
değişti — `depo.js` tarafında herhangi bir değişiklik gerekmedi.
Ayrıca canlı taramada kameranın TÜM geniş karesi yerine, kullanıcının
ekranda gerçekten gördüğü orta-kare bölge kırpılıp taranıyor (önceki
düzeltme) ve canlı format kümesi sadece QR+Data Matrix'e daraltılarak
(hız için) tutuldu; etiket yüklemede tüm formatlar + TRY_HARDER ile
en yüksek doğruluk hedefleniyor.

Yerelde hem sentetik Data Matrix hem QR test görselleriyle
(`bwip-js` ile üretilip gerçek uygulama modülü üzerinden) doğrulandı.
Gerçek termal yazıcı etiketleri üzerinde nihai doğrulama kullanıcının
kendi cihazında yapılmalı.

## v8.2 düzeltmesi — üç ayrı SQL dosyası tek dosyada birleştirildi

`NEON_TUMU_KURU_BASLATMA.sql`, `NEON_KURULUM_MESAJLAR.sql` ve
`NEON_KURULUM_QR_ETIKET.sql` arasında küçük tutarsızlıklar vardı
(ör. `kargo_cikis_kayitlari`'nın iki farklı tanımı) ve hangisinin
gerçekten çalıştırıldığı zamanla belirsizleşti — sonuçta canlı
ortamda `etiket_foto_base64` kolonu hiç oluşmamış, kargo kaydı API
hatasıyla başarısız oluyordu. Üçü de silindi, yerine **tek** dosya
geldi: `NEON_TAM_KURULUM.sql`. Bu dosya önce tüm tabloları siler,
sonra v8 ile tam uyumlu haliyle sıfırdan kurar (mevcut veriler
silinir — bilinçli bir sıfırlama, kullanıcının isteği üzerine).
Bundan sonra şema değişikliği gerektiğinde bu dosya güncellenip
tekrar çalıştırılmalı; ayrı ayrı ALTER TABLE dosyaları eklenmemeli.

## 1) Kaldırılan eski QR sistemi

`js/vendor/qrcode.js` (QR **üretici** kütüphane) ve `js/qrcode-handler.js`
tamamen silindi. Bunlar `kargo:{id}` gibi kendi uydurduğumuz bir kodu
SVG olarak gösteriyordu — gerçek kargo etiketiyle hiçbir ilgisi yoktu.
Her kartta duran "QR Kodu Göster" butonu da onunla birlikte kalktı.

## 2) Yeni QR sistemi — etiketten okuma + canlı tarama

- `js/vendor/jsqr.js` — cozmo/jsQR (MIT, bağımlılıksız, tamamen yerel
  çalışan QR **okuyucu** kütüphane) vendor edildi.
- `js/qr-scanner.js` (YENİ, `qrcode-handler.js`'in yerine geçti) —
  `QrScanner` modülü:
  - `decodeFromImageFile(file)`: bir fotoğraftan QR okur (Yeni Kargo
    Ekle formundaki etiket yüklemede kullanılır).
  - `startLive(video, onDetect)` / `stopLive()` / `resumeLive()`:
    arka kamerayı açıp sürekli QR arayan canlı tarayıcı (Kargo Çıkışı
    ekranında kullanılır). Sekme arka plana alınınca veya başka bir
    ekrana geçilince kamera otomatik kapanır.

## 3) Yeni Kargo Ekle — zorunlu "Kargo Etiketi (QR)" adımı

Depo görevlisi artık kargonun üzerindeki gerçek etiketin fotoğrafını
çekip yüklüyor (mobilde kamera doğrudan açılır). Sistem anında QR'ı
okumaya çalışır:
- Okunursa: yeşil onay + küçük önizleme gösterilir, kargo bu QR ile
  kaydedilir (`kargolar.qr_kod`, etiket görseli `etiket_foto_base64`).
- Okunamazsa: kırmızı hata gösterilir, aynı adımdan tekrar fotoğraf
  yüklenebilir. QR okunmadan kargo **kaydedilemez**.
- Aynı QR başka bir kargoda zaten kayıtlıysa (veritabanındaki tekil
  indeks sayesinde), dostça bir hata mesajı gösterilir.

## 4) Kargo Çıkışı — gerçek canlı kamera taraması

Eskiden "Kameradan Oku" butonu sadece `prompt()` açıyordu, gerçekte
çalışmıyordu. Artık ekrana girilince kamera **otomatik** açılıyor;
görevli dosya seçmiyor. QR okununca sistem `qr_kod` alanına göre
eşleşen kargoyu arar:
- Eşleşme yoksa → hata.
- Eşleşme var ve zaten "Teslim Edildi" ise → "zaten teslim edildi,
  kim/ne zaman" bilgisiyle uyarı (veritabanına tekrar yazmaz).
- Eşleşme var ve bekliyorsa → "Teslim Edildi" olarak işaretlenir,
  kim/ne zaman okuttuğu kaydedilir. (İki görevli aynı anda aynı QR'ı
  okutursa, sadece biri işaretler — koşullu güncelleme ile yarış
  durumu engellendi.)

Kamera açılmazsa (izin verilmezse), mevcut manuel metin kutusu her
zaman yedek olarak kullanılabilir durumda kalıyor.

## 5) Depo görevlileri için yeni "Tüm Kargolar" ekranı

Admin'deki "Tüm Kargolar" ekranının salt-okunur bir eşi artık depo
görevlilerinde de var: tüm görevlilerin eklediği tüm kargolar, kimin
eklediği bilgisiyle birlikte görülebiliyor, aynı filtre çubuğuyla
(arama/durum/firma) süzülebiliyor. Toplu silme / toplu teslim gibi
admin'e özel işlemler bu ekranda yok — sadece görünürlük eklendi.
Filtre çubuğu ve filtreleme mantığı artık `App.renderKargoFilterBar` /
`App.bindKargoFilterBar` / `App.filterKargolar` olarak ortak (`main.js`),
admin ve depo ekranları aynı kodu kullanıyor.

Depo görevlileri artık kendi eklemedikleri bir kargoyu da (Kargo
Çıkışı'ndan QR okutarak) teslim edebiliyor — bu zaten mevcuttu, QR
eşleştirmesi id yerine `qr_kod` alanına göre yapılacak şekilde
güncellendi.

## 6) Kargo kartlarında "teslim eden" bilgisi

Bir kargo teslim edildiğinde, kartın en altında kim tarafından ve ne
zaman teslim edildiği görünüyor (Kargolarım, Tüm Kargolar — hem admin
hem depo, Genel Bakış dahil her yerde, çünkü bu ortak `App.kargoCard`
bileşeninde). Admin'in kendi manuel "Teslim Edildi" butonu da artık
bu bilgiyi dolduruyor.

## 7) Veritabanı değişikliği

`NEON_KURULUM_QR_ETIKET.sql` (YENİ, Neon Console'da elle çalıştırılmalı):
- `kargolar.etiket_foto_base64` (yeni kolon) — etiket fotoğrafı.
- `kargolar.teslim_eden_kullanici_id`, `kargolar.teslim_eden_adi`
  (yeni kolonlar) — kim teslim etti.
- Var olan ama kullanılmayan `kargolar.qr_kod` kolonu artık aktif
  kullanılıyor; tekrar kullanılmasını engellemek için tekil indeks
  eklendi (`kargolar_qr_kod_key`, NULL'lara dokunmuyor — eski kayıtlar
  etkilenmiyor). Yeni GRANT gerekmedi, tablo seviyesindeki mevcut
  izinler yeni kolonları da kapsıyor.

---
Değişen/eklenen dosyalar:
  YENİ  : js/vendor/jsqr.js, js/qr-scanner.js, css/style-v8.css,
          NEON_KURULUM_QR_ETIKET.sql, V8_NOTES.md
  SİLİNDİ: js/vendor/qrcode.js, js/qrcode-handler.js
  DÜZEN : index.html (script/CSS bağlantıları), js/depo.js (Yeni
          Kargo Ekle formu, Kargo Çıkışı ekranı, yeni Tüm Kargolar
          ekranı), js/admin.js (filtre çubuğu ortak koda taşındı,
          manuel teslim artık teslim-eden bilgisini de dolduruyor),
          js/main.js (kargoCard'da etiket küçük resmi + teslim-eden
          satırı, eski QR buton kodu kaldırıldı, ortak filtre
          yardımcıları eklendi)
DOKUNULMADI: js/auth.js, js/authtoken.js, js/api.js, js/mesajlar.js,
          js/notifications.js, js/ui.js, css/style.css,
          css/style-v5.css, css/theme-v7.css — login/güvenlik modeli
          ve mesajlaşma/bildirim akışları değiştirilmedi.

## v8.7 — Fatura OCR ile otomatik ürün/alıcı doldurma

Depo görevlisi artık her kargoda alıcı adını ve ürünleri (ad/SKU/adet)
elle yazmak zorunda değil. "Kargo İçeriği" başlığının yanına "Faturadan
Ekle" butonu eklendi; tıklanınca iki seçenekli bir modal açılıyor:

- **Faturadan Otomatik Çek** — fatura fotoğrafı seçtirir (mobilde
  kamera doğrudan açılır), `js/invoice-ocr.js`'teki `InvoiceOcr` modülü
  Tesseract.js (OCR) ile görseli okuyup alıcı adını ve ürün satırlarını
  çıkarmaya çalışır, form alanlarını doldurur.
- **Elle Gir** — modalı kapatır, eskisi gibi elle doldurmaya devam
  edilir.

Çıkarma kuralları (kullanıcının verdiği tarife birebir):
- Alıcı adı: "SAYIN" kelimesinden sonraki ilk 2 kelime.
- Ürün kodu: "Mal Hizmet Kodu" sütunu, ürün adı: "Mal Hizmet Adı"
  sütunu, adet: "Miktar" sütunundaki sayı.
- Bir faturada birden çok ürün olabilir — her biri ayrı bir ürün
  satırı olarak eklenir (`clearProductRows()` ile form sıfırlanıp
  `addProductRow(prefill)` ile OCR sonucundan tek tek dolduruluyor).

**Önemli — bu bir OCR, QR okuma gibi hatasız değil:** yanlış okuma
sessizce olabilir (özellikle karışık harf/rakam içeren SKU'larda).
Bu yüzden çıkarılan hiçbir alan "kilitli" değildir — hepsi normal,
düzenlenebilir form alanlarına yazılır, kaydetmeden önce görevli
gözden geçirip elle düzeltebilir. Okuma tamamen başarısız olursa (ne
alıcı ne ürün bulunamazsa) açık bir hata gösterilip elle girmeye
yönlendirilir.

Sütun ayrıştırması **aralık bazlı** yapılıyor: fatura tablosunun
başlık satırından ("...Kodu" ve "Miktar" kelimelerinin x-konumundan)
iki sütun sınırı çıkarılıyor, her ürün satırındaki kelimeler bu
sınırlara göre kodu/adı/miktar kovalarına dağıtılıyor. Tek referans
noktasına en yakın kelimeyi seçmek yerine aralık kullanılmasının
sebebi: "Adı" sütunu geniş olduğundan (uzun ürün adları), sütun
sınırına yakın kelimeler yanlış sütuna düşüyordu — hem sentetik testte
hem bu turda gerçek uygulama üzerinden (gerçek Tesseract worker + CDN
dil verisiyle) doğrulandı. **Bu yaklaşımın önkoşulu, başlık satırı ile
veri satırlarının sütunlarının x-eksende hizalı olmasıdır** — gerçek
faturalarda (tablo hücreleriyle basılı) bu normalde sağlanıyor; test
sırasında satırları elle, hizasız bir fontla yazdığımda sütun kayması
gözlemlendi, hizalı bir tabloyla (gerçek fatura tablosunu taklit eden
monospace test görseli) tekrar denendiğinde alıcı adı + 2 ürünün tümü
(ad/SKU/adet) birebir doğru çıktı.

Tesseract.js çekirdeği (WASM, ~7MB) ve dil verisi (~2MB) bilinçli
olarak **vendor edilmedi** — repoyu şişirmemek için sadece bu özellik
ilk kullanıldığında Tesseract.js'in varsayılan CDN'inden bir kerelik
indiriliyor (tarayıcı sonrasını önbelleğe alır). Sadece küçük ana
kütüphane (`js/vendor/tesseract.min.js`, ~65KB) vendor edildi. QR/
barkod okuma bundan etkilenmiyor, tamamen yerel kalmaya devam ediyor.

`kargo_urunleri` tablosuna yeni `adet INTEGER NOT NULL DEFAULT 1`
kolonu eklendi (`NEON_TAM_KURULUM.sql` sıfırdan kurulumlar için
güncellendi; **canlı veritabanına ayrıca, veri kaybetmeyen bir
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` ile eklenmesi gerekiyor** —
bkz. sohbette verilen SQL). Kart görünümünde (`App.kargoCard`) adet
1'den farklıysa ürün çipinin başına "3x" gibi bir önek ekleniyor.

Doğrulama: yerelde gerçek uygulama üzerinden (statik sunucu +
canlı Neon "Kargocuu" DB'ye giriş yapılarak), gerçek dosya-seçim
olayı tetiklenerek uçtan uca test edildi — modal açılma/kapanma,
3 sütunlu ürün satırı CSS'i, "Ürün Ekle"/satır silme/yeniden
numaralama, ve monospace (hizalı sütunlu) sentetik fatura görseliyle
OCR'ın alıcı adı + çoklu ürün + adet'i birebir doğru çıkarması —
hepsi doğrulandı. **Kullanıcının kendi telefonuyla çektiği gerçek
fatura fotoğraflarındaki doğruluk henüz doğrulanmadı** (bu ortamda
kullanıcının daha önce sohbete yapıştırdığı fatura görsellerine dosya
olarak erişilemiyor) — ilk gerçek kullanımda görevlinin çıkan sonucu
mutlaka kontrol etmesi öneriliyor.

---
Değişen/eklenen dosyalar (v8.7):
  YENİ  : js/invoice-ocr.js, js/vendor/tesseract.min.js
  DÜZEN : index.html (2 yeni script tag), js/depo.js ("Faturadan Ekle"
          butonu + modal, `addProductRow`'a adet alanı ve prefill
          desteği, `onSubmitKargo` ürün insert'i adet'i de gönderiyor),
          js/main.js (kargoCard ürün çipinde adet öneki),
          css/style-v8.css (modal + 3 sütunlu ürün satırı stilleri),
          NEON_TAM_KURULUM.sql (kargo_urunleri.adet, yeni kurulumlar
          için)
DOKUNULMADI: js/qr-scanner.js ve tüm QR/barkod akışı — OCR tamamen
          ayrı, isteğe bağlı bir yol; QR zorunluluğu değişmedi.
