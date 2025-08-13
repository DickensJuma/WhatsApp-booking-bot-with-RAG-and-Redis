const axios = require("axios");
let twilioProvider = null;
try {
  twilioProvider = require("./providers/twilioProvider");
} catch (_) {}
const { addOutbound } = (() => {
  try {
    return require("./mockMessageStore");
  } catch (_) {
    return { addOutbound: () => {} };
  }
})();

const PROVIDER = (process.env.WHATSAPP_PROVIDER || "meta").toLowerCase();

// WhatsApp Business Cloud API configuration
const WHATSAPP_API_URL = "https://graph.facebook.com/v18.0";
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// Provider-agnostic send
async function sendWhatsAppMessage(to, message) {
  if (PROVIDER === "twilio" && twilioProvider) {
    try {
      console.log(`📤 (Twilio) Sending WhatsApp message to ${to}`);
      const res = await twilioProvider.sendText(to, message);
      console.log("✅ Twilio message sent:", res.sid);
      return { provider: "twilio", sid: res.sid };
    } catch (error) {
      console.error("❌ Twilio send error:", error.message);
      throw error;
    }
  } else if (PROVIDER === "mock") {
    console.log(`🧪 (Mock) Would send to ${to}: ${message.substring(0, 80)}`);
    const record = { provider: "mock", to, body: message };
    try {
      addOutbound(record);
    } catch (_) {}
    return record;
  }
  // Default Meta Cloud API
  try {
    console.log(
      `📤 (Meta) Sending WhatsApp message to ${to}: "${message.substring(
        0,
        100
      )}..."`
    );
    const payload = {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: message },
    };
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("✅ Meta WhatsApp message sent successfully:", response.data);
    return response.data;
  } catch (error) {
    console.error("❌ Meta send error:", {
      message: error.message,
      response: error.response?.data,
    });
    throw error;
  }
}

// Send a message with quick reply buttons
async function sendWhatsAppButtonMessage(to, bodyText, buttons) {
  try {
    console.log(`📤 Sending WhatsApp button message to ${to}`);

    const payload = {
      messaging_product: "whatsapp",
      to: to,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: bodyText,
        },
        action: {
          buttons: buttons.map((button, index) => ({
            type: "reply",
            reply: {
              id: `btn_${index}`,
              title: button,
            },
          })),
        },
      },
    };

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ WhatsApp button message sent successfully");
    return response.data;
  } catch (error) {
    console.error("❌ Error sending WhatsApp button message:", {
      message: error.message,
      response: error.response?.data,
    });
    throw error;
  }
}

// Send a message with a list of options
async function sendWhatsAppListMessage(to, bodyText, buttonText, sections) {
  try {
    console.log(`📤 Sending WhatsApp list message to ${to}`);

    const payload = {
      messaging_product: "whatsapp",
      to: to,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: bodyText,
        },
        action: {
          button: buttonText,
          sections: sections,
        },
      },
    };

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ WhatsApp list message sent successfully");
    return response.data;
  } catch (error) {
    console.error("❌ Error sending WhatsApp list message:", {
      message: error.message,
      response: error.response?.data,
    });
    throw error;
  }
}

// Send a template message (for notifications, confirmations, etc.)
async function sendWhatsAppTemplate(
  to,
  templateName,
  languageCode = "en",
  parameters = []
) {
  if (PROVIDER === "twilio" && twilioProvider) {
    // Twilio template via Content API requires contentSid; mapping templateName->contentSid would be external.
    throw new Error(
      "Twilio template shortcut not implemented. Use sendTemplate with contentSid."
    );
  } else if (PROVIDER === "mock") {
    console.log(`🧪 (Mock) Template to ${to}: ${templateName}`);
    return { provider: "mock", template: templateName };
  }
  try {
    console.log(
      `📤 (Meta) Sending WhatsApp template message to ${to}: ${templateName}`
    );
    const payload = {
      messaging_product: "whatsapp",
      to: to,
      type: "template",
      template: { name: templateName, language: { code: languageCode } },
    };
    if (parameters.length > 0) {
      payload.template.components = [
        {
          type: "body",
          parameters: parameters.map((p) => ({ type: "text", text: p })),
        },
      ];
    }
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("✅ Meta template message sent successfully");
    return response.data;
  } catch (error) {
    console.error("❌ Meta template send error:", {
      message: error.message,
      response: error.response?.data,
    });
    throw error;
  }
}

// Mark message as read
async function markMessageAsRead(messageId) {
  try {
    if (PROVIDER !== "meta") {
      return; // Skip for non-Meta providers (optional implement later)
    }
    const payload = {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    };

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Message marked as read");
    return response.data;
  } catch (error) {
    console.error("❌ Error marking message as read:", error.message);
    // Don't throw error for read receipts as they're not critical
  }
}

// Get media URL and download media
async function downloadWhatsAppMedia(mediaId) {
  try {
    // First, get the media URL
    const mediaResponse = await axios.get(`${WHATSAPP_API_URL}/${mediaId}`, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    });

    const mediaUrl = mediaResponse.data.url;

    // Download the media
    const downloadResponse = await axios.get(mediaUrl, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      responseType: "arraybuffer",
    });

    return {
      data: downloadResponse.data,
      contentType: downloadResponse.headers["content-type"],
      filename: mediaResponse.data.id,
    };
  } catch (error) {
    console.error("❌ Error downloading WhatsApp media:", error.message);
    throw error;
  }
}

// Send appointment confirmation with details
async function sendAppointmentConfirmation(to, appointment, business) {
  const message = `✅ **Appointment Confirmed!**

📋 **Details:**
• Service: ${appointment.service_name}
• Date: ${appointment.getFormattedDate()}
• Time: ${appointment.getFormattedTime()}
• Duration: ${appointment.service_duration} minutes
• Price: KSH ${appointment.service_price}
• Confirmation Code: ${appointment.confirmation_code}

📍 **Location:**
${business.name}
${business.address || "Address available upon request"}

📞 **Need Changes?**
Just message us! You can reschedule or cancel up to ${
    business.cancellation_hours
  } hours before your appointment.

See you soon! 😊`;

  return await sendWhatsAppMessage(to, message);
}

// Send appointment reminder
async function sendAppointmentReminder(to, appointment, business) {
  const message = `🔔 **Appointment Reminder**

Hi! Just a friendly reminder about your appointment:

📅 **Tomorrow at ${appointment.getFormattedTime()}**
• Service: ${appointment.service_name}
• Duration: ${appointment.service_duration} minutes
• Location: ${business.name}
• Code: ${appointment.confirmation_code}

See you tomorrow! If you need to make any changes, please let us know as soon as possible.

Thanks! 😊`;

  return await sendWhatsAppMessage(to, message);
}

// Send cancellation confirmation
async function sendCancellationConfirmation(to, appointment) {
  const message = `✅ **Appointment Cancelled**

Your ${
    appointment.service_name
  } appointment on ${appointment.getFormattedDate()} at ${appointment.getFormattedTime()} has been cancelled successfully.

We hope to see you again soon! Feel free to book another appointment anytime.

Thank you! 😊`;

  return await sendWhatsAppMessage(to, message);
}

// Validate WhatsApp phone number format
function validateWhatsAppNumber(phoneNumber) {
  // Remove all non-digit characters
  const cleaned = phoneNumber.replace(/\D/g, "");

  // Check if it's a valid international format
  if (cleaned.length >= 10 && cleaned.length <= 15) {
    return cleaned;
  }

  throw new Error("Invalid phone number format");
}

// Get WhatsApp Business Profile
async function getBusinessProfile() {
  try {
    if (PROVIDER !== "meta") {
      return {
        provider: PROVIDER,
        note: "Business profile only for Meta provider",
      };
    }
    const response = await axios.get(`${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}`, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      params: {
        fields: "id,verified_name,display_phone_number,quality_rating",
      },
    });

    console.log("✅ WhatsApp Business Profile retrieved");
    return response.data;
  } catch (error) {
    console.error("❌ Error getting business profile:", error.message);
    throw error;
  }
}

// Test WhatsApp connection
async function testWhatsAppConnection() {
  try {
    if (PROVIDER === "meta") {
      await getBusinessProfile();
    } else if (PROVIDER === "twilio") {
      if (!process.env.TWILIO_ACCOUNT_SID)
        throw new Error("Missing Twilio SID");
      if (!process.env.TWILIO_AUTH_TOKEN)
        throw new Error("Missing Twilio auth token");
      if (!process.env.TWILIO_WHATSAPP_FROM)
        throw new Error("Missing Twilio from number");
    }
    console.log("✅ WhatsApp connection test successful");
    return true;
  } catch (error) {
    console.error("❌ WhatsApp connection test failed:", error.message);
    return false;
  }
}

module.exports = {
  sendWhatsAppMessage,
  sendWhatsAppButtonMessage,
  sendWhatsAppListMessage,
  sendWhatsAppTemplate,
  markMessageAsRead,
  downloadWhatsAppMedia,
  sendAppointmentConfirmation,
  sendAppointmentReminder,
  sendCancellationConfirmation,
  validateWhatsAppNumber,
  getBusinessProfile,
  testWhatsAppConnection,
};
