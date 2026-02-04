import * as THREE from 'three';
import { TOUR_DATA } from '../data/tourData.js';
import { CONFIG } from '../config.js';
import { CanvasUI } from '../utils/CanvasUI.js';

/**
 * TourDirector - Controls the cinematic guided tour flow
 * Features: Speed Ramp FOV Transition, Floating Control Dock
 */
export class TourDirector {
    constructor(app) {
        this.app = app;
        this.currentIndex = -1;
        this.isPlaying = false;
        this.isPaused = false;
        this.isMuted = false;
        this.timer = 0;
        this.currentDuration = 10;
        this.isTransitioning = false;

        // Transition SFX
        this.transitionSfx = new Audio('/assets/sfx/whoosh-cinematic-376875.mp3');
        this.transitionSfx.volume = 0.6;
        this.transitionSfx.preload = 'auto'; // Ensure it loads
        this.transitionSfx.addEventListener('canplaythrough', () => console.log('SFX loaded and ready'));
        this.transitionSfx.addEventListener('error', (e) => console.error('SFX Error:', e));

        // UI Click SFX
        this.clickSfx = new Audio('/assets/sfx/ui-sound-374228.mp3');
        this.clickSfx.volume = 0.5;
        this.clickSfx.preload = 'auto';

        this.createControlDock();
    }

    playClickSfx() {
        if (!this.clickSfx) return;
        this.clickSfx.currentTime = 0;
        this.clickSfx.play().catch(e => console.warn('Click SFX blocked:', e));
    }

    // ==================== SPEED RAMP TRANSITION ====================

    // Speed Ramp: FOV increases (rush forward), load, FOV decreases (arrival)
    transitionSlide(direction = 'next', onComplete) {
        if (this.isTransitioning) return;
        this.isTransitioning = true;

        // Play SFX
        if (!this.isMuted && this.transitionSfx) {
            console.log('Attempting to play SFX...');
            this.transitionSfx.currentTime = 0;
            this.transitionSfx.play().then(() => {
                console.log('SFX Playing');
            }).catch(e => {
                console.warn('SFX play blocked or failed:', e);
            });
        } else {
            console.log('SFX skipped. Muted:', this.isMuted, 'SFX Ref:', !!this.transitionSfx);
        }

        const camera = this.app.camera;
        if (!camera) {
            this.isTransitioning = false;
            if (onComplete) onComplete();
            return;
        }

        const startFOV = camera.fov;
        const peakFOV = CONFIG.tour?.peakFOV || 140;
        const duration = CONFIG.tour?.transitionDuration || 800;

        // Phase 1: Speed Up (FOV increases rapidly)
        this.animateFOV(camera, startFOV, peakFOV, duration, () => {
            // At peak: Load new scene
            if (this.app.loadLocation) {
                this.app.loadLocation(this.currentIndex);
            }

            // Force mute sync
            setTimeout(() => {
                this.toggleMute(); this.toggleMute();
            }, 50);

            // Phase 2: Speed Down (FOV decreases back)
            setTimeout(() => {
                this.animateFOV(camera, peakFOV, startFOV, duration, () => {
                    this.isTransitioning = false;
                    if (onComplete) onComplete();
                });
            }, 200);
        });
    }

    animateFOV(camera, fromFOV, toFOV, duration, onComplete) {
        const startTime = performance.now();
        const canvas = this.app.renderer?.domElement;
        const isSpeedingUp = toFOV > fromFOV;
        const maxBlur = CONFIG.tour?.motionBlur || 20;

        const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Ease-in-out curve for smooth speed ramp feel
            const eased = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;

            camera.fov = fromFOV + (toFOV - fromFOV) * eased;
            camera.updateProjectionMatrix();

            // Motion Blur: Radial blur simulation via CSS
            if (canvas) {
                let blurAmount;
                if (isSpeedingUp) {
                    // Increasing blur as we speed up
                    blurAmount = eased * maxBlur;
                } else {
                    // Decreasing blur as we slow down
                    blurAmount = (1 - eased) * maxBlur;
                }
                canvas.style.filter = `blur(${blurAmount}px)`;
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                // Reset blur when done
                if (canvas && !isSpeedingUp) {
                    canvas.style.filter = '';
                }
                if (onComplete) onComplete();
            }
        };

        requestAnimationFrame(animate);
    }

    // ==================== FLOATING CURVED DOCK ====================

    createControlDock() {
        this.dockGroup = new THREE.Group();
        this.dockGroup.position.set(0, 1.6, 0);
        this.dockGroup.visible = false;

        this.controlContainer = new THREE.Group();
        this.controlContainer.position.set(0, -0.7, 0);
        this.controlContainer.rotation.x = -0.25; // Tilt UP towards user

        this.dockGroup.add(this.controlContainer);

        // Responsive Mobile Scaling
        const isPortrait = window.innerHeight > window.innerWidth;
        // Reduce radius in portrait so controls aren't too far
        const radius = isPortrait ? (CONFIG.tour?.dockRadiusMobile || 1.4) : (CONFIG.tour?.dockRadius || 1.8);
        const angleStep = isPortrait ? 0.22 : 0.15; // Spread out more in portrait

        // Helper to place mesh on arc
        const placeOnArc = (mesh, angleOffset, yOffset = 0) => {
            mesh.position.set(
                Math.sin(angleOffset) * radius,
                yOffset,
                -Math.cos(angleOffset) * radius
            );
            mesh.lookAt(0, yOffset, 0);

            // Scale down slightly on mobile
            if (isPortrait) {
                mesh.scale.multiplyScalar(0.85);
                mesh.userData.originalScale.multiplyScalar(0.85);
                mesh.userData.targetScale.copy(mesh.userData.originalScale);
            }
        };

        // --- THUMBNAIL CARDS FOR PREV / NEXT ---
        const len = TOUR_DATA.length;
        const prevIdx = len - 1; // Start: prev is last zone
        const nextIdx = 1;       // Start: next is zone 1

        // PREV CARD (Left side)
        this.prevBtn = this.createThumbnailCard(prevIdx, 320, 240, () => {
            this.playClickSfx();
            this.previous();
        });
        placeOnArc(this.prevBtn, -angleStep * 2.2); // Closer (was 2.5)
        this.controlContainer.add(this.prevBtn);

        // NEXT CARD (Right side)  
        this.nextBtn = this.createThumbnailCard(nextIdx, 320, 240, () => {
            this.playClickSfx();
            this.next();
        });
        placeOnArc(this.nextBtn, angleStep * 2.2); // Closer (was 2.5)
        this.controlContainer.add(this.nextBtn);

        // --- CONTROL BUTTONS (Center) ---
        const createSmallBtn = (label, angleOffset, wPx, onClick) => {
            const btn = this.createButtonMesh(label, wPx, 160, onClick); // Increased height: 120 -> 160
            placeOnArc(btn, angleOffset);
            this.controlContainer.add(btn);
            return btn;
        };

        // PAUSE (Center)
        // Increased width: 150 -> 200, Offset adjusted
        this.pauseBtn = createSmallBtn('icon-pause', -angleStep * 0.7, 200, () => {
            console.log('[PAUSE BTN] onClick executed! this:', this, 'togglePause:', this.togglePause);
            this.playClickSfx();
            this.togglePause();
        });

        // MUTE (Center-Right)
        this.muteBtn = createSmallBtn(this.isMuted ? 'icon-sound-off' : 'icon-sound-on', angleStep * 0.7, 200, () => {
            console.log('[MUTE BTN] onClick executed!');
            this.playClickSfx();
            this.toggleMute();
        });

        if (this.app.scene) {
            this.app.scene.add(this.dockGroup);
        }
    }

    // Update navigation cards when zone changes
    updateDockNavigation() {
        if (!this.prevBtn || !this.nextBtn) return;

        const len = TOUR_DATA.length;
        const cur = Math.max(0, this.currentIndex);

        // Disable circular navigation
        // Hide PREV button if at start (index 0)
        if (cur === 0) {
            this.prevBtn.visible = false;
        } else {
            this.prevBtn.visible = true;
            this.updateThumbnailCard(this.prevBtn, cur - 1);
        }

        // Hide NEXT button if at end (index len-1)
        if (cur >= len - 1) {
            this.nextBtn.visible = false;
        } else {
            this.nextBtn.visible = true;
            this.updateThumbnailCard(this.nextBtn, cur + 1);
        }
    }

    createButtonMesh(text, wPx, hPx, onClick) {
        // Create premium glassmorphism button
        const canvas = document.createElement('canvas');
        canvas.width = wPx;
        canvas.height = hPx;
        const ctx = canvas.getContext('2d');

        this.drawPremiumButton(ctx, canvas.width, canvas.height, text, false);

        const texture = new THREE.CanvasTexture(canvas);
        const wWorld = wPx * 0.001;
        const hWorld = hPx * 0.001;

        const geometry = new THREE.PlaneGeometry(wWorld, hWorld);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);

        mesh.userData.isInteractable = true;
        mesh.userData.originalScale = new THREE.Vector3(1, 1, 1);
        mesh.userData.targetScale = new THREE.Vector3(1, 1, 1);
        mesh.userData.animProgress = 1;
        mesh.userData.buttonCanvas = canvas;
        mesh.userData.label = text;

        mesh.onHoverIn = () => mesh.userData.targetScale.set(1.15, 1.15, 1.15);
        mesh.onHoverOut = () => mesh.userData.targetScale.copy(mesh.userData.originalScale);
        mesh.onClick = onClick;

        return mesh;
    }

    createThumbnailCard(index, wPx, hPx, onClick) {
        const canvas = document.createElement('canvas');
        canvas.width = wPx;
        canvas.height = hPx;
        const ctx = canvas.getContext('2d');

        // Initial draw
        const data = TOUR_DATA[index];
        this.drawThumbnailCard(ctx, wPx, hPx, data, false);

        const texture = new THREE.CanvasTexture(canvas);
        const wWorld = wPx * 0.001;
        const hWorld = hPx * 0.001;

        const geometry = new THREE.PlaneGeometry(wWorld, hWorld);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);

        mesh.userData.isInteractable = true;
        mesh.userData.originalScale = new THREE.Vector3(1, 1, 1);
        mesh.userData.targetScale = new THREE.Vector3(1, 1, 1);
        mesh.userData.animProgress = 1;
        mesh.userData.buttonCanvas = canvas;
        mesh.userData.tourIndex = index; // Store which zone this card points to
        mesh.userData.label = 'thumbnail-' + index; // Add label for debugging

        mesh.onHoverIn = () => mesh.userData.targetScale.set(1.1, 1.1, 1.1);
        mesh.onHoverOut = () => mesh.userData.targetScale.copy(mesh.userData.originalScale);
        mesh.onClick = onClick;

        return mesh;
    }

    drawThumbnailCard(ctx, w, h, data, isActive = false) {
        ctx.clearRect(0, 0, w, h);

        const padding = 6;
        const radius = 16;

        // 1. Card Background (Black)
        CanvasUI.roundRect(ctx, 0, 0, w, h, radius);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.95)'; // Solid black (with slight transparency)
        ctx.fill();

        // 2. Mock Image Area (Top 70%)
        const imgH = h * 0.7;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(padding, padding, w - padding * 2, imgH - padding, [radius - 4, radius - 4, 0, 0]);
        ctx.clip();

        // Mock Thumbnail (White)
        ctx.fillStyle = '#ffffff'; // Plain white
        ctx.fillRect(0, 0, w, imgH);

        // Thumbnail Text overlay (Number)
        ctx.fillStyle = '#000000'; // Black text

        ctx.font = 'bold 60px Roboto';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(data ? (data.id + 1) : '?', w / 2, imgH / 2);

        ctx.restore();

        // 3. Label Area (Bottom 30%)
        const labelY = imgH + (h - imgH) / 2;

        ctx.fillStyle = isActive ? '#4ff' : '#ffffff';
        ctx.font = 'bold 24px Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const title = data ? data.title.toUpperCase() : 'UNKNOWN';
        ctx.fillText(title, w / 2, labelY);

        // 4. Border
        CanvasUI.roundRect(ctx, 0, 0, w, h, radius);
        ctx.strokeStyle = isActive ? 'rgba(100, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 4;
        ctx.stroke();
    }

    updateThumbnailCard(mesh, index) {
        if (!mesh) return;
        const data = TOUR_DATA[index];
        const ctx = mesh.userData.buttonCanvas.getContext('2d');
        const w = mesh.userData.buttonCanvas.width;
        const h = mesh.userData.buttonCanvas.height;

        // Store new index
        mesh.userData.tourIndex = index;

        this.drawThumbnailCard(ctx, w, h, data, false);
        mesh.material.map.needsUpdate = true;
    }

    drawPremiumButton(ctx, w, h, text, isActive = false) {
        ctx.clearRect(0, 0, w, h);

        const padding = 8;
        const radius = 20;

        // Outer glow
        ctx.shadowColor = isActive ? 'rgba(100, 255, 150, 0.6)' : 'rgba(255, 255, 255, 0.3)';
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
            gradient.addColorStop(0, 'rgba(60, 60, 70, 0.9)');
            gradient.addColorStop(1, 'rgba(30, 30, 35, 0.85)');
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
        ctx.strokeStyle = isActive ? 'rgba(150, 255, 180, 0.8)' : 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Text with shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = '#ffffff';

        // Text or Icon
        ctx.fillStyle = '#ffffff';

        if (text.startsWith('icon-')) {
            // Draw Vector Icon
            this.drawIcon(ctx, w, h, text);
        } else {
            // Draw Text
            const isEmoji = false; // logic removed, assuming text
            ctx.font = 'bold 32px Roboto, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, w / 2, h / 2);
        }
    }

    drawIcon(ctx, w, h, iconId) {
        ctx.save();
        ctx.translate(w / 2, h / 2);
        // Scale factor for icons (based on button size 200x160)
        // Base size ~40px
        const scale = 1.2;
        ctx.scale(scale, scale);

        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;

        if (iconId === 'icon-pause') {
            // Two vertical bars
            const barW = 12;
            const barH = 40;
            const gap = 12;
            ctx.beginPath();
            ctx.roundRect(-barW - gap / 2, -barH / 2, barW, barH, 4);
            ctx.roundRect(gap / 2, -barH / 2, barW, barH, 4);
            ctx.fill();
        }
        else if (iconId === 'icon-play') {
            // Triangle
            const size = 25;
            ctx.beginPath();
            ctx.moveTo(-size / 1.5, -size);
            ctx.lineTo(size, 0);
            ctx.lineTo(-size / 1.5, size);
            ctx.closePath();
            ctx.fill();
        }
        else if (iconId.startsWith('icon-sound')) {
            // Speaker body
            ctx.beginPath();
            ctx.moveTo(-20, -10);
            ctx.lineTo(-10, -10);
            ctx.lineTo(5, -22);
            ctx.lineTo(5, 22);
            ctx.lineTo(-10, 10);
            ctx.lineTo(-20, 10);
            ctx.closePath();
            ctx.fill();

            // Waves or X
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.strokeStyle = '#ffffff';

            if (iconId === 'icon-sound-on') {
                // Waves
                ctx.beginPath();
                ctx.arc(0, 0, 15, -Math.PI / 3, Math.PI / 3);
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(0, 0, 24, -Math.PI / 3, Math.PI / 3);
                ctx.stroke();
            } else {
                // X (Muted)
                const startX = 15;
                const size = 8;
                ctx.beginPath();
                ctx.moveTo(startX, -size);
                ctx.lineTo(startX + size * 2, size);
                ctx.moveTo(startX + size * 2, -size);
                ctx.lineTo(startX, size);
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    updateButtonText(mesh, text, isActive = false) {
        const canvas = mesh.userData.buttonCanvas;
        const ctx = canvas.getContext('2d');

        this.drawPremiumButton(ctx, canvas.width, canvas.height, text, isActive);
        mesh.material.map.needsUpdate = true;
    }

    // ==================== CONTROLS LOGIC ====================

    togglePause() {
        console.log('[DEBUG] togglePause called. isPaused:', this.isPaused, 'isPlaying:', this.isPlaying);
        if (this.isPaused) {
            this.resume();
        } else {
            this.pause();
        }
    }

    pause() {
        console.log('[DEBUG] pause() called. isPlaying:', this.isPlaying, 'isPaused:', this.isPaused);
        if (!this.isPlaying || this.isPaused) {
            console.log('[DEBUG] pause() early return - conditions not met');
            return;
        }
        this.isPaused = true;
        this.updateButtonText(this.pauseBtn, 'icon-play', true);
        console.log('[DEBUG] pause() complete - now paused');
    }

    resume() {
        console.log('[DEBUG] resume() called. isPlaying:', this.isPlaying, 'isPaused:', this.isPaused);
        if (!this.isPlaying || !this.isPaused) {
            console.log('[DEBUG] resume() early return - conditions not met');
            return;
        }
        this.isPaused = false;
        this.updateButtonText(this.pauseBtn, 'icon-pause', false);
        console.log('[DEBUG] resume() complete - now playing');
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        const icon = this.isMuted ? 'icon-sound-off' : 'icon-sound-on';
        this.updateButtonText(this.muteBtn, icon, this.isMuted);

        if (this.app.panoramaViewer) {
            // Mute global audio element if playing
            if (this.app.panoramaViewer.currentAudio) {
                this.app.panoramaViewer.currentAudio.muted = this.isMuted;
            }

            // Sync with AudioControls visual state if it exists (legacy UI)
            if (this.app.panoramaViewer.audioControls) {
                this.app.panoramaViewer.audioControls.isMuted = this.isMuted;
                this.app.panoramaViewer.audioControls.updateMuteButton(); // Corrected method name
            }
        }
    }

    // ==================== LIFECYCLE ====================

    start() {
        console.log('TourDirector: Starting unified control tour');
        this.isPlaying = true;
        this.isPaused = false;
        this.currentIndex = -1;
        this.dockGroup.visible = true;

        // Override default fade-in? Just start.
        this.nextZone('next');
    }

    stop() {
        this.isPlaying = false;
        this.dockGroup.visible = false;
        this.isTransitioning = false;
    }

    next() {
        console.log('TourDirector: Next clicked', { playing: this.isPlaying, transitioning: this.isTransitioning });
        if (!this.isPlaying || this.isTransitioning) return;

        // Prevent going past last slide
        if (this.currentIndex >= TOUR_DATA.length - 1) return;

        this.nextZone('next');
    }

    previous() {
        console.log('TourDirector: Previous clicked', { playing: this.isPlaying, transitioning: this.isTransitioning });
        if (!this.isPlaying || this.isTransitioning) return;

        // Prevent going before first slide
        if (this.currentIndex <= 0) return;

        this.currentIndex = Math.max(-1, this.currentIndex - 2); // Go back one (nextZone adds 1)
        this.nextZone('prev');
    }

    nextZone(direction = 'next') {
        this.currentIndex++;
        if (this.currentIndex >= TOUR_DATA.length) {
            // End of tour: stay on last slide and pause
            this.currentIndex = TOUR_DATA.length - 1;
            this.pause();
            return;
        }
        if (this.currentIndex < 0) this.currentIndex = 0;

        const zone = TOUR_DATA[this.currentIndex];
        this.currentDuration = zone.duration || 10;
        this.timer = 0;

        // Update navigation cards to show new prev/next destinations
        this.updateDockNavigation();

        console.log(`Tour Zone (${direction}): ${zone.title}`);

        // Trigger Slide Transition
        this.transitionSlide(direction, () => {
            console.log('Transition Complete');
        });
    }

    update(delta) {
        if (!this.isPlaying) return;

        if (!this.isPaused && !this.isTransitioning) {
            this.timer += delta;
            if (this.timer >= this.currentDuration) {
                this.nextZone();
            }
        }

        // Animate Buttons
        [this.prevBtn, this.nextBtn, this.pauseBtn, this.muteBtn].forEach(btn => {
            this.animateButton(btn, delta);
        });

        // Dock Smooth Follow Logic - with Look-to-Lock
        if (this.dockGroup.visible && this.app.camera) {
            const dir = new THREE.Vector3();
            this.app.camera.getWorldDirection(dir);

            // Check pitch (Y component) - negative = looking down
            const pitch = Math.asin(dir.y);
            const lookDownThreshold = -0.45; // ~26 degrees vertical

            // Check horizontal angle difference from dock center
            const viewAngle = Math.atan2(dir.x, dir.z) + Math.PI;
            let horizontalDiff = viewAngle - this.dockGroup.rotation.y;
            while (horizontalDiff > Math.PI) horizontalDiff -= Math.PI * 2;
            while (horizontalDiff < -Math.PI) horizontalDiff += Math.PI * 2;

            const dockWidthThreshold = 1.0; // ~57 degrees each side (generous margin)
            const isLookingAtDock = pitch < lookDownThreshold && Math.abs(horizontalDiff) < dockWidthThreshold;

            // Only follow if NOT looking at the dock
            if (!isLookingAtDock) {
                const targetAngle = viewAngle;

                let diff = targetAngle - this.dockGroup.rotation.y;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;

                this.dockGroup.rotation.y += diff * (CONFIG.tour?.dockFollowSpeed || 0.08);
            }
            // When looking at dock area: FREEZE
        }
    }

    animateButton(btn, delta) {
        if (!btn?.userData?.targetScale) return;
        const animSpeed = 8;
        const diff = btn.scale.distanceTo(btn.userData.targetScale);

        if (diff > 0.01 && btn.userData.animProgress >= 1) {
            btn.userData.animProgress = 0;
            btn.userData.startScale = btn.scale.clone();
        }

        if (btn.userData.animProgress < 1 && btn.userData.startScale) {
            btn.userData.animProgress = Math.min(1, btn.userData.animProgress + delta * animSpeed);
            const t = btn.userData.animProgress;
            const ease = t * t * (3 - 2 * t);
            btn.scale.lerpVectors(btn.userData.startScale, btn.userData.targetScale, ease);
        }
    }

    getInteractables() {
        if (!this.dockGroup?.visible) return [];

        // Force world matrix update so raycaster can hit buttons correctly
        this.dockGroup.updateMatrixWorld(true);

        return [this.prevBtn, this.nextBtn, this.pauseBtn, this.muteBtn].filter(Boolean);
    }

    dispose() {
        // Remove dock from scene
        if (this.dockGroup && this.app.scene) {
            this.app.scene.remove(this.dockGroup);
        }

        // Dispose button meshes
        [this.prevBtn, this.nextBtn, this.pauseBtn, this.muteBtn].forEach(btn => {
            if (btn) {
                btn.geometry?.dispose();
                if (btn.material?.map) btn.material.map.dispose();
                btn.material?.dispose();
            }
        });

        // Clear references
        this.prevBtn = null;
        this.nextBtn = null;
        this.pauseBtn = null;
        this.muteBtn = null;
        this.dockGroup = null;
    }
}
