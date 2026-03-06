/**
 * Application Configuration
 * Centralized constants for the WebVR application
 */

// API Base URL
export const API_BASE = 'https://api.neardev.my.id';

export const CONFIG = {
    // Camera FOV Settings
    fov: {
        default: 85,
        vr: 50,
        min: 30,
        max: 120
    },

    // Camera Position
    camera: {
        eyeLevel: 1.6,
        zOffset: 0.1
    },

    // Menu Settings
    menu: {
        radius: 2.5,
        itemWidth: 0.9,
        itemHeight: 0.6
    },

    // Gaze Controller
    gaze: {
        activationTime: 1.5,
        reticleDistance: 1.0,
        reticleSize: 0.008
    },

    // Animation
    animation: {
        hoverScale: 1.15,
        buttonHoverScale: 1.1,
        playButtonHoverScale: 1.2,
        speed: 5,
        buttonSpeed: 6,
        dampingFactor: 0.05,
        rotateSpeed: 0.5
    },

    // Video Player
    video: {
        curvedRadius: 3.5,
        curvedHeight: 2.5,
        curvedSegments: 32,
        flatWidth: 5,
        flatHeight: 2.8,
        flatDistance: 4,
        gestureCooldown: 3.0,
        flickThreshold: 1.5
    },

    // Background
    background: {
        radius: 80,
        topColor: '#404040',
        bottomColor: '#101010'
    },

    // Panorama Viewer
    panorama: {
        sphereRadius: 50,
        sphereSegments: { width: 128, height: 64 },
        hotspotRadius: 4.5,
        loadingSpinnerSpeed: 0.1
    },

    // Control Dock
    controlDock: {
        radius: 1.6,
        yPosition: -1.0,
        lookAtY: 0.6,
        followEaseSpeed: 0.08,
        lookDownThreshold: -0.45 // radians (~-26°)
    },

    // Tour Director (Cinematic Mode)
    tour: {
        transitionDuration: 800,  // ms per phase
        peakFOV: 140,             // Wide "rushing" FOV
        motionBlur: 20,           // px blur at peak
        dockRadius: 1.8,
        dockFollowSpeed: 0.08
    }
};
