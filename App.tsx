import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  NativeModules,
  NativeEventEmitter,
  AppState,
  AppStateStatus,
  Share,
  Platform,
  Modal,
  KeyboardAvoidingView,
  Switch,
  ActivityIndicator,
} from 'react-native';

const { WhatsAppNotificationModule } = NativeModules;

export interface WhatsAppNotification {
  id: string;
  title: string;
  message: string;
  groupName?: string;
  matchedGroup?: string;
  isGroup: boolean;
  packageName: string;
  timestamp: number;
}

const eventEmitter = WhatsAppNotificationModule
  ? new NativeEventEmitter(WhatsAppNotificationModule)
  : null;

const DEFAULT_SERVER_URL = 'http://192.168.1.87:5000';

export default function App() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [notifications, setNotifications] = useState<WhatsAppNotification[]>([]);
  const [trackedGroups, setTrackedGroups] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Add Group Modal state
  const [isAddModalVisible, setIsAddModalVisible] = useState<boolean>(false);
  const [newGroupNameInput, setNewGroupNameInput] = useState<string>('');

  // MongoDB Configuration state
  const [isMongoModalVisible, setIsMongoModalVisible] = useState<boolean>(false);
  const [mongoServerUrl, setMongoServerUrl] = useState<string>(DEFAULT_SERVER_URL);
  const [mongoAutoSync, setMongoAutoSync] = useState<boolean>(true);
  const [mongoStatus, setMongoStatus] = useState<'connected' | 'disconnected' | 'checking' | 'idle'>('idle');
  const [isSyncingAll, setIsSyncingAll] = useState<boolean>(false);
  const [syncedMessageIds, setSyncedMessageIds] = useState<string[]>([]);

  // Check Android notification access permission
  const checkPermission = useCallback(async () => {
    if (Platform.OS !== 'android' || !WhatsAppNotificationModule) {
      setHasPermission(false);
      return;
    }
    try {
      const enabled = await WhatsAppNotificationModule.checkPermission();
      setHasPermission(Boolean(enabled));
    } catch (e) {
      console.error('Error checking permission:', e);
      setHasPermission(false);
    }
  }, []);

  // Fetch tracked groups
  const loadTrackedGroups = useCallback(async () => {
    if (!WhatsAppNotificationModule) return;
    try {
      const groups = await WhatsAppNotificationModule.getTrackedGroups();
      if (Array.isArray(groups)) {
        setTrackedGroups(groups);
      }
    } catch (e) {
      console.error('Error loading tracked groups:', e);
    }
  }, []);

  // Fetch historically saved notifications from native storage
  const loadStoredNotifications = useCallback(async () => {
    if (!WhatsAppNotificationModule) return;
    setIsRefreshing(true);
    try {
      const stored = await WhatsAppNotificationModule.getStoredNotifications();
      if (Array.isArray(stored)) {
        setNotifications(stored);
      }
    } catch (e) {
      console.error('Error loading stored notifications:', e);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Load MongoDB configuration
  const loadMongoDbConfig = useCallback(async () => {
    if (!WhatsAppNotificationModule) return;
    try {
      const config = await WhatsAppNotificationModule.getMongoDbConfig();
      if (config && config.serverUrl) {
        setMongoServerUrl(config.serverUrl);
      }
      if (config && typeof config.autoSync === 'boolean') {
        setMongoAutoSync(config.autoSync);
      }
    } catch (e) {
      console.error('Error loading MongoDB config:', e);
    }
  }, []);

  // Save MongoDB configuration
  const saveMongoDbConfig = async (url: string, autoSync: boolean) => {
    try {
      if (WhatsAppNotificationModule) {
        await WhatsAppNotificationModule.setMongoDbConfig(url, autoSync);
      }
    } catch (e) {
      console.error('Error saving MongoDB config:', e);
    }
  };

  // Test MongoDB Server connection
  const testMongoConnection = async (urlToTest?: string) => {
    const url = (urlToTest || mongoServerUrl).trim().replace(/\/+$/, '');
    if (!url) {
      Alert.alert('Missing URL', 'Please enter a valid MongoDB Server URL.');
      return;
    }

    if (url.startsWith('mongodb://') || url.startsWith('mongodb+srv://')) {
      setMongoStatus('disconnected');
      Alert.alert(
        'MongoDB Atlas URI Detected 💡',
        'Aapne database connection string (mongodb+srv://...) yahan daali hai.\n\nYeh connection string aapko apne computer ki "server/.env" file me paste karni hai.\n\nYahan app me backend API ka address (jaise http://192.168.1.87:5000 ya http://localhost:5000) daalna hota hai.'
      );
      return;
    }

    setMongoStatus('checking');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${url}/api/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data && data.status === 'ok') {
        setMongoStatus('connected');
      } else {
        setMongoStatus('disconnected');
      }
    } catch (err) {
      setMongoStatus('disconnected');
    }
  };

  // Upload messages to MongoDB backend API
  const syncMessagesToMongo = async (messagesToSync: WhatsAppNotification[]) => {
    if (!mongoServerUrl || messagesToSync.length === 0) return 0;
    const baseUrl = mongoServerUrl.trim().replace(/\/+$/, '');
    const endpoint = baseUrl.endsWith('/api/messages')
      ? baseUrl
      : `${baseUrl}/api/messages`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesToSync }),
      });
      const data = await res.json();
      if (data.success) {
        const newlySyncedIds = messagesToSync.map((m) => m.id);
        setSyncedMessageIds((prev) => Array.from(new Set([...prev, ...newlySyncedIds])));
        setMongoStatus('connected');
        return messagesToSync.length;
      }
    } catch (e) {
      console.error('Error syncing to MongoDB:', e);
    }
    return 0;
  };

  // Sync all stored messages
  const handleSyncAllToMongo = async () => {
    if (notifications.length === 0) {
      Alert.alert('No Messages', 'There are no messages captured yet to sync.');
      return;
    }
    setIsSyncingAll(true);
    const count = await syncMessagesToMongo(notifications);
    setIsSyncingAll(false);
    if (count > 0) {
      Alert.alert('Success', `Successfully synced ${count} messages to MongoDB!`);
    } else {
      Alert.alert(
        'Sync Failed',
        'Could not connect to MongoDB server. Make sure the server is running and the URL is reachable.'
      );
    }
  };

  // Open Android Settings directly to Notification Access
  const handleOpenSettings = async () => {
    if (!WhatsAppNotificationModule) return;
    try {
      await WhatsAppNotificationModule.openNotificationSettings();
    } catch (e) {
      Alert.alert('Error', 'Unable to open Notification Access settings.');
    }
  };

  // Add a new tracked group
  const handleAddGroupConfirm = async () => {
    const trimmed = newGroupNameInput.trim();
    if (!trimmed) {
      Alert.alert('Invalid Name', 'Please enter a valid WhatsApp group name.');
      return;
    }

    const alreadyExists = trackedGroups.some(
      (g) => g.toLowerCase() === trimmed.toLowerCase()
    );
    if (alreadyExists) {
      Alert.alert('Already Exists', `"${trimmed}" is already in your tracked groups list.`);
      return;
    }

    try {
      if (WhatsAppNotificationModule) {
        await WhatsAppNotificationModule.addTrackedGroup(trimmed);
      }
      setTrackedGroups((prev) => [...prev, trimmed]);
      setNewGroupNameInput('');
      setIsAddModalVisible(false);
    } catch (e) {
      Alert.alert('Error', 'Could not add group. Please try again.');
    }
  };

  // Delete / Untrack a group
  const handleRemoveGroup = (groupName: string) => {
    Alert.alert(
      'Remove Group',
      `Stop monitoring "${groupName}"? All saved messages for this group will also be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              if (WhatsAppNotificationModule) {
                await WhatsAppNotificationModule.removeTrackedGroup(groupName);
              }
              setTrackedGroups((prev) => prev.filter((g) => g !== groupName));
              setNotifications((prev) =>
                prev.filter(
                  (n) =>
                    (n.matchedGroup || n.groupName || '').toLowerCase() !==
                    groupName.toLowerCase()
                )
              );
              if (selectedGroup === groupName) {
                setSelectedGroup(null);
              }
            } catch (e) {
              Alert.alert('Error', 'Failed to remove group.');
            }
          },
        },
      ]
    );
  };

  // Clear messages for currently selected group
  const handleClearSelectedGroupMessages = (groupName: string) => {
    Alert.alert(
      'Clear Messages',
      `Delete all captured messages for "${groupName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              if (WhatsAppNotificationModule) {
                await WhatsAppNotificationModule.clearGroupNotifications(groupName);
              }
              setNotifications((prev) =>
                prev.filter(
                  (n) =>
                    (n.matchedGroup || n.groupName || '').toLowerCase() !==
                    groupName.toLowerCase()
                )
              );
            } catch (e) {
              Alert.alert('Error', 'Failed to clear group messages.');
            }
          },
        },
      ]
    );
  };

  // Simulate a test WhatsApp message
  const handleSimulateTestMessage = (targetGroupName?: string) => {
    const groupToUse =
      targetGroupName ||
      selectedGroup ||
      (trackedGroups.length > 0 ? trackedGroups[0] : 'Sample Group');

    const senders = ['Rahul Sharma', 'Priya Patel', 'Amit Verma', 'Neha Singh'];
    const sampleSender = senders[Math.floor(Math.random() * senders.length)];
    const messages = [
      'Hey everyone, are we meeting at 5 PM today?',
      'Please check the budget sheet I just shared in the drive.',
      'Happy birthday! Wishing you a fantastic year ahead! 🎂🎉',
      'Got the update. We will finalize this by tomorrow morning.',
    ];
    const sampleText = messages[Math.floor(Math.random() * messages.length)];

    const testItem: WhatsAppNotification = {
      id: `test_${Date.now()}`,
      title: `${sampleSender} @ ${groupToUse}`,
      message: `${sampleSender}: ${sampleText}`,
      groupName: groupToUse,
      matchedGroup: groupToUse,
      isGroup: true,
      packageName: 'com.whatsapp',
      timestamp: Date.now(),
    };

    setNotifications((prev) => [testItem, ...prev]);

    // If auto sync is on, also send test item to MongoDB
    if (mongoAutoSync) {
      syncMessagesToMongo([testItem]);
    }
  };

  // Share or copy message
  const handleShareMessage = async (item: WhatsAppNotification) => {
    try {
      const senderText = `[Group: ${item.matchedGroup || item.groupName || item.title}]`;
      const dateText = formatTimestamp(item.timestamp);
      await Share.share({
        message: `${senderText} (${dateText})\n${item.title}\n\n${item.message}`,
      });
    } catch (error) {
      console.error(error);
    }
  };

  // Format timestamp helper
  const formatTimestamp = (ts: number) => {
    if (!ts) return '';
    const date = new Date(ts);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const timeStr = date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    if (isToday) {
      return `Today at ${timeStr}`;
    }
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
  };

  useEffect(() => {
    checkPermission();
    loadTrackedGroups();
    loadStoredNotifications();
    loadMongoDbConfig();

    const appStateSub = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          checkPermission();
          loadTrackedGroups();
          loadStoredNotifications();
        }
      }
    );

    let notificationSub: any = null;
    if (eventEmitter) {
      notificationSub = eventEmitter.addListener(
        'onWhatsAppNotification',
        (event: any) => {
          const newNotification = event as WhatsAppNotification;
          setNotifications((prev) => {
            if (prev.some((n) => n.id === newNotification.id)) {
              return prev;
            }
            return [newNotification, ...prev];
          });

          // Also auto-sync in foreground JS if enabled
          if (mongoAutoSync) {
            syncMessagesToMongo([newNotification]);
          }
        }
      );
    }

    return () => {
      appStateSub.remove();
      if (notificationSub) {
        notificationSub.remove();
      }
    };
  }, [checkPermission, loadTrackedGroups, loadStoredNotifications, loadMongoDbConfig, mongoAutoSync]);

  // Messages grouped by tracked group
  const groupStats = useMemo(() => {
    const stats: Record<
      string,
      { count: number; lastMessage?: string; lastTimestamp?: number }
    > = {};

    trackedGroups.forEach((g) => {
      stats[g] = { count: 0 };
    });

    notifications.forEach((n) => {
      const groupKey = trackedGroups.find((g) => {
        const lowerG = g.toLowerCase();
        const matched = (n.matchedGroup || '').toLowerCase();
        const group = (n.groupName || '').toLowerCase();
        const title = (n.title || '').toLowerCase();
        return matched.includes(lowerG) || group.includes(lowerG) || title.includes(lowerG);
      });

      if (groupKey) {
        if (!stats[groupKey]) {
          stats[groupKey] = { count: 0 };
        }
        stats[groupKey].count += 1;
        if (!stats[groupKey].lastTimestamp || n.timestamp > (stats[groupKey].lastTimestamp || 0)) {
          stats[groupKey].lastTimestamp = n.timestamp;
          stats[groupKey].lastMessage = n.message;
        }
      }
    });

    return stats;
  }, [trackedGroups, notifications]);

  // Filtered group list for main screen
  const filteredTrackedGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return trackedGroups;
    return trackedGroups.filter((g) => g.toLowerCase().includes(q));
  }, [trackedGroups, searchQuery]);

  // Filtered messages for selected group
  const selectedGroupMessages = useMemo(() => {
    if (!selectedGroup) return [];
    const lowerSelected = selectedGroup.toLowerCase();
    const q = searchQuery.trim().toLowerCase();

    return notifications.filter((n) => {
      const matched = (n.matchedGroup || '').toLowerCase();
      const group = (n.groupName || '').toLowerCase();
      const title = (n.title || '').toLowerCase();

      const belongsToGroup =
        matched.includes(lowerSelected) ||
        group.includes(lowerSelected) ||
        title.includes(lowerSelected);

      if (!belongsToGroup) return false;

      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        n.message.toLowerCase().includes(q)
      );
    });
  }, [selectedGroup, notifications, searchQuery]);

  // Render a Group Item in the Groups List
  const renderGroupItem = ({ item }: { item: string }) => {
    const stat = groupStats[item] || { count: 0 };
    return (
      <TouchableOpacity
        style={styles.groupCard}
        activeOpacity={0.7}
        onPress={() => {
          setSelectedGroup(item);
          setSearchQuery('');
        }}
      >
        <View style={styles.groupAvatar}>
          <Text style={styles.groupAvatarText}>
            {item.charAt(0).toUpperCase()}
          </Text>
        </View>

        <View style={styles.groupInfo}>
          <View style={styles.groupTopRow}>
            <Text style={styles.groupNameText} numberOfLines={1}>
              {item}
            </Text>
            {stat.lastTimestamp ? (
              <Text style={styles.groupTimeText}>
                {formatTimestamp(stat.lastTimestamp)}
              </Text>
            ) : null}
          </View>

          <View style={styles.groupBottomRow}>
            <Text style={styles.groupSnippetText} numberOfLines={1}>
              {stat.lastMessage || 'Waiting for group messages...'}
            </Text>
            <View style={styles.groupBadge}>
              <Text style={styles.groupBadgeText}>
                {stat.count} {stat.count === 1 ? 'msg' : 'msgs'}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.groupDeleteBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => handleRemoveGroup(item)}
        >
          <Text style={styles.groupDeleteBtnText}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  // Render a Message Card in Selected Group View
  const renderMessageCard = ({ item }: { item: WhatsAppNotification }) => {
    const isSynced = syncedMessageIds.includes(item.id);
    return (
      <View style={styles.messageCard}>
        <View style={styles.messageCardHeader}>
          <View style={styles.messageSenderInfo}>
            <View style={styles.senderAvatar}>
              <Text style={styles.senderAvatarText}>
                {item.title ? item.title.charAt(0).toUpperCase() : 'W'}
              </Text>
            </View>
            <View>
              <Text style={styles.senderName} numberOfLines={1}>
                {item.title || 'Group Member'}
              </Text>
              <Text style={styles.messageTimestamp}>
                {formatTimestamp(item.timestamp)}
              </Text>
            </View>
          </View>

          {/* Sync Badge */}
          <View
            style={[
              styles.syncBadge,
              isSynced ? styles.syncBadgeDone : styles.syncBadgePending,
            ]}
          >
            <Text
              style={[
                styles.syncBadgeText,
                isSynced ? styles.syncBadgeTextDone : styles.syncBadgeTextPending,
              ]}
            >
              {isSynced ? 'Synced ☁️' : 'Local 📱'}
            </Text>
          </View>
        </View>

        <Text style={styles.messageText}>{item.message}</Text>

        <View style={styles.messageFooter}>
          <View style={styles.packageTag}>
            <Text style={styles.packageTagText}>
              {item.packageName === 'com.whatsapp.w4b' ? 'WA Business' : 'WhatsApp'}
            </Text>
          </View>

          <View style={styles.cardActionsRow}>
            {!isSynced && (
              <TouchableOpacity
                style={styles.manualSyncBtn}
                onPress={() => syncMessagesToMongo([item])}
              >
                <Text style={styles.manualSyncBtnText}>Save to Mongo 🗄️</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.shareBtn}
              onPress={() => handleShareMessage(item)}
            >
              <Text style={styles.shareBtnText}>Share / Copy</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Main Header */}
      <View style={styles.header}>
        {selectedGroup ? (
          <View style={styles.headerBackContainer}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                setSelectedGroup(null);
                setSearchQuery('');
              }}
            >
              <Text style={styles.backButtonText}>‹ Back</Text>
            </TouchableOpacity>
            <View style={styles.headerGroupDetail}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {selectedGroup}
              </Text>
              <Text style={styles.headerSubtitle}>
                {selectedGroupMessages.length} captured messages
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.headerMainContainer}>
            <View>
              <Text style={styles.headerTitle}>WhatsApp Groups</Text>
              <Text style={styles.headerSubtitle}>
                Saving group notifications to MongoDB
              </Text>
            </View>

            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.mongoHeaderBtn}
                onPress={() => setIsMongoModalVisible(true)}
              >
                <View
                  style={[
                    styles.statusIndicatorDot,
                    mongoStatus === 'connected'
                      ? styles.dotConnected
                      : styles.dotDisconnected,
                  ]}
                />
                <Text style={styles.mongoHeaderBtnText}>MongoDB</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.addGroupButton}
                onPress={() => {
                  setNewGroupNameInput('');
                  setIsAddModalVisible(true);
                }}
              >
                <Text style={styles.addGroupButtonText}>+ Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Permission Warning Banner */}
      {hasPermission === false && (
        <View style={styles.permissionWarningBanner}>
          <View style={styles.warningInfo}>
            <Text style={styles.warningTitle}>⚠️ Notification Access Required</Text>
            <Text style={styles.warningSubtitle}>
              Enable notification access so the app can read your WhatsApp notifications.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.grantPermissionBtn}
            onPress={handleOpenSettings}
          >
            <Text style={styles.grantPermissionBtnText}>Grant Access</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Search Bar */}
      <View style={styles.searchSection}>
        <TextInput
          style={styles.searchInput}
          placeholder={
            selectedGroup
              ? `🔍 Search messages in "${selectedGroup}"...`
              : '🔍 Search added groups...'
          }
          placeholderTextColor="#8E8E93"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* VIEW 1: Groups List View */}
      {!selectedGroup && (
        <View style={styles.contentFlex}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>
              Monitored Groups ({trackedGroups.length})
            </Text>
            {trackedGroups.length > 0 && (
              <TouchableOpacity
                onPress={() => handleSimulateTestMessage()}
                style={styles.testBtnHeader}
              >
                <Text style={styles.testBtnHeaderText}>+ Test Message</Text>
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={filteredTrackedGroups}
            keyExtractor={(item) => item}
            renderItem={renderGroupItem}
            contentContainerStyle={styles.listContent}
            refreshing={isRefreshing}
            onRefresh={() => {
              loadTrackedGroups();
              loadStoredNotifications();
            }}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyIcon}>👥</Text>
                <Text style={styles.emptyTitle}>No Groups Added Yet</Text>
                <Text style={styles.emptyDescription}>
                  Tap "+ Add Group" to specify WhatsApp group names. The app will only
                  read and save messages from those groups.
                </Text>
                <TouchableOpacity
                  style={styles.emptyAddBtn}
                  onPress={() => setIsAddModalVisible(true)}
                >
                  <Text style={styles.emptyAddBtnText}>+ Add First Group</Text>
                </TouchableOpacity>
              </View>
            }
          />
        </View>
      )}

      {/* VIEW 2: Selected Group Messages View */}
      {selectedGroup && (
        <View style={styles.contentFlex}>
          <View style={styles.groupMessageActionBar}>
            <TouchableOpacity
              style={styles.groupActionBtn}
              onPress={() => handleSimulateTestMessage(selectedGroup)}
            >
              <Text style={styles.groupActionBtnText}>+ Send Test Msg</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.syncGroupBtn}
              onPress={() => syncMessagesToMongo(selectedGroupMessages)}
            >
              <Text style={styles.syncGroupBtnText}>Sync to MongoDB ☁️</Text>
            </TouchableOpacity>

            {selectedGroupMessages.length > 0 && (
              <TouchableOpacity
                style={styles.clearGroupBtn}
                onPress={() => handleClearSelectedGroupMessages(selectedGroup)}
              >
                <Text style={styles.clearGroupBtnText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={selectedGroupMessages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessageCard}
            contentContainerStyle={styles.listContent}
            refreshing={isRefreshing}
            onRefresh={loadStoredNotifications}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyIcon}>💬</Text>
                <Text style={styles.emptyTitle}>No Messages Yet</Text>
                <Text style={styles.emptyDescription}>
                  When someone posts in "{selectedGroup}" on WhatsApp, the message will
                  appear here and sync to MongoDB.
                </Text>
                <TouchableOpacity
                  style={styles.emptyAddBtn}
                  onPress={() => handleSimulateTestMessage(selectedGroup)}
                >
                  <Text style={styles.emptyAddBtnText}>Simulate Test Message</Text>
                </TouchableOpacity>
              </View>
            }
          />
        </View>
      )}

      {/* Modal 1: Add Group */}
      <Modal
        visible={isAddModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsAddModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add WhatsApp Group</Text>
            <Text style={styles.modalSubtitle}>
              Enter the exact or partial name of the WhatsApp group you want to
              monitor. Only notifications from this group will be saved.
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="e.g. College Friends, Family Group"
              placeholderTextColor="#9CA3AF"
              value={newGroupNameInput}
              onChangeText={setNewGroupNameInput}
              autoFocus
            />

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setIsAddModalVisible(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleAddGroupConfirm}
              >
                <Text style={styles.modalSaveBtnText}>Add Group</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal 2: MongoDB Configuration */}
      <Modal
        visible={isMongoModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsMongoModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>MongoDB Configuration 🗄️</Text>
            <Text style={styles.modalSubtitle}>
              Configure your backend API server URL to save WhatsApp messages directly to MongoDB.
            </Text>

            <Text style={styles.inputLabel}>Backend Server URL:</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="http://192.168.1.87:5000"
              placeholderTextColor="#9CA3AF"
              value={mongoServerUrl}
              onChangeText={setMongoServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.testConnectionRow}>
              <TouchableOpacity
                style={styles.testConnectionBtn}
                onPress={() => testMongoConnection(mongoServerUrl)}
              >
                {mongoStatus === 'checking' ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.testConnectionBtnText}>Test Connection</Text>
                )}
              </TouchableOpacity>

              <View style={styles.connectionStatusContainer}>
                {mongoStatus === 'connected' && (
                  <Text style={styles.statusConnectedText}>🟢 Connected to API</Text>
                )}
                {mongoStatus === 'disconnected' && (
                  <Text style={styles.statusDisconnectedText}>🔴 Unreachable</Text>
                )}
                {mongoStatus === 'idle' && (
                  <Text style={styles.statusIdleText}>⚪ Not tested</Text>
                )}
              </View>
            </View>

            {/* Auto-Sync Toggle */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleTitle}>Auto-Sync to MongoDB</Text>
                <Text style={styles.toggleSubtitle}>
                  Save incoming messages immediately in background
                </Text>
              </View>
              <Switch
                value={mongoAutoSync}
                onValueChange={(val) => {
                  setMongoAutoSync(val);
                  saveMongoDbConfig(mongoServerUrl, val);
                }}
                trackColor={{ false: '#D1D5DB', true: '#A7F3D0' }}
                thumbColor={mongoAutoSync ? '#059669' : '#9CA3AF'}
              />
            </View>

            {/* Batch Sync Button */}
            <TouchableOpacity
              style={styles.syncAllButton}
              disabled={isSyncingAll}
              onPress={handleSyncAllToMongo}
            >
              {isSyncingAll ? (
                <ActivityIndicator size="small" color="#075E54" />
              ) : (
                <Text style={styles.syncAllButtonText}>
                  ☁️ Sync All Stored Messages ({notifications.length})
                </Text>
              )}
            </TouchableOpacity>

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={() => {
                  saveMongoDbConfig(mongoServerUrl, mongoAutoSync);
                  setIsMongoModalVisible(false);
                }}
              >
                <Text style={styles.modalSaveBtnText}>Done & Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F2F5',
  },
  contentFlex: {
    flex: 1,
  },
  header: {
    backgroundColor: '#075E54',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 14 : 10,
    paddingBottom: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  headerMainContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  headerBackContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    paddingRight: 14,
    paddingVertical: 4,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  headerGroupDetail: {
    flex: 1,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: '#E0F2F1',
    fontSize: 12,
    marginTop: 2,
  },
  mongoHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
  },
  statusIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  dotConnected: {
    backgroundColor: '#25D366',
  },
  dotDisconnected: {
    backgroundColor: '#EF4444',
  },
  mongoHeaderBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  addGroupButton: {
    backgroundColor: '#25D366',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
  },
  addGroupButtonText: {
    color: '#075E54',
    fontSize: 12,
    fontWeight: '700',
  },
  permissionWarningBanner: {
    backgroundColor: '#FEF3C7',
    borderBottomWidth: 1,
    borderBottomColor: '#FDE68A',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  warningInfo: {
    flex: 1,
    marginRight: 10,
  },
  warningTitle: {
    color: '#92400E',
    fontWeight: '700',
    fontSize: 13,
  },
  warningSubtitle: {
    color: '#78350F',
    fontSize: 11,
    marginTop: 2,
  },
  grantPermissionBtn: {
    backgroundColor: '#D97706',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  grantPermissionBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  searchSection: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  searchInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14,
    color: '#1F2937',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4B5563',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  testBtnHeader: {
    backgroundColor: '#E0F2F1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  testBtnHeaderText: {
    fontSize: 11,
    color: '#00796B',
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 24,
  },
  groupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  groupAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#128C7E',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  groupAvatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  groupInfo: {
    flex: 1,
    marginRight: 10,
  },
  groupTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  groupNameText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    flex: 1,
    marginRight: 8,
  },
  groupTimeText: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  groupBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  groupSnippetText: {
    fontSize: 13,
    color: '#6B7280',
    flex: 1,
    marginRight: 8,
  },
  groupBadge: {
    backgroundColor: '#E0F2F1',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  groupBadgeText: {
    fontSize: 11,
    color: '#00796B',
    fontWeight: '700',
  },
  groupDeleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupDeleteBtnText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: 'bold',
  },
  groupMessageActionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  groupActionBtn: {
    backgroundColor: '#25D366',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  groupActionBtnText: {
    color: '#075E54',
    fontSize: 11,
    fontWeight: '700',
  },
  syncGroupBtn: {
    backgroundColor: '#E0F2F1',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  syncGroupBtnText: {
    color: '#00796B',
    fontSize: 11,
    fontWeight: '700',
  },
  clearGroupBtn: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  clearGroupBtnText: {
    color: '#DC2626',
    fontSize: 11,
    fontWeight: '600',
  },
  messageCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  messageCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  messageSenderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  senderAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#075E54',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  senderAvatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  senderName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  messageTimestamp: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 1,
  },
  syncBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  syncBadgeDone: {
    backgroundColor: '#D1FAE5',
  },
  syncBadgePending: {
    backgroundColor: '#F3F4F6',
  },
  syncBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  syncBadgeTextDone: {
    color: '#065F46',
  },
  syncBadgeTextPending: {
    color: '#6B7280',
  },
  messageText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
    marginTop: 10,
    marginBottom: 10,
  },
  messageFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 8,
  },
  packageTag: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  packageTagText: {
    color: '#2E7D32',
    fontSize: 10,
    fontWeight: '600',
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  manualSyncBtn: {
    backgroundColor: '#E0F2F1',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  manualSyncBtnText: {
    color: '#00796B',
    fontSize: 11,
    fontWeight: '700',
  },
  shareBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  shareBtnText: {
    color: '#128C7E',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    fontSize: 50,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 6,
  },
  emptyDescription: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  emptyAddBtn: {
    backgroundColor: '#075E54',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  emptyAddBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 17,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 6,
  },
  modalInput: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: '#111827',
    marginBottom: 12,
  },
  testConnectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  testConnectionBtn: {
    backgroundColor: '#075E54',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  testConnectionBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  connectionStatusContainer: {
    flex: 1,
    alignItems: 'flex-end',
  },
  statusConnectedText: {
    color: '#059669',
    fontSize: 12,
    fontWeight: '700',
  },
  statusDisconnectedText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '700',
  },
  statusIdleText: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    marginBottom: 14,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 10,
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  toggleSubtitle: {
    fontSize: 11,
    color: '#6B7280',
  },
  syncAllButton: {
    backgroundColor: '#E0F2F1',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  syncAllButtonText: {
    color: '#00796B',
    fontSize: 13,
    fontWeight: '700',
  },
  modalButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalCancelBtnText: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '600',
  },
  modalSaveBtn: {
    backgroundColor: '#075E54',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalSaveBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
