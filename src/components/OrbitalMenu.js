import * as THREE from 'three';
import { TOUR_DATA } from '../data/tourData.js';
import { CanvasUI } from '../utils/CanvasUI.js';
import { CONFIG } from '../config.js';

export class OrbitalMenu {
    constructor(scene, camera, onSelect) {
        this.scene = scene;
        this.camera = camera;
        this.onSelect = onSelect;

        this.group = new THREE.Group();
        this.scene.add(this.group);

        this.thumbnails = [];
        this.radius = CONFIG.menu?.radius || 2.5;
        // Use CONFIG or default. 2.5m is good for "Arc" layout.

        this.itemCount = TOUR_DATA.length;
        this.textureLoader = new THREE.TextureLoader();

        this.initMenu();
    }

    initMenu() {
        // Use shared roundRect from CanvasUI
        const roundRect = CanvasUI.roundRect;

        // Create thumbnail card with image
        const createThumbnailTexture = (location, img) => {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 340;
            const ctx = canvas.getContext('2d');

            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Glass Background - Premium Dark
            roundRect(ctx, 10, 10, 492, 320, 30);
            ctx.fillStyle = 'rgba(20, 20, 35, 0.6)';
            ctx.fill();

            // Subtle Gradient Overlay
            const gradient = ctx.createLinearGradient(0, 0, 0, 340);
            gradient.addColorStop(0, 'rgba(60, 60, 80, 0.2)');
            gradient.addColorStop(1, 'rgba(10, 10, 20, 0.8)');
            ctx.fillStyle = gradient;
            ctx.fill();

            // Border (Glass edge)
            ctx.lineWidth = 4;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.stroke();

            // Draw thumbnail image
            if (img) {
                ctx.save();
                roundRect(ctx, 30, 30, 452, 220, 20);
                // Reduce height for Subtitle space?
                // Request said: "Masa Lalu" -> "Heroik" (Titles).
                // Let's keep layout similar but ensure Title is Prominent.
                ctx.clip();
                ctx.drawImage(img, 30, 30, 452, 220); // Maintain size
                ctx.restore();
            } else {
                // Fallback gradient
                ctx.save();
                roundRect(ctx, 30, 30, 452, 220, 20);
                ctx.clip();
                const hue = (location.id * 60) % 360;
                ctx.fillStyle = `hsl(${hue}, 40%, 40%)`;
                ctx.fillRect(30, 30, 452, 220);
                ctx.restore();
            }

            // Title Label (e.g. "HEROIK")
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 36px Roboto, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.7)';
            ctx.shadowBlur = 6;
            ctx.fillText((location.title || location.name).toUpperCase(), 256, 275);

            // Subtitle (e.g. "Semangat Maritim")
            if (location.subtitle) {
                ctx.font = 'italic 20px Roboto, sans-serif';
                ctx.fillStyle = '#cccccc';
                ctx.fillText(location.subtitle, 256, 305);
            }

            return new THREE.CanvasTexture(canvas);
        };

        for (let i = 0; i < this.itemCount; i++) {
            const location = TOUR_DATA[i];
            const geometry = new THREE.PlaneGeometry(0.9, 0.6); // Larger size for better visibility

            // Initial placeholder material
            const material = new THREE.MeshBasicMaterial({
                color: 0x333333,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.95
            });
            const mesh = new THREE.Mesh(geometry, material);

            // Load thumbnail image
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const texture = createThumbnailTexture(location, img);
                mesh.material.map = texture;
                mesh.material.color.set(0xffffff);
                mesh.material.needsUpdate = true;
            };
            img.onerror = () => {
                // Use fallback
                const texture = createThumbnailTexture(location, null);
                mesh.material.map = texture;
                mesh.material.color.set(0xffffff);
                mesh.material.needsUpdate = true;
            };
            img.src = location.thumbnail;

            // Position in arc
            const totalAngle = Math.PI * 0.5; // Balanced spacing
            const startAngle = Math.PI - totalAngle / 2;
            const step = this.itemCount > 1 ? totalAngle / (this.itemCount - 1) : 0;
            const theta = startAngle + i * step;

            mesh.position.set(
                Math.sin(theta) * this.radius,
                1.6,
                Math.cos(theta) * this.radius
            );

            mesh.lookAt(0, 1.6, 0);

            // User Data for interaction
            mesh.userData.id = i;
            mesh.userData.locationData = location;
            mesh.userData.isInteractable = true;
            mesh.userData.originalScale = new THREE.Vector3(1, 1, 1);
            mesh.userData.targetScale = new THREE.Vector3(1, 1, 1); // Target for smooth lerping

            // Callbacks - now set targetScale instead of direct scale change
            mesh.onHoverIn = () => {
                mesh.userData.targetScale.set(1.15, 1.15, 1.15);
            };
            mesh.onHoverOut = () => {
                mesh.userData.targetScale.copy(mesh.userData.originalScale);
            };
            mesh.onClick = () => {
                this.onSelect(i);
            };

            this.group.add(mesh);
            this.thumbnails.push(mesh);
        }
    }

    update(delta) {
        // Smooth scale animation with ease-in-out
        const animSpeed = 5; // Animation speed multiplier

        this.thumbnails.forEach(mesh => {
            if (mesh.userData.targetScale) {
                // Initialize animation progress if not set
                if (mesh.userData.animProgress === undefined) {
                    mesh.userData.animProgress = 1;
                }

                // Detect target change - start new animation
                const diff = mesh.scale.distanceTo(mesh.userData.targetScale);
                if (diff > 0.01 && mesh.userData.animProgress >= 1) {
                    mesh.userData.animProgress = 0;
                    mesh.userData.startScale = mesh.scale.clone();
                }

                if (mesh.userData.animProgress < 1 && mesh.userData.startScale) {
                    // Increment progress
                    mesh.userData.animProgress = Math.min(1, mesh.userData.animProgress + delta * animSpeed);

                    // Ease-in-out (smoothstep)
                    const t = mesh.userData.animProgress;
                    const easeInOut = t * t * (3 - 2 * t);

                    // Interpolate using eased value
                    mesh.scale.lerpVectors(
                        mesh.userData.startScale,
                        mesh.userData.targetScale,
                        easeInOut
                    );
                }
            }
        });

        // Smart Rotation Follow (HUD-like behavior)
        if (this.camera && this.group.visible) {
            // Get camera direction projected on XZ plane
            const vector = new THREE.Vector3();
            this.camera.getWorldDirection(vector);

            // Calculate target angle (facing the user)
            // Menu center should be "behind" the camera view projected forward
            // So if camera looks at A, menu center is at A + PI (behind it? No wait.)
            // The items are arranged in a circle. If I want item 0 (at angle ~PI) to be in front,
            // Group rotation needs to align.
            // Let's rely on show() logic: rotation.y = angle - PI
            const targetAngle = Math.atan2(vector.x, vector.z) - Math.PI;

            // Calculate difference
            let currentAngle = this.group.rotation.y;
            let diff = targetAngle - currentAngle;

            // Normalize difference to [-PI, PI]
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            // Check if looking down (at the menu)
            // If pitch is negative, user is looking,down.
            // Menu items are usually around y=1.6 (eye level) but placed lower relative to view?
            // Actually OrbitalMenu items are at y=1.6 which is eye level.
            // Wait, OrbitalMenu items are at y=1.6, camera is at y=1.6. They are AT eye level.
            // BUT usually users look around.
            // Let's check config.js line 23: radius = 2.5
            // If the user is looking at the horizon (pitch ~0), the menu should follow.
            // If the user wants to select, they might just stare at it.
            // The "moving away" issue happens because the user turns their head to look at an item at the edge,
            // and the menu rotates to recenter, making the item move away.

            // Fix: Increase deadzone or add a "hover lock".
            // Since we don't track hover state easily here without coupling, let's use the requested "row" logic.
            // "kalau berada di barisnya menu" -> if looking at the vertical band of the menu?
            // Since menu is at eye level, "barisnya menu" means roughly horizon level (+- 10 degrees).
            // But if it follows when at horizon, it's annoying.

            // User said: "kalau berada di barisnya menu" implies a vertical zone.
            // Let's assume standard VR usage: You look at it to select.

            // BETTER APPROACH: Only move if user looks WAY away (e.g. > 30 degrees)
            // OR check pitch: if looking up/down/at menu?

            // Re-reading user request: "kalau berada di barisnya menu"
            // Maybe they mean if the user's view pitch is within the menu's vertical area.
            // Let's simply PAUSE rotation if the angular difference is small (user is looking AT the menu set)
            // AND check pitch.

            // Actually, best interpretation: If I am looking at the menu items (pitch roughly 0 since they are at eye level 1.6),
            // disable rotation. If I look UP or DOWN explicitly away, or turn around, then move.

            // Let's implement a simple "Lock" if the cursor is hovering? 
            // We can't easily access hover state here.

            // Let's use the pitch. orbitalMenu items are at y=1.6. Camera at 1.6.
            // So pitch is ~0. 
            // If user looks vertically away (up/down), we can rotate.
            // But user said "if at the row of menu".

            // Let's interpret "follow" as "Recenter only when I look far away".
            // Increase threshold to 30 degrees (0.5 rad).
            // This allows looking at side items without rotation triggering.

            const pitch = Math.asin(vector.y);

            // If user is looking at the menu "band" (within +- 20 degrees pitch)
            // AND the horizontal difference is within the menu width (say +- 45 degrees)
            // THEN lock the menu (don't rotate).

            // Wait, if it's locked, how does it follow?
            // It follows only when you look OUTSIDE the menu area.

            const MENU_vertical_band = 0.15; // ~8.5 degrees (Tightened)
            const MENU_horizontal_width = 1.3; // ~75 degrees (Widened significantly)

            const isLookingAtMenuBand = Math.abs(pitch) < MENU_vertical_band;
            const isLookingInsideMenuWidth = Math.abs(diff) < MENU_horizontal_width;

            // Only follow if we are NOT looking at the menu area
            if (isLookingAtMenuBand && isLookingInsideMenuWidth) {
                // User is likely trying to select something, DO NOT MOVE
            } else {
                if (Math.abs(diff) > 0.1) { // Small deadzone for jitter
                    const followSpeed = 2.0 * delta;
                    this.group.rotation.y += diff * followSpeed;
                }
            }
        }
    }

    show() {
        this.group.visible = true;

        // Reset rotation to face the user
        if (this.camera) {
            // Get camera direction projected on XZ plane
            const vector = new THREE.Vector3();
            this.camera.getWorldDirection(vector);
            const angle = Math.atan2(vector.x, vector.z);

            // Rotate group to align with camera direction
            // Note: Menu items are at +Z relative to group center usually, or arranged in arc.
            // Our items are arranged around (0,0,0) facing center.
            // If user looks at angle A, we want the center of the arc to be at angle A.
            // The arc center is roughly at theta = PI (backwards).
            // Let's adjust offset based on layout.
            // Initial layout: center is at ~PI (back).
            // So if user looks at Angle, we want Group Angle to be matching.

            this.group.rotation.y = angle - Math.PI;
        }
    }

    hide() {
        this.group.visible = false;
    }

    dispose() {
        // Cleanup textures to prevent memory leaks
        this.thumbnails.forEach(mesh => {
            if (mesh.material.map) {
                mesh.material.map.dispose();
            }
            mesh.material.dispose();
            mesh.geometry.dispose();
        });
        this.scene.remove(this.group);
    }
}
