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
