# Web Client Mouse Coordinate Offset on Android Chrome

**Status:** Not fixed — the change below was never committed; `input_model.dart` still uses `isDesktop || isWebDesktop` (checked 2026-09-25)  
**Date:** 2026-09-21  
**Component:** Flutter client `input_model.dart`  
**Platform:** Android Chrome (mobile browser accessing web client)

## Symptom

When using the web client from Android Chrome, mouse clicks land at different coordinates than where the user tapped. The offset corresponds to the device's status bar height (~24dp on most Android phones).

## Root Cause

**Confirmed via code analysis and browser emulation.**

The web client's `_pointerPositionForRemoteCanvas` in `flutter/lib/models/input_model.dart` uses `isWebDesktop` to decide the coordinate mapping path:

```dart
if (isDesktop || isWebDesktop) {
  return event.position;  // global window coordinates
}
// Mobile path: subtracts safe-area padding
return Offset(
  event.localPosition.dx - mediaData.padding.left,
  event.localPosition.dy - mediaData.padding.top - adjustY,
);
```

`isWebDesktop` is defined as `!isMobile()` in `flutter/lib/web/common.dart`. The `isMobile()` JS function checks the user agent string, and returns `true` for Android Chrome. This causes the mobile coordinate path to run.

The mobile path subtracts `mediaData.padding` (safe-area insets including status bar) from `localPosition`. On a real Android phone, `padding.top` includes the status bar height (~24dp), which incorrectly shifts the Y coordinate upward.

The web client always renders the desktop remote page layout regardless of browser type, so it should always use the desktop coordinate path (`event.position`).

## Proposed fix

Change the condition from `isDesktop || isWebDesktop` to `isDesktop || isWeb`:

```dart
if (isDesktop || isWeb) {
  return event.position;
}
```

This ensures all web builds (desktop browser, mobile browser) use the correct global position coordinates, since the web client always renders the desktop layout.

## Verification (of the uncommitted change, 2026-09-21)

- Confirmed `isMobile()` returns `true` on Android Chrome (Pixel 5 user agent) via Playwright
- Confirmed desktop browser connection works correctly after the fix
- Mouse coordinates map correctly to remote desktop positions

## Files

- `flutter/lib/models/input_model.dart:1619-1621` — the coordinate mapping fix
- `flutter/web/js/src/globals.js:108-111` — `isMobile()` user agent detection
- `flutter/lib/web/common.dart:12` — `isWebDesktop_` definition
