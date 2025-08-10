const express = require("express");
const router = express.Router();
const Business = require("../model/Business");
const FAQChunk = require("../model/FAQChunk");
const {
  upsertFAQChunk,
  pineconeUpsert,
  pineconeEnabled,
  chunkText,
} = require("../services/vectorService");
const {
  pineconeUpsertOrNull,
  pineconeDelete,
} = require("../services/vectorService");
const rateLimit = require("express-rate-limit");

// Basic auth middleware (simple token header)
function requireKBAuth(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return res
      .status(500)
      .json({
        success: false,
        error: "Server misconfiguration: ADMIN_TOKEN not set",
      });
  }
  if (token && token === expected) return next();
  return res.status(401).json({ success: false, error: "Unauthorized" });
}

// Apply rate limiting to KB routes
router.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

// Add or update FAQ/KB item (embed + store)
router.post("/:id/faq", requireKBAuth, async (req, res) => {
  try {
    const businessId = req.params.id;
    const { title, text, source, metadata } = req.body;

    const business = await Business.findById(businessId);
    if (!business) {
      return res
        .status(404)
        .json({ success: false, error: "Business not found" });
    }

    if (!text || text.trim().length < 5) {
      return res.status(400).json({
        success: false,
        error: "'text' is required and should be meaningful",
      });
    }

    const doc = await upsertFAQChunk({
      businessId,
      title: title || null,
      text,
      source: source || null,
      metadata: metadata || {},
    });

    // Optional: also push to Pinecone if available
    try {
      if (pineconeEnabled()) {
        await pineconeUpsert({
          businessId,
          docId: doc.id,
          text,
          metadata: { title: doc.title, source: doc.source },
        });
      }
    } catch (e) {
      console.warn("⚠️ Pinecone upsert failed:", e?.message || e);
    }

    res.json({
      success: true,
      data: { id: doc.id, title: doc.title, createdAt: doc.createdAt },
    });
  } catch (error) {
    console.error("❌ KB upsert error:", error);
    res.status(500).json({ success: false, error: "Failed to add FAQ item" });
  }
});

// List all FAQ/KB items for a business
router.get("/:id/faq", requireKBAuth, async (req, res) => {
  try {
    const businessId = req.params.id;
    const items = await FAQChunk.find({
      business_id: businessId,
      is_active: true,
    }).sort({ createdAt: -1 });
    res.json({
      success: true,
      data: items.map((i) => ({
        id: i.id,
        title: i.title,
        text: i.text,
        source: i.source,
        metadata: i.metadata,
        createdAt: i.createdAt,
      })),
    });
  } catch (error) {
    console.error("❌ KB list error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch FAQ items" });
  }
});

// Update an existing KB item
router.put("/:id/faq/:itemId", requireKBAuth, async (req, res) => {
  try {
    const { id: businessId, itemId } = req.params;
    const { title, text, source, metadata } = req.body;
    const item = await FAQChunk.findOne({
      _id: itemId,
      business_id: businessId,
    });
    if (!item)
      return res.status(404).json({ success: false, error: "Item not found" });

    const textChanged = text !== undefined && text !== item.text;
    if (title !== undefined) item.title = title;
    if (text !== undefined) item.text = text;
    if (source !== undefined) item.source = source;
    if (metadata !== undefined) item.metadata = metadata;
    await item.save();

    // Sync Pinecone if enabled and text changed
    try {
      if (textChanged && pineconeEnabled()) {
        await pineconeUpsertOrNull({
          businessId,
          docId: item.id,
          text: item.text,
          metadata: { title: item.title, source: item.source },
        });
      }
    } catch (_) {}

    res.json({
      success: true,
      data: { id: item.id, updatedAt: item.updatedAt },
    });
  } catch (error) {
    console.error("❌ KB update error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to update FAQ item" });
  }
});

// Delete (soft) a KB item
router.delete("/:id/faq/:itemId", requireKBAuth, async (req, res) => {
  try {
    const { id: businessId, itemId } = req.params;
    const item = await FAQChunk.findOne({
      _id: itemId,
      business_id: businessId,
    });
    if (!item)
      return res.status(404).json({ success: false, error: "Item not found" });
    item.is_active = false;
    await item.save();
    try {
      if (pineconeEnabled()) await pineconeDelete(item.id);
    } catch (_) {}
    res.json({ success: true, message: "Item deactivated" });
  } catch (error) {
    console.error("❌ KB delete error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to delete FAQ item" });
  }
});

// Bulk chunking endpoint for large documents
router.post("/:id/faq/bulk", requireKBAuth, async (req, res) => {
  try {
    const { id: businessId } = req.params;
    const { title, text, source, metadata, maxChars } = req.body;
    if (!text || text.length < 5)
      return res
        .status(400)
        .json({ success: false, error: "'text' is required" });
    const chunks = chunkText(
      text,
      Math.min(Math.max(parseInt(maxChars) || 800, 200), 2000)
    );
    const results = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkTitle = title
        ? `${title} (Part ${i + 1}/${chunks.length})`
        : null;
      const doc = await upsertFAQChunk({
        businessId,
        title: chunkTitle,
        text: chunks[i],
        source: source || null,
        metadata: metadata || {},
      });
      try {
        if (pineconeEnabled()) {
          await pineconeUpsert({
            businessId,
            docId: doc.id,
            text: chunks[i],
            metadata: { title: doc.title, source: doc.source, part: i + 1 },
          });
        }
      } catch (e) {
        console.warn("⚠️ Pinecone upsert failed (bulk):", e?.message || e);
      }
      results.push({ id: doc.id, title: doc.title });
    }
    res.json({ success: true, count: results.length, data: results });
  } catch (error) {
    console.error("❌ KB bulk error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to add bulk FAQ items" });
  }
});

module.exports = router;
