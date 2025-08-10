const mongoose = require("mongoose");

const MemorySchema = new mongoose.Schema(
  {
    customer_phone: { type: String, index: true, required: true },
    history: { type: Array, default: [] }, // [{role:'user'|'assistant', content:string, ts:Date}]
    updated_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Memory", MemorySchema);
