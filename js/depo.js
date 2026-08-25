/* ============================================================
   KargoTakip — Depo Görevlisi paneli
   v3: render-token korumalı asenkron güncellemeler, mobilde net
   ayrılmış "ürün kartı" tasarımlı Yeni Kargo Ekle formu.
   ============================================================ */

const Depo = (() => {
  let currentUser = null;
  let productRowCount = 0;
  let photoBuffer = []; // { name, dataUrl }
  let etiketState = { text: null, previewDataUrl: null }; // decode edilmiş kargo etiketi QR'ı
  let allKargolarDepo = [];
  let activeFiltersDepo = { durum: "hepsi", firma: "hepsi", q: "" };
  let lastHandledQr = null; // Kargo Çıkışı: aynı QR kamerada dururken tekrar tekrar işlenmesin diye
  let lastHandledAt = 0;
  const QR_REPEAT_COOLDOWN_MS = 4000;

  const FIRMALAR = [
    { key: "HepsiJET", label: "HepsiJET", icon: "bx-package", color: "#8B5CF6", logo: "assets/kargo-logos/hepsijet.svg" },
    { key: "ArasKargo", label: "Aras Kargo", icon: "bx-car", color: "#003399", logo: "assets/kargo-logos/aras-kargo.jpg" },
    { key: "PTTKargo", label: "PTT Kargo", icon: "bx-envelope", color: "#F5384F", logo: "assets/kargo-logos/ptt-kargo.png" }
  ];

  function navItems() {
    return [
      { key: "yeni", label: "Yeni Kargo Ekle", icon: "bx-plus-circle" },
      { key: "liste", label: "Kargolarım", icon: "bx-package" },
      { key: "tumu", label: "Tüm Kargolar", icon: "bx-list-ul" },
      { key: "cikis", label: "Kargo Çıkışı", icon: "bx-qr-scan" },
      { key: "mesajlar", label: "Mesajlar", icon: "bx-message-dots" }
    ];
  }

  function mount(user) {
    currentUser = user;
    App.renderShell({
      role: "depo",
      user,
      navItems: navItems(),
      onNavigate: (key) => render(key)
    });
    Mesajlar.initGlobalWatcher(user, "depo");
    render("yeni");
  }

  function render(key) {
    // Sadece "cikis" (Kargo Çıkışı) ekranı otomatik açılıyor ve kendi
    // video elementi için QrScanner.startLive'ı yeniden çağırıp önceki
    // akışı otomatik kapatıyor. "yeni" (Yeni Kargo Ekle) artık kamerayı
    // otomatik açmıyor (v8.5) — oraya geçişte de önceki akış varsa
    // burada açıkça durdurulmalı.
    if (key !== "cikis") QrScanner.stopLive();
    App.setActiveNav(key);
    if (key === "liste") renderListView();
    else if (key === "tumu") renderAllKargolarView();
    else if (key === "cikis") renderKargoExitView();
    else if (key === "mesajlar") Mesajlar.mount(currentUser, "depo");
    else renderFormView();
  }

  /* ---------------- Yeni Kargo Formu ---------------- */

  function miniStatCard(icon, label, value, color) {
    return `
      <div class="card mini-stat" style="--mini-color:${color}">
        <div class="mini-stat__icon"><i class='bx ${icon}'></i></div>
        <div>
          <div class="mini-stat__value">${value}</div>
          <div class="mini-stat__label">${label}</div>
        </div>
      </div>`;
  }

  /* v6: exit-view özet kartları güncellenebilir bir değer id'sine ihtiyaç duyar */
  function miniStatCardWithId(icon, id, label, value, color) {
    return `
      <div class="card mini-stat" style="--mini-color:${color}">
        <div class="mini-stat__icon"><i class='bx ${icon}'></i></div>
        <div>
          <div class="mini-stat__value" id="${id}">${value}</div>
          <div class="mini-stat__label">${label}</div>
        </div>
      </div>`;
  }

  async function paintMyStats(token, hostId) {
    try {
      const data = await Api.select(
        "kargolar",
        `ekleyen_kullanici_id=eq.${currentUser.id}&select=id,durum,olusturma_tarihi`
      );
      if (!App.isCurrent(token)) return;
      const bugun = new Date().toDateString();
      const bugunSayisi = data.filter((k) => new Date(k.olusturma_tarihi).toDateString() === bugun).length;
      const teslim = data.filter((k) => k.durum === "Teslim Edildi").length;
      const bekleyen = data.length - teslim;
      App.paint(
        token,
        hostId,
        [
          miniStatCard("bx-package", "Toplam Eklediğim", data.length, "#5B5FEF"),
          miniStatCard("bx-calendar-plus", "Bugün Eklenen", bugunSayisi, "#0EA5E9"),
          miniStatCard("bx-time-five", "Bekleyen", bekleyen, "#F59E0B"),
          miniStatCard("bx-check-circle", "Teslim Edildi", teslim, "#22C55E")
        ].join("")
      );
    } catch {
      App.paint(token, hostId, "");
    }
  }

  function renderFormView() {
    productRowCount = 0;
    photoBuffer = [];
    etiketState = { text: null, previewDataUrl: null };
    const html = `
      <div class="view-header">
        <div>
          <h1>Yeni Kargo Ekle</h1>
          <p class="view-sub">Alıcı bilgilerini, ürünleri ve kargo fotoğraflarını girip kaydedin.</p>
        </div>
      </div>

      <form id="kargo-form" class="card form-card">
        <div class="form-section">
          <label class="form-label" for="alici-adsoyad"><i class='bx bx-user'></i> Alıcı Ad Soyad</label>
          <input id="alici-adsoyad" class="input" type="text" placeholder="Örn. Ayşe Yılmaz" autocomplete="off" required />
        </div>

        <div class="form-section">
          <div class="form-label-row">
            <label class="form-label"><i class='bx bx-cube'></i> Kargo İçeriği (Ürünler)</label>
            <button type="button" id="add-product-btn" class="btn btn--ghost btn--sm">
              <i class='bx bx-plus'></i> Ürün Ekle
            </button>
          </div>
          <div id="product-rows" class="product-rows"></div>
        </div>

        <div class="form-section">
          <label class="form-label"><i class='bx bx-car'></i> Kargo Firması</label>
          <div class="firma-grid" id="firma-grid">
            ${FIRMALAR.map(
              (f) => `
              <button type="button" class="firma-card" data-firma="${f.key}" style="--firma-color:${f.color}">
                <span class="firma-card__logo">
                  <img src="${f.logo}" alt="${f.label}" onerror="this.parentElement.classList.add('firma-card__logo--fallback');this.remove();" />
                  <i class='bx ${f.icon}'></i>
                </span>
                <span class="firma-card__label">${f.label}</span>
              </button>`
            ).join("")}
          </div>
        </div>

        <div class="form-section">
          <label class="form-label"><i class='bx bx-qr-scan'></i> Kargo Etiketi (QR)</label>
          <div class="qr-info-banner">
            <i class='bx bx-info-circle'></i>
            <p><strong>"QR'ı Başlat"</strong>a basıp etiketi kareye ortalayın — ışıltılı halka dolunca otomatik onaylanır. Bu QR, kargo çıkışında teslimatı eşleştirmek için kullanılır ve her kargoda zorunludur.</p>
          </div>
          <div class="form-section">
            <label class="form-label" for="etiket-sayisi"><i class='bx bx-copy'></i> Etiket Sayısı</label>
            <p class="form-note">Aynı etiketten birden fazla fiziksel paket çıkardıysanız (ör. faturada çok ürün olduğu için 3 koli bastıysanız) buraya kaç tane bastığınızı girin. Tek paketse 1 bırakın.</p>
            <input id="etiket-sayisi" class="input" type="number" min="1" max="20" step="1" value="1" style="max-width:120px" />
          </div>
          <div class="etiket-uploader">
            ${scannerCameraWrapHtml("etiket")}
            <div id="etiket-status" class="scanner-status"></div>
            <div id="etiket-preview" class="etiket-preview"></div>
            <div class="etiket-uploader__actions">
              <button type="button" class="btn btn--ghost btn--sm" id="etiket-rescan-btn" hidden>
                <i class='bx bx-refresh'></i> Yeniden Tara
              </button>
              <label class="btn btn--ghost btn--sm" id="etiket-fallback-label">
                <i class='bx bx-upload'></i> Kamera açılmazsa dosyadan yükle
                <input type="file" id="etiket-input" accept="image/*" capture="environment" hidden />
              </label>
            </div>
          </div>
        </div>

        <div class="form-section">
          <label class="form-label"><i class='bx bx-camera'></i> Kargo Fotoğrafları</label>
          <div class="photo-uploader">
            <label class="photo-add-btn">
              <i class='bx bx-camera'></i>
              <span>Fotoğraf Ekle</span>
              <input type="file" id="photo-input" accept="image/*" capture="environment" multiple hidden />
            </label>
            <div id="photo-preview" class="photo-preview"></div>
          </div>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn--primary btn--lg" id="save-kargo-btn">
            <i class='bx bx-save'></i> Kargoyu Kaydet
          </button>
        </div>
      </form>
    `;
    const token = App.setContent(html);
    addProductRow();

    document.getElementById("add-product-btn").addEventListener("click", () => addProductRow());
    document.getElementById("photo-input").addEventListener("change", onPhotoSelected);
    document.getElementById("etiket-input").addEventListener("change", onEtiketSelected);
    document.getElementById("etiket-start-btn").addEventListener("click", () => startEtiketScan(token));
    document.getElementById("etiket-rescan-btn").addEventListener("click", () => startEtiketScan(token));
    document.querySelectorAll(".firma-card").forEach((btn) =>
      btn.addEventListener("click", () => {
        document.querySelectorAll(".firma-card").forEach((b) => b.classList.remove("firma-card--active"));
        btn.classList.add("firma-card--active");
      })
    );
    document.getElementById("kargo-form").addEventListener("submit", onSubmitKargo);

    // v8.5: kamera artık otomatik açılmıyor — kullanıcı "QR'ı Başlat"a
    // basana kadar kutu boşta (start butonlu) görünümde bekliyor.
    showScannerIdle("etiket");
  }

  function renumberProductRows() {
    document.querySelectorAll("#product-rows .product-row").forEach((row, idx) => {
      const badge = row.querySelector(".product-row__index");
      if (badge) badge.textContent = idx + 1;
    });
  }

  function addProductRow() {
    productRowCount += 1;
    const id = `p${productRowCount}-${Date.now()}`;
    const row = document.createElement("div");
    row.className = "product-row";
    row.dataset.rowId = id;
    row.productPhotos = []; // { name, dataUrl } — bu ürüne özel fotoğraflar
    row.innerHTML = `
      <div class="product-row__head">
        <span class="product-row__index">1</span>
        <span class="product-row__title">Ürün</span>
        <button type="button" class="row-remove-btn" title="Ürünü kaldır">
          <i class='bx bx-trash'></i>
        </button>
      </div>
      <div class="product-row__fields">
        <div class="product-row__field">
          <label>Ürün Adı</label>
          <input type="text" class="input product-name" placeholder="Örn. Kablosuz Kulaklık" required />
        </div>
        <div class="product-row__field product-row__field--adet">
          <label>Adet</label>
          <input type="number" class="input product-adet" min="1" step="1" value="1" required />
        </div>
      </div>
      <div class="product-row__photos">
        <div class="product-row__photo-preview"></div>
        <label class="product-row__photo-add">
          <i class='bx bx-camera-plus'></i>
          <span>Ürün Fotoğrafı Ekle</span>
          <input type="file" class="product-photo-input" accept="image/*" capture="environment" multiple hidden />
        </label>
      </div>
    `;
    row.querySelector(".row-remove-btn").addEventListener("click", () => {
      const rows = document.querySelectorAll("#product-rows .product-row");
      if (rows.length <= 1) {
        UI.toast("En az bir ürün girmelisiniz.", "info");
        return;
      }
      row.remove();
      renumberProductRows();
    });
    row.querySelector(".product-photo-input").addEventListener("change", (e) => onProductPhotoSelected(e, row));
    document.getElementById("product-rows").appendChild(row);
    renumberProductRows();
  }

  async function onProductPhotoSelected(e, row) {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      try {
        const dataUrl = await downscaleImageFile(file, 900, 0.6);
        row.productPhotos.push({ name: file.name, dataUrl });
        renderProductPhotoPreview(row);
      } catch {
        UI.toast(`"${file.name}" yüklenemedi.`, "error");
      }
    }
    e.target.value = "";
  }

  function renderProductPhotoPreview(row) {
    const host = row.querySelector(".product-row__photo-preview");
    if (!host) return;
    host.innerHTML = row.productPhotos
      .map(
        (p, idx) => `
        <div class="photo-thumb">
          <img src="${p.dataUrl}" alt="${UI.escapeHtml(p.name)}" />
          <button type="button" class="photo-thumb__remove" data-idx="${idx}" title="Kaldır">
            <i class='bx bx-x'></i>
          </button>
        </div>`
      )
      .join("");
    host.querySelectorAll(".photo-thumb__remove").forEach((btn) =>
      btn.addEventListener("click", () => {
        row.productPhotos.splice(Number(btn.dataset.idx), 1);
        renderProductPhotoPreview(row);
      })
    );
  }

  /** Telefon kameralarının ham (birkaç MB'lık) fotoğraflarını, DB/liste
   *  sorgularını şişirmemek için kaydetmeden önce küçültür. */
  function downscaleImageFile(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Görsel açılamadı."));
      };
      img.src = url;
    });
  }

  async function onPhotoSelected(e) {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      try {
        const dataUrl = await downscaleImageFile(file, 900, 0.6);
        photoBuffer.push({ name: file.name, dataUrl });
        renderPhotoPreview();
      } catch {
        UI.toast(`"${file.name}" yüklenemedi.`, "error");
      }
    }
    e.target.value = "";
  }

  function renderPhotoPreview() {
    const host = document.getElementById("photo-preview");
    if (!host) return;
    host.innerHTML = photoBuffer
      .map(
        (p, idx) => `
        <div class="photo-thumb">
          <img src="${p.dataUrl}" alt="${UI.escapeHtml(p.name)}" />
          <button type="button" class="photo-thumb__remove" data-idx="${idx}" title="Kaldır">
            <i class='bx bx-x'></i>
          </button>
        </div>`
      )
      .join("");
    host.querySelectorAll(".photo-thumb__remove").forEach((btn) =>
      btn.addEventListener("click", () => {
        photoBuffer.splice(Number(btn.dataset.idx), 1);
        renderPhotoPreview();
      })
    );
  }

  /* ---------------- Kargo Etiketi (QR) — canlı kamera taraması ---------------- */
  /* v8.3: "çek → onayla → başarısızsa tekrar dene" akışı yerine, barkod
     okuyucu gibi kamerayı sürekli tarayıp QR'ı görür görmez otomatik
     onaylayan akışa geçildi (Kargo Çıkışı ekranındaki QrScanner.startLive
     ile aynı motor). Kamera açılmazsa dosyadan yükleme her zaman
     görünür bir yedek olarak kalıyor (onEtiketSelected).
     v8.5: kamera artık otomatik açılmıyor — ortadaki "QR'ı Başlat"
     butonuna basılınca başlıyor. Ayrıca tek karede anında onaylamak
     yerine, QR karede iyi konumlanmış halde HOLD_DURATION_MS boyunca
     kalırsa onaylanıyor; ilerleme kare çevresindeki ışıltılı halkada
     gösteriliyor (Kargo Çıkışı ekranıyla ortak: scannerCameraWrapHtml/
     updateScanRing). */

  function scannerCameraWrapHtml(prefix) {
    return `
      <div class="scanner-camera-wrap" id="${prefix}-camera-wrap">
        <video id="${prefix}-video" class="scanner-video" playsinline muted hidden></video>
        <svg class="scanner-ring" viewBox="0 0 100 100" preserveAspectRatio="none" id="${prefix}-ring" hidden>
          <rect x="4" y="4" width="92" height="92" rx="14" class="scanner-ring__bg" pathLength="100"></rect>
          <rect x="4" y="4" width="92" height="92" rx="14" class="scanner-ring__fg" pathLength="100" id="${prefix}-ring-fg"></rect>
        </svg>
        <button type="button" class="scanner-start-btn" id="${prefix}-start-btn">
          <i class='bx bx-camera'></i>
          <span>QR'ı Başlat</span>
        </button>
      </div>`;
  }

  /** Halkanın dolum oranını günceller (0-1). pathLength=100 sayesinde
   *  şeklin gerçek çevre uzunluğundan bağımsız çalışır. */
  function updateScanRing(prefix, progress) {
    const fg = document.getElementById(`${prefix}-ring-fg`);
    if (fg) fg.style.strokeDashoffset = String(100 * (1 - Math.max(0, Math.min(1, progress))));
  }

  /** Kamera kutusunu "başlamayı bekliyor" görünümüne döndürür: video/halka
   *  gizli, ortadaki başlat butonu görünür. */
  function showScannerIdle(prefix) {
    const video = document.getElementById(`${prefix}-video`);
    const ring = document.getElementById(`${prefix}-ring`);
    const startBtn = document.getElementById(`${prefix}-start-btn`);
    const wrap = document.getElementById(`${prefix}-camera-wrap`);
    if (wrap) wrap.hidden = false;
    if (video) video.hidden = true;
    if (ring) ring.hidden = true;
    if (startBtn) startBtn.hidden = false;
    updateScanRing(prefix, 0);
  }

  /** Kamera kutusunu "canlı tarıyor" görünümüne döndürür: video/halka
   *  görünür, başlat butonu gizli. */
  function showScannerLive(prefix) {
    const video = document.getElementById(`${prefix}-video`);
    const ring = document.getElementById(`${prefix}-ring`);
    const startBtn = document.getElementById(`${prefix}-start-btn`);
    if (video) video.hidden = false;
    if (ring) ring.hidden = false;
    if (startBtn) startBtn.hidden = true;
  }

  function captureVideoFrameJPEG(video, maxDim) {
    const vw = video.videoWidth || maxDim;
    const vh = video.videoHeight || maxDim;
    const scale = Math.min(1, maxDim / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.75);
  }

  async function startEtiketScan(token) {
    const statusEl = document.getElementById("etiket-status");
    const video = document.getElementById("etiket-video");
    const cameraWrap = document.getElementById("etiket-camera-wrap");
    const previewEl = document.getElementById("etiket-preview");
    const rescanBtn = document.getElementById("etiket-rescan-btn");
    if (!video || !statusEl) return;

    // Yeniden Tara ile tekrar başlatıldığında önceki önizleme/kamera durumu
    // temizlensin — kamera kutusu geri gelsin, eski etiket görseli kalksın.
    if (cameraWrap) cameraWrap.hidden = false;
    if (previewEl) previewEl.innerHTML = "";
    if (rescanBtn) rescanBtn.hidden = true;
    showScannerLive("etiket");

    statusEl.className = "scanner-status loading";
    statusEl.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Kamera açılıyor...`;

    try {
      await QrScanner.startLive(
        video,
        (text) => {
          if (!App.isCurrent(token)) return;
          onEtiketDetected(token, text, video);
        },
        (progress) => updateScanRing("etiket", progress)
      );
      if (!App.isCurrent(token)) {
        QrScanner.stopLive();
        return;
      }
      statusEl.className = "scanner-status";
      statusEl.innerHTML = `<i class='bx bx-scan'></i> Etiketi kareye ortalayın — halka dolunca otomatik onaylanır.`;
    } catch (err) {
      showScannerIdle("etiket");
      statusEl.className = "scanner-status error";
      statusEl.innerHTML = `<i class='bx bx-error-circle'></i> Kamera açılamadı (izin reddedilmiş olabilir). "QR'ı Başlat"a tekrar basıp izin verin ya da aşağıdan dosya olarak yükleyin.`;
    }
  }

  function onEtiketDetected(token, text, video) {
    if (!App.isCurrent(token)) return;
    const previewDataUrl = captureVideoFrameJPEG(video, 1200);
    QrScanner.stopLive();
    etiketState = { text, previewDataUrl };

    const statusEl = document.getElementById("etiket-status");
    const previewEl = document.getElementById("etiket-preview");
    const rescanBtn = document.getElementById("etiket-rescan-btn");
    const cameraWrap = document.getElementById("etiket-camera-wrap");
    if (cameraWrap) cameraWrap.hidden = true;
    if (statusEl) {
      statusEl.className = "scanner-status success";
      statusEl.innerHTML = `<i class='bx bx-check-circle'></i> QR başarıyla okundu.`;
    }
    if (previewEl) previewEl.innerHTML = `<img src="${previewDataUrl}" alt="Kargo etiketi" />`;
    if (rescanBtn) rescanBtn.hidden = false;
  }

  async function onEtiketSelected(e) {
    const file = (e.target.files || [])[0];
    e.target.value = "";
    if (!file) return;

    QrScanner.stopLive();
    const statusEl = document.getElementById("etiket-status");
    const previewEl = document.getElementById("etiket-preview");
    const cameraWrap = document.getElementById("etiket-camera-wrap");
    if (!statusEl || !previewEl) return;
    if (cameraWrap) cameraWrap.hidden = true;

    statusEl.className = "scanner-status loading";
    statusEl.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Etiket okunuyor...`;
    previewEl.innerHTML = "";

    try {
      const { text, previewDataUrl } = await QrScanner.decodeFromImageFile(file);
      if (!text) {
        etiketState = { text: null, previewDataUrl: null };
        statusEl.className = "scanner-status error";
        statusEl.innerHTML = `<i class='bx bx-error-circle'></i> QR okunamadı. Etiketi net, tam ve iyi ışıkta çekip tekrar yükleyin ya da kamerayla deneyin.`;
        document.getElementById("etiket-rescan-btn").hidden = false;
        return;
      }
      etiketState = { text, previewDataUrl };
      statusEl.className = "scanner-status success";
      statusEl.innerHTML = `<i class='bx bx-check-circle'></i> QR başarıyla okundu.`;
      previewEl.innerHTML = `<img src="${previewDataUrl}" alt="Kargo etiketi" />`;
      document.getElementById("etiket-rescan-btn").hidden = false;
    } catch (err) {
      etiketState = { text: null, previewDataUrl: null };
      statusEl.className = "scanner-status error";
      statusEl.innerHTML = `<i class='bx bx-error-circle'></i> ${UI.escapeHtml(err.message || "Etiket okunamadı.")}`;
      document.getElementById("etiket-rescan-btn").hidden = false;
    }
  }

  async function onSubmitKargo(e) {
    e.preventDefault();
    const alici = document.getElementById("alici-adsoyad").value.trim();
    const firmaBtn = document.querySelector(".firma-card--active");
    const rows = Array.from(document.querySelectorAll("#product-rows .product-row"));
    const products = rows
      .map((r) => ({
        urun_adi: r.querySelector(".product-name").value.trim(),
        adet: Math.max(1, parseInt(r.querySelector(".product-adet").value, 10) || 1),
        photos: r.productPhotos || []
      }))
      .filter((p) => p.urun_adi);
    const etiketSayisi = Math.max(1, Math.min(20, parseInt(document.getElementById("etiket-sayisi").value, 10) || 1));

    if (!alici) {
      UI.toast("Alıcı ad soyad girilmelidir.", "error");
      return;
    }
    if (!firmaBtn) {
      UI.toast("Lütfen bir kargo firması seçin.", "error");
      return;
    }
    if (!products.length) {
      UI.toast("En az bir ürün adı girmelisiniz.", "error");
      return;
    }
    if (!etiketState.text) {
      UI.toast("Kargo etiketinin QR kodu okutulmadan kargo kaydedilemez.", "error");
      return;
    }

    const btn = document.getElementById("save-kargo-btn");
    btn.disabled = true;
    btn.classList.add("btn--loading");

    // Etiket Sayısı 1'den büyükse, aynı QR'dan (aynı fiziksel etiketten
    // basılan) birden fazla paket için AYRI kargo kaydı oluşturuluyor —
    // her biri Kargo Çıkışı'nda bağımsız teslim edilebilsin diye (bkz.
    // handleQrScan'daki "hangi etiket" seçim modalı). Her paket, girilen
    // ürün/fotoğraf listesinin TAM bir kopyasını taşıyor — kullanıcı
    // ürünleri paketlere ayrı ayrı dağıtmak istemedi, her etiket kendi
    // başına faturanın tamamını gösterebilsin istedi.
    let savedCount = 0;
    let lastKargoError = null;
    let photoFailCount = 0;
    let photoTotalCount = 0;

    try {
      for (let etiketNo = 1; etiketNo <= etiketSayisi; etiketNo++) {
        try {
          const inserted = await Api.insert("kargolar", {
            alici_ad_soyad: alici,
            kargo_firmasi: firmaBtn.dataset.firma,
            durum: "Paketlendi",
            ekleyen_kullanici_id: currentUser.id,
            qr_kod: etiketState.text,
            etiket_foto_base64: etiketState.previewDataUrl,
            etiket_no: etiketNo,
            etiket_sayisi: etiketSayisi
          });
          const kargo = inserted[0];

          const insertedProducts = await Api.insert(
            "kargo_urunleri",
            products.map((p) => ({ kargo_id: kargo.id, urun_adi: p.urun_adi, adet: p.adet }))
          );

          // Genel kargo fotoğrafları + her ürünün kendi fotoğrafları aynı
          // tabloya (kargo_fotograflari) gidiyor; ürün fotoğrafları
          // kargo_urun_id ile o ürüne bağlanıyor. Fotoğraflar TEK bir toplu
          // istek yerine BİRER BİRER, her biri en fazla 3 deneme (ilk + 2
          // tekrar) ile gönderiliyor — büyük birleşik istek gövdesi bazı
          // cihaz/ağlarda "Empty or invalid json" hatasına yol açıyordu;
          // tek tek göndermek hem bu riski dağıtıyor hem bir fotoğraf
          // başarısız olsa bile diğerlerinin kaydedilmesine izin veriyor.
          const photoRows = photoBuffer.map((p) => ({ kargo_id: kargo.id, foto_base64: p.dataUrl }));
          products.forEach((p, idx) => {
            const urunId = insertedProducts[idx] && insertedProducts[idx].id;
            p.photos.forEach((ph) =>
              photoRows.push({ kargo_id: kargo.id, kargo_urun_id: urunId, foto_base64: ph.dataUrl })
            );
          });
          photoTotalCount += photoRows.length;
          for (const row of photoRows) {
            let ok = false;
            for (let attempt = 0; attempt < 3 && !ok; attempt++) {
              try {
                if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
                await Api.insert("kargo_fotograflari", [row]);
                ok = true;
              } catch {
                /* aşağıda toplu sayılıyor */
              }
            }
            if (!ok) photoFailCount += 1;
          }

          savedCount += 1;
        } catch (err) {
          lastKargoError = err;
        }
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("btn--loading");
      }
    }

    if (!savedCount) {
      const msg = (lastKargoError && lastKargoError.message) || "";
      if (msg.includes("duplicate key value")) {
        UI.toast("Bu QR zaten kullanılıyor. Farklı bir etiket okutun.", "error");
      } else {
        UI.toast(msg || "Kargo kaydedilemedi.", "error");
      }
      return;
    }

    let summary = etiketSayisi > 1 ? `${savedCount}/${etiketSayisi} etiket kaydedildi.` : "Kargo başarıyla kaydedildi.";
    if (savedCount < etiketSayisi) summary += ` ${etiketSayisi - savedCount} etiket kaydedilemedi.`;
    if (photoFailCount) summary += ` ${photoFailCount}/${photoTotalCount} fotoğraf yüklenemedi.`;
    UI.toast(summary, photoFailCount || savedCount < etiketSayisi ? "error" : "success", 8000);
    render("liste");
  }

  /* ---------------- Kargolarım Listesi ---------------- */

  async function renderListView() {
    const token = App.setContent(`
      <div class="view-header">
        <div>
          <h1>Kargolarım</h1>
          <p class="view-sub">Eklediğiniz tüm kargolar burada listelenir, kayıtlar silinmez.</p>
        </div>
        <button class="btn btn--ghost" id="refresh-list-btn"><i class='bx bx-refresh'></i> Yenile</button>
      </div>
      <div id="my-stats" class="mini-stat-row">${App.skeletonCards(4)}</div>
      <div id="kargo-list" class="kargo-grid">${App.skeletonCards(3)}</div>
    `);
    document.getElementById("refresh-list-btn").addEventListener("click", renderListView);
    paintMyStats(token, "my-stats");
    await loadKargolar(token);
  }

  async function loadKargolar(token) {
    try {
      const data = await Api.select(
        "kargolar",
        `ekleyen_kullanici_id=eq.${currentUser.id}&select=${App.KARGO_LIST_SELECT}&order=olusturma_tarihi.desc`
      );
      if (!App.isCurrent(token)) return;
      if (!data.length) {
        App.paint(token, "kargo-list", App.emptyState("bx-package", "Henüz kargo eklemediniz", "Yeni Kargo Ekle sayfasından ilk kaydınızı oluşturun."));
        return;
      }
      App.paint(token, "kargo-list", data.map((k) => App.kargoCard(k, { showEkleyen: false })).join(""));
      const host = document.getElementById("kargo-list");
      if (App.isCurrent(token) && host) {
        App.bindKargoCardEvents(host);
      }
    } catch (err) {
      if (App.isCurrent(token)) App.paint(token, "kargo-list", App.emptyState("bx-error", "Liste yüklenemedi", err.message));
    }
  }

  /* ============ Kargo Çıkışı Sayfası (v5) ============ */
  /* Depo görevlisinin kargolara QR kodu okutarak teslimat 
     onayladığı özel sayfa. Tarih ve saate göre filtrelenebilir. */

  async function renderKargoExitView() {
    const token = App.setContent(`
      <div class="view-header">
        <div>
          <h1>Kargo Çıkışı</h1>
          <p class="view-sub">Kargolara QR kod okutarak teslimatı onaylayın. Gün gün takip edin.</p>
        </div>
      </div>

      <div class="kargo-exit-container">
        <div class="kargo-exit-panel">
          <div class="card exit-scanner" id="exit-scanner-card">
            <h3><i class='bx bx-qr'></i> QR Kod Okut</h3>
            ${scannerCameraWrapHtml("scanner")}
            <div class="scanner-input-group">
              <input
                type="text"
                id="qr-scanner-input"
                class="input input--lg"
                placeholder="Kamera açılmazsa QR değerini buraya yazıp Enter'a basın..."
                autocomplete="off"
              />
            </div>
            <div id="scanner-status" class="scanner-status"></div>
          </div>

          <div class="card exit-filter">
            <h3><i class='bx bx-filter'></i> Gün Seç</h3>
            <input 
              type="date" 
              id="exit-date-filter" 
              class="input"
            />
            <button type="button" id="filter-by-date-btn" class="btn btn--ghost btn--block">
              <i class='bx bx-search'></i> Filtrele
            </button>
          </div>

          <div id="scanned-list" class="scanned-items-list">
            <p class="empty-state-text">Henüz kargo okutulmadı.</p>
          </div>
        </div>

        <div class="kargo-exit-summary">
          <div id="exit-summary-stats" class="mini-stat-row exit-summary-row">
            ${miniStatCardWithId("bx-scan", "total-scanned", "Toplam Okutuldu", 0, "#6366F1")}
            ${miniStatCardWithId("bx-check-circle", "total-delivered", "Teslim Edildi", 0, "#22C55E")}
            ${miniStatCardWithId("bx-time-five", "pending-count", "Beklemede", 0, "#F59E0B")}
          </div>

          <div class="card" id="exit-log">
            <h3><i class='bx bx-list-check'></i> Çıkış Günlüğü</h3>
            <div id="exit-history" class="exit-history"></div>
          </div>
        </div>
      </div>
    `);

    // Event listeners
    const dateInput = document.getElementById("exit-date-filter");
    dateInput.valueAsDate = new Date();

    document.getElementById("qr-scanner-input").addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        const code = e.target.value.trim();
        e.target.value = "";
        if (code) handleQrScan(code, token);
      }
    });

    document.getElementById("scanner-start-btn").addEventListener("click", () => {
      startCameraScan(token);
    });

    document.getElementById("filter-by-date-btn").addEventListener("click", () => {
      const selectedDate = dateInput.valueAsDate;
      if (selectedDate) {
        loadExitHistory(token, selectedDate);
      }
    });

    startCameraScan(token);
    loadExitHistory(token, new Date());
  }

  /** Kasiyer barkod okuyucusu gibi kısa bir "bip" — Web Audio API ile
   *  anlık üretiliyor, ayrı bir ses dosyasına gerek yok. AudioContext
   *  tarayıcıların otomatik oynatma politikası yüzünden gerçek bir
   *  kullanıcı jestiyle (buton tıklaması) "kilidi açılmadan" ses
   *  çıkarmayabiliyor — bu yüzden burada değil, "QR'ı Başlat" butonuna
   *  basıldığı anda (startCameraScan) oluşturuluyor/devam ettiriliyor. */
  let scanBeepCtx = null;
  function ensureScanBeepUnlocked() {
    if (!scanBeepCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) scanBeepCtx = new Ctx();
    }
    if (scanBeepCtx && scanBeepCtx.state === "suspended") scanBeepCtx.resume().catch(() => {});
  }
  function playTone(freq, startOffset, duration, type, peakGain) {
    const ctx = scanBeepCtx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ctx.currentTime + startOffset;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peakGain, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }
  /** Yeni başarılı teslimat — iki notalı, yükselen onay sesi ("dırınt"). */
  function playScanSuccessSound() {
    if (!scanBeepCtx) return;
    try {
      playTone(900, 0, 0.09, "square", 0.16);
      playTone(1500, 0.09, 0.13, "square", 0.18);
      if (navigator.vibrate) navigator.vibrate(90);
    } catch {
      /* ses/titreşim çalışmasa da tarama akışını bozmasın */
    }
  }
  /** Zaten teslim edilmiş / bulunamadı / hata — alçak, kısa çift "buzz" uyarısı. */
  function playScanWarnSound() {
    if (!scanBeepCtx) return;
    try {
      playTone(320, 0, 0.11, "sawtooth", 0.16);
      playTone(320, 0.14, 0.11, "sawtooth", 0.16);
      if (navigator.vibrate) navigator.vibrate([70, 60, 70]);
    } catch {
      /* ses/titreşim çalışmasa da tarama akışını bozmasın */
    }
  }

  async function startCameraScan(token) {
    const statusEl = document.getElementById("scanner-status");
    const video = document.getElementById("scanner-video");
    if (!video || !statusEl) return;
    ensureScanBeepUnlocked();
    showScannerLive("scanner");
    try {
      await QrScanner.startLive(
        video,
        (text) => {
          if (!App.isCurrent(token)) return;
          handleQrScan(text, token);
        },
        (progress) => updateScanRing("scanner", progress)
      );
      if (!App.isCurrent(token)) {
        QrScanner.stopLive();
        return;
      }
      statusEl.className = "scanner-status";
      statusEl.innerHTML = `<i class='bx bx-scan'></i> Etiketi kareye ortalayın — halka dolunca otomatik onaylanır.`;
    } catch (err) {
      showScannerIdle("scanner");
      statusEl.className = "scanner-status error";
      statusEl.innerHTML = `<i class='bx bx-error-circle'></i> Kamera açılamadı (izin reddedilmiş olabilir). "QR'ı Başlat"a tekrar basıp izin verin ya da aşağıdaki kutuya QR değerini yazıp Enter'a basın.`;
    }
  }

  let exitHistoryRefreshId = null;
  function scheduleExitHistoryRefresh(token) {
    if (exitHistoryRefreshId) clearTimeout(exitHistoryRefreshId);
    exitHistoryRefreshId = setTimeout(() => {
      exitHistoryRefreshId = null;
      loadExitHistory(token, new Date());
    }, 600);
  }

  /**
   * QR eşleştirme: kargo_kod alanına göre arar. Üç sonuç: eşleşme yok,
   * eşleşme var ama zaten teslim edilmiş (uyarı, DB'ye yazmaz), ya da
   * eşleşme var ve teslim edilir (race-safe update + günlük kaydı).
   *
   * v8.13 — arka arkaya hızlı okutma: kamera artık bu paketin ağ
   * çağrıları bitene KADAR beklemiyor; aynı QR'ın tekrar işlenmesini
   * engelleyen soğuma kaydı yazılır yazılmaz (ağ çağrılarından ÖNCE)
   * `resumeLive()` çağrılıp bir sonraki etiket taranmaya başlanıyor —
   * bu paketin sonucu arka planda gelir. En sık senaryo (henüz teslim
   * edilmemiş bir kargo) artık SELECT+UPDATE+INSERT yerine doğrudan
   * UPDATE+INSERT (2 ağ çağrısı) ile hallediliyor — alıcı adı gibi
   * bilgiler UPDATE'in döndürdüğü satırdan alınıyor; SELECT sadece
   * UPDATE hiçbir satırı değiştirmediğinde (kargo hiç yok ya da zaten
   * teslim edilmiş) nedeni öğrenmek için ayrıca yapılıyor.
   *
   * v8.15 — sonuca göre farklı sesli/titreşimli geri bildirim: yeni
   * başarılı teslimatta playScanSuccessSound() (yükselen çift nota),
   * zaten teslim edilmiş/bulunamadı/hata durumunda playScanWarnSound()
   * (alçak çift "buzz") çalıyor — ikisi de destekleyen cihazlarda
   * navigator.vibrate() ile eş zamanlı titreşim veriyor.
   *
   * v8.16 — çoklu etiket desteği: aynı QR artık birden fazla kargo
   * satırına ait olabilir (bkz. Yeni Kargo Ekle'deki "Etiket Sayısı").
   * Bu yüzden v8.13'ün "doğrudan UPDATE dene" hızlandırması burada
   * GÜVENLİ DEĞİL — qr_kod artık tekil olmadığından, koşulsuz bir UPDATE
   * aynı anda birden fazla (henüz teslim edilmemiş) satırı birden
   * "teslim edildi" yapabilirdi. Bunun yerine önce SELECT ile bu QR'a
   * ait TÜM satırlar çekiliyor: tek satır (ya da bekleyen tek satır)
   * varsa direkt işleniyor (eski tek-etiket akışı gibi hızlı); birden
   * fazla satır hâlâ bekliyorsa "Hangi Etiket?" modalı açılıp görevli
   * elindeki paketi seçiyor — bu durumda kamera modal kapanana kadar
   * duraklıyor (yanlışlıkla başka bir paket bu seçimin üstüne okunmasın).
   */
  async function handleQrScan(qrText, token) {
    const value = (qrText || "").trim();
    if (!value) return;

    // Kamera aynı etikete dönük dururken saniyede birkaç kez aynı QR'ı
    // algılayıp aynı sonucu tekrar tekrar toast'lamasın diye kısa bir
    // soğuma süresi — sonuç zaten ekranda duruyor, tekrar göstermeye gerek yok.
    const now = Date.now();
    if (value === lastHandledQr && now - lastHandledAt < QR_REPEAT_COOLDOWN_MS) {
      QrScanner.resumeLive();
      return;
    }
    lastHandledQr = value;
    lastHandledAt = now;

    const statusEl = document.getElementById("scanner-status");

    try {
      const kargolar = await Api.select(
        "kargolar",
        `qr_kod=eq.${encodeURIComponent(value)}&select=id,alici_ad_soyad,durum,cikis_tarihi,teslim_eden_adi,etiket_no,etiket_sayisi&order=etiket_no.asc`
      );

      if (!kargolar.length) {
        UI.toast("Bu QR sistemde kayıtlı değil.", "error");
        playScanWarnSound();
        if (statusEl) {
          statusEl.className = "scanner-status error";
          statusEl.innerHTML = `<i class='bx bx-error-circle'></i> Bu QR sistemde kayıtlı değil.`;
        }
        QrScanner.resumeLive();
        return;
      }

      const pending = kargolar.filter((k) => k.durum !== "Teslim Edildi");

      if (pending.length <= 1) {
        // Seçilecek gerçek bir şey yok: tek etiket varsa ya da birden
        // fazla etiketin sadece biri bekliyorsa direkt onu işle.
        QrScanner.resumeLive();
        await resolveEtiketTeslim(pending[0] || kargolar[0], token, statusEl);
        return;
      }

      // Birden fazla etiket hâlâ bekliyor — hangisi olduğunu sor. Görevli
      // seçim yapana kadar kamera duraklıyor.
      openEtiketSecimModal(kargolar, token, statusEl);
    } catch (err) {
      UI.toast(err.message || "İşlem başarısız", "error");
      playScanWarnSound();
      QrScanner.resumeLive();
    }
  }

  /** Tek bir kargo satırını teslim eder (ya da zaten teslim edilmişse
   *  bilgilendirir) — hem tek-etiketli hem çoklu-etiketli (seçim
   *  modalından gelen) akış tarafından ortak kullanılıyor. */
  async function resolveEtiketTeslim(kargo, token, statusEl) {
    const etiketNote = kargo.etiket_sayisi > 1 ? ` (Etiket ${kargo.etiket_no}/${kargo.etiket_sayisi})` : "";

    if (kargo.durum === "Teslim Edildi") {
      const detay = kargo.teslim_eden_adi
        ? ` — ${kargo.teslim_eden_adi} tarafından ${UI.formatDateTime(kargo.cikis_tarihi)}`
        : "";
      UI.toast(`${kargo.alici_ad_soyad}${etiketNote}: Bu kargo zaten teslim edildi${detay}`, "info");
      playScanWarnSound();
      if (statusEl) {
        statusEl.className = "scanner-status info";
        statusEl.innerHTML = `<i class='bx bx-info-circle'></i> Zaten teslim edildi${UI.escapeHtml(detay)}`;
      }
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      // durum=neq.Teslim Edildi: iki görevli aynı anda okutursa (yarış durumu)
      // sadece biri güncellesin diye koşullu update.
      const updated = await Api.update(
        "kargolar",
        `id=eq.${kargo.id}&durum=neq.${encodeURIComponent("Teslim Edildi")}`,
        {
          durum: "Teslim Edildi",
          cikis_tarihi: timestamp,
          teslim_eden_kullanici_id: currentUser.id,
          teslim_eden_adi: currentUser.ad_soyad
        }
      );

      if (!updated.length) {
        UI.toast(`${kargo.alici_ad_soyad}${etiketNote}: Bu kargo az önce başka biri tarafından teslim edildi.`, "info");
        playScanWarnSound();
        return;
      }

      await Api.insert("kargo_cikis_kayitlari", {
        kargo_id: kargo.id,
        kullanici_id: currentUser.id,
        okutma_tarihi: timestamp
      });
      UI.toast(`${kargo.alici_ad_soyad}${etiketNote} — Teslim Edildi olarak işaretlendi`, "success");
      playScanSuccessSound();
      if (statusEl) {
        statusEl.className = "scanner-status success";
        statusEl.innerHTML = `<i class='bx bx-check-circle'></i> ${UI.escapeHtml(kargo.alici_ad_soyad)}${etiketNote} teslim edildi.`;
      }
      scheduleExitHistoryRefresh(token);
    } catch (err) {
      UI.toast(err.message || "İşlem başarısız", "error");
      playScanWarnSound();
    }
  }

  /** Aynı QR'a ait birden fazla etiket hâlâ beklerken açılan "hangi
   *  paketi okutuyorsunuz" seçim modalı. */
  function openEtiketSecimModal(kargolar, token, statusEl) {
    const alici = kargolar[0].alici_ad_soyad;
    UI.openModal(`
      <button class="modal-close-x" data-close-modal><i class='bx bx-x'></i></button>
      <h3 class="modal-title">Hangi Etiket?</h3>
      <p class="modal-text">${UI.escapeHtml(alici)} için birden fazla paket etiketi var. Elinizdeki paketi seçin.</p>
      <div class="etiket-secim-list">
        ${kargolar
          .map((k) => {
            const done = k.durum === "Teslim Edildi";
            return `
            <button type="button" class="etiket-secim-opt${done ? " etiket-secim-opt--done" : ""}" data-id="${k.id}" ${done ? "disabled" : ""}>
              <span class="etiket-secim-opt__no">${k.etiket_no}. Etiket</span>
              ${
                done
                  ? `<span class="badge badge--success"><i class='bx bx-check'></i> Teslim Edildi</span>`
                  : `<span class="badge badge--warning">Bekliyor</span>`
              }
            </button>`;
          })
          .join("")}
      </div>
    `);
    let resumed = false;
    const resumeOnce = () => {
      if (resumed) return;
      resumed = true;
      QrScanner.resumeLive();
    };
    document.querySelectorAll(".etiket-secim-opt:not([disabled])").forEach((optBtn) =>
      optBtn.addEventListener("click", async () => {
        UI.closeModal();
        const kargo = kargolar.find((k) => String(k.id) === optBtn.dataset.id);
        resumeOnce();
        if (kargo) await resolveEtiketTeslim(kargo, token, statusEl);
      })
    );
    // Modal vazgeçilerek/arka plana tıklanarak kapatılırsa da tarama devam etsin.
    document.querySelectorAll("#modal-host [data-close-modal]").forEach((closeBtn) => closeBtn.addEventListener("click", resumeOnce));
    document.getElementById("modal-backdrop")?.addEventListener("click", resumeOnce);
  }

  async function loadExitHistory(token, selectedDate) {
    if (!App.isCurrent(token)) return;

    try {
      const dateStr = selectedDate.toISOString().split("T")[0];
      const nextDateStr = new Date(selectedDate.getTime() + 86400000).toISOString().split("T")[0];

      // Seçilen gün için çıkış kayıtlarını getir
      const kayitlar = await Api.select(
        "kargo_cikis_kayitlari",
        `okutma_tarihi=gte.${dateStr}T00:00:00&okutma_tarihi=lt.${nextDateStr}T00:00:00&select=*,kargolar(alici_ad_soyad,durum)&order=okutma_tarihi.desc`
      );

      const historyHtml = kayitlar
        .map(
          (k) => `
            <div class="exit-history-item">
              <div class="exit-item-head">
                <span class="exit-item-ref">KRG-${String(k.kargo_id).padStart(6, "0")}</span>
                <span class="exit-item-time">${UI.formatDateTime(k.okutma_tarihi)}</span>
              </div>
              <div class="exit-item-body">
                <span><strong>${UI.escapeHtml(k.kargolar?.alici_ad_soyad || "Bilinmiyor")}</strong></span>
                <span class="badge badge--success"><i class='bx bx-check-circle'></i> Teslim Edildi</span>
              </div>
            </div>
          `
        )
        .join("");

      App.paint(
        token,
        "exit-history",
        historyHtml || "<p class='empty-state-text'>Bu tarihte kayıt yok.</p>"
      );

      // İstatistikleri güncelle
      const totalScanned = kayitlar.length;
      const totalDelivered = kayitlar.filter((k) => k.kargolar?.durum === "Teslim Edildi").length;
      const pending = totalScanned - totalDelivered;

      App.paint(token, "total-scanned", totalScanned.toString());
      App.paint(token, "total-delivered", totalDelivered.toString());
      App.paint(token, "pending-count", pending.toString());
    } catch (err) {
      UI.toast(err.message || "Veriler yüklenemedi", "error");
    }
  }

  /* ---------------- Tüm Kargolar (tüm depo görevlilerinin kargoları, salt okunur) ---------------- */

  async function renderAllKargolarView() {
    const token = App.setContent(`
      <div class="view-header">
        <div>
          <h1>Tüm Kargolar</h1>
          <p class="view-sub">Sistemdeki tüm depo görevlilerinin eklediği kargolar.</p>
        </div>
        <button class="btn btn--ghost" id="refresh-tumu-btn"><i class='bx bx-refresh'></i> Yenile</button>
      </div>

      ${App.renderKargoFilterBar()}

      <div id="kargo-list-tumu" class="kargo-rows">${App.skeletonCards(4)}</div>
    `);

    document.getElementById("refresh-tumu-btn").addEventListener("click", renderAllKargolarView);
    App.bindKargoFilterBar((patch) => {
      Object.assign(activeFiltersDepo, patch);
      paintAllKargolarList();
    });

    await loadAllKargolarForDepo(token);
  }

  async function loadAllKargolarForDepo(token) {
    try {
      const data = await Api.select(
        "kargolar",
        `select=${App.KARGO_LIST_SELECT},kullanicilar!ekleyen_kullanici_id(ad_soyad)&order=olusturma_tarihi.desc`
      );
      if (!App.isCurrent(token)) return;
      allKargolarDepo = data;
      paintAllKargolarList();
    } catch (err) {
      if (App.isCurrent(token)) App.paint(token, "kargo-list-tumu", App.emptyState("bx-error", "Liste yüklenemedi", err.message));
    }
  }

  function paintAllKargolarList() {
    const host = document.getElementById("kargo-list-tumu");
    if (!host) return;
    const list = App.filterKargolar(allKargolarDepo, activeFiltersDepo);
    if (!list.length) {
      host.innerHTML = App.emptyState("bx-search-alt", "Sonuç bulunamadı", "Filtrelere uyan kargo bulunamadı.");
      return;
    }
    host.innerHTML = list.map((k) => App.kargoRow(k, { showEkleyen: true, showActions: false })).join("");
    App.bindKargoRowEvents(host, list, { showEkleyen: true, showActions: false });
  }

  return { mount };
})();
