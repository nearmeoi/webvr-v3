import * as THREE from 'three';
import { StereoEffect } from './StereoEffect.js';
import { CardboardButton } from './CardboardButton.js';
import { CardboardUI } from './CardboardUI.js';
import { GyroscopeControls } from './GyroscopeControls.js';
import { CONFIG } from '../config.js';

/**
 * CardboardModeManager - Handles iOS Cardboard/Stereo VR mode
 * Extracted from main.js to reduce complexity
 */
export class CardboardModeManager {
    constructor(renderer, camera, controls) {
        this.renderer = renderer;
        this.camera = camera;
        this.controls = controls;

        this.stereoEffect = null;
        this.cardboardButton = null;
        this.cardboardUI = null;
        this.gyroscopeControls = null;

        this.isCardboardMode = false;
        this.gyroscopeEnabled = false;

        // Callbacks for component sync
        this.onModeChange = null;
    }

    /**
     * Initialize cardboard components (call for iOS/mobile devices)
     */
    init() {
        this.stereoEffect = new StereoEffect(this.renderer);
        this.cardboardButton = new CardboardButton(
            () => this.enter(),
            () => this.exit()
        );
        this.cardboardUI = new CardboardUI(
            () => this.exit(),
            (viewer) => this.onViewerChange(viewer)
        );
    }

    onViewerChange(viewer) {
        console.log('Viewer changed to:', viewer);
        if (this.onInteractionModeChange) {
            // v2 means button trigger, others use gaze timer for now
            const mode = (viewer === 'v2') ? 'button' : 'gaze';
            this.onInteractionModeChange(mode);
        }
    }

    /**
     * Initialize gyroscope controls (must be called after user gesture)
     */
    async initGyroscope() {
        if (this.gyroscopeEnabled) return true;

        if (this.gyroscopeControls) {
            this.gyroscopeControls.dispose();
        }

        this.gyroscopeControls = new GyroscopeControls(this.camera, this.renderer.domElement);

        try {
            console.log('Requesting gyroscope access...');
            const success = await this.gyroscopeControls.enable();

            if (success) {
                this.gyroscopeEnabled = true;
                console.log('Gyroscope controls initialized successfully');
                return true;
            } else {
                console.warn('Gyroscope initialization failed (Permission denied or sensor unavailable)');
                return false;
            }
        } catch (err) {
            console.error('Error during gyroscope initialization:', err);
            return false;
        }
    }

    /**
     * Enter Cardboard VR mode
     */
    async enter() {
        if (this.isCardboardMode) return;

        // Skip onboarding check
        const skipOnboarding = localStorage.getItem('skip-vr-onboarding') === 'true';
        if (!skipOnboarding && this.cardboardUI) {
            // Enter VR mode (Stereo) first so the modal is mirrored correctly
            await this.actuallyEnterVR();
            this.cardboardUI.showOnboarding((mode, dontShow) => {
                if (dontShow) {
                    localStorage.setItem('skip-vr-onboarding', 'true');
                    localStorage.setItem('vr-interaction-mode', mode);
                }
                if (this.onInteractionModeChange) this.onInteractionModeChange(mode);
            });
        } else {
            // Apply saved preference if skipped
            const savedMode = localStorage.getItem('vr-interaction-mode') || 'gaze';
            if (this.onInteractionModeChange) this.onInteractionModeChange(savedMode);
            await this.actuallyEnterVR();
        }
    }

    async actuallyEnterVR() {
        // Resume AudioContext if suspended (standard Web Audio policy)
        console.log('Resuming AudioContext if needed...');
        if (THREE.AudioContext && THREE.AudioContext.state === 'suspended') {
            await THREE.AudioContext.resume();
        }

        // Initialize gyroscope if needed
        console.log('Initializing Gyroscope if needed...');
        if (!this.gyroscopeEnabled) {
            const gyroSuccess = await this.initGyroscope();
            console.log('Gyro init success:', gyroSuccess);
        }

        // Enable stereo effect
        if (this.stereoEffect) {
            this.stereoEffect.enable();
        }

        // Request fullscreen (Bypass for iOS document level as it's unsupported)
        if (!/iPhone|iPod/.test(navigator.userAgent)) {
            await this.requestFullscreen();
        }

        // Set VR FOV
        this.camera.fov = CONFIG.fov.vr;
        this.camera.updateProjectionMatrix();

        this.isCardboardMode = true;

        // Show UI overlay (Mirrored HUD)
        if (this.cardboardUI) this.cardboardUI.show();

        // Notify listeners
        if (this.onModeChange) {
            this.onModeChange(true);
        }

        // Disable OrbitControls ONLY if Gyroscope is actually working
        // If gyro is blocked (e.g. HTTP IP access), keep touch enabled as fallback
        if (this.controls) {
            this.controls.enabled = this.gyroscopeEnabled ? false : true;
            console.log('VR Control Mode:', this.gyroscopeEnabled ? 'GYROSCOPE' : 'TOUCH FALLBACK (IP Access)');
        }

        console.log('Entered Cardboard VR mode');
    }

    update() {
        if (this.isCardboardMode && this.gyroscopeEnabled && this.gyroscopeControls) {
            this.gyroscopeControls.update();
        }
    }

    /**
     * Exit Cardboard VR mode
     * @param {boolean} keepFullscreen - If true, don't exit fullscreen
     */
    exit(keepFullscreen = false) {
        if (!this.isCardboardMode) return;

        // Exit fullscreen
        if (!keepFullscreen) {
            this.exitFullscreen();
        }

        // Sync button state
        if (this.cardboardButton) {
            this.cardboardButton.isInVR = false;
            this.cardboardButton.updateButtonStyle(false);
        }

        // Disable stereo effect
        if (this.stereoEffect) {
            this.stereoEffect.disable();
        }

        // Re-enable OrbitControls
        if (this.controls) {
            this.controls.enabled = true;
        }

        // Reset camera FOV
        this.camera.fov = CONFIG.fov.default;
        this.camera.updateProjectionMatrix();

        this.isCardboardMode = false;

        // Hide UI overlay
        if (this.cardboardUI) this.cardboardUI.hide();

        // Notify listeners
        if (this.onModeChange) {
            this.onModeChange(false);
        }

        console.log('Exited Cardboard VR mode');
    }

    /**
     * Render with stereo effect if in cardboard mode
     */
    render(scene, camera) {
        if (this.isCardboardMode && this.stereoEffect) {
            this.stereoEffect.render(scene, camera);
            return true;
        }
        return false;
    }

    // --- Fullscreen Helpers ---

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

    exitFullscreen() {
        try {
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(() => { });
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        } catch (e) {
            console.log('Exit fullscreen error:', e);
        }
    }

    dispose() {
        if (this.cardboardUI) this.cardboardUI.dispose();
        if (this.cardboardButton) this.cardboardButton.dispose?.();
    }
}
