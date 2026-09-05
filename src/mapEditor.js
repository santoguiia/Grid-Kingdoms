import { CONFIG, TERRAIN } from './config.js';
import { editorRegistry } from './editorRegistry.js';
import { showToast } from './ui.js';
import { mapManager } from './mapManager.js';

export class MapEditor {
    constructor() {
        this.currentMap = null;
        this.activeBrush = { type: 'terrain', id: TERRAIN.GRASS, icon: '🌱', name: 'Grama' };
        this.brushSize = 1;
        this.activeTool = 'brush'; // 'brush', 'bucket', 'eraser'
        
        this.canvas = null;
        this.ctx = null;
        
        // Câmera do editor (pan e zoom)
        this.camera = {
            x: 0,
            y: 0,
            zoom: 1.0,
            isPanning: false,
            panStartX: 0,
            panStartY: 0
        };

        this.tileSize = 24; // Tamanho base em pixels por tile no editor
        this.hoverTile = { x: -1, y: -1 };
        this.isPainting = false;

        // Histórico de Desfazer/Refazer
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistory = 25;

        this.initialized = false;
    }

    init() {
        if (this.initialized) return;

        this.canvas = document.getElementById('editorCanvas');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        this.setupDOM();
        this.setupEvents();
        this.initialized = true;
    }

    open(existingMap = null) {
        this.init();
        const modal = document.getElementById('mapEditorModal');
        if (modal) {
            modal.classList.add('visible');
        }

        if (existingMap) {
            this.currentMap = JSON.parse(JSON.stringify(existingMap));
        } else {
            this.currentMap = editorRegistry.createNewMap(CONFIG.MAP_WIDTH || 80, CONFIG.MAP_HEIGHT || 80, 'floresta');
        }

        this.undoStack = [];
        this.redoStack = [];
        this.syncInputsFromMap();
        this.renderPalettes();
        this.resizeCanvas();
        this.centerCamera();
        this.render();
        showToast('🛠️ World Editor pronto! Desenhe seu campo de batalha.');
    }

    close() {
        const modal = document.getElementById('mapEditorModal');
        if (modal) {
            modal.classList.remove('visible');
        }
    }

    setupDOM() {
        // Inputs superiores
        const nameInput = document.getElementById('editorMapNameInput');
        const authorInput = document.getElementById('editorMapAuthorInput');
        const tilesetSelect = document.getElementById('editorTilesetSelect');

        nameInput?.addEventListener('input', (e) => {
            if (this.currentMap) this.currentMap.name = e.target.value;
        });
        authorInput?.addEventListener('input', (e) => {
            if (this.currentMap) this.currentMap.author = e.target.value;
        });
        tilesetSelect?.addEventListener('change', (e) => {
            if (this.currentMap) {
                this.currentMap.tileset = e.target.value;
                this.render();
            }
        });

        // Botões de tamanho do pincel
        document.querySelectorAll('.editor-brush-size-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.editor-brush-size-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.brushSize = parseInt(btn.dataset.size, 10) || 1;
            });
        });

        // Ferramentas principais (Lápis, Balde, Borracha)
        document.getElementById('editorToolPencilBtn')?.addEventListener('click', () => this.setTool('brush'));
        document.getElementById('editorToolBucketBtn')?.addEventListener('click', () => this.setTool('bucket'));
        document.getElementById('editorToolEraserBtn')?.addEventListener('click', () => this.setTool('eraser'));

        // Desfazer / Refazer
        document.getElementById('editorUndoBtn')?.addEventListener('click', () => this.undo());
        document.getElementById('editorRedoBtn')?.addEventListener('click', () => this.redo());

        // Ações de Mapa
        document.getElementById('editorSaveBtn')?.addEventListener('click', () => this.saveMapToServer());
        document.getElementById('editorExportBtn')?.addEventListener('click', () => this.exportMapJSON());
        document.getElementById('editorImportBtn')?.addEventListener('click', () => document.getElementById('editorFileInput')?.click());
        document.getElementById('editorFileInput')?.addEventListener('change', (e) => this.handleFileImport(e));
        document.getElementById('editorClearBtn')?.addEventListener('click', () => this.clearMap());
        document.getElementById('editorCloseBtn')?.addEventListener('click', () => this.close());
        document.getElementById('editorTestBtn')?.addEventListener('click', () => this.testMapInGame());

        // Atalhos de Teclado
        window.addEventListener('keydown', (e) => {
            const modal = document.getElementById('mapEditorModal');
            if (!modal || !modal.classList.contains('visible')) return;

            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) this.redo();
                else this.undo();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                this.redo();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.saveMapToServer();
            } else if (e.key === 'b' || e.key === 'B') {
                this.setTool('brush');
            } else if (e.key === 'f' || e.key === 'F') {
                this.setTool('bucket');
            }
        });
    }

    setTool(tool) {
        this.activeTool = tool;
        document.querySelectorAll('.editor-tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
    }

    renderPalettes() {
        // 1. Paleta de Terrenos
        const terrainContainer = document.getElementById('editorPaletteTerrain');
        if (terrainContainer) {
            terrainContainer.innerHTML = '';
            editorRegistry.terrainPalette.forEach(item => {
                const btn = document.createElement('button');
                btn.className = 'editor-palette-btn' + (this.activeBrush.type === 'terrain' && this.activeBrush.id === item.id ? ' active' : '');
                btn.title = `${item.name}: ${item.description}`;
                btn.innerHTML = `
                    <span class="palette-swatch" style="background:${item.color};">${item.icon}</span>
                    <span class="palette-name">${item.name}</span>
                `;
                btn.addEventListener('click', () => {
                    this.selectBrush('terrain', item.id, item.icon, item.name, item.color);
                });
                terrainContainer.appendChild(btn);
            });
        }

        // 2. Paleta de Spawns
        const spawnContainer = document.getElementById('editorPaletteSpawns');
        if (spawnContainer) {
            spawnContainer.innerHTML = '';
            editorRegistry.spawnBrushes.forEach(item => {
                const btn = document.createElement('button');
                btn.className = 'editor-palette-btn' + (this.activeBrush.type === 'spawn' && this.activeBrush.id === item.id ? ' active' : '');
                btn.title = `${item.name}: ${item.description}`;
                btn.innerHTML = `
                    <span class="palette-swatch" style="border-color:${item.color}; background: rgba(0,0,0,0.5);">${item.icon}</span>
                    <span class="palette-name">${item.name}</span>
                `;
                btn.addEventListener('click', () => {
                    this.selectBrush('spawn', item.id, item.icon, item.name, item.color);
                });
                spawnContainer.appendChild(btn);
            });
        }

        // 3. Paleta de Criaturas / Mobs Neutros
        const entityContainer = document.getElementById('editorPaletteEntities');
        if (entityContainer) {
            entityContainer.innerHTML = '';
            editorRegistry.entityBrushes.forEach(item => {
                const btn = document.createElement('button');
                btn.className = 'editor-palette-btn' + (this.activeBrush.type === 'creep' && this.activeBrush.id === item.id ? ' active' : '');
                btn.title = `${item.name}: ${item.description}`;
                btn.innerHTML = `
                    <span class="palette-swatch" style="background:${item.color}22; border-color:${item.color};">${item.icon}</span>
                    <span class="palette-name">${item.name}</span>
                `;
                btn.addEventListener('click', () => {
                    this.selectBrush('creep', item.id, item.icon, item.name, item.color);
                });
                entityContainer.appendChild(btn);
            });
        }
    }

    selectBrush(type, id, icon, name, color) {
        this.activeBrush = { type, id, icon, name, color };
        document.querySelectorAll('.editor-palette-btn').forEach(btn => {
            const isMatch = btn.textContent.includes(name);
            btn.classList.toggle('active', isMatch);
        });
        // Se selecionou spawn ou creep, o tamanho de pincel se ajusta para 1x1
        if (type !== 'terrain') {
            this.setTool('brush');
        }
    }

    syncInputsFromMap() {
        if (!this.currentMap) return;
        const nameInput = document.getElementById('editorMapNameInput');
        const authorInput = document.getElementById('editorMapAuthorInput');
        const tilesetSelect = document.getElementById('editorTilesetSelect');
        const sizeBadge = document.getElementById('editorMapSizeBadge');

        if (nameInput) nameInput.value = this.currentMap.name || '';
        if (authorInput) authorInput.value = this.currentMap.author || '';
        if (tilesetSelect) tilesetSelect.value = this.currentMap.tileset || 'floresta';
        if (sizeBadge) sizeBadge.textContent = `${this.currentMap.width || 80} x ${this.currentMap.height || 80}`;
    }

    setupEvents() {
        window.addEventListener('resize', () => this.resizeCanvas());

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
                // Botão do meio, direito ou Alt+Click: Pan/Câmera
                this.camera.isPanning = true;
                this.camera.panStartX = e.clientX - this.camera.x;
                this.camera.panStartY = e.clientY - this.camera.y;
                return;
            }

            if (e.button === 0) {
                // Botão Esquerdo: Pintar / Usar Ferramenta
                this.saveHistorySnapshot();
                this.isPainting = true;
                this.applyToolAtMouse(e);
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (this.camera.isPanning) {
                this.camera.x = e.clientX - this.camera.panStartX;
                this.camera.y = e.clientY - this.camera.panStartY;
                this.render();
                return;
            }

            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const tilePos = this.screenToTile(mouseX, mouseY);

            this.hoverTile = tilePos;
            this.updateCoordDisplay(tilePos.x, tilePos.y);

            if (this.isPainting) {
                this.applyToolAtMouse(e);
            } else {
                this.render();
            }
        });

        window.addEventListener('mouseup', () => {
            this.isPainting = false;
            this.camera.isPanning = false;
        });

        // Zoom com roda do mouse
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
            const newZoom = Math.max(0.2, Math.min(3.5, this.camera.zoom * zoomFactor));

            // Centralizar zoom no mouse
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            this.camera.x = mouseX - (mouseX - this.camera.x) * (newZoom / this.camera.zoom);
            this.camera.y = mouseY - (mouseY - this.camera.y) * (newZoom / this.camera.zoom);
            this.camera.zoom = newZoom;

            this.render();
        }, { passive: false });

        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    resizeCanvas() {
        const container = document.getElementById('editorCanvasContainer');
        if (!container || !this.canvas) return;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        this.render();
    }

    centerCamera() {
        if (!this.canvas || !this.currentMap) return;
        const mapPixelW = (this.currentMap.width || 80) * this.tileSize;
        const mapPixelH = (this.currentMap.height || 80) * this.tileSize;

        this.camera.zoom = Math.min((this.canvas.width * 0.85) / mapPixelW, (this.canvas.height * 0.85) / mapPixelH, 1.0);
        this.camera.x = (this.canvas.width - mapPixelW * this.camera.zoom) / 2;
        this.camera.y = (this.canvas.height - mapPixelH * this.camera.zoom) / 2;
    }

    screenToTile(screenX, screenY) {
        const worldX = (screenX - this.camera.x) / this.camera.zoom;
        const worldY = (screenY - this.camera.y) / this.camera.zoom;
        return {
            x: Math.floor(worldX / this.tileSize),
            y: Math.floor(worldY / this.tileSize)
        };
    }

    updateCoordDisplay(tileX, tileY) {
        const coordEl = document.getElementById('editorCoordsDisplay');
        if (!coordEl) return;
        const mapW = this.currentMap?.width || 80;
        const mapH = this.currentMap?.height || 80;
        if (tileX >= 0 && tileX < mapW && tileY >= 0 && tileY < mapH) {
            const currentVal = this.currentMap.grid[tileY]?.[tileX];
            coordEl.textContent = `X: ${tileX} | Y: ${tileY} (Tile: ${currentVal !== undefined ? currentVal : '-'})`;
        } else {
            coordEl.textContent = `X: -- | Y: --`;
        }
    }

    applyToolAtMouse(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const { x, y } = this.screenToTile(mouseX, mouseY);

        const mapW = this.currentMap.width || 80;
        const mapH = this.currentMap.height || 80;

        if (x < 0 || x >= mapW || y < 0 || y >= mapH) return;

        if (this.activeTool === 'bucket' && this.activeBrush.type === 'terrain') {
            this.floodFillTerrain(x, y, this.activeBrush.id);
            this.render();
            return;
        }

        if (this.activeTool === 'eraser') {
            // Remove spawns ou creeps na posição
            this.currentMap.spawns = (this.currentMap.spawns || []).filter(s => Math.hypot(s.x - x, s.y - y) > 2);
            this.currentMap.creeps = (this.currentMap.creeps || []).filter(c => Math.hypot(c.x - x, c.y - y) > 2);
            // Reseta terreno para grama
            this.setTerrainBrush(x, y, TERRAIN.GRASS, 1);
            this.render();
            return;
        }

        // Pintura normal com pincel
        if (this.activeBrush.type === 'terrain') {
            this.setTerrainBrush(x, y, this.activeBrush.id, this.brushSize);
        } else if (this.activeBrush.type === 'spawn') {
            this.placeSpawn(x, y, this.activeBrush.id, this.activeBrush.name);
        } else if (this.activeBrush.type === 'creep') {
            this.placeCreep(x, y, this.activeBrush.id);
        }

        this.render();
    }

    setTerrainBrush(centerX, centerY, terrainId, size = 1) {
        const offset = Math.floor(size / 2);
        const mapW = this.currentMap.width || 80;
        const mapH = this.currentMap.height || 80;

        for (let dy = -offset; dy < -offset + size; dy++) {
            for (let dx = -offset; dx < -offset + size; dx++) {
                const tx = centerX + dx;
                const ty = centerY + dy;
                if (tx >= 0 && tx < mapW && ty >= 0 && ty < mapH) {
                    this.currentMap.grid[ty][tx] = terrainId;
                }
            }
        }
    }

    floodFillTerrain(startX, startY, targetTerrain) {
        const grid = this.currentMap.grid;
        const originalTerrain = grid[startY]?.[startX];
        if (originalTerrain === undefined || originalTerrain === targetTerrain) return;

        const mapW = this.currentMap.width;
        const mapH = this.currentMap.height;
        const queue = [{ x: startX, y: startY }];
        const visited = new Uint8Array(mapW * mapH);

        while (queue.length > 0) {
            const { x, y } = queue.pop();
            const idx = y * mapW + x;
            if (visited[idx]) continue;
            visited[idx] = 1;

            if (grid[y][x] === originalTerrain) {
                grid[y][x] = targetTerrain;

                if (x + 1 < mapW && !visited[y * mapW + x + 1]) queue.push({ x: x + 1, y });
                if (x - 1 >= 0 && !visited[y * mapW + x - 1]) queue.push({ x: x - 1, y });
                if (y + 1 < mapH && !visited[(y + 1) * mapW + x]) queue.push({ x, y: y + 1 });
                if (y - 1 >= 0 && !visited[(y - 1) * mapW + x]) queue.push({ x, y: y - 1 });
            }
        }
    }

    placeSpawn(x, y, factionId, name) {
        if (!this.currentMap.spawns) this.currentMap.spawns = [];
        // Se não for expansão, só permite 1 spawn por facção (move o anterior)
        if (factionId !== 'expansion') {
            this.currentMap.spawns = this.currentMap.spawns.filter(s => s.faction !== factionId && s.id !== factionId);
        }
        this.currentMap.spawns.push({ x, y, faction: factionId, id: factionId, name });
        // Limpa a área do spawn para ser grama transitável
        this.setTerrainBrush(x, y, TERRAIN.GRASS, 3);
    }

    placeCreep(x, y, creepType) {
        if (!this.currentMap.creeps) this.currentMap.creeps = [];
        // Adiciona acampamento
        this.currentMap.creeps.push({ x, y, type: creepType, count: 1 });
        this.setTerrainBrush(x, y, TERRAIN.GRASS, 2);
    }

    saveHistorySnapshot() {
        if (!this.currentMap) return;
        const snapshot = {
            grid: this.currentMap.grid.map(row => [...row]),
            spawns: JSON.parse(JSON.stringify(this.currentMap.spawns || [])),
            creeps: JSON.parse(JSON.stringify(this.currentMap.creeps || []))
        };
        this.undoStack.push(snapshot);
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    undo() {
        if (this.undoStack.length === 0) return;
        const currentState = {
            grid: this.currentMap.grid.map(row => [...row]),
            spawns: JSON.parse(JSON.stringify(this.currentMap.spawns || [])),
            creeps: JSON.parse(JSON.stringify(this.currentMap.creeps || []))
        };
        this.redoStack.push(currentState);
        const prev = this.undoStack.pop();
        this.currentMap.grid = prev.grid;
        this.currentMap.spawns = prev.spawns;
        this.currentMap.creeps = prev.creeps;
        this.render();
        showToast('↩️ Desfazer');
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const currentState = {
            grid: this.currentMap.grid.map(row => [...row]),
            spawns: JSON.parse(JSON.stringify(this.currentMap.spawns || [])),
            creeps: JSON.parse(JSON.stringify(this.currentMap.creeps || []))
        };
        this.undoStack.push(currentState);
        const next = this.redoStack.pop();
        this.currentMap.grid = next.grid;
        this.currentMap.spawns = next.spawns;
        this.currentMap.creeps = next.creeps;
        this.render();
        showToast('↪️ Refazer');
    }

    clearMap() {
        if (!confirm('Deseja realmente limpar todo o mapa para o terreno básico?')) return;
        this.saveHistorySnapshot();
        const mapW = this.currentMap.width || 80;
        const mapH = this.currentMap.height || 80;
        for (let y = 0; y < mapH; y++) {
            for (let x = 0; x < mapW; x++) {
                if (x < 4 || x >= mapW - 4 || y < 4 || y >= mapH - 4) {
                    this.currentMap.grid[y][x] = TERRAIN.MOUNTAIN;
                } else {
                    this.currentMap.grid[y][x] = TERRAIN.GRASS;
                }
            }
        }
        this.render();
        showToast('🧹 Mapa limpo com sucesso.');
    }

    async saveMapToServer() {
        const validation = editorRegistry.validateMap(this.currentMap);
        if (!validation.valid) {
            alert('Não foi possível salvar o mapa:\n' + validation.errors.join('\n'));
            return;
        }
        if (validation.warnings.length > 0) {
            console.warn('[MapEditor] Avisos:', validation.warnings);
        }

        try {
            const fileName = (this.currentMap.fileName || this.currentMap.id || 'mapa_custom') + '.json';
            const res = await fetch('/api/maps/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileName, mapData: this.currentMap })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`💾 Mapa "${this.currentMap.name}" salvo na pasta /maps com sucesso!`);
                await mapManager.scanMaps();
            } else {
                throw new Error(data.error || 'Falha ao salvar no servidor');
            }
        } catch (err) {
            console.error('[MapEditor] Erro:', err);
            showToast(`Erro ao salvar no servidor: ${err.message}`);
        }
    }

    exportMapJSON() {
        const json = JSON.stringify(this.currentMap, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = (this.currentMap.name || 'mapa').toLowerCase().replace(/[^a-z0-9]/g, '_');
        a.download = `${safeName}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('📥 Arquivo JSON do mapa baixado!');
    }

    handleFileImport(e) {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (!Array.isArray(data.grid)) {
                    throw new Error('Formato inválido de grade');
                }
                this.saveHistorySnapshot();
                this.currentMap = data;
                this.syncInputsFromMap();
                this.render();
                showToast(`📂 Mapa "${data.name || file.name}" carregado com sucesso!`);
            } catch (err) {
                alert('Erro ao carregar mapa JSON: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    testMapInGame() {
        const validation = editorRegistry.validateMap(this.currentMap);
        if (!validation.valid) {
            alert('Não é possível testar o mapa ainda:\n' + validation.errors.join('\n'));
            return;
        }

        // Salva mapa na memória do jogo e inicia partida
        this.close();
        if (typeof window.startMatchWithCustomMap === 'function') {
            window.startMatchWithCustomMap(this.currentMap);
        } else {
            showToast('Iniciando partida com o mapa criado...');
        }
    }

    render() {
        if (!this.canvas || !this.ctx || !this.currentMap) return;
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const mapW = this.currentMap.width || 80;
        const mapH = this.currentMap.height || 80;
        const grid = this.currentMap.grid;

        ctx.clearRect(0, 0, width, height);

        // Fundo escuro além do mapa
        ctx.fillStyle = '#0a0d0e';
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.translate(this.camera.x, this.camera.y);
        ctx.scale(this.camera.zoom, this.camera.zoom);

        const paletteColors = {
            [TERRAIN.GRASS]: this.currentMap.tileset === 'deserto' ? '#d4a373' : '#4a7c3f',
            [TERRAIN.TREE]: this.currentMap.tileset === 'deserto' ? '#2b4d2f' : '#2d5a1e',
            [TERRAIN.WATER]: '#2a5f8f',
            [TERRAIN.MOUNTAIN]: this.currentMap.tileset === 'deserto' ? '#a88059' : '#6b6b6b',
            [TERRAIN.GOLD_MINE]: '#ffd700',
            [TERRAIN.PATH]: '#8b7355'
        };

        // Renderizar tiles
        for (let y = 0; y < mapH; y++) {
            const row = grid[y];
            if (!row) continue;
            for (let x = 0; x < mapW; x++) {
                const t = row[x];
                ctx.fillStyle = paletteColors[t] || '#4a7c3f';
                ctx.fillRect(x * this.tileSize, y * this.tileSize, this.tileSize + 0.5, this.tileSize + 0.5);

                // Ícones decorativos ou marcadores
                if (t === TERRAIN.GOLD_MINE) {
                    ctx.fillStyle = 'rgba(0,0,0,0.15)';
                    ctx.fillRect(x * this.tileSize + 3, y * this.tileSize + 3, this.tileSize - 6, this.tileSize - 6);
                }
            }
        }

        // Grade sutil se o zoom for suficiente
        if (this.camera.zoom > 0.45) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            for (let x = 0; x <= mapW; x++) {
                ctx.moveTo(x * this.tileSize, 0);
                ctx.lineTo(x * this.tileSize, mapH * this.tileSize);
            }
            for (let y = 0; y <= mapH; y++) {
                ctx.moveTo(0, y * this.tileSize);
                ctx.lineTo(mapW * this.tileSize, y * this.tileSize);
            }
            ctx.stroke();
        }

        // Borda externa do mapa
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, mapW * this.tileSize, mapH * this.tileSize);

        // Renderizar Spawns
        if (Array.isArray(this.currentMap.spawns)) {
            for (const s of this.currentMap.spawns) {
                const cx = s.x * this.tileSize + this.tileSize / 2;
                const cy = s.y * this.tileSize + this.tileSize / 2;
                const isP1 = (s.faction === 'player' || s.id === 'player');
                const isExp = (s.id === 'expansion' || s.faction === 'expansion');

                ctx.fillStyle = isP1 ? '#3b82f6' : isExp ? '#d97706' : '#ef4444';
                ctx.beginPath();
                ctx.arc(cx, cy, this.tileSize * 0.9, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.font = '14px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(isP1 ? '👑' : isExp ? '🏛️' : '⚔️', cx, cy);

                // Rótulo do spawn
                ctx.fillStyle = '#f8fafc';
                ctx.font = 'bold 10px sans-serif';
                ctx.fillText(s.name || s.faction, cx, cy + this.tileSize * 1.3);
            }
        }

        // Renderizar Creeps Neutros
        if (Array.isArray(this.currentMap.creeps)) {
            for (const c of this.currentMap.creeps) {
                const cx = c.x * this.tileSize + this.tileSize / 2;
                const cy = c.y * this.tileSize + this.tileSize / 2;

                ctx.fillStyle = 'rgba(168, 85, 247, 0.4)';
                ctx.beginPath();
                ctx.arc(cx, cy, this.tileSize * 0.8, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#a855f7';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                const icon = c.type === 'CREEP_GOLEM' ? '🗿' : c.type === 'CREEP_OGRE' ? '🧌' : '🐺';
                ctx.font = '13px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(icon, cx, cy);
            }
        }

        // Preview da Ferramenta / Cursor do Pincel
        if (this.hoverTile.x >= 0 && this.hoverTile.x < mapW && this.hoverTile.y >= 0 && this.hoverTile.y < mapH) {
            const size = (this.activeBrush.type === 'terrain') ? this.brushSize : 1;
            const offset = Math.floor(size / 2);
            const px = (this.hoverTile.x - offset) * this.tileSize;
            const py = (this.hoverTile.y - offset) * this.tileSize;
            const pw = size * this.tileSize;
            const ph = size * this.tileSize;

            ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
            ctx.fillRect(px, py, pw, ph);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.strokeRect(px, py, pw, ph);
        }

        ctx.restore();
    }
}

export const mapEditor = new MapEditor();
if (typeof window !== 'undefined') {
    window.mapEditor = mapEditor;
}
