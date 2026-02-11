
import * as THREE from 'three';

export class InfoPanel3D {
    constructor(camera, scene) {
        this.camera = camera;
        this.scene = scene;
        this.group = new THREE.Group();
        this.scene.add(this.group);
        this.group.visible = false;

        this.width = 1.0;
        this.height = 0.8;

        this.init();
    }

    init() {
        // Plane for content
        const geometry = new THREE.PlaneGeometry(this.width, this.height);
        this.material = new THREE.MeshBasicMaterial({
            transparent: true,
            side: THREE.DoubleSide,
            depthTest: false, // Always show on top
            depthWrite: false // Important for translucent objects
        });
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.renderOrder = 9999;
        this.group.add(this.mesh);

        // Close Button (Interactive)
        // Increase size and push to front
        const closeGeo = new THREE.CircleGeometry(0.08, 32);
        const closeMat = new THREE.MeshBasicMaterial({
            color: 0xef4444,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
            transparent: true
        });
        this.closeBtn = new THREE.Mesh(closeGeo, closeMat);
        this.closeBtn.renderOrder = 10000;
        // Position at top-right corner, significantly in front (Positive Z)
        this.closeBtn.position.set(this.width / 2 - 0.02, this.height / 2 - 0.02, 0.05);

        this.closeBtn.userData.isInteractable = true;
        this.closeBtn.onClick = () => {
            console.log('Close button clicked!');
            this.hide();
        };

        // Hover Scale Effect
        this.closeBtn.userData.originalScale = new THREE.Vector3(1, 1, 1);
        this.closeBtn.onHoverIn = () => {
            document.body.style.cursor = 'pointer';
            this.closeBtn.scale.set(1.2, 1.2, 1.2);
        };
        this.closeBtn.onHoverOut = () => {
            document.body.style.cursor = 'default';
            this.closeBtn.scale.set(1, 1, 1);
        };

        // Add "X" text to button
        const xCanvas = document.createElement('canvas');
        xCanvas.width = 64; xCanvas.height = 64;
        const ctx = xCanvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.font = 'bold 40px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('×', 32, 32);
        const xTex = new THREE.CanvasTexture(xCanvas);
        const xMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08), new THREE.MeshBasicMaterial({
            map: xTex,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide
        }));
        xMesh.position.z = 0.01; // Slightly in front of red circle
        xMesh.renderOrder = 10001;
        this.closeBtn.add(xMesh);

        this.group.add(this.closeBtn);
    }

    drawTexture(title, description, bgColor = 'rgba(30, 41, 59, 0.95)') {
        const w = 1024;
        const h = 800;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');

        // Background (Custom color)
        ctx.fillStyle = bgColor;
        this.roundRect(ctx, 0, 0, w, h, 40);
        ctx.fill();

        // Border (Slightly lighter than bg for glass effect)
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.stroke();

        // Title
        ctx.fillStyle = '#f3f4f6'; // Gray 100
        ctx.font = 'bold 70px Roboto, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(title, 60, 60);

        // Separator Line
        ctx.beginPath();
        ctx.moveTo(60, 160);
        ctx.lineTo(w - 60, 160);
        ctx.strokeStyle = '#4b5563'; // Gray 600
        ctx.lineWidth = 2;
        ctx.stroke();

        // Description
        ctx.fillStyle = '#d1d5db'; // Gray 300
        ctx.font = '40px Roboto, sans-serif';
        this.wrapText(ctx, description, 60, 200, w - 120, 60);

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        return tex;
    }

    wrapText(ctx, text, x, y, maxWidth, lineHeight) {
        if (!text) return;
        const words = text.split(' ');
        let line = '';

        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = ctx.measureText(testLine);
            const testWidth = metrics.width;
            if (testWidth > maxWidth && n > 0) {
                ctx.fillText(line, x, y);
                line = words[n] + ' ';
                y += lineHeight;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line, x, y);
    }

    roundRect(ctx, x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    show(data) {
        if (!data) return;

        const title = data.title || data.label || 'Information';
        const description = data.description || 'No description available.';

        // Custom Styles
        const width = data.infoWidth || 1.0;
        const height = data.infoHeight || 0.8;
        const color = data.infoColor || '#1e293b';
        const opacity = data.infoOpacity !== undefined ? data.infoOpacity : 0.95;

        // Convert HEX to RGBA for canvas background
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        const rgba = `rgba(${r}, ${g}, ${b}, 1.0)`; // Opacity handled by material

        // Update Geometry
        this.mesh.geometry.dispose();
        this.mesh.geometry = new THREE.PlaneGeometry(width, height);

        // Update Material
        if (this.material.map) this.material.map.dispose();
        this.material.map = this.drawTexture(title, description, rgba);
        this.material.opacity = opacity;
        this.material.needsUpdate = true;

        // Position Close Button based on new size
        this.closeBtn.position.set(width / 2 - 0.02, height / 2 - 0.02, 0.05);

        // Position 1.2m in front of camera
        this.group.visible = true;

        const dist = 1.2;
        const vec = new THREE.Vector3(0, 0, -dist);
        vec.applyQuaternion(this.camera.quaternion);
        this.group.position.copy(this.camera.position).add(vec);
        this.group.lookAt(this.camera.position);
    }

    hide() {
        this.group.visible = false;
    }

    update(delta) {
        // Optional animation logic
    }
}
