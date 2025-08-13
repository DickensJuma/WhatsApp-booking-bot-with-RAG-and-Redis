// Mock OpenAI before loading app
jest.mock("openai", () => {
  return function MockOpenAI() {
    return {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content:
                    '{"intent":"general_inquiry","confidence":0.9,"extracted_info":{}}',
                },
              },
            ],
          }),
        },
      },
    };
  };
});

const request = require("supertest");
// Ensure env is set for mock provider BEFORE requiring server
process.env.WHATSAPP_PROVIDER = "mock";
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || "test_admin_token";
const app = require("../server");
const mongoose = require("mongoose");

describe("Mock provider debug endpoints", () => {
  afterAll(async () => {
    try {
      await mongoose.connection.close();
    } catch (_) {}
  });

  it("injects a message and records AI reply", async () => {
    const res = await request(app)
      .post("/debug/inject")
      .set("x-admin-token", process.env.ADMIN_TOKEN)
      .send({ from: "+15550001111", message: "Hi I want to book a service" });
    expect(res.status).toBe(200);
    expect(res.body.injected).toBe(true);
  });

  it("lists messages", async () => {
    const res = await request(app)
      .get("/debug/messages")
      .set("x-admin-token", process.env.ADMIN_TOKEN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it("clears messages", async () => {
    const res = await request(app)
      .post("/debug/messages/clear")
      .set("x-admin-token", process.env.ADMIN_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.cleared).toBe(true);
  });
});
