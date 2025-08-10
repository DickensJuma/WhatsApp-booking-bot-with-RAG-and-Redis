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

// Create a compound index for business and text search
FAQChunkSchema.index({ business_id: 1, text: "text" });

module.exports = mongoose.model("FAQChunk", FAQChunkSchema);
