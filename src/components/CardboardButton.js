import { isIOS, isMobile, isCardboardForced } from '../utils/deviceDetection.js';

/**
 * Creates a VR button specifically for iOS devices
 * Triggers Cardboard-style stereo rendering with gyroscope
 */
export class CardboardButton {
    constructor(onEnterVR, onExitVR) {
        this.onEnterVR = onEnterVR;
        this.onExitVR = onExitVR;
        this.isInVR = false;
        this.button = null;

        // Create button for iOS devices OR when forced via URL (?cardboard=true)
        if (isIOS() || isCardboardForced()) {
            this.createButton();
        }
    }

    createButton() {
        this.button = document.createElement('button');
        this.button.id = 'cardboard-vr-button';

        this.updateButtonStyle(false);
        this.button.textContent = 'ENTER VR';

        this.button.addEventListener('click', () => {
            if (this.isInVR) {
                this.exitVR();
            } else {
                this.enterVR();
            }
        });

        document.body.appendChild(this.button);
    }

    updateButtonStyle(inVR) {
        if (!this.button) return;

        Object.assign(this.button.style, {
            position: 'absolute',
            bottom: '20px',
            padding: '12px 24px',
            border: '1px solid #fff',
            borderRadius: '4px',
            background: inVR ? 'rgba(255,100,100,0.6)' : 'rgba(0,0,0,0.6)',
            color: '#fff',
            font: 'bold 14px sans-serif',
            textAlign: 'center',
            cursor: 'pointer',
            zIndex: '999',
            left: '50%',
            transform: 'translateX(-50%)',
            outline: 'none',
            WebkitTapHighlightColor: 'transparent',
            display: inVR ? 'none' : 'block' // Hide in VR
        });

        this.button.textContent = inVR ? 'EXIT VR' : 'ENTER VR';
    }

    async enterVR() {
        if (this.isInVR) return;

        // Request fullscreen for immersive experience
        try {
            const docEl = document.documentElement;
            if (docEl.requestFullscreen) {
                await docEl.requestFullscreen();
            } else if (docEl.webkitRequestFullscreen) {
                await docEl.webkitRequestFullscreen();
            }
        } catch (e) {
            console.log('Fullscreen not available:', e);
        }

        // Lock to landscape if possible
        try {
            if (screen.orientation && screen.orientation.lock) {
                await screen.orientation.lock('landscape');
            }
        } catch (e) {
            console.log('Orientation lock not available:', e);
        }

        this.isInVR = true;
        this.updateButtonStyle(true);

        if (this.onEnterVR) this.onEnterVR();
    }

    exitVR() {
        if (!this.isInVR) return;

        // Exit fullscreen
        try {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        } catch (e) {
            console.log('Exit fullscreen error:', e);
        }

        // Unlock orientation
        try {
            if (screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }
        } catch (e) {
            console.log('Orientation unlock error:', e);
        }

        this.isInVR = false;
        this.updateButtonStyle(false);

        if (this.onExitVR) this.onExitVR();
    }

    dispose() {
        if (this.button && this.button.parentNode) {
            this.button.parentNode.removeChild(this.button);
        }
    }
}
