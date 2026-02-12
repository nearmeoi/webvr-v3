import * as THREE from 'three';
import './style.css';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DeviceOrientationControls } from './utils/DeviceOrientationControls.js';
import { GazeController } from './components/GazeController.js';
import { PanoramaViewer } from './components/PanoramaViewer.js';
import { isIOS, isMobile, isCardboardForced } from './utils/deviceDetection.js';
import { iOSFullscreenHelper } from './utils/iOSFullscreenHelper.js';
import { VROverlay } from './components/VROverlay.js';
import { CONFIG } from './config.js';
import { InfoOverlay } from './components/InfoOverlay.js';
import { InfoPanel3D } from './components/InfoPanel3D.js';
import { InputHandler } from './components/InputHandler.js';
import { LandingScreen } from './components/LandingScreen.js';

// Initialize WebXR Polyfill for iOS/mobile devices without native WebXR
// This must be done BEFORE any WebXR code runs
import WebXRPolyfill from 'webxr-polyfill';
const polyfill = new WebXRPolyfill({
    cardboard: true,
    webvr: true,
    allowCardboardOnDesktop: false,
    cardboardConfig: {
        CARDBOARD_UI_DISABLED: false,
        ROTATE_INSTRUCTIONS_DISABLED: true,
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
        this.isGyroEnabled = false;

        // Setup
        this.initRenderer();
        this.initCamera();
        this.initControls();
        this.initScene();
        this.initComponents();
        this.initWebXR();
        this.initAdminPanel();

        // Input and Landing Screen (extracted modules)
        this.inputHandler = new InputHandler(this);
        this.landingScreen = new LandingScreen(this);

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
            display: 'none'
        });
        document.body.appendChild(this.debugInfo);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            preserveDrawingBuffer: true,
            // Force WebGL1 so polyfill WebXR (canvas.getContext('webgl'))
            // doesn't conflict with webgl2 context
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
    }

    // ==================== WEBXR ====================

    initWebXR() {
        if (!navigator.xr) {
            console.log('No WebXR available');
            return;
        }

        navigator.xr.isSessionSupported('immersive-vr').then(supported => {
            if (supported) {
                console.log('WebXR immersive-vr supported (native or polyfill)');
                this._setupWebXR();
            } else {
                console.log('WebXR immersive-vr not supported on this device');
            }
        }).catch(e => {
            console.log('WebXR check failed:', e);
        });
    }

    _setupWebXR() {
        this.renderer.xr.enabled = true;
        this.renderer.xr.setReferenceSpaceType('local');

        this.createVRButton();

        // Session start
        this.renderer.xr.addEventListener('sessionstart', () => {
            console.log('WebXR session started');
            this.isVRMode = true;
            this.camera.fov = CONFIG.fov.vr;
            this.camera.updateProjectionMatrix();

            if (this.deviceOrientationControls) this.deviceOrientationControls.enabled = false;
            if (this.panoramaViewer) this.panoramaViewer.setVRMode(true);
            if (this.vrButton) this.vrButton.style.display = 'none';
        });

        // Session end
        this.renderer.xr.addEventListener('sessionend', () => {
            console.log('WebXR session ended');
            this.isVRMode = false;
            this.camera.fov = CONFIG.fov.default;
            this.camera.updateProjectionMatrix();

            if (this.deviceOrientationControls && this.isGyroEnabled) {
                this.deviceOrientationControls.enabled = true;
            }

            if (this.panoramaViewer) this.panoramaViewer.setVRMode(false);
            if (this.vrButton) {
                this.vrButton.style.display = (this.vrButton.id === 'vr-goggle-button') ? 'flex' : '';
            }

            // Restore renderer state after VR polyfill session ends
            // to prevent "drawElements: no buffer" error
            const resetRenderer = () => {
                this.camera.aspect = window.innerWidth / window.innerHeight;
                this.camera.updateProjectionMatrix();
                this.renderer.setSize(window.innerWidth, window.innerHeight);
                this.renderer.setPixelRatio(window.devicePixelRatio);
            };

            resetRenderer();
            setTimeout(resetRenderer, 100);
            setTimeout(resetRenderer, 500);

            this.renderer.state.reset();
        });
    }

    createVRButton() {
        const button = document.createElement('button');
        button.id = 'vr-goggle-button';

        // SVG icon for Google Cardboard glasses (Outline)
        button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="32" height="32">
                <path d="M20.74 6H3.21C2.55 6 2 6.57 2 7.28v10.44c0 .7.55 1.28 1.23 1.28h4.79c.52 0 .98-.34 1.14-.84l.99-3.11c.23-.71.88-1.19 1.62-1.19h.46c.74 0 1.39.48 1.62 1.19l.99 3.11c.16.5.63.84 1.14.84h4.79c.68 0 1.23-.57 1.23-1.28V7.28c0-.71-.55-1.28-1.26-1.28zM7.5 14.5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm9 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
            </svg>
        `;

        Object.assign(button.style, {
            position: 'fixed',
            bottom: '20px',
            right: '25px',
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            border: '2px solid rgba(255, 255, 255, 0.8)',
            background: 'rgba(0, 0, 0, 0.3)',
            backdropFilter: 'blur(4px)',
            cursor: 'pointer',
            display: 'none',
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
            const originalHeight = document.body.style.height;
            const originalOverflow = document.body.style.overflow;

            document.body.style.height = (window.innerHeight + 100) + 'px';
            document.body.style.overflow = 'auto';

            setTimeout(() => {
                window.scrollTo(0, 1);
                setTimeout(() => {
                    document.body.style.height = originalHeight || '';
                    document.body.style.overflow = originalOverflow || '';
                    window.scrollTo(0, 0);
                    console.log('iOS scroll trick completed');
                    resolve();
                }, 300);
            }, 100);
        });
    }

    // ==================== SCENE ====================

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.add(this.camera);

        // Gradient background sphere
        this.createGradientBackground();

        // Lighting - Boosted for VR brightness
        const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 10);
        this.scene.add(light);
    }

    // ==================== COMPONENTS ====================

    initComponents() {
        // Gaze controller
        this.gazeController = new GazeController(this.scene, this.camera, this.renderer);

        // Info Overlay
        this.infoOverlay = new InfoOverlay();

        // 3D Info Panel (VR Mode)
        this.infoPanel3D = new InfoPanel3D(this.camera, this.scene);

        // Panorama viewer
        this.panoramaViewer = new PanoramaViewer(
            this.scene,
            () => this.onPanoramaBack(),
            this.camera,
            this.renderer
        );
        this.panoramaViewer.setInfoOverlay(this.infoOverlay);
        this.panoramaViewer.setInfoPanel3D(this.infoPanel3D);
    }

    // ==================== ADMIN PANEL ====================

    initAdminPanel() {
        import('./components/AdminPanel.js').then(({ AdminPanel }) => {
            this.adminPanel = new AdminPanel(this.panoramaViewer);
            window.adminPanel = this.adminPanel;
        });
    }

    // ==================== BACKGROUND ====================

    createGradientBackground() {
        const geometry = new THREE.SphereGeometry(CONFIG.background.radius, 32, 32);
        geometry.scale(-1, 1, 1);

        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        // Solid dark background
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, w, h);

        // Minimalist grid — directional guide lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 2;

        // Horizon line
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Vertical cardinal lines (N, E, S, W)
        ctx.beginPath();
        for (let i = 0; i < w; i += w / 4) {
            ctx.moveTo(i, 0);
            ctx.lineTo(i, h);
        }
        ctx.stroke();

        // Zenith/Nadir rim markers
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(w, 0);
        ctx.moveTo(0, h); ctx.lineTo(w, h);
        ctx.stroke();

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const bgMesh = new THREE.Mesh(geometry, material);
        this.scene.add(bgMesh);
    }

    // ==================== EVENT HANDLERS ====================

    onPanoramaBack() {
        console.log('Back clicked - staying in museum.');
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
            } else if (el.mozRequestFullScreen) {
                el.mozRequestFullScreen();
            } else if (el.msRequestFullscreen) {
                el.msRequestFullscreen();
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

    getInteractables() {
        const list = [];
        if (this.panoramaViewer?.group?.visible) list.push(this.panoramaViewer.group);
        if (this.infoPanel3D?.group?.visible) list.push(this.infoPanel3D.group);
        return list;
    }

    // ==================== RENDER LOOP ====================

    render() {
        const delta = this.clock.getDelta();

        // Update controls
        if (this.isGyroEnabled && this.deviceOrientationControls) {
            this.deviceOrientationControls.update();
        } else if (this.controls) {
            this.controls.update();
        }

        // Build interactables list
        const interactables = this.getInteractables();

        // Update gaze controller
        if (this.gazeController) {
            this.gazeController.update(this.scene, interactables, delta);
        }

        // Update components
        if (this.panoramaViewer) {
            this.panoramaViewer.update(delta);
        }
        if (this.infoPanel3D) {
            this.infoPanel3D.update(delta);
        }

        // Render
        this.renderer.render(this.scene, this.camera);
    }

    // ==================== CLEANUP ====================

    dispose() {
        // Extracted modules
        this.inputHandler?.dispose();

        // Dispose components
        this.panoramaViewer?.dispose?.();
        this.gazeController?.dispose?.();

        // DOM cleanup
        this.debugInfo?.remove();
        this.vrButton?.remove();
        this.container?.remove();
    }
}

new App();