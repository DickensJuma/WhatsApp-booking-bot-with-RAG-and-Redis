// Simple in-memory store for mock provider messages
const outbound = [];

function addOutbound(msg) {
  outbound.push({ ...msg, ts: new Date() });
  if (outbound.length > 500) outbound.splice(0, outbound.length - 500);
}

function getOutbound(limit = 100) {
  if (limit <= 0) return [];
  return outbound.slice(-limit);
}

function clearOutbound() {
  outbound.length = 0;
}

module.exports = { addOutbound, getOutbound, clearOutbound };
