/* Local dashboard code using browser APIs; no third-party UI framework.
 * File/source map: docs/CODE_SOURCES.md in the Pi package.
 * This page reads observations; it has no endpoint that sends wheel commands. */
/* Browser presentation only: recognition and distance calculations live in Python. */
const REFRESH_INTERVAL_MS = 250;
const PREVIEW_INTERVAL_MS = 30;
const STALE_AFTER_MS = 5000;
let previewEnabled = false;
const element = (id) => document.getElementById(id);

// Update visible text only when it changes, avoiding unnecessary page redraws.
function setText(id, value) {
  if (element(id).textContent !== String(value)) element(id).textContent = value;
}

// Create a text-only element; never interpret detection labels as HTML.
function createText(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

// Display stream health; this status does not grant motor permission.
function showConnection(connected, message) {
  setText('connectionStatus', message);
  element('connectionStatus').classList.toggle('disconnected', !connected);
}

// Group current observations, then show estimates and navigation relevance below the camera.
function showDetectionCards(detections, classes, assessments = []) {
  const counts = element('classCounts');
  counts.replaceChildren();
  counts.append(createText('span', `${classes.length} outdoor categories enabled`));
  const mobileCount = detections.filter((item) => item.motion_group === 'potentially_dynamic').length;
  const staticCount = detections.filter((item) => item.motion_group === 'usually_static').length;
  counts.append(createText('span', `Could move: ${mobileCount}`), createText('span', `Usually stationary: ${staticCount}`), createText('span', `Detailed tracking: ${detections.filter(d => d.tracking_active !== false).length}`));
  for (const label of classes) {
    const count = detections.filter((item) => item.label === label).length;
    if (!count) continue; // Do not crowd the panel with dozens of zero counts.
    const displayName = {
      person: 'People',
      car: 'Cars',
      tree: 'Trees'
    } [label] || label;
    counts.append(createText('span', `${displayName}  ${count}`));
  }
  const container = element('detectionCards');
  // Preserve expanded explanations while new frames arrive.
  const expanded = new Set([...container.querySelectorAll('article')]
    .filter((card) => card.querySelector('details')?.open)
    .map((card) => card.dataset.key));
  container.replaceChildren();
  if (!detections.length) {
    const empty = createText('div', '', 'empty-state');
    empty.append(createText('span', '◎'), createText('h3', 'No target objects in view'),
      createText('p', 'Point the camera toward a target object. Recognized objects appear here.'));
    container.append(empty);
    return;
  }
  const groupContainers = {};
  for (const [key, title] of [['potentially_dynamic', 'Could move'], ['usually_static', 'Usually stationary']]) {
    const count = detections.filter((item) => item.motion_group === key).length;
    if (!count) continue;
    const group = createText('section', '', 'mobility-section');
    group.append(createText('h3', `${title} · ${count}`, 'mobility-heading'));
    container.append(group);
    groupContainers[key] = group;
  }
  detections.forEach((item, index) => {
    const card = createText('article', '', 'object-card');
    const assessment = assessments.find(a => (item.motion?.track_id != null
      ? a.track_id === item.motion.track_id : a.observation_index === index) && a.label === item.label);
    const relevance = assessment?.status || item.navigation_relevance;
    const explanations = {outside_monitoring_distance:'Outside monitoring distance; detailed tracking paused',
      outside_monitoring_corridor:'Away from the monitored corridor; detailed tracking paused',
      outside_path:'Outside the forward corridor', ahead_distant:'Ahead, outside the stop zone',
      slow_zone:'Near the path; slowing', stop_zone:'Inside stopping clearance',
      predicted_path_collision:'May enter the path soon', distance_uncertain:'Distance uncertain'};
    card.dataset.navigationRisk = relevance || 'unknown';
    card.dataset.motionGroup = item.motion_group || 'unknown';
    card.dataset.key = `${item.label}-${index}`;
    const heading = document.createElement('header');
    heading.append(createText('h3', item.label),
      createText('span', item.observation_status === 'prediction_only' ? 'Predicted track · no fresh detection' : `${Math.round(item.confidence * 100)}% confidence`, 'confidence'));
    const distance = item.tracking_active === false ? 'Not actively ranged' : item.distance_m === null ? 'Distance unavailable' : `≈ ${item.distance_m.toFixed(1)} m`;
    const motion = item.motion || {};
    const speed = item.tracking_active === false ? 'Detailed tracking paused' : Number.isFinite(motion.object_speed_mps) ? `~${motion.object_speed_mps.toFixed(2)} m/s estimated` :
      Number.isFinite(motion.image_speed_px_s) ? `${motion.image_speed_px_s.toFixed(0)} px/s; metric speed unknown` : 'Collecting motion history';
    const arrival = item.tracking_active === false ? 'Outside current monitoring region' : Number.isFinite(motion.front_zone_entry_s) ? (motion.front_zone_entry_s === 0 ? 'Already in front zone' : `Front-zone arrival ~${motion.front_zone_entry_s.toFixed(1)} s`) : 'Front-zone arrival unknown';
    const notes = document.createElement('details');
    notes.open = expanded.has(card.dataset.key);
    notes.append(createText('summary', 'Why this distance?'), createText('p', item.distance_note));
    card.append(heading, createText('p', explanations[relevance] || 'Observation; not automatically a hazard', 'navigation-note'), createText('p', distance, 'object-distance'),
      createText('p', `${item.horizontal_position} of image · ${item.object_category || 'Outdoor object'}`, 'object-position'),
      createText('p', `Track #${motion.track_id ?? '?'} · ${speed}`, 'object-position'), createText('p', arrival, 'object-position'), notes);
    (groupContainers[item.motion_group] || container).append(card);
  });
}

// Explain the active scale assumptions so unavailable/approximate distance is not presented as a measurement.
function showDistanceGuide(frame) {
  const mode = frame.distance_mode || 'size';
  const settings = frame.distance_assumptions || {};
  const calibrated = Boolean(settings.focal_calibration?.focal_px);
  setText('distanceMode', {
    size: 'Object size',
    ground: 'Ground plane',
    off: 'Off'
  } [mode] || mode);
  setText('calibrationStatus', calibrated ? 'Focal length calibrated' : 'Camera calibration needed');
  setText('distanceModeTag', `${mode.toUpperCase()} MODE`);
  const descriptions = {
    size: ['A rough estimate from object size', 'The image height of a fully visible object is compared with its assumed real height. Partial bodies, unusual sizes and camera tilt can make this inaccurate. Trees have no default size.'],
    ground: ['An estimate from the ground plane', 'Uses camera height, downward angle and the visible base of the object. Level ground is assumed. Occluded feet, hidden tree bases and uneven ground can invalidate the estimate.'],
    off: ['Distance estimation is switched off', 'Objects are still recognized, but this session does not calculate distances.']
  };
  const [title, description] = descriptions[mode] || descriptions.size;
  setText('distanceTitle', title);
  setText('distanceExplanation', description);
  const heights = Object.entries(settings.assumed_object_heights_m || {}).map(([label, height]) => `${label}: ${height} m`);
  setText('sizeAssumptions', mode === 'size' ? `Assumed height → ${heights.join(' / ')}` :
    mode === 'ground' ? `Camera height: ${settings.camera_height_m ?? 'not set'} m / Tilt: ${settings.camera_downward_tilt_degrees ?? 'not set'}°` : '');
}


// Commands and wheel feedback are separate: a MOVE request does not establish
// movement, and zero mean speed can still mean opposite-side pivoting.
function showRobotStatus(navigation, offline = false) {
  const panel = element('robotStatus');
  if (!navigation || offline) {
    panel.dataset.motion = 'unknown';
    setText('robotMovement', offline ? 'Status unavailable' : 'Detection only');
    setText('robotCommand', 'Command unavailable');
    setText('robotWheelSpeed', 'Wheel feedback unavailable');
    setText('robotReason', offline ? 'Waiting for fresh robot data' : 'No robot controller connected');
    return;
  }
  const nav = navigation;
  const commands = {STOP: 'Stop requested', MOVE: 'Move requested', SLOW: 'Slow movement requested',
                    TURN_LEFT: 'Left turn requested', TURN_RIGHT: 'Right turn requested'};
  setText('robotCommand', nav.motors_enabled === false ? 'Motor commands disabled' : (commands[nav.state] || 'Command unavailable'));
  setText('robotReason', (nav.reason || 'Reason unavailable').replaceAll('_', ' '));
  const left = nav.estimated_left_speed_mps, right = nav.estimated_right_speed_mps;
  const fresh = nav.telemetry_fresh && Number.isFinite(left) && Number.isFinite(right);
  const photoFeedback = nav.odometry_source === 'photo_inferred_direction';
  let label = 'Movement unknown', mode = 'unknown';
  if (fresh) {
    setText('robotWheelSpeed', `${photoFeedback ? 'Wheel feedback' : 'Command-based estimate'}: L ${left.toFixed(2)} / R ${right.toFixed(2)} m/s`);
    if (!photoFeedback) {
      label = 'Movement unverified';
    } else if (Math.max(Math.abs(left), Math.abs(right)) > 0.02) {
      label = nav.state === 'STOP' ? 'Braking' : left * right < 0 ? 'Turning' : 'Moving';
      mode = nav.state === 'STOP' ? 'braking' : 'moving';
    } else {
      const starting = nav.state !== 'STOP' && nav.motors_enabled !== false
        && Math.max(Math.abs(nav.applied_left_mps || 0), Math.abs(nav.applied_right_mps || 0)) > 0.02;
      label = starting ? 'Starting' : 'Stopped';
      mode = starting ? 'starting' : 'stopped';
    }
  } else {
    setText('robotWheelSpeed', 'Wheel feedback unavailable or stale');
  }
  if (nav.esp32_emergency_mask) {
    label = fresh && Math.max(Math.abs(left), Math.abs(right)) > 0.02 ? 'Emergency braking' : 'Emergency stop';
    mode = 'stopped';
  }
  panel.dataset.motion = mode;
  setText('robotMovement', label);
}

// Remove old images and readings when the stream is stale; a frozen picture must not appear live.
function clearStaleDisplay(message) {
  showRobotStatus(null, true);
  previewEnabled = false;
  showConnection(false, 'Camera offline');
  element('cameraPreview').hidden = true;
  element('cameraPreview').removeAttribute('src');
  element('cameraPlaceholder').hidden = false;
  setText('cameraPlaceholder', message);
  for (const id of ['objectCount', 'nearestDistance', 'analysisTime']) setText(id, '—');
  setText('objectBadge', '—');
  setText('rawOutput', 'No current observations.');
  setText('lastUpdate', 'Waiting for camera');
  element('classCounts').replaceChildren();
  const empty = createText('div', '', 'empty-state');
  empty.append(createText('span', '◎'), createText('h3', 'Waiting for the camera'), createText('p', message));
  element('detectionCards').replaceChildren(empty);
}

// Poll metadata after the previous request completes; keep an offline page recoverable.
async function refreshDetections() {
  try {
    const response = await fetch('/api/detections', {
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('Detector unavailable');
    const frame = await response.json();
    showDistanceGuide(frame);
    if (!frame.camera_active || Date.now() - Date.parse(frame.timestamp_utc) > STALE_AFTER_MS) {
      throw new Error('No fresh camera observations');
    }
    showRobotStatus(frame.navigation);
    if (frame.camera_health?.alert) showConnection(false, 'Camera view unusable');
    else showConnection(true, 'Camera live');
    const detections = frame.detections || [];
    setText('objectCount', detections.length);
    setText('objectBadge', detections.length);
    const ranges = detections.map((item) => item.distance_m).filter(Number.isFinite);
    setText('nearestDistance', ranges.length ? `≈ ${Math.min(...ranges).toFixed(1)} m` : '—');
    setText('analysisTime', `${Math.round(frame.inference_ms)} ms`);
    if (element('streamRates')) setText('streamRates', frame.performance ? `${frame.performance.video_fps} video / ${frame.performance.detection_fps} detection FPS` : 'Per processed frame');
    setText('resolution', `${frame.image_width} × ${frame.image_height}`);
    setText('cameraDetails', `${frame.source?.startsWith('webots') ? 'Webots camera' : 'Webcam'} · ${frame.image_width} × ${frame.image_height}`);
    setText('classDetails', `${(frame.classes || []).length} outdoor categories`);
    setText('frameNumber', `Frame ${frame.frame_id.toLocaleString()}`);
    setText('lastUpdate', `Updated ${new Date(frame.timestamp_utc).toLocaleTimeString()}`);
    showDetectionCards(detections, frame.classes || [], frame.navigation?.object_assessments || []);
    setText('rawOutput', JSON.stringify(frame, null, 2));
    previewEnabled = true;
  } catch (error) {
    clearStaleDisplay('Turn on your webcam and start the detector when you are ready.');
  }
  // Wait for completion before scheduling another poll; never queue requests.
  setTimeout(refreshDetections, REFRESH_INTERVAL_MS);
}
refreshDetections();

// Preview updates independently of slower text/card updates. Never queue image
// requests: wait for each image to load before fetching another. This removes
// the old 2.5 FPS display cap without claiming extra model detections.
async function refreshPreview() {
  if (previewEnabled) {
    const next = new Image();
    const loaded = await new Promise((resolve) => {
      next.onload = () => resolve(true);
      next.onerror = () => resolve(false);
      next.src = `/frame.jpg?t=${Date.now()}`;
    });
    if (loaded && previewEnabled) {
      // Match the delivered frame; Webots uses the native camera aspect ratio.
      // A CSS variable lets expanded mode choose a viewport-sized surface.
      element('cameraPreview').parentElement.style.setProperty(
        '--camera-aspect', `${next.naturalWidth} / ${next.naturalHeight}`);
      element('cameraPreview').src = next.src;
      element('cameraPreview').hidden = false;
      element('cameraPlaceholder').hidden = true;
    }
  }
  setTimeout(refreshPreview, PREVIEW_INTERVAL_MS);
}
refreshPreview();


// Local layout toggle only: stream requests and robot control keep running.
function setCameraFocus(expanded) {
  document.body.classList.toggle('camera-focused', expanded);
  element('cameraFocus').setAttribute('aria-pressed', String(expanded));
  element('cameraFocus').textContent = expanded ? 'Restore dashboard' : 'Expand camera';
  if (expanded) window.scrollTo({ top: 0, behavior: 'instant' });
}
element('cameraFocus').addEventListener('click', () => {
  setCameraFocus(!document.body.classList.contains('camera-focused'));
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('camera-focused')) {
    setCameraFocus(false);
    element('cameraFocus').focus();
  }
});
