/* ============================================================
   KargoTakip — Admin paneli
   v3: render-token korumalı asenkron güncellemeler, sadeleştirilmiş
   Genel Bakış ekranı, premium Depo Görevlileri kartları.
   ============================================================ */

const Admin = (() => {
  let currentUser = null;
  let allKargolar = [];
  let activeFilters = { durum: "hepsi", firma: "hepsi", q: "" };
  let selectMode = false;
  let selectedIds = [];

  function navItems() {
    return [
      { key: "ozet", label: "Genel Bakış", icon: "bx-bar-chart-alt-2" },
      { key: "kargolar", label: "Tüm Kargolar", icon: "bx-package" },
      { key: "gorevliler", label: "Depo Görevlileri", icon: "bx-group" },
      { key: "mesajlar", label: "Mesajlar", icon: "bx-message-dots" }
    ];
  }

  function mount(user) {
    currentUser = user;
    App.renderShell({
      role: "admin",
      user,
      navItems: navItems(),
      onNavigate: (key) => render(key)
    });
    Mesajlar.initGlobalWatcher(user, "admin");
    render("ozet");
  }

  function render(key) {
    App.setActiveNav(key);
    if (key === "kargolar") renderKargolarView();
    else if (key === "gorevliler") renderGorevlilerView();
    else if (key === "mesajlar") Mesajlar.mount(currentUser, "admin");
    else renderOzetView();
  }

  /* ---------------- Genel Bakış ---------------- */

  async function renderOzetView() {
    const saat = new Date().getHours();
    const selamlama = saat < 12 ? "Günaydın" : saat < 18 ? "İyi çalışmalar" : "İyi akşamlar";

    const token = App.setContent(`
      <div class="overview-banner">
        <div class="overview-banner__text">
          <div class="overview-banner__eyebrow"><i class='bx bxs-star'></i> Admin Paneli</div>
          <h1>${selamlama}, ${UI.escapeHtml(currentUser.ad_soyad.split(" ")[0])} 👋</h1>
          <p>İşte tüm depo faaliyetlerinin canlı özeti.</p>
        </div>
        <div class="overview-banner__chip" id="banner-tarih-chip">
          <i class='bx bx-calendar-week'></i>
          <div><strong>${new Date().toLocaleDateString("tr-TR", { day: "2-digit", month: "long" })}</strong>${new Date().toLocaleDateString("tr-TR", { weekday: "long" })}</div>
        </div>
        <i class='bx bxs-truck overview-banner__icon'></i>
      </div>

      <div id="stat-cards" class="stat-grid">${App.skeletonCards(5)}</div>

      <div class="section-heading"><i class='bx bx-trophy'></i> Performans</div>
      <div class="analytics-grid">
        <div class="card analytics-card">
          <h3><i class='bx bx-trophy'></i> Görevli Performansı</h3>
          <div id="leaderboard" class="leaderboard">${App.skeletonCards(3)}</div>
        </div>
        <div class="card analytics-card">
          <h3><i class='bx bx-line-chart'></i> Son 7 Gün Kargo Trendi</h3>
          <div id="trend-chart" class="trend-chart"></div>
        </div>
      </div>

      <div class="section-heading"><i class='bx bx-pie-chart-alt-2'></i> Dağılımlar</div>
      <div class="card analytics-card analytics-card--split">
        <div class="analytics-card__col">
          <h3><i class='bx bx-pie-chart-alt-2'></i> Kargo Firmasına Göre</h3>
          <div id="firma-chart" class="bar-chart"></div>
        </div>
        <div class="analytics-card__divider"></div>
        <div class="analytics-card__col">
          <h3><i class='bx bx-stats'></i> Durum Dağılımı</h3>
          <div id="durum-chart" class="bar-chart"></div>
        </div>
      </div>

      <div class="section-heading"><i class='bx bx-time-five'></i> Son Eklenen Kargolar</div>
      <div id="son-kargolar">${App.skeletonCards(3)}</div>
    `);

    try {
      const [kargolar, gorevliler] = await Promise.all([
        Api.select("kargolar", `select=${App.KARGO_LIST_SELECT},kullanicilar!ekleyen_kullanici_id(ad_soyad)&order=olusturma_tarihi.desc`),
        Api.select("kullanicilar", "rol=eq.depo&select=id,ad_soyad,aktif")
      ]);
      if (!App.isCurrent(token)) return;
      allKargolar = kargolar;

      const bugun = new Date().toDateString();
      const bugunSayisi = kargolar.filter((k) => new Date(k.olusturma_tarihi).toDateString() === bugun).length;
      const paketlendi = kargolar.filter((k) => k.durum === "Paketlendi").length;
      const teslimEdildi = kargolar.filter((k) => k.durum === "Teslim Edildi").length;
      const aktifGorevli = gorevliler.filter((g) => g.aktif !== false).length;

      App.paint(
        token,
        "stat-cards",
        [
          statCard("bx-package", "Toplam Kargo", kargolar.length, "#5B5FEF"),
          statCard("bx-calendar-plus", "Bugün Eklenen", bugunSayisi, "#0EA5E9"),
          statCard("bx-time-five", "Bekleyen (Paketlendi)", paketlendi, "#F59E0B"),
          statCard("bx-check-circle", "Teslim Edildi", teslimEdildi, "#22C55E")
        ].join("") + statCard("bx-group", "Aktif Görevli", aktifGorevli, "#EC4899")
      );

      renderLeaderboard(token, kargolar, gorevliler);
      renderTrendChart(token, kargolar);
      renderBarChart(token, "firma-chart", groupCount(kargolar, "kargo_firmasi"));
      renderBarChart(token, "durum-chart", groupCount(kargolar, "durum"));

      const son = kargolar.slice(0, 3);
      const sonHtml = son.length
        ? App.kargoTableHtml(son, { showEkleyen: true, showActions: true })
        : App.emptyState("bx-package", "Henüz kargo yok", "Depo görevlileri kargo ekledikçe burada görünecek.");
      App.paint(token, "son-kargolar", sonHtml);
      const sonHost = document.getElementById("son-kargolar");
      if (App.isCurrent(token) && sonHost) {
        App.bindKargoTableEvents(sonHost, son, { showEkleyen: true, showActions: true, onDeliver: markDelivered, onDelete: deleteKargo });
      }
    } catch (err) {
      if (App.isCurrent(token)) UI.toast(err.message || "Veriler yüklenemedi.", "error");
    }
  }

  function initialsOf(name = "") {
    return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("");
  }

  function renderLeaderboard(token, kargolar, gorevliler) {
    if (!App.isCurrent(token)) return;
    const bugun = new Date().toDateString();

    const sayac = {};
    kargolar.forEach((k) => {
      const uid = k.ekleyen_kullanici_id;
      if (uid == null) return;
      if (!sayac[uid]) sayac[uid] = { total: 0, today: 0 };
      sayac[uid].total += 1;
      if (new Date(k.olusturma_tarihi).toDateString() === bugun) sayac[uid].today += 1;
    });

    const rows = gorevliler
      .map((g) => ({
        ad_soyad: g.ad_soyad,
        kullanici_adi: g.kullanici_adi,
        id: g.id,
        total: sayac[g.id]?.total || 0,
        today: sayac[g.id]?.today || 0
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);

    if (!rows.length || rows.every((r) => r.total === 0)) {
      App.paint(token, "leaderboard", `<p class="muted-text">Henüz paketleme verisi yok.</p>`);
      return;
    }

    const max = Math.max(...rows.map((r) => r.total), 1);
    const html = rows
      .map((r, idx) => {
        const rank = idx + 1;
        const pct = Math.round((r.total / max) * 100);
        return `
        <div class="leaderboard-item">
          <div class="leaderboard-item__rank leaderboard-item__rank--${rank <= 3 ? rank : ""}">${rank}</div>
          <div class="leaderboard-item__avatar">${App.lowPolyAvatar(r.kullanici_adi || r.ad_soyad || String(r.id), 34)}</div>
          <div class="leaderboard-item__body">
            <div class="leaderboard-item__name">${UI.escapeHtml(r.ad_soyad)}</div>
            <div class="leaderboard-item__track"><div class="leaderboard-item__fill" style="width:${pct}%"></div></div>
          </div>
          <div class="leaderboard-item__stats">
            <div class="leaderboard-item__count">${r.total}</div>
            <div class="leaderboard-item__today">bugün ${r.today}</div>
          </div>
        </div>`;
      })
      .join("");
    App.paint(token, "leaderboard", html);
  }

  function renderTrendChart(token, kargolar) {
    if (!App.isCurrent(token)) return;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d);
    }
    const counts = days.map(
      (d) => kargolar.filter((k) => new Date(k.olusturma_tarihi).toDateString() === d.toDateString()).length
    );
    const max = Math.max(...counts, 1);
    const bugunStr = new Date().toDateString();
    const html = days
      .map((d, i) => {
        const isToday = d.toDateString() === bugunStr;
        const heightPct = Math.max(Math.round((counts[i] / max) * 100), 4);
        return `
        <div class="trend-col">
          <span class="trend-col__value">${counts[i]}</span>
          <div class="trend-col__bar ${isToday ? "trend-col__bar--today" : ""}" style="height:${heightPct}%"></div>
          <span class="trend-col__label">${d.toLocaleDateString("tr-TR", { weekday: "short" })}</span>
        </div>`;
      })
      .join("");
    App.paint(token, "trend-chart", html);
  }

  function statCard(icon, label, value, color) {
    return `
      <div class="card stat-card" style="--stat-color:${color}">
        <div class="stat-card__icon"><i class='bx ${icon}'></i></div>
        <div class="stat-card__value">${value}</div>
        <div class="stat-card__label">${label}</div>
      </div>`;
  }

  function groupCount(arr, field) {
    const map = {};
    arr.forEach((item) => {
      map[item[field]] = (map[item[field]] || 0) + 1;
    });
    return map;
  }

  function renderBarChart(token, hostId, dataMap) {
    if (!App.isCurrent(token)) return;
    const entries = Object.entries(dataMap);
    if (!entries.length) {
      App.paint(token, hostId, `<p class="muted-text">Henüz veri yok.</p>`);
      return;
    }
    const max = Math.max(...entries.map(([, v]) => v), 1);
    const html = entries
      .map(([label, value]) => {
        const pct = Math.round((value / max) * 100);
        return `
          <div class="bar-row">
            <span class="bar-row__label">${UI.escapeHtml(label)}</span>
            <div class="bar-row__track"><div class="bar-row__fill" style="width:${pct}%"></div></div>
            <span class="bar-row__value">${value}</span>
          </div>`;
      })
      .join("");
    App.paint(token, hostId, html);
  }

  /* ---------------- Tüm Kargolar ---------------- */

  async function renderKargolarView() {
    selectMode = false;
    selectedIds = [];
    const token = App.setContent(`
      <div class="view-header">
        <div>
          <h1>Tüm Kargolar</h1>
          <p class="view-sub">Tüm depo görevlilerinin eklediği kargolar.</p>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn btn--ghost" id="refresh-kargolar-btn"><i class='bx bx-refresh'></i> Yenile</button>
          <button class="btn btn--ghost" id="select-mode-btn"><i class='bx bx-checkbox-checked'></i> Seç</button>
          <button class="btn btn--success" id="mark-all-delivered-btn"><i class='bx bx-check-double'></i> Hepsini Teslim Edildi Olarak İşaretle</button>
        </div>
      </div>

      ${App.renderKargoFilterBar()}
      <div id="kargo-bulk-bar" class="kargo-bulk-bar" hidden></div>

      <div id="kargo-list">${App.skeletonCards(4)}</div>
    `);

    document.getElementById("refresh-kargolar-btn").addEventListener("click", renderKargolarView);
    document.getElementById("mark-all-delivered-btn").addEventListener("click", markAllDelivered);
    document.getElementById("select-mode-btn").addEventListener("click", () => {
      selectMode = !selectMode;
      selectedIds = [];
      document.getElementById("select-mode-btn").classList.toggle("btn--primary", selectMode);
      paintKargoList();
      renderBulkBar();
    });
    App.bindKargoFilterBar((patch) => {
      Object.assign(activeFilters, patch);
      paintKargoList();
    });

    await loadAllKargolar(token);
  }

  async function loadAllKargolar(token) {
    try {
      const data = await Api.select(
        "kargolar",
        `select=${App.KARGO_LIST_SELECT},kullanicilar!ekleyen_kullanici_id(ad_soyad)&order=olusturma_tarihi.desc`
      );
      if (!App.isCurrent(token)) return;
      allKargolar = data;
      paintKargoList();
    } catch (err) {
      if (App.isCurrent(token)) App.paint(token, "kargo-list", App.emptyState("bx-error", "Liste yüklenemedi", err.message));
    }
  }

  function paintKargoList() {
    const host = document.getElementById("kargo-list");
    if (!host) return;
    const list = App.filterKargolar(allKargolar, activeFilters);
    if (!list.length) {
      host.innerHTML = App.emptyState("bx-search-alt", "Sonuç bulunamadı", "Filtrelere uyan kargo bulunamadı.");
      return;
    }
    const selectedIdSet = new Set(selectedIds.map(String));
    host.innerHTML = App.kargoTableHtml(list, { showEkleyen: true, showActions: true, selectMode, selectedIds: selectedIdSet });
    App.bindKargoTableEvents(host, list, {
      showEkleyen: true,
      showActions: true,
      selectMode,
      onDeliver: markDelivered,
      onDelete: deleteKargo,
      onSelectionChange: (ids) => {
        selectedIds = ids;
        renderBulkBar();
      }
    });
  }

  /* ---------------- Toplu seçim çubuğu ("Seç" modu) ---------------- */

  function renderBulkBar() {
    const host = document.getElementById("kargo-bulk-bar");
    if (!host) return;
    if (!selectMode) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    host.hidden = false;
    host.innerHTML = `
      <span class="kargo-bulk-bar__count">${selectedIds.length} seçili</span>
      <button type="button" class="btn btn--ghost btn--sm" id="bulk-select-all-btn"><i class='bx bx-checkbox-checked'></i> Tümünü Seç</button>
      <button type="button" class="btn btn--success btn--sm" id="bulk-deliver-btn" ${selectedIds.length ? "" : "disabled"}><i class='bx bx-check-double'></i> Teslim Edildi İşaretle</button>
      <button type="button" class="btn btn--danger-ghost btn--sm" id="bulk-delete-btn" ${selectedIds.length ? "" : "disabled"}><i class='bx bx-trash'></i> Sil</button>
      <button type="button" class="btn btn--ghost btn--sm" id="bulk-cancel-btn">Vazgeç</button>
    `;
    document.getElementById("bulk-select-all-btn").addEventListener("click", () => {
      selectedIds = App.filterKargolar(allKargolar, activeFilters).map((k) => String(k.id));
      paintKargoList();
      renderBulkBar();
    });
    document.getElementById("bulk-deliver-btn").addEventListener("click", () => bulkMarkDelivered(selectedIds));
    document.getElementById("bulk-delete-btn").addEventListener("click", () => bulkDelete(selectedIds));
    document.getElementById("bulk-cancel-btn").addEventListener("click", () => {
      selectMode = false;
      selectedIds = [];
      document.getElementById("select-mode-btn")?.classList.remove("btn--primary");
      paintKargoList();
      renderBulkBar();
    });
  }

  function bulkMarkDelivered(ids) {
    if (!ids.length) return;
    UI.confirmDialog(
      `${ids.length} kargo "Teslim Edildi" olarak işaretlenecek.`,
      async () => {
        try {
          const nowIso = new Date().toISOString();
          await Api.update("kargolar", `id=in.(${ids.join(",")})`, {
            durum: "Teslim Edildi",
            cikis_tarihi: nowIso,
            teslim_eden_kullanici_id: currentUser.id,
            teslim_eden_adi: currentUser.ad_soyad
          });
          const idSet = new Set(ids);
          allKargolar.forEach((k) => {
            if (idSet.has(String(k.id))) {
              k.durum = "Teslim Edildi";
              k.cikis_tarihi = nowIso;
              k.teslim_eden_kullanici_id = currentUser.id;
              k.teslim_eden_adi = currentUser.ad_soyad;
            }
          });
          UI.toast(`${ids.length} kargo teslim edildi olarak işaretlendi.`, "success");
          selectMode = false;
          selectedIds = [];
          document.getElementById("select-mode-btn")?.classList.remove("btn--primary");
          paintKargoList();
          renderBulkBar();
        } catch (err) {
          UI.toast(err.message || "Güncellenemedi.", "error");
        }
      },
      { title: "Seçilenleri teslim edildi işaretle", confirmLabel: "Evet, işaretle" }
    );
  }

  function bulkDelete(ids) {
    if (!ids.length) return;
    UI.confirmDialog(
      `${ids.length} kargo kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
      async () => {
        try {
          await Api.remove("kargolar", `id=in.(${ids.join(",")})`);
          const idSet = new Set(ids);
          allKargolar = allKargolar.filter((k) => !idSet.has(String(k.id)));
          UI.toast(`${ids.length} kargo silindi.`, "success");
          selectMode = false;
          selectedIds = [];
          document.getElementById("select-mode-btn")?.classList.remove("btn--primary");
          paintKargoList();
          renderBulkBar();
        } catch (err) {
          UI.toast(err.message || "Silinemedi.", "error");
        }
      },
      { title: "Seçilenleri sil", confirmLabel: "Evet, sil", danger: true }
    );
  }

  async function markDelivered(id) {
    try {
      const nowIso = new Date().toISOString();
      await Api.update("kargolar", `id=eq.${id}`, {
        durum: "Teslim Edildi",
        cikis_tarihi: nowIso,
        teslim_eden_kullanici_id: currentUser.id,
        teslim_eden_adi: currentUser.ad_soyad
      });
      UI.toast("Kargo teslim edildi olarak işaretlendi.", "success");
      const k = allKargolar.find((x) => String(x.id) === String(id));
      if (k) {
        k.durum = "Teslim Edildi";
        k.cikis_tarihi = nowIso;
        k.teslim_eden_kullanici_id = currentUser.id;
        k.teslim_eden_adi = currentUser.ad_soyad;
      }
      if (document.getElementById("kargo-list")) paintKargoList();
      if (document.getElementById("son-kargolar")) renderOzetView();
    } catch (err) {
      UI.toast(err.message || "Güncellenemedi.", "error");
    }
  }

  function markAllDelivered() {
    const bekleyenler = App.filterKargolar(allKargolar, activeFilters).filter((k) => k.durum !== "Teslim Edildi");
    if (!bekleyenler.length) {
      UI.toast("İşaretlenecek bekleyen kargo bulunamadı.", "info");
      return;
    }
    const filtreliMi = activeFilters.durum !== "hepsi" || activeFilters.firma !== "hepsi" || activeFilters.q;
    UI.confirmDialog(
      `${bekleyenler.length} kargo${filtreliMi ? " (mevcut filtreye uyan)" : ""} "Teslim Edildi" olarak işaretlenecek. Bu işlem geri alınamaz.`,
      async () => {
        const btn = document.getElementById("mark-all-delivered-btn");
        if (btn) { btn.disabled = true; btn.classList.add("btn--loading"); }
        try {
          const ids = bekleyenler.map((k) => k.id).join(",");
          const nowIso = new Date().toISOString();
          await Api.update("kargolar", `id=in.(${ids})`, {
            durum: "Teslim Edildi",
            cikis_tarihi: nowIso,
            teslim_eden_kullanici_id: currentUser.id,
            teslim_eden_adi: currentUser.ad_soyad
          });
          const idSet = new Set(bekleyenler.map((k) => String(k.id)));
          allKargolar.forEach((k) => {
            if (idSet.has(String(k.id))) {
              k.durum = "Teslim Edildi";
              k.cikis_tarihi = nowIso;
              k.teslim_eden_kullanici_id = currentUser.id;
              k.teslim_eden_adi = currentUser.ad_soyad;
            }
          });
          UI.toast(`${bekleyenler.length} kargo teslim edildi olarak işaretlendi.`, "success");
          paintKargoList();
        } catch (err) {
          UI.toast(err.message || "Toplu güncelleme başarısız oldu.", "error");
        } finally {
          if (btn) { btn.disabled = false; btn.classList.remove("btn--loading"); }
        }
      },
      { title: "Hepsini teslim edildi olarak işaretle", confirmLabel: "Evet, işaretle" }
    );
  }

  function deleteKargo(id) {
    UI.confirmDialog(
      "Bu kargo kaydı ve ilişkili tüm ürün/fotoğraf bilgileri kalıcı olarak silinecek.",
      async () => {
        try {
          await Api.remove("kargolar", `id=eq.${id}`);
          UI.toast("Kargo silindi.", "success");
          allKargolar = allKargolar.filter((x) => String(x.id) !== String(id));
          if (document.getElementById("kargo-list")) paintKargoList();
          if (document.getElementById("son-kargolar")) renderOzetView();
        } catch (err) {
          UI.toast(err.message || "Silinemedi.", "error");
        }
      },
      { title: "Kargoyu sil", confirmLabel: "Evet, sil", danger: true }
    );
  }

  /* ---------------- Depo Görevlileri ---------------- */

  async function renderGorevlilerView() {
    const token = App.setContent(`
      <div class="view-header">
        <div>
          <h1>Depo Görevlileri</h1>
          <p class="view-sub">Görevli ekleyin, pasifleştirin veya silin.</p>
        </div>
        <button class="btn btn--primary" id="add-gorevli-btn"><i class='bx bx-user-plus'></i> Yeni Görevli Ekle</button>
      </div>
      <div id="gorevli-list" class="gorevli-grid">${App.skeletonCards(3)}</div>
    `);
    document.getElementById("add-gorevli-btn").addEventListener("click", openAddGorevliModal);
    await loadGorevliler(token);
  }

  async function loadGorevliler(token) {
    try {
      const [gorevliler, kargolar] = await Promise.all([
        Api.select("kullanicilar", "rol=eq.depo&select=*&order=olusturma_tarihi.desc"),
        Api.select("kargolar", "select=id,durum,ekleyen_kullanici_id")
      ]);
      if (!App.isCurrent(token)) return;
      if (!gorevliler.length) {
        App.paint(token, "gorevli-list", App.emptyState("bx-group", "Henüz görevli yok", "Yeni Görevli Ekle butonuyla ilk depo görevlisini oluşturun."));
        return;
      }
      const sayac = {};
      kargolar.forEach((k) => {
        const uid = k.ekleyen_kullanici_id;
        if (uid == null) return;
        if (!sayac[uid]) sayac[uid] = { total: 0, teslim: 0 };
        sayac[uid].total += 1;
        if (k.durum === "Teslim Edildi") sayac[uid].teslim += 1;
      });
      const html = gorevliler
        .map((g) => {
          const s = sayac[g.id] || { total: 0, teslim: 0 };
          const aktif = g.aktif !== false;
          return `
        <div class="card gorevli-card ${aktif ? "" : "gorevli-card--pasif"}">
          <div class="gorevli-card__top">
            <div class="gorevli-card__avatar">${App.lowPolyAvatar(g.kullanici_adi || g.ad_soyad || String(g.id), 60)}</div>
            <span class="badge ${aktif ? "badge--success" : "badge--muted"} gorevli-card__badge">
              <i class='bx ${aktif ? "bx-check-circle" : "bx-pause-circle"}'></i>
              ${aktif ? "Aktif" : "Pasif"}
            </span>
          </div>
          <div class="gorevli-card__info">
            <strong>${UI.escapeHtml(g.ad_soyad)}</strong>
            <span>@${UI.escapeHtml(g.kullanici_adi)}</span>
          </div>
          <div class="gorevli-card__stats">
            <div class="gorevli-card__stat">
              <i class='bx bx-package'></i>
              <div><strong>${s.total}</strong><span>paketledi</span></div>
            </div>
            <div class="gorevli-card__stat">
              <i class='bx bx-check-circle'></i>
              <div><strong>${s.teslim}</strong><span>teslim</span></div>
            </div>
          </div>
          <div class="gorevli-card__actions">
            <button class="btn btn--sm btn--ghost js-toggle-active" data-id="${g.id}" data-active="${aktif}">
              <i class='bx ${aktif ? "bx-block" : "bx-check-circle"}'></i>
              ${aktif ? "Pasif Et" : "Aktif Et"}
            </button>
            <button class="btn btn--sm btn--danger-ghost js-delete-gorevli" data-id="${g.id}">
              <i class='bx bx-trash'></i> Sil
            </button>
          </div>
        </div>`;
        })
        .join("");

      App.paint(token, "gorevli-list", html);
      const host = document.getElementById("gorevli-list");
      if (!App.isCurrent(token) || !host) return;
      host.querySelectorAll(".js-toggle-active").forEach((btn) =>
        btn.addEventListener("click", () => toggleGorevliActive(btn.dataset.id, btn.dataset.active === "true"))
      );
      host.querySelectorAll(".js-delete-gorevli").forEach((btn) =>
        btn.addEventListener("click", () => deleteGorevli(btn.dataset.id))
      );
    } catch (err) {
      if (App.isCurrent(token)) App.paint(token, "gorevli-list", App.emptyState("bx-error", "Görevliler yüklenemedi", err.message));
    }
  }

  function openAddGorevliModal() {
    UI.openModal(`
      <h3 class="modal-title">Yeni Depo Görevlisi</h3>
      <form id="add-gorevli-form" class="modal-form">
        <label class="form-label">Ad Soyad</label>
        <input class="input" id="g-adsoyad" type="text" required />
        <label class="form-label">Kullanıcı Adı</label>
        <input class="input" id="g-kadi" type="text" required autocomplete="off" />
        <label class="form-label">Şifre</label>
        <input class="input" id="g-sifre" type="text" required autocomplete="off" />
        <div class="modal-actions">
          <button type="button" class="btn btn--ghost" data-close-modal>Vazgeç</button>
          <button type="submit" class="btn btn--primary" id="g-submit-btn">Ekle</button>
        </div>
      </form>
    `);
    document.getElementById("add-gorevli-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const ad_soyad = document.getElementById("g-adsoyad").value.trim();
      const kullanici_adi = document.getElementById("g-kadi").value.trim();
      const sifre = document.getElementById("g-sifre").value;
      if (!ad_soyad || !kullanici_adi || !sifre) return;

      const btn = document.getElementById("g-submit-btn");
      btn.disabled = true;
      try {
        await Api.insert("kullanicilar", { ad_soyad, kullanici_adi, sifre, rol: "depo" });
        UI.toast("Depo görevlisi eklendi.", "success");
        UI.closeModal();
        renderGorevlilerView();
      } catch (err) {
        UI.toast(err.message || "Eklenemedi. Kullanıcı adı zaten alınmış olabilir.", "error");
        btn.disabled = false;
      }
    });
  }

  async function toggleGorevliActive(id, isActive) {
    try {
      await Api.update("kullanicilar", `id=eq.${id}`, { aktif: !isActive });
      UI.toast(!isActive ? "Görevli aktif edildi." : "Görevli pasif edildi.", "success");
      renderGorevlilerView();
    } catch (err) {
      UI.toast(err.message || "Güncellenemedi.", "error");
    }
  }

  function deleteGorevli(id) {
    UI.confirmDialog(
      "Bu görevli silinecek. Görevliye ait kargo kayıtları sistemde kalmaya devam eder.",
      async () => {
        try {
          await Api.remove("kullanicilar", `id=eq.${id}`);
          UI.toast("Görevli silindi.", "success");
          renderGorevlilerView();
        } catch (err) {
          UI.toast(
            "Silinemedi. Bu görevliye ait kargo kayıtları olduğu için önce o kargoları silmeniz gerekebilir.",
            "error"
          );
        }
      },
      { title: "Görevliyi sil", confirmLabel: "Evet, sil", danger: true }
    );
  }

  return { mount };
})();
