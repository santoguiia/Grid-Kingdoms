import { CONFIG, TERRAIN } from './config.js';
import { gameState } from './state.js';
import { updateUI } from './ui.js';
import { BUILDING_DEFS } from './data.js';
import { canPlaceBuilding } from './input.js';
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

function drawMap() {
    const viewLeft = gameState.camera.x - canvas.width / 2 / gameState.camera.zoom;
    const viewTop = gameState.camera.y - canvas.height / 2 / gameState.camera.zoom;
    const viewRight = viewLeft + canvas.width / gameState.camera.zoom;
    const viewBottom = viewTop + canvas.height / gameState.camera.zoom;
    
    const startX = Math.max(0, Math.floor(viewLeft / CONFIG.TILE_SIZE));
    const startY = Math.max(0, Math.floor(viewTop / CONFIG.TILE_SIZE));
    const endX = Math.min(CONFIG.MAP_WIDTH, Math.ceil(viewRight / CONFIG.TILE_SIZE));
    const endY = Math.min(CONFIG.MAP_HEIGHT, Math.ceil(viewBottom / CONFIG.TILE_SIZE));
    
    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            const screenX = (x * CONFIG.TILE_SIZE - gameState.camera.x) * gameState.camera.zoom + canvas.width / 2;
            const screenY = (y * CONFIG.TILE_SIZE - gameState.camera.y) * gameState.camera.zoom + canvas.height / 2;
            const tileSize = CONFIG.TILE_SIZE * gameState.camera.zoom;
            
            const terrain = gameState.map[y][x];
            if (!gameState.explored[y][x]) {
                ctx.fillStyle = '#071012';
                ctx.fillRect(screenX, screenY, tileSize + 1, tileSize + 1);
                continue;
            }
            
            if (terrain === TERRAIN.GRASS) {
                const idx = (x + y) % 3;
                if (gameState.mapIndex === 2) {
                    const colors = ['#e2a85c', '#dca052', '#e8b266'];
                    ctx.fillStyle = colors[idx];
                } else {
                    const colors = ['#4a7c3f', '#3d6b34', '#558b4a'];
                    ctx.fillStyle = colors[idx];
                }
            } else if (terrain === TERRAIN.TREE) {
                ctx.fillStyle = gameState.mapIndex === 2 ? '#5d7d40' : '#2d5a1e';
            } else if (terrain === TERRAIN.WATER) {
                ctx.fillStyle = gameState.mapIndex === 2 ? '#1db4db' : '#2a5f8f';
            } else if (terrain === TERRAIN.MOUNTAIN) {
                ctx.fillStyle = gameState.mapIndex === 2 ? '#c87d32' : '#6b6b6b';
            } else if (terrain === TERRAIN.GOLD_MINE) {
                ctx.fillStyle = '#8b7355';
            } else if (terrain === TERRAIN.PATH) {
                ctx.fillStyle = gameState.mapIndex === 2 ? '#c29153' : '#8b7355';
            }
            
            ctx.fillRect(screenX, screenY, tileSize + 1, tileSize + 1);
            if (!gameState.visibility[y][x]) {
                ctx.fillStyle = 'rgba(4, 8, 10, 0.62)';
                ctx.fillRect(screenX, screenY, tileSize + 1, tileSize + 1);
            }
            
            // Detalhes
            if (terrain === TERRAIN.TREE) {
                if (gameState.mapIndex === 2) {
                    ctx.fillStyle = '#2c4c2c';
                    const cx = screenX + tileSize / 2;
                    const cy = screenY + tileSize / 2;
                    // Tronco principal do cacto
                    ctx.fillRect(cx - tileSize * 0.08, cy - tileSize * 0.35, tileSize * 0.16, tileSize * 0.7);
                    // Bracinho esquerdo
                    ctx.fillRect(cx - tileSize * 0.26, cy - tileSize * 0.1, tileSize * 0.18, tileSize * 0.08);
                    ctx.fillRect(cx - tileSize * 0.26, cy - tileSize * 0.25, tileSize * 0.08, tileSize * 0.15);
                    // Bracinho direito
                    ctx.fillRect(cx + tileSize * 0.08, cy + tileSize * 0.05, tileSize * 0.18, tileSize * 0.08);
                    ctx.fillRect(cx + tileSize * 0.18, cy - tileSize * 0.1, tileSize * 0.08, tileSize * 0.15);
                } else {
                    ctx.fillStyle = '#1a3a0e';
                    ctx.beginPath();
                    ctx.arc(screenX + tileSize / 2, screenY + tileSize / 2, tileSize * 0.35, 0, Math.PI * 2);
                    ctx.fill();
                }
            } else if (terrain === TERRAIN.GOLD_MINE) {
                ctx.fillStyle = '#ffd700';
                ctx.beginPath();
                ctx.arc(screenX + tileSize / 2, screenY + tileSize / 2, tileSize * 0.25, 0, Math.PI * 2);
                ctx.fill();
            } else if (terrain === TERRAIN.MOUNTAIN) {
                ctx.fillStyle = gameState.mapIndex === 2 ? '#b85a1a' : '#4a4a4a';
                ctx.beginPath();
                ctx.moveTo(screenX + tileSize / 2, screenY);
                ctx.lineTo(screenX + tileSize, screenY + tileSize);
                ctx.lineTo(screenX, screenY + tileSize);
                ctx.fill();
            }
        }
    }
}

function drawSelectionBox() {
    if (gameState.selectionBox) {
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(
            gameState.selectionBox.x,
            gameState.selectionBox.y,
            gameState.selectionBox.width,
            gameState.selectionBox.height
        );
        ctx.setLineDash([]);
    }
}

function drawMinimap() {
    const scaleX = minimapCanvas.width / (CONFIG.MAP_WIDTH * CONFIG.TILE_SIZE);
    const scaleY = minimapCanvas.height / (CONFIG.MAP_HEIGHT * CONFIG.TILE_SIZE);
    
    minimapCtx.fillStyle = '#071012';
    minimapCtx.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);
    
    const tileW = CONFIG.TILE_SIZE * scaleX + 0.5;
    const tileH = CONFIG.TILE_SIZE * scaleY + 0.5;

    for (let y = 0; y < CONFIG.MAP_HEIGHT; y++) {
        for (let x = 0; x < CONFIG.MAP_WIDTH; x++) {
            const terrain = gameState.map[y][x];
            const miniX = x * CONFIG.TILE_SIZE * scaleX;
            const miniY = y * CONFIG.TILE_SIZE * scaleY;
            
            if (!gameState.explored[y][x]) {
                minimapCtx.fillStyle = '#071012';
                minimapCtx.fillRect(miniX, miniY, tileW, tileH);
                continue;
            }
            let color;
            if (gameState.mapIndex === 2) {
                switch (terrain) {
                    case TERRAIN.GRASS: color = '#e0a96d'; break;
                    case TERRAIN.TREE: color = '#3f5e3f'; break;
                    case TERRAIN.WATER: color = '#1db4db'; break;
                    case TERRAIN.MOUNTAIN: color = '#cd853f'; break;
                    case TERRAIN.GOLD_MINE: color = '#ffd700'; break;
                    case TERRAIN.PATH: color = '#c29153'; break;
                    default: color = '#000';
                }
            } else {
                switch (terrain) {
                    case TERRAIN.GRASS: color = '#4a7c3f'; break;
                    case TERRAIN.TREE: color = '#2d5a1e'; break;
                    case TERRAIN.WATER: color = '#2a5f8f'; break;
                    case TERRAIN.MOUNTAIN: color = '#6b6b6b'; break;
                    case TERRAIN.GOLD_MINE: color = '#ffd700'; break;
                    case TERRAIN.PATH: color = '#8b7355'; break;
                    default: color = '#000';
                }
            }
            minimapCtx.fillStyle = color;
            minimapCtx.fillRect(miniX, miniY, tileW, tileH);
            if (!gameState.visibility[y][x]) {
                minimapCtx.fillStyle = 'rgba(4, 8, 10, 0.68)';
                minimapCtx.fillRect(miniX, miniY, tileW, tileH);
            }
        }
    }

    const myRole = gameState.myRole || 'player';
    for (const unit of gameState.units) {
        const unitTileX = Math.floor(unit.x / CONFIG.TILE_SIZE);
        const unitTileY = Math.floor(unit.y / CONFIG.TILE_SIZE);
        const myTeam = (gameState.teams && gameState.teams[myRole]) || 1;
        const unitTeam = unit.team || (gameState.teams && gameState.teams[unit.owner]) || (unit.owner === 'player' ? 1 : 2);
        const isHostile = unitTeam !== myTeam && !unit.isNeutral;
        if (isHostile && (!gameState.visibility[unitTileY] || !gameState.visibility[unitTileY][unitTileX])) continue;

        if (unit.isHero) {
            minimapCtx.fillStyle = '#f59e0b';
            minimapCtx.fillRect(unit.x * scaleX - 2.5, unit.y * scaleY - 2.5, 5, 5);
        } else if (unit.isNeutral) {
            minimapCtx.fillStyle = '#c084fc';
            minimapCtx.fillRect(unit.x * scaleX - 1.5, unit.y * scaleY - 1.5, 3, 3);
        } else {
            const playerColor = CONFIG.FACTION_COLORS?.[unit.owner] || CONFIG.TEAM_COLORS?.[unitTeam] || (unitTeam === myTeam ? '#4444ff' : '#ff4444');
            minimapCtx.fillStyle = playerColor;
            minimapCtx.fillRect(unit.x * scaleX - 1.5, unit.y * scaleY - 1.5, 3, 3);
        }
    }
    
    for (const building of gameState.buildings) {
        const buildingTileX = Math.floor(building.x + building.width / 2);
        const buildingTileY = Math.floor(building.y + building.height / 2);
        const myTeam = (gameState.teams && gameState.teams[myRole]) || 1;
        const bTeam = (gameState.teams && gameState.teams[building.owner]) || (building.owner === 'player' ? 1 : 2);
        const isHostile = bTeam !== myTeam;
        if (isHostile && (!gameState.visibility[buildingTileY] || !gameState.visibility[buildingTileY][buildingTileX])) continue;
        
        const buildingColor = CONFIG.FACTION_COLORS?.[building.owner] || CONFIG.TEAM_COLORS?.[bTeam] || (bTeam === myTeam ? '#ffd700' : '#ff4444');
        minimapCtx.fillStyle = buildingColor;
        minimapCtx.fillRect(
            building.x * CONFIG.TILE_SIZE * scaleX,
            building.y * CONFIG.TILE_SIZE * scaleY,
            building.width * CONFIG.TILE_SIZE * scaleX,
            building.height * CONFIG.TILE_SIZE * scaleY
        );
    }
    
    const viewX = (gameState.camera.x - canvas.width / 2 / gameState.camera.zoom) * scaleX;
    const viewY = (gameState.camera.y - canvas.height / 2 / gameState.camera.zoom) * scaleY;
    const viewW = (canvas.width / gameState.camera.zoom) * scaleX;
    const viewH = (canvas.height / gameState.camera.zoom) * scaleY;
    
    minimapCtx.strokeStyle = '#ffffff';
    minimapCtx.lineWidth = 1.5;
    minimapCtx.strokeRect(viewX, viewY, viewW, viewH);
}

function drawBuildingPreview() {
    if (!gameState.buildingMode) return;
    const def = BUILDING_DEFS[gameState.buildingMode];
    if (!def) return;

    const buildingTileX = Math.floor(gameState.mouse.worldX / CONFIG.TILE_SIZE);
    const buildingTileY = Math.floor(gameState.mouse.worldY / CONFIG.TILE_SIZE);

    const check = canPlaceBuilding(gameState.buildingMode, buildingTileX, buildingTileY);
    const valid = check.valid;

    const screenX = (buildingTileX * CONFIG.TILE_SIZE - gameState.camera.x) * gameState.camera.zoom + canvas.width / 2;
    const screenY = (buildingTileY * CONFIG.TILE_SIZE - gameState.camera.y) * gameState.camera.zoom + canvas.height / 2;
    const screenW = def.width * CONFIG.TILE_SIZE * gameState.camera.zoom;
    const screenH = def.height * CONFIG.TILE_SIZE * gameState.camera.zoom;

    ctx.save();
    
    // Fundo do preview
    ctx.fillStyle = valid ? 'rgba(46, 204, 113, 0.45)' : 'rgba(231, 76, 60, 0.45)';
    ctx.fillRect(screenX, screenY, screenW, screenH);

    // Contorno principal
    ctx.strokeStyle = valid ? '#2ecc71' : '#e74c3c';
    ctx.lineWidth = 2;
    ctx.strokeRect(screenX, screenY, screenW, screenH);

    // Grade interna para multi-tiles
    ctx.lineWidth = 1;
    for (let ty = 0; ty < def.height; ty++) {
        for (let tx = 0; tx < def.width; tx++) {
            const gx = screenX + tx * CONFIG.TILE_SIZE * gameState.camera.zoom;
            const gy = screenY + ty * CONFIG.TILE_SIZE * gameState.camera.zoom;
            const gw = CONFIG.TILE_SIZE * gameState.camera.zoom;
            ctx.strokeRect(gx, gy, gw, gw);
        }
    }

    // Ícone do edifício
    ctx.font = `${Math.min(screenW, screenH) * 0.45}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, screenX + screenW / 2, screenY + screenH / 2);

    // Texto de auxílio
    ctx.font = 'bold 12px Segoe UI, sans-serif';
    ctx.fillStyle = valid ? '#f2d18a' : '#ff7777';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    const label = `${def.name} (${valid ? 'Clique botão esquerdo para posicionar' : check.reason})`;
    ctx.strokeText(label, screenX + screenW / 2, screenY - 10);
    ctx.fillText(label, screenX + screenW / 2, screenY - 10);

    ctx.restore();
}

function render() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    drawMap();
    
    for (const building of gameState.buildings) {
        building.draw();
    }
    
    for (const unit of gameState.units) {
        unit.draw();
    }
    
    for (const proj of gameState.projectiles) {
        const pTileX = Math.floor(proj.x / CONFIG.TILE_SIZE);
        const pTileY = Math.floor(proj.y / CONFIG.TILE_SIZE);
        if (!gameState.visibility[pTileY] || !gameState.visibility[pTileY][pTileX]) continue;

        const screenX = (proj.x - gameState.camera.x) * gameState.camera.zoom + canvas.width / 2;
        const screenY = (proj.y - gameState.camera.y) * gameState.camera.zoom + canvas.height / 2;
        ctx.fillStyle = proj.color;
        ctx.beginPath();
        ctx.arc(screenX, screenY, 3 * gameState.camera.zoom, 0, Math.PI * 2);
        ctx.fill();
    }
    
    for (const particle of gameState.particles) {
        const pTileX = Math.floor(particle.x / CONFIG.TILE_SIZE);
        const pTileY = Math.floor(particle.y / CONFIG.TILE_SIZE);
        if (!gameState.visibility[pTileY] || !gameState.visibility[pTileY][pTileX]) continue;

        const screenX = (particle.x - gameState.camera.x) * gameState.camera.zoom + canvas.width / 2;
        const screenY = (particle.y - gameState.camera.y) * gameState.camera.zoom + canvas.height / 2;
        const alpha = particle.life / particle.maxLife;
        ctx.fillStyle = particle.color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(screenX, screenY, particle.size * gameState.camera.zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
    
    drawBuildingPreview();
    drawSelectionBox();
    drawMinimap();
    updateUI();
}

export { drawMap, drawSelectionBox, drawMinimap, drawBuildingPreview, render };
