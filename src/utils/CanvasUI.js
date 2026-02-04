/**
 * CanvasUI.js
 * Shared utilities for creating canvas-based UI elements in Three.js
 */

export const CanvasUI = {
    /**
     * Draws a rounded rectangle path on a canvas context
     */
    roundRect: (ctx, x, y, w, h, r) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    },

    /**
     * Creates a standard "Glass Pill" button texture
     * @param {string} text - The text to display
     * @param {object} options - Custom colors/size options
     */
    createButtonTexture: (text, options = {}) => {
        const width = options.width || 400;
        const height = options.height || 180;
        const radius = options.radius || 40;
        const fontSize = options.fontSize || 40;
        const bgColor = options.bgColor || 'rgba(200, 50, 50, 0.4)';
        const borderColor = options.borderColor || 'rgba(255, 100, 100, 0.8)';

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // Draw background
        ctx.clearRect(0, 0, width, height);
        CanvasUI.roundRect(ctx, 10, 10, width - 20, height - 20, radius);

        ctx.fillStyle = bgColor;
        ctx.fill();
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 8;
        ctx.stroke();

        // Draw Text
        ctx.fillStyle = 'white';
        ctx.font = `bold ${fontSize}px Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 5;
        ctx.fillText(text, width / 2, height / 2);

        return canvas;
    },

    /**
     * Creates a Play/Pause button texture
     */
    createPlayButtonTexture: (isPlaying) => {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 200;
        CanvasUI.drawPlayButton(canvas, isPlaying);
        return canvas;
    },

    drawPlayButton: (canvas, isPlaying) => {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 200, 200);

        // Background circle
        ctx.beginPath();
        ctx.arc(100, 100, 90, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(50, 150, 50, 0.6)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(100, 255, 100, 0.8)';
        ctx.lineWidth = 5;
        ctx.stroke();

        ctx.fillStyle = 'white';
        if (isPlaying) {
            // Pause icon
            ctx.fillRect(70, 60, 20, 80);
            ctx.fillRect(110, 60, 20, 80);
        } else {
            // Play icon
            ctx.beginPath();
            ctx.moveTo(75, 55);
            ctx.lineTo(75, 145);
            ctx.lineTo(145, 100);
            ctx.closePath();
            ctx.fill();
        }
    },

    /**
     * Creates a Mute/Unmute button texture
     */
    createMuteButtonTexture: (isMuted) => {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 200;
        CanvasUI.drawMuteButton(canvas, isMuted);
        return canvas;
    },

    drawMuteButton: (canvas, isMuted) => {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 200, 200);

        // Background circle
        ctx.beginPath();
        ctx.arc(100, 100, 90, 0, Math.PI * 2);
        ctx.fillStyle = isMuted ? 'rgba(150, 50, 50, 0.6)' : 'rgba(50, 100, 150, 0.6)';
        ctx.fill();
        ctx.strokeStyle = isMuted ? 'rgba(255, 100, 100, 0.8)' : 'rgba(100, 200, 255, 0.8)';
        ctx.lineWidth = 5;
        ctx.stroke();

        ctx.fillStyle = 'white';
        // Speaker icon
        ctx.beginPath();
        ctx.moveTo(60, 80);
        ctx.lineTo(85, 80);
        ctx.lineTo(115, 55);
        ctx.lineTo(115, 145);
        ctx.lineTo(85, 120);
        ctx.lineTo(60, 120);
        ctx.closePath();
        ctx.fill();

        if (!isMuted) {
            // Sound waves
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(115, 100, 25, -0.6, 0.6);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(115, 100, 45, -0.6, 0.6);
            ctx.stroke();
        } else {
            // X mark
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.moveTo(130, 70);
            ctx.lineTo(170, 130);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(170, 70);
            ctx.lineTo(130, 130);
            ctx.stroke();
        }
    },

    /**
     * Creates a static Loading Spinner texture
     */
    createLoadingTexture: () => {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Draw simple static circle arc that will be rotated via Mesh
        // Center at 128, 128

        // 1. Arc
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        // Draw 3/4 circle so rotation is visible
        ctx.arc(128, 128, 40, 0, Math.PI * 1.5);
        ctx.stroke();

        return canvas;
    },

    /**
     * Creates a texture with "Loading..." text separately
     * so it doesn't rotate with the spinner
     */
    createLoadingTextTexture: () => {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Loading...', 128, 32);

        return canvas;
    }
};
