package local.yesmachine.android;

import android.annotation.TargetApi;
import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.MediaStore;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * Files a computer sends this device: where they are kept, and the notification that says one arrived.
 *
 * In general mode, FileChannel saves each file through storage(): on Android 10 and later in the shared Download
 * folder, through MediaStore, where any app finds it; on Android 8 and 9 in this app's own Download folder. In
 * advanced mode the stream server saves the file itself, and FileReceiver only asks for the notification. Either way,
 * announce() posts a notification that opens the file, or the Download folder.
 */
final class Downloads {

    private static final long ROOM = 256L * 1024 * 1024; // what an arriving file must leave free
    private static int next; // counts the notifications, to give each its own id

    private Downloads() {}

    /**
     * Where general mode keeps a file from the computer. Each file must leave ROOM free. A name that is taken gets a
     * number, as in "name (1)": Android 10 and later name a copy that way themselves, and on Android 8 and 9 this does
     * the same.
     */
    static FileChannel.Storage storage(final Context context) {
        return (name, size) -> {
            File volume = Environment.getExternalStorageDirectory();
            if (
                new StatFs(volume.getPath()).getAvailableBytes() < size + ROOM
            ) throw new IOException("The device doesn’t have room for that file.");
            if (Build.VERSION.SDK_INT >= 29) return mediaStore(context, name);
            // Android 8 and 9 let an app write to the shared Download folder only with a permission; this app's own
            // Download folder needs none.
            File folder = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (folder == null) throw new IOException("The device has no storage for files now.");
            File file = new File(folder, name);
            for (int copy = 1; file.exists(); copy++) {
                int dot = name.lastIndexOf('.');
                file = new File(
                    folder,
                    dot > 0
                        ? name.substring(0, dot) + " (" + copy + ")" + name.substring(dot)
                        : name + " (" + copy + ")"
                );
            }
            final File target = file;
            final OutputStream stream = new FileOutputStream(target);
            return new FileChannel.Target() {
                public OutputStream stream() {
                    return stream;
                }

                public String keep() throws IOException {
                    stream.close();
                    return target.getName();
                }

                public void discard() {
                    try {
                        stream.close();
                    } catch (IOException ignored) {}
                    target.delete();
                }
            };
        };
    }

    /**
     * Starts a file in the shared Download folder, Android 10 and later. It's marked pending, which keeps it from
     * other apps until keep() finishes it, so nobody sees half a file.
     */
    @TargetApi(29)
    private static FileChannel.Target mediaStore(Context context, String name) throws IOException {
        final ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, name);
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        final Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IOException("The device couldn’t save to its Download folder.");
        final OutputStream stream = resolver.openOutputStream(uri, "w");
        if (stream == null) {
            resolver.delete(uri, null, null);
            throw new IOException("The device couldn’t save to its Download folder.");
        }
        return new MediaTarget(resolver, uri, stream, name);
    }

    /** A file in the shared Download folder, which the notification can open. Android 10 and later. */
    @TargetApi(29)
    static final class MediaTarget implements FileChannel.Target {

        final ContentResolver resolver;
        final Uri uri;
        final OutputStream stream;
        final String name;

        MediaTarget(ContentResolver resolver, Uri uri, OutputStream stream, String name) {
            this.resolver = resolver;
            this.uri = uri;
            this.stream = stream;
            this.name = name;
        }

        public OutputStream stream() {
            return stream;
        }

        /**
         * Finishes the file, which shows it to other apps, and returns the name Android gave it: with a number added
         * when the name was taken.
         */
        public String keep() throws IOException {
            stream.close();
            ContentValues done = new ContentValues();
            done.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            try (
                Cursor row = resolver.query(
                    uri,
                    new String[] { MediaStore.Downloads.DISPLAY_NAME },
                    null,
                    null,
                    null
                )
            ) {
                if (
                    row != null && row.moveToFirst() && row.getString(0) != null
                ) return row.getString(0);
            }
            return name;
        }

        public void discard() {
            try {
                stream.close();
            } catch (IOException ignored) {}
            resolver.delete(uri, null, null);
        }
    }

    /**
     * Says a file arrived, in a notification: name is the name it was saved as, and computer the computer it came
     * from. file is the arrived file when this app saved it, so the notification can open it; a file advanced mode's
     * server saved belongs to the shell, so for it file is null and the notification opens the Download folder
     * instead. On Android 8 and 9 the notification opens the folder too.
     */
    static void announce(Context context, String name, String computer, FileChannel.Target file) {
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(
            new NotificationChannel(
                "files",
                "Files from computers",
                NotificationManager.IMPORTANCE_DEFAULT
            )
        );
        // One notification per file; ids go round from 1000 to 1999.
        int id = 1000 + (next++ % 1000);
        // Each notification's intents get request codes of their own (id * 2 and id * 2 + 1). Android treats intents
        // that differ only in their extras as the same one, so a shared code would point an earlier notification at
        // the latest file.
        Intent folder = new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
        );
        PendingIntent showFolder = PendingIntent.getActivity(
            context,
            id * 2,
            folder,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        PendingIntent open = showFolder;
        if (file instanceof MediaTarget) {
            // Opens the file with an app the person picks, which may read it.
            Uri uri = ((MediaTarget) file).uri;
            String type = context.getContentResolver().getType(uri);
            Intent view = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, type == null ? "*/*" : type)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            open = PendingIntent.getActivity(
                context,
                id * 2 + 1,
                Intent.createChooser(view, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            );
        }
        String from =
            computer == null || computer.trim().isEmpty() ? "a computer" : computer.trim();
        Notification.Builder builder = new Notification.Builder(context, "files")
            .setSmallIcon(R.drawable.ic_launcher)
            .setAutoCancel(true)
            .setContentTitle(name + " from " + from)
            .setContentText(
                Build.VERSION.SDK_INT >= 29
                    ? "Saved in Download."
                    : "Saved in Yes Machine’s Download folder."
            )
            .setContentIntent(open);
        if (open != showFolder) builder.addAction(
            new Notification.Action.Builder(null, "Open", open).build()
        );
        builder.addAction(
            new Notification.Action.Builder(null, "Show in Files", showFolder).build()
        );
        try {
            notifications.notify(id, builder.build());
        } catch (SecurityException noPermission) {
            /* the file is saved all the same */
        }
    }
}
