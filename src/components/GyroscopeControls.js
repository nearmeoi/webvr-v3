import * as THREE from 'three';
import { requestGyroscopePermission, hasGyroscope, isIOS } from '../utils/deviceDetection.js';

/**
 * GyroscopeControls - Provides device orientation-based camera control
 * Primarily for iOS devices where WebXR is not available
 */
export class GyroscopeControls {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;
        this.enabled = false;
        this.permissionGranted = false;

        // Device orientation values
        this.deviceOrientation = { alpha: 0, beta: 0, gamma: 0 };
        this.screenOrientation = 0;

        // Helper objects for rotation
        this.zee = new THREE.Vector3(0, 0, 1);
        this.euler = new THREE.Euler();
        this.q0 = new THREE.Quaternion();
        this.q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 around X

        // Initial camera state
        this.initialQuaternion = new THREE.Quaternion();

        // Smoothing
        this.smoothedQuaternion = new THREE.Quaternion();
        this.smoothFactor = 0.1;

        // Bind handlers
        this.onDeviceOrientation = this.onDeviceOrientation.bind(this);
        this.onScreenOrientation = this.onScreenOrientation.bind(this);
    }

    /**
     * Request permission and enable controls
     * Must be called from a user gesture (click/tap)
     */
    async enable() {
        if (!hasGyroscope()) {
            console.log('Gyroscope not available');
            return false;
        }

        // Request permission on iOS 13+
        if (isIOS()) {
            this.permissionGranted = await requestGyroscopePermission();
            if (!this.permissionGranted) {
                console.log('Gyroscope permission denied');
                return false;
            }
        } else {
            this.permissionGranted = true;
        }

        // Store initial camera orientation
        this.initialQuaternion.copy(this.camera.quaternion);

        // Add event listeners
        window.addEventListener('deviceorientation', this.onDeviceOrientation, false);
        window.addEventListener('orientationchange', this.onScreenOrientation, false);

        // Get initial screen orientation
        this.screenOrientation = window.orientation || 0;

        this.enabled = true;
        console.log('Gyroscope controls enabled');
        return true;
    }

    disable() {
        window.removeEventListener('deviceorientation', this.onDeviceOrientation);
        window.removeEventListener('orientationchange', this.onScreenOrientation);
        this.enabled = false;
    }

    onDeviceOrientation(event) {
        if (!this.enabled) return;

        // Check for valid data (iOS sometimes sends nulls initially)
        if (event.alpha === null || event.beta === null || event.gamma === null) return;

        this.deviceOrientation = {
            alpha: event.alpha || 0,  // Z axis (compass direction)
            beta: event.beta || 0,    // X axis (front-to-back tilt)
            gamma: event.gamma || 0   // Y axis (left-to-right tilt)
        };
    }

    onScreenOrientation() {
        this.screenOrientation = window.orientation || 0;
    }

    update() {
        if (!this.enabled) return;

        // Skip if we haven't received valid orientation yet (prevent camera drop)
        // A perfectly flat device (0,0,0) is unlikely in VR use case (vertical face)
        if (this.deviceOrientation.alpha === 0 &&
            this.deviceOrientation.beta === 0 &&
            this.deviceOrientation.gamma === 0) {
            return;
        }

        const alpha = THREE.MathUtils.degToRad(this.deviceOrientation.alpha);
        const beta = THREE.MathUtils.degToRad(this.deviceOrientation.beta);
        const gamma = THREE.MathUtils.degToRad(this.deviceOrientation.gamma);
        const orient = THREE.MathUtils.degToRad(this.screenOrientation);

        // Set rotation order
        this.euler.set(beta, alpha, -gamma, 'YXZ');

        // Create quaternion from euler
        const targetQuaternion = new THREE.Quaternion();
        targetQuaternion.setFromEuler(this.euler);

        // Adjust for screen orientation
        targetQuaternion.multiply(this.q1);
        targetQuaternion.multiply(this.q0.setFromAxisAngle(this.zee, -orient));

        // Smooth the rotation
        this.smoothedQuaternion.slerp(targetQuaternion, this.smoothFactor);

        // Apply to camera
        this.camera.quaternion.copy(this.smoothedQuaternion);
    }

    dispose() {
        this.disable();
    }
}
