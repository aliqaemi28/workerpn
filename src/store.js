/**
 * store.js — لایه‌ی ذخیره‌سازی Chop روی Cloudflare Durable Objects
 *
 * روی Vercel این پروژه از Redis استفاده می‌کرد چون فایل‌سیستم/حافظه‌ی هر
 * instance موقتی و غیرمشترک بود. روی Cloudflare Workers معادل درست همون
 * نیاز، یک Durable Object است: یک شیء تکی که همه‌ی درخواست‌ها (پنل، ربات،
 * و کوتا-چک‌های VLESS) به همون یک نمونه می‌رسند و storage آن native
 * strongly-consistent است — دقیقاً همون تضمینی که Redis می‌داد، بدون نیاز
 * به یک سرویس خارجی جداگانه.
 *
 * این کلاس با متدهای RPC (فراخوانی مستقیم روی stub) کار می‌کند؛ نیازی به
 * fetch/JSON دستی نیست.
 */
import { DurableObject } from "cloudflare:workers";

const LOG_MAX_PER_CONFIG = 300;
const LOG_MAX_ALL = 1000;
const ONLINE_TTL_SECONDS = 120; // ورودی‌های online بعد از این مدت دیگر شمرده نمی‌شوند
const ONLINE_ACTIVE_WINDOW = 90; // "آنلاین" یعنی در ۹۰ ثانیه‌ی اخیر دیده شده

function newId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function randomSuffix() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export class ChopStore extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
  }

  // ---------------------------------------------------------------- configs
  async listConfigs() {
    const configs = await this.state.storage.list({ prefix: "config:" });
    const usageMap = await this.state.storage.list({ prefix: "usage:" });
    const out = [];
    for (const [key, cfg] of configs) {
      const id = key.slice("config:".length);
      const used = usageMap.get("usage:" + id) || 0;
      out.push({ ...cfg, used_bytes: used });
    }
    out.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return out;
  }

  async getConfig(id) {
    const cfg = await this.state.storage.get("config:" + id);
    if (!cfg) return null;
    const used = (await this.state.storage.get("usage:" + id)) || 0;
    return { ...cfg, used_bytes: used };
  }

  async getConfigByUuid(uuid) {
    // برای مقیاس یک پنل شخصی (چند ده تا چند صد کانفیگ)، اسکن کامل کافی و ساده‌ست.
    const configs = await this.state.storage.list({ prefix: "config:" });
    for (const cfg of configs.values()) {
      if (cfg.uuid === uuid) {
        const used = (await this.state.storage.get("usage:" + cfg.id)) || 0;
        return { ...cfg, used_bytes: used };
      }
    }
    return null;
  }

  async saveConfig(config) {
    await this.state.storage.put("config:" + config.id, config);
    return true;
  }

  async deleteConfig(id) {
    const onlineKeys = await this.state.storage.list({ prefix: `online:${id}:` });
    const logKeys = await this.state.storage.list({ prefix: `log:${id}:` });
    await this.state.storage.delete([
      "config:" + id,
      "usage:" + id,
      ...onlineKeys.keys(),
      ...logKeys.keys(),
    ]);
    return true;
  }

  async resetUsage(id) {
    await this.state.storage.delete("usage:" + id);
    return true;
  }

  async getUsage(id) {
    return (await this.state.storage.get("usage:" + id)) || 0;
  }

  async bumpUsage(id, amount) {
    const cur = (await this.state.storage.get("usage:" + id)) || 0;
    const next = cur + amount;
    await this.state.storage.put("usage:" + id, next);
    return next;
  }

  // ---------------------------------------------------------------- traffic
  async recordTrafficBucket(nbytes) {
    const bucket = Math.floor(Date.now() / 1000 / 3600) * 3600;
    const key = "traffic:" + bucket;
    const cur = (await this.state.storage.get(key)) || 0;
    await this.state.storage.put(key, cur + nbytes);
    return true;
  }

  async getTrafficSeries(hours = 24) {
    const now = Math.floor(Date.now() / 1000);
    const nowBucket = Math.floor(now / 3600) * 3600;
    const series = [];
    for (let i = hours - 1; i >= 0; i--) {
      const bucket = nowBucket - i * 3600;
      const val = (await this.state.storage.get("traffic:" + bucket)) || 0;
      series.push({ hour: bucket, bytes: val });
    }
    return series;
  }

  // ------------------------------------------------------------------ online
  async markOnline(configId, clientIp) {
    // نکته: Durable Object storage برخلاف Workers KV، گزینه‌ی expirationTtl
    // بومی نداره؛ به‌جاش timestamp رو نگه می‌داریم و در هر خواندن، ورودی‌های
    // قدیمی‌تر از ONLINE_TTL_SECONDS رو lazy پاک می‌کنیم (پایین).
    await this.state.storage.put(`online:${configId}:${clientIp}`, Date.now() / 1000);
    return true;
  }

  async _cleanupOnline(configId) {
    const prefix = `online:${configId}:`;
    const entries = await this.state.storage.list({ prefix });
    const now = Date.now() / 1000;
    const stale = [];
    for (const [key, ts] of entries) {
      if (now - ts > ONLINE_TTL_SECONDS) stale.push(key);
    }
    if (stale.length) await this.state.storage.delete(stale);
    return entries;
  }

  async onlineIpCount(configId) {
    const entries = await this._cleanupOnline(configId);
    const now = Date.now() / 1000;
    let count = 0;
    for (const ts of entries.values()) {
      if (now - ts < ONLINE_ACTIVE_WINDOW) count++;
    }
    return count;
  }

  async isIpWithinLimit(config, clientIp) {
    const limit = config.ip_limit || 0;
    if (!limit) return true;
    const entries = await this._cleanupOnline(config.id);
    const now = Date.now() / 1000;
    const activeIps = new Set();
    for (const [key, ts] of entries) {
      if (now - ts < ONLINE_ACTIVE_WINDOW) {
        activeIps.add(key.slice(`online:${config.id}:`.length));
      }
    }
    return activeIps.has(clientIp) || activeIps.size < limit;
  }

  // -------------------------------------------------------------------- logs
  async logConnection(configId, configName, clientIp, address, port, nbytes) {
    const entry = {
      config_id: configId,
      config_name: configName,
      ip: clientIp,
      address,
      port,
      bytes: nbytes,
      ts: Date.now() / 1000,
    };
    const ts = Date.now();
    const suffix = `${ts}:${randomSuffix()}`;

    await this.state.storage.put(`log:${configId}:${suffix}`, entry);
    await this.state.storage.put(`logall:${suffix}`, entry);

    await this._trimLogs(`log:${configId}:`, LOG_MAX_PER_CONFIG);
    await this._trimLogs("logall:", LOG_MAX_ALL);
    return true;
  }

  async _trimLogs(prefix, maxCount) {
    const all = await this.state.storage.list({ prefix, reverse: true });
    const keys = [...all.keys()];
    if (keys.length > maxCount) {
      await this.state.storage.delete(keys.slice(maxCount));
    }
  }

  async getLogs(configId, limit = 100) {
    const prefix = configId ? `log:${configId}:` : "logall:";
    const entries = await this.state.storage.list({ prefix, reverse: true, limit });
    return [...entries.values()];
  }

  // --------------------------------------------------------------- bot config
  async getBotSettings() {
    const token = (await this.state.storage.get("bot:token")) || "";
    const enabled = (await this.state.storage.get("bot:enabled")) || false;
    const secret = (await this.state.storage.get("bot:secret")) || "";
    return { token, enabled, secret };
  }

  async saveBotSettings(token, enabled, secret) {
    await this.state.storage.put("bot:token", token);
    await this.state.storage.put("bot:enabled", !!enabled);
    if (secret) await this.state.storage.put("bot:secret", secret);
    return true;
  }

  async listBotAdmins() {
    const entries = await this.state.storage.list({ prefix: "bot:admin:" });
    const admins = [...entries.values()];
    admins.sort((a, b) => (a.added_at || 0) - (b.added_at || 0));
    return admins;
  }

  async isBotAdmin(tgId) {
    return !!(await this.state.storage.get("bot:admin:" + String(tgId)));
  }

  async addBotAdmin(tgId, addedBy = "") {
    await this.state.storage.put("bot:admin:" + String(tgId), {
      id: String(tgId),
      added_at: Date.now() / 1000,
      added_by: addedBy,
    });
    return true;
  }

  async removeBotAdmin(tgId) {
    await this.state.storage.delete("bot:admin:" + String(tgId));
    return true;
  }

  async upsertBotMember(tgId, username, firstName) {
    const now = Date.now() / 1000;
    const key = "bot:member:" + String(tgId);
    const existing = await this.state.storage.get(key);
    const data = existing
      ? { ...existing, username, first_name: firstName, last_seen: now }
      : { id: String(tgId), username, first_name: firstName, joined_at: now, last_seen: now };
    await this.state.storage.put(key, data);
    return true;
  }

  async listBotMembers() {
    const entries = await this.state.storage.list({ prefix: "bot:member:" });
    const members = [...entries.values()];
    members.sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
    return members;
  }

  async setBotPending(tgId, data) {
    // (بدون TTL بومی — استوریج Durable Object چنین گزینه‌ای نداره؛ این
    // وضعیت‌ها با /cancel یا تکمیل گفتگو پاک می‌شن.)
    await this.state.storage.put("bot:pending:" + String(tgId), data);
    return true;
  }

  async getBotPending(tgId) {
    return (await this.state.storage.get("bot:pending:" + String(tgId))) || null;
  }

  async clearBotPending(tgId) {
    await this.state.storage.delete("bot:pending:" + String(tgId));
    return true;
  }

  // ------------------------------------------------------------------ misc
  async newId() {
    return newId();
  }

  async healthBackend() {
    return "durable-object";
  }

  // --------------------------------------------------------- backup/restore
  async exportAll() {
    const configs = Object.fromEntries(
      [...(await this.state.storage.list({ prefix: "config:" }))].map(([k, v]) => [
        k.slice("config:".length),
        v,
      ])
    );
    const usage = Object.fromEntries(
      [...(await this.state.storage.list({ prefix: "usage:" }))].map(([k, v]) => [
        k.slice("usage:".length),
        v,
      ])
    );
    const trafficHourly = Object.fromEntries(
      [...(await this.state.storage.list({ prefix: "traffic:" }))].map(([k, v]) => [
        k.slice("traffic:".length),
        v,
      ])
    );
    const botSettings = await this.getBotSettings();
    const botAdmins = Object.fromEntries(
      [...(await this.state.storage.list({ prefix: "bot:admin:" }))].map(([k, v]) => [
        k.slice("bot:admin:".length),
        v,
      ])
    );
    const botMembers = Object.fromEntries(
      [...(await this.state.storage.list({ prefix: "bot:member:" }))].map(([k, v]) => [
        k.slice("bot:member:".length),
        v,
      ])
    );
    const logsAll = [...(await this.state.storage.list({ prefix: "logall:", reverse: true }))].map(
      ([, v]) => v
    );
    const logsPerConfig = {};
    for (const configId of Object.keys(configs)) {
      const entries = [
        ...(await this.state.storage.list({ prefix: `log:${configId}:`, reverse: true })),
      ].map(([, v]) => v);
      if (entries.length) logsPerConfig[configId] = entries;
    }

    return {
      version: 1,
      app: "chop",
      exported_at: Date.now() / 1000,
      configs,
      usage,
      traffic_hourly: trafficHourly,
      bot_settings: botSettings,
      bot_admins: botAdmins,
      bot_members: botMembers,
      logs_all: logsAll,
      logs_per_config: logsPerConfig,
    };
  }

  async importAll(data, mode = "replace") {
    if (!data || typeof data !== "object" || !("configs" in data)) {
      throw new Error("فایل بکاپ معتبر نیست");
    }

    if (mode === "replace") {
      const oldConfigs = await this.state.storage.list({ prefix: "config:" });
      const toDelete = [];
      for (const key of oldConfigs.keys()) toDelete.push(key);
      const usageKeys = [...(await this.state.storage.list({ prefix: "usage:" })).keys()];
      const trafficKeys = [...(await this.state.storage.list({ prefix: "traffic:" })).keys()];
      const adminKeys = [...(await this.state.storage.list({ prefix: "bot:admin:" })).keys()];
      const memberKeys = [...(await this.state.storage.list({ prefix: "bot:member:" })).keys()];
      const logAllKeys = [...(await this.state.storage.list({ prefix: "logall:" })).keys()];
      const perConfigLogKeys = [];
      const onlineKeys = [];
      for (const key of oldConfigs.keys()) {
        const id = key.slice("config:".length);
        perConfigLogKeys.push(...[...(await this.state.storage.list({ prefix: `log:${id}:` })).keys()]);
        onlineKeys.push(...[...(await this.state.storage.list({ prefix: `online:${id}:` })).keys()]);
      }
      await this.state.storage.delete([
        ...toDelete,
        ...usageKeys,
        ...trafficKeys,
        ...adminKeys,
        ...memberKeys,
        ...logAllKeys,
        ...perConfigLogKeys,
        ...onlineKeys,
      ]);
    }

    const counters = { configs: 0, admins: 0, members: 0 };

    for (const [configId, cfg] of Object.entries(data.configs || {})) {
      await this.state.storage.put("config:" + configId, cfg);
      counters.configs++;
    }
    for (const [configId, used] of Object.entries(data.usage || {})) {
      await this.state.storage.put("usage:" + configId, used);
    }
    for (const [bucket, val] of Object.entries(data.traffic_hourly || {})) {
      await this.state.storage.put("traffic:" + bucket, val);
    }

    const botSettings = data.bot_settings || {};
    if (botSettings.token) {
      await this.saveBotSettings(
        botSettings.token || "",
        !!botSettings.enabled,
        botSettings.secret || ""
      );
    }

    for (const [tgId, admin] of Object.entries(data.bot_admins || {})) {
      await this.state.storage.put("bot:admin:" + tgId, admin);
      counters.admins++;
    }
    for (const [tgId, member] of Object.entries(data.bot_members || {})) {
      await this.state.storage.put("bot:member:" + tgId, member);
      counters.members++;
    }

    for (const entry of data.logs_all || []) {
      const suffix = `${entry.ts ? Math.floor(entry.ts * 1000) : Date.now()}:${randomSuffix()}`;
      await this.state.storage.put("logall:" + suffix, entry);
    }
    await this._trimLogs("logall:", LOG_MAX_ALL);

    for (const [configId, entries] of Object.entries(data.logs_per_config || {})) {
      for (const entry of entries) {
        const suffix = `${entry.ts ? Math.floor(entry.ts * 1000) : Date.now()}:${randomSuffix()}`;
        await this.state.storage.put(`log:${configId}:${suffix}`, entry);
      }
      await this._trimLogs(`log:${configId}:`, LOG_MAX_PER_CONFIG);
    }

    return counters;
  }
}

/** گرفتن stub تکی و سراسری (singleton) از ChopStore Durable Object */
export function getStore(env) {
  const id = env.STORE.idFromName("global");
  return env.STORE.get(id);
}
