/**
 * index.js — Worker اصلی Chop (پورت main.py)
 */
import { createSessionCookie, verifySessionCookie, parseCookies } from "./authcookie.js";
import { getStore, ChopStore } from "./store.js";
import { handleWsRelay } from "./wsrelay.js";
import * as bot from "./bot.js";
import * as ui from "./ui.js";

export { ChopStore };

const WS_PATH = "/ws";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });
}

function html(str, init = {}) {
  return new Response(str, {
    ...init,
    headers: { "Content-Type": "text/html; charset=utf-8", ...(init.headers || {}) },
  });
}

function errorJson(status, detail) {
  return json({ detail }, { status });
}

function hostOf(request, env) {
  return env.PUBLIC_HOST || new URL(request.url).host;
}

async function requireAdmin(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const secret = env.SESSION_SECRET || "chop-dev-secret-change-me";
  return verifySessionCookie(cookies["chop_session"] || "", secret);
}

function setSessionCookie(resp, token) {
  resp.headers.append(
    "Set-Cookie",
    `chop_session=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 12}; Path=/`
  );
  return resp;
}

function clearSessionCookie(resp) {
  resp.headers.append("Set-Cookie", "chop_session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/");
  return resp;
}

// ── config helpers ─────────────────────────────────────────────────────
function buildLink(config, host) {
  const fp = config.fingerprint || "chrome";
  const alpn = config.alpn || "h2,http/1.1";
  const port = config.port || 443;
  const name = encodeURIComponent(config.name);
  const params =
    `type=ws&path=${encodeURIComponent(WS_PATH)}&host=${host}` +
    `&security=tls&sni=${host}&fp=${fp}&alpn=${encodeURIComponent(alpn)}`;
  return `vless://${config.uuid}@${host}:${port}?${params}#${name}`;
}

function publicConfig(config, host) {
  return {
    id: config.id,
    name: config.name,
    uuid: config.uuid,
    enabled: config.enabled !== false,
    created_at: config.created_at,
    expires_at: config.expires_at,
    traffic_limit_bytes: config.traffic_limit_bytes || 0,
    used_bytes: config.used_bytes || 0,
    ip_limit: config.ip_limit || 0,
    fingerprint: config.fingerprint || "chrome",
    alpn: config.alpn || "h2,http/1.1",
    port: config.port || 443,
    transport: config.transport || "ws",
    link: buildLink(config, host),
  };
}

function botWebhookUrl(host, secret) {
  return `https://${host}/bot/webhook/${secret}`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ── VLESS+WS relay ────────────────────────────────────────────
      if (path === WS_PATH) {
        return handleWsRelay(request, env);
      }

      // ── health ─────────────────────────────────────────────────────
      if (path === "/api/health" && method === "GET") {
        return json({ ok: true, service: "chop" });
      }

      // ── auth ───────────────────────────────────────────────────────
      if (path === "/api/login" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const username = body.username || "";
        const password = body.password || "";
        const adminUser = env.ADMIN_USER || "admin";
        const adminPass = env.ADMIN_PASS || "";

        if (!adminPass) {
          return errorJson(500, "ADMIN_PASS تنظیم نشده — آن را در Environment Variables ست کنید");
        }
        if (username !== adminUser || password !== adminPass) {
          return errorJson(401, "نام کاربری یا رمز عبور اشتباه است");
        }
        const secret = env.SESSION_SECRET || "chop-dev-secret-change-me";
        const token = await createSessionCookie(username, secret);
        return setSessionCookie(json({ ok: true }), token);
      }

      if (path === "/api/logout" && method === "POST") {
        return clearSessionCookie(json({ ok: true }));
      }

      // ── pages ──────────────────────────────────────────────────────
      if (path === "/" && method === "GET") {
        if (await requireAdmin(request, env)) {
          return Response.redirect(url.origin + "/dashboard", 302);
        }
        return html(ui.loginPage());
      }

      if (path === "/dashboard" && method === "GET") {
        if (!(await requireAdmin(request, env))) {
          return Response.redirect(url.origin + "/", 302);
        }
        return html(ui.dashboardPage());
      }

      // ── bot webhook (باید قبل از چک ادمین باشه، چون تلگرام صدا می‌زنه) ─
      if (path.startsWith("/bot/webhook/") && method === "POST") {
        const secretFromPath = path.slice("/bot/webhook/".length);
        const store = getStore(env);
        const settings = await store.getBotSettings();
        if (!settings.enabled || !settings.token || secretFromPath !== settings.secret) {
          return json({ ok: true });
        }
        const update = await request.json().catch(() => ({}));
        await bot.handleUpdate(store, settings.token, update, hostOf(request, env));
        return json({ ok: true });
      }

      // ── همه‌ی مسیرهای زیر نیاز به ادمین دارند ─────────────────────
      if (path.startsWith("/api/")) {
        if (!(await requireAdmin(request, env))) {
          return errorJson(401, "unauthorized");
        }
      }

      const store = getStore(env);
      const host = hostOf(request, env);

      if (path === "/api/configs" && method === "GET") {
        const configs = await store.listConfigs();
        const out = [];
        for (const c of configs) {
          const item = publicConfig(c, host);
          item.online = await store.onlineIpCount(c.id);
          out.push(item);
        }
        return json({ configs: out });
      }

      if (path === "/api/configs" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const name = (body.name || "").trim();
        if (!name) return errorJson(400, "نام کانفیگ الزامی است");

        const trafficLimitGb = parseFloat(body.traffic_limit_gb || 0);
        const expiresDays = parseInt(body.expires_days || 0, 10);

        const config = {
          id: await store.newId(),
          name,
          uuid: crypto.randomUUID(),
          enabled: true,
          created_at: Date.now() / 1000,
          expires_at: expiresDays ? Date.now() / 1000 + expiresDays * 86400 : null,
          traffic_limit_bytes: Math.trunc(trafficLimitGb * 1024 * 1024 * 1024),
          ip_limit: parseInt(body.ip_limit || 0, 10),
          fingerprint: body.fingerprint || "chrome",
          alpn: body.alpn || "h2,http/1.1",
          port: parseInt(body.port || 443, 10),
          transport: ["ws", "xhttp"].includes(body.transport) ? body.transport : "ws",
        };
        await store.saveConfig(config);
        return json(publicConfig(config, host));
      }

      const configIdMatch = path.match(/^\/api\/configs\/([^/]+)$/);
      if (configIdMatch && method === "PATCH") {
        const configId = configIdMatch[1];
        const config = await store.getConfig(configId);
        if (!config) return errorJson(404, "یافت نشد");

        const body = await request.json().catch(() => ({}));
        if ("enabled" in body) config.enabled = !!body.enabled;
        if ("name" in body && body.name.trim()) config.name = body.name.trim();
        if ("traffic_limit_gb" in body) {
          config.traffic_limit_bytes = Math.trunc(parseFloat(body.traffic_limit_gb) * 1024 * 1024 * 1024);
        }
        if ("ip_limit" in body) config.ip_limit = parseInt(body.ip_limit, 10);
        if ("fingerprint" in body) config.fingerprint = body.fingerprint;
        if ("alpn" in body) config.alpn = body.alpn;
        if ("port" in body) config.port = parseInt(body.port, 10);
        if ("transport" in body && ["ws", "xhttp"].includes(body.transport)) config.transport = body.transport;
        await store.saveConfig(config);
        if (body.reset_usage) {
          await store.resetUsage(configId);
          config.used_bytes = 0;
        }
        const fresh = await store.getConfig(configId);
        return json(publicConfig(fresh, host));
      }

      if (configIdMatch && method === "DELETE") {
        await store.deleteConfig(configIdMatch[1]);
        return json({ ok: true });
      }

      if (path === "/api/stats" && method === "GET") {
        const configs = await store.listConfigs();
        let totalOnline = 0;
        for (const c of configs) totalOnline += await store.onlineIpCount(c.id);
        const series = await store.getTrafficSeries(24);
        const totalUsed = configs.reduce((sum, c) => sum + (c.used_bytes || 0), 0);
        return json({
          config_count: configs.length,
          online: totalOnline,
          total_used_bytes: totalUsed,
          traffic_series: series,
          backend: "durable-object",
        });
      }

      if (path === "/api/logs" && method === "GET") {
        const configId = url.searchParams.get("config_id") || null;
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 300);
        const logs = await store.getLogs(configId, limit);
        return json({ logs });
      }

      if (path === "/api/bot/settings" && method === "GET") {
        const settings = await store.getBotSettings();
        const admins = await store.listBotAdmins();
        const members = await store.listBotMembers();
        const token = settings.token;
        const masked = token.length > 10 ? `${token.slice(0, 6)}…${token.slice(-4)}` : token ? "•••" : "";
        return json({
          enabled: settings.enabled,
          token_set: !!token,
          token_masked: masked,
          webhook_url: settings.secret ? botWebhookUrl(host, settings.secret) : null,
          admins,
          member_count: members.length,
        });
      }

      if (path === "/api/bot/settings" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const current = await store.getBotSettings();
        const token = (body.token || "").trim() || current.token;
        const enabled = "enabled" in body ? !!body.enabled : current.enabled;

        if (!token) return errorJson(400, "توکن ربات را وارد کنید");

        const secret = await bot.makeSecret(token);
        await store.saveBotSettings(token, enabled, secret);

        const webhookUrl = botWebhookUrl(host, secret);
        if (enabled) {
          const result = await bot.setWebhook(token, webhookUrl, secret);
          if (!result.ok) {
            return errorJson(400, `خطا در تنظیم Webhook: ${result.description || "نامشخص"}`);
          }
        } else {
          await bot.deleteWebhook(token);
        }
        return json({ ok: true, webhook_url: enabled ? webhookUrl : null });
      }

      if (path === "/api/bot/members" && method === "GET") {
        return json({ members: await store.listBotMembers() });
      }

      if (path === "/api/bot/admins" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const tgId = String(body.id || "").trim();
        if (!/^\d+$/.test(tgId)) return errorJson(400, "آی‌دی عددی تلگرام را وارد کنید");
        await store.addBotAdmin(tgId, "panel");
        return json({ ok: true });
      }

      const botAdminMatch = path.match(/^\/api\/bot\/admins\/([^/]+)$/);
      if (botAdminMatch && method === "DELETE") {
        await store.removeBotAdmin(botAdminMatch[1]);
        return json({ ok: true });
      }

      if (path === "/api/backup" && method === "GET") {
        const data = await store.exportAll();
        const filename = `chop-backup-${Math.floor(Date.now() / 1000)}.json`;
        return json(data, { headers: { "Content-Disposition": `attachment; filename="${filename}"` } });
      }

      if (path === "/api/backup/restore" && method === "POST") {
        const body = await request.json().catch(() => ({}));
        const backupData = body.backup;
        const mode = body.mode || "replace";
        if (!["replace", "merge"].includes(mode)) return errorJson(400, "mode باید replace یا merge باشد");
        if (!backupData || typeof backupData !== "object") return errorJson(400, "فایل بکاپ معتبر نیست");

        let counters;
        try {
          counters = await store.importAll(backupData, mode);
        } catch (e) {
          return errorJson(400, e.message || "فایل بکاپ معتبر نیست");
        }

        const settings = await store.getBotSettings();
        let webhookUrl = null;
        if (settings.enabled && settings.token) {
          webhookUrl = botWebhookUrl(host, settings.secret);
          const result = await bot.setWebhook(settings.token, webhookUrl, settings.secret);
          if (!result.ok) webhookUrl = null;
        }
        return json({ ok: true, counters, webhook_url: webhookUrl });
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return errorJson(500, err && err.message ? err.message : "internal error");
    }
  },
};
