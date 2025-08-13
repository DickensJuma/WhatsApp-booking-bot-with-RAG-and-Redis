const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

// Environment setup
process.env.NODE_ENV = "test";
process.env.ADMIN_TOKEN = "test-admin";
process.env.OPENAI_API_KEY = "sk-test";
process.env.WHATSAPP_PROVIDER = "mock";
process.env.REDIS_URL = "disabled";
process.env.PINECONE_API_KEY = "";
process.env.PINECONE_INDEX = "";

// Mock OpenAI (intent + general replies) to deterministic minimal content
jest.mock("openai", () => {
  return function MockOpenAI() {
    return {
      chat: {
        completions: {
          create: async ({ messages }) => {
            const last = messages[messages.length - 1].content.toLowerCase();
            // crude intent detection for testing booking path
            let intent = "general_inquiry";
            if (last.includes("book")) intent = "book_appointment";
            const extracted = {};
            if (last.includes("facial")) extracted.service = "Facial";
            if (/\d{4}-\d{2}-\d{2}/.test(last))
              extracted.date = last.match(/\d{4}-\d{2}-\d{2}/)[0];
            if (/10:00/.test(last)) extracted.time = "10:00";
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

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  app = require("../server");
  require("../config/database");
  Business = require("../model/Business");
  Appointment = require("../model/Appointment");
  await Business.create({
    name: "TestBiz",
    services: [{ name: "Facial", duration: 60, price: 3000 }],
  });
});

afterAll(async () => {
  await mongoose.connection.close();
  if (mongo) await mongo.stop();
});

describe("Booking conversation flow", () => {
  const phone = "+15551112222";
  it("creates an appointment through simulated steps", async () => {
    // Step 1: greet
    await request(app)
      .post("/debug/inject")
      .set("x-admin-token", process.env.ADMIN_TOKEN)
      .send({ from: phone, message: "Hi" })
      .expect(200);

    // Step 2: booking intent
    await request(app)
      .post("/debug/inject")
      .set("x-admin-token", process.env.ADMIN_TOKEN)
      .send({ from: phone, message: "I want to book a facial" })
      .expect(200);

    const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    // Step 3: provide date
    await request(app)
      .post("/debug/inject")
      .set("x-admin-token", process.env.ADMIN_TOKEN)
      .send({ from: phone, message: date })
      .expect(200);

    // Step 4: provide time
    await request(app)
      .post("/debug/inject")
      .set("x-admin-token", process.env.ADMIN_TOKEN)
      .send({ from: phone, message: "10:00" })
      .expect(200);

    // Verify appointment created
    const aptCount = await Appointment.countDocuments({});
    expect(aptCount).toBe(1);
    const apt = await Appointment.findOne({});
    expect(apt.service_name).toBe("Facial");
    expect(apt.status).toBe("confirmed");
  });
});
