/**
 * VROverlay.js
 * Multi-step VR instruction overlay like Google Cardboard.
 * Step 1: Ask for VR mode permission
 * Step 2: Detect orientation - show "Rotate to Landscape" or "Scroll down" based on orientation
 */
export class VROverlay {
    constructor(onEnterVR) {
        this.onEnterVR = onEnterVR;
        this.overlay = null;
        this.currentStep = 0;
        this.isLandscape = false;
        this.orientationHandler = null;
        this.createOverlay();
    }

    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.id = 'vr-instruction-overlay';

        // White background, Google Cardboard style
        Object.assign(this.overlay.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            backgroundColor: '#ffffff',
            zIndex: '10000',
            display: 'none',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            color: '#333',
            fontFamily: "'Roboto', sans-serif"
        });

        document.body.appendChild(this.overlay);
    }

    show() {
        this.overlay.style.display = 'flex';
        this.currentStep = 1;
        this.renderStep1();
    }

    hide() {
        this.overlay.style.display = 'none';
        this.cleanupScrollMode();
        this.stopOrientationWatch();
    }

    // Remove all iOS scroll-related modifications
    cleanupScrollMode() {
        document.documentElement.classList.remove('ios-scroll-active');
        document.body.classList.remove('ios-scroll-active');
        if (this.scrollSpacer && this.scrollSpacer.parentNode) {
            this.scrollSpacer.parentNode.removeChild(this.scrollSpacer);
            this.scrollSpacer = null;
        }
        window.scrollTo(0, 0);
    }

    // Step 1: VR Mode Permission
    renderStep1() {
        this.overlay.innerHTML = `
            <div class="vr-overlay-content">
                <div class="vr-overlay-icon">
                    <svg viewBox="0 0 24 24" fill="#EA4335" width="80" height="80">
                        <path d="M20.74 6H3.21C2.55 6 2 6.57 2 7.28v10.44c0 .7.55 1.28 1.23 1.28h4.79c.52 0 .98-.34 1.14-.84l.99-3.11c.23-.71.88-1.19 1.62-1.19h.46c.74 0 1.39.48 1.62 1.19l.99 3.11c.16.5.63.84 1.14.84h4.79c.68 0 1.23-.57 1.23-1.28V7.28c0-.71-.55-1.28-1.26-1.28zM7.5 14.5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm9 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
                    </svg>
                    <span class="google-cardboard-text">Google<br>Cardboard</span>
                </div>
                <p class="vr-overlay-desc">Untuk melanjutkan ke mode VR, izinkan akses sensor gyroscope dan accelerometer.</p>
                <button id="vr-step1-continue" class="vr-overlay-btn primary">IZINKAN</button>
                <button id="vr-step1-cancel" class="vr-overlay-btn secondary">BATAL</button>
            </div>
        `;

        // Bind events
        this.overlay.querySelector('#vr-step1-continue').addEventListener('click', () => {
            this.requestSensorPermission();
        });
        this.overlay.querySelector('#vr-step1-cancel').addEventListener('click', () => {
            this.hide();
        });
    }

    async requestSensorPermission() {
        // Request DeviceMotion/Orientation permission (iOS 13+)
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            try {
                const response = await DeviceMotionEvent.requestPermission();
                if (response === 'granted') {
                    console.log('DeviceMotion permission granted');
                    this.goToStep2();
                } else {
                    alert('Izin sensor ditolak. Mode VR membutuhkan akses sensor.');
                }
            } catch (e) {
                console.log('DeviceMotion permission error:', e);
                // Fallback - proceed anyway (non-iOS or older iOS)
                this.goToStep2();
            }
        } else {
            // Not iOS 13+ or desktop - proceed directly
            console.log('DeviceMotion permission not required');
            this.goToStep2();
        }
    }

    // Step 2: Orientation Check
    goToStep2() {
        this.currentStep = 2;
        this.renderStep2();
        this.startOrientationWatch();
    }

    isAndroid() {
        return /Android/i.test(navigator.userAgent);
    }

    isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    renderStep2() {
        this.checkOrientation();

        if (this.isLandscape) {
            // On Android, skip the swipe step - enter VR directly
            if (this.isAndroid()) {
                console.log('Android detected + Landscape: Auto-entering VR...');
                this.hide();
                if (this.onEnterVR) this.onEnterVR();
                return;
            }
            // On iOS, show swipe instruction
            this.renderLandscapeInstruction();
        } else {
            this.renderPortraitInstruction();
        }
    }

    renderPortraitInstruction() {
        this.overlay.innerHTML = `
            <div class="vr-overlay-content">
                <div class="vr-overlay-icon">
                    <svg viewBox="0 0 24 24" fill="#EA4335" width="64" height="64" style="position: absolute; top: 20px; right: 20px;">
                        <path d="M20.74 6H3.21C2.55 6 2 6.57 2 7.28v10.44c0 .7.55 1.28 1.23 1.28h4.79c.52 0 .98-.34 1.14-.84l.99-3.11c.23-.71.88-1.19 1.62-1.19h.46c.74 0 1.39.48 1.62 1.19l.99 3.11c.16.5.63.84 1.14.84h4.79c.68 0 1.23-.57 1.23-1.28V7.28c0-.71-.55-1.28-1.26-1.28zM7.5 14.5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm9 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
                    </svg>
                    <span class="google-cardboard-label">Google Cardboard</span>
                </div>
                <div class="rotate-icon">
                    <svg viewBox="0 0 100 100" width="100" height="100">
                        <rect x="25" y="10" width="50" height="80" rx="5" fill="none" stroke="#333" stroke-width="3"/>
                        <path d="M50 5 L60 15 L55 15 L55 25 L45 25 L45 15 L40 15 Z" fill="#333"/>
                        <text x="50" y="60" text-anchor="middle" font-size="10" fill="#666">90°</text>
                    </svg>
                </div>
                <p class="vr-overlay-instruction">Putar ponsel ke mode<br><strong>Landscape</strong></p>
            </div>
        `;
    }

    renderLandscapeInstruction() {
        // Record initial height to detect toolbar hide
        this.initialViewportHeight = window.innerHeight;

        // iOS Safari: enable page scroll to hide address bar
        // 1. Add scroll classes to html + body (overrides overflow:hidden)
        document.documentElement.classList.add('ios-scroll-active');
        document.body.classList.add('ios-scroll-active');

        // 2. Add spacer element to make page taller than viewport
        if (!this.scrollSpacer) {
            this.scrollSpacer = document.createElement('div');
            this.scrollSpacer.id = 'ios-scroll-spacer';
            Object.assign(this.scrollSpacer.style, {
                width: '100%',
                height: '50vh',
                pointerEvents: 'none',
                background: 'transparent'
            });
            document.body.appendChild(this.scrollSpacer);
        }

        // 3. Prime the scroll (triggers iOS to allow address bar hide)
        setTimeout(() => window.scrollTo(0, 1), 100);

        this.overlay.innerHTML = `
            <div class="vr-overlay-content landscape">
                <div class="vr-overlay-icon-corner">
                    <svg viewBox="0 0 24 24" fill="#EA4335" width="48" height="48">
                        <path d="M20.74 6H3.21C2.55 6 2 6.57 2 7.28v10.44c0 .7.55 1.28 1.23 1.28h4.79c.52 0 .98-.34 1.14-.84l.99-3.11c.23-.71.88-1.19 1.62-1.19h.46c.74 0 1.39.48 1.62 1.19l.99 3.11c.16.5.63.84 1.14.84h4.79c.68 0 1.23-.57 1.23-1.28V7.28c0-.71-.55-1.28-1.26-1.28zM7.5 14.5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm9 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
                    </svg>
                    <span>Google Cardboard</span>
                </div>
                <div class="swipe-icon">
                    <svg viewBox="0 0 100 100" width="80" height="80">
                        <path d="M50 80 L50 20" stroke="#333" stroke-width="3" fill="none"/>
                        <path d="M35 35 L50 20 L65 35" stroke="#333" stroke-width="3" fill="none"/>
                        <ellipse cx="50" cy="85" rx="15" ry="10" fill="none" stroke="#333" stroke-width="2"/>
                    </svg>
                </div>
                <p class="vr-overlay-instruction">Geser ke atas untuk masuk<br><strong>Fullscreen Mode</strong></p>
                <p class="vr-overlay-hint">atau ketuk tombol di bawah</p>
                <button id="vr-step2-enter" class="vr-overlay-btn primary">MASUK VR</button>
            </div>
        `;

        // Fallback button click
        const enterBtn = this.overlay.querySelector('#vr-step2-enter');
        if (enterBtn) {
            enterBtn.addEventListener('click', () => {
                console.log('iOS fallback button clicked');
                this.stopFullscreenWatch();
                this.hide();
                if (this.onEnterVR) this.onEnterVR();
            });
        }

        // Start watching for fullscreen (toolbar hide)
        this.startFullscreenWatch();
    }


    // Detect when Safari toolbar is hidden (viewport height increases)
    startFullscreenWatch() {
        this.fullscreenHandler = () => {
            const currentHeight = window.innerHeight;
            const heightDiff = currentHeight - this.initialViewportHeight;

            // If height increased by more than 30px, toolbar is likely hidden
            // Also check if we're close to screen.availHeight (minus some buffer)
            const isFullscreen = heightDiff > 30 ||
                (window.innerHeight >= screen.availHeight - 50);

            console.log(`Viewport: ${this.initialViewportHeight} -> ${currentHeight}, diff: ${heightDiff}, fullscreen: ${isFullscreen}`);

            if (isFullscreen && this.currentStep === 2 && this.isLandscape) {
                console.log('Fullscreen detected! Auto-entering VR...');
                this.stopFullscreenWatch();
                this.hide();
                if (this.onEnterVR) this.onEnterVR();
            }
        };

        // Check on resize (Safari fires this when toolbar hides)
        window.addEventListener('resize', this.fullscreenHandler);

        // Also use scroll to trigger the toolbar hide
        window.addEventListener('scroll', this.fullscreenHandler);

        // Touch events for swipe detection
        this.touchStartY = 0;
        this.touchHandler = (e) => {
            if (e.type === 'touchstart') {
                this.touchStartY = e.touches[0].clientY;
            } else if (e.type === 'touchend') {
                const touchEndY = e.changedTouches[0].clientY;
                const swipeUp = this.touchStartY - touchEndY > 50;
                if (swipeUp) {
                    // Give Safari a moment to hide the toolbar
                    setTimeout(() => this.fullscreenHandler(), 300);
                }
            }
        };

        this.overlay.addEventListener('touchstart', this.touchHandler);
        this.overlay.addEventListener('touchend', this.touchHandler);
    }

    stopFullscreenWatch() {
        if (this.fullscreenHandler) {
            window.removeEventListener('resize', this.fullscreenHandler);
            window.removeEventListener('scroll', this.fullscreenHandler);
            this.fullscreenHandler = null;
        }
        if (this.touchHandler && this.overlay) {
            this.overlay.removeEventListener('touchstart', this.touchHandler);
            this.overlay.removeEventListener('touchend', this.touchHandler);
            this.touchHandler = null;
        }
    }

    checkOrientation() {
        this.isLandscape = window.innerWidth > window.innerHeight;
    }

    startOrientationWatch() {
        this.orientationHandler = () => {
            const wasLandscape = this.isLandscape;
            this.checkOrientation();

            // Only re-render if orientation changed
            if (wasLandscape !== this.isLandscape && this.currentStep === 2) {
                this.stopFullscreenWatch(); // Stop old watcher
                this.renderStep2();
            }
        };

        window.addEventListener('resize', this.orientationHandler);
        window.addEventListener('orientationchange', this.orientationHandler);
    }

    stopOrientationWatch() {
        if (this.orientationHandler) {
            window.removeEventListener('resize', this.orientationHandler);
            window.removeEventListener('orientationchange', this.orientationHandler);
            this.orientationHandler = null;
        }
        this.stopFullscreenWatch();
    }

    dispose() {
        this.stopOrientationWatch();
        this.cleanupScrollMode();
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
    }
}

