package com.whatsappreader

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class WhatsAppNotificationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "WhatsAppNotificationModule"
        private const val TAG = "WhatsAppNotificationMod"

        private var reactAppContext: ReactApplicationContext? = null

        fun emitEvent(eventName: String, params: WritableMap) {
            try {
                reactAppContext?.let { context ->
                    if (context.hasActiveReactInstance()) {
                        context
                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                            .emit(eventName, params)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error emitting event $eventName", e)
            }
        }
    }

    init {
        reactAppContext = reactContext
    }

    override fun getName(): String {
        return NAME
    }

    @ReactMethod
    fun checkPermission(promise: Promise) {
        try {
            val pkgName = reactApplicationContext.packageName
            val enabledPackages = NotificationManagerCompat.getEnabledListenerPackages(reactApplicationContext)
            var isEnabled = enabledPackages.contains(pkgName)

            if (!isEnabled) {
                val flat = Settings.Secure.getString(
                    reactApplicationContext.contentResolver,
                    "enabled_notification_listeners"
                )
                if (!flat.isNullOrEmpty()) {
                    val names = flat.split(":")
                    for (name in names) {
                        val cn = ComponentName.unflattenFromString(name)
                        if (cn != null && cn.packageName == pkgName) {
                            isEnabled = true
                            break
                        }
                    }
                }
            }

            promise.resolve(isEnabled)
        } catch (e: Exception) {
            promise.reject("PERMISSION_CHECK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun openNotificationSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("OPEN_SETTINGS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getTrackedGroups(promise: Promise) {
        try {
            val groups = WhatsAppNotificationListenerService.getTrackedGroups(reactApplicationContext)
            val array: WritableArray = Arguments.createArray()
            for (g in groups) {
                array.pushString(g)
            }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.reject("GET_TRACKED_GROUPS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addTrackedGroup(groupName: String, promise: Promise) {
        try {
            val success = WhatsAppNotificationListenerService.addTrackedGroup(reactApplicationContext, groupName)
            promise.resolve(success)
        } catch (e: Exception) {
            promise.reject("ADD_TRACKED_GROUP_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun removeTrackedGroup(groupName: String, promise: Promise) {
        try {
            val success = WhatsAppNotificationListenerService.removeTrackedGroup(reactApplicationContext, groupName)
            promise.resolve(success)
        } catch (e: Exception) {
            promise.reject("REMOVE_TRACKED_GROUP_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun clearGroupNotifications(groupName: String, promise: Promise) {
        try {
            WhatsAppNotificationListenerService.clearTrackedGroupMessages(reactApplicationContext, groupName)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CLEAR_GROUP_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setMongoDbConfig(serverUrl: String, autoSync: Boolean, promise: Promise) {
        try {
            WhatsAppNotificationListenerService.setMongoDbConfig(reactApplicationContext, serverUrl, autoSync)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SET_MONGODB_CONFIG_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getMongoDbConfig(promise: Promise) {
        try {
            val (url, autoSync) = WhatsAppNotificationListenerService.getMongoDbConfig(reactApplicationContext)
            val map: WritableMap = Arguments.createMap().apply {
                putString("serverUrl", url)
                putBoolean("autoSync", autoSync)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("GET_MONGODB_CONFIG_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getStoredNotifications(promise: Promise) {
        try {
            val storedList = WhatsAppNotificationListenerService.getStoredNotifications(reactApplicationContext)
            val writableArray: WritableArray = Arguments.createArray()

            for (item in storedList) {
                val map: WritableMap = Arguments.createMap().apply {
                    putString("id", item.optString("id"))
                    putString("title", item.optString("title"))
                    putString("message", item.optString("message"))
                    putString("groupName", item.optString("groupName"))
                    putString("matchedGroup", item.optString("matchedGroup"))
                    putBoolean("isGroup", item.optBoolean("isGroup", true))
                    putString("packageName", item.optString("packageName"))
                    putDouble("timestamp", item.optLong("timestamp").toDouble())
                }
                writableArray.pushMap(map)
            }

            promise.resolve(writableArray)
        } catch (e: Exception) {
            promise.reject("GET_NOTIFICATIONS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun clearStoredNotifications(promise: Promise) {
        try {
            WhatsAppNotificationListenerService.clearStoredNotifications(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CLEAR_NOTIFICATIONS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addListener(eventName: String?) {
        // Keep for NativeEventEmitter support
    }

    @ReactMethod
    fun removeListeners(count: Int?) {
        // Keep for NativeEventEmitter support
    }
}
