# CC-FB3 startup recovery

The workspace startup no longer treats two animation frames as proof of paint.
An opaque HTML/body/root surface stays behind the committed workspace until a
Chromium Element Timing entry reports paint of its temporary text marker. The
marker begins hidden and becomes visible after a frame and a task, when the splash
starts revealing the opaque workspace. Only its matching renderer paint entry in
a visible document enables the existing native appearance helper and removes the
cover. Theme preferences and the native glass implementation are unchanged.

Boot rejection shows a safe message and keyboard-accessible Retry. Retry performs
one explicit window reload, resetting cached import/restore failures instead of
overlapping another restore attempt. Once content has committed, Retry first uses
the existing `confirmReload(true)` unsaved-change confirmation. It conservatively
asks even when no dirty editor is known to startup. Cancelled/failed/stale
confirmations retain the workspace; pending or accepted reload disables duplicate
clicks. Pre-mount rejection still retries without that confirmation.
A ten-second watchdog restores the opaque
cover with Retry and existing window controls. It offers Continue without
transparency only after the workspace has committed. Underlying content is inert
and hidden from accessibility while recovery is open. Recovery also temporarily
excludes every body sibling, including existing and newly added portals, retaining
their original inert/aria-hidden attributes for restoration. Its key/focus capture
handlers are installed before App's effects, suspend portal/global key handlers
only during recovery, and trap Tab within recovery actions. It initially focuses
an enabled action and restores prior focus after opaque continuation, preserving
portal state and the normal shared Modal implementation. Late paint callbacks cannot
enable glass after timeout; effect cleanup fences stale StrictMode callbacks.

Performance entries record bootstrap, workspace readiness, content commit, opaque
reveal, renderer-paint notification, glass activation, splash removal and UI
readiness. Browser Paint Timing entries provide first-paint/FCP separately: those
can belong to the HTML splash, so are not used as workspace readiness.

Element Timing is a renderer signal for a companion text marker, not proof that
the complete workspace was composited or presented by Windows. It does not detect
a later WebView2/GPU lost frame. Engines without Element Timing use a compatibility
path: reveal on the opaque surface, then check for nonempty workspace layout after
another frame and a 100ms paint opportunity. Visible documents with content call
the existing appearance initializer, preserving healthy glass and later theme
changes. This is scheduling/layout evidence, not renderer or compositor proof;
it is marked `content-paint-opportunity`, not `content-renderer-paint`. Empty/hidden
content retries that bounded check until the same ten-second watchdog. Hidden
windows or supported engines that withhold
the signal may require opaque continuation. These limits need real WebView2 and
other-platform acceptance; this builder neither launched nor stopped an app.
The watchdog requires the entry module and event loop to run. It cannot recover
from a frozen renderer or a failure to load the entry module itself.

The [Element Timing explainer](https://github.com/w3c/element-timing/blob/main/README.md)
describes the text-paint signal and its occlusion limitation. No native visibility,
configuration, process lifecycle, storage, credentials, State publication, FB2
routing, or App behavior was changed. Floating Mono startup uses its existing
appearance path. Hidden-window/show gating and a native repaint workaround were
deliberately left for native review if user acceptance still reproduces the issue.

Validation uses the real entry, HTML, recovery controller, appearance helpers and
window controls with a synthetic workspace and mocked native IPC. The focused
suite covers boot ordering, rejection, timeout, late callbacks, StrictMode,
disposal and unavailable timing; existing lifecycle/appearance/native-glass tests
are retained. Seven startup browser cases plus one existing FB2 chrome case cover
Retry, slow/never renderer notifications, hung boot, themes and usable opaque UI.
Three additional source-bound reviewer probes retain the no-discard assertion,
the exact ordinary keyboard sequence, and actual shared body-portal Modal keyboard
assertion. The native confirmation IPC is represented by a browser dialog; its
confirmation function is extracted from actual appLifecycle source, not replaced
with a fake guard. The no-discard probe waits for cancellation rather than a load
event, since cancelling a reload must not load a new page. Original reviewer and
builder failures remain in the external history.

External report, exact candidate pins, actual counts, raw earlier failures and
selected individually inspected screenshots:
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/ccfeedback3/REPORT.md`.
No UI byte-hash receipt chain was created. Fresh independent review and separate
release preparation remain required before root integration; batch remains OPEN.
