import * as THREE from 'three';
import './style.css';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DeviceOrientationControls } from './utils/DeviceOrientationControls.js';
import { GazeController } from './components/GazeController.js';
import { PanoramaViewer } from './components/PanoramaViewer.js';
import { CardboardModeManager } from './components/CardboardModeManager.js';
import { isIOS, isMobile, isCardboardForced, requestGyroscopePermission } from './utils/deviceDetection.js';
import { iOSFullscreenHelper } from './utils/iOSFullscreenHelper.js';
import { VROverlay } from './components/VROverlay.js';
import { CONFIG } from './config.js';
import { TOUR_DATA } from './data/tourData.js';



// Initialize WebXR Polyfill for iOS/mobile devices without native WebXR
// This must be done BEFORE any WebXR code runs
import WebXRPolyfill from 'webxr-polyfill';
const polyfill = new WebXRPolyfill({
    // Enable CardboardVRDisplay on mobile devices
    cardboard: true,
    // Fall back to WebVR 1.1 if available
    webvr: true,
    // Allow testing on desktop (for development)
    allowCardboardOnDesktop: false,
    // Cardboard-specific configuration
    cardboardConfig: {
        // Enable the polyfill's own UI (gear icon, viewer selector)
        CARDBOARD_UI_DISABLED: false,
        // Disable rotation instructions (we will provide our own)
        ROTATE_INSTRUCTIONS_DISABLED: true,
        // Buffer scale for performance
        BUFFER_SCALE: 0.75
    }
});
console.log('WebXR Polyfill initialized:', polyfill);

class App {
    constructor() {
        // Device detection
        this.isIOSDevice = isIOS() || isCardboardForced();
        this.isMobileDevice = isMobile();

        // iOS Fullscreen Helper (video fullscreen wrapper)
        if (this.isIOSDevice) {
            this.iOSFullscreenHelper = new iOSFullscreenHelper();
            console.log('iOS Fullscreen Helper initialized');
        }

        // VR Overlay (pre-VR instructions)
        this.vrOverlay = new VROverlay(() => this.startVRSession());

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
            preserveDrawingBuffer: true, // Required for screenshot transitions
            // PENTING: Paksa WebGL1 agar polyfill WebXR (yang memanggil
            // canvas.getContext('webgl')) tidak konflik dengan konteks webgl2
            forceWebGL1: true
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
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

        // Gyroscope Controls (for Magic Window mode)
        this.deviceOrientationControls = new DeviceOrientationControls(this.camera);
        // Default to disabled until permission is granted and user starts experience
        this.isGyroEnabled = false;
    }

    initCardboardMode() {
        // WebXR polyfill provides navigator.xr on all devices
        // We only use WebXR, no fallback to CardboardModeManager

        if (navigator.xr) {
            navigator.xr.isSessionSupported('immersive-vr').then(supported => {
                if (supported) {
                    console.log('WebXR immersive-vr supported (native or polyfill)');
                    this.initWebXRMode();
                } else {
                    console.log('WebXR immersive-vr not supported on this device');
                }
            }).catch(e => {
                console.log('WebXR check failed:', e);
            });
        } else {
            console.log('No WebXR available');
        }
    }

    initWebXRMode() {
        // Enable WebXR on the renderer
        this.renderer.xr.enabled = true;

        // Set reference space type
        this.renderer.xr.setReferenceSpaceType('local');

        // Create custom VR button with Google Cardboard icon
        this.createVRButton();

        // Listen for session start/end
        this.renderer.xr.addEventListener('sessionstart', () => {
            console.log('WebXR session started');
            this.isVRMode = true;
            // Disable manual gyro scale/control, let WebXR handle it
            if (this.deviceOrientationControls) this.deviceOrientationControls.enabled = false;

            if (this.panoramaViewer) this.panoramaViewer.setVRMode(true);
            if (this.vrButton) this.vrButton.style.display = 'none';
        });

        this.renderer.xr.addEventListener('sessionend', () => {
            console.log('WebXR session ended');
            this.isVRMode = false;
            // Re-enable manual gyro if it was active
            if (this.deviceOrientationControls && this.isGyroEnabled) {
                this.deviceOrientationControls.enabled = true;
            }

            if (this.panoramaViewer) this.panoramaViewer.setVRMode(false);
            if (this.vrButton) {
                // Custom button needs flex, standard one needs block/initial
                this.vrButton.style.display = (this.vrButton.id === 'vr-goggle-button') ? 'flex' : '';
            }

            // Pulihkan state renderer setelah sesi VR polyfill berakhir
            // untuk mencegah error "drawElements: no buffer"
            const resetRenderer = () => {
                this.camera.aspect = window.innerWidth / window.innerHeight;
                this.camera.updateProjectionMatrix();
                this.renderer.setSize(window.innerWidth, window.innerHeight);
                this.renderer.setPixelRatio(window.devicePixelRatio);
            };

            resetRenderer();

            // Force resize again after a short delay to handle transition animations
            setTimeout(resetRenderer, 100);
            setTimeout(resetRenderer, 500);

            this.renderer.state.reset();
        });
    }

    createVRButton() {
        // Create VR button with Google Cardboard goggle icon
        const button = document.createElement('button');
        button.id = 'vr-goggle-button';

        // SVG icon for Google Cardboard glasses (Outline)
        button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="32" height="32">
                <path d="M20.74 6H3.21C2.55 6 2 6.57 2 7.28v10.44c0 .7.55 1.28 1.23 1.28h4.79c.52 0 .98-.34 1.14-.84l.99-3.11c.23-.71.88-1.19 1.62-1.19h.46c.74 0 1.39.48 1.62 1.19l.99 3.11c.16.5.63.84 1.14.84h4.79c.68 0 1.23-.57 1.23-1.28V7.28c0-.71-.55-1.28-1.26-1.28zM7.5 14.5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm9 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
            </svg>
        `;

        // Style the button
        Object.assign(button.style, {
            position: 'fixed',
            bottom: '20px',
            right: '25px', // Slightly adjusted
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            border: '2px solid rgba(255, 255, 255, 0.8)', // White outline border
            background: 'rgba(0, 0, 0, 0.3)', // Semi-transparent dark background
            backdropFilter: 'blur(4px)',
            cursor: 'pointer',
            display: 'none', // Initially hidden
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '9999',
            transition: 'all 0.3s ease'
        });

        // Hover effect
        button.onmouseenter = () => {
            button.style.transform = 'scale(1.1)';
            button.style.background = 'rgba(0, 0, 0, 0.5)';
            button.style.borderColor = 'white';
        };
        button.onmouseleave = () => {
            button.style.transform = 'scale(1)';
            button.style.background = 'rgba(0, 0, 0, 0.3)';
            button.style.borderColor = 'rgba(255, 255, 255, 0.8)';
        };

        // Click handler - show VR instruction overlay first
        button.addEventListener('click', () => {
            if (!navigator.xr) {
                console.log('WebXR not available');
                alert('WebXR tidak tersedia di browser ini.');
                return;
            }
            // Show the instruction overlay
            if (this.vrOverlay) {
                this.vrOverlay.show();
            }
        });

        document.body.appendChild(button);
        this.vrButton = button;
    }

    // Called by VROverlay when user clicks "ENTER VR"
    async startVRSession() {
        try {
            // iOS Safari scroll trick to hide address bar
            if (this.isIOSDevice) {
                console.log('iOS: Triggering scroll-to-hide trick...');
                await this.triggerIOSFullscreen();
            }

            // Start WebXR session
            const session = await navigator.xr.requestSession('immersive-vr', {
                optionalFeatures: ['local-floor', 'bounded-floor']
            });
            this.renderer.xr.setSession(session);
            console.log('WebXR session started via overlay');
        } catch (e) {
            console.log('Failed to start WebXR session:', e.message);
        }
    }

    // iOS Safari trick: make page taller than viewport, scroll to trigger bar hide
    triggerIOSFullscreen() {
        return new Promise((resolve) => {
            // Save original styles
            const originalHeight = document.body.style.height;
            const originalOverflow = document.body.style.overflow;

            // Make body taller than viewport to allow scroll
            document.body.style.height = (window.innerHeight + 100) + 'px';
            document.body.style.overflow = 'auto';

            // Scroll down 1px to trigger Safari to hide toolbar
            setTimeout(() => {
                window.scrollTo(0, 1);

                // Wait a bit for Safari to process
                setTimeout(() => {
                    // Restore original styles
                    document.body.style.height = originalHeight || '';
                    document.body.style.overflow = originalOverflow || '';

                    // Scroll back to top
                    window.scrollTo(0, 0);

                    console.log('iOS scroll trick completed');
                    resolve();
                }, 300);
            }, 100);
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
        this.gazeController = new GazeController(this.scene, this.camera, this.renderer);

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

        // Touch Tap Interaction (Desktop Touchscreen)
        // OrbitControls may consume touch events, preventing 'click' from firing on tap.
        // This detects short taps and performs the same raycast as mouse click.
        let touchStartPos = null;
        let touchStartTime = 0;

        window.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                touchStartTime = Date.now();
            }
        }, { passive: true });

        window.addEventListener('touchend', (e) => {
            if (!touchStartPos) return;

            const touch = e.changedTouches[0];
            const dx = touch.clientX - touchStartPos.x;
            const dy = touch.clientY - touchStartPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const duration = Date.now() - touchStartTime;

            touchStartPos = null;

            // Only treat as tap if short duration and minimal movement
            if (duration > 300 || dist > 10) return;

            // Skip if in VR
            if (this.renderer.xr.enabled && this.renderer.xr.isPresenting) return;

            const rect = this.renderer.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2();
            mouse.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;

            const raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, this.camera);
            this.scene.updateMatrixWorld(true);

            // Admin interaction
            if (this.panoramaViewer && this.panoramaViewer.isAdminMode) {
                const adminObjects = [this.panoramaViewer.sphere];
                if (this.panoramaViewer.group) {
                    this.panoramaViewer.group.traverse(child => {
                        if (child.userData && child.userData.hotspotData) {
                            adminObjects.push(child);
                        }
                    });
                }
                const adminIntersects = raycaster.intersectObjects(adminObjects, false);
                if (this.panoramaViewer.handleAdminClick(adminIntersects)) return;
            }

            // Normal interaction
            const interactables = this.getInteractables();
            const intersects = raycaster.intersectObjects(interactables, true);

            if (intersects.length > 0) {
                let target = intersects[0].object;
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
        // If gyro is enabled and active, use it. Otherwise fallback to orbit controls.
        // We check deviceOrientationControls.enabled just in case
        if (this.isGyroEnabled && this.deviceOrientationControls) {
            this.deviceOrientationControls.update();
        } else if (this.controls) {
            this.controls.update();
        }

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

            // Request Gyroscope Permission (iOS 13+)
            // This must be done on user gesture (click), just like audio resume
            try {
                const gyroGranted = await requestGyroscopePermission();
                if (gyroGranted) {
                    // Test if gyroscope actually works by waiting for a real event
                    const hasRealGyro = await new Promise((resolve) => {
                        const timeout = setTimeout(() => {
                            window.removeEventListener('deviceorientation', handler);
                            resolve(false);
                        }, 1000); // Wait 1 second for gyro event

                        const handler = (e) => {
                            // Real gyro gives non-null alpha/beta/gamma
                            if (e.alpha !== null || e.beta !== null || e.gamma !== null) {
                                clearTimeout(timeout);
                                window.removeEventListener('deviceorientation', handler);
                                resolve(true);
                            }
                        };
                        window.addEventListener('deviceorientation', handler);
                    });

                    if (hasRealGyro) {
                        this.isGyroEnabled = true;
                        console.log('Gyroscope enabled for Magic Window mode');
                    } else {
                        console.log('No real gyroscope detected, using OrbitControls');
                    }
                }
            } catch (e) {
                console.warn('Gyroscope request failed:', e);
            }

            // Fade out landing screen
            landingScreen.style.opacity = '0';
            setTimeout(() => {
                landingScreen.style.display = 'none';
            }, 500);

            // Hide menu just in case (if exists)
            if (this.orbitalMenu) this.orbitalMenu.hide();

            // Load Lobby Panorama directly (normal mode, not VR)
            console.log('Loading Museum Lobby...');
            this.currentState = 'panorama';
            this.panoramaViewer.navigateToScene('assets/Museum Kota Makassar/lobby_C12D6770.jpg');
            this.panoramaViewer.setBackButtonVisibility(false);
            this.panoramaViewer.setAudioButtonsPosition('standalone');

            // Show VR Button (if exists) after user starts experience
            if (this.vrButton) {
                // Custom button needs flex, standard one needs block/initial
                this.vrButton.style.display = (this.vrButton.id === 'vr-goggle-button') ? 'flex' : '';
            }

            // Note: User can click the VR button to enter WebXR VR mode
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