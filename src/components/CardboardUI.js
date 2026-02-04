/**
 * CardboardUI - 2D overlay for Cardboard VR mode
 * Provides optional UI elements (currently minimal)
 */
export class CardboardUI {
    constructor(onExit, onSettings) {
        this.onExit = onExit;
        this.onSettings = onSettings;
        this.container = null;
        this.createUI();
    }

    createUI() {
        this.container = document.createElement('div');
        Object.assign(this.container.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: '1000',
            display: 'none',
            fontFamily: 'sans-serif'
        });

        document.body.appendChild(this.container);
    }

    show() {
        if (this.container) {
            this.container.style.display = 'block';
        }
    }

    hide() {
        if (this.container) {
            this.container.style.display = 'none';
        }
    }

    dispose() {
        if (this.container?.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}
