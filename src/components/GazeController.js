import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class GazeController {
    constructor(camera, renderer) {
        this.camera = camera;
        this.renderer = renderer; // For WebXR camera access
        this.raycaster = new THREE.Raycaster();
        this.center = new THREE.Vector2(0, 0); // Normalized center screen

        // Reticle (Simple dot cursor)
        const reticleDistance = CONFIG.gaze.reticleDistance || 1.0;
        const reticleSize = CONFIG.gaze.reticleSize || 0.008;

        const geometry = new THREE.CircleGeometry(reticleSize, 32);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            opacity: 0.9,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.set(0, 0, -reticleDistance);
        this.camera.add(this.mesh);
        this.mesh.renderOrder = 999;

        // Progress indicator (Inner circle filling up)
        const progressGeo = new THREE.CircleGeometry(reticleSize * 1.5, 32);
        const progressMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        this.progressMesh = new THREE.Mesh(progressGeo, progressMat);
        this.progressMesh.scale.set(0, 0, 1);
        this.mesh.add(this.progressMesh);

        this.hoveredObject = null;
        this.hoverTime = 0;

        // Base activation time from config (fallback)
        this.baseActivationTime = CONFIG.gaze.activationTime || 1.5;
        this.currentActivationTime = this.baseActivationTime;
    }

    update(scene, interactables, delta) {
        // Use world position/direction for robust VR gaze
        const origin = new THREE.Vector3();
        const direction = new THREE.Vector3();

        // In WebXR mode, use the XR camera
        if (this.renderer && this.renderer.xr && this.renderer.xr.isPresenting) {
            const xrCamera = this.renderer.xr.getCamera();
            xrCamera.getWorldPosition(origin);
            xrCamera.getWorldDirection(direction);
        } else {
            this.camera.getWorldPosition(origin);
            this.camera.getWorldDirection(direction);
        }

        this.raycaster.set(origin, direction);

        // Force update world matrices before raycasting
        scene.updateMatrixWorld(true);

        const intersects = this.raycaster.intersectObjects(interactables, true); // Recursive check

        // Debug log every 60 frames (1 second at 60fps)
        this.debugCounter = (this.debugCounter || 0) + 1;
        if (this.debugCounter % 60 === 0) {
            console.log('[GAZE DEBUG] Interactables:', interactables.length, 'Intersects:', intersects.length);
            if (intersects.length > 0) {
                console.log('[GAZE DEBUG] First hit:', intersects[0].object.userData?.label || intersects[0].object.name || 'unknown', 'distance:', intersects[0].distance.toFixed(2));
            }
        }

        if (intersects.length > 0) {
            // Find first VISIBLE interactable object
            let target = null;
            for (let i = 0; i < intersects.length; i++) {
                let candidate = intersects[i].object;
                // Traverse up to find the interactable group/mesh
                while (candidate && !candidate.userData.isInteractable && candidate.parent) {
                    candidate = candidate.parent;
                }
                // Check if it's valid (interactable AND visible AND recursively visible)
                if (candidate && candidate.userData.isInteractable && candidate.visible) {
                    // Double check recursive visibility (Raycaster should handle this, but being safe)
                    let isVisible = true;
                    let parent = candidate.parent;
                    while (parent) {
                        if (!parent.visible) {
                            isVisible = false;
                            break;
                        }
                        parent = parent.parent;
                    }

                    if (isVisible) {
                        target = candidate;
                        break;
                    }
                }
            }

            if (target) {
                if (this.hoveredObject !== target) {
                    console.log('[GAZE] Found interactable:', target.userData?.label || target.name || 'unlabeled', 'hasOnClick:', !!target.onClick);
                    if (this.hoveredObject) this.onHoverOut(this.hoveredObject);
                    this.hoveredObject = target;

                    // Dynamic Activation Time Logic
                    // Check if object has specific activation time in userData
                    // Or check 'locationData' for orbital menu items if they carry specific logic
                    this.currentActivationTime = target.userData.activationTime || this.baseActivationTime;

                    this.onHoverIn(this.hoveredObject);
                    this.hoverTime = 0;
                }

                // Increment timer
                this.hoverTime += delta;

                // Calculate progress based on DYNAMIC time
                const progress = Math.min(this.hoverTime / this.currentActivationTime, 1);
                this.progressMesh.scale.set(progress, progress, 1);

                if (this.hoverTime >= this.currentActivationTime) {
                    console.log('[GAZE] TRIGGERING:', target.userData?.label || 'button');
                    this.trigger(target, intersects[0]);
                    this.hoverTime = 0; // Reset
                    this.progressMesh.scale.set(0, 0, 1);
                }
            } else {
                this.clearHover();
            }
        } else {
            this.clearHover();
        }
    }

    clearHover() {
        if (this.hoveredObject) {
            this.onHoverOut(this.hoveredObject);
            this.hoveredObject = null;
        }
        this.hoverTime = 0;
        this.progressMesh.scale.set(0, 0, 1);
    }

    onHoverIn(object) {
        if (object.onHoverIn) object.onHoverIn();
    }

    onHoverOut(object) {
        if (object.onHoverOut) object.onHoverOut();
    }

    trigger(object, intersection) {
        console.log('[GAZE] trigger() called. hasOnClick:', !!object.onClick, 'label:', object.userData?.label);
        console.log('[GAZE] onClick is:', typeof object.onClick, object.onClick ? object.onClick.toString().substring(0, 100) : 'N/A');
        if (object.onClick) {
            console.log('[GAZE] Calling onClick now!');
            try {
                object.onClick(intersection);
            } catch (err) {
                console.error('[GAZE] onClick ERROR:', err);
            }
        } else {
            console.log('[GAZE] WARNING: No onClick handler on object!');
        }
    }

    dispose() {
        if (this.mesh && this.camera) {
            this.camera.remove(this.mesh);
        }
        if (this.mesh) {
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
        if (this.progressMesh) {
            this.progressMesh.geometry.dispose();
            this.progressMesh.material.dispose();
        }
    }
}
