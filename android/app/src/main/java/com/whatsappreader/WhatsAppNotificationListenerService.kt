package com.whatsappreader

import android.app.Notification
import android.content.Context
import android.content.SharedPreferences
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.facebook.react.bridge.Arguments
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL

class WhatsAppNotificationListenerService : NotificationListenerService() {

    companion object {
        private const val TAG = "WhatsAppListener"
        private const val PREFS_NAME = "WhatsAppNotificationPrefs"
        private const val KEY_NOTIFICATIONS = "stored_notifications"
        private const val KEY_TRACKED_GROUPS = "tracked_groups"
        private const val KEY_MONGO_SERVER_URL = "mongodb_server_url"
        private const val KEY_MONGO_AUTO_SYNC = "mongodb_auto_sync"
        private const val MAX_STORED = 300

        // WhatsApp package names
        private val WHATSAPP_PACKAGES = setOf(
            "com.whatsapp",
            "com.whatsapp.w4b" // WhatsApp Business
        )

        // System messages or sync messages to ignore
        private val IGNORED_PHRASES = listOf(
            "checking for new messages",
            "whatsapp web is currently active",
            "backup in progress",
            "backing up messages",
            "calling...",
            "incoming voice call",
            "ongoing voice call",
            "missed voice call"
        )

        fun getTrackedGroups(context: Context): List<String> {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val jsonString = prefs.getString(KEY_TRACKED_GROUPS, "[]") ?: "[]"
            val list = mutableListOf<String>()
            try {
                val array = JSONArray(jsonString)
                for (i in 0 until array.length()) {
                    val g = array.getString(i).trim()
                    if (g.isNotEmpty() && !list.contains(g)) {
                        list.add(g)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error reading tracked groups", e)
            }
            return list
        }

        fun addTrackedGroup(context: Context, groupName: String): Boolean {
            val trimmed = groupName.trim()
            if (trimmed.isEmpty()) return false
            synchronized(this) {
                val current = getTrackedGroups(context).toMutableList()
                val alreadyExists = current.any { it.equals(trimmed, ignoreCase = true) }
                if (!alreadyExists) {
                    current.add(trimmed)
                    val array = JSONArray()
                    current.forEach { array.put(it) }
                    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    prefs.edit().putString(KEY_TRACKED_GROUPS, array.toString()).apply()
                    return true
                }
            }
            return false
        }

        fun removeTrackedGroup(context: Context, groupName: String): Boolean {
            val trimmed = groupName.trim()
            synchronized(this) {
                val current = getTrackedGroups(context).toMutableList()
                val removed = current.removeAll { it.equals(trimmed, ignoreCase = true) }
                if (removed) {
                    val array = JSONArray()
                    current.forEach { array.put(it) }
                    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    prefs.edit().putString(KEY_TRACKED_GROUPS, array.toString()).apply()
                    clearTrackedGroupMessages(context, trimmed)
                    return true
                }
            }
            return false
        }

        fun clearTrackedGroupMessages(context: Context, groupName: String) {
            val trimmed = groupName.trim().lowercase()
            synchronized(this) {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val jsonString = prefs.getString(KEY_NOTIFICATIONS, "[]") ?: "[]"
                try {
                    val array = JSONArray(jsonString)
                    val newArray = JSONArray()
                    for (i in 0 until array.length()) {
                        val item = array.getJSONObject(i)
                        val matched = item.optString("matchedGroup", "").lowercase()
                        val group = item.optString("groupName", "").lowercase()
                        if (matched != trimmed && group != trimmed) {
                            newArray.put(item)
                        }
                    }
                    prefs.edit().putString(KEY_NOTIFICATIONS, newArray.toString()).apply()
                } catch (e: Exception) {
                    Log.e(TAG, "Error clearing group messages", e)
                }
            }
        }

        fun getStoredNotifications(context: Context): List<JSONObject> {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val jsonString = prefs.getString(KEY_NOTIFICATIONS, "[]") ?: "[]"
            val list = mutableListOf<JSONObject>()
            try {
                val array = JSONArray(jsonString)
                for (i in 0 until array.length()) {
                    list.add(array.getJSONObject(i))
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error reading notifications from storage", e)
            }
            return list
        }

        fun clearStoredNotifications(context: Context) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString(KEY_NOTIFICATIONS, "[]").apply()
        }

        fun saveNotification(context: Context, item: JSONObject) {
            synchronized(this) {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val jsonString = prefs.getString(KEY_NOTIFICATIONS, "[]") ?: "[]"
                try {
                    val array = JSONArray(jsonString)
                    val newArray = JSONArray()
                    newArray.put(item)
                    for (i in 0 until minOf(array.length(), MAX_STORED - 1)) {
                        newArray.put(array.get(i))
                    }
                    prefs.edit().putString(KEY_NOTIFICATIONS, newArray.toString()).apply()
                } catch (e: Exception) {
                    Log.e(TAG, "Error saving notification", e)
                }
            }
        }

        fun setMongoDbConfig(context: Context, serverUrl: String, autoSync: Boolean) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putString(KEY_MONGO_SERVER_URL, serverUrl.trim())
                .putBoolean(KEY_MONGO_AUTO_SYNC, autoSync)
                .apply()
        }

        fun getMongoDbConfig(context: Context): Pair<String, Boolean> {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val url = prefs.getString(KEY_MONGO_SERVER_URL, "") ?: ""
            val autoSync = prefs.getBoolean(KEY_MONGO_AUTO_SYNC, true)
            return Pair(url, autoSync)
        }

        fun sendToMongoDbAsync(context: Context, jsonItem: JSONObject) {
            val (serverUrl, autoSync) = getMongoDbConfig(context)
            if (!autoSync || serverUrl.isBlank()) {
                return
            }

            Thread {
                var conn: HttpURLConnection? = null
                try {
                    var sanitizedUrl = serverUrl.trim()
                    if (sanitizedUrl.startsWith("http://") && sanitizedUrl.contains(".onrender.com")) {
                        sanitizedUrl = sanitizedUrl.replace("http://", "https://")
                    }
                    val base = sanitizedUrl.trimEnd('/')
                    val endpoint = if (base.endsWith("/api/messages")) base else "$base/api/messages"
                    val url = URL(endpoint)
                    conn = url.openConnection() as HttpURLConnection
                    conn.requestMethod = "POST"
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    conn.setRequestProperty("Accept", "application/json")
                    conn.doOutput = true
                    conn.connectTimeout = 8000
                    conn.readTimeout = 8000

                    val outputStream: OutputStream = conn.outputStream
                    val bytes = jsonItem.toString().toByteArray(Charsets.UTF_8)
                    outputStream.write(bytes, 0, bytes.size)
                    outputStream.flush()
                    outputStream.close()

                    val code = conn.responseCode
                    Log.d(TAG, "MongoDB Background Sync HTTP Response: $code to $endpoint")
                    if (code in 200..299) {
                        val responseText = conn.inputStream.bufferedReader().use { it.readText() }
                        Log.d(TAG, "Sync Response: $responseText")
                    } else {
                        val errorText = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: "No error body"
                        Log.e(TAG, "Sync Error Body: $errorText")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "MongoDB Background Sync Error: ${e.message}")
                } finally {
                    conn?.disconnect()
                }
            }.start()
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.i(TAG, "WhatsApp Notification Listener connected successfully.")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        Log.i(TAG, "WhatsApp Notification Listener disconnected.")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return

        val packageName = sbn.packageName ?: return

        // 1. Strict filter: Only process WhatsApp or WhatsApp Business notifications
        if (!WHATSAPP_PACKAGES.contains(packageName)) {
            return
        }

        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        val isOngoing = (notification.flags and Notification.FLAG_ONGOING_EVENT) != 0

        // 2. Extract notification fields
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim() ?: ""
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim() ?: ""
        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()?.trim() ?: ""
        val conversationTitle = extras.getCharSequence("android.conversationTitle")?.toString()?.trim() ?: ""

        val message = if (bigText.isNotEmpty()) bigText else text

        if (title.isEmpty() && message.isEmpty()) {
            return
        }

        // 3. Filter out system / internal sync messages
        val lowerMessage = message.lowercase()
        val lowerTitle = title.lowercase()
        if (isOngoing || IGNORED_PHRASES.any { lowerMessage.contains(it) || lowerTitle.contains(it) }) {
            return
        }

        val groupName = if (conversationTitle.isNotEmpty()) conversationTitle else subText

        // 4. Strict Group Filtering:
        // Only read and save notifications from groups configured by the user
        val trackedGroups = getTrackedGroups(applicationContext)
        if (trackedGroups.isEmpty()) {
            Log.d(TAG, "No groups tracked yet. Ignoring notification: Title='$title'")
            return
        }

        val lowerGroupName = groupName.lowercase()
        val lowerConversation = conversationTitle.lowercase()
        val lowerSub = subText.lowercase()

        val matchedTrackedGroup = trackedGroups.firstOrNull { tracked ->
            val t = tracked.lowercase()
            lowerGroupName.contains(t) ||
            lowerConversation.contains(t) ||
            lowerSub.contains(t) ||
            lowerTitle.contains(t)
        }

        if (matchedTrackedGroup == null) {
            Log.d(TAG, "Ignoring notification: Not matching any tracked group (Title='$title', Group='$groupName')")
            return
        }

        val id = "${sbn.id}_${sbn.postTime}_${title.hashCode()}"
        val timestamp = sbn.postTime
        val resolvedGroupName = if (groupName.isNotEmpty()) groupName else matchedTrackedGroup

        Log.d(TAG, "Captured WhatsApp Group Notification for '$matchedTrackedGroup': Title='$title', Message='$message'")

        // 5. Save to persistent storage
        val jsonItem = JSONObject().apply {
            put("id", id)
            put("title", title)
            put("message", message)
            put("groupName", resolvedGroupName)
            put("matchedGroup", matchedTrackedGroup)
            put("isGroup", true)
            put("packageName", packageName)
            put("timestamp", timestamp)
        }
        saveNotification(applicationContext, jsonItem)

        // 6. Background Sync to MongoDB
        sendToMongoDbAsync(applicationContext, jsonItem)

        // 7. Emit real-time event to React Native JS if active
        val writableMap = Arguments.createMap().apply {
            putString("id", id)
            putString("title", title)
            putString("message", message)
            putString("groupName", resolvedGroupName)
            putString("matchedGroup", matchedTrackedGroup)
            putBoolean("isGroup", true)
            putString("packageName", packageName)
            putDouble("timestamp", timestamp.toDouble())
        }
        WhatsAppNotificationModule.emitEvent("onWhatsAppNotification", writableMap)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // Optional
    }
}
