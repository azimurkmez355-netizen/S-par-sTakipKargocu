/* ============================================================
   KargoTakip — Barkod/QR Tarayıcı (v8.1)
   ------------------------------------------------------------
   ÖNEMLİ: Kargo firmalarının (HepsiJET/Aras/PTT) etiketlerindeki
   kod her zaman klasik QR (ISO 18004) olmuyor — çoğu zaman Data
   Matrix gibi başka bir 2D format kullanılıyor. jsQR SADECE QR
   okuyabildiği için bu etiketleri hiç okuyamıyordu (v8.0'daki
   kök sorun buydu). Bu yüzden jsQR yerine ZXing (js/vendor/zxing.js,
   @zxing/library) kullanıyoruz — QR + Data Matrix + Aztec + PDF417
   + yaygın 1D barkodları TEK okuyucuda destekliyor, hangi formatta
   olduğunu bilmemize gerek kalmadan otomatik tanıyor.

     1) decodeFromImageFile — etiket fotoğrafından tek seferlik okuma
        (Yeni Kargo Ekle formunda kullanılır).
     2) startLive/stopLive/resumeLive — canlı kamera taraması
        (Kargo Çıkışı ekranında kullanılır).

   Tamamen yerel/internetsiz çalışır; index.html js/vendor/zxing.js'i
   qr-scanner.js'den önce yüklemelidir.
   ============================================================ */

const QrScanner = (() => {
  const LIVE_MAX_DIM = 900;
  const LIVE_MIN_INTERVAL_MS = 50; // asıl gecikme decode süresinden geliyor (~150-350ms), bu sadece taban
  const FULL_DECODE_MAX_DIM = 1800; // gerçek telefon fotoğrafları (12-48MP) için üst sınır
  const PREVIEW_MAX_DIM = 1200;

  // Etiket yüklerken (tek seferlik, doğruluk öncelikli) geniş bir format
  // kümesi deniyoruz — hangi kargo firmasının hangi formatı kullandığını
  // bilmemize gerek kalmıyor. Canlı taramada (her karede çalışıyor, hız
  // önemli) sadece kargo etiketlerinde fiilen görülen QR + Data Matrix'e
  // daraltıyoruz; her ek format denemesi ölçülebilir gecikme ekliyor.
  const FILE_FORMAT_NAMES = [
    "QR_CODE",
    "DATA_MATRIX",
    "AZTEC",
    "PDF_417",
    "CODE_128",
    "CODE_39",
    "EAN_13",
    "EAN_8",
    "UPC_A",
    "UPC_E",
    "ITF",
    "CODABAR"
  ];
  const LIVE_FORMAT_NAMES = ["QR_CODE", "DATA_MATRIX"];

  function ensureLib() {
    if (typeof ZXing === "undefined" || !ZXing.MultiFormatReader) {
      throw new Error("Barkod kütüphanesi yüklenemedi (js/vendor/zxing.js).");
    }
  }

  function buildReader(formatNames, tryHarder) {
    const hints = new Map();
    hints.set(
      ZXing.DecodeHintType.POSSIBLE_FORMATS,
      formatNames.map((name) => ZXing.BarcodeFormat[name])
    );
    if (tryHarder) hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    const reader = new ZXing.MultiFormatReader();
    reader.setHints(hints);
    return reader;
  }

  // Tek seferlik (etiket yükleme) okuyucu TRY_HARDER ile daha yavaş ama
  // daha doğru; canlı tarama okuyucusu akıcı kalması için TRY_HARDER'sız
  // ve daha dar format kümesiyle.
  let fileReader = null;
  let liveReader = null;

  /** Canvas'tan barkod okumayı dener; bulamazsa (herhangi bir sebeple) null döner. */
  function decodeCanvasWith(reader, canvas) {
    const luminanceSource = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
    const binaryBitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminanceSource));
    try {
      return reader.decode(binaryBitmap).getText();
    } catch {
      return null; // kod bulunamadı — normal/beklenen durum
    }
  }

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Görsel açılamadı."));
      };
      img.src = url;
    });
  }

  function drawToCanvas(img, maxDim) {
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
    return canvas;
  }

  /**
   * Etiket fotoğrafından kod okur (QR, Data Matrix, vb. hepsi denenir).
   * Başarılıysa DB'ye kaydedilecek küçültülmüş bir önizleme (JPEG) de
   * üretir; başarısızsa previewDataUrl null döner ve çağıran taraf
   * kullanıcıya tekrar denemesini söyler.
   */
  async function decodeFromImageFile(file) {
    ensureLib();
    if (!fileReader) fileReader = buildReader(FILE_FORMAT_NAMES, true);
    const img = await fileToImage(file);
    // Gerçek telefon fotoğrafları (12-48MP) hem yavaş hem de bazı
    // tarayıcılarda canvas piksel sınırını aşabiliyor; ayrıca aşırı
    // çözünürlük termal yazıcı etiketlerinde JPEG/moiré gürültüsünü
    // artırıp okumayı zorlaştırabiliyor. Üst sınır koyuyoruz.
    const fullCanvas = drawToCanvas(img, FULL_DECODE_MAX_DIM);
    const text = decodeCanvasWith(fileReader, fullCanvas);
    if (!text) return { text: null, previewDataUrl: null };

    const previewCanvas = drawToCanvas(img, PREVIEW_MAX_DIM);
    const previewDataUrl = previewCanvas.toDataURL("image/jpeg", 0.75);
    return { text, previewDataUrl };
  }

  /* ---------------- Canlı kamera taraması ---------------- */

  let stream = null;
  let rafId = null;
  let scanCanvas = null;
  let videoEl = null;
  let detecting = true;
  let onDetectCb = null;
  let lastAttemptTs = 0;

  /** Kamerayı ve tarama döngüsünü durdurur. İdempotent — güvenle tekrar çağrılabilir. */
  function stopLive() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (videoEl) videoEl.srcObject = null;
    videoEl = null;
    onDetectCb = null;
  }

  function tick(now) {
    if (!videoEl || !stream) return;
    const ready = videoEl.readyState >= 2 /* HAVE_CURRENT_DATA */ && videoEl.videoWidth;
    if (detecting && ready && now - lastAttemptTs >= LIVE_MIN_INTERVAL_MS) {
      lastAttemptTs = now;
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      // .scanner-video, object-fit:cover ile KARE bir kutuda gösteriliyor —
      // yani kullanıcı ekranda sadece orta kareyi görüyor. Tüm (geniş) kareyi
      // küçültüp taramak yerine, görünen kareyle AYNI orta-kare bölgeyi kırpıp
      // tarıyoruz; aksi halde kod, kullanıcının gördüğünden çok daha küçük ve
      // az pikselli bir alana sıkışıp okunamaz hale geliyordu.
      const side = Math.min(vw, vh);
      const sx = (vw - side) / 2;
      const sy = (vh - side) / 2;
      const outSide = Math.min(side, LIVE_MAX_DIM);
      if (!scanCanvas) scanCanvas = document.createElement("canvas");
      if (scanCanvas.width !== outSide) scanCanvas.width = outSide;
      if (scanCanvas.height !== outSide) scanCanvas.height = outSide;
      scanCanvas.getContext("2d", { willReadFrequently: true }).drawImage(videoEl, sx, sy, side, side, 0, 0, outSide, outSide);

      if (!liveReader) liveReader = buildReader(LIVE_FORMAT_NAMES, false);
      const text = decodeCanvasWith(liveReader, scanCanvas);
      if (text) {
        detecting = false;
        if (onDetectCb) onDetectCb(text);
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  /**
   * Arka kamerayı açar ve video elementine bağlar, sürekli kod arar.
   * Bir kod bulunca onDetect(text) BİR KEZ çağrılır ve tarama duraklar;
   * çağıran taraf işini bitirince resumeLive() ile devam ettirmelidir
   * (aynı kodun "zaten teslim edildi" gibi bilinçli tekrar okutulabilmesi
   * için zaman bazlı debounce yerine bu yöntem tercih edildi).
   */
  async function startLive(video, onDetect) {
    ensureLib();
    stopLive();
    videoEl = video;
    onDetectCb = onDetect;
    detecting = true;
    lastAttemptTs = 0;

    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.muted = true;

    // width/height "ideal" verilmezse birçok telefon tarayıcısı düşük
    // varsayılan bir çözünürlük seçiyor (ör. 640x480) — bu da termal
    // yazıcıyla basılan yoğun/noktalı kodları okumaya yetmiyor.
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1920 }
      },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    rafId = requestAnimationFrame(tick);
  }

  /** Bir onDetect tetiklenmesinden sonra taramaya kaldığı yerden devam eder. */
  function resumeLive() {
    lastAttemptTs = 0;
    detecting = true;
  }

  // Sekme arka plana alınınca kamerayı bırak (açık kalıp pil/gizlilik
  // sorunu yaratmasın diye ek güvenlik ağı — asıl kapatma sorumluluğu
  // Depo.render()'da nav değişiminde çağrılır).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopLive();
  });

  return { decodeFromImageFile, startLive, stopLive, resumeLive };
})();
