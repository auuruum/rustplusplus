package com.auuruum.rustwake;

import android.app.Activity;
import android.media.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.graphics.Color;
import android.widget.*;

public class AlarmActivity extends Activity {
    Ringtone ringtone;
    Vibrator vibrator;

    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        Alert a = Alert.fromIntent(getIntent());
        buildUi(a);
        startAlarmSound();
    }

    void buildUi(Alert a) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(24), dp(24), dp(24), dp(24));
        root.setBackgroundColor(Color.rgb(12, 6, 4));

        TextView title = tv(a.title, 36, true, Color.rgb(255, 80, 70));
        title.setGravity(Gravity.CENTER);
        root.addView(title);
        TextView trig = tv(a.trigger, 24, true, Color.rgb(244,214,160));
        trig.setGravity(Gravity.CENTER);
        root.addView(trig);
        TextView info = tv(a.base + "\nGrid: " + a.grid + "\n" + a.server, 22, false, Color.WHITE);
        info.setGravity(Gravity.CENTER);
        root.addView(info);

        Button ack = new Button(this);
        ack.setText("ACK / STOP");
        ack.setTextSize(22);
        ack.setAllCaps(false);
        ack.setOnClickListener(v -> stopAndFinish());
        root.addView(ack, new LinearLayout.LayoutParams(-1, dp(72)));
        setContentView(root);
    }

    void startAlarmSound() {
        Notifier.tryBoostAlarmVolume(this);
        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            ringtone = RingtoneManager.getRingtone(this, uri);
            if (Build.VERSION.SDK_INT >= 21) {
                ringtone.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            }
            ringtone.play();
        } catch(Exception ignored) {}
        try {
            vibrator = (Vibrator)getSystemService(VIBRATOR_SERVICE);
            long[] pattern = new long[]{0,600,200,600,200,1600};
            if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0)); else vibrator.vibrate(pattern, 0);
        } catch(Exception ignored) {}
    }

    void stopAndFinish() {
        try { if (ringtone != null && ringtone.isPlaying()) ringtone.stop(); } catch(Exception ignored) {}
        try { if (vibrator != null) vibrator.cancel(); } catch(Exception ignored) {}
        Notifier.stop(this);
        finish();
    }
    @Override protected void onDestroy() { super.onDestroy(); try { if (ringtone != null && ringtone.isPlaying()) ringtone.stop(); } catch(Exception ignored) {} try { if (vibrator != null) vibrator.cancel(); } catch(Exception ignored) {} }
    TextView tv(String s, int sp, boolean bold, int color) { TextView t = new TextView(this); t.setText(s); t.setTextSize(sp); t.setTextColor(color); t.setPadding(0, dp(10),0,dp(10)); if (bold) t.setTypeface(android.graphics.Typeface.DEFAULT_BOLD); return t; }
    int dp(int v) { return (int)(v * getResources().getDisplayMetrics().density + 0.5f); }
}
