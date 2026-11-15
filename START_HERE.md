# VisionDetect: separate laptop website

Extract once and open Website-Code/README.md. This folder stays on the laptop;
it does not belong on the Pi or ESP32. Install Python 3, then run server.py from
Website-Code (or double-click Start Website.cmd on Windows). Open
http://127.0.0.1:8890 in your browser. No pip/npm installation is needed here.

The separate Pi+ESP32 package supplies robot code and pretrained CV weights.
The website only presents data and sends named checkpoint requests. Follow its
README for SSH forwards, physical Pi connection and an optional website preview.

- Website-Code/CODE_WALKTHROUGH.md: file roles, request flow and editing guide.
- Website-Code/CREDITS.md and LICENSE: source references and existing licence.
- WEBSITE_MANIFEST.json: hashes of all files under Website-Code/.

The green highlight shows only the active mission's route ahead. It clears as
the robot progresses and disappears after arrival/cancellation. The Pi retains
ownership of navigation and all motion/safety decisions.

No environments, credentials, model weights, firmware or Webots world are included.
Hardware calibration and supervised testing are still needed before real driving.
