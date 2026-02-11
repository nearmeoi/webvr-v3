import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class GazeController {
    constructor(scene, camera, renderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer; // For WebXR camera access
        this.raycaster = new THREE.Raycaster();
        this.center = new THREE.Vector2(0, 0); // Normalized center screen

        // Reticle (Simple dot cursor)
        this.reticleDistance = CONFIG.gaze.reticleDistance || 1.0;
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
        // Position will be updated in update() loop
        this.scene.add(this.mesh);
        this.mesh.renderOrder = 10001; // Higher than hotspots (9999)

        // Progress indicator (Inner circle filling up)
        const progressGeo = new THREE.CircleGeometry(reticleSize * 1.5, 32);
        const progressMat = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            depthTest: false,
            depthWrite: false,
            transparent: true
        });
        this.progressMesh = new THREE.Mesh(progressGeo, progressMat);
        this.progressMesh.renderOrder = 10002;
        this.progressMesh.scale.set(0, 0, 1);
        this.mesh.add(this.progressMesh);

        this.hoveredObject = null;
        this.hoverTime = 0;

        // Interaction Mode: 'gaze' (timer) or 'button' (manual)
        this.interactionMode = 'gaze';

        // Base activation time from config (fallback)
        this.baseActivationTime = CONFIG.gaze.activationTime || 1.5;
        this.currentActivationTime = this.baseActivationTime;

        // Trigger lock to prevent "through-click" navigation issues
        this.triggerLockTime = 0;
    }

    setInteractionMode(mode) {
        console.log('[GAZE] Setting interaction mode to:', mode);
        this.interactionMode = mode;
        this.clearHover();
    }

    update(scene, interactables, delta) {
        if (this.triggerLockTime > 0) {
            this.triggerLockTime -= delta;
            this.clearHover();
            return;
        }

        // Use world position/direction for robust VR gaze
        const origin = new THREE.Vector3();
        const direction = new THREE.Vector3();

        // In WebXR mode, use the XR camera
        let currentCamera = this.camera;
        if (this.renderer && this.renderer.xr && this.renderer.xr.isPresenting) {
            const xrCamera = this.renderer.xr.getCamera();
            xrCamera.getWorldPosition(origin);
            xrCamera.getWorldDirection(direction);
            currentCamera = xrCamera;
        } else {
            this.camera.getWorldPosition(origin);
            this.camera.getWorldDirection(direction);
        }

        this.raycaster.set(origin, direction);
        this.raycaster.camera = currentCamera; // Critical for Sprite raycasting

        // Position the reticle mesh at a fixed distance from camera
        this.mesh.position.copy(origin).add(direction.multiplyScalar(this.reticleDistance));
        this.mesh.lookAt(origin); // Orient towards camera

        // Force update world matrices before raycasting
        if (scene) scene.updateMatrixWorld(true);

        const intersects = this.raycaster.intersectObjects(interactables, true); // Recursive check

        if (intersects.length > 0) {
            // Find first VISIBLE interactable object
            let target = null;
            let firstIntersect = null;
            for (let i = 0; i < intersects.length; i++) {
                let candidate = intersects[i].object;
                const intersect = intersects[i];
                // Traverse up to find the interactable group/mesh
                while (candidate && !candidate.userData.isInteractable && candidate.parent) {
                    candidate = candidate.parent;
                }
                // Check if it's valid (interactable AND visible AND recursively visible)
                if (candidate && candidate.userData.isInteractable && candidate.visible) {
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
                        firstIntersect = intersect;
                        break;
                    }
                }
            }

            if (target) {
                if (this.hoveredObject !== target) {
                    console.log('[GAZE] Found interactable:', target.userData?.label || target.name || 'unlabeled');
                    if (this.hoveredObject) this.onHoverOut(this.hoveredObject);
                    this.hoveredObject = target;
                    this.hoveredIntersect = firstIntersect;

                    this.currentActivationTime = target.userData.activationTime || this.baseActivationTime;
                    this.onHoverIn(this.hoveredObject);
                    this.hoverTime = 0;
                }

                if (this.interactionMode === 'gaze') {
                    // Increment timer
                    this.hoverTime += delta;

                    // Calculate progress based on DYNAMIC time
                    const progress = Math.min(this.hoverTime / this.currentActivationTime, 1);
                    this.progressMesh.scale.set(progress, progress, 1);

                    if (this.hoverTime >= this.currentActivationTime) {
                        this.trigger(target, firstIntersect);
                        this.hoverTime = 0; // Reset
                        this.progressMesh.scale.set(0, 0, 1);
                    }
                } else {
                    // Button mode: Just show the reticle ring at 100% or slightly larger but don't fill
                    this.progressMesh.scale.set(1, 1, 1);
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

        // Lock gaze for a short duration after triggering to prevent accidental "through-clicks"
        // in the next scene or state.
        this.triggerLockTime = 0.8; // 800ms lock

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
        if (this.mesh && this.scene) {
            this.scene.remove(this.mesh);
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
