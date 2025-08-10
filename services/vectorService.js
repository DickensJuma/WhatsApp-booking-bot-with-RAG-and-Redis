const { OpenAIEmbeddings } = require("langchain/embeddings/openai");
let CohereEmbeddings = null;
try {
  CohereEmbeddings = require("langchain/embeddings/cohere").CohereEmbeddings;
} catch (_) {
  // optional
}
let PineconeLib = null;
try {
  PineconeLib = require("@pinecone-database/pinecone").Pinecone;
} catch (_) {
  // optional
}
const FAQChunk = require("../model/FAQChunk");

// Simple in-memory vector index as fallback (per business)
// For production, replace with Pinecone or pgvector.
const memoryIndex = new Map(); // businessId -> [{ id, embedding, text, metadata }]

function cosineSim(a, b) {
  const dot = a.reduce((sum, v, i) => sum + v * (b[i] || 0), 0);
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  return magA && magB ? dot / (magA * magB) : 0;
}

const PROVIDER = (process.env.EMBEDDINGS_PROVIDER || "openai").toLowerCase();
const OPENAI_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
const COHERE_MODEL = process.env.COHERE_EMBED_MODEL || "embed-english-v3.0";
// Known dims
const KNOWN_EMBED_DIMS = {
  // OpenAI
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
  // Cohere v3
  "embed-english-v3.0": 1024,
  "embed-multilingual-v3.0": 1024,
};

function currentEmbedDims() {
  if (PROVIDER === "cohere") return KNOWN_EMBED_DIMS[COHERE_MODEL] || 1024;
  return KNOWN_EMBED_DIMS[OPENAI_MODEL] || 1536;
}
const EMBED_DIMS = currentEmbedDims();

let embeddings = null;
function createEmbeddings() {
  if (PROVIDER === "cohere" && CohereEmbeddings) {
    return new CohereEmbeddings({
      apiKey: process.env.COHERE_API_KEY,
      model: COHERE_MODEL,
    });
  }
  return new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
    model: OPENAI_MODEL,
  });
}
embeddings = createEmbeddings();

async function embedText(text) {
  try {
    const vec = await embeddings.embedQuery(text);
    return vec;
  } catch (err) {
    console.warn(
      "⚠️ Embedding failed, falling back to text search only:",
      err?.message || err
    );
    return null; // Signal no embedding available
  }
}

async function upsertFAQChunk({ businessId, title, text, source, metadata }) {
  // Create doc first without embedding to avoid failing the request
  const baseDoc = await FAQChunk.create({
    business_id: businessId,
    title,
    text,
    source,
    metadata: metadata || {},
    embedding: [],
  });

  // Best-effort embedding and index update
  try {
    const embedding = await embedText(text);
    if (Array.isArray(embedding)) {
      baseDoc.embedding = embedding;
      await baseDoc.save();
      const key = String(businessId);
      const arr = memoryIndex.get(key) || [];
      arr.push({
        id: baseDoc.id,
        embedding,
        text,
        metadata: baseDoc.metadata,
        title,
      });
      memoryIndex.set(key, arr);
    }
  } catch (e) {
    // already handled in embedText; proceed without embedding
  }

  return baseDoc;
}

async function rebuildMemoryIndex(businessId) {
  const key = String(businessId);
  const docs = await FAQChunk.find({
    business_id: businessId,
    is_active: true,
  });
  memoryIndex.set(
    key,
    docs.map((d) => ({
      id: d.id,
      embedding: d.embedding || [],
      text: d.text,
      metadata: d.metadata,
      title: d.title,
    }))
  );
}

async function searchFAQ({ businessId, query, k = 3 }) {
  // Prefer Pinecone when available
  try {
    if (pineconeEnabled()) {
      const pc = await pineconeSearch({ businessId, query, k });
      if (pc && pc.length) return pc;
    }
  } catch (e) {
    console.warn("⚠️ Pinecone search failed:", e?.message || e);
  }
  const key = String(businessId);
  if (!memoryIndex.has(key)) {
    await rebuildMemoryIndex(businessId);
  }
  const arr = memoryIndex.get(key) || [];
  // If we have embeddings and items with vectors, do vector search
  const hasVectors = arr.some(
    (it) => Array.isArray(it.embedding) && it.embedding.length
  );
  if (hasVectors) {
    const qVec = await embedText(query);
    if (Array.isArray(qVec)) {
      const ranked = arr
        .map((item) => ({
          ...item,
          score: cosineSim(qVec, item.embedding || []),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
      return ranked;
    }
  }

  // Fallback: MongoDB text search
  try {
    const docs = await FAQChunk.find(
      { business_id: businessId, is_active: true, $text: { $search: query } },
      { score: { $meta: "textScore" } }
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(k);
    return docs.map((d) => ({
      id: d.id,
      title: d.title,
      text: d.text,
      metadata: d.metadata,
      score: d.score || 0,
    }));
  } catch (err) {
    console.warn("⚠️ Text search fallback failed:", err?.message || err);
    return [];
  }
}

module.exports = { upsertFAQChunk, searchFAQ, rebuildMemoryIndex };

// ---- Pinecone integration (optional) ----
let pinecone = null;
let pineconeIndex = null;
let pineconeWarnedDims = false;

function getIndexDims() {
  const idxDims = parseInt(process.env.PINECONE_DIMENSIONS || "0", 10);
  return Number.isFinite(idxDims) && idxDims > 0 ? idxDims : 0;
}

function projectVector(vec, targetDim) {
  if (!Array.isArray(vec)) return vec;
  if (!targetDim || vec.length === targetDim) return vec;
  if (vec.length > targetDim) return vec.slice(0, targetDim);
  // If smaller, pad with zeros to targetDim
  const out = vec.slice();
  while (out.length < targetDim) out.push(0);
  return out;
}

function pineconeEnabled() {
  const enabled =
    !!PineconeLib &&
    !!process.env.PINECONE_API_KEY &&
    !!process.env.PINECONE_INDEX;
  if (!enabled) return false;
  const idxDims = getIndexDims();
  if (idxDims && idxDims !== EMBED_DIMS && !pineconeWarnedDims) {
    console.warn(
      `⚠️ Pinecone: projecting embeddings from ${EMBED_DIMS} to index dims ${idxDims}. Consider aligning dims for best results.`
    );
    pineconeWarnedDims = true;
  }
  return true;
}

async function ensurePinecone() {
  if (!pineconeEnabled()) return null;
  if (!pinecone) {
    pinecone = new PineconeLib({ apiKey: process.env.PINECONE_API_KEY });
  }
  if (!pineconeIndex) {
    pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX);
  }
  return pineconeIndex;
}

async function pineconeUpsert({ businessId, docId, text, metadata }) {
  const idx = await ensurePinecone();
  if (!idx) return;
  let vec = await embedText(text);
  if (!Array.isArray(vec)) return;
  const idxDims = getIndexDims();
  if (idxDims) vec = projectVector(vec, idxDims);
  const namespace = process.env.PINECONE_NAMESPACE || undefined;
  if (typeof idx.upsert === "function") {
    await idx.upsert({
      upsertRequest: {
        vectors: [
          {
            id: String(docId),
            values: vec,
            metadata: { businessId: String(businessId), ...metadata, text },
          },
        ],
        namespace,
      },
    });
  }
}

async function pineconeSearch({ businessId, query, k = 3 }) {
  const idx = await ensurePinecone();
  if (!idx) return null;
  let qVec = await embedText(query);
  if (!Array.isArray(qVec)) return null;
  const idxDims = getIndexDims();
  if (idxDims) qVec = projectVector(qVec, idxDims);
  const namespace = process.env.PINECONE_NAMESPACE || undefined;
  let res = { matches: [] };
  if (typeof idx.query === "function") {
    res = await idx.query({
      queryRequest: {
        vector: qVec,
        topK: k,
        includeMetadata: true,
        filter: { businessId: String(businessId) },
        namespace,
      },
    });
  }
  const matches = res.matches || res.data?.matches || [];
  return matches.map((m) => ({
    id: m.id,
    score: m.score,
    text: m.metadata?.text,
    title: m.metadata?.title,
    metadata: m.metadata,
  }));
}

// expose advanced helpers
module.exports.pineconeEnabled = pineconeEnabled;
module.exports.pineconeUpsert = pineconeUpsert;
module.exports.pineconeSearch = pineconeSearch;

// ---- Chunking helper ----
function chunkText(text, maxChars = 800) {
  // Prefer splitting at sentence boundaries when possible
  const output = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let buf = "";
  for (const s of sentences) {
    if ((buf + " " + s).trim().length > maxChars) {
      if (buf) output.push(buf.trim());
      if (s.length > maxChars) {
        // Hard-split long sentence
        for (let i = 0; i < s.length; i += maxChars) {
          output.push(s.slice(i, i + maxChars));
        }
        buf = "";
      } else {
        buf = s;
      }
    } else {
      buf = (buf ? buf + " " : "") + s;
    }
  }
  if (buf) output.push(buf.trim());
  return output;
}
module.exports.chunkText = chunkText;

async function pineconeUpsertOrNull({ businessId, docId, text, metadata }) {
  try {
    if (pineconeEnabled()) {
      await pineconeUpsert({ businessId, docId, text, metadata });
    }
  } catch (e) {
    console.warn("⚠️ Pinecone upsert error:", e?.message || e);
  }
}
module.exports.pineconeUpsertOrNull = pineconeUpsertOrNull;

async function pineconeDelete(docId) {
  try {
    const idx = await ensurePinecone();
    if (!idx) return;
    const namespace = process.env.PINECONE_NAMESPACE || undefined;
    if (typeof idx._delete === "function") {
      await idx._delete({ ids: [String(docId)], namespace });
    }
  } catch (e) {
    console.warn("⚠️ Pinecone delete error:", e?.message || e);
  }
}
module.exports.pineconeDelete = pineconeDelete;
