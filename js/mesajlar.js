/* ============================================================
   KargoTakip — Mesajlar modülü
   Admin ile depo görevlileri arasında WhatsApp benzeri grup
   sohbeti. Acil etiketli ve henüz cevaplanmamış talepler için
   depo ekranında sürekli tekrar eden uyarı (banner + üstten
   bildirim + sesli alarm) gösterir.
   ============================================================ */

const Mesajlar = (() => {
  const ACIL_ALARM_MS = 15000; // 15 saniyede bir tekrar
  const SOUND_SRC = "assets/sound.mp3";

  let currentUser = null;
  let currentRole = null; // 'admin' | 'depo'

  let activeTab = "acik";
  let activeTalepId = null;
  let pendingOpenTalepId = null;
  let composePhotoBuffer = [];

  let listPollInterval = null;
  let threadPollInterval = null;
  let globalWatcherInterval = null;

  let lastKnownDurum = null;

  let alarmActive = false;
  let alarmIntervalId = null;

  let lastSeenMaxMsgId = 0;
  let audioUnlockAttached = false;

  /* ---------------- Host elemanları (görünüm değişse de kalıcı) ---------------- */

  function ensureHostElements() {
    if (!document.getElementById("acil-audio")) {
      const audio = document.createElement("audio");
      audio.id = "acil-audio";
      audio.src = SOUND_SRC;
      audio.preload = "auto";
      document.body.appendChild(audio);
    }
    if (!document.getElementById("acil-banner-host")) {
      const host = document.createElement("div");
      host.id = "acil-banner-host";
      host.className = "acil-banner-host";
      document.body.appendChild(host);
    }
    if (!document.getElementById("top-alert-host")) {
      const host = document.createElement("div");
      host.id = "top-alert-host";
      host.className = "top-alert-host";
      document.body.appendChild(host);
    }
    unlockAudioOnFirstInteraction();
  }

  /**
   * Tarayıcıların otomatik oynatma (autoplay) politikası, sayfa hiç
   * etkileşim almadan JS'ten tetiklenen `.play()` çağrılarını sessizce
   * reddedebiliyor — depo görevlisinin ekranı saatlerce dokunulmadan
   * açık kaldığı, ilk acil mesajın tam da o sırada geldiği bir senaryoda
   * sesli alarmın hiç çalmaması riski var (görsel banner/üst-uyarı yine
   * de görünür, ama görevli o an ekrana bakmıyorsa fark etmeyebilir).
   * Bu yüzden sayfadaki İLK tıklama/dokunma/tuş basımında sesi kısık
   * seviyede bir kez "hazırlayıp" (çal + hemen duraklat) tarayıcının
   * bu origin için otomatik oynatmaya izin vermesini sağlıyoruz —
   * gerçek alarm o andan sonra güvenilir şekilde çalabiliyor.
   */
  function unlockAudioOnFirstInteraction() {
    if (audioUnlockAttached) return;
    audioUnlockAttached = true;
    const events = ["click", "touchstart", "keydown"];
    const unlock = () => {
      events.forEach((ev) => document.removeEventListener(ev, unlock));
      const audio = document.getElementById("acil-audio");
      if (!audio) return;
      audio.muted = true;
      audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        })
        .catch(() => {
          audio.muted = false;
        });
    };
    events.forEach((ev) => document.addEventListener(ev, unlock, { passive: true }));
  }

  function navItem() {
    return { key: "mesajlar", label: "Mesajlar", icon: "bx-message-dots" };
  }

  /* ---------------- Genel (arkaplan) izleyici ---------------- */
  /* Kullanıcı hangi sayfada olursa olsun çalışır: sidebar rozeti,
     yeni mesaj bildirimleri ve (depo için) acil alarm döngüsü. */

  function initGlobalWatcher(user, role) {
    currentUser = user;
    currentRole = role;
    ensureHostElements();
    pollGlobalState();
    if (globalWatcherInterval) clearInterval(globalWatcherInterval);
    globalWatcherInterval = setInterval(pollGlobalState, 7000);
  }

  async function pollGlobalState() {
    if (!currentUser) return;
    try {
      const msgs = await Api.select(
        "mesaj_talep_mesajlari",
        `gonderen_kullanici_id=neq.${currentUser.id}&select=id,talep_id,gonderim_tarihi,gonderen_rol,kullanicilar(ad_soyad),mesaj_okuma_kayitlari(kullanici_id),mesaj_talepleri!inner(durum)&mesaj_talepleri.durum=eq.acik&order=id.desc&limit=400`
      );

      const unread = msgs.filter(
        (m) => !(m.mesaj_okuma_kayitlari || []).some((r) => r.kullanici_id === currentUser.id)
      );
      updateNavBadge(unread.length);

      const maxId = msgs.length ? Math.max(...msgs.map((m) => m.id)) : 0;
      if (lastSeenMaxMsgId && maxId > lastSeenMaxMsgId) {
        const newer = msgs.filter((m) => m.id > lastSeenMaxMsgId && m.talep_id !== activeTalepId);
        if (newer.length === 1) {
          const s = newer[0];
          const isim = s.kullanicilar?.ad_soyad || (s.gonderen_rol === "admin" ? "Admin" : "Depo görevlisi");
          UI.toast(`${isim} yeni bir mesaj gönderdi.`, "info");
        } else if (newer.length > 1) {
          UI.toast(`${newer.length} yeni mesaj var.`, "info");
        }
        if (typeof NotificationCenter !== "undefined") {
          newer.forEach((s) => {
            const isim = s.kullanicilar?.ad_soyad || (s.gonderen_rol === "admin" ? "Admin" : "Depo görevlisi");
            NotificationCenter.push("mesaj", `${isim} yeni bir mesaj gönderdi`, "Görüntülemek için dokunun.", {
              dedupeKey: `mesaj-${s.id}`,
              nav: "mesajlar"
            });
          });
        }
      }
      lastSeenMaxMsgId = Math.max(lastSeenMaxMsgId, maxId);

      if (currentRole === "depo") await checkAcilAlarm();
    } catch {
      /* sessiz geç, bağlantı sorunu kullanıcıyı rahatsız etmesin */
    }
  }

  function updateNavBadge(count) {
    if (typeof App !== "undefined" && App.setNavBadge) App.setNavBadge("mesajlar", count);
  }

  /* ---------------- Acil alarm döngüsü (sadece depo görevlisi) ---------------- */

  async function checkAcilAlarm() {
    try {
      const acilList = await Api.select(
        "mesaj_talepleri",
        "aciliyet=eq.acil&durum=eq.acik&cevaplandi=eq.false&select=id,konu,olusturma_tarihi,kullanicilar(ad_soyad)&order=olusturma_tarihi.asc"
      );
      if (acilList.length) activateAlarm(acilList);
      else deactivateAlarm();
    } catch {
      /* sessiz geç */
    }
  }

  function activateAlarm(list) {
    renderBanner(list);
    if (alarmActive) return; // döngü zaten çalışıyor, sadece banner içeriğini güncelle
    alarmActive = true;
    if (typeof NotificationCenter !== "undefined") {
      const first = list[0];
      const adminName = first.kullanicilar?.ad_soyad || "Admin";
      NotificationCenter.push(
        "sistem",
        "Acil yanıt bekleniyor",
        `${adminName}: ${(first.konu || "").slice(0, 70)}`,
        { dedupeKey: `acil-${first.id}-${Math.floor(Date.now() / 60000)}`, nav: "mesajlar" }
      );
    }
    playAlarmCycle();
    alarmIntervalId = setInterval(playAlarmCycle, ACIL_ALARM_MS);
  }

  function deactivateAlarm() {
    alarmActive = false;
    if (alarmIntervalId) {
      clearInterval(alarmIntervalId);
      alarmIntervalId = null;
    }
    const host = document.getElementById("acil-banner-host");
    if (host) host.innerHTML = "";
  }

  function playAlarmCycle() {
    showTopAlert();
    playSoundTwice();
  }

  function playSoundTwice() {
    const audio = document.getElementById("acil-audio");
    if (!audio) return;
    const playOnce = () =>
      new Promise((resolve) => {
        audio.currentTime = 0;
        const onEnded = () => {
          audio.removeEventListener("ended", onEnded);
          resolve();
        };
        audio.addEventListener("ended", onEnded);
        audio.play().catch(() => resolve());
      });
    playOnce().then(() => playOnce());
  }

  function renderBanner(list) {
    const host = document.getElementById("acil-banner-host");
    if (!host) return;
    const first = list[0];
    const adminName = first.kullanicilar?.ad_soyad || "Admin";
    const extra = list.length > 1 ? ` (+${list.length - 1} acil talep daha)` : "";
    host.innerHTML = `
      <div class="acil-banner">
        <i class='bx bx-error-circle'></i>
        <div class="acil-banner__text">
          ACİL YANIT BEKLENİYOR${extra}
          <small>${UI.escapeHtml(adminName)}: ${UI.escapeHtml((first.konu || "").slice(0, 70))}</small>
        </div>
        <button type="button" class="acil-banner__btn" id="acil-banner-goto">Görüntüle</button>
      </div>`;
    const gotoBtn = document.getElementById("acil-banner-goto");
    if (gotoBtn) gotoBtn.addEventListener("click", () => openFromAlarm(first.id));
  }

  function showTopAlert() {
    const host = document.getElementById("top-alert-host");
    if (!host) return;
    const el = document.createElement("div");
    el.className = "top-alert";
    el.innerHTML = `
      <i class='bx bx-bell'></i>
      <div><strong>ACİL BİLGİ BEKLENİYOR</strong><span>Yanıt bekleyen acil bir mesaj var.</span></div>`;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("top-alert--in"));
    setTimeout(() => {
      el.classList.remove("top-alert--in");
      setTimeout(() => el.remove(), 400);
    }, 4200);
  }

  function openFromAlarm(talepId) {
    pendingOpenTalepId = talepId;
    activeTab = "acik";
    const navBtn = document.querySelector('.nav-item[data-key="mesajlar"]');
    if (navBtn) navBtn.click();
    else renderShellView();
  }

  /* ---------------- Görünüm: Mesajlar ana ekranı ---------------- */

  function mount(user, role) {
    currentUser = user;
    currentRole = role;
    renderShellView();
  }

  function renderShellView() {
    activeTalepId = null;
    composePhotoBuffer = [];

    const html = `
      <div class="view-header">
        <div>
          <h1>Mesajlar</h1>
          <p class="view-sub">${
            currentRole === "admin"
              ? "Depo görevlileriyle olan iletişim kanalınız."
              : "Admin ile olan iletişim kanalınız."
          }</p>
        </div>
        ${
          currentRole === "admin"
            ? `<button class="btn btn--primary" id="yeni-talep-btn"><i class='bx bx-plus'></i> Yeni Talep</button>`
            : ""
        }
      </div>

      <div class="mesajlar-layout" id="mesajlar-layout">
        <div class="mesajlar-list">
          <div class="mesajlar-tabs">
            <button type="button" class="mesajlar-tab ${activeTab === "acik" ? "mesajlar-tab--active" : ""}" data-tab="acik">Açık Talepler</button>
            <button type="button" class="mesajlar-tab ${activeTab === "kapali" ? "mesajlar-tab--active" : ""}" data-tab="kapali">Kapalı Talepler</button>
          </div>
          <div class="mesajlar-list__items" id="mesajlar-items">${App.skeletonCards(3)}</div>
        </div>
        <div class="mesajlar-thread" id="mesajlar-thread-pane">
          ${threadPlaceholder()}
        </div>
      </div>
    `;

    const token = App.setContent(html);

    const yeniBtn = document.getElementById("yeni-talep-btn");
    if (yeniBtn) yeniBtn.addEventListener("click", openYeniTalepModal);

    document.querySelectorAll(".mesajlar-tab").forEach((btn) =>
      btn.addEventListener("click", () => {
        if (btn.dataset.tab === activeTab) return;
        activeTab = btn.dataset.tab;
        document.querySelectorAll(".mesajlar-tab").forEach((b) => b.classList.remove("mesajlar-tab--active"));
        btn.classList.add("mesajlar-tab--active");
        document.getElementById("mesajlar-layout")?.classList.remove("mesajlar-layout--thread-open");
        App.paint(token, "mesajlar-thread-pane", threadPlaceholder());
        loadTalepler(token, activeTab);
      })
    );

    loadTalepler(token, activeTab);

    if (listPollInterval) clearInterval(listPollInterval);
    listPollInterval = setInterval(() => {
      if (!App.isCurrent(token)) {
        clearInterval(listPollInterval);
        listPollInterval = null;
        return;
      }
      loadTalepler(token, activeTab);
    }, 6000);
  }

  function threadPlaceholder() {
    return `
      <div class="mesajlar-thread__empty">
        <i class='bx bx-message-dots'></i>
        <p>Görüntülemek için soldan bir mesaj seçin.</p>
      </div>`;
  }

  /* ---------------- Talep listesi ---------------- */

  async function loadTalepler(token, tab) {
    try {
      const talepler = await Api.select(
        "mesaj_talepleri",
        `durum=eq.${tab === "acik" ? "acik" : "kapali"}&select=*,kullanicilar(ad_soyad)&order=olusturma_tarihi.desc`
      );
      if (!App.isCurrent(token)) return;

      if (!talepler.length) {
        App.paint(
          token,
          "mesajlar-items",
          App.emptyState(
            "bx-message-dots",
            tab === "acik" ? "Açık talep yok" : "Kapalı talep yok",
            tab === "acik" ? "Admin yeni bir talep oluşturduğunda burada görünecek." : "Kapatılan talepler burada listelenir."
          )
        );
        return;
      }

      const ids = talepler.map((t) => t.id).join(",");
      let msgMap = {};
      try {
        const msgs = await Api.select(
          "mesaj_talep_mesajlari",
          `talep_id=in.(${ids})&select=id,talep_id,icerik,foto_base64,gonderim_tarihi,gonderen_kullanici_id,mesaj_okuma_kayitlari(kullanici_id)&order=gonderim_tarihi.asc`
        );
        msgs.forEach((m) => {
          if (!msgMap[m.talep_id]) msgMap[m.talep_id] = [];
          msgMap[m.talep_id].push(m);
        });
      } catch {
        /* önizleme alınamazsa liste yine de gösterilsin */
      }
      if (!App.isCurrent(token)) return;

      const html = talepler
        .map((t) => {
          const list = msgMap[t.id] || [];
          const last = list[list.length - 1];
          const unread = list.filter(
            (m) =>
              m.gonderen_kullanici_id !== currentUser.id &&
              !(m.mesaj_okuma_kayitlari || []).some((r) => r.kullanici_id === currentUser.id)
          ).length;
          const acil = t.aciliyet === "acil";
          const preview = last ? last.icerik || (last.foto_base64 ? "📷 Görsel" : "") : t.konu;

          return `
          <button type="button" class="mesajlar-item ${acil ? "mesajlar-item--acil" : ""}" data-id="${t.id}">
            <div class="mesajlar-item__icon"><i class='bx ${acil ? "bx-error" : "bx-message-rounded-dots"}'></i></div>
            <div class="mesajlar-item__body">
              <div class="mesajlar-item__top">
                <span class="mesajlar-item__title">${UI.escapeHtml(t.konu)}</span>
                <span class="mesajlar-item__time">${UI.timeAgo(last ? last.gonderim_tarihi : t.olusturma_tarihi)}</span>
              </div>
              <div class="mesajlar-item__preview">${UI.escapeHtml(preview || "")}</div>
              <div class="mesajlar-item__tags">
                <span class="badge ${acil ? "badge--danger" : "badge--muted"}">${acil ? "Acil" : "Normal"}</span>
                ${currentRole === "depo" ? `<span class="mesajlar-item__by">${UI.escapeHtml(t.kullanicilar?.ad_soyad || "Admin")}</span>` : ""}
              </div>
            </div>
            ${unread ? `<span class="mesajlar-item__unread">${unread}</span>` : ""}
          </button>`;
        })
        .join("");

      App.paint(token, "mesajlar-items", html);
      const host = document.getElementById("mesajlar-items");
      if (App.isCurrent(token) && host) {
        host.querySelectorAll(".mesajlar-item").forEach((btn) => {
          if (String(activeTalepId) === btn.dataset.id) btn.classList.add("mesajlar-item--active");
          btn.addEventListener("click", () => openThread(Number(btn.dataset.id)));
        });
      }

      if (pendingOpenTalepId) {
        const pid = pendingOpenTalepId;
        pendingOpenTalepId = null;
        openThread(pid);
      }
    } catch (err) {
      if (App.isCurrent(token)) App.paint(token, "mesajlar-items", App.emptyState("bx-error", "Yüklenemedi", err.message));
    }
  }

  /* ---------------- Yeni talep oluşturma (sadece admin) ---------------- */

  function openYeniTalepModal() {
    UI.openModal(`
      <h3 class="modal-title">Yeni Mesaj Talebi</h3>
      <form id="yeni-talep-form" class="modal-form">
        <label class="form-label">Mesajınız / Sorunuz</label>
        <textarea id="talep-metin" class="input" rows="4" placeholder="Depo görevlilerine iletmek istediğiniz mesajı yazın..." required style="resize:vertical;"></textarea>
        <label class="form-label">Aciliyet</label>
        <div class="aciliyet-toggle" id="aciliyet-toggle">
          <button type="button" class="aciliyet-opt aciliyet-opt--normal aciliyet-opt--active" data-aciliyet="normal">
            <i class='bx bx-message-rounded-detail'></i> Normal
          </button>
          <button type="button" class="aciliyet-opt aciliyet-opt--acil" data-aciliyet="acil">
            <i class='bx bx-error'></i> Acil
          </button>
        </div>
        <p class="muted-text" id="aciliyet-hint">Normal mesajlar sessizce bildirim olarak düşer ve sidebardaki Mesajlar butonunda görünür.</p>
        <div class="modal-actions">
          <button type="button" class="btn btn--ghost" data-close-modal>Vazgeç</button>
          <button type="submit" class="btn btn--primary" id="talep-submit-btn">Gönder</button>
        </div>
      </form>
    `);

    let secilenAciliyet = "normal";
    const hint = document.getElementById("aciliyet-hint");
    document.querySelectorAll(".aciliyet-opt").forEach((btn) =>
      btn.addEventListener("click", () => {
        document.querySelectorAll(".aciliyet-opt").forEach((b) => b.classList.remove("aciliyet-opt--active"));
        btn.classList.add("aciliyet-opt--active");
        secilenAciliyet = btn.dataset.aciliyet;
        hint.textContent =
          secilenAciliyet === "acil"
            ? "Acil mesajlar cevaplanana kadar depo görevlilerinin ekranında sürekli uyarı metni ve sesli bildirim gösterir."
            : "Normal mesajlar sessizce bildirim olarak düşer ve sidebardaki Mesajlar butonunda görünür.";
      })
    );

    document.getElementById("yeni-talep-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const metin = document.getElementById("talep-metin").value.trim();
      if (!metin) return;
      const btn = document.getElementById("talep-submit-btn");
      btn.disabled = true;
      btn.classList.add("btn--loading");
      try {
        const inserted = await Api.insert("mesaj_talepleri", {
          konu: metin,
          aciliyet: secilenAciliyet,
          durum: "acik",
          cevaplandi: false,
          olusturan_admin_id: currentUser.id
        });
        const talep = inserted[0];
        await Api.insert("mesaj_talep_mesajlari", {
          talep_id: talep.id,
          gonderen_kullanici_id: currentUser.id,
          gonderen_rol: "admin",
          icerik: metin
        });
        UI.toast("Talep oluşturuldu ve depo görevlilerine iletildi.", "success");
        UI.closeModal();
        activeTab = "acik";
        pendingOpenTalepId = talep.id;
        renderShellView();
      } catch (err) {
        UI.toast(err.message || "Talep oluşturulamadı.", "error");
        btn.disabled = false;
        btn.classList.remove("btn--loading");
      }
    });
  }

  /* ---------------- Sohbet paneli ---------------- */

  async function openThread(id) {
    activeTalepId = id;
    lastKnownDurum = null;
    document.getElementById("mesajlar-layout")?.classList.add("mesajlar-layout--thread-open");
    document.querySelectorAll(".mesajlar-item").forEach((el) =>
      el.classList.toggle("mesajlar-item--active", el.dataset.id === String(id))
    );
    const paneToken = App.currentToken();
    App.paint(
      paneToken,
      "mesajlar-thread-pane",
      `<div class="mesajlar-thread__empty"><i class='bx bx-loader-alt bx-spin'></i><p>Yükleniyor...</p></div>`
    );
    await loadThread(id);
    startThreadPolling(id);
  }

  /**
   * talep + mesajları yükler.
   * isPoll=false (ilk açılış / durum değişikliği): tüm paneli (başlık +
   * mesajlar + yazma kutusu) yeniden çizer.
   * isPoll=true (4 saniyelik arka plan yenilemesi): SADECE mesaj listesini
   * günceller; yazma kutusuna hiç dokunmaz. Önceki sürümde her pollde tüm
   * panel yeniden çizildiği için, kullanıcı mesaj yazarken input elemanı
   * yok edilip yeniden oluşturuluyor, bu da yazılanı silip odağı
   * kaybettiriyordu (kullanıcının bildirdiği "2-3 saniyede kutu siliniyor"
   * sorunu). Artık yazma kutusu, talep açık kaldığı sürece pollerden
   * etkilenmiyor.
   */
  async function loadThread(talepId, { isPoll = false } = {}) {
    const paneToken = App.currentToken();
    try {
      const [talepRows, messages] = await Promise.all([
        Api.select("mesaj_talepleri", `id=eq.${talepId}&select=*,kullanicilar(ad_soyad,kullanici_adi)`),
        Api.select(
          "mesaj_talep_mesajlari",
          `talep_id=eq.${talepId}&select=*,kullanicilar(ad_soyad,rol,kullanici_adi),mesaj_okuma_kayitlari(kullanici_id)&order=gonderim_tarihi.asc`
        )
      ]);
      if (!App.isCurrent(paneToken) || activeTalepId !== talepId) return;
      const talep = talepRows && talepRows[0];
      if (!talep) return;

      const durumChanged = lastKnownDurum !== null && lastKnownDurum !== talep.durum;

      if (!isPoll || durumChanged) {
        App.paint(paneToken, "mesajlar-thread-pane", threadHtml(talep, messages));
        if (App.isCurrent(paneToken)) {
          bindThreadEvents(talep);
          scrollThreadToBottom();
          markMessagesRead(messages);
        }
      } else {
        const painted = App.paint(paneToken, "mesaj-thread-body", messagesHtml(messages));
        if (App.isCurrent(paneToken) && painted) {
          const body = document.getElementById("mesaj-thread-body");
          if (body) {
            body.querySelectorAll(".js-msg-lightbox").forEach((img) =>
              img.addEventListener("click", () => openImageLightbox(img.src))
            );
          }
          scrollThreadToBottom();
          markMessagesRead(messages);
        }
      }
      lastKnownDurum = talep.durum;
    } catch (err) {
      if (App.isCurrent(paneToken) && !isPoll) UI.toast(err.message || "Mesajlar yüklenemedi.", "error");
    }
  }

  function messagesHtml(messages) {
    return messages.length ? messages.map(renderMessage).join("") : `<div class="mesaj-thread__empty-msgs">Henüz mesaj yok.</div>`;
  }

  function threadHtml(talep, messages) {
    return `
      <div id="mesaj-thread-header-host">${renderThreadHeader(talep)}</div>
      <div class="mesaj-thread__body" id="mesaj-thread-body">
        ${messagesHtml(messages)}
      </div>
      <div id="mesaj-thread-compose-host">
        ${
          talep.durum === "acik"
            ? composeHtml()
            : `<div class="mesaj-thread__closed-note"><i class='bx bx-lock-alt'></i> Bu talep kapatıldı, artık mesaj gönderilemez.</div>`
        }
      </div>
    `;
  }

  function renderThreadHeader(talep) {
    const isAdmin = currentRole === "admin";
    const acil = talep.aciliyet === "acil";
    const adminName = talep.kullanicilar?.ad_soyad || "Admin";
    const adminSeed = talep.kullanicilar?.kullanici_adi || adminName;
    return `
      <div class="mesaj-thread__header">
        <button type="button" class="mesaj-back-btn" id="mesaj-back-btn"><i class='bx bx-arrow-back'></i></button>
        ${!isAdmin ? `<div class="mesaj-thread__avatar">${App.lowPolyAvatar(adminSeed, 36, true)}</div>` : ""}
        <div class="mesaj-thread__title">
          <strong>${UI.escapeHtml(talep.konu.slice(0, 70))}</strong>
          <div class="mesaj-thread__sub">
            <span class="badge ${acil ? "badge--danger" : "badge--muted"}">${acil ? "<i class='bx bx-error'></i> Acil" : "Normal"}</span>
            <span class="badge ${talep.durum === "acik" ? "badge--success" : "badge--muted"}">${talep.durum === "acik" ? "Açık" : "Kapalı"}</span>
            ${!isAdmin ? `<span class="mesaj-thread__admin">Açan: ${UI.escapeHtml(adminName)}</span>` : ""}
          </div>
        </div>
        ${
          isAdmin && talep.durum === "acik"
            ? `<button type="button" class="btn btn--sm btn--danger-ghost" id="mesaj-kapat-btn"><i class='bx bx-lock-alt'></i> Talebi Kapat</button>`
            : ""
        }
      </div>`;
  }

  function renderMessage(m) {
    const own = m.gonderen_kullanici_id === currentUser.id;
    const isAdminMsg = m.gonderen_rol === "admin";
    const senderName = m.kullanicilar?.ad_soyad || (isAdminMsg ? "Admin" : "Depo Görevlisi");
    const avatarSeed = m.kullanicilar?.kullanici_adi || senderName || String(m.gonderen_kullanici_id || "kt-user");
    const time = new Date(m.gonderim_tarihi).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    return `
      <div class="msg-bubble-row ${own ? "msg-bubble-row--own" : ""}">
        ${!own ? `<div class="msg-bubble__avatar">${App.lowPolyAvatar(avatarSeed, 30, isAdminMsg)}</div>` : ""}
        <div class="msg-bubble ${own ? "msg-bubble--own" : "msg-bubble--other"}">
          ${
            !own
              ? `<div class="msg-bubble__sender">${UI.escapeHtml(senderName)}${
                  isAdminMsg ? " <span class='msg-admin-tag'>Admin</span>" : ""
                }</div>`
              : ""
          }
          ${m.foto_base64 ? `<img src="${m.foto_base64}" class="msg-bubble__img js-msg-lightbox" alt="Mesaj görseli" />` : ""}
          ${m.icerik ? `<div class="msg-bubble__text">${UI.escapeHtml(m.icerik)}</div>` : ""}
          <div class="msg-bubble__meta">
            <span>${time}</span>
            ${own ? renderTicks(m) : ""}
          </div>
        </div>
      </div>`;
  }

  function renderTicks(m) {
    const readByOther = (m.mesaj_okuma_kayitlari || []).some((r) => r.kullanici_id !== currentUser.id);
    return `<i class='bx bx-check-double msg-tick ${readByOther ? "msg-tick--read" : ""}'></i>`;
  }

  function composeHtml() {
    return `
      <form id="mesaj-compose-form" class="mesaj-compose">
        <div id="mesaj-photo-preview" class="mesaj-photo-preview"></div>
        <div class="mesaj-compose__row">
          <label class="mesaj-attach-btn" title="Görsel ekle">
            <i class='bx bx-plus'></i>
            <input type="file" id="mesaj-photo-input" accept="image/*" capture="environment" multiple hidden />
          </label>
          <input type="text" id="mesaj-input" class="input mesaj-compose__input" placeholder="Mesaj yazın..." autocomplete="off" />
          <button type="submit" class="mesaj-send-btn" id="mesaj-send-btn"><i class='bx bx-send'></i></button>
        </div>
      </form>`;
  }

  function bindThreadEvents(talep) {
    const backBtn = document.getElementById("mesaj-back-btn");
    if (backBtn) backBtn.addEventListener("click", () => document.getElementById("mesajlar-layout")?.classList.remove("mesajlar-layout--thread-open"));

    const kapatBtn = document.getElementById("mesaj-kapat-btn");
    if (kapatBtn) kapatBtn.addEventListener("click", () => closeTalepConfirm(talep.id));

    document.querySelectorAll(".js-msg-lightbox").forEach((img) => img.addEventListener("click", () => openImageLightbox(img.src)));

    const form = document.getElementById("mesaj-compose-form");
    if (form) form.addEventListener("submit", (e) => {
      e.preventDefault();
      sendMessage(talep.id);
    });

    const photoInput = document.getElementById("mesaj-photo-input");
    if (photoInput) photoInput.addEventListener("change", onComposePhotoSelected);

    renderComposePhotoPreview();
  }

  function openImageLightbox(src) {
    UI.openModal(
      `<button class="modal-close-x" data-close-modal><i class='bx bx-x'></i></button>
       <img src="${src}" class="lightbox-img" alt="Mesaj görseli" />`,
      { size: "modal-box--image" }
    );
  }

  function scrollThreadToBottom() {
    const body = document.getElementById("mesaj-thread-body");
    if (body) body.scrollTop = body.scrollHeight;
  }

  function startThreadPolling(talepId) {
    if (threadPollInterval) clearInterval(threadPollInterval);
    const guardToken = App.currentToken();
    threadPollInterval = setInterval(() => {
      if (!App.isCurrent(guardToken) || activeTalepId !== talepId) {
        clearInterval(threadPollInterval);
        threadPollInterval = null;
        return;
      }
      loadThread(talepId, { isPoll: true });
    }, 4000);
  }

  async function markMessagesRead(messages) {
    const toMark = messages.filter(
      (m) =>
        m.gonderen_kullanici_id !== currentUser.id &&
        !(m.mesaj_okuma_kayitlari || []).some((r) => r.kullanici_id === currentUser.id)
    );
    if (!toMark.length) return;
    try {
      await Api.insert(
        "mesaj_okuma_kayitlari",
        toMark.map((m) => ({ mesaj_id: m.id, kullanici_id: currentUser.id }))
      );
    } catch {
      /* eşzamanlı işaretleme çakışmalarını sessizce yok say */
    }
  }

  /* ---------------- Fotoğraf eki ---------------- */

  function onComposePhotoSelected(e) {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        composePhotoBuffer.push(reader.result);
        renderComposePhotoPreview();
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }

  function renderComposePhotoPreview() {
    const host = document.getElementById("mesaj-photo-preview");
    if (!host) return;
    host.innerHTML = composePhotoBuffer
      .map(
        (p, idx) => `
        <div class="photo-thumb">
          <img src="${p}" alt="Ek görsel" />
          <button type="button" class="photo-thumb__remove" data-idx="${idx}" title="Kaldır"><i class='bx bx-x'></i></button>
        </div>`
      )
      .join("");
    host.querySelectorAll(".photo-thumb__remove").forEach((btn) =>
      btn.addEventListener("click", () => {
        composePhotoBuffer.splice(Number(btn.dataset.idx), 1);
        renderComposePhotoPreview();
      })
    );
  }

  /* ---------------- Mesaj gönderme ---------------- */

  async function sendMessage(talepId) {
    const input = document.getElementById("mesaj-input");
    const text = input ? input.value.trim() : "";
    const photos = composePhotoBuffer.slice();
    if (!text && !photos.length) return;

    const sendBtn = document.getElementById("mesaj-send-btn");
    if (sendBtn) sendBtn.disabled = true;

    try {
      const rows = [];
      if (text) {
        rows.push({ talep_id: talepId, gonderen_kullanici_id: currentUser.id, gonderen_rol: currentRole, icerik: text });
      }
      photos.forEach((p) =>
        rows.push({ talep_id: talepId, gonderen_kullanici_id: currentUser.id, gonderen_rol: currentRole, foto_base64: p })
      );
      await Api.insert("mesaj_talep_mesajlari", rows);

      if (currentRole === "depo") {
        try {
          await Api.update("mesaj_talepleri", `id=eq.${talepId}`, { cevaplandi: true });
        } catch {
          /* alarm bir sonraki döngüde yine de kapanacaktır */
        }
        deactivateAlarm();
      }

      if (input) input.value = "";
      composePhotoBuffer = [];
      await loadThread(talepId);
      loadTalepler(App.currentToken(), activeTab);
    } catch (err) {
      UI.toast(err.message || "Mesaj gönderilemedi.", "error");
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  /* ---------------- Talebi kapatma (sadece admin) ---------------- */

  function closeTalepConfirm(id) {
    UI.confirmDialog(
      "Bu talep kapatılacak; admin dahil kimse bu talebe artık mesaj gönderemeyecek.",
      async () => {
        try {
          await Api.update("mesaj_talepleri", `id=eq.${id}`, { durum: "kapali", kapanma_tarihi: new Date().toISOString() });
          UI.toast("Talep kapatıldı.", "success");
          await loadThread(id);
          loadTalepler(App.currentToken(), activeTab);
        } catch (err) {
          UI.toast(err.message || "Kapatılamadı.", "error");
        }
      },
      { title: "Talebi kapat", confirmLabel: "Evet, kapat", danger: true }
    );
  }

  return { navItem, mount, initGlobalWatcher };
})();
