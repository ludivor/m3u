async function fetchFirstOk(urls, timeoutMs) {
  let lastError = null;
  for (const u of urls) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort("timeout"), timeoutMs);
    try {
      const r = await fetch(u, { signal: controller.signal });
      clearTimeout(t);
      //if (r.ok) return r;
      if (r.ok) {
        // 1. Clonamos la respuesta para inspeccionarla sin consumir el body original
        const text = await r.clone().text();

        // 2. Verificamos que contenga etiquetas M3U (#EXTM3U, #EXTINF, etc.)
        if (/#EXT/i.test(text)) {
          const hostname = new URL(u).hostname;
          console.log(`✅ ÉXITO: Descargado de ${hostname}`); 
          return r; // Devuelve la Response original intacta
        }
        
        // Si no tiene #EXT, registramos el aviso y el bucle probará la siguiente URL
        console.warn(`⚠️ HTTP 200 en ${u} pero NO contiene una lista M3U válida.`);
        lastError = new Error(`Contenido no M3U devuelto por ${u}`);
      } else {
        lastError = new Error(`Upstream HTTP ${r.status}`);
      }
    } catch (e) {
      clearTimeout(t);
      lastError = e;
    }
  }
  throw lastError || new Error("All upstreams failed");
}

function setExtm3uEpg(m3uText, epgUrl) {
  const header = `#EXTM3U x-tvg-url="${epgUrl}"`;
  if (/^\s*#EXTM3U.*$/mi.test(m3uText)) return m3uText.replace(/^\s*#EXTM3U.*$/mi, header);
  return header + "\n" + m3uText;
}
// página 404
const notfoundhtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - Nada por aquí</title>
  <style>
    body {
      background-color: #0f172a;
      color: #f8fafc;
      font-family: system-ui, -apple-system, sans-serif;
      margin: 0;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .card {
      background: #1e293b;
      padding: 2.5rem;
      border-radius: 1rem;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      max-width: 400px;
    }
    svg {
      width: 100px;
      height: 100px;
      margin-bottom: 1rem;
    }
    h1 { margin: 0; font-size: 2rem; color: #38bdf8; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
    .badge {
      display: inline-block;
      background: #334155;
      color: #f1f5f9;
      padding: 0.4rem 0.8rem;
      border-radius: 0.3rem;
      font-family: monospace;
      margin-top: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <!-- SVG del fantasma integrado directamente -->
    <svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 3 3 3-3 3 3 3-3 3 3V10a8 8 0 0 0-8-8z"/>
    </svg>
    <h1>¡Ups! 404</h1>
    <p>Esta no es la página que estás buscando.</p>
    <div class="badge">Ruta correcta requerida</div>
  </div>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Con _worker.js, tú controlas TODAS las rutas.
    // Si quieres que solo responda en /lista.m3u:
    if (url.pathname === "/lista.m3u") {
      const token = url.searchParams.get("token") || "";
      let profile = "";
      
      if (env.TOKEN_LAN && token === env.TOKEN_LAN) profile = "lan";
      else if (env.TOKEN_ORACLE && token === env.TOKEN_ORACLE) profile = "oracle";
      else if (env.TOKEN_SS && token === env.TOKEN_SS) profile = "ssiptv";
      else return new Response(notfoundhtml, {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });

      let baseMap = {};
      try { baseMap = JSON.parse(env.NEWBASE_MAP || "{}"); }
      catch { return new Response("Misconfigured", { status: 500 }); }

      const oldBase = env.OLD_BASE || "";
      const newBase = baseMap[profile] || "";

      let srcs = [];
      try { srcs = JSON.parse(env.PLAYLIST_SRCS || "[]"); } catch { srcs = []; }
      
      try {
        const upstream = await fetchFirstOk(srcs, Number(env.PLAYLIST_TIMEOUT_MS || 7000));
        let m3u = await upstream.text();

        if (oldBase && newBase && oldBase !== newBase) {
          m3u = m3u.split(oldBase).join(newBase);
        }

        if (profile === "ssiptv") {
          const epgSs = env.EPG_PUBLIC_URL || "";
          if (epgSs) m3u = setExtm3uEpg(m3u, epgSs);
        }

        return new Response(m3u, {
          headers: {
            "content-type": "audio/x-mpegurl; charset=utf-8",
            "cache-control": "no-store, no-cache, must-revalidate",
          },
        });
      } catch (e) {
        return new Response(e.message, { status: 502 });
      }
    }

    // Si no es /lista.m3u, intenta servir los archivos estáticos (como index.html)
    return env.ASSETS.fetch(request);
  },
};
