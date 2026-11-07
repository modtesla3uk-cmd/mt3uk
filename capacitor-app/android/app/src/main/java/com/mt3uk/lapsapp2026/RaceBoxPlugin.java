package com.mt3uk.lapsapp2026;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanSettings;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.UUID;

// Connects to a RaceBox Mini, Mini S or Micro and passes its live data to the web page as it arrives.
// The page reads the bytes with js/racebox-parse.js. This plugin only finds the device, connects, and turns on
// the UART notifications (RaceBox BLE protocol documentation, revision 9). It never writes to the device.
//
// Events: "status" { state, detail } where state is scanning, connecting, discovering, connected, disconnected,
// notfound or failed; and "data" { base64 } with the bytes of one Bluetooth notification.
@CapacitorPlugin(
    name = "RaceBox",
    permissions = {
        @Permission(strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }, alias = "bluetooth"),
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION }, alias = "location")
    }
)
public class RaceBoxPlugin extends Plugin {
    private static final UUID UART_SERVICE = UUID.fromString("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
    private static final UUID UART_TX = UUID.fromString("6E400003-B5A3-F393-E0A9-E50E24DCCA9E");
    private static final UUID CLIENT_CONFIG = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final long SCAN_TIMEOUT_MS = 60000;
    // Android often fails the first connection with a generic error, and the RaceBox app retries; so do we.
    private static final int MAX_ATTEMPTS = 3;
    private static final long RETRY_DELAY_MS = 800;
    private static final int WANTED_MTU = 247;

    private final Handler main = new Handler(Looper.getMainLooper());
    private BluetoothGatt gatt;
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private boolean scanning = false;
    private boolean connecting = false;
    private boolean connected = false;
    private String deviceName = "";
    private BluetoothDevice pendingDevice;
    private int attempts = 0;

    private final Runnable scanTimeout = new Runnable() {
        @Override
        public void run() {
            stopScan();
            if (!connecting) emitStatus("notfound", "");
        }
    };

    // The Bluetooth and location permissions the phone needs for this Android version.
    private String[] aliases() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? new String[] { "bluetooth" } : new String[] { "location" };
    }

    private boolean hasPermissions() {
        for (String alias : aliases()) {
            if (getPermissionState(alias) != PermissionState.GRANTED) return false;
        }
        return true;
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (!hasPermissions()) {
            requestPermissionForAliases(aliases(), call, "permissionsCallback");
            return;
        }
        startScan(call);
    }

    @PermissionCallback
    private void permissionsCallback(PluginCall call) {
        if (!hasPermissions()) {
            call.reject("Bluetooth permission was not given. Allow it in the phone's settings for Laps.");
            return;
        }
        startScan(call);
    }

    @SuppressLint("MissingPermission")
    private void startScan(PluginCall call) {
        if (connected) {
            call.resolve(new JSObject().put("connected", true).put("name", deviceName));
            return;
        }
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Turn Bluetooth on, then try again.");
            return;
        }
        scanner = adapter.getBluetoothLeScanner();
        if (scanner == null) {
            call.reject("This phone cannot scan for Bluetooth devices.");
            return;
        }
        stopScan();
        connecting = false;
        scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                handleFound(result.getDevice());
            }

            @Override
            public void onScanFailed(int errorCode) {
                scanning = false;
                emitStatus("failed", "scan " + errorCode);
            }
        };
        scanning = true;
        emitStatus("scanning", "");
        // Low latency finds a sleeping or distant device far sooner than the default (low power) mode.
        ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        scanner.startScan(null, settings, scanCallback);
        main.postDelayed(scanTimeout, SCAN_TIMEOUT_MS);
        call.resolve(new JSObject().put("scanning", true));
    }

    @SuppressLint("MissingPermission")
    private void handleFound(BluetoothDevice device) {
        String name = device.getName();
        if (connecting || name == null) return;
        if (!name.startsWith("RaceBox Mini") && !name.startsWith("RaceBox Micro")) return;
        connecting = true;
        deviceName = name;
        pendingDevice = device;
        attempts = 1;
        stopScan();
        emitStatus("connecting", name);
        gatt = device.connectGatt(getContext(), false, gattCallback, BluetoothDevice.TRANSPORT_LE);
    }

    @SuppressLint("MissingPermission")
    private void reconnect() {
        if (pendingDevice == null) return;
        connecting = true;
        gatt = pendingDevice.connectGatt(getContext(), false, gattCallback, BluetoothDevice.TRANSPORT_LE);
    }

    @SuppressLint("MissingPermission")
    private void stopScan() {
        if (scanning && scanner != null && scanCallback != null) {
            try {
                scanner.stopScan(scanCallback);
            } catch (SecurityException e) {
                // The permission was taken away while scanning; nothing more to stop.
            }
        }
        scanning = false;
        main.removeCallbacks(scanTimeout);
    }

    @SuppressLint("MissingPermission")
    private void closeGatt() {
        if (gatt != null) {
            try {
                gatt.disconnect();
                gatt.close();
            } catch (SecurityException e) {
                // Already closed or the permission was taken away.
            }
            gatt = null;
        }
        connecting = false;
        connected = false;
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        stopScan();
        pendingDevice = null;
        attempts = 0;
        closeGatt();
        emitStatus("disconnected", "");
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(new JSObject().put("connected", connected).put("name", deviceName).put("permitted", hasPermissions()));
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                emitStatus("discovering", deviceName);
                // A larger packet size means fewer notifications. If the phone refuses, discover at the default size.
                if (!g.requestMtu(WANTED_MTU)) g.discoverServices();
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                // A failed first connection is tried again; a link that drops after connecting is reported.
                boolean retry = !connected && pendingDevice != null && attempts < MAX_ATTEMPTS;
                closeGatt();
                if (retry) {
                    attempts++;
                    emitStatus("retrying", String.valueOf(attempts));
                    main.postDelayed(() -> reconnect(), RETRY_DELAY_MS);
                } else {
                    pendingDevice = null;
                    emitStatus("disconnected", "");
                }
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onMtuChanged(BluetoothGatt g, int mtu, int status) {
            g.discoverServices();
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                emitStatus("failed", "services " + status);
                g.disconnect();
                return;
            }
            BluetoothGattService service = g.getService(UART_SERVICE);
            BluetoothGattCharacteristic tx = service == null ? null : service.getCharacteristic(UART_TX);
            BluetoothGattDescriptor config = tx == null ? null : tx.getDescriptor(CLIENT_CONFIG);
            if (config == null) {
                emitStatus("failed", "not a RaceBox UART");
                g.disconnect();
                return;
            }
            g.setCharacteristicNotification(tx, true);
            config.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            g.writeDescriptor(config);
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor descriptor, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                connecting = false;
                connected = true;
                attempts = 0;
                emitStatus("connected", deviceName);
            } else {
                emitStatus("failed", "notifications " + status);
                g.disconnect();
            }
        }

        // Android 13 and later call this one.
        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic characteristic, byte[] value) {
            if (UART_TX.equals(characteristic.getUuid())) emitData(value);
        }

        // Earlier Android versions call this one.
        @SuppressWarnings("deprecation")
        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic characteristic) {
            if (UART_TX.equals(characteristic.getUuid())) emitData(characteristic.getValue());
        }
    };

    private void emitData(final byte[] value) {
        if (value == null || value.length == 0) return;
        final String base64 = Base64.encodeToString(value, Base64.NO_WRAP);
        main.post(() -> notifyListeners("data", new JSObject().put("base64", base64)));
    }

    private void emitStatus(final String state, final String detail) {
        main.post(() -> notifyListeners("status", new JSObject().put("state", state).put("detail", detail == null ? "" : detail)));
    }
}
