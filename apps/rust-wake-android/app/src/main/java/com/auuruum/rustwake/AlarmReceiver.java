package com.auuruum.rustwake;

import android.content.*;

public class AlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        Notifier.trigger(context, Alert.fromIntent(intent));
    }
}
