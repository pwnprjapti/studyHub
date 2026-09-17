const mongoose = require('mongoose');

const WhatsAppMessageSchema = new mongoose.Schema(
  {
    messageId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    groupName: {
      type: String,
      required: true,
      index: true,
    },
    matchedGroup: {
      type: String,
      default: '',
    },
    sender: {
      type: String,
      default: '',
    },
    message: {
      type: String,
      required: true,
    },
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
    packageName: {
      type: String,
      default: 'com.whatsapp',
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying a group's messages sorted by timestamp
WhatsAppMessageSchema.index({ groupName: 1, timestamp: -1 });

module.exports = mongoose.model('WhatsAppMessage', WhatsAppMessageSchema);
