package com.auuruum.rustwake;

import android.content.Intent;
import android.net.Uri;

public class Alert {
    public String id = "";
    public String title = "RAID WAKE";
    public String base = "Unknown base";
    public String grid = "?";
    public String server = "Unknown server";
    public String trigger = "Wake alert";

    public static Alert fromIntent(Intent intent) {
        Alert a = new Alert();
        if (intent == null) return a;
        Uri data = intent.getData();
        if (data != null) {
            copy(data.getQueryParameter("id"), v -> a.id = v);
            copy(data.getQueryParameter("title"), v -> a.title = v);
            copy(data.getQueryParameter("base"), v -> a.base = v);
            copy(data.getQueryParameter("grid"), v -> a.grid = v);
            copy(data.getQueryParameter("server"), v -> a.server = v);
            copy(data.getQueryParameter("trigger"), v -> a.trigger = v);
            copy(data.getQueryParameter("type"), v -> a.trigger = v);
        }
        copy(intent.getStringExtra("id"), v -> a.id = v);
        copy(intent.getStringExtra("title"), v -> a.title = v);
        copy(intent.getStringExtra("base"), v -> a.base = v);
        copy(intent.getStringExtra("grid"), v -> a.grid = v);
        copy(intent.getStringExtra("server"), v -> a.server = v);
        copy(intent.getStringExtra("trigger"), v -> a.trigger = v);
        copy(intent.getStringExtra("type"), v -> a.trigger = v);
        return a;
    }

    interface Setter { void set(String value); }
    static void copy(String value, Setter setter) { if (value != null && !value.trim().isEmpty()) setter.set(value.trim()); }
}
