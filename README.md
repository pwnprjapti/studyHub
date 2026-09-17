# WhatsApp Notification Reader (React Native Android)

A React Native Android application that **exclusively captures, logs, and displays WhatsApp message notifications** in real time.

---

## Features

- **Strict WhatsApp Filter**: Ignores all non-WhatsApp apps at the native Android OS level (`com.whatsapp` and `com.whatsapp.w4b` for WhatsApp Business).
- **System Sync Noise Filtering**: Automatically discards internal WhatsApp status updates like *"Checking for new messages"*, ongoing calls, and backup status.
- **Offline & Closed-App Capture**: Runs via Android's native `NotificationListenerService` and persists incoming messages to `SharedPreferences`, so you never miss a message even if the React Native app is closed or killed.
- **Real-Time Bridge**: Broadcasts intercepted notifications immediately to the React Native UI when the app is open.
- **Direct & Group Chat Detection**: Automatically identifies whether a notification is from an individual contact or a group chat.
- **Modern WhatsApp-Themed UI**:
  - Notification access permission banner with 1-tap deep link to phone settings.
  - Search bar to filter messages by contact, group, or keyword.
  - Tabs: **All**, **Direct**, and **Groups**.
  - 1-tap **Share / Copy** message text.
  - Mock test generator to test the UI immediately.
  - Clear history with confirmation dialog.

---

## How It Works

1. **Android Permission**: Android requires third-party apps to be granted **Notification Access** by the user in `Settings > Device & app notifications`.
2. **`WhatsAppNotificationListenerService`**:
   - Registered in `AndroidManifest.xml` with `android.permission.BIND_NOTIFICATION_LISTENER_SERVICE`.
   - Listens to system-wide notifications via `onNotificationPosted`.
   - Checks `sbn.packageName` against `com.whatsapp` and `com.whatsapp.w4b`.
   - Extracts sender title, message body, group title, and post timestamp.
   - Saves to local storage and emits `onWhatsAppNotification` event to the JS layer.
3. **`WhatsAppNotificationModule`**:
   - Exposes permission check, settings launcher, and stored message queries to React Native.

---

## Running & Installing the App

### Option 1: Direct APK Install on Your Phone (Quickest)
The debug APK has already been compiled:
```
android/app/build/outputs/apk/debug/app-debug.apk
```
1. Connect your Android phone via USB (with **USB Debugging** enabled) or transfer `app-debug.apk` directly to your phone.
2. If connected via ADB, run:
   ```bash
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```

### Option 2: Run via React Native CLI
1. Start Metro:
   ```bash
   npm start
   ```
2. In a separate terminal, deploy to your phone/emulator:
   ```bash
   npm run android
   ```

---

## Initial Setup on Your Phone

1. Launch **WhatsApp Notif Reader** on your phone.
2. A yellow warning banner will appear: **"Notification Access Required"**.
3. Tap **"Grant Access"** — this will open your phone's Android **Device & app notifications** settings screen.
4. Locate **WhatsApp Notification Reader** and toggle it **ON**.
5. Return to the app. The banner will change to a green indicator: **"Service Active: Monitoring incoming WhatsApp notifications"**.
6. When anyone sends you a message on WhatsApp, it will instantly show up in the app!

---

## Backend Server & StudyHub Kids Web Dashboard

The project includes a full Node.js / Express / MongoDB Atlas backend and a kid-friendly Web Dashboard that turns school WhatsApp group chats into homework feeds.

### 1. Setup Environment
In `server/`, create `.env` from `.env.example`:
```bash
cp server/.env.example server/.env
```
Configure your MongoDB connection string in `server/.env`:
```env
PORT=5000
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/whatsapp_group?retryWrites=true&w=majority
```

### 2. Run the Server
```bash
cd server
npm install
npm start
```

### 3. Access Dashboard
Open **`http://localhost:5000`** in your browser:
- **Deduplicated Study Groups**: Shows each school study group once with message counters.
- **WhatsApp Chat View**: Click any group to open the full conversation stream with timestamps.
- **Kids-Friendly Tools**: 🔊 "Read to Me" text-to-speech, ⭐ Star notes, 🖨️ Print homework sheet, and automatic keyword highlighting.
