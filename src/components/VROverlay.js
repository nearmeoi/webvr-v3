/**
 * VROverlay.js
 * Manages the Pre-VR instruction screen.
 * Shows "Rotate Phone" instruction and "ENTER VR" button.
 * This ensures we have a valid user gesture to trigger fullscreen and VR session.
 */
export class VROverlay {
    constructor(onEnterVR) {
        this.onEnterVR = onEnterVR;
        this.overlay = null;
        this.createOverlay();
    }

    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'vr-instruction-overlay';

        // Structure:
        // - Icon (Rotate Phone / VR Headset)
        // - Text Instructions
        // - Enter Button
        this.overlay.innerHTML = `
            <div class="vr-overlay-content">
                <div class="vr-overlay-icon">
                    <svg viewBox="0 0 24 24" fill="white" width="64" height="64">
                         <path d="M23.25 12.77l-2.57-2.57-1.41 1.41 2.57 2.57-2.57 2.57 1.41 1.41 2.57-2.57c.78-.78.78-2.05 0-2.82zM.75 12.77l2.57 2.57 1.41-1.41-2.57-2.57 2.57-2.57-1.41-1.41-2.57 2.57c-.78.78-.78 2.05 0 2.82zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
                    </svg>
                </div>
                <h2>Enter VR Mode</h2>
                <p>1. Rotate your phone to landscape.</p>
                <p>2. Place phone into Cardboard viewer.</p>
                <button id="vr-overlay-enter-btn">ENTER VR</button>
                <button id="vr-overlay-cancel-btn">CANCEL</button>
            </div>
        `;

        // Styles are in style.css, but we set base styles here to ensure visibility
        Object.assign(this.overlay.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0,0,0,0.9)',
            zIndex: '10000',
            display: 'none',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            color: 'white',
            fontFamily: 'sans-serif'
        });

        document.body.appendChild(this.overlay);

        // Bind events
        const enterBtn = this.overlay.querySelector('#vr-overlay-enter-btn');
        const cancelBtn = this.overlay.querySelector('#vr-overlay-cancel-btn');

        enterBtn.addEventListener('click', () => {
            this.hide();
            if (this.onEnterVR) this.onEnterVR();
        });

        cancelBtn.addEventListener('click', () => {
            this.hide();
        });
    }

    show() {
        this.overlay.style.display = 'flex';
    }

    hide() {
        this.overlay.style.display = 'none';
    }

    dispose() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
    }
}
