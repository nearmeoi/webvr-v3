/**
 * WebVR Integration Helper
 * Uses the webvr-polyfill to provide VR mode on iOS and other devices
 * that don't natively support WebVR/WebXR
 */
export class WebVRHelper {
    constructor(renderer, camera, scene) {
        this.renderer = renderer;
        this.camera = camera;
        this.scene = scene;

        this.vrDisplay = null;
        this.isPresenting = false;
        this.frameData = null;
        this.vrButton = null;

        this.onEnterVR = null;
        this.onExitVR = null;
    }

    async init() {
        // Check if getVRDisplays is available (polyfill or native)
        if (!navigator.getVRDisplays) {
            console.warn('WebVR not available');
            return false;
        }

        try {
            const displays = await navigator.getVRDisplays();
            console.log('VR Displays found:', displays.length);

            if (displays.length > 0) {
                this.vrDisplay = displays[0];
                console.log('Using VR Display:', this.vrDisplay.displayName);

                // Create VRFrameData for pose info
                if (window.VRFrameData) {
                    this.frameData = new VRFrameData();
                }

                // Listen for present changes
                window.addEventListener('vrdisplaypresentchange', () => {
                    this.isPresenting = this.vrDisplay.isPresenting;
                    console.log('VR Present change:', this.isPresenting);

                    if (this.isPresenting) {
                        if (this.onEnterVR) this.onEnterVR();
                    } else {
                        if (this.onExitVR) this.onExitVR();
                    }
                });

                return true;
            }
        } catch (e) {
            console.error('Error getting VR displays:', e);
        }

        return false;
    }

    createButton() {
        if (!this.vrDisplay) return null;

        const button = document.createElement('button');
        button.id = 'webvr-button';
        button.textContent = 'ENTER VR';

        Object.assign(button.style, {
            position: 'absolute',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '12px 24px',
            border: '1px solid #fff',
            borderRadius: '4px',
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
            font: 'bold 14px sans-serif',
            cursor: 'pointer',
            zIndex: '999'
        });

        button.addEventListener('click', () => {
            if (this.isPresenting) {
                this.exitVR();
            } else {
                this.enterVR();
            }
        });

        document.body.appendChild(button);
        this.vrButton = button;

        return button;
    }

    async enterVR() {
        if (!this.vrDisplay) {
            console.warn('No VR display available');
            return false;
        }

        try {
            // Request present with the canvas
            const canvas = this.renderer.domElement;

            // For VR, we need to configure the renderer
            this.renderer.xr.enabled = false; // Disable WebXR if any

            await this.vrDisplay.requestPresent([{
                source: canvas
            }]);

            console.log('Entered VR presentation');
            this.updateButton(true);
            return true;
        } catch (e) {
            console.error('Error entering VR:', e);
            return false;
        }
    }

    exitVR() {
        if (!this.vrDisplay || !this.isPresenting) return;

        try {
            this.vrDisplay.exitPresent();
            this.updateButton(false);
        } catch (e) {
            console.error('Error exiting VR:', e);
        }
    }

    updateButton(presenting) {
        if (!this.vrButton) return;

        this.vrButton.textContent = presenting ? 'EXIT VR' : 'ENTER VR';
        this.vrButton.style.background = presenting
            ? 'rgba(255,100,100,0.6)'
            : 'rgba(0,0,0,0.6)';
    }

    /**
     * Call this in your render loop
     */
    render() {
        if (!this.vrDisplay || !this.isPresenting) {
            // Normal render
            this.renderer.render(this.scene, this.camera);
            return;
        }

        // VR render
        if (this.frameData) {
            this.vrDisplay.getFrameData(this.frameData);
        }

        // Get eye parameters
        const leftEye = this.vrDisplay.getEyeParameters('left');
        const rightEye = this.vrDisplay.getEyeParameters('right');

        // Get render size
        const width = this.renderer.domElement.width;
        const height = this.renderer.domElement.height;

        // Enable scissor test for split rendering
        this.renderer.setScissorTest(true);

        // Render left eye
        this.setupEyeCamera(this.camera, this.frameData, 'left');
        this.renderer.setScissor(0, 0, width / 2, height);
        this.renderer.setViewport(0, 0, width / 2, height);
        this.renderer.render(this.scene, this.camera);

        // Render right eye
        this.setupEyeCamera(this.camera, this.frameData, 'right');
        this.renderer.setScissor(width / 2, 0, width / 2, height);
        this.renderer.setViewport(width / 2, 0, width / 2, height);
        this.renderer.render(this.scene, this.camera);

        // Reset
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, width, height);

        // Submit frame to display
        this.vrDisplay.submitFrame();
    }

    setupEyeCamera(camera, frameData, eye) {
        if (!frameData) return;

        const view = eye === 'left'
            ? frameData.leftViewMatrix
            : frameData.rightViewMatrix;
        const proj = eye === 'left'
            ? frameData.leftProjectionMatrix
            : frameData.rightProjectionMatrix;

        if (view) {
            // Apply view matrix to camera
            camera.matrixWorldInverse.fromArray(view);
            camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
        }

        if (proj) {
            camera.projectionMatrix.fromArray(proj);
        }
    }

    /**
     * Use this instead of requestAnimationFrame when in VR
     */
    requestAnimationFrame(callback) {
        if (this.vrDisplay && this.isPresenting) {
            return this.vrDisplay.requestAnimationFrame(callback);
        }
        return window.requestAnimationFrame(callback);
    }

    dispose() {
        if (this.vrButton && this.vrButton.parentNode) {
            this.vrButton.parentNode.removeChild(this.vrButton);
        }
    }
}
