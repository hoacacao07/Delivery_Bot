/* Project-authored UI. No map SDK, third-party scripts or simulator truth.
   All mission state comes from the running robot controller's local API. */
"use strict";
let videoLoaded = false;
const cameraBaseUrl = "/camera";
const $ = (id) => document.getElementById(id);
// SVG uses its own XML namespace. This helper only builds the map drawing.
const ns = "http://www.w3.org/2000/svg";
let map,
  state,
  token,
  selected = "",
  lastReceipt = "",
  pollBusy = false,
  serverClockOffset = 0;
let testControls;
// Create a map element once; later status updates replace its attributes.
function svg(tag, attrs, parent) {
  const node = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.append(node);
  return node;
}
// Labels are plain text so detector names/receipts cannot inject markup.
function setText(id, text) {
  $(id).textContent = text;
}
// Convert internal status identifiers into readable labels without changing data.
function nice(value) {
  return String(value || "waiting").replaceAll("_", " ");
}
// The laptop bridge holds the robot token; the browser uses its own session token.
async function post(value) {
  const response = await fetch("/api/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Delivery-Token": token },
    body: JSON.stringify({ ...value, sent_at_unix_ms: Date.now() + serverClockOffset }),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Command failed");
  return result;
}
// Selection is a preview until Send robot is pressed; it never commands wheels.
function choose(id) {
  selected = id;
  $("destination").value = id;
  document
    .querySelectorAll(".stop")
    .forEach((n) => n.classList.toggle("selected", n.dataset.id === id));
  const stop = map.nodes.find((n) => n.id === id);
  setText(
    "destination-detail",
    stop ? `${id} · ${stop.name}` : "Choose a blue checkpoint or use the list above.",
  );
  renderControls();
}
// Disable dispatch on stale, disconnected or uncertain state. The Pi repeats
// these checks independently; disabled browser buttons are not a safety gate.
function renderControls() {
  const active = state?.mission && ["en_route", "paused"].includes(state.mission.state);
  $("dispatch").disabled =
    !selected ||
    !state?.ready ||
    active ||
    !state?.connection_ok ||
    !!state?.localization_fault ||
    state?.control_snapshot_age_s > 3;
  $("pause").disabled = !active;
  $("pause").textContent = state?.mission?.state === "paused" ? "▶ Resume" : "Ⅱ Pause";
  $("cancel").disabled = !active;
}
// Draw exactly the configured graph. Landmark blocks are approximate scenery;
// the browser never calculates a shortcut or invents geographic coordinates.
function buildMap() {
  const landmarks = [
    ["CHEMISTRY", 120, 76, 90, 23],
    ["SCIENCE CENTER", 70, 207, 67, 70],
    ["BIO-SCIENCE", 276, 157, 79, 76],
    ["ENGINEERING", 69, 434, 81, 80],
    ["CAS COMPLEX", 319, 412, 77, 63],
    ["ENGINEERING SOUTH", 226, 615, 170, 27],
  ];
  for (const [label, x, y, w, h] of landmarks) {
    svg(
      "rect",
      {
        x,
        y,
        width: w,
        height: h,
        rx: 3,
        fill: "#26372f",
        stroke: "#385044",
        "stroke-width": 0.6,
      },
      $("landmarks"),
    );
    svg(
      "text",
      {
        x: x + w / 2,
        y: y + h / 2 + 2,
        "text-anchor": "middle",
        fill: "#91a394",
        "font-size": 5.8,
        "letter-spacing": 0.4,
      },
      $("landmarks"),
    ).textContent = label;
  }
  svg(
    "text",
    { x: 254, y: 263, "text-anchor": "middle", fill: "#789b7e", "font-size": 9 },
    $("landmarks"),
  ).textContent = "UNSPECIFIC GRAVITY";
  svg(
    "circle",
    { cx: 222, cy: 266, r: 8, fill: "#23574d", stroke: "#3c8274", "stroke-width": 1 },
    $("landmarks"),
  );
  for (const edge of map.edges) {
    const a = map.nodes.find((n) => n.id === edge.from),
      b = map.nodes.find((n) => n.id === edge.to);
    const d = [a.pixel, ...(edge.via_pixels || []), b.pixel]
      .map((p) => p.join(","))
      .join(" ");
    svg(
      "polyline",
      {
        points: d,
        fill: "none",
        stroke: "#354c3e",
        "stroke-width": 18,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      },
      $("routes"),
    );
    svg(
      "polyline",
      {
        points: d,
        fill: "none",
        stroke: "#bb615a",
        "stroke-width": 2,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
        opacity: 0.8,
      },
      $("routes"),
    );
  }
  for (const stop of map.nodes.filter((n) => n.checkpoint !== false)) {
    const option = document.createElement("option");
    option.value = stop.id;
    option.textContent = `${stop.id} · ${stop.name}`;
    $("destination").append(option);
    const group = svg(
      "g",
      {
        class: "stop",
        transform: `translate(${stop.pixel.join(" ")})`,
        tabindex: 0,
        role: "button",
        "aria-label": `Select ${stop.name}`,
        "data-id": stop.id,
      },
      $("stops"),
    );
    svg(
      "circle",
      { r: 7, fill: "#46c6bb", stroke: "#152c22", "stroke-width": 2 },
      group,
    );
    svg("circle", { r: 13, fill: "transparent" }, group);
    svg("text", {}, group).textContent = stop.id;
    svg("title", {}, group).textContent = stop.name;
    group.addEventListener("click", () => choose(stop.id));
    group.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose(stop.id);
      }
    });
  }
}
// Draw only the unfinished portion of the CURRENT mission. The Pi's waypoint
// index identifies progress even at crossings or on a return trip; choosing a
// nearest map segment in the browser could accidentally show a previous lap.
// Start at the latest localized robot position, then retain every upcoming bend.
// This is presentation only: it never changes the Pi's route or wheel requests.
function remainingRoutePath(mission) {
  if (!mission || !["en_route", "paused"].includes(mission.state)) return "";
  const route = mission.route_pixels;
  const index = mission.waypoint_index;
  const here = mission.pose?.pixel;
  if (
    !Array.isArray(route) ||
    !Number.isInteger(index) ||
    index < 1 ||
    index >= route.length ||
    !Array.isArray(here)
  )
    return "";
  const points = [here, ...route.slice(index)];
  if (
    points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
  )
    return "";
  return points.map((p, i) => `${i ? "L" : "M"}${p.join(" ")}`).join(" ");
}
// Present the controller's latest snapshot. Never infer movement from a request
// receipt: display measured/estimated wheel telemetry and preserve unknowns.
function render() {
  $("camera").classList.toggle("hidden", !!state.preview || !videoLoaded);
  $("camera-placeholder").classList.toggle("hidden", !state.preview && videoLoaded);
  setText(
    "camera-placeholder",
    state.preview
      ? "Camera connects when the Webots test starts"
      : "Waiting for camera video",
  );
  const mission = state.mission,
    nav = state.navigation || {};
  const stale = state.control_snapshot_age_s > 3;
  let modeNotice = $("mode-notice");
  if (!modeNotice) {
    modeNotice = document.createElement("p");
    modeNotice.id = "mode-notice";
    modeNotice.className = "mode-notice";
    document.querySelector(".page-heading").after(modeNotice);
  }
  modeNotice.textContent = state.preview
    ? "UI preview only — no robot or camera is connected. Start the Webots simulation to test deliveries."
    : "";
  modeNotice.classList.toggle("hidden", !state.preview);
  document
    .querySelector('[data-tab="tests"]')
    .classList.toggle("hidden", !state.website_test_controls_allowed);
  document.querySelector(".environment").textContent = state.preview
    ? "UI PREVIEW / NO ROBOT"
    : state.simulation
      ? "WEBOTS / SOFTWARE TEST"
      : "PI DELIVERY / LOCAL APP";
  state.faults = state.faults || {};
  $("connection").classList.toggle("online", !!state.connection_ok && !stale);
  $("connection").lastElementChild.textContent = state.preview
    ? "Preview · no robot"
    : stale
      ? "Controller paused / stale"
      : state.ready
        ? state.connection_ok
          ? "App link connected"
          : "App link interrupted"
        : "Loading robot";
  // Replace ONE SVG path on every update. Never append travelled segments;
  // idle, cancelled and arrived missions clear the highlight immediately.
  $("planned-route").setAttribute("d", remainingRoutePath(mission));
  if (!mission) return;
  setText("mission-state", nice(mission.state).toUpperCase());
  const stop = map.nodes.find((n) => n.id === mission.destination);
  setText(
    "mission-title",
    stop ? `${mission.destination} · ${stop.name}` : "Ready for a request",
  );
  setText(
    "mission-reason",
    mission.state === "en_route" && nav.state === "STOP"
      ? nice(nav.reason)
      : mission.reason,
  );
  $("remaining").replaceChildren(
    document.createTextNode(
      mission.state === "idle" ? "—" : mission.remaining_m.toFixed(1),
    ),
    Object.assign(document.createElement("span"), { textContent: " m" }),
  );
  const speed = stale ? null : nav.estimated_speed_mps;
  $("speed").replaceChildren(
    document.createTextNode(typeof speed === "number" ? speed.toFixed(2) : "—"),
    Object.assign(document.createElement("span"), { textContent: " m/s" }),
  );
  if (mission.pose) {
    const p = mission.pose.pixel;
    $("robot-marker").classList.remove("hidden");
    $("robot-marker").setAttribute(
      "transform",
      `translate(${p[0]} ${p[1]}) rotate(${90 - (mission.pose.yaw_rad * 180) / Math.PI})`,
    );
  }
  setText(
    "safety",
    stale
      ? "Control data stale"
      : nav.esp32_emergency_mask
        ? "Emergency stop"
        : nav.state === "MOVE"
          ? "Moving"
          : nice(nav.state),
  );
  setText("safety-detail", nice(nav.reason));
  setText(
    "gnss",
    stale
      ? "Waiting for current data"
      : state.localization_fault
        ? nice(state.localization_fault)
        : "Position available",
  );
  setText(
    "gnss-detail",
    state.gnss?.fix_available
      ? `${state.gnss.simulated ? "Virtual Waveshare" : "Waveshare"}: lat ${state.gnss.latitude.toFixed(6)}, lon ${state.gnss.longitude.toFixed(6)} · fix ${state.gnss.fix_age_s.toFixed(1)} s old`
      : mission.pose
        ? `Fix age ${state.modem.fix_age_s.toFixed(1)} s · ±${mission.pose.uncertainty_m.toFixed(2)} m${state.simulation ? " (test fixture)" : ""}`
        : state.simulation
          ? "Waiting for the virtual GPS antenna"
          : "Waiting for the Waveshare GNSS fix",
  );
  setText(
    "cellular",
    state.preview
      ? "Preview only"
      : state.faults.cellular_offline
        ? "Offline"
        : state.connection_ok
          ? "App link available"
          : "Waiting for app link",
  );
  setText(
    "cellular-detail",
    state.simulation
      ? `SIM7600G-H fixture · ${Math.round(state.modem.cellular_latency_s * 1000)} ms command delay`
      : "Waveshare modem · Raspberry Pi OS network",
  );
  setText(
    "fps",
    state.preview
      ? "NO CAMERA"
      : state.simulation
        ? `${Math.round(state.performance?.video_fps || 0)} FPS · WEBOTS`
        : "PI CAMERA",
  );
  const cameraAlert = state.camera_health?.alert;
  setText(
    "camera-status",
    state.preview
      ? "UI PREVIEW · NO ROBOT"
      : stale
        ? "CAMERA STATUS STALE"
        : cameraAlert
          ? "ALERT · CAMERA BLOCKED"
          : state.simulation
            ? "SIMULATED IMX708 · LIVE"
            : "PI CAMERA · LIVE",
  );
  const events = [...mission.events].reverse().slice(0, 6);
  $("activity").replaceChildren();
  if (!events.length)
    $("activity").textContent = "No deliveries yet. Choose a destination to begin.";
  for (const event of events) {
    const row = document.createElement("div");
    row.className = "event";
    const title = document.createElement("span");
    title.textContent = `${nice(event.action)}${event.checkpoint ? " · Stop " + event.checkpoint : ""}`;
    const time = document.createElement("small");
    time.textContent = `${event.time_s.toFixed(1)} s simulation time`;
    row.append(title, time);
    $("activity").append(row);
  }
  testControls?.renderTests(state);
  for (const receipt of state.receipts || []) {
    if (receipt.request_id === lastReceipt) {
      if (receipt.status === "rejected") setText("notice", receipt.error);
      else if (receipt.status === "accepted")
        setText("notice", "Command accepted by the robot.");
    }
  }
  renderControls();
}
// One unique ID per intentional click. Do not automatically retry a dispatch
// after a connection loss, which could create an unintended later trip.
async function command(action) {
  try {
    const request_id = crypto.randomUUID();
    lastReceipt = request_id;
    const result = await post({
      schema_version: 1,
      request_id,
      action,
      ...(action === "dispatch" ? { checkpoint: selected } : {}),
    });
    setText(
      "notice",
      result.status === "queued"
        ? "Sending over the simulated 4G link…"
        : "Command received.",
    );
  } catch (e) {
    setText("notice", e.message);
  }
}
// Keep at most one status poll in flight. HTTP failures disable motion controls
// and the Pi's independent heartbeat timeout holds the current mission.
async function poll() {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw Error("Robot connection unavailable");
    state = await response.json();
    if (typeof state.server_time_ms === "number")
      serverClockOffset = state.server_time_ms - Date.now();
    if (state.website_test_controls_allowed && !testControls) {
      const extension = await import("/test-controls.js");
      extension.initializeTestControls(post, poll, () => state);
      testControls = extension;
    }
    render();
  } catch (e) {
    $("connection").classList.remove("online");
    $("connection").lastElementChild.textContent = "Robot offline";
    setText("camera-status", "OFFLINE · connect the robot API");
    $("dispatch").disabled = true;
    $("pause").disabled = true;
    $("cancel").disabled = true;
  } finally {
    pollBusy = false;
  }
}
// Bootstrap the local session, synchronize command timestamps, then attach UI
// handlers. The physical server rejects test_fault and the test tab is hidden.
async function init() {
  try {
    const started = Date.now();
    let session;
    [map, session] = await Promise.all([
      fetch("/api/map").then((r) => r.json()),
      fetch("/api/session").then((r) => r.json()),
    ]);
    token = session.token;
    serverClockOffset = session.server_time_ms - (started + Date.now()) / 2;
    buildMap();
    const parts = await fetch("/api/parts").then((r) => r.json());
    for (const part of parts) {
      const row = document.createElement("tr");
      for (const key of ["name", "quantity", "test"]) {
        const cell = document.createElement("td");
        cell.textContent = part[key];
        row.append(cell);
      }
      const cell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `coverage ${part.kind}`;
      badge.textContent = part.coverage;
      cell.append(badge);
      row.append(cell);
      $("parts").append(row);
    }
    $("destination").addEventListener("change", (e) => choose(e.target.value));
    $("dispatch").addEventListener("click", () => command("dispatch"));
    $("pause").addEventListener("click", () =>
      command(state?.mission?.state === "paused" ? "resume" : "pause"),
    );
    $("cancel").addEventListener("click", () => command("cancel"));
    $("fit-map").addEventListener("click", () => choose(""));
    document.querySelectorAll(".tab").forEach((button) =>
      button.addEventListener("click", () => {
        document
          .querySelectorAll(".tab")
          .forEach((b) => b.classList.toggle("active", b === button));
        document
          .querySelectorAll(".tab-panel")
          .forEach((p) => p.classList.toggle("hidden", p.id !== button.dataset.tab));
      }),
    );
    await post({ action: "heartbeat" }).catch(() => {});
    await poll();
    setInterval(poll, 400);
    setInterval(() => post({ action: "heartbeat" }).catch(() => {}), 700);
    // Image polling is independent of JSON control. No frames or commands queue.
    let nextImage;
    function refreshFrame() {
      clearTimeout(nextImage);
      nextImage = setTimeout(() => {
        if (state?.preview) refreshFrame();
        else $("camera").src = `${cameraBaseUrl}/frame.jpg?t=${Date.now()}`;
      }, 100);
    }
    $("camera").addEventListener("load", () => {
      videoLoaded = true;
      refreshFrame();
    });
    $("camera").addEventListener("error", () => {
      videoLoaded = false;
      clearTimeout(nextImage);
      nextImage = setTimeout(refreshFrame, 1200);
    });
    refreshFrame();
  } catch (e) {
    setText("notice", `Could not initialize the app: ${e.message}`);
  }
}
init();
