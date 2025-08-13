const twilio = require("twilio");

function getClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio credentials not set");
  }
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

function formatTo(to) {
  if (!to) throw new Error("Missing destination number");
  const clean = to.replace(/[^+0-9]/g, "");
  return clean.startsWith("whatsapp:") ? clean : `whatsapp:${clean}`;
}

async function sendText(to, body) {
  const client = getClient();
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) throw new Error("TWILIO_WHATSAPP_FROM not set");
  return client.messages.create({ from, to: formatTo(to), body });
}

async function sendTemplate(to, contentSid, variablesObj) {
  const client = getClient();
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) throw new Error("TWILIO_WHATSAPP_FROM not set");
  return client.messages.create({
    from,
    to: formatTo(to),
    contentSid,
    contentVariables: JSON.stringify(variablesObj || {}),
  });
}

module.exports = { sendText, sendTemplate };
