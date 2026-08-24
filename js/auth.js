/* ============================================================
   KargoTakip — Kimlik doğrulama (login / logout / oturum)
   ============================================================ */

const Auth = (() => {
  const STORAGE_KEY = "kargotakip_oturum";
  let selectedRole = null;

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }

  function setSession(user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function initRoleSelector() {
    const cards = document.querySelectorAll(".role-card");
    cards.forEach((card) => {
      card.addEventListener("click", () => {
        cards.forEach((c) => c.classList.remove("role-card--active"));
        card.classList.add("role-card--active");
        selectedRole = card.dataset.role;
        document.getElementById("login-form").classList.add("login-form--visible");
        document.getElementById("selected-role-label").textContent =
          selectedRole === "admin" ? "Admin girişi" : "Depo Görevlisi girişi";
      });
    });

    // v5: Şifre göster/gizle ikonu
    initPasswordToggle();
  }

  function initPasswordToggle() {
    const toggleBtn = document.getElementById("password-toggle-btn");
    const passwordInput = document.getElementById("login-password");

    if (!toggleBtn || !passwordInput) return;

    toggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const isPassword = passwordInput.type === "password";
      passwordInput.type = isPassword ? "text" : "password";
      toggleBtn.innerHTML = isPassword
        ? '<i class="bx bx-show"></i>'
        : '<i class="bx bx-hide"></i>';
    });
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (!selectedRole) {
      UI.toast("Lütfen önce giriş yapmak istediğiniz rolü seçin.", "error");
      return;
    }
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    const btn = document.getElementById("login-submit-btn");

    if (!username || !password) {
      UI.toast("Kullanıcı adı ve şifre boş bırakılamaz.", "error");
      return;
    }

    btn.disabled = true;
    btn.classList.add("btn--loading");

    try {
      const rows = await Api.select(
        "kullanicilar",
        `kullanici_adi=eq.${encodeURIComponent(username)}&rol=eq.${encodeURIComponent(
          selectedRole
        )}&select=id,ad_soyad,kullanici_adi,rol,aktif`
      );

      const user = rows && rows[0];

      if (!user) {
        UI.toast("Kullanıcı adı, şifre veya rol hatalı.", "error");
        return;
      }
      if (user.aktif === false) {
        UI.toast("Bu kullanıcı pasif durumda. Yöneticinizle iletişime geçin.", "error");
        return;
      }

      // Şifreyi ayrı sorguluyoruz ki yanlış girişlerde bile satır bulunsun ve
      // hata mesajı kullanıcı adı/şifre ayrımı yapmasın.
      const check = await Api.select(
        "kullanicilar",
        `id=eq.${user.id}&sifre=eq.${encodeURIComponent(password)}&select=id`
      );

      if (!check || !check.length) {
        UI.toast("Kullanıcı adı, şifre veya rol hatalı.", "error");
        return;
      }

      setSession(user);
      UI.toast(`Hoş geldiniz, ${user.ad_soyad}`, "success");
      App.boot();
    } catch (err) {
      UI.toast(err.message || "Giriş yapılamadı.", "error");
    } finally {
      btn.disabled = false;
      btn.classList.remove("btn--loading");
    }
  }

  function logout() {
    clearSession();
    selectedRole = null;
    location.reload();
  }

  return { getSession, setSession, clearSession, initRoleSelector, handleLogin, logout };
})();
