# Web Client Mouse Coordinate Offset on Android Chrome

**Status:** Not fixed, deprioritized 2026-09-26 (mobile is not a priority). See "Investigation 2026-09-26"; the root cause below is unconfirmed.  
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

## Investigation 2026-09-26 (Playwright Pixel 7 emulation, a self-hosted instance, Linux peer; remote pointer read with xdotool)

- On Android the web client shows the **mobile** home/menu screens but the **desktop** remote-session screen, so "always use the desktop path" is not obviously safe.
- **Offset not reproduced in emulation.** Mouse input maps correctly, e.g. page (206,400) -> remote 960,449 (expected ~960,451), even though it takes the mobile coordinate path. That path subtracts safe-area insets and the keyboard-helper adjustment, both zero in emulation; a real phone (status bar/cutout inset, keyboard helper bar) may differ. Needs a real device.
- **Touch taps never moved the remote pointer** (stayed at 0,0) while mouse clicks at the same points did. Unconfirmed whether taps click at the current cursor (mobile "mouse mode") or are ignored: `xinput test-xi2` did not see the injected input, and a screenshot check was inconclusive.
- Next steps if picked up: test on a real Android phone (tap an icon / the Applications menu), and read the touch handling of the desktop remote page on web (`input_model.dart`, `desktop/pages/remote_page.dart`).
