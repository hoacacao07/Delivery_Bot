# Website code and editing guide

This folder is the laptop interface, not the robot controller. Read README.md
first for installation. Python 3 is the only website dependency. Open files in
any editor; no build tool, detector weights or firmware is needed here.

## Which file does what

| File | Responsibility | Common edits |
| --- | --- | --- |
| `server.py` | Local web hosting and a bounded bridge to the Pi APIs | Connection/error handling; allowed endpoints |
| `website.json` | Laptop port and forwarded Pi API/camera addresses | Change ports to match your SSH forwards |
| `assets/index.html` | Map, buttons, status panels and camera layout | Labels and panel arrangement |
| `assets/app.css` | Dark theme, sizing and responsive layout | Colours, typography and spacing |
| `assets/app.js` | Read snapshots, draw the map, send intentional button requests | Status formatting and presentation |
| `assets/parts.json` | Description of the fixed 19 component types | Explanations; not a physical wiring configuration |
| `preview-map.json` | Draft map for website-only preview | Preview artwork; not the robot's authoritative route map |
| `cv/index.html`, `cv/styles.css`, `cv/viewer.js` | Detailed camera view and observation cards | Display layout; calculations remain on the Pi |
| `test-controls.js` | Optional test-condition switches for a separate simulation | Test presentation only; physical robot rejects these commands |
| `Start Website.cmd` | Windows convenience launcher | Normally no edits required |
| `CREDITS.md`, `LICENSE` | Source references and existing project licence | Preserve and extend when adding third-party work |

## A delivery request, step by step

1. `init()` loads `/api/map` and `/api/session` from the laptop server. The map
   comes from the connected Pi. The browser receives a laptop session token,
   not the Pi's private command token.
2. `choose()` highlights a checkpoint. Selection alone sends no movement request.
3. `command()` creates a unique request ID for a deliberate dispatch, pause,
   resume or cancel click. `post()` includes a synchronized timestamp.
4. `Website.command()` forwards the request to the configured local Pi API.
   The Pi validates freshness, mission state and localization, plans the route,
   and applies safety checks before communicating with the ESP32.
5. `poll()` reads state about every 400 ms, with at most one status request in
   flight. `render()` updates the map and telemetry. A command receipt is an
   acknowledgement, not evidence that wheels are moving.
6. A heartbeat is sent about every 700 ms. The Pi owns the timeout and holds
   the mission if the app link disappears. Failed motion requests are never
   automatically replayed after reconnection. Reload after a Pi session restart.

The camera image is fetched independently, one image request at a time. Browser
refresh frequency does not increase detector inference FPS. Camera/CV calculations
and JPEG encoding run on the Pi; the website displays their results.

## What the green line means

The Pi sends the complete planned polyline in `mission.route_pixels`, its next
target in `mission.waypoint_index`, and current localized position in
`mission.pose.pixel`. `remainingRoutePath()` combines the current position with
only the upcoming vertices. It replaces the existing SVG path on every update.
It does not store a travel history or choose a nearest segment at a crossing.

As the robot moves, completed sections disappear. A paused mission keeps its
remaining route visible. Arrival, cancellation, idle state or missing route/pose
data clears the highlight. The red lines are the fixed approved path network.
Changing the display never changes the robot's actual route or control policy.

## Reading telemetry correctly

- Distances are metres and speeds are metres per second. A missing estimate is
  unknown, not zero. Detection boxes/labels and distance estimates originate on
  the Pi, not in JavaScript.
- The map marker uses fused GNSS, wheel and IMU localization. The Waveshare text
  shows the raw GNSS latitude/longitude, fix age and whether the source is virtual.
  Simulated coordinates are not a surveyed USF location.
- Navigation state and estimated wheel feedback are distinct from a requested
  action. Stale or disconnected data disables dispatch; the Pi repeats its own
  checks independently of browser controls.
- Website-only preview never fabricates a moving robot or accepts deliveries.
  Test switches appear only when explicitly enabled for supported test modes.
- The component coverage page describes software/simulation checks, not a claim
  that the physical parts have been calibrated or validated on this robot.

## Changes that belong elsewhere

Edit approved routes/checkpoints, stop distances, localization thresholds and
motion rules in the separate Pi project. Edit sensor/motor pins, ultrasonic
emergency braking and wheel feedback in the separate ESP32 project. The browser
must never become the source of wheel commands or override emergency braking.

For a later hosted app, retain named checkpoint requests and robot-owned safety.
The current local prototype is not an internet-facing service: remote hosting
will need authentication, user permissions and a secured transport design.
LTE connectivity is configured on Raspberry Pi OS; this website does not drive
the Waveshare modem directly. See the Pi handoff guide for hardware calibration.

## Quick checks after an edit

Run `python server.py --help`, then `python server.py --preview` and open
`http://127.0.0.1:8890`. Check layout, checkpoint selection and offline labels.
The preview cannot validate motors, navigation or detection. For those, connect
the separate test project or the calibrated physical robot using README.md.
The development repository includes API/separation and remaining-route regression
tests; development tests are deliberately not part of this small website ZIP.

See CREDITS.md for upstream documentation and model provenance. This interface
uses native browser APIs and Python's standard library, not a copied web template.
