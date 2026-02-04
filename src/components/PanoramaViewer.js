import * as THREE from 'three';
import { TOUR_DATA } from '../data/tourData.js'; // Import data for reference if needed
import { CanvasUI } from '../utils/CanvasUI.js';
import { AudioControls } from './AudioControls.js';
import { CONFIG } from '../config.js';

export class PanoramaViewer {
    constructor(scene, onBack, camera, renderer) {
        this.scene = scene;
        this.onBack = onBack;
        this.camera = camera;
        this.renderer = renderer; // For WebXR camera access
        this.group = new THREE.Group();
        this.group.position.set(0, 1.6, 0); // Center everything at eye level
        this.scene.add(this.group);
        this.group.visible = false; // Hidden initially
        this.currentAudio = null;

        // 1. Sphere Pano (radius must be < camera far clip)
        const geometry = new THREE.SphereGeometry(50, 64, 32); // Reduced segments as parallax is gone
        geometry.scale(-1, 1, 1);

        // Basic material only
        this.basicMaterial = new THREE.MeshBasicMaterial({ map: null });

        // ControlDock camera following state
        this.dockCenterOffset = 0; // Will be set by setAudioButtonsPosition

        this.sphere = new THREE.Mesh(geometry, this.basicMaterial);
        this.group.add(this.sphere);

        // 2. Control Dock (follows camera)
        this.controlDock = new THREE.Group();
        this.group.add(this.controlDock);

        this.createBackButton();
        this.audioControls = new AudioControls(this.controlDock);
        this.audioControls.setVisible(false); // Hide legacy buttons (we use Unified Dock now)
        this.createLoadingIndicator();

        this.textureLoader = new THREE.TextureLoader();
        this.isLoading = false;

        // Ensure GazeController can hit this
        this.group.userData.isInteractable = false; // Container not interactable

        // Reuse arrow texture for all hotspots to save memory
        this.arrowTexture = null;

        // DEBUG: Click to get angle (only enabled for development)
        const DEBUG_MODE = false; // Set to true to enable angle debugging
        if (DEBUG_MODE) {
            this.onDebugClick = (event) => {
                if (!this.group.visible) return;

                const mouse = new THREE.Vector2();
                mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
                mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

                const raycaster = new THREE.Raycaster();
                raycaster.setFromCamera(mouse, this.camera);

                const intersects = raycaster.intersectObject(this.sphere);
                if (intersects.length > 0) {
                    const worldPoint = intersects[0].point;
                    const localPoint = this.sphere.worldToLocal(worldPoint.clone());
                    let angleDeg = Math.atan2(localPoint.x, -localPoint.z) * (180 / Math.PI);
                    if (angleDeg < 0) angleDeg += 360;
                    angleDeg = Math.round(angleDeg);
                    console.log(`ANGLE: ${angleDeg}° (click same spot on panorama = same angle)`);
                }
            };
            window.addEventListener('click', this.onDebugClick);
        }
    }

    createBackButton() {
        const geometry = new THREE.PlaneGeometry(0.4, 0.18);
        const canvas = CanvasUI.createButtonTexture('BACK', {
            width: 400,
            height: 180,
            radius: 40,
            fontSize: 40
        });

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide
        });

        this.backBtn = new THREE.Mesh(geometry, material);
        this.backBtn.position.set(0, -1.0, -1.6); // Moved to Z -1.6 to match radius
        this.backBtn.lookAt(0, 0.6, 0);

        this.backBtn.userData.isInteractable = true;
        this.backBtn.userData.originalScale = new THREE.Vector3(1, 1, 1);
        this.backBtn.userData.targetScale = new THREE.Vector3(1, 1, 1);
        this.backBtn.userData.animProgress = 1;
        this.backBtn.onHoverIn = () => this.backBtn.userData.targetScale.set(1.1, 1.1, 1.1);
        this.backBtn.onHoverOut = () => this.backBtn.userData.targetScale.copy(this.backBtn.userData.originalScale);
        this.backBtn.onClick = () => {
            if (this.onBack) this.onBack();
        };

        this.controlDock.add(this.backBtn);
    }

    setAudioButtonsPosition(mode, subLocationCount = 0, lastItemTheta = undefined) {
        // Delegate to AudioControls component
        if (mode === 'with-dock') {
            this.dockCenterOffset = 0.2; // Match SubMenu centerOffset
            this.audioControls.setPosition(mode, { subLocationCount, lastItemTheta });
        } else {
            this.dockCenterOffset = 0;
            this.audioControls.setPosition(mode);
        }
    }

    load(index) {
        const location = TOUR_DATA[index];
        if (!location) {
            console.error('Invalid location index:', index);
            return;
        }
        this.loadFromLocation(location);
    }

    loadFromLocation(location) {
        if (!location) {
            console.error('Invalid location');
            return;
        }

        this.currentLocation = location;

        // Stop any playing audio
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }

        // Play audio if available (global per location)
        if (location.audio) {
            this.currentAudio = new Audio(location.audio);
            this.currentAudio.loop = false; // No loop, play once
            this.currentAudio.volume = 0.5;

            // Bind audio to AudioControls
            this.audioControls.setAudio(this.currentAudio);

            // Handle audio ended
            this.currentAudio.addEventListener('ended', () => {
                this.audioControls.setState(false, this.audioControls.isMuted);
            });

            // Auto-start
            this.currentAudio.play().then(() => {
                this.audioControls.setState(true, this.audioControls.isMuted);
            }).catch(err => {
                console.log('Audio autoplay blocked:', err);
                this.audioControls.setState(false, this.audioControls.isMuted);
            });
        } else {
            this.audioControls.setAudio(null);
            this.audioControls.setState(false, false);
        }

        // Check for multi-scene data
        if (location.scenes && location.scenes.length > 0) {
            this.loadScene(location.scenes[0]);
            // Lazy load other scenes in background
            this.preloadScenes(location.scenes.slice(1));
        } else if (location.panorama) {
            // Load with depth map if available
            this.loadTextureWithDepth(location.panorama, location.depthMap);
            this.clearHotspots();
        }

        this.group.visible = true;

        // Reset controlDock rotation to face user when loading new location
        this.resetControlDockRotation();
    }

    loadScene(sceneData) {
        console.log('Loading scene:', sceneData.id);
        this.loadTexture(sceneData.path);
        this.renderHotspots(sceneData.links);

        // Preload linked scenes in background
        if (sceneData.links && this.currentLocation) {
            const linkedPaths = sceneData.links
                .map(link => {
                    const linkedScene = this.currentLocation?.scenes?.find(s => s.id === link.target);
                    return linkedScene?.path;
                })
                .filter(Boolean);
            this.preloadTextures(linkedPaths);
        }
    }

    loadTexture(path) {
        // PROTOTYPE MODE: If path starts with "placeholder", generate strictly procedural texture
        if (path && path.startsWith('placeholder')) {
            // Extract zone name/number for display
            // e.g. "placeholder_zone1"
            this.loadFallbackTexture(path.replace('placeholder_', 'ZONE ').toUpperCase());
            this.hideLoading();
            return;
        }

        // Check cache first
        if (this.textureCache && this.textureCache.has(path)) {
            console.log('Using cached texture:', path);
            const cachedTexture = this.textureCache.get(path);
            this.basicMaterial.map = cachedTexture;
            this.basicMaterial.needsUpdate = true;
            // Ensure sphere uses basic material (not parallax from previous location)
            this.sphere.material = this.basicMaterial;
            this.useParallax = false;
            this.hideLoading(); // Ensure loading is hidden immediately
            return;
        }

        // Show loading indicator
        this.showLoading();

        this.textureLoader.load(
            path,
            (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace;
                // Cache the texture
                if (!this.textureCache) this.textureCache = new Map();
                this.textureCache.set(path, texture);

                this.basicMaterial.map = texture;
                this.basicMaterial.needsUpdate = true;
                // Ensure sphere uses basic material (not parallax from previous location)
                this.sphere.material = this.basicMaterial;
                this.useParallax = false;
                // Hide loading indicator
                this.hideLoading();
            },
            (xhr) => {
                // Progress
                // console.log((xhr.loaded / xhr.total * 100) + '% loaded');
            },
            (error) => {
                console.warn('Error loading panorama (using fallback):', path);
                this.loadFallbackTexture('ZONE ' + (this.currentLocation?.id || '?'));
                this.hideLoading();
            }
        );
    }

    /**
     * Load panorama texture (Depth map support removed)
     */
    loadTextureWithDepth(colorPath, depthPath) {
        // We ignore depthPath now as parallax is removed.
        // Just call standard loadTexture
        this.loadTexture(colorPath);
    }

    // Preload multiple textures in background (lazy loading)
    preloadTextures(paths) {
        if (!this.textureCache) this.textureCache = new Map();
        if (!this.pendingTextures) this.pendingTextures = new Set();

        paths.forEach(path => {
            // Skip if already cached OR matches current texture (optimization)
            if (!path || this.textureCache.has(path)) return;

            // Skip if already being loaded
            if (this.pendingTextures.has(path)) return;

            this.pendingTextures.add(path); // Mark as pending

            // Load in background without showing loading indicator
            this.textureLoader.load(
                path,
                (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace;
                    this.textureCache.set(path, texture);
                    this.pendingTextures.delete(path); // Remove from pending
                    console.log('Preloaded texture:', path);
                },
                undefined,
                (error) => {
                    console.warn('Failed to preload:', path, error);
                    this.pendingTextures.delete(path); // Remove from pending on error too
                }
            );
        });
    }

    // Preload scenes array
    preloadScenes(scenes) {
        if (!scenes || scenes.length === 0) return;
        const paths = scenes.map(s => s.path).filter(Boolean);
        this.preloadTextures(paths);
    }

    createLoadingIndicator() {
        // Create a simple loading overlay
        this.loadingGroup = new THREE.Group();
        this.loadingGroup.visible = false;

        // Dark semi-transparent background sphere
        const bgGeometry = new THREE.SphereGeometry(49, 32, 32);
        bgGeometry.scale(-1, 1, 1);
        const bgMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            opacity: 0.7,
            transparent: true
        });
        this.loadingBg = new THREE.Mesh(bgGeometry, bgMaterial);
        this.loadingGroup.add(this.loadingBg);

        // 1. Static Spinner Texture (No redraw loop)
        const spinnerCanvas = CanvasUI.createLoadingTexture();
        const spinnerTexture = new THREE.CanvasTexture(spinnerCanvas);
        const spinnerGeom = new THREE.PlaneGeometry(0.5, 0.5);
        const spinnerMat = new THREE.MeshBasicMaterial({
            map: spinnerTexture,
            transparent: true,
            depthTest: false
        });

        this.loadingSpinner = new THREE.Mesh(spinnerGeom, spinnerMat);
        this.loadingSpinner.position.set(0, 0, -2);
        this.loadingSpinner.renderOrder = 1000;
        this.loadingGroup.add(this.loadingSpinner);

        // 2. Static Text Texture (Separate, so it doesn't rotate)
        const textCanvas = CanvasUI.createLoadingTextTexture();
        const textTexture = new THREE.CanvasTexture(textCanvas);
        // Aspect ratio of text canvas 256x64 is 4:1
        const textGeom = new THREE.PlaneGeometry(0.5, 0.125);
        const textMat = new THREE.MeshBasicMaterial({
            map: textTexture,
            transparent: true,
            depthTest: false
        });
        this.loadingText = new THREE.Mesh(textGeom, textMat);
        this.loadingText.position.set(0, -0.4, -2); // Below spinner
        this.loadingText.renderOrder = 1000;
        this.loadingGroup.add(this.loadingText);

        this.group.add(this.loadingGroup);
        this.loadingRotation = 0;
    }

    updateLoadingSpinner() {
        if (!this.loadingGroup.visible) return;
        // Simple rotation on GPU is extremely cheap
        if (this.loadingSpinner) {
            this.loadingSpinner.rotation.z -= 0.1;
        }
    }

    /**
     * Update loading indicator to follow camera direction
     * Unlike controlDock, loading always follows immediately (no threshold)
     */
    updateLoadingPosition() {
        if (!this.loadingGroup?.visible || !this.camera) return;

        // Get camera's horizontal direction
        const cameraDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDirection);

        // Calculate target angle (face the camera)
        const targetAngle = Math.atan2(cameraDirection.x, cameraDirection.z) + Math.PI;

        // Smoothly rotate to target
        let currentAngle = this.loadingGroup.rotation.y;
        let diff = targetAngle - currentAngle;

        // Normalize difference to [-PI, PI]
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        // Fast follow for loading indicator
        this.loadingGroup.rotation.y += diff * 0.15;
    }

    showLoading() {
        this.isLoading = true;
        if (this.loadingGroup) {
            this.loadingGroup.visible = true;
        }
    }

    hideLoading() {
        this.isLoading = false;
        if (this.loadingGroup) {
            this.loadingGroup.visible = false;
        }
    }

    createArrowTexture() {
        if (this.arrowTexture) {
            return this.arrowTexture;
        }

        // Use standard canvas logic, but done once
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Outer glow
        ctx.beginPath();
        ctx.arc(64, 64, 50, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(173, 216, 230, 0.2)';
        ctx.fill();

        // Stroke
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(70, 130, 180, 0.7)';
        ctx.stroke();

        // Inner core
        ctx.beginPath();
        ctx.arc(64, 64, 25, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(240, 248, 255, 0.95)';
        ctx.fill();

        // Center dot
        ctx.beginPath();
        ctx.arc(64, 64, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(50, 50, 50, 0.8)';
        ctx.fill();

        this.arrowTexture = new THREE.CanvasTexture(canvas);
        return this.arrowTexture;
    }

    createHotspotMesh(data) {
        if (!data) return null;

        // Visual Icon based on type
        // 'photo' -> Camera icon? 
        // 'info' -> Info icon?
        // For now, use simple circles/planes with distinguishable aspect or color

        const geometry = new THREE.CircleGeometry(0.2, 32);
        let color = 0xffffff;
        if (data.type === 'photo') color = 0xffcc00; // Gold for History
        if (data.type === 'info') color = 0x00ccff; // Blue for Info
        if (data.type === 'scene') color = 0xffffff; // White for movement

        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
            depthTest: false
        });

        const mesh = new THREE.Mesh(geometry, material);

        // Position on sphere
        const radius = 45; // Inside the 50m sphere

        // Convert Pitch/Yaw (deg) to Vector3
        // Yaw = Rotation around Y (left/right). 0 = Center (-Z)
        // Pitch = Rotation around X (up/down). 0 = Horizon
        const yawRad = THREE.MathUtils.degToRad(data.yaw || 0);
        const pitchRad = THREE.MathUtils.degToRad(data.pitch || 0);

        const x = radius * Math.sin(yawRad) * Math.cos(pitchRad);
        const y = radius * Math.sin(pitchRad);
        const z = -radius * Math.cos(yawRad) * Math.cos(pitchRad);

        mesh.position.set(x, y, z);
        mesh.lookAt(0, 0, 0); // Face center

        mesh.userData.isInteractable = true;
        mesh.userData.activationTime = data.activationTime || 1.5;
        this.addPulseAnimation(mesh);

        mesh.onClick = () => {
            console.log('Clicked hotspot:', data.label, data.type);

            if (data.type === 'photo') {
                this.photoOverlay.show(data.data, () => console.log('Photo closed'));
            } else if (data.type === 'info') {
                // Determine rotation for panel to face user
                const rotationY = Math.atan2(mesh.position.x, mesh.position.z) + Math.PI;
                this.curvedInfoPanel.show(data.data, mesh.position.clone().multiplyScalar(0.1), rotationY); // much closer?
                // Wait, CurvedInfoPanel expects world position.
                // If we put it at mesh position (45m), it's too far.
                // It should appear 2m in front of user in Direction of hotspot.
                const panelPos = mesh.position.clone().normalize().multiplyScalar(2.5); // 2.5m away
                this.curvedInfoPanel.show(data.data, panelPos, rotationY);
            }
        };

        return mesh;
    }

    addPulseAnimation(mesh) {
        mesh.userData.originalScale = new THREE.Vector3(1, 1, 1);
        mesh.userData.targetScale = new THREE.Vector3(1.2, 1.2, 1);
        mesh.onHoverIn = () => mesh.scale.set(1.3, 1.3, 1.3);
        mesh.onHoverOut = () => mesh.scale.copy(mesh.userData.originalScale);
    }

    renderHotspots(hotspots) {
        this.clearHotspots();
        if (!hotspots) return;

        this.currentHotspots = [];
        hotspots.forEach(data => {
            const mesh = this.createHotspotMesh(data);
            if (mesh) {
                this.group.add(mesh);
                this.currentHotspots.push(mesh);
            }
        });
    }

    clearHotspots() {
        if (this.currentHotspots) {
            this.currentHotspots.forEach(mesh => {
                this.group.remove(mesh);
                // DO NOT Dispose texture if it is the shared arrowTexture!
                // We typically just dispose material if it was unique, but here we share standard arrow material map.
                // But we created new Material each time in createArrowMesh, so we should dispose material.
                mesh.material.dispose();
                mesh.geometry.dispose();
            });
        }
        this.currentHotspots = [];
    }

    loadFallbackTexture(name) {
        const canvas = document.createElement('canvas');
        canvas.width = 4096; // Higher res for VR
        canvas.height = 2048;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        // Cinematic Dark Background (Requested: Hitam Gelap)
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, w, h);

        // Minimalist Grid (Requested: Sedikit garis penanda arah)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 2;

        // A. Horizon Line
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // B. Vertical Cardinal Lines (North, East, South, West)
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < w; i += w / 4) {
            ctx.moveTo(i, 0);
            ctx.lineTo(i, h);
        }
        ctx.stroke();

        // C. Zenith/Nadir Rims
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(w, 0);
        ctx.moveTo(0, h); ctx.lineTo(w, h);
        ctx.stroke();

        // SCENE INFO TEXT (Floating in front)
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Front Text (0 deg = Forward direction)
        // For equirectangular: x=0 and x=w are the front, x=w/2 is behind
        // To place at ~90° from center (which is front in 360), use w*0.25 or w*0.75
        const drawText = (offsetX) => {
            // Title - larger and more prominent
            ctx.font = 'bold 140px Roboto, sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(name, offsetX, h / 2 - 150);

            // Description
            if (this.currentLocation) {
                ctx.font = '70px Roboto, sans-serif';
                ctx.fillStyle = '#888888';
                ctx.fillText(this.currentLocation.description || '', offsetX, h / 2 + 150);
            }
        };

        // Draw at FRONT (0°) - the left edge area represents forward direction
        // Using w*0.25 places text 90° to the left (front when facing forward from sphere center)
        drawText(w * 0.25);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        this.basicMaterial.map = texture;
        this.basicMaterial.needsUpdate = true;
    }

    setBackButtonVisibility(visible) {
        if (this.backBtn) {
            this.backBtn.visible = visible;
        }
    }

    hide() {
        // Stop audio when hiding
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        this.group.visible = false;
    }

    setVRMode(isVR) {
        this.isVRMode = isVR;
        // In VR, we might want to hide the floating back button 
        // because the SubMenu handles it, or use Gaze.
        // For now, let's keep it simple.
        this.setBackButtonVisibility(!isVR);
    }

    /**
     * Update controlDock rotation to follow camera horizontally
     * Stops following when user looks down to allow interaction
     */
    updateControlDockRotation() {
        if (!this.camera || !this.controlDock) return;

        // Get camera's direction
        const cameraDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDirection);

        // Check if looking down (negative Y component means looking down)
        const pitch = Math.asin(cameraDirection.y); // Radians, negative = looking down

        // Target angle based on camera direction
        // Add centerOffset to match the dock's shifted position
        const targetAngle = Math.atan2(cameraDirection.x, cameraDirection.z) + Math.PI + this.dockCenterOffset;

        // Use CONFIG threshold (default -0.45 rad ≈ -26 degrees)
        const threshold = CONFIG.controlDock?.lookDownThreshold || -0.45;

        // If looking down more than threshold, stop rotating (let user select)
        if (pitch > threshold) {
            // Smoothly rotate to target (ease out)
            let currentAngle = this.controlDock.rotation.y;
            let diff = targetAngle - currentAngle;

            // Normalize difference to [-PI, PI]
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            // Ease out: faster at start, slower at end
            const easeSpeed = CONFIG.controlDock?.followEaseSpeed || 0.08;
            this.controlDock.rotation.y += diff * easeSpeed;
        }
        // Otherwise, dock stays in place so user can interact
    }

    /**
     * Reset controlDock rotation to face the camera
     * Call this when showing panorama to align dock with user's view
     */
    resetControlDockRotation() {
        if (!this.camera || !this.controlDock) return;

        const vector = new THREE.Vector3();
        this.camera.getWorldDirection(vector);
        this.controlDock.rotation.y = Math.atan2(vector.x, vector.z) + Math.PI + this.dockCenterOffset;
    }


    update(delta) {
        const animSpeed = 6;

        // Helper function for smooth animation
        const animateObject = (obj) => {
            if (!obj || !obj.userData.targetScale) return;

            const diff = obj.scale.distanceTo(obj.userData.targetScale);

            if (diff > 0.01 && obj.userData.animProgress >= 1) {
                obj.userData.animProgress = 0;
                obj.userData.startScale = obj.scale.clone();
            }

            if (obj.userData.animProgress < 1 && obj.userData.startScale) {
                obj.userData.animProgress = Math.min(1, obj.userData.animProgress + delta * animSpeed);
                // Ease-in-out (smoothstep)
                const t = obj.userData.animProgress;
                const easeInOut = t * t * (3 - 2 * t);
                obj.scale.lerpVectors(obj.userData.startScale, obj.userData.targetScale, easeInOut);
            }
        };

        // Animate all buttons
        animateObject(this.backBtn);
        animateObject(this.playBtn);
        animateObject(this.muteBtn);

        // Animate hotspots
        if (this.currentHotspots) {
            this.currentHotspots.forEach(animateObject);
        }

        // Update loading spinner animation and position
        this.updateLoadingSpinner();
        this.updateLoadingPosition();

        // === ControlDock camera following ===
        // Make controlDock follow camera's horizontal rotation (like SubMenu)
        // BUT stop following when user looks DOWN toward the dock for interaction
        this.updateControlDockRotation();

        // === VR FIX: Sync sphere center with camera position for proper stereo ===
        // In VR/stereo mode, the sphere MUST be centered exactly at the camera 
        // position to prevent "double vision" where left/right eyes see different content
        // NOTE: Only move the sphere, NOT the controlDock (keep UI stable)
        if (this.sphere && this.renderer?.xr?.isPresenting) {
            const cameraWorldPos = new THREE.Vector3();
            const xrCamera = this.renderer.xr.getCamera();
            xrCamera.getWorldPosition(cameraWorldPos);

            // Only move sphere to camera position, keep controlDock at fixed height
            this.sphere.position.copy(cameraWorldPos).sub(this.group.position);
        }
    }

    dispose() {
        // Remove event listeners
        if (this.onDebugClick) {
            window.removeEventListener('click', this.onDebugClick);
        }

        // Dispose Managers & Components
        if (this.audioManager) this.audioManager.dispose();
        if (this.photoOverlay) this.photoOverlay.dispose();
        if (this.curvedInfoPanel) this.curvedInfoPanel.dispose();

        // Dispose sphere
        if (this.sphere) {
            this.sphere.geometry.dispose();
            if (this.sphere.material.map) this.sphere.material.map.dispose();
            this.sphere.material.dispose();
        }

        // Dispose controls
        if (this.backBtn) {
            this.backBtn.geometry.dispose();
            if (this.backBtn.material.map) this.backBtn.material.map.dispose();
            this.backBtn.material.dispose();
        }
        // Removed Play/Mute btns logic earlier so no need to dispose them here if they aren't created.
        // But for safety:
        /* if (this.playBtn) ... */
        if (this.playBtn) {
            this.playBtn.geometry.dispose();
            if (this.playBtn.material.map) this.playBtn.material.map.dispose();
            this.playBtn.material.dispose();
        }
        if (this.muteBtn) {
            this.muteBtn.geometry.dispose();
            if (this.muteBtn.material.map) this.muteBtn.material.map.dispose();
            this.muteBtn.material.dispose();
        }

        // Dispose loading
        if (this.loadingGroup) {
            this.loadingGroup.traverse((child) => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
        }

        // Dispose hotspots
        if (this.currentHotspots) {
            this.currentHotspots.forEach(mesh => {
                mesh.geometry.dispose();
                mesh.material.dispose();
            });
        }
        if (this.arrowTexture) {
            this.arrowTexture.dispose();
        }

        // Dispose group
        if (this.group && this.scene) {
            this.scene.remove(this.group);
        }
    }
}
