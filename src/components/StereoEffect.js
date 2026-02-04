import * as THREE from 'three';

/**
 * StereoEffect - Creates a stereoscopic (side-by-side) rendering effect
 * With barrel distortion and vignette to simulate VR headset lens
 * For use with VR headsets like Google Cardboard on iOS devices
 */
export class StereoEffect {
    constructor(renderer) {
        this.renderer = renderer;

        // Stereo camera setup
        this.stereo = new THREE.StereoCamera();
        this.stereo.eyeSep = 0.064; // Default IPD

        // Store original renderer settings
        this._size = new THREE.Vector2();
        this._rendererSize = new THREE.Vector2();

        this.enabled = false;

        // Create render targets for post-processing
        this.renderTargetL = null;
        this.renderTargetR = null;

        // Create barrel distortion material
        this.distortionMaterial = this.createDistortionMaterial();

        // Create full-screen quad for post-processing
        this.quadGeometry = new THREE.PlaneGeometry(2, 2);
        this.quadMeshL = new THREE.Mesh(this.quadGeometry, this.distortionMaterial.clone());
        this.quadMeshR = new THREE.Mesh(this.quadGeometry, this.distortionMaterial.clone());

        // Orthographic camera for post-processing
        this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
        this.orthoCamera.position.z = 1;

        // Scene for post-processing
        this.postScene = new THREE.Scene();

        // Black divider
        this.divider = null;
        this.createDivider();
    }

    createDistortionMaterial() {
        // Barrel distortion shader - simulates VR lens
        const vertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const fragmentShader = `
            uniform sampler2D tDiffuse;
            uniform vec2 resolution;
            uniform float distortion;
            uniform float vignetteStrength;
            
            varying vec2 vUv;

        void main() {
                // Pass-through without distortion for rectangular view
                vec2 uv = vUv;
                
                vec4 color = texture2D(tDiffuse, uv);

            // Vignette removed

            gl_FragColor = color;
        }
        `;

        return new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                resolution: { value: new THREE.Vector2() },
                distortion: { value: 0.0 }, // Disabled
                vignetteStrength: { value: 0.0 } // Disabled
            },

            vertexShader,
            fragmentShader,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide
        });
    }

    createDivider() {
        // Divider is now handled by 2D UI overlay, hiding this 3D one or keeping it as backup
        // Keeping it invisible for now to rely on UI overlay
        const dividerGeometry = new THREE.PlaneGeometry(0.002, 2); // Thinner
        const dividerMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            depthTest: false,
            depthWrite: false,
            visible: false // Hiding 3D divider
        });
        this.divider = new THREE.Mesh(dividerGeometry, dividerMaterial);
        this.divider.position.set(0, 0, -0.5);
    }

    setEyeSeparation(eyeSep) {
        this.stereo.eyeSep = eyeSep;
    }

    setDistortion(value) {
        this.quadMeshL.material.uniforms.distortion.value = value;
        this.quadMeshR.material.uniforms.distortion.value = value;
    }

    enable() {
        this.enabled = true;
        this.renderer.setPixelRatio(1);

        // Save original clear color
        this._originalClearColor = new THREE.Color();
        this.renderer.getClearColor(this._originalClearColor);
        this._originalClearAlpha = this.renderer.getClearAlpha();

        // Create render targets at current size
        this.renderer.getSize(this._size);

        // Ensure we have valid dimensions
        const width = Math.max(this._size.width, 100);
        const height = Math.max(this._size.height, 100);
        const halfWidth = Math.floor(width / 2);

        console.log('StereoEffect enabling with size:', halfWidth, 'x', height);

        // Dispose existing render targets if any
        if (this.renderTargetL) {
            this.renderTargetL.dispose();
        }
        if (this.renderTargetR) {
            this.renderTargetR.dispose();
        }

        this.renderTargetL = new THREE.WebGLRenderTarget(halfWidth, height, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            depthBuffer: true,
            stencilBuffer: false
        });

        this.renderTargetR = new THREE.WebGLRenderTarget(halfWidth, height, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            depthBuffer: true,
            stencilBuffer: false
        });

        // Update material uniforms
        this.quadMeshL.material.uniforms.tDiffuse.value = this.renderTargetL.texture;
        this.quadMeshR.material.uniforms.tDiffuse.value = this.renderTargetR.texture;
        this.quadMeshL.material.uniforms.resolution.value.set(halfWidth, height);
        this.quadMeshR.material.uniforms.resolution.value.set(halfWidth, height);

        // Mark materials as needing update
        this.quadMeshL.material.needsUpdate = true;
        this.quadMeshR.material.needsUpdate = true;

        console.log('StereoEffect enabled successfully');
    }

    disable() {
        this.enabled = false;
        this.renderer.setPixelRatio(window.devicePixelRatio);

        // Dispose render targets
        if (this.renderTargetL) {
            this.renderTargetL.dispose();
            this.renderTargetL = null;
        }
        if (this.renderTargetR) {
            this.renderTargetR.dispose();
            this.renderTargetR = null;
        }
    }

    getSize() {
        this.renderer.getSize(this._rendererSize);
        return this._rendererSize;
    }

    setSize(width, height) {
        this.renderer.setSize(width, height);

        if (this.enabled) {
            const halfWidth = Math.floor(width / 2);
            this.renderTargetL?.setSize(halfWidth, height);
            this.renderTargetR?.setSize(halfWidth, height);
            this.quadMeshL.material.uniforms.resolution.value.set(halfWidth, height);
            this.quadMeshR.material.uniforms.resolution.value.set(halfWidth, height);
        }
    }

    render(scene, camera) {
        if (!this.enabled) {
            this.renderer.render(scene, camera);
            return;
        }

        // Safety check - ensure render targets exist
        if (!this.renderTargetL || !this.renderTargetR) {
            console.warn('StereoEffect: Render targets not ready, falling back to normal render');
            this.renderer.render(scene, camera);
            return;
        }

        this.renderer.getSize(this._size);

        // Ensure valid size
        if (this._size.width === 0 || this._size.height === 0) {
            console.warn('StereoEffect: Invalid renderer size');
            return;
        }

        // Update stereo cameras from the main camera
        this.stereo.update(camera);

        const halfWidth = Math.floor(this._size.width / 2);

        // Store current state
        const currentRenderTarget = this.renderer.getRenderTarget();
        const currentScissorTest = this.renderer.getScissorTest();

        try {
            // Update stereo cameras from the main camera
            camera.updateMatrixWorld(); // Ensure camera matrix is up to date

            const originalAspect = camera.aspect;
            camera.aspect = (this._size.width / 2) / this._size.height;
            camera.updateProjectionMatrix();

            this.stereo.update(camera);

            // Restore original aspect ratio
            camera.aspect = originalAspect;
            camera.updateProjectionMatrix();

            const width = this._size.width;
            const height = this._size.height;

            this.renderer.setScissorTest(true);
            this.renderer.setClearColor(0x000000, 1);
            this.renderer.clearColor(); // Clear color buffer

            // Render Left Eye
            this.renderer.setScissor(0, 0, width / 2, height);
            this.renderer.setViewport(0, 0, width / 2, height);
            this.renderer.render(scene, this.stereo.cameraL);

            // Render Right Eye
            this.renderer.setScissor(width / 2, 0, width / 2, height);
            this.renderer.setViewport(width / 2, 0, width / 2, height);
            this.renderer.render(scene, this.stereo.cameraR);

            this.renderer.setScissorTest(false);
        } catch (e) {
            console.error('StereoEffect render error:', e);
            // Fallback to normal render
            this.renderer.setRenderTarget(null);
            this.renderer.setScissorTest(false);
            this.renderer.setViewport(0, 0, this._size.width, this._size.height);
            this.renderer.render(scene, camera);
        }
    }

    dispose() {
        this.disable();
        this.quadGeometry.dispose();
        this.quadMeshL.material.dispose();
        this.quadMeshR.material.dispose();
        this.divider.geometry.dispose();
        this.divider.material.dispose();
    }
}
