import { showToast } from './ui.js';
import { CONFIG, TERRAIN } from './config.js';
import { gameState } from './state.js';
import {
    Building,
    isCollidingWithObstacle,
    getStandPositionNearTile,
    getStandPositionNearBuilding,
    assignFormationPositions,
    getResourceCluster,
    getStandPositionNearCluster
} from './entities.js';
import { BUILDING_DEFS } from './data.js';
import { broadcastNetAction } from './network.js';
const canvas = document.getElementById('gameCanvas');

function setupInput() {
    window.addEventListener('keydown', (e) => {
        gameState.keys[e.key.toLowerCase()] = true;
        if (e.key === 'Escape') {
            if (gameState.buildingMode) {
                gameState.buildingMode = null;
                showToast('Modo de construção cancelado.');
            } else {
                gameState.selectedBuilding = null;
                gameState.selectedUnits = [];
                showToast('Seleção cancelada.');
            }
        }
    });
    
    window.addEventListener('keyup', (e) => {
        gameState.keys[e.key.toLowerCase()] = false;
    });
    
    canvas.addEventListener('mousedown', (e) => {
        const worldX = (e.clientX - canvas.width / 2) / gameState.camera.zoom + gameState.camera.x;
        const worldY = (e.clientY - canvas.height / 2) / gameState.camera.zoom + gameState.camera.y;

        if (e.button === 0) {
            if (gameState.rallyMode) {
                gameState.rallyPoint = { x: worldX, y: worldY };
                gameState.rallyMode = false;
                showToast('🚩 Ponto de reunião definido.');
                return;
            }
            if (gameState.buildingMode) {
                const placed = placeBuilding(gameState.buildingMode, worldX, worldY);
                if (!placed) {
                    showToast('Não é possível construir neste local!');
                }
                gameState.mouse.down = false;
                gameState.dragStart = null;
                gameState.selectionBox = null;
                return;
            }

            gameState.mouse.down = true;
            gameState.mouse.clickX = e.clientX;
            gameState.mouse.clickY = e.clientY;
            gameState.dragStart = { x: e.clientX, y: e.clientY };
            gameState.selectionBox = { x: e.clientX, y: e.clientY, width: 0, height: 0 };
        } else if (e.button === 2) {
            e.preventDefault();
            if (gameState.buildingMode) {
                gameState.buildingMode = null;
                showToast('Modo de construção cancelado.');
                return;
            }
            handleRightClick(e);
        }
    });
    
    canvas.addEventListener('mousemove', (e) => {
        gameState.mouse.x = e.clientX;
        gameState.mouse.y = e.clientY;
        gameState.mouse.worldX = (e.clientX - canvas.width / 2) / gameState.camera.zoom + gameState.camera.x;
        gameState.mouse.worldY = (e.clientY - canvas.height / 2) / gameState.camera.zoom + gameState.camera.y;
        
        if (gameState.mouse.down && gameState.dragStart && !gameState.buildingMode) {
            gameState.selectionBox.x = Math.min(gameState.dragStart.x, e.clientX);
            gameState.selectionBox.y = Math.min(gameState.dragStart.y, e.clientY);
            gameState.selectionBox.width = Math.abs(e.clientX - gameState.dragStart.x);
            gameState.selectionBox.height = Math.abs(e.clientY - gameState.dragStart.y);
        }
    });
    
    canvas.addEventListener('mouseup', (e) => {
        if (e.button === 0) {
            if (gameState.buildingMode) {
                gameState.mouse.down = false;
                gameState.dragStart = null;
                gameState.selectionBox = null;
                return;
            }
            gameState.mouse.down = false;
            handleSelection(e);
            gameState.dragStart = null;
            gameState.selectionBox = null;
        }
    });
    
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? -CONFIG.ZOOM_STEP : CONFIG.ZOOM_STEP;
        gameState.camera.zoom = Math.max(CONFIG.ZOOM_MIN, Math.min(CONFIG.ZOOM_MAX, gameState.camera.zoom + zoomFactor));
    });
}

function handleRightClick(e) {
    const worldX = (e.clientX - canvas.width / 2) / gameState.camera.zoom + gameState.camera.x;
    const worldY = (e.clientY - canvas.height / 2) / gameState.camera.zoom + gameState.camera.y;
    const tileX = Math.floor(worldX / CONFIG.TILE_SIZE);
    const tileY = Math.floor(worldY / CONFIG.TILE_SIZE);
    
    if (gameState.buildingMode) {
        gameState.buildingMode = null;
        showToast('Modo de construção cancelado.');
        return;
    }
    
    if (!gameState.selectedUnits || gameState.selectedUnits.length === 0) {
        return;
    }

    const isTileExplored = gameState.explored && gameState.explored[tileY] && gameState.explored[tileY][tileX];
    const isTileVisible = gameState.visibility && gameState.visibility[tileY] && gameState.visibility[tileY][tileX];

    const cluster = isTileExplored ? getResourceCluster(tileX, tileY) : null;
    const hasResource = Boolean(cluster && cluster.totalRemaining > 0);

    const myRole = gameState.myRole || 'player';

    // Detectar se clicou em inimigo ou neutro (creeps) visível
    let targetEnemy = null;
    let closestDist = Infinity;
    
    for (const unit of gameState.units) {
        if (unit.owner !== myRole && unit.health > 0) {
            const uTileX = Math.floor(unit.x / CONFIG.TILE_SIZE);
            const uTileY = Math.floor(unit.y / CONFIG.TILE_SIZE);
            const isVisible = gameState.visibility && gameState.visibility[uTileY] && gameState.visibility[uTileY][uTileX];
            if (!isVisible) continue;

            const dx = unit.x - worldX;
            const dy = unit.y - worldY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < unit.size + 12 && dist < closestDist) {
                targetEnemy = unit;
                closestDist = dist;
            }
        }
    }
    
    // Detectar se clicou em edifício
    let targetBuilding = null;
    for (const building of gameState.buildings) {
        if (building.health > 0) {
            const bx = building.x * CONFIG.TILE_SIZE;
            const by = building.y * CONFIG.TILE_SIZE;
            const bw = building.width * CONFIG.TILE_SIZE;
            const bh = building.height * CONFIG.TILE_SIZE;
            
            if (worldX >= bx && worldX <= bx + bw && worldY >= by && worldY <= by + bh) {
                if (building.owner !== myRole) {
                    const cbx = Math.floor((building.x + building.width / 2));
                    const cby = Math.floor((building.y + building.height / 2));
                    const isVisible = gameState.visibility && gameState.visibility[cby] && gameState.visibility[cby][cbx];
                    if (isVisible) {
                        targetBuilding = building;
                        break;
                    }
                } else {
                    targetBuilding = building;
                    break;
                }
            }
        }
    }

    if (targetBuilding && targetBuilding.owner !== myRole) {
        targetEnemy = targetBuilding;
        closestDist = 0;
    }

    const activeUnits = gameState.selectedUnits.filter(u => u.owner === myRole && u.health > 0);
    if (activeUnits.length === 0) return;

    // Se clicou em um edifício aliado inacabado e há camponeses selecionados
    if (targetBuilding && targetBuilding.owner === myRole && !targetBuilding.isConstructed) {
        const peasants = activeUnits.filter(u => u.canGather);
        if (peasants.length > 0) {
            peasants.forEach(p => p.assignBuild(targetBuilding));
            const nonPeasants = activeUnits.filter(u => !u.canGather);
            if (nonPeasants.length > 0) {
                const stand = getStandPositionNearBuilding(targetBuilding, nonPeasants[0].x, nonPeasants[0].y, 8);
                assignFormationPositions(nonPeasants, stand.x, stand.y);
            }
            broadcastNetAction({
                type: 'right_click_build',
                role: myRole,
                unitIds: peasants.map(u => u.id),
                buildingId: targetBuilding.id
            });
            showToast(`🔨 ${peasants.length} camponês(es) enviados para construir ${targetBuilding.name}!`);
            return;
        }
    }

    // Se clicou em um edifício aliado danificado e há camponeses selecionados
    if (targetBuilding && targetBuilding.owner === myRole && targetBuilding.isConstructed && targetBuilding.health < targetBuilding.maxHealth) {
        const peasants = activeUnits.filter(u => u.canGather);
        if (peasants.length > 0) {
            peasants.forEach(p => p.assignRepair(targetBuilding));
            const nonPeasants = activeUnits.filter(u => !u.canGather);
            if (nonPeasants.length > 0) {
                const stand = getStandPositionNearBuilding(targetBuilding, nonPeasants[0].x, nonPeasants[0].y, 8);
                assignFormationPositions(nonPeasants, stand.x, stand.y);
            }
            broadcastNetAction({
                type: 'right_click_repair',
                role: myRole,
                unitIds: peasants.map(u => u.id),
                buildingId: targetBuilding.id
            });
            showToast(`🔧 ${peasants.length} camponês(es) enviados para reparar ${targetBuilding.name} (${Math.round((targetBuilding.health / targetBuilding.maxHealth) * 100)}% de integridade)!`);
            return;
        }
    }

    if (targetEnemy) {
        // Comando de ataque contra inimigo visível
        for (let i = 0; i < activeUnits.length; i++) {
            const unit = activeUnits[i];
            unit.attackTarget = targetEnemy;
            unit.gathering = false;
            unit.autoGathering = false;
            unit.returning = false;
            unit.clusterOrigin = null;
            unit.gatherType = null;
            unit.gatherTargetTile = null;
            
            // Posicionar ao redor do inimigo com dispersão
            if (targetEnemy.width) {
                const stand = getStandPositionNearBuilding(targetEnemy, unit.x, unit.y, unit.size);
                unit.targetX = stand.x;
                unit.targetY = stand.y;
            } else {
                const angle = (i / activeUnits.length) * Math.PI * 2;
                const dist = Math.max(12, (unit.attackRange || 20) * 0.6);
                unit.targetX = targetEnemy.x + Math.cos(angle) * dist;
                unit.targetY = targetEnemy.y + Math.sin(angle) * dist;
            }
        }
        broadcastNetAction({
            type: 'right_click_attack',
            role: myRole,
            unitIds: activeUnits.map(u => u.id),
            targetId: targetEnemy.id,
            targetType: targetEnemy.width ? 'building' : 'unit'
        });
        showToast(`⚔️ Atacando ${targetEnemy.name || 'alvo'}!`);
        return;
    }

    // Se clicou em um recurso REVELADO (fora do fog preto) e há camponeses selecionados
    const peasants = activeUnits.filter(u => u.canGather);
    if (hasResource && isTileExplored && peasants.length > 0) {
        const resName = cluster.type === 'gold' ? 'Mina de Ouro' : 'Floresta (Madeira)';
        
        peasants.forEach((peasant, idx) => {
            peasant.assignResourceHarvest(tileX, tileY, idx);
        });

        // Outras unidades não-camponesas movem-se até perto do recurso
        const nonPeasants = activeUnits.filter(u => !u.canGather);
        if (nonPeasants.length > 0) {
            const standPos = getStandPositionNearCluster(cluster, nonPeasants[0].x, nonPeasants[0].y, 8, 0);
            assignFormationPositions(nonPeasants, standPos.x, standPos.y);
        }

        broadcastNetAction({
            type: 'right_click_gather',
            role: myRole,
            unitIds: peasants.map(u => u.id),
            tileX,
            tileY
        });

        showToast(`⛏️ Designado para extrair ${resName} (${cluster.totalRemaining} restantes)`);
        return;
    }

    // Movimento normal com cálculo de formação (cancela rotinas de coleta automáticas)
    assignFormationPositions(activeUnits, worldX, worldY);
    broadcastNetAction({
        type: 'right_click_move',
        role: myRole,
        unitIds: activeUnits.map(u => u.id),
        worldX,
        worldY
    });
}

let lastClickTime = 0;
let lastClickedUnit = null;

function handleSelection(e) {
    const isShift = (e && e.shiftKey) || Boolean(gameState.keys['shift']);

    const myRole = gameState.myRole || 'player';

    if (!gameState.selectionBox || (gameState.selectionBox.width < 5 && gameState.selectionBox.height < 5)) {
        // Clique simples
        const worldX = (gameState.mouse.clickX - canvas.width / 2) / gameState.camera.zoom + gameState.camera.x;
        const worldY = (gameState.mouse.clickY - canvas.height / 2) / gameState.camera.zoom + gameState.camera.y;
        
        let clickedUnit = null;
        let closestDist = Infinity;
        
        for (const unit of gameState.units) {
            if (unit.owner !== myRole || unit.health <= 0) continue;
            const dx = unit.x - worldX;
            const dy = unit.y - worldY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < unit.size + 8 && dist < closestDist) {
                clickedUnit = unit;
                closestDist = dist;
            }
        }
        
        if (clickedUnit) {
            const now = Date.now();
            // Duplo clique na mesma unidade ou tipo de unidade seleciona todos do mesmo tipo na tela
            if (!isShift && lastClickedUnit && (lastClickedUnit === clickedUnit || lastClickedUnit.name === clickedUnit.name) && (now - lastClickTime) < 350) {
                const viewLeft = gameState.camera.x - canvas.width / 2 / gameState.camera.zoom;
                const viewTop = gameState.camera.y - canvas.height / 2 / gameState.camera.zoom;
                const viewRight = viewLeft + canvas.width / gameState.camera.zoom;
                const viewBottom = viewTop + canvas.height / gameState.camera.zoom;
                
                const sameTypeUnits = gameState.units.filter(u => 
                    u.owner === myRole && 
                    u.health > 0 &&
                    u.name === clickedUnit.name &&
                    u.x >= viewLeft - 20 && u.x <= viewRight + 20 && 
                    u.y >= viewTop - 20 && u.y <= viewBottom + 20
                );
                gameState.selectedUnits = sameTypeUnits;
                gameState.selectedBuilding = null;
                showToast(`⚔️ Todos os ${clickedUnit.name}s visíveis selecionados (${sameTypeUnits.length})`);
                lastClickTime = 0;
                lastClickedUnit = null;
                return;
            }

            lastClickTime = now;
            lastClickedUnit = clickedUnit;

            if (isShift) {
                const idx = gameState.selectedUnits.indexOf(clickedUnit);
                if (idx !== -1) {
                    gameState.selectedUnits.splice(idx, 1);
                } else {
                    gameState.selectedUnits.push(clickedUnit);
                }
            } else {
                gameState.selectedUnits = [clickedUnit];
            }
            gameState.selectedBuilding = null;
        } else {
            lastClickedUnit = null;
            const clickedBuilding = gameState.buildings.find(building => {
                if (building.owner !== myRole || building.health <= 0) return false;
                const bx = building.x * CONFIG.TILE_SIZE;
                const by = building.y * CONFIG.TILE_SIZE;
                return worldX >= bx && worldX <= bx + building.width * CONFIG.TILE_SIZE &&
                    worldY >= by && worldY <= by + building.height * CONFIG.TILE_SIZE;
            });
            if (clickedBuilding) {
                gameState.selectedUnits = [];
                gameState.selectedBuilding = clickedBuilding;
                return;
            }
            if (!isShift) {
                gameState.selectedUnits = [];
                gameState.selectedBuilding = null;
            }
        }
        return;
    }
    
    // Seleção por caixa
    const boxLeft = (gameState.selectionBox.x - canvas.width / 2) / gameState.camera.zoom + gameState.camera.x;
    const boxTop = (gameState.selectionBox.y - canvas.height / 2) / gameState.camera.zoom + gameState.camera.y;
    const boxRight = (gameState.selectionBox.x + gameState.selectionBox.width - canvas.width / 2) / gameState.camera.zoom + gameState.camera.x;
    const boxBottom = (gameState.selectionBox.y + gameState.selectionBox.height - canvas.height / 2) / gameState.camera.zoom + gameState.camera.y;
    
    const newSelection = gameState.units.filter(unit => {
        if (unit.owner !== myRole || unit.health <= 0) return false;
        return unit.x >= boxLeft && unit.x <= boxRight && unit.y >= boxTop && unit.y <= boxBottom;
    });
    
    if (newSelection.length > 0) {
        if (isShift) {
            newSelection.forEach(u => {
                if (!gameState.selectedUnits.includes(u)) {
                    gameState.selectedUnits.push(u);
                }
            });
        } else {
            gameState.selectedUnits = newSelection;
        }
        gameState.selectedBuilding = null;
    }
}

function canPlaceBuilding(type, buildingX, buildingY) {
    const def = BUILDING_DEFS[type];
    if (!def) return { valid: false, reason: 'Edifício inválido' };

    const myRole = gameState.myRole || 'player';
    const alivePeasants = gameState.units.filter(u => u.canGather && u.owner === myRole && u.health > 0);
    if (alivePeasants.length === 0) {
        return { valid: false, reason: 'É necessário ter pelo menos 1 Camponês para construir!' };
    }

    const costGold = def.costGold || (type === 'HOUSE' ? 100 : type === 'BARRACKS' ? 150 : type === 'ARCHERY_RANGE' ? 125 : type === 'FARM' ? 50 : type === 'WALL' ? 25 : 150);
    const costWood = def.costWood || (type === 'HOUSE' ? 50 : type === 'BARRACKS' ? 100 : type === 'ARCHERY_RANGE' ? 75 : type === 'FARM' ? 25 : type === 'WALL' ? 25 : 50);

    const myResources = (myRole === 'enemy') ? gameState.enemyResources : gameState.resources;

    if (myResources.gold < costGold || myResources.wood < costWood) {
        return { valid: false, reason: `Recursos insuficientes (🪙${costGold} 🪵${costWood})` };
    }

    if (buildingX < 0 || buildingY < 0 ||
        buildingX + def.width > CONFIG.MAP_WIDTH ||
        buildingY + def.height > CONFIG.MAP_HEIGHT) {
        return { valid: false, reason: 'Fora dos limites do mapa' };
    }

    for (let tileY = buildingY; tileY < buildingY + def.height; tileY++) {
        for (let tileX = buildingX; tileX < buildingX + def.width; tileX++) {
            // Não deve ser possível construir dentro da névoa de guerra (fog of war)
            if (gameState.visibility && (!gameState.visibility[tileY] || !gameState.visibility[tileY][tileX])) {
                return { valid: false, reason: 'Não é possível construir em áreas cobertas pela névoa de guerra!' };
            }

            const terrain = gameState.map[tileY]?.[tileX];
            if (terrain === undefined || terrain === TERRAIN.WATER || terrain === TERRAIN.MOUNTAIN ||
                terrain === TERRAIN.TREE || terrain === TERRAIN.GOLD_MINE) {
                return { valid: false, reason: 'Terreno obstruído ou impróprio' };
            }
        }
    }

    for (const building of gameState.buildings) {
        if (buildingX < building.x + building.width && buildingX + def.width > building.x &&
            buildingY < building.y + building.height && buildingY + def.height > building.y) {
            return { valid: false, reason: 'Espaço ocupado por outro edifício' };
        }
    }

    return { valid: true, costGold, costWood, def, alivePeasants };
}

function placeBuilding(type, x, y) {
    const buildingX = Math.floor(x / CONFIG.TILE_SIZE);
    const buildingY = Math.floor(y / CONFIG.TILE_SIZE);

    const check = canPlaceBuilding(type, buildingX, buildingY);
    if (!check.valid) {
        showToast(check.reason);
        return false;
    }

    const { def, costGold, costWood, alivePeasants } = check;
    const myRole = gameState.myRole || 'player';
    const myResources = (myRole === 'enemy') ? gameState.enemyResources : gameState.resources;

    // Criar a fundação da construção (isConstructed = false) com id único
    const buildingId = 'bld_' + Math.random().toString(36).substr(2, 9);
    const building = new Building(def, buildingX, buildingY, myRole, false, buildingId);
    gameState.buildings.push(building);
    
    myResources.gold -= costGold;
    myResources.wood -= costWood;

    // Ejetar com segurança qualquer unidade que esteja dentro da área da nova fundação
    const bPixelX = buildingX * CONFIG.TILE_SIZE;
    const bPixelY = buildingY * CONFIG.TILE_SIZE;
    const bPixelW = def.width * CONFIG.TILE_SIZE;
    const bPixelH = def.height * CONFIG.TILE_SIZE;

    for (const unit of gameState.units) {
        if (unit.health > 0) {
            const uRad = unit.size || 8;
            if (unit.x + uRad >= bPixelX && unit.x - uRad <= bPixelX + bPixelW &&
                unit.y + uRad >= bPixelY && unit.y - uRad <= bPixelY + bPixelH) {
                const safePos = getStandPositionNearBuilding(building, unit.x, unit.y, uRad);
                unit.x = safePos.x;
                unit.y = safePos.y;
                if (unit.targetX !== null) {
                    unit.targetX = safePos.x;
                    unit.targetY = safePos.y;
                }
            }
        }
    }

    // Designar o trabalhador (prioridade: camponês selecionado; se nenhum, o mais próximo)
    const selectedPeasants = gameState.selectedUnits.filter(u => u.canGather && u.owner === myRole && u.health > 0);
    let workerAssigned = null;

    if (selectedPeasants.length > 0) {
        selectedPeasants.forEach(p => p.assignBuild(building));
        workerAssigned = selectedPeasants[0];
    } else {
        const standPos = getStandPositionNearBuilding(building, x, y, 8);
        let closestDist = Infinity;
        for (const p of alivePeasants) {
            const d = Math.hypot(p.x - standPos.x, p.y - standPos.y);
            if (d < closestDist) {
                closestDist = d;
                workerAssigned = p;
            }
        }
        if (workerAssigned) {
            workerAssigned.assignBuild(building);
        }
    }

    broadcastNetAction({
        type: 'place_building',
        role: myRole,
        buildingType: type,
        buildingX,
        buildingY,
        buildingId,
        workerId: workerAssigned ? workerAssigned.id : null
    });

    // Efeito de poeira e marcação da fundação
    const cx = (buildingX + def.width / 2) * CONFIG.TILE_SIZE;
    const cy = (buildingY + def.height / 2) * CONFIG.TILE_SIZE;
    for (let i = 0; i < 16; i++) {
        gameState.particles.push({
            x: cx + (Math.random() - 0.5) * def.width * CONFIG.TILE_SIZE,
            y: cy + (Math.random() - 0.5) * def.height * CONFIG.TILE_SIZE,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4,
            life: 25,
            maxLife: 25,
            color: '#c4a482',
            size: 4,
        });
    }
    
    gameState.buildingMode = null;
    const workerName = workerAssigned ? workerAssigned.name : 'Camponês';
    showToast(`🔨 ${def.name} iniciada! ${workerName} a caminho para construir.`);
    return true;
}

function updateCamera() {
    const speed = CONFIG.CAMERA_SPEED * gameState.camera.zoom;
    
    if (gameState.keys['w'] || gameState.keys['arrowup']) gameState.camera.y -= speed;
    if (gameState.keys['s'] || gameState.keys['arrowdown']) gameState.camera.y += speed;
    if (gameState.keys['a'] || gameState.keys['arrowleft']) gameState.camera.x -= speed;
    if (gameState.keys['d'] || gameState.keys['arrowright']) gameState.camera.x += speed;
    
    const mapPixelW = CONFIG.MAP_WIDTH * CONFIG.TILE_SIZE;
    const mapPixelH = CONFIG.MAP_HEIGHT * CONFIG.TILE_SIZE;
    const viewW = canvas.width / gameState.camera.zoom;
    const viewH = canvas.height / gameState.camera.zoom;
    
    gameState.camera.x = Math.max(viewW / 2, Math.min(mapPixelW - viewW / 2, gameState.camera.x));
    gameState.camera.y = Math.max(viewH / 2, Math.min(mapPixelH - viewH / 2, gameState.camera.y));
}

export { setupInput, updateCamera, placeBuilding, canPlaceBuilding };
