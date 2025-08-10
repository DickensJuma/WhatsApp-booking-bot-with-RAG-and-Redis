const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

// Mock env
process.env.NODE_ENV = "test";
process.env.ADMIN_TOKEN = "test-admin";
process.env.OPENAI_API_KEY = "sk-test";
process.env.PINECONE_API_KEY = "";
process.env.PINECONE_INDEX = "";
process.env.REDIS_URL = "disabled";

// Mock OpenAIEmbeddings inside vectorService by monkey-patching method at runtime
jest.mock("langchain/embeddings/openai", () => {
  class OpenAIEmbeddings {
    constructor() {}
    async embedQuery(text) {
      // Simple deterministic numeric mapping by char codes -> 8 dims
      const dims = 8;
      const vec = new Array(dims).fill(0);
      for (let i = 0; i < text.length; i++) {
        vec[i % dims] += text.charCodeAt(i) % 13;
      }
      return vec;
    }
  }
  return { OpenAIEmbeddings };
});

let app;
let mongo;
let Business;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();
  process.env.MONGODB_URI = uri;
  // Load server after env is set so DB connects to mem server
  app = require("../server");
  // Ensure mongoose connects to the memory server
  require("../config/database");
  Business = require("../model/Business");
});

afterAll(async () => {
  await mongoose.connection.close();
  if (mongo) await mongo.stop();
});

describe("KB endpoints", () => {
  let businessId;

  beforeAll(async () => {
    // Create a business explicitly for tests
    const b = await Business.create({
      name: "Test Biz",
      description: "Test",
      phone: "+254700000000",
      email: "test@example.com",
      address: "Nairobi",
      services: [
        { name: "Haircut", duration: 45, price: 1200 },
        { name: "Manicure", duration: 60, price: 1500 },
      ],
    });
    businessId = b.id;
  });

  test("POST /business/:id/faq creates item", async () => {
    const res = await request(app)
      .post(`/business/${businessId}/faq`)
      .set("x-admin-token", process.env.ADMIN_TOKEN)
      .send({
        title: "Cancel Policy",
        text: "Cancel at least 24 hours before.",
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
  });

  test("GET /business/:id/faq lists items", async () => {
    const res = await request(app)
      .get(`/business/${businessId}/faq`)
      .set("x-admin-token", process.env.ADMIN_TOKEN);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test("PUT /business/:id/faq/:itemId updates text and syncs", async () => {
    const list = await request(app)
      .get(`/business/${businessId}/faq`)
      .set("x-admin-token", process.env.ADMIN_TOKEN);
    const itemId = list.body.data[0].id;
    const res = await request(app)
      .put(`/business/${businessId}/faq/${itemId}`)
      .set("x-admin-token", process.env.ADMIN_TOKEN)
      .send({ text: "You must cancel 24+ hours in advance." });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("DELETE /business/:id/faq/:itemId soft-deletes", async () => {
    // Create another doc
    const created = await request(app)
      .post(`/business/${businessId}/faq`)
      .set("x-admin-token", process.env.ADMIN_TOKEN)
      .send({ title: "Hours", text: "Open 9 to 5." });
    const id = created.body.data.id;
    const res = await request(app)
      .delete(`/business/${businessId}/faq/${id}`)
      .set("x-admin-token", process.env.ADMIN_TOKEN);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("Vector retrieval", () => {
  test("searchFAQ returns relevant chunks", async () => {
    const b = await Business.create({ name: "Vec Biz", services: [] });
    const { upsertFAQChunk, searchFAQ } = require("../services/vectorService");

    await upsertFAQChunk({
      businessId: b.id,
      title: "Policy",
      text: "Cancel 24 hours before.",
      source: "kb",
    });
    await upsertFAQChunk({
      businessId: b.id,
      title: "Pricing",
      text: "Haircut KSH 1200",
      source: "kb",
    });
    const res = await searchFAQ({
      businessId: b.id,
      query: "When can I cancel?",
      k: 2,
    });
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
    const topText = (res[0].text || "").toLowerCase();
    expect(topText.includes("cancel")).toBe(true);
  });
});
