/**
 * wsrelay.js — موتور ترنسپورت VLESS+WS برای Chop روی Cloudflare Workers
 *
 * پورت مفهومی ws.py: یک اتصال WebSocket که خودِ Workers runtime برای کل
 * عمرش به همون یک اجرای Worker پین می‌کنه (نیازی به هیچ واسطی مثل Redis در
 * مسیر داده نیست، دقیقاً به همون دلیلی که نسخه‌ی Vercel/Fluid Compute هم
 * از Redis صرف‌نظر کرده بود). خروجی به سمت مقصد با TCP Sockets API بومی
 * Workers (`cloudflare:sockets`) باز می‌شه.
 *
 * محدودیت‌های واقعی TCP Sockets API طبق مستندات رسمی Cloudflare: اتصال به
 * پورت ۲۵ (SMTP)، به آی‌پی‌های خودِ Cloudflare، به localhost/شبکه‌ی خصوصی،
 * و اتصال یک Worker به خودش مجاز نیست. جزئیات و بروزرسانی‌ها:
 * https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
 */
import { connect } from "cloudflare:sockets";
import { parseVlessHeader, buildResponseHeader, VlessParseError } from "./vless.js";
import { getStore } from "./store.js";

const HANDSHAKE_TIMEOUT_MS = 10_000;

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function toUint8(data) {
  return typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
}

function clientIpFromRequest(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function handleWsRelay(request, env) {
  if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
    return new Response("expected websocket upgrade", { status: 426 });
  }

  const clientIp = clientIpFromRequest(request);
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();
  runSession(server, clientIp, env).catch(() => {
    try {
      server.close(1011, "internal error");
    } catch {
      /* ignore */
    }
  });

  return new Response(null, { status: 101, webSocket: client });
}

async function runSession(ws, clientIp, env) {
  const store = getStore(env);

  let handshakeDone = false;
  let handshakeTimer = setTimeout(() => {
    if (!handshakeDone) {
      try {
        ws.close(1002, "handshake timeout");
      } catch {
        /* ignore */
      }
    }
  }, HANDSHAKE_TIMEOUT_MS);

  let socket = null;
  let writer = null;
  let config = null;
  let parsed = null;
  const counters = { up: 0, down: 0 };
  let finalized = false;

  async function finalize() {
    if (finalized) return;
    finalized = true;
    clearTimeout(handshakeTimer);
    try {
      writer && (await writer.close());
    } catch {
      /* ignore */
    }
    try {
      socket && (await socket.close());
    } catch {
      /* ignore */
    }
    const total = counters.up + counters.down;
    if (config && total > 0) {
      try {
        await store.bumpUsage(config.id, total);
        await store.recordTrafficBucket(total);
        await store.logConnection(
          config.id,
          config.name,
          clientIp,
          parsed?.address,
          parsed?.port,
          total
        );
      } catch {
        /* بهتره اتصال به‌خاطر شکست ثبت آمار قطع نشه */
      }
    }
  }

  async function pumpUpstreamToClient() {
    const reader = socket.readable.getReader();
    let sentHeader = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const out = sentHeader ? value : concatBytes(buildResponseHeader(), value);
        sentHeader = true;
        try {
          ws.send(out);
        } catch {
          break;
        }
        counters.down += value.length;
      }
    } catch {
      /* اتصال مقصد بسته/قطع شده */
    } finally {
      if (!sentHeader) {
        try {
          ws.send(buildResponseHeader());
        } catch {
          /* ignore */
        }
      }
      try {
        ws.close(1000, "upstream closed");
      } catch {
        /* ignore */
      }
    }
  }

  ws.addEventListener("message", async (event) => {
    try {
      const buf = toUint8(event.data);

      if (!handshakeDone) {
        clearTimeout(handshakeTimer);

        try {
          parsed = parseVlessHeader(buf);
        } catch (e) {
          if (e instanceof VlessParseError) {
            ws.close(1002, "bad vless header");
            return;
          }
          throw e;
        }

        config = await store.getConfigByUuid(parsed.clientUuid);
        if (!config || config.enabled === false) {
          ws.close(1008, "unknown or disabled config");
          return;
        }

        const trafficLimit = config.traffic_limit_bytes || 0;
        if (trafficLimit && (config.used_bytes || 0) >= trafficLimit) {
          ws.close(1008, "quota exceeded");
          return;
        }

        const withinLimit = await store.isIpWithinLimit(config, clientIp);
        if (!withinLimit) {
          ws.close(1008, "ip limit exceeded");
          return;
        }

        try {
          socket = connect({ hostname: parsed.address, port: parsed.port });
          writer = socket.writable.getWriter();
        } catch {
          ws.close(1011, "upstream connect failed");
          return;
        }

        pumpUpstreamToClient().finally(finalize);

        await store.markOnline(config.id, clientIp);
        handshakeDone = true;

        const initialPayload = buf.subarray(parsed.headerLen);
        if (initialPayload.length > 0) {
          await writer.write(initialPayload);
          counters.up += initialPayload.length;
        }
        return;
      }

      if (writer) {
        await writer.write(buf);
        counters.up += buf.length;
      }
    } catch {
      try {
        ws.close(1011, "relay error");
      } catch {
        /* ignore */
      }
      await finalize();
    }
  });

  ws.addEventListener("close", () => {
    finalize();
  });

  ws.addEventListener("error", () => {
    finalize();
  });
}
