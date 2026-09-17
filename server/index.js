require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const WhatsAppMessage = require('./models/WhatsAppMessage');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp_notifications';

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB
let isMongoConnected = false;

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    isMongoConnected = true;
    console.log('✅ Connected to MongoDB successfully.');
  })
  .catch((err) => {
    isMongoConnected = false;
    console.error('❌ MongoDB connection error:', err.message);
    console.log('💡 Note: You can update MONGODB_URI in server/.env with your MongoDB Atlas or local connection string.');
  });

mongoose.connection.on('disconnected', () => {
  isMongoConnected = false;
  console.log('⚠️ MongoDB disconnected.');
});

mongoose.connection.on('reconnected', () => {
  isMongoConnected = true;
  console.log('🔄 MongoDB reconnected.');
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mongoStatus: isMongoConnected ? 'connected' : 'disconnected',
    databaseUri: MONGODB_URI.replace(/\/\/.*@/, '//***:***@'), // Mask credentials
    timestamp: new Date(),
  });
});

// Save single message or batch of messages
app.post('/api/messages', async (req, res) => {
  try {
    const payload = req.body;
    const messages = Array.isArray(payload)
      ? payload
      : payload.messages && Array.isArray(payload.messages)
      ? payload.messages
      : [payload];

    if (messages.length === 0) {
      return res.status(400).json({ error: 'No messages provided' });
    }

    const bulkOps = messages.map((m) => {
      const messageId = m.id || m.messageId || `${Date.now()}_${Math.random()}`;
      const groupName = m.groupName || m.matchedGroup || 'Unknown Group';
      const sender = m.sender || m.title || 'Unknown';
      const message = m.message || '';
      const timestamp = m.timestamp ? new Date(m.timestamp) : new Date();
      const matchedGroup = m.matchedGroup || '';
      const packageName = m.packageName || 'com.whatsapp';

      return {
        updateOne: {
          filter: { messageId },
          update: {
            $set: {
              messageId,
              groupName,
              matchedGroup,
              sender,
              message,
              timestamp,
              packageName,
            },
            $setOnInsert: {
              receivedAt: new Date(),
            },
          },
          upsert: true,
        },
      };
    });

    const result = await WhatsAppMessage.bulkWrite(bulkOps);
    console.log(`[MongoDB] Upserted ${result.upsertedCount || 0}, Modified ${result.modifiedCount || 0} messages.`);

    res.json({
      success: true,
      insertedCount: result.upsertedCount || 0,
      modifiedCount: result.modifiedCount || 0,
      totalProcessed: messages.length,
    });
  } catch (error) {
    console.error('Error saving messages to MongoDB:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get stored messages with optional filtering
app.get('/api/messages', async (req, res) => {
  try {
    const { groupName, limit = 100, skip = 0, search } = req.query;
    const query = {};

    if (groupName) {
      query.groupName = new RegExp(groupName, 'i');
    }

    if (search) {
      query.$or = [
        { sender: new RegExp(search, 'i') },
        { message: new RegExp(search, 'i') },
        { groupName: new RegExp(search, 'i') },
      ];
    }

    const total = await WhatsAppMessage.countDocuments(query);
    const messages = await WhatsAppMessage.find(query)
      .sort({ timestamp: -1 })
      .skip(Number(skip))
      .limit(Math.min(Number(limit), 200));

    res.json({
      success: true,
      total,
      messages,
    });
  } catch (error) {
    console.error('Error fetching messages from MongoDB:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// List groups stored in MongoDB
app.get('/api/groups', async (req, res) => {
  try {
    const groups = await WhatsAppMessage.aggregate([
      {
        $group: {
          _id: '$groupName',
          count: { $sum: 1 },
          lastMessage: { $first: '$message' },
          lastTimestamp: { $first: '$timestamp' },
        },
      },
      { $sort: { lastTimestamp: -1 } },
    ]);

    res.json({
      success: true,
      groups: groups.map((g) => ({
        groupName: g._id,
        count: g.count,
        lastMessage: g.lastMessage,
        lastTimestamp: g.lastTimestamp,
      })),
    });
  } catch (error) {
    console.error('Error fetching groups from MongoDB:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete messages for a specific group
app.delete('/api/messages/:groupName', async (req, res) => {
  try {
    const { groupName } = req.params;
    const result = await WhatsAppMessage.deleteMany({
      groupName: new RegExp(`^${groupName}$`, 'i'),
    });
    res.json({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error('Error deleting group messages:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 WhatsApp Notification Server running on port ${PORT}`);
  console.log(`📡 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`📥 Ingest API: http://localhost:${PORT}/api/messages`);
});
