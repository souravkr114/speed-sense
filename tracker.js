// ================= SPEED TRACKER CORE ENGINE =================

// DOM Elements
const sourceVideo = document.getElementById('sourceVideo');
const videoCanvas = document.getElementById('videoCanvas');
const ctx = videoCanvas.getContext('2d', { willReadFrequently: true });
const graphCanvas = document.getElementById('graphCanvas');
const gCtx = graphCanvas.getContext('2d');

const btnWebcam = document.getElementById('btnWebcam');
const btnUpload = document.getElementById('btnUpload');
const videoFile = document.getElementById('videoFile');
const cameraSelect = document.getElementById('cameraSelect');
const cameraSelectContainer = document.getElementById('cameraSelectContainer');

const btnCalib = document.getElementById('btnCalib');
const calibDistance = document.getElementById('calibDistance');
const calibStatus = document.getElementById('calibStatus');

const trackerType = document.getElementById('trackerType');
const speedUnit = document.getElementById('speedUnit');
const sliderSmooth = document.getElementById('sliderSmooth');
const smoothVal = document.getElementById('smoothVal');
const btnReset = document.getElementById('btnReset');

const valSpeed = document.getElementById('valSpeed');
const valMaxSpeed = document.getElementById('valMaxSpeed');
const valScale = document.getElementById('valScale');
const lblUnit1 = document.getElementById('lblUnit1');
const lblUnit2 = document.getElementById('lblUnit2');

const btnPlayPause = document.getElementById('btnPlayPause');
const btnStepFrame = document.getElementById('btnStepFrame');
const sliderTimeline = document.getElementById('sliderTimeline');
const timeCurrent = document.getElementById('timeCurrent');
const timeTotal = document.getElementById('timeTotal');
const dropZone = document.getElementById('dropZone');

// State Variables
let isPlaying = false;
let isWebcam = false;
let stream = null;
let currentFrameTime = 0;
let lastFrameTime = 0;
let animationFrameId = null;

// Scale and Coordinates mapping
let displayScale = 1.0;
let canvasOffsetX = 0;
let canvasOffsetY = 0;

// Calibration variables
let calibStartReal = null; // Original video scale
let calibEndReal = null;
let metersPerPixel = 0.005; // Default: 1px = 5mm (200px/m)

// Tracking states
let trackingMode = "Color"; // "Color" or "Box"
let isTracking = false;
let trackedBox = null; // {x, y, w, h} in original video coordinates
let lastTrackedPos = null; // {x, y} center in original video coordinates
let lastTrackedTime = 0;
let trail = []; // Array of {x, y, speed}
let speedHistory = []; // Historical speeds for graph
let currentSpeed = 0;
let maxSpeed = 0;
let displayedSpeed = 0;
let lastUIUpdateTime = 0;

// Interaction modes: "none", "calibrating", "selecting_box"
let interactionState = "none";
let dragStart = null;
let currentDrag = null;

// Color tracker variables
let targetHSV = null; // {h, s, v}
let hsvTolerance = { h: 15, s: 60, v: 60 };

// Template box tracker variables
let templateData = null; // ImageData object of template

// ================= INITIALIZATION & LISTENERS =================

window.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    resizeGraphCanvas();
    drawGraphPlaceholder();
    
    // Set initial display
    updateCalibUI();
});

window.addEventListener('resize', () => {
    resizeGraphCanvas();
    drawGraphPlaceholder();
});

function setupEventListeners() {
    // Source Controls
    btnWebcam.addEventListener('click', toggleWebcam);
    btnUpload.addEventListener('click', () => videoFile.click());
    videoFile.addEventListener('change', loadVideoFile);
    cameraSelect.addEventListener('change', startWebcamStream);

    // Timeline Drag & Drop
    window.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('active'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('active'));
    dropZone.addEventListener('drop', handleDrop);

    // Calibration
    btnCalib.addEventListener('click', enterCalibrationMode);
    calibDistance.addEventListener('input', updateCalibrationRatio);

    // Settings
    trackerType.addEventListener('change', (e) => {
        trackingMode = e.target.value;
        resetTrackingStats();
        updateSelectionButtonText();
    });
    speedUnit.addEventListener('change', changeSpeedUnit);
    sliderSmooth.addEventListener('input', (e) => {
        smoothVal.textContent = parseFloat(e.target.value).toFixed(2);
    });
    btnReset.addEventListener('click', resetTrackingStats);

    // Playback
    btnPlayPause.addEventListener('click', togglePlayPause);
    btnStepFrame.addEventListener('click', stepOneFrame);
    sliderTimeline.addEventListener('input', seekVideo);

    // Canvas Interactions
    videoCanvas.addEventListener('mousedown', onMouseDown);
    videoCanvas.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    videoCanvas.addEventListener('dblclick', onDoubleClick);

    // Touch support for mobile devices
    videoCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
    videoCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
    videoCanvas.addEventListener('touchend', onTouchEnd, { passive: false });

    // Video Events
    sourceVideo.addEventListener('loadedmetadata', onVideoLoaded);
    sourceVideo.addEventListener('timeupdate', updateTimeline);
}

// ================= CAMERA & VIDEO LOADING =================

async function toggleWebcam() {
    if (isWebcam) {
        stopWebcamStream();
        isWebcam = false;
        btnWebcam.textContent = "📷 Start Camera";
        btnWebcam.classList.remove('btn-success');
        btnWebcam.classList.add('btn-primary');
        cameraSelectContainer.style.display = 'none';
    } else {
        isWebcam = true;
        btnWebcam.textContent = "🟢 Live Active";
        btnWebcam.classList.remove('btn-primary');
        btnWebcam.classList.add('btn-success');
        await enumerateCameras();
        await startWebcamStream();
    }
}

async function enumerateCameras() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        
        cameraSelect.innerHTML = '';
        videoDevices.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Camera ${index + 1}`;
            cameraSelect.appendChild(option);
        });

        if (videoDevices.length > 1) {
            cameraSelectContainer.style.display = 'flex';
        }
    } catch (err) {
        console.error("Error listing cameras: ", err);
    }
}

async function startWebcamStream() {
    stopWebcamStream();
    resetTrackingStats();

    const deviceId = cameraSelect.value;
    const constraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true
    };

    try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        sourceVideo.srcObject = stream;
        sourceVideo.play();
        isPlaying = true;
        btnPlayPause.textContent = "⏸ Pause";
        sliderTimeline.disabled = true;
    } catch (err) {
        console.error("Error accessing webcam: ", err);
        alert("Could not access camera. Please check permissions.");
        toggleWebcam(); // Toggle back
    }
}

function stopWebcamStream() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    sourceVideo.srcObject = null;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    isPlaying = false;
    btnPlayPause.textContent = "▶ Play";
}

function loadVideoFile(e) {
    const file = e.target.files[0];
    if (file) {
        loadVideoSource(file);
    }
}

function handleDrop(e) {
    e.preventDefault();
    dropZone.classList.remove('active');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
        loadVideoSource(file);
    }
}

function loadVideoSource(file) {
    stopWebcamStream();
    isWebcam = false;
    btnWebcam.textContent = "📷 Start Camera";
    btnWebcam.classList.remove('btn-success');
    btnWebcam.classList.add('btn-primary');
    cameraSelectContainer.style.display = 'none';

    resetTrackingStats();

    const url = URL.createObjectURL(file);
    sourceVideo.src = url;
    sourceVideo.load();
}

function onVideoLoaded() {
    // Setup canvas size
    videoCanvas.width = sourceVideo.videoWidth;
    videoCanvas.height = sourceVideo.videoHeight;
    
    // Draw first frame
    setTimeout(() => {
        drawFrame();
        sliderTimeline.disabled = false;
        sliderTimeline.max = sourceVideo.duration;
        sliderTimeline.value = 0;
        timeTotal.textContent = formatTime(sourceVideo.duration);
    }, 100);
}

// ================= PLAYBACK CONTROLS =================

function togglePlayPause() {
    if (!sourceVideo.src && !sourceVideo.srcObject) return;
    
    if (isPlaying) {
        sourceVideo.pause();
        isPlaying = false;
        btnPlayPause.textContent = "▶ Play";
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    } else {
        sourceVideo.play();
        isPlaying = true;
        btnPlayPause.textContent = "⏸ Pause";
        lastFrameTime = performance.now();
        animationFrameId = requestAnimationFrame(processLoop);
    }
}

function stepOneFrame() {
    if (!sourceVideo.src || isWebcam) return;
    isPlaying = false;
    btnPlayPause.textContent = "▶ Play";
    
    // Step forward 1 frame (approx 1/30 seconds)
    sourceVideo.currentTime += 1/30;
    setTimeout(drawFrame, 50);
}

function seekVideo() {
    if (isWebcam) return;
    sourceVideo.currentTime = sliderTimeline.value;
    setTimeout(drawFrame, 50);
}

function updateTimeline() {
    if (isWebcam) return;
    sliderTimeline.value = sourceVideo.currentTime;
    timeCurrent.textContent = formatTime(sourceVideo.currentTime);
}

// ================= RENDERING LOOP =================

function processLoop() {
    if (!isPlaying) return;
    drawFrame();
    animationFrameId = requestAnimationFrame(processLoop);
}

function drawFrame() {
    if (sourceVideo.readyState < 2) return; // Wait for metadata

    const vWidth = sourceVideo.videoWidth;
    const vHeight = sourceVideo.videoHeight;

    // Check sizes
    if (videoCanvas.width !== vWidth || videoCanvas.height !== vHeight) {
        videoCanvas.width = vWidth;
        videoCanvas.height = vHeight;
    }

    // 1. Draw raw video frame to screen
    ctx.drawImage(sourceVideo, 0, 0, vWidth, vHeight);

    // Compute display scaling ratios (useful for mouse coordinates mapping)
    const cw = videoCanvas.clientWidth;
    const ch = videoCanvas.clientHeight;
    displayScale = Math.min(cw / vWidth, ch / vHeight);
    
    const dw = vWidth * displayScale;
    const dh = vHeight * displayScale;
    canvasOffsetX = (cw - dw) / 2;
    canvasOffsetY = (ch - dh) / 2;

    // 2. Perform object tracking calculation
    if (isTracking) {
        processTracking();
    }

    // 3. Draw Overlays (Box, Trail, Calibration line)
    drawTrackingOverlays();
}

// ================= GESTURES & INTERACTION =================

function enterCalibrationMode() {
    if (sourceVideo.readyState < 2) {
        alert("Please load a video or start camera first.");
        return;
    }
    
    // Pause video
    if (isPlaying) togglePlayPause();

    interactionState = "calibrating";
    videoCanvas.style.cursor = "crosshair";
    btnCalib.textContent = "📏 Drag Line on Video...";
    btnCalib.style.backgroundColor = "#d97706"; // Amber indicating active state
    
    // Restore tracking button UI text
    updateSelectionButtonText();
}

function enterObjectSelection() {
    if (sourceVideo.readyState < 2) return;
    if (isPlaying) togglePlayPause();

    btnCalib.textContent = "📏 Draw Calibration Line";
    btnCalib.style.backgroundColor = "";

    if (trackingMode === "Box") {
        interactionState = "selecting_box";
        videoCanvas.style.cursor = "nwse-resize";
        btnReset.style.backgroundColor = "";
        btnCalib.style.backgroundColor = "";
    } else {
        interactionState = "selecting_color";
        videoCanvas.style.cursor = "pointer";
    }
}

function updateSelectionButtonText() {
    if (trackingMode === "Color") {
        btnCalib.nextElementSibling.nextElementSibling.firstElementChild.textContent = "🎯 Double-click Video to Track Color";
    } else {
        btnCalib.nextElementSibling.nextElementSibling.firstElementChild.textContent = "🎯 Double-click Video to Draw Box";
    }
    // Reset selection btn color
    document.getElementById('btnReset').previousElementSibling.style.backgroundColor = "";
}

function getCanvasCoords(e) {
    const rect = videoCanvas.getBoundingClientRect();
    // Mouse coords relative to canvas drawing pixels
    const cx = (e.clientX - rect.left) * (videoCanvas.width / rect.width);
    const cy = (e.clientY - rect.top) * (videoCanvas.height / rect.height);
    return { x: cx, y: cy };
}

function onDoubleClick(e) {
    if (sourceVideo.readyState < 2) return;
    
    if (isPlaying) togglePlayPause();
    
    const pos = getCanvasCoords(e);
    
    btnCalib.textContent = "📏 Draw Calibration Line";
    btnCalib.style.backgroundColor = "";

    if (trackingMode === "Color") {
        // Direct Color Lock-on
        const color = samplePixelColor(pos.x, pos.y);
        lockOnColor(color, pos.x, pos.y);
    } else {
        // Toggle Box selection mode
        interactionState = "selecting_box";
        videoCanvas.style.cursor = "crosshair";
        // Update selection button to show feedback
        const selectBtn = document.getElementById('btnReset').previousElementSibling;
        selectBtn.textContent = "🎯 Drag box on video...";
        selectBtn.style.backgroundColor = "#d97706";
    }
}

function onMouseDown(e) {
    if (sourceVideo.readyState < 2) return;
    
    const pos = getCanvasCoords(e);
    dragStart = pos;

    if (interactionState === "calibrating") {
        calibStartReal = pos;
        calibEndReal = null;
    } else if (interactionState === "selecting_box") {
        trackedBox = { x: pos.x, y: pos.y, w: 0, h: 0 };
    }
}

function onMouseMove(e) {
    if (!dragStart || sourceVideo.readyState < 2) return;
    
    const pos = getCanvasCoords(e);
    currentDrag = pos;

    // Draw temporary drag visual
    drawFrame();
    
    if (interactionState === "calibrating") {
        ctx.beginPath();
        ctx.moveTo(dragStart.x, dragStart.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
    } else if (interactionState === "selecting_box") {
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2;
        ctx.strokeRect(dragStart.x, dragStart.y, pos.x - dragStart.x, pos.y - dragStart.y);
    }
}

function onMouseUp(e) {
    if (!dragStart) return;
    
    const pos = getCanvasCoords(e);
    
    if (interactionState === "calibrating") {
        calibEndReal = pos;
        updateCalibrationRatio();
        
        interactionState = "none";
        videoCanvas.style.cursor = "";
        btnCalib.textContent = "📏 Draw Calibration Line";
        btnCalib.style.backgroundColor = "";
        drawFrame();
    } else if (interactionState === "selecting_box") {
        const x_min = Math.min(dragStart.x, pos.x);
        const y_min = Math.min(dragStart.y, pos.y);
        const w = Math.abs(dragStart.x - pos.x);
        const h = Math.abs(dragStart.y - pos.y);

        if (w > 5 && h > 5) {
            trackedBox = { x: x_min, y: y_min, w: w, h: h };
            initializeTemplateBoxTracker();
        } else {
            trackedBox = null;
        }

        interactionState = "none";
        videoCanvas.style.cursor = "";
        const selectBtn = document.getElementById('btnReset').previousElementSibling;
        selectBtn.textContent = "🎯 Box Track Active";
        selectBtn.style.backgroundColor = "#10b981"; // Green
        drawFrame();
    }

    dragStart = null;
    currentDrag = null;
}

// ================= SAMPLING & HSV LOCK =================

function samplePixelColor(cx, cy) {
    // Ensure coordinates within bounds
    const x = Math.max(0, Math.min(Math.floor(cx), videoCanvas.width - 1));
    const y = Math.max(0, Math.min(Math.floor(cy), videoCanvas.height - 1));
    
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    const r = pixel[0];
    const g = pixel[1];
    const b = pixel[2];
    
    return rgbToHsv(r, g, b);
}

function lockOnColor(hsv, cx, cy) {
    targetHSV = hsv;
    
    // Set initial target box around click location
    const w = 24;
    const h = 24;
    trackedBox = { x: cx - w/2, y: cy - h/2, w: w, h: h };
    isTracking = true;

    trail = [];
    lastTrackedPos = { x: cx, y: cy };
    lastTrackedTime = getTimestamp();

    interactionState = "none";
    videoCanvas.style.cursor = "";
    
    const selectBtn = document.getElementById('btnReset').previousElementSibling;
    selectBtn.textContent = "🎯 Color Track Active";
    selectBtn.style.backgroundColor = "#10b981"; // Green
    
    drawFrame();
}

function initializeTemplateBoxTracker() {
    if (!trackedBox) return;

    // Grab pixel data for the template box
    const x = Math.floor(trackedBox.x);
    const y = Math.floor(trackedBox.y);
    const w = Math.floor(trackedBox.w);
    const h = Math.floor(trackedBox.h);

    try {
        templateData = ctx.getImageData(x, y, w, h);
        isTracking = true;
        
        trail = [];
        lastTrackedPos = { x: x + w/2, y: y + h/2 };
        lastTrackedTime = getTimestamp();
    } catch(err) {
        console.error("Error grabbing template:", err);
        isTracking = false;
        trackedBox = null;
    }
}

// ================= TRACKING IMPLEMENTATIONS =================

function processTracking() {
    if (trackingMode === "Color") {
        processColorTracking();
    } else {
        processBoxTemplateTracking();
    }
}

function processColorTracking() {
    if (!targetHSV || !trackedBox) return;

    const vWidth = videoCanvas.width;
    const vHeight = videoCanvas.height;

    // Center coordinates
    const cx = trackedBox.x + trackedBox.w / 2;
    const cy = trackedBox.y + trackedBox.h / 2;

    // 1. Define search window centered on previous center (4.0x size, min 180px)
    const winW = Math.max(trackedBox.w * 4.0, 180);
    const winH = Math.max(trackedBox.h * 4.0, 180);

    const xStart = Math.max(0, Math.floor(cx - winW / 2));
    const yStart = Math.max(0, Math.floor(cy - winH / 2));
    const xEnd = Math.min(vWidth, Math.floor(cx + winW / 2));
    const yEnd = Math.min(vHeight, Math.floor(cy + winH / 2));

    const wCrop = xEnd - xStart;
    const hCrop = yEnd - yStart;

    if (wCrop <= 5 || hCrop <= 5) {
        isTracking = false;
        currentSpeed = 0;
        return;
    }

    // 2. Extract image data for search region
    const searchData = ctx.getImageData(xStart, yStart, wCrop, hCrop);
    const pixels = searchData.data;

    // 3. Score matching pixels
    let sumX = 0;
    let sumY = 0;
    let matchCount = 0;

    const rTol = hsvTolerance.h;
    const sTol = hsvTolerance.s;
    const vTol = hsvTolerance.v;

    // Filter pixels based on target HSV range
    for (let y = 0; y < hCrop; y += 2) { // Step by 2 pixels for speed
        for (let x = 0; x < wCrop; x += 2) {
            const idx = (y * wCrop + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];

            const hsv = rgbToHsv(r, g, b);

            // Calculate Hue difference wrapping around 360 degrees
            let hDiff = Math.abs(hsv.h - targetHSV.h);
            if (hDiff > 180) hDiff = 360 - hDiff;

            if (hDiff <= rTol && 
                hsv.s >= Math.max(0, targetHSV.s - sTol) && hsv.s <= Math.min(100, targetHSV.s + sTol) &&
                hsv.v >= Math.max(0, targetHSV.v - vTol) && hsv.v <= Math.min(100, targetHSV.v + vTol)) {
                
                const origX = xStart + x;
                const origY = yStart + y;

                // Proximity constraint: reject pixels too far from last known center
                const dist = Math.hypot(origX - cx, origY - cy);
                if (dist < Math.max(winW / 2, 80)) {
                    sumX += origX;
                    sumY += origY;
                    matchCount++;
                }
            }
        }
    }

    // 4. Centroid update
    if (matchCount > 10) {
        const newCx = sumX / matchCount;
        const newCy = sumY / matchCount;

        // Size estimate based on square root of match count density
        const newW = Math.max(Math.sqrt(matchCount * 4) * 0.8, 16);
        const newH = newW;

        trackedBox = {
            x: newCx - newW / 2,
            y: newCy - newH / 2,
            w: newW,
            h: newH
        };

        // Speed estimation
        estimateSpeed(newCx, newCy);
    } else {
        isTracking = false;
        currentSpeed = 0;
    }
}

function processBoxTemplateTracking() {
    if (!templateData || !trackedBox) return;

    const vWidth = videoCanvas.width;
    const vHeight = videoCanvas.height;

    // Previous position coordinates
    const prevX = trackedBox.x;
    const prevY = trackedBox.y;
    const tW = templateData.width;
    const tH = templateData.height;

    // 1. Define search range (+-24 pixels)
    const searchRange = 24;
    const xStart = Math.max(0, Math.floor(prevX - searchRange));
    const yStart = Math.max(0, Math.floor(prevY - searchRange));
    const xEnd = Math.min(vWidth - tW, Math.floor(prevX + searchRange));
    const yEnd = Math.min(vHeight - tH, Math.floor(prevY + searchRange));

    const sW = (xEnd - xStart) + tW;
    const sH = (yEnd - yStart) + tH;

    if (sW <= tW || sH <= tH) {
        isTracking = false;
        currentSpeed = 0;
        return;
    }

    // 2. Fetch search region pixel data
    const searchData = ctx.getImageData(xStart, yStart, sW, sH);
    const sPixels = searchData.data;
    const tPixels = templateData.data;

    let bestX = prevX;
    let bestY = prevY;
    let minSSD = Infinity;

    // Step size for speed
    const step = 1;

    // 3. Slide template over search region and compute Sum of Squared Differences (SSD)
    for (let sy = yStart; sy <= yEnd; sy += step) {
        for (let sx = xStart; sx <= xEnd; sx += step) {
            let ssd = 0;
            const roix = sx - xStart;
            const roiy = sy - yStart;

            // Compute pixel discrepancy for every 3rd pixel (quick approximation)
            for (let ty = 0; ty < tH; ty += 2) {
                for (let tx = 0; tx < tW; tx += 2) {
                    const tIdx = (ty * tW + tx) * 4;
                    
                    const sIdx = ((roiy + ty) * sW + (roix + tx)) * 4;

                    const rDiff = tPixels[tIdx] - sPixels[sIdx];
                    const gDiff = tPixels[tIdx + 1] - sPixels[sIdx + 1];
                    const bDiff = tPixels[tIdx + 2] - sPixels[sIdx + 2];

                    ssd += rDiff * rDiff + gDiff * gDiff + bDiff * bDiff;
                }
            }

            // Proximity bias: encourage template to stay near last known coordinate
            const dist = Math.hypot(sx - prevX, sy - prevY);
            ssd += dist * 1.5;

            if (ssd < minSSD) {
                minSSD = ssd;
                bestX = sx;
                bestY = sy;
            }
        }
    }

    // 4. Update box position
    if (minSSD < 4000000) { // Safety threshold check to see if lost
        trackedBox = { x: bestX, y: bestY, w: tW, h: tH };
        const newCx = bestX + tW/2;
        const newCy = bestY + tH/2;
        
        estimateSpeed(newCx, newCy);

        // Update template slowly to adapt to illumination changes
        updateTemplateGradually(bestX, bestY, tW, tH);
    } else {
        isTracking = false;
        currentSpeed = 0;
    }
}

function updateTemplateGradually(bx, by, tw, th) {
    try {
        const freshData = ctx.getImageData(bx, by, tw, th);
        const fPixels = freshData.data;
        const tPixels = templateData.data;
        
        // Blend template: 90% old, 10% new
        for (let i = 0; i < tPixels.length; i += 4) {
            tPixels[i] = Math.round(tPixels[i] * 0.9 + fPixels[i] * 0.1);     // R
            tPixels[i+1] = Math.round(tPixels[i+1] * 0.9 + fPixels[i+1] * 0.1); // G
            tPixels[i+2] = Math.round(tPixels[i+2] * 0.9 + fPixels[i+2] * 0.1); // B
        }
    } catch(e) {}
}

// ================= SPEED & PHYSICS CALCULATION =================

function getTimestamp() {
    if (isWebcam) {
        return performance.now() / 1000;
    } else {
        return sourceVideo.currentTime;
    }
}

function estimateSpeed(cx, cy) {
    if (!lastTrackedPos || metersPerPixel === null) return;

    const tNow = getTimestamp();
    const dt = tNow - lastTrackedTime;

    if (dt <= 0) return;

    // Pixel displacement
    const dx = cx - lastTrackedPos.x;
    const dy = cy - lastTrackedPos.y;
    const distPx = Math.hypot(dx, dy);

    // Distance in meters
    const distM = distPx * metersPerPixel;

    // Velocity in m/s
    const rawSpeedMps = distM / dt;

    // Convert to target unit
    let rawSpeed = rawSpeedMps;
    if (speedUnit.value === "km/h") {
        rawSpeed = rawSpeedMps * 3.6;
    } else if (speedUnit.value === "mph") {
        rawSpeed = rawSpeedMps * 2.23694;
    }

    // Apply exponential moving average smoothing
    const alpha = parseFloat(sliderSmooth.value);
    currentSpeed = alpha * rawSpeed + (1 - alpha) * currentSpeed;

    if (currentSpeed > maxSpeed) {
        maxSpeed = currentSpeed;
    }

    // Record trail positions
    trail.push({ x: cx, y: cy, speed: currentSpeed });
    if (trail.length > 30) trail.shift(); // Keep last 30 positions

    speedHistory.push(currentSpeed);
    if (speedHistory.length > 200) speedHistory.shift();

    lastTrackedPos = { x: cx, y: cy };
    lastTrackedTime = tNow;

    // Update UI numbers at a human-readable rate (every 250ms)
    const now = Date.now();
    if (now - lastUIUpdateTime > 250) {
        displayedSpeed = currentSpeed;
        valSpeed.textContent = displayedSpeed.toFixed(1);
        valMaxSpeed.textContent = maxSpeed.toFixed(1);
        lastUIUpdateTime = now;
    }
    
    // Draw telemetry
    drawTelemetryGraph();
}

function changeSpeedUnit() {
    const oldUnit = speedUnit.value;
    const unit = speedUnit.value;
    lblUnit1.textContent = unit;
    lblUnit2.textContent = unit;

    // Conversion factors
    const rates = {
        "km/h_mph": 0.621371,
        "km/h_m/s": 1/3.6,
        "mph_km/h": 1.60934,
        "mph_m/s": 0.44704,
        "m/s_km/h": 3.6,
        "m/s_mph": 2.23694
    };

    let key = `${oldUnit}_${unit}`;
    let factor = rates[key] || 1.0;

    currentSpeed *= factor;
    maxSpeed *= factor;
    displayedSpeed *= factor;
    speedHistory = speedHistory.map(s => s * factor);
    
    valSpeed.textContent = displayedSpeed.toFixed(1);
    valMaxSpeed.textContent = maxSpeed.toFixed(1);
    drawTelemetryGraph();
}

function updateCalibrationRatio() {
    if (!calibStartReal || !calibEndReal) {
        // Fallback to default
        metersPerPixel = 0.005;
        valScale.textContent = "200.0";
        calibStatus.textContent = "Default Scale (5mm/px)";
        calibStatus.className = "badge badge-warning";
        return;
    }

    const distVal = parseFloat(calibDistance.value);
    if (isNaN(distVal) || distVal <= 0) return;

    const dx = calibEndReal.x - calibStartReal.x;
    const dy = calibEndReal.y - calibStartReal.y;
    const pixelLen = Math.hypot(dx, dy);

    if (pixelLen > 5) {
        metersPerPixel = distVal / pixelLen;
        const pixelsPerMeter = pixelLen / distVal;
        
        valScale.textContent = pixelsPerMeter.toFixed(1);
        calibStatus.textContent = "Calibrated";
        calibStatus.className = "badge badge-success";
    }
}

function updateCalibUI() {
    if (metersPerPixel === 0.005) {
        valScale.textContent = "200.0";
        calibStatus.textContent = "Default Scale (5mm/px)";
        calibStatus.className = "badge badge-warning";
    }
}

function resetTrackingStats() {
    isTracking = false;
    trackedBox = null;
    targetHSV = null;
    templateData = null;
    trail = [];
    speedHistory = [];
    currentSpeed = 0;
    maxSpeed = 0;
    displayedSpeed = 0;
    lastUIUpdateTime = 0;
    lastTrackedPos = null;

    valSpeed.textContent = "0.0";
    valMaxSpeed.textContent = "0.0";
    
    // Clear display
    drawFrame();
    drawTelemetryGraph();
    updateSelectionButtonText();
}

// ================= GRAPH RENDERING =================

function resizeGraphCanvas() {
    const rect = graphCanvas.parentElement.getBoundingClientRect();
    graphCanvas.width = rect.width;
    graphCanvas.height = 100;
}

function drawGraphPlaceholder() {
    const w = graphCanvas.width;
    const h = graphCanvas.height;
    
    gCtx.clearRect(0, 0, w, h);
    
    // Draw Grid outline
    gCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    gCtx.lineWidth = 1;
    gCtx.strokeRect(40, 10, w - 50, h - 25);
    
    // Draw static text
    gCtx.fillStyle = '#6b7280';
    gCtx.font = '9px Inter';
    gCtx.fillText("Waiting for telemetry data...", w/2 - 60, h/2);
}

function drawTelemetryGraph() {
    const w = graphCanvas.width;
    const h = graphCanvas.height;

    gCtx.clearRect(0, 0, w, h);

    const padLeft = 40;
    const padRight = 10;
    const padTop = 10;
    const padBottom = 15;
    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    // Draw grid bounds
    gCtx.strokeStyle = 'rgba(255,255,255,0.06)';
    gCtx.strokeRect(padLeft, padTop, plotW, plotH);

    // Compute bounds
    const yMax = Math.max(maxSpeed * 1.1, 10.0); // Minimum scale ceiling = 10

    // Draw Y ticks
    gCtx.fillStyle = '#9ca3af';
    gCtx.font = '9px JetBrains Mono';
    gCtx.textAlign = 'right';
    gCtx.textBaseline = 'middle';
    
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
        const val = (yMax / steps) * i;
        const y = padTop + plotH - (i * (plotH / steps));
        
        gCtx.strokeStyle = 'rgba(255,255,255,0.03)';
        gCtx.beginPath();
        gCtx.moveTo(padLeft, y);
        gCtx.lineTo(w - padRight, y);
        gCtx.stroke();
        
        gCtx.fillText(val.toFixed(0), padLeft - 6, y);
    }

    // Plot line
    if (speedHistory.length < 2) {
        gCtx.fillStyle = '#6b7280';
        gCtx.textAlign = 'center';
        gCtx.fillText("Waiting for speed data...", w/2, h/2);
        return;
    }

    const maxPoints = 100;
    const history = speedHistory.slice(-maxPoints);
    
    const xStep = plotW / (maxPoints - 1);

    gCtx.beginPath();
    history.forEach((speed, idx) => {
        const x = padLeft + idx * xStep;
        const y = padTop + plotH - (speed / yMax) * plotH;
        if (idx === 0) {
            gCtx.moveTo(x, y);
        } else {
            gCtx.lineTo(x, y);
        }
    });

    gCtx.strokeStyle = '#38bdf8'; // Cyan line
    gCtx.lineWidth = 2;
    gCtx.stroke();

    // Fill area under speed line
    gCtx.lineTo(padLeft + (history.length - 1) * xStep, padTop + plotH);
    gCtx.lineTo(padLeft, padTop + plotH);
    gCtx.closePath();
    const grad = gCtx.createLinearGradient(0, padTop, 0, padTop + plotH);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    gCtx.fillStyle = grad;
    gCtx.fill();
}

// ================= VISUAL OVERLAY DRAWINGS =================

function drawTrackingOverlays() {
    // 1. Draw calibration reference line
    if (calibStartReal && calibEndReal) {
        ctx.strokeStyle = '#60a5fa'; // Blue
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(calibStartReal.x, calibStartReal.y);
        ctx.lineTo(calibEndReal.x, calibEndReal.y);
        ctx.stroke();

        ctx.fillStyle = '#60a5fa';
        ctx.beginPath();
        ctx.arc(calibStartReal.x, calibStartReal.y, 4, 0, Math.PI * 2);
        ctx.arc(calibEndReal.x, calibEndReal.y, 4, 0, Math.PI * 2);
        ctx.fill();

        // Distance text tag
        const midX = (calibStartReal.x + calibEndReal.x) / 2;
        const midY = (calibStartReal.y + calibEndReal.y) / 2 - 8;
        
        ctx.fillStyle = '#0f172a';
        ctx.font = '12px Inter';
        const txt = `${parseFloat(calibDistance.value).toFixed(2)} m`;
        const textWidth = ctx.measureText(txt).width;
        
        ctx.fillRect(midX - textWidth/2 - 4, midY - 11, textWidth + 8, 15);
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 1;
        ctx.strokeRect(midX - textWidth/2 - 4, midY - 11, textWidth + 8, 15);
        
        ctx.fillStyle = '#60a5fa';
        ctx.textAlign = 'center';
        ctx.fillText(txt, midX, midY);
    }

    // 2. Draw Speed Trail Heatmap
    if (trail.length > 1) {
        for (let i = 1; i < trail.length; i++) {
            const p1 = trail[i - 1];
            const p2 = trail[i];

            // Speed color heatmap: Green -> Yellow -> Red
            const speedPct = maxSpeed > 0 ? Math.min(p2.speed / maxSpeed, 1.0) : 0;
            let color = '';
            if (speedPct < 0.5) {
                const r = Math.floor(speedPct * 2 * 255);
                color = `rgb(${r}, 211, 153)`; // Green to Yellow
            } else {
                const g = Math.floor((1.0 - speedPct) * 2 * 211);
                color = `rgb(248, ${g}, 113)`; // Yellow to Red
            }

            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2 + speedPct * 3;
            ctx.lineCap = 'round';
            ctx.stroke();
        }
    }

    // 3. Draw Bounding Box and speed HUD label
    if (isTracking && trackedBox) {
        const x = trackedBox.x;
        const y = trackedBox.y;
        const w = trackedBox.w;
        const h = trackedBox.h;

        // Black outline for contrast
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.strokeRect(x, y, w, h);
        
        // Bounding box neon green
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        // Center dot
        ctx.fillStyle = '#34d399';
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2, 4, 0, Math.PI * 2);
        ctx.fill();

        // Speed Text HUD Tag
        const speedText = `${displayedSpeed.toFixed(1)} ${speedUnit.value}`;
        ctx.font = 'bold 13px Orbitron';
        const txtW = ctx.measureText(speedText).width;

        let tx = x;
        let ty = y - 10;
        if (ty < 15) {
            ty = y + h + 20; // Move below if too close to top
        }

        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(tx - 4, ty - 12, txtW + 8, 17);
        
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx - 4, ty - 12, txtW + 8, 17);

        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.fillText(speedText, tx, ty);
    }
}

// ================= HELPERS & COLOR MATH =================

function rgbToHsv(r, g, b) {
    let rNorm = r / 255;
    let gNorm = g / 255;
    let bNorm = b / 255;

    let max = Math.max(rNorm, gNorm, bNorm);
    let min = Math.min(rNorm, gNorm, bNorm);
    let diff = max - min;

    let h = 0;
    let s = max === 0 ? 0 : (diff / max) * 100;
    let v = max * 100;

    if (diff !== 0) {
        switch (max) {
            case rNorm: h = ((gNorm - bNorm) / diff) % 6; break;
            case gNorm: h = (bNorm - rNorm) / diff + 2; break;
            case bNorm: h = (rNorm - gNorm) / diff + 4; break;
        }
        h = Math.round(h * 60);
        if (h < 0) h += 360;
    }

    return { h, s, v };
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ================= MOBILE TOUCH HANDLING =================

let lastTapTime = 0;

function onTouchStart(e) {
    if (sourceVideo.readyState < 2) return;
    
    // Check for double tap
    const now = Date.now();
    const doubleTapDelay = 300;
    const touch = e.touches[0];
    const rect = videoCanvas.getBoundingClientRect();
    const cx = (touch.clientX - rect.left) * (videoCanvas.width / rect.width);
    const cy = (touch.clientY - rect.top) * (videoCanvas.height / rect.height);
    
    if (now - lastTapTime < doubleTapDelay) {
        // Double tap!
        e.preventDefault(); // Stop default browser zoom/pause gestures
        if (isPlaying) togglePlayPause();
        
        btnCalib.textContent = "📏 Draw Calibration Line";
        btnCalib.style.backgroundColor = "";

        if (trackingMode === "Color") {
            const color = samplePixelColor(cx, cy);
            lockOnColor(color, cx, cy);
        } else {
            interactionState = "selecting_box";
            videoCanvas.style.cursor = "crosshair";
            const selectBtn = document.getElementById('btnReset').previousElementSibling;
            selectBtn.textContent = "🎯 Drag box on video...";
            selectBtn.style.backgroundColor = "#d97706";
        }
        dragStart = null;
    } else {
        // Single tap start (could be start of drag/calibration/box selection)
        dragStart = { x: cx, y: cy };
        
        if (interactionState === "calibrating") {
            e.preventDefault();
            calibStartReal = { x: cx, y: cy };
            calibEndReal = null;
        } else if (interactionState === "selecting_box") {
            e.preventDefault();
            trackedBox = { x: cx, y: cy, w: 0, h: 0 };
        }
    }
    lastTapTime = now;
}

function onTouchMove(e) {
    if (!dragStart || sourceVideo.readyState < 2) return;
    
    const touch = e.touches[0];
    const rect = videoCanvas.getBoundingClientRect();
    const cx = (touch.clientX - rect.left) * (videoCanvas.width / rect.width);
    const cy = (touch.clientY - rect.top) * (videoCanvas.height / rect.height);
    
    currentDrag = { x: cx, y: cy };
    
    if (interactionState === "calibrating" || interactionState === "selecting_box") {
        e.preventDefault(); // Disable touch scrolling only during active draw actions
        drawFrame();
        
        if (interactionState === "calibrating") {
            ctx.beginPath();
            ctx.moveTo(dragStart.x, dragStart.y);
            ctx.lineTo(cx, cy);
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 3;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
        } else if (interactionState === "selecting_box") {
            ctx.strokeStyle = '#34d399';
            ctx.lineWidth = 2;
            ctx.strokeRect(dragStart.x, dragStart.y, cx - dragStart.x, cy - dragStart.y);
        }
    }
}

function onTouchEnd(e) {
    if (!dragStart || sourceVideo.readyState < 2) return;
    
    const touch = e.changedTouches[0];
    const rect = videoCanvas.getBoundingClientRect();
    const cx = (touch.clientX - rect.left) * (videoCanvas.width / rect.width);
    const cy = (touch.clientY - rect.top) * (videoCanvas.height / rect.height);
    
    if (interactionState === "calibrating") {
        e.preventDefault();
        calibEndReal = { x: cx, y: cy };
        updateCalibrationRatio();
        
        interactionState = "none";
        videoCanvas.style.cursor = "";
        btnCalib.textContent = "📏 Draw Calibration Line";
        btnCalib.style.backgroundColor = "";
        drawFrame();
    } else if (interactionState === "selecting_box") {
        e.preventDefault();
        const x_min = Math.min(dragStart.x, cx);
        const y_min = Math.min(dragStart.y, cy);
        const w = Math.abs(dragStart.x - cx);
        const h = Math.abs(dragStart.y - cy);

        if (w > 5 && h > 5) {
            trackedBox = { x: x_min, y: y_min, w: w, h: h };
            initializeTemplateBoxTracker();
        } else {
            trackedBox = null;
        }

        interactionState = "none";
        videoCanvas.style.cursor = "";
        const selectBtn = document.getElementById('btnReset').previousElementSibling;
        selectBtn.textContent = "🎯 Box Track Active";
        selectBtn.style.backgroundColor = "#10b981"; // Green
        drawFrame();
    }
    
    dragStart = null;
    currentDrag = null;
}
