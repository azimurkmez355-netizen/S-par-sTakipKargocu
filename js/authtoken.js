/* ============================================================
   KargoTakip — Anonim JWT yönetimi (Neon Managed Better Auth)
   ------------------------------------------------------------
   Neon Data API, Authorization header'ı olmayan istekleri artık
   kabul etmiyor ("missing authentication credentials" hatası).
   Kullanıcı girişini kendi "kullanicilar" tablomuzla yönettiğimiz
   için Neon'un kendi kullanıcı sistemine ihtiyacımız yok; bunun
   yerine Neon Auth'un ANONİM JWT uç noktasını kullanıyoruz.
   Bu token, Postgres'te "anonymous" rolüyle eşleşir — bu yüzden
   NEON_KURULUM.sql içindeki GRANT ... TO anonymous satırları
   hâlâ geçerli ve gereklidir.

   Gerekli Neon Console adımı: Data API > Settings > Authentication
   bölümünden "Use Managed Better Auth" sağlayıcısını ekleyin.
   ============================================================ */

const AuthToken = (() => {
  let cachedToken = null;
  let cachedExp = 0; // epoch saniye
  let inFlight = null;

  function decodeExp(jwt) {
    try {
      const payload = jwt.split(".")[1];
      const json = JSON.parse(
        decodeURIComponent(
          atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
            .split("")
            .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
            .join("")
        )
      );
      return json.exp || 0;
    } catch {
      return 0;
    }
  }

  function extractToken(payload) {
    if (!payload) return null;
    if (typeof payload === "string") return payload;
    return payload.token || payload.jwt || payload.access_token || (payload.data && payload.data.token) || null;
  }

  async function fetchAnonymousToken() {
    const url = `${CONFIG.AUTH_URL.replace(/\/+$/, "")}/token/anonymous`;
    let res;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" }
      });
    } catch (err) {
      throw new Error(
        "Neon Auth adresine ulaşılamadı (CORS ya da ağ hatası olabilir). Siteyi file:// yerine bir yerel sunucu ile açtığınızdan ve Neon Console > Data API > Settings > Authentication altında Managed Better Auth'un etkin olduğundan emin olun."
      );
    }

    if (!res.ok) {
      throw new Error(
        `Anonim oturum alınamadı (${res.status}). Neon Console > Data API > Settings > Authentication bölümünden "Use Managed Better Auth" sağlayıcısını eklediğinizden emin olun.`
      );
    }

    const body = await res.json().catch(() => null);
    const token = extractToken(body);
    if (!token) throw new Error("Neon Auth'tan geçerli bir JWT alınamadı.");
    return token;
  }

  async function getToken(forceRefresh = false) {
    const now = Math.floor(Date.now() / 1000);
    if (!forceRefresh && cachedToken && cachedExp - now > 30) {
      return cachedToken;
    }
    if (inFlight) return inFlight;

    inFlight = fetchAnonymousToken()
      .then((token) => {
        cachedToken = token;
        cachedExp = decodeExp(token) || now + 600;
        inFlight = null;
        return token;
      })
      .catch((err) => {
        inFlight = null;
        throw err;
      });

    return inFlight;
  }

  return { getToken };
})();
