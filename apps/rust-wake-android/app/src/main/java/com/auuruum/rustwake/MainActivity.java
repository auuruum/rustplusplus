package com.auuruum.rustwake;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.*;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.firestore.SetOptions;
import com.google.firebase.firestore.FirebaseFirestore;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    EditText endpoint;
    EditText linkCode;
    TextView status;
    TextView tokenView;
    SharedPreferences prefs;

    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("rustwake", MODE_PRIVATE);
        Notifier.ensureChannel(this);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        if (getIntent() != null && Intent.ACTION_VIEW.equals(getIntent().getAction())) {
            Notifier.trigger(this, Alert.fromIntent(getIntent()));
        }
        buildUi();
    }

    void buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.rgb(18,14,12));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(22), dp(22), dp(22), dp(22));
        scroll.addView(root);

        TextView title = text("Rust Wake", 30, true);
        title.setTextColor(Color.rgb(244,214,160));
        root.addView(title);
        TextView sub = text("Link this phone to Rust++ raid wake alarms.", 15, false);
        sub.setTextColor(Color.rgb(210,190,165));
        root.addView(sub);

        TextView step = text("1. Run /wake link in Discord.\n2. Enter the 6-digit code here.\n3. Press Link device.\n4. Run /wake check in Discord, then /wake test.", 14, false);
        step.setTextColor(Color.rgb(190,175,155));
        root.addView(step);

        linkCode = new EditText(this);
        linkCode.setHint("6-digit link code, e.g. 482913");
        linkCode.setSingleLine(true);
        linkCode.setTextColor(Color.WHITE);
        linkCode.setHintTextColor(Color.rgb(140,130,120));
        linkCode.setBackgroundColor(Color.rgb(38,30,25));
        linkCode.setPadding(dp(12), dp(8), dp(12), dp(8));
        root.addView(linkCode);

        Button linkDevice = btn("Link device");
        linkDevice.setOnClickListener(v -> linkDevice());
        root.addView(linkDevice);

        Button notif = btn("Open notification settings");
        notif.setOnClickListener(v -> startActivity(Notifier.appNotificationSettings(this)));
        root.addView(notif);

        Button test = btn("Test alarm now");
        test.setOnClickListener(v -> {
            Alert a = new Alert();
            a.title = "RAID WAKE"; a.base = "Main Base"; a.grid = "H12"; a.server = "EU Monthly"; a.trigger = "Seismic Sensor";
            Notifier.trigger(this, a);
        });
        root.addView(test);

        status = text("", 14, false);
        status.setTextColor(Color.rgb(190,175,155));
        root.addView(status);

        LinearLayout devPanel = new LinearLayout(this);
        devPanel.setOrientation(LinearLayout.VERTICAL);
        devPanel.setVisibility(View.GONE);

        Button developerMode = btn("Developer mode");
        developerMode.setOnClickListener(v -> {
            boolean show = devPanel.getVisibility() != View.VISIBLE;
            devPanel.setVisibility(show ? View.VISIBLE : View.GONE);
            developerMode.setText(show ? "Hide developer mode" : "Developer mode");
        });
        root.addView(developerMode);

        TextView fallbackTitle = text("Developer / fallback tools", 16, true);
        fallbackTitle.setTextColor(Color.rgb(244,214,160));
        devPanel.addView(fallbackTitle);

        TextView fallbackHelp = text("Normal users do not need this. Use only for debugging FCM token copy/paste or old polling URL mode.", 13, false);
        fallbackHelp.setTextColor(Color.rgb(150,140,130));
        devPanel.addView(fallbackHelp);

        endpoint = new EditText(this);
        endpoint.setHint("Polling URL, optional");
        endpoint.setSingleLine(false);
        endpoint.setMinLines(2);
        endpoint.setText(prefs.getString("endpoint", ""));
        endpoint.setTextColor(Color.WHITE);
        endpoint.setHintTextColor(Color.rgb(140,130,120));
        endpoint.setBackgroundColor(Color.rgb(38,30,25));
        endpoint.setPadding(dp(12), dp(8), dp(12), dp(8));
        devPanel.addView(endpoint);

        Button save = btn("Save URL");
        save.setOnClickListener(v -> { prefs.edit().putString("endpoint", endpoint.getText().toString().trim()).apply(); updateStatus(); toast("Saved"); });
        devPanel.addView(save);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        Button start = btn("Start watch");
        Button stop = btn("Stop");
        start.setOnClickListener(v -> { prefs.edit().putString("endpoint", endpoint.getText().toString().trim()).putBoolean("watch", true).apply(); startServiceCompat(); updateStatus(); });
        stop.setOnClickListener(v -> { prefs.edit().putBoolean("watch", false).apply(); stopService(new Intent(this, PollService.class)); updateStatus(); });
        row.addView(start, new LinearLayout.LayoutParams(0, dp(54), 1));
        row.addView(stop, new LinearLayout.LayoutParams(0, dp(54), 1));
        devPanel.addView(row);

        Button refreshToken = btn("Get / refresh FCM token");
        refreshToken.setOnClickListener(v -> fetchToken());
        devPanel.addView(refreshToken);

        Button copyToken = btn("Copy FCM token");
        copyToken.setOnClickListener(v -> {
            String token = prefs.getString("fcmToken", "");
            ((android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(android.content.ClipData.newPlainText("Rust Wake FCM token", token));
            toast("Token copied");
        });
        devPanel.addView(copyToken);

        tokenView = text("FCM token: loading...", 11, false);
        tokenView.setTextColor(Color.rgb(150,140,130));
        devPanel.addView(tokenView);

        root.addView(devPanel);

        TextView help = text("Firebase link build. FCM push opens fullscreen alarm without permanent ntfy stream. Old URL/ntfy mode is hidden under Developer mode.", 13, false);
        help.setTextColor(Color.rgb(150,140,130));
        root.addView(help);
        setContentView(scroll);
        fetchToken();
        updateStatus();
    }

    void startServiceCompat() {
        Intent i = new Intent(this, PollService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
    }

    void fetchToken() {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                if (tokenView != null) tokenView.setText("FCM token: failed, " + task.getException());
                return;
            }
            String token = task.getResult();
            prefs.edit().putString("fcmToken", token).apply();
            if (tokenView != null) tokenView.setText("FCM token:\n" + token);
        });
    }

    void linkDevice() {
        String code = linkCode == null ? "" : linkCode.getText().toString().replaceAll("\\D", "");
        if (code.length() != 6) {
            toast("Enter 6-digit code from /wake link");
            return;
        }

        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                toast("FCM token failed");
                return;
            }

            String token = task.getResult();
            prefs.edit().putString("fcmToken", token).apply();
            if (tokenView != null) tokenView.setText("FCM token:\n" + token);

            Map<String, Object> data = new HashMap<>();
            data.put("code", code);
            data.put("fcmToken", token);
            data.put("deviceName", Build.MANUFACTURER + " " + Build.MODEL);
            data.put("appVersion", "0.3.1-dev-mode");
            data.put("status", "linked");
            data.put("linkedAt", new java.util.Date());

            FirebaseFirestore.getInstance()
                .collection("rustWakeLinks")
                .document(code)
                .set(data, SetOptions.merge())
                .addOnSuccessListener(unused -> toast("Linked. Now run /wake check."))
                .addOnFailureListener(e -> toast("Link failed: " + e.getMessage()));
        });
    }

    void updateStatus() { status.setText("FCM: ON when installed + notifications allowed\nFirebase link: rustWakeLinks\nFallback watch: " + (prefs.getBoolean("watch", false) ? "ON" : "OFF") + "\nApp version: 0.3.1-dev-mode debug"); }
    TextView text(String s, int sp, boolean bold) { TextView t = new TextView(this); t.setText(s); t.setTextSize(sp); t.setPadding(0, dp(8),0,dp(8)); if (bold) t.setTypeface(android.graphics.Typeface.DEFAULT_BOLD); return t; }
    Button btn(String s) { Button b = new Button(this); b.setText(s); b.setAllCaps(false); b.setTextSize(16); b.setPadding(0,dp(8),0,dp(8)); return b; }
    int dp(int v) { return (int)(v * getResources().getDisplayMetrics().density + 0.5f); }
    void toast(String s) { Toast.makeText(this, s, Toast.LENGTH_SHORT).show(); }
}
