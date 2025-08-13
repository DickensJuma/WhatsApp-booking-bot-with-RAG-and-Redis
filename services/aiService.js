const OpenAI = require("openai");
const moment = require("moment");
const Customer = require("../model/Customer");
const Business = require("../model/Business");
const Appointment = require("../model/Appointment");
const { searchFAQ } = require("./vectorService");
const MemoryStore = require("../model/Memory");
const { redisGetJSON, redisSetJSON, redisDel } = require("./redisClient");
const {
  createAppointment,
  rescheduleAppointment,
  cancelAppointment,
} = require("./bookingService");

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Per-customer in-memory cache (fast path) plus Redis durable memory
const conversationMemory = new Map();
const MEM_TTL_SECONDS = parseInt(process.env.MEMORY_TTL_SECONDS || "86400", 10); // default 24h
const memKey = (phone) => `mem:${phone}`;

// Main function to process incoming messages
async function processIncomingMessage({
  messageText,
  customerPhone,
  customerName,
  messageId,
}) {
  try {
    console.log(
      `🤖 Processing message from ${customerPhone}: "${messageText}"`
    );

    // Find or create customer (Mongoose logic)
    let customer = await Customer.findOne({ whatsapp_number: customerPhone });
    if (!customer) {
      customer = await Customer.create({
        whatsapp_number: customerPhone,
        name: customerName,
      });
    }

    // Get or initialize conversation context
    let context = conversationMemory.get(customerPhone);
    if (!context) {
      // Try Redis first
      try {
        const fromRedis = await redisGetJSON(memKey(customerPhone));
        if (fromRedis && typeof fromRedis === "object") {
          context = fromRedis;
        }
      } catch (_) {}
    }
    if (!context) {
      context = {
        step: "greeting",
        intent: null,
        pendingBooking: {},
        lastMessages: [],
      };
      // Load persisted history from Mongo as ultimate fallback
      try {
        const persisted = await MemoryStore.findOne({
          customer_phone: customerPhone,
        });
        if (persisted && Array.isArray(persisted.history)) {
          context.lastMessages = persisted.history.slice(-10);
        }
      } catch (_) {}
    }

    // Add current message to context
    context.lastMessages.push({
      role: "user",
      content: messageText,
      timestamp: new Date(),
    });

    // Memory buffer persistence handled via Mongo below

    // Get business information
    const business = await Business.getDefaultBusiness();
    if (!business) {
      throw new Error("Business configuration not found");
    }

    // Before intent analysis, check if awaiting a simple confirmation (yes/no) for cancellation
    const preConfirm = await handleConfirmationResponse(
      messageText,
      context,
      customer
    );
    if (preConfirm) {
      // Add AI response to context
      context.lastMessages.push({
        role: "assistant",
        content: preConfirm,
        timestamp: new Date(),
      });
      conversationMemory.set(customerPhone, context);
      try {
        await redisSetJSON(memKey(customerPhone), context, MEM_TTL_SECONDS);
      } catch (_) {}
      customer.last_interaction = new Date();
      await customer.save();
      return preConfirm;
    }

    // Generate AI response (full intent flow)
    const response = await generateAIResponse(
      messageText,
      context,
      business,
      customer
    );

    // Add AI response to context
    context.lastMessages.push({
      role: "assistant",
      content: response,
      timestamp: new Date(),
    });
    // Memory buffer persistence handled via Mongo below

    // Update conversation memory (in-memory + Redis)
    conversationMemory.set(customerPhone, context);
    try {
      await redisSetJSON(memKey(customerPhone), context, MEM_TTL_SECONDS);
    } catch (_) {}

    // Persist compact history to Mongo (secondary persistence)
    try {
      const compact = context.lastMessages.map((m) => ({
        role: m.role,
        content: m.content,
        ts: m.timestamp || new Date(),
      }));
      await MemoryStore.findOneAndUpdate(
        { customer_phone: customerPhone },
        { history: compact, updated_at: new Date() },
        { upsert: true }
      );
    } catch (_) {}

    // Update customer's last interaction
    customer.last_interaction = new Date();
    await customer.save();

    // Duplicate Mongo persistence already done above

    return response;
  } catch (error) {
    console.error("❌ Error processing message:", error);
    return "I apologize, but I'm experiencing some technical difficulties. Please try again in a moment, or contact us directly if the issue persists.";
  }
}

// Generate AI response using OpenAI
async function generateAIResponse(messageText, context, business, customer) {
  try {
    // Build system prompt with business context
    const systemPrompt = buildSystemPrompt(business, customer);

    // Build conversation messages for OpenAI
    const messages = [
      { role: "system", content: systemPrompt },
      ...context.lastMessages.slice(-6), // Keep last 6 messages for context
    ];

    // Detect intent and extract information
    const intentAnalysis = await analyzeIntent(messageText, context);

    // Handle different intents
    switch (intentAnalysis.intent) {
      case "book_appointment":
        return await handleBookingFlow(
          intentAnalysis,
          context,
          business,
          customer
        );

      case "reschedule_appointment":
        return await handleRescheduleFlow(
          intentAnalysis,
          context,
          business,
          customer
        );

      case "cancel_appointment":
        return await handleCancellationFlow(
          intentAnalysis,
          context,
          business,
          customer
        );

      case "check_appointment":
        return await handleAppointmentInquiry(customer);

      case "general_inquiry":
      default:
        return await handleGeneralInquiry(messageText, messages, business);
    }
  } catch (error) {
    console.error("❌ Error generating AI response:", error);
    throw error;
  }
}

// Build system prompt with business context
function buildSystemPrompt(business, customer) {
  const servicesText = business.services
    .map((s) => `${s.name} (${s.duration} minutes, KSH ${s.price})`)
    .join(", ");

  const workingHoursText = Object.entries(business.working_hours)
    .map(([day, hours]) =>
      hours.closed ? `${day}: Closed` : `${day}: ${hours.open} - ${hours.close}`
    )
    .join("\n");

  return `You are the WhatsApp booking assistant for ${
    business.name
  }, a professional beauty and wellness salon in Nairobi, Kenya.

BUSINESS INFORMATION:
- Services: ${servicesText}
- Working Hours:
${workingHoursText}
- Timezone: ${business.timezone}
- Buffer time between appointments: ${business.buffer_time} minutes
- Advance booking: Up to ${business.advance_booking_days} days
- Cancellation policy: Must cancel at least ${
    business.cancellation_hours
  } hours before appointment

CUSTOMER INFORMATION:
- Name: ${customer.name || customer.whatsapp_number}
- Phone: ${customer.whatsapp_number}
- Total appointments: ${customer.total_appointments}

YOUR ROLE:
You help customers book, reschedule, and cancel appointments via WhatsApp. Be friendly, professional, and efficient.

BOOKING PROCESS:
1. Ask for the service they want
2. Ask for their preferred date and time
3. Check availability and confirm
4. Provide confirmation details

GUIDELINES:
- Always be polite and professional
- Use Kenyan time references (EAT - East Africa Time)
- Prices are in Kenyan Shillings (KSH)
- Only book during working hours
- Confirm all details before finalizing
- Provide clear confirmation codes
- Handle one request at a time
- If unsure about availability, always check before confirming

RESPONSES:
- Keep messages concise but warm
- Use emojis sparingly and appropriately
- Always end with next steps or questions
- For complex requests, break them into steps`;
}

// Analyze message intent using OpenAI
async function analyzeIntent(messageText, context) {
  try {
    const intentPrompt = `Analyze this WhatsApp message and determine the customer's intent.

Message: "${messageText}"

Previous context step: ${context.step}

Classify the intent as one of:
- book_appointment: Customer wants to book a new appointment
- reschedule_appointment: Customer wants to change existing appointment
- cancel_appointment: Customer wants to cancel existing appointment  
- check_appointment: Customer wants to check their appointment status
- general_inquiry: General questions about services, hours, etc.

Also extract any mentioned:
- Service name
- Date preference (convert relative dates like "tomorrow" to actual dates)
- Time preference
- Any specific requirements

Respond in JSON format:
{
  "intent": "intent_name",
  "confidence": 0.95,
  "extracted_info": {
    "service": "service_name_or_null",
    "date": "YYYY-MM-DD_or_null", 
    "time": "HH:MM_or_null",
    "requirements": "any_special_notes"
  }
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: intentPrompt }],
      temperature: 0.1,
      max_tokens: 300,
    });

    const raw = response.choices[0].message.content || "";
    // Strip code fences if present and try to extract the first JSON object
    const cleaned = raw
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    let jsonText = cleaned;
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonText = cleaned.slice(firstBrace, lastBrace + 1);
    }

    let analysis = null;
    try {
      analysis = JSON.parse(jsonText);
    } catch (e) {
      console.warn(
        "⚠️ Falling back to general_inquiry due to JSON parse error"
      );
      return {
        intent: "general_inquiry",
        confidence: 0.4,
        extracted_info: {},
      };
    }

    // Convert relative dates to actual dates
    if (analysis.extracted_info.date === "tomorrow") {
      analysis.extracted_info.date = moment()
        .add(1, "day")
        .format("YYYY-MM-DD");
    } else if (analysis.extracted_info.date === "today") {
      analysis.extracted_info.date = moment().format("YYYY-MM-DD");
    }

    // Fallback lightweight local parsing if model missed simple relative date
    if (!analysis.extracted_info.date) {
      const lower = messageText.toLowerCase().trim();
      if (lower === "tomorrow") {
        analysis.extracted_info.date = moment()
          .add(1, "day")
          .format("YYYY-MM-DD");
      } else if (lower === "today") {
        analysis.extracted_info.date = moment().format("YYYY-MM-DD");
      } else {
        // Direct ISO date pattern
        if (
          /^\d{4}-\d{2}-\d{2}$/.test(lower) &&
          moment(lower, "YYYY-MM-DD", true).isValid()
        ) {
          analysis.extracted_info.date = lower;
        }
      }
    }

    return analysis;
  } catch (error) {
    console.error("❌ Error analyzing intent:", error);
    return {
      intent: "general_inquiry",
      confidence: 0.5,
      extracted_info: {},
    };
  }
}

// Handle booking flow
async function handleBookingFlow(intentAnalysis, context, business, customer) {
  const extracted = intentAnalysis.extracted_info;
  const pending = context.pendingBooking;

  // Step 1: Get service
  if (!pending.service && !extracted.service) {
    context.step = "booking_service";
    const services = business.services.map((s) => `• ${s.name}`).join("\n");
    return `Hello! I'd be happy to help you book an appointment. 😊\n\nWhat service would you like to book?\n\n${services}\n\nJust let me know which one interests you!`;
  }

  // Validate and set service
  if (extracted.service && !pending.service) {
    const service = business.getServiceByName(extracted.service);
    if (service) {
      pending.service = service;
      context.step = "booking_date";
    } else {
      const services = business.getAllServiceNames().join(", ");
      return `I don't recognize that service. Our available services are: ${services}. Which one would you like?`;
    }
  }

  // Step 2: Get date
  if (pending.service && !pending.date && !extracted.date) {
    return `Great choice! ${pending.service.name} takes ${pending.service.duration} minutes and costs KSH ${pending.service.price}.\n\nWhat date would you prefer? You can say things like "tomorrow", "Monday", or give me a specific date.`;
  }

  // Validate and set date
  if (extracted.date && !pending.date) {
    const date = moment(extracted.date);
    const today = moment();
    const maxDate = moment().add(business.advance_booking_days, "days");

    if (!date.isValid()) {
      return `I didn't understand that date. Could you please specify a date like "tomorrow", "Monday", or "December 15th"?`;
    }

    if (date.startOf("day").isBefore(today.startOf("day"))) {
      return `I can't book appointments in the past. Could you choose today or a future date?`;
    }

    if (date.isAfter(maxDate, "day")) {
      return `I can only book appointments up to ${business.advance_booking_days} days in advance. Please choose an earlier date.`;
    }

    const dayName = date.format("dddd").toLowerCase();
    if (!business.isWorkingDay(dayName)) {
      return `We're closed on ${date.format(
        "dddd"
      )}s. Please choose another day.`;
    }

    pending.date = date.format("YYYY-MM-DD");
    context.step = "booking_time";
  }

  // Step 3: Get time
  if (pending.service && pending.date && !pending.time && !extracted.time) {
    // Get available slots
    const slots = await Appointment.getAvailableSlots(
      business.id,
      pending.date,
      pending.service.duration,
      business.buffer_time
    );

    if (slots.length === 0) {
      return `Unfortunately, ${moment(pending.date).format(
        "MMMM Do"
      )} is fully booked. Could you choose another date?`;
    }

    const slotsText = slots
      .slice(0, 6)
      .map((slot) => slot.formatted)
      .join(", ");
    return `What time works best for you on ${moment(pending.date).format(
      "MMMM Do"
    )}?\n\nAvailable times: ${slotsText}\n\nJust let me know your preferred time!`;
  }

  // Validate and set time
  if (extracted.time && !pending.time) {
    const requestedTime = moment(extracted.time, "HH:mm");
    const availability = await Appointment.checkAvailability(
      business.id,
      pending.date,
      requestedTime.format("HH:mm"),
      pending.service.duration
    );

    if (!availability.available) {
      const slots = await Appointment.getAvailableSlots(
        business.id,
        pending.date,
        pending.service.duration,
        business.buffer_time
      );

      if (slots.length === 0) {
        return `${requestedTime.format(
          "h:mm A"
        )} isn't available. Unfortunately, ${moment(pending.date).format(
          "MMMM Do"
        )} is now fully booked. Could you choose another date?`;
      }

      const alternativeSlots = slots
        .slice(0, 3)
        .map((slot) => slot.formatted)
        .join(", ");
      return `${requestedTime.format(
        "h:mm A"
      )} isn't available. How about: ${alternativeSlots}?`;
    }

    pending.time = requestedTime.format("HH:mm");
    context.step = "booking_confirm";
  }

  // Step 4: Confirm booking
  if (pending.service && pending.date && pending.time) {
    const appointment = await createAppointment({
      customerId: customer.id,
      businessId: business.id,
      service: pending.service,
      date: pending.date,
      time: pending.time,
    });

    if (appointment) {
      // Clear pending booking
      context.pendingBooking = {};
      context.step = "completed";

      return `Perfect! ✅ Your appointment is confirmed!\n\n📋 **Appointment Details:**\n• Service: ${
        appointment.service_name
      }\n• Date: ${appointment.getFormattedDate()}\n• Time: ${appointment.getFormattedTime()}\n• Duration: ${
        appointment.service_duration
      } minutes\n• Price: KSH ${
        appointment.service_price
      }\n• Confirmation Code: ${appointment.confirmation_code}\n\n📍 ${
        business.name
      }\n📞 Need to make changes? Just message me!\n\nSee you soon! 😊`;
    } else {
      return `I'm sorry, there was an issue creating your appointment. Please try again or contact us directly.`;
    }
  }

  return `I need a bit more information to complete your booking. What would you like to book?`;
}

// Handle reschedule flow
async function handleRescheduleFlow(
  intentAnalysis,
  context,
  business,
  customer
) {
  try {
    // Get customer's upcoming appointments
    const appointments = await Appointment.getCustomerAppointments(
      customer.id,
      "confirmed"
    );
    const upcomingAppointments = appointments.filter((apt) => apt.isUpcoming());

    if (upcomingAppointments.length === 0) {
      return `You don't have any upcoming appointments to reschedule. Would you like to book a new appointment instead?`;
    }

    if (upcomingAppointments.length === 1) {
      const apt = upcomingAppointments[0];
      context.pendingReschedule = { appointmentId: apt.id };

      return `I can help you reschedule your ${
        apt.service_name
      } appointment on ${apt.getFormattedDate()} at ${apt.getFormattedTime()}.\n\nWhat new date and time would you prefer?`;
    }

    // Multiple appointments - ask which one
    const aptList = upcomingAppointments
      .map(
        (apt, index) =>
          `${index + 1}. ${
            apt.service_name
          } - ${apt.getFormattedDate()} at ${apt.getFormattedTime()}`
      )
      .join("\n");

    return `You have multiple upcoming appointments:\n\n${aptList}\n\nWhich one would you like to reschedule? Just tell me the number.`;
  } catch (error) {
    console.error("❌ Reschedule flow error:", error);
    return `I'm having trouble accessing your appointments. Please try again in a moment.`;
  }
}

// Handle cancellation flow
async function handleCancellationFlow(
  intentAnalysis,
  context,
  business,
  customer
) {
  try {
    const appointments = await Appointment.getCustomerAppointments(
      customer.id,
      "confirmed"
    );
    const upcomingAppointments = appointments.filter((apt) => apt.isUpcoming());

    if (upcomingAppointments.length === 0) {
      return `You don't have any upcoming appointments to cancel.`;
    }

    if (upcomingAppointments.length === 1) {
      const apt = upcomingAppointments[0];

      if (!apt.canBeCancelled(business.cancellation_hours)) {
        return `I'm sorry, but your ${
          apt.service_name
        } appointment on ${apt.getFormattedDate()} at ${apt.getFormattedTime()} is within ${
          business.cancellation_hours
        } hours and cannot be cancelled online. Please call us directly.`;
      }

      context.pendingCancellation = { appointmentId: apt.id };
      return `Are you sure you want to cancel your ${
        apt.service_name
      } appointment on ${apt.getFormattedDate()} at ${apt.getFormattedTime()}?\n\nReply "yes" to confirm or "no" to keep the appointment.`;
    }

    // Multiple appointments
    const aptList = upcomingAppointments
      .map(
        (apt, index) =>
          `${index + 1}. ${
            apt.service_name
          } - ${apt.getFormattedDate()} at ${apt.getFormattedTime()}`
      )
      .join("\n");

    return `You have multiple upcoming appointments:\n\n${aptList}\n\nWhich one would you like to cancel? Tell me the number.`;
  } catch (error) {
    console.error("❌ Cancellation flow error:", error);
    return `I'm having trouble accessing your appointments. Please try again in a moment.`;
  }
}

// Handle appointment inquiry
async function handleAppointmentInquiry(customer) {
  try {
    const appointments = await Appointment.getCustomerAppointments(
      customer.id,
      "confirmed"
    );
    const upcomingAppointments = appointments.filter((apt) => apt.isUpcoming());

    if (upcomingAppointments.length === 0) {
      return `You don't have any upcoming appointments. Would you like to book one? 😊`;
    }

    const aptList = upcomingAppointments
      .map(
        (apt) =>
          `📅 **${
            apt.service_name
          }**\n• Date: ${apt.getFormattedDate()}\n• Time: ${apt.getFormattedTime()}\n• Code: ${
            apt.confirmation_code
          }`
      )
      .join("\n\n");

    return `Here are your upcoming appointments:\n\n${aptList}\n\nNeed to make any changes? Just let me know!`;
  } catch (error) {
    console.error("❌ Appointment inquiry error:", error);
    return `I'm having trouble accessing your appointments right now. Please try again in a moment.`;
  }
}

// Handle general inquiries
async function handleGeneralInquiry(messageText, messages, business) {
  try {
    // RAG: retrieve top chunks from business KB
    const retrieved = await searchFAQ({
      businessId: business.id,
      query: messageText,
      k: 3,
    });

    let contextText = "";
    if (retrieved && retrieved.length) {
      const bullets = retrieved
        .map(
          (r, idx) => `(${idx + 1}) ${r.title ? r.title + ": " : ""}${r.text}`
        )
        .join("\n\n");
      contextText = `Use the following business knowledge to answer the question. If the knowledge doesn't contain the answer, say you don't have that information and offer to connect to a staff member.\n\nKNOWLEDGE:\n${bullets}\n\n`;
    }

    const augmented = [
      { role: "system", content: `${messages[0].content}\n\n${contextText}` },
      ...messages.slice(1),
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: augmented,
      temperature: 0.5,
      max_tokens: 500,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("❌ General inquiry error:", error);

    // Fallback responses for common inquiries
    const lowerMessage = messageText.toLowerCase();

    if (
      lowerMessage.includes("hours") ||
      lowerMessage.includes("open") ||
      lowerMessage.includes("time")
    ) {
      const hours = Object.entries(business.working_hours)
        .map(
          ([day, h]) =>
            `${day.charAt(0).toUpperCase() + day.slice(1)}: ${
              h.closed ? "Closed" : `${h.open} - ${h.close}`
            }`
        )
        .join("\n");
      return `Our working hours are:\n\n${hours}\n\nHow can I help you today?`;
    }

    if (
      lowerMessage.includes("service") ||
      lowerMessage.includes("what do you")
    ) {
      const services = business.services
        .map((s) => `• ${s.name} - KSH ${s.price} (${s.duration} mins)`)
        .join("\n");
      return `Here are our services:\n\n${services}\n\nWould you like to book an appointment?`;
    }

    if (lowerMessage.includes("price") || lowerMessage.includes("cost")) {
      const services = business.services
        .map((s) => `${s.name}: KSH ${s.price}`)
        .join("\n");
      return `Our service prices:\n\n${services}\n\nAll prices are in Kenyan Shillings. Would you like to book?`;
    }

    return `Hello! I'm here to help you book appointments at ${business.name}. I can help you:\n\n• Book new appointments\n• Reschedule existing appointments\n• Cancel appointments\n• Check appointment details\n• Answer questions about our services\n\nWhat would you like to do today? 😊`;
  }
}

// Handle confirmation responses (yes/no for cancellations, etc.)
async function handleConfirmationResponse(messageText, context, customer) {
  const lowerMessage = messageText.toLowerCase().trim();

  if (
    context.pendingCancellation &&
    (lowerMessage === "yes" ||
      lowerMessage === "y" ||
      lowerMessage === "confirm")
  ) {
    const appointment = await Appointment.findById(
      context.pendingCancellation.appointmentId
    );

    if (appointment) {
      await cancelAppointment(
        appointment.id,
        "Customer requested cancellation"
      );
      context.pendingCancellation = null;

      return `Your ${
        appointment.service_name
      } appointment on ${appointment.getFormattedDate()} has been cancelled successfully. ✅\n\nWe hope to see you again soon! Feel free to book another appointment anytime.`;
    }
  }

  if (
    context.pendingCancellation &&
    (lowerMessage === "no" || lowerMessage === "n" || lowerMessage === "keep")
  ) {
    context.pendingCancellation = null;
    return `Great! Your appointment is still confirmed. See you soon! 😊`;
  }

  return null; // No confirmation context found
}

// Clear conversation memory (for testing/debugging)
function clearConversationMemory(customerPhone = null) {
  if (customerPhone) {
    conversationMemory.delete(customerPhone);
    try {
      redisDel(memKey(customerPhone));
    } catch (_) {}
  } else {
    conversationMemory.clear();
    // Not clearing all keys in Redis to avoid wildcards; requires external flush if needed
  }
}

// Get conversation memory (for debugging)
function getConversationMemory(customerPhone) {
  return conversationMemory.get(customerPhone);
}

module.exports = {
  processIncomingMessage,
  clearConversationMemory,
  getConversationMemory,
};
