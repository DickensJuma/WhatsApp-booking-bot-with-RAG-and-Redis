const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

process.env.NODE_ENV = "test";
process.env.ADMIN_TOKEN = "test-admin";
process.env.OPENAI_API_KEY = "sk-test";
process.env.WHATSAPP_PROVIDER = "mock";
process.env.REDIS_URL = "disabled";
process.env.PINECONE_API_KEY = "";
process.env.PINECONE_INDEX = "";

// Mock OpenAI similar to booking test
jest.mock("openai", () => {
  return function MockOpenAI() {
    return {
      chat: {
        completions: {
          create: async ({ messages }) => {
            const last = messages[messages.length - 1].content.toLowerCase();
            let intent = "general_inquiry";
            if (last.includes("book")) intent = "book_appointment";
            if (last.includes("cancel")) intent = "cancel_appointment";
            const extracted = {};
            if (last.includes("facial")) extracted.service = "Facial";
            if (/\d{4}-\d{2}-\d{2}/.test(last))
              extracted.date = last.match(/\d{4}-\d{2}-\d{2}/)[0];
            if (/09:00/.test(last)) extracted.time = "09:00";
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      intent,
                      confidence: 0.9,
                      extracted_info: extracted,
                    }),
                  },
                },
              ],
            };
          },
        },
      },
    };
  };
});

let app;
let mongo;
let Business;
let Appointment;
let Customer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  app = require("../server");
  require("../config/database");
  Business = require("../model/Business");
  Appointment = require("../model/Appointment");
  Customer = require("../model/Customer");
  await Business.create({
    name: "TestBiz",
    services: [{ name: "Facial", duration: 60, price: 3000 }],
    cancellation_hours: 1,
  });
});

afterAll(async () => {
  await mongoose.connection.close();
  if (mongo) await mongo.stop();
});

describe("Cancellation conversation flow", () => {
  const phone = "+15553334444";
  it("cancels an existing appointment after confirmation", async () => {
    const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    // Create booking
    await request(app)
      .post("/debug/inject")
      .set("x-admin-token", process.env.ADMIN_TOKEN)
      .send({ from: phone, message: "Hi" })
      .expect(200);
    await request(app)
      .post("/debug/inject")
      .set("x-admin-token", process.env.ADMIN_TOKEN)
      .send({ from: phone, message: "I want to book a facial" })
      .expect(200);
    await request(app)
      .post("/debug/inject")
      .set("x-admin-token", process.env.ADMIN_TOKEN)
      .send({ from: phone, message: date })
      .expect(200);
    await request(app)
      .post("/debug/inject")
      .set("x-admin-token", process.env.ADMIN_TOKEN)
      .send({ from: phone, message: "09:00" })
      .expect(200);
    let apt = await Appointment.findOne({});
    expect(apt).toBeTruthy();
    expect(apt.status).toBe("confirmed");

    // Initiate cancellation
    await request(app)
      .post("/debug/inject")
      .set("x-admin-token", process.env.ADMIN_TOKEN)
      .send({ from: phone, message: "I want to cancel my appointment" })
      .expect(200);
    // Confirm
    await request(app)
      .post("/debug/inject")
      .set("x-admin-token", process.env.ADMIN_TOKEN)
      .send({ from: phone, message: "yes" })
      .expect(200);

    apt = await Appointment.findById(apt._id);
    expect(apt.status).toBe("cancelled");
  });
});
