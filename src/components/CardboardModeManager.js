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
            () => console.log('Settings clicked')
        );
    }

    /**
     * Initialize gyroscope controls (must be called after user gesture)
     */
    async initGyroscope() {
        if (this.gyroscopeEnabled) return true;

        this.gyroscopeControls = new GyroscopeControls(this.camera, this.renderer.domElement);
        const success = await this.gyroscopeControls.enable();

        if (success) {
            this.gyroscopeEnabled = true;
            console.log('Gyroscope controls initialized');
        } else {
            console.log('Gyroscope initialization failed, using touch controls');
        }

        return success;
    }

    /**
     * Enter Cardboard VR mode
     */
    async enter() {
        if (this.isCardboardMode) return;

        // Initialize gyroscope if needed
        if (!this.gyroscopeEnabled) {
            await this.initGyroscope();
        }

        // Enable stereo effect
        if (this.stereoEffect) {
            this.stereoEffect.enable();
        }

        // Request fullscreen
        await this.requestFullscreen();

        // Set VR FOV
        this.camera.fov = CONFIG.fov.vr;
        this.camera.updateProjectionMatrix();

        this.isCardboardMode = true;

        // Show UI overlay
        if (this.cardboardUI) this.cardboardUI.show();

        // Notify listeners
        if (this.onModeChange) {
            this.onModeChange(true);
        }

        console.log('Entered Cardboard VR mode');
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
     * Update gyroscope controls (call in render loop)
     */
    update() {
        if (this.gyroscopeControls && this.gyroscopeEnabled) {
            this.gyroscopeControls.update();
        }
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
