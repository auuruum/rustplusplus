package com.auuruum.rustwake;

import android.app.*;
import android.content.*;
import android.os.*;
import org.json.JSONObject;
import java.io.*;
import java.net.*;

public class PollService extends Service {
    volatile boolean running = false;
    Thread worker;
    SharedPreferences prefs;

    @Override public void onCreate() { super.onCreate(); prefs = getSharedPreferences("rustwake", MODE_PRIVATE); Notifier.ensureChannel(this); }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        prefs.edit().putBoolean("watch", true).apply();
        startForeground(71436, serviceNotification("Watching for Rust wake alerts"));
        if (!running) startWorker();
        return START_STICKY;
    }

    void startWorker() {
        running = true;
        worker = new Thread(() -> {
            while (running && prefs.getBoolean("watch", true)) {
                String url = prefs.getString("endpoint", "").trim();
                try {
                    if (isNtfyUrl(url)) listenNtfy(normalizeNtfyUrl(url));
                    else pollOnce(url);
                } catch(Exception ignored) {}
                try { Thread.sleep(isNtfyUrl(url) ? 2000 : 15000); } catch(InterruptedException ignored) {}
            }
            stopSelf();
        }, "bebra-poll");
        worker.start();
    }

    boolean isNtfyUrl(String url) {
        return url.startsWith("https://ntfy.sh/") || url.startsWith("http://ntfy.sh/");
    }

    String normalizeNtfyUrl(String url) {
        url = url.trim();
        if (url.endsWith("/json")) return url;
        if (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        return url + "/json";
    }

    void listenNtfy(String url) throws Exception {
        if (url.isEmpty()) return;
        HttpURLConnection c = (HttpURLConnection)new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(65000);
        c.setRequestProperty("User-Agent", "RustWake/0.1.2");
        BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream()));
        String line;
        while (running && prefs.getBoolean("watch", true) && (line = br.readLine()) != null) {
            line = line.trim();
            if (line.isEmpty()) continue;
            handleNtfyLine(line);
        }
    }

    void handleNtfyLine(String line) throws Exception {
        if (!line.startsWith("{")) return;
        JSONObject j = new JSONObject(line);
        String event = j.optString("event", "");
        if (!"message".equals(event)) return;
        Alert a = new Alert();
        a.id = j.optString("id", "");
        a.title = j.optString("title", "RAID WAKE");
        String msg = j.optString("message", "");
        a.trigger = msg.isEmpty() ? "ntfy urgent alert" : (msg.length() > 80 ? msg.substring(0, 80) : msg);
        a.base = pickField(msg, "base", "Main Base");
        a.grid = pickField(msg, "grid", "?");
        a.server = pickField(msg, "server", "Rust server");
        int priority = j.optInt("priority", 0);
        if (priority >= 4 || a.title.toUpperCase().contains("RAID") || msg.toUpperCase().contains("RAID") || msg.toUpperCase().contains("WAKE") || msg.toUpperCase().contains("ALARM")) {
            triggerOnce(a, line);
        }
    }

    String pickField(String msg, String key, String fallback) {
        try {
            String lower = msg.toLowerCase();
            String k = key.toLowerCase() + "=";
            int i = lower.indexOf(k);
            if (i < 0) return fallback;
            int start = i + k.length();
            int end = msg.indexOf('\n', start);
            if (end < 0) end = msg.indexOf('·', start);
            if (end < 0) end = msg.length();
            String v = msg.substring(start, end).trim();
            return v.isEmpty() ? fallback : v;
        } catch(Exception e) { return fallback; }
    }

    void pollOnce(String url) throws Exception {
        if (url.isEmpty()) return;
        HttpURLConnection c = (HttpURLConnection)new URL(url).openConnection();
        c.setConnectTimeout(8000); c.setReadTimeout(8000); c.setRequestProperty("User-Agent", "RustWake/0.1.2");
        String body = read(c.getInputStream());
        if (body == null) return;
        body = body.trim();
        boolean trigger = false;
        Alert a = new Alert();
        if (body.startsWith("{")) {
            JSONObject j = new JSONObject(body);
            trigger = j.optBoolean("alarm", false) || j.optBoolean("wake", false);
            a.id = j.optString("id", "");
            a.title = j.optString("title", a.title);
            a.base = j.optString("base", a.base);
            a.grid = j.optString("grid", a.grid);
            a.server = j.optString("server", a.server);
            a.trigger = j.optString("trigger", j.optString("type", a.trigger));
        } else {
            String upper = body.toUpperCase();
            trigger = upper.contains("RAID") || upper.contains("WAKE") || upper.contains("ALARM");
            a.trigger = body.length() > 80 ? body.substring(0, 80) : body;
        }
        if (trigger) triggerOnce(a, body);
    }

    void triggerOnce(Alert a, String raw) {
        String key = a.id.isEmpty() ? String.valueOf(raw.hashCode()) : a.id;
        String last = prefs.getString("lastId", "");
        if (!key.equals(last)) {
            prefs.edit().putString("lastId", key).apply();
            Notifier.trigger(this, a);
        }
    }

    String read(InputStream in) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(in));
        StringBuilder sb = new StringBuilder(); String line;
        while ((line = br.readLine()) != null) sb.append(line).append('\n');
        return sb.toString();
    }

    Notification serviceNotification(String text) {
        Intent i = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 71436, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, Notifier.CHANNEL_ID) : new Notification.Builder(this);
        return b.setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("Rust Wake").setContentText(text).setContentIntent(pi).setOngoing(true).build();
    }

    @Override public void onDestroy() { running = false; if (worker != null) worker.interrupt(); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
