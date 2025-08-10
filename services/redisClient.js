const { createClient } = require("redis");

let client = null;
let connecting = null;

async function getRedis() {
  if (process.env.REDIS_URL === "disabled") return null;
  if (client && client.isOpen) return client;
  if (connecting) return connecting;
  const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  client = createClient({ url });
  client.on("error", (err) =>
    console.warn("⚠️ Redis error:", err?.message || err)
  );
  connecting = client.connect().then(() => client);
  try {
    await connecting;
  } finally {
    connecting = null;
  }
  return client;
}

async function redisSetJSON(key, value, ttlSeconds) {
  const r = await getRedis();
  if (!r) return false;
  const payload = JSON.stringify(value);
  if (ttlSeconds && Number(ttlSeconds) > 0) {
    await r.set(key, payload, { EX: Number(ttlSeconds) });
  } else {
    await r.set(key, payload);
  }
  return true;
}

async function redisGetJSON(key) {
  const r = await getRedis();
  if (!r) return null;
  const val = await r.get(key);
  if (!val) return null;
  try {
    return JSON.parse(val);
  } catch (_) {
    return null;
  }
}

async function redisDel(key) {
  const r = await getRedis();
  if (!r) return 0;
  return r.del(key);
}

module.exports = { getRedis, redisSetJSON, redisGetJSON, redisDel };
