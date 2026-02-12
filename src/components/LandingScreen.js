import { requestGyroscopePermission } from '../utils/deviceDetection.js';

/**
 * LandingScreen — Handles the landing page UI and initial setup
 * (fullscreen, landscape lock, gyroscope permission, panorama load).
 */
export class LandingScreen {
    /**
     * @param {object} app - The main App instance
     */
    constructor(app) {
        this.app = app;
        this._init();
    }

    _init() {
        const landingScreen = document.getElementById('landing-screen');
        const enterBtn = document.getElementById('enter-vr-btn');

        if (!enterBtn) return;

        enterBtn.addEventListener('click', async () => {
            // Request fullscreen
            await this.app.requestFullscreen();

            // Lock landscape
            this.app.lockLandscape();

            // Resume audio context (required for autoplay policies)
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (AudioContext) {
                    const ctx = new AudioContext();
                    if (ctx.state === 'suspended') {
                        await ctx.resume();
                    }
                }
            } catch (e) {
                console.warn('Audio context resume failed:', e);
            }

            // Request Gyroscope Permission (iOS 13+)
            // Must be done on user gesture (click)
            try {
                const gyroGranted = await requestGyroscopePermission();
                if (gyroGranted) {
                    const hasRealGyro = await this._testGyroscope();
                    if (hasRealGyro) {
                        this.app.isGyroEnabled = true;
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

            // Load Lobby Panorama directly (normal mode, not VR)
            console.log('Loading Museum Lobby...');
            this.app.currentState = 'panorama';
            this.app.panoramaViewer.navigateToScene('assets/Museum Kota Makassar/lobby_C12D6770.jpg');
            this.app.panoramaViewer.setBackButtonVisibility(false);
            this.app.panoramaViewer.setAudioButtonsPosition('standalone');

            // Show VR Button after user starts experience
            if (this.app.vrButton) {
                this.app.vrButton.style.display =
                    (this.app.vrButton.id === 'vr-goggle-button') ? 'flex' : '';
            }
        });
    }

    /**
     * Test if a real gyroscope is present by waiting for a deviceorientation event.
     * @returns {Promise<boolean>}
     */
    _testGyroscope() {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                window.removeEventListener('deviceorientation', handler);
                resolve(false);
            }, 1000);

            const handler = (e) => {
                if (e.alpha !== null || e.beta !== null || e.gamma !== null) {
                    clearTimeout(timeout);
                    window.removeEventListener('deviceorientation', handler);
                    resolve(true);
                }
            };
            window.addEventListener('deviceorientation', handler);
        });
    }
}
