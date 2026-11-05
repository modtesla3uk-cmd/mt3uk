package com.mt3uk.lapsapp2026;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

// Google Play updates for Laps. check() says whether a newer version is there, and shows nothing. update() starts
// Play's flexible update when the member taps Update: Play downloads it in the background, then the app restarts
// onto the new version. Only works for an app installed from Google Play.
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private static final int UPDATE_REQUEST_CODE = 9001;
    private AppUpdateManager manager;
    private InstallStateUpdatedListener listener;

    private AppUpdateManager manager() {
        if (manager == null) manager = AppUpdateManagerFactory.create(getContext());
        return manager;
    }

    @PluginMethod
    public void check(PluginCall call) {
        manager().getAppUpdateInfo().addOnSuccessListener(info -> {
            boolean available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                && info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE);
            call.resolve(new JSObject().put("available", available).put("versionCode", info.availableVersionCode()));
        }).addOnFailureListener(e -> call.resolve(new JSObject().put("available", false).put("versionCode", 0)));
    }

    @PluginMethod
    public void update(PluginCall call) {
        final AppUpdateManager m = manager();
        m.getAppUpdateInfo().addOnSuccessListener(info -> {
            if (!(info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                    && info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE))) {
                call.resolve(new JSObject().put("started", false));
                return;
            }
            if (listener == null) {
                listener = state -> {
                    // Downloaded in the background: install and restart onto the new version.
                    if (state.installStatus() == InstallStatus.DOWNLOADED) m.completeUpdate();
                };
                m.registerListener(listener);
            }
            try {
                m.startUpdateFlowForResult(info, getActivity(),
                    AppUpdateOptions.newBuilder(AppUpdateType.FLEXIBLE).build(), UPDATE_REQUEST_CODE);
                call.resolve(new JSObject().put("started", true));
            } catch (Exception e) {
                call.resolve(new JSObject().put("started", false));
            }
        }).addOnFailureListener(e -> call.resolve(new JSObject().put("started", false)));
    }
}
