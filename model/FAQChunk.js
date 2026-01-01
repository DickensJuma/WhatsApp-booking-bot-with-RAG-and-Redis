const mongoose = require("mongoose");

const FAQChunkSchema = new mongoose.Schema(
  {
    business_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    title: { type: String, required: false },
    text: { type: String, required: true },
    source: { type: String, required: false },
    embedding: { type: [Number], default: [], index: false },
    metadata: { type: Object, default: {} },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Create indexes for performance
FAQChunkSchema.index({ business_id: 1, is_active: 1 }); // Most common query pattern
FAQChunkSchema.index({ business_id: 1, text: "text" }); // Text search index

module.exports = mongoose.model("FAQChunk", FAQChunkSchema);
