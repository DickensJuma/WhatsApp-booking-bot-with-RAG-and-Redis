#!/usr/bin/env node
/*
  Pinecone Batch Sync
  - Re-embeds and upserts all active FAQChunk docs into the configured Pinecone index.
  - Respects PINECONE_NAMESPACE and guards against dimension mismatches.
  Usage:
    node scripts/pineconeSync.js [--business <id>] [--dry-run]
*/

const dotenv = require("dotenv");
dotenv.config();

const mongoose = require("mongoose");
require("../config/database");
const FAQChunk = require("../model/FAQChunk");
const {
  pineconeEnabled,
  pineconeUpsertOrNull,
} = require("../services/vectorService");

function parseArgs(argv) {
  const out = { business: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--business" || a === "-b") {
      out.business = argv[++i];
    } else if (a === "--dry-run") {
      out.dryRun = true;
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!pineconeEnabled()) {
    console.log(
      "ℹ️ Pinecone is disabled (check API key, index, and dimensions). Aborting."
    );
    process.exit(0);
  }

  const query = { is_active: true };
  if (opts.business)
    query.business_id = new mongoose.Types.ObjectId(opts.business);

  const total = await FAQChunk.countDocuments(query);
  console.log(
    `🔎 Found ${total} active KB items${
      opts.business ? " for business " + opts.business : ""
    }.`
  );
  if (total === 0) {
    process.exit(0);
  }

  const cursor = FAQChunk.find(query).cursor();
  let ok = 0,
    fail = 0;
  for await (const doc of cursor) {
    try {
      if (opts.dryRun) {
        console.log(
          `DRY-RUN would upsert id=${doc.id} title=${doc.title || ""}`
        );
      } else {
        await pineconeUpsertOrNull({
          businessId: doc.business_id,
          docId: doc.id,
          text: doc.text,
          metadata: { title: doc.title, source: doc.source },
        });
      }
      ok++;
    } catch (e) {
      console.warn("⚠️ Upsert failed for", doc.id, e?.message || e);
      fail++;
    }
  }

  console.log(`✅ Done. Success: ${ok}, Failed: ${fail}`);
  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error("❌ Sync error:", err);
  try {
    await mongoose.connection.close();
  } catch (_) {}
  process.exit(1);
});
