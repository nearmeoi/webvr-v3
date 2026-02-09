import * as THREE from 'three';
import './style.css';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GazeController } from './components/GazeController.js';
import { PanoramaViewer } from './components/PanoramaViewer.js';
import { CardboardModeManager } from './components/CardboardModeManager.js';
import { isIOS, isWebXRSupported, isMobile, isCardboardForced } from './utils/deviceDetection.js';
import { CONFIG } from './config.js';
import { TOUR_DATA } from './data/tourData.js';
import { WebVRHelper } from './utils/WebVRHelper.js';

// Initialize WebVR Polyfill for iOS and other unsupported browsers
// This provides Cardboard-style VR using device orientation
import WebVRPolyfill from 'webvr-polyfill';
const polyfill = new WebVRPolyfill({
    // Cardboard UI settings
    PROVIDE_MOBILE_VRDISPLAY: true,
    // Use cardboard distortion
    CARDBOARD_UI_DISABLED: false,
    // Buffer scale for quality
    BUFFER_SCALE: 0.75,
    // Rotate instruction overlay
    ROTATE_INSTRUCTIONS_DISABLED: false
});
console.log('WebVR Polyfill initialized:', polyfill);

class App {
    constructor() {
        // Device detection
        this.isIOSDevice = isIOS() || isCardboardForced();
        this.isMobileDevice = isMobile();

        // State
        this.currentState = 'welcome';
        this.isVRMode = false;

        // Setup
        this.initRenderer();
        this.initCamera();
        this.initControls();
        this.initCardboardMode();
        this.initScene();
        this.initComponents();
        this.initEventListeners();
        this.initLandingScreen();
        this.initAdminPanel();

        // Start render loop
        this.clock = new THREE.Clock();
        this.renderer.setAnimationLoop(this.render.bind(this));
    }

    // ==================== INITIALIZATION ====================

    initRenderer() {
        this.container = document.createElement('div');
        document.body.appendChild(this.container);

        // Debug Label (Internal)
        this.debugInfo = document.createElement('div');
        Object.assign(this.debugInfo.style, {
            position: 'fixed',
            bottom: '10px',
            left: '10px',
            fontSize: '10px',
            color: 'rgba(255,255,255,0.5)',
            zIndex: '10000',
            pointerEvents: 'none',
            fontFamily: 'monospace',
            display: 'none' // Hidden by default, can be toggled by dev
        });
        document.body.appendChild(this.debugInfo);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            preserveDrawingBuffer: true // Required for screenshot transitions
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        // WebXR support check
        const supportsWebXR = isWebXRSupported();

        // Enable WebXR only for non-iOS devices that support it
        if (!this.isIOSDevice && supportsWebXR) {
            this.renderer.xr.enabled = true;
            document.body.appendChild(VRButton.createButton(this.renderer));
        }

        this.container.appendChild(this.renderer.domElement);
    }

    initCamera() {
        this.camera = new THREE.PerspectiveCamera(
            CONFIG.fov.default,
            window.innerWidth / window.innerHeight,
            0.1,
            100
        );
        this.camera.position.set(0, CONFIG.camera.eyeLevel, CONFIG.camera.zOffset);
    }

    initControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = CONFIG.animation.dampingFactor;
        this.controls.screenSpacePanning = false;
        this.controls.enableZoom = false;
        this.controls.rotateSpeed = CONFIG.animation.rotateSpeed;
        this.controls.target.set(0, CONFIG.camera.eyeLevel, 0);
    }

    initCardboardMode() {
        // iOS MUST use this custom manager because it lacks WebXR Cardboard support
        // Android/Other should use the native VRButton (WebXR) if available
        // Fallback to Cardboard mode for any mobile device without WebXR
        const isForced = isCardboardForced();
        const supportsWebXR = isWebXRSupported();

        // Use Cardboard fallback if:
        // 1. It's an iOS device
        // 2. OR it's forced via URL
        // 3. OR it's a mobile device and NO WebXR support is detected
        const needsFallback = this.isIOSDevice || isForced || (this.isMobileDevice && !supportsWebXR);

        if (!needsFallback) return;

        console.log('Mobile VR Fallback enabled');

        // Try to use WebVR polyfill first (better iOS fullscreen support)
        this.webVRHelper = new WebVRHelper(this.renderer, this.camera, this.scene);
        this.webVRHelper.init().then(success => {
            if (success) {
                console.log('WebVR polyfill initialized successfully!');
                this.webVRHelper.createButton();

                this.webVRHelper.onEnterVR = () => {
                    this.isVRMode = true;
                    if (this.panoramaViewer) this.panoramaViewer.setVRMode(true);
                };

                this.webVRHelper.onExitVR = () => {
                    this.isVRMode = false;
                    if (this.panoramaViewer) this.panoramaViewer.setVRMode(false);
                };
            } else {
                console.log('WebVR not available, using custom stereo effect');
                this.initCustomCardboard();
            }
        }).catch(e => {
            console.error('WebVR init error:', e);
            this.initCustomCardboard();
        });
    }

    initCustomCardboard() {
        this.cardboardManager = new CardboardModeManager(
            this.renderer,
            this.camera,
            this.controls
        );
        this.cardboardManager.init();

        // Sync mode changes with components
        this.cardboardManager.onModeChange = (isVR) => {
            this.isVRMode = isVR; // Sync state
            if (this.panoramaViewer) {
                this.panoramaViewer.setVRMode(isVR);
                // Fix: If in cinematic tour, ensure back button stays hidden when exiting VR
                if (!isVR && this.currentState === 'cinematic-tour') {
                    this.panoramaViewer.setBackButtonVisibility(false);
                }
            }
            if (this.cardboardButton) {
                this.cardboardButton.setVRState(isVR);
            }
        };

        this.cardboardManager.onInteractionModeChange = (mode) => {
            if (this.gazeController) {
                this.gazeController.setInteractionMode(mode);
            }
        };
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.add(this.camera);

        // Gradient background sphere
        this.createGradientBackground();

        // Lighting - Boosted for VR brightness
        const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 10);
        this.scene.add(light);
    }

    initComponents() {
        // Gaze controller
        this.gazeController = new GazeController(this.camera, this.renderer);

        // Panorama viewer
        this.panoramaViewer = new PanoramaViewer(
            this.scene,
            () => this.onPanoramaBack(),
            this.camera,
            this.renderer
        );
    }

    initEventListeners() {
        // Window resize
        this.boundOnResize = this.onWindowResize.bind(this);
        window.addEventListener('resize', this.boundOnResize);

        // Mouse wheel FOV zoom
        this.boundOnWheel = this.onWheel.bind(this);
        this.container.addEventListener('wheel', this.boundOnWheel, { passive: false });

        // WebXR session events
        if (this.renderer.xr.enabled) {
            this.renderer.xr.addEventListener('sessionstart', () => {
                this.camera.fov = CONFIG.fov.vr;
                this.camera.updateProjectionMatrix();
                this.isVRMode = true;
                if (this.subMenu) this.subMenu.setVRMode(true);
                this.panoramaViewer.setVRMode(true);
            });

            this.renderer.xr.addEventListener('sessionend', () => {
                this.camera.fov = CONFIG.fov.default;
                this.camera.updateProjectionMatrix();
                this.isVRMode = false;
                this.panoramaViewer.setVRMode(false);
            });

            // VR Controller / Cardboard v2 Button Trigger
            this.renderer.xr.getController(0).addEventListener('select', () => {
                if (this.gazeController && this.gazeController.hoveredObject) {
                    console.log('[VR] Manual trigger via button');
                    this.gazeController.trigger(this.gazeController.hoveredObject, this.gazeController.hoveredIntersect);
                }
            });
        }

        // Mouse Click Interaction (Desktop & Cardboard Button)
        window.addEventListener('click', (event) => {
            // Ignore clicks if in WebXR mode (handled by controller selection)
            // But handle them if in Cardboard mode (handled by gaze trigger)
            if (this.renderer.xr.enabled && this.renderer.xr.isPresenting) return;

            if (this.isCardboardMode) {
                // Cardboard mode: click triggers whatever is under the reticle
                if (this.gazeController && this.gazeController.hoveredObject) {
                    console.log('[Cardboard] Button trigger');
                    this.gazeController.trigger(this.gazeController.hoveredObject, this.gazeController.hoveredIntersect);
                }
                return;
            }

            // Normal Interaction (Desktop)
            // Use canvas bounds for accurate mouse position
            const rect = this.renderer.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, this.camera);

            // Force update ALL world matrices before raycasting
            this.scene.updateMatrixWorld(true);

            // ADMIN INTERACTION PRIORITY
            // We must check this FIRST before normal interaction loops
            if (this.panoramaViewer && this.panoramaViewer.isAdminMode) {
                // Reuse existing raycaster
                // Explicitly intersect with sphere and hotspots
                const adminObjects = [this.panoramaViewer.sphere];
                if (this.panoramaViewer.group) {
                    this.panoramaViewer.group.traverse(child => {
                        if (child.userData && child.userData.hotspotData) {
                            adminObjects.push(child);
                        }
                    });
                }

                const adminIntersects = raycaster.intersectObjects(adminObjects, false); // No recursion needed if we passed flat list, or true if group

                if (this.panoramaViewer.handleAdminClick(adminIntersects)) {
                    return;
                }
            }

            // Normal Interaction
            const interactables = this.getInteractables();
            // Reuse existing raycaster (already set from camera)
            const intersects = raycaster.intersectObjects(interactables, true);

            if (intersects.length > 0) {
                let target = intersects[0].object;

                // Traverse up
                while (target && !target.userData.isInteractable && target.parent) {
                    target = target.parent;
                }

                if (target && target.userData.isInteractable && target.onClick) {
                    target.onClick(intersects[0]);
                }
            }
        });

        // Right Click Interaction (Admin Add Hotspot)
        window.addEventListener('contextmenu', (event) => {
            if (!this.panoramaViewer?.isAdminMode) return;

            // Prevent default menu
            event.preventDefault();

            // Use canvas bounds
            const rect = this.renderer.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, this.camera);

            // Raycast against sphere for placement
            const intersects = raycaster.intersectObject(this.panoramaViewer.sphere);

            if (this.panoramaViewer.handleAdminRightClick(intersects)) {
                // Handled
            }
        });
    }

    initAdminPanel() {
        // Dynamic import or just normal import? using normal for now
        import('./components/AdminPanel.js').then(({ AdminPanel }) => {
            this.adminPanel = new AdminPanel(this.panoramaViewer);
            window.adminPanel = this.adminPanel; // Global access for debug/hook
        });

        // --- Admin Drag-and-Drop Handler ---
        window.addEventListener('mousedown', (e) => {
            if (!this.panoramaViewer?.isAdminMode) return;

            const { raycaster, intersects } = this.raycast(e);

            // Check Admin Drag Start
            if (this.panoramaViewer.handleAdminMouseDown(intersects)) {
                this.controls.enabled = false; // Disable camera
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.panoramaViewer?.isAdminMode) return;

            if (this.panoramaViewer.isDraggingHotspot) {
                const { raycaster } = this.raycast(e);
                this.panoramaViewer.handleAdminMouseMove(raycaster);
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (this.panoramaViewer?.isDraggingHotspot) {
                this.panoramaViewer.handleAdminMouseUp();
                this.controls.enabled = true; // Re-enable camera
            }
        });
    }

    raycast(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);

        // Include sphere for admin checks
        const interactables = [...this.getInteractables()];
        if (this.panoramaViewer && this.panoramaViewer.sphere) {
            interactables.push(this.panoramaViewer.sphere);
        }

        const intersects = raycaster.intersectObjects(interactables, true);
        return { raycaster, intersects };
    }


    // ==================== BACKGROUND ====================

    createGradientBackground() {
        const geometry = new THREE.SphereGeometry(CONFIG.background.radius, 32, 32);
        geometry.scale(-1, 1, 1);

        const canvas = document.createElement('canvas');
        canvas.width = 1024; // Better resolution for crisp lines
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        // 1. Solid Dark Background (Requested: Hitam Gelap)
        ctx.fillStyle = '#111111'; // Very dark grey, almost black
        ctx.fillRect(0, 0, w, h);

        // 2. Minimalist Grid (Requested: Sedikit garis penanda arah)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 2;

        // A. Horizon Line (Depan/Belakang/Kiri/Kanan horizontal guide)
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // B. Vertical Cardinal Lines (North, East, South, West)
        // 4 lines acting as compass bearings
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < w; i += w / 4) {
            ctx.moveTo(i, 0);
            ctx.lineTo(i, h);
        }
        ctx.stroke();

        // C. Zenith/Nadir Markers (Atas/Bawah)
        // Just simple crosses at top and bottom poles would be distorted.
        // The vertical lines converging at poles already indicate Up/Down.
        // Let's add simple rim at top/bottom for "lid" feel.
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(w, 0); // Top rim
        ctx.moveTo(0, h); ctx.lineTo(w, h); // Bottom rim
        ctx.stroke();

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const bgMesh = new THREE.Mesh(geometry, material);
        this.scene.add(bgMesh);
    }

    // ==================== CARDBOARD MODE HELPERS ====================

    enterCardboardMode() {
        if (this.cardboardManager) {
            this.cardboardManager.enter();
        }
    }

    exitCardboardMode(keepFullscreen = false) {
        if (this.cardboardManager) {
            this.cardboardManager.exit(keepFullscreen);
        }
    }

    get isCardboardMode() {
        return this.cardboardManager?.isCardboardMode ?? false;
    }

    // ==================== EVENT HANDLERS ====================

    onWheel(e) {
        e.preventDefault();
        const zoomSpeed = 2;
        this.camera.fov += e.deltaY > 0 ? zoomSpeed : -zoomSpeed;
        this.camera.fov = Math.max(CONFIG.fov.min, Math.min(CONFIG.fov.max, this.camera.fov));
        this.camera.updateProjectionMatrix();
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    onWelcomeStart() {
        // Obsolete if landing screen loads directly, but kept for compatibility if called
        this.currentState = 'panorama';
        console.log('Loading Museum Lobby...');
        this.panoramaViewer.navigateToScene('assets/Museum Kota Makassar/lobby_C12D6770.jpg');
    }

    onPanoramaBack() {
        // Menu is disabled, so we just stay in the museum or reload lobby
        console.log('Back clicked - Menu disabled, staying in museum.');
        this.panoramaViewer.navigateToScene('assets/Museum Kota Makassar/lobby_C12D6770.jpg');
    }

    // ==================== UTILITIES ====================

    async requestFullscreen() {
        const el = document.documentElement;
        try {
            if (el.requestFullscreen) {
                await el.requestFullscreen();
            } else if (el.webkitRequestFullscreen) {
                el.webkitRequestFullscreen();
            }
        } catch (e) {
            console.log('Fullscreen blocked:', e);
        }
    }

    lockLandscape() {
        try {
            if (screen.orientation?.lock) {
                screen.orientation.lock('landscape').catch(() => { });
            } else if (window.screen?.lockOrientation) {
                window.screen.lockOrientation('landscape');
            }
        } catch (e) {
            console.warn('Rotation lock not supported');
        }
    }

    // ==================== RENDER LOOP ====================

    render() {
        const delta = this.clock.getDelta();

        // Update controls
        if (this.controls) this.controls.update();

        // Update cardboard manager (gyroscope)
        if (this.cardboardManager) {
            this.cardboardManager.update();

            // Update debug info if visible
            if (this.debugInfo && (this.cardboardManager.isCardboardMode || window.location.search.includes('debug=true'))) {
                const gyro = this.cardboardManager.gyroscopeControls;
                const data = gyro?.deviceOrientation;
                const isHttps = window.location.protocol === 'https:';

                this.debugInfo.style.display = 'block';
                this.debugInfo.innerHTML = `
                    <div style="background:rgba(0,0,0,0.7); padding:4px; border-radius:4px;">
                    GYRO: ${gyro?.enabled ? 'ON' : 'OFF'} | DATA: ${gyro?.gotAnyData ? 'YES' : 'NO'}<br>
                    A:${data?.alpha?.toFixed(1) || 0} B:${data?.beta?.toFixed(1) || 0} G:${data?.gamma?.toFixed(1) || 0}<br>
                    HTTPS: ${isHttps ? '<span style="color:#4f4">YES</span>' : '<span style="color:#f44">NO - SENSORS BLOCKED</span>'}
                    </div>
                `;
            }
        }

        // Build interactables list
        const interactables = this.getInteractables();

        // Update gaze controller
        this.gazeController.update(this.scene, interactables, delta);

        // Update components
        this.panoramaViewer.update(delta);

        // Render (WebVR, stereo, or normal)
        let usedWebVR = false;
        if (this.webVRHelper && this.webVRHelper.isPresenting) {
            this.webVRHelper.render();
            usedWebVR = true;
        }

        if (!usedWebVR) {
            const usedStereo = this.cardboardManager?.render(this.scene, this.camera);
            if (!usedStereo) {
                this.renderer.render(this.scene, this.camera);
            }
        }
    }

    getInteractables() {
        const list = [];
        // Only panorama viewer's group (hotspots and dock) are interactable now
        if (this.panoramaViewer.group.visible) list.push(this.panoramaViewer.group);
        return list;
    }

    // ==================== CLEANUP ====================

    initLandingScreen() {
        const landingScreen = document.getElementById('landing-screen');
        const enterBtn = document.getElementById('enter-vr-btn');

        if (!enterBtn) return;

        enterBtn.addEventListener('click', async () => {
            // Request fullscreen
            await this.requestFullscreen();

            // Lock landscape
            this.lockLandscape();

            // Resume audio context
            if (THREE.AudioContext?.state === 'suspended') {
                await THREE.AudioContext.resume();
            }

            // Fade out landing screen
            landingScreen.style.opacity = '0';
            setTimeout(() => {
                landingScreen.style.display = 'none';
            }, 500);

            // Hide menu just in case (if exists)
            if (this.orbitalMenu) this.orbitalMenu.hide();

            // Load Lobby Panorama directly
            console.log('Loading Museum Lobby...');
            this.currentState = 'panorama';
            this.panoramaViewer.navigateToScene('assets/Museum Kota Makassar/lobby_C12D6770.jpg');
            this.panoramaViewer.setBackButtonVisibility(false);
            this.panoramaViewer.setAudioButtonsPosition('standalone');

            // Enter cardboard mode on mobile if WebXR is NOT being used
            setTimeout(async () => {
                const isXRActive = this.renderer.xr.enabled && this.renderer.xr.isPresenting;
                if (!isXRActive && (this.isMobileDevice || this.isIOSDevice)) {
                    // Force start gyroscope and stereo
                    if (this.cardboardManager) {
                        await this.cardboardManager.initGyroscope();
                        this.enterCardboardMode();
                    }
                }
            }, 100);
        });
    }

    dispose() {
        // Remove event listeners
        window.removeEventListener('resize', this.boundOnResize);
        this.container.removeEventListener('wheel', this.boundOnWheel);

        // Dispose components
        this.panoramaViewer?.dispose?.();
        this.gazeController?.dispose?.();
        this.cardboardManager?.dispose();
    }
}

new App();