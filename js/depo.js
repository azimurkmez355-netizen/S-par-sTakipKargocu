/* ============================================================
   KargoTakip — Depo Görevlisi paneli
   v3: render-token korumalı asenkron güncellemeler, mobilde net
   ayrılmış "ürün kartı" tasarımlı Yeni Kargo Ekle formu.
   ============================================================ */

const Depo = (() => {
  let currentUser = null;
  let productRowCount = 0;
  let photoBuffer = []; // { name, dataUrl }

  const FIRMALAR = [
    { key: "HepsiJET", label: "HepsiJET", icon: "bx-package", color: "#8B5CF6" },
    { key: "ArasKargo", label: "Aras Kargo", icon: "bx-car", color: "#FF9F1C" },
    { key: "PTTKargo", label: "PTT Kargo", icon: "bx-envelope", color: "#F5384F" }
  ];

  function navItems() {
    return [
      { key: "yeni", label: "Yeni Kargo Ekle", icon: "bx-plus-circle" },
      { key: "liste", label: "Kargolarım", icon: "bx-package" },
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
    App.setActiveNav(key);
    if (key === "liste") renderListView();
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
    const html = `
      <div class="view-header">
        <div>
          <h1>Yeni Kargo Ekle</h1>
          <p class="view-sub">Alıcı bilgilerini, ürünleri ve kargo fotoğraflarını girip kaydedin.</p>
        </div>
      </div>

      <div id="my-stats" class="mini-stat-row">${App.skeletonCards(4)}</div>

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
                <i class='bx ${f.icon}'></i>
                <span>${f.label}</span>
              </button>`
            ).join("")}
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
    paintMyStats(token, "my-stats");

    document.getElementById("add-product-btn").addEventListener("click", addProductRow);
    document.getElementById("photo-input").addEventListener("change", onPhotoSelected);
    document.querySelectorAll(".firma-card").forEach((btn) =>
      btn.addEventListener("click", () => {
        document.querySelectorAll(".firma-card").forEach((b) => b.classList.remove("firma-card--active"));
        btn.classList.add("firma-card--active");
      })
    );
    document.getElementById("kargo-form").addEventListener("submit", onSubmitKargo);
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
        <div class="product-row__field">
          <label>SKU</label>
          <input type="text" class="input product-sku" placeholder="Örn. SKU-00123" required />
        </div>
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
    document.getElementById("product-rows").appendChild(row);
    renumberProductRows();
  }

  function onPhotoSelected(e) {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        photoBuffer.push({ name: file.name, dataUrl: reader.result });
        renderPhotoPreview();
      };
      reader.readAsDataURL(file);
    });
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

  async function onSubmitKargo(e) {
    e.preventDefault();
    const alici = document.getElementById("alici-adsoyad").value.trim();
    const firmaBtn = document.querySelector(".firma-card--active");
    const rows = Array.from(document.querySelectorAll("#product-rows .product-row"));
    const products = rows
      .map((r) => ({
        urun_adi: r.querySelector(".product-name").value.trim(),
        sku: r.querySelector(".product-sku").value.trim()
      }))
      .filter((p) => p.urun_adi && p.sku);

    if (!alici) {
      UI.toast("Alıcı ad soyad girilmelidir.", "error");
      return;
    }
    if (!firmaBtn) {
      UI.toast("Lütfen bir kargo firması seçin.", "error");
      return;
    }
    if (!products.length) {
      UI.toast("En az bir ürün adı ve SKU girmelisiniz.", "error");
      return;
    }

    const btn = document.getElementById("save-kargo-btn");
    btn.disabled = true;
    btn.classList.add("btn--loading");

    try {
      const inserted = await Api.insert("kargolar", {
        alici_ad_soyad: alici,
        kargo_firmasi: firmaBtn.dataset.firma,
        durum: "Paketlendi",
        ekleyen_kullanici_id: currentUser.id
      });
      const kargo = inserted[0];

      await Api.insert(
        "kargo_urunleri",
        products.map((p) => ({ kargo_id: kargo.id, urun_adi: p.urun_adi, sku: p.sku }))
      );

      if (photoBuffer.length) {
        await Api.insert(
          "kargo_fotograflari",
          photoBuffer.map((p) => ({ kargo_id: kargo.id, foto_base64: p.dataUrl }))
        );
      }

      UI.toast("Kargo başarıyla kaydedildi.", "success");
      render("liste");
    } catch (err) {
      UI.toast(err.message || "Kargo kaydedilemedi.", "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("btn--loading");
      }
    }
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
        `ekleyen_kullanici_id=eq.${currentUser.id}&select=*,kargo_urunleri(*),kargo_fotograflari(*)&order=olusturma_tarihi.desc`
      );
      if (!App.isCurrent(token)) return;
      if (!data.length) {
        App.paint(token, "kargo-list", App.emptyState("bx-package", "Henüz kargo eklemediniz", "Yeni Kargo Ekle sayfasından ilk kaydınızı oluşturun."));
        return;
      }
      App.paint(token, "kargo-list", data.map((k) => App.kargoCard(k, { showEkleyen: false })).join(""));
      const host = document.getElementById("kargo-list");
      if (App.isCurrent(token) && host) {
        // QR butonları da bindKargoCardEvents içinde otomatik eklenir
        App.bindKargoCardEvents(host);
      }
    } catch (err) {
      if (App.isCurrent(token)) App.paint(token, "kargo-list", App.emptyState("bx-error", "Liste yüklenemedi", err.message));
    }
  }

  /* ============ Kargo Çıkışı Sayfası (v5) ============ */
  /* Depo görevlisinin kargolara QR kodu okutarak teslimat 
     onayladığı özel sayfa. Tarih ve saate göre filtrelenebilir. */

  let qrScannerActive = false;
  let scannedQrCodes = []; // { kargo_id, urun_id, timestamp }

  function generateQrCode(text) {
    // Basit QR kod JSON değeri oluştur (gerçek QR kütüphanesi gerekliyse eklenecek)
    return `qr:${btoa(text)}`;
  }

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
          <div class="card exit-scanner">
            <h3><i class='bx bx-qr'></i> QR Kod Okut</h3>
            <div class="scanner-input-group">
              <input 
                type="text" 
                id="qr-scanner-input" 
                class="input input--lg" 
                placeholder="QR kodunu buraya okutun..."
                autocomplete="off"
              />
              <button type="button" id="start-scan-btn" class="btn btn--primary">
                <i class='bx bx-camera'></i> Kameradan Oku
              </button>
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
        handleQrScan(code, token);
      }
    });

    document.getElementById("start-scan-btn").addEventListener("click", () => {
      openQrScanner(token);
    });

    document.getElementById("filter-by-date-btn").addEventListener("click", () => {
      const selectedDate = dateInput.valueAsDate;
      if (selectedDate) {
        loadExitHistory(token, selectedDate);
      }
    });

    loadExitHistory(token, new Date());
  }

  async function handleQrScan(qrData, token) {
    try {
      // QR verisi: "kargo:{kargoId}:urun:{urunId}" şeklinde olmalı
      const match = qrData.match(/kargo:(\d+)/);
      if (!match) {
        UI.toast("Geçersiz QR kodu", "error");
        return;
      }

      const kargoId = parseInt(match[1]);
      const timestamp = new Date();

      // Kargoyı getir
      const kargolar = await Api.select(
        "kargolar",
        `id=eq.${kargoId}&select=*`
      );

      if (!kargolar.length) {
        UI.toast("Kargo bulunamadı", "error");
        return;
      }

      const kargo = kargolar[0];

      // Durum güncelle
      await Api.update("kargolar", `id=eq.${kargoId}`, { durum: "Teslim Edildi", cikis_tarihi: timestamp.toISOString() });

      // Çıkış kaydı ekle
      await Api.insert("kargo_cikis_kayitlari", {
        kargo_id: kargoId,
        kullanici_id: currentUser.id,
        okutma_tarihi: timestamp.toISOString()
      });

      scannedQrCodes.push({ kargo_id: kargoId, timestamp });

      UI.toast(`${kargo.alici_ad_soyad} - Teslim Edildi olarak işaretlendi`, "success");
      loadExitHistory(token, new Date());
    } catch (err) {
      UI.toast(err.message || "İşlem başarısız", "error");
    }
  }

  async function loadExitHistory(token, selectedDate) {
    if (!App.isCurrent(token)) return;

    try {
      const dateStr = selectedDate.toISOString().split("T")[0];
      const nextDateStr = new Date(selectedDate.getTime() + 86400000).toISOString().split("T")[0];

      // Seçilen gün için çıkış kayıtlarını getir
      const kayitlar = await Api.select(
        "kargo_cikis_kayitlari",
        `okutma_tarihi=gte.${dateStr}T00:00:00&okutma_tarihi=lt.${nextDateStr}T00:00:00&select=*,kargolar(*)&order=okutma_tarihi.desc`
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

  function openQrScanner(token) {
    // HTML5 kamera API ile QR tarama açılacak
    // Basit bir fallback: bir prompt ile QR kodu manuel girebilir
    const qrText = prompt("QR kodunu yapıştırın:");
    if (qrText) {
      handleQrScan(qrText, token);
    }
  }

  return { mount };
})();
