# Website credits

The HTML/CSS/JavaScript/SVG interface, map trace and laptop bridge are
project-authored integration from the local VisionDetect delivery prototype.
The map topology comes from the user's annotated Google Maps screenshot.
The website uses an original schematic; Google satellite tiles are not included.

The server uses Python's standard library:

- https://docs.python.org/3/library/http.server.html
- https://docs.python.org/3/library/urllib.request.html
- https://docs.python.org/3/library/json.html

The map uses native SVG and DOM APIs; no map SDK or third-party web template is
bundled. API references: [SVG](https://developer.mozilla.org/en-US/docs/Web/SVG),
[Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API), and
[DOM](https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model).

The website does not include or run the detector. Its displayed observations
come from the separately running robot. Related upstream work is credited here
so this standalone package does not imply the full system was made from scratch:

- [Ultralytics repository](https://github.com/ultralytics/ultralytics),
  [YOLOE documentation](https://docs.ultralytics.com/models/yoloe/) and
  [AGPL-3.0 licence](https://github.com/ultralytics/ultralytics/blob/main/LICENSE):
  pretrained inference in the separate Pi program; no weights are in this ZIP.
- [Cyberbotics Webots](https://github.com/cyberbotics/webots): the separate laptop
  simulation uses Webots scene assets under their own notices. No simulator,
  world or physical-device driver is bundled with this website.
- [Waveshare SIM7600G-H HAT documentation](https://www.waveshare.com/wiki/SIM7600G-H_4G_HAT):
  GNSS format reference for the separate Pi adapter. The website displays that
  adapter's telemetry; it does not communicate with the modem directly.

These documentation references are not claims that example code was copied.
No new detection model was trained for this website. Complete model/dependency
notices remain in the separate robot package's source-credit documents.

The existing project LICENSE is preserved alongside this file.

Source formatting also used [Prettier](https://github.com/prettier/prettier)
and [Black](https://github.com/psf/black) as development tools. They are not
website runtime dependencies or bundled programs.
