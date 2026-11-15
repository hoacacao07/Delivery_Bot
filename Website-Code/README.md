# Website-Code — run on the laptop

This is an independent project. It contains the map, checkpoint selection,
delivery buttons, live-view pages and their small laptop web server. It does not
import or run the Pi detector, navigation, ESP32 firmware, sensors or Webots.
Do not install this folder on the Pi.

The two programs communicate like this:

```text
Laptop browser → Laptop website → Pi command/status API → Pi navigation → ESP32
Laptop browser ← Laptop website ← Pi JSON/JPEG observations ← Pi camera/CV
```

The Pi remains in charge of route planning and safety. The website sends named
checkpoint requests and pause/resume/cancel messages. It never sends raw wheel
speeds and cannot override an emergency stop.

## Start

Install Python 3. No pip packages or JavaScript build tools are needed.
From this folder run:

```text
python server.py
```

Or double-click **Start Website.cmd** on Windows. Open
**http://127.0.0.1:8890**. The detailed camera page is **/cv** on that same website.
Edit `website.json` for the local forwarded robot API address and camera port.
If the robot is disconnected, controls stay disabled; no movement is fabricated.

For the real Pi, first start its separately installed `delivery_robot.py` and
forward its two data ports from a laptop terminal:

```text
ssh -L 8891:127.0.0.1:8891 -L 8879:127.0.0.1:8879 YOUR_PI_USERNAME@PI_ADDRESS
```

The Pi's default command/status API is **8891**, and its CV JSON/JPEG API is
**8879**. These are data endpoints, not websites. The laptop website on **8890**
serves every HTML/CSS/JavaScript file and bridges the data. The SSH connection
also supplies authentication across the network. Do not expose the prototype
API publicly. LTE networking/VPN details depend on the SIM/carrier.

For CV-only testing, run the Pi camera/CV entry point instead, forward 8879,
then open **http://127.0.0.1:8890/cv**. Delivery controls remain unavailable.

## Website-only preview

```text
python server.py --preview --test-controls
```

This displays the interface and draft map without any connected robot. Delivery
commands are rejected. It is labelled as a preview. Test switches are laptop
fixtures, available only in preview or when connected to a simulation API with
`--test-controls`. They are rejected for a physical Pi.

## Webots connection

The separate robot test project supplies its API at 8891 and camera at 8881.
Run this website with `--test-controls` to connect to that simulated robot.
The external robot test launcher can start the website as a separate process;
the Pi program never imports, hosts or starts it. Closing the website does not
close Webots; missing app heartbeats safely hold the robot.

The map uses the user's 11-stop drawing. `preview-map.json` is a presentation
fallback only. Actual routes and waypoint decisions belong to the robot's map
and navigation code. Real GPS calibration is still required before deployment.
The light green highlight shows only the current mission's remaining route,
starting at the robot. Travelled sections disappear, and arrival/cancellation
clears the highlight. The red approved path network remains visible.

## Editing and credits

- `assets/index.html`: layout; `assets/app.css`: appearance.
- `assets/app.js`: display, selection and requests to the laptop server.
- `server.py`: static hosting and a fixed, local API/data bridge.
- `cv/`: separate detailed camera-view presentation.
- `test-controls.js`: optional simulation-only input switches.
- `website.json`: editable host/port settings.

See CODE_WALKTHROUGH.md for the request/data flow, display behavior and editing
instructions. See CREDITS.md and LICENSE for provenance. No pretrained model, firmware or Python environment
is included in the website package; none is needed by the website.
