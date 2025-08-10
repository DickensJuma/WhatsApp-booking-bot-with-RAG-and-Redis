require("dotenv").config();
require("../config/database");
const moment = require("moment");
const Business = require("../model/Business");
const Customer = require("../model/Customer");
const { createAppointment } = require("../services/bookingService");

(async () => {
  try {
    const business = await Business.findOne({ is_active: true });
    if (!business) throw new Error("No business found");

    // Ensure customer exists
    const phone = "+254700123456";
    let customer = await Customer.findOne({ whatsapp_number: phone });
    if (!customer)
      customer = await Customer.create({
        whatsapp_number: phone,
        name: "Test User",
      });

    // Pick a service
    const service =
      business.getServiceByName("Haircut") || business.services[0];
    if (!service) throw new Error("No services configured");

    const date = moment().add(1, "day").format("YYYY-MM-DD");
    const time = "10:00";

    const appointment = await createAppointment({
      customerId: customer.id,
      businessId: business.id,
      service,
      date,
      time,
      notes: "Smoke test",
    });

    console.log("SMOKE_OK", {
      id: appointment.id,
      code: appointment.confirmation_code,
      date: appointment.getFormattedDate(),
      time: appointment.getFormattedTime(),
      service: appointment.service_name,
    });

    process.exit(0);
  } catch (err) {
    console.error("SMOKE_FAIL", err.message);
    process.exit(1);
  }
})();
