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

## v8.8 düzeltmesi — fatura OCR gerçek faturalarda hiç veri çekmiyordu

Kullanıcı gerçek faturalarını (üzerinde tam olarak neyin alınması
gerektiğini kırmızıyla işaretleyerek) paylaştı: "hiçbir şey çekmiyor"
ve alıcı adının **2 kelimeyle sınırlı olmaması** gerektiği bildirildi
— "SAYIN" altında bazen tek satırlık bir kişi adı ("FATIH ULUTAŞ"),
bazen 2 satıra yayılan bir şirket unvanı ("ÜSTÜKAR KAYA CELAL TİCARET"
+ "İŞ GÜV.TEK.HIRD.") oluyor; sabit "ilk 2 kelime" kuralı ikinci
durumda unvanı yarıda kesiyordu.

Üç değişiklik yapıldı (`js/invoice-ocr.js`):

1. **Alıcı adı artık satır bazlı**: "SAYIN" satırından, bir "adres
   satırı" görünene kadarki TÜM satırlar isme dahil ediliyor (sabit
   kelime sayısı yerine). Adres satırı, içinde MAH/SOK/CAD/BULV/NO:/
   E-Posta/Vergi/TCKN/Tel gibi işaretlerden biri geçen ilk satır
   olarak tanımlanıyor — kaçak/sonsuz büyümeyi önlemek için en fazla
   4 satır alınıyor.
2. **Sütun sınırı tespiti artık satır gruplamasından bağımsız**:
   eskiden "Kodu" ve "Miktar" kelimelerinin Tesseract'ın AYNI "line"
   nesnesinde olması gerekiyordu — gerçek, yoğun/çizgili fatura
   tablolarında Tesseract'ın satır bölümlemesi bunu her zaman
   sağlamıyor (muhtemelen "hiç veri çekmeme" şikayetinin asıl kaynağı
   buydu). Artık düz `words` dizisi üzerinde, "aynı satır" yerine
   "benzer Y-konumu" (kodu kelimesinin kendi yüksekliğine göre
   toleranslı) şartıyla eşleştiriliyor.
3. **Miktar artık "Adet" kelimesine sabitlenerek** okunuyor (gerçek
   faturalarda hep "5 Adet" gibi yazılıyor) — eskiden miktar
   kovasındaki ilk rakam dizisi alınıyordu, bu da sağdaki Birim
   Fiyat/İskonto/KDV sütunlarından rakam sızma riski taşıyordu.
   "Adet" hiç bulunamazsa eski (daha az güvenilir) yönteme düşülüyor.

Ayrıca Tesseract'a sayfa bölümleme modu (PSM) **6** ("tek düzgün metin
bloğu varsay") açıkça set edildi (`worker.setParameters`) — varsayılan
otomatik mod (PSM 3) yoğun/çok sütunlu tabloları paragraf/sütun sanıp
okuma sırasını karıştırabiliyor; fiş/fatura tarzı düzenler için PSM 6
standart öneridir.

**Doğrulama notu**: Kullanıcının gerçek fatura fotoğrafları bu ortamda
dosya olarak erişilemediğinden (sadece sohbette görsel olarak
görülebiliyor), düzeltmeler kullanıcının paylaştığı görsellerin
**birebir metin/sütun yapısını** (hizalı iki fatura düzeni, çok
satırlı unvan + tek satırlı isim, "N Adet" + sağda fiyat sütunları)
taklit eden hizalı sentetik test görselleriyle gerçek uygulama
üzerinden doğrulandı — her iki isim biçimi ve miktar/kod/ad ayrıştırma
birebir doğru çıktı. Kullanıcının kendi fotoğraflarıyla nihai
doğrulama hâlâ onlarda; sonucu tekrar bildirmeleri istendi.

---
Değişen dosyalar (v8.8): js/invoice-ocr.js (satır bazlı alıcı adı,
Y-toleranslı sütun tespiti, Adet-çapalı miktar ayrıştırma, PSM 6).

## v8.9 — Mesajlaşmada "eski oturum" hatası + sesli alarm güvenilirliği

Kullanıcı canlı ortamda (Railway) admin panelinden "Yeni Mesaj Talebi"
gönderirken şu hatayı aldı: `API hatası (409): insert or update on
table "mesaj_talepleri" violates foreign key constraint
"mesaj_talepleri_olusturan_admin_id_fk..."`. Canlı veritabanı curl ile
kontrol edildi — `kullanicilar` tablosunda `admin` (id=1) sorunsuz
duruyordu; yani sorun veritabanında değil, **tarayıcıda önbelleğe
alınmış eski bir oturumdaydı** (`localStorage`'daki `kargotakip_oturum`
— muhtemelen bu oturumun DB tamamen sıfırlanmadan/bir kullanıcı
silinmeden önce açılıp hiç yeniden giriş yapılmadığı bir sekmeden
kalmış, artık geçersiz bir `id` taşıyordu). Uygulama girişte oturumu
bir kere veritabanından çekip `localStorage`'a yazıyor, sonraki her
açılışta DB'ye karşı yeniden doğrulamıyor — bu yüzden DB sıfırlanınca
açık kalan sekmeler sessizce geçersizleşiyor.

**İki değişiklik yapıldı:**

1. `js/api.js` — merkezi `request()` fonksiyonu artık bu spesifik
   hata örüntüsünü (409 + PostgREST'in `details` alanında `"is not
   present in table \"kullanicilar\""`) tanıyor ve ham/kriptik
   PostgREST mesajı yerine "Oturum bilgin güncel değil görünüyor...
   Lütfen çıkış yapıp tekrar giriş yap." gibi görevlinin kendi başına
   çözebileceği net bir hata gösteriyor. Bu, `currentUser.id`
   kullanan HER insert/update için geçerli (kargo ekleme, mesaj
   gönderme, okundu işaretleme, talep açma — hepsi aynı kalıba
   giriyor), tek bir yerden düzeltildiği için hepsini kapsıyor.
   Sentetik olarak (oturumu elle var olmayan bir id'ye çevirip) test
   edildi, doğru mesaj göründü.
2. `js/mesajlar.js` — acil mesaj sesli alarmının (`playSoundTwice`)
   güvenilirliği artırıldı. Tarayıcıların otomatik oynatma politikası,
   sayfa hiç fare/dokunma/tuş etkileşimi almadan JS'ten tetiklenen
   `audio.play()` çağrılarını sessizce reddedebiliyor — depo ekranı
   saatlerce dokunulmadan açık kalıp ilk acil mesaj tam o sırada
   gelirse, sesin hiç çalmama riski vardı (görsel banner/üst-uyarı
   yine de görünüyordu, ama görevli ekrana bakmıyorsa fark etmeyebilir).
   Artık sayfadaki İLK tıklama/dokunma/tuş basımında ses kısık
   seviyede bir kez "hazırlanıp" (çal + hemen duraklat) tarayıcının bu
   origin için otomatik oynatmaya izin vermesi sağlanıyor — gerçek
   alarm o andan sonra güvenilir çalabiliyor. (Bu "unlock" adımının
   kendisi de bir kullanıcı jesti gerektirdiğinden, sekme hiç
   dokunulmadan İLK acil mesaj gelirse yine de risk var — ama bu artık
   tarayıcıların temel autoplay kısıtı, KargoTakip'e özgü bir hata
   değil.)

**Kullanıcı için hemen yapılması gereken**: mevcut açık sekme(ler)de
çıkış yapıp tekrar giriş yapmalı — kod düzeltmesi yeni oturumların bu
duruma düşmesini daha anlaşılır hale getiriyor, ama zaten açık olan
eski/geçersiz oturumu otomatik onarmıyor (localStorage'ı elden
temizlemek DB durumunu bilmeden riskli olurdu).

---
Değişen dosyalar (v8.9): js/api.js (409 + kullanicilar FK hatası için
özel, anlaşılır mesaj), js/mesajlar.js (sesli alarm için autoplay
"unlock" — ilk kullanıcı etkileşiminde sesi bir kez hazırlama).

## v8.10 — "Yeni Kargo Ekle" baştan tasarım: OCR kaldırıldı, SKU kaldırıldı, ürün fotoğrafı eklendi

Kullanıcı isteği üzerine fatura-OCR özelliği (v8.7/v8.8) **tamamen
kaldırıldı** — artık tüm ürün girişi elle yapılıyor. `js/invoice-ocr.js`
ve `js/vendor/tesseract.min.js` silindi, `index.html`'den script
etiketleri kaldırıldı. QR/barkod okuma bundan etkilenmedi.

**Ürün satırı**: SKU alanı tamamen kaldırıldı; her ürün artık kendi
fotoğraf(lar)ını ekleyebiliyor ("Ürün Fotoğrafı Ekle", sınırsız sayıda) —
ürün artık SKU yerine görsel olarak tanımlanıyor. Fotoğraflar
`kargo_fotograflari` tablosuna, yeni `kargo_urun_id` kolonuyla o ürüne
bağlı olarak kaydediliyor (boşsa genel kargo fotoğrafıdır, doluysa
belirli bir ürüne aittir — aynı tablo, ayrı bir tablo açmaya gerek
kalmadı). `kargo_urunleri.sku` kolonu **silinmedi, sadece NOT NULL
kısıtı kaldırıldı** — geçmiş kayıtlardaki SKU verisi korunuyor, form
artık bu alanı hiç göstermiyor/göndermiyor.

**Canlı veritabanında elle çalıştırılması gereken, veri kaybetmeyen
migration** (Neon SQL Editor):
```sql
ALTER TABLE kargo_urunleri ALTER COLUMN sku DROP NOT NULL;
ALTER TABLE kargo_fotograflari ADD COLUMN IF NOT EXISTS kargo_urun_id BIGINT REFERENCES kargo_urunleri(id) ON DELETE CASCADE;
```
`NEON_TAM_KURULUM.sql` sıfırdan kurulumlar için de güncellendi.

**Sayfa üstündeki 4 istatistik kutusu** ("Toplam Eklediğim" vb.) sadece
"Yeni Kargo Ekle" ekranından kaldırıldı — "Kargolarım" ekranında aynen
duruyor (`paintMyStats` fonksiyonu değişmedi, sadece bu sayfadaki
çağrısı kaldırıldı).

**Kargo firması kartları**: artık gerçek marka logosu gösteriyor
(`assets/kargo-logos/hepsijet.png`, `aras-kargo.png`, `ptt-kargo.png` —
bu 3 dosyanın kullanıcı tarafından repoya eklenmesi gerekiyor, henüz
eklenmedi). Logolar düz beyaz zeminli olduğundan, kartın kendi (hafif
tonlu) arka planında sırıtmasınlar diye her logo kendi beyaz "fişi"
içine oturtuluyor. Dosya eksik/yüklenemezse (`onerror`) otomatik olarak
eski ikon+marka rengi görünümüne düşülüyor — görsel eklenene kadar site
bozuk görsel ikonu göstermeden çalışmaya devam ediyor.

**QR bölümü**: düz gri açıklama metninin yerine yumuşak indigo renkli
bir bilgi şeridi geldi. Tarama karesinin etrafındaki ışıltı, düz teal
"nabız" yerine kare çevresinde yavaşça dönen, çok renkli (primary →
accent → pembe → camgöbeği) bulanık bir "aura" halkasına + karenin
kendi halkasında renk kayması yapan (hue-rotate) daha yumuşak bir
parıltıya dönüştürüldü. Bunun için `.scanner-camera-wrap`'in
`overflow:hidden`'ı kaldırıldı (aksi halde kutunun dışına taşan aura'yı
keserdi) — video'nun köşe yuvarlaklığı artık doğrudan kendi üzerinde
(`border-radius:inherit`).

**Bildirimler (toast) pozisyonu**: `#toast-host` zaten `position:fixed;
top:20px; right:20px` — sayfa/scroll'dan bağımsız her zaman sağ üstten
sabit geliyor/gidiyor, kontrol edildi, mevcut haliyle doğru
çalışıyordu; bu konuda kod değişikliği gerekmedi.

Doğrulama: yerelde gerçek uygulama üzerinden (canlı Neon DB'ye giriş
yapılarak) test edildi — istatistik kutularının kalktığı, SKU alanının
hiç olmadığı, ürün fotoğrafı ekleme/kaldırmanın çalıştığı, logo
dosyaları eksikken otomatik ikon yedeğine düştüğü (başta `loading="lazy"`
yüzünden bu yedek geç tetikleniyordu, kaldırıldı) doğrulandı. Yukarıdaki
2 satırlık migration çalıştırılmadan gerçek bir kargo kaydı denenmedi
(QR zorunluluğu nedeniyle bu ortamda gerçek bir etiket okutulamıyor) —
migration çalıştırıldıktan sonra kullanıcının kendi cihazında uçtan uca
denemesi gerekiyor.

---
Değişen/silinen dosyalar (v8.10):
  SİLİNDİ: js/invoice-ocr.js, js/vendor/tesseract.min.js
  DÜZEN : index.html (OCR script etiketleri kaldırıldı), js/depo.js
          (Yeni Kargo Ekle baştan tasarım, ürün fotoğrafı, SKU kaldırma,
          logo kartları), js/main.js (kargoCard artık sku yoksa o
          satırı göstermiyor), css/style-v8.css (aura/parıltı, logo
          fişi, qr-info-banner, ürün kartı/foto stilleri),
          NEON_TAM_KURULUM.sql (sku NULL edilebilir, kargo_urun_id
          eklendi — sıfırdan kurulumlar için)

## v8.11 — Mobilde yatay kayma + sabit üst bar sağlamlaştırma

Kullanıcı gerçek cihazında mobilde sayfanın scroll sırasında sağa-sola
kaydığını ve üst barın "her zaman sabit" hissetmediğini bildirdi.
`.topbar-mobile` zaten `position:fixed` idi ve statik testte (Chromium
tabanlı yerel test ortamı, 375px mobil viewport) `document.documentElement.scrollWidth`
hiçbir yerde `innerWidth`'i aşmıyordu — yani bu ortamda birebir
yeniden üretilemedi. Buna rağmen, bilinen iki gerçek mobil web
sorununa karşı savunmacı bir düzeltme eklendi (her ikisi de zararsız,
geriye dönük uyumlu):
- `html { overflow-x: hidden; }` eklendi (`body`'de zaten vardı;
  `<html>` her zaman aynı korumaya sahip olsun diye tamamlayıcı).
- `.main-content { overflow-x: hidden; }` (≤860px) — içerik alanı
  ne olursa olsun (bkz. v8.10'daki aura parıltısı gibi normal akış
  içindeki taşabilecek elemanlar) sayfa asla yana kaymasın diye ek
  bir kesme sınırı. Aura'nın `inset` değeri de -12px'ten -8px'e
  düşürüldü (daha az taşma riski, görsel olarak fark edilmiyor).
- `.topbar-mobile { transform: translateZ(0); will-change: transform; }`
  (≤860px) — iOS Safari'de kompozit katmanı olmayan `position:fixed`
  elemanların scroll sırasında hafifçe gecikip "tam sabit değilmiş"
  hissi vermesi bilinen bir sorundur; bu, elemanı kendi GPU katmanına
  alarak önlüyor.

Kullanıcının kendi cihazında tekrar test etmesi gerekiyor — bu ortamda
birebir doğrulanamadı.

---
Değişen dosyalar (v8.11): css/style.css (`html` için `overflow-x:hidden`),
css/style-v8.css (`.main-content`/`.topbar-mobile` mobil sağlamlaştırma,
aura inset küçültme).

## v8.12 — Gerçek kargo firması logoları + "kaydedildi ama görsel gelmedi" karışıklığı

Kullanıcı 3 logoyu (Wikimedia Commons/Vikipedi'den resmi kaynak
URL'leri) verdi, buradan indirilip repoya eklendi:
`assets/kargo-logos/hepsijet.svg` (Hepsiburada resmi logosu — HepsiJET
için), `aras-kargo.jpg`, `ptt-kargo.png`. `FIRMALAR` dizisindeki `logo`
yolları bu gerçek dosya adlarıyla güncellendi (kullanıcının önceden
elle eklediği, artık gereksiz `hepsijet.png`/`aras-kargo.png` silindi).

**"Her şeyi doldurup gönderiyorum, API hatası veriyor ama kargo yine de
kaydediliyor, sadece görseller gelmiyor" hatası düzeltildi.** Kök
neden: `onSubmitKargo` kargo + ürünleri VE fotoğrafları tek bir
try/catch içinde sırayla ekliyordu — fotoğraf ekleme adımı
(`kargo_fotograflari`, muhtemelen henüz çalıştırılmamış `kargo_urun_id`
migration'ı yüzünden) başarısız olunca kod genel catch'e düşüp "kargo
kaydedilemedi" diyordu, oysa kargo ve ürünler zaten (ayrı, önceki API
çağrılarıyla) başarıyla kaydedilmişti — kullanıcının gördüğü "hata
veriyor ama kaydediliyor" çelişkisinin kaynağı tam olarak buydu.
Fotoğraf ekleme artık kendi ayrı try/catch'i içinde, "best effort"
olarak deneniyor: başarısız olursa kargo yine de kaydedilmiş sayılıyor,
listeye yönlendiriliyor, ama "Kargo kaydedildi, ama fotoğraflar
yüklenemedi: <sebep>" gibi net, çelişkili olmayan bir mesaj gösteriyor.
Bu, migration çalıştırılmış olsa da olmasa da (ör. ileride bir ağ
sorunu vb.) doğru davranan kalıcı bir düzeltme.

**Hâlâ çalıştırılması gerekiyorsa** (v8.10'dan beri istenen, veri
kaybetmeyen migration — kargo_urunleri.sku artık kaydedilebiliyor
olduğuna göre muhtemelen sadece ikinci satır eksik):
```sql
ALTER TABLE kargo_urunleri ALTER COLUMN sku DROP NOT NULL;
ALTER TABLE kargo_fotograflari ADD COLUMN IF NOT EXISTS kargo_urun_id BIGINT REFERENCES kargo_urunleri(id) ON DELETE CASCADE;
```

---
Değişen/eklenen dosyalar (v8.12):
  YENİ  : assets/kargo-logos/hepsijet.svg, aras-kargo.jpg, ptt-kargo.png
  DÜZEN : js/depo.js (logo yolları güncellendi, fotoğraf insert'i ayrı
          best-effort try/catch'e alındı)

## v8.13 — Fotoğraf yükleme "Empty or invalid json" hatası + Kargo Çıkışı'nda hızlı arka arkaya okutma

Kullanıcı gerçek cihazında (canlı ortam) test etti: kargo kaydediliyor,
ama fotoğraflar için `API hatası (400): Empty or invalid json` alıyordu.
Bu, tüm fotoğrafların (her biri yüz(ler)ce KB base64) TEK bir toplu
INSERT isteğinde birleştirilmesinden kaynaklanıyordu — bazı cihaz/ağ
koşullarında büyük istek gövdesi bozuluyor/kesiliyor, PostgREST bunu
"boş ya da geçersiz json" olarak raporluyordu. Çözüm: fotoğraflar artık
TEK TEK, ayrı isteklerle gönderiliyor — hem istek boyutu küçülüyor hem
de bir fotoğraf başarısız olsa bile diğerleri kaydedilebiliyor. Hata
mesajı da netleşti: "Kargo kaydedildi, ama X/Y fotoğraf yüklenemedi:
<sebep>".

**Kargo Çıkışı — arka arkaya hızlı okutma**: kullanıcı paketlerin QR'larının
art arda hızlıca okutulup teslim edilebilmesini istedi. İki değişiklik:
1. Kamera artık bir paketin ağ işlemleri (eşleştir/güncelle/günlüğe
   yaz) bitmesini BEKLEMEDEN bir sonraki etiketi taramaya başlıyor —
   `QrScanner.resumeLive()` artık işlem sonunda değil, aynı-QR soğuma
   kaydı yazılır yazılmaz (ağ çağrılarından önce) çağrılıyor. Önceki
   paketin sonucu (toast) arka planda gelmeye devam ediyor.
2. En sık senaryo (henüz teslim edilmemiş bir kargo) artık SELECT +
   UPDATE + INSERT (3 ağ çağrısı) yerine doğrudan UPDATE + INSERT (2 ağ
   çağrısı) ile hallediliyor — alıcı adı gibi bilgiler UPDATE'in
   döndürdüğü satırdan alınıyor. SELECT sadece UPDATE hiçbir satırı
   değiştirmediğinde (kargo hiç yok ya da zaten teslim edilmiş) nedeni
   öğrenmek için ayrıca yapılıyor.
3. Çıkış günlüğü/istatistik yenilemesi (`loadExitHistory`) artık her
   okutmadan hemen sonra değil, 600ms'lik bir gecikmeyle (debounce)
   tetikleniyor — art arda hızlı okutmalarda tek tek değil, tek seferde
   yenileniyor.

**Doğrulama notu**: Bu turda canlı veritabanına gerçek bir yazma testi
YAPILMADI — hem fotoğraf hem hızlı-okutma değişiklikleri gerçek veri
üzerinde (kargo teslim etme, fotoğraf kaydetme) test kullanıcısı
olmadan güvenle denenemezdi (test hesabı "depo1" kullanıcı tarafından
silinmiş; rastgele gerçek bir kargoyu "teslim edildi" işaretleyerek
test etmek gerçek veriyi bozardı). Değişiklikler dikkatli kod
incelemesiyle doğrulandı, syntax kontrolünden geçti. Kullanıcının kendi
cihazında gerçek akışla (birden fazla fotoğraf + art arda QR okutma)
test etmesi gerekiyor.

---
Değişen dosyalar (v8.13): js/depo.js (fotoğraflar tek tek insert,
Kargo Çıkışı update-önce akışı + anında resumeLive + debounce'lu
geçmiş yenileme).

## v8.14 — Fotoğraf hatası kök nedeni araştırıldı (Neon sorunu DEĞİL) + kasiyer bip sesi

Kullanıcı v8.13'ten sonra fotoğraf yüklemenin YİNE başarısız olduğunu
bildirdi, "Neon veritabanıyla ilgili olabilir" dedi. Bunu varsaymak
yerine doğrudan test edildi: canlı Neon Data API'ye curl ile,
gerçekçi boyutta (~267KB base64) bir fotoğraf satırı POST edildi —
**başarıyla eklendi (201 Created)**, hemen ardından silindi (temiz test).
Ayrıca `kargo_fotograflari.kargo_urun_id` kolonunun var olduğu da
ayrıca doğrulandı. Yani: **veritabanı/şema tamamen sağlam, sorun Neon
değil** — muhtemelen kullanıcının telefonundan gönderilen büyük
(taban64) istek gövdesinin mobil ağda zaman zaman kesilmesi/bozulması
("Empty or invalid json" tam olarak bu iki senaryoyu tarif ediyor: boş
ya da yarım kalmış/bozuk gövde).

Kesin kanıt olmadan üçüncü kez kör tahmin yapmak yerine, bu ihtimale
karşı iki savunmacı önlem eklendi:
- Fotoğraf boyutu küçültüldü: 1200px/%75 kalite → 900px/%60 kalite
  (hem genel kargo fotoğrafları hem ürün fotoğrafları) — istek gövdesi
  belirgin şekilde küçülüyor.
- Her fotoğraf artık en fazla 3 kez deneniyor (ilk + 2 tekrar, aralarda
  kısa bekleme) — geçici bir ağ kesintisini kendi kendine atlatabilir.

**Kargo Çıkışı'na kasiyer tarzı "bip" sesi eklendi**: her başarılı QR
okutuşunda (aynı etiket kamerada dururken tekrar tekrar değil, yeni
her okutuşta) kısa, keskin bir bip çalıyor. Ayrı bir ses dosyası
gerekmedi — Web Audio API ile anlık üretiliyor (kare dalga, 1500Hz,
~120ms). Tarayıcıların otomatik oynatma kısıtına takılmaması için ses
bağlamı (AudioContext) "QR'ı Başlat" butonuna basıldığı anda (gerçek
kullanıcı jesti) oluşturuluyor/devam ettiriliyor.

---
Değişen dosyalar (v8.14): js/depo.js (fotoğraf boyutu küçültme + tekrar
deneme, kasiyer bip sesi).
