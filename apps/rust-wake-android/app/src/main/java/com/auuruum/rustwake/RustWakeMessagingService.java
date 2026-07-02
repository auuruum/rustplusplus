package com.auuruum.rustwake;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import android.content.SharedPreferences;
import java.util.Map;

public class RustWakeMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) {
        getSharedPreferences("rustwake", MODE_PRIVATE).edit().putString("fcmToken", token).apply();
    }

    @Override public void onMessageReceived(RemoteMessage msg) {
        Alert a = new Alert();
        if (msg.getNotification() != null) {
            String title = msg.getNotification().getTitle();
            String body = msg.getNotification().getBody();
            if (title != null && !title.isEmpty()) a.title = title;
            if (body != null && !body.isEmpty()) a.trigger = body;
        }
        Map<String, String> d = msg.getData();
        if (d != null) {
            put(d.get("id"), v -> a.id = v);
            put(d.get("title"), v -> a.title = v);
            put(d.get("base"), v -> a.base = v);
            put(d.get("grid"), v -> a.grid = v);
            put(d.get("server"), v -> a.server = v);
            put(d.get("trigger"), v -> a.trigger = v);
            put(d.get("type"), v -> a.trigger = v);
        }
        Notifier.trigger(this, a);
    }

    interface Setter { void set(String value); }
    static void put(String value, Setter setter) { if (value != null && !value.trim().isEmpty()) setter.set(value.trim()); }
}
