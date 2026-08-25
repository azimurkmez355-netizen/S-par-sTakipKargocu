/* ============================================================
   KargoTakip — Fatura OCR (v8.8)
   ------------------------------------------------------------
   Tesseract.js (js/vendor/tesseract.min.js) ile fatura fotoğrafından
   alıcı adı ve ürün satırlarını (kod/ad/adet) çıkarmaya çalışır.

   ÖNEMLİ: OCR, QR/barkod okumanın aksine hata düzeltmeli DEĞİLDİR —
   yanlış okuma sessizce olabilir (özellikle karışık harf/rakam içeren
   ürün kodlarında). Bu yüzden çıkarılan değerler HER ZAMAN normal
   form alanlarına yazılır; kaydetmeden önce görevli gözden geçirip
   düzeltmelidir. Emin olunamayan bir alan doldurulmaya çalışılmaz —
   boş bırakılır (yanlış bir değer görünüp gözden kaçmasındansa boş
   kalıp görevlinin elle girmesi tercih edilir).

   Tesseract çekirdeği (WASM, ~7MB) ve dil verisi (tur, ~2MB) burada
   VENDOR EDİLMEDİ — repo boyutunu şişirmemek için, sadece bu özellik
   kullanılınca (Faturadan Otomatik Çek) Tesseract.js'in kendi
   varsayılan CDN'inden bir kerelik indiriliyor (tarayıcı sonraki
   kullanımlar için önbelleğe alır). QR/barkod okuma gibi çekirdek
   özellikler bundan etkilenmez, tamamen yerel/vendor kalmaya devam
   ediyor. Bu yüzden bu özellik ilk kullanımda internet gerektirir.
   ============================================================ */

const InvoiceOcr = (() => {
  let workerPromise = null;

  function ensureWorker(onProgress) {
    if (typeof Tesseract === "undefined") {
      return Promise.reject(new Error("OCR kütüphanesi yüklenemedi (js/vendor/tesseract.min.js)."));
    }
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker("tur", 1, {
        logger: (m) => {
          if (onProgress && m.status === "recognizing text") onProgress(m.progress || 0);
        }
      })
        .then(async (worker) => {
          // PSM 6 ("tek düzgün metin bloğu varsay") — Tesseract'ın
          // varsayılan otomatik sayfa bölümlemesi (PSM 3), fatura gibi
          // yoğun/çok sütunlu tabloları paragraf/sütun sanıp satır
          // sırasını karıştırabiliyor. Tablo/fiş tarzı düzenler için
          // PSM 6 daha güvenilir sonuç veriyor.
          await worker.setParameters({ tessedit_pageseg_mode: "6" });
          return worker;
        })
        .catch((err) => {
          workerPromise = null; // başarısız kurulum tekrar denenebilsin
          throw err;
        });
    }
    return workerPromise;
  }

  function normalizeWord(t) {
    return (t || "").toUpperCase().replace(/[^A-ZÇĞİÖŞÜ]/g, "");
  }

  const ADDRESS_LINE_MARKERS = [
    "MAH", "SOK", "CAD", "BULV", "NO:", "E-POSTA", "EPOSTA",
    "VERGI", "TCKN", "TEL:", "TEL :", "WWW", "HTTP"
  ];

  function looksLikeAddressLine(text) {
    const upper = (text || "").toUpperCase();
    return ADDRESS_LINE_MARKERS.some((marker) => upper.includes(marker));
  }

  /**
   * "SAYIN" satırından, adres/vergi bilgisinin başladığı satıra kadarki
   * TÜM satırları alıcı adı olarak birleştirir. Alıcı bazen tek satırlık
   * bir kişi adı (ör. "FATIH ULUTAŞ"), bazen 2 satıra yayılan bir şirket
   * unvanı olabilir (ör. "ÜSTÜKAR KAYA CELAL TİCARET" + "İŞ GÜV.TEK.HIRD.")
   * — bu yüzden sabit bir kelime sayısı (ör. "ilk 2 kelime") yerine, bir
   * sonraki adres satırının nerede başladığını (MAH/SOK/CAD/NO:/E-Posta/
   * Vergi/TCKN gibi işaretlerle) tespit edip ondan önceki her şeyi alıyoruz.
   */
  function extractAliciAdSoyad(lines) {
    const idx = lines.findIndex((l) => normalizeWord(l.text).startsWith("SAYIN"));
    if (idx === -1) return null;

    const nameLines = [];
    // "SAYIN" bazen aynı satırda devam ediyor olabilir (ör. "SAYIN: Ahmet") —
    // o satırdaki "SAYIN"dan sonraki kalan metni de isme dahil et.
    const remainder = (lines[idx].text || "").replace(/^\s*SAYIN[:\s]*/i, "").trim();
    if (remainder) nameLines.push(remainder);

    for (let i = idx + 1; i < lines.length && nameLines.length < 4; i++) {
      const text = (lines[i].text || "").trim();
      if (!text) continue;
      if (looksLikeAddressLine(text)) break;
      nameLines.push(text);
    }
    const full = nameLines.join(" ").replace(/\s+/g, " ").trim();
    return full || null;
  }

  /**
   * Tablo başlık satırındaki "...Kodu" ve "Miktar" kelimelerinin
   * x-konumlarından iki sütun sınırı çıkarır. Tesseract'ın satır
   * gruplaması (özellikle gerçek, çizgili/yoğun fatura tablolarında)
   * bu iki kelimeyi her zaman AYNI "line" nesnesine koymayabiliyor —
   * bu yüzden `lines` yerine düz `words` dizisi üzerinde, aynı satırda
   * olma şartı yerine benzer Y-konumu (kodu kelimesinin kendi
   * yüksekliğine göre toleranslı) şartıyla eşleştiriyoruz. Sabit tek
   * nokta yerine ARALIK kullanılıyor — "Adı" sütunu geniş olduğundan
   * (uzun ürün adları), sütun sınırındaki kelimeleri tek referans
   * noktasına en yakın kelimeyi seçerek sınıflandırmak yanlış sütuna
   * düşürüyordu (test sırasında bulundu ve bu yaklaşımla düzeltildi).
   */
  function findColumnBoundaries(words) {
    const koduWords = words.filter((w) => normalizeWord(w.text).includes("KODU"));
    const miktarWords = words.filter((w) => normalizeWord(w.text).includes("MIKTAR"));
    for (const kodu of koduWords) {
      const kY = (kodu.bbox.y0 + kodu.bbox.y1) / 2;
      const kH = Math.max(1, kodu.bbox.y1 - kodu.bbox.y0);
      const miktar = miktarWords.find(
        (m) => Math.abs((m.bbox.y0 + m.bbox.y1) / 2 - kY) < kH * 1.5 && kodu.bbox.x1 < m.bbox.x0
      );
      if (miktar) return { koduEnd: kodu.bbox.x1, miktarStart: miktar.bbox.x0 };
    }
    return null;
  }

  function classifyColumn(x0, b) {
    if (x0 < b.koduEnd) return "kodu";
    if (x0 < b.miktarStart) return "adi";
    return "miktar";
  }

  /** Miktar kovasındaki kelimelerde "<sayı> ADET" örüntüsünü arar — gerçek
   *  faturalarda miktar hep "5 Adet" gibi yazılıyor, bu yüzden sadece ilk
   *  rakam dizisini almaktan (Birim Fiyat/KDV gibi sağdaki sütunlardan
   *  rakam sızma riski var) çok daha güvenilir. "Adet" kelimesi hiç
   *  bulunamazsa, kovadaki ilk rakam dizisine düşülür (daha az güvenilir
   *  ama tamamen boş bırakmaktan iyi). */
  function parseAdet(miktarWords) {
    for (let i = 0; i < miktarWords.length; i++) {
      const num = (miktarWords[i] || "").match(/^\d+/);
      if (num && normalizeWord(miktarWords[i + 1] || "").startsWith("ADET")) {
        return parseInt(num[0], 10);
      }
    }
    const fallback = miktarWords.join(" ").match(/\d+/);
    return fallback ? parseInt(fallback[0], 10) : null;
  }

  /**
   * Başlıktan sonraki satırları, "Sıra No" sütununda küçük bir tam
   * sayıyla başlayan satırlar olduğu sürece ürün satırı sayar; bu
   * örüntü kesilince (ör. "Mal Hizmet Toplam Tutarı" özet satırı)
   * taramayı durdurur.
   */
  function extractUrunler(lines, boundaries) {
    const urunler = [];
    let started = false;
    for (const line of lines) {
      const words = (line.words || []).filter((w) => (w.text || "").trim());
      if (!words.length) continue;
      const isRowStart = /^\d{1,3}$/.test(words[0].text.trim());
      if (!isRowStart) {
        if (started) break;
        continue;
      }
      started = true;
      const buckets = { kodu: [], adi: [], miktar: [] };
      for (let i = 1; i < words.length; i++) {
        buckets[classifyColumn(words[i].bbox.x0, boundaries)].push(words[i].text);
      }
      const sku = buckets.kodu.join(" ").trim();
      const urun_adi = buckets.adi.join(" ").trim();
      const adet = parseAdet(buckets.miktar);
      if (sku || urun_adi) urunler.push({ sku, urun_adi, adet: adet && adet > 0 ? adet : 1 });
    }
    return urunler;
  }

  /**
   * Fatura fotoğrafından alıcı adı + ürün satırlarını çıkarmaya çalışır.
   * @param {File} file
   * @param {(progress:number)=>void} [onProgress] 0-1 arası ilerleme
   * @returns {Promise<{aliciAdSoyad:string|null, urunler:Array, headerFound:boolean}>}
   */
  async function extractFromImageFile(file, onProgress) {
    const worker = await ensureWorker(onProgress);
    const { data } = await worker.recognize(file);
    const lines = data.lines || [];
    const words = data.words || [];
    const aliciAdSoyad = extractAliciAdSoyad(lines);
    const boundaries = findColumnBoundaries(words);
    const urunler = boundaries ? extractUrunler(lines, boundaries) : [];
    return { aliciAdSoyad, urunler, headerFound: !!boundaries };
  }

  return { extractFromImageFile };
})();
