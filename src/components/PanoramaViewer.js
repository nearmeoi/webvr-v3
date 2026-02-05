import * as THREE from 'three';
import { TOUR_DATA } from '../data/tourData.js'; // Import data for reference if needed
import { CanvasUI } from '../utils/CanvasUI.js';
import { AudioControls } from './AudioControls.js';
import { CONFIG } from '../config.js';
// import HOTSPOTS_DATA from '../data/hotspots.json'; // Removed static import
import { SCENE_MAP } from '../data/sceneMap.js';

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

        // State Tracking
        this.currentPath = null;
        this.currentSceneId = null;

        this.currentAudio = null;
        this.isAdminMode = false;

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

        // Initialize Hotspots Data
        this.hotspotsData = {};
        this.fetchHotspots(); // Fetch on init
    }

    async fetchHotspots() {
        try {
            const res = await fetch('/api/get-hotspots');
            if (res.ok) {
                this.hotspotsData = await res.json();
                console.log('Hotspots loaded dynamically:', Object.keys(this.hotspotsData).length, ' entries');

                // If we already loaded a scene, refresh hotspots now that we have data
                if (this.currentPath) {
                    console.log('Refreshing hotspots for current path:', this.currentPath);
                    this.checkAndLoadHotspots(this.currentPath);
                }
            } else {
                console.warn('Failed to fetch hotspots, using empty object.');
                this.hotspotsData = {};
            }
        } catch (err) {
            console.error('Error fetching hotspots:', err);
            this.hotspotsData = {};
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

    setAdminMode(isAdmin) {
        this.isAdminMode = isAdmin;
        console.log('Admin Mode set to:', isAdmin);
        // Maybe visual feedback?
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
        this.currentSceneId = sceneData.id; // Track ID
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
        this.currentPath = path; // Track Path

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
            console.log('Texture loaded from cache. Loading hotspots...');
            this.checkAndLoadHotspots(path);
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
                console.log('Texture load complete. Loading hotspots for:', path);
                this.checkAndLoadHotspots(path);
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

    drawPremiumButton(ctx, w, h, text, isActive = false) {
        ctx.clearRect(0, 0, w, h);

        const padding = 8;
        const radius = 20;

        // Outer glow
        ctx.shadowColor = isActive ? 'rgba(100, 255, 150, 0.6)' : 'rgba(255, 50, 50, 0.5)';
        ctx.shadowBlur = 20;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Background gradient (glassmorphism)
        CanvasUI.roundRect(ctx, padding, padding, w - padding * 2, h - padding * 2, radius);

        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        if (isActive) {
            gradient.addColorStop(0, 'rgba(80, 180, 100, 0.95)');
            gradient.addColorStop(1, 'rgba(40, 120, 60, 0.9)');
        } else {
            // RED Gradient for Hotspots
            gradient.addColorStop(0, 'rgba(220, 60, 60, 0.95)');
            gradient.addColorStop(1, 'rgba(140, 30, 30, 0.9)');
        }
        ctx.fillStyle = gradient;
        ctx.fill();

        // Inner highlight (top edge)
        ctx.shadowBlur = 0;
        CanvasUI.roundRect(ctx, padding + 2, padding + 2, w - padding * 2 - 4, (h - padding * 2) * 0.4, radius - 2);
        const highlightGrad = ctx.createLinearGradient(0, padding, 0, h * 0.4);
        highlightGrad.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
        highlightGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = highlightGrad;
        ctx.fill();

        // Border
        CanvasUI.roundRect(ctx, padding, padding, w - padding * 2, h - padding * 2, radius);
        ctx.strokeStyle = isActive ? 'rgba(150, 255, 180, 0.8)' : 'rgba(255, 100, 100, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Icon
        this.drawIcon(ctx, w, h, 'icon-arrow');
    }

    drawIcon(ctx, w, h, iconId) {
        ctx.save();
        ctx.translate(w / 2, h / 2);
        const scale = 1.2;
        ctx.scale(scale, scale);

        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;

        if (iconId === 'icon-arrow') {
            // Arrow Up
            const size = 15;
            ctx.beginPath();
            ctx.moveTo(0, -size);
            ctx.lineTo(size, size);
            ctx.lineTo(0, size * 0.5);
            ctx.lineTo(-size, size);
            ctx.closePath();
            ctx.fill();
        }

        ctx.restore();
    }

    createArrowTexture() {
        if (this.arrowTexture) return this.arrowTexture;

        const w = 128; // Square texture
        const h = 128;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');

        this.drawPremiumButton(ctx, w, h, 'icon-arrow', false);

        this.arrowTexture = new THREE.CanvasTexture(canvas);
        return this.arrowTexture;
    }

    createHotspotMesh(data) {
        if (!data) return null;

        // Visual Icon based on type
        // 'photo' -> Camera icon? 
        // 'info' -> Info icon?
        // For now, use simple circles/planes with distinguishable aspect or color

        const geometry = new THREE.PlaneGeometry(3, 3); // Larger plane for the button
        const material = new THREE.MeshBasicMaterial({
            map: this.createArrowTexture(),
            transparent: true,
            side: THREE.DoubleSide,
            depthTest: false
        });

        const mesh = new THREE.Mesh(geometry, material);

        // Position on sphere
        const radius = 45; // Inside the 50m sphere

        // Convert Pitch/Yaw (deg) to Vector3
        // Yaw = Rotation around Y (left/right). 0 = Center (-Z)
        // Pitch = Rotation around X (up/down). 0 = Horizon
        // Yaw offset: User requested -90deg rotation from the inverted state (180).
        // 180 - 90 = 90.
        // Standard formula (0) + 90 = 90.
        const yawRad = THREE.MathUtils.degToRad((data.yaw || 0) + 90);
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

            if (data.type === 'scene' || data.target) {
                this.navigateToScene(data.target);
            } else if (data.type === 'photo') {
                this.photoOverlay.show(data.data, () => console.log('Photo closed'));
            } else if (data.type === 'info') {
                // Determine rotation for panel to face user
                const rotationY = Math.atan2(mesh.position.x, mesh.position.z) + Math.PI;
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
        console.log(`Clearing ${this.currentHotspots ? this.currentHotspots.length : 0} hotspots...`);
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
        console.log('Hotspots cleared. Current count:', this.currentHotspots.length);
    }

    navigateToScene(target) {
        // target can be an ID (key in SCENE_MAP) or a direct path
        const sceneData = SCENE_MAP[target];

        if (sceneData) {
            console.log(`Navigating to ID: ${target} (${sceneData.path})`);
            this.currentSceneId = target; // Track ID
            this.clearHotspots();
            this.loadTexture(sceneData.path);
        } else if (typeof target === 'string' && (target.includes('/') || target.includes('.'))) {
            // Assume it's a direct path
            console.log(`Navigating to Path: ${target}`);
            this.currentSceneId = target; // Track ID
            console.log('Calling clearHotspots() before loading new texture...');
            this.clearHotspots();
            // Manually set currentLocation for saving later
            this.currentLocation = { path: target, id: null };
            this.loadTexture(target);
        } else {
            console.warn(`Target scene invalid or not found: ${target}`);
        }
    }

    checkAndLoadHotspots(path) {
        // Now that HOTSPOTS_DATA is keyed by Path, we can look up directly.
        // Incoming path might be absolute or relative. We should standardize.
        // Our keys are like "assets/Museum Kota Makassar/file.jpg".

        // Try to find exact match or partial match
        // 1. Direct match
        let hotspots = this.hotspotsData[path];

        // 2. If not found, try to find a key that is contained in the path
        if (!hotspots) {
            const key = Object.keys(this.hotspotsData).find(k => path.includes(k) || k.includes(path));
            if (key) hotspots = this.hotspotsData[key];
        }

        if (hotspots) {
            console.log(`Loaded ${hotspots.length} hotspots for path: ${path}`);
            // Adapt hotspot format if needed, but if we migrated data, it should be clean?
            // Migration script preserved old data structure { yaw, pitch, target, target_name, type? }
            // So we just pass it through.

            const adaptedHotspots = hotspots.map(h => ({
                type: h.type || 'arrow', // Default to arrow
                yaw: h.yaw,
                pitch: h.pitch,
                target: h.target,
                label: h.target_name || h.label // Support both
            }));

            this.renderHotspots(adaptedHotspots);
        } else {
            console.log(`No hotspots found for path: ${path}`);
            this.currentHotspots = [];
        }
    }

    setAdminMode(isActive) {
        this.isAdminMode = isActive;

        // Show/Hide "Add Hotspot" phantom or cursor logic could go here
        // For now, we rely on click handlers checking this.isAdminMode

        if (isActive) {
            console.log('Admin Mode Enabled');
            // Ensure icons are refreshed if we want to show edit-specific visuals (e.g. bounding boxes)
        } else {
            console.log('Admin Mode Disabled');
        }
    }

    // --- Admin / Editing Methods ---

    getAllHotspotsData() {
        // Collect all hotspots from the scene and return as JSON object
        // Keyed by Path.

        // 1. Get current path
        let currentPath = this.currentPath;

        // If not set directly, try to infer from ID (fallback)
        if (!currentPath && this.currentSceneId) {
            const sceneData = SCENE_MAP[this.currentSceneId];
            if (sceneData) currentPath = sceneData.path;
        }

        if (!currentPath) {
            console.error('Cannot save hotspots: No current path identified.');
            return {};
        }

        // 2. Convert current 3D meshes back to Data
        const currentSceneHotspots = this.currentHotspots.map(mesh => {
            const data = mesh.userData.hotspotData;

            // Recalculate Yaw/Pitch from current position (in case it was dragged)
            const p = mesh.position.clone().normalize();
            const pitch = THREE.MathUtils.radToDeg(Math.asin(p.y));
            let standardYaw = THREE.MathUtils.radToDeg(Math.atan2(p.x, -p.z));
            let yaw = standardYaw - 90;
            if (yaw < -180) yaw += 360;
            if (yaw > 180) yaw -= 360;

            return {
                yaw: parseFloat(yaw.toFixed(2)),
                pitch: parseFloat(pitch.toFixed(2)),
                target: data.target,
                target_name: data.label || data.target_name,
                type: data.type || 'arrow',
                label: data.label || '' // Ensure label is saved
            };
        });

        // 3. Update the global HOTSPOTS_DATA for this scene
        const fullData = { ...this.hotspotsData };

        // Use path as key for saving
        if (fullData[currentPath]) {
            fullData[currentPath] = currentSceneHotspots;
        } else {
            // Fuzzy match key?
            const key = Object.keys(fullData).find(k => currentPath.includes(k) || k.includes(currentPath));
            if (key) {
                fullData[key] = currentSceneHotspots;
            } else {
                // Create new entry
                fullData[currentPath] = currentSceneHotspots;
            }
        }

        return fullData;
    }

    addHotspot(yaw, pitch) {
        if (!this.isAdminMode) return;

        const newData = {
            type: 'arrow',
            yaw: yaw,
            pitch: pitch,
            target: '',
            label: 'New Hotspot'
        };

        const mesh = this.createHotspotMesh(newData);
        if (mesh) {
            this.group.add(mesh);
            this.currentHotspots.push(mesh);

            // Select it immediately
            if (window.adminPanel) {
                window.adminPanel.selectHotspot(mesh.userData.hotspotData);
            }
        }
    }

    removeHotspot(data) {
        const mesh = this.currentHotspots.find(m => m.userData.hotspotData === data);
        if (mesh) {
            this.group.remove(mesh);
            this.currentHotspots = this.currentHotspots.filter(m => m !== mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
    }

    refreshHotspot(data) {
        // Called when data (like icon type) changes
        // Easiest way: remove and re-create
        const oldMesh = this.currentHotspots.find(m => m.userData.hotspotData === data);
        if (oldMesh) {
            this.group.remove(oldMesh);
            this.currentHotspots = this.currentHotspots.filter(m => m !== oldMesh);
            oldMesh.geometry.dispose();
            oldMesh.material.dispose();
        }

        const newMesh = this.createHotspotMesh(data);
        if (newMesh) {
            this.group.add(newMesh);
            this.currentHotspots.push(newMesh);
        }
    }




    updateHotspotVisuals() {
        // Called by AdminPanel when label changes
        this.currentHotspots.forEach(mesh => {
            const data = mesh.userData.hotspotData;

            // Remove old label
            if (mesh.userData.labelSprite) {
                mesh.remove(mesh.userData.labelSprite);
                mesh.userData.labelSprite = null;
            }

            // Add new label if exists
            if (data.label) {
                const labelSprite = this.createLabelSprite(data.label);
                labelSprite.position.set(0, -2, 0);
                mesh.add(labelSprite);
                mesh.userData.labelSprite = labelSprite;
            }
        });
    }

    createLabelSprite(text) {
        const canvas = document.createElement('canvas');
        const fontSize = 48; // High res
        const padding = 20;

        const ctx = canvas.getContext('2d');
        ctx.font = `bold ${fontSize}px sans-serif`;
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;

        canvas.width = textWidth + padding * 2;
        canvas.height = fontSize + padding * 2;

        // Background rounded box
        const w = canvas.width;
        const h = canvas.height;
        const r = 16;

        const ctx2 = canvas.getContext('2d'); // refresh context dimensions
        ctx2.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx2.beginPath();
        ctx2.roundRect(0, 0, w, h, r);
        ctx2.fill();

        // Border
        ctx2.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx2.lineWidth = 2;
        ctx2.stroke();

        // Text
        ctx2.font = `bold ${fontSize}px sans-serif`;
        ctx2.fillStyle = '#ffffff';
        ctx2.textAlign = 'center';
        ctx2.textBaseline = 'middle';
        ctx2.fillText(text, w / 2, h / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false // Always visible on top? Maybe true for realism
        });

        const sprite = new THREE.Sprite(material);
        // Scale down
        sprite.scale.set(w * 0.02, h * 0.02, 1);

        return sprite;
    }

    // --- Interaction Override ---

    // We need to inject logic into the existing click handler or Raycaster
    // In constructor, we set this.onDebugClick. We should standardize this.

    handleAdminClick(intersects) {
        if (!this.isAdminMode) return false;

        // If we were dragging, click should be ignored or handled as "end drag"
        if (this.isDraggingHotspot) {
            this.isDraggingHotspot = false;
            this.draggedMesh = null;
            return true;
        }

        if (intersects.length > 0) {
            const hit = intersects[0];
            const object = hit.object;

            // 1. Clicked Existing Hotspot - Select it
            if (object.userData.hotspotData) {
                if (window.adminPanel) {
                    window.adminPanel.selectHotspot(object.userData.hotspotData);
                }
                return true; // Handled
            }

            // 2. Clicked Background (Sphere) -> Deselect
            if (object === this.sphere) {
                if (window.adminPanel) {
                    window.adminPanel.selectHotspot(null);
                }
                return true;
            }
        }
        return false;
    }

    handleAdminRightClick(intersects) {
        if (!this.isAdminMode) return false;

        if (intersects.length > 0) {
            const hit = intersects[0];
            const object = hit.object;

            // Only place new hotspot if clicked on sphere
            if (object === this.sphere) {
                const point = hit.point.normalize();
                const pitch = THREE.MathUtils.radToDeg(Math.asin(point.y));
                let standardYaw = THREE.MathUtils.radToDeg(Math.atan2(point.x, -point.z));
                let yaw = standardYaw - 90;
                if (yaw < -180) yaw += 360;
                if (yaw > 180) yaw -= 360;

                this.addHotspot(parseFloat(yaw.toFixed(2)), parseFloat(pitch.toFixed(2)));
                return true;
            }
        }
        return false;
    }

    // --- Drag Logic ---

    handleAdminMouseDown(intersects) {
        if (!this.isAdminMode) return false;

        if (intersects.length > 0) {
            const hit = intersects[0];
            if (hit.object.userData.hotspotData) {
                this.isDraggingHotspot = true;
                this.draggedMesh = hit.object;

                // Select it too
                if (window.adminPanel) {
                    window.adminPanel.selectHotspot(this.draggedMesh.userData.hotspotData);
                }

                return true; // Capture event (should disable OrbitControls)
            }
        }
        return false;
    }

    handleAdminMouseMove(raycaster) {
        if (!this.isAdminMode || !this.isDraggingHotspot || !this.draggedMesh) return false;

        // Raycast against the sphere to find new position
        const intersects = raycaster.intersectObject(this.sphere);
        if (intersects.length > 0) {
            const point = intersects[0].point;

            // Update Mesh Position
            // We want it slightly inside the sphere so it's visible, but createHotspotMesh uses radius 45.
            // Point is on sphere (radius 50).
            const radius = 45;
            const p = point.clone().normalize().multiplyScalar(radius);
            this.draggedMesh.position.copy(p);
            this.draggedMesh.lookAt(0, 0, 0);

            // Update Data (for UI feedback if needed)
            // We commit to data structure on MouseUp usually, or update real-time?
            // Let's update real-time so UI sliders move? expensive. 
            // Better to just move visual.
        }
        return true;
    }

    handleAdminMouseUp() {
        if (this.isDraggingHotspot && this.draggedMesh) {
            this.isDraggingHotspot = false;

            // Sync new position to global data structure
            // 1. Calculate new yaw/pitch
            const p = this.draggedMesh.position.clone().normalize();
            const pitch = THREE.MathUtils.radToDeg(Math.asin(p.y));
            let standardYaw = THREE.MathUtils.radToDeg(Math.atan2(p.x, -p.z));
            let yaw = standardYaw - 90;
            if (yaw < -180) yaw += 360;
            if (yaw > 180) yaw -= 360;

            const data = this.draggedMesh.userData.hotspotData;
            data.yaw = parseFloat(yaw.toFixed(2));
            data.pitch = parseFloat(pitch.toFixed(2));

            // Notify Panel to update form values
            if (window.adminPanel) {
                window.adminPanel.selectHotspot(data); // Re-select to refresh form
                window.adminPanel.markDirty();
            }

            this.draggedMesh = null;
            return true;
        }
        return false;
    }

    // --- Icon Generation ---

    createIconTexture(type) {
        const key = 'icon_' + type;
        if (this.textureCache && this.textureCache.has(key)) {
            return this.textureCache.get(key);
        }

        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Styles
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;

        const drawCircleBase = (color) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 4;
            ctx.stroke();
        };

        if (type === 'arrow') {
            return this.createArrowTexture(); // Use existing method for legacy arrow
        } else if (type === 'info') {
            drawCircleBase('#3b82f6'); // Blue
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 80px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('i', size / 2, size / 2);
        } else if (type === 'plus') { // New: Add/Plus Icon
            drawCircleBase('#22c55e'); // Green
            ctx.fillStyle = '#fff';
            // Plus Sign
            const t = 12; // thickness
            const l = 60; // length
            ctx.fillRect(size / 2 - l / 2, size / 2 - t / 2, l, t); // Horizontal
            ctx.fillRect(size / 2 - t / 2, size / 2 - l / 2, t, l); // Vertical
        } else if (type === 'home') { // New: Home Icon
            drawCircleBase('#8b5cf6'); // Purple
            ctx.fillStyle = '#fff';
            // Simple House
            ctx.beginPath();
            ctx.moveTo(size / 2, 30);
            ctx.lineTo(size - 30, 55);
            ctx.lineTo(30, 55);
            ctx.fill(); // Roof
            ctx.fillRect(40, 55, size - 80, 45); // Body
        } else if (type === 'photo') {
            drawCircleBase('#f59e0b'); // Amber
            // Camera Icon
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.rect(34, 44, 60, 40); // Body
            ctx.fill();
            ctx.beginPath(); // Lens
            ctx.arc(64, 64, 15, 0, Math.PI * 2);
            ctx.fillStyle = '#333';
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath(); // Flash
            ctx.rect(50, 36, 28, 8);
            ctx.fill();
        } else if (type === 'video') {
            drawCircleBase('#ef4444'); // Red
            // Play Triangle
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(50, 40);
            ctx.lineTo(90, 64);
            ctx.lineTo(50, 88);
            ctx.closePath();
            ctx.fill();
        } else {
            // Default/Fallback
            drawCircleBase('#64748b');
        }

        const texture = new THREE.CanvasTexture(canvas);
        if (!this.textureCache) this.textureCache = new Map();
        this.textureCache.set(key, texture);
        return texture;
    }

    createHotspotMesh(data) {
        if (!data) return null;

        const type = data.type || 'arrow';
        const geometry = new THREE.PlaneGeometry(3, 3);
        const material = new THREE.MeshBasicMaterial({
            map: this.createIconTexture(type),
            transparent: true,
            side: THREE.DoubleSide,
            depthTest: false
        });

        const mesh = new THREE.Mesh(geometry, material);

        // Position logic
        const radius = 45;
        const yawRad = THREE.MathUtils.degToRad((data.yaw || 0) + 90);
        const pitchRad = THREE.MathUtils.degToRad(data.pitch || 0);

        const x = radius * Math.sin(yawRad) * Math.cos(pitchRad);
        const y = radius * Math.sin(pitchRad);
        const z = -radius * Math.cos(yawRad) * Math.cos(pitchRad);

        mesh.position.set(x, y, z);
        mesh.lookAt(0, 0, 0);

        mesh.userData.isInteractable = true;
        mesh.userData.hotspotData = data; // Link back to data object

        // Add Label Sprite
        if (data.label) {
            const labelSprite = this.createLabelSprite(data.label);
            labelSprite.position.set(0, -2, 0); // Position below icon
            mesh.add(labelSprite);
            mesh.userData.labelSprite = labelSprite;
        }

        this.addPulseAnimation(mesh);

        mesh.onClick = () => {
            // Admin mode check happens in main loop, but we can double check or just let normal logic flow
            // Normal logic:
            if (!this.isAdminMode) {
                console.log('Clicked hotspot:', data.label, data.type);
                if (data.type === 'scene' || data.target) {
                    this.navigateToScene(data.target);
                } else if (data.type === 'photo') {
                    // this.photoOverlay.show(...)
                    console.log('Open Photo:', data.target_name);
                } else if (data.type === 'info') {
                    // Info logic
                    console.log('Open Info:', data.target_name);
                }
            }
        };

        return mesh;
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
