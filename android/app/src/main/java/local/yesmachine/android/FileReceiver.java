package local.yesmachine.android;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Hears that a computer's file arrived in advanced mode, and says so in a notification (Downloads.announce).
 *
 * In advanced mode the stream server (android/stream, Files.java) runs as the shell user and saves the file in the
 * Download folder itself, then sends this broadcast, with the file's name and the computer's name in the extras
 * "name" and "computer". Only the shell and the system may send it: the manifest asks for their DUMP permission.
 */
public final class FileReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String name = intent.getStringExtra("name");
        if (name == null || name.isEmpty() || name.length() > 200) return;
        // The shell owns the file, so the notification can't open it; it opens the Download folder.
        Downloads.announce(context, name, intent.getStringExtra("computer"), null);
    }
}
