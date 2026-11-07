/*
 * RaceBox binary protocol: reads the packets a RaceBox Mini, Mini S or Micro sends over Bluetooth
 * (UART-over-BLE, the RX/TX characteristics), as described in RaceBox BLE Protocol Documentation rev 9.
 *
 * This file only parses bytes. It does not connect to anything. Bytes arrive in notifications that can
 * split or join packets, so push() keeps a buffer and returns only the complete packets whose checksum is valid.
 *
 * window.MT3UKRaceBox:
 *   parser()            -> { push(bytes) -> [{ cls, id, payload }] }
 *   checksum(bytes)     -> [ck_a, ck_b] over bytes 2 to end-2 (the packet without its header and checksum)
 *   decodeLive(payload) -> the 80-byte RaceBox Data Message (class 0xFF, id 0x01) as readable values
 */
(function (root) {
  'use strict';

  var HEADER_1 = 0xB5, HEADER_2 = 0x62;
  var CLASS_RACEBOX = 0xFF, ID_DATA = 0x01, ID_HISTORY = 0x21;
  var MAX_PAYLOAD = 504;

  function checksum(bytes) {
    // Fletcher-8 over the class, id, length and payload: the two check bytes that end each packet.
    var a = 0, b = 0;
    for (var i = 2; i < bytes.length - 2; i++) {
      a = (a + bytes[i]) & 0xFF;
      b = (b + a) & 0xFF;
    }
    return [a, b];
  }

  function u8(p, o) { return p[o]; }
  function u16(p, o) { return p[o] | (p[o + 1] << 8); }
  function u32(p, o) { return (p[o] | (p[o + 1] << 8) | (p[o + 2] << 16)) + p[o + 3] * 0x1000000; }
  function i16(p, o) { var v = u16(p, o); return v > 0x7FFF ? v - 0x10000 : v; }
  function i32(p, o) { var v = u32(p, o); return v > 0x7FFFFFFF ? v - 0x100000000 : v; }

  // Splits a byte stream into packets. Anything before a header is skipped, and a packet with a bad checksum is dropped.
  function parser() {
    var buf = [];
    return {
      push: function (bytes) {
        for (var k = 0; k < bytes.length; k++) buf.push(bytes[k]);
        var out = [];
        while (true) {
          // Find the next header.
          var start = -1;
          for (var i = 0; i + 1 < buf.length; i++) {
            if (buf[i] === HEADER_1 && buf[i + 1] === HEADER_2) { start = i; break; }
          }
          if (start < 0) { buf = buf.length && buf[buf.length - 1] === HEADER_1 ? [HEADER_1] : []; break; }
          if (start > 0) buf = buf.slice(start);
          if (buf.length < 6) break;
          var len = u16(buf, 4);
          if (len > MAX_PAYLOAD) { buf = buf.slice(2); continue; }
          var total = 6 + len + 2;
          if (buf.length < total) break;
          var packet = buf.slice(0, total);
          var ck = checksum(packet);
          if (ck[0] === packet[total - 2] && ck[1] === packet[total - 1]) {
            out.push({ cls: packet[2], id: packet[3], payload: packet.slice(6, 6 + len) });
            buf = buf.slice(total);
          } else {
            buf = buf.slice(2);
          }
        }
        return out;
      }
    };
  }

  // Decodes the 80-byte live data message (class 0xFF, id 0x01; the history message 0x21 has the same layout).
  function decodeLive(p) {
    if (!p || p.length < 80) return null;
    var year = u16(p, 4), month = u8(p, 6), day = u8(p, 7), hour = u8(p, 8), minute = u8(p, 9), second = u8(p, 10);
    var nanos = i32(p, 16);
    var validity = u8(p, 11);
    var fixStatus = u8(p, 20);
    var fixFlags = u8(p, 21);
    var latLonFlags = u8(p, 66);
    var battery = u8(p, 67);
    var out = {
      utc: Date.UTC(year, month - 1, day, hour, minute, second) + nanos / 1e6,
      timeValid: (validity & 0x02) !== 0 && (validity & 0x01) !== 0,
      fixStatus: fixStatus,                      // 0 none, 2 two-dimensional, 3 three-dimensional
      fixOk: fixStatus === 3 && (fixFlags & 0x01) !== 0,
      satellites: u8(p, 23),
      lat: i32(p, 28) / 1e7,                     // degrees
      lon: i32(p, 24) / 1e7,                     // degrees
      altitudeMsl: i32(p, 36) / 1000,            // metres
      horizontalAccuracy: u32(p, 40) / 1000,     // metres
      speedMs: i32(p, 48) / 1000,                // metres per second, ground speed (or 3D if the device is set so)
      speedKph: i32(p, 48) / 1000 * 3.6,
      heading: i32(p, 52) / 1e5,                 // degrees from north
      speedAccuracyMs: u32(p, 56) / 1000,
      headingAccuracy: u32(p, 60) / 1e5,         // degrees
      pdop: u16(p, 64) / 100,
      coordinatesValid: (latLonFlags & 0x01) === 0,
      gForce: { x: i16(p, 68) / 1000, y: i16(p, 70) / 1000, z: i16(p, 72) / 1000 },   // g: x front/back, y right/left, z up/down
      rotation: { x: i16(p, 74) / 100, y: i16(p, 76) / 100, z: i16(p, 78) / 100 }      // degrees per second: roll, pitch, yaw
    };
    // Battery: the Mini and Mini S report charging in the top bit and percentage in the rest.
    // The Micro has no battery and reports its input voltage times 10 (0x79 is 12.1 V).
    out.batteryRaw = battery;
    out.charging = (battery & 0x80) !== 0;
    out.batteryPercent = battery & 0x7F;
    out.inputVolts = battery / 10;
    return out;
  }

  var api = { parser: parser, checksum: checksum, decodeLive: decodeLive, CLASS_RACEBOX: CLASS_RACEBOX, ID_DATA: ID_DATA, ID_HISTORY: ID_HISTORY };
  root.MT3UKRaceBox = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
