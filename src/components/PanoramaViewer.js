import * as THREE from 'three';
import { TOUR_DATA } from '../data/tourData.js'; // Import data for reference if needed
import { CanvasUI } from '../utils/CanvasUI.js';
import { AudioControls } from './AudioControls.js';
import { CONFIG, API_BASE } from '../config.js';
// import HOTSPOTS_DATA from '../data/hotspots.json'; // Removed static import
import { SCENE_MAP } from '../data/sceneMap.js';

export class PanoramaViewer {
    constructor(scene, onBack, camera, renderer) {
        this.scene = scene;
        this.onBack = onBack;
        this.camera = camera;
        this.renderer = renderer;
        this.panoramaBrightness = 1.0; // Default multiplier
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

        // Basic material only - Boosted for maximum brightness
        this.basicMaterial = new THREE.MeshBasicMaterial({
            map: null,
            color: 0xffffff,
            toneMapped: false // Don't dim it with global tonemapping
        });

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
        this.hotspotsGroup = new THREE.Group();
        this.group.add(this.hotspotsGroup);
        this.fetchHotspots(); // Fetch on init
    }

    setInfoOverlay(overlay) {
        this.infoOverlay = overlay;
    }

    setInfoPanel3D(panel) {
        this.infoPanel3D = panel;
    }

    async fetchHotspots() {
        try {
            const res = await fetch(`${API_BASE}/api/get-hotspots`);
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
        this.backBtn.userData.label = 'Back Button';
        this.backBtn.userData.activationTime = 2.5; // Longer activation for back button to prevent accidental VR triggers
        this.backBtn.onHoverIn = () => this.backBtn.userData.targetScale.set(1.1, 1.1, 1.1);
        this.backBtn.onHoverOut = () => this.backBtn.userData.targetScale.copy(this.backBtn.userData.originalScale);
        this.backBtn.onClick = () => {
            if (this.onBack) this.onBack();
        };

        this.backBtn.visible = false; // Hidden by default as per user request (menu is "ga guna")
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


    addPulseAnimation(mesh) {
        mesh.userData.originalScale = new THREE.Vector3().copy(mesh.scale);
        mesh.onHoverIn = () => {
            const s = mesh.userData.originalScale;
            mesh.scale.set(s.x * 1.3, s.y * 1.3, s.z * 1.3);
        };
        mesh.onHoverOut = () => mesh.scale.copy(mesh.userData.originalScale);
    }

    renderHotspots(hotspots) {
        this.clearHotspots();
        if (!hotspots) return;

        this.currentHotspots = [];
        hotspots.forEach(data => {
            const mesh = this.createHotspotMesh(data);
            if (mesh) {
                this.hotspotsGroup.add(mesh);
                this.currentHotspots.push(mesh);
            }
        });
    }

    clearHotspots() {
        console.log(`Clearing hotspots...`);
        if (this.currentHotspots) {
            this.currentHotspots.forEach(mesh => {
                // Dispose textures and materials properly
                if (mesh.material) mesh.material.dispose();
                // Labels are now siblings in the group, we'll clear the whole group
            });
        }

        // Clear all children from hotspotsGroup (including labels)
        while (this.hotspotsGroup.children.length > 0) {
            const child = this.hotspotsGroup.children[0];
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
            this.hotspotsGroup.remove(child);
        }

        this.currentHotspots = [];
        console.log('Hotspots cleared.');
    }

    navigateToScene(target) {
        // Ensure panorama is visible
        this.group.visible = true;

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
                ...h, // Preserve all fields (size, color, offset, etc.)
                type: h.type || 'arrow', // Default to arrow
                label: h.target_name || h.label // Ensure label field exists
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

    getCurrentSceneHotspots() {
        // 1. Get current path
        let currentPath = this.currentPath;
        if (!currentPath && this.currentSceneId) {
            const sceneData = SCENE_MAP[this.currentSceneId];
            if (sceneData) currentPath = sceneData.path;
        }

        if (!currentPath) return null;

        // 2. Build list from meshes
        const hotspots = this.currentHotspots.map(mesh => {
            const data = mesh.userData.hotspotData;
            const p = mesh.position.clone().normalize();
            const pitch = THREE.MathUtils.radToDeg(Math.asin(p.y));
            let standardYaw = THREE.MathUtils.radToDeg(Math.atan2(p.x, -p.z));
            let yaw = standardYaw - 90;
            if (yaw < -180) yaw += 360;
            if (yaw > 180) yaw -= 360;

            return {
                yaw: parseFloat(yaw.toFixed(2)),
                pitch: parseFloat(pitch.toFixed(2)),
                target: data.target || '',
                target_name: data.label || data.target_name || '',
                type: data.type || 'arrow',
                label: data.label || '',
                size: data.size !== undefined ? data.size : 3,
                textSize: data.textSize !== undefined ? data.textSize : 1.0,
                color: data.color || null,
                icon_url: data.icon_url || null,
                labelOffset: data.labelOffset !== undefined ? data.labelOffset : 0,
                title: data.title || '',
                description: data.description || '',
                infoWidth: data.infoWidth || 1.0,
                infoHeight: data.infoHeight || 0.8,
                infoColor: data.infoColor || '#1e293b',
                infoOpacity: data.infoOpacity !== undefined ? data.infoOpacity : 0.95
            };
        });

        return {
            sceneId: currentPath,
            hotspots: hotspots
        };
    }

    getAllHotspotsData() {
        const currentData = this.getCurrentSceneHotspots();
        if (!currentData) return this.hotspotsData;

        const fullData = { ...this.hotspotsData };
        fullData[currentData.sceneId] = currentData.hotspots;
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
            this.hotspotsGroup.add(mesh);
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
            // Remove the label first if it exists
            if (mesh.userData.labelSprite) {
                this.hotspotsGroup.remove(mesh.userData.labelSprite);
                mesh.userData.labelSprite.geometry.dispose();
                mesh.userData.labelSprite.material.dispose();
            }

            this.hotspotsGroup.remove(mesh);
            this.currentHotspots = this.currentHotspots.filter(m => m !== mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            // this.markDirty(); // Assuming markDirty is a method to signal changes for saving
        }
    }

    refreshHotspot(data) {
        // Called when data (like icon type, size, or color) changes
        // Easiest way: remove and re-create
        const oldMesh = this.currentHotspots.find(m => m.userData.hotspotData === data);
        if (oldMesh) {
            // Remove the label first if it exists
            if (oldMesh.userData.labelSprite) {
                this.hotspotsGroup.remove(oldMesh.userData.labelSprite);
                if (oldMesh.userData.labelSprite.geometry) oldMesh.userData.labelSprite.geometry.dispose();
                if (oldMesh.userData.labelSprite.material) oldMesh.userData.labelSprite.material.dispose();
            }

            this.hotspotsGroup.remove(oldMesh);
            this.currentHotspots = this.currentHotspots.filter(m => m !== oldMesh);
            if (oldMesh.geometry) oldMesh.geometry.dispose();
            if (oldMesh.material) oldMesh.material.dispose();
        }

        const newMesh = this.createHotspotMesh(data);
        if (newMesh) {
            this.hotspotsGroup.add(newMesh);
            this.currentHotspots.push(newMesh);
        }
    }






    createLabel(text, scale = 1.0) {
        const canvas = document.createElement('canvas');
        const baseFontSize = 42;
        const fontSize = baseFontSize * scale;
        const padding = 24 * scale;

        const ctx = canvas.getContext('2d');
        ctx.font = `500 ${fontSize}px 'Roboto', 'Segoe UI', sans-serif`;
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;

        canvas.width = textWidth + padding * 2;
        canvas.height = fontSize + padding * 1.5;

        const w = canvas.width;
        const h = canvas.height;
        const r = h / 2; // Pill shape

        const ctx2 = canvas.getContext('2d');

        // Background pill with blur effect simulation
        ctx2.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx2.beginPath();
        ctx2.roundRect(0, 0, w, h, r);
        ctx2.fill();

        // Subtle border
        ctx2.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx2.lineWidth = 1.5;
        ctx2.stroke();

        // Text with slight shadow
        ctx2.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx2.shadowBlur = 4;
        ctx2.shadowOffsetY = 1;
        ctx2.font = `500 ${fontSize}px 'Roboto', 'Segoe UI', sans-serif`;
        ctx2.fillStyle = '#ffffff';
        ctx2.textAlign = 'center';
        ctx2.textBaseline = 'middle';
        ctx2.fillText(text, w / 2, h / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;

        const geometry = new THREE.PlaneGeometry(w * 0.018, h * 0.018);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide,
            depthTest: false
        });

        const mesh = new THREE.Mesh(geometry, material);
        return mesh;
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

                // Record initial state for UNDO
                const data = this.draggedMesh.userData.hotspotData;
                this.dragInitialState = {
                    data: data,
                    yaw: data.yaw,
                    pitch: data.pitch
                };

                // Select it too
                if (window.adminPanel) {
                    window.adminPanel.selectHotspot(data);
                }

                return true; // Capture event
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
            const radius = 45;
            const p = point.clone().normalize().multiplyScalar(radius);
            this.draggedMesh.position.copy(p);

            // Update orientation to match new position (Rigid Vertical)
            const forward = p.clone().normalize().negate();
            const worldUp = new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3().crossVectors(worldUp, forward).normalize();
            const up = new THREE.Vector3().crossVectors(forward, right).normalize();

            const matrix = new THREE.Matrix4();
            matrix.makeBasis(right, up, forward);
            this.draggedMesh.setRotationFromMatrix(matrix);

            // SYNC Label Position
            if (this.draggedMesh.userData.labelSprite) {
                const labelMesh = this.draggedMesh.userData.labelSprite;
                const data = this.draggedMesh.userData.hotspotData;
                const size = data.size || 3;
                const textSize = data.textSize || 1.0;
                const labelOffset = data.labelOffset !== undefined ? data.labelOffset : 0;

                // Calculate current yaw/pitch from current position to position label
                const currentPos = p.clone().normalize();
                const currentPitch = Math.asin(currentPos.y);
                const currentYawRad = Math.atan2(currentPos.x, -currentPos.z);

                // Position label slightly below
                const baseOffset = size * 0.8 + 2 * textSize;
                const labelPitchOffset = THREE.MathUtils.degToRad(baseOffset + labelOffset);
                const labelPitch = currentPitch - labelPitchOffset;

                const lx = radius * Math.sin(currentYawRad) * Math.cos(labelPitch);
                const ly = radius * Math.sin(labelPitch);
                const lz = -radius * Math.cos(currentYawRad) * Math.cos(labelPitch);

                labelMesh.position.set(lx, ly, lz);

                // Update Label Rotation (Rigid Vertical)
                const lForward = new THREE.Vector3().copy(labelMesh.position).normalize().negate();
                const lRight = new THREE.Vector3().crossVectors(worldUp, lForward).normalize();
                const lUp = new THREE.Vector3().crossVectors(lForward, lRight).normalize();
                const lMatrix = new THREE.Matrix4();
                lMatrix.makeBasis(lRight, lUp, lForward);
                labelMesh.setRotationFromMatrix(lMatrix);
            }
        }
        return true;
    }

    handleAdminMouseUp() {
        if (this.isDraggingHotspot && this.draggedMesh) {
            this.isDraggingHotspot = false;

            // Sync new position to global data structure
            const p = this.draggedMesh.position.clone().normalize();
            const pitch = THREE.MathUtils.radToDeg(Math.asin(p.y));
            let standardYaw = THREE.MathUtils.radToDeg(Math.atan2(p.x, -p.z));
            let yaw = standardYaw - 90;
            if (yaw < -180) yaw += 360;
            if (yaw > 180) yaw -= 360;

            const data = this.draggedMesh.userData.hotspotData;
            const oldYaw = this.dragInitialState.yaw;
            const oldPitch = this.dragInitialState.pitch;
            const newYaw = parseFloat(yaw.toFixed(2));
            const newPitch = parseFloat(pitch.toFixed(2));

            // Only push to undo if it actually moved
            if (oldYaw !== newYaw || oldPitch !== newPitch) {
                data.yaw = newYaw;
                data.pitch = newPitch;

                if (window.adminPanel) {
                    window.adminPanel.pushUndoCommand({
                        type: 'move',
                        hotspot: data,
                        oldYaw: oldYaw,
                        oldPitch: oldPitch,
                        newYaw: newYaw,
                        newPitch: newPitch
                    });
                    window.adminPanel.selectHotspot(data);
                    window.adminPanel.markDirty();
                }
            }

            this.draggedMesh = null;
            this.dragInitialState = null;
            return true;
        }
        return false;
    }

    // --- Icon Generation ---

    createIconTexture(type, customColor = null) {
        const key = 'icon_' + type + (customColor || '');
        if (this.textureCache && this.textureCache.has(key)) {
            return this.textureCache.get(key);
        }

        const size = 256; // Higher res for quality
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const cx = size / 2;
        const cy = size / 2;
        const radius = size / 2 - 8;

        // Modern frosted glass circle with glow
        const drawBase = (primaryColor, glowColor) => {
            // Outer glow
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 20;

            // Main circle with gradient
            const grad = ctx.createRadialGradient(cx, cy * 0.8, 0, cx, cy, radius);
            grad.addColorStop(0, primaryColor);
            grad.addColorStop(1, this.adjustColor(primaryColor, -30));

            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();

            // Inner highlight ring
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cx, cy, radius - 6, 0, Math.PI * 2);
            ctx.stroke();

            // Top highlight arc for 3D effect
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.arc(cx, cy, radius - 20, -Math.PI * 0.8, -Math.PI * 0.2);
            ctx.stroke();
        };

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Default colors per type
        const defaultColors = {
            arrow: '#4f46e5',
            scene: '#4f46e5',
            info: '#0ea5e9',
            plus: '#10b981',
            home: '#8b5cf6',
            photo: '#f59e0b',
            video: '#ef4444'
        };

        // Use custom color or default
        const color = customColor || defaultColors[type] || '#64748b';
        const glowColor = this.hexToRgba(color, 0.6);

        if (type === 'arrow' || type === 'location' || type === 'scene') {
            drawBase(color, glowColor);
            // Modern Location Pin
            ctx.fillStyle = '#fff';
            // Pin Body
            ctx.beginPath();
            ctx.moveTo(cx, cy + 50); // Bottom tip
            ctx.bezierCurveTo(cx - 50, cy + 10, cx - 45, cy - 55, cx, cy - 55); // Left curve
            ctx.bezierCurveTo(cx + 45, cy - 55, cx + 50, cy + 10, cx, cy + 50); // Right curve
            ctx.fill();

            // Hole in pin
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.arc(cx, cy - 15, 18, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
        } else if (type === 'info') {
            drawBase(color, glowColor);
            // Clean "i" icon
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(cx, cy - 45, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillRect(cx - 10, cy - 20, 20, 70);
            // Rounded bottom
            ctx.beginPath();
            ctx.arc(cx, cy + 50, 10, 0, Math.PI * 2);
            ctx.fill();
        } else if (type === 'plus') {
            drawBase(color, glowColor);
            // Plus sign
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 16;
            ctx.beginPath();
            ctx.moveTo(cx, cy - 40);
            ctx.lineTo(cx, cy + 40);
            ctx.moveTo(cx - 40, cy);
            ctx.lineTo(cx + 40, cy);
            ctx.stroke();
        } else if (type === 'home') {
            drawBase(color, glowColor);
            // House icon
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            // Roof
            ctx.moveTo(cx, cy - 50);
            ctx.lineTo(cx + 55, cy);
            ctx.lineTo(cx - 55, cy);
            ctx.closePath();
            ctx.fill();
            // Body
            ctx.fillRect(cx - 40, cy, 80, 50);
            // Door
            ctx.fillStyle = this.hexToRgba(color, 0.8);
            ctx.fillRect(cx - 15, cy + 15, 30, 35);
        } else if (type === 'photo') {
            drawBase(color, glowColor);
            // Camera icon
            ctx.fillStyle = '#fff';
            // Body
            ctx.beginPath();
            ctx.roundRect(cx - 50, cy - 25, 100, 65, 8);
            ctx.fill();
            // Lens
            ctx.fillStyle = this.hexToRgba(color, 0.9);
            ctx.beginPath();
            ctx.arc(cx, cy + 5, 25, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(cx, cy + 5, 15, 0, Math.PI * 2);
            ctx.fill();
            // Viewfinder
            ctx.fillStyle = '#fff';
            ctx.fillRect(cx - 20, cy - 40, 40, 15);
        } else if (type === 'video') {
            drawBase(color, glowColor);
            // Play triangle
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(cx - 25, cy - 40);
            ctx.lineTo(cx + 40, cy);
            ctx.lineTo(cx - 25, cy + 40);
            ctx.closePath();
            ctx.fill();
        } else {
            // Default circle
            drawBase(color, glowColor);
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(cx, cy, 20, 0, Math.PI * 2);
            ctx.fill();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        if (!this.textureCache) this.textureCache = new Map();
        this.textureCache.set(key, texture);
        return texture;
    }

    // Helper to darken/lighten colors
    adjustColor(hex, amount) {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.min(255, Math.max(0, (num >> 16) + amount));
        const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
        const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
        return `rgb(${r},${g},${b})`;
    }

    // Helper to convert hex to rgba
    hexToRgba(hex, alpha) {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = (num >> 16) & 0xFF;
        const g = (num >> 8) & 0xFF;
        const b = num & 0xFF;
        return `rgba(${r},${g},${b},${alpha})`;
    }

    createHotspotMesh(data) {
        if (!data) return null;

        const type = data.type || 'arrow';
        const size = data.size || 3;
        const color = data.color || null;
        const iconUrl = data.icon_url || null;

        const geometry = new THREE.PlaneGeometry(size, size);
        const material = new THREE.MeshBasicMaterial({
            transparent: true,
            side: THREE.DoubleSide,
            depthTest: false
        });

        // Load Icon
        if (iconUrl) {
            this.textureLoader.load(iconUrl, (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                material.map = tex;
                material.needsUpdate = true;
            });
        } else {
            material.map = this.createIconTexture(type, color);
        }

        const mesh = new THREE.Mesh(geometry, material);

        // Position logic
        const radius = 45;
        const yawRad = THREE.MathUtils.degToRad((data.yaw || 0) + 90);
        const pitchRad = THREE.MathUtils.degToRad(data.pitch || 0);

        const x = radius * Math.sin(yawRad) * Math.cos(pitchRad);
        const y = radius * Math.sin(pitchRad);
        const z = -radius * Math.cos(yawRad) * Math.cos(pitchRad);

        mesh.position.set(x, y, z);

        // --- Rigid Vertical Orientation Fix ---
        // We construct a rotation matrix that faces the center (Forward)
        // but keeps the Right vector horizontal (parallel to XZ plane).
        const forward = new THREE.Vector3().copy(mesh.position).normalize().negate();
        const worldUp = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(worldUp, forward).normalize();
        const up = new THREE.Vector3().crossVectors(forward, right).normalize();

        const matrix = new THREE.Matrix4();
        // PlaneGeometry faces +Z, so we map our basis: X=right, Y=up, Z=forward (looking at center)
        matrix.makeBasis(right, up, forward);
        mesh.setRotationFromMatrix(matrix);

        mesh.userData.isInteractable = true;
        mesh.userData.label = data.label || 'Hotspot'; // For GAZE logs
        mesh.userData.hotspotData = data; // Link back to data object

        // Add Label Mesh - position independently to avoid tilt
        if (data.label) {
            const textSize = data.textSize || 1.0;
            const labelOffset = data.labelOffset !== undefined ? data.labelOffset : 0;
            const labelMesh = this.createLabel(data.label, textSize);

            // Calculate label position (slightly below the hotspot)
            const labelRadius = radius;
            // Base offset is dynamic: size*0.8 + 2*textSize. Then add the custom offset.
            const baseOffset = size * 0.8 + 2 * textSize;
            const finalOffsetDeg = baseOffset + labelOffset;

            const labelPitchRad = THREE.MathUtils.degToRad((data.pitch || 0) - finalOffsetDeg); // Offset pitch
            const labelX = labelRadius * Math.sin(yawRad) * Math.cos(labelPitchRad);
            const labelY = labelRadius * Math.sin(labelPitchRad);
            const labelZ = -labelRadius * Math.cos(yawRad) * Math.cos(labelPitchRad);

            labelMesh.position.set(labelX, labelY, labelZ);

            // Rotation Match (Vertical Lock)
            const lForward = new THREE.Vector3().copy(labelMesh.position).normalize().negate();
            const lRight = new THREE.Vector3().crossVectors(worldUp, lForward).normalize();
            const lUp = new THREE.Vector3().crossVectors(lForward, lRight).normalize();
            const lMatrix = new THREE.Matrix4();
            lMatrix.makeBasis(lRight, lUp, lForward);
            labelMesh.setRotationFromMatrix(lMatrix);
            labelMesh.renderOrder = 9999;

            this.hotspotsGroup.add(labelMesh);
            mesh.userData.labelSprite = labelMesh;
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

                    if (this.infoPanel3D) {
                        // Always show 3D Panel (Desktop & VR) as requested
                        this.infoPanel3D.show(data);
                    } else if (this.infoOverlay) {
                        // Fallback
                        this.infoOverlay.show(data);
                    }
                }
            }
        };

        mesh.renderOrder = 9999;
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
            this.backBtn.visible = false; // Forced false - Menu is gone
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
        this.isVR = isVR;

        // Boost brightness significantly in VR mode to ensure clarity
        this.panoramaBrightness = isVR ? 1.5 : 1.0;
        if (this.basicMaterial) {
            this.basicMaterial.color.setScalar(this.panoramaBrightness);
        }

        // In VR, we might want to hide the floating back button 
        // because the SubMenu handles it, or use Gaze.
        // For now, let's keep it simple.
        this.setBackButtonVisibility(!isVR);

        // If exiting VR, hide 3D panel
        if (!isVR && this.infoPanel3D) {
            this.infoPanel3D.hide();
        }
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
