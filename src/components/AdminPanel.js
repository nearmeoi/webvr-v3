import { SCENE_MAP } from '../data/sceneMap.js';
import SCENE_LIST from '../data/scene_list.json';

export class AdminPanel {
    constructor(viewer) {
        this.viewer = viewer;
        this.isAdminMode = false;
        this.selectedHotspot = null;
        this.unsavedChanges = false;
        this.sceneId = null;
        this.availableScenes = SCENE_LIST || [];
        this.filteredScenes = this.availableScenes;
        this.useCustomPath = false;
        this.undoStack = [];

        // Preset colors
        this.colorPresets = [
            '#ef4444', // Red (Location style)
            '#4f46e5', // Indigo
            '#0ea5e9', // Sky
            '#10b981', // Emerald
            '#8b5cf6', // Violet
            '#f59e0b', // Amber
            '#ec4899', // Pink
            '#06b6d4', // Cyan
            '#84cc16', // Lime
            '#64748b'  // Slate
        ];

        this.initUI();
        this.setupKeyboardShortcuts();
    }

    initUI() {
        this.container = document.createElement('div');
        this.container.id = 'admin-panel';
        Object.assign(this.container.style, {
            position: 'absolute',
            top: '20px',
            right: '20px',
            width: '320px',
            maxHeight: 'calc(100vh - 40px)',
            overflowY: 'auto',
            overflowX: 'hidden', // Prevent horizontal scroll
            background: 'rgba(17, 24, 39, 0.95)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '0',
            color: '#e5e7eb',
            fontFamily: "'Roboto', 'Segoe UI', system-ui, sans-serif",
            display: 'none',
            zIndex: '10000',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
            boxSizing: 'border-box'
        });

        // Add a style tag for global box-sizing within this container
        const style = document.createElement('style');
        style.textContent = `
            #admin-panel * { box-sizing: border-box; }
            #admin-panel input[type=range] { width: 100%; min-width: 0; }
        `;
        document.head.appendChild(style);

        ['mousedown', 'mousemove', 'mouseup', 'click', 'contextmenu', 'wheel', 'touchstart', 'touchend', 'touchmove'].forEach(event => {
            this.container.addEventListener(event, (e) => e.stopPropagation());
        });

        // Header
        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 18px',
            borderBottom: '1px solid rgba(255,255,255,0.06)'
        });
        header.innerHTML = `
            <span style="font-weight: 600; font-size: 14px; color: #f9fafb;">Hotspot Editor</span>
            <button id="admin-close-btn" style="
                background: transparent;
                border: none;
                width: 24px;
                height: 24px;
                border-radius: 4px;
                color: #6b7280;
                cursor: pointer;
                font-size: 18px;
                line-height: 1;
            ">×</button>
        `;
        this.container.appendChild(header);

        setTimeout(() => {
            const closeBtn = document.getElementById('admin-close-btn');
            if (closeBtn) {
                closeBtn.onclick = () => this.toggle();
                closeBtn.onmouseover = () => { closeBtn.style.color = '#f9fafb'; closeBtn.style.background = 'rgba(255,255,255,0.1)'; };
                closeBtn.onmouseout = () => { closeBtn.style.color = '#6b7280'; closeBtn.style.background = 'transparent'; };
            }
        }, 0);

        const content = document.createElement('div');
        content.style.padding = '14px 18px';
        this.container.appendChild(content);

        this.sceneInfo = document.createElement('div');
        Object.assign(this.sceneInfo.style, {
            background: 'rgba(0,0,0,0.25)',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '14px',
            fontSize: '12px'
        });
        content.appendChild(this.sceneInfo);

        this.form = document.createElement('div');
        content.appendChild(this.form);

        const footer = document.createElement('div');
        Object.assign(footer.style, {
            padding: '14px 18px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            gap: '8px'
        });

        this.saveBtn = this.createButton('Save', '#10b981', () => this.saveToDisk());
        this.saveBtn.style.flex = '1';
        footer.appendChild(this.saveBtn);

        const refreshBtn = this.createButton('Refresh', 'rgba(255,255,255,0.08)', () => {
            this.viewer.fetchHotspots?.();
            this.showToast('Refreshed');
        });
        refreshBtn.style.flex = '0';
        refreshBtn.style.color = '#9ca3af';
        footer.appendChild(refreshBtn);

        this.container.appendChild(footer);

        this.toast = document.createElement('div');
        Object.assign(this.toast.style, {
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(17, 24, 39, 0.95)',
            padding: '10px 20px',
            borderRadius: '6px',
            fontSize: '12px',
            color: '#e5e7eb',
            opacity: '0',
            transition: 'opacity 0.2s',
            zIndex: '10001',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.08)'
        });
        document.body.appendChild(this.toast);

        document.body.appendChild(this.container);
        this.renderSceneInfo();
        this.renderForm(null);
    }

    createButton(text, bg, onClick) {
        const btn = document.createElement('button');
        btn.textContent = text;
        Object.assign(btn.style, {
            padding: '10px 16px',
            background: bg,
            border: 'none',
            borderRadius: '6px',
            color: '#fff',
            fontWeight: '500',
            cursor: 'pointer',
            fontSize: '13px',
            transition: 'opacity 0.15s'
        });
        btn.onmouseover = () => btn.style.opacity = '0.85';
        btn.onmouseout = () => btn.style.opacity = '1';
        btn.onclick = onClick;
        return btn;
    }

    renderSceneInfo() {
        const path = this.viewer.currentPath || 'No scene loaded';
        const filename = path.split('/').pop() || path;
        const hotspotCount = this.viewer.currentHotspots?.length || 0;

        this.sceneInfo.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: #9ca3af;">Scene</span>
                <span style="color: #6ee7b7; font-size: 11px;">${hotspotCount} hotspot${hotspotCount !== 1 ? 's' : ''}</span>
            </div>
            <div style="font-family: 'Roboto Mono', monospace; font-size: 11px; color: #fbbf24; margin-top: 6px; word-break: break-all;">
                ${filename}
            </div>
        `;
    }

    renderForm(hotspot) {
        this.form.innerHTML = '';

        if (!hotspot) {
            const emptyState = document.createElement('div');
            Object.assign(emptyState.style, {
                textAlign: 'center',
                padding: '24px 16px',
                border: '1px dashed rgba(255,255,255,0.1)',
                borderRadius: '8px',
                color: '#6b7280',
                fontSize: '12px'
            });
            emptyState.innerHTML = `
                <div style="margin-bottom: 6px;">No hotspot selected</div>
                <div style="color: #4b5563; font-size: 11px;">Right-click to add new</div>
            `;
            this.form.appendChild(emptyState);
            return;
        }

        // Coordinates
        const coords = document.createElement('div');
        Object.assign(coords.style, {
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#6b7280',
            marginBottom: '14px',
            fontFamily: 'monospace'
        });
        coords.innerHTML = `
            <span>yaw: ${hotspot.yaw?.toFixed(1) || '0'}°</span>
            <span>pitch: ${hotspot.pitch?.toFixed(1) || '0'}°</span>
        `;
        this.form.appendChild(coords);

        // Label
        this.form.appendChild(this.createLabel('Label'));
        this.form.appendChild(this.createInput(hotspot.label, (val) => {
            hotspot.label = val;
            this.viewer.refreshHotspot?.(hotspot);
            this.markDirty();
        }));

        // Type
        this.form.appendChild(this.createLabel('Type'));
        const iconOptions = [
            { value: 'arrow', label: 'Navigation (Pin)' },
            { value: 'info', label: 'Information' },
            { value: 'photo', label: 'Photo' },
            { value: 'video', label: 'Video' },
            { value: 'home', label: 'Home' }
        ];
        this.form.appendChild(this.createSelect(iconOptions, hotspot.type || 'arrow', (val) => {
            hotspot.type = val;
            this.viewer.refreshHotspot?.(hotspot);
            this.markDirty();
        }));

        // Layout with two rows for Size and Text Size (vertical stacking to avoid overflow)
        const sizesGrid = document.createElement('div');
        Object.assign(sizesGrid.style, {
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
        });

        // Icon Size
        const iconSizeCol = document.createElement('div');
        iconSizeCol.appendChild(this.createLabel('Icon Size'));
        iconSizeCol.appendChild(this.createSlider(hotspot.size || 3, 1, 6, 0.5, (val) => {
            hotspot.size = parseFloat(val);
            this.viewer.refreshHotspot?.(hotspot);
            this.markDirty();
        }));
        sizesGrid.appendChild(iconSizeCol);

        // Text Size
        const textSizeCol = document.createElement('div');
        textSizeCol.appendChild(this.createLabel('Text Size'));
        textSizeCol.appendChild(this.createSlider(hotspot.textSize || 1.0, 0.5, 2.5, 0.1, (val) => {
            hotspot.textSize = parseFloat(val);
            this.viewer.refreshHotspot?.(hotspot);
            this.markDirty();
        }));
        sizesGrid.appendChild(textSizeCol);

        this.form.appendChild(sizesGrid);

        // Label Offset
        this.form.appendChild(this.createLabel('Label Offset'));
        this.form.appendChild(this.createSlider(hotspot.labelOffset !== undefined ? hotspot.labelOffset : 0, -5, 10, 0.5, (val) => {
            hotspot.labelOffset = parseFloat(val);
            this.viewer.refreshHotspot?.(hotspot);
            this.markDirty();
        }));

        // Color
        this.form.appendChild(this.createLabel('Color'));
        this.form.appendChild(this.createColorPicker(hotspot));

        // Target Header
        const targetHeader = document.createElement('div');
        Object.assign(targetHeader.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '16px',
            marginBottom: '8px'
        });
        targetHeader.innerHTML = `<span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; color: #9ca3af;">Target</span>`;

        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = this.useCustomPath ? 'Use List' : 'Custom Path';
        Object.assign(toggleBtn.style, {
            background: 'rgba(255,255,255,0.08)',
            border: 'none',
            borderRadius: '4px',
            color: '#9ca3af',
            fontSize: '10px',
            padding: '4px 8px',
            cursor: 'pointer'
        });
        toggleBtn.onclick = () => {
            this.useCustomPath = !this.useCustomPath;
            this.renderForm(hotspot);
        };
        targetHeader.appendChild(toggleBtn);
        this.form.appendChild(targetHeader);

        if (this.useCustomPath) {
            const pathInput = this.createInput(hotspot.target || '', (val) => {
                hotspot.target = val;
                this.markDirty();
            });
            pathInput.placeholder = 'assets/folder/scene.jpg';
            this.form.appendChild(pathInput);
        } else {
            this.form.appendChild(this.createSceneSelector(hotspot));
        }

        // Delete
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        Object.assign(deleteBtn.style, {
            width: '100%',
            marginTop: '18px',
            padding: '10px',
            background: 'transparent',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '6px',
            color: '#f87171',
            fontSize: '12px',
            cursor: 'pointer',
            transition: 'all 0.15s'
        });
        deleteBtn.onmouseover = () => { deleteBtn.style.background = 'rgba(239, 68, 68, 0.1)'; };
        deleteBtn.onmouseout = () => { deleteBtn.style.background = 'transparent'; };
        deleteBtn.onclick = () => {
            if (confirm('Delete this hotspot?')) {
                this.viewer.removeHotspot(hotspot);
                this.selectedHotspot = null;
                this.renderForm(null);
                this.markDirty();
            }
        };
        this.form.appendChild(deleteBtn);
    }

    createLabel(text) {
        const label = document.createElement('label');
        label.textContent = text;
        Object.assign(label.style, {
            display: 'block',
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.3px',
            color: '#9ca3af',
            marginBottom: '5px',
            marginTop: '12px'
        });
        return label;
    }

    createInput(value, onChange) {
        const input = document.createElement('input');
        input.value = value || '';
        Object.assign(input.style, {
            width: '100%',
            padding: '9px 11px',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px',
            color: '#f9fafb',
            fontSize: '13px',
            boxSizing: 'border-box',
            outline: 'none',
            fontFamily: "'Roboto', sans-serif"
        });
        input.onfocus = () => input.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        input.onblur = () => input.style.borderColor = 'rgba(255,255,255,0.08)';
        input.oninput = (e) => onChange(e.target.value);
        return input;
    }

    createSelect(options, value, onChange) {
        const select = document.createElement('select');
        Object.assign(select.style, {
            width: '100%',
            padding: '9px 11px',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px',
            color: '#f9fafb',
            fontSize: '13px',
            cursor: 'pointer',
            boxSizing: 'border-box',
            outline: 'none',
            fontFamily: "'Roboto', sans-serif"
        });

        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            option.style.background = '#111827';
            if (opt.value === value) option.selected = true;
            select.appendChild(option);
        });

        select.onchange = (e) => onChange(e.target.value);
        return select;
    }

    createSlider(value, min, max, step, onChange) {
        const wrapper = document.createElement('div');
        Object.assign(wrapper.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
        });

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = value;
        Object.assign(slider.style, {
            flex: '1',
            width: '100%',
            minWidth: '50px',
            height: '4px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '2px',
            outline: 'none',
            cursor: 'pointer',
            accentColor: '#10b981',
            margin: '0'
        });

        const valueLabel = document.createElement('span');
        valueLabel.textContent = value;
        Object.assign(valueLabel.style, {
            fontSize: '11px',
            color: '#9ca3af',
            minWidth: '20px',
            textAlign: 'right'
        });

        slider.oninput = (e) => {
            valueLabel.textContent = e.target.value;
            onChange(e.target.value);
        };

        wrapper.appendChild(slider);
        wrapper.appendChild(valueLabel);
        return wrapper;
    }

    createColorPicker(hotspot) {
        const wrapper = document.createElement('div');
        Object.assign(wrapper.style, {
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            marginTop: '4px'
        });

        this.colorPresets.forEach(color => {
            const swatch = document.createElement('button');
            Object.assign(swatch.style, {
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                background: color,
                border: hotspot.color === color ? '2px solid #fff' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'transform 0.1s, border-color 0.1s'
            });
            swatch.onmouseover = () => swatch.style.transform = 'scale(1.1)';
            swatch.onmouseout = () => swatch.style.transform = 'scale(1)';
            swatch.onclick = () => {
                hotspot.color = color;
                this.viewer.refreshHotspot?.(hotspot);
                this.markDirty();
                this.renderForm(hotspot);
            };
            wrapper.appendChild(swatch);
        });

        const customPicker = document.createElement('input');
        customPicker.type = 'color';
        customPicker.value = hotspot.color || '#4f46e5';
        Object.assign(customPicker.style, {
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            padding: '0'
        });
        customPicker.oninput = (e) => {
            hotspot.color = e.target.value;
            this.viewer.refreshHotspot?.(hotspot);
            this.markDirty();
        };
        wrapper.appendChild(customPicker);

        return wrapper;
    }

    createSceneSelector(hotspot) {
        const wrapper = document.createElement('div');

        const searchInput = document.createElement('input');
        searchInput.placeholder = 'Search...';
        Object.assign(searchInput.style, {
            width: '100%',
            padding: '9px 11px',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px 6px 0 0',
            color: '#f9fafb',
            fontSize: '12px',
            boxSizing: 'border-box',
            outline: 'none',
            borderBottom: 'none',
            fontFamily: "'Roboto', sans-serif"
        });

        const select = document.createElement('select');
        select.size = 5;
        Object.assign(select.style, {
            width: '100%',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '0 0 6px 6px',
            color: '#f9fafb',
            fontSize: '11px',
            cursor: 'pointer',
            boxSizing: 'border-box',
            outline: 'none',
            fontFamily: "'Roboto', sans-serif"
        });

        const updateOptions = (filter = '') => {
            select.innerHTML = '';

            const noTargetOpt = document.createElement('option');
            noTargetOpt.value = '';
            noTargetOpt.textContent = '(none)';
            noTargetOpt.style.padding = '6px 8px';
            noTargetOpt.style.background = '#111827';
            select.appendChild(noTargetOpt);

            const filtered = this.availableScenes.filter(s =>
                s.filename.toLowerCase().includes(filter.toLowerCase())
            );

            filtered.forEach(scene => {
                const opt = document.createElement('option');
                opt.value = scene.path;
                opt.textContent = scene.filename;
                opt.style.padding = '6px 8px';
                opt.style.background = '#111827';
                if (scene.path === hotspot.target) opt.selected = true;
                select.appendChild(opt);
            });
        };

        searchInput.oninput = (e) => updateOptions(e.target.value);
        select.onchange = (e) => {
            hotspot.target = e.target.value;
            this.markDirty();
        };

        updateOptions();

        wrapper.appendChild(searchInput);
        wrapper.appendChild(select);
        return wrapper;
    }

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key.toLowerCase() === 'e') {
                e.preventDefault();
                this.toggle();
            }
            if (e.ctrlKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                this.undo();
            }
            if (e.key === 'Escape' && this.isAdminMode) {
                this.selectHotspot(null);
            }
        });
    }

    pushUndoCommand(cmd) {
        this.undoStack.push(cmd);
        // Limit stack size
        if (this.undoStack.length > 50) {
            this.undoStack.shift();
        }
    }

    undo() {
        if (!this.isAdminMode || this.undoStack.length === 0) return;

        const cmd = this.undoStack.pop();
        if (cmd.type === 'move') {
            const { hotspot, oldYaw, oldPitch } = cmd;
            hotspot.yaw = oldYaw;
            hotspot.pitch = oldPitch;

            // Trigger visual refresh in viewer
            this.viewer.refreshHotspot?.(hotspot);

            // Update UI if this was the selected hotspot
            if (this.selectedHotspot === hotspot) {
                this.renderForm(hotspot);
            }

            this.showToast('Undo Move');
        }
    }

    toggle() {
        this.isAdminMode = !this.isAdminMode;
        this.container.style.display = this.isAdminMode ? 'block' : 'none';
        this.viewer.setAdminMode(this.isAdminMode);

        if (this.isAdminMode) {
            this.renderSceneInfo();
        }
    }

    selectHotspot(hotspot) {
        this.selectedHotspot = hotspot;
        this.renderForm(hotspot);
    }

    markDirty() {
        this.unsavedChanges = true;
        this.saveBtn.textContent = 'Save *';
        this.saveBtn.style.background = '#f59e0b';
    }

    async saveToDisk() {
        const data = this.viewer.getAllHotspotsData();
        console.log('Saving:', data);

        try {
            this.saveBtn.textContent = 'Saving...';
            this.saveBtn.disabled = true;

            const res = await fetch('/api/save-hotspots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data, null, 2)
            });

            if (res.ok) {
                this.unsavedChanges = false;
                this.saveBtn.textContent = 'Saved';
                this.saveBtn.style.background = '#10b981';
                this.showToast('Saved successfully');

                setTimeout(() => {
                    this.saveBtn.textContent = 'Save';
                }, 1500);
            } else {
                throw new Error('Failed: ' + res.status);
            }
        } catch (err) {
            console.error('Save error:', err);
            this.saveBtn.textContent = 'Error';
            this.saveBtn.style.background = '#ef4444';
            this.showToast('Save failed');
        } finally {
            this.saveBtn.disabled = false;
        }
    }

    showToast(msg) {
        this.toast.textContent = msg;
        this.toast.style.opacity = '1';
        setTimeout(() => this.toast.style.opacity = '0', 2000);
    }
}
