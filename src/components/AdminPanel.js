import { SCENE_MAP } from '../data/sceneMap.js';

import SCENE_LIST from '../data/scene_list.json';

export class AdminPanel {
    constructor(viewer) {
        this.viewer = viewer;
        this.isAdminMode = false;
        this.selectedHotspot = null;
        this.unsavedChanges = false;
        this.sceneId = null; // Current scene ID
        this.availableScenes = SCENE_LIST || []; // Load from static JSON

        // this.fetchScenes(); // No longer needed
        this.initUI();
        this.setupKeyboardShortcuts();
    }

    // fetchScenes removed
    // async fetchScenes() { ... }

    initUI() {
        // Container
        this.container = document.createElement('div');
        this.container.id = 'admin-panel';
        Object.assign(this.container.style, {
            position: 'absolute',
            top: '20px',
            right: '20px',
            width: '300px',
            background: 'rgba(20, 20, 30, 0.95)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            padding: '20px',
            color: '#fff',
            fontFamily: "'Roboto', sans-serif",
            zIndex: '10000',
            display: 'none',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            transform: 'translateX(0)',
            transition: 'transform 0.3s ease, opacity 0.3s ease'
        });

        // Stop propagation of events to prevent scene interaction behind panel
        ['mousedown', 'mousemove', 'mouseup', 'click', 'contextmenu', 'wheel', 'touchstart', 'touchend', 'touchmove'].forEach(event => {
            this.container.addEventListener(event, (e) => e.stopPropagation());
        });

        // Header
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '20px';
        header.innerHTML = `
            <div style="font-weight: 700; font-size: 16px; color: #4ade80; display: flex; align-items: center; gap: 8px;">
                <span style="display: inline-block; width: 8px; height: 8px; background: #4ade80; border-radius: 50%;"></span>
                ADMIN MODE
            </div>
            <div style="font-size: 12px; color: #94a3b8;">Ctrl+E to Close</div>
        `;
        this.container.appendChild(header);

        // Form Container
        this.form = document.createElement('div');
        this.container.appendChild(this.form);

        // Scene Info
        this.sceneInfo = document.createElement('div');
        this.sceneInfo.style.marginBottom = '20px';
        this.sceneInfo.style.padding = '10px';
        this.sceneInfo.style.background = 'rgba(255,255,255,0.05)';
        this.sceneInfo.style.borderRadius = '8px';
        this.sceneInfo.style.fontSize = '12px';
        this.sceneInfo.innerHTML = `<div>Current Scene: <span id="admin-scene-id" style="font-family: monospace; color: #fbbf24;">-</span></div>`;
        this.container.appendChild(this.sceneInfo);

        // Actions
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '10px';
        actions.style.marginTop = '20px';

        this.saveBtn = this.createButton('Save to Disk', '#22c55e', () => this.saveToDisk());
        // this.saveBtn.style.width = '100%';
        actions.appendChild(this.saveBtn);

        this.container.appendChild(actions);

        // Status Toast
        this.toast = document.createElement('div');
        Object.assign(this.toast.style, {
            position: 'absolute',
            bottom: '-40px',
            left: '0',
            width: '100%',
            textAlign: 'center',
            fontSize: '12px',
            color: '#fff',
            opacity: '0',
            transition: 'opacity 0.3s'
        });
        this.container.appendChild(this.toast);

        document.body.appendChild(this.container);

        // Create Form Elements (Dynamic)
        this.renderForm(null);
    }

    createButton(text, bg, onClick) {
        const btn = document.createElement('button');
        btn.textContent = text;
        Object.assign(btn.style, {
            flex: '1',
            padding: '10px',
            background: bg,
            border: 'none',
            borderRadius: '6px',
            color: '#fff',
            fontWeight: '600',
            cursor: 'pointer',
            fontSize: '13px',
            transition: 'filter 0.2s'
        });
        btn.onmouseover = () => btn.style.filter = 'brightness(1.1)';
        btn.onmouseout = () => btn.style.filter = 'brightness(1.0)';
        btn.onclick = onClick;
        return btn;
    }

    renderForm(hotspot) {
        this.form.innerHTML = '';

        if (!hotspot) {
            this.form.innerHTML = `<div style="text-align: center; color: #64748b; padding: 20px; border: 2px dashed rgba(255,255,255,0.1); border-radius: 8px;">
                Click anywhere to add a hotspot.<br>Select a hotspot to edit.
            </div>`;
            return;
        }

        const createLabel = (text) => {
            const label = document.createElement('label');
            label.textContent = text;
            label.style.display = 'block';
            label.style.fontSize = '11px';
            label.style.textTransform = 'uppercase';
            label.style.letterSpacing = '0.5px';
            label.style.color = '#94a3b8';
            label.style.marginBottom = '4px';
            label.style.marginTop = '12px';
            return label;
        };

        const createInput = (value, onChange) => {
            const input = document.createElement('input');
            input.value = value || '';
            Object.assign(input.style, {
                width: '100%',
                padding: '8px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '13px',
                boxSizing: 'border-box'
            });
            input.oninput = (e) => onChange(e.target.value);
            return input;
        };

        const createSelect = (options, value, onChange) => {
            const select = document.createElement('select');
            Object.assign(select.style, {
                width: '100%',
                padding: '8px',
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '13px',
                cursor: 'pointer',
                boxSizing: 'border-box'
            });

            options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                if (opt.value === value) option.selected = true;
                select.appendChild(option);
            });

            select.onchange = (e) => onChange(e.target.value);
            return select;
        };

        // --- Label ---
        this.form.appendChild(createLabel('Label Display'));
        this.form.appendChild(createInput(hotspot.label, (val) => {
            hotspot.label = val;
            this.viewer.updateHotspotVisuals(); // Immediate update
            this.markDirty();
        }));

        // --- Icon Type ---
        this.form.appendChild(createLabel('Icon Type'));
        const iconOptions = [
            { value: 'arrow', label: 'Navigation Arrow' },
            { value: 'info', label: 'Info Spot (i)' },
            { value: 'photo', label: 'Photo/Gallery (Camera)' },
            { value: 'video', label: 'Video Play' },
            { value: 'plus', label: 'Plus / Add New' },
            { value: 'home', label: 'Home' }
        ];
        this.form.appendChild(createSelect(iconOptions, hotspot.type || 'arrow', (val) => {
            hotspot.type = val;
            // Hotspot type change might require re-creating mesh/texture
            this.viewer.refreshHotspot(hotspot);
            this.markDirty();
        }));

        // --- Target Scene ---
        this.form.appendChild(createLabel('Target Scene (File from Assets)'));

        // Populate from fetched list if available
        const folderOptions = this.availableScenes || [];

        // Also keep existing SCENE_MAP IDs just in case, or merge?
        // User said "Change to all in folder". So prioritize folder.
        // We map folder items to values.

        const targetOptions = [
            { value: '', label: '-- No Target --' },
            ...folderOptions.map(f => ({ value: f.path, label: f.filename }))
        ];

        // If current target is NOT in the list (e.g. it's an old ID), add it so we don't break UI
        if (hotspot.target && !targetOptions.find(o => o.value === hotspot.target)) {
            targetOptions.push({ value: hotspot.target, label: hotspot.target + ' (ID)' });
        }

        this.form.appendChild(createSelect(targetOptions, hotspot.target || '', (val) => {
            hotspot.target = val;
            this.markDirty();
        }));

        // --- Target Label (Hidden if not relevant, but let's show for now) ---
        this.form.appendChild(createLabel('Target Name (Optional)'));
        this.form.appendChild(createInput(hotspot.target_name || '', (val) => {
            hotspot.target_name = val;
            this.markDirty();
        }));

        // --- Delete Button ---
        const deleteBtn = this.createButton('Delete Hotspot', '#ef4444', () => {
            if (confirm('Delete this hotspot?')) {
                this.viewer.removeHotspot(hotspot);
                this.selectedHotspot = null;
                this.renderForm(null);
                this.markDirty();
            }
        });
        deleteBtn.style.marginTop = '20px';
        deleteBtn.style.width = '100%';
        this.form.appendChild(deleteBtn);
    }

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key.toLowerCase() === 'e') {
                e.preventDefault();
                this.toggle();
            }
        });
    }

    toggle() {
        this.isAdminMode = !this.isAdminMode;
        this.container.style.display = this.isAdminMode ? 'block' : 'none';
        this.viewer.setAdminMode(this.isAdminMode);

        if (this.isAdminMode) {
            this.updateSceneInfo();
        }
    }

    updateSceneInfo() {
        const id = this.viewer.currentSceneId || this.viewer.currentLocation?.id || 'Unknown';
        const el = document.getElementById('admin-scene-id');
        if (el) el.textContent = id;
    }

    selectHotspot(hotspot) {
        this.selectedHotspot = hotspot;
        this.renderForm(hotspot);
    }

    markDirty() {
        this.unsavedChanges = true;
        this.saveBtn.textContent = 'Save (Unsaved Changes)';
        this.saveBtn.style.background = '#eab308'; // Warning color
    }

    async saveToDisk() {
        const data = this.viewer.getAllHotspotsData();

        console.log('Saving hotspots data:', data);

        try {
            this.saveBtn.textContent = 'Saving...';
            const res = await fetch('/api/save-hotspots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data, null, 2)
            });

            const responseText = await res.text();
            console.log('Save response:', res.status, responseText);

            if (res.ok) {
                this.unsavedChanges = false;
                this.saveBtn.textContent = 'Save to Disk';
                this.saveBtn.style.background = '#22c55e';
                this.showToast('Saved successfully!');
            } else {
                alert('Save failed! Status: ' + res.status + '\nResponse: ' + responseText);
                throw new Error('Save failed: ' + res.status);
            }
        } catch (err) {
            console.error('Save error:', err);
            alert('Save error: ' + err.message);
            this.saveBtn.textContent = 'Error Saving';
            this.saveBtn.style.background = '#ef4444';
            this.showToast('Error: ' + err.message);
        }
    }

    showToast(msg) {
        this.toast.textContent = msg;
        this.toast.style.opacity = '1';
        setTimeout(() => this.toast.style.opacity = '0', 3000);
    }
}
