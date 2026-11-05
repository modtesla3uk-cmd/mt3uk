package com.mt3uk.lapsapp2026;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;

// Asks Google Play whether a newer version of Laps is available for this phone. If there is one, Play shows its own
// update screen, which the member accepts. Only works for an app installed from Google Play.
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private static final int UPDATE_REQUEST_CODE = 9001;

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        final AppUpdateManager manager = AppUpdateManagerFactory.create(getContext());
        manager.getAppUpdateInfo().addOnSuccessListener(info -> {
            boolean available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE);
            if (available) {
                try {
                    manager.startUpdateFlowForResult(info, getActivity(),
                        AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(), UPDATE_REQUEST_CODE);
                } catch (Exception e) {
                    // Play could not show its update screen; the app carries on.
                }
            }
            call.resolve(new JSObject().put("available", available));
        }).addOnFailureListener(e -> call.resolve(new JSObject().put("available", false)));
    }
}
