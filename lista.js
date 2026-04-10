async function fetchFirstOk(urls, timeoutMs) {
  let lastError = null;
  for (const u of urls) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort("timeout"), timeoutMs);
    try {
      const r = await fetch(u, { signal: controller.signal });
      clearTimeout(t);
      if (r.ok) return r;
      lastError = new Error(`Upstream HTTP ${r.status}`);
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

// CAMBIO AQUÍ: En Pages Functions usamos onRequest (o onRequestGet)
export async function onRequest(context) {
  const { request, env } = context; // Sacamos request y env del contexto
  const url = new URL(request.url);

  // IMPORTANTE: Como el archivo se llama "lista.js", Pages ya responde en /lista
  // Si quieres mantener "/lista.m3u", renombra el archivo a "lista.m3u.js"
  
  const token = url.searchParams.get("token") || "";
  let profile = "";
  if (env.TOKEN_LAN && token === env.TOKEN_LAN) profile = "lan";
  else if (env.TOKEN_ORACLE && token === env.TOKEN_ORACLE) profile = "oracle";
  else if (env.TOKEN_SS && token === env.TOKEN_SS) profile = "ssiptv";
  else return new Response("Not found", { status: 404 });

  let baseMap = {};
  try { baseMap = JSON.parse(env.NEWBASE_MAP || "{}"); }
  catch { return new Response("Misconfigured", { status: 500 }); }

  const oldBase = env.OLD_BASE || "";
  const newBase = baseMap[profile] || "";

  let srcs = [];
  try { srcs = JSON.parse(env.PLAYLIST_SRCS || "[]"); } catch { srcs = []; }
  if (!Array.isArray(srcs) || srcs.length === 0) return new Response("Misconfigured", { status: 500 });

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
        "pragma": "no-cache",
      },
    });
  } catch (e) {
    return new Response(e.message, { status: 502 });
  }
}
