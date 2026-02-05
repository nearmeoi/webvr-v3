import * as THREE from 'three';
import './style.css';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GazeController } from './components/GazeController.js';
import { OrbitalMenu } from './components/OrbitalMenu.js';
import { SubMenu } from './components/SubMenu.js';
import { PanoramaViewer } from './components/PanoramaViewer.js';
import { StereoVideoPlayer } from './components/StereoVideoPlayer.js';
import { CardboardModeManager } from './components/CardboardModeManager.js';
import { isIOS, isWebXRSupported, isMobile, isCardboardForced } from './utils/deviceDetection.js';
import { CONFIG } from './config.js';
import { TOUR_DATA } from './data/tourData.js';
import { TourDirector } from './components/TourDirector.js';

class App {
    constructor() {
        // Device detection
        this.isIOSDevice = isIOS() || isCardboardForced();
        this.isMobileDevice = isMobile();

        // State
        this.currentState = 'welcome';
        this.currentSubMenuParent = null;
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

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            preserveDrawingBuffer: true // Required for screenshot transitions
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        // Enable WebXR only for non-iOS devices
        if (!this.isIOSDevice && isWebXRSupported()) {
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
        if (!this.isIOSDevice) return;

        console.log('iOS/Cardboard mode enabled - using stereo rendering');

        this.cardboardManager = new CardboardModeManager(
            this.renderer,
            this.camera,
            this.controls
        );
        this.cardboardManager.init();

        // Sync mode changes with components
        this.cardboardManager.onModeChange = (isVR) => {
            if (this.panoramaViewer) {
                this.panoramaViewer.setVRMode(isVR);
                // Fix: If in cinematic tour, ensure back button stays hidden when exiting VR
                if (!isVR && this.currentState === 'cinematic-tour') {
                    this.panoramaViewer.setBackButtonVisibility(false);
                }
            }
            if (this.stereoVideoPlayer) {
                this.stereoVideoPlayer.setStereoMode(isVR && !!this.cardboardManager?.stereoEffect);
            }
        };
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.add(this.camera);

        // Gradient background sphere
        this.createGradientBackground();

        // Lighting
        const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 3);
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

        // Stereo video player
        this.stereoVideoPlayer = new StereoVideoPlayer(
            this.scene,
            this.camera,
            this.renderer,
            () => this.onVideoBack(),
            () => this.enterCardboardMode(),
            () => this.exitCardboardMode()
        );

        // Orbital menu (hidden initially)
        this.orbitalMenu = new OrbitalMenu(this.scene, this.camera, (index) => {
            this.onMainMenuSelect(index);
        });
        this.orbitalMenu.hide();

        // Sub-menu placeholder
        this.subMenu = null;

        // Tour Director for cinematic guided tour
        this.tourDirector = new TourDirector(this);
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
                if (this.subMenu) this.subMenu.setVRMode(false);
                this.panoramaViewer.setVRMode(false);
            });

        }

        // Mouse Click Interaction (Desktop)
        window.addEventListener('click', (event) => {
            // Ignore clicks if in VR mode (handled by controller selection)
            if (this.isVRMode) return;

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
                THREE.AudioContext.resume();
            }

            // Fade out landing screen
            landingScreen.style.opacity = '0';
            setTimeout(() => {
                landingScreen.style.display = 'none';
            }, 500);

            // Show welcome screen 
            // CINEMATIC MODE: Skip welcome screen, go straight to director?
            // Or keep welcome screen but 'Enter' starts the tour?

            // Hide menu just in case
            if (this.orbitalMenu) this.orbitalMenu.hide();

            // Start Director
            if (this.tourDirector) {
                console.log('Starting Cinematic Tour...');
                this.tourDirector.start();
            }

            // Enter cardboard mode on mobile (slight delay for fullscreen)
            setTimeout(() => {
                if (this.isMobileDevice || this.isIOSDevice) {
                    this.enterCardboardMode();
                }
            }, 100);
        });
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
        this.welcomeScreen.hide();
        this.currentState = 'cinematic-tour';

        // CINEMATIC MODE: Start Director instead of Menu
        if (this.tourDirector) {
            console.log('Welcome Screen completed. Starting Cinematic Tour...');
            this.tourDirector.start();
        } else {
            // Fallback to menu if no director
            this.currentState = 'main-menu';
            this.orbitalMenu.show();
        }
    }

    onMainMenuSelect(index) {
        const location = TOUR_DATA[index];
        console.log('Main menu selected:', location.title);

        if (location.subLocations?.length > 0) {
            this.enterTorajaMode(location);
        } else if (location.stereoVideo) {
            this.enterStereoVideoMode(location);
        } else {
            this.enterPanoramaMode(location);
        }
    }

    /**
     * Load a location by index - used by TourDirector
     */
    loadLocation(index) {
        const location = TOUR_DATA[index];
        if (!location) {
            console.error('Invalid location index:', index);
            return;
        }

        console.log('Loading location:', location.title);
        this.currentState = 'cinematic-tour';

        // Hide menu if visible
        if (this.orbitalMenu) this.orbitalMenu.hide();
        if (this.subMenu) this.subMenu.hide();

        // Load panorama
        this.panoramaViewer.loadFromLocation(location);
        this.panoramaViewer.setBackButtonVisibility(false); // No back in tour mode
        this.panoramaViewer.setAudioButtonsPosition('standalone');

        // CRITICAL FIX: Hide legacy AudioControls from PanoramaViewer
        // They overlap with TourDirector's navigation buttons
        if (this.panoramaViewer.audioControls) {
            this.panoramaViewer.audioControls.setVisible(false);
            // BRUTE FORCE: Move them to infinity to ensure no raycast hits
            this.panoramaViewer.audioControls.setPosition('standalone', { y: 10000 });
        }
    }

    enterTorajaMode(location) {
        this.orbitalMenu.hide();
        this.showSubMenu(location);
        this.panoramaViewer.loadFromLocation(location.subLocations[0]);
        this.panoramaViewer.setBackButtonVisibility(false);

        // Pass dynamic angle from SubMenu logic
        const lastItemTheta = this.subMenu.getLastItemTheta();
        this.panoramaViewer.setAudioButtonsPosition('with-dock', location.subLocations.length, lastItemTheta);

        this.currentState = 'toraja-mode';
    }

    enterStereoVideoMode(location) {
        this.orbitalMenu.hide();
        this.currentState = 'stereo-video';
        this.currentSubMenuParent = null;

        if (location.projection === 'flat') {
            // 2D HTML video player
            if (this.isCardboardMode) {
                this.exitCardboardMode(true);
            }
            this.stereoVideoPlayer.play2D(location.stereoVideo);
        } else {
            // 3D VR video player
            this.stereoVideoPlayer.load(
                location.stereoVideo,
                true,
                location.projection || 'curved',
                location.format || 'stereo'
            );
            if (this.isCardboardMode) {
                this.stereoVideoPlayer.setStereoMode(true);
            }
        }

        if (this.controls) this.controls.enabled = true;
    }

    enterPanoramaMode(location) {
        this.orbitalMenu.hide();
        this.currentState = 'panorama';
        this.currentSubMenuParent = null;
        this.panoramaViewer.loadFromLocation(location);
        this.panoramaViewer.setBackButtonVisibility(true);
        this.panoramaViewer.setAudioButtonsPosition('standalone');
    }

    showSubMenu(parentLocation) {
        if (this.subMenu) {
            this.scene.remove(this.subMenu.group);
            this.subMenu = null;
        }

        this.currentSubMenuParent = parentLocation;
        this.subMenu = new SubMenu(
            this.scene,
            this.camera,
            parentLocation,
            (subLocation) => this.onSubMenuSelect(subLocation),
            () => this.onSubMenuBack()
        );
        this.subMenu.show();
        this.subMenu.setActive(0);

        if (this.isVRMode) this.subMenu.setVRMode(true);
    }

    onSubMenuSelect(subLocation) {
        console.log('Switching to scene:', subLocation.name);
        this.panoramaViewer.loadFromLocation(subLocation);
    }

    onSubMenuBack() {
        if (this.subMenu) this.subMenu.hide();
        this.panoramaViewer.hide();
        this.currentState = 'main-menu';
        this.currentSubMenuParent = null;
        this.orbitalMenu.show();
    }

    onPanoramaBack() {
        if (this.currentState === 'cinematic-tour') return;
        this.panoramaViewer.hide();
        this.currentState = 'main-menu';
        this.orbitalMenu.show();
    }

    onVideoBack() {
        this.stereoVideoPlayer.hide();
        this.currentState = 'main-menu';
        this.orbitalMenu.show();
        if (this.controls) this.controls.enabled = true;
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
        }

        // Build interactables list
        const interactables = this.getInteractables();

        // Update gaze controller
        this.gazeController.update(this.scene, interactables, delta);

        // Update components
        if (this.welcomeScreen) this.welcomeScreen.update(delta);

        // SAFEGUARD: Ensure Orbital Menu is hidden in Cinematic Mode
        if (this.currentState === 'cinematic-tour' && this.orbitalMenu.group.visible) {
            this.orbitalMenu.hide();
        }
        this.orbitalMenu.update(delta);
        if (this.subMenu) this.subMenu.update(delta);
        this.panoramaViewer.update(delta);
        if (this.stereoVideoPlayer) this.stereoVideoPlayer.update(delta);

        // Update TourDirector
        if (this.tourDirector) this.tourDirector.update(delta);

        // Render (stereo or normal)
        const usedStereo = this.cardboardManager?.render(this.scene, this.camera);
        if (!usedStereo) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    getInteractables() {
        const list = [];

        // TourDirector buttons FIRST for click priority
        if (this.tourDirector) {
            const tourButtons = this.tourDirector.getInteractables();
            list.push(...tourButtons);
        }

        // Then other UI elements
        if (this.welcomeScreen?.group.visible) list.push(this.welcomeScreen.group);
        if (this.orbitalMenu.group.visible) list.push(this.orbitalMenu.group);
        if (this.subMenu?.group.visible) list.push(this.subMenu.group);
        if (this.panoramaViewer.group.visible) list.push(this.panoramaViewer.group);
        if (this.stereoVideoPlayer?.group.visible) list.push(this.stereoVideoPlayer.group);

        return list;
    }

    // ==================== CLEANUP ====================

    dispose() {
        // Remove event listeners
        window.removeEventListener('resize', this.boundOnResize);
        this.container.removeEventListener('wheel', this.boundOnWheel);

        // Dispose components
        this.tourDirector?.dispose?.();
        this.panoramaViewer?.dispose?.();
        this.gazeController?.dispose?.();
        this.cardboardManager?.dispose();
        this.stereoVideoPlayer?.dispose();
        this.orbitalMenu?.dispose?.();
    }
}

new App();