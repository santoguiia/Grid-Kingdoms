import { gameState } from './state.js';
import { CONFIG } from './config.js';
import { Unit, Building, getStandPositionNearBuilding, assignFormationPositions, getResourceCluster } from './entities.js';
import { BUILDING_DEFS, UNIT_DEFS } from './data.js';

export const netChannel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('kingdom-wars-network')
    : null;

// Envio de snapshot a cada 6 frames (~10 atualizações/seg a 60 FPS)
const SYNC_INTERVAL = 6;
let syncCounter = 0;

export function broadcastNetAction(action) {
    if (gameState.gameMode !== 'multiplayer' || !netChannel) return;
    action.senderRole = gameState.myRole;
    netChannel.postMessage(action);
}

// Chamado a cada frame pelo gameLoop
export function networkTick() {
    if (gameState.gameMode !== 'multiplayer') return;

    if (gameState.myRole === 'player' && netChannel) {
        syncCounter++;
        if (syncCounter >= SYNC_INTERVAL) {
            syncCounter = 0;
            broadcastSnapshot();
        }
    }

    if (gameState.myRole !== 'player') {
        interpolateJoinerPositions();
    }
}

// Interpola suavemente as posições recebidas no Joiner
function interpolateJoinerPositions() {
    const LERP_FACTOR = 0.25;
    const TELEPORT_THRESHOLD = 60;

    for (const unit of gameState.units) {
        if (unit.targetNetX !== undefined && unit.targetNetY !== undefined) {
            const dx = unit.targetNetX - unit.x;
            const dy = unit.targetNetY - unit.y;
            const dist = Math.hypot(dx, dy);

            if (dist < 0.5) {
                unit.x = unit.targetNetX;
                unit.y = unit.targetNetY;
            } else if (dist > TELEPORT_THRESHOLD) {
                unit.x = unit.targetNetX;
                unit.y = unit.targetNetY;
            } else {
                unit.x += dx * LERP_FACTOR;
                unit.y += dy * LERP_FACTOR;
            }
        }
    }
}

function broadcastSnapshot() {
    const snapshot = {
        type: '__sync_snapshot',
        senderRole: 'player',
        units: gameState.units.map(serializeUnit),
        buildings: gameState.buildings.map(serializeBuilding),
        resources: { ...gameState.resources },
        enemyResources: { ...gameState.enemyResources },
        factionResources: gameState.factionResources,
        teams: { ...gameState.teams },
        resourceAmounts: serializeResourceAmounts(),
        heroLevel: gameState.heroLevel,
        heroXP: gameState.heroXP,
        heroMaxXP: gameState.heroMaxXP,
        heroDead: gameState.heroDead,
        heroId: gameState.hero?.id || null,
        age: gameState.age,
        researchedTechs: [...gameState.researchedTechs],
        activeResearch: gameState.activeResearch ? { ...gameState.activeResearch } : null,
        gameOver: gameState.gameOver,
    };
    netChannel.postMessage(snapshot);
}

function serializeUnit(u) {
    return {
        id: u.id,
        typeName: u.name,
        typeKey: getUnitDefKey(u),
        x: Math.round(u.x * 10) / 10,
        y: Math.round(u.y * 10) / 10,
        health: u.health,
        maxHealth: u.maxHealth,
        attack: u.attack,
        speed: u.speed,
        size: u.size,
        owner: u.owner,
        targetX: u.targetX,
        targetY: u.targetY,
        attackTargetId: u.attackTarget?.id || null,
        attackTargetType: u.attackTarget ? (u.attackTarget.width ? 'building' : 'unit') : null,
        gathering: u.gathering,
        autoGathering: u.autoGathering,
        returning: u.returning,
        gatherType: u.gatherType,
        gatherAmount: u.gatherAmount,
        maxGather: u.maxGather,
        gatherTargetTile: u.gatherTargetTile,
        clusterOrigin: u.clusterOrigin,
        gatherTimer: u.gatherTimer,
        isBuilding: u.isBuilding,
        isRepairing: u.isRepairing,
        buildingTargetId: u.buildingTarget?.id || null,
        repairTargetId: u.repairTarget?.id || null,
        cooldown: u.cooldown,
        isHero: u.isHero || false,
        attackRange: u.attackRange,
        attackCooldown: u.attackCooldown,
    };
}

function serializeBuilding(b) {
    return {
        id: b.id,
        typeKey: getBuildingDefKey(b),
        x: b.x,
        y: b.y,
        owner: b.owner,
        health: b.health,
        maxHealth: b.maxHealth,
        isConstructed: b.isConstructed,
        buildProgress: b.buildProgress,
        buildTime: b.buildTime,
        cooldown: b.cooldown,
        trainQueue: b.trainQueue ? b.trainQueue.map(q => ({
            unitType: q.unitType,
            duration: q.duration,
            progress: q.progress,
            unitId: q.unitId,
        })) : [],
    };
}

function serializeResourceAmounts() {
    if (gameState.resourceDiffs && gameState.resourceDiffs.length > 0) {
        return gameState.resourceDiffs.splice(0);
    }
    return [];
}

function getUnitDefKey(unit) {
    for (const [key, def] of Object.entries(UNIT_DEFS)) {
        if (def.name === unit.name) return key;
    }
    return 'PEASANT';
}

function getBuildingDefKey(building) {
    for (const [key, def] of Object.entries(BUILDING_DEFS)) {
        if (def.name === building.name) return key;
    }
    return 'TOWN_HALL';
}

// ============================================================
// RECEPÇÃO DE MENSAGENS
// ============================================================
if (netChannel) {
    netChannel.addEventListener('message', (e) => {
        if (gameState.gameMode !== 'multiplayer') return;
        const msg = e.data;
        if (!msg || !msg.type) return;

        if (msg.senderRole && msg.senderRole === gameState.myRole) return;

        if (msg.type === '__sync_snapshot') {
            if (gameState.myRole === 'enemy') {
                applySnapshot(msg);
            }
            return;
        }

        handleRemoteAction(msg);
    });
}

function applySnapshot(snap) {
    // 1. Cria mapas auxiliares para busca instantânea O(1) em vez de .find() repetitivo
    const localUnitMap = new Map();
    for (let i = 0; i < gameState.units.length; i++) {
        localUnitMap.set(gameState.units[i].id, gameState.units[i]);
    }

    const localBuildingMap = new Map();
    for (let i = 0; i < gameState.buildings.length; i++) {
        localBuildingMap.set(gameState.buildings[i].id, gameState.buildings[i]);
    }

    // 2. Atualizar ou adicionar unidades
    const incomingUnitIds = new Set();
    const updatedUnits = [];

    for (let i = 0; i < snap.units.length; i++) {
        const su = snap.units[i];
        incomingUnitIds.add(su.id);
        const existing = localUnitMap.get(su.id);

        if (existing) {
            existing.targetNetX = su.x;
            existing.targetNetY = su.y;
            existing.health = su.health;
            existing.maxHealth = su.maxHealth;
            existing.attack = su.attack;
            existing.speed = su.speed;
            existing.targetX = su.targetX;
            existing.targetY = su.targetY;
            existing.gathering = su.gathering;
            existing.autoGathering = su.autoGathering;
            existing.returning = su.returning;
            existing.gatherType = su.gatherType;
            existing.gatherAmount = su.gatherAmount;
            existing.isBuilding = su.isBuilding;
            existing.isRepairing = su.isRepairing;
            existing.cooldown = su.cooldown;

            existing._pendingAttackTargetId = su.attackTargetId;
            existing._pendingAttackTargetType = su.attackTargetType;
            updatedUnits.push(existing);
        } else {
            const def = UNIT_DEFS[su.typeKey];
            if (!def) continue;
            const unit = new Unit(def, su.x, su.y, su.owner, su.id);
            unit.targetNetX = su.x;
            unit.targetNetY = su.y;
            unit.health = su.health;
            unit.maxHealth = su.maxHealth;
            unit._pendingAttackTargetId = su.attackTargetId;
            unit._pendingAttackTargetType = su.attackTargetType;
            updatedUnits.push(unit);
            localUnitMap.set(unit.id, unit);
        }
    }
    gameState.units = updatedUnits;

    // 3. Atualizar ou adicionar construções
    const updatedBuildings = [];
    for (let i = 0; i < snap.buildings.length; i++) {
        const sb = snap.buildings[i];
        const existing = localBuildingMap.get(sb.id);

        if (existing) {
            existing.health = sb.health;
            existing.maxHealth = sb.maxHealth;
            existing.isConstructed = sb.isConstructed;
            existing.buildProgress = sb.buildProgress;
            existing.cooldown = sb.cooldown;
            existing.trainQueue = sb.trainQueue || [];
            updatedBuildings.push(existing);
        } else {
            const def = BUILDING_DEFS[sb.typeKey];
            if (!def) continue;
            const building = new Building(def, sb.x, sb.y, sb.owner, sb.isConstructed, sb.id);
            building.health = sb.health;
            building.maxHealth = sb.maxHealth;
            building.buildProgress = sb.buildProgress;
            building.buildTime = sb.buildTime;
            building.cooldown = sb.cooldown;
            building.trainQueue = sb.trainQueue || [];
            updatedBuildings.push(building);
            localBuildingMap.set(building.id, building);
        }
    }
    gameState.buildings = updatedBuildings;

    // 4. Resolver referências de ataque sem loops aninhados
    for (let i = 0; i < gameState.units.length; i++) {
        const u = gameState.units[i];
        if (u._pendingAttackTargetId) {
            u.attackTarget = (u._pendingAttackTargetType === 'building')
                ? localBuildingMap.get(u._pendingAttackTargetId) || null
                : localUnitMap.get(u._pendingAttackTargetId) || null;
            delete u._pendingAttackTargetId;
            delete u._pendingAttackTargetType;
        }
    }

    // 5. Estado geral
    gameState.resources = snap.resources;
    gameState.enemyResources = snap.enemyResources;
    if (snap.factionResources) gameState.factionResources = snap.factionResources;
    if (snap.teams) gameState.teams = snap.teams;

    if (snap.resourceAmounts && gameState.resourceAmounts) {
        for (let i = 0; i < snap.resourceAmounts.length; i++) {
            const ra = snap.resourceAmounts[i];
            if (gameState.resourceAmounts[ra.y]) gameState.resourceAmounts[ra.y][ra.x] = ra.amt;
            if (gameState.map && gameState.map[ra.y]) gameState.map[ra.y][ra.x] = ra.t;
        }
    }

    gameState.heroLevel = snap.heroLevel;
    gameState.heroXP = snap.heroXP;
    gameState.heroMaxXP = snap.heroMaxXP;
    gameState.heroDead = snap.heroDead;
    gameState.hero = snap.heroId ? localUnitMap.get(snap.heroId) || null : null;

    gameState.age = snap.age;
    gameState.researchedTechs = snap.researchedTechs;
    gameState.activeResearch = snap.activeResearch;
    gameState.gameOver = snap.gameOver;

    if (gameState.selectedBuilding) {
        gameState.selectedBuilding = localBuildingMap.get(gameState.selectedBuilding.id) || null;
    }
    gameState.selectedUnits = gameState.selectedUnits
        .map(su => localUnitMap.get(su.id))
        .filter(Boolean);
}

function handleRemoteAction(msg) {
    switch (msg.type) {
        case 'right_click_move': {
            const units = (msg.unitIds || []).map(id => gameState.units.find(u => u.id === id)).filter(Boolean);
            if (units.length > 0) assignFormationPositions(units, msg.worldX, msg.worldY);
            break;
        }
        case 'right_click_gather': {
            const peasants = (msg.unitIds || []).map(id => gameState.units.find(u => u.id === id)).filter(Boolean);
            peasants.forEach((p, idx) => p.assignResourceHarvest(msg.tileX, msg.tileY, idx));
            break;
        }
        case 'right_click_attack': {
            const units = (msg.unitIds || []).map(id => gameState.units.find(u => u.id === id)).filter(Boolean);
            const target = (msg.targetType === 'building')
                ? gameState.buildings.find(b => b.id === msg.targetId)
                : gameState.units.find(u => u.id === msg.targetId);

            if (target && units.length > 0) {
                for (let i = 0; i < units.length; i++) {
                    const unit = units[i];
                    unit.attackTarget = target;
                    unit.gathering = false;
                    unit.returning = false;

                    if (target.width) {
                        const stand = getStandPositionNearBuilding(target, unit.x, unit.y, unit.size);
                        unit.targetX = stand.x;
                        unit.targetY = stand.y;
                    } else {
                        const angle = (i / units.length) * Math.PI * 2;
                        const dist = Math.max(12, (unit.attackRange || 20) * 0.6);
                        unit.targetX = target.x + Math.cos(angle) * dist;
                        unit.targetY = target.y + Math.sin(angle) * dist;
                    }
                }
            }
            break;
        }
        case 'right_click_build': {
            const peasants = (msg.unitIds || []).map(id => gameState.units.find(u => u.id === id)).filter(Boolean);
            const targetBuilding = gameState.buildings.find(b => b.id === msg.buildingId);
            if (targetBuilding && peasants.length > 0) peasants.forEach(p => p.assignBuild(targetBuilding));
            break;
        }
        case 'right_click_repair': {
            const peasants = (msg.unitIds || []).map(id => gameState.units.find(u => u.id === id)).filter(Boolean);
            const targetBuilding = gameState.buildings.find(b => b.id === msg.buildingId);
            if (targetBuilding && peasants.length > 0) peasants.forEach(p => p.assignRepair(targetBuilding));
            break;
        }
        case 'place_building': {
            const def = BUILDING_DEFS[msg.buildingType];
            if (!def) return;
            const building = new Building(def, msg.buildingX, msg.buildingY, msg.role, false, msg.buildingId);
            gameState.buildings.push(building);

            if (msg.workerId) {
                const worker = gameState.units.find(u => u.id === msg.workerId);
                if (worker) worker.assignBuild(building);
            }
            break;
        }
        case 'train_unit': {
            const building = gameState.buildings.find(b => b.id === msg.buildingId);
            if (building) building.queueUnit(msg.unitType, msg.unitId);
            break;
        }
        case 'stop_units': {
            const units = (msg.unitIds || []).map(id => gameState.units.find(u => u.id === id)).filter(Boolean);
            for (const u of units) {
                u.targetX = null;
                u.targetY = null;
                u.attackTarget = null;
                u.gathering = false;
                u.returning = false;
                u.buildingTarget = null;
                u.isBuilding = false;
                u.repairTarget = null;
                u.isRepairing = false;
            }
            break;
        }
        case 'ingame_chat': {
            import('./ui.js').then(ui => {
                ui.addInGameChatMessage(msg.senderName || 'Jogador', msg.text || '', '#60a5fa');
            });
            break;
        }
    }
}

window.addEventListener('beforeunload', () => {
    if (gameState.gameMode === 'multiplayer' && netChannel && gameState.gameStarted) {
        netChannel.postMessage({
            type: 'player_left',
            senderRole: gameState.myRole,
            senderName: gameState.myRole === 'player' ? 'Host' : 'Jogador Remoto'
        });
    }
});