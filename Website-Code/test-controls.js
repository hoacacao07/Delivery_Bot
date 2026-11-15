/* Laptop-only fixture UI. Excluded from Pi/ESP32 component transfers.
   This changes test inputs; it never sends raw wheel commands. */
const $ = (id) => document.getElementById(id);
const faultInfo = [
  [
    "cellular_offline",
    "4G connection lost",
    "Drop the Waveshare/LTE app link. The robot holds safely and old queued commands expire.",
  ],
  [
    "gnss_lost",
    "GPS fix lost",
    "Stop new GNSS fixes. Wheel/IMU estimates continue, but an old position fix cannot authorize travel.",
  ],
  [
    "gnss_uncertain",
    "GPS uncertainty: 3 m",
    "Use a less accurate GPS fix. The route stops when uncertainty exceeds the allowed path margin.",
  ],
  [
    "esp_link_lost",
    "Pi ↔ ESP32 link lost",
    "Interrupt bidirectional serial communication. The ESP32 command watchdog must stop its outputs.",
  ],
  [
    "camera_blocked",
    "Camera covered",
    "Cover the rendered camera image. The actual camera-health logic must identify the obstruction.",
  ],
  [
    "power_loss",
    "Power supply interrupted",
    "Cut the virtual drive supply and Pi command flow. This is a loss-of-power fixture, not an electrical battery model.",
  ],
];

// Build the optional test cards once. The robot API independently rejects
// these fault messages in physical mode; hidden UI is not an authorization gate.
export function initializeTestControls(post, poll, getState) {
  for (const [fault, title, description] of faultInfo) {
    const card = document.createElement("article");
    card.id = "fault-" + fault;
    card.className = "panel fault-card";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const detail = document.createElement("p");
    detail.textContent = description;
    const button = document.createElement("button");
    button.className = "secondary";
    button.textContent = "Activate test";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await post({
          action: "test_fault",
          fault,
          enabled: !getState()?.faults[fault],
        });
        await poll();
      } catch (e) {
        // This is an independent module: use its own DOM helper for feedback.
        $("notice").textContent = e.message;
      } finally {
        button.disabled = false;
      }
    });
    card.append(heading, detail, button);
    $("faults").append(card);
  }
}

// Show acknowledged fault state from telemetry rather than assuming a click worked.
export function renderTests(state) {
  for (const [fault] of faultInfo) {
    const card = $("fault-" + fault),
      enabled = state.faults[fault];
    card.classList.toggle("active", enabled);
    card.querySelector("button").textContent = enabled
      ? "Restore normal condition"
      : "Activate test";
    card.querySelector("button").setAttribute("aria-pressed", String(enabled));
  }
}
