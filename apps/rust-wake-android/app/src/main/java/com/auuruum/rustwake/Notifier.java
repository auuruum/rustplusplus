package com.auuruum.rustwake;

import android.app.*;
import android.content.*;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

public class Notifier {
    public static final String CHANNEL_ID = "bebra_wake_alarm";

    public static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Rust Wake alarms", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Critical Rust wake alarms");
                ch.enableVibration(true);
                ch.setVibrationPattern(new long[]{0,500,250,500,250,1200});
                ch.setBypassDnd(true);
                ch.setSound(sound, attrs);
                nm.createNotificationChannel(ch);
            }
        }
    }

    public static void trigger(Context c, Alert alert) {
        ensureChannel(c);
        tryBoostAlarmVolume(c);
        Intent full = new Intent(c, AlarmActivity.class);
        full.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        full.putExtra("title", alert.title);
        full.putExtra("base", alert.base);
        full.putExtra("grid", alert.grid);
        full.putExtra("server", alert.server);
        full.putExtra("trigger", alert.trigger);
        c.startActivity(full);

        PendingIntent pi = PendingIntent.getActivity(c, 1001, full, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL_ID) : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.stat_sys_warning)
                .setContentTitle(alert.title)
                .setContentText(alert.trigger + " · " + alert.base + " · " + alert.grid)
                .setCategory(Notification.CATEGORY_ALARM)
                .setPriority(Notification.PRIORITY_MAX)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(pi)
                .setFullScreenIntent(pi, true);
        NotificationManager nm = (NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(71435, b.build());
    }

    public static void stop(Context c) {
        NotificationManager nm = (NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(71435);
    }

    public static void tryBoostAlarmVolume(Context c) {
        try {
            AudioManager am = (AudioManager)c.getSystemService(Context.AUDIO_SERVICE);
            int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            am.setStreamVolume(AudioManager.STREAM_ALARM, max, 0);
        } catch (Exception ignored) {}
    }

    public static Intent appNotificationSettings(Context c) {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        i.putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName());
        return i;
    }
}
