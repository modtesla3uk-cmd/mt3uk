package com.mt3uk.lapsapp2026;

import android.content.Intent;
import android.net.Uri;

import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Asks the phone to put a Laps icon on the home screen. Android shows its own prompt, and the member confirms it.
@CapacitorPlugin(name = "LapsShortcut")
public class LapsShortcutPlugin extends Plugin {
    @PluginMethod
    public void pin(PluginCall call) {
        if (!ShortcutManagerCompat.isRequestPinShortcutSupported(getContext())) {
            call.resolve(new JSObject().put("asked", false));
            return;
        }
        Intent intent = new Intent(getContext(), MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(Uri.parse("https://laps.mt3uk.com/laps.html"));
        ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(getContext(), "laps-home")
            .setShortLabel("Laps by MT3UK")
            .setLongLabel("Laps by MT3UK")
            .setIcon(IconCompat.createWithResource(getContext(), R.mipmap.ic_launcher))
            .setIntent(intent)
            .build();
        boolean asked = ShortcutManagerCompat.requestPinShortcut(getContext(), shortcut, null);
        call.resolve(new JSObject().put("asked", asked));
    }
}
